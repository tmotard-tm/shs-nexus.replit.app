import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonTruck,
  buildCaseFacts,
  aggregateSummary,
  stageToRightsizeCounts,
  computeWeeklyFlows,
  SEDAN_FLOOR,
  type SupplementalFacts,
  type TruckState,
} from "../server/vrm/executive-summary/metrics";
import type { MasterRow } from "../server/vrm/rental-operations/read-repository";

const TODAY = new Date(Date.UTC(2026, 6, 26));

function row(overrides: Partial<MasterRow> = {}): MasterRow {
  return {
    case_key: "01234",
    vehicle_number: "01234",
    rental_vendor: "ENTERPRISE RENT-A-CAR",
    days_open: 10,
    days_authorized: 14,
    number_of_extensions: 0,
    repairs_complete: null,
    daily_cost: 60,
    class_bucket: "SUV/VAN/TRUCK",
    identity_state: "RESOLVED",
    employee_id: "abc123",
    employee_status: "Active",
    tech_name: "Test Tech",
    tech_district: "1234",
    has_open_repair: false,
    ...overrides,
  } as MasterRow;
}

function truck(overrides: Partial<TruckState> = {}): TruckState {
  return {
    terminal: false,
    regInProgress: false,
    regRenewalInProcess: false,
    stickerValid: null,
    regExpiry: null,
    holmanRegExpiry: null,
    ...overrides,
  };
}

function supp(overrides: Partial<SupplementalFacts> = {}): SupplementalFacts {
  return {
    newHireEids: new Set(),
    truckByCanon: new Map(),
    decommCanon: new Set(),
    today: TODAY,
    ...overrides,
  };
}

// ── canonTruck ──

test("canonTruck strips non-digits and leading zeros", () => {
  assert.equal(canonTruck("01234"), "1234");
  assert.equal(canonTruck("1234"), "1234");
  assert.equal(canonTruck("T-088144"), "88144");
  assert.equal(canonTruck(null), "");
});

// ── buildCaseFacts join behavior ──

test("5-padded case_key matches unpadded truck", () => {
  const s = supp({ truckByCanon: new Map([["1234", truck({ terminal: true })]]) });
  const facts = buildCaseFacts([row()], s);
  assert.equal(facts[0].truckTerminal, true);
});

test("decomm membership sets truckTerminal even without fs_trucks row", () => {
  const s = supp({ decommCanon: new Set(["1234"]) });
  assert.equal(buildCaseFacts([row()], s)[0].truckTerminal, true);
});

test("missing truck row → regBlocked false", () => {
  assert.equal(buildCaseFacts([row()], supp())[0].regBlocked, false);
});

test("new hire only when resolved AND eid in set (upper-cased)", () => {
  const s = supp({ newHireEids: new Set(["ABC123"]) });
  assert.equal(buildCaseFacts([row()], s)[0].isNewHire, true);
  assert.equal(buildCaseFacts([row({ identity_state: "REVIEW" })], s)[0].isNewHire, false);
  assert.equal(buildCaseFacts([row({ employee_id: null })], s)[0].isNewHire, false);
});

test("daysBehind computed only when both present", () => {
  assert.equal(buildCaseFacts([row()], supp())[0].daysBehind, -4);
  assert.equal(buildCaseFacts([row({ days_authorized: null })], supp())[0].daysBehind, null);
});

// ── aggregateSummary ──

const RS = { secured: 0, committed: 0, outstanding: 0, excused: 0 };

test("aggregate math: spend, savings floor, vendor split, bucket sum", () => {
  const rows = [
    row({ case_key: "00001", daily_cost: 100, class_bucket: "SUV/VAN/TRUCK" }),   // savings 100-54.99
    row({ case_key: "00002", daily_cost: 40, class_bucket: "SUV/VAN/TRUCK" }),    // below floor → 0
    row({ case_key: "00003", daily_cost: 200, class_bucket: "SEDAN" }),           // sedan → no savings
    row({ case_key: "00004", daily_cost: null, rental_vendor: "Hertz Corp" }),    // null cost → 0 spend
  ];
  const agg = aggregateSummary(buildCaseFacts(rows, supp()), RS, {});
  assert.equal(agg.headline.openTotal, 4);
  assert.equal(agg.headline.dailySpend, 340);
  assert.equal(agg.headline.monthlyRunRate, Math.round(340 * 30.4 * 100) / 100);
  assert.equal(agg.headline.potentialDailySavings, Math.round((100 - SEDAN_FLOOR) * 100) / 100);
  assert.equal(agg.headline.byVendor.Enterprise, 3);
  assert.equal(agg.headline.byVendor.Hertz, 1);
  const bucketSum = agg.buckets.reduce((s, b) => s + b.count, 0);
  assert.equal(bucketSum, 4);
});

test("aggregate: avgDaysOpen ignores nulls, over30 counts >30", () => {
  const rows = [
    row({ case_key: "00001", days_open: 10 }),
    row({ case_key: "00002", days_open: 50 }),
    row({ case_key: "00003", days_open: null }),
  ];
  const agg = aggregateSummary(buildCaseFacts(rows, supp()), RS, {});
  assert.equal(agg.headline.avgDaysOpen, 30);
  assert.equal(agg.headline.over30Count, 1);
});

test("aggregate: unknownRenter + regBlocked counts, empty input", () => {
  const s = supp({ truckByCanon: new Map([["2", truck({ stickerValid: "Expired" })]]) });
  const rows = [
    row({ case_key: "00001", identity_state: "REVIEW" }),
    row({ case_key: "00002", vehicle_number: "00002" }),
  ];
  const agg = aggregateSummary(buildCaseFacts(rows, s), RS, {});
  assert.equal(agg.headline.unknownRenterCount, 1);
  assert.equal(agg.headline.regBlockedCount, 1);
  const empty = aggregateSummary([], RS, {});
  assert.equal(empty.headline.openTotal, 0);
  assert.equal(empty.headline.avgDaysOpen, null);
});

test("district breakdown top-10 by count", () => {
  const rows = Array.from({ length: 12 }, (_, i) =>
    row({ case_key: String(i + 1).padStart(5, "0"), tech_district: `D${i}` }),
  );
  rows.push(row({ case_key: "00099", tech_district: "D0" }));
  const agg = aggregateSummary(buildCaseFacts(rows, supp()), RS, {});
  assert.equal(agg.breakdowns.byDistrict.length, 10);
  assert.equal(agg.breakdowns.byDistrict[0].key, "D0");
  assert.equal(agg.breakdowns.byDistrict[0].count, 2);
});

// ── stageToRightsizeCounts ──

test("stageToRightsizeCounts full taxonomy", () => {
  const { counts, stages } = stageToRightsizeCounts([
    "DONE", "RETURNED", "COMMITTED", "PASS_EXCUSED",
    "NON_RESPONDER", "QUESTION", "PUSHBACK_STOCK", "PUSHBACK_EQUIP", "PUSHBACK_PROCESS",
  ]);
  assert.deepEqual(counts, { secured: 2, committed: 1, outstanding: 5, excused: 1 });
  assert.equal(stages.DONE, 1);
  assert.equal(stages.PUSHBACK_STOCK, 1);
});

// ── computeWeeklyFlows ──

test("computeWeeklyFlows window edges", () => {
  const today = "2026-07-26";
  const flows = [
    { started: "2026-07-26", dropped: null },     // today → this week
    { started: "2026-07-20", dropped: "2026-07-25" }, // this week both
    { started: "2026-07-19", dropped: "2026-07-19" }, // exactly 7 days back → prev week (boundary)
    { started: "2026-07-13", dropped: null },     // 13 days back → prev week (far boundary)
    { started: "2026-07-12", dropped: "2026-07-12" }, // 14 days back → neither (outside both)
    { started: "2026-07-11", dropped: null },     // 15 days back → neither
    { started: null, dropped: null },             // null started → ignored
  ];
  const r = computeWeeklyFlows(flows, today);
  assert.equal(r.newThisWeek, 2);
  assert.equal(r.returnedThisWeek, 1);
  assert.equal(r.newPrevWeek, 2);
  assert.equal(r.returnedPrevWeek, 1);
});
