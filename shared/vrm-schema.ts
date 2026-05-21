import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  timestamp,
  boolean,
  integer,
  serial,
  decimal,
  date,
  pgEnum,
  index,
  jsonb,
  uniqueIndex,
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
  gate1DaysInRental: integer("gate1_days_in_rental"),
  gate1Completes: integer("gate1_completes"),
  gate1TotalRevenue: decimal("gate1_total_revenue", { precision: 12, scale: 2 }),
  gate1LaborDirect: decimal("gate1_labor_direct", { precision: 12, scale: 2 }),
  gate1LaborBenefits: decimal("gate1_labor_benefits", { precision: 12, scale: 2 }),
  gate1PartsCogs: decimal("gate1_parts_cogs", { precision: 12, scale: 2 }),
  gate1PartsShipping: decimal("gate1_parts_shipping", { precision: 12, scale: 2 }),
  gate1TruckExpense: decimal("gate1_truck_expense", { precision: 12, scale: 2 }),
  gate1PptProfit: decimal("gate1_ppt_profit", { precision: 12, scale: 2 }),
  gate1FuelEst: decimal("gate1_fuel_est", { precision: 12, scale: 2 }),
  gate1RentalCost: decimal("gate1_rental_cost", { precision: 12, scale: 2 }),
  gate1AdjustedNet: decimal("gate1_adjusted_net", { precision: 12, scale: 2 }),
  gate1PayrollCost: decimal("gate1_payroll_cost", { precision: 12, scale: 2 }),
  gate1Classification: vrmGate1ClassEnum("gate1_classification"),
  gate2Exempt: boolean("gate2_exempt").notNull().default(false),
  gate2WeightedScore: decimal("gate2_weighted_score", { precision: 6, scale: 3 }),
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
  outreachFlagged: boolean("outreach_flagged").notNull().default(false),
  returnedRental: boolean("returned_rental").notNull().default(false),
  rentalReturnDate: date("rental_return_date"),
  escalationPath: varchar("escalation_path", { length: 50 }),
  smsSentAt: timestamp("sms_sent_at"),
  smsResponseStatus: varchar("sms_response_status", { length: 50 }),
  byovEnrolled: boolean("byov_enrolled").notNull().default(false),
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

export const vrmTechNotes = pgTable("vrm_tech_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  techId: varchar("tech_id").notNull().references(() => vrmTechs.id),
  noteText: text("note_text").notNull(),
  authorName: varchar("author_name", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  techIdIdx: index("vrm_tech_notes_tech_idx").on(table.techId),
}));

export const vrmRentalDecisions = pgTable("vrm_rental_decisions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  techLdap: varchar("tech_ldap", { length: 50 }).notNull(),
  techName: varchar("tech_name", { length: 255 }),
  dailyNetWithRental: decimal("daily_net_with_rental", { precision: 10, scale: 2 }),
  recommendation: varchar("recommendation", { length: 20 }).notNull(),
  decision: varchar("decision", { length: 20 }).notNull(),
  decidedByName: varchar("decided_by_name", { length: 255 }).notNull(),
  notes: text("notes"),
  scorecardScore: decimal("scorecard_score", { precision: 6, scale: 3 }),
  tenureMonths: integer("tenure_months"),
  // Snapshot of evaluator inputs/outputs at decision time. All optional so
  // older decisions (pre-snapshot) keep working — UI renders "—" for nulls.
  lastHireDate: date("last_hire_date"),
  state: text("state"),
  district: text("district"),
  // Supervisor frozen at the moment of decision so the Decision Log keeps
  // showing the right name even after the daily snapshot rotates. The GET
  // route prefers these stored values and only falls back to the snapshot
  // join for legacy rows where they are NULL.
  supervisorName: varchar("supervisor_name", { length: 255 }),
  supervisorLdap: varchar("supervisor_ldap", { length: 50 }),
  supervisorPhone: varchar("supervisor_phone", { length: 50 }),
  completes: integer("completes"),
  dailyRevenue: decimal("daily_revenue", { precision: 10, scale: 2 }),
  dailyCosts: decimal("daily_costs", { precision: 10, scale: 2 }),
  dailyNetBeforeRental: decimal("daily_net_before_rental", { precision: 10, scale: 2 }),
  dailyPptProfit: decimal("daily_ppt_profit", { precision: 10, scale: 2 }),
  smsSentAt: timestamp("sms_sent_at"),
  smsResponseStatus: varchar("sms_response_status", { length: 50 }),
  byovEnrolled: boolean("byov_enrolled").notNull().default(false),
  returnedRental: boolean("returned_rental").notNull().default(false),
  rentalReturnDate: date("rental_return_date"),
  // DCA "Make Unavailable" outbound event tracking (Standard Activities
  // Request Generator API). Populated by the dca-event-dispatcher after a
  // Deny is logged. dcaEventProjectId is the upstream project id returned
  // by the API — needed later if we ever submit a Quick Return.
  dcaEventStatus: varchar("dca_event_status", { length: 20 }),
  dcaEventProjectId: varchar("dca_event_project_id", { length: 64 }),
  dcaEventSentAt: timestamp("dca_event_sent_at"),
  dcaEventError: text("dca_event_error"),
  dcaEventAttempts: integer("dca_event_attempts").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  ldapIdx: index("vrm_rental_decisions_ldap_idx").on(table.techLdap),
}));

export const vrmRentalDecisionActions = pgTable("vrm_rental_decision_actions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  decisionId: varchar("decision_id").notNull().references(() => vrmRentalDecisions.id),
  actionType: vrmOutreachActionEnum("action_type").notNull(),
  notes: text("notes"),
  performedByName: varchar("performed_by_name", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  decisionIdIdx: index("vrm_decision_actions_decision_idx").on(table.decisionId),
}));

export const vrmRentalChecks = pgTable("vrm_rental_checks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  techLdap: varchar("tech_ldap", { length: 50 }).notNull(),
  techName: varchar("tech_name", { length: 255 }),
  dailyNetWithRental: decimal("daily_net_with_rental", { precision: 10, scale: 2 }),
  dailyNetBeforeRental: decimal("daily_net_before_rental", { precision: 10, scale: 2 }),
  recommendation: varchar("recommendation", { length: 20 }).notNull(),
  scorecardScore: decimal("scorecard_score", { precision: 6, scale: 3 }),
  tenureMonths: integer("tenure_months"),
  completes: integer("completes"),
  lookbackDays: integer("lookback_days"),
  district: text("district"),
  state: text("state"),
  checkedAt: timestamp("checked_at").defaultNow().notNull(),
}, (table) => ({
  ldapIdx: index("vrm_rental_checks_ldap_idx").on(table.techLdap),
  checkedAtIdx: index("vrm_rental_checks_at_idx").on(table.checkedAt),
}));

export const vrmNewRentalLog = pgTable("vrm_new_rental_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  dateOfRequest: date("date_of_request"),
  vanRentalPo: text("van_rental_po"),
  name: text("name"),
  enterpriseId: text("enterprise_id"),
  trimVanNum: text("trim_van_num"),
  techPhNum: text("tech_ph_num"),
  vanAssignedInTpms: text("van_assigned_in_tpms"),
  startRentalDate: date("start_rental_date"),
  repairLocation: text("repair_location"),
  repairPhone: text("repair_phone"),
  issue: text("issue"),
  permanentSolution: boolean("permanent_solution").notNull().default(false),
  amsUpdated: boolean("ams_updated").notNull().default(false),
  fleetTrackerUpdated: boolean("fleet_tracker_updated").notNull().default(false),
  rentalApproved: boolean("rental_approved").notNull().default(false),
  approvedInHolman: boolean("approved_in_holman").notNull().default(false),
  unitNumber: text("unit_number"),
  teamMembers: text("team_members"),
  existingRentalOnTruck: text("existing_rental_on_truck"),
  newRentalOrExtension: text("new_rental_or_extension"),
  truckBreakdownOrNewHire: text("truck_breakdown_or_new_hire"),
  existingRentalOpenHowLong: text("existing_rental_open_how_long"),
  techServiceDate: date("tech_service_date"),
  declinedRepair: boolean("declined_repair").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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

export const insertVrmRentalDecisionSchema = createInsertSchema(vrmRentalDecisions).omit({
  id: true,
  createdAt: true,
});

export const insertVrmRentalDecisionActionSchema = createInsertSchema(vrmRentalDecisionActions).omit({
  id: true,
  createdAt: true,
});

export const insertVrmRentalCheckSchema = createInsertSchema(vrmRentalChecks).omit({
  id: true,
  checkedAt: true,
});

// ─── Types ────────────────────────────────────────────────────────────────────

export type VrmTech = typeof vrmTechs.$inferSelect;
export type InsertVrmTech = z.infer<typeof insertVrmTechSchema>;
export type VrmOutreachLog = typeof vrmOutreachLog.$inferSelect;
export type VrmEscalation = typeof vrmEscalations.$inferSelect;
export type VrmExceptionCase = typeof vrmExceptionCases.$inferSelect;
export type VrmTechNote = typeof vrmTechNotes.$inferSelect;
export type VrmSmsMessage = typeof vrmSmsMessages.$inferSelect;
export type VrmRentalDecision = typeof vrmRentalDecisions.$inferSelect;
export type InsertVrmRentalDecision = z.infer<typeof insertVrmRentalDecisionSchema>;
export type VrmRentalDecisionAction = typeof vrmRentalDecisionActions.$inferSelect;
export type InsertVrmRentalDecisionAction = z.infer<typeof insertVrmRentalDecisionActionSchema>;
export type VrmRentalCheck = typeof vrmRentalChecks.$inferSelect;
export type InsertVrmRentalCheck = z.infer<typeof insertVrmRentalCheckSchema>;

export const insertVrmNewRentalLogSchema = createInsertSchema(vrmNewRentalLog).omit({
  id: true,
  createdAt: true,
});
export type VrmNewRentalLog = typeof vrmNewRentalLog.$inferSelect;
export type InsertVrmNewRentalLog = z.infer<typeof insertVrmNewRentalLogSchema>;

// ─── Repair Tracker ───────────────────────────────────────────────────────────

export const vrmRepairTracker = pgTable("vrm_repair_tracker", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  truckNumber: text("truck_number"),
  techLdap: text("tech_ldap"),
  techName: text("tech_name"),
  techPhone: text("tech_phone"),
  repairShopAddress: text("repair_shop_address"),
  repairShopPhone: text("repair_shop_phone"),
  mainStatus: text("main_status"),
  subStatus: text("sub_status"),
  techStatus: varchar("tech_status", { length: 50 }),
  byovEnrolled: boolean("byov_enrolled").default(false),
  notes: text("notes"),
  recommendation: text("recommendation"),
  deniedAt: timestamp("denied_at"),
  sourceDecisionId: varchar("source_decision_id"),
  sourceCheckId: varchar("source_check_id"),
  dismissed: boolean("dismissed").default(false),
  supervisorName: varchar("supervisor_name", { length: 255 }),
  supervisorPhone: varchar("supervisor_phone", { length: 50 }),
  techContacted: boolean("tech_contacted").default(false),
  techContactedDate: date("tech_contacted_date"),
  techContactOutcome: text("tech_contact_outcome"),
  rentalReturned: varchar("rental_returned", { length: 10 }),
  rentalReturnDate: date("rental_return_date"),
  routeCleared: boolean("route_cleared").default(false),
  routeClearedDate: date("route_cleared_date"),
  // Denial reason — populated prospectively via the edit modal.
  // Source `vrm_rental_decisions` has no denial_reason column, so backfill leaves these NULL.
  denialReason: text("denial_reason"),
  denialReasonDetail: text("denial_reason_detail"),
  // BYOV case-level lifecycle (canonical writer per R2).
  // tech-level long-term flag stays on `vrm_techs.byov_enrolled` (separate writer).
  byovOffered: boolean("byov_offered").default(false),
  byovOfferedDate: date("byov_offered_date"),
  byovStatus: text("byov_status"),
  byovDecisionDate: date("byov_decision_date"),
  // Shop contact tracking
  shopLastContactedDate: timestamp("shop_last_contacted_date"),
  shopEtaOnRoad: date("shop_eta_on_road"),
  // Liaison assignments — nullable until claimed by a user.
  assignedTechLiaison: varchar("assigned_tech_liaison", { length: 255 }),
  assignedShopLiaison: varchar("assigned_shop_liaison", { length: 255 }),
  // Case closure
  closedAt: timestamp("closed_at"),
  closedBy: varchar("closed_by", { length: 255 }),
  // AMS link / punch sync metadata
  linkMissing: boolean("link_missing").default(false),
  techPunchLastSyncedAt: timestamp("tech_punch_last_synced_at"),
  // User-selectable Stage — overrides auto-derivation when set. See
  // MANUAL_STAGES in shared/repair-tracker-stage.ts for valid values.
  stageOverride: text("stage_override"),
  stageOverrideSub: text("stage_override_sub"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  truckIdx: index("vrm_repair_tracker_truck_idx").on(table.truckNumber),
  statusIdx: index("vrm_repair_tracker_status_idx").on(table.mainStatus),
  closedAtIdx: index("vrm_repair_tracker_closed_at_idx").on(table.closedAt),
}));

// ─── Repair Tracker — Tech Outreach timeline (append-only) ────────────────────
// Replaces ad-hoc usage of vrm_repair_tracker_actions for tech-side notes.
export const vrmRepairTrackerTechOutreach = pgTable("vrm_repair_tracker_tech_outreach", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  repairTrackerId: varchar("repair_tracker_id").notNull(),
  authorId: varchar("author_id", { length: 255 }),
  authorName: varchar("author_name", { length: 255 }),
  occurredAt: timestamp("occurred_at").defaultNow().notNull(),
  // contact method: phone / sms / email / in_person / other
  method: varchar("method", { length: 50 }),
  // outcome: reached / left_voicemail / no_answer / refused / committed_eta / etc.
  outcome: varchar("outcome", { length: 50 }),
  body: text("body"),
  // Self-reference for revisions; null on the original entry.
  revisedFromId: varchar("revised_from_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  trackerIdx: index("vrm_rt_tech_outreach_tracker_idx").on(table.repairTrackerId),
  occurredAtIdx: index("vrm_rt_tech_outreach_occurred_idx").on(table.occurredAt),
}));

// ─── Repair Tracker — Shop Contact Log timeline (append-only) ─────────────────
export const vrmRepairTrackerShopContact = pgTable("vrm_repair_tracker_shop_contact", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  repairTrackerId: varchar("repair_tracker_id").notNull(),
  authorId: varchar("author_id", { length: 255 }),
  authorName: varchar("author_name", { length: 255 }),
  occurredAt: timestamp("occurred_at").defaultNow().notNull(),
  // Optional ETA update — when set, also writes vrm_repair_tracker.shop_eta_on_road.
  etaUpdate: date("eta_update"),
  // Optional cascading status updates (sourced from MAIN_STATUSES / SUB_STATUSES);
  // when set, also writes vrm_repair_tracker.main_status / sub_status.
  mainStatusUpdate: text("main_status_update"),
  subStatusUpdate: text("sub_status_update"),
  // Optional Van Status update; when set, also writes vrm_repair_tracker.tech_status.
  techStatusUpdate: varchar("tech_status_update", { length: 50 }),
  body: text("body"),
  revisedFromId: varchar("revised_from_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  trackerIdx: index("vrm_rt_shop_contact_tracker_idx").on(table.repairTrackerId),
  occurredAtIdx: index("vrm_rt_shop_contact_occurred_idx").on(table.occurredAt),
}));

export const vrmRepairTrackerActions = pgTable("vrm_repair_tracker_actions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  repairTrackerId: text("repair_tracker_id").notNull(),
  actionType: varchar("action_type", { length: 50 }).notNull(),
  notes: text("notes"),
  performedByName: varchar("performed_by_name", { length: 255 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  repairTrackerIdx: index("vrm_rt_actions_tracker_idx").on(table.repairTrackerId),
}));

export const insertVrmRepairTrackerSchema = createInsertSchema(vrmRepairTracker).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type VrmRepairTracker = typeof vrmRepairTracker.$inferSelect;
export type InsertVrmRepairTracker = z.infer<typeof insertVrmRepairTrackerSchema>;

export const insertVrmRepairTrackerActionSchema = createInsertSchema(vrmRepairTrackerActions).omit({
  id: true,
  createdAt: true,
});
export type VrmRepairTrackerAction = typeof vrmRepairTrackerActions.$inferSelect;
export type InsertVrmRepairTrackerAction = z.infer<typeof insertVrmRepairTrackerActionSchema>;

export const insertVrmRepairTrackerTechOutreachSchema = createInsertSchema(vrmRepairTrackerTechOutreach).omit({
  id: true,
  createdAt: true,
});
export type VrmRepairTrackerTechOutreach = typeof vrmRepairTrackerTechOutreach.$inferSelect;
export type InsertVrmRepairTrackerTechOutreach = z.infer<typeof insertVrmRepairTrackerTechOutreachSchema>;

export const insertVrmRepairTrackerShopContactSchema = createInsertSchema(vrmRepairTrackerShopContact).omit({
  id: true,
  createdAt: true,
});
export type VrmRepairTrackerShopContact = typeof vrmRepairTrackerShopContact.$inferSelect;
export type InsertVrmRepairTrackerShopContact = z.infer<typeof insertVrmRepairTrackerShopContactSchema>;

// ─── Rate Config ──────────────────────────────────────────────────────────────

export const vrmRateConfig = pgTable("vrm_rate_config", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: decimal("value", { precision: 10, scale: 2 }).notNull(),
  label: text("label").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedBy: varchar("updated_by", { length: 128 }),
});

export type VrmRateConfig = typeof vrmRateConfig.$inferSelect;
export const insertVrmRateConfigSchema = createInsertSchema(vrmRateConfig);
export type InsertVrmRateConfig = z.infer<typeof insertVrmRateConfigSchema>;

export const vrmRateConfigHistory = pgTable("vrm_rate_config_history", {
  id: serial("id").primaryKey(),
  key: varchar("key", { length: 64 }).notNull(),
  previousValue: decimal("previous_value", { precision: 10, scale: 2 }),
  newValue: decimal("new_value", { precision: 10, scale: 2 }).notNull(),
  changedBy: varchar("changed_by", { length: 128 }),
  changedAt: timestamp("changed_at").defaultNow().notNull(),
});

export type VrmRateConfigHistory = typeof vrmRateConfigHistory.$inferSelect;
export const insertVrmRateConfigHistorySchema = createInsertSchema(vrmRateConfigHistory).omit({ id: true, changedAt: true });

// ─── Profitability Snapshot Cache ─────────────────────────────────────────────

/**
 * One-row control table written by the daily profitability sync job.
 * status: 'building' while the sync is running, 'ready' on success, 'error' on abort.
 */
export const vrmProfitabilityCacheMeta = pgTable("vrm_profitability_cache_meta", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  status: varchar("status", { length: 20 }).notNull().default("building"),
  sourceSnowflakeLastAltered: timestamp("source_snowflake_last_altered"),
  lastSyncStartedAt: timestamp("last_sync_started_at"),
  lastSyncCompletedAt: timestamp("last_sync_completed_at"),
  rowCount: integer("row_count"),
  errorMessage: text("error_message"),
});

export const insertVrmProfitabilityCacheMetaSchema = createInsertSchema(vrmProfitabilityCacheMeta).omit({ id: true });
export type VrmProfitabilityCacheMeta = typeof vrmProfitabilityCacheMeta.$inferSelect;
export type InsertVrmProfitabilityCacheMeta = z.infer<typeof insertVrmProfitabilityCacheMetaSchema>;

/**
 * One row per TECH_LDAP — the settled 90-day profitability aggregate from Snowflake.
 * TRUNCATED and re-inserted atomically by the daily sync job.
 */
export const vrmProfitabilitySnapshot = pgTable("vrm_profitability_snapshot", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  techLdap: varchar("tech_ldap", { length: 50 }).notNull().unique(),
  techName: varchar("tech_name", { length: 255 }),
  tenureMonths: integer("tenure_months"),
  scorecardScore: decimal("scorecard_score", { precision: 8, scale: 3 }),
  completes: integer("completes"),
  totalSos: integer("total_sos"),
  workingDays: integer("working_days"),
  totalRevenue: decimal("total_revenue", { precision: 14, scale: 2 }),
  laborDirect: decimal("labor_direct", { precision: 14, scale: 2 }),
  laborBenefits: decimal("labor_benefits", { precision: 14, scale: 2 }),
  partsCogs: decimal("parts_cogs", { precision: 14, scale: 2 }),
  partsShipping: decimal("parts_shipping", { precision: 14, scale: 2 }),
  fuelEst: decimal("fuel_est", { precision: 14, scale: 2 }),
  lookbackDays: integer("lookback_days"),
  dailyRevenue: decimal("daily_revenue", { precision: 12, scale: 2 }),
  dailyCosts: decimal("daily_costs", { precision: 12, scale: 2 }),
  dailyNetBeforeRental: decimal("daily_net_before_rental", { precision: 12, scale: 2 }),
  dailyNetWithRental: decimal("daily_net_with_rental", { precision: 12, scale: 2 }),
  dailyPptProfit: decimal("daily_ppt_profit", { precision: 12, scale: 2 }),
  recommendation: varchar("recommendation", { length: 50 }),
  newHireExempt: boolean("new_hire_exempt").notNull().default(false),
  scorecardExempt: boolean("scorecard_exempt").notNull().default(false),
  // Roster-driven snapshot fields (NS_TECH_ACTIVE_ROSTER_DAILY_VW + COMTTU_TECH_UN supervisor join)
  emplStatus: varchar("empl_status", { length: 4 }),
  lastHireDate: date("last_hire_date"),
  lastDateWorked: date("last_date_worked"),
  expectedReturnDt: date("expected_return_dt"),
  supervisorName: varchar("supervisor_name", { length: 255 }),
  supervisorLdap: varchar("supervisor_ldap", { length: 50 }),
  // supervisorPhone / supervisorEmail are the EFFECTIVE values (override > TPMS)
  // — used by the notification dispatcher.
  supervisorPhone: varchar("supervisor_phone", { length: 50 }),
  supervisorEmail: varchar("supervisor_email", { length: 255 }),
  // supervisorTpmsPhone / supervisorTpmsEmail are the RAW TPMS COMTTU values
  // (no override applied) — used by the Settings UI to detect "missing in TPMS"
  // unambiguously regardless of whether an override has filled the gap.
  supervisorTpmsPhone: varchar("supervisor_tpms_phone", { length: 50 }),
  supervisorTpmsEmail: varchar("supervisor_tpms_email", { length: 255 }),
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
}, (table) => ({
  ldapIdx: index("vrm_profitability_snapshot_ldap_idx").on(table.techLdap),
}));

export const insertVrmProfitabilitySnapshotSchema = createInsertSchema(vrmProfitabilitySnapshot).omit({ id: true, syncedAt: true });
export type VrmProfitabilitySnapshot = typeof vrmProfitabilitySnapshot.$inferSelect;
export type InsertVrmProfitabilitySnapshot = z.infer<typeof insertVrmProfitabilitySnapshotSchema>;
export type InsertVrmRateConfigHistory = z.infer<typeof insertVrmRateConfigHistorySchema>;

// ─── Notifications (DENY-only SMS + email outbound) ───────────────────────────

export const vrmNotificationChannelEnum = pgEnum("vrm_notification_channel", [
  "sms",
  "email",
  // Tech-facing denial SMS — separate channel so it coexists with the
  // supervisor "sms" row for the same decision_id under the
  // UNIQUE(decision_id, channel) constraint.
  "sms_tech_deny",
]);

export const vrmNotificationStatusEnum = pgEnum("vrm_notification_status", [
  "queued",
  "sent",
  "delivered",
  "undelivered",
  "failed",
  "skipped",
]);

export const vrmNotifications = pgTable("vrm_notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  decisionId: varchar("decision_id").notNull().references(() => vrmRentalDecisions.id),
  channel: vrmNotificationChannelEnum("channel").notNull(),
  recipient: varchar("recipient", { length: 255 }),
  payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
  status: vrmNotificationStatusEnum("status").notNull().default("queued"),
  error: text("error"),
  twilioSid: varchar("twilio_sid", { length: 64 }),
  twilioErrorCode: varchar("twilio_error_code", { length: 16 }),
  // SMS phone audit (Fix #4 — Override-Overridden Visibility).
  // When the caller passed `techPhoneOverride` but it failed digit-match
  // against the trusted lookup, the dispatcher silently substitutes the
  // trusted number. Persist both forms so the UI can surface that a
  // "Number corrected" event happened.
  //   ui_displayed_phone  — the number the approver saw (passed as override)
  //   trusted_phone       — the number actually used as recipient
  //   override_overridden — TRUE iff a non-empty override was rejected
  uiDisplayedPhone: text("ui_displayed_phone"),
  trustedPhone: text("trusted_phone"),
  overrideOverridden: boolean("override_overridden").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  sentAt: timestamp("sent_at"),
}, (table) => ({
  decisionChannelUq: uniqueIndex("vrm_notifications_decision_channel_uq").on(table.decisionId, table.channel),
  statusIdx: index("vrm_notifications_status_idx").on(table.status),
  twilioSidIdx: index("vrm_notifications_twilio_sid_idx").on(table.twilioSid),
}));

export const insertVrmNotificationSchema = createInsertSchema(vrmNotifications).omit({ id: true, createdAt: true, sentAt: true });
export type VrmNotification = typeof vrmNotifications.$inferSelect;
export type InsertVrmNotification = z.infer<typeof insertVrmNotificationSchema>;

// ─── Supervisor Contact Overrides (phone + email; at least one required) ─────

export const vrmSupervisorContactOverrides = pgTable("vrm_supervisor_contact_overrides", {
  supervisorLdap: varchar("supervisor_ldap", { length: 50 }).primaryKey(),
  supervisorName: varchar("supervisor_name", { length: 255 }),
  overridePhone: varchar("override_phone", { length: 50 }),
  overrideEmail: varchar("override_email", { length: 255 }),
  notes: text("notes"),
  updatedBy: varchar("updated_by", { length: 255 }),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertVrmSupervisorContactOverrideSchema = createInsertSchema(vrmSupervisorContactOverrides).omit({ updatedAt: true });
export type VrmSupervisorContactOverride = typeof vrmSupervisorContactOverrides.$inferSelect;
export type InsertVrmSupervisorContactOverride = z.infer<typeof insertVrmSupervisorContactOverrideSchema>;

// ─── Notification Templates (Deny SMS + Email subject/body) ──────────────────
//
// Single key/value table — three rows: sms_template_deny,
// email_subject_template_deny, email_body_template_deny.  Bodies use
// {{token}} placeholders; the dispatcher renders them and falls back to
// the hard-coded defaults when a row is empty.
export const vrmNotificationTemplates = pgTable("vrm_notification_templates", {
  key: varchar("key", { length: 64 }).primaryKey(),
  body: text("body").notNull().default(""),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedBy: varchar("updated_by", { length: 128 }),
});

export type VrmNotificationTemplate = typeof vrmNotificationTemplates.$inferSelect;
export const insertVrmNotificationTemplateSchema = createInsertSchema(vrmNotificationTemplates).omit({ updatedAt: true });
export type InsertVrmNotificationTemplate = z.infer<typeof insertVrmNotificationTemplateSchema>;
