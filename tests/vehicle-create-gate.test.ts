import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Task #636 — Create Vehicle gate logic.
 *
 * server/vehicle-create-gate.ts is the pure decision core behind the Create New
 * Vehicle flow: VIN validity, number allocation across the class bands, the
 * fail-closed duplicate gate, reservation conflict/reclaim resolution, Holman
 * acceptance evidence, and per-system outcome reporting.
 *
 * The rules under test all exist because the advisory versions failed in
 * production: a duplicate check that could not complete used to wave the
 * submission through, and any HTTP 2xx used to count as a Holman success.
 */
import {
  validateVin,
  normalizeVin,
  allocateVehicleNumber,
  classifyHolmanSubmitResponse,
  decideDuplicateGate,
  decideReservationConflict,
  summarizeCreateOutcome,
  RESERVATION_STALE_MS,
  type DuplicateProbe,
} from "../server/vehicle-create-gate.js";

// ── VIN validity ─────────────────────────────────────────────────────────────

test("VIN: a real 17-character VIN is accepted and normalized", () => {
  const r = validateVin("  1ftbw2cm5nka12345 ");
  assert.equal(r.valid, true);
  assert.equal(r.vin, "1FTBW2CM5NKA12345");
});

test("VIN: wrong length is rejected with the received length", () => {
  const r = validateVin("1FTBW2CM5NKA1234");
  assert.equal(r.valid, false);
  assert.match(r.reason!, /exactly 17 characters \(received 16\)/);
});

test("VIN: I, O and Q are never valid VIN characters", () => {
  for (const bad of ["1FTBW2CM5NKO12345", "1FTBW2CM5NKI12345", "1FTBW2CM5NKQ12345"]) {
    const r = validateVin(bad);
    assert.equal(r.valid, false, `${bad} should be rejected`);
    assert.match(r.reason!, /invalid characters/);
  }
});

test("VIN: an all-identical placeholder is rejected", () => {
  const r = validateVin("11111111111111111");
  assert.equal(r.valid, false);
  assert.match(r.reason!, /placeholder/);
});

test("VIN: an invalid model-year code in position 10 is rejected", () => {
  // position 10 (index 9) = "U" — not a valid model-year code
  const r = validateVin("1FTBW2CM5UKA12345");
  assert.equal(r.valid, false);
  assert.match(r.reason!, /position 10/);
});

test("VIN: an empty VIN is rejected rather than silently passing", () => {
  assert.equal(validateVin("").valid, false);
  assert.equal(validateVin(null).valid, false);
  assert.equal(validateVin(undefined).valid, false);
  assert.equal(normalizeVin(null), "");
});

// ── Number allocation ────────────────────────────────────────────────────────

const BYOV = { start: 88000, end: 88999 };
const ENTERPRISE = { start: 260000, end: 999999 };
const inByovBand = (n: number) => n >= 88000 && n <= 88999;

test("allocator: empty band hands out the first number", () => {
  assert.equal(allocateVehicleNumber({ used: [], ...BYOV }), 88000);
  assert.equal(allocateVehicleNumber({ used: [], ...ENTERPRISE }), 260000);
});

test("allocator: prefers max-in-band + 1 so numbers always increase", () => {
  // 88005 is free as a gap, but we deliberately do NOT re-pick below the max.
  assert.equal(allocateVehicleNumber({ used: [88000, 88001, 88010], ...BYOV }), 88011);
});

test("allocator: ignores numbers outside the requested band", () => {
  assert.equal(allocateVehicleNumber({ used: [1, 2, 99999, 260500], ...BYOV }), 88000);
});

test("allocator: the Holman class skips the whole 088 BYOV band", () => {
  const n = allocateVehicleNumber({ used: [87999], start: 1, end: 99999, excluded: inByovBand });
  assert.equal(n, 89000, "must land past the BYOV band, not inside it");
});

test("allocator: band-skip lands on a number that is actually free", () => {
  // Walking out of the excluded band must also step over USED numbers — the old
  // implementation only skipped excluded ones and could hand out a live number.
  const used = new Set([87999, 89000, 89001, 89002]);
  const n = allocateVehicleNumber({ used, start: 1, end: 99999, excluded: inByovBand });
  assert.equal(n, 89003);
  assert.equal(used.has(n!), false);
});

test("allocator: falls back to the lowest free gap when the band max is exhausted", () => {
  const used = new Set<number>();
  for (let n = 88000; n <= 88999; n++) used.add(n);
  used.delete(88042);
  assert.equal(allocateVehicleNumber({ used, ...BYOV }), 88042);
});

test("allocator: returns null when the band is completely full", () => {
  const used = new Set<number>();
  for (let n = 88000; n <= 88999; n++) used.add(n);
  assert.equal(allocateVehicleNumber({ used, ...BYOV }), null);
});

test("allocator: a huge used set does not blow the argument-spread limit", () => {
  // Math.max(...array) throws RangeError around ~100k+ arguments. The allocator
  // computes the in-band maximum by iteration precisely so a large band is safe.
  const used = new Set<number>();
  for (let n = 260000; n < 500000; n++) used.add(n);
  assert.equal(used.size, 240000);
  assert.equal(allocateVehicleNumber({ used, ...ENTERPRISE }), 500000);
});

test("allocator: an inverted band allocates nothing", () => {
  assert.equal(allocateVehicleNumber({ used: [], start: 100, end: 99 }), null);
});

// ── Duplicate gate (fail-closed) ─────────────────────────────────────────────

const clean = (source: string): DuplicateProbe => ({ source, checked: true, conflict: null });

test("duplicate gate: all checks clean → allow", () => {
  const d = decideDuplicateGate([clean("holman_cache"), clean("holman_live"), clean("in_flight_reservation")]);
  assert.deepEqual(d, { action: "allow" });
});

test("duplicate gate: a cache hit blocks with the conflicting vehicle", () => {
  const d = decideDuplicateGate([
    { source: "holman_cache", checked: true, conflict: { vehicleNumber: "088277", vin: "1FTBW2CM5NKA12345" } },
    clean("holman_live"),
  ]);
  assert.equal(d.action, "block-duplicate");
  assert.equal(d.action === "block-duplicate" && d.source, "holman_cache");
  assert.equal(d.action === "block-duplicate" && d.conflict.vehicleNumber, "088277");
});

test("duplicate gate: a live-Holman hit blocks even when the cache is clean", () => {
  const d = decideDuplicateGate([
    clean("holman_cache"),
    { source: "holman_live", checked: true, conflict: { vehicleNumber: "088279" } },
  ]);
  assert.equal(d.action, "block-duplicate");
  assert.equal(d.action === "block-duplicate" && d.source, "holman_live");
});

test("duplicate gate: an in-flight reservation for the same VIN blocks", () => {
  const d = decideDuplicateGate([
    clean("holman_cache"),
    { source: "in_flight_reservation", checked: true, conflict: { vehicleNumber: "088279", label: "in-flight submission" } },
    clean("holman_live"),
  ]);
  assert.equal(d.action, "block-duplicate");
  assert.equal(d.action === "block-duplicate" && d.source, "in_flight_reservation");
});

test("duplicate gate: FAIL-CLOSED — a database blip refuses the submission", () => {
  const d = decideDuplicateGate([
    { source: "holman_cache", checked: false, error: "connection terminated" },
    clean("holman_live"),
  ]);
  assert.equal(d.action, "block-unverified");
  assert.equal(d.action === "block-unverified" && d.source, "holman_cache");
  assert.match(d.action === "block-unverified" ? d.error : "", /connection terminated/);
});

test("duplicate gate: FAIL-CLOSED — an unreachable Holman refuses the submission", () => {
  const d = decideDuplicateGate([clean("holman_cache"), { source: "holman_live", checked: false, error: "503" }]);
  assert.equal(d.action, "block-unverified");
  assert.equal(d.action === "block-unverified" && d.source, "holman_live");
});

test("duplicate gate: a confirmed duplicate outranks an unverified check", () => {
  const d = decideDuplicateGate([
    { source: "holman_live", checked: false, error: "timeout" },
    { source: "holman_cache", checked: true, conflict: { vehicleNumber: "088277" } },
  ]);
  assert.equal(d.action, "block-duplicate");
});

test("duplicate gate: an unverified probe with no error message still blocks", () => {
  const d = decideDuplicateGate([{ source: "holman_cache", checked: false }]);
  assert.equal(d.action, "block-unverified");
  assert.match(d.action === "block-unverified" ? d.error : "", /did not complete/);
});

// ── Reservation conflict / reclaim ───────────────────────────────────────────

const NOW = Date.UTC(2026, 7, 15, 12, 0, 0);
const VIN_A = "1FTBW2CM5NKA12345";
const VIN_B = "1FTBW2CM5NKB67890";

const row = (over: Partial<Parameters<typeof decideReservationConflict>[0]["row"]> = {}) => ({
  id: 1,
  vin: VIN_A,
  holmanSuccess: false,
  wmsSuccess: false,
  submittedAt: new Date(NOW - 60_000),
  holdExpiresAt: null,
  reservedSession: null,
  ...(over as object),
});

test("reservation: same VIN → reuse the row (idempotent retry of the same vehicle)", () => {
  const d = decideReservationConflict({ row: row(), incomingVin: VIN_A, sessionKey: "s1", nowMs: NOW });
  assert.deepEqual(d, { action: "reuse" });
});

test("reservation: same VIN in different case/spacing still reuses", () => {
  const d = decideReservationConflict({ row: row(), incomingVin: " 1ftbw2cm5nka12345 ", sessionKey: null, nowMs: NOW });
  assert.deepEqual(d, { action: "reuse" });
});

test("reservation: a different VIN on a fresh in-flight row is a collision", () => {
  const d = decideReservationConflict({ row: row(), incomingVin: VIN_B, sessionKey: "s1", nowMs: NOW });
  assert.equal(d.action, "collision");
  assert.match(d.action === "collision" ? d.reason : "", /in flight/);
});

test("reservation: a number with a prior system success is never reclaimed", () => {
  const old = row({ holmanSuccess: true, submittedAt: new Date(NOW - 30 * 24 * 3600_000) });
  const d = decideReservationConflict({ row: old, incomingVin: VIN_B, sessionKey: "s1", nowMs: NOW });
  assert.equal(d.action, "collision");
  assert.match(d.action === "collision" ? d.reason : "", /already registered/);
});

test("reservation: an abandoned in-flight row past the stale window is reclaimed", () => {
  const stale = row({ submittedAt: new Date(NOW - RESERVATION_STALE_MS - 1000) });
  const d = decideReservationConflict({ row: stale, incomingVin: VIN_B, sessionKey: "s1", nowMs: NOW });
  assert.equal(d.action, "reclaim-stale");
});

test("reservation: our own un-expired suggestion hold is adopted", () => {
  const hold = row({ vin: null, holdExpiresAt: new Date(NOW + 5 * 60_000), reservedSession: "s1" });
  const d = decideReservationConflict({ row: hold, incomingVin: VIN_A, sessionKey: "s1", nowMs: NOW });
  assert.deepEqual(d, { action: "adopt-hold" });
});

test("reservation: someone else's un-expired hold is a collision", () => {
  const hold = row({ vin: null, holdExpiresAt: new Date(NOW + 5 * 60_000), reservedSession: "s2" });
  const d = decideReservationConflict({ row: hold, incomingVin: VIN_A, sessionKey: "s1", nowMs: NOW });
  assert.equal(d.action, "collision");
  assert.match(d.action === "collision" ? d.reason : "", /held by another user/);
});

test("reservation: an anonymous caller cannot adopt a session-owned hold", () => {
  const hold = row({ vin: null, holdExpiresAt: new Date(NOW + 5 * 60_000), reservedSession: "s2" });
  const d = decideReservationConflict({ row: hold, incomingVin: VIN_A, sessionKey: null, nowMs: NOW });
  assert.equal(d.action, "collision");
});

test("reservation: an EXPIRED hold is reclaimable by anyone", () => {
  const hold = row({ vin: null, holdExpiresAt: new Date(NOW - 1000), reservedSession: "s2" });
  const d = decideReservationConflict({ row: hold, incomingVin: VIN_A, sessionKey: "s1", nowMs: NOW });
  assert.equal(d.action, "reclaim-stale");
});

test("reservation: a missing row is a collision — never proceed un-reserved", () => {
  const d = decideReservationConflict({ row: null, incomingVin: VIN_A, sessionKey: "s1", nowMs: NOW });
  assert.equal(d.action, "collision");
  assert.match(d.action === "collision" ? d.reason : "", /could not be read back/);
});

test("reservation: a row with no submittedAt is treated as infinitely stale", () => {
  const d = decideReservationConflict({
    row: row({ submittedAt: null }),
    incomingVin: VIN_B,
    sessionKey: "s1",
    nowMs: NOW,
  });
  assert.equal(d.action, "reclaim-stale");
});

// ── Holman acceptance evidence ───────────────────────────────────────────────

test("holman evidence: a validated record count is acceptance", () => {
  const a = classifyHolmanSubmitResponse({
    validatedRecordCount: 1,
    errorCount: 0,
    userReferenceToken: "tok-123",
    message: "[1] record submitted. [0] records rejected due to errors. [1] record successfully captured for processing.",
  });
  assert.equal(a.outcome, "accepted");
  assert.equal(a.referenceToken, "tok-123");
});

test("holman evidence: a captured-count message alone is acceptance", () => {
  const a = classifyHolmanSubmitResponse({
    message: "[1] record submitted. [0] records rejected due to errors. [1] record successfully captured for processing.",
  });
  assert.equal(a.outcome, "accepted");
});

test("holman evidence: an empty 2xx body is UNCONFIRMED, not success", () => {
  // This is the core regression: the old route treated any non-throwing submit
  // as a success and then mirrored a phantom row into the local Holman cache.
  assert.equal(classifyHolmanSubmitResponse({}).outcome, "unconfirmed");
  assert.equal(classifyHolmanSubmitResponse(null).outcome, "unconfirmed");
  assert.equal(classifyHolmanSubmitResponse("OK").outcome, "unconfirmed");
});

test("holman evidence: a rejected-record count in the message is a rejection", () => {
  const a = classifyHolmanSubmitResponse({
    message: "[1] record submitted. [1] records rejected due to errors. [0] records successfully captured for processing.",
  });
  assert.equal(a.outcome, "rejected");
});

test("holman evidence: zero captured records is not acceptance", () => {
  // "submitted" only means Holman received it. Nothing was captured, so this is
  // not a success even though a record count is present.
  const a = classifyHolmanSubmitResponse({
    message: "[1] record submitted. [0] records rejected due to errors. [0] records successfully captured for processing.",
    recordsSubmitted: 1,
  });
  assert.equal(a.outcome, "unconfirmed");
});

test("holman evidence: per-record errors are a rejection even with a 2xx", () => {
  const a = classifyHolmanSubmitResponse({
    errorCount: 1,
    errors: [{ holmanVehicleNumber: "088277", errorMessages: ["VIN already exists"] }],
  });
  assert.equal(a.outcome, "rejected");
  assert.deepEqual(a.errorMessages, ["VIN already exists"]);
  assert.match(a.detail, /VIN already exists/);
});

test("holman evidence: an errorCount outranks a positive record count", () => {
  const a = classifyHolmanSubmitResponse({ validatedRecordCount: 1, errorCount: 1 });
  assert.equal(a.outcome, "rejected");
});

test("holman evidence: string error entries are surfaced", () => {
  const a = classifyHolmanSubmitResponse({ errors: ["Invalid assetType"] });
  assert.equal(a.outcome, "rejected");
  assert.deepEqual(a.errorMessages, ["Invalid assetType"]);
});

// ── Per-system outcome reporting ─────────────────────────────────────────────

test("outcome: WMS-only create that fails is NOT reported as a Holman success", () => {
  // The old route reported holmanOnly:true here, because an untargeted Holman
  // defaulted to { success: true, skipped: true }.
  const s = summarizeCreateOutcome({
    holman: { attempted: false, success: true },
    wms: { attempted: true, success: false, error: "WMS 500" },
    tpms: { attempted: false, success: true },
  });
  assert.equal(s.holmanOnly, false);
  assert.equal(s.overall, "failed");
  assert.deepEqual(s.attempted, ["wms"]);
  assert.deepEqual(s.failed, ["wms"]);
});

test("outcome: a genuine Holman-only success is still reported as such", () => {
  const s = summarizeCreateOutcome({
    holman: { attempted: true, success: true },
    wms: { attempted: true, success: false, error: "WMS 500" },
    tpms: { attempted: false, success: true },
  });
  assert.equal(s.holmanOnly, true);
  assert.equal(s.overall, "partial");
});

test("outcome: a pending Holman never counts as a success", () => {
  const s = summarizeCreateOutcome({
    holman: { attempted: true, success: false, pending: true },
    wms: { attempted: true, success: true },
    tpms: { attempted: true, success: true },
  });
  assert.equal(s.holmanOnly, false);
  assert.equal(s.wmsOnly, true);
  assert.equal(s.overall, "pending");
  assert.deepEqual(s.pending, ["holman"]);
});

test("outcome: everything targeted succeeded → success", () => {
  const s = summarizeCreateOutcome({
    holman: { attempted: true, success: true },
    wms: { attempted: true, success: true },
    tpms: { attempted: true, success: true },
  });
  assert.equal(s.overall, "success");
  assert.deepEqual(s.succeeded, ["holman", "wms", "tpms"]);
});

test("outcome: nothing targeted → noop", () => {
  const s = summarizeCreateOutcome({
    holman: { attempted: false, success: true },
    wms: { attempted: false, success: true },
    tpms: { attempted: false, success: true },
  });
  assert.equal(s.overall, "noop");
  assert.deepEqual(s.attempted, []);
});

// ── Route wiring: no create path may bypass the gates ────────────────────────
//
// The gate logic above is only worth anything if EVERY endpoint that can write a
// vehicle into an external system actually runs it. The retry routes are the easy
// bypass: they create real Holman/WMS/TPMS records too. These tests read the route
// source and fail if a create path drops a gate or ignores rehearsal mode.

const routesSrc = readFileSync(new URL("../server/routes.ts", import.meta.url), "utf8");

function routeBody(method: "post" | "get", path: string): string {
  const start = routesSrc.indexOf(`app.${method}("${path}"`);
  assert.notEqual(start, -1, `route ${method.toUpperCase()} ${path} not found`);
  const rest = routesSrc.slice(start + 10);
  const next = rest.search(/\n  app\.(get|post|put|patch|delete)\(/);
  return next === -1 ? rest : rest.slice(0, next);
}

const CREATE_ROUTES = ["/api/byov/create", "/api/byov/create-wms-only", "/api/byov/create-holman-only"];

for (const path of CREATE_ROUTES) {
  test(`route wiring: ${path} is behind the feature gate and the permission check`, () => {
    const body = routeBody("post", path);
    assert.ok(body.includes("vehicleCreateGateState()"), "must read the feature gate");
    assert.ok(body.includes("gate.enabled"), "must refuse when the gate is off");
    assert.ok(
      body.includes("requireVehicleCreatePermission(req, res)"),
      "must enforce authorization server-side, not rely on the client permission map",
    );
  });

  test(`route wiring: ${path} honours rehearsal mode before any external write`, () => {
    const body = routeBody("post", path);
    const rehearsalAt = body.indexOf("gate.rehearsal");
    assert.notEqual(rehearsalAt, -1, "must branch on rehearsal mode");
    // Every external-write call has to come AFTER the rehearsal short-circuit.
    for (const call of ["runGuardedHolmanSubmit(", "runGuardedWmsCreate(", "submitVehicleArray(", "createTruck(", "addTruck("]) {
      const at = body.indexOf(call);
      if (at === -1) continue;
      assert.ok(at > rehearsalAt, `${call} must not run before the rehearsal short-circuit`);
    }
    assert.ok(body.includes("wouldSend"), "rehearsal must report what would be sent");
  });
}

// The two VIN-bearing create paths must both gate the VIN. create-wms-only is
// excluded on purpose: WMS/TPMS truck records carry no VIN.
for (const path of ["/api/byov/create", "/api/byov/create-holman-only"]) {
  test(`route wiring: ${path} runs the fail-closed VIN gate before submitting`, () => {
    const body = routeBody("post", path);
    assert.ok(body.includes("validateVin("), "must validate VIN shape");
    assert.ok(body.includes("probeVinDuplicates("), "must probe for duplicate VINs");
    assert.ok(body.includes("decideDuplicateGate("), "must apply the duplicate decision");
    assert.ok(body.includes("duplicate_check_unavailable"), "must refuse when a check cannot complete");

    const gateAt = body.indexOf("decideDuplicateGate(");
    const submitAt = body.indexOf("runGuardedHolmanSubmit(");
    assert.notEqual(submitAt, -1, "must submit through the guarded path");
    assert.ok(submitAt > gateAt, "the VIN gate must run before the Holman submit");
  });
}

test("route wiring: every Holman write goes through the guarded submit", () => {
  // The pre-check/refuse/classify sequence lives in runGuardedHolmanSubmit, which
  // has behavioral coverage in tests/vehicle-create-external.test.ts. What matters
  // here is that no route hand-rolls its own submit around it.
  for (const path of ["/api/byov/create", "/api/byov/create-holman-only"]) {
    const body = routeBody("post", path);
    assert.ok(body.includes("runGuardedHolmanSubmit("), `${path} must submit through the guarded path`);
    assert.ok(body.includes("submitOutcome.refusal"), `${path} must honour a refusal`);
    const rawSubmit = body.indexOf("await holmanApiService.submitVehicleArray(");
    assert.equal(rawSubmit, -1, `${path} must not submit to Holman outside the guarded path`);
  }
});

test("route wiring: every WMS/TPMS write goes through the guarded create", () => {
  // runGuardedWmsCreate refuses (and calls nothing) when the WMS existence probe
  // cannot complete — proven behaviorally in tests/vehicle-create-external.test.ts.
  // Both create paths must route their WMS + TPMS writes through it.
  for (const path of ["/api/byov/create", "/api/byov/create-wms-only"]) {
    const body = routeBody("post", path);
    assert.ok(body.includes("runGuardedWmsCreate("), `${path} must create through the guarded path`);
    assert.ok(body.includes("wmsOutcome.refusal"), `${path} must honour a refusal`);
    assert.equal(
      body.indexOf("await wmsEngineService.createTruck("),
      -1,
      `${path} must not create in WMS outside the guarded path`,
    );
    assert.equal(
      body.indexOf("await tpmsService.addTruck("),
      -1,
      `${path} must not register in TPMS outside the guarded path`,
    );
  }
  assert.ok(
    routeBody("post", "/api/byov/create-wms-only").includes("probeActiveNumberHold("),
    "the retry must refuse to write under another session's hold",
  );
});

test("route wiring: an unconfirmed Holman submit never mirrors a cache row", () => {
  for (const path of ["/api/byov/create", "/api/byov/create-holman-only"]) {
    const body = routeBody("post", path);
    const insertAt = body.indexOf("insert(holmanVehiclesCache)");
    if (insertAt === -1) continue;
    const guardAt = body.indexOf("holmanLiveConfirmed");
    assert.ok(guardAt !== -1 && guardAt < insertAt, `${path} must guard the cache write on live confirmation`);
  }
});

test("route wiring: the suggested number is held, not merely recommended", () => {
  const body = routeBody("get", "/api/byov/next-number");
  assert.ok(body.includes("requireVehicleCreatePermission(req, res)"), "must be authorized");
  assert.ok(body.includes("sweepExpiredVehicleHolds("), "must expire abandoned holds");
  assert.ok(body.includes("holdExpiresAt"), "must issue a time-limited hold");
  assert.ok(body.includes("gatherUsedVehicleNumbers("), "must scan every used-number source");
  assert.ok(body.includes("scan.complete"), "must refuse to allocate from an incomplete scan");
});

// ── No raw create path may bypass the gate (Task #636 review) ────────────────

test("route wiring: the Holman submit relay refuses assetAction ADD", () => {
  const body = routeBody("post", "/api/holman/vehicles/submit");
  assert.ok(body.includes('String(rec.assetAction || "").toUpperCase() === "ADD"'), "must detect ADD records");
  assert.ok(body.includes("vehicle_create_route_required"), "must refuse ADD with a pointer to the gated create route");
  const refuseAt = body.indexOf("vehicle_create_route_required");
  const submitAt = body.indexOf("holmanApiService.submitVehicle(");
  assert.notEqual(submitAt, -1, "relay still forwards non-ADD records");
  assert.ok(refuseAt < submitAt, "the ADD refusal must come before the forward");
});

test("route wiring: the raw WMS truck create is closed to vehicle creation", () => {
  const src = readFileSync(new URL("../server/wms-engine-routes.ts", import.meta.url), "utf8");
  const start = src.indexOf('router.post("/trucks", ');
  assert.notEqual(start, -1, "POST /api/wms/trucks not found");
  const rest = src.slice(start);
  const end = rest.search(/\n  router\.(get|post|put|patch|delete)\(/);
  const body = end === -1 ? rest : rest.slice(0, end);

  assert.ok(body.includes("vehicle_create_route_required"), "must refuse with a pointer to the gated create route");
  assert.equal(
    body.indexOf("wmsEngineService.createTruck("),
    -1,
    "must not create in WMS at all — a raw create skips the hold, reservation and audit gates",
  );
});
