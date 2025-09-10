import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertRequestSchema, insertUserSchema, insertApiConfigurationSchema, insertQueueItemSchema } from "@shared/schema";
import { z } from "zod";

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth routes
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { enterpriseId, password } = req.body;
      const user = await storage.getUserByUsername(enterpriseId);
      
      if (!user || user.password !== password) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      // In a real app, you'd use proper session management/JWT
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

  // Queue Item routes
  app.get("/api/queue", async (req, res) => {
    try {
      const { status, workflowType, assignedTo, userId } = req.query;
      
      let queueItems;
      if (status) {
        queueItems = await storage.getQueueItemsByStatus(status as string);
      } else if (workflowType) {
        queueItems = await storage.getQueueItemsByWorkflowType(workflowType as string);
      } else if (assignedTo) {
        queueItems = await storage.getQueueItemsByAssignee(assignedTo as string);
      } else if (userId) {
        queueItems = await storage.getMyQueueItems(userId as string);
      } else {
        queueItems = await storage.getQueueItems();
      }
      
      res.json(queueItems);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch queue items" });
    }
  });

  app.get("/api/queue/:id", async (req, res) => {
    try {
      const queueItem = await storage.getQueueItem(req.params.id);
      if (!queueItem) {
        return res.status(404).json({ message: "Queue item not found" });
      }
      res.json(queueItem);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch queue item" });
    }
  });

  app.post("/api/queue", async (req, res) => {
    try {
      const queueItemData = insertQueueItemSchema.parse(req.body);
      const queueItem = await storage.createQueueItem(queueItemData);
      res.status(201).json(queueItem);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid queue item data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create queue item" });
    }
  });

  app.patch("/api/queue/:id", async (req, res) => {
    try {
      const updates = req.body;
      const queueItem = await storage.updateQueueItem(req.params.id, updates);
      
      if (!queueItem) {
        return res.status(404).json({ message: "Queue item not found" });
      }

      res.json(queueItem);
    } catch (error) {
      res.status(500).json({ message: "Failed to update queue item" });
    }
  });

  app.patch("/api/queue/:id/assign", async (req, res) => {
    try {
      const { assigneeId } = req.body;
      if (!assigneeId) {
        return res.status(400).json({ message: "Assignee ID is required" });
      }

      const queueItem = await storage.assignQueueItem(req.params.id, assigneeId);
      
      if (!queueItem) {
        return res.status(404).json({ message: "Queue item not found" });
      }

      res.json(queueItem);
    } catch (error) {
      res.status(500).json({ message: "Failed to assign queue item" });
    }
  });

  app.patch("/api/queue/:id/complete", async (req, res) => {
    try {
      const { completedBy } = req.body;
      if (!completedBy) {
        return res.status(400).json({ message: "Completed by user ID is required" });
      }

      const queueItem = await storage.completeQueueItem(req.params.id, completedBy);
      
      if (!queueItem) {
        return res.status(404).json({ message: "Queue item not found" });
      }

      res.json(queueItem);
    } catch (error) {
      res.status(500).json({ message: "Failed to complete queue item" });
    }
  });

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

  app.patch("/api/queue/:id/notes", async (req, res) => {
    try {
      const { notes } = req.body;
      
      const queueItem = await storage.updateQueueItem(req.params.id, { notes });
      
      if (!queueItem) {
        return res.status(404).json({ message: "Queue item not found" });
      }

      res.json(queueItem);
    } catch (error) {
      res.status(500).json({ message: "Failed to update notes" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
