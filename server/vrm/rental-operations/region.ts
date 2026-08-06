/**
 * Regional grouping for rental cases: EAST, CENTRAL, WEST.
 *
 * The region model now lives in ./annex-a-routing (Rental Vehicle Reduction
 * SOP v4.0, Annex A — 52 entries: 50 states + DC + PR). This file keeps the
 * legacy import surface alive for Cases by Region and the ready notifier.
 *
 * THE DISTRICT VOTE IS GONE. The old rule assigned every district one region
 * by a vote of its technicians' home states so a district was never split.
 * SOP v4 Annex A.6 rejects that: three districts legitimately span two regions
 * (4766 Ohio Valley, 8035 Atlanta, 8206 Mid South), and keeping them whole
 * misrouted ~15% of escalations. A case now resolves from its OWN technician's
 * home state, falling back to shop state, then plate/renting state.
 */

export {
  REGIONS,
  REGION_LABEL,
  REGION_OWNER,
  regionForState,
  assertAnnexACoverage,
} from "./annex-a-routing";
export type { Region } from "./annex-a-routing";

import {
  regionForState as annexRegionForState,
  assertAnnexACoverage as annexAssertCoverage,
  type Region as AnnexRegion,
} from "./annex-a-routing";

/** The subset of a master row this module needs. Structural, so MasterRow satisfies it. */
export interface RegionInput {
  /** Accepted for structural compatibility; IGNORED by resolution (Annex A is state-only). */
  tech_district?: string | null;
  /**
   * The technician's home state from `all_techs.home_state` (clean 2-letter
   * codes). The primary signal — "location of the tech".
   *
   * DO NOT use the master row's `identity_state` here. Despite the name that
   * column is the identity-resolution STATUS (RESOLVED / REVIEW / EXCEPTION),
   * not a US state — it is `vrm_rental_identity_resolutions.state`, a state
   * machine, not a place. Reading it silently pushed every single district
   * down the shop-state fallback while still producing plausible totals.
   */
  tech_home_state?: string | null;
  /** Fallbacks, in this order, only when the tech state is unknown. */
  shop_state?: string | null;
  renting_state?: string | null;
}

export type RegionBasis =
  | "tech_state"     // resolved from the technician's own home state (the normal path)
  | "shop_state"
  | "renting_state"
  | "unassigned";

export interface ResolvedRegion {
  region: AnnexRegion | null;
  basis: RegionBasis;
  /** Legacy district-vote flags. Always false now — kept so row shapes stay stable. */
  districtSplit: boolean;
  districtInferred: boolean;
}

/**
 * Resolves one case to a region. State-first per Annex A: the case's own
 * technician's home state decides; shop state, then renting/plate state fill
 * in only when the tech state is unknown. Districts play no part.
 */
export function resolveCaseRegion(row: RegionInput): ResolvedRegion {
  const byTech = annexRegionForState(row.tech_home_state);
  if (byTech) return { region: byTech, basis: "tech_state", districtSplit: false, districtInferred: false };

  const byShop = annexRegionForState(row.shop_state);
  if (byShop) return { region: byShop, basis: "shop_state", districtSplit: false, districtInferred: false };

  const byRenting = annexRegionForState(row.renting_state);
  if (byRenting) return { region: byRenting, basis: "renting_state", districtSplit: false, districtInferred: false };

  return { region: null, basis: "unassigned", districtSplit: false, districtInferred: false };
}

/** Coverage guard — delegates to the Annex A check (52 entries, disjoint, 17/17/18). */
export function assertRegionCoverage(): void {
  annexAssertCoverage();
}
