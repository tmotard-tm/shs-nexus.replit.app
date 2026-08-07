/**
 * VRM ⇄ LUCA activity ledger — one durable row for every observable LUCA
 * touchpoint, in both directions, so "did LUCA actually do anything last
 * night?" is answerable from a page instead of grepping deployment logs
 * (Tyler 2026-08-06: durable logging of every LUCA action to/from VRM).
 *
 * Direction vocabulary (fixed):
 *   outbound — Nexus → LUCA/LIVHR: call dispatches, region-ready emails,
 *              outbox consumes (mark-synced). A dispatch REFUSED before any
 *              HTTP leaves the box is still outbound (status 'refused') —
 *              the operator asked for a call and none happened.
 *   inbound  — LUCA results landing in Nexus: the write-back lanes
 *              (VRM ready flip / attention flag / terminal status /
 *              ready-status correction) and the fs_trucks applies.
 *   internal — the write-back worker's own run heartbeats. 0-task runs are
 *              logged on purpose: "the poller is alive" is the signal.
 *
 * Noise policy (deliberate): the LIVHR call-outcome feed re-serves every
 * historical conversation on EVERY poll (~170 duplicates/run at 15-min
 * cadence) and unknown trucks recur until the next rental sync. The ledger
 * records STATE CHANGES and refusals, not steady-state echoes — per-item
 * duplicate/unknown rows are written only on first sighting (or for
 * consumable outbox tasks, whose re-delivery means the LIVHR PATCH failed
 * and is itself signal). The per-run heartbeat carries the recurring counts.
 * Without this the 30-day window would be ~500k echo rows and the page
 * useless.
 *
 * logLucaActivity NEVER throws — a ledger failure must not break a call
 * dispatch or a write-back apply. Call sites still AWAIT it: the scheduled-
 * deployment trigger exits right after the poll, and a fire-and-forget row
 * would be lost exactly when the run mattered.
 *
 * Table DDL also lives in initRentalOperationsSchema (boot path — deploys
 * run no migrations); the lazy ensure here is the dev-safety net for a
 * process that logs before boot DDL has run.
 */
import { db } from "../../db";
import { sql } from "drizzle-orm";

export type LucaActivityDirection = "outbound" | "inbound" | "internal";
export type LucaActivityStatus =
  | "ok"        // the thing happened
  | "failed"    // attempted, did not happen (or run had item errors)
  | "skipped"   // deliberately not done (guard/no-op/duplicate)
  | "refused"   // pre-flight refusal before any external call
  | "dry_run"   // LIVHR accepted but did not dial (its dry-run gate)
  | "log_only"  // worker LOG-ONLY mode: WOULD have applied
  | "fallback"; // handled via the designed fallback lane (e.g. needs-routing)

export interface LucaActivityEntry {
  direction: LucaActivityDirection;
  eventType: string;
  status: LucaActivityStatus;
  caseKey?: string | null;
  truckNumber?: string | null;
  conversationId?: string | null;
  externalId?: string | number | null;
  actor?: string | null;
  summary: string;
  detail?: Record<string, unknown> | null;
}

export const LUCA_ACTIVITY_RETENTION_DAYS = 30;

/** Keep in lockstep with the vrm_luca_activity_log block in schema.ts. */
const ENSURE_SQL = sql`
  CREATE TABLE IF NOT EXISTS vrm_luca_activity_log (
    id              BIGSERIAL PRIMARY KEY,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    direction       VARCHAR(10) NOT NULL,
    event_type      VARCHAR(40) NOT NULL,
    status          VARCHAR(12) NOT NULL,
    case_key        VARCHAR(10),
    truck_number    VARCHAR(30),
    conversation_id VARCHAR(80),
    external_id     VARCHAR(80),
    actor           VARCHAR(120),
    summary         TEXT NOT NULL,
    detail          JSONB
  );
`;

let ensured: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await db.execute(ENSURE_SQL);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_vrm_luca_activity_at ON vrm_luca_activity_log (occurred_at DESC);`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_vrm_luca_activity_case ON vrm_luca_activity_log (case_key, occurred_at DESC) WHERE case_key IS NOT NULL;`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_vrm_luca_activity_event ON vrm_luca_activity_log (event_type, occurred_at DESC);`);
      // Retention: this is a sync-health ledger, not an archive. One prune per
      // process start keeps the table bounded without a scheduler (which
      // autoscale would kill anyway).
      await db.execute(sql`DELETE FROM vrm_luca_activity_log WHERE occurred_at < NOW() - make_interval(days => ${LUCA_ACTIVITY_RETENTION_DAYS});`);
    })().catch((e) => {
      ensured = null; // allow retry on the next log call
      throw e;
    });
  }
  return ensured;
}

function safeDetail(d: Record<string, unknown> | null | undefined): string | null {
  if (!d) return null;
  try {
    const s = JSON.stringify(d);
    return s.length > 8000 ? JSON.stringify({ truncated: true, preview: s.slice(0, 7900) }) : s;
  } catch {
    return null;
  }
}

/** Append one ledger row. Never throws; failures go to console only. */
export async function logLucaActivity(e: LucaActivityEntry): Promise<void> {
  try {
    await ensureTable();
    const summary = (e.summary || "").slice(0, 500);
    await db.execute(sql`
      INSERT INTO vrm_luca_activity_log
        (direction, event_type, status, case_key, truck_number, conversation_id, external_id, actor, summary, detail)
      VALUES (${e.direction}, ${e.eventType}, ${e.status},
              ${e.caseKey ?? null}, ${e.truckNumber ?? null}, ${e.conversationId ?? null},
              ${e.externalId != null ? String(e.externalId) : null}, ${e.actor ?? null},
              ${summary}, ${safeDetail(e.detail)}::jsonb)
    `);
  } catch (err: any) {
    console.warn("[LucaActivity] ledger write failed (non-fatal):", err?.message || err);
  }
}

// ─── Reads (viewer page) ─────────────────────────────────────────────────────

export interface LucaActivityFilters {
  limit?: number;              // default 200, max 1000
  direction?: string | null;
  eventType?: string | null;
  status?: string | null;
  truck?: string | null;       // matches case_key OR truck_number
  sinceHours?: number | null;  // e.g. 24
}

export interface LucaActivityRow {
  id: number;
  occurredAt: string;
  direction: string;
  eventType: string;
  status: string;
  caseKey: string | null;
  truckNumber: string | null;
  conversationId: string | null;
  externalId: string | null;
  actor: string | null;
  summary: string;
  detail: unknown;
}

export async function readLucaActivity(f: LucaActivityFilters): Promise<LucaActivityRow[]> {
  await ensureTable();
  const limit = Math.min(Math.max(f.limit ?? 200, 1), 1000);
  const conds: ReturnType<typeof sql>[] = [];
  if (f.direction) conds.push(sql`direction = ${f.direction}`);
  if (f.eventType) conds.push(sql`event_type = ${f.eventType}`);
  if (f.status) conds.push(sql`status = ${f.status}`);
  if (f.truck) {
    const t = f.truck.trim();
    conds.push(sql`(case_key = ${t} OR truck_number = ${t} OR case_key = ${t.padStart(5, "0")} OR truck_number = ${t.padStart(5, "0")})`);
  }
  if (f.sinceHours && Number.isFinite(f.sinceHours)) {
    conds.push(sql`occurred_at > NOW() - make_interval(hours => ${Math.min(f.sinceHours, 24 * LUCA_ACTIVITY_RETENTION_DAYS)})`);
  }
  const where = conds.length ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;
  const res = await db.execute(sql`
    SELECT id, occurred_at, direction, event_type, status, case_key, truck_number,
           conversation_id, external_id, actor, summary, detail
    FROM vrm_luca_activity_log
    ${where}
    ORDER BY occurred_at DESC, id DESC
    LIMIT ${limit}
  `);
  return (res.rows ?? []).map((r: any) => ({
    id: Number(r.id),
    occurredAt: r.occurred_at instanceof Date ? r.occurred_at.toISOString() : String(r.occurred_at),
    direction: r.direction,
    eventType: r.event_type,
    status: r.status,
    caseKey: r.case_key ?? null,
    truckNumber: r.truck_number ?? null,
    conversationId: r.conversation_id ?? null,
    externalId: r.external_id ?? null,
    actor: r.actor ?? null,
    summary: r.summary,
    detail: r.detail ?? null,
  }));
}

export interface LucaActivityHealth {
  lastRun: { at: string; status: string; summary: string; detail: unknown } | null;
  lastDispatchAt: string | null;
  lastInboundAt: string | null;
  counts24h: { total: number; failed: number; inboundOk: number; outboundOk: number };
  byEvent24h: Array<{ eventType: string; status: string; count: number }>;
}

export async function lucaActivityHealth(): Promise<LucaActivityHealth> {
  await ensureTable();
  const iso = (v: any): string | null =>
    v == null ? null : v instanceof Date ? v.toISOString() : String(v);

  const [runRes, aggRes, byEventRes] = await Promise.all([
    db.execute(sql`
      SELECT occurred_at, status, summary, detail FROM vrm_luca_activity_log
      WHERE event_type = 'writeback_run'
      ORDER BY occurred_at DESC LIMIT 1`),
    db.execute(sql`
      SELECT
        MAX(occurred_at) FILTER (WHERE direction = 'outbound' AND event_type = 'dispatch_call') AS last_dispatch_at,
        MAX(occurred_at) FILTER (WHERE direction = 'inbound') AS last_inbound_at,
        COUNT(*) FILTER (WHERE occurred_at > NOW() - INTERVAL '24 hours') AS total_24h,
        COUNT(*) FILTER (WHERE occurred_at > NOW() - INTERVAL '24 hours' AND status = 'failed') AS failed_24h,
        COUNT(*) FILTER (WHERE occurred_at > NOW() - INTERVAL '24 hours' AND direction = 'inbound' AND status = 'ok') AS inbound_ok_24h,
        COUNT(*) FILTER (WHERE occurred_at > NOW() - INTERVAL '24 hours' AND direction = 'outbound' AND status = 'ok') AS outbound_ok_24h
      FROM vrm_luca_activity_log`),
    db.execute(sql`
      SELECT event_type, status, COUNT(*) AS n
      FROM vrm_luca_activity_log
      WHERE occurred_at > NOW() - INTERVAL '24 hours'
      GROUP BY event_type, status
      ORDER BY n DESC`),
  ]);

  const run = (runRes.rows ?? [])[0] as any;
  const agg = ((aggRes.rows ?? [])[0] ?? {}) as any;
  return {
    lastRun: run
      ? { at: iso(run.occurred_at)!, status: run.status, summary: run.summary, detail: run.detail ?? null }
      : null,
    lastDispatchAt: iso(agg.last_dispatch_at),
    lastInboundAt: iso(agg.last_inbound_at),
    counts24h: {
      total: Number(agg.total_24h ?? 0),
      failed: Number(agg.failed_24h ?? 0),
      inboundOk: Number(agg.inbound_ok_24h ?? 0),
      outboundOk: Number(agg.outbound_ok_24h ?? 0),
    },
    byEvent24h: (byEventRes.rows ?? []).map((r: any) => ({
      eventType: r.event_type,
      status: r.status,
      count: Number(r.n),
    })),
  };
}

/**
 * Which LUCA-related switches are set — PRESENCE booleans only, never values.
 * Lets the page explain "nothing inbound for 3 days" as "write-back apply is
 * off" instead of leaving it a mystery.
 */
export function lucaConfigSummary(): Record<string, boolean> {
  const truthy = (v?: string) => /^(true|1|yes)$/i.test((v ?? "").trim());
  const set = (v?: string) => !!(v ?? "").trim();
  return {
    livhrBaseUrlSet: set(process.env.LIVHR_BASE_URL) || set(process.env.LUCA_BASE_URL),
    dispatchTokenSet: set(process.env.AGENT_RUN_SECRET) || set(process.env.LUCA_AGENT_TOKEN),
    writebackTokenSet: set(process.env.LIVHR_AGENT_TOKEN),
    writebackApply: truthy(process.env.LUCA_WRITEBACK_APPLY),
    markSyncedRequested: !/^(false|0|no)$/i.test((process.env.LUCA_WRITEBACK_MARK_SYNCED ?? "").trim()),
    isDeployment: !!process.env.REPLIT_DEPLOYMENT,
    callOutcomesFeedConfigured: set(process.env.LUCA_WRITEBACK_CALL_OUTCOMES_PATH),
    readyNotifyDisabled: truthy(process.env.VRM_READY_NOTIFY_DISABLED),
  };
}
