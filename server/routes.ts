import type { Express } from "express";
import { createServer, type Server } from "http";
import crypto from 'crypto';
import { storage } from "./storage";
import { insertRequestSchema, insertUserSchema, insertApiConfigurationSchema, insertQueueItemSchema, insertStorageSpotSchema, insertVehicleSchema, insertTemplateSchema, QueueModule, saveProgressSchema, completeQueueItemSchema, assignQueueItemSchema, anonymousQueueItemSchema, anonymousVehicleSchema, anonymousStorageSpotSchema, anonymousVehicleAssignmentSchema, anonymousOnboardingSchema, anonymousOffboardingSchema, anonymousByovEnrollmentSchema, enhancedCompleteQueueItemSchema } from "@shared/schema";
import { z } from "zod";
import { sendEmail, createCreditCardDeactivationEmail } from "./email-service";
import { activeVehicles } from "../client/src/data/fleetData";
import { templateLoader, getTemplateForTask } from "../shared/template-loader";
import { createTestUsers } from "./create-test-users";
import multer from "multer";
import rateLimit from "express-rate-limit";
import DOMPurify from "isomorphic-dompurify";
import bcrypt from "bcrypt";
import { checkPasswordCompromised, validatePasswordRequirements } from "./password-screening";
import * as ExcelJS from "exceljs";
import { stringify as csvStringify } from "csv-stringify";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { holmanApiService } from "./holman-api-service";

// Initialize session cleanup on startup
try {
  storage.cleanExpiredSessions().then(cleanedCount => {
    console.log(`Cleaned up ${cleanedCount} expired sessions from database`);
  }).catch(error => {
    console.warn('Failed to clean expired sessions on startup:', error);
  });
} catch (error) {
  console.warn('Failed to initialize session cleanup:', error);
}

// Human verification session store
const humanVerificationSessions = new Map<string, { verified: boolean; expiresAt: Date; originalUrl: string }>();

// Rate limiting store for anonymous form submissions
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 5 * 60 * 1000; // 5 minutes
const RATE_LIMIT_MAX_REQUESTS = 50; // Increased to 50 requests per window for testing

// Password reset token store (in production, this would be in database)
const passwordResetStore = new Map<string, { userId: string; token: string; expiresAt: Date }>();

// Login rate limiter with NIST-recommended settings
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 5, // 5 login attempts per window per IP
  message: {
    message: "Too many login attempts. Please try again in 15 minutes.",
    retryAfter: 15 * 60 // 15 minutes in seconds
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  // Progressive delay on repeated failures
  skipSuccessfulRequests: true, // Don't count successful requests
  skipFailedRequests: false, // Count failed requests
  handler: (req, res) => {
    res.status(429).json({
      message: "Too many login attempts. Please try again in 15 minutes.",
      retryAfter: Math.ceil(15 * 60) // 15 minutes in seconds
    });
  }
});

// Input sanitization function
function sanitizeInput(obj: any): any {
  if (typeof obj === 'string') {
    return DOMPurify.sanitize(obj, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeInput);
  }
  if (obj && typeof obj === 'object') {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeInput(value);
    }
    return sanitized;
  }
  return obj;
}

// CSV/Excel Formula Injection Prevention
function sanitizeForCSVExcel(value: any): any {
  if (typeof value !== 'string' || !value) {
    return value;
  }
  
  // Check if the string starts with dangerous characters that could execute as formulas
  if (/^[=+\-@]/.test(value)) {
    // Prefix with single quote to prevent formula execution
    return `'${value}`;
  }
  
  return value;
}

// Sanitize an entire row for CSV/Excel export
function sanitizeRowForExport(row: any): any {
  const sanitizedRow: any = {};
  for (const [key, value] of Object.entries(row)) {
    // Apply CSV/Excel sanitization to text fields that could contain user input
    const textFields = ['title', 'description', 'notes', 'last_error', 'assignee', 'requester_id'];
    if (textFields.includes(key)) {
      sanitizedRow[key] = sanitizeForCSVExcel(value);
    } else {
      sanitizedRow[key] = value;
    }
  }
  return sanitizedRow;
}

// Duplicate task detection for BYOV enrollment workflows
async function checkByovEnrollmentDuplicates(formData: any): Promise<{ isDuplicate: boolean, message?: string }> {
  try {
    const ldap = formData?.ldap;
    const email = formData?.techEmail;
    const currentTruckNumber = formData?.currentTruckNumber;
    const techFullName = `${formData?.techFirstName || ''} ${formData?.techLastName || ''}`.trim();
    
    // Must have key identifiers to check duplicates
    if (!ldap && !email && !currentTruckNumber) {
      return { isDuplicate: false };
    }
    
    // Define time window for duplicate detection (5 minutes)
    const duplicateWindowMs = 5 * 60 * 1000;
    const cutoffTime = new Date(Date.now() - duplicateWindowMs);
    
    // Check FLEET and NTAO queues for recent BYOV enrollment tasks
    const modules = ['fleet', 'ntao'];
    
    for (const module of modules) {
      let queueItems: any[] = [];
      
      try {
        switch (module) {
          case 'fleet':
            queueItems = await storage.getFleetQueueItems();
            break;
          case 'ntao':
            queueItems = await storage.getNTAOQueueItems();
            break;
        }
      } catch (error) {
        console.error(`Error checking ${module} queue for BYOV duplicates:`, error);
        continue;
      }
      
      // Check for recent BYOV enrollment tasks with matching identifiers
      for (const item of queueItems) {
        if (item.createdAt && new Date(item.createdAt) >= cutoffTime) {
          try {
            let itemData = item.data;
            if (typeof itemData === 'string') {
              itemData = JSON.parse(itemData);
            }
            
            // Check if this is a BYOV enrollment workflow
            const isByovWorkflow = 
              item.metadata && JSON.parse(item.metadata || '{}').source === 'sears_drive_enrollment' ||
              itemData?.workflowId?.startsWith('byov-') ||
              ['van_assignment', 'van_unassignment', 'system_updates', 'stop_shipment', 'setup_shipment'].includes(item.workflowType);
            
            if (isByovWorkflow && itemData?.techInfo) {
              const itemLdap = itemData.techInfo.ldap;
              const itemEmail = itemData.techInfo.email;
              const itemTruckNumber = itemData.techInfo.currentTruckNumber;
              
              // Check if key identifiers match
              const ldapMatch = ldap && itemLdap && ldap.toLowerCase() === itemLdap.toLowerCase();
              const emailMatch = email && itemEmail && email.toLowerCase() === itemEmail.toLowerCase();
              const truckMatch = currentTruckNumber && itemTruckNumber && currentTruckNumber === itemTruckNumber;
              
              if (ldapMatch || emailMatch || truckMatch) {
                let matchType = '';
                if (ldapMatch) matchType = `LDAP: ${ldap}`;
                else if (emailMatch) matchType = `Email: ${email}`;
                else if (truckMatch) matchType = `Truck: ${currentTruckNumber}`;
                
                return {
                  isDuplicate: true,
                  message: `Duplicate BYOV enrollment detected. A recent enrollment already exists for this technician (${matchType}) in ${module.toUpperCase()} queue. Please wait 5 minutes before submitting another BYOV enrollment.`
                };
              }
            }
          } catch (parseError) {
            console.error('Error parsing queue item data for BYOV duplicate check:', parseError);
            continue;
          }
        }
      }
    }
    
    return { isDuplicate: false };
  } catch (error) {
    console.error('Error in BYOV duplicate detection:', error);
    return { isDuplicate: false }; // Allow creation if duplicate check fails
  }
}

// Duplicate task detection for offboarding workflows
async function checkOffboardingDuplicates(data: any, department: string, currentWorkflowId?: string): Promise<{ isDuplicate: boolean, message?: string }> {
  try {
    // Parse data if it's a JSON string
    let parsedData = data;
    if (typeof data === 'string') {
      parsedData = JSON.parse(data);
    }
    
    // Extract employee identifiers and workflow ID
    const employeeId = parsedData?.employee?.employeeId || parsedData?.employeeId;
    const techRacfId = parsedData?.employee?.racfId || parsedData?.techRacfId || parsedData?.employee?.enterpriseId;
    const workflowType = parsedData?.workflowType;
    const dataWorkflowId = parsedData?.workflowId;
    
    // Use the workflow ID from data or the passed parameter
    const workflowId = currentWorkflowId || dataWorkflowId;
    
    // Only check for offboarding workflows
    if (!workflowType || workflowType !== 'offboarding_sequence') {
      return { isDuplicate: false };
    }
    
    // Must have employee identifiers to check duplicates
    if (!employeeId && !techRacfId) {
      return { isDuplicate: false };
    }
    
    // Define time window for duplicate detection (5 minutes)
    const duplicateWindowMs = 5 * 60 * 1000;
    const cutoffTime = new Date(Date.now() - duplicateWindowMs);
    
    // Check each queue module for recent offboarding tasks with same employee
    const modules = ['ntao', 'assets', 'inventory', 'fleet'];
    
    for (const module of modules) {
      let queueItems: any[] = [];
      
      try {
        switch (module) {
          case 'ntao':
            queueItems = await storage.getNTAOQueueItems();
            break;
          case 'assets':
            queueItems = await storage.getAssetsQueueItems();
            break;
          case 'inventory':
            queueItems = await storage.getInventoryQueueItems();
            break;
          case 'fleet':
            queueItems = await storage.getFleetQueueItems();
            break;
        }
      } catch (error) {
        console.error(`Error checking ${module} queue for duplicates:`, error);
        continue; // Continue checking other modules even if one fails
      }
      
      // Check for recent offboarding tasks with matching employee data
      for (const item of queueItems) {
        if (item.createdAt && new Date(item.createdAt) >= cutoffTime) {
          try {
            let itemData = item.data;
            if (typeof itemData === 'string') {
              itemData = JSON.parse(itemData);
            }
            
            if (itemData?.workflowType === 'offboarding_sequence') {
              const itemEmployeeId = itemData?.employee?.employeeId || itemData?.employeeId;
              const itemTechRacfId = itemData?.employee?.racfId || itemData?.techRacfId || itemData?.employee?.enterpriseId;
              const itemWorkflowId = item.workflowId || itemData?.workflowId;
              
              // Check if employee identifiers match
              const employeeIdMatch = employeeId && itemEmployeeId && employeeId === itemEmployeeId;
              const techRacfIdMatch = techRacfId && itemTechRacfId && techRacfId === itemTechRacfId;
              
              if (employeeIdMatch || techRacfIdMatch) {
                // If both tasks have the same workflowId, they're part of the same multi-department workflow - allow it
                if (workflowId && itemWorkflowId && workflowId === itemWorkflowId) {
                  console.log(`Allowing multi-department task for same workflow ID: ${workflowId}, employee: ${employeeId || techRacfId}, departments: existing ${module.toUpperCase()}, new ${department.toUpperCase()}`);
                  continue; // Allow this task - it's part of the same workflow
                }
                
                // Different workflow IDs but same employee - this is a duplicate submission
                return {
                  isDuplicate: true,
                  message: `Duplicate offboarding workflow detected. A recent offboarding task already exists for this employee (${employeeIdMatch ? `Employee ID: ${employeeId}` : `RACF ID: ${techRacfId}`}) in ${module.toUpperCase()} queue. Please wait 5 minutes before creating another offboarding workflow.`
                };
              }
            }
          } catch (parseError) {
            console.error('Error parsing queue item data for duplicate check:', parseError);
            continue;
          }
        }
      }
    }
    
    return { isDuplicate: false };
  } catch (error) {
    console.error('Error in duplicate detection:', error);
    return { isDuplicate: false }; // Allow creation if duplicate check fails
  }
}

// Rate limiting middleware for anonymous endpoints
function checkAnonymousRateLimit(req: any, res: any, next: any): any {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  const limitData = rateLimitStore.get(ip);

  if (!limitData || now > limitData.resetTime) {
    rateLimitStore.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return next();
  }

  if (limitData.count >= RATE_LIMIT_MAX_REQUESTS) {
    return res.status(429).json({ 
      message: "Too many requests. Please try again later.",
      retryAfter: Math.ceil((limitData.resetTime - now) / 1000)
    });
  }

  limitData.count++;
  return next();
}

// Department to queue module mapping
function departmentToQueueModule(department: string): QueueModule | null {
  switch (department.toUpperCase()) {
    case 'NTAO':
      return 'ntao';
    case 'ASSETS':
      return 'assets';
    case 'INVENTORY':
      return 'inventory';
    case 'FLEET':
      return 'fleet';
    default:
      return null;
  }
}

// Check if user has access to a specific queue module
function hasQueueAccess(user: any, module: QueueModule): boolean {
  // Superadmin has access to everything
  if (user.role === 'superadmin') {
    return true;
  }
  
  // Check departmentAccess array
  if (user.departmentAccess && Array.isArray(user.departmentAccess)) {
    const requiredDepartment = module.toUpperCase();
    return user.departmentAccess.includes(requiredDepartment);
  }
  
  return false;
}

// Get accessible queue modules for a user
function getAccessibleQueueModules(user: any): QueueModule[] {
  if (user.role === 'superadmin') {
    return ['ntao', 'assets', 'inventory', 'fleet'];
  }
  
  if (user.departmentAccess && Array.isArray(user.departmentAccess)) {
    return user.departmentAccess
      .map((dept: string) => departmentToQueueModule(dept))
      .filter((module: QueueModule | null) => module !== null) as QueueModule[];
  }
  
  return [];
}

// Authentication middleware
async function requireAuth(req: any, res: any, next: any): Promise<any> {
  const cookieHeader = req.headers.cookie;
  const sessionId = cookieHeader?.match(/sessionId=([^;]+)/)?.[1];
  
  if (!sessionId) {
    return res.status(401).json({ message: "Authentication required" });
  }
  
  try {
    const session = await storage.getSession(sessionId);
    
    if (!session || session.expiresAt < new Date()) {
      if (session) {
        await storage.deleteSession(sessionId);
      }
      return res.status(401).json({ message: "Session expired" });
    }
    
    req.user = { id: session.userId, username: session.username };
    
    return next();
  } catch (error) {
    console.error('Session validation error:', error);
    return res.status(401).json({ message: "Authentication failed" });
  }
}

// Configure multer for file uploads
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 10 // Max 10 files
  }
});

export async function registerRoutes(app: Express): Promise<Server> {
  console.log("=== STARTING ROUTE REGISTRATION ===");
  
  // Auth routes
  console.log("Registering auth routes...");
  app.post("/api/auth/login", loginRateLimiter, async (req, res) => {
    try {
      const { enterpriseId, password } = req.body;
      
      const user = await storage.getUserByUsername(enterpriseId);
      
      if (!user) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      // Use bcrypt to compare the provided password with the hashed password
      const isPasswordValid = await bcrypt.compare(password, user.password);
      
      if (!isPasswordValid) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      // Create session with longer timeout for better UX
      const sessionId = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
      
      await storage.createSession({
        id: sessionId,
        userId: user.id,
        username: user.username,
        expiresAt
      });

      // Set httpOnly cookie with secure settings
      res.cookie('sessionId', sessionId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax', // Changed from 'strict' for better cross-origin compatibility
        expires: expiresAt,
        path: '/' // Ensure cookie is available for all paths
      });

      res.json({ user: { ...user, password: undefined } });
    } catch (error) {
      res.status(500).json({ message: "Login failed" });
    }
  });

  app.post("/api/auth/register", async (req, res) => {
    try {
      const userData = insertUserSchema.parse(req.body);
      
      // Check if user already exists
      const existingUser = await storage.getUserByUsername(userData.username);
      if (existingUser) {
        return res.status(400).json({ message: "Username already exists" });
      }

      // NIST compliance: Screen password for known breaches
      if (!validatePasswordRequirements(userData.password)) {
        return res.status(400).json({ 
          message: "Password does not meet security requirements. Please use a password with at least 8 characters." 
        });
      }
      
      const screeningResult = await checkPasswordCompromised(userData.password);
      if (screeningResult.isCompromised) {
        return res.status(400).json({ 
          message: "This password has been found in data breaches and cannot be used. Please choose a different password." 
        });
      }
      
      // Log if screening service had issues (but password was allowed through)
      if (screeningResult.error) {
        console.warn('Password screening service issue during registration:', screeningResult.error);
      }

      // Hash the password before storing
      const hashedPassword = await bcrypt.hash(userData.password, 10);
      const userDataWithHashedPassword = {
        ...userData,
        password: hashedPassword
      };

      const user = await storage.createUser(userDataWithHashedPassword);
      
      // Log activity
      await storage.createActivityLog({
        userId: user.id,
        action: "user_registered",
        entityType: "user",
        entityId: user.id,
        details: `User ${user.username} registered`,
      });

      res.status(201).json({ user: { ...user, password: undefined } });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid user data", errors: error.errors });
      }
      res.status(500).json({ message: "Registration failed" });
    }
  });

  // Test user creation endpoint (development only)
  app.post("/api/auth/create-test-users", requireAuth, async (req: any, res) => {
    try {
      // Environment check - only allow in non-production environments
      const nodeEnv = process.env.NODE_ENV || 'development';
      if (nodeEnv === 'production') {
        return res.status(404).json({ message: "Not found" });
      }

      // Authentication and authorization check - require superadmin role
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || currentUser.role !== 'superadmin') {
        return res.status(403).json({ 
          message: "Access denied. Test user creation requires superadmin role and development environment." 
        });
      }

      await createTestUsers();
      
      // Log the security-sensitive activity
      await storage.createActivityLog({
        userId: currentUser.id,
        action: "test_users_created",
        entityType: "system",
        entityId: "test-users",
        details: `Test users created by ${currentUser.username} in ${nodeEnv} environment`,
      });

      res.json({ 
        message: "Test users created successfully",
        environment: nodeEnv,
        users: [
          { username: "assets_user", role: "assets" },
          { username: "fleet_user", role: "fleet" },
          { username: "inventory_user", role: "inventory" },
          { username: "ntao_user", role: "ntao" },
          { username: "field_user", role: "field" },
          { username: "superadmin", role: "superadmin" }
        ]
      });
    } catch (error) {
      console.error("Failed to create test users:", error);
      res.status(500).json({ message: "Failed to create test users" });
    }
  });

  // Human verification routes for form access
  app.post("/api/forms/verify-human", checkAnonymousRateLimit, async (req, res) => {
    try {
      const { timestamp, originalUrl } = req.body;
      
      // Simple validation: must have timestamp and URL
      if (!timestamp || !originalUrl) {
        return res.status(400).json({ message: "Invalid verification request" });
      }
      
      // Basic bot detection: disabled timing check for better user experience
      // const requestTime = Date.now() - timestamp;
      // Rate limiting is sufficient protection against bots
      
      // Create verification session
      const verificationId = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      
      humanVerificationSessions.set(verificationId, {
        verified: true,
        expiresAt,
        originalUrl: sanitizeInput(originalUrl)
      });
      
      // Set httpOnly cookie for verification
      res.cookie('humanVerified', verificationId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict', // Upgraded from 'lax' for better CSRF protection
        expires: expiresAt,
        path: '/' // Available to all paths including /forms and /api/forms
      });
      
      res.json({ success: true, message: "Human verification successful" });
    } catch (error) {
      console.error('Human verification error:', error);
      res.status(500).json({ message: "Verification failed" });
    }
  });

  app.get("/api/forms/verify-status", async (req, res) => {
    try {
      // Disable caching to prevent stale verification status
      res.set({
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      
      const cookieHeader = req.headers.cookie;
      const verificationId = cookieHeader?.match(/humanVerified=([^;]+)/)?.[1];
      
      if (!verificationId) {
        return res.json({ verified: false });
      }
      
      const verification = humanVerificationSessions.get(verificationId);
      if (!verification || verification.expiresAt < new Date()) {
        // Clean up expired session
        if (verification) {
          humanVerificationSessions.delete(verificationId);
        }
        return res.json({ verified: false });
      }
      
      res.json({ verified: true, originalUrl: verification.originalUrl });
    } catch (error) {
      res.status(500).json({ message: "Failed to check verification status" });
    }
  });

  // User management routes (GET users available for all authenticated users for task assignment)
  app.get("/api/users", requireAuth, async (req: any, res) => {
    try {
      const users = await storage.getUsers();
      // Remove passwords from response for security
      const safeUsers = users.map(user => ({ ...user, password: undefined }));
      res.json(safeUsers);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.post("/api/users", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || (currentUser.role !== 'superadmin' && currentUser.role !== 'admin')) {
        return res.status(403).json({ message: "Access denied. User management requires superadmin or admin role." });
      }
      
      const userData = insertUserSchema.parse(req.body);
      
      // Check if user already exists
      const existingUser = await storage.getUserByUsername(userData.username);
      if (existingUser) {
        return res.status(400).json({ message: "Username already exists" });
      }

      const existingEmail = await storage.getUserByEmail(userData.email);
      if (existingEmail) {
        return res.status(400).json({ message: "Email already exists" });
      }

      const user = await storage.createUser(userData);
      
      // Log activity
      await storage.createActivityLog({
        userId: user.id,
        action: "user_created",
        entityType: "user",
        entityId: user.id,
        details: `User ${user.username} created with role ${user.role}`,
      });

      res.status(201).json({ ...user, password: undefined });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid user data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create user" });
    }
  });

  app.patch("/api/users/:id", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || (currentUser.role !== 'superadmin' && currentUser.role !== 'admin')) {
        return res.status(403).json({ message: "Access denied. User management requires superadmin or admin role." });
      }
      
      const { id } = req.params;
      
      // Protect seed accounts from modification
      if (id === 'emergency-admin-2025-id') {
        return res.status(403).json({ message: "Access denied. Cannot modify seed accounts." });
      }
      
      // Get the target user first to verify it exists
      const targetUser = await storage.getUser(id);
      if (!targetUser) {
        return res.status(404).json({ message: "User not found" });
      }
      
      const updates = req.body;
      
      // Strict field validation - only allow safe fields to be updated
      const allowedFields = ['email', 'fullName', 'department', 'role', 'departmentAccess', 'isActive', 'username'];
      const sanitizedUpdates: any = {};
      
      for (const [key, value] of Object.entries(updates)) {
        if (allowedFields.includes(key)) {
          sanitizedUpdates[key] = value;
        }
      }
      
      // Never allow these critical fields to be updated through this route
      delete sanitizedUpdates.password;
      delete sanitizedUpdates.id;
      delete sanitizedUpdates.createdAt;
      
      // Validate username if being updated
      if (sanitizedUpdates.username) {
        const usernameStr = String(sanitizedUpdates.username).trim();
        if (usernameStr.length < 3 || usernameStr.length > 50) {
          return res.status(400).json({ message: "Username must be between 3 and 50 characters" });
        }
        if (!/^[a-zA-Z0-9_.-]+$/.test(usernameStr)) {
          return res.status(400).json({ message: "Username can only contain letters, numbers, dots, dashes, and underscores" });
        }
        
        // Check if username is already taken (but allow keeping the same username)
        const existingUser = await storage.getUserByUsername(usernameStr);
        if (existingUser && existingUser.id !== id) {
          return res.status(400).json({ message: "Username is already taken" });
        }
        
        sanitizedUpdates.username = usernameStr;
      }
      
      // Validate role if being updated
      if (sanitizedUpdates.role) {
        const validRoles = ['superadmin', 'admin', 'agent', 'field', 'approver', 'requester'];
        if (!validRoles.includes(sanitizedUpdates.role)) {
          return res.status(400).json({ message: "Invalid role specified" });
        }
      }
      
      // Validate department access if being updated
      if (sanitizedUpdates.departmentAccess) {
        const validDepartments = ['NTAO', 'ASSETS', 'INVENTORY', 'FLEET'];
        if (!Array.isArray(sanitizedUpdates.departmentAccess)) {
          return res.status(400).json({ message: "Department access must be an array" });
        }
        for (const dept of sanitizedUpdates.departmentAccess) {
          if (!validDepartments.includes(dept)) {
            return res.status(400).json({ message: `Invalid department access: ${dept}` });
          }
        }
      }
      
      // If no valid updates, return error
      if (Object.keys(sanitizedUpdates).length === 0) {
        return res.status(400).json({ message: "No valid fields to update" });
      }

      const updatedUser = await storage.updateUser(id, sanitizedUpdates);
      if (!updatedUser) {
        return res.status(500).json({ message: "Failed to update user" });
      }

      // Log activity with details of what was changed
      await storage.createActivityLog({
        userId: currentUser.id,
        action: "user_updated",
        entityType: "user",
        entityId: id,
        details: `Admin ${currentUser.username} updated user ${targetUser.username}. Fields: ${Object.keys(sanitizedUpdates).join(', ')}`,
      });

      res.json({ ...updatedUser, password: undefined });
    } catch (error) {
      console.error('User update error:', error);
      res.status(500).json({ message: "Failed to update user" });
    }
  });

  app.delete("/api/users/:id", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || (currentUser.role !== 'superadmin' && currentUser.role !== 'admin')) {
        return res.status(403).json({ message: "Access denied. User management requires superadmin or admin role." });
      }
      
      const { id } = req.params;
      
      // Protect seed accounts from deletion
      if (id === 'emergency-admin-2025-id') {
        return res.status(403).json({ message: "Access denied. Cannot delete seed accounts." });
      }
      
      const user = await storage.getUser(id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Prevent self-deletion
      if (user.id === currentUser.id) {
        return res.status(403).json({ message: "Cannot delete your own account" });
      }

      const deleted = await storage.deleteUser(id);
      if (!deleted) {
        return res.status(404).json({ message: "User not found" });
      }

      // Log activity
      await storage.createActivityLog({
        userId: currentUser.id,
        action: "user_deleted",
        entityType: "user",
        entityId: id,
        details: `Admin ${currentUser.username} deleted user ${user.username}`,
      });

      res.json({ message: "User deleted successfully" });
    } catch (error) {
      console.error('User deletion error:', error);
      res.status(500).json({ message: "Failed to delete user" });
    }
  });

  // Admin Password Reset - Super admins can reset any user's password
  app.post("/api/users/:id/reset-password", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || currentUser.role !== 'superadmin') {
        return res.status(403).json({ message: "Access denied. Password reset requires superadmin role." });
      }
      
      const { id } = req.params;
      
      // Protect seed accounts from password reset by other admins
      if (id === 'emergency-admin-2025-id' && currentUser.id !== id) {
        return res.status(403).json({ message: "Access denied. Cannot reset password for seed accounts." });
      }
      
      const { temporaryPassword } = req.body;
      
      // Validate temporary password meets requirements
      if (!temporaryPassword || !validatePasswordRequirements(temporaryPassword)) {
        return res.status(400).json({ 
          message: "Temporary password must be at least 8 characters long." 
        });
      }
      
      const targetUser = await storage.getUser(id);
      if (!targetUser) {
        return res.status(404).json({ message: "User not found" });
      }

      // Screen password for known breaches
      const screeningResult = await checkPasswordCompromised(temporaryPassword);
      if (screeningResult.isCompromised) {
        return res.status(400).json({ 
          message: "This password has been found in data breaches and cannot be used. Please choose a different password." 
        });
      }

      // Hash the new password
      const hashedPassword = await bcrypt.hash(temporaryPassword, 10);
      
      // Update user's password
      const updatedUser = await storage.updateUser(id, { password: hashedPassword });
      if (!updatedUser) {
        return res.status(500).json({ message: "Failed to update password" });
      }

      // Log security action
      await storage.createActivityLog({
        userId: currentUser.id,
        action: "password_reset_admin",
        entityType: "user",
        entityId: id,
        details: `Admin ${currentUser.username} reset password for user ${targetUser.username}`,
      });

      res.json({ message: "Password reset successfully", username: targetUser.username });
    } catch (error) {
      console.error("Admin password reset error:", error);
      res.status(500).json({ message: "Failed to reset password" });
    }
  });

  // User Self-Service Password Change
  app.post("/api/auth/change-password", requireAuth, async (req: any, res) => {
    try {
      const { currentPassword, newPassword } = req.body;
      
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: "Current password and new password are required" });
      }

      // Validate new password meets requirements
      if (!validatePasswordRequirements(newPassword)) {
        return res.status(400).json({ 
          message: "New password must be at least 8 characters long." 
        });
      }

      const user = await storage.getUserByUsername(req.user.username);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Verify current password
      const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
      if (!isCurrentPasswordValid) {
        return res.status(401).json({ message: "Current password is incorrect" });
      }

      // Check if new password is the same as current
      const isSamePassword = await bcrypt.compare(newPassword, user.password);
      if (isSamePassword) {
        return res.status(400).json({ message: "New password must be different from current password" });
      }

      // Screen new password for known breaches
      const screeningResult = await checkPasswordCompromised(newPassword);
      if (screeningResult.isCompromised) {
        return res.status(400).json({ 
          message: "This password has been found in data breaches and cannot be used. Please choose a different password." 
        });
      }

      // Hash the new password
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      
      // Update user's password
      const updatedUser = await storage.updateUser(user.id, { password: hashedPassword });
      if (!updatedUser) {
        return res.status(500).json({ message: "Failed to update password" });
      }

      // Log security action
      await storage.createActivityLog({
        userId: user.id,
        action: "password_changed_self",
        entityType: "user",
        entityId: user.id,
        details: `User ${user.username} changed their own password`,
      });

      res.json({ message: "Password changed successfully" });
    } catch (error) {
      console.error("Password change error:", error);
      res.status(500).json({ message: "Failed to change password" });
    }
  });

  // Admin Role Management - Super admins can update user roles and department access
  app.post("/api/users/:id/update-role", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || currentUser.role !== 'superadmin') {
        return res.status(403).json({ message: "Access denied. Role management requires superadmin role." });
      }
      
      const { id } = req.params;
      
      // Protect seed accounts from role changes
      if (id === 'emergency-admin-2025-id') {
        return res.status(403).json({ message: "Access denied. Cannot modify role for seed accounts." });
      }
      
      const { role, department, departmentAccess } = req.body;
      
      // Validate role if provided
      const validRoles = ['superadmin', 'agent', 'field', 'approver', 'requester'];
      if (role && !validRoles.includes(role)) {
        return res.status(400).json({ message: "Invalid role specified" });
      }

      // Validate department access if provided
      const validDepartments = ['NTAO', 'ASSETS', 'INVENTORY', 'FLEET'];
      if (departmentAccess && Array.isArray(departmentAccess)) {
        for (const dept of departmentAccess) {
          if (!validDepartments.includes(dept)) {
            return res.status(400).json({ message: `Invalid department access: ${dept}` });
          }
        }
      }

      const targetUser = await storage.getUser(id);
      if (!targetUser) {
        return res.status(404).json({ message: "User not found" });
      }

      // Prepare updates object
      const updates: any = {};
      if (role !== undefined) updates.role = role;
      if (department !== undefined) updates.department = department;
      if (departmentAccess !== undefined) updates.departmentAccess = departmentAccess;

      // Update user
      const updatedUser = await storage.updateUser(id, updates);
      if (!updatedUser) {
        return res.status(500).json({ message: "Failed to update user role" });
      }

      // Log security action
      await storage.createActivityLog({
        userId: currentUser.id,
        action: "user_role_updated",
        entityType: "user",
        entityId: id,
        details: `Admin ${currentUser.username} updated role/access for user ${targetUser.username}. Changes: ${JSON.stringify(updates)}`,
      });

      res.json({ 
        message: "User role updated successfully", 
        user: { ...updatedUser, password: undefined } 
      });
    } catch (error) {
      console.error("Role update error:", error);
      res.status(500).json({ message: "Failed to update user role" });
    }
  });

  // Forgot Password Initiation (generates temporary reset token and sends email)
  app.post("/api/auth/forgot-password", async (req, res) => {
    try {
      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      const user = await storage.getUserByEmail(email);
      if (!user) {
        // Don't reveal if email exists - security best practice
        return res.json({ message: "If an account with that email exists, a password reset link has been sent." });
      }

      // Generate secure reset token
      const resetToken = crypto.randomBytes(32).toString('hex');
      const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      // Store reset token (in production, you'd store this in database)
      passwordResetStore.set(resetToken, {
        userId: user.id,
        token: resetToken,
        expiresAt: resetTokenExpiry
      });

      // Send password reset email
      try {
        await sendEmail({
          to: email,
          from: "noreply@sears.com",
          subject: "Password Reset Request - Sears Operations Portal",
          html: `
            <h2>Password Reset Request</h2>
            <p>Hello ${user.username},</p>
            <p>You requested a password reset for your Sears Operations Portal account.</p>
            <p>Your password reset token is: <strong>${resetToken}</strong></p>
            <p>This token will expire in 1 hour.</p>
            <p>If you did not request this reset, please ignore this email.</p>
            <p>Best regards,<br>Sears Operations Portal Team</p>
          `
        });

        // Log security action
        await storage.createActivityLog({
          userId: user.id,
          action: "password_reset_requested",
          entityType: "user",
          entityId: user.id,
          details: `Password reset requested for user ${user.username} (${email})`,
        });

      } catch (emailError) {
        console.error("Failed to send password reset email:", emailError);
        return res.status(500).json({ message: "Failed to send password reset email" });
      }

      res.json({ message: "If an account with that email exists, a password reset link has been sent." });
    } catch (error) {
      console.error("Forgot password error:", error);
      res.status(500).json({ message: "Failed to process password reset request" });
    }
  });

  // Password Reset Confirmation (using reset token)
  app.post("/api/auth/reset-password", async (req, res) => {
    try {
      const { resetToken, newPassword } = req.body;
      
      if (!resetToken || !newPassword) {
        return res.status(400).json({ message: "Reset token and new password are required" });
      }

      // Validate new password meets requirements
      if (!validatePasswordRequirements(newPassword)) {
        return res.status(400).json({ 
          message: "New password must be at least 8 characters long." 
        });
      }

      // Check reset token (in production, retrieve from database)
      const resetData = passwordResetStore.get(resetToken);
      
      if (!resetData || resetData.expiresAt < new Date()) {
        return res.status(400).json({ message: "Invalid or expired reset token" });
      }

      const user = await storage.getUser(resetData.userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Screen new password for known breaches
      const screeningResult = await checkPasswordCompromised(newPassword);
      if (screeningResult.isCompromised) {
        return res.status(400).json({ 
          message: "This password has been found in data breaches and cannot be used. Please choose a different password." 
        });
      }

      // Hash the new password
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      
      // Update user's password
      const updatedUser = await storage.updateUser(user.id, { password: hashedPassword });
      if (!updatedUser) {
        return res.status(500).json({ message: "Failed to update password" });
      }

      // Remove used reset token
      passwordResetStore.delete(resetToken);

      // Log security action
      await storage.createActivityLog({
        userId: user.id,
        action: "password_reset_completed",
        entityType: "user",
        entityId: user.id,
        details: `Password reset completed for user ${user.username}`,
      });

      res.json({ message: "Password reset successfully" });
    } catch (error) {
      console.error("Password reset confirmation error:", error);
      res.status(500).json({ message: "Failed to reset password" });
    }
  });

  // Dashboard routes
  app.get("/api/dashboard/stats", async (req, res) => {
    try {
      const stats = await storage.getDashboardStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch dashboard stats" });
    }
  });

  // Request routes
  app.get("/api/requests", async (req, res) => {
    try {
      const { status, requesterId } = req.query;
      
      let requests;
      if (status) {
        requests = await storage.getRequestsByStatus(status as string);
      } else if (requesterId) {
        requests = await storage.getRequestsByRequester(requesterId as string);
      } else {
        requests = await storage.getRequests();
      }
      
      res.json(requests);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch requests" });
    }
  });

  app.get("/api/requests/:id", async (req, res) => {
    try {
      const request = await storage.getRequest(req.params.id);
      if (!request) {
        return res.status(404).json({ message: "Request not found" });
      }
      res.json(request);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch request" });
    }
  });

  app.post("/api/requests", async (req, res) => {
    try {
      const requestData = insertRequestSchema.parse(req.body);
      const request = await storage.createRequest(requestData);
      
      // Log activity
      await storage.createActivityLog({
        userId: request.requesterId,
        action: "request_created",
        entityType: "request",
        entityId: request.id,
        details: `Created request: ${request.title}`,
      });

      res.status(201).json(request);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid request data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create request" });
    }
  });

  app.patch("/api/requests/:id", async (req, res) => {
    try {
      const updates = req.body;
      const request = await storage.updateRequest(req.params.id, updates);
      
      if (!request) {
        return res.status(404).json({ message: "Request not found" });
      }

      // Log activity
      await storage.createActivityLog({
        userId: request.approverId || request.requesterId,
        action: "request_updated",
        entityType: "request",
        entityId: request.id,
        details: `Updated request: ${request.title} - Status: ${request.status}`,
      });

      res.json(request);
    } catch (error) {
      res.status(500).json({ message: "Failed to update request" });
    }
  });

  // API Configuration routes
  app.get("/api/configurations", async (req, res) => {
    try {
      const configurations = await storage.getApiConfigurations();
      res.json(configurations);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch API configurations" });
    }
  });

  app.post("/api/configurations", async (req, res) => {
    try {
      const configData = insertApiConfigurationSchema.parse(req.body);
      const config = await storage.createApiConfiguration(configData);
      res.status(201).json(config);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid configuration data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create API configuration" });
    }
  });

  app.patch("/api/configurations/:id", async (req, res) => {
    try {
      const updates = req.body;
      const config = await storage.updateApiConfiguration(req.params.id, updates);
      
      if (!config) {
        return res.status(404).json({ message: "Configuration not found" });
      }

      res.json(config);
    } catch (error) {
      res.status(500).json({ message: "Failed to update configuration" });
    }
  });

  app.delete("/api/configurations/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteApiConfiguration(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Configuration not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete configuration" });
    }
  });

  // Activity logs
  app.get("/api/activity-logs", async (req, res) => {
    try {
      const { userId } = req.query;
      
      let logs;
      if (userId) {
        logs = await storage.getActivityLogsByUser(userId as string);
      } else {
        logs = await storage.getActivityLogs();
      }
      
      res.json(logs);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch activity logs" });
    }
  });

  // Mock API integration endpoints
  app.post("/api/integrations/test", async (req, res) => {
    try {
      const { apiId } = req.body;
      const config = await storage.getApiConfiguration(apiId);
      
      if (!config) {
        return res.status(404).json({ message: "API configuration not found" });
      }

      // Mock API test - in real implementation, this would make actual API calls
      const isHealthy = Math.random() > 0.2; // 80% success rate for demo
      
      await storage.updateApiConfiguration(apiId, {
        healthStatus: isHealthy ? "healthy" : "error",
        lastChecked: new Date(),
      });

      res.json({ 
        success: isHealthy, 
        status: isHealthy ? "healthy" : "error",
        message: isHealthy ? "API connection successful" : "API connection failed"
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to test API connection" });
    }
  });

  // NTAO Queue Module routes
  app.get("/api/ntao-queue", async (req, res) => {
    try {
      const queueItems = await storage.getNTAOQueueItems();
      res.json(queueItems);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch NTAO queue items" });
    }
  });

  app.get("/api/ntao-queue/:id", async (req, res) => {
    try {
      const queueItem = await storage.getNTAOQueueItem(req.params.id);
      if (!queueItem) {
        return res.status(404).json({ message: "NTAO queue item not found" });
      }
      res.json(queueItem);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch NTAO queue item" });
    }
  });

  app.post("/api/ntao-queue", checkAnonymousRateLimit, async (req, res) => {
    try {
      // Sanitize and validate with anonymous schema
      const sanitizedData = sanitizeInput(req.body);
      const validatedData = anonymousQueueItemSchema.parse(sanitizedData);
      
      // Check for duplicate offboarding workflows
      const duplicateCheck = await checkOffboardingDuplicates(validatedData.data, 'NTAO', validatedData.workflowId);
      if (duplicateCheck.isDuplicate) {
        return res.status(409).json({ 
          message: duplicateCheck.message || "Duplicate submission detected",
          code: "DUPLICATE_OFFBOARDING"
        });
      }
      
      const queueItemData = {
        ...validatedData,
        requesterId: "anonymous",
        department: "NTAO" as const, // Enforce department for NTAO queue
        status: "pending" as const,
        attempts: 0,
        scheduledFor: validatedData.scheduledFor ? new Date(validatedData.scheduledFor) : null,
      };
      
      const queueItem = await storage.createNTAOQueueItem(queueItemData);
      
      // Return minimal response (no sensitive data)
      res.status(201).json({ 
        id: queueItem.id, 
        status: queueItem.status, 
        message: "Queue item created successfully" 
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid form data", errors: error.errors });
      }
      console.error('NTAO queue creation error:', error);
      res.status(500).json({ message: "Failed to submit form" });
    }
  });

  app.patch("/api/ntao-queue/:id/assign", async (req, res) => {
    try {
      const { assigneeId } = req.body;
      if (!assigneeId) {
        return res.status(400).json({ message: "Assignee ID is required" });
      }
      const queueItem = await storage.assignNTAOQueueItem(req.params.id, assigneeId);
      if (!queueItem) {
        return res.status(404).json({ message: "NTAO queue item not found" });
      }
      res.json(queueItem);
    } catch (error) {
      res.status(500).json({ message: "Failed to assign NTAO queue item" });
    }
  });

  app.patch("/api/ntao-queue/:id/complete", async (req, res) => {
    try {
      const { completedBy } = req.body;
      if (!completedBy) {
        return res.status(400).json({ message: "Completed by user ID is required" });
      }
      const queueItem = await storage.completeNTAOQueueItem(req.params.id, completedBy);
      if (!queueItem) {
        return res.status(404).json({ message: "NTAO queue item not found" });
      }
      res.json(queueItem);
    } catch (error) {
      res.status(500).json({ message: "Failed to complete NTAO queue item" });
    }
  });

  // Assets Queue Module routes
  app.get("/api/assets-queue", async (req, res) => {
    try {
      const queueItems = await storage.getAssetsQueueItems();
      res.json(queueItems);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch Assets queue items" });
    }
  });

  app.get("/api/assets-queue/:id", async (req, res) => {
    try {
      const queueItem = await storage.getAssetsQueueItem(req.params.id);
      if (!queueItem) {
        return res.status(404).json({ message: "Assets queue item not found" });
      }
      res.json(queueItem);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch Assets queue item" });
    }
  });

  app.post("/api/assets-queue", checkAnonymousRateLimit, async (req, res) => {
    try {
      // Sanitize and validate with anonymous schema
      const sanitizedData = sanitizeInput(req.body);
      const validatedData = anonymousQueueItemSchema.parse(sanitizedData);
      
      // Check for duplicate offboarding workflows
      const duplicateCheck = await checkOffboardingDuplicates(validatedData.data, 'ASSETS', validatedData.workflowId);
      if (duplicateCheck.isDuplicate) {
        return res.status(409).json({ 
          message: duplicateCheck.message || "Duplicate submission detected",
          code: "DUPLICATE_OFFBOARDING"
        });
      }
      
      const queueItemData = {
        ...validatedData,
        requesterId: "anonymous",
        department: "ASSETS" as const, // Enforce department for Assets queue
        status: "pending" as const,
        attempts: 0,
        scheduledFor: validatedData.scheduledFor ? new Date(validatedData.scheduledFor) : null,
      };
      
      const queueItem = await storage.createAssetsQueueItem(queueItemData);
      
      // Return minimal response (no sensitive data)
      res.status(201).json({ 
        id: queueItem.id, 
        status: queueItem.status, 
        message: "Queue item created successfully" 
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid form data", errors: error.errors });
      }
      console.error('Assets queue creation error:', error);
      res.status(500).json({ message: "Failed to submit form" });
    }
  });

  app.patch("/api/assets-queue/:id/assign", async (req, res) => {
    try {
      const { assigneeId } = req.body;
      if (!assigneeId) {
        return res.status(400).json({ message: "Assignee ID is required" });
      }
      const queueItem = await storage.assignAssetsQueueItem(req.params.id, assigneeId);
      if (!queueItem) {
        return res.status(404).json({ message: "Assets queue item not found" });
      }
      res.json(queueItem);
    } catch (error) {
      res.status(500).json({ message: "Failed to assign Assets queue item" });
    }
  });

  app.patch("/api/assets-queue/:id/complete", async (req, res) => {
    try {
      const { completedBy } = req.body;
      if (!completedBy) {
        return res.status(400).json({ message: "Completed by user ID is required" });
      }
      const queueItem = await storage.completeAssetsQueueItem(req.params.id, completedBy);
      if (!queueItem) {
        return res.status(404).json({ message: "Assets queue item not found" });
      }
      res.json(queueItem);
    } catch (error) {
      res.status(500).json({ message: "Failed to complete Assets queue item" });
    }
  });

  // Inventory Queue Module routes
  app.get("/api/inventory-queue", async (req, res) => {
    try {
      const queueItems = await storage.getInventoryQueueItems();
      res.json(queueItems);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch Inventory queue items" });
    }
  });

  app.get("/api/inventory-queue/:id", async (req, res) => {
    try {
      const queueItem = await storage.getInventoryQueueItem(req.params.id);
      if (!queueItem) {
        return res.status(404).json({ message: "Inventory queue item not found" });
      }
      res.json(queueItem);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch Inventory queue item" });
    }
  });

  app.post("/api/inventory-queue", checkAnonymousRateLimit, async (req, res) => {
    try {
      // Sanitize and validate with anonymous schema
      const sanitizedData = sanitizeInput(req.body);
      const validatedData = anonymousQueueItemSchema.parse(sanitizedData);
      
      // Check for duplicate offboarding workflows
      const duplicateCheck = await checkOffboardingDuplicates(validatedData.data, 'INVENTORY', validatedData.workflowId);
      if (duplicateCheck.isDuplicate) {
        return res.status(409).json({ 
          message: duplicateCheck.message || "Duplicate submission detected",
          code: "DUPLICATE_OFFBOARDING"
        });
      }
      
      const queueItemData = {
        ...validatedData,
        requesterId: "anonymous",
        department: "INVENTORY" as const, // Enforce department for Inventory queue
        status: "pending" as const,
        attempts: 0,
        scheduledFor: validatedData.scheduledFor ? new Date(validatedData.scheduledFor) : null,
      };
      
      const queueItem = await storage.createInventoryQueueItem(queueItemData);
      
      // Return minimal response (no sensitive data)
      res.status(201).json({ 
        id: queueItem.id, 
        status: queueItem.status, 
        message: "Queue item created successfully" 
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid form data", errors: error.errors });
      }
      console.error('Inventory queue creation error:', error);
      res.status(500).json({ message: "Failed to submit form" });
    }
  });

  app.patch("/api/inventory-queue/:id/assign", async (req, res) => {
    try {
      const { assigneeId } = req.body;
      if (!assigneeId) {
        return res.status(400).json({ message: "Assignee ID is required" });
      }
      const queueItem = await storage.assignInventoryQueueItem(req.params.id, assigneeId);
      if (!queueItem) {
        return res.status(404).json({ message: "Inventory queue item not found" });
      }
      res.json(queueItem);
    } catch (error) {
      res.status(500).json({ message: "Failed to assign Inventory queue item" });
    }
  });

  app.patch("/api/inventory-queue/:id/complete", async (req, res) => {
    try {
      const { completedBy } = req.body;
      if (!completedBy) {
        return res.status(400).json({ message: "Completed by user ID is required" });
      }
      const queueItem = await storage.completeInventoryQueueItem(req.params.id, completedBy);
      if (!queueItem) {
        return res.status(404).json({ message: "Inventory queue item not found" });
      }
      res.json(queueItem);
    } catch (error) {
      res.status(500).json({ message: "Failed to complete Inventory queue item" });
    }
  });

  // Fleet Queue Module routes
  app.get("/api/fleet-queue", async (req, res) => {
    try {
      const queueItems = await storage.getFleetQueueItems();
      res.json(queueItems);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch Fleet queue items" });
    }
  });

  app.get("/api/fleet-queue/:id", async (req, res) => {
    try {
      const queueItem = await storage.getFleetQueueItem(req.params.id);
      if (!queueItem) {
        return res.status(404).json({ message: "Fleet queue item not found" });
      }
      res.json(queueItem);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch Fleet queue item" });
    }
  });

  app.post("/api/fleet-queue", checkAnonymousRateLimit, async (req, res) => {
    try {
      // Sanitize and validate with anonymous schema
      const sanitizedData = sanitizeInput(req.body);
      const validatedData = anonymousQueueItemSchema.parse(sanitizedData);
      
      // Check for duplicate offboarding workflows
      const duplicateCheck = await checkOffboardingDuplicates(validatedData.data, 'FLEET', validatedData.workflowId);
      if (duplicateCheck.isDuplicate) {
        return res.status(409).json({ 
          message: duplicateCheck.message || "Duplicate submission detected",
          code: "DUPLICATE_OFFBOARDING"
        });
      }
      
      const queueItemData = {
        ...validatedData,
        requesterId: "anonymous",
        department: "FLEET" as const, // Enforce department for Fleet queue
        status: "pending" as const,
        attempts: 0,
        scheduledFor: validatedData.scheduledFor ? new Date(validatedData.scheduledFor) : null,
      };
      
      const queueItem = await storage.createFleetQueueItem(queueItemData);
      
      // Return minimal response (no sensitive data)
      res.status(201).json({ 
        id: queueItem.id, 
        status: queueItem.status, 
        message: "Queue item created successfully" 
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid form data", errors: error.errors });
      }
      console.error('Fleet queue creation error:', error);
      res.status(500).json({ message: "Failed to submit form" });
    }
  });

  app.patch("/api/fleet-queue/:id/assign", async (req, res) => {
    try {
      const { assigneeId } = req.body;
      if (!assigneeId) {
        return res.status(400).json({ message: "Assignee ID is required" });
      }
      const queueItem = await storage.assignFleetQueueItem(req.params.id, assigneeId);
      if (!queueItem) {
        return res.status(404).json({ message: "Fleet queue item not found" });
      }
      res.json(queueItem);
    } catch (error) {
      res.status(500).json({ message: "Failed to assign Fleet queue item" });
    }
  });

  app.patch("/api/fleet-queue/:id/complete", async (req, res) => {
    try {
      const { completedBy } = req.body;
      if (!completedBy) {
        return res.status(400).json({ message: "Completed by user ID is required" });
      }
      const queueItem = await storage.completeFleetQueueItem(req.params.id, completedBy);
      if (!queueItem) {
        return res.status(404).json({ message: "Fleet queue item not found" });
      }
      res.json(queueItem);
    } catch (error) {
      res.status(500).json({ message: "Failed to complete Fleet queue item" });
    }
  });


  // General task endpoint - searches across all queues for a task by ID
  app.get("/api/tasks/:id", requireAuth, async (req, res) => {
    try {
      const taskId = req.params.id;
      
      // Try to find the task in each queue module
      const modules: QueueModule[] = ["ntao", "assets", "inventory", "fleet"];
      
      for (const module of modules) {
        const queueItem = await storage.getUnifiedQueueItem(module, taskId);
        if (queueItem) {
          // Add module information to the response
          res.json({ ...queueItem, module });
          return;
        }
      }
      
      // Task not found in any queue
      res.status(404).json({ message: "Task not found" });
    } catch (error) {
      console.error('Task fetch error:', error);
      res.status(500).json({ message: "Failed to fetch task" });
    }
  });

  // Unified queue creation endpoint (anonymous-accessible with rate limiting)
  app.post("/api/queue", checkAnonymousRateLimit, async (req, res) => {
    try {
      const { module, ...queueItemData } = req.body;
      
      // Sanitize input data
      const sanitizedData = sanitizeInput(queueItemData);
      
      // Validate with anonymous schema (field whitelisting)
      const validatedData = anonymousQueueItemSchema.parse(sanitizedData);
      
      // Convert to full queue item format
      const fullQueueItemData = {
        ...validatedData,
        requesterId: "anonymous", // Handle anonymous submissions
        status: "pending" as const,
        attempts: 0,
        // Convert scheduledFor string to Date if present
        scheduledFor: validatedData.scheduledFor ? new Date(validatedData.scheduledFor) : undefined,
      };
      
      // Determine target module
      let targetModule: string;
      
      if (module) {
        // Validate provided module
        const validModules = ['fleet', 'ntao', 'assets', 'inventory'];
        if (!validModules.includes(module)) {
          return res.status(400).json({ 
            message: `Invalid module: ${module}. Valid modules: ${validModules.join(', ')}` 
          });
        }
        targetModule = module;
      } else {
        // Infer module from workflowType
        const workflowTypeToModuleMap: Record<string, string> = {
          'vehicle_assignment': 'fleet',
          'byov_assignment': 'fleet',
          'onboarding': 'ntao',
          'offboarding': 'ntao',
          'decommission': 'assets',
          'storage_request': 'assets'
        };
        
        targetModule = workflowTypeToModuleMap[fullQueueItemData.workflowType];
        
        if (!targetModule) {
          return res.status(400).json({ 
            message: `Unable to determine target module. Please provide a module parameter or use a supported workflowType. Supported workflowTypes: ${Object.keys(workflowTypeToModuleMap).join(', ')}` 
          });
        }
      }
      
      // Set department based on module
      const moduleToDepartmentMap: Record<string, string> = {
        'fleet': 'FLEET',
        'ntao': 'NTAO',
        'assets': 'ASSETS',
        'inventory': 'INVENTORY'
      };
      
      // Create the final queue item data with department
      const queueItemDataWithDepartment = {
        ...fullQueueItemData,
        department: moduleToDepartmentMap[targetModule]
      };
      
      // Create queue item in the appropriate module
      let queueItem;
      switch (targetModule) {
        case 'fleet':
          queueItem = await storage.createFleetQueueItem(queueItemDataWithDepartment);
          break;
        case 'ntao':
          queueItem = await storage.createNTAOQueueItem(queueItemDataWithDepartment);
          break;
        case 'assets':
          queueItem = await storage.createAssetsQueueItem(queueItemDataWithDepartment);
          break;
        case 'inventory':
          queueItem = await storage.createInventoryQueueItem(queueItemDataWithDepartment);
          break;
        default:
          return res.status(400).json({ message: "Unsupported module" });
      }
      
      // Return minimal response (no sensitive data)
      res.status(201).json({ 
        id: queueItem.id, 
        status: queueItem.status, 
        module: targetModule,
        message: "Queue item created successfully" 
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid queue item data", errors: error.errors });
      }
      console.error('Error creating queue item:', error);
      res.status(500).json({ message: "Failed to create queue item" });
    }
  });

  // Common queue operations (cancel works across all modules)
  app.patch("/api/queue/:id/cancel", async (req, res) => {
    try {
      const { reason } = req.body;
      if (!reason) {
        return res.status(400).json({ message: "Cancellation reason is required" });
      }

      const queueItem = await storage.cancelQueueItem(req.params.id, reason);
      
      if (!queueItem) {
        return res.status(404).json({ message: "Queue item not found" });
      }

      res.json(queueItem);
    } catch (error) {
      res.status(500).json({ message: "Failed to cancel queue item" });
    }
  });

  // Unified Queue Aggregator API routes for multi-queue management
  app.get("/api/queues", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser) {
        return res.status(401).json({ message: "Invalid user" });
      }
      
      const modulesParam = req.query.modules as string;
      const status = req.query.status as string;
      
      if (!modulesParam) {
        return res.status(400).json({ message: "modules parameter is required" });
      }
      
      const requestedModules = modulesParam.split(',').map(m => m.trim()) as any[];
      
      // Validate modules
      const validModules = ['ntao', 'assets', 'inventory', 'fleet'];
      const invalidModules = requestedModules.filter(m => !validModules.includes(m));
      if (invalidModules.length > 0) {
        return res.status(400).json({ 
          message: `Invalid modules: ${invalidModules.join(', ')}. Valid modules: ${validModules.join(', ')}` 
        });
      }
      
      // Enforce access control using new departmentAccess system
      const accessibleModules = getAccessibleQueueModules(currentUser);
      if (accessibleModules.length === 0) {
        return res.status(403).json({ message: "No queue access permissions" });
      }

      const allowedModules = requestedModules.filter(module => 
        accessibleModules.includes(module as QueueModule)
      );
      
      if (allowedModules.length === 0) {
        return res.status(403).json({ message: "Access denied to requested queues" });
      }
      
      const items = await storage.getUnifiedQueueItems(allowedModules as QueueModule[], status);
      res.json(items);
    } catch (error) {
      console.error('Error fetching unified queue items:', error);
      res.status(500).json({ message: "Failed to fetch queue items" });
    }
  });
  
  app.get("/api/queues/stats", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser) {
        return res.status(401).json({ message: "Invalid user" });
      }
      
      const modulesParam = req.query.modules as string;
      
      if (!modulesParam) {
        return res.status(400).json({ message: "modules parameter is required" });
      }
      
      const requestedModules = modulesParam.split(',').map(m => m.trim()) as any[];
      
      // Validate modules
      const validModules = ['ntao', 'assets', 'inventory', 'fleet'];
      const invalidModules = requestedModules.filter(m => !validModules.includes(m));
      if (invalidModules.length > 0) {
        return res.status(400).json({ 
          message: `Invalid modules: ${invalidModules.join(', ')}. Valid modules: ${validModules.join(', ')}` 
        });
      }
      
      // Enforce access control using new departmentAccess system
      const accessibleModules = getAccessibleQueueModules(currentUser);
      if (accessibleModules.length === 0) {
        return res.status(403).json({ message: "No queue access permissions" });
      }

      const allowedModules = requestedModules.filter(module => 
        accessibleModules.includes(module as QueueModule)
      );
      
      if (allowedModules.length === 0) {
        return res.status(403).json({ message: "Access denied to requested queues" });
      }
      
      const stats = await storage.getUnifiedQueueStats(allowedModules as QueueModule[]);
      res.json(stats);
    } catch (error) {
      console.error('Error fetching unified queue stats:', error);
      res.status(500).json({ message: "Failed to fetch queue stats" });
    }
  });

  // Productivity Dashboard API (Superadmin only)
  app.get("/api/productivity-stats", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || currentUser.role !== 'superadmin') {
        return res.status(403).json({ message: "Access denied. Productivity dashboard requires superadmin role." });
      }

      // Get today's date range
      const today = new Date();
      const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const endOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);

      // Initialize department stats
      const departmentStats = {
        ntao: {
          name: "NTAO",
          description: "Network Technical Assistance Office",
          completedToday: 0,
          avgResponseTime: 0,
          activeStaff: 0
        },
        assets: {
          name: "Assets Management", 
          description: "Asset Tracking & Management",
          completedToday: 0,
          avgResponseTime: 0,
          activeStaff: 0
        },
        inventory: {
          name: "Inventory Control",
          description: "Stock & Supply Management", 
          completedToday: 0,
          avgResponseTime: 0,
          activeStaff: 0
        },
        fleet: {
          name: "Fleet Management",
          description: "Vehicle Operations & Maintenance",
          completedToday: 0,
          avgResponseTime: 0,
          activeStaff: 0
        }
      };

      // Calculate stats for each department
      for (const module of ['ntao', 'assets', 'inventory', 'fleet'] as QueueModule[]) {
        let queueItems: any[] = [];
        
        try {
          switch (module) {
            case 'ntao':
              queueItems = await storage.getNTAOQueueItems();
              break;
            case 'assets':
              queueItems = await storage.getAssetsQueueItems();
              break;
            case 'inventory':
              queueItems = await storage.getInventoryQueueItems();
              break;
            case 'fleet':
              queueItems = await storage.getFleetQueueItems();
              break;
          }
        } catch (error) {
          console.error(`Error fetching ${module} queue items:`, error);
          continue;
        }

        // Calculate completed today
        const completedToday = queueItems.filter(item => {
          if (item.status === 'completed' && item.completedAt) {
            const completedDate = new Date(item.completedAt);
            return completedDate >= startOfToday && completedDate < endOfToday;
          }
          return false;
        }).length;

        // Calculate average response time (in hours) for completed items in last 30 days
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const recentCompletedItems = queueItems.filter(item => {
          if (item.status === 'completed' && item.completedAt && item.createdAt) {
            const completedDate = new Date(item.completedAt);
            return completedDate >= thirtyDaysAgo;
          }
          return false;
        });

        let avgResponseTime = 0;
        if (recentCompletedItems.length > 0) {
          const totalResponseTime = recentCompletedItems.reduce((sum, item) => {
            const created = new Date(item.createdAt).getTime();
            const completed = new Date(item.completedAt).getTime();
            return sum + (completed - created);
          }, 0);
          
          // Convert from milliseconds to hours and round to 1 decimal place
          avgResponseTime = Math.round((totalResponseTime / recentCompletedItems.length) / (1000 * 60 * 60) * 10) / 10;
        }

        // Calculate active staff (users assigned to in_progress items)
        const inProgressItems = queueItems.filter(item => item.status === 'in_progress');
        const activeStaffSet = new Set();
        inProgressItems.forEach(item => {
          if (item.assignedTo) {
            activeStaffSet.add(item.assignedTo);
          }
        });
        const activeStaff = activeStaffSet.size;

        // Update department stats
        departmentStats[module].completedToday = completedToday;
        departmentStats[module].avgResponseTime = avgResponseTime;
        departmentStats[module].activeStaff = activeStaff;
      }

      res.json(departmentStats);
    } catch (error) {
      console.error('Error fetching productivity stats:', error);
      res.status(500).json({ message: "Failed to fetch productivity statistics" });
    }
  });

  // Productivity Dashboard Export API (Superadmin only)
  app.get("/api/productivity-export/:department", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || currentUser.role !== 'superadmin') {
        return res.status(403).json({ message: "Access denied. Export requires superadmin role." });
      }

      const { department } = req.params;
      const validDepartments = ['ntao', 'assets', 'inventory', 'fleet'];
      
      if (!validDepartments.includes(department)) {
        return res.status(400).json({ 
          message: `Invalid department: ${department}. Valid departments: ${validDepartments.join(', ')}` 
        });
      }

      // Fetch queue items for the specified department
      let queueItems: any[] = [];
      try {
        switch (department) {
          case 'ntao':
            queueItems = await storage.getNTAOQueueItems();
            break;
          case 'assets':
            queueItems = await storage.getAssetsQueueItems();
            break;
          case 'inventory':
            queueItems = await storage.getInventoryQueueItems();
            break;
          case 'fleet':
            queueItems = await storage.getFleetQueueItems();
            break;
        }
      } catch (error) {
        console.error(`Error fetching ${department} queue items for export:`, error);
        return res.status(500).json({ message: "Failed to fetch queue items" });
      }

      // Helper function to safely escape CSV values
      const escapeCsvValue = (value: any): string => {
        if (value === null || value === undefined) {
          return '';
        }
        const str = String(value);
        // If the value contains comma, quotes, or newlines, wrap in quotes and escape internal quotes
        if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      // Helper function to format date
      const formatDate = (dateString: string | null): string => {
        if (!dateString) return '';
        try {
          return new Date(dateString).toLocaleString('en-US', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          });
        } catch {
          return dateString;
        }
      };

      // Helper function to calculate response time
      const calculateResponseTime = (createdAt: string, completedAt: string | null): string => {
        if (!completedAt || !createdAt) return '';
        try {
          const created = new Date(createdAt).getTime();
          const completed = new Date(completedAt).getTime();
          const diffMs = completed - created;
          const hours = Math.round(diffMs / (1000 * 60 * 60) * 10) / 10;
          
          if (hours < 1) {
            const minutes = Math.round(diffMs / (1000 * 60));
            return `${minutes} min`;
          } else if (hours < 24) {
            return `${hours} hrs`;
          } else {
            const days = Math.round(hours / 24 * 10) / 10;
            return `${days} days`;
          }
        } catch {
          return '';
        }
      };

      // Helper function to extract employee name/ID from data
      const extractEmployeeInfo = (data: string | null): string => {
        if (!data) return '';
        try {
          const parsedData = JSON.parse(data);
          
          // Try different paths for employee information
          const paths = [
            // Employee object paths
            parsedData?.employee?.fullName,
            parsedData?.employee?.firstName && parsedData?.employee?.lastName 
              ? `${parsedData.employee.firstName} ${parsedData.employee.lastName}`
              : null,
            parsedData?.employee?.employeeId,
            parsedData?.employee?.racfId,
            parsedData?.employee?.enterpriseId,
            
            // Tech info paths
            parsedData?.techInfo?.fullName,
            parsedData?.techInfo?.firstName && parsedData?.techInfo?.lastName 
              ? `${parsedData.techInfo.firstName} ${parsedData.techInfo.lastName}`
              : null,
            parsedData?.techInfo?.employeeId,
            parsedData?.techInfo?.ldap,
            parsedData?.techInfo?.email,
            
            // Direct paths
            parsedData?.techFirstName && parsedData?.techLastName 
              ? `${parsedData.techFirstName} ${parsedData.techLastName}`
              : null,
            parsedData?.employeeId,
            parsedData?.techRacfId,
            parsedData?.ldap
          ].filter(Boolean);
          
          return paths[0] || '';
        } catch {
          return '';
        }
      };

      // Generate CSV headers
      const headers = [
        'Request ID',
        'Title', 
        'Status',
        'Created Date',
        'Assigned To',
        'Completed Date',
        'Response Time',
        'Employee Name/ID',
        'Workflow Type',
        'Priority',
        'Department',
        'Notes'
      ];

      // Generate CSV rows
      const csvRows = [
        headers.join(','),
        ...queueItems.map(item => [
          escapeCsvValue(item.id),
          escapeCsvValue(item.title),
          escapeCsvValue(item.status),
          escapeCsvValue(formatDate(item.createdAt)),
          escapeCsvValue(item.assignedTo || ''),
          escapeCsvValue(formatDate(item.completedAt)),
          escapeCsvValue(calculateResponseTime(item.createdAt, item.completedAt)),
          escapeCsvValue(extractEmployeeInfo(item.data)),
          escapeCsvValue(item.workflowType),
          escapeCsvValue(item.priority),
          escapeCsvValue(item.department || department.toUpperCase()),
          escapeCsvValue(item.notes || '')
        ].join(','))
      ];

      const csvContent = csvRows.join('\n');
      const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
      const filename = `${department.toUpperCase()}_queue_export_${timestamp}.csv`;

      // Set CSV download headers
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Cache-Control', 'no-cache');
      
      res.send(csvContent);
    } catch (error) {
      console.error('Error exporting productivity data:', error);
      res.status(500).json({ message: "Failed to export data" });
    }
  });
  
  app.patch("/api/queues/:module/:id/assign", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser) {
        return res.status(401).json({ message: "Invalid user" });
      }
      
      const { module, id } = req.params;
      
      // Validate request body
      const validation = assignQueueItemSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ 
          message: "Invalid request data", 
          errors: validation.error.errors 
        });
      }
      
      const { assigneeId } = validation.data;
      
      const validModules = ['ntao', 'assets', 'inventory', 'fleet'];
      if (!validModules.includes(module)) {
        return res.status(400).json({ 
          message: `Invalid module: ${module}. Valid modules: ${validModules.join(', ')}` 
        });
      }
      
      // Enforce access control using new departmentAccess system
      if (!hasQueueAccess(currentUser, module as QueueModule)) {
        return res.status(403).json({ message: "Access denied to this queue" });
      }
      
      const updatedItem = await storage.assignUnifiedQueueItem(module as any, id, assigneeId);
      if (!updatedItem) {
        return res.status(404).json({ message: "Queue item not found" });
      }
      
      res.json({ ...updatedItem, module });
    } catch (error) {
      console.error('Error assigning unified queue item:', error);
      res.status(500).json({ message: "Failed to assign queue item" });
    }
  });

  // Start work on unified queue item
  app.patch("/api/queues/:module/:id/start-work", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser) {
        return res.status(401).json({ message: "Invalid user" });
      }
      
      const { module, id } = req.params;
      
      const validModules = ['ntao', 'assets', 'inventory', 'fleet'];
      if (!validModules.includes(module)) {
        return res.status(400).json({ 
          message: `Invalid module: ${module}. Valid modules: ${validModules.join(', ')}` 
        });
      }
      
      // Enforce access control using new departmentAccess system
      if (!hasQueueAccess(currentUser, module as QueueModule)) {
        return res.status(403).json({ message: "Access denied to this queue" });
      }
      
      const updatedItem = await storage.startWorkUnifiedQueueItem(module as any, id, currentUser.id);
      if (!updatedItem) {
        return res.status(404).json({ message: "Queue item not found or not eligible to start work" });
      }
      
      res.json({ ...updatedItem, module });
    } catch (error) {
      console.error('Error starting work on unified queue item:', error);
      res.status(500).json({ message: "Failed to start work on queue item" });
    }
  });
  
  app.patch("/api/queues/:module/:id/complete", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser) {
        return res.status(401).json({ message: "Invalid user" });
      }
      
      const { module, id } = req.params;
      
      // Validate request body with enhanced schema to support template data
      const validation = enhancedCompleteQueueItemSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ 
          message: "Invalid request data", 
          errors: validation.error.errors 
        });
      }
      
      const { completedBy, finalNotes, decisionType, requiresReview, adminNotes, finalChecklistState, templateId } = validation.data;
      
      const validModules = ['ntao', 'assets', 'inventory', 'fleet'];
      if (!validModules.includes(module)) {
        return res.status(400).json({ 
          message: `Invalid module: ${module}. Valid modules: ${validModules.join(', ')}` 
        });
      }
      
      // Enforce access control using new departmentAccess system
      if (!hasQueueAccess(currentUser, module as QueueModule)) {
        return res.status(403).json({ message: "Access denied to this queue" });
      }
      
      // Update the queue item with completion data including decision details
      const updatedItem = await storage.completeUnifiedQueueItem(module as any, id, completedBy);
      if (!updatedItem) {
        return res.status(404).json({ message: "Queue item not found" });
      }

      // Save the additional completion metadata including template data
      if (finalNotes || decisionType || adminNotes || finalChecklistState || templateId) {
        const currentItem = await storage.getUnifiedQueueItem(module as any, id);
        if (currentItem) {
          const existingData = currentItem.data ? JSON.parse(currentItem.data) : {};
          const completionData = {
            ...existingData,
            completion: {
              finalNotes,
              decisionType,
              requiresReview,
              adminNotes,
              completedAt: new Date().toISOString(),
              completedBy,
              // Template completion data
              finalChecklistState,
              templateId
            }
          };

          await storage.updateUnifiedQueueItem(module as any, id, {
            data: JSON.stringify(completionData),
            notes: finalNotes
          });
        }
      }
      
      res.json({ ...updatedItem, module });
    } catch (error) {
      console.error('Error completing unified queue item:', error);
      res.status(500).json({ message: "Failed to complete queue item" });
    }
  });

  // Save progress on unified queue item
  app.patch("/api/queues/:module/:id/save-progress", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser) {
        return res.status(401).json({ message: "Invalid user" });
      }
      
      const { module, id } = req.params;
      
      // Validate request body
      const validation = saveProgressSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ 
          message: "Invalid request data", 
          errors: validation.error.errors 
        });
      }
      
      const { notes, adminNotes, assignedTo, lastWorkedBy, workInProgress } = validation.data;
      
      const validModules = ['ntao', 'assets', 'inventory', 'fleet'];
      if (!validModules.includes(module)) {
        return res.status(400).json({ 
          message: `Invalid module: ${module}. Valid modules: ${validModules.join(', ')}` 
        });
      }
      
      // Enforce access control using new departmentAccess system
      if (!hasQueueAccess(currentUser, module as QueueModule)) {
        return res.status(403).json({ message: "Access denied to this queue" });
      }
      
      // Get current item and update progress
      const currentItem = await storage.getUnifiedQueueItem(module as any, id);
      if (!currentItem) {
        return res.status(404).json({ message: "Queue item not found" });
      }

      // Parse existing data and add progress information
      const existingData = currentItem.data ? JSON.parse(currentItem.data) : {};
      const progressData = {
        ...existingData,
        progress: {
          lastWorkedBy,
          lastWorkedAt: new Date().toISOString(),
          workInProgress: workInProgress || false,
          adminNotes
        }
      };

      // Update the item with progress
      const updateData: any = {
        updatedAt: new Date(),
        data: JSON.stringify(progressData)
      };

      if (notes) {
        updateData.notes = notes;
      }
      
      if (assignedTo) {
        updateData.assignedTo = assignedTo;
      }

      const updatedItem = await storage.updateUnifiedQueueItem(module as any, id, updateData);
      if (!updatedItem) {
        return res.status(404).json({ message: "Failed to update queue item" });
      }
      
      res.json({ ...updatedItem, module });
    } catch (error) {
      console.error('Error saving progress on unified queue item:', error);
      res.status(500).json({ message: "Failed to save progress on queue item" });
    }
  });

  // Storage Spots API routes
  app.get("/api/storage-spots", async (req, res) => {
    try {
      const { status, state } = req.query;
      
      let storageSpots;
      if (status) {
        storageSpots = await storage.getStorageSpotsByStatus(status as string);
      } else if (state) {
        storageSpots = await storage.getStorageSpotsByState(state as string);
      } else {
        storageSpots = await storage.getStorageSpots();
      }
      
      res.json(storageSpots);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch storage spots" });
    }
  });

  app.get("/api/storage-spots/:id", async (req, res) => {
    try {
      const storageSpot = await storage.getStorageSpot(req.params.id);
      if (!storageSpot) {
        return res.status(404).json({ message: "Storage spot not found" });
      }
      res.json(storageSpot);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch storage spot" });
    }
  });

  app.post("/api/storage-spots", checkAnonymousRateLimit, async (req, res) => {
    try {
      // Sanitize and validate with anonymous schema
      const sanitizedData = sanitizeInput(req.body);
      const validatedData = anonymousStorageSpotSchema.parse(sanitizedData);
      
      // Convert to full storage spot format with safe defaults
      const storageSpotData = {
        ...validatedData,
        status: "open" as const,
        availableSpots: 0, // Default value, admin will update
        totalCapacity: 1, // Minimum value, admin will update
        securityLevel: "standard" as const,
      };
      
      const storageSpot = await storage.createStorageSpot(storageSpotData);
      
      // Log activity for anonymous submission
      await storage.createActivityLog({
        userId: "anonymous",
        action: "storage_spot_created",
        entityType: "storage_spot",
        entityId: storageSpot.id,
        details: `Anonymous storage spot request: ${storageSpot.name}`,
      });

      // Return minimal response (no sensitive data)
      res.status(201).json({ 
        id: storageSpot.id, 
        name: storageSpot.name,
        status: storageSpot.status,
        message: "Storage spot request submitted successfully" 
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid storage spot data", errors: error.errors });
      }
      console.error('Storage spot creation error:', error);
      res.status(500).json({ message: "Failed to submit storage spot request" });
    }
  });

  app.patch("/api/storage-spots/:id", async (req, res) => {
    try {
      const updates = req.body;
      const storageSpot = await storage.updateStorageSpot(req.params.id, updates);
      
      if (!storageSpot) {
        return res.status(404).json({ message: "Storage spot not found" });
      }

      // Log activity
      await storage.createActivityLog({
        userId: "system", // TODO: Get from authenticated user
        action: "storage_spot_updated",
        entityType: "storage_spot",
        entityId: storageSpot.id,
        details: `Updated storage spot: ${storageSpot.name}`,
      });

      res.json(storageSpot);
    } catch (error) {
      res.status(500).json({ message: "Failed to update storage spot" });
    }
  });

  app.delete("/api/storage-spots/:id", async (req, res) => {
    try {
      const storageSpot = await storage.getStorageSpot(req.params.id);
      if (!storageSpot) {
        return res.status(404).json({ message: "Storage spot not found" });
      }

      const deleted = await storage.deleteStorageSpot(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Storage spot not found" });
      }

      // Log activity
      await storage.createActivityLog({
        userId: "system", // TODO: Get from authenticated user
        action: "storage_spot_deleted",
        entityType: "storage_spot",
        entityId: req.params.id,
        details: `Deleted storage spot: ${storageSpot.name}`,
      });

      res.json({ message: "Storage spot deleted successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete storage spot" });
    }
  });

  // Vehicle API routes
  app.get("/api/vehicles", async (req, res) => {
    try {
      const { status, state, branding } = req.query;
      
      let vehicles;
      if (status) {
        vehicles = await storage.getVehiclesByStatus(status as string);
      } else if (state) {
        vehicles = await storage.getVehiclesByState(state as string);
      } else if (branding) {
        vehicles = await storage.getVehiclesByBranding(branding as string);
      } else {
        vehicles = await storage.getVehicles();
      }
      
      res.json(vehicles);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch vehicles" });
    }
  });

  app.get("/api/vehicles/:id", async (req, res) => {
    try {
      const vehicle = await storage.getVehicle(req.params.id);
      if (!vehicle) {
        return res.status(404).json({ message: "Vehicle not found" });
      }
      res.json(vehicle);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch vehicle" });
    }
  });

  app.post("/api/vehicles", checkAnonymousRateLimit, async (req, res) => {
    try {
      // Sanitize and validate with anonymous schema
      const sanitizedData = sanitizeInput(req.body);
      const validatedData = anonymousVehicleSchema.parse(sanitizedData);
      
      // Convert to full vehicle format with safe defaults
      const vehicleData = {
        ...validatedData,
        status: "available" as const,
      };
      
      const vehicle = await storage.createVehicle(vehicleData);
      
      // Log activity for anonymous submission
      await storage.createActivityLog({
        userId: "anonymous",
        action: "vehicle_created",
        entityType: "vehicle",
        entityId: vehicle.id,
        details: `Anonymous vehicle submission: ${vehicle.modelYear} ${vehicle.makeName} ${vehicle.modelName} (VIN: ${vehicle.vin})`,
      });

      // Return minimal response (no sensitive data)
      res.status(201).json({ 
        id: vehicle.id, 
        vin: vehicle.vin,
        status: vehicle.status,
        message: "Vehicle submitted successfully" 
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid vehicle data", errors: error.errors });
      }
      console.error('Vehicle creation error:', error);
      res.status(500).json({ message: "Failed to submit vehicle" });
    }
  });

  // Seed endpoint to populate database with fleet data
  app.post("/api/vehicles/seed", async (req, res) => {
    try {
      // Convert activeVehicles from fleetData to insertVehicle format
      const vehiclesToInsert = activeVehicles.map(fleetVehicle => ({
        vin: fleetVehicle.vin,
        vehicleNumber: fleetVehicle.vehicleNumber,
        modelYear: fleetVehicle.modelYear,
        makeName: fleetVehicle.makeName,
        modelName: fleetVehicle.modelName,
        color: fleetVehicle.color,
        licensePlate: fleetVehicle.licensePlate,
        licenseState: fleetVehicle.licenseState,
        deliveryDate: fleetVehicle.deliveryDate || null,
        outOfServiceDate: fleetVehicle.outOfServiceDate || null,
        saleDate: fleetVehicle.saleDate || null,
        registrationRenewalDate: fleetVehicle.regRenewalDate || null,
        odometerDelivery: fleetVehicle.odometerDelivery,
        branding: fleetVehicle.branding,
        interior: fleetVehicle.interior,
        tuneStatus: fleetVehicle.tuneStatus,
        region: fleetVehicle.region,
        district: fleetVehicle.district,
        deliveryAddress: fleetVehicle.deliveryAddress,
        city: fleetVehicle.city,
        state: fleetVehicle.state,
        zip: fleetVehicle.zip,
        mis: fleetVehicle.mis,
        remainingBookValue: fleetVehicle.remainingBookValue ? fleetVehicle.remainingBookValue.toString() : null,
        leaseEndDate: fleetVehicle.leaseEndDate || null,
        status: "available", // Default status
      }));

      const createdVehicles = await storage.createVehicles(vehiclesToInsert);
      
      // Log activity
      await storage.createActivityLog({
        userId: "system", // TODO: Get from authenticated user
        action: "vehicles_seeded",
        entityType: "vehicle",
        entityId: "bulk",
        details: `Seeded ${createdVehicles.length} vehicles from fleet data`,
      });

      res.status(201).json({
        message: `Successfully seeded ${createdVehicles.length} vehicles`,
        count: createdVehicles.length,
        vehicles: createdVehicles
      });
    } catch (error) {
      console.error('Error seeding vehicles:', error);
      res.status(500).json({ message: "Failed to seed vehicles", error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.put("/api/vehicles/:id", async (req, res) => {
    try {
      const existingVehicle = await storage.getVehicle(req.params.id);
      if (!existingVehicle) {
        return res.status(404).json({ message: "Vehicle not found" });
      }

      const updates = insertVehicleSchema.partial().parse(req.body);
      const updatedVehicle = await storage.updateVehicle(req.params.id, updates);
      
      if (!updatedVehicle) {
        return res.status(404).json({ message: "Vehicle not found" });
      }

      // Log activity
      await storage.createActivityLog({
        userId: "system", // TODO: Get from authenticated user
        action: "vehicle_updated",
        entityType: "vehicle",
        entityId: req.params.id,
        details: `Updated vehicle: ${updatedVehicle.modelYear} ${updatedVehicle.makeName} ${updatedVehicle.modelName}`,
      });

      res.json(updatedVehicle);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid vehicle data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update vehicle" });
    }
  });

  app.delete("/api/vehicles/:id", async (req, res) => {
    try {
      const vehicle = await storage.getVehicle(req.params.id);
      if (!vehicle) {
        return res.status(404).json({ message: "Vehicle not found" });
      }

      const deleted = await storage.deleteVehicle(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Vehicle not found" });
      }

      // Log activity
      await storage.createActivityLog({
        userId: "system", // TODO: Get from authenticated user
        action: "vehicle_deleted",
        entityType: "vehicle",
        entityId: req.params.id,
        details: `Deleted vehicle: ${vehicle.modelYear} ${vehicle.makeName} ${vehicle.modelName} (VIN: ${vehicle.vin})`,
      });

      res.json({ message: "Vehicle deleted successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete vehicle" });
    }
  });

  // Email notification endpoint for credit card deactivation
  app.post("/api/send-deactivation-email", async (req, res) => {
    try {
      const { employeeName, employeeId, racfId, lastDayWorked, reason } = req.body;
      
      // Validate required fields
      if (!employeeName || !employeeId || !racfId || !lastDayWorked || !reason) {
        return res.status(400).json({ message: "Missing required employee information" });
      }

      const emailParams = createCreditCardDeactivationEmail({
        name: employeeName,
        employeeId: employeeId,
        racfId: racfId,
        lastDayWorked: lastDayWorked,
        reason: reason
      });

      const emailSent = await sendEmail(emailParams);
      
      if (emailSent) {
        res.json({ message: "Credit card deactivation notification logged (no email service configured)", recipient: "onecardhelpdesk@transformco.com" });
      } else {
        res.status(500).json({ message: "Failed to log credit card deactivation notification" });
      }
    } catch (error) {
      console.error('Error in send-deactivation-email endpoint:', error);
      res.status(500).json({ message: "Failed to process credit card deactivation notification" });
    }
  });

  // Sears Drive Program Enrollment submission endpoint
  app.post("/api/sears-drive-enrollment", upload.any(), async (req, res) => {
    try {
      console.log('DEBUG - Raw request body:', req.body);
      console.log('DEBUG - Form data keys:', Object.keys(req.body));
      console.log('DEBUG - Files received:', (req as any).files?.map((f: any) => f.fieldname));
      
      // Parse industry from JSON string if needed
      let parsedBody = { ...req.body };
      if (typeof parsedBody.industry === 'string' && parsedBody.industry.startsWith('[')) {
        try {
          parsedBody.industry = JSON.parse(parsedBody.industry);
        } catch (e) {
          // If parsing fails, treat as single string in array
          parsedBody.industry = [parsedBody.industry];
        }
      }
      
      console.log('DEBUG - Parsed body:', parsedBody);

      // Validate form data
      const formSchema = z.object({
        districtNumber: z.string(),
        currentTruckNumber: z.string(),
        techFirstName: z.string(),
        techLastName: z.string(),
        ldap: z.string(),
        techEmail: z.string().email(),
        referredBy: z.string(),
        city: z.string(),
        state: z.string(),
        industry: z.array(z.string()).min(1, "At least one industry must be selected"),
      });

      const formData = formSchema.parse(parsedBody);
      
      // Check for duplicate BYOV enrollment submissions
      const duplicateCheck = await checkByovEnrollmentDuplicates(formData);
      if (duplicateCheck.isDuplicate) {
        return res.status(409).json({ 
          message: duplicateCheck.message || "Duplicate BYOV enrollment detected",
          code: "DUPLICATE_BYOV_ENROLLMENT"
        });
      }
      const files = (req as any).files || [];

      // Required file types
      const requiredFiles = [
        'vehicleFront',
        'vehicleBack', 
        'vehicleLeft',
        'vehicleRight',
        'vinNumber',
        'insuranceCard',
        'registration'
      ];

      // Check if all required files are present
      const uploadedFileNames = files.map((file: any) => file.fieldname);
      const missingFiles = requiredFiles.filter(name => !uploadedFileNames.includes(name));
      
      if (missingFiles.length > 0) {
        return res.status(400).json({ 
          message: `Missing required files: ${missingFiles.join(', ')}` 
        });
      }

      // TODO: Store files in object storage when available
      // For now, we'll just log the submission
      console.log('Sears Drive Program Enrollment Submitted:', {
        ...formData,
        filesUploaded: files.map((f: any) => ({ 
          name: f.fieldname, 
          size: f.size, 
          mimetype: f.mimetype 
        }))
      });

      // Store the enrollment data
      const enrollmentId = `sears-drive-${Date.now()}`;
      
      // Create multiple specific tasks across FLEET and NTAO departments for BYOV enrollment
      const createdTasks = [];
      const techFullName = `${formData.techFirstName} ${formData.techLastName}`;
      const location = `${formData.city}, ${formData.state}`;
      const workflowId = `byov-${enrollmentId}`;
      
      // Common enrollment data for all tasks
      const enrollmentData = {
        enrollmentId,
        submissionTimestamp: new Date().toISOString(),
        techInfo: {
          firstName: formData.techFirstName,
          lastName: formData.techLastName,
          email: formData.techEmail,
          ldap: formData.ldap,
          currentTruckNumber: formData.currentTruckNumber,
          districtNumber: formData.districtNumber,
          referredBy: formData.referredBy
        },
        location: {
          city: formData.city,
          state: formData.state
        },
        industry: formData.industry,
        filesSubmitted: files.map((f: any) => ({ 
          name: f.fieldname, 
          size: f.size, 
          mimetype: f.mimetype 
        }))
      };

      try {
        // FLEET Task 1: Assign new van
        const assignVanTask = await storage.createFleetQueueItem({
          workflowType: "van_assignment",
          title: `Assign BYOV Van - ${techFullName}`,
          description: `Assign new BYOV van number and setup for ${techFullName} in ${location}. Current truck: ${formData.currentTruckNumber}`,
          priority: "high" as const,
          requesterId: "system",
          data: JSON.stringify({
            ...enrollmentData,
            workflowStep: 1,
            workflowId,
            task: "assign_van",
            nextActions: [
              "Review vehicle documentation and photos",
              "Verify BYOV requirements compliance",
              "Assign new van number",
              "Setup vehicle in fleet management system"
            ]
          }),
          metadata: JSON.stringify({
            enrollmentId,
            workflowId,
            source: "sears_drive_enrollment",
            taskType: "assign_van"
          })
        });
        createdTasks.push({ department: 'FLEET', task: 'Assign Van', id: assignVanTask.id });

        // FLEET Task 2: Unassign previous van  
        const unassignVanTask = await storage.createFleetQueueItem({
          workflowType: "van_unassignment",
          title: `Unassign Previous Van - ${formData.currentTruckNumber}`,
          description: `Unassign and process previous truck ${formData.currentTruckNumber} from ${techFullName}`,
          priority: "medium" as const,
          requesterId: "system",
          data: JSON.stringify({
            ...enrollmentData,
            workflowStep: 2,
            workflowId,
            task: "unassign_van",
            dependsOn: assignVanTask.id,
            nextActions: [
              "Remove truck from technician assignment",
              "Update fleet records",
              "Schedule vehicle return/pickup"
            ]
          }),
          metadata: JSON.stringify({
            enrollmentId,
            workflowId,
            source: "sears_drive_enrollment",
            taskType: "unassign_van"
          })
        });
        createdTasks.push({ department: 'FLEET', task: 'Unassign Previous Van', id: unassignVanTask.id });

        // FLEET Task 3: Update TPMS, AMS, and Holman systems
        const updateSystemsTask = await storage.createFleetQueueItem({
          workflowType: "system_updates",
          title: `Update TPMS/AMS/Holman - ${techFullName}`,
          description: `Update TPMS, AMS, and Holman systems for vehicle transition from ${formData.currentTruckNumber} to new BYOV`,
          priority: "medium" as const,
          requesterId: "system",
          data: JSON.stringify({
            ...enrollmentData,
            workflowStep: 3,
            workflowId,
            task: "update_systems",
            dependsOn: assignVanTask.id,
            nextActions: [
              "Update TPMS (Truck Parts Management System)",
              "Update AMS (Asset Management System)", 
              "Update Holman fleet system",
              "Sync all system records"
            ]
          }),
          metadata: JSON.stringify({
            enrollmentId,
            workflowId,
            source: "sears_drive_enrollment",
            taskType: "update_systems"
          })
        });
        createdTasks.push({ department: 'FLEET', task: 'Update TPMS/AMS/Holman', id: updateSystemsTask.id });

        // NTAO Task 1: Stop shipment for previous van
        const stopShipmentTask = await storage.createNTAOQueueItem({
          workflowType: "stop_shipment",
          title: `Stop Parts Shipment - Truck ${formData.currentTruckNumber}`,
          description: `Stop all part stock shipments to previous truck ${formData.currentTruckNumber} for ${techFullName}`,
          priority: "high" as const,
          requesterId: "system",
          data: JSON.stringify({
            ...enrollmentData,
            workflowStep: 1,
            workflowId,
            task: "stop_shipment",
            nextActions: [
              "Halt all scheduled shipments to truck " + formData.currentTruckNumber,
              "Update shipping system records",
              "Notify warehouse of shipment changes"
            ]
          }),
          metadata: JSON.stringify({
            enrollmentId,
            workflowId,
            source: "sears_drive_enrollment",
            taskType: "stop_shipment"
          })
        });
        createdTasks.push({ department: 'NTAO', task: 'Stop Shipment to Previous Van', id: stopShipmentTask.id });

        // NTAO Task 2: Setup shipment for new van (depends on van assignment)
        const setupNewShipmentTask = await storage.createNTAOQueueItem({
          workflowType: "setup_shipment",
          title: `Setup Parts Shipment - New BYOV for ${techFullName}`,
          description: `Setup part stock shipment routing for new BYOV assigned to ${techFullName}`,
          priority: "medium" as const,
          requesterId: "system",
          data: JSON.stringify({
            ...enrollmentData,
            workflowStep: 2,
            workflowId,
            task: "setup_new_shipment",
            dependsOn: assignVanTask.id,
            nextActions: [
              "Wait for new van number assignment",
              "Setup shipment routing for new BYOV",
              "Configure inventory management for new vehicle",
              "Test shipment workflow"
            ]
          }),
          metadata: JSON.stringify({
            enrollmentId,
            workflowId,
            source: "sears_drive_enrollment",
            taskType: "setup_new_shipment"
          })
        });
        createdTasks.push({ department: 'NTAO', task: 'Ship to New Van', id: setupNewShipmentTask.id });

        console.log(`Created ${createdTasks.length} tasks for BYOV enrollment ${enrollmentId}:`);
        createdTasks.forEach(task => {
          console.log(`  - ${task.department}: ${task.task} (${task.id})`);
        });
        
      } catch (queueError) {
        // Log the error but don't fail the enrollment submission
        console.error('Failed to create queue tasks for enrollment:', queueError);
      }
      
      res.json({ 
        message: "Sears Drive Program enrollment submitted successfully!",
        enrollmentId,
        submittedData: formData,
        filesReceived: files.length,
        tasksCreated: createdTasks.length,
        taskDetails: createdTasks,
        workflowId,
        nextSteps: createdTasks.length > 0
          ? `${createdTasks.length} tasks have been created across FLEET and NTAO departments. FLEET will handle van assignment/unassignment and system updates. NTAO will manage shipment routing changes. You will be contacted as tasks are completed.`
          : "Your enrollment has been submitted. Department teams will review your submission and contact you soon."
      });
    } catch (error) {
      console.error('Error submitting Sears Drive enrollment:', error);
      res.status(500).json({ message: "Failed to submit enrollment form" });
    }
  });

  // Unified form submission endpoint
  app.post("/api/forms/:key/submit", checkAnonymousRateLimit, async (req, res) => {
    try {
      const { key } = req.params;
      const sanitizedData = sanitizeInput(req.body);
      
      // Validate form key
      const validKeys = ['create-vehicle', 'assign-vehicle', 'onboarding', 'offboarding', 'byov-enrollment'];
      if (!validKeys.includes(key)) {
        return res.status(400).json({ message: `Invalid form key: ${key}` });
      }

      // Validate request body using appropriate schema based on form key
      let validatedData;
      try {
        switch (key) {
          case 'create-vehicle':
            validatedData = anonymousVehicleSchema.parse(sanitizedData);
            break;
          case 'assign-vehicle':
            validatedData = anonymousVehicleAssignmentSchema.parse(sanitizedData);
            break;
          case 'onboarding':
            validatedData = anonymousOnboardingSchema.parse(sanitizedData);
            break;
          case 'offboarding':
            validatedData = anonymousOffboardingSchema.parse(sanitizedData);
            break;
          case 'byov-enrollment':
            validatedData = anonymousByovEnrollmentSchema.parse(sanitizedData);
            break;
          default:
            return res.status(400).json({ message: `Validation schema not found for form key: ${key}` });
        }
      } catch (validationError) {
        if (validationError instanceof z.ZodError) {
          return res.status(400).json({ 
            message: "Invalid form data", 
            errors: validationError.errors 
          });
        }
        throw validationError;
      }

      // Create workflow ID to link related tasks
      const workflowId = crypto.randomBytes(16).toString('hex');
      const taskIds: string[] = [];
      const createdTasks: Array<{id: string, department: string, type: string}> = [];

      // Route to appropriate departments based on form key
      switch (key) {
        case 'create-vehicle':
          {
            const vehicleData = validatedData as z.infer<typeof anonymousVehicleSchema>;
            const task = await storage.createFleetQueueItem({
              workflowType: "vehicle_assignment",
              title: "Create Vehicle Record",
              description: `Vehicle creation: ${vehicleData.makeName} ${vehicleData.modelName} (${vehicleData.vin})`,
              priority: "medium",
              requesterId: "anonymous",
              department: "FLEET",
              data: JSON.stringify(vehicleData),
              workflowId,
              workflowStep: 1,
              metadata: JSON.stringify({
                templateType: "fleet_create_vehicle_v1",
                priority: 2,
                source: "unified_forms"
              })
            });
            taskIds.push(task.id);
            createdTasks.push({id: task.id, department: "FLEET", type: "Create Vehicle Record"});
          }
          break;

        case 'assign-vehicle':
          {
            const assignmentData = validatedData as z.infer<typeof anonymousVehicleAssignmentSchema>;
            // FLEET → Assign Vehicle to Tech (priority:1)
            const fleetTask = await storage.createFleetQueueItem({
              workflowType: "vehicle_assignment",
              title: "Assign Vehicle to Tech",
              description: `Vehicle assignment for ${assignmentData.firstName} ${assignmentData.lastName}`,
              priority: "high",
              requesterId: "anonymous",
              department: "FLEET",
              data: JSON.stringify(assignmentData),
              workflowId,
              workflowStep: 1,
              metadata: JSON.stringify({
                templateType: "fleet_assign_vehicle_v1",
                priority: 1,
                source: "unified_forms"
              })
            });
            taskIds.push(fleetTask.id);
            createdTasks.push({id: fleetTask.id, department: "FLEET", type: "Assign Vehicle to Tech"});

            // INVENTORY → Initialize Truck Stock Profile (priority:2)
            const inventoryTask = await storage.createInventoryQueueItem({
              workflowType: "vehicle_assignment",
              title: "Initialize Truck Stock Profile",
              description: `Initialize truck inventory for ${assignmentData.firstName} ${assignmentData.lastName}`,
              priority: "medium",
              requesterId: "anonymous",
              department: "INVENTORY",
              data: JSON.stringify(assignmentData),
              workflowId,
              workflowStep: 2,
              dependsOn: fleetTask.id,
              metadata: JSON.stringify({
                templateType: "inventory_init_truck_profile_v1",
                priority: 2,
                source: "unified_forms"
              })
            });
            taskIds.push(inventoryTask.id);
            createdTasks.push({id: inventoryTask.id, department: "INVENTORY", type: "Initialize Truck Stock Profile"});

            // ASSETS → Issue/Verify Assets (priority:2)
            const assetsTask = await storage.createAssetsQueueItem({
              workflowType: "vehicle_assignment",
              title: "Issue/Verify Assets",
              description: `Issue company assets to ${assignmentData.firstName} ${assignmentData.lastName}`,
              priority: "medium",
              requesterId: "anonymous",
              department: "ASSETS",
              data: JSON.stringify(assignmentData),
              workflowId,
              workflowStep: 2,
              dependsOn: fleetTask.id,
              metadata: JSON.stringify({
                templateType: "assets_issue_v1",
                priority: 2,
                source: "unified_forms"
              })
            });
            taskIds.push(assetsTask.id);
            createdTasks.push({id: assetsTask.id, department: "ASSETS", type: "Issue/Verify Assets"});

            // NTAO → Update Technician Profile (priority:3)
            const ntaoTask = await storage.createNTAOQueueItem({
              workflowType: "vehicle_assignment",
              title: "Update Technician Profile",
              description: `Update technician profile for ${assignmentData.firstName} ${assignmentData.lastName}`,
              priority: "low",
              requesterId: "anonymous",
              department: "NTAO",
              data: JSON.stringify(assignmentData),
              workflowId,
              workflowStep: 3,
              dependsOn: fleetTask.id,
              metadata: JSON.stringify({
                templateType: "ntao_update_profile_v1",
                priority: 3,
                source: "unified_forms"
              })
            });
            taskIds.push(ntaoTask.id);
            createdTasks.push({id: ntaoTask.id, department: "NTAO", type: "Update Technician Profile"});
          }
          break;

        case 'onboarding':
          {
            const onboardingData = validatedData as z.infer<typeof anonymousOnboardingSchema>;
            // NTAO → Create Tech Record & Access (priority:1)
            const ntaoTask = await storage.createNTAOQueueItem({
              workflowType: "onboarding",
              title: "Create Tech Record & Access",
              description: `Onboard new technician: ${onboardingData.firstName} ${onboardingData.lastName}`,
              priority: "high",
              requesterId: "anonymous",
              department: "NTAO",
              data: JSON.stringify(onboardingData),
              workflowId,
              workflowStep: 1,
              metadata: JSON.stringify({
                templateType: "ntao_create_user_v1",
                priority: 1,
                source: "unified_forms"
              })
            });
            taskIds.push(ntaoTask.id);
            createdTasks.push({id: ntaoTask.id, department: "NTAO", type: "Create Tech Record & Access"});

            // ASSETS → Provision Assets (priority:2)
            const assetsTask = await storage.createAssetsQueueItem({
              workflowType: "onboarding",
              title: "Provision Assets",
              description: `Provision company assets for ${onboardingData.firstName} ${onboardingData.lastName}`,
              priority: "medium",
              requesterId: "anonymous",
              department: "ASSETS",
              data: JSON.stringify(onboardingData),
              workflowId,
              workflowStep: 2,
              dependsOn: ntaoTask.id,
              metadata: JSON.stringify({
                templateType: "assets_provision_v1",
                priority: 2,
                source: "unified_forms"
              })
            });
            taskIds.push(assetsTask.id);
            createdTasks.push({id: assetsTask.id, department: "ASSETS", type: "Provision Assets"});

            // FLEET → Queue Vehicle Assignment (priority:2)
            const fleetTask = await storage.createFleetQueueItem({
              workflowType: "onboarding",
              title: "Queue Vehicle Assignment",
              description: `Queue vehicle assignment for ${onboardingData.firstName} ${onboardingData.lastName}`,
              priority: "medium",
              requesterId: "anonymous",
              department: "FLEET",
              data: JSON.stringify(onboardingData),
              workflowId,
              workflowStep: 2,
              dependsOn: ntaoTask.id,
              metadata: JSON.stringify({
                templateType: "fleet_queue_assignment_v1",
                priority: 2,
                source: "unified_forms"
              })
            });
            taskIds.push(fleetTask.id);
            createdTasks.push({id: fleetTask.id, department: "FLEET", type: "Queue Vehicle Assignment"});

            // INVENTORY → Seed Truck Stock (priority:3)
            const inventoryTask = await storage.createInventoryQueueItem({
              workflowType: "onboarding",
              title: "Seed Truck Stock",
              description: `Initialize truck inventory for ${onboardingData.firstName} ${onboardingData.lastName}`,
              priority: "low",
              requesterId: "anonymous",
              department: "INVENTORY",
              data: JSON.stringify(onboardingData),
              workflowId,
              workflowStep: 3,
              dependsOn: fleetTask.id,
              metadata: JSON.stringify({
                templateType: "inventory_seed_stock_v1",
                priority: 3,
                source: "unified_forms"
              })
            });
            taskIds.push(inventoryTask.id);
            createdTasks.push({id: inventoryTask.id, department: "INVENTORY", type: "Seed Truck Stock"});
          }
          break;

        case 'offboarding':
          {
            const offboardingData = validatedData as z.infer<typeof anonymousOffboardingSchema>;
            // Priority 1 tasks (parallel execution)
            const fleetTask1 = await storage.createFleetQueueItem({
              workflowType: "offboarding",
              title: "Day 0: Stop Truck Stock Replenishment",
              description: `DAY 0 TASK: Stop replenishment for ${offboardingData.techName || 'technician'}`,
              priority: "high",
              requesterId: "anonymous",
              department: "FLEET",
              data: JSON.stringify({
                ...offboardingData,
                isDay0Task: true,
                phase: "day0",
                workflowId,
                workflowStep: 1
              }),
              workflowId,
              workflowStep: 1,
              metadata: JSON.stringify({
                templateType: "fleet_stop_replenishment_v1",
                priority: 1,
                source: "unified_forms"
              })
            });
            taskIds.push(fleetTask1.id);
            createdTasks.push({id: fleetTask1.id, department: "FLEET", type: "Stop Truck Stock Replenishment"});

            const inventoryTask1 = await storage.createInventoryQueueItem({
              workflowType: "offboarding",
              title: "Day 0: Full Truck Count & Return",
              description: `DAY 0 TASK: Perform full inventory count for ${offboardingData.techName || 'technician'}`,
              priority: "high",
              requesterId: "anonymous",
              department: "INVENTORY",
              data: JSON.stringify({
                ...offboardingData,
                isDay0Task: true,
                phase: "day0",
                workflowId,
                workflowStep: 1
              }),
              workflowId,
              workflowStep: 1,
              metadata: JSON.stringify({
                templateType: "inventory_full_recovery_v1",
                priority: 1,
                source: "unified_forms"
              })
            });
            taskIds.push(inventoryTask1.id);
            createdTasks.push({id: inventoryTask1.id, department: "INVENTORY", type: "Full Truck Count & Return"});

            const assetsTask1 = await storage.createAssetsQueueItem({
              workflowType: "offboarding",
              title: "Day 0: Collect Company Assets",
              description: `DAY 0 TASK: Collect all company assets from ${offboardingData.techName || 'technician'}`,
              priority: "high",
              requesterId: "anonymous",
              department: "ASSETS",
              data: JSON.stringify({
                ...offboardingData,
                isDay0Task: true,
                phase: "day0",
                workflowId,
                workflowStep: 1
              }),
              workflowId,
              workflowStep: 1,
              metadata: JSON.stringify({
                templateType: "assets_collect_v1",
                priority: 1,
                source: "unified_forms"
              })
            });
            taskIds.push(assetsTask1.id);
            createdTasks.push({id: assetsTask1.id, department: "ASSETS", type: "Collect Company Assets"});

            const ntaoTask1 = await storage.createNTAOQueueItem({
              workflowType: "offboarding",
              title: "Day 0: Access Removal / Separation Notice",
              description: `DAY 0 TASK: Process access removal for ${offboardingData.techName || 'technician'}`,
              priority: "high",
              requesterId: "anonymous",
              department: "NTAO",
              data: JSON.stringify({
                ...offboardingData,
                isDay0Task: true,
                phase: "day0",
                workflowId,
                workflowStep: 1
              }),
              workflowId,
              workflowStep: 1,
              metadata: JSON.stringify({
                templateType: "ntao_access_remove_v1",
                priority: 1,
                source: "unified_forms"
              })
            });
            taskIds.push(ntaoTask1.id);
            createdTasks.push({id: ntaoTask1.id, department: "NTAO", type: "Access Removal / Separation Notice"});

            // Priority 2 task (depends on inventory completion)
            const fleetTask2 = await storage.createFleetQueueItem({
              workflowType: "offboarding",
              title: "Vehicle Return / Reassign",
              description: `Process vehicle return for ${offboardingData.techName || 'technician'}`,
              priority: "medium",
              requesterId: "anonymous",
              department: "FLEET",
              data: JSON.stringify(offboardingData),
              workflowId,
              workflowStep: 2,
              dependsOn: inventoryTask1.id,
              metadata: JSON.stringify({
                templateType: "fleet_return_vehicle_v1",
                priority: 2,
                source: "unified_forms"
              })
            });
            taskIds.push(fleetTask2.id);
            createdTasks.push({id: fleetTask2.id, department: "FLEET", type: "Vehicle Return / Reassign"});
          }
          break;

        case 'byov-enrollment':
          {
            const byovData = validatedData as z.infer<typeof anonymousByovEnrollmentSchema>;
            // ASSETS → BYOV Agreement Acknowledgment (priority:1)
            const assetsTask = await storage.createAssetsQueueItem({
              workflowType: "byov_assignment",
              title: "BYOV Agreement Acknowledgment",
              description: `Process BYOV agreement for ${byovData.techFirstName} ${byovData.techLastName}`,
              priority: "high",
              requesterId: "anonymous",
              department: "ASSETS",
              data: JSON.stringify(byovData),
              workflowId,
              workflowStep: 1,
              metadata: JSON.stringify({
                templateType: "assets_byov_agreement_v1",
                priority: 1,
                source: "unified_forms"
              })
            });
            taskIds.push(assetsTask.id);
            createdTasks.push({id: assetsTask.id, department: "ASSETS", type: "BYOV Agreement Acknowledgment"});

            // INVENTORY → BYOV Inventory Policy Setup (priority:2)
            const inventoryTask = await storage.createInventoryQueueItem({
              workflowType: "byov_assignment",
              title: "BYOV Inventory Policy Setup",
              description: `Setup BYOV inventory policy for ${byovData.techFirstName} ${byovData.techLastName}`,
              priority: "medium",
              requesterId: "anonymous",
              department: "INVENTORY",
              data: JSON.stringify(byovData),
              workflowId,
              workflowStep: 2,
              dependsOn: assetsTask.id,
              metadata: JSON.stringify({
                templateType: "inventory_byov_rules_v1",
                priority: 2,
                source: "unified_forms"
              })
            });
            taskIds.push(inventoryTask.id);
            createdTasks.push({id: inventoryTask.id, department: "INVENTORY", type: "BYOV Inventory Policy Setup"});

            // NTAO → Payroll/Compliance Flag (priority:2)
            const ntaoTask = await storage.createNTAOQueueItem({
              workflowType: "byov_assignment",
              title: "Payroll/Compliance Flag",
              description: `Setup payroll compliance for BYOV: ${byovData.techFirstName} ${byovData.techLastName}`,
              priority: "medium",
              requesterId: "anonymous",
              department: "NTAO",
              data: JSON.stringify(byovData),
              workflowId,
              workflowStep: 2,
              dependsOn: assetsTask.id,
              metadata: JSON.stringify({
                templateType: "ntao_byov_flag_v1",
                priority: 2,
                source: "unified_forms"
              })
            });
            taskIds.push(ntaoTask.id);
            createdTasks.push({id: ntaoTask.id, department: "NTAO", type: "Payroll/Compliance Flag"});
          }
          break;
      }

      res.json({
        task_ids: taskIds,
        created: createdTasks
      });

    } catch (error) {
      console.error(`Error processing unified form submission for key ${req.params.key}:`, error);
      res.status(500).json({ message: "Failed to process form submission" });
    }
  });


  // Work Template Routes
  app.get("/api/work-templates/:workflowType/:department", requireAuth, async (req, res) => {
    try {
      const { workflowType, department } = req.params;
      const { taskData } = req.query; // Accept task data from query params
      
      if (!["FLEET", "INVENTORY", "ASSETS", "NTAO"].includes(department.toUpperCase())) {
        return res.status(400).json({ message: "Invalid department" });
      }

      // Parse task data if provided
      let parsedTaskData = null;
      if (taskData && typeof taskData === 'string') {
        try {
          parsedTaskData = JSON.parse(decodeURIComponent(taskData));
          console.log(`Template API: Received task data for ${workflowType}/${department}:`, parsedTaskData?.step || 'no-step');
        } catch (error) {
          console.warn('Template API: Failed to parse task data:', error);
        }
      }

      // Use enhanced template selection that considers task data (keep original case for registry lookup)
      console.log(`Template API: Loading template for workflow="${workflowType}", department="${department}"`);
      const result = await templateLoader.getTemplateForTask(workflowType, department as QueueModule, parsedTaskData);
      const template = result.template;
      
      if (template) {
        console.log(`Template API: Successfully loaded template for ${workflowType}/${department}`);
        res.json({ template });
      } else {
        console.warn(`Template API: Template not found for ${workflowType}/${department}. Error: ${result.error}`);
        res.status(404).json({ 
          message: "Template not found",
          error: result.error || `No template available for workflow ${workflowType} in department ${department}`,
          suggestions: result.suggestions
        });
      }
    } catch (error) {
      console.error("Error loading work template:", error);
      res.status(500).json({ message: "Failed to load work template" });
    }
  });

  app.get("/api/work-templates/:templateId", requireAuth, async (req, res) => {
    try {
      const { templateId } = req.params;
      const result = await templateLoader.loadTemplate(templateId);
      
      if (result.template) {
        res.json({ template: result.template });
      } else {
        res.status(404).json({ 
          message: "Template not found",
          error: result.error,
          suggestions: result.suggestions
        });
      }
    } catch (error) {
      console.error("Error loading template by ID:", error);
      res.status(500).json({ message: "Failed to load template" });
    }
  });

  app.get("/api/work-templates/department/:department", requireAuth, async (req, res) => {
    try {
      const { department } = req.params;
      
      if (!["FLEET", "INVENTORY", "ASSETS", "NTAO"].includes(department.toUpperCase())) {
        return res.status(400).json({ message: "Invalid department" });
      }

      const templates = await templateLoader.getTemplatesForDepartment(department.toLowerCase() as QueueModule);
      res.json({ templates });
    } catch (error) {
      console.error("Error loading department templates:", error);
      res.status(500).json({ message: "Failed to load department templates" });
    }
  });

  app.post("/api/work-templates/validate", requireAuth, async (req, res) => {
    try {
      const templateData = req.body;
      const { validateTemplate } = await import("../shared/template-loader");
      const validation = await validateTemplate(templateData);
      
      res.json(validation);
    } catch (error) {
      console.error("Error validating template:", error);
      res.status(500).json({ message: "Failed to validate template" });
    }
  });

  app.get("/api/templates/validate-all", requireAuth, async (req, res) => {
    try {
      console.log('=== STARTING COMPREHENSIVE TEMPLATE VALIDATION ===');
      
      const departments: QueueModule[] = ['ntao', 'assets', 'inventory', 'fleet'];
      const workflowTypes = [
        'vehicle_assignment', 'onboarding', 'offboarding', 'decommission', 
        'byov_assignment', 'byov_onboarding', 'onboarding_day0', 'onboarding_day1_5',
        'onboarding_general', 'van_assignment', 'van_unassignment', 'system_updates',
        'stop_shipment', 'setup_shipment', 'equipment_recovery', 'storage_request',
        'create_vehicle', 'offboarding_sequence'
      ];

      const validationResults = {
        timestamp: new Date().toISOString(),
        summary: {
          totalCombinations: departments.length * workflowTypes.length,
          workingCombinations: 0,
          missingTemplates: 0,
          missingRegistryEntries: 0,
          bothMissing: 0,
          errors: 0
        },
        departments: {} as Record<string, any>,
        missingTemplates: [] as Array<{
          department: string;
          workflowType: string;
          issue: 'missing_template' | 'missing_registry' | 'both_missing' | 'load_error';
          expectedTemplateId: string;
          registryEntry: string[];
          error?: string;
        }>,
        workingTemplates: [] as Array<{
          department: string;
          workflowType: string;
          templateId: string;
          templateExists: boolean;
          registryExists: boolean;
        }>,
        registryAnalysis: {
          loadedSuccessfully: false,
          totalWorkflowTypes: 0,
          emptyMappings: 0,
          workflowTypesWithEmptyDepartments: [] as string[]
        }
      };

      // Load registry to understand current mappings
      const path = await import('path');
      const fs = await import('fs');
      const { fileURLToPath } = await import('url');
      
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      
      let registry: any = {};
      try {
        const registryPath = path.join(__dirname, '../shared/templates/template-registry.json');
        const registryData = await fs.promises.readFile(registryPath, 'utf-8');
        const parsedRegistry = JSON.parse(registryData);
        registry = parsedRegistry.registry ?? parsedRegistry;
        validationResults.registryAnalysis.loadedSuccessfully = true;
        validationResults.registryAnalysis.totalWorkflowTypes = Object.keys(registry).length;
        
        // Analyze empty mappings
        for (const [workflowType, deptMappings] of Object.entries(registry)) {
          let hasEmptyDepartments = false;
          for (const [dept, templates] of Object.entries(deptMappings as any)) {
            if (!templates || (Array.isArray(templates) && templates.length === 0)) {
              hasEmptyDepartments = true;
              validationResults.registryAnalysis.emptyMappings++;
            }
          }
          if (hasEmptyDepartments) {
            validationResults.registryAnalysis.workflowTypesWithEmptyDepartments.push(workflowType);
          }
        }
      } catch (error) {
        console.error('Failed to load registry for validation:', error);
        validationResults.registryAnalysis.loadedSuccessfully = false;
      }

      // Test each department/workflow combination
      for (const department of departments) {
        console.log(`Testing department: ${department.toUpperCase()}`);
        validationResults.departments[department.toUpperCase()] = {
          totalWorkflows: workflowTypes.length,
          working: 0,
          missing: 0,
          details: {} as Record<string, any>
        };

        for (const workflowType of workflowTypes) {
          const testResult = {
            workflowType,
            registryExists: false,
            templateExists: false,
            templateLoads: false,
            expectedTemplateId: '',
            registryTemplates: [] as string[],
            error: null as string | null
          };

          try {
            // Check registry entry
            const registryEntry = registry[workflowType]?.[department.toUpperCase()];
            testResult.registryExists = !!(registryEntry && registryEntry.length > 0);
            testResult.registryTemplates = registryEntry || [];

            if (testResult.registryExists && testResult.registryTemplates.length > 0) {
              // Check if template file exists
              testResult.expectedTemplateId = testResult.registryTemplates[0];
              const templatePath = path.join(__dirname, `../shared/templates/${department}/${testResult.expectedTemplateId}.json`);
              testResult.templateExists = fs.existsSync(templatePath);

              if (testResult.templateExists) {
                // Try to load template
                try {
                  const templateResult = await templateLoader.getTemplateForWorkflow(workflowType, department);
                  testResult.templateLoads = !!templateResult.template;
                  if (!testResult.templateLoads && templateResult.error) {
                    testResult.error = templateResult.error;
                  }
                } catch (loadError) {
                  testResult.templateLoads = false;
                  testResult.error = `Load error: ${loadError instanceof Error ? loadError.message : 'Unknown error'}`;
                }
              }
            } else {
              // Generate expected template ID for missing registry entries
              testResult.expectedTemplateId = `${department}_${workflowType.replace(/_/g, '_')}_v1`;
            }

            // Categorize the result
            if (testResult.registryExists && testResult.templateExists && testResult.templateLoads) {
              validationResults.summary.workingCombinations++;
              validationResults.departments[department.toUpperCase()].working++;
              validationResults.workingTemplates.push({
                department: department.toUpperCase(),
                workflowType,
                templateId: testResult.expectedTemplateId,
                templateExists: true,
                registryExists: true
              });
            } else {
              validationResults.departments[department.toUpperCase()].missing++;
              
              let issue: 'missing_template' | 'missing_registry' | 'both_missing' | 'load_error' = 'both_missing';
              
              if (!testResult.registryExists && !testResult.templateExists) {
                issue = 'both_missing';
                validationResults.summary.bothMissing++;
              } else if (!testResult.registryExists) {
                issue = 'missing_registry';
                validationResults.summary.missingRegistryEntries++;
              } else if (!testResult.templateExists || !testResult.templateLoads) {
                if (testResult.error) {
                  issue = 'load_error';
                  validationResults.summary.errors++;
                } else {
                  issue = 'missing_template';
                  validationResults.summary.missingTemplates++;
                }
              }

              validationResults.missingTemplates.push({
                department: department.toUpperCase(),
                workflowType,
                issue,
                expectedTemplateId: testResult.expectedTemplateId,
                registryEntry: testResult.registryTemplates,
                error: testResult.error || undefined
              });
            }

            validationResults.departments[department.toUpperCase()].details[workflowType] = testResult;

          } catch (error) {
            console.error(`Error testing ${department}/${workflowType}:`, error);
            testResult.error = error instanceof Error ? error.message : 'Unknown error';
            validationResults.summary.errors++;
            validationResults.departments[department.toUpperCase()].missing++;
            
            validationResults.missingTemplates.push({
              department: department.toUpperCase(),
              workflowType,
              issue: 'load_error',
              expectedTemplateId: testResult.expectedTemplateId,
              registryEntry: testResult.registryTemplates,
              error: testResult.error
            });

            validationResults.departments[department.toUpperCase()].details[workflowType] = testResult;
          }
        }
      }

      console.log('=== VALIDATION COMPLETE ===');
      console.log(`Total combinations: ${validationResults.summary.totalCombinations}`);
      console.log(`Working: ${validationResults.summary.workingCombinations}`);
      console.log(`Missing templates: ${validationResults.summary.missingTemplates}`);
      console.log(`Missing registry entries: ${validationResults.summary.missingRegistryEntries}`);
      console.log(`Both missing: ${validationResults.summary.bothMissing}`);
      console.log(`Errors: ${validationResults.summary.errors}`);

      res.json(validationResults);
    } catch (error) {
      console.error("Error in comprehensive template validation:", error);
      res.status(500).json({ 
        message: "Failed to perform comprehensive template validation",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Template Diagnostic Endpoint for debugging production issues
  app.get("/api/templates/diagnose", requireAuth, async (req, res) => {
    try {
      console.log('Template diagnostics requested');
      const diagnostics: {
        timestamp: string;
        environment: string;
        templateSystem: {
          loaderInstance: boolean;
          templateDirectory: string;
          directoryExists: boolean;
          directoryContents: string[];
        };
        registry: {
          loaded: boolean;
          path: string;
          exists: boolean;
          contents: any;
          error: string | null;
        };
        departments: string[];
        workflowTypes: string[];
        templateLoadingStatus: Record<string, Record<string, any>>;
        ntaoSpecificTests: {
          onboardingTemplate: any;
          onboardingDay0Template: any;
          registryEntries: any;
        };
        fileSystemChecks: Record<string, any>;
        issues: string[];
        summary?: {
          overallStatus: string;
          criticalIssues: string[];
          totalIssues: number;
          templatesDirectory: string;
          registryLoaded: boolean;
          ntaoOnboardingAvailable: boolean;
        };
      } = {
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        templateSystem: {
          loaderInstance: !!templateLoader,
          templateDirectory: '',
          directoryExists: false,
          directoryContents: [] as string[]
        },
        registry: {
          loaded: false,
          path: '',
          exists: false,
          contents: null,
          error: null
        },
        departments: ['NTAO', 'ASSETS', 'INVENTORY', 'FLEET'],
        workflowTypes: [
          'onboarding', 'onboarding_day0', 'offboarding', 
          'vehicle_assignment', 'decommission', 'byov_assignment',
          'byov_onboarding', 'setup_shipment', 'stop_shipment'
        ],
        templateLoadingStatus: {} as Record<string, Record<string, any>>,
        ntaoSpecificTests: {
          onboardingTemplate: null,
          onboardingDay0Template: null,
          registryEntries: null
        },
        fileSystemChecks: {} as Record<string, any>,
        issues: [] as string[]
      };

      // Get template directory information
      const path = await import('path');
      const fs = await import('fs');
      const { fileURLToPath } = await import('url');
      
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const templatesDir = path.join(__dirname, '..', 'shared', 'templates');
      
      diagnostics.templateSystem.templateDirectory = templatesDir;
      diagnostics.templateSystem.directoryExists = fs.existsSync(templatesDir);
      
      if (diagnostics.templateSystem.directoryExists) {
        try {
          diagnostics.templateSystem.directoryContents = fs.readdirSync(templatesDir);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          diagnostics.issues.push(`Failed to read template directory: ${errorMessage}`);
        }
      } else {
        diagnostics.issues.push(`Template directory does not exist: ${templatesDir}`);
      }

      // Test template registry loading
      const registryPath = path.join(templatesDir, 'template-registry.json');
      diagnostics.registry.path = registryPath;
      diagnostics.registry.exists = fs.existsSync(registryPath);
      
      if (diagnostics.registry.exists) {
        try {
          const registryData = fs.readFileSync(registryPath, 'utf-8');
          const parsedRegistry = JSON.parse(registryData);
          diagnostics.registry.contents = parsedRegistry.registry ?? parsedRegistry;
          diagnostics.registry.loaded = true;
          
          // Extract workflow types from registry
          if (diagnostics.registry.contents) {
            diagnostics.workflowTypes = Object.keys(diagnostics.registry.contents);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          diagnostics.registry.error = errorMessage;
          diagnostics.issues.push(`Failed to load template registry: ${errorMessage}`);
        }
      } else {
        diagnostics.issues.push(`Template registry file does not exist: ${registryPath}`);
      }

      // Test template loading for each department/workflow combination
      for (const department of diagnostics.departments) {
        diagnostics.templateLoadingStatus[department] = {};
        
        for (const workflowType of diagnostics.workflowTypes) {
          try {
            const result = await templateLoader.getTemplateForWorkflow(workflowType, department.toLowerCase() as QueueModule);
            diagnostics.templateLoadingStatus[department][workflowType] = {
              success: !!result.template,
              templateId: result.template?.id || null,
              error: result.error || null,
              suggestions: result.suggestions || []
            };
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            diagnostics.templateLoadingStatus[department][workflowType] = {
              success: false,
              templateId: null,
              error: errorMessage,
              suggestions: []
            };
          }
        }
      }

      // NTAO-specific diagnostic tests
      try {
        // Test NTAO onboarding template
        const ntaoOnboardingResult = await templateLoader.getTemplateForWorkflow('onboarding', 'ntao');
        diagnostics.ntaoSpecificTests.onboardingTemplate = {
          success: !!ntaoOnboardingResult.template,
          templateId: ntaoOnboardingResult.template?.id || null,
          templateName: ntaoOnboardingResult.template?.name || null,
          stepsCount: ntaoOnboardingResult.template?.steps?.length || 0,
          error: ntaoOnboardingResult.error || null
        };

        // Test NTAO onboarding_day0 template (this might be missing)
        const ntaoDay0Result = await templateLoader.getTemplateForWorkflow('onboarding_day0', 'ntao');
        diagnostics.ntaoSpecificTests.onboardingDay0Template = {
          success: !!ntaoDay0Result.template,
          templateId: ntaoDay0Result.template?.id || null,
          templateName: ntaoDay0Result.template?.name || null,
          stepsCount: ntaoDay0Result.template?.steps?.length || 0,
          error: ntaoDay0Result.error || null
        };

        // Check registry entries for NTAO
        if (diagnostics.registry.contents) {
          diagnostics.ntaoSpecificTests.registryEntries = {
            onboarding: diagnostics.registry.contents.onboarding?.NTAO || [],
            onboarding_day0: diagnostics.registry.contents.onboarding_day0?.NTAO || [],
            allWorkflowsForNTAO: {}
          };
          
          // Get all workflows for NTAO
          for (const workflowType of Object.keys(diagnostics.registry.contents)) {
            const ntaoTemplates = diagnostics.registry.contents[workflowType]?.NTAO || [];
            if (ntaoTemplates.length > 0) {
              diagnostics.ntaoSpecificTests.registryEntries.allWorkflowsForNTAO[workflowType] = ntaoTemplates;
            }
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        diagnostics.issues.push(`NTAO template testing failed: ${errorMessage}`);
      }

      // File system checks for NTAO templates
      const ntaoDir = path.join(templatesDir, 'ntao');
      diagnostics.fileSystemChecks.ntaoDirectory = {
        path: ntaoDir,
        exists: fs.existsSync(ntaoDir),
        contents: []
      };

      if (diagnostics.fileSystemChecks.ntaoDirectory.exists) {
        try {
          const ntaoFiles = fs.readdirSync(ntaoDir);
          diagnostics.fileSystemChecks.ntaoDirectory.contents = ntaoFiles;
          
          // Check specific NTAO template files
          const expectedNtaoTemplates = [
            'ntao_onboard_technician_v1.json',
            'ntao_assign_vehicle_v1.json',
            'ntao_offboard_technician_v1.json',
            'ntao_setup_shipment_v1.json',
            'ntao_stop_shipment_v1.json',
            'ntao_byov_inspection_v1.json'
          ];
          
          diagnostics.fileSystemChecks.expectedNtaoTemplates = {};
          for (const templateFile of expectedNtaoTemplates) {
            const templatePath = path.join(ntaoDir, templateFile);
            diagnostics.fileSystemChecks.expectedNtaoTemplates[templateFile] = {
              exists: fs.existsSync(templatePath),
              path: templatePath
            };
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          diagnostics.issues.push(`Failed to read NTAO directory: ${errorMessage}`);
        }
      } else {
        diagnostics.issues.push(`NTAO template directory does not exist: ${ntaoDir}`);
      }

      // Identify critical issues
      const criticalIssues = [];
      
      if (!diagnostics.templateSystem.directoryExists) {
        criticalIssues.push('CRITICAL: Template directory does not exist');
      }
      
      if (!diagnostics.registry.loaded) {
        criticalIssues.push('CRITICAL: Template registry could not be loaded');
      }
      
      if (!diagnostics.ntaoSpecificTests.onboardingTemplate?.success) {
        criticalIssues.push('CRITICAL: NTAO onboarding template not available');
      }
      
      if (diagnostics.registry.contents?.onboarding_day0?.NTAO?.length === 0) {
        criticalIssues.push('WARNING: NTAO onboarding_day0 template not defined in registry');
      }

      diagnostics.summary = {
        overallStatus: criticalIssues.length === 0 ? 'HEALTHY' : 'ISSUES_DETECTED',
        criticalIssues,
        totalIssues: diagnostics.issues.length,
        templatesDirectory: diagnostics.templateSystem.templateDirectory,
        registryLoaded: diagnostics.registry.loaded,
        ntaoOnboardingAvailable: diagnostics.ntaoSpecificTests.onboardingTemplate?.success || false
      };

      console.log('Template diagnostics completed:', {
        status: diagnostics.summary.overallStatus,
        criticalIssues: diagnostics.summary.criticalIssues.length,
        totalIssues: diagnostics.summary.totalIssues
      });

      res.json(diagnostics);

    } catch (error) {
      console.error("Error running template diagnostics:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({ 
        message: "Failed to run template diagnostics",
        error: errorMessage,
        timestamp: new Date().toISOString()
      });
    }
  });

  // Work Progress Routes for Template State
  app.get("/api/work-progress/:queueItemId", requireAuth, async (req, res) => {
    try {
      const { queueItemId } = req.params;
      
      // Get queue item with current progress
      const queueItem = await storage.getQueueItem(queueItemId);
      if (!queueItem) {
        return res.status(404).json({ message: "Queue item not found" });
      }

      // Parse metadata for template progress
      let templateProgress = null;
      let checklistState = {};
      let stepNotes = {};
      let substepNotes = {};

      if (queueItem.metadata) {
        try {
          const metadata = JSON.parse(queueItem.metadata);
          templateProgress = metadata.templateProgress;
          checklistState = metadata.checklistState || {};
          stepNotes = metadata.stepNotes || {};
          substepNotes = metadata.substepNotes || {};
        } catch (error) {
          console.warn("Failed to parse queue item metadata:", error);
        }
      }

      res.json({
        progress: templateProgress,
        checklistState,
        stepNotes,
        substepNotes
      });
    } catch (error) {
      console.error("Error loading work progress:", error);
      res.status(500).json({ message: "Failed to load work progress" });
    }
  });

  app.patch("/api/work-progress/:queueItemId", requireAuth, async (req, res) => {
    try {
      const { queueItemId } = req.params;
      const { checklistState, stepNotes, substepNotes, templateProgress } = req.body;

      // Get current queue item
      const queueItem = await storage.getQueueItem(queueItemId);
      if (!queueItem) {
        return res.status(404).json({ message: "Queue item not found" });
      }

      // Parse existing metadata
      let metadata: any = {};
      if (queueItem.metadata) {
        try {
          metadata = JSON.parse(queueItem.metadata);
        } catch (error) {
          console.warn("Failed to parse existing metadata:", error);
        }
      }

      // Update metadata with template progress
      metadata.templateProgress = templateProgress;
      metadata.checklistState = checklistState;
      metadata.stepNotes = stepNotes;
      metadata.substepNotes = substepNotes;
      metadata.lastTemplateUpdate = new Date().toISOString();

      // Update queue item with new metadata
      const updatedItem = await storage.updateQueueItem(queueItemId, {
        metadata: JSON.stringify(metadata)
      });

      res.json({ success: true, metadata: metadata });
    } catch (error) {
      console.error("Error saving work progress:", error);
      res.status(500).json({ message: "Failed to save work progress" });
    }
  });

  // Metrics and Export Routes
  
  // Helper function to build queue item query filters with robust array parsing
  const buildQueueFilters = (query: any) => {
    const filters: string[] = [];

    // Helper function to parse array parameters correctly
    const parseArrayParam = (param: any): string[] => {
      if (!param) return [];
      
      // If it's already an array, use it directly
      if (Array.isArray(param)) {
        return param.filter(item => item && typeof item === 'string');
      }
      
      // If it's a string, handle comma-separated values or single values
      if (typeof param === 'string') {
        // Split by comma and filter out empty strings
        return param.split(',').map(item => item.trim()).filter(item => item.length > 0);
      }
      
      return [];
    };

    // Helper function to safely quote values for SQL
    const quoteSqlValue = (value: any): string => {
      if (value === null || value === undefined) return 'NULL';
      if (typeof value === 'string') {
        return `'${value.replace(/'/g, "''")}'`; // Escape single quotes
      }
      return String(value);
    };

    // Date range filters
    if (query.from_ts || query.from) {
      const fromDate = query.from_ts || query.from;
      filters.push(`created_at >= ${quoteSqlValue(new Date(fromDate).toISOString())}`);
    }
    if (query.to_ts || query.to) {
      const toDate = query.to_ts || query.to;
      filters.push(`created_at <= ${quoteSqlValue(new Date(toDate).toISOString())}`);
    }

    // Department filter (robust array support)
    if (query.departments) {
      const departments = parseArrayParam(query.departments);
      if (departments.length > 0) {
        const quotedDepts = departments.map(dept => quoteSqlValue(dept)).join(',');
        filters.push(`department = ANY(ARRAY[${quotedDepts}])`);
      }
    }

    // Status filter (robust array support)
    if (query.statuses) {
      const statuses = parseArrayParam(query.statuses);
      if (statuses.length > 0) {
        const quotedStatuses = statuses.map(status => quoteSqlValue(status)).join(',');
        filters.push(`status = ANY(ARRAY[${quotedStatuses}])`);
      }
    }

    // Assignee filter (robust array support)
    if (query.assignees) {
      const assignees = parseArrayParam(query.assignees);
      if (assignees.length > 0) {
        const quotedAssignees = assignees.map(assignee => quoteSqlValue(assignee)).join(',');
        filters.push(`assigned_to = ANY(ARRAY[${quotedAssignees}])`);
      }
    }

    return { filters };
  };

  // Metrics API Route
  app.get("/api/metrics", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser) {
        return res.status(401).json({ message: "Invalid user" });
      }

      // Get all queue items from in-memory storage (all modules)
      const allModules: QueueModule[] = ['ntao', 'assets', 'inventory', 'fleet'];
      const allItems = await storage.getUnifiedQueueItems(allModules, req.query.status);

      // Apply client-side filtering based on query parameters
      let filteredItems = allItems;

      // Date range filtering
      if (req.query.from_ts || req.query.from) {
        const fromDate = new Date(req.query.from_ts || req.query.from);
        filteredItems = filteredItems.filter(item => new Date(item.createdAt) >= fromDate);
      }
      if (req.query.to_ts || req.query.to) {
        const toDate = new Date(req.query.to_ts || req.query.to);
        filteredItems = filteredItems.filter(item => new Date(item.createdAt) <= toDate);
      }

      // Department filtering
      if (req.query.departments) {
        const departments = Array.isArray(req.query.departments) 
          ? req.query.departments 
          : req.query.departments.split(',').map((d: string) => d.trim());
        filteredItems = filteredItems.filter(item => 
          item.department && departments.includes(item.department));
      }

      // Status filtering
      if (req.query.statuses) {
        const statuses = Array.isArray(req.query.statuses)
          ? req.query.statuses
          : req.query.statuses.split(',').map((s: string) => s.trim());
        filteredItems = filteredItems.filter(item => statuses.includes(item.status));
      }

      // Assignee filtering
      if (req.query.assignees) {
        const assignees = Array.isArray(req.query.assignees)
          ? req.query.assignees
          : req.query.assignees.split(',').map((a: string) => a.trim());
        filteredItems = filteredItems.filter(item => 
          item.assignedTo && assignees.includes(item.assignedTo));
      }

      // Transform items to match expected metrics format with calculated time fields
      const metricsData = filteredItems.map(item => {
        const createdAt = new Date(item.createdAt);
        const completedAt = item.completedAt ? new Date(item.completedAt) : null;
        const startedAt = item.startedAt ? new Date(item.startedAt) : null;
        const firstResponseAt = item.firstResponseAt ? new Date(item.firstResponseAt) : null;

        return {
          id: item.id,
          title: item.title,
          description: item.description,
          status: item.status,
          priority: item.priority,
          assignee: item.assignedTo,
          requester_id: item.requesterId,
          department: item.department,
          team: item.team,
          type: item.workflowType,
          data: item.data,
          metadata: item.metadata,
          notes: item.notes,
          completed_at: item.completedAt,
          started_at: item.startedAt,
          first_response_at: item.firstResponseAt,
          created_at: item.createdAt,
          updated_at: item.updatedAt,
          response_time_hours: completedAt ? 
            (completedAt.getTime() - createdAt.getTime()) / (1000 * 60 * 60) : null,
          first_response_time_hours: firstResponseAt ? 
            (firstResponseAt.getTime() - createdAt.getTime()) / (1000 * 60 * 60) : null,
          time_to_start_hours: startedAt ? 
            (startedAt.getTime() - createdAt.getTime()) / (1000 * 60 * 60) : null,
        };
      });

      res.json(metricsData);

    } catch (error) {
      console.error('Error fetching metrics:', error);
      res.status(500).json({ message: "Failed to fetch metrics" });
    }
  });

  // CSV Export Route (with role-based authorization and formula injection prevention)
  app.get("/api/exports/requests.csv", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser) {
        return res.status(401).json({ message: "Invalid user" });
      }

      // Server-side authorization: require superadmin or admin role for exports
      if (!currentUser || !['superadmin', 'admin'].includes(currentUser.role)) {
        return res.status(403).json({ 
          message: "Access denied. Export functionality requires superadmin or admin role." 
        });
      }

      const { filters } = buildQueueFilters(req.query);
      const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

      const query = `
        SELECT 
          id,
          title,
          description,
          status,
          priority,
          assigned_to as assignee,
          requester_id,
          department,
          team,
          workflow_type as type,
          notes,
          scheduled_for,
          attempts,
          last_error,
          completed_at,
          started_at,
          first_response_at,
          workflow_id,
          workflow_step,
          created_at,
          updated_at
        FROM queue_items 
        ${whereClause}
        ORDER BY created_at DESC
      `;

      const result = await db.execute(sql.raw(query));
      const rows = result.rows;

      // Sanitize all rows to prevent formula injection
      const sanitizedRows = (rows as any[]).map(row => sanitizeRowForExport(row));

      // Create CSV content
      const columns = [
        'id', 'title', 'description', 'status', 'priority', 'assignee', 'requester_id',
        'department', 'team', 'type', 'notes', 'scheduled_for', 'attempts', 'last_error',
        'completed_at', 'started_at', 'first_response_at', 'workflow_id', 'workflow_step',
        'created_at', 'updated_at'
      ];

      const csvData = await new Promise<string>((resolve, reject) => {
        csvStringify(sanitizedRows, {
          header: true,
          columns: columns
        }, (err, output) => {
          if (err) reject(err);
          else resolve(output);
        });
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="requests_${new Date().toISOString().split('T')[0]}.csv"`);
      res.send(csvData);

    } catch (error) {
      console.error('Error generating CSV export:', error);
      res.status(500).json({ message: "Failed to generate CSV export" });
    }
  });

  // Excel Export Route (with role-based authorization and formula injection prevention)
  app.get("/api/exports/requests.xlsx", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser) {
        return res.status(401).json({ message: "Invalid user" });
      }

      // Server-side authorization: require superadmin or admin role for exports
      if (!currentUser || !['superadmin', 'admin'].includes(currentUser.role)) {
        return res.status(403).json({ 
          message: "Access denied. Export functionality requires superadmin or admin role." 
        });
      }

      const { filters } = buildQueueFilters(req.query);
      const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

      const query = `
        SELECT 
          id,
          title,
          description,
          status,
          priority,
          assigned_to as assignee,
          requester_id,
          department,
          team,
          workflow_type as type,
          notes,
          scheduled_for,
          attempts,
          last_error,
          completed_at,
          started_at,
          first_response_at,
          workflow_id,
          workflow_step,
          created_at,
          updated_at,
          CASE 
            WHEN completed_at IS NOT NULL AND created_at IS NOT NULL THEN
              EXTRACT(EPOCH FROM (completed_at - created_at)) / 3600
            ELSE NULL
          END as response_time_hours,
          CASE 
            WHEN first_response_at IS NOT NULL AND created_at IS NOT NULL THEN
              EXTRACT(EPOCH FROM (first_response_at - created_at)) / 3600
            ELSE NULL  
          END as first_response_time_hours
        FROM queue_items 
        ${whereClause}
        ORDER BY created_at DESC
      `;

      const result = await db.execute(sql.raw(query));
      const rows = result.rows;

      // Sanitize all rows to prevent formula injection
      const sanitizedRows = (rows as any[]).map(row => sanitizeRowForExport(row));

      // Create Excel workbook
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Requests');

      // Define columns
      worksheet.columns = [
        { header: 'ID', key: 'id', width: 36 },
        { header: 'Title', key: 'title', width: 30 },
        { header: 'Description', key: 'description', width: 50 },
        { header: 'Status', key: 'status', width: 15 },
        { header: 'Priority', key: 'priority', width: 15 },
        { header: 'Assignee', key: 'assignee', width: 25 },
        { header: 'Requester ID', key: 'requester_id', width: 25 },
        { header: 'Department', key: 'department', width: 20 },
        { header: 'Team', key: 'team', width: 20 },
        { header: 'Type', key: 'type', width: 20 },
        { header: 'Notes', key: 'notes', width: 40 },
        { header: 'Scheduled For', key: 'scheduled_for', width: 20 },
        { header: 'Attempts', key: 'attempts', width: 10 },
        { header: 'Last Error', key: 'last_error', width: 40 },
        { header: 'Completed At', key: 'completed_at', width: 20 },
        { header: 'Started At', key: 'started_at', width: 20 },
        { header: 'First Response At', key: 'first_response_at', width: 20 },
        { header: 'Response Time (Hours)', key: 'response_time_hours', width: 20 },
        { header: 'First Response Time (Hours)', key: 'first_response_time_hours', width: 25 },
        { header: 'Workflow ID', key: 'workflow_id', width: 25 },
        { header: 'Workflow Step', key: 'workflow_step', width: 15 },
        { header: 'Created At', key: 'created_at', width: 20 },
        { header: 'Updated At', key: 'updated_at', width: 20 }
      ];

      // Add sanitized data rows
      sanitizedRows.forEach((row: any) => {
        worksheet.addRow(row);
      });

      // Style header row
      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
      };

      // Set response headers
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="requests_${new Date().toISOString().split('T')[0]}.xlsx"`);

      // Write to response
      await workbook.xlsx.write(res);
      res.end();

    } catch (error) {
      console.error('Error generating Excel export:', error);
      res.status(500).json({ message: "Failed to generate Excel export" });
    }
  });

  // Template management API routes
  console.log("Registering template management routes...");
  
  // GET /api/templates - fetch all templates
  app.get("/api/templates", requireAuth, async (req: any, res) => {
    try {
      // Check if user is superadmin
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || currentUser.role !== 'superadmin') {
        return res.status(403).json({ message: "Access denied. Template management requires superadmin role." });
      }

      const templates = await storage.getAllTemplates();
      res.json(templates);
    } catch (error) {
      console.error("Error fetching templates:", error);
      res.status(500).json({ message: "Failed to fetch templates" });
    }
  });

  // POST /api/templates - create new template
  app.post("/api/templates", requireAuth, async (req: any, res) => {
    try {
      // Check if user is superadmin
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || currentUser.role !== 'superadmin') {
        return res.status(403).json({ message: "Access denied. Template management requires superadmin role." });
      }

      const templateData = insertTemplateSchema.parse(req.body);
      
      // Generate server-side ID using consistent pattern: department_workflowType_version
      const generatedId = `${templateData.department.toLowerCase()}_${templateData.workflowType}_v${templateData.version.replace(/[^a-zA-Z0-9]/g, '')}`;
      
      // Check if generated template ID already exists
      const existingTemplate = await storage.getTemplateById(generatedId);
      if (existingTemplate) {
        return res.status(400).json({ message: `Template ID '${generatedId}' already exists. Try a different version or workflow type.` });
      }

      const template = await storage.upsertTemplate({
        ...templateData,
        id: generatedId
      });
      
      // Log activity
      await storage.createActivityLog({
        userId: currentUser.id,
        action: "template_created",
        entityType: "template",
        entityId: template.id,
        details: `Template ${template.name} created`,
      });

      res.status(201).json(template);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid template data", errors: error.errors });
      }
      console.error("Error creating template:", error);
      res.status(500).json({ message: "Failed to create template" });
    }
  });

  // PATCH /api/templates/:id - update template
  app.patch("/api/templates/:id", requireAuth, async (req: any, res) => {
    try {
      // Check if user is superadmin
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || currentUser.role !== 'superadmin') {
        return res.status(403).json({ message: "Access denied. Template management requires superadmin role." });
      }

      const { id } = req.params;
      
      // Create strict partial schema that only allows whitelisted updateable fields
      // Omit immutable fields (id, createdAt) and reject unknown keys
      const updateTemplateSchema = insertTemplateSchema
        .omit({ id: true })  // id is already omitted in insertTemplateSchema creation
        .partial()
        .strict(); // Reject unknown keys
      
      const updates = updateTemplateSchema.parse(req.body);
      
      const template = await storage.updateTemplate(id, updates);
      if (!template) {
        return res.status(404).json({ message: "Template not found" });
      }

      // Log activity
      await storage.createActivityLog({
        userId: currentUser.id,
        action: "template_updated",
        entityType: "template", 
        entityId: template.id,
        details: `Template ${template.name} updated`,
      });

      res.json(template);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid template data", errors: error.errors });
      }
      console.error("Error updating template:", error);
      res.status(500).json({ message: "Failed to update template" });
    }
  });

  // DELETE /api/templates/:id - delete template
  app.delete("/api/templates/:id", requireAuth, async (req: any, res) => {
    try {
      // Check if user is superadmin
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || currentUser.role !== 'superadmin') {
        return res.status(403).json({ message: "Access denied. Template management requires superadmin role." });
      }

      const { id } = req.params;
      
      // Get template info for logging before deletion
      const template = await storage.getTemplateById(id);
      if (!template) {
        return res.status(404).json({ message: "Template not found" });
      }

      const deleted = await storage.deleteTemplate(id);
      if (!deleted) {
        return res.status(404).json({ message: "Template not found" });
      }

      // Log activity
      await storage.createActivityLog({
        userId: currentUser.id,
        action: "template_deleted",
        entityType: "template",
        entityId: id,
        details: `Template ${template.name} deleted`,
      });

      res.json({ message: "Template deleted successfully" });
    } catch (error) {
      console.error("Error deleting template:", error);
      res.status(500).json({ message: "Failed to delete template" });
    }
  });

  // PATCH /api/templates/:id/toggle-status - toggle template active status
  app.patch("/api/templates/:id/toggle-status", requireAuth, async (req: any, res) => {
    try {
      // Check if user is superadmin
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || currentUser.role !== 'superadmin') {
        return res.status(403).json({ message: "Access denied. Template management requires superadmin role." });
      }

      const { id } = req.params;
      
      const template = await storage.toggleTemplateStatus(id);
      if (!template) {
        return res.status(404).json({ message: "Template not found" });
      }

      // Log activity
      await storage.createActivityLog({
        userId: currentUser.id,
        action: "template_status_toggled",
        entityType: "template",
        entityId: template.id,
        details: `Template ${template.name} status changed to ${template.isActive ? 'active' : 'inactive'}`,
      });

      res.json(template);
    } catch (error) {
      console.error("Error toggling template status:", error);
      res.status(500).json({ message: "Failed to toggle template status" });
    }
  });

  // Holman API Integration Routes
  console.log("Registering Holman API routes...");

  // Test connection endpoint
  app.get("/api/holman/test", requireAuth, async (req: any, res) => {
    try {
      const result = await holmanApiService.testConnection();
      res.json(result);
    } catch (error) {
      console.error("Error testing Holman connection:", error);
      res.status(500).json({ success: false, message: "Failed to test connection" });
    }
  });

  // Vehicles endpoints
  app.get("/api/holman/vehicles", requireAuth, async (req: any, res) => {
    try {
      const { lesseeCode, statusCodes, soldDateCode, pageNumber, pageSize } = req.query;
      const result = await holmanApiService.getVehicles(
        lesseeCode,
        statusCodes,
        soldDateCode,
        pageNumber ? parseInt(pageNumber) : 1,
        pageSize ? parseInt(pageSize) : 100
      );
      res.json(result);
    } catch (error: any) {
      console.error("Error fetching Holman vehicles:", error);
      // Try to extract the actual API error message if available
      const errorMessage = error.message || "Failed to fetch vehicles from Holman API";
      res.status(500).json({ message: errorMessage });
    }
  });

  app.post("/api/holman/vehicles/query", requireAuth, async (req: any, res) => {
    try {
      console.log('[Holman] Custom query request body:', JSON.stringify(req.body, null, 2));
      const result = await holmanApiService.queryVehiclesCustom(req.body);
      res.json(result);
    } catch (error) {
      console.error("Error querying Holman vehicles:", error);
      res.status(500).json({ message: "Failed to query vehicles from Holman API" });
    }
  });

  app.post("/api/holman/vehicles/submit", requireAuth, async (req: any, res) => {
    try {
      const result = await holmanApiService.submitVehicle(req.body);
      res.json(result);
    } catch (error) {
      console.error("Error submitting Holman vehicle:", error);
      res.status(500).json({ message: "Failed to submit vehicle to Holman API" });
    }
  });

  // Contacts endpoints
  app.get("/api/holman/contacts", requireAuth, async (req: any, res) => {
    try {
      const { lesseeCode, pageNumber, pageSize } = req.query;
      const result = await holmanApiService.getContacts(
        lesseeCode,
        pageNumber ? parseInt(pageNumber) : 1,
        pageSize ? parseInt(pageSize) : 100
      );
      res.json(result);
    } catch (error) {
      console.error("Error fetching Holman contacts:", error);
      res.status(500).json({ message: "Failed to fetch contacts from Holman API" });
    }
  });

  app.post("/api/holman/contacts/query", requireAuth, async (req: any, res) => {
    try {
      const result = await holmanApiService.queryContactsCustom(req.body);
      res.json(result);
    } catch (error) {
      console.error("Error querying Holman contacts:", error);
      res.status(500).json({ message: "Failed to query contacts from Holman API" });
    }
  });

  app.post("/api/holman/contacts/submit", requireAuth, async (req: any, res) => {
    try {
      const result = await holmanApiService.submitContact(req.body);
      res.json(result);
    } catch (error) {
      console.error("Error submitting Holman contact:", error);
      res.status(500).json({ message: "Failed to submit contact to Holman API" });
    }
  });

  // Maintenance endpoints
  app.get("/api/holman/maintenance", requireAuth, async (req: any, res) => {
    try {
      const { lesseeCode, pageNumber, pageSize } = req.query;
      const result = await holmanApiService.getMaintenance(
        lesseeCode,
        pageNumber ? parseInt(pageNumber) : 1,
        pageSize ? parseInt(pageSize) : 100
      );
      res.json(result);
    } catch (error) {
      console.error("Error fetching Holman maintenance:", error);
      res.status(500).json({ message: "Failed to fetch maintenance from Holman API" });
    }
  });

  app.post("/api/holman/maintenance/query", requireAuth, async (req: any, res) => {
    try {
      const result = await holmanApiService.queryMaintenanceCustom(req.body);
      res.json(result);
    } catch (error) {
      console.error("Error querying Holman maintenance:", error);
      res.status(500).json({ message: "Failed to query maintenance from Holman API" });
    }
  });

  app.post("/api/holman/maintenance/submit", requireAuth, async (req: any, res) => {
    try {
      const result = await holmanApiService.submitMaintenance(req.body);
      res.json(result);
    } catch (error) {
      console.error("Error submitting Holman maintenance:", error);
      res.status(500).json({ message: "Failed to submit maintenance to Holman API" });
    }
  });

  // Odometer endpoints
  app.get("/api/holman/odometer", requireAuth, async (req: any, res) => {
    try {
      const { lesseeCode, pageNumber, pageSize } = req.query;
      const result = await holmanApiService.getOdometer(
        lesseeCode,
        pageNumber ? parseInt(pageNumber) : 1,
        pageSize ? parseInt(pageSize) : 100
      );
      res.json(result);
    } catch (error) {
      console.error("Error fetching Holman odometer:", error);
      res.status(500).json({ message: "Failed to fetch odometer from Holman API" });
    }
  });

  app.post("/api/holman/odometer/query", requireAuth, async (req: any, res) => {
    try {
      const result = await holmanApiService.queryOdometerCustom(req.body);
      res.json(result);
    } catch (error) {
      console.error("Error querying Holman odometer:", error);
      res.status(500).json({ message: "Failed to query odometer from Holman API" });
    }
  });

  app.post("/api/holman/odometer/submit", requireAuth, async (req: any, res) => {
    try {
      const result = await holmanApiService.submitOdometer(req.body);
      res.json(result);
    } catch (error) {
      console.error("Error submitting Holman odometer:", error);
      res.status(500).json({ message: "Failed to submit odometer to Holman API" });
    }
  });

  console.log("Registering Snowflake API routes...");
  const { getSnowflakeService, isSnowflakeConfigured } = await import("./snowflake-service");

  app.get("/api/snowflake/status", requireAuth, async (req: any, res) => {
    try {
      const configured = isSnowflakeConfigured();
      res.json({ configured });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/snowflake/test", requireAuth, async (req: any, res) => {
    try {
      const snowflakeService = getSnowflakeService();
      const result = await snowflakeService.testConnection();
      res.json(result);
    } catch (error: any) {
      console.error("Error testing Snowflake connection:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post("/api/snowflake/query", requireAuth, async (req: any, res) => {
    try {
      const { sql } = req.body;
      if (!sql) {
        return res.status(400).json({ message: "SQL query is required" });
      }
      
      const snowflakeService = getSnowflakeService();
      const results = await snowflakeService.executeQuery(sql);
      res.json({ success: true, data: results });
    } catch (error: any) {
      console.error("Error executing Snowflake query:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Snowflake Sync Routes
  console.log("Registering Snowflake Sync API routes...");
  const { getSnowflakeSyncService } = await import("./snowflake-sync-service");

  app.get("/api/snowflake/sync/status", requireAuth, async (req: any, res) => {
    try {
      const syncService = getSnowflakeSyncService();
      const status = await syncService.getSyncStatus();
      res.json(status);
    } catch (error: any) {
      console.error("Error getting sync status:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/snowflake/sync/termed-techs", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || (currentUser.role !== 'superadmin' && currentUser.role !== 'admin')) {
        return res.status(403).json({ message: "Only superadmin users can trigger manual syncs" });
      }
      
      const syncService = getSnowflakeSyncService();
      const result = await syncService.syncTermedTechs('manual');
      res.json(result);
    } catch (error: any) {
      console.error("Error syncing termed techs:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post("/api/snowflake/sync/all-techs", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || (currentUser.role !== 'superadmin' && currentUser.role !== 'admin')) {
        return res.status(403).json({ message: "Only superadmin users can trigger manual syncs" });
      }
      
      const syncService = getSnowflakeSyncService();
      const result = await syncService.syncAllTechs('manual');
      res.json(result);
    } catch (error: any) {
      console.error("Error syncing all techs:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Get termed techs list
  app.get("/api/termed-techs", requireAuth, async (req: any, res) => {
    try {
      const techs = await storage.getTermedTechs();
      res.json(techs);
    } catch (error: any) {
      console.error("Error getting termed techs:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Get all techs list (complete roster)
  app.get("/api/all-techs", requireAuth, async (req: any, res) => {
    try {
      const techs = await storage.getAllTechs();
      res.json(techs);
    } catch (error: any) {
      console.error("Error getting all techs:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Get sync logs
  app.get("/api/sync-logs", requireAuth, async (req: any, res) => {
    try {
      const logs = await storage.getSyncLogs();
      res.json(logs);
    } catch (error: any) {
      console.error("Error getting sync logs:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ============================================
  // Field Mapping API Routes
  // ============================================
  console.log("Registering Field Mapping API routes...");

  // Integration Data Sources
  app.get("/api/mapping/sources", requireAuth, async (req: any, res) => {
    try {
      const sources = await storage.getIntegrationDataSources();
      res.json(sources);
    } catch (error: any) {
      console.error("Error getting data sources:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/mapping/sources/:id", requireAuth, async (req: any, res) => {
    try {
      const source = await storage.getIntegrationDataSource(req.params.id);
      if (!source) {
        return res.status(404).json({ message: "Data source not found" });
      }
      res.json(source);
    } catch (error: any) {
      console.error("Error getting data source:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/mapping/sources", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || currentUser.role !== 'superadmin') {
        return res.status(403).json({ message: "Only superadmin users can create data sources" });
      }
      const source = await storage.createIntegrationDataSource(req.body);
      res.status(201).json(source);
    } catch (error: any) {
      console.error("Error creating data source:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/mapping/sources/:id", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || currentUser.role !== 'superadmin') {
        return res.status(403).json({ message: "Only superadmin users can update data sources" });
      }
      const source = await storage.updateIntegrationDataSource(req.params.id, req.body);
      if (!source) {
        return res.status(404).json({ message: "Data source not found" });
      }
      res.json(source);
    } catch (error: any) {
      console.error("Error updating data source:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/mapping/sources/:id", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || currentUser.role !== 'superadmin') {
        return res.status(403).json({ message: "Only superadmin users can delete data sources" });
      }
      const deleted = await storage.deleteIntegrationDataSource(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Data source not found" });
      }
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting data source:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Data Source Fields
  app.get("/api/mapping/sources/:sourceId/fields", requireAuth, async (req: any, res) => {
    try {
      const fields = await storage.getDataSourceFields(req.params.sourceId);
      res.json(fields);
    } catch (error: any) {
      console.error("Error getting fields:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/mapping/sources/:sourceId/fields", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || currentUser.role !== 'superadmin') {
        return res.status(403).json({ message: "Only superadmin users can create fields" });
      }
      const field = await storage.createDataSourceField({
        ...req.body,
        sourceId: req.params.sourceId
      });
      res.status(201).json(field);
    } catch (error: any) {
      console.error("Error creating field:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/mapping/sources/:sourceId/fields/bulk", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || currentUser.role !== 'superadmin') {
        return res.status(403).json({ message: "Only superadmin users can create fields" });
      }
      const fields = await storage.createDataSourceFieldsBulk(
        req.body.fields.map((f: any) => ({ ...f, sourceId: req.params.sourceId }))
      );
      res.status(201).json(fields);
    } catch (error: any) {
      console.error("Error creating fields:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Mapping Sets
  app.get("/api/mapping/sets", requireAuth, async (req: any, res) => {
    try {
      const sets = await storage.getMappingSets();
      res.json(sets);
    } catch (error: any) {
      console.error("Error getting mapping sets:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/mapping/sets/:id", requireAuth, async (req: any, res) => {
    try {
      const set = await storage.getMappingSet(req.params.id);
      if (!set) {
        return res.status(404).json({ message: "Mapping set not found" });
      }
      
      // Also fetch nodes and mappings
      const nodes = await storage.getMappingNodes(req.params.id);
      const mappings = await storage.getFieldMappings(req.params.id);
      
      res.json({ ...set, nodes, mappings });
    } catch (error: any) {
      console.error("Error getting mapping set:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/mapping/sets", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || currentUser.role !== 'superadmin') {
        return res.status(403).json({ message: "Only superadmin users can create mapping sets" });
      }
      const set = await storage.createMappingSet({
        ...req.body,
        createdBy: currentUser.id
      });
      res.status(201).json(set);
    } catch (error: any) {
      console.error("Error creating mapping set:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/mapping/sets/:id", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || currentUser.role !== 'superadmin') {
        return res.status(403).json({ message: "Only superadmin users can update mapping sets" });
      }
      const set = await storage.updateMappingSet(req.params.id, req.body);
      if (!set) {
        return res.status(404).json({ message: "Mapping set not found" });
      }
      res.json(set);
    } catch (error: any) {
      console.error("Error updating mapping set:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/mapping/sets/:id", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || currentUser.role !== 'superadmin') {
        return res.status(403).json({ message: "Only superadmin users can delete mapping sets" });
      }
      const deleted = await storage.deleteMappingSet(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Mapping set not found" });
      }
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting mapping set:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Mapping Nodes (positions on canvas)
  app.put("/api/mapping/sets/:id/nodes", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || currentUser.role !== 'superadmin') {
        return res.status(403).json({ message: "Only superadmin users can update nodes" });
      }
      const nodes = await storage.upsertMappingNodes(req.params.id, req.body.nodes || []);
      res.json(nodes);
    } catch (error: any) {
      console.error("Error upserting nodes:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Field Mappings (connections)
  app.put("/api/mapping/sets/:id/mappings", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || currentUser.role !== 'superadmin') {
        return res.status(403).json({ message: "Only superadmin users can update mappings" });
      }
      const mappings = await storage.upsertFieldMappings(req.params.id, req.body.mappings || []);
      res.json(mappings);
    } catch (error: any) {
      console.error("Error upserting mappings:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/mapping/sets/:id/mappings", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || currentUser.role !== 'superadmin') {
        return res.status(403).json({ message: "Only superadmin users can create mappings" });
      }
      const mapping = await storage.createFieldMapping({
        ...req.body,
        mappingSetId: req.params.id
      });
      res.status(201).json(mapping);
    } catch (error: any) {
      console.error("Error creating mapping:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/mapping/mappings/:id", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || currentUser.role !== 'superadmin') {
        return res.status(403).json({ message: "Only superadmin users can delete mappings" });
      }
      const deleted = await storage.deleteFieldMapping(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Mapping not found" });
      }
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting mapping:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Seed default data sources from known integrations
  app.post("/api/mapping/seed-sources", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || currentUser.role !== 'superadmin') {
        return res.status(403).json({ message: "Only superadmin users can seed data sources" });
      }

      const defaultSources = [
        {
          name: 'snowflake_all_techs',
          displayName: 'Snowflake: All Technicians',
          sourceType: 'snowflake',
          connectionInfo: JSON.stringify({ table: 'DRIVELINE_ALL_TECHS' }),
          description: 'Complete technician roster from Snowflake data warehouse'
        },
        {
          name: 'snowflake_termed_techs',
          displayName: 'Snowflake: Termed Technicians',
          sourceType: 'snowflake',
          connectionInfo: JSON.stringify({ table: 'DRIVELINE_TERMED_TECHS_LAST30' }),
          description: 'Terminated technicians from the last 30 days'
        },
        {
          name: 'holman_vehicles',
          displayName: 'Holman API: Vehicles',
          sourceType: 'holman',
          connectionInfo: JSON.stringify({ endpoint: '/vehicles' }),
          description: 'Vehicle data from Holman Fleet API'
        },
        {
          name: 'holman_contacts',
          displayName: 'Holman API: Contacts',
          sourceType: 'holman',
          connectionInfo: JSON.stringify({ endpoint: '/contacts' }),
          description: 'Contact data from Holman Fleet API'
        },
        {
          name: 'internal_queue_items',
          displayName: 'Internal: Queue Items',
          sourceType: 'internal',
          connectionInfo: JSON.stringify({ table: 'queue_items' }),
          description: 'Internal queue items table'
        },
        {
          name: 'internal_vehicles',
          displayName: 'Internal: Vehicles',
          sourceType: 'internal',
          connectionInfo: JSON.stringify({ table: 'vehicles' }),
          description: 'Internal vehicles table'
        },
        {
          name: 'page_offboarding_form',
          displayName: 'Page: Offboarding Form',
          sourceType: 'page_object',
          connectionInfo: JSON.stringify({ page: '/offboard-technician' }),
          description: 'Offboarding form fields'
        },
        {
          name: 'page_onboarding_form',
          displayName: 'Page: Onboarding Form',
          sourceType: 'page_object',
          connectionInfo: JSON.stringify({ page: '/onboard-hire' }),
          description: 'Onboarding form fields'
        }
      ];

      const created = [];
      for (const source of defaultSources) {
        try {
          const existing = await storage.getIntegrationDataSources();
          if (!existing.find(s => s.name === source.name)) {
            const newSource = await storage.createIntegrationDataSource(source);
            created.push(newSource);
          }
        } catch (e) {
          console.error(`Error creating source ${source.name}:`, e);
        }
      }

      res.json({ message: `Seeded ${created.length} data sources`, sources: created });
    } catch (error: any) {
      console.error("Error seeding data sources:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ============================================
  // TPMS API Routes
  // ============================================
  console.log("Registering TPMS API routes...");
  const { getTPMSService } = await import("./tpms-service");

  // Test TPMS connection
  app.get("/api/tpms/test", requireAuth, async (req: any, res) => {
    try {
      const tpmsService = getTPMSService();
      const result = await tpmsService.testConnection();
      res.json(result);
    } catch (error: any) {
      console.error("Error testing TPMS connection:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Get tech info by enterprise ID (LDAP ID)
  app.get("/api/tpms/techinfo/:enterpriseId", requireAuth, async (req: any, res) => {
    try {
      const tpmsService = getTPMSService();
      const techInfo = await tpmsService.getTechInfo(req.params.enterpriseId);
      res.json({ success: true, data: techInfo });
    } catch (error: any) {
      console.error("Error getting tech info:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Look up truck number by enterprise ID
  app.get("/api/tpms/truck/:enterpriseId", requireAuth, async (req: any, res) => {
    try {
      const tpmsService = getTPMSService();
      const result = await tpmsService.lookupTruckByEnterpriseId(req.params.enterpriseId);
      res.json(result);
    } catch (error: any) {
      console.error("Error looking up truck:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Check if TPMS is configured
  app.get("/api/tpms/status", requireAuth, async (req: any, res) => {
    try {
      const tpmsService = getTPMSService();
      res.json({ 
        configured: tpmsService.isConfigured(),
        message: tpmsService.isConfigured() 
          ? 'TPMS is configured and ready' 
          : 'TPMS is not fully configured. Please set TPMS_AUTH_ENDPOINT, TPMS_API_ENDPOINT, and TPMS_CLIENT_SECRET.'
      });
    } catch (error: any) {
      console.error("Error checking TPMS status:", error);
      res.status(500).json({ configured: false, message: error.message });
    }
  });

  console.log("=== ROUTE REGISTRATION COMPLETED ===");
  console.log("Registered API routes:");
  app._router.stack
    .filter((layer: any) => layer.route && layer.route.path && layer.route.path.startsWith('/api'))
    .forEach((layer: any) => {
      const methods = Object.keys(layer.route.methods).join(', ').toUpperCase();
      console.log(`  ${methods} ${layer.route.path}`);
    });

  const httpServer = createServer(app);
  return httpServer;
}
