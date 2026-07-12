import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

import express from "express";

import {
  EXTRACT_FRESHNESS_WINDOW_SECONDS,
  createTpmsObservationBuilders,
  type TpmsLocalRecord,
  type TpmsLookup,
  type TpmsReadModelDependencies,
} from "./tpms-read-model";
import {
  createProfileBuilders,
  type ProfileBuilders,
} from "./profiles";
import { createExternalFleetReadRouter } from "./router";

const NOW = Date.parse("2026-07-12T16:00:00.000Z");
const RECENT = "2026-07-12T15:00:00.000Z";

function record(
  sourceLayer: TpmsLocalRecord["sourceLayer"],
  enterpriseId: string,
  technicianName: string,
  truckNumber: string | null,
  observedAt: string | null = RECENT,
  overrides: Partial<TpmsLocalRecord> = {},
): TpmsLocalRecord {
  return {
    sourceLayer,
    enterpriseId,
    technicianName,
    truckNumber,
    district: "D01",
    mobileNumber: "5550100100",
    jobTitle: null,
    planningArea: null,
    managerName: "Synthetic Manager",
    managerEnterpriseId: "MGR01",
    observedAt,
    sourceUpdatedAt: observedAt,
    ...overrides,
  };
}

function matches(row: TpmsLocalRecord, lookup: TpmsLookup): boolean {
  if (lookup.kind === "enterpriseId") {
    return row.enterpriseId?.trim().toUpperCase() === lookup.value.trim().toUpperCase();
  }
  if (lookup.kind === "truckNumber") {
    const canonical = (value: string | null) => (value ?? "").trim().replace(/^0+/, "") || "0";
    return canonical(row.truckNumber) === canonical(lookup.value);
  }
  const query = lookup.value.trim().toLowerCase();
  return row.enterpriseId?.toLowerCase() === query
    || row.technicianName?.toLowerCase().includes(query)
    || row.truckNumber === lookup.value;
}

function dependencies(args: {
  live?: TpmsLocalRecord[];
  cached?: TpmsLocalRecord[];
  extract?: TpmsLocalRecord[];
  failLive?: boolean;
  failCached?: boolean;
  failExtract?: boolean;
} = {}): TpmsReadModelDependencies {
  return {
    now: () => NOW,
    readLive: async (lookup) => {
      if (args.failLive) throw new Error("private live table detail");
      return (args.live ?? []).filter((row) => matches(row, lookup));
    },
    readCached: async (lookup) => {
      if (args.failCached) throw new Error("private cached credential detail");
      return (args.cached ?? []).filter((row) => matches(row, lookup));
    },
    readExtract: async (lookup) => {
      if (args.failExtract) throw new Error("private extract source detail");
      return (args.extract ?? []).filter((row) => matches(row, lookup));
    },
  };
}

{
  const builders = createTpmsObservationBuilders(dependencies({
    live: [record("live", "SYNTH01", "Sample One", "061101")],
    cached: [record("cached", "SYNTH01", "Sample One", "61101")],
  }));
  const result = await builders.buildByTruckNumber("61101");
  assert.equal(result.observations.length, 2);
  assert.deepEqual(result.observations.map((item) => item.sourceLayer), ["live", "cached"]);
  assert.equal(result.observations[0].value.truckNumber, "061101");
  assert.equal(result.observations[0].normalizedValue?.truckNumber, "61101");
  assert.equal(result.observations[1].value.truckNumber, "61101");
  assert.equal(result.observations[1].normalizedValue, undefined);
}

{
  const builders = createTpmsObservationBuilders(dependencies({
    live: [record("live", "SYNTH01", "Sample One", "061101")],
    cached: [record("cached", "SYNTH02", "Sample Two", "61101")],
  }));
  const result = await builders.buildByTruckNumber("061101");
  assert.deepEqual(result.observations.map((item) => item.value.enterpriseId), ["SYNTH01", "SYNTH02"]);
  assert.equal(result.warnings.some((warning) => warning.code === "PARTIAL_DATA"), true);
}

{
  const staleTime = new Date(NOW - (EXTRACT_FRESHNESS_WINDOW_SECONDS + 1) * 1000).toISOString();
  const builders = createTpmsObservationBuilders(dependencies({
    extract: [record("extract", "EXTRACT01", "Extract Sample", "77", staleTime)],
  }));
  const result = await builders.buildByEnterpriseId(" extract01 ");
  assert.equal(result.observations.length, 1);
  assert.equal(result.observations[0].sourceLayer, "extract");
  assert.equal(result.observations[0].freshness.state, "stale");
  assert.equal(result.warnings.some((warning) => warning.code === "SOURCE_STALE"), true);
}

{
  const builders = createTpmsObservationBuilders(dependencies({
    live: [record("live", "UNKNOWN01", "Unknown Time", "88", null)],
  }));
  const result = await builders.buildByEnterpriseId("UNKNOWN01");
  assert.equal(result.observations[0].freshness.state, "unknown");
  assert.equal(result.observations[0].freshness.ageSeconds, null);
}

{
  let refreshCalls = 0;
  const deps = dependencies({
    live: [record("live", "SYNTH01", "Sample One", "11")],
    failExtract: true,
  }) as TpmsReadModelDependencies & { refreshExtract?: () => Promise<void> };
  deps.refreshExtract = async () => { refreshCalls++; };
  const result = await createTpmsObservationBuilders(deps).buildByEnterpriseId("SYNTH01");
  assert.equal(result.observations.length, 1);
  assert.equal(result.warnings.some((warning) => warning.code === "SOURCE_UNAVAILABLE"), true);
  assert.equal(refreshCalls, 0);
}

{
  const result = await createTpmsObservationBuilders(dependencies({
    failLive: true,
    failCached: true,
    failExtract: true,
  })).buildByEnterpriseId("FAIL01");
  assert.deepEqual(result.observations, []);
  assert.equal(result.warnings.filter((warning) => warning.code === "SOURCE_UNAVAILABLE").length, 3);
}

{
  const deps = dependencies({
    live: [record("live", "NORM01", "Normalize Sample", "061101")],
  });
  const builders = createTpmsObservationBuilders(deps);
  assert.equal((await builders.buildByEnterpriseId(" norm01 ")).observations.length, 1);
  assert.equal((await builders.buildByTruckNumber("61101")).observations.length, 1);
}

const profileRows = [
  record("live", "DUP01", "Duplicate Sample", "101"),
  record("cached", "DUP02", "Duplicate Sample", "102"),
  record("live", "EXACT01", "Exact Sample", "103"),
];
const observationBuilders = createTpmsObservationBuilders(dependencies({ live: profileRows }));
const profiles = createProfileBuilders({
  buildByEnterpriseId: observationBuilders.buildByEnterpriseId,
  buildByTruckNumber: observationBuilders.buildByTruckNumber,
  searchRecords: async (query) => profileRows.filter((row) => matches(row, { kind: "query", value: query })),
});

{
  const result = await profiles.searchProfiles("Duplicate Sample");
  assert.equal(result.matchState, "ambiguous");
  assert.deepEqual(result.candidates.map((candidate) => candidate.enterpriseId).sort(), ["DUP01", "DUP02"]);
}

{
  const result = await profiles.searchProfiles("exact01");
  assert.equal(result.matchState, "matched");
  assert.equal(result.candidates[0].kind, "technician");
  assert.equal(result.candidates[0].enterpriseId, "EXACT01");
}

{
  const result = await profiles.searchProfiles("000103");
  assert.equal(result.matchState, "matched");
  assert.deepEqual(result.candidates, [{
    kind: "truck",
    enterpriseId: null,
    truckNumber: "103",
    displayName: null,
  }]);
}

{
  const unsafe = record("live", "SAFE01", "Safe Sample", "104", RECENT, {
    email: "forbidden@example.invalid",
    homeAddress: "forbidden-address",
    password: "forbidden-password",
    credential: "forbidden-credential",
    ssn: "000-00-0000",
    rawMetadata: { secret: true },
  } as Partial<TpmsLocalRecord>);
  const result = await createTpmsObservationBuilders(dependencies({ live: [unsafe] }))
    .buildByEnterpriseId("SAFE01");
  const serialized = JSON.stringify(result);
  for (const forbidden of ["email", "homeAddress", "password", "credential", "ssn", "rawMetadata", "forbidden-"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
}

const modulesKey = "sample-modules-key-at-least-24";
const profilesKey = "sample-profiles-key-at-least-24";
const searchKey = "sample-search-key-at-least-24";
const consumers = [
  { consumerId: "modules", key: modulesKey, scopes: ["modules:read" as const] },
  { consumerId: "profiles", key: profilesKey, scopes: ["profiles:read" as const] },
  { consumerId: "search", key: searchKey, scopes: ["search:read" as const] },
];

async function withRouter(
  builders: ProfileBuilders,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  const rentalBuilder = async () => ({
    data: [], total: 0, enterpriseCount: 0, holmanNonEnterpriseCount: 0,
    totalHolmanPOLines: 0, oosFilteredCount: 0, view: "business_logic" as const,
    sourceUpdatedAt: null, warnings: [],
  });
  const listingBuilder = async (input: any) => ({ page: input.page, pageSize: input.pageSize, totalCount: 0, rows: [] });
  app.use("/api/external/fleet/v1", createExternalFleetReadRouter(consumers, rentalBuilder, listingBuilder, builders));
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
  let calls = 0;
  const builders: ProfileBuilders = {
    buildTechnicianProfile: async (enterpriseId) => {
      calls++;
      return enterpriseId === "EXACT01" ? {
        kind: "technician", enterpriseId, displayName: "Exact Sample",
        observations: (await observationBuilders.buildByEnterpriseId(enterpriseId)).observations,
        warnings: [],
      } : null;
    },
    buildTruckProfile: async (truckNumber) => {
      calls++;
      return truckNumber === "103" ? {
        kind: "truck", truckNumber,
        observations: (await observationBuilders.buildByTruckNumber(truckNumber)).observations,
        warnings: [],
      } : null;
    },
    searchProfiles: async (query) => {
      calls++;
      return query.toLowerCase().includes("duplicate")
        ? { matchState: "ambiguous", candidates: [
            { kind: "technician", enterpriseId: "DUP01", truckNumber: "101", displayName: "Duplicate Sample" },
            { kind: "technician", enterpriseId: "DUP02", truckNumber: "102", displayName: "Duplicate Sample" },
          ] }
        : { matchState: "matched", candidates: [
            { kind: "technician", enterpriseId: "EXACT01", truckNumber: "103", displayName: "Exact Sample" },
          ] };
    },
  };
  await withRouter(builders, async (baseUrl) => {
    const techPath = "/api/external/fleet/v1/profiles/technicians/EXACT01";
    assert.equal((await fetch(`${baseUrl}${techPath}`)).status, 401);
    assert.equal((await fetch(`${baseUrl}${techPath}`, { headers: { Authorization: `Bearer ${modulesKey}` } })).status, 403);

    for (const path of [
      "/profiles/technicians/a",
      "/profiles/technicians/BAD%20ID",
      "/profiles/trucks/not-a-truck",
      "/search?query=a",
      "/search?query=valid&unknown=true",
    ]) {
      const key = path.startsWith("/search") ? searchKey : profilesKey;
      const response = await fetch(`${baseUrl}/api/external/fleet/v1${path}`, { headers: { Authorization: `Bearer ${key}` } });
      assert.equal(response.status, 400, path);
      assert.equal((await response.json()).error.code, "INVALID_QUERY");
    }

    const notFound = await fetch(`${baseUrl}/api/external/fleet/v1/profiles/technicians/MISSING01`, {
      headers: { Authorization: `Bearer ${profilesKey}` },
    });
    assert.equal(notFound.status, 404);
    assert.equal((await notFound.json()).error.code, "NOT_FOUND");

    const matched = await fetch(`${baseUrl}${techPath}`, { headers: { Authorization: `Bearer ${profilesKey}` } });
    assert.equal(matched.status, 200);
    const matchedBody = await matched.json();
    assert.equal(matchedBody.apiVersion, "1.0.0");
    assert.equal(matchedBody.data.kind, "technician");

    const ambiguous = await fetch(`${baseUrl}/api/external/fleet/v1/search?query=Duplicate%20Sample`, {
      headers: { Authorization: `Bearer ${searchKey}` },
    });
    assert.equal(ambiguous.status, 200);
    const ambiguousBody = await ambiguous.json();
    assert.equal(ambiguousBody.apiVersion, "1.0.0");
    assert.equal(ambiguousBody.data.matchState, "ambiguous");
    assert.equal(ambiguousBody.data.candidates.length, 2);

    const callsBeforePost = calls;
    const post = await fetch(`${baseUrl}${techPath}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${profilesKey}` },
    });
    assert.equal(post.status, 405);
    assert.equal(calls, callsBeforePost);
  });
}

{
  const builders: ProfileBuilders = {
    buildTechnicianProfile: async () => { throw new Error("raw SQL table credential secret"); },
    buildTruckProfile: async () => null,
    searchProfiles: async () => ({ matchState: "not_found", candidates: [] }),
  };
  await withRouter(builders, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/external/fleet/v1/profiles/technicians/ERROR01`, {
      headers: { Authorization: `Bearer ${profilesKey}` },
    });
    assert.equal(response.status, 500);
    const text = await response.text();
    assert.equal(text.includes("raw SQL"), false);
    assert.equal(text.includes("credential"), false);
    assert.equal(JSON.parse(text).error.code, "INTERNAL_ERROR");
  });
}
