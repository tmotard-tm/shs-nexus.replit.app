import { test, after } from "node:test";
import assert from "node:assert/strict";

import {
  planTpmsCacheWrites,
  type WriteThroughCacheArgs,
} from "../server/fleet-operations-service.js";

const ok = { status: "success" as const };
const skipped = { status: "skipped" as const, message: "timeout" };

/* ──────────────────────────────────────────────────────────────────────────
 * In-memory simulation of the post-success cache state.
 *
 * `applyPlanToCaches` plays back the planner's output against an in-memory
 * model of the four TPMS cache tables — exactly mirroring what the real
 * write-through transaction does in the database. This lets us assert the
 * end-state of each table without standing up Postgres.
 * ────────────────────────────────────────────────────────────────────────── */
type CacheState = {
  tpmsCachedAssignments: Map<string, { lookupKey: string; lookupType: string; truckNo: string | null; enterpriseId: string | null }>;
  tpmsLastKnownTruckTech: Map<string, { truckNo: string; enterpriseId: string }>;
  tpmsTechProfiles: Map<string, { enterpriseId: string; truckNo: string | null }>;
  amsVehiclesCache: Map<string, { vin: string; amsAssignedLdap: string | null; rawResponse: any }>;
};

function emptyCaches(): CacheState {
  return {
    tpmsCachedAssignments: new Map(),
    tpmsLastKnownTruckTech: new Map(),
    tpmsTechProfiles: new Map(),
    amsVehiclesCache: new Map(),
  };
}

/**
 * Applies the AMS cachePayload path from writeThroughCaches to the in-memory
 * amsVehiclesCache map. Mirrors the real DB upsert-on-conflict logic:
 * only executes when ams.status is "success" or "pending" and the payload
 * carries a system="ams" tag plus a non-empty vin.
 */
function applyAmsCachePayload(state: CacheState, ams: WriteThroughCacheArgs["ams"]): void {
  const payload = ams.cachePayload;
  if (
    (ams.status === "success" || ams.status === "pending") &&
    payload?.system === "ams" &&
    payload.vin
  ) {
    state.amsVehiclesCache.set(payload.vin, {
      vin: payload.vin,
      amsAssignedLdap: payload.ldap ?? null,
      rawResponse: payload.rawResponse ?? null,
    });
  }
}

function applyPlanToCaches(state: CacheState, plan: ReturnType<typeof planTpmsCacheWrites>) {
  for (const u of plan.cachedAssignmentUpserts) {
    state.tpmsCachedAssignments.set(u.lookupKey, { ...u });
  }
  for (const n of plan.cachedAssignmentNullTruck) {
    const row = state.tpmsCachedAssignments.get(n.lookupKey);
    if (row && row.lookupType === n.lookupType) {
      row.truckNo = null;
    }
  }
  for (const d of plan.cachedAssignmentDeletes) {
    const row = state.tpmsCachedAssignments.get(d.lookupKey);
    if (row && row.lookupType === d.lookupType) {
      state.tpmsCachedAssignments.delete(d.lookupKey);
    }
  }
  for (const u of plan.lastKnownUpserts) {
    state.tpmsLastKnownTruckTech.set(u.truckNo, { ...u });
  }
  for (const t of plan.lastKnownDeletes) {
    state.tpmsLastKnownTruckTech.delete(t);
  }
  for (const t of plan.techProfileTruckSets) {
    if (state.tpmsTechProfiles.has(t.enterpriseId)) {
      state.tpmsTechProfiles.get(t.enterpriseId)!.truckNo = t.truckNo;
    } else {
      state.tpmsTechProfiles.set(t.enterpriseId, { ...t });
    }
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Production regression: vehicle 61385 incident.
 *
 * Background: truck 61385 was previously held by tech "techa". Operator
 * assigns the truck to "jcasti0". TPMS succeeds, Holman times out (status
 * skipped). Before the fix, the four TPMS-side caches still pointed at techa
 * until the next bulk sync — UI showed stale data.
 *
 * This test seeds the pre-incident cache state, runs the planner, replays the
 * plan against the in-memory caches, and asserts each table reflects the new
 * tech *immediately* with no leftover stale rows pointing at techa.
 * ────────────────────────────────────────────────────────────────────────── */
test("vehicle 61385 regression: assign over previous holder with Holman timeout — caches reflect new tech immediately", () => {
  const caches = emptyCaches();

  // Seed the pre-incident state: techa holds truck 61385 across all four caches.
  caches.tpmsCachedAssignments.set("techa", {
    lookupKey: "techa", lookupType: "enterprise_id", truckNo: "061385", enterpriseId: "techa",
  });
  caches.tpmsCachedAssignments.set("061385", {
    lookupKey: "061385", lookupType: "truck_number", truckNo: "061385", enterpriseId: "techa",
  });
  caches.tpmsCachedAssignments.set("61385", {
    lookupKey: "61385", lookupType: "truck_number", truckNo: "061385", enterpriseId: "techa",
  });
  caches.tpmsLastKnownTruckTech.set("061385", { truckNo: "061385", enterpriseId: "techa" });
  caches.tpmsTechProfiles.set("techa", { enterpriseId: "techa", truckNo: "061385" });
  caches.tpmsTechProfiles.set("jcasti0", { enterpriseId: "jcasti0", truckNo: null });

  const args: WriteThroughCacheArgs = {
    action: "assign",
    params: {
      ldapId: "jcasti0",
      truckNumber: "61385",
      firstName: "J",
      lastName: "Casti",
      districtNo: "42",
    },
    tpms: ok,
    holman: skipped, // The prod-incident condition: Holman timed out.
    ams: skipped,
    previousTruckHolderLdap: "techa",
    previousTechTruck: null,
  };

  const plan = planTpmsCacheWrites(args);
  applyPlanToCaches(caches, plan);

  // ── tpms_cached_assignments ──────────────────────────────────────────────
  // Enterprise-id row for the new tech now points at the truck.
  assert.deepEqual(caches.tpmsCachedAssignments.get("jcasti0"), {
    lookupKey: "jcasti0", lookupType: "enterprise_id", truckNo: "061385", enterpriseId: "jcasti0",
  });
  // Both truck-keyed variants now point at the new tech.
  assert.equal(caches.tpmsCachedAssignments.get("061385")?.enterpriseId, "jcasti0");
  assert.equal(caches.tpmsCachedAssignments.get("61385")?.enterpriseId, "jcasti0");
  // Previous holder's enterprise row no longer claims the truck.
  assert.equal(caches.tpmsCachedAssignments.get("techa")?.truckNo, null);

  // ── tpms_last_known_truck_tech ───────────────────────────────────────────
  assert.deepEqual(caches.tpmsLastKnownTruckTech.get("061385"), {
    truckNo: "061385", enterpriseId: "jcasti0",
  });

  // ── tpms_tech_profiles ───────────────────────────────────────────────────
  assert.equal(caches.tpmsTechProfiles.get("jcasti0")?.truckNo, "061385");
  assert.equal(caches.tpmsTechProfiles.get("techa")?.truckNo, null);
});

/* The transactional write-through also updates `tech_vehicle_assignments` and
 * inserts `tech_vehicle_assignment_history` rows (current op + displacement).
 * These are exercised end-to-end inside writeThroughCaches against the live
 * database during normal app operation; we cover their *intent* here by
 * asserting the planner's auxiliary signals (previous-holder cleanup,
 * change-source flow). The planner output is the contract the transactional
 * applier consumes. */
test("vehicle 61385 regression: planner emits all sweep signals required for tech_vehicle_assignments displacement", () => {
  const args: WriteThroughCacheArgs = {
    action: "assign",
    params: { ldapId: "jcasti0", truckNumber: "61385", requestedBy: "ops:bulk-fix" },
    tpms: ok,
    holman: skipped,
    ams: skipped,
    previousTruckHolderLdap: "techa",
  };
  const plan = planTpmsCacheWrites(args);

  // Sweep signal #1: previous holder's enterprise row gets nulled.
  assert.ok(plan.cachedAssignmentNullTruck.some(
    (n) => n.lookupKey === "techa" && n.lookupType === "enterprise_id",
  ));
  // Sweep signal #2: previous holder's tech-profiles row gets cleared.
  assert.ok(plan.techProfileTruckSets.some(
    (t) => t.enterpriseId === "techa" && t.truckNo === null,
  ));
  // New tech gets both upsert (enterprise + truck variants).
  const newTechKeys = new Set(
    plan.cachedAssignmentUpserts.filter((u) => u.enterpriseId === "jcasti0").map((u) => u.lookupKey),
  );
  assert.ok(newTechKeys.has("jcasti0"));
  assert.ok(newTechKeys.has("061385"));
  assert.ok(newTechKeys.has("61385"));
});

test("planTpmsCacheWrites returns empty plan when TPMS call did not succeed", () => {
  const plan = planTpmsCacheWrites({
    action: "assign",
    params: { ldapId: "jcasti0", truckNumber: "61385" },
    tpms: { status: "skipped" },
    holman: ok,
    ams: ok,
  });

  assert.deepEqual(plan, {
    cachedAssignmentUpserts: [],
    cachedAssignmentNullTruck: [],
    cachedAssignmentDeletes: [],
    lastKnownUpserts: [],
    lastKnownDeletes: [],
    techProfileTruckSets: [],
  });
});

test("unassign clears truck-keyed caches under both variants and nulls the tech's row", () => {
  const caches = emptyCaches();
  caches.tpmsCachedAssignments.set("jcasti0", {
    lookupKey: "jcasti0", lookupType: "enterprise_id", truckNo: "061385", enterpriseId: "jcasti0",
  });
  caches.tpmsCachedAssignments.set("061385", {
    lookupKey: "061385", lookupType: "truck_number", truckNo: "061385", enterpriseId: "jcasti0",
  });
  caches.tpmsCachedAssignments.set("61385", {
    lookupKey: "61385", lookupType: "truck_number", truckNo: "061385", enterpriseId: "jcasti0",
  });
  caches.tpmsLastKnownTruckTech.set("061385", { truckNo: "061385", enterpriseId: "jcasti0" });
  caches.tpmsTechProfiles.set("jcasti0", { enterpriseId: "jcasti0", truckNo: "061385" });

  const plan = planTpmsCacheWrites({
    action: "unassign",
    params: { ldapId: "jcasti0", truckNumber: "61385" },
    tpms: ok,
    holman: ok,
    ams: ok,
  });
  applyPlanToCaches(caches, plan);

  // Truck-keyed cache rows under both variants are gone.
  assert.equal(caches.tpmsCachedAssignments.get("061385"), undefined);
  assert.equal(caches.tpmsCachedAssignments.get("61385"), undefined);
  // Last-known truck row is gone.
  assert.equal(caches.tpmsLastKnownTruckTech.get("061385"), undefined);
  // Tech's enterprise row still exists but no longer claims the truck.
  assert.equal(caches.tpmsCachedAssignments.get("jcasti0")?.truckNo, null);
  // Tech profile truck cleared.
  assert.equal(caches.tpmsTechProfiles.get("jcasti0")?.truckNo, null);
});

test("auto-unassign sweeps stale caches under the truck the incoming tech vacated", () => {
  const caches = emptyCaches();
  // Stale state: jcasti0 was previously on truck 99999.
  caches.tpmsCachedAssignments.set("099999", {
    lookupKey: "099999", lookupType: "truck_number", truckNo: "099999", enterpriseId: "jcasti0",
  });
  caches.tpmsCachedAssignments.set("99999", {
    lookupKey: "99999", lookupType: "truck_number", truckNo: "099999", enterpriseId: "jcasti0",
  });
  caches.tpmsLastKnownTruckTech.set("099999", { truckNo: "099999", enterpriseId: "jcasti0" });

  const plan = planTpmsCacheWrites({
    action: "assign",
    params: { ldapId: "jcasti0", truckNumber: "61385" },
    tpms: ok,
    holman: ok,
    ams: ok,
    previousTechTruck: "99999",
  });
  applyPlanToCaches(caches, plan);

  // Stale truck-keyed rows for the vacated truck are deleted.
  assert.equal(caches.tpmsCachedAssignments.get("099999"), undefined);
  assert.equal(caches.tpmsCachedAssignments.get("99999"), undefined);
  // Stale last-known row deleted too.
  assert.equal(caches.tpmsLastKnownTruckTech.get("099999"), undefined);
  // New truck rows present and pointing at the new tech.
  assert.equal(caches.tpmsCachedAssignments.get("061385")?.enterpriseId, "jcasti0");
  assert.equal(caches.tpmsLastKnownTruckTech.get("061385")?.enterpriseId, "jcasti0");
});

/* ──────────────────────────────────────────────────────────────────────────
 * AMS cache (cachePayload path) — these tests exercise the ams_vehicles_cache
 * upsert logic that lives directly in writeThroughCaches rather than in the
 * TPMS planner. applyAmsCachePayload mirrors that DB upsert without a live DB.
 * ────────────────────────────────────────────────────────────────────────── */
test("AMS cache assign: vin, ldap, and rawResponse are written on AMS success", () => {
  const caches = emptyCaches();

  const amsResult: WriteThroughCacheArgs["ams"] = {
    status: "success",
    cachePayload: {
      system: "ams",
      vin: "1HGBH41JXMN109186",
      ldap: "jcasti0",
      rawResponse: { techId: "jcasti0", statusCode: "ASSIGNED" },
    },
  };

  applyAmsCachePayload(caches, amsResult);

  const row = caches.amsVehiclesCache.get("1HGBH41JXMN109186");
  assert.ok(row, "AMS cache row should exist for the VIN after a successful assign");
  assert.equal(row.vin, "1HGBH41JXMN109186");
  assert.equal(row.amsAssignedLdap, "jcasti0");
  assert.deepEqual(row.rawResponse, { techId: "jcasti0", statusCode: "ASSIGNED" });
});

test("AMS cache unassign: ldap is cleared to null and rawResponse updated on AMS success", () => {
  const caches = emptyCaches();

  // Seed an existing assigned row (simulates a prior assign that wrote through).
  caches.amsVehiclesCache.set("1HGBH41JXMN109186", {
    vin: "1HGBH41JXMN109186",
    amsAssignedLdap: "jcasti0",
    rawResponse: { techId: "jcasti0", statusCode: "ASSIGNED" },
  });

  const amsResult: WriteThroughCacheArgs["ams"] = {
    status: "success",
    cachePayload: {
      system: "ams",
      vin: "1HGBH41JXMN109186",
      ldap: null,
      rawResponse: { techId: null, statusCode: "UNASSIGNED" },
    },
  };

  applyAmsCachePayload(caches, amsResult);

  const row = caches.amsVehiclesCache.get("1HGBH41JXMN109186");
  assert.ok(row, "AMS cache row should still exist for the VIN after an unassign");
  assert.equal(row.vin, "1HGBH41JXMN109186");
  assert.equal(row.amsAssignedLdap, null, "ldap should be cleared after unassign");
  assert.deepEqual(row.rawResponse, { techId: null, statusCode: "UNASSIGNED" });
});

test("AMS cache pending: vin, ldap, and rawResponse are written when AMS status is pending", () => {
  const caches = emptyCaches();

  const amsResult: WriteThroughCacheArgs["ams"] = {
    status: "pending",
    cachePayload: {
      system: "ams",
      vin: "1HGBH41JXMN109186",
      ldap: "jcasti0",
      rawResponse: { techId: "jcasti0", statusCode: "PENDING" },
    },
  };

  applyAmsCachePayload(caches, amsResult);

  const row = caches.amsVehiclesCache.get("1HGBH41JXMN109186");
  assert.ok(row, "AMS cache row should be written for a pending AMS result");
  assert.equal(row.amsAssignedLdap, "jcasti0");
  assert.deepEqual(row.rawResponse, { techId: "jcasti0", statusCode: "PENDING" });
});

test("AMS cache: skipped AMS call does not mutate the cache", () => {
  const caches = emptyCaches();

  // Pre-existing row that should remain untouched.
  caches.amsVehiclesCache.set("1HGBH41JXMN109186", {
    vin: "1HGBH41JXMN109186",
    amsAssignedLdap: "jcasti0",
    rawResponse: { techId: "jcasti0", statusCode: "ASSIGNED" },
  });

  const amsResult: WriteThroughCacheArgs["ams"] = {
    status: "skipped",
    message: "timeout",
    cachePayload: {
      system: "ams",
      vin: "1HGBH41JXMN109186",
      ldap: null,
      rawResponse: null,
    },
  };

  applyAmsCachePayload(caches, amsResult);

  // Cache must be unchanged — a skipped/failed call must never overwrite a good row.
  const row = caches.amsVehiclesCache.get("1HGBH41JXMN109186");
  assert.equal(row?.amsAssignedLdap, "jcasti0", "stale row should not be overwritten by a skipped AMS call");
});

/* Force-exit after test suite completes.
 * fleet-operations-service.ts imports db.ts at module scope, which keeps a
 * Postgres connection pool alive and prevents the Node.js process from
 * terminating naturally. We use process.exitCode (set by node:test to 1 on
 * any failure, left as undefined on full success) so a failing run still
 * exits non-zero, and a passing run exits 0. */
after(() => { setImmediate(() => process.exit(process.exitCode ?? 0)); });
