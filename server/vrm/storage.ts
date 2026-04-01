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
  vrmSmsTemplates,
  vrmTechNotes,
  vrmShopContactLog,
  type VrmTech,
  type InsertVrmTech,
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
    const [updated] = await db
      .update(vrmTechs)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(vrmTechs.ldap, data.ldap))
      .returning();
    return updated;
  }
  const [created] = await db.insert(vrmTechs).values(data).returning();
  return created;
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

// ─── SMS templates ────────────────────────────────────────────────────────────

export async function getSmsTemplates() {
  return db.select().from(vrmSmsTemplates).orderBy(vrmSmsTemplates.name);
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
  const [updated] = await db
    .update(vrmEscalations)
    .set({ ...data as any, updatedAt: new Date() })
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
