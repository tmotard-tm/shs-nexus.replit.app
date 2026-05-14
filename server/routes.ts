import type { Express } from "express";
import { createServer, type Server } from "http";
import { registerVrmRoutes } from "./vrm/routes";
import { initVrmSchema } from "./vrm/init-schema";
import { startNotificationDispatcher } from "./vrm/notification-dispatcher";
import { fetchProfitabilityCheck } from "./vrm/snowflake-queries";
import crypto from 'crypto';
import { storage } from "./storage";
import { insertRequestSchema, insertUserSchema, insertApiConfigurationSchema, insertQueueItemSchema, insertStorageSpotSchema, insertVehicleSchema, insertTemplateSchema, QueueModule, saveProgressSchema, completeQueueItemSchema, assignQueueItemSchema, anonymousQueueItemSchema, anonymousVehicleSchema, anonymousStorageSpotSchema, anonymousVehicleAssignmentSchema, anonymousOnboardingSchema, anonymousOffboardingSchema, anonymousByovEnrollmentSchema, enhancedCompleteQueueItemSchema, securityQuestionSetupSchema, PREDEFINED_SECURITY_QUESTIONS, StoredSecurityQuestion, insertDistrictCostCenterSchema, type User, type RolePermissionSettings } from "@shared/schema";
import { deepMergePermissions, getServerDefaultPermissions } from "./permission-utils";
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
import { toHolmanRef, toTpmsRef, toDisplayNumber, toCanonical } from "./vehicle-number-utils";
import ExcelJS from "exceljs";
import { stringify as csvStringify } from "csv-stringify";
import { db } from "./db";
import { sql, eq, and, or, gte, lte, lt, inArray, asc, desc, isNotNull, isNull, ilike, SQL } from "drizzle-orm";
import { queueItems, vehicleNexusData, holmanVehiclesCache, techVehicleAssignments, onboardingHires, storageSpots, termedTechs, offboardingTruckOverrides, byovCreationAudit, amsVehiclesCache } from "@shared/schema";
import { holmanApiService } from "./holman-api-service";
import { AmsApiService, lookupAmsVinByTruckNumber } from "./ams-api-service";
const amsApiService = new AmsApiService();
import { pmfApiService } from "./pmf-api-service";
import { segnoApiService } from "./segno-api-service";
import { getSamsaraService } from "./samsara-service";
import { detectByov, getInitialToolsTaskStatus, TOOLS_OWNER } from "./byov-utils";
import { getDetectionLane, parseTechDataFromQueueItem, generateReturnToken } from "./return-token-service";
import { registerFleetScopeRoutes } from "./fleet-scope-routes";
import { registerWmsRoutes } from "./wms-engine-routes";
import { wmsEngineService } from "./wms-engine-service";
import { initWebSocket as initFsWebSocket, startScheduledMessageProcessor as startFsScheduledMessages } from "./fleet-scope-reg-messaging";
import { fsDb } from "./fleet-scope-db";
import { initFleetScopeSchema } from "./fleet-scope-schema-init";
// SAML SSO INTEGRATION
import passport from "passport";
import { createSamlStrategy, generateSpMetadata, printSpDetails, getBaseUrl, getSamlConfig } from "./saml-config";

import { mergeRolePermissionWithDefaults, setNestedPermissionValue } from "./permission-utils";

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

// Password reset tokens are now stored in the database via storage.createPasswordResetToken()
// Clean up expired tokens on startup
try {
  storage.cleanExpiredPasswordResetTokens().then(cleanedCount => {
    if (cleanedCount > 0) {
      console.log(`Cleaned up ${cleanedCount} expired password reset tokens from database`);
    }
  }).catch(error => {
    console.warn('Failed to clean expired password reset tokens on startup:', error);
  });
} catch (error) {
  console.warn('Failed to initialize password reset token cleanup:', error);
}

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
    
    // Extract employee identifiers and workflow ID (supports both "employee" and "technician" data formats)
    const employeeId = parsedData?.employee?.employeeId || parsedData?.technician?.employeeId || parsedData?.employeeId;
    const techRacfId = parsedData?.employee?.racfId || parsedData?.techRacfId || parsedData?.employee?.enterpriseId || parsedData?.technician?.enterpriseId || parsedData?.technician?.techRacfid;
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
              const itemEmployeeId = itemData?.employee?.employeeId || itemData?.technician?.employeeId || itemData?.employeeId;
              const itemTechRacfId = itemData?.employee?.racfId || itemData?.techRacfId || itemData?.employee?.enterpriseId || itemData?.technician?.enterpriseId || itemData?.technician?.techRacfid;
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
  if (user.role === 'developer') {
    return true;
  }
  
  // Check departments array for queue access
  if (user.departments && Array.isArray(user.departments)) {
    const requiredDepartment = module.toUpperCase();
    return user.departments.includes(requiredDepartment);
  }
  
  return false;
}

// Get accessible queue modules for a user
function getAccessibleQueueModules(user: any): QueueModule[] {
  if (user.role === 'developer') {
    return ['ntao', 'assets', 'inventory', 'fleet'];
  }
  
  if (user.departments && Array.isArray(user.departments)) {
    return user.departments
      .map((dept: string) => departmentToQueueModule(dept))
      .filter((module: QueueModule | null) => module !== null) as QueueModule[];
  }
  
  return [];
}

// Auth middleware that allows either a valid session OR a valid X-API-Key
// matching the RENTAL_OPS_API_KEY secret. Used by external server-to-server
// consumers of /api/rental-ops/open.
function requireAuthOrRentalOpsApiKey(req: any, res: any, next: any): any {
  const provided = req.headers["x-api-key"];
  const expected = process.env.RENTAL_OPS_API_KEY;
  if (expected && typeof provided === "string" && provided === expected) {
    return next();
  }
  return requireAuth(req, res, next);
}

// Auth middleware that allows either a valid session OR a valid Bearer token
// matching the VRM_REPAIR_TRACKER_API_KEY secret. Scoped to ONE endpoint —
// GET /api/vrm/repair-tracker/full — for server-to-server mirror consumers.
// All other /api/vrm/* routes continue to require a session via requireAuth.
function requireAuthOrRepairTrackerApiKey(req: any, res: any, next: any): any {
  const expected = process.env.VRM_REPAIR_TRACKER_API_KEY;
  const authHeader = req.headers.authorization;
  const bearer = typeof authHeader === "string" && authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : null;
  if (expected && bearer && bearer === expected) {
    // Mark this request as service-authenticated. Downstream handlers don't
    // need user identity, but logging/auditing can distinguish it from a
    // human session.
    req.user = { id: "svc:repair-tracker-mirror", role: "service", departments: [] };
    return next();
  }
  return requireAuth(req, res, next);
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
    
    // Fetch full user data to get role and other fields
    const user = await storage.getUser(session.userId);
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }
    
    req.user = { 
      id: user.id, 
      username: user.username, 
      role: user.role,
      departments: user.departments
    };
    
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

// In-memory cache for ZIP code coordinates (per server session)
const zipCoordsCache = new Map<string, { lat: number; lng: number } | null>();

export async function registerRoutes(app: Express): Promise<Server> {
  console.log("=== STARTING ROUTE REGISTRATION ===");

  // Lightweight ZIP → lat/lng lookup using the Zippopotam API (same as fleet-scope-distance-calculator)
  app.get("/api/zip-coords/:zip", async (req, res) => {
    // Strip non-digits, cap at 5, then left-pad so "7728" → "07728"
    const digits = req.params.zip.replace(/\D/g, '').slice(0, 5);
    if (digits.length === 0) return res.status(400).json({ error: "Invalid ZIP code" });
    const cleanZip = digits.padStart(5, '0');

    // Only serve from cache if it's a positive hit — don't permanently cache failures
    if (zipCoordsCache.has(cleanZip)) {
      const cached = zipCoordsCache.get(cleanZip);
      if (cached) return res.json(cached);
    }

    // Helper: try zippopotam.us
    async function tryZippopotam(): Promise<{ lat: number; lng: number } | null> {
      try {
        const r = await fetch(`https://api.zippopotam.us/us/${cleanZip}`, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(5000),
        });
        if (!r.ok) return null;
        const d = await r.json();
        if (d.places && d.places.length > 0) {
          return { lat: parseFloat(d.places[0].latitude), lng: parseFloat(d.places[0].longitude) };
        }
        return null;
      } catch { return null; }
    }

    // Helper: fall back to Nominatim (OpenStreetMap)
    async function tryNominatim(): Promise<{ lat: number; lng: number } | null> {
      try {
        const r = await fetch(
          `https://nominatim.openstreetmap.org/search?postalcode=${cleanZip}&countrycodes=us&format=json&limit=1`,
          { headers: { Accept: "application/json", "User-Agent": "NexusFleetApp/1.0" },
            signal: AbortSignal.timeout(6000) }
        );
        if (!r.ok) return null;
        const d = await r.json();
        if (Array.isArray(d) && d.length > 0) {
          return { lat: parseFloat(d[0].lat), lng: parseFloat(d[0].lon) };
        }
        return null;
      } catch { return null; }
    }

    try {
      const coords = (await tryZippopotam()) ?? (await tryNominatim());
      if (coords) {
        zipCoordsCache.set(cleanZip, coords);
        return res.json(coords);
      }
      return res.status(404).json({ error: "ZIP code not found" });
    } catch (err) {
      console.error(`[zip-coords] Error fetching ZIP ${cleanZip}:`, err);
      return res.status(500).json({ error: "Failed to fetch coordinates" });
    }
  });

  // NOTE: POST /api/elevenlabs/webhook is registered in server/index.ts BEFORE
  // the global express.json() middleware so that express.raw() can capture the
  // original bytes for HMAC-SHA256 signature verification. Do NOT register it here.

  // Mount Fleet-Scope module routes at /api/fs/*
  if (fsDb) {
    await initFleetScopeSchema();
    const fsRouter = registerFleetScopeRoutes(requireAuth);
    app.use("/api/fs", fsRouter);
    console.log("[Fleet-Scope] Routes mounted at /api/fs/*");
  } else {
    console.log("[Fleet-Scope] Skipped — Fleet-Scope DB not configured (set DATABASE_URL)");
  }

  // Mount VRM (Rental Reduction) routes at /api/vrm/*
  try {
    await initVrmSchema();
    const vrmRouter = registerVrmRoutes();
    // Dispatcher: the consolidated read-only mirror endpoint
    // /api/vrm/repair-tracker/full also accepts a Bearer token via the
    // VRM_REPAIR_TRACKER_API_KEY secret for server-to-server consumers.
    // Every other /api/vrm/* route still requires a session.
    app.use("/api/vrm", (req, res, next) => {
      if (req.method === "GET" && req.path === "/repair-tracker/full") {
        return requireAuthOrRepairTrackerApiKey(req, res, next);
      }
      return requireAuth(req, res, next);
    }, vrmRouter);
    console.log("[VRM] Routes mounted at /api/vrm/* (session-gated; /repair-tracker/full also accepts Bearer API key)");
    // Start the notification dispatcher loop (drains vrm_notifications.queued every 30s).
    startNotificationDispatcher();
  } catch (e: any) {
    console.error("[VRM] Failed to initialise:", e.message);
  }

  // BYOV Creation Audit — idempotent table init (Task 293)
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS byov_creation_audit (
        id serial PRIMARY KEY,
        vehicle_number varchar(20) NOT NULL,
        vin varchar(17),
        make varchar(100),
        model varchar(100),
        model_year varchar(4),
        asset_type varchar(50),
        district varchar(20),
        submitted_by varchar(100) NOT NULL,
        submitted_at timestamp DEFAULT NOW() NOT NULL,
        holman_success boolean NOT NULL,
        holman_error text,
        wms_success boolean NOT NULL,
        wms_error text,
        blocked_source varchar(10)
      )
    `);
    // Migrate existing tables that predate the blocked_source column (Task 361)
    await db.execute(sql`
      ALTER TABLE byov_creation_audit
        ADD COLUMN IF NOT EXISTS blocked_source varchar(10)
    `);
    console.log("[BYOV] byov_creation_audit table ready");
  } catch (e: any) {
    console.error("[BYOV] Failed to init byov_creation_audit table:", e.message);
  }

  // BYOV Enrollments — idempotent table init
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS byov_enrollments (
        enterprise_id text PRIMARY KEY,
        full_name text,
        truck_number text,
        enrollment_type text,
        in_rental boolean DEFAULT false,
        district text,
        status text DEFAULT 'approved',
        approved_date text,
        created_at timestamp DEFAULT NOW(),
        updated_at timestamp DEFAULT NOW()
      )
    `);
    console.log("[BYOV] byov_enrollments table ready");
    const byovWebhookSecret = process.env.FS_BYOV_WEBHOOK_SECRET ? '(configured)' : '(NOT SET — set FS_BYOV_WEBHOOK_SECRET)';
    console.log(`[BYOV] Webhook receiver: POST /public/byov-enrollment-webhook  |  x-api-key: FS_BYOV_WEBHOOK_SECRET ${byovWebhookSecret}`);
    console.log(`[BYOV] Backfill API key: BYOV_API_KEY ${process.env.BYOV_API_KEY ? '(configured)' : '(NOT SET — set BYOV_API_KEY)'}`);
  } catch (e: any) {
    console.error("[BYOV] Failed to init byov_enrollments table:", e.message);
  }

  // BYOV Drift Check history — idempotent table init (Task 327)
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS byov_drift_checks (
        id serial PRIMARY KEY,
        run_at timestamp NOT NULL DEFAULT NOW(),
        triggered_by text NOT NULL DEFAULT 'scheduler',
        total_checked integer NOT NULL DEFAULT 0,
        holman_fail_count integer NOT NULL DEFAULT 0,
        wms_fail_count integer NOT NULL DEFAULT 0,
        mismatches jsonb NOT NULL DEFAULT '[]'::jsonb,
        duration_ms integer NOT NULL DEFAULT 0
      )
    `);
    console.log("[BYOV] byov_drift_checks table ready");
  } catch (e: any) {
    console.error("[BYOV] Failed to init byov_drift_checks table:", e.message);
  }

  // Mount WMS Engine routes at /api/wms/*
  const wmsRouter = registerWmsRoutes(requireAuth);
  app.use("/api/wms", wmsRouter);
  console.log("[WMS Engine] Routes mounted at /api/wms/*");

  // SAML SSO INTEGRATION - Initialize passport and SAML strategy
  const samlStrategy = createSamlStrategy();
  passport.use("saml", samlStrategy);
  passport.serializeUser((user: any, done: any) => done(null, user));
  passport.deserializeUser((user: any, done: any) => done(null, user));
  app.use(passport.initialize());
  printSpDetails();

  // SAML SSO INTEGRATION - Auth endpoints
  app.get("/auth/login", (req, res, next) => {
    const relayState = req.query.next as string || "/";
    passport.authenticate("saml", {
      failureRedirect: "/login?error=sso_failed",
      additionalParams: { RelayState: relayState },
    } as any)(req, res, next);
  });

  app.post("/auth/saml/acs", passport.authenticate("saml", { session: false, failureRedirect: "/login?error=sso_failed" }), async (req: any, res) => {
    try {
      const user = req.user;
      if (!user || !user.id) {
        console.error("[SAML SSO] ACS callback - no user in request");
        return res.redirect("/login?error=user_not_found");
      }

      const sessionId = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await storage.createSession({
        id: sessionId,
        userId: user.id,
        username: user.username,
        expiresAt
      });

      res.cookie('sessionId', sessionId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        expires: expiresAt,
        path: '/'
      });

      console.log(`[SAML SSO] Session created for user: ${user.username}`);

      const relayState = req.body.RelayState || "/";
      res.redirect(`/sso-callback?relay=${encodeURIComponent(relayState)}`);
    } catch (error) {
      console.error("[SAML SSO] Error in ACS callback:", error);
      res.redirect("/login?error=session_creation_failed");
    }
  });

  app.get("/auth/saml/metadata", (_req, res) => {
    const metadata = generateSpMetadata(samlStrategy);
    res.type("application/xml");
    res.send(metadata);
  });

  app.get("/auth/logout", async (req: any, res) => {
    const cookieHeader = req.headers.cookie;
    const sessionId = cookieHeader?.match(/sessionId=([^;]+)/)?.[1];
    if (sessionId) {
      try { await storage.deleteSession(sessionId); } catch {}
    }
    res.clearCookie('sessionId', { path: '/' });

    const idpSloUrl = "https://sso.searshc.com/idp-nexus/saml2/idp/initSLO.php";
    const baseUrl = getBaseUrl();
    const relayState = encodeURIComponent(`${baseUrl}/login`);
    res.redirect(`${idpSloUrl}?RelayState=${relayState}`);
  });

  app.post("/api/auth/logout", async (req: any, res) => {
    const cookieHeader = req.headers.cookie;
    const sessionId = cookieHeader?.match(/sessionId=([^;]+)/)?.[1];
    if (sessionId) {
      try { await storage.deleteSession(sessionId); } catch {}
    }
    res.clearCookie('sessionId', { path: '/' });
    res.json({ ok: true });
  });

  app.get("/api/auth/sso-user", requireAuth, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.user.id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      const sq = user.securityQuestions as StoredSecurityQuestion[] | null;
      const hasSecurityQuestions = !!(sq && sq.length >= 3);
      res.json({
        user: {
          ...user,
          password: undefined,
          securityQuestions: hasSecurityQuestions ? sq!.map(q => ({ questionId: q.questionId, questionText: q.questionText })) : null,
        },
        requiresSecurityQuestions: !hasSecurityQuestions,
      });
    } catch (error) {
      console.error("[SAML SSO] Error fetching SSO user:", error);
      res.status(500).json({ message: "Failed to fetch user data" });
    }
  });

  // Auth routes
  console.log("Registering auth routes...");
  app.post("/api/auth/login", loginRateLimiter, async (req, res) => {
    try {
      const { enterpriseId, password } = req.body;
      const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
      
      const user = await storage.getUserByUsername(enterpriseId);
      
      if (!user) {
        // Log failed login attempt - user not found
        await storage.createActivityLog({
          userId: 'system',
          action: 'login_failed',
          entityType: 'auth',
          entityId: null,
          details: `Failed login attempt for unknown user "${enterpriseId}" from IP: ${ipAddress}`,
        });
        return res.status(401).json({ message: "Invalid credentials" });
      }

      if (!user.isActive) {
        await storage.createActivityLog({
          userId: user.id,
          action: 'login_failed',
          entityType: 'auth',
          entityId: user.id,
          details: `Login denied for deactivated user "${enterpriseId}" from IP: ${ipAddress}`,
        });
        return res.status(403).json({ message: "Your account has been deactivated. Please contact an administrator." });
      }

      // Use bcrypt to compare the provided password with the hashed password
      const isPasswordValid = await bcrypt.compare(password, user.password);
      
      if (!isPasswordValid) {
        // Log failed login attempt - wrong password
        await storage.createActivityLog({
          userId: user.id,
          action: 'login_failed',
          entityType: 'auth',
          entityId: user.id,
          details: `Failed login attempt for user "${enterpriseId}" (wrong password) from IP: ${ipAddress}`,
        });
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

      // Log successful login with role info for debugging
      await storage.createActivityLog({
        userId: user.id,
        action: 'login_success',
        entityType: 'auth',
        entityId: user.id,
        details: `User "${user.username}" (role: ${user.role}) logged in successfully from IP: ${ipAddress}`,
      });

      console.log(`[LOGIN] User ${user.username} logged in with role: ${user.role}`);
      const sq = user.securityQuestions as StoredSecurityQuestion[] | null;
      const hasSecurityQuestions = !!(sq && sq.length >= 3);
      res.json({
        user: {
          ...user,
          password: undefined,
          securityQuestions: hasSecurityQuestions ? sq!.map(q => ({ questionId: q.questionId, questionText: q.questionText })) : null,
        },
        requiresSecurityQuestions: !hasSecurityQuestions,
      });
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

      // Authentication and authorization check - require developer role
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || currentUser.role !== 'developer') {
        return res.status(403).json({ 
          message: "Access denied. Test user creation requires developer role and development environment." 
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
          { username: "developer", role: "developer" }
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

  // ===== Public Offboarding Return Token Routes (Sprint B1) =====
  // These routes are PUBLIC — no requireAuth. Token-based access control.
  app.get("/api/offboarding/return/validate", checkAnonymousRateLimit, async (req, res) => {
    try {
      const token = req.query.token as string;
      if (!token || typeof token !== 'string') {
        return res.status(400).json({ message: "Token is required" });
      }

      const result = await storage.validateReturnToken(token);
      if (result.status === 'invalid') {
        return res.status(401).json({ message: "Invalid token. Please contact your supervisor for assistance." });
      }
      if (result.status === 'expired') {
        return res.status(410).json({ message: "This link has expired. Please contact your supervisor for a new link." });
      }

      const { queueItem, tokenRecord } = result;
      const techData = parseTechDataFromQueueItem(queueItem.data);
      const lane = getDetectionLane(techData.lastDayWorked, queueItem.createdAt ? queueItem.createdAt.toISOString() : null);

      const returnSteps = [
        {
          step: 1,
          title: "Audit Your Tools",
          description: "Complete a tool audit to confirm which company tools and equipment you currently have in your possession.",
          instruction: "Your supervisor will provide you with a link to the tool audit form. If you haven't received one, please reach out to your supervisor.",
        },
        {
          step: 2,
          title: "Return Your Tools",
          description: "Ship your tools back using the prepaid UPS shipping label. Package all tools securely and drop off at any UPS location.",
          instruction: "A QR code or prepaid UPS shipping label will be provided via email. Check your inbox (and spam folder) for the shipping details.",
        },
        {
          step: 3,
          title: "Return Your iPhone",
          description: "Your company iPhone must be returned separately. Please factory reset the device before shipping.",
          instruction: "A separate return label for your iPhone will be included in the shipping materials. If not received, contact your supervisor.",
        },
        {
          step: 4,
          title: "Return Other Items",
          description: "Any additional company property (uniforms, badges, keys, documentation) should be included in your tool return shipment.",
          instruction: "Use the same QR code / UPS return process from Step 2 to ship any remaining company items.",
        },
      ];

      res.json({
        techName: techData.techName,
        separationDate: techData.separationDate,
        lane,
        tokenId: tokenRecord.id,
        firstVisit: !tokenRecord.consumedAt,
        returnSteps,
      });
    } catch (error) {
      console.error('Return token validation error:', error);
      res.status(500).json({ message: "Validation failed" });
    }
  });

  app.post("/api/offboarding/return/log-visit", checkAnonymousRateLimit, async (req, res) => {
    try {
      const { token } = req.body;
      if (!token || typeof token !== 'string') {
        return res.status(400).json({ message: "Token is required" });
      }

      const result = await storage.validateReturnToken(token);
      if (result.status !== 'valid') {
        return res.status(401).json({ message: "Invalid or expired token" });
      }

      const { queueItem, tokenRecord } = result;
      await storage.logReturnPageVisit(queueItem.id);

      if (!tokenRecord.consumedAt) {
        await storage.markReturnTokenConsumed(tokenRecord.id);
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Log visit error:', error);
      res.status(500).json({ message: "Failed to log visit" });
    }
  });

  // User management routes (GET users available for all authenticated users for task assignment)
  app.get("/api/users", requireAuth, async (req: any, res) => {
    try {
      const users = await storage.getUsers();
      const safeUsers = users.map(user => {
        const sq = user.securityQuestions as StoredSecurityQuestion[] | null;
        return {
          ...user,
          password: undefined,
          securityQuestions: sq && sq.length >= 3 ? sq.map(q => ({ questionId: q.questionId, questionText: q.questionText })) : null,
        };
      });
      res.json(safeUsers);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.get("/api/users/:id", requireAuth, async (req: any, res) => {
    try {
      const { id } = req.params;
      const user = await storage.getUser(id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      const sq = user.securityQuestions as StoredSecurityQuestion[] | null;
      res.json({
        ...user,
        password: undefined,
        securityQuestions: sq && sq.length >= 3 ? sq.map(q => ({ questionId: q.questionId, questionText: q.questionText })) : null,
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  app.post("/api/users", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || (currentUser.role !== 'developer' && currentUser.role !== 'admin')) {
        return res.status(403).json({ message: "Access denied. User management requires developer or admin role." });
      }
      
      const userData = insertUserSchema.parse(req.body);

      if (currentUser.role !== 'developer' && userData.role === 'developer') {
        return res.status(403).json({ message: "Access denied. Only developers can create users with the developer role." });
      }
      
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
      if (!currentUser || (currentUser.role !== 'developer' && currentUser.role !== 'admin')) {
        return res.status(403).json({ message: "Access denied. User management requires developer or admin role." });
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
      const allowedFields = ['email', 'fullName', 'role', 'departments', 'isActive', 'username'];
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
      
      // Validate role if being updated - check against roles in role_permissions table
      if (sanitizedUpdates.role) {
        const rolePermissions = await storage.getAllRolePermissions();
        const validRoles = rolePermissions.map((rp: { role: string }) => rp.role);
        if (!validRoles.includes(sanitizedUpdates.role)) {
          return res.status(400).json({ message: `Invalid role specified. Valid roles are: ${validRoles.join(', ')}` });
        }
      }
      
      // Validate departments if being updated
      if (sanitizedUpdates.departments) {
        const validDepartments = ['NTAO', 'ASSETS', 'INVENTORY', 'FLEET'];
        if (!Array.isArray(sanitizedUpdates.departments)) {
          return res.status(400).json({ message: "Departments must be an array" });
        }
        for (const dept of sanitizedUpdates.departments) {
          if (!validDepartments.includes(dept)) {
            return res.status(400).json({ message: `Invalid department: ${dept}` });
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
      if (!currentUser || (currentUser.role !== 'developer' && currentUser.role !== 'admin')) {
        return res.status(403).json({ message: "Access denied. User management requires developer or admin role." });
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
      if (!currentUser || (currentUser.role !== 'developer' && currentUser.role !== 'admin')) {
        return res.status(403).json({ message: "Access denied. Password reset requires developer or admin role." });
      }
      
      const { id } = req.params;
      
      // Protect seed accounts from password reset by other users
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

  // Admin Role Management - Developers and admins can update user roles and departments
  app.post("/api/users/:id/update-role", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || (currentUser.role !== 'developer' && currentUser.role !== 'admin')) {
        return res.status(403).json({ message: "Access denied. Role management requires developer or admin role." });
      }
      
      const { id } = req.params;
      
      // Protect seed accounts from role changes
      if (id === 'emergency-admin-2025-id') {
        return res.status(403).json({ message: "Access denied. Cannot modify role for seed accounts." });
      }
      
      const { role, departments, isActive } = req.body;
      
      // Validate role if provided - check against roles in role_permissions table
      const rolePermissions = await storage.getAllRolePermissions();
      const validRoles = rolePermissions.map((rp: { role: string }) => rp.role);
      if (role && !validRoles.includes(role)) {
        return res.status(400).json({ message: `Invalid role specified. Valid roles are: ${validRoles.join(', ')}` });
      }

      if (currentUser.role !== 'developer' && role === 'developer') {
        return res.status(403).json({ message: "Access denied. Only developers can assign the developer role." });
      }

      // Validate departments if provided
      const validDepartments = ['NTAO', 'ASSETS', 'INVENTORY', 'FLEET'];
      if (departments && Array.isArray(departments)) {
        for (const dept of departments) {
          if (!validDepartments.includes(dept)) {
            return res.status(400).json({ message: `Invalid department: ${dept}` });
          }
        }
      }

      const targetUser = await storage.getUser(id);
      if (!targetUser) {
        return res.status(404).json({ message: "User not found" });
      }

      if (currentUser.role !== 'developer' && targetUser.role === 'developer') {
        return res.status(403).json({ message: "Access denied. Only developers can modify other developer accounts." });
      }

      // Prepare updates object
      const updates: any = {};
      if (role !== undefined) updates.role = role;
      if (departments !== undefined) updates.departments = departments;
      if (isActive !== undefined) updates.isActive = isActive;

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

  // Get user permission overrides
  app.get("/api/users/:id/permission-overrides", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || (currentUser.role !== 'developer' && currentUser.role !== 'admin')) {
        return res.status(403).json({ message: "Access denied. Permission overrides require developer or admin role." });
      }

      const { id } = req.params;
      const targetUser = await storage.getUser(id);
      if (!targetUser) {
        return res.status(404).json({ message: "User not found" });
      }

      if (currentUser.role !== 'developer' && targetUser.role === 'developer') {
        return res.status(403).json({ message: "Access denied. Only developers can view developer permission overrides." });
      }

      res.json({ 
        userId: targetUser.id,
        username: targetUser.username,
        role: targetUser.role,
        permissionOverrides: targetUser.permissionOverrides || null 
      });
    } catch (error) {
      console.error("Error fetching permission overrides:", error);
      res.status(500).json({ message: "Failed to fetch permission overrides" });
    }
  });

  // Set user permission overrides
  app.patch("/api/users/:id/permission-overrides", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || (currentUser.role !== 'developer' && currentUser.role !== 'admin')) {
        return res.status(403).json({ message: "Access denied. Permission overrides require developer or admin role." });
      }

      const { id } = req.params;
      const targetUser = await storage.getUser(id);
      if (!targetUser) {
        return res.status(404).json({ message: "User not found" });
      }

      if (currentUser.role !== 'developer' && targetUser.role === 'developer') {
        return res.status(403).json({ message: "Access denied. Only developers can modify developer permission overrides." });
      }

      if (currentUser.role === 'admin' && targetUser.role === 'admin' && currentUser.id !== targetUser.id) {
        return res.status(403).json({ message: "Access denied. Admins cannot modify permission overrides for other admins." });
      }

      const { permissionOverrides } = req.body;

      const updatedUser = await storage.updateUser(id, { permissionOverrides: permissionOverrides || null });
      if (!updatedUser) {
        return res.status(500).json({ message: "Failed to update permission overrides" });
      }

      await storage.createActivityLog({
        userId: currentUser.id,
        action: "user_permission_overrides_updated",
        entityType: "user",
        entityId: id,
        details: `${currentUser.username} updated permission overrides for user ${targetUser.username}. Overrides: ${JSON.stringify(permissionOverrides)}`,
      });

      res.json({ 
        message: "Permission overrides updated successfully",
        user: { ...updatedUser, password: undefined }
      });
    } catch (error) {
      console.error("Error updating permission overrides:", error);
      res.status(500).json({ message: "Failed to update permission overrides" });
    }
  });

  // Clear user permission overrides
  app.delete("/api/users/:id/permission-overrides", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || (currentUser.role !== 'developer' && currentUser.role !== 'admin')) {
        return res.status(403).json({ message: "Access denied. Permission overrides require developer or admin role." });
      }

      const { id } = req.params;
      const targetUser = await storage.getUser(id);
      if (!targetUser) {
        return res.status(404).json({ message: "User not found" });
      }

      if (currentUser.role !== 'developer' && targetUser.role === 'developer') {
        return res.status(403).json({ message: "Access denied. Only developers can modify developer permission overrides." });
      }

      const updatedUser = await storage.updateUser(id, { permissionOverrides: null });
      if (!updatedUser) {
        return res.status(500).json({ message: "Failed to clear permission overrides" });
      }

      await storage.createActivityLog({
        userId: currentUser.id,
        action: "user_permission_overrides_cleared",
        entityType: "user",
        entityId: id,
        details: `${currentUser.username} cleared all permission overrides for user ${targetUser.username}`,
      });

      res.json({ 
        message: "Permission overrides cleared successfully",
        user: { ...updatedUser, password: undefined }
      });
    } catch (error) {
      console.error("Error clearing permission overrides:", error);
      res.status(500).json({ message: "Failed to clear permission overrides" });
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

      // Store reset token in database (persists across server restarts)
      await storage.createPasswordResetToken({
        token: resetToken,
        userId: user.id,
        expiresAt: resetTokenExpiry
      });

      // Send password reset email
      try {
        await sendEmail({
          to: email,
          from: "noreply@sears.com",
          subject: "Password Reset Request - Nexus Portal",
          html: `
            <h2>Password Reset Request</h2>
            <p>Hello ${user.username},</p>
            <p>You requested a password reset for your Nexus Portal account.</p>
            <p>Your password reset token is: <strong>${resetToken}</strong></p>
            <p>This token will expire in 1 hour.</p>
            <p>If you did not request this reset, please ignore this email.</p>
            <p>Best regards,<br>Nexus Portal Team</p>
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

      // Check reset token from database
      const resetData = await storage.getPasswordResetToken(resetToken);
      
      if (!resetData || resetData.expiresAt < new Date() || resetData.usedAt) {
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

      // Mark token as used (prevents token reuse)
      await storage.markPasswordResetTokenUsed(resetToken);

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

  // Security Questions - Get available questions list
  app.get("/api/auth/security-questions", async (_req, res) => {
    res.json(PREDEFINED_SECURITY_QUESTIONS);
  });

  // Security Questions - Setup (requires auth)
  app.post("/api/auth/security-questions/setup", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser) return res.status(404).json({ message: "User not found" });

      const parsed = securityQuestionSetupSchema.safeParse(req.body.questions);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0]?.message || "Invalid security questions" });
      }

      const questions = parsed.data;
      const uniqueIds = new Set(questions.map(q => q.questionId));
      if (uniqueIds.size !== questions.length) {
        return res.status(400).json({ message: "Each security question must be different" });
      }

      const storedQuestions: StoredSecurityQuestion[] = await Promise.all(
        questions.map(async (q) => ({
          questionId: q.questionId,
          questionText: q.questionText,
          answerHash: await bcrypt.hash(q.answer.trim().toLowerCase(), 10),
        }))
      );

      await storage.updateUser(currentUser.id, { securityQuestions: storedQuestions });

      await storage.createActivityLog({
        userId: currentUser.id,
        action: "security_questions_setup",
        entityType: "user",
        entityId: currentUser.id,
        details: `User ${currentUser.username} set up ${storedQuestions.length} security questions`,
      });

      res.json({ message: "Security questions saved successfully" });
    } catch (error) {
      console.error("Security questions setup error:", error);
      res.status(500).json({ message: "Failed to save security questions" });
    }
  });

  // Security Questions - Check if user has them set up (requires auth)
  app.get("/api/auth/security-questions/status", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser) return res.status(404).json({ message: "User not found" });

      const questions = currentUser.securityQuestions as StoredSecurityQuestion[] | null;
      res.json({ hasSecurityQuestions: !!(questions && questions.length >= 3) });
    } catch (error) {
      res.status(500).json({ message: "Failed to check security questions status" });
    }
  });

  // Security Questions - Get questions for a user (anonymous, for forgot password flow)
  app.post("/api/auth/security-questions/get-questions", async (req, res) => {
    try {
      const { username } = req.body;
      if (!username) return res.status(400).json({ message: "Username is required" });

      const user = await storage.getUserByUsername(username.trim().toLowerCase());
      if (!user || !user.isActive) {
        return res.status(404).json({ message: "No account found with that username, or security questions have not been set up. Please contact your admin." });
      }

      const questions = user.securityQuestions as StoredSecurityQuestion[] | null;
      if (!questions || questions.length < 3) {
        return res.status(404).json({ message: "Security questions have not been set up for this account. Please contact your admin." });
      }

      const shuffled = [...questions].sort(() => Math.random() - 0.5);
      const challenge = shuffled.slice(0, 2);

      res.json({
        questions: challenge.map(q => ({ questionId: q.questionId, questionText: q.questionText })),
      });
    } catch (error) {
      console.error("Get security questions error:", error);
      res.status(500).json({ message: "Failed to retrieve security questions" });
    }
  });

  // Security Questions - Verify answers and reset password (anonymous)
  const securityQuestionVerifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { message: "Too many failed attempts. Please try again in 15 minutes." },
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.post("/api/auth/security-questions/verify-and-reset", securityQuestionVerifyLimiter, async (req, res) => {
    try {
      const { username, answers, newPassword } = req.body;

      if (!username || !answers || !newPassword) {
        return res.status(400).json({ message: "Username, answers, and new password are required" });
      }

      if (!validatePasswordRequirements(newPassword)) {
        return res.status(400).json({ message: "New password must be at least 10 characters long." });
      }

      const user = await storage.getUserByUsername(username.trim().toLowerCase());
      if (!user || !user.isActive) {
        return res.status(400).json({ message: "Verification failed. Please check your answers and try again." });
      }

      const questions = user.securityQuestions as StoredSecurityQuestion[] | null;
      if (!questions || questions.length < 3) {
        return res.status(400).json({ message: "Verification failed. Please check your answers and try again." });
      }

      const answersArray = answers as Array<{ questionId: string; answer: string }>;
      if (!Array.isArray(answersArray) || answersArray.length < 2) {
        return res.status(400).json({ message: "You must answer at least 2 security questions" });
      }

      let allCorrect = true;
      for (const submitted of answersArray) {
        const stored = questions.find(q => q.questionId === submitted.questionId);
        if (!stored) { allCorrect = false; break; }
        const match = await bcrypt.compare(submitted.answer.trim().toLowerCase(), stored.answerHash);
        if (!match) { allCorrect = false; break; }
      }

      if (!allCorrect) {
        await storage.createActivityLog({
          userId: user.id,
          action: "security_question_verify_failed",
          entityType: "user",
          entityId: user.id,
          details: `Failed security question verification for password reset (user: ${user.username})`,
        });
        return res.status(400).json({ message: "One or more answers are incorrect. Please try again." });
      }

      const screeningResult = await checkPasswordCompromised(newPassword);
      if (screeningResult.isCompromised) {
        return res.status(400).json({ message: "This password has been found in data breaches and cannot be used. Please choose a different password." });
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await storage.updateUser(user.id, { password: hashedPassword });

      await storage.createActivityLog({
        userId: user.id,
        action: "password_reset_via_security_questions",
        entityType: "user",
        entityId: user.id,
        details: `Password reset via security questions for user ${user.username}`,
      });

      res.json({ message: "Password reset successfully. You can now log in with your new password." });
    } catch (error) {
      console.error("Security question verify error:", error);
      res.status(500).json({ message: "Failed to verify security questions" });
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
  app.get("/api/ntao-queue", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || !hasQueueAccess(currentUser, 'ntao')) {
        return res.status(403).json({ message: "Access denied to NTAO queue" });
      }
      const queueItems = await storage.getNTAOQueueItems();
      res.json(queueItems);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch NTAO queue items" });
    }
  });

  app.get("/api/ntao-queue/:id", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || !hasQueueAccess(currentUser, 'ntao')) {
        return res.status(403).json({ message: "Access denied to NTAO queue" });
      }
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

  app.patch("/api/ntao-queue/:id/assign", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || !hasQueueAccess(currentUser, 'ntao')) {
        return res.status(403).json({ message: "Access denied to NTAO queue" });
      }
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

  app.patch("/api/ntao-queue/:id/complete", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || !hasQueueAccess(currentUser, 'ntao')) {
        return res.status(403).json({ message: "Access denied to NTAO queue" });
      }
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
  app.get("/api/assets-queue", requireAuth, async (req: any, res) => {
    const startTime = Date.now();
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || !hasQueueAccess(currentUser, 'assets')) {
        return res.status(403).json({ message: "Access denied to Assets queue" });
      }

      const parsedDaysBack = parseInt(req.query.daysBack as string);
      const daysBack = Number.isFinite(parsedDaysBack) ? parsedDaysBack : 30;

      const allQueueItems = await storage.getAssetsQueueItems();

      let filteredItems = allQueueItems;
      if (daysBack > 0) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysBack);
        cutoffDate.setHours(0, 0, 0, 0);

        filteredItems = allQueueItems.filter(item => {
          const created = item.createdAt;
          if (!created) return true;
          return new Date(created) >= cutoffDate;
        });
      }

      const elapsed = Date.now() - startTime;
      console.log(`[Assets Queue] GET /api/assets-queue returned ${filteredItems.length} items in ${elapsed}ms (daysBack=${daysBack})`);

      res.json(filteredItems);
    } catch (error) {
      const elapsed = Date.now() - startTime;
      console.error(`[Assets Queue] Error after ${elapsed}ms:`, error);
      res.status(500).json({ message: "Failed to fetch Assets queue items" });
    }
  });

  app.post("/api/assets-queue/details", requireAuth, async (req: any, res) => {
    const startTime = Date.now();
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || !hasQueueAccess(currentUser, 'assets')) {
        return res.status(403).json({ message: "Access denied to Assets queue" });
      }

      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "ids array is required" });
      }
      if (ids.length > 20) {
        return res.status(400).json({ message: "Maximum 20 items per batch" });
      }

      const { getSnowflakeSyncService } = await import("./snowflake-sync-service");
      const snowflakeSyncService = getSnowflakeSyncService();

      let hrSeparations: Array<{
        ldapId: string;
        technicianName: string | null;
        emplId: string;
        lastDay: string | null;
        effectiveSeparationDate: string | null;
        truckNumber: string | null;
        contactNumber: string | null;
        personalEmail: string | null;
        fleetPickupAddress: string | null;
        separationCategory: string | null;
        notes: string | null;
      }> = [];

      if (snowflakeSyncService) {
        try {
          const hrResult = await snowflakeSyncService.getAllConfirmedSeparations();
          if (hrResult.success) {
            hrSeparations = hrResult.records;
          }
        } catch (hrError) {
          console.log('[Assets Details] Could not fetch HR separations:', hrError);
        }
      }

      const hrLookup = new Map<string, typeof hrSeparations[0]>();
      for (const hr of hrSeparations) {
        if (hr.ldapId) hrLookup.set(hr.ldapId.toUpperCase(), hr);
        if (hr.emplId) hrLookup.set(hr.emplId, hr);
      }

      const results: Record<string, any> = {};

      for (const id of ids) {
        const item = await storage.getAssetsQueueItem(id);
        if (!item) continue;

        let techData: any = null;
        try {
          const parsedData = typeof item.data === 'string'
            ? JSON.parse(item.data)
            : item.data;

          const employeeId = parsedData?.employee?.employeeId || parsedData?.technician?.employeeId || parsedData?.employeeId || parsedData?.emplid;
          const enterpriseId = parsedData?.employee?.enterpriseId || parsedData?.employee?.racfId || parsedData?.technician?.enterpriseId || parsedData?.technician?.techRacfid || parsedData?.techRacfId;

          let tech = null;
          if (employeeId) {
            tech = await storage.getAllTechByEmployeeId(employeeId);
          }
          if (!tech && enterpriseId) {
            tech = await storage.getAllTechByTechRacfid(enterpriseId);
          }

          const hrRecord = hrLookup.get(enterpriseId?.toUpperCase() || '') || hrLookup.get(employeeId || '');

          let mobilePhoneData: { phoneNumber?: string | null } = {};
          if (enterpriseId && snowflakeSyncService) {
            try {
              mobilePhoneData = await snowflakeSyncService.getMobilePhoneByLdap(enterpriseId);
            } catch (e) {
            }
          }

          if (tech) {
            const addressParts = [
                  tech.homeAddr1,
                  tech.homeAddr2,
                  tech.homeCity,
                  tech.homeState,
                  tech.homePostal
                ].filter(Boolean);

            techData = {
              techName: tech.techName,
              enterpriseId: tech.techRacfid,
              district: tech.districtNo || null,
              separationDate: hrRecord?.lastDay || hrRecord?.effectiveSeparationDate || tech.lastDayWorked || tech.effectiveDate || null,
              mobilePhone: mobilePhoneData?.phoneNumber || null,
              personalPhone: hrRecord?.contactNumber || tech.cellPhone || tech.homePhone || null,
              homePhone: tech.homePhone || null,
              contactNumber: hrRecord?.contactNumber || null,
              email: hrRecord?.personalEmail || parsedData?.employee?.email || `${tech.techRacfid?.toLowerCase()}@sears.com`,
              personalEmail: hrRecord?.personalEmail || null,
              address: addressParts.length > 0 ? addressParts.join(', ') : null,
              fleetPickupAddress: hrRecord?.fleetPickupAddress || null,
              separationCategory: hrRecord?.separationCategory || null,
              hrTruckNumber: hrRecord?.truckNumber || null,
              notes: hrRecord?.notes || null,
              fromSnowflake: true,
            };
          } else {
            techData = {
              techName: hrRecord?.technicianName || parsedData?.employee?.fullName || parsedData?.techName || item.title?.replace('Day 0: Recover Company Equipment - ', '').replace('Day 0: Recover Equipment & Tools - ', '') || 'Unknown',
              enterpriseId: enterpriseId || employeeId || 'Unknown',
              district: null,
              separationDate: hrRecord?.lastDay || hrRecord?.effectiveSeparationDate || parsedData?.employee?.lastDayWorked || parsedData?.lastDayWorked || null,
              mobilePhone: mobilePhoneData?.phoneNumber || null,
              personalPhone: hrRecord?.contactNumber || parsedData?.employee?.phone || null,
              homePhone: null,
              contactNumber: hrRecord?.contactNumber || null,
              email: hrRecord?.personalEmail || parsedData?.employee?.email || null,
              personalEmail: hrRecord?.personalEmail || null,
              address: parsedData?.employee?.address || null,
              fleetPickupAddress: hrRecord?.fleetPickupAddress || null,
              separationCategory: hrRecord?.separationCategory || null,
              hrTruckNumber: hrRecord?.truckNumber || null,
              notes: hrRecord?.notes || null,
              fromSnowflake: true,
            };
          }
        } catch (e) {
          techData = {
            techName: item.title?.replace('Day 0: Recover Company Equipment - ', '').replace('Day 0: Recover Equipment & Tools - ', '') || 'Unknown',
            enterpriseId: 'Unknown',
            district: null,
            separationDate: null,
            mobilePhone: null,
            personalPhone: null,
            homePhone: null,
            contactNumber: null,
            email: null,
            personalEmail: null,
            address: null,
            fleetPickupAddress: null,
            separationCategory: null,
            hrTruckNumber: null,
            notes: null,
            fromSnowflake: false,
          };
        }

        results[id] = techData;
      }

      const elapsed = Date.now() - startTime;
      console.log(`[Assets Details] POST /api/assets-queue/details enriched ${Object.keys(results).length} items in ${elapsed}ms`);

      res.json(results);
    } catch (error) {
      const elapsed = Date.now() - startTime;
      console.error(`[Assets Details] Error after ${elapsed}ms:`, error);
      res.status(500).json({ message: "Failed to fetch asset details" });
    }
  });

  app.get("/api/assets-queue/:id", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || !hasQueueAccess(currentUser, 'assets')) {
        return res.status(403).json({ message: "Access denied to Assets queue" });
      }
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

  app.patch("/api/assets-queue/:id/assign", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || !hasQueueAccess(currentUser, 'assets')) {
        return res.status(403).json({ message: "Access denied to Assets queue" });
      }
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

  app.patch("/api/assets-queue/:id/complete", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || !hasQueueAccess(currentUser, 'assets')) {
        return res.status(403).json({ message: "Access denied to Assets queue" });
      }
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

  app.patch("/api/assets-queue/:id/save-progress", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || !hasQueueAccess(currentUser, 'assets')) {
        return res.status(403).json({ message: "Access denied to Assets queue" });
      }
      
      const { 
        taskToolsReturn, 
        taskIphoneReturn, 
        taskDisconnectedLine, 
        taskDisconnectedMPayment, 
        taskCloseSegnoOrders, 
        taskCreateShippingLabel, 
        carrier,
        fleetRoutingDecision
      } = req.body;
      
      const updates: Record<string, any> = {};
      if (typeof taskToolsReturn === 'boolean') updates.taskToolsReturn = taskToolsReturn;
      if (typeof taskIphoneReturn === 'boolean') updates.taskIphoneReturn = taskIphoneReturn;
      if (typeof taskDisconnectedLine === 'boolean') updates.taskDisconnectedLine = taskDisconnectedLine;
      if (typeof taskDisconnectedMPayment === 'boolean') updates.taskDisconnectedMPayment = taskDisconnectedMPayment;
      if (typeof taskCloseSegnoOrders === 'boolean') updates.taskCloseSegnoOrders = taskCloseSegnoOrders;
      if (typeof taskCreateShippingLabel === 'boolean') updates.taskCreateShippingLabel = taskCreateShippingLabel;
      if (carrier !== undefined) updates.carrier = carrier;
      if (fleetRoutingDecision !== undefined) updates.fleetRoutingDecision = fleetRoutingDecision;
      
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "No valid fields to update" });
      }
      
      const queueItem = await storage.updateAssetsQueueProgress(req.params.id, updates);
      if (!queueItem) {
        return res.status(404).json({ message: "Assets queue item not found" });
      }
      res.json(queueItem);
    } catch (error) {
      console.error('Error saving assets queue progress:', error);
      res.status(500).json({ message: "Failed to save progress" });
    }
  });

  app.patch("/api/assets-queue/:id/automation-detail", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || !hasQueueAccess(currentUser, 'assets')) {
        return res.status(403).json({ message: "Access denied to Assets queue" });
      }
      const detail = req.body;
      if (!detail || typeof detail !== 'object') {
        return res.status(400).json({ message: "Invalid automation detail payload" });
      }
      const result = await storage.updateAutomationDetail(req.params.id, detail);
      if (result === null) {
        return res.status(404).json({ message: "Assets queue item not found" });
      }
      res.json(result);
    } catch (error) {
      console.error('Error updating automation detail:', error);
      res.status(500).json({ message: "Failed to update automation detail" });
    }
  });

  app.patch("/api/assets-queue/:id/notes", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || !hasQueueAccess(currentUser, 'assets')) {
        return res.status(403).json({ message: "Access denied to Assets queue" });
      }
      const { notes } = req.body;
      if (typeof notes !== 'string') {
        return res.status(400).json({ message: "Notes must be a string" });
      }
      const queueItem = await storage.updateQueueItem(req.params.id, { notes });
      if (!queueItem) {
        return res.status(404).json({ message: "Assets queue item not found" });
      }
      res.json(queueItem);
    } catch (error) {
      console.error('Error updating assets queue notes:', error);
      res.status(500).json({ message: "Failed to update notes" });
    }
  });

  app.post("/api/assets-queue/:id/send-tool-audit", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || !hasQueueAccess(currentUser, 'assets')) {
        return res.status(403).json({ message: "Access denied to Assets queue" });
      }

      const queueItem = await storage.getAssetsQueueItem(req.params.id);
      if (!queueItem) {
        return res.status(404).json({ message: "Assets queue item not found" });
      }

      const parsedData = typeof queueItem.data === 'string'
        ? JSON.parse(queueItem.data)
        : queueItem.data || {};

      const tech = parsedData.technician || parsedData.employee || {};
      const hr = parsedData.hrSeparation || {};
      const roster = parsedData.rosterContact || {};

      const techName = tech.techName || tech.name || tech.technicianName || hr.technicianName || queueItem.title || "Team Member";
      const ldapId = tech.enterpriseId || tech.ldapId || hr.ldapId || tech.techRacfid || "";
      let personalEmail = tech.personalEmail || hr.personalEmail || roster.personalEmail || tech.email || "";
      const lastDay = hr.lastDay || tech.lastDayWorked || tech.separationDate || "your scheduled last day";

      if (!personalEmail && ldapId) {
        try {
          const allTechRecord = await storage.getAllTechByTechRacfid(ldapId);
          if (allTechRecord) {
            personalEmail = (allTechRecord as any).personalEmail || (allTechRecord as any).email || "";
          }
        } catch (e) {
          console.warn('[Tool Audit] Could not look up enriched tech data:', e);
        }
      }

      if (!ldapId) {
        return res.status(400).json({ message: "No enterprise ID found for this technician" });
      }

      if (!personalEmail) {
        const commTemplate = await storage.getCommunicationTemplateByName('tool-audit-notification');
        const templateMode = commTemplate?.mode || 'simulated';
        if (templateMode === 'live') {
          return res.status(400).json({ message: "No personal email found for this technician. A personal email is required to send the tool audit notification in Live mode." });
        }
        personalEmail = `no-email-on-file@technician.placeholder`;
        console.log(`[Tool Audit] No personal email for ${techName} (${ldapId}). Mode is '${templateMode}' — using placeholder; delivery goes to configured addresses.`);
      }

      let firstName = 'Team Member';
      if (techName.includes(',')) {
        const afterComma = techName.split(',')[1]?.trim().split(/\s+/)[0];
        if (afterComma) firstName = afterComma;
      } else {
        const firstToken = techName.trim().split(/\s+/)[0];
        if (firstToken) firstName = firstToken;
      }

      const { sendToolAuditNotification } = await import("./notification-service");
      const result = await sendToolAuditNotification({
        email: personalEmail,
        firstName: firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase(),
        technicianName: techName,
        lastDay,
        ldapId,
      });

      if (result.success) {
        await storage.updateAssetsQueueItem(req.params.id, { toolAuditNotificationSent: true, toolAuditNotificationSentAt: new Date() });
      }

      res.json({
        success: result.success,
        testMode: result.testMode,
        intendedRecipient: result.intendedRecipient,
        actualRecipient: result.actualRecipient,
        error: result.error,
        techName,
        ldapId,
      });
    } catch (error) {
      console.error('Error sending tool audit notification:', error);
      res.status(500).json({ message: "Failed to send tool audit notification" });
    }
  });

  app.post("/api/assets-queue/:id/send-outreach", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || !hasQueueAccess(currentUser, 'assets')) {
        return res.status(403).json({ message: "Access denied to Assets queue" });
      }

      const queueItem = await storage.getAssetsQueueItem(req.params.id);
      if (!queueItem) {
        return res.status(404).json({ message: "Assets queue item not found" });
      }

      const parsedData = typeof queueItem.data === 'string'
        ? JSON.parse(queueItem.data)
        : queueItem.data || {};

      const tech = parsedData.technician || parsedData.employee || {};
      const hr = parsedData.hrSeparation || {};
      const roster = parsedData.rosterContact || {};

      const techName = tech.techName || tech.name || tech.technicianName || hr.technicianName || queueItem.title || "Team Member";
      const ldapId = tech.enterpriseId || tech.ldapId || hr.ldapId || tech.techRacfid || "";
      let personalEmail = tech.personalEmail || hr.personalEmail || roster.personalEmail || tech.email || "";
      const lastDay = hr.lastDay || tech.lastDayWorked || tech.separationDate || "your scheduled last day";

      if (!personalEmail && ldapId) {
        try {
          const allTechRecord = await storage.getAllTechByTechRacfid(ldapId);
          if (allTechRecord) {
            personalEmail = (allTechRecord as any).personalEmail || (allTechRecord as any).email || "";
          }
        } catch (e) {
          console.warn('[Outreach] Could not look up enriched tech data:', e);
        }
      }

      let firstName = 'Team Member';
      if (techName.includes(',')) {
        const afterComma = techName.split(',')[1]?.trim().split(/\s+/)[0];
        if (afterComma) firstName = afterComma;
      } else {
        const firstToken = techName.trim().split(/\s+/)[0];
        if (firstToken) firstName = firstToken;
      }
      firstName = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();

      const techData = parseTechDataFromQueueItem(typeof queueItem.data === 'string' ? queueItem.data : JSON.stringify(queueItem.data));
      const lane = getDetectionLane(techData.lastDayWorked, queueItem.createdAt ? queueItem.createdAt.toISOString() : null);

      const laneTemplateMap: Record<string, string> = {
        'PRE': 'tool-recovery-outreach-pre',
        'WARM': 'tool-recovery-outreach-warm',
        'LATE': 'tool-recovery-outreach-late',
        'COLD': 'tool-recovery-outreach-cold',
      };
      const templateName = laneTemplateMap[lane] || 'tool-recovery-outreach-warm';

      if (!personalEmail) {
        const commTemplate = await storage.getCommunicationTemplateByName(templateName);
        const templateMode = commTemplate?.mode || 'simulated';
        if (templateMode === 'live') {
          return res.status(400).json({ message: "No personal email found for this technician. A personal email is required to send outreach in Live mode." });
        }
        personalEmail = `no-email-on-file@technician.placeholder`;
        console.log(`[Outreach] No personal email for ${techName} (${ldapId}). Mode is '${templateMode}' — using placeholder.`);
      }

      const returnLink = await generateReturnToken(req.params.id);
      const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
      const fullReturnLink = `${baseUrl}${returnLink}`;

      const separationDate = techData.separationDate || lastDay;
      const enterpriseId = techData.enterpriseId || ldapId || 'N/A';

      const toolAuditLink = `${baseUrl}/tool-audit/${req.params.id}`;
      const qrShippingLink = `${baseUrl}/qr-shipping/${req.params.id}`;

      let detectionGap = '0';
      if (separationDate && separationDate !== 'your scheduled last day') {
        const sepDate = new Date(separationDate);
        if (!isNaN(sepDate.getTime())) {
          const today = new Date();
          sepDate.setHours(0, 0, 0, 0);
          today.setHours(0, 0, 0, 0);
          const daysDiff = Math.floor((today.getTime() - sepDate.getTime()) / (1000 * 60 * 60 * 24));
          detectionGap = String(Math.max(0, daysDiff));
        }
      }

      const { sendCommunication } = await import("./communication-service");
      const result = await sendCommunication({
        templateName,
        recipient: personalEmail,
        variables: {
          firstName,
          technicianName: techName,
          lastDay,
          separationDate,
          enterpriseId,
          toolAuditLink,
          qrShippingLink,
          detectionGap,
          returnLink: fullReturnLink,
        },
        metadata: {
          source: 'tool-recovery-outreach',
          queueItemId: req.params.id,
          lane,
        },
        sentBy: currentUser.id,
      });

      const outreachEvent = {
        channel: 'email' as const,
        templateName,
        lane,
        status: result.status,
        communicationLogId: result.logId,
        sentAt: new Date().toISOString(),
        sentBy: currentUser.username,
        error: result.error,
      };

      await storage.updateAutomationDetail(req.params.id, {
        outreach: [outreachEvent],
      });

      res.json({
        success: result.success,
        status: result.status,
        lane,
        templateName,
        intendedRecipient: result.intendedRecipient,
        actualRecipient: result.actualRecipient,
        techName,
        error: result.error,
      });
    } catch (error) {
      console.error('Error sending outreach:', error);
      res.status(500).json({ message: "Failed to send outreach email" });
    }
  });

  app.get("/api/assets-queue/:id/contact", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || !hasQueueAccess(currentUser, 'assets')) {
        return res.status(403).json({ message: "Access denied to Assets queue" });
      }
      
      const queueItem = await storage.getAssetsQueueItem(req.params.id);
      if (!queueItem) {
        return res.status(404).json({ message: "Assets queue item not found" });
      }
      
      let employeeId: string | null = null;
      let enterpriseId: string | null = null;
      try {
        const parsedData = typeof queueItem.data === 'string' 
          ? JSON.parse(queueItem.data) 
          : queueItem.data;
        employeeId = parsedData?.employee?.employeeId || 
                     parsedData?.employeeId || 
                     parsedData?.emplid ||
                     null;
        enterpriseId = parsedData?.employee?.enterpriseId || 
                       parsedData?.employee?.racfId || 
                       parsedData?.techRacfId ||
                       null;
      } catch (e) {
        console.warn('Could not parse employee ID from queue item data:', e);
      }
      
      if (!employeeId && !enterpriseId) {
        return res.status(404).json({ message: "No employee ID found in queue item" });
      }
      
      let tech = null;
      if (employeeId) {
        tech = await storage.getAllTechByEmployeeId(employeeId);
      }
      if (!tech && enterpriseId) {
        tech = await storage.getAllTechByTechRacfid(enterpriseId);
      }
      if (!tech) {
        return res.status(404).json({ message: "Technician not found in employee roster" });
      }
      
      let mobilePhone: string | null = null;
      const ldapId = enterpriseId || tech.techRacfid;
      if (ldapId) {
        try {
          const { getSnowflakeSyncService } = await import("./snowflake-sync-service");
          const syncService = getSnowflakeSyncService();
          if (syncService) {
            const mobileData = await syncService.getMobilePhoneByLdap(ldapId);
            if (mobileData.success && mobileData.phoneNumber) {
              mobilePhone = mobileData.phoneNumber;
            }
          }
        } catch (e) {
        }
      }
      
      let hrSep: any = null;
      try {
        const parsedData = typeof queueItem.data === 'string' 
          ? JSON.parse(queueItem.data) 
          : queueItem.data;
        hrSep = parsedData?.hrSeparation || null;
      } catch {}
      
      const pickWithSource = (sepVal: string | null | undefined, rosterVal: string | null | undefined) => {
        if (sepVal) return { value: sepVal, source: 'separation' as const };
        if (rosterVal) return { value: rosterVal, source: 'roster' as const };
        return { value: null, source: null };
      };

      const rosterAddress = [tech.homeAddr1, tech.homeAddr2, tech.homeCity, tech.homeState, tech.homePostal].filter(Boolean).join(', ') || null;
      const sepAddress = hrSep?.fleetPickupAddress || null;

      const rosterPersonal = tech.cellPhone || null;
      const rosterMobile = tech.mainPhone || null;
      const tpmsMobile = mobilePhone || rosterMobile;
      const resolvedPersonal = hrSep?.contactNumber || rosterPersonal;

      let finalMobile: string | null;
      let finalPersonal: string | null;

      if (tpmsMobile && resolvedPersonal) {
        finalMobile = tpmsMobile;
        finalPersonal = resolvedPersonal === tpmsMobile ? null : resolvedPersonal;
      } else if (tpmsMobile) {
        finalMobile = tpmsMobile;
        finalPersonal = null;
      } else if (resolvedPersonal) {
        finalMobile = resolvedPersonal;
        finalPersonal = null;
      } else {
        finalMobile = null;
        finalPersonal = null;
      }

      const mobileSource = finalMobile
        ? (mobilePhone ? 'roster' as const : (rosterMobile && finalMobile === rosterMobile ? 'roster' as const : (resolvedPersonal && finalMobile === resolvedPersonal ? (hrSep?.contactNumber ? 'separation' as const : 'roster' as const) : null)))
        : null;
      const personalSource = finalPersonal
        ? (hrSep?.contactNumber && hrSep.contactNumber === finalPersonal ? 'separation' as const : 'roster' as const)
        : null;

      res.json({
        personalPhone: { value: finalPersonal || null, source: personalSource },
        mobilePhone: { value: finalMobile || null, source: mobileSource },
        mainPhone: { value: tech.mainPhone || null, source: tech.mainPhone ? 'roster' as const : null },
        homePhone: { value: tech.homePhone || null, source: tech.homePhone ? 'roster' as const : null },
        personalEmail: pickWithSource(hrSep?.personalEmail, null),
        address: pickWithSource(null, rosterAddress),
        fleetPickupAddress: pickWithSource(sepAddress, null),
        hrTruckNumber: pickWithSource(hrSep?.truckNumber, tech.lastKnownTruckLu || null),
        homeAddress: {
          line1: tech.homeAddr1 || null,
          line2: tech.homeAddr2 || null,
          city: tech.homeCity || null,
          state: tech.homeState || null,
          postal: tech.homePostal || null,
        },
        employeeId: tech.employeeId,
        techName: tech.techName,
        separationCategory: hrSep?.separationCategory || null,
      });
    } catch (error) {
      console.error('Error fetching contact info:', error);
      res.status(500).json({ message: "Failed to fetch contact info" });
    }
  });

  // Inventory Queue Module routes
  app.get("/api/inventory-queue", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || !hasQueueAccess(currentUser, 'inventory')) {
        return res.status(403).json({ message: "Access denied to Inventory queue" });
      }
      const queueItems = await storage.getInventoryQueueItems();
      res.json(queueItems);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch Inventory queue items" });
    }
  });

  app.get("/api/inventory-queue/:id", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || !hasQueueAccess(currentUser, 'inventory')) {
        return res.status(403).json({ message: "Access denied to Inventory queue" });
      }
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

  app.patch("/api/inventory-queue/:id/assign", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || !hasQueueAccess(currentUser, 'inventory')) {
        return res.status(403).json({ message: "Access denied to Inventory queue" });
      }
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

  app.patch("/api/inventory-queue/:id/complete", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || !hasQueueAccess(currentUser, 'inventory')) {
        return res.status(403).json({ message: "Access denied to Inventory queue" });
      }
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

  // Phone Recovery routes (operate on Inventory Control queue items)
  app.post("/api/phone-recovery/:id/contact", requireAuth, async (req: any, res) => {
    try {
      const contactSchema = z.object({
        method: z.enum(["Phone", "Email", "Text"]),
        outcome: z.enum(["Reached", "Voicemail", "No Response", "Declined", "Wrong Number"]),
        notes: z.string().max(2000).default(""),
        shippingLabelSent: z.boolean().optional(),
        trackingNumber: z.string().max(100).optional(),
      });

      const validated = contactSchema.parse(req.body);
      const item = await storage.getInventoryQueueItem(req.params.id);
      if (!item) {
        return res.status(404).json({ message: "Phone recovery task not found" });
      }

      const existingHistory = (item.phoneContactHistory ?? []) as any[];
      const newEntry = {
        date: new Date().toISOString(),
        method: validated.method,
        outcome: validated.outcome,
        notes: validated.notes,
      };

      const updates: any = {
        phoneContactHistory: [...existingHistory, newEntry],
        phoneContactMethod: validated.method,
      };

      if (validated.shippingLabelSent !== undefined) {
        updates.phoneShippingLabelSent = validated.shippingLabelSent;
      }
      if (validated.trackingNumber) {
        updates.phoneTrackingNumber = validated.trackingNumber;
      }

      const updated = await storage.updateInventoryQueueItem(req.params.id, updates);
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid input", errors: error.errors });
      }
      console.error("Phone recovery contact error:", error);
      res.status(500).json({ message: "Failed to log contact attempt" });
    }
  });

  app.patch("/api/phone-recovery/:id/shipping", requireAuth, async (req: any, res) => {
    try {
      const shippingSchema = z.object({
        shippingLabelSent: z.boolean(),
        trackingNumber: z.string().max(100).optional(),
      });

      const validated = shippingSchema.parse(req.body);
      const item = await storage.getInventoryQueueItem(req.params.id);
      if (!item) {
        return res.status(404).json({ message: "Phone recovery task not found" });
      }

      const updated = await storage.updateInventoryQueueItem(req.params.id, {
        phoneShippingLabelSent: validated.shippingLabelSent,
        phoneTrackingNumber: validated.trackingNumber || null,
      });
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid input", errors: error.errors });
      }
      console.error("Phone recovery shipping error:", error);
      res.status(500).json({ message: "Failed to update shipping info" });
    }
  });

  app.patch("/api/phone-recovery/:id/received", requireAuth, async (req: any, res) => {
    try {
      const item = await storage.getInventoryQueueItem(req.params.id);
      if (!item) {
        return res.status(404).json({ message: "Phone recovery task not found" });
      }

      const updated = await storage.updateInventoryQueueItem(req.params.id, {
        phoneDateReceived: new Date(),
        phoneRecoveryStage: "reprovisioning",
      });
      res.json(updated);
    } catch (error) {
      console.error("Phone recovery received error:", error);
      res.status(500).json({ message: "Failed to mark phone as received" });
    }
  });

  app.patch("/api/phone-recovery/:id/inspect", requireAuth, async (req: any, res) => {
    try {
      const inspectSchema = z.object({
        physicalCondition: z.enum(["Good", "Damaged", "Non-functional"]),
        conditionNotes: z.string().max(2000).optional(),
      });

      const validated = inspectSchema.parse(req.body);
      const item = await storage.getInventoryQueueItem(req.params.id);
      if (!item) {
        return res.status(404).json({ message: "Phone recovery task not found" });
      }

      const updated = await storage.updateInventoryQueueItem(req.params.id, {
        phonePhysicalCondition: validated.physicalCondition,
        phoneConditionNotes: validated.conditionNotes || null,
      });
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid input", errors: error.errors });
      }
      console.error("Phone recovery inspect error:", error);
      res.status(500).json({ message: "Failed to update inspection" });
    }
  });

  app.patch("/api/phone-recovery/:id/reprovisioning", requireAuth, async (req: any, res) => {
    try {
      const reprovisionSchema = z.object({
        phoneDataWipeCompleted: z.boolean().optional(),
        phoneWipeMethod: z.enum(["Factory Reset", "Secure Erase", "MDM Remote Wipe"]).optional(),
        phoneReprovisionCompleted: z.boolean().optional(),
        phoneCarrierLineDetails: z.string().max(500).optional(),
        phoneServiceReinstated: z.boolean().optional(),
        phoneAssignedToNewHire: z.string().max(200).optional(),
        phoneNewHireDepartment: z.string().max(200).optional(),
      });

      const validated = reprovisionSchema.parse(req.body);
      const item = await storage.getInventoryQueueItem(req.params.id);
      if (!item) {
        return res.status(404).json({ message: "Phone recovery task not found" });
      }
      if (item.phoneWrittenOff) {
        return res.status(400).json({ message: "Cannot update a written-off device" });
      }

      const updates: any = {};
      if (validated.phoneDataWipeCompleted !== undefined) updates.phoneDataWipeCompleted = validated.phoneDataWipeCompleted;
      if (validated.phoneWipeMethod !== undefined) updates.phoneWipeMethod = validated.phoneWipeMethod;
      if (validated.phoneReprovisionCompleted !== undefined) updates.phoneReprovisionCompleted = validated.phoneReprovisionCompleted;
      if (validated.phoneCarrierLineDetails !== undefined) updates.phoneCarrierLineDetails = validated.phoneCarrierLineDetails;
      if (validated.phoneServiceReinstated !== undefined) updates.phoneServiceReinstated = validated.phoneServiceReinstated;
      if (validated.phoneAssignedToNewHire !== undefined) updates.phoneAssignedToNewHire = validated.phoneAssignedToNewHire;
      if (validated.phoneNewHireDepartment !== undefined) updates.phoneNewHireDepartment = validated.phoneNewHireDepartment;

      const wipe = validated.phoneDataWipeCompleted ?? item.phoneDataWipeCompleted;
      const reprov = validated.phoneReprovisionCompleted ?? item.phoneReprovisionCompleted;
      const service = validated.phoneServiceReinstated ?? item.phoneServiceReinstated;
      if (wipe && reprov && service && !item.phoneDateReady) {
        updates.phoneDateReady = new Date();
      }

      const updated = await storage.updateInventoryQueueItem(req.params.id, updates);
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid input", errors: error.errors });
      }
      console.error("Phone recovery reprovisioning error:", error);
      res.status(500).json({ message: "Failed to update reprovisioning" });
    }
  });

  app.patch("/api/phone-recovery/:id/write-off", requireAuth, async (req: any, res) => {
    try {
      const item = await storage.getInventoryQueueItem(req.params.id);
      if (!item) {
        return res.status(404).json({ message: "Phone recovery task not found" });
      }

      const updated = await storage.updateInventoryQueueItem(req.params.id, {
        phoneWrittenOff: true,
      });
      res.json(updated);
    } catch (error) {
      console.error("Phone recovery write-off error:", error);
      res.status(500).json({ message: "Failed to write off device" });
    }
  });

  // Phone Recovery Queue list endpoint
  app.get("/api/phone-recovery", requireAuth, async (req: any, res) => {
    try {
      const allItems = await storage.getInventoryQueueItems();
      const phoneRecoveryItems = allItems.filter((item) => {
        try {
          const d = JSON.parse(item.data || "{}");
          return d.step === "phone_recover_device_day0";
        } catch {
          return false;
        }
      });
      res.json(phoneRecoveryItems);
    } catch (error) {
      console.error("Phone recovery list error:", error);
      res.status(500).json({ message: "Failed to fetch phone recovery tasks" });
    }
  });

  app.post("/api/phone-recovery/seed", requireAuth, async (req: any, res) => {
    try {
      const seedTasks = [
        {
          technicianName: "Sarah Chen",
          step: "phone_recover_device_day0",
          department: "Inventory Control",
          status: "pending",
          phoneNumber: "(555) 100-0001",
          phoneContactHistory: [],
          phoneRecoveryStage: "initiation",
          separationDate: new Date("2026-03-10"),
          createdAt: new Date("2026-03-10"),
        },
        {
          technicianName: "Marcus Johnson",
          step: "phone_recover_device_day0",
          department: "Inventory Control",
          status: "pending",
          phoneNumber: "(555) 100-0002",
          phoneContactHistory: [
            { date: "2026-03-06T10:00:00Z", method: "Phone", outcome: "Voicemail", notes: "Left voicemail" },
            { date: "2026-03-07T14:00:00Z", method: "Phone", outcome: "No Response", notes: "" },
          ],
          phoneContactMethod: "Phone",
          phoneRecoveryStage: "initiation",
          separationDate: new Date("2026-03-05"),
          createdAt: new Date("2026-03-05"),
        },
        {
          technicianName: "Emily Rodriguez",
          step: "phone_recover_device_day0",
          department: "Inventory Control",
          status: "pending",
          phoneNumber: "(555) 100-0003",
          phoneContactHistory: [
            { date: "2026-02-26T09:00:00Z", method: "Phone", outcome: "No Response", notes: "" },
            { date: "2026-02-27T11:00:00Z", method: "Email", outcome: "No Response", notes: "" },
            { date: "2026-02-28T10:00:00Z", method: "Phone", outcome: "No Response", notes: "" },
            { date: "2026-03-01T15:00:00Z", method: "Phone", outcome: "No Response", notes: "4th attempt, no answer" },
          ],
          phoneContactMethod: "Phone",
          phoneRecoveryStage: "initiation",
          separationDate: new Date("2026-02-25"),
          createdAt: new Date("2026-02-25"),
        },
        {
          technicianName: "David Kim",
          step: "phone_recover_device_day0",
          department: "Inventory Control",
          status: "pending",
          phoneNumber: "(555) 100-0004",
          phoneContactHistory: [
            { date: "2026-03-09T10:00:00Z", method: "Phone", outcome: "Reached", notes: "Agreed to return" },
          ],
          phoneContactMethod: "Phone",
          phoneShippingLabelSent: true,
          phoneTrackingNumber: "TRK-001",
          phoneRecoveryStage: "initiation",
          separationDate: new Date("2026-03-08"),
          createdAt: new Date("2026-03-08"),
        },
        {
          technicianName: "Priya Patel",
          step: "phone_recover_device_day0",
          department: "Inventory Control",
          status: "pending",
          phoneNumber: "(555) 100-0005",
          phoneContactHistory: [
            { date: "2026-03-02T09:00:00Z", method: "Phone", outcome: "Reached", notes: "Shipping phone back" },
          ],
          phoneContactMethod: "Phone",
          phoneShippingLabelSent: true,
          phoneTrackingNumber: "1Z999AA10123456784",
          phoneRecoveryStage: "initiation",
          separationDate: new Date("2026-03-01"),
          createdAt: new Date("2026-03-01"),
        },
        {
          technicianName: "James Wilson",
          step: "phone_recover_device_day0",
          department: "Inventory Control",
          status: "pending",
          phoneNumber: "(555) 100-0006",
          phoneContactHistory: [
            { date: "2026-02-22T10:00:00Z", method: "Phone", outcome: "Reached", notes: "Phone returned" },
          ],
          phoneContactMethod: "Phone",
          phoneDateReceived: new Date("2026-02-25"),
          phoneRecoveryStage: "reprovisioning",
          separationDate: new Date("2026-02-20"),
          createdAt: new Date("2026-02-20"),
        },
        {
          technicianName: "Lisa Thompson",
          step: "phone_recover_device_day0",
          department: "Inventory Control",
          status: "pending",
          phoneNumber: "(555) 100-0007",
          phoneContactHistory: [
            { date: "2026-02-16T10:00:00Z", method: "Phone", outcome: "Reached", notes: "Phone received" },
          ],
          phoneContactMethod: "Phone",
          phoneDateReceived: new Date("2026-02-18"),
          phonePhysicalCondition: "Damaged",
          phoneConditionNotes: "Minor scratches on screen",
          phoneRecoveryStage: "reprovisioning",
          separationDate: new Date("2026-02-15"),
          createdAt: new Date("2026-02-15"),
        },
        {
          technicianName: "Robert Garcia",
          step: "phone_recover_device_day0",
          department: "Inventory Control",
          status: "pending",
          phoneNumber: "(555) 100-0008",
          phoneContactHistory: [
            { date: "2026-02-11T10:00:00Z", method: "Phone", outcome: "Reached", notes: "Phone returned" },
          ],
          phoneContactMethod: "Phone",
          phoneDateReceived: new Date("2026-02-13"),
          phonePhysicalCondition: "Good",
          phoneDataWipeCompleted: true,
          phoneWipeMethod: "Factory Reset",
          phoneRecoveryStage: "reprovisioning",
          separationDate: new Date("2026-02-10"),
          createdAt: new Date("2026-02-10"),
        },
        {
          technicianName: "Amanda Foster",
          step: "phone_recover_device_day0",
          department: "Inventory Control",
          status: "pending",
          phoneNumber: "(555) 100-0009",
          phoneContactHistory: [
            { date: "2026-02-19T10:00:00Z", method: "Phone", outcome: "Reached", notes: "Initial contact" },
            { date: "2026-02-20T11:00:00Z", method: "Phone", outcome: "Declined", notes: "Refused to return" },
            { date: "2026-02-21T09:00:00Z", method: "Email", outcome: "Declined", notes: "Sent formal request" },
          ],
          phoneContactMethod: "Email",
          phoneRecoveryStage: "initiation",
          separationDate: new Date("2026-02-18"),
          createdAt: new Date("2026-02-18"),
        },
        {
          technicianName: "Michael Brown",
          step: "phone_recover_device_day0",
          department: "Inventory Control",
          status: "pending",
          phoneNumber: "(555) 100-0010",
          phoneContactHistory: [
            { date: "2026-01-30T10:00:00Z", method: "Phone", outcome: "Reached", notes: "Phone returned" },
          ],
          phoneContactMethod: "Phone",
          phoneDateReceived: new Date("2026-02-01"),
          phonePhysicalCondition: "Good",
          phoneDataWipeCompleted: true,
          phoneWipeMethod: "Secure Erase",
          phoneReprovisionCompleted: true,
          phoneServiceReinstated: true,
          phoneDateReady: new Date("2026-02-05"),
          phoneRecoveryStage: "reprovisioning",
          separationDate: new Date("2026-01-28"),
          createdAt: new Date("2026-01-28"),
        },
      ];

      const created = [];
      for (const task of seedTasks) {
        const { technicianName, separationDate, step, ...rest } = task as any;
        const queueItem = {
          ...rest,
          workflowType: "offboarding",
          title: `Day 0: Phone Recovery - ${technicianName}`,
          description: `Initiate phone recovery for terminated Employee ${technicianName}.`,
          requesterId: "system",
          data: JSON.stringify({
            step,
            subtask: "Phone Recovery",
            phase: "day0",
            isDay0Task: true,
            source: "seed",
            separationDate: separationDate?.toISOString(),
            technician: {
              techName: technicianName,
              lastDayWorked: separationDate?.toISOString(),
            },
          }),
        };
        const item = await storage.createInventoryQueueItem(queueItem as any);
        created.push(item);
      }

      res.json({ message: `Created ${created.length} seed phone recovery tasks`, count: created.length });
    } catch (error) {
      console.error("Phone recovery seed error:", error);
      res.status(500).json({ message: "Failed to seed phone recovery tasks" });
    }
  });

  app.post("/api/phone-recovery/backfill", requireAuth, async (req: any, res) => {
    try {
      const assetsItems = await storage.getAssetsQueueItems();
      const inventoryItems = await storage.getInventoryQueueItems();

      const existingWorkflowIds = new Set<string>();
      const existingEmployeeIds = new Set<string>();
      for (const item of inventoryItems) {
        try {
          const d = JSON.parse(item.data || "{}");
          if (d.step === "phone_recover_device_day0") {
            if (item.workflowId) existingWorkflowIds.add(item.workflowId);
            const eid = d.technician?.employeeId;
            if (eid) existingEmployeeIds.add(eid);
          }
        } catch {}
      }

      let created = 0;
      let skipped = 0;

      for (const assetsItem of assetsItems) {
        let techData: any = {};
        try {
          techData = JSON.parse(assetsItem.data || "{}");
        } catch {}

        const tech = techData.technician || {};
        const employeeId = tech.employeeId || "";

        if (assetsItem.workflowId && existingWorkflowIds.has(assetsItem.workflowId)) {
          skipped++;
          continue;
        }
        if (employeeId && existingEmployeeIds.has(employeeId)) {
          skipped++;
          continue;
        }

        const techName = tech.techName || tech.enterpriseId || "Unknown";
        const techRacfid = tech.techRacfid || tech.enterpriseId || "";
        const separationDate = tech.lastDayWorked || tech.effectiveDate || techData.separationDate || null;

        let phoneNumber: string | null = null;
        try {
          let allTechRecord;
          if (employeeId) {
            allTechRecord = await storage.getAllTechByEmployeeId(employeeId);
          }
          if (!allTechRecord && techRacfid) {
            allTechRecord = await storage.getAllTechByTechRacfid(techRacfid);
          }
          if (allTechRecord) {
            phoneNumber = allTechRecord.cellPhone || allTechRecord.mainPhone || null;
          }
        } catch {}

        const queueItem = {
          workflowType: "offboarding" as const,
          title: `Day 0: Phone Recovery - ${techName}`,
          description: `Initiate phone recovery for terminated Employee ${techName} (${techRacfid}).`,
          status: "pending",
          priority: "high",
          requesterId: "system",
          department: "Inventory Control",
          workflowId: assetsItem.workflowId || null,
          workflowStep: 5,
          phoneRecoveryStage: "initiation",
          phoneContactHistory: [] as any[],
          phoneNumber,
          createdAt: assetsItem.createdAt,
          data: JSON.stringify({
            step: "phone_recover_device_day0",
            subtask: "Phone Recovery",
            phase: "day0",
            isDay0Task: true,
            source: "backfill_from_assets",
            separationDate,
            technician: tech,
            vehicle: techData.vehicle || {},
            workflowId: assetsItem.workflowId,
          }),
          metadata: JSON.stringify({
            createdVia: "phone_recovery_backfill",
            sourceAssetsItemId: assetsItem.id,
          }),
        };

        await storage.createInventoryQueueItem(queueItem as any);
        if (employeeId) existingEmployeeIds.add(employeeId);
        if (assetsItem.workflowId) existingWorkflowIds.add(assetsItem.workflowId);
        created++;
      }

      res.json({
        message: `Phone recovery backfill complete: ${created} created, ${skipped} skipped (already existed)`,
        created,
        skipped,
        total: created + skipped,
      });
    } catch (error) {
      console.error("Phone recovery backfill error:", error);
      res.status(500).json({ message: "Failed to backfill phone recovery tasks" });
    }
  });

  // Fleet Queue Module routes
  app.get("/api/fleet-queue", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || !hasQueueAccess(currentUser, 'fleet')) {
        return res.status(403).json({ message: "Access denied to Fleet queue" });
      }
      const queueItems = await storage.getFleetQueueItems();
      res.json(queueItems);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch Fleet queue items" });
    }
  });

  app.get("/api/fleet-queue/:id", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || !hasQueueAccess(currentUser, 'fleet')) {
        return res.status(403).json({ message: "Access denied to Fleet queue" });
      }
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

  app.patch("/api/fleet-queue/:id/assign", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || !hasQueueAccess(currentUser, 'fleet')) {
        return res.status(403).json({ message: "Access denied to Fleet queue" });
      }
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

  app.patch("/api/fleet-queue/:id/complete", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || !hasQueueAccess(currentUser, 'fleet')) {
        return res.status(403).json({ message: "Access denied to Fleet queue" });
      }
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

  // Check for existing open offboarding tasks for an employee
  app.get("/api/offboarding/check-existing", async (req, res) => {
    try {
      const { employeeId, techRacfId } = req.query;
      
      if (!employeeId && !techRacfId) {
        return res.status(400).json({ message: "Either employeeId or techRacfId is required" });
      }
      
      const result = await storage.findExistingOffboardingTasks(
        employeeId as string || '',
        techRacfId as string || ''
      );
      
      res.json(result);
    } catch (error) {
      console.error('Error checking existing offboarding tasks:', error);
      res.status(500).json({ message: "Failed to check existing offboarding tasks" });
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
  app.patch("/api/queue/:id/cancel", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser) {
        return res.status(401).json({ message: "Invalid user" });
      }
      
      const { reason } = req.body;
      if (!reason) {
        return res.status(400).json({ message: "Cancellation reason is required" });
      }

      const queueItem = await storage.cancelQueueItem(req.params.id, reason);
      
      if (!queueItem) {
        return res.status(404).json({ message: "Queue item not found" });
      }

      // Log queue cancellation action
      await storage.createActivityLog({
        userId: currentUser.id,
        action: 'queue_item_cancelled',
        entityType: 'queue',
        entityId: req.params.id,
        details: `Queue item "${queueItem.title}" cancelled by ${currentUser.username}. Reason: ${reason}`,
      });

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
      
      // Enforce access control using departments
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
      
      // Sprint 2: Compute currentBlockingStatus for Assets Management items
      const enrichedItems = await Promise.all(items.map(async (item) => {
        if (item.department !== 'Assets Management') {
          return item;
        }
        
        // Compute blocking status based on stored fields and Fleet task status
        let currentBlockingStatus = {
          status: item.isByov ? 'ROUTING_RECEIVED' : 'AWAITING_ROUTING',
          routingPath: item.fleetRoutingDecision || null,
          blockedActions: item.blockedActions || [],
          isByov: item.isByov || false,
        };
        
        // If non-BYOV and has routing decision, it's unblocked
        if (!item.isByov && item.fleetRoutingDecision) {
          currentBlockingStatus = {
            status: 'ROUTING_RECEIVED',
            routingPath: item.fleetRoutingDecision,
            blockedActions: [],
            isByov: false,
          };
        } else if (!item.isByov && item.workflowId) {
          // Check if Fleet task is completed
          const fleetTask = await storage.getFleetTaskByWorkflowId(item.workflowId);
          if (fleetTask && fleetTask.status === 'completed') {
            currentBlockingStatus = {
              status: 'ROUTING_RECEIVED',
              routingPath: fleetTask.fleetRoutingDecision || 'Fleet Routing',
              blockedActions: [],
              isByov: false,
            };
          }
        }
        
        return {
          ...item,
          currentBlockingStatus,
        };
      }));
      
      res.json(enrichedItems);
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
      
      // Enforce access control using departments
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
      if (!currentUser || currentUser.role !== 'developer') {
        return res.status(403).json({ message: "Access denied. Productivity dashboard requires developer role." });
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
        },
        tools: {
          name: "Tools",
          description: "Equipment Recovery & Management",
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

  async function generateReportData() {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    const { holmanVehicleSyncService: fleetService } = await import("./holman-vehicle-sync-service");

    const [ntaoItems, assetsItems, inventoryItems, fleetItems, activityLogs, allUsers, nexusVehicles, holmanVehicles, vehicleAssignments, hires, spots, allTermedTechs, liveFleetResult] = await Promise.all([
      storage.getNTAOQueueItems().catch(() => []),
      storage.getAssetsQueueItems().catch(() => []),
      storage.getInventoryQueueItems().catch(() => []),
      storage.getFleetQueueItems().catch(() => []),
      storage.getActivityLogs().catch(() => []),
      storage.getUsers().catch(() => []),
      db.select().from(vehicleNexusData).catch(() => []),
      db.select().from(holmanVehiclesCache).catch(() => []),
      db.select().from(techVehicleAssignments).catch(() => []),
      storage.getOnboardingHires().catch(() => []),
      db.select().from(storageSpots).catch(() => []),
      db.select().from(termedTechs).catch(() => []),
      fleetService.fetchActiveVehicles().catch(() => ({ vehicles: [] as any[] })),
    ]);

    const allQueues = [
      { module: 'ntao', label: 'NTAO', items: ntaoItems },
      { module: 'assets', label: 'Assets', items: assetsItems },
      { module: 'inventory', label: 'Inventory', items: inventoryItems },
      { module: 'fleet', label: 'Fleet', items: fleetItems },
    ];

    const queueSummary = allQueues.map(q => {
      const total = q.items.length;
      const statusCounts = { new: 0, in_progress: 0, completed: 0, cancelled: 0 };
      let completedToday = 0, completedThisWeek = 0, completedThisMonth = 0;
      const agentWorkload: Record<string, number> = {};

      for (const item of q.items) {
        const s = (item.status || 'new') as keyof typeof statusCounts;
        if (s in statusCounts) statusCounts[s]++;
        if (item.status === 'completed' && item.completedAt) {
          const d = new Date(item.completedAt);
          if (d >= startOfToday) completedToday++;
          if (d >= startOfWeek) completedThisWeek++;
          if (d >= startOfMonth) completedThisMonth++;
        }
        if (item.assignedTo && item.status === 'in_progress') {
          agentWorkload[item.assignedTo] = (agentWorkload[item.assignedTo] || 0) + 1;
        }
      }

      const recentCompleted = q.items.filter(i => i.status === 'completed' && i.completedAt && new Date(i.completedAt) >= thirtyDaysAgo);
      let avgResolutionHours = 0;
      if (recentCompleted.length > 0) {
        const totalMs = recentCompleted.reduce((sum, i) => {
          return sum + (new Date(i.completedAt!).getTime() - new Date(i.createdAt!).getTime());
        }, 0);
        avgResolutionHours = Math.round((totalMs / recentCompleted.length) / (1000 * 60 * 60) * 10) / 10;
      }

      return {
        module: q.module, label: q.label, total,
        ...statusCounts, completedToday, completedThisWeek, completedThisMonth,
        avgResolutionHours, agentWorkload,
      };
    });

    const recentActivity = activityLogs
      .sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime())
      .slice(0, 100);

    const activityByDay: Record<string, number> = {};
    for (const log of activityLogs) {
      if (log.createdAt && new Date(log.createdAt) >= sevenDaysAgo) {
        const day = new Date(log.createdAt).toISOString().split('T')[0];
        activityByDay[day] = (activityByDay[day] || 0) + 1;
      }
    }

    const activityByAction: Record<string, number> = {};
    for (const log of activityLogs) {
      if (log.createdAt && new Date(log.createdAt) >= thirtyDaysAgo) {
        activityByAction[log.action] = (activityByAction[log.action] || 0) + 1;
      }
    }

    const activeUsers = allUsers.filter(u => u.isActive);
    const usersByRole: Record<string, number> = {};
    for (const u of activeUsers) {
      usersByRole[u.role] = (usersByRole[u.role] || 0) + 1;
    }

    const topAgents: { username: string; completed: number }[] = [];
    const agentCompletions: Record<string, number> = {};
    for (const q of allQueues) {
      for (const item of q.items) {
        if (item.status === 'completed' && item.assignedTo && item.completedAt && new Date(item.completedAt) >= thirtyDaysAgo) {
          agentCompletions[item.assignedTo] = (agentCompletions[item.assignedTo] || 0) + 1;
        }
      }
    }
    for (const [username, completed] of Object.entries(agentCompletions).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
      topAgents.push({ username, completed });
    }

    const nexusStatusBreakdown: Record<string, number> = {};
    for (const v of nexusVehicles) {
      const status = v.postOffboardedStatus || 'unset';
      nexusStatusBreakdown[status] = (nexusStatusBreakdown[status] || 0) + 1;
    }

    const nexusKeysBreakdown: Record<string, number> = {};
    for (const v of nexusVehicles) {
      const key = v.keys || 'unknown';
      nexusKeysBreakdown[key] = (nexusKeysBreakdown[key] || 0) + 1;
    }

    const nexusRepairBreakdown: Record<string, number> = {};
    for (const v of nexusVehicles) {
      const rep = v.repaired || 'unknown';
      nexusRepairBreakdown[rep] = (nexusRepairBreakdown[rep] || 0) + 1;
    }

    const holmanByStatus: Record<string, number> = {};
    const holmanByMake: Record<string, number> = {};
    const holmanByState: Record<string, number> = {};
    const holmanByFuel: Record<string, number> = {};
    for (const h of holmanVehicles) {
      const status = h.statusCode === 0 ? 'new'
        : h.statusCode === 1 ? 'active'
        : h.statusCode === 2 ? 'out-of-service'
        : h.statusCode === 3 ? 'sold'
        : 'unknown';
      holmanByStatus[status] = (holmanByStatus[status] || 0) + 1;
      if (h.makeName) holmanByMake[h.makeName] = (holmanByMake[h.makeName] || 0) + 1;
      if (h.state) holmanByState[h.state] = (holmanByState[h.state] || 0) + 1;
      if (h.fuelType) holmanByFuel[h.fuelType] = (holmanByFuel[h.fuelType] || 0) + 1;
    }

    const fleetQueueByType: Record<string, number> = {};
    const fleetQueueByStatus: Record<string, number> = {};
    const fleetQueueByVehicleType: Record<string, number> = {};
    for (const item of fleetItems) {
      const wf = item.workflowType || 'unknown';
      fleetQueueByType[wf] = (fleetQueueByType[wf] || 0) + 1;
      const s = item.status || 'unknown';
      fleetQueueByStatus[s] = (fleetQueueByStatus[s] || 0) + 1;
      const vt = item.vehicleType || 'unknown';
      fleetQueueByVehicleType[vt] = (fleetQueueByVehicleType[vt] || 0) + 1;
    }

    const assetsQueueByType: Record<string, number> = {};
    const assetsQueueByStatus: Record<string, number> = {};
    for (const item of assetsItems) {
      const wf = item.workflowType || 'unknown';
      assetsQueueByType[wf] = (assetsQueueByType[wf] || 0) + 1;
      const s = item.status || 'unknown';
      assetsQueueByStatus[s] = (assetsQueueByStatus[s] || 0) + 1;
    }

    const onboardingByEmploymentStatus: Record<string, number> = {};
    const onboardingTruckAssigned: { assigned: number; unassigned: number } = { assigned: 0, unassigned: 0 };
    for (const h of hires) {
      const s = h.employmentStatus || 'unknown';
      onboardingByEmploymentStatus[s] = (onboardingByEmploymentStatus[s] || 0) + 1;
      if (h.truckAssigned) onboardingTruckAssigned.assigned++;
      else onboardingTruckAssigned.unassigned++;
    }

    const storageUtilization = spots.map(s => ({
      name: s.name,
      city: s.city,
      state: s.state,
      available: s.availableSpots,
      total: s.totalCapacity,
      utilization: s.totalCapacity > 0 ? Math.round((1 - s.availableSpots / s.totalCapacity) * 100) : 0,
      status: s.status,
    }));

    const liveFleetVehicles = liveFleetResult.vehicles || [];
    const activeHolman = holmanVehicles.filter(v => v.statusCode === 1);
    const liveAssigned = liveFleetVehicles.filter((v: any) => v.tpmsAssignedTechId);
    const liveMismatches = liveFleetVehicles.filter((v: any) => {
      const h = ((v.holmanTechAssigned || v.clientData2 || '') as string).trim();
      const t = ((v.tpmsAssignedTechId || '') as string).trim();
      return (h && t && h.toLowerCase() !== t.toLowerCase()) || (h && !t);
    });
    const fleetMetrics = {
      totalActive: liveFleetVehicles.length || activeHolman.length,
      outOfService: holmanVehicles.filter(v => v.statusCode === 2).length,
      assigned: liveAssigned.length || activeHolman.filter(v => v.holmanTechAssigned && v.holmanTechAssigned.trim() !== '').length,
      unassigned: (liveFleetVehicles.length - liveAssigned.length) || activeHolman.filter(v => !v.holmanTechAssigned || v.holmanTechAssigned.trim() === '').length,
      assignmentMismatches: liveMismatches.length,
      inRepair: nexusVehicles.filter(v => v.postOffboardedStatus === 'in_repair').length,
      estimateDeclines: nexusVehicles.filter(v => v.postOffboardedStatus === 'declined_repair').length,
      spareAvailable: nexusVehicles.filter(v =>
        v.postOffboardedStatus === 'available_for_rental_pmf' || v.postOffboardedStatus === 'reserved_for_new_hire'
      ).length,
    };

    const pendingHires = hires.filter(h => !h.truckAssigned);
    const assignedHires = hires.filter(h => h.truckAssigned);
    const onboardingIntelligence = {
      totalHires: hires.length,
      assignedCount: assignedHires.length,
      pendingCount: pendingHires.length,
      completedThisWeek: assignedHires.filter(h => h.assignedAt && new Date(h.assignedAt) >= startOfWeek).length,
      completedThisMonth: assignedHires.filter(h => h.assignedAt && new Date(h.assignedAt) >= startOfMonth).length,
      aged14Days: pendingHires.filter(h => h.serviceDate && new Date(h.serviceDate) <= fourteenDaysAgo).length,
      aged30Days: pendingHires.filter(h => h.serviceDate && new Date(h.serviceDate) <= thirtyDaysAgo).length,
      byEmploymentStatus: onboardingByEmploymentStatus,
      pendingByState: (() => {
        const byState: Record<string, number> = {};
        for (const h of pendingHires) {
          const st = h.workState || 'unknown';
          byState[st] = (byState[st] || 0) + 1;
        }
        return byState;
      })(),
      roadblocks: (() => {
        const issues: { type: string; severity: string; message: string; count: number }[] = [];
        const terminatedPending = pendingHires.filter(h => h.employmentStatus === 'T');
        if (terminatedPending.length > 0) {
          issues.push({ type: 'terminated_pending', severity: 'critical', message: 'Terminated employees still pending truck assignment', count: terminatedPending.length });
        }
        const aged30 = pendingHires.filter(h => h.serviceDate && new Date(h.serviceDate) <= thirtyDaysAgo);
        if (aged30.length > 0) {
          issues.push({ type: 'aged_30_days', severity: 'high', message: 'Hires waiting 30+ days for truck assignment', count: aged30.length });
        }
        const leavePending = pendingHires.filter(h => h.employmentStatus === 'L');
        if (leavePending.length > 0) {
          issues.push({ type: 'leave_pending', severity: 'medium', message: 'Employees on leave still pending assignment', count: leavePending.length });
        }
        return issues;
      })(),
    };

    const offboardingItems = [...assetsItems, ...ntaoItems, ...fleetItems, ...inventoryItems].filter(i => i.workflowType === 'offboarding');
    const offboardingCompleted = offboardingItems.filter(i => i.status === 'completed');
    const offboardingOpen = offboardingItems.filter(i => i.status !== 'completed' && i.status !== 'cancelled');
    const offboardingIntelligence = {
      totalCases: offboardingItems.length,
      completed: offboardingCompleted.length,
      inProgress: offboardingItems.filter(i => i.status === 'in_progress').length,
      pending: offboardingItems.filter(i => i.status === 'pending' || i.status === 'new').length,
      completedThisWeek: offboardingCompleted.filter(i => i.completedAt && new Date(i.completedAt) >= startOfWeek).length,
      completedThisMonth: offboardingCompleted.filter(i => i.completedAt && new Date(i.completedAt) >= startOfMonth).length,
      aged14Days: offboardingOpen.filter(i => i.createdAt && new Date(i.createdAt) <= fourteenDaysAgo).length,
      aged30Days: offboardingOpen.filter(i => i.createdAt && new Date(i.createdAt) <= thirtyDaysAgo).length,
      taskCompletionRates: (() => {
        const assetsOffboarding = assetsItems.filter(i => i.workflowType === 'offboarding');
        const total = assetsOffboarding.length || 1;
        return {
          toolsReturn: Math.round((assetsOffboarding.filter(i => i.taskToolsReturn).length / total) * 100),
          iphoneReturn: Math.round((assetsOffboarding.filter(i => i.taskIphoneReturn).length / total) * 100),
          phoneDisconnect: Math.round((assetsOffboarding.filter(i => i.taskDisconnectedLine).length / total) * 100),
          mPaymentDeactivation: Math.round((assetsOffboarding.filter(i => i.taskDisconnectedMPayment).length / total) * 100),
          segnoOrders: Math.round((assetsOffboarding.filter(i => i.taskCloseSegnoOrders).length / total) * 100),
          shippingLabel: Math.round((assetsOffboarding.filter(i => i.taskCreateShippingLabel).length / total) * 100),
        };
      })(),
      vehicleDisposition: nexusStatusBreakdown,
      keyRecovery: nexusKeysBreakdown,
      phoneRecovery: {
        initiated: nexusVehicles.filter(v => v.phoneRecoveryInitiated === 'yes').length,
        notInitiated: nexusVehicles.filter(v => v.phoneRecoveryInitiated !== 'yes').length,
      },
      repairStatus: nexusRepairBreakdown,
      termedTechStats: {
        total: allTermedTechs.length,
        tasksCreated: allTermedTechs.filter(t => t.offboardingTaskCreated).length,
        unprocessed: allTermedTechs.filter(t => !t.offboardingTaskCreated).length,
        fullyProcessed: allTermedTechs.filter(t => t.processedAt).length,
      },
      roadblocks: (() => {
        const issues: { type: string; severity: string; message: string; count: number }[] = [];
        const aged30 = offboardingOpen.filter(i => i.createdAt && new Date(i.createdAt) <= thirtyDaysAgo);
        if (aged30.length > 0) {
          issues.push({ type: 'aged_30_days', severity: 'critical', message: 'Offboarding cases open 30+ days', count: aged30.length });
        }
        const missingKeys = nexusVehicles.filter(v => v.keys === 'not_present' || v.keys === 'Unknown/Would not Check');
        if (missingKeys.length > 0) {
          issues.push({ type: 'missing_keys', severity: 'high', message: 'Vehicles with missing or unchecked keys', count: missingKeys.length });
        }
        const notFound = nexusVehicles.filter(v => v.postOffboardedStatus === 'not_found');
        if (notFound.length > 0) {
          issues.push({ type: 'vehicles_not_found', severity: 'critical', message: 'Vehicles marked as not found', count: notFound.length });
        }
        const unableToReach = nexusVehicles.filter(v => v.postOffboardedStatus === 'unable_to_reach');
        if (unableToReach.length > 0) {
          issues.push({ type: 'unable_to_reach', severity: 'high', message: 'Techs unable to reach for vehicle recovery', count: unableToReach.length });
        }
        const noTask = allTermedTechs.filter(t => !t.offboardingTaskCreated);
        if (noTask.length > 0) {
          issues.push({ type: 'no_offboarding_task', severity: 'high', message: 'Termed techs without offboarding tasks created', count: noTask.length });
        }
        return issues;
      })(),
    };

    return {
      generatedAt: now.toISOString(),
      queueSummary,
      activityByDay,
      activityByAction,
      recentActivity: recentActivity.map(a => ({
        id: a.id, action: a.action, userId: a.userId,
        details: a.details, timestamp: a.createdAt,
      })),
      userStats: {
        totalActive: activeUsers.length,
        totalInactive: allUsers.length - activeUsers.length,
        byRole: usersByRole,
      },
      topAgents,
      vehicleIntelligence: {
        nexusTracking: {
          totalTracked: nexusVehicles.length,
          byDisposition: nexusStatusBreakdown,
          byKeyStatus: nexusKeysBreakdown,
          byRepairStatus: nexusRepairBreakdown,
          phoneRecoveryInitiated: nexusVehicles.filter(v => v.phoneRecoveryInitiated === 'yes').length,
        },
        holmanFleet: {
          totalVehicles: holmanVehicles.length,
          byStatus: holmanByStatus,
          byMake: holmanByMake,
          byState: holmanByState,
          byFuelType: holmanByFuel,
        },
        fleetMetrics,
        assignments: {
          activeAssignments: vehicleAssignments.filter(a => a.assignmentStatus === 'active').length,
          totalAssignments: vehicleAssignments.length,
        },
        fleetQueue: {
          total: fleetItems.length,
          byWorkflowType: fleetQueueByType,
          byStatus: fleetQueueByStatus,
          byVehicleType: fleetQueueByVehicleType,
        },
        assetsQueue: {
          total: assetsItems.length,
          byWorkflowType: assetsQueueByType,
          byStatus: assetsQueueByStatus,
        },
        onboarding: {
          totalHires: hires.length,
          byEmploymentStatus: onboardingByEmploymentStatus,
          truckAssignment: onboardingTruckAssigned,
        },
        storageLocations: storageUtilization,
      },
      onboardingIntelligence,
      offboardingIntelligence,
    };
  }

  // Reporting API (developer only)
  app.get("/api/reports", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || currentUser.role !== 'developer') {
        return res.status(403).json({ message: "Access denied. Reports require developer role." });
      }

      const reportData = await generateReportData();
      res.json(reportData);
    } catch (error) {
      console.error('Error generating reports:', error);
      res.status(500).json({ message: "Failed to generate reports" });
    }
  });
  // Productivity Dashboard Export API (Superadmin only)
  app.get("/api/productivity-export/:department", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || currentUser.role !== 'developer') {
        return res.status(403).json({ message: "Access denied. Export requires developer role." });
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
      
      // Enforce access control using departments
      if (!hasQueueAccess(currentUser, module as QueueModule)) {
        return res.status(403).json({ message: "Access denied to this queue" });
      }
      
      const updatedItem = await storage.assignUnifiedQueueItem(module as any, id, assigneeId);
      if (!updatedItem) {
        return res.status(404).json({ message: "Queue item not found" });
      }
      
      // Log queue assignment action
      await storage.createActivityLog({
        userId: currentUser.id,
        action: 'queue_item_assigned',
        entityType: 'queue',
        entityId: id,
        details: `${module.toUpperCase()} queue item "${updatedItem.title}" assigned to ${assigneeId} by ${currentUser.username}`,
      });
      
      res.json({ ...updatedItem, module });
    } catch (error) {
      console.error('Error assigning unified queue item:', error);
      res.status(500).json({ message: "Failed to assign queue item" });
    }
  });

  // Release (unassign) queue item - Superadmin only
  app.patch("/api/queues/:module/:id/release", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser) {
        return res.status(401).json({ message: "Invalid user" });
      }
      
      // Only developers can release tasks assigned to others
      if (currentUser.role !== 'developer') {
        return res.status(403).json({ message: "Only developers can release tasks" });
      }
      
      const { module, id } = req.params;
      
      const validModules = ['ntao', 'assets', 'inventory', 'fleet'];
      if (!validModules.includes(module)) {
        return res.status(400).json({ 
          message: `Invalid module: ${module}. Valid modules: ${validModules.join(', ')}` 
        });
      }
      
      // Get current item to log who it was assigned to
      const existingItem = await storage.getUnifiedQueueItem(module as any, id);
      if (!existingItem) {
        return res.status(404).json({ message: "Queue item not found" });
      }
      
      const previousAssignee = existingItem.assignedTo;
      
      // Release the task by clearing assignment and resetting status
      const updatedItem = await storage.updateUnifiedQueueItem(module as any, id, {
        assignedTo: null,
        status: 'pending'
      });
      
      if (!updatedItem) {
        return res.status(404).json({ message: "Failed to release queue item" });
      }
      
      // Log the release action
      await storage.createActivityLog({
        userId: currentUser.id,
        action: 'queue_item_released',
        entityType: 'queue',
        entityId: id,
        details: `${module.toUpperCase()} queue item "${updatedItem.title}" released by ${currentUser.username} (was assigned to ${previousAssignee || 'no one'})`,
      });
      
      res.json({ ...updatedItem, module });
    } catch (error) {
      console.error('Error releasing queue item:', error);
      res.status(500).json({ message: "Failed to release queue item" });
    }
  });

  // Reassign queue item to different user - Superadmin only
  app.patch("/api/queues/:module/:id/reassign", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser) {
        return res.status(401).json({ message: "Invalid user" });
      }
      
      // Only developers can reassign tasks
      if (currentUser.role !== 'developer') {
        return res.status(403).json({ message: "Only developers can reassign tasks" });
      }
      
      const { module, id } = req.params;
      const { assigneeId } = req.body;
      
      if (!assigneeId) {
        return res.status(400).json({ message: "assigneeId is required" });
      }
      
      const validModules = ['ntao', 'assets', 'inventory', 'fleet'];
      if (!validModules.includes(module)) {
        return res.status(400).json({ 
          message: `Invalid module: ${module}. Valid modules: ${validModules.join(', ')}` 
        });
      }
      
      // Get current item to log who it was assigned to
      const existingItem = await storage.getUnifiedQueueItem(module as any, id);
      if (!existingItem) {
        return res.status(404).json({ message: "Queue item not found" });
      }
      
      // Verify the new assignee exists
      const newAssignee = await storage.getUser(assigneeId);
      if (!newAssignee) {
        return res.status(400).json({ message: "Invalid assignee - user not found" });
      }
      
      const previousAssignee = existingItem.assignedTo;
      
      // Reassign the task
      const updatedItem = await storage.updateUnifiedQueueItem(module as any, id, {
        assignedTo: assigneeId
      });
      
      if (!updatedItem) {
        return res.status(404).json({ message: "Failed to reassign queue item" });
      }
      
      // Log the reassignment action
      await storage.createActivityLog({
        userId: currentUser.id,
        action: 'queue_item_reassigned',
        entityType: 'queue',
        entityId: id,
        details: `${module.toUpperCase()} queue item "${updatedItem.title}" reassigned from ${previousAssignee || 'unassigned'} to ${newAssignee.username} by ${currentUser.username}`,
      });
      
      res.json({ ...updatedItem, module });
    } catch (error) {
      console.error('Error reassigning queue item:', error);
      res.status(500).json({ message: "Failed to reassign queue item" });
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
      
      // Enforce access control using departments
      if (!hasQueueAccess(currentUser, module as QueueModule)) {
        return res.status(403).json({ message: "Access denied to this queue" });
      }
      
      const updatedItem = await storage.startWorkUnifiedQueueItem(module as any, id, currentUser.id);
      if (!updatedItem) {
        return res.status(404).json({ message: "Queue item not found or not eligible to start work" });
      }
      
      // Log queue start work action
      await storage.createActivityLog({
        userId: currentUser.id,
        action: 'queue_item_started',
        entityType: 'queue',
        entityId: id,
        details: `${module.toUpperCase()} queue item "${updatedItem.title}" work started by ${currentUser.username}`,
      });
      
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
      
      // Enforce access control using departments
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
      
      // Log queue completion action
      await storage.createActivityLog({
        userId: currentUser.id,
        action: 'queue_item_completed',
        entityType: 'queue',
        entityId: id,
        details: `${module.toUpperCase()} queue item "${updatedItem.title}" completed by ${currentUser.username}${decisionType ? ` (decision: ${decisionType})` : ''}`,
      });
      
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
      
      // Enforce access control using departments
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

      // Log assignment history if this vehicle is assigned to a technician
      if (updatedVehicle.vehicleNumber) {
        try {
          const { vehicleAssignmentService } = await import("./vehicle-assignment-service");
          const changedByUser = (req as any).user?.username || (req as any).user?.name || undefined;
          await vehicleAssignmentService.logVehicleInfoUpdate(
            updatedVehicle.vehicleNumber,
            changedByUser,
            `Vehicle info updated: ${updatedVehicle.modelYear} ${updatedVehicle.makeName} ${updatedVehicle.modelName}`
          );
        } catch (historyErr) {
          console.error("[Routes] Failed to log assignment history for vehicle update:", historyErr);
        }
      }

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
  // DISABLED: OneCard emails temporarily disabled - have not coordinated with OneCard team yet
  app.post("/api/send-deactivation-email", async (req, res) => {
    try {
      const { employeeName, employeeId, racfId, lastDayWorked, reason } = req.body;
      
      // Validate required fields
      if (!employeeName || !employeeId || !racfId || !lastDayWorked || !reason) {
        return res.status(400).json({ message: "Missing required employee information" });
      }

      // DISABLED: Do not send actual emails until coordinated with OneCard team
      console.log('[DISABLED] Would send OneCard deactivation email for:', { employeeName, employeeId, racfId, lastDayWorked, reason });
      
      // Return success without sending email
      res.json({ message: "Credit card deactivation notification logged (email sending disabled)", disabled: true });
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
              "Remove truck from Employee assignment",
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

            // NTAO → Update Employee Profile (priority:3)
            const ntaoTask = await storage.createNTAOQueueItem({
              workflowType: "vehicle_assignment",
              title: "Update Employee Profile",
              description: `Update Employee profile for ${assignmentData.firstName} ${assignmentData.lastName}`,
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
            createdTasks.push({id: ntaoTask.id, department: "NTAO", type: "Update Employee Profile"});
          }
          break;

        case 'onboarding':
          {
            const onboardingData = validatedData as z.infer<typeof anonymousOnboardingSchema>;
            // NTAO → Create Tech Record & Access (priority:1)
            const ntaoTask = await storage.createNTAOQueueItem({
              workflowType: "onboarding",
              title: "Create Tech Record & Access",
              description: `Onboard new Employee: ${onboardingData.firstName} ${onboardingData.lastName}`,
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
              description: `DAY 0 TASK: Stop replenishment for ${offboardingData.techName || 'Employee'}`,
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
              description: `DAY 0 TASK: Perform full inventory count for ${offboardingData.techName || 'Employee'}`,
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
              description: `DAY 0 TASK: Collect all company assets from ${offboardingData.techName || 'Employee'}`,
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
              description: `DAY 0 TASK: Process access removal for ${offboardingData.techName || 'Employee'}`,
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
              description: `Process vehicle return for ${offboardingData.techName || 'Employee'}`,
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
  
  // Helper function to parse array parameters correctly
  const parseArrayParam = (param: any): string[] => {
    if (!param) return [];
    
    if (Array.isArray(param)) {
      return param.filter(item => item && typeof item === 'string');
    }
    
    if (typeof param === 'string') {
      return param.split(',').map(item => item.trim()).filter(item => item.length > 0);
    }
    
    return [];
  };

  // Helper function to build queue item query filters using Drizzle's parameterized queries
  const buildQueueFiltersParameterized = (query: any): SQL | undefined => {
    const conditions: SQL[] = [];

    // Date range filters
    if (query.from_ts || query.from) {
      const fromDate = new Date(query.from_ts || query.from);
      conditions.push(gte(queueItems.createdAt, fromDate));
    }
    if (query.to_ts || query.to) {
      const toDate = new Date(query.to_ts || query.to);
      conditions.push(lte(queueItems.createdAt, toDate));
    }

    // Department filter (robust array support)
    if (query.departments) {
      const departments = parseArrayParam(query.departments);
      if (departments.length > 0) {
        conditions.push(inArray(queueItems.department, departments));
      }
    }

    // Status filter (robust array support)
    if (query.statuses) {
      const statuses = parseArrayParam(query.statuses);
      if (statuses.length > 0) {
        conditions.push(inArray(queueItems.status, statuses));
      }
    }

    // Assignee filter (robust array support)
    if (query.assignees) {
      const assignees = parseArrayParam(query.assignees);
      if (assignees.length > 0) {
        conditions.push(inArray(queueItems.assignedTo, assignees));
      }
    }

    return conditions.length > 0 ? and(...conditions) : undefined;
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

      // Server-side authorization: require developer or admin role for exports
      if (!currentUser || !['developer', 'admin'].includes(currentUser.role)) {
        return res.status(403).json({ 
          message: "Access denied. Export functionality requires developer or admin role." 
        });
      }

      const whereCondition = buildQueueFiltersParameterized(req.query);

      const results = await db
        .select({
          id: queueItems.id,
          title: queueItems.title,
          description: queueItems.description,
          status: queueItems.status,
          priority: queueItems.priority,
          assignee: queueItems.assignedTo,
          requester_id: queueItems.requesterId,
          department: queueItems.department,
          team: queueItems.team,
          type: queueItems.workflowType,
          notes: queueItems.notes,
          scheduled_for: queueItems.scheduledFor,
          attempts: queueItems.attempts,
          last_error: queueItems.lastError,
          completed_at: queueItems.completedAt,
          started_at: queueItems.startedAt,
          first_response_at: queueItems.firstResponseAt,
          workflow_id: queueItems.workflowId,
          workflow_step: queueItems.workflowStep,
          created_at: queueItems.createdAt,
          updated_at: queueItems.updatedAt,
        })
        .from(queueItems)
        .where(whereCondition)
        .orderBy(desc(queueItems.createdAt));

      // Sanitize all rows to prevent formula injection
      const sanitizedRows = results.map(row => sanitizeRowForExport(row));

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

      // Server-side authorization: require developer or admin role for exports
      if (!currentUser || !['developer', 'admin'].includes(currentUser.role)) {
        return res.status(403).json({ 
          message: "Access denied. Export functionality requires developer or admin role." 
        });
      }

      const whereCondition = buildQueueFiltersParameterized(req.query);

      const results = await db
        .select({
          id: queueItems.id,
          title: queueItems.title,
          description: queueItems.description,
          status: queueItems.status,
          priority: queueItems.priority,
          assignee: queueItems.assignedTo,
          requester_id: queueItems.requesterId,
          department: queueItems.department,
          team: queueItems.team,
          type: queueItems.workflowType,
          notes: queueItems.notes,
          scheduled_for: queueItems.scheduledFor,
          attempts: queueItems.attempts,
          last_error: queueItems.lastError,
          completed_at: queueItems.completedAt,
          started_at: queueItems.startedAt,
          first_response_at: queueItems.firstResponseAt,
          workflow_id: queueItems.workflowId,
          workflow_step: queueItems.workflowStep,
          created_at: queueItems.createdAt,
          updated_at: queueItems.updatedAt,
        })
        .from(queueItems)
        .where(whereCondition)
        .orderBy(desc(queueItems.createdAt));

      // Compute derived fields and sanitize rows to prevent formula injection
      const sanitizedRows = results.map(row => {
        const createdAt = row.created_at ? new Date(row.created_at).getTime() : null;
        const completedAt = row.completed_at ? new Date(row.completed_at).getTime() : null;
        const firstResponseAt = row.first_response_at ? new Date(row.first_response_at).getTime() : null;

        return sanitizeRowForExport({
          ...row,
          response_time_hours: (completedAt && createdAt) 
            ? (completedAt - createdAt) / (1000 * 60 * 60) 
            : null,
          first_response_time_hours: (firstResponseAt && createdAt) 
            ? (firstResponseAt - createdAt) / (1000 * 60 * 60) 
            : null,
        });
      });

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
      // Check if user is developer
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || currentUser.role !== 'developer') {
        return res.status(403).json({ message: "Access denied. Template management requires developer role." });
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
      // Check if user is developer
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || currentUser.role !== 'developer') {
        return res.status(403).json({ message: "Access denied. Template management requires developer role." });
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
      // Check if user is developer
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || currentUser.role !== 'developer') {
        return res.status(403).json({ message: "Access denied. Template management requires developer role." });
      }

      const { id } = req.params;
      
      // Create strict partial schema that only allows whitelisted updateable fields
      // id and createdAt are already omitted in insertTemplateSchema, just make it partial
      const updateTemplateSchema = insertTemplateSchema
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
      // Check if user is developer
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || currentUser.role !== 'developer') {
        return res.status(403).json({ message: "Access denied. Template management requires developer role." });
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
      // Check if user is developer
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || currentUser.role !== 'developer') {
        return res.status(403).json({ message: "Access denied. Template management requires developer role." });
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

  // ===============================
  // District Cost Centers API (Task 207)
  console.log("Registering District Cost Centers API routes...");

  // Mirrors the frontend gate at sidebar.management.costCenterManagement:
  // defaults -> stored role row -> per-user overrides.
  async function userCanManageCostCenters(user: User | undefined): Promise<boolean> {
    if (!user || !user.role) return false;

    const defaults = getServerDefaultPermissions(user.role);
    const stored = await storage.getRolePermission(user.role);
    const merged = deepMergePermissions(
      defaults,
      stored?.permissions ?? null,
    ) as RolePermissionSettings;

    const overrides = user.permissionOverrides as
      | Partial<RolePermissionSettings>
      | null
      | undefined;
    const effective = (
      overrides
        ? deepMergePermissions(merged, overrides)
        : merged
    ) as RolePermissionSettings;

    return !!effective?.sidebar?.management?.costCenterManagement;
  }

  function padDistrictForApi(input: string | undefined | null): string {
    const digits = String(input ?? "").trim().replace(/\D/g, "");
    if (!digits) return "";
    return digits.padStart(7, "0").slice(-7);
  }

  const costCenterCreateSchema = insertDistrictCostCenterSchema
    .omit({ updatedBy: true })
    .extend({
      district: z
        .string()
        .trim()
        .regex(/^\d{4,7}$/, "District must be 4 to 7 digits"),
      costCenter: z
        .string()
        .trim()
        .regex(
          /^[A-Za-z0-9]{5}$/,
          "Cost Center must be exactly 5 alphanumeric characters",
        ),
    });

  const costCenterUpdateSchema = costCenterCreateSchema.pick({
    costCenter: true,
  });

  // GET /api/cost-centers - list all
  app.get("/api/cost-centers", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!(await userCanManageCostCenters(currentUser))) {
        return res.status(403).json({ message: "Access denied. You do not have permission to manage District Cost Centers." });
      }
      const items = await storage.listDistrictCostCenters();
      res.json(items);
    } catch (error) {
      console.error("Error fetching cost centers:", error);
      res.status(500).json({ message: "Failed to fetch cost centers" });
    }
  });

  // POST /api/cost-centers - create or upsert
  app.post("/api/cost-centers", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!(await userCanManageCostCenters(currentUser))) {
        return res.status(403).json({ message: "Access denied. You do not have permission to manage District Cost Centers." });
      }

      const parsed = costCenterCreateSchema.parse(req.body);

      const padded = padDistrictForApi(parsed.district);
      const existing = await storage.getDistrictCostCenter(padded);
      if (existing) {
        return res.status(409).json({ message: `District ${padded} already exists. Use PATCH to update.` });
      }

      const record = await storage.upsertDistrictCostCenter({
        district: padded,
        costCenter: parsed.costCenter,
        updatedBy: currentUser!.username,
      });

      await storage.createActivityLog({
        userId: currentUser!.id,
        action: "cost_center_created",
        entityType: "district_cost_center",
        entityId: padded,
        details: `District ${padded} cost center set to ${parsed.costCenter}`,
      });

      res.status(201).json(record);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid cost center data", errors: error.errors });
      }
      console.error("Error creating cost center:", error);
      res.status(500).json({ message: "Failed to create cost center" });
    }
  });

  // PATCH /api/cost-centers/:district - update existing
  app.patch("/api/cost-centers/:district", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!(await userCanManageCostCenters(currentUser))) {
        return res.status(403).json({ message: "Access denied. You do not have permission to manage District Cost Centers." });
      }

      const rawDistrict = String(req.params.district ?? "").trim();
      if (!/^\d{4,7}$/.test(rawDistrict)) {
        return res.status(400).json({ message: "Invalid district. Must be 4 to 7 digits." });
      }
      const padded = padDistrictForApi(rawDistrict);

      const { costCenter } = costCenterUpdateSchema.parse(req.body);

      const existing = await storage.getDistrictCostCenter(padded);
      if (!existing) {
        return res.status(404).json({ message: "District not found" });
      }

      const record = await storage.upsertDistrictCostCenter({
        district: padded,
        costCenter,
        updatedBy: currentUser!.username,
      });

      await storage.createActivityLog({
        userId: currentUser!.id,
        action: "cost_center_updated",
        entityType: "district_cost_center",
        entityId: padded,
        details: `District ${padded} cost center changed from ${existing.costCenter} to ${costCenter}`,
      });

      res.json(record);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid cost center data", errors: error.errors });
      }
      console.error("Error updating cost center:", error);
      res.status(500).json({ message: "Failed to update cost center" });
    }
  });

  // DELETE /api/cost-centers/:district
  app.delete("/api/cost-centers/:district", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!(await userCanManageCostCenters(currentUser))) {
        return res.status(403).json({ message: "Access denied. You do not have permission to manage District Cost Centers." });
      }

      const rawDistrict = String(req.params.district ?? "").trim();
      if (!/^\d{4,7}$/.test(rawDistrict)) {
        return res.status(400).json({ message: "Invalid district. Must be 4 to 7 digits." });
      }
      const padded = padDistrictForApi(rawDistrict);

      const existing = await storage.getDistrictCostCenter(padded);
      if (!existing) {
        return res.status(404).json({ message: "District not found" });
      }

      const ok = await storage.deleteDistrictCostCenter(padded);
      if (!ok) {
        return res.status(404).json({ message: "District not found" });
      }

      await storage.createActivityLog({
        userId: currentUser!.id,
        action: "cost_center_deleted",
        entityType: "district_cost_center",
        entityId: padded,
        details: `District ${padded} cost center removed (was ${existing.costCenter})`,
      });

      res.json({ message: "Cost center removed" });
    } catch (error) {
      console.error("Error deleting cost center:", error);
      res.status(500).json({ message: "Failed to delete cost center" });
    }
  });

  // POST /api/cost-centers/bulk - bulk import many districts at once
  const costCenterBulkSchema = z.object({
    records: z
      .array(
        z.object({
          district: z.string(),
          costCenter: z.string(),
        }),
      )
      .min(1, "Provide at least one row")
      .max(10000, "Too many rows in a single import"),
  });

  app.post("/api/cost-centers/bulk", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!(await userCanManageCostCenters(currentUser))) {
        return res.status(403).json({ message: "Access denied. You do not have permission to manage District Cost Centers." });
      }

      const { records } = costCenterBulkSchema.parse(req.body);

      // Per-row validate using existing schema; skip rows that fail
      const valid: { district: string; costCenter: string }[] = [];
      const errors: { row: number; district: string; costCenter: string; message: string }[] = [];
      records.forEach((r, idx) => {
        const result = costCenterCreateSchema.safeParse(r);
        if (!result.success) {
          errors.push({
            row: idx + 1,
            district: r.district ?? "",
            costCenter: r.costCenter ?? "",
            message: result.error.errors.map((e) => e.message).join("; "),
          });
        } else {
          valid.push({
            district: padDistrictForApi(result.data.district),
            costCenter: result.data.costCenter,
          });
        }
      });

      const summary = await storage.bulkUpsertDistrictCostCenters(
        valid.map((r) => ({
          district: r.district,
          costCenter: r.costCenter,
          updatedBy: currentUser!.username,
        })),
        currentUser!.username,
      );

      await storage.createActivityLog({
        userId: currentUser!.id,
        action: "cost_center_bulk_import",
        entityType: "district_cost_center",
        entityId: "*",
        details:
          `Bulk import: ${summary.inserted} inserted, ${summary.updated} updated, ` +
          `${summary.unchanged} unchanged, ${errors.length} skipped (${records.length} submitted)`,
      });

      res.json({
        inserted: summary.inserted,
        updated: summary.updated,
        unchanged: summary.unchanged,
        skipped: errors.length,
        submitted: records.length,
        errors,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid bulk import payload", errors: error.errors });
      }
      console.error("Error bulk importing cost centers:", error);
      res.status(500).json({ message: "Failed to bulk import cost centers" });
    }
  });

  // POST /api/cost-centers/init-defaults - seed defaults from live district sources
  app.post("/api/cost-centers/init-defaults", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!(await userCanManageCostCenters(currentUser))) {
        return res.status(403).json({ message: "Access denied. You do not have permission to manage District Cost Centers." });
      }

      const result = await storage.seedDefaultDistrictCostCenters(currentUser!.username);

      await storage.createActivityLog({
        userId: currentUser!.id,
        action: "cost_center_seed_defaults",
        entityType: "district_cost_center",
        entityId: "*",
        details: `Initialized defaults: ${result.inserted} inserted, ${result.existing} existing`,
      });

      res.json(result);
    } catch (error) {
      console.error("Error seeding default cost centers:", error);
      res.status(500).json({ message: "Failed to initialize default cost centers" });
    }
  });

  // GET /api/cost-centers/activity - recent activity log entries for district cost centers
  app.get("/api/cost-centers/activity", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!(await userCanManageCostCenters(currentUser))) {
        return res.status(403).json({ message: "Access denied. You do not have permission to manage District Cost Centers." });
      }

      const rawDistrict = typeof req.query.district === "string" ? req.query.district.trim() : "";
      const district = rawDistrict ? padDistrictForApi(rawDistrict) : undefined;

      const PAGE_SIZE = 50;
      const rawLimit = parseInt(String(req.query.limit ?? PAGE_SIZE), 10);
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : PAGE_SIZE;
      const rawOffset = parseInt(String(req.query.offset ?? 0), 10);
      const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;

      // Fetch one extra entry to determine if more pages exist
      const logs = await storage.getActivityLogsByEntityType("district_cost_center", district, limit + 1, offset);
      const hasMore = logs.length > limit;
      const pageLogs = hasMore ? logs.slice(0, limit) : logs;

      // Resolve userId → username for display; cache per unique userId in this request
      const userCache = new Map<string, string>();
      const resolveActor = async (userId: string): Promise<string> => {
        if (userId === "system") return "system";
        if (userCache.has(userId)) return userCache.get(userId)!;
        const user = await storage.getUser(userId);
        const name = user?.username ?? userId;
        userCache.set(userId, name);
        return name;
      };

      const entries = await Promise.all(
        pageLogs.map(async (log) => ({
          id: log.id,
          action: log.action,
          entityId: log.entityId,
          details: log.details,
          createdAt: log.createdAt,
          actor: await resolveActor(log.userId),
        }))
      );

      res.json({ entries, hasMore });
    } catch (error) {
      console.error("Error fetching cost center activity:", error);
      res.status(500).json({ message: "Failed to fetch cost center activity" });
    }
  });

  // GET /api/cost-centers/auto-seed-status - last successful auto-seed timestamp
  // and the most recent unacknowledged batch of newly-inserted districts (used
  // to drive the in-app admin notification banner on the management page).
  app.get("/api/cost-centers/auto-seed-status", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!(await userCanManageCostCenters(currentUser))) {
        return res.status(403).json({ message: "Access denied. You do not have permission to manage District Cost Centers." });
      }

      const { getSchedulerStatus, getPendingDistrictCostCenterNotification } = await import("./sync-scheduler");
      const status = getSchedulerStatus();
      const pending = getPendingDistrictCostCenterNotification();
      // Compute the next scheduled auto-seed time. The scheduler ticks roughly
      // every 60s and runs the seed once the throttle (intervalMs since the last
      // successful run) has elapsed. If we've never run, the next tick will
      // pick it up — surface that as `null` so the UI can render "within the
      // next minute".
      const nextAutoSeed = status.lastDistrictCostCenterSeed
        ? new Date(
            new Date(status.lastDistrictCostCenterSeed).getTime() +
              status.districtCostCenterSeedIntervalMs,
          ).toISOString()
        : null;
      res.json({
        lastAutoSeed: status.lastDistrictCostCenterSeed,
        intervalMs: status.districtCostCenterSeedIntervalMs,
        nextAutoSeed,
        newDistricts: pending,
      });
    } catch (error) {
      console.error("Error fetching auto-seed status:", error);
      res.status(500).json({ message: "Failed to fetch auto-seed status" });
    }
  });

  // POST /api/cost-centers/dismiss-new-districts - clear the in-app banner
  // after an admin has reviewed the most recent auto-seed batch.
  app.post("/api/cost-centers/dismiss-new-districts", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!(await userCanManageCostCenters(currentUser))) {
        return res.status(403).json({ message: "Access denied. You do not have permission to manage District Cost Centers." });
      }

      const { clearPendingDistrictCostCenterNotification } = await import("./sync-scheduler");
      clearPendingDistrictCostCenterNotification();
      res.json({ success: true });
    } catch (error) {
      console.error("Error dismissing new-districts notification:", error);
      res.status(500).json({ message: "Failed to dismiss notification" });
    }
  });

  // POST /api/cost-centers/trigger-auto-seed - manually run the same seeder
  // the scheduler runs daily; bypasses the 24h throttle but updates the
  // scheduler's last-run timestamp so the UI and next scheduled run reflect it.
  app.post("/api/cost-centers/trigger-auto-seed", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!(await userCanManageCostCenters(currentUser))) {
        return res.status(403).json({ message: "Access denied. You do not have permission to manage District Cost Centers." });
      }

      const { triggerDistrictCostCenterSeed, getSchedulerStatus } = await import("./sync-scheduler");
      const result = await triggerDistrictCostCenterSeed(currentUser!.username);

      await storage.createActivityLog({
        userId: currentUser!.id,
        action: "cost_center_auto_seed_manual",
        entityType: "district_cost_center",
        entityId: "*",
        details: `Manual auto-seed: ${result.inserted} inserted, ${result.existing} already present`,
      });

      const status = getSchedulerStatus();
      res.json({
        inserted: result.inserted,
        existing: result.existing,
        insertedDistricts: result.insertedDistricts,
        lastAutoSeed: status.lastDistrictCostCenterSeed,
      });
    } catch (error) {
      console.error("Error triggering district cost-center auto-seed:", error);
      res.status(500).json({ message: "Failed to trigger auto-seed" });
    }
  });

  // POST /api/cost-centers/email-history-csv - send the history CSV as an email attachment
  app.post("/api/cost-centers/email-history-csv", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || (currentUser.role !== "developer" && currentUser.role !== "admin")) {
        return res.status(403).json({ message: "Access denied. Admin or Developer role required." });
      }

      const schema = z.object({
        recipients: z.array(z.string().email({ message: "Each recipient must be a valid email address." })).min(1, "At least one recipient is required."),
        csvContent: z.string().min(1, "CSV content is required."),
        districtFilter: z.string().nullable().optional(),
      });

      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.issues.map((i) => i.message).join("; ") });
      }

      const { recipients, csvContent, districtFilter } = parsed.data;
      const filename = districtFilter
        ? `cost-center-history-district-${districtFilter}.csv`
        : "cost-center-history.csv";

      const districtLabel = districtFilter ? ` for district ${districtFilter}` : "";
      const subject = districtFilter
        ? `Cost Center Change History — District ${districtFilter}`
        : "Cost Center Change History";

      const htmlBody = `
<html><body style="font-family:Arial,sans-serif;color:#333;">
  <p>Please find the cost center change history${districtLabel} attached as a CSV file.</p>
  <p style="font-size:12px;color:#888;margin-top:24px;">
    Sent by ${currentUser.fullName || currentUser.username} via the Cost Center Management panel.
  </p>
</body></html>`;

      const csvBase64 = Buffer.from(csvContent, "utf-8").toString("base64");

      const errors: string[] = [];
      for (const recipient of recipients) {
        const result = await sendEmail({
          to: recipient,
          from: process.env.SENDGRID_EMAIL || "",
          subject,
          html: htmlBody,
          attachments: [
            {
              content: csvBase64,
              filename,
              type: "text/csv",
              disposition: "attachment",
            },
          ],
        });
        if (!result.success) {
          errors.push(`${recipient}: ${result.error}`);
        }
      }

      if (errors.length === recipients.length) {
        return res.status(500).json({ message: `Failed to send to all recipients: ${errors.join("; ")}` });
      }
      if (errors.length > 0) {
        return res.status(207).json({ message: `Sent to some recipients. Failures: ${errors.join("; ")}` });
      }

      res.json({ message: `CSV sent to ${recipients.join(", ")}` });
    } catch (error) {
      console.error("Error sending history CSV email:", error);
      res.status(500).json({ message: "Failed to send email" });
    }
  });

  // Role Permissions API Routes
  console.log("Registering Role Permissions API routes...");

  // Get all role permissions
  app.get("/api/role-permissions", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || (currentUser.role !== 'developer' && currentUser.role !== 'admin')) {
        return res.status(403).json({ message: "Access denied. Role permissions require Developer or Admin role." });
      }

      const permissions = await storage.getAllRolePermissions();
      res.json(permissions.map(mergeRolePermissionWithDefaults));
    } catch (error) {
      console.error("Error fetching role permissions:", error);
      res.status(500).json({ message: "Failed to fetch role permissions" });
    }
  });

  // Get role permission by role
  app.get("/api/role-permissions/:role", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || (currentUser.role !== 'developer' && currentUser.role !== 'admin')) {
        return res.status(403).json({ message: "Access denied. Role permissions require Developer or Admin role." });
      }

      const { role } = req.params;
      const permission = await storage.getRolePermission(role);
      
      if (!permission) {
        return res.status(404).json({ message: `Role permission for '${role}' not found` });
      }
      
      res.json(mergeRolePermissionWithDefaults(permission));
    } catch (error) {
      console.error("Error fetching role permission:", error);
      res.status(500).json({ message: "Failed to fetch role permission" });
    }
  });

  // Update role permission
  app.patch("/api/role-permissions/:role", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || (currentUser.role !== 'developer' && currentUser.role !== 'admin')) {
        return res.status(403).json({ message: "Access denied. Role permissions require Developer or Admin role." });
      }

      const { role: targetRole } = req.params;
      const permissions = req.body;

      // Permission hierarchy validation:
      // - Developer (developer) can edit ALL roles including their own
      // - Admin can edit Agent and custom roles only (not Developer or Admin)
      const canEditRole = (): boolean => {
        if (currentUser.role === 'developer') {
          // Developer can edit all roles
          return true;
        }
        if (currentUser.role === 'admin') {
          // Admin can edit all roles except Admin and Developer
          return targetRole !== 'admin' && targetRole !== 'developer';
        }
        return false;
      };

      if (!canEditRole()) {
        if (currentUser.role === 'admin') {
          return res.status(403).json({ message: "Admin cannot edit Developer or Admin role permissions." });
        }
        return res.status(403).json({ message: "You do not have permission to edit this role." });
      }

      const updated = await storage.upsertRolePermission(targetRole, permissions);
      
      // Log activity
      await storage.createActivityLog({
        userId: currentUser.id,
        action: "role_permission_updated",
        entityType: "role_permission",
        entityId: targetRole,
        details: `Role permissions for '${targetRole}' updated by ${currentUser.role}`,
      });

      res.json(updated);
    } catch (error) {
      console.error("Error updating role permission:", error);
      res.status(500).json({ message: "Failed to update role permission" });
    }
  });

  // Create a new custom role (Developer and Admin can create custom roles)
  app.post("/api/role-permissions", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      // Developer and Admin can create custom roles
      if (!currentUser || (currentUser.role !== 'developer' && currentUser.role !== 'admin')) {
        return res.status(403).json({ message: "Access denied. Only Developer and Admin users can create custom roles." });
      }

      const { role, permissions } = req.body;

      if (!role || typeof role !== 'string') {
        return res.status(400).json({ message: "Role name is required" });
      }

      // Validate role name (lowercase, no spaces, alphanumeric with underscores)
      const roleNameRegex = /^[a-z][a-z0-9_]*$/;
      if (!roleNameRegex.test(role)) {
        return res.status(400).json({ message: "Role name must start with a letter and contain only lowercase letters, numbers, and underscores" });
      }

      // Check if role already exists
      const existing = await storage.getRolePermission(role);
      if (existing) {
        return res.status(409).json({ message: "A role with this name already exists" });
      }

      // Import default agent permissions as base for new roles
      const { DEFAULT_AGENT_PERMISSIONS } = await import('../client/src/lib/role-permissions');
      const rolePermissions = permissions || DEFAULT_AGENT_PERMISSIONS;

      const created = await storage.upsertRolePermission(role, rolePermissions);

      // Log activity
      await storage.createActivityLog({
        userId: currentUser.id,
        action: "role_created",
        entityType: "role_permission",
        entityId: role,
        details: `New role '${role}' created by Admin`,
      });

      res.status(201).json(created);
    } catch (error) {
      console.error("Error creating role:", error);
      res.status(500).json({ message: "Failed to create role" });
    }
  });

  // Delete a custom role (Developer and Admin can delete custom roles)
  app.delete("/api/role-permissions/:role", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      // Developer and Admin can delete custom roles
      if (!currentUser || (currentUser.role !== 'developer' && currentUser.role !== 'admin')) {
        return res.status(403).json({ message: "Access denied. Only Developer and Admin users can delete custom roles." });
      }

      const { role } = req.params;

      // Prevent deletion of core roles (developer, admin, agent)
      if (role === 'developer' || role === 'agent' || role === 'admin') {
        return res.status(400).json({ message: "Cannot delete core system roles (Developer, Admin, Agent)" });
      }

      // Check if any users are assigned to this role
      const usersWithRole = await storage.getUsersByRole(role);
      if (usersWithRole && usersWithRole.length > 0) {
        return res.status(400).json({ 
          message: `Cannot delete role. ${usersWithRole.length} user(s) are currently assigned to this role.` 
        });
      }

      const deleted = await storage.deleteRolePermission(role);
      if (!deleted) {
        return res.status(404).json({ message: "Role not found" });
      }

      // Log activity
      await storage.createActivityLog({
        userId: currentUser.id,
        action: "role_deleted",
        entityType: "role_permission",
        entityId: role,
        details: `Role '${role}' deleted by Admin`,
      });

      res.json({ message: "Role deleted successfully" });
    } catch (error) {
      console.error("Error deleting role:", error);
      res.status(500).json({ message: "Failed to delete role" });
    }
  });

  // Seed default role permissions (for initial setup)
  app.post("/api/role-permissions/seed", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || currentUser.role !== 'developer') {
        return res.status(403).json({ message: "Access denied. Role permissions require developer role." });
      }

      // Import default permissions from client lib
      const { DEFAULT_SUPERADMIN_PERMISSIONS, DEFAULT_ADMIN_PERMISSIONS, DEFAULT_AGENT_PERMISSIONS } = await import('../client/src/lib/role-permissions');

      const developerPermission = await storage.upsertRolePermission('developer', DEFAULT_SUPERADMIN_PERMISSIONS);
      const adminPermission = await storage.upsertRolePermission('admin', DEFAULT_ADMIN_PERMISSIONS);
      const agentPermission = await storage.upsertRolePermission('agent', DEFAULT_AGENT_PERMISSIONS);

      // Log activity
      await storage.createActivityLog({
        userId: currentUser.id,
        action: "role_permissions_seeded",
        entityType: "role_permission",
        entityId: "all",
        details: "Default role permissions seeded for developer, admin, and agent roles",
      });

      res.json({
        message: "Default role permissions seeded successfully",
        permissions: [developerPermission, adminPermission, agentPermission]
      });
    } catch (error) {
      console.error("Error seeding role permissions:", error);
      res.status(500).json({ message: "Failed to seed role permissions" });
    }
  });

  // Bulk-patch a permission key across all custom roles in one shot
  app.post("/api/role-permissions/bulk-patch", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || (currentUser.role !== 'developer' && currentUser.role !== 'admin')) {
        return res.status(403).json({ message: "Access denied. Role permissions require Developer or Admin role." });
      }

      const { permissionPath, value } = req.body;

      if (!Array.isArray(permissionPath) || permissionPath.length === 0 || !permissionPath.every((s: any) => typeof s === 'string')) {
        return res.status(400).json({ message: "permissionPath must be a non-empty array of strings" });
      }
      if (typeof value !== 'boolean') {
        return res.status(400).json({ message: "value must be a boolean" });
      }

      const CORE_ROLES = ['developer', 'admin', 'agent'];
      const allPermissions = await storage.getAllRolePermissions();
      const customRoles = allPermissions.filter(p => !CORE_ROLES.includes(p.role));

      const updatedRoles: string[] = [];
      for (const roleRecord of customRoles) {
        const merged = mergeRolePermissionWithDefaults(roleRecord);
        const updated = setNestedPermissionValue(merged.permissions, permissionPath, value);
        await storage.upsertRolePermission(roleRecord.role, updated);
        updatedRoles.push(roleRecord.role);
      }

      await storage.createActivityLog({
        userId: currentUser.id,
        action: "role_permissions_bulk_patched",
        entityType: "role_permission",
        entityId: "bulk",
        details: `Bulk-set ${permissionPath.join('.')}=${value} on ${updatedRoles.length} custom role(s) by ${currentUser.role}`,
      });

      res.json({ updatedCount: updatedRoles.length, roles: updatedRoles });
    } catch (error) {
      console.error("Error bulk patching role permissions:", error);
      res.status(500).json({ message: "Failed to bulk patch role permissions" });
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

  // Vehicle lookup by number (for offboarding form)
  app.get("/api/holman/vehicle/:vehicleNumber", requireAuth, async (req: any, res) => {
    try {
      const { vehicleNumber } = req.params;
      console.log('[Holman] Vehicle lookup request for:', vehicleNumber);
      const result = await holmanApiService.findVehicleByNumber(vehicleNumber);
      res.json(result);
    } catch (error: any) {
      console.error("Error looking up Holman vehicle:", error);
      res.status(500).json({ 
        success: false, 
        error: error.message || "Failed to look up vehicle from Holman API" 
      });
    }
  });

  // Duplicate-check: does a vehicle number already exist in the Holman cache?
  // Uses canonical (strip-leading-zeros) comparison so 88095 and 088095 are treated as the same.
  app.get("/api/holman/vehicles/exists/:vehicleNumber", requireAuth, async (req: any, res) => {
    try {
      const raw = req.params.vehicleNumber;
      const canonical = toCanonical(raw);
      if (!canonical) return res.status(400).json({ exists: false, error: "Invalid vehicle number" });

      // The cache stores vehicles in 6-digit padded format (toHolmanRef).
      // Query for the padded form directly (fast indexed lookup), then also check canonical fallback.
      const paddedLookup = toHolmanRef(raw);

      const rows = await db
        .select({ holmanVehicleNumber: holmanVehiclesCache.holmanVehicleNumber })
        .from(holmanVehiclesCache)
        .where(eq(holmanVehiclesCache.holmanVehicleNumber, paddedLookup))
        .limit(1);

      // If direct lookup found it, it exists. If not, do a canonical scan as safety net.
      let exists = rows.length > 0;

      if (!exists) {
        // Full scan — no row limit — to catch any non-padded legacy entries
        const allRows = await db
          .select({ holmanVehicleNumber: holmanVehiclesCache.holmanVehicleNumber })
          .from(holmanVehiclesCache);
        exists = allRows.some((row) => toCanonical(row.holmanVehicleNumber) === canonical);
      }

      return res.json({ exists, canonical });
    } catch (error: any) {
      console.error("[BYOV] Vehicle exists check error:", error);
      return res.status(500).json({ exists: false, error: error.message || "Failed to check vehicle" });
    }
  });

  // BYOV vehicle creation — submits to Holman and/or WMS based on caller intent.
  // Optional flags `createInHolman` (default true) and `createInWms` (default true)
  // let callers target only the system(s) that are missing for a given vehicle.
  // When createInHolman is false the Holman duplicate-gate is skipped entirely so
  // WMS-only rows are not incorrectly blocked by the 409 guard.
  app.post("/api/byov/create", requireAuth, async (req: any, res) => {
    try {
      const {
        vehicleNumber, vin, assetType, modelYear, make, model,
        firstName, lastName, enterpriseId, phone,
        deliveryAddress, city, state, zip, district,
        deliveryDate, onRoadDate,
        licensePlate, plateState, plateType, regRenewalDate,
        createInHolman: createInHolmanRaw,
        createInWms: createInWmsRaw,
      } = req.body;

      // Default both flags to true when omitted so existing callers are unaffected.
      const createInHolman = createInHolmanRaw !== false && createInHolmanRaw !== "false";
      const createInWms    = createInWmsRaw    !== false && createInWmsRaw    !== "false";

      if (!createInHolman && !createInWms) {
        return res.status(400).json({ error: "At least one of createInHolman or createInWms must be true." });
      }

      if (!vehicleNumber) return res.status(400).json({ error: "vehicleNumber is required" });

      // Zero-pad vehicle number to 6 digits
      const paddedVehicle = toHolmanRef(vehicleNumber);

      // Required-field validation
      const requiredFields: Record<string, string> = {
        vehicleNumber: "Vehicle number",
        vin: "VIN",
        make: "Make",
        model: "Model",
        modelYear: "Model year",
        firstName: "First name",
        lastName: "Last name",
        enterpriseId: "Enterprise ID",
        deliveryAddress: "Delivery address",
        city: "City",
        state: "State",
        zip: "ZIP code",
        district: "District",
        licensePlate: "License plate",
        plateState: "Plate state",
        assetType: "Asset type",
        plateType: "Plate type",
        regRenewalDate: "Registration renewal date",
      };
      const missingFields = Object.entries(requiredFields)
        .filter(([key]) => !req.body[key] || String(req.body[key]).trim() === "")
        .map(([, label]) => label);
      if (missingFields.length > 0) {
        return res.status(400).json({
          error: `Missing required fields: ${missingFields.join(", ")}`,
        });
      }

      // Holman duplicate guard — only enforced when we are actually creating in Holman.
      // Skipping this check for WMS-only rows avoids a spurious 409 for vehicles that
      // already exist in Holman (by design) but are missing in WMS.
      if (createInHolman) {
        const canonical = toCanonical(vehicleNumber);
        const directRows = await db
          .select({ holmanVehicleNumber: holmanVehiclesCache.holmanVehicleNumber })
          .from(holmanVehiclesCache)
          .where(eq(holmanVehiclesCache.holmanVehicleNumber, paddedVehicle))
          .limit(1);
        let duplicate = directRows.length > 0;
        // 'cache' = blocked by local Holman cache, 'live' = blocked by live Holman API call
        let duplicateSource: "cache" | "live" | null = duplicate ? "cache" : null;
        if (!duplicate) {
          // Full scan — no row limit — to catch any non-padded legacy entries
          const allRows = await db
            .select({ holmanVehicleNumber: holmanVehiclesCache.holmanVehicleNumber })
            .from(holmanVehiclesCache);
          duplicate = allRows.some((r) => toCanonical(r.holmanVehicleNumber) === canonical);
          if (duplicate) duplicateSource = "cache";
        }
        if (!duplicate) {
          // Cache miss — fall back to a live Holman lookup so a stale cache
          // cannot let a real duplicate slip through.
          try {
            const liveResult = await holmanApiService.findVehicleByNumber(vehicleNumber);
            if (liveResult.success && liveResult.vehicle) {
              duplicate = true;
              duplicateSource = "live";
              console.log(`[BYOV] Live Holman lookup found existing vehicle ${paddedVehicle}; blocking duplicate submission.`);
            }
          } catch (liveErr) {
            console.error("[BYOV] Live Holman duplicate check failed (non-fatal):", liveErr);
          }
        }
        if (duplicate) {
          // Write an audit log entry so dispatchers can trace why the submission was blocked.
          const u = req.user as any;
          const submittedBy: string = u?.username || u?.email || u?.id ? String(u.username || u.email || u.id) : "unknown";
          const blockReason = duplicateSource === "live"
            ? "Blocked by duplicate guard (live Holman lookup)"
            : "Blocked by duplicate guard (cache hit)";
          try {
            await db.insert(byovCreationAudit).values({
              vehicleNumber: paddedVehicle,
              vin: vin ?? null,
              make: make ?? null,
              model: model ?? null,
              modelYear: modelYear ? String(modelYear) : null,
              assetType: assetType ?? null,
              district: district ? String(district) : null,
              submittedBy,
              holmanSuccess: false,
              holmanError: blockReason,
              wmsSuccess: false,
              wmsError: "Blocked: duplicate vehicle, submission not attempted",
              blockedSource: duplicateSource ?? "cache",
            });
            console.log(`[BYOV] Duplicate block written to audit log for ${paddedVehicle} (source: ${duplicateSource})`);
          } catch (auditErr) {
            console.error("[BYOV] Failed to write duplicate-block audit entry:", auditErr);
          }
          return res.status(409).json({
            error: `Vehicle ${paddedVehicle} already exists in Holman. Use a different vehicle number.`,
          });
        }
      }

      // --- Derived / fixed values ---
      const NULL_VAL = "^null^";
      const isUnknown = (lastName || "").trim().toUpperCase() === "UNKNOWN";
      // clientData1 mirrors lastName in full; clientData2/4 mirror enterpriseId.
      // When lastName is UNKNOWN all three use ^null^.
      const clientData1 = isUnknown ? NULL_VAL : (lastName ? String(lastName) : null);
      const clientData2 = isUnknown ? NULL_VAL : (enterpriseId || null);
      const clientData4 = isUnknown ? NULL_VAL : (enterpriseId || null);
      const auxData7 = zip || null;
      const todayStr = new Date().toISOString().split("T")[0];
      const finalDeliveryDate = deliveryDate || todayStr;
      const finalOnRoadDate = onRoadDate || todayStr;

      // prefix is the full district number (not sliced)
      const districtStr = String(district || "").trim();
      const prefix = districtStr || null;

      // WMS paddings
      const wmsCostCenter = districtStr ? districtStr.padStart(5, "0") : undefined;
      const regionRaw = "890";
      const wmsRegionNo = regionRaw.padStart(7, "0");

      // --- Holman submission (conditional) ---
      let holmanResult: { success: boolean; skipped?: boolean; error?: string } = { success: true, skipped: true };
      if (createInHolman) {
        const holmanPayload = {
          lesseeCode: "2B56",
          holmanVehicleNumber: paddedVehicle,
          vendorCode: "OTH",
          vin: vin || null,
          modelYear: modelYear ? Number(modelYear) : null,
          makeVin: make || null,
          modelVin: model || null,
          assetType: assetType || null,
          firstName: firstName || null,
          lastName: lastName || null,
          email: "FLEET_SUPPORT@TRANSFORMCO.COM",
          clientData1,
          clientData2,
          clientData3: "890",
          clientData4,
          assignedStatusCode: "D",
          driverClass: "N",
          prefix,
          addressLine1: deliveryAddress || null,
          city: city || null,
          stateProvince: state || null,
          zipPostalCode: zip || null,
          auxData7,
          licensePlate: licensePlate || null,
          licenseState: plateState || null,
          licensePlateType: plateType || null,
          regRenewalDate: regRenewalDate || null,
          deliveryDate: finalDeliveryDate,
          onRoadDate: finalOnRoadDate,
          workPhone: phone || null,
          isActive: true,
          spareTruck: false,
        };
        // Pre-check: if the vehicle already exists in Holman (live lookup), treat as success
        // immediately — idempotent retry guard for cases where Holman creation succeeded
        // but the local cache hasn't refreshed yet.
        let holmanAlreadyExists = false;
        try {
          const holmanLookup = await holmanApiService.findVehicleByNumber(paddedVehicle);
          if (holmanLookup.success && holmanLookup.vehicle) {
            console.log("[BYOV] create: vehicle already exists in Holman, skipping submit:", paddedVehicle);
            holmanAlreadyExists = true;
          }
        } catch (holmanLookupErr: unknown) {
          // Lookup failure is non-fatal — log and continue to attempt submission
          console.warn("[BYOV] create: unexpected error during Holman pre-check lookup:", holmanLookupErr);
        }

        if (holmanAlreadyExists) {
          holmanResult = { success: true };
        } else {
          try {
            const holmanResp = await holmanApiService.submitVehicleArray([holmanPayload]);
            console.log("[BYOV] Holman submit response:", holmanResp);
            holmanResult = { success: true };
          } catch (holmanErr: unknown) {
            const holmanMsg = holmanErr instanceof Error ? holmanErr.message : "Holman submission failed";
            // Safety net: if Holman returns a duplicate/conflict response (race condition
            // between the pre-check lookup and the actual submit), treat as success.
            const isHolmanDuplicate =
              /already.?exists/i.test(holmanMsg) ||
              /duplicate/i.test(holmanMsg) ||
              /conflict/i.test(holmanMsg);
            if (isHolmanDuplicate) {
              console.log("[BYOV] create: vehicle already exists in Holman (race condition), treating as success:", holmanMsg);
              holmanResult = { success: true };
            } else {
              console.error("[BYOV] Holman submit error:", holmanErr);
              holmanResult = { success: false, error: holmanMsg };
            }
          }
        }

      }

      // Cache refresh: upsert the newly created vehicle into holman_vehicles_cache so that
      // same-session duplicate checks (the DB-cache guard above) reliably catch retries
      // without needing a live Holman API round-trip on every subsequent attempt.
      if (createInHolman && holmanResult.success) {
        try {
          const now = new Date();
          const cacheValues = {
            holmanVehicleNumber: paddedVehicle,
            vin: vin ? String(vin) : null,
            modelYear: modelYear ? Number(modelYear) : null,
            makeName: make ? String(make) : null,
            modelName: model ? String(model) : null,
            licensePlate: licensePlate ? String(licensePlate) : null,
            licenseState: plateState ? String(plateState) : null,
            city: city ? String(city) : null,
            state: state ? String(state) : null,
            region: "890",
            division: prefix,
            district: districtStr || null,
            holmanTechAssigned: enterpriseId ? String(enterpriseId) : null,
            holmanTechName:
              firstName && lastName && String(lastName).toUpperCase() !== "UNKNOWN"
                ? `${String(firstName)} ${String(lastName)}`.trim()
                : null,
            regRenewalDate: regRenewalDate ? String(regRenewalDate) : null,
            holmanAssignedStatusCd: "D",
            statusCode: 1,
            isActive: true,
            byovVinMissing: !vin,
            lastLocalUpdateAt: now,
          };
          await db
            .insert(holmanVehiclesCache)
            .values(cacheValues)
            .onConflictDoUpdate({
              target: holmanVehiclesCache.holmanVehicleNumber,
              set: { ...cacheValues, updatedAt: now },
            });
          console.log("[BYOV] create: upserted vehicle into holman_vehicles_cache:", paddedVehicle);
        } catch (cacheErr: unknown) {
          // Cache update failure is non-fatal — log and continue
          console.warn("[BYOV] create: failed to upsert into holman_vehicles_cache:", cacheErr);
        }
      }

      // --- WMS submission (conditional) ---
      let wmsResult: { success: boolean; skipped?: boolean; error?: string } = { success: true, skipped: true };
      if (createInWms) {
        const wmsPayload = {
          name: paddedVehicle,
          locationId: paddedVehicle,
          externalId: paddedVehicle,
          description: `BYOV ${make || ""} ${model || ""} ${modelYear || ""}`.trim(),
          isActive: true,
          costCenter: wmsCostCenter,
          regionNo: wmsRegionNo,
          spareTruck: false,
          useCaseId: "Nexus",
        };

        // Pre-check: if the truck already exists in WMS, treat as success immediately
        // (idempotent retry — truck was created on a prior partial-failure attempt)
        let wmsAlreadyExists = false;
        try {
          const existing = await wmsEngineService.getTruck(paddedVehicle);
          if (existing) {
            console.log("[BYOV] create: truck already exists in WMS, skipping create:", paddedVehicle);
            wmsAlreadyExists = true;
          }
        } catch (lookupErr: unknown) {
          const lookupStatus: number | undefined = (lookupErr as any)?.status;
          if (lookupStatus !== 404) {
            // Unexpected lookup error — log but continue to attempt create
            console.warn("[BYOV] create: unexpected error during WMS truck lookup:", lookupErr);
          }
          // 404 means not found — proceed to create below
        }

        if (wmsAlreadyExists) {
          wmsResult = { success: true };
        } else {
          try {
            const wmsResp = await wmsEngineService.createTruck(wmsPayload);
            console.log("[BYOV] WMS create truck response:", wmsResp);
            wmsResult = { success: true };
          } catch (wmsErr: unknown) {
            const wmsMsg = wmsErr instanceof Error ? wmsErr.message : "WMS truck creation failed";
            const wmsStatus: number | undefined = (wmsErr as any)?.status;
            const wmsMessage: string = (wmsErr as any)?.wmsMessage || wmsMsg;
            // Safety net: treat 409 Conflict or any "already exists" WMS response as success
            // in case a concurrent request created the truck between our lookup and create
            const isAlreadyExists =
              wmsStatus === 409 ||
              /already.?exists/i.test(wmsMessage) ||
              /duplicate/i.test(wmsMessage);
            if (isAlreadyExists) {
              console.log("[BYOV] create: truck already exists in WMS (race condition), treating as success:", wmsMessage);
              wmsResult = { success: true };
            } else {
              console.error("[BYOV] WMS create truck error:", wmsErr);
              wmsResult = { success: false, error: wmsMsg };
            }
          }
        }
      }

      const holmanOnly = holmanResult.success && !wmsResult.success;
      return res.json({ holman: holmanResult, wms: wmsResult, holmanOnly });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "BYOV creation failed";
      console.error("[BYOV] create error:", error);
      return res.status(500).json({ error: msg });
    }
  });

  // BYOV WMS-only retry — for when Holman succeeded but WMS failed on a prior attempt
  app.post("/api/byov/create-wms-only", requireAuth, async (req, res) => {
    try {
      const {
        vehicleNumber, make, model, modelYear, district,
      } = req.body;

      if (!vehicleNumber) return res.status(400).json({ error: "vehicleNumber is required" });

      const paddedVehicle = toHolmanRef(vehicleNumber);
      const districtStr = String(district || "").trim();
      const wmsCostCenter = districtStr ? districtStr.padStart(5, "0") : undefined;
      const regionRaw = "890";
      const wmsRegionNo = regionRaw.padStart(7, "0");

      const wmsPayload = {
        name: paddedVehicle,
        locationId: paddedVehicle,
        externalId: paddedVehicle,
        description: `BYOV ${make || ""} ${model || ""} ${modelYear || ""}`.trim(),
        isActive: true,
        costCenter: wmsCostCenter,
        regionNo: wmsRegionNo,
        spareTruck: false,
        useCaseId: "Nexus",
      };

      let wmsResult: { success: boolean; error?: string } = { success: false };

      // Pre-check: if the truck already exists in WMS, treat as success immediately
      // (idempotent retry — truck was created on a prior attempt)
      let truckAlreadyExists = false;
      try {
        const existing = await wmsEngineService.getTruck(paddedVehicle);
        if (existing) {
          console.log("[BYOV] WMS-only retry: truck already exists in WMS, skipping create:", paddedVehicle);
          truckAlreadyExists = true;
        }
      } catch (lookupErr: unknown) {
        const lookupStatus: number | undefined = (lookupErr as any)?.status;
        if (lookupStatus !== 404) {
          // Unexpected lookup error — log but continue to attempt create
          console.warn("[BYOV] WMS-only retry: unexpected error during truck lookup:", lookupErr);
        }
        // 404 means not found — proceed to create below
      }

      if (truckAlreadyExists) {
        wmsResult = { success: true };
      } else {
        try {
          const wmsResp = await wmsEngineService.createTruck(wmsPayload);
          console.log("[BYOV] WMS-only retry response:", wmsResp);
          wmsResult = { success: true };
        } catch (wmsErr: unknown) {
          const wmsMsg = wmsErr instanceof Error ? wmsErr.message : "WMS truck creation failed";
          const wmsStatus: number | undefined = (wmsErr as any)?.status;
          const wmsMessage: string = (wmsErr as any)?.wmsMessage || wmsMsg;
          // Safety net: treat 409 Conflict or any "already exists" WMS response as success
          // in case a concurrent request created the truck between our lookup and create
          const isAlreadyExists =
            wmsStatus === 409 ||
            /already.?exists/i.test(wmsMessage) ||
            /duplicate/i.test(wmsMessage);
          if (isAlreadyExists) {
            console.log("[BYOV] WMS-only retry: truck already exists (race condition), treating as success:", wmsMessage);
            wmsResult = { success: true };
          } else {
            console.error("[BYOV] WMS-only retry error:", wmsErr);
            wmsResult = { success: false, error: wmsMsg };
          }
        }
      }

      return res.json({ wms: wmsResult });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "WMS-only creation failed";
      console.error("[BYOV] create-wms-only error:", error);
      return res.status(500).json({ error: msg });
    }
  });

  app.get("/api/byov/audit-log", requireAuth, async (req, res) => {
    try {
      const { from: fromParam, to: toParam } = req.query as { from?: string; to?: string };

      const conditions: SQL[] = [];

      if (fromParam) {
        const fromDate = new Date(fromParam);
        if (!isNaN(fromDate.getTime())) {
          conditions.push(gte(byovCreationAudit.submittedAt, fromDate.toISOString()));
        }
      }
      if (toParam) {
        const toDate = new Date(toParam);
        if (!isNaN(toDate.getTime())) {
          toDate.setUTCHours(23, 59, 59, 999);
          conditions.push(lte(byovCreationAudit.submittedAt, toDate.toISOString()));
        }
      }

      const query = db
        .select()
        .from(byovCreationAudit)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(byovCreationAudit.submittedAt));

      const rows = conditions.length > 0
        ? await query
        : await query.limit(100);

      return res.json(rows);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Failed to load audit log";
      console.error("[BYOV] audit-log error:", error);
      return res.status(500).json({ error: msg });
    }
  });

  app.get("/api/byov/audit-log/export", requireAuth, async (req, res) => {
    try {
      const { from: fromParam, to: toParam } = req.query as { from?: string; to?: string };

      const conditions: SQL[] = [];
      let validFromStr: string | undefined;
      let validToStr: string | undefined;

      if (fromParam) {
        const fromDate = new Date(fromParam);
        if (!isNaN(fromDate.getTime())) {
          validFromStr = fromDate.toISOString().slice(0, 10);
          conditions.push(gte(byovCreationAudit.submittedAt, fromDate.toISOString()));
        }
      }
      if (toParam) {
        const toDate = new Date(toParam);
        if (!isNaN(toDate.getTime())) {
          validToStr = toDate.toISOString().slice(0, 10);
          toDate.setUTCHours(23, 59, 59, 999);
          conditions.push(lte(byovCreationAudit.submittedAt, toDate.toISOString()));
        }
      }

      const rows = await db
        .select()
        .from(byovCreationAudit)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(byovCreationAudit.submittedAt));

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("BYOV Submission History");

      worksheet.columns = [
        { header: "Vehicle #", key: "vehicleNumber", width: 14 },
        { header: "Year", key: "modelYear", width: 8 },
        { header: "Make", key: "make", width: 14 },
        { header: "Model", key: "model", width: 14 },
        { header: "Asset Type", key: "assetType", width: 12 },
        { header: "District", key: "district", width: 12 },
        { header: "Submitted By", key: "submittedBy", width: 22 },
        { header: "Date", key: "submittedAt", width: 20 },
        { header: "Blocked", key: "blocked", width: 10 },
        { header: "Block Source", key: "blockedSource", width: 18 },
        { header: "Holman Result", key: "holmanResult", width: 16 },
        { header: "Holman Error", key: "holmanError", width: 40 },
        { header: "WMS Result", key: "wmsResult", width: 14 },
        { header: "WMS Error", key: "wmsError", width: 40 },
      ];

      rows.forEach((row) => {
        worksheet.addRow({
          vehicleNumber: row.vehicleNumber,
          modelYear: row.modelYear || "",
          make: row.make || "",
          model: row.model || "",
          assetType: row.assetType || "",
          district: row.district || "",
          submittedBy: row.submittedBy,
          submittedAt: new Date(row.submittedAt).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          }),
          blocked: row.blockedSource ? "Yes" : "No",
          blockedSource: row.blockedSource === "live" ? "Live Holman lookup" : row.blockedSource === "cache" ? "Local cache" : "",
          holmanResult: row.holmanSuccess ? "OK" : "Failed",
          holmanError: row.holmanError || "",
          wmsResult: row.wmsSuccess ? "OK" : "Failed",
          wmsError: row.wmsError || "",
        });
      });

      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE0E0E0" },
      };

      const dateStr = new Date().toISOString().slice(0, 10);
      const filenameParts = ["byov-submission-history"];
      if (validFromStr) filenameParts.push(`from-${validFromStr}`);
      if (validToStr) filenameParts.push(`to-${validToStr}`);
      filenameParts.push(dateStr);
      const filename = `${filenameParts.join("-")}.xlsx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename=${filename}`);

      await workbook.xlsx.write(res);
      res.end();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Failed to export audit log";
      console.error("[BYOV] audit-log export error:", error);
      return res.status(500).json({ error: msg });
    }
  });

  app.get("/api/byov/audit-log/summary", requireAuth, async (_req, res) => {
    try {
      const rows = await db
        .select({
          vehicleNumber: byovCreationAudit.vehicleNumber,
          submittedBy: byovCreationAudit.submittedBy,
          submittedAt: byovCreationAudit.submittedAt,
        })
        .from(byovCreationAudit)
        .orderBy(asc(byovCreationAudit.submittedAt));
      return res.json(rows);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Failed to load audit summary";
      console.error("[BYOV] audit-log/summary error:", error);
      return res.status(500).json({ error: msg });
    }
  });

  app.get("/api/byov/audit-log/:vehicleNumber", requireAuth, async (req, res) => {
    try {
      const { vehicleNumber } = req.params;
      const rows = await db
        .select()
        .from(byovCreationAudit)
        .where(eq(byovCreationAudit.vehicleNumber, vehicleNumber))
        .orderBy(asc(byovCreationAudit.submittedAt))
        .limit(1);
      if (rows.length === 0) return res.json(null);
      return res.json(rows[0]);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Failed to load audit entry";
      console.error("[BYOV] audit-log/:vehicleNumber error:", error);
      return res.status(500).json({ error: msg });
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

  // Fleet vehicles endpoint - fetches all vehicles from Holman with cache fallback
  const { holmanVehicleSyncService } = await import("./holman-vehicle-sync-service");
  
  app.get("/api/holman/fleet-vehicles", requireAuth, async (req: any, res) => {
    try {
      const { pageNumber = '1', pageSize = '500' } = req.query;
      
      console.log('[Holman Fleet] Fetching vehicles...');
      
      const result = await holmanVehicleSyncService.fetchActiveVehicles({
        page: parseInt(pageNumber as string),
        pageSize: parseInt(pageSize as string),
      });

      // TPMS enrichment is now applied inside fetchActiveVehicles() before caching,
      // so vehicles here are already enriched.
      console.log(`[Holman Fleet] Returned ${result.vehicles.length} vehicles (mode: ${result.syncStatus.dataMode})`);
      
      res.json({
        success: result.success,
        totalCount: result.pagination?.totalCount || result.vehicles.length,
        vehicles: result.vehicles,
        syncStatus: result.syncStatus,
      });
    } catch (error: any) {
      console.error("Error fetching Holman fleet vehicles:", error);
      res.status(500).json({ 
        success: false, 
        message: error.message || "Failed to fetch fleet vehicles",
        vehicles: [],
        syncStatus: {
          dataMode: 'empty',
          isStale: true,
          lastSyncAt: null,
          pendingChangeCount: 0,
          totalVehicles: 0,
          apiAvailable: false,
          errorMessage: error.message,
        }
      });
    }
  });

  // Lightweight counts-only endpoint (reads from cache, very fast)
  app.get("/api/holman/fleet-vehicles/counts", requireAuth, async (req: any, res) => {
    try {
      const counts = await holmanVehicleSyncService.getCachedCounts();
      res.json(counts);
    } catch (error: any) {
      console.error("Error fetching fleet counts:", error);
      res.status(500).json({ 
        success: false, 
        total: 0,
        assigned: 0,
        unassigned: 0,
        message: error.message 
      });
    }
  });

  // Manual sync endpoint — bypasses the 15-minute in-memory cache
  app.post("/api/holman/fleet-vehicles/sync", requireAuth, async (req: any, res) => {
    try {
      console.log('[Holman Fleet] Manual sync triggered');
      const result = await holmanVehicleSyncService.fetchActiveVehicles({ forceRefresh: true });
      res.json({
        success: result.success,
        syncStatus: result.syncStatus,
        vehicleCount: result.vehicles.length,
      });
    } catch (error: any) {
      res.status(500).json({ 
        success: false, 
        message: error.message 
      });
    }
  });

  // Get sync status
  app.get("/api/holman/fleet-vehicles/status", requireAuth, async (req: any, res) => {
    try {
      const status = await holmanVehicleSyncService.getSyncStatus();
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get pending changes
  app.get("/api/holman/fleet-vehicles/pending-changes", requireAuth, async (req: any, res) => {
    try {
      const pending = await holmanVehicleSyncService.getPendingChanges();
      const failed = await holmanVehicleSyncService.getFailedChanges();
      res.json({ pending, failed });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get incremental sync state
  app.get("/api/holman/fleet-vehicles/sync-state", requireAuth, async (req: any, res) => {
    try {
      const state = await holmanVehicleSyncService.getSyncState();
      res.json({
        success: true,
        syncState: state,
        hasState: !!state,
        canIncrementalSync: !!state?.lastChangeRecordId,
      });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Trigger incremental sync (only fetches changed records)
  app.post("/api/holman/fleet-vehicles/incremental-sync", requireAuth, async (req: any, res) => {
    try {
      const { forceFullSync = false } = req.body;
      console.log(`[Holman Fleet] Incremental sync triggered (forceFullSync=${forceFullSync})`);
      const result = await holmanVehicleSyncService.fetchChangedVehicles(forceFullSync);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Verify if pending updates have been processed by Holman
  app.post("/api/holman/fleet-vehicles/verify-updates", requireAuth, async (req: any, res) => {
    try {
      console.log('[Holman Fleet] Verifying pending updates');
      const result = await holmanVehicleSyncService.verifyPendingUpdates();
      res.json({ success: true, ...result });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post("/api/holman/fleet-vehicles/sync-odometer", requireAuth, async (req: any, res) => {
    try {
      const { getSnowflakeSyncService, } = await import("./snowflake-sync-service");
      const syncSvc = getSnowflakeSyncService();
      const result = await syncSvc.enrichVehicleOdometerData();
      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error("[OdoSync] Manual trigger error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Update vehicle assignment in Holman based on TPMS data
  const { holmanAssignmentUpdateService } = await import("./holman-assignment-update-service");

  app.post("/api/holman/assignments/update", requireAuth, async (req: any, res) => {
    try {
      const { vehicleNumber, enterpriseId } = req.body;
      
      if (!vehicleNumber) {
        return res.status(400).json({ 
          success: false, 
          error: 'Vehicle number is required' 
        });
      }
      
      const action = enterpriseId ? `tech=${enterpriseId}` : 'UNASSIGN';
      console.log(`[API] Holman assignment update requested: vehicle=${vehicleNumber}, ${action}`);
      const result = await holmanAssignmentUpdateService.updateVehicleAssignment(
        vehicleNumber,
        enterpriseId || null
      );
      
      if (result.success) {
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (error: any) {
      console.error('[API] Holman assignment update error:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  });

  // Bulk update vehicle assignments
  app.post("/api/holman/assignments/update-bulk", requireAuth, async (req: any, res) => {
    try {
      const { updates } = req.body;
      
      if (!updates || !Array.isArray(updates) || updates.length === 0) {
        return res.status(400).json({ 
          success: false, 
          error: 'Updates array is required' 
        });
      }
      
      console.log(`[API] Bulk Holman assignment update: ${updates.length} vehicles`);
      const results = await holmanAssignmentUpdateService.updateMultipleVehicleAssignments(updates);
      
      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;
      
      res.json({
        success: failCount === 0,
        totalUpdates: updates.length,
        successCount,
        failCount,
        results
      });
    } catch (error: any) {
      console.error('[API] Bulk Holman assignment update error:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  });

  // Holman Submission Tracking Endpoints
  const { holmanSubmissionService } = await import("./holman-submission-service");

  // Get pending submissions for a vehicle
  // Get a single submission by DB id — used by the UI to poll for verification status
  app.get("/api/holman/submissions/:id", requireAuth, async (req: any, res) => {
    try {
      const submission = await holmanSubmissionService.getSubmissionById(req.params.id);
      if (!submission) return res.status(404).json({ success: false, error: "Submission not found" });
      res.json({ success: true, submission });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Trigger immediate verification for a specific submission (for manual retry)
  // Also propagates final status to fleet_operation_log when completed/failed
  app.post("/api/holman/submissions/:id/verify", requireAuth, async (req: any, res) => {
    try {
      const submission = await holmanSubmissionService.getSubmissionById(req.params.id);
      if (!submission) return res.status(404).json({ success: false, error: "Submission not found" });
      const result = await holmanSubmissionService.verifyByVehicleLookup(submission);
      if (result.newStatus === 'completed' || result.newStatus === 'failed') {
        await holmanSubmissionService.propagateStatusToFleetLog(submission, result.newStatus, result.message);
      }
      res.json({ success: true, ...result });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get("/api/holman/submissions/vehicle/:vehicleNumber", requireAuth, async (req: any, res) => {
    try {
      const { vehicleNumber } = req.params;
      const pendingOnly = req.query.pendingOnly === 'true';
      
      const submissions = pendingOnly 
        ? await holmanSubmissionService.getPendingSubmissionsForVehicle(vehicleNumber)
        : await holmanSubmissionService.getSubmissionsByVehicle(vehicleNumber);
      
      res.json({ success: true, submissions });
    } catch (error: any) {
      console.error('[API] Get submissions error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get all pending submissions
  app.get("/api/holman/submissions/pending", requireAuth, async (req: any, res) => {
    try {
      const submissions = await holmanSubmissionService.getAllPendingSubmissions();
      res.json({ success: true, submissions, count: submissions.length });
    } catch (error: any) {
      console.error('[API] Get pending submissions error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Poll/check status of pending submissions
  app.post("/api/holman/submissions/poll", requireAuth, async (req: any, res) => {
    try {
      const result = await holmanSubmissionService.pollPendingSubmissions();
      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error('[API] Poll submissions error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Re-verify a stuck/failed submission and update its fleet_operation_log
  // Optionally accepts fleetOpLogId to target a specific fleet_operation_log row
  app.post("/api/holman/submissions/:id/reverify", requireAuth, async (req: any, res) => {
    try {
      const { fleetOpLogId } = req.body || {};
      const submission = await holmanSubmissionService.getSubmissionById(req.params.id);
      if (!submission) return res.status(404).json({ success: false, error: "Submission not found" });

      if (submission.status === 'completed' || submission.status === 'failed') {
        await holmanSubmissionService.resetForReverification(submission.id);
      }

      const refreshed = await holmanSubmissionService.getSubmissionById(submission.id);
      if (!refreshed) return res.status(404).json({ success: false, error: "Submission not found after reset" });

      const result = await holmanSubmissionService.verifyByVehicleLookup(refreshed);

      if (result.newStatus === 'completed' || result.newStatus === 'failed') {
        await holmanSubmissionService.propagateStatusToFleetLog(refreshed, result.newStatus, result.message);
      }

      if (fleetOpLogId && (result.newStatus === 'completed' || result.newStatus === 'failed')) {
        const vehicleNumber = submission.holmanVehicleNumber;
        const logs = await storage.getFleetOperationLogs({ truckNumber: vehicleNumber });
        const matchingLog = logs.find(l => l.id === Number(fleetOpLogId));
        if (matchingLog) {
          const holmanStatus = result.newStatus === 'completed' ? 'success' : 'failed';
          await storage.updateFleetOperationLog(Number(fleetOpLogId), {
            holmanStatus,
            holmanMessage: result.message,
          });
        }
      }

      if (result.newStatus === 'pending') {
        holmanSubmissionService.scheduleVerification(submission.id, 60_000, 5);
      }

      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error('[API] Re-verify submission error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Mark submissions as completed for a vehicle (when mismatch is resolved)
  app.post("/api/holman/submissions/vehicle/:vehicleNumber/complete", requireAuth, async (req: any, res) => {
    try {
      const { vehicleNumber } = req.params;
      const count = await holmanSubmissionService.markAsCompleted(vehicleNumber);
      res.json({ success: true, completedCount: count });
    } catch (error: any) {
      console.error('[API] Complete submissions error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get all submissions with filters for activity logs
  app.get("/api/holman/submissions/logs", requireAuth, async (req: any, res) => {
    try {
      const { status, action, vehicleNumber, startDate, endDate, limit } = req.query;
      
      const filters: any = {};
      if (status) filters.status = status;
      if (action) filters.action = action;
      if (vehicleNumber) filters.vehicleNumber = vehicleNumber;
      if (startDate) filters.startDate = new Date(startDate);
      if (endDate) filters.endDate = new Date(endDate);
      if (limit) filters.limit = parseInt(limit, 10);
      
      const submissions = await holmanSubmissionService.getAllSubmissions(filters);
      res.json({ success: true, submissions, count: submissions.length });
    } catch (error: any) {
      console.error('[API] Get submission logs error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Field-by-field test endpoints for debugging slow Holman syncs
  app.post("/api/holman/field-test/single", requireAuth, async (req: any, res) => {
    try {
      const { vehicleNumber, fieldName, fieldValue, useSpace } = req.body;
      
      if (!vehicleNumber || !fieldName) {
        return res.status(400).json({ 
          success: false, 
          error: 'vehicleNumber and fieldName are required' 
        });
      }
      
      console.log(`[API] Single field test: vehicle=${vehicleNumber}, field=${fieldName}, useSpace=${useSpace}`);
      const result = await holmanAssignmentUpdateService.testSingleFieldUpdate(
        vehicleNumber,
        fieldName,
        fieldValue ?? null,
        useSpace === true
      );
      
      res.json({ success: true, result });
    } catch (error: any) {
      console.error('[API] Single field test error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post("/api/holman/field-test/run", requireAuth, async (req: any, res) => {
    try {
      const { vehicleNumber, useSpace, testValue } = req.body;
      
      if (!vehicleNumber) {
        return res.status(400).json({ 
          success: false, 
          error: 'vehicleNumber is required' 
        });
      }
      
      console.log(`[API] Running field-by-field test for vehicle=${vehicleNumber}, useSpace=${useSpace}, testValue=${testValue}`);
      const result = await holmanAssignmentUpdateService.runFieldByFieldTest(
        vehicleNumber,
        useSpace === true,
        testValue || 'TEST'
      );
      
      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error('[API] Field-by-field test error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  console.log("Registering Snowflake API routes...");
  const { getSnowflakeService, isSnowflakeConfigured } = await import("./snowflake-service");

  app.get("/api/snowflake/status", requireAuth, async (req: any, res) => {
    try {
      const configured = isSnowflakeConfigured();
      const account = process.env.SNOWFLAKE_ACCOUNT;
      const username = process.env.SNOWFLAKE_USER;
      const privateKey = process.env.SNOWFLAKE_PRIVATE_KEY;
      const isProduction = process.env.NODE_ENV === 'production';
      
      // Include diagnostic info for troubleshooting
      const diagnostics = {
        environment: isProduction ? 'production' : 'development',
        envVars: {
          SNOWFLAKE_ACCOUNT: account ? 'set' : 'missing',
          SNOWFLAKE_USER: username ? 'set' : 'missing',
          SNOWFLAKE_PRIVATE_KEY: privateKey ? `set (${privateKey.length} chars)` : 'missing',
          SNOWFLAKE_DATABASE: process.env.SNOWFLAKE_DATABASE ? 'set' : 'missing',
          SNOWFLAKE_WAREHOUSE: process.env.SNOWFLAKE_WAREHOUSE ? 'set' : 'missing',
        }
      };
      
      res.json({ configured, diagnostics });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/snowflake/debug", requireAuth, async (req: any, res) => {
    try {
      const account = process.env.SNOWFLAKE_ACCOUNT;
      const username = process.env.SNOWFLAKE_USER;
      const privateKey = process.env.SNOWFLAKE_PRIVATE_KEY;
      const isProduction = process.env.NODE_ENV === 'production';
      const configured = isSnowflakeConfigured();
      
      res.json({
        configured,
        environment: isProduction ? 'production' : 'development',
        envVars: {
          SNOWFLAKE_ACCOUNT: account ? `set (${account.length} chars)` : 'missing',
          SNOWFLAKE_USER: username ? `set (${username.length} chars)` : 'missing',
          SNOWFLAKE_PRIVATE_KEY: privateKey ? `set (${privateKey.length} chars, starts with "${privateKey.substring(0, 20)}...")` : 'missing',
          SNOWFLAKE_DATABASE: process.env.SNOWFLAKE_DATABASE ? 'set' : 'missing',
          SNOWFLAKE_WAREHOUSE: process.env.SNOWFLAKE_WAREHOUSE ? 'set' : 'missing',
        }
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Sprint 11: Diagnostic endpoint for testing separation data lookup
  app.get("/api/test-separation/:identifier", requireAuth, async (req: any, res) => {
    try {
      const { identifier } = req.params;
      if (!identifier) {
        return res.status(400).json({ message: "Identifier (enterprise ID or employee ID) is required" });
      }
      
      const { getSnowflakeSyncService } = await import("./snowflake-sync-service");
      const snowflakeSyncService = getSnowflakeSyncService();
      
      if (!snowflakeSyncService) {
        return res.status(500).json({ message: "Snowflake service not initialized" });
      }
      
      // Test single lookup
      const separationDetails = await snowflakeSyncService.getSeparationDetails(identifier);
      
      // Also look up from all_techs for comparison
      let allTechsRecord = await storage.getAllTechByTechRacfid(identifier.toUpperCase());
      if (!allTechsRecord) {
        allTechsRecord = await storage.getAllTechByEmployeeId(identifier);
      }
      
      res.json({
        identifier,
        hrSeparation: separationDetails,
        allTechsRecord: allTechsRecord ? {
          techName: allTechsRecord.techName,
          techRacfid: allTechsRecord.techRacfid,
          employeeId: allTechsRecord.employeeId,
          districtNo: allTechsRecord.districtNo,
          lastDayWorked: allTechsRecord.lastDayWorked,
          effectiveDate: allTechsRecord.effectiveDate,
          cellPhone: allTechsRecord.cellPhone,
          homePhone: allTechsRecord.homePhone,
          mainPhone: allTechsRecord.mainPhone,
          homeAddr1: allTechsRecord.homeAddr1,
          homeCity: allTechsRecord.homeCity,
          homeState: allTechsRecord.homeState,
        } : null,
        recommendation: separationDetails.success 
          ? "HR separation data found - this tech will appear in Tools Queue"
          : allTechsRecord 
            ? "No HR separation data, but found in all_techs"
            : "Not found in HR separation table or all_techs",
      });
    } catch (error: any) {
      console.error("Error testing separation lookup:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Sprint 11: Diagnostic endpoint for viewing all HR separations
  app.get("/api/test-separations", requireAuth, async (req: any, res) => {
    try {
      const { getSnowflakeSyncService } = await import("./snowflake-sync-service");
      const snowflakeSyncService = getSnowflakeSyncService();
      
      if (!snowflakeSyncService) {
        return res.status(500).json({ message: "Snowflake service not initialized" });
      }
      
      const result = await snowflakeSyncService.getAllConfirmedSeparations();
      
      res.json({
        success: result.success,
        count: result.records.length,
        records: result.records,
        message: result.message,
      });
    } catch (error: any) {
      console.error("Error fetching all separations:", error);
      res.status(500).json({ success: false, message: error.message });
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
      if (!currentUser || (currentUser.role !== 'developer' && currentUser.role !== 'admin')) {
        return res.status(403).json({ message: "Only developer users can trigger manual syncs" });
      }
      
      const syncService = getSnowflakeSyncService();
      const result = await syncService.syncTermedTechs('manual');
      res.json(result);
    } catch (error: any) {
      console.error("Error syncing termed techs:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Sprint 0: Manual trigger for separation poll
  app.post("/api/snowflake/sync/separations", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || (currentUser.role !== 'developer' && currentUser.role !== 'admin')) {
        return res.status(403).json({ message: "Only developer users can trigger manual syncs" });
      }
      
      const { triggerSeparationPoll } = await import("./sync-scheduler");
      const result = await triggerSeparationPoll();
      res.json(result);
    } catch (error: any) {
      console.error("Error polling separations:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.get("/api/snowflake/sync/separation-enrichment/trigger", async (_req: any, res) => {
    try {
      if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({ message: "Not available in production" });
      }
      const { getSnowflakeSyncService } = await import("./snowflake-sync-service");
      const syncService = getSnowflakeSyncService();
      const result = await syncService.enrichOffboardingWithSeparationDetails();
      res.json(result);
    } catch (error: any) {
      console.error("Error running separation enrichment:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post("/api/snowflake/sync/separation-enrichment", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || (currentUser.role !== 'developer' && currentUser.role !== 'admin')) {
        return res.status(403).json({ message: "Only developer users can trigger manual syncs" });
      }
      
      const { getSnowflakeSyncService } = await import("./snowflake-sync-service");
      const syncService = getSnowflakeSyncService();
      const result = await syncService.enrichOffboardingWithSeparationDetails();
      res.json(result);
    } catch (error: any) {
      console.error("Error running separation enrichment:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post("/api/snowflake/sync/all-techs", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || (currentUser.role !== 'developer' && currentUser.role !== 'admin')) {
        return res.status(403).json({ message: "Only developer users can trigger manual syncs" });
      }
      
      const syncService = getSnowflakeSyncService();
      const result = await syncService.syncAllTechs('manual');
      res.json(result);
    } catch (error: any) {
      console.error("Error syncing all techs:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post("/api/snowflake/sync/truck-inventory", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || (currentUser.role !== 'developer' && currentUser.role !== 'admin')) {
        return res.status(403).json({ message: "Only developer users can trigger manual syncs" });
      }
      
      const syncService = getSnowflakeSyncService();
      const result = await syncService.syncTruckInventory('manual');
      res.json(result);
    } catch (error: any) {
      console.error("Error syncing truck inventory:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Sync TPMS data from Snowflake daily snapshot (replaces unreliable TPMS API for daily sync)
  app.post("/api/snowflake/sync/tpms", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || (currentUser.role !== 'developer' && currentUser.role !== 'admin')) {
        return res.status(403).json({ message: "Only developer users can trigger manual syncs" });
      }
      
      const syncService = getSnowflakeSyncService();
      const result = await syncService.syncTPMSFromSnowflake('manual');
      // Task #221: refresh the in-process snapshot too so the manual sync
      // button matches what the nightly scheduler does. Non-fatal — we still
      // return the upstream sync result even if the snapshot reload fails.
      try {
        const { refreshSnapshot } = await import("./fleet-scope-tpms-snapshot");
        await refreshSnapshot('manual_tpms_sync');
      } catch (snapErr: any) {
        console.error("[TPMS] Snapshot refresh after manual sync failed (non-fatal):", snapErr?.message);
      }
      res.json(result);
    } catch (error: any) {
      console.error("Error syncing TPMS from Snowflake:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Task #221: in-process TPMS_EXTRACT snapshot — read current state.
  // Anyone authenticated may inspect; the snapshot itself contains no secrets.
  app.get("/api/admin/tpms-snapshot", requireAuth, async (_req: any, res) => {
    try {
      const { getSnapshotMeta } = await import("./fleet-scope-tpms-snapshot");
      res.json(getSnapshotMeta());
    } catch (error: any) {
      console.error("Error reading TPMS snapshot meta:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Task #221: force-refresh the in-process TPMS_EXTRACT snapshot. Used by the
  // rare "I need fresh phone numbers right now" admin case between nightly syncs.
  app.post("/api/admin/tpms-snapshot/refresh", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || (currentUser.role !== 'developer' && currentUser.role !== 'admin')) {
        return res.status(403).json({ message: "Only developer or admin users can force-refresh the TPMS snapshot" });
      }
      const { refreshSnapshot, getSnapshotMeta } = await import("./fleet-scope-tpms-snapshot");
      const result = await refreshSnapshot(`manual:${currentUser.username}`);
      res.json({ ...result, meta: getSnapshotMeta() });
    } catch (error: any) {
      console.error("Error force-refreshing TPMS snapshot:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Sync onboarding hires from Snowflake HR roster view
  app.post("/api/snowflake/sync/onboarding-hires", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || (currentUser.role !== 'developer' && currentUser.role !== 'admin')) {
        return res.status(403).json({ message: "Only developer users can trigger manual syncs" });
      }
      
      const syncService = getSnowflakeSyncService();
      const result = await syncService.syncOnboardingHires('manual');
      res.json(result);
    } catch (error: any) {
      console.error("Error syncing onboarding hires:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Enrich onboarding hires with Snowflake data
  app.post("/api/snowflake/enrich/onboarding-hires", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || (currentUser.role !== 'developer' && currentUser.role !== 'admin')) {
        return res.status(403).json({ message: "Only developer users can trigger enrichment" });
      }
      
      const syncService = getSnowflakeSyncService();
      const result = await syncService.enrichOnboardingHires();
      res.json(result);
    } catch (error: any) {
      console.error("Error enriching onboarding hires:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Get all onboarding hires
  app.get("/api/onboarding-hires", requireAuth, async (req: any, res) => {
    try {
      const hires = await storage.getOnboardingHires();
      res.json(hires);
    } catch (error: any) {
      console.error("Error getting onboarding hires:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Export onboarding hires to XLSX
  app.get("/api/onboarding-hires/export", requireAuth, async (req: any, res) => {
    try {
      const hires = await storage.getOnboardingHires();
      
      // Sort by service date ascending
      hires.sort((a, b) => {
        const dateA = a.serviceDate ? new Date(a.serviceDate).getTime() : 0;
        const dateB = b.serviceDate ? new Date(b.serviceDate).getTime() : 0;
        return dateA - dateB;
      });

      // District to Owner mapping
      const districtOwnerMap: Record<string, string> = {
        '3132': 'Monica, Cheryl & Machell', '3580': 'Monica, Cheryl & Machell',
        '4766': 'Rob & Andrea', '6141': 'Monica, Cheryl & Machell',
        '7084': 'Rob & Andrea', '7088': 'Carol & Tasha', '7108': 'Carol & Tasha',
        '7323': 'Monica, Cheryl & Machell', '7435': 'Rob & Andrea',
        '7670': 'Rob & Andrea', '7744': 'Rob & Andrea', '7983': 'Rob & Andrea',
        '7995': 'Carol & Tasha', '8035': 'Rob & Andrea',
        '8096': 'Monica, Cheryl & Machell', '8107': 'Carol & Tasha',
        '8147': 'Carol & Tasha', '8158': 'Carol & Tasha',
        '8162': 'Monica, Cheryl & Machell', '8169': 'Carol & Tasha',
        '8175': 'Rob & Andrea', '8184': 'Carol & Tasha',
        '8206': 'Monica, Cheryl & Machell', '8220': 'Monica, Cheryl & Machell',
        '8228': 'Carol & Tasha', '8309': 'Monica, Cheryl & Machell',
        '8366': 'Carol & Tasha', '8380': 'Rob & Andrea',
        '8420': 'Monica, Cheryl & Machell', '8555': 'Monica, Cheryl & Machell',
        '8935': 'Monica, Cheryl & Machell',
      };
      const getOwner = (d: string | null) => d ? (districtOwnerMap[d.slice(-4)] || '') : '';

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Weekly Onboarding');

      worksheet.columns = [
        { header: 'Service Date', key: 'serviceDate', width: 15 },
        { header: 'Employee Name', key: 'employeeName', width: 25 },
        { header: 'Emp. Status', key: 'employmentStatus', width: 15 },
        { header: 'Enterprise ID', key: 'enterpriseId', width: 15 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Truck #', key: 'truckNo', width: 12 },
        { header: 'Job Title', key: 'jobTitle', width: 30 },
        { header: 'District', key: 'district', width: 10 },
        { header: 'Owner', key: 'owner', width: 25 },
        { header: 'Zipcode', key: 'zipcode', width: 10 },
        { header: 'City', key: 'city', width: 20 },
        { header: 'Planning Area', key: 'planningArea', width: 20 },
        { header: 'Address', key: 'address', width: 35 },
        { header: 'Specialties', key: 'specialties', width: 20 },
        { header: 'State', key: 'state', width: 8 },
        { header: 'Action Reason', key: 'actionReason', width: 20 },
      ];

      hires.forEach(hire => {
        worksheet.addRow({
          serviceDate: hire.serviceDate ? new Date(hire.serviceDate).toLocaleDateString() : '',
          employeeName: hire.employeeName || '',
          employmentStatus: hire.employmentStatus || '',
          enterpriseId: hire.enterpriseId || '',
          status: hire.truckAssigned ? 'Assigned' : 'Pending',
          truckNo: hire.assignedTruckNo || '',
          jobTitle: hire.jobTitle || '',
          district: hire.district || '',
          owner: getOwner(hire.district),
          zipcode: hire.zipcode || '',
          city: hire.locationCity || '',
          planningArea: hire.planningAreaName || '',
          address: hire.address || '',
          specialties: hire.specialties || '',
          state: hire.workState || '',
          actionReason: hire.actionReasonDescr || '',
        });
      });

      // Style header row
      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
      };

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename=weekly-onboarding.xlsx');
      
      await workbook.xlsx.write(res);
      res.end();
    } catch (error: any) {
      console.error("Error exporting onboarding hires:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Update onboarding hire (mark truck assigned)
  app.patch("/api/onboarding-hires/:id", requireAuth, async (req: any, res) => {
    try {
      const { id } = req.params;
      const currentUser = await storage.getUserByUsername(req.user.username);
      
      const updates: Record<string, any> = {
        ...req.body,
        assignedBy: currentUser?.username,
        assignedAt: req.body.truckAssigned ? new Date() : null,
      };
      
      // Mark as manual assignment when user assigns a truck
      if (req.body.assignedTruckNo && req.body.assignedTruckNo.trim()) {
        updates.truckAssignmentSource = 'manual';
      } else if (!req.body.truckAssigned) {
        // Clear source when unassigning
        updates.truckAssignmentSource = null;
      }
      
      const updated = await storage.updateOnboardingHire(id, updates);
      if (!updated) {
        return res.status(404).json({ message: "Onboarding hire not found" });
      }
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating onboarding hire:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Bulk create onboarding hires (manual import)
  app.post("/api/onboarding-hires/bulk", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || currentUser.role !== 'developer') {
        return res.status(403).json({ message: "Only developer users can bulk import" });
      }

      const { records } = req.body;
      if (!Array.isArray(records) || records.length === 0) {
        return res.status(400).json({ message: "Records array is required" });
      }

      let created = 0;
      for (const record of records) {
        try {
          const hire = {
            serviceDate: record.serviceDate,
            employeeName: record.employeeName,
            enterpriseId: record.enterpriseId || null,
            district: record.district || null,
            assignedTruckNo: record.assignedTruckNo || null,
            truckAssigned: !!record.assignedTruckNo,
            notes: record.notes || null,
            workState: record.workState || null,
            actionReasonDescr: record.actionReasonDescr || null,
            jobTitle: record.jobTitle || null,
            techType: record.techType || null,
            zipcode: record.zipcode || null,
            locationCity: record.locationCity || null,
            planningAreaName: record.planningAreaName || null,
          };
          await storage.upsertOnboardingHire(hire);
          created++;
        } catch (err: any) {
          console.error(`Error importing record ${record.employeeName}:`, err.message);
        }
      }

      res.json({ success: true, created, total: records.length });
    } catch (error: any) {
      console.error("Error bulk importing onboarding hires:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Get truck inventory summary with items (total pieces and total avg cost)
  app.get("/api/truck-inventory/summary/:truck", requireAuth, async (req: any, res) => {
    try {
      const { truck } = req.params;
      const paddedTruck = toHolmanRef(truck);
      console.log(`[Inventory] Looking up truck: ${truck} -> padded: ${paddedTruck}`);
      const inventory = await storage.getTruckInventory(paddedTruck);
      console.log(`[Inventory] Found ${inventory.length} items for truck ${paddedTruck}`);
      
      const totalPieces = inventory.reduce((sum, item) => sum + (item.qty || 0), 0);
      const totalAvgCost = inventory.reduce((sum, item) => {
        const cost = parseFloat(item.extNsAvgCost || '0');
        return sum + (isNaN(cost) ? 0 : cost);
      }, 0);
      
      console.log(`[Inventory] Summary: ${totalPieces} pieces, $${totalAvgCost.toFixed(2)}, ${inventory.length} unique SKUs`);
      
      // Format items for display - sort by ext cost descending
      const items = inventory
        .map(item => ({
          sku: item.sku,
          partNo: item.partNo,
          partDesc: item.partDesc,
          qty: item.qty || 0,
          unitCost: parseFloat(item.nsAvgCost || '0'),
          extCost: parseFloat(item.extNsAvgCost || '0'),
          bin: item.bin,
          category: item.productCategory,
        }))
        .sort((a, b) => b.extCost - a.extCost);
      
      res.json({
        truck: paddedTruck,
        totalPieces,
        totalAvgCost: totalAvgCost.toFixed(2),
        itemCount: inventory.length,
        extractDate: inventory.length > 0 ? inventory[0].extractDate : null,
        items,
      });
    } catch (error: any) {
      console.error("Error getting truck inventory summary:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Samsara GPS vehicle location lookup
  app.get("/api/samsara/vehicle/:vehicleName", requireAuth, async (req: any, res) => {
    try {
      const { vehicleName } = req.params;
      const stalenessHours = req.query.stalenessHours ? parseInt(req.query.stalenessHours as string) : 4;
      const samsaraService = getSamsaraService();
      const result = await samsaraService.getVehicleLocation(vehicleName, stalenessHours);
      
      if (result) {
        res.setHeader('X-Data-Source', result.source);
        res.json(result);
      } else {
        res.status(404).json({ found: false, message: "Vehicle location not found" });
      }
    } catch (error: any) {
      console.error("Error looking up Samsara vehicle location:", error);
      res.status(500).json({ found: false, message: error.message });
    }
  });

  // Batch lookup Samsara vehicle locations
  app.post("/api/samsara/vehicles/batch", requireAuth, async (req: any, res) => {
    try {
      const { vehicleNames } = req.body;
      if (!Array.isArray(vehicleNames)) {
        return res.status(400).json({ error: "vehicleNames must be an array" });
      }
      const samsaraService = getSamsaraService();
      const results = await samsaraService.getVehicleLocationsBatch(vehicleNames);
      
      // Determine if any came from live API for header (simplification)
      const hasLive = results.some(r => r.source === 'live');
      res.setHeader('X-Data-Source', hasLive ? 'mixed' : 'snowflake');
      
      res.json(results);
    } catch (error: any) {
      console.error("Error batch looking up Samsara vehicle locations:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Dedicated Samsara Integration Routes
  console.log("Registering Samsara integration routes...");
  
  app.get("/api/samsara/status", requireAuth, async (_req, res) => {
    const samsaraService = getSamsaraService();
    const snowflake = samsaraService.isSnowflakeAvailable();
    const liveApi = samsaraService.isLiveApiConfigured();
    res.json({
      snowflake,
      liveApi,
      groupId: process.env.SAMSARA_GROUP_ID ? 'configured' : null,
      orgId: process.env.SAMSARA_ORG_ID ? 'configured' : null,
      message: snowflake
        ? `Samsara integration active (Snowflake-first${liveApi ? ' + Live API' : ''})`
        : "Snowflake not configured for Samsara"
    });
  });

  app.get("/api/samsara/test", requireAuth, async (_req, res) => {
    try {
      const samsaraService = getSamsaraService();
      const vehicles = await samsaraService.getVehicles();
      let livePing = false;
      if (samsaraService.isLiveApiConfigured()) {
        livePing = await samsaraService.testLiveApi();
      }
      res.json({
        snowflakeVehicleCount: vehicles.length,
        liveApiPing: livePing,
        status: "ok"
      });
    } catch (error: any) {
      res.status(500).json({ status: "error", message: error.message });
    }
  });

  app.get("/api/samsara/vehicles", requireAuth, async (req, res) => {
    try {
      const filters = {
        truckNumber: req.query.truckNumber as string,
        driverId: req.query.driverId as string
      };
      const samsaraService = getSamsaraService();
      const data = await samsaraService.getVehicles(filters);
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/samsara/vehicles/by-vin/:vin", requireAuth, async (req, res) => {
    try {
      const { vin } = req.params;
      const samsaraService = getSamsaraService();
      const data = await samsaraService.getVehicles();
      const vehicle = data.find((v: any) => v.VIN === vin || v.vin === vin);
      if (!vehicle) return res.json({ found: false, vehicle: null, reason: "Vehicle not found in Samsara" });
      res.json({ found: true, vehicle });
    } catch (error: any) {
      res.json({ found: false, vehicle: null, reason: error.message });
    }
  });

  app.get("/api/samsara/vehicles/:vehicleId", requireAuth, async (req, res) => {
    try {
      const { vehicleId } = req.params;
      const samsaraService = getSamsaraService();
      // We don't have a getVehicle method in T001, so we filter the list
      const data = await samsaraService.getVehicles();
      const vehicle = data.find(v => v.VEHICLE_ID === vehicleId);
      if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });
      res.json(vehicle);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/samsara/drivers", requireAuth, async (req, res) => {
    try {
      const filters = {
        ldap: req.query.ldap as string,
        status: req.query.status as string
      };
      const samsaraService = getSamsaraService();
      const data = await samsaraService.getDrivers(filters);
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/samsara/drivers/:driverId", requireAuth, async (req, res) => {
    try {
      const { driverId } = req.params;
      const samsaraService = getSamsaraService();
      const data = await samsaraService.getDrivers();
      const driver = data.find(d => d.DRIVER_ID === driverId);
      if (!driver) return res.status(404).json({ message: "Driver not found" });
      res.json(driver);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/samsara/assignments", requireAuth, async (req, res) => {
    try {
      const samsaraService = getSamsaraService();
      const data = await samsaraService.getAssignments(
        req.query.date as string,
        req.query.vehicleId as string,
        req.query.driverId as string
      );
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/samsara/safety-scores", requireAuth, async (req, res) => {
    try {
      const samsaraService = getSamsaraService();
      const data = await samsaraService.getSafetyScores(
        req.query.driverId as string,
        req.query.startDate as string,
        req.query.endDate as string
      );
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/samsara/odometer", requireAuth, async (req, res) => {
    try {
      const samsaraService = getSamsaraService();
      const data = await samsaraService.getOdometer(req.query.vehicleId as string);
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/samsara/trips", requireAuth, async (req, res) => {
    try {
      const samsaraService = getSamsaraService();
      const data = await samsaraService.getTrips(
        req.query.vehicleId as string,
        req.query.driverId as string,
        req.query.startDate as string,
        req.query.endDate as string
      );
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/samsara/maintenance", requireAuth, async (_req, res) => {
    try {
      const samsaraService = getSamsaraService();
      const data = await samsaraService.getMaintenance();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/samsara/telematics/:vehicleNumber", requireAuth, async (req: any, res) => {
    try {
      const { vehicleNumber } = req.params;
      const samsaraService = getSamsaraService();
      const { getSnowflakeService: getSnowflake } = await import("./snowflake-service");
      const snowflake = getSnowflake();

      // Build all candidate truck number formats to maximize match chance
      const canonical = vehicleNumber.replace(/^0+/, '') || '0';
      const fiveDigit = canonical.padStart(5, '0');
      const sixDigit = canonical.padStart(6, '0');
      const candidates = [...new Set([vehicleNumber, fiveDigit, sixDigit, canonical])];

      // Find vehicle record using any of the candidate formats
      const placeholders = candidates.map(() => '?').join(', ');
      const [vehicleRows] = await Promise.allSettled([
        snowflake.executeQuery(
          `SELECT * FROM bi_analytics.app_samsara.SAMSARA_VEHICLES WHERE TRUCK_NUMBER IN (${placeholders}) LIMIT 1`,
          candidates
        )
      ]);

      const vehicle = vehicleRows.status === 'fulfilled' && (vehicleRows.value as any[]).length > 0
        ? (vehicleRows.value as any[])[0] : null;
      const vehicleId = vehicle?.VEHICLE_ID || null;
      // Use the actual TRUCK_NUMBER that matched so location lookups use the same format
      const resolvedTruckNumber = vehicle?.TRUCK_NUMBER || vehicleNumber;

      console.log(`[Samsara Telematics] Resolving vehicle ${vehicleNumber} → candidates: [${candidates.join(', ')}] → found: ${resolvedTruckNumber || 'none'}`);

      const vehicleVin = vehicle?.VIN || null;

      const [locationResult, odometerResult, maintenanceResult, fuelResult, streamResult, criticalityResult] = await Promise.allSettled([
        samsaraService.getVehicleLocation(resolvedTruckNumber, 9999),
        // SAMSARA_ODOMETER is keyed by VIN
        vehicleVin ? snowflake.executeQuery(
          `SELECT * FROM bi_analytics.app_samsara.SAMSARA_ODOMETER WHERE VIN = ? ORDER BY OBD_TIME DESC LIMIT 1`,
          [vehicleVin]
        ) : Promise.resolve([]),
        // SAMSARA_MAINTENANCE is keyed by MAINT_ID = Samsara Vehicle ID.
        // Fetch all DTC rows from the most recent daily load for this vehicle.
        vehicleId ? snowflake.executeQuery(
          `SELECT DTC_SHORT_CODE, DTC_DESCRIPTION, DTC_ID,
                  J1939_CHECKENGINELIGHT_STOPISON, J1939_CHECKENGINELIGHT_PROTECTISON,
                  J1939_CHECKENGINELIGHT_WARNINGISON, J1939_CHECKENGINELIGHT_EMISSIONSISON,
                  J1939_DIAGNOSTICTROUBLECODES, LOAD_TS_UTC
           FROM bi_analytics.app_samsara.SAMSARA_MAINTENANCE
           WHERE MAINT_ID = ?
             AND LOAD_TS_UTC >= DATEADD(day, -2,
               (SELECT MAX(LOAD_TS_UTC) FROM bi_analytics.app_samsara.SAMSARA_MAINTENANCE WHERE MAINT_ID = ?))
           ORDER BY LOAD_TS_UTC DESC`,
          [vehicleId, vehicleId]
        ) : Promise.resolve([]),
        vehicleId ? snowflake.executeQuery(
          `SELECT * FROM bi_analytics.app_samsara.SAMSARA_FUEL_ENERGY_DAILY WHERE VEHICLE_ID = ? ORDER BY RUN_DATE_UTC DESC LIMIT 7`,
          [vehicleId]
        ) : Promise.resolve([]),
        snowflake.executeQuery(
          `SELECT * FROM bi_analytics.app_samsara.SAMSARA_STREAM WHERE VEHICLE_NAME IN (${placeholders}) ORDER BY TIME DESC LIMIT 1`,
          candidates
        ),
        // SAMSARA_CRITICALITY_SCORE: pre-computed severity triage for this vehicle
        resolvedTruckNumber ? snowflake.executeQuery(
          `SELECT SEVERITY_SCORE, SEVERITY_LABEL, RECOMMENDED_ACTION, DTC_COUNT_DISTINCT, LAMP_BASE,
                  J1939_DIAGNOSTICTROUBLECODES, DTC_SHORT_CODE, DTC_DESCRIPTION, MAINT_LOAD_TS_UTC
           FROM PARTS_SUPPLYCHAIN.FLEET.SAMSARA_CRITICALITY_SCORE
           WHERE TRUCK_NUMBER = ? LIMIT 1`,
          [resolvedTruckNumber]
        ) : Promise.resolve([]),
      ]);

      // SAMSARA_MAINTENANCE rows — deduplicate by DTC_SHORT_CODE (latest load wins)
      const rawMaintRows = maintenanceResult.status === 'fulfilled' ? maintenanceResult.value as any[] : [];
      const seenCodes = new Set<string>();
      const maintenance = rawMaintRows.filter((m: any) => {
        const code = m.DTC_SHORT_CODE || m.J1939_DIAGNOSTICTROUBLECODES || '';
        if (seenCodes.has(code)) return false;
        seenCodes.add(code);
        return true;
      }).map((m: any) => ({
        MAINT_ID: m.DTC_SHORT_CODE || m.DTC_ID,
        VEHICLE_ID: String(vehicleId),
        DTC_ID: m.DTC_SHORT_CODE,
        DTC_DESCRIPTION: m.DTC_DESCRIPTION,
        J1939_STATUS: m.J1939_CHECKENGINELIGHT_STOPISON ? 'Stop' :
                      m.J1939_CHECKENGINELIGHT_PROTECTISON ? 'Protect' :
                      m.J1939_CHECKENGINELIGHT_WARNINGISON ? 'Warning' :
                      m.J1939_CHECKENGINELIGHT_EMISSIONSISON ? 'Emissions' : null,
      }));
      console.log(`[Samsara Telematics] Fault codes for ${vehicleNumber}: ${maintenance.length} codes from SAMSARA_MAINTENANCE (MAINT_ID=${vehicleId})`);

      const critRows = criticalityResult.status === 'fulfilled' ? criticalityResult.value as any[] : [];
      const criticality = critRows.length > 0 ? critRows[0] : null;

      res.json({
        vehicle,
        vehicleId,
        resolvedTruckNumber,
        location: locationResult.status === 'fulfilled' ? locationResult.value : null,
        odometer: odometerResult.status === 'fulfilled' ? (odometerResult.value as any[])[0] || null : null,
        maintenance,
        fuel: fuelResult.status === 'fulfilled' ? fuelResult.value : [],
        stream: streamResult.status === 'fulfilled' && (streamResult.value as any[]).length > 0
          ? (streamResult.value as any[])[0] : null,
        criticality,
      });
    } catch (error: any) {
      console.error('[Samsara Telematics] Error:', error);
      res.status(500).json({ message: error.message });
    }
  });

  // Returns truck numbers with active DTCs — sourced from PARTS_SUPPLYCHAIN.FLEET.SAMSARA_CRITICALITY_SCORE
  // Much faster than paginating the live Samsara API; data is refreshed daily via Snowflake pipeline
  app.get("/api/samsara/dtc-vehicles", requireAuth, async (req, res) => {
    try {
      const { getSnowflakeService: getSF } = await import("./snowflake-service");
      const sf = getSF();
      const rows = await sf.executeQuery(
        `SELECT TRUCK_NUMBER, SEVERITY_SCORE, SEVERITY_LABEL, DTC_COUNT_DISTINCT
         FROM PARTS_SUPPLYCHAIN.FLEET.SAMSARA_CRITICALITY_SCORE
         WHERE DTC_COUNT_DISTINCT > 0
           AND (SEVERITY_LABEL IS NULL OR SEVERITY_LABEL != 'CLEAR')
         ORDER BY SEVERITY_SCORE DESC`
      );
      const vehicles = (rows as any[]).map((r: any) => ({
        truckNumber: r.TRUCK_NUMBER,
        severityScore: r.SEVERITY_SCORE,
        severityLabel: r.SEVERITY_LABEL,
      }));
      const truckNumbers = vehicles.map((v: any) => v.truckNumber).filter(Boolean);
      console.log(`[Samsara DTC Vehicles] ${truckNumbers.length} vehicles with active DTCs (from Snowflake)`);
      res.json({ truckNumbers, vehicles });
    } catch (error: any) {
      console.error('[Samsara DTC Vehicles] Error:', error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/samsara/fuel", requireAuth, async (req, res) => {
    try {
      const samsaraService = getSamsaraService();
      const data = await samsaraService.getFuelEnergy(
        req.query.vehicleId as string,
        req.query.startDate as string,
        req.query.endDate as string
      );
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/samsara/safety-events", requireAuth, async (req, res) => {
    try {
      const samsaraService = getSamsaraService();
      const data = await samsaraService.getSafetyEvents(
        req.query.vehicleId as string,
        req.query.driverId as string,
        req.query.startDate as string,
        req.query.endDate as string
      );
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/samsara/speeding", requireAuth, async (req, res) => {
    try {
      const samsaraService = getSamsaraService();
      const data = await samsaraService.getSpeedingEvents(
        req.query.vehicleId as string,
        req.query.startDate as string,
        req.query.endDate as string
      );
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/samsara/idling", requireAuth, async (req, res) => {
    try {
      const samsaraService = getSamsaraService();
      const data = await samsaraService.getIdlingEvents(
        req.query.vehicleId as string,
        req.query.startDate as string,
        req.query.endDate as string
      );
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/samsara/devices", requireAuth, async (_req, res) => {
    try {
      const samsaraService = getSamsaraService();
      const data = await samsaraService.getDevices();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/samsara/gateways", requireAuth, async (_req, res) => {
    try {
      const samsaraService = getSamsaraService();
      const data = await samsaraService.getGateways();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/samsara/drivers", requireAuth, async (req, res) => {
    try {
      const samsaraService = getSamsaraService();
      if (!samsaraService.isLiveApiConfigured()) {
        return res.status(503).json({ message: "Samsara Live API not configured" });
      }
      const data = await samsaraService.liveCreateDriver(req.body);
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/samsara/drivers/:driverId", requireAuth, async (req, res) => {
    try {
      const { driverId } = req.params;
      const samsaraService = getSamsaraService();
      if (!samsaraService.isLiveApiConfigured()) {
        return res.status(503).json({ message: "Samsara Live API not configured" });
      }
      const data = await samsaraService.liveUpdateDriver(driverId, req.body);
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Live API passthrough routes — fetch directly from Samsara (all pages)
  app.get("/api/samsara/live/vehicles", requireAuth, async (_req, res) => {
    try {
      const samsaraService = getSamsaraService();
      if (!samsaraService.isLiveApiConfigured()) {
        return res.status(503).json({ message: "Samsara Live API not configured" });
      }
      const data = await samsaraService.liveGetVehicles();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/samsara/live/locations", requireAuth, async (_req, res) => {
    try {
      const samsaraService = getSamsaraService();
      if (!samsaraService.isLiveApiConfigured()) {
        return res.status(503).json({ message: "Samsara Live API not configured" });
      }
      const data = await samsaraService.liveGetVehicleLocations();
      res.set('X-Data-Source', 'live');
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/samsara/live/drivers", requireAuth, async (_req, res) => {
    try {
      const samsaraService = getSamsaraService();
      if (!samsaraService.isLiveApiConfigured()) {
        return res.status(503).json({ message: "Samsara Live API not configured" });
      }
      const data = await samsaraService.liveGetAllDrivers();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/snowflake/separation-ids", requireAuth, async (req: any, res) => {
    try {
      const snowflakeService = getSnowflakeService();
      const query = `
        SELECT DISTINCT UPPER(LDAP_ID) as LDAP_ID, UPPER(EMPLID) as EMPLID
        FROM PRD_TECH_RECRUITMENT.FLEET_DETAILS.SEPARATION_FLEET_DETAILS
        WHERE (LDAP_ID IS NOT NULL AND LDAP_ID != '') OR (EMPLID IS NOT NULL AND EMPLID != '')
      `;
      const rows = await snowflakeService.executeQuery(query) as Array<{ LDAP_ID: string; EMPLID: string }>;
      const idSet = new Set<string>();
      for (const r of rows) {
        if (r.LDAP_ID) idSet.add(r.LDAP_ID);
        if (r.EMPLID) idSet.add(r.EMPLID);
      }
      const ids = Array.from(idSet);
      console.log(`[Separation IDs] Returned ${ids.length} unique IDs from SEPARATION_FLEET_DETAILS`);
      res.json(ids);
    } catch (error: any) {
      console.error("Error fetching separation IDs:", error.message);
      res.status(500).json({ message: error.message });
    }
  });

  // Get tech addresses from Snowflake TPMS data
  app.get("/api/snowflake/tech-addresses/:enterpriseId", requireAuth, async (req: any, res) => {
    const startTime = Date.now();
    try {
      const { enterpriseId } = req.params;
      console.log(`[TPMS-Addresses] Starting lookup for: ${enterpriseId}`);
      const syncService = getSnowflakeSyncService();
      const result = await syncService.getTechAddressesFromSnowflake(enterpriseId.toUpperCase());
      const duration = Date.now() - startTime;
      console.log(`[TPMS-Addresses] Completed in ${duration}ms - success: ${result.success}, truck: ${result.truckNo || 'none'}`);
      res.json(result);
    } catch (error: any) {
      const duration = Date.now() - startTime;
      console.error(`[TPMS-Addresses] Error after ${duration}ms:`, error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Weekly Offboarding - Get term roster from Snowflake view with contact info
  app.get("/api/weekly-offboarding", requireAuth, async (req: any, res) => {
    try {
      const snowflakeService = getSnowflakeService();
      
      // Join term roster with contact info view and TPMS for truck info
      // Filter by LAST_DATE_WORKED >= 2026-01-01
      // Exclude records where the truck is still actively assigned in TPMS_EXTRACT
      const query = `
        WITH active_trucks AS (
          SELECT DISTINCT TRUCK_LU
          FROM PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT
          WHERE TRUCK_LU IS NOT NULL
        )
        SELECT 
          t.EMPL_NAME,
          t.ENTERPRISE_ID,
          t.EMPLID,
          t.EMPL_STATUS,
          t.EFFDT,
          t.LAST_DATE_WORKED,
          t.PLANNING_AREA,
          t.TECH_SPECIALTY,
          c.SNSTV_HOME_ADDR1,
          c.SNSTV_HOME_ADDR2,
          c.SNSTV_HOME_CITY,
          c.SNSTV_HOME_STATE,
          c.SNSTV_HOME_POSTAL,
          c.SNSTV_MAIN_PHONE,
          c.SNSTV_CELL_PHONE,
          c.SNSTV_HOME_PHONE,
          -- Informational-only: last snapshot truck from TPMS_EXTRACT_LAST_ASSIGNED, not current assignment
          tpms.TRUCK_LU AS LAST_KNOWN_TRUCK_LU,
          tpms.FILE_DATE AS LAST_KNOWN_TRUCK_FILE_DATE
        FROM PRD_TECH_RECRUITMENT.BATCH_VIEWS.ORA_TECH_TERM_ROSTER_VW_VIEW t
        LEFT JOIN PRD_TECH_RECRUITMENT.BATCH_VIEWS.ORA_TECH_LAST_KNOWN_CONTACT_VW_VIEW c
          ON t.EMPLID = c.EMPLID
        LEFT JOIN PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT_LAST_ASSIGNED tpms
          ON UPPER(t.ENTERPRISE_ID) = UPPER(tpms.ENTERPRISE_ID)
        LEFT JOIN active_trucks at
          ON tpms.TRUCK_LU = at.TRUCK_LU
        WHERE t.LAST_DATE_WORKED >= '2026-01-01'
          AND (tpms.TRUCK_LU IS NULL OR at.TRUCK_LU IS NULL)
        ORDER BY t.LAST_DATE_WORKED DESC
      `;
      
      const rows = await snowflakeService.executeQuery(query) as Array<{
        EMPL_NAME: string;
        ENTERPRISE_ID: string;
        EMPLID: string;
        EMPL_STATUS: string;
        EFFDT: string;
        LAST_DATE_WORKED: string;
        PLANNING_AREA: string;
        TECH_SPECIALTY: string;
        SNSTV_HOME_ADDR1: string;
        SNSTV_HOME_ADDR2: string;
        SNSTV_HOME_CITY: string;
        SNSTV_HOME_STATE: string;
        SNSTV_HOME_POSTAL: string;
        SNSTV_MAIN_PHONE: string;
        SNSTV_CELL_PHONE: string;
        SNSTV_HOME_PHONE: string;
        LAST_KNOWN_TRUCK_LU: string;
        LAST_KNOWN_TRUCK_FILE_DATE: string;
      }>;
      
      // Format phone number to (xxx)xxx-xxxx format
      const formatPhone = (phone: string | null | undefined): string | null => {
        if (!phone) return null;
        // Remove all non-digit characters
        const digits = phone.replace(/\D/g, '');
        // Handle 10-digit US phone numbers
        if (digits.length === 10) {
          return `(${digits.slice(0, 3)})${digits.slice(3, 6)}-${digits.slice(6)}`;
        }
        // Handle 11-digit with leading 1
        if (digits.length === 11 && digits[0] === '1') {
          return `(${digits.slice(1, 4)})${digits.slice(4, 7)}-${digits.slice(7)}`;
        }
        // Return original if not standard format
        return phone;
      };
      
      // Planning Area to Owner mapping (first 4 digits)
      const planningAreaOwnerMap: Record<string, string> = {
        '3132': 'Rob & Andrea',
        '3580': 'Monica, Cheryl & Machell',
        '4766': 'Rob & Andrea',
        '6141': 'Monica, Cheryl & Machell',
        '7084': 'Rob & Andrea',
        '7088': 'Carol & Tasha',
        '7108': 'Carol & Tasha',
        '7323': 'Monica, Cheryl & Machell',
        '7435': 'Rob & Andrea',
        '7670': 'Rob & Andrea',
        '7744': 'Rob & Andrea',
        '7983': 'Rob & Andrea',
        '7995': 'Carol & Tasha',
        '8035': 'Rob & Andrea',
        '8096': 'Monica, Cheryl & Machell',
        '8107': 'Carol & Tasha',
        '8147': 'Carol & Tasha',
        '8158': 'Carol & Tasha',
        '8162': 'Monica, Cheryl & Machell',
        '8169': 'Carol & Tasha',
        '8175': 'Rob & Andrea',
        '8184': 'Carol & Tasha',
        '8206': 'Monica, Cheryl & Machell',
        '8220': 'Monica, Cheryl & Machell',
        '8228': 'Carol & Tasha',
        '8309': 'Monica, Cheryl & Machell',
        '8366': 'Carol & Tasha',
        '8380': 'Rob & Andrea',
        '8420': 'Monica, Cheryl & Machell',
        '8555': 'Monica, Cheryl & Machell',
        '8935': 'Monica, Cheryl & Machell',
      };
      
      // Get owner from planning area (first 4 digits)
      const getOwner = (planningArea: string | null | undefined): string => {
        if (!planningArea) return 'Unknown';
        const code = planningArea.replace(/\D/g, '').slice(0, 4);
        return planningAreaOwnerMap[code] || 'Unknown';
      };
      
      const formattedData = rows.map(row => {
        const addressParts = [
          row.SNSTV_HOME_ADDR1,
          row.SNSTV_HOME_ADDR2,
          row.SNSTV_HOME_CITY,
          row.SNSTV_HOME_STATE,
          row.SNSTV_HOME_POSTAL
        ].filter(Boolean);
        const address = addressParts.join(', ');
        
        const phoneParts = [
          formatPhone(row.SNSTV_MAIN_PHONE),
          formatPhone(row.SNSTV_CELL_PHONE),
          formatPhone(row.SNSTV_HOME_PHONE)
        ].filter(Boolean);
        const contactPhone = phoneParts.join(' / ');
        
        const emplStatus = row.EMPL_STATUS || '';
        return {
          emplName: row.EMPL_NAME || '',
          enterpriseId: row.ENTERPRISE_ID || '',
          emplId: row.EMPLID || '',
          emplStatus,
          effdt: row.EFFDT || '',
          lastDateWorked: row.LAST_DATE_WORKED || '',
          planningArea: row.PLANNING_AREA || '',
          techSpecialty: row.TECH_SPECIALTY || '',
          address: address,
          contactPhone: contactPhone,
          owner: getOwner(row.PLANNING_AREA),
          lastKnownTruckLu: row.LAST_KNOWN_TRUCK_LU || '',
          lastKnownTruckFileDate: row.LAST_KNOWN_TRUCK_FILE_DATE || null,
          // Explicit active-status indicator: 'inactive' for termed/separated employees
          // lastKnownTruckLu is from TPMS_EXTRACT_LAST_ASSIGNED snapshot and may be stale.
          techActiveStatus: (emplStatus === 'A' || emplStatus === 'ACTIVE') ? 'active' as const : 'inactive' as const,
          source: 'term_roster' as string,
        };
      });

      // Collect existing enterprise IDs and employee IDs from main roster (uppercase for comparison)
      const existingEnterpriseIds = new Set<string>();
      for (const r of formattedData) {
        if (r.enterpriseId) existingEnterpriseIds.add(r.enterpriseId.toUpperCase());
        if (r.emplId) existingEnterpriseIds.add(r.emplId.toUpperCase());
      }

      // Query SEPARATION_FLEET_DETAILS for additional records not in main roster
      // Enrich with contact info and tech specialty from the roster/contact views
      let separationRecords: typeof formattedData = [];
      try {
        const sepQuery = `
          SELECT 
            s.LDAP_ID,
            s.TECHNICIAN_NAME,
            s.EMPLID,
            s.PLANNING_AREA,
            s.LAST_DAY,
            s.EFFECTIVE_SEPARATION_DATE,
            s.TRUCK_NUMBER,
            s.CONTACT_NUMBER,
            s.FLEET_PICKUP_ADDRESS,
            c.SNSTV_HOME_ADDR1,
            c.SNSTV_HOME_ADDR2,
            c.SNSTV_HOME_CITY,
            c.SNSTV_HOME_STATE,
            c.SNSTV_HOME_POSTAL,
            c.SNSTV_MAIN_PHONE,
            c.SNSTV_CELL_PHONE,
            c.SNSTV_HOME_PHONE,
            r.TECH_SPECIALTY
          FROM PRD_TECH_RECRUITMENT.FLEET_DETAILS.SEPARATION_FLEET_DETAILS s
          LEFT JOIN PRD_TECH_RECRUITMENT.BATCH_VIEWS.ORA_TECH_LAST_KNOWN_CONTACT_VW_VIEW c
            ON s.EMPLID = c.EMPLID
          LEFT JOIN PRD_TECH_RECRUITMENT.BATCH_VIEWS.ORA_TECH_TERM_ROSTER_VW_VIEW r
            ON s.EMPLID = r.EMPLID
          WHERE (s.LAST_DAY >= '2026-01-01' OR s.EFFECTIVE_SEPARATION_DATE >= '2026-01-01')
          ORDER BY COALESCE(s.LAST_DAY, s.EFFECTIVE_SEPARATION_DATE) DESC NULLS LAST
        `;

        const sepRows = await snowflakeService.executeQuery(sepQuery) as Array<{
          LDAP_ID: string;
          TECHNICIAN_NAME: string | null;
          EMPLID: string;
          PLANNING_AREA: string | null;
          LAST_DAY: string | null;
          EFFECTIVE_SEPARATION_DATE: string | null;
          TRUCK_NUMBER: string | null;
          CONTACT_NUMBER: string | null;
          FLEET_PICKUP_ADDRESS: string | null;
          SNSTV_HOME_ADDR1: string | null;
          SNSTV_HOME_ADDR2: string | null;
          SNSTV_HOME_CITY: string | null;
          SNSTV_HOME_STATE: string | null;
          SNSTV_HOME_POSTAL: string | null;
          SNSTV_MAIN_PHONE: string | null;
          SNSTV_CELL_PHONE: string | null;
          SNSTV_HOME_PHONE: string | null;
          TECH_SPECIALTY: string | null;
        }>;

        console.log(`[Weekly Offboarding] Found ${sepRows.length} total separation records, filtering out duplicates...`);

        for (const row of sepRows) {
          const ldap = (row.LDAP_ID || '').toUpperCase();
          const emplId = (row.EMPLID || '').toUpperCase();
          if (!ldap && !emplId) continue;
          if (ldap && existingEnterpriseIds.has(ldap)) continue;
          if (!ldap && emplId && existingEnterpriseIds.has(emplId)) continue;

          if (ldap) existingEnterpriseIds.add(ldap);
          if (emplId) existingEnterpriseIds.add(emplId);

          const homeAddrParts = [
            row.SNSTV_HOME_ADDR1,
            row.SNSTV_HOME_ADDR2,
            row.SNSTV_HOME_CITY,
            row.SNSTV_HOME_STATE,
            row.SNSTV_HOME_POSTAL,
          ].filter(Boolean);
          const homeAddress = homeAddrParts.join(', ');
          const address = row.FLEET_PICKUP_ADDRESS || homeAddress;

          const phoneParts = [
            formatPhone(row.CONTACT_NUMBER),
            formatPhone(row.SNSTV_MAIN_PHONE),
            formatPhone(row.SNSTV_CELL_PHONE),
            formatPhone(row.SNSTV_HOME_PHONE)
          ].filter(Boolean);
          const uniquePhones = Array.from(new Set(phoneParts));
          const contactPhone = uniquePhones.join(' / ');

          separationRecords.push({
            emplName: row.TECHNICIAN_NAME || '',
            enterpriseId: row.LDAP_ID || '',
            emplId: row.EMPLID || '',
            emplStatus: 'T',
            effdt: row.EFFECTIVE_SEPARATION_DATE || '',
            lastDateWorked: row.LAST_DAY || '',
            planningArea: row.PLANNING_AREA || '',
            techSpecialty: row.TECH_SPECIALTY || '',
            address: address,
            contactPhone: contactPhone,
            owner: getOwner(row.PLANNING_AREA),
            lastKnownTruckLu: row.TRUCK_NUMBER || '',
            lastKnownTruckFileDate: null,
            // Separation records are always inactive — they've already been terminated
            techActiveStatus: 'inactive' as const,
            source: 'separation' as string,
          });
        }

        console.log(`[Weekly Offboarding] Added ${separationRecords.length} new records from separation table`);
      } catch (sepError: any) {
        console.error('[Weekly Offboarding] Error fetching separation records (continuing with main roster only):', sepError.message);
      }

      const allData = [...formattedData, ...separationRecords];
      res.json(allData);
    } catch (error: any) {
      console.error("Error fetching weekly offboarding data:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ── Weekly Offboarding name-set ─────────────────────────────────────────────
  // Returns parsed employee names AND enterprise IDs from the Oracle term roster
  // so consumers can match by either name (Fleet Scope T badge) or enterprise ID
  // (Rental Operations T badge). Cached 30 min.
  let woNameSetCache: { ts: number; data: any } | null = null;
  const WO_NAME_CACHE_TTL_MS = 30 * 60 * 1000;

  app.get("/api/weekly-offboarding/name-set", requireAuth, async (req: any, res) => {
    try {
      // Bust stale cache that predates the enterpriseIds field (shape migration guard)
      if (woNameSetCache && !woNameSetCache.data?.enterpriseIds) {
        woNameSetCache = null;
      }
      if (woNameSetCache && Date.now() - woNameSetCache.ts < WO_NAME_CACHE_TTL_MS) {
        return res.json(woNameSetCache.data);
      }
      const snowflakeService = getSnowflakeService();
      const rows = await snowflakeService.executeQuery(
        `SELECT DISTINCT EMPL_NAME, ENTERPRISE_ID
         FROM PRD_TECH_RECRUITMENT.BATCH_VIEWS.ORA_TECH_TERM_ROSTER_VW_VIEW
         WHERE LAST_DATE_WORKED >= '2026-01-01'
           AND EMPL_NAME IS NOT NULL`
      ) as any[];
      // rentalNameParse is declared later in this file but hoisted to the top
      // of the registerRoutes function scope, so it is safely callable here.
      // Build names from unique EMPL_NAME values (same semantics as prior DISTINCT EMPL_NAME query)
      const namesSeen = new Set<string>();
      const names: Array<{ raw: string; last: string; first: string }> = [];
      const eidSet = new Set<string>();
      for (const r of rows) {
        const raw = (r.EMPL_NAME || '').trim();
        const eid = (r.ENTERPRISE_ID || '').trim().toUpperCase();
        if (eid) eidSet.add(eid);
        if (raw && !namesSeen.has(raw)) {
          namesSeen.add(raw);
          const { first, last } = rentalNameParse(raw);
          if (last) names.push({ raw, last, first });
        }
      }
      const enterpriseIds = Array.from(eidSet);
      const data = { names, enterpriseIds };
      woNameSetCache = { ts: Date.now(), data };
      res.json(data);
    } catch (error: any) {
      console.error('[WO name-set] Error fetching offboarding name set:', error.message);
      res.status(500).json({ message: error.message });
    }
  });

  // HR Tech Status - returns map of Enterprise ID → EMPL_STATUS for L/P/S statuses only
  // Used by Rental Ops Open Rentals to show Leave/Paid-Leave/Suspended badges next to tech names
  app.get("/api/hr/tech-status", requireAuth, async (_req: any, res) => {
    try {
      const snowflakeService = getSnowflakeService();
      const rows = await snowflakeService.executeQuery(
        `SELECT ENTERPRISE_ID, EMPL_STATUS
         FROM IT_ANALYTICS.HR_REPORTING_TECH_NON_SENSITIVE.NS_TECH_ACTIVE_ROSTER_DAILY_VW
         WHERE EMPL_STATUS IN ('L', 'P', 'S')
           AND ENTERPRISE_ID IS NOT NULL`
      ) as Array<{ ENTERPRISE_ID: string; EMPL_STATUS: string }>;
      const statusMap: Record<string, string> = {};
      for (const row of rows) {
        const eid = (row.ENTERPRISE_ID || '').trim().toUpperCase();
        if (eid) statusMap[eid] = row.EMPL_STATUS;
      }
      res.json(statusMap);
    } catch (error: any) {
      console.error('[HR tech-status] Error fetching HR tech status:', error.message);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/loa-trucks-to-recover", requireAuth, async (req: any, res) => {
    try {
      const snowflakeService = getSnowflakeService();

      const query = `
        SELECT
          t.FULL_NAME,
          t.ENTERPRISE_ID,
          t.EMPLOYMENT_STATUS,
          t.JOB_TITLE,
          t.DISTRICT_NO,
          t.PLANNING_AREA_NM,
          t.EFFDT,
          t.DATE_LAST_WORKED,
          COALESCE(tpms.MOBILEPHONENUMBER, tpms_last.MOBILEPHONENUMBER) AS MOBILEPHONENUMBER,
          COALESCE(tpms.PRIMARYADDR1, tpms_last.PRIMARYADDR1) AS PRIMARYADDR1,
          COALESCE(tpms.PRIMARYADDR2, tpms_last.PRIMARYADDR2) AS PRIMARYADDR2,
          COALESCE(tpms.PRIMARYCITY, tpms_last.PRIMARYCITY) AS PRIMARYCITY,
          COALESCE(tpms.PRIMARYSTATE, tpms_last.PRIMARYSTATE) AS PRIMARYSTATE,
          COALESCE(tpms.PRIMARYZIP, tpms_last.PRIMARYZIP) AS PRIMARYZIP,
          COALESCE(tpms.TRUCK_LU, tpms_last.TRUCK_LU) AS TRUCK_LU,
          CASE
            WHEN tpms.ENTERPRISE_ID IS NOT NULL THEN 'TPMS_EXTRACT'
            WHEN tpms_last.ENTERPRISE_ID IS NOT NULL THEN 'TPMS_EXTRACT_LAST_ASSIGNED'
            ELSE NULL
          END AS TPMS_SOURCE,
          c.SNSTV_MAIN_PHONE,
          c.SNSTV_HOME_PHONE,
          c.SNSTV_CELL_PHONE
        FROM PARTS_SUPPLYCHAIN.FLEET.DRIVELINE_ALL_TECHS t
        LEFT JOIN PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT tpms
          ON UPPER(TRIM(t.ENTERPRISE_ID)) = UPPER(TRIM(tpms.ENTERPRISE_ID))
        LEFT JOIN PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT_LAST_ASSIGNED tpms_last
          ON UPPER(TRIM(t.ENTERPRISE_ID)) = UPPER(TRIM(tpms_last.ENTERPRISE_ID))
        LEFT JOIN PRD_TECH_RECRUITMENT.BATCH_VIEWS.ORA_TECH_LAST_KNOWN_CONTACT_VW_VIEW c
          ON t.EMPL_ID = c.EMPLID
        WHERE t.EMPLOYMENT_STATUS IN ('L', 'P', 'S')
        ORDER BY t.EMPLOYMENT_STATUS, t.FULL_NAME
      `;

      const rows = await snowflakeService.executeQuery(query) as Array<{
        FULL_NAME: string | null;
        ENTERPRISE_ID: string | null;
        EMPLOYMENT_STATUS: string | null;
        JOB_TITLE: string | null;
        DISTRICT_NO: string | null;
        PLANNING_AREA_NM: string | null;
        EFFDT: string | null;
        DATE_LAST_WORKED: string | null;
        MOBILEPHONENUMBER: string | number | null;
        PRIMARYADDR1: string | null;
        PRIMARYADDR2: string | null;
        PRIMARYCITY: string | null;
        PRIMARYSTATE: string | null;
        PRIMARYZIP: string | null;
        TRUCK_LU: string | null;
        TPMS_SOURCE: string | null;
        SNSTV_MAIN_PHONE: string | number | null;
        SNSTV_HOME_PHONE: string | number | null;
        SNSTV_CELL_PHONE: string | number | null;
      }>;

      console.log(`[LOA Trucks] Query returned ${rows.length} rows, sample:`, rows.length > 0 ? JSON.stringify({
        name: rows[0].FULL_NAME,
        eid: rows[0].ENTERPRISE_ID,
        status: rows[0].EMPLOYMENT_STATUS,
        phone: rows[0].MOBILEPHONENUMBER,
        addr1: rows[0].PRIMARYADDR1,
        truck: rows[0].TRUCK_LU,
        source: rows[0].TPMS_SOURCE,
        mainPhone: rows[0].SNSTV_MAIN_PHONE,
        homePhone: rows[0].SNSTV_HOME_PHONE,
        cellPhone: rows[0].SNSTV_CELL_PHONE,
      }) : 'no rows');

      const statusLabels: Record<string, string> = {
        'L': 'Leave of Absence',
        'P': 'Paid Leave',
        'S': 'Suspended',
      };

      const formatPhone = (phone: string | number | null | undefined): string | null => {
        if (!phone) return null;
        const digits = String(phone).replace(/\D/g, '');
        if (digits.length === 10) {
          return `(${digits.slice(0, 3)})${digits.slice(3, 6)}-${digits.slice(6)}`;
        }
        if (digits.length === 11 && digits[0] === '1') {
          return `(${digits.slice(1, 4)})${digits.slice(4, 7)}-${digits.slice(7)}`;
        }
        return String(phone);
      };

      const deduped = new Map<string, (typeof rows)[0]>();
      for (const row of rows) {
        const key = (row.ENTERPRISE_ID || '').trim().toUpperCase();
        if (key && !deduped.has(key)) {
          deduped.set(key, row);
        }
      }

      const dedupedValues = Array.from(deduped.values());
      const ldaps = dedupedValues
        .map(r => (r.ENTERPRISE_ID || '').trim().toUpperCase())
        .filter(Boolean);

      let profitMap = new Map<string, { dailyProfit: number; completes: number; totalRevenue: number }>();
      try {
        if (ldaps.length > 0) {
          const profRows = await fetchProfitabilityCheck(ldaps);
          for (const p of profRows) {
            if (p.tech_ldap) {
              profitMap.set(p.tech_ldap.toUpperCase(), {
                dailyProfit: Number(p.daily_net_before_rental) || 0,
                completes: Number(p.completes) || 0,
                totalRevenue: Number(p.total_revenue) || 0,
              });
            }
          }
          console.log(`[LOA Trucks] Profitability data loaded for ${profitMap.size} of ${ldaps.length} techs`);
        }
      } catch (profErr: any) {
        console.error('[LOA Trucks] Profitability lookup failed (non-fatal):', profErr.message);
      }

      const formatted = dedupedValues.map(row => {
        const addressParts = [
          row.PRIMARYADDR1?.trim(),
          row.PRIMARYADDR2?.trim(),
          row.PRIMARYCITY?.trim(),
          row.PRIMARYSTATE?.trim(),
          row.PRIMARYZIP?.trim(),
        ].filter(Boolean);

        const personalPhones = [
          formatPhone(row.SNSTV_MAIN_PHONE),
          formatPhone(row.SNSTV_CELL_PHONE),
          formatPhone(row.SNSTV_HOME_PHONE),
        ].filter(Boolean);
        const uniquePersonalPhones = [...new Set(personalPhones)];

        const eid = (row.ENTERPRISE_ID || '').trim().toUpperCase();
        const prof = profitMap.get(eid);

        return {
          fullName: row.FULL_NAME?.trim() || '',
          enterpriseId: eid,
          employmentStatus: row.EMPLOYMENT_STATUS?.trim() || '',
          employmentStatusLabel: statusLabels[row.EMPLOYMENT_STATUS?.trim() || ''] || row.EMPLOYMENT_STATUS?.trim() || '',
          jobTitle: row.JOB_TITLE?.trim() || '',
          district: row.DISTRICT_NO?.trim()?.replace(/^0+/, '') || '',
          planningArea: row.PLANNING_AREA_NM?.trim() || '',
          effectiveDate: row.EFFDT || '',
          lastDateWorked: row.DATE_LAST_WORKED || '',
          tpmsPhone: formatPhone(row.MOBILEPHONENUMBER),
          tpmsAddress: addressParts.join(', '),
          lastKnownTruck: row.TRUCK_LU?.trim() || '',
          tpmsSource: row.TPMS_SOURCE || '',
          personalNumber: uniquePersonalPhones.join(' / ') || null,
          dailyProfit: prof?.dailyProfit ?? null,
          completes90d: prof?.completes ?? null,
          totalRevenue90d: prof?.totalRevenue ?? null,
        };
      });

      res.json(formatted);
    } catch (error: any) {
      console.error('[LOA Trucks] Error fetching LOA/Paid Leave/Suspended techs:', error.message);
      res.status(500).json({ message: error.message });
    }
  });

  // Weekly Offboarding - Sync/Refresh (same as GET but for POST compatibility)
  app.post("/api/snowflake/sync/weekly-offboarding", requireAuth, async (req: any, res) => {
    try {
      res.json({ success: true, message: "Term roster refreshed from Snowflake" });
    } catch (error: any) {
      console.error("Error syncing weekly offboarding:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Get termed techs list (now sourced from unified all_techs table by filtering on effectiveDate)
  app.get("/api/termed-techs", requireAuth, async (req: any, res) => {
    try {
      const daysBack = parseInt(req.query.daysBack as string) || 30;
      const techs = await storage.getTermedEmployeesFromRoster(daysBack);
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

  // Look up a termed tech by employee ID (for auto-filling dates) - now uses unified all_techs table
  app.get("/api/termed-techs/lookup/:employeeId", requireAuth, async (req: any, res) => {
    try {
      const { employeeId } = req.params;
      // Look up from all_techs table which now has effectiveDate and lastDayWorked fields
      const tech = await storage.getAllTechByEmployeeId(employeeId);
      
      if (tech && tech.effectiveDate) {
        res.json({
          found: true,
          effectiveDate: tech.effectiveDate,
          lastDayWorked: tech.lastDayWorked,
          techName: tech.techName,
          techRacfid: tech.techRacfid,
          employmentStatus: tech.employmentStatus,
        });
      } else {
        res.json({ found: false });
      }
    } catch (error: any) {
      console.error("Error looking up termed tech:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Look up an employee from the all_techs roster by employeeId or techRacfid (for enriching task data)
  app.get("/api/all-techs/lookup/:identifier", requireAuth, async (req: any, res) => {
    try {
      const { identifier } = req.params;
      
      // Try to find by employeeId first (numeric), then by techRacfid (alphanumeric)
      let tech = await storage.getAllTechByEmployeeId(identifier);
      
      if (!tech) {
        tech = await storage.getAllTechByTechRacfid(identifier);
      }
      
      if (tech) {
        res.json({
          found: true,
          employeeId: tech.employeeId,
          techRacfid: tech.techRacfid,
          techName: tech.techName,
          firstName: tech.firstName,
          lastName: tech.lastName,
          jobTitle: tech.jobTitle,
          districtNo: tech.districtNo,
          planningAreaName: tech.planningAreaName,
          employmentStatus: tech.employmentStatus,
          // Contact info
          cellPhone: tech.cellPhone,
          mainPhone: tech.mainPhone,
          homePhone: tech.homePhone,
          // Address info
          homeAddr1: tech.homeAddr1,
          homeAddr2: tech.homeAddr2,
          homeCity: tech.homeCity,
          homeState: tech.homeState,
          homePostal: tech.homePostal,
          // Fleet info (informational-only from TPMS_EXTRACT_LAST_ASSIGNED — may be stale)
          lastKnownTruckLu: tech.lastKnownTruckLu,
          lastKnownTruckFileDate: tech.lastKnownTruckFileDate,
        });
      } else {
        res.json({ found: false });
      }
    } catch (error: any) {
      console.error("Error looking up all tech:", error);
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
      if (!currentUser || currentUser.role !== 'developer') {
        return res.status(403).json({ message: "Only developer users can create data sources" });
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
      if (!currentUser || currentUser.role !== 'developer') {
        return res.status(403).json({ message: "Only developer users can update data sources" });
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
      if (!currentUser || currentUser.role !== 'developer') {
        return res.status(403).json({ message: "Only developer users can delete data sources" });
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
      if (!currentUser || currentUser.role !== 'developer') {
        return res.status(403).json({ message: "Only developer users can create fields" });
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
      if (!currentUser || currentUser.role !== 'developer') {
        return res.status(403).json({ message: "Only developer users can create fields" });
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
      if (!currentUser || currentUser.role !== 'developer') {
        return res.status(403).json({ message: "Only developer users can create mapping sets" });
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
      if (!currentUser || currentUser.role !== 'developer') {
        return res.status(403).json({ message: "Only developer users can update mapping sets" });
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
      if (!currentUser || currentUser.role !== 'developer') {
        return res.status(403).json({ message: "Only developer users can delete mapping sets" });
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
      if (!currentUser || currentUser.role !== 'developer') {
        return res.status(403).json({ message: "Only developer users can update nodes" });
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
      if (!currentUser || currentUser.role !== 'developer') {
        return res.status(403).json({ message: "Only developer users can update mappings" });
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
      if (!currentUser || currentUser.role !== 'developer') {
        return res.status(403).json({ message: "Only developer users can create mappings" });
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
      if (!currentUser || currentUser.role !== 'developer') {
        return res.status(403).json({ message: "Only developer users can delete mappings" });
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
      if (!currentUser || currentUser.role !== 'developer') {
        return res.status(403).json({ message: "Only developer users can seed data sources" });
      }

      // Define sources with their fields
      const sourcesWithFields = [
        {
          source: {
            name: 'snowflake_termed_techs',
            displayName: 'Snowflake: Termed Technicians',
            sourceType: 'snowflake',
            connectionInfo: JSON.stringify({ table: 'DRIVELINE_TERMED_TECHS_LAST30' }),
            description: 'Terminated technicians from the last 30 days'
          },
          fields: [
            { fieldName: 'EMPL_ID', displayName: 'Employee ID', dataType: 'string', isPrimaryKey: true, isRequired: true, sampleValue: '01024631440', description: 'Unique employee identifier' },
            { fieldName: 'ENTERPRISE_ID', displayName: 'Enterprise ID (RACF)', dataType: 'string', isRequired: true, sampleValue: 'JJORDAN', description: 'LDAP/RACF username' },
            { fieldName: 'FULL_NAME', displayName: 'Full Name', dataType: 'string', isRequired: true, sampleValue: 'JORDAN, JUSTIN', description: 'Employee full name (Last, First)' },
            { fieldName: 'FIRST_NAME', displayName: 'First Name', dataType: 'string', sampleValue: 'JUSTIN', description: 'Employee first name' },
            { fieldName: 'LAST_NAME', displayName: 'Last Name', dataType: 'string', sampleValue: 'JORDAN', description: 'Employee last name' },
            { fieldName: 'DATE_LAST_WORKED', displayName: 'Last Day Worked', dataType: 'date', sampleValue: '2025-11-28', description: 'Final working day' },
            { fieldName: 'JOB_TITLE', displayName: 'Job Title', dataType: 'string', sampleValue: 'Service Technician 1, In-Home', description: 'Employee job title' },
            { fieldName: 'DISTRICT_NO', displayName: 'District Number', dataType: 'string', isForeignKey: true, sampleValue: '07670', description: 'District identifier' },
            { fieldName: 'PLANNING_AREA_NM', displayName: 'Planning Area', dataType: 'string', sampleValue: 'WEST REGION', description: 'Planning area name' },
            { fieldName: 'EMPLOYMENT_STATUS', displayName: 'Employment Status', dataType: 'string', sampleValue: 'TERMINATED', description: 'Current employment status' },
            { fieldName: 'EFFDT', displayName: 'Effective Date', dataType: 'date', sampleValue: '2025-11-28', description: 'Status effective date' },
          ]
        },
        {
          source: {
            name: 'snowflake_all_techs',
            displayName: 'Snowflake: All Technicians',
            sourceType: 'snowflake',
            connectionInfo: JSON.stringify({ table: 'DRIVELINE_ALL_TECHS' }),
            description: 'Complete technician roster from Snowflake data warehouse'
          },
          fields: [
            { fieldName: 'EMPL_ID', displayName: 'Employee ID', dataType: 'string', isPrimaryKey: true, isRequired: true, sampleValue: '71024318227', description: 'Unique employee identifier' },
            { fieldName: 'ENTERPRISE_ID', displayName: 'Enterprise ID (RACF)', dataType: 'string', isRequired: true, sampleValue: 'LYOUNGB', description: 'LDAP/RACF username' },
            { fieldName: 'FULL_NAME', displayName: 'Full Name', dataType: 'string', isRequired: true, sampleValue: 'YOUNGBLOOD, LEONARD', description: 'Employee full name' },
            { fieldName: 'FIRST_NAME', displayName: 'First Name', dataType: 'string', sampleValue: 'LEONARD', description: 'Employee first name' },
            { fieldName: 'LAST_NAME', displayName: 'Last Name', dataType: 'string', sampleValue: 'YOUNGBLOOD', description: 'Employee last name' },
            { fieldName: 'JOB_TITLE', displayName: 'Job Title', dataType: 'string', sampleValue: 'Service Technician 1, In-Home', description: 'Employee job title' },
            { fieldName: 'DISTRICT_NO', displayName: 'District Number', dataType: 'string', isForeignKey: true, sampleValue: '08420', description: 'District identifier' },
            { fieldName: 'PLANNING_AREA_NM', displayName: 'Planning Area', dataType: 'string', sampleValue: 'EAST REGION', description: 'Planning area name' },
            { fieldName: 'EMPLOYMENT_STATUS', displayName: 'Employment Status', dataType: 'string', sampleValue: 'ACTIVE', description: 'Current employment status' },
          ]
        },
        {
          source: {
            name: 'tpms_tech_info',
            displayName: 'TPMS: Technician Profile',
            sourceType: 'tpms',
            connectionInfo: JSON.stringify({ endpoint: '/techinfo' }),
            description: 'Technician profile data from TPMS API'
          },
          fields: [
            { fieldName: 'ldapId', displayName: 'Enterprise ID (LDAP)', dataType: 'string', isPrimaryKey: true, isRequired: true, sampleValue: 'JJORDAN', description: 'LDAP/Enterprise ID' },
            { fieldName: 'techId', displayName: 'Tech ID', dataType: 'string', isRequired: true, sampleValue: '12345', description: 'Internal tech identifier' },
            { fieldName: 'firstName', displayName: 'First Name', dataType: 'string', sampleValue: 'Justin', description: 'Technician first name' },
            { fieldName: 'lastName', displayName: 'Last Name', dataType: 'string', sampleValue: 'Jordan', description: 'Technician last name' },
            { fieldName: 'districtNo', displayName: 'District Number', dataType: 'string', isForeignKey: true, sampleValue: '07670', description: 'District identifier' },
            { fieldName: 'techManagerLdapId', displayName: 'Manager Enterprise ID', dataType: 'string', isForeignKey: true, sampleValue: 'MSMITH', description: 'Manager LDAP ID' },
            { fieldName: 'truckNo', displayName: 'Truck Number', dataType: 'string', sampleValue: '023680', description: 'Assigned truck number' },
            { fieldName: 'contactNo', displayName: 'Contact Number', dataType: 'string', sampleValue: '555-123-4567', description: 'Phone number' },
            { fieldName: 'email', displayName: 'Email Address', dataType: 'string', sampleValue: 'justin.jordan@company.com', description: 'Email address' },
            { fieldName: 'addresses.PRIMARY.addrLine1', displayName: 'Primary Address Line 1', dataType: 'string', sampleValue: '123 Main St', description: 'Primary address street' },
            { fieldName: 'addresses.PRIMARY.city', displayName: 'Primary City', dataType: 'string', sampleValue: 'Chicago', description: 'Primary address city' },
            { fieldName: 'addresses.PRIMARY.stateCd', displayName: 'Primary State', dataType: 'string', sampleValue: 'IL', description: 'Primary address state' },
            { fieldName: 'addresses.PRIMARY.zipCd', displayName: 'Primary ZIP', dataType: 'string', sampleValue: '60601', description: 'Primary address ZIP code' },
            { fieldName: 'techReplenishment.primarySrc', displayName: 'Replenishment Source', dataType: 'string', sampleValue: 'STORE', description: 'Parts replenishment source' },
            { fieldName: 'techReplenishment.providerName', displayName: 'Provider Name', dataType: 'string', sampleValue: 'NAPA', description: 'Parts provider name' },
            { fieldName: 'latestShippingHold.holdReason', displayName: 'Shipping Hold Reason', dataType: 'string', sampleValue: 'VACATION', description: 'Reason for shipping hold' },
          ]
        },
        {
          source: {
            name: 'holman_vehicles',
            displayName: 'Holman API: Vehicles',
            sourceType: 'holman',
            connectionInfo: JSON.stringify({ endpoint: '/vehicles' }),
            description: 'Vehicle data from Holman Fleet API'
          },
          fields: [
            { fieldName: 'vin', displayName: 'VIN', dataType: 'string', isPrimaryKey: true, isRequired: true, sampleValue: '1FTFW1E80NFA12345', description: 'Vehicle Identification Number' },
            { fieldName: 'vehicleNumber', displayName: 'Vehicle Number', dataType: 'string', isRequired: true, isForeignKey: true, sampleValue: '023680', description: 'Vehicle number (maps to TPMS Truck Number)' },
            { fieldName: 'unitNumber', displayName: 'Unit Number', dataType: 'string', isRequired: true, sampleValue: '023680', description: 'Fleet unit number' },
            { fieldName: 'year', displayName: 'Model Year', dataType: 'number', sampleValue: '2023', description: 'Vehicle model year' },
            { fieldName: 'make', displayName: 'Make', dataType: 'string', sampleValue: 'Ford', description: 'Vehicle manufacturer' },
            { fieldName: 'model', displayName: 'Model', dataType: 'string', sampleValue: 'F-150', description: 'Vehicle model' },
            { fieldName: 'color', displayName: 'Color', dataType: 'string', sampleValue: 'White', description: 'Vehicle color' },
            { fieldName: 'licensePlate', displayName: 'License Plate', dataType: 'string', sampleValue: 'ABC1234', description: 'License plate number' },
            { fieldName: 'licensePlateState', displayName: 'License Plate State', dataType: 'string', sampleValue: 'IL', description: 'License plate state' },
            { fieldName: 'status', displayName: 'Vehicle Status', dataType: 'string', sampleValue: 'ACTIVE', description: 'Current vehicle status' },
            { fieldName: 'currentOdometer', displayName: 'Current Odometer', dataType: 'number', sampleValue: '45678', description: 'Current odometer reading' },
            { fieldName: 'assignedDriverId', displayName: 'Assigned Driver ID', dataType: 'string', isForeignKey: true, sampleValue: 'DRV001', description: 'ID of assigned driver' },
            { fieldName: 'assignedDriverName', displayName: 'Assigned Driver Name', dataType: 'string', sampleValue: 'John Smith', description: 'Name of assigned driver' },
            { fieldName: 'assignedDriverEnterpriseId', displayName: 'Assigned Driver Enterprise ID', dataType: 'string', isForeignKey: true, sampleValue: 'JSMITH', description: 'Enterprise ID of assigned driver (maps to TPMS LDAP)' },
            { fieldName: 'clientCode', displayName: 'Client Code', dataType: 'string', sampleValue: 'SEARS', description: 'Client identifier' },
            { fieldName: 'divisionCode', displayName: 'Division Code', dataType: 'string', sampleValue: 'SHS', description: 'Division identifier' },
            { fieldName: 'departmentCode', displayName: 'Department Code', dataType: 'string', sampleValue: 'FLEET', description: 'Department identifier' },
            { fieldName: 'fuelType', displayName: 'Fuel Type', dataType: 'string', sampleValue: 'GASOLINE', description: 'Vehicle fuel type' },
            { fieldName: 'inServiceDate', displayName: 'In Service Date', dataType: 'date', sampleValue: '2023-01-15', description: 'Date vehicle entered service' },
            { fieldName: 'outOfServiceDate', displayName: 'Out of Service Date', dataType: 'date', sampleValue: '', description: 'Date vehicle was removed from service' },
            { fieldName: 'location', displayName: 'Current Location', dataType: 'string', sampleValue: 'Chicago, IL', description: 'Current vehicle location' },
          ]
        },
        {
          source: {
            name: 'holman_contacts',
            displayName: 'Holman API: Contacts',
            sourceType: 'holman',
            connectionInfo: JSON.stringify({ endpoint: '/contacts' }),
            description: 'Contact data from Holman Fleet API'
          },
          fields: [
            { fieldName: 'contactId', displayName: 'Contact ID', dataType: 'string', isPrimaryKey: true, isRequired: true, sampleValue: 'CNT001', description: 'Unique contact identifier' },
            { fieldName: 'firstName', displayName: 'First Name', dataType: 'string', sampleValue: 'John', description: 'Contact first name' },
            { fieldName: 'lastName', displayName: 'Last Name', dataType: 'string', sampleValue: 'Smith', description: 'Contact last name' },
            { fieldName: 'email', displayName: 'Email', dataType: 'string', sampleValue: 'john.smith@company.com', description: 'Email address' },
            { fieldName: 'phone', displayName: 'Phone', dataType: 'string', sampleValue: '555-123-4567', description: 'Phone number' },
            { fieldName: 'mobilePhone', displayName: 'Mobile Phone', dataType: 'string', sampleValue: '555-987-6543', description: 'Mobile phone number' },
            { fieldName: 'jobTitle', displayName: 'Job Title', dataType: 'string', sampleValue: 'Fleet Manager', description: 'Contact job title' },
            { fieldName: 'department', displayName: 'Department', dataType: 'string', sampleValue: 'Fleet Operations', description: 'Department name' },
            { fieldName: 'address1', displayName: 'Address Line 1', dataType: 'string', sampleValue: '123 Corporate Dr', description: 'Street address' },
            { fieldName: 'city', displayName: 'City', dataType: 'string', sampleValue: 'Chicago', description: 'City' },
            { fieldName: 'state', displayName: 'State', dataType: 'string', sampleValue: 'IL', description: 'State' },
            { fieldName: 'zip', displayName: 'ZIP Code', dataType: 'string', sampleValue: '60601', description: 'ZIP code' },
            { fieldName: 'status', displayName: 'Status', dataType: 'string', sampleValue: 'ACTIVE', description: 'Contact status' },
          ]
        },
        {
          source: {
            name: 'holman_maintenance',
            displayName: 'Holman API: Maintenance',
            sourceType: 'holman',
            connectionInfo: JSON.stringify({ endpoint: '/maintenance' }),
            description: 'Maintenance records from Holman Fleet API'
          },
          fields: [
            { fieldName: 'maintenanceId', displayName: 'Maintenance ID', dataType: 'string', isPrimaryKey: true, isRequired: true, sampleValue: 'MNT001', description: 'Unique maintenance record ID' },
            { fieldName: 'vin', displayName: 'VIN', dataType: 'string', isForeignKey: true, isRequired: true, sampleValue: '1FTFW1E80NFA12345', description: 'Vehicle VIN' },
            { fieldName: 'unitNumber', displayName: 'Unit Number', dataType: 'string', sampleValue: '023680', description: 'Fleet unit number' },
            { fieldName: 'serviceDate', displayName: 'Service Date', dataType: 'date', sampleValue: '2025-11-15', description: 'Date of service' },
            { fieldName: 'serviceType', displayName: 'Service Type', dataType: 'string', sampleValue: 'OIL_CHANGE', description: 'Type of service performed' },
            { fieldName: 'description', displayName: 'Description', dataType: 'string', sampleValue: 'Routine oil change', description: 'Service description' },
            { fieldName: 'vendorName', displayName: 'Vendor Name', dataType: 'string', sampleValue: 'Quick Lube', description: 'Service vendor' },
            { fieldName: 'totalCost', displayName: 'Total Cost', dataType: 'number', sampleValue: '89.99', description: 'Total service cost' },
            { fieldName: 'laborCost', displayName: 'Labor Cost', dataType: 'number', sampleValue: '45.00', description: 'Labor cost' },
            { fieldName: 'partsCost', displayName: 'Parts Cost', dataType: 'number', sampleValue: '44.99', description: 'Parts cost' },
            { fieldName: 'odometerReading', displayName: 'Odometer Reading', dataType: 'number', sampleValue: '45678', description: 'Odometer at service' },
            { fieldName: 'status', displayName: 'Status', dataType: 'string', sampleValue: 'COMPLETED', description: 'Service status' },
          ]
        },
        {
          source: {
            name: 'internal_queue_items',
            displayName: 'Internal: Queue Items',
            sourceType: 'internal',
            connectionInfo: JSON.stringify({ table: 'queue_items' }),
            description: 'Internal queue items for workflow processing'
          },
          fields: [
            { fieldName: 'id', displayName: 'Queue Item ID', dataType: 'string', isPrimaryKey: true, isRequired: true, sampleValue: 'qi-001', description: 'Unique queue item ID' },
            { fieldName: 'module', displayName: 'Module', dataType: 'string', isRequired: true, sampleValue: 'fleet', description: 'Queue module (ntao, assets, inventory, fleet)' },
            { fieldName: 'type', displayName: 'Task Type', dataType: 'string', isRequired: true, sampleValue: 'offboarding', description: 'Type of task' },
            { fieldName: 'title', displayName: 'Title', dataType: 'string', isRequired: true, sampleValue: 'Offboard JORDAN, JUSTIN', description: 'Task title' },
            { fieldName: 'description', displayName: 'Description', dataType: 'string', sampleValue: 'Process offboarding for termed technician', description: 'Task description' },
            { fieldName: 'status', displayName: 'Status', dataType: 'string', sampleValue: 'pending', description: 'Task status' },
            { fieldName: 'priority', displayName: 'Priority', dataType: 'string', sampleValue: 'high', description: 'Task priority' },
            { fieldName: 'assignedTo', displayName: 'Assigned To', dataType: 'string', isForeignKey: true, sampleValue: 'user-001', description: 'Assigned user ID' },
            { fieldName: 'technicianName', displayName: 'Technician Name', dataType: 'string', sampleValue: 'JORDAN, JUSTIN', description: 'Associated technician name' },
            { fieldName: 'employeeId', displayName: 'Employee ID', dataType: 'string', isForeignKey: true, sampleValue: '01024631440', description: 'Associated employee ID' },
            { fieldName: 'enterpriseId', displayName: 'Enterprise ID', dataType: 'string', sampleValue: 'JJORDAN', description: 'Enterprise/RACF ID' },
            { fieldName: 'truckNumber', displayName: 'Truck Number', dataType: 'string', sampleValue: '023680', description: 'Associated truck number' },
            { fieldName: 'lastDayWorked', displayName: 'Last Day Worked', dataType: 'date', sampleValue: '2025-11-28', description: 'Technician last working day' },
            { fieldName: 'formData', displayName: 'Form Data', dataType: 'object', sampleValue: '{}', description: 'JSON form data' },
            { fieldName: 'createdAt', displayName: 'Created At', dataType: 'date', sampleValue: '2025-11-28', description: 'Creation timestamp' },
          ]
        },
        {
          source: {
            name: 'internal_termed_techs',
            displayName: 'Internal: Termed Technicians',
            sourceType: 'internal',
            connectionInfo: JSON.stringify({ table: 'termed_techs' }),
            description: 'Synced terminated technicians from Snowflake'
          },
          fields: [
            { fieldName: 'id', displayName: 'Record ID', dataType: 'string', isPrimaryKey: true, isRequired: true, sampleValue: 'tt-001', description: 'Internal record ID' },
            { fieldName: 'employeeId', displayName: 'Employee ID', dataType: 'string', isRequired: true, sampleValue: '01024631440', description: 'Employee identifier' },
            { fieldName: 'techRacfid', displayName: 'Enterprise ID', dataType: 'string', sampleValue: 'JJORDAN', description: 'RACF/Enterprise ID' },
            { fieldName: 'techName', displayName: 'Full Name', dataType: 'string', sampleValue: 'JORDAN, JUSTIN', description: 'Full name' },
            { fieldName: 'firstName', displayName: 'First Name', dataType: 'string', sampleValue: 'JUSTIN', description: 'First name' },
            { fieldName: 'lastName', displayName: 'Last Name', dataType: 'string', sampleValue: 'JORDAN', description: 'Last name' },
            { fieldName: 'lastDayWorked', displayName: 'Last Day Worked', dataType: 'date', sampleValue: '2025-11-28', description: 'Final working day' },
            { fieldName: 'jobTitle', displayName: 'Job Title', dataType: 'string', sampleValue: 'Service Tech 2 Trainee, PP', description: 'Job title' },
            { fieldName: 'districtNo', displayName: 'District Number', dataType: 'string', sampleValue: '07670', description: 'District identifier' },
            { fieldName: 'offboardingTaskCreated', displayName: 'Offboarding Created', dataType: 'boolean', sampleValue: 'true', description: 'Whether offboarding task was created' },
            { fieldName: 'offboardingTaskId', displayName: 'Offboarding Task ID', dataType: 'string', isForeignKey: true, sampleValue: 'qi-001', description: 'Link to queue item' },
            { fieldName: 'syncedAt', displayName: 'Synced At', dataType: 'date', sampleValue: '2025-11-28', description: 'Last sync timestamp' },
          ]
        },
        {
          source: {
            name: 'page_offboarding_form',
            displayName: 'Page: Offboarding Form',
            sourceType: 'page_object',
            connectionInfo: JSON.stringify({ page: '/offboard-technician' }),
            description: 'Offboarding form fields for UI display'
          },
          fields: [
            { fieldName: 'technicianName', displayName: 'Technician Name', dataType: 'string', isRequired: true, sampleValue: 'JORDAN, JUSTIN', description: 'Technician full name' },
            { fieldName: 'employeeId', displayName: 'Employee ID', dataType: 'string', isRequired: true, sampleValue: '01024631440', description: 'Employee identifier' },
            { fieldName: 'enterpriseId', displayName: 'Enterprise ID', dataType: 'string', sampleValue: 'JJORDAN', description: 'Enterprise/RACF ID' },
            { fieldName: 'lastDayWorked', displayName: 'Last Day Worked', dataType: 'date', sampleValue: '2025-11-28', description: 'Final working day' },
            { fieldName: 'truckNumber', displayName: 'Truck Number', dataType: 'string', sampleValue: '023680', description: 'Assigned truck' },
            { fieldName: 'districtNumber', displayName: 'District Number', dataType: 'string', sampleValue: '07670', description: 'District' },
            { fieldName: 'jobTitle', displayName: 'Job Title', dataType: 'string', sampleValue: 'Service Technician', description: 'Job title' },
            { fieldName: 'managerName', displayName: 'Manager Name', dataType: 'string', sampleValue: 'Mike Smith', description: 'Manager name' },
            { fieldName: 'returnDate', displayName: 'Equipment Return Date', dataType: 'date', sampleValue: '2025-12-01', description: 'Equipment return date' },
            { fieldName: 'notes', displayName: 'Notes', dataType: 'string', sampleValue: 'Voluntary resignation', description: 'Additional notes' },
          ]
        },
      ];

      const createdSources = [];
      const createdFields = [];

      for (const { source, fields } of sourcesWithFields) {
        try {
          const existingSources = await storage.getIntegrationDataSources();
          let sourceRecord = existingSources.find(s => s.name === source.name);
          
          if (!sourceRecord) {
            sourceRecord = await storage.createIntegrationDataSource(source);
            createdSources.push(sourceRecord);
          }

          // Add fields for this source
          const existingFields = await storage.getDataSourceFields(sourceRecord.id);
          for (const field of fields) {
            if (!existingFields.find(f => f.fieldName === field.fieldName)) {
              const newField = await storage.createDataSourceField({
                sourceId: sourceRecord.id,
                fieldName: field.fieldName,
                displayName: field.displayName,
                dataType: field.dataType,
                isPrimaryKey: field.isPrimaryKey || false,
                isForeignKey: field.isForeignKey || false,
                isRequired: field.isRequired || false,
                sampleValue: field.sampleValue,
                description: field.description,
              });
              createdFields.push(newField);
            }
          }
        } catch (e) {
          console.error(`Error creating source ${source.name}:`, e);
        }
      }

      res.json({ 
        message: `Seeded ${createdSources.length} data sources and ${createdFields.length} fields`, 
        sources: createdSources,
        fieldsCreated: createdFields.length
      });
    } catch (error: any) {
      console.error("Error seeding data sources:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ============================================
  // PMF/PARQ AI API Routes
  // ============================================
  console.log("Registering PMF/PARQ AI API routes...");

  // Test PMF connection
  app.get("/api/pmf/test", requireAuth, async (req: any, res) => {
    try {
      const result = await pmfApiService.testConnection();
      res.json(result);
    } catch (error: any) {
      console.error("Error testing PMF connection:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Get available vehicles from PMF
  app.get("/api/pmf/vehicles/available", requireAuth, async (req: any, res) => {
    try {
      const vehicles = await pmfApiService.getAvailableVehicles();
      res.json({ success: true, vehicles });
    } catch (error: any) {
      console.error("Error fetching available PMF vehicles:", error);
      res.status(500).json({ success: false, message: error.message, vehicles: [] });
    }
  });

  // Get all vehicles from PMF
  app.get("/api/pmf/vehicles", requireAuth, async (req: any, res) => {
    try {
      const vehicles = await pmfApiService.getAllVehicles();
      res.json({ success: true, vehicles });
    } catch (error: any) {
      console.error("Error fetching PMF vehicles:", error);
      res.status(500).json({ success: false, message: error.message, vehicles: [] });
    }
  });

  // PMF connection status
  app.get("/api/pmf/status", requireAuth, async (req: any, res) => {
    try {
      const result = await pmfApiService.getStatus();
      res.json(result);
    } catch (error: any) {
      res.json({ configured: false, message: error.message });
    }
  });

  // Get all lots from PMF
  app.get("/api/pmf/lots", requireAuth, async (req: any, res) => {
    try {
      const lots = await pmfApiService.getLots();
      res.json({ success: true, lots });
    } catch (error: any) {
      console.error("Error fetching PMF lots:", error);
      res.status(500).json({ success: false, message: error.message, lots: [] });
    }
  });

  // Get lot types from PMF
  app.get("/api/pmf/lot-types", requireAuth, async (req: any, res) => {
    try {
      const types = await pmfApiService.getLotTypes();
      res.json({ success: true, types });
    } catch (error: any) {
      console.error("Error fetching PMF lot types:", error);
      res.status(500).json({ success: false, message: error.message, types: [] });
    }
  });

  // Get vehicle types from PMF
  app.get("/api/pmf/vehicle-types", requireAuth, async (req: any, res) => {
    try {
      const types = await pmfApiService.getVehicleTypes();
      res.json({ success: true, types });
    } catch (error: any) {
      console.error("Error fetching PMF vehicle types:", error);
      res.status(500).json({ success: false, message: error.message, types: [] });
    }
  });

  // Get vehicle statuses from PMF
  app.get("/api/pmf/vehicle-statuses", requireAuth, async (req: any, res) => {
    try {
      const statuses = await pmfApiService.getVehicleStatuses();
      res.json({ success: true, statuses });
    } catch (error: any) {
      console.error("Error fetching PMF vehicle statuses:", error);
      res.status(500).json({ success: false, message: error.message, statuses: [] });
    }
  });

  // Get vehicle by ID from PMF
  app.get("/api/pmf/vehicle/:id", requireAuth, async (req: any, res) => {
    try {
      const vehicle = await pmfApiService.getVehicleById(req.params.id);
      res.json({ success: true, vehicle });
    } catch (error: any) {
      console.error("Error fetching PMF vehicle by id:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Get vehicle activity log from PMF
  app.get("/api/pmf/vehicle/:id/activitylog", requireAuth, async (req: any, res) => {
    try {
      const log = await pmfApiService.getVehicleActivityLog(req.params.id);
      res.json({ success: true, log });
    } catch (error: any) {
      console.error("Error fetching PMF vehicle activity log:", error);
      res.status(500).json({ success: false, message: error.message, log: [] });
    }
  });

  // Get work order by ID from PMF
  app.get("/api/pmf/workorder/:id", requireAuth, async (req: any, res) => {
    try {
      const workorder = await pmfApiService.getWorkOrderById(req.params.id);
      res.json({ success: true, workorder });
    } catch (error: any) {
      console.error("Error fetching PMF work order:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Get all work orders from PMF
  app.get("/api/pmf/workorders", requireAuth, async (req: any, res) => {
    try {
      const workorders = await pmfApiService.getWorkOrders();
      res.json({ success: true, workorders });
    } catch (error: any) {
      console.error("Error fetching PMF work orders:", error);
      res.status(500).json({ success: false, message: error.message, workorders: [] });
    }
  });

  // Get work order pricing from PMF
  app.get("/api/pmf/workorder/:id/pricing", requireAuth, async (req: any, res) => {
    try {
      const pricing = await pmfApiService.getWorkOrderPricing(req.params.id);
      res.json({ success: true, pricing });
    } catch (error: any) {
      console.error("Error fetching PMF work order pricing:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Get vehicle condition report from PMF
  app.get("/api/pmf/vehicle/:id/conditionreport", requireAuth, async (req: any, res) => {
    try {
      const report = await pmfApiService.getVehicleConditionReport(req.params.id);
      res.json({ success: true, report });
    } catch (error: any) {
      console.error("Error fetching PMF vehicle condition report:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Get vehicle checkin form from PMF
  app.get("/api/pmf/vehicle/:id/checkin", requireAuth, async (req: any, res) => {
    try {
      const checkin = await pmfApiService.getVehicleCheckin(req.params.id);
      res.json({ success: true, checkin });
    } catch (error: any) {
      console.error("Error fetching PMF vehicle checkin:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Get vehicle datapoint types from PMF
  app.get("/api/pmf/vehicle-datapoint-types", requireAuth, async (req: any, res) => {
    try {
      const types = await pmfApiService.getVehicleDatapointTypes();
      res.json({ success: true, types });
    } catch (error: any) {
      console.error("Error fetching PMF vehicle datapoint types:", error);
      res.status(500).json({ success: false, message: error.message, types: [] });
    }
  });

  // Get lot timezones from PMF
  app.get("/api/pmf/lot-timezones", requireAuth, async (req: any, res) => {
    try {
      const timezones = await pmfApiService.getLotTimezones();
      res.json({ success: true, timezones });
    } catch (error: any) {
      console.error("Error fetching PMF lot timezones:", error);
      res.status(500).json({ success: false, message: error.message, timezones: [] });
    }
  });

  // Get ticket categories from PMF
  app.get("/api/pmf/ticket-categories", requireAuth, async (req: any, res) => {
    try {
      const categories = await pmfApiService.getTicketCategories();
      res.json({ success: true, categories });
    } catch (error: any) {
      console.error("Error fetching PMF ticket categories:", error);
      res.status(500).json({ success: false, message: error.message, categories: [] });
    }
  });

  // Get ticket priorities from PMF
  app.get("/api/pmf/ticket-priorities", requireAuth, async (req: any, res) => {
    try {
      const priorities = await pmfApiService.getTicketPriorities();
      res.json({ success: true, priorities });
    } catch (error: any) {
      console.error("Error fetching PMF ticket priorities:", error);
      res.status(500).json({ success: false, message: error.message, priorities: [] });
    }
  });

  // Get ticket statuses from PMF
  app.get("/api/pmf/ticket-statuses", requireAuth, async (req: any, res) => {
    try {
      const statuses = await pmfApiService.getTicketStatuses();
      res.json({ success: true, statuses });
    } catch (error: any) {
      console.error("Error fetching PMF ticket statuses:", error);
      res.status(500).json({ success: false, message: error.message, statuses: [] });
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

  // Look up tech info by truck number
  app.get("/api/tpms/lookup/truck/:truckNumber", requireAuth, async (req: any, res) => {
    try {
      const tpmsService = getTPMSService();
      const result = await tpmsService.lookupByTruckNumber(req.params.truckNumber);
      res.json(result);
    } catch (error: any) {
      console.error("Error looking up by truck number:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Get all techs updated after a given timestamp (ISO 8601, e.g. 2026-02-27T00:00:00)
  app.get("/api/tpms/techs-updated-after/:timestamp", requireAuth, async (req: any, res) => {
    try {
      const tpmsService = getTPMSService();
      const data = await tpmsService.getTechsUpdatedAfter(req.params.timestamp);
      res.json({ success: true, data });
    } catch (error: any) {
      console.error("Error fetching techs updated after timestamp:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Update a tech info record (mirrors PUT /techinfo on the TPMS API)
  app.put("/api/tpms/techinfo", requireAuth, async (req: any, res) => {
    try {
      const tpmsService = getTPMSService();
      if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({ success: false, message: "Request body is required" });
      }
      const data = await tpmsService.updateTechInfo(req.body);
      res.json({ success: true, data });
    } catch (error: any) {
      console.error("Error updating tech info:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Temporary truck assignment
  app.post("/api/tpms/temp-truck-assign", requireAuth, async (req: any, res) => {
    try {
      const tpmsService = getTPMSService();
      const { ldapId, distNo, truckNo } = req.body || {};
      if (!ldapId || !distNo || !truckNo) {
        return res.status(400).json({ success: false, message: "ldapId, distNo, and truckNo are required" });
      }
      const data = await tpmsService.tempTruckAssign(ldapId, distNo, truckNo);
      res.json({ success: true, data });
    } catch (error: any) {
      console.error("Error performing temp truck assign:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Check if TPMS is configured
  app.get("/api/tpms/status", requireAuth, async (req: any, res) => {
    try {
      const tpmsService = getTPMSService();
      const configured = tpmsService.isConfigured();
      
      let syncMetadata: any = { lastSync: null, techCount: 0, pendingChanges: 0 };
      try {
        const [techCountResult] = await db.select({ count: sql<number>`count(*)` }).from(tpmsTechProfiles);
        syncMetadata.techCount = Number(techCountResult?.count || 0);
        
        const [pendingResult] = await db.select({ count: sql<number>`count(*)` }).from(tpmsChangeLog).where(isNull(tpmsChangeLog.confirmedAt));
        syncMetadata.pendingChanges = Number(pendingResult?.count || 0);
        
        const [lastSyncResult] = await db.select({ latest: sql<string>`max(updated_at)` }).from(tpmsTechProfiles);
        syncMetadata.lastSync = lastSyncResult?.latest || null;
      } catch (e) {}
      
      res.json({ 
        configured,
        message: configured 
          ? 'TPMS is configured and ready' 
          : 'TPMS is not fully configured. Please set TPMS_AUTH_ENDPOINT, TPMS_API_ENDPOINT, and TPMS_CLIENT_SECRET.',
        syncMetadata,
      });
    } catch (error: any) {
      console.error("Error checking TPMS status:", error);
      res.status(500).json({ configured: false, message: error.message });
    }
  });

  // TPMS Cache Sync Routes - Populate cache from all_techs table
  const { getTpmsCacheSyncService } = await import("./tpms-cache-sync-service");

  // Start TPMS cache sync (loops through all techs and calls TPMS API)
  app.post("/api/tpms/cache/sync", requireAuth, async (req: any, res) => {
    try {
      if (req.user.role !== 'developer') {
        return res.status(403).json({ success: false, message: 'Only developers can trigger TPMS sync' });
      }

      const syncService = getTpmsCacheSyncService();
      
      if (syncService.isRunning()) {
        return res.json({ 
          success: true, 
          message: 'TPMS cache sync already in progress',
          progress: syncService.getProgress()
        });
      }

      // Start sync in background
      syncService.syncAllTechs({
        batchSize: 50,
        delayBetweenBatches: 3000,
        maxConcurrent: 5,
        skipRecentlyCached: true,
        recentCacheHours: 24,
      }).catch(err => {
        console.error('[TPMS-Sync] Background sync error:', err);
      });

      res.json({ 
        success: true, 
        message: 'TPMS cache sync started in background',
        progress: syncService.getProgress()
      });
    } catch (error: any) {
      console.error("Error starting TPMS cache sync:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Get TPMS cache sync progress
  app.get("/api/tpms/cache/sync/progress", requireAuth, async (req: any, res) => {
    try {
      const syncService = getTpmsCacheSyncService();
      const progress = syncService.getProgress();
      res.json({ success: true, progress });
    } catch (error: any) {
      console.error("Error getting TPMS cache sync progress:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Get TPMS cache statistics
  app.get("/api/tpms/cache/stats", requireAuth, async (req: any, res) => {
    try {
      const tpmsService = getTPMSService();
      const stats = await tpmsService.getCacheStats();
      res.json({ success: true, stats });
    } catch (error: any) {
      console.error("Error getting TPMS cache stats:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Get TPMS fleet sync state (for cache-first strategy)
  app.get("/api/tpms/fleet-sync/state", requireAuth, async (req: any, res) => {
    try {
      const tpmsService = getTPMSService();
      const state = await tpmsService.getSyncState();
      res.json({ success: true, state });
    } catch (error: any) {
      console.error("Error getting TPMS fleet sync state:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Start TPMS fleet initial sync (processes all fleet vehicles)
  app.post("/api/tpms/fleet-sync/start", requireAuth, async (req: any, res) => {
    try {
      if (req.user.role !== 'developer') {
        return res.status(403).json({ success: false, message: 'Only developers can trigger fleet sync' });
      }

      const tpmsService = getTPMSService();
      const syncState = await tpmsService.getSyncState();
      
      if (syncState?.status === 'syncing') {
        return res.json({ 
          success: true, 
          message: 'Fleet sync already in progress',
          state: syncState
        });
      }

      // Get all fleet vehicle numbers from Holman cache in database
      const { holmanVehiclesCache } = await import("@shared/schema");
      const cachedVehicles = await db.select({ holmanVehicleNumber: holmanVehiclesCache.holmanVehicleNumber })
        .from(holmanVehiclesCache)
        .where(eq(holmanVehiclesCache.isActive, true));
      
      if (cachedVehicles.length === 0) {
        return res.status(400).json({ 
          success: false, 
          message: 'No cached vehicles found. Please refresh fleet data first.' 
        });
      }

      const truckNumbers = cachedVehicles
        .map((v) => toHolmanRef(v.holmanVehicleNumber))
        .filter(Boolean) as string[];

      console.log(`[Fleet-Sync] Starting initial sync for ${truckNumbers.length} vehicles`);

      // Start sync in background
      tpmsService.runInitialSync(truckNumbers).catch(err => {
        console.error('[Fleet-Sync] Background sync error:', err);
        storage.updateTpmsSyncState({
          status: 'failed',
          errorMessage: err.message,
        });
      });

      res.json({ 
        success: true, 
        message: `Fleet sync started for ${truckNumbers.length} vehicles`,
        totalVehicles: truckNumbers.length
      });
    } catch (error: any) {
      console.error("Error starting TPMS fleet sync:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Resolve TPMS assignment mismatches via 3-step sync (Snowflake → delta → per-ID API fallback)
  // Restricted to developer/admin roles. Runs in-process and returns a structured JSON summary.
  app.post("/api/tpms/refresh-mismatches", requireAuth, async (req: any, res) => {
    try {
      if (req.user.role !== 'developer' && req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Only developers or admins can trigger mismatch refresh' });
      }

      const { runTpmsFullRefresh } = await import('./run-tpms-full-refresh');
      const skipStep3 = req.body?.skipStep3 !== false; // defaults to true (skip)
      const summary = await runTpmsFullRefresh({ skipStep3 });

      res.json({
        success: true,
        snowflakeResolved: summary.snowflakeResolved,
        deltaResolved:     summary.deltaResolved,
        apiResolved:       summary.apiResolved,
        stillMismatched:   summary.stillMismatched,
        errors:            summary.errors,
      });
    } catch (error: any) {
      console.error("Error running TPMS mismatch refresh:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // ==================================================
  // TPMS Tech Profiles & Change Log Routes
  // ==================================================
  console.log("Registering TPMS Tech Profiles API routes...");

  const { tpmsTechProfiles, tpmsChangeLog, tpmsLastKnownTruckTech } = await import("@shared/schema");

  // Helper: upsert a tech profile into the last-known truck→tech cache
  async function upsertLastKnownTruckTech(profile: any, truckNoKey: string) {
    try {
      const normalizedKey = truckNoKey.trim().toUpperCase();
      await db.insert(tpmsLastKnownTruckTech).values({
        truckNo: normalizedKey,
        enterpriseId: profile.enterpriseId || null,
        techId: profile.techId || null,
        firstName: profile.firstName || null,
        lastName: profile.lastName || null,
        districtNo: profile.districtNo || null,
        mobilePhone: profile.mobilePhone || null,
        email: profile.email || null,
        shippingAddresses: profile.shippingAddresses || [],
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: tpmsLastKnownTruckTech.truckNo,
        set: {
          enterpriseId: profile.enterpriseId || null,
          techId: profile.techId || null,
          firstName: profile.firstName || null,
          lastName: profile.lastName || null,
          districtNo: profile.districtNo || null,
          mobilePhone: profile.mobilePhone || null,
          email: profile.email || null,
          shippingAddresses: profile.shippingAddresses || [],
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        },
      });
    } catch (cacheErr: any) {
      console.warn("[TPMS LastKnown] Cache upsert failed (non-fatal):", cacheErr?.message);
    }
  }

  app.get("/api/tpms/techs", requireAuth, async (req: any, res) => {
    try {
      const { district, lastName, firstName, techManagerId, pdc, enterpriseId, truckNo, techId, address, zip, search, limit: limitParam } = req.query;
      const pageLimit = Math.min(parseInt(limitParam as string || "200", 10), 500);
      
      const conditions: any[] = [];
      
      // Generic full-text search across enterpriseId, firstName, lastName
      if (search) {
        const term = `%${(search as string).trim()}%`;
        conditions.push(
          or(
            ilike(tpmsTechProfiles.enterpriseId, term),
            ilike(tpmsTechProfiles.firstName, term),
            ilike(tpmsTechProfiles.lastName, term),
            ilike(tpmsTechProfiles.techId, term),
          )
        );
      }
      
      if (district) conditions.push(eq(tpmsTechProfiles.districtNo, district as string));
      if (lastName) conditions.push(ilike(tpmsTechProfiles.lastName, `%${lastName}%`));
      if (firstName) conditions.push(ilike(tpmsTechProfiles.firstName, `%${firstName}%`));
      if (techManagerId) conditions.push(eq(tpmsTechProfiles.techManagerLdapId, (techManagerId as string).toUpperCase()));
      if (pdc) conditions.push(eq(tpmsTechProfiles.pdcNo, pdc as string));
      if (enterpriseId) conditions.push(ilike(tpmsTechProfiles.enterpriseId, `%${enterpriseId}%`));
      if (truckNo) conditions.push(ilike(tpmsTechProfiles.truckNo, `%${truckNo}%`));
      if (techId) conditions.push(ilike(tpmsTechProfiles.techId, `%${techId}%`));
      
      let results;
      if (conditions.length > 0) {
        results = await db.select().from(tpmsTechProfiles).where(and(...conditions)).limit(pageLimit);
      } else {
        results = await db.select().from(tpmsTechProfiles).limit(pageLimit);
      }
      
      if (address || zip) {
        results = results.filter((r: any) => {
          const addrs = r.shippingAddresses || [];
          return addrs.some((a: any) => {
            if (address && !a.addrLine1?.toLowerCase().includes((address as string).toLowerCase())) return false;
            if (zip && !a.zipCd?.startsWith(zip as string)) return false;
            return true;
          });
        });
      }

      // ── Last-known cache logic (only when querying by a specific truckNo) ──
      if (truckNo) {
        const truckKey = (truckNo as string).trim().toUpperCase();
        if (results.length > 0) {
          // Live results found — seed/refresh the last-known cache in the background
          for (const r of results) {
            const rTruckNo = r.truckNo?.trim().toUpperCase();
            if (rTruckNo) {
              upsertLastKnownTruckTech(r, rTruckNo).catch(() => {});
            }
          }
        } else {
          // No live results — fall back to last-known cache (exact normalized key)
          const [cached] = await db
            .select()
            .from(tpmsLastKnownTruckTech)
            .where(eq(tpmsLastKnownTruckTech.truckNo, truckKey))
            .limit(1);
          if (cached) {
            console.log(`[TPMS LastKnown] Falling back to cached tech for truck ${truckKey} (last seen: ${cached.lastSeenAt})`);
            return res.json([{ ...cached, isLastKnown: true }]);
          }
        }
      }
      
      res.json(results);
    } catch (error: any) {
      console.error("Error searching TPMS tech profiles:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/tpms/techs/:techId/profile", requireAuth, async (req: any, res) => {
    try {
      const { techId } = req.params;
      const [profile] = await db.select().from(tpmsTechProfiles).where(eq(tpmsTechProfiles.techId, techId)).limit(1);
      
      if (!profile) {
        return res.status(404).json({ message: "Tech profile not found" });
      }
      
      let liveData = null;
      try {
        const tpmsService = getTPMSService();
        if (profile.enterpriseId) {
          const result = await tpmsService.getTechInfoWithCache(profile.enterpriseId);
          if (result) liveData = result.techInfo;
        }
      } catch (e) {}
      
      res.json({ profile, liveData });
    } catch (error: any) {
      console.error("Error getting TPMS tech profile:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/tpms/techs/:techId - merged profile (local snapshot + live TPMS API detail)
  app.get("/api/tpms/techs/:techId", requireAuth, async (req: any, res) => {
    try {
      const { techId } = req.params;
      const [profile] = await db.select().from(tpmsTechProfiles).where(eq(tpmsTechProfiles.techId, techId)).limit(1);
      
      if (!profile) {
        return res.status(404).json({ message: "Tech profile not found" });
      }
      
      let liveData: any = null;
      let liveSource: 'api' | 'cache' | 'none' = 'none';
      try {
        const tpmsService = getTPMSService();
        if (profile.enterpriseId) {
          const result = await tpmsService.getTechInfoWithCache(profile.enterpriseId);
          if (result) {
            liveData = result.techInfo;
            liveSource = result.source === 'live' ? 'api' : 'cache';
          }
        }
      } catch (e: any) {
        console.warn(`[TPMS] Failed to fetch live data for ${techId}:`, e.message);
      }
      
      // Merge: local snapshot takes precedence for editable fields, live data provides supplemental detail
      const merged = {
        ...profile,
        liveData,
        liveSource,
        // Supplemental fields from live TPMS when present
        liveDistrictNo: liveData?.districtNo ?? null,
        liveTruckNo: liveData?.truckNo ?? null,
        liveManagerLdapId: liveData?.techManagerLdapId ?? null,
      };
      
      res.json(merged);
    } catch (error: any) {
      console.error("Error getting TPMS tech merged profile:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.put("/api/tpms/techs/:techId", requireAuth, async (req: any, res) => {
    try {
      const { techId } = req.params;
      const rawBody = req.body;
      const userId = req.user?.id || req.user?.username || "system";
      const username = req.user?.username || "system";
      
      const allowedFields = ["firstName", "lastName", "mobilePhone", "email", "deMinimis", "shippingSchedule", "shippingAddresses", "extendedHolds", "techReplenishment"];
      const updates: Record<string, any> = {};
      for (const field of allowedFields) {
        if (rawBody[field] !== undefined) {
          updates[field] = rawBody[field];
        }
      }
      
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "No valid fields to update" });
      }
      
      const [existing] = await db.select().from(tpmsTechProfiles).where(eq(tpmsTechProfiles.techId, techId)).limit(1);
      if (!existing) {
        return res.status(404).json({ message: "Tech profile not found" });
      }
      
      const changeEntries: any[] = [];
      
      for (const field of allowedFields) {
        if (updates[field] !== undefined) {
          const before = (existing as any)[field];
          const after = updates[field];
          const beforeStr = typeof before === "object" ? JSON.stringify(before) : String(before ?? "");
          const afterStr = typeof after === "object" ? JSON.stringify(after) : String(after ?? "");
          if (beforeStr !== afterStr) {
            changeEntries.push({
              userId,
              username,
              techId,
              enterpriseId: existing.enterpriseId,
              fieldChanged: field,
              valueBefore: beforeStr,
              valueAfter: afterStr,
              source: "nexus-profile-edit",
              confirmedByTpms: false,
            });
          }
        }
      }
      
      if (changeEntries.length > 0) {
        await db.insert(tpmsChangeLog).values(changeEntries);
      }
      
      await db.update(tpmsTechProfiles)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(tpmsTechProfiles.techId, techId));
      
      let tpmsSyncSent = false;
      try {
        const tpmsService = getTPMSService();
        if (existing.enterpriseId) {
          await tpmsService.updateTechInfo({ ldapId: existing.enterpriseId, ...updates });
          tpmsSyncSent = true;
        }
      } catch (apiErr: any) {
        console.warn(`[TPMS] API update failed for ${techId}:`, apiErr.message);
      }
      
      res.json({ success: true, changes: changeEntries.length, tpmsSyncSent });
    } catch (error: any) {
      console.error("Error updating TPMS tech profile:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/tpms/techs/:techId/change-history", requireAuth, async (req: any, res) => {
    try {
      const { techId } = req.params;
      const limit = Math.min(parseInt(req.query.limit as string || "100", 10), 500);
      
      // Local CDC log entries
      const history = await db.select().from(tpmsChangeLog)
        .where(eq(tpmsChangeLog.techId, techId))
        .orderBy(desc(tpmsChangeLog.createdAt))
        .limit(limit);
      
      // Fetch current TPMS API state + TPMS-side history entries
      let currentTpmsState: any = null;
      let tpmsStateSource: 'api' | 'cache' | 'none' = 'none';
      let tpmsApiHistory: any[] = [];
      try {
        const [profile] = await db.select({ enterpriseId: tpmsTechProfiles.enterpriseId })
          .from(tpmsTechProfiles).where(eq(tpmsTechProfiles.techId, techId)).limit(1);
        if (profile?.enterpriseId) {
          const tpmsService = getTPMSService();
          const { getTpmsApiService } = await import("./tpms-api-service");
          const tpmsApiService = getTpmsApiService();

          const [profileResult, apiHistory] = await Promise.allSettled([
            tpmsService.getTechInfoWithCache(profile.enterpriseId),
            tpmsApiService.getChangeHistory(profile.enterpriseId, techId),
          ]);

          if (profileResult.status === 'fulfilled' && profileResult.value) {
            currentTpmsState = profileResult.value.techInfo;
            tpmsStateSource = profileResult.value.source === 'live' ? 'api' : 'cache';
          }
          if (apiHistory.status === 'fulfilled') {
            tpmsApiHistory = apiHistory.value;
          }
        }
      } catch (e: any) {
        console.warn(`[TPMS] Could not fetch live state for change-history ${techId}:`, e.message);
      }
      
      res.json({
        techId,
        cdcLog: history,
        tpmsApiHistory,
        currentTpmsState,
        tpmsStateSource,
        pendingCount: history.filter(h => !h.confirmedByTpms && !h.confirmedAt).length,
      });
    } catch (error: any) {
      console.error("Error getting TPMS change history:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/tpms/techs/:techId/addresses", requireAuth, async (req: any, res) => {
    try {
      const { techId } = req.params;
      const newAddress = req.body;
      if (!newAddress || !newAddress.addrLine1) {
        return res.status(400).json({ message: "Address line 1 is required" });
      }
      const userId = req.user?.id || req.user?.username || "system";
      const username = req.user?.username || "system";
      
      const [existing] = await db.select().from(tpmsTechProfiles).where(eq(tpmsTechProfiles.techId, techId)).limit(1);
      if (!existing) {
        return res.status(404).json({ message: "Tech profile not found" });
      }
      
      const addresses = [...(existing.shippingAddresses as any[] || []), newAddress];
      
      await db.update(tpmsTechProfiles)
        .set({ shippingAddresses: addresses, updatedAt: new Date() })
        .where(eq(tpmsTechProfiles.techId, techId));
      
      await db.insert(tpmsChangeLog).values({
        userId, username, techId, enterpriseId: existing.enterpriseId,
        fieldChanged: "shippingAddresses",
        valueBefore: JSON.stringify(existing.shippingAddresses),
        valueAfter: JSON.stringify(addresses),
        source: "nexus-address-add",
        confirmedByTpms: false,
      });
      
      let tpmsSyncSent = false;
      try {
        const tpmsService = getTPMSService();
        if (existing.enterpriseId) {
          await tpmsService.updateTechInfo({ ldapId: existing.enterpriseId, addresses });
          tpmsSyncSent = true;
        }
      } catch (apiErr: any) {
        console.warn(`[TPMS] API address add failed for ${techId}:`, apiErr.message);
      }
      
      res.json({ success: true, tpmsSyncSent });
    } catch (error: any) {
      console.error("Error adding TPMS address:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.put("/api/tpms/techs/:techId/addresses/:index", requireAuth, async (req: any, res) => {
    try {
      const { techId, index } = req.params;
      const updatedAddr = req.body;
      if (!updatedAddr || !updatedAddr.addrLine1) {
        return res.status(400).json({ message: "Address line 1 is required" });
      }
      const idx = parseInt(index, 10);
      const userId = req.user?.id || req.user?.username || "system";
      const username = req.user?.username || "system";
      
      const [existing] = await db.select().from(tpmsTechProfiles).where(eq(tpmsTechProfiles.techId, techId)).limit(1);
      if (!existing) return res.status(404).json({ message: "Tech profile not found" });
      
      const addresses = [...(existing.shippingAddresses as any[] || [])];
      if (idx < 0 || idx >= addresses.length) return res.status(400).json({ message: "Invalid address index" });
      
      addresses[idx] = updatedAddr;
      
      await db.update(tpmsTechProfiles)
        .set({ shippingAddresses: addresses, updatedAt: new Date() })
        .where(eq(tpmsTechProfiles.techId, techId));
      
      await db.insert(tpmsChangeLog).values({
        userId, username, techId, enterpriseId: existing.enterpriseId,
        fieldChanged: "shippingAddresses",
        valueBefore: JSON.stringify(existing.shippingAddresses),
        valueAfter: JSON.stringify(addresses),
        source: "nexus-address-edit",
        confirmedByTpms: false,
      });
      
      let tpmsSyncSent = false;
      try {
        const tpmsService = getTPMSService();
        if (existing.enterpriseId) {
          await tpmsService.updateTechInfo({ ldapId: existing.enterpriseId, addresses });
          tpmsSyncSent = true;
        }
      } catch (apiErr: any) {
        console.warn(`[TPMS] API address edit failed for ${techId}:`, apiErr.message);
      }
      
      res.json({ success: true, tpmsSyncSent });
    } catch (error: any) {
      console.error("Error updating TPMS address:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/tpms/techs/:techId/addresses/:index", requireAuth, async (req: any, res) => {
    try {
      const { techId, index } = req.params;
      const idx = parseInt(index, 10);
      const userId = req.user?.id || req.user?.username || "system";
      const username = req.user?.username || "system";
      
      const [existing] = await db.select().from(tpmsTechProfiles).where(eq(tpmsTechProfiles.techId, techId)).limit(1);
      if (!existing) return res.status(404).json({ message: "Tech profile not found" });
      
      const addresses = [...(existing.shippingAddresses as any[] || [])];
      if (idx < 0 || idx >= addresses.length) return res.status(400).json({ message: "Invalid address index" });
      
      addresses.splice(idx, 1);
      
      await db.update(tpmsTechProfiles)
        .set({ shippingAddresses: addresses, updatedAt: new Date() })
        .where(eq(tpmsTechProfiles.techId, techId));
      
      await db.insert(tpmsChangeLog).values({
        userId, username, techId, enterpriseId: existing.enterpriseId,
        fieldChanged: "shippingAddresses",
        valueBefore: JSON.stringify(existing.shippingAddresses),
        valueAfter: JSON.stringify(addresses),
        source: "nexus-address-delete",
        confirmedByTpms: false,
      });
      
      let tpmsSyncSent = false;
      try {
        const tpmsService = getTPMSService();
        if (existing.enterpriseId) {
          await tpmsService.updateTechInfo({ ldapId: existing.enterpriseId, addresses });
          tpmsSyncSent = true;
        }
      } catch (apiErr: any) {
        console.warn(`[TPMS] API address delete failed for ${techId}:`, apiErr.message);
      }
      
      res.json({ success: true, tpmsSyncSent });
    } catch (error: any) {
      console.error("Error deleting TPMS address:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/tpms/shipping-schedules", requireAuth, async (req: any, res) => {
    try {
      const { district, pdc, techId, deMinimis, shippingDay } = req.query;
      
      const conditions: any[] = [];
      if (district) conditions.push(eq(tpmsTechProfiles.districtNo, district as string));
      if (pdc) conditions.push(eq(tpmsTechProfiles.pdcNo, pdc as string));
      if (techId) conditions.push(ilike(tpmsTechProfiles.techId, `%${techId}%`));
      if (deMinimis === "YES") conditions.push(eq(tpmsTechProfiles.deMinimis, true));
      if (deMinimis === "NO") conditions.push(eq(tpmsTechProfiles.deMinimis, false));
      
      let results;
      if (conditions.length > 0) {
        results = await db.select().from(tpmsTechProfiles).where(and(...conditions)).limit(200);
      } else {
        results = await db.select().from(tpmsTechProfiles).limit(200);
      }
      
      if (shippingDay && shippingDay !== "ALL") {
        results = results.filter((r: any) => {
          const schedule = r.shippingSchedule || {};
          return schedule[shippingDay as string] === true;
        });
      }
      
      res.json(results);
    } catch (error: any) {
      console.error("Error searching shipping schedules:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.put("/api/tpms/shipping-schedules", requireAuth, async (req: any, res) => {
    try {
      const { techIds, schedule } = req.body;
      const userId = req.user?.id || req.user?.username || "system";
      const username = req.user?.username || "system";
      
      if (!techIds || !Array.isArray(techIds) || !schedule || typeof schedule !== "object") {
        return res.status(400).json({ message: "techIds array and schedule object required" });
      }
      
      let updated = 0;
      let tpmsSynced = 0;
      const tpmsService = getTPMSService();
      
      for (const tid of techIds) {
        const [existing] = await db.select().from(tpmsTechProfiles).where(eq(tpmsTechProfiles.techId, tid)).limit(1);
        if (!existing) continue;
        
        await db.update(tpmsTechProfiles)
          .set({ shippingSchedule: schedule, updatedAt: new Date() })
          .where(eq(tpmsTechProfiles.techId, tid));
        
        await db.insert(tpmsChangeLog).values({
          userId, username, techId: tid, enterpriseId: existing.enterpriseId,
          fieldChanged: "shippingSchedule",
          valueBefore: JSON.stringify(existing.shippingSchedule),
          valueAfter: JSON.stringify(schedule),
          source: "nexus-schedule-bulk-update",
          confirmedByTpms: false,
        });
        
        try {
          if (existing.enterpriseId) {
            await tpmsService.updateTechInfo({ ldapId: existing.enterpriseId, shippingSchedule: schedule });
            tpmsSynced++;
          }
        } catch (apiErr: any) {
          console.warn(`[TPMS] API schedule update failed for ${tid}:`, apiErr.message);
        }
        
        updated++;
      }
      
      res.json({ success: true, updated, tpmsSynced });
    } catch (error: any) {
      console.error("Error updating shipping schedules:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/tpms/sync", requireAuth, async (req: any, res) => {
    try {
      const tpmsService = getTPMSService();
      const { full } = req.query;
      
      const latestProfile = await db.select({ lastTpmsUpdatedAt: tpmsTechProfiles.lastTpmsUpdatedAt })
        .from(tpmsTechProfiles)
        .orderBy(desc(tpmsTechProfiles.lastTpmsUpdatedAt))
        .limit(1);
      
      const sinceTimestamp = latestProfile[0]?.lastTpmsUpdatedAt 
        ? new Date(latestProfile[0].lastTpmsUpdatedAt).toISOString()
        : null;
      
      // Full-sync fallback: bootstrap from fleet cache when no profiles exist or ?full=1 requested
      if (!sinceTimestamp || full === '1') {
        const { holmanVehiclesCache } = await import("@shared/schema");
        const cachedVehicles = await db.select({ holmanVehicleNumber: holmanVehiclesCache.holmanVehicleNumber })
          .from(holmanVehiclesCache)
          .where(eq(holmanVehiclesCache.isActive, true));
        
        if (cachedVehicles.length === 0) {
          return res.json({ success: false, message: "No fleet vehicles found in cache. Please refresh fleet data first.", mode: "none" });
        }
        
        const truckNumbers = cachedVehicles
          .map((v) => toHolmanRef(v.holmanVehicleNumber))
          .filter(Boolean) as string[];
        
        console.log(`[TPMS Sync] No existing profiles — bootstrapping full sync for ${truckNumbers.length} vehicles`);
        
        // Run initial sync and then populate tpms_tech_profiles from the cache
        tpmsService.runInitialSync(truckNumbers)
          .then(async () => {
            console.log('[TPMS Sync] Initial sync done — populating tpms_tech_profiles from cache');
            const { tpmsCachedAssignments: cacheTable } = await import("@shared/schema");
            const cached = await db.select().from(cacheTable)
              .where(and(isNotNull(cacheTable.enterpriseId), isNotNull(cacheTable.techId)));
            let populated = 0;
            const syncTime = new Date();
            for (const row of cached) {
              if (!row.enterpriseId || !row.techId) continue;
              let raw: any = {};
              try { raw = row.rawResponse ? JSON.parse(row.rawResponse) : {}; } catch {}
              const data = {
                techId: row.techId,
                enterpriseId: row.enterpriseId.trim().toUpperCase(),
                firstName: row.firstName || raw.firstName || null,
                lastName: row.lastName || raw.lastName || null,
                districtNo: row.districtNo || raw.districtNo || null,
                techManagerLdapId: raw.managerEntId?.trim() || null,
                techManagerName: raw.managerName || null,
                truckNo: row.truckNo || raw.truckNo || null,
                mobilePhone: row.contactNo || raw.contactNo || null,
                email: row.email || raw.email || null,
                shippingAddresses: raw.addresses || [],
                shippingSchedule: {},
                techReplenishment: raw.techReplenishment || {},
                rawResponse: row.rawResponse || null,
                lastTpmsUpdatedAt: syncTime,
                syncedAt: syncTime,
              };
              const [existing] = await db.select({ id: tpmsTechProfiles.id })
                .from(tpmsTechProfiles).where(eq(tpmsTechProfiles.enterpriseId, data.enterpriseId)).limit(1);
              if (existing) {
                await db.update(tpmsTechProfiles).set({ ...data, updatedAt: new Date() })
                  .where(eq(tpmsTechProfiles.enterpriseId, data.enterpriseId));
              } else {
                await db.insert(tpmsTechProfiles).values(data);
              }
              populated++;
            }
            console.log(`[TPMS Sync] tpms_tech_profiles populated: ${populated} records`);
          })
          .catch(err => {
            console.error('[TPMS Sync] Full-sync bootstrap error:', err);
          });
        
        return res.json({
          success: true,
          mode: "full",
          message: `Full TPMS sync started for ${truckNumbers.length} vehicles. Check /api/tpms/fleet-sync/state for progress.`,
          totalVehicles: truckNumbers.length,
        });
      }
      
      // Capture timestamp BEFORE the API call so our watermark precedes the response.
      // Using a post-call new Date() would risk missing changes that arrived during the request.
      const syncStartTime = new Date();
      const updatedTechs = await tpmsService.getTechsUpdatedAfter(sinceTimestamp);
      const techList = updatedTechs?.techInfoList || [];
      
      let upserted = 0;
      for (const tech of techList) {
        const data = {
          techId: tech.techId?.trim() || "",
          enterpriseId: (tech.ldapId?.trim() || "").toUpperCase(),
          firstName: tech.firstName || null,
          lastName: tech.lastName || null,
          districtNo: tech.districtNo || null,
          techManagerLdapId: tech.techManagerLdapId?.trim() || null,
          techManagerName: tech.techManagerName?.trim() || tech.managerName?.trim() || null,
          truckNo: tech.truckNo?.trim() || null,
          mobilePhone: tech.contactNo || null,
          email: tech.email || null,
          shippingAddresses: tech.addresses || [],
          shippingSchedule: {},
          techReplenishment: tech.techReplenishment || {},
          rawResponse: JSON.stringify(tech),
          lastTpmsUpdatedAt: syncStartTime,
          syncedAt: syncStartTime,
        };
        
        if (!data.enterpriseId) continue;
        
        const [existing] = await db.select().from(tpmsTechProfiles)
          .where(eq(tpmsTechProfiles.enterpriseId, data.enterpriseId)).limit(1);
        
        if (existing) {
          await db.update(tpmsTechProfiles)
            .set({ ...data, updatedAt: new Date() })
            .where(eq(tpmsTechProfiles.enterpriseId, data.enterpriseId));
        } else {
          await db.insert(tpmsTechProfiles).values(data);
        }
        upserted++;
      }
      
      let confirmed = 0;
      const pendingLogs = await db.select().from(tpmsChangeLog).where(isNull(tpmsChangeLog.confirmedAt));
      for (const log of pendingLogs) {
        const [profile] = await db.select().from(tpmsTechProfiles).where(eq(tpmsTechProfiles.techId, log.techId)).limit(1);
        if (!profile) continue;
        
        const currentValue = (profile as any)[log.fieldChanged];
        const currentStr = typeof currentValue === "object" ? JSON.stringify(currentValue) : String(currentValue ?? "");
        
        if (currentStr === log.valueAfter) {
          await db.update(tpmsChangeLog)
            .set({ confirmedAt: new Date(), confirmedByTpms: true })
            .where(eq(tpmsChangeLog.id, log.id));
          confirmed++;
        }
      }
      
      res.json({ success: true, mode: "incremental", since: sinceTimestamp, upserted, confirmed });
    } catch (error: any) {
      console.error("Error running TPMS sync:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // ==================================================
  // TPMS Incremental Sync Scheduler (every 6 hours)
  // Runs automatic incremental sync to pull changes from the TPMS API,
  // update local profiles, and confirm pending CDC log entries.
  // ==================================================
  (() => {
    const TPMS_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
    const runTpmsIncrementalSync = async () => {
      try {
        console.log('[TPMS Scheduler] Running scheduled incremental sync...');
        const tpmsService = getTPMSService();

        const latestProfile = await db.select({ lastTpmsUpdatedAt: tpmsTechProfiles.lastTpmsUpdatedAt })
          .from(tpmsTechProfiles)
          .orderBy(desc(tpmsTechProfiles.lastTpmsUpdatedAt))
          .limit(1);

        const sinceTimestamp = latestProfile[0]?.lastTpmsUpdatedAt
          ? new Date(latestProfile[0].lastTpmsUpdatedAt).toISOString()
          : null;

        if (!sinceTimestamp) {
          console.log('[TPMS Scheduler] No existing profiles — skipping scheduled incremental sync (run a full sync first).');
          return;
        }

        const syncStartTime = new Date();
        const updatedTechs = await tpmsService.getTechsUpdatedAfter(sinceTimestamp);
        const techList = updatedTechs?.techInfoList || [];

        let upserted = 0;
        for (const tech of techList) {
          const data = {
            techId: tech.techId?.trim() || "",
            enterpriseId: (tech.ldapId?.trim() || "").toUpperCase(),
            firstName: tech.firstName || null,
            lastName: tech.lastName || null,
            districtNo: tech.districtNo || null,
            techManagerLdapId: tech.techManagerLdapId?.trim() || null,
            truckNo: tech.truckNo?.trim() || null,
            mobilePhone: tech.contactNo || null,
            email: tech.email || null,
            shippingAddresses: tech.addresses || [],
            shippingSchedule: {},
            techReplenishment: tech.techReplenishment || {},
            rawResponse: JSON.stringify(tech),
            lastTpmsUpdatedAt: syncStartTime,
            syncedAt: syncStartTime,
          };
          if (!data.enterpriseId) continue;
          const [existing] = await db.select().from(tpmsTechProfiles)
            .where(eq(tpmsTechProfiles.enterpriseId, data.enterpriseId)).limit(1);
          if (existing) {
            await db.update(tpmsTechProfiles)
              .set({ ...data, updatedAt: new Date() })
              .where(eq(tpmsTechProfiles.enterpriseId, data.enterpriseId));
          } else {
            await db.insert(tpmsTechProfiles).values(data);
          }
          upserted++;
        }

        let confirmed = 0;
        const pendingLogs = await db.select().from(tpmsChangeLog).where(isNull(tpmsChangeLog.confirmedAt));
        for (const log of pendingLogs) {
          const [profile] = await db.select().from(tpmsTechProfiles).where(eq(tpmsTechProfiles.techId, log.techId)).limit(1);
          if (!profile) continue;
          const currentValue = (profile as any)[log.fieldChanged];
          const currentStr = typeof currentValue === "object" ? JSON.stringify(currentValue) : String(currentValue ?? "");
          if (currentStr === log.valueAfter) {
            await db.update(tpmsChangeLog)
              .set({ confirmedAt: new Date(), confirmedByTpms: true })
              .where(eq(tpmsChangeLog.id, log.id));
            confirmed++;
          }
        }

        // CDC aging: flag entries that have been unconfirmed > 48h
        // confirmedByTpms is a non-nullable boolean (default false), so use eq(..., false)
        const CDC_AGING_WINDOW_MS = 48 * 60 * 60 * 1000;
        const agingCutoff = new Date(Date.now() - CDC_AGING_WINDOW_MS);
        const { activityLogs: activityLogsTable, allTechs: allTechsTable } = await import("@shared/schema");
        const agedPending = await db.select().from(tpmsChangeLog)
          .where(
            and(
              isNull(tpmsChangeLog.confirmedAt),
              eq(tpmsChangeLog.confirmedByTpms, false),
              lt(tpmsChangeLog.createdAt, agingCutoff)
            )
          );

        if (agedPending.length > 0) {
          console.warn(`[TPMS Scheduler] ${agedPending.length} CDC entries aged >48h without TPMS confirmation — flagging in activity log`);
          await db.insert(activityLogsTable).values({
            userId: "system",
            action: "tpms_cdc_aging_alert",
            entityType: "tpms",
            details: JSON.stringify({
              count: agedPending.length,
              techIds: [...new Set(agedPending.map(e => e.techId).filter(Boolean))],
              agingWindowHours: 48,
            }),
          });
        }

        // Snowflake drift check: compare allTechs.lastKnownTruckLu (snapshot) vs tpmsTechProfiles.truckNo (live)
        // Note: lastKnownTruckLu is informational-only from TPMS_EXTRACT_LAST_ASSIGNED and may be stale.
        // This check is logged for awareness but should not be treated as authoritative.
        const profiles = await db.select({
          enterpriseId: tpmsTechProfiles.enterpriseId,
          profileTruckNo: tpmsTechProfiles.truckNo,
        }).from(tpmsTechProfiles).where(isNotNull(tpmsTechProfiles.enterpriseId));

        const driftEntries: Array<{ enterpriseId: string; tpmsNo: string; snowflakeNo: string }> = [];
        for (const profile of profiles) {
          if (!profile.enterpriseId) continue;
          const [atRow] = await db.select({ lastKnownTruckLu: allTechsTable.lastKnownTruckLu })
            .from(allTechsTable)
            .where(eq(allTechsTable.techRacfid, profile.enterpriseId))
            .limit(1);
          if (atRow?.lastKnownTruckLu && profile.profileTruckNo && toCanonical(atRow.lastKnownTruckLu) !== toCanonical(profile.profileTruckNo)) {
            driftEntries.push({ enterpriseId: profile.enterpriseId, tpmsNo: profile.profileTruckNo, snowflakeNo: atRow.lastKnownTruckLu });
          }
        }

        if (driftEntries.length > 0) {
          console.warn(`[TPMS Scheduler] Snowflake drift found for ${driftEntries.length} technician(s) — logging to activity log`);
          await db.insert(activityLogsTable).values({
            userId: "system",
            action: "tpms_snowflake_drift",
            entityType: "tpms",
            details: JSON.stringify({
              count: driftEntries.length,
              entries: driftEntries.slice(0, 50),
            }),
          });
        } else {
          console.log(`[TPMS Scheduler] Snowflake drift check: no truck assignment drift detected`);
        }

        console.log(`[TPMS Scheduler] Scheduled incremental sync complete: ${upserted} upserted, ${confirmed} CDC entries confirmed`);
      } catch (err: any) {
        console.error('[TPMS Scheduler] Scheduled incremental sync error:', err.message);
      }
    };

    // Schedule recurring incremental sync
    setInterval(runTpmsIncrementalSync, TPMS_SYNC_INTERVAL_MS);
    console.log(`[TPMS Scheduler] Scheduled incremental sync every ${TPMS_SYNC_INTERVAL_MS / 3600000}h`);


    // ── Startup backfill: populate tpms_tech_profiles from tpms_cached_assignments ──
    // Two phases run on every startup:
    //   Phase 1 (conditional): Full upsert when profiles count lags cache by >50%
    //   Phase 2 (always): Gap-fill — sync addresses/truck/replenishment from cache
    //                     rows that have data the profile row is missing
    (async () => {
      try {
        const { tpmsCachedAssignments: cacheTable } = await import("@shared/schema");

        // ── Phase 1: Full upsert if profiles table is significantly behind ──────────
        const [profileCount] = await db.select({ count: sql<number>`count(*)` }).from(tpmsTechProfiles);
        const [cacheCount] = await db.select({ count: sql<number>`count(*)` }).from(cacheTable).where(
          and(isNotNull(cacheTable.enterpriseId), isNotNull(cacheTable.techId))
        );
        const profiles = Number(profileCount?.count || 0);
        const cached = Number(cacheCount?.count || 0);

        if (profiles < cached * 0.5) {
          console.log(`[TPMS Backfill] tpms_tech_profiles (${profiles}) lags cache (${cached}) — running full backfill...`);
          const rows = await db.select().from(cacheTable)
            .where(and(isNotNull(cacheTable.enterpriseId), isNotNull(cacheTable.techId)));
          const syncTime = new Date();
          let populated = 0;
          for (const row of rows) {
            if (!row.enterpriseId || !row.techId) continue;
            let raw: any = {};
            try { raw = row.rawResponse ? JSON.parse(row.rawResponse) : {}; } catch {}
            const data = {
              techId: row.techId,
              enterpriseId: row.enterpriseId.trim().toUpperCase(),
              firstName: row.firstName || raw.firstName || null,
              lastName: row.lastName || raw.lastName || null,
              districtNo: row.districtNo || raw.districtNo || null,
              techManagerLdapId: raw.managerEntId?.trim() || null,
              techManagerName: raw.managerName || null,
              truckNo: row.truckNo || raw.truckNo || null,
              mobilePhone: row.contactNo || raw.contactNo || null,
              email: row.email || raw.email || null,
              shippingAddresses: raw.addresses || [],
              shippingSchedule: raw.shippingSchedule || {},
              techReplenishment: raw.techReplenishment || {},
              rawResponse: row.rawResponse || null,
              lastTpmsUpdatedAt: row.lastSuccessAt || syncTime,
              syncedAt: syncTime,
            };
            try {
              await db.insert(tpmsTechProfiles)
                .values(data)
                .onConflictDoUpdate({
                  target: tpmsTechProfiles.enterpriseId,
                  set: { ...data, updatedAt: new Date() },
                });
              populated++;
            } catch (e: any) {
              // skip individual row errors
            }
          }
          console.log(`[TPMS Backfill] Phase 1 complete — ${populated}/${rows.length} profiles populated`);
        }

        // ── Phase 2: Always — gap-fill from cache rows that have richer data ────────
        // Fix profiles where addresses/truck/replenishment are missing but cache has them.
        // Also fixes any enterprise_id whitespace corruption in both tables.
        await db.execute(sql`
          UPDATE tpms_cached_assignments
          SET enterprise_id = TRIM(enterprise_id)
          WHERE enterprise_id IS NOT NULL AND enterprise_id != TRIM(enterprise_id)
        `);
        const gapRows = await db.select().from(cacheTable).where(
          and(isNotNull(cacheTable.enterpriseId), isNotNull(cacheTable.techId))
        );
        let gapFixed = 0;
        for (const row of gapRows) {
          if (!row.enterpriseId) continue;
          const eid = row.enterpriseId.trim().toUpperCase();
          let raw: any = {};
          try { raw = row.rawResponse ? JSON.parse(row.rawResponse) : {}; } catch {}
          const hasAddresses = Array.isArray(raw.addresses) && raw.addresses.length > 0;
          const hasTruck = !!(raw.truckNo || row.truckNo);
          const hasReplen = raw.techReplenishment && Object.keys(raw.techReplenishment).length > 0;
          if (!hasAddresses && !hasTruck && !hasReplen) continue;
          try {
            const [existing] = await db.select({
              id: tpmsTechProfiles.id,
              addrLen: sql<number>`jsonb_array_length(shipping_addresses)`,
              truck: tpmsTechProfiles.truckNo,
              replen: tpmsTechProfiles.techReplenishment,
            }).from(tpmsTechProfiles).where(eq(tpmsTechProfiles.enterpriseId, eid)).limit(1);
            if (!existing) continue;
            const needsAddr = hasAddresses && existing.addrLen === 0;
            const needsTruck = hasTruck && !existing.truck;
            const needsReplen = hasReplen && (!existing.replen || JSON.stringify(existing.replen) === '{}');
            if (!needsAddr && !needsTruck && !needsReplen) continue;
            const patch: Record<string, any> = { updatedAt: new Date() };
            if (needsAddr) patch.shippingAddresses = raw.addresses;
            if (needsTruck) patch.truckNo = raw.truckNo || row.truckNo;
            if (needsReplen) patch.techReplenishment = raw.techReplenishment;
            await db.update(tpmsTechProfiles).set(patch).where(eq(tpmsTechProfiles.enterpriseId, eid));
            gapFixed++;
          } catch (e: any) { /* skip */ }
        }
        if (gapFixed > 0) {
          console.log(`[TPMS Backfill] Phase 2 gap-fill — fixed ${gapFixed} profiles with missing data from cache`);
        }
      } catch (err: any) {
        console.error('[TPMS Backfill] Error during startup backfill:', err.message);
      }
    })();
  })();

  // ==================================================
  // Vehicle Assignment Routes - Aggregated Data from Snowflake, TPMS, Holman
  // ==================================================
  console.log("Registering Vehicle Assignment API routes...");
  const { vehicleAssignmentService } = await import("./vehicle-assignment-service");

  // Get all aggregated vehicle assignments with optional filters
  app.get("/api/vehicle-assignments", requireAuth, async (req: any, res) => {
    try {
      const { status, districtNo, truckNo, search, page = '1', limit = '50' } = req.query;
      
      const filters = {
        status: status as string,
        districtNo: districtNo as string,
        truckNo: truckNo as string,
        search: search as string,
      };
      
      const pageNum = parseInt(page as string, 10);
      const limitNum = parseInt(limit as string, 10);
      
      const assignments = await vehicleAssignmentService.getAggregatedAssignments(filters, {
        page: pageNum,
        limit: limitNum,
      });
      
      res.json({ success: true, data: assignments });
    } catch (error: any) {
      console.error("Error fetching vehicle assignments:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Get a single assignment by tech enterprise ID (RACFID)
  app.get("/api/vehicle-assignments/tech/:techRacfid", requireAuth, async (req: any, res) => {
    try {
      const { techRacfid } = req.params;
      const assignment = await vehicleAssignmentService.getAggregatedAssignmentByTechRacfid(techRacfid);
      
      if (!assignment) {
        return res.status(404).json({ success: false, message: 'Technician not found' });
      }
      
      res.json({ success: true, data: assignment });
    } catch (error: any) {
      console.error("Error fetching assignment by tech:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Get a single assignment by truck number
  app.get("/api/vehicle-assignments/truck/:truckNo", requireAuth, async (req: any, res) => {
    try {
      const { truckNo } = req.params;
      const assignment = await vehicleAssignmentService.getAggregatedAssignmentByTruckNo(truckNo);
      
      if (!assignment) {
        return res.status(404).json({ success: false, message: 'Vehicle assignment not found' });
      }
      
      res.json({ success: true, data: assignment });
    } catch (error: any) {
      console.error("Error fetching assignment by truck:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Search technicians from Snowflake for assignment lookups
  app.get("/api/vehicle-assignments/search/technicians", requireAuth, async (req: any, res) => {
    try {
      const { q } = req.query;
      
      if (!q || (q as string).length < 2) {
        return res.json({ success: true, data: [] });
      }
      
      const technicians = await vehicleAssignmentService.searchTechnicians(q as string);
      res.json({ success: true, data: technicians });
    } catch (error: any) {
      console.error("Error searching technicians:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Sync assignment from TPMS (pull latest data for a specific tech)
  app.post("/api/vehicle-assignments/sync/tpms/:techRacfid", requireAuth, async (req: any, res) => {
    try {
      const { techRacfid } = req.params;
      const currentUser = req.user.username;
      
      const assignment = await vehicleAssignmentService.syncFromTPMS(techRacfid, currentUser);
      
      if (!assignment) {
        return res.status(404).json({ success: false, message: 'Could not sync from TPMS - technician not found' });
      }
      
      res.json({ success: true, data: assignment });
    } catch (error: any) {
      console.error("Error syncing from TPMS:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Create or update a vehicle assignment manually
  app.post("/api/vehicle-assignments", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || !['developer', 'admin', 'agent'].includes(currentUser.role)) {
        return res.status(403).json({ message: "Insufficient permissions" });
      }
      
      const { techRacfid, truckNo, assignmentStatus, notes } = req.body;
      
      if (!techRacfid) {
        return res.status(400).json({ message: "Tech RACFID is required" });
      }
      
      const assignment = await vehicleAssignmentService.createOrUpdateAssignment(
        techRacfid,
        truckNo || null,
        assignmentStatus || 'active',
        req.user.username,
        notes
      );
      
      if (!assignment) {
        return res.status(500).json({ success: false, message: 'Failed to create/update assignment' });
      }
      
      res.json({ success: true, data: assignment });
    } catch (error: any) {
      console.error("Error creating/updating assignment:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Unassign a vehicle from a technician
  app.delete("/api/vehicle-assignments/:techRacfid", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser || !['developer', 'admin', 'agent'].includes(currentUser.role)) {
        return res.status(403).json({ message: "Insufficient permissions" });
      }
      
      const { techRacfid } = req.params;
      const { notes } = req.body || {};
      
      const assignment = await vehicleAssignmentService.unassignVehicle(
        techRacfid,
        req.user.username,
        notes
      );
      
      if (!assignment) {
        return res.status(404).json({ success: false, message: 'Assignment not found' });
      }
      
      res.json({ success: true, data: assignment });
    } catch (error: any) {
      console.error("Error unassigning vehicle:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Get assignment history for a technician
  app.get("/api/vehicle-assignments/history/:techRacfid", requireAuth, async (req: any, res) => {
    try {
      const { techRacfid } = req.params;
      const history = await vehicleAssignmentService.getAssignmentHistory(techRacfid);
      res.json({ success: true, data: history });
    } catch (error: any) {
      console.error("Error fetching assignment history:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Get assignment history for a vehicle (by truck number)
  app.get("/api/vehicle-assignments/by-truck/:truckNumber", requireAuth, async (req: any, res) => {
    try {
      const { truckNumber } = req.params;
      const history = await storage.getTechVehicleAssignmentHistoryByTruck(truckNumber);
      res.json({ success: true, data: history });
    } catch (error: any) {
      console.error("Error fetching vehicle assignment history:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Get service status - check if all data sources are configured
  app.get("/api/vehicle-assignments/status", requireAuth, async (req: any, res) => {
    try {
      const isConfigured = vehicleAssignmentService.isFullyConfigured();
      const status = {
        configured: isConfigured,
        dataSources: {
          snowflake: isSnowflakeConfigured(),
          tpms: getTPMSService().isConfigured(),
          holman: holmanApiService.isConfigured(),
        }
      };
      res.json({ success: true, data: status });
    } catch (error: any) {
      console.error("Error fetching service status:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // ===================================
  // Rental Reduction Dashboard Routes
  // ===================================
  
  // Helper function to calculate rental aging bucket
  function getRentalAgingBucket(daysOpen: number): string {
    if (daysOpen >= 28) return "28 plus days";
    if (daysOpen >= 21) return "21 plus days";
    if (daysOpen >= 14) return "14 plus days";
    return "Less than 14 days";
  }

  // Helper function to calculate dashboard data from rental details
  function calculateRentalDashboardData(rentalDetails: any[]) {
    const buckets = ["28 plus days", "21 plus days", "14 plus days", "Less than 14 days"];
    const grandTotal = rentalDetails.length;
    
    // Calculate summary by bucket
    const summary = buckets.map(bucket => {
      const items = rentalDetails.filter(r => r.rentalDays === bucket);
      const rentalsOpen = items.length;
      const totalDays = items.reduce((sum, r) => sum + (r.daysOpen || 0), 0);
      return {
        bucket,
        rentalsOpen,
        percentOfTotal: grandTotal > 0 ? rentalsOpen / grandTotal : 0,
        avgDaysOpen: rentalsOpen > 0 ? totalDays / rentalsOpen : 0
      };
    });

    const totalOver14Days = rentalDetails.filter(r => 
      r.rentalDays === "28 plus days" || r.rentalDays === "21 plus days" || r.rentalDays === "14 plus days"
    ).length;

    const enterpriseTotal = rentalDetails.filter(r => r.isEnterprise).length;
    const nonEnterpriseTotal = rentalDetails.filter(r => !r.isEnterprise).length;

    // Calculate vendor breakdown from SOURCE column
    const vendorCounts = new Map<string, { count: number; totalDays: number; over14: number }>();
    rentalDetails.forEach(r => {
      const vendor = r.source || 'Unknown';
      const existing = vendorCounts.get(vendor) || { count: 0, totalDays: 0, over14: 0 };
      existing.count++;
      existing.totalDays += r.daysOpen || 0;
      if (r.daysOpen >= 14) existing.over14++;
      vendorCounts.set(vendor, existing);
    });
    
    const vendorBreakdown = Array.from(vendorCounts.entries())
      .map(([vendor, stats]) => ({
        vendor,
        count: stats.count,
        percentOfTotal: grandTotal > 0 ? stats.count / grandTotal : 0,
        avgDaysOpen: stats.count > 0 ? stats.totalDays / stats.count : 0,
        over14Days: stats.over14
      }))
      .sort((a, b) => b.count - a.count);

    // For historical progress: Only include current snapshot
    // Historical data comes from the rental_snapshots table
    const progressHistory = [];
    const today = new Date();
    
    progressHistory.push({
      date: today.toISOString().split('T')[0],
      buckets: summary.map(s => ({
        bucket: s.bucket,
        rentalsOpen: s.rentalsOpen,
        percentOfTotal: s.percentOfTotal,
        changeMtd: 0
      })),
      grandTotal,
      totalOver14Days,
      percentOver14Days: grandTotal > 0 ? totalOver14Days / grandTotal : 0
    });

    return {
      currentSnapshot: {
        date: new Date().toISOString().split('T')[0],
        summary,
        grandTotal,
        totalOver14Days,
        percentOver14Days: grandTotal > 0 ? totalOver14Days / grandTotal : 0,
        enterpriseTotal,
        nonEnterpriseTotal,
        vendorBreakdown
      },
      progressHistory,
      rentalDetails,
      lastUpdated: new Date().toISOString(),
      isLiveData: true
    };
  }

  // Helper function to build dashboard data from a cached snapshot
  async function buildDashboardFromCache(snapshot: any, historicalSnapshots: any[]) {
    const rentalDetails = (snapshot.rentalDetails as any[]) || [];
    const buckets = ["28 plus days", "21 plus days", "14 plus days", "Less than 14 days"];
    
    // Build summary from snapshot data
    const summary = [
      { bucket: "28 plus days", rentalsOpen: snapshot.bucket28Plus, percentOfTotal: snapshot.grandTotal > 0 ? snapshot.bucket28Plus / snapshot.grandTotal : 0, avgDaysOpen: 0 },
      { bucket: "21 plus days", rentalsOpen: snapshot.bucket21To27, percentOfTotal: snapshot.grandTotal > 0 ? snapshot.bucket21To27 / snapshot.grandTotal : 0, avgDaysOpen: 0 },
      { bucket: "14 plus days", rentalsOpen: snapshot.bucket14To20, percentOfTotal: snapshot.grandTotal > 0 ? snapshot.bucket14To20 / snapshot.grandTotal : 0, avgDaysOpen: 0 },
      { bucket: "Less than 14 days", rentalsOpen: snapshot.bucketUnder14, percentOfTotal: snapshot.grandTotal > 0 ? snapshot.bucketUnder14 / snapshot.grandTotal : 0, avgDaysOpen: 0 },
    ];

    // Build progress history from historical snapshots
    const progressHistory = historicalSnapshots.map(snap => ({
      date: snap.snapshotDate,
      buckets: [
        { bucket: "28 plus days" as const, rentalsOpen: snap.bucket28Plus, percentOfTotal: snap.grandTotal > 0 ? snap.bucket28Plus / snap.grandTotal : 0, changeMtd: 0 },
        { bucket: "21 plus days" as const, rentalsOpen: snap.bucket21To27, percentOfTotal: snap.grandTotal > 0 ? snap.bucket21To27 / snap.grandTotal : 0, changeMtd: 0 },
        { bucket: "14 plus days" as const, rentalsOpen: snap.bucket14To20, percentOfTotal: snap.grandTotal > 0 ? snap.bucket14To20 / snap.grandTotal : 0, changeMtd: 0 },
        { bucket: "Less than 14 days" as const, rentalsOpen: snap.bucketUnder14, percentOfTotal: snap.grandTotal > 0 ? snap.bucketUnder14 / snap.grandTotal : 0, changeMtd: 0 },
      ],
      grandTotal: snap.grandTotal,
      totalOver14Days: snap.totalOver14Days,
      percentOver14Days: snap.grandTotal > 0 ? snap.totalOver14Days / snap.grandTotal : 0
    })).sort((a, b) => a.date.localeCompare(b.date));

    return {
      currentSnapshot: {
        date: snapshot.snapshotDate,
        summary,
        grandTotal: snapshot.grandTotal,
        totalOver14Days: snapshot.totalOver14Days,
        percentOver14Days: snapshot.grandTotal > 0 ? snapshot.totalOver14Days / snapshot.grandTotal : 0,
        enterpriseTotal: snapshot.enterpriseTotal,
        nonEnterpriseTotal: snapshot.nonEnterpriseTotal,
        vendorBreakdown: (snapshot.vendorBreakdown as any[]) || []
      },
      progressHistory,
      rentalDetails,
      lastUpdated: snapshot.createdAt?.toISOString() || new Date().toISOString(),
      isLiveData: false,
      isCachedData: true
    };
  }

  app.get("/api/rental-reduction/dashboard", requireAuth, async (req: any, res) => {
    try {
      // Helper function to return cached data
      const returnCachedData = async () => {
        const historicalSnapshots = await storage.getRentalSnapshots(30);
        if (historicalSnapshots.length === 0) {
          return null; // No cached data available
        }
        // Get the most recent snapshot
        const latestSnapshot = historicalSnapshots[0];
        return await buildDashboardFromCache(latestSnapshot, historicalSnapshots);
      };

      // Check if Snowflake is configured
      if (!isSnowflakeConfigured()) {
        // Try to return cached data when Snowflake is not configured
        console.log('[Rental] Snowflake not configured, checking for cached data...');
        const cachedData = await returnCachedData();
        if (cachedData) {
          console.log('[Rental] Returning cached rental data');
          return res.json(cachedData);
        }
        return res.status(503).json({ 
          message: "Snowflake is not configured and no cached rental data is available.",
          error: "NO_DATA_AVAILABLE"
        });
      }

      // Fetch from Snowflake VW_RENTAL_LIST
      const snowflake = getSnowflakeService();
      
      try {
        let rows: any[] = [];
        try {
          // Try to get data with common column name patterns
          const query = `
            SELECT *
            FROM PARTS_SUPPLYCHAIN.FLEET.VW_RENTAL_LIST
            LIMIT 1000
          `;
          rows = await snowflake.executeQuery(query);
        } catch (queryError: any) {
          console.error('[Rental] Snowflake query failed, checking for cached data:', queryError.message);
          const cachedData = await returnCachedData();
          if (cachedData) {
            console.log('[Rental] Returning cached rental data after Snowflake failure');
            return res.json(cachedData);
          }
          return res.status(503).json({ 
            message: "Failed to fetch rental data from Snowflake and no cached data is available.",
            error: "SNOWFLAKE_ERROR"
          });
        }
        
        if (!rows || rows.length === 0) {
          console.log('[Rental] No rental data returned from Snowflake, checking for cached data');
          const cachedData = await returnCachedData();
          if (cachedData) {
            return res.json(cachedData);
          }
          return res.status(503).json({ 
            message: "No rental data available from Snowflake and no cached data exists.",
            error: "NO_DATA_AVAILABLE"
          });
        }
        
        // Log the first row to see actual column names (for debugging)
        console.log('[Rental] First row columns:', Object.keys(rows[0]));
        
        // Transform Snowflake data to our format using actual column names from VW_RENTAL_LIST
        const rentalDetails = rows.map((row: any) => {
          // Use actual column names from the view
          const truckNumber = row.TRUCK_LISTED_FOR_RENTAL || row.TRUCK_NUMBER || '';
          const rentalStartDate = row.RENTAL_START_DATE || null;
          const rentalDaysBucket = row.RENTAL_DAYS || 'Less than 14 days';
          
          // Calculate days open from the start date if not provided
          let daysOpen = 0;
          if (rentalStartDate) {
            const startDate = new Date(rentalStartDate);
            const today = new Date();
            daysOpen = Math.floor((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
          }
          
          // Map the RENTAL_DAYS bucket to our format - MUTUALLY EXCLUSIVE buckets
          // 28+ days, 21-27 days, 14-20 days, <14 days
          let agingBucket: string;
          if (daysOpen >= 28) {
            agingBucket = '28 plus days';
          } else if (daysOpen >= 21) {
            agingBucket = '21 plus days';  // 21-27 days only
          } else if (daysOpen >= 14) {
            agingBucket = '14 plus days';  // 14-20 days only
          } else {
            agingBucket = 'Less than 14 days';  // 0-13 days
          }
          
          // Determine if Enterprise based on SOURCE column (e.g., "Enterprise" vs other vendors)
          const isEnterprise = row.SOURCE?.toLowerCase()?.includes('enterprise') || false;
          
          return {
            truckNumber,
            rentalStartDate: rentalStartDate ? new Date(rentalStartDate).toISOString() : null,
            rentalDays: agingBucket,
            rentalUnderName: row.RENTAL_UNDER_NAME || null,
            rentalTechEnterpriseId: row.RENTAL_TECH_ENTERPRISE_ID || null,
            truckAssignedToInTpms: row.TRUCK_ASSIGNED_TO_IN_TPMS || null,
            truckAssignedToEnterpriseId: row.TRUCK_ASSIGNED_TO_IN_TPMS_ENTERPRISE_ID || null,
            employmentServiceDate: row.LU_EMPLOYMENT_SERVICE_DATE 
              ? new Date(row.LU_EMPLOYMENT_SERVICE_DATE).toISOString() : null,
            isEnterprise,
            daysOpen,
            source: row.SOURCE || null,
          };
        });

        // Calculate summary statistics and merge with historical data
        const dashboardData = calculateRentalDashboardData(rentalDetails);
        const todayStr = new Date().toISOString().split('T')[0];
        
        // Fetch historical snapshots from database
        try {
          const historicalSnapshots = await storage.getRentalSnapshots(30);
          if (historicalSnapshots.length > 0) {
            // Build progress history from stored snapshots
            const storedHistory = historicalSnapshots.map(snap => ({
              date: snap.snapshotDate,
              buckets: [
                { bucket: "28 plus days" as const, rentalsOpen: snap.bucket28Plus, percentOfTotal: snap.grandTotal > 0 ? snap.bucket28Plus / snap.grandTotal : 0, changeMtd: 0 },
                { bucket: "21 plus days" as const, rentalsOpen: snap.bucket21To27, percentOfTotal: snap.grandTotal > 0 ? snap.bucket21To27 / snap.grandTotal : 0, changeMtd: 0 },
                { bucket: "14 plus days" as const, rentalsOpen: snap.bucket14To20, percentOfTotal: snap.grandTotal > 0 ? snap.bucket14To20 / snap.grandTotal : 0, changeMtd: 0 },
                { bucket: "Less than 14 days" as const, rentalsOpen: snap.bucketUnder14, percentOfTotal: snap.grandTotal > 0 ? snap.bucketUnder14 / snap.grandTotal : 0, changeMtd: 0 },
              ],
              grandTotal: snap.grandTotal,
              totalOver14Days: snap.totalOver14Days,
              percentOver14Days: snap.grandTotal > 0 ? snap.totalOver14Days / snap.grandTotal : 0
            }));
            
            // Dedupe: filter out today's stored snapshot if exists, add current live data
            const historyWithoutToday = storedHistory.filter(s => s.date !== todayStr);
            const currentLiveSnapshot = {
              date: todayStr,
              buckets: dashboardData.currentSnapshot.summary.map(s => ({
                bucket: s.bucket,
                rentalsOpen: s.rentalsOpen,
                percentOfTotal: s.percentOfTotal,
                changeMtd: 0
              })),
              grandTotal: dashboardData.currentSnapshot.grandTotal,
              totalOver14Days: dashboardData.currentSnapshot.totalOver14Days,
              percentOver14Days: dashboardData.currentSnapshot.percentOver14Days
            };
            
            // Merge historical with current live and sort by date
            dashboardData.progressHistory = [...historyWithoutToday, currentLiveSnapshot]
              .sort((a, b) => a.date.localeCompare(b.date));
          }
        } catch (historyError) {
          console.warn('Could not fetch historical snapshots:', historyError);
          // Fallback: ensure progressHistory contains at least current live data
          if (!dashboardData.progressHistory || dashboardData.progressHistory.length === 0) {
            const todayStr = new Date().toISOString().split('T')[0];
            dashboardData.progressHistory = [{
              date: todayStr,
              buckets: dashboardData.currentSnapshot.summary.map(s => ({
                bucket: s.bucket,
                rentalsOpen: s.rentalsOpen,
                percentOfTotal: s.percentOfTotal,
                changeMtd: 0
              })),
              grandTotal: dashboardData.currentSnapshot.grandTotal,
              totalOver14Days: dashboardData.currentSnapshot.totalOver14Days,
              percentOver14Days: dashboardData.currentSnapshot.percentOver14Days
            }];
          }
        }
        
        res.json(dashboardData);
      } catch (error: any) {
        console.error("[Rental] Outer error in rental dashboard:", error);
        // Try to return cached data on error
        const cachedData = await returnCachedData();
        if (cachedData) {
          console.log('[Rental] Returning cached rental data after outer error');
          return res.json(cachedData);
        }
        return res.status(503).json({ 
          message: "Failed to fetch rental data and no cached data is available.",
          error: "FETCH_ERROR"
        });
      }
    } catch (error: any) {
      console.error("Error fetching rental reduction data:", error);
      res.status(500).json({ message: "Failed to fetch rental reduction data", error: error.message });
    }
  });

  // Capture a snapshot of current rental data (for historical tracking)
  app.post("/api/rental-reduction/snapshot", requireAuth, async (req: any, res) => {
    try {
      // Check if Snowflake is configured
      if (!isSnowflakeConfigured()) {
        return res.status(400).json({ message: "Snowflake not configured. Cannot capture live snapshot." });
      }

      // Fetch current data from Snowflake
      const snowflake = getSnowflakeService();
      
      try {
        const query = `
          SELECT *
          FROM PARTS_SUPPLYCHAIN.FLEET.VW_RENTAL_LIST
          LIMIT 1000
        `;
        const rows = await snowflake.executeQuery(query);
        
        if (!rows || rows.length === 0) {
          return res.status(400).json({ message: "No rental data available to snapshot." });
        }
        
        // Transform and calculate statistics
        const rentalDetails = rows.map((row: any) => {
          const truckNumber = row.TRUCK_LISTED_FOR_RENTAL || row.TRUCK_NUMBER || '';
          const rentalStartDate = row.RENTAL_START_DATE || null;
          
          let daysOpen = 0;
          if (rentalStartDate) {
            const startDate = new Date(rentalStartDate);
            const today = new Date();
            daysOpen = Math.floor((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
          }
          
          let agingBucket: string;
          if (daysOpen >= 28) {
            agingBucket = '28 plus days';
          } else if (daysOpen >= 21) {
            agingBucket = '21 plus days';
          } else if (daysOpen >= 14) {
            agingBucket = '14 plus days';
          } else {
            agingBucket = 'Less than 14 days';
          }
          
          const isEnterprise = row.SOURCE?.toLowerCase()?.includes('enterprise') || false;
          
          return {
            truckNumber,
            rentalStartDate: rentalStartDate ? new Date(rentalStartDate).toISOString() : null,
            rentalDays: agingBucket,
            rentalUnderName: row.RENTAL_UNDER_NAME || null,
            rentalTechEnterpriseId: row.RENTAL_TECH_ENTERPRISE_ID || null,
            truckAssignedToInTpms: row.TRUCK_ASSIGNED_TO_IN_TPMS || null,
            truckAssignedToEnterpriseId: row.TRUCK_ASSIGNED_TO_IN_TPMS_ENTERPRISE_ID || null,
            employmentServiceDate: row.LU_EMPLOYMENT_SERVICE_DATE 
              ? new Date(row.LU_EMPLOYMENT_SERVICE_DATE).toISOString() : null,
            isEnterprise,
            daysOpen,
            source: row.SOURCE || null,
          };
        });
        
        // Calculate bucket counts
        const bucket28Plus = rentalDetails.filter(r => r.rentalDays === '28 plus days').length;
        const bucket21To27 = rentalDetails.filter(r => r.rentalDays === '21 plus days').length;
        const bucket14To20 = rentalDetails.filter(r => r.rentalDays === '14 plus days').length;
        const bucketUnder14 = rentalDetails.filter(r => r.rentalDays === 'Less than 14 days').length;
        
        const grandTotal = rentalDetails.length;
        const totalOver14Days = bucket28Plus + bucket21To27 + bucket14To20;
        const enterpriseTotal = rentalDetails.filter(r => r.isEnterprise).length;
        const nonEnterpriseTotal = grandTotal - enterpriseTotal;
        
        // Calculate vendor breakdown
        const vendorCounts = new Map<string, { count: number; totalDays: number; over14: number }>();
        rentalDetails.forEach(r => {
          const vendor = (r as any).source || 'Unknown';
          const existing = vendorCounts.get(vendor) || { count: 0, totalDays: 0, over14: 0 };
          existing.count++;
          existing.totalDays += r.daysOpen || 0;
          if (r.daysOpen >= 14) existing.over14++;
          vendorCounts.set(vendor, existing);
        });
        
        const vendorBreakdown = Array.from(vendorCounts.entries())
          .map(([vendor, stats]) => ({
            vendor,
            count: stats.count,
            percentOfTotal: grandTotal > 0 ? stats.count / grandTotal : 0,
            avgDaysOpen: stats.count > 0 ? stats.totalDays / stats.count : 0,
            over14Days: stats.over14
          }))
          .sort((a, b) => b.count - a.count);
        
        // Save snapshot to database
        const today = new Date().toISOString().split('T')[0];
        const snapshot = await storage.upsertRentalSnapshot({
          snapshotDate: today,
          grandTotal,
          totalOver14Days,
          enterpriseTotal,
          nonEnterpriseTotal,
          bucket28Plus,
          bucket21To27,
          bucket14To20,
          bucketUnder14,
          vendorBreakdown,
          rentalDetails,
        });
        
        res.json({ 
          message: "Snapshot captured successfully",
          snapshotDate: today,
          stats: {
            grandTotal,
            totalOver14Days,
            bucket28Plus,
            bucket21To27,
            bucket14To20,
            bucketUnder14
          },
          snapshotId: snapshot.id
        });
      } catch (queryError: any) {
        console.error('Snowflake query failed during snapshot:', queryError.message);
        res.status(500).json({ message: "Failed to capture snapshot from Snowflake", error: queryError.message });
      }
    } catch (error: any) {
      console.error("Error capturing rental snapshot:", error);
      res.status(500).json({ message: "Failed to capture rental snapshot", error: error.message });
    }
  });

  // Get historical snapshots
  app.get("/api/rental-reduction/snapshots", requireAuth, async (req: any, res) => {
    try {
      const daysBack = parseInt(req.query.daysBack as string) || 30;
      const snapshots = await storage.getRentalSnapshots(daysBack);
      
      res.json({
        count: snapshots.length,
        snapshots: snapshots.map(snap => ({
          id: snap.id,
          date: snap.snapshotDate,
          grandTotal: snap.grandTotal,
          totalOver14Days: snap.totalOver14Days,
          enterpriseTotal: snap.enterpriseTotal,
          nonEnterpriseTotal: snap.nonEnterpriseTotal,
          bucket28Plus: snap.bucket28Plus,
          bucket21To27: snap.bucket21To27,
          bucket14To20: snap.bucket14To20,
          bucketUnder14: snap.bucketUnder14,
          createdAt: snap.createdAt
        }))
      });
    } catch (error: any) {
      console.error("Error fetching rental snapshots:", error);
      res.status(500).json({ message: "Failed to fetch rental snapshots", error: error.message });
    }
  });

  // Fleet Overview Statistics - Technician and Vehicle Assignment Summary
  app.get("/api/fleet-overview/statistics", requireAuth, async (req: any, res) => {
    try {
      // Generate sample data when Snowflake is not available
      const generateSampleFleetStats = () => ({
        isLiveData: false,
        lastUpdated: new Date().toISOString(),
        technicians: {
          totalActiveTechs: 1639,
          modifiedDutyTechs: 15,
          activeRoutableTechs: 1624,
          byovTechnicians: 92,
          techsRequiringTruck: 1532,
        },
        assignments: {
          trucksAssignedInTpms: 1581,
          trucksAssignedExclByov: 1478,
          techsWithNoTruck: 58,
          modifiedDutyNoTruck: 4,
          activeTechsNeedingTruck: 54,
          techsWithDeclinedRepairTruck: 87,
        },
        vehicles: {
          totalActiveHolmanVehicles: 2116,
          trucksAssigned: 1488,
          sentToAuction: 25,
          declinedRepairUnassigned: 155,
          totalSpares: 448,
        },
      });

      if (!isSnowflakeConfigured()) {
        return res.json(generateSampleFleetStats());
      }

      const snowflake = getSnowflakeService();
      
      try {
        // Query TPMS truck assignment data
        const tpmsQuery = `
          SELECT 
            TRUCK_NUMBER_NORM,
            FULL_NAME,
            ENTERPRISE_ID,
            DISTRICT,
            TECH_NO,
            TRUCK_NO,
            LAST_NAME,
            FIRST_NAME,
            STATUS,
            FILE_DATE
          FROM PARTS_SUPPLYCHAIN.FLEET.VW_TPMS_TRUCK_ASSIGNMENT
        `;
        
        const tpmsRows = await snowflake.executeQuery(tpmsQuery);
        
        if (!tpmsRows || tpmsRows.length === 0) {
          return res.json(generateSampleFleetStats());
        }
        
        // Calculate technician statistics
        const totalActiveTechs = tpmsRows.length;
        
        // Modified duty: techs with STATUS containing 'modified' or 'MD'
        const modifiedDutyTechs = tpmsRows.filter((r: any) => {
          const status = (r.STATUS || '').toLowerCase();
          return status.includes('modified') || status.includes('md') || status === 'mod duty';
        }).length;
        
        // BYOV: techs with STATUS containing 'byov' or specific indicator
        const byovTechnicians = tpmsRows.filter((r: any) => {
          const status = (r.STATUS || '').toLowerCase();
          return status.includes('byov') || status.includes('byo');
        }).length;
        
        const activeRoutableTechs = totalActiveTechs - modifiedDutyTechs;
        
        // Truck assignment analysis
        const techsWithTruck = tpmsRows.filter((r: any) => 
          r.TRUCK_NO && r.TRUCK_NO.toString().trim() !== ''
        ).length;
        
        const techsWithNoTruck = totalActiveTechs - techsWithTruck;
        
        // Modified duty techs without trucks
        const modifiedDutyNoTruck = tpmsRows.filter((r: any) => {
          const status = (r.STATUS || '').toLowerCase();
          const isModDuty = status.includes('modified') || status.includes('md') || status === 'mod duty';
          const noTruck = !r.TRUCK_NO || r.TRUCK_NO.toString().trim() === '';
          return isModDuty && noTruck;
        }).length;
        
        // Techs requiring truck = total - BYOV
        const techsRequiringTruck = totalActiveTechs - byovTechnicians;
        
        // Assigned trucks excluding BYOV
        const trucksAssignedExclByov = techsWithTruck - tpmsRows.filter((r: any) => {
          const status = (r.STATUS || '').toLowerCase();
          const isByov = status.includes('byov') || status.includes('byo');
          const hasTruck = r.TRUCK_NO && r.TRUCK_NO.toString().trim() !== '';
          return isByov && hasTruck;
        }).length;
        
        // Active techs needing truck (excl. mod duty)
        const activeTechsNeedingTruck = tpmsRows.filter((r: any) => {
          const status = (r.STATUS || '').toLowerCase();
          const isModDuty = status.includes('modified') || status.includes('md') || status === 'mod duty';
          const isByov = status.includes('byov') || status.includes('byo');
          const noTruck = !r.TRUCK_NO || r.TRUCK_NO.toString().trim() === '';
          return !isModDuty && !isByov && noTruck;
        }).length;
        
        // Get Holman vehicle statistics from cache using db directly
        // Filter to match Holman sync service: isActive=true, statusCode=1, allowed divisions
        const { holmanVehiclesCache } = await import('@shared/schema');
        const ALLOWED_DIVISIONS = ['01', 'RF'];
        const holmanVehicles = await db
          .select()
          .from(holmanVehiclesCache)
          .where(and(
            eq(holmanVehiclesCache.isActive, true),
            eq(holmanVehiclesCache.statusCode, 1),
            inArray(holmanVehiclesCache.division, ALLOWED_DIVISIONS)
          ));
        
        const totalActiveHolmanVehicles = holmanVehicles.length;
        const trucksAssigned = holmanVehicles.filter((v: any) => 
          (v.holmanTechAssigned && v.holmanTechAssigned.trim() !== '') || 
          (v.tpmsAssignedTechId && v.tpmsAssignedTechId.trim() !== '')
        ).length;
        
        // Note: These would need additional data sources or Holman fields
        const sentToAuction = 0; // Placeholder - needs Holman status field
        const declinedRepairUnassigned = 0; // Placeholder - needs Holman status field
        const techsWithDeclinedRepairTruck = 0; // Placeholder - needs Holman status field
        const totalSpares = totalActiveHolmanVehicles - trucksAssigned;
        
        res.json({
          isLiveData: true,
          lastUpdated: new Date().toISOString(),
          technicians: {
            totalActiveTechs,
            modifiedDutyTechs,
            activeRoutableTechs,
            byovTechnicians,
            techsRequiringTruck,
          },
          assignments: {
            trucksAssignedInTpms: techsWithTruck,
            trucksAssignedExclByov,
            techsWithNoTruck,
            modifiedDutyNoTruck,
            activeTechsNeedingTruck,
            techsWithDeclinedRepairTruck,
          },
          vehicles: {
            totalActiveHolmanVehicles,
            trucksAssigned,
            sentToAuction,
            declinedRepairUnassigned,
            totalSpares,
          },
        });
      } catch (queryError: any) {
        console.error('Snowflake query failed for fleet statistics:', queryError.message);
        return res.json(generateSampleFleetStats());
      }
    } catch (error: any) {
      console.error("Error fetching fleet overview statistics:", error);
      res.status(500).json({ message: "Failed to fetch fleet statistics", error: error.message });
    }
  });

  // ========================================
  // Communication Hub API Routes (Developer-only)
  // ========================================
  
  const requireDeveloperRole = async (req: any, res: any): Promise<boolean> => {
    const cookieHeader = req.headers.cookie;
    const sessionId = cookieHeader?.match(/sessionId=([^;]+)/)?.[1];
    
    if (!sessionId) {
      res.status(401).json({ message: "Authentication required" });
      return false;
    }
    
    try {
      const session = await storage.getSession(sessionId);
      if (!session || session.expiresAt < new Date()) {
        if (session) {
          await storage.deleteSession(sessionId);
        }
        res.status(401).json({ message: "Session expired" });
        return false;
      }
      
      const user = await storage.getUser(session.userId);
      if (!user) {
        res.status(401).json({ message: "User not found" });
        return false;
      }
      
      if (user.role !== 'developer') {
        res.status(403).json({ message: "Developer role required" });
        return false;
      }
      
      req.user = user;
      return true;
    } catch (error) {
      res.status(401).json({ message: "Authentication failed" });
      return false;
    }
  };
  
  app.get("/api/communication/templates", async (req, res) => {
    if (!await requireDeveloperRole(req, res)) return;
    try {
      const templates = await storage.getCommunicationTemplates();
      res.json(templates);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch templates", error: error.message });
    }
  });

  app.get("/api/communication/templates/:id", async (req, res) => {
    if (!await requireDeveloperRole(req, res)) return;
    try {
      const template = await storage.getCommunicationTemplate(req.params.id);
      if (!template) {
        return res.status(404).json({ message: "Template not found" });
      }
      res.json(template);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch template", error: error.message });
    }
  });

  app.post("/api/communication/templates", async (req, res) => {
    if (!await requireDeveloperRole(req, res)) return;
    try {
      const template = await storage.createCommunicationTemplate(req.body);
      res.status(201).json(template);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to create template", error: error.message });
    }
  });

  app.patch("/api/communication/templates/:id", async (req, res) => {
    if (!await requireDeveloperRole(req, res)) return;
    try {
      const template = await storage.updateCommunicationTemplate(req.params.id, req.body);
      if (!template) {
        return res.status(404).json({ message: "Template not found" });
      }
      res.json(template);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to update template", error: error.message });
    }
  });

  app.delete("/api/communication/templates/:id", async (req, res) => {
    if (!await requireDeveloperRole(req, res)) return;
    try {
      const deleted = await storage.deleteCommunicationTemplate(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Template not found" });
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to delete template", error: error.message });
    }
  });

  app.get("/api/communication/whitelist", async (req, res) => {
    if (!await requireDeveloperRole(req, res)) return;
    try {
      const entries = await storage.getWhitelistEntries();
      res.json(entries);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch whitelist", error: error.message });
    }
  });

  app.post("/api/communication/whitelist", async (req, res) => {
    if (!await requireDeveloperRole(req, res)) return;
    try {
      const entry = await storage.addToWhitelist(req.body);
      res.status(201).json(entry);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to add to whitelist", error: error.message });
    }
  });

  app.delete("/api/communication/whitelist/:id", async (req, res) => {
    if (!await requireDeveloperRole(req, res)) return;
    try {
      const deleted = await storage.removeFromWhitelist(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Entry not found" });
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to remove from whitelist", error: error.message });
    }
  });

  app.get("/api/communication/logs", async (req, res) => {
    if (!await requireDeveloperRole(req, res)) return;
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
      const logs = await storage.getCommunicationLogs(limit);
      res.json(logs);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch logs", error: error.message });
    }
  });

  app.get("/api/communication/logs/template/:templateId", async (req, res) => {
    if (!await requireDeveloperRole(req, res)) return;
    try {
      const logs = await storage.getCommunicationLogsByTemplate(req.params.templateId);
      res.json(logs);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch logs", error: error.message });
    }
  });

  app.get("/api/communication/logs/recipient/:recipient", async (req, res) => {
    if (!await requireDeveloperRole(req, res)) return;
    try {
      const logs = await storage.getCommunicationLogsByRecipient(req.params.recipient);
      res.json(logs);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch logs", error: error.message });
    }
  });

  app.post("/api/communication/templates/seed", async (req, res) => {
    if (!await requireDeveloperRole(req, res)) return;
    try {
      const { seedDefaultTemplates } = await import("./communication-service");
      const count = await seedDefaultTemplates();
      res.json({ success: true, seeded: count });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to seed templates", error: error.message });
    }
  });

  app.post("/api/communication/preview", async (req, res) => {
    if (!await requireDeveloperRole(req, res)) return;
    try {
      const { templateName, variables } = req.body;
      const { getTemplatePreview } = await import("./communication-service");
      const preview = await getTemplatePreview(templateName, variables || {});
      if (!preview) {
        return res.status(404).json({ message: "Template not found" });
      }
      res.json(preview);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to generate preview", error: error.message });
    }
  });

  app.post("/api/communication/send", async (req, res) => {
    if (!await requireDeveloperRole(req, res)) return;
    try {
      const { templateName, recipient, variables, metadata } = req.body;
      const { sendCommunication } = await import("./communication-service");
      const result = await sendCommunication({ templateName, recipient, variables: variables || {}, metadata });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to send communication", error: error.message });
    }
  });

  app.post("/api/notification-backfill/run", async (req, res) => {
    if (!await requireDeveloperRole(req, res)) return;
    try {
      const { runToolAuditBackfill } = await import("./notification-backfill");
      const result = await runToolAuditBackfill();
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to run notification backfill", error: error.message });
    }
  });

  app.get("/api/notification-backfill/status", async (req, res) => {
    if (!await requireDeveloperRole(req, res)) return;
    try {
      const { getBackfillStatus } = await import("./notification-backfill");
      res.json(getBackfillStatus());
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get backfill status", error: error.message });
    }
  });

  // Vehicle Nexus Data - Nexus-specific vehicle data for offboarding/relocation tracking
  app.post("/api/vehicle-nexus-data/batch", requireAuth, async (req: any, res) => {
    try {
      const { vehicleNumbers } = req.body;
      if (!Array.isArray(vehicleNumbers)) {
        return res.status(400).json({ message: "vehicleNumbers must be an array" });
      }
      const data = await storage.getVehicleNexusDataBatch(vehicleNumbers);
      res.json(data);
    } catch (error: any) {
      console.error("Error fetching vehicle nexus data batch:", error);
      res.status(500).json({ message: "Failed to fetch vehicle nexus data batch", error: error.message });
    }
  });

  app.get("/api/vehicle-nexus-data/:vehicleNumber", requireAuth, async (req: any, res) => {
    try {
      const { vehicleNumber } = req.params;
      const data = await storage.getVehicleNexusData(vehicleNumber);
      res.json(data || null);
    } catch (error: any) {
      console.error("Error fetching vehicle nexus data:", error);
      res.status(500).json({ message: "Failed to fetch vehicle nexus data", error: error.message });
    }
  });

  app.put("/api/vehicle-nexus-data/:vehicleNumber", requireAuth, async (req: any, res) => {
    try {
      const { vehicleNumber } = req.params;
      const { postOffboardedStatus, nexusNewLocation, nexusNewLocationContact, keys, repaired, comments, phoneRecoveryInitiated, toolsPartsLocation, partsRecoveryInitiated } = req.body;
      
      const data = await storage.upsertVehicleNexusData({
        vehicleNumber,
        postOffboardedStatus: postOffboardedStatus || null,
        nexusNewLocation: nexusNewLocation || null,
        nexusNewLocationContact: nexusNewLocationContact || null,
        keys: keys || null,
        repaired: repaired || null,
        comments: comments || null,
        phoneRecoveryInitiated: phoneRecoveryInitiated || null,
        toolsPartsLocation: toolsPartsLocation || null,
        partsRecoveryInitiated: partsRecoveryInitiated || null,
        updatedBy: req.user?.username || 'system',
      });

      // Post to external Fleet Scope API
      try {
        const apiKey = process.env.X_API_Key;
        if (apiKey) {
          const cleanVehicleNumber = toCanonical(vehicleNumber);
          const keysMap: Record<string, string> = {
            'present': 'Present',
            'not_present': 'Not Present',
            'unknown': 'Unknown/would not check',
          };
          
          const repairedMap: Record<string, string> = {
            'complete': 'Complete',
            'in_process': 'In Process',
            'unknown_if_needed': 'Unknown if needed',
            'declined': 'Declined',
          };
          
          const statusMap: Record<string, string> = {
            'reserved_for_new_hire': 'Reserved for new hire',
            'in_repair': 'In repair',
            'declined_repair': 'Declined repair',
            'available_for_rental_pmf': 'Available to assign or send to PMF',
            'sent_to_pmf': 'Sent to PMF',
            'assigned_to_tech_in_rental': 'Assigned to rental',
            'not_found': 'Not found',
            'sent_to_auction': 'Sent to auction',
            'already_picked_up': 'Already picked up',
            'unable_to_reach': 'Unable to reach',
          };
          
          const fleetScopePayload = {
            keys: keys ? keysMap[keys] || keys : null,
            repaired: repaired ? repairedMap[repaired] || repaired : null,
            contact: nexusNewLocationContact || null,
            confirmedAddress: nexusNewLocation || null,
            generalComments: comments || null,
            fleetTeamComments: postOffboardedStatus ? statusMap[postOffboardedStatus] || postOffboardedStatus : null,
          };

          const fleetScopeUrl = `https://SHS-Nexus.replit.app/api/fs/public/spares/${cleanVehicleNumber}`;
          
          console.log('=== FLEET SCOPE API REQUEST ===');
          console.log('URL:', fleetScopeUrl);
          console.log('Method: POST');
          console.log('Headers:', { 'Content-Type': 'application/json', 'X-API-Key': '***' });
          console.log('Payload:', JSON.stringify(fleetScopePayload, null, 2));
          console.log('===============================');

          const fleetScopeResponse = await fetch(fleetScopeUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': apiKey,
            },
            body: JSON.stringify(fleetScopePayload),
          });

          const contentType = fleetScopeResponse.headers.get('content-type') || '';
          const responseText = await fleetScopeResponse.text();
          console.log('=== FLEET SCOPE API RESPONSE ===');
          console.log('Status:', fleetScopeResponse.status);
          console.log('Content-Type:', contentType);
          console.log('Response Body:', responseText.substring(0, 500));
          console.log('================================');

          if (contentType.includes('text/html')) {
            console.warn(`Fleet Scope API returned HTML instead of JSON for vehicle ${vehicleNumber} — route may not exist on Fleet Scope`);
          } else if (!fleetScopeResponse.ok) {
            console.warn(`Fleet Scope API returned status ${fleetScopeResponse.status} for vehicle ${vehicleNumber}`);
          } else {
            console.log(`Successfully synced vehicle ${vehicleNumber} to Fleet Scope`);
          }
        } else {
          console.warn('X_API_Key not configured, skipping Fleet Scope sync');
        }
      } catch (fleetScopeError: any) {
        console.error('Fleet Scope API sync failed:', fleetScopeError.message);
      }

      res.json(data);
    } catch (error: any) {
      console.error("Error updating vehicle nexus data:", error);
      res.status(500).json({ message: "Failed to update vehicle nexus data", error: error.message });
    }
  });

  // Offboarding Truck Overrides - shared truck assignments for weekly offboarding
  app.get("/api/offboarding-truck-overrides", requireAuth, async (req: any, res) => {
    try {
      const overrides = await storage.getAllOffboardingTruckOverrides();
      const map: Record<string, string> = {};
      for (const o of overrides) {
        map[o.enterpriseId] = o.truckNumber;
      }
      res.json(map);
    } catch (error: any) {
      console.error("Error fetching truck overrides:", error);
      res.status(500).json({ message: "Failed to fetch truck overrides", error: error.message });
    }
  });

  app.put("/api/offboarding-truck-overrides/:enterpriseId", requireAuth, async (req: any, res) => {
    try {
      const { enterpriseId } = req.params;
      const { truckNumber } = req.body;
      if (!truckNumber || typeof truckNumber !== 'string') {
        return res.status(400).json({ message: "truckNumber is required" });
      }
      const override = await storage.upsertOffboardingTruckOverride({
        enterpriseId,
        truckNumber,
        updatedBy: req.user?.username || 'unknown',
      });
      res.json(override);
    } catch (error: any) {
      console.error("Error saving truck override:", error);
      res.status(500).json({ message: "Failed to save truck override", error: error.message });
    }
  });

  app.delete("/api/offboarding-truck-overrides/:enterpriseId", requireAuth, async (req: any, res) => {
    try {
      const { enterpriseId } = req.params;
      await storage.deleteOffboardingTruckOverride(enterpriseId);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting truck override:", error);
      res.status(500).json({ message: "Failed to delete truck override", error: error.message });
    }
  });

  // Weekly Offboarding - Get term roster from Snowflake view with contact info
  // Weekly Offboarding - XLSX Export
  app.get("/api/weekly-offboarding/export.xlsx", requireAuth, async (req: any, res) => {
    try {
      const { getSnowflakeService } = await import("./snowflake-service");
      const snowflakeService = getSnowflakeService();

      const query = `
        WITH active_trucks AS (
          SELECT DISTINCT TRUCK_LU
          FROM PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT
          WHERE TRUCK_LU IS NOT NULL
        )
        SELECT 
          t.EMPL_NAME,
          t.ENTERPRISE_ID,
          t.EMPLID,
          t.EMPL_STATUS,
          t.EFFDT,
          t.LAST_DATE_WORKED,
          t.PLANNING_AREA,
          t.TECH_SPECIALTY,
          c.SNSTV_HOME_ADDR1,
          c.SNSTV_HOME_ADDR2,
          c.SNSTV_HOME_CITY,
          c.SNSTV_HOME_STATE,
          c.SNSTV_HOME_POSTAL,
          c.SNSTV_MAIN_PHONE,
          c.SNSTV_CELL_PHONE,
          c.SNSTV_HOME_PHONE,
          -- Informational-only: last snapshot truck from TPMS_EXTRACT_LAST_ASSIGNED, not current assignment
          tpms.TRUCK_LU AS LAST_KNOWN_TRUCK_LU,
          tpms.FILE_DATE AS LAST_KNOWN_TRUCK_FILE_DATE
        FROM PRD_TECH_RECRUITMENT.BATCH_VIEWS.ORA_TECH_TERM_ROSTER_VW_VIEW t
        LEFT JOIN PRD_TECH_RECRUITMENT.BATCH_VIEWS.ORA_TECH_LAST_KNOWN_CONTACT_VW_VIEW c
          ON t.EMPLID = c.EMPLID
        LEFT JOIN PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT_LAST_ASSIGNED tpms
          ON UPPER(t.ENTERPRISE_ID) = UPPER(tpms.ENTERPRISE_ID)
        LEFT JOIN active_trucks at
          ON tpms.TRUCK_LU = at.TRUCK_LU
        WHERE t.LAST_DATE_WORKED >= '2026-01-01'
          AND (tpms.TRUCK_LU IS NULL OR at.TRUCK_LU IS NULL)
        ORDER BY t.LAST_DATE_WORKED DESC
      `;

      const rows = await snowflakeService.executeQuery(query) as Array<{
        EMPL_NAME: string; ENTERPRISE_ID: string; EMPLID: string; EMPL_STATUS: string;
        EFFDT: string; LAST_DATE_WORKED: string; PLANNING_AREA: string; TECH_SPECIALTY: string;
        SNSTV_HOME_ADDR1: string; SNSTV_HOME_ADDR2: string; SNSTV_HOME_CITY: string;
        SNSTV_HOME_STATE: string; SNSTV_HOME_POSTAL: string; SNSTV_MAIN_PHONE: string;
        SNSTV_CELL_PHONE: string; SNSTV_HOME_PHONE: string; LAST_KNOWN_TRUCK_LU: string;
        LAST_KNOWN_TRUCK_FILE_DATE: string;
      }>;

      const formatPhone = (phone: string | null | undefined): string | null => {
        if (!phone) return null;
        const digits = phone.replace(/\D/g, '');
        if (digits.length === 10) return `(${digits.slice(0,3)})${digits.slice(3,6)}-${digits.slice(6)}`;
        if (digits.length === 11 && digits[0] === '1') return `(${digits.slice(1,4)})${digits.slice(4,7)}-${digits.slice(7)}`;
        return phone;
      };

      const planningAreaOwnerMap: Record<string, string> = {
        '3132': 'Rob & Andrea', '3580': 'Monica, Cheryl & Machell', '4766': 'Rob & Andrea',
        '6141': 'Monica, Cheryl & Machell', '7084': 'Rob & Andrea', '7088': 'Carol & Tasha',
        '7108': 'Carol & Tasha', '7323': 'Monica, Cheryl & Machell', '7435': 'Rob & Andrea',
        '7670': 'Rob & Andrea', '7744': 'Rob & Andrea', '7983': 'Rob & Andrea',
        '7995': 'Carol & Tasha', '8035': 'Rob & Andrea', '8096': 'Monica, Cheryl & Machell',
        '8107': 'Carol & Tasha', '8147': 'Carol & Tasha', '8158': 'Carol & Tasha',
        '8162': 'Monica, Cheryl & Machell', '8169': 'Carol & Tasha', '8175': 'Rob & Andrea',
        '8184': 'Carol & Tasha', '8206': 'Monica, Cheryl & Machell', '8220': 'Monica, Cheryl & Machell',
        '8228': 'Carol & Tasha', '8309': 'Monica, Cheryl & Machell', '8366': 'Carol & Tasha',
        '8380': 'Rob & Andrea', '8420': 'Monica, Cheryl & Machell', '8555': 'Monica, Cheryl & Machell',
        '8935': 'Monica, Cheryl & Machell',
      };
      const getOwner = (pa: string | null | undefined) => {
        if (!pa) return 'Unknown';
        return planningAreaOwnerMap[pa.replace(/\D/g, '').slice(0, 4)] || 'Unknown';
      };

      // Fetch truck overrides and nexus data from DB
      const allOverrides = await db.select().from(offboardingTruckOverrides);
      const overrideMap = Object.fromEntries(allOverrides.map(o => [o.enterpriseId, o.truckNumber]));

      const truckNumbers = Array.from(new Set(
        rows.flatMap(r => {
          const t = r.LAST_KNOWN_TRUCK_LU || overrideMap[(r.ENTERPRISE_ID || '').toUpperCase()];
          return t ? [t] : [];
        })
      ));

      let nexusMap = new Map<string, { postOffboardedStatus: string | null; comments: string | null; nexusNewLocation: string | null; updatedBy: string | null }>();
      if (truckNumbers.length > 0) {
        const nexusRows = await db.select().from(vehicleNexusData)
          .where(inArray(vehicleNexusData.vehicleNumber, truckNumbers));
        nexusRows.forEach(n => nexusMap.set(n.vehicleNumber, {
          postOffboardedStatus: n.postOffboardedStatus ?? null,
          comments: n.comments ?? null,
          nexusNewLocation: n.nexusNewLocation ?? null,
          updatedBy: n.updatedBy ?? null,
        }));
      }

      const manualStatusLabels: Record<string, string> = {
        'reserved_for_new_hire': 'Reserved for new hire', 'in_repair': 'In repair',
        'declined_repair': 'Declined repair', 'available_for_rental_pmf': 'Available to assign or send to PMF',
        'sent_to_pmf': 'Sent to PMF', 'assigned_to_tech_in_rental': 'Assigned to rental',
        'assigned_to_tech': 'Assigned to tech', 'not_found': 'Not found',
        'sent_to_auction': 'Sent to auction', 'already_picked_up': 'Already picked up',
        'unable_to_reach': 'Unable to reach', 'byov': 'BYOV',
      };

      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Nexus';
      workbook.created = new Date();
      const sheet = workbook.addWorksheet('Weekly Offboarding', { views: [{ state: 'frozen', ySplit: 1 }] });

      sheet.columns = [
        { header: 'Employee Name',   key: 'emplName',       width: 28 },
        { header: 'Enterprise ID',   key: 'enterpriseId',   width: 16 },
        { header: 'Employee ID',     key: 'emplId',         width: 14 },
        { header: 'Status',          key: 'emplStatus',     width: 14 },
        { header: 'Effective Date',  key: 'effdt',          width: 16 },
        { header: 'Last Date Worked',key: 'lastDateWorked', width: 18 },
        { header: 'Planning Area',   key: 'planningArea',   width: 16 },
        { header: 'Owner',           key: 'owner',          width: 26 },
        { header: 'Tech Specialty',  key: 'techSpecialty',  width: 20 },
        { header: 'Last Known Truck',           key: 'lastKnownTruckLu',       width: 14 },
        { header: 'Last Known Truck File Date', key: 'lastKnownTruckFileDate', width: 22 },
        { header: 'Manual Status',   key: 'manualStatus',   width: 36 },
        { header: 'Nexus Location',  key: 'nexusLocation',  width: 24 },
        { header: 'Nexus Comments',  key: 'nexusComments',  width: 40 },
        { header: 'Updated By',      key: 'updatedBy',      width: 18 },
        { header: 'Address',         key: 'address',        width: 40 },
        { header: 'Contact Phone',   key: 'contactPhone',   width: 30 },
      ];

      // Style header row
      const headerRow = sheet.getRow(1);
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB91C1C' } };
      headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      headerRow.height = 20;

      const toDateStr = (val: any): string => {
        if (!val) return '';
        if (val instanceof Date) return val.toISOString().split('T')[0];
        const s = String(val);
        return s.includes('T') ? s.split('T')[0] : s.split(' ')[0];
      };

      for (const row of rows) {
        const addressParts = [row.SNSTV_HOME_ADDR1, row.SNSTV_HOME_ADDR2, row.SNSTV_HOME_CITY, row.SNSTV_HOME_STATE, row.SNSTV_HOME_POSTAL].filter(Boolean);
        const phoneParts = [formatPhone(row.SNSTV_MAIN_PHONE), formatPhone(row.SNSTV_CELL_PHONE), formatPhone(row.SNSTV_HOME_PHONE)].filter(Boolean);
        const lastKnownTruckLu = row.LAST_KNOWN_TRUCK_LU || overrideMap[(row.ENTERPRISE_ID || '').toUpperCase()] || '';
        const nexus = lastKnownTruckLu ? nexusMap.get(lastKnownTruckLu) : null;
        const rawStatus = nexus?.postOffboardedStatus || '';

        const dataRow = sheet.addRow({
          emplName: row.EMPL_NAME || '',
          enterpriseId: (row.ENTERPRISE_ID || '').toUpperCase(),
          emplId: row.EMPLID || '',
          emplStatus: row.EMPL_STATUS || '',
          effdt: toDateStr(row.EFFDT),
          lastDateWorked: toDateStr(row.LAST_DATE_WORKED),
          planningArea: row.PLANNING_AREA || '',
          owner: getOwner(row.PLANNING_AREA),
          techSpecialty: row.TECH_SPECIALTY || '',
          lastKnownTruckLu,
          lastKnownTruckFileDate: toDateStr(row.LAST_KNOWN_TRUCK_FILE_DATE),
          manualStatus: rawStatus ? (manualStatusLabels[rawStatus] || rawStatus) : '',
          nexusLocation: nexus?.nexusNewLocation || '',
          nexusComments: nexus?.comments || '',
          updatedBy: nexus?.updatedBy || '',
          address: addressParts.join(', '),
          contactPhone: phoneParts.join(' / '),
        });
        dataRow.alignment = { vertical: 'top', wrapText: false };
      }

      // Freeze + auto-filter
      sheet.autoFilter = { from: 'A1', to: 'Q1' };

      const timestamp = new Date().toISOString().split('T')[0];
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="weekly_offboarding_${timestamp}.xlsx"`);
      await workbook.xlsx.write(res);
      res.end();
    } catch (error: any) {
      console.error("Error exporting weekly offboarding XLSX:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // AMS API Integration Routes
  console.log("Registering AMS API routes...");

  // In-memory cache for AMS truck status map (VIN → label).
  // `activeVins` is the set of AMS VINs considered active (no SaleDate, no
  // OutofSvcDate, no FinalDisposition) — used to scope the Declined Repair /
  // Sent to Auction counts to active vehicles only.
  let amsTruckStatusCache: {
    data: Record<string, string | null>;
    activeVins: Set<string>;
    vehicleNumberByVin: Record<string, string>;
    activeSweepComplete: boolean;
    builtAt: number;
  } | null = null;
  const AMS_TRUCK_STATUS_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

  // Note: A shared cache module (server/ams-truck-status-cache.ts) mirrors this
  // logic so other route files (e.g. fleet-scope-routes) can read the same data.
  async function buildAmsTruckStatusMap(): Promise<{
    map: Record<string, string | null>;
    activeVins: Set<string>;
    vehicleNumberByVin: Record<string, string>;
    activeSweepComplete: boolean;
  }> {
    console.log('[AMS TruckStatusMap] Building VIN→TruckStatus map...');

    // Step 1: Fetch truck-status lookup to resolve numeric IDs → human-readable labels
    const lookupItems: any[] = await amsApiService.getLookup('truck-status').catch(() => []);
    const lookupMap = new Map<string, string>();
    const skipKeys = new Set(['UniqueID', 'uniqueID', 'Id', 'id']);
    for (const item of lookupItems) {
      const id = String(item.UniqueID ?? item.id ?? '');
      let label: string | undefined;
      for (const [key, val] of Object.entries(item)) {
        if (skipKeys.has(key)) continue;
        if (typeof val === 'string' && val.trim()) { label = val.trim(); break; }
      }
      if (id) lookupMap.set(id, label ?? id);
    }
    console.log(`[AMS TruckStatusMap] Truck-status lookup: ${lookupMap.size} entries`);

    // Step 2: Paginate AMS /api/v1/vehicles endpoint
    const result: Record<string, string | null> = {};
    const activeVins = new Set<string>();
    const vehicleNumberByVin: Record<string, string> = {};
    const pageSize = 500;
    let offset = 0;
    let totalFetched = 0;
    let amsWorked = false;
    // Whether the AMS pagination loop ran to completion (last page returned
    // fewer rows than pageSize). Only when this is true do we trust
    // activeVins as a complete set; partial sweeps must fall back to the
    // unfiltered map so the dependent counts don't silently undercount.
    let activeSweepComplete = false;

    while (true) {
      let raw: any;
      try {
        // 30s per-page timeout so a stalled AMS request can't block the
        // overall build (and the Snowflake supplement that follows).
        raw = await Promise.race([
          amsApiService.searchVehicles({ limit: pageSize, offset }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`AMS page timeout (offset ${offset})`)), 30_000),
          ),
        ]);
      } catch (err: any) {
        console.warn(`[AMS TruckStatusMap] AMS search error at offset ${offset}: ${err.message}`);
        break;
      }

      // Normalise the response — AMS may return [] or { data:[] } or { vehicles:[] } or { results:[] }
      let rows: any[];
      if (Array.isArray(raw)) {
        rows = raw;
      } else if (raw && typeof raw === 'object') {
        rows = Array.isArray(raw.data) ? raw.data
          : Array.isArray(raw.vehicles) ? raw.vehicles
          : Array.isArray(raw.results) ? raw.results
          : Array.isArray(raw.items) ? raw.items
          : [];
        if (rows.length === 0 && offset === 0) {
          // Log the actual response shape so we can debug
          const keys = Object.keys(raw).slice(0, 10);
          console.warn(`[AMS TruckStatusMap] AMS search returned object with keys: ${keys.join(', ')} — no vehicle array found`);
        }
      } else {
        rows = [];
      }

      if (rows.length === 0) break;
      amsWorked = true;

      for (const v of rows) {
        const vin = (v.VIN || v.vin || '').trim().toUpperCase();
        if (!vin) continue;
        const raw_status = v.TruckStatus ?? v.truckStatus ?? v.truck_status;
        if (raw_status == null) {
          result[vin] = null;
        } else {
          const label = lookupMap.get(String(raw_status));
          result[vin] = label ?? String(raw_status);
        }
        // Track "active" status — matches AMS UI's Active count (no SaleDate,
        // no OutofSvcDate, no FinalDisposition). Used to scope the Declined
        // Repair / Sent to Auction counts to active vehicles only.
        // Normalize date/disposition fields: AMS may return empty strings or
        // string numerics, so coerce before testing.
        const saleDate = v.SaleDate;
        const oosDate = v.OutofSvcDate;
        const sold = saleDate != null && String(saleDate).trim() !== '';
        const oos = oosDate != null && String(oosDate).trim() !== '';
        const finalDispNum = Number(v.FinalDisposition ?? 0);
        const finalDisp = Number.isFinite(finalDispNum) && finalDispNum !== 0;
        if (!sold && !oos && !finalDisp) activeVins.add(vin);
        const vn = String(v.VehicleNumber ?? '').trim();
        if (vn) vehicleNumberByVin[vin] = vn;
      }

      totalFetched += rows.length;
      if (rows.length < pageSize) {
        // Last page seen — sweep is complete, activeVins is trustworthy.
        activeSweepComplete = true;
        break;
      }
      offset += pageSize;
    }

    if (amsWorked) {
      console.log(`[AMS TruckStatusMap] Built map from AMS API: ${Object.keys(result).length} vehicles (${totalFetched} rows fetched)`);
      // Supplement with ams_vehicles_cache DB for any VINs the AMS bulk search missed
      try {
        const dbRows = await db
          .select({ vin: amsVehiclesCache.vin, label: amsVehiclesCache.amsTruckStatusLabel })
          .from(amsVehiclesCache)
          .where(isNotNull(amsVehiclesCache.amsTruckStatusLabel));
        let dbAdded = 0;
        for (const row of dbRows) {
          const vin = (row.vin || '').trim().toUpperCase();
          if (vin && !result[vin] && row.label) { result[vin] = row.label; dbAdded++; }
        }
        if (dbAdded > 0) console.log(`[AMS TruckStatusMap] DB supplement: added ${dbAdded} VINs from ams_vehicles_cache`);
      } catch (dbErr: any) {
        console.warn('[AMS TruckStatusMap] DB supplement failed (continuing):', dbErr?.message);
      }
    } else {
      console.log('[AMS TruckStatusMap] AMS API returned 0 vehicles — relying on Snowflake REPLIT_ALL_VEHICLES');
    }

    // Always supplement from Snowflake REPLIT_ALL_VEHICLES. The AMS list and
    // per-VIN endpoints currently return TruckStatus: null for every row, so
    // without this step no statuses (Declined Repair, Sent To Auction, etc.)
    // would surface. Snowflake's TRUCK_STATUS is the source of truth here.
    try {
      const { getSnowflakeService } = await import("./snowflake-service");
      const snowflakeService = getSnowflakeService();
      const sql = `
        SELECT VIN, TRUCK_STATUS
        FROM PARTS_SUPPLYCHAIN.FLEET.REPLIT_ALL_VEHICLES
        WHERE VIN IS NOT NULL
          AND TRUCK_STATUS IS NOT NULL
          AND TRUCK_STATUS != ''
      `;
      const sfRows = await snowflakeService.executeQuery(sql) as Array<{ VIN: string; TRUCK_STATUS: string }>;
      let sfFilled = 0;
      let sfAddedVins = 0;
      for (const row of sfRows) {
        if (!row.VIN) continue;
        const vin = row.VIN.trim().toUpperCase();
        const rawStatus = (row.TRUCK_STATUS || '').trim();
        if (!rawStatus) continue;
        const label = lookupMap.get(rawStatus) ?? rawStatus;
        if (result[vin] == null) {
          if (!(vin in result)) sfAddedVins++;
          result[vin] = label || null;
          sfFilled++;
        }
      }
      console.log(`[AMS TruckStatusMap] Snowflake supplement: filled ${sfFilled} statuses (${sfAddedVins} new VINs) from ${sfRows.length} rows`);
    } catch (sfErr: any) {
      console.warn('[AMS TruckStatusMap] Snowflake supplement failed (continuing):', sfErr?.message);
    }
    console.log(`[AMS TruckStatusMap] Active VINs (per AMS): ${activeVins.size} (sweep complete=${activeSweepComplete})`);
    return { map: result, activeVins, vehicleNumberByVin, activeSweepComplete };
  }

  app.get("/api/ams/truck-status-map", requireAuth, async (_req, res) => {
    try {
      const now = Date.now();
      if (!amsTruckStatusCache || (now - amsTruckStatusCache.builtAt) > AMS_TRUCK_STATUS_CACHE_TTL_MS) {
        const built = await buildAmsTruckStatusMap();
        amsTruckStatusCache = {
          data: built.map,
          activeVins: built.activeVins,
          vehicleNumberByVin: built.vehicleNumberByVin,
          activeSweepComplete: built.activeSweepComplete,
          builtAt: now,
        };
      } else {
        const ageMin = Math.round((now - amsTruckStatusCache.builtAt) / 60000);
        console.log(`[AMS TruckStatusMap] Serving cached map (${Object.keys(amsTruckStatusCache.data).length} vehicles, age ${ageMin}m)`);
      }
      res.json(amsTruckStatusCache.data);
    } catch (error: any) {
      console.error('[AMS TruckStatusMap] Error:', error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/ams/declined-repair-count", requireAuth, async (_req, res) => {
    try {
      const now = Date.now();
      if (!amsTruckStatusCache || (now - amsTruckStatusCache.builtAt) > AMS_TRUCK_STATUS_CACHE_TTL_MS) {
        const built = await buildAmsTruckStatusMap();
        amsTruckStatusCache = {
          data: built.map,
          activeVins: built.activeVins,
          vehicleNumberByVin: built.vehicleNumberByVin,
          activeSweepComplete: built.activeSweepComplete,
          builtAt: now,
        };
      }
      // Restrict the count to AMS-active vehicles (matches AMS UI's Active count:
      // no SaleDate, no OutofSvcDate, no FinalDisposition). Only trust
      // activeVins when the AMS pagination loop ran to completion — a partial
      // sweep would otherwise silently undercount. Fall back to the full map
      // in that case so the card never silently reads 0.
      const activeVins = amsTruckStatusCache.activeVins;
      const useActiveFilter = amsTruckStatusCache.activeSweepComplete && activeVins.size > 0;
      let declinedRepairCount = 0;
      let sentToAuctionCount = 0;
      let activeConsidered = 0;
      for (const [vin, status] of Object.entries(amsTruckStatusCache.data)) {
        if (useActiveFilter && !activeVins.has(vin)) continue;
        activeConsidered++;
        if (!status) continue;
        const s = status.toLowerCase();
        if (s.includes('declined repair')) declinedRepairCount++;
        if (s.includes('sent to auction')) sentToAuctionCount++;
      }
      // `count` retained for backward compatibility with existing callers
      // that expect the legacy declined-repair-only field.
      res.json({
        count: declinedRepairCount,
        declinedRepairCount,
        sentToAuctionCount,
        activeFleetCount: useActiveFilter ? activeVins.size : null,
      });
    } catch (error: any) {
      console.error('[AMS DeclinedRepairCount] Error:', error);
      res.status(500).json({ message: error.message });
    }
  });

  // Active-AMS scorecard counts for the Fleet Scope All Vehicles dashboard.
  // Returns a status→count breakdown over AMS-active vehicles only,
  // excluding any vehicle whose VehicleNumber starts with "88" or "088".
  // Also returns the totals needed by the Total Operational Fleet card.
  app.get("/api/ams/active-scorecard-counts", requireAuth, async (_req, res) => {
    try {
      const now = Date.now();
      if (!amsTruckStatusCache || (now - amsTruckStatusCache.builtAt) > AMS_TRUCK_STATUS_CACHE_TTL_MS) {
        const built = await buildAmsTruckStatusMap();
        amsTruckStatusCache = {
          data: built.map,
          activeVins: built.activeVins,
          vehicleNumberByVin: built.vehicleNumberByVin,
          activeSweepComplete: built.activeSweepComplete,
          builtAt: now,
        };
      }
      const cache = amsTruckStatusCache;
      const useActiveFilter = cache.activeSweepComplete && cache.activeVins.size > 0;
      const isExcluded88 = (vin: string) => {
        const vn = cache.vehicleNumberByVin[vin];
        return !!vn && /^0?88/.test(vn);
      };

      const statusCounts: Record<string, number> = {};
      let activeConsidered = 0;
      let excluded88 = 0;
      let declinedRepair = 0;
      let sentToAuction = 0;

      for (const [vin, status] of Object.entries(cache.data)) {
        if (useActiveFilter && !cache.activeVins.has(vin)) continue;
        if (isExcluded88(vin)) { excluded88++; continue; }
        activeConsidered++;
        const label = (status && status.trim()) ? status.trim() : 'Unknown';
        const lc = label.toLowerCase();
        if (lc.includes('declined repair')) { declinedRepair++; continue; }
        if (lc.includes('sent to auction')) { sentToAuction++; continue; }
        statusCounts[label] = (statusCounts[label] || 0) + 1;
      }

      const totalOperational = Object.values(statusCounts).reduce((a, b) => a + b, 0);
      res.json({
        statusCounts,
        totalOperational,
        declinedRepair,
        sentToAuction,
        excluded88,
        activeFleetCount: useActiveFilter ? cache.activeVins.size : null,
        activeSweepComplete: cache.activeSweepComplete,
      });
    } catch (error: any) {
      console.error('[AMS ActiveScorecardCounts] Error:', error);
      res.status(500).json({ message: error.message });
    }
  });

  // Diagnostic: report Declined Repair / Sent to Auction counts using ONLY the
  // AMS API (no Postgres ams_vehicles_cache, no Snowflake REPLIT_ALL_VEHICLES,
  // no shared in-memory cache). Used to verify the hypothesis that AMS today
  // returns TruckStatus: null for every row, which would mean the production
  // 338 figure is essentially driven by the Snowflake supplement.
  app.get("/api/ams/declined-repair-count/ams-only", requireAuth, async (_req, res) => {
    const startedAt = Date.now();
    console.log('[AMS DeclinedDiag] Starting AMS-only diagnostic run');
    try {
      // 1. Pull the truck-status lookup so we can translate numeric IDs to labels.
      const lookupRaw: any = await amsApiService.getLookup('truck-status').catch((e: any) => {
        console.warn('[AMS DeclinedDiag] truck-status lookup failed:', e?.message);
        return [];
      });
      // Normalize to an array — AMS may return [] or { data|items|results|vehicles: [] }
      const lookupItems: any[] = Array.isArray(lookupRaw)
        ? lookupRaw
        : (lookupRaw && typeof lookupRaw === 'object'
            ? (Array.isArray(lookupRaw.data) ? lookupRaw.data
              : Array.isArray(lookupRaw.items) ? lookupRaw.items
              : Array.isArray(lookupRaw.results) ? lookupRaw.results
              : Array.isArray(lookupRaw.vehicles) ? lookupRaw.vehicles
              : [])
            : []);
      const lookupMap = new Map<string, string>();
      const skipKeys = new Set(['UniqueID', 'uniqueID', 'Id', 'id']);
      for (const item of lookupItems) {
        const id = String(item.UniqueID ?? item.id ?? '');
        let label: string | undefined;
        for (const [key, val] of Object.entries(item)) {
          if (skipKeys.has(key)) continue;
          if (typeof val === 'string' && val.trim()) { label = val.trim(); break; }
        }
        if (id) lookupMap.set(id, label ?? id);
      }
      console.log(`[AMS DeclinedDiag] Truck-status lookup: ${lookupMap.size} entries`);

      // 2. Paginate /api/v1/vehicles, mirroring the production builder's loop shape.
      const pageSize = 500;
      let offset = 0;
      let pagesFetched = 0;
      let totalVinsFromAms = 0;
      let vinsWithNonNullStatus = 0;
      let declinedRepairCount = 0;
      let sentToAuctionCount = 0;
      const statusBreakdown: Record<string, number> = {};
      const seenVins = new Set<string>();
      let pageError: string | null = null;

      while (true) {
        let raw: any;
        try {
          raw = await Promise.race([
            amsApiService.searchVehicles({ limit: pageSize, offset }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error(`AMS page timeout (offset ${offset})`)), 30_000),
            ),
          ]);
        } catch (err: any) {
          pageError = err?.message || String(err);
          console.warn(`[AMS DeclinedDiag] AMS search error at offset ${offset}: ${pageError}`);
          break;
        }

        let rows: any[];
        if (Array.isArray(raw)) {
          rows = raw;
        } else if (raw && typeof raw === 'object') {
          rows = Array.isArray(raw.data) ? raw.data
            : Array.isArray(raw.vehicles) ? raw.vehicles
            : Array.isArray(raw.results) ? raw.results
            : Array.isArray(raw.items) ? raw.items
            : [];
        } else {
          rows = [];
        }

        if (rows.length === 0) break;
        pagesFetched++;

        let pageNonNull = 0;
        for (const v of rows) {
          const vin = (v.VIN || v.vin || '').trim().toUpperCase();
          if (!vin || seenVins.has(vin)) continue;
          seenVins.add(vin);
          totalVinsFromAms++;

          const rawStatus = v.TruckStatus ?? v.truckStatus ?? v.truck_status;
          if (rawStatus == null) continue;

          const label = lookupMap.get(String(rawStatus)) ?? String(rawStatus);
          if (!label || !label.trim()) continue;

          vinsWithNonNullStatus++;
          pageNonNull++;
          statusBreakdown[label] = (statusBreakdown[label] || 0) + 1;
          const lower = label.toLowerCase();
          if (lower.includes('declined repair')) declinedRepairCount++;
          if (lower.includes('sent to auction')) sentToAuctionCount++;
        }

        console.log(
          `[AMS DeclinedDiag] page ${pagesFetched} (offset ${offset}): ${rows.length} rows, ${pageNonNull} non-null statuses`,
        );

        if (rows.length < pageSize) break;
        offset += pageSize;
      }

      const durationMs = Date.now() - startedAt;
      console.log(
        `[AMS DeclinedDiag] Done in ${durationMs}ms — VINs=${totalVinsFromAms}, nonNull=${vinsWithNonNullStatus}, declinedRepair=${declinedRepairCount}, sentToAuction=${sentToAuctionCount}, pages=${pagesFetched}`,
      );

      res.json({
        totalVinsFromAms,
        vinsWithNonNullStatus,
        declinedRepairCount,
        sentToAuctionCount,
        statusBreakdown,
        lookupEntriesLoaded: lookupMap.size,
        pagesFetched,
        durationMs,
        pageError,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('[AMS DeclinedDiag] Error:', error);
      res.status(500).json({ message: error.message });
    }
  });

  // Warm the AMS truck-status cache in the background at startup so the
  // first real request is served instantly from cache.
  setImmediate(() => {
    if (!amsTruckStatusCache) {
      buildAmsTruckStatusMap()
        .then(built => {
          amsTruckStatusCache = {
            data: built.map,
            activeVins: built.activeVins,
            vehicleNumberByVin: built.vehicleNumberByVin,
            activeSweepComplete: built.activeSweepComplete,
            builtAt: Date.now(),
          };
          console.log(`[AMS TruckStatusMap] Cache warmed at startup (${Object.keys(built.map).length} vehicles, ${built.activeVins.size} active, sweep complete=${built.activeSweepComplete})`);
        })
        .catch(err => {
          console.warn('[AMS TruckStatusMap] Startup warm-up failed (will retry on first request):', err.message);
        });
    }
  });

  app.get("/api/ams/test", requireAuth, async (req: any, res) => {
    try {
      const result = await amsApiService.testConnection();
      res.json(result);
    } catch (error) {
      console.error("Error testing AMS connection:", error);
      res.status(500).json({ success: false, message: "Failed to test connection" });
    }
  });

  app.get("/api/ams/status", requireAuth, async (req: any, res) => {
    res.json({ configured: amsApiService.isConfigured() });
  });

  app.get("/api/ams/vehicles", requireAuth, async (req: any, res) => {
    try {
      const { vin, plate, vehicleId, region, district, tech, limit, offset } = req.query;
      const result = await amsApiService.searchVehicles({
        vin, plate, vehicleId, region, district, tech,
        limit: limit ? parseInt(limit) : 100,
        offset: offset ? parseInt(offset) : 0,
      });
      res.json(result);
    } catch (error: any) {
      console.error("Error searching AMS vehicles:", error);
      res.status(500).json({ message: error.message || "Failed to search vehicles" });
    }
  });

  app.get("/api/ams/vehicles/:vin", requireAuth, async (req: any, res) => {
    try {
      const result = await amsApiService.getVehicleByVin(req.params.vin);
      const keyFields = Object.keys(result || {}).filter(k => k.toLowerCase().includes('key'));
      if (keyFields.length > 0) {
        console.log(`[AMS] Key-related fields in response for ${req.params.vin}:`, keyFields.map(k => `${k}=${JSON.stringify(result[k])}`).join(', '));
      } else {
        console.log(`[AMS] No key-related fields found in response for ${req.params.vin}. All fields: ${Object.keys(result || {}).join(', ')}`);
      }
      res.json(result);
    } catch (error: any) {
      console.error("Error fetching AMS vehicle:", error);
      res.status(500).json({ message: error.message || "Failed to fetch vehicle" });
    }
  });

  // GET /api/ams/by-truck/:truckNumber — single-call snapshot (vehicle + full comments) for repair tracker drawer
  app.get("/api/ams/by-truck/:truckNumber", requireAuth, async (req: any, res) => {
    const truckNumber = String(req.params.truckNumber ?? "").trim();
    if (!truckNumber) return res.status(400).json({ error: "truckNumber required" });
    // Version tag so we can verify from the UI that the latest handler code is
    // actually running in whatever environment we're looking at. Bump when changing.
    const BUILD_TAG = "v4-ltrim";
    // Declared outside the try so the outer catch can still include the
    // diagnostic trail when something throws unexpectedly.
    let vin: string | null = null;
    let vinSource: string = "none";
    const diag: string[] = [];
    try {
      if (!amsApiService.isConfigured()) {
        return res.json({ found: false, linkMissing: true, vehicle: null, comments: [], reason: `AMS not configured [${BUILD_TAG}]` });
      }
      // Resolve VIN using the same sources Fleet Management uses, in order of
      // reliability. AMS's /vehicles?vehicleId=N search endpoint has been
      // returning intermittent 500s; the per-VIN AMS endpoints
      // (/vehicles/:vin and /vehicles/:vin/comments) are the ones Fleet
      // Management successfully calls with a VIN from Holman.
      const normalized = truckNumber.replace(/^0+/, '') || truckNumber;
      const candidates = Array.from(new Set([
        truckNumber,
        normalized,
        normalized.padStart(5, '0'),
        normalized.padStart(6, '0'),
      ]));

      // 1) Holman vehicles cache — Fleet Management's source of truth for VIN.
      // Match on leading-zero-normalized value so any padding variant Holman
      // returns (e.g., "46688", "046688", "0046688") resolves the same row.
      try {
        const hRows = await db
          .select({ vin: holmanVehiclesCache.vin, ref: holmanVehiclesCache.holmanVehicleRef, num: holmanVehiclesCache.holmanVehicleNumber })
          .from(holmanVehiclesCache)
          .where(sql`(
            LTRIM(${holmanVehiclesCache.holmanVehicleNumber}, '0') = ${normalized}
            OR LTRIM(COALESCE(${holmanVehiclesCache.holmanVehicleRef}, ''), '0') = ${normalized}
          )`);
        const hit = hRows.find(r => r.vin && r.vin.trim());
        if (hit?.vin) {
          vin = hit.vin.trim().toUpperCase();
          vinSource = "holman";
          diag.push(`Holman hit (vin ok, stored as ${hit.num ?? hit.ref})`);
        } else if (hRows.length > 0) {
          diag.push(`Holman matched ${hRows.length} row(s) but no VIN (stored as ${hRows[0].num ?? hRows[0].ref})`);
        } else {
          diag.push(`Holman no match (tried LTRIM='${normalized}')`);
        }
      } catch (hErr: any) {
        diag.push(`Holman error: ${hErr.message?.slice(0, 80) ?? ""}`);
        console.warn(`[AMS by-truck] Holman VIN lookup failed for ${truckNumber}:`, hErr.message);
      }

      // 2) Fleet Scope's fs_trucks.vin (some trucks are in Fleet Scope but not Holman).
      if (!vin) {
        try {
          const { trucks } = await import("@shared/fleet-scope-schema");
          const rows = await fsDb
            .select({ vin: trucks.vin, num: trucks.truckNumber })
            .from(trucks)
            .where(sql`LTRIM(${trucks.truckNumber}, '0') = ${normalized}`);
          const withVin = rows.find(r => r.vin && r.vin.trim());
          if (withVin?.vin) {
            vin = withVin.vin.trim().toUpperCase();
            vinSource = "fleet-scope";
            diag.push(`Fleet Scope hit (vin ok)`);
          } else if (rows.length > 0) {
            diag.push(`Fleet Scope matched ${rows.length} row(s) but no VIN`);
          } else {
            diag.push(`Fleet Scope no match`);
          }
        } catch (fsErr: any) {
          diag.push(`Fleet Scope error: ${fsErr.message?.slice(0, 80) ?? ""}`);
          console.warn(`[AMS by-truck] Fleet Scope VIN lookup failed for ${truckNumber}:`, fsErr.message);
        }
      }

      // 3) Last resort: AMS search by vehicleId (flaky, may 500).
      if (!vin) {
        try {
          vin = await lookupAmsVinByTruckNumber(truckNumber, amsApiService);
          if (vin) {
            vinSource = "ams-search";
            diag.push(`AMS search hit`);
          } else {
            diag.push(`AMS search no match`);
          }
        } catch {
          diag.push(`AMS search error`);
        }
      }

      console.log(`[AMS by-truck] ${truckNumber} → vin=${vin ?? "null"} (source=${vinSource}, candidates=${candidates.join(",")})`);
      if (!vin) {
        return res.json({
          found: false,
          linkMissing: true,
          vehicle: null,
          comments: [],
          reason: `No VIN for #${truckNumber} [${BUILD_TAG}] — ${diag.join("; ")}`,
        });
      }
      const [vehicleResult, commentsResult] = await Promise.allSettled([
        amsApiService.getVehicleByVin(vin),
        amsApiService.getComments(vin),
      ]);
      const vehicle = vehicleResult.status === "fulfilled" ? vehicleResult.value : null;
      const rawComments = commentsResult.status === "fulfilled" ? commentsResult.value : [];
      const comments: any[] = Array.isArray(rawComments)
        ? rawComments
        : (rawComments?.data ?? rawComments?.comments ?? rawComments?.results ?? rawComments?.items ?? []);
      if (!vehicle) {
        return res.json({ found: false, linkMissing: true, vin, vehicle: null, comments: [], reason: "Vehicle not found in AMS" });
      }
      res.json({ found: true, linkMissing: false, vin, vehicle, comments });
    } catch (error: any) {
      // AMS upstream failures (5xx, timeouts) shouldn't surface as our own 500
      // — the drawer already has a graceful linkMissing fallback that renders
      // a soft "AMS link missing — <reason>" panel. Include the diagnostic
      // trail we built before the throw so we can see how far we got.
      console.error(`[AMS by-truck] ${truckNumber}:`, error);
      const diagTail = diag.length > 0 ? ` | diag: ${diag.join("; ")}` : "";
      const vinInfo = vin ? ` | vin=${vin} (source=${vinSource})` : "";
      res.status(200).json({
        found: false,
        linkMissing: true,
        vehicle: null,
        comments: [],
        reason: `AMS upstream unavailable [${BUILD_TAG}] — ${error.message}${vinInfo}${diagTail}`,
      });
    }
  });

  app.get("/api/ams/vehicles/:vin/summary", requireAuth, async (req: any, res) => {
    try {
      if (!amsApiService.isConfigured()) {
        return res.json({ found: false, vehicle: null, recentComments: [], reason: "AMS not configured" });
      }
      const [vehicleResult, commentsResult] = await Promise.allSettled([
        amsApiService.getVehicleByVin(req.params.vin),
        amsApiService.getComments(req.params.vin),
      ]);
      const vehicle = vehicleResult.status === 'fulfilled' ? vehicleResult.value : null;
      if (!vehicle) {
        return res.json({ found: false, vehicle: null, recentComments: [], reason: "Vehicle not found in AMS" });
      }
      const allComments = commentsResult.status === 'fulfilled' ? commentsResult.value : [];
      const recentComments = Array.isArray(allComments) ? allComments.slice(0, 5) : [];
      res.json({ found: true, vehicle, recentComments });
    } catch (error: any) {
      console.error("Error fetching AMS vehicle summary:", error);
      res.json({ found: false, vehicle: null, recentComments: [], reason: error.message });
    }
  });

  app.post("/api/ams/vehicles/:vin/user-updates", requireAuth, async (req: any, res) => {
    try {
      const result = await amsApiService.updateUserFields(req.params.vin, req.body);
      res.json(result);
    } catch (error: any) {
      console.error("Error updating AMS vehicle fields:", error);
      res.status(500).json({ message: error.message || "Failed to update vehicle fields" });
    }
  });

  app.post("/api/ams/vehicles/:vin/tech-update", requireAuth, async (req: any, res) => {
    try {
      const result = await amsApiService.updateTechAssignment(req.params.vin, req.body);
      res.json(result);
    } catch (error: any) {
      console.error("Error updating AMS tech assignment:", error);
      res.status(500).json({ message: error.message || "Failed to update tech assignment" });
    }
  });

  app.post("/api/ams/vehicles/:vin/comments", requireAuth, async (req: any, res) => {
    try {
      const body = { ...req.body, user: req.user.username };
      const result = await amsApiService.addComment(req.params.vin, body);
      res.json(result);
    } catch (error: any) {
      console.error("Error adding AMS comment:", error);
      res.status(500).json({ message: error.message || "Failed to add comment" });
    }
  });

  app.get("/api/ams/vehicles/:vin/comments", requireAuth, async (req: any, res) => {
    try {
      const result = await amsApiService.getComments(req.params.vin);
      console.log(`[AMS-Comments] VIN=${req.params.vin} response type=${typeof result} isArray=${Array.isArray(result)} keys=${result && typeof result === 'object' ? Object.keys(result).join(',') : 'N/A'} firstItem=${JSON.stringify(result && (Array.isArray(result) ? result[0] : Object.values(result)[0]))?.slice(0,200)}`);
      res.json(result);
    } catch (error: any) {
      console.error("Error fetching AMS comments:", error);
      res.status(500).json({ message: error.message || "Failed to fetch comments" });
    }
  });

  app.post("/api/ams/vehicles/:vin/repair-updates", requireAuth, async (req: any, res) => {
    try {
      const result = await amsApiService.updateRepairStatus(req.params.vin, req.body);
      res.json(result);
    } catch (error: any) {
      console.error("Error updating AMS repair status:", error);
      res.status(500).json({ message: error.message || "Failed to update repair status" });
    }
  });

  app.post("/api/ams/vehicles/:vin/repair-disposition", requireAuth, async (req: any, res) => {
    try {
      const result = await amsApiService.completeRepair(req.params.vin, req.body);
      res.json(result);
    } catch (error: any) {
      console.error("Error completing AMS repair:", error);
      res.status(500).json({ message: error.message || "Failed to complete repair" });
    }
  });

  app.get("/api/ams/techs", requireAuth, async (req: any, res) => {
    try {
      const { techName, ldapId, lastUpdateAfter, lastUpdateBefore, limit, offset } = req.query;
      const result = await amsApiService.searchTechs({
        techName, ldapId, lastUpdateAfter, lastUpdateBefore,
        limit: limit ? parseInt(limit) : 100,
        offset: offset ? parseInt(offset) : 0,
      });
      res.json(result);
    } catch (error: any) {
      console.error("Error searching AMS techs:", error);
      res.status(500).json({ message: error.message || "Failed to search technicians" });
    }
  });

  app.get("/api/ams/lookups/:type", requireAuth, async (req: any, res) => {
    try {
      const validTypes = [
        'colors', 'branding', 'interior', 'sct-tune', 'grades',
        'vehicle-runs', 'vehicle-looks', 'service-reasons',
        'repair-status', 'repair-disposition', 'disposition-reasons', 'rental-car',
        'truck-status'
      ];
      if (!validTypes.includes(req.params.type)) {
        return res.status(400).json({ message: `Invalid lookup type. Valid types: ${validTypes.join(', ')}` });
      }
      const result = await amsApiService.getLookup(req.params.type);
      res.json(result);
    } catch (error: any) {
      console.error("Error fetching AMS lookup:", error);
      res.status(500).json({ message: error.message || "Failed to fetch lookup data" });
    }
  });

  // ============================================
  // Segno (SugarCRM) API Routes
  // ============================================
  console.log("Registering Segno API routes...");

  app.get("/api/segno/status", requireAuth, async (req: any, res) => {
    try {
      const status = await segnoApiService.getStatus();
      res.json(status);
    } catch (error: any) {
      res.json({ configured: false, message: error.message });
    }
  });

  app.post("/api/segno/test", requireAuth, async (req: any, res) => {
    try {
      const result = await segnoApiService.testConnection();
      res.json(result);
    } catch (error: any) {
      res.json({ success: false, message: error.message });
    }
  });

  app.get("/api/segno/onboarding", requireAuth, async (req: any, res) => {
    try {
      const offset = parseInt(req.query.offset as string) || 0;
      const maxResults = parseInt(req.query.max as string) || 100;
      const result = await segnoApiService.getOnboardingList({ offset, maxResults });
      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error("Error fetching Segno onboarding list:", error);
      res.status(500).json({ success: false, message: error.message, records: [], totalCount: 0, nextOffset: 0 });
    }
  });

  app.get("/api/segno/onboarding/search", requireAuth, async (req: any, res) => {
    try {
      const q = (req.query.q as string) || "";
      if (!q.trim()) return res.json({ success: true, records: [] });
      const records = await segnoApiService.searchOnboarding(q.trim());
      res.json({ success: true, records });
    } catch (error: any) {
      console.error("Error searching Segno onboarding:", error);
      res.status(500).json({ success: false, message: error.message, records: [] });
    }
  });

  app.get("/api/segno/onboarding/by-employee/:employeeId", requireAuth, async (req: any, res) => {
    try {
      const records = await segnoApiService.searchOnboardingByEmployeeId(req.params.employeeId);
      res.json({ success: true, records });
    } catch (error: any) {
      console.error("Error looking up Segno onboarding by employee ID:", error);
      res.status(500).json({ success: false, message: error.message, records: [] });
    }
  });

  app.get("/api/segno/onboarding/by-enterprise/:enterpriseId", requireAuth, async (req: any, res) => {
    try {
      const records = await segnoApiService.searchOnboardingByEnterpriseId(req.params.enterpriseId);
      res.json({ success: true, records });
    } catch (error: any) {
      console.error("Error looking up Segno onboarding by enterprise ID:", error);
      res.status(500).json({ success: false, message: error.message, records: [] });
    }
  });

  app.get("/api/segno/onboarding/:id", requireAuth, async (req: any, res) => {
    try {
      const record = await segnoApiService.getOnboardingById(req.params.id);
      if (!record) return res.status(404).json({ success: false, message: "Record not found" });
      res.json({ success: true, record });
    } catch (error: any) {
      console.error("Error fetching Segno onboarding record:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post("/api/segno/onboarding", requireAuth, async (req: any, res) => {
    try {
      const result = await segnoApiService.createOnboardingRecord(req.body);
      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error("Error creating Segno onboarding record:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.patch("/api/segno/onboarding/:id", requireAuth, async (req: any, res) => {
    try {
      const result = await segnoApiService.updateOnboardingRecord(req.params.id, req.body);
      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error("Error updating Segno onboarding record:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.delete("/api/segno/onboarding/:id", requireAuth, async (req: any, res) => {
    try {
      const result = await segnoApiService.deleteOnboardingRecord(req.params.id);
      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error("Error deleting Segno onboarding record:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // FP_events routes
  app.get("/api/segno/events", requireAuth, async (req: any, res) => {
    try {
      const offset = parseInt(req.query.offset as string) || 0;
      const maxResults = parseInt(req.query.max as string) || 50;
      const result = await segnoApiService.getEventsList({ offset, maxResults });
      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error("Error fetching Segno events:", error);
      res.status(500).json({ success: false, message: error.message, records: [], totalCount: 0, nextOffset: 0 });
    }
  });

  app.get("/api/segno/events/search", requireAuth, async (req: any, res) => {
    try {
      const q = (req.query.q as string) || "";
      const status = req.query.status as string | undefined;
      const records = await segnoApiService.searchEvents(q, status);
      res.json({ success: true, records });
    } catch (error: any) {
      console.error("Error searching Segno events:", error);
      res.status(500).json({ success: false, message: error.message, records: [] });
    }
  });

  app.get("/api/segno/events/by-status/:status", requireAuth, async (req: any, res) => {
    try {
      const records = await segnoApiService.getEventsByStatus(req.params.status);
      res.json({ success: true, records });
    } catch (error: any) {
      console.error("Error fetching Segno events by status:", error);
      res.status(500).json({ success: false, message: error.message, records: [] });
    }
  });

  app.get("/api/segno/events/:id", requireAuth, async (req: any, res) => {
    try {
      const record = await segnoApiService.getEventsById(req.params.id);
      if (!record) return res.status(404).json({ success: false, message: "Event not found" });
      res.json({ success: true, record });
    } catch (error: any) {
      console.error("Error fetching Segno event:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post("/api/segno/events", requireAuth, async (req: any, res) => {
    try {
      const result = await segnoApiService.createEvent(req.body);
      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error("Error creating Segno event:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.patch("/api/segno/events/:id", requireAuth, async (req: any, res) => {
    try {
      const result = await segnoApiService.updateEvent(req.params.id, req.body);
      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error("Error updating Segno event:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.delete("/api/segno/events/:id", requireAuth, async (req: any, res) => {
    try {
      const result = await segnoApiService.deleteEvent(req.params.id);
      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error("Error deleting Segno event:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Asset_Order routes
  app.get("/api/segno/asset-orders", requireAuth, async (req: any, res) => {
    try {
      const offset = parseInt(req.query.offset as string) || 0;
      const maxResults = parseInt(req.query.max as string) || 50;
      const result = await segnoApiService.getAssetOrdersList({ offset, maxResults });
      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error("Error fetching Segno asset orders:", error);
      res.status(500).json({ success: false, message: error.message, records: [], totalCount: 0, nextOffset: 0 });
    }
  });

  app.get("/api/segno/asset-orders/search", requireAuth, async (req: any, res) => {
    try {
      const q = (req.query.q as string) || "";
      if (!q.trim()) return res.json({ success: true, records: [] });
      const records = await segnoApiService.searchAssetOrders(q.trim());
      res.json({ success: true, records });
    } catch (error: any) {
      console.error("Error searching Segno asset orders:", error);
      res.status(500).json({ success: false, message: error.message, records: [] });
    }
  });

  app.get("/api/segno/asset-orders/:id", requireAuth, async (req: any, res) => {
    try {
      const record = await segnoApiService.getAssetOrderById(req.params.id);
      if (!record) return res.status(404).json({ success: false, message: "Asset order not found" });
      res.json({ success: true, record });
    } catch (error: any) {
      console.error("Error fetching Segno asset order:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.post("/api/segno/asset-orders", requireAuth, async (req: any, res) => {
    try {
      const result = await segnoApiService.createAssetOrder(req.body);
      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error("Error creating Segno asset order:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.patch("/api/segno/asset-orders/:id", requireAuth, async (req: any, res) => {
    try {
      const result = await segnoApiService.updateAssetOrder(req.params.id, req.body);
      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error("Error updating Segno asset order:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.delete("/api/segno/asset-orders/:id", requireAuth, async (req: any, res) => {
    try {
      const result = await segnoApiService.deleteAssetOrder(req.params.id);
      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error("Error deleting Segno asset order:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Users routes
  app.get("/api/segno/users", requireAuth, async (req: any, res) => {
    try {
      const offset = parseInt(req.query.offset as string) || 0;
      const maxResults = parseInt(req.query.max as string) || 50;
      const result = await segnoApiService.getUsersList({ offset, maxResults });
      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error("Error fetching Segno users:", error);
      res.status(500).json({ success: false, message: error.message, records: [], totalCount: 0, nextOffset: 0 });
    }
  });

  app.get("/api/segno/users/search", requireAuth, async (req: any, res) => {
    try {
      const q = (req.query.q as string) || "";
      if (!q.trim()) return res.json({ success: true, records: [] });
      const records = await segnoApiService.searchUsers(q.trim());
      res.json({ success: true, records });
    } catch (error: any) {
      console.error("Error searching Segno users:", error);
      res.status(500).json({ success: false, message: error.message, records: [] });
    }
  });

  app.get("/api/segno/users/:id", requireAuth, async (req: any, res) => {
    try {
      const record = await segnoApiService.getUserById(req.params.id);
      if (!record) return res.status(404).json({ success: false, message: "User not found" });
      res.json({ success: true, record });
    } catch (error: any) {
      console.error("Error fetching Segno user:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // =====================================================================
  // Rental Operations (T002) — reads from Snowflake pipeline tables
  // =====================================================================
  // Confirmed Snowflake pipeline table names (updated 2026-03-05)
  const RENTAL_OPEN_TABLE = "PARTS_SUPPLYCHAIN.FLEET.HOLMAN_OPEN_RENTAL_REPORT";
  const RENTAL_CLOSED_TABLE = "PARTS_SUPPLYCHAIN.FLEET.HOLMAN_CLOSED_RENTAL_REPORT";
  const RENTAL_TICKET_TABLE = "PARTS_SUPPLYCHAIN.FLEET.ENTERPRISE_OPEN_RENTAL_TICKET_REPORT";
  // All 3 pipeline tables are appended daily with a new file each time.
  // Always restrict to a single file's data per table.
  // When fileDate (YYYY-MM-DD) is provided, use that date; otherwise default to MAX(FILE_DATE).
  function ticketDateFilter(fileDate?: string): string {
    if (fileDate && /^\d{4}-\d{2}-\d{2}$/.test(fileDate)) return `FILE_DATE = '${fileDate}'`;
    return `FILE_DATE = (SELECT MAX(FILE_DATE) FROM ${RENTAL_TICKET_TABLE})`;
  }
  function openDateFilter(fileDate?: string): string {
    if (fileDate && /^\d{4}-\d{2}-\d{2}$/.test(fileDate)) return `FILE_DATE = '${fileDate}'`;
    return `FILE_DATE = (SELECT MAX(FILE_DATE) FROM ${RENTAL_OPEN_TABLE})`;
  }
  function closedDateFilter(fileDate?: string): string {
    if (fileDate && /^\d{4}-\d{2}-\d{2}$/.test(fileDate)) return `FILE_DATE = '${fileDate}'`;
    return `FILE_DATE = (SELECT MAX(FILE_DATE) FROM ${RENTAL_CLOSED_TABLE})`;
  }

  function calcDaysOpen(startDate: string | null): number {
    if (!startDate) return 0;
    const start = new Date(startDate);
    if (isNaN(start.getTime())) return 0;
    return Math.floor((Date.now() - start.getTime()) / 86400000);
  }

  // Normalize various date formats to ISO YYYY-MM-DD
  function parseRentalDate(d: string | null | undefined): string | null {
    if (!d) return null;
    const s = String(d).trim();
    if (!s || s === "null") return null;
    // Already ISO: 2026-02-10 or 2026-02-10 00:00:00
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    // MM/DD/YYYY or M/D/YYYY
    const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
    // 7-digit MDDYYYY e.g. 7212025 = 07/21/2025
    if (/^\d{7}$/.test(s)) {
      return `${s.slice(3)}-${s[0].padStart(2, "0")}-${s.slice(1, 3)}`;
    }
    // 8-digit MMDDYYYY
    if (/^\d{8}$/.test(s)) return `${s.slice(4)}-${s.slice(0, 2)}-${s.slice(2, 4)}`;
    return s.slice(0, 10);
  }

  // Return division code as-is — no label mapping
  function mapDivision(divCode: string | null | undefined): string {
    return (divCode || "").trim();
  }

  // Parse Enterprise claim number format: "114771300       -D/R"
  // Holman PO = digits before the hyphen (trimmed)
  // Letter after hyphen = alphabet position = rewrite count (D=4, F=6, etc.)
  // This matches NUMBER_OF_REWRITES column but lets us surface the PO number
  function parseClaimNumber(claimNum: string): { holmanPo: string } {
    const clean = (claimNum || "").trim();
    const hyphenIdx = clean.lastIndexOf("-");
    if (hyphenIdx < 0) return { holmanPo: clean.replace(/\s+/g, "") };
    const holmanPo = clean.slice(0, hyphenIdx).replace(/\s+/g, "");
    return { holmanPo };
  }

  // Coalesce originalStartDate with rentalStartDate — if ORIGINAL_START_DATE is present
  // the rental has been rewritten and we track days from the very first start date
  function entOriginalStart(r: any): string | null {
    return parseRentalDate(r.ORIGINAL_START_DATE) || parseRentalDate(r.RENTAL_START_DATE);
  }

  // ── Rental-ops response cache (30-minute TTL keyed by endpoint+params) ──────
  const RENTAL_OPS_CACHE_TTL_MS = 30 * 60 * 1000;
  const rentalOpsCache = new Map<string, { data: any; cachedAt: number }>();
  function getRentalOpsCache(key: string): { data: any; cachedAt: number } | null {
    const entry = rentalOpsCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > RENTAL_OPS_CACHE_TTL_MS) { rentalOpsCache.delete(key); return null; }
    return entry;
  }
  function setRentalOpsCache(key: string, data: any): void {
    rentalOpsCache.set(key, { data, cachedAt: Date.now() });
  }
  // ──────────────────────────────────────────────────────────────────────────

  // Returns a Set of 5-digit-padded vehicle numbers that are currently out of service
  // Used to filter OOS trucks from rental-ops listings by default
  async function getOosVehicleSet(): Promise<Set<string>> {
    try {
      const { holmanVehiclesCache } = await import("@shared/schema");
      const rows = await db.select({ num: holmanVehiclesCache.holmanVehicleNumber })
        .from(holmanVehiclesCache)
        .where(
          or(
            eq(holmanVehiclesCache.statusCode, 2),
            isNotNull(holmanVehiclesCache.outOfServiceDate)
          )
        );
      return new Set(rows.map(r => toDisplayNumber(r.num)));
    } catch {
      return new Set(); // graceful degradation if DB unavailable
    }
  }

  function handleSnowflakeError(err: any, res: any, table?: string) {
    const isTableMissing = err.message?.includes("does not exist") || err.message?.includes("SQL compilation error") || err.code === "002003";
    if (isTableMissing) {
      return res.status(503).json({ message: `Snowflake pipeline table not yet available${table ? `: ${table}` : ""}. Data will appear once the table is provisioned.`, data: [], total: 0 });
    }
    return res.status(500).json({ message: err.message });
  }

  // Parse a combined name string into first + last components.
  // Handles "FIRST LAST", "FIRST MIDDLE LAST", "LAST, FIRST", and trailing suffixes.
  function rentalNameParse(fullName: string): { first: string; last: string } {
    if (!fullName) return { first: '', last: '' };
    const s = fullName.trim().toUpperCase();
    const SUFFIXES = new Set(['JR', 'SR', 'II', 'III', 'IV', 'V', 'JR.', 'SR.']);
    const commaIdx = s.indexOf(',');
    if (commaIdx > 0) {
      const last = s.slice(0, commaIdx).trim();
      const firstRaw = s.slice(commaIdx + 1).trim();
      const firstTokens = firstRaw.split(/\s+/).filter(Boolean);
      while (firstTokens.length > 1 && SUFFIXES.has(firstTokens[firstTokens.length - 1])) firstTokens.pop();
      return { first: firstTokens[0] || '', last };
    }
    const tokens = s.split(/\s+/).filter(Boolean);
    if (!tokens.length) return { first: '', last: '' };
    if (tokens.length === 1) return { first: '', last: tokens[0] };
    let endIdx = tokens.length - 1;
    while (endIdx > 0 && SUFFIXES.has(tokens[endIdx])) endIdx--;
    return { first: tokens[0], last: tokens[endIdx] };
  }

  // Enrich Enterprise-segment rows (where source='enterprise' and enterpriseId is null)
  // by matching RENTER_NAME against TPMS_EXTRACT FULL_NAME.
  // Mutates rows in place; sets enterpriseId and enterpriseIdSource.
  // Result sources:
  //   'name_last_unique'  — exactly 1 TPMS tech with that last name
  //   'name_full_unique'  — unique match after adding first name
  //   'name_ambiguous'    — multiple TPMS techs share the name, cannot resolve
  //   'not_found'         — no TPMS tech has that last name
  async function rentalEnrichEnterpriseIds(_sf: any, rows: any[]): Promise<void> {
    const toEnrich = rows.filter(r => r.source === 'enterprise' && !r.enterpriseId);
    if (!toEnrich.length) return;
    try {
      // As of Task #221 we read from the in-process TPMS snapshot rather than
      // re-issuing a full TPMS_EXTRACT scan on every rental import. The snapshot
      // is already deduplicated per ENTERPRISE_ID so we don't need the seenEntIds
      // pass we used to do here — we just iterate the snapshot values.
      const { ensureSnapshotLoaded, getSnapshot } = await import('./fleet-scope-tpms-snapshot');
      await ensureSnapshotLoaded();
      const snapshot = getSnapshot();

      const lastNameMap = new Map<string, Array<{ enterpriseId: string; firstName: string }>>();
      for (const entry of snapshot.values()) {
        if (!entry.fullName) continue;
        const { first, last } = rentalNameParse(String(entry.fullName));
        if (!last) continue;
        if (!lastNameMap.has(last)) lastNameMap.set(last, []);
        lastNameMap.get(last)!.push({ enterpriseId: entry.enterpriseId, firstName: first });
      }
      for (const row of toEnrich) {
        const { first, last } = rentalNameParse(row.renterName || '');
        if (!last) { row.enterpriseIdSource = 'not_found'; continue; }
        const candidates = lastNameMap.get(last) || [];
        if (candidates.length === 0) {
          row.enterpriseIdSource = 'not_found';
        } else if (candidates.length === 1) {
          row.enterpriseId = candidates[0].enterpriseId;
          row.enterpriseIdSource = 'name_last_unique';
        } else if (first) {
          const exact = candidates.filter(c => c.firstName === first);
          if (exact.length === 1) {
            row.enterpriseId = exact[0].enterpriseId;
            row.enterpriseIdSource = 'name_full_unique';
          } else {
            row.enterpriseIdSource = 'name_ambiguous';
          }
        } else {
          row.enterpriseIdSource = 'name_ambiguous';
        }
      }
    } catch (err: any) {
      console.warn('[RentalOps] TPMS name enrichment skipped:', err.message);
    }
  }

  // Enrich rental-ops rows with mainStatus/subStatus from Fleet Scope trucks,
  // joined on the normalized padded vehicle number. Single batched query.
  const enrichWithTruckStatus = async (rows: any[]) => {
    const { trucks } = await import("@shared/fleet-scope-schema");
    const vns = Array.from(new Set(
      rows.map(r => String(r.vehicleNumberPadded || "").trim()).filter(Boolean)
    ));
    const statusByVn = new Map<string, { mainStatus: string | null; subStatus: string | null }>();
    if (vns.length > 0) {
      const truckRows = await fsDb
        .select({ truckNumber: trucks.truckNumber, mainStatus: trucks.mainStatus, subStatus: trucks.subStatus })
        .from(trucks)
        .where(inArray(trucks.truckNumber, vns));
      for (const t of truckRows) {
        statusByVn.set(t.truckNumber, { mainStatus: t.mainStatus ?? null, subStatus: t.subStatus ?? null });
      }
    }
    for (const r of rows) {
      const s = statusByVn.get(String(r.vehicleNumberPadded || "").trim());
      r.mainStatus = s ? s.mainStatus : null;
      r.subStatus = s ? s.subStatus : null;
    }
  };

  app.get("/api/rental-ops/open", requireAuthOrRentalOpsApiKey, async (req: any, res) => {
    try {
      const { getSnowflakeService, isSnowflakeConfigured } = await import("./snowflake-service");
      if (!isSnowflakeConfigured()) return res.status(503).json({ message: "Snowflake not configured" });
      const sf = getSnowflakeService();
      await sf.connect();

      const includeOos = req.query?.includeOos === "true";

      // view=raw returns all Holman PO lines (unfiltered, for reference)
      // default = business-logic view matching the Excel formula:
      //   Segment 1: Enterprise ticket table, TICKET_STATUS=OPEN, deduped by vehicle
      //   Segment 2: Holman open, vendor NOT Enterprise/Toll, NOT in Enterprise ticket table
      const showRaw = req.query?.view === "raw";

      const openCacheKey = `open:${req.query?.fileDate || 'latest'}:${showRaw}:${includeOos}`;
      const openCached = getRentalOpsCache(openCacheKey);
      if (openCached) { console.log(`[RentalOps] Cache hit: ${openCacheKey}`); return res.json({ ...openCached.data, _cachedAt: openCached.cachedAt }); }

      const normVeh = (v: string) => {
        if (!v) return "";
        return toDisplayNumber(v);
      };

      if (showRaw) {
        // Raw Holman PO lines view (all 800 rows, original behavior)
        const rows = await sf.executeQuery(`SELECT * FROM ${RENTAL_OPEN_TABLE} WHERE ${openDateFilter(req.query?.fileDate as string)} LIMIT 5000`) as any[];
        const ticketRows = await sf.executeQuery(`SELECT DISTINCT LPAD(VEHICLE_NUMBER, 5, '0') as VN FROM ${RENTAL_TICKET_TABLE} WHERE ${ticketDateFilter(req.query?.fileDate as string)}`).catch(() => []) as any[];
        const enterpriseVehicles = new Set<string>(ticketRows.map((r: any) => String(r.VN || "").trim()));
        const byVehicle = new Map<string, any[]>();
        for (const r of rows) {
          const vn = normVeh(r.VEHICLE_NUMBER || "");
          if (!vn) continue;
          if (!byVehicle.has(vn)) byVehicle.set(vn, []);
          byVehicle.get(vn)!.push(r);
        }
        const data = rows.filter((r: any) => r.VEHICLE_NUMBER).map((r: any) => {
          const vn = normVeh(r.VEHICLE_NUMBER || "");
          const group = byVehicle.get(vn) || [];
          const startDate = parseRentalDate(r.PO_DATE || r.RENTAL_START_DATE);
          return {
            vehicleNumber: r.VEHICLE_NUMBER,
            vehicleNumberPadded: vn,
            division: mapDivision(r.DIVISION),
            renterName: `${r.FIRST_NAME || ""} ${r.LAST_NAME || ""}`.trim(),
            enterpriseId: r.ENTERPRISE_ID || null,
            district: r.DISTRICT || null,
            poNumber: (r.PO_NUMBER || "").replace(/^'/, "").trim(),
            poDate: parseRentalDate(r.PO_DATE),
            rentalStartDate: startDate,
            rentalVendor: r.RENTAL_VENDOR || null,
            daysOpen: calcDaysOpen(startDate),
            poCount: group.length,
            hasEnterpriseTicket: enterpriseVehicles.has(vn),
            source: "holman_raw",
          };
        });
        await enrichWithTruckStatus(data);
        const rawResult = { data, total: data.length, totalPOLines: rows.length, view: "raw" };
        setRentalOpsCache(openCacheKey, rawResult);
        return res.json(rawResult);
      }

      // === BUSINESS LOGIC VIEW (matches Excel 333 formula) ===
      // Fetch Enterprise open tickets + all Holman open POs in parallel
      const [ticketRows, holmanRows] = await Promise.all([
        sf.executeQuery(`SELECT * FROM ${RENTAL_TICKET_TABLE} WHERE ${ticketDateFilter(req.query?.fileDate as string)} AND TICKET_STATUS='OPEN' LIMIT 5000`) as Promise<any[]>,
        sf.executeQuery(`SELECT * FROM ${RENTAL_OPEN_TABLE} WHERE ${openDateFilter(req.query?.fileDate as string)} LIMIT 5000`) as Promise<any[]>,
      ]);

      // Build set of all vehicle numbers in Enterprise ticket table (any status) for "not on Enterprise reporting" check
      const allEntVns = new Set<string>();
      for (const r of ticketRows) {
        const vn = normVeh(r.VEHICLE_NUMBER || "");
        if (vn) allEntVns.add(vn);
      }

      // SEGMENT 1: Enterprise open tickets, deduplicated by vehicle (latest RENTAL_START_DATE)
      const entByVehicle = new Map<string, any>();
      for (const r of ticketRows) {
        const vn = normVeh(r.VEHICLE_NUMBER || "");
        if (!vn) continue;
        const existing = entByVehicle.get(vn);
        const rDate = new Date(r.RENTAL_START_DATE || "2000-01-01").getTime();
        const eDate = existing ? new Date(existing.RENTAL_START_DATE || "2000-01-01").getTime() : 0;
        if (!existing || rDate > eDate) entByVehicle.set(vn, r);
      }

      const enterpriseSegment = Array.from(entByVehicle.entries()).map(([vn, r]) => {
        // originalStartDate = COALESCE(ORIGINAL_START_DATE, RENTAL_START_DATE)
        // If ORIGINAL_START_DATE exists → this is a rewrite; track days from the very first rental date
        // If not → new rental, use RENTAL_START_DATE
        const originalStartDate = entOriginalStart(r);
        const currentTicketStart = parseRentalDate(r.RENTAL_START_DATE);
        const { holmanPo } = parseClaimNumber(r.CLAIM_NUMBER || "");
        return {
          vehicleNumber: r.VEHICLE_NUMBER,
          vehicleNumberPadded: vn,
          division: null,
          renterName: (r.RENTER_NAME || "").trim(),
          enterpriseId: null,
          district: null,
          ticketNumber: r.ECARS_2_0_TKT_NBR || null,
          // Holman PO extracted from claim number (e.g. "114771300       -D/R" → "114771300")
          poNumber: holmanPo || null,
          claimNumber: (r.CLAIM_NUMBER || "").trim(),
          poDate: originalStartDate,
          rentalStartDate: currentTicketStart,        // current ticket/rewrite start
          originalStartDate,                          // first rental date (or current if no rewrite)
          isRewrite: !!(r.ORIGINAL_START_DATE && parseRentalDate(r.ORIGINAL_START_DATE)),
          rentalVendor: "Enterprise Rent-A-Car",
          ticketStatus: r.TICKET_STATUS,
          // daysOpen counted from ORIGINAL_START_DATE so rewrites show full rental age
          daysOpen: calcDaysOpen(originalStartDate),
          daysAuthorized: r.DAYS_AUTHORIZED ? parseInt(String(r.DAYS_AUTHORIZED)) : null,
          initialDaysAuthorized: r.INITIAL_DAYS_AUTHORIZED ? parseInt(String(r.INITIAL_DAYS_AUTHORIZED)) : null,
          numberOfExtensions: r.NUMBER_OF_EXTENSIONS ? parseInt(String(r.NUMBER_OF_EXTENSIONS)) : 0,
          daysBehind: r.DAYS_BEHIND ? parseInt(String(r.DAYS_BEHIND)) : 0,
          numberOfRewrites: r.NUMBER_OF_REWRITES ? parseInt(String(r.NUMBER_OF_REWRITES)) : 0,
          repairsComplete: r.REPAIRS_COMPLETE || null,
          claimsOffice: r.CLAIMS_OFFICE_NAME || null,
          poCount: 1,
          hasEnterpriseTicket: true,
          source: "enterprise",
          enterpriseIdSource: null as string | null,
        };
      });

      // SEGMENT 2: Holman non-Enterprise vendor trucks not in Enterprise ticket table at all
      // Vendor exclusions: Enterprise Rent-A-Car and Enterprise toll charges
      const isEntVendor = (v: string | null) => !v || /enterprise/i.test(v) || /toll/i.test(v);
      const holmanByVehicle = new Map<string, any[]>();
      for (const r of holmanRows) {
        const vn = normVeh(r.VEHICLE_NUMBER || "");
        if (!vn) continue;
        if (isEntVendor(r.RENTAL_VENDOR)) continue;   // Enterprise/Toll vendor → skip
        if (allEntVns.has(vn)) continue;               // Already on Enterprise ticket table → skip
        if (!holmanByVehicle.has(vn)) holmanByVehicle.set(vn, []);
        holmanByVehicle.get(vn)!.push(r);
      }

      const holmanSegment = Array.from(holmanByVehicle.entries()).map(([vn, group]) => {
        const sorted = group.sort((a: any, b: any) =>
          new Date(b.PO_DATE || "2000-01-01").getTime() - new Date(a.PO_DATE || "2000-01-01").getTime()
        );
        const r = sorted[0];
        const startDate = parseRentalDate(r.PO_DATE || r.RENTAL_START_DATE);
        return {
          vehicleNumber: r.VEHICLE_NUMBER,
          vehicleNumberPadded: vn,
          division: mapDivision(r.DIVISION),
          renterName: `${r.FIRST_NAME || ""} ${r.LAST_NAME || ""}`.trim(),
          enterpriseId: r.ENTERPRISE_ID || null,
          district: r.DISTRICT || null,
          poNumber: (r.PO_NUMBER || "").replace(/^'/, "").trim(),
          poDate: startDate,
          rentalStartDate: startDate,
          rentalVendor: r.RENTAL_VENDOR || null,
          daysOpen: calcDaysOpen(startDate),
          poCount: group.length,
          hasEnterpriseTicket: false,
          source: "holman_non_enterprise",
          enterpriseIdSource: (r.ENTERPRISE_ID ? 'direct' : null) as string | null,
        };
      });

      let allData = [...enterpriseSegment, ...holmanSegment];

      // Enrich Enterprise segment rows with Enterprise ID resolved from TPMS name matching
      await rentalEnrichEnterpriseIds(sf, allData);

      let oosCount = 0;
      if (!includeOos) {
        const oosVehicles = await getOosVehicleSet();
        if (oosVehicles.size > 0) {
          const before = allData.length;
          allData = allData.filter(v => !oosVehicles.has(toDisplayNumber(v.vehicleNumberPadded || v.vehicleNumber || "")));
          oosCount = before - allData.length;
        }
      }
      const data = allData;

      await enrichWithTruckStatus(data);

      const openBizResult = {
        data,
        total: data.length,
        enterpriseCount: enterpriseSegment.length,
        holmanNonEnterpriseCount: holmanSegment.length,
        totalHolmanPOLines: holmanRows.length,
        oosFilteredCount: oosCount,
        view: "business_logic",
      };
      setRentalOpsCache(openCacheKey, openBizResult);
      res.json(openBizResult);
    } catch (err: any) {
      return handleSnowflakeError(err, res, RENTAL_TICKET_TABLE);
    }
  });

  app.get("/api/rental-ops/closed", requireAuth, async (req: any, res) => {
    try {
      const { getSnowflakeService, isSnowflakeConfigured } = await import("./snowflake-service");
      if (!isSnowflakeConfigured()) return res.status(503).json({ message: "Snowflake not configured" });
      const sf = getSnowflakeService();
      await sf.connect();
      const includeOos = req.query?.includeOos === "true";
      const closedCacheKey = `closed:${req.query?.fileDate || 'latest'}:${includeOos}`;
      const closedCached = getRentalOpsCache(closedCacheKey);
      if (closedCached) { console.log(`[RentalOps] Cache hit: ${closedCacheKey}`); return res.json({ ...closedCached.data, _cachedAt: closedCached.cachedAt }); }
      const rows = await sf.executeQuery(`SELECT * FROM ${RENTAL_CLOSED_TABLE} WHERE ${closedDateFilter(req.query?.fileDate as string)} LIMIT 5000`) as any[];
      const seen = new Map<string, any>();
      for (const r of rows) {
        const key = `${r.VEHICLE_NUMBER || r.UNIT_NUMBER || ""}|${(r.PO_NUMBER || r.RENTAL_AGREEMENT || "").replace(/^'/, "").trim()}`;
        if (!seen.has(key)) seen.set(key, r);
      }
      let data = Array.from(seen.values()).map((r: any) => {
        const startDate = parseRentalDate(r.RENTAL_START_DATE || r.START_DATE);
        const endDate = parseRentalDate(r.RENTAL_END_DATE || r.END_DATE);
        return {
          vehicleNumber: r.VEHICLE_NUMBER || r.UNIT_NUMBER || "",
          division: mapDivision(r.DIVISION),
          renterName: r.RENTER_NAME
            ? (r.RENTER_NAME as string).trim()
            : `${r.FIRST_NAME || ""} ${r.LAST_NAME || ""}`.trim(),
          clientNumber: r.CLIENT_NUMBER || null,
          clientCompanyName: r.CLIENT_COMPANY_NAME || null,
          poNumber: (r.PO_NUMBER || r.RENTAL_AGREEMENT || "").replace(/^'/, "").trim(),
          rentalStartDate: startDate,
          rentalEndDate: endDate,
          originalStartDate: parseRentalDate(r.ORIGINAL_START_DATE),
          rentalDays: r.RENTAL_DAYS ? parseInt(String(r.RENTAL_DAYS)) : null,
          rewriteFlag: r.REWRITE_FLAG || null,
          raw: r,
        };
      });
      let oosCount = 0;
      if (!includeOos) {
        const oosVehicles = await getOosVehicleSet();
        if (oosVehicles.size > 0) {
          const before = data.length;
          data = data.filter((v: any) => !oosVehicles.has(toDisplayNumber(v.vehicleNumber)));
          oosCount = before - data.length;
        }
      }
      const closedResult = { data, total: data.length, oosFilteredCount: oosCount, source: RENTAL_CLOSED_TABLE };
      setRentalOpsCache(closedCacheKey, closedResult);
      res.json(closedResult);
    } catch (err: any) {
      return handleSnowflakeError(err, res, RENTAL_CLOSED_TABLE);
    }
  });

  app.get("/api/rental-ops/tickets", requireAuth, async (req: any, res) => {
    try {
      const { getSnowflakeService, isSnowflakeConfigured } = await import("./snowflake-service");
      if (!isSnowflakeConfigured()) return res.status(503).json({ message: "Snowflake not configured" });
      const sf = getSnowflakeService();
      await sf.connect();
      const includeOos = req.query?.includeOos === "true";
      const ticketsCacheKey = `tickets:${req.query?.fileDate || 'latest'}:${includeOos}`;
      const ticketsCached = getRentalOpsCache(ticketsCacheKey);
      if (ticketsCached) { console.log(`[RentalOps] Cache hit: ${ticketsCacheKey}`); return res.json({ ...ticketsCached.data, _cachedAt: ticketsCached.cachedAt }); }
      const rows = await sf.executeQuery(`SELECT * FROM ${RENTAL_TICKET_TABLE} WHERE ${ticketDateFilter(req.query?.fileDate as string)} LIMIT 2000`) as any[];
      let data = rows.map((r: any) => {
        const currentTicketStart = parseRentalDate(r.RENTAL_START_DATE);
        // COALESCE(ORIGINAL_START_DATE, RENTAL_START_DATE) — track from first rental date on rewrites
        const originalStartDate = parseRentalDate(r.ORIGINAL_START_DATE) || currentTicketStart;
        const { holmanPo } = parseClaimNumber(r.CLAIM_NUMBER || "");
        return {
          vehicleNumber: r.VEHICLE_NUMBER || r.UNIT_NUMBER || r.ASSET_NUMBER || "",
          ticketNumber: r.ECARS_2_0_TKT_NBR || "",
          // Holman PO number extracted from claim number (digits before the "-D/R" suffix)
          holmanPoNumber: holmanPo || null,
          claimNumber: (r.CLAIM_NUMBER || "").trim(),
          renterName: (r.RENTER_NAME || "").trim(),
          claimsOfficeName: r.CLAIMS_OFFICE_NAME || null,
          rentalStartDate: currentTicketStart,          // this ticket's start date
          originalStartDate,                            // COALESCE(ORIGINAL_START_DATE, RENTAL_START_DATE)
          isRewrite: !!(r.ORIGINAL_START_DATE && parseRentalDate(r.ORIGINAL_START_DATE)),
          rentingBranch: r.RENTING_BRANCH || null,
          rentingCity: r.RENTING_CITY_NAME || null,
          rentingState: r.RENTING_STATE || null,
          carClass: r.CAR_CLASS_AUTHORIZED_DESCRIPTION || null,
          daysAuthorized: r.DAYS_AUTHORIZED ? parseInt(String(r.DAYS_AUTHORIZED)) : null,
          initialDaysAuthorized: r.INITIAL_DAYS_AUTHORIZED ? parseInt(String(r.INITIAL_DAYS_AUTHORIZED)) : null,
          rentalDays: r.RENTAL_DAYS ? parseInt(String(r.RENTAL_DAYS)) : null,
          daysBehind: r.DAYS_BEHIND ? parseInt(String(r.DAYS_BEHIND)) : 0,
          rateAuthorized: r.RATE_AUTHORIZED || null,
          numberOfExtensions: r.NUMBER_OF_EXTENSIONS ? parseInt(String(r.NUMBER_OF_EXTENSIONS)) : 0,
          numberOfRewrites: r.NUMBER_OF_REWRITES ? parseInt(String(r.NUMBER_OF_REWRITES)) : 0,
          repairsComplete: r.REPAIRS_COMPLETE || null,
          status: r.TICKET_STATUS || "",
          rentedVehYear: r.RENTED_VEH_YEAR || null,
          rentedVehMake: r.RENTED_VEH_MAKE || null,
          rentedVehModel: r.RENTED_VEH_MODEL || null,
          // daysOpen always from originalStartDate (first rental date including rewrites)
          daysOpen: calcDaysOpen(originalStartDate),
          raw: r,
        };
      });
      let oosCount = 0;
      if (!includeOos) {
        const oosVehicles = await getOosVehicleSet();
        if (oosVehicles.size > 0) {
          const before = data.length;
          data = data.filter((v: any) => !oosVehicles.has(toDisplayNumber(v.vehicleNumber)));
          oosCount = before - data.length;
        }
      }
      const ticketsResult = { data, total: data.length, oosFilteredCount: oosCount, source: RENTAL_TICKET_TABLE };
      setRentalOpsCache(ticketsCacheKey, ticketsResult);
      res.json(ticketsResult);
    } catch (err: any) {
      return handleSnowflakeError(err, res, RENTAL_TICKET_TABLE);
    }
  });

  app.get("/api/rental-ops/open-vehicle-numbers", requireAuth, async (req: any, res) => {
    try {
      const { getSnowflakeService, isSnowflakeConfigured } = await import("./snowflake-service");
      if (!isSnowflakeConfigured()) return res.status(503).json({ message: "Snowflake not configured", vehicleNumbers: [] });
      const sf = getSnowflakeService();
      await sf.connect();
      const normV = (v: string) => v ? toDisplayNumber(v) : "";
      const isEntVendor = (v: string | null) => !v || /enterprise/i.test(v) || /toll/i.test(v);

      const openVnsCacheKey = `open-vns:${req.query?.fileDate || 'latest'}`;
      const openVnsCached = getRentalOpsCache(openVnsCacheKey);
      if (openVnsCached) { console.log(`[RentalOps] Cache hit: ${openVnsCacheKey}`); return res.json({ ...openVnsCached.data, _cachedAt: openVnsCached.cachedAt }); }

      const [ticketRows, holmanRows] = await Promise.all([
        sf.executeQuery(`SELECT VEHICLE_NUMBER FROM ${RENTAL_TICKET_TABLE} WHERE ${ticketDateFilter(req.query?.fileDate as string)} AND TICKET_STATUS='OPEN' LIMIT 5000`).catch(() => []) as Promise<any[]>,
        sf.executeQuery(`SELECT VEHICLE_NUMBER, RENTAL_VENDOR FROM ${RENTAL_OPEN_TABLE} WHERE ${openDateFilter(req.query?.fileDate as string)} LIMIT 5000`).catch(() => []) as Promise<any[]>,
      ]);

      const entVns = new Set<string>();
      for (const r of ticketRows as any[]) {
        const vn = normV(r.VEHICLE_NUMBER || "");
        if (vn) entVns.add(vn);
      }

      const holmanNonEntVns = new Set<string>();
      for (const r of holmanRows as any[]) {
        const vn = normV(r.VEHICLE_NUMBER || "");
        if (!vn || isEntVendor(r.RENTAL_VENDOR)) continue;
        if (entVns.has(vn)) continue;
        holmanNonEntVns.add(vn);
      }

      const oosVehicles = await getOosVehicleSet();
      const allVns: string[] = [];
      for (const vn of entVns) {
        if (!oosVehicles.has(vn)) allVns.push(vn);
      }
      for (const vn of holmanNonEntVns) {
        if (!oosVehicles.has(vn)) allVns.push(vn);
      }

      const openVnsResult = { vehicleNumbers: allVns };
      setRentalOpsCache(openVnsCacheKey, openVnsResult);
      res.json(openVnsResult);
    } catch (err: any) {
      return handleSnowflakeError(err, res);
    }
  });

  // Returns the set of Enterprise IDs currently in open rentals (for cross-app badge on Weekly Offboarding).
  // Uses the same TPMS name-matching logic as the main open-rentals endpoint.
  app.get("/api/rental-ops/open-enterprise-ids", requireAuth, async (req: any, res) => {
    try {
      const { getSnowflakeService, isSnowflakeConfigured } = await import("./snowflake-service");
      if (!isSnowflakeConfigured()) return res.status(503).json({ message: "Snowflake not configured", enterpriseIds: [] });
      const sf = getSnowflakeService();
      await sf.connect();

      const eidCacheKey = `open-eid:${req.query?.fileDate || 'latest'}`;
      const eidCached = getRentalOpsCache(eidCacheKey);
      if (eidCached) return res.json({ ...eidCached.data, _cachedAt: eidCached.cachedAt });

      const normV = (v: string) => (v || '').trim().replace(/^0+/, '');
      const isEntVendor = (v: string | null) => !v || /enterprise/i.test(v) || /toll/i.test(v);

      const [ticketRows, holmanRows] = await Promise.all([
        sf.executeQuery(`SELECT VEHICLE_NUMBER, RENTER_NAME, RENTAL_START_DATE FROM ${RENTAL_TICKET_TABLE} WHERE ${ticketDateFilter(req.query?.fileDate as string)} AND TICKET_STATUS='OPEN' LIMIT 5000`) as Promise<any[]>,
        sf.executeQuery(`SELECT VEHICLE_NUMBER, ENTERPRISE_ID, RENTAL_VENDOR FROM ${RENTAL_OPEN_TABLE} WHERE ${openDateFilter(req.query?.fileDate as string)} LIMIT 5000`) as Promise<any[]>,
      ]);

      // Deduplicate enterprise ticket rows by vehicle (keep latest rental start date)
      const entByVehicle = new Map<string, any>();
      for (const r of ticketRows) {
        const vn = normV(r.VEHICLE_NUMBER || '');
        if (!vn) continue;
        const existing = entByVehicle.get(vn);
        const rDate = new Date(r.RENTAL_START_DATE || '2000-01-01').getTime();
        const eDate = existing ? new Date(existing.RENTAL_START_DATE || '2000-01-01').getTime() : 0;
        if (!existing || rDate > eDate) entByVehicle.set(vn, r);
      }
      const allEntVns = new Set(entByVehicle.keys());

      // Build rows for TPMS name enrichment
      const enrichRows: any[] = Array.from(entByVehicle.values()).map(r => ({
        renterName: (r.RENTER_NAME || '').trim(),
        enterpriseId: null as string | null,
        source: 'enterprise',
      }));
      await rentalEnrichEnterpriseIds(sf, enrichRows);

      // Collect all resolved Enterprise IDs (normalized to upper-case for consistent matching)
      const entIds = new Set<string>();
      for (const row of enrichRows) {
        if (row.enterpriseId) entIds.add(String(row.enterpriseId).trim().toUpperCase());
      }

      // Add Holman segment direct Enterprise IDs
      for (const r of holmanRows) {
        const vn = normV(r.VEHICLE_NUMBER || '');
        if (!vn || isEntVendor(r.RENTAL_VENDOR) || allEntVns.has(vn)) continue;
        const eid = (r.ENTERPRISE_ID || '').trim().toUpperCase();
        if (eid) entIds.add(eid);
      }

      const eidResult = { enterpriseIds: Array.from(entIds) };
      setRentalOpsCache(eidCacheKey, eidResult);
      res.json(eidResult);
    } catch (err: any) {
      return handleSnowflakeError(err, res);
    }
  });

  app.get("/api/rental-ops/profitability", requireAuth, async (req: any, res) => {
    try {
      const { getSnowflakeService, isSnowflakeConfigured } = await import("./snowflake-service");
      if (!isSnowflakeConfigured()) return res.status(503).json({ message: "Snowflake not configured" });

      // Expect JSON body: [{id: "KLARMAY", daysOpen: 258}, ...]
      // Passed as query param "techs" (URL-encoded JSON) to keep it a GET
      const techsParam = req.query?.techs as string;
      if (!techsParam) return res.status(400).json({ message: "Missing 'techs' query param" });

      let techList: Array<{ id: string; daysOpen: number }>;
      try {
        techList = JSON.parse(techsParam);
      } catch {
        return res.status(400).json({ message: "Invalid JSON in 'techs' param" });
      }

      // Filter to only techs that actually have an enterprise ID and valid daysOpen
      const validTechs = techList.filter(t => t.id && t.daysOpen > 0);
      if (validTechs.length === 0) return res.json({ profitability: {} });

      const sf = getSnowflakeService();
      await sf.connect();

      // Build VALUES clause: each tech gets (ldap, days_open)
      const valuesRows = validTechs
        .map(t => `('${t.id.replace(/'/g, "''")}', ${Math.round(t.daysOpen)})`)
        .join(",\n        ");

      const sql = `
        WITH rental_techs AS (
          SELECT column1 AS tech_ldap, column2::INTEGER AS days_open
          FROM VALUES
            ${valuesRows}
        ),
        financials AS (
          SELECT
            f.TECH_LDAP,
            COUNT(CASE WHEN f.SO_STS_DESC = 'CO - Complete' THEN 1 END) AS completes,
            COUNT(*)                                                      AS total_sos,
            SUM(f.TOTAL_REVENUE)                                          AS total_revenue,
            SUM(f.LABOR_REVENUE)                                          AS labor_revenue,
            SUM(f.PARTS_REVENUE)                                          AS parts_revenue,
            SUM(f.OTHER_REVENUE)                                          AS other_revenue,
            SUM(f.LABOR_DIRECT_EXPENSE)                                   AS labor_direct,
            SUM(f.LABOR_BENEFITS_EXPENSE)                                 AS labor_benefits,
            SUM(COALESCE(f.TOTAL_PARTS_COGS_EXPENSE, 0)
              + COALESCE(f.TOTAL_PARTS_COGS_EXPENSE_UNDISPOSITIONED, 0))  AS parts_cogs,
            SUM(f.TOTAL_SHIPPING_FORWARD_EXPENSE)                         AS parts_shipping,
            SUM(f.TOTAL_TRUCK_EXPENSE)                                    AS truck_expense,
            SUM(f.PPT_COSTS)                                              AS ppt_costs,
            SUM(f.PPT_PROFIT)                                             AS ppt_profit
          FROM FINANCE_ANALYTICS.ADHOC_TBLS.IHR_UNIT_ECONOMICS f
          INNER JOIN rental_techs rt
            ON UPPER(f.TECH_LDAP) = UPPER(rt.tech_ldap)
            AND f.SO_STS_DT >= DATEADD('day', -rt.days_open, CURRENT_DATE())
            AND f.SO_STS_DT <= CURRENT_DATE()
          GROUP BY f.TECH_LDAP
        )
        SELECT
          rt.tech_ldap,
          rt.days_open,
          (fin.tech_ldap IS NOT NULL)                   AS has_data,
          COALESCE(fin.completes, 0)                    AS completes,
          COALESCE(fin.total_sos, 0)                    AS total_sos,
          ROUND(COALESCE(fin.total_revenue, 0), 2)      AS total_revenue,
          ROUND(COALESCE(fin.labor_revenue, 0), 2)      AS labor_revenue,
          ROUND(COALESCE(fin.parts_revenue, 0), 2)      AS parts_revenue,
          ROUND(COALESCE(fin.other_revenue, 0), 2)      AS other_revenue,
          ROUND(COALESCE(fin.labor_direct, 0), 2)       AS labor_direct,
          ROUND(COALESCE(fin.labor_benefits, 0), 2)     AS labor_benefits,
          ROUND(COALESCE(fin.parts_cogs, 0), 2)         AS parts_cogs,
          ROUND(COALESCE(fin.parts_shipping, 0), 2)     AS parts_shipping,
          ROUND(COALESCE(fin.truck_expense, 0), 2)      AS truck_expense,
          ROUND(COALESCE(fin.ppt_costs, 0), 2)          AS ppt_costs,
          ROUND(COALESCE(fin.ppt_profit, 0), 2)         AS ppt_profit
        FROM rental_techs rt
        LEFT JOIN financials fin
          ON UPPER(rt.tech_ldap) = UPPER(fin.tech_ldap)
        ORDER BY rt.tech_ldap
      `;

      const rows = await sf.executeQuery(sql) as any[];

      const DAILY_RENTAL_COST = 80;

      const profitability: Record<string, any> = {};
      for (const row of rows) {
        const ldap = String(row.TECH_LDAP || row.tech_ldap || "").toUpperCase();
        if (!ldap) continue;

        const daysOpen   = Number(row.DAYS_OPEN || row.days_open || 0);
        const rawHasData = row.HAS_DATA ?? row.has_data;
        const hasData    = rawHasData === true || rawHasData === 1
          || String(rawHasData).toLowerCase() === "true"
          || String(rawHasData).toLowerCase() === "1";
        const completes  = Number(row.COMPLETES || row.completes || 0);
        const totalSos   = Number(row.TOTAL_SOS || row.total_sos || 0);
        const totalRev   = Number(row.TOTAL_REVENUE || row.total_revenue || 0);
        const laborRev   = Number(row.LABOR_REVENUE || row.labor_revenue || 0);
        const partsRev   = Number(row.PARTS_REVENUE || row.parts_revenue || 0);
        const otherRev   = Number(row.OTHER_REVENUE || row.other_revenue || 0);
        const laborDir   = Number(row.LABOR_DIRECT || row.labor_direct || 0);
        const laborBen   = Number(row.LABOR_BENEFITS || row.labor_benefits || 0);
        const partsCogs  = Number(row.PARTS_COGS || row.parts_cogs || 0);
        const partsShip  = Number(row.PARTS_SHIPPING || row.parts_shipping || 0);
        const truckExp   = Number(row.TRUCK_EXPENSE || row.truck_expense || 0);
        const pptProfit  = Number(row.PPT_PROFIT || row.ppt_profit || 0);

        const rentalCost = daysOpen * DAILY_RENTAL_COST;
        const fuelEst    = completes * 10;
        const adjNet     = pptProfit + truckExp - fuelEst - rentalCost;

        let status: string;
        if (!hasData) status = "No Data";
        else if (adjNet < 0) status = "Underwater";
        else if (adjNet <= 5000) status = "Marginal";
        else status = "Profitable";

        profitability[ldap] = {
          hasData,
          daysOpen,
          completes,
          totalSos,
          totalRevenue: totalRev,
          laborRevenue: laborRev,
          partsRevenue: partsRev,
          otherRevenue: otherRev,
          laborDirect: laborDir,
          laborBenefits: laborBen,
          partsCogs,
          partsShipping: partsShip,
          truckExpense: truckExp,
          pptProfit,
          rentalCost,
          fuelEst,
          adjNet: Math.round(adjNet * 100) / 100,
          status,
        };
      }

      res.json({ profitability });
    } catch (err: any) {
      return handleSnowflakeError(err, res);
    }
  });

  app.get("/api/rental-ops/summary", requireAuth, async (req: any, res) => {
    try {
      const { getSnowflakeService, isSnowflakeConfigured } = await import("./snowflake-service");
      if (!isSnowflakeConfigured()) return res.status(503).json({ message: "Snowflake not configured" });
      const sf = getSnowflakeService();
      await sf.connect();
      const normV = (v: string) => {
        if (!v) return "";
        return toDisplayNumber(v);
      };
      const isEntVendor = (v: string | null) => !v || /enterprise/i.test(v) || /toll/i.test(v);

      const includeOosSummaryQ = req.query?.includeOos === "true";
      const summaryCacheKey = `summary:${req.query?.fileDate || 'latest'}:${includeOosSummaryQ}`;
      const summaryCached = getRentalOpsCache(summaryCacheKey);
      if (summaryCached) { console.log(`[RentalOps] Cache hit: ${summaryCacheKey}`); return res.json({ ...summaryCached.data, _cachedAt: summaryCached.cachedAt }); }

      const [ticketRows, holmanRows, closedRows] = await Promise.all([
        sf.executeQuery(`SELECT VEHICLE_NUMBER, RENTAL_START_DATE, TICKET_STATUS FROM ${RENTAL_TICKET_TABLE} WHERE ${ticketDateFilter(req.query?.fileDate as string)} AND TICKET_STATUS='OPEN' LIMIT 5000`).catch(() => []) as Promise<any[]>,
        sf.executeQuery(`SELECT VEHICLE_NUMBER, PO_DATE, DIVISION, RENTAL_VENDOR FROM ${RENTAL_OPEN_TABLE} WHERE ${openDateFilter(req.query?.fileDate as string)} LIMIT 5000`).catch(() => []) as Promise<any[]>,
        sf.executeQuery(`SELECT VEHICLE_NUMBER, PO_NUMBER, REWRITE_FLAG FROM ${RENTAL_CLOSED_TABLE} WHERE ${closedDateFilter(req.query?.fileDate as string)} LIMIT 5000`).catch(() => []) as Promise<any[]>,
      ]);

      // Segment 1: unique Enterprise open trucks (track days per vehicle)
      const entOpenMap = new Map<string, number>(); // vn → daysOpen
      for (const r of ticketRows as any[]) {
        const vn = normV(r.VEHICLE_NUMBER || "");
        if (vn && !entOpenMap.has(vn)) {
          entOpenMap.set(vn, calcDaysOpen(parseRentalDate(r.RENTAL_START_DATE)));
        }
      }
      const entOpenVns = new Set<string>(entOpenMap.keys());

      // All Enterprise ticket vehicles (any status — for "on Enterprise reporting" check)
      const allEntVns = new Set<string>(entOpenVns);

      // Segment 2: Holman non-Enterprise vendor trucks not in Enterprise table
      const holmanNonEntMap = new Map<string, { days: number; division: string }>(); // vn → info
      for (const r of holmanRows as any[]) {
        const vn = normV(r.VEHICLE_NUMBER || "");
        if (!vn || isEntVendor(r.RENTAL_VENDOR)) continue;
        if (allEntVns.has(vn)) continue;
        if (!holmanNonEntMap.has(vn)) {
          holmanNonEntMap.set(vn, {
            days: calcDaysOpen(parseRentalDate(r.PO_DATE)),
            division: mapDivision(r.DIVISION) || "(blank)",
          });
        }
      }
      const holmanNonEntVns = new Set<string>(holmanNonEntMap.keys());

      // Apply the same OOS filter as the open endpoint (so summary matches Open Rentals tab count)
      const oosVehicles = includeOosSummaryQ ? new Set<string>() : await getOosVehicleSet();
      if (oosVehicles.size > 0) {
        const normPad = (v: string) => toDisplayNumber(v);
        for (const vn of Array.from(entOpenVns)) {
          if (oosVehicles.has(normPad(vn))) { entOpenVns.delete(vn); entOpenMap.delete(vn); }
        }
        for (const vn of Array.from(holmanNonEntVns)) {
          if (oosVehicles.has(normPad(vn))) { holmanNonEntVns.delete(vn); holmanNonEntMap.delete(vn); }
        }
      }

      const totalOpen = entOpenVns.size + holmanNonEntVns.size;
      const allDaysOpen = [...entOpenMap.values(), ...Array.from(holmanNonEntMap.values()).map(v => v.days)];
      const avgDaysOpen = allDaysOpen.length > 0
        ? Math.round(allDaysOpen.reduce((s, d) => s + d, 0) / allDaysOpen.length)
        : 0;

      const divisionBreakdown: Record<string, number> = {};
      for (const { division } of holmanNonEntMap.values()) {
        divisionBreakdown[division] = (divisionBreakdown[division] || 0) + 1;
      }

      // Closed dedup (also OOS-filter to match closed tab count)
      const closedDeduped = new Set<string>();
      let closedCount = 0;
      let extensionCount = 0;
      for (const r of closedRows as any[]) {
        const vn = normV(r.VEHICLE_NUMBER || "");
        if (oosVehicles.size > 0 && oosVehicles.has(toDisplayNumber(vn))) continue;
        const key = `${vn}|${(r.PO_NUMBER || "").replace(/^'/, "").trim()}`;
        if (!closedDeduped.has(key)) {
          closedDeduped.add(key);
          closedCount++;
          if (r.REWRITE_FLAG === "Y") extensionCount++;
        }
      }

      const summaryResult = {
        totalOpen,
        enterpriseOpen: entOpenVns.size,
        holmanNonEnterprise: holmanNonEntVns.size,
        totalClosed: closedCount,
        extensions: extensionCount,
        divisionBreakdown,
        avgDaysOpen,
      };
      setRentalOpsCache(summaryCacheKey, summaryResult);
      res.json(summaryResult);
    } catch (err: any) {
      return handleSnowflakeError(err, res);
    }
  });

  // Returns all distinct FILE_DATEs loaded into the Enterprise ticket table,
  // newest first, so the frontend can offer a date-picker for historical views.
  app.get("/api/rental-ops/available-dates", requireAuth, async (_req, res) => {
    try {
      const { getSnowflakeService, isSnowflakeConfigured } = await import("./snowflake-service");
      if (!isSnowflakeConfigured()) return res.status(503).json({ message: "Snowflake not configured", data: [] });
      const sf = getSnowflakeService();
      await sf.connect();
      const toIsoDate = (v: any): string => {
        if (!v) return "";
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        const s = String(v).trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
        const d = new Date(s);
        return isNaN(d.getTime()) ? s.slice(0, 10) : d.toISOString().slice(0, 10);
      };

      // Query all 3 pipeline tables in parallel — they are all appended daily together
      // Open rentals trend uses the same combined business-logic as the main count:
      //   Segment 1: Enterprise open ticket vehicles (from ENTERPRISE table)
      //   Segment 2: Holman non-Enterprise/toll vehicles not already in Segment 1 for the same date
      // This ensures the trend line matches the deduplicated count shown in the UI.
      const [ticketRows, openRows, closedRows] = await Promise.all([
        sf.executeQuery(`SELECT FILE_DATE, SOURCE_FILENAME, LOADED_TS, COUNT(DISTINCT VEHICLE_NUMBER) as ROW_COUNT FROM ${RENTAL_TICKET_TABLE} WHERE TICKET_STATUS='OPEN' GROUP BY FILE_DATE, SOURCE_FILENAME, LOADED_TS ORDER BY FILE_DATE DESC LIMIT 60`).catch(() => []) as Promise<any[]>,
        sf.executeQuery(`SELECT FILE_DATE, NULL as SOURCE_FILENAME, NULL as LOADED_TS, COUNT(DISTINCT VEHICLE_NUMBER) as ROW_COUNT FROM (SELECT FILE_DATE, VEHICLE_NUMBER FROM ${RENTAL_TICKET_TABLE} WHERE TICKET_STATUS='OPEN' UNION SELECT h.FILE_DATE, h.VEHICLE_NUMBER FROM ${RENTAL_OPEN_TABLE} h WHERE UPPER(COALESCE(h.RENTAL_VENDOR,'')) NOT LIKE '%ENTERPRISE%' AND UPPER(COALESCE(h.RENTAL_VENDOR,'')) NOT LIKE '%TOLL%' AND NOT EXISTS (SELECT 1 FROM ${RENTAL_TICKET_TABLE} e WHERE e.VEHICLE_NUMBER=h.VEHICLE_NUMBER AND e.TICKET_STATUS='OPEN' AND e.FILE_DATE=h.FILE_DATE)) combined GROUP BY FILE_DATE ORDER BY FILE_DATE DESC LIMIT 60`).catch(() => []) as Promise<any[]>,
        sf.executeQuery(`SELECT FILE_DATE, SOURCE_FILENAME, LOADED_TS, COUNT(*) as ROW_COUNT FROM ${RENTAL_CLOSED_TABLE} GROUP BY FILE_DATE, SOURCE_FILENAME, LOADED_TS ORDER BY FILE_DATE DESC LIMIT 60`).catch(() => []) as Promise<any[]>,
      ]);

      // Merge by FILE_DATE — collect per-table metadata per date
      const dateMap = new Map<string, any>();
      const addRows = (rows: any[], tableKey: string, filenameKey: string, rowCountKey: string) => {
        for (const r of rows as any[]) {
          const fd = toIsoDate(r.FILE_DATE);
          if (!fd) continue;
          if (!dateMap.has(fd)) dateMap.set(fd, { fileDate: fd, loadedTs: r.LOADED_TS || null });
          dateMap.get(fd)[tableKey] = r.SOURCE_FILENAME || null;
          dateMap.get(fd)[rowCountKey] = Number(r.ROW_COUNT || 0);
        }
      };
      addRows(ticketRows as any[], "ticketFilename", "ticketFilename", "ticketRowCount");
      addRows(openRows as any[], "openFilename", "openFilename", "openRowCount");
      addRows(closedRows as any[], "closedFilename", "closedFilename", "closedRowCount");

      const data = Array.from(dateMap.values()).sort((a, b) => b.fileDate.localeCompare(a.fileDate));
      res.json({ data, latestDate: data[0]?.fileDate || null });
    } catch (err: any) {
      return handleSnowflakeError(err, res, RENTAL_TICKET_TABLE);
    }
  });

  app.get("/api/rental-ops/aging-trend", requireAuth, async (_req, res) => {
    try {
      const { getSnowflakeService, isSnowflakeConfigured } = await import("./snowflake-service");
      if (!isSnowflakeConfigured()) return res.status(503).json({ message: "Snowflake not configured", data: [] });
      const sf = getSnowflakeService();
      await sf.connect();

      const sql = `
        WITH ent AS (
          SELECT FILE_DATE, VEHICLE_NUMBER,
            COALESCE(ORIGINAL_START_DATE, RENTAL_START_DATE) AS START_DATE
          FROM ${RENTAL_TICKET_TABLE}
          WHERE TICKET_STATUS = 'OPEN'
            AND FILE_DATE >= DATEADD('day', -65, CURRENT_DATE())
        ),
        hol AS (
          SELECT h.FILE_DATE, h.VEHICLE_NUMBER,
            h.PO_DATE AS START_DATE
          FROM ${RENTAL_OPEN_TABLE} h
          WHERE UPPER(COALESCE(h.RENTAL_VENDOR, '')) NOT LIKE '%ENTERPRISE%'
            AND UPPER(COALESCE(h.RENTAL_VENDOR, '')) NOT LIKE '%TOLL%'
            AND h.FILE_DATE >= DATEADD('day', -65, CURRENT_DATE())
            AND NOT EXISTS (
              SELECT 1 FROM ${RENTAL_TICKET_TABLE} e
              WHERE e.VEHICLE_NUMBER = h.VEHICLE_NUMBER
                AND e.TICKET_STATUS = 'OPEN'
                AND e.FILE_DATE = h.FILE_DATE
            )
        ),
        combined AS (
          SELECT FILE_DATE, VEHICLE_NUMBER, START_DATE FROM ent
          UNION ALL
          SELECT FILE_DATE, VEHICLE_NUMBER, START_DATE FROM hol
        )
        SELECT
          TO_VARCHAR(FILE_DATE, 'YYYY-MM-DD') AS "file_date",
          CASE
            WHEN START_DATE IS NULL OR DATEDIFF('day', START_DATE, FILE_DATE) >= 28 THEN 'd28plus'
            WHEN DATEDIFF('day', START_DATE, FILE_DATE) >= 21 THEN 'd21plus'
            WHEN DATEDIFF('day', START_DATE, FILE_DATE) >= 14 THEN 'd14plus'
            ELSE 'under14'
          END AS "bucket",
          COUNT(DISTINCT VEHICLE_NUMBER) AS "cnt"
        FROM combined
        GROUP BY FILE_DATE, "bucket"
        ORDER BY FILE_DATE
      `;

      const rows = await sf.executeQuery(sql) as any[];

      // Pivot into { fileDate, under14, d14plus, d21plus, d28plus } per date
      const dateMap = new Map<string, any>();
      for (const r of rows) {
        const fd = r.file_date || r.FILE_DATE;
        if (!fd) continue;
        const fdStr = fd instanceof Date ? fd.toISOString().slice(0, 10) : String(fd).slice(0, 10);
        if (!dateMap.has(fdStr)) dateMap.set(fdStr, { fileDate: fdStr, under14: 0, d14plus: 0, d21plus: 0, d28plus: 0 });
        const bucket = r.bucket || r.BUCKET;
        const cnt = Number(r.cnt || r.CNT || 0);
        dateMap.get(fdStr)[bucket] = cnt;
      }

      const data = Array.from(dateMap.values()).sort((a, b) => a.fileDate.localeCompare(b.fileDate));
      res.json({ data });
    } catch (err: any) {
      return handleSnowflakeError(err, res, RENTAL_TICKET_TABLE);
    }
  });

  app.post("/api/rental-ops/qualify", requireAuth, async (req: any, res) => {
    const source = req.body?.source || "all";
    const triggeredBy = req.user?.username || "unknown";
    const results: any[] = [];

    async function qualifyTable(tableName: string, sourceKey: string, sf: any) {
      try {
        const fileFilter = tableName === RENTAL_TICKET_TABLE
          ? ` WHERE ${ticketDateFilter()}`
          : tableName === RENTAL_OPEN_TABLE
          ? ` WHERE ${openDateFilter()}`
          : tableName === RENTAL_CLOSED_TABLE
          ? ` WHERE ${closedDateFilter()}`
          : "";
        const rows = await sf.executeQuery(`SELECT * FROM ${tableName}${fileFilter} LIMIT 5000`) as any[];
        const issues: any[] = [];
        let passRows = 0, warnRows = 0, failRows = 0;
        const duplicateMap = new Map<string, number>();
        const nullCounts: Record<string, number> = {};

        // Normalize vehicle numbers to bare integers (strip leading zeros) so that
        // "000526" from Holman cache matches "526" from the Snowflake rental table.
        const normVehicleNum = (v: string) => String(parseInt(v, 10) || v).trim();
        const knownVehicles = new Set<string>();
        try {
          const vcRows = await db.select({ num: holmanVehiclesCache.holmanVehicleNumber }).from(holmanVehiclesCache);
          for (const v of vcRows) if (v.num) knownVehicles.add(normVehicleNum(v.num));
        } catch {}

        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          const rowNum = i + 1;
          let rowSeverity = "pass";
          const vNum = r.VEHICLE_NUMBER || r.UNIT_NUMBER || r.TRUCK_NUMBER || r.ASSET_NUMBER || "";
          const dupKey = `${vNum}|${(r.PO_NUMBER || r.RENTAL_AGREEMENT || "").replace(/^'/, "").trim()}`;

          // Required fields use actual column names per table
          const requiredFields = sourceKey === "rental_open"
            ? ["VEHICLE_NUMBER", "PO_DATE", "PO_NUMBER"]
            : sourceKey === "rental_closed"
            ? ["VEHICLE_NUMBER", "PO_NUMBER", "RENTAL_END_DATE"]
            : ["VEHICLE_NUMBER", "ECARS_2_0_TKT_NBR", "RENTAL_START_DATE"];

          for (const field of requiredFields) {
            const val = r[field];
            if (val === null || val === undefined || String(val).trim() === "") {
              nullCounts[field] = (nullCounts[field] || 0) + 1;
              issues.push({ row: rowNum, field, issue: `Required field ${field} is null/empty`, severity: "fail" });
              rowSeverity = "fail";
            }
          }

          if (sourceKey === "rental_closed") {
            const start = new Date(parseRentalDate(r.RENTAL_START_DATE) || "");
            const end = new Date(parseRentalDate(r.RENTAL_END_DATE) || "");
            if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && end < start) {
              issues.push({ row: rowNum, field: "RENTAL_END_DATE", issue: "End date before start date", severity: "fail" });
              rowSeverity = "fail";
            }
            const rf = r.REWRITE_FLAG;
            if (rf && !["Y", "N", ""].includes(String(rf).trim())) {
              issues.push({ row: rowNum, field: "REWRITE_FLAG", issue: `Invalid rewrite flag: ${rf}`, severity: "warn" });
              if (rowSeverity === "pass") rowSeverity = "warn";
            }
          }

          if (sourceKey === "rental_open") {
            const poDate = new Date(parseRentalDate(r.PO_DATE) || "");
            if (!isNaN(poDate.getTime()) && poDate > new Date()) {
              issues.push({ row: rowNum, field: "PO_DATE", issue: "Future PO date", severity: "warn" });
              if (rowSeverity === "pass") rowSeverity = "warn";
            }
          }

          if (sourceKey === "rental_ticket_detail") {
            const originalStart = parseRentalDate(r.ORIGINAL_START_DATE);
            const rentalStart = parseRentalDate(r.RENTAL_START_DATE);
            const daysOpen = calcDaysOpen(originalStart || rentalStart);
            if (daysOpen > 90) {
              issues.push({ row: rowNum, field: "ORIGINAL_START_DATE", issue: `Ticket open ${daysOpen} days (>90)`, severity: "warn" });
              if (rowSeverity === "pass") rowSeverity = "warn";
            }
          }

          if (vNum && knownVehicles.size > 0 && !knownVehicles.has(normVehicleNum(String(vNum)))) {
            issues.push({ row: rowNum, field: "VEHICLE_NUMBER", issue: `Vehicle ${vNum} not in Holman fleet cache`, severity: "warn" });
            if (rowSeverity === "pass") rowSeverity = "warn";
          }

          duplicateMap.set(dupKey, (duplicateMap.get(dupKey) || 0) + 1);

          if (rowSeverity === "fail") failRows++;
          else if (rowSeverity === "warn") warnRows++;
          else passRows++;
        }

        const duplicateCount = Array.from(duplicateMap.values()).filter(c => c > 1).reduce((s, c) => s + (c - 1), 0);
        if (duplicateCount > 0) {
          issues.push({ row: null, field: "VEHICLE_NUMBER+PO_NUMBER", issue: `${duplicateCount} duplicate records detected`, severity: "warn" });
        }

        const total = rows.length;
        const nullRateJson: Record<string, number> = {};
        for (const [field, count] of Object.entries(nullCounts)) {
          nullRateJson[field] = total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
        }
        const unmatchedVehicleCount = issues.filter(i => i.issue.includes("not in Holman fleet cache")).length;
        const invalidDateCount = issues.filter(i => i.issue.includes("date")).length;

        const logEntry = await storage.createQualificationLog({
          sourceTable: sourceKey,
          totalRows: total,
          passRows,
          warnRows,
          failRows,
          nullRateJson,
          duplicateCount,
          unmatchedVehicleCount,
          invalidDateCount,
          mismatchedTechCount: 0,
          issuesJson: issues.slice(0, 500),
          triggeredBy,
        });

        results.push({ source: sourceKey, ...logEntry, issues: issues.slice(0, 100) });
      } catch (tableErr: any) {
        results.push({ source: sourceKey, error: tableErr.message });
      }
    }

    try {
      const { getSnowflakeService, isSnowflakeConfigured } = await import("./snowflake-service");
      if (!isSnowflakeConfigured()) return res.status(503).json({ message: "Snowflake not configured" });
      const sf = getSnowflakeService();
      await sf.connect();
      if (source === "all" || source === "rental_open") await qualifyTable(RENTAL_OPEN_TABLE, "rental_open", sf);
      if (source === "all" || source === "rental_closed") await qualifyTable(RENTAL_CLOSED_TABLE, "rental_closed", sf);
      if (source === "all" || source === "rental_ticket_detail") await qualifyTable(RENTAL_TICKET_TABLE, "rental_ticket_detail", sf);
      res.json({ results, ranAt: new Date().toISOString() });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/rental-ops/qualify/history", requireAuth, async (req, res) => {
    try {
      const sourceTable = req.query.source as string | undefined;
      const logs = await storage.getQualificationLogs(sourceTable, 30);
      res.json(logs);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/rental-ops/qualify/latest", requireAuth, async (_req, res) => {
    try {
      const sources = ["rental_open", "rental_closed", "rental_ticket_detail"];
      const results = await Promise.all(sources.map(s => storage.getLatestQualificationLog(s)));
      res.json(results.filter(Boolean));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Cross-system integrity analysis: Enterprise (renter-centric) vs Holman (truck/PO-centric)
  // Uses same transformation logic as the /open endpoint to ensure consistent comparison
  app.get("/api/rental-ops/integrity", requireAuth, async (req, res) => {
    try {
      const { getSnowflakeService, isSnowflakeConfigured } = await import("./snowflake-service");
      if (!isSnowflakeConfigured()) return res.status(503).json({ message: "Snowflake not configured" });
      const sf = getSnowflakeService();
      await sf.connect();

      const intNormVeh = (v: string) => v ? toDisplayNumber(v) : "";

      // Levenshtein edit distance for name comparison
      const intEditDist = (a: string, b: string): number => {
        if (!a || !b) return Math.max(a.length, b.length);
        if (a === b) return 0;
        const m = a.length, n = b.length;
        const prev = Array.from({ length: n + 1 }, (_, j) => j);
        const curr = new Array(n + 1).fill(0);
        for (let i = 1; i <= m; i++) {
          curr[0] = i;
          for (let j = 1; j <= n; j++)
            curr[j] = a[i-1] === b[j-1] ? prev[j-1] : 1 + Math.min(prev[j], curr[j-1], prev[j-1]);
          prev.splice(0, n + 1, ...curr);
        }
        return prev[n];
      };

      const todayMs = Date.now();
      const calcDays = (d: string | null) => d ? Math.floor((todayMs - new Date(d).getTime()) / 86400000) : null;

      // Query both Snowflake tables — same as open endpoint
      const [holmanRaw, entRaw] = await Promise.all([
        sf.executeQuery(`SELECT * FROM ${RENTAL_OPEN_TABLE} WHERE ${openDateFilter(req.query?.fileDate as string)} LIMIT 5000`) as Promise<any[]>,
        sf.executeQuery(`SELECT * FROM ${RENTAL_TICKET_TABLE} WHERE ${ticketDateFilter(req.query?.fileDate as string)} AND TICKET_STATUS='OPEN' LIMIT 5000`) as Promise<any[]>,
      ]);

      // Transform Enterprise rows same way as open endpoint (using outer parseClaimNumber)
      type EntRow = { vehicleNumber: string; renterName: string; poNumber: string; ticketNumber: string; originalStartDate: string | null; daysOpen: number | null };
      const entTransformed: EntRow[] = [];
      const entByVeh = new Map<string, EntRow>();
      for (const r of entRaw) {
        const vn = intNormVeh(r.VEHICLE_NUMBER || "");
        if (!vn || entByVeh.has(vn)) continue; // dedup by vehicle
        const { holmanPo } = parseClaimNumber(r.CLAIM_NUMBER || "");
        const startDate = entOriginalStart(r);
        const row: EntRow = {
          vehicleNumber: vn,
          renterName: (r.RENTER_NAME || "").trim(),
          poNumber: holmanPo,
          ticketNumber: r.TICKET_NUMBER || "",
          originalStartDate: startDate,
          daysOpen: calcDays(startDate),
        };
        entTransformed.push(row);
        entByVeh.set(vn, row);
      }

      // Transform Holman rows — note: Holman open report uses FIRST_NAME + LAST_NAME (not RENTER_NAME)
      // and PO_NUMBER has a leading apostrophe that must be stripped
      type HolRow = { vehicleNumber: string; renterName: string; poNumber: string; startDate: string | null; vendor: string };
      const holmanByVeh = new Map<string, HolRow[]>();
      for (const r of holmanRaw) {
        const vn = intNormVeh(r.VEHICLE_NUMBER || "");
        if (!vn) continue;
        const renterName = r.RENTER_NAME
          ? (r.RENTER_NAME as string).trim()
          : `${r.FIRST_NAME || ""} ${r.LAST_NAME || ""}`.trim();
        const row: HolRow = {
          vehicleNumber: vn,
          renterName,
          poNumber: (r.PO_NUMBER || "").replace(/^'/, "").trim(),
          startDate: r.RENTAL_START_DATE || null,
          vendor: r.RENTAL_VENDOR || "",
        };
        if (!holmanByVeh.has(vn)) holmanByVeh.set(vn, []);
        holmanByVeh.get(vn)!.push(row);
      }

      // --- Category 1: Enterprise tickets with NO Holman PO open for that truck ---
      const orphanedEnterprise: any[] = [];
      for (const e of entTransformed) {
        if (!holmanByVeh.has(e.vehicleNumber)) {
          orphanedEnterprise.push({
            vehicleNumber: e.vehicleNumber,
            ticketNumber: e.ticketNumber,
            renterName: e.renterName,
            entPo: e.poNumber,
            originalStartDate: e.originalStartDate,
            daysOpen: e.daysOpen,
            severity: "high",
            issue: "Enterprise ticket open but no matching Holman PO found for this truck — truck may have been updated mid-rental",
          });
        }
      }

      // --- Categories 2-4: Compare trucks present in both systems ---
      // Process per-VEHICLE (not per PO pair) to avoid duplicate records
      const genuineMismatchList: any[] = [];
      const stalePOList: any[] = [];
      const nameMismatchList: any[] = [];
      const cleanMatchList: any[] = [];
      const multiPoList: any[] = [];

      for (const e of entTransformed) {
        const hRows = holmanByVeh.get(e.vehicleNumber);
        if (!hRows) continue; // orphaned — already handled

        const entName = e.renterName.toLowerCase();
        const entPo = e.poNumber;
        const allHolmanPos = [...new Set(hRows.map(h => h.poNumber))].join(", ");
        const holmanRenters = [...new Set(hRows.map(h => h.renterName))];
        const hasPoMatch = hRows.some(h => h.poNumber === entPo);

        // Multi-PO tracking
        if (hRows.length > 1) {
          const hasDiffRenters = holmanRenters.length > 1;
          multiPoList.push({
            vehicleNumber: e.vehicleNumber,
            poCount: hRows.length,
            renters: holmanRenters,
            hasMultipleRenters: hasDiffRenters,
            pos: hRows.map(h => ({ po: h.poNumber, renter: h.renterName, startDate: h.startDate, vendor: h.vendor })),
            severity: hasDiffRenters ? "high" : "low",
            issue: hasDiffRenters
              ? "Multiple open POs for this truck with DIFFERENT renters — unexpected truck rotation"
              : "Multiple open POs for same renter on same truck — likely rewrites or extensions",
          });
        }

        // Name comparison against the best-matching Holman row (prefer PO match)
        const bestHolRow = hRows.find(h => h.poNumber === entPo) || hRows[0];
        const holName = bestHolRow.renterName.toLowerCase();
        const nameMatch = entName === holName;

        if (!nameMatch && entName && holName) {
          const dist = intEditDist(entName, holName);
          const suffixWords = [" sr", " jr", " ii", " iii"];
          const hasSuffix = suffixWords.some(s => holName.endsWith(s) || entName.endsWith(s));
          const isGenuine = dist > 3 && !hasSuffix;
          const cat = isGenuine ? "genuine_renter_mismatch" : hasSuffix ? "name_suffix" : "name_typo";
          const entry = {
            vehicleNumber: e.vehicleNumber,
            ticketNumber: e.ticketNumber,
            enterpriseRenter: e.renterName,
            holmanRenter: bestHolRow.renterName,
            entPo,
            holmanPo: bestHolRow.poNumber,
            allHolmanPos,
            poMatch: hasPoMatch,
            originalStartDate: e.originalStartDate,
            holmanStartDate: bestHolRow.startDate,
            daysOpen: e.daysOpen,
            category: cat,
            severity: isGenuine ? "high" : "low",
            issue: isGenuine
              ? "Different person in Enterprise vs Holman for the same truck — truck was likely rotated to a new tech but Enterprise ticket was not updated"
              : hasSuffix
              ? "Name suffix difference (Sr/Jr) between Enterprise and Holman records"
              : "Minor name spelling difference between Enterprise and Holman records",
          };
          if (isGenuine) genuineMismatchList.push(entry);
          else nameMismatchList.push(entry);
        } else if (!hasPoMatch && entPo && nameMatch) {
          stalePOList.push({
            vehicleNumber: e.vehicleNumber,
            ticketNumber: e.ticketNumber,
            renterName: e.renterName,
            entPo,
            holmanPo: bestHolRow.poNumber,
            allHolmanPos,
            originalStartDate: e.originalStartDate,
            holmanStartDate: bestHolRow.startDate,
            daysOpen: e.daysOpen,
            severity: "medium",
            issue: "Enterprise references an old PO — Holman has rotated to a newer PO for this truck (rewrite/extension not reflected in Enterprise claim number)",
          });
        } else if (nameMatch && hasPoMatch) {
          cleanMatchList.push({ vehicleNumber: e.vehicleNumber, entPo });
        }
      }

      // --- Summary ---
      const totalEnterprise = entTransformed.length;
      const highRisk = orphanedEnterprise.length + genuineMismatchList.length;
      const mediumRisk = stalePOList.length;
      const lowRisk = nameMismatchList.length;
      const clean = cleanMatchList.length;
      const integrityScore = totalEnterprise > 0 ? Math.round((clean / totalEnterprise) * 100) : 0;

      res.json({
        summary: {
          totalEnterpriseTickets: totalEnterprise,
          totalHolmanPOs: holmanRaw.length,
          cleanMatches: clean,
          highRiskCount: highRisk,
          mediumRiskCount: mediumRisk,
          lowRiskCount: lowRisk,
          integrityScore,
        },
        categories: {
          orphanedEnterprise: {
            label: "No Holman PO for truck",
            description: "Enterprise ticket open but truck has no active Holman PO — truck number likely changed mid-rental",
            severity: "high",
            count: orphanedEnterprise.length,
            records: orphanedEnterprise.sort((a, b) => (b.daysOpen || 0) - (a.daysOpen || 0)),
          },
          genuineRenterMismatch: {
            label: "Different renter in each system",
            description: "Completely different people listed for the same truck — truck was likely rotated to a new tech but Enterprise ticket was not updated",
            severity: "high",
            count: genuineMismatchList.length,
            records: genuineMismatchList.sort((a, b) => (b.daysOpen || 0) - (a.daysOpen || 0)),
          },
          stalePO: {
            label: "Stale PO reference",
            description: "Enterprise claim number points to an old Holman PO — Holman has since issued a newer PO for this truck via rewrite/extension",
            severity: "medium",
            count: stalePOList.length,
            records: stalePOList.sort((a, b) => (b.daysOpen || 0) - (a.daysOpen || 0)),
          },
          nameTypo: {
            label: "Name spelling difference",
            description: "Minor formatting or spelling differences between Enterprise and Holman records for the same truck",
            severity: "low",
            count: nameMismatchList.length,
            records: nameMismatchList,
          },
          multipleHolmanPOs: {
            label: "Multiple Holman POs per truck",
            description: "Truck has more than one open PO in Holman — same renter = rewrites/extensions (expected), different renters = unexpected rotation",
            severity: "low",
            count: multiPoList.length,
            highSeverityCount: multiPoList.filter((x: any) => x.hasMultipleRenters).length,
            records: multiPoList,
          },
        },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/rental-ops/export.xlsx", requireAuth, async (req, res) => {
    try {
      const { getSnowflakeService, isSnowflakeConfigured } = await import("./snowflake-service");
      if (!isSnowflakeConfigured()) return res.status(503).json({ message: "Snowflake not configured" });
      const sf = getSnowflakeService();
      await sf.connect();
      const normVeh = (v: string) => v ? toDisplayNumber(v) : "";

      const [ticketRows, holmanRows, closedRows] = await Promise.all([
        sf.executeQuery(`SELECT * FROM ${RENTAL_TICKET_TABLE} WHERE ${ticketDateFilter(req.query?.fileDate as string)} AND TICKET_STATUS='OPEN' LIMIT 5000`) as Promise<any[]>,
        sf.executeQuery(`SELECT * FROM ${RENTAL_OPEN_TABLE} WHERE ${openDateFilter(req.query?.fileDate as string)} LIMIT 5000`) as Promise<any[]>,
        sf.executeQuery(`SELECT * FROM ${RENTAL_CLOSED_TABLE} WHERE ${closedDateFilter(req.query?.fileDate as string)} LIMIT 5000`).catch(() => []) as Promise<any[]>,
      ]);

      const allEntVns = new Set<string>();
      for (const r of ticketRows) {
        const vn = normVeh(r.VEHICLE_NUMBER || "");
        if (vn) allEntVns.add(vn);
      }

      const entByVehicle = new Map<string, any>();
      for (const r of ticketRows) {
        const vn = normVeh(r.VEHICLE_NUMBER || "");
        if (!vn) continue;
        const existing = entByVehicle.get(vn);
        const rDate = new Date(r.RENTAL_START_DATE || "2000-01-01").getTime();
        const eDate = existing ? new Date(existing.RENTAL_START_DATE || "2000-01-01").getTime() : 0;
        if (!existing || rDate > eDate) entByVehicle.set(vn, r);
      }

      const enterpriseSegment = Array.from(entByVehicle.entries()).map(([vn, r]) => {
        const originalStartDate = entOriginalStart(r);
        const { holmanPo } = parseClaimNumber(r.CLAIM_NUMBER || "");
        return {
          vehicleNumber: vn,
          division: "",
          renterName: (r.RENTER_NAME || "").trim(),
          enterpriseId: null as string | null,
          source: "enterprise",
          poNumber: holmanPo || "",
          rentalStartDate: originalStartDate || "",
          daysOpen: calcDaysOpen(originalStartDate),
          rewriteFlag: r.NUMBER_OF_EXTENSIONS && parseInt(String(r.NUMBER_OF_EXTENSIONS)) > 0 ? "Y" : "",
        };
      });

      const isEntVendor = (v: string | null) => !v || /enterprise/i.test(v) || /toll/i.test(v);
      const holmanByVehicle = new Map<string, any[]>();
      for (const r of holmanRows) {
        const vn = normVeh(r.VEHICLE_NUMBER || "");
        if (!vn) continue;
        if (isEntVendor(r.RENTAL_VENDOR)) continue;
        if (allEntVns.has(vn)) continue;
        if (!holmanByVehicle.has(vn)) holmanByVehicle.set(vn, []);
        holmanByVehicle.get(vn)!.push(r);
      }

      const holmanSegment = Array.from(holmanByVehicle.entries()).map(([vn, group]) => {
        const sorted = group.sort((a: any, b: any) =>
          new Date(b.PO_DATE || "2000-01-01").getTime() - new Date(a.PO_DATE || "2000-01-01").getTime()
        );
        const r = sorted[0];
        const startDate = parseRentalDate(r.PO_DATE || r.RENTAL_START_DATE);
        return {
          vehicleNumber: vn,
          division: mapDivision(r.DIVISION),
          renterName: `${r.FIRST_NAME || ""} ${r.LAST_NAME || ""}`.trim(),
          enterpriseId: (r.ENTERPRISE_ID || null) as string | null,
          source: "holman_non_enterprise",
          poNumber: (r.PO_NUMBER || "").replace(/^'/, "").trim(),
          rentalStartDate: startDate || "",
          daysOpen: calcDaysOpen(startDate),
          rewriteFlag: "",
        };
      });

      let openData = [...enterpriseSegment, ...holmanSegment];

      // Enrich Enterprise segment rows with Enterprise ID from TPMS name matching
      await rentalEnrichEnterpriseIds(sf, openData);

      const includeOos = req.query?.includeOos === "true";
      if (!includeOos) {
        const oosVehicles = await getOosVehicleSet();
        if (oosVehicles.size > 0) {
          openData = openData.filter(v => !oosVehicles.has(toDisplayNumber(v.vehicleNumber || "")));
        }
      }

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Nexus Fleet Operations";
      workbook.created = new Date();

      const headerStyle: Partial<ExcelJS.Style> = {
        font: { bold: true, color: { argb: "FFFFFFFF" } },
        fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } },
        border: {
          bottom: { style: "thin", color: { argb: "FFAAAAAA" } },
        },
      };

      function addSheet(name: string, cols: { header: string; key: string; width: number }[], rowData: any[]) {
        const ws = workbook.addWorksheet(name);
        ws.columns = cols;
        const headerRow = ws.getRow(1);
        cols.forEach((_, i) => { Object.assign(headerRow.getCell(i + 1), headerStyle); });
        headerRow.commit();
        for (const row of rowData) ws.addRow(row);
        ws.autoFilter = { from: "A1", to: `${String.fromCharCode(64 + cols.length)}1` };
      }

      addSheet("Position Report", [
        { header: "Vehicle #", key: "vehicleNumber", width: 14 },
        { header: "Division", key: "division", width: 16 },
        { header: "Tech / Renter", key: "renterName", width: 28 },
        { header: "Enterprise ID", key: "enterpriseId", width: 16 },
        { header: "PO Number", key: "poNumber", width: 20 },
        { header: "Start Date", key: "rentalStartDate", width: 16 },
        { header: "Days Open", key: "daysOpen", width: 12 },
        { header: "Extension", key: "rewriteFlag", width: 12 },
      ], [...openData].sort((a, b) => a.renterName.localeCompare(b.renterName)));

      addSheet("Active Rentals", [
        { header: "Vehicle #", key: "vehicleNumber", width: 14 },
        { header: "Division", key: "division", width: 16 },
        { header: "Tech / Renter", key: "renterName", width: 28 },
        { header: "Enterprise ID", key: "enterpriseId", width: 16 },
        { header: "PO Number", key: "poNumber", width: 20 },
        { header: "Start Date", key: "rentalStartDate", width: 16 },
        { header: "Days Open", key: "daysOpen", width: 12 },
        { header: "Extension", key: "rewriteFlag", width: 12 },
      ], [...openData].sort((a, b) => b.daysOpen - a.daysOpen));

      const closedDeduped = new Map<string, any>();
      for (const r of closedRows) {
        const po = (r.PO_NUMBER || "").replace(/^'/, "").trim();
        const key = `${r.VEHICLE_NUMBER || ""}|${po}`;
        if (!closedDeduped.has(key)) {
          closedDeduped.set(key, {
            vehicleNumber: r.VEHICLE_NUMBER || r.UNIT_NUMBER || "",
            division: r.DIVISION || "",
            renterName: (r.RENTER_NAME || "").trim(),
            poNumber: po,
            rentalStartDate: r.RENTAL_START_DATE || "",
            originalStartDate: r.ORIGINAL_START_DATE || "",
            rentalEndDate: r.RENTAL_END_DATE || "",
            rentalDays: r.RENTAL_DAYS || "",
            rewriteFlag: r.REWRITE_FLAG || "",
          });
        }
      }
      const extensionData = Array.from(closedDeduped.values()).filter(r => r.rewriteFlag === "Y");

      addSheet("Extensions", [
        { header: "Vehicle #", key: "vehicleNumber", width: 14 },
        { header: "Division", key: "division", width: 16 },
        { header: "Tech / Renter", key: "renterName", width: 28 },
        { header: "PO Number", key: "poNumber", width: 20 },
        { header: "Original Start", key: "originalStartDate", width: 16 },
        { header: "Start Date", key: "rentalStartDate", width: 16 },
        { header: "End Date", key: "rentalEndDate", width: 16 },
        { header: "Days", key: "rentalDays", width: 10 },
      ], extensionData);

      res.setHeader("Content-Disposition", `attachment; filename="Rental-Operations-${new Date().toISOString().slice(0, 10)}.xlsx"`);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      await workbook.xlsx.write(res);
      res.end();
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // =====================================================================
  // Holman PO Tracking — reads from HOLMAN_ETL_PO_DETAILS
  // =====================================================================
  const HOLMAN_PO_ETL_TABLE = "PARTS_SUPPLYCHAIN.FLEET.HOLMAN_ETL_PO_DETAILS";

  app.post("/api/holman/pos/sync", requireAuth, async (req: any, res) => {
    try {
      const { getSnowflakeService, isSnowflakeConfigured } = await import("./snowflake-service");
      if (!isSnowflakeConfigured()) return res.status(503).json({ message: "Snowflake not configured" });
      const sf = getSnowflakeService();
      await sf.connect();

      const rows = await sf.executeQuery(
        `SELECT PO_NUMBER, HOLMAN_VEHICLE_NUMBER, SERIAL_NO,
                PO_TYPE_DESCRIPTION, DIVISION, PO_STATUS, PO_DATE,
                LINE_ITEM_COST, DESCRIPTION, VENDOR_NAME, ENTERPRISE_ID,
                ATA_CODE, ATA_GROUP_DESC, REPAIR_TYPE_DESCRIPTION
         FROM ${HOLMAN_PO_ETL_TABLE}
         WHERE PO_NUMBER IS NOT NULL
         LIMIT 50000`
      ) as any[];
      console.log(`[PO Sync] Fetched ${rows.length} raw rows from ETL table`);

      // Deduplicate in JS: keep last-seen row per (po_number, vehicle_number) pair.
      const seen = new Map<string, any>();
      for (const r of rows) {
        const key = `${r.PO_NUMBER}|${r.HOLMAN_VEHICLE_NUMBER}`;
        seen.set(key, r);
      }
      const deduped = Array.from(seen.values());
      console.log(`[PO Sync] Deduped to ${deduped.length} unique PO+vehicle records`);

      const records = deduped.map((r: any) => {
        const typeDesc = (r.PO_TYPE_DESCRIPTION || r.DIVISION || "").toLowerCase();
        let poType: string;
        if (typeDesc.includes("rental") || typeDesc.includes("interim")) poType = "rental";
        else if (typeDesc.includes("maint") || typeDesc.includes("repair") || typeDesc.includes("service")) poType = "maintenance";
        else poType = "other";

        return {
          poNumber: String(r.PO_NUMBER || "").replace(/^'/, "").trim(),
          vehicleNumber: String(r.HOLMAN_VEHICLE_NUMBER || "").trim(),
          vin: String(r.SERIAL_NO || "").trim() || null,
          poType,
          poStatus: String(r.PO_STATUS || "").trim() || null,
          poDate: r.PO_DATE || null,
          amount: r.LINE_ITEM_COST ?? null,
          description: String(r.DESCRIPTION || r.PO_TYPE_DESCRIPTION || "").trim().slice(0, 500) || null,
          vendor: String(r.VENDOR_NAME || "").trim() || null,
          rawData: { poTypeDescription: r.PO_TYPE_DESCRIPTION, division: r.DIVISION, enterpriseId: r.ENTERPRISE_ID, ataCode: r.ATA_CODE, ataGroupDesc: r.ATA_GROUP_DESC, repairType: r.REPAIR_TYPE_DESCRIPTION },
        };
      }).filter(r => r.poNumber);

      const synced = await storage.upsertHolmanPoCache(records);
      res.json({ synced, lastSyncedAt: new Date().toISOString() });
    } catch (err: any) {
      const msg = err.message || "";
      const isTableMissing = (msg.includes("does not exist") && msg.toLowerCase().includes("table"))
        || err.code === "002003";
      const status = isTableMissing ? 503 : 500;
      const message = isTableMissing
        ? `Snowflake table not available: ${HOLMAN_PO_ETL_TABLE}.`
        : msg;
      console.error(`[PO Sync] Error (${status}):`, msg);
      res.status(status).json({ message });
    }
  });

  app.get("/api/holman/pos/sync/status", requireAuth, async (_req, res) => {
    try {
      const [count, lastSync] = await Promise.all([
        storage.getHolmanPoCacheCount(),
        storage.getHolmanPoCacheLastSync(),
      ]);
      res.json({ cachedRows: count, lastSyncedAt: lastSync });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/holman/pos", requireAuth, async (req, res) => {
    try {
      const filters: any = {};
      if (req.query.vehicleNumber) filters.vehicleNumber = req.query.vehicleNumber as string;
      if (req.query.poType) filters.poType = req.query.poType as string;
      if (req.query.poStatus) filters.poStatus = req.query.poStatus as string;
      if (req.query.search) filters.search = req.query.search as string;
      const data = await storage.getHolmanPosAll(filters);
      res.json({ data, total: data.length });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/holman/pos/:vehicleNumber", requireAuth, async (req, res) => {
    try {
      const vehicleNumber = req.params.vehicleNumber.trim();

      // Query Snowflake directly for complete, up-to-date PO history
      const { getSnowflakeService, isSnowflakeConfigured } = await import("./snowflake-service");
      if (isSnowflakeConfigured()) {
        try {
          const sf = getSnowflakeService();
          await sf.connect();

          const rows = await sf.executeQuery(
            `SELECT
               PO_NUMBER,
               PO_TYPE_DESCRIPTION,
               DIVISION,
               PO_STATUS,
               PO_DATE,
               LINE_ITEM_COST,
               DESCRIPTION,
               VENDOR_NAME,
               ENTERPRISE_ID,
               SERIAL_NO,
               ATA_CODE,
               ATA_GROUP_DESC,
               REPAIR_TYPE_DESCRIPTION
             FROM PARTS_SUPPLYCHAIN.FLEET.HOLMAN_ETL_PO_DETAILS
             WHERE HOLMAN_VEHICLE_NUMBER = '${vehicleNumber}'
             ORDER BY PO_DATE DESC NULLS LAST, PO_NUMBER`
          ) as any[];

          const data = rows.map((r: any) => {
            const typeDesc = (r.PO_TYPE_DESCRIPTION || r.DIVISION || "").toLowerCase();
            let poType: string;
            if (typeDesc.includes("rental") || typeDesc.includes("interim")) poType = "rental";
            else if (typeDesc.includes("maint") || typeDesc.includes("repair") || typeDesc.includes("service")) poType = "maintenance";
            else poType = typeDesc || "other";

            return {
              poNumber: String(r.PO_NUMBER || "").replace(/^'/, "").trim(),
              poType,
              poStatus: String(r.PO_STATUS || "").trim() || null,
              poDate: r.PO_DATE ? String(r.PO_DATE).slice(0, 10) : null,
              amount: r.LINE_ITEM_COST ?? null,
              description: String(r.DESCRIPTION || r.PO_TYPE_DESCRIPTION || "").trim().slice(0, 500) || null,
              vendor: String(r.VENDOR_NAME || "").trim() || null,
              vin: String(r.SERIAL_NO || "").trim() || null,
              ataCode: String(r.ATA_CODE || "").trim() || null,
              ataGroupDesc: String(r.ATA_GROUP_DESC || "").trim() || null,
              repairType: String(r.REPAIR_TYPE_DESCRIPTION || "").trim() || null,
            };
          }).filter(r => r.poNumber);

          return res.json({ data, total: data.length, source: "snowflake" });
        } catch (sfErr: any) {
          console.warn("[PO History] Snowflake query failed, falling back to cache:", sfErr.message);
        }
      }

      // Fallback: local cache
      const data = await storage.getHolmanPosByVehicle(vehicleNumber);
      res.json({ data, total: data.length, source: "cache" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // =====================================================================
  // Fleet Operations (T004) — cross-system assign/unassign/address
  // =====================================================================
  const { fleetOpsService } = await import("./fleet-operations-service");

  app.post("/api/fleet-ops/assign", requireAuth, async (req: any, res) => {
    try {
      const { truckNumber, ldapId, districtNo, techName, notes, assignmentType, amsStatusId, repairData } = req.body;
      if (!truckNumber || !ldapId) {
        return res.status(400).json({ message: "truckNumber and ldapId are required" });
      }
      const requestedBy = req.user?.username || "unknown";
      const result = await fleetOpsService.assignTech({ truckNumber, ldapId, districtNo, techName: techName || ldapId, requestedBy, notes, assignmentType, amsStatusId: amsStatusId ? Number(amsStatusId) : undefined, repairData });
      if ('locked' in result && result.locked) {
        return res.status(409).json({ message: result.message });
      }
      if (!('overallSuccess' in result)) return res.status(500).json({ message: "Unexpected result" });
      const statusCode = result.overallSuccess ? 200 : result.partialSuccess ? 207 : 500;
      res.status(statusCode).json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/fleet-ops/unassign", requireAuth, async (req: any, res) => {
    try {
      const { truckNumber, ldapId, notes } = req.body;
      if (!truckNumber || !ldapId) {
        return res.status(400).json({ message: "truckNumber and ldapId are required" });
      }
      const requestedBy = req.user?.username || "unknown";
      const result = await fleetOpsService.unassignTech({ truckNumber, ldapId, requestedBy, notes });
      if ('locked' in result && result.locked) {
        return res.status(409).json({ message: result.message });
      }
      if (!('overallSuccess' in result)) return res.status(500).json({ message: "Unexpected result" });
      const statusCode = result.overallSuccess ? 200 : result.partialSuccess ? 207 : 500;
      res.status(statusCode).json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/fleet-ops/update-address", requireAuth, async (req: any, res) => {
    try {
      const { truckNumber, ldapId, address, city, state, zip } = req.body;
      if (!truckNumber || !ldapId || !address || !city || !state || !zip) {
        return res.status(400).json({ message: "truckNumber, ldapId, address, city, state, zip are required" });
      }
      const requestedBy = req.user?.username || "unknown";
      const result = await fleetOpsService.updateAddress({ truckNumber, ldapId, address, city, state, zip, requestedBy });
      const statusCode = result.overallSuccess ? 200 : result.partialSuccess ? 207 : 500;
      res.status(statusCode).json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Return vehicle status info from cache for eligibility checking
  app.get("/api/fleet-ops/vehicle-status/:truckNumber", requireAuth, async (req, res) => {
    try {
      const { truckNumber } = req.params;
      const { db: dbConn } = await import("./db");
      const { holmanVehiclesCache } = await import("@shared/schema");
      const { toHolmanRef, toDisplayNumber, toCanonical } = await import("./vehicle-number-utils");
      const { eq, or } = await import("drizzle-orm");

      const candidates = Array.from(new Set([
        toHolmanRef(truckNumber),
        toDisplayNumber(truckNumber),
        truckNumber.trim(),
        toCanonical(truckNumber),
      ])).filter(Boolean);

      let row: any = null;
      for (const candidate of candidates) {
        const rows = await dbConn.select({
          holmanVehicleNumber: holmanVehiclesCache.holmanVehicleNumber,
          holmanAssignedStatusCd: holmanVehiclesCache.holmanAssignedStatusCd,
          holmanTechAssigned: holmanVehiclesCache.holmanTechAssigned,
          holmanTechName: holmanVehiclesCache.holmanTechName,
          operationLockAt: holmanVehiclesCache.operationLockAt,
          operationLockedBy: holmanVehiclesCache.operationLockedBy,
          byovVinMissing: holmanVehiclesCache.byovVinMissing,
          vin: holmanVehiclesCache.vin,
        }).from(holmanVehiclesCache)
          .where(eq(holmanVehiclesCache.holmanVehicleNumber, candidate))
          .limit(1);
        if (rows[0]) { row = rows[0]; break; }
      }

      if (!row) {
        return res.status(404).json({ message: "Vehicle not found in cache" });
      }

      // Check if lock is active (not expired)
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
      const isLocked = row.operationLockAt && new Date(row.operationLockAt) > twoMinutesAgo;

      res.json({
        holmanVehicleNumber: row.holmanVehicleNumber,
        holmanAssignedStatusCd: row.holmanAssignedStatusCd,
        holmanTechAssigned: row.holmanTechAssigned,
        holmanTechName: row.holmanTechName,
        isLocked,
        lockedBy: isLocked ? row.operationLockedBy : null,
        byovVinMissing: row.byovVinMissing,
        vin: row.vin,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/fleet-ops/logs", requireAuth, async (req, res) => {
    try {
      const filters: any = {};
      if (req.query.operationType) filters.operationType = req.query.operationType as string;
      if (req.query.truckNumber) filters.truckNumber = req.query.truckNumber as string;
      if (req.query.ldap) filters.ldap = req.query.ldap as string;
      const logs = await storage.getFleetOperationLogs(filters);
      res.json(logs);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Return the most recent fleet operation log entry for a given truck number,
  // so the frontend can display per-system sync status without waiting for a mutation.
  app.get("/api/fleet-ops/recent-op/:truckNumber", requireAuth, async (req, res) => {
    try {
      const { truckNumber } = req.params;
      const { toHolmanRef, toDisplayNumber, toCanonical } = await import("./vehicle-number-utils");
      const candidates = Array.from(new Set([
        truckNumber.trim(),
        toHolmanRef(truckNumber),
        toDisplayNumber(truckNumber),
        toCanonical(truckNumber),
      ])).filter(Boolean);

      const { fleetOperationLog: fol } = await import("@shared/schema");
      const { or, eq, desc } = await import("drizzle-orm");
      const orClauses = candidates.map(c => eq(fol.truckNumber, c));
      const rows = await db.select({
        id: fol.id,
        operationType: fol.operationType,
        tpmsStatus: fol.tpmsStatus,
        tpmsMessage: fol.tpmsMessage,
        holmanStatus: fol.holmanStatus,
        holmanMessage: fol.holmanMessage,
        amsStatus: fol.amsStatus,
        amsMessage: fol.amsMessage,
        toLdap: fol.toLdap,
        toTechName: fol.toTechName,
        requestedBy: fol.requestedBy,
        createdAt: fol.createdAt,
      }).from(fol).where(or(...orClauses)).orderBy(desc(fol.createdAt)).limit(1);

      if (!rows[0]) {
        return res.status(404).json({ message: "No operation log found for this vehicle" });
      }
      res.json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Cross-System Alignment Endpoints ───────────────────────────────────────

  // Role guard helper for fleet admin operations
  function requireFleetAdmin(req: any, res: any): boolean {
    if (!req.user || (req.user.role !== 'developer' && req.user.role !== 'admin')) {
      res.status(403).json({ message: "Fleet admin or developer role required" });
      return false;
    }
    return true;
  }

  // In-memory mismatch cache (15 min TTL) — only stores full analysis results
  let mismatchCache: { data: any[]; count: number; computedAt: number } | null = null;
  const MISMATCH_CACHE_TTL = 15 * 60 * 1000;

  /** Extract typed rows from a Drizzle db.execute() result (may be { rows: T[] } or T[]). */
  function dbRows<T = Record<string, unknown>>(result: unknown): T[] {
    if (result && typeof result === "object" && "rows" in result && Array.isArray((result as { rows: unknown }).rows)) {
      return (result as { rows: T[] }).rows;
    }
    return Array.isArray(result) ? (result as T[]) : [];
  }

  // Helper that queries and builds the full mismatch record list
  async function buildMismatchRecords(): Promise<any[]> {
    const { analyzeAlignment } = await import("./alignment-analysis-service");

    // Query: any two of Holman / TPMS / AMS disagree on assignment
    const rawResult = await db.execute(sql`
      WITH tpms_latest AS (
        SELECT DISTINCT ON (truck_no)
          LTRIM(truck_no, '0') AS canonical_truck,
          enterprise_id AS tpms_id,
          TRIM(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')) AS tpms_name,
          district_no
        FROM tpms_cached_assignments
        WHERE truck_no IS NOT NULL AND truck_no != ''
        ORDER BY truck_no, last_success_at DESC
      )
      SELECT
        h.holman_vehicle_number AS truck_number,
        h.holman_tech_assigned AS holman_tech_id,
        h.holman_tech_name AS holman_tech_name,
        COALESCE(t.tpms_id, '') AS tpms_tech_id,
        COALESCE(t.tpms_name, '') AS tpms_tech_name,
        a.ams_assigned_ldap AS ams_tech_id,
        h.vin,
        h.holman_assigned_status_cd AS holman_status_cd,
        h.byov_vin_missing,
        t.district_no
      FROM holman_vehicles_cache h
      LEFT JOIN tpms_latest t ON t.canonical_truck = h.holman_vehicle_number
      LEFT JOIN ams_vehicles_cache a ON a.vin = h.vin
      WHERE h.is_active = true
        AND (h.status_code != 2 OR h.status_code IS NULL)
        AND h.out_of_service_date IS NULL
        AND (
          -- Holman ≠ TPMS
          (
            COALESCE(LOWER(TRIM(h.holman_tech_assigned)), '') != ''
            AND COALESCE(LOWER(TRIM(t.tpms_id)), '') != ''
            AND LOWER(TRIM(h.holman_tech_assigned)) != LOWER(TRIM(t.tpms_id))
          )
          -- Holman assigned, TPMS unassigned
          OR (
            COALESCE(TRIM(h.holman_tech_assigned), '') != ''
            AND COALESCE(TRIM(t.tpms_id), '') = ''
          )
          -- TPMS assigned, Holman unassigned
          OR (
            COALESCE(TRIM(t.tpms_id), '') != ''
            AND COALESCE(TRIM(h.holman_tech_assigned), '') = ''
          )
          -- AMS ≠ TPMS (both assigned, different values)
          OR (
            a.ams_assigned_ldap IS NOT NULL
            AND TRIM(a.ams_assigned_ldap) != ''
            AND COALESCE(TRIM(t.tpms_id), '') != ''
            AND LOWER(TRIM(a.ams_assigned_ldap)) != LOWER(TRIM(t.tpms_id))
          )
          -- AMS assigned, TPMS unassigned (AMS disagrees with TPMS's blank)
          OR (
            a.ams_assigned_ldap IS NOT NULL
            AND TRIM(a.ams_assigned_ldap) != ''
            AND COALESCE(TRIM(t.tpms_id), '') = ''
          )
          -- AMS unassigned but TPMS and/or Holman are assigned (AMS is blank, others are not)
          OR (
            (a.ams_assigned_ldap IS NULL OR TRIM(a.ams_assigned_ldap) = '')
            AND (
              COALESCE(TRIM(t.tpms_id), '') != ''
              OR COALESCE(TRIM(h.holman_tech_assigned), '') != ''
            )
            -- Only flag this if the AMS row exists in the cache (vehicle is tracked in AMS)
            AND a.vin IS NOT NULL
          )
          -- AMS ≠ Holman (both assigned, different values, no TPMS)
          OR (
            a.ams_assigned_ldap IS NOT NULL
            AND TRIM(a.ams_assigned_ldap) != ''
            AND COALESCE(TRIM(h.holman_tech_assigned), '') != ''
            AND COALESCE(TRIM(t.tpms_id), '') = ''
            AND LOWER(TRIM(a.ams_assigned_ldap)) != LOWER(TRIM(h.holman_tech_assigned))
          )
        )
      ORDER BY h.holman_vehicle_number
    `);

    const rows = dbRows<Record<string, string | null>>(rawResult);

    const records = await Promise.all(
      rows.map(async (row: any) => {
        const analysis = await analyzeAlignment(
          row.truck_number,
          row.holman_tech_id || null,
          row.holman_tech_name || null,
          row.tpms_tech_id || null,
          row.tpms_tech_name || null,
          row.ams_tech_id || null,
          row.vin || null,
          row.holman_status_cd || null,
          !!row.byov_vin_missing,
          row.district_no || null,
        );
        return {
          truckNumber: row.truck_number,
          holmanTechId: row.holman_tech_id || null,
          holmanTechName: row.holman_tech_name || null,
          tpmsTechId: row.tpms_tech_id || null,
          tpmsTechName: row.tpms_tech_name || null,
          amsTechId: row.ams_tech_id || null,
          vin: row.vin || null,
          holmanStatusCd: row.holman_status_cd || null,
          byovVinMissing: !!row.byov_vin_missing,
          districtNo: row.district_no || null,
          ...analysis,
        };
      })
    );

    return records;
  }

  app.get("/api/fleet-ops/mismatches", requireAuth, async (req: any, res) => {
    try {
      const countOnly = req.query.countOnly === "true";
      const forceRefresh = req.query.forceRefresh === "true";
      const rootCauseFilter = req.query.rootCause as string | undefined;
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const pageSize = Math.min(200, Math.max(10, parseInt(req.query.pageSize as string) || 100));

      // Serve from cache when not forced and still fresh (cache always has full data)
      if (!forceRefresh && mismatchCache && (Date.now() - mismatchCache.computedAt) < MISMATCH_CACHE_TTL) {
        if (countOnly) {
          return res.json({ count: mismatchCache.count });
        }
        let data = mismatchCache.data;
        if (rootCauseFilter) data = data.filter((r: any) => r.rootCause === rootCauseFilter);
        const total = data.length;
        const paginated = data.slice((page - 1) * pageSize, page * pageSize);
        return res.json({ data: paginated, total, page, pageSize });
      }

      // Build full analysis (always, so countOnly also populates full cache)
      const records = await buildMismatchRecords();
      mismatchCache = { data: records, count: records.length, computedAt: Date.now() };

      if (countOnly) {
        return res.json({ count: records.length });
      }

      let data = records;
      if (rootCauseFilter) data = data.filter((r: any) => r.rootCause === rootCauseFilter);
      const total = data.length;
      const paginated = data.slice((page - 1) * pageSize, page * pageSize);
      res.json({ data: paginated, total, page, pageSize });
    } catch (err: any) {
      console.error("[Alignment] mismatches error:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/fleet-ops/bulk-runs/:runId — poll run state (owner or admin)
  app.get("/api/fleet-ops/bulk-runs/:runId", requireAuth, async (req: any, res) => {
    try {
      const { runId } = req.params;
      const runResult = await db.execute(sql`
        SELECT run_id, status, started_by, started_at, cancelled_at, completed_at
        FROM bulk_fix_runs WHERE run_id = ${runId}
      `);
      const runRows = dbRows<{ run_id: string; status: string; started_by: string; started_at: unknown; cancelled_at: unknown; completed_at: unknown }>(runResult);
      if (runRows.length === 0) return res.status(404).json({ message: "Run not found" });
      const run = runRows[0];

      // Ownership check: must be the run owner or an admin/developer
      const username = req.user?.username || "";
      const isAdmin = req.user?.role === "admin" || req.user?.role === "developer";
      if (!isAdmin && run.started_by !== username) {
        return res.status(403).json({ message: "Access denied" });
      }

      const itemsResult = await db.execute(sql`
        SELECT id, truck_number, action, ldap_id, status, outcome, processed_at
        FROM bulk_fix_run_items WHERE run_id = ${runId}
        ORDER BY processed_at ASC NULLS LAST, id ASC
      `);
      type RunItem = { id: string; truck_number: string; action: string; ldap_id: string | null; status: string; outcome: unknown; processed_at: unknown };
      const items = dbRows<RunItem>(itemsResult);

      const processedItems = items.filter(i => ["completed", "failed"].includes(i.status));
      // High-failure warning: evaluate against the first 10 processed items in true processing order
      // (ORDER BY processed_at ASC, so this is deterministic and stable once set).
      const first10Processed = processedItems.slice(0, 10);
      const highFailureWarning = first10Processed.length >= 10 &&
        first10Processed.filter((i: any) => i.status === "failed").length / first10Processed.length > 0.25;

      res.json({
        runId: run.run_id,
        status: run.status,
        startedBy: run.started_by,
        startedAt: run.started_at,
        cancelledAt: run.cancelled_at,
        completedAt: run.completed_at,
        highFailureWarning,
        items: items.map(i => ({
          id: i.id,
          truckNumber: i.truck_number,
          action: i.action,
          ldapId: i.ldap_id,
          status: i.status,
          outcome: i.outcome,
          processedAt: i.processed_at,
        })),
        pendingCount:   items.filter(i => i.status === "pending").length,
        completedCount: items.filter(i => i.status === "completed").length,
        failedCount:    items.filter(i => i.status === "failed").length,
        skippedCount:   items.filter(i => i.status === "skipped").length,
        cancelledCount: items.filter(i => i.status === "cancelled").length,
        conflictCount:  items.filter(i => i.status === "conflict").length,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/fleet-ops/bulk-runs — list recent runs for current user
  app.get("/api/fleet-ops/bulk-runs", requireAuth, async (req: any, res) => {
    try {
      const username = req.user?.username || "";
      const runsResult = await db.execute(sql`
        SELECT run_id, status, started_by, started_at, cancelled_at, completed_at
        FROM bulk_fix_runs
        WHERE started_by = ${username}
        ORDER BY started_at DESC
        LIMIT 5
      `);
      type RunRow = { run_id: string; status: string; started_by: string; started_at: unknown; cancelled_at: unknown; completed_at: unknown };
      const runs = dbRows<RunRow>(runsResult);
      res.json({
        runs: runs.map(r => ({
          runId: r.run_id,
          status: r.status,
          startedBy: r.started_by,
          startedAt: r.started_at,
          cancelledAt: r.cancelled_at,
          completedAt: r.completed_at,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/fleet-ops/bulk-runs/:runId/cancel — fleet admin only
  app.post("/api/fleet-ops/bulk-runs/:runId/cancel", requireAuth, async (req: any, res) => {
    if (!requireFleetAdmin(req, res)) return;
    try {
      const { runId } = req.params;
      await db.execute(sql`
        UPDATE bulk_fix_runs SET cancelled_at = NOW()
        WHERE run_id = ${runId} AND cancelled_at IS NULL
      `);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/fleet-ops/bulk-reconcile — fleet admin only
  // Body: { runId?: string, vehicles?: [...] }
  // If runId provided → resume run (re-processes pending items from DB; vehicles array ignored)
  // If no runId → new run (vehicles array required)
  app.post("/api/fleet-ops/bulk-reconcile", requireAuth, async (req: any, res) => {
    if (!requireFleetAdmin(req, res)) return;
    try {
      const user = req.user;
      const { runId: existingRunId, vehicles, forceConflictTrucks } = req.body as {
        runId?: string;
        vehicles?: Array<{
          truckNumber: string;
          action: string;
          ldapId?: string;
          districtNo?: string;
        }>;
        forceConflictTrucks?: string[];
      };

      const username = user.username || "unknown";
      let runId: string;

      if (existingRunId) {
        // Resume existing run — load pending items from DB; no vehicles payload needed
        const runResult = await db.execute(sql`
          SELECT run_id, status, cancelled_at FROM bulk_fix_runs WHERE run_id = ${existingRunId}
        `);
        const runRows = dbRows<{ run_id: string; status: string; cancelled_at: unknown }>(runResult);
        if (runRows.length === 0) return res.status(404).json({ message: "Run not found" });
        if (runRows[0].status !== "running") return res.status(409).json({ message: "Run is not in running state" });
        runId = existingRunId;
      } else {
        // New run — vehicles array required
        if (!vehicles || !Array.isArray(vehicles) || vehicles.length === 0) {
          return res.status(400).json({ message: "vehicles array is required for new runs" });
        }

        const createResult = await db.execute(sql`
          INSERT INTO bulk_fix_runs (status, started_by)
          VALUES ('running', ${username})
          RETURNING run_id
        `);
        const createRows = dbRows<{ run_id: string }>(createResult);
        runId = createRows[0].run_id;

        for (const v of vehicles) {
          await db.execute(sql`
            INSERT INTO bulk_fix_run_items (run_id, truck_number, action, ldap_id, district_no, status)
            VALUES (${runId}, ${v.truckNumber}, ${v.action}, ${v.ldapId || null}, ${v.districtNo || null}, 'pending')
          `);
        }
      }

      // Return run ID immediately so UI can start polling
      res.json({ runId, status: "running" });

      // Execute in background (fire and forget)
      (async () => {
        const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
        const { fleetOpsService } = await import("./fleet-operations-service");

        let completedCount = 0;
        let failedCount = 0;

        // Always load from DB — handles both new runs and resumptions
        const itemsResult = await db.execute(sql`
          SELECT id, truck_number, action, ldap_id, district_no, status
          FROM bulk_fix_run_items WHERE run_id = ${runId}
          ORDER BY id
        `);
        type PendingItem = { id: string; truck_number: string; action: string; ldap_id: string | null; district_no: string | null; status: string };
        const allItems = dbRows<PendingItem>(itemsResult);
        const pendingItems = allItems.filter(i => i.status === "pending");

        for (let idx = 0; idx < pendingItems.length; idx++) {
          // Check cancellation flag in DB before each operation
          const cancelCheck = await db.execute(sql`
            SELECT cancelled_at FROM bulk_fix_runs WHERE run_id = ${runId}
          `);
          const cancelRows = dbRows<{ cancelled_at: unknown }>(cancelCheck);
          if (cancelRows[0]?.cancelled_at) {
            // Mark remaining pending as cancelled (not skipped — cancellation is user-initiated)
            await db.execute(sql`
              UPDATE bulk_fix_run_items SET status = 'cancelled', processed_at = NOW()
              WHERE run_id = ${runId} AND status = 'pending'
            `);
            break;
          }

          const item = pendingItems[idx];
          let outcome: any = {};
          let newStatus = "completed";

          try {
            if (item.action === "assign") {
              // Full cross-system assign
              const result = await fleetOpsService.assignTech({
                truckNumber: item.truck_number,
                ldapId: item.ldap_id || "",
                districtNo: item.district_no || "0",
                techName: item.ldap_id || "",
                requestedBy: `${username}:bulk-fix`,
                notes: `Bulk fix run ${runId}`,
              });
              if ("locked" in result) {
                outcome = { locked: true, message: result.message };
                newStatus = "failed";
              } else {
                outcome = { overallSuccess: result.overallSuccess, partialSuccess: result.partialSuccess, tpms: result.tpms, holman: result.holman, ams: result.ams };
                // Partial success means ≥1 system failed — mark as failed for accurate failure metrics and warning logic
                newStatus = result.overallSuccess ? "completed" : "failed";
              }
            } else if (item.action === "unassign") {
              // Full cross-system unassign
              const skipConflictCheck = (forceConflictTrucks ?? []).includes(item.truck_number);
              const result = await fleetOpsService.unassignTech({
                truckNumber: item.truck_number,
                ldapId: item.ldap_id || "",
                requestedBy: `${username}:bulk-fix`,
                notes: `Bulk fix run ${runId}`,
                skipConflictCheck,
              });
              if ("locked" in result) {
                outcome = { locked: true, message: result.message };
                newStatus = "failed";
              } else if ((result as any).tpms?.status === "conflict" || (result as any).status === "conflict") {
                // TPMS detected a different tech on a different truck — needs user confirmation
                const conflictInfo = (result as any).tpms ?? result;
                outcome = {
                  conflict: true,
                  message: conflictInfo.message,
                  conflictTech: conflictInfo.conflictTech,
                  conflictTruck: conflictInfo.conflictTruck,
                  holman: (result as any).holman,
                  ams: (result as any).ams,
                };
                newStatus = "conflict";
              } else {
                outcome = { overallSuccess: result.overallSuccess, partialSuccess: result.partialSuccess, tpms: result.tpms, holman: result.holman, ams: result.ams };
                // Partial success means ≥1 system failed — mark as failed for accurate failure metrics and warning logic
                newStatus = result.overallSuccess ? "completed" : "failed";
              }
            } else if (item.action === "push_holman" || item.action === "push_ams") {
              // Partial failure recovery: targeted push to only the lagging system
              const targetSystem = item.action === "push_holman" ? "holman" : "ams";
              const result = await fleetOpsService.reconcileSystem({
                truckNumber: item.truck_number,
                ldapId: item.ldap_id || "",
                districtNo: item.district_no || "0",
                targetSystem,
                requestedBy: `${username}:bulk-fix`,
                notes: `Partial-failure recovery (${item.action}) — run ${runId}`,
              });
              outcome = { action: item.action, targetSystem, ...result.outcome, message: result.message };
              // Holman accepted-and-queued submissions return status="pending" — treat as completed
              // (the submission is already tracked in holman_submissions for async verification)
              newStatus = (result.status === "success" || result.status === "pending") ? "completed"
                : result.status === "skipped" ? "skipped" : "failed";
            } else if (item.action === "push_multiple") {
              // Both Holman and AMS failed — push each in sequence.
              // The action name itself encodes which systems to target; no need to persist failed_systems.
              const targets: Array<"holman" | "ams"> = ["holman", "ams"];
              const results: any[] = [];
              let anyFailed = false;
              for (const targetSystem of targets) {
                const r = await fleetOpsService.reconcileSystem({
                  truckNumber: item.truck_number,
                  ldapId: item.ldap_id || "",
                  districtNo: item.district_no || "0",
                  targetSystem,
                  requestedBy: `${username}:bulk-fix`,
                  notes: `Partial-failure recovery (push_multiple/${targetSystem}) — run ${runId}`,
                });
                results.push({ system: targetSystem, status: r.status, message: r.message });
                // pending = Holman accepted-and-queued, treat as success (not failure)
                if (r.status !== "success" && r.status !== "pending" && r.status !== "skipped") anyFailed = true;
              }
              outcome = { action: "push_multiple", results };
              newStatus = anyFailed ? "failed" : "completed";
            } else {
              // cache_evict, wait, manual_review — non-bulk-fixable; mark skipped with reason
              newStatus = "skipped";
              outcome = { reason: `Action '${item.action}' requires manual intervention` };
            }
          } catch (err: any) {
            newStatus = "failed";
            outcome = { error: err.message };
          }

          await db.execute(sql`
            UPDATE bulk_fix_run_items
            SET status = ${newStatus}, outcome = ${JSON.stringify(outcome)}, processed_at = NOW()
            WHERE id = ${item.id}
          `);

          if (newStatus === "completed") completedCount++;
          if (newStatus === "failed") failedCount++;
          // "conflict" items are not counted as failures — they need user confirmation to proceed

          // Wait 2 seconds between operations
          if (idx < pendingItems.length - 1) {
            await sleep(2000);
          }
        }

        // Finalize run
        await db.execute(sql`
          UPDATE bulk_fix_runs
          SET status = CASE WHEN cancelled_at IS NOT NULL THEN 'cancelled' ELSE 'completed' END,
              completed_at = NOW()
          WHERE run_id = ${runId}
        `);

        // Invalidate mismatch cache so next poll returns fresh data
        mismatchCache = null;

        // Trigger incremental Holman fleet syncs at t+0, t+5min, t+15min so
        // verifyFromFleetData runs while Holman submissions are still pending.
        // Without this, Holman processes unassigns asynchronously (5-15 min)
        // and the verification timer (20 min) expires before the next scheduled
        // sync runs — causing the bulk-fixed trucks to reappear as mismatches.
        const triggerVerificationSync = async (delayMs: number) => {
          if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
          try {
            const { holmanVehicleSyncService: hvs } = await import('./holman-vehicle-sync-service');
            const label = delayMs === 0 ? 'immediate' : `${delayMs / 60000}min`;
            console.log(`[BulkFix] Post-run verification sync (${label}) triggered for run ${runId}`);
            await hvs.fetchChangedVehicles(false);
            console.log(`[BulkFix] Post-run verification sync (${label}) complete`);
          } catch (e: any) {
            console.warn(`[BulkFix] Post-run verification sync failed (non-fatal):`, e?.message);
          }
        };
        triggerVerificationSync(0);
        triggerVerificationSync(5 * 60 * 1000);
        triggerVerificationSync(15 * 60 * 1000);
      })().catch(err => {
        console.error(`[BulkFix] Run ${runId} fatal error:`, err);
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/operation-events", requireAuth, async (req: any, res) => {
    try {
      const { operationEvents: opEventsTable } = await import("@shared/schema");
      const filters: any = {};
      const conditions: any[] = [];
      if (req.query.fleetOpLogId) conditions.push(eq(opEventsTable.fleetOpLogId, Number(req.query.fleetOpLogId)));
      if (req.query.system) conditions.push(eq(opEventsTable.system, req.query.system as string));
      if (req.query.outcome) conditions.push(eq(opEventsTable.outcome, req.query.outcome as string));
      if (req.query.status) conditions.push(eq(opEventsTable.outcome, req.query.status as string));
      if (req.query.from) conditions.push(sql`${opEventsTable.createdAt} >= ${new Date(req.query.from as string)}`);
      if (req.query.to) conditions.push(sql`${opEventsTable.createdAt} <= ${new Date(req.query.to as string)}`);

      let query = db.select().from(opEventsTable);
      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as any;
      }
      const events = await (query as any).orderBy(sql`created_at DESC`).limit(100);
      res.json(events);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/operation-events/:id/retry", requireAuth, async (req: any, res) => {
    try {
      const currentUser = req.user;
      if (!currentUser || (currentUser.role !== 'developer' && currentUser.role !== 'admin')) {
        return res.status(403).json({ message: "Insufficient permissions to retry operations" });
      }
      const { operationEvents: opEventsTable } = await import("@shared/schema");
      const eventId = Number(req.params.id);
      const [event] = await db.select().from(opEventsTable).where(eq(opEventsTable.id, eventId)).limit(1);
      if (!event) return res.status(404).json({ message: "Event not found" });
      if (event.outcome === "success") return res.status(400).json({ message: "Event already succeeded" });

      await db.update(opEventsTable)
        .set({ outcome: "failed", nextRetryAt: new Date(), attemptCount: Math.max(0, event.attemptCount - 1), updatedAt: new Date() })
        .where(eq(opEventsTable.id, eventId));

      const { retryFailedOperationEvents } = await import("./fleet-operations-service");
      const result = await retryFailedOperationEvents();
      res.json({ message: "Retry triggered", result });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/fleet-vehicles/resync-assignments", requireAuth, async (req: any, res) => {
    try {
      const { vehicleNumber, enterpriseId } = req.body;
      if (!vehicleNumber) {
        return res.status(400).json({ success: false, message: 'vehicleNumber required' });
      }

      const results: { tpms?: any; holman?: string } = {};

      // Re-check TPMS for the enterprise ID (Holman tech assignment)
      if (enterpriseId) {
        const eid = String(enterpriseId).trim().toUpperCase();
        try {
          const { getTPMSService } = await import("./tpms-service");
          const tpmsService = getTPMSService();
          const techInfo = await tpmsService.getTechInfo(eid);
          await storage.upsertTpmsCachedAssignment({
            lookupKey:     eid,
            lookupType:    'enterprise_id',
            truckNo:       techInfo.truckNo?.trim() || null,
            enterpriseId:  eid,
            techId:        techInfo.techId    || null,
            firstName:     techInfo.firstName  || null,
            lastName:      techInfo.lastName   || null,
            districtNo:    techInfo.districtNo || null,
            contactNo:     techInfo.contactNo  || null,
            email:         techInfo.email      || null,
            rawResponse:   JSON.stringify({ ...techInfo, source: 'resync_button' }),
            status:        'live',
            lastSuccessAt: new Date(),
            lastAttemptAt: new Date(),
            failureCount:  0,
          });
          results.tpms = { truckNo: techInfo.truckNo?.trim() || null, techId: techInfo.techId || null };
        } catch (err: any) {
          results.tpms = { error: err.message };
        }
      } else {
        results.tpms = { skipped: 'no enterpriseId provided' };
      }

      // Holman: report live (fleet data is already sourced live from Holman API on each refresh cycle)
      results.holman = 'live';

      res.json({ success: true, vehicleNumber, ...results });
    } catch (error: any) {
      console.error("Error resyncing vehicle assignments:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  app.get("/api/fleet-vehicles/po-flags", requireAuth, async (req: any, res) => {
    type FlagMap = Record<string, { hasOpenRental: boolean; openRentalCount: number; hasOpenMaintenance: boolean; openMaintenanceCount: number }>;

    const buildFlags = (rawRows: Record<string, any>[]) => {
      const flags: FlagMap = {};
      for (const row of rawRows) {
        // Snowflake returns column names uppercase; normalize to handle both cases
        const vn = String(row.VEHICLE_NUMBER || row.vehicle_number || "").trim();
        if (!vn) continue;
        if (!flags[vn]) flags[vn] = { hasOpenRental: false, openRentalCount: 0, hasOpenMaintenance: false, openMaintenanceCount: 0 };
        const cnt = Number(row.CNT ?? row.cnt ?? 0);
        const dtype = String(row.DERIVED_TYPE || row.derived_type || "").toLowerCase();
        if (dtype === 'rental') { flags[vn].hasOpenRental = true; flags[vn].openRentalCount = cnt; }
        if (dtype === 'maintenance') { flags[vn].hasOpenMaintenance = true; flags[vn].openMaintenanceCount = cnt; }
      }
      return flags;
    };

    // Try Snowflake first (source of truth for open POs)
    const { getSnowflakeService, isSnowflakeConfigured } = await import("./snowflake-service");
    if (isSnowflakeConfigured()) {
      try {
        const sf = getSnowflakeService();
        await sf.connect();
        const sfRows = await sf.executeQuery(
          `SELECT
             HOLMAN_VEHICLE_NUMBER AS vehicle_number,
             CASE WHEN UPPER(REPAIR_TYPE_DESCRIPTION) LIKE '%RENTAL%'
                    OR UPPER(ATA_GROUP_DESC) LIKE '%RENTAL%'
                    OR UPPER(DESCRIPTION) LIKE '%RENTAL%'
               THEN 'rental' ELSE 'maintenance' END AS derived_type,
             COUNT(DISTINCT PO_NUMBER) AS cnt
           FROM ${HOLMAN_PO_ETL_TABLE}
           WHERE UPPER(PO_STATUS) IN ('APPROVED', 'HOLD', 'BILL HOLD', 'OPEN')
             AND HOLMAN_VEHICLE_NUMBER IS NOT NULL
           GROUP BY HOLMAN_VEHICLE_NUMBER, derived_type`
        ) as Array<{ vehicle_number: string; derived_type: string; cnt: string | number }>;
        return res.json(buildFlags(sfRows));
      } catch (sfErr: any) {
        console.warn("[PO Flags] Snowflake query failed, falling back to local cache:", sfErr.message);
      }
    }

    // Fallback: local cache
    try {
      // "Open" statuses in Holman are APPROVED, HOLD, BILL HOLD (not literally 'OPEN')
      // Rental POs are identified by description containing 'RENTAL'
      const rows = await db.execute(sql`
        SELECT
          vehicle_number,
          CASE WHEN UPPER(description) LIKE '%RENTAL%' THEN 'rental' ELSE 'maintenance' END AS derived_type,
          COUNT(*) AS cnt
        FROM holman_po_cache
        WHERE UPPER(po_status) IN ('APPROVED', 'HOLD', 'BILL HOLD', 'OPEN')
        GROUP BY vehicle_number, derived_type
      `);
      res.json(buildFlags(rows.rows as Array<{ vehicle_number: string; derived_type: string; cnt: string | number }>));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Repair-shop flags — trucks currently in a repair shop (have a repair address in AMS/fleet-scope)
  app.get("/api/fleet-vehicles/repair-shop-flags", requireAuth, async (_req, res) => {
    try {
      const { trucks: fsTrucks } = await import("../shared/fleet-scope-schema");
      const rows = await db.select({
        truckNumber: fsTrucks.truckNumber,
        repairAddress: fsTrucks.repairAddress,
      }).from(fsTrucks);
      const flags: Record<string, boolean> = {};
      for (const row of rows) {
        if (row.truckNumber) {
          flags[row.truckNumber] = !!(row.repairAddress && row.repairAddress.trim());
        }
      }
      res.json(flags);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Offboarding flags — trucks flagged during weekly offboarding roster match
  app.get("/api/fleet-vehicles/offboarding-flags", requireAuth, async (_req, res) => {
    try {
      const { trucks: fsTrucks } = await import("../shared/fleet-scope-schema");
      const rows = await db.select({
        truckNumber: fsTrucks.truckNumber,
        offboardingFlagged: fsTrucks.offboardingFlagged,
      }).from(fsTrucks);
      const flags: Record<string, boolean> = {};
      for (const row of rows) {
        if (row.truckNumber) {
          flags[row.truckNumber] = !!row.offboardingFlagged;
        }
      }
      res.json(flags);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/fleet-vehicles/export.csv", requireAuth, async (req: any, res) => {
    try {
      // DISTINCT ON ensures one row per vehicle even if TPMS has multiple records (keyed by enterprise_id AND truck_number)
      const vehicleRows = await db.execute(sql`
        SELECT DISTINCT ON (hvc.holman_vehicle_number)
          hvc.holman_vehicle_number AS "vehicleNumber",
          hvc.vin AS "vin",
          hvc.model_year AS "year",
          hvc.make_name AS "make",
          hvc.model_name AS "model",
          hvc.color AS "color",
          hvc.division AS "division",
          hvc.district AS "district",
          hvc.region AS "region",
          hvc.state AS "state",
          hvc.city AS "city",
          hvc.license_plate AS "licensePlate",
          hvc.license_state AS "licenseState",
          hvc.holman_tech_assigned AS "holmanTechEnterpriseId",
          hvc.holman_tech_name AS "holmanTechName",
          hvc.odometer AS "holmanOdometer",
          hvc.odometer_date AS "holmanOdometerDate",
          t.enterprise_id AS "tpmsEnterpriseId",
          t.tech_id AS "tpmsTechId",
          TRIM(t.first_name) AS "tpmsFirstName",
          TRIM(t.last_name) AS "tpmsLastName",
          t.district_no AS "tpmsDistrict",
          t.contact_no AS "tpmsContact",
          t.email AS "tpmsEmail"
        FROM holman_vehicles_cache hvc
        LEFT JOIN tpms_cached_assignments t
          ON LTRIM(t.truck_no, '0') = LTRIM(hvc.holman_vehicle_number, '0')
        WHERE hvc.out_of_service_date IS NULL
        ORDER BY hvc.holman_vehicle_number, t.last_success_at DESC NULLS LAST
      `);

      const vehicles = vehicleRows.rows as any[];
      console.log(`[Fleet CSV] Queried ${vehicles.length} active vehicles from Holman cache`);

      // ─── Enrich with generalStatus, subStatus, AMS status, location, Samsara ─
      const enrichMap = new Map<string, any>();
      let rentalVehicleSet = new Set<string>();
      try {
        const port = parseInt(process.env.PORT || "5000");
        const cookie = req.headers.cookie || "";
        const [avRes, rentalRes] = await Promise.all([
          fetch(`http://localhost:${port}/api/fs/all-vehicles`, { headers: { cookie } }).catch(() => null),
          fetch(`http://localhost:${port}/api/rental-ops/open-vehicle-numbers`, { headers: { cookie } }).catch(() => null),
        ]);
        if (avRes?.ok) {
          const avData = await avRes.json();
          for (const v of avData.vehicles || []) {
            enrichMap.set(toCanonical(v.vehicleNumber), v);
          }
        }
        if (rentalRes?.ok) {
          const rentalData = await rentalRes.json();
          for (const vn of rentalData.vehicleNumbers || []) {
            rentalVehicleSet.add(toCanonical(vn));
          }
        }
        console.log(`[Fleet CSV] Enrichment: ${enrichMap.size} vehicles enriched, ${rentalVehicleSet.size} on rental`);
      } catch (enrichErr: any) {
        console.warn("[Fleet CSV] Enrichment fetch failed (continuing without):", enrichErr?.message);
      }

      // ─── AMS truck status map — fallback for vehicles missing truckStatus ────
      let amsCsvStatusMap: Record<string, string | null> = {};
      try {
        const { getAmsTruckStatusMap } = await import("./ams-truck-status-cache");
        amsCsvStatusMap = await getAmsTruckStatusMap();
        console.log(`[Fleet CSV] AMS truck status map: ${Object.keys(amsCsvStatusMap).length} VINs loaded`);
      } catch (amsErr: any) {
        console.warn("[Fleet CSV] AMS truck status map load failed (continuing):", amsErr?.message);
      }

      // ─── Odometer candidate type ────────────────────────────────────────────
      interface OdoCandidate { miles: number; date: string; source: string; }

      // Keyed by normalized truck number (stripped leading zeros) or VIN (uppercased)
      const odoByTruck = new Map<string, OdoCandidate[]>(); // key = stripped truck number
      const odoByVin   = new Map<string, OdoCandidate[]>(); // key = VIN uppercase

      const addByTruck = (truck: string, c: OdoCandidate) => {
        const k = toCanonical(truck);
        if (!odoByTruck.has(k)) odoByTruck.set(k, []);
        odoByTruck.get(k)!.push(c);
      };
      const addByVin = (vin: string, c: OdoCandidate) => {
        const k = vin.toUpperCase().trim();
        if (!odoByVin.has(k)) odoByVin.set(k, []);
        odoByVin.get(k)!.push(c);
      };

      // ─── Source 1: Holman cache (already in PostgreSQL row) ─────────────────
      // Pulled inline below per vehicle — no extra query needed.

      // ─── Sources 2-4: Snowflake ──────────────────────────────────────────────
      try {
        const samsaraService = getSamsaraService();
        if (samsaraService.isSnowflakeAvailable()) {
          const { getSnowflakeService } = await import("./snowflake-service");
          const snowflake = getSnowflakeService();
          await snowflake.connect();

          // Source 2: Samsara ODOMETER — latest OBD/GPS reading per VIN
          try {
            const samsaraRows = await snowflake.executeQuery(`
              SELECT
                VIN,
                COALESCE(OBD_MILES, GPS_MILES)  AS ODOMETER_MILES,
                COALESCE(OBD_TIME,  GPS_TIME)   AS ODOMETER_DATE
              FROM bi_analytics.app_samsara.SAMSARA_ODOMETER
              WHERE VIN IS NOT NULL
              QUALIFY ROW_NUMBER() OVER (
                PARTITION BY VIN
                ORDER BY COALESCE(OBD_TIME, GPS_TIME) DESC NULLS LAST
              ) = 1
            `, []) as Array<{ VIN: string; ODOMETER_MILES: number | null; ODOMETER_DATE: string | null }>;
            for (const r of samsaraRows) {
              if (r.VIN && r.ODOMETER_MILES != null && r.ODOMETER_DATE) {
                addByVin(r.VIN, { miles: r.ODOMETER_MILES, date: String(r.ODOMETER_DATE), source: "Samsara" });  
              }
            }
            console.log(`[Fleet CSV] Samsara: ${samsaraRows.length} odometer rows loaded`);
          } catch (e: any) { console.warn("[Fleet CSV] Samsara odometer error:", e?.message); }

          // Source 3: Fuel card — tech-entered odometer at fueling (last 365 days, non-zero)
          try {
            const fuelRows = await snowflake.executeQuery(`
              SELECT LPAD(TRUCK_NUMBER, 6, '0') AS TRUCK_NO, ODOMETER, DATE AS ODO_DATE
              FROM PRD_EBDB.TECHNICIANS.CREDIT_CARD_EXPENSE_TRACKING
              WHERE DATE >= CURRENT_DATE() - 365
                AND ODOMETER > 0
                AND TRUCK_NUMBER NOT IN ('000000', 'Rental')
                AND TRUCK_NUMBER IS NOT NULL
              QUALIFY ROW_NUMBER() OVER (
                PARTITION BY LPAD(TRUCK_NUMBER, 6, '0')
                ORDER BY DATE DESC
              ) = 1
            `, []) as Array<{ TRUCK_NO: string; ODOMETER: number | null; ODO_DATE: string | null }>;
            for (const r of fuelRows) {
              if (r.TRUCK_NO && r.ODOMETER != null && r.ODO_DATE) {
                addByTruck(r.TRUCK_NO, { miles: r.ODOMETER, date: String(r.ODO_DATE), source: "Fuel Card" });  
              }
            }
            console.log(`[Fleet CSV] Fuel card: ${fuelRows.length} odometer rows loaded`);
          } catch (e: any) { console.warn("[Fleet CSV] Fuel card odometer error:", e?.message); }

          // Source 4: Holman repair PO — odometer at last repair
          try {
            const repairRows = await snowflake.executeQuery(`
              SELECT HOLMAN_VEHICLE_NUMBER, ODOMETER, PO_DATE
              FROM PARTS_SUPPLYCHAIN.FLEET.HOLMAN_ETL_PO_DETAILS
              WHERE ODOMETER > 0
                AND HOLMAN_VEHICLE_NUMBER IS NOT NULL
              QUALIFY ROW_NUMBER() OVER (
                PARTITION BY HOLMAN_VEHICLE_NUMBER
                ORDER BY PO_DATE DESC
              ) = 1
            `, []) as Array<{ HOLMAN_VEHICLE_NUMBER: string; ODOMETER: number | null; PO_DATE: string | null }>;
            for (const r of repairRows) {
              if (r.HOLMAN_VEHICLE_NUMBER && r.ODOMETER != null && r.PO_DATE) {
                addByTruck(r.HOLMAN_VEHICLE_NUMBER, { miles: r.ODOMETER, date: String(r.PO_DATE), source: "Holman PO" });
              }
            }
            console.log(`[Fleet CSV] Holman repair: ${repairRows.length} odometer rows loaded`);
          } catch (e: any) { console.warn("[Fleet CSV] Holman repair odometer error:", e?.message); }

        } else {
          console.warn("[Fleet CSV] Snowflake not configured — skipping Samsara, fuel card, repair sources");
        }
      } catch (snowflakeErr: any) {
        console.warn("[Fleet CSV] Snowflake connection error:", snowflakeErr?.message);
      }

      // ─── Normalization: pick best odometer reading per vehicle ───────────────
      const ODOMETER_MIN = 1_000;
      const ODOMETER_MAX = 600_000;

      const selectBestOdometer = (candidates: OdoCandidate[]): (OdoCandidate & { excluded?: string[] }) | null => {
        // Step 1: absolute range filter
        const inRange = candidates.filter(c => c.miles >= ODOMETER_MIN && c.miles <= ODOMETER_MAX);
        if (inRange.length === 0) return null;

        // Step 2: outlier detection — discard any reading < 30% of max in range
        // Catches dropped-zero typos (e.g., 8500 instead of 85000)
        const maxMiles = Math.max(...inRange.map(c => c.miles));
        const threshold = maxMiles * 0.30;
        const clean = inRange.filter(c => c.miles >= threshold);
        const excluded = inRange.filter(c => c.miles < threshold).map(c => `${c.source}(${c.miles})`);

        const pool = clean.length > 0 ? clean : inRange; // fallback if all filtered

        // Step 3: pick reading with the latest date
        pool.sort((a, b) => {
          const da = a.date ? new Date(a.date).getTime() : 0;
          const db = b.date ? new Date(b.date).getTime() : 0;
          return db - da;
        });
        return { ...pool[0], excluded };
      };

      const escapeCell = (v: any): string => {
        if (v === null || v === undefined) return "";
        const s = String(v);
        if (s.includes(",") || s.includes('"') || s.includes("\n")) {
          return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
      };

      // Normalize any date string to MM/DD/YYYY regardless of source format.
      // Handles ISO 8601 (2025-03-10T14:30:00.000Z), Snowflake timestamps, plain YYYY-MM-DD, etc.
      const formatDate = (raw: string | null | undefined): string => {
        if (!raw) return "";
        const d = new Date(raw);
        if (isNaN(d.getTime())) return raw; // return as-is if unparseable
        const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
        const dd = String(d.getUTCDate()).padStart(2, "0");
        const yyyy = d.getUTCFullYear();
        return `${mm}/${dd}/${yyyy}`;
      };

      // ─── BYOV lookup map ─────────────────────────────────────────────────────
      // Map from canonical (stripped leading zeros) vehicle number -> submittedBy
      const byovMap = new Map<string, string>();
      try {
        const byovRows = await db
          .select({
            vehicleNumber: byovCreationAudit.vehicleNumber,
            submittedBy: byovCreationAudit.submittedBy,
          })
          .from(byovCreationAudit)
          .orderBy(asc(byovCreationAudit.submittedAt));
        for (const row of byovRows) {
          if (row.vehicleNumber) {
            byovMap.set(toCanonical(row.vehicleNumber), row.submittedBy || "Yes");
          }
        }
        console.log(`[Fleet CSV] BYOV: ${byovMap.size} entries loaded`);
      } catch (byovErr: any) {
        console.warn("[Fleet CSV] BYOV lookup failed (continuing without):", byovErr?.message);
      }

      const headers = [
        "Vehicle Number", "VIN", "Year", "Make", "Model", "Color",
        "Division", "District", "Region", "State", "City",
        "License Plate", "License State",
        // Status & operational columns
        "TPMS Status",
        "Rental",
        "BYOV",
        "AMS Status",
        "General Status",
        "Sub Status",
        "Last Known Location",
        "Location Source",
        "Location Updated At",
        "Last Samsara Signal",
        "Samsara Status",
        // Tech assignment
        "Holman Tech Enterprise ID", "Holman Tech Name",
        "TPMS Enterprise ID", "TPMS Tech ID", "TPMS First Name", "TPMS Last Name",
        "TPMS District", "TPMS Contact", "TPMS Email",
        // Odometer
        "Odometer (Miles)", "Odometer Date", "Odometer Source", "Odometer Notes",
        // Lifetime maintenance + Managed by (Holman active fleet tag)
        "Lifetime Maintenance",
        "Managed by",
        "Holman Status",
      ];

      const csvLines = [
        headers.join(","),
        ...vehicles.map((v: any) => {
          // Collect candidates for this vehicle from all sources
          const truckKey = toCanonical(v.vehicleNumber);
          const vinKey   = v.vin ? String(v.vin).toUpperCase().trim() : null;

          const candidates: OdoCandidate[] = [];

          // Source 1: Holman cache
          if (v.holmanOdometer && v.holmanOdometerDate) {
            candidates.push({ miles: Number(v.holmanOdometer), date: String(v.holmanOdometerDate), source: "Holman Vehicle Info" });
          }
          // Source 2: Samsara (by VIN)
          if (vinKey && odoByVin.has(vinKey)) candidates.push(...odoByVin.get(vinKey)!);
          // Sources 3+4: Fuel card & Holman repair (by truck number)
          if (odoByTruck.has(truckKey)) candidates.push(...odoByTruck.get(truckKey)!);

          const best = selectBestOdometer(candidates);
          const notes = best?.excluded?.length ? `Excluded outliers: ${best.excluded.join(", ")}` : "";

          // Enrichment data from all-vehicles cache
          const enriched = enrichMap.get(truckKey);
          const tpmsStatus = v.tpmsEnterpriseId ? "Assigned" : "Unassigned";
          const isRental = rentalVehicleSet.has(truckKey) ? "Yes" : "No";

          const byovValue = byovMap.get(truckKey) ?? "";

          return [
            v.vehicleNumber, v.vin, v.year, v.make, v.model, v.color,
            v.division, v.district, v.region, v.state, v.city,
            v.licensePlate, v.licenseState,
            // Status & operational
            tpmsStatus,
            isRental,
            byovValue,
            (() => {
              if (enriched?.truckStatus) return enriched.truckStatus;
              // Skip AMS lookup for 88-prefix BYOV vehicles (not registered in AMS)
              if (vinKey && !toCanonical(v.vehicleNumber ?? "").startsWith("88")) {
                return amsCsvStatusMap[vinKey] ?? "";
              }
              return "";
            })(),
            enriched?.generalStatus ?? "",
            enriched?.subStatus ?? "",
            enriched?.lastKnownLocation ?? "",
            enriched?.locationSource ?? "",
            enriched?.locationUpdatedAt ? formatDate(enriched.locationUpdatedAt) : "",
            enriched?.lastSamsaraSignal ? formatDate(enriched.lastSamsaraSignal) : "",
            enriched?.samsaraStatus ?? "",
            // Tech assignment
            v.holmanTechEnterpriseId, v.holmanTechName,
            v.tpmsEnterpriseId, v.tpmsTechId, v.tpmsFirstName, v.tpmsLastName,
            v.tpmsDistrict, v.tpmsContact, v.tpmsEmail,
            // Odometer
            best?.miles != null ? Math.round(best.miles * 10) / 10 : "", formatDate(best?.date), best?.source ?? "", notes,
            // Lifetime maintenance + Managed by — pulled from /api/fs/all-vehicles enrichment
            enriched?.lifetimeMaintenance ?? "",
            enriched?.managedBy ?? "",
            enriched?.holmanStatus ?? "",
          ].map(escapeCell).join(",");
        }),
      ];

      const timestamp = new Date().toISOString().split("T")[0];
      const filename = `fleet_vehicles_${timestamp}.csv`;

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(csvLines.join("\n"));
    } catch (error: any) {
      console.error("[Fleet CSV] Export failed:", error);
      res.status(500).json({ message: "Failed to generate fleet vehicles CSV" });
    }
  });

  // ===== Unified Offboarding Queue API =====
  function classifyOffboardingQueue(step: string, department: string): string {
    if (step === 'phone_recover_device_day0') return 'phone';
    if (step === 'ntao_stop_replenishment_day0' || (department || '').toUpperCase() === 'NTAO') return 'ntao';
    if (step === 'tools_recover_equipment_day0' || ['ASSETS MANAGEMENT', 'ASSETS'].includes((department || '').toUpperCase())) return 'assets';
    if (step === 'fleet_initial_coordination_day0' || (department || '').toUpperCase() === 'FLEET') return 'fleet';
    if (step === 'inventory_remove_tpms_day0' || ['INVENTORY CONTROL', 'INVENTORY'].includes((department || '').toUpperCase())) return 'inventory';
    return 'unknown';
  }

  async function hasOffboardingAccess(user: any): Promise<boolean> {
    if (user.role === 'developer' || user.role === 'admin') return true;
    const hasAnyQueue = ['ntao', 'assets', 'fleet', 'inventory'].some(m => hasQueueAccess(user, m as any));
    if (!hasAnyQueue) return false;
    try {
      const rolePerms = await storage.getRolePermission(user.role);
      if (rolePerms && rolePerms.permissions) {
        const perms = rolePerms.permissions as any;
        if (perms?.sidebar?.queues?.offboardingQueue === false) return false;
      }
    } catch {}
    return true;
  }

  app.get('/api/unified-offboarding/techs', requireAuth, async (req: any, res) => {
    try {
      if (!await hasOffboardingAccess(req.user)) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const allOffboardingItems = await db.select()
        .from(queueItems)
        .where(and(
          eq(queueItems.workflowType, 'offboarding'),
          isNotNull(queueItems.workflowId)
        ));

      const workflowMap = new Map<string, typeof allOffboardingItems>();
      for (const item of allOffboardingItems) {
        if (!item.workflowId) continue;
        const list = workflowMap.get(item.workflowId) || [];
        list.push(item);
        workflowMap.set(item.workflowId, list);
      }

      const enterpriseIdsSeen = new Set<string>();
      const techs: any[] = [];

      for (const [workflowId, items] of workflowMap) {
        const firstItem = items[0];
        let parsedData: any = {};
        try {
          parsedData = typeof firstItem.data === 'string' ? JSON.parse(firstItem.data) : (firstItem.data || {});
        } catch {}

        const tech = parsedData?.technician || {};
        const vehicle = parsedData?.vehicle || {};
        const enterpriseId = tech.enterpriseId || tech.techRacfid || parsedData?.employee?.enterpriseId || '';
        const employeeId = tech.employeeId || parsedData?.employee?.employeeId || '';

        if (enterpriseId) enterpriseIdsSeen.add(enterpriseId.toUpperCase());

        const separationDate = tech.lastDayWorked || tech.effectiveDate || null;
        let daysOpen = 0;
        if (separationDate) {
          const sep = new Date(separationDate);
          daysOpen = Math.floor((Date.now() - sep.getTime()) / (1000 * 60 * 60 * 24));
        }

        const isByov = items.some(i => i.isByov);
        const isTlt = items.some(i => (i as any).isTlt);

        const queueStatuses: Record<string, { status: string; id: string | null }> = {
          ntao: { status: 'missing', id: null },
          assets: { status: 'missing', id: null },
          fleet: { status: 'missing', id: null },
          inventory: { status: 'missing', id: null },
          phone: { status: 'missing', id: null },
        };

        for (const item of items) {
          let itemData: any = {};
          try {
            itemData = typeof item.data === 'string' ? JSON.parse(item.data) : (item.data || {});
          } catch {}
          const qKey = classifyOffboardingQueue(itemData?.step || '', item.department || '');
          if (qKey in queueStatuses) {
            queueStatuses[qKey] = { status: item.status, id: item.id };
          }
        }

        const hasEscalation = items.some(i => i.priority === 'critical') ||
          (items.some(i => i.status === 'pending') && daysOpen > 7);

        const hasRental = items.some(i => {
          try {
            const d = typeof i.data === 'string' ? JSON.parse(i.data) : (i.data || {});
            return d?.vehicle?.hasRental === true || d?.vehicle?.rentalStatus === 'active';
          } catch { return false; }
        });

        techs.push({
          workflowId,
          techName: tech.techName || parsedData?.employee?.name || 'Unknown',
          enterpriseId,
          employeeId,
          separationDate,
          daysOpen,
          truckNumber: vehicle.vehicleNumber || vehicle.truckNo || '',
          isByov,
          isTlt,
          hasRental,
          hasEscalation,
          queueStatuses,
        });
      }

      const allTermed = await db.select().from(termedTechs).where(isNotNull(termedTechs.employeeId));
      for (const tt of allTermed) {
        if (!tt.employeeId) continue;
        const eid = (tt.techRacfid || '').toUpperCase();
        if (eid && enterpriseIdsSeen.has(eid)) continue;
        const workflowId = `termed-${tt.employeeId}`;
        const separationDate = tt.lastDayWorked?.toString() || tt.effectiveDate?.toString() || null;
        let daysOpen = 0;
        if (separationDate) {
          const sep = new Date(separationDate);
          daysOpen = Math.floor((Date.now() - sep.getTime()) / (1000 * 60 * 60 * 24));
        }
        techs.push({
          workflowId,
          techName: tt.techName || 'Unknown',
          enterpriseId: tt.techRacfid || '',
          employeeId: tt.employeeId || '',
          separationDate,
          daysOpen,
          truckNumber: '',
          isByov: false,
          isTlt: tt.jobTitle?.trim() === 'Team Lead Technician',
          hasRental: false,
          hasEscalation: daysOpen > 7,
          queueStatuses: {
            ntao: { status: 'missing', id: null },
            assets: { status: 'missing', id: null },
            fleet: { status: 'missing', id: null },
            inventory: { status: 'missing', id: null },
            phone: { status: 'missing', id: null },
          },
        });
        if (eid) enterpriseIdsSeen.add(eid);
      }

      techs.sort((a, b) => {
        if (!a.separationDate && !b.separationDate) return 0;
        if (!a.separationDate) return 1;
        if (!b.separationDate) return -1;
        return new Date(b.separationDate).getTime() - new Date(a.separationDate).getTime();
      });

      const queueKeys = ['ntao', 'assets', 'fleet', 'inventory', 'phone'];
      const queueBreakdown: Record<string, { pending: number; in_progress: number; completed: number; missing: number }> = {};
      for (const qk of queueKeys) {
        queueBreakdown[qk] = { pending: 0, in_progress: 0, completed: 0, missing: 0 };
        for (const t of techs) {
          const s = t.queueStatuses[qk]?.status || 'missing';
          if (s === 'pending') queueBreakdown[qk].pending++;
          else if (s === 'in_progress') queueBreakdown[qk].in_progress++;
          else if (s === 'completed') queueBreakdown[qk].completed++;
          else queueBreakdown[qk].missing++;
        }
      }

      const escalated = techs.filter(t => t.hasEscalation).length;
      const avgDaysOpen = techs.length > 0
        ? Math.round(techs.reduce((sum, t) => sum + (t.daysOpen || 0), 0) / techs.length)
        : 0;
      const completedTechs = techs.filter(t =>
        Object.values(t.queueStatuses).every((qs: any) => qs.status === 'completed')
      ).length;
      const completionPct = techs.length > 0 ? Math.round((completedTechs / techs.length) * 100) : 0;

      return res.json({
        techs,
        summary: {
          totalTechs: techs.length,
          escalated,
          avgDaysOpen,
          completionPct,
          queueBreakdown,
        },
      });
    } catch (err: any) {
      console.error('[UnifiedOffboarding] GET /techs error:', err.message);
      return res.status(500).json({ message: 'Failed to fetch offboarding techs' });
    }
  });

  app.get('/api/unified-offboarding/tech/:workflowId', requireAuth, async (req: any, res) => {
    try {
      if (!await hasOffboardingAccess(req.user)) {
        return res.status(403).json({ message: 'Access denied' });
      }
      const { workflowId } = req.params;

      const items = await db.select()
        .from(queueItems)
        .where(and(
          eq(queueItems.workflowId, workflowId),
          eq(queueItems.workflowType, 'offboarding')
        ));

      if (items.length === 0 && workflowId.startsWith('termed-')) {
        const employeeId = workflowId.replace('termed-', '');
        const termedRow = await storage.getTermedTechByEmployeeId(employeeId);
        if (!termedRow) {
          return res.status(404).json({ message: 'Tech not found' });
        }
        return res.json({
          workflowId,
          techName: termedRow.techName,
          enterpriseId: termedRow.techRacfid,
          employeeId: termedRow.employeeId,
          separationDate: termedRow.lastDayWorked?.toString() || null,
          tasks: {},
        });
      }

      if (items.length === 0) {
        return res.status(404).json({ message: 'Workflow not found' });
      }

      const firstItem = items[0];
      let parsedData: any = {};
      try {
        parsedData = typeof firstItem.data === 'string' ? JSON.parse(firstItem.data) : (firstItem.data || {});
      } catch {}

      const tech = parsedData?.technician || {};
      const vehicle = parsedData?.vehicle || {};

      const tasks: Record<string, any> = {};
      for (const item of items) {
        let itemData: any = {};
        try {
          itemData = typeof item.data === 'string' ? JSON.parse(item.data) : (item.data || {});
        } catch {}
        const qKey = classifyOffboardingQueue(itemData?.step || '', item.department || '');
        tasks[qKey] = {
          id: item.id,
          status: item.status,
          priority: item.priority,
          assignedTo: item.assignedTo,
          department: item.department,
          notes: item.notes,
          workflowStep: item.workflowStep,
          createdAt: item.createdAt,
          startedAt: item.startedAt,
          completedAt: item.completedAt,
          isByov: item.isByov,
          isTlt: (item as any).isTlt,
          vehicleType: item.vehicleType,
          fleetRoutingDecision: item.fleetRoutingDecision,
          routingReceivedAt: item.routingReceivedAt,
          blockedActions: item.blockedActions,
          taskToolsReturn: item.taskToolsReturn,
          taskIphoneReturn: item.taskIphoneReturn,
          taskDisconnectedLine: item.taskDisconnectedLine,
          taskDisconnectedMPayment: item.taskDisconnectedMPayment,
          taskCloseSegnoOrders: item.taskCloseSegnoOrders,
          taskCreateShippingLabel: item.taskCreateShippingLabel,
          phoneNumber: item.phoneNumber,
          phoneContactHistory: item.phoneContactHistory,
          phoneContactMethod: item.phoneContactMethod,
          phoneShippingLabelSent: item.phoneShippingLabelSent,
          phoneTrackingNumber: item.phoneTrackingNumber,
          phoneDateReceived: item.phoneDateReceived,
          phonePhysicalCondition: item.phonePhysicalCondition,
          phoneConditionNotes: item.phoneConditionNotes,
          phoneDataWipeCompleted: item.phoneDataWipeCompleted,
          phoneWipeMethod: item.phoneWipeMethod,
          phoneReprovisionCompleted: item.phoneReprovisionCompleted,
          phoneWrittenOff: item.phoneWrittenOff,
          phoneServiceReinstated: item.phoneServiceReinstated,
          phoneRecoveryStage: item.phoneRecoveryStage,
          carrier: item.carrier,
          data: itemData,
        };
      }

      return res.json({
        workflowId,
        techName: tech.techName || parsedData?.employee?.name || 'Unknown',
        enterpriseId: tech.enterpriseId || tech.techRacfid || '',
        employeeId: tech.employeeId || '',
        separationDate: tech.lastDayWorked || tech.effectiveDate || null,
        truckNumber: vehicle.vehicleNumber || vehicle.truckNo || '',
        fleetPickupAddress: vehicle.fleetPickupAddress || null,
        contactNumber: tech.contactNumber || null,
        personalEmail: tech.personalEmail || null,
        district: tech.district || null,
        planningArea: tech.planningArea || null,
        jobTitle: tech.jobTitle || null,
        separationCategory: tech.separationCategory || null,
        tasks,
      });
    } catch (err: any) {
      console.error('[UnifiedOffboarding] GET /tech/:workflowId error:', err.message);
      return res.status(500).json({ message: 'Failed to fetch tech detail' });
    }
  });

  app.patch('/api/unified-offboarding/task/:taskId', requireAuth, async (req: any, res) => {
    try {
      if (!await hasOffboardingAccess(req.user)) {
        return res.status(403).json({ message: 'Access denied' });
      }
      const { taskId } = req.params;
      const existingTask = await storage.getQueueItem(taskId);
      if (!existingTask) {
        return res.status(404).json({ message: 'Task not found' });
      }
      if (existingTask.workflowType !== 'offboarding') {
        return res.status(400).json({ message: 'Task is not an offboarding task' });
      }

      const ALLOWED_FIELDS = [
        'status', 'notes', 'assignedTo', 'priority',
        'taskToolsReturn', 'taskIphoneReturn', 'taskDisconnectedLine', 'taskDisconnectedMPayment',
        'taskCloseSegnoOrders', 'taskCreateShippingLabel',
        'toolAuditNotificationSent', 'carrier',
        'fleetRoutingDecision',
        'phoneContactMethod', 'phoneShippingLabelSent', 'phoneTrackingNumber',
        'phonePhysicalCondition', 'phoneConditionNotes', 'phoneDataWipeCompleted',
        'phoneWipeMethod', 'phoneReprovisionCompleted', 'phoneRecoveryStage',
        'phoneWrittenOff', 'phoneServiceReinstated',
      ];

      const updates: any = { updatedAt: new Date() };
      for (const field of ALLOWED_FIELDS) {
        if (req.body[field] !== undefined) {
          updates[field] = req.body[field];
        }
      }

      if (updates.status === 'in_progress' && !existingTask.startedAt) {
        updates.startedAt = new Date();
      }
      if (updates.status === 'completed' && !existingTask.completedAt) {
        updates.completedAt = new Date();
      }
      if (updates.toolAuditNotificationSent && !existingTask.toolAuditNotificationSentAt) {
        updates.toolAuditNotificationSentAt = new Date();
      }

      const updated = await storage.updateQueueItem(taskId, updates);
      return res.json(updated);
    } catch (err: any) {
      console.error('[UnifiedOffboarding] PATCH /task/:taskId error:', err.message);
      return res.status(500).json({ message: 'Failed to update task' });
    }
  });

  app.post('/api/unified-offboarding/task/:taskId/contact-log', requireAuth, async (req: any, res) => {
    try {
      if (!await hasOffboardingAccess(req.user)) {
        return res.status(403).json({ message: 'Access denied' });
      }
      const { taskId } = req.params;
      const existingTask = await storage.getQueueItem(taskId);
      if (!existingTask) {
        return res.status(404).json({ message: 'Task not found' });
      }
      if (existingTask.workflowType !== 'offboarding') {
        return res.status(400).json({ message: 'Task is not an offboarding task' });
      }

      let history: any[] = [];
      if (existingTask.phoneContactHistory) {
        history = Array.isArray(existingTask.phoneContactHistory)
          ? existingTask.phoneContactHistory
          : [];
      }

      history.push({
        method: req.body.method || 'unknown',
        outcome: req.body.outcome || null,
        notes: req.body.notes || null,
        contactedBy: req.body.contactedBy || req.user.id,
        timestamp: new Date().toISOString(),
      });

      const updated = await storage.updateQueueItem(taskId, {
        phoneContactHistory: history,
        phoneContactMethod: req.body.method || existingTask.phoneContactMethod,
        updatedAt: new Date(),
      });
      return res.json(updated);
    } catch (err: any) {
      console.error('[UnifiedOffboarding] POST /task/:taskId/contact-log error:', err.message);
      return res.status(500).json({ message: 'Failed to add contact log' });
    }
  });

  app.get('/api/unified-offboarding/admin/duplicate-check', requireAuth, async (req: any, res) => {
    try {
      if (req.user.role !== 'developer' && req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Admin access required' });
      }
      const { checkOffboardingDuplicates } = await import('./create-offboarding-tasks-service');
      const result = await checkOffboardingDuplicates();
      return res.json({ duplicates: result, count: result.length });
    } catch (err: any) {
      console.error('[UnifiedOffboarding] GET /admin/duplicate-check error:', err.message);
      return res.status(500).json({ message: 'Failed to check duplicates' });
    }
  });

  app.post('/api/unified-offboarding/admin/run-task-creation', requireAuth, async (req: any, res) => {
    try {
      if (req.user.role !== 'developer' && req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Admin access required' });
      }
      const { createOffboardingQueueTasks } = await import('./create-offboarding-tasks-service');
      const result = await createOffboardingQueueTasks('manual');
      return res.json(result);
    } catch (err: any) {
      console.error('[UnifiedOffboarding] POST /admin/run-task-creation error:', err.message);
      return res.status(500).json({ message: 'Failed to run task creation' });
    }
  });

  // ===== BYOV Enrollments API =====

  app.get('/api/byov-enrollments', requireAuth, async (_req, res) => {
    try {
      const rows = await db.execute(sql`
        SELECT enterprise_id, full_name, truck_number, enrollment_type, in_rental,
               district, status, approved_date, created_at, updated_at
        FROM byov_enrollments
        ORDER BY approved_date DESC NULLS LAST, created_at DESC
      `);
      const enrollments: any[] = rows.rows as any[];

      // Enrich with TPMS_EXTRACT contact + address data from Snowflake
      // Two-tier matching: 1) truck_number → TRUCK_LU, 2) fallback enterprise_id → ENTERPRISE_ID
      if (enrollments.length > 0) {
        try {
          const { executeQuery: sfQuery } = await import("./fleet-scope-snowflake");

          const normalizeTruck = (val: string | null | undefined): string => {
            if (!val) return '';
            return val.toString().trim().replace(/\D/g, '').replace(/^0+/, '');
          };

          const truckNums = enrollments
            .map((e: any) => normalizeTruck(e.truck_number))
            .filter(Boolean);
          const entIds = enrollments
            .map((e: any) => e.enterprise_id?.toString().trim())
            .filter(Boolean);

          console.log(`[BYOV] Enriching ${enrollments.length} enrollments, trucks: ${truckNums.slice(0,5).join(', ')}, IDs: ${entIds.slice(0,5).join(', ')}`);

          type TpmsRow = {
            NORM_TRUCK: string | null;
            ENTERPRISE_ID: string | null;
            MOBILEPHONENUMBER: string | null;
            PRIMARYADDR1: string | null;
            PRIMARYADDR2: string | null;
            PRIMARYCITY: string | null;
            PRIMARYSTATE: string | null;
            PRIMARYZIP: string | null;
          };

          const whereClauses: string[] = [];
          if (truckNums.length > 0) {
            const safeTrucks = truckNums.map((t: string) => `'${t.replace(/'/g, "''")}'`).join(',');
            whereClauses.push(`LTRIM(REGEXP_REPLACE(TRUCK_LU, '[^0-9]', ''), '0') IN (${safeTrucks})`);
          }
          if (entIds.length > 0) {
            const safeIds = entIds.map((id: string) => `'${id.replace(/'/g, "''").toUpperCase()}'`).join(',');
            whereClauses.push(`UPPER(ENTERPRISE_ID) IN (${safeIds})`);
          }

          if (whereClauses.length > 0) {
            const tpmsRows = await sfQuery<TpmsRow>(`
              SELECT LTRIM(REGEXP_REPLACE(TRUCK_LU, '[^0-9]', ''), '0') AS NORM_TRUCK,
                     UPPER(ENTERPRISE_ID) AS ENTERPRISE_ID, MOBILEPHONENUMBER,
                     PRIMARYADDR1, PRIMARYADDR2, PRIMARYCITY, PRIMARYSTATE, PRIMARYZIP
              FROM PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT
              WHERE ${whereClauses.join(' OR ')}
            `);
            console.log(`[BYOV] TPMS_EXTRACT returned ${tpmsRows.length} rows`);

            const truckMap = new Map<string, TpmsRow>();
            const entIdMap = new Map<string, TpmsRow>();
            for (const row of tpmsRows) {
              if (row.NORM_TRUCK && !truckMap.has(row.NORM_TRUCK)) {
                truckMap.set(row.NORM_TRUCK, row);
              }
              if (row.ENTERPRISE_ID) {
                const key = row.ENTERPRISE_ID.toString().trim().toUpperCase();
                if (!entIdMap.has(key)) {
                  entIdMap.set(key, row);
                }
              }
            }

            const applyTpms = (enrollment: any, tpms: TpmsRow) => {
              enrollment.mobile_phone = tpms.MOBILEPHONENUMBER?.toString().trim() || null;
              const addrParts = [
                tpms.PRIMARYADDR1?.trim(),
                tpms.PRIMARYADDR2?.trim(),
                tpms.PRIMARYCITY?.trim(),
                tpms.PRIMARYSTATE?.trim(),
                tpms.PRIMARYZIP?.trim(),
              ].filter(Boolean);
              enrollment.home_address = addrParts.length > 0 ? addrParts.join(', ') : null;
            };

            for (const enrollment of enrollments) {
              const normTruck = normalizeTruck(enrollment.truck_number);
              const truckMatch = normTruck ? truckMap.get(normTruck) : undefined;
              if (truckMatch) {
                applyTpms(enrollment, truckMatch);
                continue;
              }
              const entKey = enrollment.enterprise_id?.toString().trim().toUpperCase() || '';
              const entMatch = entKey ? entIdMap.get(entKey) : undefined;
              if (entMatch) {
                applyTpms(enrollment, entMatch);
              } else {
                enrollment.mobile_phone = null;
                enrollment.home_address = null;
              }
            }
          }
        } catch (snowflakeErr: any) {
          console.warn('[BYOV] Snowflake enrich failed (non-fatal):', snowflakeErr.message);
        }
      }

      return res.json(enrollments);
    } catch (err: any) {
      console.error('[BYOV] GET /api/byov-enrollments error:', err.message);
      return res.status(500).json({ message: 'Failed to fetch BYOV enrollments' });
    }
  });

  app.post('/api/byov-enrollments/backfill', requireAuth, async (_req, res) => {
    try {
      const apiKey = process.env.BYOV_API_KEY;
      if (!apiKey) {
        return res.status(503).json({ message: 'BYOV_API_KEY not configured in Replit Secrets' });
      }
      const baseUrl = 'https://byov-enrollment.replit.app/api/external/enrollments';
      let page = 1;
      let totalUpserted = 0;
      let hasMore = true;
      while (hasMore) {
        const url = `${baseUrl}?limit=500&page=${page}`;
        const resp = await fetch(url, { headers: { 'x-api-key': apiKey } });
        if (!resp.ok) {
          const errText = await resp.text();
          throw new Error(`BYOV API error ${resp.status}: ${errText}`);
        }
        const json = await resp.json() as { data: any[]; pagination: { page: number; limit: number; total: number } };
        const records: any[] = json.data || [];
        for (const r of records) {
          await db.execute(sql`
            INSERT INTO byov_enrollments
              (enterprise_id, full_name, truck_number, enrollment_type, in_rental, district, status, approved_date, updated_at)
            VALUES
              (${r.enterprise_id}, ${r.full_name}, ${r.truck_number}, ${r.enrollment_type},
               ${r.in_rental ?? false}, ${r.district}, ${r.status || 'approved'}, ${r.approved_date || null}, NOW())
            ON CONFLICT (enterprise_id) DO UPDATE SET
              full_name = EXCLUDED.full_name,
              truck_number = EXCLUDED.truck_number,
              enrollment_type = EXCLUDED.enrollment_type,
              in_rental = EXCLUDED.in_rental,
              district = EXCLUDED.district,
              status = EXCLUDED.status,
              approved_date = EXCLUDED.approved_date,
              updated_at = NOW()
          `);
          totalUpserted++;
        }
        const { total, limit } = json.pagination;
        hasMore = page * limit < total && records.length > 0;
        page++;
      }
      console.log(`[BYOV] Backfill complete: ${totalUpserted} records upserted`);
      return res.json({ success: true, upserted: totalUpserted });
    } catch (err: any) {
      console.error('[BYOV] POST /api/byov-enrollments/backfill error:', err.message);
      return res.status(500).json({ message: err.message || 'Backfill failed' });
    }
  });

  // -------------------------------------------------------------------------
  // BYOV Drift Check — admin-only API (Task 327)
  // -------------------------------------------------------------------------

  // POST /api/byov/verify — trigger an on-demand verification run
  app.post("/api/byov/verify", requireAuth, async (req: any, res) => {
    try {
      const currentUser = req.user as any;
      if (!currentUser || (currentUser.role !== "developer" && currentUser.role !== "admin")) {
        return res.status(403).json({ message: "Access denied. Admin or developer role required." });
      }

      const { runByovDriftCheck } = await import("./byov-verification-service");
      const r = await runByovDriftCheck(`manual:${currentUser.username ?? currentUser.id}`);

      // Normalize to snake_case so the API contract matches the GET endpoints
      // and the UI DriftCheckRun interface works for both manual and polled runs.
      const result = {
        run_at:            r.runAt.toISOString(),
        triggered_by:      r.triggeredBy,
        total_checked:     r.totalChecked,
        holman_fail_count: r.holmanFailCount,
        wms_fail_count:    r.wmsFailCount,
        mismatches:        r.mismatches,
        duration_ms:       r.durationMs,
      };
      return res.json({ success: true, result });
    } catch (err: any) {
      console.error("[BYOV] POST /api/byov/verify error:", err.message);
      return res.status(500).json({ message: err.message || "Verification run failed" });
    }
  });

  // GET /api/byov/verify/history — return recent run summaries
  app.get("/api/byov/verify/history", requireAuth, async (req: any, res) => {
    try {
      const currentUser = req.user as any;
      if (!currentUser || (currentUser.role !== "developer" && currentUser.role !== "admin")) {
        return res.status(403).json({ message: "Access denied. Admin or developer role required." });
      }

      const limitParam = Math.min(parseInt((req.query.limit as string) || "20", 10), 100);
      const rows = await db.execute<{
        id: number;
        run_at: string;
        triggered_by: string;
        total_checked: number;
        holman_fail_count: number;
        wms_fail_count: number;
        mismatches: any;
        duration_ms: number;
      }>(sql`
        SELECT id, run_at, triggered_by, total_checked, holman_fail_count, wms_fail_count, mismatches, duration_ms
        FROM byov_drift_checks
        ORDER BY run_at DESC
        LIMIT ${limitParam}
      `);

      return res.json({ history: rows.rows ?? [] });
    } catch (err: any) {
      console.error("[BYOV] GET /api/byov/verify/history error:", err.message);
      return res.status(500).json({ message: err.message || "Failed to load history" });
    }
  });

  // GET /api/byov/verify/latest — latest run in full detail
  app.get("/api/byov/verify/latest", requireAuth, async (req: any, res) => {
    try {
      const currentUser = req.user as any;
      if (!currentUser || (currentUser.role !== "developer" && currentUser.role !== "admin")) {
        return res.status(403).json({ message: "Access denied. Admin or developer role required." });
      }

      const rows = await db.execute<{
        id: number;
        run_at: string;
        triggered_by: string;
        total_checked: number;
        holman_fail_count: number;
        wms_fail_count: number;
        mismatches: any;
        duration_ms: number;
      }>(sql`
        SELECT id, run_at, triggered_by, total_checked, holman_fail_count, wms_fail_count, mismatches, duration_ms
        FROM byov_drift_checks
        ORDER BY run_at DESC
        LIMIT 1
      `);

      const latest = (rows.rows ?? [])[0] ?? null;
      return res.json({ latest });
    } catch (err: any) {
      console.error("[BYOV] GET /api/byov/verify/latest error:", err.message);
      return res.status(500).json({ message: err.message || "Failed to load latest run" });
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

  if (fsDb) {
    initFsWebSocket(httpServer);
    startFsScheduledMessages();
    console.log("[Fleet-Scope] WebSocket (/fs-ws) and scheduled message processor initialized");
  }

  return httpServer;
}
