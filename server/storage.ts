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
  type InsertQueueItem,
  type QueueModule,
  type CombinedQueueItem,
  type StorageSpot,
  type InsertStorageSpot,
  type Vehicle,
  type InsertVehicle,
} from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUsers(): Promise<User[]>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, updates: Partial<User>): Promise<User | undefined>;
  deleteUser(id: string): Promise<boolean>;
  
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
    onboarding: { pending: number; inProgress: number; completed: number };
    vehicleAssignment: { pending: number; inProgress: number; completed: number };
    offboarding: { pending: number; inProgress: number; completed: number };
    activeUsers: number;
  }>;

  // NTAO Queue Module
  getNTAOQueueItem(id: string): Promise<QueueItem | undefined>;
  getNTAOQueueItems(): Promise<QueueItem[]>;
  createNTAOQueueItem(item: InsertQueueItem): Promise<QueueItem>;
  updateNTAOQueueItem(id: string, updates: Partial<QueueItem>): Promise<QueueItem | undefined>;
  assignNTAOQueueItem(id: string, assigneeId: string): Promise<QueueItem | undefined>;
  startWorkNTAOQueueItem(id: string, workerId: string): Promise<QueueItem | undefined>;
  completeNTAOQueueItem(id: string, completedBy: string): Promise<QueueItem | undefined>;

  // Assets Queue Module  
  getAssetsQueueItem(id: string): Promise<QueueItem | undefined>;
  getAssetsQueueItems(): Promise<QueueItem[]>;
  createAssetsQueueItem(item: InsertQueueItem): Promise<QueueItem>;
  updateAssetsQueueItem(id: string, updates: Partial<QueueItem>): Promise<QueueItem | undefined>;
  assignAssetsQueueItem(id: string, assigneeId: string): Promise<QueueItem | undefined>;
  startWorkAssetsQueueItem(id: string, workerId: string): Promise<QueueItem | undefined>;
  completeAssetsQueueItem(id: string, completedBy: string): Promise<QueueItem | undefined>;

  // Inventory Queue Module
  getInventoryQueueItem(id: string): Promise<QueueItem | undefined>;
  getInventoryQueueItems(): Promise<QueueItem[]>;
  createInventoryQueueItem(item: InsertQueueItem): Promise<QueueItem>;
  updateInventoryQueueItem(id: string, updates: Partial<QueueItem>): Promise<QueueItem | undefined>;
  assignInventoryQueueItem(id: string, assigneeId: string): Promise<QueueItem | undefined>;
  startWorkInventoryQueueItem(id: string, workerId: string): Promise<QueueItem | undefined>;
  completeInventoryQueueItem(id: string, completedBy: string): Promise<QueueItem | undefined>;

  // Fleet Queue Module
  getFleetQueueItem(id: string): Promise<QueueItem | undefined>;
  getFleetQueueItems(): Promise<QueueItem[]>;
  createFleetQueueItem(item: InsertQueueItem): Promise<QueueItem>;
  updateFleetQueueItem(id: string, updates: Partial<QueueItem>): Promise<QueueItem | undefined>;
  assignFleetQueueItem(id: string, assigneeId: string): Promise<QueueItem | undefined>;
  startWorkFleetQueueItem(id: string, workerId: string): Promise<QueueItem | undefined>;
  completeFleetQueueItem(id: string, completedBy: string): Promise<QueueItem | undefined>;

  // Queue operations
  cancelQueueItem(id: string, reason: string): Promise<QueueItem | undefined>;

  // Storage Spots Module
  getStorageSpot(id: string): Promise<StorageSpot | undefined>;
  getStorageSpots(): Promise<StorageSpot[]>;
  getStorageSpotsByStatus(status: string): Promise<StorageSpot[]>;
  getStorageSpotsByState(state: string): Promise<StorageSpot[]>;
  createStorageSpot(spot: InsertStorageSpot): Promise<StorageSpot>;
  updateStorageSpot(id: string, updates: Partial<StorageSpot>): Promise<StorageSpot | undefined>;
  deleteStorageSpot(id: string): Promise<boolean>;

  // Vehicles Module
  getVehicle(id: string): Promise<Vehicle | undefined>;
  getVehicleByVin(vin: string): Promise<Vehicle | undefined>;
  getVehicles(): Promise<Vehicle[]>;
  getVehiclesByStatus(status: string): Promise<Vehicle[]>;
  getVehiclesByState(state: string): Promise<Vehicle[]>;
  getVehiclesByBranding(branding: string): Promise<Vehicle[]>;
  createVehicle(vehicle: InsertVehicle): Promise<Vehicle>;
  createVehicles(vehicles: InsertVehicle[]): Promise<Vehicle[]>;
  updateVehicle(id: string, updates: Partial<Vehicle>): Promise<Vehicle | undefined>;
  deleteVehicle(id: string): Promise<boolean>;

  // Unified Queue Aggregator
  getUnifiedQueueItems(modules: QueueModule[], status?: string): Promise<CombinedQueueItem[]>;
  getUnifiedQueueStats(modules: QueueModule[]): Promise<{
    pending: number;
    in_progress: number; 
    completed: number;
    total: number;
  }>;
  getUnifiedQueueItem(module: QueueModule, id: string): Promise<QueueItem | undefined>;
  updateUnifiedQueueItem(module: QueueModule, id: string, updates: Partial<QueueItem>): Promise<QueueItem | undefined>;
  assignUnifiedQueueItem(module: QueueModule, id: string, assigneeId: string): Promise<QueueItem | undefined>;
  startWorkUnifiedQueueItem(module: QueueModule, id: string, workerId: string): Promise<QueueItem | undefined>;
  completeUnifiedQueueItem(module: QueueModule, id: string, completedBy: string): Promise<QueueItem | undefined>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private requests: Map<string, Request>;
  private apiConfigurations: Map<string, ApiConfiguration>;
  private activityLogs: Map<string, ActivityLog>;
  private storageSpots: Map<string, StorageSpot>;
  private vehicles: Map<string, Vehicle>;
  
  // Separate storage for each queue module
  private ntaoQueueItems: Map<string, QueueItem>;
  private assetsQueueItems: Map<string, QueueItem>;
  private inventoryQueueItems: Map<string, QueueItem>;
  private fleetQueueItems: Map<string, QueueItem>;

  constructor() {
    this.users = new Map();
    this.requests = new Map();
    this.apiConfigurations = new Map();
    this.activityLogs = new Map();
    this.storageSpots = new Map();
    this.vehicles = new Map();
    
    // Initialize separate queue modules
    this.ntaoQueueItems = new Map();
    this.assetsQueueItems = new Map();
    this.inventoryQueueItems = new Map();
    this.fleetQueueItems = new Map();
    
    // Initialize with admin user
    this.initializeDefaultData();
  }

  private async initializeDefaultData() {
    // Create Enterprise ID users with new role system
    const enterpriseUsers: User[] = [
      // Demo users matching login page credentials
      {
        id: randomUUID(),
        username: "ENT1234",
        email: "requester@sears.com",
        password: "passwords", // In real app, this would be hashed
        role: "requester",
        department: "NTAO",
        createdAt: new Date(),
        accessibleQueues: ['ntao'],
      },
      {
        id: randomUUID(),
        username: "ENT1235",
        email: "approver@sears.com",
        password: "passwords", // In real app, this would be hashed
        role: "approver",
        department: "Assets Management",
        createdAt: new Date(),
        accessibleQueues: ['assets', 'fleet'],
      },
      {
        id: randomUUID(),
        username: "ADMIN123",
        email: "admin@sears.com",
        password: "passwords", // In real app, this would be hashed
        role: "admin",
        department: null,
        createdAt: new Date(),
        accessibleQueues: ['ntao', 'assets', 'inventory', 'fleet'],
      },
      // Additional role-specific users
      {
        id: randomUUID(),
        username: "FIELD001",
        email: "field@sears.com",
        password: "passwords", // In real app, this would be hashed
        role: "field",
        department: "NTAO",
        createdAt: new Date(),
        accessibleQueues: ['ntao'],
      },
      {
        id: randomUUID(),
        username: "AGENT001",
        email: "agent@sears.com",
        password: "passwords", // In real app, this would be hashed
        role: "agent",
        department: "Assets Management",
        createdAt: new Date(),
        accessibleQueues: ['assets'],
      },
      {
        id: randomUUID(),
        username: "INVENTORY001",
        email: "inventory@sears.com",
        password: "passwords", // In real app, this would be hashed
        role: "approver",
        department: "Inventory Control",
        createdAt: new Date(),
        accessibleQueues: ['inventory'],
      },
      {
        id: randomUUID(),
        username: "FLEET001",
        email: "fleet@sears.com",
        password: "passwords", // In real app, this would be hashed
        role: "approver",
        department: "Fleet Management",
        createdAt: new Date(),
        accessibleQueues: ['fleet'],
      },
      {
        id: randomUUID(),
        username: "SUPER001",
        email: "superadmin@sears.com",
        password: "passwords", // In real app, this would be hashed
        role: "superadmin",
        department: null,
        createdAt: new Date(),
        accessibleQueues: ['ntao', 'assets', 'inventory', 'fleet'],
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
        department: "NTAO",
        data: JSON.stringify({
          submitter: {
            name: "FIELD001",
            submittedAt: new Date().toISOString()
          },
          employee: {
            firstName: "John",
            lastName: "Smith",
            enterpriseId: "ENT12345",
            department: "Field Services",
            startDate: "2024-01-15",
            region: "Midwest",
            district: "Chicago",
            primarySpecialty: "HVAC Systems",
            secondarySpecialty: "Electrical",
            tertiarySpecialty: "Appliance Repair"
          },
          vehicleAssignment: {
            vehicleNumber: "SV-2341",
            makeModel: "2023 Ford Transit",
            region: "Midwest"
          },
          supplyOrders: {
            assetsSupplies: true,
            ntaoPartsStock: true
          },
          requestsCreated: ["Vehicle Assignment", "Tool Kit Setup", "Safety Training"]
        }),
        metadata: null,
        notes: null,
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
        department: "Fleet Management",
        data: JSON.stringify({
          submitter: {
            name: "AGENT001",
            submittedAt: new Date().toISOString()
          },
          employee: {
            name: "Sarah Johnson",
            enterpriseId: "T12345",
            specialties: ["HVAC", "Electrical", "Appliance Repair"]
          },
          vehicle: {
            year: "2023",
            make: "Ford",
            model: "Transit Van",
            licensePlate: "SV-1234",
            vin: "1FTBW2CM5NKA12345",
            location: "Chicago Service Center"
          },
          supplyOrders: {
            assetsSupplies: true,
            ntaoPartsStock: false
          },
          orderMessages: ["Vehicle assignment for route coverage", "Complete safety inspection required"]
        }),
        metadata: null,
        notes: null,
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
        department: "Assets Management",
        data: JSON.stringify({
          submitter: {
            name: "SUPER001",
            submittedAt: new Date().toISOString()
          },
          employee: {
            racfId: "mwilson",
            name: "Mike Wilson",
            enterpriseId: "T67890",
            lastDayWorked: "2024-01-30",
            departments: ["Field Services", "NTAO", "Fleet Management"]
          },
          vehicle: {
            vehicleNumber: "SV-4891",
            reason: "Employee Departure - Resignation"
          },
          notifications: {
            departments: ["NTAO", "Assets", "Inventory", "Fleet"],
            timestamp: new Date().toISOString()
          }
        }),
        metadata: null,
        notes: null,
        scheduledFor: null,
        attempts: 0,
        lastError: null,
        completedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    ];

    // Distribute sample items across separate queue modules based on department
    sampleQueueItems.forEach(item => {
      switch (item.department) {
        case "NTAO":
          this.ntaoQueueItems.set(item.id, item);
          break;
        case "Assets Management":
          this.assetsQueueItems.set(item.id, item);
          break;
        case "Inventory Control":
          this.inventoryQueueItems.set(item.id, item);
          break;
        case "Fleet Management":
          this.fleetQueueItems.set(item.id, item);
          break;
        default:
          // Default to NTAO queue if no department specified
          this.ntaoQueueItems.set(item.id, item);
          break;
      }
    });

    // Create sample storage spots
    const sampleStorageSpots: StorageSpot[] = [
      {
        id: randomUUID(),
        name: "Downtown Service Center",
        address: "123 Main Street",
        city: "Chicago",
        state: "IL",
        zipCode: "60601",
        status: "open",
        availableSpots: 15,
        totalCapacity: 20,
        notes: "Primary metropolitan storage facility with 24/7 access",
        contactInfo: "Manager: John Smith - (312) 555-0123",
        operatingHours: "24/7",
        facilityType: "indoor",
        securityLevel: "high",
        accessInstructions: "Use keycard at main entrance. Building secured with cameras and on-site security.",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: randomUUID(),
        name: "Suburban Depot A",
        address: "4567 Industrial Blvd",
        city: "Schaumburg", 
        state: "IL",
        zipCode: "60173",
        status: "open",
        availableSpots: 8,
        totalCapacity: 12,
        notes: "Covered outdoor storage with good highway access",
        contactInfo: "Site Supervisor: Sarah Johnson - (847) 555-0456",
        operatingHours: "6:00 AM - 10:00 PM",
        facilityType: "covered",
        securityLevel: "standard",
        accessInstructions: "Gate code: 1234. Park in designated numbered spots.",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: randomUUID(),
        name: "North Shore Storage",
        address: "890 Lakefront Drive",
        city: "Evanston",
        state: "IL", 
        zipCode: "60201",
        status: "maintenance",
        availableSpots: 0,
        totalCapacity: 8,
        notes: "Temporarily closed for fence repair and lot resurfacing",
        contactInfo: "Maintenance Coordinator: Mike Wilson - (224) 555-0789",
        operatingHours: "Currently Closed",
        facilityType: "outdoor",
        securityLevel: "basic",
        accessInstructions: "FACILITY CLOSED - Expected reopening: Next Tuesday",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: randomUUID(),
        name: "West Side Logistics Hub",
        address: "2345 Warehouse Road",
        city: "Cicero",
        state: "IL",
        zipCode: "60804",
        status: "open",
        availableSpots: 22,
        totalCapacity: 30,
        notes: "Large capacity facility with loading docks and equipment storage",
        contactInfo: "Hub Manager: Lisa Chen - (708) 555-0321",
        operatingHours: "5:00 AM - 11:00 PM",
        facilityType: "indoor",
        securityLevel: "high",
        accessInstructions: "Report to main office first. Escort required for vehicle placement.",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: randomUUID(),
        name: "Emergency Overflow Lot",
        address: "7890 Overflow Way",
        city: "Oak Brook",
        state: "IL",
        zipCode: "60523",
        status: "closed",
        availableSpots: 0,
        totalCapacity: 15,
        notes: "Reserve storage for peak season overflow - currently not in use",
        contactInfo: "Regional Manager: David Brown - (630) 555-0654",
        operatingHours: "By appointment only",
        facilityType: "outdoor",
        securityLevel: "basic",
        accessInstructions: "Contact regional manager for access approval",
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    ];

    sampleStorageSpots.forEach(spot => this.storageSpots.set(spot.id, spot));
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

  async getUsers(): Promise<User[]> {
    return Array.from(this.users.values());
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { 
      ...insertUser,
      role: insertUser.role || "field",
      department: insertUser.department || null,
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

  async deleteUser(id: string): Promise<boolean> {
    return this.users.delete(id);
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
    onboarding: { pending: number; inProgress: number; completed: number };
    vehicleAssignment: { pending: number; inProgress: number; completed: number };
    offboarding: { pending: number; inProgress: number; completed: number };
    activeUsers: number;
  }> {
    // Combine all queue items from separate modules
    const allQueueItems = [
      ...Array.from(this.ntaoQueueItems.values()),
      ...Array.from(this.assetsQueueItems.values()),
      ...Array.from(this.inventoryQueueItems.values()),
      ...Array.from(this.fleetQueueItems.values())
    ];
    
    const getWorkflowStats = (workflowType: string) => {
      const items = allQueueItems.filter(item => item.workflowType === workflowType);
      return {
        pending: items.filter(item => item.status === "pending").length,
        inProgress: items.filter(item => item.status === "in_progress").length,
        completed: items.filter(item => item.status === "completed").length,
      };
    };
    
    const activeUsers = this.users.size;

    return {
      onboarding: getWorkflowStats("onboarding"),
      vehicleAssignment: getWorkflowStats("vehicle_assignment"),
      offboarding: getWorkflowStats("offboarding"),
      activeUsers,
    };
  }

  // NTAO Queue Module
  async getNTAOQueueItem(id: string): Promise<QueueItem | undefined> {
    return this.ntaoQueueItems.get(id);
  }

  async getNTAOQueueItems(): Promise<QueueItem[]> {
    return Array.from(this.ntaoQueueItems.values()).sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async createNTAOQueueItem(insertItem: InsertQueueItem): Promise<QueueItem> {
    const id = randomUUID();
    const item: QueueItem = {
      ...insertItem,
      status: insertItem.status || "pending",
      priority: insertItem.priority || "medium",
      assignedTo: insertItem.assignedTo || null,
      department: "NTAO",
      data: insertItem.data || null,
      metadata: insertItem.metadata || null,
      notes: insertItem.notes || null,
      scheduledFor: insertItem.scheduledFor || null,
      attempts: insertItem.attempts || 0,
      lastError: insertItem.lastError || null,
      completedAt: insertItem.completedAt || null,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.ntaoQueueItems.set(id, item);
    return item;
  }

  async updateNTAOQueueItem(id: string, updates: Partial<QueueItem>): Promise<QueueItem | undefined> {
    const item = this.ntaoQueueItems.get(id);
    if (!item) return undefined;
    
    const updatedItem = { ...item, ...updates, updatedAt: new Date() };
    this.ntaoQueueItems.set(id, updatedItem);
    return updatedItem;
  }

  async assignNTAOQueueItem(id: string, assigneeId: string): Promise<QueueItem | undefined> {
    const item = this.ntaoQueueItems.get(id);
    if (!item) return undefined;
    
    const updatedItem = { 
      ...item, 
      assignedTo: assigneeId,
      status: "pending", // Keep as pending when assigned
      updatedAt: new Date() 
    };
    this.ntaoQueueItems.set(id, updatedItem);
    return updatedItem;
  }

  async startWorkNTAOQueueItem(id: string, workerId: string): Promise<QueueItem | undefined> {
    const item = this.ntaoQueueItems.get(id);
    if (!item) return undefined;
    
    // Only allow starting work if item is pending and assigned to the worker
    if (item.status !== "pending" || item.assignedTo !== workerId) {
      return undefined;
    }
    
    const updatedItem = { 
      ...item, 
      status: "in_progress",
      updatedAt: new Date() 
    };
    this.ntaoQueueItems.set(id, updatedItem);
    return updatedItem;
  }

  async completeNTAOQueueItem(id: string, completedBy: string): Promise<QueueItem | undefined> {
    const item = this.ntaoQueueItems.get(id);
    if (!item) return undefined;
    
    const updatedItem = { 
      ...item, 
      status: "completed",
      completedAt: new Date(),
      updatedAt: new Date() 
    };
    this.ntaoQueueItems.set(id, updatedItem);

    // Check if this completes a workflow step and trigger next step
    await this.triggerNextWorkflowStep(updatedItem);
    
    return updatedItem;
  }

  // Assets Queue Module
  async getAssetsQueueItem(id: string): Promise<QueueItem | undefined> {
    return this.assetsQueueItems.get(id);
  }

  async getAssetsQueueItems(): Promise<QueueItem[]> {
    return Array.from(this.assetsQueueItems.values()).sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async createAssetsQueueItem(insertItem: InsertQueueItem): Promise<QueueItem> {
    const id = randomUUID();
    const item: QueueItem = {
      ...insertItem,
      status: insertItem.status || "pending",
      priority: insertItem.priority || "medium",
      assignedTo: insertItem.assignedTo || null,
      department: "Assets Management",
      data: insertItem.data || null,
      metadata: insertItem.metadata || null,
      notes: insertItem.notes || null,
      scheduledFor: insertItem.scheduledFor || null,
      attempts: insertItem.attempts || 0,
      lastError: insertItem.lastError || null,
      completedAt: insertItem.completedAt || null,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.assetsQueueItems.set(id, item);
    return item;
  }

  async updateAssetsQueueItem(id: string, updates: Partial<QueueItem>): Promise<QueueItem | undefined> {
    const item = this.assetsQueueItems.get(id);
    if (!item) return undefined;
    
    const updatedItem = { ...item, ...updates, updatedAt: new Date() };
    this.assetsQueueItems.set(id, updatedItem);
    return updatedItem;
  }

  async assignAssetsQueueItem(id: string, assigneeId: string): Promise<QueueItem | undefined> {
    const item = this.assetsQueueItems.get(id);
    if (!item) return undefined;
    
    const updatedItem = { 
      ...item, 
      assignedTo: assigneeId,
      status: "pending", // Keep as pending when assigned
      updatedAt: new Date() 
    };
    this.assetsQueueItems.set(id, updatedItem);
    return updatedItem;
  }

  async startWorkAssetsQueueItem(id: string, workerId: string): Promise<QueueItem | undefined> {
    const item = this.assetsQueueItems.get(id);
    if (!item) return undefined;
    
    // Only allow starting work if item is pending and assigned to the worker
    if (item.status !== "pending" || item.assignedTo !== workerId) {
      return undefined;
    }
    
    const updatedItem = { 
      ...item, 
      status: "in_progress",
      updatedAt: new Date() 
    };
    this.assetsQueueItems.set(id, updatedItem);
    return updatedItem;
  }

  async completeAssetsQueueItem(id: string, completedBy: string): Promise<QueueItem | undefined> {
    const item = this.assetsQueueItems.get(id);
    if (!item) return undefined;
    
    const updatedItem = { 
      ...item, 
      status: "completed",
      completedAt: new Date(),
      updatedAt: new Date() 
    };
    this.assetsQueueItems.set(id, updatedItem);

    // Check if this completes a workflow step and trigger next step
    await this.triggerNextWorkflowStep(updatedItem);
    
    return updatedItem;
  }

  // Inventory Queue Module
  async getInventoryQueueItem(id: string): Promise<QueueItem | undefined> {
    return this.inventoryQueueItems.get(id);
  }

  async getInventoryQueueItems(): Promise<QueueItem[]> {
    return Array.from(this.inventoryQueueItems.values()).sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async createInventoryQueueItem(insertItem: InsertQueueItem): Promise<QueueItem> {
    const id = randomUUID();
    const item: QueueItem = {
      ...insertItem,
      status: insertItem.status || "pending",
      priority: insertItem.priority || "medium",
      assignedTo: insertItem.assignedTo || null,
      department: "Inventory Control",
      data: insertItem.data || null,
      metadata: insertItem.metadata || null,
      notes: insertItem.notes || null,
      scheduledFor: insertItem.scheduledFor || null,
      attempts: insertItem.attempts || 0,
      lastError: insertItem.lastError || null,
      completedAt: insertItem.completedAt || null,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.inventoryQueueItems.set(id, item);
    return item;
  }

  async updateInventoryQueueItem(id: string, updates: Partial<QueueItem>): Promise<QueueItem | undefined> {
    const item = this.inventoryQueueItems.get(id);
    if (!item) return undefined;
    
    const updatedItem = { ...item, ...updates, updatedAt: new Date() };
    this.inventoryQueueItems.set(id, updatedItem);
    return updatedItem;
  }

  async assignInventoryQueueItem(id: string, assigneeId: string): Promise<QueueItem | undefined> {
    const item = this.inventoryQueueItems.get(id);
    if (!item) return undefined;
    
    const updatedItem = { 
      ...item, 
      assignedTo: assigneeId,
      status: "pending", // Keep as pending when assigned
      updatedAt: new Date() 
    };
    this.inventoryQueueItems.set(id, updatedItem);
    return updatedItem;
  }

  async startWorkInventoryQueueItem(id: string, workerId: string): Promise<QueueItem | undefined> {
    const item = this.inventoryQueueItems.get(id);
    if (!item) return undefined;
    
    // Only allow starting work if item is pending and assigned to the worker
    if (item.status !== "pending" || item.assignedTo !== workerId) {
      return undefined;
    }
    
    const updatedItem = { 
      ...item, 
      status: "in_progress",
      updatedAt: new Date() 
    };
    this.inventoryQueueItems.set(id, updatedItem);
    return updatedItem;
  }

  async completeInventoryQueueItem(id: string, completedBy: string): Promise<QueueItem | undefined> {
    const item = this.inventoryQueueItems.get(id);
    if (!item) return undefined;
    
    const updatedItem = { 
      ...item, 
      status: "completed",
      completedAt: new Date(),
      updatedAt: new Date() 
    };
    this.inventoryQueueItems.set(id, updatedItem);

    // Check if this completes a workflow step and trigger next step
    await this.triggerNextWorkflowStep(updatedItem);
    
    return updatedItem;
  }

  // Fleet Queue Module
  async getFleetQueueItem(id: string): Promise<QueueItem | undefined> {
    return this.fleetQueueItems.get(id);
  }

  async getFleetQueueItems(): Promise<QueueItem[]> {
    return Array.from(this.fleetQueueItems.values()).sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async createFleetQueueItem(insertItem: InsertQueueItem): Promise<QueueItem> {
    const id = randomUUID();
    const item: QueueItem = {
      ...insertItem,
      status: insertItem.status || "pending",
      priority: insertItem.priority || "medium",
      assignedTo: insertItem.assignedTo || null,
      department: "Fleet Management",
      data: insertItem.data || null,
      metadata: insertItem.metadata || null,
      notes: insertItem.notes || null,
      scheduledFor: insertItem.scheduledFor || null,
      attempts: insertItem.attempts || 0,
      lastError: insertItem.lastError || null,
      completedAt: insertItem.completedAt || null,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.fleetQueueItems.set(id, item);
    return item;
  }

  async updateFleetQueueItem(id: string, updates: Partial<QueueItem>): Promise<QueueItem | undefined> {
    const item = this.fleetQueueItems.get(id);
    if (!item) return undefined;
    
    const updatedItem = { ...item, ...updates, updatedAt: new Date() };
    this.fleetQueueItems.set(id, updatedItem);
    return updatedItem;
  }

  async assignFleetQueueItem(id: string, assigneeId: string): Promise<QueueItem | undefined> {
    const item = this.fleetQueueItems.get(id);
    if (!item) return undefined;
    
    const updatedItem = { 
      ...item, 
      assignedTo: assigneeId,
      status: "pending", // Keep as pending when assigned
      updatedAt: new Date() 
    };
    this.fleetQueueItems.set(id, updatedItem);
    return updatedItem;
  }

  async startWorkFleetQueueItem(id: string, workerId: string): Promise<QueueItem | undefined> {
    const item = this.fleetQueueItems.get(id);
    if (!item) return undefined;
    
    // Only allow starting work if item is pending and assigned to the worker
    if (item.status !== "pending" || item.assignedTo !== workerId) {
      return undefined;
    }
    
    const updatedItem = { 
      ...item, 
      status: "in_progress",
      updatedAt: new Date() 
    };
    this.fleetQueueItems.set(id, updatedItem);
    return updatedItem;
  }

  async completeFleetQueueItem(id: string, completedBy: string): Promise<QueueItem | undefined> {
    const item = this.fleetQueueItems.get(id);
    if (!item) return undefined;
    
    const updatedItem = { 
      ...item, 
      status: "completed",
      completedAt: new Date(),
      updatedAt: new Date() 
    };
    this.fleetQueueItems.set(id, updatedItem);

    // Check if this completes a workflow step and trigger next step
    await this.triggerNextWorkflowStep(updatedItem);
    
    return updatedItem;
  }


  // Workflow automation function - triggers next step in sequential workflows
  async triggerNextWorkflowStep(completedItem: QueueItem): Promise<void> {
    // Only proceed if this item is part of a workflow
    if (!completedItem.workflowId || !completedItem.workflowStep) return;

    try {
      const triggerData = completedItem.triggerData ? JSON.parse(completedItem.triggerData) : null;
      if (!triggerData) return;

      // Check for Fleet Management completion (step 3) to trigger final tasks
      // Steps 1 (NTAO), 2 (Assets), and 3 (Fleet) run in parallel
      // Only Fleet completion triggers the final combined Inventory/Assets task
      if (completedItem.workflowStep === 3 && completedItem.department === "Fleet Management") {
        
        // Check for existing final tasks to prevent duplicates
        const existingInventoryTasks = await this.getInventoryQueueItems();
        const existingAssetsTasks = await this.getAssetsQueueItems();
        
        const duplicateInventoryTask = existingInventoryTasks.find(task => 
          task.workflowId === completedItem.workflowId && 
          task.workflowStep === 4 && 
          task.data?.includes("combined_parts_count")
        );
        
        const duplicateAssetsTask = existingAssetsTasks.find(task => 
          task.workflowId === completedItem.workflowId && 
          task.workflowStep === 4 && 
          task.data?.includes("assist_parts_count")
        );

        if (duplicateInventoryTask || duplicateAssetsTask) {
          console.log(`Final workflow tasks already exist for workflow ${completedItem.workflowId}`);
          return;
        }
        
        // Create combined Inventory & Assets task for full parts count
        const inventoryTask = {
          workflowType: "offboarding",
          title: `Full Parts and Tools Count - ${triggerData.vehicle.vehicleNumber}`,
          description: `Perform full inventory count of parts and tools in van ${triggerData.vehicle.vehicleNumber} at central location/shop. Employee: ${triggerData.employee.name} (${triggerData.employee.racfId}). Complete audit before van reassignment. Both Inventory Control and Assets Management teams should collaborate on this task.`,
          priority: "medium",
          requesterId: "system",
          department: "Inventory Control", // Primary department, but Assets should also participate
          workflowId: completedItem.workflowId,
          workflowStep: 4,
          dependsOn: completedItem.id,
          autoTrigger: true,
          data: JSON.stringify({
            workflowType: "offboarding_sequence",
            step: "combined_parts_count",
            employee: triggerData.employee,
            vehicle: triggerData.vehicle,
            submitter: triggerData.submitter,
            departments: ["Inventory Control", "Assets Management"], // Both departments involved
            instructions: [
              "Access van at central location/shop (fleet has moved it)",
              "Coordinate with Assets Management team for joint count",
              "Perform complete inventory count of all parts",
              "Count and verify all tools and equipment",
              "Check all items against original manifest",
              "Document any missing, damaged, or extra items",
              "Update both inventory and asset management systems",
              "Mark task complete when full count finished"
            ],
            finalStep: true // This is the last step in the workflow
          }),
          triggerData: null // Final step doesn't need to trigger anything else
        };
        
        const assetsNotificationTask = {
          workflowType: "offboarding",
          title: `Assist with Parts Count - ${triggerData.vehicle.vehicleNumber}`,
          description: `Assist Inventory Control with full parts and tools count for van ${triggerData.vehicle.vehicleNumber} at central location/shop. Employee: ${triggerData.employee.name} (${triggerData.employee.racfId}). Coordinate with Inventory team for complete audit.`,
          priority: "medium",
          requesterId: "system",
          department: "Assets Management",
          workflowId: completedItem.workflowId,
          workflowStep: 4,
          dependsOn: completedItem.id,
          autoTrigger: true,
          data: JSON.stringify({
            workflowType: "offboarding_sequence",
            step: "assist_parts_count",
            employee: triggerData.employee,
            vehicle: triggerData.vehicle,
            submitter: triggerData.submitter,
            primaryDepartment: "Inventory Control",
            instructions: [
              "Coordinate with Inventory Control team",
              "Assist with asset identification and counting",
              "Focus on company-owned equipment and tools",
              "Verify serial numbers for tracked assets",
              "Update asset management records",
              "Support completion of joint inventory audit"
            ],
            finalStep: true
          }),
          triggerData: null
        };

        // Create both final tasks
        await this.createInventoryQueueItem(inventoryTask as any);
        await this.createAssetsQueueItem(assetsNotificationTask as any);
        
        console.log(`Auto-triggered step 4 workflow tasks for workflow ${completedItem.workflowId}: Inventory Control + Assets Management`);
      } 
      
      // Check if both Inventory Control and Assets Management step 4 tasks are completed to trigger final Fleet task
      else if (completedItem.workflowStep === 4 && 
               (completedItem.department === "Inventory Control" || completedItem.department === "Assets Management")) {
        
        // Get all tasks for this workflow at step 4
        const allInventoryTasks = await this.getInventoryQueueItems();
        const allAssetsTasks = await this.getAssetsQueueItems();
        
        const inventoryStep4Task = allInventoryTasks.find(task => 
          task.workflowId === completedItem.workflowId && 
          task.workflowStep === 4 && 
          task.data?.includes("combined_parts_count")
        );
        
        const assetsStep4Task = allAssetsTasks.find(task => 
          task.workflowId === completedItem.workflowId && 
          task.workflowStep === 4 && 
          task.data?.includes("assist_parts_count")
        );

        // Check if BOTH step 4 tasks are completed
        const bothTasksCompleted = inventoryStep4Task?.status === "completed" && 
                                   assetsStep4Task?.status === "completed";

        if (bothTasksCompleted) {
          // Check for existing final Fleet task to prevent duplicates
          const existingFleetTasks = await this.getFleetQueueItems();
          const duplicateFleetTask = existingFleetTasks.find(task => 
            task.workflowId === completedItem.workflowId && 
            task.workflowStep === 5 && 
            task.data?.includes("vehicle_readiness")
          );

          if (!duplicateFleetTask) {
            // Create final Fleet task for vehicle readiness verification
            const finalFleetTask = {
              workflowType: "offboarding",
              title: `Vehicle Readiness Verification - ${triggerData.vehicle.vehicleNumber}`,
              description: `Verify van ${triggerData.vehicle.vehicleNumber} is prepped and ready for assignment. Parts count completed by Inventory and Assets teams. Complete final readiness checklist and mark as ready for assignment.`,
              priority: "medium",
              requesterId: "system",
              department: "Fleet Management",
              workflowId: completedItem.workflowId,
              workflowStep: 5,
              dependsOn: completedItem.id,
              autoTrigger: true,
              data: JSON.stringify({
                workflowType: "offboarding_sequence",
                step: "vehicle_readiness",
                employee: triggerData.employee,
                vehicle: triggerData.vehicle,
                submitter: triggerData.submitter,
                partsCountCompleted: true,
                checklist: [
                  "Clean vehicle interior and exterior",
                  "Assess condition of truck, all equipment", 
                  "Identify items requiring repair, replacement, or reassignment",
                  "Verify all parts and tools are properly organized",
                  "Confirm vehicle is operationally ready",
                  "Update fleet management system status",
                  "Mark vehicle as ready for assignment"
                ],
                finalStep: true // This is the last step in the workflow
              }),
              triggerData: null
            };

            await this.createFleetQueueItem(finalFleetTask as any);
            console.log(`Auto-triggered final Fleet readiness task for workflow ${completedItem.workflowId}`);
          }
        } else {
          console.log(`Step 4 task completed for workflow ${completedItem.workflowId}, waiting for other step 4 task to complete`);
        }
      } else {
        // No more steps to trigger for other completed tasks
        console.log(`Workflow task completed: ${completedItem.workflowId} step ${completedItem.workflowStep} (${completedItem.department})`);
      }
    } catch (error) {
      console.error('Error triggering next workflow step:', error);
    }
  }

  async cancelQueueItem(id: string, reason: string): Promise<QueueItem | undefined> {
    // Search across all queue modules to find the item
    const allMaps = [
      this.ntaoQueueItems,
      this.assetsQueueItems,
      this.inventoryQueueItems,
      this.fleetQueueItems
    ];
    
    for (const queueMap of allMaps) {
      const item = queueMap.get(id);
      if (item) {
        const updatedItem = { 
          ...item, 
          status: "cancelled",
          lastError: reason,
          updatedAt: new Date() 
        };
        queueMap.set(id, updatedItem);
        return updatedItem;
      }
    }
    
    return undefined;
  }

  // Unified Queue Aggregator Implementation
  async getUnifiedQueueItems(modules: QueueModule[], status?: string): Promise<CombinedQueueItem[]> {
    const combinedItems: CombinedQueueItem[] = [];
    
    for (const module of modules) {
      let items: QueueItem[] = [];
      
      switch (module) {
        case 'ntao':
          items = await this.getNTAOQueueItems();
          break;
        case 'assets':
          items = await this.getAssetsQueueItems();
          break;
        case 'inventory':
          items = await this.getInventoryQueueItems();
          break;
        case 'fleet':
          items = await this.getFleetQueueItems();
          break;
      }
      
      // Show all tasks for the department
      
      // Add module annotation and filter by status if provided
      items.forEach(item => {
        if (!status || item.status === status) {
          combinedItems.push({ ...item, module });
        }
      });
    }
    
    // Sort by createdAt descending (newest first)
    return combinedItems.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
  
  async getUnifiedQueueStats(modules: QueueModule[]): Promise<{
    pending: number;
    in_progress: number; 
    completed: number;
    total: number;
  }> {
    const allItems = await this.getUnifiedQueueItems(modules);
    
    const stats = {
      pending: allItems.filter(item => item.status === 'pending').length,
      in_progress: allItems.filter(item => item.status === 'in_progress').length,
      completed: allItems.filter(item => item.status === 'completed').length,
      total: allItems.length
    };
    
    return stats;
  }
  
  async assignUnifiedQueueItem(module: QueueModule, id: string, assigneeId: string): Promise<QueueItem | undefined> {
    switch (module) {
      case 'ntao':
        return this.assignNTAOQueueItem(id, assigneeId);
      case 'assets':
        return this.assignAssetsQueueItem(id, assigneeId);
      case 'inventory':
        return this.assignInventoryQueueItem(id, assigneeId);
      case 'fleet':
        return this.assignFleetQueueItem(id, assigneeId);
      default:
        return undefined;
    }
  }
  
  async startWorkUnifiedQueueItem(module: QueueModule, id: string, workerId: string): Promise<QueueItem | undefined> {
    switch (module) {
      case 'ntao':
        return this.startWorkNTAOQueueItem(id, workerId);
      case 'assets':
        return this.startWorkAssetsQueueItem(id, workerId);
      case 'inventory':
        return this.startWorkInventoryQueueItem(id, workerId);
      case 'fleet':
        return this.startWorkFleetQueueItem(id, workerId);
      default:
        return undefined;
    }
  }
  
  async completeUnifiedQueueItem(module: QueueModule, id: string, completedBy: string): Promise<QueueItem | undefined> {
    switch (module) {
      case 'ntao':
        return this.completeNTAOQueueItem(id, completedBy);
      case 'assets':
        return this.completeAssetsQueueItem(id, completedBy);
      case 'inventory':
        return this.completeInventoryQueueItem(id, completedBy);
      case 'fleet':
        return this.completeFleetQueueItem(id, completedBy);
      default:
        return undefined;
    }
  }

  async getUnifiedQueueItem(module: QueueModule, id: string): Promise<QueueItem | undefined> {
    switch (module) {
      case 'ntao':
        return this.getNTAOQueueItem(id);
      case 'assets':
        return this.getAssetsQueueItem(id);
      case 'inventory':
        return this.getInventoryQueueItem(id);
      case 'fleet':
        return this.getFleetQueueItem(id);
      default:
        return undefined;
    }
  }

  async updateUnifiedQueueItem(module: QueueModule, id: string, updates: Partial<QueueItem>): Promise<QueueItem | undefined> {
    switch (module) {
      case 'ntao':
        return this.updateNTAOQueueItem(id, updates);
      case 'assets':
        return this.updateAssetsQueueItem(id, updates);
      case 'inventory':
        return this.updateInventoryQueueItem(id, updates);
      case 'fleet':
        return this.updateFleetQueueItem(id, updates);
      default:
        return undefined;
    }
  }

  // Storage Spots Module Implementation
  async getStorageSpot(id: string): Promise<StorageSpot | undefined> {
    return this.storageSpots.get(id);
  }

  async getStorageSpots(): Promise<StorageSpot[]> {
    return Array.from(this.storageSpots.values()).sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async getStorageSpotsByStatus(status: string): Promise<StorageSpot[]> {
    return Array.from(this.storageSpots.values())
      .filter(spot => spot.status === status)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async getStorageSpotsByState(state: string): Promise<StorageSpot[]> {
    return Array.from(this.storageSpots.values())
      .filter(spot => spot.state === state)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async createStorageSpot(insertStorageSpot: InsertStorageSpot): Promise<StorageSpot> {
    const id = randomUUID();
    const storageSpot: StorageSpot = {
      ...insertStorageSpot,
      status: insertStorageSpot.status || "open",
      availableSpots: insertStorageSpot.availableSpots || 0,
      facilityType: insertStorageSpot.facilityType || "outdoor",
      securityLevel: insertStorageSpot.securityLevel || "standard",
      notes: insertStorageSpot.notes || null,
      contactInfo: insertStorageSpot.contactInfo || null,
      operatingHours: insertStorageSpot.operatingHours || null,
      accessInstructions: insertStorageSpot.accessInstructions || null,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.storageSpots.set(id, storageSpot);
    return storageSpot;
  }

  async updateStorageSpot(id: string, updates: Partial<StorageSpot>): Promise<StorageSpot | undefined> {
    const storageSpot = this.storageSpots.get(id);
    if (!storageSpot) return undefined;
    
    const updatedStorageSpot = { 
      ...storageSpot, 
      ...updates, 
      updatedAt: new Date() 
    };
    this.storageSpots.set(id, updatedStorageSpot);
    return updatedStorageSpot;
  }

  async deleteStorageSpot(id: string): Promise<boolean> {
    return this.storageSpots.delete(id);
  }

  // Vehicle CRUD operations
  async getVehicle(id: string): Promise<Vehicle | undefined> {
    return this.vehicles.get(id);
  }

  async getVehicleByVin(vin: string): Promise<Vehicle | undefined> {
    return Array.from(this.vehicles.values()).find(v => v.vin === vin);
  }

  async getVehicles(): Promise<Vehicle[]> {
    return Array.from(this.vehicles.values()).sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async getVehiclesByStatus(status: string): Promise<Vehicle[]> {
    return Array.from(this.vehicles.values())
      .filter(vehicle => vehicle.status === status)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async getVehiclesByState(state: string): Promise<Vehicle[]> {
    return Array.from(this.vehicles.values())
      .filter(vehicle => vehicle.state === state)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async getVehiclesByBranding(branding: string): Promise<Vehicle[]> {
    return Array.from(this.vehicles.values())
      .filter(vehicle => vehicle.branding === branding)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async createVehicle(insertVehicle: InsertVehicle): Promise<Vehicle> {
    const id = randomUUID();
    const vehicle: Vehicle = {
      ...insertVehicle,
      status: insertVehicle.status || "available",
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.vehicles.set(id, vehicle);
    return vehicle;
  }

  async createVehicles(insertVehicles: InsertVehicle[]): Promise<Vehicle[]> {
    const createdVehicles: Vehicle[] = [];
    for (const insertVehicle of insertVehicles) {
      const vehicle = await this.createVehicle(insertVehicle);
      createdVehicles.push(vehicle);
    }
    return createdVehicles;
  }

  async updateVehicle(id: string, updates: Partial<Vehicle>): Promise<Vehicle | undefined> {
    const vehicle = this.vehicles.get(id);
    if (!vehicle) return undefined;
    
    const updatedVehicle = { 
      ...vehicle, 
      ...updates, 
      updatedAt: new Date() 
    };
    this.vehicles.set(id, updatedVehicle);
    return updatedVehicle;
  }

  async deleteVehicle(id: string): Promise<boolean> {
    return this.vehicles.delete(id);
  }
}

export const storage = new MemStorage();
