/**
 * Unit tests for Holman PO vendor classification (Tyler's PO rule) and the LUCA
 * workload buckets (Tyler's workload rule). Both modules are pure — no DB, no
 * env, no Snowflake.
 *
 * The Nexus repo has no test framework, so this follows the repo's
 * node:assert + tsx-script convention (see server/luca-writeback/mapper.test.ts):
 *
 *   npx tsx server/vrm/rental-operations/vendor-class.test.ts
 *
 * Exits 0 when all cases pass, 1 otherwise.
 */
import assert from "node:assert/strict";
import { classifyPoVendor, summarizePoLines, poLineType, isQualifyingRepairPo } from "./vendor-class";
import { deriveWorkloadBucket } from "./workload";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void): void {
  try { fn(); passed++; console.log(`  PASS  ${name}`); }
  catch (err: any) { failed++; console.error(`  FAIL  ${name}`); console.error(`        ${err?.message ?? err}`); }
}
const L = (t: string) => ({ typeDesc: t });
const E = (t: string) => ({ repairType: t });

console.log("\nvendor-class — Tyler's PO rule");

// ── REGRESSION: the bug that hid real shops from LUCA ────────────────────────
test("REGRESSION: repair shop with a ROADSIDE ata group is still 'repair'", () => {
  // truck 23158 / PO 119774395: PEP BOYS, ATA groups "CAB & SHEET METAL;
  // EXPENDABLE ITEMS; LIGHTING SYSTEM; ROADSIDE". The old classifier tested the
  // tow regex against vendorName + description and filed this as 'tow', which
  // dropped the truck out of the repair cohort and made it uncallable.
  const r = classifyPoVendor({ vendorName: "PEP BOYS", lines: [L("PARTS"), L("LABOR"), L("TAX")] });
  assert.equal(r.vendorType, "repair");
  assert.equal(r.hasPartsOrLabor, true);
});
test("REGRESSION: ATA group text is never fed to the vendor-name regex", () => {
  // ataGroup is accepted on the line shape but must not influence the result.
  const withAta = classifyPoVendor({ vendorName: "PEP BOYS", lines: [{ typeDesc: "PARTS", ataGroup: "ROADSIDE" }] });
  const without = classifyPoVendor({ vendorName: "PEP BOYS", lines: [{ typeDesc: "PARTS" }] });
  assert.equal(withAta.vendorType, "repair");
  assert.equal(withAta.vendorType, without.vendorType);
});

// ── Tyler's parts/labor EXCEPTION ────────────────────────────────────────────
test("tow-named vendor WITH parts is 'repair' (Tyler's exception)", () => {
  assert.equal(classifyPoVendor({ vendorName: "WHITE HUFF TOWING", lines: [L("PARTS"), L("ROADSIDE")] }).vendorType, "repair");
});
test("tow-named vendor WITH labor is 'repair' (Tyler's exception)", () => {
  assert.equal(classifyPoVendor({ vendorName: "TRXNOW", lines: [L("LABOR")] }).vendorType, "repair");
});
test("tow-named vendor with ONLY roadside is 'tow'", () => {
  assert.equal(classifyPoVendor({ vendorName: "TRXNOW", lines: [L("ROADSIDE")] }).vendorType, "tow");
});
test("tow-named vendor with no lines at all is 'tow'", () => {
  assert.equal(classifyPoVendor({ vendorName: "ADVANCED TOWING & RECOVERY" }).vendorType, "tow");
});
test("pre-aggregated hasPartsOrLabor overrides line derivation (ETL path)", () => {
  const r = classifyPoVendor({ vendorName: "WHITE HUFF TOWING", hasPartsOrLabor: true, allRentalRoadside: true, anyRoadside: true });
  assert.equal(r.vendorType, "repair");
  assert.equal(r.hasPartsOrLabor, true);
});

// ── blocklists + ordering ────────────────────────────────────────────────────
test("rental blocklist wins over everything", () => {
  assert.equal(classifyPoVendor({ vendorName: "ENTERPRISE RENT-A-CAR INC.", lines: [L("PARTS"), L("LABOR")] }).vendorType, "rental_placeholder");
});
test("toll vendor is 'toll'", () => {
  assert.equal(classifyPoVendor({ vendorName: "ENTERPRISE TOLLS", lines: [L("OTHER")] }).vendorType, "toll");
});
test("parts distributor is 'parts'", () => {
  assert.equal(classifyPoVendor({ vendorName: "JASPER ENGINES", lines: [L("PARTS")] }).vendorType, "parts");
});
test("ordinary shop with no lines is 'repair'", () => {
  assert.equal(classifyPoVendor({ vendorName: "MYERS AUTO SERVICE, INC." }).vendorType, "repair");
});
test("preventive-maintenance-only shop is still 'repair'", () => {
  assert.equal(classifyPoVendor({ vendorName: "EXPRESS OIL CHANGE", lines: [E("PREVENTIVE MAINT."), E("TAX")] }).vendorType, "repair");
});
test("non-tow name whose PO is ONLY roadside lines is 'tow'", () => {
  assert.equal(classifyPoVendor({ vendorName: "SOME GARAGE LLC", lines: [L("ROADSIDE"), L("ROADSIDE")] }).vendorType, "tow");
});
test("non-tow name whose PO is ONLY rental lines is 'rental_placeholder'", () => {
  assert.equal(classifyPoVendor({ vendorName: "SOME GARAGE LLC", lines: [L("RENTAL")] }).vendorType, "rental_placeholder");
});
test("missing vendor name is 'other', never 'repair'", () => {
  assert.equal(classifyPoVendor({ vendorName: null, lines: [L("PARTS")] }).vendorType, "other");
  assert.equal(classifyPoVendor({ vendorName: "   " }).vendorType, "other");
});
test("null-safe on every input shape", () => {
  assert.equal(classifyPoVendor({ vendorName: undefined }).vendorType, "other");
  assert.equal(classifyPoVendor({ vendorName: "SHOP", lines: null }).vendorType, "repair");
  assert.equal(classifyPoVendor({ vendorName: "SHOP", lines: [] }).vendorType, "repair");
  assert.equal(classifyPoVendor({ vendorName: "SHOP", lines: [{}] as any }).vendorType, "repair");
});

// ── helpers ──────────────────────────────────────────────────────────────────
test("poLineType prefers typeDesc, falls back to repairType, uppercases", () => {
  assert.equal(poLineType({ typeDesc: "parts", repairType: "LABOR" }), "PARTS");
  assert.equal(poLineType({ repairType: " labor " }), "LABOR");
  assert.equal(poLineType(null), "");
});
test("summarizePoLines reports counts + flags", () => {
  const s = summarizePoLines([L("ROADSIDE"), L("RENTAL")]);
  assert.equal(s.lineCount, 2);
  assert.equal(s.hasPartsOrLabor, false);
  assert.equal(s.allRentalRoadside, true);
  assert.equal(s.anyRoadside, true);
  assert.equal(summarizePoLines([]).allRentalRoadside, false);
});
test("isQualifyingRepairPo mirrors Tyler's rule", () => {
  assert.equal(isQualifyingRepairPo({ vendorName: "TRXNOW", lines: [L("ROADSIDE")] }), false);
  assert.equal(isQualifyingRepairPo({ vendorName: "TRXNOW", lines: [L("PARTS")] }), true);
});

console.log("\nworkload — Tyler's LUCA workload rule");

test("declined status is cannot_work", () => {
  assert.equal(deriveWorkloadBucket({ amsBucket: "declined", assignedTruck: "12345", assignedMismatch: true, assignedHasRepairPo: false }), "cannot_work");
});
test("auction status is cannot_work", () => {
  assert.equal(deriveWorkloadBucket({ amsBucket: "auction", assignedTruck: null, assignedMismatch: false, assignedHasRepairPo: null }), "cannot_work");
});
test("cannot_work wins even when the assigned truck has a repair PO", () => {
  assert.equal(deriveWorkloadBucket({ amsBucket: "declined", assignedTruck: "12345", assignedMismatch: true, assignedHasRepairPo: true }), "cannot_work");
});
test("renter assigned elsewhere with NO repair PO is the escalation cohort", () => {
  assert.equal(deriveWorkloadBucket({ amsBucket: "in_repair", assignedTruck: "12345", assignedMismatch: true, assignedHasRepairPo: false }), "mismatch_no_po");
});
test("unknown repair-PO answer on a mismatch escalates (never assumed workable)", () => {
  assert.equal(deriveWorkloadBucket({ amsBucket: "in_use", assignedTruck: "12345", assignedMismatch: true, assignedHasRepairPo: null }), "mismatch_no_po");
});
test("renter assigned elsewhere WITH a repair PO is workable", () => {
  assert.equal(deriveWorkloadBucket({ amsBucket: "in_repair", assignedTruck: "12345", assignedMismatch: true, assignedHasRepairPo: true }), "workable");
});
test("congruent renter/truck is workable regardless of the assigned PO", () => {
  assert.equal(deriveWorkloadBucket({ amsBucket: "in_repair", assignedTruck: "12345", assignedMismatch: false, assignedHasRepairPo: false }), "workable");
});
test("unresolved assigned truck is workable, not an escalation", () => {
  assert.equal(deriveWorkloadBucket({ amsBucket: "unknown", assignedTruck: null, assignedMismatch: true, assignedHasRepairPo: null }), "workable");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
