/**
 * Msg1 confirmation backfill — pure planner tests.
 *
 * The backfill texts booked + block-filed cutover techs still on the Holman
 * book who never got a confirmation-shaped text. These tests pin the planner's
 * population predicate, the evidence skip (re-runnability), the withhold rules
 * (never send an unactionable text), and the past-block-date adjusted wording
 * (never "Tomorrow" for a block that already came and went).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyBackfillRow,
  planMsg1Backfill,
  dayLabelFor,
  firstNameOf,
  renderMsg1Catchup,
  matchConfirmationEvidence,
  type BackfillRow,
} from "../server/vrm/forms/msg1-confirmation-backfill";

const TODAY = "2026-08-24"; // Monday

function row(overrides: Partial<BackfillRow> = {}): BackfillRow {
  return {
    ldap: "abcde1",
    tech_name: "SMITH, JOHN A",
    reservation_status: "booked",
    etd_reference: "1358479265",
    branch_name: "Dover",
    branch_address: "635 S BAY RD,DOVER,19901-4601",
    route_block_status: "filed",
    route_block_live: true,
    route_block_date: "2026-08-25",
    holman_book_state: "open",
    ...overrides,
  };
}

const NO_EVIDENCE = new Set<string>();

// ---------------------------------------------------------------------------
// dayLabelFor
// ---------------------------------------------------------------------------

test("dayLabelFor: today / tomorrow / future / past / garbage", () => {
  assert.equal(dayLabelFor("2026-08-24", TODAY), "Today");
  assert.equal(dayLabelFor("2026-08-25", TODAY), "Tomorrow");
  assert.equal(dayLabelFor("2026-08-26", TODAY), "On Wed 8/26");
  assert.equal(dayLabelFor("2026-08-20", TODAY), null);
  assert.equal(dayLabelFor(null, TODAY), null);
  assert.equal(dayLabelFor("not-a-date", TODAY), null);
});

// ---------------------------------------------------------------------------
// firstNameOf
// ---------------------------------------------------------------------------

test("firstNameOf: comma format, plain format, empty, junk", () => {
  assert.equal(firstNameOf("SMITH, JOHN A"), "John");
  assert.equal(firstNameOf("John Smith"), "John");
  assert.equal(firstNameOf(""), "");
  assert.equal(firstNameOf(null), "");
  assert.equal(firstNameOf("12345"), "");
});

// ---------------------------------------------------------------------------
// Population predicate
// ---------------------------------------------------------------------------

test("skips rows outside the audited population", () => {
  assert.equal(
    classifyBackfillRow(row({ reservation_status: "pending" }), NO_EVIDENCE, TODAY).reason,
    "not_booked",
  );
  assert.equal(
    classifyBackfillRow(row({ route_block_status: "failed" }), NO_EVIDENCE, TODAY).reason,
    "no_live_route_block",
  );
  assert.equal(
    classifyBackfillRow(row({ route_block_live: false }), NO_EVIDENCE, TODAY).reason,
    "no_live_route_block",
  );
  assert.equal(
    classifyBackfillRow(row({ holman_book_state: "" }), NO_EVIDENCE, TODAY).reason,
    "off_book",
  );
  assert.equal(
    classifyBackfillRow(row({ holman_book_state: "unanchored" }), NO_EVIDENCE, TODAY).reason,
    "book_unanchored",
  );
});

test("all three on-book states are in population (open / rolled / pended)", () => {
  for (const state of ["open", "rolled", "pended"]) {
    const d = classifyBackfillRow(row({ holman_book_state: state }), NO_EVIDENCE, TODAY);
    assert.equal(d.action, "send", `book_state=${state}`);
  }
});

// ---------------------------------------------------------------------------
// Evidence skip = re-runnability
// ---------------------------------------------------------------------------

test("prior confirmation evidence skips the row (case-insensitive ldap)", () => {
  const d = classifyBackfillRow(row({ ldap: "abcde1" }), new Set(["ABCDE1"]), TODAY);
  assert.equal(d.action, "skip");
  assert.equal(d.reason, "already_confirmed");
});

test("sent bodies carry the etd_reference — this run's sends are next run's evidence", () => {
  const future = classifyBackfillRow(row(), NO_EVIDENCE, TODAY);
  const past = classifyBackfillRow(row({ route_block_date: "2026-08-20" }), NO_EVIDENCE, TODAY);
  for (const d of [future, past]) {
    assert.equal(d.action, "send");
    assert.ok(d.body!.includes("1358479265"), "body must carry the reservation number");
  }
});

// ---------------------------------------------------------------------------
// Withhold rules — no unactionable texts
// ---------------------------------------------------------------------------

test("withholds when the reservation number or branch facts are missing", () => {
  const noConf = classifyBackfillRow(row({ etd_reference: "  " }), NO_EVIDENCE, TODAY);
  assert.deepEqual([noConf.action, noConf.reason], ["withhold", "missing_reservation_number"]);
  const noAddr = classifyBackfillRow(row({ branch_address: "" }), NO_EVIDENCE, TODAY);
  assert.deepEqual([noAddr.action, noAddr.reason], ["withhold", "missing_branch_facts"]);
  const noName = classifyBackfillRow(row({ branch_name: null }), NO_EVIDENCE, TODAY);
  assert.deepEqual([noName.action, noName.reason], ["withhold", "missing_branch_facts"]);
});

// ---------------------------------------------------------------------------
// Wording: current-date vs past-date blocks
// ---------------------------------------------------------------------------

test("future block date renders standard Msg1 with the real day label", () => {
  const d = classifyBackfillRow(row({ route_block_date: "2026-08-26" }), NO_EVIDENCE, TODAY);
  assert.equal(d.action, "send");
  assert.equal(d.reason, "needs_confirmation");
  assert.equal(d.dayLabel, "On Wed 8/26");
  assert.ok(!d.needsRefileReview);
  assert.ok(d.body!.includes("On Wed 8/26, we have blocked the first 30 minutes"));
  assert.ok(d.body!.includes("Hi John, this is Sears Fleet"));
  assert.ok(d.body!.includes("Enterprise Dover, 635 S Bay Rd, Dover, 19901"), d.body);
  assert.ok(!d.body!.includes("Tomorrow"));
});

test("tomorrow's block date says Tomorrow", () => {
  const d = classifyBackfillRow(row({ route_block_date: "2026-08-25" }), NO_EVIDENCE, TODAY);
  assert.ok(d.body!.includes("Tomorrow, we have blocked the first 30 minutes"));
});

test("past block date gets adjusted wording + re-filing review flag, never 'Tomorrow'", () => {
  const d = classifyBackfillRow(row({ route_block_date: "2026-08-20" }), NO_EVIDENCE, TODAY);
  assert.equal(d.action, "send");
  assert.equal(d.reason, "block_date_past");
  assert.equal(d.needsRefileReview, true);
  assert.ok(!d.body!.includes("Tomorrow"));
  assert.ok(!d.body!.includes("we have blocked the first 30 minutes"));
  assert.ok(d.body!.includes("on Thu 8/20"), d.body);
  assert.ok(d.body!.includes("as soon as you are able"));
  assert.ok(d.body!.includes("Confirmation 1358479265"));
  assert.ok(d.body!.includes("Enterprise Dover, 635 S Bay Rd, Dover, 19901"));
});

test("missing block date on a filed row falls back to catch-up wording without a day claim", () => {
  const d = classifyBackfillRow(row({ route_block_date: null }), NO_EVIDENCE, TODAY);
  assert.equal(d.action, "send");
  assert.equal(d.reason, "block_date_missing");
  assert.equal(d.needsRefileReview, true);
  assert.ok(!d.body!.includes("Time was blocked on your route"));
  assert.ok(d.body!.includes("as soon as you are able"));
});

test("catch-up body keeps the core reassurances", () => {
  const body = renderMsg1Catchup({
    conf: "999",
    branchName: "Dover",
    branchAddress: "635 S Bay Rd, Dover, 19901",
    firstName: "John",
    blockDateISO: "2026-08-20",
  });
  assert.ok(body.includes("You keep the vehicle you are driving"));
  assert.ok(body.includes("billing change only"));
  assert.ok(body.includes("nothing for you to pay"));
  assert.ok(body.includes("Reply"));
});

// ---------------------------------------------------------------------------
// Evidence matcher (pure)
// ---------------------------------------------------------------------------

test("evidence: body carrying the CURRENT etd_reference counts, any recipient", () => {
  const got = matchConfirmationEvidence(
    [{ ldap: "abcde1", etd_reference: "1358479265" }],
    [{ ldap: "", phoneDigits: "", body: "Your rental is booked. Confirmation 1358479265." }],
    new Map(),
  );
  assert.deepEqual([...got], ["ABCDE1"]);
});

test("evidence: old reference after a rebook does NOT count via the reference arm", () => {
  const got = matchConfirmationEvidence(
    [{ ldap: "abcde1", etd_reference: "NEW999" }],
    [{ ldap: "ABCDE1", phoneDigits: "", body: "Confirmation OLD111." }],
    new Map(),
  );
  assert.equal(got.size, 0);
});

test("evidence: Msg1/Msg2 wording counts only when tied to THIS tech (ldap or phone)", () => {
  const msg1Body = "Tomorrow, we have blocked the first 30 minutes of your route, 8:00 AM";
  const msg2Body = "SHS Fleet reminder: today's 8:00 AM block";
  // tied by message ldap
  const byLdap = matchConfirmationEvidence(
    [{ ldap: "aaa", etd_reference: null }],
    [{ ldap: "AAA", phoneDigits: "", body: msg1Body }],
    new Map(),
  );
  assert.deepEqual([...byLdap], ["AAA"]);
  // tied by contact phone digits
  const byPhone = matchConfirmationEvidence(
    [{ ldap: "bbb", etd_reference: null }],
    [{ ldap: "", phoneDigits: "5551234567", body: msg2Body }],
    new Map([["BBB", "5551234567"]]),
  );
  assert.deepEqual([...byPhone], ["BBB"]);
  // wording sent to SOMEONE ELSE never counts
  const other = matchConfirmationEvidence(
    [{ ldap: "ccc", etd_reference: null }],
    [{ ldap: "ZZZ", phoneDigits: "1112223333", body: msg1Body }],
    new Map([["CCC", "5550001111"]]),
  );
  assert.equal(other.size, 0);
});

// ---------------------------------------------------------------------------
// plan mapping
// ---------------------------------------------------------------------------

test("planMsg1Backfill classifies every row and uppercases ldaps", () => {
  const rows = [
    row({ ldap: "aaa" }),
    row({ ldap: "bbb", holman_book_state: "" }),
    row({ ldap: "ccc", etd_reference: null }),
  ];
  const plan = planMsg1Backfill(rows, new Set(["AAA"]), TODAY);
  assert.equal(plan.length, 3);
  assert.deepEqual(
    plan.map((d) => [d.ldap, d.action, d.reason]),
    [
      ["AAA", "skip", "already_confirmed"],
      ["BBB", "skip", "off_book"],
      ["CCC", "withhold", "missing_reservation_number"],
    ],
  );
});
