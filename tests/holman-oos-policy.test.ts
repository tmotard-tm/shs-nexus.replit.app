/**
 * Task #660 — unit tests for the Holman out-of-service policy core.
 *
 * Pure module only (no DB, no Holman client): target-list integrity, the
 * 88229 exclusion guard, fail-closed candidate evaluation, driver-assignment
 * detection, minimal-payload discipline, and report classification.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BYOV_OOS_TARGET_TRUCKS,
  BYOV_OOS_EXCLUDED_TRUCKS,
  isExcludedFromOutOfService,
  isByovEligibleForOutOfService,
  evaluateOutOfServiceCandidate,
  describeLiveDriver,
  buildOutOfServicePayload,
  todayHolmanDateEastern,
  classifyOosReportState,
  liveStatusCodeOf,
  isOutOfServiceRecord,
  oosVerificationExpired,
  OOS_VERIFICATION_WINDOW_MS,
  type OosCandidateInput,
} from "../server/holman-oos-policy.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

const VIN = "1GCHSBEA0F1234567";

/** A live Holman record in the expected pre-OOS state: active + unassigned. */
function unassignedActiveVehicle(overrides: Record<string, unknown> = {}) {
  return {
    holmanVehicleNumber: "088269",
    vin: VIN,
    statusCode: 1,
    assignedStatusCode: "U",
    clientData2: "^null^",
    firstName: "UNKNOWN",
    lastName: "UNKNOWN",
    ...overrides,
  };
}

function candidate(overrides: Partial<OosCandidateInput> = {}): OosCandidateInput {
  return {
    vehicleNumber: "88269",
    lookup: { checked: true, found: true, vehicle: unassignedActiveVehicle() },
    cachedVin: VIN,
    hasActiveFence: false,
    pendingActions: [],
    ...overrides,
  };
}

// ── Target list integrity ───────────────────────────────────────────────────

test("target list is exactly the 10 user-supplied trucks", () => {
  assert.equal(BYOV_OOS_TARGET_TRUCKS.length, 10);
  assert.deepEqual(
    [...BYOV_OOS_TARGET_TRUCKS].sort(),
    ["88086", "88097", "88195", "88200", "88216", "88217", "88239", "88247", "88269", "88273"].sort(),
  );
  // No duplicates in canonical form.
  const canon = BYOV_OOS_TARGET_TRUCKS.map((t) => t.replace(/^0+/, ""));
  assert.equal(new Set(canon).size, 10);
});

test("88229 is excluded in every number format and is not in the target list", () => {
  assert.deepEqual([...BYOV_OOS_EXCLUDED_TRUCKS], ["88229"]);
  for (const form of ["88229", "088229", "0088229", " 88229 "]) {
    assert.equal(isExcludedFromOutOfService(form), true, `form "${form}" must be excluded`);
  }
  for (const t of BYOV_OOS_TARGET_TRUCKS) {
    assert.equal(isExcludedFromOutOfService(t), false, `target ${t} must not be excluded`);
  }
  // Near-miss numbers are NOT excluded.
  assert.equal(isExcludedFromOutOfService("88228"), false);
  assert.equal(isExcludedFromOutOfService("882290"), false);
});

// ── Candidate evaluation (fail-closed ordering) ─────────────────────────────

test("happy path: active + unassigned + VIN match → eligible", () => {
  const ev = evaluateOutOfServiceCandidate(candidate());
  assert.equal(ev.decision, "eligible");
  assert.equal(ev.needsManualReview, false);
  assert.equal(ev.liveStatusCode, 1);
});

test("active write-fence blocks before anything else", () => {
  const ev = evaluateOutOfServiceCandidate(candidate({ hasActiveFence: true }));
  assert.equal(ev.decision, "fence_active");
  assert.equal(ev.needsManualReview, true);
});

test("in-flight submission defers the write", () => {
  const ev = evaluateOutOfServiceCandidate(candidate({ pendingActions: ["assign"] }));
  assert.equal(ev.decision, "pending_submission");
  assert.match(ev.reason, /assign/);
});

test("failed live lookup fails CLOSED (never eligible)", () => {
  const ev = evaluateOutOfServiceCandidate(
    candidate({ lookup: { checked: false, found: false, error: "timeout" } }),
  );
  assert.equal(ev.decision, "lookup_failed");
  assert.equal(ev.needsManualReview, true);
});

test("truck missing from Holman (status 0/1/2) → not_found, manual review", () => {
  const ev = evaluateOutOfServiceCandidate(candidate({ lookup: { checked: true, found: false } }));
  assert.equal(ev.decision, "not_found");
  assert.equal(ev.needsManualReview, true);
});

test("identity before state: missing cache VIN fails closed", () => {
  const ev = evaluateOutOfServiceCandidate(candidate({ cachedVin: null }));
  assert.equal(ev.decision, "vin_unverified");
  assert.equal(ev.needsManualReview, true);
});

test("identity before state: VIN mismatch refuses the write even when otherwise eligible", () => {
  const ev = evaluateOutOfServiceCandidate(candidate({ cachedVin: "DIFFERENTVIN000001" }));
  assert.equal(ev.decision, "vin_mismatch");
  assert.equal(ev.needsManualReview, true);
});

test("VIN comparison is case/whitespace insensitive", () => {
  const ev = evaluateOutOfServiceCandidate(candidate({ cachedVin: `  ${VIN.toLowerCase()} ` }));
  assert.equal(ev.decision, "eligible");
});

test("already out of service (statusCode=2) → already_oos, no manual review", () => {
  const ev = evaluateOutOfServiceCandidate(
    candidate({
      lookup: {
        checked: true,
        found: true,
        vehicle: unassignedActiveVehicle({ statusCode: 2, outOfServiceDate: "2026-08-01T00:00:00" }),
      },
    }),
  );
  assert.equal(ev.decision, "already_oos");
  assert.equal(ev.needsManualReview, false);
});

test("assigned driver → skip-and-flag, never eligible", () => {
  const assignedVariants = [
    { clientData2: "jsmith0" }, // real enterprise id
    { firstName: "JOHN", lastName: "SMITH", clientData2: "^null^" }, // real name
    { assignedStatusCode: "D" }, // assigned status code
    { assignedStatusCode: "" , clientData2: "jsmith0" }, // id without status
  ];
  for (const overrides of assignedVariants) {
    const ev = evaluateOutOfServiceCandidate(
      candidate({ lookup: { checked: true, found: true, vehicle: unassignedActiveVehicle(overrides) } }),
    );
    assert.equal(ev.decision, "assigned_driver", `variant ${JSON.stringify(overrides)} must skip`);
    assert.equal(ev.needsManualReview, true);
  }
});

test("already_oos takes precedence over driver state, but NOT over identity", () => {
  // OOS + assigned driver → already_oos (no write happens either way).
  const oosAssigned = evaluateOutOfServiceCandidate(
    candidate({
      lookup: { checked: true, found: true, vehicle: unassignedActiveVehicle({ statusCode: 2, clientData2: "jsmith0" }) },
    }),
  );
  assert.equal(oosAssigned.decision, "already_oos");
  // OOS but VIN mismatch → vin_mismatch (identity first — wrong record).
  const oosWrongVin = evaluateOutOfServiceCandidate(
    candidate({
      cachedVin: "DIFFERENTVIN000001",
      lookup: { checked: true, found: true, vehicle: unassignedActiveVehicle({ statusCode: 2 }) },
    }),
  );
  assert.equal(oosWrongVin.decision, "vin_mismatch");
});

// ── Driver detection ────────────────────────────────────────────────────────

test("describeLiveDriver treats unassign sentinels as unassigned", () => {
  assert.equal(describeLiveDriver(unassignedActiveVehicle()).assigned, false);
  // Spelled-out status some surfaces return.
  assert.equal(
    describeLiveDriver(unassignedActiveVehicle({ assignedStatusCode: "Unassigned" })).assigned,
    false,
  );
  // Empty everything.
  assert.equal(
    describeLiveDriver({ assignedStatusCode: "", clientData2: "", firstName: "", lastName: "" }).assigned,
    false,
  );
});

test("describeLiveDriver fails toward 'assigned' on anything not clearly unassigned", () => {
  assert.equal(describeLiveDriver(unassignedActiveVehicle({ clientData2: "tech123" })).assigned, true);
  assert.equal(describeLiveDriver(unassignedActiveVehicle({ lastName: "SMITH" })).assigned, true);
  assert.equal(describeLiveDriver(unassignedActiveVehicle({ assignedStatusCode: "D" })).assigned, true);
  assert.equal(describeLiveDriver(unassignedActiveVehicle({ assignedStatusCode: "X" })).assigned, true);
});

// ── Payload discipline ──────────────────────────────────────────────────────

test("payload is minimal: lesseeCode + exact number + OOS date only — statusCode is read-only and must be absent", () => {
  const payload = buildOutOfServicePayload("088269", "08/17/2026");
  assert.deepEqual(payload, {
    lesseeCode: "2B56",
    holmanVehicleNumber: "088269",
    assetAction: "UPDATE",
    outOfServiceDate: "08/17/2026",
  });
  // statusCode is derived/read-only on the write side — InboundVehicle rejects it with
  // HTTP 400 "REQUEST_OBJECT_VALIDATION_FAILURE". Must never appear in the submit payload.
  assert.ok(!("statusCode" in payload), "statusCode must NOT be in the submit payload");
  // assetAction is required to be 'ADD' or 'UPDATE'. Omitting it validates fine but
  // leaves the queued record with no action to perform, so it must be stated — and it
  // must never be 'ADD', which would ask Holman to create a vehicle.
  assert.equal(payload.assetAction, "UPDATE", "assetAction must be UPDATE, never ADD");
  // Other poison fields must also be absent.
  assert.ok(!("assignedStatusCode" in payload));
  assert.ok(!("targetPrefix" in payload));
  assert.ok(!("prefix" in payload));
  assert.ok(!("clientData2" in payload));
  assert.ok(!("firstName" in payload));
  // Number is passed through verbatim — never re-padded locally.
  assert.equal(buildOutOfServicePayload("88269", "08/17/2026").holmanVehicleNumber, "88269");
});

test("todayHolmanDateEastern formats MM/DD/YYYY in Eastern time", () => {
  // 2026-08-18T02:30:00Z is still Aug 17 in New York (22:30 EDT).
  const d = new Date("2026-08-18T02:30:00Z");
  assert.equal(todayHolmanDateEastern(d), "08/17/2026");
  // Plain midday case.
  assert.equal(todayHolmanDateEastern(new Date("2026-08-17T16:00:00Z")), "08/17/2026");
});

test("liveStatusCodeOf reads both field spellings and rejects junk", () => {
  assert.equal(liveStatusCodeOf({ statusCode: 2 }), 2);
  assert.equal(liveStatusCodeOf({ status_code: "1" }), 1);
  assert.equal(liveStatusCodeOf({ statusCode: "" }), null);
  assert.equal(liveStatusCodeOf({}), null);
  assert.equal(liveStatusCodeOf({ statusCode: "abc" }), null);
});

// ── Report classification ───────────────────────────────────────────────────

test("report: live statusCode=2 → verified (with submission) / already_oos (without)", () => {
  const base = { liveChecked: true, liveFound: true, liveStatusCode: 2, liveAssigned: false };
  assert.equal(classifyOosReportState({ ...base, submissionStatus: "pending" }).state, "verified");
  assert.equal(classifyOosReportState({ ...base, submissionStatus: "completed" }).state, "verified");
  assert.equal(classifyOosReportState({ ...base, submissionStatus: null }).state, "already_oos");
});

test("report: still-active truck classifies by submission status", () => {
  const base = { liveChecked: true, liveFound: true, liveStatusCode: 1, liveAssigned: false };
  assert.equal(classifyOosReportState({ ...base, submissionStatus: "pending" }).state, "pending");
  assert.equal(classifyOosReportState({ ...base, submissionStatus: "processing" }).state, "pending");
  assert.equal(classifyOosReportState({ ...base, submissionStatus: "failed" }).state, "failed");
  // A "completed" submission contradicted by live data is a failure, not a pass.
  assert.equal(classifyOosReportState({ ...base, submissionStatus: "completed" }).state, "failed");
  assert.equal(classifyOosReportState({ ...base, submissionStatus: null }).state, "not_attempted");
});

// ── Out-of-service detection ────────────────────────────────────────────────
//
// Regression guard. Holman NULLS `statusCode` once a vehicle actually leaves the
// active-status projection, so a verification built on `statusCode === 2` reads
// a genuinely out-of-service truck as "still in service" and never settles. The
// durable signal is `outOfServiceDate`.

test("OOS detection: statusCode 2 is out of service", () => {
  assert.equal(isOutOfServiceRecord({ statusCode: 2 }), true);
  assert.equal(isOutOfServiceRecord({ status_code: "2" }), true);
});

test("OOS detection: applied change with NULL statusCode is still out of service", () => {
  // Exactly the shape Holman returns after the batch applies the change.
  assert.equal(
    isOutOfServiceRecord({ statusCode: null, outOfServiceDate: "2026-08-17T00:00:00Z" }, "2026-08-18"),
    true,
  );
  // Effective today counts.
  assert.equal(
    isOutOfServiceRecord({ statusCode: null, outOfServiceDate: "2026-08-18T00:00:00Z" }, "2026-08-18"),
    true,
  );
});

test("OOS detection: a FUTURE out-of-service date is not yet out of service", () => {
  assert.equal(
    isOutOfServiceRecord({ statusCode: 1, outOfServiceDate: "2026-09-01T00:00:00Z" }, "2026-08-18"),
    false,
  );
});

test("OOS detection: active or dateless records are not out of service", () => {
  assert.equal(isOutOfServiceRecord({ statusCode: 1 }, "2026-08-18"), false);
  assert.equal(isOutOfServiceRecord({ statusCode: null }, "2026-08-18"), false);
  assert.equal(isOutOfServiceRecord({ statusCode: 1, outOfServiceDate: "" }, "2026-08-18"), false);
  assert.equal(isOutOfServiceRecord({ statusCode: 1, outOfServiceDate: "ZZZ" }, "2026-08-18"), false);
  assert.equal(isOutOfServiceRecord(null, "2026-08-18"), false);
});

test("report: liveOutOfService verifies even when statusCode came back null", () => {
  const base = { liveChecked: true, liveFound: true, liveStatusCode: null, liveAssigned: false };
  assert.equal(
    classifyOosReportState({ ...base, liveOutOfService: true, submissionStatus: "pending" }).state,
    "verified",
  );
  assert.equal(
    classifyOosReportState({ ...base, liveOutOfService: true, submissionStatus: null }).state,
    "already_oos",
  );
  // Without the durable signal a null statusCode must NOT read as verified.
  assert.equal(
    classifyOosReportState({ ...base, liveOutOfService: false, submissionStatus: "pending" }).state,
    "pending",
  );
});

// ── Verification window ─────────────────────────────────────────────────────
//
// Regression guard. Holman applied an observed lifecycle submit ~41 hours after
// it was sent. If the verification window is shorter than that, the sweep marks
// a valid in-flight write "failed" — and a failed row is no longer polled, so
// the late success is never recorded and the cache is never healed.

const HOUR_MS = 60 * 60 * 1000;
const OBSERVED_HOLMAN_DELAY_MS = 41 * HOUR_MS;

test("expiry: a submission survives the observed ~41h Holman batch delay", () => {
  assert.equal(
    oosVerificationExpired(OBSERVED_HOLMAN_DELAY_MS),
    false,
    "a write Holman is still legitimately processing must stay pending",
  );
  // The window it replaced would have failed that same valid write.
  assert.equal(
    oosVerificationExpired(OBSERVED_HOLMAN_DELAY_MS, 30 * HOUR_MS),
    true,
    "guard: a 30h window expires before Holman's observed 41h apply time",
  );
});

test("expiry: window clears the observed worst case, and still gives up eventually", () => {
  assert.ok(
    OOS_VERIFICATION_WINDOW_MS > OBSERVED_HOLMAN_DELAY_MS,
    "default window must exceed the observed worst-case delay",
  );
  assert.equal(oosVerificationExpired(71 * HOUR_MS), false);
  assert.equal(oosVerificationExpired(73 * HOUR_MS), true, "must not poll forever");
});

test("expiry: a late live confirm still settles the pending submission as verified", () => {
  // At 41h the row is still pending rather than failed...
  assert.equal(oosVerificationExpired(OBSERVED_HOLMAN_DELAY_MS), false);

  // ...so when Holman finally applies it — statusCode NULL, outOfServiceDate set —
  // that late read settles the submission instead of being lost to an early failure.
  const lateApplied = { statusCode: null, outOfServiceDate: "2026-08-17T00:00:00Z" };
  assert.equal(
    classifyOosReportState({
      liveChecked: true,
      liveFound: true,
      liveStatusCode: null,
      liveOutOfService: isOutOfServiceRecord(lateApplied, "2026-08-18"),
      liveAssigned: false,
      submissionStatus: "pending",
    }).state,
    "verified",
  );
});

// ── BYOV eligibility gate: canonical, never raw ─────────────────────────────
//
// Regression. The operator-facing route first gated on a RAW '88' prefix while
// the fleet UI decided BYOV on the CANONICAL number. Holman returns "88269" and
// the local cache/TPMS store "088269", so the padded spelling rendered a live
// "Mark Out of Service" button that the API then refused with a 400 — the
// capability was unusable for the fleet's own most common representation.

test("byov gate: unpadded and zero-padded spellings of a BYOV truck both pass", () => {
  for (const spelling of ["88269", "088269", "0088269", " 088269 ", "88269 "]) {
    assert.equal(
      isByovEligibleForOutOfService(spelling),
      true,
      `expected ${JSON.stringify(spelling)} to be BYOV-eligible`,
    );
  }
});

test("byov gate: every truck on the target list passes in both spellings", () => {
  for (const truck of BYOV_OOS_TARGET_TRUCKS) {
    assert.equal(isByovEligibleForOutOfService(truck), true, truck);
    assert.equal(isByovEligibleForOutOfService(`0${truck}`), true, `0${truck}`);
  }
});

test("byov gate: 5-digit BYOV numbers survive canonicalization (pad-order trap)", () => {
  // Padding to 6 digits first yields "088144" and hides the prefix entirely;
  // stripping leading zeros is the only safe direction.
  assert.equal(isByovEligibleForOutOfService("88144"), true);
  assert.equal(isByovEligibleForOutOfService("088144"), true);
});

test("byov gate: company-owned numbers are refused in every spelling", () => {
  for (const spelling of ["47008", "047008", "0047008", "12345", "0"]) {
    assert.equal(
      isByovEligibleForOutOfService(spelling),
      false,
      `expected ${JSON.stringify(spelling)} to be refused`,
    );
  }
});

test("byov gate: empty input is not eligible", () => {
  assert.equal(isByovEligibleForOutOfService(""), false);
  assert.equal(isByovEligibleForOutOfService("   "), false);
  assert.equal(isByovEligibleForOutOfService(null), false);
  assert.equal(isByovEligibleForOutOfService(undefined), false);
});

test("byov gate and the exclusion guard are independent, and both handle padding", () => {
  // The excluded truck IS BYOV by prefix; it must still be refused, in either
  // spelling. Passing the prefix gate must never imply passing the exclusion.
  assert.equal(isByovEligibleForOutOfService("88229"), true);
  assert.equal(isByovEligibleForOutOfService("088229"), true);
  assert.equal(isExcludedFromOutOfService("88229"), true);
  assert.equal(isExcludedFromOutOfService("088229"), true);
});

test("report: assigned driver with no submission → skipped_assigned; probe failure → unknown", () => {
  assert.equal(
    classifyOosReportState({ liveChecked: true, liveFound: true, liveStatusCode: 1, liveAssigned: true, submissionStatus: null }).state,
    "skipped_assigned",
  );
  assert.equal(
    classifyOosReportState({ liveChecked: false, liveFound: false, liveStatusCode: null, liveAssigned: null, submissionStatus: "pending" }).state,
    "unknown",
  );
  assert.equal(
    classifyOosReportState({ liveChecked: true, liveFound: false, liveStatusCode: null, liveAssigned: null, submissionStatus: null }).state,
    "unknown",
  );
});
