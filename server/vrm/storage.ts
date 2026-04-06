import { db } from "../db";
import { eq, and, ilike, or, desc, count, sql, ne, inArray } from "drizzle-orm";
import {
  vrmTechs,
  vrmTechStatusHistory,
  vrmOutreachLog,
  vrmEscalations,
  vrmExceptionCases,
  vrmReachabilityLog,
  vrmSmsMessages,
  vrmTechNotes,
  vrmShopContactLog,
  vrmRentalDecisions,
  vrmRentalDecisionActions,
  vrmRentalChecks,
  vrmNewRentalLog,
  vrmRepairTracker,
  type VrmTech,
  type InsertVrmTech,
  type InsertVrmRentalDecision,
  type InsertVrmRentalDecisionAction,
  type InsertVrmRentalCheck,
  type InsertVrmNewRentalLog,
  type InsertVrmRepairTracker,
} from "../../shared/vrm-schema";

// ─── Dashboard queries ────────────────────────────────────────────────────────

export interface TechListFilters {
  status?: string;
  market?: string;
  gateClass?: string;
  outreachStatus?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export async function listTechs(filters: TechListFilters = {}) {
  const { status, market, gateClass, search, page = 1, pageSize = 25 } = filters;
  const offset = (page - 1) * pageSize;

  const conditions: any[] = [];

  if (status && status !== "all") {
    conditions.push(eq(vrmTechs.currentStatus, status as any));
  }
  if (market && market !== "all") {
    conditions.push(eq(vrmTechs.market, market));
  }
  if (gateClass && gateClass !== "all") {
    conditions.push(eq(vrmTechs.gate1Classification, gateClass as any));
  }
  if (search) {
    conditions.push(
      or(
        ilike(vrmTechs.name, `%${search}%`),
        ilike(vrmTechs.ldap, `%${search}%`),
      )
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, totalResult] = await Promise.all([
    db
      .select()
      .from(vrmTechs)
      .where(where)
      .orderBy(desc(vrmTechs.statusUpdatedAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: count() })
      .from(vrmTechs)
      .where(where),
  ]);

  return { rows, total: totalResult[0]?.count ?? 0 };
}

export async function getDashboardStats() {
  const now = new Date();

  const [
    totalResult,
    exceptionResult,
    escalationResult,
    costResult,
  ] = await Promise.all([
    db.select({ count: count() }).from(vrmTechs)
      .where(ne(vrmTechs.currentStatus, "exempt_scorecard")),

    db.select({ count: count() }).from(vrmTechs)
      .where(or(
        eq(vrmTechs.currentStatus, "exception_paired"),
        eq(vrmTechs.currentStatus, "exception_home_learning"),
      )),

    db.select({ count: count() }).from(vrmEscalations)
      .where(eq(vrmEscalations.status, "pending_carl")),

    // Monthly cost avoided: days since status changed × $78 for all techs not in rental
    db.execute(sql`
      SELECT COALESCE(SUM(
        EXTRACT(EPOCH FROM (NOW() - status_updated_at)) / 86400 * 78
      ), 0)::INTEGER AS cost_avoided
      FROM vrm_techs
      WHERE current_status != 'in_rental'
    `),
  ]);

  // Overdue check-ins: exception cases missing today's reachability log
  const overdueResult = await db.execute(sql`
    SELECT COUNT(DISTINCT ec.id) AS overdue
    FROM vrm_exception_cases ec
    WHERE ec.status = 'active'
      AND ec.exception_type = 'home_learning'
      AND NOT EXISTS (
        SELECT 1 FROM vrm_reachability_log rl
        WHERE rl.exception_case_id = ec.id
          AND rl.log_date = CURRENT_DATE
      )
  `);

  return {
    totalTechsInScope: totalResult[0]?.count ?? 0,
    inExceptionWindow: exceptionResult[0]?.count ?? 0,
    activeEscalations: escalationResult[0]?.count ?? 0,
    overdueCheckIns: Number((overdueResult.rows[0] as any)?.overdue ?? 0),
    monthlyCostAvoided: Number((costResult.rows[0] as any)?.cost_avoided ?? 0),
  };
}

// ─── Auto-flag logic ──────────────────────────────────────────────────────────

export async function getAutoFlaggedTechIds(): Promise<Set<string>> {
  const flagged = new Set<string>();

  // 1. Missing today's reachability log for home-learning exception
  const missingReach = await db.execute(sql`
    SELECT DISTINCT t.id
    FROM vrm_techs t
    JOIN vrm_exception_cases ec ON ec.tech_id = t.id
    WHERE ec.status = 'active'
      AND ec.exception_type = 'home_learning'
      AND NOT EXISTS (
        SELECT 1 FROM vrm_reachability_log rl
        WHERE rl.exception_case_id = ec.id
          AND rl.log_date = CURRENT_DATE
      )
  `);
  for (const row of missingReach.rows) flagged.add((row as any).id);

  // 2. Exception cases approaching 60 days (>= 55 days)
  const approaching60 = await db.execute(sql`
    SELECT DISTINCT t.id
    FROM vrm_techs t
    JOIN vrm_exception_cases ec ON ec.tech_id = t.id
    WHERE ec.status NOT IN ('closed')
      AND CURRENT_DATE - ec.open_date::DATE >= 55
  `);
  for (const row of approaching60.rows) flagged.add((row as any).id);

  // 3. Pending escalations
  const pendingEsc = await db.execute(sql`
    SELECT DISTINCT tech_id AS id FROM vrm_escalations
    WHERE status = 'pending_carl'
  `);
  for (const row of pendingEsc.rows) flagged.add((row as any).id);

  return flagged;
}

// ─── Individual tech ──────────────────────────────────────────────────────────

export async function getTechById(id: string) {
  const rows = await db.select().from(vrmTechs).where(eq(vrmTechs.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getTechByLdap(ldap: string) {
  const rows = await db.select().from(vrmTechs).where(eq(vrmTechs.ldap, ldap)).limit(1);
  return rows[0] ?? null;
}

export async function upsertTech(data: InsertVrmTech): Promise<VrmTech> {
  const existing = await getTechByLdap(data.ldap);
  if (existing) {
    // Preserve manual tracking fields — never overwrite from sync
    const merged = {
      ...data,
      outreachFlagged: data.outreachFlagged ?? existing.outreachFlagged,
      returnedRental: data.returnedRental ?? existing.returnedRental,
      escalationPath: data.escalationPath ?? existing.escalationPath,
      updatedAt: new Date(),
    };
    const [updated] = await db
      .update(vrmTechs)
      .set(merged)
      .where(eq(vrmTechs.ldap, data.ldap))
      .returning();
    return updated;
  }
  const [created] = await db.insert(vrmTechs).values(data).returning();
  return created;
}

export async function getTechDetail(id: string) {
  return getTechById(id);
}

export async function updateTechStatus(
  techId: string,
  newStatus: string,
  changedByName: string,
  reason?: string,
) {
  const tech = await getTechById(techId);
  if (!tech) throw new Error(`Tech ${techId} not found`);

  await db.update(vrmTechs)
    .set({ currentStatus: newStatus as any, statusUpdatedAt: new Date(), updatedAt: new Date() })
    .where(eq(vrmTechs.id, techId));

  // Append-only history record
  await db.insert(vrmTechStatusHistory).values({
    techId,
    previousStatus: tech.currentStatus,
    newStatus,
    changedByName,
    reason,
  });
}

// ─── Outreach log ─────────────────────────────────────────────────────────────

export async function getOutreachLog(techId: string) {
  return db
    .select()
    .from(vrmOutreachLog)
    .where(eq(vrmOutreachLog.techId, techId))
    .orderBy(desc(vrmOutreachLog.createdAt));
}

export async function addOutreachEntry(data: {
  techId: string;
  actionType: string;
  outcome?: string;
  notes?: string;
  performedByName?: string;
}) {
  const [entry] = await db
    .insert(vrmOutreachLog)
    .values({
      techId: data.techId,
      actionType: data.actionType as any,
      outcome: data.outcome,
      notes: data.notes,
      performedByName: data.performedByName,
    })
    .returning();
  return entry;
}

// ─── Status history ───────────────────────────────────────────────────────────

export async function getStatusHistory(techId: string) {
  return db
    .select()
    .from(vrmTechStatusHistory)
    .where(eq(vrmTechStatusHistory.techId, techId))
    .orderBy(desc(vrmTechStatusHistory.createdAt));
}

// ─── Notes ────────────────────────────────────────────────────────────────────

export async function getTechNotes(techId: string) {
  return db
    .select()
    .from(vrmTechNotes)
    .where(eq(vrmTechNotes.techId, techId))
    .orderBy(desc(vrmTechNotes.createdAt));
}

export async function addTechNote(techId: string, noteText: string, authorName?: string) {
  const [note] = await db
    .insert(vrmTechNotes)
    .values({ techId, noteText, authorName })
    .returning();
  return note;
}

// ─── Exception cases ──────────────────────────────────────────────────────────

export async function getExceptionCase(techId: string) {
  const rows = await db
    .select()
    .from(vrmExceptionCases)
    .where(and(eq(vrmExceptionCases.techId, techId), ne(vrmExceptionCases.status, "closed")))
    .orderBy(desc(vrmExceptionCases.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function getReachabilityLog(exceptionCaseId: string) {
  return db
    .select()
    .from(vrmReachabilityLog)
    .where(eq(vrmReachabilityLog.exceptionCaseId, exceptionCaseId))
    .orderBy(desc(vrmReachabilityLog.logDate));
}

// ─── Shop contact log ─────────────────────────────────────────────────────────

export async function getShopContactLog(techId: string) {
  return db
    .select()
    .from(vrmShopContactLog)
    .where(eq(vrmShopContactLog.techId, techId))
    .orderBy(desc(vrmShopContactLog.createdAt));
}

// ─── DCA Review ───────────────────────────────────────────────────────────────

export async function getDcaReviewQueue(market?: string) {
  const conditions: any[] = [
    inArray(vrmTechs.dcaReviewOutcome, ["pending", "cleared", "hold", "escalate"] as any),
  ];
  if (market && market !== "all") {
    conditions.push(eq(vrmTechs.market, market));
  }
  return db
    .select()
    .from(vrmTechs)
    .where(and(...conditions))
    .orderBy(vrmTechs.dcaReviewOutcome, desc(vrmTechs.updatedAt));
}

export async function setDcaOutcome(
  techId: string,
  outcome: "cleared" | "hold" | "escalate" | undefined,
  notes?: string,
  changedByName?: string,
) {
  const updatePayload: Record<string, any> = { updatedAt: new Date() };
  if (outcome) { updatePayload.dcaReviewOutcome = outcome; updatePayload.dcaReviewDate = new Date(); }
  if (notes !== undefined) updatePayload.dcaReviewNotes = notes;

  await db.update(vrmTechs).set(updatePayload).where(eq(vrmTechs.id, techId));

  if (outcome === "escalate" && changedByName) {
    await db.insert(vrmOutreachLog).values({
      techId,
      actionType: "carl_escalated",
      notes: notes ?? "Escalated during DCA review",
      performedByName: changedByName,
    });
  }
}

// ─── Escalations ─────────────────────────────────────────────────────────────

export async function listEscalations() {
  return db
    .select()
    .from(vrmEscalations)
    .orderBy(desc(vrmEscalations.createdAt));
}

export async function getEscalationsWithTech() {
  return db
    .select({
      escalation: vrmEscalations,
      tech: vrmTechs,
    })
    .from(vrmEscalations)
    .innerJoin(vrmTechs, eq(vrmEscalations.techId, vrmTechs.id))
    .orderBy(desc(vrmEscalations.createdAt));
}

export async function createEscalation(data: {
  techId: string;
  triggeredByName?: string;
  reason?: string;
  priorOutreachSummary?: string;
}) {
  const [esc] = await db.insert(vrmEscalations).values(data).returning();
  await updateTechStatus(data.techId, "escalated_carl", data.triggeredByName ?? "system", data.reason);
  return esc;
}

export async function updateEscalation(
  escalationId: string,
  data: { carlOutcomeNotes?: string; status?: string },
) {
  const setValues: Record<string, any> = { updatedAt: new Date() };
  if (data.carlOutcomeNotes !== undefined) setValues.carlOutcomeNotes = data.carlOutcomeNotes;
  if (data.status !== undefined) setValues.status = data.status;

  const [updated] = await db
    .update(vrmEscalations)
    .set(setValues)
    .where(eq(vrmEscalations.id, escalationId))
    .returning();
  return updated;
}

export async function confirmEpv(escalationId: string, techId: string) {
  const today = new Date().toISOString().split("T")[0];
  await db.update(vrmEscalations)
    .set({
      epvConfirmed: true,
      epvConfirmedAt: new Date(),
      rentalStopDate: today,
      status: "epv_required",
      updatedAt: new Date(),
    })
    .where(eq(vrmEscalations.id, escalationId));
  await updateTechStatus(techId, "epv_issued", "system", "EPV confirmed");
}

// ─── Rental decisions ────────────────────────────────────────────────────────

export async function addRentalDecision(data: InsertVrmRentalDecision) {
  const [row] = await db.insert(vrmRentalDecisions).values(data).returning();
  return row;
}

export async function listRentalDecisions(limit = 50) {
  return db
    .select()
    .from(vrmRentalDecisions)
    .orderBy(desc(vrmRentalDecisions.createdAt))
    .limit(limit);
}

export async function getRentalDecision(id: string) {
  const [row] = await db
    .select()
    .from(vrmRentalDecisions)
    .where(eq(vrmRentalDecisions.id, id))
    .limit(1);
  return row ?? null;
}

export async function updateRentalDecision(
  id: string,
  data: Partial<Pick<
    typeof vrmRentalDecisions.$inferSelect,
    "smsSentAt" | "smsResponseStatus" | "byovEnrolled" | "returnedRental" | "rentalReturnDate"
  >>,
) {
  const [row] = await db
    .update(vrmRentalDecisions)
    .set(data)
    .where(eq(vrmRentalDecisions.id, id))
    .returning();
  return row;
}

export async function addRentalDecisionAction(data: InsertVrmRentalDecisionAction) {
  const [row] = await db.insert(vrmRentalDecisionActions).values(data).returning();
  return row;
}

export async function listRentalDecisionActions(decisionId: string) {
  return db
    .select()
    .from(vrmRentalDecisionActions)
    .where(eq(vrmRentalDecisionActions.decisionId, decisionId))
    .orderBy(vrmRentalDecisionActions.createdAt);
}

export async function addRentalChecks(rows: InsertVrmRentalCheck[]) {
  if (!rows.length) return [];
  return db.insert(vrmRentalChecks).values(rows).returning();
}

export async function listRentalChecks(limit = 100) {
  return db
    .select()
    .from(vrmRentalChecks)
    .orderBy(desc(vrmRentalChecks.checkedAt))
    .limit(limit);
}

// ─── New Rental Log ───────────────────────────────────────────────────────────

export async function listNewRentalLog() {
  return db
    .select()
    .from(vrmNewRentalLog)
    .orderBy(desc(vrmNewRentalLog.createdAt));
}

export async function createNewRentalLogEntry(data: InsertVrmNewRentalLog) {
  const [row] = await db.insert(vrmNewRentalLog).values(data).returning();
  return row;
}

export async function bulkCreateNewRentalLogEntries(rows: InsertVrmNewRentalLog[]) {
  if (!rows.length) return [];
  return db.insert(vrmNewRentalLog).values(rows).returning();
}

export async function updateNewRentalLogEntry(
  id: string,
  data: Partial<InsertVrmNewRentalLog>,
) {
  const [row] = await db
    .update(vrmNewRentalLog)
    .set(data)
    .where(eq(vrmNewRentalLog.id, id))
    .returning();
  return row;
}

export async function deleteNewRentalLogEntry(id: string) {
  await db.delete(vrmNewRentalLog).where(eq(vrmNewRentalLog.id, id));
}

// ─── Repair Tracker ──────────────────────────────────────────────────────────

export async function listRepairTracker() {
  return db.select().from(vrmRepairTracker).orderBy(desc(vrmRepairTracker.createdAt));
}

export async function createRepairTrackerEntry(data: InsertVrmRepairTracker) {
  const [row] = await db.insert(vrmRepairTracker).values(data).returning();
  return row;
}

/**
 * Backfill truck_number on any repair tracker row that has a tech_ldap
 * but no truck number, by joining against the TPMS tech profiles cache.
 */
export async function backfillRepairTrackerTruckNumbers(): Promise<number> {
  const result = await db.execute(sql`
    UPDATE vrm_repair_tracker rt
    SET
      truck_number = COALESCE(NULLIF(rt.truck_number, ''), tp.truck_no),
      tech_phone   = COALESCE(NULLIF(rt.tech_phone,   ''), tp.mobile_phone)
    FROM tpms_tech_profiles tp
    WHERE UPPER(tp.enterprise_id) = UPPER(rt.tech_ldap)
      AND rt.tech_ldap IS NOT NULL
      AND (
        rt.truck_number IS NULL OR rt.truck_number = '' OR
        rt.tech_phone   IS NULL OR rt.tech_phone   = ''
      )
  `);
  return (result as any).rowCount ?? 0;
}

export async function importDeniedToRepairTracker(): Promise<{ imported: number; skipped: number }> {
  // Fetch denied from both sources
  const [deniedDecisions, deniedChecks] = await Promise.all([
    db.select().from(vrmRentalDecisions).where(sql`LOWER(${vrmRentalDecisions.recommendation}) = 'deny'`),
    db.select().from(vrmRentalChecks).where(sql`LOWER(${vrmRentalChecks.recommendation}) = 'deny'`),
  ]);

  // Fetch everything already in the repair tracker for dedup
  const [existingRows, fullLogRows] = await Promise.all([
    db
      .select({
        sourceDecisionId: vrmRepairTracker.sourceDecisionId,
        sourceCheckId: vrmRepairTracker.sourceCheckId,
        techLdap: vrmRepairTracker.techLdap,
      })
      .from(vrmRepairTracker),
    // Also grab enterprise IDs already present in the Full Log so we never
    // add a tech to the Repair Tracker if they are already in the Full Log
    db.select({ enterpriseId: vrmNewRentalLog.enterpriseId }).from(vrmNewRentalLog),
  ]);

  const existingDecisionIds = new Set(existingRows.map((r) => r.sourceDecisionId).filter(Boolean) as string[]);
  const existingCheckIds = new Set(existingRows.map((r) => r.sourceCheckId).filter(Boolean) as string[]);
  const existingLdaps = new Set(
    existingRows.map((r) => (r.techLdap ?? "").toUpperCase()).filter(Boolean),
  );

  // LDAPs already in the Full Log — skip these on import
  const fullLogLdaps = new Set(
    fullLogRows.map((r) => (r.enterpriseId ?? "").toUpperCase()).filter(Boolean),
  );

  const isAlreadyInFullLog = (ldap: string | null | undefined) =>
    fullLogLdaps.has((ldap ?? "").toUpperCase());

  // Filter decisions: not already imported by ID, ldap not already in tracker, and not in Full Log
  const newDecisions = deniedDecisions.filter(
    (d) =>
      !existingDecisionIds.has(d.id) &&
      !existingLdaps.has((d.techLdap ?? "").toUpperCase()) &&
      !isAlreadyInFullLog(d.techLdap),
  );

  // Collect the ldaps being added from decisions to prevent duplicate tech from check history
  const addingLdaps = new Set(newDecisions.map((d) => (d.techLdap ?? "").toUpperCase()).filter(Boolean));

  // Filter checks: not already imported by ID, ldap not in tracker or being added from decisions, not in Full Log
  // Use most recent check per ldap to avoid duplicates within the check table itself
  const latestCheckByLdap = new Map<string, typeof deniedChecks[number]>();
  for (const c of deniedChecks) {
    const ldap = (c.techLdap ?? "").toUpperCase();
    if (!ldap) continue;
    const prev = latestCheckByLdap.get(ldap);
    if (!prev || c.checkedAt > prev.checkedAt) latestCheckByLdap.set(ldap, c);
  }
  const newChecks = [...latestCheckByLdap.values()].filter(
    (c) =>
      !existingCheckIds.has(c.id) &&
      !existingLdaps.has((c.techLdap ?? "").toUpperCase()) &&
      !addingLdaps.has((c.techLdap ?? "").toUpperCase()) &&
      !isAlreadyInFullLog(c.techLdap),
  );

  const totalNew = newDecisions.length + newChecks.length;
  const totalSkipped = (deniedDecisions.length - newDecisions.length) + (deniedChecks.length - newChecks.length);

  if (totalNew === 0) return { imported: 0, skipped: totalSkipped };

  // Look up truck numbers from TPMS for all LDAPs being inserted
  const allNewLdaps = [
    ...newDecisions.map((d) => (d.techLdap ?? "").toUpperCase()),
    ...newChecks.map((c) => (c.techLdap ?? "").toUpperCase()),
  ].filter(Boolean);

  const tpmsRows = allNewLdaps.length
    ? await db.execute(sql`
        SELECT UPPER(enterprise_id) AS ldap, truck_no, mobile_phone
        FROM tpms_tech_profiles
        WHERE UPPER(enterprise_id) = ANY(${allNewLdaps})
      `)
    : { rows: [] };

  const truckByLdap = new Map<string, string>(
    ((tpmsRows as any).rows ?? []).map((r: any) => [r.ldap as string, r.truck_no as string]),
  );
  const phoneByLdap = new Map<string, string>(
    ((tpmsRows as any).rows ?? []).map((r: any) => [r.ldap as string, r.mobile_phone as string]),
  );

  const rows: InsertVrmRepairTracker[] = [
    ...newDecisions.map((d) => ({
      techLdap: d.techLdap,
      techName: d.techName ?? d.techLdap ?? "Unknown",
      truckNumber: truckByLdap.get((d.techLdap ?? "").toUpperCase()) ?? null,
      techPhone: phoneByLdap.get((d.techLdap ?? "").toUpperCase()) ?? null,
      mainStatus: "Decision Pending",
      recommendation: d.recommendation,
      deniedAt: d.createdAt,
      sourceDecisionId: d.id,
    })),
    ...newChecks.map((c) => ({
      techLdap: c.techLdap,
      techName: c.techName ?? c.techLdap ?? "Unknown",
      truckNumber: truckByLdap.get((c.techLdap ?? "").toUpperCase()) ?? null,
      techPhone: phoneByLdap.get((c.techLdap ?? "").toUpperCase()) ?? null,
      mainStatus: "Decision Pending",
      recommendation: c.recommendation,
      deniedAt: c.checkedAt,
      sourceCheckId: c.id,
    })),
  ];

  await db.insert(vrmRepairTracker).values(rows);

  // Also backfill any existing rows that were imported without a truck number
  await backfillRepairTrackerTruckNumbers();

  return { imported: totalNew, skipped: totalSkipped };
}

export async function updateRepairTrackerEntry(id: string, data: Partial<InsertVrmRepairTracker>) {
  const [row] = await db
    .update(vrmRepairTracker)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(vrmRepairTracker.id, id))
    .returning();
  return row ?? null;
}

export async function deleteRepairTrackerEntry(id: string) {
  await db.delete(vrmRepairTracker).where(eq(vrmRepairTracker.id, id));
}
