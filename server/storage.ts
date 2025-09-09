import { 
  type User, 
  type InsertUser, 
  type Request, 
  type InsertRequest,
  type ApiConfiguration,
  type InsertApiConfiguration,
  type ActivityLog,
  type InsertActivityLog,
  type QueueItem,
  type InsertQueueItem
} from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, updates: Partial<User>): Promise<User | undefined>;
  
  // Requests
  getRequest(id: string): Promise<Request | undefined>;
  getRequests(): Promise<Request[]>;
  getRequestsByStatus(status: string): Promise<Request[]>;
  getRequestsByRequester(requesterId: string): Promise<Request[]>;
  createRequest(request: InsertRequest): Promise<Request>;
  updateRequest(id: string, updates: Partial<Request>): Promise<Request | undefined>;
  
  // API Configurations
  getApiConfiguration(id: string): Promise<ApiConfiguration | undefined>;
  getApiConfigurations(): Promise<ApiConfiguration[]>;
  createApiConfiguration(config: InsertApiConfiguration): Promise<ApiConfiguration>;
  updateApiConfiguration(id: string, updates: Partial<ApiConfiguration>): Promise<ApiConfiguration | undefined>;
  deleteApiConfiguration(id: string): Promise<boolean>;
  
  // Activity Logs
  getActivityLogs(): Promise<ActivityLog[]>;
  getActivityLogsByUser(userId: string): Promise<ActivityLog[]>;
  createActivityLog(log: InsertActivityLog): Promise<ActivityLog>;
  
  // Dashboard Stats
  getDashboardStats(): Promise<{
    pendingRequests: number;
    approvedToday: number;
    activeConnections: number;
    activeUsers: number;
  }>;

  // Queue Items
  getQueueItem(id: string): Promise<QueueItem | undefined>;
  getQueueItems(): Promise<QueueItem[]>;
  getQueueItemsByStatus(status: string): Promise<QueueItem[]>;
  getQueueItemsByWorkflowType(workflowType: string): Promise<QueueItem[]>;
  getQueueItemsByAssignee(userId: string): Promise<QueueItem[]>;
  getMyQueueItems(userId: string): Promise<QueueItem[]>; // Items user created or assigned to
  createQueueItem(item: InsertQueueItem): Promise<QueueItem>;
  updateQueueItem(id: string, updates: Partial<QueueItem>): Promise<QueueItem | undefined>;
  assignQueueItem(id: string, assigneeId: string): Promise<QueueItem | undefined>;
  completeQueueItem(id: string, completedBy: string): Promise<QueueItem | undefined>;
  cancelQueueItem(id: string, reason: string): Promise<QueueItem | undefined>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private requests: Map<string, Request>;
  private apiConfigurations: Map<string, ApiConfiguration>;
  private activityLogs: Map<string, ActivityLog>;
  private queueItems: Map<string, QueueItem>;

  constructor() {
    this.users = new Map();
    this.requests = new Map();
    this.apiConfigurations = new Map();
    this.activityLogs = new Map();
    this.queueItems = new Map();
    
    // Initialize with admin user
    this.initializeDefaultData();
  }

  private async initializeDefaultData() {
    // Create Enterprise ID users
    const enterpriseUsers: User[] = [
      {
        id: randomUUID(),
        username: "ENT1234",
        email: "requester@sears.com",
        password: "passwords", // In real app, this would be hashed
        role: "requester",
        createdAt: new Date(),
      },
      {
        id: randomUUID(),
        username: "ENT1235",
        email: "approver@sears.com",
        password: "passwords", // In real app, this would be hashed
        role: "approver",
        createdAt: new Date(),
      },
      {
        id: randomUUID(),
        username: "ADMIN123",
        email: "admin@sears.com",
        password: "passwords", // In real app, this would be hashed
        role: "admin",
        createdAt: new Date(),
      },
    ];
    
    enterpriseUsers.forEach(user => this.users.set(user.id, user));

    // Create sample API configurations
    const sampleApis: ApiConfiguration[] = [
      {
        id: randomUUID(),
        name: "Salesforce API",
        endpoint: "https://api.salesforce.com",
        apiKey: "sample_sf_key",
        isActive: true,
        healthStatus: "healthy",
        lastChecked: new Date(),
        createdAt: new Date(),
      },
      {
        id: randomUUID(),
        name: "HubSpot CRM",
        endpoint: "https://api.hubapi.com",
        apiKey: "sample_hs_key",
        isActive: true,
        healthStatus: "healthy",
        lastChecked: new Date(),
        createdAt: new Date(),
      },
      {
        id: randomUUID(),
        name: "Snowflake Data",
        endpoint: "https://account.snowflakecomputing.com",
        apiKey: "sample_sf_key",
        isActive: false,
        healthStatus: "warning",
        lastChecked: new Date(),
        createdAt: new Date(),
      },
    ];

    sampleApis.forEach(api => this.apiConfigurations.set(api.id, api));

    // Create sample queue items
    const sampleQueueItems: QueueItem[] = [
      {
        id: randomUUID(),
        workflowType: "onboarding",
        title: "Onboard New Technician - John Smith",
        description: "Complete onboarding process for new field technician John Smith",
        status: "pending",
        priority: "high",
        assignedTo: null,
        requesterId: enterpriseUsers[0].id, // ENT1234
        data: JSON.stringify({
          employeeName: "John Smith",
          department: "Field Services",
          startDate: "2024-01-15",
          location: "Chicago, IL"
        }),
        metadata: null,
        scheduledFor: null,
        attempts: 0,
        lastError: null,
        completedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: randomUUID(),
        workflowType: "vehicle_assignment",
        title: "Assign Vehicle to Tech - Sarah Johnson",
        description: "Assign service vehicle to technician Sarah Johnson for route coverage",
        status: "in_progress",
        priority: "medium",
        assignedTo: enterpriseUsers[1].id, // ENT1235
        requesterId: enterpriseUsers[0].id,
        data: JSON.stringify({
          techName: "Sarah Johnson",
          techId: "T12345",
          vehicleType: "Service Van",
          region: "Midwest"
        }),
        metadata: null,
        scheduledFor: null,
        attempts: 0,
        lastError: null,
        completedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: randomUUID(),
        workflowType: "offboarding",
        title: "Offboard Departing Tech - Mike Wilson",
        description: "Process offboarding for departing technician Mike Wilson",
        status: "pending",
        priority: "high",
        assignedTo: null,
        requesterId: enterpriseUsers[2].id, // ADMIN123
        data: JSON.stringify({
          techName: "Mike Wilson",
          techId: "T67890",
          lastDayWorked: "2024-01-30",
          vehicleNumber: "SV-4891",
          reason: "resignation"
        }),
        metadata: null,
        scheduledFor: null,
        attempts: 0,
        lastError: null,
        completedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    ];

    sampleQueueItems.forEach(item => this.queueItems.set(item.id, item));
  }

  // Users
  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(user => user.username === username);
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(user => user.email === email);
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { 
      ...insertUser,
      role: insertUser.role || "requester",
      id, 
      createdAt: new Date(),
    };
    this.users.set(id, user);
    return user;
  }

  async updateUser(id: string, updates: Partial<User>): Promise<User | undefined> {
    const user = this.users.get(id);
    if (!user) return undefined;
    
    const updatedUser = { ...user, ...updates };
    this.users.set(id, updatedUser);
    return updatedUser;
  }

  // Requests
  async getRequest(id: string): Promise<Request | undefined> {
    return this.requests.get(id);
  }

  async getRequests(): Promise<Request[]> {
    return Array.from(this.requests.values()).sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async getRequestsByStatus(status: string): Promise<Request[]> {
    return Array.from(this.requests.values())
      .filter(request => request.status === status)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async getRequestsByRequester(requesterId: string): Promise<Request[]> {
    return Array.from(this.requests.values())
      .filter(request => request.requesterId === requesterId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async createRequest(insertRequest: InsertRequest): Promise<Request> {
    const id = randomUUID();
    const request: Request = {
      ...insertRequest,
      status: insertRequest.status || "pending",
      priority: insertRequest.priority || "medium",
      targetApi: insertRequest.targetApi || null,
      approverId: insertRequest.approverId || null,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.requests.set(id, request);
    return request;
  }

  async updateRequest(id: string, updates: Partial<Request>): Promise<Request | undefined> {
    const request = this.requests.get(id);
    if (!request) return undefined;
    
    const updatedRequest = { 
      ...request, 
      ...updates, 
      updatedAt: new Date() 
    };
    this.requests.set(id, updatedRequest);
    return updatedRequest;
  }

  // API Configurations
  async getApiConfiguration(id: string): Promise<ApiConfiguration | undefined> {
    return this.apiConfigurations.get(id);
  }

  async getApiConfigurations(): Promise<ApiConfiguration[]> {
    return Array.from(this.apiConfigurations.values());
  }

  async createApiConfiguration(insertConfig: InsertApiConfiguration): Promise<ApiConfiguration> {
    const id = randomUUID();
    const config: ApiConfiguration = {
      ...insertConfig,
      apiKey: insertConfig.apiKey || null,
      isActive: insertConfig.isActive !== undefined ? insertConfig.isActive : true,
      healthStatus: insertConfig.healthStatus || "healthy",
      id,
      lastChecked: new Date(),
      createdAt: new Date(),
    };
    this.apiConfigurations.set(id, config);
    return config;
  }

  async updateApiConfiguration(id: string, updates: Partial<ApiConfiguration>): Promise<ApiConfiguration | undefined> {
    const config = this.apiConfigurations.get(id);
    if (!config) return undefined;
    
    const updatedConfig = { ...config, ...updates };
    this.apiConfigurations.set(id, updatedConfig);
    return updatedConfig;
  }

  async deleteApiConfiguration(id: string): Promise<boolean> {
    return this.apiConfigurations.delete(id);
  }

  // Activity Logs
  async getActivityLogs(): Promise<ActivityLog[]> {
    return Array.from(this.activityLogs.values()).sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async getActivityLogsByUser(userId: string): Promise<ActivityLog[]> {
    return Array.from(this.activityLogs.values())
      .filter(log => log.userId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async createActivityLog(insertLog: InsertActivityLog): Promise<ActivityLog> {
    const id = randomUUID();
    const log: ActivityLog = {
      ...insertLog,
      entityId: insertLog.entityId || null,
      details: insertLog.details || null,
      id,
      createdAt: new Date(),
    };
    this.activityLogs.set(id, log);
    return log;
  }

  // Dashboard Stats
  async getDashboardStats(): Promise<{
    pendingRequests: number;
    approvedToday: number;
    activeConnections: number;
    activeUsers: number;
  }> {
    const requests = Array.from(this.requests.values());
    const pendingRequests = requests.filter(r => r.status === "pending").length;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const approvedToday = requests.filter(r => 
      r.status === "approved" && 
      new Date(r.updatedAt) >= today
    ).length;
    
    const activeConnections = Array.from(this.apiConfigurations.values())
      .filter(api => api.isActive).length;
    
    const activeUsers = this.users.size;

    return {
      pendingRequests,
      approvedToday,
      activeConnections,
      activeUsers,
    };
  }

  // Queue Items
  async getQueueItem(id: string): Promise<QueueItem | undefined> {
    return this.queueItems.get(id);
  }

  async getQueueItems(): Promise<QueueItem[]> {
    return Array.from(this.queueItems.values()).sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async getQueueItemsByStatus(status: string): Promise<QueueItem[]> {
    return Array.from(this.queueItems.values())
      .filter(item => item.status === status)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async getQueueItemsByWorkflowType(workflowType: string): Promise<QueueItem[]> {
    return Array.from(this.queueItems.values())
      .filter(item => item.workflowType === workflowType)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async getQueueItemsByAssignee(userId: string): Promise<QueueItem[]> {
    return Array.from(this.queueItems.values())
      .filter(item => item.assignedTo === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async getMyQueueItems(userId: string): Promise<QueueItem[]> {
    return Array.from(this.queueItems.values())
      .filter(item => item.requesterId === userId || item.assignedTo === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async createQueueItem(insertItem: InsertQueueItem): Promise<QueueItem> {
    const id = randomUUID();
    const item: QueueItem = {
      ...insertItem,
      status: insertItem.status || "pending",
      priority: insertItem.priority || "medium",
      assignedTo: insertItem.assignedTo || null,
      data: insertItem.data || null,
      metadata: insertItem.metadata || null,
      scheduledFor: insertItem.scheduledFor || null,
      attempts: insertItem.attempts || 0,
      lastError: insertItem.lastError || null,
      completedAt: insertItem.completedAt || null,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.queueItems.set(id, item);
    
    // Log the queue item creation
    await this.createActivityLog({
      userId: insertItem.requesterId,
      action: "queue_item_created",
      entityType: "queue_item",
      entityId: id,
      details: `Created ${insertItem.workflowType} queue item: ${insertItem.title}`,
    });
    
    return item;
  }

  async updateQueueItem(id: string, updates: Partial<QueueItem>): Promise<QueueItem | undefined> {
    const item = this.queueItems.get(id);
    if (!item) return undefined;
    
    const updatedItem = { 
      ...item, 
      ...updates, 
      updatedAt: new Date() 
    };
    this.queueItems.set(id, updatedItem);
    return updatedItem;
  }

  async assignQueueItem(id: string, assigneeId: string): Promise<QueueItem | undefined> {
    const item = this.queueItems.get(id);
    if (!item) return undefined;
    
    const updatedItem = { 
      ...item, 
      assignedTo: assigneeId,
      status: "in_progress",
      updatedAt: new Date() 
    };
    this.queueItems.set(id, updatedItem);
    
    // Log the assignment
    await this.createActivityLog({
      userId: assigneeId,
      action: "queue_item_assigned",
      entityType: "queue_item",
      entityId: id,
      details: `Assigned ${item.workflowType} queue item: ${item.title}`,
    });
    
    return updatedItem;
  }

  async completeQueueItem(id: string, completedBy: string): Promise<QueueItem | undefined> {
    const item = this.queueItems.get(id);
    if (!item) return undefined;
    
    const updatedItem = { 
      ...item, 
      status: "completed",
      completedAt: new Date(),
      updatedAt: new Date() 
    };
    this.queueItems.set(id, updatedItem);
    
    // Log the completion
    await this.createActivityLog({
      userId: completedBy,
      action: "queue_item_completed",
      entityType: "queue_item",
      entityId: id,
      details: `Completed ${item.workflowType} queue item: ${item.title}`,
    });
    
    return updatedItem;
  }

  async cancelQueueItem(id: string, reason: string): Promise<QueueItem | undefined> {
    const item = this.queueItems.get(id);
    if (!item) return undefined;
    
    const updatedItem = { 
      ...item, 
      status: "cancelled",
      lastError: reason,
      updatedAt: new Date() 
    };
    this.queueItems.set(id, updatedItem);
    
    return updatedItem;
  }
}

export const storage = new MemStorage();
