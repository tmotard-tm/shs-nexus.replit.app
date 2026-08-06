/**
 * VRM fleet-status ownership tests.
 *
 * Covers (per completion review):
 *  1. The ownership guard used by Fleet Scope's create/update truck routes —
 *     proves user-facing payloads cannot originate or change VRM-owned rental
 *     fields (pure functions wired into POST /trucks, bulk-import, PUT/PATCH).
 *  2. VRM status validation (vocabulary enforcement).
 *  3. appendFleetStatus append+mirror, unknown-case rejection, and the
 *     compensating rollback when the fs_trucks mirror write fails.
 *  4. reconcileFleetStatuses: seed idempotency and the no-echo guarantee
 *     (VRM's own mirror writes are never re-adopted as FS changes).
 *
 * DB-backed tests run against the development database using an existing open
 * rental case with its CURRENT status values, so no effective state changes;
 * every history row written by this suite is deleted in after().
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  VRM_OWNED_FIELDS,
  FS_CREATE_INITIAL_STATUS,
  sanitizeCreatePayload,
  findChangedOwnedFields,
  stripOwnedFields,
  normalizeOwnedValue,
} from "../server/fleet-scope-vrm-guard";

describe("Fleet Scope ownership guard (pure — wired into create/update routes)", () => {
  test("sanitizeCreatePayload discards owned fields and forces the initial status", () => {
    const { sanitized, discarded } = sanitizeCreatePayload({
      truckNumber: "999999",
      shsOwner: "Tester",
      mainStatus: "On Road",
      subStatus: "Delivered to technician",
      repairPhone: "555-111-2222",
      lastCallStatus: "Ready",
      eta: "2026-08-15",
    });
    assert.equal(sanitized.mainStatus, FS_CREATE_INITIAL_STATUS.mainStatus);
    assert.equal(sanitized.subStatus, null);
    for (const f of VRM_OWNED_FIELDS) {
      if (f === "mainStatus" || f === "subStatus") continue;
      assert.ok(!(f in sanitized), `${f} must be removed from create payloads`);
    }
    assert.equal(sanitized.truckNumber, "999999");
    assert.equal(sanitized.shsOwner, "Tester");
    assert.deepEqual(
      [...discarded].sort(),
      ["eta", "lastCallStatus", "mainStatus", "repairPhone", "subStatus"].sort(),
    );
  });

  test("sanitizeCreatePayload does not flag default/empty values as discarded", () => {
    const { sanitized, discarded } = sanitizeCreatePayload({
      truckNumber: "999999",
      mainStatus: FS_CREATE_INITIAL_STATUS.mainStatus, // form default — not an override attempt
      subStatus: "",
      repairPhone: null,
    });
    assert.deepEqual(discarded, []);
    assert.equal(sanitized.mainStatus, FS_CREATE_INITIAL_STATUS.mainStatus);
    assert.equal(sanitized.subStatus, null);
  });

  test("findChangedOwnedFields flags real changes only", () => {
    const existing = {
      mainStatus: "On Road",
      subStatus: null,
      repairPhone: "555-123",
      lastCallDate: new Date("2026-01-02T03:04:05.000Z"),
      lastCallStatus: "Ready",
      shsOwner: "Old Owner",
    };
    // Equivalent re-sends: "" ~ null, ISO string ~ Date, identical strings.
    assert.deepEqual(
      findChangedOwnedFields(existing, {
        mainStatus: "On Road",
        subStatus: "",
        repairPhone: "555-123",
        lastCallDate: "2026-01-02T03:04:05.000Z",
        shsOwner: "New Owner", // not VRM-owned — never flagged here
      }),
      [],
    );
    // Real changes are flagged; absent fields are ignored.
    assert.deepEqual(
      findChangedOwnedFields(existing, { mainStatus: "In Repair Shop", eta: "tomorrow" }),
      ["mainStatus", "eta"],
    );
  });

  test("stripOwnedFields removes every owned key", () => {
    const payload: Record<string, unknown> = { truckNumber: "1", comments: "keep" };
    for (const f of VRM_OWNED_FIELDS) payload[f] = "x";
    stripOwnedFields(payload);
    for (const f of VRM_OWNED_FIELDS) assert.ok(!(f in payload), `${f} must be stripped`);
    assert.equal(payload.comments, "keep");
  });

  test("normalizeOwnedValue equivalence rules", () => {
    assert.equal(normalizeOwnedValue(undefined), "");
    assert.equal(normalizeOwnedValue(null), "");
    assert.equal(normalizeOwnedValue("  x  "), "x");
    assert.equal(
      normalizeOwnedValue(new Date("2026-01-02T03:04:05.000Z")),
      "2026-01-02T03:04:05.000Z",
    );
  });
});

describe("VRM fleet-status authority (DB-backed)", { skip: !process.env.DATABASE_URL }, () => {
  const ACTOR = "vrm-guard-test";
  let fs: typeof import("../server/vrm/rental-operations/fleet-status");
  let storageMod: typeof import("../server/fleet-scope-storage");
  let dbMod: typeof import("../server/db");
  let sqlTag: typeof import("drizzle-orm").sql;
  let caseKey = "";
  let main = "";
  let sub: string | null = null;

  const rowsOf = (res: any): any[] => (res?.rows ?? res ?? []) as any[];

  const countHistoryRows = async (): Promise<number> => {
    const res = await dbMod.db.execute(sqlTag`
      SELECT COUNT(*)::int AS n FROM vrm_rental_operation_actions
      WHERE action_type = 'fleet_status' AND case_key = ${caseKey}
    `);
    return Number(rowsOf(res)[0]?.n ?? 0);
  };

  const countAdoptedRows = async (): Promise<number> => {
    const res = await dbMod.db.execute(sqlTag`
      SELECT COUNT(*)::int AS n FROM vrm_rental_operation_actions
      WHERE action_type = 'fleet_status' AND case_key = ${caseKey}
        AND payload->>'origin' = 'adopted'
    `);
    return Number(rowsOf(res)[0]?.n ?? 0);
  };

  before(async () => {
    fs = await import("../server/vrm/rental-operations/fleet-status");
    storageMod = await import("../server/fleet-scope-storage");
    dbMod = await import("../server/db");
    sqlTag = (await import("drizzle-orm")).sql;

    // Pick an existing open case whose current fs_trucks status validates —
    // the suite appends the SAME values, so effective state never changes.
    const res = await dbMod.db.execute(sqlTag`
      SELECT c.case_key, ft.main_status, ft.sub_status
      FROM vrm_rental_operations_cases c
      JOIN LATERAL (
        SELECT t.main_status, t.sub_status
        FROM fs_trucks t
        WHERE COALESCE(NULLIF(LTRIM(t.truck_number, '0'), ''), '0') = COALESCE(NULLIF(LTRIM(c.vehicle_number_padded, '0'), ''), '0')
          AND t.main_status IS NOT NULL
        ORDER BY t.last_updated_at DESC NULLS LAST
        LIMIT 1
      ) ft ON true
      WHERE c.present_in_latest = true
      LIMIT 25
    `);
    for (const r of rowsOf(res)) {
      if (fs.validateFleetStatus(r.main_status, r.sub_status) === null) {
        caseKey = String(r.case_key);
        main = String(r.main_status);
        sub = r.sub_status == null ? null : String(r.sub_status);
        break;
      }
    }
    assert.ok(caseKey, "no eligible open rental case found in the dev database");
  });

  after(async () => {
    if (caseKey) {
      await dbMod.db.execute(sqlTag`
        DELETE FROM vrm_rental_operation_actions
        WHERE action_type = 'fleet_status' AND case_key = ${caseKey} AND actor = ${ACTOR}
      `);
    }
    await dbMod.pool.end();
    // fleet-scope-storage (imported for the mirror assertions) opens its own
    // separate pg pool; without ending it the test runner never exits.
    const { fsPool } = await import("../server/fleet-scope-db");
    await fsPool.end().catch(() => {});
  });

  test("validateFleetStatus enforces the canonical vocabulary", () => {
    assert.equal(fs.validateFleetStatus(main, sub), null);
    assert.match(String(fs.validateFleetStatus("Definitely Not A Status", null)), /Invalid main status/);
    assert.match(String(fs.validateFleetStatus(main, "___not_a_real_sub___")), /Invalid sub status/);
  });

  test("appendFleetStatus rejects an unknown case", async () => {
    await assert.rejects(() => fs.appendFleetStatus("no-such-case-xyz", main, sub, ACTOR));
  });

  test("appendFleetStatus writes history and mirrors to fs_trucks as VRM:<actor>", async () => {
    const result = await fs.appendFleetStatus(caseKey, main, sub, ACTOR);
    assert.ok(result.mirroredTruckNumber, "expected the append to mirror to an fs_trucks row");

    const states = await fs.loadFleetStatusStates([caseKey]);
    const latest = states.get(caseKey);
    assert.ok(latest, "history row must exist for the case");
    assert.equal(latest!.actor, ACTOR);
    assert.equal(latest!.main_status, main);

    const truck = await dbMod.db.execute(sqlTag`
      SELECT last_updated_by FROM fs_trucks WHERE id = ${result.mirroredTruckId}
    `);
    assert.equal(String(rowsOf(truck)[0]?.last_updated_by), `VRM:${ACTOR}`);
  });

  test("reconcile does not echo VRM's own mirror back as an adopted change", async () => {
    const adoptedBefore = await countAdoptedRows();
    await fs.reconcileFleetStatuses("test-no-echo");
    const adoptedAfter = await countAdoptedRows();
    assert.equal(adoptedAfter, adoptedBefore, "VRM:<actor> mirror writes must not be re-adopted");
  });

  test("appendFleetStatus rolls back the history row when the fs_trucks mirror fails", async () => {
    const before = await countHistoryRows();
    const storage: any = storageMod.fleetScopeStorage;
    storage.updateTruck = async () => {
      throw new Error("mirror-fail-simulated");
    };
    try {
      await assert.rejects(
        () => fs.appendFleetStatus(caseKey, main, sub, ACTOR),
        /mirror-fail-simulated/,
      );
    } finally {
      delete storage.updateTruck; // restore prototype method
    }
    const after = await countHistoryRows();
    assert.equal(after, before, "failed mirror must compensate-delete the appended history row");
  });

  // ── appendFleetStatusIfMainIn (compare-at-write guard) ────────────────────
  // The guard exists so AUTOMATED writers deciding from a snapshot (LUCA ready
  // routing, the heal backfill) cannot clobber a newer human decision or append
  // duplicates under concurrency. All cases below write the case's CURRENT
  // values, so effective state never changes (suite invariant).

  test("guarded append refuses an unknown case without throwing", async () => {
    const g = await fs.appendFleetStatusIfMainIn("no-such-case-xyz", ["Repairing"], main, sub, ACTOR);
    assert.equal(g.applied, false);
    assert.match(String(g.skippedReason), /unknown case/);
  });

  test("guarded append backs off when the effective status left the replaceable set", async () => {
    // Simulates the race the guard exists for: the caller classified from a
    // snapshot, but by write time the status is no longer replaceable.
    const before = await countHistoryRows();
    const g = await fs.appendFleetStatusIfMainIn(caseKey, ["__no_such_status__"], main, sub, ACTOR);
    assert.equal(g.applied, false);
    assert.match(String(g.skippedReason), /status changed before write/);
    assert.equal(g.current?.fsMain, main, "the observed at-write status must be reported");
    assert.equal(await countHistoryRows(), before, "a refused guard must write NOTHING");
  });

  test("guarded append applies while the status is still replaceable", async () => {
    const before = await countHistoryRows();
    const g = await fs.appendFleetStatusIfMainIn(caseKey, [main], main, sub, ACTOR);
    assert.equal(g.applied, true, String(g.skippedReason));
    assert.ok(g.result?.mirroredTruckNumber, "guarded apply must mirror like a plain append");
    assert.equal(await countHistoryRows(), before + 1);
    const latest = (await fs.loadFleetStatusStates([caseKey])).get(caseKey);
    assert.equal(latest?.actor, ACTOR);
  });

  test("guard predicate: absence rules are asymmetric by design", () => {
    const SET = ["Repairing", "Confirming Status"] as const;
    const ok = { vrmMain: "Repairing", fsMain: "Repairing", fsRowFound: true };
    assert.equal(fs.evaluateGuardedAppend(ok, SET).pass, true);

    // VRM history is append-only: null can only mean "never seeded", not a
    // cleared decision — it must NOT block (or unseeded cases stay red forever).
    assert.equal(fs.evaluateGuardedAppend({ ...ok, vrmMain: null }, SET).pass, true);

    // A recorded VRM decision outside the set refuses.
    const vrmMoved = fs.evaluateGuardedAppend({ ...ok, vrmMain: "Ready for Pickup" }, SET);
    assert.equal(vrmMoved.pass, false);
    assert.match((vrmMoved as { reason: string }).reason, /VRM=/);

    // The fs_trucks side classified the snapshot, so absence there = change:
    // a vanished row refuses…
    const rowGone = fs.evaluateGuardedAppend({ ...ok, fsMain: null, fsRowFound: false }, SET);
    assert.equal(rowGone.pass, false);
    assert.match((rowGone as { reason: string }).reason, /left fs_trucks/);

    // …a cleared (null) status refuses…
    const cleared = fs.evaluateGuardedAppend({ ...ok, fsMain: null }, SET);
    assert.equal(cleared.pass, false);
    assert.match((cleared as { reason: string }).reason, /FleetScope="—"/);

    // …and a moved status refuses.
    const fsMoved = fs.evaluateGuardedAppend({ ...ok, fsMain: "Scheduling" }, SET);
    assert.equal(fsMoved.pass, false);
    assert.match((fsMoved as { reason: string }).reason, /FleetScope="Scheduling"/);
  });

  test("concurrent guarded writers serialize per case — exactly one appends", async () => {
    // A applies (current main is in its set); B is queued behind A on the same
    // case and must re-read AFTER A committed — its set excludes A's value, so
    // it refuses instead of double-appending from the same stale read.
    const before = await countHistoryRows();
    const [a, b] = await Promise.all([
      fs.appendFleetStatusIfMainIn(caseKey, [main], main, sub, ACTOR),
      fs.appendFleetStatusIfMainIn(caseKey, ["__no_such_status__"], main, sub, ACTOR),
    ]);
    assert.equal(a.applied, true, String(a.skippedReason));
    assert.equal(b.applied, false, "the queued writer must observe the committed state, not the snapshot");
    assert.equal(await countHistoryRows(), before + 1, "exactly one append may land");
  });

  test("reconcile seed pass is idempotent", async () => {
    await fs.reconcileFleetStatuses("test-seed-1");
    const second = await fs.reconcileFleetStatuses("test-seed-2");
    assert.equal(second.seeded, 0, "back-to-back reconciles must not re-seed existing cases");
  });

  // Fresh-deploy boot race: initVrmSchema()'s boot reconcile can reach the DB
  // before the concurrent Fleet Scope schema init has created fs_trucks. The
  // readiness guard must fail fast, and a failed attempt must NOT consume the
  // lazy 5-minute throttle — the very next queue GET has to heal immediately.
  test("not-ready reconcile fails fast and does not burn the lazy throttle", async () => {
    const missing = { requiredTables: ["public.__fs_trucks_boot_race_simulation__"] };

    // Direct (boot-path) call: typed, descriptive not-ready failure.
    await assert.rejects(
      () => fs.reconcileFleetStatuses("test-not-ready-boot", missing),
      (e: any) => e instanceof fs.FleetStatusNotReadyError && /not ready/i.test(e.message),
    );

    // Lazy path: first call attempts and fails the same way...
    await assert.rejects(
      () => fs.maybeReconcileFleetStatuses("test-not-ready-lazy", missing) as Promise<unknown>,
      (e: any) => e instanceof fs.FleetStatusNotReadyError,
    );

    // ...and the IMMEDIATE next call must retry for real (non-null result),
    // proving the failure did not consume the throttle window.
    const healed = await fs.maybeReconcileFleetStatuses("test-retry-after-failure");
    assert.ok(healed, "expected an immediate real reconcile after a failed attempt");
    assert.equal(typeof healed!.seeded, "number");

    // A SUCCESSFUL run does consume the window: the next call is throttled.
    const throttled = await fs.maybeReconcileFleetStatuses("test-throttled-after-success");
    assert.equal(throttled, null, "successful reconcile must arm the throttle");
  });

  // Route-level lockdown proof against the REAL running app: neither the
  // create route nor legacy PATCH derivations (registration sticker →
  // subStatus, van flags → On Road/Delivered) may originate VRM-owned status.
  // Skips gracefully when the dev server is not running (this suite is a unit
  // workflow; the app workflow is expected to be up in the workspace).
  test("route-level: non-status FS edits cannot alter VRM-owned fields", async (t) => {
    const BASE = "http://127.0.0.1:5000";
    try {
      // Probe an API route, not "/": the first "/" hit after a dev-server
      // restart triggers a cold Vite transform that can exceed a short probe
      // timeout. Any HTTP response (401 included) proves the server is up.
      await fetch(`${BASE}/api/fs/trucks`, { signal: AbortSignal.timeout(15000) });
    } catch {
      t.skip("dev server not reachable on :5000 — route-level check skipped");
      return;
    }

    const SID = "vrm-guard-route-check";
    const TRUCK_NUMBER = "999912";
    const pre = await dbMod.db.execute(
      sqlTag`SELECT id FROM fs_trucks WHERE truck_number = ${TRUCK_NUMBER}`,
    );
    assert.equal(rowsOf(pre).length, 0, `test truck ${TRUCK_NUMBER} must not pre-exist`);

    await dbMod.db.execute(sqlTag`
      INSERT INTO sessions (id, user_id, username, expires_at)
      SELECT ${SID}, id, username, now() + interval '15 minutes'
      FROM users ORDER BY created_at ASC LIMIT 1
      ON CONFLICT (id) DO UPDATE SET expires_at = now() + interval '15 minutes'`);
    const H = { "Content-Type": "application/json", Cookie: `sessionId=${SID}` };

    let truckId: string | undefined;
    try {
      // Create WITH owned fields → route must sanitize to the initial status.
      const createRes = await fetch(`${BASE}/api/fs/trucks`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({
          truckNumber: TRUCK_NUMBER,
          datePutInRepair: "8/4/2026",
          mainStatus: "On Road",
          subStatus: "Delivered to technician",
          repairPhone: "555-000-2222",
          lastCallStatus: "Ready",
          lastUpdatedBy: "vrm-guard-route-check",
        }),
      });
      assert.equal(createRes.status, 201);
      const created: any = await createRes.json();
      truckId = created.id;
      assert.equal(created.subStatus, null);
      assert.equal(created.repairPhone, null, "owned repairPhone must be discarded on create");
      assert.notEqual(created.mainStatus, "On Road", "owned mainStatus must be discarded on create");

      // Non-status edit hitting BOTH legacy derivation triggers at once.
      const patchRes = await fetch(`${BASE}/api/fs/trucks/${truckId}`, {
        method: "PATCH",
        headers: H,
        body: JSON.stringify({
          registrationStickerValid: "Ordered duplicates",
          vanPickedUp: true,
          spareVanAssignmentInProcess: true,
          lastUpdatedBy: "vrm-guard-route-check",
        }),
      });
      assert.equal(patchRes.status, 200, "non-status edits must still succeed");

      const after = rowsOf(
        await dbMod.db.execute(sqlTag`
          SELECT main_status, sub_status, van_picked_up, registration_sticker_valid
          FROM fs_trucks WHERE id = ${truckId}`),
      )[0] as any;
      assert.equal(after.registration_sticker_valid, "Ordered duplicates");
      assert.equal(after.van_picked_up, true, "the flags themselves stay editable");
      assert.equal(after.main_status, created.mainStatus, "derivations must not change mainStatus");
      assert.equal(after.sub_status, null, "derivations must not set subStatus");

      // And nothing gets adopted into VRM history for it: the truck's status
      // never changed, and it has no open VRM case. Reconcile must stay clean.
      await fs.reconcileFleetStatuses("test-route-level");
      const adopted = rowsOf(
        await dbMod.db.execute(sqlTag`
          SELECT count(*)::int AS n FROM vrm_rental_operation_actions
          WHERE action_type = 'fleet_status'
            AND payload->>'truck_number' = ${TRUCK_NUMBER}`),
      )[0] as any;
      assert.equal(Number(adopted?.n ?? 0), 0, "no fleet-status history may originate from this edit");
    } finally {
      if (truckId) {
        await dbMod.db.execute(sqlTag`DELETE FROM fs_actions WHERE truck_id = ${truckId}`);
        await dbMod.db.execute(sqlTag`DELETE FROM fs_trucks WHERE id = ${truckId}`);
      }
      await dbMod.db.execute(sqlTag`DELETE FROM sessions WHERE id = ${SID}`);
    }
  });
});
