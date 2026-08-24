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

// ---------------------------------------------------------------------------
// scheduled sweep — decision, alert content, orchestration
// ---------------------------------------------------------------------------

import {
  planSweepAction,
  buildSweepAlert,
  runMsg1BackfillSweep,
  MSG1_SWEEP_ALERT_THROTTLE_MS,
  type BackfillRunResult,
  type Msg1SweepDeps,
} from "../server/vrm/forms/msg1-confirmation-backfill";

const NOW = Date.parse("2026-08-24T15:00:00Z");

function dryResult(overrides: Partial<BackfillRunResult> = {}): BackfillRunResult {
  return {
    dryRun: true,
    todayISO: "2026-08-24",
    population: 100,
    candidates: 0,
    sent: 0,
    queued: 0,
    skippedByLane: 0,
    withheld: 0,
    skipped: {},
    needsRefileReview: [],
    results: [],
    ...overrides,
  };
}

test("planSweepAction: no gap → clean, nothing fires", () => {
  const a = planSweepAction({ candidates: 0, withheld: 0, armed: true, lastAlertAtMs: null, nowMs: NOW });
  assert.deepEqual(a, { runLive: false, alert: false, reason: "clean" });
});

test("planSweepAction: candidates while dark → alert only, never live", () => {
  const a = planSweepAction({ candidates: 3, withheld: 0, armed: false, lastAlertAtMs: null, nowMs: NOW });
  assert.deepEqual(a, { runLive: false, alert: true, reason: "alert_disarmed" });
});

test("planSweepAction: candidates while armed → live run + alert", () => {
  const a = planSweepAction({ candidates: 3, withheld: 1, armed: true, lastAlertAtMs: null, nowMs: NOW });
  assert.deepEqual(a, { runLive: true, alert: true, reason: "live_and_alert" });
});

test("planSweepAction: throttle silences the alert but NEVER the live run", () => {
  const recent = NOW - (MSG1_SWEEP_ALERT_THROTTLE_MS - 60_000);
  const armed = planSweepAction({ candidates: 3, withheld: 0, armed: true, lastAlertAtMs: recent, nowMs: NOW });
  assert.deepEqual(armed, { runLive: true, alert: false, reason: "live_alert_throttled" });
  const dark = planSweepAction({ candidates: 3, withheld: 0, armed: false, lastAlertAtMs: recent, nowMs: NOW });
  assert.deepEqual(dark, { runLive: false, alert: false, reason: "alert_throttled" });
});

test("planSweepAction: throttle window expiry re-arms the alert", () => {
  const stale = NOW - (MSG1_SWEEP_ALERT_THROTTLE_MS + 1);
  const a = planSweepAction({ candidates: 1, withheld: 0, armed: false, lastAlertAtMs: stale, nowMs: NOW });
  assert.deepEqual(a, { runLive: false, alert: true, reason: "alert_disarmed" });
});

test("planSweepAction: withheld-only gap alerts but never runs live (nothing sendable)", () => {
  const a = planSweepAction({ candidates: 0, withheld: 2, armed: true, lastAlertAtMs: null, nowMs: NOW });
  assert.deepEqual(a, { runLive: false, alert: true, reason: "alert_withheld_only" });
  const recent = NOW - 1000;
  const t = planSweepAction({ candidates: 0, withheld: 2, armed: true, lastAlertAtMs: recent, nowMs: NOW });
  assert.deepEqual(t, { runLive: false, alert: false, reason: "alert_withheld_only_throttled" });
});

test("buildSweepAlert: dark alert names the gap, says nothing was sent, lists rows", () => {
  const dry = dryResult({
    candidates: 2,
    withheld: 1,
    needsRefileReview: ["AAA"],
    results: [
      { ldap: "AAA", action: "send", reason: "block_date_past", needsRefileReview: true },
      { ldap: "BBB", action: "send", reason: "needs_confirmation" },
      { ldap: "CCC", action: "withhold", reason: "missing_branch_facts" },
    ],
  });
  const { subject, text } = buildSweepAlert({ dry, live: null, armed: false, trigger: "morning-sweep" });
  assert.match(subject, /3 booked tech\(s\) missing/);
  assert.match(text, /NOTHING was sent/);
  assert.match(text, /msg1-backfill/);
  assert.match(text, /AAA\s+send \(block_date_past\)\s+\[route block needs re-filing review\]/);
  assert.match(text, /CCC\s+withhold \(missing_branch_facts\)/);
  assert.match(text, /Route blocks past their date.*AAA/);
  // never leak SMS bodies into the email
  assert.doesNotMatch(text, /Sears Fleet\. We have a rental reservation/);
});

test("buildSweepAlert: live alert reports sent/queued/lane-refused counts", () => {
  const dry = dryResult({ candidates: 3 });
  const live = dryResult({ dryRun: false, candidates: 3, sent: 1, queued: 1, skippedByLane: 1 });
  const { subject, text } = buildSweepAlert({ dry, live, armed: true, trigger: "morning-sweep" });
  assert.match(subject, /sent 2 missed confirmation text\(s\)/);
  assert.match(text, /1 sent, 1 queued \(quiet-hours deferral\), 1 refused by the lane/);
});

/** Hermetic deps recorder for runMsg1BackfillSweep. */
function fakeDeps(f: {
  dry: BackfillRunResult;
  live?: BackfillRunResult;
  armed: boolean;
  lastAlertAtMs?: number | null;
  delivery?: { channel: "email" | "log"; ok: boolean };
}) {
  const calls: { backfill: Array<{ dryRun: boolean }>; alerts: string[]; recorded: Date[] } = {
    backfill: [],
    alerts: [],
    recorded: [],
  };
  const deps: Partial<Msg1SweepDeps> = {
    runBackfill: async (o) => {
      calls.backfill.push({ dryRun: o.dryRun });
      if (o.dryRun) return f.dry;
      if (!f.live) throw new Error("unexpected live run");
      return f.live;
    },
    isArmed: () => f.armed,
    now: () => new Date(NOW),
    getLastAlertAt: async () => f.lastAlertAtMs ?? null,
    recordAlertAt: async (at) => { calls.recorded.push(at); },
    deliverAlert: async (c) => {
      calls.alerts.push(c.subject);
      return { channel: f.delivery?.channel ?? "email", ok: f.delivery?.ok ?? true, to: "staff@x" };
    },
  };
  return { deps, calls };
}

test("sweep: clean run does one dry pass — no live, no alert, no watermark", async () => {
  const { deps, calls } = fakeDeps({ dry: dryResult(), armed: true });
  const s = await runMsg1BackfillSweep({ trigger: "test", deps });
  assert.deepEqual(calls.backfill, [{ dryRun: true }]);
  assert.equal(calls.alerts.length, 0);
  assert.equal(calls.recorded.length, 0);
  assert.equal(s.action.reason, "clean");
  assert.equal(s.live, null);
  assert.equal(s.alert, null);
});

test("sweep: gap while dark → alert delivered and watermark recorded, no live pass", async () => {
  const { deps, calls } = fakeDeps({ dry: dryResult({ candidates: 2 }), armed: false });
  const s = await runMsg1BackfillSweep({ trigger: "test", deps });
  assert.deepEqual(calls.backfill, [{ dryRun: true }]);
  assert.equal(calls.alerts.length, 1);
  assert.deepEqual(calls.recorded, [new Date(NOW)]);
  assert.equal(s.action.reason, "alert_disarmed");
  assert.equal(s.live, null);
  assert.equal(s.alert?.ok, true);
});

test("sweep: gap while armed → live pass runs and the alert carries its counts", async () => {
  const { deps, calls } = fakeDeps({
    dry: dryResult({ candidates: 2 }),
    live: dryResult({ dryRun: false, candidates: 2, sent: 2 }),
    armed: true,
  });
  const s = await runMsg1BackfillSweep({ trigger: "test", deps });
  assert.deepEqual(calls.backfill, [{ dryRun: true }, { dryRun: false }]);
  assert.equal(calls.alerts.length, 1);
  assert.match(calls.alerts[0], /sent 2 missed confirmation text\(s\)/);
  assert.deepEqual(s.live, { sent: 2, queued: 0, skippedByLane: 0 });
});

test("sweep: recent alert throttles the email but an armed gap still sends live", async () => {
  const { deps, calls } = fakeDeps({
    dry: dryResult({ candidates: 1 }),
    live: dryResult({ dryRun: false, candidates: 1, sent: 1 }),
    armed: true,
    lastAlertAtMs: NOW - 1000,
  });
  const s = await runMsg1BackfillSweep({ trigger: "test", deps });
  assert.deepEqual(calls.backfill, [{ dryRun: true }, { dryRun: false }]);
  assert.equal(calls.alerts.length, 0);
  assert.equal(s.action.reason, "live_alert_throttled");
});

test("sweep: failed email delivery does NOT stamp the watermark (retries next trigger)", async () => {
  const { deps, calls } = fakeDeps({
    dry: dryResult({ candidates: 1 }),
    armed: false,
    delivery: { channel: "email", ok: false },
  });
  const s = await runMsg1BackfillSweep({ trigger: "test", deps });
  assert.equal(calls.alerts.length, 1);
  assert.equal(calls.recorded.length, 0);
  assert.equal(s.alert?.ok, false);
});

test("sweep: log-channel alert (no recipients) never stamps the watermark", async () => {
  const { deps, calls } = fakeDeps({
    dry: dryResult({ candidates: 1 }),
    armed: false,
    delivery: { channel: "log", ok: true },
  });
  const s = await runMsg1BackfillSweep({ trigger: "test", deps });
  assert.equal(calls.alerts.length, 1);
  assert.equal(calls.recorded.length, 0);
  assert.equal(s.alert?.channel, "log");
});
