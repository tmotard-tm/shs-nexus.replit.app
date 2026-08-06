/**
 * LUCA → FleetScope write-back worker (Phase 3 of the LUCA plan).
 *
 * Polls LIVHR (fleetagents) for LUCA's escalation outbox (+ the future
 * call-outcome feed) and lands the results on `fs_trucks` via the same
 * fleetScopeStorage.updateTruck path Nexus's own shop-caller uses — so humans
 * follow up on the same record LUCA acted on.
 *
 * Feeds (producer side lives on LIVHR — server/routes/luca-outbox.ts):
 *   GET   {LIVHR_BASE_URL}/api/luca/pending-tasks           (live today)
 *   PATCH {LIVHR_BASE_URL}/api/luca/pending-tasks/:id/synced (consume)
 *   GET   {LIVHR_BASE_URL}{LUCA_WRITEBACK_CALL_OUTCOMES_PATH} (future feed —
 *         skipped until the env is set AND LIVHR ships the endpoint)
 *
 * Env:
 *   LIVHR_BASE_URL     — e.g. https://fleetagents.replit.app. Unset → no-op.
 *   LIVHR_AGENT_TOKEN  — bearer token; must equal LIVHR's LUCA_OUTBOX_API_KEY.
 *                        Unset → no-op.
 *   LUCA_WRITEBACK_APPLY — "true"/"1"/"yes" = apply writes. DEFAULT OFF =
 *                        LOG-ONLY: fetches, maps, logs exactly what it WOULD
 *                        write, and writes NOTHING (no fs_trucks update, no
 *                        dedup rows, no PATCH back to LIVHR; a sync_logs row
 *                        is recorded only on failure so a dead scheduled job
 *                        still surfaces).
 *   LUCA_WRITEBACK_MARK_SYNCED — default true. "false" = apply locally but do
 *                        NOT consume (PATCH) the LIVHR task. Used for dev
 *                        verification against the prod outbox so real
 *                        escalations are never consumed by a dev run.
 *   LUCA_WRITEBACK_CALL_OUTCOMES_PATH — optional path of the future LIVHR
 *                        call-outcome feed (e.g. /api/luca/call-outcomes).
 *   LUCA_WRITEBACK_INTERVAL_MIN — in-process poll cadence (default 15).
 *
 * Idempotency: fs_luca_writeback_log with UNIQUE(source, external_id) — a
 * task/conversation is applied at most once even across overlapping schedulers
 * (in-process timer + Scheduled Deployment), plus a cross-process advisory
 * lock so two pollers never run concurrently. Boot DDL for the table lives in
 * server/fleet-scope-schema-init.ts (keep ENSURE_WRITEBACK_TABLE_SQL below in
 * lockstep — deploys run NO migrations).
 *
 * Scheduling: production is an AUTOSCALE deployment — in-process timers do
 * not fire dependably. The durable trigger is server/run-luca-writeback.ts
 * wired to a Replit Scheduled Deployment; startInProcessLucaWriteback() is a
 * best-effort warm path only (same split as fleet-comms / run-rental-sync).
 */
import { fsPool } from "../fleet-scope-db";
import { applyReadyForPickup, isReadyReason } from "../vrm/rental-operations/ready-ingest";
import { applyNeedsAttention, isAttentionReason } from "../vrm/rental-operations/attention-ingest";
import { appendFleetStatus, appendFleetStatusIfMainIn } from "../vrm/rental-operations/fleet-status";
import { invalidateTodaysQueueCache } from "../todays-queue";
import {
  reasonLabel,
  normalizeTruckNumber,
  terminalNeedsWrite,
  readyStatusNeedsWrite,
  READY_REPLACEABLE_MAIN_STATUSES,
  FS_MAIN_SCHEDULING,
  FS_SUB_TO_BE_SCHEDULED,
} from "./mapper";
import { fleetScopeStorage } from "../fleet-scope-storage";
import { storage } from "../storage";
import {
  runUnderAdvisoryLock,
  AdvisoryLockUnavailableError,
} from "../fleetscope-snowflake-sync-lock";
import {
  mapOutboxTask,
  mapCallOutcome,
  decideRedelivery,
  type LucaOutboxTask,
  type LucaCallOutcomeItem,
  type MappedWriteback,
} from "./mapper";

export const LUCA_WRITEBACK_LOCK = "luca-writeback-sync";
export const LUCA_WRITEBACK_SYNC_TYPE = "luca_writeback";
const FETCH_TIMEOUT_MS = 30_000;
const PREVIEW_CAP = 50;

/**
 * Keep in lockstep with the fs_luca_writeback_log block in
 * server/fleet-scope-schema-init.ts (the prod boot-DDL path).
 */
const ENSURE_WRITEBACK_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS "fs_luca_writeback_log" (
  "id" serial PRIMARY KEY,
  "source" text NOT NULL,
  "external_id" text NOT NULL,
  "truck_number" text,
  "truck_id" varchar,
  "outcome" text NOT NULL,
  "applied_fields" jsonb,
  "raw_payload" jsonb,
  "error_message" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_fs_luca_writeback_source_external"
  ON "fs_luca_writeback_log" ("source", "external_id");
`;

export interface LucaWritebackConfig {
  baseUrl: string | null;
  token: string | null;
  apply: boolean;
  markSynced: boolean;
  callOutcomesPath: string | null;
}

export function readConfig(): LucaWritebackConfig {
  const baseUrl = (process.env.LIVHR_BASE_URL ?? "").trim().replace(/\/+$/, "") || null;
  const token = (process.env.LIVHR_AGENT_TOKEN ?? "").trim() || null;
  const apply = /^(true|1|yes)$/i.test((process.env.LUCA_WRITEBACK_APPLY ?? "").trim());
  const markSyncedRequested = !/^(false|0|no)$/i.test(
    (process.env.LUCA_WRITEBACK_MARK_SYNCED ?? "").trim(),
  );
  // ONLY A DEPLOYMENT MAY CLAIM AN OUTBOX ROW (Tyler 2026-07-30).
  //
  // Marking a task SYNCED consumes it: LIVHR then stops returning it, so
  // whoever claims it is the ONLY consumer that will ever see it. The
  // workspace and the deployment are the SAME Repl and therefore share one
  // Secrets store, so this cannot be solved with an env var — setting
  // LUCA_WRITEBACK_MARK_SYNCED=false to stop the dev shell would also stop
  // prod, and then nothing would ever be consumed and every task would
  // re-deliver forever.
  //
  // On 2026-07-30 the dev workspace was pointed at LIVHR PROD
  // (LIVHR_BASE_URL=https://fleetagents.replit.app) with claiming enabled, and
  // it consumed 32 of the day's 41 outbox rows into its throwaway heliumdb.
  // Those escalations never reached the production VRM boards at all — the
  // trucks simply never appeared, with no error anywhere to explain it.
  //
  // REPLIT_DEPLOYMENT is set in a deployment and absent in the workspace (the
  // same signal fleet-scope-routes.ts already uses), so a dev shell can still
  // poll, map and preview the whole pipeline — it just can no longer take a
  // row away from production.
  const isDeployment = !!process.env.REPLIT_DEPLOYMENT;
  const markSynced = markSyncedRequested && isDeployment;
  if (markSyncedRequested && !isDeployment) {
    console.warn(
      "[LUCA-Writeback] not a deployment — will NOT mark outbox tasks SYNCED. " +
        "The workspace may process and preview, but only the deployment may consume " +
        "a row, otherwise production silently loses that escalation.",
    );
  }
  const callOutcomesPath =
    (process.env.LUCA_WRITEBACK_CALL_OUTCOMES_PATH ?? "").trim() || null;
  return { baseUrl, token, apply, markSynced, callOutcomesPath };
}

export interface WritebackPreview {
  source: string;
  externalId: string;
  truckNumber: string | null;
  matchedTruckId: string | null;
  write: Record<string, unknown> | null;
  note: string;
}

export interface LucaWritebackResult {
  disabled?: boolean;
  skipped?: boolean;
  apply: boolean;
  tasksFetched: number;
  outcomesFetched: number;
  applied: number;
  wouldApply: number;
  unknownTruck: number;
  duplicates: number;
  noOp: number;
  errors: number;
  /** VRM cases flipped to ready_for_pickup this run (the Tyler 2026-07-29 lane). */
  vrmReadyApplied?: number;
  /** VRM cases flagged `escalated` from a non-ready LUCA escalation. */
  vrmAttentionApplied?: number;
  previews: WritebackPreview[];
}

function emptyResult(apply: boolean): LucaWritebackResult {
  return {
    apply,
    tasksFetched: 0,
    outcomesFetched: 0,
    applied: 0,
    wouldApply: 0,
    unknownTruck: 0,
    duplicates: 0,
    noOp: 0,
    errors: 0,
    previews: [],
  };
}

// ─── LIVHR HTTP ──────────────────────────────────────────────────────────────

async function livhrGet(baseUrl: string, token: string, path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

async function fetchPendingTasks(baseUrl: string, token: string): Promise<LucaOutboxTask[]> {
  const res = await livhrGet(baseUrl, token, "/api/luca/pending-tasks");
  if (res.status === 503) {
    throw new Error(
      "LIVHR outbox API not configured (503 — LUCA_OUTBOX_API_KEY unset on the LIVHR deployment)",
    );
  }
  if (res.status === 401) {
    throw new Error("LIVHR outbox rejected the token (401 — LIVHR_AGENT_TOKEN mismatch)");
  }
  if (!res.ok) {
    throw new Error(`LIVHR outbox fetch failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as { count?: number; tasks?: LucaOutboxTask[] };
  return Array.isArray(body?.tasks) ? body.tasks : [];
}

/** The call-outcome feed does not exist on LIVHR yet — 404/501 is a soft skip. */
async function fetchCallOutcomes(
  baseUrl: string,
  token: string,
  path: string,
): Promise<LucaCallOutcomeItem[] | null> {
  const res = await livhrGet(baseUrl, token, path);
  if (res.status === 404 || res.status === 501) {
    console.log(
      `[LUCA-Writeback] call-outcome feed ${path} not available on LIVHR yet (HTTP ${res.status}) — skipping`,
    );
    return null;
  }
  if (!res.ok) throw new Error(`LIVHR call-outcome fetch failed: HTTP ${res.status}`);
  const body = (await res.json()) as any;
  const items = Array.isArray(body) ? body : (body?.outcomes ?? body?.items ?? []);
  return Array.isArray(items) ? items : [];
}

async function markTaskSynced(
  baseUrl: string,
  token: string,
  taskId: string,
  nexusTaskId: string,
): Promise<void> {
  try {
    const res = await fetch(`${baseUrl}/api/luca/pending-tasks/${taskId}/synced`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ nexus_task_id: nexusTaskId }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(
        `[LUCA-Writeback] mark-synced failed for task ${taskId}: HTTP ${res.status} ` +
          `(dedup row protects against re-apply; will re-PATCH next poll)`,
      );
    }
  } catch (err: any) {
    console.warn(
      `[LUCA-Writeback] mark-synced error for task ${taskId}: ${err?.message ?? err}`,
    );
  }
}

// ─── Dedup log ───────────────────────────────────────────────────────────────

async function getDedupOutcome(source: string, externalId: string): Promise<string | null> {
  try {
    const { rows } = await fsPool.query(
      `SELECT outcome FROM fs_luca_writeback_log WHERE source = $1 AND external_id = $2`,
      [source, externalId],
    );
    return rows[0]?.outcome ?? null;
  } catch {
    // Table may not exist yet on a fresh dev DB in log-only mode (log-only
    // never runs DDL). Treat as no history.
    return null;
  }
}

async function upsertWritebackLog(row: {
  source: string;
  externalId: string;
  truckNumber: string | null;
  truckId: string | null;
  outcome: string;
  appliedFields: Record<string, unknown> | null;
  rawPayload: unknown;
  errorMessage?: string | null;
}): Promise<number> {
  const { rows } = await fsPool.query(
    `INSERT INTO fs_luca_writeback_log
       (source, external_id, truck_number, truck_id, outcome, applied_fields, raw_payload, error_message)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (source, external_id) DO UPDATE SET
       truck_number = EXCLUDED.truck_number,
       truck_id = EXCLUDED.truck_id,
       outcome = EXCLUDED.outcome,
       applied_fields = EXCLUDED.applied_fields,
       raw_payload = EXCLUDED.raw_payload,
       error_message = EXCLUDED.error_message,
       updated_at = now()
     RETURNING id`,
    [
      row.source,
      row.externalId,
      row.truckNumber,
      row.truckId,
      row.outcome,
      row.appliedFields ? JSON.stringify(row.appliedFields) : null,
      row.rawPayload != null ? JSON.stringify(row.rawPayload) : null,
      row.errorMessage ?? null,
    ],
  );
  return rows[0].id as number;
}

// ─── Truck resolution & write ────────────────────────────────────────────────

async function resolveTruck(mapped: MappedWriteback) {
  // fs_trucks stores the 5-digit display form (verified: all rows length 5);
  // fall back to canonical and raw for safety.
  const candidates = [
    mapped.truckNumberDisplay,
    mapped.truckNumberCanonical,
    mapped.vehicleNumberRaw,
  ].filter((v, i, a): v is string => !!v && a.indexOf(v) === i);
  for (const num of candidates) {
    const truck = await fleetScopeStorage.getTruckByNumber(num);
    if (truck) return truck;
  }
  return undefined;
}

/**
 * Merge the mapped write against the live truck row:
 *  - monotonic lastCallDate guard (mirrors applyCallResultToTruck)
 *  - terminal main/sub gate: only when the truck is not already terminal
 */
function buildFinalWrite(
  mapped: MappedWriteback,
  truck: { lastCallDate?: Date | string | null; mainStatus?: string | null },
): Record<string, unknown> {
  const write: Record<string, unknown> = { ...(mapped.truckWrite ?? {}) };

  if (write.lastCallDate instanceof Date && truck.lastCallDate) {
    const existing = new Date(truck.lastCallDate as any).getTime();
    if (Number.isFinite(existing) && (write.lastCallDate as Date).getTime() <= existing) {
      // Stale call: an older outcome must never overwrite newer call state.
      // Drop the whole call-derived tuple, not just the date — the feed is
      // newest-first, so within one poll batch the newer row is processed
      // FIRST and the older row would otherwise land last and win
      // summary/status/eta.
      delete write.lastCallDate;
      delete write.lastCallStatus;
      delete write.lastCallSummary;
      delete write.lastCallConversationId;
      delete write.eta;
      delete write.expectedReturnDate;
    }
  }

  if (terminalNeedsWrite(mapped, truck)) {
    write.mainStatus = mapped.terminal!.mainStatus;
    write.subStatus = mapped.terminal!.subStatus;
  }
  return write;
}

/**
 * VRM-first terminal status (authority directive 2026-08-06: VRM owns rental
 * state; FleetScope mirrors it). Append the terminal outcome to VRM
 * fleet-status history — vocabulary-validated, and write-through mirrored onto
 * fs_trucks by appendFleetStatus itself — instead of writing fs_trucks first
 * and leaving VRM's lazy adopt sweep to pick it up later. Returns true when
 * VRM handled (or, in log-only mode, would handle) the status so the caller
 * strips it from the direct fs_trucks write; any failure returns false LOUDLY
 * and the legacy direct write + adopt sweep remain the safety net.
 */
async function routeTerminalViaVrm(
  mapped: MappedWriteback,
  truck: { mainStatus?: string | null },
  apply: boolean,
  label: string,
): Promise<boolean> {
  if (!terminalNeedsWrite(mapped, truck)) return false;
  const terminal = mapped.terminal!;
  // case_key is the 5-digit display form of the truck number — the exact
  // derivation the ready/attention lanes use (ready-ingest).
  const norm = normalizeTruckNumber(mapped.truckNumberDisplay ?? mapped.truckNumberCanonical);
  if (!norm) {
    console.warn(`[LUCA-Writeback] ${label}: terminal status but unusable truck number — using direct fs_trucks write`);
    return false;
  }
  const caseKey = norm.display;
  const desc = `${terminal.mainStatus}${terminal.subStatus ? ` / ${terminal.subStatus}` : ""}`;
  if (!apply) {
    console.log(`[LUCA-Writeback][LOG-ONLY] ${label}: WOULD append VRM fleet-status ${caseKey} -> ${desc} (mirror would update fs_trucks)`);
    return true;
  }
  try {
    await appendFleetStatus(caseKey, terminal.mainStatus, terminal.subStatus, "LUCA");
    invalidateTodaysQueueCache("luca-terminal-status");
    console.log(`[LUCA-Writeback] ${label}: VRM fleet-status ${caseKey} -> ${desc} (mirrored to fs_trucks)`);
    return true;
  } catch (err: any) {
    console.warn(
      `[LUCA-Writeback] ${label}: VRM fleet-status append failed for ${caseKey} (${err?.message ?? err}) — falling back to direct fs_trucks write`,
    );
    return false;
  }
}

/**
 * VRM-first ready status (same authority directive as routeTerminalViaVrm): a
 * phone-confirmed Ready ALSO moves the truck out of the three mains the Ops
 * Queue flags as STATUS CONFLICT (Repairing / Confirming Status / Decision
 * Pending) into Scheduling / "To be scheduled for tech pickup" — the exact
 * correction a human makes when the board says "Correct all systems then
 * arrange pickup"; step 2 then prompts for the pickup date. Before this,
 * EVERY LUCA-ready truck sat red forever because the writeback stamped only
 * call fields.
 *
 * Runs AFTER buildFinalWrite so the monotonic stale-call guard has already
 * spoken — a stale Ready never flips status. Unlike the terminal path there is
 * deliberately NO direct fs_trucks fallback: on append failure the truck stays
 * in the conflict set and the red row IS the divergence signal; a silent
 * direct write would hide the failure and let VRM history drift from the
 * mirror.
 */
async function routeReadyStatusViaVrm(
  mapped: MappedWriteback,
  finalWrite: Record<string, unknown>,
  truck: { mainStatus?: string | null },
  apply: boolean,
  label: string,
): Promise<boolean> {
  if (!readyStatusNeedsWrite(mapped, finalWrite, truck)) return false;
  const norm = normalizeTruckNumber(mapped.truckNumberDisplay ?? mapped.truckNumberCanonical);
  if (!norm) {
    console.warn(`[LUCA-Writeback] ${label}: ready status but unusable truck number — leaving fleet status as-is`);
    return false;
  }
  const caseKey = norm.display;
  const desc = `${FS_MAIN_SCHEDULING} / ${FS_SUB_TO_BE_SCHEDULED}`;
  if (!apply) {
    console.log(`[LUCA-Writeback][LOG-ONLY] ${label}: WOULD append VRM fleet-status ${caseKey} -> ${desc} (ready call resolves "${truck.mainStatus}")`);
    return true;
  }
  try {
    // Compare-at-write: the guard re-reads the effective status and refuses
    // when an operator (or another writer) moved it out of the replaceable set
    // after resolveTruck read the row — READY_REPLACEABLE_MAIN_STATUSES is
    // enforced both here and at read time on purpose.
    const g = await appendFleetStatusIfMainIn(
      caseKey,
      READY_REPLACEABLE_MAIN_STATUSES,
      FS_MAIN_SCHEDULING,
      FS_SUB_TO_BE_SCHEDULED,
      "LUCA",
    );
    if (!g.applied) {
      console.log(`[LUCA-Writeback] ${label}: ready-status append skipped for ${caseKey} — ${g.skippedReason}`);
      return false;
    }
    invalidateTodaysQueueCache("luca-ready-status");
    console.log(`[LUCA-Writeback] ${label}: VRM fleet-status ${caseKey} -> ${desc} (ready call resolves "${truck.mainStatus}")`);
    return true;
  } catch (err: any) {
    console.warn(
      `[LUCA-Writeback] ${label}: VRM ready-status append failed for ${caseKey} (${err?.message ?? err}) — status left as-is; the queue keeps showing the conflict`,
    );
    return false;
  }
}

/**
 * The raw outbox `reason`. MappedWriteback intentionally collapses reason into a
 * label + callStatus for the FleetScope write, so the VRM lane - which routes on
 * the reason itself - has to read it off the untouched task.
 */
function rawReasonOf(rawItem: unknown): string | null {
  const r = (rawItem as { reason?: unknown } | null)?.reason;
  return typeof r === "string" && r.trim() !== "" ? r.trim() : null;
}

// ─── Core run ────────────────────────────────────────────────────────────────

async function processItem(
  mapped: MappedWriteback,
  rawItem: unknown,
  cfg: LucaWritebackConfig & { baseUrl: string; token: string },
  result: LucaWritebackResult,
): Promise<void> {
  const label = `${mapped.source} ${mapped.externalId}`;

  if (mapped.skip) {
    result.noOp++;
    console.log(`[LUCA-Writeback] ${label}: SKIP (${mapped.skip})`);
    if (cfg.apply) {
      await upsertWritebackLog({
        source: mapped.source,
        externalId: mapped.externalId,
        truckNumber: mapped.truckNumberDisplay,
        truckId: null,
        outcome: "no_op",
        appliedFields: null,
        rawPayload: rawItem,
        errorMessage: mapped.skip,
      });
      // A structurally unusable task would sit PENDING forever — consume it.
      if (mapped.source === "outbox_task" && cfg.markSynced) {
        await markTaskSynced(cfg.baseUrl, cfg.token, mapped.externalId, "fs-luca-writeback-no-op");
      }
    }
    return;
  }

  const dedup = decideRedelivery(await getDedupOutcome(mapped.source, mapped.externalId));
  if (dedup === "skip") {
    result.duplicates++;
    console.log(`[LUCA-Writeback] ${label}: duplicate delivery — already applied, skipping`);
    // The apply happened on a prior run; if the LIVHR PATCH failed back then,
    // re-consume so the task stops re-appearing in the PENDING feed.
    if (cfg.apply && mapped.source === "outbox_task" && cfg.markSynced) {
      await markTaskSynced(cfg.baseUrl, cfg.token, mapped.externalId, "fs-luca-writeback-dup");
    }
    return;
  }

  // ── VRM Ready for Pickup ────────────────────────────────────────────────
  // Runs BEFORE the fs_trucks gate below on purpose. VRM keeps its own case
  // universe, and a truck missing from fs_trucks returns early down there — so
  // wiring this any lower would silently drop the ready signal for exactly the
  // trucks FleetScope has not caught up on. Its idempotency is self-contained
  // (it reads the current workbook status), so the re-delivery that the early
  // return causes is harmless.
  if (mapped.source === "outbox_task" && isReadyReason(rawReasonOf(rawItem))) {
    if (cfg.apply) {
      try {
        const vrm = await applyReadyForPickup({
          truckNumber: mapped.truckNumberDisplay,
          reason: rawReasonOf(rawItem) ?? "",
          detail: (rawItem as any)?.detail ?? null,
          externalId: mapped.externalId,
        });
        if (vrm.outcome === "applied") {
          result.vrmReadyApplied = (result.vrmReadyApplied ?? 0) + 1;
          console.log(`[LUCA-Writeback] ${label}: VRM case ${vrm.caseKey} -> Ready for pickup`);
          // Region-owner email + (if the toggle is on) the automatic pickup
          // text. AWAITED on purpose: the scheduled-deployment trigger exits
          // right after the poll, and a fire-and-forget here would silently
          // lose the email whenever the process dies first. The flip is
          // edge-triggered (task-id idempotency in ready-ingest), so this runs
          // at most once per outbox task, not once per poll.
          try {
            const { notifyReadyFlip } = await import("../vrm/rental-operations/ready-notify");
            const n = await notifyReadyFlip({
              caseKey: vrm.caseKey!,
              detail: (rawItem as any)?.detail ?? null,
              externalId: mapped.externalId,
            });
            console.log(
              `[LUCA-Writeback] ${label}: notify ${n.regionLabel}/${n.owner} — email ${n.email.sent ? "sent" : `not sent (${n.email.reason})`}` +
              `, auto-text ${n.autoText.enabled ? (n.autoText.status ?? n.autoText.reason ?? "?") : "off"}`,
            );
          } catch (err: any) {
            console.warn(`[LUCA-Writeback] ${label}: ready notify failed (non-fatal): ${err?.message}`);
          }
        } else {
          console.log(`[LUCA-Writeback] ${label}: VRM ready no-op (${vrm.outcome}: ${vrm.detail})`);
        }
      } catch (err: any) {
        // Never fatal: the FleetScope half of this run must still complete.
        console.warn(`[LUCA-Writeback] ${label}: VRM ready write failed: ${err?.message}`);
      }
    } else {
      console.log(`[LUCA-Writeback][LOG-ONLY] ${label}: WOULD flip VRM case for truck ${mapped.truckNumberDisplay} to Ready for pickup`);
    }
  }

  // ── VRM Needs Attention ─────────────────────────────────────────────────
  // The counterpart to the ready lane above, and wired for the SAME reason it
  // sits above resolveTruck: a truck missing from fs_trucks returns early below,
  // so anything wired lower is silently dropped for exactly the trucks
  // FleetScope has not caught up on.
  //
  // Before this existed, every non-ready escalation wrote only fs_trucks, which
  // neither VRM page reads — so 157 escalations across 72 trucks on 2026-07-30
  // reached no board at all. Idempotency is self-contained in the ingest (status
  // check + task-id edge trigger), so the re-delivery the early return causes is
  // harmless.
  if (mapped.source === "outbox_task" && isAttentionReason(rawReasonOf(rawItem))) {
    const reason = rawReasonOf(rawItem) ?? "";
    if (cfg.apply) {
      try {
        const vrm = await applyNeedsAttention({
          truckNumber: mapped.truckNumberDisplay,
          reason,
          label: reasonLabel(reason),
          detail: (rawItem as any)?.detail ?? null,
          externalId: mapped.externalId,
        });
        if (vrm.outcome === "applied") {
          result.vrmAttentionApplied = (result.vrmAttentionApplied ?? 0) + 1;
          console.log(`[LUCA-Writeback] ${label}: VRM case ${vrm.caseKey} -> Escalated (${reason})`);
        } else {
          console.log(`[LUCA-Writeback] ${label}: VRM attention no-op (${vrm.outcome}: ${vrm.detail})`);
        }
      } catch (err: any) {
        // Never fatal: the FleetScope half of this run must still complete.
        console.warn(`[LUCA-Writeback] ${label}: VRM attention write failed: ${err?.message}`);
      }
    } else {
      console.log(`[LUCA-Writeback][LOG-ONLY] ${label}: WOULD flag VRM case for truck ${mapped.truckNumberDisplay} as Escalated (${reason})`);
    }
  }

  const truck = await resolveTruck(mapped);
  if (!truck) {
    result.unknownTruck++;
    console.log(
      `[LUCA-Writeback] ${label}: truck ${mapped.truckNumberDisplay} not in fs_trucks — ` +
        `left un-consumed (will retry; truck may appear on the next rental sync)`,
    );
    if (cfg.apply) {
      await upsertWritebackLog({
        source: mapped.source,
        externalId: mapped.externalId,
        truckNumber: mapped.truckNumberDisplay,
        truckId: null,
        outcome: "skipped_unknown_truck",
        appliedFields: null,
        rawPayload: rawItem,
      });
    }
    return;
  }

  // Call outcomes: never double-ingest a conversation Nexus already has
  // (its own caller or a prior LUCA run may have logged it).
  if (mapped.source === "call_outcome" && mapped.callLog) {
    const existingLog = await fleetScopeStorage.getCallLogByConversationId(mapped.externalId);
    if (existingLog) {
      result.duplicates++;
      console.log(`[LUCA-Writeback] ${label}: conversation already in fs_call_logs — skipping`);
      if (cfg.apply) {
        await upsertWritebackLog({
          source: mapped.source,
          externalId: mapped.externalId,
          truckNumber: mapped.truckNumberDisplay,
          truckId: truck.id,
          outcome: "no_op",
          appliedFields: null,
          rawPayload: rawItem,
          errorMessage: "conversation already ingested",
        });
      }
      return;
    }
  }

  // VRM-first: a terminal status appends to VRM fleet-status history (whose
  // write-through mirror updates fs_trucks); only on failure does it ride the
  // direct write below as fallback.
  const terminalViaVrm = await routeTerminalViaVrm(mapped, truck, cfg.apply, label);
  const finalWrite = buildFinalWrite(terminalViaVrm ? { ...mapped, terminal: null } : mapped, truck);
  if (terminalViaVrm) {
    // The append's fs_trucks mirror already stamped last_updated_by =
    // "VRM:LUCA" — the true last STATUS writer. This follow-up write carries
    // call fields only, so it must not reset the marker to "LUCA": the
    // reconcile adopt guard (last_updated_by NOT LIKE 'VRM:%') relies on it
    // to refuse re-adopting a stale fs_trucks value during divergence windows.
    // (Same convention as the VRM phone mirror, which never touches it.)
    delete (finalWrite as Record<string, unknown>).lastUpdatedBy;
  }

  // VRM-first ready status: a surviving phone-confirmed Ready also moves the
  // truck out of the STATUS CONFLICT mains into the pickup pipeline. Ordered
  // after the terminal router — a terminal outcome always outranks ready (the
  // gate refuses any item carrying one). Uses finalWrite, not truckWrite, so
  // a Ready dropped by the stale-call guard can never flip status.
  const readyStatusViaVrm = await routeReadyStatusViaVrm(mapped, finalWrite, truck, cfg.apply, label);
  if (readyStatusViaVrm) {
    // Same convention as the terminal path above: the append's mirror stamped
    // last_updated_by = "VRM:LUCA"; this follow-up write carries call fields
    // only and must not reset that marker.
    delete (finalWrite as Record<string, unknown>).lastUpdatedBy;
  }

  if (!cfg.apply) {
    result.wouldApply++;
    if (result.previews.length < PREVIEW_CAP) {
      result.previews.push({
        source: mapped.source,
        externalId: mapped.externalId,
        truckNumber: mapped.truckNumberDisplay,
        matchedTruckId: truck.id,
        write: finalWrite,
        note: mapped.actionNote,
      });
    }
    console.log(
      `[LUCA-Writeback][LOG-ONLY] ${label}: WOULD update truck ${mapped.truckNumberDisplay} ` +
        `(fs id ${truck.id}): ${JSON.stringify(finalWrite)}` +
        (mapped.callLog ? ` + create fs_call_logs row (${mapped.callLog.status})` : ""),
    );
    return;
  }

  await fleetScopeStorage.updateTruck(truck.id, finalWrite as any);

  if (mapped.callLog) {
    await fleetScopeStorage.createCallLog({
      truckId: truck.id,
      truckNumber: truck.truckNumber?.toString() ?? mapped.truckNumberDisplay ?? "",
      ...mapped.callLog,
    } as any);
  }

  try {
    await fleetScopeStorage.createAction({
      truckId: truck.id,
      actionBy: "LUCA",
      actionType: "luca_writeback",
      actionNote: mapped.actionNote,
    } as any);
  } catch (err: any) {
    console.warn(`[LUCA-Writeback] ${label}: fs_actions audit write failed: ${err?.message}`);
  }

  const logId = await upsertWritebackLog({
    source: mapped.source,
    externalId: mapped.externalId,
    truckNumber: mapped.truckNumberDisplay,
    truckId: truck.id,
    outcome: "applied",
    appliedFields: finalWrite,
    rawPayload: rawItem,
  });

  result.applied++;
  if (result.previews.length < PREVIEW_CAP) {
    result.previews.push({
      source: mapped.source,
      externalId: mapped.externalId,
      truckNumber: mapped.truckNumberDisplay,
      matchedTruckId: truck.id,
      write: finalWrite,
      note: "APPLIED",
    });
  }
  console.log(
    `[LUCA-Writeback] ${label}: APPLIED to truck ${mapped.truckNumberDisplay} (fs id ${truck.id})`,
  );

  if (mapped.source === "outbox_task" && cfg.markSynced) {
    await markTaskSynced(cfg.baseUrl, cfg.token, mapped.externalId, `fs-luca-writeback-${logId}`);
  }
}

async function runInner(
  triggeredBy: string,
  cfg: LucaWritebackConfig & { baseUrl: string; token: string },
): Promise<LucaWritebackResult> {
  const result = emptyResult(cfg.apply);

  if (cfg.apply) {
    await fsPool.query(ENSURE_WRITEBACK_TABLE_SQL);
  }

  // sync_logs run record: always in apply mode; log-only records one only on
  // failure (log-only must write nothing on the happy path).
  let syncLogId: string | null = null;
  if (cfg.apply) {
    try {
      const row = await storage.createSyncLog({
        syncType: LUCA_WRITEBACK_SYNC_TYPE,
        status: "running",
        triggeredBy,
      });
      syncLogId = row.id;
    } catch (err: any) {
      console.warn(`[LUCA-Writeback] could not open sync_logs row: ${err?.message}`);
    }
  }

  try {
    const tasks = await fetchPendingTasks(cfg.baseUrl, cfg.token);
    result.tasksFetched = tasks.length;
    console.log(
      `[LUCA-Writeback] fetched ${tasks.length} PENDING outbox task(s) from ${cfg.baseUrl} ` +
        `(mode: ${cfg.apply ? "APPLY" : "LOG-ONLY"}${cfg.apply && !cfg.markSynced ? ", mark-synced OFF" : ""})`,
    );

    for (const task of tasks) {
      try {
        await processItem(mapOutboxTask(task), task, cfg, result);
      } catch (err: any) {
        result.errors++;
        console.error(
          `[LUCA-Writeback] outbox task ${task?.id}: item error: ${err?.message ?? err}`,
        );
      }
    }

    if (cfg.callOutcomesPath) {
      const outcomes = await fetchCallOutcomes(cfg.baseUrl, cfg.token, cfg.callOutcomesPath);
      if (outcomes) {
        result.outcomesFetched = outcomes.length;
        for (const item of outcomes) {
          try {
            await processItem(mapCallOutcome(item), item, cfg, result);
          } catch (err: any) {
            result.errors++;
            console.error(
              `[LUCA-Writeback] call outcome ${item?.conversationId}: item error: ${err?.message ?? err}`,
            );
          }
        }
      }
    }

    if (syncLogId) {
      await storage.updateSyncLog(syncLogId, {
        status: "completed",
        completedAt: new Date(),
        recordsProcessed: result.tasksFetched + result.outcomesFetched,
        recordsUpdated: result.applied,
        errorMessage:
          result.errors > 0 ? `${result.errors} item error(s) — see deployment log` : null,
      } as any);
    }

    console.log(
      `[LUCA-Writeback] run complete — tasks=${result.tasksFetched} outcomes=${result.outcomesFetched} ` +
        `applied=${result.applied} wouldApply=${result.wouldApply} unknownTruck=${result.unknownTruck} ` +
        `duplicates=${result.duplicates} noOp=${result.noOp} errors=${result.errors}`,
    );
    return result;
  } catch (err: any) {
    const message = err?.message ?? String(err);
    if (syncLogId) {
      try {
        await storage.updateSyncLog(syncLogId, {
          status: "failed",
          completedAt: new Date(),
          errorMessage: message,
        } as any);
      } catch {
        /* best-effort */
      }
    } else {
      // Log-only / no-open-row failure: record a terminal failed row so a dead
      // scheduled job is visible in sync_logs, not only in its own run log.
      await recordFailedLucaWriteback(message, triggeredBy);
    }
    throw err;
  }
}

/** Best-effort terminal 'failed' sync_logs row (mirrors recordFailedRentalSync). */
export async function recordFailedLucaWriteback(
  message: string,
  triggeredBy: string,
): Promise<void> {
  try {
    const row = await storage.createSyncLog({
      syncType: LUCA_WRITEBACK_SYNC_TYPE,
      status: "failed",
      triggeredBy,
    });
    await storage.updateSyncLog(row.id, {
      completedAt: new Date(),
      errorMessage: message,
    } as any);
  } catch (err: any) {
    console.warn(`[LUCA-Writeback] could not record failed sync_logs row: ${err?.message}`);
  }
}

/**
 * Run one write-back poll. Safe to call from the Scheduled Deployment script,
 * the in-process timer, or ad hoc — a cross-process advisory lock plus the
 * dedup table make overlapping triggers benign.
 */
export async function runLucaWriteback(triggeredBy: string): Promise<LucaWritebackResult> {
  const cfg = readConfig();
  if (!cfg.baseUrl || !cfg.token) {
    console.log(
      "[LUCA-Writeback] LIVHR_BASE_URL / LIVHR_AGENT_TOKEN not set — write-back disabled (no-op)",
    );
    return { ...emptyResult(cfg.apply), disabled: true };
  }
  const fullCfg = cfg as LucaWritebackConfig & { baseUrl: string; token: string };

  try {
    return await runUnderAdvisoryLock(
      LUCA_WRITEBACK_LOCK,
      `luca-writeback:${triggeredBy}`,
      () => runInner(triggeredBy, fullCfg),
    );
  } catch (err) {
    if (err instanceof AdvisoryLockUnavailableError) {
      console.log(
        "[LUCA-Writeback] another write-back poll is already running (advisory lock held) — skipping",
      );
      return { ...emptyResult(cfg.apply), skipped: true };
    }
    throw err;
  }
}

// ─── In-process best-effort scheduler ────────────────────────────────────────

let inProcessTimer: NodeJS.Timeout | null = null;

/**
 * Best-effort warm-path poller (secondary; the Scheduled Deployment running
 * server/run-luca-writeback.ts is the durable trigger — on autoscale,
 * in-process timers stop firing when instances scale to zero).
 * Returns true when armed, false when unconfigured/already armed.
 */
export function startInProcessLucaWriteback(): boolean {
  if (inProcessTimer) return false;
  const cfg = readConfig();
  if (!cfg.baseUrl || !cfg.token) {
    console.log(
      "[LUCA-Writeback] LIVHR_BASE_URL / LIVHR_AGENT_TOKEN not set — in-process poller idle",
    );
    return false;
  }
  const intervalMin = Number.parseInt(process.env.LUCA_WRITEBACK_INTERVAL_MIN ?? "15", 10);
  const intervalMs = (Number.isFinite(intervalMin) && intervalMin > 0 ? intervalMin : 15) * 60_000;
  const tick = () =>
    runLucaWriteback("in_process").catch((e) =>
      console.error("[LUCA-Writeback] in-process poll error:", e?.message ?? e),
    );
  // Delay the first tick so boot settles (listen-first autoscale pattern).
  setTimeout(tick, 45_000);
  inProcessTimer = setInterval(tick, intervalMs);
  console.log(
    `[LUCA-Writeback] in-process poller armed (every ${intervalMs / 60_000}min; ` +
      `mode: ${cfg.apply ? "APPLY" : "LOG-ONLY"}; secondary path — Scheduled Deployment is primary)`,
  );
  return true;
}
