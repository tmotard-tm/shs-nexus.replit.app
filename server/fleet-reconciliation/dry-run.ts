/**
 * Tier-3 backstop reconciler — DRY-RUN engine (T003).
 *
 * Computes per-truck desired state vs every downstream system and emits a diff
 * report with ZERO writes. Every truck is tagged with the #20 truth-table rule id
 * (via the pure `decideTruck` oracle) so the report is assertable against the spec
 * and the T009 unit tests share the same decision code.
 *
 * As of T004 the per-truck loop is the SHARED engine (`loadReconContext` +
 * `iterateDecisions`) so the dry-run tally and the materializer persist from the
 * exact same decision stream — they can never diverge. This module only TALLIES;
 * it performs no writes.
 *
 * Authority modes:
 *  - fast (default): AIMS snapshot owner (OWNERLDAPID alone) — reproduces the drift
 *    baseline without 1,651 live /techinfo calls.
 *  - liveConfirm: per-truck live /techinfo confirmation via resolveTruckAuthority —
 *    surfaces the `contested` bucket; optionally capped via liveConfirmLimit.
 * Live confirmation is enforced unconditionally at WRITE time (W1) regardless of mode.
 */

import { loadReconContext, iterateDecisions } from './engine';
import {
  evaluateVolumeGuard,
  type LadderResult,
} from './decision';

export interface DryRunOptions {
  liveConfirm?: boolean;
  liveConfirmLimit?: number;
  freshnessWindowDays?: number;
  exemptMaxAgeDays?: number;
  guardThresholdPct?: number;
  sampleSize?: number; // truck#s captured per outcome for spot-checking
  onPhase?: (msg: string) => void; // optional progress hook (operational logging)
}

export interface DryRunReport {
  generatedAt: string;
  todayEt: string;
  mode: 'fast' | 'liveConfirm';
  snapshot: {
    fileDate: string;
    totalRows: number;
    activeRows: number;
    ownerRows: number;
    vacantRows: number;
    distinctActiveTrucks: number;
  };
  gates: {
    g0: { ok: boolean; ageDays: number | null; reason?: string };
    g1: { ok: boolean; reason?: string };
    g2: { halt: boolean; ceiling: number; totalProposed: number };
  };
  downstream: {
    wms: { rawCount: number; distinctCanonical: number; duplicateCanonical: number };
    ams: { rawCount: number; pages: number; truncated: boolean };
    holman: { rawCount: number; pages: number };
  };
  completeness: { wmsRawCount: number; aimsActive: number; ok: boolean; note?: string };
  ladder: Record<LadderResult, number>;
  outcomes: Record<string, number>;
  rawDrift: {
    wmsMissing: number;
    wmsDifferent: number;
    wmsAbsent: number;
    wmsGhost: number;
    wmsMoveDisplaced: number;
    costCenterDrift: number;
    costCenterNoMapping: number;
    amsMissing: number;
    amsGhost: number;
    holmanConflict: number;
    holmanGhost: number;
    holmanAbsent: number;
    lifecycleConflict: number;
  };
  proposedWriteTotal: number;
  forcedReconcileCount: number;
  halted: boolean;
  sampleByOutcome: Record<string, string[]>;
  elapsedMs: number;
}

function emptyOutcomeTally(): Record<string, number> {
  return {};
}

function tally(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

export async function runDryRun(opts: DryRunOptions = {}): Promise<DryRunReport> {
  const start = Date.now();
  const sampleSize = opts.sampleSize ?? 5;
  const mode: 'fast' | 'liveConfirm' = opts.liveConfirm ? 'liveConfirm' : 'fast';

  // ---- Shared context: snapshot, gates, live pulls, AMS stamps (#17) ----
  // shortCircuitOnGateFail=false: the dry-run ALWAYS pulls downstream so its
  // diagnostic counts are reported even when G0/G1 would halt a real run.
  const ctx = await loadReconContext({
    freshnessWindowDays: opts.freshnessWindowDays,
    guardThresholdPct: opts.guardThresholdPct,
    exemptMaxAgeDays: opts.exemptMaxAgeDays,
    shortCircuitOnGateFail: false,
    onPhase: opts.onPhase,
    phaseStart: start,
  });
  const { snapshot, wms, ams, holman } = ctx;

  const ladder: Record<LadderResult, number> = {
    OUT_OF_SCOPE: 0,
    SKIP_EXEMPT: 0,
    WRITE_HOLD_LIFECYCLE: 0,
    HOLD_CONTESTED: 0,
    EVALUATE: 0,
  };
  const outcomes = emptyOutcomeTally();
  const rawDrift = {
    wmsMissing: 0,
    wmsDifferent: 0,
    wmsAbsent: 0,
    wmsGhost: 0,
    wmsMoveDisplaced: 0,
    costCenterDrift: 0,
    costCenterNoMapping: 0,
    amsMissing: 0,
    amsGhost: 0,
    holmanConflict: 0,
    holmanGhost: 0,
    holmanAbsent: 0,
    lifecycleConflict: 0,
  };
  const sampleByOutcome: Record<string, string[]> = {};
  function sample(key: string, truckNo: string): void {
    const arr = sampleByOutcome[key] ?? (sampleByOutcome[key] = []);
    if (arr.length < sampleSize) arr.push(truckNo);
  }

  let proposedWriteTotal = 0;
  let forcedReconcileCount = 0;

  for await (const dc of iterateDecisions(ctx, {
    liveConfirm: opts.liveConfirm,
    liveConfirmLimit: opts.liveConfirmLimit,
    exemptMaxAgeDays: opts.exemptMaxAgeDays,
    onPhase: opts.onPhase,
  })) {
    const { authority, decision, w, a, h, lifecycleConflict, techOnOtherTruck } = dc;

    ladder[decision.ladder]++;
    if (decision.forcedReconcile) forcedReconcileCount++;
    proposedWriteTotal += decision.proposedWriteCount;
    tally(outcomes, `LADDER_${decision.ladder}`);
    for (const leg of [decision.legs.wms, decision.legs.wmsCostCenter, decision.legs.ams, decision.legs.holman]) {
      if (leg) {
        tally(outcomes, leg.outcome);
        sample(leg.outcome, dc.aims.truckNo);
      }
    }
    sample(`LADDER_${decision.ladder}`, dc.aims.truckNo);

    // ---- Raw drift (ladder-independent, for baseline matching) ----
    if (lifecycleConflict) rawDrift.lifecycleConflict++;

    if (authority.kind === 'owner') {
      const X = authority.enterpriseId;
      if (!w) rawDrift.wmsAbsent++;
      else if (w.tech === null) {
        if (techOnOtherTruck) rawDrift.wmsMoveDisplaced++;
        else rawDrift.wmsMissing++;
      } else if (w.tech !== X) {
        rawDrift.wmsDifferent++;
        rawDrift.wmsMoveDisplaced++;
      }
      // cost-center drift only meaningful on the assign/already-X path
      if (w && (w.tech === null || w.tech === X)) {
        if (authority.expectedCostCenter === null) rawDrift.costCenterNoMapping++;
        else if (w.costCenter !== authority.expectedCostCenter) rawDrift.costCenterDrift++;
      }
      if (!a) rawDrift.amsMissing++;
      else if (a.tech !== X) rawDrift.amsMissing++;
      if (!h) rawDrift.holmanAbsent++;
      else if (!lifecycleConflict && h.tech !== X) rawDrift.holmanConflict++;
    } else if (authority.kind === 'vacant') {
      if (w && w.tech !== null) rawDrift.wmsGhost++;
      if (a && a.tech !== null) rawDrift.amsGhost++;
      if (h && h.tech !== null) rawDrift.holmanGhost++;
    }
  }

  opts.onPhase?.(
    `[+${Math.round((Date.now() - start) / 1000)}s] per-truck loop done: ${proposedWriteTotal} proposed writes`,
  );

  // ---- G2 volume guard (after proposals computed) ----
  const g2eval = evaluateVolumeGuard(proposedWriteTotal, snapshot.activeRows, ctx.guardThresholdPct);
  const halted = !ctx.g0.ok || !ctx.g1.ok || g2eval.halt;

  return {
    generatedAt: new Date().toISOString(),
    todayEt: ctx.todayEt,
    mode,
    snapshot: {
      fileDate: snapshot.fileDate,
      totalRows: snapshot.totalRows,
      activeRows: snapshot.activeRows,
      ownerRows: ctx.ownerRows,
      vacantRows: ctx.vacantRows,
      distinctActiveTrucks: snapshot.byCanonicalTruck.size,
    },
    gates: {
      g0: ctx.g0,
      g1: ctx.g1,
      g2: { halt: g2eval.halt, ceiling: g2eval.ceiling, totalProposed: proposedWriteTotal },
    },
    downstream: {
      wms: {
        rawCount: wms?.rawCount ?? 0,
        distinctCanonical: wms?.distinctCanonical ?? 0,
        duplicateCanonical: wms?.duplicateCanonical ?? 0,
      },
      ams: { rawCount: ams?.rawCount ?? 0, pages: ams?.pages ?? 0, truncated: ams?.truncated ?? false },
      holman: { rawCount: holman?.rawCount ?? 0, pages: holman?.pages ?? 0 },
    },
    completeness: ctx.completeness,
    ladder,
    outcomes,
    rawDrift,
    proposedWriteTotal,
    forcedReconcileCount,
    halted,
    sampleByOutcome,
    elapsedMs: Date.now() - start,
  };
}
