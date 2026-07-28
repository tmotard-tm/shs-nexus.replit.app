/**
 * Regional grouping for rental cases: EAST, CENTRAL, WEST.
 *
 * Tyler, 2026-07-28: split the rental cases by region based on the location of
 * the TECH, and keep districts grouped together inside their region.
 *
 * Those two requirements pull against each other, and resolving that tension is
 * the whole point of this module. Region is a property of a *state*, but a
 * district can contain technicians living in more than one state, so a naive
 * per-case state lookup would scatter one district across two regions. So:
 *
 *   1. Every district is assigned ONE region, by a vote of its own technicians'
 *      home states. A district is therefore never split.
 *   2. A case inherits its district's region.
 *   3. Only a case with no district falls back to per-case state resolution.
 *
 * The state lists are ported verbatim from the LUCA escalation router
 * (fleetagents `server/agents/luca/region.ts`, REGION_STATES) so that the page a
 * lead reads and the mailbox an escalation lands in can never disagree about
 * which region a truck is in. All 50 states + DC are covered exactly once; see
 * the assertion at the bottom of this file.
 */

export type Region = "east" | "central" | "west";

/** Display order. EAST, CENTRAL, WEST — the order Tyler asked for. */
export const REGIONS: readonly Region[] = ["east", "central", "west"] as const;

export const REGION_LABEL: Record<Region, string> = {
  east: "EAST",
  central: "CENTRAL",
  west: "WEST",
};

/**
 * Recovery owner per region, matching the LUCA escalation routing that is live
 * on the LIVHR box (east→Olga, central→Oscar, west→Sandeep).
 */
export const REGION_OWNER: Record<Region, string> = {
  east: "Olga",
  central: "Oscar",
  west: "Sandeep",
};

const REGION_STATES: Record<Region, readonly string[]> = {
  west: ["AK", "AZ", "CA", "CO", "HI", "ID", "MT", "NM", "NV", "OR", "UT", "WA", "WY"],
  central: ["AL", "AR", "IA", "IL", "KS", "LA", "MN", "MO", "MS", "ND", "NE", "OK", "SD", "TN", "TX", "WI"],
  east: ["CT", "DC", "DE", "FL", "GA", "IN", "KY", "MA", "MD", "ME", "MI", "NC", "NH", "NJ", "NY", "OH", "PA", "RI", "SC", "VA", "VT", "WV"],
};

const STATE_TO_REGION: ReadonlyMap<string, Region> = (() => {
  const m = new Map<string, Region>();
  for (const r of REGIONS) for (const s of REGION_STATES[r]) m.set(s, r);
  return m;
})();

/** Normalises "tx", " TX ", "Texas" is NOT handled — feed us 2-letter codes. */
export function regionForState(state: string | null | undefined): Region | null {
  if (!state) return null;
  const key = String(state).trim().toUpperCase();
  if (key.length !== 2) return null;
  return STATE_TO_REGION.get(key) ?? null;
}

/** Empty string is not a district. Guards against "" grouping into a real bucket. */
function normDistrict(d: string | null | undefined): string | null {
  const t = (d ?? "").toString().trim();
  return t === "" ? null : t;
}

/** The subset of a master row this module needs. Structural, so MasterRow satisfies it. */
export interface RegionInput {
  tech_district?: string | null;
  /** The technician's resolved home state. The primary signal — "location of the tech". */
  identity_state?: string | null;
  /** Fallbacks, in this order, only when the tech state is unknown. */
  shop_state?: string | null;
  renting_state?: string | null;
}

export type RegionBasis =
  | "district"       // inherited from the district's assignment (the normal path)
  | "tech_state"     // no district; resolved from the technician's own state
  | "shop_state"
  | "renting_state"
  | "unassigned";

export interface DistrictAssignment {
  district: string;
  region: Region;
  /** Per-region tally of the technician states seen in this district. */
  votes: Record<Region, number>;
  /**
   * True when this district's technicians resolved to more than one region.
   * The district is still kept whole (Tyler's rule) but the page surfaces this
   * so a genuinely cross-region district is visible rather than silently flattened.
   */
  split: boolean;
  /** True when no technician state was available and the region came from shop/renting state. */
  inferred: boolean;
}

/**
 * Assigns exactly one region to every district present in `rows`.
 *
 * Vote: each row contributes its technician's home state. The region with the
 * most votes wins. A district with no technician-state signal at all falls back
 * to a second round over shop state, then renting state, and is marked
 * `inferred`. Ties break by REGIONS order (east, central, west) purely so the
 * result is deterministic across runs — a tie is rare and always `split: true`,
 * so it is visible on the page rather than hidden behind a coin flip.
 */
export function assignDistrictRegions(rows: readonly RegionInput[]): Map<string, DistrictAssignment> {
  const zero = (): Record<Region, number> => ({ east: 0, central: 0, west: 0 });

  const techVotes = new Map<string, Record<Region, number>>();
  const fallbackVotes = new Map<string, Record<Region, number>>();

  for (const row of rows) {
    const district = normDistrict(row.tech_district);
    if (!district) continue;

    const techRegion = regionForState(row.identity_state);
    if (techRegion) {
      if (!techVotes.has(district)) techVotes.set(district, zero());
      techVotes.get(district)![techRegion] += 1;
      continue;
    }
    const fallbackRegion = regionForState(row.shop_state) ?? regionForState(row.renting_state);
    if (fallbackRegion) {
      if (!fallbackVotes.has(district)) fallbackVotes.set(district, zero());
      fallbackVotes.get(district)![fallbackRegion] += 1;
    }
  }

  const pick = (votes: Record<Region, number>): { region: Region; split: boolean } => {
    let best: Region = REGIONS[0];
    let bestN = -1;
    let nonZero = 0;
    for (const r of REGIONS) {
      if (votes[r] > 0) nonZero += 1;
      if (votes[r] > bestN) { bestN = votes[r]; best = r; }
    }
    return { region: best, split: nonZero > 1 };
  };

  const out = new Map<string, DistrictAssignment>();
  const districts = new Set<string>(
    Array.from(techVotes.keys()).concat(Array.from(fallbackVotes.keys())),
  );

  for (const district of Array.from(districts)) {
    const tv = techVotes.get(district);
    if (tv) {
      const { region, split } = pick(tv);
      out.set(district, { district, region, votes: tv, split, inferred: false });
      continue;
    }
    const fv = fallbackVotes.get(district)!;
    const { region, split } = pick(fv);
    out.set(district, { district, region, votes: fv, split, inferred: true });
  }

  return out;
}

export interface ResolvedRegion {
  region: Region | null;
  basis: RegionBasis;
  /** District-level flags, surfaced on the row so the table can badge them. */
  districtSplit: boolean;
  districtInferred: boolean;
}

/**
 * Resolves one case to a region.
 *
 * District first — that is what keeps a district whole. Per-case state
 * resolution only ever applies to a case with no district at all.
 */
export function resolveCaseRegion(
  row: RegionInput,
  districts: Map<string, DistrictAssignment>,
): ResolvedRegion {
  const district = normDistrict(row.tech_district);
  if (district) {
    const a = districts.get(district);
    if (a) {
      return { region: a.region, basis: "district", districtSplit: a.split, districtInferred: a.inferred };
    }
    // District present but it produced no usable state anywhere in the population.
    return { region: null, basis: "unassigned", districtSplit: false, districtInferred: false };
  }

  const byTech = regionForState(row.identity_state);
  if (byTech) return { region: byTech, basis: "tech_state", districtSplit: false, districtInferred: false };

  const byShop = regionForState(row.shop_state);
  if (byShop) return { region: byShop, basis: "shop_state", districtSplit: false, districtInferred: false };

  const byRenting = regionForState(row.renting_state);
  if (byRenting) return { region: byRenting, basis: "renting_state", districtSplit: false, districtInferred: false };

  return { region: null, basis: "unassigned", districtSplit: false, districtInferred: false };
}

/**
 * Coverage guard. If someone edits a state list and drops or duplicates a state,
 * cases would silently vanish into "unassigned" instead of failing loudly. 50
 * states + DC = 51, each exactly once.
 */
export function assertRegionCoverage(): void {
  const seen = new Set<string>();
  let total = 0;
  for (const r of REGIONS) {
    for (const s of REGION_STATES[r]) {
      if (seen.has(s)) throw new Error(`[VRM region] state ${s} appears in more than one region`);
      seen.add(s);
      total += 1;
    }
  }
  if (total !== 51) throw new Error(`[VRM region] expected 51 states + DC, found ${total}`);
}
