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
  type Template,
  type InsertTemplate,
  type InsertTemplateWithId,
  type Session,
  type InsertSession,
  type PasswordResetToken,
  type InsertPasswordResetToken,
  type TermedTech,
  type InsertTermedTech,
  type AllTech,
  type InsertAllTech,
  type SyncLog,
  type InsertSyncLog,
  type TruckInventory,
  type InsertTruckInventory,
  type TechVehicleAssignment,
  type InsertTechVehicleAssignment,
  type TechVehicleAssignmentHistory,
  type InsertTechVehicleAssignmentHistory,
  type TpmsCachedAssignment,
  type InsertTpmsCachedAssignment,
  type OnboardingHire,
  type InsertOnboardingHire,
  type IntegrationDataSource,
  type InsertIntegrationDataSource,
  type DataSourceField,
  type InsertDataSourceField,
  type MappingSet,
  type InsertMappingSet,
  type MappingNode,
  type InsertMappingNode,
  type FieldMapping,
  type InsertFieldMapping,
  type RolePermission,
  type InsertRolePermission,
  type RolePermissionSettings,
  type RentalSnapshot,
  type InsertRentalSnapshot,
  type CommunicationTemplate,
  type InsertCommunicationTemplate,
  type CommunicationWhitelistEntry,
  type InsertCommunicationWhitelist,
  type CommunicationLog,
  type InsertCommunicationLog,
  users,
  requests,
  apiConfigurations,
  activityLogs,
  queueItems,
  storageSpots,
  vehicles,
  templates,
  sessions,
  passwordResetTokens,
  termedTechs,
  allTechs,
  syncLogs,
  truckInventory,
  techVehicleAssignments,
  techVehicleAssignmentHistory,
  tpmsCachedAssignments,
  onboardingHires,
  integrationDataSources,
  dataSourceFields,
  mappingSets,
  mappingNodes,
  fieldMappings,
  rolePermissions,
  rentalSnapshots,
  communicationTemplates,
  communicationWhitelist,
  communicationLogs,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, inArray, desc, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import bcrypt from "bcrypt";

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

  // Tools Queue Module (Sprint 1: Schema + Task Creation)
  getToolsQueueItem(id: string): Promise<QueueItem | undefined>;
  getToolsQueueItems(): Promise<QueueItem[]>;
  createToolsQueueItem(item: InsertQueueItem): Promise<QueueItem>;
  updateToolsQueueItem(id: string, updates: Partial<QueueItem>): Promise<QueueItem | undefined>;
  assignToolsQueueItem(id: string, assigneeId: string): Promise<QueueItem | undefined>;
  startWorkToolsQueueItem(id: string, workerId: string): Promise<QueueItem | undefined>;
  completeToolsQueueItem(id: string, completedBy: string): Promise<QueueItem | undefined>;
  updateToolsQueueProgress(id: string, updates: Partial<Pick<QueueItem, 'taskToolsReturn' | 'taskIphoneReturn' | 'taskDisconnectedLine' | 'taskDisconnectedMPayment' | 'taskCloseSegnoOrders' | 'taskCreateShippingLabel' | 'carrier' | 'fleetRoutingDecision'>>): Promise<QueueItem | undefined>;
  updateToolsQueueNotificationStatus(id: string, sent: boolean): Promise<QueueItem | undefined>;
  
  // BYOV Blocking Logic (Sprint 2)
  getFleetTaskByWorkflowId(workflowId: string): Promise<QueueItem | undefined>;

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

  // Templates Module
  getTemplateById(id: string): Promise<Template | undefined>;
  getAllTemplates(): Promise<Template[]>;
  getTemplatesByWorkflow(workflowType: string, department: string): Promise<Template[]>;
  getTemplatesByDepartment(department: string): Promise<Template[]>;
  resolveLatestTemplate(workflowType: string, department: string): Promise<Template | undefined>;
  upsertTemplate(template: InsertTemplateWithId): Promise<Template>;
  updateTemplate(id: string, updates: Partial<Template>): Promise<Template | undefined>;
  toggleTemplateStatus(id: string): Promise<Template | undefined>;
  deleteTemplate(id: string): Promise<boolean>;

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
  findExistingOffboardingTasks(employeeId: string, techRacfId: string, daysWindow?: number): Promise<{ hasExisting: boolean; existingTasks: QueueItem[]; message?: string }>;
  checkByovEnrollmentDuplicates(ldap: string, email: string, currentTruckNumber: string, timeWindowMs?: number): Promise<{ isDuplicate: boolean; message?: string; existingTask?: QueueItem }>;
  getRecentQueueItemsByTimeWindow(modules: QueueModule[], timeWindowMs: number): Promise<{ module: QueueModule; items: QueueItem[] }[]>;
  findQueueItemsByDataMatch(modules: QueueModule[], searchFunction: (data: any) => boolean): Promise<{ module: QueueModule; items: QueueItem[] }[]>;

  // Sessions Module
  createSession(session: InsertSession): Promise<Session>;
  getSession(sessionId: string): Promise<Session | undefined>;
  deleteSession(sessionId: string): Promise<boolean>;
  updateSession(sessionId: string, updates: Partial<Session>): Promise<Session | undefined>;
  cleanExpiredSessions(): Promise<number>; // Returns number of sessions cleaned

  // Password Reset Tokens Module
  createPasswordResetToken(token: InsertPasswordResetToken): Promise<PasswordResetToken>;
  getPasswordResetToken(token: string): Promise<PasswordResetToken | undefined>;
  markPasswordResetTokenUsed(token: string): Promise<boolean>;
  deletePasswordResetToken(token: string): Promise<boolean>;
  cleanExpiredPasswordResetTokens(): Promise<number>; // Returns number of tokens cleaned

  // Termed Techs Module (Snowflake sync)
  getTermedTech(id: string): Promise<TermedTech | undefined>;
  getTermedTechByEmployeeId(employeeId: string): Promise<TermedTech | undefined>;
  getTermedTechs(): Promise<TermedTech[]>;
  getTermedTechsNeedingOffboarding(): Promise<TermedTech[]>;
  upsertTermedTech(tech: InsertTermedTech): Promise<TermedTech>;
  updateTermedTech(id: string, updates: Partial<TermedTech>): Promise<TermedTech | undefined>;
  markTermedTechOffboardingCreated(employeeId: string, queueItemId: string): Promise<TermedTech | undefined>;

  // All Techs Module (Snowflake sync - complete roster)
  getAllTech(id: string): Promise<AllTech | undefined>;
  getAllTechByEmployeeId(employeeId: string): Promise<AllTech | undefined>;
  getAllTechByTechRacfid(techRacfid: string): Promise<AllTech | undefined>;
  getAllTechs(): Promise<AllTech[]>;
  getTermedEmployeesFromRoster(daysBack?: number): Promise<AllTech[]>;
  getEmployeesNeedingOffboarding(daysBack?: number): Promise<AllTech[]>;
  markEmployeeOffboardingCreated(employeeId: string, taskId: string): Promise<AllTech | undefined>;
  upsertAllTech(tech: InsertAllTech): Promise<AllTech>;
  bulkUpsertAllTechs(techs: InsertAllTech[]): Promise<number>;
  updateAllTech(id: string, updates: Partial<AllTech>): Promise<AllTech | undefined>;

  // Sync Logs Module
  getSyncLog(id: string): Promise<SyncLog | undefined>;
  getSyncLogs(): Promise<SyncLog[]>;
  getLatestSyncLog(syncType: string): Promise<SyncLog | undefined>;
  createSyncLog(log: InsertSyncLog): Promise<SyncLog>;
  updateSyncLog(id: string, updates: Partial<SyncLog>): Promise<SyncLog | undefined>;

  // Truck Inventory Module (Snowflake sync)
  getTruckInventory(truck: string): Promise<TruckInventory[]>;
  getTruckInventoryByEnterpriseId(enterpriseId: string): Promise<TruckInventory[]>;
  getTruckInventoryByDistrict(district: string): Promise<TruckInventory[]>;
  getLatestTruckInventoryExtractDate(): Promise<string | null>;
  bulkUpsertTruckInventory(items: InsertTruckInventory[]): Promise<number>;
  clearTruckInventoryByExtractDate(extractDate: string): Promise<number>;

  // Tech Vehicle Assignments Module
  getTechVehicleAssignment(id: string): Promise<TechVehicleAssignment | undefined>;
  getTechVehicleAssignmentByTechRacfid(techRacfid: string): Promise<TechVehicleAssignment | undefined>;
  getTechVehicleAssignmentByTruckNo(truckNo: string): Promise<TechVehicleAssignment | undefined>;
  getTechVehicleAssignments(status?: string): Promise<TechVehicleAssignment[]>;
  createTechVehicleAssignment(assignment: InsertTechVehicleAssignment): Promise<TechVehicleAssignment>;
  updateTechVehicleAssignment(id: string, updates: Partial<TechVehicleAssignment>): Promise<TechVehicleAssignment | undefined>;
  deleteTechVehicleAssignment(id: string): Promise<boolean>;
  
  // Tech Vehicle Assignment History Module
  getTechVehicleAssignmentHistory(techRacfid: string): Promise<TechVehicleAssignmentHistory[]>;
  createTechVehicleAssignmentHistory(history: InsertTechVehicleAssignmentHistory): Promise<TechVehicleAssignmentHistory>;

  // TPMS Cached Assignments Module (API response caching with fallback)
  getTpmsCachedAssignment(lookupKey: string): Promise<TpmsCachedAssignment | undefined>;
  getTpmsCachedAssignmentByEnterpriseId(enterpriseId: string): Promise<TpmsCachedAssignment | undefined>;
  getTpmsCachedAssignmentByTruckNo(truckNo: string): Promise<TpmsCachedAssignment | undefined>;
  getAllTpmsCachedAssignments(): Promise<TpmsCachedAssignment[]>;
  upsertTpmsCachedAssignment(data: InsertTpmsCachedAssignment): Promise<TpmsCachedAssignment>;
  bulkUpsertTpmsCachedAssignments(items: InsertTpmsCachedAssignment[]): Promise<number>;
  clearTpmsCachedAssignments(): Promise<number>;
  updateTpmsCachedAssignment(lookupKey: string, updates: Partial<TpmsCachedAssignment>): Promise<TpmsCachedAssignment | undefined>;
  markTpmsCacheError(lookupKey: string, errorCode: number, errorMessage: string): Promise<TpmsCachedAssignment | undefined>;
  getStaleTPMSCache(maxAgeHours?: number): Promise<TpmsCachedAssignment[]>;

  // TPMS Sync State Module (tracks initial sync progress)
  getTpmsSyncState(): Promise<{ initialSyncComplete: boolean; status: string; vehiclesSynced: number; totalVehiclesToSync: number; vehiclesWithAssignments: number; lastSyncAt: Date | null } | null>;
  updateTpmsSyncState(updates: { initialSyncComplete?: boolean; status?: string; vehiclesSynced?: number; totalVehiclesToSync?: number; vehiclesWithAssignments?: number; vehiclesWithoutAssignments?: number; errorMessage?: string | null; initialSyncStartedAt?: Date; initialSyncCompletedAt?: Date; lastSyncAt?: Date }): Promise<void>;
  initializeTpmsSyncState(): Promise<void>;

  // Onboarding Hires Module (Weekly truck assignment tracking)
  getOnboardingHires(): Promise<OnboardingHire[]>;
  getOnboardingHire(id: string): Promise<OnboardingHire | undefined>;
  getOnboardingHireByNameAndDate(employeeName: string, serviceDate: string): Promise<OnboardingHire | undefined>;
  upsertOnboardingHire(hire: InsertOnboardingHire): Promise<OnboardingHire>;
  bulkUpsertOnboardingHires(hires: InsertOnboardingHire[]): Promise<number>;
  updateOnboardingHire(id: string, updates: Partial<OnboardingHire>): Promise<OnboardingHire | undefined>;
  deleteOnboardingHire(id: string): Promise<boolean>;

  // Field Mapping Module
  getIntegrationDataSources(): Promise<IntegrationDataSource[]>;
  getIntegrationDataSource(id: string): Promise<IntegrationDataSource | undefined>;
  createIntegrationDataSource(source: InsertIntegrationDataSource): Promise<IntegrationDataSource>;
  updateIntegrationDataSource(id: string, updates: Partial<IntegrationDataSource>): Promise<IntegrationDataSource | undefined>;
  deleteIntegrationDataSource(id: string): Promise<boolean>;
  
  getDataSourceFields(sourceId: string): Promise<DataSourceField[]>;
  getDataSourceField(id: string): Promise<DataSourceField | undefined>;
  createDataSourceField(field: InsertDataSourceField): Promise<DataSourceField>;
  createDataSourceFieldsBulk(fields: InsertDataSourceField[]): Promise<DataSourceField[]>;
  updateDataSourceField(id: string, updates: Partial<DataSourceField>): Promise<DataSourceField | undefined>;
  deleteDataSourceField(id: string): Promise<boolean>;
  
  getMappingSets(): Promise<MappingSet[]>;
  getMappingSet(id: string): Promise<MappingSet | undefined>;
  createMappingSet(set: InsertMappingSet): Promise<MappingSet>;
  updateMappingSet(id: string, updates: Partial<MappingSet>): Promise<MappingSet | undefined>;
  deleteMappingSet(id: string): Promise<boolean>;
  
  getMappingNodes(mappingSetId: string): Promise<MappingNode[]>;
  createMappingNode(node: InsertMappingNode): Promise<MappingNode>;
  updateMappingNode(id: string, updates: Partial<MappingNode>): Promise<MappingNode | undefined>;
  deleteMappingNode(id: string): Promise<boolean>;
  upsertMappingNodes(mappingSetId: string, nodes: InsertMappingNode[]): Promise<MappingNode[]>;
  
  getFieldMappings(mappingSetId: string): Promise<FieldMapping[]>;
  createFieldMapping(mapping: InsertFieldMapping): Promise<FieldMapping>;
  updateFieldMapping(id: string, updates: Partial<FieldMapping>): Promise<FieldMapping | undefined>;
  deleteFieldMapping(id: string): Promise<boolean>;
  upsertFieldMappings(mappingSetId: string, mappings: InsertFieldMapping[]): Promise<FieldMapping[]>;

  // Role Permissions Module
  getRolePermission(role: string): Promise<RolePermission | undefined>;
  getAllRolePermissions(): Promise<RolePermission[]>;
  upsertRolePermission(role: string, permissions: RolePermissionSettings): Promise<RolePermission>;
  updateRolePermission(role: string, permissions: RolePermissionSettings): Promise<RolePermission | undefined>;
  deleteRolePermission(role: string): Promise<boolean>;
  getUsersByRole(role: string): Promise<User[]>;

  // Rental Snapshots Module (Historical tracking for rental reduction dashboard)
  getRentalSnapshot(id: string): Promise<RentalSnapshot | undefined>;
  getRentalSnapshotByDate(date: string): Promise<RentalSnapshot | undefined>;
  getRentalSnapshots(daysBack?: number): Promise<RentalSnapshot[]>;
  createRentalSnapshot(snapshot: InsertRentalSnapshot): Promise<RentalSnapshot>;
  upsertRentalSnapshot(snapshot: InsertRentalSnapshot): Promise<RentalSnapshot>;
  deleteRentalSnapshot(id: string): Promise<boolean>;

  // Communication Hub Module
  getCommunicationTemplate(id: string): Promise<CommunicationTemplate | undefined>;
  getCommunicationTemplateByName(name: string): Promise<CommunicationTemplate | undefined>;
  getCommunicationTemplates(): Promise<CommunicationTemplate[]>;
  createCommunicationTemplate(template: InsertCommunicationTemplate): Promise<CommunicationTemplate>;
  updateCommunicationTemplate(id: string, updates: Partial<CommunicationTemplate>): Promise<CommunicationTemplate | undefined>;
  deleteCommunicationTemplate(id: string): Promise<boolean>;

  getWhitelistEntries(): Promise<CommunicationWhitelistEntry[]>;
  getWhitelistEntriesByType(type: 'email' | 'phone'): Promise<CommunicationWhitelistEntry[]>;
  isInWhitelist(type: 'email' | 'phone', value: string): Promise<boolean>;
  addToWhitelist(entry: InsertCommunicationWhitelist): Promise<CommunicationWhitelistEntry>;
  removeFromWhitelist(id: string): Promise<boolean>;

  getCommunicationLogs(limit?: number): Promise<CommunicationLog[]>;
  getCommunicationLogsByTemplate(templateId: string): Promise<CommunicationLog[]>;
  getCommunicationLogsByRecipient(recipient: string): Promise<CommunicationLog[]>;
  createCommunicationLog(log: InsertCommunicationLog): Promise<CommunicationLog>;
}

export class MemStorage implements IStorage {
  private requests: Map<string, Request>;
  private apiConfigurations: Map<string, ApiConfiguration>;
  private activityLogs: Map<string, ActivityLog>;
  private storageSpots: Map<string, StorageSpot>;
  private vehicles: Map<string, Vehicle>;
  private templates: Map<string, Template>;
  private sessions: Map<string, Session>;
  
  // Separate storage for each queue module
  private ntaoQueueItems: Map<string, QueueItem>;
  private assetsQueueItems: Map<string, QueueItem>;
  private inventoryQueueItems: Map<string, QueueItem>;
  private fleetQueueItems: Map<string, QueueItem>;
  private toolsQueueItems: Map<string, QueueItem>;

  constructor() {
    this.requests = new Map();
    this.apiConfigurations = new Map();
    this.activityLogs = new Map();
    this.storageSpots = new Map();
    this.vehicles = new Map();
    this.templates = new Map();
    this.sessions = new Map();
    
    // Initialize separate queue modules
    this.ntaoQueueItems = new Map();
    this.assetsQueueItems = new Map();
    this.inventoryQueueItems = new Map();
    this.fleetQueueItems = new Map();
    this.toolsQueueItems = new Map();
    
    this.initializeDefaultData();
  }


  private async initializeDefaultData() {
    // Only create demo users in development environment for security
    if (process.env.NODE_ENV === 'production') {
      console.log('Production environment detected - skipping demo user creation for security');
      return;
    }
    
    // Create Enterprise ID users with simplified role system (developer/agent only)
    const enterpriseUsers: User[] = [
      // EMERGENCY LOGIN - Use this account if other users can't login due to password requirements
      {
        id: "emergency-admin-2025-id",
        username: "emergency-admin",
        email: "emergency@sears.com",
        password: bcrypt.hashSync("emergency-admin-2025-login!", 10),
        role: "developer",
        departments: ['NTAO', 'ASSETS', 'INVENTORY', 'FLEET'],
        createdAt: new Date(),
      },
      // Demo users - all converted to agent role with department access
      {
        id: randomUUID(),
        username: "ENT1234",
        email: "requester@sears.com",
        password: bcrypt.hashSync("passwords", 10),
        role: "agent",
        departments: ['NTAO'],
        createdAt: new Date(),
      },
      {
        id: randomUUID(),
        username: "ENT1235",
        email: "approver@sears.com",
        password: bcrypt.hashSync("passwords", 10),
        role: "agent",
        departments: ['ASSETS', 'FLEET'],
        createdAt: new Date(),
      },
      {
        id: randomUUID(),
        username: "ADMIN123",
        email: "admin@sears.com",
        password: bcrypt.hashSync("passwords", 10),
        role: "developer",
        departments: ['NTAO', 'ASSETS', 'INVENTORY', 'FLEET'],
        createdAt: new Date(),
      },
      {
        id: randomUUID(),
        username: "AGENT001",
        email: "agent@sears.com",
        password: bcrypt.hashSync("passwords", 10),
        role: "agent",
        departments: ['ASSETS'],
        createdAt: new Date(),
      },
      {
        id: randomUUID(),
        username: "INVENTORY001",
        email: "inventory@sears.com",
        password: bcrypt.hashSync("passwords", 10),
        role: "agent",
        departments: ['INVENTORY'],
        createdAt: new Date(),
      },
      {
        id: randomUUID(),
        username: "FLEET001",
        email: "fleet@sears.com",
        password: bcrypt.hashSync("passwords", 10),
        role: "agent",
        departments: ['FLEET'],
        createdAt: new Date(),
      },
      {
        id: "2d5bcbc2-12bb-4ab3-9996-8b65cab409c8", // Fixed UUID for SUPER001 to maintain session consistency
        username: "SUPER001",
        email: "developer@sears.com",
        password: bcrypt.hashSync("passwords", 10),
        role: "developer",
        departments: ['NTAO', 'ASSETS', 'INVENTORY', 'FLEET'],
        createdAt: new Date(),
      },
      // Assets department employees
      {
        id: randomUUID(),
        username: "bob.banfill",
        email: "bob.banfill@sears.com",
        password: bcrypt.hashSync("passwords", 10),
        role: "agent",
        departments: ['ASSETS'],
        createdAt: new Date(),
      },
      {
        id: randomUUID(),
        username: "claudia.dominguez",
        email: "claudia.dominguez@sears.com",
        password: bcrypt.hashSync("passwords", 10),
        role: "agent",
        departments: ['ASSETS'],
        createdAt: new Date(),
      },
      {
        id: randomUUID(),
        username: "monica.jenkins",
        email: "monica.jenkins@sears.com",
        password: bcrypt.hashSync("passwords", 10),
        role: "agent",
        departments: ['ASSETS'],
        createdAt: new Date(),
      },
      // Inventory department employees
      {
        id: randomUUID(),
        username: "jennifer.dyer",
        email: "jennifer.dyer@sears.com",
        password: bcrypt.hashSync("passwords", 10),
        role: "agent",
        departments: ['INVENTORY'],
        createdAt: new Date(),
      },
      {
        id: randomUUID(),
        username: "andrea.catapano",
        email: "andrea.catapano@sears.com",
        password: bcrypt.hashSync("passwords", 10),
        role: "agent",
        departments: ['INVENTORY'],
        createdAt: new Date(),
      },
      {
        id: randomUUID(),
        username: "tashsa.corenevsky",
        email: "tashsa.corenevsky@sears.com",
        password: bcrypt.hashSync("passwords", 10),
        role: "agent",
        departments: ['INVENTORY'],
        createdAt: new Date(),
      },
      // Fleet department employees
      {
        id: randomUUID(),
        username: "cheryl.groce",
        email: "cheryl.groce@sears.com",
        password: bcrypt.hashSync("passwords", 10),
        role: "agent",
        departments: ['FLEET'],
        createdAt: new Date(),
      },
      {
        id: randomUUID(),
        username: "robert.delgaldo",
        email: "robert.delgaldo@sears.com",
        password: bcrypt.hashSync("passwords", 10),
        role: "agent",
        departments: ['FLEET'],
        createdAt: new Date(),
      },
      {
        id: randomUUID(),
        username: "carol.collins",
        email: "carol.collins@sears.com",
        password: bcrypt.hashSync("passwords", 10),
        role: "agent",
        departments: ['FLEET'],
        createdAt: new Date(),
      },
      // NTAO department employees
      {
        id: randomUUID(),
        username: "goutami.walsang",
        email: "goutami.walsang@sears.com",
        password: bcrypt.hashSync("passwords", 10),
        role: "agent",
        departments: ['NTAO'],
        createdAt: new Date(),
      },
      {
        id: randomUUID(),
        username: "oscar.santana",
        email: "oscar.santana@sears.com",
        password: bcrypt.hashSync("passwords", 10),
        role: "agent",
        departments: ['NTAO'],
        createdAt: new Date(),
      },
    ];
    
    // Add anonymous user for anonymous form submissions
    const anonymousUser: User = {
      id: "anonymous",
      username: "anonymous",
      email: "anonymous@system.com",
      password: "no-password", // Cannot be used for login
      role: "agent", // Minimal permissions
      departments: [], // No queue access for anonymous user
      createdAt: new Date(),
    };
    enterpriseUsers.push(anonymousUser);
    
    // Only add default users if they don't already exist in the database
    for (const user of enterpriseUsers) {
      try {
        const existingUser = await this.getUserByUsername(user.username);
        if (!existingUser) {
          await this.createUser({
            username: user.username,
            email: user.email,
            password: user.password,
            role: user.role,
            departments: user.departments,
          });
        }
      } catch (error) {
        // Ignore duplicate errors during initialization
        console.log(`User ${user.username} may already exist, skipping creation`);
      }
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
        isByov: false,
        vehicleType: 'company',
        fleetRoutingDecision: null,
        routingReceivedAt: null,
        blockedActions: null,
        taskToolsReturn: false,
        taskIphoneReturn: false,
        taskDisconnectedLine: false,
        taskDisconnectedMPayment: false,
        taskCloseSegnoOrders: false,
        taskCreateShippingLabel: false,
        carrier: null,
        toolAuditNotificationSent: false,
        toolAuditNotificationSentAt: null,
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
        isByov: false,
        vehicleType: 'company',
        fleetRoutingDecision: null,
        routingReceivedAt: null,
        blockedActions: null,
        taskToolsReturn: false,
        taskIphoneReturn: false,
        taskDisconnectedLine: false,
        taskDisconnectedMPayment: false,
        taskCloseSegnoOrders: false,
        taskCreateShippingLabel: false,
        carrier: null,
        toolAuditNotificationSent: false,
        toolAuditNotificationSentAt: null,
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
        isByov: false,
        vehicleType: 'company',
        fleetRoutingDecision: null,
        routingReceivedAt: null,
        blockedActions: null,
        taskToolsReturn: false,
        taskIphoneReturn: false,
        taskDisconnectedLine: false,
        taskDisconnectedMPayment: false,
        taskCloseSegnoOrders: false,
        taskCreateShippingLabel: false,
        carrier: null,
        toolAuditNotificationSent: false,
        toolAuditNotificationSentAt: null,
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
    try {
      const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
      return result[0] || undefined;
    } catch (error) {
      console.error('Error getting user by id:', error);
      throw error;
    }
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    try {
      const normalizedInput = username.toLowerCase();
      const result = await db.select().from(users).where(
        sql`LOWER(${users.username}) = ${normalizedInput} OR LOWER(${users.email}) = ${normalizedInput}`
      ).limit(1);
      return result[0] || undefined;
    } catch (error) {
      console.error('Error getting user by username:', error);
      throw error;
    }
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    try {
      const normalizedEmail = email.toLowerCase();
      const result = await db.select().from(users).where(
        sql`LOWER(${users.email}) = ${normalizedEmail}`
      ).limit(1);
      return result[0] || undefined;
    } catch (error) {
      console.error('Error getting user by email:', error);
      throw error;
    }
  }

  async getUsers(): Promise<User[]> {
    try {
      return await db.select().from(users);
    } catch (error) {
      console.error('Error getting all users:', error);
      throw error;
    }
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    try {
      const userToInsert = {
        ...insertUser,
        role: insertUser.role || "agent",
        departments: insertUser.departments || [],
      };
      const result = await db.insert(users).values(userToInsert).returning();
      return result[0];
    } catch (error) {
      console.error('Error creating user:', error);
      throw error;
    }
  }

  async updateUser(id: string, updates: Partial<User>): Promise<User | undefined> {
    try {
      const result = await db.update(users)
        .set(updates)
        .where(eq(users.id, id))
        .returning();
      return result[0] || undefined;
    } catch (error) {
      console.error('Error updating user:', error);
      throw error;
    }
  }

  async deleteUser(id: string): Promise<boolean> {
    try {
      const result = await db.delete(users).where(eq(users.id, id));
      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      console.error('Error deleting user:', error);
      throw error;
    }
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

  // Sessions Module
  async createSession(insertSession: InsertSession): Promise<Session> {
    const session: Session = {
      ...insertSession,
      createdAt: new Date(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async getSession(sessionId: string): Promise<Session | undefined> {
    return this.sessions.get(sessionId);
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    return this.sessions.delete(sessionId);
  }

  async updateSession(sessionId: string, updates: Partial<Session>): Promise<Session | undefined> {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    
    const updatedSession = { ...session, ...updates };
    this.sessions.set(sessionId, updatedSession);
    return updatedSession;
  }

  async cleanExpiredSessions(): Promise<number> {
    const now = new Date();
    let cleanedCount = 0;
    
    // Convert to array to avoid iteration issues
    const sessionEntries = Array.from(this.sessions.entries());
    for (const [sessionId, session] of sessionEntries) {
      if (session.expiresAt <= now) {
        this.sessions.delete(sessionId);
        cleanedCount++;
      }
    }
    
    return cleanedCount;
  }

  // Password Reset Tokens Module - In-memory implementation
  private passwordResetTokensMap = new Map<string, PasswordResetToken>();

  async createPasswordResetToken(insertToken: InsertPasswordResetToken): Promise<PasswordResetToken> {
    const token: PasswordResetToken = {
      id: randomUUID(),
      token: insertToken.token,
      userId: insertToken.userId,
      expiresAt: insertToken.expiresAt,
      usedAt: null,
      createdAt: new Date(),
    };
    this.passwordResetTokensMap.set(insertToken.token, token);
    return token;
  }

  async getPasswordResetToken(token: string): Promise<PasswordResetToken | undefined> {
    return this.passwordResetTokensMap.get(token);
  }

  async markPasswordResetTokenUsed(token: string): Promise<boolean> {
    const existing = this.passwordResetTokensMap.get(token);
    if (!existing) return false;
    existing.usedAt = new Date();
    return true;
  }

  async deletePasswordResetToken(token: string): Promise<boolean> {
    return this.passwordResetTokensMap.delete(token);
  }

  async cleanExpiredPasswordResetTokens(): Promise<number> {
    const now = new Date();
    let cleanedCount = 0;
    
    const entries = Array.from(this.passwordResetTokensMap.entries());
    for (const [token, data] of entries) {
      if (data.expiresAt <= now || data.usedAt) {
        this.passwordResetTokensMap.delete(token);
        cleanedCount++;
      }
    }
    
    return cleanedCount;
  }

  // Termed Techs Module - Stub implementation for MemStorage
  // These methods are primarily used with database storage for Snowflake sync
  async getTermedTech(_id: string): Promise<TermedTech | undefined> {
    return undefined; // Not implemented in memory storage
  }

  async getTermedTechByEmployeeId(_employeeId: string): Promise<TermedTech | undefined> {
    return undefined; // Not implemented in memory storage
  }

  async getTermedTechs(): Promise<TermedTech[]> {
    return []; // Not implemented in memory storage
  }

  async getTermedTechsNeedingOffboarding(): Promise<TermedTech[]> {
    return []; // Not implemented in memory storage
  }

  async upsertTermedTech(_tech: InsertTermedTech): Promise<TermedTech> {
    throw new Error("Termed techs not implemented in memory storage - use database storage");
  }

  async updateTermedTech(_id: string, _updates: Partial<TermedTech>): Promise<TermedTech | undefined> {
    return undefined; // Not implemented in memory storage
  }

  async markTermedTechOffboardingCreated(_employeeId: string, _queueItemId: string): Promise<TermedTech | undefined> {
    return undefined; // Not implemented in memory storage
  }

  // All Techs Module - Stub implementation for MemStorage
  async getAllTech(_id: string): Promise<AllTech | undefined> {
    return undefined; // Not implemented in memory storage
  }

  async getAllTechByEmployeeId(_employeeId: string): Promise<AllTech | undefined> {
    return undefined; // Not implemented in memory storage
  }

  async getAllTechByTechRacfid(_techRacfid: string): Promise<AllTech | undefined> {
    return undefined; // Not implemented in memory storage
  }

  async getAllTechs(): Promise<AllTech[]> {
    return []; // Not implemented in memory storage
  }

  async getTermedEmployeesFromRoster(_daysBack?: number): Promise<AllTech[]> {
    return []; // Not implemented in memory storage
  }

  async getEmployeesNeedingOffboarding(_daysBack?: number): Promise<AllTech[]> {
    return []; // Not implemented in memory storage
  }

  async markEmployeeOffboardingCreated(_employeeId: string, _taskId: string): Promise<AllTech | undefined> {
    return undefined; // Not implemented in memory storage
  }

  async upsertAllTech(_tech: InsertAllTech): Promise<AllTech> {
    throw new Error("All techs not implemented in memory storage - use database storage");
  }

  async bulkUpsertAllTechs(_techs: InsertAllTech[]): Promise<number> {
    throw new Error("All techs not implemented in memory storage - use database storage");
  }

  async updateAllTech(_id: string, _updates: Partial<AllTech>): Promise<AllTech | undefined> {
    return undefined; // Not implemented in memory storage
  }

  // Sync Logs Module - Stub implementation for MemStorage
  async getSyncLog(_id: string): Promise<SyncLog | undefined> {
    return undefined; // Not implemented in memory storage
  }

  async getSyncLogs(): Promise<SyncLog[]> {
    return []; // Not implemented in memory storage
  }

  async getLatestSyncLog(_syncType: string): Promise<SyncLog | undefined> {
    return undefined; // Not implemented in memory storage
  }

  async createSyncLog(_log: InsertSyncLog): Promise<SyncLog> {
    throw new Error("Sync logs not implemented in memory storage - use database storage");
  }

  async updateSyncLog(_id: string, _updates: Partial<SyncLog>): Promise<SyncLog | undefined> {
    return undefined; // Not implemented in memory storage
  }

  // Truck Inventory Module - Stub implementation for MemStorage
  async getTruckInventory(_truck: string): Promise<TruckInventory[]> {
    return []; // Not implemented in memory storage
  }

  async getTruckInventoryByEnterpriseId(_enterpriseId: string): Promise<TruckInventory[]> {
    return []; // Not implemented in memory storage
  }

  async getTruckInventoryByDistrict(_district: string): Promise<TruckInventory[]> {
    return []; // Not implemented in memory storage
  }

  async getLatestTruckInventoryExtractDate(): Promise<string | null> {
    return null; // Not implemented in memory storage
  }

  async bulkUpsertTruckInventory(_items: InsertTruckInventory[]): Promise<number> {
    throw new Error("Truck inventory not implemented in memory storage - use database storage");
  }

  async clearTruckInventoryByExtractDate(_extractDate: string): Promise<number> {
    return 0; // Not implemented in memory storage
  }

  // Tech Vehicle Assignments Module - Stub implementation for MemStorage
  async getTechVehicleAssignment(_id: string): Promise<TechVehicleAssignment | undefined> {
    return undefined; // Not implemented in memory storage
  }

  async getTechVehicleAssignmentByTechRacfid(_techRacfid: string): Promise<TechVehicleAssignment | undefined> {
    return undefined; // Not implemented in memory storage
  }

  async getTechVehicleAssignmentByTruckNo(_truckNo: string): Promise<TechVehicleAssignment | undefined> {
    return undefined; // Not implemented in memory storage
  }

  async getTechVehicleAssignments(_status?: string): Promise<TechVehicleAssignment[]> {
    return []; // Not implemented in memory storage
  }

  async createTechVehicleAssignment(_assignment: InsertTechVehicleAssignment): Promise<TechVehicleAssignment> {
    throw new Error("Tech vehicle assignments not implemented in memory storage - use database storage");
  }

  async updateTechVehicleAssignment(_id: string, _updates: Partial<TechVehicleAssignment>): Promise<TechVehicleAssignment | undefined> {
    return undefined; // Not implemented in memory storage
  }

  async deleteTechVehicleAssignment(_id: string): Promise<boolean> {
    return false; // Not implemented in memory storage
  }

  // Tech Vehicle Assignment History Module - Stub implementation for MemStorage
  async getTechVehicleAssignmentHistory(_techRacfid: string): Promise<TechVehicleAssignmentHistory[]> {
    return []; // Not implemented in memory storage
  }

  async createTechVehicleAssignmentHistory(_history: InsertTechVehicleAssignmentHistory): Promise<TechVehicleAssignmentHistory> {
    throw new Error("Tech vehicle assignment history not implemented in memory storage - use database storage");
  }

  // TPMS Cached Assignments Module - Stub implementation for MemStorage
  async getTpmsCachedAssignment(_lookupKey: string): Promise<TpmsCachedAssignment | undefined> {
    return undefined; // Not implemented in memory storage
  }

  async getTpmsCachedAssignmentByEnterpriseId(_enterpriseId: string): Promise<TpmsCachedAssignment | undefined> {
    return undefined; // Not implemented in memory storage
  }

  async getTpmsCachedAssignmentByTruckNo(_truckNo: string): Promise<TpmsCachedAssignment | undefined> {
    return undefined; // Not implemented in memory storage
  }

  async getAllTpmsCachedAssignments(): Promise<TpmsCachedAssignment[]> {
    return []; // Not implemented in memory storage
  }

  async upsertTpmsCachedAssignment(_data: InsertTpmsCachedAssignment): Promise<TpmsCachedAssignment> {
    throw new Error("TPMS cache not implemented in memory storage - use database storage");
  }

  async bulkUpsertTpmsCachedAssignments(_items: InsertTpmsCachedAssignment[]): Promise<number> {
    return 0; // Not implemented in memory storage
  }

  async clearTpmsCachedAssignments(): Promise<number> {
    return 0; // Not implemented in memory storage
  }

  async updateTpmsCachedAssignment(_lookupKey: string, _updates: Partial<TpmsCachedAssignment>): Promise<TpmsCachedAssignment | undefined> {
    return undefined; // Not implemented in memory storage
  }

  async markTpmsCacheError(_lookupKey: string, _errorCode: number, _errorMessage: string): Promise<TpmsCachedAssignment | undefined> {
    return undefined; // Not implemented in memory storage
  }

  async getStaleTPMSCache(_maxAgeHours?: number): Promise<TpmsCachedAssignment[]> {
    return []; // Not implemented in memory storage
  }

  async getTpmsSyncState(): Promise<{ initialSyncComplete: boolean; status: string; vehiclesSynced: number; totalVehiclesToSync: number; vehiclesWithAssignments: number; lastSyncAt: Date | null } | null> {
    return null; // Not implemented in memory storage
  }

  async updateTpmsSyncState(_updates: any): Promise<void> {
    // Not implemented in memory storage
  }

  async initializeTpmsSyncState(): Promise<void> {
    // Not implemented in memory storage
  }

  // Onboarding Hires (not implemented in memory storage)
  async getOnboardingHires(): Promise<OnboardingHire[]> {
    return [];
  }

  async getOnboardingHire(_id: string): Promise<OnboardingHire | undefined> {
    return undefined;
  }

  async getOnboardingHireByNameAndDate(_employeeName: string, _serviceDate: string): Promise<OnboardingHire | undefined> {
    return undefined;
  }

  async upsertOnboardingHire(_hire: InsertOnboardingHire): Promise<OnboardingHire> {
    throw new Error("Onboarding hires not implemented in memory storage");
  }

  async bulkUpsertOnboardingHires(_hires: InsertOnboardingHire[]): Promise<number> {
    return 0;
  }

  async updateOnboardingHire(_id: string, _updates: Partial<OnboardingHire>): Promise<OnboardingHire | undefined> {
    return undefined;
  }

  async deleteOnboardingHire(_id: string): Promise<boolean> {
    return false;
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
    
    const allUsers = await this.getUsers();
    const activeUsers = allUsers.length;

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
      isByov: insertItem.isByov ?? false,
      fleetRoutingDecision: insertItem.fleetRoutingDecision || null,
      routingReceivedAt: insertItem.routingReceivedAt || null,
      blockedActions: insertItem.blockedActions || null,
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
      isByov: insertItem.isByov ?? false,
      fleetRoutingDecision: insertItem.fleetRoutingDecision || null,
      routingReceivedAt: insertItem.routingReceivedAt || null,
      blockedActions: insertItem.blockedActions || null,
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
      isByov: insertItem.isByov ?? false,
      fleetRoutingDecision: insertItem.fleetRoutingDecision || null,
      routingReceivedAt: insertItem.routingReceivedAt || null,
      blockedActions: insertItem.blockedActions || null,
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
      isByov: insertItem.isByov ?? false,
      fleetRoutingDecision: insertItem.fleetRoutingDecision || null,
      routingReceivedAt: insertItem.routingReceivedAt || null,
      blockedActions: insertItem.blockedActions || null,
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

  // Tools Queue Module (Sprint 1: Schema + Task Creation)
  async getToolsQueueItem(id: string): Promise<QueueItem | undefined> {
    return this.toolsQueueItems.get(id);
  }

  async getToolsQueueItems(): Promise<QueueItem[]> {
    return Array.from(this.toolsQueueItems.values()).sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async createToolsQueueItem(insertItem: InsertQueueItem): Promise<QueueItem> {
    const id = randomUUID();
    const item: QueueItem = {
      ...insertItem,
      status: insertItem.status || "pending",
      priority: insertItem.priority || "medium",
      assignedTo: insertItem.assignedTo || null,
      department: "Tools",
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
      isByov: insertItem.isByov || false,
      fleetRoutingDecision: insertItem.fleetRoutingDecision || null,
      routingReceivedAt: insertItem.routingReceivedAt || null,
      blockedActions: insertItem.blockedActions || null,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.toolsQueueItems.set(id, item);
    return item;
  }

  async updateToolsQueueItem(id: string, updates: Partial<QueueItem>): Promise<QueueItem | undefined> {
    const item = this.toolsQueueItems.get(id);
    if (!item) return undefined;
    
    const updatedItem = { ...item, ...updates, updatedAt: new Date() };
    this.toolsQueueItems.set(id, updatedItem);
    return updatedItem;
  }

  async assignToolsQueueItem(id: string, assigneeId: string): Promise<QueueItem | undefined> {
    const item = this.toolsQueueItems.get(id);
    if (!item) return undefined;
    
    const updatedItem = { 
      ...item, 
      assignedTo: assigneeId,
      status: "in_progress",
      updatedAt: new Date() 
    };
    this.toolsQueueItems.set(id, updatedItem);
    return updatedItem;
  }

  async startWorkToolsQueueItem(id: string, workerId: string): Promise<QueueItem | undefined> {
    const item = this.toolsQueueItems.get(id);
    if (!item) return undefined;
    
    if (item.assignedTo !== workerId || (item.status !== "pending" && item.status !== "in_progress")) {
      return undefined;
    }
    
    if (item.status === "in_progress") {
      return item;
    }
    
    const updatedItem = { 
      ...item, 
      status: "in_progress",
      updatedAt: new Date() 
    };
    this.toolsQueueItems.set(id, updatedItem);
    return updatedItem;
  }

  async completeToolsQueueItem(id: string, completedBy: string): Promise<QueueItem | undefined> {
    const item = this.toolsQueueItems.get(id);
    if (!item) return undefined;
    
    const updatedItem = { 
      ...item, 
      status: "completed",
      completedAt: new Date(),
      updatedAt: new Date() 
    };
    this.toolsQueueItems.set(id, updatedItem);

    // Check if this completes a workflow step and trigger next step
    await this.triggerNextWorkflowStep(updatedItem);
    
    return updatedItem;
  }

  async updateToolsQueueProgress(id: string, updates: Partial<Pick<QueueItem, 'taskToolsReturn' | 'taskIphoneReturn' | 'taskDisconnectedLine' | 'taskDisconnectedMPayment' | 'taskCloseSegnoOrders' | 'taskCreateShippingLabel' | 'carrier' | 'fleetRoutingDecision'>>): Promise<QueueItem | undefined> {
    const item = this.toolsQueueItems.get(id);
    if (!item) return undefined;
    
    const updatedItem = {
      ...item,
      ...updates,
      updatedAt: new Date()
    };
    this.toolsQueueItems.set(id, updatedItem);
    return updatedItem;
  }

  async updateToolsQueueNotificationStatus(id: string, sent: boolean): Promise<QueueItem | undefined> {
    const item = this.toolsQueueItems.get(id);
    if (!item) return undefined;
    
    const updatedItem = {
      ...item,
      toolAuditNotificationSent: sent,
      toolAuditNotificationSentAt: sent ? new Date() : null,
      updatedAt: new Date()
    };
    this.toolsQueueItems.set(id, updatedItem);
    return updatedItem;
  }

  async getFleetTaskByWorkflowId(workflowId: string): Promise<QueueItem | undefined> {
    const items = Array.from(this.fleetQueueItems.values());
    for (const item of items) {
      if (item.workflowId === workflowId && item.department === 'FLEET') {
        return item;
      }
    }
    return undefined;
  }


  // Workflow automation function - triggers Phase 2 after ALL Day 0 tasks complete
  async triggerNextWorkflowStep(completedItem: QueueItem): Promise<void> {
    // Only proceed if this item is part of a workflow
    if (!completedItem.workflowId) return;

    try {
      const itemData = completedItem.data ? JSON.parse(completedItem.data) : null;

      // Two-Phase Offboarding System:
      // Phase 1 (Day 0): Tasks 1-5 run in parallel (NTAO, Equipment, Fleet, Inventory, Tools)
      // Phase 2 (Day 1-5): Auto-generate Fleet follow-up tasks ONLY after ALL Day 0 tasks complete
      
      // Check if this is a Day 0 task completion (Day 0 tasks don't require workflowStep)
      if (itemData && itemData.isDay0Task && itemData.phase === "day0") {
        console.log(`Day 0 task detected: ${completedItem.title} - triggering Phase 2 check`);
        await this.checkAllDay0TasksAndTriggerPhase2(completedItem);
        return;
      }

      // For legacy workflow support, require workflowStep
      if (!completedItem.workflowStep) return;
      if (!itemData) return;

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
      const allToolsTasks = await this.getToolsQueueItems();

      // Find all Day 0 tasks for this workflow (5 total: NTAO, Assets, Fleet, Inventory, Tools)
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
        ),
        ...allToolsTasks.filter(task => 
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

      if (totalDay0Tasks === 5 && completedCount === 5) {
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
      
      // Extract tech name and vehicle number from various possible locations in trigger data
      const techName = triggerData.techName || triggerData.employee?.name || 'Unknown Technician';
      const vehicleNumber = triggerData.vehicleNumber || triggerData.vehicle?.vehicleNumber || triggerData.vehicle?.truckNo || 'Unknown Vehicle';
      const employeeId = triggerData.employeeId || triggerData.employee?.racfId || triggerData.racfId || '';
      
      console.log(`Creating Phase 2 Fleet tasks for ${techName} (vehicle: ${vehicleNumber}, type: ${vehicleType})`);

      // Phase 2 Task 1: Vehicle Retrieval and Transport (Day 1-3)
      const retrievalTask = {
        workflowType: "offboarding",
        title: `Phase 2: Vehicle Retrieval - ${techName}`,
        description: `PHASE 2 (Day 1-3): Retrieve vehicle from ${techName} and transport to appropriate location. Vehicle: ${vehicleNumber}. Employee ID: ${employeeId}. All Day 0 tasks completed - proceed with Phase 2.`,
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
          techName: techName,
          vehicleNumber: vehicleNumber,
          employeeId: employeeId,
          ...triggerData,
          instructions: this.getVehicleRetrievalInstructions(vehicleType)
        })
      };

      // Phase 2 Task 2: Shop Coordination (Day 3-5)
      const shopTask = {
        workflowType: "offboarding",
        title: `Phase 2: Shop Coordination - ${techName}`,
        description: `PHASE 2 (Day 3-5): Coordinate vehicle processing at shop/service center. Vehicle: ${vehicleNumber} (${techName}). Complete maintenance, inventory, and preparation for reassignment.`,
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
          techName: techName,
          vehicleNumber: vehicleNumber,
          employeeId: employeeId,
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
      "Contact Employee to schedule vehicle pickup",
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

  // Templates Module
  async getTemplateById(id: string): Promise<Template | undefined> {
    return this.templates.get(id);
  }

  async getAllTemplates(): Promise<Template[]> {
    return Array.from(this.templates.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getTemplatesByWorkflow(workflowType: string, department: string): Promise<Template[]> {
    const templates: Template[] = [];
    for (const template of Array.from(this.templates.values())) {
      if (template.workflowType === workflowType && template.department === department && template.isActive) {
        templates.push(template);
      }
    }
    // Sort by semantic version (highest first)
    return templates.sort((a, b) => this.compareVersions(b.version, a.version));
  }

  async resolveLatestTemplate(workflowType: string, department: string): Promise<Template | undefined> {
    const templates = await this.getTemplatesByWorkflow(workflowType, department);
    return templates.length > 0 ? templates[0] : undefined; // First is highest version
  }

  private compareVersions(a: string, b: string): number {
    // Parse semantic versions (e.g., "1.0", "1.2.3", "2.0.1")
    const parseVersion = (version: string): number[] => {
      return version.split('.').map(part => parseInt(part, 10) || 0);
    };
    
    const versionA = parseVersion(a);
    const versionB = parseVersion(b);
    
    // Compare each version component
    const maxLength = Math.max(versionA.length, versionB.length);
    for (let i = 0; i < maxLength; i++) {
      const partA = versionA[i] || 0;
      const partB = versionB[i] || 0;
      
      if (partA > partB) return 1;
      if (partA < partB) return -1;
    }
    
    return 0; // Equal versions
  }

  async getTemplatesByDepartment(department: string): Promise<Template[]> {
    const templates: Template[] = [];
    for (const template of Array.from(this.templates.values())) {
      if (template.department === department && template.isActive) {
        templates.push(template);
      }
    }
    return templates;
  }

  async upsertTemplate(insertTemplate: InsertTemplateWithId): Promise<Template> {
    const template: Template = {
      ...insertTemplate,
      isActive: insertTemplate.isActive ?? true,
      createdAt: this.templates.get(insertTemplate.id)?.createdAt || new Date(),
    };
    this.templates.set(insertTemplate.id, template);
    return template;
  }

  async updateTemplate(id: string, updates: Partial<Template>): Promise<Template | undefined> {
    const existing = this.templates.get(id);
    if (!existing) return undefined;
    
    // Whitelist only updateable fields to prevent mutation of immutable fields (id, createdAt)
    const allowedFields = ['name', 'department', 'workflowType', 'version', 'content', 'isActive'] as const;
    const safeUpdates: Partial<Template> = {};
    
    for (const field of allowedFields) {
      if (field in updates) {
        (safeUpdates as any)[field] = updates[field];
      }
    }
    
    const updated: Template = { ...existing, ...safeUpdates };
    this.templates.set(id, updated);
    return updated;
  }

  async toggleTemplateStatus(id: string): Promise<Template | undefined> {
    const existing = this.templates.get(id);
    if (!existing) return undefined;
    
    const updated: Template = { ...existing, isActive: !existing.isActive };
    this.templates.set(id, updated);
    return updated;
  }

  async deleteTemplate(id: string): Promise<boolean> {
    return this.templates.delete(id);
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
              
              if (itemData && typeof itemData === 'object' && (itemData as any).workflowType === 'offboarding_sequence') {
                const itemEmployeeId = (itemData as any)?.employee?.employeeId || (itemData as any)?.employeeId;
                const itemTechRacfId = (itemData as any)?.employee?.racfId || (itemData as any)?.techRacfId || (itemData as any)?.employee?.enterpriseId;
                
                const employeeIdMatch = employeeId && itemEmployeeId && employeeId === itemEmployeeId;
                const techRacfIdMatch = techRacfId && itemTechRacfId && techRacfId === itemTechRacfId;
                
                if (employeeIdMatch || techRacfIdMatch) {
                  return {
                    isDuplicate: true,
                    message: `Duplicate offboarding workflow detected. A recent offboarding task already exists for this employee (${employeeIdMatch ? `Employee ID: ${employeeId}` : `Enterprise ID: ${techRacfId}`}) in ${module.toUpperCase()} queue.`,
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

  async findExistingOffboardingTasks(
    employeeId: string, 
    techRacfId: string, 
    daysWindow: number = 45
  ): Promise<{ hasExisting: boolean; existingTasks: QueueItem[]; message?: string }> {
    try {
      const cutoffTime = new Date(Date.now() - (daysWindow * 24 * 60 * 60 * 1000));
      const existingTasks: QueueItem[] = [];
      const modules: QueueModule[] = ['ntao', 'assets', 'inventory', 'fleet'];
      
      for (const module of modules) {
        const items = await this.getQueueItemsByModule(module);
        
        for (const item of items) {
          if (item.workflowType !== 'offboarding') continue;
          
          try {
            let itemData = item.data;
            if (typeof itemData === 'string') {
              itemData = JSON.parse(itemData);
            }
            
            // Check if this task belongs to the employee
            const techInfo = (itemData as any)?.technician || (itemData as any)?.employee;
            const itemEmployeeId = techInfo?.employeeId || (itemData as any)?.employeeId;
            const itemTechRacfId = techInfo?.techRacfid || techInfo?.enterpriseId || techInfo?.racfId || (itemData as any)?.techRacfId;
            
            const employeeIdMatch = employeeId && itemEmployeeId && employeeId === itemEmployeeId;
            const techRacfIdMatch = techRacfId && itemTechRacfId && techRacfId.toLowerCase() === itemTechRacfId.toLowerCase();
            
            if (employeeIdMatch || techRacfIdMatch) {
              const isOpen = item.status === 'pending' || item.status === 'in_progress';
              const isRecent = item.createdAt && new Date(item.createdAt) >= cutoffTime;
              
              if (isOpen || isRecent) {
                existingTasks.push(item);
              }
            }
          } catch (parseError) {
            console.error('Error parsing queue item data for existing task check:', parseError);
            continue;
          }
        }
      }
      
      if (existingTasks.length > 0) {
        const openCount = existingTasks.filter(t => t.status === 'pending' || t.status === 'in_progress').length;
        return {
          hasExisting: true,
          existingTasks,
          message: `Found ${existingTasks.length} existing offboarding task(s) for this employee (${openCount} open, created within last ${daysWindow} days).`
        };
      }
      
      return { hasExisting: false, existingTasks: [] };
    } catch (error) {
      console.error('Error finding existing offboarding tasks:', error);
      return { hasExisting: false, existingTasks: [] };
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
              
              if (!isByovWorkflow && itemData && typeof itemData === 'object') {
                isByovWorkflow = (itemData as any)?.workflowId?.startsWith('byov-') ||
                  ['van_assignment', 'van_unassignment', 'system_updates', 'stop_shipment', 'setup_shipment'].includes(item.workflowType);
              }
              
              if (isByovWorkflow && itemData && typeof itemData === 'object' && (itemData as any)?.techInfo) {
                const itemLdap = (itemData as any).techInfo.ldap;
                const itemEmail = (itemData as any).techInfo.email;
                const itemTruckNumber = (itemData as any).techInfo.currentTruckNumber;
                
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

  // Field Mapping Module - Stub implementations (use DatabaseStorage for full functionality)
  async getIntegrationDataSources(): Promise<IntegrationDataSource[]> {
    throw new Error("MemStorage does not support field mapping. Use DatabaseStorage.");
  }
  async getIntegrationDataSource(_id: string): Promise<IntegrationDataSource | undefined> {
    throw new Error("MemStorage does not support field mapping. Use DatabaseStorage.");
  }
  async createIntegrationDataSource(_source: InsertIntegrationDataSource): Promise<IntegrationDataSource> {
    throw new Error("MemStorage does not support field mapping. Use DatabaseStorage.");
  }
  async updateIntegrationDataSource(_id: string, _updates: Partial<IntegrationDataSource>): Promise<IntegrationDataSource | undefined> {
    throw new Error("MemStorage does not support field mapping. Use DatabaseStorage.");
  }
  async deleteIntegrationDataSource(_id: string): Promise<boolean> {
    throw new Error("MemStorage does not support field mapping. Use DatabaseStorage.");
  }
  async getDataSourceFields(_sourceId: string): Promise<DataSourceField[]> {
    throw new Error("MemStorage does not support field mapping. Use DatabaseStorage.");
  }
  async getDataSourceField(_id: string): Promise<DataSourceField | undefined> {
    throw new Error("MemStorage does not support field mapping. Use DatabaseStorage.");
  }
  async createDataSourceField(_field: InsertDataSourceField): Promise<DataSourceField> {
    throw new Error("MemStorage does not support field mapping. Use DatabaseStorage.");
  }
  async createDataSourceFieldsBulk(_fields: InsertDataSourceField[]): Promise<DataSourceField[]> {
    throw new Error("MemStorage does not support field mapping. Use DatabaseStorage.");
  }
  async updateDataSourceField(_id: string, _updates: Partial<DataSourceField>): Promise<DataSourceField | undefined> {
    throw new Error("MemStorage does not support field mapping. Use DatabaseStorage.");
  }
  async deleteDataSourceField(_id: string): Promise<boolean> {
    throw new Error("MemStorage does not support field mapping. Use DatabaseStorage.");
  }
  async getMappingSets(): Promise<MappingSet[]> {
    throw new Error("MemStorage does not support field mapping. Use DatabaseStorage.");
  }
  async getMappingSet(_id: string): Promise<MappingSet | undefined> {
    throw new Error("MemStorage does not support field mapping. Use DatabaseStorage.");
  }
  async createMappingSet(_set: InsertMappingSet): Promise<MappingSet> {
    throw new Error("MemStorage does not support field mapping. Use DatabaseStorage.");
  }
  async updateMappingSet(_id: string, _updates: Partial<MappingSet>): Promise<MappingSet | undefined> {
    throw new Error("MemStorage does not support field mapping. Use DatabaseStorage.");
  }
  async deleteMappingSet(_id: string): Promise<boolean> {
    throw new Error("MemStorage does not support field mapping. Use DatabaseStorage.");
  }
  async getMappingNodes(_mappingSetId: string): Promise<MappingNode[]> {
    throw new Error("MemStorage does not support field mapping. Use DatabaseStorage.");
  }
  async createMappingNode(_node: InsertMappingNode): Promise<MappingNode> {
    throw new Error("MemStorage does not support field mapping. Use DatabaseStorage.");
  }
  async updateMappingNode(_id: string, _updates: Partial<MappingNode>): Promise<MappingNode | undefined> {
    throw new Error("MemStorage does not support field mapping. Use DatabaseStorage.");
  }
  async deleteMappingNode(_id: string): Promise<boolean> {
    throw new Error("MemStorage does not support field mapping. Use DatabaseStorage.");
  }
  async upsertMappingNodes(_mappingSetId: string, _nodes: InsertMappingNode[]): Promise<MappingNode[]> {
    throw new Error("MemStorage does not support field mapping. Use DatabaseStorage.");
  }
  async getFieldMappings(_mappingSetId: string): Promise<FieldMapping[]> {
    throw new Error("MemStorage does not support field mapping. Use DatabaseStorage.");
  }
  async createFieldMapping(_mapping: InsertFieldMapping): Promise<FieldMapping> {
    throw new Error("MemStorage does not support field mapping. Use DatabaseStorage.");
  }
  async updateFieldMapping(_id: string, _updates: Partial<FieldMapping>): Promise<FieldMapping | undefined> {
    throw new Error("MemStorage does not support field mapping. Use DatabaseStorage.");
  }
  async deleteFieldMapping(_id: string): Promise<boolean> {
    throw new Error("MemStorage does not support field mapping. Use DatabaseStorage.");
  }
  async upsertFieldMappings(_mappingSetId: string, _mappings: InsertFieldMapping[]): Promise<FieldMapping[]> {
    throw new Error("MemStorage does not support field mapping. Use DatabaseStorage.");
  }

  // Role Permissions Module
  async getRolePermission(_role: string): Promise<RolePermission | undefined> {
    throw new Error("MemStorage does not support role permissions. Use DatabaseStorage.");
  }
  async getAllRolePermissions(): Promise<RolePermission[]> {
    throw new Error("MemStorage does not support role permissions. Use DatabaseStorage.");
  }
  async upsertRolePermission(_role: string, _permissions: RolePermissionSettings): Promise<RolePermission> {
    throw new Error("MemStorage does not support role permissions. Use DatabaseStorage.");
  }
  async updateRolePermission(_role: string, _permissions: RolePermissionSettings): Promise<RolePermission | undefined> {
    throw new Error("MemStorage does not support role permissions. Use DatabaseStorage.");
  }
  async deleteRolePermission(_role: string): Promise<boolean> {
    throw new Error("MemStorage does not support role permissions. Use DatabaseStorage.");
  }
  async getUsersByRole(_role: string): Promise<User[]> {
    throw new Error("MemStorage does not support getUsersByRole. Use DatabaseStorage.");
  }

  // Rental Snapshots Module (MemStorage stubs)
  async getRentalSnapshot(_id: string): Promise<RentalSnapshot | undefined> {
    throw new Error("MemStorage does not support rental snapshots. Use DatabaseStorage.");
  }
  async getRentalSnapshotByDate(_date: string): Promise<RentalSnapshot | undefined> {
    throw new Error("MemStorage does not support rental snapshots. Use DatabaseStorage.");
  }
  async getRentalSnapshots(_daysBack?: number): Promise<RentalSnapshot[]> {
    throw new Error("MemStorage does not support rental snapshots. Use DatabaseStorage.");
  }
  async createRentalSnapshot(_snapshot: InsertRentalSnapshot): Promise<RentalSnapshot> {
    throw new Error("MemStorage does not support rental snapshots. Use DatabaseStorage.");
  }
  async upsertRentalSnapshot(_snapshot: InsertRentalSnapshot): Promise<RentalSnapshot> {
    throw new Error("MemStorage does not support rental snapshots. Use DatabaseStorage.");
  }
  async deleteRentalSnapshot(_id: string): Promise<boolean> {
    throw new Error("MemStorage does not support rental snapshots. Use DatabaseStorage.");
  }

  // Communication Hub Module (MemStorage stubs)
  async getCommunicationTemplate(_id: string): Promise<CommunicationTemplate | undefined> {
    throw new Error("MemStorage does not support communication hub. Use DatabaseStorage.");
  }
  async getCommunicationTemplateByName(_name: string): Promise<CommunicationTemplate | undefined> {
    throw new Error("MemStorage does not support communication hub. Use DatabaseStorage.");
  }
  async getCommunicationTemplates(): Promise<CommunicationTemplate[]> {
    throw new Error("MemStorage does not support communication hub. Use DatabaseStorage.");
  }
  async createCommunicationTemplate(_template: InsertCommunicationTemplate): Promise<CommunicationTemplate> {
    throw new Error("MemStorage does not support communication hub. Use DatabaseStorage.");
  }
  async updateCommunicationTemplate(_id: string, _updates: Partial<CommunicationTemplate>): Promise<CommunicationTemplate | undefined> {
    throw new Error("MemStorage does not support communication hub. Use DatabaseStorage.");
  }
  async deleteCommunicationTemplate(_id: string): Promise<boolean> {
    throw new Error("MemStorage does not support communication hub. Use DatabaseStorage.");
  }
  async getWhitelistEntries(): Promise<CommunicationWhitelistEntry[]> {
    throw new Error("MemStorage does not support communication hub. Use DatabaseStorage.");
  }
  async getWhitelistEntriesByType(_type: 'email' | 'phone'): Promise<CommunicationWhitelistEntry[]> {
    throw new Error("MemStorage does not support communication hub. Use DatabaseStorage.");
  }
  async isInWhitelist(_type: 'email' | 'phone', _value: string): Promise<boolean> {
    throw new Error("MemStorage does not support communication hub. Use DatabaseStorage.");
  }
  async addToWhitelist(_entry: InsertCommunicationWhitelist): Promise<CommunicationWhitelistEntry> {
    throw new Error("MemStorage does not support communication hub. Use DatabaseStorage.");
  }
  async removeFromWhitelist(_id: string): Promise<boolean> {
    throw new Error("MemStorage does not support communication hub. Use DatabaseStorage.");
  }
  async getCommunicationLogs(_limit?: number): Promise<CommunicationLog[]> {
    throw new Error("MemStorage does not support communication hub. Use DatabaseStorage.");
  }
  async getCommunicationLogsByTemplate(_templateId: string): Promise<CommunicationLog[]> {
    throw new Error("MemStorage does not support communication hub. Use DatabaseStorage.");
  }
  async getCommunicationLogsByRecipient(_recipient: string): Promise<CommunicationLog[]> {
    throw new Error("MemStorage does not support communication hub. Use DatabaseStorage.");
  }
  async createCommunicationLog(_log: InsertCommunicationLog): Promise<CommunicationLog> {
    throw new Error("MemStorage does not support communication hub. Use DatabaseStorage.");
  }
}

export class DatabaseStorage implements IStorage {
  
  // Users
  async getUser(id: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return result[0];
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    // Case-insensitive lookup to handle usernames like 'SWONG05' vs 'swong05'
    const normalizedInput = username.toLowerCase();
    const result = await db.select().from(users).where(
      sql`LOWER(${users.username}) = ${normalizedInput} OR LOWER(${users.email}) = ${normalizedInput}`
    ).limit(1);
    return result[0];
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    // Case-insensitive lookup for email addresses
    const normalizedEmail = email.toLowerCase();
    const result = await db.select().from(users).where(
      sql`LOWER(${users.email}) = ${normalizedEmail}`
    ).limit(1);
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

  // Sessions Module
  async createSession(session: InsertSession): Promise<Session> {
    const result = await db.insert(sessions).values(session).returning();
    return result[0];
  }

  async getSession(sessionId: string): Promise<Session | undefined> {
    const result = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
    return result[0];
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const result = await db.delete(sessions).where(eq(sessions.id, sessionId));
    return result.rowCount! > 0;
  }

  async updateSession(sessionId: string, updates: Partial<Session>): Promise<Session | undefined> {
    const result = await db.update(sessions).set(updates).where(eq(sessions.id, sessionId)).returning();
    return result[0];
  }

  async cleanExpiredSessions(): Promise<number> {
    const now = new Date();
    const result = await db.delete(sessions).where(sql`${sessions.expiresAt} <= ${now}`);
    return result.rowCount!;
  }

  // Password Reset Tokens Module (Database implementation)
  async createPasswordResetToken(insertToken: InsertPasswordResetToken): Promise<PasswordResetToken> {
    const result = await db.insert(passwordResetTokens).values(insertToken).returning();
    return result[0];
  }

  async getPasswordResetToken(token: string): Promise<PasswordResetToken | undefined> {
    const result = await db.select().from(passwordResetTokens)
      .where(eq(passwordResetTokens.token, token))
      .limit(1);
    return result[0];
  }

  async markPasswordResetTokenUsed(token: string): Promise<boolean> {
    const result = await db.update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokens.token, token));
    return (result.rowCount ?? 0) > 0;
  }

  async deletePasswordResetToken(token: string): Promise<boolean> {
    const result = await db.delete(passwordResetTokens)
      .where(eq(passwordResetTokens.token, token));
    return (result.rowCount ?? 0) > 0;
  }

  async cleanExpiredPasswordResetTokens(): Promise<number> {
    const now = new Date();
    const result = await db.delete(passwordResetTokens)
      .where(sql`${passwordResetTokens.expiresAt} <= ${now} OR ${passwordResetTokens.usedAt} IS NOT NULL`);
    return result.rowCount ?? 0;
  }

  // Termed Techs Module (Snowflake sync)
  async getTermedTech(id: string): Promise<TermedTech | undefined> {
    const result = await db.select().from(termedTechs).where(eq(termedTechs.id, id)).limit(1);
    return result[0];
  }

  async getTermedTechByEmployeeId(employeeId: string): Promise<TermedTech | undefined> {
    const result = await db.select().from(termedTechs).where(eq(termedTechs.employeeId, employeeId)).limit(1);
    return result[0];
  }

  async getTermedTechs(): Promise<TermedTech[]> {
    return await db.select().from(termedTechs).orderBy(desc(termedTechs.lastDayWorked));
  }

  async getTermedTechsNeedingOffboarding(): Promise<TermedTech[]> {
    return await db.select().from(termedTechs)
      .where(eq(termedTechs.offboardingTaskCreated, false))
      .orderBy(desc(termedTechs.lastDayWorked));
  }

  async upsertTermedTech(tech: InsertTermedTech): Promise<TermedTech> {
    const result = await db.insert(termedTechs)
      .values(tech)
      .onConflictDoUpdate({
        target: termedTechs.employeeId,
        set: {
          techRacfid: tech.techRacfid,
          techName: tech.techName,
          lastDayWorked: tech.lastDayWorked,
          firstName: tech.firstName,
          lastName: tech.lastName,
          jobTitle: tech.jobTitle,
          districtNo: tech.districtNo,
          planningAreaName: tech.planningAreaName,
          employmentStatus: tech.employmentStatus,
          effectiveDate: tech.effectiveDate,
          syncedAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning();
    return result[0];
  }

  async updateTermedTech(id: string, updates: Partial<TermedTech>): Promise<TermedTech | undefined> {
    const result = await db.update(termedTechs)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(termedTechs.id, id))
      .returning();
    return result[0];
  }

  async markTermedTechOffboardingCreated(employeeId: string, queueItemId: string): Promise<TermedTech | undefined> {
    const result = await db.update(termedTechs)
      .set({
        offboardingTaskCreated: true,
        offboardingTaskId: queueItemId,
        updatedAt: new Date(),
      })
      .where(eq(termedTechs.employeeId, employeeId))
      .returning();
    return result[0];
  }

  // All Techs Module (Snowflake sync - complete roster)
  async getAllTech(id: string): Promise<AllTech | undefined> {
    const result = await db.select().from(allTechs).where(eq(allTechs.id, id)).limit(1);
    return result[0];
  }

  async getAllTechByEmployeeId(employeeId: string): Promise<AllTech | undefined> {
    const result = await db.select().from(allTechs).where(eq(allTechs.employeeId, employeeId)).limit(1);
    return result[0];
  }

  async getAllTechByTechRacfid(techRacfid: string): Promise<AllTech | undefined> {
    const result = await db.select().from(allTechs)
      .where(eq(allTechs.techRacfid, techRacfid.toUpperCase()))
      .limit(1);
    return result[0];
  }

  async getAllTechs(): Promise<AllTech[]> {
    return await db.select().from(allTechs).orderBy(allTechs.techName);
  }

  async getTermedEmployeesFromRoster(daysBack: number = 30): Promise<AllTech[]> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);
    const cutoffDateStr = cutoffDate.toISOString().split('T')[0];
    
    return await db.select().from(allTechs)
      .where(sql`${allTechs.effectiveDate} >= ${cutoffDateStr}`)
      .orderBy(desc(allTechs.effectiveDate));
  }

  async getEmployeesNeedingOffboarding(daysBack: number = 30): Promise<AllTech[]> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);
    const cutoffDateStr = cutoffDate.toISOString().split('T')[0];
    
    return await db.select().from(allTechs)
      .where(and(
        sql`${allTechs.effectiveDate} >= ${cutoffDateStr}`,
        eq(allTechs.offboardingTaskCreated, false)
      ))
      .orderBy(desc(allTechs.effectiveDate));
  }

  async markEmployeeOffboardingCreated(employeeId: string, taskId: string): Promise<AllTech | undefined> {
    const result = await db.update(allTechs)
      .set({
        offboardingTaskCreated: true,
        offboardingTaskId: taskId,
        processedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(allTechs.employeeId, employeeId))
      .returning();
    return result[0];
  }

  async upsertAllTech(tech: InsertAllTech): Promise<AllTech> {
    const result = await db.insert(allTechs)
      .values(tech)
      .onConflictDoUpdate({
        target: allTechs.employeeId,
        set: {
          techRacfid: tech.techRacfid,
          techName: tech.techName,
          firstName: tech.firstName,
          lastName: tech.lastName,
          jobTitle: tech.jobTitle,
          districtNo: tech.districtNo,
          planningAreaName: tech.planningAreaName,
          employmentStatus: tech.employmentStatus,
          syncedAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning();
    return result[0];
  }

  async bulkUpsertAllTechs(techs: InsertAllTech[]): Promise<number> {
    if (techs.length === 0) return 0;
    
    const result = await db.insert(allTechs)
      .values(techs)
      .onConflictDoUpdate({
        target: allTechs.employeeId,
        set: {
          techRacfid: sql`excluded.tech_racfid`,
          techName: sql`excluded.tech_name`,
          firstName: sql`excluded.first_name`,
          lastName: sql`excluded.last_name`,
          jobTitle: sql`excluded.job_title`,
          districtNo: sql`excluded.district_no`,
          planningAreaName: sql`excluded.planning_area_name`,
          employmentStatus: sql`excluded.employment_status`,
          effectiveDate: sql`excluded.effective_date`,
          lastDayWorked: sql`excluded.last_day_worked`,
          // Contact info from ORA_TECH_LAST_KNOWN_CONTACT_VW_VIEW (join by EMPLID)
          homeAddr1: sql`excluded.home_addr1`,
          homeAddr2: sql`excluded.home_addr2`,
          homeCity: sql`excluded.home_city`,
          homeState: sql`excluded.home_state`,
          homePostal: sql`excluded.home_postal`,
          mainPhone: sql`excluded.main_phone`,
          cellPhone: sql`excluded.cell_phone`,
          homePhone: sql`excluded.home_phone`,
          // TPMS truck assignment (join by ENTERPRISE_ID)
          truckLu: sql`excluded.truck_lu`,
          syncedAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning({ id: allTechs.id });
    
    return result.length;
  }

  async updateAllTech(id: string, updates: Partial<AllTech>): Promise<AllTech | undefined> {
    const result = await db.update(allTechs)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(allTechs.id, id))
      .returning();
    return result[0];
  }

  // Sync Logs Module
  async getSyncLog(id: string): Promise<SyncLog | undefined> {
    const result = await db.select().from(syncLogs).where(eq(syncLogs.id, id)).limit(1);
    return result[0];
  }

  async getSyncLogs(): Promise<SyncLog[]> {
    return await db.select().from(syncLogs).orderBy(desc(syncLogs.startedAt));
  }

  async getLatestSyncLog(syncType: string): Promise<SyncLog | undefined> {
    const result = await db.select().from(syncLogs)
      .where(eq(syncLogs.syncType, syncType))
      .orderBy(desc(syncLogs.startedAt))
      .limit(1);
    return result[0];
  }

  async createSyncLog(log: InsertSyncLog): Promise<SyncLog> {
    const result = await db.insert(syncLogs).values(log).returning();
    return result[0];
  }

  async updateSyncLog(id: string, updates: Partial<SyncLog>): Promise<SyncLog | undefined> {
    const result = await db.update(syncLogs)
      .set(updates)
      .where(eq(syncLogs.id, id))
      .returning();
    return result[0];
  }

  // Truck Inventory Module
  async getTruckInventory(truck: string): Promise<TruckInventory[]> {
    return await db.select().from(truckInventory).where(eq(truckInventory.truck, truck));
  }

  async getTruckInventoryByEnterpriseId(enterpriseId: string): Promise<TruckInventory[]> {
    return await db.select().from(truckInventory).where(eq(truckInventory.enterpriseId, enterpriseId.toUpperCase()));
  }

  async getTruckInventoryByDistrict(district: string): Promise<TruckInventory[]> {
    return await db.select().from(truckInventory).where(eq(truckInventory.district, district));
  }

  async getLatestTruckInventoryExtractDate(): Promise<string | null> {
    const result = await db.select({ extractDate: truckInventory.extractDate })
      .from(truckInventory)
      .orderBy(desc(truckInventory.extractDate))
      .limit(1);
    return result[0]?.extractDate || null;
  }

  async bulkUpsertTruckInventory(items: InsertTruckInventory[]): Promise<number> {
    if (items.length === 0) return 0;
    
    const result = await db.insert(truckInventory)
      .values(items)
      .onConflictDoNothing()
      .returning({ id: truckInventory.id });
    
    return result.length;
  }

  async clearTruckInventoryByExtractDate(extractDate: string): Promise<number> {
    const result = await db.delete(truckInventory)
      .where(eq(truckInventory.extractDate, extractDate))
      .returning({ id: truckInventory.id });
    return result.length;
  }

  // Tech Vehicle Assignments Module
  async getTechVehicleAssignment(id: string): Promise<TechVehicleAssignment | undefined> {
    const result = await db.select().from(techVehicleAssignments).where(eq(techVehicleAssignments.id, id)).limit(1);
    return result[0];
  }

  async getTechVehicleAssignmentByTechRacfid(techRacfid: string): Promise<TechVehicleAssignment | undefined> {
    const result = await db.select().from(techVehicleAssignments)
      .where(eq(techVehicleAssignments.techRacfid, techRacfid.toUpperCase()))
      .limit(1);
    return result[0];
  }

  async getTechVehicleAssignmentByTruckNo(truckNo: string): Promise<TechVehicleAssignment | undefined> {
    const result = await db.select().from(techVehicleAssignments)
      .where(eq(techVehicleAssignments.truckNo, truckNo))
      .limit(1);
    return result[0];
  }

  async getTechVehicleAssignments(status?: string): Promise<TechVehicleAssignment[]> {
    if (status && status !== 'all') {
      return await db.select().from(techVehicleAssignments)
        .where(eq(techVehicleAssignments.assignmentStatus, status))
        .orderBy(techVehicleAssignments.techName);
    }
    return await db.select().from(techVehicleAssignments).orderBy(techVehicleAssignments.techName);
  }

  async createTechVehicleAssignment(assignment: InsertTechVehicleAssignment): Promise<TechVehicleAssignment> {
    const result = await db.insert(techVehicleAssignments)
      .values({
        ...assignment,
        techRacfid: assignment.techRacfid.toUpperCase(),
      })
      .returning();
    return result[0];
  }

  async updateTechVehicleAssignment(id: string, updates: Partial<TechVehicleAssignment>): Promise<TechVehicleAssignment | undefined> {
    const result = await db.update(techVehicleAssignments)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(techVehicleAssignments.id, id))
      .returning();
    return result[0];
  }

  async deleteTechVehicleAssignment(id: string): Promise<boolean> {
    const result = await db.delete(techVehicleAssignments).where(eq(techVehicleAssignments.id, id)).returning();
    return result.length > 0;
  }

  // Tech Vehicle Assignment History Module
  async getTechVehicleAssignmentHistory(techRacfid: string): Promise<TechVehicleAssignmentHistory[]> {
    return await db.select().from(techVehicleAssignmentHistory)
      .where(eq(techVehicleAssignmentHistory.techRacfid, techRacfid.toUpperCase()))
      .orderBy(desc(techVehicleAssignmentHistory.createdAt));
  }

  async createTechVehicleAssignmentHistory(history: InsertTechVehicleAssignmentHistory): Promise<TechVehicleAssignmentHistory> {
    const result = await db.insert(techVehicleAssignmentHistory)
      .values({
        ...history,
        techRacfid: history.techRacfid.toUpperCase(),
      })
      .returning();
    return result[0];
  }

  // TPMS Cached Assignments Module
  async getTpmsCachedAssignment(lookupKey: string): Promise<TpmsCachedAssignment | undefined> {
    const result = await db.select().from(tpmsCachedAssignments)
      .where(eq(tpmsCachedAssignments.lookupKey, lookupKey.toUpperCase()))
      .limit(1);
    return result[0];
  }

  async getTpmsCachedAssignmentByEnterpriseId(enterpriseId: string): Promise<TpmsCachedAssignment | undefined> {
    const result = await db.select().from(tpmsCachedAssignments)
      .where(eq(tpmsCachedAssignments.enterpriseId, enterpriseId.toUpperCase()))
      .limit(1);
    return result[0];
  }

  async getTpmsCachedAssignmentByTruckNo(truckNo: string): Promise<TpmsCachedAssignment | undefined> {
    const result = await db.select().from(tpmsCachedAssignments)
      .where(eq(tpmsCachedAssignments.truckNo, truckNo))
      .limit(1);
    return result[0];
  }

  async getAllTpmsCachedAssignments(): Promise<TpmsCachedAssignment[]> {
    return await db.select().from(tpmsCachedAssignments)
      .orderBy(desc(tpmsCachedAssignments.lastSuccessAt));
  }

  async upsertTpmsCachedAssignment(data: InsertTpmsCachedAssignment): Promise<TpmsCachedAssignment> {
    const lookupKey = data.lookupKey.toUpperCase();
    const existing = await this.getTpmsCachedAssignment(lookupKey);
    
    if (existing) {
      const result = await db.update(tpmsCachedAssignments)
        .set({
          ...data,
          lookupKey,
          enterpriseId: data.enterpriseId?.toUpperCase(),
          updatedAt: new Date(),
        })
        .where(eq(tpmsCachedAssignments.lookupKey, lookupKey))
        .returning();
      return result[0];
    } else {
      const result = await db.insert(tpmsCachedAssignments)
        .values({
          ...data,
          lookupKey,
          enterpriseId: data.enterpriseId?.toUpperCase(),
        })
        .returning();
      return result[0];
    }
  }

  async bulkUpsertTpmsCachedAssignments(items: InsertTpmsCachedAssignment[]): Promise<number> {
    if (items.length === 0) return 0;
    
    let upsertedCount = 0;
    for (const item of items) {
      try {
        const lookupKey = item.lookupKey.toUpperCase();
        await db.insert(tpmsCachedAssignments)
          .values({
            ...item,
            lookupKey,
            enterpriseId: item.enterpriseId?.toUpperCase(),
          })
          .onConflictDoUpdate({
            target: tpmsCachedAssignments.lookupKey,
            set: {
              truckNo: item.truckNo,
              enterpriseId: item.enterpriseId?.toUpperCase(),
              techId: item.techId,
              firstName: item.firstName,
              lastName: item.lastName,
              districtNo: item.districtNo,
              contactNo: item.contactNo,
              email: item.email,
              rawResponse: item.rawResponse,
              status: item.status || 'live',
              lastSuccessAt: item.lastSuccessAt || new Date(),
              lastAttemptAt: item.lastAttemptAt || new Date(),
              failureCount: 0,
              updatedAt: new Date(),
            },
          });
        upsertedCount++;
      } catch (error: any) {
        console.error(`[Storage] Error upserting TPMS cache for ${item.lookupKey}:`, error.message);
      }
    }
    return upsertedCount;
  }

  async clearTpmsCachedAssignments(): Promise<number> {
    const result = await db.delete(tpmsCachedAssignments).returning();
    return result.length;
  }

  async updateTpmsCachedAssignment(lookupKey: string, updates: Partial<TpmsCachedAssignment>): Promise<TpmsCachedAssignment | undefined> {
    const result = await db.update(tpmsCachedAssignments)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(tpmsCachedAssignments.lookupKey, lookupKey.toUpperCase()))
      .returning();
    return result[0];
  }

  async markTpmsCacheError(lookupKey: string, errorCode: number, errorMessage: string): Promise<TpmsCachedAssignment | undefined> {
    const existing = await this.getTpmsCachedAssignment(lookupKey);
    const currentFailures = existing?.failureCount || 0;
    
    const result = await db.update(tpmsCachedAssignments)
      .set({
        status: 'error',
        lastAttemptAt: new Date(),
        lastErrorCode: errorCode,
        lastErrorMessage: errorMessage,
        failureCount: currentFailures + 1,
        updatedAt: new Date(),
      })
      .where(eq(tpmsCachedAssignments.lookupKey, lookupKey.toUpperCase()))
      .returning();
    return result[0];
  }

  async getStaleTPMSCache(maxAgeHours: number = 24): Promise<TpmsCachedAssignment[]> {
    const cutoffDate = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
    return await db.select().from(tpmsCachedAssignments)
      .where(sql`${tpmsCachedAssignments.lastSuccessAt} < ${cutoffDate} OR ${tpmsCachedAssignments.lastSuccessAt} IS NULL`)
      .orderBy(tpmsCachedAssignments.lastSuccessAt);
  }

  async getTpmsSyncState(): Promise<{ initialSyncComplete: boolean; status: string; vehiclesSynced: number; totalVehiclesToSync: number; vehiclesWithAssignments: number; lastSyncAt: Date | null } | null> {
    const { tpmsSyncState } = await import('@shared/schema');
    const result = await db.select().from(tpmsSyncState).limit(1);
    if (result.length === 0) return null;
    const state = result[0];
    return {
      initialSyncComplete: state.initialSyncComplete,
      status: state.status,
      vehiclesSynced: state.vehiclesSynced || 0,
      totalVehiclesToSync: state.totalVehiclesToSync || 0,
      vehiclesWithAssignments: state.vehiclesWithAssignments || 0,
      lastSyncAt: state.lastSyncAt,
    };
  }

  async updateTpmsSyncState(updates: { initialSyncComplete?: boolean; status?: string; vehiclesSynced?: number; totalVehiclesToSync?: number; vehiclesWithAssignments?: number; vehiclesWithoutAssignments?: number; errorMessage?: string | null; initialSyncStartedAt?: Date; initialSyncCompletedAt?: Date; lastSyncAt?: Date }): Promise<void> {
    const { tpmsSyncState } = await import('@shared/schema');
    const existing = await db.select().from(tpmsSyncState).limit(1);
    if (existing.length === 0) {
      await this.initializeTpmsSyncState();
    }
    await db.update(tpmsSyncState).set({ ...updates, updatedAt: new Date() });
  }

  async initializeTpmsSyncState(): Promise<void> {
    const { tpmsSyncState } = await import('@shared/schema');
    const existing = await db.select().from(tpmsSyncState).limit(1);
    if (existing.length === 0) {
      await db.insert(tpmsSyncState).values({
        initialSyncComplete: false,
        status: 'idle',
        totalVehiclesToSync: 0,
        vehiclesSynced: 0,
        vehiclesWithAssignments: 0,
        vehiclesWithoutAssignments: 0,
      });
    }
  }

  // Onboarding Hires
  async getOnboardingHires(): Promise<OnboardingHire[]> {
    return await db.select().from(onboardingHires).orderBy(desc(onboardingHires.serviceDate));
  }

  async getOnboardingHire(id: string): Promise<OnboardingHire | undefined> {
    const result = await db.select().from(onboardingHires).where(eq(onboardingHires.id, id)).limit(1);
    return result[0];
  }

  async getOnboardingHireByNameAndDate(employeeName: string, serviceDate: string): Promise<OnboardingHire | undefined> {
    const result = await db.select().from(onboardingHires)
      .where(and(
        eq(onboardingHires.employeeName, employeeName),
        eq(onboardingHires.serviceDate, serviceDate)
      ))
      .limit(1);
    return result[0];
  }

  async upsertOnboardingHire(hire: InsertOnboardingHire): Promise<OnboardingHire> {
    const existing = await this.getOnboardingHireByNameAndDate(hire.employeeName, hire.serviceDate);
    if (existing) {
      // Only update Snowflake-sourced fields, preserve manual assignments (truckAssigned, assignedTruckNo, notes)
      const result = await db.update(onboardingHires)
        .set({ 
          enterpriseId: hire.enterpriseId,
          workState: hire.workState,
          actionReasonDescr: hire.actionReasonDescr,
          jobTitle: hire.jobTitle,
          techType: hire.techType,
          district: hire.district,
          zipcode: hire.zipcode,
          locationCity: hire.locationCity,
          planningAreaName: hire.planningAreaName,
          specialties: hire.specialties,
          employmentStatus: hire.employmentStatus,
          updatedAt: new Date(), 
          syncedAt: new Date() 
        })
        .where(eq(onboardingHires.id, existing.id))
        .returning();
      return result[0];
    }
    const result = await db.insert(onboardingHires).values(hire).returning();
    return result[0];
  }

  async bulkUpsertOnboardingHires(hires: InsertOnboardingHire[]): Promise<number> {
    let upsertedCount = 0;
    for (const hire of hires) {
      await this.upsertOnboardingHire(hire);
      upsertedCount++;
    }
    return upsertedCount;
  }

  async updateOnboardingHire(id: string, updates: Partial<OnboardingHire>): Promise<OnboardingHire | undefined> {
    const result = await db.update(onboardingHires)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(onboardingHires.id, id))
      .returning();
    return result[0];
  }

  async deleteOnboardingHire(id: string): Promise<boolean> {
    const result = await db.delete(onboardingHires).where(eq(onboardingHires.id, id)).returning();
    return result.length > 0;
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

  // Tools Queue Module (Sprint 1: Schema + Task Creation)
  async getToolsQueueItem(id: string): Promise<QueueItem | undefined> {
    const result = await db.select().from(queueItems)
      .where(and(eq(queueItems.id, id), eq(queueItems.department, 'Tools')))
      .limit(1);
    return result[0];
  }

  async getToolsQueueItems(): Promise<QueueItem[]> {
    return await db.select().from(queueItems)
      .where(eq(queueItems.department, 'Tools'))
      .orderBy(desc(queueItems.createdAt));
  }

  async createToolsQueueItem(item: InsertQueueItem): Promise<QueueItem> {
    const result = await db.insert(queueItems).values({
      ...item,
      department: 'Tools'
    }).returning();
    return result[0];
  }

  async updateToolsQueueItem(id: string, updates: Partial<QueueItem>): Promise<QueueItem | undefined> {
    const result = await db.update(queueItems)
      .set({...updates, updatedAt: new Date()})
      .where(and(eq(queueItems.id, id), eq(queueItems.department, 'Tools')))
      .returning();
    return result[0];
  }

  async assignToolsQueueItem(id: string, assigneeId: string): Promise<QueueItem | undefined> {
    return await this.updateToolsQueueItem(id, { 
      assignedTo: assigneeId, 
      status: 'in_progress'
    });
  }

  async startWorkToolsQueueItem(id: string, workerId: string): Promise<QueueItem | undefined> {
    return await db.transaction(async (tx) => {
      const item = await tx.select().from(queueItems)
        .where(and(eq(queueItems.id, id), eq(queueItems.department, 'Tools')))
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
        .where(and(eq(queueItems.id, id), eq(queueItems.department, 'Tools')))
        .returning();
      
      return result[0];
    });
  }

  async completeToolsQueueItem(id: string, completedBy: string): Promise<QueueItem | undefined> {
    const result = await db.update(queueItems)
      .set({ 
        status: 'completed', 
        completedAt: new Date(),
        updatedAt: new Date() 
      })
      .where(and(eq(queueItems.id, id), eq(queueItems.department, 'Tools')))
      .returning();
    
    const completedItem = result[0];
    if (completedItem) {
      // Check if this completes a workflow step and trigger next step
      await this.triggerNextWorkflowStep(completedItem);
    }
    
    return completedItem;
  }

  async updateToolsQueueProgress(id: string, updates: Partial<Pick<QueueItem, 'taskToolsReturn' | 'taskIphoneReturn' | 'taskDisconnectedLine' | 'taskDisconnectedMPayment' | 'taskCloseSegnoOrders' | 'taskCreateShippingLabel' | 'carrier' | 'fleetRoutingDecision'>>): Promise<QueueItem | undefined> {
    const result = await db.update(queueItems)
      .set({
        ...updates,
        updatedAt: new Date()
      })
      .where(and(eq(queueItems.id, id), eq(queueItems.department, 'Tools')))
      .returning();
    return result[0];
  }

  async updateToolsQueueNotificationStatus(id: string, sent: boolean): Promise<QueueItem | undefined> {
    const result = await db.update(queueItems)
      .set({
        toolAuditNotificationSent: sent,
        toolAuditNotificationSentAt: sent ? new Date() : null,
        updatedAt: new Date()
      })
      .where(and(eq(queueItems.id, id), eq(queueItems.department, 'Tools')))
      .returning();
    return result[0];
  }

  async getFleetTaskByWorkflowId(workflowId: string): Promise<QueueItem | undefined> {
    const result = await db.select()
      .from(queueItems)
      .where(and(
        eq(queueItems.workflowId, workflowId),
        eq(queueItems.department, 'FLEET')
      ))
      .limit(1);
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

  // Templates Module
  async getTemplateById(id: string): Promise<Template | undefined> {
    const result = await db.select().from(templates).where(eq(templates.id, id)).limit(1);
    return result[0];
  }

  async getTemplatesByWorkflow(workflowType: string, department: string): Promise<Template[]> {
    const results = await db.select().from(templates)
      .where(and(
        eq(templates.workflowType, workflowType),
        eq(templates.department, department),
        eq(templates.isActive, true)
      ));
    
    // Sort by semantic version (highest first)
    return results.sort((a, b) => this.compareVersions(b.version, a.version));
  }

  async resolveLatestTemplate(workflowType: string, department: string): Promise<Template | undefined> {
    const templateResults = await this.getTemplatesByWorkflow(workflowType, department);
    return templateResults.length > 0 ? templateResults[0] : undefined; // First is highest version
  }

  private compareVersions(a: string, b: string): number {
    // Parse semantic versions (e.g., "1.0", "1.2.3", "2.0.1")
    const parseVersion = (version: string): number[] => {
      return version.split('.').map(part => parseInt(part, 10) || 0);
    };
    
    const versionA = parseVersion(a);
    const versionB = parseVersion(b);
    
    // Compare each version component
    const maxLength = Math.max(versionA.length, versionB.length);
    for (let i = 0; i < maxLength; i++) {
      const partA = versionA[i] || 0;
      const partB = versionB[i] || 0;
      
      if (partA > partB) return 1;
      if (partA < partB) return -1;
    }
    
    return 0; // Equal versions
  }

  async getAllTemplates(): Promise<Template[]> {
    return await db.select().from(templates).orderBy(desc(templates.createdAt));
  }

  async getTemplatesByDepartment(department: string): Promise<Template[]> {
    return await db.select().from(templates)
      .where(and(eq(templates.department, department), eq(templates.isActive, true)))
      .orderBy(desc(templates.createdAt));
  }

  async upsertTemplate(insertTemplate: InsertTemplateWithId): Promise<Template> {
    const result = await db.insert(templates)
      .values(insertTemplate)
      .onConflictDoUpdate({
        target: templates.id,
        set: {
          department: insertTemplate.department,
          workflowType: insertTemplate.workflowType,
          version: insertTemplate.version,
          name: insertTemplate.name,
          content: insertTemplate.content,
          isActive: insertTemplate.isActive
        }
      })
      .returning();
    return result[0];
  }

  async updateTemplate(id: string, updates: Partial<Template>): Promise<Template | undefined> {
    // Whitelist only updateable fields to prevent mutation of immutable fields (id, createdAt)
    const allowedFields = ['name', 'department', 'workflowType', 'version', 'content', 'isActive'] as const;
    const safeUpdates: Partial<Template> = {};
    
    for (const field of allowedFields) {
      if (field in updates) {
        (safeUpdates as any)[field] = updates[field];
      }
    }
    
    // Only proceed if there are valid fields to update
    if (Object.keys(safeUpdates).length === 0) {
      return undefined;
    }
    
    const result = await db.update(templates)
      .set(safeUpdates)
      .where(eq(templates.id, id))
      .returning();
    return result[0];
  }

  async toggleTemplateStatus(id: string): Promise<Template | undefined> {
    const template = await this.getTemplateById(id);
    if (!template) return undefined;
    
    const result = await db.update(templates)
      .set({ isActive: !template.isActive })
      .where(eq(templates.id, id))
      .returning();
    return result[0];
  }

  async deleteTemplate(id: string): Promise<boolean> {
    const result = await db.delete(templates).where(eq(templates.id, id));
    return result.rowCount! > 0;
  }

  // Unified Queue Aggregator
  async getUnifiedQueueItems(modules: QueueModule[], status?: string): Promise<CombinedQueueItem[]> {
    const departmentMap: Record<QueueModule, string> = {
      'ntao': 'NTAO',
      'assets': 'Assets Management', 
      'inventory': 'Inventory Control',
      'fleet': 'Fleet Management',
      'tools': 'Tools'
    };

    const departments = modules.map(m => departmentMap[m]);
    
    let whereCondition = inArray(queueItems.department, departments);
    
    if (status) {
      whereCondition = and(inArray(queueItems.department, departments), eq(queueItems.status, status)) ?? whereCondition;
    }
    
    const items = await db.select().from(queueItems)
      .where(whereCondition)
      .orderBy(desc(queueItems.createdAt));
    
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
      'fleet': 'Fleet Management',
      'tools': 'Tools'
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
      'fleet': 'Fleet Management',
      'tools': 'Tools'
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
      'fleet': 'Fleet Management',
      'tools': 'Tools'
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
      'fleet': 'Fleet Management',
      'tools': 'Tools'
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
      'fleet': 'Fleet Management',
      'tools': 'Tools'
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
    
    let whereCondition = eq(queueItems.workflowType, 'offboarding');
    
    if (cutoffTime) {
      whereCondition = and(eq(queueItems.workflowType, 'offboarding'), sql`${queueItems.createdAt} >= ${cutoffTime}`) ?? whereCondition;
    }
    
    const items = await db.select().from(queueItems).where(whereCondition);
    
    for (const item of items) {
      try {
        let itemData = item.data;
        if (typeof itemData === 'string') {
          itemData = JSON.parse(itemData);
        }
        
        if (itemData && typeof itemData === 'object' && (itemData as any).employee && 
           ((itemData as any).employee.employeeId === employeeId || (itemData as any).employee.techRacfId === techRacfId)) {
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

  async findExistingOffboardingTasks(employeeId: string, techRacfId: string, daysWindow: number = 45): Promise<{ 
    hasExisting: boolean; 
    existingTasks: QueueItem[]; 
    message?: string;
  }> {
    const cutoffTime = new Date(Date.now() - (daysWindow * 24 * 60 * 60 * 1000));
    const existingTasks: QueueItem[] = [];
    
    // Find all offboarding tasks that are either:
    // 1. Open (pending or in_progress status), OR
    // 2. Created within the last X days
    const items = await db.select().from(queueItems)
      .where(eq(queueItems.workflowType, 'offboarding'))
      .orderBy(desc(queueItems.createdAt));
    
    for (const item of items) {
      try {
        let itemData = item.data;
        if (typeof itemData === 'string') {
          itemData = JSON.parse(itemData);
        }
        
        // Check if this task belongs to the employee
        const techInfo = (itemData as any)?.technician || (itemData as any)?.employee;
        const itemEmployeeId = techInfo?.employeeId || (itemData as any)?.employeeId;
        const itemTechRacfId = techInfo?.techRacfid || techInfo?.enterpriseId || techInfo?.racfId || (itemData as any)?.techRacfId;
        
        const employeeIdMatch = employeeId && itemEmployeeId && employeeId === itemEmployeeId;
        const techRacfIdMatch = techRacfId && itemTechRacfId && techRacfId.toLowerCase() === itemTechRacfId.toLowerCase();
        
        if (employeeIdMatch || techRacfIdMatch) {
          const isOpen = item.status === 'pending' || item.status === 'in_progress';
          const isRecent = item.createdAt && new Date(item.createdAt) >= cutoffTime;
          
          if (isOpen || isRecent) {
            existingTasks.push(item);
          }
        }
      } catch (parseError) {
        console.error('Error parsing queue item data for existing task check:', parseError);
        continue;
      }
    }
    
    if (existingTasks.length > 0) {
      const openCount = existingTasks.filter(t => t.status === 'pending' || t.status === 'in_progress').length;
      const recentCount = existingTasks.length;
      return {
        hasExisting: true,
        existingTasks,
        message: `Found ${recentCount} existing offboarding task(s) for this employee (${openCount} open, created within last ${daysWindow} days).`
      };
    }
    
    return { hasExisting: false, existingTasks: [] };
  }

  async checkByovEnrollmentDuplicates(ldap: string, email: string, currentTruckNumber: string, timeWindowMs?: number): Promise<{ isDuplicate: boolean; message?: string; existingTask?: QueueItem }> {
    const cutoffTime = timeWindowMs ? new Date(Date.now() - timeWindowMs) : null;
    
    let whereCondition = eq(queueItems.workflowId, 'byov_enrollment');
    
    if (cutoffTime) {
      whereCondition = and(eq(queueItems.workflowId, 'byov_enrollment'), sql`${queueItems.createdAt} >= ${cutoffTime}`) ?? whereCondition;
    }
    
    const items = await db.select().from(queueItems).where(whereCondition);
    
    for (const item of items) {
      try {
        let itemData = item.data;
        if (typeof itemData === 'string') {
          itemData = JSON.parse(itemData);
        }
        
        if (itemData && typeof itemData === 'object' && (itemData as any).techInfo && 
           ((itemData as any).techInfo.ldap === ldap || 
            (itemData as any).techInfo.email === email || 
            (itemData as any).techInfo.currentTruckNumber === currentTruckNumber)) {
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
      'fleet': 'Fleet Management',
      'tools': 'Tools'
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
      'fleet': 'Fleet Management',
      'tools': 'Tools'
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

  // ============================================
  // Field Mapping Module Implementation
  // ============================================

  async getIntegrationDataSources(): Promise<IntegrationDataSource[]> {
    return await db.select().from(integrationDataSources).orderBy(integrationDataSources.name);
  }

  async getIntegrationDataSource(id: string): Promise<IntegrationDataSource | undefined> {
    const [source] = await db.select().from(integrationDataSources).where(eq(integrationDataSources.id, id));
    return source;
  }

  async createIntegrationDataSource(source: InsertIntegrationDataSource): Promise<IntegrationDataSource> {
    const [created] = await db.insert(integrationDataSources).values({
      ...source,
      id: randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();
    return created;
  }

  async updateIntegrationDataSource(id: string, updates: Partial<IntegrationDataSource>): Promise<IntegrationDataSource | undefined> {
    const [updated] = await db.update(integrationDataSources)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(integrationDataSources.id, id))
      .returning();
    return updated;
  }

  async deleteIntegrationDataSource(id: string): Promise<boolean> {
    const result = await db.delete(integrationDataSources).where(eq(integrationDataSources.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async getDataSourceFields(sourceId: string): Promise<DataSourceField[]> {
    return await db.select().from(dataSourceFields)
      .where(eq(dataSourceFields.sourceId, sourceId))
      .orderBy(dataSourceFields.fieldName);
  }

  async getDataSourceField(id: string): Promise<DataSourceField | undefined> {
    const [field] = await db.select().from(dataSourceFields).where(eq(dataSourceFields.id, id));
    return field;
  }

  async createDataSourceField(field: InsertDataSourceField): Promise<DataSourceField> {
    const [created] = await db.insert(dataSourceFields).values({
      ...field,
      id: randomUUID(),
      createdAt: new Date(),
    }).returning();
    return created;
  }

  async createDataSourceFieldsBulk(fields: InsertDataSourceField[]): Promise<DataSourceField[]> {
    if (fields.length === 0) return [];
    const created = await db.insert(dataSourceFields).values(
      fields.map(field => ({
        ...field,
        id: randomUUID(),
        createdAt: new Date(),
      }))
    ).returning();
    return created;
  }

  async updateDataSourceField(id: string, updates: Partial<DataSourceField>): Promise<DataSourceField | undefined> {
    const [updated] = await db.update(dataSourceFields)
      .set(updates)
      .where(eq(dataSourceFields.id, id))
      .returning();
    return updated;
  }

  async deleteDataSourceField(id: string): Promise<boolean> {
    const result = await db.delete(dataSourceFields).where(eq(dataSourceFields.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async getMappingSets(): Promise<MappingSet[]> {
    return await db.select().from(mappingSets).orderBy(desc(mappingSets.createdAt));
  }

  async getMappingSet(id: string): Promise<MappingSet | undefined> {
    const [set] = await db.select().from(mappingSets).where(eq(mappingSets.id, id));
    return set;
  }

  async createMappingSet(set: InsertMappingSet): Promise<MappingSet> {
    const [created] = await db.insert(mappingSets).values({
      ...set,
      id: randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();
    return created;
  }

  async updateMappingSet(id: string, updates: Partial<MappingSet>): Promise<MappingSet | undefined> {
    const [updated] = await db.update(mappingSets)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(mappingSets.id, id))
      .returning();
    return updated;
  }

  async deleteMappingSet(id: string): Promise<boolean> {
    const result = await db.delete(mappingSets).where(eq(mappingSets.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async getMappingNodes(mappingSetId: string): Promise<MappingNode[]> {
    return await db.select().from(mappingNodes).where(eq(mappingNodes.mappingSetId, mappingSetId));
  }

  async createMappingNode(node: InsertMappingNode): Promise<MappingNode> {
    const [created] = await db.insert(mappingNodes).values({
      ...node,
      id: randomUUID(),
      createdAt: new Date(),
    }).returning();
    return created;
  }

  async updateMappingNode(id: string, updates: Partial<MappingNode>): Promise<MappingNode | undefined> {
    const [updated] = await db.update(mappingNodes)
      .set(updates)
      .where(eq(mappingNodes.id, id))
      .returning();
    return updated;
  }

  async deleteMappingNode(id: string): Promise<boolean> {
    const result = await db.delete(mappingNodes).where(eq(mappingNodes.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async upsertMappingNodes(mappingSetId: string, nodes: InsertMappingNode[]): Promise<MappingNode[]> {
    // Delete existing nodes for this mapping set
    await db.delete(mappingNodes).where(eq(mappingNodes.mappingSetId, mappingSetId));
    
    if (nodes.length === 0) return [];
    
    const created = await db.insert(mappingNodes).values(
      nodes.map(node => ({
        ...node,
        mappingSetId,
        id: randomUUID(),
        createdAt: new Date(),
      }))
    ).returning();
    return created;
  }

  async getFieldMappings(mappingSetId: string): Promise<FieldMapping[]> {
    return await db.select().from(fieldMappings).where(eq(fieldMappings.mappingSetId, mappingSetId));
  }

  async createFieldMapping(mapping: InsertFieldMapping): Promise<FieldMapping> {
    const [created] = await db.insert(fieldMappings).values({
      ...mapping,
      id: randomUUID(),
      createdAt: new Date(),
    }).returning();
    return created;
  }

  async updateFieldMapping(id: string, updates: Partial<FieldMapping>): Promise<FieldMapping | undefined> {
    const [updated] = await db.update(fieldMappings)
      .set(updates)
      .where(eq(fieldMappings.id, id))
      .returning();
    return updated;
  }

  async deleteFieldMapping(id: string): Promise<boolean> {
    const result = await db.delete(fieldMappings).where(eq(fieldMappings.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async upsertFieldMappings(mappingSetId: string, mappings: InsertFieldMapping[]): Promise<FieldMapping[]> {
    // Delete existing mappings for this mapping set
    await db.delete(fieldMappings).where(eq(fieldMappings.mappingSetId, mappingSetId));
    
    if (mappings.length === 0) return [];
    
    const created = await db.insert(fieldMappings).values(
      mappings.map(mapping => ({
        ...mapping,
        mappingSetId,
        id: randomUUID(),
        createdAt: new Date(),
      }))
    ).returning();
    return created;
  }

  // Role Permissions Module
  async getRolePermission(role: string): Promise<RolePermission | undefined> {
    const result = await db.select().from(rolePermissions).where(eq(rolePermissions.role, role)).limit(1);
    return result[0];
  }

  async getAllRolePermissions(): Promise<RolePermission[]> {
    return await db.select().from(rolePermissions);
  }

  async upsertRolePermission(role: string, permissions: RolePermissionSettings): Promise<RolePermission> {
    const existing = await this.getRolePermission(role);
    
    if (existing) {
      const [updated] = await db.update(rolePermissions)
        .set({
          permissions,
          updatedAt: new Date(),
        })
        .where(eq(rolePermissions.role, role))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(rolePermissions)
        .values({
          role,
          permissions,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();
      return created;
    }
  }

  async updateRolePermission(role: string, permissions: RolePermissionSettings): Promise<RolePermission | undefined> {
    const [updated] = await db.update(rolePermissions)
      .set({
        permissions,
        updatedAt: new Date(),
      })
      .where(eq(rolePermissions.role, role))
      .returning();
    return updated;
  }

  async deleteRolePermission(role: string): Promise<boolean> {
    const result = await db.delete(rolePermissions).where(eq(rolePermissions.role, role));
    return (result.rowCount ?? 0) > 0;
  }

  async getUsersByRole(role: string): Promise<User[]> {
    return await db.select().from(users).where(eq(users.role, role));
  }

  // Rental Snapshots Module
  async getRentalSnapshot(id: string): Promise<RentalSnapshot | undefined> {
    const [snapshot] = await db.select().from(rentalSnapshots).where(eq(rentalSnapshots.id, id));
    return snapshot;
  }

  async getRentalSnapshotByDate(date: string): Promise<RentalSnapshot | undefined> {
    const [snapshot] = await db.select().from(rentalSnapshots).where(eq(rentalSnapshots.snapshotDate, date));
    return snapshot;
  }

  async getRentalSnapshots(daysBack: number = 30): Promise<RentalSnapshot[]> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);
    const cutoffDateStr = cutoffDate.toISOString().split('T')[0];
    
    return await db.select()
      .from(rentalSnapshots)
      .where(sql`${rentalSnapshots.snapshotDate} >= ${cutoffDateStr}`)
      .orderBy(desc(rentalSnapshots.snapshotDate));
  }

  async createRentalSnapshot(snapshot: InsertRentalSnapshot): Promise<RentalSnapshot> {
    const [created] = await db.insert(rentalSnapshots)
      .values(snapshot)
      .returning();
    return created;
  }

  async upsertRentalSnapshot(snapshot: InsertRentalSnapshot): Promise<RentalSnapshot> {
    // Check if snapshot for this date exists
    const existing = await this.getRentalSnapshotByDate(snapshot.snapshotDate);
    
    if (existing) {
      // Update existing snapshot
      const [updated] = await db.update(rentalSnapshots)
        .set({
          grandTotal: snapshot.grandTotal,
          totalOver14Days: snapshot.totalOver14Days,
          enterpriseTotal: snapshot.enterpriseTotal,
          nonEnterpriseTotal: snapshot.nonEnterpriseTotal,
          bucket28Plus: snapshot.bucket28Plus,
          bucket21To27: snapshot.bucket21To27,
          bucket14To20: snapshot.bucket14To20,
          bucketUnder14: snapshot.bucketUnder14,
          vendorBreakdown: snapshot.vendorBreakdown,
          rentalDetails: snapshot.rentalDetails,
        })
        .where(eq(rentalSnapshots.id, existing.id))
        .returning();
      return updated;
    } else {
      // Create new snapshot
      return await this.createRentalSnapshot(snapshot);
    }
  }

  async deleteRentalSnapshot(id: string): Promise<boolean> {
    const result = await db.delete(rentalSnapshots).where(eq(rentalSnapshots.id, id));
    return (result.rowCount ?? 0) > 0;
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

  // Workflow automation function - triggers Phase 2 after ALL Day 0 tasks complete
  async triggerNextWorkflowStep(completedItem: QueueItem): Promise<void> {
    // Only proceed if this item is part of a workflow
    if (!completedItem.workflowId) return;

    try {
      const itemData = completedItem.data ? JSON.parse(completedItem.data) : null;
      
      // Two-Phase Offboarding System:
      // Phase 1 (Day 0): Tasks 1-5 run in parallel (NTAO, Equipment, Fleet, Inventory, Tools)
      // Phase 2 (Day 1-5): Auto-generate Fleet follow-up tasks ONLY after ALL Day 0 tasks complete
      
      // Check if this is a Day 0 task completion (Day 0 tasks don't require workflowStep)
      if (itemData && itemData.isDay0Task && itemData.phase === "day0") {
        console.log(`Day 0 task detected: ${completedItem.title} - triggering Phase 2 check`);
        await this.checkAllDay0TasksAndTriggerPhase2(completedItem);
        return;
      }

      // For legacy workflow support, require workflowStep
      if (!completedItem.workflowStep) return;
      if (!itemData) return;

      // Legacy workflow support - keeping existing logic for non-Day0 workflows
      const triggerData = completedItem.triggerData ? JSON.parse(completedItem.triggerData) : itemData;
      if (!triggerData) return;

      console.log(`Workflow task completed: ${completedItem.workflowId} step ${completedItem.workflowStep} (${completedItem.department})`);
    } catch (error) {
      console.error('Error triggering next workflow step:', error);
    }
  }

  // Check Day 0 task completion and trigger Phase 2
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
      const allToolsTasks = await this.getToolsQueueItems();

      // Find all Day 0 tasks for this workflow (5 total: NTAO, Assets, Fleet, Inventory, Tools)
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
        ),
        ...allToolsTasks.filter(task => 
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

      if (totalDay0Tasks === 5 && completedCount === 5) {
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
      
      // Extract tech name and vehicle number from various possible locations in trigger data
      const techName = triggerData.techName || triggerData.employee?.name || 'Unknown Technician';
      const vehicleNumber = triggerData.vehicleNumber || triggerData.vehicle?.vehicleNumber || triggerData.vehicle?.truckNo || 'Unknown Vehicle';
      const employeeId = triggerData.employeeId || triggerData.employee?.racfId || triggerData.racfId || '';
      
      console.log(`Creating Phase 2 Fleet tasks for ${techName} (vehicle: ${vehicleNumber}, type: ${vehicleType})`);

      // Phase 2 Task 1: Vehicle Retrieval and Transport (Day 1-3)
      const retrievalTask = {
        workflowType: "offboarding",
        title: `Phase 2: Vehicle Retrieval - ${techName}`,
        description: `PHASE 2 (Day 1-3): Retrieve vehicle from ${techName} and transport to appropriate location. Vehicle: ${vehicleNumber}. Employee ID: ${employeeId}. All Day 0 tasks completed - proceed with Phase 2.`,
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
          techName: techName,
          vehicleNumber: vehicleNumber,
          employeeId: employeeId,
          ...triggerData,
          instructions: this.getVehicleRetrievalInstructions(vehicleType)
        })
      };

      // Phase 2 Task 2: Shop Coordination (Day 3-5)
      const shopTask = {
        workflowType: "offboarding",
        title: `Phase 2: Shop Coordination - ${techName}`,
        description: `PHASE 2 (Day 3-5): Coordinate vehicle processing at shop/service center. Vehicle: ${vehicleNumber} (${techName}). Complete maintenance, inventory, and preparation for reassignment.`,
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
          techName: techName,
          vehicleNumber: vehicleNumber,
          employeeId: employeeId,
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
      "Contact Employee to schedule vehicle pickup",
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

  // ========================================
  // Communication Hub Module
  // ========================================

  async getCommunicationTemplate(id: string): Promise<CommunicationTemplate | undefined> {
    const result = await db.select().from(communicationTemplates).where(eq(communicationTemplates.id, id)).limit(1);
    return result[0];
  }

  async getCommunicationTemplateByName(name: string): Promise<CommunicationTemplate | undefined> {
    const result = await db.select().from(communicationTemplates).where(eq(communicationTemplates.name, name)).limit(1);
    return result[0];
  }

  async getCommunicationTemplates(): Promise<CommunicationTemplate[]> {
    return await db.select().from(communicationTemplates).orderBy(desc(communicationTemplates.createdAt));
  }

  async createCommunicationTemplate(template: InsertCommunicationTemplate): Promise<CommunicationTemplate> {
    const result = await db.insert(communicationTemplates).values(template).returning();
    return result[0];
  }

  async updateCommunicationTemplate(id: string, updates: Partial<CommunicationTemplate>): Promise<CommunicationTemplate | undefined> {
    const result = await db.update(communicationTemplates)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(communicationTemplates.id, id))
      .returning();
    return result[0];
  }

  async deleteCommunicationTemplate(id: string): Promise<boolean> {
    const result = await db.delete(communicationTemplates).where(eq(communicationTemplates.id, id)).returning();
    return result.length > 0;
  }

  async getWhitelistEntries(): Promise<CommunicationWhitelistEntry[]> {
    return await db.select().from(communicationWhitelist).orderBy(desc(communicationWhitelist.createdAt));
  }

  async getWhitelistEntriesByType(type: 'email' | 'phone'): Promise<CommunicationWhitelistEntry[]> {
    return await db.select().from(communicationWhitelist).where(eq(communicationWhitelist.type, type)).orderBy(desc(communicationWhitelist.createdAt));
  }

  async isInWhitelist(type: 'email' | 'phone', value: string): Promise<boolean> {
    const normalizedValue = value.toLowerCase().trim();
    const result = await db.select().from(communicationWhitelist).where(
      and(
        eq(communicationWhitelist.type, type),
        sql`LOWER(${communicationWhitelist.value}) = ${normalizedValue}`
      )
    ).limit(1);
    return result.length > 0;
  }

  async addToWhitelist(entry: InsertCommunicationWhitelist): Promise<CommunicationWhitelistEntry> {
    const result = await db.insert(communicationWhitelist).values(entry).returning();
    return result[0];
  }

  async removeFromWhitelist(id: string): Promise<boolean> {
    const result = await db.delete(communicationWhitelist).where(eq(communicationWhitelist.id, id)).returning();
    return result.length > 0;
  }

  async getCommunicationLogs(limit: number = 100): Promise<CommunicationLog[]> {
    return await db.select().from(communicationLogs).orderBy(desc(communicationLogs.sentAt)).limit(limit);
  }

  async getCommunicationLogsByTemplate(templateId: string): Promise<CommunicationLog[]> {
    return await db.select().from(communicationLogs).where(eq(communicationLogs.templateId, templateId)).orderBy(desc(communicationLogs.sentAt));
  }

  async getCommunicationLogsByRecipient(recipient: string): Promise<CommunicationLog[]> {
    const normalizedRecipient = recipient.toLowerCase().trim();
    return await db.select().from(communicationLogs).where(
      sql`LOWER(${communicationLogs.intendedRecipient}) = ${normalizedRecipient} OR LOWER(${communicationLogs.actualRecipient}) = ${normalizedRecipient}`
    ).orderBy(desc(communicationLogs.sentAt));
  }

  async createCommunicationLog(log: InsertCommunicationLog): Promise<CommunicationLog> {
    const result = await db.insert(communicationLogs).values(log).returning();
    return result[0];
  }
}

// Choose storage implementation based on environment variable
const useDatabase = true; // Force database storage
export const storage: IStorage = useDatabase ? new DatabaseStorage() : new MemStorage();
