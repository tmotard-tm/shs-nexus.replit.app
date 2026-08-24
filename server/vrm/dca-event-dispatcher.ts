/**
 * VRM DCA Make-Unavailable event dispatcher.
 *
 * When a rental is denied on the VRM module we POST a "Make Unavailable"
 * request to the Standard Activities Request Generator (DCA Task) API so
 * the appropriate DCA for the tech's district is notified and the tech is
 * taken off route. The dispatch is decoupled from the decision write path
 * so the user's Deny click never blocks on an outbound call:
 *
 *   1. enqueueDcaMakeUnavailableForDecision(decisionId) flips
 *      vrm_rental_decisions.dca_event_status to 'pending' (idempotent —
 *      if a row is already 'sent' or 'skipped' it stays put).
 *   2. A 30s polling worker (startDcaEventDispatcher) drains pending rows,
 *      calls sendMakeUnavailable, and persists the outcome
 *      (status='sent'|'failed'|'skipped', project_id, sent_at, error,
 *      attempts++). Failed rows are retried up to MAX_ATTEMPTS.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import {
  sendMakeUnavailable,
  isDcaTaskApiConfigured,
  type DcaReasonCode,
} from "./dca-task-client";

const MAX_ATTEMPTS = 5;
const DRAIN_BATCH = 25;
const TICK_MS = 30_000;
const FIRST_TICK_DELAY_MS = 7_000;

/**
 * Default reason code used for every rental denial. Today the Deny flow
 * doesn't capture a structured reason — the API only accepts one of four
 * fixed values, and "Rental Reduction" matches the label already shown on
 * the Route-Ready sidebar. A future enhancement can add a per-decision
 * picker; the dispatcher will pick that up automatically once the column
 * is populated.
 */
const DEFAULT_REASON_CODE: DcaReasonCode = "Rental Reduction";

const SUBMITTED_BY = "NEXUS_VRM";

function toImpactDate(d: Date | string | null): string {
  // YYYY-MM-DD in America/Chicago (Central). Decisions are made in CT
  // and the API treats impactDate as a calendar day.
  const date = d ? new Date(d) : new Date();
  if (isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(date); // en-CA → YYYY-MM-DD
}

function buildProjectNotes(techLdap: string, decisionDate: string, notes: string | null): string {
  const prefix = `VRM denial for ${techLdap} on ${decisionDate}: `;
  const free = (notes ?? "").trim().slice(0, 250);
  return free ? `${prefix}${free}` : prefix.trimEnd();
}

// ─── Holman redirect fence ─────────────────────────────────────────────────

/**
 * Machine-written notes prefix stamped by recordHolmanDecision since the
 * Holman queue launched. Used as a transitional fingerprint below and by the
 * boot backfill (healHolmanDcaRows).
 */
export const HOLMAN_NOTES_FINGERPRINT = "Holman PO %from rental queue%";

/**
 * SQL predicate excluding Holman-queue redirect denials from every surface
 * that could drive a Make Unavailable send (enqueue, operator retry, worker
 * claim). Two legs:
 *
 *   1. The durable discriminator: decision_source = 'holman_queue'.
 *   2. A transitional notes-fingerprint exclusion for rows written before
 *      the decision_source column existed. The boot backfill
 *      (healHolmanDcaRows) stamps these, but it runs in a detached,
 *      non-awaited init chain while the dispatcher starts immediately — so
 *      the fence must not depend on the backfill having completed.
 *
 * Exported (as a factory) so tests can prove the exact predicate the worker
 * claim uses excludes a pre-backfill row.
 */
/**
 * Self-healing migration guard. initVrmSchema() (which ALTERs this column in)
 * runs in a detached background chain, while VRM routes and this dispatcher
 * are live immediately — so on the first boot after a deploy against an
 * old-schema database there is a window where decision_source does not exist
 * yet. Every code path that references the column calls this first: a cheap
 * catalog check, with the targeted ALTER only when the column is actually
 * missing (so the steady-state cost is one indexed catalog read and no table
 * lock). Never memoized — a transient failure must not poison later calls.
 */
export async function ensureDecisionSourceColumn(): Promise<void> {
  const r: any = await db.execute(sql`
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'vrm_rental_decisions' AND column_name = 'decision_source'
  `);
  const rows: any[] = Array.isArray(r) ? r : (r?.rows ?? []);
  if (rows.length === 0) {
    await db.execute(sql`ALTER TABLE vrm_rental_decisions ADD COLUMN IF NOT EXISTS decision_source VARCHAR(30)`);
    console.warn("[VRM DCA] decision_source column was missing — added ahead of the background schema init");
  }
}

export function holmanRedirectFenceSql() {
  // COALESCE(notes,'') matters: a NULL-notes legacy row would make the LIKE
  // (and therefore the whole NOT(...)) evaluate to SQL NULL, silently fencing
  // out legitimate legacy denials.
  return sql`(
    COALESCE(decision_source, '') <> 'holman_queue'
    AND NOT (decision_source IS NULL AND COALESCE(notes, '') LIKE ${HOLMAN_NOTES_FINGERPRINT})
  )`;
}

// ─── Public enqueue API ────────────────────────────────────────────────────

/**
 * Marks the decision row as `pending` so the worker will pick it up on the
 * next tick. Safe to call multiple times: rows already in a terminal state
 * (`sent`) are not re-enqueued, but `failed` and `skipped` rows are reset
 * (with attempts left intact for the failed path so the retry budget is
 * respected — for an operator-initiated retry use `requestDcaEventRetry`).
 *
 * HOLMAN FENCE: Holman-queue redirect denials (decision_source =
 * 'holman_queue') must never file a Make Unavailable — the tech keeps
 * working under the direct-billing process. The fence lives in the SQL
 * predicate (durable column, not notes text) so no caller can bypass it.
 * 'not_filed' is likewise excluded — it is an intentional terminal state,
 * distinct from failed/skipped.
 */
export async function enqueueDcaMakeUnavailableForDecision(decisionId: string): Promise<void> {
  await ensureDecisionSourceColumn();
  await db.execute(sql`
    UPDATE vrm_rental_decisions
       SET dca_event_status = 'pending',
           dca_event_error = NULL
     WHERE id = ${decisionId}
       AND decision ILIKE 'denied'
       AND ${holmanRedirectFenceSql()}
       AND (dca_event_status IS NULL OR dca_event_status IN ('failed', 'skipped'))
  `);
}

/**
 * Operator-initiated retry: clears `dca_event_error`, resets attempts to 0,
 * and flips status back to 'pending'. Used by the "Retry" button on the
 * Decision Log row.
 */
export async function requestDcaEventRetry(decisionId: string): Promise<boolean> {
  // Same Holman fence as the enqueue above: an operator Retry can never
  // re-drive a Holman redirect denial (or an intentionally-not-filed row)
  // into a Make Unavailable send.
  await ensureDecisionSourceColumn();
  const r: any = await db.execute(sql`
    UPDATE vrm_rental_decisions
       SET dca_event_status = 'pending',
           dca_event_error = NULL,
           dca_event_attempts = 0
     WHERE id = ${decisionId}
       AND decision ILIKE 'denied'
       AND ${holmanRedirectFenceSql()}
       AND (dca_event_status IS NULL OR dca_event_status NOT IN ('sent', 'sending', 'not_filed'))
     RETURNING id
  `);
  const rows = Array.isArray(r) ? r : (r?.rows ?? []);
  return rows.length > 0;
}

/**
 * Full operator-retry decision flow behind POST
 * /profitability/log/:id/dca-event/retry, extracted so the sequencing is
 * unit-testable: the schema self-heal MUST run before the decision read —
 * the reader (getRentalDecision in production) selects the full drizzle
 * schema including decision_source, which would 500 on the first boot
 * against an old-schema DB if it ran first. The reader is injected so tests
 * can run the flow hermetically inside a rollback transaction.
 *
 * The Holman-redirect check here is UX (a specific message); the SQL inside
 * requestDcaEventRetry fences on the same predicate and remains the safety
 * boundary. The notes-fingerprint leg covers pre-backfill rows whose
 * decision_source is still NULL (the boot backfill runs in a detached init
 * chain and may not have finished).
 */
export async function retryDcaEventForOperator(
  decisionId: string,
  readDecision: (id: string) => Promise<{ decision: unknown; decisionSource?: string | null; notes?: unknown } | null | undefined>,
): Promise<{ http: number; body: Record<string, unknown> }> {
  await ensureDecisionSourceColumn();
  const existing = await readDecision(decisionId);
  if (!existing) return { http: 404, body: { error: "Decision not found" } };
  if (String(existing.decision).toLowerCase() !== "denied") {
    return { http: 400, body: { error: "DCA event only applies to denied decisions" } };
  }
  const isHolmanRedirect =
    existing.decisionSource === "holman_queue" ||
    (existing.decisionSource == null &&
      /^Holman PO .*from rental queue/.test(String(existing.notes ?? "")));
  if (isHolmanRedirect) {
    return {
      http: 409,
      body: { error: "Holman redirect denial — Make Unavailable is intentionally not filed for direct-billing redirects and cannot be retried" },
    };
  }
  const ok = await requestDcaEventRetry(decisionId);
  if (!ok) return { http: 409, body: { error: "Already sent or not retryable" } };
  return { http: 200, body: { ok: true, status: "pending" } };
}

/**
 * Backfill + self-heal for Holman-queue redirect denials. Called from
 * initVrmSchema() on every boot (both statements are idempotent):
 *
 *   1. Rows created by recordHolmanDecision before the decision_source
 *      column existed are identifiable by their machine-written notes
 *      prefix — stamp them 'holman_queue'.
 *   2. No Holman denial may sit in a state the dispatcher or the operator
 *      Retry button could drive into a Make Unavailable send: flip
 *      NULL/pending/failed/skipped → 'not_filed'. 'sent'/'sending' are
 *      historical truth and stay untouched; dca_event_error is preserved so
 *      the 2026-08-24 ambiguous-409 record stays visible.
 */
export async function healHolmanDcaRows(): Promise<void> {
  await db.execute(sql`
    UPDATE vrm_rental_decisions
       SET decision_source = 'holman_queue'
     WHERE decision_source IS NULL
       AND notes LIKE ${HOLMAN_NOTES_FINGERPRINT}
  `);
  await db.execute(sql`
    UPDATE vrm_rental_decisions
       SET dca_event_status = 'not_filed'
     WHERE decision_source = 'holman_queue'
       AND decision ILIKE 'denied'
       AND (dca_event_status IS NULL OR dca_event_status IN ('pending', 'failed', 'skipped'))
  `);
}

// ─── Worker ────────────────────────────────────────────────────────────────

interface ClaimedRow {
  id: string;
  techLdap: string;
  notes: string | null;
  createdAt: Date | string;
  attempts: number;
}

/**
 * Atomically claim up to `limit` pending rows by flipping them to 'sending'.
 * We use a CTE with `FOR UPDATE SKIP LOCKED` so two workers (or two ticks of
 * the same worker that overlapped) can never grab the same row, and we only
 * promote a row to 'sending' if it's still 'pending' under attempt budget.
 *
 * Returning the snapshot of fields the dispatcher needs avoids a second
 * read after the claim.
 */
async function claimPending(limit: number): Promise<ClaimedRow[]> {
  const r: any = await db.execute(sql`
    WITH cte AS (
      SELECT id
        FROM vrm_rental_decisions
       WHERE dca_event_status = 'pending'
         AND dca_event_attempts < ${MAX_ATTEMPTS}
         -- Defense in depth: even if a Holman redirect denial somehow lands
         -- in 'pending' (both enqueue surfaces already fence it), the worker
         -- must never send a Make Unavailable for it — including pre-backfill
         -- rows that only the notes fingerprint identifies (the dispatcher
         -- starts before the detached initVrmSchema backfill finishes).
         AND ${holmanRedirectFenceSql()}
       ORDER BY created_at ASC
       LIMIT ${limit}
       FOR UPDATE SKIP LOCKED
    )
    UPDATE vrm_rental_decisions d
       SET dca_event_status = 'sending'
      FROM cte
     WHERE d.id = cte.id
    RETURNING d.id, d.tech_ldap AS "techLdap", d.notes, d.created_at AS "createdAt",
              d.dca_event_attempts AS "attempts"
  `);
  const rows: any[] = Array.isArray(r) ? r : (r?.rows ?? []);
  return rows.map((row) => ({
    id: String(row.id),
    techLdap: String(row.techLdap ?? row.tech_ldap),
    notes: row.notes ?? null,
    createdAt: (row.createdAt ?? row.created_at) as any,
    attempts: Number(row.attempts ?? row.dca_event_attempts ?? 0),
  }));
}

/**
 * Releases a row back to 'pending' (or to 'failed' if exhausted) when the
 * dispatcher couldn't actually attempt the call — e.g. when claimPending
 * returned a row but downstream code threw before sendMakeUnavailable could
 * run. We do NOT bump attempts here since no external call happened.
 */
async function releaseSendingNoAttempt(id: string): Promise<void> {
  await db.execute(sql`
    UPDATE vrm_rental_decisions
       SET dca_event_status = 'pending'
     WHERE id = ${id}
       AND dca_event_status = 'sending'
  `);
}

async function dispatchOne(row: ClaimedRow): Promise<void> {
  const impactDate = toImpactDate(row.createdAt);
  let result: Awaited<ReturnType<typeof sendMakeUnavailable>>;
  try {
    result = await sendMakeUnavailable({
      techLdap: row.techLdap.toUpperCase(),
      impactDate,
      reasonCode: DEFAULT_REASON_CODE,
      submittedBy: SUBMITTED_BY,
      projectNotes: buildProjectNotes(row.techLdap.toUpperCase(), impactDate, row.notes),
    });
  } catch (err: any) {
    // sendMakeUnavailable swallows its own errors, so this is defensive only.
    // We do not know whether the upstream call landed, so we release without
    // bumping attempts and the row will be retried on the next tick.
    await releaseSendingNoAttempt(row.id);
    throw err;
  }

  if (result.ok) {
    // Status-guarded write: only finalize from 'sending'. Prevents an older
    // overlapping process from clobbering an already-finalized row.
    await db.execute(sql`
      UPDATE vrm_rental_decisions
         SET dca_event_status = 'sent',
             dca_event_project_id = ${result.projectId},
             dca_event_sent_at = NOW(),
             dca_event_error = NULL,
             dca_event_attempts = dca_event_attempts + 1
       WHERE id = ${row.id}
         AND dca_event_status = 'sending'
    `);
    console.log(`[VRM DCA] Make Unavailable sent for ${row.techLdap} (decision ${row.id}, project ${result.projectId})`);
    return;
  }

  if (result.skipReason === "missing_config") {
    // No retry possible — mark skipped and stop. No attempt bump (we never
    // actually hit the network).
    await db.execute(sql`
      UPDATE vrm_rental_decisions
         SET dca_event_status = 'skipped',
             dca_event_error = ${result.errorMessage}
       WHERE id = ${row.id}
         AND dca_event_status = 'sending'
    `);
    return;
  }

  // Network/HTTP failure. Bump attempts atomically and decide next state
  // based on the new value so concurrent updates can't race.
  const upd: any = await db.execute(sql`
    UPDATE vrm_rental_decisions
       SET dca_event_attempts = dca_event_attempts + 1,
           dca_event_error = ${result.errorMessage},
           dca_event_status = CASE
             WHEN dca_event_attempts + 1 >= ${MAX_ATTEMPTS} THEN 'failed'
             ELSE 'pending'
           END
     WHERE id = ${row.id}
       AND dca_event_status = 'sending'
    RETURNING dca_event_attempts AS "attempts", dca_event_status AS "status"
  `);
  const updRows: any[] = Array.isArray(upd) ? upd : (upd?.rows ?? []);
  const after = updRows[0] ?? { attempts: row.attempts + 1, status: "pending" };
  console.warn(
    `[VRM DCA] Make Unavailable ${after.status === "failed" ? "FAILED (giving up)" : "retry pending"} ` +
    `for ${row.techLdap} (decision ${row.id}, attempt ${after.attempts}/${MAX_ATTEMPTS}): ${result.errorMessage}`,
  );
}

let started = false;
let inFlight = false;

async function tick(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    // The claim predicate references decision_source; on the first boot after
    // a deploy against an old-schema DB the background init may not have
    // ALTERed it in yet. Heal first — if this throws (DB down), the claim
    // would have failed identically and the tick's catch handles it.
    await ensureDecisionSourceColumn();
    const rows = await claimPending(DRAIN_BATCH);
    for (const r of rows) {
      try { await dispatchOne(r); }
      catch (err: any) {
        console.error(`[VRM DCA] Unexpected dispatch error for decision ${r.id}:`, err?.message ?? err);
      }
    }
  } catch (err: any) {
    console.error("[VRM DCA] Dispatcher tick error:", err?.message ?? err);
  } finally {
    inFlight = false;
  }
}

/**
 * On boot, any row still in 'sending' is orphaned from a previous process
 * that crashed mid-dispatch. We do NOT auto-retry these because the upstream
 * call may have actually landed — a duplicate Make Unavailable would page
 * the DCA team a second time. Mark them 'failed' so an operator must
 * manually retry (or confirm via the DCA queue) before another attempt.
 */
async function reconcileOrphanedSendingRows(): Promise<void> {
  try {
    const r: any = await db.execute(sql`
      UPDATE vrm_rental_decisions
         SET dca_event_status = 'failed',
             dca_event_error = COALESCE(dca_event_error, '') ||
               CASE WHEN dca_event_error IS NULL OR dca_event_error = '' THEN '' ELSE ' | ' END ||
               'orphaned in sending state at boot — upstream delivery unknown'
       WHERE dca_event_status = 'sending'
      RETURNING id
    `);
    const rows: any[] = Array.isArray(r) ? r : (r?.rows ?? []);
    if (rows.length > 0) {
      console.warn(`[VRM DCA] Reconciled ${rows.length} orphaned 'sending' row(s) → 'failed' (manual retry required)`);
    }
  } catch (err: any) {
    console.error("[VRM DCA] Orphan reconciliation failed:", err?.message ?? err);
  }
}

/**
 * Start the 30-second drain loop. Idempotent — calling twice does nothing.
 */
export function startDcaEventDispatcher(): void {
  if (started) return;
  started = true;
  // Reconcile any 'sending' rows left from a previous crashed process before
  // the first tick so they don't get re-dispatched (possible duplicate send).
  reconcileOrphanedSendingRows().catch(() => { /* logged inside */ });
  setTimeout(tick, FIRST_TICK_DELAY_MS);
  setInterval(tick, TICK_MS);
  console.log(
    `[VRM DCA] DCA event dispatcher started (${TICK_MS / 1000}s interval${
      isDcaTaskApiConfigured() ? "" : ", waiting for EVENT_REQUEST_URL/DCA_TASK_API_TOKEN"
    })`,
  );
}
