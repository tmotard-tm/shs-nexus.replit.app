/**
 * Integration tests for the Holman PO queue re-open rules
 * (upsertHolmanRentalPoQueue in server/vrm/holman-rental-po-storage.ts),
 * run against the DEV database.
 *
 * Incident these rules exist for (2026-08-03): two rental POs returned to
 * Holman's awaiting-authorization grid for a new authorization round at the
 * same $0.00 amount. The old upsert only re-opened a decided row on an amount
 * change, so both stayed invisible until the operator found them inside the
 * Holman portal himself.
 *
 * Every upsert here passes { sweepResolved: false } — the sweep infers
 * "resolved on Holman" from ABSENCE in the scraped set, and these tests scrape
 * only their own synthetic POs. Sweeping would retire REAL dev rows.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";

import { db, pool } from "../server/db.js";
import {
  upsertHolmanRentalPoQueue,
  HOLMAN_PO_REOPEN_GRACE_MINUTES,
} from "../server/vrm/holman-rental-po-storage.js";
import type { HolmanPortalPO } from "../server/holman-portal-service.js";

const PREFIX = "RPTEST-";

function mkPo(poNumber: string, over: Partial<HolmanPortalPO> = {}): HolmanPortalPO {
  return {
    key: `key-${poNumber}`,
    poNumber,
    repairNumber: `rep-${poNumber}`,
    vehicleNumber: "99999",
    driverName: "TEST, REOPEN",
    vendorName: "ENTERPRISE RENT-A-CAR INC.",
    division: "TEST",
    additionalRequestedAmt: 0,
    approvedAmount: 0,
    poDate: "07/30/2026",
    submittedDate: "07/30/2026",
    approvalProcess: "Rental",
    ...over,
  };
}

async function upsert(pos: HolmanPortalPO[], at: Date) {
  await upsertHolmanRentalPoQueue(pos, [], at, { sweepResolved: false });
}

async function getRow(poNumber: string): Promise<any> {
  const r = await db.execute(sql`
    SELECT status, approved_in_holman, holman_approve_error,
           reopen_count, reopened_at, reopened_from_status, reopen_reason,
           grid_last_seen_at, decided_at, last_synced_at, vendor_name
    FROM holman_rental_po_queue WHERE po_number = ${poNumber}
  `);
  return r.rows[0] ?? null;
}

/** Force a row into a decided state with a decision age in minutes. */
async function decide(poNumber: string, status: string, ageMinutes: number | null) {
  await db.execute(sql`
    UPDATE holman_rental_po_queue
    SET status = ${status},
        approved_in_holman = ${status === "approved"},
        decided_at = ${ageMinutes === null ? null : sql.raw(`NOW() - INTERVAL '${ageMinutes} minutes'`)},
        holman_approve_error = 'stale error from prior cycle'
    WHERE po_number = ${poNumber}
  `);
}

async function cleanup() {
  await db.execute(sql.raw(`DELETE FROM holman_rental_po_queue WHERE po_number LIKE '${PREFIX}%'`));
}

before(async () => {
  await cleanup();
});

after(async () => {
  await cleanup();
  await pool.end();
});

test("new PO inserts as pending with grid_last_seen_at stamped", async () => {
  const po = `${PREFIX}NEW`;
  const at = new Date();
  await upsert([mkPo(po)], at);
  const row = await getRow(po);
  assert.ok(row, "row inserted");
  assert.equal(row.status, "pending");
  assert.equal(Number(row.reopen_count), 0);
  assert.ok(row.grid_last_seen_at, "grid_last_seen_at set on insert");
});

test("freshly decided row inside the grace window stays decided but records the sighting", async () => {
  const po = `${PREFIX}FRESH`;
  await upsert([mkPo(po)], new Date(Date.now() - 60_000));
  await decide(po, "approved", 30); // well inside the 120-min grace
  const walkAt = new Date();
  await upsert([mkPo(po)], walkAt);
  const row = await getRow(po);
  assert.equal(row.status, "approved", "stays decided inside grace");
  assert.equal(row.approved_in_holman, true);
  assert.equal(Number(row.reopen_count), 0);
  // The batch stamp must record the sighting even though the row was frozen.
  assert.ok(row.grid_last_seen_at, "sighting recorded");
  assert.ok(
    new Date(row.grid_last_seen_at).getTime() >= walkAt.getTime() - 5_000,
    `grid_last_seen_at advanced to the walk (${row.grid_last_seen_at})`,
  );
});

test("decided row still on the grid past the grace window re-opens (holman_still_awaiting)", async () => {
  const po = `${PREFIX}STALE`;
  await upsert([mkPo(po)], new Date(Date.now() - 60_000));
  await decide(po, "approved", HOLMAN_PO_REOPEN_GRACE_MINUTES + 15);
  await upsert([mkPo(po)], new Date());
  const row = await getRow(po);
  assert.equal(row.status, "pending", "re-opened");
  assert.equal(row.approved_in_holman, false);
  assert.equal(Number(row.reopen_count), 1);
  assert.equal(row.reopened_from_status, "approved");
  assert.equal(row.reopen_reason, "holman_still_awaiting");
  assert.equal(row.holman_approve_error, null, "stale error cleared for the new cycle");
  assert.ok(row.reopened_at, "reopened_at stamped");
  assert.ok(row.decided_at, "prior decision timestamp preserved for the UI note");
});

test("re-submitted PO (new Submitted date) re-opens immediately, inside the grace window", async () => {
  const po = `${PREFIX}RESUB`;
  await upsert([mkPo(po)], new Date(Date.now() - 60_000));
  await decide(po, "approved", 20);
  await upsert([mkPo(po, { submittedDate: "08/03/2026" })], new Date());
  const row = await getRow(po);
  assert.equal(row.status, "pending");
  assert.equal(row.reopen_reason, "resubmitted");
  assert.equal(Number(row.reopen_count), 1);
});

test("amount change still re-opens immediately (pre-existing rule, now audited)", async () => {
  const po = `${PREFIX}AMT`;
  await upsert([mkPo(po)], new Date(Date.now() - 60_000));
  await decide(po, "denied", 20);
  await upsert([mkPo(po, { additionalRequestedAmt: 125.5 })], new Date());
  const row = await getRow(po);
  assert.equal(row.status, "pending");
  assert.equal(row.reopen_reason, "amount_changed");
  assert.equal(row.reopened_from_status, "denied");
});

test("resolved_holman row that reappears re-opens once its resolution is older than the grace", async () => {
  const po = `${PREFIX}RESOLVED`;
  await upsert([mkPo(po)], new Date(Date.now() - 60_000));
  await decide(po, "resolved_holman", null); // no decided_at, like real swept rows
  // Age the sweep stamp past the grace window.
  await db.execute(sql.raw(
    `UPDATE holman_rental_po_queue SET last_synced_at = NOW() - INTERVAL '${HOLMAN_PO_REOPEN_GRACE_MINUTES + 30} minutes' WHERE po_number = '${po}'`,
  ));
  await upsert([mkPo(po)], new Date());
  const row = await getRow(po);
  assert.equal(row.status, "pending", "reappeared resolved row re-opened");
  assert.equal(row.reopened_from_status, "resolved_holman");
  assert.equal(row.reopen_reason, "holman_still_awaiting");
});

test("actionable rows keep flowing: fields refresh, status untouched, no reopen audit", async () => {
  const po = `${PREFIX}BLOCKED`;
  await upsert([mkPo(po)], new Date(Date.now() - 60_000));
  await db.execute(sql`
    UPDATE holman_rental_po_queue SET status = 'blocked' WHERE po_number = ${po}
  `);
  await upsert([mkPo(po, { vendorName: "ENTERPRISE RENT-A-CAR (NEW NAME)" })], new Date());
  const row = await getRow(po);
  assert.equal(row.status, "blocked", "actionable status preserved");
  assert.equal(row.vendor_name, "ENTERPRISE RENT-A-CAR (NEW NAME)", "scraped fields refreshed");
  assert.equal(Number(row.reopen_count), 0);
  assert.equal(row.reopen_reason, null);
});
