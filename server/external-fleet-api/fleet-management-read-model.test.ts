import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

import express from "express";

import {
  createFleetManagementProductionDependencies,
  createFleetManagementListingBuilder,
  FleetManagementPrimarySourceUnavailableError,
  type FleetManagementListingDependencies,
  type FleetManagementListingInput,
} from "./fleet-management-read-model";
import { createExternalFleetReadRouter } from "./router";

const SOURCE_TIME = "2026-07-12T09:00:00.000Z";

function source<T>(data: T, sourceUpdatedAt: string | null = SOURCE_TIME, stale = false) {
  return { data, sourceUpdatedAt, stale };
}

function syntheticDependencies(): FleetManagementListingDependencies {
  return {
    readPrimaryVehicles: async () => source([
      {
        vehicleNumber: "061101",
        vin: "SYNTHETIC-VIN-A",
        holmanTechAssigned: "HOLMAN01",
        holmanTechName: "Holman Sample",
        tpmsAssignedTechId: "TPMS02",
        tpmsAssignedTechName: "Tpms Sample",
        statusCode: 1,
        driverEmail: "forbidden@example.invalid",
        password: "forbidden-secret",
        homeAddress: "forbidden-address",
        rawData: { credential: "forbidden-raw" },
      },
      {
        vehicleNumber: "12",
        vin: "SYNTHETIC-VIN-B",
        holmanTechAssigned: "ALPHA01",
        holmanTechName: "Alpha Sample",
        tpmsAssignedTechId: "ALPHA01",
        tpmsAssignedTechName: "Alpha Sample",
        statusCode: 1,
      },
      {
        vehicleNumber: "100",
        vin: "SYNTHETIC-VIN-C",
        holmanTechAssigned: "",
        holmanTechName: "",
        tpmsAssignedTechId: "",
        tpmsAssignedTechName: "",
        statusCode: 2,
        outOfServiceDate: "2026-07-01",
      },
      {
        vehicleNumber: "99",
        vin: "SYNTHETIC-VIN-D",
        holmanTechAssigned: "ZULU01",
        holmanTechName: "Zulu Sample",
        tpmsAssignedTechId: "ZULU01",
        tpmsAssignedTechName: "Zulu Sample",
        statusCode: 1,
      },
    ], SOURCE_TIME, true),
    readFleetOps: async () => source([
      {
        truckNumber: "61101",
        holmanTechId: "FLEET-HOLMAN",
        tpmsTechId: "FLEET-TPMS",
        amsTechId: "FLEET-AMS",
        rootCause: "external_tpms_change",
      },
    ]),
    readTpmsSync: async () => source({ status: "idle", initialSyncComplete: true }),
    readRentalOps: async () => source(["00012", "061101"]),
    readAmsStatuses: async () => source([
      { vin: "SYNTHETIC-VIN-A", truckStatus: "Declined Repair" },
      { vin: "SYNTHETIC-VIN-D", truckStatus: "Active" },
    ]),
    readPoFlags: async () => source([
      { truckNumber: "61101", hasOpenRental: true, openRentalCount: 2, hasOpenMaintenance: true, openMaintenanceCount: 1 },
    ]),
    readRepairShopFlags: async () => source([{ truckNumber: "061101", value: true }]),
    readOffboardingFlags: async () => source([{ truckNumber: "61101", value: true }]),
    readDtcStatuses: async () => source([
      { truckNumber: "061101", severityScore: 72, severityLabel: "CRITICAL" },
    ]),
    readTechnicianStatuses: async () => source([
      { enterpriseId: "TPMS02", employmentStatus: "A" },
      { enterpriseId: "ALPHA01", employmentStatus: "A" },
      { enterpriseId: "ZULU01", employmentStatus: "T" },
    ]),
  };
}

function input(overrides: Partial<FleetManagementListingInput> = {}): FleetManagementListingInput {
  return {
    page: 1,
    pageSize: 100,
    sort: "truckNumber",
    direction: "asc",
    ...overrides,
  };
}

{
  const build = createFleetManagementListingBuilder(syntheticDependencies());
  const page = await build(input({ pageSize: 2 }));
  assert.equal(page.rows.length, 2);
  assert.equal(page.totalCount, 4);
  assert.deepEqual(page.rows.map((row) => row.truckNumber), ["00012", "00099"]);
}

{
  const build = createFleetManagementListingBuilder(syntheticDependencies());
  const first = await build(input({ page: 1, pageSize: 2 }));
  const second = await build(input({ page: 2, pageSize: 2 }));
  assert.deepEqual(second.rows.map((row) => row.truckNumber), ["00100", "61101"]);
  assert.equal(first.rows.some((row) => second.rows.some((candidate) => candidate.truckNumber === row.truckNumber)), false);
  assert.deepEqual((await build(input({ page: 2, pageSize: 2 }))).rows, second.rows);
}

{
  const build = createFleetManagementListingBuilder(syntheticDependencies());
  const filtered = await build(input({ pageSize: 1, query: "rental" }));
  assert.equal(filtered.totalCount, 2);
  assert.equal(filtered.rows.length, 1);
}

{
  const build = createFleetManagementListingBuilder(syntheticDependencies());
  const sorts: FleetManagementListingInput["sort"][] = ["truckNumber", "vehicleNumber", "technician", "status"];
  const directions: FleetManagementListingInput["direction"][] = ["asc", "desc"];
  for (const sort of sorts) {
    for (const direction of directions) {
      const requested = input({ sort, direction });
      const first = await build(requested);
      const second = await build(requested);
      assert.deepEqual(first.rows.map((row) => row.truckNumber), second.rows.map((row) => row.truckNumber));
      assert.equal(new Set(first.rows.map((row) => row.truckNumber)).size, 4);
    }
  }
}

{
  const result = await createFleetManagementListingBuilder(syntheticDependencies())(input());
  const joined = result.rows.find((row) => row.truckNumber === "61101");
  assert.ok(joined);
  assert.equal(result.rows.filter((row) => row.truckNumber === "61101").length, 1);
  assert.equal(joined.displayedStatuses.fleetOpsRootCause, "external_tpms_change");
  assert.equal(joined.displayedStatuses.rentalOpsOpen, true);
  assert.equal(joined.displayedStatuses.inRepairShop, true);
  assert.equal(joined.displayedStatuses.offboardingFlagged, true);
  assert.equal(joined.displayedStatuses.samsaraCheckEngine, true);
}

{
  const dependencies = syntheticDependencies();
  dependencies.readAmsStatuses = async () => {
    throw new Error("synthetic AMS private detail");
  };
  const result = await createFleetManagementListingBuilder(dependencies)(input());
  const row = result.rows.find((candidate) => candidate.truckNumber === "61101");
  assert.ok(row);
  assert.equal(row.sourceIndicators.ams, "missing");
  assert.equal("amsTruckStatus" in row.displayedStatuses, false);
  assert.equal(row.warnings.some((warning) => warning.code === "SOURCE_UNAVAILABLE"), true);
}

{
  const dependencies = syntheticDependencies();
  dependencies.readPrimaryVehicles = async () => {
    throw new Error("private cached table and credential detail");
  };
  await assert.rejects(
    () => createFleetManagementListingBuilder(dependencies)(input()),
    FleetManagementPrimarySourceUnavailableError,
  );
}

{
  const result = await createFleetManagementListingBuilder(syntheticDependencies())(input());
  const row = result.rows.find((candidate) => candidate.truckNumber === "61101");
  assert.ok(row);
  assert.equal(row.displayedStatuses.holmanAssignmentEnterpriseId, "HOLMAN01");
  assert.equal(row.displayedStatuses.tpmsAssignmentEnterpriseId, "TPMS02");
  assert.equal(row.displayedStatuses.fleetOpsHolmanEnterpriseId, "FLEET-HOLMAN");
  assert.equal(row.displayedStatuses.fleetOpsTpmsEnterpriseId, "FLEET-TPMS");
  assert.equal(row.displayedStatuses.fleetOpsAmsEnterpriseId, "FLEET-AMS");
  assert.equal(row.warnings.some((warning) => warning.code === "AMBIGUOUS_MATCH"), true);
}

{
  const result = await createFleetManagementListingBuilder(syntheticDependencies())(input());
  const serialized = JSON.stringify(result);
  for (const forbidden of [
    "driverEmail", "password", "homeAddress", "rawData", "credential",
    "forbidden@example.invalid", "forbidden-secret", "forbidden-address", "forbidden-raw",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `forbidden output: ${forbidden}`);
  }
}

{
  const dependencies = syntheticDependencies();
  for (const key of Object.keys(dependencies) as Array<keyof FleetManagementListingDependencies>) {
    const original = dependencies[key] as () => Promise<{ data: unknown; sourceUpdatedAt: string | null; stale?: boolean }>;
    (dependencies as any)[key] = async () => {
      const result = await original();
      return { ...result, sourceUpdatedAt: null, stale: false };
    };
  }
  const result = await createFleetManagementListingBuilder(dependencies)(input());
  assert.equal(result.rows.every((row) => row.sourceUpdatedAt === null), true);
  assert.equal(result.rows.every((row) => Object.values(row.sourceIndicators).every((indicator) => indicator === "unknown")), true);
}

{
  let readCalls = 0;
  let fetchCalls = 0;
  const service = {
    readCachedVehicles: async () => {
      readCalls++;
      return {
        success: true,
        vehicles: [{ vehicleNumber: "1", vin: "SYNTHETIC-WIRING" }],
        syncStatus: { dataMode: "cached", isStale: true, lastSyncAt: null },
        pagination: { page: 1, pageSize: 500, totalCount: 1, totalPages: 1 },
      };
    },
    fetchActiveVehicles: async () => {
      fetchCalls++;
      throw new Error("fetchActiveVehicles must never be used by the external listing");
    },
  };
  const dependencies = createFleetManagementProductionDependencies(async () => service);
  await dependencies.readPrimaryVehicles();
  assert.equal(readCalls, 1);
  assert.equal(fetchCalls, 0);
}

const modulesKey = "sample-modules-key-at-least-24";
const profilesKey = "sample-profiles-key-at-least-24";
const consumers = [
  { consumerId: "modules", key: modulesKey, scopes: ["modules:read" as const] },
  { consumerId: "profiles", key: profilesKey, scopes: ["profiles:read" as const] },
];

async function withRouter(
  listingBuilder: Parameters<typeof createExternalFleetReadRouter>[2],
  run: (baseUrl: string) => Promise<void>,
) {
  const app = express();
  const rentalBuilder = async () => ({
    data: [], total: 0, enterpriseCount: 0, holmanNonEnterpriseCount: 0,
    totalHolmanPOLines: 0, oosFilteredCount: 0, view: "business_logic" as const,
    sourceUpdatedAt: null, warnings: [],
  });
  app.use("/api/external/fleet/v1", createExternalFleetReadRouter(consumers, rentalBuilder, listingBuilder));
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
    const candidate = app.listen(0, "127.0.0.1", () => resolve(candidate));
    candidate.once("error", reject);
  });
  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

{
  const reached: FleetManagementListingInput[] = [];
  const builder = async (builderInput: FleetManagementListingInput) => {
    reached.push(builderInput);
    return { page: builderInput.page, pageSize: builderInput.pageSize, totalCount: 0, rows: [] };
  };
  await withRouter(builder, async (baseUrl) => {
    const path = "/api/external/fleet/v1/modules/fleet-management-listing";
    assert.equal((await fetch(`${baseUrl}${path}`)).status, 401);
    assert.equal((await fetch(`${baseUrl}${path}`, { headers: { Authorization: "Bearer invalid-key-at-least-24" } })).status, 401);
    assert.equal((await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${profilesKey}` } })).status, 403);

    const valid = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${modulesKey}` } });
    assert.equal(valid.status, 200);
    const body = await valid.json();
    assert.equal(body.apiVersion, "1.0.0");
    assert.equal(body.data.page, 1);
    assert.equal(body.data.pageSize, 100);
    assert.deepEqual(reached[0], { page: 1, pageSize: 100, sort: "truckNumber", direction: "asc" });

    const badQueries = [
      "pageSize=0", "pageSize=501", "sort=unknown", "direction=sideways",
      `query=${"x".repeat(121)}`, "unexpected=value",
    ];
    for (const query of badQueries) {
      const response = await fetch(`${baseUrl}${path}?${query}`, { headers: { Authorization: `Bearer ${modulesKey}` } });
      assert.equal(response.status, 400, query);
      assert.equal((await response.json()).error.code, "INVALID_QUERY");
    }

    const requested = await fetch(`${baseUrl}${path}?page=2&pageSize=25&sort=technician&direction=desc&query=sample`, {
      headers: { Authorization: `Bearer ${modulesKey}` },
    });
    assert.equal(requested.status, 200);
    assert.deepEqual(reached.at(-1), { page: 2, pageSize: 25, sort: "technician", direction: "desc", query: "sample" });

    const callsBeforePost = reached.length;
    const post = await fetch(`${baseUrl}${path}`, { method: "POST", headers: { Authorization: `Bearer ${modulesKey}` } });
    assert.equal(post.status, 405);
    assert.equal(reached.length, callsBeforePost);
  });
}

{
  const builder = async () => {
    throw new FleetManagementPrimarySourceUnavailableError(new Error("private source table and credential text"));
  };
  await withRouter(builder, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/external/fleet/v1/modules/fleet-management-listing`, {
      headers: { Authorization: `Bearer ${modulesKey}` },
    });
    assert.equal(response.status, 503);
    const text = await response.text();
    assert.equal(text.includes("private source table"), false);
    assert.equal(text.includes("credential"), false);
    assert.equal(JSON.parse(text).error.code, "SOURCE_UNAVAILABLE");
  });
}
