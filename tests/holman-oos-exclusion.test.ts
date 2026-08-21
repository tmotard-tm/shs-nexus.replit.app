/**
 * Task #662 — unit tests for the out-of-service exclusion classifier.
 *
 * Pure module only (no DB): classifyOosExclusion must catch BOTH spellings of
 * "out of service" on a holman_vehicles_cache row — statusCode 2, and the
 * cache-lag shape observed on all 10 BYOV OOS trucks (statusCode still 1 with
 * a past outOfServiceDate) — while leaving in-service rows alone.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyOosExclusion,
  filterInServiceRows,
  isInOosExclusion,
  isOutOfServiceRecord,
} from "../server/holman-oos-policy.js";

const TODAY = "2026-08-21";

test("statusCode=2 row is excluded (number canonicalized, VIN uppercased)", () => {
  const { canonNumbers, vins } = classifyOosExclusion(
    [{ holmanVehicleNumber: "06121", vin: "1gchsbea0f1234567", statusCode: 2, outOfServiceDate: null }],
    TODAY,
  );
  assert.deepEqual([...canonNumbers], ["6121"]);
  assert.deepEqual([...vins], ["1GCHSBEA0F1234567"]);
});

test("cache-lag shape: statusCode=1 with past outOfServiceDate is excluded", () => {
  // Exact shape of the 10 BYOV trucks after the OOS submit: the sync wrote the
  // date but statusCode had not flipped yet.
  const { canonNumbers } = classifyOosExclusion(
    [{ holmanVehicleNumber: "088086", vin: "VIN88086", statusCode: 1, outOfServiceDate: "2026-08-17T00:00:00Z" }],
    TODAY,
  );
  assert.ok(canonNumbers.has("88086"));
});

test("outOfServiceDate equal to today counts as out of service", () => {
  const { canonNumbers } = classifyOosExclusion(
    [{ holmanVehicleNumber: "88097", statusCode: 1, outOfServiceDate: "2026-08-21T00:00:00Z" }],
    TODAY,
  );
  assert.ok(canonNumbers.has("88097"));
});

test("FUTURE outOfServiceDate (scheduled, not effective) is NOT excluded", () => {
  const { canonNumbers, vins } = classifyOosExclusion(
    [{ holmanVehicleNumber: "88097", vin: "VINX", statusCode: 1, outOfServiceDate: "2026-09-01T00:00:00Z" }],
    TODAY,
  );
  assert.equal(canonNumbers.size, 0);
  assert.equal(vins.size, 0);
});

test("in-service rows (no date, empty date, garbage date) are NOT excluded", () => {
  const { canonNumbers } = classifyOosExclusion(
    [
      { holmanVehicleNumber: "06121", statusCode: 1, outOfServiceDate: null },
      { holmanVehicleNumber: "06122", statusCode: 1, outOfServiceDate: "" },
      { holmanVehicleNumber: "06123", statusCode: 1, outOfServiceDate: "not-a-date" },
      { holmanVehicleNumber: "06124", statusCode: null, outOfServiceDate: null },
    ],
    TODAY,
  );
  assert.equal(canonNumbers.size, 0);
});

test("mixed batch keeps only the OOS rows; blank numbers/VINs never enter the sets", () => {
  const { canonNumbers, vins } = classifyOosExclusion(
    [
      { holmanVehicleNumber: "088086", vin: "VINA", statusCode: 1, outOfServiceDate: "2026-08-17T00:00:00Z" },
      { holmanVehicleNumber: "36177", vin: "VINB", statusCode: 2, outOfServiceDate: "2014-12-18T00:00:00Z" },
      { holmanVehicleNumber: "06121", vin: "VINC", statusCode: 1, outOfServiceDate: null },
      { holmanVehicleNumber: "", vin: "", statusCode: 2, outOfServiceDate: null },
      { holmanVehicleNumber: null, vin: null, statusCode: 2, outOfServiceDate: null },
    ],
    TODAY,
  );
  assert.deepEqual([...canonNumbers].sort(), ["36177", "88086"]);
  assert.deepEqual([...vins].sort(), ["VINA", "VINB"]);
});

// ── Spares-pool surface: filterInServiceRows on the active-cache row shape ──

test("spares pool: OOS rows are dropped from the active cache rows, in-service kept", () => {
  // Exact shape of the spares-pool cache select (extra fields ride along).
  const rows = [
    { holmanVehicleNumber: "061210", vin: "VINC", district: "3132", odometer: 12345, tpmsAssignedTechId: null, statusCode: 1, outOfServiceDate: null },
    { holmanVehicleNumber: "088086", vin: "VINA", district: "3132", odometer: 222, tpmsAssignedTechId: null, statusCode: 1, outOfServiceDate: "2026-08-17T00:00:00Z" },
    { holmanVehicleNumber: "036177", vin: "VINB", district: "3580", odometer: 999, tpmsAssignedTechId: null, statusCode: 2, outOfServiceDate: "2014-12-18T00:00:00Z" },
  ];
  const kept = filterInServiceRows(rows, TODAY);
  assert.deepEqual(kept.map((r) => r.holmanVehicleNumber), ["061210"]);
  // Extra fields survive the filter untouched.
  assert.equal(kept[0].district, "3132");
});

test("spares pool: rows missing lifecycle fields are treated as in service (predicate is not a silent drop-all)", () => {
  const kept = filterInServiceRows([{ holmanVehicleNumber: "061210" } as any], TODAY);
  assert.equal(kept.length, 1);
});

// ── Fallback-pool / PMF surface: isInOosExclusion membership semantics ──────

const SETS = classifyOosExclusion(
  [
    { holmanVehicleNumber: "088086", vin: "1GCHSBEA0F1234567", statusCode: 1, outOfServiceDate: "2026-08-17T00:00:00Z" },
  ],
  TODAY,
);

test("fallback pool: number matches across spelling variance (padded, unpadded, spaced)", () => {
  assert.equal(isInOosExclusion(SETS, "88086", null), true);
  assert.equal(isInOosExclusion(SETS, "088086", null), true);
  assert.equal(isInOosExclusion(SETS, "0088086", null), true);
  assert.equal(isInOosExclusion(SETS, " 088086 ", null), true);
  assert.equal(isInOosExclusion(SETS, "88087", null), false);
});

test("PMF candidates: VIN matches case-insensitively; blank identifiers never match", () => {
  assert.equal(isInOosExclusion(SETS, null, "1gchsbea0f1234567"), true);
  assert.equal(isInOosExclusion(SETS, null, "1GCHSBEA0F1234567"), true);
  assert.equal(isInOosExclusion(SETS, null, "SOMEOTHERVIN00000"), false);
  assert.equal(isInOosExclusion(SETS, null, ""), false);
  assert.equal(isInOosExclusion(SETS, "", ""), false);
  assert.equal(isInOosExclusion(SETS, null, null), false);
});

// ── Assign-validation surface: the shapes validateAssignTarget branches on ──

test("assign validation: cache-lag cache row (statusCode=1, past date) is blocked", () => {
  const cacheRow = {
    holmanAssignedStatusCd: "A",
    operationLockAt: null,
    operationLockedBy: null,
    statusCode: 1,
    outOfServiceDate: "2026-08-17T00:00:00Z",
  };
  assert.equal(isOutOfServiceRecord(cacheRow, TODAY), true);
});

test("assign validation: live Holman record with NULL statusCode but past date is blocked", () => {
  // After Holman applies the change, lookup surfaces return statusCode NULL —
  // the date is the only durable signal on the live path.
  assert.equal(
    isOutOfServiceRecord({ statusCode: null, outOfServiceDate: "2026-08-17T00:00:00Z" }, TODAY),
    true,
  );
  assert.equal(
    isOutOfServiceRecord({ statusCode: null, outOfServiceDate: null }, TODAY),
    false,
  );
});
