/**
 * Tier-3 backstop reconciler — DRY-RUN engine (T003).
 *
 * Computes per-truck desired state vs every downstream system and emits a diff
 * report with ZERO writes. Every truck is tagged with the #20 truth-table rule id
 * (via the pure `decideTruck` oracle) so the report is assertable against the spec
 * and the T009 unit tests share the same decision code.
 *
 * Authority modes:
 *  - fast (default): AIMS snapshot owner (OWNERLDAPID alone) — reproduces the drift
 *    baseline without 1,651 live /techinfo calls.
 *  - liveConfirm: per-truck live /techinfo confirmation via resolveTruckAuthority —
 *    surfaces the `contested` bucket; optionally capped via liveConfirmLimit.
 * Live confirmation is enforced unconditionally at WRITE time (W1) regardless of mode.
 */

import { storage } from '../storage';
import {
  loadAimsSnapshot,
  resolveTruckAuthority,
  etYmd,
  etDayDiff,
  type AimsSnapshot,
  type AimsTruckRow,
} from './authority';
import {
  decideTruck,
  checkFreshness,
  checkRowCountFloors,
  evaluateVolumeGuard,
  EXEMPT_MAX_AGE_DAYS,
  FRESHNESS_WINDOW_DAYS,
  GUARD_THRESHOLD_PCT,
  type AuthorityInput,
  type LadderResult,
  type Outcome,
  type TruckDecision,
} from './decision';
import {
  pullWms,
  pullAms,
  pullHolman,
  type WmsPull,
  type AmsPull,
  type HolmanPull,
} from './downstream';

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

function authorityFromAims(row: AimsTruckRow, expectedCostCenter: string | null): AuthorityInput {
  if (row.ownerStatus === 'owner' && row.ownerEnterpriseId) {
    return {
      kind: 'owner',
      enterpriseId: row.ownerEnterpriseId,
      districtNo: row.district,
      expectedCostCenter,
    };
  }
  return { kind: 'vacant' };
}

export async function runDryRun(opts: DryRunOptions = {}): Promise<DryRunReport> {
  const start = Date.now();
  const todayEt = etYmd();
  const freshnessWindowDays = opts.freshnessWindowDays ?? FRESHNESS_WINDOW_DAYS;
  const exemptMaxAgeDays = opts.exemptMaxAgeDays ?? EXEMPT_MAX_AGE_DAYS;
  const guardThresholdPct = opts.guardThresholdPct ?? GUARD_THRESHOLD_PCT;
  const sampleSize = opts.sampleSize ?? 5;
  const mode: 'fast' | 'liveConfirm' = opts.liveConfirm ? 'liveConfirm' : 'fast';
  const phase = (m: string) => opts.onPhase?.(`[+${Math.round((Date.now() - start) / 1000)}s] ${m}`);

  // ---- Authority snapshot (read-only; AIMS max FILE_DATE -> DELIND=0) ----
  phase('loading AIMS snapshot…');
  const snapshot: AimsSnapshot = await loadAimsSnapshot({ withLocalChanges: true });
  phase(`snapshot: ${snapshot.totalRows} rows @ ${snapshot.fileDate}, ${snapshot.activeRows} active, ${snapshot.byCanonicalTruck.size} distinct trucks`);

  const ownerRows = snapshot.rows.filter((r) => r.ownerStatus === 'owner').length;
  const vacantRows = snapshot.rows.length - ownerRows;

  // ---- Level 0 gates (G0 freshness, G1 row-count) — evaluated before any truck ----
  const g0 = checkFreshness(snapshot.fileDate || null, todayEt, freshnessWindowDays, etDayDiff);
  const g1 = checkRowCountFloors(snapshot.totalRows, snapshot.activeRows);

  // ---- Live downstream pulls (in parallel) ----
  phase('pulling WMS + AMS + Holman (live)…');
  const [wms, ams, holman]: [WmsPull, AmsPull, HolmanPull] = await Promise.all([
    pullWms().then((r) => { phase(`WMS done: ${r.rawCount} rows`); return r; }),
    pullAms().then((r) => { phase(`AMS done: ${r.rawCount} rows / ${r.pages} pages`); return r; }),
    pullHolman().then((r) => { phase(`Holman done: ${r.rawCount} rows / ${r.pages} pages`); return r; }),
  ]);

  // ---- Completeness assertion (#19): getAllTrucks() must cover the active fleet ----
  const completeness = {
    wmsRawCount: wms.rawCount,
    aimsActive: snapshot.activeRows,
    ok: wms.rawCount >= snapshot.activeRows,
    note:
      wms.rawCount >= snapshot.activeRows
        ? undefined
        : `WMS getAllTrucks() returned ${wms.rawCount} < AIMS-active ${snapshot.activeRows} — possible silent pagination/truncation`,
  };

  // ---- Cost-center cache keyed by district (avoid per-truck DB calls) ----
  const ccCache = new Map<string, string | null>();
  async function expectedCostCenter(district: string | null): Promise<string | null> {
    if (!district) return null;
    if (ccCache.has(district)) return ccCache.get(district)!;
    const rec = await storage.getDistrictCostCenter(district);
    const cc = rec?.costCenter ?? null;
    ccCache.set(district, cc);
    return cc;
  }

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
  let liveConfirmsDone = 0;

  // Iterate the deduped active fleet (one row per canonical truck).
  for (const [canon, aims] of Array.from(snapshot.byCanonicalTruck.entries())) {
    const w = wms.byTruck.get(canon) ?? null;
    const a = ams.byTruck.get(canon) ?? null;
    const h = holman.byTruck.get(canon) ?? null;

    const cc = aims.ownerStatus === 'owner' ? await expectedCostCenter(aims.district) : null;

    // Authority resolution
    let authority: AuthorityInput;
    if (
      mode === 'liveConfirm' &&
      (opts.liveConfirmLimit === undefined || liveConfirmsDone < opts.liveConfirmLimit)
    ) {
      liveConfirmsDone++;
      const resolved = await resolveTruckAuthority(canon, snapshot, { nowEt: todayEt });
      const r = resolved.authority;
      if (r.kind === 'owner') {
        authority = { kind: 'owner', enterpriseId: r.enterpriseId, districtNo: r.districtNo, expectedCostCenter: r.expectedCostCenter };
      } else if (r.kind === 'contested') {
        authority = { kind: 'contested', reason: r.reason };
      } else {
        authority = { kind: 'vacant' };
      }
    } else {
      authority = authorityFromAims(aims, cc);
    }

    // Exemption (best-effort exemptAgeDays until T004 run-state)
    const localChange = snapshot.localChangeByCanonical?.get(canon) ?? null;
    const exempt = !!(localChange && snapshot.fileDate && localChange.getTime() > snapshot.extractInstant.getTime());

    const lifecycleConflict = !!h?.lifecycleConflict;

    const ownerX = authority.kind === 'owner' ? authority.enterpriseId : null;
    const techOnOtherTruck =
      ownerX != null && (() => {
        const set = wms.techToTrucks.get(ownerX);
        if (!set || set.size === 0) return false;
        if (set.size > 1) return true;
        return !set.has(canon);
      })();

    const decision: TruckDecision = decideTruck({
      active: true, // snapshot already scoped to DELIND=0
      exempt,
      exemptAgeDays: 0,
      exemptMaxAgeDays,
      lifecycleConflict,
      authority,
      wms: {
        present: !!w,
        tech: w?.tech ?? null,
        costCenter: w?.costCenter ?? null,
        techOnOtherTruck,
      },
      ams: {
        present: !!a,
        tech: a?.tech ?? null,
        inFlightWithinWindow: false,
        inFlightElapsed: false,
      },
      holman: {
        present: !!h,
        tech: h?.tech ?? null,
      },
    });

    ladder[decision.ladder]++;
    if (decision.forcedReconcile) forcedReconcileCount++;
    proposedWriteTotal += decision.proposedWriteCount;
    tally(outcomes, `LADDER_${decision.ladder}`);
    for (const leg of [decision.legs.wms, decision.legs.wmsCostCenter, decision.legs.ams, decision.legs.holman]) {
      if (leg) {
        tally(outcomes, leg.outcome);
        sample(leg.outcome, aims.truckNo);
      }
    }
    sample(`LADDER_${decision.ladder}`, aims.truckNo);

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

  phase(`per-truck loop done: ${proposedWriteTotal} proposed writes, ${liveConfirmsDone} live-confirms`);

  // ---- G2 volume guard (after proposals computed) ----
  const g2eval = evaluateVolumeGuard(proposedWriteTotal, snapshot.activeRows, guardThresholdPct);
  const halted = !g0.ok || !g1.ok || g2eval.halt;

  return {
    generatedAt: new Date().toISOString(),
    todayEt,
    mode,
    snapshot: {
      fileDate: snapshot.fileDate,
      totalRows: snapshot.totalRows,
      activeRows: snapshot.activeRows,
      ownerRows,
      vacantRows,
      distinctActiveTrucks: snapshot.byCanonicalTruck.size,
    },
    gates: {
      g0,
      g1,
      g2: { halt: g2eval.halt, ceiling: g2eval.ceiling, totalProposed: proposedWriteTotal },
    },
    downstream: {
      wms: { rawCount: wms.rawCount, distinctCanonical: wms.distinctCanonical, duplicateCanonical: wms.duplicateCanonical },
      ams: { rawCount: ams.rawCount, pages: ams.pages, truncated: ams.truncated },
      holman: { rawCount: holman.rawCount, pages: holman.pages },
    },
    completeness,
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
