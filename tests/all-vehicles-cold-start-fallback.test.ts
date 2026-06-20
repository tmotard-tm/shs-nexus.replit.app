import { test, after } from "node:test";
import assert from "node:assert/strict";

import {
  pgQueryWithRetry,
  selectColdStartFallback,
  saveAllVehiclesResponseSnapshot,
  readAllVehiclesResponseSnapshot,
} from "../server/fleet-scope-all-vehicles-mirror.js";
import { fsPool } from "../server/fleet-scope-db.js";

/* ──────────────────────────────────────────────────────────────────────────
 * Cold-start resilience for GET /api/fs/all-vehicles.
 *
 * The route reads its last-good data from Neon Postgres (the mirror + a
 * persisted response snapshot). Neon's serverless driver intermittently drops
 * its WebSocket (closeCode 1006) with an empty-message ErrorEvent. On a COLD
 * restart the in-memory cache is gone, so a transient drop on the very first
 * request must still serve real data instead of a 503. These tests prove:
 *   1) the PG-read retry rides out a single injected transient drop,
 *   2) the persisted snapshot survives independent of in-process state,
 *   3) the fallback-selection logic prefers the right last-good source.
 * ────────────────────────────────────────────────────────────────────────── */

// A transient Neon WS drop surfaces as an ErrorEvent with an empty message.
function transientDropError(): Error {
  const e: any = new Error("");
  e.name = "ErrorEvent";
  e.type = "error";
  return e;
}

after(async () => {
  try {
    await fsPool.end();
  } catch {
    /* pool may never have connected — ignore */
  }
});

test("pgQueryWithRetry rides out a single injected transient drop", async () => {
  let calls = 0;
  const exec = async (_t: string, _p: any[]) => {
    calls++;
    if (calls === 1) throw transientDropError();
    return { rows: [{ payload: { ok: true }, built_at: new Date() }] };
  };
  const res = await pgQueryWithRetry("SELECT 1", [], "test", exec);
  assert.equal(calls, 2, "should retry exactly once after a transient drop");
  assert.equal(res.rows[0].payload.ok, true);
});

test("pgQueryWithRetry does NOT retry a non-transient error", async () => {
  let calls = 0;
  const exec = async () => {
    calls++;
    throw new Error("syntax error at or near");
  };
  await assert.rejects(() => pgQueryWithRetry("SELECT 1", [], "test", exec));
  assert.equal(calls, 1, "non-transient errors must surface, not retry");
});

test("selectColdStartFallback: cold restart + transient drop serves persisted last-good", () => {
  const now = Date.now();
  const choice = selectColdStartFallback({
    isTransientDbDrop: true,
    now,
    inMemory: null, // just restarted — in-memory cache is empty
    inMemoryMaxAgeMs: 15 * 60 * 1000,
    persisted: { builtAt: now - 60 * 60 * 1000 }, // 1h-old persisted snapshot
    persistedMaxAgeMs: 24 * 60 * 60 * 1000,
  });
  assert.equal(choice?.source, "persisted");
});

test("selectColdStartFallback: prefers the fresher in-memory cache when present", () => {
  const now = Date.now();
  const choice = selectColdStartFallback({
    isTransientDbDrop: true,
    now,
    inMemory: { timestamp: now - 60 * 1000 },
    inMemoryMaxAgeMs: 15 * 60 * 1000,
    persisted: { builtAt: now - 60 * 60 * 1000 },
    persistedMaxAgeMs: 24 * 60 * 60 * 1000,
  });
  assert.equal(choice?.source, "memory");
});

test("selectColdStartFallback: a real (non-transient) error gets no fallback", () => {
  const now = Date.now();
  const choice = selectColdStartFallback({
    isTransientDbDrop: false,
    now,
    inMemory: { timestamp: now },
    inMemoryMaxAgeMs: 15 * 60 * 1000,
    persisted: { builtAt: now },
    persistedMaxAgeMs: 24 * 60 * 60 * 1000,
  });
  assert.equal(choice, null);
});

test("selectColdStartFallback: a too-old persisted snapshot is rejected", () => {
  const now = Date.now();
  const choice = selectColdStartFallback({
    isTransientDbDrop: true,
    now,
    inMemory: null,
    inMemoryMaxAgeMs: 15 * 60 * 1000,
    persisted: { builtAt: now - 48 * 60 * 60 * 1000 }, // 48h — beyond the 24h cap
    persistedMaxAgeMs: 24 * 60 * 60 * 1000,
  });
  assert.equal(choice, null);
});

test("response snapshot persists and reads back (real DB round-trip)", async (t) => {
  // Proves last-good data survives independent of any in-process state — the
  // essence of "survives a restart". Skips cleanly if the dev DB is unreachable.
  let prior: { payload: any; builtAt: Date } | null = null;
  try {
    prior = await readAllVehiclesResponseSnapshot();
  } catch {
    t.skip("dev database not reachable from test environment");
    return;
  }

  const sentinel = { __test: true, vehicles: [{ n: "test-001" }], at: Date.now() };
  await saveAllVehiclesResponseSnapshot(sentinel);
  const got = await readAllVehiclesResponseSnapshot();
  assert.equal(got?.payload?.__test, true);
  assert.equal(got?.payload?.vehicles?.[0]?.n, "test-001");

  // Restore the prior snapshot so we don't leave the test sentinel as last-good.
  if (prior?.payload) await saveAllVehiclesResponseSnapshot(prior.payload);
});
