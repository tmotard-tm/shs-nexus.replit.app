/**
 * Truck Maintenance workflow — DB-backed suite (DEV database).
 *
 * Exercises the constraints that ARE the workflow's safety, against the real
 * Postgres schema (initTruckMaintenanceSchema runs first, so this suite is
 * also the first executable proof the boot DDL applies cleanly):
 *
 *  1. Partial unique index on open cycles — a truck can never have two cycles
 *     in flight, so a re-run, a restart, or two replicas racing can't text a
 *     technician twice for the same 5,500 miles.
 *  2. Watermark seeding is ON CONFLICT DO NOTHING — a restart never resets a
 *     truck's progress toward its next service.
 *  3. advanceWatermark uses GREATEST — the watermark never moves backwards,
 *     whatever the reading at booking time says.
 *  4. A closed cycle frees the truck for its NEXT cycle.
 *  5. retryCycle refuses to re-fire a filing that already landed.
 *  6. The kill switch persists and defaults to "not paused".
 *
 * All fixtures use ZZMAINT* truck numbers and are deleted in before()/after().
 * NO external system is touched: no AMS, no TPMS, no Twilio, no Event Request.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { sql } from "drizzle-orm";

import { db, pool } from "../server/db";
import { buildStandardActivityPayload } from "../server/vrm/dca-task-client";
import { classifyEligibility, resolveTechRacf } from "../server/truck-maintenance/eligibility";
import {
  TEXT_CLAIM_STALE_MS,
  advanceWatermark,
  claimBooking,
  classifyBookingResult,
  clearExclusion,
  isCycleOpeningPaused,
  listStaleBlockedCycles,
  loadWatermarks,
  markExcluded,
  openCycle,
  reconcileStaleBookingClaim,
  markBookingUnknown,
  reconcileStalePendingText,
  recordTestFiling,
  runMaintenanceSweepTick,
  runTextStep,
  retryCycle,
  seedWatermark,
  seedWatermarks,
  setCycleOpeningPaused,
  todayInET,
  getSetting,
  setSetting,
  SETTING_LAST_SWEEP_DATE,
  type CycleRow,
} from "../server/truck-maintenance/engine";
import { registerTruckMaintenanceRoutes } from "../server/truck-maintenance/routes";
import { initTruckMaintenanceSchema } from "../server/truck-maintenance/schema-init";
import type { TruckCandidate } from "../server/truck-maintenance/eligibility";

const PREFIX = "ZZMAINT";
const TRUCK_A = `${PREFIX}01`;

const TRUCK_B = `${PREFIX}02`;
const TRUCK_C = `${PREFIX}03`;

function candidate(truckNumber: string, odometer: number): TruckCandidate {
  return {
    truckNumber,
    displayNumber: truckNumber,
    vin: `VINZZ${truckNumber}`,
    odometer,
    odometerDate: "2026-08-17",
    odometerSource: "test",
  };
}

const TEST_LDAP = "ZZMAINTTECH";
const RACF_ACTIVE = "ZZMAINTACT";
const RACF_TERMED = "ZZMAINTTRM";
const TEST_THREAD = "zzmaint-test-thread";

async function cleanup(): Promise<void> {
  await db.execute(sql`DELETE FROM fs_truck_maintenance_cycles WHERE truck_number LIKE ${PREFIX + "%"}`);
  await db.execute(sql`DELETE FROM fs_truck_maintenance_watermarks WHERE truck_number LIKE ${PREFIX + "%"}`);
  await db.execute(sql`DELETE FROM fs_comms_messages WHERE thread_id = ${TEST_THREAD}`);
  await db.execute(sql`DELETE FROM all_techs WHERE tech_racfid IN (${RACF_ACTIVE}, ${RACF_TERMED})`);
}

async function fetchRow(cycleId: number): Promise<CycleRow> {
  const r: any = await db.execute(sql`SELECT * FROM fs_truck_maintenance_cycles WHERE id = ${cycleId}`);
  return (r.rows ?? [])[0] as CycleRow;
}

/** Minimal facts for the pure gate; the RACF pair is what each test varies. */
function factsFor(racf: string | null | undefined, employmentStatus: string | null | undefined) {
  return {
    truckNumber: TRUCK_A,
    vin: null,
    techLdap: TEST_LDAP,
    techName: "Maintenance Fixture",
    district: "3132",
    isByov: false,
    amsStatusLabel: "Active",
    amsInRepair: false,
    techInRental: false,
    phoneDigits: "5551234567",
    contactExists: true,
    optedOut: false,
    techRacf: racf,
    employmentStatus,
  };
}

/** Put a cycle in the exact state a process crash mid-send leaves behind. */
async function strandSendClaim(cycleId: number, body: string, ageMs: number): Promise<CycleRow> {
  await db.execute(sql`
    UPDATE fs_truck_maintenance_cycles
       SET ldap = ${TEST_LDAP}, text_status = 'pending', text_body = ${body},
           text_claimed_at = now() - (${Math.round(ageMs / 1000)}::text || ' seconds')::interval,
           texted_at = NULL, status = 'open'
     WHERE id = ${cycleId}
  `);
  return fetchRow(cycleId);
}

/** Put a cycle in the exact state a process crash mid-filing leaves behind. */
async function strandBookingClaim(
  cycleId: number,
  args: { date: string; attempted: boolean; ageMs: number },
): Promise<CycleRow> {
  await db.execute(sql`
    UPDATE fs_truck_maintenance_cycles
       SET booking_status = 'pending', booking_date = ${args.date}::date,
           booking_claimed_at = now() - (${Math.round(args.ageMs / 1000)}::text || ' seconds')::interval,
           booking_attempted_at = ${args.attempted ? sql`now()` : sql`NULL`},
           booked_at = NULL, closed_at = NULL
     WHERE id = ${cycleId}
  `);
  return fetchRow(cycleId);
}

/** The name the upstream duplicate guard matches on. */
function projectNameFor(date: string, truckNumber: string): string {
  return buildStandardActivityPayload({
    techLdap: "ZZRACF",
    unit: "1234",
    truckNumber,
    date,
    durationMinutes: 240,
    startTime: "08:00",
    projectLabel: "Truck Maintenance",
    live: true,
  }).projectName;
}

describe("truck maintenance — database guarantees", () => {
  before(async () => {
    await initTruckMaintenanceSchema();
    await cleanup();
  });

  after(async () => {
    await cleanup();
    await pool.end();
  });

  test("boot DDL is idempotent", async () => {
    // Re-running the init must not throw — it runs on every boot.
    const { resetTruckMaintenanceSchemaInitFlag } = await import("../server/truck-maintenance/schema-init");
    resetTruckMaintenanceSchemaInitFlag();
    await initTruckMaintenanceSchema();
  });

  test("a watermark is seeded once and never re-seeded", async () => {
    const first = await seedWatermark(candidate(TRUCK_A, 100_000));
    assert.equal(first, true, "first sight seeds the watermark");

    // A later sweep sees a higher odometer — seeding must NOT overwrite, or the
    // truck would never accumulate mileage toward its next service.
    const second = await seedWatermark(candidate(TRUCK_A, 104_000));
    assert.equal(second, false, "an existing watermark is never re-seeded");

    const watermarks = await loadWatermarks();
    assert.equal(watermarks.get(TRUCK_A)?.lastServiceOdometer, 100_000);
    assert.equal(watermarks.get(TRUCK_A)?.source, "seed");
  });

  test("bulk seeding skips trucks that already have a watermark", async () => {
    // The path the real sweep uses: the whole fleet in chunked multi-row
    // inserts. TRUCK_A is already seeded, so only TRUCK_B is new — and
    // TRUCK_A's existing value must survive untouched.
    const seeded = await seedWatermarks([
      candidate(TRUCK_A, 999_99), // already seeded at 100,000 — must be skipped
      candidate(TRUCK_B, 50_000),
    ]);
    assert.equal(seeded, 1, "only the unseeded truck is inserted");

    const watermarks = await loadWatermarks();
    assert.equal(watermarks.get(TRUCK_A)?.lastServiceOdometer, 100_000, "existing watermark untouched");
    assert.equal(watermarks.get(TRUCK_B)?.lastServiceOdometer, 50_000);
  });

  test("only one cycle per truck can be open at a time", async () => {
    const first = await openCycle({ candidate: candidate(TRUCK_A, 105_600), watermark: 100_000 });
    assert.ok(first, "the first cycle opens");

    // The idempotency guarantee: a re-run of the sweep, a restart, or a second
    // replica must all lose to the partial unique index.
    const second = await openCycle({ candidate: candidate(TRUCK_A, 105_800), watermark: 100_000 });
    assert.equal(second, null, "a second open cycle for the same truck is rejected");

    const rows: any = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM fs_truck_maintenance_cycles
       WHERE truck_number = ${TRUCK_A} AND closed_at IS NULL
    `);
    assert.equal((rows.rows ?? [])[0]?.n, 1);
  });

  test("the open cycle records the odometer facts a human needs", async () => {
    const rows: any = await db.execute(sql`
      SELECT odometer_at_trigger, watermark_at_trigger, miles_since_watermark, status, odometer_source
        FROM fs_truck_maintenance_cycles
       WHERE truck_number = ${TRUCK_A} AND closed_at IS NULL
    `);
    const row = (rows.rows ?? [])[0];
    assert.equal(row.odometer_at_trigger, 105_600);
    assert.equal(row.watermark_at_trigger, 100_000);
    assert.equal(row.miles_since_watermark, 5_600);
    assert.equal(row.status, "open");
    assert.equal(row.odometer_source, "test");
  });

  test("a different truck opens its own cycle independently", async () => {
    await seedWatermark(candidate(TRUCK_B, 50_000));
    const id = await openCycle({ candidate: candidate(TRUCK_B, 55_500), watermark: 50_000 });
    assert.ok(id, "the guard is per-truck, not global");
  });

  test("closing a cycle advances the watermark and frees the truck for the next one", async () => {
    const rows: any = await db.execute(sql`
      SELECT id FROM fs_truck_maintenance_cycles WHERE truck_number = ${TRUCK_A} AND closed_at IS NULL
    `);
    const cycleId = (rows.rows ?? [])[0].id;

    await db.execute(sql`
      UPDATE fs_truck_maintenance_cycles
         SET status = 'booked', booking_status = 'filed_live', booked_at = now(), closed_at = now()
       WHERE id = ${cycleId}
    `);
    await advanceWatermark({ truckNumber: TRUCK_A, vin: null, newValue: 105_900, cycleId });

    const watermarks = await loadWatermarks();
    assert.equal(watermarks.get(TRUCK_A)?.lastServiceOdometer, 105_900);
    assert.equal(watermarks.get(TRUCK_A)?.source, "cycle_booked");

    // With the old cycle closed, the truck's NEXT interval can open a cycle.
    const next = await openCycle({ candidate: candidate(TRUCK_A, 111_400), watermark: 105_900 });
    assert.ok(next, "a closed cycle frees the one-open-cycle lock");
  });

  test("the watermark never moves backwards, even when told to", async () => {
    await advanceWatermark({ truckNumber: TRUCK_A, vin: null, newValue: 40_000, cycleId: 0 });
    const watermarks = await loadWatermarks();
    assert.equal(
      watermarks.get(TRUCK_A)?.lastServiceOdometer,
      105_900,
      "GREATEST() must reject a lower value",
    );
  });

  test("a cycle whose block already landed is never re-fired", async () => {
    const rows: any = await db.execute(sql`
      SELECT id FROM fs_truck_maintenance_cycles WHERE truck_number = ${TRUCK_A} AND closed_at IS NULL
    `);
    const cycleId = (rows.rows ?? [])[0].id;

    // Simulate a filing that landed upstream but whose cycle is still open.
    await db.execute(sql`
      UPDATE fs_truck_maintenance_cycles
         SET status = 'texted', texted_at = now(), booking_status = 'filed_live'
       WHERE id = ${cycleId}
    `);

    const result = await retryCycle(cycleId);
    assert.equal(result.ok, false);
    assert.match(String(result.error), /already has a filed block/);
  });

  test("retrying a closed cycle is refused", async () => {
    const rows: any = await db.execute(sql`
      SELECT id FROM fs_truck_maintenance_cycles
       WHERE truck_number = ${TRUCK_A} AND closed_at IS NOT NULL LIMIT 1
    `);
    const cycleId = (rows.rows ?? [])[0].id;
    const result = await retryCycle(cycleId);
    assert.equal(result.ok, false);
    assert.match(String(result.error), /closed/);
  });


  /* ----------------------------------------------------------------------- *
   * Crash recovery: a send claim orphaned mid-flight
   * ----------------------------------------------------------------------- */

  test("an orphaned send claim is released when nothing reached the comms lane", async () => {
    // TRUCK_B's cycle is already open from the per-truck independence test.
    const existing: any = await db.execute(sql`
      SELECT id FROM fs_truck_maintenance_cycles WHERE truck_number = ${TRUCK_B} AND closed_at IS NULL
    `);
    const cycleId = ((existing.rows ?? [])[0]?.id as number | undefined)
      ?? (await openCycle({ candidate: candidate(TRUCK_B, 55_600), watermark: 50_000 }));
    assert.ok(cycleId, "fixture cycle is open");

    // The exact wreckage a process crash between the CAS claim and the send
    // outcome leaves behind. Before this recovery existed the cycle was fatal:
    // the send CAS rejects 'pending' and so does retry, so the truck would
    // never text and never book.
    const stranded = await strandSendClaim(cycleId!, "ZZ maintenance body A", TEXT_CLAIM_STALE_MS + 60_000);
    const recovery = await reconcileStalePendingText(stranded);
    assert.equal(recovery.action, "released");

    const after = await fetchRow(cycleId!);
    assert.equal(after.text_status, null, "the claim is cleared so the next sweep can retake it");
    assert.equal(after.text_claimed_at, null);
    assert.equal(after.texted_at, null, "releasing a claim must never fake a delivery");
  });

  test("an orphaned claim adopts the message that DID reach the comms lane", async () => {
    const rows: any = await db.execute(sql`
      SELECT id FROM fs_truck_maintenance_cycles WHERE truck_number = ${TRUCK_B} AND closed_at IS NULL
    `);
    const cycleId = (rows.rows ?? [])[0].id as number;
    const body = "ZZ maintenance body B";

    // The dangerous half: the crash happened AFTER the text went out. Re-sending
    // would text a real technician twice, so the evidence in the comms lane is
    // adopted instead.
    await db.execute(sql`
      INSERT INTO fs_comms_messages (thread_id, ldap, category, direction, body, status)
      VALUES (${TEST_THREAD}, ${TEST_LDAP}, 'truck_maintenance', 'outbound', ${body}, 'sent')
    `);

    const stranded = await strandSendClaim(cycleId, body, TEXT_CLAIM_STALE_MS + 60_000);
    const recovery = await reconcileStalePendingText(stranded);
    assert.equal(recovery.action, "adopted");

    const after = await fetchRow(cycleId);
    assert.equal(after.status, "texted");
    assert.equal(after.text_status, "sent");
    assert.ok(after.texted_at, "the cycle adopts the real send time");
    assert.ok(after.text_message_id, "and the real message id");
    assert.ok(after.booking_due_at, "so the booking clock starts from the text that actually went out");
    assert.equal(after.text_claimed_at, null);
  });

  test("a claim taken moments ago is never raced", async () => {
    const rows: any = await db.execute(sql`
      SELECT id FROM fs_truck_maintenance_cycles WHERE truck_number = ${TRUCK_B} AND closed_at IS NULL
    `);
    const cycleId = (rows.rows ?? [])[0].id as number;

    const fresh = await strandSendClaim(cycleId, "ZZ maintenance body C", 30_000);
    const recovery = await reconcileStalePendingText(fresh);
    assert.equal(recovery.action, "in_flight", "a live send must not be clobbered");

    const after = await fetchRow(cycleId);
    assert.equal(after.text_status, "pending", "the in-flight claim is left exactly as it was");

    // An operator retrying at the same moment is told to wait, not raced.
    const retry = await retryCycle(cycleId);
    assert.equal(retry.ok, false);
    assert.match(String(retry.error), /in flight/);
  });


  /* ----------------------------------------------------------------------- *
   * Booking safety: never file a second, uncancellable block
   * ----------------------------------------------------------------------- */

  test("a retry days later files under the ORIGINAL date, not a new one", async () => {
    const rows: any = await db.execute(sql`
      SELECT id FROM fs_truck_maintenance_cycles WHERE truck_number = ${TRUCK_B} AND closed_at IS NULL
    `);
    const cycleId = (rows.rows ?? [])[0].id as number;

    // A request went out on the 14th and came back 500. The operator retries on
    // the 18th. If the date were recomputed the project name would change, the
    // upstream 409 would not recognise it, and the tech would get a SECOND
    // 4-hour block that no API can cancel.
    await db.execute(sql`
      UPDATE fs_truck_maintenance_cycles
         SET booking_status = 'failed', booking_date = '2026-08-14'::date, booking_attempted_at = now()
       WHERE id = ${cycleId}
    `);

    const claimed = await claimBooking(cycleId, "2026-08-18");
    assert.ok(claimed);
    assert.equal(claimed!.date, "2026-08-14", "the date is frozen at first wire contact");
    assert.equal(claimed!.frozen, true);
    assert.equal(
      projectNameFor(claimed!.date, TRUCK_B),
      projectNameFor("2026-08-14", TRUCK_B),
      "so the retry carries the same project name the first attempt used",
    );
    assert.notEqual(projectNameFor("2026-08-18", TRUCK_B), projectNameFor("2026-08-14", TRUCK_B));

    const after = await fetchRow(cycleId);
    assert.equal(String(after.booking_date).slice(0, 10), "2026-08-14", "and the stored date is not overwritten");
  });

  test("a date claimed but never sent is free to move", async () => {
    const rows: any = await db.execute(sql`
      SELECT id FROM fs_truck_maintenance_cycles WHERE truck_number = ${TRUCK_B} AND closed_at IS NULL
    `);
    const cycleId = (rows.rows ?? [])[0].id as number;
    await db.execute(sql`
      UPDATE fs_truck_maintenance_cycles
         SET booking_status = 'dry_run', booking_date = '2026-08-14'::date, booking_attempted_at = NULL
       WHERE id = ${cycleId}
    `);

    const claimed = await claimBooking(cycleId, "2026-08-19");
    assert.equal(claimed?.date, "2026-08-19", "nothing upstream can collide with it yet");
    assert.equal(claimed?.frozen, false);
  });

  test("a crashed filing that never reached the wire is released", async () => {
    const rows: any = await db.execute(sql`
      SELECT id FROM fs_truck_maintenance_cycles WHERE truck_number = ${TRUCK_B} AND closed_at IS NULL
    `);
    const cycleId = (rows.rows ?? [])[0].id as number;

    const stranded = await strandBookingClaim(cycleId, {
      date: "2026-08-18",
      attempted: false,
      ageMs: TEXT_CLAIM_STALE_MS + 60_000,
    });
    const recovery = await reconcileStaleBookingClaim(stranded);
    assert.equal(recovery.action, "released");

    const after = await fetchRow(cycleId);
    assert.equal(after.booking_status, null, "a claim that sent nothing must not strand the truck");
    assert.equal(after.booking_claimed_at, null);
  });

  test("a crashed filing that DID reach the wire is parked, never re-fired", async () => {
    const rows: any = await db.execute(sql`
      SELECT id FROM fs_truck_maintenance_cycles WHERE truck_number = ${TRUCK_B} AND closed_at IS NULL
    `);
    const cycleId = (rows.rows ?? [])[0].id as number;

    const stranded = await strandBookingClaim(cycleId, {
      date: "2026-08-18",
      attempted: true,
      ageMs: TEXT_CLAIM_STALE_MS + 60_000,
    });
    const recovery = await reconcileStaleBookingClaim(stranded);
    assert.equal(recovery.action, "adopted", "the request may exist upstream — a human confirms it");

    const after = await fetchRow(cycleId);
    assert.equal(after.booking_status, "unknown");
    assert.equal(after.status, "needs_review");

    // Neither path may re-fire it: not the sweep's claim, not an operator.
    assert.equal(await claimBooking(cycleId, "2026-08-19"), null, "the sweep cannot retake it");
    const retry = await retryCycle(cycleId);
    assert.equal(retry.ok, false);
    assert.match(String(retry.error), /confirm with DCA/i);
  });

  test("a filing claimed moments ago is never raced", async () => {
    const rows: any = await db.execute(sql`
      SELECT id FROM fs_truck_maintenance_cycles WHERE truck_number = ${TRUCK_B} AND closed_at IS NULL
    `);
    const cycleId = (rows.rows ?? [])[0].id as number;

    const fresh = await strandBookingClaim(cycleId, { date: "2026-08-18", attempted: true, ageMs: 30_000 });
    const recovery = await reconcileStaleBookingClaim(fresh);
    assert.equal(recovery.action, "in_flight");

    const after = await fetchRow(cycleId);
    assert.equal(after.booking_status, "pending", "a live filing is left exactly as it was");

    const retry = await retryCycle(cycleId);
    assert.equal(retry.ok, false);
    assert.match(String(retry.error), /in flight/);
  });



  test("a filing lost to a transport error can never be re-fired", async () => {
    const rows: any = await db.execute(sql`
      SELECT id FROM fs_truck_maintenance_cycles WHERE truck_number = ${TRUCK_B} AND closed_at IS NULL
    `);
    const cycleId = (rows.rows ?? [])[0].id as number;
    await db.execute(sql`
      UPDATE fs_truck_maintenance_cycles
         SET booking_status = NULL, booking_date = '2026-08-18'::date, booking_claimed_at = now(),
             booking_attempted_at = now(), status = 'texted'
       WHERE id = ${cycleId}
    `);

    // Exactly what sendStandardActivity returns when fetch throws: it catches
    // the error, so the engine sees a normal result with no HTTP status.
    const networkError = {
      ok: false,
      retryable: true,
      projectId: null,
      projectName: `TruckMaint ${TRUCK_B} 081826`,
      httpStatus: null,
      errorMessage: "network error: ECONNRESET",
      payload: { note: "fixture" },
    };
    const verdict = classifyBookingResult(networkError as any);
    assert.equal(verdict, "unknown", "the connection died — the block may exist upstream");

    await markBookingUnknown(cycleId, {
      detail: `${networkError.errorMessage} — upstream result unknown, confirm with DCA before re-filing`,
      projectName: networkError.projectName,
      payload: networkError.payload,
    });

    const parked = await fetchRow(cycleId);
    assert.equal(parked.booking_status, "unknown");
    assert.equal(parked.status, "needs_review");
    assert.equal(parked.booking_project_name, networkError.projectName, "the name a human needs to search DCA for");

    // Neither the sweep nor an operator may send a second one.
    assert.equal(await claimBooking(cycleId, "2026-08-19"), null, "the sweep cannot retake it");
    const retry = await retryCycle(cycleId);
    assert.equal(retry.ok, false);
    assert.match(String(retry.error), /confirm with DCA/i);

    await db.execute(sql`
      UPDATE fs_truck_maintenance_cycles
         SET booking_status = NULL, booking_date = NULL, booking_claimed_at = NULL,
             booking_attempted_at = NULL, booking_project_name = NULL, status = 'texted'
       WHERE id = ${cycleId}
    `);
  });

  /* ----------------------------------------------------------------------- *
   * The TEST hatch must never sabotage the real booking
   * ----------------------------------------------------------------------- */

  test("a TEST filing leaves the real booking free to file on its own date", async () => {
    const rows: any = await db.execute(sql`
      SELECT id FROM fs_truck_maintenance_cycles WHERE truck_number = ${TRUCK_B} AND closed_at IS NULL
    `);
    const cycleId = (rows.rows ?? [])[0].id as number;
    await db.execute(sql`
      UPDATE fs_truck_maintenance_cycles
         SET booking_status = NULL, booking_date = NULL, booking_claimed_at = NULL,
             booking_attempted_at = NULL, status = 'texted'
       WHERE id = ${cycleId}
    `);

    await recordTestFiling(cycleId, {
      status: "filed_test",
      detail: "TEST filing accepted (TEST TruckMaint)",
      projectName: "TEST TruckMaint",
    });

    const afterTest = await fetchRow(cycleId);
    assert.equal(afterTest.booking_test_status, "filed_test", "the TEST result is recorded...");
    assert.equal(afterTest.booking_status, null, "...but the production booking is untouched");
    assert.equal(afterTest.booking_attempted_at, null, "no production attempt was made");
    assert.equal(afterTest.status, "texted", "and the cycle is still waiting to be booked");

    // The real filing days later gets a real date — not the TEST's, and it is
    // not frozen by a TEST that produced a differently-named upstream row.
    const claimed = await claimBooking(cycleId, "2026-08-19");
    assert.equal(claimed?.date, "2026-08-19");
    assert.equal(claimed?.frozen, false);

    await db.execute(sql`
      UPDATE fs_truck_maintenance_cycles
         SET booking_status = NULL, booking_date = NULL, booking_claimed_at = NULL
       WHERE id = ${cycleId}
    `);
  });

  /* ----------------------------------------------------------------------- *
   * Filing identity is resolved BEFORE the text
   * ----------------------------------------------------------------------- */

  test("RACF and employment status come from all_techs and gate the send", async () => {
    await db.execute(sql`
      INSERT INTO all_techs (employee_id, tech_racfid, tech_name, employment_status)
      VALUES (${"ZZ900001"}, ${RACF_ACTIVE}, ${"Active Fixture"}, ${"A"}),
             (${"ZZ900002"}, ${RACF_TERMED}, ${"Termed Fixture"}, ${"T"})
    `);

    const active = await resolveTechRacf(RACF_ACTIVE.toLowerCase());
    assert.equal(active.racf, RACF_ACTIVE, "lookup is case-insensitive");
    assert.equal(active.employmentStatus, "A");
    assert.equal(active.error, null);
    assert.equal(classifyEligibility(factsFor(active.racf, active.employmentStatus)).eligible, true);

    const termed = await resolveTechRacf(RACF_TERMED);
    const termedVerdict = classifyEligibility(factsFor(termed.racf, termed.employmentStatus));
    assert.equal(termedVerdict.eligible, false, "a departed technician is excluded before any SMS");
    assert.equal(termedVerdict.code, "no_racf");

    // Nobody by that name: absent, not merely inactive — and still no text.
    const missing = await resolveTechRacf("ZZNOSUCHTECH");
    assert.equal(missing.racf, null);
    assert.equal(missing.error, null, "an empty result is absence, not a failure");
    const missingVerdict = classifyEligibility(factsFor(missing.racf, missing.employmentStatus));
    assert.equal(missingVerdict.eligible, false);
    assert.equal(missingVerdict.code, "no_racf");

    // And the exclusion is storable/visible like any other reason, on a cycle
    // that never reaches the send path.
    const cycleId = await openCycle({ candidate: candidate(TRUCK_C, 40_000), watermark: 34_000 });
    assert.ok(cycleId);
    await db.execute(sql`
      UPDATE fs_truck_maintenance_cycles
         SET status = 'excluded', exclusion_reason = ${missingVerdict.code},
             exclusion_detail = ${missingVerdict.detail}, closed_at = now()
       WHERE id = ${cycleId}
    `);
    const stored = await fetchRow(cycleId!);
    assert.equal(stored.exclusion_reason, "no_racf");
    assert.equal(stored.text_status, null, "an excluded cycle never queues a text");
  });

  /* ----------------------------------------------------------------------- *
   * The blocked-since clock (Task #674)
   *
   * Cycles blocked while a truck sits in the shop are re-evaluated every
   * sweep — correct, but eligibility_checked_at reads "just now" forever.
   * exclusion_since is the durable clock: it survives same-reason re-marks,
   * resets on a reason change, and clears with the exclusion.
   * ----------------------------------------------------------------------- */

  test("re-marking the SAME exclusion reason preserves the blocked-since clock", async () => {
    const cycleId = await openCycle({ candidate: candidate(TRUCK_C, 46_000), watermark: 40_000 });
    assert.ok(cycleId, "fixture cycle opened");
    const cycle = await fetchRow(cycleId!);

    await markExcluded(cycle, "ams_blocked", "Waiting Estimate From Shop");
    const first = await fetchRow(cycleId!);
    assert.ok(first.exclusion_since, "the first exclusion starts the clock");

    // Age the clock so a preserved value is distinguishable from a re-stamp.
    await db.execute(sql`
      UPDATE fs_truck_maintenance_cycles
         SET exclusion_since = now() - interval '30 days'
       WHERE id = ${cycleId}
    `);
    const aged = await fetchRow(cycleId!);

    // The next sweep re-marks the same reason — the clock must NOT reset.
    await markExcluded(aged, "ams_blocked", "Waiting Estimate From Shop (still)");
    const after = await fetchRow(cycleId!);
    assert.equal(
      new Date(after.exclusion_since as any).getTime(),
      new Date(aged.exclusion_since as any).getTime(),
      "same reason on a later sweep keeps the original blocked-since",
    );
    assert.equal(after.exclusion_detail, "Waiting Estimate From Shop (still)", "the detail still refreshes");

    // A DIFFERENT reason is a different block — the clock restarts.
    await markExcluded(after, "unassigned", null);
    const changed = await fetchRow(cycleId!);
    assert.ok(
      new Date(changed.exclusion_since as any).getTime()
        > new Date(aged.exclusion_since as any).getTime(),
      "a changed reason restarts the clock",
    );

    // And clearing the exclusion clears the clock entirely.
    await clearExclusion(changed, {
      ldap: TEST_LDAP,
      name: "Maintenance Fixture",
      district: "3132",
    });
    const cleared = await fetchRow(cycleId!);
    assert.equal(cleared.exclusion_since, null, "an eligible truck carries no blocked-since");
    assert.equal(cleared.status, "open");

    // Close the fixture so it doesn't collide with later TRUCK_C tests.
    await db.execute(sql`
      UPDATE fs_truck_maintenance_cycles SET closed_at = now(), status = 'excluded' WHERE id = ${cycleId}
    `);
  });

  test("listStaleBlockedCycles returns only cycles past the threshold, oldest first", async () => {
    // A fresh truck number: TRUCK_A/B carry open cycles from earlier suites,
    // and the partial unique index would (correctly) refuse a second one.
    const cycleId = await openCycle({ candidate: candidate(`${PREFIX}04`, 118_000), watermark: 111_500 });
    assert.ok(cycleId, "fixture cycle opened");
    const cycle = await fetchRow(cycleId!);
    await markExcluded(cycle, "ams_blocked", "Waiting Estimate From Shop");

    // Fresh block: under any sane threshold → not in the stale list.
    const freshList = await listStaleBlockedCycles(14);
    assert.ok(!freshList.some((r) => r.id === cycleId), "a fresh block is not stale");

    // Age it past the threshold.
    await db.execute(sql`
      UPDATE fs_truck_maintenance_cycles
         SET exclusion_since = now() - interval '20 days'
       WHERE id = ${cycleId}
    `);
    const staleList = await listStaleBlockedCycles(14);
    const hit = staleList.find((r) => r.id === cycleId);
    assert.ok(hit, "an aged block appears in the stale list");
    assert.equal(hit!.blocked_days, 20);
    assert.equal(hit!.odometer_at_trigger, 118_000);
    // ZZMAINT trucks have no vehicle-cache row: the absence is explicit.
    assert.equal(hit!.current_odometer, null);
    assert.equal(hit!.miles_past_trigger, null);

    // Close it so later suites see a clean slate for TRUCK_A.
    await db.execute(sql`
      UPDATE fs_truck_maintenance_cycles SET closed_at = now() WHERE id = ${cycleId}
    `);
  });

  test("consecutive comms-gate sweeps preserve the blocked-since clock", async () => {
    // The sweep order for a comms-gate-excluded cycle is: eligibility passes →
    // clearExclusion → runTextStep refuses again. The clock must survive that
    // clear→re-block round trip, or comms-gate cycles never age.
    const cycleId = await openCycle({ candidate: candidate(`${PREFIX}05`, 92_000), watermark: 86_000 });
    assert.ok(cycleId, "fixture cycle opened");

    // A synthetic LDAP with no fs_comms_contacts row: sendMessage refuses with
    // "no valid phone on file" (a real gate, zero side effects) even when the
    // SMS flag is live.
    const ghostLdap = "zzmaint674ghost";
    const savedLive = process.env.TRUCK_MAINTENANCE_SMS_LIVE;
    process.env.TRUCK_MAINTENANCE_SMS_LIVE = "true";
    try {
      // Sweep 1: the gate blocks and starts the clock.
      const out1 = await runTextStep(await fetchRow(cycleId!), ghostLdap, `${PREFIX}05`);
      assert.equal(out1.action, "skipped");
      const first = await fetchRow(cycleId!);
      assert.equal(first.status, "excluded");
      assert.equal(first.exclusion_reason, "comms_gate");
      assert.ok(first.exclusion_since, "the first gate refusal starts the clock");

      // Age the clock so a preserved value is distinguishable from a re-stamp.
      await db.execute(sql`
        UPDATE fs_truck_maintenance_cycles
           SET exclusion_since = now() - interval '30 days'
         WHERE id = ${cycleId}
      `);
      const aged = await fetchRow(cycleId!);

      // Sweep 2, step 1: eligibility passes again → clearExclusion. The
      // comms-gate clock must survive the clear (the gate is not re-tested yet).
      await clearExclusion(aged, { ldap: ghostLdap, name: "Ghost Fixture", district: "3132" });
      const between = await fetchRow(cycleId!);
      assert.equal(between.status, "open");
      assert.equal(between.exclusion_reason, null);
      assert.ok(between.exclusion_since, "clearExclusion keeps a comms-gate clock");

      // Sweep 2, step 2: the gate blocks again — the ORIGINAL clock returns.
      const out2 = await runTextStep(between, ghostLdap, `${PREFIX}05`);
      assert.equal(out2.action, "skipped");
      const second = await fetchRow(cycleId!);
      assert.equal(second.status, "excluded");
      assert.equal(second.exclusion_reason, "comms_gate");
      assert.equal(
        new Date(second.exclusion_since as any).getTime(),
        new Date(aged.exclusion_since as any).getTime(),
        "a repeat gate refusal keeps the original blocked-since",
      );

      // An aged comms-gate block reaches the stale list like any other reason.
      const staleList = await listStaleBlockedCycles(14);
      assert.ok(staleList.some((r) => r.id === cycleId), "an aged comms-gate block is stale");
    } finally {
      if (savedLive === undefined) delete process.env.TRUCK_MAINTENANCE_SMS_LIVE;
      else process.env.TRUCK_MAINTENANCE_SMS_LIVE = savedLive;
    }

    await db.execute(sql`
      UPDATE fs_truck_maintenance_cycles SET closed_at = now() WHERE id = ${cycleId}
    `);
  });

  /* ----------------------------------------------------------------------- *
   * Route authorization
   * ----------------------------------------------------------------------- */

  describe("route authorization", () => {
    let server: any;
    let base = "";

    before(async () => {
      const app = express();
      app.use(express.json());
      const router = express.Router();
      // Stands in for the /api/fs session middleware: every request here is
      // ALREADY authenticated — the question under test is whether being
      // logged in is enough (it must not be).
      router.use((req: any, _res, next) => {
        const role = req.headers["x-test-role"];
        if (role) req.user = { id: "test-user", username: "test-user", role: String(role) };
        next();
      });
      registerTruckMaintenanceRoutes(router);
      app.use("/api/fs", router);
      await new Promise<void>((resolve) => {
        server = app.listen(0, "127.0.0.1", () => resolve());
      });
      base = `http://127.0.0.1:${server.address().port}/api/fs/truck-maintenance`;
    });

    after(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    const call = (path: string, role?: string, body?: any, headers: Record<string, string> = {}) =>
      fetch(`${base}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "content-type": "application/json",
          ...(role ? { "x-test-role": role } : {}),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

    test("an ordinary authenticated user cannot read or drive the workflow", async () => {
      for (const role of ["agent", "viewer"]) {
        assert.equal((await call("/status", role)).status, 403, `${role} cannot read status`);
        assert.equal((await call("/cycles", role)).status, 403, `${role} cannot list cycles`);
        assert.equal((await call("/pause", role, { paused: true })).status, 403, `${role} cannot pause`);
        assert.equal((await call("/run", role, {})).status, 403, `${role} cannot run a sweep`);
        assert.equal((await call("/cycles/1/retry", role, {})).status, 403, `${role} cannot retry`);
      }
      // No session at all.
      assert.equal((await call("/status")).status, 403);
    });

    test("the cron secret does not confer operator powers", async () => {
      // The scheduler gets exactly one route. Its header must not unlock the
      // human ones through the router-wide bypass.
      const headers = { "x-internal-cron": String(process.env.NEXUS_CRON_SECRET || "wrong-secret") };
      assert.equal((await call("/status", undefined, undefined, headers)).status, 403);
      assert.equal((await call("/run", undefined, {}, headers)).status, 403);
      // And the cron route itself refuses an unauthenticated caller.
      assert.equal((await call("/cron/sweep", "admin", {})).status, 403);
    });

    test("fleet staff can read and operate, but only developers may TEST-file", async () => {
      assert.equal((await call("/status", "admin")).status, 200);
      assert.equal((await call("/cycles", "admin")).status, 200);

      const paused = await call("/pause", "admin", { paused: false });
      assert.equal(paused.status, 200);

      // The TEST-filing hatch POSTs a real activity upstream: refused for an
      // admin BEFORE the cycle is even looked up (id 1 need not exist).
      const testFiling = await call("/cycles/1/retry", "admin", { testFiling: true });
      assert.equal(testFiling.status, 403);
      assert.match((await testFiling.json()).message, /developers/);
    });

    test("the overdue endpoint is complete even when the cycle list caps out", async () => {
      // The general /cycles list is capped (default 200) and newest-first, so
      // the OLDEST long-blocked cycle — the exact row the overdue surface
      // exists for — falls out of it once the table grows. The dedicated
      // stale-blocked endpoint must still return it.
      const oldTruck = `${PREFIX}CAPOLD`;
      try {
        await db.execute(sql`
          INSERT INTO fs_truck_maintenance_cycles
            (truck_number, odometer_at_trigger, watermark_at_trigger, miles_since_watermark,
             status, exclusion_reason, exclusion_detail, exclusion_since, opened_at)
          VALUES (${oldTruck}, 100000, 94000, 6000,
                  'excluded', 'ams_blocked', 'Waiting Estimate From Shop',
                  now() - interval '150 days', now() - interval '160 days')
        `);
        await db.execute(sql`
          INSERT INTO fs_truck_maintenance_cycles
            (truck_number, odometer_at_trigger, watermark_at_trigger, miles_since_watermark,
             status, opened_at)
          SELECT ${PREFIX} || 'CAP' || lpad(g::text, 3, '0'), 100000, 94000, 6000,
                 'open', now() - (g || ' minutes')::interval
            FROM generate_series(1, 201) g
        `);

        const list = await (await call("/cycles", "admin")).json();
        assert.ok(
          !list.cycles.some((c: any) => c.truck_number === oldTruck),
          "precondition: the capped newest-first list has dropped the oldest blocked cycle",
        );

        const stale = await (await call("/stale-blocked", "admin")).json();
        const hit = stale.cycles.find((c: any) => c.truck_number === oldTruck);
        assert.ok(hit, "the dedicated overdue endpoint still returns it");
        assert.equal(hit.exclusion_reason, "ams_blocked");
        assert.ok(hit.blocked_days >= 149, "with its true age");
        assert.equal(typeof stale.staleExclusionDays, "number");
        // And it is gated like every other staff read.
        assert.equal((await call("/stale-blocked", "agent")).status, 403);
      } finally {
        await db.execute(sql`
          DELETE FROM fs_truck_maintenance_cycles WHERE truck_number LIKE ${PREFIX + "CAP%"}
        `);
      }
    });
  });

  test("the piggybacked tick is a cheap no-op once the day is claimed", async () => {
    // The comms drain calls this on EVERY dispatcher tick, so its normal
    // behaviour has to be "do nothing, cheaply, and never throw". The day
    // claim is what makes riding a 5-minute tick safe.
    const previous = await getSetting(SETTING_LAST_SWEEP_DATE);
    try {
      await setSetting(SETTING_LAST_SWEEP_DATE, todayInET(), "test");
      const tick = await runMaintenanceSweepTick("test_tick");
      assert.equal(tick.ran, false, "today is already claimed — the tick must not sweep again");
      assert.match(tick.reason, /already ran|today/i);
    } finally {
      await setSetting(SETTING_LAST_SWEEP_DATE, previous, "test-restore");
    }
  });

  test("the kill switch persists, and absence means 'not paused'", async () => {
    await db.execute(sql`DELETE FROM fs_truck_maintenance_settings WHERE key = 'cycle_open_paused'`);
    assert.equal(await isCycleOpeningPaused(), false, "no setting row must never mean 'paused'");

    await setCycleOpeningPaused(true, "test");
    assert.equal(await isCycleOpeningPaused(), true);

    await setCycleOpeningPaused(false, "test");
    assert.equal(await isCycleOpeningPaused(), false);
  });
});
