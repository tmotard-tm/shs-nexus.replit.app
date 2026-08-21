/**
 * Settle-persistence integration test (out-of-service submissions).
 *
 * Guards the settle-persistence gap: a verified out-of-service submission
 * must end up status='completed' IN THE DATABASE — not merely produce a
 * "completed" verdict in memory while the row stays 'pending'. A stale
 * pending row is re-verified by every 90s sweep and keeps the --report mode
 * claiming the write is still in flight.
 *
 * Hits the real dev Postgres through verifyFromFleetData, which is pure
 * DB + in-memory fleet batch (no live Holman calls — the passive verifier is
 * exactly the path a nightly-batch-applied OOS change settles through).
 * Uses test-prefixed vehicle numbers so a failed run cannot stomp real
 * fleet data. Cleans up after itself.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

import { db } from "../server/db.js";
import { holmanSubmissions } from "../shared/schema.js";
import { holmanSubmissionService } from "../server/holman-submission-service.js";

const TRUCK_APPLIED = "_t663_oos_applied";
const TRUCK_INFLIGHT = "_t663_oos_inflight";

async function cleanup() {
  await db.delete(holmanSubmissions).where(eq(holmanSubmissions.holmanVehicleNumber, TRUCK_APPLIED));
  await db.delete(holmanSubmissions).where(eq(holmanSubmissions.holmanVehicleNumber, TRUCK_INFLIGHT));
}

before(cleanup);
after(cleanup);

test("verified OOS submission is persisted as status='completed' in the DB, not left 'pending'", async () => {
  const sub = await holmanSubmissionService.createSubmission({
    holmanVehicleNumber: TRUCK_APPLIED,
    action: "out_of_service",
    payload: { holmanVehicleNumber: TRUCK_APPLIED, assetAction: "UPDATE", outOfServiceDate: "08/01/2026" },
    createdBy: "test:t663",
  });
  assert.equal(sub.status, "pending", "submission must start pending (202 = queued, never applied)");

  // Simulate the fleet sync delivering the applied record. statusCode is
  // deliberately NULL here — Holman nulls it once the vehicle leaves the
  // active projection, so the durable outOfServiceDate signal must be what
  // settles the row (isOutOfServiceRecord semantics).
  await holmanSubmissionService.verifyFromFleetData([
    { holmanVehicleNumber: TRUCK_APPLIED, statusCode: null, outOfServiceDate: "2026-08-01" },
  ]);

  const [row] = await db.select().from(holmanSubmissions).where(eq(holmanSubmissions.id, sub.id));
  assert.equal(
    row?.status,
    "completed",
    "verified OOS submission must be PERSISTED as completed — a 'pending' row here is the settle-persistence gap",
  );
  assert.ok(row?.completedAt instanceof Date, "completedAt must be stamped when the settle persists");
  assert.ok(row?.lastCheckedAt instanceof Date, "lastCheckedAt must be stamped by the settle write");
});

test("still-in-flight OOS submission intentionally stays 'pending' (non-terminal verdict must not settle)", async () => {
  const sub = await holmanSubmissionService.createSubmission({
    holmanVehicleNumber: TRUCK_INFLIGHT,
    action: "out_of_service",
    payload: { holmanVehicleNumber: TRUCK_INFLIGHT, assetAction: "UPDATE", outOfServiceDate: "08/01/2026" },
    createdBy: "test:t663",
  });

  // Fleet sync still shows the truck active — Holman hasn't run its nightly
  // batch yet. The row must remain pending so a later sync can settle it.
  await holmanSubmissionService.verifyFromFleetData([
    { holmanVehicleNumber: TRUCK_INFLIGHT, statusCode: 1, outOfServiceDate: null },
  ]);

  const [row] = await db.select().from(holmanSubmissions).where(eq(holmanSubmissions.id, sub.id));
  assert.equal(row?.status, "pending", "an unapplied OOS submission must stay pending — never settle on a non-terminal verdict");
  assert.equal(row?.completedAt, null, "completedAt must not be stamped while in flight");
});

test("a FUTURE outOfServiceDate does not settle the submission (scheduled, not yet effective)", async () => {
  const sub = await holmanSubmissionService.createSubmission({
    holmanVehicleNumber: TRUCK_INFLIGHT,
    action: "out_of_service",
    payload: { holmanVehicleNumber: TRUCK_INFLIGHT, assetAction: "UPDATE", outOfServiceDate: "01/01/2100" },
    createdBy: "test:t663",
  });

  await holmanSubmissionService.verifyFromFleetData([
    { holmanVehicleNumber: TRUCK_INFLIGHT, statusCode: null, outOfServiceDate: "2100-01-01" },
  ]);

  const [row] = await db.select().from(holmanSubmissions).where(eq(holmanSubmissions.id, sub.id));
  assert.equal(row?.status, "pending", "a future-dated OOS record is not yet effective and must not settle the row");
});

/* Force-exit after all tests + cleanup hooks complete: the Neon/postgres
 * connection pool keeps the event loop alive after tests finish. Preserve
 * exitCode so a failing run still exits non-zero. */
after(() => { setImmediate(() => process.exit(process.exitCode ?? 0)); });
