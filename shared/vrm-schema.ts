import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  timestamp,
  boolean,
  integer,
  decimal,
  date,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const vrmTechStatusEnum = pgEnum("vrm_tech_status", [
  "in_rental",
  "byov_enrolled",
  "exception_paired",
  "exception_home_learning",
  "escalated_carl",
  "epv_issued",
  "resolved",
  "exempt_scorecard",
  "exempt_new_hire",
]);

export const vrmGate1ClassEnum = pgEnum("vrm_gate1_class", [
  "underwater",
  "marginal",
  "profitable",
]);

export const vrmDcaOutcomeEnum = pgEnum("vrm_dca_outcome", [
  "pending",
  "cleared",
  "hold",
  "escalate",
]);

export const vrmOutreachActionEnum = pgEnum("vrm_outreach_action", [
  "text_sent",
  "call_completed",
  "carl_escalated",
  "epv_issued",
  "byov_enrolled",
  "exception_opened",
]);

export const vrmSmsDirectionEnum = pgEnum("vrm_sms_direction", [
  "outbound",
  "inbound",
]);

export const vrmSmsResponseEnum = pgEnum("vrm_sms_response", [
  "pending",
  "accepted_byov",
  "declined",
  "exception_request",
  "no_response",
]);

export const vrmExceptionTypeEnum = pgEnum("vrm_exception_type", [
  "paired",
  "home_learning",
]);

export const vrmExceptionStatusEnum = pgEnum("vrm_exception_status", [
  "active",
  "review_due",
  "approaching_60_days",
  "closed",
]);

export const vrmClosureReasonEnum = pgEnum("vrm_closure_reason", [
  "byov_enrolled",
  "escalated",
  "third_party_vehicle",
]);

export const vrmPayStatusEnum = pgEnum("vrm_pay_status", [
  "protected",
  "warning_issued",
  "adjusted",
  "removed",
]);

export const vrmReview21OutcomeEnum = pgEnum("vrm_review_21_outcome", [
  "continue",
  "modify_content",
  "escalate",
]);

export const vrmAltTaskTypeEnum = pgEnum("vrm_alt_task_type", [
  "routing_queue",
  "shsai_queue",
  "other",
]);

export const vrmAltTaskStatusEnum = pgEnum("vrm_alt_task_status", [
  "assigned",
  "in_progress",
  "completed",
]);

export const vrmEscalationStatusEnum = pgEnum("vrm_escalation_status", [
  "pending_carl",
  "resolved",
  "epv_required",
]);

// ─── Tables ───────────────────────────────────────────────────────────────────

export const vrmTechs = pgTable("vrm_techs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ldap: varchar("ldap", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  market: varchar("market", { length: 100 }),
  dcaName: varchar("dca_name", { length: 255 }),
  teamLeadName: varchar("team_lead_name", { length: 255 }),
  teamLeadPhone: varchar("team_lead_phone", { length: 50 }),
  tenureMonths: integer("tenure_months"),
  rentalStartDate: date("rental_start_date"),
  dailyRentalRate: decimal("daily_rental_rate", { precision: 10, scale: 2 }).default("78.00"),
  gate1AdjustedNet: decimal("gate1_adjusted_net", { precision: 12, scale: 2 }),
  gate1Classification: vrmGate1ClassEnum("gate1_classification"),
  gate2Exempt: boolean("gate2_exempt").notNull().default(false),
  newHireExempt: boolean("new_hire_exempt").notNull().default(false),
  dcaReviewOutcome: vrmDcaOutcomeEnum("dca_review_outcome").default("pending"),
  dcaReviewNotes: text("dca_review_notes"),
  dcaReviewDate: timestamp("dca_review_date"),
  currentStatus: vrmTechStatusEnum("current_status").notNull().default("in_rental"),
  statusUpdatedAt: timestamp("status_updated_at").defaultNow(),
  shopName: varchar("shop_name", { length: 255 }),
  shopAddress: varchar("shop_address", { length: 500 }),
  shopPhone: varchar("shop_phone", { length: 50 }),
  shopDropoffDate: date("shop_dropoff_date"),
  shopEstimatedReady: date("shop_estimated_ready"),
  primaryZip: varchar("primary_zip", { length: 20 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  ldapIdx: index("vrm_techs_ldap_idx").on(table.ldap),
  statusIdx: index("vrm_techs_status_idx").on(table.currentStatus),
  marketIdx: index("vrm_techs_market_idx").on(table.market),
}));

export const vrmTechStatusHistory = pgTable("vrm_tech_status_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  techId: varchar("tech_id").notNull().references(() => vrmTechs.id),
  previousStatus: varchar("previous_status", { length: 100 }),
  newStatus: varchar("new_status", { length: 100 }).notNull(),
  changedByName: varchar("changed_by_name", { length: 255 }),
  reason: text("reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  techIdIdx: index("vrm_status_history_tech_idx").on(table.techId),
}));

export const vrmOutreachLog = pgTable("vrm_outreach_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  techId: varchar("tech_id").notNull().references(() => vrmTechs.id),
  actionType: vrmOutreachActionEnum("action_type").notNull(),
  outcome: text("outcome"),
  notes: text("notes"),
  performedByName: varchar("performed_by_name", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  techIdIdx: index("vrm_outreach_log_tech_idx").on(table.techId),
}));

export const vrmSmsMessages = pgTable("vrm_sms_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  techId: varchar("tech_id").notNull().references(() => vrmTechs.id),
  direction: vrmSmsDirectionEnum("direction").notNull(),
  body: text("body").notNull(),
  twilioSid: varchar("twilio_sid", { length: 100 }),
  sentByName: varchar("sent_by_name", { length: 255 }),
  teamLeadCcd: boolean("team_lead_ccd").notNull().default(false),
  responseStatus: vrmSmsResponseEnum("response_status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  techIdIdx: index("vrm_sms_messages_tech_idx").on(table.techId),
}));

export const vrmExceptionCases = pgTable("vrm_exception_cases", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  techId: varchar("tech_id").notNull().references(() => vrmTechs.id),
  exceptionType: vrmExceptionTypeEnum("exception_type").notNull(),
  status: vrmExceptionStatusEnum("status").notNull().default("active"),
  openDate: date("open_date").notNull(),
  closeDate: date("close_date"),
  closureReason: vrmClosureReasonEnum("closure_reason"),
  pairingPartnerLdap: varchar("pairing_partner_ldap", { length: 50 }),
  pairingPartnerName: varchar("pairing_partner_name", { length: 255 }),
  pairingStartDate: date("pairing_start_date"),
  baseWeeklyPay: decimal("base_weekly_pay", { precision: 10, scale: 2 }),
  payStatus: vrmPayStatusEnum("pay_status").notNull().default("protected"),
  review21DayCompleted: boolean("review_21_day_completed").notNull().default(false),
  review21DayOutcome: vrmReview21OutcomeEnum("review_21_day_outcome"),
  review21DayNotes: text("review_21_day_notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  techIdIdx: index("vrm_exception_cases_tech_idx").on(table.techId),
}));

export const vrmReachabilityLog = pgTable("vrm_reachability_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  exceptionCaseId: varchar("exception_case_id").notNull().references(() => vrmExceptionCases.id),
  logDate: date("log_date").notNull(),
  reachable: boolean("reachable").notNull(),
  confirmedByName: varchar("confirmed_by_name", { length: 255 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const vrmAlternativeTasks = pgTable("vrm_alternative_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  exceptionCaseId: varchar("exception_case_id").notNull().references(() => vrmExceptionCases.id),
  taskType: vrmAltTaskTypeEnum("task_type").notNull(),
  assignedDate: date("assigned_date").notNull(),
  description: text("description"),
  completionStatus: vrmAltTaskStatusEnum("completion_status").notNull().default("assigned"),
  assignedByName: varchar("assigned_by_name", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const vrmEscalations = pgTable("vrm_escalations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  techId: varchar("tech_id").notNull().references(() => vrmTechs.id),
  triggeredByName: varchar("triggered_by_name", { length: 255 }),
  reason: text("reason"),
  priorOutreachSummary: text("prior_outreach_summary"),
  status: vrmEscalationStatusEnum("status").notNull().default("pending_carl"),
  carlOutcomeNotes: text("carl_outcome_notes"),
  epvConfirmed: boolean("epv_confirmed").notNull().default(false),
  epvConfirmedAt: timestamp("epv_confirmed_at"),
  rentalStopDate: date("rental_stop_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  techIdIdx: index("vrm_escalations_tech_idx").on(table.techId),
}));

export const vrmShopContactLog = pgTable("vrm_shop_contact_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  techId: varchar("tech_id").notNull().references(() => vrmTechs.id),
  contactDate: date("contact_date").notNull(),
  notes: text("notes"),
  loggedByName: varchar("logged_by_name", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const vrmSmsTemplates = pgTable("vrm_sms_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 100 }).notNull(),
  body: text("body").notNull(),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const vrmTechNotes = pgTable("vrm_tech_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  techId: varchar("tech_id").notNull().references(() => vrmTechs.id),
  noteText: text("note_text").notNull(),
  authorName: varchar("author_name", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  techIdIdx: index("vrm_tech_notes_tech_idx").on(table.techId),
}));

// ─── Insert schemas ────────────────────────────────────────────────────────────

export const insertVrmTechSchema = createInsertSchema(vrmTechs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertVrmOutreachLogSchema = createInsertSchema(vrmOutreachLog).omit({
  id: true,
  createdAt: true,
});

export const insertVrmEscalationSchema = createInsertSchema(vrmEscalations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertVrmExceptionCaseSchema = createInsertSchema(vrmExceptionCases).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertVrmTechNoteSchema = createInsertSchema(vrmTechNotes).omit({
  id: true,
  createdAt: true,
});

export const insertVrmSmsMessageSchema = createInsertSchema(vrmSmsMessages).omit({
  id: true,
  createdAt: true,
});

export const insertVrmReachabilityLogSchema = createInsertSchema(vrmReachabilityLog).omit({
  id: true,
  createdAt: true,
});

// ─── Types ────────────────────────────────────────────────────────────────────

export type VrmTech = typeof vrmTechs.$inferSelect;
export type InsertVrmTech = z.infer<typeof insertVrmTechSchema>;
export type VrmOutreachLog = typeof vrmOutreachLog.$inferSelect;
export type VrmEscalation = typeof vrmEscalations.$inferSelect;
export type VrmExceptionCase = typeof vrmExceptionCases.$inferSelect;
export type VrmSmsTemplate = typeof vrmSmsTemplates.$inferSelect;
export type VrmTechNote = typeof vrmTechNotes.$inferSelect;
export type VrmSmsMessage = typeof vrmSmsMessages.$inferSelect;
