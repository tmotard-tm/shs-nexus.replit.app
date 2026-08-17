/**
 * Behavioral tests for the guarded external writes in the Create Vehicle flow
 * (Task #636).
 *
 * These are not source-text assertions: each test runs the real orchestrator
 * with fake dependencies and asserts on WHAT WAS CALLED. The central claim
 * being proven is the fail-closed rule — when a duplicate probe cannot
 * complete, no create call is ever made to WMS, TPMS or Holman.
 *
 * Run: npx tsx --test tests/vehicle-create-external.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  runGuardedWmsCreate,
  runGuardedHolmanSubmit,
  type ExistenceProbe,
} from "../server/vehicle-create-external.js";

// ── helpers ──────────────────────────────────────────────────────────────────

interface CallLog {
  createTruck: any[];
  addTruck: any[];
  submit: any[];
  lookups: string[];
}

function wmsDeps(probe: ExistenceProbe | (() => Promise<ExistenceProbe>), opts: { createThrows?: any; addThrows?: any; tpms?: boolean } = {}) {
  const calls: CallLog = { createTruck: [], addTruck: [], submit: [], lookups: [] };
  const deps = {
    lookupTruck: async (num: string) => {
      calls.lookups.push(num);
      return typeof probe === "function" ? await probe() : probe;
    },
    createTruck: async (payload: any) => {
      calls.createTruck.push(payload);
      if (opts.createThrows) throw opts.createThrows;
      return { ok: true };
    },
    addTruck:
      opts.tpms === false
        ? null
        : async (payload: any) => {
            calls.addTruck.push(payload);
            if (opts.addThrows) throw opts.addThrows;
            return { ok: true };
          },
  };
  return { deps, calls };
}

const WMS_ARGS = {
  paddedVehicle: "088999",
  wmsPayload: { name: "088999" },
  tpmsPayload: { truckNo: "088999" },
};

function holmanDeps(
  lookups: (ExistenceProbe & { vehicle?: any })[],
  submitImpl: (payloads: any[]) => Promise<any>,
) {
  const calls: CallLog = { createTruck: [], addTruck: [], submit: [], lookups: [] };
  let i = 0;
  const deps = {
    lookupByNumber: async (num: string) => {
      calls.lookups.push(num);
      const probe = lookups[Math.min(i, lookups.length - 1)];
      i += 1;
      return probe;
    },
    submit: async (payloads: any[]) => {
      calls.submit.push(payloads);
      return submitImpl(payloads);
    },
    now: () => new Date("2026-08-15T12:00:00Z"),
  };
  return { deps, calls };
}

// ── WMS: fail closed ─────────────────────────────────────────────────────────

test("WMS create refuses and writes NOTHING when the duplicate lookup cannot complete", async () => {
  const { deps, calls } = wmsDeps({ checked: false, found: false, error: "WMS 500" });
  const out = await runGuardedWmsCreate(deps, WMS_ARGS);

  assert.equal(out.refusal?.code, "wms_check_unavailable");
  assert.match(out.refusal!.error, /Cannot verify/);
  assert.deepEqual(calls.createTruck, [], "createTruck must never be called after a failed lookup");
  assert.deepEqual(calls.addTruck, [], "TPMS must never be called after a failed lookup");
  assert.equal(out.wms.success, false);
  assert.equal(out.tpms.skipped, true);
});

test("WMS create refuses when the lookup throws with no status (network failure)", async () => {
  const { deps, calls } = wmsDeps(async () => ({ checked: false, found: false, error: "socket hang up" }));
  const out = await runGuardedWmsCreate(deps, WMS_ARGS);
  assert.ok(out.refusal);
  assert.equal(calls.createTruck.length, 0);
});

test("an authoritative not-found (404) still creates — only unverified blocks", async () => {
  const { deps, calls } = wmsDeps({ checked: true, found: false });
  const out = await runGuardedWmsCreate(deps, WMS_ARGS);

  assert.equal(out.refusal, undefined);
  assert.equal(calls.createTruck.length, 1);
  assert.equal(out.wms.success, true);
  assert.equal(out.tpms.success, true);
  assert.equal(calls.addTruck.length, 1);
});

test("an existing truck is an idempotent success and is not re-created", async () => {
  const { deps, calls } = wmsDeps({ checked: true, found: true });
  const out = await runGuardedWmsCreate(deps, WMS_ARGS);

  assert.equal(out.wms.success, true);
  assert.equal(out.wms.alreadyExisted, true);
  assert.equal(calls.createTruck.length, 0, "must not re-create a truck that already exists");
  assert.equal(calls.addTruck.length, 1, "TPMS registration still runs for an existing WMS truck");
});

test("a 409 race during create is treated as success, not a failure", async () => {
  const err: any = new Error("conflict");
  err.status = 409;
  const { deps } = wmsDeps({ checked: true, found: false }, { createThrows: err });
  const out = await runGuardedWmsCreate(deps, WMS_ARGS);

  assert.equal(out.wms.success, true);
  assert.equal(out.wms.alreadyExisted, true);
});

test("a real WMS create failure fails and skips TPMS", async () => {
  const { deps, calls } = wmsDeps({ checked: true, found: false }, { createThrows: new Error("WMS 500 boom") });
  const out = await runGuardedWmsCreate(deps, WMS_ARGS);

  assert.equal(out.wms.success, false);
  assert.match(out.wms.error!, /boom/);
  assert.equal(calls.addTruck.length, 0, "TPMS must not run when WMS failed");
  assert.equal(out.tpms.skipped, true);
});

test("TPMS is skipped when unconfigured, and its duplicate error counts as success", async () => {
  const unconfigured = wmsDeps({ checked: true, found: false }, { tpms: false });
  const a = await runGuardedWmsCreate(unconfigured.deps, WMS_ARGS);
  assert.equal(a.tpms.success, true);
  assert.equal(a.tpms.skipped, true);

  const dup = wmsDeps({ checked: true, found: false }, { addThrows: new Error("Truck already exists") });
  const b = await runGuardedWmsCreate(dup.deps, WMS_ARGS);
  assert.equal(b.tpms.success, true);

  const fail = wmsDeps({ checked: true, found: false }, { addThrows: new Error("TPMS 503") });
  const c = await runGuardedWmsCreate(fail.deps, WMS_ARGS);
  assert.equal(c.tpms.success, false);
  assert.match(c.tpms.error!, /503/);
});

// ── Holman: fail closed ──────────────────────────────────────────────────────

const HOLMAN_ARGS = { paddedVehicle: "088999", payload: { holmanVehicleNumber: "088999" } };

test("Holman submit refuses and sends NOTHING when the pre-check cannot complete", async () => {
  const { deps, calls } = holmanDeps([{ checked: false, found: false, error: "Holman 502" }], async () => ({
    message: "[1] record submitted. [0] records rejected due to errors. [1] record successfully captured for processing.",
  }));
  const out = await runGuardedHolmanSubmit(deps, HOLMAN_ARGS);

  assert.equal(out.refusal?.code, "number_check_unavailable");
  assert.deepEqual(calls.submit, [], "submitVehicleArray must never be called after a failed pre-check");
  assert.equal(out.liveConfirmed, false);
  assert.equal(out.submittedAt, null);
  assert.equal(out.result.success, false);
});

test("an existing Holman record short-circuits the submit and IS live-confirmed", async () => {
  const { deps, calls } = holmanDeps(
    [{ checked: true, found: true, vehicle: { holmanVehicleNumber: "088999" } }],
    async () => ({ message: "[1] record submitted. [1] record successfully captured for processing." }),
  );
  const out = await runGuardedHolmanSubmit(deps, HOLMAN_ARGS);

  assert.equal(calls.submit.length, 0);
  assert.equal(out.result.success, true);
  assert.equal(out.liveConfirmed, true, "a live read is what justifies mirroring the cache row");
});

test("an accepted submit succeeds but is NOT live-confirmed — no cache mirror off a receipt", async () => {
  const { deps, calls } = holmanDeps([{ checked: true, found: false }], async () => ({
    message: "[1] record submitted. [0] records rejected due to errors. [1] record successfully captured for processing.",
    referenceToken: "abc-123",
  }));
  const out = await runGuardedHolmanSubmit(deps, HOLMAN_ARGS);

  assert.equal(calls.submit.length, 1);
  assert.equal(out.result.success, true);
  assert.equal(out.liveConfirmed, false);
  assert.ok(out.submittedAt instanceof Date);
});

test("a receipt-only submit is pending verification, never success", async () => {
  const { deps } = holmanDeps([{ checked: true, found: false }], async () => ({ message: "[1] record submitted." }));
  const out = await runGuardedHolmanSubmit(deps, HOLMAN_ARGS);

  assert.equal(out.result.success, false);
  assert.equal(out.result.pending, true);
  assert.match(out.result.error!, /Pending verification/);
  assert.equal(out.liveConfirmed, false);
});

test("a rejected submit is a failure, not a pending", async () => {
  const { deps } = holmanDeps([{ checked: true, found: false }], async () => ({
    message: "[1] record submitted. [1] record rejected due to errors. [0] records successfully captured for processing.",
  }));
  const out = await runGuardedHolmanSubmit(deps, HOLMAN_ARGS);

  assert.equal(out.result.success, false);
  assert.notEqual(out.result.pending, true);
});

test("a duplicate error is verified against a live read before being called success", async () => {
  const confirmed = holmanDeps(
    [
      { checked: true, found: false },
      { checked: true, found: true },
    ],
    async () => {
      throw new Error("Vehicle already exists");
    },
  );
  const a = await runGuardedHolmanSubmit(confirmed.deps, HOLMAN_ARGS);
  assert.equal(a.result.success, true);
  assert.equal(a.liveConfirmed, true);

  // Same duplicate error, but the confirming read fails: pending, never success,
  // and never live-confirmed (so nothing is mirrored locally).
  const unconfirmed = holmanDeps(
    [
      { checked: true, found: false },
      { checked: false, found: false, error: "Holman 502" },
    ],
    async () => {
      throw new Error("duplicate record");
    },
  );
  const b = await runGuardedHolmanSubmit(unconfirmed.deps, HOLMAN_ARGS);
  assert.equal(b.result.success, false);
  assert.equal(b.result.pending, true);
  assert.equal(b.liveConfirmed, false);
});

test("a non-duplicate submit error fails without a second lookup", async () => {
  const { deps, calls } = holmanDeps([{ checked: true, found: false }], async () => {
    throw new Error("Holman 500");
  });
  const out = await runGuardedHolmanSubmit(deps, HOLMAN_ARGS);

  assert.equal(out.result.success, false);
  assert.equal(out.liveConfirmed, false);
  assert.equal(calls.lookups.length, 1);
});
