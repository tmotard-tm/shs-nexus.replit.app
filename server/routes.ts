import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertRequestSchema, insertUserSchema, insertApiConfigurationSchema, insertQueueItemSchema, insertStorageSpotSchema, insertVehicleSchema, QueueModule } from "@shared/schema";
import { z } from "zod";
import { sendEmail, createCreditCardDeactivationEmail } from "./email-service";
import { activeVehicles } from "../client/src/data/fleetData";
import multer from "multer";

// Simple session store for demo purposes
const sessions = new Map<string, { userId: string; username: string; expiresAt: Date }>();

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

      // Create session
      const sessionId = Math.random().toString(36).substring(2) + Date.now().toString(36);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
      
      sessions.set(sessionId, {
        userId: user.id,
        username: user.username,
        expiresAt
      });

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

  // User management routes
  app.get("/api/users", async (req, res) => {
    try {
      const users = await storage.getUsers();
      // Remove passwords from response
      const safeUsers = users.map(user => ({ ...user, password: undefined }));
      res.json(safeUsers);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.post("/api/users", async (req, res) => {
    try {
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

  app.patch("/api/users/:id", async (req, res) => {
    try {
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

  app.delete("/api/users/:id", async (req, res) => {
    try {
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

  app.post("/api/ntao-queue", async (req, res) => {
    try {
      const queueItemData = insertQueueItemSchema.parse(req.body);
      const queueItem = await storage.createNTAOQueueItem(queueItemData);
      res.status(201).json(queueItem);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid queue item data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create NTAO queue item" });
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

  app.post("/api/assets-queue", async (req, res) => {
    try {
      const queueItemData = insertQueueItemSchema.parse(req.body);
      const queueItem = await storage.createAssetsQueueItem(queueItemData);
      res.status(201).json(queueItem);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid queue item data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create Assets queue item" });
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

  app.post("/api/inventory-queue", async (req, res) => {
    try {
      const queueItemData = insertQueueItemSchema.parse(req.body);
      const queueItem = await storage.createInventoryQueueItem(queueItemData);
      res.status(201).json(queueItem);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid queue item data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create Inventory queue item" });
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

  app.post("/api/fleet-queue", async (req, res) => {
    try {
      const queueItemData = insertQueueItemSchema.parse(req.body);
      const queueItem = await storage.createFleetQueueItem(queueItemData);
      res.status(201).json(queueItem);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid queue item data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create Fleet queue item" });
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
      
      // Enforce access control
      let allowedModules: string[];
      if (currentUser.role === "superadmin") {
        allowedModules = requestedModules; // Superadmin can access all
      } else if (currentUser.accessibleQueues && currentUser.accessibleQueues.length > 0) {
        allowedModules = requestedModules.filter(module => currentUser.accessibleQueues!.includes(module));
      } else {
        return res.status(403).json({ message: "No queue access permissions" });
      }
      
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
      
      // Enforce access control
      let allowedModules: string[];
      if (currentUser.role === "superadmin") {
        allowedModules = requestedModules; // Superadmin can access all
      } else if (currentUser.accessibleQueues && currentUser.accessibleQueues.length > 0) {
        allowedModules = requestedModules.filter(module => currentUser.accessibleQueues!.includes(module));
      } else {
        return res.status(403).json({ message: "No queue access permissions" });
      }
      
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
      
      // Enforce access control
      if (currentUser.role !== "superadmin" && 
          (!currentUser.accessibleQueues || !currentUser.accessibleQueues.includes(module as any))) {
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
  
  app.patch("/api/queues/:module/:id/complete", requireAuth, async (req: any, res) => {
    try {
      const currentUser = await storage.getUserByUsername(req.user.username);
      if (!currentUser) {
        return res.status(401).json({ message: "Invalid user" });
      }
      
      const { module, id } = req.params;
      const { completedBy } = req.body;
      
      if (!completedBy) {
        return res.status(400).json({ message: "completedBy is required" });
      }
      
      const validModules = ['ntao', 'assets', 'inventory', 'fleet'];
      if (!validModules.includes(module)) {
        return res.status(400).json({ 
          message: `Invalid module: ${module}. Valid modules: ${validModules.join(', ')}` 
        });
      }
      
      // Enforce access control
      if (currentUser.role !== "superadmin" && 
          (!currentUser.accessibleQueues || !currentUser.accessibleQueues.includes(module as any))) {
        return res.status(403).json({ message: "Access denied to this queue" });
      }
      
      const updatedItem = await storage.completeUnifiedQueueItem(module as any, id, completedBy);
      if (!updatedItem) {
        return res.status(404).json({ message: "Queue item not found" });
      }
      
      res.json({ ...updatedItem, module });
    } catch (error) {
      console.error('Error completing unified queue item:', error);
      res.status(500).json({ message: "Failed to complete queue item" });
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

  app.post("/api/storage-spots", async (req, res) => {
    try {
      const storageSpotData = insertStorageSpotSchema.parse(req.body);
      const storageSpot = await storage.createStorageSpot(storageSpotData);
      
      // Log activity
      await storage.createActivityLog({
        userId: "system", // TODO: Get from authenticated user
        action: "storage_spot_created",
        entityType: "storage_spot",
        entityId: storageSpot.id,
        details: `Created storage spot: ${storageSpot.name}`,
      });

      res.status(201).json(storageSpot);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid storage spot data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create storage spot" });
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

  app.post("/api/vehicles", async (req, res) => {
    try {
      const vehicleData = insertVehicleSchema.parse(req.body);
      const vehicle = await storage.createVehicle(vehicleData);
      
      // Log activity
      await storage.createActivityLog({
        userId: "system", // TODO: Get from authenticated user
        action: "vehicle_created",
        entityType: "vehicle",
        entityId: vehicle.id,
        details: `Created vehicle: ${vehicle.modelYear} ${vehicle.makeName} ${vehicle.modelName} (VIN: ${vehicle.vin})`,
      });

      res.status(201).json(vehicle);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid vehicle data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create vehicle" });
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
        deliveryDate: fleetVehicle.deliveryDate ? new Date(fleetVehicle.deliveryDate) : null,
        outOfServiceDate: fleetVehicle.outOfServiceDate ? new Date(fleetVehicle.outOfServiceDate) : null,
        saleDate: fleetVehicle.saleDate ? new Date(fleetVehicle.saleDate) : null,
        registrationRenewalDate: fleetVehicle.regRenewalDate ? new Date(fleetVehicle.regRenewalDate) : null,
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
        leaseEndDate: fleetVehicle.leaseEndDate ? new Date(fleetVehicle.leaseEndDate) : null,
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
        industry: z.string(),
      });

      const formData = formSchema.parse(req.body);
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
      const uploadedFileNames = files.map(file => file.fieldname);
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
        filesUploaded: files.map(f => ({ 
          name: f.fieldname, 
          size: f.size, 
          mimetype: f.mimetype 
        }))
      });

      // Store the enrollment data
      const enrollmentId = `sears-drive-${Date.now()}`;
      
      res.json({ 
        message: "Sears Drive Program enrollment submitted successfully!",
        enrollmentId,
        submittedData: formData,
        filesReceived: files.length
      });
    } catch (error) {
      console.error('Error submitting Sears Drive enrollment:', error);
      res.status(500).json({ message: "Failed to submit enrollment form" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
