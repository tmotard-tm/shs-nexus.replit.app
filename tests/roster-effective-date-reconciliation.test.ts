import test from "node:test";
import assert from "node:assert/strict";
import {
  futureTermEmployeeIds,
  reconcileRosterRows,
} from "../server/roster-effective-date-reconciliation";

type TestRosterRow = {
  EMPL_ID: string;
  ENTERPRISE_ID: string;
  EMPLOYMENT_STATUS: string;
  EFFDT?: string;
};

const active = (
  enterpriseId: string,
  effectiveDate?: string,
): TestRosterRow => ({
  EMPL_ID: "21024626642",
  ENTERPRISE_ID: enterpriseId,
  EMPLOYMENT_STATUS: "A",
  EFFDT: effectiveDate,
});

const terminated = (
  enterpriseId: string,
  effectiveDate?: string,
): TestRosterRow => ({
  EMPL_ID: "21024626642",
  ENTERPRISE_ID: enterpriseId,
  EMPLOYMENT_STATUS: "T",
  EFFDT: effectiveDate,
});

const winner = (rows: TestRosterRow[], asOf = new Date("2026-08-25T12:00:00Z")) =>
  reconcileRosterRows(rows, asOf)[0];

test("newer active rehire beats an older termination for the same employee", () => {
  assert.equal(
    winner([
      active("JBAILE2", "2026-08-16"),
      terminated("JBAILE0", "2025-12-27"),
    ]).ENTERPRISE_ID,
    "JBAILE2",
  );
});

test("already-effective newer termination beats an older active event", () => {
  assert.equal(
    winner([
      active("JBAILE2", "2026-01-10"),
      terminated("JBAILE2", "2026-08-20"),
    ]).EMPLOYMENT_STATUS,
    "T",
  );
});

test("future termination does not replace the current active event", () => {
  assert.equal(
    winner([
      active("JBAILE2", "2026-08-16"),
      terminated("JBAILE2", "2026-09-01"),
    ]).EMPLOYMENT_STATUS,
    "A",
  );
});

test("future termination IDs remain visible to the stale-roster sweep", () => {
  assert.deepEqual(
    futureTermEmployeeIds(
      [
        terminated(" JBAILE2 ", "2026-09-01"),
        terminated("JBAILE2", "2026-10-01"),
        terminated("PAST0", "2026-08-20"),
      ].map((row, index) => ({
        ...row,
        EMPL_ID: index < 2 ? " 21024626642 " : "99999999999",
      })),
      new Date("2026-08-25T12:00:00Z"),
    ),
    ["21024626642"],
  );
});

test("active wins an exact effective-date tie", () => {
  assert.equal(
    winner([
      terminated("JBAILE0", "2026-08-16"),
      active("JBAILE2", "2026-08-16"),
    ]).ENTERPRISE_ID,
    "JBAILE2",
  );
});

test("active wins when all effective dates are missing", () => {
  assert.equal(
    winner([
      terminated("JBAILE0"),
      active("JBAILE2"),
    ]).ENTERPRISE_ID,
    "JBAILE2",
  );
});

test("non-ISO dates are treated as missing instead of timezone-parsed", () => {
  assert.equal(
    winner([
      active("JBAILE2"),
      terminated("JBAILE0", "08/16/2026 23:30:00 -0700"),
    ]).ENTERPRISE_ID,
    "JBAILE2",
  );
});

test("ISO date-time values compare by their written date portion", () => {
  assert.equal(
    winner([
      active("JBAILE2", "2026-08-16T23:30:00-07:00"),
      terminated("JBAILE0", "2026-08-17T00:15:00+14:00"),
    ]).EMPLOYMENT_STATUS,
    "T",
  );
});

test("the same rows produce the same winner regardless of input order", () => {
  const first = active("JBAILE2", "2026-08-16");
  const second = active("JBAILE3", "2026-08-16");

  assert.deepEqual(
    winner([first, second]),
    winner([second, first]),
  );
});