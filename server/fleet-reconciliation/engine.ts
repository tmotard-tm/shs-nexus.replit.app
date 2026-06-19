/**
 * Tier-3 backstop reconciler — SHARED decision engine (T004).
 *
 * Single source of truth for *building the per-truck decision context*. Both the
 * dry-run (tally-only) and the materializer (persist) consume the SAME
 * `loadReconContext` + `iterateDecisions` so a decision can never drift between
 * "what the dry-run reported" and "what the materializer queued". The pure
 * `decideTruck` oracle (decision.ts) remains the ONLY place an outcome is minted;
 * this module just assembles its inputs from live authority + downstream pulls.
 *
 * Authority modes (#11):
 *  - fast (default): AIMS snapshot owner (OWNERLDAPID alone) — reproduces the
 *    drift baseline without 1,651 live /techinfo calls.
 *  - liveConfirm: per-truck live /techinfo confirmation via resolveTruckAuthority —
 *    surfaces the `contested` bucket; optionally capped via liveConfirmLimit.
 * Live confirmation is enforced unconditionally at WRITE time (W1) regardless of
 * the mode used here.
 */

import { storage } from '../storage';
import { db } from '../db';
import { amsInflightStamps } from '@shared/schema';
import { isNull } from 'drizzle-orm';
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
  EXEMPT_MAX_AGE_DAYS,
  FRESHNESS_WINDOW_DAYS,
  GUARD_THRESHOLD_PCT,
  type AuthorityInput,
  type FreshnessResult,
  type TruckDecision,
} from './decision';
import {
  pullWms,
  pullAms,
  pullHolman,
  type WmsPull,
  type AmsPull,
  type HolmanPull,
  type WmsTruck,
  type AmsTruck,
  type HolmanTruck,
} from './downstream';

// AMS overnight-batch propagation windows (#10, #17), measured off the stored
// submitted-to-AMS timestamp. Within `PROPAGATION` we SUPPRESS re-proposing;
// past `ELAPSED` while still diverged we escalate to a resync flag.
export const AMS_PROPAGATION_HOURS = 24;
export const AMS_ELAPSED_HOURS = 36;

export interface ReconContext {
  todayEt: string;
  snapshot: AimsSnapshot;
  ownerRows: number;
  vacantRows: number;
  g0: FreshnessResult;
  g1: { ok: boolean; reason?: string };
  gatesPassed: boolean;
  wms: WmsPull | null;
  ams: AmsPull | null;
  holman: HolmanPull | null;
  completeness: { wmsRawCount: number; aimsActive: number; ok: boolean; note?: string };
  // canonical truck# -> submitted-to-AMS timestamp (UNRESOLVED stamps only, #17)
  amsStampByCanonical: Map<string, Date>;
  freshnessWindowDays: number;
  guardThresholdPct: number;
  exemptMaxAgeDays: number;
}

export interface LoadContextOptions {
  freshnessWindowDays?: number;
  guardThresholdPct?: number;
  exemptMaxAgeDays?: number;
  // When true (materializer) skip the expensive live pulls if G0/G1 already fail
  // (#2: short-circuit before downstream pulls). The dry-run leaves this false so
  // its diagnostic downstream counts are always reported.
  shortCircuitOnGateFail?: boolean;
  onPhase?: (msg: string) => void;
  phaseStart?: number;
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

/**
 * Load everything a reconciler run needs ONCE: AIMS snapshot, G0/G1 gates, the
 * live downstream pulls, completeness assertion (#19), and the cross-run AMS
 * in-flight stamps (#17). Shared by dry-run and materializer.
 */
export async function loadReconContext(opts: LoadContextOptions = {}): Promise<ReconContext> {
  const start = opts.phaseStart ?? Date.now();
  const phase = (m: string) => opts.onPhase?.(`[+${Math.round((Date.now() - start) / 1000)}s] ${m}`);
  const todayEt = etYmd();
  const freshnessWindowDays = opts.freshnessWindowDays ?? FRESHNESS_WINDOW_DAYS;
  const guardThresholdPct = opts.guardThresholdPct ?? GUARD_THRESHOLD_PCT;
  const exemptMaxAgeDays = opts.exemptMaxAgeDays ?? EXEMPT_MAX_AGE_DAYS;

  phase('loading AIMS snapshot…');
  const snapshot = await loadAimsSnapshot({ withLocalChanges: true });
  phase(
    `snapshot: ${snapshot.totalRows} rows @ ${snapshot.fileDate}, ${snapshot.activeRows} active, ${snapshot.byCanonicalTruck.size} distinct trucks`,
  );

  const ownerRows = snapshot.rows.filter((r) => r.ownerStatus === 'owner').length;
  const vacantRows = snapshot.rows.length - ownerRows;

  // ---- Level 0 gates (G0 freshness, G1 row-count) — before any truck/pull ----
  const g0 = checkFreshness(snapshot.fileDate || null, todayEt, freshnessWindowDays, etDayDiff);
  const g1 = checkRowCountFloors(snapshot.totalRows, snapshot.activeRows);
  const gatesPassed = g0.ok && g1.ok;

  let wms: WmsPull | null = null;
  let ams: AmsPull | null = null;
  let holman: HolmanPull | null = null;
  if (gatesPassed || !opts.shortCircuitOnGateFail) {
    phase('pulling WMS + AMS + Holman (live)…');
    [wms, ams, holman] = await Promise.all([
      pullWms().then((r) => {
        phase(`WMS done: ${r.rawCount} rows`);
        return r;
      }),
      pullAms().then((r) => {
        phase(`AMS done: ${r.rawCount} rows / ${r.pages} pages`);
        return r;
      }),
      pullHolman().then((r) => {
        phase(`Holman done: ${r.rawCount} rows / ${r.pages} pages`);
        return r;
      }),
    ]);
  } else {
    phase('G0/G1 failed — short-circuiting before downstream pulls');
  }

  // ---- Completeness assertion (#19): getAllTrucks() must cover the active fleet ----
  const wmsRawCount = wms?.rawCount ?? 0;
  const completeness = {
    wmsRawCount,
    aimsActive: snapshot.activeRows,
    ok: wms ? wmsRawCount >= snapshot.activeRows : true,
    note:
      wms && wmsRawCount < snapshot.activeRows
        ? `WMS getAllTrucks() returned ${wmsRawCount} < AIMS-active ${snapshot.activeRows} — possible silent pagination/truncation`
        : undefined,
  };

  // ---- AMS in-flight stamps (#17): cross-run, keyed by truck (unresolved only) ----
  const amsStampByCanonical = new Map<string, Date>();
  const stamps = await db
    .select({
      truckCanonical: amsInflightStamps.truckCanonical,
      submittedToAmsAt: amsInflightStamps.submittedToAmsAt,
    })
    .from(amsInflightStamps)
    .where(isNull(amsInflightStamps.resolvedAt));
  for (const s of stamps) {
    if (s.submittedToAmsAt) amsStampByCanonical.set(s.truckCanonical, new Date(s.submittedToAmsAt));
  }

  return {
    todayEt,
    snapshot,
    ownerRows,
    vacantRows,
    g0,
    g1,
    gatesPassed,
    wms,
    ams,
    holman,
    completeness,
    amsStampByCanonical,
    freshnessWindowDays,
    guardThresholdPct,
    exemptMaxAgeDays,
  };
}

export interface DecisionContext {
  canon: string;
  aims: AimsTruckRow;
  authority: AuthorityInput;
  decision: TruckDecision;
  w: WmsTruck | null;
  a: AmsTruck | null;
  h: HolmanTruck | null;
  exempt: boolean;
  lifecycleConflict: boolean;
  techOnOtherTruck: boolean;
  // The cost center the truck SHOULD have (owner authority only), else null.
  expectedCostCenter: string | null;
  // AMS in-flight resolution for this truck this run (#17), for materializer stamp logic.
  amsInFlightWithinWindow: boolean;
  amsInFlightElapsed: boolean;
}

export interface IterateOptions {
  liveConfirm?: boolean;
  liveConfirmLimit?: number;
  exemptMaxAgeDays?: number;
  // Restrict iteration to these canonical truck#s (canary slice, #8).
  onlyTrucks?: Set<string>;
  amsPropagationHours?: number;
  amsElapsedHours?: number;
  onPhase?: (msg: string) => void;
}

/**
 * Iterate the deduped active fleet (one row per canonical truck) and yield the
 * full decision context per truck. `decideTruck` is the only outcome source.
 */
export async function* iterateDecisions(
  ctx: ReconContext,
  opts: IterateOptions = {},
): AsyncGenerator<DecisionContext> {
  if (!ctx.wms || !ctx.ams || !ctx.holman) return; // pulls were short-circuited (gate fail)
  const { snapshot, wms, ams, holman, todayEt } = ctx;
  const exemptMaxAgeDays = opts.exemptMaxAgeDays ?? ctx.exemptMaxAgeDays;
  const propMs = (opts.amsPropagationHours ?? AMS_PROPAGATION_HOURS) * 3_600_000;
  const elapsedMs = (opts.amsElapsedHours ?? AMS_ELAPSED_HOURS) * 3_600_000;
  const now = Date.now();
  const mode: 'fast' | 'liveConfirm' = opts.liveConfirm ? 'liveConfirm' : 'fast';

  // Cost-center cache keyed by district (avoid per-truck DB calls).
  const ccCache = new Map<string, string | null>();
  const expectedCostCenter = async (district: string | null): Promise<string | null> => {
    if (!district) return null;
    if (ccCache.has(district)) return ccCache.get(district)!;
    const rec = await storage.getDistrictCostCenter(district);
    const cc = rec?.costCenter ?? null;
    ccCache.set(district, cc);
    return cc;
  };

  let liveConfirmsDone = 0;

  for (const [canon, aims] of Array.from(snapshot.byCanonicalTruck.entries())) {
    if (opts.onlyTrucks && !opts.onlyTrucks.has(canon)) continue;

    const w = wms.byTruck.get(canon) ?? null;
    const a = ams.byTruck.get(canon) ?? null;
    const h = holman.byTruck.get(canon) ?? null;

    const cc = aims.ownerStatus === 'owner' ? await expectedCostCenter(aims.district) : null;

    // Authority resolution (fast = AIMS owner; liveConfirm = live /techinfo).
    let authority: AuthorityInput;
    if (mode === 'liveConfirm' && (opts.liveConfirmLimit === undefined || liveConfirmsDone < opts.liveConfirmLimit)) {
      liveConfirmsDone++;
      const resolved = await resolveTruckAuthority(canon, snapshot, { nowEt: todayEt });
      const r = resolved.authority;
      if (r.kind === 'owner') {
        authority = {
          kind: 'owner',
          enterpriseId: r.enterpriseId,
          districtNo: r.districtNo,
          expectedCostCenter: r.expectedCostCenter,
        };
      } else if (r.kind === 'contested') {
        authority = { kind: 'contested', reason: r.reason };
      } else {
        authority = { kind: 'vacant' };
      }
    } else {
      authority = authorityFromAims(aims, cc);
    }

    // Exemption (#18). exemptAgeDays is best-effort (0) until cross-run exempt
    // aging lands with the scheduler run-state (T006); the safe failure mode is
    // SKIP_EXEMPT, never writing a too-fresh value. The L1f force-reconcile path
    // + exemptMaxAgeDays knob are wired and exercised by the unit tests.
    const localChange = snapshot.localChangeByCanonical?.get(canon) ?? null;
    const exempt = !!(
      localChange &&
      snapshot.fileDate &&
      localChange.getTime() > snapshot.extractInstant.getTime()
    );

    const lifecycleConflict = !!h?.lifecycleConflict;

    const ownerX = authority.kind === 'owner' ? authority.enterpriseId : null;
    const techOnOtherTruck =
      ownerX != null &&
      (() => {
        const set = wms.techToTrucks.get(ownerX);
        if (!set || set.size === 0) return false;
        if (set.size > 1) return true;
        return !set.has(canon);
      })();

    // AMS in-flight resolution from the stored stamp (#17) — only the vacant
    // ghost path consumes it, but compute it once for the materializer too.
    let amsInFlightWithinWindow = false;
    let amsInFlightElapsed = false;
    if (a && a.tech !== null) {
      const stampedAt = ctx.amsStampByCanonical.get(canon);
      if (stampedAt) {
        const age = now - stampedAt.getTime();
        if (age < propMs) amsInFlightWithinWindow = true;
        else if (age > elapsedMs) amsInFlightElapsed = true;
      }
    }

    const decision = decideTruck({
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
        inFlightWithinWindow: amsInFlightWithinWindow,
        inFlightElapsed: amsInFlightElapsed,
      },
      holman: {
        present: !!h,
        tech: h?.tech ?? null,
      },
    });

    yield {
      canon,
      aims,
      authority,
      decision,
      w,
      a,
      h,
      exempt,
      lifecycleConflict,
      techOnOtherTruck,
      expectedCostCenter: authority.kind === 'owner' ? authority.expectedCostCenter : null,
      amsInFlightWithinWindow,
      amsInFlightElapsed,
    };
  }
}
