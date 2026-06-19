/**
 * Pure decision oracle for the tier-3 AIMS backstop reconciler (#20 truth-table).
 *
 * This module is the SINGLE source of truth for the reconciler's decision logic.
 * It is intentionally pure (no I/O, no imports of services) so T009 unit tests can
 * assert: input-combo -> ruleId -> outcome. No engine code may introduce a branch
 * not represented here.
 *
 * All identity values passed in (enterprise IDs) are assumed already normalized to
 * canonical Enterprise ID (trim + UPPERCASE); truck numbers already canonicalized.
 * A "blank"/unassigned tech is represented as null (callers map ''/'^null^' -> null).
 */

// ---- Run-level gate tunables (#1, #2) ----
export const GUARD_THRESHOLD_PCT = 0.3; // #1 circuit breaker: >30% of active -> HALT
export const ROWCOUNT_FLOOR_TOTAL = 15000; // #2b
export const ROWCOUNT_FLOOR_ACTIVE = 2400; // #2b
export const FRESHNESS_WINDOW_DAYS = 1; // #2a tunable: accepted extract within N days of today ET
export const EXEMPT_MAX_AGE_DAYS = 3; // #18 force-reconcile after N days

export type Outcome =
  | 'HALT_RUN'
  | 'OUT_OF_SCOPE'
  | 'SKIP_EXEMPT'
  | 'WRITE_HOLD_LIFECYCLE'
  | 'HOLD_CONTESTED'
  | 'WMS_ASSIGN'
  | 'WMS_GHOST_CLEAR'
  | 'WMS_MISSING_FLAG'
  | 'FLAG_MOVE'
  | 'COSTCENTER_FIX'
  | 'COSTCENTER_SKIP_FLAG'
  | 'AMS_ASSIGN'
  | 'AMS_SUPPRESS'
  | 'AMS_AWAIT_BATCH'
  | 'AMS_RESYNC_FLAG'
  | 'AMS_MISSING_FLAG'
  | 'HOLMAN_ASSIGN'
  | 'HOLMAN_GHOST_CLEAR'
  | 'HOLMAN_MISSING_FLAG'
  | 'NOOP';

export type AuthorityInput =
  | { kind: 'owner'; enterpriseId: string; districtNo: string | null; expectedCostCenter: string | null }
  | { kind: 'vacant' }
  | { kind: 'contested'; reason: string };

export interface WmsState {
  present: boolean; // truck# returned by getAllTrucks()
  tech: string | null; // canonical techEnterpriseId, or null when blank
  costCenter: string | null;
  techOnOtherTruck: boolean; // target owner already assigned to a different WMS truck (#9)
}

export interface AmsState {
  present: boolean; // truck# returned by the AMS bulk pull
  tech: string | null;
  inFlightWithinWindow: boolean; // submitted-to-AMS ts still inside the overnight window (#17)
  inFlightElapsed: boolean; // window elapsed and still diverged (#10/#17)
}

export interface HolmanState {
  present: boolean; // truck# returned by the Holman bulk pull
  tech: string | null; // canonical Enterprise ID from clientData2, or null when '^null^'/blank
}

export interface TruckDecisionInput {
  active: boolean;
  exempt: boolean;
  exemptAgeDays: number;
  exemptMaxAgeDays?: number; // defaults to EXEMPT_MAX_AGE_DAYS
  lifecycleConflict: boolean;
  authority: AuthorityInput;
  wms: WmsState;
  ams: AmsState;
  holman: HolmanState;
}

export interface LegResult {
  outcome: Outcome;
  detail?: string;
  countsTowardGuard: boolean;
}

export type LadderResult =
  | 'OUT_OF_SCOPE'
  | 'SKIP_EXEMPT'
  | 'WRITE_HOLD_LIFECYCLE'
  | 'HOLD_CONTESTED'
  | 'EVALUATE';

export interface TruckDecision {
  ruleId: string; // L0 | L1 | L2 | L3 | L4 (with forcedReconcile when L1f fell through)
  ladder: LadderResult;
  forcedReconcile: boolean; // L1f: was exempt but aged past max -> force-reconciled
  legs: {
    wms?: LegResult;
    wmsCostCenter?: LegResult;
    ams?: LegResult;
    holman?: LegResult;
  };
  proposedWriteCount: number; // number of legs that count toward the G2 guard
}

function noop(): LegResult {
  return { outcome: 'NOOP', countsTowardGuard: false };
}

// ---- WMS leg (#3, #9, #13) ----
function decideWmsLeg(authority: AuthorityInput, wms: WmsState): LegResult {
  if (authority.kind === 'owner') {
    if (!wms.present) return { outcome: 'WMS_MISSING_FLAG', countsTowardGuard: false };
    if (wms.tech === authority.enterpriseId) return noop(); // already X -> cost-center handled separately
    if (wms.tech === null && !wms.techOnOtherTruck) {
      return { outcome: 'WMS_ASSIGN', detail: authority.enterpriseId, countsTowardGuard: true };
    }
    // blank but tech already on another truck (displacement), OR a different tech Y ("1 different")
    return { outcome: 'FLAG_MOVE', countsTowardGuard: false };
  }
  // authority = vacant
  if (!wms.present) return noop();
  if (wms.tech !== null) return { outcome: 'WMS_GHOST_CLEAR', detail: wms.tech, countsTowardGuard: true };
  return noop();
}

// WMS cost-center sub-rule — applies ONLY when the WMS leg is WMS_ASSIGN (clean) or already-X (#3/#9/#13)
function decideWmsCostCenter(authority: AuthorityInput, wms: WmsState, wmsLeg: LegResult): LegResult | undefined {
  if (authority.kind !== 'owner') return undefined;
  const eligible = wmsLeg.outcome === 'WMS_ASSIGN' || (wmsLeg.outcome === 'NOOP' && wms.tech === authority.enterpriseId);
  if (!eligible) return undefined;
  if (authority.expectedCostCenter === null) {
    return { outcome: 'COSTCENTER_SKIP_FLAG', countsTowardGuard: false };
  }
  if (wms.costCenter !== authority.expectedCostCenter) {
    return {
      outcome: 'COSTCENTER_FIX',
      detail: `${wms.costCenter ?? '(none)'} -> ${authority.expectedCostCenter}`,
      countsTowardGuard: true,
    };
  }
  return noop();
}

// ---- AMS leg (#10, #17) ----
function decideAmsLeg(authority: AuthorityInput, ams: AmsState): LegResult {
  if (authority.kind === 'owner') {
    // direct assigns are NOT subject to the in-flight cooldown (#17)
    if (!ams.present) return { outcome: 'AMS_MISSING_FLAG', countsTowardGuard: false };
    if (ams.tech !== authority.enterpriseId) {
      return { outcome: 'AMS_ASSIGN', detail: authority.enterpriseId, countsTowardGuard: true };
    }
    return noop();
  }
  // authority = vacant: the unassign/ghost path; cooldown applies here only
  if (!ams.present) return { outcome: 'AMS_MISSING_FLAG', countsTowardGuard: false };
  if (ams.tech !== null) {
    if (ams.inFlightWithinWindow) return { outcome: 'AMS_SUPPRESS', countsTowardGuard: false };
    if (ams.inFlightElapsed) return { outcome: 'AMS_RESYNC_FLAG', countsTowardGuard: false };
    return { outcome: 'AMS_AWAIT_BATCH', detail: ams.tech, countsTowardGuard: false };
  }
  return noop();
}

// ---- Holman leg (#14) ----
function decideHolmanLeg(authority: AuthorityInput, holman: HolmanState): LegResult {
  if (!holman.present) return { outcome: 'HOLMAN_MISSING_FLAG', countsTowardGuard: false };
  if (authority.kind === 'owner') {
    if (holman.tech !== authority.enterpriseId) {
      return { outcome: 'HOLMAN_ASSIGN', detail: authority.enterpriseId, countsTowardGuard: true };
    }
    return noop();
  }
  // authority = vacant
  if (holman.tech !== null) return { outcome: 'HOLMAN_GHOST_CLEAR', detail: holman.tech, countsTowardGuard: true };
  return noop();
}

/**
 * Evaluate the full #20 truth-table for a single truck.
 * Level 1 ladder (first match wins) then Level 2 per-leg corrections.
 */
export function decideTruck(input: TruckDecisionInput): TruckDecision {
  const maxAge = input.exemptMaxAgeDays ?? EXEMPT_MAX_AGE_DAYS;

  // L0: not active
  if (!input.active) {
    return { ruleId: 'L0', ladder: 'OUT_OF_SCOPE', forcedReconcile: false, legs: {}, proposedWriteCount: 0 };
  }

  // L1 / L1f: exemption
  let forcedReconcile = false;
  if (input.exempt) {
    if (input.exemptAgeDays <= maxAge) {
      return { ruleId: 'L1', ladder: 'SKIP_EXEMPT', forcedReconcile: false, legs: {}, proposedWriteCount: 0 };
    }
    forcedReconcile = true; // L1f -> fall through to L2+
  }

  // L2: lifecycle conflict (Holman Sold/OOS) -> full write-hold, all legs
  if (input.lifecycleConflict) {
    return { ruleId: 'L2', ladder: 'WRITE_HOLD_LIFECYCLE', forcedReconcile, legs: {}, proposedWriteCount: 0 };
  }

  // L3: contested authority -> full hold, all legs
  if (input.authority.kind === 'contested') {
    return { ruleId: 'L3', ladder: 'HOLD_CONTESTED', forcedReconcile, legs: {}, proposedWriteCount: 0 };
  }

  // L4: authority = owner X OR vacant -> evaluate each leg independently
  const wmsLeg = decideWmsLeg(input.authority, input.wms);
  const wmsCostCenter = decideWmsCostCenter(input.authority, input.wms, wmsLeg);
  const amsLeg = decideAmsLeg(input.authority, input.ams);
  const holmanLeg = decideHolmanLeg(input.authority, input.holman);

  const legs = { wms: wmsLeg, wmsCostCenter, ams: amsLeg, holman: holmanLeg };
  let proposedWriteCount = 0;
  for (const leg of [wmsLeg, wmsCostCenter, amsLeg, holmanLeg]) {
    if (leg?.countsTowardGuard) proposedWriteCount++;
  }

  return { ruleId: 'L4', ladder: 'EVALUATE', forcedReconcile, legs, proposedWriteCount };
}

// ---- Level 0 run gates (pure) ----

export interface FreshnessResult {
  ok: boolean;
  ageDays: number | null; // null when fileDate missing
  reason?: string;
}

/** G0 (#2a, #18): accepted extract must have FILE_DATE within `windowDays` of today ET. */
export function checkFreshness(
  fileDateYmd: string | null,
  todayEtYmd: string,
  windowDays: number = FRESHNESS_WINDOW_DAYS,
  dayDiff: (from: string, to: string) => number = defaultDayDiff,
): FreshnessResult {
  if (!fileDateYmd) return { ok: false, ageDays: null, reason: 'no-extract' };
  const ageDays = dayDiff(fileDateYmd, todayEtYmd);
  if (ageDays < 0) return { ok: false, ageDays, reason: 'future-extract' };
  if (ageDays >= windowDays + 1) return { ok: false, ageDays, reason: 'stale-extract' };
  return { ok: true, ageDays };
}

function defaultDayDiff(fromYmd: string, toYmd: string): number {
  const [ay, am, ad] = fromYmd.split('-').map(Number);
  const [by, bm, bd] = toYmd.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

/** G1 (#2b): extract row-count sanity floors. */
export function checkRowCountFloors(
  totalRows: number,
  activeRows: number,
  floorTotal: number = ROWCOUNT_FLOOR_TOTAL,
  floorActive: number = ROWCOUNT_FLOOR_ACTIVE,
): { ok: boolean; reason?: string } {
  if (totalRows < floorTotal) return { ok: false, reason: `total ${totalRows} < floor ${floorTotal}` };
  if (activeRows < floorActive) return { ok: false, reason: `active ${activeRows} < floor ${floorActive}` };
  return { ok: true };
}

/** G2 (#1): circuit breaker on total proposed writes vs active count. */
export function evaluateVolumeGuard(
  totalProposed: number,
  activeCount: number,
  thresholdPct: number = GUARD_THRESHOLD_PCT,
): { halt: boolean; ceiling: number } {
  const ceiling = Math.floor(activeCount * thresholdPct);
  return { halt: totalProposed > ceiling, ceiling };
}
