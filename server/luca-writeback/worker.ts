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
  FS_TERMINAL_MAIN_STATUSES,
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
  const markSynced = !/^(false|0|no)$/i.test(
    (process.env.LUCA_WRITEBACK_MARK_SYNCED ?? "").trim(),
  );
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

  if (mapped.terminal) {
    const currentMain = truck.mainStatus ?? "";
    if (!FS_TERMINAL_MAIN_STATUSES.includes(currentMain)) {
      write.mainStatus = mapped.terminal.mainStatus;
      write.subStatus = mapped.terminal.subStatus;
    }
  }
  return write;
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

  const finalWrite = buildFinalWrite(mapped, truck);

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
