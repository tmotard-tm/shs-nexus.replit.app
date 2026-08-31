import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

import express, { type Express } from "express";

import { createExternalFleetReadRouter } from "./router";
import {
  VanDeliverySourceUnavailableError,
  type VanDeliveryInput,
  type VanDeliveryReadModel,
} from "./van-delivery-read-model";

const modulesKey = "sample-secret-value-at-least-24";
const profilesKey = "profiles-secret-value-at-least-24";

const consumers = [
  { consumerId: "modules-consumer", key: modulesKey, scopes: ["modules:read"] as const },
  { consumerId: "profiles-consumer", key: profilesKey, scopes: ["profiles:read"] as const },
].map((consumer) => ({ ...consumer, scopes: [...consumer.scopes] }));

const model: VanDeliveryReadModel = {
  filters: { hiredFrom: "2026-06-01", hiredTo: null },
  summary: {
    hireCount: 1,
    byStatus: {
      delivered: 1,
      in_transit: 0,
      no_transport_record: 0,
      awaiting_truck_assignment: 0,
      byov_no_van: 0,
    },
    daysToVan: {
      measured: 1, mean: 17, median: 17, p25: 17, p75: 17, min: 17, max: 17,
      withinSevenDays: 0, withinFourteenDays: 0, overThirtyDays: 0,
    },
  },
  rows: [{
    enterpriseId: "TTECH1",
    employeeName: "TECH,TEST",
    hireDate: "2026-08-03",
    district: "D1",
    workState: "NC",
    byovIntent: null,
    employmentStatus: "Active",
    truckNumber: "46625",
    truckAssignedAt: "2026-08-05T12:00:00.000Z",
    droppedFromSourceAt: null,
    daysHireToTruckAssigned: 2,
    status: "delivered",
    vanDeliveredOn: "2026-08-20",
    daysHireToVanDelivered: 17,
    deliverySource: "pal_transport",
    transportRecordId: 1279,
    transportSubmittedOn: "2026-08-10",
    transportEta: "08/19",
    warnings: [],
  }],
};

let lastInput: VanDeliveryInput | null = null;

function mount(
  builder: (input: VanDeliveryInput) => Promise<{
    model: VanDeliveryReadModel;
    sourceUpdatedAt: string | null;
    warnings: never[];
  }>,
): Express {
  const app = express();
  app.use(
    "/api/external/fleet/v1",
    createExternalFleetReadRouter(
      consumers,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      builder,
    ),
  );
  return app;
}

// Freshness is judged against the roster's daily Snowflake sync, so a source
// stamped an hour ago is fresh and one stamped two days ago is not.
const anHourAgo = new Date(Date.now() - 3_600_000).toISOString();
const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();

const okBuilder = async (input: VanDeliveryInput) => {
  lastInput = input;
  return { model, sourceUpdatedAt: anHourAgo, warnings: [] as never[] };
};

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

const PATH = "/api/external/fleet/v1/modules/onboarding-van-deliveries";

// ── JSON, the default shape ──────────────────────────────────────────────────
await withServer(mount(okBuilder), async (baseUrl) => {
  const response = await fetch(`${baseUrl}${PATH}?hiredFrom=2026-06-01`, {
    headers: { Authorization: `Bearer ${modulesKey}` },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.apiVersion, "1.0.0");
  assert.equal(body.data.rows[0].vanDeliveredOn, "2026-08-20");
  assert.equal(body.data.summary.daysToVan.median, 17);
  assert.equal(body.freshness.state, "fresh");
  assert.equal(body.sourceUpdatedAt, anHourAgo);
  assert.deepEqual(lastInput, { hiredFrom: "2026-06-01", hiredTo: undefined, includeFutureHires: false });
  assert.equal(JSON.stringify(body).includes(modulesKey), false);
});

// A roster older than a day reports stale rather than pretending to be current.
await withServer(
  mount(async () => ({ model, sourceUpdatedAt: twoDaysAgo, warnings: [] as never[] })),
  async (baseUrl) => {
    const response = await fetch(`${baseUrl}${PATH}`, {
      headers: { Authorization: `Bearer ${modulesKey}` },
    });
    assert.equal((await response.json()).freshness.state, "stale");
  },
);

// includeFutureHires is a string on the wire and a boolean in the model.
await withServer(mount(okBuilder), async (baseUrl) => {
  await fetch(`${baseUrl}${PATH}?includeFutureHires=true`, {
    headers: { Authorization: `Bearer ${modulesKey}` },
  });
  assert.equal(lastInput?.includeFutureHires, true);
});

// ── CSV, for the Excel consumers ─────────────────────────────────────────────
await withServer(mount(okBuilder), async (baseUrl) => {
  const response = await fetch(`${baseUrl}${PATH}?format=csv`, {
    headers: { Authorization: `Bearer ${modulesKey}` },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/csv/);
  assert.match(response.headers.get("content-disposition") ?? "", /new-hire-van-deliveries-\d{4}-\d{2}-\d{2}\.csv/);
  const text = await response.text();
  const [header, first] = text.trim().split("\r\n");
  assert.equal(header.split(",")[0], "enterprise_id");
  assert.ok(first.includes("2026-08-20"));
});

// ── Guard rails ──────────────────────────────────────────────────────────────
await withServer(mount(okBuilder), async (baseUrl) => {
  const response = await fetch(`${baseUrl}${PATH}?hiredFrom=last-tuesday`, {
    headers: { Authorization: `Bearer ${modulesKey}` },
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "INVALID_QUERY");
});

// An unknown query parameter is rejected rather than silently ignored.
await withServer(mount(okBuilder), async (baseUrl) => {
  const response = await fetch(`${baseUrl}${PATH}?limit=5`, {
    headers: { Authorization: `Bearer ${modulesKey}` },
  });
  assert.equal(response.status, 400);
});

await withServer(mount(okBuilder), async (baseUrl) => {
  const response = await fetch(`${baseUrl}${PATH}`, {
    headers: { Authorization: `Bearer ${profilesKey}` },
  });
  assert.equal(response.status, 403);
});

await withServer(mount(okBuilder), async (baseUrl) => {
  const response = await fetch(`${baseUrl}${PATH}`);
  assert.equal(response.status, 401);
});

// PAL down is a 503 with a named source, not a page of empty delivery dates.
await withServer(
  mount(async () => { throw new VanDeliverySourceUnavailableError("PAL Transport is unavailable"); }),
  async (baseUrl) => {
    const response = await fetch(`${baseUrl}${PATH}`, {
      headers: { Authorization: `Bearer ${modulesKey}` },
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "SOURCE_UNAVAILABLE");
  },
);

// Any other failure is a 500 that leaks nothing about the internals.
await withServer(
  mount(async () => { throw new Error("relation onboarding_hires does not exist"); }),
  async (baseUrl) => {
    const response = await fetch(`${baseUrl}${PATH}`, {
      headers: { Authorization: `Bearer ${modulesKey}` },
    });
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.error.code, "INTERNAL_ERROR");
    assert.equal(JSON.stringify(body).includes("onboarding_hires"), false);
  },
);

console.log("van-delivery route: all assertions passed");
