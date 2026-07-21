/**
 * Unit tests for the rightsize van-status / workload dimension.
 * Run: npx tsx server/vrm/rightsize/workload.test.ts
 *
 * The named techs below are the real 12 that sat in NON_RESPONDER on 2026-07-21,
 * with their verified AMS status from the dev feed, so a regression here is a
 * regression in the number leadership reads.
 */
import assert from "node:assert/strict";

import {
  vanStatusOf,
  deriveRightsizeWorkload,
  vanFieldsOf,
  VAN_STATUS_LABEL,
  TYLER_CANNOT_WORK_STATUSES,
  RIGHTSIZE_CANNOT_WORK_STATUSES,
  type RightsizeVanStatus,
} from "./workload";

// ------------------------------------------------------------- status mapping
assert.equal(vanStatusOf("Sent To Auction", true, true), "auction");
assert.equal(vanStatusOf("Declined Repair", true, true), "declined");
assert.equal(vanStatusOf("In Repair", true, true), "in_repair");
assert.equal(vanStatusOf("Spare", true, true), "spare");
assert.equal(vanStatusOf("Assigned to Tech", true, true), "assigned");
assert.equal(vanStatusOf("Reserved For New Hire", true, true), "reserved");
assert.equal(vanStatusOf("Tech On LOA", true, true), "loa");
assert.equal(vanStatusOf("In Use", true, true), "in_use");
assert.equal(vanStatusOf("Unknown", true, true), "unknown");
assert.equal(vanStatusOf("", true, true), "unknown", "blank status is unknown, not a bucket");
assert.equal(vanStatusOf(null, true, true), "unknown");

// case sensitivity + substring matching mirror amsBucketOf()
assert.equal(vanStatusOf("SENT TO AUCTION", true, true), "auction");
assert.equal(vanStatusOf("declined repair", true, true), "declined");
assert.equal(vanStatusOf("in-use", true, true), "in_use");

// ------------------------------------------------------ presence beats status
assert.equal(
  vanStatusOf("Assigned to Tech", false, true),
  "off_feed",
  "a case that fell off the newest feed is a resolved rental, whatever status it wore",
);
assert.equal(vanStatusOf("Sent To Auction", false, true), "off_feed");
assert.equal(vanStatusOf(null, null, false), "no_case", "no rental-ops row at all");
assert.equal(vanStatusOf("Sent To Auction", true, false), "no_case", "hasCase=false wins over a stray status");

// ------------------------------------------------------------- workload split
assert.equal(deriveRightsizeWorkload("auction"), "cannot_work");
assert.equal(deriveRightsizeWorkload("declined"), "cannot_work");
assert.equal(deriveRightsizeWorkload("spare"), "cannot_work");
assert.equal(deriveRightsizeWorkload("in_repair"), "workable", "a van in the shop still leaves the tech able to swap down");
assert.equal(deriveRightsizeWorkload("assigned"), "workable");
assert.equal(deriveRightsizeWorkload("off_feed"), "workable", "already-closed rentals stay countable, they are not blocked");
assert.equal(deriveRightsizeWorkload("no_case"), "workable");
assert.equal(deriveRightsizeWorkload("unknown"), "workable", "unknown never silently removes somebody from the chase list");

// Tyler's verbatim rule is a strict subset of what the tracker uses, and the
// only extension is `spare`. If this ever fails, the rule drifted.
for (const s of TYLER_CANNOT_WORK_STATUSES) {
  assert.ok(RIGHTSIZE_CANNOT_WORK_STATUSES.includes(s), `${s} must stay cannot_work`);
}
assert.deepEqual(
  RIGHTSIZE_CANNOT_WORK_STATUSES.filter((s) => !TYLER_CANNOT_WORK_STATUSES.includes(s)),
  ["spare"],
  "the ONLY extension beyond Tyler's verbatim declined/auction rule is spare",
);

// every status has a label — the UI never renders undefined
const ALL: RightsizeVanStatus[] = [
  "auction", "declined", "in_repair", "spare", "assigned",
  "reserved", "loa", "in_use", "off_feed", "no_case", "unknown",
];
for (const s of ALL) assert.equal(typeof VAN_STATUS_LABEL[s], "string", `${s} needs a label`);

// ------------------------------------------------------------ row decoration
{
  const f = vanFieldsOf({ own_truck: "61209", van_ams_status: "Sent To Auction", van_present_in_latest: true, van_has_case: true });
  assert.equal(f.van_status, "auction");
  assert.equal(f.workload, "cannot_work");
  assert.equal(f.own_truck, "61209");
  assert.equal(f.ams_status, "Sent To Auction");
}
{
  const f = vanFieldsOf({});
  assert.equal(f.van_status, "no_case");
  assert.equal(f.workload, "workable");
  assert.equal(f.own_truck, null);
  assert.equal(f.ams_status, null);
}

// ------------------------------------------ the real 2026-07-21 non-responders
// 12 techs sat in NON_RESPONDER. Three of them had actually replied (handled by
// the confirmed-proposal backfill, not by this module). Of the 9 that remain,
// 5 cannot work and 4 can act — which is the number Tyler said was true.
const NON_RESPONDERS: Array<[string, string | null, boolean, boolean, RightsizeVanStatus]> = [
  ["LLAY1",   "Assigned to Tech", false, true,  "off_feed"],
  ["DHALEY",  "In Repair",        true,  true,  "in_repair"],
  ["SLOPEZ9", "Assigned to Tech", true,  true,  "assigned"],
  ["MBORGES", "Sent To Auction",  true,  true,  "auction"],
  ["DMELLER", "Spare",            true,  true,  "spare"],
  ["LRUIZ1",  "Sent To Auction",  true,  true,  "auction"],
  ["HCONNE",  "In Repair",        true,  true,  "in_repair"],
  ["JMOORE0", "Declined Repair",  true,  true,  "declined"],
  ["YLEMKO",  "Spare",            true,  true,  "spare"],
];
let cannot = 0, workable = 0;
for (const [ldap, status, present, hasCase, expected] of NON_RESPONDERS) {
  const v = vanStatusOf(status, present, hasCase);
  assert.equal(v, expected, `${ldap} van status`);
  if (deriveRightsizeWorkload(v) === "cannot_work") cannot += 1;
  else workable += 1;
}
assert.equal(cannot, 5, "5 of the 9 remaining non-responders physically cannot work");
assert.equal(workable, 4, "the true No-response count is 4, not 12");

// The two techs whose replies were confirmed by hand leave NON_RESPONDER by
// STAGE, so they must never be double-counted into the cannot-work row even
// though their own vans are declined/auction.
assert.equal(vanStatusOf("Declined Repair", true, true), "declined", "ASTURNS' van");
assert.equal(vanStatusOf("Sent To Auction", true, true), "auction", "MNIZAM's van");

console.log("workload.test.ts: all assertions passed");
