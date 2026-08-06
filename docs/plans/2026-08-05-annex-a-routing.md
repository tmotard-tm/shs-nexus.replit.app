# Plan A — Annex A Routing Module (state-first, 52 entries)

**Spec:** `docs/specs/2026-08-05-persona-bucket-queue-design.md` §4, §10
**Goal:** One shared routing module (state → region → owner, district → team, resolution chain with Rob-Anderson fallback) replacing the district-vote in `server/vrm/rental-operations/region.ts`. Consumers rewired: Cases by Region rollup + workbook routes (`region-routes.ts`), ready-for-pickup lane (`ready-notify.ts`). No broadcast paths remain.
**Architecture:** New `server/vrm/rental-operations/annex-a-routing.ts` holds all tables + resolution. `region.ts` shrinks to a compat re-export so stragglers fail loudly at typecheck, not silently at runtime. Tech home state ALWAYS comes from the roster join (`loadTechHomeStates`) — never `vrm_rental_identity_resolutions.state` (resolution status, not a US state; SOP B.5).
**Verification:** new workflow `annex-a-routing-unit`; `npm run check` via workflow (baseline 213 errors, no new); grep proves no `assignDistrictRegions`/district-vote callers remain.

---

## Task A1 — Create `server/vrm/rental-operations/annex-a-routing.ts`

**Files:** create `server/vrm/rental-operations/annex-a-routing.ts`

Full module (verbatim):

```ts
// Annex A of Rental Vehicle Reduction SOP v4.0 (2026-08-05) — authoritative
// region model. Route by TECHNICIAN HOME STATE, never by district: districts
// 4766 / 8035 / 8206 span two regions, so any district vote disagrees with
// the SOP. District tables are used ONLY for fleet-ops TEAM assignment
// (tags/registration items).

export const REGIONS = ["east", "central", "west"] as const;
export type Region = (typeof REGIONS)[number];

export const REGION_LABEL: Record<Region, string> = {
  east: "East Coast & Southeast",
  central: "Central & Midwest",
  west: "West Coast & Deep South",
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
  east: ["CT","DC","DE","FL","GA","MA","MD","ME","NC","NH","NJ","NY","PA","RI","VA","VT","WV"],
  central: ["IA","IL","IN","KS","KY","MI","MN","MO","ND","NE","OH","OK","PR","SD","TN","TX","WI"],
  west: ["AK","AL","AR","AZ","CA","CO","HI","ID","LA","MS","MT","NM","NV","OR","SC","UT","WA","WY"],
};

const STATE_REGION: ReadonlyMap<string, Region> = (() => {
  const m = new Map<string, Region>();
  for (const region of REGIONS) for (const st of ANNEX_A_STATES[region]) m.set(st, region);
  return m;
})();

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
  manualOwner?: string | null;   // newest assign_owner action row, if any
  techHomeState?: string | null; // roster join — NEVER identity_resolutions.state
  shopState?: string | null;
  plateState?: string | null;    // aka renting_state
}

export interface RoutingResult {
  owner: string;
  region: Region | null;
  basis: RoutingBasis;
  needsRouting: boolean; // true only for the unrouted fallback
}

/** SOP §4 resolution chain: manual > tech state > shop state > plate state > Rob Anderson. */
export function resolveOwnerRouting(input: RoutingInput): RoutingResult {
  const manual = String(input.manualOwner ?? "").trim();
  // Manual owner wins even when it isn't on the roster (historic names still route).
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

/** Boot sanity: 52 disjoint entries. Throws on drift. */
export function assertAnnexACoverage(): void {
  const all = REGIONS.flatMap((r) => ANNEX_A_STATES[r]);
  if (all.length !== 52) throw new Error(`Annex A expects 52 entries, found ${all.length}`);
  if (new Set(all).size !== 52) throw new Error("Annex A has duplicate state entries");
  const counts = REGIONS.map((r) => ANNEX_A_STATES[r].length).join("/");
  if (counts !== "17/17/18") throw new Error(`Annex A region sizes drifted: ${counts}`);
}
```

**Verify:** file compiles — `cd /home/runner/workspace && npx tsx -e "import('./server/vrm/rental-operations/annex-a-routing.ts').then(m => { m.assertAnnexACoverage(); console.log(m.resolveOwnerRouting({ techHomeState: 'OH' })); })"` → prints `{ owner: 'Oscar Santana', region: 'central', basis: 'tech_state', needsRouting: false }`.
**Commit:** `feat(routing): Annex A state-first routing module (52 entries, Rob fallback)`

## Task A2 — Shrink `region.ts` to a compat layer; delete the district vote

**Files:** `server/vrm/rental-operations/region.ts` (rewrite, 233 lines → ~40)

1. Replace the entire file body with re-exports + a state-first `resolveCaseRegion`:

```ts
// Region model now lives in annex-a-routing.ts (SOP v4 Annex A). This file
// keeps the legacy import surface alive. The district vote is GONE: three
// districts span two regions, so voting misroutes ~15% of escalations.
export {
  REGIONS, REGION_LABEL, REGION_OWNER, regionForState, assertAnnexACoverage,
} from "./annex-a-routing";
export type { Region } from "./annex-a-routing";
import { regionForState as rfs, type Region } from "./annex-a-routing";

export type RegionBasis = "tech_state" | "shop_state" | "plate_state" | null;
export interface RegionInput {
  tech_home_state?: string | null;
  shop_state?: string | null;
  renting_state?: string | null;
  tech_district?: string | null; // accepted, IGNORED (kept so call sites compile)
}

export function resolveCaseRegion(row: RegionInput): { region: Region | null; basis: RegionBasis } {
  for (const [basis, st] of [
    ["tech_state", row.tech_home_state],
    ["shop_state", row.shop_state],
    ["plate_state", row.renting_state],
  ] as const) {
    const r = rfs(st);
    if (r) return { region: r, basis };
  }
  return { region: null, basis: null };
}

/** @deprecated Annex A routes by state only. Kept until callers are gone. */
export function assertRegionCoverage(): void {
  // Delegates to the 52-entry check.
  return void import("./annex-a-routing").then((m) => m.assertAnnexACoverage());
}
```

2. **Delete** `assignDistrictRegions` and the old `REGION_STATES` tables outright. The old `resolveCaseRegion(row, districts)` took two args — the new one takes one; every caller updates in A3/A4.
3. If `assertRegionCoverage` is called synchronously at boot (check `rg -n "assertRegionCoverage" server/`), replace those call sites with `assertAnnexACoverage()` and delete the deprecated wrapper instead of keeping the async hack above.

**Verify:** `rg -n "assignDistrictRegions|REGION_STATES" server/ client/ shared/` → only hits inside region-routes.ts/ready-notify.ts remain (fixed next tasks); after A3/A4 → zero hits.
**Commit:** `refactor(routing): region.ts delegates to Annex A; district vote removed`

## Task A3 — Rewire `region-routes.ts` (Cases by Region)

**Files:** `server/vrm/rental-operations/region-routes.ts`

1. Remove `assignDistrictRegions` import + its call; call `resolveCaseRegion(row)` with the single-arg signature everywhere (rows already carry `tech_home_state` from the `loadTechHomeStates()` join — keep that join untouched).
2. `coverageError` check: replace the `assertRegionCoverage()`/51 expectation with `assertAnnexACoverage()` in try/catch; surface message unchanged.
3. Per-district rollups: keep them (UI shows district chips) but region assignment inside each rollup must come from the row's resolved region, not a district vote. Where the code previously grouped districts by voted region, group by `resolveCaseRegion(row).region` of member rows; a district appearing in two regions is CORRECT now (4766/8035/8206) — the rollup shape already tolerates it since it's keyed by district id.
4. `basis` values emitted to the client: now only `tech_state|shop_state|plate_state|null`. Grep the VRM client for the old basis string(s) (`rg -n "district" client/src/pages/vehicle-rental-management -S -i` scoped to region page) and drop any "via district" label branch.

**Verify:** `npx tsx -e` smoke: import region-routes module (registration function) compiles; then workflow `annex-a-routing-unit` (A5) covers resolution; manual: `curl` dev `/api/vrm/rental-operations/by-region` after `Start application` restart → every case with tech state OH/KY/IN/MI now under Central, SC under West; `coverageError` absent.
**Commit:** `fix(vrm): Cases by Region groups by Annex A state resolution`

## Task A4 — Rewire `ready-notify.ts`; kill the broadcast

**Files:** `server/vrm/rental-operations/ready-notify.ts`

1. Replace the district-vote block (`assignDistrictRegions` + `resolveCaseRegion(row, districts)`) with `resolveCaseRegion(row)`.
2. Null-region flips: today the LIVHR post targets "all regional owners" (broadcast). New behavior: **no region → no LIVHR region post**. Instead write the existing dedup action row (`action_type='pickup_text'` path untouched) plus a `vrm_rental_operation_actions` row `action_type='note'`, `actor='system:ready-notify'`, note `"READY flip could not resolve a region (no tech/shop/plate state) — routed to Rob Anderson via needs-routing"` so the bucket builder (Plan B) surfaces it in Rob's bucket. Keep the auto-text toggle + 7-day dedup logic exactly as is.
3. Regioned flips keep posting to LIVHR `/api/luca/notify-region-ready` with the SAME payload shape — only the region value now comes from Annex A. (LIVHR's own recipient config is out of scope; spec §10 transitional caveat.)

**Verify:** unit test in A5 covers `resolveCaseRegion` fallbacks; manual dev check: trigger a ready flip for a case with unmatched state (or tsx-invoke `notifyReadyFlip` with a stubbed row) → no LIVHR broadcast call, note row written.
**Commit:** `fix(vrm): ready-notify routes by Annex A; unrouted flips go to Rob, never broadcast`

## Task A5 — Unit tests + workflow

**Files:** create `tests/annex-a-routing.test.ts`; add workflow `annex-a-routing-unit` = `npx tsx --test tests/annex-a-routing.test.ts`

Test cases (node:test, no DB):
1. `assertAnnexACoverage()` does not throw; region sizes 17/17/18; union size 52.
2. Every one of the 52 entries resolves to its spec region (inline the three arrays in the test copied from the SPEC §4.1 tables, not imported from the module — the test must catch table typos, so duplicate them here deliberately).
3. Corrected states: OH,KY,IN,MI→central; SC→west; AL,AR,LA,MS→west; PR→central; DC→east.
4. Precedence: manual beats state (`{manualOwner:"Jennifer Dyer", techHomeState:"CA"}` → Jennifer, basis manual); tech beats shop; shop beats plate; all-null → `{owner:"Rob Anderson", needsRouting:true, basis:"unrouted"}`.
5. `regionForState` rejects junk: `""`, `"identity_state"`, `"Ohio"`, `"O"` → null.
6. `teamForDistrict("8206")` → Cheryl & Monica while `resolveOwnerRouting({techHomeState:"TN"})` → central/Oscar — the state/district separation acceptance case (spec §12.4); also `teamForDistrict("08206")` and `8206` (number) → same team; unknown district → null.

**Verify:** restart workflow `annex-a-routing-unit` → all pass. Then restart `Start application` (boot calls coverage assert) → clean boot. Run `npm run check` via the typecheck workflow → error count ≤ 213 baseline, no new errors in touched files.
**Commit:** `test(routing): Annex A tables, precedence chain, 8206 separation`

---

## Self-review notes
- `region.ts` keeps `RegionInput.tech_district` in the type so `region-routes.ts` row-building code compiles before its own task lands; it is ignored by resolution. Removed once C-plan cleanup greps run.
- `resolveOwnerRouting` honors non-roster manual owners on purpose — Action Tracker history contains departed names; routing them beats silently reassigning.
- Risk: unknown third consumer of `resolveCaseRegion(row, districts)` two-arg form → typecheck catches (signature change is loud). That is why A2 changes the signature instead of overloading.
