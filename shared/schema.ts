import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, integer, decimal, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Queue module types for unified queue access
export type QueueModule = 'ntao' | 'assets' | 'inventory' | 'fleet';

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").notNull().default("field"), // superadmin, agent, field
  department: text("department"), // NTAO, Assets Management, Inventory Control, Fleet Management
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const requests = pgTable("requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  description: text("description").notNull(),
  type: text("type").notNull(), // api_access, snowflake_query, system_config, user_permission
  priority: text("priority").notNull().default("medium"), // low, medium, high, critical
  status: text("status").notNull().default("pending"), // pending, approved, denied
  targetApi: text("target_api"),
  requesterId: varchar("requester_id").notNull(),
  approverId: varchar("approver_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const apiConfigurations = pgTable("api_configurations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  endpoint: text("endpoint").notNull(),
  apiKey: text("api_key"),
  isActive: boolean("is_active").notNull().default(true),
  healthStatus: text("health_status").notNull().default("healthy"), // healthy, warning, error
  lastChecked: timestamp("last_checked").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const activityLogs = pgTable("activity_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(), // request, api, user
  entityId: varchar("entity_id"),
  details: text("details"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const queueItems = pgTable("queue_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workflowType: text("workflow_type").notNull(), // onboarding, offboarding, vehicle_assignment, decommission
  title: text("title").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull().default("pending"), // pending, in_progress, completed, failed, cancelled
  priority: text("priority").notNull().default("medium"), // low, medium, high, critical
  assignedTo: varchar("assigned_to"), // user ID of person assigned to work this item
  requesterId: varchar("requester_id").notNull(), // user ID who created this queue item
  department: text("department"), // NTAO, Assets Management, Inventory Control, Fleet Management - which department this queue item belongs to
  data: text("data"), // JSON payload with workflow-specific data
  metadata: text("metadata"), // Additional metadata for automation hooks
  notes: text("notes"), // Agent notes for tracking work progress
  scheduledFor: timestamp("scheduled_for"), // For delayed processing
  attempts: integer("attempts").notNull().default(0), // For retry logic
  lastError: text("last_error"), // Error message from last failed attempt
  completedAt: timestamp("completed_at"),
  // Workflow dependency fields
  workflowId: varchar("workflow_id"), // Groups related tasks in a workflow sequence
  workflowStep: integer("workflow_step"), // Order/step number in the workflow (1, 2, 3, 4)
  dependsOn: varchar("depends_on"), // ID of task that must be completed before this one
  autoTrigger: boolean("auto_trigger").notNull().default(false), // Whether this task should auto-trigger when dependencies complete
  triggerData: text("trigger_data"), // Data for auto-triggered tasks
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const vehicles = pgTable("vehicles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vin: varchar("vin", { length: 17 }).notNull().unique(),
  vehicleNumber: varchar("vehicle_number"),
  modelYear: integer("model_year").notNull(),
  makeName: text("make_name").notNull(),
  modelName: text("model_name").notNull(),
  color: text("color"),
  licensePlate: varchar("license_plate"),
  licenseState: varchar("license_state", { length: 2 }),
  deliveryDate: date("delivery_date"),
  outOfServiceDate: date("out_of_service_date"),
  saleDate: date("sale_date"),
  registrationRenewalDate: date("registration_renewal_date"),
  odometerDelivery: integer("odometer_delivery"),
  branding: text("branding"), // AE Factory Service, Sears, Unmarked
  interior: text("interior"), // Lawn & Garden, Utility With Ref Racks, Utility Without Ref Racks, Empty
  tuneStatus: text("tune_status"), // Maximum, Medium, Stock, NA
  region: varchar("region"),
  district: varchar("district"),
  deliveryAddress: text("delivery_address"),
  city: text("city"),
  state: varchar("state", { length: 2 }),
  zip: varchar("zip", { length: 10 }),
  mis: varchar("mis"),
  remainingBookValue: decimal("remaining_book_value", { precision: 10, scale: 2 }),
  leaseEndDate: date("lease_end_date"),
  status: text("status").notNull().default("available"), // available, assigned, maintenance, retired
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const storageSpots = pgTable("storage_spots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  address: text("address").notNull(),
  city: text("city").notNull(),
  state: varchar("state", { length: 2 }).notNull(),
  zipCode: varchar("zip_code", { length: 10 }).notNull(),
  status: text("status").notNull().default("open"), // open, closed, maintenance
  availableSpots: integer("available_spots").notNull().default(0),
  totalCapacity: integer("total_capacity").notNull(),
  notes: text("notes"),
  contactInfo: text("contact_info"),
  operatingHours: text("operating_hours"),
  facilityType: text("facility_type").notNull().default("outdoor"), // outdoor, indoor, covered
  securityLevel: text("security_level").notNull().default("standard"), // basic, standard, high
  accessInstructions: text("access_instructions"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});


// Insert schemas
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
});

export const insertRequestSchema = createInsertSchema(requests).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertApiConfigurationSchema = createInsertSchema(apiConfigurations).omit({
  id: true,
  lastChecked: true,
  createdAt: true,
});

export const insertActivityLogSchema = createInsertSchema(activityLogs).omit({
  id: true,
  createdAt: true,
});

export const insertVehicleSchema = createInsertSchema(vehicles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertQueueItemSchema = createInsertSchema(queueItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertStorageSpotSchema = createInsertSchema(storageSpots).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// API endpoint validation schemas
export const saveProgressSchema = z.object({
  notes: z.string().optional(),
  adminNotes: z.string().optional(),
  assignedTo: z.string().optional(),
  lastWorkedBy: z.string().optional(), 
  workInProgress: z.boolean().optional().default(false),
});

export const completeQueueItemSchema = z.object({
  completedBy: z.string().min(1, "completedBy is required"),
  finalNotes: z.string().optional(),
  decisionType: z.string().optional(),
  requiresReview: z.boolean().optional().default(false),
  adminNotes: z.string().optional(),
});

export const assignQueueItemSchema = z.object({
  assigneeId: z.string().min(1, "assigneeId is required"),
});

// Anonymous form submission schemas with field whitelisting
export const anonymousQueueItemSchema = z.object({
  workflowType: z.enum(["onboarding", "offboarding", "vehicle_assignment", "decommission", "byov_assignment", "storage_request"]),
  title: z.string().min(1).max(200, "Title must be 200 characters or less"),
  description: z.string().min(1).max(2000, "Description must be 2000 characters or less"),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  data: z.string().max(10000, "Data must be 10000 characters or less").optional(), // JSON string
  scheduledFor: z.string().datetime().optional(),
  // Note: requesterId, department, status, attempts are added by server, not submitted by client
}).strict(); // .strict() ensures only allowed fields are accepted

export const anonymousVehicleSchema = z.object({
  vin: z.string().min(17).max(17, "VIN must be exactly 17 characters"),
  modelYear: z.number().int().min(1990).max(new Date().getFullYear() + 2),
  makeName: z.string().min(1).max(100),
  modelName: z.string().min(1).max(100),
  color: z.string().max(50).optional(),
  licensePlate: z.string().max(20).optional(),
  licenseState: z.string().length(2).optional(),
  // Allow only safe vehicle fields for anonymous submission
}).strict();

export const anonymousStorageSpotSchema = z.object({
  name: z.string().min(1).max(200, "Name must be 200 characters or less"),
  address: z.string().min(1).max(500, "Address must be 500 characters or less"),
  city: z.string().min(1).max(100, "City must be 100 characters or less"),
  state: z.string().length(2, "State must be 2 characters"),
  zipCode: z.string().min(5).max(10, "Zip code must be between 5-10 characters"),
  notes: z.string().max(1000, "Notes must be 1000 characters or less").optional(),
  contactInfo: z.string().max(500, "Contact info must be 500 characters or less").optional(),
  operatingHours: z.string().max(200, "Operating hours must be 200 characters or less").optional(),
  facilityType: z.enum(["outdoor", "indoor", "covered"]).default("outdoor"),
  // Exclude admin fields like totalCapacity, availableSpots, etc.
}).strict();

// Types
export type User = typeof users.$inferSelect & {
  accessibleQueues?: QueueModule[];
};
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Request = typeof requests.$inferSelect;
export type InsertRequest = z.infer<typeof insertRequestSchema>;
export type ApiConfiguration = typeof apiConfigurations.$inferSelect;
export type InsertApiConfiguration = z.infer<typeof insertApiConfigurationSchema>;
export type ActivityLog = typeof activityLogs.$inferSelect;
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;
export type Vehicle = typeof vehicles.$inferSelect;
export type InsertVehicle = z.infer<typeof insertVehicleSchema>;
export type QueueItem = typeof queueItems.$inferSelect;
export type InsertQueueItem = z.infer<typeof insertQueueItemSchema>;
export type StorageSpot = typeof storageSpots.$inferSelect;
export type InsertStorageSpot = z.infer<typeof insertStorageSpotSchema>;

// Combined queue item with module information for unified queue access
export type CombinedQueueItem = QueueItem & {
  module: QueueModule;
};

// API endpoint types
export type SaveProgressPayload = z.infer<typeof saveProgressSchema>;
export type CompleteQueueItemPayload = z.infer<typeof completeQueueItemSchema>;
export type AssignQueueItemPayload = z.infer<typeof assignQueueItemSchema>;
export type AnonymousQueueItemPayload = z.infer<typeof anonymousQueueItemSchema>;
export type AnonymousVehiclePayload = z.infer<typeof anonymousVehicleSchema>;
export type AnonymousStorageSpotPayload = z.infer<typeof anonymousStorageSpotSchema>;
