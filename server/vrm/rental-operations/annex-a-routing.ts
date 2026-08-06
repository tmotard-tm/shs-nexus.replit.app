/**
 * Annex A of the Rental Vehicle Reduction SOP v4.0 (2026-08-05) — the
 * authoritative region model. Route by TECHNICIAN HOME STATE, never by
 * district: three districts legitimately span two regions (4766 Ohio Valley,
 * 8035 Atlanta, 8206 Mid South), so any district-based vote disagrees with the
 * SOP (~15% of escalations were misrouted under the old tables + vote).
 *
 * District tables are used ONLY for fleet-ops TEAM assignment
 * (tags / registration items) — teams are defined by district; regions are not.
 *
 * Resolution chain (SOP §4): manually-assigned owner > tech home state >
 * shop-address state > plate state > Rob Anderson flagged needs-routing.
 * NEVER broadcast an unrouted item.
 */

export const REGIONS = ["east", "central", "west"] as const;
export type Region = (typeof REGIONS)[number];

/** Display labels kept identical to the pre-Annex-A vocabulary the UI renders. */
export const REGION_LABEL: Record<Region, string> = {
  east: "EAST",
  central: "CENTRAL",
  west: "WEST",
};

export const REGION_OWNER: Record<Region, string> = {
  east: "Olga Fernandez",
  central: "Oscar Santana",
  west: "Sandeep Kalyani",
};

/** Owner used when no state can be resolved: single named owner, NEVER broadcast. */
export const UNROUTED_OWNER = "Rob Anderson";

export const OWNER_ROSTER = [
  "Olga Fernandez",
  "Oscar Santana",
  "Sandeep Kalyani",
  "Rob Anderson",
  "Jennifer Dyer",
  "Carol & Tasha",
  "Cheryl & Monica",
  "Rob D & Andrea",
] as const;
export type BucketOwner = (typeof OWNER_ROSTER)[number];

// SOP Annex A.1–A.3. 52 entries: 50 states + DC + PR. Corrections vs the old
// deployed tables (SOP A.6): OH, KY, IN, MI East→Central; SC East→West;
// AL, AR, LA, MS Central→West; PR added (Central).
export const ANNEX_A_STATES: Record<Region, readonly string[]> = {
  east: ["CT", "DC", "DE", "FL", "GA", "MA", "MD", "ME", "NC", "NH", "NJ", "NY", "PA", "RI", "VA", "VT", "WV"],
  central: ["IA", "IL", "IN", "KS", "KY", "MI", "MN", "MO", "ND", "NE", "OH", "OK", "PR", "SD", "TN", "TX", "WI"],
  west: ["AK", "AL", "AR", "AZ", "CA", "CO", "HI", "ID", "LA", "MS", "MT", "NM", "NV", "OR", "SC", "UT", "WA", "WY"],
};

const STATE_REGION: ReadonlyMap<string, Region> = (() => {
  const m = new Map<string, Region>();
  for (const region of REGIONS) for (const st of ANNEX_A_STATES[region]) m.set(st, region);
  return m;
})();

/** 2-letter codes only ("tx", " TX " fine; "Texas" is not handled upstream either). */
export function regionForState(state: string | null | undefined): Region | null {
  const s = String(state ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(s)) return null;
  return STATE_REGION.get(s) ?? null;
}

// SOP Annex A.4 — district → fleet-ops team (tags / registration only).
export const TEAM_BY_DISTRICT: Readonly<Record<string, BucketOwner>> = {
  // Carol & Tasha
  "7088": "Carol & Tasha", "7108": "Carol & Tasha", "7995": "Carol & Tasha",
  "8107": "Carol & Tasha", "8147": "Carol & Tasha", "8158": "Carol & Tasha",
  "8169": "Carol & Tasha", "8184": "Carol & Tasha", "8228": "Carol & Tasha",
  "8366": "Carol & Tasha",
  // Cheryl & Monica
  "6141": "Cheryl & Monica", "7323": "Cheryl & Monica", "8096": "Cheryl & Monica",
  "8162": "Cheryl & Monica", "8206": "Cheryl & Monica", "8220": "Cheryl & Monica",
  "8309": "Cheryl & Monica", "8420": "Cheryl & Monica", "8555": "Cheryl & Monica",
  "8935": "Cheryl & Monica",
  // Rob D & Andrea
  "4766": "Rob D & Andrea", "7084": "Rob D & Andrea", "7435": "Rob D & Andrea",
  "7670": "Rob D & Andrea", "7744": "Rob D & Andrea", "7983": "Rob D & Andrea",
  "8035": "Rob D & Andrea", "8175": "Rob D & Andrea", "8380": "Rob D & Andrea",
};

export function teamForDistrict(district: string | number | null | undefined): BucketOwner | null {
  const canon = String(district ?? "").replace(/\D/g, "").replace(/^0+/, "");
  return canon ? TEAM_BY_DISTRICT[canon] ?? null : null;
}

export type RoutingBasis = "manual" | "tech_state" | "shop_state" | "plate_state" | "unrouted";

export interface RoutingInput {
  /** Newest assign_owner action row, if any. Wins always. */
  manualOwner?: string | null;
  /**
   * From the roster join (all_techs.home_state) — NEVER
   * vrm_rental_identity_resolutions.state, which is a resolution STATUS
   * (RESOLVED / REVIEW / EXCEPTION), not a US state (SOP B.5).
   */
  techHomeState?: string | null;
  shopState?: string | null;
  /** aka renting_state — the rental agreement's plate state. */
  plateState?: string | null;
}

export interface RoutingResult {
  owner: string;
  region: Region | null;
  basis: RoutingBasis;
  /** True only for the unrouted fallback — surfaces as the red needs-routing flag. */
  needsRouting: boolean;
}

/** SOP §4 resolution chain: manual > tech state > shop state > plate state > Rob Anderson. */
export function resolveOwnerRouting(input: RoutingInput): RoutingResult {
  // Manual owner wins even when it isn't on the roster (historic names still route).
  const manual = String(input.manualOwner ?? "").trim();
  const chain: Array<[RoutingBasis, string | null | undefined]> = [
    ["tech_state", input.techHomeState],
    ["shop_state", input.shopState],
    ["plate_state", input.plateState],
  ];
  let region: Region | null = null;
  let regionBasis: RoutingBasis = "unrouted";
  for (const [basis, st] of chain) {
    const r = regionForState(st);
    if (r) { region = r; regionBasis = basis; break; }
  }
  if (manual) return { owner: manual, region, basis: "manual", needsRouting: false };
  if (region) return { owner: REGION_OWNER[region], region, basis: regionBasis, needsRouting: false };
  return { owner: UNROUTED_OWNER, region: null, basis: "unrouted", needsRouting: true };
}

/**
 * Coverage guard, run once at module load by consumers. If someone edits a
 * state list and drops or duplicates an entry, cases would silently vanish
 * into Unassigned instead of failing loudly. 50 states + DC + PR = 52.
 */
export function assertAnnexACoverage(): void {
  const all = REGIONS.flatMap((r) => [...ANNEX_A_STATES[r]]);
  if (all.length !== 52) throw new Error(`[Annex A] expected 52 entries (50 states + DC + PR), found ${all.length}`);
  if (new Set(all).size !== all.length) throw new Error("[Annex A] a state appears in more than one region");
  const counts = REGIONS.map((r) => ANNEX_A_STATES[r].length).join("/");
  if (counts !== "17/17/18") throw new Error(`[Annex A] region sizes drifted from SOP (17/17/18): ${counts}`);
}
