import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

import express from "express";

import * as rentalOpsReadModel from "./rental-ops-read-model";
import {
  createOpenRentalsReadModelBuilder,
  OpenRentalsSourceUnavailableError,
} from "./rental-ops-read-model";
import { createExternalFleetReadRouter } from "./router";

const fixedNow = new Date("2026-07-12T12:00:00.000Z").getTime();
const ticketRows = [
  {
    VEHICLE_NUMBER: "123",
    RENTER_NAME: "SAMPLE OLDER",
    RENTAL_START_DATE: "2026-06-01",
    TICKET_STATUS: "OPEN",
    ECARS_2_0_TKT_NBR: "TKT-OLD",
    CLAIM_NUMBER: "700001-A/R",
  },
  {
    VEHICLE_NUMBER: "00123",
    RENTER_NAME: "SAMPLE LATEST",
    RENTAL_START_DATE: "2026-07-01",
    ORIGINAL_START_DATE: "2026-06-20",
    TICKET_STATUS: "OPEN",
    ECARS_2_0_TKT_NBR: "TKT-LATEST",
    CLAIM_NUMBER: "700002-B/R",
    DAYS_AUTHORIZED: "12",
    INITIAL_DAYS_AUTHORIZED: "5",
    NUMBER_OF_EXTENSIONS: "2",
    DAYS_BEHIND: "1",
    NUMBER_OF_REWRITES: "1",
  },
  {
    VEHICLE_NUMBER: "456",
    RENTER_NAME: "SAMPLE SECOND",
    RENTAL_START_DATE: "2026-07-03",
    TICKET_STATUS: "OPEN",
    ECARS_2_0_TKT_NBR: "TKT-SECOND",
    CLAIM_NUMBER: "700003-C/R",
  },
];

const holmanRows = [
  { VEHICLE_NUMBER: "789", RENTAL_VENDOR: "Enterprise Rent-A-Car", PO_NUMBER: "800001", PO_DATE: "2026-07-05" },
  { VEHICLE_NUMBER: "790", RENTAL_VENDOR: "Road Toll Services", PO_NUMBER: "800002", PO_DATE: "2026-07-06" },
  { VEHICLE_NUMBER: "00456", RENTAL_VENDOR: "Budget Sample", PO_NUMBER: "800003", PO_DATE: "2026-07-07" },
  { VEHICLE_NUMBER: "00888", RENTAL_VENDOR: "Avis Sample", PO_NUMBER: "'800004", PO_DATE: "2026-07-02", FIRST_NAME: "SYNTHETIC", LAST_NAME: "RENTER", ENTERPRISE_ID: "SRENTER", DIVISION: "D1", DISTRICT: "001" },
  { VEHICLE_NUMBER: "888", RENTAL_VENDOR: "Avis Sample", PO_NUMBER: "'800005", PO_DATE: "2026-07-10", FIRST_NAME: "SYNTHETIC", LAST_NAME: "RENTER", ENTERPRISE_ID: "SRENTER", DIVISION: "D1", DISTRICT: "001" },
  { VEHICLE_NUMBER: "999", RENTAL_VENDOR: "Hertz Sample", PO_NUMBER: "800006", PO_DATE: "2026-07-11", FIRST_NAME: "OOS", LAST_NAME: "RENTER", DIVISION: "D2", DISTRICT: "002" },
];

function syntheticBuilder() {
  return createOpenRentalsReadModelBuilder({
    isSnowflakeConfigured: () => true,
    getSnowflakeService: async () => ({
      connect: async () => undefined,
      executeQuery: async (query: string) => {
        if (query.includes("SELECT DISTINCT LPAD")) {
          return [{ VN: "00123" }, { VN: "00456" }];
        }
        return query.includes("ENTERPRISE_OPEN_RENTAL_TICKET_REPORT")
          ? ticketRows.map((row) => ({ ...row }))
          : holmanRows.map((row) => ({ ...row }));
      },
    }),
    getOosVehicleSet: async () => new Set(["00999"]),
    enrichEnterpriseIds: async (_client, rows) => {
      for (const row of rows) {
        if (row.source === "enterprise") {
          row.enterpriseId = `ID-${row.vehicleNumberPadded}`;
          row.enterpriseIdSource = "synthetic";
        }
      }
    },
    enrichWithTruckStatus: async (rows) => {
      for (const row of rows) {
        row.mainStatus = `MAIN-${row.vehicleNumberPadded}`;
        row.subStatus = `SUB-${row.vehicleNumberPadded}`;
      }
    },
    sourceUpdatedAt: () => null,
    now: () => fixedNow,
  });
}

{
  const build = syntheticBuilder();
  const result = await build({ includeOos: false, view: "business_logic" });

  assert.equal(result.sourceUpdatedAt, null);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.total, 3);
  assert.equal(result.enterpriseCount, 2);
  assert.equal(result.holmanNonEnterpriseCount, 2);
  assert.equal(result.totalHolmanPOLines, 6);
  assert.equal(result.oosFilteredCount, 1);
  assert.equal(result.view, "business_logic");

  assert.deepEqual(
    result.data.map((row) => [row.vehicleNumberPadded, row.source, row.poCount]),
    [
      ["00123", "enterprise", 1],
      ["00456", "enterprise", 1],
      ["00888", "holman_non_enterprise", 2],
    ],
  );
  assert.equal(result.data[0].ticketNumber, "TKT-LATEST");
  assert.equal(result.data[0].originalStartDate, "2026-06-20");
  assert.equal(result.data[0].poNumber, "700002");
  assert.equal(result.data[2].poNumber, "800005");
  assert.equal(result.data.some((row) => row.vehicleNumberPadded === "00789"), false);
  assert.equal(result.data.some((row) => row.vehicleNumberPadded === "00790"), false);
  assert.equal(result.data.some((row) => row.vehicleNumberPadded === "00999"), false);

  const legacyRouteFacingFixture = {
    data: [
      {
        vehicleNumber: "00123",
        vehicleNumberPadded: "00123",
        division: null,
        renterName: "SAMPLE LATEST",
        enterpriseId: "ID-00123",
        district: null,
        ticketNumber: "TKT-LATEST",
        poNumber: "700002",
        claimNumber: "700002-B/R",
        poDate: "2026-06-20",
        rentalStartDate: "2026-07-01",
        originalStartDate: "2026-06-20",
        isRewrite: true,
        rentalVendor: "Enterprise Rent-A-Car",
        ticketStatus: "OPEN",
        daysOpen: 22,
        daysAuthorized: 12,
        initialDaysAuthorized: 5,
        numberOfExtensions: 2,
        daysBehind: 1,
        numberOfRewrites: 1,
        repairsComplete: null,
        claimsOffice: null,
        poCount: 1,
        hasEnterpriseTicket: true,
        source: "enterprise",
        enterpriseIdSource: "synthetic",
        mainStatus: "MAIN-00123",
        subStatus: "SUB-00123",
      },
      {
        vehicleNumber: "456",
        vehicleNumberPadded: "00456",
        division: null,
        renterName: "SAMPLE SECOND",
        enterpriseId: "ID-00456",
        district: null,
        ticketNumber: "TKT-SECOND",
        poNumber: "700003",
        claimNumber: "700003-C/R",
        poDate: "2026-07-03",
        rentalStartDate: "2026-07-03",
        originalStartDate: "2026-07-03",
        isRewrite: false,
        rentalVendor: "Enterprise Rent-A-Car",
        ticketStatus: "OPEN",
        daysOpen: 9,
        daysAuthorized: null,
        initialDaysAuthorized: null,
        numberOfExtensions: 0,
        daysBehind: 0,
        numberOfRewrites: 0,
        repairsComplete: null,
        claimsOffice: null,
        poCount: 1,
        hasEnterpriseTicket: true,
        source: "enterprise",
        enterpriseIdSource: "synthetic",
        mainStatus: "MAIN-00456",
        subStatus: "SUB-00456",
      },
      {
        vehicleNumber: "888",
        vehicleNumberPadded: "00888",
        division: "D1",
        renterName: "SYNTHETIC RENTER",
        enterpriseId: "SRENTER",
        district: "001",
        poNumber: "800005",
        poDate: "2026-07-10",
        rentalStartDate: "2026-07-10",
        rentalVendor: "Avis Sample",
        daysOpen: 2,
        poCount: 2,
        hasEnterpriseTicket: false,
        source: "holman_non_enterprise",
        enterpriseIdSource: "direct",
        mainStatus: "MAIN-00888",
        subStatus: "SUB-00888",
      },
    ],
    total: 3,
    enterpriseCount: 2,
    holmanNonEnterpriseCount: 2,
    totalHolmanPOLines: 6,
    oosFilteredCount: 1,
    view: "business_logic",
    sourceUpdatedAt: null,
    warnings: [],
  };
  assert.deepEqual(result, legacyRouteFacingFixture);
}

{
  let sourceQueryCount = 0;
  const dependencies = {
    isSnowflakeConfigured: () => true,
    getSnowflakeService: async () => ({
      connect: async () => undefined,
      executeQuery: async (query: string) => {
        sourceQueryCount++;
        return query.includes("ENTERPRISE_OPEN_RENTAL_TICKET_REPORT")
          ? ticketRows.map((row) => ({ ...row }))
          : holmanRows.map((row) => ({ ...row }));
      },
    }),
    getOosVehicleSet: async () => new Set<string>(),
    enrichEnterpriseIds: async () => undefined,
    enrichWithTruckStatus: async () => undefined,
    sourceUpdatedAt: () => null,
    now: () => fixedNow,
  };
  const firstBuilder = createOpenRentalsReadModelBuilder(dependencies);
  const secondBuilder = createOpenRentalsReadModelBuilder(dependencies);
  const input = { fileDate: "2026-07-09", includeOos: true, view: "business_logic" as const };

  await firstBuilder(input);
  const cached = await secondBuilder(input) as typeof legacyRouteFacingFixture & { _cachedAt?: number };

  assert.equal(sourceQueryCount, 2);
  assert.equal(typeof cached._cachedAt, "number");
}

{
  const clearRentalOpsCache = (rentalOpsReadModel as any).clearRentalOpsCache;
  const toLegacyOpenRentalsResponse = (rentalOpsReadModel as any).toLegacyOpenRentalsResponse;
  assert.equal(typeof clearRentalOpsCache, "function");
  assert.equal(typeof toLegacyOpenRentalsResponse, "function");

  clearRentalOpsCache();
  let sourceQueryCount = 0;
  const build = createOpenRentalsReadModelBuilder({
    isSnowflakeConfigured: () => true,
    getSnowflakeService: async () => ({
      connect: async () => undefined,
      executeQuery: async (query: string) => {
        sourceQueryCount++;
        return query.includes("ENTERPRISE_OPEN_RENTAL_TICKET_REPORT")
          ? ticketRows.map((row) => ({ ...row }))
          : holmanRows.map((row) => ({ ...row }));
      },
    }),
    getOosVehicleSet: async () => new Set<string>(),
    enrichEnterpriseIds: async () => undefined,
    enrichWithTruckStatus: async () => undefined,
    sourceUpdatedAt: () => null,
    now: () => fixedNow,
  });
  const input = { fileDate: "2026-07-08", includeOos: true, view: "business_logic" as const };

  const miss = await build(input) as Record<string, unknown>;
  assert.equal(sourceQueryCount, 2);
  assert.equal("_cachedAt" in miss, false);

  const hit = await build(input) as Record<string, unknown>;
  assert.equal(sourceQueryCount, 2);
  assert.equal(typeof hit._cachedAt, "number");

  const legacy = toLegacyOpenRentalsResponse(hit) as Record<string, unknown>;
  assert.equal("sourceUpdatedAt" in legacy, false);
  assert.equal("warnings" in legacy, false);
  assert.equal(typeof legacy._cachedAt, "number");
  assert.equal(legacy.view, "business_logic");
  assert.equal(Array.isArray(legacy.data), true);

  clearRentalOpsCache();
  const afterClear = await build(input) as Record<string, unknown>;
  assert.equal(sourceQueryCount, 4);
  assert.equal("_cachedAt" in afterClear, false);
}

{
  const result = await syntheticBuilder()({ includeOos: true, view: "business_logic" });
  assert.equal(result.total, 4);
  assert.equal(result.oosFilteredCount, 0);
  assert.equal(result.data.some((row) => row.vehicleNumberPadded === "00999"), true);
}

{
  const result = await syntheticBuilder()({ includeOos: false, view: "raw" });
  assert.equal(result.view, "raw");
  assert.equal(result.total, 6);
  assert.equal(result.totalPOLines, 6);
  assert.equal(result.data.filter((row) => row.vehicleNumberPadded === "00888").length, 2);
  assert.equal(result.data.find((row) => row.vehicleNumberPadded === "00456")?.hasEnterpriseTicket, true);
  assert.equal(result.data.find((row) => row.vehicleNumberPadded === "00999")?.source, "holman_raw");
}

{
  const build = createOpenRentalsReadModelBuilder({
    isSnowflakeConfigured: () => true,
    getSnowflakeService: async () => ({
      connect: async () => undefined,
      executeQuery: async () => {
        throw new Error("synthetic upstream detail must stay private");
      },
    }),
    getOosVehicleSet: async () => new Set(),
    enrichEnterpriseIds: async () => undefined,
    enrichWithTruckStatus: async () => undefined,
    sourceUpdatedAt: () => null,
    now: () => fixedNow,
  });
  await assert.rejects(
    () => build({ includeOos: false, view: "business_logic" }),
    OpenRentalsSourceUnavailableError,
  );
}

const modulesKey = "sample-modules-key-at-least-24";
const profilesKey = "sample-profiles-key-at-least-24";
const consumers = [
  { consumerId: "modules", key: modulesKey, scopes: ["modules:read" as const] },
  { consumerId: "profiles", key: profilesKey, scopes: ["profiles:read" as const] },
];

async function withRouter(
  builder: Parameters<typeof createExternalFleetReadRouter>[1],
  run: (baseUrl: string) => Promise<void>,
) {
  const app = express();
  app.use("/api/external/fleet/v1", createExternalFleetReadRouter(consumers, builder));
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
  const reached: unknown[] = [];
  const builder = async (input: unknown) => {
    reached.push(input);
    return {
      data: [{ vehicleNumberPadded: "00123", source: "enterprise" }],
      total: 1,
      enterpriseCount: 1,
      holmanNonEnterpriseCount: 0,
      totalHolmanPOLines: 0,
      oosFilteredCount: 0,
      view: (input as { view: "business_logic" | "raw" }).view,
      sourceUpdatedAt: null,
      warnings: [],
    };
  };
  await withRouter(builder, async (baseUrl) => {
    const path = "/api/external/fleet/v1/modules/rental-ops-open-rentals";
    assert.equal((await fetch(`${baseUrl}${path}`)).status, 401);
    assert.equal((await fetch(`${baseUrl}${path}`, { headers: { Authorization: "Bearer invalid-key-at-least-24" } })).status, 401);
    assert.equal((await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${profilesKey}` } })).status, 403);

    const invalid = await fetch(`${baseUrl}${path}?unexpected=value`, { headers: { Authorization: `Bearer ${modulesKey}` } });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error.code, "INVALID_QUERY");

    const business = await fetch(`${baseUrl}${path}?fileDate=2026-07-10&includeOos=true`, { headers: { Authorization: `Bearer ${modulesKey}` } });
    assert.equal(business.status, 200);
    const businessBody = await business.json();
    assert.equal(businessBody.apiVersion, "1.0.0");
    assert.equal(businessBody.sourceUpdatedAt, null);
    assert.equal(businessBody.freshness.state, "unknown");
    assert.equal(businessBody.data.total, 1);
    assert.deepEqual(reached[0], { fileDate: "2026-07-10", includeOos: true, view: "business_logic" });

    const raw = await fetch(`${baseUrl}${path}?view=raw&includeOos=false`, { headers: { Authorization: `Bearer ${modulesKey}` } });
    assert.equal(raw.status, 200);
    assert.equal((await raw.json()).data.view, "raw");
    assert.deepEqual(reached[1], { includeOos: false, view: "raw" });

    const callsBeforePost = reached.length;
    const post = await fetch(`${baseUrl}${path}`, { method: "POST", headers: { Authorization: `Bearer ${modulesKey}` } });
    assert.equal(post.status, 405);
    assert.equal(reached.length, callsBeforePost);
  });
}

{
  const builder = async () => {
    throw new OpenRentalsSourceUnavailableError(new Error("private synthetic SQL and table detail"));
  };
  await withRouter(builder, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/external/fleet/v1/modules/rental-ops-open-rentals`, {
      headers: { Authorization: `Bearer ${modulesKey}` },
    });
    assert.equal(response.status, 503);
    const bodyText = await response.text();
    assert.equal(bodyText.includes("private synthetic SQL"), false);
    assert.equal(JSON.parse(bodyText).error.code, "SOURCE_UNAVAILABLE");
  });
}
