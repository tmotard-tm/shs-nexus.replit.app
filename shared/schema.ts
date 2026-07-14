import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, integer, decimal, date, index, uniqueIndex, jsonb, serial, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Queue module types for unified queue access
export type QueueModule = 'ntao' | 'assets' | 'inventory' | 'fleet';

// Role types - Developer, Admin, and Agent
export type UserRole = 'developer' | 'admin' | 'agent';

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").notNull().default("agent"), // developer, agent (simplified from 9 roles)
  departments: text("departments").array(), // Array of accessible departments: ['NTAO', 'ASSETS', 'INVENTORY', 'FLEET']
  isActive: boolean("is_active").notNull().default(true), // Whether the user can log in
  permissionOverrides: jsonb("permission_overrides"), // Sparse user-level permission overrides (same structure as RolePermissionSettings, only stores differences)
  securityQuestions: jsonb("security_questions"), // Array of {questionId, questionText, answerHash} for password reset
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => {
  return {
    // Case-insensitive unique constraints to prevent duplicates that differ only by case
    usernameIdx: index("users_username_lower_idx").on(sql`LOWER(${table.username})`),
    emailIdx: index("users_email_lower_idx").on(sql`LOWER(${table.email})`),
  };
});

// Role permissions table - stores hierarchical UI visibility settings per role
export const rolePermissions = pgTable("role_permissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  role: text("role").notNull().unique(), // 'developer', 'admin', or 'agent'
  permissions: jsonb("permissions").notNull(), // Hierarchical permission object
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Permission structure type for the jsonb column
export interface RolePermissionSettings {
  homePage: boolean;
  quickActions: {
    enabled: boolean;
    taskQueue: boolean;
    offboarding: boolean;
    onboarding: boolean;
    assignVehicle: boolean;
    weeklyOnboarding: boolean;
    weeklyOffboarding: boolean;
    createVehicle: boolean;
    fleetScope: boolean;
    vehicleRentalManagement: boolean;
    tpms: boolean;
  };
  sidebar: {
    enabled: boolean;
    fleetScope: boolean;
    tpms: boolean;
    vehicleRentalManagement: boolean;
    dashboards: {
      enabled: boolean;
      dashboard: boolean;
      vehicleAssignmentDash: boolean;
      operationsDash: boolean;
      rentalReductionDash: boolean;
      reporting: boolean;
    };
    queues: {
      enabled: boolean;
      queueManagement: boolean;
      ntaoQueue: boolean;
      assetsQueue: boolean;
      inventoryQueue: boolean;
      fleetQueue: boolean;
      offboardingQueue: boolean;
    };
    management: {
      enabled: boolean;
      storageSpots: boolean;
      integrations: boolean;
      userManagement: boolean;
      templateManagement: boolean;
      costCenterManagement: boolean;
      externalAppManagement: boolean;
      rolePermissions: boolean;
      fleetManagement: boolean;
      weeklyOnboarding: boolean;
      weeklyOffboarding: boolean;
      communicationHub: boolean;
      techRoster: boolean;
      rentalOperations: boolean;
      wmsEngine: boolean;
      byovBulkUpload: boolean;
    };
    activities: {
      enabled: boolean;
      activityLogs: boolean;
      communicationHub: boolean;
      fleetCommunications: boolean;
    };
    account: {
      enabled: boolean;
      changePassword: boolean;
    };
    helpAndTutorial: {
      enabled: boolean;
      tutorial: boolean;
      about: boolean;
      flowcharts: boolean;
    };
  };
  // Page-level feature permissions - granular control over elements within each page
  pageFeatures: {
    queueManagement: {
      enabled: boolean;
      // Filters Section
      filters: {
        enabled: boolean;
        queueCheckboxes: boolean;
        statusCards: boolean;
        employeeSearch: boolean;
        workflowTypeFilter: boolean;
        assignedAgentFilter: boolean;
        dateFilters: boolean;
        sortOrder: boolean;
      };
      // Task Item Actions
      taskActions: {
        enabled: boolean;
        viewTask: boolean;
        startWork: boolean;
        continueWork: boolean;
        pickUpForMe: boolean;
        assignToOther: boolean;
      };
      // Admin Actions (in view dialog)
      adminActions: {
        enabled: boolean;
        releaseTask: boolean;
        reassignTask: boolean;
      };
    };
    userManagement: {
      enabled: boolean;
      createUser: boolean;
      editUser: boolean;
      deleteUser: boolean;
      resetPassword: boolean;
      changeRole: boolean;
    };
    templateManagement: {
      enabled: boolean;
      createTemplate: boolean;
      editTemplate: boolean;
      deleteTemplate: boolean;
      toggleStatus: boolean;
    };
    fleetManagement: {
      enabled: boolean;
      viewVehicles: boolean;
      syncToHolman: boolean;
      unassignVehicle: boolean;
      viewHistory: boolean;
    };
    storageSpots: {
      enabled: boolean;
      createSpot: boolean;
      editSpot: boolean;
      deleteSpot: boolean;
    };
    communicationHub: {
      enabled: boolean;
      editTemplates: boolean;
      changeMode: boolean;
      manageWhitelist: boolean;
      viewLogs: boolean;
    };
    createVehicle: {
      enabled: boolean;
      manualVehicleNumberEntry: boolean;
      updateDistricts: boolean;
    };
  };
}

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
}, (table) => {
  return {
    statusIdx: index("requests_status_idx").on(table.status),
    requesterIdIdx: index("requests_requester_id_idx").on(table.requesterId),
    createdAtIdx: index("requests_created_at_idx").on(table.createdAt),
    typeIdx: index("requests_type_idx").on(table.type),
  };
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
}, (table) => {
  return {
    userIdIdx: index("activity_logs_user_id_idx").on(table.userId),
    actionIdx: index("activity_logs_action_idx").on(table.action),
    entityTypeIdx: index("activity_logs_entity_type_idx").on(table.entityType),
    createdAtIdx: index("activity_logs_created_at_idx").on(table.createdAt),
    userIdCreatedAtIdx: index("activity_logs_user_id_created_at_idx").on(table.userId, table.createdAt),
  };
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
  team: text("team"), // Team identifier for metrics tracking
  data: text("data"), // JSON payload with workflow-specific data
  metadata: text("metadata"), // Additional metadata for automation hooks
  notes: text("notes"), // Agent notes for tracking work progress
  scheduledFor: timestamp("scheduled_for"), // For delayed processing
  attempts: integer("attempts").notNull().default(0), // For retry logic
  lastError: text("last_error"), // Error message from last failed attempt
  completedAt: timestamp("completed_at"),
  startedAt: timestamp("started_at"), // When work started on this item
  firstResponseAt: timestamp("first_response_at"), // When first response was made to this item
  // Workflow dependency fields
  workflowId: varchar("workflow_id"), // Groups related tasks in a workflow sequence
  workflowStep: integer("workflow_step"), // Order/step number in the workflow (1, 2, 3, 4)
  dependsOn: varchar("depends_on"), // ID of task that must be completed before this one
  autoTrigger: boolean("auto_trigger").notNull().default(false), // Whether this task should auto-trigger when dependencies complete
  triggerData: text("trigger_data"), // Data for auto-triggered tasks
  // Tools queue fields (Sprint 1: Schema + Task Creation)
  isByov: boolean("is_byov").default(false), // Is this a Bring Your Own Vehicle tech? (legacy, use vehicleType)
  vehicleType: text("vehicle_type").default("company"), // 'company' | 'byov' | 'rental'
  fleetRoutingDecision: text("fleet_routing_decision"), // Routing decision from Fleet
  routingReceivedAt: timestamp("routing_received_at"), // When routing decision was received
  blockedActions: text("blocked_actions").array(), // Array of blocked action identifiers
  // Sprint 6: Task Checklist (6 boolean fields for Claudia's workflow)
  taskToolsReturn: boolean("task_tools_return").default(false),
  taskIphoneReturn: boolean("task_iphone_return").default(false),
  taskDisconnectedLine: boolean("task_disconnected_line").default(false),
  taskDisconnectedMPayment: boolean("task_disconnected_mpayment").default(false),
  taskCloseSegnoOrders: boolean("task_close_segno_orders").default(false),
  taskCreateShippingLabel: boolean("task_create_shipping_label").default(false),
  carrier: text("carrier"), // 'Verizon' | 'T-Mobile' | null
  // Sprint 1: Tool Audit Notification tracking
  toolAuditNotificationSent: boolean("tool_audit_notification_sent").default(false),
  toolAuditNotificationSentAt: timestamp("tool_audit_notification_sent_at"),
  phoneNumber: text("phone_number"),
  phoneContactHistory: jsonb("phone_contact_history").default([]),
  phoneContactMethod: text("phone_contact_method"),
  phoneShippingLabelSent: boolean("phone_shipping_label_sent").default(false),
  phoneTrackingNumber: text("phone_tracking_number"),
  phoneDateReceived: timestamp("phone_date_received"),
  phonePhysicalCondition: text("phone_physical_condition"),
  phoneConditionNotes: text("phone_condition_notes"),
  phoneDataWipeCompleted: boolean("phone_data_wipe_completed").default(false),
  phoneWipeMethod: text("phone_wipe_method"),
  phoneReprovisionCompleted: boolean("phone_reprovision_completed").default(false),
  phoneCarrierLineDetails: text("phone_carrier_line_details"),
  phoneServiceReinstated: boolean("phone_service_reinstated").default(false),
  phoneDateReady: timestamp("phone_date_ready"),
  phoneAssignedToNewHire: text("phone_assigned_to_new_hire"),
  phoneNewHireDepartment: text("phone_new_hire_department"),
  phoneRecoveryStage: text("phone_recovery_stage").default("initiation"),
  phoneWrittenOff: boolean("phone_written_off").default(false),
  isTlt: boolean("is_tlt").default(false),
  automationDetail: jsonb("automation_detail"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => {
  return {
    // Performance indexes for metrics queries
    departmentIdx: index("queue_items_department_idx").on(table.department),
    statusIdx: index("queue_items_status_idx").on(table.status),
    assignedToIdx: index("queue_items_assigned_to_idx").on(table.assignedTo),
    createdAtIdx: index("queue_items_created_at_idx").on(table.createdAt),
    startedAtIdx: index("queue_items_started_at_idx").on(table.startedAt),
    completedAtIdx: index("queue_items_completed_at_idx").on(table.completedAt),
    teamIdx: index("queue_items_team_idx").on(table.team),
    // Composite indexes for common filtering patterns
    departmentStatusIdx: index("queue_items_department_status_idx").on(table.department, table.status),
    assignedToStatusIdx: index("queue_items_assigned_to_status_idx").on(table.assignedTo, table.status),
  };
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
  holmanVehicleRef: varchar("holman_vehicle_ref", { length: 10 }),
  tpmsVehicleRef: varchar("tpms_vehicle_ref", { length: 10 }),
  snowflakeVehicleRef: varchar("snowflake_vehicle_ref", { length: 20 }),
  vehicleNumberDisplay: varchar("vehicle_number_display", { length: 10 }),
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

export const templates = pgTable("templates", {
  id: text("id").primaryKey(), // template ID like "assets_onboard_technician_v1"
  department: text("department").notNull(), // ASSETS, FLEET, INVENTORY, NTAO
  workflowType: text("workflow_type").notNull(), // onboarding, offboarding, vehicle_assignment, etc.
  version: text("version").notNull(), // version like "1.0"
  name: text("name").notNull(), // human readable name
  content: text("content").notNull(), // full JSON template content as string
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => {
  return {
    // Index for faster lookups by workflow type and department
    workflowTypeDeptIdx: index("templates_workflow_type_dept_idx").on(table.workflowType, table.department),
    departmentIdx: index("templates_department_idx").on(table.department),
    isActiveIdx: index("templates_is_active_idx").on(table.isActive),
  };
});

export const sessions = pgTable("sessions", {
  id: varchar("id").primaryKey(), // session ID (random hex string)
  userId: varchar("user_id").notNull(),
  username: text("username").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => {
  return {
    // Index for cleanup of expired sessions
    expiresAtIdx: index("sessions_expires_at_idx").on(table.expiresAt),
    userIdIdx: index("sessions_user_id_idx").on(table.userId),
  };
});

// Password reset tokens - persisted to survive server restarts
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  token: varchar("token", { length: 64 }).notNull().unique(),
  userId: varchar("user_id").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"), // Set when token is consumed
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => {
  return {
    tokenIdx: index("password_reset_tokens_token_idx").on(table.token),
    userIdIdx: index("password_reset_tokens_user_id_idx").on(table.userId),
    expiresAtIdx: index("password_reset_tokens_expires_at_idx").on(table.expiresAt),
  };
});

export const insertPasswordResetTokenSchema = createInsertSchema(passwordResetTokens).omit({ id: true, createdAt: true, usedAt: true });
export type InsertPasswordResetToken = z.infer<typeof insertPasswordResetTokenSchema>;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;

// Termed Technicians from Snowflake DRIVELINE_TERMED_TECHS_LAST30 view
export const termedTechs = pgTable("termed_techs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // Core fields from Snowflake (mapped per user requirements)
  employeeId: varchar("employee_id", { length: 11 }).notNull().unique(), // EMPL_ID
  techRacfid: varchar("tech_racfid", { length: 20 }).notNull(), // ENTERPRISE_ID
  techName: text("tech_name").notNull(), // FULL_NAME
  lastDayWorked: date("last_day_worked"), // DATE_LAST_WORKED
  // Additional useful fields from Snowflake
  firstName: text("first_name"),
  lastName: text("last_name"),
  jobTitle: text("job_title"),
  districtNo: varchar("district_no"),
  planningAreaName: text("planning_area_name"),
  employmentStatus: varchar("employment_status", { length: 5 }),
  effectiveDate: date("effective_date"), // EFFDT
  // Sync and offboarding tracking
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
  offboardingTaskCreated: boolean("offboarding_task_created").notNull().default(false),
  offboardingTaskId: varchar("offboarding_task_id"), // Reference to queue_items.id
  processedAt: timestamp("processed_at"), // When offboarding was fully processed
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => {
  return {
    employeeIdIdx: index("termed_techs_employee_id_idx").on(table.employeeId),
    techRacfidIdx: index("termed_techs_tech_racfid_idx").on(table.techRacfid),
    lastDayWorkedIdx: index("termed_techs_last_day_worked_idx").on(table.lastDayWorked),
    offboardingTaskCreatedIdx: index("termed_techs_offboarding_task_created_idx").on(table.offboardingTaskCreated),
  };
});

// All Technicians from Snowflake - unified employee roster with termination tracking
// Termed employees are identified by effectiveDate >= CURRENT_DATE - 30 days
export const allTechs = pgTable("all_techs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // Core fields
  employeeId: varchar("employee_id", { length: 11 }).notNull().unique(), // EMPL_ID
  techRacfid: varchar("tech_racfid", { length: 20 }).notNull(), // ENTERPRISE_ID
  techName: text("tech_name").notNull(), // FULL_NAME
  // Additional fields from Snowflake
  firstName: text("first_name"),
  lastName: text("last_name"),
  jobTitle: text("job_title"),
  districtNo: varchar("district_no"),
  planningAreaName: text("planning_area_name"),
  employmentStatus: varchar("employment_status", { length: 5 }),
  // Termination tracking fields (for identifying termed employees)
  effectiveDate: date("effective_date"), // EFFDT - used to filter termed employees
  lastDayWorked: date("last_day_worked"), // DATE_LAST_WORKED
  // Contact info from ORA_TECH_LAST_KNOWN_CONTACT_VW_VIEW (joined by EMPLID)
  homeAddr1: text("home_addr1"), // SNSTV_HOME_ADDR1
  homeAddr2: text("home_addr2"), // SNSTV_HOME_ADDR2
  homeCity: text("home_city"), // SNSTV_HOME_CITY
  homeState: text("home_state"), // SNSTV_HOME_STATE
  homePostal: text("home_postal"), // SNSTV_HOME_POSTAL
  mainPhone: text("main_phone"), // SNSTV_MAIN_PHONE
  cellPhone: text("cell_phone"), // SNSTV_CELL_PHONE
  homePhone: text("home_phone"), // SNSTV_HOME_PHONE
  // TPMS truck assignment from TPMS_EXTRACT_LAST_ASSIGNED (joined by ENTERPRISE_ID)
  // These fields are informational-only: they reflect the last snapshot in which a truck was
  // associated with this tech. The value may be weeks or months stale. Never treat as current.
  // Legacy column preserved (13K rows in prod). Superseded by lastKnownTruckLu but retained
  // to prevent destructive drop on deploy. Do not write new code against it.
  truckLu: text("truck_lu"),
  lastKnownTruckLu: text("last_known_truck_lu"), // TRUCK_LU — last snapshot, not current assignment
  // Converted in prod from text to date on 2026-04-21 via manual ALTER to unblock deploy planner (dev-as-source-of-truth). mode:"string" preserves existing string-based read contract for all existing read sites.
  lastKnownTruckFileDate: date("last_known_truck_file_date", { mode: "string" }), // FILE_DATE of the snapshot row
  // Offboarding tracking (previously only in termed_techs)
  offboardingTaskCreated: boolean("offboarding_task_created").notNull().default(false),
  offboardingTaskId: varchar("offboarding_task_id"), // Reference to queue_items.id
  processedAt: timestamp("processed_at"), // When offboarding was fully processed
  // Sync tracking
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => {
  return {
    employeeIdIdx: index("all_techs_employee_id_idx").on(table.employeeId),
    techRacfidIdx: index("all_techs_tech_racfid_idx").on(table.techRacfid),
    employmentStatusIdx: index("all_techs_employment_status_idx").on(table.employmentStatus),
    effectiveDateIdx: index("all_techs_effective_date_idx").on(table.effectiveDate),
    offboardingTaskCreatedIdx: index("all_techs_offboarding_task_created_idx").on(table.offboardingTaskCreated),
  };
});

// Sync Log for tracking Snowflake sync history
export const syncLogs = pgTable("sync_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  syncType: text("sync_type").notNull(), // termed_techs, all_techs, truck_inventory
  status: text("status").notNull().default("pending"), // pending, running, completed, failed
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  recordsProcessed: integer("records_processed").default(0),
  recordsCreated: integer("records_created").default(0),
  recordsUpdated: integer("records_updated").default(0),
  queueItemsCreated: integer("queue_items_created").default(0),
  errorMessage: text("error_message"),
  triggeredBy: text("triggered_by"), // scheduler, manual, api
});

// LOA Recovery snapshot — one row per qualifying tech per sync run.
// Captures the active continuous-leave roster (>=30 days) used to drive the
// LOA Recovery queue lane. Append-only audit trail; latest run is identified
// by syncedAt and used by the read endpoint.
export const loaRecoverySnapshot = pgTable("loa_recovery_snapshot", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  enterpriseId: varchar("enterprise_id", { length: 20 }).notNull(),
  employeeNumber: varchar("employee_number", { length: 20 }),
  sfStatus: varchar("sf_status", { length: 5 }), // L, P, or null when no match in DRIVELINE_ALL_TECHS
  startDate: date("start_date"),
  endDate: date("end_date"),
  days: integer("days").notNull(),
  source: varchar("source", { length: 16 }).notNull(), // 'api' (always — API is source of truth)
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
}, (table) => {
  return {
    enterpriseIdIdx: index("loa_recovery_snapshot_enterprise_id_idx").on(table.enterpriseId),
    syncedAtIdx: index("loa_recovery_snapshot_synced_at_idx").on(table.syncedAt),
  };
});

// LOA leave tracking (Task #437) — one persistent row per leave (ALL leaves,
// not just 30+). Keyed by workflowId (`loa-{ent}-{startDate}`) so it lines up
// with the recovery queue workflow. Holds the fields needed to drive and audit
// the automated notifications independently of whether a 30+ recovery queue
// item exists. Created idempotently via raw SQL in the sync service (like
// loa_recovery_snapshot) to avoid drizzle-kit push conflicts with fs_* tables.
export const loaLeaves = pgTable("loa_leaves", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workflowId: varchar("workflow_id").notNull().unique(),
  enterpriseId: varchar("enterprise_id", { length: 20 }).notNull(),
  employeeNumber: varchar("employee_number", { length: 20 }),
  techName: text("tech_name"),
  firstName: text("first_name"),
  phone: varchar("phone", { length: 32 }),
  vanNumber: varchar("van_number", { length: 32 }),
  district: varchar("district", { length: 16 }),
  isRental: boolean("is_rental").notNull().default(false),
  startDate: date("start_date"),
  expectedReturnDate: date("expected_return_date"),
  durationDays: integer("duration_days").notNull().default(0),
  sfStatus: varchar("sf_status", { length: 5 }),
  // Per-notification send-state (timestamp + provider message id)
  teamNoticeSentAt: timestamp("team_notice_sent_at"),
  teamNoticeMsgId: text("team_notice_msg_id"),
  returnNoticeSentAt: timestamp("return_notice_sent_at"),
  returnNoticeMsgId: text("return_notice_msg_id"),
  techSmsSentAt: timestamp("tech_sms_sent_at"),
  techSmsMsgId: text("tech_sms_msg_id"),
  // Extension re-trigger marker (sub-30 -> 30+)
  extensionTriggered: boolean("extension_triggered").notNull().default(false),
  extensionTriggeredAt: timestamp("extension_triggered_at"),
  extensionNoticeSentAt: timestamp("extension_notice_sent_at"),
  extensionNoticeMsgId: text("extension_notice_msg_id"),
  // Day-30 recovery pause
  recoveryPaused: boolean("recovery_paused").notNull().default(false),
  recoveryPausedAt: timestamp("recovery_paused_at"),
  // Closed = tech returned / no longer in the active leave roster. Suppresses
  // the return-notice send.
  closed: boolean("closed").notNull().default(false),
  closedAt: timestamp("closed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  lastSyncedAt: timestamp("last_synced_at").defaultNow().notNull(),
}, (table) => {
  return {
    enterpriseIdIdx: index("loa_leaves_enterprise_id_idx").on(table.enterpriseId),
    startDateIdx: index("loa_leaves_start_date_idx").on(table.startDate),
  };
});

export const insertLoaLeaveSchema = createInsertSchema(loaLeaves).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastSyncedAt: true,
});
export type InsertLoaLeave = z.infer<typeof insertLoaLeaveSchema>;
export type LoaLeave = typeof loaLeaves.$inferSelect;

// LOA internal team distribution list (Task #437) — editable Fleet/Assets/
// Inventory recipient addresses managed from a settings page. One row per team.
export const loaTeamRecipients = pgTable("loa_team_recipients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  team: varchar("team", { length: 20 }).notNull().unique(), // 'fleet' | 'assets' | 'inventory'
  emails: text("emails").array().notNull().default(sql`ARRAY[]::text[]`),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedBy: varchar("updated_by").references(() => users.id),
});

export const insertLoaTeamRecipientsSchema = createInsertSchema(loaTeamRecipients).omit({
  id: true,
  updatedAt: true,
});
export type InsertLoaTeamRecipients = z.infer<typeof insertLoaTeamRecipientsSchema>;
export type LoaTeamRecipients = typeof loaTeamRecipients.$inferSelect;

// Truck Inventory from Snowflake PISR_SKU_DETAIL - parts/inventory on each truck
export const truckInventory = pgTable("truck_inventory", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // Core fields from Snowflake query
  extractDate: date("extract_date").notNull(), // EXTRACT_DATE
  district: varchar("district", { length: 10 }).notNull(), // LPAD(DISTRICT,7,0)
  truck: varchar("truck", { length: 10 }).notNull(), // LPAD(TRUCK,6,0)
  techId: varchar("tech_id", { length: 10 }), // LPAD(TECH_ID,7,0)
  enterpriseId: varchar("enterprise_id", { length: 20 }), // UPPER(ENTERPRISE_ID)
  div: varchar("div", { length: 10 }),
  pls: varchar("pls", { length: 20 }),
  partNo: text("part_no"), // PART_NO
  partDesc: text("part_desc"), // PART_DESC
  sku: varchar("sku", { length: 50 }), // SKU
  nsAvgCost: decimal("ns_avg_cost", { precision: 12, scale: 4 }), // AVG_COST AS NS_AVG_COST
  imCost: decimal("im_cost", { precision: 12, scale: 4 }), // COST AS IM_COST
  sell: decimal("sell", { precision: 12, scale: 4 }), // SELL
  bin: varchar("bin", { length: 20 }), // BIN
  qty: integer("qty").notNull().default(0), // QTY
  truckstockAddDate: date("truckstock_add_date"), // TRUCKSTOCK_ADD_DATE
  truckstockChangeDate: date("truckstock_change_date"), // TRUCKSTOCK_CHANGE_DATE
  extNsAvgCost: decimal("ext_ns_avg_cost", { precision: 14, scale: 4 }), // QTY * AVG_COST
  extImCost: decimal("ext_im_cost", { precision: 14, scale: 4 }), // QTY * COST
  productCategory: text("product_category"), // PRODUCT_CATEGORY (joined from MSL/PC)
  // Sync tracking
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => {
  return {
    // Composite unique constraint for truck+sku+bin per extract date
    uniqueSkuIdx: index("truck_inventory_unique_idx").on(table.truck, table.sku, table.bin, table.extractDate),
    truckIdx: index("truck_inventory_truck_idx").on(table.truck),
    enterpriseIdIdx: index("truck_inventory_enterprise_id_idx").on(table.enterpriseId),
    districtIdx: index("truck_inventory_district_idx").on(table.district),
    extractDateIdx: index("truck_inventory_extract_date_idx").on(table.extractDate),
    productCategoryIdx: index("truck_inventory_product_category_idx").on(table.productCategory),
  };
});

// Tech-Vehicle Assignments from TPMS (links technicians to their assigned trucks)
export const techVehicleAssignments = pgTable("tech_vehicle_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // Technician info (from all_techs/TPMS)
  techRacfid: varchar("tech_racfid", { length: 20 }).notNull(), // Enterprise ID / LDAP ID
  employeeId: varchar("employee_id", { length: 11 }), // Optional link to all_techs
  techName: text("tech_name"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  districtNo: varchar("district_no"),
  // Vehicle info (from TPMS)
  truckNo: varchar("truck_no", { length: 20 }), // TPMS truck number
  vehicleId: varchar("vehicle_id"), // Optional link to vehicles table
  // TPMS additional data
  techId: varchar("tech_id", { length: 20 }), // TPMS internal tech ID
  contactNo: varchar("contact_no", { length: 20 }),
  email: text("email"),
  // Assignment status
  assignmentStatus: text("assignment_status").notNull().default("active"), // active, inactive, pending
  lastTpmsSync: timestamp("last_tpms_sync"),
  tpmsDataRaw: text("tpms_data_raw"), // JSON string of full TPMS response for debugging
  // Tracking
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => {
  return {
    techRacfidIdx: index("tva_tech_racfid_idx").on(table.techRacfid),
    truckNoIdx: index("tva_truck_no_idx").on(table.truckNo),
    districtNoIdx: index("tva_district_no_idx").on(table.districtNo),
    assignmentStatusIdx: index("tva_assignment_status_idx").on(table.assignmentStatus),
  };
});

// Tech-Vehicle Assignment History (for tracking changes over time)
export const techVehicleAssignmentHistory = pgTable("tech_vehicle_assignment_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  techRacfid: varchar("tech_racfid", { length: 20 }).notNull(),
  truckNo: varchar("truck_no", { length: 20 }),
  previousTruckNo: varchar("previous_truck_no", { length: 20 }),
  changeType: text("change_type").notNull(), // assigned, unassigned, changed, status_changed, updated
  changeSource: text("change_source").notNull(), // tpms_sync, manual, offboarding
  changedBy: text("changed_by"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => {
  return {
    techRacfidIdx: index("tvah_tech_racfid_idx").on(table.techRacfid),
    createdAtIdx: index("tvah_created_at_idx").on(table.createdAt),
  };
});

// TPMS Cached Assignments - Caches successful TPMS API responses for fallback when API is rate-limited
export const tpmsCachedAssignments = pgTable("tpms_cached_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // Lookup key - the enterprise ID or truck number used to query TPMS
  lookupKey: varchar("lookup_key", { length: 50 }).notNull().unique(), // Enterprise ID or Truck Number
  lookupType: text("lookup_type").notNull().default("enterprise_id"), // 'enterprise_id' or 'truck_number'
  // Cached TPMS response data
  truckNo: varchar("truck_no", { length: 20 }),
  enterpriseId: varchar("enterprise_id", { length: 20 }),
  techId: varchar("tech_id", { length: 20 }),
  firstName: text("first_name"),
  lastName: text("last_name"),
  districtNo: varchar("district_no"),
  contactNo: varchar("contact_no", { length: 30 }),
  email: text("email"),
  // Full TPMS response stored as JSON for complete data access
  rawResponse: text("raw_response"), // JSON string of full TechInfoResponse
  // Cache status tracking
  status: text("status").notNull().default("live"), // 'live', 'cached', 'stale', 'error'
  lastSuccessAt: timestamp("last_success_at"), // When API last returned success
  lastAttemptAt: timestamp("last_attempt_at"), // When we last tried the API
  lastErrorCode: integer("last_error_code"), // HTTP status code of last error
  lastErrorMessage: text("last_error_message"), // Error message from last failure
  failureCount: integer("failure_count").notNull().default(0), // Consecutive failure count
  // Timestamps
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => {
  return {
    lookupKeyIdx: index("tpms_cache_lookup_key_idx").on(table.lookupKey),
    enterpriseIdIdx: index("tpms_cache_enterprise_id_idx").on(table.enterpriseId),
    truckNoIdx: index("tpms_cache_truck_no_idx").on(table.truckNo),
    statusIdx: index("tpms_cache_status_idx").on(table.status),
    lastSuccessAtIdx: index("tpms_cache_last_success_idx").on(table.lastSuccessAt),
  };
});

// Vehicle Nexus Data - stores Nexus-specific vehicle data (post-offboard status, new location, etc.)
export const vehicleNexusData = pgTable("vehicle_nexus_data", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vehicleNumber: varchar("vehicle_number", { length: 20 }).notNull().unique(),
  vehicleNumberDisplay: varchar("vehicle_number_display", { length: 10 }),
  postOffboardedStatus: text("post_offboarded_status"), // Reserved for new hire, In repair, Declined repair, Available to assign for rental / sent to PMF, Not found
  nexusNewLocation: text("nexus_new_location"), // Full address: street, state, zipcode
  nexusNewLocationContact: varchar("nexus_new_location_contact", { length: 30 }), // Phone number
  keys: text("keys"), // Present, Not Present, Unknown/Would not Check
  repaired: text("repaired"), // Complete, In Process, Unknown if needed, Declined
  returnedRental: text("returned_rental"), // Confirmed, Needs a TLT, Unconfirmed, Denied
  comments: text("comments"), // Up to 400 characters
  phoneRecoveryInitiated: text("phone_recovery_initiated"), // yes or no
  toolsPartsLocation: text("tools_parts_location"), // in_the_truck or techs_home
  partsRecoveryInitiated: text("parts_recovery_initiated"), // yes or no
  updatedBy: text("updated_by"), // User who last updated
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => {
  return {
    vehicleNumberIdx: index("vnd_vehicle_number_idx").on(table.vehicleNumber),
    postOffboardedStatusIdx: index("vnd_post_offboarded_status_idx").on(table.postOffboardedStatus),
  };
});

export const insertVehicleNexusDataSchema = createInsertSchema(vehicleNexusData).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVehicleNexusData = z.infer<typeof insertVehicleNexusDataSchema>;
export type VehicleNexusData = typeof vehicleNexusData.$inferSelect;

export const offboardingTruckOverrides = pgTable("offboarding_truck_overrides", {
  id: serial("id").primaryKey(),
  enterpriseId: varchar("enterprise_id", { length: 50 }).notNull().unique(),
  truckNumber: varchar("truck_number", { length: 20 }).notNull(),
  vehicleNumberDisplay: varchar("vehicle_number_display", { length: 10 }),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertOffboardingTruckOverrideSchema = createInsertSchema(offboardingTruckOverrides).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOffboardingTruckOverride = z.infer<typeof insertOffboardingTruckOverrideSchema>;
export type OffboardingTruckOverride = typeof offboardingTruckOverrides.$inferSelect;

// HR Notes thread for LOA recovery table — append-only notes keyed by technician Enterprise ID
export const loaHrNotes = pgTable("loa_hr_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  enterpriseId: varchar("enterprise_id", { length: 50 }).notNull(), // stored uppercase
  note: text("note").notNull(),
  authorId: varchar("author_id").notNull(),
  authorName: text("author_name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => {
  return {
    enterpriseIdIdx: index("loa_hr_notes_enterprise_id_idx").on(table.enterpriseId),
    createdAtIdx: index("loa_hr_notes_created_at_idx").on(table.createdAt),
  };
});

export const insertLoaHrNoteSchema = createInsertSchema(loaHrNotes).omit({ id: true, createdAt: true });
export type InsertLoaHrNote = z.infer<typeof insertLoaHrNoteSchema>;
export type LoaHrNote = typeof loaHrNotes.$inferSelect;

// Per-viewer read state for LOA HR note threads
export const loaHrNoteReads = pgTable("loa_hr_note_reads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  enterpriseId: varchar("enterprise_id", { length: 50 }).notNull(), // stored uppercase
  userId: varchar("user_id").notNull(),
  lastReadAt: timestamp("last_read_at").defaultNow().notNull(),
}, (table) => {
  return {
    eidUserIdx: uniqueIndex("loa_hr_note_reads_eid_user_idx").on(table.enterpriseId, table.userId),
  };
});

export type LoaHrNoteRead = typeof loaHrNoteReads.$inferSelect;

// Summary row returned by the batch summary endpoint
export interface LoaHrNotesSummaryRow {
  enterpriseId: string;
  noteCount: number;
  unreadCount: number;
  latestNoteAt: string;
  hasUnread: boolean;
}

export const byovEnrollments = pgTable("byov_enrollments", {
  enterpriseId: text("enterprise_id").primaryKey(),
  fullName: text("full_name"),
  truckNumber: text("truck_number"),
  enrollmentType: text("enrollment_type"),
  inRental: boolean("in_rental").default(false),
  district: text("district"),
  status: text("status").default("approved"),
  approvedDate: text("approved_date"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type ByovEnrollment = typeof byovEnrollments.$inferSelect;

// Onboarding Hires from Snowflake HR data - tracks new tech hires for weekly truck assignment
export const onboardingHires = pgTable("onboarding_hires", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // Core fields from Snowflake NS_TECH_HIRE_ROSTER_VW
  serviceDate: date("service_date").notNull(), // Service_DT - hire start date
  employeeName: text("employee_name").notNull(), // EMPL_NAME
  enterpriseId: varchar("enterprise_id", { length: 50 }), // ENTERPRISE_ID
  workState: varchar("work_state", { length: 10 }), // WORK_STATE
  actionReasonDescr: text("action_reason_descr"), // ACTION_REASON_DESCR
  jobTitle: text("job_title"), // JOB_TITLE
  techType: varchar("tech_type", { length: 50 }), // Tech_Type
  district: varchar("district", { length: 50 }), // DISTRICT
  zipcode: varchar("zipcode", { length: 20 }), // LOCATION
  locationCity: text("location_city"), // LOCATION_CITY
  planningAreaName: text("planning_area_name"), // PLANNING_AREA_NAME
  specialties: text("specialties"), // SPECIALTIES from DEV_SEGNO.WORKFLOW_TBLS.ONBOARDING
  employmentStatus: text("employment_status"), // EMPLOYMENT_STATUS from DRIVELINE_ALL_TECHS
  address: text("address"), // Street address
  // Tracking fields
  truckAssigned: boolean("truck_assigned").notNull().default(false),
  assignedTruckNo: varchar("assigned_truck_no", { length: 20 }),
  truckAssignmentSource: varchar("truck_assignment_source", { length: 20 }), // 'tpms' or 'manual'
  assignedAt: timestamp("assigned_at"),
  assignedBy: text("assigned_by"),
  notes: text("notes"),
  // BYOV intent cross-check (from BYOV Dashboard) — RACFID-matched, null = no enrollment found
  byovIntent: varchar("byov_intent", { length: 20 }), // 'perm' | 'training' | null
  byovEnrollmentId: varchar("byov_enrollment_id", { length: 100 }),
  byovIntentCheckedAt: timestamp("byov_intent_checked_at"),
  // Sync tracking
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => {
  return {
    serviceDateIdx: index("onboarding_hires_service_date_idx").on(table.serviceDate),
    employeeNameIdx: index("onboarding_hires_employee_name_idx").on(table.employeeName),
    truckAssignedIdx: index("onboarding_hires_truck_assigned_idx").on(table.truckAssigned),
    enterpriseIdIdx: index("onboarding_hires_enterprise_id_idx").on(table.enterpriseId),
  };
});

// Security Questions for password reset
export interface StoredSecurityQuestion {
  questionId: string;
  questionText: string;
  answerHash: string;
}

export const PREDEFINED_SECURITY_QUESTIONS = [
  { id: "q1", text: "What is the name of your first pet?" },
  { id: "q2", text: "What city were you born in?" },
  { id: "q3", text: "What is your mother's maiden name?" },
  { id: "q4", text: "What was the name of your first school?" },
  { id: "q5", text: "What is your favorite movie?" },
  { id: "q6", text: "What street did you grow up on?" },
  { id: "q7", text: "What was the make of your first car?" },
  { id: "q8", text: "What is your favorite sports team?" },
] as const;

export const securityQuestionSetupSchema = z.array(
  z.object({
    questionId: z.string(),
    questionText: z.string(),
    answer: z.string().min(2, "Answer must be at least 2 characters"),
  })
).min(3, "You must set up at least 3 security questions").max(5, "Maximum 5 security questions");

// Password validation schema
export const passwordValidationSchema = z.string()
  .min(10, "Password must be at least 10 characters long. Consider using a passphrase for better security.")
  .max(128, "Password must not exceed 128 characters")
  .describe("Password policy: minimum 10 characters, supports spaces and special characters for passphrases");

// Insert schemas
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
}).extend({
  password: passwordValidationSchema,
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

export const insertTemplateSchema = createInsertSchema(templates).omit({
  id: true,
  createdAt: true,
});

// Extended schema for template seeding that includes the id field
export const insertTemplateWithIdSchema = createInsertSchema(templates).omit({
  createdAt: true,
});

export const insertSessionSchema = createInsertSchema(sessions).omit({
  createdAt: true,
});

export const insertTermedTechSchema = createInsertSchema(termedTechs).omit({
  id: true,
  syncedAt: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAllTechSchema = createInsertSchema(allTechs).omit({
  id: true,
  syncedAt: true,
  createdAt: true,
  updatedAt: true,
});

export const insertSyncLogSchema = createInsertSchema(syncLogs).omit({
  id: true,
  startedAt: true,
});

export const insertLoaRecoverySnapshotSchema = createInsertSchema(loaRecoverySnapshot).omit({
  id: true,
  syncedAt: true,
});

export type InsertLoaRecoverySnapshot = z.infer<typeof insertLoaRecoverySnapshotSchema>;
export type LoaRecoverySnapshot = typeof loaRecoverySnapshot.$inferSelect;

export const insertTruckInventorySchema = createInsertSchema(truckInventory).omit({
  id: true,
  syncedAt: true,
  createdAt: true,
  updatedAt: true,
});

export const insertTechVehicleAssignmentSchema = createInsertSchema(techVehicleAssignments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertTechVehicleAssignmentHistorySchema = createInsertSchema(techVehicleAssignmentHistory).omit({
  id: true,
  createdAt: true,
});

export const insertTpmsCachedAssignmentSchema = createInsertSchema(tpmsCachedAssignments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertOnboardingHireSchema = createInsertSchema(onboardingHires).omit({
  id: true,
  syncedAt: true,
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
  workflowId: z.string().max(100, "Workflow ID must be 100 characters or less").optional(), // Groups related tasks in a workflow sequence
  phoneNumber: z.string().max(30).optional(),
  phoneRecoveryStage: z.string().max(50).optional(),
  phoneContactHistory: z.array(z.object({
    date: z.string(),
    method: z.string(),
    outcome: z.string(),
    notes: z.string(),
  })).optional(),
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

// Unified form validation schemas
export const anonymousVehicleAssignmentSchema = z.object({
  firstName: z.string().min(1).max(100, "First name must be 100 characters or less"),
  lastName: z.string().min(1).max(100, "Last name must be 100 characters or less"),
  techId: z.string().min(1).max(50, "Tech ID must be 50 characters or less").optional(),
  email: z.string().email("Invalid email format").max(200).optional(),
  phone: z.string().max(20, "Phone must be 20 characters or less").optional(),
  startDate: z.string().datetime().optional(),
  department: z.string().max(100, "Department must be 100 characters or less").optional(),
  // Additional fields specific to vehicle assignment
}).strict();

export const anonymousOnboardingSchema = z.object({
  firstName: z.string().min(1).max(100, "First name must be 100 characters or less"),
  lastName: z.string().min(1).max(100, "Last name must be 100 characters or less"),
  techId: z.string().max(50, "Tech ID must be 50 characters or less").optional(),
  email: z.string().email("Invalid email format").max(200).optional(),
  phone: z.string().max(20, "Phone must be 20 characters or less").optional(),
  startDate: z.string().optional(),
  position: z.string().max(100, "Position must be 100 characters or less").optional(),
  department: z.string().max(100, "Department must be 100 characters or less").optional(),
  supervisor: z.string().max(100, "Supervisor must be 100 characters or less").optional(),
  manager: z.string().max(100, "Manager must be 100 characters or less").optional(),
  // Address fields
  street: z.string().max(200, "Street must be 200 characters or less").optional(),
  city: z.string().max(100, "City must be 100 characters or less").optional(),
  state: z.string().max(50, "State must be 50 characters or less").optional(),
  zipCode: z.string().max(10, "Zip code must be 10 characters or less").optional(),
  // Additional employee fields
  employeeId: z.string().max(50, "Employee ID must be 50 characters or less").optional(),
  region: z.string().max(100, "Region must be 100 characters or less").optional(),
  district: z.string().max(100, "District must be 100 characters or less").optional(),
  requisitionId: z.string().max(100, "Requisition ID must be 100 characters or less").optional(),
  enterpriseId: z.string().max(100, "Enterprise ID must be 100 characters or less").optional(),
  proposedRouteStartDate: z.string().optional(),
  // Specialty fields
  specialties: z.array(z.string()).optional(),
  isGeneralist: z.boolean().optional(),
  isFSSLTech: z.boolean().optional(),
}).strict();

export const anonymousOffboardingSchema = z.object({
  techName: z.string().min(1).max(200, "Tech name must be 200 characters or less"),
  techId: z.string().min(1).max(50, "Tech ID must be 50 characters or less").optional(),
  lastWorkDate: z.string().datetime().optional(),
  reason: z.string().max(500, "Reason must be 500 characters or less").optional(),
  returnDate: z.string().datetime().optional(),
  notes: z.string().max(1000, "Notes must be 1000 characters or less").optional(),
  vehicleType: z.enum(["sears-fleet", "byov", "rental"]).default("sears-fleet").optional(),
  // Additional offboarding-specific fields
}).strict();

export const anonymousByovEnrollmentSchema = z.object({
  techFirstName: z.string().min(1).max(100, "First name must be 100 characters or less"),
  techLastName: z.string().min(1).max(100, "Last name must be 100 characters or less"),
  techId: z.string().min(1).max(50, "Tech ID must be 50 characters or less").optional(),
  email: z.string().email("Invalid email format").max(200).optional(),
  phone: z.string().max(20, "Phone must be 20 characters or less").optional(),
  vehicleInfo: z.object({
    make: z.string().min(1).max(100),
    model: z.string().min(1).max(100),
    year: z.number().int().min(1990).max(new Date().getFullYear() + 2),
    vin: z.string().min(17).max(17, "VIN must be exactly 17 characters").optional(),
    licensePlate: z.string().max(20).optional(),
    licenseState: z.string().length(2).optional(),
  }).optional(),
  insuranceInfo: z.object({
    provider: z.string().max(100).optional(),
    policyNumber: z.string().max(100).optional(),
    expirationDate: z.string().datetime().optional(),
  }).optional(),
  agreementAccepted: z.boolean().refine(val => val === true, "Agreement must be accepted"),
  // Additional BYOV-specific fields
}).strict();

// Role permissions insert schema
export const insertRolePermissionsSchema = createInsertSchema(rolePermissions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Role permissions validation schema for the permissions object
export const rolePermissionSettingsSchema = z.object({
  homePage: z.boolean(),
  sidebar: z.object({
    enabled: z.boolean(),
    dashboards: z.object({
      enabled: z.boolean(),
      dashboard: z.boolean(),
      vehicleAssignmentDash: z.boolean(),
      operationsDash: z.boolean(),
      rentalReductionDash: z.boolean(),
    }),
    queues: z.object({
      enabled: z.boolean(),
      queueManagement: z.boolean(),
    }),
    management: z.boolean(),
    activities: z.boolean(),
    account: z.boolean(),
    helpAndTutorial: z.boolean(),
  }),
});

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type RolePermission = typeof rolePermissions.$inferSelect;
export type InsertRolePermission = z.infer<typeof insertRolePermissionsSchema>;
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

export interface AutomationTaskEntry {
  status: 'completed' | 'processing' | 'actionRequired';
  source?: string;
  updatedAt?: string;
}

export interface OutreachEvent {
  channel: 'email' | 'sms';
  templateName: string;
  lane: string;
  status: 'sent' | 'simulated' | 'blocked' | 'failed';
  communicationLogId?: string;
  sentAt: string;
  sentBy?: string;
  error?: string;
}

export interface AutomationDetail {
  lane?: string;
  automatedTasks?: Record<string, AutomationTaskEntry>;
  outreach?: OutreachEvent[];
  manualFlags?: unknown[];
  page_visited_at?: string;
}

export type StorageSpot = typeof storageSpots.$inferSelect;
export type InsertStorageSpot = z.infer<typeof insertStorageSpotSchema>;
export type Template = typeof templates.$inferSelect;
export type InsertTemplate = z.infer<typeof insertTemplateSchema>;
export type InsertTemplateWithId = z.infer<typeof insertTemplateWithIdSchema>;
export type Session = typeof sessions.$inferSelect;
export type InsertSession = z.infer<typeof insertSessionSchema>;
export type TermedTech = typeof termedTechs.$inferSelect;
export type InsertTermedTech = z.infer<typeof insertTermedTechSchema>;
export type AllTech = typeof allTechs.$inferSelect;
export type InsertAllTech = z.infer<typeof insertAllTechSchema>;
export type SyncLog = typeof syncLogs.$inferSelect;
export type InsertSyncLog = z.infer<typeof insertSyncLogSchema>;
export type TruckInventory = typeof truckInventory.$inferSelect;
export type InsertTruckInventory = z.infer<typeof insertTruckInventorySchema>;
export type TechVehicleAssignment = typeof techVehicleAssignments.$inferSelect;
export type InsertTechVehicleAssignment = z.infer<typeof insertTechVehicleAssignmentSchema>;
export type TechVehicleAssignmentHistory = typeof techVehicleAssignmentHistory.$inferSelect;
export type InsertTechVehicleAssignmentHistory = z.infer<typeof insertTechVehicleAssignmentHistorySchema>;
export type TpmsCachedAssignment = typeof tpmsCachedAssignments.$inferSelect;
export type InsertTpmsCachedAssignment = z.infer<typeof insertTpmsCachedAssignmentSchema>;
export type OnboardingHire = typeof onboardingHires.$inferSelect;
export type InsertOnboardingHire = z.infer<typeof insertOnboardingHireSchema>;

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
export type AnonymousVehicleAssignmentPayload = z.infer<typeof anonymousVehicleAssignmentSchema>;
export type AnonymousOnboardingPayload = z.infer<typeof anonymousOnboardingSchema>;
export type AnonymousOffboardingPayload = z.infer<typeof anonymousOffboardingSchema>;
export type AnonymousByovEnrollmentPayload = z.infer<typeof anonymousByovEnrollmentSchema>;

// Work Module Template Schema and Types
// Link schema for multiple links per step/substep
export const templateLinkSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  url: z.string().url()
});

export type TemplateLink = z.infer<typeof templateLinkSchema>;

export const workTemplateSubstepSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  required: z.boolean().default(true),
  completed: z.boolean().default(false),
  notes: z.string().optional(),
  validationRule: z.string().optional(), // Regex or validation expression
  conditionalLogic: z.object({
    dependsOn: z.string().optional(), // ID of step/substep this depends on
    condition: z.enum(["equals", "not_equals", "contains", "completed"]).optional(),
    value: z.string().optional()
  }).optional(),
  linkText: z.string().optional(), // Legacy: single link text (use links[] instead)
  linkUrl: z.string().url().optional(), // Legacy: single link URL (use links[] instead)
  links: z.array(templateLinkSchema).optional() // Multiple links per substep
});

export const workTemplateStepSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  required: z.boolean().default(true),
  completed: z.boolean().default(false),
  notes: z.string().optional(),
  estimatedTime: z.number().optional(), // In minutes
  category: z.enum([
    "verification", 
    "documentation", 
    "system_action", 
    "communication", 
    "inspection", 
    "approval",
    "assessment",
    "coordination",
    "vehicle_management",
    "vehicle_processing",
    "equipment",
    "planning",
    "inventory_processing",
    "reconciliation",
    "operational_stop",
    "operational_setup"
  ]).optional(),
  substeps: z.array(workTemplateSubstepSchema).optional(),
  validationRule: z.string().optional(),
  conditionalLogic: z.object({
    dependsOn: z.string().optional(),
    condition: z.enum(["equals", "not_equals", "contains", "completed"]).optional(),
    value: z.string().optional()
  }).optional(),
  attachmentRequired: z.boolean().default(false),
  attachmentTypes: z.array(z.string()).optional(), // ["image", "document", "signature"]
  linkText: z.string().optional(), // Legacy: single link text (use links[] instead)
  linkUrl: z.string().url().optional(), // Legacy: single link URL (use links[] instead)
  links: z.array(templateLinkSchema).optional() // Multiple links per step
});

export const workTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  department: z.enum(["FLEET", "INVENTORY", "ASSETS", "NTAO"]), // NTAO = National Truck Assortment
  workflowType: z.string().min(1), // Maps to queueItem workflowType
  version: z.string().min(1),
  description: z.string().optional(),
  estimatedDuration: z.number().optional(), // Total estimated time in minutes
  difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
  requiredRole: z.enum(["field", "agent", "developer"]).default("field"),
  steps: z.array(workTemplateStepSchema),
  finalDisposition: z.object({
    required: z.boolean().default(true),
    options: z.array(z.object({
      value: z.string(),
      label: z.string(),
      requiresApproval: z.boolean().default(false)
    })).optional()
  }).optional(),
  metadata: z.object({
    createdAt: z.string().datetime().optional(),
    updatedAt: z.string().datetime().optional(),
    createdBy: z.string().optional(),
    tags: z.array(z.string()).optional(),
    isActive: z.boolean().default(true)
  }).optional()
});

// Work Template Progress Schema for tracking completion state
export const workTemplateProgressSchema = z.object({
  templateId: z.string().min(1),
  queueItemId: z.string().min(1),
  workerId: z.string().min(1),
  startedAt: z.string().datetime(),
  lastUpdatedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  steps: z.array(z.object({
    id: z.string(),
    completed: z.boolean(),
    completedAt: z.string().datetime().optional(),
    notes: z.string().optional(),
    substeps: z.array(z.object({
      id: z.string(),
      completed: z.boolean(),
      completedAt: z.string().datetime().optional(),
      notes: z.string().optional()
    })).optional()
  })),
  overallProgress: z.number().min(0).max(100), // Percentage complete
  estimatedTimeRemaining: z.number().optional(), // In minutes
  finalNotes: z.string().optional()
});

// Enhanced SaveProgress Schema to include template progress
export const enhancedSaveProgressSchema = saveProgressSchema.extend({
  templateProgress: workTemplateProgressSchema.optional(),
  checklistState: z.record(z.boolean()).optional() // Key-value pairs for step completion
});

// Enhanced CompleteQueueItem Schema to include template data
export const enhancedCompleteQueueItemSchema = completeQueueItemSchema.extend({
  templateProgress: workTemplateProgressSchema.optional(),
  finalChecklistState: z.record(z.boolean()).optional(),
  templateId: z.string().optional()
});

// Template Management Schemas
export const templateFilterSchema = z.object({
  department: z.enum(["FLEET", "INVENTORY", "ASSETS", "NTAO"]).optional(), // NTAO = National Truck Assortment
  workflowType: z.string().optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  requiredRole: z.enum(["field", "agent", "developer"]).optional(),
  isActive: z.boolean().optional()
});

export const templateSearchSchema = z.object({
  query: z.string().min(1),
  filters: templateFilterSchema.optional(),
  limit: z.number().min(1).max(100).default(20)
});

// Export TypeScript Types
export type WorkTemplateSubstep = z.infer<typeof workTemplateSubstepSchema>;
export type WorkTemplateStep = z.infer<typeof workTemplateStepSchema>;
export type WorkTemplate = z.infer<typeof workTemplateSchema>;
export type WorkTemplateProgress = z.infer<typeof workTemplateProgressSchema>;
export type EnhancedSaveProgressPayload = z.infer<typeof enhancedSaveProgressSchema>;
export type EnhancedCompleteQueueItemPayload = z.infer<typeof enhancedCompleteQueueItemSchema>;
export type TemplateFilter = z.infer<typeof templateFilterSchema>;
export type TemplateSearch = z.infer<typeof templateSearchSchema>;

// Template Registry Type for mapping workflow types to templates
export type TemplateRegistry = {
  [workflowType: string]: {
    [department: string]: string[]; // Array of template IDs
  };
};

// Template Loading Result Type
export type TemplateLoadResult = {
  template: WorkTemplate | null;
  error?: string;
  warning?: string; // Warning message for fallback templates
  suggestions?: string[]; // Alternative template IDs if exact match not found
};

// ============================================
// Field Mapping Tables for Visual Data Mapping
// ============================================

// Integration Data Sources - represents a data source (Snowflake table, Holman API, internal DB table)
export const integrationDataSources = pgTable("integration_data_sources", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  displayName: text("display_name").notNull(),
  sourceType: text("source_type").notNull(), // 'snowflake', 'holman', 'internal', 'page_object'
  connectionInfo: text("connection_info"), // JSON with connection details (table name, API endpoint, etc.)
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  metadata: text("metadata"), // JSON for additional properties
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Data Source Fields - individual fields within a data source
export const dataSourceFields = pgTable("data_source_fields", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sourceId: varchar("source_id").notNull().references(() => integrationDataSources.id, { onDelete: 'cascade' }),
  fieldName: text("field_name").notNull(),
  displayName: text("display_name").notNull(),
  fieldPath: text("field_path"), // JSON path or SQL column path
  dataType: text("data_type").notNull(), // 'string', 'number', 'boolean', 'date', 'object', 'array'
  isPrimaryKey: boolean("is_primary_key").notNull().default(false),
  isForeignKey: boolean("is_foreign_key").notNull().default(false),
  isRequired: boolean("is_required").notNull().default(false),
  sampleValue: text("sample_value"),
  description: text("description"),
  metadata: text("metadata"), // JSON for additional properties
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Mapping Sets - a collection of field mappings (like a mapping project)
export const mappingSets = pgTable("mapping_sets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  context: text("context"), // 'offboarding', 'onboarding', 'sync', etc.
  createdBy: varchar("created_by").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  metadata: text("metadata"), // JSON for canvas state, zoom, pan, etc.
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Mapping Nodes - visual positions of data sources on the canvas
export const mappingNodes = pgTable("mapping_nodes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  mappingSetId: varchar("mapping_set_id").notNull().references(() => mappingSets.id, { onDelete: 'cascade' }),
  sourceId: varchar("source_id").notNull().references(() => integrationDataSources.id, { onDelete: 'cascade' }),
  positionX: decimal("position_x").notNull().default("0"),
  positionY: decimal("position_y").notNull().default("0"),
  isExpanded: boolean("is_expanded").notNull().default(true),
  metadata: text("metadata"), // JSON for node styling, etc.
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Field Mappings - connections between fields
export const fieldMappings = pgTable("field_mappings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  mappingSetId: varchar("mapping_set_id").notNull().references(() => mappingSets.id, { onDelete: 'cascade' }),
  sourceFieldId: varchar("source_field_id").notNull().references(() => dataSourceFields.id, { onDelete: 'cascade' }),
  targetFieldId: varchar("target_field_id").notNull().references(() => dataSourceFields.id, { onDelete: 'cascade' }),
  direction: text("direction").notNull().default("push"), // 'push', 'pull', 'bidirectional'
  transformation: text("transformation"), // JSON with transformation rules
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  metadata: text("metadata"), // JSON for edge styling, etc.
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ============================================
// Field Mapping Zod Schemas
// ============================================

export const insertIntegrationDataSourceSchema = createInsertSchema(integrationDataSources).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});
export const insertDataSourceFieldSchema = createInsertSchema(dataSourceFields).omit({ 
  id: true, 
  createdAt: true 
});
export const insertMappingSetSchema = createInsertSchema(mappingSets).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});
export const insertMappingNodeSchema = createInsertSchema(mappingNodes).omit({ 
  id: true, 
  createdAt: true 
});
export const insertFieldMappingSchema = createInsertSchema(fieldMappings).omit({ 
  id: true, 
  createdAt: true 
});

// Logical Entities - real-world concepts (Vehicle, Technician, etc.) backed by
// one or more physical data sources. Live alongside the physical lineage and
// are NOT touched by "Refresh from code".
export const logicalEntities = pgTable("logical_entities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  displayName: text("display_name").notNull(),
  description: text("description"),
  kind: text("kind").notNull().default("domain"), // 'domain' | 'reference' | 'workflow'
  metadata: text("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Join table: which physical data sources back a logical entity, and what role
// each plays ('canonical' | 'cache' | 'extension' | 'snapshot').
export const entityTableMembers = pgTable("entity_table_members", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  entityId: varchar("entity_id").notNull().references(() => logicalEntities.id, { onDelete: 'cascade' }),
  dataSourceId: varchar("data_source_id").notNull().references(() => integrationDataSources.id, { onDelete: 'cascade' }),
  role: text("role").notNull().default("cache"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertLogicalEntitySchema = createInsertSchema(logicalEntities).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertEntityTableMemberSchema = createInsertSchema(entityTableMembers).omit({
  id: true,
  createdAt: true,
});

export type LogicalEntity = typeof logicalEntities.$inferSelect;
export type InsertLogicalEntity = z.infer<typeof insertLogicalEntitySchema>;
export type EntityTableMember = typeof entityTableMembers.$inferSelect;
export type InsertEntityTableMember = z.infer<typeof insertEntityTableMemberSchema>;

// Field Mapping Types
export type IntegrationDataSource = typeof integrationDataSources.$inferSelect;
export type InsertIntegrationDataSource = z.infer<typeof insertIntegrationDataSourceSchema>;
export type DataSourceField = typeof dataSourceFields.$inferSelect;
export type InsertDataSourceField = z.infer<typeof insertDataSourceFieldSchema>;
export type MappingSet = typeof mappingSets.$inferSelect;
export type InsertMappingSet = z.infer<typeof insertMappingSetSchema>;
export type MappingNode = typeof mappingNodes.$inferSelect;
export type InsertMappingNode = z.infer<typeof insertMappingNodeSchema>;
export type FieldMapping = typeof fieldMappings.$inferSelect;
export type InsertFieldMapping = z.infer<typeof insertFieldMappingSchema>;

// ============================================
// Vehicle Assignment Aggregated DTOs
// ============================================

// Aggregated view combining data from Snowflake, TPMS, and Holman
export const aggregatedVehicleAssignmentSchema = z.object({
  // Core assignment data (from our database)
  id: z.string().optional(),
  assignmentStatus: z.enum(["active", "inactive", "pending"]).default("active"),
  lastTpmsSync: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
  
  // Technician info (from Snowflake all_techs table)
  techRacfid: z.string(), // Enterprise ID / LDAP ID
  employeeId: z.string().nullable().optional(),
  techName: z.string().nullable().optional(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  districtNo: z.string().nullable().optional(),
  managerName: z.string().nullable().optional(),
  managerEnterpriseId: z.string().nullable().optional(),
  employmentStatus: z.string().nullable().optional(),
  terminationDate: z.string().nullable().optional(),
  
  // TPMS data (master for current truck assignment and contact info)
  truckNo: z.string().nullable().optional(),
  techId: z.string().nullable().optional(), // TPMS internal tech ID
  contactNo: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  tpmsAddress: z.object({
    addressLine1: z.string().nullable().optional(),
    addressLine2: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    state: z.string().nullable().optional(),
    zipCode: z.string().nullable().optional(),
  }).nullable().optional(),
  
  // Holman vehicle data (master for vehicle details)
  holmanVehicleNumber: z.string().nullable().optional(),
  vehicleVin: z.string().nullable().optional(),
  vehicleYear: z.string().nullable().optional(),
  vehicleMake: z.string().nullable().optional(),
  vehicleModel: z.string().nullable().optional(),
  vehicleStatus: z.string().nullable().optional(),
  garagingAddress: z.string().nullable().optional(),
  
  // Data source flags (which sources contributed data)
  dataSources: z.object({
    snowflake: z.boolean().default(false),
    tpms: z.boolean().default(false),
    holman: z.boolean().default(false),
  }).optional(),
});

export type AggregatedVehicleAssignment = z.infer<typeof aggregatedVehicleAssignmentSchema>;

// Schema for creating/updating vehicle assignments
export const upsertVehicleAssignmentSchema = z.object({
  techRacfid: z.string().min(1, "Enterprise ID is required"),
  truckNo: z.string().nullable().optional(),
  assignmentStatus: z.enum(["active", "inactive", "pending"]).default("active"),
  notes: z.string().nullable().optional(),
  changedBy: z.string().nullable().optional(),
  changeSource: z.enum(["manual", "tpms_sync", "offboarding"]).default("manual"),
});

export type UpsertVehicleAssignment = z.infer<typeof upsertVehicleAssignmentSchema>;

// Query filter for vehicle assignments
export const vehicleAssignmentFilterSchema = z.object({
  status: z.enum(["active", "inactive", "pending", "all"]).default("all"),
  districtNo: z.string().nullable().optional(),
  hasVehicle: z.boolean().nullable().optional(),
  searchQuery: z.string().nullable().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
});

export type VehicleAssignmentFilter = z.infer<typeof vehicleAssignmentFilterSchema>;

// ============================================
// Holman Vehicle Cache (for offline resilience)
// ============================================

export const holmanVehiclesCache = pgTable("holman_vehicles_cache", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  holmanVehicleNumber: text("holman_vehicle_number").notNull().unique(),
  statusCode: integer("status_code"), // 1 = active
  vin: text("vin"),
  licensePlate: text("license_plate"),
  licenseState: text("license_state"),
  makeName: text("make_name"),
  modelName: text("model_name"),
  modelYear: integer("model_year"),
  color: text("color"),
  fuelType: text("fuel_type"),
  engineSize: text("engine_size"),
  driverName: text("driver_name"),
  driverEmail: text("driver_email"),
  driverPhone: text("driver_phone"),
  city: text("city"),
  state: text("state"),
  region: text("region"), // clientData3 from Holman (e.g., "890")
  division: text("division"), // prefix/division from Holman (e.g., "01")
  district: text("district"),
  inServiceDate: text("in_service_date"),
  outOfServiceDate: text("out_of_service_date"),
  odometer: integer("odometer"),
  odometerDate: text("odometer_date"),
  odometerSource: text("odometer_source"),
  regRenewalDate: text("reg_renewal_date"),
  branding: text("branding"),
  interior: text("interior"),
  tuneStatus: text("tune_status"),
  holmanTechAssigned: text("holman_tech_assigned"), // clientData2 from Holman - enterprise ID of assigned tech
  holmanTechName: text("holman_tech_name"), // Tech name from Holman (firstName + lastName)
  tpmsAssignedTechId: text("tpms_assigned_tech_id"), // Cached TPMS tech enterprise ID
  tpmsAssignedTechName: text("tpms_assigned_tech_name"), // Cached TPMS tech name
  tpmsLastSyncAt: timestamp("tpms_last_sync_at"), // When TPMS data was last refreshed
  dataSource: text("data_source").default("holman"), // holman, tpms, manual
  isActive: boolean("is_active").default(true),
  rawData: jsonb("raw_data"), // Store original API response
  lastHolmanSyncAt: timestamp("last_holman_sync_at"),
  lastLocalUpdateAt: timestamp("last_local_update_at"),
  lastChangeDate: timestamp("last_change_date"), // Holman's lastChangeDate field for this vehicle
  lastChangeRecordId: text("last_change_record_id"), // Holman's lastChangeRecordId for tracking changes
  holmanVehicleRef: varchar("holman_vehicle_ref", { length: 10 }),
  tpmsVehicleRef: varchar("tpms_vehicle_ref", { length: 10 }),
  snowflakeVehicleRef: varchar("snowflake_vehicle_ref", { length: 20 }),
  vehicleNumberDisplay: varchar("vehicle_number_display", { length: 10 }),
  holmanAssignedStatusCd: text("holman_assigned_status_cd"), // A, U, H, B, D, L, I, M, Q, V, T, O, F, W
  byovVinMissing: boolean("byov_vin_missing").default(false),
  operationLockAt: timestamp("operation_lock_at"), // nullable — set when a fleet operation is in progress
  operationLockedBy: text("operation_locked_by"), // nullable — identifier of the lock holder
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  statusIdx: index("holman_cache_status_idx").on(table.statusCode),
  activeIdx: index("holman_cache_active_idx").on(table.isActive),
  lastChangeRecordIdIdx: index("holman_cache_last_change_record_id_idx").on(table.lastChangeRecordId),
}));

export const insertHolmanVehicleCacheSchema = createInsertSchema(holmanVehiclesCache).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type HolmanVehicleCache = typeof holmanVehiclesCache.$inferSelect;
export type InsertHolmanVehicleCache = z.infer<typeof insertHolmanVehicleCacheSchema>;

// Holman Sync State - tracks incremental sync position for efficient change-only fetching
export const holmanSyncState = pgTable("holman_sync_state", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  syncType: text("sync_type").notNull().unique(), // 'vehicles', 'contacts', 'maintenance'
  lastChangeRecordId: text("last_change_record_id"), // The lastChangeRecordId from Holman's pageInfo
  lastChangeDate: timestamp("last_change_date"), // The most recent lastChangeDate seen
  lastFullSyncAt: timestamp("last_full_sync_at"), // When we last did a full sync (no filter)
  lastIncrementalSyncAt: timestamp("last_incremental_sync_at"), // When we last did an incremental sync
  totalRecordsSynced: integer("total_records_synced").default(0),
  incrementalRecordsSynced: integer("incremental_records_synced").default(0), // Records from last incremental
  status: text("status").notNull().default("idle"), // idle, syncing, failed
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertHolmanSyncStateSchema = createInsertSchema(holmanSyncState).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type HolmanSyncState = typeof holmanSyncState.$inferSelect;
export type InsertHolmanSyncState = z.infer<typeof insertHolmanSyncStateSchema>;

// Change log for offline updates that need to sync back to Holman
export const vehicleChangeLog = pgTable("vehicle_change_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  holmanVehicleNumber: text("holman_vehicle_number").notNull(),
  changeType: text("change_type").notNull(), // create, update, delete
  payload: jsonb("payload").notNull(), // The change data to send to Holman
  userId: text("user_id"), // Who made the change
  status: text("status").notNull().default("pending"), // pending, applied, failed, verified
  attemptCount: integer("attempt_count").default(0),
  lastAttemptAt: timestamp("last_attempt_at"),
  appliedAt: timestamp("applied_at"),
  errorMessage: text("error_message"),
  preChangeRecordId: text("pre_change_record_id"), // lastChangeRecordId before our POST
  postChangeRecordId: text("post_change_record_id"), // lastChangeRecordId after verification
  holmanProcessed: boolean("holman_processed").default(false), // True when Holman shows our change
  verifiedAt: timestamp("verified_at"), // When we confirmed Holman processed the change
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  statusIdx: index("change_log_status_idx").on(table.status),
  vehicleIdx: index("change_log_vehicle_idx").on(table.holmanVehicleNumber),
  holmanProcessedIdx: index("change_log_holman_processed_idx").on(table.holmanProcessed),
}));

export const insertVehicleChangeLogSchema = createInsertSchema(vehicleChangeLog).omit({
  id: true,
  createdAt: true,
  attemptCount: true,
  lastAttemptAt: true,
  appliedAt: true,
  errorMessage: true,
  postChangeRecordId: true,
  holmanProcessed: true,
  verifiedAt: true,
});

export type VehicleChangeLog = typeof vehicleChangeLog.$inferSelect;
export type InsertVehicleChangeLog = z.infer<typeof insertVehicleChangeLogSchema>;

// Holman sync status metadata
export const holmanSyncStatusSchema = z.object({
  dataMode: z.enum(["live", "cached", "empty"]),
  isStale: z.boolean(),
  lastSyncAt: z.string().datetime().nullable(),
  pendingChangeCount: z.number(),
  totalVehicles: z.number(),
  apiAvailable: z.boolean(),
  errorMessage: z.string().nullable().optional(),
});

export type HolmanSyncStatus = z.infer<typeof holmanSyncStatusSchema>;

// Holman Submission Tracking - tracks async submission status tokens
export const holmanSubmissions = pgTable("holman_submissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  holmanVehicleNumber: text("holman_vehicle_number").notNull(),
  submissionId: text("submission_id"), // Token from Holman API response
  correlationId: text("correlation_id"), // x-correlation-id used in request
  action: text("action").notNull(), // 'assign' or 'unassign'
  enterpriseId: text("enterprise_id"), // Tech ID if assigning
  status: text("status").notNull().default("pending"), // pending, processing, completed, failed
  payload: jsonb("payload"), // The request payload sent
  response: jsonb("response"), // The response received
  lastCheckedAt: timestamp("last_checked_at"),
  completedAt: timestamp("completed_at"),
  errorMessage: text("error_message"),
  lastObservedTech: text("last_observed_tech"), // Last clientData2 value seen in Holman fleet sync
  createdAt: timestamp("created_at").defaultNow().notNull(),
  createdBy: text("created_by"), // User who initiated
}, (table) => ({
  vehicleIdx: index("submissions_vehicle_idx").on(table.holmanVehicleNumber),
  statusIdx: index("submissions_status_idx").on(table.status),
}));

export const insertHolmanSubmissionSchema = createInsertSchema(holmanSubmissions).omit({
  id: true,
  createdAt: true,
  lastCheckedAt: true,
  completedAt: true,
});

export type HolmanSubmission = typeof holmanSubmissions.$inferSelect;
export type InsertHolmanSubmission = z.infer<typeof insertHolmanSubmissionSchema>;

// TPMS Sync State - tracks initial sync progress for cache-first strategy
export const tpmsSyncState = pgTable("tpms_sync_state", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  initialSyncComplete: boolean("initial_sync_complete").default(false).notNull(),
  initialSyncStartedAt: timestamp("initial_sync_started_at"),
  initialSyncCompletedAt: timestamp("initial_sync_completed_at"),
  totalVehiclesToSync: integer("total_vehicles_to_sync").default(0),
  vehiclesSynced: integer("vehicles_synced").default(0),
  vehiclesWithAssignments: integer("vehicles_with_assignments").default(0),
  vehiclesWithoutAssignments: integer("vehicles_without_assignments").default(0),
  lastSyncAt: timestamp("last_sync_at"),
  status: text("status").notNull().default("idle"), // idle, syncing, completed, failed
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertTpmsSyncStateSchema = createInsertSchema(tpmsSyncState).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type TpmsSyncState = typeof tpmsSyncState.$inferSelect;
export type InsertTpmsSyncState = z.infer<typeof insertTpmsSyncStateSchema>;

// ===============================
// Rental Snapshots - Historical tracking for rental reduction dashboard
// ===============================

export const rentalSnapshots = pgTable("rental_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  snapshotDate: date("snapshot_date").notNull().unique(), // Unique constraint: one snapshot per day
  grandTotal: integer("grand_total").notNull(),
  totalOver14Days: integer("total_over_14_days").notNull(),
  enterpriseTotal: integer("enterprise_total").notNull(),
  nonEnterpriseTotal: integer("non_enterprise_total").notNull(),
  bucket28Plus: integer("bucket_28_plus").notNull(),
  bucket21To27: integer("bucket_21_to_27").notNull(),
  bucket14To20: integer("bucket_14_to_20").notNull(),
  bucketUnder14: integer("bucket_under_14").notNull(),
  vendorBreakdown: jsonb("vendor_breakdown"), // Array of vendor stats
  rentalDetails: jsonb("rental_details"), // Full rental list for that day
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => {
  return {
    dateIdx: index("rental_snapshots_date_idx").on(table.snapshotDate),
  };
});

export const insertRentalSnapshotSchema = createInsertSchema(rentalSnapshots).omit({
  id: true,
  createdAt: true,
});

export type RentalSnapshot = typeof rentalSnapshots.$inferSelect;
export type InsertRentalSnapshot = z.infer<typeof insertRentalSnapshotSchema>;

// ===============================
// Rental Reduction Dashboard Types
// ===============================

// Snowflake VW_RENTAL_LIST data structure
export interface RentalListItem {
  truckNumber: string;
  rentalStartDate: string | null;
  rentalDays: string; // "28 plus days", "21 plus days", "14 plus days", "Less than 14 days"
  rentalUnderName: string | null;
  rentalTechEnterpriseId: string | null;
  truckAssignedToInTpms: string | null;
  truckAssignedToEnterpriseId: string | null;
  employmentServiceDate: string | null;
  isEnterprise: boolean;
  daysOpen: number;
}

// Aging bucket categories for rental reporting
export type RentalAgingBucket = "28 plus days" | "21 plus days" | "14 plus days" | "Less than 14 days";

// Summary statistics by aging bucket
export interface RentalAgingSummary {
  bucket: RentalAgingBucket;
  rentalsOpen: number;
  percentOfTotal: number;
  avgDaysOpen: number;
}

// Running progress snapshot for a specific date
export interface RentalProgressSnapshot {
  date: string;
  buckets: {
    bucket: RentalAgingBucket;
    rentalsOpen: number;
    percentOfTotal: number;
    changeMtd: number;
  }[];
  grandTotal: number;
  totalOver14Days: number;
  percentOver14Days: number;
}

// Vendor breakdown statistics
export interface RentalVendorBreakdown {
  vendor: string;
  count: number;
  percentOfTotal: number;
  avgDaysOpen: number;
  over14Days: number;
}

// Complete rental reduction dashboard data
export interface RentalReductionDashboardData {
  currentSnapshot: {
    date: string;
    summary: RentalAgingSummary[];
    grandTotal: number;
    totalOver14Days: number;
    percentOver14Days: number;
    enterpriseTotal: number;
    nonEnterpriseTotal: number;
    vendorBreakdown: RentalVendorBreakdown[];
  };
  progressHistory: RentalProgressSnapshot[];
  rentalDetails: RentalListItem[];
  lastUpdated: string;
  isLiveData?: boolean; // True when data comes from Snowflake, false for sample data
}

// ===============================
// Communication Hub
// ===============================

// Communication template modes
export type CommunicationMode = 'simulated' | 'whitelisted' | 'live';
export type CommunicationType = 'email' | 'sms';

// Communication templates table
export const communicationTemplates = pgTable("communication_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  description: text("description"),
  type: text("type").notNull(), // 'email' | 'sms'
  mode: text("mode").notNull().default("simulated"), // 'simulated' | 'whitelisted' | 'live'
  subject: text("subject"), // For email only
  htmlContent: text("html_content"), // For email only
  textContent: text("text_content").notNull(), // Plain text version (required for SMS, optional for email)
  variables: text("variables").array(), // List of variable placeholders like ['firstName', 'lastDay', 'ldapId']
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  createdBy: varchar("created_by").references(() => users.id),
  updatedBy: varchar("updated_by").references(() => users.id),
});

export const insertCommunicationTemplateSchema = createInsertSchema(communicationTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCommunicationTemplate = z.infer<typeof insertCommunicationTemplateSchema>;
export type CommunicationTemplate = typeof communicationTemplates.$inferSelect;

// Communication whitelist table
export const communicationWhitelist = pgTable("communication_whitelist", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  type: text("type").notNull(), // 'email' | 'phone'
  value: text("value").notNull(), // email address or phone number
  description: text("description"), // Optional note about why this is whitelisted
  addedBy: varchar("added_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => {
  return {
    typeValueIdx: index("whitelist_type_value_idx").on(table.type, table.value),
  };
});

export const insertCommunicationWhitelistSchema = createInsertSchema(communicationWhitelist).omit({
  id: true,
  createdAt: true,
});
export type InsertCommunicationWhitelist = z.infer<typeof insertCommunicationWhitelistSchema>;
export type CommunicationWhitelistEntry = typeof communicationWhitelist.$inferSelect;

// Communication logs table - stores all sent/simulated/blocked messages
export const communicationLogs = pgTable("communication_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  templateId: varchar("template_id").references(() => communicationTemplates.id),
  templateName: text("template_name").notNull(), // Denormalized for easier querying
  type: text("type").notNull(), // 'email' | 'sms'
  mode: text("mode").notNull(), // 'simulated' | 'whitelisted' | 'live'
  status: text("status").notNull(), // 'sent' | 'simulated' | 'blocked' | 'failed'
  intendedRecipient: text("intended_recipient").notNull(), // Original recipient
  actualRecipient: text("actual_recipient"), // Actual recipient (may differ in test mode)
  subject: text("subject"), // For emails
  contentPreview: text("content_preview"), // First 500 chars of rendered content
  variables: jsonb("variables"), // The variables used to render the template
  errorMessage: text("error_message"), // If failed, why
  metadata: jsonb("metadata"), // Additional context (queue item ID, etc.)
  sentAt: timestamp("sent_at").defaultNow().notNull(),
  sentBy: varchar("sent_by").references(() => users.id), // System or user who triggered
});

export const insertCommunicationLogSchema = createInsertSchema(communicationLogs).omit({
  id: true,
  sentAt: true,
});
export type InsertCommunicationLog = z.infer<typeof insertCommunicationLogSchema>;
export type CommunicationLog = typeof communicationLogs.$inferSelect;

// ===============================
// Rental Operations
// ===============================

// Qualification log — one record per source table per run
export const rentalQualificationLog = pgTable("rental_qualification_log", {
  id: serial("id").primaryKey(),
  sourceTable: text("source_table").notNull(), // "rental_open" | "rental_closed" | "rental_ticket_detail"
  runAt: timestamp("run_at").defaultNow().notNull(),
  totalRows: integer("total_rows").notNull().default(0),
  passRows: integer("pass_rows").notNull().default(0),
  warnRows: integer("warn_rows").notNull().default(0),
  failRows: integer("fail_rows").notNull().default(0),
  nullRateJson: jsonb("null_rate_json"), // { field: pct }
  duplicateCount: integer("duplicate_count").notNull().default(0),
  unmatchedVehicleCount: integer("unmatched_vehicle_count").notNull().default(0),
  invalidDateCount: integer("invalid_date_count").notNull().default(0),
  mismatchedTechCount: integer("mismatched_tech_count").notNull().default(0),
  issuesJson: jsonb("issues_json"), // [{ row, field, issue, severity }]
  triggeredBy: text("triggered_by"),
});

export const insertRentalQualificationLogSchema = createInsertSchema(rentalQualificationLog).omit({
  id: true,
  runAt: true,
});
export type RentalQualificationLog = typeof rentalQualificationLog.$inferSelect;
export type InsertRentalQualificationLog = z.infer<typeof insertRentalQualificationLogSchema>;

// ===============================
// Holman PO Cache
// ===============================

export const holmanPoCache = pgTable("holman_po_cache", {
  id: serial("id").primaryKey(),
  poNumber: text("po_number").notNull().unique(),
  vehicleNumber: text("vehicle_number"),
  vin: text("vin"),
  poType: text("po_type"), // "maintenance" | "rental" | "other"
  poStatus: text("po_status"),
  poDate: date("po_date"),
  amount: decimal("amount", { precision: 12, scale: 2 }),
  description: text("description"),
  vendor: text("vendor"),
  rawData: jsonb("raw_data"),
  lastSyncedAt: timestamp("last_synced_at").defaultNow().notNull(),
}, (table) => {
  return {
    vehicleIdx: index("holman_po_vehicle_idx").on(table.vehicleNumber),
    poNumberIdx: index("holman_po_number_idx").on(table.poNumber),
  };
});

export const insertHolmanPoCacheSchema = createInsertSchema(holmanPoCache).omit({
  id: true,
  lastSyncedAt: true,
});
export type HolmanPoCache = typeof holmanPoCache.$inferSelect;
export type InsertHolmanPoCache = z.infer<typeof insertHolmanPoCacheSchema>;

// ===============================
// Fleet Operation Log
// ===============================

export const fleetOperationLog = pgTable("fleet_operation_log", {
  id: serial("id").primaryKey(),
  operationType: text("operation_type").notNull(), // "assign" | "unassign" | "update_address"
  truckNumber: text("truck_number"),
  fromLdap: text("from_ldap"),
  toLdap: text("to_ldap"),
  toTechName: text("to_tech_name"),
  districtNo: text("district_no"),
  tpmsStatus: text("tpms_status").default("pending"), // "pending" | "success" | "failed" | "skipped"
  tpmsMessage: text("tpms_message"),
  holmanStatus: text("holman_status").default("pending"),
  holmanMessage: text("holman_message"),
  amsStatus: text("ams_status").default("pending"),
  amsMessage: text("ams_message"),
  // WMS leg added for the tier-3 reconciliation backstop. Defaults to "skipped"
  // because existing live assign/unassign paths do not touch WMS until it is
  // explicitly wired into the orchestrator (T005). The orchestrator sets this
  // per-operation via the generic per-system result map.
  wmsStatus: text("wms_status").default("skipped"),
  wmsMessage: text("wms_message"),
  requestedBy: text("requested_by"),
  notes: text("notes"),
  source: text("source"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
}, (table) => {
  return {
    truckIdx: index("fleet_op_log_truck_idx").on(table.truckNumber),
    ldapIdx: index("fleet_op_log_ldap_idx").on(table.toLdap),
    createdIdx: index("fleet_op_log_created_idx").on(table.createdAt),
  };
});

export const insertFleetOperationLogSchema = createInsertSchema(fleetOperationLog).omit({
  id: true,
  createdAt: true,
});
export type FleetOperationLog = typeof fleetOperationLog.$inferSelect;
export type InsertFleetOperationLog = z.infer<typeof insertFleetOperationLogSchema>;

// ===============================
// TPMS Tech Profiles (local snapshot of TPMS technician data)
// ===============================

export const tpmsTechProfiles = pgTable("tpms_tech_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  techId: varchar("tech_id", { length: 20 }).notNull(),
  enterpriseId: varchar("enterprise_id", { length: 20 }).notNull().unique(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  districtNo: varchar("district_no", { length: 10 }),
  pdcNo: varchar("pdc_no", { length: 10 }),
  techManagerLdapId: varchar("tech_manager_ldap_id", { length: 20 }),
  techManagerName: text("tech_manager_name"),
  truckNo: varchar("truck_no", { length: 20 }),
  mobilePhone: varchar("mobile_phone", { length: 30 }),
  email: text("email"),
  shippingAddresses: jsonb("shipping_addresses").default([]),
  shippingSchedule: jsonb("shipping_schedule").default({}),
  deMinimis: boolean("de_minimis").default(false),
  extendedHolds: jsonb("extended_holds").default([]),
  techReplenishment: jsonb("tech_replenishment").default({}),
  rawResponse: text("raw_response"),
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
  lastTpmsUpdatedAt: timestamp("last_tpms_updated_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => {
  return {
    techIdIdx: index("tpms_tp_tech_id_idx").on(table.techId),
    enterpriseIdIdx: index("tpms_tp_enterprise_id_idx").on(table.enterpriseId),
    districtNoIdx: index("tpms_tp_district_no_idx").on(table.districtNo),
    truckNoIdx: index("tpms_tp_truck_no_idx").on(table.truckNo),
    lastTpmsUpdatedAtIdx: index("tpms_tp_last_updated_idx").on(table.lastTpmsUpdatedAt),
  };
});

export const insertTpmsTechProfileSchema = createInsertSchema(tpmsTechProfiles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  syncedAt: true,
});
export type TpmsTechProfile = typeof tpmsTechProfiles.$inferSelect;
export type InsertTpmsTechProfile = z.infer<typeof insertTpmsTechProfileSchema>;

// ===============================
// TPMS Last-Known Tech per Truck
// Persists the most recently seen tech profile for each truck number so the
// TruckDetail sidebar can keep showing it even after the truck drops off
// TPMS_EXTRACT (e.g., tech unassigned). Never deleted — only replaced when a
// different value comes in from a live TPMS query.
// ===============================

export const tpmsLastKnownTruckTech = pgTable("tpms_last_known_truck_tech", {
  truckNo: varchar("truck_no", { length: 20 }).primaryKey(),
  enterpriseId: varchar("enterprise_id", { length: 20 }),
  techId: varchar("tech_id", { length: 20 }),
  firstName: text("first_name"),
  lastName: text("last_name"),
  districtNo: varchar("district_no", { length: 10 }),
  mobilePhone: varchar("mobile_phone", { length: 30 }),
  email: text("email"),
  shippingAddresses: jsonb("shipping_addresses").default([]),
  lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type TpmsLastKnownTruckTech = typeof tpmsLastKnownTruckTech.$inferSelect;

// ===============================
// TPMS Change Log (CDC record of Nexus-originated writes)
// ===============================

export const tpmsChangeLog = pgTable("tpms_change_log", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 100 }).notNull(),
  username: text("username"),
  techId: varchar("tech_id", { length: 20 }).notNull(),
  enterpriseId: varchar("enterprise_id", { length: 20 }),
  fieldChanged: text("field_changed").notNull(),
  valueBefore: text("value_before"),
  valueAfter: text("value_after"),
  source: text("source").notNull().default("nexus-profile-edit"),
  confirmedAt: timestamp("confirmed_at"),
  confirmedByTpms: boolean("confirmed_by_tpms").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => {
  return {
    techIdIdx: index("tpms_cl_tech_id_idx").on(table.techId),
    enterpriseIdIdx: index("tpms_cl_enterprise_id_idx").on(table.enterpriseId),
    confirmedAtIdx: index("tpms_cl_confirmed_at_idx").on(table.confirmedAt),
    createdAtIdx: index("tpms_cl_created_at_idx").on(table.createdAt),
  };
});

export const insertTpmsChangeLogSchema = createInsertSchema(tpmsChangeLog).omit({
  id: true,
  createdAt: true,
  confirmedAt: true,
});
export type TpmsChangeLog = typeof tpmsChangeLog.$inferSelect;
export type InsertTpmsChangeLog = z.infer<typeof insertTpmsChangeLogSchema>;

// ===============================
// AMS Vehicles Cache - Lean cache tracking AMS tech assignment + status per VIN
// ===============================

export const amsVehiclesCache = pgTable("ams_vehicles_cache", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vin: text("vin").notNull().unique(),
  amsTruckStatusId: integer("ams_truck_status_id"),
  amsTruckStatusLabel: text("ams_truck_status_label"),
  amsAssignedLdap: text("ams_assigned_ldap"),
  lastAmsSyncAt: timestamp("last_ams_sync_at"),
  lastAmsError: text("last_ams_error"),
  rawResponse: jsonb("raw_response"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  vinIdx: index("ams_cache_vin_idx").on(table.vin),
  ldapIdx: index("ams_cache_ldap_idx").on(table.amsAssignedLdap),
}));

export const insertAmsvehiclesCacheSchema = createInsertSchema(amsVehiclesCache).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type AmsVehicleCache = typeof amsVehiclesCache.$inferSelect;
export type InsertAmsVehicleCache = z.infer<typeof insertAmsvehiclesCacheSchema>;

// ===============================
// External Watermark State - tracks TPMS and AMS poll watermarks for incremental external change detection
// ===============================

export const externalWatermarkState = pgTable("external_watermark_state", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  systemName: text("system_name").notNull().unique(),
  lastPollAt: timestamp("last_poll_at"),
  lastPollStatus: text("last_poll_status").default("idle"),
  lastErrorMessage: text("last_error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertExternalWatermarkStateSchema = createInsertSchema(externalWatermarkState).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type ExternalWatermarkState = typeof externalWatermarkState.$inferSelect;
export type InsertExternalWatermarkState = z.infer<typeof insertExternalWatermarkStateSchema>;

// ===============================
// Operation Events (granular per-system-call log with retry support)
// ===============================

export const operationEvents = pgTable("operation_events", {
  id: serial("id").primaryKey(),
  fleetOpLogId: integer("fleet_op_log_id"),
  queueItemId: text("queue_item_id"),
  operationType: text("operation_type"), // "assign" | "unassign" | "update_address"
  system: text("system").notNull(),
  action: text("action").notNull(),
  outcome: text("outcome").notNull().default("pending"),
  vehicleNumber: text("vehicle_number"),
  truckNumber: text("truck_number"),
  vin: text("vin"),
  enterpriseId: text("enterprise_id"),
  ldapId: text("ldap_id"),
  requestPayload: text("request_payload"),
  responsePayload: text("response_payload"),
  errorMessage: text("error_message"),
  attemptCount: integer("attempt_count").default(0).notNull(),
  maxRetries: integer("max_retries").default(3).notNull(),
  nextRetryAt: timestamp("next_retry_at"),
  lastAttemptAt: timestamp("last_attempt_at"),
  resolvedAt: timestamp("resolved_at"),
  requestedBy: text("requested_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => {
  return {
    fleetOpIdx: index("op_events_fleet_op_idx").on(table.fleetOpLogId),
    systemIdx: index("op_events_system_idx").on(table.system),
    outcomeIdx: index("op_events_outcome_idx").on(table.outcome),
    retryIdx: index("op_events_retry_idx").on(table.nextRetryAt),
    queueItemIdx: index("op_events_queue_item_idx").on(table.queueItemId),
  };
});

export const insertOperationEventSchema = createInsertSchema(operationEvents).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type OperationEvent = typeof operationEvents.$inferSelect;
export type InsertOperationEvent = z.infer<typeof insertOperationEventSchema>;

// ===============================================================
// Tier-3 Reconciliation Backstop (T004)
// Self-healing nightly reconciler that drives tech<->truck ASSIGNMENT
// (and WMS cost-center) corrections across WMS / AMS / Holman from the
// AIMS extract + live TPMS /techinfo authority. This is a SEPARATE
// substrate from operation_events (which stays the tier-2 live-op retry
// path) because it carries run-level gates (G0/G1/G2), canary approval,
// kill switch, leases, before-images and verification state.
// ===============================================================

// --- Reconciliation runs: one row per reconciler invocation ---
// kind:    'dry_run' | 'canary' | 'backfill' | 'nightly'
// status:  'pending' | 'running' | 'halted' | 'completed' | 'killed' | 'failed'
export const reconciliationRuns = pgTable("reconciliation_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  kind: text("kind").notNull(),
  status: text("status").notNull().default("pending"),
  // The AIMS extract this run is anchored to (the FILE_DATE that passed G0).
  acceptedFileDate: date("accepted_file_date"),
  // Run-level gate results (#2/#1): { g0:{pass,reason}, g1:{...}, g2:{...} }.
  gates: jsonb("gates"),
  // Proposed/applied/skipped/failed counts keyed by outcome + by leg.
  totals: jsonb("totals"),
  // G2 (30% volume circuit-breaker) is enforced by default. ONLY a supervised
  // backfill may bypass it, and only with an approver + a verified canary run.
  g2Exempt: boolean("g2_exempt").notNull().default(false),
  g2ExemptReason: text("g2_exempt_reason"),
  canaryRunId: varchar("canary_run_id"), // the canary run that gated a backfill
  batchSize: integer("batch_size"),       // tunable writes-per-batch (#6)
  killSwitch: boolean("kill_switch").notNull().default(false),
  alertMessage: text("alert_message"),    // populated on HALT so it is not silent
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at"),
  requestedBy: text("requested_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
  // Set by the verification step when a CANARY run's writes are confirmed
  // landed (#8). A backfill may bypass G2 ONLY against a canary whose
  // verifiedAt is set — a merely-materialized canary (status='completed', no
  // writes yet) must NOT authorize a large backfill.
  verifiedAt: timestamp("verified_at"),
}, (table) => {
  return {
    kindIdx: index("recon_runs_kind_idx").on(table.kind),
    statusIdx: index("recon_runs_status_idx").on(table.status),
    createdIdx: index("recon_runs_created_idx").on(table.createdAt),
  };
});

export const insertReconciliationRunSchema = createInsertSchema(reconciliationRuns).omit({
  id: true,
  createdAt: true,
});
export type ReconciliationRun = typeof reconciliationRuns.$inferSelect;
export type InsertReconciliationRun = z.infer<typeof insertReconciliationRunSchema>;

// --- Reconciliation items: the resumable, leased per-leg write queue ---
// One row per proposed per-leg write. This is a durable state machine.
// system:  'wms' | 'ams' | 'holman'
// field:   'assignment' | 'cost_center'
// ruleId:  the #20 truth-table outcome (e.g. WMS_ASSIGN, HOLMAN_GHOST_CLEAR)
// status (state machine):
//   active/in-flight: 'queued' | 'applying' | 'external_applied_cache_pending'
//                     | 'retry_scheduled' | 'awaiting_batch'
//   terminal:         'applied' | 'verified' | 'skipped' | 'held'
//                     | 'flagged' | 'failed' | 'exhausted'
// errorBucket: 'auth' | 'throttle' | 'data'  (#15)
export const reconciliationItems = pgTable("reconciliation_items", {
  id: serial("id").primaryKey(),
  runId: varchar("run_id").notNull(),
  system: text("system").notNull(),
  ruleId: text("rule_id").notNull(),
  action: text("action").notNull(), // 'assign' | 'clear' | 'cost_center'
  field: text("field").notNull(),
  truckCanonical: text("truck_canonical").notNull(),
  truckNumber: text("truck_number"),
  desiredEnterpriseId: text("desired_enterprise_id"),
  desiredValue: text("desired_value"),       // cost-center value, '^null^', etc.
  expectedBeforeValue: text("expected_before_value"),
  // Idempotency key = system + action + truck + desiredEnterpriseId (#6, W5).
  idempotencyKey: text("idempotency_key").notNull(),
  status: text("status").notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  errorBucket: text("error_bucket"),
  lastError: text("last_error"),
  beforeImageId: integer("before_image_id"),
  // Write-ordering timestamps (external-write -> cache-write -> verify; #a).
  externalAppliedAt: timestamp("external_applied_at"),
  cacheAppliedAt: timestamp("cache_applied_at"),
  verifiedAt: timestamp("verified_at"),
  // Scheduling / backoff (#5c rate-limit hold-off).
  retryAfterAt: timestamp("retry_after_at"),
  nextAttemptAt: timestamp("next_attempt_at"),
  // Cooperative lease so only one worker touches an item at a time (#6).
  leaseOwner: text("lease_owner"),
  leaseUntil: timestamp("lease_until"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => {
  return {
    runIdx: index("recon_items_run_idx").on(table.runId),
    statusIdx: index("recon_items_status_idx").on(table.status),
    systemIdx: index("recon_items_system_idx").on(table.system),
    truckIdx: index("recon_items_truck_idx").on(table.truckCanonical),
    nextAttemptIdx: index("recon_items_next_attempt_idx").on(table.nextAttemptAt),
    // Idempotency within a run: re-materializing / re-kicking never double-inserts.
    runIdempUq: uniqueIndex("recon_items_run_idemp_uq").on(table.runId, table.idempotencyKey),
    // Cross-run guard: only one IN-FLIGHT item per logical target at a time, so a
    // nightly run cannot start a second write while a backfill item is mid-flight.
    // Partial over active statuses only -> future legit re-corrections are allowed.
    activeIdempUq: uniqueIndex("recon_items_active_idemp_uq")
      .on(table.idempotencyKey)
      .where(sql`${table.status} in ('queued','applying','external_applied_cache_pending','retry_scheduled','awaiting_batch')`),
    // Stronger W5 guard: at most ONE active item per LOGICAL TARGET
    // {system, truck, field} regardless of desired value. idempotencyKey embeds
    // `desired`, so it alone lets an authority change (desired X->Y) create two
    // coexisting active corrections for the same field. This index forbids that;
    // the retained row is reconciled by the executor's W1 live re-confirm.
    // (assignment vs cost_center are different `field` values -> both may be
    // active on the same truck, which is correct.)
    activeTargetUq: uniqueIndex("recon_items_active_target_uq")
      .on(table.system, table.truckCanonical, table.field)
      .where(sql`${table.status} in ('queued','applying','external_applied_cache_pending','retry_scheduled','awaiting_batch')`),
  };
});

export const insertReconciliationItemSchema = createInsertSchema(reconciliationItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type ReconciliationItem = typeof reconciliationItems.$inferSelect;
export type InsertReconciliationItem = z.infer<typeof insertReconciliationItemSchema>;

// --- Generic key/value app settings (feature flags / toggles) ------------
// One row per setting key; `value` is jsonb so a setting may hold a boolean,
// string, number, or small object. Used by the developer-gated reconciliation
// auto-apply toggle under the key 'reconciliation.autoApply' (defaults OFF).
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedBy: text("updated_by"),
});

export const insertAppSettingSchema = createInsertSchema(appSettings).omit({
  updatedAt: true,
});
export type AppSetting = typeof appSettings.$inferSelect;
export type InsertAppSetting = z.infer<typeof insertAppSettingSchema>;

// --- Before-images: persisted BEFORE every write; drives reversal (#7) ---
// 90-day retention (tunable prune). old_value is jsonb so it can hold the full
// Holman clientData blob for an exact reversal.
export const reconciliationBeforeImages = pgTable("reconciliation_before_images", {
  id: serial("id").primaryKey(),
  runId: varchar("run_id").notNull(),
  itemId: integer("item_id"),
  system: text("system").notNull(),
  field: text("field").notNull(),
  truckCanonical: text("truck_canonical").notNull(),
  truckNumber: text("truck_number"),
  oldValue: jsonb("old_value"),
  newValue: jsonb("new_value"),
  reason: text("reason"),
  reverted: boolean("reverted").notNull().default(false),
  revertedAt: timestamp("reverted_at"),
  revertedBy: text("reverted_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => {
  return {
    runIdx: index("recon_bimg_run_idx").on(table.runId),
    itemIdx: index("recon_bimg_item_idx").on(table.itemId),
    truckIdx: index("recon_bimg_truck_idx").on(table.truckCanonical),
    createdIdx: index("recon_bimg_created_idx").on(table.createdAt),
  };
});

export const insertReconciliationBeforeImageSchema = createInsertSchema(reconciliationBeforeImages).omit({
  id: true,
  createdAt: true,
});
export type ReconciliationBeforeImage = typeof reconciliationBeforeImages.$inferSelect;
export type InsertReconciliationBeforeImage = z.infer<typeof insertReconciliationBeforeImageSchema>;

// --- AMS in-flight stamps: CROSS-run, keyed by truck (#17) ---
// AMS unassigns propagate via an overnight TPMS batch file. While inside the
// propagation window we suppress re-proposing AND re-counting the truck so it
// neither churns night-to-night nor double-counts toward the G2 ceiling.
export const amsInflightStamps = pgTable("ams_inflight_stamps", {
  truckCanonical: varchar("truck_canonical").primaryKey(),
  truckNumber: text("truck_number"),
  submittedToAmsAt: timestamp("submitted_to_ams_at").notNull(),
  reason: text("reason"),
  lastSeenDivergedAt: timestamp("last_seen_diverged_at"),
  escalatedAt: timestamp("escalated_at"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => {
  return {
    submittedIdx: index("ams_inflight_submitted_idx").on(table.submittedToAmsAt),
    resolvedIdx: index("ams_inflight_resolved_idx").on(table.resolvedAt),
  };
});

export const insertAmsInflightStampSchema = createInsertSchema(amsInflightStamps).omit({
  createdAt: true,
  updatedAt: true,
});
export type AmsInflightStamp = typeof amsInflightStamps.$inferSelect;
export type InsertAmsInflightStamp = z.infer<typeof insertAmsInflightStampSchema>;

// --- Holman lifecycle review flags: persistent (#4, L2 write-hold) ---
// A truck TPMS-active but Holman Sold/OOS goes on a FULL write-hold across
// every leg until a USER resolves the flag. One OPEN flag per truck.
export const holmanLifecycleFlags = pgTable("holman_lifecycle_flags", {
  id: serial("id").primaryKey(),
  truckCanonical: text("truck_canonical").notNull(),
  truckNumber: text("truck_number"),
  reason: text("reason"),
  holmanStatus: text("holman_status"),
  firstSeen: timestamp("first_seen").defaultNow().notNull(),
  lastSeen: timestamp("last_seen").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: text("resolved_by"),
  owner: text("owner"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => {
  return {
    truckIdx: index("holman_lifecycle_truck_idx").on(table.truckCanonical),
    resolvedIdx: index("holman_lifecycle_resolved_idx").on(table.resolvedAt),
    openUq: uniqueIndex("holman_lifecycle_open_uq")
      .on(table.truckCanonical)
      .where(sql`${table.resolvedAt} is null`),
  };
});

export const insertHolmanLifecycleFlagSchema = createInsertSchema(holmanLifecycleFlags).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type HolmanLifecycleFlag = typeof holmanLifecycleFlags.$inferSelect;
export type InsertHolmanLifecycleFlag = z.infer<typeof insertHolmanLifecycleFlagSchema>;

// --- Contested-authority flags: persistent (#11, L3 hold) ---
// AIMS owner cannot be confirmed against live /techinfo -> write NOTHING on any
// leg + flag. One OPEN flag per truck.
export const contestedFlags = pgTable("contested_flags", {
  id: serial("id").primaryKey(),
  truckCanonical: text("truck_canonical").notNull(),
  truckNumber: text("truck_number"),
  reason: text("reason"),
  aimsOwner: text("aims_owner"),
  liveHolder: text("live_holder"),
  firstSeen: timestamp("first_seen").defaultNow().notNull(),
  lastSeen: timestamp("last_seen").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: text("resolved_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => {
  return {
    truckIdx: index("contested_truck_idx").on(table.truckCanonical),
    resolvedIdx: index("contested_resolved_idx").on(table.resolvedAt),
    openUq: uniqueIndex("contested_open_uq")
      .on(table.truckCanonical)
      .where(sql`${table.resolvedAt} is null`),
  };
});

export const insertContestedFlagSchema = createInsertSchema(contestedFlags).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type ContestedFlag = typeof contestedFlags.$inferSelect;
export type InsertContestedFlag = z.infer<typeof insertContestedFlagSchema>;

// --- Write fences: generic field-freeze so nightly sync can't clobber a
// backstop write before it is verified (#b). Keyed {system, truck, field}. ---
export const reconciliationWriteFences = pgTable("reconciliation_write_fences", {
  id: serial("id").primaryKey(),
  system: text("system").notNull(),
  truckCanonical: text("truck_canonical").notNull(),
  field: text("field").notNull(), // 'assignment' | 'cost_center'
  expectedValue: text("expected_value"), // value the backstop wrote; sync must keep
  runId: varchar("run_id"),
  expiresAt: timestamp("expires_at"),   // fence lifetime
  verifiedAt: timestamp("verified_at"), // set when bulk-verify confirms (lifts early)
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => {
  return {
    truckIdx: index("recon_fence_truck_idx").on(table.truckCanonical),
    expiresIdx: index("recon_fence_expires_idx").on(table.expiresAt),
    targetUq: uniqueIndex("recon_fence_target_uq").on(table.system, table.truckCanonical, table.field),
  };
});

export const insertReconciliationWriteFenceSchema = createInsertSchema(reconciliationWriteFences).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type ReconciliationWriteFence = typeof reconciliationWriteFences.$inferSelect;
export type InsertReconciliationWriteFence = z.infer<typeof insertReconciliationWriteFenceSchema>;

// ===============================
// Bulk Fix Runs (Alignment Dashboard)
// ===============================

export const bulkFixRuns = pgTable("bulk_fix_runs", {
  runId: varchar("run_id").primaryKey().default(sql`gen_random_uuid()`),
  status: text("status").notNull().default("running"), // "running" | "completed" | "cancelled"
  startedBy: text("started_by").notNull(),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  cancelledAt: timestamp("cancelled_at"),
  completedAt: timestamp("completed_at"),
  highFailureWarning: boolean("high_failure_warning").default(false),
}, (table) => {
  return {
    statusIdx: index("bulk_fix_runs_status_idx").on(table.status),
    startedByIdx: index("bulk_fix_runs_started_by_idx").on(table.startedBy),
  };
});

export const insertBulkFixRunSchema = createInsertSchema(bulkFixRuns).omit({
  runId: true,
  startedAt: true,
});
export type BulkFixRun = typeof bulkFixRuns.$inferSelect;
export type InsertBulkFixRun = z.infer<typeof insertBulkFixRunSchema>;

export const bulkFixRunItems = pgTable("bulk_fix_run_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  runId: varchar("run_id").notNull().references(() => bulkFixRuns.runId),
  truckNumber: text("truck_number").notNull(),
  action: text("action").notNull(), // "assign" | "unassign" | "push_holman" | "push_ams" | "cache_evict" | "wait"
  ldapId: text("ldap_id"),
  districtNo: text("district_no"),
  status: text("status").notNull().default("pending"), // "pending" | "completed" | "failed" | "skipped"
  outcome: jsonb("outcome"),
  processedAt: timestamp("processed_at"),
}, (table) => {
  return {
    runIdIdx: index("bulk_fix_run_items_run_id_idx").on(table.runId),
    statusIdx: index("bulk_fix_run_items_status_idx").on(table.status),
  };
});

export const insertBulkFixRunItemSchema = createInsertSchema(bulkFixRunItems).omit({
  id: true,
});
export type BulkFixRunItem = typeof bulkFixRunItems.$inferSelect;
export type InsertBulkFixRunItem = z.infer<typeof insertBulkFixRunItemSchema>;

// ===============================
// Offboarding Return Tokens (Sprint B1)
// ===============================

export const offboardingReturnTokens = pgTable("offboarding_return_tokens", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  token: varchar("token", { length: 64 }).notNull().unique(),
  queueItemId: varchar("queue_item_id").notNull().references(() => queueItems.id),
  expiresAt: timestamp("expires_at").notNull(),
  consumedAt: timestamp("consumed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => {
  return {
    tokenIdx: index("offboarding_return_tokens_token_idx").on(table.token),
    queueItemIdIdx: index("offboarding_return_tokens_queue_item_id_idx").on(table.queueItemId),
  };
});

export const insertOffboardingReturnTokenSchema = createInsertSchema(offboardingReturnTokens).omit({
  id: true,
  createdAt: true,
});
export type OffboardingReturnToken = typeof offboardingReturnTokens.$inferSelect;
export type InsertOffboardingReturnToken = z.infer<typeof insertOffboardingReturnTokenSchema>;

// ===============================
// BYOV Creation Audit Log (Task 293)
// Records every POST /api/byov/create attempt for staff review.
// ===============================

export const byovCreationAudit = pgTable("byov_creation_audit", {
  id: serial("id").primaryKey(),
  vehicleNumber: varchar("vehicle_number", { length: 20 }).notNull(),
  vin: varchar("vin", { length: 17 }),
  make: varchar("make", { length: 100 }),
  model: varchar("model", { length: 100 }),
  modelYear: varchar("model_year", { length: 4 }),
  assetType: varchar("asset_type", { length: 50 }),
  district: varchar("district", { length: 20 }),
  submittedBy: varchar("submitted_by", { length: 100 }).notNull(),
  submittedAt: timestamp("submitted_at").defaultNow().notNull(),
  holmanSuccess: boolean("holman_success").notNull(),
  holmanError: text("holman_error"),
  wmsSuccess: boolean("wms_success").notNull(),
  wmsError: text("wms_error"),
  // 'cache' = blocked by local Holman cache hit, 'live' = blocked by live Holman API lookup.
  // NULL for normal (non-blocked) submission attempts.
  blockedSource: varchar("blocked_source", { length: 10 }),
});

export type ByovCreationAuditEntry = typeof byovCreationAudit.$inferSelect;

// ===============================
// District Cost Centers (Task 207)
// Maps each district number to its accounting cost center.
// Default rule: cost_center = "0" + last 4 digits of district (e.g. 0004766 -> 04766)
// Editable overrides win over the default.
// ===============================

export const districtCostCenters = pgTable("district_cost_centers", {
  district: varchar("district", { length: 7 }).primaryKey(), // zero-padded 7-digit district
  costCenter: varchar("cost_center", { length: 5 }).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedBy: varchar("updated_by", { length: 100 }),
});

export const insertDistrictCostCenterSchema = createInsertSchema(districtCostCenters).omit({
  updatedAt: true,
});
export type DistrictCostCenter = typeof districtCostCenters.$inferSelect;
export type InsertDistrictCostCenter = z.infer<typeof insertDistrictCostCenterSchema>;

// ===============================
// External Apps dock (admin-managed launcher tiles)
// One row per external app tile on the dashboard. Admin CRUD via /api/external-apps.
// Created at boot via CREATE TABLE IF NOT EXISTS in server/routes.ts (autoscale
// deploys run NO migrations). Every column except the PK is nullable or defaulted
// so a partial deploy can't crash the read path. permissionKey reserved for future
// per-app gating (unused now). GUARDIAN NAMING: title the UI 'App Launcher'/'Fleet
// Apps', NOT 'External Apps'/'External APIs'; collides with /integrations, the
// api_configurations table, and the dashboard 'External APIs' status row.
// Table/route/permission names stay external_apps / /api/external-apps /
// externalAppManagement.
// ===============================
export const externalApps = pgTable("external_apps", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  url: text("url").notNull(),
  description: text("description"),
  logoUrl: text("logo_url"),
  icon: text("icon"),
  color: text("color"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  permissionKey: text("permission_key"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  createdBy: varchar("created_by").references(() => users.id),
  updatedBy: varchar("updated_by").references(() => users.id),
});

const URL_HTTPS_ONLY = z.string().url().regex(/^https?:\/\//i, "URL must start with http:// or https://");
export const insertExternalAppSchema = createInsertSchema(externalApps)
  .omit({ id: true, createdAt: true, updatedAt: true, createdBy: true, updatedBy: true })
  .extend({
    name: z.string().trim().min(1),
    url: URL_HTTPS_ONLY,
    logoUrl: URL_HTTPS_ONLY.optional().nullable(),
    sortOrder: z.coerce.number().int().default(0),
    isActive: z.coerce.boolean().default(true),
  });
export const updateExternalAppSchema = insertExternalAppSchema.partial();
export type ExternalApp = typeof externalApps.$inferSelect;
export type InsertExternalApp = z.infer<typeof insertExternalAppSchema>;

