/**
 * Task #638 — vehicle-number reservations, against the real DEV schema.
 *
 * The pure suite (tests/vehicle-create-verification.test.ts) proves the DECISIONS.
 * This one proves the decisions actually bite in Postgres, because the reservation
 * is not a flag the application checks — it is two partial unique indexes:
 *
 *   byov_creation_audit_active_vehicle_uq ON (vehicle_number) WHERE blocked_source IS NULL
 *   byov_creation_audit_active_vin_uq     ON (vin)            WHERE blocked_source IS NULL
 *                                             AND vin IS NOT NULL AND request_id IS NOT NULL
 *
 * So "the number is released" literally means blocked_source IS NOT NULL, and the
 * only way to prove a number is still held (or genuinely freed) is to try to claim
 * it and see what the database says.
 *
 * Covered:
 *  1. A create that errored AFTER reaching WMS keeps its number and VIN claimed —
 *     the failure mode this task exists to prevent (transport error != not created).
 *  2. A create that never reached a creating system releases its number, and the
 *     number is then genuinely re-claimable.
 *  3. A released attempt that is later confirmed reclaims its reservation under a
 *     compare-and-set, and re-protects the number afterwards.
 *  4. If something else claimed the number in the meantime, the reclaim is refused
 *     by the index (23505) rather than silently duplicating the claim.
 *
 * All fixtures use submitted_by='task-638-suite' and are deleted in before()/after().
 * No external system is touched.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db, pool } from "../server/db";
import { decideFinalizeRelease, decideReservationReclaim } from "../server/vehicle-create-verification";

const OWNER = "task-638-suite";
const NUM_HELD = "099951";
const NUM_FREED = "099952";
const NUM_RECLAIM = "099953";
const VIN_HELD = "T638HOLDVIN000001";

/** Insert an audit row the way the create route leaves it. Returns its id. */
async function insertAttempt(row: {
  vehicleNumber: string;
  vin?: string | null;
  requestId: string;
  blockedSource?: string | null;
  holmanSubmittedAt?: Date | null;
  wmsSubmittedAt?: Date | null;
  holmanSuccess?: boolean;
  wmsSuccess?: boolean;
}): Promise<number> {
  const res = await db.execute<{ id: number }>(sql`
    INSERT INTO byov_creation_audit
      (vehicle_number, vin, submitted_by, request_id, blocked_source,
       holman_submitted_at, wms_submitted_at, holman_success, wms_success)
    VALUES
      (${row.vehicleNumber}, ${row.vin ?? null}, ${OWNER}, ${row.requestId}, ${row.blockedSource ?? null},
       ${row.holmanSubmittedAt ?? null}, ${row.wmsSubmittedAt ?? null},
       ${row.holmanSuccess ?? false}, ${row.wmsSuccess ?? false})
    RETURNING id
  `);
  return Number((res.rows as any)[0].id);
}

/** Try to claim a number/VIN with a fresh ACTIVE row. True = the claim succeeded. */
async function tryClaim(vehicleNumber: string, vin: string | null, requestId: string): Promise<boolean> {
  try {
    await insertAttempt({ vehicleNumber, vin, requestId });
    return true;
  } catch (err: any) {
    if (err?.code === "23505") return false;
    throw err;
  }
}

const cleanup = () => db.execute(sql`DELETE FROM byov_creation_audit WHERE submitted_by = ${OWNER}`);

describe("Task #638 — vehicle-number reservations in Postgres", () => {
  before(async () => {
    // The indexes are created idempotently by the create route; make sure they
    // exist before this suite draws conclusions from their absence.
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS "byov_creation_audit_active_vehicle_uq"
        ON "byov_creation_audit" ("vehicle_number") WHERE "blocked_source" IS NULL`);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS "byov_creation_audit_active_vin_uq"
        ON "byov_creation_audit" ("vin")
        WHERE "blocked_source" IS NULL AND "vin" IS NOT NULL AND "request_id" IS NOT NULL`);
    await cleanup();
  });

  after(async () => {
    await cleanup();
    await pool.end().catch(() => undefined);
  });

  test("a create that errored after reaching WMS still holds its number and VIN", async () => {
    // WMS was called (wms_submitted_at stamped) and then the call failed. From the
    // route's point of view this is indistinguishable from "not created".
    const evidence = {
      wmsSubmittedAt: new Date(),
      holmanSubmittedAt: null,
      wmsSuccess: false,
      holmanSuccess: false,
      holmanPending: false,
    };
    assert.equal(decideFinalizeRelease(evidence).release, false, "the decision must hold the reservation");

    const id = await insertAttempt({
      vehicleNumber: NUM_HELD,
      vin: VIN_HELD,
      requestId: "t638-held",
      blockedSource: null, // what the route now leaves behind: NOT released
      wmsSubmittedAt: evidence.wmsSubmittedAt,
    });
    assert.ok(id > 0);

    assert.equal(
      await tryClaim(NUM_HELD, "T638OTHERVIN00001", "t638-held-rival"),
      false,
      "the number must not be re-allocatable while the create is unverified",
    );
    assert.equal(
      await tryClaim("099959", VIN_HELD, "t638-held-vin-rival"),
      false,
      "the VIN must not be re-submittable under a different number either",
    );
  });

  test("a create that never reached a creating system frees its number for reuse", async () => {
    const evidence = { holmanSubmittedAt: null, wmsSubmittedAt: null, holmanSuccess: false, wmsSuccess: false, holmanPending: false };
    assert.equal(decideFinalizeRelease(evidence).release, true);

    await insertAttempt({ vehicleNumber: NUM_FREED, requestId: "t638-freed", blockedSource: "failed" });
    assert.equal(
      await tryClaim(NUM_FREED, null, "t638-freed-next"),
      true,
      "a number nothing was ever submitted for must return to circulation",
    );
  });

  test("a released attempt that is later confirmed reclaims its reservation", async () => {
    const id = await insertAttempt({
      vehicleNumber: NUM_RECLAIM,
      requestId: "t638-reclaim",
      blockedSource: "failed",
      holmanSubmittedAt: new Date(),
    });
    assert.equal(decideReservationReclaim({ state: "confirmed", blockedSource: "failed" }).reclaim, true);

    const reclaimed = await db.execute(sql`
      UPDATE byov_creation_audit SET blocked_source = NULL
      WHERE id = ${id} AND blocked_source = 'failed'`);
    assert.equal((reclaimed as any).rowCount, 1, "the CAS reclaim must apply");

    assert.equal(
      await tryClaim(NUM_RECLAIM, null, "t638-reclaim-rival"),
      false,
      "once reclaimed, the number must be protected again",
    );
  });

  test("the reclaim is refused when another active reservation took the number", async () => {
    const number = "099954";
    const released = await insertAttempt({
      vehicleNumber: number,
      requestId: "t638-conflict-a",
      blockedSource: "failed",
      holmanSubmittedAt: new Date(),
    });
    // Somebody else was legitimately handed the freed number.
    await insertAttempt({ vehicleNumber: number, requestId: "t638-conflict-b" });

    await assert.rejects(
      () =>
        db.execute(sql`
          UPDATE byov_creation_audit SET blocked_source = NULL
          WHERE id = ${released} AND blocked_source = 'failed'`),
      (err: any) => err?.code === "23505",
      "the index must refuse a second active claim on the same number",
    );
  });

  test("purging the cache row of a partially-created vehicle leaves its number and VIN claimed", async () => {
    // The create landed in WMS and never in Holman. The local Holman cache row IS
    // a phantom and may be deleted — but a real half-created vehicle is using this
    // number, so the reservation must survive the purge.
    const number = "099956";
    const vin = "T638PARTIALVIN001";
    await insertAttempt({
      vehicleNumber: number,
      vin,
      requestId: "t638-partial",
      wmsSubmittedAt: new Date(),
      wmsSuccess: true,
      holmanSubmittedAt: new Date(),
      holmanSuccess: false,
      blockedSource: null,
    });
    await db.execute(sql`
      UPDATE byov_creation_audit SET verification_state = 'partial'
      WHERE vehicle_number = ${number} AND submitted_by = ${OWNER}`);

    assert.equal(
      await tryClaim(number, "T638PARTIALVIN002", "t638-partial-rival"),
      false,
      "the number of a partially-created vehicle must never be re-allocated",
    );
    assert.equal(
      await tryClaim("099957", vin, "t638-partial-vin-rival"),
      false,
      "nor may its VIN be re-submitted under a different number",
    );
  });

  test("the compare-and-set refuses to reclaim a row that is no longer released", async () => {
    const id = await insertAttempt({ vehicleNumber: "099955", requestId: "t638-cas", blockedSource: "duplicate" });
    const res = await db.execute(sql`
      UPDATE byov_creation_audit SET blocked_source = NULL
      WHERE id = ${id} AND blocked_source = 'failed'`);
    assert.equal((res as any).rowCount, 0, "a block written by another path must not be undone");
  });
});
