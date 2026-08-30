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
import { classifyPoVendor, summarizePoLines, poLineType, isQualifyingRepairPo, isNeverShopVendor, NEVER_SHOP_RE, NEVER_SHOP_SQL_RE } from "./vendor-class";
import { deriveWorkloadBucket, NON_WORKING_BUCKETS, CLOSED_REPAIR_BUCKETS } from "./workload";
import { isRegistrationExpired } from "./read-repository";

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

// ── payment instruments & billing rows (2026-07-23) ──────────────────────────
// The luca-rental-list feed offered these as SHOP_NAME on 11 trucks; LIVHR's
// parseVrmShopOfRecord guard rejected every one (sync counter rejectedVendor=11).
// A payment line pays the shop; it is not the shop.
test("single-use CC provider is 'other' even WITH parts/labor lines", () => {
  assert.equal(classifyPoVendor({ vendorName: "SINGLE USE CC PROVIDER USA", lines: [L("PARTS"), L("LABOR")] }).vendorType, "other");
  assert.equal(classifyPoVendor({ vendorName: "SINGLE USE CC PROVIDER USA", hasPartsOrLabor: true }).vendorType, "other");
});
test("single-use CC provider with roadside-only lines is 'other', not 'tow'", () => {
  assert.equal(classifyPoVendor({ vendorName: "SINGLE USE CC PROVIDER USA", lines: [L("ROADSIDE")] }).vendorType, "other");
});
test("ENTERPRISE - HANDBILL is 'rental_placeholder', never the shop", () => {
  assert.equal(classifyPoVendor({ vendorName: "ENTERPRISE - HANDBILL", lines: [L("OTHER")] }).vendorType, "rental_placeholder");
  assert.equal(classifyPoVendor({ vendorName: "ENTERPRISE - HANDBILL", lines: [L("PARTS")] }).vendorType, "rental_placeholder");
});
test("bare ENTERPRISE is the rental company; plural ENTERPRISES shops stay 'repair'", () => {
  assert.equal(classifyPoVendor({ vendorName: "ENTERPRISE FLEET MANAGEMENT" }).vendorType, "rental_placeholder");
  assert.equal(classifyPoVendor({ vendorName: "DAME ENTERPRISES LLC", lines: [L("PARTS")] }).vendorType, "repair");
  assert.equal(classifyPoVendor({ vendorName: "BUDDE ENTERPRISES INC" }).vendorType, "repair");
});
test("ENTERPRISE TOLLS stays 'toll' (TOLL_RE ranks above the rental blocklist)", () => {
  assert.equal(classifyPoVendor({ vendorName: "ENTERPRISE TOLLS/TOLL CHARGES" }).vendorType, "toll");
});
test("isQualifyingRepairPo excludes payment and handbill rows", () => {
  assert.equal(isQualifyingRepairPo({ vendorName: "SINGLE USE CC PROVIDER USA", lines: [L("PARTS")] }), false);
  assert.equal(isQualifyingRepairPo({ vendorName: "ENTERPRISE - HANDBILL", lines: [L("PARTS")] }), false);
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

// ── HARD RULE (Tyler 2026-08-05): never the shop of record ───────────────────
// "We never list [towing and recovery companies] as the current shop … not a
// towing company, not TRAC, not Safelite." Stronger than the classification
// above: parts/labor lines may still make such a PO COUNT as an open repair,
// but the vendor may never be LISTED or DIALED as the current shop.
console.log("\nvendor-class — never-shop-of-record rule (Tyler 2026-08-05)");

test("towing/recovery names are never-shop (truck 36221's Suburban Towing regression)", () => {
  for (const name of [
    "SUBURBAN TOWING+RECOVERY",      // the reported truck-36221 case
    "ADAMIS TOWING AND RECOVERY, IN",
    "ABC RECOVERY LLC",              // recovery-only name, no TOW token
    "9-H TOWING & WRECKER",
    "ACE WRECKER",
    "A+M TOW+ROAD SERVICE INC.",
    "TRXNOW",
  ]) assert.equal(isNeverShopVendor(name), true, name);
});
test("glass and roadside-broker names are never-shop", () => {
  for (const name of [
    "SAFELITE AUTOGLASS",
    "A-CLASS AUTO GLASS",
    "BIG STONE GLASS CO., INC.",
    "TRAC INTERSTAR",
    "TRACS",
  ]) assert.equal(isNeverShopVendor(name), true, name);
});
test("real repair shops are NOT never-shop (word boundaries hold)", () => {
  for (const name of [
    "PEP BOYS # 1649",
    "CASTLE CHEVROLET NORTH",        // the shop 36221 should list instead
    "DAME ENTERPRISES LLC",
    "TRACY'S AUTO REPAIR",           // TRAC must not match inside TRACY
    "FIRST CLASS AUTO REPAIR",       // GLASS must not match inside CLASS
    "TRACTOR SUPPLY",                // TRAC must not match inside TRACTOR
    "MYERS AUTO SERVICE, INC.",
  ]) assert.equal(isNeverShopVendor(name), false, name);
});
test("never-shop is INDEPENDENT of Tyler's parts/labor exception", () => {
  // Parts/labor still promotes the PO to 'repair' for open-count purposes…
  assert.equal(classifyPoVendor({ vendorName: "SUBURBAN TOWING+RECOVERY", lines: [L("PARTS"), L("LABOR")] }).vendorType, "repair");
  // …but the vendor stays banned from the shop-of-record pick.
  assert.equal(isNeverShopVendor("SUBURBAN TOWING+RECOVERY"), true);
});
test("RECOVERY names now classify 'tow' without parts/labor (TOW_RE extension)", () => {
  assert.equal(classifyPoVendor({ vendorName: "ABC RECOVERY LLC", lines: [L("ROADSIDE")] }).vendorType, "tow");
});
test("LOGISTICS names are never-shop and classify 'tow' (truck 36385's Premier Auto Logistics regression, Tyler 2026-08-10)", () => {
  // Truck 36385 / PO 120013586: PREMIER AUTO LOGISTICS LLC (a transport/towing
  // outfit, PO descr "ROADSIDE", no parts/labor) surfaced as the last-PO shop on
  // Rental Ops. Logistics names carry no TOW token, so they need their own term.
  assert.equal(isNeverShopVendor("PREMIER AUTO LOGISTICS LLC"), true);
  assert.equal(classifyPoVendor({ vendorName: "PREMIER AUTO LOGISTICS LLC", hasPartsOrLabor: false }).vendorType, "tow");
  // Tyler's parts/labor exception still promotes it to 'repair' for open-count
  // purposes, but never-shop keeps it off every board/queue/feed.
  assert.equal(classifyPoVendor({ vendorName: "PREMIER AUTO LOGISTICS LLC", lines: [L("PARTS"), L("LABOR")] }).vendorType, "repair");
  assert.equal(isNeverShopVendor("PREMIER AUTO LOGISTICS LLC"), true);
});
test("JS and SQL never-shop patterns agree on every fixture", () => {
  // The SQL form uses Postgres \m/\M word boundaries; translate to JS \b and
  // verify both patterns give identical answers, so the CTE filter and the
  // portal-side picker cannot drift.
  const sqlAsJs = new RegExp(NEVER_SHOP_SQL_RE.replace(/\\[mM]/g, "\\b").replace(/ \?/g, "\\s?"), "i");
  for (const name of [
    "SUBURBAN TOWING+RECOVERY", "ABC RECOVERY LLC", "9-H TOWING & WRECKER",
    "ACE WRECKER", "A+M TOW+ROAD SERVICE INC.", "TRXNOW", "SAFELITE AUTOGLASS",
    "A-CLASS AUTO GLASS", "TRAC INTERSTAR", "TRACS", "JUMP START SERVICES",
    "PEP BOYS # 1649", "CASTLE CHEVROLET NORTH", "DAME ENTERPRISES LLC",
    "TRACY'S AUTO REPAIR", "FIRST CLASS AUTO REPAIR", "TRACTOR SUPPLY",
    "PREMIER AUTO LOGISTICS LLC", "XPO LOGISTICS", "LOGISTICAL SOLUTIONS AUTO REPAIR",
  ]) assert.equal(sqlAsJs.test(name), NEVER_SHOP_RE.test(name), name);
});

console.log("\nworkload — Tyler's LUCA workload rule (assigned-truck-first, 8 buckets, 2026-08-30)");

// The unit of work is the TECHNICIAN'S CURRENT TRUCK. Decision order:
// unresolved tech -> no truck -> not ours -> open repair -> no history ->
// tags -> system conflict -> clean recovery.
const W = (o: Partial<Parameters<typeof deriveWorkloadBucket>[0]>) =>
  deriveWorkloadBucket({
    amsBucket: "assigned", assignedTruck: "12345", assignedMismatch: false,
    assignedHasRepairPo: true, assignedHasAnyRepairPo: true, ...o,
  });

test("unresolved renter is the identity queue, never the call queue", () => {
  assert.equal(W({ techUnresolved: true }), "tech_unresolved");
});
test("unresolved renter outranks everything, even a healthy assigned truck", () => {
  assert.equal(W({ techUnresolved: true, assignedHasRepairPo: true }), "tech_unresolved");
});
test("no assigned truck means nobody to go after", () => {
  assert.equal(W({ assignedTruck: null, assignedHasRepairPo: null, assignedHasAnyRepairPo: null }), "no_assigned_truck");
});
test("no assigned truck wins over a declined AMS status", () => {
  assert.equal(W({ assignedTruck: null, amsBucket: "declined", assignedHasRepairPo: null }), "no_assigned_truck");
});

// ── the truck is gone ────────────────────────────────────────────────────────
test("declined assigned truck is cannot_work (needs a permanent vehicle)", () => {
  assert.equal(W({ amsBucket: "declined" }), "cannot_work");
});
test("auctioned assigned truck is cannot_work even with an OPEN repair PO", () => {
  // 15 of 93 auction cases on prod still carried an open PO. We are not getting
  // the truck back either way, so the answer is a vehicle, never a shop call.
  assert.equal(W({ amsBucket: "auction", assignedHasRepairPo: true }), "cannot_work");
});
test("REGRESSION: the status read is the ASSIGNED truck's, not the rental van's", () => {
  // The caller passes assignedAmsBucket. A scrapped rental van paired with a
  // healthy assigned truck must stay workable — that failure is how techs whose
  // own truck was genuinely in a shop went uncalled.
  assert.equal(W({ amsBucket: "assigned", assignedMismatch: true, assignedHasRepairPo: true }), "workable");
});

// ── the four-way split of the closed-repair cohort (Tyler 2026-08-30) ────────
test("open repair PO is workable and outranks expired tags", () => {
  // The shop call is still the right next action; tags get chased in parallel
  // and the expired flag still rides on the row.
  assert.equal(W({ assignedHasRepairPo: true, registrationExpired: true }), "workable");
});
test("SPLIT 1: repair closed + expired tags is blocked_registration", () => {
  assert.equal(W({ assignedHasRepairPo: false, registrationExpired: true }), "blocked_registration");
});
test("SPLIT 2: repair closed + AMS still says In Repair is status_conflict", () => {
  assert.equal(W({ assignedHasRepairPo: false, amsBucket: "in_repair", amsSaysInRepair: true }), "status_conflict");
});
test("SPLIT 3: repair closed, healthy and legal is ready_to_recover", () => {
  assert.equal(W({ assignedHasRepairPo: false }), "ready_to_recover");
});
test("SPLIT 4: no repair history at all is NOT the same as no repair", () => {
  assert.equal(W({ assignedHasRepairPo: false, assignedHasAnyRepairPo: false }), "no_repair_history");
});
test("unknown repair history is treated as no history, never as recovered", () => {
  assert.equal(W({ assignedHasRepairPo: false, assignedHasAnyRepairPo: null }), "no_repair_history");
});
test("dead tags outrank a system conflict (hard blocker beats a soft one)", () => {
  assert.equal(W({ assignedHasRepairPo: false, registrationExpired: true, amsSaysInRepair: true }), "blocked_registration");
});
test("no repair history outranks tags — we cannot claim a repair finished", () => {
  assert.equal(W({ assignedHasRepairPo: false, assignedHasAnyRepairPo: false, registrationExpired: true }), "no_repair_history");
});
test("unknown repair-PO answer never lands in ready_to_recover", () => {
  assert.notEqual(W({ assignedHasRepairPo: null, assignedHasAnyRepairPo: true }), "workable");
});

test("bucket lists agree with the rule", () => {
  for (const b of ["tech_unresolved", "no_assigned_truck", "cannot_work",
                   "blocked_registration", "status_conflict", "ready_to_recover",
                   "no_repair_history"] as const) {
    assert.ok(NON_WORKING_BUCKETS.includes(b), `${b} missing from NON_WORKING_BUCKETS`);
  }
  assert.ok(!NON_WORKING_BUCKETS.includes("workable"));
  for (const b of ["ready_to_recover", "blocked_registration", "status_conflict", "no_repair_history"] as const) {
    assert.ok(CLOSED_REPAIR_BUCKETS.includes(b), `${b} missing from CLOSED_REPAIR_BUCKETS`);
  }
});

console.log("\nregistration expiry — blank is UNKNOWN, never expired");

const TODAY = new Date(2026, 7, 30); // 2026-08-30
test("a past renewal date is expired", () => {
  assert.equal(isRegistrationExpired("3/31/2026", TODAY), true);
});
test("a future renewal date is not expired", () => {
  assert.equal(isRegistrationExpired("3/31/2027", TODAY), false);
});
test("a tag expiring TODAY is still valid today", () => {
  assert.equal(isRegistrationExpired("8/30/2026", TODAY), false);
});
test("yesterday is expired", () => {
  assert.equal(isRegistrationExpired("8/29/2026", TODAY), true);
});
test("⛔ BLANK is unknown, not expired (7,300 of 9,937 Holman rows are blank)", () => {
  assert.equal(isRegistrationExpired("", TODAY), false);
  assert.equal(isRegistrationExpired(null, TODAY), false);
  assert.equal(isRegistrationExpired(undefined, TODAY), false);
  assert.equal(isRegistrationExpired("   ", TODAY), false);
});
test("unparseable text is unknown, not expired", () => {
  assert.equal(isRegistrationExpired("N/A", TODAY), false);
  assert.equal(isRegistrationExpired("2026-03-31", TODAY), false);
  // month 31 is impossible; rolling it over would turn a dead tag into a valid one
  assert.equal(isRegistrationExpired("31/3/2026", TODAY), false);
  assert.equal(isRegistrationExpired("2/30/2026", TODAY), false); // Feb 30 does not exist
});
test("surrounding whitespace parses", () => {
  assert.equal(isRegistrationExpired("  6/30/2026  ", TODAY), true);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
