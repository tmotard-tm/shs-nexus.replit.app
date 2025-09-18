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
  users,
  requests,
  apiConfigurations,
  activityLogs,
  queueItems,
  storageSpots,
  vehicles,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, inArray, desc, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import bcrypt from "bcrypt";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

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
  
  // Generic queue item operations (searches across all modules)
  getQueueItem(id: string): Promise<QueueItem | undefined>;
  updateQueueItem(id: string, updates: Partial<QueueItem>): Promise<QueueItem | undefined>;

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
  
  // Duplicate Detection Functions
  checkOffboardingTaskDuplicates(employeeId: string, techRacfId: string, timeWindowMs?: number): Promise<{ isDuplicate: boolean; message?: string; existingTask?: QueueItem }>;
  checkByovEnrollmentDuplicates(ldap: string, email: string, currentTruckNumber: string, timeWindowMs?: number): Promise<{ isDuplicate: boolean; message?: string; existingTask?: QueueItem }>;
  getRecentQueueItemsByTimeWindow(modules: QueueModule[], timeWindowMs: number): Promise<{ module: QueueModule; items: QueueItem[] }[]>;
  findQueueItemsByDataMatch(modules: QueueModule[], searchFunction: (data: any) => boolean): Promise<{ module: QueueModule; items: QueueItem[] }[]>;
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
    
    // Load users from file first, then fallback to defaults
    this.loadUsersFromFile();
    this.initializeDefaultData();
  }

  // File I/O helper methods for user persistence
  private readonly usersFilePath = join(process.cwd(), 'users.json');

  private loadUsersFromFile(): void {
    try {
      if (existsSync(this.usersFilePath)) {
        const fileContent = readFileSync(this.usersFilePath, 'utf-8');
        const userData = JSON.parse(fileContent);
        
        // Convert array back to Map with proper date objects
        if (Array.isArray(userData)) {
          userData.forEach((user: any) => {
            // Restore Date objects
            if (user.createdAt) user.createdAt = new Date(user.createdAt);
            this.users.set(user.id, user);
          });
          console.log(`Loaded ${userData.length} users from ${this.usersFilePath}`);
        }
      }
    } catch (error) {
      console.error('Failed to load users from file, will use defaults:', error);
      // Clear corrupted data and let defaults be loaded
      this.users.clear();
    }
  }

  private saveUsersToFile(): void {
    try {
      // Convert Map to array for JSON serialization
      const usersArray = Array.from(this.users.values());
      writeFileSync(this.usersFilePath, JSON.stringify(usersArray, null, 2), 'utf-8');
      console.log(`Saved ${usersArray.length} users to ${this.usersFilePath}`);
    } catch (error) {
      console.error('Failed to save users to file:', error);
    }
  }

  private async initializeDefaultData() {
    // Create Enterprise ID users with new role system
    const enterpriseUsers: User[] = [
      // EMERGENCY LOGIN - Use this account if other users can't login due to password requirements
      {
        id: "emergency-admin-2025-id",
        username: "emergency-admin",
        email: "emergency@sears.com",
        password: bcrypt.hashSync("emergency-admin-2025-login!", 10),
        role: "superadmin",
        department: null,
        departmentAccess: ['NTAO', 'ASSETS', 'INVENTORY', 'FLEET'],
        createdAt: new Date(),
      },
      // Demo users matching login page credentials
      {
        id: randomUUID(),
        username: "ENT1234",
        email: "requester@sears.com",
        password: bcrypt.hashSync("passwords", 10),
        role: "requester",
        department: "NTAO",
        departmentAccess: ['NTAO'],
        createdAt: new Date(),
      },
      {
        id: randomUUID(),
        username: "ENT1235",
        email: "approver@sears.com",
        password: bcrypt.hashSync("passwords", 10),
        role: "approver",
        department: "Assets Management",
        departmentAccess: ['ASSETS', 'FLEET'],
        createdAt: new Date(),
      },
      {
        id: randomUUID(),
        username: "ADMIN123",
        email: "admin@sears.com",
        password: bcrypt.hashSync("passwords", 10),
        role: "superadmin",
        department: null,
        departmentAccess: ['NTAO', 'ASSETS', 'INVENTORY', 'FLEET'],
        createdAt: new Date(),
      },
      // Additional role-specific users
      {
        id: randomUUID(),
        username: "FIELD001",
        email: "field@sears.com",
        password: bcrypt.hashSync("passwords", 10),
        role: "field",
        department: "NTAO",
        departmentAccess: ['NTAO'],
        createdAt: new Date(),
      },
      {
        id: randomUUID(),
        username: "AGENT001",
        email: "agent@sears.com",
        password: bcrypt.hashSync("passwords", 10),
        role: "agent",
        department: "Assets Management",
        departmentAccess: ['ASSETS'],
        createdAt: new Date(),
      },
      {
        id: randomUUID(),
        username: "INVENTORY001",
        email: "inventory@sears.com",
        password: bcrypt.hashSync("passwords", 10),
        role: "approver",
        department: "Inventory Control",
        departmentAccess: ['INVENTORY'],
        createdAt: new Date(),
      },
      {
        id: randomUUID(),
        username: "FLEET001",
        email: "fleet@sears.com",
        password: bcrypt.hashSync("passwords", 10),
        role: "approver",
        department: "Fleet Management",
        departmentAccess: ['FLEET'],
        createdAt: new Date(),
      },
      {
        id: "2d5bcbc2-12bb-4ab3-9996-8b65cab409c8", // Fixed UUID for SUPER001 to maintain session consistency
        username: "SUPER001",
        email: "superadmin@sears.com",
        password: bcrypt.hashSync("passwords", 10),
        role: "superadmin",
        department: null,
        departmentAccess: ['NTAO', 'ASSETS', 'INVENTORY', 'FLEET'],
        createdAt: new Date(),
      },
      // Assets department employees
      {
        id: randomUUID(),
        username: "bob.banfill",
        email: "bob.banfill@sears.com",
        password: bcrypt.hashSync("passwords", 10),
        role: "agent",
        department: "Assets Management",
        departmentAccess: ['ASSETS'],
        createdAt: new Date(),
      },
      {
        id: randomUUID(),
        username: "claudia.dominguez",
        email: "claudia.dominguez@sears.com",
        password: bcrypt.hashSync("passwords", 10),
        role: "agent",
        department: "Assets Management",
        departmentAccess: ['ASSETS'],
        createdAt: new Date(),
      },
      {
        id: randomUUID(),
        username: "monica.jenkins",
        email: "monica.jenkins@sears.com",
        password: bcrypt.hashSync("passwords", 10),
        role: "agent",
        department: "Assets Management",
        departmentAccess: ['ASSETS'],
        createdAt: new Date(),
      },
      // Inventory department employees
      {
        id: randomUUID(),
        username: "jennifer.dyer",
        email: "jennifer.dyer@sears.com",
        password: bcrypt.hashSync("passwords", 10),
        role: "agent",
        department: "Inventory Control",
        departmentAccess: ['INVENTORY'],
        createdAt: new Date(),
      },
      {
        id: randomUUID(),
        username: "andrea.catapano",
        email: "andrea.catapano@sears.com",
        password: bcrypt.hashSync("passwords", 10),
        role: "agent",
        department: "Inventory Control",
        departmentAccess: ['INVENTORY'],
        createdAt: new Date(),
      },
      {
        id: randomUUID(),
        username: "tashsa.corenevsky",
        email: "tashsa.corenevsky@sears.com",
        password: bcrypt.hashSync("passwords", 10),
        role: "agent",
        department: "Inventory Control",
        departmentAccess: ['INVENTORY'],
        createdAt: new Date(),
      },
      // Fleet department employees
      {
        id: randomUUID(),
        username: "cheryl.groce",
        email: "cheryl.groce@sears.com",
        password: bcrypt.hashSync("passwords", 10),
        role: "agent",
        department: "Fleet Management",
        departmentAccess: ['FLEET'],
        createdAt: new Date(),
      },
      {
        id: randomUUID(),
        username: "robert.delgaldo",
        email: "robert.delgaldo@sears.com",
        password: bcrypt.hashSync("passwords", 10),
        role: "agent",
        department: "Fleet Management",
        departmentAccess: ['FLEET'],
        createdAt: new Date(),
      },
      {
        id: randomUUID(),
        username: "carol.collins",
        email: "carol.collins@sears.com",
        password: bcrypt.hashSync("passwords", 10),
        role: "agent",
        department: "Fleet Management",
        departmentAccess: ['FLEET'],
        createdAt: new Date(),
      },
      // NTAO department employees
      {
        id: randomUUID(),
        username: "goutami.walsang",
        email: "goutami.walsang@sears.com",
        password: bcrypt.hashSync("passwords", 10),
        role: "agent",
        department: "NTAO",
        departmentAccess: ['NTAO'],
        createdAt: new Date(),
      },
      {
        id: randomUUID(),
        username: "oscar.santana",
        email: "oscar.santana@sears.com",
        password: bcrypt.hashSync("passwords", 10),
        role: "agent",
        department: "NTAO",
        departmentAccess: ['NTAO'],
        createdAt: new Date(),
      },
    ];
    
    // Add anonymous user for anonymous form submissions
    const anonymousUser: User = {
      id: "anonymous",
      username: "anonymous",
      email: "anonymous@system.com",
      password: "no-password", // Cannot be used for login
      role: "field", // Minimal permissions
      department: null,
      departmentAccess: [], // No queue access for anonymous user
      createdAt: new Date(),
    };
    enterpriseUsers.push(anonymousUser);
    
    // Only add default users if they don't already exist (preserves users loaded from file)
    enterpriseUsers.forEach(user => {
      if (!this.users.has(user.id) && !this.users.has(user.username)) {
        this.users.set(user.id, user);
      }
    });
    
    // Also add anonymous user by username for lookups if not already present
    if (!this.users.has("anonymous")) {
      this.users.set("anonymous", anonymousUser);
    }

    // Save initial users to file if this is a fresh start (no existing file)
    if (!existsSync(this.usersFilePath)) {
      this.saveUsersToFile();
    }

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
        team: null,
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
        startedAt: null,
        firstResponseAt: null,
        workflowId: null,
        workflowStep: null,
        dependsOn: null,
        autoTrigger: false,
        triggerData: null,
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
        team: null,
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
        startedAt: null,
        firstResponseAt: null,
        workflowId: null,
        workflowStep: null,
        dependsOn: null,
        autoTrigger: false,
        triggerData: null,
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
        team: null,
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
        startedAt: null,
        firstResponseAt: null,
        workflowId: null,
        workflowStep: null,
        dependsOn: null,
        autoTrigger: false,
        triggerData: null,
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
    const normalizedInput = username.toLowerCase();
    return Array.from(this.users.values()).find(user => 
      user.username.toLowerCase() === normalizedInput || 
      user.email.toLowerCase() === normalizedInput
    );
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
      departmentAccess: insertUser.departmentAccess || null,
      id, 
      createdAt: new Date(),
    };
    this.users.set(id, user);
    this.saveUsersToFile();
    return user;
  }

  async updateUser(id: string, updates: Partial<User>): Promise<User | undefined> {
    const user = this.users.get(id);
    if (!user) return undefined;
    
    const updatedUser = { ...user, ...updates };
    this.users.set(id, updatedUser);
    this.saveUsersToFile();
    return updatedUser;
  }

  async deleteUser(id: string): Promise<boolean> {
    const result = this.users.delete(id);
    if (result) {
      this.saveUsersToFile();
    }
    return result;
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
      team: insertItem.team || null,
      data: insertItem.data || null,
      metadata: insertItem.metadata || null,
      notes: insertItem.notes || null,
      scheduledFor: insertItem.scheduledFor || null,
      attempts: insertItem.attempts || 0,
      lastError: insertItem.lastError || null,
      completedAt: insertItem.completedAt || null,
      startedAt: insertItem.startedAt || null,
      firstResponseAt: insertItem.firstResponseAt || null,
      workflowId: insertItem.workflowId || null,
      workflowStep: insertItem.workflowStep || null,
      dependsOn: insertItem.dependsOn || null,
      autoTrigger: insertItem.autoTrigger || false,
      triggerData: insertItem.triggerData || null,
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
    
    // Allow starting work if:
    // 1. Item is pending and assigned to worker, OR  
    // 2. Item is already in_progress and assigned to same worker (idempotent)
    if (item.assignedTo !== workerId || (item.status !== "pending" && item.status !== "in_progress")) {
      return undefined;
    }
    
    // If already in progress, just return the item (idempotent)
    if (item.status === "in_progress") {
      return item;
    }
    
    // Update status from pending to in_progress
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
      team: insertItem.team || null,
      data: insertItem.data || null,
      metadata: insertItem.metadata || null,
      notes: insertItem.notes || null,
      scheduledFor: insertItem.scheduledFor || null,
      attempts: insertItem.attempts || 0,
      lastError: insertItem.lastError || null,
      completedAt: insertItem.completedAt || null,
      startedAt: insertItem.startedAt || null,
      firstResponseAt: insertItem.firstResponseAt || null,
      workflowId: insertItem.workflowId || null,
      workflowStep: insertItem.workflowStep || null,
      dependsOn: insertItem.dependsOn || null,
      autoTrigger: insertItem.autoTrigger || false,
      triggerData: insertItem.triggerData || null,
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
    
    // Allow starting work if:
    // 1. Item is pending and assigned to worker, OR  
    // 2. Item is already in_progress and assigned to same worker (idempotent)
    if (item.assignedTo !== workerId || (item.status !== "pending" && item.status !== "in_progress")) {
      return undefined;
    }
    
    // If already in progress, just return the item (idempotent)
    if (item.status === "in_progress") {
      return item;
    }
    
    // Update status from pending to in_progress
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
      team: insertItem.team || null,
      data: insertItem.data || null,
      metadata: insertItem.metadata || null,
      notes: insertItem.notes || null,
      scheduledFor: insertItem.scheduledFor || null,
      attempts: insertItem.attempts || 0,
      lastError: insertItem.lastError || null,
      completedAt: insertItem.completedAt || null,
      startedAt: insertItem.startedAt || null,
      firstResponseAt: insertItem.firstResponseAt || null,
      workflowId: insertItem.workflowId || null,
      workflowStep: insertItem.workflowStep || null,
      dependsOn: insertItem.dependsOn || null,
      autoTrigger: insertItem.autoTrigger || false,
      triggerData: insertItem.triggerData || null,
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
    
    // Allow starting work if:
    // 1. Item is pending and assigned to worker, OR  
    // 2. Item is already in_progress and assigned to same worker (idempotent)
    if (item.assignedTo !== workerId || (item.status !== "pending" && item.status !== "in_progress")) {
      return undefined;
    }
    
    // If already in progress, just return the item (idempotent)
    if (item.status === "in_progress") {
      return item;
    }
    
    // Update status from pending to in_progress
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
      team: insertItem.team || null,
      data: insertItem.data || null,
      metadata: insertItem.metadata || null,
      notes: insertItem.notes || null,
      scheduledFor: insertItem.scheduledFor || null,
      attempts: insertItem.attempts || 0,
      lastError: insertItem.lastError || null,
      completedAt: insertItem.completedAt || null,
      startedAt: insertItem.startedAt || null,
      firstResponseAt: insertItem.firstResponseAt || null,
      workflowId: insertItem.workflowId || null,
      workflowStep: insertItem.workflowStep || null,
      dependsOn: insertItem.dependsOn || null,
      autoTrigger: insertItem.autoTrigger || false,
      triggerData: insertItem.triggerData || null,
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
    
    // Allow starting work if:
    // 1. Item is pending and assigned to worker, OR  
    // 2. Item is already in_progress and assigned to same worker (idempotent)
    if (item.assignedTo !== workerId || (item.status !== "pending" && item.status !== "in_progress")) {
      return undefined;
    }
    
    // If already in progress, just return the item (idempotent)
    if (item.status === "in_progress") {
      return item;
    }
    
    // Update status from pending to in_progress
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


  // Workflow automation function - triggers Phase 2 after ALL Day 0 tasks complete
  async triggerNextWorkflowStep(completedItem: QueueItem): Promise<void> {
    // Only proceed if this item is part of a workflow
    if (!completedItem.workflowId || !completedItem.workflowStep) return;

    try {
      const itemData = completedItem.data ? JSON.parse(completedItem.data) : null;
      if (!itemData) return;

      // Two-Phase Offboarding System:
      // Phase 1 (Day 0): Tasks 1-4 run in parallel (NTAO, Equipment, Fleet, Inventory)
      // Phase 2 (Day 1-5): Auto-generate Fleet follow-up tasks ONLY after ALL Day 0 tasks complete
      
      // Check if this is a Day 0 task completion
      if (itemData.isDay0Task && itemData.phase === "day0") {
        await this.checkAllDay0TasksAndTriggerPhase2(completedItem);
        return;
      }

      // Legacy workflow support - keeping existing logic for non-Day0 workflows
      const triggerData = completedItem.triggerData ? JSON.parse(completedItem.triggerData) : itemData;
      if (!triggerData) return;

      if (completedItem.workflowStep === 3 && completedItem.department === "Fleet Management" && !itemData.isDay0Task) {
        
        // Legacy workflow - Check for existing final tasks to prevent duplicates
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
          console.log(`Legacy workflow tasks already exist for workflow ${completedItem.workflowId}`);
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
      
      // Legacy workflow - Check if both Inventory Control and Assets Management step 4 tasks are completed to trigger final Fleet task
      else if (completedItem.workflowStep === 4 && 
               (completedItem.department === "Inventory Control" || completedItem.department === "Assets Management") &&
               !itemData.isDay0Task) {
        
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
            console.log(`Legacy workflow: Auto-triggered final Fleet readiness task for workflow ${completedItem.workflowId}`);
          }
        } else {
          console.log(`Legacy workflow: Step 4 task completed for workflow ${completedItem.workflowId}, waiting for other step 4 task to complete`);
        }
      } else {
        // No more steps to trigger for other completed tasks
        console.log(`Workflow task completed: ${completedItem.workflowId} step ${completedItem.workflowStep} (${completedItem.department})`);
      }
    } catch (error) {
      console.error('Error triggering next workflow step:', error);
    }
  }

  // New function to check Day 0 task completion and trigger Phase 2
  async checkAllDay0TasksAndTriggerPhase2(completedItem: QueueItem): Promise<void> {
    try {
      const itemData = JSON.parse(completedItem.data || '{}');
      const workflowId = completedItem.workflowId;
      
      if (!workflowId) {
        console.log('No workflow ID found for Day 0 task');
        return;
      }

      console.log(`Day 0 task completed: ${completedItem.title} (${completedItem.department})`);

      // Get all tasks for this workflow
      const allNtaoTasks = await this.getNTAOQueueItems();
      const allAssetsTasks = await this.getAssetsQueueItems();
      const allFleetTasks = await this.getFleetQueueItems();
      const allInventoryTasks = await this.getInventoryQueueItems();

      // Find all Day 0 tasks for this workflow
      const day0Tasks = [
        ...allNtaoTasks.filter(task => 
          task.workflowId === workflowId && 
          task.data?.includes('"isDay0Task":true')
        ),
        ...allAssetsTasks.filter(task => 
          task.workflowId === workflowId && 
          task.data?.includes('"isDay0Task":true')
        ),
        ...allFleetTasks.filter(task => 
          task.workflowId === workflowId && 
          task.data?.includes('"isDay0Task":true')
        ),
        ...allInventoryTasks.filter(task => 
          task.workflowId === workflowId && 
          task.data?.includes('"isDay0Task":true')
        )
      ];

      console.log(`Found ${day0Tasks.length} Day 0 tasks for workflow ${workflowId}`);
      
      // Check if ALL Day 0 tasks are completed
      const completedDay0Tasks = day0Tasks.filter(task => task.status === 'completed');
      const totalDay0Tasks = day0Tasks.length;
      const completedCount = completedDay0Tasks.length;

      console.log(`Day 0 tasks status: ${completedCount}/${totalDay0Tasks} completed`);

      if (totalDay0Tasks === 4 && completedCount === 4) {
        console.log(`🎉 ALL Day 0 tasks completed for workflow ${workflowId}! Triggering Phase 2...`);
        
        // Check if Phase 2 tasks already exist to prevent duplicates
        const existingPhase2Tasks = [
          ...allFleetTasks.filter(task => 
            task.workflowId === workflowId && 
            task.data?.includes('"phase":"phase2"')
          )
        ];

        if (existingPhase2Tasks.length > 0) {
          console.log(`Phase 2 tasks already exist for workflow ${workflowId}, skipping creation`);
          return;
        }

        // Trigger Phase 2 (Day 1-5) tasks
        await this.createPhase2FleetTasks(workflowId, itemData);
      } else {
        console.log(`Waiting for remaining Day 0 tasks to complete (${completedCount}/${totalDay0Tasks})`);
      }
    } catch (error) {
      console.error('Error checking Day 0 tasks completion:', error);
    }
  }

  // Create Phase 2 Fleet tasks based on vehicle type
  async createPhase2FleetTasks(workflowId: string, triggerData: any): Promise<void> {
    try {
      const vehicleType = triggerData.vehicleType || triggerData.vehicle?.type || 'sears-fleet';
      
      console.log(`Creating Phase 2 Fleet tasks for vehicle type: ${vehicleType}`);

      // Phase 2 Task 1: Vehicle Retrieval and Transport (Day 1-3)
      const retrievalTask = {
        workflowType: "offboarding",
        title: `Phase 2: Vehicle Retrieval - ${triggerData.vehicle?.vehicleNumber}`,
        description: `PHASE 2 (Day 1-3): Retrieve vehicle from technician and transport to appropriate location. Vehicle: ${triggerData.vehicle?.vehicleNumber}. Employee: ${triggerData.employee?.name} (${triggerData.employee?.racfId}). All Day 0 tasks completed - proceed with Phase 2.`,
        priority: "medium",
        requesterId: "system",
        department: "Fleet Management",
        workflowId: workflowId,
        workflowStep: 10, // Phase 2 steps start at 10
        phase: "phase2",
        autoTrigger: true,
        data: JSON.stringify({
          workflowType: "offboarding_sequence",
          step: "fleet_vehicle_retrieval_phase2",
          phase: "phase2",
          vehicleType: vehicleType,
          ...triggerData,
          instructions: this.getVehicleRetrievalInstructions(vehicleType)
        })
      };

      // Phase 2 Task 2: Shop Coordination (Day 3-5)
      const shopTask = {
        workflowType: "offboarding",
        title: `Phase 2: Shop Coordination - ${triggerData.vehicle?.vehicleNumber}`,
        description: `PHASE 2 (Day 3-5): Coordinate vehicle processing at shop/service center. Vehicle: ${triggerData.vehicle?.vehicleNumber}. Complete maintenance, inventory, and preparation for reassignment.`,
        priority: "medium",
        requesterId: "system",
        department: "Fleet Management",
        workflowId: workflowId,
        workflowStep: 11, // Phase 2 second step
        phase: "phase2",
        autoTrigger: true,
        data: JSON.stringify({
          workflowType: "offboarding_sequence",
          step: "fleet_shop_coordination_phase2",
          phase: "phase2",
          vehicleType: vehicleType,
          ...triggerData,
          instructions: this.getShopCoordinationInstructions(vehicleType)
        })
      };

      // Create the Phase 2 Fleet tasks
      await this.createFleetQueueItem(retrievalTask as any);
      await this.createFleetQueueItem(shopTask as any);

      console.log(`✅ Created Phase 2 Fleet tasks for workflow ${workflowId} (vehicle type: ${vehicleType})`);
    } catch (error) {
      console.error('Error creating Phase 2 Fleet tasks:', error);
    }
  }

  // Get vehicle retrieval instructions based on vehicle type
  private getVehicleRetrievalInstructions(vehicleType: string): string[] {
    const baseInstructions = [
      "Contact technician to schedule vehicle pickup",
      "Confirm vehicle location and accessibility",
      "Coordinate pickup logistics and timing"
    ];

    switch (vehicleType) {
      case 'sears-fleet':
        return [
          ...baseInstructions,
          "Arrange towing to Pep Boys location (preferred) or local repair shop",
          "Update AMS and Holman systems with transport details",
          "Set vehicle status to 'In Transit - Offboarding'",
          "Ensure proper fleet tracking documentation",
          "Coordinate with Pep Boys for intake scheduling"
        ];
      
      case 'byov':
        return [
          ...baseInstructions,
          "Coordinate return of company equipment from BYOV",
          "Verify removal of all Sears branding/equipment",
          "Document final mileage and condition",
          "Complete BYOV program exit procedures",
          "Update BYOV tracking systems"
        ];
      
      case 'rental':
        return [
          ...baseInstructions,
          "Contact rental company for return procedures",
          "Schedule rental return appointment",
          "Coordinate final inspection with rental agency",
          "Process rental return documentation",
          "Update rental fleet management system"
        ];
      
      default:
        return baseInstructions;
    }
  }

  // Get shop coordination instructions based on vehicle type
  private getShopCoordinationInstructions(vehicleType: string): string[] {
    const baseInstructions = [
      "Confirm vehicle arrival at service location",
      "Schedule comprehensive vehicle inspection"
    ];

    switch (vehicleType) {
      case 'sears-fleet':
        return [
          ...baseInstructions,
          "Complete full parts and tools inventory at shop",
          "Perform preventive maintenance (PM) service",
          "Assess vehicle condition and repair needs",
          "Clean interior and exterior thoroughly",
          "Update Holman and AMS systems to 'Spare' status",
          "Prepare vehicle for reassignment pool",
          "Generate final inspection report",
          "Mark vehicle ready for assignment"
        ];
      
      case 'byov':
        return [
          ...baseInstructions,
          "Verify complete removal of company equipment",
          "Confirm all Sears branding removed",
          "Document final vehicle condition",
          "Complete BYOV exit documentation",
          "Close BYOV participant record",
          "Archive BYOV program files"
        ];
      
      case 'rental':
        return [
          ...baseInstructions,
          "Complete rental return inspection with agency",
          "Process final rental charges and fees",
          "Obtain rental return receipt",
          "Submit rental expense documentation",
          "Close rental agreement",
          "Update expense tracking systems"
        ];
      
      default:
        return baseInstructions;
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

  // Generic queue item operations (searches across all modules)
  async getQueueItem(id: string): Promise<QueueItem | undefined> {
    // Search across all queue modules
    let item = await this.getNTAOQueueItem(id);
    if (item) return item;
    
    item = await this.getAssetsQueueItem(id);
    if (item) return item;
    
    item = await this.getInventoryQueueItem(id);
    if (item) return item;
    
    item = await this.getFleetQueueItem(id);
    if (item) return item;
    
    return undefined;
  }

  async updateQueueItem(id: string, updates: Partial<QueueItem>): Promise<QueueItem | undefined> {
    // Try to update in each module until one succeeds
    let updatedItem = await this.updateNTAOQueueItem(id, updates);
    if (updatedItem) return updatedItem;
    
    updatedItem = await this.updateAssetsQueueItem(id, updates);
    if (updatedItem) return updatedItem;
    
    updatedItem = await this.updateInventoryQueueItem(id, updates);
    if (updatedItem) return updatedItem;
    
    updatedItem = await this.updateFleetQueueItem(id, updates);
    if (updatedItem) return updatedItem;
    
    return undefined;
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
      state: insertVehicle.state || null,
      city: insertVehicle.city || null,
      branding: insertVehicle.branding || null,
      vehicleNumber: insertVehicle.vehicleNumber || null,
      color: insertVehicle.color || null,
      licensePlate: insertVehicle.licensePlate || null,
      licenseState: insertVehicle.licenseState || null,
      deliveryDate: insertVehicle.deliveryDate || null,
      outOfServiceDate: insertVehicle.outOfServiceDate || null,
      saleDate: insertVehicle.saleDate || null,
      registrationRenewalDate: insertVehicle.registrationRenewalDate || null,
      odometerDelivery: insertVehicle.odometerDelivery || null,
      interior: insertVehicle.interior || null,
      tuneStatus: insertVehicle.tuneStatus || null,
      region: insertVehicle.region || null,
      district: insertVehicle.district || null,
      deliveryAddress: insertVehicle.deliveryAddress || null,
      zip: insertVehicle.zip || null,
      mis: insertVehicle.mis || null,
      remainingBookValue: insertVehicle.remainingBookValue || null,
      leaseEndDate: insertVehicle.leaseEndDate || null,
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

  // Duplicate Detection Functions Implementation
  async checkOffboardingTaskDuplicates(
    employeeId: string, 
    techRacfId: string, 
    timeWindowMs: number = 5 * 60 * 1000
  ): Promise<{ isDuplicate: boolean; message?: string; existingTask?: QueueItem }> {
    try {
      const cutoffTime = new Date(Date.now() - timeWindowMs);
      const modules: QueueModule[] = ['ntao', 'assets', 'inventory', 'fleet'];
      
      for (const module of modules) {
        const items = await this.getQueueItemsByModule(module);
        
        for (const item of items) {
          if (item.createdAt && new Date(item.createdAt) >= cutoffTime) {
            try {
              let itemData = item.data;
              if (typeof itemData === 'string') {
                itemData = JSON.parse(itemData);
              }
              
              if (itemData?.workflowType === 'offboarding_sequence') {
                const itemEmployeeId = itemData?.employee?.employeeId || itemData?.employeeId;
                const itemTechRacfId = itemData?.employee?.racfId || itemData?.techRacfId || itemData?.employee?.enterpriseId;
                
                const employeeIdMatch = employeeId && itemEmployeeId && employeeId === itemEmployeeId;
                const techRacfIdMatch = techRacfId && itemTechRacfId && techRacfId === itemTechRacfId;
                
                if (employeeIdMatch || techRacfIdMatch) {
                  return {
                    isDuplicate: true,
                    message: `Duplicate offboarding workflow detected. A recent offboarding task already exists for this employee (${employeeIdMatch ? `Employee ID: ${employeeId}` : `RACF ID: ${techRacfId}`}) in ${module.toUpperCase()} queue.`,
                    existingTask: item
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
      console.error('Error in offboarding duplicate detection:', error);
      return { isDuplicate: false }; // Allow creation if duplicate check fails
    }
  }
  
  async checkByovEnrollmentDuplicates(
    ldap: string, 
    email: string, 
    currentTruckNumber: string, 
    timeWindowMs: number = 5 * 60 * 1000
  ): Promise<{ isDuplicate: boolean; message?: string; existingTask?: QueueItem }> {
    try {
      const cutoffTime = new Date(Date.now() - timeWindowMs);
      const modules: QueueModule[] = ['fleet', 'ntao'];
      
      for (const module of modules) {
        const items = await this.getQueueItemsByModule(module);
        
        for (const item of items) {
          if (item.createdAt && new Date(item.createdAt) >= cutoffTime) {
            try {
              let itemData = item.data;
              if (typeof itemData === 'string') {
                itemData = JSON.parse(itemData);
              }
              
              // Check if this is a BYOV enrollment workflow
              let isByovWorkflow = false;
              if (item.metadata) {
                try {
                  const metadata = JSON.parse(item.metadata);
                  isByovWorkflow = metadata.source === 'sears_drive_enrollment';
                } catch (metadataError) {
                  // Continue with other checks if metadata parsing fails
                }
              }
              
              if (!isByovWorkflow) {
                isByovWorkflow = itemData?.workflowId?.startsWith('byov-') ||
                  ['van_assignment', 'van_unassignment', 'system_updates', 'stop_shipment', 'setup_shipment'].includes(item.workflowType);
              }
              
              if (isByovWorkflow && itemData?.techInfo) {
                const itemLdap = itemData.techInfo.ldap;
                const itemEmail = itemData.techInfo.email;
                const itemTruckNumber = itemData.techInfo.currentTruckNumber;
                
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
                    message: `Duplicate BYOV enrollment detected. A recent enrollment already exists for this technician (${matchType}) in ${module.toUpperCase()} queue.`,
                    existingTask: item
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
      console.error('Error in BYOV enrollment duplicate detection:', error);
      return { isDuplicate: false }; // Allow creation if duplicate check fails
    }
  }
  
  async getRecentQueueItemsByTimeWindow(
    modules: QueueModule[], 
    timeWindowMs: number
  ): Promise<{ module: QueueModule; items: QueueItem[] }[]> {
    const cutoffTime = new Date(Date.now() - timeWindowMs);
    const result: { module: QueueModule; items: QueueItem[] }[] = [];
    
    for (const module of modules) {
      const items = await this.getQueueItemsByModule(module);
      const recentItems = items.filter(item => 
        item.createdAt && new Date(item.createdAt) >= cutoffTime
      );
      
      result.push({ module, items: recentItems });
    }
    
    return result;
  }
  
  async findQueueItemsByDataMatch(
    modules: QueueModule[], 
    searchFunction: (data: any) => boolean
  ): Promise<{ module: QueueModule; items: QueueItem[] }[]> {
    const result: { module: QueueModule; items: QueueItem[] }[] = [];
    
    for (const module of modules) {
      const items = await this.getQueueItemsByModule(module);
      const matchingItems: QueueItem[] = [];
      
      for (const item of items) {
        try {
          let itemData = item.data;
          if (typeof itemData === 'string') {
            itemData = JSON.parse(itemData);
          }
          
          if (searchFunction(itemData)) {
            matchingItems.push(item);
          }
        } catch (parseError) {
          console.error('Error parsing queue item data for search:', parseError);
          continue;
        }
      }
      
      result.push({ module, items: matchingItems });
    }
    
    return result;
  }
  
  private async getQueueItemsByModule(module: QueueModule): Promise<QueueItem[]> {
    switch (module) {
      case 'ntao':
        return this.getNTAOQueueItems();
      case 'assets':
        return this.getAssetsQueueItems();
      case 'inventory':
        return this.getInventoryQueueItems();
      case 'fleet':
        return this.getFleetQueueItems();
      default:
        return [];
    }
  }
}

export class DatabaseStorage implements IStorage {
  
  // Users
  async getUser(id: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return result[0];
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.username, username)).limit(1);
    return result[0];
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return result[0];
  }

  async getUsers(): Promise<User[]> {
    return await db.select().from(users).orderBy(desc(users.createdAt));
  }

  async createUser(user: InsertUser): Promise<User> {
    const result = await db.insert(users).values(user).returning();
    return result[0];
  }

  async updateUser(id: string, updates: Partial<User>): Promise<User | undefined> {
    const result = await db.update(users).set(updates).where(eq(users.id, id)).returning();
    return result[0];
  }

  async deleteUser(id: string): Promise<boolean> {
    const result = await db.delete(users).where(eq(users.id, id));
    return result.rowCount! > 0;
  }

  // Requests
  async getRequest(id: string): Promise<Request | undefined> {
    const result = await db.select().from(requests).where(eq(requests.id, id)).limit(1);
    return result[0];
  }

  async getRequests(): Promise<Request[]> {
    return await db.select().from(requests).orderBy(desc(requests.createdAt));
  }

  async getRequestsByStatus(status: string): Promise<Request[]> {
    return await db.select().from(requests).where(eq(requests.status, status)).orderBy(desc(requests.createdAt));
  }

  async getRequestsByRequester(requesterId: string): Promise<Request[]> {
    return await db.select().from(requests).where(eq(requests.requesterId, requesterId)).orderBy(desc(requests.createdAt));
  }

  async createRequest(request: InsertRequest): Promise<Request> {
    const result = await db.insert(requests).values(request).returning();
    return result[0];
  }

  async updateRequest(id: string, updates: Partial<Request>): Promise<Request | undefined> {
    const result = await db.update(requests).set({...updates, updatedAt: new Date()}).where(eq(requests.id, id)).returning();
    return result[0];
  }

  // API Configurations
  async getApiConfiguration(id: string): Promise<ApiConfiguration | undefined> {
    const result = await db.select().from(apiConfigurations).where(eq(apiConfigurations.id, id)).limit(1);
    return result[0];
  }

  async getApiConfigurations(): Promise<ApiConfiguration[]> {
    return await db.select().from(apiConfigurations).orderBy(desc(apiConfigurations.createdAt));
  }

  async createApiConfiguration(config: InsertApiConfiguration): Promise<ApiConfiguration> {
    const result = await db.insert(apiConfigurations).values(config).returning();
    return result[0];
  }

  async updateApiConfiguration(id: string, updates: Partial<ApiConfiguration>): Promise<ApiConfiguration | undefined> {
    const result = await db.update(apiConfigurations).set(updates).where(eq(apiConfigurations.id, id)).returning();
    return result[0];
  }

  async deleteApiConfiguration(id: string): Promise<boolean> {
    const result = await db.delete(apiConfigurations).where(eq(apiConfigurations.id, id));
    return result.rowCount! > 0;
  }

  // Activity Logs
  async getActivityLogs(): Promise<ActivityLog[]> {
    return await db.select().from(activityLogs).orderBy(desc(activityLogs.createdAt));
  }

  async getActivityLogsByUser(userId: string): Promise<ActivityLog[]> {
    return await db.select().from(activityLogs).where(eq(activityLogs.userId, userId)).orderBy(desc(activityLogs.createdAt));
  }

  async createActivityLog(log: InsertActivityLog): Promise<ActivityLog> {
    const result = await db.insert(activityLogs).values(log).returning();
    return result[0];
  }

  // Dashboard Stats
  async getDashboardStats(): Promise<{
    onboarding: { pending: number; inProgress: number; completed: number };
    vehicleAssignment: { pending: number; inProgress: number; completed: number };
    offboarding: { pending: number; inProgress: number; completed: number };
    activeUsers: number;
  }> {
    const [onboardingStats, vehicleAssignmentStats, offboardingStats, userCount] = await Promise.all([
      db.select({
        status: queueItems.status,
        count: sql<number>`cast(count(*) as int)`
      }).from(queueItems).where(eq(queueItems.workflowType, 'onboarding')).groupBy(queueItems.status),
      
      db.select({
        status: queueItems.status,
        count: sql<number>`cast(count(*) as int)`
      }).from(queueItems).where(eq(queueItems.workflowType, 'vehicle_assignment')).groupBy(queueItems.status),
      
      db.select({
        status: queueItems.status,
        count: sql<number>`cast(count(*) as int)`
      }).from(queueItems).where(eq(queueItems.workflowType, 'offboarding')).groupBy(queueItems.status),
      
      db.select({ count: sql<number>`cast(count(*) as int)` }).from(users)
    ]);

    const getStatsByStatus = (stats: Array<{status: string; count: number}>) => {
      const result = { pending: 0, inProgress: 0, completed: 0 };
      stats.forEach(stat => {
        if (stat.status === 'pending') result.pending = stat.count;
        else if (stat.status === 'in_progress') result.inProgress = stat.count;
        else if (stat.status === 'completed') result.completed = stat.count;
      });
      return result;
    };

    return {
      onboarding: getStatsByStatus(onboardingStats),
      vehicleAssignment: getStatsByStatus(vehicleAssignmentStats),
      offboarding: getStatsByStatus(offboardingStats),
      activeUsers: userCount[0]?.count || 0
    };
  }

  // Queue Item Operations - using shared queue_items table with department filtering
  
  // NTAO Queue Module
  async getNTAOQueueItem(id: string): Promise<QueueItem | undefined> {
    const result = await db.select().from(queueItems)
      .where(and(eq(queueItems.id, id), eq(queueItems.department, 'NTAO')))
      .limit(1);
    return result[0];
  }

  async getNTAOQueueItems(): Promise<QueueItem[]> {
    return await db.select().from(queueItems)
      .where(eq(queueItems.department, 'NTAO'))
      .orderBy(desc(queueItems.createdAt));
  }

  async createNTAOQueueItem(item: InsertQueueItem): Promise<QueueItem> {
    const result = await db.insert(queueItems).values({
      ...item,
      department: 'NTAO'
    }).returning();
    return result[0];
  }

  async updateNTAOQueueItem(id: string, updates: Partial<QueueItem>): Promise<QueueItem | undefined> {
    const result = await db.update(queueItems)
      .set({...updates, updatedAt: new Date()})
      .where(and(eq(queueItems.id, id), eq(queueItems.department, 'NTAO')))
      .returning();
    return result[0];
  }

  async assignNTAOQueueItem(id: string, assigneeId: string): Promise<QueueItem | undefined> {
    return await this.updateNTAOQueueItem(id, { 
      assignedTo: assigneeId, 
      status: 'pending'
    });
  }

  async startWorkNTAOQueueItem(id: string, workerId: string): Promise<QueueItem | undefined> {
    return await db.transaction(async (tx) => {
      const item = await tx.select().from(queueItems)
        .where(and(eq(queueItems.id, id), eq(queueItems.department, 'NTAO')))
        .limit(1);
      
      if (!item[0] || item[0].assignedTo !== workerId || 
          (item[0].status !== 'pending' && item[0].status !== 'in_progress')) {
        return undefined;
      }

      if (item[0].status === 'in_progress') {
        return item[0];
      }

      const result = await tx.update(queueItems)
        .set({ 
          status: 'in_progress', 
          startedAt: new Date(),
          updatedAt: new Date() 
        })
        .where(and(eq(queueItems.id, id), eq(queueItems.department, 'NTAO')))
        .returning();
      
      return result[0];
    });
  }

  async completeNTAOQueueItem(id: string, completedBy: string): Promise<QueueItem | undefined> {
    const result = await db.update(queueItems)
      .set({ 
        status: 'completed', 
        completedAt: new Date(),
        updatedAt: new Date() 
      })
      .where(and(eq(queueItems.id, id), eq(queueItems.department, 'NTAO')))
      .returning();
    return result[0];
  }

  // Assets Queue Module (similar pattern for all queue modules)
  async getAssetsQueueItem(id: string): Promise<QueueItem | undefined> {
    const result = await db.select().from(queueItems)
      .where(and(eq(queueItems.id, id), eq(queueItems.department, 'Assets Management')))
      .limit(1);
    return result[0];
  }

  async getAssetsQueueItems(): Promise<QueueItem[]> {
    return await db.select().from(queueItems)
      .where(eq(queueItems.department, 'Assets Management'))
      .orderBy(desc(queueItems.createdAt));
  }

  async createAssetsQueueItem(item: InsertQueueItem): Promise<QueueItem> {
    const result = await db.insert(queueItems).values({
      ...item,
      department: 'Assets Management'
    }).returning();
    return result[0];
  }

  async updateAssetsQueueItem(id: string, updates: Partial<QueueItem>): Promise<QueueItem | undefined> {
    const result = await db.update(queueItems)
      .set({...updates, updatedAt: new Date()})
      .where(and(eq(queueItems.id, id), eq(queueItems.department, 'Assets Management')))
      .returning();
    return result[0];
  }

  async assignAssetsQueueItem(id: string, assigneeId: string): Promise<QueueItem | undefined> {
    return await this.updateAssetsQueueItem(id, { 
      assignedTo: assigneeId, 
      status: 'pending'
    });
  }

  async startWorkAssetsQueueItem(id: string, workerId: string): Promise<QueueItem | undefined> {
    return await db.transaction(async (tx) => {
      const item = await tx.select().from(queueItems)
        .where(and(eq(queueItems.id, id), eq(queueItems.department, 'Assets Management')))
        .limit(1);
      
      if (!item[0] || item[0].assignedTo !== workerId || 
          (item[0].status !== 'pending' && item[0].status !== 'in_progress')) {
        return undefined;
      }

      if (item[0].status === 'in_progress') {
        return item[0];
      }

      const result = await tx.update(queueItems)
        .set({ 
          status: 'in_progress', 
          startedAt: new Date(),
          updatedAt: new Date() 
        })
        .where(and(eq(queueItems.id, id), eq(queueItems.department, 'Assets Management')))
        .returning();
      
      return result[0];
    });
  }

  async completeAssetsQueueItem(id: string, completedBy: string): Promise<QueueItem | undefined> {
    const result = await db.update(queueItems)
      .set({ 
        status: 'completed', 
        completedAt: new Date(),
        updatedAt: new Date() 
      })
      .where(and(eq(queueItems.id, id), eq(queueItems.department, 'Assets Management')))
      .returning();
    return result[0];
  }

  // Inventory Queue Module  
  async getInventoryQueueItem(id: string): Promise<QueueItem | undefined> {
    const result = await db.select().from(queueItems)
      .where(and(eq(queueItems.id, id), eq(queueItems.department, 'Inventory Control')))
      .limit(1);
    return result[0];
  }

  async getInventoryQueueItems(): Promise<QueueItem[]> {
    return await db.select().from(queueItems)
      .where(eq(queueItems.department, 'Inventory Control'))
      .orderBy(desc(queueItems.createdAt));
  }

  async createInventoryQueueItem(item: InsertQueueItem): Promise<QueueItem> {
    const result = await db.insert(queueItems).values({
      ...item,
      department: 'Inventory Control'
    }).returning();
    return result[0];
  }

  async updateInventoryQueueItem(id: string, updates: Partial<QueueItem>): Promise<QueueItem | undefined> {
    const result = await db.update(queueItems)
      .set({...updates, updatedAt: new Date()})
      .where(and(eq(queueItems.id, id), eq(queueItems.department, 'Inventory Control')))
      .returning();
    return result[0];
  }

  async assignInventoryQueueItem(id: string, assigneeId: string): Promise<QueueItem | undefined> {
    return await this.updateInventoryQueueItem(id, { 
      assignedTo: assigneeId, 
      status: 'pending'
    });
  }

  async startWorkInventoryQueueItem(id: string, workerId: string): Promise<QueueItem | undefined> {
    return await db.transaction(async (tx) => {
      const item = await tx.select().from(queueItems)
        .where(and(eq(queueItems.id, id), eq(queueItems.department, 'Inventory Control')))
        .limit(1);
      
      if (!item[0] || item[0].assignedTo !== workerId || 
          (item[0].status !== 'pending' && item[0].status !== 'in_progress')) {
        return undefined;
      }

      if (item[0].status === 'in_progress') {
        return item[0];
      }

      const result = await tx.update(queueItems)
        .set({ 
          status: 'in_progress', 
          startedAt: new Date(),
          updatedAt: new Date() 
        })
        .where(and(eq(queueItems.id, id), eq(queueItems.department, 'Inventory Control')))
        .returning();
      
      return result[0];
    });
  }

  async completeInventoryQueueItem(id: string, completedBy: string): Promise<QueueItem | undefined> {
    const result = await db.update(queueItems)
      .set({ 
        status: 'completed', 
        completedAt: new Date(),
        updatedAt: new Date() 
      })
      .where(and(eq(queueItems.id, id), eq(queueItems.department, 'Inventory Control')))
      .returning();
    return result[0];
  }

  // Fleet Queue Module
  async getFleetQueueItem(id: string): Promise<QueueItem | undefined> {
    const result = await db.select().from(queueItems)
      .where(and(eq(queueItems.id, id), eq(queueItems.department, 'Fleet Management')))
      .limit(1);
    return result[0];
  }

  async getFleetQueueItems(): Promise<QueueItem[]> {
    return await db.select().from(queueItems)
      .where(eq(queueItems.department, 'Fleet Management'))
      .orderBy(desc(queueItems.createdAt));
  }

  async createFleetQueueItem(item: InsertQueueItem): Promise<QueueItem> {
    const result = await db.insert(queueItems).values({
      ...item,
      department: 'Fleet Management'
    }).returning();
    return result[0];
  }

  async updateFleetQueueItem(id: string, updates: Partial<QueueItem>): Promise<QueueItem | undefined> {
    const result = await db.update(queueItems)
      .set({...updates, updatedAt: new Date()})
      .where(and(eq(queueItems.id, id), eq(queueItems.department, 'Fleet Management')))
      .returning();
    return result[0];
  }

  async assignFleetQueueItem(id: string, assigneeId: string): Promise<QueueItem | undefined> {
    return await this.updateFleetQueueItem(id, { 
      assignedTo: assigneeId, 
      status: 'pending'
    });
  }

  async startWorkFleetQueueItem(id: string, workerId: string): Promise<QueueItem | undefined> {
    return await db.transaction(async (tx) => {
      const item = await tx.select().from(queueItems)
        .where(and(eq(queueItems.id, id), eq(queueItems.department, 'Fleet Management')))
        .limit(1);
      
      if (!item[0] || item[0].assignedTo !== workerId || 
          (item[0].status !== 'pending' && item[0].status !== 'in_progress')) {
        return undefined;
      }

      if (item[0].status === 'in_progress') {
        return item[0];
      }

      const result = await tx.update(queueItems)
        .set({ 
          status: 'in_progress', 
          startedAt: new Date(),
          updatedAt: new Date() 
        })
        .where(and(eq(queueItems.id, id), eq(queueItems.department, 'Fleet Management')))
        .returning();
      
      return result[0];
    });
  }

  async completeFleetQueueItem(id: string, completedBy: string): Promise<QueueItem | undefined> {
    const result = await db.update(queueItems)
      .set({ 
        status: 'completed', 
        completedAt: new Date(),
        updatedAt: new Date() 
      })
      .where(and(eq(queueItems.id, id), eq(queueItems.department, 'Fleet Management')))
      .returning();
    return result[0];
  }

  // Queue operations
  async cancelQueueItem(id: string, reason: string): Promise<QueueItem | undefined> {
    const result = await db.update(queueItems)
      .set({ 
        status: 'cancelled', 
        lastError: reason,
        updatedAt: new Date() 
      })
      .where(eq(queueItems.id, id))
      .returning();
    return result[0];
  }

  // Generic queue item operations (searches across all modules)
  async getQueueItem(id: string): Promise<QueueItem | undefined> {
    const result = await db.select().from(queueItems).where(eq(queueItems.id, id)).limit(1);
    return result[0];
  }

  async updateQueueItem(id: string, updates: Partial<QueueItem>): Promise<QueueItem | undefined> {
    const result = await db.update(queueItems)
      .set({...updates, updatedAt: new Date()})
      .where(eq(queueItems.id, id))
      .returning();
    return result[0];
  }

  // Storage Spots Module
  async getStorageSpot(id: string): Promise<StorageSpot | undefined> {
    const result = await db.select().from(storageSpots).where(eq(storageSpots.id, id)).limit(1);
    return result[0];
  }

  async getStorageSpots(): Promise<StorageSpot[]> {
    return await db.select().from(storageSpots).orderBy(desc(storageSpots.createdAt));
  }

  async getStorageSpotsByStatus(status: string): Promise<StorageSpot[]> {
    return await db.select().from(storageSpots).where(eq(storageSpots.status, status)).orderBy(desc(storageSpots.createdAt));
  }

  async getStorageSpotsByState(state: string): Promise<StorageSpot[]> {
    return await db.select().from(storageSpots).where(eq(storageSpots.state, state)).orderBy(desc(storageSpots.createdAt));
  }

  async createStorageSpot(spot: InsertStorageSpot): Promise<StorageSpot> {
    const result = await db.insert(storageSpots).values(spot).returning();
    return result[0];
  }

  async updateStorageSpot(id: string, updates: Partial<StorageSpot>): Promise<StorageSpot | undefined> {
    const result = await db.update(storageSpots)
      .set({...updates, updatedAt: new Date()})
      .where(eq(storageSpots.id, id))
      .returning();
    return result[0];
  }

  async deleteStorageSpot(id: string): Promise<boolean> {
    const result = await db.delete(storageSpots).where(eq(storageSpots.id, id));
    return result.rowCount! > 0;
  }

  // Vehicles Module
  async getVehicle(id: string): Promise<Vehicle | undefined> {
    const result = await db.select().from(vehicles).where(eq(vehicles.id, id)).limit(1);
    return result[0];
  }

  async getVehicleByVin(vin: string): Promise<Vehicle | undefined> {
    const result = await db.select().from(vehicles).where(eq(vehicles.vin, vin)).limit(1);
    return result[0];
  }

  async getVehicles(): Promise<Vehicle[]> {
    return await db.select().from(vehicles).orderBy(desc(vehicles.createdAt));
  }

  async getVehiclesByStatus(status: string): Promise<Vehicle[]> {
    return await db.select().from(vehicles).where(eq(vehicles.status, status)).orderBy(desc(vehicles.createdAt));
  }

  async getVehiclesByState(state: string): Promise<Vehicle[]> {
    return await db.select().from(vehicles).where(eq(vehicles.state, state)).orderBy(desc(vehicles.createdAt));
  }

  async getVehiclesByBranding(branding: string): Promise<Vehicle[]> {
    return await db.select().from(vehicles).where(eq(vehicles.branding, branding)).orderBy(desc(vehicles.createdAt));
  }

  async createVehicle(vehicle: InsertVehicle): Promise<Vehicle> {
    const result = await db.insert(vehicles).values(vehicle).returning();
    return result[0];
  }

  async createVehicles(vehicleList: InsertVehicle[]): Promise<Vehicle[]> {
    return await db.transaction(async (tx) => {
      const results: Vehicle[] = [];
      for (const vehicle of vehicleList) {
        const result = await tx.insert(vehicles).values(vehicle).returning();
        results.push(result[0]);
      }
      return results;
    });
  }

  async updateVehicle(id: string, updates: Partial<Vehicle>): Promise<Vehicle | undefined> {
    const result = await db.update(vehicles)
      .set({...updates, updatedAt: new Date()})
      .where(eq(vehicles.id, id))
      .returning();
    return result[0];
  }

  async deleteVehicle(id: string): Promise<boolean> {
    const result = await db.delete(vehicles).where(eq(vehicles.id, id));
    return result.rowCount! > 0;
  }

  // Unified Queue Aggregator
  async getUnifiedQueueItems(modules: QueueModule[], status?: string): Promise<CombinedQueueItem[]> {
    const departmentMap: Record<QueueModule, string> = {
      'ntao': 'NTAO',
      'assets': 'Assets Management', 
      'inventory': 'Inventory Control',
      'fleet': 'Fleet Management'
    };

    const departments = modules.map(m => departmentMap[m]);
    
    let query = db.select().from(queueItems).where(inArray(queueItems.department, departments));
    
    if (status) {
      query = query.where(and(inArray(queueItems.department, departments), eq(queueItems.status, status)));
    }
    
    const items = await query.orderBy(desc(queueItems.createdAt));
    
    return items.map(item => ({
      ...item,
      module: Object.keys(departmentMap).find(key => 
        departmentMap[key as QueueModule] === item.department
      ) as QueueModule
    }));
  }

  async getUnifiedQueueStats(modules: QueueModule[]): Promise<{
    pending: number;
    in_progress: number; 
    completed: number;
    total: number;
  }> {
    const departmentMap: Record<QueueModule, string> = {
      'ntao': 'NTAO',
      'assets': 'Assets Management', 
      'inventory': 'Inventory Control',
      'fleet': 'Fleet Management'
    };

    const departments = modules.map(m => departmentMap[m]);
    
    const stats = await db.select({
      status: queueItems.status,
      count: sql<number>`cast(count(*) as int)`
    }).from(queueItems)
      .where(inArray(queueItems.department, departments))
      .groupBy(queueItems.status);

    const result = { pending: 0, in_progress: 0, completed: 0, total: 0 };
    
    stats.forEach(stat => {
      if (stat.status === 'pending') result.pending = stat.count;
      else if (stat.status === 'in_progress') result.in_progress = stat.count;
      else if (stat.status === 'completed') result.completed = stat.count;
      result.total += stat.count;
    });

    return result;
  }

  async getUnifiedQueueItem(module: QueueModule, id: string): Promise<QueueItem | undefined> {
    const departmentMap: Record<QueueModule, string> = {
      'ntao': 'NTAO',
      'assets': 'Assets Management', 
      'inventory': 'Inventory Control',
      'fleet': 'Fleet Management'
    };

    const result = await db.select().from(queueItems)
      .where(and(eq(queueItems.id, id), eq(queueItems.department, departmentMap[module])))
      .limit(1);
    return result[0];
  }

  async updateUnifiedQueueItem(module: QueueModule, id: string, updates: Partial<QueueItem>): Promise<QueueItem | undefined> {
    const departmentMap: Record<QueueModule, string> = {
      'ntao': 'NTAO',
      'assets': 'Assets Management', 
      'inventory': 'Inventory Control',
      'fleet': 'Fleet Management'
    };

    const result = await db.update(queueItems)
      .set({...updates, updatedAt: new Date()})
      .where(and(eq(queueItems.id, id), eq(queueItems.department, departmentMap[module])))
      .returning();
    return result[0];
  }

  async assignUnifiedQueueItem(module: QueueModule, id: string, assigneeId: string): Promise<QueueItem | undefined> {
    return await this.updateUnifiedQueueItem(module, id, { 
      assignedTo: assigneeId, 
      status: 'pending'
    });
  }

  async startWorkUnifiedQueueItem(module: QueueModule, id: string, workerId: string): Promise<QueueItem | undefined> {
    const departmentMap: Record<QueueModule, string> = {
      'ntao': 'NTAO',
      'assets': 'Assets Management', 
      'inventory': 'Inventory Control',
      'fleet': 'Fleet Management'
    };

    return await db.transaction(async (tx) => {
      const item = await tx.select().from(queueItems)
        .where(and(eq(queueItems.id, id), eq(queueItems.department, departmentMap[module])))
        .limit(1);
      
      if (!item[0] || item[0].assignedTo !== workerId || 
          (item[0].status !== 'pending' && item[0].status !== 'in_progress')) {
        return undefined;
      }

      if (item[0].status === 'in_progress') {
        return item[0];
      }

      const result = await tx.update(queueItems)
        .set({ 
          status: 'in_progress', 
          startedAt: new Date(),
          updatedAt: new Date() 
        })
        .where(and(eq(queueItems.id, id), eq(queueItems.department, departmentMap[module])))
        .returning();
      
      return result[0];
    });
  }

  async completeUnifiedQueueItem(module: QueueModule, id: string, completedBy: string): Promise<QueueItem | undefined> {
    const departmentMap: Record<QueueModule, string> = {
      'ntao': 'NTAO',
      'assets': 'Assets Management', 
      'inventory': 'Inventory Control',
      'fleet': 'Fleet Management'
    };

    const result = await db.update(queueItems)
      .set({ 
        status: 'completed', 
        completedAt: new Date(),
        updatedAt: new Date() 
      })
      .where(and(eq(queueItems.id, id), eq(queueItems.department, departmentMap[module])))
      .returning();
    return result[0];
  }

  // Duplicate Detection Functions
  async checkOffboardingTaskDuplicates(employeeId: string, techRacfId: string, timeWindowMs?: number): Promise<{ isDuplicate: boolean; message?: string; existingTask?: QueueItem }> {
    const cutoffTime = timeWindowMs ? new Date(Date.now() - timeWindowMs) : null;
    
    let query = db.select().from(queueItems)
      .where(eq(queueItems.workflowType, 'offboarding'));
    
    if (cutoffTime) {
      query = query.where(and(eq(queueItems.workflowType, 'offboarding'), sql`${queueItems.createdAt} >= ${cutoffTime}`));
    }
    
    const items = await query;
    
    for (const item of items) {
      try {
        let itemData = item.data;
        if (typeof itemData === 'string') {
          itemData = JSON.parse(itemData);
        }
        
        if (itemData && itemData.employee && 
           (itemData.employee.employeeId === employeeId || itemData.employee.techRacfId === techRacfId)) {
          return {
            isDuplicate: true,
            message: `Duplicate offboarding task found for employee ${employeeId}/${techRacfId}`,
            existingTask: item
          };
        }
      } catch (parseError) {
        console.error('Error parsing queue item data for duplicate check:', parseError);
        continue;
      }
    }
    
    return { isDuplicate: false };
  }

  async checkByovEnrollmentDuplicates(ldap: string, email: string, currentTruckNumber: string, timeWindowMs?: number): Promise<{ isDuplicate: boolean; message?: string; existingTask?: QueueItem }> {
    const cutoffTime = timeWindowMs ? new Date(Date.now() - timeWindowMs) : null;
    
    let query = db.select().from(queueItems)
      .where(eq(queueItems.workflowId, 'byov_enrollment'));
    
    if (cutoffTime) {
      query = query.where(sql`${queueItems.createdAt} >= ${cutoffTime}`);
    }
    
    const items = await query;
    
    for (const item of items) {
      try {
        let itemData = item.data;
        if (typeof itemData === 'string') {
          itemData = JSON.parse(itemData);
        }
        
        if (itemData && itemData.techInfo && 
           (itemData.techInfo.ldap === ldap || 
            itemData.techInfo.email === email || 
            itemData.techInfo.currentTruckNumber === currentTruckNumber)) {
          return {
            isDuplicate: true,
            message: `Duplicate BYOV enrollment found for ${ldap}/${email}/${currentTruckNumber}`,
            existingTask: item
          };
        }
      } catch (parseError) {
        console.error('Error parsing queue item data for duplicate check:', parseError);
        continue;
      }
    }
    
    return { isDuplicate: false };
  }

  async getRecentQueueItemsByTimeWindow(modules: QueueModule[], timeWindowMs: number): Promise<{ module: QueueModule; items: QueueItem[] }[]> {
    const cutoffTime = new Date(Date.now() - timeWindowMs);
    const result: { module: QueueModule; items: QueueItem[] }[] = [];
    
    const departmentMap: Record<QueueModule, string> = {
      'ntao': 'NTAO',
      'assets': 'Assets Management', 
      'inventory': 'Inventory Control',
      'fleet': 'Fleet Management'
    };

    for (const module of modules) {
      const items = await db.select().from(queueItems)
        .where(and(
          eq(queueItems.department, departmentMap[module]),
          sql`${queueItems.createdAt} >= ${cutoffTime}`
        ))
        .orderBy(desc(queueItems.createdAt));
      
      result.push({ module, items });
    }
    
    return result;
  }
  
  async findQueueItemsByDataMatch(modules: QueueModule[], searchFunction: (data: any) => boolean): Promise<{ module: QueueModule; items: QueueItem[] }[]> {
    const result: { module: QueueModule; items: QueueItem[] }[] = [];
    
    const departmentMap: Record<QueueModule, string> = {
      'ntao': 'NTAO',
      'assets': 'Assets Management', 
      'inventory': 'Inventory Control',
      'fleet': 'Fleet Management'
    };

    for (const module of modules) {
      const items = await db.select().from(queueItems)
        .where(eq(queueItems.department, departmentMap[module]))
        .orderBy(desc(queueItems.createdAt));
      
      const matchingItems: QueueItem[] = [];
      
      for (const item of items) {
        try {
          let itemData = item.data;
          if (typeof itemData === 'string') {
            itemData = JSON.parse(itemData);
          }
          
          if (searchFunction(itemData)) {
            matchingItems.push(item);
          }
        } catch (parseError) {
          console.error('Error parsing queue item data for search:', parseError);
          continue;
        }
      }
      
      result.push({ module, items: matchingItems });
    }
    
    return result;
  }

  // Migration method to bulk-insert data from MemStorage
  async migrateFrom(mem: MemStorage): Promise<void> {
    console.log('Starting migration from MemStorage to DatabaseStorage...');
    
    return await db.transaction(async (tx) => {
      try {
        // Migrate users
        const usersList = await mem.getUsers();
        if (usersList.length > 0) {
          console.log(`Migrating ${usersList.length} users...`);
          for (const user of usersList) {
            const { id, createdAt, ...userData } = user;
            await tx.insert(users).values({
              ...userData,
              id: id || randomUUID(),
              createdAt: createdAt || new Date()
            }).onConflictDoNothing();
          }
        }

        // Migrate requests
        const requestsList = await mem.getRequests();
        if (requestsList.length > 0) {
          console.log(`Migrating ${requestsList.length} requests...`);
          for (const request of requestsList) {
            const { id, createdAt, updatedAt, ...requestData } = request;
            await tx.insert(requests).values({
              ...requestData,
              id: id || randomUUID(),
              createdAt: createdAt || new Date(),
              updatedAt: updatedAt || new Date()
            }).onConflictDoNothing();
          }
        }

        // Migrate API configurations
        const apiConfigs = await mem.getApiConfigurations();
        if (apiConfigs.length > 0) {
          console.log(`Migrating ${apiConfigs.length} API configurations...`);
          for (const config of apiConfigs) {
            const { id, createdAt, lastChecked, ...configData } = config;
            await tx.insert(apiConfigurations).values({
              ...configData,
              id: id || randomUUID(),
              createdAt: createdAt || new Date(),
              lastChecked: lastChecked || new Date()
            }).onConflictDoNothing();
          }
        }

        // Migrate activity logs
        const activityLogsList = await mem.getActivityLogs();
        if (activityLogsList.length > 0) {
          console.log(`Migrating ${activityLogsList.length} activity logs...`);
          for (const log of activityLogsList) {
            const { id, createdAt, ...logData } = log;
            await tx.insert(activityLogs).values({
              ...logData,
              id: id || randomUUID(),
              createdAt: createdAt || new Date()
            }).onConflictDoNothing();
          }
        }

        // Migrate queue items from all modules
        const queueModules: QueueModule[] = ['ntao', 'assets', 'inventory', 'fleet'];
        for (const module of queueModules) {
          let items: QueueItem[] = [];
          switch (module) {
            case 'ntao':
              items = await mem.getNTAOQueueItems();
              break;
            case 'assets':
              items = await mem.getAssetsQueueItems();
              break;
            case 'inventory':
              items = await mem.getInventoryQueueItems();
              break;
            case 'fleet':
              items = await mem.getFleetQueueItems();
              break;
          }
          
          if (items.length > 0) {
            console.log(`Migrating ${items.length} queue items from ${module} module...`);
            for (const item of items) {
              const { id, createdAt, updatedAt, ...itemData } = item;
              await tx.insert(queueItems).values({
                ...itemData,
                id: id || randomUUID(),
                createdAt: createdAt || new Date(),
                updatedAt: updatedAt || new Date()
              }).onConflictDoNothing();
            }
          }
        }

        // Migrate storage spots
        const storageSpotsList = await mem.getStorageSpots();
        if (storageSpotsList.length > 0) {
          console.log(`Migrating ${storageSpotsList.length} storage spots...`);
          for (const spot of storageSpotsList) {
            const { id, createdAt, updatedAt, ...spotData } = spot;
            await tx.insert(storageSpots).values({
              ...spotData,
              id: id || randomUUID(),
              createdAt: createdAt || new Date(),
              updatedAt: updatedAt || new Date()
            }).onConflictDoNothing();
          }
        }

        // Migrate vehicles
        const vehiclesList = await mem.getVehicles();
        if (vehiclesList.length > 0) {
          console.log(`Migrating ${vehiclesList.length} vehicles...`);
          for (const vehicle of vehiclesList) {
            const { id, createdAt, updatedAt, ...vehicleData } = vehicle;
            await tx.insert(vehicles).values({
              ...vehicleData,
              id: id || randomUUID(),
              createdAt: createdAt || new Date(),
              updatedAt: updatedAt || new Date()
            }).onConflictDoNothing();
          }
        }

        console.log('Migration completed successfully!');
      } catch (error) {
        console.error('Migration failed:', error);
        throw error;
      }
    });
  }
}

// Choose storage implementation based on environment variable
const useDatabase = process.env.USE_DB === 'true';
export const storage: IStorage = useDatabase ? new DatabaseStorage() : new MemStorage();
