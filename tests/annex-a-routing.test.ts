/**
 * Annex A routing module — SOP v4.0 (2026-08-05) Annex A tables + §4 chain.
 *
 * The three state arrays below are DUPLICATED from the spec
 * (docs/specs/2026-08-05-persona-bucket-queue-design.md §4.1) on purpose:
 * the test must catch a typo in the module's tables, so it cannot import them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ANNEX_A_STATES,
  OWNER_ROSTER,
  REGIONS,
  UNROUTED_OWNER,
  assertAnnexACoverage,
  regionForState,
  resolveOwnerRouting,
  teamForDistrict,
} from "../server/vrm/rental-operations/annex-a-routing";
import { resolveCaseRegion, assertRegionCoverage } from "../server/vrm/rental-operations/region";

const SPEC_EAST = ["CT", "DC", "DE", "FL", "GA", "MA", "MD", "ME", "NC", "NH", "NJ", "NY", "PA", "RI", "VA", "VT", "WV"];
const SPEC_CENTRAL = ["IA", "IL", "IN", "KS", "KY", "MI", "MN", "MO", "ND", "NE", "OH", "OK", "PR", "SD", "TN", "TX", "WI"];
const SPEC_WEST = ["AK", "AL", "AR", "AZ", "CA", "CO", "HI", "ID", "LA", "MS", "MT", "NM", "NV", "OR", "SC", "UT", "WA", "WY"];

test("coverage: 52 disjoint entries, 17/17/18", () => {
  assertAnnexACoverage(); // must not throw
  assertRegionCoverage(); // legacy alias delegates
  assert.equal(ANNEX_A_STATES.east.length, 17);
  assert.equal(ANNEX_A_STATES.central.length, 17);
  assert.equal(ANNEX_A_STATES.west.length, 18);
  const all = REGIONS.flatMap((r) => [...ANNEX_A_STATES[r]]);
  assert.equal(new Set(all).size, 52);
});

test("every one of the 52 spec entries resolves to its spec region", () => {
  for (const st of SPEC_EAST) assert.equal(regionForState(st), "east", st);
  for (const st of SPEC_CENTRAL) assert.equal(regionForState(st), "central", st);
  for (const st of SPEC_WEST) assert.equal(regionForState(st), "west", st);
});

test("SOP A.6 corrected states land in their NEW regions", () => {
  for (const st of ["OH", "KY", "IN", "MI"]) assert.equal(regionForState(st), "central", st);
  assert.equal(regionForState("SC"), "west");
  for (const st of ["AL", "AR", "LA", "MS"]) assert.equal(regionForState(st), "west", st);
  assert.equal(regionForState("PR"), "central");
  assert.equal(regionForState("DC"), "east");
});

test("regionForState rejects junk", () => {
  for (const junk of ["", "identity_state", "Ohio", "O", "  ", null, undefined, "ZZ"]) {
    assert.equal(regionForState(junk as any), null, String(junk));
  }
  // but tolerates case/whitespace on real codes
  assert.equal(regionForState(" tx "), "central");
});

test("resolution chain: manual > tech > shop > plate > Rob Anderson", () => {
  // manual wins even over a resolvable state
  const manual = resolveOwnerRouting({ manualOwner: "Jennifer Dyer", techHomeState: "CA" });
  assert.deepEqual(
    { owner: manual.owner, basis: manual.basis, needsRouting: manual.needsRouting },
    { owner: "Jennifer Dyer", basis: "manual", needsRouting: false },
  );
  assert.equal(manual.region, "west"); // region still computed for display

  // manual owner off-roster still routes (historic names)
  assert.equal(resolveOwnerRouting({ manualOwner: "John C", techHomeState: "TX" }).owner, "John C");

  // tech beats shop
  const tech = resolveOwnerRouting({ techHomeState: "OH", shopState: "CA" });
  assert.equal(tech.owner, "Oscar Santana");
  assert.equal(tech.basis, "tech_state");

  // shop beats plate
  const shop = resolveOwnerRouting({ shopState: "FL", plateState: "CA" });
  assert.equal(shop.owner, "Olga Fernandez");
  assert.equal(shop.basis, "shop_state");

  // plate as last resort
  const plate = resolveOwnerRouting({ plateState: "WA" });
  assert.equal(plate.owner, "Sandeep Kalyani");
  assert.equal(plate.basis, "plate_state");

  // nothing resolvable -> Rob Anderson, flagged, never broadcast
  const unrouted = resolveOwnerRouting({});
  assert.deepEqual(unrouted, { owner: UNROUTED_OWNER, region: null, basis: "unrouted", needsRouting: true });
  assert.equal(UNROUTED_OWNER, "Rob Anderson");
});

test("district 8206 separation: team by district, region by state (spec §12.4)", () => {
  // Mid South spans regions — team assignment must NOT leak into region routing.
  assert.equal(teamForDistrict("8206"), "Cheryl & Monica");
  assert.equal(teamForDistrict("08206"), "Cheryl & Monica");
  assert.equal(teamForDistrict(8206), "Cheryl & Monica");
  const routed = resolveOwnerRouting({ techHomeState: "TN" });
  assert.equal(routed.region, "central");
  assert.equal(routed.owner, "Oscar Santana");
});

test("teamForDistrict: all three teams + unknowns", () => {
  assert.equal(teamForDistrict("7088"), "Carol & Tasha");
  assert.equal(teamForDistrict("4766"), "Rob D & Andrea");
  assert.equal(teamForDistrict("9999"), null);
  assert.equal(teamForDistrict(""), null);
  assert.equal(teamForDistrict(null), null);
});

test("roster is exactly the 8 approved buckets", () => {
  assert.deepEqual([...OWNER_ROSTER], [
    "Olga Fernandez", "Oscar Santana", "Sandeep Kalyani", "Rob Anderson",
    "Jennifer Dyer", "Carol & Tasha", "Cheryl & Monica", "Rob D & Andrea",
  ]);
});

test("legacy resolveCaseRegion: single-arg, state-first, district ignored", () => {
  const byTech = resolveCaseRegion({ tech_district: "8206", tech_home_state: "OH" });
  assert.equal(byTech.region, "central");
  assert.equal(byTech.basis, "tech_state");
  assert.equal(byTech.districtSplit, false);

  const byShop = resolveCaseRegion({ tech_district: "7088", shop_state: "GA" });
  assert.equal(byShop.region, "east");
  assert.equal(byShop.basis, "shop_state");

  const byRenting = resolveCaseRegion({ renting_state: "TX" });
  assert.equal(byRenting.region, "central");
  assert.equal(byRenting.basis, "renting_state");

  const none = resolveCaseRegion({ tech_district: "7435" });
  assert.equal(none.region, null);
  assert.equal(none.basis, "unassigned");
});
