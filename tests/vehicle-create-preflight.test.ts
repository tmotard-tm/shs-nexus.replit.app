/**
 * Task #637 — Create Vehicle wizard alignment.
 *
 * These cover the decision rules the wizard now depends on: a block is a block,
 * a check that could not complete is a warning (the fail-closed server gate is
 * the authority), a number hold has a real lifetime, and an unconfirmed create
 * is reported as pending rather than success.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  applyRetryResponse,
  classifyNumberCheck,
  classifyVinCheck,
  classifyVinFormat,
  createNumberPreflight,
  createVinPreflight,
  combinePreflight,
  describeNumberHold,
  classifySystemResult,
  describeOutcome,
  describeGate,
  describeRefusal,
  IDLE_VERDICT,
  HOLD_EXPIRING_MS,
  type CheckVerdict,
} from "../client/src/lib/vehicle-create-preflight";

// ── Vehicle-number check ─────────────────────────────────────────────────────

test("number check: an existing vehicle blocks", () => {
  const verdict = classifyNumberCheck("088095", {
    ok: true,
    status: 200,
    body: { exists: true, canonical: "88095" },
  });
  assert.equal(verdict.status, "block");
  assert.match(verdict.detail!, /already registered in Holman/);
});

test("number check: a free number is clear", () => {
  const verdict = classifyNumberCheck("088095", { ok: true, status: 200, body: { exists: false, canonical: "88095" } });
  assert.equal(verdict.status, "clear");
});

test("number check: a failed lookup warns instead of blocking", () => {
  const verdict = classifyNumberCheck("088095", { ok: false, status: 500, body: { exists: false, error: "boom" } });
  assert.equal(verdict.status, "warn");
  assert.match(verdict.detail!, /boom/);
});

test("number check: an empty number is idle", () => {
  assert.equal(classifyNumberCheck("   ", { ok: true, status: 200, body: { exists: false } }).status, "idle");
});

// ── VIN check ────────────────────────────────────────────────────────────────

test("VIN check: a duplicate blocks and names the holder", () => {
  const verdict = classifyVinCheck("1FTBW3XG8PKA00001", {
    ok: true,
    status: 200,
    body: {
      exists: true,
      valid: true,
      matches: [{ vehicleNumber: "088277", make: "FORD", model: "TRANSIT", modelYear: 2023, source: "holman_cache" }],
    },
  });
  assert.equal(verdict.status, "block");
  assert.match(verdict.detail!, /088277/);
  assert.match(verdict.detail!, /2023 FORD TRANSIT/);
});

test("VIN check: an in-flight reservation blocks and says so", () => {
  const verdict = classifyVinCheck("1FTBW3XG8PKA00001", {
    ok: true,
    status: 200,
    body: { exists: true, valid: true, matches: [{ vehicleNumber: "088300", source: "in_flight_reservation" }] },
  });
  assert.equal(verdict.status, "block");
  assert.match(verdict.detail!, /in-flight Create Vehicle submission/);
});

test("VIN check: an invalid VIN blocks with the server's reason", () => {
  const verdict = classifyVinCheck("IIIII", {
    ok: true,
    status: 200,
    body: { exists: false, valid: false, reason: "VIN must be exactly 17 characters (received 5)." },
  });
  assert.equal(verdict.status, "block");
  assert.equal(verdict.detail, "VIN must be exactly 17 characters (received 5).");
});

test("VIN check: a clean VIN is clear, a broken check warns", () => {
  assert.equal(
    classifyVinCheck("1FTBW3XG8PKA00001", { ok: true, status: 200, body: { exists: false, valid: true } }).status,
    "clear",
  );
  assert.equal(
    classifyVinCheck("1FTBW3XG8PKA00001", { ok: false, status: 0, body: null, transportError: "offline" }).status,
    "warn",
  );
});

// ── Local VIN format gate ────────────────────────────────────────────────────
// A malformed VIN must be caught in the form. Previously the wizard only ever
// looked at a VIN once it hit 17 characters, so a 16-character VIN left the
// check idle and the submit button enabled — the server then refused it.

test("VIN format: a short VIN blocks rather than sitting idle", () => {
  const verdict = classifyVinFormat("1FTBW3XG8PKA0000")!;
  assert.equal(verdict.status, "block");
  assert.match(verdict.detail!, /exactly 17 characters \(received 16\)/);
});

test("VIN format: an empty VIN is idle, not a block", () => {
  assert.equal(classifyVinFormat("")!.status, "idle");
  assert.equal(classifyVinFormat("   ")!.status, "idle");
});

test("VIN format: the letters I, O and Q are rejected", () => {
  const verdict = classifyVinFormat("1FTBW3XG8PKAO0001")!;
  assert.equal(verdict.status, "block");
  assert.match(verdict.detail!, /never uses the letters I, O or Q/);
});

test("VIN format: a placeholder VIN is rejected", () => {
  assert.equal(classifyVinFormat("11111111111111111")!.status, "block");
});

test("VIN format: an invalid model-year code at position 10 is rejected", () => {
  // Position 10 (index 9) is "Z", which is not a valid model-year code.
  const verdict = classifyVinFormat("1FTBW3XG8ZA000012")!;
  assert.equal(verdict.status, "block");
  assert.match(verdict.detail!, /position 10/);
});

test("VIN format: a well-formed VIN defers to the duplicate check", () => {
  assert.equal(classifyVinFormat("1FTBW3XG8PKA00001"), null);
});

test("VIN format: lowercase input is normalized before judging", () => {
  assert.equal(classifyVinFormat("1ftbw3xg8pka00001"), null);
});

// ── Sequenced VIN preflight ──────────────────────────────────────────────────
// The gate must publish a verdict for whatever is in the field RIGHT NOW, and
// must never publish one for a value the user has moved on from.

const VALID_VIN = "1FTBW3XG8PKA00001";

function recorder() {
  const published: CheckVerdict[] = [];
  const inputs: string[] = [];
  return {
    published,
    inputs,
    publish: (v: CheckVerdict, input: string) => {
      published.push(v);
      inputs.push(input);
    },
  };
}

const last = <T,>(xs: T[]) => xs[xs.length - 1];

test("VIN preflight: deleting a character then restoring re-publishes the real verdict", async () => {
  // Regression: the verdict used to be produced as a side effect of VIN
  // decoding, which cached the last decoded VIN. Restoring a previously decoded
  // VIN hit that cache and returned early, so the malformed-VIN block from the
  // partial value stayed on screen and the user could not submit a valid VIN
  // without changing it to something else entirely.
  const rec = recorder();
  let lookups = 0;
  const preflight = createVinPreflight({
    publish: rec.publish,
    lookup: async () => {
      lookups++;
      return { status: "clear", title: "VIN is not registered anywhere yet" };
    },
  });

  await preflight.run(VALID_VIN);
  assert.equal(last(rec.published).status, "clear");

  await preflight.run(VALID_VIN.slice(0, 16)); // user deletes one character
  assert.equal(last(rec.published).status, "block");

  await preflight.run(VALID_VIN); // ...and types it straight back
  assert.equal(last(rec.published).status, "clear", "restoring a valid VIN must be re-judged, not left blocked");
  assert.equal(lookups, 2, "the duplicate check must actually re-run");
});

test("VIN preflight: a malformed VIN never reaches the duplicate endpoint", async () => {
  const rec = recorder();
  let lookups = 0;
  const preflight = createVinPreflight({
    publish: rec.publish,
    lookup: async () => {
      lookups++;
      return { status: "clear", title: "clear" };
    },
  });
  await preflight.run("SHORT");
  assert.equal(lookups, 0);
  assert.equal(last(rec.published).status, "block");
});

test("VIN preflight: a slow answer for an abandoned VIN is dropped", async () => {
  const rec = recorder();
  const gates: Record<string, () => void> = {};
  const preflight = createVinPreflight({
    publish: rec.publish,
    lookup: (vin) =>
      new Promise<CheckVerdict>((resolve) => {
        gates[vin] = () => resolve({ status: "block", title: `stale verdict for ${vin}` });
      }),
  });

  const slow = preflight.run(VALID_VIN);
  const secondVin = "1FTBW3XG8PKA00002";
  const fast = preflight.run(secondVin);
  gates[secondVin]!();
  await fast;
  gates[VALID_VIN]!(); // the abandoned VIN finally answers
  await slow;

  assert.match(last(rec.published).title, /00002/, "the current VIN's verdict must survive");
});

test("VIN preflight: an emptied field goes back to idle", async () => {
  const rec = recorder();
  const preflight = createVinPreflight({ publish: rec.publish, lookup: async () => ({ status: "clear", title: "c" }) });
  await preflight.run(VALID_VIN);
  await preflight.run("");
  assert.equal(last(rec.published).status, "idle");
});

test("VIN preflight: invalidate() drops an in-flight answer so a server refusal stands", async () => {
  const rec = recorder();
  let release!: (v: CheckVerdict) => void;
  const preflight = createVinPreflight({
    publish: rec.publish,
    lookup: () => new Promise<CheckVerdict>((resolve) => { release = resolve; }),
  });
  const pending = preflight.run(VALID_VIN);
  preflight.invalidate(); // a 409 from the server lands and owns the verdict
  release({ status: "clear", title: "advisory says clear" });
  await pending;
  assert.equal(last(rec.published).status, "checking", "the advisory answer must not overwrite the refusal");
});

test("number preflight: every verdict is stamped with the value it describes", async () => {
  // Regression: the number check only ran on blur, so submitting with Enter
  // straight from the field reached the server with no verdict at all. The
  // submit path now compares the field against the value the verdict belongs
  // to, and refuses while they differ.
  const rec = recorder();
  const preflight = createNumberPreflight({
    publish: rec.publish,
    lookup: async (num) => ({ status: num === "088095" ? "block" : "clear", title: `verdict for ${num}` }),
  });

  await preflight.run("088095");
  assert.equal(last(rec.inputs), "088095", "the verdict must name the number it judged");
  assert.equal(last(rec.published).status, "block");

  // The user edits the field. Until the check re-runs, the stamped value no
  // longer matches what is on screen — which is what the submit guard reads.
  assert.notEqual(last(rec.inputs), "088096");

  await preflight.run("  088096  ");
  assert.equal(last(rec.inputs), "088096", "the stamp is the normalized value, so it compares cleanly");
  assert.equal(last(rec.published).status, "clear");
});

test("number preflight: a slow answer for an old number is dropped", async () => {
  const rec = recorder();
  const gates: Record<string, () => void> = {};
  const preflight = createNumberPreflight({
    publish: rec.publish,
    lookup: (num) =>
      new Promise<CheckVerdict>((resolve) => {
        gates[num] = () => resolve({ status: "block", title: `verdict for ${num}` });
      }),
  });
  const slow = preflight.run("088095");
  const fast = preflight.run("088096");
  gates["088096"]!();
  await fast;
  gates["088095"]!();
  await slow;
  assert.match(last(rec.published).title, /088096/);
});

// ── Combined verdict ─────────────────────────────────────────────────────────

test("combined verdict: any blocking check blocks the whole preflight", () => {
  const combined = combinePreflight(
    { status: "clear", title: "ok" },
    { status: "block", title: "VIN is already registered", detail: "dup" },
  );
  assert.equal(combined.blocked, true);
  assert.deepEqual(combined.blockingReasons, ["dup"]);
});

test("combined verdict: warnings never block", () => {
  const combined = combinePreflight(
    { status: "warn", title: "not verified", detail: "cache down" },
    { status: "clear", title: "ok" },
  );
  assert.equal(combined.blocked, false);
  assert.deepEqual(combined.warnings, ["cache down"]);
});

test("combined verdict: an unchecked form is neither blocked nor checking", () => {
  const combined = combinePreflight(IDLE_VERDICT, IDLE_VERDICT);
  assert.equal(combined.blocked, false);
  assert.equal(combined.checking, false);
});

// ── Number hold ──────────────────────────────────────────────────────────────

const now = Date.parse("2026-08-17T12:00:00.000Z");
const hold = (expiresAt: string | null) => ({
  number: "088095",
  holdId: 12,
  expiresAt,
  scannedSources: ["holman_cache", "tpms"],
});

test("hold: a live hold counts down", () => {
  const status = describeNumberHold({
    hold: hold(new Date(now + 10 * 60 * 1000).toISOString()),
    currentNumber: "088095",
    nowMs: now,
  });
  assert.equal(status.state, "held");
  assert.equal(status.remainingLabel, "10:00");
});

test("hold: a hold close to its expiry is flagged as expiring", () => {
  const status = describeNumberHold({
    hold: hold(new Date(now + HOLD_EXPIRING_MS - 1000).toISOString()),
    currentNumber: "088095",
    nowMs: now,
  });
  assert.equal(status.state, "expiring");
});

test("hold: an elapsed hold is reported as lapsed, not as held", () => {
  const status = describeNumberHold({
    hold: hold(new Date(now - 1000).toISOString()),
    currentNumber: "088095",
    nowMs: now,
  });
  assert.equal(status.state, "lapsed");
  assert.match(status.detail, /fresh one/);
});

test("hold: typing a different number drops the hold claim", () => {
  const status = describeNumberHold({
    hold: hold(new Date(now + 60_000).toISOString()),
    currentNumber: "088999",
    nowMs: now,
  });
  assert.equal(status.state, "manual");
});

test("hold: leading zeros do not break the hold match", () => {
  const status = describeNumberHold({
    hold: hold(new Date(now + 60_000).toISOString()),
    currentNumber: "88095",
    nowMs: now,
  });
  assert.notEqual(status.state, "manual");
});

test("hold: no hold at all", () => {
  assert.equal(describeNumberHold({ hold: null, currentNumber: "088095", nowMs: now }).state, "none");
});

// ── Per-system results ───────────────────────────────────────────────────────

test("system result: pending outranks success so an unconfirmed create is never green", () => {
  const row = classifySystemResult("Holman", { success: true, pending: true });
  assert.equal(row.status, "pending");
});

test("system result: a failure carries the server error", () => {
  assert.deepEqual(classifySystemResult("WMS", { success: false, error: "WMS 500" }), {
    system: "WMS",
    status: "failed",
    message: "WMS 500",
  });
});

test("system result: rehearsal is its own state", () => {
  assert.equal(classifySystemResult("Holman", { success: false, skipped: true, rehearsal: true }).status, "rehearsal");
});

// ── Outcome view ─────────────────────────────────────────────────────────────

test("outcome: server summary wins when present", () => {
  const view = describeOutcome({
    holman: { success: true },
    wms: { success: false, error: "nope" },
    summary: { overall: "partial", holmanOnly: true },
  })!;
  assert.equal(view.kind, "partial");
  assert.equal(view.mixed, true);
});

test("outcome: an unconfirmed Holman submission reads as pending, not success", () => {
  const view = describeOutcome({
    holman: { success: false, pending: true },
    wms: { success: true },
    summary: { overall: "pending" },
  })!;
  assert.equal(view.kind, "pending");
  assert.match(view.detail, /did not confirm/);
});

test("outcome: retry responses without a summary are derived from the rows", () => {
  const view = describeOutcome({ holman: { success: true }, wms: { success: true } })!;
  assert.equal(view.kind, "success");

  const failedView = describeOutcome({ holman: { success: false, error: "x" } })!;
  assert.equal(failedView.kind, "failed");
});

test("outcome: rehearsal never claims a create happened", () => {
  const view = describeOutcome({
    rehearsal: true,
    holman: { success: false, skipped: true, rehearsal: true },
    wms: { success: false, skipped: true, rehearsal: true },
    tpms: { success: false, skipped: true, rehearsal: true },
    message: "Rehearsal mode: every gate passed and nothing was sent.",
  })!;
  assert.equal(view.kind, "rehearsal");
  assert.equal(view.rows.length, 3);
  assert.ok(view.rows.every((r) => r.status === "rehearsal"));
});

// ── Standalone retries ───────────────────────────────────────────────────────
// A rehearsed retry sends nothing. Merging its per-system fields over the real
// outcome would turn a still-broken submission into a displayed success while
// nothing had actually been retried.

const wmsFailedOutcome = {
  holman: { success: true },
  wms: { success: false, error: "WMS 500" },
  summary: { overall: "partial" as const, holmanOnly: true },
};
const holmanFailedOutcome = {
  holman: { success: false, error: "Holman 500" },
  wms: { success: true },
  summary: { overall: "partial" as const },
};

test("retry: a rehearsed Holman retry leaves the real failure standing", () => {
  const applied = applyRetryResponse(
    holmanFailedOutcome,
    {
      rehearsal: true,
      holman: { success: false, skipped: true, rehearsal: true },
      wouldSend: { holman: { vehicleNumber: "088095" } },
      message: "Rehearsal mode: nothing was sent.",
    },
    "Holman retry",
    "holman",
  );
  // Untouched — Holman is still failed, not laundered into a success.
  assert.deepEqual(applied.submitResult, holmanFailedOutcome);
  assert.equal(describeOutcome(applied.submitResult)!.kind, "partial");
  // And the rehearsal is reported on its own, with what would have been sent.
  assert.equal(applied.retryRehearsal!.label, "Holman retry");
  assert.deepEqual(applied.retryRehearsal!.response.wouldSend, { holman: { vehicleNumber: "088095" } });
});

test("retry: a rehearsed WMS retry leaves the real failure standing", () => {
  const applied = applyRetryResponse(
    wmsFailedOutcome,
    {
      rehearsal: true,
      wms: { success: false, skipped: true, rehearsal: true },
      tpms: { success: false, skipped: true, rehearsal: true },
      wouldSend: { wms: { truckNo: "088095" } },
    },
    "WMS retry",
    "wms",
  );
  assert.deepEqual(applied.submitResult, wmsFailedOutcome);
  assert.equal(applied.submitResult!.wms!.success, false);
  assert.equal(applied.retryRehearsal!.label, "WMS retry");
  assert.ok(applied.retryRehearsal!.response.wouldSend);
});

test("retry: a real WMS retry merges and clears the partial state", () => {
  const applied = applyRetryResponse(wmsFailedOutcome, { wms: { success: true } }, "WMS retry", "wms");
  assert.equal(applied.retryRehearsal, null);
  assert.equal(applied.submitResult!.wms!.success, true);
  assert.equal(applied.submitResult!.holmanOnly, false);
  // The stale "partial" summary must not survive the merge.
  assert.equal(describeOutcome(applied.submitResult)!.kind, "success");
});

test("retry: a real Holman retry that comes back pending is not shown as success", () => {
  const applied = applyRetryResponse(
    holmanFailedOutcome,
    { holman: { success: false, pending: true } },
    "Holman retry",
    "holman",
  );
  assert.equal(applied.retryRehearsal, null);
  assert.equal(describeOutcome(applied.submitResult)!.kind, "pending");
});

test("retry: a real retry does not touch the system it was not for", () => {
  const applied = applyRetryResponse(wmsFailedOutcome, { wms: { success: true } }, "WMS retry", "wms");
  assert.deepEqual(applied.submitResult!.holman, { success: true });
});

// ── Gate ─────────────────────────────────────────────────────────────────────

test("gate: closed gate refuses submissions up front", () => {
  const banner = describeGate({ enabled: false, rehearsalMode: false }, false);
  assert.equal(banner.kind, "off");
  assert.equal(banner.submissionsRefused, true);
});

test("gate: rehearsal announces itself but still allows submitting", () => {
  const banner = describeGate({ enabled: true, rehearsalMode: true }, false);
  assert.equal(banner.kind, "rehearsal");
  assert.equal(banner.submissionsRefused, false);
});

test("gate: an unreadable gate does not pretend creation is off", () => {
  const banner = describeGate(null, true);
  assert.equal(banner.kind, "unreadable");
  assert.equal(banner.submissionsRefused, false);
});

test("gate: an open gate shows no banner", () => {
  assert.equal(describeGate({ enabled: true, rehearsalMode: false }, false).kind, null);
});

// ── Refusals ─────────────────────────────────────────────────────────────────

test("refusal: a number collision marks the hold as lost", () => {
  const view = describeRefusal(409, {
    error: "Vehicle number 088095 cannot be used — the number is currently held by another user. Pick a different number.",
  });
  assert.equal(view.attachTo, "vehicleNumber");
  assert.equal(view.holdLost, true);
});

test("refusal: a VIN conflict pins to the VIN check and keeps the hold", () => {
  const view = describeRefusal(409, {
    error: "VIN 1FTBW3XG8PKA00001 is already registered under vehicle 088277 [holman_live].",
    vinConflict: { vehicleNumber: "088277", vin: "1FTBW3XG8PKA00001", source: "holman_live" },
  });
  assert.equal(view.attachTo, "vin");
  assert.equal(view.holdLost, false);
});

test("refusal: an in-flight VIN 409 is not treated as a lost number hold", () => {
  const view = describeRefusal(409, {
    error: "VIN 1FTBW3XG8PKA00001 is already being submitted under vehicle 088300. Only one create per VIN can be in flight.",
  });
  assert.equal(view.attachTo, "vin");
  assert.equal(view.holdLost, false);
});

test("refusal: the disabled gate is named", () => {
  const view = describeRefusal(403, { error: "Vehicle creation is currently turned off.", code: "vehicle_create_disabled" });
  assert.equal(view.title, "Vehicle creation is turned off");
});

test("refusal: an unavailable duplicate check is reported as unverified, not as a duplicate", () => {
  const view = describeRefusal(503, {
    error: "Cannot verify whether VIN ... already exists — the holman_live check failed.",
    code: "duplicate_check_unavailable",
    source: "holman_live",
    retryable: true,
  });
  assert.equal(view.title, "Checks could not complete");
  assert.equal(view.attachTo, "vin");
});
