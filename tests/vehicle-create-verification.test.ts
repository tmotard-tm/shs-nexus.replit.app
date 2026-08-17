import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Task #638 — post-create read-back verification and phantom-vehicle detection.
 *
 * server/vehicle-create-verification.ts is the pure decision core behind two
 * dangerous operations:
 *
 *  1. Resolving a create attempt on evidence read back out of Holman/WMS/TPMS,
 *     and releasing the reserved vehicle number when the create is proven not to
 *     have landed. A wrong "failed" here frees a number a real vehicle is using.
 *
 *  2. Deciding whether a locally cached Holman vehicle is a phantom left behind by
 *     the old optimistic write-through. A wrong "phantom" here DELETES a row for a
 *     vehicle that exists.
 *
 * Both therefore fail closed: an inconclusive read never produces a failure and
 * never frees or deletes anything.
 */
import {
  resolveCreateVerification,
  classifyPhantomCandidate,
  tallyVerificationStates,
  needsAttention,
  decideFinalizeRelease,
  decideReservationReclaim,
  isConfirmedButReleased,
  isVerifiedSystem,
  VERIFIED_SYSTEMS,
  NON_VERIFIED_SYSTEMS,
  VERIFICATION_MAX_ATTEMPTS,
  VERIFICATION_WINDOW_MS,
  PHANTOM_GRACE_MS,
  type ReadBackProbe,
} from "../server/vehicle-create-verification.js";

const found = (): ReadBackProbe => ({ attempted: true, checked: true, found: true });
const absent = (): ReadBackProbe => ({ attempted: true, checked: true, found: false });
const unreachable = (detail = "timeout"): ReadBackProbe => ({
  attempted: true,
  checked: false,
  found: false,
  detail,
});
const notTargeted = (): ReadBackProbe => ({ attempted: false, checked: false, found: false });

/** A read-back round after the window has closed. */
const closed = { attemptNumber: VERIFICATION_MAX_ATTEMPTS, elapsedMs: VERIFICATION_WINDOW_MS + 1 };
/** A read-back round while there is still time to retry. */
const open = { attemptNumber: 1, elapsedMs: 1000 };

// ── Read-back resolution ─────────────────────────────────────────────────────

test("read-back: present in every targeted system confirms the create", () => {
  const r = resolveCreateVerification({ probes: { holman: found(), wms: found() }, ...open });
  assert.equal(r.state, "confirmed");
  assert.equal(r.retry, false);
  assert.equal(r.releaseNumber, false);
  assert.deepEqual(r.present, ["holman", "wms"]);
});

test("read-back: a system the create never targeted is not verified", () => {
  const r = resolveCreateVerification({
    probes: { holman: found(), wms: notTargeted(), tpms: notTargeted() },
    ...open,
  });
  assert.equal(r.state, "confirmed");
  assert.deepEqual(r.present, ["holman"]);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.indeterminate, []);
});

test("read-back: absent inside the window stays pending and retries — Holman applies asynchronously", () => {
  const r = resolveCreateVerification({ probes: { holman: absent() }, ...open });
  assert.equal(r.state, "pending");
  assert.equal(r.retry, true);
  assert.equal(r.releaseNumber, false);
  assert.match(r.detail, /asynchronously/);
});

test("read-back: the last attempt does not retry even with time left on the clock", () => {
  const r = resolveCreateVerification({
    probes: { holman: absent() },
    attemptNumber: VERIFICATION_MAX_ATTEMPTS,
    elapsedMs: 1000,
  });
  assert.equal(r.retry, false);
  assert.equal(r.state, "failed");
});

test("read-back: an expired window does not retry even on an early attempt", () => {
  const r = resolveCreateVerification({
    probes: { holman: absent() },
    attemptNumber: 1,
    elapsedMs: VERIFICATION_WINDOW_MS + 1,
  });
  assert.equal(r.retry, false);
  assert.equal(r.state, "failed");
});

test("read-back: positively absent everywhere fails the create and releases the number", () => {
  const r = resolveCreateVerification({ probes: { holman: absent(), wms: absent() }, ...closed });
  assert.equal(r.state, "failed");
  assert.equal(r.releaseNumber, true);
  assert.deepEqual(r.missing, ["holman", "wms"]);
  assert.match(r.detail, /released/i);
});

test("read-back: an unreachable system never yields a failure and never frees the number", () => {
  const r = resolveCreateVerification({ probes: { holman: unreachable("Holman 503") }, ...closed });
  assert.equal(r.state, "unverified");
  assert.equal(r.releaseNumber, false);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.indeterminate, ["holman"]);
  assert.match(r.detail, /never proven/);
});

test("read-back: absent in one system but unreachable in another must not free the number", () => {
  const r = resolveCreateVerification({ probes: { holman: unreachable(), wms: absent() }, ...closed });
  assert.equal(r.releaseNumber, false);
  assert.notEqual(r.state, "failed");
  assert.equal(r.state, "partial");
});

test("read-back: present in one system and absent in another is partial, not failed", () => {
  const r = resolveCreateVerification({ probes: { holman: found(), wms: absent() }, ...closed });
  assert.equal(r.state, "partial");
  assert.equal(r.releaseNumber, false);
  assert.deepEqual(r.present, ["holman"]);
  assert.deepEqual(r.missing, ["wms"]);
  assert.match(r.detail, /human decision/);
});

test("read-back: an inconclusive TPMS answer alone cannot fail a Holman-confirmed create", () => {
  // TPMS answers HTTP 400 "No Data Found" for an existing truck with no tech
  // assigned, so its probe reports checked:false rather than "absent".
  const r = resolveCreateVerification({
    probes: { holman: found(), wms: found(), tpms: unreachable("No Data Found") },
    ...closed,
  });
  assert.equal(r.state, "unverified");
  assert.equal(r.releaseNumber, false);
  assert.deepEqual(r.missing, []);
});

test("read-back: nothing targeted resolves to unverified rather than a false confirmation", () => {
  const r = resolveCreateVerification({ probes: {}, ...open });
  assert.equal(r.state, "unverified");
  assert.equal(r.retry, false);
  assert.equal(r.releaseNumber, false);
});

test("read-back: only a proven-absent-everywhere verdict ever releases a number", () => {
  const probeSets: Array<Partial<Record<"holman" | "wms" | "tpms", ReadBackProbe>>> = [
    { holman: found() },
    { holman: found(), wms: absent() },
    { holman: unreachable() },
    { holman: unreachable(), wms: unreachable() },
    { holman: absent(), wms: unreachable() },
    { holman: absent(), wms: found() },
    {},
  ];
  for (const probes of probeSets) {
    const r = resolveCreateVerification({ probes, ...closed });
    assert.equal(r.releaseNumber, false, `must not release for ${JSON.stringify(probes)}`);
  }
  const releases = resolveCreateVerification({ probes: { holman: absent() }, ...closed });
  assert.equal(releases.releaseNumber, true);
});

// ── AMS is out of the picture ────────────────────────────────────────────────

test("AMS is never a verified system — its records arrive ~24h later by downstream sync", () => {
  assert.deepEqual(VERIFIED_SYSTEMS.slice(), ["holman", "wms", "tpms"]);
  assert.equal(VERIFIED_SYSTEMS.indexOf("ams" as any), -1);
  assert.deepEqual(NON_VERIFIED_SYSTEMS.slice(), ["ams"]);
  assert.equal(isVerifiedSystem("ams"), false);
  assert.equal(isVerifiedSystem("AMS"), false);
  assert.equal(isVerifiedSystem("holman"), true);
});

test("an AMS probe smuggled into the probe map is ignored, not treated as a gap", () => {
  const r = resolveCreateVerification({
    probes: { holman: found(), wms: found(), ams: absent() } as any,
    ...closed,
  });
  assert.equal(r.state, "confirmed");
  assert.deepEqual(r.missing, []);
  assert.equal(r.present.indexOf("ams" as any), -1);
});

test("the verification service never calls AMS", () => {
  const src = readFileSync(new URL("../server/vehicle-create-verification-service.ts", import.meta.url), "utf8");
  const code = src
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
    .join("\n");
  assert.equal(/amsService|ams_vehicles_cache|amsApi/i.test(code), false);
});

// ── Phantom detection ────────────────────────────────────────────────────────

const NOW = Date.parse("2026-08-17T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3600000);

const optimisticRow = (overrides: Partial<Parameters<typeof classifyPhantomCandidate>[0]["row"]> = {}) => ({
  vehicleNumber: "24101",
  dataSource: "manual",
  lastHolmanSyncAt: null,
  createdAt: hoursAgo(72),
  updatedAt: hoursAgo(72),
  ...overrides,
});

const attempt = (overrides: Partial<NonNullable<Parameters<typeof classifyPhantomCandidate>[0]["createAttempt"]>> = {}) => ({
  id: 501,
  submittedAt: hoursAgo(72),
  holmanSuccess: true,
  holmanPending: false,
  verificationState: "failed",
  ...overrides,
});

test("phantom: cached, absent from live Holman, never synced, past the grace window", () => {
  const c = classifyPhantomCandidate({
    row: optimisticRow(),
    live: { checked: true, found: false },
    createAttempt: attempt(),
    nowMs: NOW,
  });
  assert.equal(c.verdict, "phantom");
  assert.equal(c.safeToPurge, true);
});

test("phantom: a row live Holman returns is real, whatever its provenance", () => {
  const c = classifyPhantomCandidate({
    row: optimisticRow(),
    live: { checked: true, found: true },
    createAttempt: attempt(),
    nowMs: NOW,
  });
  assert.equal(c.verdict, "live-confirmed");
  assert.equal(c.safeToPurge, false);
});

test("phantom: a failed live check is never a phantom — we do not guess into a DELETE", () => {
  const c = classifyPhantomCandidate({
    row: optimisticRow(),
    live: { checked: false, found: false, error: "Holman auth failed" },
    createAttempt: attempt(),
    nowMs: NOW,
  });
  assert.equal(c.verdict, "unverifiable");
  assert.equal(c.safeToPurge, false);
  assert.match(c.reason, /Holman auth failed/);
});

test("phantom: a row a real Holman sync has seen before is a lifecycle change, not a phantom", () => {
  const c = classifyPhantomCandidate({
    row: optimisticRow({ dataSource: "holman", lastHolmanSyncAt: hoursAgo(200) }),
    live: { checked: true, found: false },
    createAttempt: attempt(),
    nowMs: NOW,
  });
  assert.equal(c.verdict, "sync-confirmed");
  assert.equal(c.safeToPurge, false);
});

test("phantom: THE LAGGING-CACHE CASE — a fresh create inside the grace window is not a phantom", () => {
  const c = classifyPhantomCandidate({
    row: optimisticRow({ createdAt: hoursAgo(2), updatedAt: hoursAgo(2) }),
    live: { checked: true, found: false },
    createAttempt: attempt({ submittedAt: hoursAgo(2) }),
    nowMs: NOW,
  });
  assert.equal(c.verdict, "too-new");
  assert.equal(c.safeToPurge, false);
  assert.match(c.reason, /grace window/);
});

test("phantom: the grace window is measured from the newest evidence, not the oldest", () => {
  // The create is old, but the cache row was touched an hour ago — still too new.
  const c = classifyPhantomCandidate({
    row: optimisticRow({ createdAt: hoursAgo(100), updatedAt: hoursAgo(1) }),
    live: { checked: true, found: false },
    createAttempt: attempt({ submittedAt: hoursAgo(100) }),
    nowMs: NOW,
  });
  assert.equal(c.verdict, "too-new");
});

test("phantom: the grace window covers Holman's async apply plus a nightly sync", () => {
  assert.ok(PHANTOM_GRACE_MS >= 24 * 3600000);
  const justInside = classifyPhantomCandidate({
    row: optimisticRow({ createdAt: hoursAgo(23), updatedAt: hoursAgo(23) }),
    live: { checked: true, found: false },
    createAttempt: attempt({ submittedAt: hoursAgo(23) }),
    nowMs: NOW,
  });
  assert.equal(justInside.verdict, "too-new");
  const justOutside = classifyPhantomCandidate({
    row: optimisticRow({ createdAt: hoursAgo(25), updatedAt: hoursAgo(25) }),
    live: { checked: true, found: false },
    createAttempt: attempt({ submittedAt: hoursAgo(25) }),
    nowMs: NOW,
  });
  assert.equal(justOutside.verdict, "phantom");
});

test("phantom: a cache row with no create behind it is left alone", () => {
  const c = classifyPhantomCandidate({
    row: optimisticRow(),
    live: { checked: true, found: false },
    createAttempt: null,
    nowMs: NOW,
  });
  assert.equal(c.verdict, "not-create-linked");
  assert.equal(c.safeToPurge, false);
});

test("phantom: an alphanumeric Holman number is judged on provenance, not on its shape", () => {
  // Real Holman vehicle numbers can be alphanumeric (24024B, T0003) — number shape
  // must never be the discriminator.
  const real = classifyPhantomCandidate({
    row: optimisticRow({ vehicleNumber: "24024B" }),
    live: { checked: true, found: true },
    createAttempt: attempt(),
    nowMs: NOW,
  });
  assert.equal(real.verdict, "live-confirmed");

  const ghost = classifyPhantomCandidate({
    row: optimisticRow({ vehicleNumber: "24024B" }),
    live: { checked: true, found: false },
    createAttempt: attempt(),
    nowMs: NOW,
  });
  assert.equal(ghost.verdict, "phantom");
});

test("phantom: only the 'phantom' verdict is ever safe to purge", () => {
  const cases: Array<Parameters<typeof classifyPhantomCandidate>[0]> = [
    { row: optimisticRow(), live: { checked: true, found: true }, createAttempt: attempt(), nowMs: NOW },
    { row: optimisticRow(), live: { checked: false, found: false }, createAttempt: attempt(), nowMs: NOW },
    { row: optimisticRow({ lastHolmanSyncAt: hoursAgo(10) }), live: { checked: true, found: false }, createAttempt: attempt(), nowMs: NOW },
    { row: optimisticRow(), live: { checked: true, found: false }, createAttempt: null, nowMs: NOW },
    { row: optimisticRow({ createdAt: hoursAgo(1), updatedAt: hoursAgo(1) }), live: { checked: true, found: false }, createAttempt: attempt({ submittedAt: hoursAgo(1) }), nowMs: NOW },
  ];
  for (const args of cases) {
    const c = classifyPhantomCandidate(args);
    assert.notEqual(c.verdict, "phantom");
    assert.equal(c.safeToPurge, false);
  }
});

// ── Admin rollup ─────────────────────────────────────────────────────────────

test("rollup: states are tallied and an unknown/missing state counts as pending", () => {
  const counts = tallyVerificationStates([
    "confirmed",
    "confirmed",
    "failed",
    "partial",
    "unverified",
    "pending",
    null,
    undefined,
    "something-else",
  ]);
  assert.deepEqual(counts, { confirmed: 2, pending: 4, failed: 1, partial: 1, unverified: 1 });
});

test("rollup: everything except a confirmed create needs administrator attention", () => {
  assert.equal(needsAttention("confirmed"), false);
  assert.equal(needsAttention("pending"), true);
  assert.equal(needsAttention("failed"), true);
  assert.equal(needsAttention("partial"), true);
  assert.equal(needsAttention("unverified"), true);
  assert.equal(needsAttention(null), true);
});

// ── Reservation reclaim after a late confirmation ────────────────────────────
//
// The dangerous sequence the read-back can produce on its own:
//   1. the window closes with the vehicle absent → 'failed', number released
//      (blocked_source='failed', which drops the row out of BOTH partial unique
//      indexes — they are `WHERE blocked_source IS NULL`);
//   2. Holman's queue applies the submission afterwards;
//   3. an administrator presses Verify on the failed row → 'confirmed'.
// If step 3 does not take the release back, a real vehicle's number AND VIN are
// free for the allocator to hand to a different create.

test("reclaim: a create confirmed after being released takes its reservation back", () => {
  const d = decideReservationReclaim({ state: "confirmed", blockedSource: "failed" });
  assert.equal(d.reclaim, true);
});

test("reclaim: a confirmed create that was never released has nothing to reclaim", () => {
  assert.equal(decideReservationReclaim({ state: "confirmed", blockedSource: null }).reclaim, false);
  assert.equal(decideReservationReclaim({ state: "confirmed", blockedSource: undefined }).reclaim, false);
});

test("reclaim: only this flow's own release ('failed') is reclaimable", () => {
  // These blocks were written by paths that never submitted the vehicle — a
  // pre-submission refusal, a duplicate gate, a manual block. Undoing them would
  // re-activate a reservation the gate deliberately refused.
  for (const blocked of ["unverified", "duplicate", "vin_duplicate", "manual", "cancelled"]) {
    assert.equal(
      decideReservationReclaim({ state: "confirmed", blockedSource: blocked }).reclaim,
      false,
      `must not reclaim a '${blocked}' block`,
    );
  }
});

test("reclaim: a non-confirmed outcome never reclaims a reservation", () => {
  for (const state of ["pending", "failed", "partial", "unverified"] as const) {
    assert.equal(decideReservationReclaim({ state, blockedSource: "failed" }).reclaim, false);
  }
});

test("reclaim: 'confirmed but still released' is the state an administrator must see", () => {
  // Reached only when the reclaim could not be performed (another active
  // reservation already holds the number or VIN). It must never be treated as a
  // clean confirmation, because the number is still allocatable.
  assert.equal(isConfirmedButReleased("confirmed", "failed"), true);
  assert.equal(isConfirmedButReleased("confirmed", null), false);
  assert.equal(isConfirmedButReleased("failed", "failed"), false);
  assert.equal(isConfirmedButReleased("partial", "failed"), false);
  assert.equal(isConfirmedButReleased(null, "failed"), false);
});

test("reclaim: the service reclaims under a CAS predicate, not a blind update", () => {
  // Guards the write itself: the reclaim must be conditional on the row still
  // being 'failed', so a concurrent decision is not silently overwritten, and a
  // unique-violation (another reservation took the number) must be caught and
  // surfaced rather than thrown away.
  const src = readFileSync(new URL("../server/vehicle-create-verification-service.ts", import.meta.url), "utf8");
  assert.match(src, /blockedSource:\s*null/, "reclaim must clear blocked_source");
  assert.match(
    src,
    /eq\(byovCreationAudit\.blockedSource,\s*"failed"\)/,
    "reclaim must be guarded by a compare-and-set on the released state",
  );
  assert.match(src, /isUniqueViolation/, "a competing active reservation must be handled, not thrown");
  assert.match(src, /NUMBER STILL RELEASED/, "an unreclaimable confirmation must be flagged for a human");
});

// ── Releasing the reservation when the create finishes ───────────────────────
//
// The route used to decide this from the immediate result flags. It cannot: a
// 5xx, a socket timeout or a proxy kill AFTER the request went on the wire is
// indistinguishable from a clean refusal, and Holman applies submissions
// asynchronously anyway. Releasing on that evidence hands a possibly-real
// vehicle's number and VIN straight back to the allocator.

test("finalize: a create that errored AFTER reaching WMS keeps its number", () => {
  const d = decideFinalizeRelease({
    wmsSubmittedAt: new Date(),
    wmsSuccess: false,
    holmanSuccess: false,
    holmanPending: false,
  });
  assert.equal(d.release, false, "a submitted-then-errored create must never release its number");
  assert.equal(d.verify, true, "it must be resolved by read-back instead");
});

test("finalize: a create that errored AFTER reaching Holman keeps its number", () => {
  const d = decideFinalizeRelease({
    holmanSubmittedAt: new Date(),
    holmanSuccess: false,
    holmanPending: false,
    wmsSuccess: false,
  });
  assert.equal(d.release, false);
  assert.equal(d.verify, true);
});

test("finalize: a create that never reached any creating system releases its number", () => {
  // Nothing was submitted, so nothing can land later — holding the number here
  // would burn it for no reason.
  const d = decideFinalizeRelease({
    holmanSubmittedAt: null,
    wmsSubmittedAt: null,
    holmanSuccess: false,
    wmsSuccess: false,
    holmanPending: false,
  });
  assert.equal(d.release, true);
  assert.equal(d.verify, false);
});

test("finalize: success or a pending Holman submit always holds the number", () => {
  for (const args of [
    { holmanSuccess: true },
    { wmsSuccess: true },
    { holmanPending: true },
    { holmanSubmittedAt: new Date(), holmanPending: true },
  ]) {
    const d = decideFinalizeRelease(args);
    assert.equal(d.release, false, `must hold for ${JSON.stringify(args)}`);
    assert.equal(d.verify, true);
  }
});

test("finalize: release and verify are exclusive — a released attempt is never left unverified", () => {
  const cases = [
    {},
    { holmanSubmittedAt: new Date() },
    { wmsSubmittedAt: new Date() },
    { holmanSuccess: true },
    { wmsSuccess: true },
    { holmanPending: true },
    { holmanSubmittedAt: new Date(), wmsSubmittedAt: new Date(), holmanSuccess: false, wmsSuccess: false },
  ];
  for (const args of cases) {
    const d = decideFinalizeRelease(args);
    assert.equal(d.release, !d.verify, `release/verify must be exclusive for ${JSON.stringify(args)}`);
  }
});

test("finalize: the create route decides the release from this function, not from success flags", () => {
  const src = readFileSync(new URL("../server/routes.ts", import.meta.url), "utf8");
  const createRoute = src.slice(src.indexOf('app.post("/api/byov/create"'));
  const finalize = createRoute.slice(0, createRoute.indexOf("Per-system reporting"));
  assert.match(finalize, /decideFinalizeRelease\(/, "finalize must use the shared decision");
  assert.doesNotMatch(
    finalize,
    /fullyFailed\s*=\s*!finalHolmanSuccess/,
    "the old success-flag release must be gone",
  );
  // The outer catch must not release a number once a request has gone on the wire.
  assert.match(createRoute, /submittedToCreatingSystem/, "the error path must know a submit happened");
});

// ── Purging a phantom must not free a real vehicle's number ──────────────────
//
// Two different decisions live in the purge, and only the first one is settled by
// the phantom classification:
//   (a) may this LOCAL CACHE ROW be deleted?  — Holman-only question;
//   (b) may the reserved NUMBER AND VIN be freed? — cross-system question.
// A create that landed in WMS and never landed in Holman answers YES to (a) and
// NO to (b): the local row is junk, but a real half-created vehicle is using that
// number. Deciding (b) from the Holman-only verdict would re-allocate it.

test("purge: a create present in WMS but absent from Holman is partial — the number stays held", () => {
  const r = resolveCreateVerification({
    probes: {
      holman: { system: "holman", attempted: true, checked: true, found: false },
      wms: { system: "wms", attempted: true, checked: true, found: true },
    },
    attemptNumber: VERIFICATION_MAX_ATTEMPTS + 1,
    elapsedMs: VERIFICATION_WINDOW_MS * 10, // long past the window: no more retries
  });
  assert.equal(r.state, "partial");
  assert.equal(r.releaseNumber, false, "a vehicle that exists in WMS must keep its number and VIN");
  assert.equal(r.retry, false);
});

test("purge: only absence in EVERY targeted system frees the number", () => {
  const r = resolveCreateVerification({
    probes: {
      holman: { system: "holman", attempted: true, checked: true, found: false },
      wms: { system: "wms", attempted: true, checked: true, found: false },
    },
    attemptNumber: VERIFICATION_MAX_ATTEMPTS + 1,
    elapsedMs: VERIFICATION_WINDOW_MS * 10,
  });
  assert.equal(r.state, "failed");
  assert.equal(r.releaseNumber, true);
});

test("purge: Holman absent but WMS inconclusive never frees the number", () => {
  const r = resolveCreateVerification({
    probes: {
      holman: { system: "holman", attempted: true, checked: true, found: false },
      wms: { system: "wms", attempted: true, checked: false, found: false, detail: "WMS unreachable" },
    },
    attemptNumber: VERIFICATION_MAX_ATTEMPTS + 1,
    elapsedMs: VERIFICATION_WINDOW_MS * 10,
  });
  // Absence was proven in Holman but never in WMS, so it needs a human — and the
  // number is not freed. The detail must not claim presence nobody observed.
  assert.equal(r.state, "partial");
  assert.equal(r.releaseNumber, false);
  assert.doesNotMatch(r.detail, /present in/i);
  assert.match(r.detail, /no answer from/i);
});

test("purge: the reservation decision is delegated to a cross-system read-back", () => {
  const src = readFileSync(new URL("../server/vehicle-create-verification-service.ts", import.meta.url), "utf8");
  const purge = src.slice(src.indexOf("export async function purgePhantomVehicles"));
  assert.match(
    purge,
    /verifyCreateAttemptOnce\(attempt\.id\)/,
    "the purge must re-verify across every targeted system before any release",
  );
  assert.doesNotMatch(
    purge,
    /blockedSource:\s*"failed"/,
    "the purge must never write the release itself off a Holman-only verdict",
  );
});
