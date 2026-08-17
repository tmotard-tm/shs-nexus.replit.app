/**
 * Cutover orchestrator — PURE function suite (no DB writes, no network).
 *
 * Covers the plan's decision tables exactly:
 *  - schedule classification (MAX(AVAILABLE_TIME)>0 AND no absence activity)
 *    + first-working-day pick + watermark staleness math
 *  - journey readback classifier (verified / none / multiple / mismatch)
 *  - ART block readback classifier (§ART: only a post-submission snapshot can
 *    verify OR fail; pre-submission match = verification_pending, never failed)
 *  - renderers: specialNotes / msg1 / msg2 exact skeletons
 *  - display-phase derivation + completion predicate
 *  - eligibility evaluation, one failing gate at a time, both workflows
 *
 * The orchestrator module transitively opens DB pools on import; after()
 * closes them so the runner exits (same trap as vrm-fleet-status.test.ts).
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";

import {
  WORKFLOW_CUTOVER,
  WORKFLOW_REQUEST,
  TERMINAL_STATUSES,
  ABSENCE_ACTIVITIES,
  WATERMARK_MAX_AGE_HOURS,
  BLOCK_ACTIVITY_TOKEN,
  BLOCK_START_TIME_TOKEN,
  QUIET_EXCEPTION_STATES,
  isContractBlockLive,
  normalizeActivity,
  zip5,
  digitsOnly,
  normTruck,
  isTruckSilence,
  stableStringify,
  previewHash,
  etTodayISO,
  addDaysISO,
  classifyScheduleDays,
  firstWorkingDay,
  watermarkAgeHours,
  classifyJourneyReadback,
  classifyBlockReadback,
  renderSpecialNotes,
  renderRequestSpecialNotes,
  renderMsg1,
  renderMsg2,
  deriveDisplayPhase,
  completionSatisfied,
  evaluateEligibility,
  type EligibilityFacts,
  type ScheduleDayRow,
} from "../server/vrm/forms/cutover-orchestrator";

after(async () => {
  const { pool } = await import("../server/db");
  await pool.end().catch(() => {});
  const { fsPool } = await import("../server/fleet-scope-db");
  await fsPool.end().catch(() => {});
});

// ---------------------------------------------------------------------------

describe("small helpers", () => {
  test("normalizeActivity collapses whitespace and case", () => {
    assert.equal(normalizeActivity("  Personal   HOLIDAY "), "personal holiday");
    assert.equal(normalizeActivity(null), "");
  });

  test("zip5 pulls the first 5-digit run", () => {
    assert.equal(zip5("TX 75001-1234"), "75001");
    assert.equal(zip5("no zip here"), "");
    assert.equal(zip5(75001), "75001");
  });

  test("digitsOnly / normTruck strip formatting and leading zeros", () => {
    assert.equal(digitsOnly("(214) 555-0100"), "2145550100");
    assert.equal(normTruck("023132"), "23132");
    assert.equal(normTruck("61385"), "61385");
    // all-zero digits fall back to trimmed uppercase raw
    assert.equal(normTruck("BYOV"), "BYOV");
  });

  test("isTruckSilence: blank/na/none/zeros are silence, real numbers are not", () => {
    for (const v of ["", "  ", "n/a", "NA", "none", "Unknown", "0", "000"]) {
      assert.equal(isTruckSilence(v), true, `expected silence for ${JSON.stringify(v)}`);
    }
    assert.equal(isTruckSilence("61385"), false);
    // A non-numeric word is a statement, not silence — it can contradict.
    assert.equal(isTruckSilence("byov"), false);
  });

  test("stableStringify is key-order invariant; previewHash tracks it", () => {
    const a = { b: 1, a: { d: [3, { z: 1, y: 2 }], c: 2 } };
    const b = { a: { c: 2, d: [3, { y: 2, z: 1 }] }, b: 1 };
    assert.equal(stableStringify(a), stableStringify(b));
    assert.equal(previewHash(a), previewHash(b));
    assert.notEqual(previewHash(a), previewHash({ ...a, b: 2 }));
  });

  test("etTodayISO renders the ET calendar day; addDaysISO survives DST + rollovers", () => {
    // 2026-01-15 03:30 UTC is 2026-01-14 22:30 ET.
    assert.equal(etTodayISO(new Date("2026-01-15T03:30:00Z")), "2026-01-14");
    assert.equal(addDaysISO("2026-03-07", 1), "2026-03-08"); // spring-forward day
    assert.equal(addDaysISO("2026-08-31", 1), "2026-09-01");
    assert.equal(addDaysISO("2026-12-31", 1), "2027-01-01");
    assert.equal(addDaysISO("2026-08-16", -1), "2026-08-15");
  });

  test("contract-block live gate defaults OFF (dark build invariant)", () => {
    const saved = process.env.VRM_CONTRACT_BLOCK_ENABLED;
    try {
      delete process.env.VRM_CONTRACT_BLOCK_ENABLED;
      assert.equal(isContractBlockLive(), false);
      process.env.VRM_CONTRACT_BLOCK_ENABLED = "false";
      assert.equal(isContractBlockLive(), false);
      process.env.VRM_CONTRACT_BLOCK_ENABLED = "1";
      assert.equal(isContractBlockLive(), true);
    } finally {
      if (saved === undefined) delete process.env.VRM_CONTRACT_BLOCK_ENABLED;
      else process.env.VRM_CONTRACT_BLOCK_ENABLED = saved;
    }
  });

  test("quiet-hours exception map covers the six special states only", () => {
    assert.deepEqual(Object.keys(QUIET_EXCEPTION_STATES).sort(), ["CT", "FL", "MD", "OK", "TX", "WA"]);
  });
});

// ---------------------------------------------------------------------------

describe("schedule gate", () => {
  const row = (day: string, maxAvail: number | null, activities: string[] = []): ScheduleDayRow => ({
    day, maxAvail, activities, snapshotTs: "2026-08-16T08:09:00Z",
  });

  test("working requires a shift AND zero absence activities", () => {
    const days = classifyScheduleDays([
      row("2026-08-17", 480, ["Morning Huddle", "Part Pickup"]),
      row("2026-08-18", 480, ["Vacation"]),
      row("2026-08-19", 0, []),
      row("2026-08-20", null, []),
      row("2026-08-21", 480, ["  personal   HOLIDAY "]), // normalization must catch this
    ]);
    assert.deepEqual(days.map((d) => d.working), [true, false, false, false, false]);
    assert.deepEqual(days[1].absences, ["Vacation"]);
    assert.equal(days[4].absences.length, 1);
  });

  test("all 14 absence activities are recognized post-normalization", () => {
    assert.equal(ABSENCE_ACTIVITIES.size, 14);
    for (const a of ABSENCE_ACTIVITIES) {
      const [d] = classifyScheduleDays([row("2026-08-17", 480, [a.toUpperCase()])]);
      assert.equal(d.working, false, `absence '${a}' must kill the working day`);
    }
  });

  test("classifyScheduleDays sorts by date; firstWorkingDay respects the floor", () => {
    const days = classifyScheduleDays([
      row("2026-08-19", 480),
      row("2026-08-17", 480),
      row("2026-08-18", 480, ["Sickness"]),
    ]);
    assert.deepEqual(days.map((d) => d.date), ["2026-08-17", "2026-08-18", "2026-08-19"]);
    assert.equal(firstWorkingDay(days, "2026-08-17"), "2026-08-17");
    assert.equal(firstWorkingDay(days, "2026-08-18"), "2026-08-19"); // skips the sick day
    assert.equal(firstWorkingDay(days, "2026-08-20"), null);
  });

  test("watermarkAgeHours: null/garbage → null; freshness compared against 26h ceiling", () => {
    assert.equal(watermarkAgeHours(null), null);
    assert.equal(watermarkAgeHours("not a date"), null);
    const now = new Date("2026-08-16T12:00:00Z");
    assert.equal(watermarkAgeHours("2026-08-16T10:00:00Z", now), 2);
    const stale = watermarkAgeHours("2026-08-15T08:00:00Z", now)!;
    assert.ok(stale > WATERMARK_MAX_AGE_HOURS, "28h-old watermark must read stale");
  });
});

// ---------------------------------------------------------------------------

describe("journey readback classifier", () => {
  const expected = { confirmation: "1568742936", ldap: "ABC123", branchCode: "DAL01", date: "2026-08-20", sipp: "CCAR" };
  const match = { confirmation: "1568742936", reference: "SHS ABC123 CUTOVER", branchCode: "DAL01", date: "2026-08-20T00:00:00", sipp: "ccar" };

  test("exactly one full match verifies (case-insensitive, long-form dates ok)", () => {
    const r = classifyJourneyReadback(expected, [match]);
    assert.equal(r.verdict, "verified");
  });

  test("zero matches → none; two matches → multiple", () => {
    assert.equal(classifyJourneyReadback(expected, []).verdict, "none");
    assert.equal(classifyJourneyReadback(expected, [match, { ...match }]).verdict, "multiple");
  });

  test("confirmation mismatch and LDAP-less reference are mismatches with reasons", () => {
    const conf = classifyJourneyReadback(expected, [{ ...match, confirmation: "999" }]);
    assert.equal(conf.verdict, "mismatch");
    assert.match(conf.reason, /confirmation/);

    const ref = classifyJourneyReadback(expected, [{ ...match, reference: "SOMEONE ELSE" }]);
    assert.equal(ref.verdict, "mismatch");
    assert.match(ref.reason, /LDAP/);
  });

  test("branch/date/class compared only when BOTH sides carry them", () => {
    const sparse = { confirmation: "1568742936", reference: "abc123", branchCode: null, date: null, sipp: null };
    assert.equal(classifyJourneyReadback(expected, [sparse]).verdict, "verified");
    assert.equal(classifyJourneyReadback(expected, [{ ...sparse, sipp: "FFAR" }]).verdict, "mismatch");
  });
});

// ---------------------------------------------------------------------------

describe("block readback classifier (§ART)", () => {
  const submitted = "2026-08-18T15:00:00Z";
  const before = "2026-08-18T08:09:00Z";
  const afterTs = "2026-08-19T08:09:00Z";
  const good = { activity: "VEHICLE -  Change", startTime: "08:00:00", postcode: "TX 75001-1234", snapshotTs: afterTs };

  test("normalized token match in a POST-submission snapshot verifies", () => {
    const r = classifyBlockReadback({ rows: [good], blockSubmittedAt: submitted, expectedZip5: "75001", globalWatermark: afterTs });
    assert.equal(r.verdict, "block_verified");
    assert.equal(normalizeActivity(good.activity), BLOCK_ACTIVITY_TOKEN);
    assert.equal(good.startTime, BLOCK_START_TIME_TOKEN);
  });

  test("match only in a PRE-submission snapshot is pending, never verified or failed", () => {
    const r = classifyBlockReadback({
      rows: [{ ...good, snapshotTs: before }],
      blockSubmittedAt: submitted, expectedZip5: "75001", globalWatermark: before,
    });
    assert.equal(r.verdict, "verification_pending");
  });

  test("no rows + stale watermark = pending (the load simply hasn't run)", () => {
    const r = classifyBlockReadback({ rows: [], blockSubmittedAt: submitted, expectedZip5: "75001", globalWatermark: before });
    assert.equal(r.verdict, "verification_pending");
  });

  test("fresh snapshot without the block = manual_repair, reason lists what it saw", () => {
    const r = classifyBlockReadback({
      rows: [{ activity: "Standby", startTime: "09:00:00", postcode: "75001", snapshotTs: afterTs }],
      blockSubmittedAt: submitted, expectedZip5: "75001", globalWatermark: afterTs,
    });
    assert.equal(r.verdict, "manual_repair");
    assert.match(r.reason, /Standby/);
  });

  test("fresh watermark with zero rows for the day = manual_repair (block vanished)", () => {
    const r = classifyBlockReadback({ rows: [], blockSubmittedAt: submitted, expectedZip5: "75001", globalWatermark: afterTs });
    assert.equal(r.verdict, "manual_repair");
  });

  test("wrong ZIP or wrong start time never verifies", () => {
    for (const bad of [{ ...good, postcode: "76001" }, { ...good, startTime: "09:00:00" }]) {
      const r = classifyBlockReadback({ rows: [bad], blockSubmittedAt: submitted, expectedZip5: "75001", globalWatermark: afterTs });
      assert.equal(r.verdict, "manual_repair");
    }
  });
});

// ---------------------------------------------------------------------------

describe("renderers (plan skeletons, verbatim)", () => {
  test("specialNotes with claim + open date + vehicle", () => {
    const s = renderSpecialNotes({
      tpmsTruck: "61385", ecars: "E123456", claim: "CLM-9", rentalStartDate: "2026-07-01",
      year: "2022", make: "Ford", model: "Transit", sipp: "CCAR", ldap: "abc123",
    });
    assert.match(s, /^SHS TRUCK 61385\. SHS FLEET - DIRECT BILLING CHANGEOVER\./);
    assert.match(s, /CLOSE Enterprise ticket E123456 \(Holman\/ARI claim CLM-9\), opened 2026-07-01,/);
    assert.match(s, /keeps the 2022 Ford Transit/);
    assert.match(s, /Reserved CCAR to match\. Technician LDAP abc123\./);
  });

  test("specialNotes omits claim clause / open date and falls back to 'vehicle'", () => {
    const s = renderSpecialNotes({
      tpmsTruck: "61385", ecars: "E1", claim: "  ", rentalStartDate: null,
      year: null, make: null, model: null, sipp: "FFAR", ldap: "abc123",
    });
    assert.doesNotMatch(s, /claim/i);
    assert.doesNotMatch(s, /opened/);
    assert.match(s, /ticket E1, and re-sign/);
    assert.match(s, /keeps the vehicle they are already driving/);
  });

  test("msg1 is the night-before text; msg2 is the morning-of text", () => {
    const f = { conf: "1568742936", branchName: "Dallas Main", branchAddress: "1 Main St, Dallas, TX 75001" };
    const m1 = renderMsg1(f);
    const m2 = renderMsg2(f);
    assert.match(m1, /^SHS Fleet: Your replacement Enterprise rental is booked — confirmation 1568742936\./);
    assert.match(m1, /Tomorrow you have a 30-minute 8:00 AM route block/);
    assert.match(m1, /billing changeover only/);
    assert.match(m2, /^SHS Fleet reminder: today's 8:00 AM block/);
    assert.match(m2, /confirmation 1568742936/);
    for (const m of [m1, m2]) {
      assert.match(m, /Dallas Main/);
      assert.match(m, /1 Main St/);
    }
  });

  test("request specialNotes: truck and LDAP ride the note; no cutover language", () => {
    const s = renderRequestSpecialNotes({ truck: "61385", ldap: "abc123" });
    assert.match(s, /^SHS TRUCK 61385\. SHS FLEET - DIRECT BILLING\./);
    assert.match(s, /Technician LDAP abc123\./);
    assert.match(s, /Bill direct to TransformCo/);
    // A NEW rental: nothing about closing a prior Enterprise ticket.
    assert.doesNotMatch(s, /CHANGEOVER|CLOSE Enterprise ticket|re-sign|keeps the/);
  });

  test("request specialNotes: missing truck renders n/a, never 'null'", () => {
    const s = renderRequestSpecialNotes({ truck: null, ldap: "abc123" });
    assert.match(s, /^SHS TRUCK n\/a\./);
    assert.doesNotMatch(s, /null|undefined/);
  });
});

// ---------------------------------------------------------------------------

describe("display phase + completion", () => {
  test("terminal and hard statuses pass through untouched", () => {
    for (const s of TERMINAL_STATUSES) assert.equal(deriveDisplayPhase({ status: s }), s);
    for (const s of ["manual_review", "preview_required", "booking_unknown", "block_conflict_pending_readback"]) {
      assert.equal(deriveDisplayPhase({ status: s, reservation_state: "verified", block_state: "verified" }), s);
    }
  });

  test("post-verification ladder", () => {
    const base = { status: "awaiting_verification", reservation_state: "verified" };
    assert.equal(deriveDisplayPhase({ ...base, block_state: "pending" }), "filing_block");
    assert.equal(deriveDisplayPhase({ ...base, block_state: "accepted" }), "awaiting_block_verification");
    assert.equal(deriveDisplayPhase({ ...base, block_state: "verification_pending" }), "awaiting_block_verification");
    assert.equal(deriveDisplayPhase({ ...base, block_state: "verified", msg2_state: "pending" }), "awaiting_msg2_release");
    assert.equal(deriveDisplayPhase({ ...base, block_state: "verified", msg2_state: "released" }), "wrapping_up");
    assert.equal(deriveDisplayPhase({ ...base, block_state: "manual_repair" }), "block_manual_repair");
  });

  test("completionSatisfied demands verified+verified+msg1 out+msg2 out", () => {
    const done = { reservation_state: "verified", block_state: "verified", msg1_state: "sent", msg2_state: "released" };
    assert.equal(completionSatisfied(done), true);
    assert.equal(completionSatisfied({ ...done, block_state: "accepted" }), false);
    assert.equal(completionSatisfied({ ...done, msg1_state: "pending" }), false);
    assert.equal(completionSatisfied({ ...done, msg2_state: "held" }), false);
    assert.equal(completionSatisfied({ ...done, reservation_state: "booked" }), false);
    // REQUEST workflow: booking IS the lifecycle. Route blocks/texts are
    // cutover-only (Tyler 2026-08-16) — verified reservation = complete,
    // and no block phase may ever surface.
    assert.equal(completionSatisfied({ workflow_type: WORKFLOW_REQUEST, reservation_state: "verified", block_state: "not_applicable" }), true);
    assert.equal(completionSatisfied({ workflow_type: WORKFLOW_REQUEST, reservation_state: "booked" }), false);
    assert.equal(
      deriveDisplayPhase({ status: "reservation_verified", workflow_type: WORKFLOW_REQUEST, reservation_state: "verified", block_state: "not_applicable" }),
      "wrapping_up",
    );
    assert.equal(
      deriveDisplayPhase({ status: "awaiting_verification", workflow_type: WORKFLOW_REQUEST, reservation_state: "booked", block_state: "not_applicable" }),
      "awaiting_verification",
    );
  });
});

// ---------------------------------------------------------------------------

describe("eligibility evaluation", () => {
  const cutoverFacts = (): EligibilityFacts => ({
    workflowType: WORKFLOW_CUTOVER,
    sourceId: "s-1",
    ldap: "abc123",
    techName: "Tech Name",
    sourceRow: { id: "s-1" },
    newerResponseExists: false,
    surveyEligible: true,
    otherNonterminalIntentId: null,
    cutoverAlreadyBooked: false,
    roster: { employmentStatus: "A", dropped: false, districtNo: "8330", employeeId: "E1", techName: "Tech Name" },
    tpmsTruck: "61385",
    truckContradiction: null,
    openCaseCount: 1,
    caseKey: "case-1",
    caseFacts: {
      vehicleNumber: "61385", rentingBranch: "DALLAS MAIN", rentingCity: "DALLAS", rentingState: "TX",
      ecars: "E123", claim: null, year: "2022", make: "Ford", model: "Transit", rentalStartDate: null, vendor: "ENTERPRISE",
    },
    contactPhone: "2145550100",
    contactState: "TX",
    requestFallbackPhone: null,
  });

  const expectOnly = (f: EligibilityFacts, code: string) => {
    const r = evaluateEligibility(f);
    assert.equal(r.ok, false);
    assert.deepEqual(r.failures.map((x) => x.code), [code]);
  };

  test("baseline cutover facts pass", () => {
    assert.deepEqual(evaluateEligibility(cutoverFacts()), { ok: true, failures: [] });
  });

  test("each cutover gate flips exactly its own code", () => {
    expectOnly({ ...cutoverFacts(), newerResponseExists: true }, "response_superseded");
    expectOnly({ ...cutoverFacts(), otherNonterminalIntentId: 42 }, "intent_conflict");
    expectOnly({ ...cutoverFacts(), cutoverAlreadyBooked: true }, "already_booked");
    expectOnly({ ...cutoverFacts(), surveyEligible: false }, "survey_conditions");
    expectOnly({ ...cutoverFacts(), ldap: "zztest" }, "test_ldap");
    expectOnly({ ...cutoverFacts(), roster: { ...cutoverFacts().roster!, employmentStatus: "T" } }, "roster_inactive");
    expectOnly({ ...cutoverFacts(), roster: { ...cutoverFacts().roster!, dropped: true } }, "roster_dropped");
    expectOnly({ ...cutoverFacts(), roster: { ...cutoverFacts().roster!, districtNo: null } }, "district_missing");
    expectOnly({ ...cutoverFacts(), tpmsTruck: null }, "tpms_truck_missing");
    expectOnly({ ...cutoverFacts(), truckContradiction: "survey says 99999, TPMS says 61385" }, "tpms_truck_contradiction");
    expectOnly({ ...cutoverFacts(), openCaseCount: 0, caseFacts: null, caseKey: null }, "case_cardinality");
    expectOnly({ ...cutoverFacts(), openCaseCount: 2 }, "case_cardinality");
    expectOnly({ ...cutoverFacts(), caseFacts: { ...cutoverFacts().caseFacts!, ecars: null } }, "ecars_missing");
    expectOnly({ ...cutoverFacts(), caseFacts: { ...cutoverFacts().caseFacts!, rentingBranch: null } }, "renting_branch_missing");
    expectOnly({ ...cutoverFacts(), contactPhone: null }, "contact_phone_missing");
  });

  test("roster_missing reports alone when the roster row is absent", () => {
    const r = evaluateEligibility({ ...cutoverFacts(), roster: null });
    assert.deepEqual(r.failures.map((x) => x.code), ["roster_missing"]);
  });

  test("source_missing when the bound revision vanished", () => {
    const r = evaluateEligibility({ ...cutoverFacts(), sourceRow: null });
    assert.ok(r.failures.some((x) => x.code === "source_missing"));
  });

  const requestFacts = (): EligibilityFacts => ({
    ...cutoverFacts(),
    workflowType: WORKFLOW_REQUEST,
    sourceRow: { status: "approved", etd_booked_at: null },
    openCaseCount: 0, // requests don't gate on Enterprise case cardinality
    caseKey: null,
    caseFacts: null,
  });

  test("request baseline passes without any Enterprise case", () => {
    assert.deepEqual(evaluateEligibility(requestFacts()), { ok: true, failures: [] });
  });

  test("request path: approval + not-yet-booked + phone fallback rules", () => {
    expectOnly({ ...requestFacts(), sourceRow: { status: "pending", etd_booked_at: null } }, "request_not_approved");
    expectOnly({ ...requestFacts(), sourceRow: { status: "approved", etd_booked_at: "2026-08-01" } }, "request_already_booked");
    // fs_comms phone missing but request mobile fallback present → still ok
    const fallback = evaluateEligibility({ ...requestFacts(), contactPhone: null, requestFallbackPhone: "2145550111" });
    assert.equal(fallback.ok, true);
    expectOnly({ ...requestFacts(), contactPhone: null, requestFallbackPhone: null }, "contact_phone_missing");
    // survey-only gates must NOT fire for requests
    const r = evaluateEligibility({ ...requestFacts(), newerResponseExists: true, surveyEligible: false, cutoverAlreadyBooked: true });
    assert.equal(r.ok, true);
  });
});
