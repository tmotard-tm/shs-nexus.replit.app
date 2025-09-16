import type { Express } from "express";
import { createServer, type Server } from "http";
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { storage } from "./storage";
import { insertRequestSchema, insertUserSchema, insertApiConfigurationSchema, insertQueueItemSchema, insertStorageSpotSchema, insertVehicleSchema, QueueModule, saveProgressSchema, completeQueueItemSchema, assignQueueItemSchema, anonymousQueueItemSchema, anonymousVehicleSchema, anonymousStorageSpotSchema, anonymousVehicleAssignmentSchema, anonymousOnboardingSchema, anonymousOffboardingSchema, anonymousByovEnrollmentSchema, enhancedCompleteQueueItemSchema } from "@shared/schema";
import { z } from "zod";
import { sendEmail, createCreditCardDeactivationEmail } from "./email-service";
import { activeVehicles } from "../client/src/data/fleetData";
import { templateLoader, getTemplateForTask } from "../shared/template-loader";
import multer from "multer";
import rateLimit from "express-rate-limit";
import DOMPurify from "isomorphic-dompurify";

// Persistent session store (survives server restarts)
const SESSIONS_FILE = './sessions.json';
const sessions = new Map<string, { userId: string; username: string; expiresAt: Date }>();

// Load sessions from file on startup

try {
  if (existsSync(SESSIONS_FILE)) {
    const savedSessions = JSON.parse(readFileSync(SESSIONS_FILE, 'utf-8'));
    const now = new Date();
    for (const [sessionId, sessionData] of Object.entries(savedSessions)) {
      const session = sessionData as any;
      // Only restore sessions that haven't expired
      if (new Date(session.expiresAt) > now) {
        sessions.set(sessionId, {
          userId: session.userId,
          username: session.username,
          expiresAt: new Date(session.expiresAt)
        });
      }
    }
    console.log(`Restored ${sessions.size} valid sessions from storage`);
  }
} catch (error) {
  console.warn('Failed to load sessions from storage:', error);
}

// Save sessions to file
function saveSessions() {
  try {
    const sessionsObj = Object.fromEntries(sessions);
    writeFileSync(SESSIONS_FILE, JSON.stringify(sessionsObj, null, 2));
  } catch (error) {
    console.warn('Failed to save sessions:', error);
  }
}

// Auto-save sessions every 30 seconds
setInterval(saveSessions, 30000);

// Human verification session store
const humanVerificationSessions = new Map<string, { verified: boolean; expiresAt: Date; originalUrl: string }>();

// Rate limiting store for anonymous form submissions
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 5 * 60 * 1000; // 5 minutes
const RATE_LIMIT_MAX_REQUESTS = 10; // 10 requests per window

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
function requireAuth(req: any, res: any, next: any): any {
  const cookieHeader = req.headers.cookie;
  const sessionId = cookieHeader?.match(/sessionId=([^;]+)/)?.[1];
  
  if (!sessionId) {
    return res.status(401).json({ message: "Authentication required" });
  }
  
  const session = sessions.get(sessionId);
  if (!session || session.expiresAt < new Date()) {
    sessions.delete(sessionId);
    return res.status(401).json({ message: "Session expired" });
  }
  
  req.user = { id: session.userId, username: session.username };
  return next();
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
  // Auth routes
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { enterpriseId, password } = req.body;
      const user = await storage.getUserByUsername(enterpriseId);
      
      if (!user || user.password !== password) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      // Create session with longer timeout for better UX
      const sessionId = Math.random().toString(36).substring(2) + Date.now().toString(36);
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
      
      sessions.set(sessionId, {
        userId: user.id,
        username: user.username,
        expiresAt
      });
      
      // Save sessions immediately after creating new one
      saveSessions();

      // Set httpOnly cookie
      res.cookie('sessionId', sessionId, {
        httpOnly: true,
        secure: false, // Set to true in production with HTTPS
        sameSite: 'lax',
        expires: expiresAt
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

      const user = await storage.createUser(userData);
      
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

  // Human verification routes for form access
  app.post("/api/forms/verify-human", checkAnonymousRateLimit, async (req, res) => {
    try {
      const { timestamp, originalUrl } = req.body;
      
      // Simple validation: must have timestamp and URL
      if (!timestamp || !originalUrl) {
        return res.status(400).json({ message: "Invalid verification request" });
      }
      
      // Basic bot detection: check if request was too fast (less than 1 second)
      const requestTime = Date.now() - timestamp;
      if (requestTime < 1000) {
        return res.status(429).json({ message: "Verification failed: too fast" });
      }
      
      // Create verification session
      const verificationId = Math.random().toString(36).substring(2) + Date.now().toString(36);
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      
      humanVerificationSessions.set(verificationId, {
        verified: true,
        expiresAt,
        originalUrl: sanitizeInput(originalUrl)
      });
      
      // Set httpOnly cookie for verification
      res.cookie('humanVerified', verificationId, {
        httpOnly: true,
        secure: false, // Set to true in production with HTTPS
        sameSite: 'lax',
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

  // User management routes (restricted to superadmin and admin only)
  app.get("/api/users", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || (currentUser.role !== 'superadmin' && currentUser.role !== 'admin')) {
        return res.status(403).json({ message: "Access denied. User management requires superadmin or admin role." });
      }
      
      const users = await storage.getUsers();
      // Remove passwords from response
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
      const updates = req.body;
      
      // Remove password and id from updates if present
      delete updates.password;
      delete updates.id;
      delete updates.createdAt;

      const updatedUser = await storage.updateUser(id, updates);
      if (!updatedUser) {
        return res.status(404).json({ message: "User not found" });
      }

      // Log activity
      await storage.createActivityLog({
        userId: id,
        action: "user_updated",
        entityType: "user",
        entityId: id,
        details: `User ${updatedUser.username} updated`,
      });

      res.json({ ...updatedUser, password: undefined });
    } catch (error) {
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
      
      const user = await storage.getUser(id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const deleted = await storage.deleteUser(id);
      if (!deleted) {
        return res.status(404).json({ message: "User not found" });
      }

      // Log activity
      await storage.createActivityLog({
        userId: id,
        action: "user_deleted",
        entityType: "user",
        entityId: id,
        details: `User ${user.username} deleted`,
      });

      res.json({ message: "User deleted successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete user" });
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
      const workflowId = Math.random().toString(36).substring(2) + Date.now().toString(36);
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
              title: "Stop Truck Stock Replenishment",
              description: `Stop replenishment for ${offboardingData.techName || 'technician'}`,
              priority: "high",
              requesterId: "anonymous",
              department: "FLEET",
              data: JSON.stringify(offboardingData),
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
              title: "Full Truck Count & Return",
              description: `Perform full inventory count for ${offboardingData.techName || 'technician'}`,
              priority: "high",
              requesterId: "anonymous",
              department: "INVENTORY",
              data: JSON.stringify(offboardingData),
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
              title: "Collect Company Assets",
              description: `Collect all company assets from ${offboardingData.techName || 'technician'}`,
              priority: "high",
              requesterId: "anonymous",
              department: "ASSETS",
              data: JSON.stringify(offboardingData),
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
              title: "Access Removal / Separation Notice",
              description: `Process access removal for ${offboardingData.techName || 'technician'}`,
              priority: "high",
              requesterId: "anonymous",
              department: "NTAO",
              data: JSON.stringify(offboardingData),
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
      
      if (!["FLEET", "INVENTORY", "ASSETS", "NTAO"].includes(department.toUpperCase())) {
        return res.status(400).json({ message: "Invalid department" });
      }

      const template = await getTemplateForTask(workflowType, department.toLowerCase() as QueueModule);
      
      if (template) {
        res.json({ template });
      } else {
        res.status(404).json({ 
          message: "Template not found",
          error: `No template available for workflow ${workflowType} in department ${department}`
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

  app.get("/api/work-templates/validate/all", requireAuth, async (req, res) => {
    try {
      const result = await templateLoader.validateAllTemplates();
      res.json(result);
    } catch (error) {
      console.error("Error validating all templates:", error);
      res.status(500).json({ message: "Failed to validate templates" });
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

  const httpServer = createServer(app);
  return httpServer;
}
