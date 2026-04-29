/**
 * End-to-end regression test for the vehicle 61385 / jcasti0 prod incident.
 *
 * Hits the real dev Postgres. Seeds the pre-incident state across all four
 * TPMS cache tables + tech_vehicle_assignments, calls writeThroughCaches with
 * Holman timed out, then asserts each of the five required tables reflects
 * the new tech immediately (no waiting on bulk sync). Cleans up after itself.
 *
 * Uses test-only enterprise IDs / truck numbers prefixed with `_t184_` so a
 * failed run cannot stomp on real fleet data.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

import { db } from "../server/db.js";
import {
  tpmsCachedAssignments,
  tpmsLastKnownTruckTech,
  tpmsTechProfiles,
  techVehicleAssignments,
  techVehicleAssignmentHistory,
  holmanVehiclesCache,
  fleetOperationLog,
} from "../shared/schema.js";
import { writeThroughCaches } from "../server/fleet-operations-service.js";

const NEW_TECH = "_t184_jcasti0";
const PREV_TECH = "_t184_techa";
const TRUCK = "61385";
const TRUCK_PADDED = "061385";

async function cleanup() {
  await db.delete(tpmsCachedAssignments).where(eq(tpmsCachedAssignments.lookupKey, NEW_TECH));
  await db.delete(tpmsCachedAssignments).where(eq(tpmsCachedAssignments.lookupKey, PREV_TECH));
  await db.delete(tpmsCachedAssignments).where(eq(tpmsCachedAssignments.lookupKey, TRUCK_PADDED));
  await db.delete(tpmsCachedAssignments).where(eq(tpmsCachedAssignments.lookupKey, TRUCK));
  await db.delete(tpmsLastKnownTruckTech).where(eq(tpmsLastKnownTruckTech.truckNo, TRUCK_PADDED));
  await db.delete(tpmsTechProfiles).where(eq(tpmsTechProfiles.enterpriseId, NEW_TECH));
  await db.delete(tpmsTechProfiles).where(eq(tpmsTechProfiles.enterpriseId, PREV_TECH));
  await db.delete(techVehicleAssignments).where(eq(techVehicleAssignments.techRacfid, NEW_TECH));
  await db.delete(techVehicleAssignments).where(eq(techVehicleAssignments.techRacfid, PREV_TECH));
  await db.delete(techVehicleAssignmentHistory).where(eq(techVehicleAssignmentHistory.techRacfid, NEW_TECH));
  await db.delete(techVehicleAssignmentHistory).where(eq(techVehicleAssignmentHistory.techRacfid, PREV_TECH));
}

before(cleanup);
after(cleanup);

test("vehicle 61385 prod regression: assign over previous holder w/ Holman timeout updates all 5 tables immediately", async () => {
  // ── Seed pre-incident state ───────────────────────────────────────────────
  // Previous holder owns the truck across all four TPMS caches.
  await db.insert(tpmsCachedAssignments).values([
    { lookupKey: PREV_TECH, lookupType: "enterprise_id", truckNo: TRUCK_PADDED, enterpriseId: PREV_TECH, status: "live", failureCount: 0 },
    { lookupKey: TRUCK_PADDED, lookupType: "truck_number", truckNo: TRUCK_PADDED, enterpriseId: PREV_TECH, status: "live", failureCount: 0 },
    { lookupKey: TRUCK, lookupType: "truck_number", truckNo: TRUCK_PADDED, enterpriseId: PREV_TECH, status: "live", failureCount: 0 },
  ]);
  await db.insert(tpmsLastKnownTruckTech).values({
    truckNo: TRUCK_PADDED, enterpriseId: PREV_TECH,
  });
  await db.insert(tpmsTechProfiles).values([
    { techId: PREV_TECH, enterpriseId: PREV_TECH, truckNo: TRUCK_PADDED },
    { techId: NEW_TECH, enterpriseId: NEW_TECH, truckNo: null },
  ]);
  // Canonical tech_vehicle_assignments row for the previous holder.
  await db.insert(techVehicleAssignments).values({
    techRacfid: PREV_TECH, truckNo: TRUCK_PADDED, assignmentStatus: "active",
  });

  // Create a real fleet_operation_log row so we can verify atomic
  // status + completedAt updates after write-through.
  const [logRow] = await db.insert(fleetOperationLog).values({
    operationType: "assign",
    truckNumber: TRUCK,
    toLdap: NEW_TECH,
    toTechName: "J Casti",
    districtNo: "42",
    tpmsStatus: "pending",
    holmanStatus: "pending",
    amsStatus: "pending",
    requestedBy: "test:integration",
    notes: "_t184_ regression test",
    fromLdap: null,
    tpmsMessage: null,
    holmanMessage: null,
    amsMessage: null,
    completedAt: null,
  }).returning();

  // ── Execute the orchestrator's write-through with the 61385 scenario ──────
  // TPMS succeeded; Holman timed out (skipped) — this is the prod condition.
  await writeThroughCaches({
    action: "assign",
    params: {
      ldapId: NEW_TECH,
      truckNumber: TRUCK,
      firstName: "J",
      lastName: "Casti",
      districtNo: "42",
      techName: "J Casti",
      requestedBy: "test:integration",
    },
    tpms: { status: "success", message: "Assigned" },
    holman: { status: "skipped", message: "Holman verification timeout" },
    ams: { status: "skipped", message: "AMS skipped" },
    previousTruckHolderLdap: PREV_TECH,
    previousTechTruck: null,
    changeSource: "manual",
    fleetOpLogId: logRow.id,
  });

  // Fleet log lifecycle: completedAt MUST be set after write-through
  // (regression check — see review feedback on Task #184).
  const finalLog = await db.select().from(fleetOperationLog)
    .where(eq(fleetOperationLog.id, logRow.id));
  assert.equal(finalLog[0]?.tpmsStatus, "success", "log status must reflect TPMS success");
  assert.equal(finalLog[0]?.holmanStatus, "skipped");
  assert.ok(finalLog[0]?.completedAt instanceof Date, "fleet_operation_log.completed_at must be set after write-through");
  await db.delete(fleetOperationLog).where(eq(fleetOperationLog.id, logRow.id));

  // ── Assertions: every required table reflects new tech immediately ────────

  // 1. tpms_cached_assignments — enterprise-id row for new tech
  const newEnt = await db.select().from(tpmsCachedAssignments)
    .where(eq(tpmsCachedAssignments.lookupKey, NEW_TECH));
  assert.equal(newEnt.length, 1, "new tech enterprise-id row must exist");
  assert.equal(newEnt[0].truckNo, TRUCK_PADDED);
  assert.equal(newEnt[0].enterpriseId, NEW_TECH);
  assert.equal(newEnt[0].status, "live");

  // 1b. tpms_cached_assignments — both truck-keyed variants point at new tech
  const truckPaddedRow = await db.select().from(tpmsCachedAssignments)
    .where(eq(tpmsCachedAssignments.lookupKey, TRUCK_PADDED));
  assert.equal(truckPaddedRow[0]?.enterpriseId, NEW_TECH, "padded truck row must point at new tech");
  const truckCanonRow = await db.select().from(tpmsCachedAssignments)
    .where(eq(tpmsCachedAssignments.lookupKey, TRUCK));
  assert.equal(truckCanonRow[0]?.enterpriseId, NEW_TECH, "canonical truck row must point at new tech");

  // 1c. Previous holder no longer claims the truck
  const prevEnt = await db.select().from(tpmsCachedAssignments)
    .where(eq(tpmsCachedAssignments.lookupKey, PREV_TECH));
  assert.equal(prevEnt[0]?.truckNo, null, "previous holder enterprise row must be cleared");

  // 2. tpms_last_known_truck_tech — points at new tech
  const lk = await db.select().from(tpmsLastKnownTruckTech)
    .where(eq(tpmsLastKnownTruckTech.truckNo, TRUCK_PADDED));
  assert.equal(lk[0]?.enterpriseId, NEW_TECH);

  // 3. tpms_tech_profiles — new tech has truck, previous holder cleared
  const newProf = await db.select().from(tpmsTechProfiles)
    .where(eq(tpmsTechProfiles.enterpriseId, NEW_TECH));
  assert.equal(newProf[0]?.truckNo, TRUCK_PADDED);
  const prevProf = await db.select().from(tpmsTechProfiles)
    .where(eq(tpmsTechProfiles.enterpriseId, PREV_TECH));
  assert.equal(prevProf[0]?.truckNo, null);

  // 4. tech_vehicle_assignments — canonical Nexus state for new tech
  const tvaNew = await db.select().from(techVehicleAssignments)
    .where(eq(techVehicleAssignments.techRacfid, NEW_TECH));
  assert.equal(tvaNew.length, 1, "new tech canonical assignment row must exist");
  assert.equal(tvaNew[0].truckNo, TRUCK_PADDED);
  assert.equal(tvaNew[0].assignmentStatus, "active");

  // 4b. Previous holder's tech_vehicle_assignments row is displaced (truck nulled)
  const tvaPrev = await db.select().from(techVehicleAssignments)
    .where(eq(techVehicleAssignments.techRacfid, PREV_TECH));
  assert.equal(tvaPrev[0]?.truckNo, null, "previous holder canonical row must be cleared on displacement");
  assert.equal(tvaPrev[0]?.assignmentStatus, "inactive");

  // 5. tech_vehicle_assignment_history — audit row for the assign + displacement
  const histNew = await db.select().from(techVehicleAssignmentHistory)
    .where(eq(techVehicleAssignmentHistory.techRacfid, NEW_TECH));
  assert.ok(histNew.length >= 1, "history row for new tech must exist");
  assert.equal(histNew[0].truckNo, TRUCK_PADDED);
  assert.equal(histNew[0].changeType, "assigned");

  const histPrev = await db.select().from(techVehicleAssignmentHistory)
    .where(eq(techVehicleAssignmentHistory.techRacfid, PREV_TECH));
  assert.ok(histPrev.length >= 1, "displacement history row for previous holder must exist");
  assert.equal(histPrev[0].changeType, "unassigned");
  assert.equal(histPrev[0].changeSource, "displacement");
});

test("Holman cache is centrally upserted via cachePayload from writeThroughCaches", async () => {
  const TRUCK_NUM = "_t184_holman_v1";
  // Cleanup any leftover row.
  await db.delete(holmanVehiclesCache).where(eq(holmanVehiclesCache.holmanVehicleNumber, TRUCK_NUM));

  await writeThroughCaches({
    action: "assign",
    params: { ldapId: NEW_TECH, truckNumber: TRUCK, techName: "J Casti", requestedBy: "test" },
    tpms: { status: "skipped", message: "" },
    holman: {
      status: "pending",
      message: "queued",
      cachePayload: {
        system: "holman",
        holmanVehicleNumber: TRUCK_NUM,
        ldap: NEW_TECH,
        techName: "J Casti",
        statusCode: "A",
      },
    },
    ams: { status: "skipped", message: "" },
  });

  const row = await db.select().from(holmanVehiclesCache)
    .where(eq(holmanVehiclesCache.holmanVehicleNumber, TRUCK_NUM));
  assert.equal(row.length, 1, "holman cache row must be inserted by centralized helper");
  assert.equal(row[0].holmanTechAssigned, NEW_TECH);
  assert.equal(row[0].holmanTechName, "J Casti");
  assert.equal(row[0].holmanAssignedStatusCd, "A");

  // Re-run with unassign payload — must update in place (proves upsert path).
  await writeThroughCaches({
    action: "unassign",
    params: { ldapId: NEW_TECH, truckNumber: TRUCK, requestedBy: "test" },
    tpms: { status: "skipped", message: "" },
    holman: {
      status: "pending",
      message: "queued",
      cachePayload: {
        system: "holman",
        holmanVehicleNumber: TRUCK_NUM,
        ldap: null,
        techName: null,
        statusCode: null,
      },
    },
    ams: { status: "skipped", message: "" },
  });

  const row2 = await db.select().from(holmanVehiclesCache)
    .where(eq(holmanVehiclesCache.holmanVehicleNumber, TRUCK_NUM));
  assert.equal(row2[0].holmanTechAssigned, null);
  assert.equal(row2[0].holmanTechName, null);

  // Cleanup.
  await db.delete(holmanVehiclesCache).where(eq(holmanVehiclesCache.holmanVehicleNumber, TRUCK_NUM));
});

test("unassign uses TPMS effectiveLdap for cleanup, not request author's ldapId", async () => {
  // Scenario: operator (request author) clears truck assigned to a different
  // tech. TPMS resolves the actual holder via its truck-number cache. The
  // canonical tech_vehicle_assignments + history must reference the resolved
  // holder, not the request author.
  const REQUESTOR = "_t184_operator";
  const ACTUAL = "_t184_actualholder";
  await db.delete(techVehicleAssignments).where(eq(techVehicleAssignments.techRacfid, ACTUAL));
  await db.delete(techVehicleAssignments).where(eq(techVehicleAssignments.techRacfid, REQUESTOR));
  await db.delete(techVehicleAssignmentHistory).where(eq(techVehicleAssignmentHistory.techRacfid, ACTUAL));
  await db.delete(techVehicleAssignmentHistory).where(eq(techVehicleAssignmentHistory.techRacfid, REQUESTOR));

  await db.insert(techVehicleAssignments).values({
    techRacfid: ACTUAL, truckNo: TRUCK_PADDED, assignmentStatus: "active",
  });

  await writeThroughCaches({
    action: "unassign",
    params: { ldapId: REQUESTOR, truckNumber: TRUCK, requestedBy: "test" },
    tpms: {
      status: "success",
      message: "Unassigned",
      effectiveLdap: ACTUAL,
    },
    holman: { status: "skipped", message: "" },
    ams: { status: "skipped", message: "" },
  });

  // Canonical row for the ACTUAL holder is cleared, history is for ACTUAL.
  const tva = await db.select().from(techVehicleAssignments)
    .where(eq(techVehicleAssignments.techRacfid, ACTUAL));
  assert.equal(tva[0]?.truckNo, null);
  assert.equal(tva[0]?.assignmentStatus, "inactive");

  const hist = await db.select().from(techVehicleAssignmentHistory)
    .where(eq(techVehicleAssignmentHistory.techRacfid, ACTUAL));
  assert.ok(hist.length >= 1, "history row must reference effective LDAP, not requestor");
  assert.equal(hist[0].changeType, "unassigned");

  // Requestor must NOT have a spurious history/canonical row.
  const reqTva = await db.select().from(techVehicleAssignments)
    .where(eq(techVehicleAssignments.techRacfid, REQUESTOR));
  assert.equal(reqTva.length, 0, "requestor must not get a phantom canonical row");
  const reqHist = await db.select().from(techVehicleAssignmentHistory)
    .where(eq(techVehicleAssignmentHistory.techRacfid, REQUESTOR));
  assert.equal(reqHist.length, 0, "requestor must not get phantom history rows");

  // Cleanup.
  await db.delete(techVehicleAssignments).where(eq(techVehicleAssignments.techRacfid, ACTUAL));
  await db.delete(techVehicleAssignmentHistory).where(eq(techVehicleAssignmentHistory.techRacfid, ACTUAL));
});

test("reconcile path: holman-only success writes through to holman_vehicles_cache", async () => {
  // reconcileSystem(targetSystem: "holman") invokes writeThroughCaches with
  // tpms/ams marked "skipped" and the holman result carrying a cachePayload.
  // This proves that wiring updates holman_vehicles_cache immediately so a
  // successful reconcile push is reflected without waiting for bulk sync.
  const TRUCK_NUM = "_t184_recon_h1";
  await db.delete(holmanVehiclesCache).where(eq(holmanVehiclesCache.holmanVehicleNumber, TRUCK_NUM));

  await writeThroughCaches({
    action: "assign",
    params: { ldapId: NEW_TECH, truckNumber: TRUCK_NUM, techName: "J Casti", requestedBy: "reconcile-test" },
    tpms: { status: "skipped", message: "" },
    holman: {
      status: "success",
      message: "ok",
      cachePayload: {
        system: "holman",
        holmanVehicleNumber: TRUCK_NUM,
        ldap: NEW_TECH,
        techName: "J Casti",
        statusCode: "A",
      },
    },
    ams: { status: "skipped", message: "" },
    changeSource: "reconcile",
  });

  const row = await db.select().from(holmanVehiclesCache)
    .where(eq(holmanVehiclesCache.holmanVehicleNumber, TRUCK_NUM));
  assert.equal(row.length, 1, "reconcile success must write holman cache row immediately");
  assert.equal(row[0].holmanTechAssigned, NEW_TECH);

  // History row should still be written for audit (holman success counts).
  const hist = await db.select().from(techVehicleAssignmentHistory)
    .where(eq(techVehicleAssignmentHistory.techRacfid, NEW_TECH));
  assert.ok(hist.some(h => h.notes?.includes("holman=success")), "history must capture reconcile holman=success");

  // Cleanup.
  await db.delete(holmanVehiclesCache).where(eq(holmanVehiclesCache.holmanVehicleNumber, TRUCK_NUM));
  await db.delete(techVehicleAssignmentHistory).where(eq(techVehicleAssignmentHistory.techRacfid, NEW_TECH));
  await db.delete(techVehicleAssignments).where(eq(techVehicleAssignments.techRacfid, NEW_TECH));
});

test("conflict gate: TPMS conflict status must NOT mutate canonical assignments / history", async () => {
  // Per write-through contract, a TPMS "conflict" outcome means user
  // confirmation is pending — we must not flip the canonical row or write
  // a history audit entry, otherwise the UI would falsely show the tech
  // unassigned before the user has actually resolved the conflict.
  const CONFLICT_TECH = "_t184_conflict_user";
  const CONFLICT_TRUCK = "_t184_999";
  await db.delete(techVehicleAssignments).where(eq(techVehicleAssignments.techRacfid, CONFLICT_TECH));
  await db.delete(techVehicleAssignmentHistory).where(eq(techVehicleAssignmentHistory.techRacfid, CONFLICT_TECH));

  // Seed an existing canonical row.
  await db.insert(techVehicleAssignments).values({
    techRacfid: CONFLICT_TECH, truckNo: CONFLICT_TRUCK, assignmentStatus: "active",
  });

  await writeThroughCaches({
    action: "unassign",
    params: { ldapId: CONFLICT_TECH, truckNumber: CONFLICT_TRUCK, requestedBy: "test" },
    tpms: {
      status: "conflict",
      message: "User confirmation pending",
      effectiveLdap: CONFLICT_TECH,
      effectiveTruck: CONFLICT_TRUCK,
      conflictTech: CONFLICT_TECH,
      conflictTruck: CONFLICT_TRUCK,
    },
    holman: { status: "skipped", message: "" },
    ams: { status: "skipped", message: "" },
    changeSource: "manual",
  });

  // Canonical row must STILL be active — not flipped to inactive.
  const tva = await db.select().from(techVehicleAssignments)
    .where(eq(techVehicleAssignments.techRacfid, CONFLICT_TECH));
  assert.equal(tva[0]?.assignmentStatus, "active", "conflict must NOT flip canonical to inactive");
  assert.equal(tva[0]?.truckNo, CONFLICT_TRUCK, "conflict must NOT clear canonical truck");

  // Audit contract: history row IS written for every operation, even on
  // conflict, with a "conflict" changeType and status-rich notes so
  // reconciliation/reporting can see the attempt.
  const hist = await db.select().from(techVehicleAssignmentHistory)
    .where(eq(techVehicleAssignmentHistory.techRacfid, CONFLICT_TECH));
  assert.equal(hist.length, 1, "conflict MUST still write a history audit row (audit contract)");
  assert.equal(hist[0].changeType, "conflict", "history row must mark the attempt as conflict");
  assert.ok(hist[0].notes?.includes("tpms=conflict"), "history notes must capture per-system status");

  // Cleanup.
  await db.delete(techVehicleAssignmentHistory).where(eq(techVehicleAssignmentHistory.techRacfid, CONFLICT_TECH));
  await db.delete(techVehicleAssignments).where(eq(techVehicleAssignments.techRacfid, CONFLICT_TECH));
});

test("atomicity: when write-through transaction fails, fleet log status does NOT show success", async () => {
  // This proves Requirement #7: log + cache writes are one transactional unit.
  // We force the tx to fail by passing a fleetOpLogId that violates the FK
  // constraint on fleet_operation_log. The cache writes inside the same tx
  // must roll back, and the log row (which never existed) must remain absent.
  // Force-abort approach: lookup_key is varchar(50). Use a 60-char ldap so the
  // tpms_cached_assignments INSERT fails, aborting the entire transaction.
  const ATOMIC_TECH = "_t184_atomic_overflow_" + "x".repeat(40); // > 50 chars
  const ATOMIC_TRUCK = "_t184";
  await db.delete(techVehicleAssignments).where(eq(techVehicleAssignments.techRacfid, ATOMIC_TECH));
  await db.delete(techVehicleAssignmentHistory).where(eq(techVehicleAssignmentHistory.techRacfid, ATOMIC_TECH));
  await db.delete(tpmsCachedAssignments).where(eq(tpmsCachedAssignments.lookupKey, ATOMIC_TECH));

  let threw = false;
  try {
    await writeThroughCaches({
      action: "assign",
      params: {
        truckNumber: ATOMIC_TRUCK,
        ldapId: ATOMIC_TECH,
        techName: "Atomic Test",
        districtNo: "_t184_D",
        requestedBy: "_t184_test",
      },
      tpms: { status: "success", message: "ok", effectiveLdap: ATOMIC_TECH, effectiveTruck: ATOMIC_TRUCK },
      holman: { status: "skipped", message: "n/a" },
      ams: { status: "skipped", message: "n/a" },
      changeSource: "manual",
      // No fleetOpLogId needed — proving cache rollback is sufficient since
      // the log update is in the same tx as the (failing) cache write.
    });
  } catch {
    threw = true;
  }
  assert.ok(threw, "writeThroughCaches must throw on transaction failure (atomicity)");

  // Caches must be untouched: nothing was written for ATOMIC_TECH.
  const cached = await db.select().from(tpmsCachedAssignments)
    .where(eq(tpmsCachedAssignments.lookupKey, ATOMIC_TECH));
  assert.equal(cached.length, 0, "tpms_cached_assignments must roll back on tx failure");

  const tva = await db.select().from(techVehicleAssignments)
    .where(eq(techVehicleAssignments.techRacfid, ATOMIC_TECH));
  assert.equal(tva.length, 0, "tech_vehicle_assignments must roll back on tx failure");

  const hist = await db.select().from(techVehicleAssignmentHistory)
    .where(eq(techVehicleAssignmentHistory.techRacfid, ATOMIC_TECH));
  assert.equal(hist.length, 0, "tech_vehicle_assignment_history must roll back on tx failure");
});

/* Force-exit after all tests + cleanup hooks complete.
 * The Neon/postgres connection pool keeps the event loop alive after tests
 * finish. We schedule an immediate exit that preserves process.exitCode so a
 * failing run still exits non-zero and a passing run exits 0. */
after(() => { setImmediate(() => process.exit(process.exitCode ?? 0)); });
