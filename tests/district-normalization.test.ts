import test from "node:test";
import assert from "node:assert/strict";
import { normalizeFleetDistrict } from "../server/district-normalization";

test("maps cost-center values to their valid fleet districts", () => {
  assert.equal(normalizeFleetDistrict("3132"), "7084");
  assert.equal(normalizeFleetDistrict("0003132"), "0007084");
  assert.equal(normalizeFleetDistrict("3580"), "7323");
  assert.equal(normalizeFleetDistrict("0003580"), "0007323");
});

test("preserves valid districts and empty values", () => {
  assert.equal(normalizeFleetDistrict("7084"), "7084");
  assert.equal(normalizeFleetDistrict("0007084"), "0007084");
  assert.equal(normalizeFleetDistrict(""), null);
  assert.equal(normalizeFleetDistrict(null), null);
  assert.equal(normalizeFleetDistrict("0000000"), null);
  assert.equal(normalizeFleetDistrict("not-a-district"), null);
});