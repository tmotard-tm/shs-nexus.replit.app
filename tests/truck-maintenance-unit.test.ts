/**
 * Truck Maintenance workflow — pure-unit tests (Task #664).
 *
 * Covers the arithmetic and the decisions that no integration test would
 * catch cheaply: watermark math (seed, backwards odometer, double-fire), the
 * eligibility classifier, the daily-sweep gate, and — most importantly — that
 * BOTH live gates default OFF.
 *
 * Run: npx tsx --test tests/truck-maintenance-unit.test.ts
 */
import { strict as assert } from "node:assert";
import test from "node:test";

import {
  MAINTENANCE_BLOCK_DURATION_MIN,
  MAINTENANCE_TRIGGER_MILES,
  MAINTENANCE_WINDOW_DAYS,
  buildMaintenanceConfirmationMessage,
  buildMaintenanceMessage,
  getMaintenanceActivityType,
  getMaintenanceApproachingMiles,
  getMaintenanceBookingLeadDays,
  getMaintenanceDigestRecipients,
  getMaintenanceStaleExclusionDays,
  isMaintenanceActivityTypeConfirmed,
  isMaintenanceBookingLive,
  isMaintenanceSmsLive,
} from "../server/truck-maintenance/constants";
import {
  classifyEligibility,
  isBlockingAmsStatus,
  readAmsVehicleFacts,
  type EligibilityFacts,
} from "../server/truck-maintenance/eligibility";
import {
  TEXT_CLAIM_STALE_MS,
  buildStaleBlockedDigest,
  classifyBookingResult,
  classifyMissingOdometer,
  classifyTextClaim,
  computeBlockedDays,
  computeBookingDueAt,
  computeWatermarkAdvance,
  computeWindowEnd,
  isExclusionStale,
  isPlausibleOdometer,
  isWindowStale,
  partitionMissingOdometerRows,
  resolveBookingDate,
  shouldOpenCycle,
  shouldRunDailySweep,
} from "../server/truck-maintenance/engine";
import {
  isDeveloperActor,
  isPrivilegedActor,
} from "../server/truck-maintenance/routes";

/* ---------------------------------------------------------------- gates -- */

test("both live gates default OFF with a clean environment", () => {
  const saved = {
    sms: process.env.TRUCK_MAINTENANCE_SMS_LIVE,
    booking: process.env.TRUCK_MAINTENANCE_BOOKING_LIVE,
    activity: process.env.TRUCK_MAINTENANCE_ACTIVITY_TYPE,
  };
  try {
    delete process.env.TRUCK_MAINTENANCE_SMS_LIVE;
    delete process.env.TRUCK_MAINTENANCE_BOOKING_LIVE;
    delete process.env.TRUCK_MAINTENANCE_ACTIVITY_TYPE;

    assert.equal(isMaintenanceSmsLive(), false, "SMS must be dry-run by default");
    assert.equal(isMaintenanceBookingLive(), false, "booking must be dry-run by default");
    assert.equal(isMaintenanceActivityTypeConfirmed(), false);
    assert.equal(getMaintenanceActivityType(), null);
  } finally {
    if (saved.sms === undefined) delete process.env.TRUCK_MAINTENANCE_SMS_LIVE;
    else process.env.TRUCK_MAINTENANCE_SMS_LIVE = saved.sms;
    if (saved.booking === undefined) delete process.env.TRUCK_MAINTENANCE_BOOKING_LIVE;
    else process.env.TRUCK_MAINTENANCE_BOOKING_LIVE = saved.booking;
    if (saved.activity === undefined) delete process.env.TRUCK_MAINTENANCE_ACTIVITY_TYPE;
    else process.env.TRUCK_MAINTENANCE_ACTIVITY_TYPE = saved.activity;
  }
});

test("gates are independent, and booking-live still needs a confirmed ActivityType", () => {
  const saved = {
    sms: process.env.TRUCK_MAINTENANCE_SMS_LIVE,
    booking: process.env.TRUCK_MAINTENANCE_BOOKING_LIVE,
    activity: process.env.TRUCK_MAINTENANCE_ACTIVITY_TYPE,
  };
  try {
    process.env.TRUCK_MAINTENANCE_SMS_LIVE = "true";
    delete process.env.TRUCK_MAINTENANCE_BOOKING_LIVE;
    delete process.env.TRUCK_MAINTENANCE_ACTIVITY_TYPE;
    assert.equal(isMaintenanceSmsLive(), true, "arming SMS must not require the booking gate");
    assert.equal(isMaintenanceBookingLive(), false, "arming SMS must not arm booking");

    // Booking armed but the ActivityType was never confirmed with DCA: still off.
    process.env.TRUCK_MAINTENANCE_BOOKING_LIVE = "true";
    assert.equal(
      isMaintenanceBookingLive(),
      false,
      "booking must refuse to go live until the ActivityType is configured",
    );

    process.env.TRUCK_MAINTENANCE_ACTIVITY_TYPE = "77";
    assert.equal(isMaintenanceBookingLive(), true);
    assert.equal(getMaintenanceActivityType(), "77");
  } finally {
    for (const [k, v] of [
      ["TRUCK_MAINTENANCE_SMS_LIVE", saved.sms],
      ["TRUCK_MAINTENANCE_BOOKING_LIVE", saved.booking],
      ["TRUCK_MAINTENANCE_ACTIVITY_TYPE", saved.activity],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

/* ------------------------------------------------------- watermark math -- */

test("the trigger is one constant, and it is the sub-6,000 heads-up point", () => {
  assert.equal(MAINTENANCE_TRIGGER_MILES, 5_500);
  assert.ok(MAINTENANCE_TRIGGER_MILES < 6_000, "must fire before the 6,000-mile service interval");
  assert.equal(MAINTENANCE_BLOCK_DURATION_MIN, 240, "the text promises a 4-hour slot");
});

test("shouldOpenCycle fires at exactly the trigger, not before", () => {
  assert.equal(shouldOpenCycle(105_499, 100_000), false);
  assert.equal(shouldOpenCycle(105_500, 100_000), true);
  assert.equal(shouldOpenCycle(120_000, 100_000), true);
});

test("a backwards odometer never triggers", () => {
  // Rollback / swapped VIN / bad source: the difference is negative.
  assert.equal(shouldOpenCycle(90_000, 100_000), false);
  assert.equal(shouldOpenCycle(1_200, 100_000), false);
});

test("implausible readings are ignored on both ends of the sanity window", () => {
  assert.equal(isPlausibleOdometer(999), false);
  assert.equal(isPlausibleOdometer(1_000), true);
  assert.equal(isPlausibleOdometer(600_000), true);
  assert.equal(isPlausibleOdometer(600_001), false);
  assert.equal(isPlausibleOdometer(null), false);
  assert.equal(isPlausibleOdometer(Number.NaN), false);
  // A garbage high reading must not trigger a cycle even against a low watermark.
  assert.equal(shouldOpenCycle(9_000_000, 100_000), false);
  // ...and a missing watermark (unseeded truck) never triggers either.
  assert.equal(shouldOpenCycle(150_000, null), false);
});

test("seeding at the current odometer means a fresh fleet does not fire on day one", () => {
  // seedWatermark stores the CURRENT reading; the same pass must not trigger.
  const currentOdometer = 187_432;
  const seededWatermark = currentOdometer;
  assert.equal(shouldOpenCycle(currentOdometer, seededWatermark), false);
  // ...and it fires only after another full interval.
  assert.equal(shouldOpenCycle(currentOdometer + MAINTENANCE_TRIGGER_MILES, seededWatermark), true);
});

test("the watermark advance prevents a second cycle for the same 5,500 miles", () => {
  const watermark = 100_000;
  const trigger = 105_600; // the reading that opened the cycle
  const atBooking = 105_900; // a few days later, when the block is filed

  const advanced = computeWatermarkAdvance(watermark, trigger, atBooking);
  assert.equal(advanced, 105_900);
  // The reading that opened the cycle can no longer open another one.
  assert.equal(shouldOpenCycle(trigger, advanced), false);
  assert.equal(shouldOpenCycle(atBooking, advanced), false);
  // The next cycle needs another full interval.
  assert.equal(shouldOpenCycle(advanced + MAINTENANCE_TRIGGER_MILES, advanced), true);
});

test("the watermark never moves backwards", () => {
  // A stale/implausible reading at booking time must not pull it back.
  assert.equal(computeWatermarkAdvance(100_000, 105_600, 40_000), 105_600);
  assert.equal(computeWatermarkAdvance(100_000, 105_600, null), 105_600);
  assert.equal(computeWatermarkAdvance(100_000, 105_600, 9_999_999), 105_600);
  // Even a watermark already ahead of the trigger holds.
  assert.equal(computeWatermarkAdvance(200_000, 105_600, 105_900), 200_000);
});

test("booking becomes due a few days after the text", () => {
  const texted = new Date("2026-08-17T14:00:00.000Z");
  const due = computeBookingDueAt(texted, 3);
  assert.equal(due.toISOString(), "2026-08-20T14:00:00.000Z");
  assert.ok(due.getTime() > texted.getTime(), "the booking must trail the heads-up text");
  const leadDays = getMaintenanceBookingLeadDays();
  assert.ok(leadDays >= 1 && leadDays <= 30, `default lead days out of range: ${leadDays}`);
});

/* --------------------------------------------------------- the message -- */

test("the SMS body is exactly the approved wording", () => {
  const body = buildMaintenanceMessage("MORGAT", "012345");
  assert.equal(
    body,
    "Hi MORGAT, Your truck 012345 is due for a routine maintenance service. "
    + "We will be booking a 4 hour 'Truck Maintenance' slot for you in the coming days. "
    + "We ask you bring it in to your nearest Pep Boys repair shop or equivalent shop in order "
    + "to get its maintenance service done.",
  );
});

/* ------------------------------------------ Task #676: window math ---- */

test("MAINTENANCE_WINDOW_DAYS is 8 (per spec)", () => {
  assert.equal(MAINTENANCE_WINDOW_DAYS, 8);
});

test("computeWindowEnd adds exactly MAINTENANCE_WINDOW_DAYS calendar days", () => {
  const end = computeWindowEnd("2026-08-18");
  assert.equal(end, "2026-08-26", "8 days after 2026-08-18 is 2026-08-26");
});

test("computeWindowEnd works across month boundaries", () => {
  assert.equal(computeWindowEnd("2026-08-27"), "2026-09-04");
  assert.equal(computeWindowEnd("2026-12-28"), "2027-01-05");
  // leap year
  assert.equal(computeWindowEnd("2024-02-23"), "2024-03-02");
});

test("computeWindowEnd accepts a custom days override", () => {
  assert.equal(computeWindowEnd("2026-08-18", 0), "2026-08-18");
  assert.equal(computeWindowEnd("2026-08-18", 1), "2026-08-19");
  assert.equal(computeWindowEnd("2026-08-18", 14), "2026-09-01");
});

test("isWindowStale: a future window end is not stale", () => {
  assert.equal(isWindowStale("2099-12-31"), false);
  assert.equal(isWindowStale(null), false);
  assert.equal(isWindowStale(undefined), false);
});

test("isWindowStale: a past window end is stale", () => {
  // Inject a fixed today date so the test is deterministic.
  assert.equal(isWindowStale("2020-01-01", "2026-08-18"), true);
  // today exactly = stale (end has passed)
  assert.equal(isWindowStale("2026-08-17", "2026-08-18"), true);
});

test("isWindowStale: the same day as today is NOT stale", () => {
  assert.equal(isWindowStale("2026-08-18", "2026-08-18"), false);
});

/* ---------------------------------- Task #676: confirmation message --- */

test("the confirmation SMS body is verbatim per the spec", () => {
  const body = buildMaintenanceConfirmationMessage("Monday, September 1 at 08:00 AM");
  assert.equal(
    body,
    "Your Truck Maintenance slot is scheduled for Monday, September 1 at 08:00 AM — "
    + "You are required to bring you Sears van to the nearest PepBoys or equivalent shop "
    + "for an oil change and general maintenance service. "
    + "You can also call Holman at 1-800-CAR-CARE  to be directed to the nearest Pepboys "
    + "or equivalent repair shop. ",
  );
});

test("the confirmation message interpolates the date/time verbatim", () => {
  const dt = "Tuesday, September 2 at 09:30 AM";
  const body = buildMaintenanceConfirmationMessage(dt);
  assert.ok(body.startsWith(`Your Truck Maintenance slot is scheduled for ${dt}`));
});

/* ---------------------------------- Task #676: approaching threshold -- */

test("getMaintenanceApproachingMiles defaults to 500", () => {
  const saved = process.env.TRUCK_MAINTENANCE_APPROACHING_MILES;
  try {
    delete process.env.TRUCK_MAINTENANCE_APPROACHING_MILES;
    assert.equal(getMaintenanceApproachingMiles(), 500);
  } finally {
    if (saved === undefined) delete process.env.TRUCK_MAINTENANCE_APPROACHING_MILES;
    else process.env.TRUCK_MAINTENANCE_APPROACHING_MILES = saved;
  }
});

test("getMaintenanceApproachingMiles is configurable within 50–2000", () => {
  const saved = process.env.TRUCK_MAINTENANCE_APPROACHING_MILES;
  try {
    process.env.TRUCK_MAINTENANCE_APPROACHING_MILES = "750";
    assert.equal(getMaintenanceApproachingMiles(), 750);

    // Out of range values fall back to default.
    process.env.TRUCK_MAINTENANCE_APPROACHING_MILES = "10";
    assert.equal(getMaintenanceApproachingMiles(), 500, "below 50 → default");

    process.env.TRUCK_MAINTENANCE_APPROACHING_MILES = "9999";
    assert.equal(getMaintenanceApproachingMiles(), 500, "above 2000 → default");
  } finally {
    if (saved === undefined) delete process.env.TRUCK_MAINTENANCE_APPROACHING_MILES;
    else process.env.TRUCK_MAINTENANCE_APPROACHING_MILES = saved;
  }
});

/* ------------------------------------------------------- eligibility ----- */

function eligibleFacts(overrides: Partial<EligibilityFacts> = {}): EligibilityFacts {
  return {
    truckNumber: "012345",
    vin: "1FTBW2CM4NKA00000",
    techLdap: "MORGAT",
    techName: "Tyler Morgan",
    district: "3132",
    isByov: false,
    amsStatusLabel: "Active",
    amsInRepair: false,
    techInRental: false,
    phoneDigits: "5551234567",
    contactExists: true,
    optedOut: false,
    techRacf: "MORGAT",
    employmentStatus: "A",
    ...overrides,
  };
}

test("a healthy assigned truck is eligible", () => {
  const verdict = classifyEligibility(eligibleFacts());
  assert.equal(verdict.eligible, true);
  assert.equal(verdict.code, null);
});

test("blocking AMS status labels match case-insensitively", () => {
  for (const label of ["In Repair", "in repair", "DECLINED REPAIR", "Sent To Auction", " sent to auction "]) {
    assert.equal(isBlockingAmsStatus(label), true, `${label} must block`);
    const verdict = classifyEligibility(eligibleFacts({ amsStatusLabel: label }));
    assert.equal(verdict.eligible, false);
    assert.equal(verdict.code, "ams_status_blocked");
  }
  for (const label of ["Active", "In Service", null]) {
    assert.equal(isBlockingAmsStatus(label), false, `${label} must not block`);
  }
});

test("the AMS inRepair flag blocks independently of the status label", () => {
  // Status says the truck is fine; the flag says it is in the shop. Flag wins.
  const verdict = classifyEligibility(eligibleFacts({ amsStatusLabel: "Active", amsInRepair: true }));
  assert.equal(verdict.eligible, false);
  assert.equal(verdict.code, "ams_in_repair");
});

test("unknown AMS facts fail CLOSED, never as an implied false", () => {
  for (const facts of [
    eligibleFacts({ amsInRepair: undefined }),
    eligibleFacts({ amsInRepair: null }),
    eligibleFacts({ amsStatusLabel: undefined }),
  ]) {
    const verdict = classifyEligibility(facts);
    assert.equal(verdict.eligible, false);
    assert.equal(verdict.code, "ams_unreadable");
  }
});

test("unassigned, BYOV, and rental trucks are excluded with their own reason", () => {
  assert.equal(classifyEligibility(eligibleFacts({ isByov: true })).code, "byov");
  assert.equal(classifyEligibility(eligibleFacts({ techLdap: null })).code, "no_tech_assigned");
  assert.equal(classifyEligibility(eligibleFacts({ techInRental: true })).code, "tech_in_rental");
});

test("an unreadable rental authority blocks rather than assuming 'not in a rental'", () => {
  for (const value of [undefined, null] as const) {
    const verdict = classifyEligibility(eligibleFacts({ techInRental: value }));
    assert.equal(verdict.eligible, false);
    assert.equal(verdict.code, "rental_state_unknown");
  }
});

test("unreachable technicians are excluded, not silently dropped", () => {
  assert.equal(classifyEligibility(eligibleFacts({ contactExists: false })).code, "no_contact");
  assert.equal(classifyEligibility(eligibleFacts({ phoneDigits: null })).code, "no_phone");
  assert.equal(classifyEligibility(eligibleFacts({ phoneDigits: "555123" })).code, "no_phone");
  assert.equal(classifyEligibility(eligibleFacts({ optedOut: true })).code, "opted_out");
});

test("every exclusion carries a human-readable reason", () => {
  for (const facts of [
    eligibleFacts({ isByov: true }),
    eligibleFacts({ techLdap: null }),
    eligibleFacts({ amsInRepair: true }),
    eligibleFacts({ techInRental: true }),
    eligibleFacts({ optedOut: true }),
  ]) {
    const verdict = classifyEligibility(facts);
    assert.equal(verdict.eligible, false);
    assert.ok(verdict.code, "an exclusion must name its reason code");
    assert.ok(verdict.detail && verdict.detail.length > 0, "an exclusion must carry detail text");
  }
});

/* ----------------------------------------------------- sweep scheduling -- */

test("the daily sweep runs once per ET day, inside business hours", () => {
  const today = "2026-08-17";
  assert.equal(shouldRunDailySweep({ todayET: today, lastRunDateET: null, hourET: 10 }).run, true);
  assert.equal(shouldRunDailySweep({ todayET: today, lastRunDateET: "2026-08-16", hourET: 10 }).run, true);
  // Already ran today: the every-few-minutes pinger must not re-run it.
  assert.equal(shouldRunDailySweep({ todayET: today, lastRunDateET: today, hourET: 14 }).run, false);
  // Outside the window: technicians are not texted at 3am.
  assert.equal(shouldRunDailySweep({ todayET: today, lastRunDateET: null, hourET: 3 }).run, false);
  assert.equal(shouldRunDailySweep({ todayET: today, lastRunDateET: null, hourET: 22 }).run, false);
  // force overrides both guards (operator-run).
  assert.equal(shouldRunDailySweep({ todayET: today, lastRunDateET: today, hourET: 3, force: true }).run, true);
});

test("a skipped sweep explains itself", () => {
  const decision = shouldRunDailySweep({ todayET: "2026-08-17", lastRunDateET: "2026-08-17", hourET: 12 });
  assert.equal(decision.run, false);
  assert.match(decision.reason, /already ran today/);
});

/* --------------------------------------------- orphaned send-claim state -- */

test("a send claim is only stale once it has outlived a real send", () => {
  const now = new Date("2026-08-17T15:00:00Z");
  const fresh = new Date(now.getTime() - 60_000).toISOString();
  const orphaned = new Date(now.getTime() - TEXT_CLAIM_STALE_MS - 1_000).toISOString();

  // Not claimed at all: nothing to recover.
  assert.equal(classifyTextClaim({ textStatus: null, claimedAt: null, now }), "not_pending");
  assert.equal(classifyTextClaim({ textStatus: "sent", claimedAt: orphaned, now }), "not_pending");

  // Claimed a minute ago: a send really is in flight — never race it.
  assert.equal(classifyTextClaim({ textStatus: "pending", claimedAt: fresh, now }), "in_flight");

  // Claimed longer ago than any send takes: the owner died, recover it.
  assert.equal(classifyTextClaim({ textStatus: "pending", claimedAt: orphaned, now }), "stale");

  // A pending claim with no timestamp predates the column. Treating it as
  // in-flight would strand the cycle forever, which is the bug being fixed.
  assert.equal(classifyTextClaim({ textStatus: "pending", claimedAt: null, now }), "stale");
  assert.equal(classifyTextClaim({ textStatus: "pending", claimedAt: "not-a-date", now }), "stale");
});

/* ------------------------------------------------------- route authority -- */

test("only fleet staff roles may drive the workflow", () => {
  // Session auth alone is not authorization: these routes text technicians and
  // book their day.
  for (const role of ["developer", "admin", "Developer", "ADMIN"]) {
    assert.equal(isPrivilegedActor({ role }), true, `${role} operates the workflow`);
  }
  for (const user of [{ role: "agent" }, { role: "" }, {}, null, undefined]) {
    assert.equal(isPrivilegedActor(user), false, "a non-staff session is refused");
  }
});

test("the TEST-filing hatch is narrower than the rest of the workflow", () => {
  // It POSTs a real activity upstream, so it is developers only — an admin who
  // may run the sweep still may not fire a TEST filing.
  assert.equal(isDeveloperActor({ role: "developer" }), true);
  assert.equal(isDeveloperActor({ role: "admin" }), false);
  assert.equal(isDeveloperActor({ role: "agent" }), false);
  assert.equal(isDeveloperActor(null), false);
});

/* ------------------------------------------------------ booking safety -- */

test("the filing date freezes the moment a request has gone out", () => {
  // Nothing has been sent yet, so today's answer is used and can keep moving.
  assert.deepEqual(
    resolveBookingDate({ storedDate: null, attempted: false, fresh: "2026-08-18" }),
    { date: "2026-08-18", frozen: false },
  );
  assert.deepEqual(
    resolveBookingDate({ storedDate: "2026-08-14", attempted: false, fresh: "2026-08-18" }),
    { date: "2026-08-18", frozen: false },
    "a date claimed but never sent is not binding",
  );

  // A POST went out for 2026-08-14. The project name embeds that date, so a
  // retry days later MUST reuse it — a re-dated name would look like a brand
  // new filing to the upstream duplicate guard and double-book the tech.
  assert.deepEqual(
    resolveBookingDate({ storedDate: "2026-08-14", attempted: true, fresh: "2026-08-18" }),
    { date: "2026-08-14", frozen: true },
  );
  // Timestamps arrive from pg as Date-ish strings; only the day matters.
  assert.equal(
    resolveBookingDate({ storedDate: "2026-08-14T00:00:00.000Z", attempted: true, fresh: "2026-08-18" }).date,
    "2026-08-14",
  );
});

test("only answers that prove nothing landed are retryable", () => {
  // Filed, with a handle.
  assert.equal(
    classifyBookingResult({ ok: true, projectId: "abc", httpStatus: 201 }),
    "filed_live",
  );
  // Already there — never re-fire.
  assert.equal(
    classifyBookingResult({ ok: false, skipReason: "duplicate", httpStatus: 409 }),
    "duplicate",
  );
  // Accepted upstream with no id: something exists and we cannot name it.
  assert.equal(
    classifyBookingResult({ ok: false, projectId: null, httpStatus: 200 }),
    "unknown",
    "a 2xx without an id is a review item, not a retry",
  );
  // Rejected outright — nothing was created, so a retry is safe.
  assert.equal(classifyBookingResult({ ok: false, projectId: null, httpStatus: 400 }), "failed");
  assert.equal(classifyBookingResult({ ok: false, projectId: null, httpStatus: 500 }), "failed");
  // Never left the box.
  assert.equal(
    classifyBookingResult({ ok: false, skipReason: "missing_config", httpStatus: null }),
    "failed",
  );
  // The DCA client CATCHES transport errors and hands back an ordinary result
  // with no HTTP status. A reset or timeout after the server accepted the
  // request looks exactly like this, so it must never be retried.
  assert.equal(
    classifyBookingResult({
      ok: false,
      retryable: true,
      projectId: null,
      projectName: "TruckMaint 012345 081826",
      httpStatus: null,
      errorMessage: "network error: fetch failed",
      payload: {},
    } as any),
    "unknown",
    "a transport error is an unknown outcome, whatever the client's retryable flag says",
  );
  assert.equal(
    classifyBookingResult({ ok: false, projectId: null, httpStatus: undefined } as any),
    "unknown",
    "an absent status is not a rejection",
  );
});

/* ---------------------------------------------- unreadable AMS records -- */

test("an AMS record with no truck status blocks, even when in-repair is false", async () => {
  // The exact shape that motivated this: AMS answers, the flag is a clean
  // false, and the status fields are simply absent. "Not in repair" is not the
  // same as "not declined and not sent to auction" — we cannot classify this
  // truck, so it does not get a text.
  const stubAms: any = {
    getVehicleByVin: async () => ({ VIN: "1FTBW2CM4NKA00001", VehicleInRepair: false }),
  };
  const facts = await readAmsVehicleFacts(stubAms, "1FTBW2CM4NKA00001");
  assert.equal(facts.inRepair, false, "the flag really is readable and false");
  assert.equal(facts.statusLabel, null, "no status fields resolve to a null label");
  assert.equal(facts.error, null, "the read itself did not fail — this is not the error path");

  const verdict = classifyEligibility(
    eligibleFacts({ amsStatusLabel: facts.statusLabel, amsInRepair: facts.inRepair }),
  );
  assert.equal(verdict.eligible, false, "a null status label must not pass the gate");
  assert.equal(verdict.code, "ams_unreadable");
});

test("an AMS status code with no known label blocks too", async () => {
  // The resolver hands back "Unknown" for a bare numeric code it cannot name.
  // That is a status we failed to read, not a status that is fine.
  const stubAms: any = {
    getVehicleByVin: async () => ({ TruckStatus: 9999, VehicleInRepair: false }),
  };
  const facts = await readAmsVehicleFacts(stubAms, "1FTBW2CM4NKA00002");
  assert.equal(facts.statusLabel, "Unknown");

  const verdict = classifyEligibility(
    eligibleFacts({ amsStatusLabel: facts.statusLabel, amsInRepair: facts.inRepair }),
  );
  assert.equal(verdict.eligible, false);
  assert.equal(verdict.code, "ams_unreadable");

  // An empty string is the same story arriving by a different route.
  assert.equal(classifyEligibility(eligibleFacts({ amsStatusLabel: "   " })).code, "ams_unreadable");
});

test("a readable, named status still passes", async () => {
  // The guard above must not swallow the happy path.
  const stubAms: any = {
    getVehicleByVin: async () => ({ TruckStatus: 1, TruckStatusName: "Assigned to Tech", VehicleInRepair: false }),
  };
  const facts = await readAmsVehicleFacts(stubAms, "1FTBW2CM4NKA00003");
  assert.equal(facts.inRepair, false);
  assert.ok(facts.statusLabel && facts.statusLabel !== "Unknown");
  assert.equal(
    classifyEligibility(eligibleFacts({ amsStatusLabel: facts.statusLabel, amsInRepair: facts.inRepair })).eligible,
    true,
  );
});

/* ------------------------------------------------------ filing identity -- */

test("a technician we cannot file for never gets the text", () => {
  // The text promises a block. Discovering at booking time that there is no
  // RACF id means the promise was already broken, so this blocks at the gate.
  const noRacf = classifyEligibility(eligibleFacts({ techRacf: null }));
  assert.equal(noRacf.eligible, false);
  assert.equal(noRacf.code, "no_racf");

  // Unknown blocks exactly like absent — a failed lookup is not a green light.
  const unreadable = classifyEligibility(
    eligibleFacts({ techRacf: undefined, employmentStatus: undefined, racfError: "connection reset" }),
  );
  assert.equal(unreadable.eligible, false);
  assert.equal(unreadable.code, "no_racf");
  assert.match(String(unreadable.detail), /connection reset/);

  // A fact object that simply never resolved RACF (an older caller) blocks too.
  const notResolved = classifyEligibility(eligibleFacts({ techRacf: undefined, employmentStatus: undefined }));
  assert.equal(notResolved.code, "no_racf");
});

test("employment status must be an explicit A", () => {
  for (const status of ["T", "L", "", null, undefined, "  "]) {
    const verdict = classifyEligibility(eligibleFacts({ employmentStatus: status as any }));
    assert.equal(verdict.eligible, false, `status ${JSON.stringify(status)} must block`);
    assert.equal(verdict.code, "no_racf");
  }
  assert.equal(classifyEligibility(eligibleFacts({ employmentStatus: "a" })).eligible, true, "case-insensitive");
});

/* ------------------------------------------------------- fleet roster -- */

import {
  buildRosterRows,
  decideRosterAmsAction,
} from "../server/truck-maintenance/engine";

function rosterCandidate(over: Partial<{
  truckNumber: string; displayNumber: string; vin: string | null;
  odometer: number; odometerDate: string | null; odometerSource: string | null;
}> = {}) {
  return {
    truckNumber: "012345",
    displayNumber: "12345",
    vin: "1FTNE24W64HA00001",
    odometer: 50_000,
    odometerDate: "2026-08-01",
    odometerSource: "telematics",
    ...over,
  };
}

test("roster: BYOV excluded on the RAW number, even 5-digit", () => {
  const ams = { statusByVin: { X: "Assigned to Tech" }, inRepairByVin: {} };
  const r = buildRosterRows(
    [
      rosterCandidate({ truckNumber: "088144", displayNumber: "88144", vin: "X" }),
      rosterCandidate({ truckNumber: "881440", displayNumber: "881440", vin: "X" }),
    ],
    new Map(),
    ams,
  );
  assert.equal(r.trucks.length, 0);
  assert.equal(r.excluded.byov, 2);
});

test("roster: all three blocking AMS status labels excluded", () => {
  for (const label of ["In Repair", "Declined Repair", "Sent To Auction"]) {
    const r = buildRosterRows(
      [rosterCandidate({ vin: "V1" })],
      new Map(),
      { statusByVin: { V1: label }, inRepairByVin: {} },
    );
    assert.equal(r.trucks.length, 0, `${label} must exclude`);
    assert.equal(r.excluded.amsBlocked, 1, `${label} counted as blocked`);
  }
});

test("roster: VehicleInRepair flag true excludes even with a benign label", () => {
  const r = buildRosterRows(
    [rosterCandidate({ vin: "V1" })],
    new Map(),
    { statusByVin: { V1: "Assigned to Tech" }, inRepairByVin: { V1: true } },
  );
  assert.equal(r.trucks.length, 0);
  assert.equal(r.excluded.amsBlocked, 1);
});

test("roster: unknown flag with a benign label is included (flag absent = unknown, label is bulk authority)", () => {
  const r = buildRosterRows(
    [rosterCandidate({ vin: "V1" })],
    new Map(),
    { statusByVin: { V1: "Assigned to Tech" }, inRepairByVin: {} },
  );
  assert.equal(r.trucks.length, 1);
});

test("roster: missing/unreadable AMS facts FAIL CLOSED and are counted", () => {
  const ams = { statusByVin: { KNOWN: "Assigned to Tech", NULLSTATUS: null as string | null, UNK: "Unknown" }, inRepairByVin: {} };
  const r = buildRosterRows(
    [
      rosterCandidate({ vin: null }),                 // no VIN at all
      rosterCandidate({ vin: "MISSING" }),            // VIN absent from map
      rosterCandidate({ vin: "NULLSTATUS" }),         // VIN present, status null
      rosterCandidate({ vin: "UNK" }),                // unresolvable label
      rosterCandidate({ vin: "known" }),              // case-normalized, readable
    ],
    new Map(),
    ams,
  );
  assert.equal(r.trucks.length, 1);
  assert.equal(r.excluded.amsUnknown, 4);
});

test("roster: unassigned trucks are kept with null tech fields; assigned get TPMS fields", () => {
  const assignments = new Map([
    ["012345", { ldap: "jdoe", name: "J. Doe", district: "8320" }],
  ]);
  const r = buildRosterRows(
    [rosterCandidate(), rosterCandidate({ truckNumber: "099999", displayNumber: "99999", vin: "V2" })],
    assignments,
    { statusByVin: { "1FTNE24W64HA00001": "Assigned to Tech", V2: "Spare" }, inRepairByVin: {} },
  );
  assert.equal(r.trucks.length, 2);
  const assigned = r.trucks.find((t) => t.truckNumber === "12345")!;
  assert.equal(assigned.ldap, "jdoe");
  assert.equal(assigned.district, "8320");
  const spare = r.trucks.find((t) => t.truckNumber === "99999")!;
  assert.equal(spare.ldap, null);
  assert.equal(spare.techName, null);
});

test("roster AMS action: ready cache serves regardless of other state", () => {
  assert.equal(decideRosterAmsAction({ cacheReady: true, buildInFlight: true, lastFailureAt: 0, now: 1, failureCooldownMs: 999 }), "serve");
});

test("roster AMS action: build in flight → warming", () => {
  assert.equal(decideRosterAmsAction({ cacheReady: false, buildInFlight: true, lastFailureAt: null, now: 0, failureCooldownMs: 999 }), "warming");
});

test("roster AMS action: recent failure with no build running is a REAL error, not eternal warming", () => {
  assert.equal(decideRosterAmsAction({ cacheReady: false, buildInFlight: false, lastFailureAt: 1_000, now: 60_000, failureCooldownMs: 120_000 }), "failed");
});

test("roster AMS action: failure past cooldown → start a fresh warm", () => {
  assert.equal(decideRosterAmsAction({ cacheReady: false, buildInFlight: false, lastFailureAt: 1_000, now: 200_000, failureCooldownMs: 120_000 }), "start_warm");
});

test("roster AMS action: cold and idle → start warm", () => {
  assert.equal(decideRosterAmsAction({ cacheReady: false, buildInFlight: false, lastFailureAt: null, now: 0, failureCooldownMs: 120_000 }), "start_warm");
});

/* ------------------------------------------- missing-odometer (Task #675) -- */

test("classifyMissingOdometer is the exact complement of isPlausibleOdometer", () => {
  for (const v of [null, undefined, "", "abc", Number.NaN, 0, 999, 1_000, 250_000, 600_000, 600_001, "999", "600001", "250000"]) {
    const missing = classifyMissingOdometer(v as any);
    const n = typeof v === "string" ? Number.parseInt(v, 10) : (v as number | null | undefined);
    assert.equal(
      missing === null,
      isPlausibleOdometer(n),
      `classify(${String(v)}) and isPlausibleOdometer must agree`,
    );
  }
});

test("classifyMissingOdometer names the cause", () => {
  assert.equal(classifyMissingOdometer(null), "no_reading");
  assert.equal(classifyMissingOdometer(undefined), "no_reading");
  assert.equal(classifyMissingOdometer("garbage"), "no_reading");
  assert.equal(classifyMissingOdometer(999), "below_minimum");
  assert.equal(classifyMissingOdometer(0), "below_minimum");
  assert.equal(classifyMissingOdometer(600_001), "above_maximum");
  assert.equal(classifyMissingOdometer(1_000), null);
  assert.equal(classifyMissingOdometer(600_000), null);
  assert.equal(classifyMissingOdometer("42000"), null);
});

test("a missing reading can NEVER open a cycle, whatever the watermark", () => {
  for (const v of [null, undefined, 0, 999, 600_001]) {
    assert.notEqual(classifyMissingOdometer(v), null, `${String(v)} must classify as missing`);
    assert.equal(shouldOpenCycle(v as any, 10_000), false);
    assert.equal(shouldOpenCycle(v as any, 0), false);
  }
});

test("partitionMissingOdometerRows: BYOV on the RAW number, unassigned counted not listed", () => {
  const rows = [
    { displayNumber: "88144", vin: "V1", lastReading: null, lastReadingDate: null, lastReadingSource: null, reason: "no_reading" as const },
    { displayNumber: "012345", vin: "V2", lastReading: 700_000, lastReadingDate: "2026-08-01", lastReadingSource: "holman", reason: "above_maximum" as const },
    { displayNumber: "54321", vin: "V3", lastReading: null, lastReadingDate: null, lastReadingSource: null, reason: "no_reading" as const },
    { displayNumber: "99999", vin: null, lastReading: 12, lastReadingDate: "2026-01-01", lastReadingSource: "samsara", reason: "below_minimum" as const },
  ];
  const assignments = new Map([
    ["12345", { ldap: "JDOE", name: "Jane Doe", district: "8320" }],
    ["54321", { ldap: "BSMITH", name: "Bob Smith", district: null }],
    // 88144 deliberately HAS an assignment — BYOV must still win.
    ["88144", { ldap: "CBYOV", name: "Carl Byov", district: "1111" }],
  ]);
  const { counts, trucks } = partitionMissingOdometerRows(rows, assignments);
  assert.deepEqual(counts, { assigned: 2, byov: 1, unassigned: 1, total: 4 });
  assert.deepEqual(trucks.map((t) => t.truckNumber), ["012345", "54321"]);
  const padded = trucks[0];
  assert.equal(padded.ldap, "JDOE", "padded display number must still match its canonical assignment");
  assert.equal(padded.lastReading, 700_000);
  assert.equal(padded.reason, "above_maximum");
  assert.equal(padded.lastReadingSource, "holman");
  assert.equal(trucks[1].district, null);
});

test("partitionMissingOdometerRows: a 5-digit BYOV truck is BYOV even though padding would hide it", () => {
  const { counts, trucks } = partitionMissingOdometerRows(
    [{ displayNumber: "88144", vin: null, lastReading: null, lastReadingDate: null, lastReadingSource: null, reason: "no_reading" }],
    new Map([["88144", { ldap: "X", name: null, district: null }]]),
  );
  assert.equal(counts.byov, 1);
  assert.equal(trucks.length, 0);
});

/* ------------------------------------------------- stale exclusions (#674) */

test("getMaintenanceStaleExclusionDays defaults to 14 and clamps garbage", () => {
  const saved = process.env.TRUCK_MAINTENANCE_STALE_EXCLUSION_DAYS;
  try {
    delete process.env.TRUCK_MAINTENANCE_STALE_EXCLUSION_DAYS;
    assert.equal(getMaintenanceStaleExclusionDays(), 14);
    process.env.TRUCK_MAINTENANCE_STALE_EXCLUSION_DAYS = "21";
    assert.equal(getMaintenanceStaleExclusionDays(), 21);
    // Out of range or unparsable → the default, never a surprise threshold.
    process.env.TRUCK_MAINTENANCE_STALE_EXCLUSION_DAYS = "0";
    assert.equal(getMaintenanceStaleExclusionDays(), 14);
    process.env.TRUCK_MAINTENANCE_STALE_EXCLUSION_DAYS = "9999";
    assert.equal(getMaintenanceStaleExclusionDays(), 14);
    process.env.TRUCK_MAINTENANCE_STALE_EXCLUSION_DAYS = "soon";
    assert.equal(getMaintenanceStaleExclusionDays(), 14);
  } finally {
    if (saved === undefined) delete process.env.TRUCK_MAINTENANCE_STALE_EXCLUSION_DAYS;
    else process.env.TRUCK_MAINTENANCE_STALE_EXCLUSION_DAYS = saved;
  }
});

test("digest recipients: unset means DISABLED, never a guessed default", () => {
  const saved = process.env.TRUCK_MAINTENANCE_DIGEST_EMAILS;
  try {
    delete process.env.TRUCK_MAINTENANCE_DIGEST_EMAILS;
    assert.deepEqual(getMaintenanceDigestRecipients(), []);
    process.env.TRUCK_MAINTENANCE_DIGEST_EMAILS = " a@x.com, b@y.com ,not-an-email,, ";
    assert.deepEqual(getMaintenanceDigestRecipients(), ["a@x.com", "b@y.com"]);
  } finally {
    if (saved === undefined) delete process.env.TRUCK_MAINTENANCE_DIGEST_EMAILS;
    else process.env.TRUCK_MAINTENANCE_DIGEST_EMAILS = saved;
  }
});

test("computeBlockedDays: whole days, never negative, null-safe", () => {
  const now = new Date("2026-08-21T12:00:00Z");
  assert.equal(computeBlockedDays(null, now), null);
  assert.equal(computeBlockedDays(undefined, now), null);
  assert.equal(computeBlockedDays("not a date", now), null);
  assert.equal(computeBlockedDays("2026-08-21T11:00:00Z", now), 0);
  assert.equal(computeBlockedDays("2026-08-07T12:00:00Z", now), 14);
  assert.equal(computeBlockedDays("2026-03-10T00:00:00Z", now), 164, "the March truck reads five months");
  // A clock-skewed future timestamp reads 0, not negative.
  assert.equal(computeBlockedDays("2026-08-22T12:00:00Z", now), 0);
});

test("isExclusionStale fires AT the threshold, not before", () => {
  const now = new Date("2026-08-21T12:00:00Z");
  assert.equal(isExclusionStale("2026-08-08T12:00:00Z", 14, now), false, "13 days is not stale");
  assert.equal(isExclusionStale("2026-08-07T12:00:00Z", 14, now), true, "exactly 14 days is stale");
  assert.equal(isExclusionStale(null, 14, now), false, "no clock = not stale, never a false alarm");
});

test("the digest is null when nothing is blocked — no empty emails", () => {
  assert.equal(buildStaleBlockedDigest([], 14), null);
});

test("the digest names the truck, the reason, the age, and the odometer drift", () => {
  const digest = buildStaleBlockedDigest([
    {
      id: 1,
      truck_number: "61385",
      ldap: "jdoe",
      tech_name: "Jane Doe",
      exclusion_reason: "ams_blocked",
      exclusion_detail: "Waiting Estimate From Shop",
      exclusion_since: "2026-03-10T00:00:00Z",
      blocked_days: 164,
      odometer_at_trigger: 105_500,
      current_odometer: 112_300,
      miles_past_trigger: 6_800,
    },
    {
      id: 2,
      truck_number: "88144",
      ldap: null,
      tech_name: null,
      exclusion_reason: "unassigned",
      exclusion_detail: null,
      exclusion_since: "2026-08-01T00:00:00Z",
      blocked_days: 20,
      odometer_at_trigger: 55_500,
      current_odometer: null,
      miles_past_trigger: null,
    },
  ], 14)!;
  assert.ok(digest, "two blocked cycles produce a digest");
  assert.match(digest.subject, /2 cycles blocked more than 14 days/);
  assert.match(digest.text, /Truck 61385 \(Jane Doe\): blocked 164 days/);
  assert.match(digest.text, /Waiting Estimate From Shop/);
  assert.match(digest.text, /6,800 mi past the trigger reading/, "the drift since trigger is spelled out");
  assert.match(digest.text, /Truck 88144 \(no technician\)/);
  assert.match(digest.text, /no current odometer reading/, "a missing reading is stated, not hidden");
});
