// Unit tests for the AMS fleet-population capture that now drives the
// Registrations tab truck list (task: AMS-driven population).
//
// Covers the completion-review-flagged paths: SaleDate population derivation,
// malformed/null mid-walk page payloads treated as truncation (never natural
// end of pagination), and the last-good-complete-population preservation
// policy.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractAmsPageRows,
  amsPopulationEntryFromRow,
  shouldReplacePopulation,
} from "../server/ams-truck-status-cache";

test("extractAmsPageRows: recognized shapes are never malformed", () => {
  const rows = [{ VehicleNumber: "46026" }];
  assert.deepEqual(extractAmsPageRows(rows), { rows, malformed: false });
  for (const key of ["data", "vehicles", "results", "items"]) {
    assert.deepEqual(extractAmsPageRows({ [key]: rows }), { rows, malformed: false });
  }
});

test("extractAmsPageRows: an empty array in a valid envelope is a natural end, not malformed", () => {
  assert.deepEqual(extractAmsPageRows([]), { rows: [], malformed: false });
  assert.deepEqual(extractAmsPageRows({ data: [] }), { rows: [], malformed: false });
});

test("extractAmsPageRows: null/undefined/primitive payloads are malformed (truncated walk)", () => {
  for (const bad of [null, undefined, "", "oops", 0, 42, true]) {
    assert.equal(extractAmsPageRows(bad).malformed, true, String(bad));
    assert.equal(extractAmsPageRows(bad).rows.length, 0);
  }
});

test("extractAmsPageRows: error-shaped object without a rows array is malformed", () => {
  assert.equal(extractAmsPageRows({ message: "Internal Server Error" }).malformed, true);
  // A rows key that is not an array must not be trusted either.
  assert.equal(extractAmsPageRows({ data: "not-an-array" }).malformed, true);
});

test("population: rows with a SaleDate are sold history and excluded", () => {
  assert.equal(
    amsPopulationEntryFromRow({ VehicleNumber: "46026", VIN: "1FTYE1YM3GKB13053", SaleDate: "2024-05-01T00:00:00" }),
    null,
  );
  // Casing fallback.
  assert.equal(amsPopulationEntryFromRow({ vehicleNumber: "46026", saleDate: "2024-05-01" }), null);
});

test("population: unsold trucks stay in regardless of status (auction/declined listed)", () => {
  for (const status of [8, 5, 1, null, undefined]) {
    const entry = amsPopulationEntryFromRow({ VehicleNumber: "47420", VIN: "vinx", TruckStatus: status, SaleDate: null });
    assert.deepEqual(entry, { truckNumber: "47420", vin: "VINX" }, `status=${status}`);
  }
});

test("population: VIN-less rows still count; number is digits-only", () => {
  assert.deepEqual(
    amsPopulationEntryFromRow({ VehicleNumber: " 46-026 " }),
    { truckNumber: "46026", vin: null },
  );
  // Blank VIN normalizes to null.
  assert.deepEqual(
    amsPopulationEntryFromRow({ VehicleNumber: "88144", VIN: "   " }),
    { truckNumber: "88144", vin: null },
  );
});

test("population: rows without a usable vehicle number are skipped", () => {
  assert.equal(amsPopulationEntryFromRow({ VIN: "somevin" }), null);
  assert.equal(amsPopulationEntryFromRow({ VehicleNumber: "N/A" }), null);
  assert.equal(amsPopulationEntryFromRow(null), null);
  assert.equal(amsPopulationEntryFromRow("junk"), null);
});

test("overwrite policy: a complete walk always replaces", () => {
  assert.equal(shouldReplacePopulation(null, true), true);
  assert.equal(shouldReplacePopulation({ complete: true }, true), true);
  assert.equal(shouldReplacePopulation({ complete: false }, true), true);
});

test("overwrite policy: a truncated walk never clobbers an existing population", () => {
  assert.equal(shouldReplacePopulation({ complete: true }, false), false);
  // Even an existing incomplete population is kept over a newer incomplete
  // one (no churn); only a complete walk upgrades it.
  assert.equal(shouldReplacePopulation({ complete: false }, false), false);
});

test("overwrite policy: first-ever walk lands even when truncated (better than nothing, flagged incomplete)", () => {
  assert.equal(shouldReplacePopulation(null, false), true);
});
