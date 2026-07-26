import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyBucket,
  normalizeVendor,
  isTerminatedStatus,
  isLoaStatus,
  isRegBlocked,
  parseUsDate,
  type CaseFacts,
  type TruckRegFacts,
  BUCKET_ORDER,
  BUCKET_LABELS,
} from "../server/vrm/executive-summary/buckets";

const TODAY = new Date(Date.UTC(2026, 6, 26)); // 2026-07-26

function facts(overrides: Partial<CaseFacts> = {}): CaseFacts {
  return {
    caseKey: "01234",
    vehicleNumber: "01234",
    vendor: "Enterprise",
    dailyCost: 60,
    daysOpen: 10,
    daysBehind: null,
    extensions: 0,
    identityResolved: true,
    employeeId: "ABC123",
    employeeStatus: "Active",
    techName: "Test Tech",
    techDistrict: "1234",
    classBucket: "Minivan",
    isNewHire: false,
    truckTerminal: false,
    hasOpenRepairPo: false,
    repairComplete: false,
    regBlocked: false,
    ...overrides,
  };
}

// ── Precedence ladder ──

test("terminated wins over LOA-ish and repair state", () => {
  const r = classifyBucket(facts({ employeeStatus: "Terminated", hasOpenRepairPo: true, truckTerminal: true }));
  assert.equal(r.bucket, "terminated");
  assert.equal(r.unknownRenter, false);
});

test("LOA wins over new-hire and truck state", () => {
  const r = classifyBucket(facts({ employeeStatus: "On Leave", isNewHire: true, hasOpenRepairPo: true }));
  assert.equal(r.bucket, "loa");
});

test("new hire wins over truck state", () => {
  const r = classifyBucket(facts({ isNewHire: true, truckTerminal: true, hasOpenRepairPo: true }));
  assert.equal(r.bucket, "new_hire");
});

test("declined/decom wins over in-repair", () => {
  const r = classifyBucket(facts({ truckTerminal: true, hasOpenRepairPo: true }));
  assert.equal(r.bucket, "declined_decom");
});

test("in-repair wins over repair-done", () => {
  const r = classifyBucket(facts({ hasOpenRepairPo: true, repairComplete: true }));
  assert.equal(r.bucket, "in_repair");
});

test("repair done splits on regBlocked", () => {
  assert.equal(classifyBucket(facts({ repairComplete: true, regBlocked: true })).bucket, "repair_done_reg_dead");
  assert.equal(classifyBucket(facts({ repairComplete: true, regBlocked: false })).bucket, "repair_done_no_blocker");
});

test("catch-all: no repair activity", () => {
  assert.equal(classifyBucket(facts()).bucket, "no_repair_activity");
});

// ── Unresolved renter: person facts must NOT apply ──

test("unresolved renter with Terminated-looking status lands in truck-state bucket + unknownRenter", () => {
  const r = classifyBucket(facts({ identityResolved: false, employeeStatus: "Terminated", hasOpenRepairPo: true }));
  assert.equal(r.bucket, "in_repair");
  assert.equal(r.unknownRenter, true);
});

test("unresolved renter with new-hire flag does not land in new_hire", () => {
  const r = classifyBucket(facts({ identityResolved: false, isNewHire: true }));
  assert.equal(r.bucket, "no_repair_activity");
  assert.equal(r.unknownRenter, true);
});

// ── Status matchers ──

test("terminated status matcher", () => {
  for (const s of ["Terminated", "TERM", "T", "t"]) assert.equal(isTerminatedStatus(s), true, s);
  for (const s of ["Active", "Pending", "", null, undefined, "On Leave"]) assert.equal(isTerminatedStatus(s as any), false, String(s));
});

test("LOA status matcher", () => {
  for (const s of ["On Leave", "LOA", "L", "P", "S", "l", "leave of absence"]) assert.equal(isLoaStatus(s), true, s);
  for (const s of ["Active", "Pending", "", null, undefined, "Terminated"]) assert.equal(isLoaStatus(s as any), false, String(s));
});

// ── Vendor normalization ──

test("normalizeVendor", () => {
  assert.equal(normalizeVendor("ENTERPRISE RENT-A-CAR"), "Enterprise");
  assert.equal(normalizeVendor("Hertz Corp"), "Hertz");
  assert.equal(normalizeVendor("AVIS"), "Avis");
  assert.equal(normalizeVendor(null), "Unknown");
  assert.equal(normalizeVendor(""), "Unknown");
  assert.equal(normalizeVendor("Joe's  Rentals"), "Joe's Rentals");
});

// ── Registration blocked ──

function reg(overrides: Partial<TruckRegFacts> = {}): TruckRegFacts {
  return {
    regInProgress: false,
    regRenewalInProcess: false,
    stickerValid: null,
    regExpiry: null,
    holmanRegExpiry: null,
    ...overrides,
  };
}

test("isRegBlocked triggers independently", () => {
  assert.equal(isRegBlocked(reg({ regInProgress: true }), TODAY), true);
  assert.equal(isRegBlocked(reg({ regRenewalInProcess: true }), TODAY), true);
  assert.equal(isRegBlocked(reg({ stickerValid: "Expired" }), TODAY), true);
  assert.equal(isRegBlocked(reg({ stickerValid: "expired 6/30" }), TODAY), true);
  assert.equal(isRegBlocked(reg({ stickerValid: "Yes" }), TODAY), false);
  assert.equal(isRegBlocked(reg({ stickerValid: "Contacted tech" }), TODAY), false);
});

test("isRegBlocked expiry dates", () => {
  assert.equal(isRegBlocked(reg({ regExpiry: "10/31/2025" }), TODAY), true);   // past
  assert.equal(isRegBlocked(reg({ regExpiry: "8/31/2026" }), TODAY), false);   // future
  assert.equal(isRegBlocked(reg({ regExpiry: null, holmanRegExpiry: "1/1/2026" }), TODAY), true); // fallback
  assert.equal(isRegBlocked(reg({ regExpiry: "garbage" }), TODAY), false);
  assert.equal(isRegBlocked(null, TODAY), false);
  assert.equal(isRegBlocked(undefined, TODAY), false);
});

// ── parseUsDate ──

test("parseUsDate", () => {
  const d = parseUsDate("8/31/2026");
  assert.ok(d);
  assert.equal(d!.toISOString().slice(0, 10), "2026-08-31");
  assert.equal(parseUsDate("2026-08-31"), null);
  assert.equal(parseUsDate(""), null);
  assert.equal(parseUsDate(null), null);
});

// ── Constants sanity ──

test("bucket order covers all 8 buckets with labels", () => {
  assert.equal(BUCKET_ORDER.length, 8);
  for (const b of BUCKET_ORDER) assert.ok(BUCKET_LABELS[b], b);
});
