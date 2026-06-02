/**
 * LOA Recovery Sync Service (Task #427)
 *
 * Pulls the active continuous-leave roster from the external Reports API,
 * cross-checks it against Snowflake `DRIVELINE_ALL_TECHS` (employment_status
 * L/P), filters to leaves >= 30 days, persists a snapshot row per qualifying
 * tech, and drives the LOA Recovery queue lane.
 *
 * For each *new* qualifying tech (no open LOA Recovery workflow yet), creates
 * three `queue_items` — FLEET (vehicle), Assets Management (tools), Inventory
 * Control (parts) — sharing one `workflowId` per (enterprise_id, leave start).
 *
 * For each tech who *previously* triggered LOA Recovery but no longer appears
 * (or whose days dropped below 30), any of their still-open LOA Recovery
 * items are cancelled with `metadata.cancelled_reason = 'tech_returned_from_loa'`.
 *
 * Runs on app startup (after TPMS snapshot bootstrap) and again on the
 * existing 7:30 AM ET Tech Data Scheduler immediately after
 * `refreshTpmsExtractSnapshot()` — see wiring in `server/fleet-scope-routes.ts`.
 */
import { db } from "./db";
import { queueItems, allTechs, loaRecoverySnapshot } from "@shared/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getTpmsContact } from "./tpms-extract-snapshot";
import { storage } from "./storage";

const LEAVES_ENDPOINT =
  "https://employee-search-db-leslieellis.replit.app/api/reports/active-continuous-leaves";

const WORKFLOW_TYPE = "loa_recovery";
const SYSTEM_REQUESTER_ID = "system:loa_recovery";
const MIN_DAYS = 30;
const FETCH_TIMEOUT_MS = 30_000;

/**
 * Ensure the `loa_recovery_snapshot` table (and its two indexes) exist.
 *
 * This table is defined in `shared/schema.ts` but is part of the main Drizzle
 * schema, which is normally applied via `drizzle-kit push`. Because
 * `drizzle-kit push` can conflict with the externally-managed `fs_*` tables
 * (see replit.md gotcha), we create this single table idempotently with raw
 * SQL at the start of every sync run — mirroring the `initFleetScopeSchema()`
 * / `initVrmSchema()` startup pattern. Without this, the sync crashes with
 * `relation "loa_recovery_snapshot" does not exist` before any queue items are
 * created, so LOA Recovery cases never appear in any queue.
 */
async function ensureLoaRecoverySchema(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "loa_recovery_snapshot" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "enterprise_id" varchar(20) NOT NULL,
      "employee_number" varchar(20),
      "sf_status" varchar(5),
      "start_date" date,
      "end_date" date,
      "days" integer NOT NULL,
      "source" varchar(16) NOT NULL,
      "synced_at" timestamp DEFAULT now() NOT NULL
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "loa_recovery_snapshot_enterprise_id_idx"
      ON "loa_recovery_snapshot" ("enterprise_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "loa_recovery_snapshot_synced_at_idx"
      ON "loa_recovery_snapshot" ("synced_at");
  `);
}

type ApiLeaveRow = {
  enterprise_id?: string | null;
  employee_number?: string | number | null;
  start_date?: string | null;
  end_date?: string | null;
  days?: number | string | null;
  leave_type?: string | null;
};

type ParsedLeave = {
  enterpriseId: string;
  employeeNumber: string | null;
  startDate: string | null; // YYYY-MM-DD
  endDate: string | null;   // YYYY-MM-DD
  days: number;
};

export type LoaRecoveryRunResult = {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  apiRowCount: number;
  continuousCount: number;
  dedupedCount: number;
  qualifyingCount: number;
  snowflakeMismatchCount: number;
  snowflakeMismatches: Array<{ enterpriseId: string; reason: string }>;
  queueItemsCreated: number;
  queueItemsCancelled: number;
  workflowsCreated: number;
  workflowsCancelled: number;
  error?: string;
};

let lastRunResult: LoaRecoveryRunResult | null = null;

export function getLastLoaRecoveryRunResult(): LoaRecoveryRunResult | null {
  return lastRunResult;
}

const norm = (v: unknown): string => String(v ?? "").trim().toUpperCase();

function workflowIdFor(enterpriseId: string, startDate: string | null): string {
  return `loa-${enterpriseId}-${startDate || "unknown"}`;
}

async function fetchLeavesFromApi(): Promise<ApiLeaveRow[]> {
  const apiKey = process.env.REPORTS_API_KEY;
  if (!apiKey) {
    throw new Error("REPORTS_API_KEY not configured");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(LEAVES_ENDPOINT, {
      method: "GET",
      headers: { "X-API-Key": apiKey, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`Reports API ${resp.status}: ${body.slice(0, 300)}`);
    }
    const payload = await resp.json();
    // Tolerate either {data: [...]} or a bare array.
    const rows: ApiLeaveRow[] = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.leaves)
      ? payload.leaves
      : [];
    return rows;
  } finally {
    clearTimeout(timeout);
  }
}

function parseDateStr(v: unknown): string | null {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  // Accept YYYY-MM-DD or ISO timestamp — keep just the date portion.
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function parseRow(row: ApiLeaveRow): ParsedLeave | null {
  const ent = norm(row.enterprise_id);
  if (!ent) return null;
  const daysNum =
    typeof row.days === "number" ? row.days : Number(row.days ?? NaN);
  if (!Number.isFinite(daysNum)) return null;
  return {
    enterpriseId: ent,
    employeeNumber:
      row.employee_number != null ? String(row.employee_number).trim() : null,
    startDate: parseDateStr(row.start_date),
    endDate: parseDateStr(row.end_date),
    days: Math.trunc(daysNum),
  };
}

/**
 * Dedupe by enterprise_id: keep largest `days`; break ties with latest
 * `end_date`.
 */
function dedupe(rows: ParsedLeave[]): ParsedLeave[] {
  const best = new Map<string, ParsedLeave>();
  for (const r of rows) {
    const prev = best.get(r.enterpriseId);
    if (!prev) {
      best.set(r.enterpriseId, r);
      continue;
    }
    if (r.days > prev.days) {
      best.set(r.enterpriseId, r);
    } else if (r.days === prev.days) {
      const a = r.endDate || "";
      const b = prev.endDate || "";
      if (a > b) best.set(r.enterpriseId, r);
    }
  }
  return Array.from(best.values());
}

export async function runLoaRecoverySync(
  triggeredBy: "scheduler" | "startup" | "manual" = "manual",
): Promise<LoaRecoveryRunResult> {
  const startedAt = new Date();
  const result: LoaRecoveryRunResult = {
    ok: false,
    startedAt: startedAt.toISOString(),
    finishedAt: startedAt.toISOString(),
    apiRowCount: 0,
    continuousCount: 0,
    dedupedCount: 0,
    qualifyingCount: 0,
    snowflakeMismatchCount: 0,
    snowflakeMismatches: [],
    queueItemsCreated: 0,
    queueItemsCancelled: 0,
    workflowsCreated: 0,
    workflowsCancelled: 0,
  };

  let syncLogId: string | null = null;
  try {
    // Make sure the snapshot table exists before any reads/writes touch it.
    await ensureLoaRecoverySchema();

    const log = await storage.createSyncLog({
      syncType: "loa_recovery",
      status: "running",
      triggeredBy,
    });
    syncLogId = log.id;
  } catch (e: any) {
    console.warn("[LoaRecovery] createSyncLog failed (continuing):", e?.message || e);
  }

  try {
    // 1. Fetch API
    const apiRows = await fetchLeavesFromApi();
    result.apiRowCount = apiRows.length;

    // 2. Filter to leave_type=Continuous, then parse
    const continuousRows = apiRows.filter(
      (r) => String(r.leave_type ?? "").trim().toLowerCase() === "continuous",
    );
    result.continuousCount = continuousRows.length;
    const parsed = continuousRows
      .map(parseRow)
      .filter((x): x is ParsedLeave => x !== null);

    // 3. Dedupe by enterprise_id
    const deduped = dedupe(parsed);
    result.dedupedCount = deduped.length;

    // 4. Cross-check against DRIVELINE_ALL_TECHS (employment_status L/P).
    //    `all_techs` mirrors that view via the existing Snowflake sync.
    const entIds = deduped.map((r) => r.enterpriseId);
    const sfMap = new Map<string, string | null>();
    if (entIds.length > 0) {
      const rows = await db
        .select({
          ent: allTechs.techRacfid,
          status: allTechs.employmentStatus,
        })
        .from(allTechs)
        .where(inArray(allTechs.techRacfid, entIds));
      for (const r of rows) {
        sfMap.set(norm(r.ent), r.status || null);
      }
    }

    // 5. Filter to days >= 30; record SF mismatches but do NOT exclude from
    //    inclusion (API is source of truth per spec).
    const qualifying: Array<ParsedLeave & { sfStatus: string | null }> = [];
    for (const row of deduped) {
      const sfStatus = sfMap.get(row.enterpriseId) ?? null;
      const inSf = sfMap.has(row.enterpriseId);
      const onLeavePerSf =
        sfStatus === "L" || sfStatus === "P";
      if (!inSf) {
        result.snowflakeMismatches.push({
          enterpriseId: row.enterpriseId,
          reason: "not_in_driveline_all_techs",
        });
      } else if (!onLeavePerSf) {
        result.snowflakeMismatches.push({
          enterpriseId: row.enterpriseId,
          reason: `sf_status_${sfStatus || "null"}`,
        });
      }
      if (row.days >= MIN_DAYS) {
        qualifying.push({ ...row, sfStatus });
      }
    }
    result.snowflakeMismatchCount = result.snowflakeMismatches.length;
    result.qualifyingCount = qualifying.length;

    // 6. Persist snapshot rows (one per qualifying tech per sync run).
    if (qualifying.length > 0) {
      await db.insert(loaRecoverySnapshot).values(
        qualifying.map((q) => ({
          enterpriseId: q.enterpriseId,
          employeeNumber: q.employeeNumber,
          sfStatus: q.sfStatus,
          startDate: q.startDate,
          endDate: q.endDate,
          days: q.days,
          source: "api" as const,
        })),
      );
    }

    // 7. Idempotency: find existing open LOA Recovery workflowIds.
    const openExisting = await db
      .select({
        workflowId: queueItems.workflowId,
        enterpriseId: sql<string>`(${queueItems.data}::jsonb->>'enterpriseId')`,
      })
      .from(queueItems)
      .where(
        and(
          eq(queueItems.workflowType, WORKFLOW_TYPE),
          inArray(queueItems.status, ["pending", "in_progress"]),
        ),
      );
    const openWorkflowIds = new Set<string>();
    const openByEnterprise = new Map<string, Set<string>>();
    for (const r of openExisting) {
      if (r.workflowId) openWorkflowIds.add(r.workflowId);
      const ent = norm(r.enterpriseId);
      if (ent) {
        if (!openByEnterprise.has(ent)) openByEnterprise.set(ent, new Set());
        if (r.workflowId) openByEnterprise.get(ent)!.add(r.workflowId);
      }
    }

    // 8. Create the 3 queue items for each qualifying tech whose workflowId
    //    doesn't already have open items.
    const qualifyingEnterpriseIds = new Set<string>(
      qualifying.map((q) => q.enterpriseId),
    );
    for (const q of qualifying) {
      const wfId = workflowIdFor(q.enterpriseId, q.startDate);
      if (openWorkflowIds.has(wfId)) continue; // already open
      const created = await createLoaRecoveryWorkflow(q, wfId);
      result.queueItemsCreated += created;
      if (created > 0) result.workflowsCreated += 1;
    }

    // 9. Auto-cancel: for any open workflow whose enterprise_id is NOT in the
    //    current qualifying set, cancel all of its open items.
    const workflowsToCancel = new Set<string>();
    openByEnterprise.forEach((wfIds, ent) => {
      if (!qualifyingEnterpriseIds.has(ent)) {
        wfIds.forEach((wfId) => workflowsToCancel.add(wfId));
      }
    });
    if (workflowsToCancel.size > 0) {
      const cancelled = await cancelOpenLoaWorkflows(
        Array.from(workflowsToCancel),
      );
      result.queueItemsCancelled = cancelled;
      result.workflowsCancelled = workflowsToCancel.size;
    }

    result.ok = true;
  } catch (err: any) {
    result.error = err?.message || String(err);
    console.error("[LoaRecovery] Sync failed:", result.error);
  } finally {
    const finishedAt = new Date();
    result.finishedAt = finishedAt.toISOString();
    lastRunResult = result;
    if (syncLogId) {
      try {
        await storage.updateSyncLog(syncLogId, {
          status: result.ok ? "completed" : "failed",
          completedAt: finishedAt,
          recordsProcessed: result.qualifyingCount,
          queueItemsCreated: result.queueItemsCreated,
          errorMessage: result.error || null,
        });
      } catch (e: any) {
        console.warn("[LoaRecovery] updateSyncLog failed:", e?.message || e);
      }
    }
    console.log(
      `[LoaRecovery] trigger=${triggeredBy} ok=${result.ok} ` +
        `api=${result.apiRowCount} continuous=${result.continuousCount} ` +
        `deduped=${result.dedupedCount} qualifying=${result.qualifyingCount} ` +
        `sfMismatch=${result.snowflakeMismatchCount} ` +
        `created=${result.queueItemsCreated} (workflows=${result.workflowsCreated}) ` +
        `cancelled=${result.queueItemsCancelled} (workflows=${result.workflowsCancelled})` +
        (result.error ? ` error=${result.error}` : ""),
    );
  }

  return result;
}

async function createLoaRecoveryWorkflow(
  q: ParsedLeave & { sfStatus: string | null },
  workflowId: string,
): Promise<number> {
  const tpms = getTpmsContact(q.enterpriseId);
  const techName = tpms?.fullName || q.enterpriseId;
  const lastKnownTruck = tpms?.truckLu || null;
  const phone = tpms?.mobilePhone || null;
  const primaryZip = tpms?.primaryZip || null;

  // Best-effort address from all_techs (TPMS extract only has zip).
  let address: {
    homeAddr1: string | null;
    homeAddr2: string | null;
    homeCity: string | null;
    homeState: string | null;
    homePostal: string | null;
  } | null = null;
  try {
    const rows = await db
      .select({
        homeAddr1: allTechs.homeAddr1,
        homeAddr2: allTechs.homeAddr2,
        homeCity: allTechs.homeCity,
        homeState: allTechs.homeState,
        homePostal: allTechs.homePostal,
      })
      .from(allTechs)
      .where(eq(allTechs.techRacfid, q.enterpriseId))
      .limit(1);
    address = rows[0] || null;
  } catch {
    address = null;
  }

  const sharedData = {
    enterpriseId: q.enterpriseId,
    employeeNumber: q.employeeNumber,
    techName,
    leave: {
      startDate: q.startDate,
      endDate: q.endDate,
      days: q.days,
      sfStatus: q.sfStatus,
    },
    tech: {
      lastKnownTruck,
      phone,
      primaryZip,
      address,
    },
  };

  const baseMetadata = {
    workflowType: WORKFLOW_TYPE,
    enterpriseId: q.enterpriseId,
    leaveStartDate: q.startDate,
    leaveEndDate: q.endDate,
    leaveDays: q.days,
  };

  const lanes: Array<{
    title: string;
    description: string;
    department: "FLEET" | "Assets Management" | "Inventory Control";
    step: number;
    creator: (item: any) => Promise<any>;
  }> = [
    {
      title: `LOA Recovery — Vehicle (${techName})`,
      description: `Recover assigned vehicle from ${techName} (${q.enterpriseId}). On continuous leave ${q.days} days (started ${q.startDate || "unknown"}).`,
      department: "FLEET",
      step: 1,
      creator: (item) => storage.createFleetQueueItem(item),
    },
    {
      title: `LOA Recovery — Tools (${techName})`,
      description: `Recover company tools from ${techName} (${q.enterpriseId}). On continuous leave ${q.days} days (started ${q.startDate || "unknown"}).`,
      department: "Assets Management",
      step: 2,
      creator: (item) => storage.createAssetsQueueItem(item),
    },
    {
      title: `LOA Recovery — Parts (${techName})`,
      description: `Recover parts inventory from ${techName} (${q.enterpriseId}). On continuous leave ${q.days} days (started ${q.startDate || "unknown"}).`,
      department: "Inventory Control",
      step: 3,
      creator: (item) => storage.createInventoryQueueItem(item),
    },
  ];

  let created = 0;
  for (const lane of lanes) {
    try {
      await lane.creator({
        workflowType: WORKFLOW_TYPE,
        title: lane.title,
        description: lane.description,
        status: "pending",
        priority: "medium",
        requesterId: SYSTEM_REQUESTER_ID,
        department: lane.department,
        workflowId,
        workflowStep: lane.step,
        data: JSON.stringify({ ...sharedData, lane: lane.department }),
        metadata: JSON.stringify({ ...baseMetadata, lane: lane.department }),
      });
      created += 1;
    } catch (e: any) {
      console.error(
        `[LoaRecovery] Failed to create ${lane.department} item for ${q.enterpriseId}:`,
        e?.message || e,
      );
    }
  }
  return created;
}

async function cancelOpenLoaWorkflows(workflowIds: string[]): Promise<number> {
  if (workflowIds.length === 0) return 0;
  const now = new Date();
  // Append the cancel reason into metadata JSON via jsonb_set so we don't
  // clobber existing keys. metadata is stored as text but the value is JSON,
  // so cast through jsonb.
  const result = await db
    .update(queueItems)
    .set({
      status: "cancelled",
      completedAt: now,
      updatedAt: now,
      metadata: sql`COALESCE(
        jsonb_set(
          COALESCE(${queueItems.metadata}::jsonb, '{}'::jsonb),
          '{cancelled_reason}',
          '"tech_returned_from_loa"'::jsonb,
          true
        ),
        '{"cancelled_reason":"tech_returned_from_loa"}'::jsonb
      )::text`,
    })
    .where(
      and(
        eq(queueItems.workflowType, WORKFLOW_TYPE),
        inArray(queueItems.workflowId, workflowIds),
        inArray(queueItems.status, ["pending", "in_progress"]),
      ),
    )
    .returning({ id: queueItems.id });
  return result.length;
}

/**
 * Latest snapshot (one row per qualifying tech from the most recent successful
 * run, identified by the max syncedAt).
 */
export async function getLatestLoaRecoverySnapshot() {
  const latest = await db
    .select({ syncedAt: sql<Date>`MAX(${loaRecoverySnapshot.syncedAt})` })
    .from(loaRecoverySnapshot);
  const ts = latest[0]?.syncedAt;
  if (!ts) return { syncedAt: null, rows: [] };
  const rows = await db
    .select()
    .from(loaRecoverySnapshot)
    .where(eq(loaRecoverySnapshot.syncedAt, ts));
  return { syncedAt: ts, rows };
}
