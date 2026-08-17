/**
 * Cutover intents — DB-backed suite (DEV database).
 *
 * Exercises the constraints that ARE the workflow's safety, against the real
 * Postgres schema (initFormsSchema is run first, so this suite is also the
 * first executable proof the boot DDL applies cleanly):
 *
 *  1. UNIQUE(workflow_type, source_id, source_revision, execution_mode) —
 *     one revision can never spawn two intents in one mode.
 *  2. Partial-unique live nonterminal lock per upper(ldap) — a second LIVE
 *     workflow cannot start while one is unresolved; terminal rows release
 *     it; dry_run rows never hold it.
 *  3. claimBookingWork CAS — a claimed intent cannot be claimed again inside
 *     its lease; fencing_token increments; workflowType filter honored.
 *  4. confirmIntent safety — stale preview_version / drifted facts can never
 *     land status='confirmed' (this fixture is deliberately ineligible, so
 *     the eligibility re-run at Confirm demotes to preview_required).
 *  5. vrm_workflow_attempts / vrm_workflow_send_guards uniqueness — the
 *     double-book and double-text guards.
 *  6. fs_comms_send_queue 'held' rows fail the drain claim predicate until
 *     flipped to 'pending' (cutover msg2: held until block VERIFIED).
 *
 * All fixtures use ZZCUT* ldaps + random-UUID source ids and are deleted in
 * before()/after(). NO external system is touched: no ETD, no ART, no Twilio.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { sql } from "drizzle-orm";

import { db, pool } from "../server/db";
import { initFormsSchema } from "../server/vrm/forms/schema";
import {
  WORKFLOW_CUTOVER,
  WORKFLOW_REQUEST,
  claimBookingWork,
  claimSendGuardDispatch,
  confirmIntent,
  fetchEligibilityFacts,
  fileContractBlock,
  invalidateRequestPreviews,
  isContractBlockLive,
  openBookingAttempt,
  persistPreviewFromRunner,
  requestBookingInFlight,
  recordBookingPostback,
  reconcileOpenBlockAttempt,
  reconcileOpenBlockAttempts,
  type BlockReadbackRow,
} from "../server/vrm/forms/cutover-orchestrator";

const LDAP_PREFIX = "ZZCUT";

async function cleanup() {
  await db.execute(sql`DELETE FROM vrm_rental_workflow_intents WHERE upper(ldap) LIKE ${LDAP_PREFIX + "%"}`);
  await db.execute(sql`DELETE FROM vrm_rental_request WHERE upper(ldap) LIKE ${LDAP_PREFIX + "%"}`);
  await db.execute(sql`DELETE FROM vrm_rental_cutover WHERE upper(ldap) LIKE ${LDAP_PREFIX + "%"}`);
}

async function insertIntent(over: Partial<Record<string, unknown>> = {}): Promise<number> {
  const v = {
    workflow_type: WORKFLOW_CUTOVER,
    source_id: crypto.randomUUID(),
    source_revision: 0,
    execution_mode: "dry_run",
    ldap: `${LDAP_PREFIX}A`,
    status: "created",
    preview_version: 0,
    ...over,
  } as Record<string, any>;
  const { rows } = await db.execute(sql`
    INSERT INTO vrm_rental_workflow_intents
      (workflow_type, source_id, source_revision, execution_mode, ldap, status,
       preview_version, preview_expires_at, preview)
    VALUES
      (${v.workflow_type}, ${v.source_id}, ${v.source_revision}, ${v.execution_mode},
       ${v.ldap}, ${v.status}, ${v.preview_version},
       ${v.preview_expires_at ?? null}, ${v.preview ?? null})
    RETURNING id
  `);
  return (rows as any[])[0].id as number;
}

const isUniqueViolation = (e: any) =>
  e?.code === "23505" || /duplicate key value/i.test(String(e?.message ?? e));

before(async () => {
  await initFormsSchema(); // IF NOT EXISTS everywhere — also proves boot DDL runs clean
  await cleanup();
});

after(async () => {
  await cleanup().catch(() => {});
  await pool.end().catch(() => {});
  const { fsPool } = await import("../server/fleet-scope-db");
  await fsPool.end().catch(() => {});
});

// ---------------------------------------------------------------------------

describe("intent identity + live lock constraints", () => {
  test("same (workflow, source, revision, mode) cannot exist twice", async () => {
    const sourceId = crypto.randomUUID();
    await insertIntent({ source_id: sourceId, ldap: `${LDAP_PREFIX}ID1` });
    await assert.rejects(
      () => insertIntent({ source_id: sourceId, ldap: `${LDAP_PREFIX}ID1X` }),
      isUniqueViolation,
      "identity duplicate must hit vrm_workflow_intents_identity_uq",
    );
    // ...but a different execution_mode of the SAME revision is a new identity.
    await insertIntent({ source_id: sourceId, execution_mode: "test", ldap: `${LDAP_PREFIX}ID1Y` });
  });

  test("ONE live nonterminal intent per LDAP, case-insensitive; terminal releases; dry_run exempt", async () => {
    const ldap = `${LDAP_PREFIX}LOCK`;
    const first = await insertIntent({ execution_mode: "live", ldap: ldap.toLowerCase(), status: "preview_ready" });

    await assert.rejects(
      () => insertIntent({ execution_mode: "live", ldap, status: "created" }),
      isUniqueViolation,
      "second live nonterminal intent for the same LDAP (different case) must be rejected",
    );
    // booking_unknown / manual_review are NONTERMINAL by design — still locked.
    await db.execute(sql`UPDATE vrm_rental_workflow_intents SET status = 'booking_unknown' WHERE id = ${first}`);
    await assert.rejects(
      () => insertIntent({ execution_mode: "live", ldap, status: "created" }),
      isUniqueViolation,
      "booking_unknown must HOLD the live lock (a human resolves it first)",
    );
    // dry_run rows never hold or trip the lock.
    await insertIntent({ execution_mode: "dry_run", ldap, status: "created" });
    await insertIntent({ execution_mode: "dry_run", ldap, status: "preview_pending" });
    // terminal releases it.
    await db.execute(sql`UPDATE vrm_rental_workflow_intents SET status = 'cancelled' WHERE id = ${first}`);
    await insertIntent({ execution_mode: "live", ldap, status: "created" });
  });
});

// ---------------------------------------------------------------------------

describe("claimBookingWork CAS", () => {
  test("claim sets lease + increments fencing token; second claim inside lease returns nothing", async () => {
    const id = await insertIntent({ ldap: `${LDAP_PREFIX}CLAIM`, status: "preview_pending" });

    const got = (await claimBookingWork({ runnerId: "test-runner-1", limit: 20 })).filter((i) => i.intentId === id);
    assert.equal(got.length, 1, "first claim must return the preview_pending intent");
    assert.equal(got[0].kind, "preview");
    assert.equal(got[0].fencingToken, 1);
    assert.equal(got[0].executionMode, "dry_run");

    const again = (await claimBookingWork({ runnerId: "test-runner-2", limit: 20 })).filter((i) => i.intentId === id);
    assert.equal(again.length, 0, "a leased intent must be invisible to other runners");

    const { rows } = await db.execute(sql`
      SELECT claimed_by, fencing_token, lease_expires_at FROM vrm_rental_workflow_intents WHERE id = ${id}
    `);
    const r = (rows as any[])[0];
    assert.equal(r.claimed_by, "test-runner-1");
    assert.equal(Number(r.fencing_token), 1);
    assert.ok(new Date(r.lease_expires_at) > new Date(), "lease must extend into the future");
  });

  test("workflowType filter: a rental_request claim never returns survey intents", async () => {
    const id = await insertIntent({ ldap: `${LDAP_PREFIX}TYPE`, status: "preview_pending" });
    const items = (await claimBookingWork({ runnerId: "test-runner-3", limit: 20, workflowType: WORKFLOW_REQUEST }))
      .filter((i) => i.intentId === id);
    assert.equal(items.length, 0);
    const { rows } = await db.execute(sql`SELECT claimed_by FROM vrm_rental_workflow_intents WHERE id = ${id}`);
    assert.equal((rows as any[])[0].claimed_by, null, "filtered-out intent must remain unclaimed");
  });

  test("expired lease is reclaimable and the fencing token moves past the stale holder's", async () => {
    const id = await insertIntent({ ldap: `${LDAP_PREFIX}LEASE`, status: "preview_pending" });
    await db.execute(sql`
      UPDATE vrm_rental_workflow_intents
      SET claimed_by = 'dead-runner', fencing_token = 7, lease_expires_at = now() - interval '1 minute'
      WHERE id = ${id}
    `);
    const got = (await claimBookingWork({ runnerId: "test-runner-4", limit: 20 })).filter((i) => i.intentId === id);
    assert.equal(got.length, 1, "expired lease must be reclaimable");
    assert.equal(got[0].fencingToken, 8, "reclaim must fence out the dead runner's token 7");
  });
});

// ---------------------------------------------------------------------------

describe("confirmIntent safety", () => {
  test("confirm can never land on drifted facts or a stale preview version", async () => {
    // Fixture is deliberately ineligible (its source row doesn't exist), so
    // the mandatory gate re-run at Confirm demotes it — CAS is never reached.
    const id = await insertIntent({
      ldap: `${LDAP_PREFIX}CONF`,
      status: "preview_ready",
      preview_version: 3,
      preview_expires_at: sql`now() + interval '15 minutes'` as any,
      preview: JSON.stringify({ reservation: { branchCode: "X" } }),
    });

    const res = await confirmIntent({ intentId: id, previewVersion: 3, confirmedBy: "db-test" });
    assert.equal(res.status, "preview_required", "ineligible facts must demote, not confirm");
    assert.ok((res.failures ?? []).length > 0, "failures must name the gates that broke");

    const { rows } = await db.execute(sql`SELECT status, confirmed_at FROM vrm_rental_workflow_intents WHERE id = ${id}`);
    const r = (rows as any[])[0];
    assert.equal(r.status, "preview_required");
    assert.equal(r.confirmed_at, null, "confirmed_at must never be stamped on a failed confirm");
  });

  test("confirm outside preview_ready is a hard 409", async () => {
    const id = await insertIntent({ ldap: `${LDAP_PREFIX}CONF2`, status: "booking" });
    await assert.rejects(
      () => confirmIntent({ intentId: id, previewVersion: 1, confirmedBy: "db-test" }),
      (e: any) => /bad_state|confirm in status/i.test(String(e?.message ?? e)),
    );
  });
});

// ---------------------------------------------------------------------------

describe("attempt + send-guard uniqueness", () => {
  test("two writers can never share (intent, phase, attempt_no)", async () => {
    const id = await insertIntent({ ldap: `${LDAP_PREFIX}ATT` });
    await db.execute(sql`
      INSERT INTO vrm_workflow_attempts (intent_id, phase, attempt_no, fencing_token)
      VALUES (${id}, 'etd_booking', 1, 1)
    `);
    await assert.rejects(
      () => db.execute(sql`
        INSERT INTO vrm_workflow_attempts (intent_id, phase, attempt_no, fencing_token)
        VALUES (${id}, 'etd_booking', 1, 2)
      `),
      isUniqueViolation,
    );
  });

  test("send guard is unique per (intent, workflow, moment, mode) — the double-text guard", async () => {
    const id = await insertIntent({ ldap: `${LDAP_PREFIX}GRD` });
    await db.execute(sql`
      INSERT INTO vrm_workflow_send_guards (intent_id, workflow_type, message_moment, execution_mode, status)
      VALUES (${id}, ${WORKFLOW_CUTOVER}, 'msg1', 'dry_run', 'created')
    `);
    await assert.rejects(
      () => db.execute(sql`
        INSERT INTO vrm_workflow_send_guards (intent_id, workflow_type, message_moment, execution_mode, status)
        VALUES (${id}, ${WORKFLOW_CUTOVER}, 'msg1', 'dry_run', 'created')
      `),
      isUniqueViolation,
    );
    // msg2 for the same intent is a different moment — allowed.
    await db.execute(sql`
      INSERT INTO vrm_workflow_send_guards (intent_id, workflow_type, message_moment, execution_mode, status)
      VALUES (${id}, ${WORKFLOW_CUTOVER}, 'msg2', 'dry_run', 'created')
    `);
  });

  test("deleting the intent cascades its attempts and guards", async () => {
    const id = await insertIntent({ ldap: `${LDAP_PREFIX}CASC` });
    await db.execute(sql`
      INSERT INTO vrm_workflow_send_guards (intent_id, workflow_type, message_moment, execution_mode)
      VALUES (${id}, ${WORKFLOW_CUTOVER}, 'msg1', 'dry_run')
    `);
    await db.execute(sql`DELETE FROM vrm_rental_workflow_intents WHERE id = ${id}`);
    const { rows } = await db.execute(sql`SELECT 1 FROM vrm_workflow_send_guards WHERE intent_id = ${id}`);
    assert.equal((rows as any[]).length, 0);
  });
});

// ---------------------------------------------------------------------------

describe("held queue rows are undrainable (fs_comms_send_queue)", () => {
  test("'held' fails the drain claim predicate; flipping to 'pending' makes it claimable", async () => {
    const { fsDb } = await import("../server/fleet-scope-db");
    const ins = await fsDb.execute(sql`
      INSERT INTO fs_comms_send_queue (phone, phone_digits, category, body, status, scheduled_for, manager_cc)
      VALUES ('+15555550100', '5555550100', 'rental_management', 'cutover db-test held row', 'held', now() - interval '1 hour', false)
      RETURNING id
    `);
    const rowId = (ins.rows as any[])[0].id;
    try {
      // The drain claims WHERE status='pending' AND due (processSendQueue's
      // CAS). A held row must never satisfy it, even when past-due.
      const claim = () => fsDb.execute(sql`
        UPDATE fs_comms_send_queue SET status = 'claimed'
        WHERE id = ${rowId} AND status = 'pending'
          AND (scheduled_for IS NULL OR scheduled_for <= now())
        RETURNING id
      `);
      assert.equal(((await claim()).rows as any[]).length, 0, "held row must be invisible to the drain");

      // Morning sweep releases by flipping held→pending — now it claims.
      await fsDb.execute(sql`UPDATE fs_comms_send_queue SET status = 'pending' WHERE id = ${rowId}`);
      assert.equal(((await claim()).rows as any[]).length, 1, "released row must claim exactly once");
    } finally {
      await fsDb.execute(sql`DELETE FROM fs_comms_send_queue WHERE id = ${rowId}`);
    }
  });
});

// ---------------------------------------------------------------------------

describe("request lane source keying", () => {
  test("fetchEligibilityFacts resolves a rental request by request_no AND by uuid id", async () => {
    const { rows } = await db.execute(sql`
      INSERT INTO vrm_rental_request (ldap, tech_name, mobile_phone, home_state)
      VALUES (${LDAP_PREFIX + "RQ1"}, 'ZZ Cut Req', '5555550100', 'PA')
      RETURNING id, request_no
    `);
    const row = (rows as any[])[0];

    // request_no is what the RentalRequests UI carries (by-source keys, create).
    const byNo = await fetchEligibilityFacts({
      workflowType: WORKFLOW_REQUEST,
      sourceId: String(row.request_no),
    });
    assert.ok(byNo.sourceRow, "request_no key (what the UI sends) must resolve the source row");
    assert.equal(String(byNo.sourceRow.id), String(row.id));

    // A uuid id keeps working (fixtures, direct-id callers).
    const byId = await fetchEligibilityFacts({
      workflowType: WORKFLOW_REQUEST,
      sourceId: String(row.id),
    });
    assert.ok(byId.sourceRow, "uuid key must keep working");
    assert.equal(String(byId.sourceRow.request_no), String(row.request_no));
  });

  test("request intents never file a route block: legacy pending state normalizes to not_applicable, zero ART attempts", async () => {
    const id = await insertIntent({ workflow_type: WORKFLOW_REQUEST, ldap: `${LDAP_PREFIX}RQBLK`, status: "reservation_verified" });
    // Legacy shape from before the split: request row carrying cutover's
    // default block_state. The filing lane must normalize, never file.
    await db.execute(sql`
      UPDATE vrm_rental_workflow_intents
      SET reservation_state = 'dry_run_validated', block_state = 'pending'
      WHERE id = ${id}
    `);
    await fileContractBlock(id);
    const row = (await db.execute(sql`
      SELECT block_state, block_evidence FROM vrm_rental_workflow_intents WHERE id = ${id}
    `)).rows[0] as any;
    assert.equal(row.block_state, "not_applicable", "route blocks are cutover-only");
    assert.equal(row.block_evidence?.notApplicable, true);
    const n = ((await db.execute(sql`
      SELECT count(*)::int AS n FROM vrm_workflow_attempts WHERE intent_id = ${id} AND phase = 'art_block'
    `)).rows[0] as any).n;
    assert.equal(n, 0, "no ART attempt is ever opened for a request intent");
  });

  test("request booking completes on verified readback; duplicate and post-cancel postbacks never revive a terminal intent", async () => {
    const ldap = `${LDAP_PREFIX}RQDONE`;
    const id = await insertIntent({ workflow_type: WORKFLOW_REQUEST, ldap, status: "confirmed" });
    const mine = (await claimBookingWork({ runnerId: "req-done-runner", limit: 50 })).find((i) => i.intentId === id);
    assert.ok(mine, "claim must return the confirmed request fixture");

    const verifiedPayload = {
      expected: { confirmation: "REQ-C1" },
      matches: [{ confirmation: "REQ-C1", reference: `SHS ${ldap} pickup` }],
    };
    const rb1 = await recordBookingPostback({
      intentId: id, runnerId: "req-done-runner", fencingToken: mine!.fencingToken,
      phase: "readback", payload: verifiedPayload,
    });
    assert.equal(rb1.accepted, true);
    assert.equal(rb1.status, "completed", "a verified request booking completes immediately — no block, no texts");
    let row = ((await db.execute(sql`
      SELECT status, reservation_state, block_state FROM vrm_rental_workflow_intents WHERE id = ${id}
    `)).rows as any[])[0];
    assert.equal(row.status, "completed");
    assert.equal(row.reservation_state, "verified");
    assert.equal(row.block_state, "not_applicable", "completion must not drag the request into block lanes");
    const attempts = (((await db.execute(sql`
      SELECT count(*)::int AS n FROM vrm_workflow_attempts WHERE intent_id = ${id} AND phase = 'art_block'
    `)).rows as any[])[0]).n;
    assert.equal(attempts, 0, "completed request has zero ART attempts");

    // Duplicate delivery of the same readback: idempotent ACK, zero mutation.
    const rb2 = await recordBookingPostback({
      intentId: id, runnerId: "req-done-runner", fencingToken: mine!.fencingToken,
      phase: "readback", payload: verifiedPayload,
    });
    assert.equal(rb2.accepted, true);
    assert.equal(rb2.idempotent, true, "terminal postbacks must ACK idempotently");
    assert.equal(rb2.status, "completed");
    row = ((await db.execute(sql`SELECT status FROM vrm_rental_workflow_intents WHERE id = ${id}`)).rows as any[])[0];
    assert.equal(row.status, "completed", "duplicate postback must never rewrite a terminal intent");

    // Late postback after a cancellation: the cancel is final.
    const id2 = await insertIntent({ workflow_type: WORKFLOW_REQUEST, ldap: `${LDAP_PREFIX}RQCXL`, status: "confirmed" });
    const mine2 = (await claimBookingWork({ runnerId: "req-cxl-runner", limit: 50 })).find((i) => i.intentId === id2);
    assert.ok(mine2, "claim must return the second request fixture");
    await db.execute(sql`UPDATE vrm_rental_workflow_intents SET status = 'cancelled' WHERE id = ${id2}`);
    const rb3 = await recordBookingPostback({
      intentId: id2, runnerId: "req-cxl-runner", fencingToken: mine2!.fencingToken,
      phase: "readback",
      payload: { expected: { confirmation: "REQ-C2" }, matches: [{ confirmation: "REQ-C2", reference: `SHS ${LDAP_PREFIX}RQCXL pickup` }] },
    });
    assert.equal(rb3.idempotent, true);
    assert.equal(rb3.status, "cancelled");
    const row2 = ((await db.execute(sql`
      SELECT status, reservation_state FROM vrm_rental_workflow_intents WHERE id = ${id2}
    `)).rows as any[])[0];
    assert.equal(row2.status, "cancelled", "a verified readback must never revive a cancelled intent");
    // reservation_state is born 'pending' (column default) — the point is the
    // losing postback must never have stamped it 'verified'.
    assert.notEqual(row2.reservation_state, "verified", "the loser CAS must not stamp verified state either");
  });
});

// ---------------------------------------------------------------------------

describe("op_open lease fencing", () => {
  test("an expired lease cannot authorize a new external operation; an active one can", async () => {
    const id = await insertIntent({ ldap: `${LDAP_PREFIX}LEASE2`, status: "confirmed" });
    const runner = "test-runner-lease";
    const claimed = await claimBookingWork({ runnerId: runner, limit: 20 });
    const mine = claimed.find((c) => c.intentId === id);
    assert.ok(mine, "claim must return the confirmed fixture");

    // Runner stalls past its lease (nobody reclaimed: token unchanged).
    await db.execute(sql`
      UPDATE vrm_rental_workflow_intents SET lease_expires_at = now() - interval '1 minute' WHERE id = ${id}
    `);
    await assert.rejects(
      () => recordBookingPostback({ intentId: id, runnerId: runner, fencingToken: mine!.fencingToken, phase: "op_open", payload: {} }),
      (e: any) => String(e?.code ?? "") === "lease_expired",
      "op_open after lease expiry must be rejected even when the token still matches",
    );

    // With the lease active again, the same call gets PAST the lease gate and
    // into the pre-booking eligibility re-run (fixture is deliberately
    // ineligible → demoted, not lease-rejected).
    await db.execute(sql`
      UPDATE vrm_rental_workflow_intents SET lease_expires_at = now() + interval '10 minutes' WHERE id = ${id}
    `);
    const opened = await recordBookingPostback({ intentId: id, runnerId: runner, fencingToken: mine!.fencingToken, phase: "op_open", payload: {} });
    assert.equal(opened.accepted, false);
    assert.equal(opened.status, "preview_required");
  });
});

// ---------------------------------------------------------------------------

describe("live kill switch (VRM_CONTRACT_BLOCK_ENABLED)", () => {
  const FLAG = "VRM_CONTRACT_BLOCK_ENABLED";

  test("disarmed: live intents are unclaimable and unconfirmable; arming resumes them", async () => {
    const prev = process.env[FLAG];
    delete process.env[FLAG];
    try {
      const liveId = await insertIntent({ execution_mode: "live", ldap: `${LDAP_PREFIX}ARM`, status: "confirmed" });
      const hidden = await claimBookingWork({ runnerId: "test-runner-arm", limit: 20 });
      assert.ok(!hidden.some((c) => c.intentId === liveId), "disarmed flag must hide live intents from the runner");

      const readyId = await insertIntent({
        execution_mode: "live",
        ldap: `${LDAP_PREFIX}ARM2`,
        status: "preview_ready",
        preview_version: 1,
        preview_expires_at: new Date(Date.now() + 3600_000),
      });
      await assert.rejects(
        () => confirmIntent({ intentId: readyId, previewVersion: 1, confirmedBy: "db-test" }),
        (e: any) => String(e?.code ?? "") === "live_disarmed",
        "confirm on a live intent must refuse while disarmed",
      );

      process.env[FLAG] = "true";
      const visible = await claimBookingWork({ runnerId: "test-runner-arm", limit: 20 });
      assert.ok(visible.some((c) => c.intentId === liveId), "arming must resume live claims");
      // Armed confirm proceeds INTO the eligibility re-run: this fixture is
      // deliberately ineligible, so it demotes instead of 409ing.
      const res = await confirmIntent({ intentId: readyId, previewVersion: 1, confirmedBy: "db-test" });
      assert.equal(res.status, "preview_required");
    } finally {
      if (prev === undefined) delete process.env[FLAG];
      else process.env[FLAG] = prev;
    }
  });
});

// ---------------------------------------------------------------------------

describe("send-guard dispatch ticket", () => {
  test("exactly one concurrent dispatcher wins; stuck 'dispatching' reclaims after 15 minutes", async () => {
    const id = await insertIntent({ ldap: `${LDAP_PREFIX}GUARD2`, status: "reservation_verified" });
    await db.execute(sql`
      INSERT INTO vrm_workflow_send_guards (intent_id, workflow_type, message_moment, execution_mode, status, body)
      VALUES (${id}, ${WORKFLOW_CUTOVER}, 'msg1_evening', 'dry_run', 'created', 'db-test body')
    `);

    const [a, b] = await Promise.all([
      claimSendGuardDispatch(id, "msg1_evening", "dry_run"),
      claimSendGuardDispatch(id, "msg1_evening", "dry_run"),
    ]);
    assert.equal([a, b].filter(Boolean).length, 1, "exactly one concurrent claimant may dispatch");

    assert.equal(
      await claimSendGuardDispatch(id, "msg1_evening", "dry_run"),
      false,
      "a fresh 'dispatching' guard is not reclaimable",
    );

    // Crash recovery: a dispatch that never wrote its outcome is reclaimable
    // once it is 15+ minutes old.
    await db.execute(sql`
      UPDATE vrm_workflow_send_guards SET updated_at = now() - interval '20 minutes'
      WHERE intent_id = ${id} AND message_moment = 'msg1_evening'
    `);
    assert.equal(await claimSendGuardDispatch(id, "msg1_evening", "dry_run"), true, "a crashed dispatch is reclaimable after 15 minutes");
  });
});

// ---------------------------------------------------------------------------

describe("booked-unverified recovery lane", () => {
  test("expired-lease awaiting_verification (booked_unverified) reclaims readback-first; parked/fresh rows do not", async () => {
    const dead = await insertIntent({ ldap: `${LDAP_PREFIX}RCV`, status: "awaiting_verification" });
    await db.execute(sql`
      UPDATE vrm_rental_workflow_intents
      SET reservation_state = 'booked_unverified', claimed_by = 'dead-runner',
          lease_expires_at = now() - interval '5 minutes', fencing_token = 3
      WHERE id = ${dead}
    `);
    const parked = await insertIntent({ ldap: `${LDAP_PREFIX}RCV2`, status: "awaiting_verification" });
    await db.execute(sql`
      UPDATE vrm_rental_workflow_intents SET reservation_state = 'dry_run_validated' WHERE id = ${parked}
    `);
    const fresh = await insertIntent({ ldap: `${LDAP_PREFIX}RCV3`, status: "awaiting_verification" });
    await db.execute(sql`
      UPDATE vrm_rental_workflow_intents
      SET reservation_state = 'booked_unverified', claimed_by = 'alive-runner',
          lease_expires_at = now() + interval '20 minutes'
      WHERE id = ${fresh}
    `);

    const items = await claimBookingWork({ runnerId: "test-runner-rcv", limit: 20 });
    const mine = items.find((i) => i.intentId === dead);
    assert.ok(mine, "booked-unverified with an expired lease must be reclaimable");
    assert.equal(mine!.kind, "book");
    assert.equal(mine!.requiresReconcile, true, "recovery claims must be readback-first");
    assert.equal(mine!.fencingToken, 4, "reclaim must move the fencing token past the dead holder");
    const { rows } = await db.execute(sql`SELECT status FROM vrm_rental_workflow_intents WHERE id = ${dead}`);
    assert.equal((rows as any[])[0].status, "awaiting_verification", "reclaim must NOT re-open booking");
    assert.ok(!items.some((i) => i.intentId === parked), "dark-parked validation rows are never claimable");
    assert.ok(!items.some((i) => i.intentId === fresh), "an active lease is never stolen");
  });

  test("reconcile-directed unknown claims readback-first even with all attempts closed; clean readback → confirmed", async () => {
    const id = await insertIntent({ ldap: `${LDAP_PREFIX}RCV4`, status: "booking" });
    await db.execute(sql`UPDATE vrm_rental_workflow_intents SET reservation_state = 'unknown' WHERE id = ${id}`);

    const items = await claimBookingWork({ runnerId: "test-runner-rcv", limit: 20 });
    const mine = items.find((i) => i.intentId === id);
    assert.ok(mine, "reconcile-directed booking must be claimable");
    assert.equal(mine!.requiresReconcile, true, "ambiguous outcomes must reconcile before any new booking");

    // Clean readback (zero journeys found) reconciles it back to bookable.
    const rb = await recordBookingPostback({
      intentId: id,
      runnerId: "test-runner-rcv",
      fencingToken: mine!.fencingToken,
      phase: "readback",
      payload: { matches: [] },
    });
    assert.equal(rb.status, "confirmed", "clean-none on a reconcile retry must return the intent to 'confirmed'");
  });
});

// ---------------------------------------------------------------------------

describe("atomic booking-attempt authorization (openBookingAttempt)", () => {
  test("active claim opens attempt 1 and renews the lease; unfinished attempt blocks a second", async () => {
    const id = await insertIntent({ ldap: `${LDAP_PREFIX}GATE`, status: "confirmed" });
    const mine = (await claimBookingWork({ runnerId: "gate-runner", limit: 20 })).find((i) => i.intentId === id);
    assert.ok(mine, "claim must return the confirmed fixture");

    // Shrink the lease so the renewal is observable.
    await db.execute(sql`
      UPDATE vrm_rental_workflow_intents SET lease_expires_at = now() + interval '2 minutes' WHERE id = ${id}
    `);
    const { attemptNo } = await openBookingAttempt(id, "gate-runner", mine!.fencingToken, {});
    assert.equal(attemptNo, 1);
    const { rows } = await db.execute(sql`SELECT lease_expires_at FROM vrm_rental_workflow_intents WHERE id = ${id}`);
    assert.ok(
      new Date((rows as any[])[0].lease_expires_at).getTime() > Date.now() + 10 * 60_000,
      "op_open must renew the lease for the external-call window",
    );
    await assert.rejects(
      () => openBookingAttempt(id, "gate-runner", mine!.fencingToken, {}),
      (e: any) => String(e?.code ?? "") === "unfinished_attempt",
      "an unfinished attempt must block a second open",
    );
  });

  test("a rival reclaim or an expired lease inserts NOTHING", async () => {
    const id = await insertIntent({ ldap: `${LDAP_PREFIX}GATE2`, status: "confirmed" });
    const mine = (await claimBookingWork({ runnerId: "gate-r1", limit: 20 })).find((i) => i.intentId === id);
    assert.ok(mine, "claim must return the confirmed fixture");

    // Rival reclaims: the token moves on while gate-r1 still thinks it holds it.
    await db.execute(sql`
      UPDATE vrm_rental_workflow_intents
      SET claimed_by = 'gate-r2', fencing_token = fencing_token + 1, lease_expires_at = now() + interval '30 minutes'
      WHERE id = ${id}
    `);
    await assert.rejects(
      () => openBookingAttempt(id, "gate-r1", mine!.fencingToken, {}),
      (e: any) => ["not_claim_holder", "stale_fencing_token", "claim_lost"].includes(String(e?.code ?? "")),
      "a superseded claimant must never open an attempt",
    );

    // Same holder + token, but the lease lapsed → precise lease_expired.
    await db.execute(sql`
      UPDATE vrm_rental_workflow_intents
      SET claimed_by = 'gate-r1', fencing_token = ${mine!.fencingToken}, lease_expires_at = now() - interval '1 second'
      WHERE id = ${id}
    `);
    await assert.rejects(
      () => openBookingAttempt(id, "gate-r1", mine!.fencingToken, {}),
      (e: any) => String(e?.code ?? "") === "lease_expired",
      "an expired lease must never open an attempt",
    );

    const { rows } = await db.execute(sql`SELECT count(*)::int AS n FROM vrm_workflow_attempts WHERE intent_id = ${id}`);
    assert.equal((rows as any[])[0].n, 0, "no gate pass, no attempt row — the fence IS the insert");
  });

  test("the DB itself refuses a second OPEN attempt (one-open partial unique index)", async () => {
    const id = await insertIntent({ ldap: `${LDAP_PREFIX}GATE3`, status: "confirmed" });
    const mine = (await claimBookingWork({ runnerId: "gate-r3", limit: 20 })).find((i) => i.intentId === id);
    assert.ok(mine, "claim must return the confirmed fixture");
    const first = await openBookingAttempt(id, "gate-r3", mine!.fencingToken, {});
    assert.equal(first.attemptNo, 1);

    // Simulate the same-holder concurrent op_open that slips past every
    // code-level check (snapshot races): a raw second open row with a distinct
    // attempt_no. The partial unique index must refuse it.
    await assert.rejects(
      () =>
        db.execute(sql`
          INSERT INTO vrm_workflow_attempts (intent_id, phase, attempt_no, fencing_token, request_hash, request)
          VALUES (${id}, 'etd_booking', 2, ${mine!.fencingToken}, NULL, '{}'::jsonb)
        `),
      (e: any) => String((e as any)?.code ?? "") === "23505" || /duplicate key/i.test(String(e?.message ?? "")),
      "two OPEN attempts for one (intent, phase) must be impossible at the DB level",
    );

    // Closing the open attempt frees the slot for a legitimate retry.
    await db.execute(sql`
      UPDATE vrm_workflow_attempts SET outcome = 'failed_clean', finished_at = now() WHERE intent_id = ${id}
    `);
    const again = await openBookingAttempt(id, "gate-r3", mine!.fencingToken, {});
    assert.equal(again.attemptNo, 2, "a closed attempt must not block the next legitimate open");
  });
});

// ---------------------------------------------------------------------------

describe("ART filing: kill-switch freeze + crash reconcile", () => {
  let fixtureSeq = 0;

  /** LIVE-mode intent standing exactly at the filing boundary (verified reservation, complete spec, block pending). */
  async function filingFixture(): Promise<number> {
    // Distinct ldap per fixture: live nonterminal rows hold the per-ldap lock.
    const id = await insertIntent({
      execution_mode: "live",
      ldap: `${LDAP_PREFIX}FIL${fixtureSeq++}`,
      status: "reservation_verified",
      preview: JSON.stringify({
        artBlock: { unit: "U-100", locationZip5: "60601", date: "2026-08-17" },
        reservation: { branchName: "Loop", branchAddress: "1 W Adams", branchZip: "60601" },
      }),
    });
    await db.execute(sql`
      UPDATE vrm_rental_workflow_intents
      SET reservation_state = 'verified', block_state = 'pending', event_date = '2026-08-17'
      WHERE id = ${id}
    `);
    return id;
  }

  /** Simulate a crash between the attempt INSERT and the outcome UPDATE.
   *  Default age sits past the 10-minute in-flight grace window. */
  async function openArtAttempt(intentId: number, minutesAgo = 15): Promise<void> {
    await db.execute(sql`
      INSERT INTO vrm_workflow_attempts (intent_id, phase, attempt_no, fencing_token, started_at)
      SELECT ${intentId}, 'art_block', COALESCE(MAX(attempt_no), 0) + 1, 0, now() - (${minutesAgo} * interval '1 minute')
      FROM vrm_workflow_attempts WHERE intent_id = ${intentId} AND phase = 'art_block'
    `);
  }

  const artAttempts = async (intentId: number) =>
    (
      await db.execute(sql`
        SELECT attempt_no, outcome FROM vrm_workflow_attempts
        WHERE intent_id = ${intentId} AND phase = 'art_block' ORDER BY attempt_no
      `)
    ).rows as any[];

  const intentRow = async (intentId: number) =>
    (
      (
        await db.execute(sql`
          SELECT status, block_state, next_retry_at, last_error, block_submitted_at
          FROM vrm_rental_workflow_intents WHERE id = ${intentId}
        `)
      ).rows as any[]
    )[0];

  const nowIso = () => new Date().toISOString();
  const fakeReadback =
    (rows: BlockReadbackRow[], watermarkUtc: string | null) =>
    async (_ldap: string, _dateISO: string) => ({ rows, watermarkUtc });

  test("disarmed live intent freezes retryable BEFORE any attempt or POST", async () => {
    assert.equal(
      isContractBlockLive(),
      false,
      "DARK-build precondition: VRM_CONTRACT_BLOCK_ENABLED must never be armed in dev",
    );
    const id = await filingFixture();
    await fileContractBlock(id);
    assert.equal(
      (await artAttempts(id)).length,
      0,
      "freeze must fire before the ledger INSERT — zero attempts is the proof no POST was possible",
    );
    const row = await intentRow(id);
    assert.equal(row.block_state, "retry", "frozen retryable, not failed");
    assert.ok(
      row.next_retry_at && new Date(row.next_retry_at).getTime() > Date.now(),
      "future next_retry_at: sweep re-evaluates (re-parks while disarmed, files once re-armed)",
    );
    assert.match(String(row.last_error), /disarmed/i);
    assert.equal(row.status, "reservation_verified", "disarm is a hold, not a failure state");
  });

  test("crash-after-open + block landed upstream → adopted, never double-filed", async () => {
    const id = await filingFixture();
    await openArtAttempt(id);
    const out = await reconcileOpenBlockAttempt(id, {
      fetchRows: fakeReadback(
        [{ activity: "Vehicle - Change", startTime: "08:00:00", postcode: "60601", snapshotTs: nowIso() }],
        nowIso(),
      ),
    });
    assert.equal(out, "recovered");
    const atts = await artAttempts(id);
    assert.equal(atts.length, 1, "adoption closes the strand without a second attempt");
    assert.equal(atts[0].outcome, "accepted_reconciled");
    const row = await intentRow(id);
    assert.equal(row.block_state, "accepted");
    assert.ok(row.block_submitted_at, "submit time adopted from attempt open so the sweep readback lane selects it");
  });

  test("crash-after-open + fresh snapshot with no trace → cleared for refile", async () => {
    const id = await filingFixture();
    await openArtAttempt(id);
    const out = await reconcileOpenBlockAttempt(id, { fetchRows: fakeReadback([], nowIso()) });
    assert.equal(out, "cleared");
    const atts = await artAttempts(id);
    assert.equal(atts[0].outcome, "abandoned_no_trace");
    const row = await intentRow(id);
    assert.equal(row.block_state, "retry", "no-trace strand re-enters the retry lane");
    assert.ok(
      row.next_retry_at && new Date(row.next_retry_at).getTime() <= Date.now() + 2000,
      "refile is due immediately (next sweep)",
    );
  });

  test("crash-after-open + fresh block-like row that mismatches spec → manual review, never refile", async () => {
    const id = await filingFixture();
    await openArtAttempt(id);
    const out = await reconcileOpenBlockAttempt(id, {
      fetchRows: fakeReadback(
        [{ activity: "Vehicle - Change", startTime: "09:30:00", postcode: "99999", snapshotTs: nowIso() }],
        nowIso(),
      ),
    });
    assert.equal(out, "manual", "a possibly-mangled landed filing must go to a human, not a refile");
    const atts = await artAttempts(id);
    assert.equal(atts[0].outcome, "reconcile_manual_review");
    const row = await intentRow(id);
    assert.equal(row.block_state, "manual_repair");
    assert.equal(row.status, "manual_review");
  });

  test("stale readback keeps the attempt open and FENCES fileContractBlock", async () => {
    const id = await filingFixture();
    await openArtAttempt(id);
    // Watermark older than the attempt open — absence cannot be proven yet.
    const stale = fakeReadback([], new Date(Date.now() - 60 * 60 * 1000).toISOString());
    const out = await reconcileOpenBlockAttempt(id, { fetchRows: stale });
    assert.equal(out, "ambiguous");
    let atts = await artAttempts(id);
    assert.equal(atts.length, 1);
    assert.equal(atts[0].outcome, null, "ambiguous evidence leaves the strand open (filing stays fenced)");

    // A filing pass over the ambiguous ledger must NOT open a second attempt
    // (which is also the proof it never reached the POST).
    await fileContractBlock(id, { fetchRows: stale });
    atts = await artAttempts(id);
    assert.equal(atts.length, 1, "fenced: no new attempt while the strand is unresolved");
    assert.equal(atts[0].outcome, null);
    assert.equal((await intentRow(id)).block_state, "pending", "state untouched by the fenced pass");
  });

  test("morning-sweep lane heals a stranded open attempt", async () => {
    const id = await filingFixture();
    await openArtAttempt(id, 15);
    const healed = await reconcileOpenBlockAttempts({
      fetchRows: fakeReadback(
        [{ activity: "  VEHICLE - CHANGE ", startTime: "08:00:00", postcode: "60601-2200", snapshotTs: nowIso() }],
        nowIso(),
      ),
    });
    assert.ok(healed >= 1, "sweep must resolve at least this strand");
    const atts = await artAttempts(id);
    assert.equal(atts[0].outcome, "accepted_reconciled", "normalized activity/zip match adopts the landed block");
  });

  test("filing claim CAS is exclusive at the DB level", async () => {
    const id = await filingFixture();
    const cas = async () =>
      (
        (
          await db.execute(sql`
            UPDATE vrm_rental_workflow_intents
            SET block_state = 'filing', updated_at = now()
            WHERE id = ${id} AND block_state IN ('pending', 'retry')
            RETURNING id
          `)
        ).rows as any[]
      ).length;
    assert.equal(await cas(), 1, "pending is claimable exactly once");
    assert.equal(await cas(), 0, "a second claim over 'filing' must lose — the stale-caller fence");
    await db.execute(sql`UPDATE vrm_rental_workflow_intents SET block_state = 'retry' WHERE id = ${id}`);
    assert.equal(await cas(), 1, "retry is claimable (the sweep lane)");
    await db.execute(sql`UPDATE vrm_rental_workflow_intents SET block_state = 'accepted' WHERE id = ${id}`);
    assert.equal(await cas(), 0, "a resolved intent can never be re-claimed for filing");
  });

  test("sweep re-parks an interrupted filing claim (no open attempt = provably nothing POSTed)", async () => {
    const id = await filingFixture();
    // Crash between the CAS and the attempt INSERT: claim held, zero ledger rows.
    await db.execute(sql`
      UPDATE vrm_rental_workflow_intents
      SET block_state = 'filing', updated_at = now() - interval '15 minutes'
      WHERE id = ${id}
    `);
    // Stale readback so any OTHER open strands in the DB stay untouched (ambiguous).
    const healed = await reconcileOpenBlockAttempts({
      fetchRows: fakeReadback([], new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()),
    });
    assert.ok(healed >= 1, "the stale claim must count as a sweep action");
    assert.equal((await artAttempts(id)).length, 0, "re-park never fabricates ledger rows");
    const row = await intentRow(id);
    assert.equal(row.block_state, "retry", "claim surrendered back to the retry lane");
    assert.ok(
      row.next_retry_at && new Date(row.next_retry_at).getTime() <= Date.now() + 2000,
      "immediately eligible — the retry sweep runs right after this lane",
    );
    assert.match(String(row.last_error), /interrupted before any attempt/i);
  });

  test("a fresh open attempt is in-flight, not a strand — grace leaves it fenced and untouched", async () => {
    const id = await filingFixture();
    await openArtAttempt(id, 2);
    // This readback would CLEAR the strand if judged (fresh + empty): grace must refuse to judge.
    const out = await reconcileOpenBlockAttempt(id, { fetchRows: fakeReadback([], nowIso()) });
    assert.equal(out, "ambiguous", "younger than the grace window → never judged");
    const atts = await artAttempts(id);
    assert.equal(atts[0].outcome, null, "attempt stays open (filing stays fenced)");
    assert.equal((await intentRow(id)).block_state, "pending", "zero writes: the owner may still be mid-POST");
  });

  test("crash between parent write and attempt close converges idempotently", async () => {
    const id = await filingFixture();
    // Finalize order is parent-first: a crash right after it leaves an
    // advanced parent + an open attempt. Reconcile must converge, not corrupt.
    await db.execute(sql`UPDATE vrm_rental_workflow_intents SET block_state = 'accepted' WHERE id = ${id}`);
    await openArtAttempt(id, 20);
    const out = await reconcileOpenBlockAttempt(id, {
      fetchRows: fakeReadback(
        [{ activity: "Vehicle - Change", startTime: "08:00:00", postcode: "60601", snapshotTs: nowIso() }],
        nowIso(),
      ),
    });
    assert.equal(out, "recovered");
    const atts = await artAttempts(id);
    assert.equal(atts.length, 1, "no new attempt: the half-finalized filing is adopted, not repeated");
    assert.equal(atts[0].outcome, "accepted_reconciled");
    const row = await intentRow(id);
    assert.equal(row.block_state, "accepted", "parent state re-asserted, never regressed");
    assert.ok(row.block_submitted_at, "submit time backfilled from the attempt open");
  });

  test("a held reconcile claim makes a rival reconciler a no-op (divergent verdicts cannot interleave)", async () => {
    const id = await filingFixture();
    await openArtAttempt(id);
    await db.execute(sql`
      UPDATE vrm_workflow_attempts SET reconcile_claimed_at = now()
      WHERE intent_id = ${id} AND phase = 'art_block'
    `);
    // This rival WOULD clear (fresh empty readback) — the claim must block it
    // before it can even read back.
    const out = await reconcileOpenBlockAttempt(id, { fetchRows: fakeReadback([], nowIso()) });
    assert.equal(out, "ambiguous");
    const atts = await artAttempts(id);
    assert.equal(atts[0].outcome, null, "rival made zero ledger writes");
    assert.equal((await intentRow(id)).block_state, "pending", "rival made zero parent writes");

    // A crashed claimant self-heals: expired lease is claimable again.
    await db.execute(sql`
      UPDATE vrm_workflow_attempts SET reconcile_claimed_at = now() - interval '11 minutes'
      WHERE intent_id = ${id} AND phase = 'art_block'
    `);
    assert.equal(
      await reconcileOpenBlockAttempt(id, { fetchRows: fakeReadback([], nowIso()) }),
      "cleared",
      "expired claim reclaims and judges normally",
    );
  });

  test("no-trace can never downgrade a resolved parent to retry", async () => {
    const id = await filingFixture();
    // Another writer already resolved this filing (e.g. adoption landed just
    // before our readback returned empty from an older snapshot).
    await db.execute(sql`UPDATE vrm_rental_workflow_intents SET block_state = 'accepted' WHERE id = ${id}`);
    await openArtAttempt(id);
    const out = await reconcileOpenBlockAttempt(id, { fetchRows: fakeReadback([], nowIso()) });
    assert.equal(out, "ambiguous", "a no-trace verdict over a resolved parent is stale evidence, not a refile ticket");
    const row = await intentRow(id);
    assert.equal(row.block_state, "accepted", "resolved state survives — no retry re-arm, no second POST possible");
    assert.equal((await artAttempts(id))[0].outcome, null, "attempt stays open pending evidence that matches the state");
  });
});

// ---------------------------------------------------------------------------

describe("request-lane input edits (vehicle class adjust)", () => {
  test("invalidateRequestPreviews knocks built-but-unconfirmed previews back; confirmed and terminal survive", async () => {
    const src = crypto.randomUUID();
    const mk = (rev: number, status: string) =>
      insertIntent({ workflow_type: WORKFLOW_REQUEST, source_id: src, source_revision: rev,
                     ldap: `${LDAP_PREFIX}CLS1`, status });
    const a = await mk(0, "preview_ready");
    const b = await mk(1, "preview_pending");
    const c = await mk(2, "confirmed");
    const d = await mk(3, "cancelled");

    const n = await invalidateRequestPreviews(src, "vehicle class set to 'suv' by test");
    assert.equal(n, 2, "exactly the two pre-confirm previews");

    for (const [id, want] of [[a, "preview_required"], [b, "preview_required"],
                              [c, "confirmed"], [d, "cancelled"]] as Array<[number, string]>) {
      const { rows } = await db.execute(sql`
        SELECT status, last_error FROM vrm_rental_workflow_intents WHERE id = ${id}
      `);
      assert.equal((rows as any[])[0].status, want, `intent ${id}`);
    }
    // The reason lands on the knocked-back rows so Preview explains itself.
    const { rows: ra } = await db.execute(sql`
      SELECT last_error FROM vrm_rental_workflow_intents WHERE id = ${a}
    `);
    assert.match(String((ra as any[])[0].last_error), /vehicle class set to 'suv'/);
  });

  test("requestBookingInFlight sees only post-confirm statuses, only for the SAME request source", async () => {
    const src = crypto.randomUUID();
    assert.equal(await requestBookingInFlight(src), null, "no intents at all");

    const pre = await insertIntent({ workflow_type: WORKFLOW_REQUEST, source_id: src,
                                     ldap: `${LDAP_PREFIX}CLS2`, status: "preview_ready" });
    assert.equal(await requestBookingInFlight(src), null, "a pre-confirm preview is not in flight");

    await db.execute(sql`UPDATE vrm_rental_workflow_intents SET status = 'awaiting_verification' WHERE id = ${pre}`);
    const hit = await requestBookingInFlight(src);
    assert.equal(hit?.status, "awaiting_verification", "post-confirm blocks the edit");

    await db.execute(sql`UPDATE vrm_rental_workflow_intents SET status = 'completed' WHERE id = ${pre}`);
    assert.equal(await requestBookingInFlight(src), null, "terminal releases the edit lock");

    // A cutover intent sharing the same source id never counts against a request edit.
    await insertIntent({ workflow_type: WORKFLOW_CUTOVER, source_id: src,
                         ldap: `${LDAP_PREFIX}CLS2`, status: "booking" });
    assert.equal(await requestBookingInFlight(src), null, "workflow_type filter holds");
  });

  test("a stale runner preview postback can never resurrect an invalidated intent", async () => {
    // Real interleaving, not a mock: the runner passes the entry status check,
    // spends the build window on gate re-runs, and a vehicle-class edit
    // invalidates the intent just before the runner's terminal write.
    const { rows } = await db.execute(sql`
      INSERT INTO vrm_rental_request (ldap, tech_name, mobile_phone, home_state)
      VALUES (${LDAP_PREFIX + "STALE"}, 'ZZ Stale Runner', '5555550199', 'PA')
      RETURNING id, request_no
    `);
    const src = String((rows as any[])[0].request_no);
    const id = await insertIntent({ workflow_type: WORKFLOW_REQUEST, source_id: src,
                                    ldap: `${LDAP_PREFIX}STALE`, status: "preview_pending" });
    await db.execute(sql`
      UPDATE vrm_rental_workflow_intents
      SET claimed_by = 'stale-runner', lease_expires_at = now() + interval '10 minutes', fencing_token = 7
      WHERE id = ${id}
    `);

    await assert.rejects(
      persistPreviewFromRunner(
        { intentId: id, runnerId: "stale-runner", fencingToken: 7,
          quote: { branchPinned: false } as any, classDecision: { mapped: false } as any },
        { beforeFinalWrite: async () => {
            await invalidateRequestPreviews(src, "vehicle class set to 'suv' mid-build");
        } },
      ),
      (e: any) => e?.code === "stale_postback" || /stale preview discarded/.test(String(e?.message)),
      "the guarded terminal write must refuse and surface the discard",
    );

    const row = ((await db.execute(sql`
      SELECT status, last_error, preview FROM vrm_rental_workflow_intents WHERE id = ${id}
    `)).rows as any[])[0];
    assert.equal(row.status, "preview_required", "invalidation outcome survives the stale postback");
    assert.match(String(row.last_error), /vehicle class set to 'suv' mid-build/,
      "the edit's reason is not clobbered by the runner's failure codes");
    assert.equal(row.preview, null, "no stale preview lands");
  });
});
