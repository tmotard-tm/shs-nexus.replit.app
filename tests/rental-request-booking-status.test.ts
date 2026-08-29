/**
 * Task #743 — the merged booking status the approval drawer and the request
 * list both render.
 *
 * The model under test replaces five simultaneous status displays with one
 * verdict, so the suite pins three things:
 *  1. precedence — booked beats everything, a parked intent beats the row's
 *     stale etd_error, an old approved row reads "stalled" not "in progress";
 *  2. translation — every known failure shape (executor aborts, orchestrator
 *     writes, auto-book stage prefixes) becomes plain language paired with
 *     the RIGHT corrective action, and unknown text falls back generically
 *     with the raw line preserved in `technical`;
 *  3. list presentation — badge labels/tones and the problems-first sort.
 *
 * Run with:
 *   npx tsx --test tests/rental-request-booking-status.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveBookingStatus,
  explainBookingFailure,
  bookingBadge,
  bookingSortKey,
  type BookingReqLike,
} from "../client/src/pages/vehicle-rental-management/lib/booking-status";

const NOW = Date.parse("2026-08-22T15:00:00Z");
const req = (over: Partial<BookingReqLike> = {}): BookingReqLike => ({
  status: "pending", ...over,
});

const assertRequestHasNoDriveAction = (actions: readonly string[], context: string) => {
  const reviewActions = new Set(["edit_class", "edit_pickup", "open_workflow"]);
  assert.ok(actions.every((action) => reviewActions.has(action)),
    `${context}: clean failures may only edit or open for review; approval stays in the decision bar`);
  assert.ok(!actions.includes("book_now"), `${context}: request UI must never offer book_now`);
  assert.ok(!actions.includes("retry_workflow"), `${context}: request UI must never offer retry_workflow`);
};

// ── Verdict derivation ───────────────────────────────────────────────────────

test("pending row with no intent shows nothing", () => {
  const s = deriveBookingStatus(req(), null, NOW);
  assert.equal(s.verdict, "none");
});

test("denied row with no booking signal shows nothing", () => {
  const s = deriveBookingStatus(req({ status: "denied" }), null, NOW);
  assert.equal(s.verdict, "none");
});

test("approved extension gets its distinct manual-Enterprise outcome", () => {
  const s = deriveBookingStatus(req({ status: "approved", request_type: "extension" }), null, NOW);
  assert.equal(s.verdict, "extension_approved");
  assert.match(s.summary, /Enterprise manually/);
});

test("pending extension shows nothing (approve settles it, nothing books)", () => {
  const s = deriveBookingStatus(req({ status: "pending", request_type: "extension" }), null, NOW);
  assert.equal(s.verdict, "none");
});

// --- Extension → Enterprise email states -----------------------------------
// Approving an extension now auto-emails Enterprise Account Support. The
// verdict follows the recorded send state; a row without one (approved before
// the email existed) keeps the legacy manual-handling copy — covered above.

test("extension email SENT: success summary with reservation, days, recipient", () => {
  const s = deriveBookingStatus(req({
    status: "approved", request_type: "extension",
    ext_reservation_number: "1565400000", ext_days: 10,
    ext_email_state: "sent", ext_email_to: "NorthCentralAccountSupport@em.com",
    ext_email_sent_at: "2026-08-22T15:00:00Z",
  }), null, NOW);
  assert.equal(s.verdict, "extension_approved");
  assert.match(s.headline, /Enterprise emailed/);
  assert.match(s.summary, /NorthCentralAccountSupport@em\.com/);
  assert.match(s.summary, /1565400000/);
  assert.match(s.summary, /10 more days/);
  assert.equal(s.reference, "1565400000");
});

test("extension email FAILED: attention verdict with the resend action", () => {
  const s = deriveBookingStatus(req({
    status: "approved", request_type: "extension",
    ext_reservation_number: "1565400000", ext_days: 7,
    ext_email_state: "failed", ext_email_error: "SendGrid 401 unauthorized",
  }), null, NOW);
  assert.equal(s.verdict, "attention");
  assert.match(s.headline, /FAILED/);
  assert.match(s.summary, /Enterprise does not know yet/);
  assert.ok(s.actions.includes("resend_extension_email"));
  // Raw error only in the technical expander, never the summary.
  assert.ok(s.technical.some((t) => t.includes("SendGrid 401 unauthorized")));
  assert.ok(!s.summary.includes("SendGrid"));
});

test("extension email DRY RUN: caution, and NO reference so the badge can't claim a send", () => {
  const s = deriveBookingStatus(req({
    status: "approved", request_type: "extension",
    ext_reservation_number: "1565400000", ext_days: 7,
    ext_email_state: "dry_run", ext_email_to: "NorthCentralAccountSupport@em.com",
  }), null, NOW);
  assert.equal(s.verdict, "extension_approved");
  assert.match(s.headline, /not sent/);
  assert.match(s.caution ?? "", /NOT been contacted/);
  assert.equal(s.reference, null);
});

test("extension badges: sent shows the reservation, legacy stays muted", () => {
  const sent = deriveBookingStatus(req({
    status: "approved", request_type: "extension",
    ext_reservation_number: "1565400000", ext_email_state: "sent",
  }), null, NOW);
  const sentBadge = bookingBadge(sent, req({ request_type: "extension" }));
  assert.equal(sentBadge?.tone, "ok");
  assert.match(sentBadge!.label, /1565400000/);

  const legacy = deriveBookingStatus(req({ status: "approved", request_type: "extension" }), null, NOW);
  const legacyBadge = bookingBadge(legacy, req({ request_type: "extension" }));
  assert.equal(legacyBadge?.tone, "muted");
  assert.equal(legacyBadge?.label, "manual (extension)");
});

test("booked row: reference in the headline, text state from msg1_state", () => {
  const s = deriveBookingStatus(
    req({ status: "booked", etd_booked_at: "2026-08-22T14:00:00Z", etd_reference: "1565398310", msg1_state: "sent" }),
    null, NOW,
  );
  assert.equal(s.verdict, "booked");
  assert.match(s.headline, /1565398310/);
  assert.equal(s.textState?.tone, "ok");
});

test("booked row with a BLOCKED text says so with a bad tone", () => {
  const s = deriveBookingStatus(
    req({ status: "booked", etd_booked_at: "2026-08-22T14:00:00Z", msg1_state: "blocked" }),
    null, NOW,
  );
  assert.equal(s.textState?.tone, "bad");
  assert.match(s.textState!.text, /NOT been told/);
});

test("booked: recorded msg1 send evidence beats the state string", () => {
  const s = deriveBookingStatus(
    req({ status: "booked", etd_booked_at: "2026-08-22T14:00:00Z", msg1_state: "pending" }),
    { reservation_evidence: { msg1: { at: "2026-08-22T14:05:00Z", phone: "3125550100" } } },
    NOW,
  );
  assert.equal(s.textState?.tone, "ok");
  assert.match(s.textState!.text, /312-555-0100/);
});

test("intent verified counts as booked even before the row is stamped", () => {
  const s = deriveBookingStatus(
    req({ status: "approved", decided_at: "2026-08-22T14:59:00Z" }),
    { status: "reservation_verified", reservation_state: "verified", reservation_evidence: { confirmation: "CONF9" } },
    NOW,
  );
  assert.equal(s.verdict, "booked");
  assert.equal(s.reference, "CONF9");
});

test("booked with a lingering intent error keeps ONE verdict plus a PLAIN caution", () => {
  const s = deriveBookingStatus(
    req({ status: "booked", etd_booked_at: "2026-08-22T14:00:00Z", intent_error: "msg release hiccup" }),
    null, NOW,
  );
  assert.equal(s.verdict, "booked");
  // The visible caution never carries the machine text — that stays in the
  // technical lines, behind the collapsed expander.
  assert.ok(s.caution && /see Technical details/i.test(s.caution));
  assert.ok(!s.caution!.includes("msg release hiccup"));
  assert.ok(s.technical.some((l) => l.includes("msg release hiccup")));
});

test("booked without any lingering error carries no caution at all", () => {
  const s = deriveBookingStatus(
    req({ status: "booked", etd_booked_at: "2026-08-22T14:00:00Z" }), null, NOW,
  );
  assert.equal(s.verdict, "booked");
  assert.equal(s.caution, null);
});

test("fresh approved row is in progress", () => {
  const s = deriveBookingStatus(
    req({ status: "approved", decided_at: new Date(NOW - 60_000).toISOString() }), null, NOW,
  );
  assert.equal(s.verdict, "in_progress");
  assert.deepEqual(s.actions, []);
});

test("approved row older than the settle window is reviewable — approve again or open, never drive directly", () => {
  const s = deriveBookingStatus(
    req({ status: "approved", decided_at: new Date(NOW - 30 * 60_000).toISOString() }), null, NOW,
  );
  assert.equal(s.verdict, "attention");
  assert.deepEqual(s.actions, ["open_workflow"]);
  assertRequestHasNoDriveAction(s.actions, "stalled approval");
});

test("parked intent (manual_review) outranks the row's etd_error", () => {
  const s = deriveBookingStatus(
    req({
      status: "approved",
      decided_at: new Date(NOW - 60_000).toISOString(),
      etd_error: "booking: failed_clean: some stale text",
    }),
    { id: 7, status: "manual_review", last_error: "booking failed clean: validation refused" },
    NOW,
  );
  assert.equal(s.verdict, "attention");
  assert.deepEqual(s.actions, ["open_workflow"], "a clean refusal is reviewable; APPROVE remains the only way to try again");
  assertRequestHasNoDriveAction(s.actions, "clean manual-review failure");
  assert.ok(s.technical.some((l) => l.includes("some stale text")), "raw row error stays in technical");
});

test("booking_unknown is fenced for reconciliation only", () => {
  const s = deriveBookingStatus(
    req({ status: "approved", decided_at: new Date(NOW - 60_000).toISOString() }),
    { status: "booking_unknown", last_error: "booking outcome timeout: socket hang up" },
    NOW,
  );
  assert.equal(s.verdict, "attention");
  assert.match(s.summary, /could not tell whether Enterprise/);
  assert.deepEqual(s.actions, ["open_workflow"]);
  assertRequestHasNoDriveAction(s.actions, "ambiguous booking outcome");
});

test("cancel_pending_readback explains the evidence wait, no blind retry offered", () => {
  const s = deriveBookingStatus(
    req({ status: "approved", decided_at: new Date(NOW - 60_000).toISOString() }),
    { status: "cancel_pending_readback" },
    NOW,
  );
  assert.equal(s.verdict, "attention");
  assert.match(s.summary, /cancellation is waiting on proof/i);
  assert.deepEqual(s.actions, ["open_workflow"]);
  assertRequestHasNoDriveAction(s.actions, "cancellation reconciliation");
});

test("row etd_error with no parked intent is a failed verdict", () => {
  const s = deriveBookingStatus(
    req({ status: "approved", decided_at: new Date(NOW - 60_000).toISOString(),
          etd_error: "booking: aborted_before_open: class CFAR no longer offered and nothing on the ladder is available here" }),
    null, NOW,
  );
  assert.equal(s.verdict, "failed");
  assert.match(s.summary, /vehicle class CFAR is no longer offered/);
  assert.deepEqual(s.actions, ["edit_class"]);
});

test("aggregate preview codes explain that the submitted branch could not be quoted", () => {
  const s = deriveBookingStatus(
    req({
      status: "approved",
      decided_at: new Date(NOW - 60_000).toISOString(),
      etd_error: "preview: quote_failed,class_unmapped,branch_zip_missing,no_date",
    }),
    null,
    NOW,
  );
  assert.equal(s.verdict, "failed");
  assert.match(s.summary, /not a valid Enterprise branch/i);
  assert.match(s.summary, /choose a valid Enterprise location/i);
  assert.ok(s.actions.includes("edit_branch"));
});

test("failed intent (preview_failed) under an approved row reads failed with a fix", () => {
  const s = deriveBookingStatus(
    req({ status: "approved", decided_at: new Date(NOW - 60_000).toISOString() }),
    { status: "preview_failed", last_error: "runner abort: fresh quote failed: ETD 503" },
    NOW,
  );
  assert.equal(s.verdict, "failed");
  assert.deepEqual(s.actions, ["open_workflow"]);
  assertRequestHasNoDriveAction(s.actions, "clean preview failure");
});

// ── Failure translation ──────────────────────────────────────────────────────

const CASES: Array<[string, RegExp, string | null]> = [
  ["booking: aborted_before_open: class CFAR no longer offered and nothing on the ladder is available here",
    /CFAR is no longer offered/, "edit_class"],
  ["auto-book: branch drift E12345->E67890", /different branch \(E12345 → E67890\)/, "open_workflow"],
  ["booking: aborted_before_open: 2026-08-18 no longer a working day", /2026-08-18.*change the pickup date/, "edit_pickup"],
  ["preview: fresh quote failed: branch closed on requested date", /branch is closed/, "edit_pickup"],
  ["booking: aborted_before_open: preview lacks pickupDate/sipp/branchCode", /quote is incomplete or stale/, "open_workflow"],
  ["preview: fresh quote failed: ETD quote chain 500", /could not be quoted just now/, "open_workflow"],
  ["booking: aborted_before_open: no ETD user for JDOE42", /no driver profile for JDOE42/, "open_workflow"],
  ["runner abort: could not create an ETD user for JDOE42: Unable to save the user",
    /could not create a driver profile for JDOE42/, "open_workflow"],
  ["booking: aborted_before_open: additional-info lookup failed: 502", /usually transient/, "open_workflow"],
  ["booking: intent #12 already holds a reservation (booked_unverified); no second booking attempted",
    /reservation already exists/, "open_workflow"],
  ["auto-book: intent #12 is at manual_review; resolve it in the workflow panel before re-approving",
    /parked and needs a person/, "open_workflow"],
  ["auto-book: intent_conflict (a live intent already exists for this LDAP)", /two live workflows would mean two cars/i, "open_workflow"],
  ["preview: eligibility gate failed (not_active_on_roster: termed)", /eligibility gate/, "open_workflow"],
  ["booking outcome timeout: socket hang up", /could not tell whether Enterprise/, "open_workflow"],
  ["booking failed clean: some vendor validation text nobody has seen before", /could not recover from/, "open_workflow"],
  ["utter gibberish 0xDEADBEEF", /could not recover from/, "open_workflow"],
];

for (const [raw, summaryRe, action] of CASES) {
  test(`translate: ${raw.slice(0, 60)}…`, () => {
    const e = explainBookingFailure(raw);
    assert.match(e.summary, summaryRe, `summary for: ${raw}`);
    if (action) assert.ok(e.actions.includes(action as any), `expected ${action} in [${e.actions}] for: ${raw}`);
    assertRequestHasNoDriveAction(e.actions, raw);
  });
}

test("empty clean failure is reviewable without a direct booking or retry action", () => {
  const e = explainBookingFailure("");
  assert.ok(e.summary.length > 0);
  assert.deepEqual(e.actions, ["open_workflow"]);
  assertRequestHasNoDriveAction(e.actions, "empty failure");
});

// ── List badge + sort ────────────────────────────────────────────────────────

test("badge: booked shows the reference and carries the branch as sub", () => {
  const r = req({
    status: "booked", etd_booked_at: "2026-08-22T14:00:00Z", etd_reference: "1565398310",
    booked_facts: { branchName: "CHICAGO SOUTH LOOP" }, msg1_state: "sent",
  });
  const b = bookingBadge(deriveBookingStatus(r, null, NOW), r)!;
  assert.match(b.label, /1565398310/);
  assert.equal(b.tone, "ok");
  assert.equal(b.sub, "CHICAGO SOUTH LOOP");
  assert.match(b.title, /CHICAGO SOUTH LOOP/);
});

test("badge: failed carries the PLAIN-language reason as the hover title", () => {
  const r = req({
    status: "approved", decided_at: new Date(NOW - 60_000).toISOString(),
    etd_error: "booking: aborted_before_open: class CFAR no longer offered and nothing on the ladder is available here",
  });
  const b = bookingBadge(deriveBookingStatus(r, null, NOW), r)!;
  assert.equal(b.label, "BOOKING FAILED");
  assert.equal(b.tone, "bad");
  assert.match(b.title, /CFAR is no longer offered/);
});

test("badge: none for rows with nothing to say", () => {
  assert.equal(bookingBadge(deriveBookingStatus(req(), null, NOW), req()), null);
});

test("sort ranks problems first, then in-flight, then booked, then blank", () => {
  const attention = deriveBookingStatus(
    req({ status: "approved", decided_at: new Date(NOW - 30 * 60_000).toISOString() }), null, NOW);
  const failed = deriveBookingStatus(
    req({ status: "approved", decided_at: new Date(NOW - 60_000).toISOString(), etd_error: "x" }), null, NOW);
  const inflight = deriveBookingStatus(
    req({ status: "approved", decided_at: new Date(NOW - 60_000).toISOString() }), null, NOW);
  const booked = deriveBookingStatus(req({ status: "booked", etd_booked_at: "2026-08-22T14:00:00Z" }), null, NOW);
  const blank = deriveBookingStatus(req(), null, NOW);
  const ranks = [attention, failed, inflight, booked, blank].map(bookingSortKey);
  assert.deepEqual([...ranks].sort((a, b) => a - b), ranks, "already in problems-first order");
  assert.equal(new Set(ranks).size, ranks.length, "each verdict has a distinct rank");
});

// ── Unverified/unknown reservations must never read as "not booked" ─────────
// The server's book door refuses reservation_state booked_unverified/unknown
// outright; the drawer must agree. Describing an existing reservation as
// absent (and offering "book now") is exactly how double bookings happen.

test("booked_unverified intent reads as an existing reservation being verified — never a re-book", () => {
  const r = req({ status: "approved", decided_at: new Date(NOW - 30 * 60_000).toISOString() });
  const s = deriveBookingStatus(r, {
    id: 9, status: "awaiting_verification", reservation_state: "booked_unverified",
  }, NOW);
  assert.equal(s.verdict, "attention");
  assert.match(s.headline, /Reservation created/);
  assert.ok(!s.actions.includes("book_now"), "must not offer book_now over a live reservation");
  assert.ok(!s.headline.includes("Approved but not booked"));
});

test("awaiting_verification status alone (state lagging) still blocks the re-book read", () => {
  const r = req({ status: "approved", decided_at: new Date(NOW - 30 * 60_000).toISOString() });
  const s = deriveBookingStatus(r, { id: 9, status: "awaiting_verification" }, NOW);
  assert.equal(s.verdict, "attention");
  assert.match(s.headline, /Reservation created/);
  assert.ok(!s.actions.includes("book_now"));
});

test("reservation_state unknown outside a parked status gets the unknown-outcome caution, not in-progress/stalled", () => {
  const r = req({ status: "approved", decided_at: new Date(NOW - 30 * 60_000).toISOString() });
  const s = deriveBookingStatus(r, {
    id: 9, status: "booking", reservation_state: "unknown",
  }, NOW);
  assert.equal(s.verdict, "attention");
  assert.match(s.summary, /could not tell whether Enterprise actually created/);
  assert.ok(!s.actions.includes("book_now"));
});
