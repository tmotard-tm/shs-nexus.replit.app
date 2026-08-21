/**
 * Task #711 — pool-level regression test for the spares-pool OOS exclusion.
 *
 * Task #662 put the exclusion inside fetchActiveCacheRows (server/spares-pool.ts)
 * via filterInServiceRows. The pure classifier is unit-tested in
 * tests/holman-oos-exclusion.test.ts, but nothing pinned POOL behavior: a
 * refactor that rebuilds the cache query without the filter — or drops the
 * statusCode/outOfServiceDate columns from the select, silently turning the
 * predicate into a no-op on undefined fields — would quietly re-admit
 * out-of-service trucks as assignable spares.
 *
 * This test hits the real dev Postgres. It seeds holman_vehicles_cache rows
 * (test-only `_t711_` truck numbers, so a failed run cannot stomp real fleet
 * data) covering:
 *   - an in-service control row            → MUST appear (proves non-vacuous)
 *   - the cache-lag shape: statusCode=1
 *     with a past ISO-Z outOfServiceDate   → MUST NEVER appear
 *   - hard OOS: statusCode=2               → MUST NEVER appear
 *   - a FUTURE outOfServiceDate (scheduled,
 *     not effective)                       → MUST appear
 * and asserts both the shared fetchActiveCacheRows and the getSparePoolLite
 * surface (same derivation getNexusUnassignedVehicles builds on — the full
 * pool is not called directly here because it can fall back to Snowflake and
 * runs AMS/zip enrichment, which would make this test network-flaky).
 *
 * A final sweep asserts the pool-wide invariant on REAL data too: no pool
 * member may be backed exclusively by out-of-service cache rows.
 *
 * Cleans up after itself. Run: npx tsx --test tests/spares-pool-oos.test.ts
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { inArray } from "drizzle-orm";

import { db, pool } from "../server/db.js";
import { holmanVehiclesCache } from "../shared/schema.js";
import {
  fetchActiveCacheRows,
  getSparePoolLite,
  canonicalTruckNumber,
} from "../server/spares-pool.js";
import { isOutOfServiceRecord } from "../server/holman-oos-policy.js";

const DAY_MS = 24 * 60 * 60 * 1000;
// Exact cache-lag shape observed on the 10 BYOV OOS trucks: full ISO-Z
// timestamp, date safely in the past regardless of UTC/ET boundary.
const PAST_ISO_Z = new Date(Date.now() - 5 * DAY_MS).toISOString().slice(0, 10) + "T00:00:00Z";
const FUTURE_ISO_Z = new Date(Date.now() + 30 * DAY_MS).toISOString().slice(0, 10) + "T00:00:00Z";

const IN_SERVICE = "_t711_inservice";
const CACHE_LAG = "_t711_cachelag"; // statusCode still 1, past outOfServiceDate
const HARD_OOS = "_t711_hardoos"; // statusCode 2
const FUTURE_OOS = "_t711_futureoos"; // scheduled, not yet effective

const ALL_NUMBERS = [IN_SERVICE, CACHE_LAG, HARD_OOS, FUTURE_OOS];

// Must mirror ALLOWED_DIVISIONS in server/spares-pool.ts — seeded rows have to
// pass the query's division gate or the control-row assertion goes vacuous.
const DIVISION = "01";

function seedRow(overrides: {
  holmanVehicleNumber: string;
  statusCode: number;
  outOfServiceDate: string | null;
}) {
  return {
    holmanVehicleNumber: overrides.holmanVehicleNumber,
    vin: `${overrides.holmanVehicleNumber}_vin`,
    makeName: "T711",
    modelName: "Fixture",
    district: "9711",
    division: DIVISION,
    isActive: true,
    statusCode: overrides.statusCode,
    outOfServiceDate: overrides.outOfServiceDate,
    tpmsAssignedTechId: null,
    dataSource: "test",
  };
}

async function cleanup() {
  await db
    .delete(holmanVehiclesCache)
    .where(inArray(holmanVehiclesCache.holmanVehicleNumber, ALL_NUMBERS));
}

before(async () => {
  await cleanup();
  await db.insert(holmanVehiclesCache).values([
    seedRow({ holmanVehicleNumber: IN_SERVICE, statusCode: 1, outOfServiceDate: null }),
    seedRow({ holmanVehicleNumber: CACHE_LAG, statusCode: 1, outOfServiceDate: PAST_ISO_Z }),
    seedRow({ holmanVehicleNumber: HARD_OOS, statusCode: 2, outOfServiceDate: PAST_ISO_Z }),
    seedRow({ holmanVehicleNumber: FUTURE_OOS, statusCode: 1, outOfServiceDate: FUTURE_ISO_Z }),
  ]);
});

after(async () => {
  await cleanup();
  await pool.end(); // let the test runner exit without --test-force-exit
});

test("fetchActiveCacheRows: OOS rows (cache-lag AND statusCode=2) never enter the active set; in-service + future-scheduled do", async () => {
  const rows = await fetchActiveCacheRows();
  const numbers = new Set(rows.map((r) => r.holmanVehicleNumber));

  // Control rows prove the seeds actually flow through the query — without
  // this, the exclusion assertions below could pass vacuously (e.g. if the
  // query's division/isActive gates silently dropped every fixture).
  assert.ok(numbers.has(IN_SERVICE), "in-service control row must be in the active set");
  assert.ok(
    numbers.has(FUTURE_OOS),
    "FUTURE outOfServiceDate is scheduled, not effective — row must stay in the active set",
  );

  assert.ok(
    !numbers.has(CACHE_LAG),
    "cache-lag row (statusCode=1, past ISO-Z outOfServiceDate) must NEVER enter the active set",
  );
  assert.ok(
    !numbers.has(HARD_OOS),
    "statusCode=2 row must NEVER enter the active set",
  );

  // Column-shape guard: if a refactor drops the lifecycle columns from the
  // select, filterInServiceRows becomes a silent no-op on undefined fields.
  // The control row must carry BOTH fields explicitly (null is fine,
  // undefined is the regression).
  const control = rows.find((r) => r.holmanVehicleNumber === IN_SERVICE)!;
  assert.notEqual(control.statusCode, undefined, "select must include statusCode");
  assert.notEqual(
    control.outOfServiceDate,
    undefined,
    "select must include outOfServiceDate",
  );
});

test("getSparePoolLite: an out-of-service truck never appears as an assignable spare", async () => {
  const lite = await getSparePoolLite();
  // A null pool here means a sanity guard tripped (empty cache/occupied set or
  // implausible pool ratio) — on the dev DB that is itself a failure signal,
  // and letting it pass would make the OOS assertions vacuous.
  assert.ok(
    lite,
    "getSparePoolLite returned null — dev DB guards tripped, OOS assertions cannot run",
  );

  const numbers = new Set(lite.vehicles.map((v) => v.truckNumber));
  assert.ok(
    numbers.has(canonicalTruckNumber(IN_SERVICE)),
    "in-service, unassigned control row must be offered as a spare",
  );
  assert.ok(
    !numbers.has(canonicalTruckNumber(CACHE_LAG)),
    "cache-lag OOS truck (statusCode=1, past outOfServiceDate) must NEVER be offered as a spare",
  );
  assert.ok(
    !numbers.has(canonicalTruckNumber(HARD_OOS)),
    "statusCode=2 truck must NEVER be offered as a spare",
  );
});

test("pool-wide invariant: every spare is backed by at least one in-service cache row", async () => {
  const lite = await getSparePoolLite();
  assert.ok(lite, "getSparePoolLite returned null — cannot verify the invariant");

  // Candidate source rows = what the pool query scans (active, allowed
  // division). Legacy dup-format rows can leave one canonical number with
  // several cache rows; the pool legitimately includes a truck when ANY of
  // its candidate rows is in service, so the invariant is: no pool member may
  // be backed EXCLUSIVELY by out-of-service rows.
  const all = await db
    .select({
      holmanVehicleNumber: holmanVehiclesCache.holmanVehicleNumber,
      statusCode: holmanVehiclesCache.statusCode,
      outOfServiceDate: holmanVehiclesCache.outOfServiceDate,
      isActive: holmanVehiclesCache.isActive,
      division: holmanVehiclesCache.division,
    })
    .from(holmanVehiclesCache);

  const byCanon = new Map<string, typeof all>();
  for (const r of all) {
    if (!r.isActive || !["01", "RF"].includes(r.division || "")) continue;
    const canon = canonicalTruckNumber(r.holmanVehicleNumber);
    if (!canon) continue;
    const list = byCanon.get(canon) ?? [];
    list.push(r);
    byCanon.set(canon, list);
  }

  const offenders: string[] = [];
  for (const v of lite.vehicles) {
    const candidates = byCanon.get(v.truckNumber) ?? [];
    const anyInService = candidates.some((r) => !isOutOfServiceRecord(r));
    if (!anyInService) offenders.push(v.truckNumber);
  }
  assert.deepEqual(
    offenders,
    [],
    `spare pool contains truck(s) whose cache rows are ALL out of service: ${offenders.join(", ")}`,
  );
});
