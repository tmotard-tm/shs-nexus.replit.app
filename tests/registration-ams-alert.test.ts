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
