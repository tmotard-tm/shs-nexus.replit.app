/**
 * Rental origin badge vocabulary — the ONE mapping every surface uses
 * (RentalOperations board, Cases by Region, case drawer, VRM Ops Queue,
 * FleetScope Today's Queue) to label a rental Holman-issued vs direct billing.
 *
 * The load-bearing rule: a billing-origin badge must never assert an origin
 * the data can't prove. Only the three known vrm_rental_operations_cases.source
 * values map to a badge; null/legacy/unknown values map to null and every
 * surface renders nothing for them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { rentalOriginOf } from "../client/src/pages/vehicle-rental-management/lib/case-model";

test("enterprise_direct (manual direct-billing report) badges as direct bill", () => {
  const o = rentalOriginOf("enterprise_direct");
  assert.ok(o);
  assert.equal(o.kind, "direct");
  assert.equal(o.label, "direct bill");
});

test("both Holman-book feed sources badge as holman", () => {
  for (const s of ["enterprise", "holman_non_enterprise"]) {
    const o = rentalOriginOf(s);
    assert.ok(o, `expected a badge for ${s}`);
    assert.equal(o.kind, "holman");
    assert.equal(o.label, "holman");
  }
});

test("unknown/legacy/empty sources return null — no badge, never a false origin", () => {
  for (const s of [null, undefined, "", "tpms", "roster", "both", "ENTERPRISE", "Enterprise_Direct"]) {
    assert.equal(rentalOriginOf(s as any), null, `expected null for ${JSON.stringify(s)}`);
  }
});
