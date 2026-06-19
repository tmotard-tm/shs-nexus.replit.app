/**
 * Tier-3 backstop reconciler — MATERIALIZER (T004).
 *
 * Turns the SHARED decision stream (engine.ts `iterateDecisions`) into the durable
 * substrate the executor later drains:
 *   - `reconciliation_runs`  — one row per invocation (gates, totals, approvals).
 *   - `reconciliation_items` — one row per per-leg proposed write (the resumable,
 *     leased state machine). Real writes -> 'queued'; flag-only outcomes ->
 *     'flagged'; AMS overnight-batch -> 'awaiting_batch'.
 *   - `ams_inflight_stamps`  — cross-run AMS propagation stamps (#17), upserted in
 *     the SAME bounded tx as their awaiting_batch item to avoid the proposal<->stamp race.
 *   - `holman_lifecycle_flags` / `contested_flags` — L2/L3 GATING state (no items).
 *
 * This module performs NO external writes and NO before-images — it only QUEUES.
 * Execution (W1 re-confirm -> before-image -> external write -> cache write ->
 * verify) is the separate leased phase. Materialization completes in ONE request.
 *
 * Gate ordering (#2, #1): G0 freshness + G1 row-count BEFORE the live downstream
 * pulls (short-circuit), then G2 volume circuit-breaker BEFORE any item is
 * inserted. A halted run persists ONLY the run row (gates + alertMessage) with
 * zero items. G2 is STRUCTURAL: only a supervised `backfill` with an approver +
 * a verified canary may bypass it.
 */

import { db } from '../db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  reconciliationRuns,
  reconciliationItems,
  amsInflightStamps,
  holmanLifecycleFlags,
  contestedFlags,
  type InsertReconciliationItem,
} from '@shared/schema';
import { evaluateVolumeGuard } from './decision';
import { loadReconContext, iterateDecisions, type DecisionContext } from './engine';

export type RunKind = 'dry_run' | 'canary' | 'backfill' | 'nightly';

export interface MaterializeOptions {
  kind?: RunKind; // default 'nightly'
  requestedBy?: string;
  approvedBy?: string;
  // G2 bypass (backfill only) — ALL of these are required to override the guard.
  g2Exempt?: boolean;
  g2ExemptReason?: string;
  canaryRunId?: string;
  batchSize?: number;
  // Canary slice (#8): restrict materialization to these canonical truck#s.
  onlyTrucks?: Set<string>;
  // fast (default) vs live-confirm authority. Materialization defaults to fast;
  // the live confirm happens at execution (W1). Canaries may opt into liveConfirm.
  liveConfirm?: boolean;
  liveConfirmLimit?: number;
  freshnessWindowDays?: number;
  exemptMaxAgeDays?: number;
  guardThresholdPct?: number;
  onPhase?: (msg: string) => void;
}

export interface MaterializeResult {
  runId: string;
  kind: RunKind;
  status: 'completed' | 'halted';
  halted: boolean;
  haltReason?: string;
  acceptedFileDate: string | null;
  gates: {
    g0: { ok: boolean; ageDays: number | null; reason?: string };
    g1: { ok: boolean; reason?: string };
    g2: { halt: boolean; ceiling: number; totalProposed: number; bypassed: boolean };
  };
  proposedWriteTotal: number;
  itemsQueued: number;
  itemsFlagged: number;
  itemsAwaitingBatch: number;
  lifecycleFlags: number;
  contestedFlags: number;
  totals: {
    byOutcome: Record<string, number>;
    byStatus: Record<string, number>;
    byLadder: Record<string, number>;
  };
  elapsedMs: number;
}

const ACTIVE_STATUSES = ['queued', 'applying', 'external_applied_cache_pending', 'retry_scheduled', 'awaiting_batch'];

const FLAG_REASONS: Record<string, string> = {
  WMS_MISSING_FLAG: 'truck absent from WMS getAllTrucks() — not a WMS entity, no create',
  FLAG_MOVE: 'WMS move/displacement or different tech — manual review (#9)',
  COSTCENTER_SKIP_FLAG: 'no district_cost_centers mapping for district — never blank/guess (#3)',
  AMS_RESYNC_FLAG: 'AMS still diverged after overnight window — resync cache to live + manual review (#10)',
  AMS_MISSING_FLAG: 'truck absent from AMS bulk pull — not an AMS entity, no write',
  HOLMAN_MISSING_FLAG: 'truck absent from Holman bulk pull — no write',
};

function idemKey(
  system: string,
  action: string,
  field: string,
  canon: string,
  desiredEnterpriseId: string | null,
  desiredValue: string | null,
): string {
  const tail = desiredEnterpriseId ?? desiredValue ?? '^null^';
  return `${system}:${action}:${field}:${canon}:${tail}`;
}

type LegName = 'wms' | 'wmsCostCenter' | 'ams' | 'holman';

const REAL_WRITE_OUTCOMES = new Set([
  'WMS_ASSIGN',
  'WMS_GHOST_CLEAR',
  'COSTCENTER_FIX',
  'AMS_ASSIGN',
  'HOLMAN_ASSIGN',
  'HOLMAN_GHOST_CLEAR',
]);

/**
 * Map a single decided leg to a staged reconciliation_item (or null for NOOP /
 * AMS_SUPPRESS which produce no row). Pure — no I/O.
 */
function stageLeg(runId: string, legName: LegName, dc: DecisionContext): InsertReconciliationItem | null {
  const leg = dc.decision.legs[legName];
  if (!leg) return null;
  const outcome = leg.outcome;
  if (outcome === 'NOOP' || outcome === 'AMS_SUPPRESS') return null;

  const canon = dc.canon;
  const truckNumber = dc.aims.truckNo;
  const ownerX = dc.authority.kind === 'owner' ? dc.authority.enterpriseId : null;

  const system: 'wms' | 'ams' | 'holman' =
    legName === 'ams' ? 'ams' : legName === 'holman' ? 'holman' : 'wms';
  const field: 'assignment' | 'cost_center' = legName === 'wmsCostCenter' ? 'cost_center' : 'assignment';

  let action: 'assign' | 'clear' | 'cost_center';
  let desiredEnterpriseId: string | null = null;
  let desiredValue: string | null = null;
  let expectedBeforeValue: string | null = null;
  let status = 'queued';

  switch (outcome) {
    // ---- WMS assignment ----
    case 'WMS_ASSIGN':
      action = 'assign';
      desiredEnterpriseId = ownerX;
      expectedBeforeValue = dc.w?.tech ?? null;
      break;
    case 'WMS_GHOST_CLEAR':
      action = 'clear';
      desiredValue = '^null^';
      expectedBeforeValue = dc.w?.tech ?? null;
      break;
    case 'WMS_MISSING_FLAG':
      action = ownerX ? 'assign' : 'clear';
      desiredEnterpriseId = ownerX;
      status = 'flagged';
      break;
    case 'FLAG_MOVE':
      action = 'assign';
      desiredEnterpriseId = ownerX;
      expectedBeforeValue = dc.w?.tech ?? null;
      status = 'flagged';
      break;

    // ---- WMS cost-center ----
    case 'COSTCENTER_FIX':
      action = 'cost_center';
      desiredValue = dc.expectedCostCenter;
      expectedBeforeValue = dc.w?.costCenter ?? null;
      break;
    case 'COSTCENTER_SKIP_FLAG':
      action = 'cost_center';
      status = 'flagged';
      break;

    // ---- AMS ----
    case 'AMS_ASSIGN':
      action = 'assign';
      desiredEnterpriseId = ownerX;
      expectedBeforeValue = dc.a?.tech ?? null;
      break;
    case 'AMS_AWAIT_BATCH':
      action = 'clear';
      desiredValue = '^null^';
      expectedBeforeValue = dc.a?.tech ?? null;
      status = 'awaiting_batch';
      break;
    case 'AMS_RESYNC_FLAG':
      action = 'clear';
      desiredValue = '^null^';
      expectedBeforeValue = dc.a?.tech ?? null;
      status = 'flagged';
      break;
    case 'AMS_MISSING_FLAG':
      action = ownerX ? 'assign' : 'clear';
      desiredEnterpriseId = ownerX;
      status = 'flagged';
      break;

    // ---- Holman ----
    case 'HOLMAN_ASSIGN':
      action = 'assign';
      desiredEnterpriseId = ownerX;
      expectedBeforeValue = dc.h?.tech ?? null;
      break;
    case 'HOLMAN_GHOST_CLEAR':
      action = 'clear';
      desiredValue = '^null^';
      expectedBeforeValue = dc.h?.tech ?? null;
      break;
    case 'HOLMAN_MISSING_FLAG':
      action = ownerX ? 'assign' : 'clear';
      desiredEnterpriseId = ownerX;
      status = 'flagged';
      break;

    default:
      return null;
  }

  return {
    runId,
    system,
    ruleId: outcome,
    action,
    field,
    truckCanonical: canon,
    truckNumber,
    desiredEnterpriseId,
    desiredValue,
    expectedBeforeValue,
    idempotencyKey: idemKey(system, action, field, canon, desiredEnterpriseId, desiredValue),
    status,
    lastError: status === 'flagged' ? FLAG_REASONS[outcome] ?? outcome : null,
  } as InsertReconciliationItem;
}

async function finishHalted(
  runId: string,
  reason: string,
  gates: MaterializeResult['gates'],
  acceptedFileDate: string | null,
): Promise<void> {
  await db
    .update(reconciliationRuns)
    .set({
      status: 'halted',
      gates: gates as unknown as object,
      acceptedFileDate,
      alertMessage: reason,
      finishedAt: new Date(),
    })
    .where(eq(reconciliationRuns.id, runId));
}

/**
 * A mid-run failure (DB error, downstream pull throw) must mark the run 'failed'
 * so it never sticks at 'running' with partial rows.
 */
async function finishFailed(runId: string, message: string): Promise<void> {
  await db
    .update(reconciliationRuns)
    .set({ status: 'failed', alertMessage: message, finishedAt: new Date() })
    .where(eq(reconciliationRuns.id, runId));
}

/**
 * Build (and persist) the reconciliation queue for a run. No external writes.
 */
export async function materialize(opts: MaterializeOptions = {}): Promise<MaterializeResult> {
  const start = Date.now();
  const kind: RunKind = opts.kind ?? 'nightly';

  // ---- 1) Open the run row (status running) so items can FK to it. ----
  const [run] = await db
    .insert(reconciliationRuns)
    .values({
      kind,
      status: 'running',
      g2Exempt: opts.g2Exempt ?? false,
      g2ExemptReason: opts.g2ExemptReason ?? null,
      canaryRunId: opts.canaryRunId ?? null,
      batchSize: opts.batchSize ?? null,
      approvedBy: opts.approvedBy ?? null,
      approvedAt: opts.approvedBy ? new Date() : null,
      requestedBy: opts.requestedBy ?? null,
      startedAt: new Date(),
    })
    .returning({ id: reconciliationRuns.id });
  const runId = run.id;

  try {
  // ---- 2) Shared context (short-circuit downstream pulls if G0/G1 fail). ----
  const ctx = await loadReconContext({
    freshnessWindowDays: opts.freshnessWindowDays,
    guardThresholdPct: opts.guardThresholdPct,
    exemptMaxAgeDays: opts.exemptMaxAgeDays,
    shortCircuitOnGateFail: true,
    onPhase: opts.onPhase,
    phaseStart: start,
  });
  const acceptedFileDate = ctx.snapshot.fileDate || null;

  const gates: MaterializeResult['gates'] = {
    g0: ctx.g0,
    g1: ctx.g1,
    g2: { halt: false, ceiling: 0, totalProposed: 0, bypassed: false },
  };

  // ---- 3) G0 / G1 gate — halt before any pull/iteration. ----
  if (!ctx.gatesPassed) {
    const reason = !ctx.g0.ok
      ? `G0 freshness failed: ${ctx.g0.reason ?? 'stale/missing extract'} (ageDays=${ctx.g0.ageDays})`
      : `G1 row-count floor failed: ${ctx.g1.reason ?? 'too few rows'}`;
    await finishHalted(runId, reason, gates, acceptedFileDate);
    return haltedResult(runId, kind, reason, acceptedFileDate, gates, start);
  }

  // ---- 4) Iterate the shared decision stream; stage items + flags + stamps. ----
  const items: InsertReconciliationItem[] = [];
  const lifecycle: { canon: string; truckNumber: string; reason: string; holmanStatus: string | null }[] = [];
  const contested: { canon: string; truckNumber: string; reason: string; aimsOwner: string | null }[] = [];
  const suppressBumps: { canon: string }[] = [];

  const byOutcome: Record<string, number> = {};
  const byLadder: Record<string, number> = {};
  let proposedWriteTotal = 0;

  const bump = (m: Record<string, number>, k: string) => {
    m[k] = (m[k] ?? 0) + 1;
  };

  for await (const dc of iterateDecisions(ctx, {
    liveConfirm: opts.liveConfirm,
    liveConfirmLimit: opts.liveConfirmLimit,
    exemptMaxAgeDays: opts.exemptMaxAgeDays,
    onlyTrucks: opts.onlyTrucks,
    onPhase: opts.onPhase,
  })) {
    bump(byLadder, dc.decision.ladder);
    proposedWriteTotal += dc.decision.proposedWriteCount;

    // L2 lifecycle hold -> flag table only, no items.
    if (dc.decision.ladder === 'WRITE_HOLD_LIFECYCLE') {
      lifecycle.push({
        canon: dc.canon,
        truckNumber: dc.aims.truckNo,
        reason: 'TPMS-active but Holman Sold/OOS — full write-hold (#4)',
        holmanStatus: null,
      });
      bump(byOutcome, 'WRITE_HOLD_LIFECYCLE');
      continue;
    }
    // L3 contested hold -> flag table only, no items.
    if (dc.decision.ladder === 'HOLD_CONTESTED') {
      contested.push({
        canon: dc.canon,
        truckNumber: dc.aims.truckNo,
        reason: dc.authority.kind === 'contested' ? dc.authority.reason : 'authority contested (#11)',
        aimsOwner: dc.aims.ownerEnterpriseId ?? null,
      });
      bump(byOutcome, 'HOLD_CONTESTED');
      continue;
    }
    // L0 / L1 -> nothing.
    if (dc.decision.ladder !== 'EVALUATE') {
      bump(byOutcome, dc.decision.ladder);
      continue;
    }

    // L4 per-leg.
    for (const legName of ['wms', 'wmsCostCenter', 'ams', 'holman'] as LegName[]) {
      const leg = dc.decision.legs[legName];
      if (!leg) continue;
      bump(byOutcome, leg.outcome);
      if (leg.outcome === 'AMS_SUPPRESS') {
        suppressBumps.push({ canon: dc.canon });
        continue;
      }
      const staged = stageLeg(runId, legName, dc);
      if (staged) items.push(staged);
    }
  }

  // ---- 5) G2 volume circuit-breaker (BEFORE inserting any item). ----
  const g2eval = evaluateVolumeGuard(proposedWriteTotal, ctx.snapshot.activeRows, ctx.guardThresholdPct);
  gates.g2 = { halt: g2eval.halt, ceiling: g2eval.ceiling, totalProposed: proposedWriteTotal, bypassed: false };

  if (g2eval.halt) {
    const authorized = await isG2BypassAuthorized(opts);
    if (!authorized) {
      const reason = `G2 volume guard tripped: ${proposedWriteTotal} proposed > ceiling ${g2eval.ceiling} (${Math.round(
        ctx.guardThresholdPct * 100,
      )}% of ${ctx.snapshot.activeRows} active). Execute nothing.`;
      await finishHalted(runId, reason, gates, acceptedFileDate);
      return haltedResult(runId, kind, reason, acceptedFileDate, gates, start);
    }
    gates.g2.bypassed = true; // supervised backfill exception (#1/#6/#8)
  }

  // ---- 6) Persist: chunked item inserts (+ same-tx AMS stamps), then flags. ----
  // byStatus counts rows ACTUALLY inserted (returning()), NOT staged: under a
  // cross-run conflict onConflictDoNothing drops the row, and a dropped row must
  // neither be counted nor AMS-stamped.
  const now = new Date();
  const CHUNK = 500;
  const byStatus: Record<string, number> = {};
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    await db.transaction(async (tx) => {
      // onConflictDoNothing (no target) catches ALL unique indexes: runIdempUq
      // (re-materialize) + activeIdempUq + activeTargetUq (cross-run guards).
      const inserted = await tx
        .insert(reconciliationItems)
        .values(chunk)
        .onConflictDoNothing()
        .returning({
          truckCanonical: reconciliationItems.truckCanonical,
          truckNumber: reconciliationItems.truckNumber,
          status: reconciliationItems.status,
        });
      for (const row of inserted) {
        bump(byStatus, row.status ?? 'queued');
        if (row.status === 'awaiting_batch') {
          await tx
            .insert(amsInflightStamps)
            .values({
              truckCanonical: row.truckCanonical,
              truckNumber: row.truckNumber ?? null,
              submittedToAmsAt: now, // first-observed
              reason: 'AMS ghost awaiting overnight batch (#17)',
              lastSeenDivergedAt: now,
            })
            .onConflictDoUpdate({
              target: amsInflightStamps.truckCanonical,
              // keep first-observed submittedToAmsAt; only refresh the diverged marker.
              set: { lastSeenDivergedAt: now, updatedAt: now },
            });
        }
      }
    });
  }

  // AMS_SUPPRESS: bump lastSeenDivergedAt on the existing (unresolved) stamp.
  for (const s of suppressBumps) {
    await db
      .update(amsInflightStamps)
      .set({ lastSeenDivergedAt: now, updatedAt: now })
      .where(and(eq(amsInflightStamps.truckCanonical, s.canon), isNull(amsInflightStamps.resolvedAt)));
  }

  // L2 lifecycle flags (open-flag upsert; bump lastSeen if already open).
  for (const f of lifecycle) {
    await db
      .insert(holmanLifecycleFlags)
      .values({
        truckCanonical: f.canon,
        truckNumber: f.truckNumber,
        reason: f.reason,
        holmanStatus: f.holmanStatus,
      })
      .onConflictDoUpdate({
        target: holmanLifecycleFlags.truckCanonical,
        targetWhere: sql`${holmanLifecycleFlags.resolvedAt} is null`,
        set: { lastSeen: now, reason: f.reason, updatedAt: now },
      });
  }

  // L3 contested flags (open-flag upsert).
  for (const f of contested) {
    await db
      .insert(contestedFlags)
      .values({
        truckCanonical: f.canon,
        truckNumber: f.truckNumber,
        reason: f.reason,
        aimsOwner: f.aimsOwner,
      })
      .onConflictDoUpdate({
        target: contestedFlags.truckCanonical,
        targetWhere: sql`${contestedFlags.resolvedAt} is null`,
        set: { lastSeen: now, reason: f.reason, aimsOwner: f.aimsOwner, updatedAt: now },
      });
  }

  // ---- 7) Tally by status + close out the run row. ----
  const totals = { byOutcome, byStatus, byLadder };
  await db
    .update(reconciliationRuns)
    .set({
      status: 'completed',
      gates: gates as unknown as object,
      totals: totals as unknown as object,
      acceptedFileDate,
      finishedAt: new Date(),
    })
    .where(eq(reconciliationRuns.id, runId));

  return {
    runId,
    kind,
    status: 'completed',
    halted: false,
    acceptedFileDate,
    gates,
    proposedWriteTotal,
    itemsQueued: byStatus['queued'] ?? 0,
    itemsFlagged: byStatus['flagged'] ?? 0,
    itemsAwaitingBatch: byStatus['awaiting_batch'] ?? 0,
    lifecycleFlags: lifecycle.length,
    contestedFlags: contested.length,
    totals,
    elapsedMs: Date.now() - start,
  };
  } catch (err) {
    // Never leave the run stuck at 'running' with partial rows.
    await finishFailed(runId, err instanceof Error ? err.message : String(err)).catch(() => {});
    throw err;
  }
}

/**
 * G2 bypass is STRUCTURAL: only a supervised `backfill` with g2Exempt + an
 * approver + an explicit reason + a canary run that was actually EXECUTED and
 * VERIFIED (kind='canary' with verifiedAt set by the verification step) may
 * exceed the volume ceiling. A merely-materialized canary (status='completed',
 * no writes yet) is NOT sufficient — otherwise a bug could queue a ~1,500-write
 * backfill behind a canary that never wrote anything (#8).
 */
async function isG2BypassAuthorized(opts: MaterializeOptions): Promise<boolean> {
  if (opts.kind !== 'backfill') return false;
  if (!opts.g2Exempt || !opts.approvedBy || !opts.g2ExemptReason || !opts.canaryRunId) return false;
  const [canary] = await db
    .select({ kind: reconciliationRuns.kind, verifiedAt: reconciliationRuns.verifiedAt })
    .from(reconciliationRuns)
    .where(eq(reconciliationRuns.id, opts.canaryRunId))
    .limit(1);
  return !!canary && canary.kind === 'canary' && canary.verifiedAt != null;
}

function haltedResult(
  runId: string,
  kind: RunKind,
  reason: string,
  acceptedFileDate: string | null,
  gates: MaterializeResult['gates'],
  start: number,
): MaterializeResult {
  return {
    runId,
    kind,
    status: 'halted',
    halted: true,
    haltReason: reason,
    acceptedFileDate,
    gates,
    proposedWriteTotal: gates.g2.totalProposed,
    itemsQueued: 0,
    itemsFlagged: 0,
    itemsAwaitingBatch: 0,
    lifecycleFlags: 0,
    contestedFlags: 0,
    totals: { byOutcome: {}, byStatus: {}, byLadder: {} },
    elapsedMs: Date.now() - start,
  };
}
