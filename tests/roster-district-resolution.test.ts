import test from "node:test";
import assert from "node:assert/strict";
import { resolveRosterDistrict } from "../server/roster-district-resolution";

test("uses the live TPMS district before the roster fallback", () => {
  assert.equal(resolveRosterDistrict("0007084", "7323"), "7084");
});

test("uses the corrected DRIVELINE district when TPMS has no row", () => {
  assert.equal(resolveRosterDistrict(null, "0007084"), "7084");
  assert.equal(resolveRosterDistrict("", "7323"), "7323");
});

test("never exposes cost centers as employee districts", () => {
  assert.equal(resolveRosterDistrict("3132", "7084"), "7084");
  assert.equal(resolveRosterDistrict(null, "0003580"), null);
});