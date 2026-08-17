/**
 * rental-request eligibility engine — pure unit tests.
 *
 * The engine was simplified on 2026-08-16 (Tyler): maintenance is the ONLY
 * automatic answer left. These tests pin that contract:
 *   - every maintenance category → DENY, rule 1, the standard script
 *   - everything else → APPROVE, rule 8, sedan (cargo van for the HVAC
 *     carve-out), reason handing the decision to a person
 * Rule numbers 2-7 belong to the retired eight-rule engine and must never be
 * re-emitted — historical rows still carry them with their old meanings, and
 * the review UI labels them accordingly.
 *
 * Importing rental-request.ts drags in the db pool, so the workflow runs with
 * --test-force-exit; the after() hook closes what it can regardless.
 */
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";

import { evaluate, MAINTENANCE_DENY_SCRIPT } from "../server/vrm/forms/rental-request";

after(async () => {
  const { pool } = await import("../server/db");
  await pool.end().catch(() => {});
});

const MAINT = ["scheduled_maintenance", "oil_change", "tires", "pm", "inspection"];

describe("maintenance gate", () => {
  test("every maintenance category denies on rule 1 with the standard script", () => {
    for (const cat of MAINT) {
      const v = evaluate({ problemCategory: cat });
      assert.equal(v.decision, "DENY", cat);
      assert.equal(v.rule, 1, cat);
      assert.equal(v.script, MAINTENANCE_DENY_SCRIPT, cat);
    }
  });

  test("the script says wait-through-routing, in exactly the words Fleet sends", () => {
    assert.match(MAINTENANCE_DENY_SCRIPT, /oil changes, tires, preventive maintenance or inspections/);
    assert.match(MAINTENANCE_DENY_SCRIPT, /wait through routing/);
  });

  test("hvac carve-out cannot rescue a maintenance request", () => {
    const v = evaluate({ problemCategory: "tires", hvacCarveOut: true });
    assert.equal(v.decision, "DENY");
    assert.equal(v.rule, 1);
  });
});

describe("everything else clears to a person", () => {
  test("non-maintenance categories approve on rule 8 as sedan", () => {
    for (const cat of ["breakdown", "accident", "new_hire_awaiting_vehicle", "decommission", ""]) {
      const v = evaluate({ problemCategory: cat });
      assert.equal(v.decision, "APPROVE", cat);
      assert.equal(v.rule, 8, cat);
      assert.equal(v.vehicleClass, "sedan", cat);
      assert.match(v.reason ?? "", /profitability/, "the reason must hand the decision to the human");
    }
  });

  test("HVAC carve-out books a cargo van — space, never underscore (an underscore can never substring-match an ETD class description)", () => {
    const v = evaluate({ problemCategory: "breakdown", hvacCarveOut: true });
    assert.equal(v.decision, "APPROVE");
    assert.equal(v.vehicleClass, "cargo van");
  });

  test("rules 2-7 are never emitted by the live engine", () => {
    for (const cat of [...MAINT, "breakdown", "accident", "new_hire_awaiting_vehicle", "unknown_future_category"]) {
      const v = evaluate({ problemCategory: cat });
      assert.ok(v.rule === 1 || v.rule === 8, `${cat} → rule ${v.rule}`);
    }
  });
});
