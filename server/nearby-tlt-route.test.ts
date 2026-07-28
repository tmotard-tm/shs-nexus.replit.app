import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

import express, { type Express, type RequestHandler } from "express";

import {
  NearbyTltClientError,
  type NearbyTltResult,
} from "./nearby-tlt-client";
import { registerNearbyTltProxy } from "./nearby-tlt-route";

async function withServer<T>(app: Express, run: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = await new Promise<ReturnType<Express["listen"]>>((resolve, reject) => {
    const candidate = app.listen(0, "127.0.0.1", () => resolve(candidate));
    candidate.once("error", reject);
  });
  try {
    const address = server.address() as AddressInfo;
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

const fakeAuth: RequestHandler = (req: any, res, next) => {
  const user = req.header("x-test-user");
  if (!user) return res.status(401).json({ message: "Authentication required" });
  req.user = { role: user };
  next();
};

const emptyResult: NearbyTltResult = {
  originTechnicianRecordSyncedAt: "2026-07-28T10:00:00.000Z",
  matches: [],
  returnedCount: 0,
  rankingBasis: "straight_line_distance",
};

function makeApp(overrides: {
  allow?: boolean;
  found?: boolean;
  enterpriseId?: string;
  client?: (enterpriseId: string) => Promise<NearbyTltResult>;
} = {}) {
  const app = express();
  registerNearbyTltProxy(app, {
    requireAuth: fakeAuth,
    hasAssetsAccess: async () => overrides.allow ?? true,
    resolveAssetsQueueEnterpriseId: async () => ({
      found: overrides.found ?? true,
      enterpriseId: overrides.enterpriseId ?? "SERVER_RESOLVED_EID",
    }),
    fetchNearbyTlts: overrides.client ?? (async () => emptyResult),
  });
  return app;
}

await withServer(makeApp(), async (baseUrl) => {
  const response = await fetch(`${baseUrl}/api/assets-queue/assets-1/nearby-tlts`);
  assert.equal(response.status, 401, "proxy requires Nexus authentication");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

await withServer(makeApp({ allow: false }), async (baseUrl) => {
  const response = await fetch(`${baseUrl}/api/assets-queue/assets-1/nearby-tlts`, {
    headers: { "x-test-user": "agent" },
  });
  assert.equal(response.status, 403, "Assets Management authorization is enforced");
});

let clientEnterpriseId = "";
await withServer(makeApp({
  enterpriseId: "SERVER_RESOLVED_EID",
  client: async (enterpriseId) => {
    clientEnterpriseId = enterpriseId;
    return {
      ...emptyResult,
      matches: [{
        enterpriseId: "TLT1",
        displayName: "Lead One",
        jobTitle: "Team Lead Technician",
        distanceMiles: 4.2,
        technicianRecordSyncedAt: "2026-07-28T09:00:00.000Z",
      }],
      returnedCount: 1,
    };
  },
}), async (baseUrl) => {
  const response = await fetch(
    `${baseUrl}/api/assets-queue/assets-1/nearby-tlts?technician_enterprise_id=ATTACKER_VALUE`,
    { headers: { "x-test-user": "agent" } },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(clientEnterpriseId, "SERVER_RESOLVED_EID");
  const body = await response.json();
  assert.equal(body.data.returnedCount, 1, "fewer than three matches is valid");
});

await withServer(makeApp({ found: false }), async (baseUrl) => {
  const response = await fetch(`${baseUrl}/api/assets-queue/missing/nearby-tlts`, {
    headers: { "x-test-user": "agent" },
  });
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "ASSETS_ITEM_NOT_FOUND");
});

await withServer(makeApp({ enterpriseId: " " }), async (baseUrl) => {
  const response = await fetch(`${baseUrl}/api/assets-queue/assets-1/nearby-tlts`, {
    headers: { "x-test-user": "agent" },
  });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, "ORIGIN_ENTERPRISE_ID_UNAVAILABLE");
});

for (const [clientCode, status, proxyCode] of [
  ["CONFIG_MISSING", 503, "NEXUS_CONFIGURATION_MISSING"],
  ["ORIGIN_NOT_FOUND", 404, "ORIGIN_NOT_FOUND"],
  ["ORIGIN_LOCATION_UNAVAILABLE", 422, "ORIGIN_LOCATION_UNAVAILABLE"],
  ["RATE_LIMITED", 429, "CTR_RATE_LIMITED"],
  ["AUTHENTICATION_FAILED", 502, "CTR_AUTHENTICATION_FAILED"],
  ["UPSTREAM_UNAVAILABLE", 502, "CTR_UPSTREAM_UNAVAILABLE"],
  ["TIMEOUT", 504, "CTR_TIMEOUT"],
  ["MALFORMED_RESPONSE", 502, "CTR_INVALID_RESPONSE"],
] as const) {
  await withServer(makeApp({
    client: async () => {
      throw new NearbyTltClientError(clientCode, "safe test message");
    },
  }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/assets-queue/assets-1/nearby-tlts`, {
      headers: { "x-test-user": "agent" },
    });
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.json()).error.code, proxyCode);
  });
}

console.log("nearby-tlt proxy: all assertions passed");
