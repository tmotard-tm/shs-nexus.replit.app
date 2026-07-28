import assert from "node:assert/strict";

import {
  fetchNearbyTlts,
  NearbyTltClientError,
} from "./nearby-tlt-client";

const env = {
  CTR_API_BASE_URL: "https://ctr.example.test",
  CTR_NEXUS_LOCATION_API_KEY: "test-only-not-a-real-secret",
} as NodeJS.ProcessEnv;

function successfulBody(matches: unknown[]) {
  return {
    success: true,
    data: {
      origin: {
        enterpriseId: "ORIGIN1",
        technicianRecordSyncedAt: "2026-07-28T10:00:00.000Z",
        coordinates: { latitude: 1, longitude: 2 },
      },
      matches,
      requestedLimit: 3,
      returnedCount: matches.length,
      rankingBasis: "straight_line_distance",
      privateLocationNotes: "must be stripped",
    },
  };
}

await assert.rejects(
  () => fetchNearbyTlts("ORIGIN1", { env: {} as NodeJS.ProcessEnv }),
  (error: unknown) =>
    error instanceof NearbyTltClientError && error.code === "CONFIG_MISSING",
);

let capturedUrl = "";
let capturedHeaders: Headers | undefined;
const result = await fetchNearbyTlts(" ORIGIN1 ", {
  env,
  fetchImpl: (async (input: URL | RequestInfo, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedHeaders = new Headers(init?.headers);
    return Response.json(successfulBody([
      {
        enterpriseId: "TLT2",
        displayName: "Second Lead",
        jobTitle: "HVAC Team Lead Technician",
        distanceMiles: 22.4,
        technicianRecordSyncedAt: "2026-07-28T09:00:00.000Z",
        latitude: 99,
        phoneNumber: "private",
      },
      {
        enterpriseId: "TLT1",
        displayName: "First Lead",
        jobTitle: "Team Lead Technician",
        distanceMiles: 5.2,
        technicianRecordSyncedAt: "2026-07-28T08:00:00.000Z",
        address: "private",
      },
    ]));
  }) as typeof fetch,
});

assert.equal(
  capturedHeaders?.get("x-api-key"),
  "test-only-not-a-real-secret",
  "CTR key is sent only in the server-side authentication header",
);
assert.equal(new URL(capturedUrl).searchParams.get("technician_enterprise_id"), "ORIGIN1");
assert.equal(new URL(capturedUrl).searchParams.get("limit"), "3");
assert.deepEqual(
  result.matches.map((match) => match.enterpriseId),
  ["TLT1", "TLT2"],
  "Nexus preserves ascending distance order defensively",
);
assert.equal(result.returnedCount, 2, "fewer than three matches is valid");
assert.equal(JSON.stringify(result).includes("latitude"), false);
assert.equal(JSON.stringify(result).includes("phoneNumber"), false);
assert.equal(JSON.stringify(result).includes("address"), false);
assert.equal(JSON.stringify(result).includes("ORIGIN1"), false);

await assert.rejects(
  () => fetchNearbyTlts("ORIGIN1", {
    env,
    fetchImpl: (async () => new Response("<html>not json</html>", { status: 200 })) as typeof fetch,
  }),
  (error: unknown) =>
    error instanceof NearbyTltClientError && error.code === "MALFORMED_RESPONSE",
);

await assert.rejects(
  () => fetchNearbyTlts("ORIGIN1", {
    env,
    timeoutMs: 5,
    fetchImpl: ((_: URL | RequestInfo, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      })) as typeof fetch,
  }),
  (error: unknown) =>
    error instanceof NearbyTltClientError && error.code === "TIMEOUT",
);

for (const [status, code] of [
  [401, "AUTHENTICATION_FAILED"],
  [404, "ORIGIN_NOT_FOUND"],
  [422, "ORIGIN_LOCATION_UNAVAILABLE"],
  [429, "RATE_LIMITED"],
  [503, "UPSTREAM_UNAVAILABLE"],
] as const) {
  await assert.rejects(
    () => fetchNearbyTlts("ORIGIN1", {
      env,
      fetchImpl: (async () => new Response(null, { status })) as typeof fetch,
    }),
    (error: unknown) =>
      error instanceof NearbyTltClientError && error.code === code,
  );
}

console.log("nearby-tlt client: all assertions passed");
