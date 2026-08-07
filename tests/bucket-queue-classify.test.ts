/**
 * Unit tests for the persona-bucket classification table + SLA math
 * (server/vrm/rental-operations/bucket-classify.ts) — spec §6/§7.
 * Pure module: no DB, no network. Run: npx tsx --test tests/bucket-queue-classify.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLASSIFICATIONS,
  CLASSIFICATION_BY_KEY,
  classify,
  ownerForClassification,
  shopStateFromAddress,
  addBusinessDays,
  businessDaysLate,
  todayET,
  type ClassifyInput,
} from "../server/vrm/rental-operations/bucket-classify";
import type { RoutingResult } from "../server/vrm/rental-operations/annex-a-routing";

const base: ClassifyInput = {
  fleetScopeStatus: "Repairing",
  subStatus: null,
  lucaStatus: null,
  lucaReady: false,
  readyVerified: false,
  researchActive: false,
  latestCallUnresolved: false,
  workbookStatus: null,
  workbookFollowUpDue: false,
  escalated: false,
  erdPassed: false,
  poClosedWhileInRepair: false,
  schedulingDue: false,
  schedulingUnscheduled: false,
  pickupDatePassed: false,
  returnInFlight: false,
  etaSlips: 0,
  daysInShop: null,
  daysSinceLastAttempt: null,
  callAttempts2d: 0,
  tagsHold: false,
  noQualifyingPo: false,
  decommission: false,
  declinedOrAuction: false,
  amsTerminal: false,
  replacementAssigned: false,
  assignedTruckInRepair: false,
  readyGuardDowngraded: false,
  shopPhoneBad: false,
};

test("table: 24 defs, unique keys, valid priorities and owner rules", () => {
  assert.equal(CLASSIFICATIONS.length, 24);
  const keys = new Set(CLASSIFICATIONS.map((c) => c.key));
  assert.equal(keys.size, 24, "keys must be unique");
  for (const c of CLASSIFICATIONS) {
    assert.ok([1, 2, 3, 4].includes(c.priority), `${c.key} priority`);
    assert.ok(["regional", "rob", "jennifer", "district_team"].includes(c.ownerRule), `${c.key} ownerRule`);
    assert.ok(c.slaBusinessDays === null || c.slaBusinessDays > 0, `${c.key} sla`);
    assert.equal(CLASSIFICATION_BY_KEY.get(c.key), c);
  }
});

test("each classification fires from its minimal input", () => {
  const cases: Array<[string, Partial<ClassifyInput>]> = [
    ["replacement_assigned", { declinedOrAuction: true, replacementAssigned: true }],
    ["retrieval_pending", { decommission: true }],
    ["ams_status_conflict", { amsTerminal: true }],
    ["luca_escalated", { escalated: true }],
    ["unverified_confirm", { lucaStatus: "Unverified - confirm by phone" }],
    ["ready_guard_review", { readyGuardDowngraded: true }],
    ["vehicle_ready_schedule", { lucaReady: true }],
    ["vehicle_ready_schedule", { readyVerified: true }],
    ["po_closed_confirm", { erdPassed: true }],
    ["po_closed_confirm", { poClosedWhileInRepair: true }],
    ["research_truck_status", { researchActive: true }],
    // Pickup scheduling only presents once readiness is phone-confirmed
    // (LUCA Ready or manual verification) — directive 2026-08-07.
    ["schedule_tech_pickup", { schedulingDue: true, lucaReady: true }],
    ["schedule_tech_pickup", { schedulingUnscheduled: true, readyVerified: true }],
    ["scheduling_unvalidated", { fleetScopeStatus: "Scheduling" }],
    ["scheduling_unvalidated", { fleetScopeStatus: "Scheduling", schedulingDue: true }],
    ["confirm_rental_returned", { returnInFlight: true }],
    ["pickup_follow_up", { pickupDatePassed: true }],
    ["authorization_needed", { subStatus: "In Authorization" }],
    ["authorization_needed", { fleetScopeStatus: "Decision Pending" }],
    ["stalled_repair", { etaSlips: 2 }],
    ["stalled_repair", { daysInShop: 61 }],
    ["shop_record_fix", { shopPhoneBad: true }],
    ["truck_mismatch_no_po", { noQualifyingPo: true }],
    ["needs_tow", { lucaStatus: "Needs Tow" }],
    ["shop_missing_truck", { lucaStatus: "Shop Does Not Have Truck" }],
    ["shop_missing_truck", { lucaStatus: "Relocated" }],
    ["tech_unreachable", { callAttempts2d: 3 }],
    ["tags_registration_hold", { tagsHold: true }],
    ["follow_up_due", { workbookFollowUpDue: true }],
    ["shop_unreachable_callback", { latestCallUnresolved: true }],
  ];
  for (const [expected, patch] of cases) {
    const got = classify({ ...base, ...patch });
    assert.ok(got.includes(expected), `${expected} should fire for ${JSON.stringify(patch)} — got ${got}`);
  }
});

test("no signals → exactly [aged_open_case]", () => {
  assert.deepEqual(classify(base), ["aged_open_case"]);
});

test("ready is phone-confirmed only — PO/ERD inference demands confirmation, not pickup", () => {
  // Closed-PO or passed-ERD evidence alone → confirm task, never vehicle_ready.
  const poOnly = classify({ ...base, poClosedWhileInRepair: true, erdPassed: true });
  assert.ok(poOnly.includes("po_closed_confirm"), `got ${poOnly}`);
  assert.ok(!poOnly.includes("vehicle_ready_schedule"), "PO evidence alone must not rate ready");
  // A LUCA-confirmed Ready absorbs the PO evidence (no duplicate confirm task).
  const lucaToo = classify({ ...base, poClosedWhileInRepair: true, lucaReady: true });
  assert.ok(lucaToo.includes("vehicle_ready_schedule"));
  assert.ok(!lucaToo.includes("po_closed_confirm"));
  // Manual verification counts the same as a LUCA Ready.
  const verified = classify({ ...base, poClosedWhileInRepair: true, readyVerified: true });
  assert.ok(verified.includes("vehicle_ready_schedule"));
  assert.ok(!verified.includes("po_closed_confirm"));
  assert.ok(!verified.includes("research_truck_status"));
});

test("research escalation supersedes the confirm task and unreachable-callback", () => {
  const r = classify({ ...base, poClosedWhileInRepair: true, researchActive: true, latestCallUnresolved: true });
  assert.ok(r.includes("research_truck_status"), `got ${r}`);
  assert.ok(!r.includes("po_closed_confirm"), "research absorbs the confirm task");
  assert.ok(!r.includes("shop_unreachable_callback"), "research absorbs the callback chase");
  // …but a confirmed ready beats research.
  const v = classify({ ...base, researchActive: true, readyVerified: true });
  assert.ok(v.includes("vehicle_ready_schedule"));
  assert.ok(!v.includes("research_truck_status"));
});

test("declined/auction is terminal — only a healthy replacement is actionable", () => {
  // Tech already on a different, healthy truck: close out the rental. The
  // branch is terminal, so the dead truck's other signals are suppressed too.
  const assigned = classify({ ...base, declinedOrAuction: true, replacementAssigned: true, tagsHold: true, etaSlips: 5 });
  assert.deepEqual(assigned, ["replacement_assigned"]);
  // No replacement yet → nothing to action today (queue routes to no-action).
  const stranded = classify({ ...base, declinedOrAuction: true });
  assert.deepEqual(stranded, []);
  // Replacement itself in the shop → LUCA's to track, not a queue item.
  const inRepair = classify({ ...base, declinedOrAuction: true, replacementAssigned: true, assignedTruckInRepair: true });
  assert.deepEqual(inRepair, []);
  // assignedTruckInRepair without a truck-number mismatch means nothing.
  const noMismatch = classify({ ...base, declinedOrAuction: true, assignedTruckInRepair: true });
  assert.deepEqual(noMismatch, []);
  // Jennifer's decommission retrieval still fires through the dead-end.
  const decom = classify({ ...base, declinedOrAuction: true, decommission: true });
  assert.deepEqual(decom, ["retrieval_pending"]);
});

test("Scheduling without phone-confirmed evidence is a validation task, not pickup work", () => {
  // Unvalidated: fires the validation task and LOCKS schedule_tech_pickup.
  const un = classify({ ...base, fleetScopeStatus: "Scheduling", schedulingUnscheduled: true });
  assert.ok(un.includes("scheduling_unvalidated"), `got ${un}`);
  assert.ok(!un.includes("schedule_tech_pickup"), "pickup scheduling must stay locked until validated");
  const due = classify({ ...base, fleetScopeStatus: "Scheduling", schedulingDue: true });
  assert.ok(due.includes("scheduling_unvalidated") && !due.includes("schedule_tech_pickup"), `got ${due}`);
  // LUCA Ready or a manual verify validates → pickup unlocks, task clears.
  const luca = classify({ ...base, fleetScopeStatus: "Scheduling", schedulingDue: true, lucaReady: true });
  assert.ok(luca.includes("schedule_tech_pickup") && !luca.includes("scheduling_unvalidated"), `got ${luca}`);
  const ver = classify({ ...base, fleetScopeStatus: "Scheduling", schedulingUnscheduled: true, readyVerified: true });
  assert.ok(ver.includes("schedule_tech_pickup") && !ver.includes("scheduling_unvalidated"), `got ${ver}`);
  // Research escalation absorbs the validation chase (same rule as PO confirm).
  const res = classify({ ...base, fleetScopeStatus: "Scheduling", schedulingUnscheduled: true, researchActive: true });
  assert.ok(res.includes("research_truck_status") && !res.includes("scheduling_unvalidated"), `got ${res}`);
  // No double-stacked confirm task: ERD-passed on an unvalidated Scheduling row.
  const erd = classify({ ...base, fleetScopeStatus: "Scheduling", schedulingDue: true, erdPassed: true });
  assert.ok(erd.includes("scheduling_unvalidated") && !erd.includes("po_closed_confirm"), `got ${erd}`);
  // A pickup date that already passed still surfaces — validation task leads.
  const passed = classify({ ...base, fleetScopeStatus: "Scheduling", pickupDatePassed: true });
  assert.equal(passed[0], "scheduling_unvalidated");
  assert.ok(passed.includes("pickup_follow_up"));
});

test("AMS declined/auction is terminal — conflict surfaces until the record is fixed", () => {
  // AMS terminal + fleet status disagrees → the conflict is THE work; every
  // other signal (ready, scheduling, tags) is suppressed by the terminal branch.
  const conflict = classify({ ...base, amsTerminal: true, fleetScopeStatus: "Scheduling", schedulingDue: true, lucaReady: true, tagsHold: true });
  assert.deepEqual(conflict, ["ams_status_conflict"]);
  // Fleet status already agrees (Declined Repair / Approved for sale) → no
  // conflict to report; the existing dead-end/replacement logic rules.
  const agree = classify({ ...base, amsTerminal: true, declinedOrAuction: true });
  assert.deepEqual(agree, []);
  // Replacement path rides along with the conflict (still actionable work).
  const repl = classify({ ...base, amsTerminal: true, replacementAssigned: true });
  assert.deepEqual(repl, ["ams_status_conflict", "replacement_assigned"]);
  // Decommission retrieval (P1) sorts ahead of the conflict (P2).
  const decom = classify({ ...base, amsTerminal: true, decommission: true });
  assert.deepEqual(decom, ["retrieval_pending", "ams_status_conflict"]);
});

test("results are deduped and sorted highest priority first", () => {
  const got = classify({ ...base, tagsHold: true, escalated: true, workbookFollowUpDue: true });
  assert.equal(got[0], "luca_escalated"); // P2 before P3/P4
  assert.deepEqual([...new Set(got)], got, "no duplicates");
  const prios = got.map((k) => CLASSIFICATION_BY_KEY.get(k)!.priority);
  assert.deepEqual([...prios].sort((a, b) => a - b), prios, "priority ascending");
  // near-boundary: stalled thresholds just below never fire
  const quiet = classify({ ...base, etaSlips: 1, daysInShop: 60, callAttempts2d: 2 });
  assert.deepEqual(quiet, ["aged_open_case"]);
});

const regional = (owner: string): RoutingResult =>
  ({ owner, region: "east", basis: "tech_state", needsRouting: false }) as RoutingResult;
const manual = (owner: string): RoutingResult =>
  ({ owner, region: null, basis: "manual", needsRouting: false }) as RoutingResult;

test("ownerForClassification: manual beats every rule", () => {
  for (const key of ["tags_registration_hold", "authorization_needed", "retrieval_pending", "aged_open_case"]) {
    const def = CLASSIFICATION_BY_KEY.get(key)!;
    const o = ownerForClassification(def, manual("Custom Person"), "8206");
    assert.deepEqual(o, { owner: "Custom Person", needsRouting: false }, key);
  }
});

test("ownerForClassification: rule owners", () => {
  const tags = CLASSIFICATION_BY_KEY.get("tags_registration_hold")!;
  assert.deepEqual(ownerForClassification(tags, regional("Olga Fernandez"), "8206"),
    { owner: "Cheryl & Monica", needsRouting: false });
  assert.deepEqual(ownerForClassification(tags, regional("Olga Fernandez"), "9999"),
    { owner: "Rob Anderson", needsRouting: true });
  assert.deepEqual(ownerForClassification(tags, regional("Olga Fernandez"), null),
    { owner: "Rob Anderson", needsRouting: true });
  assert.deepEqual(ownerForClassification(CLASSIFICATION_BY_KEY.get("retrieval_pending")!, regional("Olga Fernandez"), null),
    { owner: "Jennifer Dyer", needsRouting: false });
  assert.deepEqual(ownerForClassification(CLASSIFICATION_BY_KEY.get("stalled_repair")!, regional("Olga Fernandez"), null),
    { owner: "Rob Anderson", needsRouting: false });
  assert.deepEqual(ownerForClassification(CLASSIFICATION_BY_KEY.get("aged_open_case")!, regional("Olga Fernandez"), null),
    { owner: "Olga Fernandez", needsRouting: false });
});

test("business-day math", () => {
  // 2026-08-07 is a Friday: +2 business days skips the weekend → Tue 08-11
  assert.equal(addBusinessDays("2026-08-07", 2), "2026-08-11");
  assert.equal(addBusinessDays("2026-08-03", 1), "2026-08-04"); // Mon → Tue
  assert.equal(addBusinessDays("2026-08-08", 1), "2026-08-10"); // Sat → Mon
  // due Fri 08-07, today Mon 08-10 → 1 business day late (weekend skipped)
  assert.equal(businessDaysLate("2026-08-07", "2026-08-10"), 1);
  assert.equal(businessDaysLate("2026-08-07", "2026-08-07"), 0);
  assert.equal(businessDaysLate("2026-08-07", "2026-08-05"), 0); // not yet due
  assert.equal(businessDaysLate("2026-08-07", "2026-08-12"), 3);
  assert.match(todayET(), /^\d{4}-\d{2}-\d{2}$/);
});

test("shopStateFromAddress", () => {
  assert.equal(shopStateFromAddress("Pep Boys, 123 Main St, Dallas, TX 75201"), "TX");
  assert.equal(shopStateFromAddress("500 Elm Ave, Newark, nj 07102-1234"), "NJ");
  assert.equal(shopStateFromAddress("no state here"), null);
  assert.equal(shopStateFromAddress(""), null);
  assert.equal(shopStateFromAddress(null), null);
  assert.equal(shopStateFromAddress("TX 75201 not at end,"), null);
});
