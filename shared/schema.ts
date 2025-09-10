import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, integer, decimal, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").notNull().default("field"), // superadmin, agent, field
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
  data: text("data"), // JSON payload with workflow-specific data
  metadata: text("metadata"), // Additional metadata for automation hooks
  notes: text("notes"), // Agent notes for tracking work progress
  scheduledFor: timestamp("scheduled_for"), // For delayed processing
  attempts: integer("attempts").notNull().default(0), // For retry logic
  lastError: text("last_error"), // Error message from last failed attempt
  completedAt: timestamp("completed_at"),
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

// Types
export type User = typeof users.$inferSelect;
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
