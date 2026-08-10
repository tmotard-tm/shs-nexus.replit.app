// Route tests for the external fleet read API's open-rental enterprise-ID
// endpoint (GET /modules/open-rental-enterprise-ids), which feeds the Fleet
// LOA hub's Rental badge. Uses a stub builder injected through
// createExternalFleetReadRouter so no Snowflake access is needed.
import assert from "node:assert/strict";
import { test, after } from "node:test";
import type { AddressInfo } from "node:net";

import express from "express";

import { createExternalFleetReadRouter } from "../server/external-fleet-api/router";
import { OpenRentalsSourceUnavailableError } from "../server/external-fleet-api/rental-ops-read-model";
import type { ExternalFleetConsumer } from "../server/external-fleet-api/auth";

const GOOD_KEY = "test-modules-read-key-0123456789";
const NO_SCOPE_KEY = "test-profiles-only-key-0123456789";

const consumers: ExternalFleetConsumer[] = [
  { consumerId: "loa-hub-test", key: GOOD_KEY, scopes: ["modules:read"] },
  { consumerId: "profiles-only-test", key: NO_SCOPE_KEY, scopes: ["profiles:read"] },
];

type BuilderCall = { managedScope: boolean; fileDate?: string };

async function makeServer(builder: (managedScope: boolean, fileDate?: string) => Promise<string[]>) {
  const app = express();
  app.use(
    "/api/external/fleet/v1",
    createExternalFleetReadRouter(
      consumers,
      undefined as any,
      undefined as any,
      undefined as any,
      builder,
    ),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  const url = (path: string) => `http://127.0.0.1:${port}/api/external/fleet/v1${path}`;
  return { server, url };
}

const calls: BuilderCall[] = [];
const { server, url } = await makeServer(async (managedScope, fileDate) => {
  calls.push({ managedScope, fileDate });
  return ["AAA1", "BBB2"];
});
after(() => server.close());

const EP = "/modules/open-rental-enterprise-ids";

test("401 without a bearer key", async () => {
  const res = await fetch(url(EP));
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error.code, "UNAUTHORIZED");
});

test("401 with an unknown bearer key", async () => {
  const res = await fetch(url(EP), { headers: { authorization: "Bearer wrong-key-wrong-key-wrong-key" } });
  assert.equal(res.status, 401);
});

test("403 when the key lacks modules:read", async () => {
  const res = await fetch(url(EP), { headers: { authorization: `Bearer ${NO_SCOPE_KEY}` } });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error.code, "INSUFFICIENT_SCOPE");
});

test("400 on unknown query params and malformed fileDate", async () => {
  for (const qs of ["?foo=1", "?fileDate=08/10/2026"]) {
    const res = await fetch(url(EP) + qs, { headers: { authorization: `Bearer ${GOOD_KEY}` } });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, "INVALID_QUERY");
  }
});

test("200 success: envelope shape, managed scope hardwired, fileDate passthrough", async () => {
  calls.length = 0;
  const res = await fetch(url(EP), { headers: { authorization: `Bearer ${GOOD_KEY}` } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.data.enterpriseIds, ["AAA1", "BBB2"]);
  assert.equal(body.data.total, 2);
  assert.equal(body.data.scope, "managed");
  assert.ok(Number.isFinite(Date.parse(body.data.computedAt)));
  assert.ok(body.freshness && body.freshness.state);
  assert.ok(Array.isArray(body.warnings));
  assert.deepEqual(calls, [{ managedScope: true, fileDate: undefined }]);

  calls.length = 0;
  const dated = await fetch(url(EP) + "?fileDate=2026-08-01", { headers: { authorization: `Bearer ${GOOD_KEY}` } });
  assert.equal(dated.status, 200);
  assert.deepEqual(calls, [{ managedScope: true, fileDate: "2026-08-01" }]);
});

test("503 when the source is unavailable (not configured and operational)", async () => {
  for (const err of [
    new OpenRentalsSourceUnavailableError(new Error("Snowflake not configured"), "not_configured"),
    new OpenRentalsSourceUnavailableError(new Error("connect timeout")),
  ]) {
    const failing = await makeServer(async () => { throw err; });
    try {
      const res = await fetch(failing.url(EP), { headers: { authorization: `Bearer ${GOOD_KEY}` } });
      assert.equal(res.status, 503);
      const body = await res.json();
      assert.equal(body.error.code, "SOURCE_UNAVAILABLE");
      // Sanitized: no upstream detail leaks
      assert.ok(!JSON.stringify(body).includes("timeout"));
    } finally {
      failing.server.close();
    }
  }
});

test("500 with sanitized message on unexpected errors", async () => {
  const failing = await makeServer(async () => { throw new Error("secret internal detail"); });
  try {
    const res = await fetch(failing.url(EP), { headers: { authorization: `Bearer ${GOOD_KEY}` } });
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.error.code, "INTERNAL_ERROR");
    assert.ok(!JSON.stringify(body).includes("secret internal detail"));
  } finally {
    failing.server.close();
  }
});
