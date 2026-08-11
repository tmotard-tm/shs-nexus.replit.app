// Unit tests for the Registrations-tab AMS alert derivation.
//
// Covers the reviewer-flagged paths: both accepted statuses in either source
// casing (AMS lookup vs Snowflake text), non-alert statuses, cold-cache null
// handling, and the numeric-code resolution feeding pickAmsAlert.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pickAmsAlert,
  computeAmsStatusReady,
  resolveTruckStatusLabel,
  isAmsDisposalStatus,
  lookupVinStatus,
} from "../server/ams-truck-status-labels";

test("readiness lifecycle: cold → building, stale → keep polling, fresh → ready", () => {
  // Cold cache: no map yet, background build kicked → not ready (no labels).
  assert.equal(computeAmsStatusReady(false, true), false);
  // Defensive: no map can never be ready regardless of the staleness flag.
  assert.equal(computeAmsStatusReady(false, false), false);
  // Stale map: labels are served but a rebuild is in flight → still not
  // ready, so the client keeps polling instead of pinning stale labels.
  assert.equal(computeAmsStatusReady(true, true), false);
  // Fresh in-TTL map → ready; client stops polling.
  assert.equal(computeAmsStatusReady(true, false), true);
});

test("pickAmsAlert accepts Declined Repair in any casing, trimmed", () => {
  assert.equal(pickAmsAlert("Declined Repair"), "Declined Repair");
  assert.equal(pickAmsAlert("Declined repair"), "Declined repair");
  assert.equal(pickAmsAlert("  declined REPAIR  "), "declined REPAIR");
});

test("pickAmsAlert accepts Sent To Auction in any casing", () => {
  assert.equal(pickAmsAlert("Sent To Auction"), "Sent To Auction");
  assert.equal(pickAmsAlert("Sent to Auction"), "Sent to Auction");
});

test("pickAmsAlert rejects every non-alert status", () => {
  for (const label of [
    "Assigned to Tech",
    "In Use",
    "Spare",
    "In Repair",
    "BYOV",
    "Unknown",
    "Transport",
    "Declined", // partial match must NOT alert
    "Auction",
  ]) {
    assert.equal(pickAmsAlert(label), null, label);
  }
});

test("pickAmsAlert handles cold-cache / missing values as null", () => {
  assert.equal(pickAmsAlert(null), null);
  assert.equal(pickAmsAlert(undefined), null);
  assert.equal(pickAmsAlert(""), null);
  assert.equal(pickAmsAlert("   "), null);
});

test("numeric AMS codes resolve to alertable labels end-to-end", () => {
  // Snowflake TRUCK_STATUS often arrives as the raw numeric code.
  assert.equal(pickAmsAlert(resolveTruckStatusLabel("5")), "Declined Repair");
  assert.equal(pickAmsAlert(resolveTruckStatusLabel("8")), "Sent To Auction");
  assert.equal(pickAmsAlert(resolveTruckStatusLabel("1")), null); // Assigned to Tech
  assert.equal(pickAmsAlert(resolveTruckStatusLabel(null)), null);
});

test("live lookup map takes precedence over the constant backstop", () => {
  const lookup = new Map<string, string>([["5", "Declined repair"]]);
  assert.equal(pickAmsAlert(resolveTruckStatusLabel("5", lookup)), "Declined repair");
});

// --- Spare-pool disposal validation (isAmsDisposalStatus) -----------------
// The spare pool must never recommend a van whose AMS status says it is
// leaving the fleet, regardless of which shape the status arrives in.

test("isAmsDisposalStatus flags declined/auction in every source shape", () => {
  // Raw numeric AMS codes (5 = Declined Repair, 8 = Sent To Auction)
  assert.equal(isAmsDisposalStatus("5"), true);
  assert.equal(isAmsDisposalStatus(8), true);
  // Resolved labels in AMS-lookup and Snowflake casings
  assert.equal(isAmsDisposalStatus("Declined Repair"), true);
  assert.equal(isAmsDisposalStatus("Declined repair"), true);
  assert.equal(isAmsDisposalStatus("Sent To Auction"), true);
  assert.equal(isAmsDisposalStatus("  sent to auction  "), true);
  // Live lookup map wins over the constant backstop
  const lookup = new Map<string, string>([["42", "Sent To Auction"]]);
  assert.equal(isAmsDisposalStatus("42", lookup), true);
});

test("lookupVinStatus normalizes the VIN exactly like the cache keys (trim + uppercase)", () => {
  // The AMS truck-status cache stores every key as trim().toUpperCase().
  const map: Record<string, string | null> = {
    "1FTBW3XM6PKB39838": "Declined Repair",
    "3C6TRVDG5RE100200": "Spare",
  };
  // Whitespace-padded, lowercase source VIN (e.g. from the Holman cache) must
  // still resolve — a miss here would let a disposal van back into the pool.
  assert.equal(lookupVinStatus(map, "  1ftbw3xm6pkb39838  "), "Declined Repair");
  assert.equal(isAmsDisposalStatus(lookupVinStatus(map, " 1FTBW3XM6PKB39838\n")), true);
  assert.equal(lookupVinStatus(map, "3c6trvdg5re100200"), "Spare");
  // Missing / blank VINs resolve to null (recommendable — no status claim).
  assert.equal(lookupVinStatus(map, "5NPE24AF0FH000111"), null);
  assert.equal(lookupVinStatus(map, ""), null);
  assert.equal(lookupVinStatus(map, "   "), null);
  assert.equal(lookupVinStatus(map, null), null);
  assert.equal(lookupVinStatus(map, undefined), null);
});

test("isAmsDisposalStatus keeps every non-disposal van recommendable", () => {
  for (const v of [
    "Spare",
    "In Repair",
    "Assigned to Tech",
    "Reserved For New Hire",
    "1",
    "4",
    "6",
    "Unknown",
    "Declined", // partial token must NOT exclude
    "Auction",
    "",
    null,
    undefined,
  ] as Array<string | null | undefined>) {
    assert.equal(isAmsDisposalStatus(v), false, `expected ${String(v)} → recommendable`);
  }
});
