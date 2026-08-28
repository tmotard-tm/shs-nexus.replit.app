import test from "node:test";
import assert from "node:assert/strict";
import {
  inventoryEasternClock,
  isDailyTruckInventoryRefreshDue,
} from "../server/truck-inventory-refresh";

test("is not due before 7 AM Eastern", () => {
  assert.equal(
    isDailyTruckInventoryRefreshDue(
      new Date("2026-08-28T10:59:59Z"),
      null,
    ),
    false,
  );
});

test("is due at 7 AM Eastern during daylight time", () => {
  assert.equal(
    isDailyTruckInventoryRefreshDue(new Date("2026-08-28T11:00:00Z"), null),
    true,
  );
});

test("is due at 7 AM Eastern during standard time", () => {
  assert.equal(
    isDailyTruckInventoryRefreshDue(new Date("2026-12-15T12:00:00Z"), null),
    true,
  );
});

test("a same-Eastern-day completion suppresses a second run", () => {
  assert.equal(
    isDailyTruckInventoryRefreshDue(
      new Date("2026-08-28T20:00:00Z"),
      new Date("2026-08-28T11:15:00Z"),
    ),
    false,
  );
});

test("a prior-Eastern-day completion allows startup catch-up", () => {
  assert.equal(
    isDailyTruckInventoryRefreshDue(
      new Date("2026-08-28T20:00:00Z"),
      new Date("2026-08-27T23:30:00Z"),
    ),
    true,
  );
});

test("Eastern clock emits a stable YYYY-MM-DD day and 24-hour clock", () => {
  assert.deepEqual(
    inventoryEasternClock(new Date("2026-08-28T11:00:00Z")),
    { day: "2026-08-28", hour: 7 },
  );
});