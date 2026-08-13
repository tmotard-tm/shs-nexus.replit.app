import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Task #623 — live TPMS truck-assignment pre-check for the Update District flow.
 *
 * classifyLiveTpmsTruckLookup is the pure decision core: it turns a live
 * GET /techinfo/{truckNo} outcome into { checked, assigned, ... }.
 *
 *  - assigned tech          → checked:true,  assigned:true (names the tech)
 *  - "No Data Found" (400)  → checked:true,  assigned:false (genuinely unassigned)
 *  - empty techInfoList     → checked:true,  assigned:false
 *  - any other error        → checked:false (unknown — fall back to cache gate)
 */
import {
  classifyLiveTpmsTruckLookup,
  decideDistrictTpmsGate,
  type LiveTpmsTruckAssignment,
} from "../server/fleet-operations-service.js";

test("assigned truck → assigned:true with tech identity", () => {
  const r = classifyLiveTpmsTruckLookup({
    info: { ldapId: "gvilla0 ", firstName: "Gabe", lastName: "Villa", districtNo: "0008096" },
  });
  assert.deepEqual(r, {
    checked: true,
    assigned: true,
    ldapId: "GVILLA0",
    techName: "Gabe Villa",
    districtNo: "0008096",
  });
});

test("entry with blank ldapId → treated as unassigned", () => {
  const r = classifyLiveTpmsTruckLookup({ info: { ldapId: "  ", firstName: null, lastName: null } });
  assert.equal(r.checked, true);
  assert.equal(r.assigned, false);
});

test('HTTP 400 "No Data Found" → genuinely unassigned', () => {
  const r = classifyLiveTpmsTruckLookup({
    error: { statusCode: 400, message: 'Tech info request failed: 400 - {"messages":["No Data Found"]}' },
  });
  assert.deepEqual(r, { checked: true, assigned: false });
});

test("empty techInfoList error → genuinely unassigned", () => {
  const r = classifyLiveTpmsTruckLookup({
    error: { message: "TPMS returned no tech info entries" },
  });
  assert.deepEqual(r, { checked: true, assigned: false });
});

test("400 with a DIFFERENT message is NOT unassigned — unknown", () => {
  const r = classifyLiveTpmsTruckLookup({
    error: { statusCode: 400, message: "Invalid truck and/or dist passed" },
  });
  assert.equal(r.checked, false);
  assert.equal(r.assigned, false);
  assert.match(String(r.error), /Invalid truck/);
});

test("transport/server error → unknown (checked:false), never 'unassigned'", () => {
  const r = classifyLiveTpmsTruckLookup({
    error: { statusCode: 503, message: "Tech info request failed: 503 - upstream unavailable" },
  });
  assert.equal(r.checked, false);
  assert.equal(r.assigned, false);
});

test("missing first/last name → techName omitted, not empty string", () => {
  const r = classifyLiveTpmsTruckLookup({ info: { ldapId: "ABC12", firstName: "", lastName: null } });
  assert.equal(r.assigned, true);
  assert.equal(r.techName, undefined);
});

/* ──────────────────────────────────────────────────────────────────────────
 * decideDistrictTpmsGate — the route's decision matrix.
 * ────────────────────────────────────────────────────────────────────────── */

const liveAssigned: LiveTpmsTruckAssignment = {
  checked: true, assigned: true, ldapId: "GVILLA0", techName: "Gerardo Villaluz",
};
const liveUnassigned: LiveTpmsTruckAssignment = { checked: true, assigned: false };
const liveUnknown: LiveTpmsTruckAssignment = { checked: false, assigned: false, error: "503" };

test("gate: live assigned + no confirm → structured conflict naming the tech", () => {
  const d = decideDistrictTpmsGate({ live: liveAssigned, cacheTpmsAssigned: false, clearTpmsAssignment: false });
  assert.deepEqual(d, { action: "conflict", ldapId: "GVILLA0", techName: "Gerardo Villaluz" });
});

test("gate: live assigned + operator confirmed → clear-and-proceed", () => {
  const d = decideDistrictTpmsGate({ live: liveAssigned, cacheTpmsAssigned: false, clearTpmsAssignment: true });
  assert.deepEqual(d, { action: "clear-and-proceed", ldapId: "GVILLA0", techName: "Gerardo Villaluz" });
});

test("gate: live unassigned, cache agrees → proceed with no heal (happy path unchanged)", () => {
  const d = decideDistrictTpmsGate({ live: liveUnassigned, cacheTpmsAssigned: false, clearTpmsAssignment: false });
  assert.deepEqual(d, { action: "proceed", healUnassigned: false });
});

test("gate: live unassigned but cache claims a tech → proceed + heal cache to unassigned", () => {
  const d = decideDistrictTpmsGate({ live: liveUnassigned, cacheTpmsAssigned: true, clearTpmsAssignment: false });
  assert.deepEqual(d, { action: "proceed", healUnassigned: true });
});

test("gate: live check unavailable + cache says assigned → blocked (original gate)", () => {
  const d = decideDistrictTpmsGate({ live: liveUnknown, cacheTpmsAssigned: true, clearTpmsAssignment: false });
  assert.deepEqual(d, { action: "blocked" });
});

test("gate: live check unavailable + cache unassigned → proceed-unverified (today's behavior)", () => {
  const d = decideDistrictTpmsGate({ live: liveUnknown, cacheTpmsAssigned: false, clearTpmsAssignment: false });
  assert.deepEqual(d, { action: "proceed-unverified" });
});

test("gate: confirm flag NEVER clears when live TPMS shows unassigned or unknown", () => {
  assert.equal(decideDistrictTpmsGate({ live: liveUnassigned, cacheTpmsAssigned: true, clearTpmsAssignment: true }).action, "proceed");
  assert.equal(decideDistrictTpmsGate({ live: liveUnknown, cacheTpmsAssigned: true, clearTpmsAssignment: true }).action, "blocked");
});
