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
  QUIET_FALLBACK_SETTING_KEY,
  cancelIntent,
  claimBookingWork,
  claimSendGuardDispatch,
  confirmIntent,
  evaluateEligibility,
  fetchEligibilityFacts,
  fileContractBlock,
  finalizeCompletion,
  getQuietStateFallback,
  invalidateRequestPreviews,
  isContractBlockLive,
  openBookingAttempt,
  persistPreviewFromRunner,
  requestBookingInFlight,
  recordBookingPostback,
  recordCancellationEvidence,
  attachReservationConfirmation,
  reconcileOpenBlockAttempt,
  reconcileOpenBlockAttempts,
  releaseMsg2IfDue,
  setQuietStateFallback,
  type BlockReadbackRow,
} from "../server/vrm/forms/cutover-orchestrator";

const LDAP_PREFIX = "ZZCUT";

async function cleanup() {
  await db.execute(sql`DELETE FROM vrm_rental_workflow_intents WHERE upper(ldap) LIKE ${LDAP_PREFIX + "%"}`);
  await db.execute(sql`DELETE FROM vrm_rental_request WHERE upper(ldap) LIKE ${LDAP_PREFIX + "%"}`);
  await db.execute(sql`DELETE FROM vrm_rental_cutover WHERE upper(ldap) LIKE ${LDAP_PREFIX + "%"}`);
  await db.execute(sql`DELETE FROM vrm_rental_tech_survey WHERE upper(ldap) LIKE ${LDAP_PREFIX + "%"}`);
  await db.execute(sql`DELETE FROM all_techs WHERE upper(tech_racfid) LIKE ${LDAP_PREFIX + "%"}`);
  await db.execute(sql`DELETE FROM tpms_tech_profiles WHERE upper(enterprise_id) LIKE ${LDAP_PREFIX + "%"}`);
  await db.execute(sql`DELETE FROM fs_comms_contacts WHERE upper(ldap) LIKE ${LDAP_PREFIX + "%"}`);
  await db.execute(sql`DELETE FROM vrm_rental_operations_cases WHERE case_key LIKE 'ZZCUT-%'`);
  await db.execute(sql`DELETE FROM vrm_rental_identity_resolutions WHERE case_key LIKE 'ZZCUT-%'`);
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

// Drizzle wraps the pg error ("Failed query: <sql>", no .code) — the 23505
// lives on e.cause, so the check must walk the cause chain. The old direct
// e.code/e.message predicate silently matched NOTHING, failing every
// assert.rejects that used it.
import { isUniqueViolation } from "../server/vrm/forms/db-errors";

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
    // Strict readback identity (repair spec §3) verifies branch/date/class
    // too — a production intent always carries them (preview + event_date),
    // so the fixture does as well.
    const id = await insertIntent({
      workflow_type: WORKFLOW_REQUEST, ldap, status: "confirmed",
      preview: JSON.stringify({ reservation: { branchCode: "DAL123", sipp: "ICAR" } }),
    });
    await db.execute(sql`UPDATE vrm_rental_workflow_intents SET event_date = '2026-08-20' WHERE id = ${id}`);
    const mine = (await claimBookingWork({ runnerId: "req-done-runner", limit: 50 })).find((i) => i.intentId === id);
    assert.ok(mine, "claim must return the confirmed request fixture");

    const verifiedPayload = {
      expected: { confirmation: "REQ-C1" },
      matches: [{
        confirmation: "REQ-C1", reference: `SHS ${ldap} pickup`,
        branchCode: "DAL123", date: "2026-08-20", sipp: "ICAR",
      }],
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

    // A bare empty match list is NOT authoritative (repair spec §3): without
    // search meta proving the search ran and covered this intent's own
    // identifiers, "found nothing" must change nothing.
    const vague = await recordBookingPostback({
      intentId: id,
      runnerId: "test-runner-rcv",
      fencingToken: mine!.fencingToken,
      phase: "readback",
      payload: { matches: [] },
    });
    assert.equal(vague.accepted, true);
    assert.equal(vague.readback?.verdict, "inconclusive", "empty matches without search meta must be inconclusive");
    assert.equal(vague.status, "booking", "an inconclusive readback must not move the intent");
    const rowNow = ((await db.execute(sql`
      SELECT status, reservation_state, last_error FROM vrm_rental_workflow_intents WHERE id = ${id}
    `)).rows as any[])[0];
    assert.equal(rowNow.status, "booking");
    assert.equal(rowNow.reservation_state, "unknown", "unknown stays unknown — never bookable off a mis-keyed search");
    assert.match(String(rowNow.last_error), /inconclusive/i);

    // Same empty result, but the runner PROVES the search succeeded under
    // this intent's identifier (LDAP criterion) → authoritative clean-none.
    const rb = await recordBookingPostback({
      intentId: id,
      runnerId: "test-runner-rcv",
      fencingToken: mine!.fencingToken,
      phase: "readback",
      payload: { matches: [], search: { status: "ok", criteria: [`${LDAP_PREFIX}RCV4`] } },
    });
    assert.equal(rb.status, "confirmed", "clean-none on a reconcile retry must return the intent to 'confirmed'");
    const cleanRow = ((await db.execute(sql`
      SELECT last_error FROM vrm_rental_workflow_intents WHERE id = ${id}
    `)).rows as any[])[0];
    assert.match(
      String(cleanRow.last_error),
      /reconciled clean/,
      "with no recorded failure the clean-reconcile wording still stands",
    );
  });

  test("a clean-none readback after a REFUSED commit keeps the refusal as the last word", async () => {
    // The MEBADI shape: Enterprise refused the commit, the readback correctly found no
    // reservation, and "reconciled clean" then overwrote the only explanation the
    // operator had. The state change is right; the wording was not.
    const refusal =
      "POST /api/reservationwizard/reservation/savedr rejected: errors: RES_DRIVER_DECLARATION: driver declaration required";
    const id = await insertIntent({ ldap: `${LDAP_PREFIX}RFUS`, status: "booking" });
    // Exactly the row a refused commit leaves behind: a closed etd_booking attempt whose
    // evidence carries the reason, and an intent parked as possibly-booked.
    await db.execute(sql`
      INSERT INTO vrm_workflow_attempts (intent_id, phase, attempt_no, fencing_token, outcome, finished_at, evidence)
      VALUES (${id}, 'etd_booking', 1, 1, 'exception', now(),
              ${JSON.stringify({ error: refusal, httpStatus: 200, stage: "savedr_commit" })}::jsonb)
    `);
    await db.execute(sql`
      UPDATE vrm_rental_workflow_intents
      SET reservation_state = 'unknown', last_error = ${`booking outcome exception: ${refusal}`}
      WHERE id = ${id}
    `);

    const mine = (await claimBookingWork({ runnerId: "refusal-runner", limit: 20 }))
      .find((i) => i.intentId === id);
    assert.ok(mine, "a possibly-booked intent must be claimable for reconcile");
    assert.equal(mine!.requiresReconcile, true, "and it must be readback-first");

    const rb = await recordBookingPostback({
      intentId: id,
      runnerId: "refusal-runner",
      fencingToken: mine!.fencingToken,
      phase: "readback",
      payload: { matches: [], search: { status: "ok", criteria: [`${LDAP_PREFIX}RFUS`] } },
    });
    assert.equal(rb.status, "confirmed", "proven-none still returns the intent to bookable");

    const row = ((await db.execute(sql`
      SELECT reservation_state, last_error FROM vrm_rental_workflow_intents WHERE id = ${id}
    `)).rows as any[])[0];
    assert.equal(row.reservation_state, "pending");
    assert.match(String(row.last_error), /no reservation created/, "the card must say what happened");
    assert.match(String(row.last_error), /RES_DRIVER_DECLARATION/, "and carry the reason Enterprise gave");
    assert.ok(
      !String(row.last_error).includes("reconciled clean"),
      `a reassurance must not replace the refusal: ${row.last_error}`,
    );
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
      isUniqueViolation,
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

// ---------------------------------------------------------------------------

describe("eligibility facts: Enterprise-only case binding (repair spec §1)", () => {
  test("HERTZ cases are invisible; exactly one ENTERPRISE case binds with full facts", async () => {
    const ldap = `${LDAP_PREFIX}ELG1`;
    const { rows: sv } = await db.execute(sql`
      INSERT INTO vrm_rental_tech_survey (ldap, tech_name, has_rental, van_status, assigned_truck_number)
      VALUES (${ldap}, 'ZZ Cut Elg', true, 'in_shop', '61385')
      RETURNING id
    `);
    const surveyId = String((sv as any[])[0].id);
    await db.execute(sql`
      INSERT INTO all_techs (employee_id, tech_racfid, tech_name, employment_status, district_no, effective_date, synced_at)
      VALUES ('990001', ${ldap}, 'ZZ Cut Elg', 'A', '8330', now(), now())
    `);
    await db.execute(sql`
      INSERT INTO tpms_tech_profiles (tech_id, enterprise_id, truck_no, synced_at)
      VALUES ('ZZT990001', ${ldap}, '61385', now())
    `);
    await db.execute(sql`
      INSERT INTO fs_comms_contacts (ldap, phone, primary_state)
      VALUES (${ldap}, '2145550100', 'TX')
    `);
    const feed = JSON.stringify({
      RENTING_BRANCH: "DFW123", RENTING_CITY_NAME: "Dallas", RENTING_STATE: "TX",
      ECARS_2_0_TKT_NBR: "E1234567", CLAIM_NUMBER: "CLM-9",
      RENTED_VEH_MAKE: "CHEVROLET", RENTED_VEH_MODEL: "MALIBU",
      RENTED_VEH_YEAR: "2025", RENTAL_START_DATE: "2026-08-01",
    });
    // case_key is varchar(10) in both case tables — keep fixtures short.
    for (const [key, vendor] of [
      ["ZZCUT-ENT", "ENTERPRISE RENT A CAR"],
      ["ZZCUT-HTZ", "HERTZ"],
    ] as const) {
      await db.execute(sql`
        INSERT INTO vrm_rental_operations_cases
          (case_key, vehicle_number_padded, vehicle_number, present_in_latest, ticket_status, rental_vendor, feed_json)
        VALUES (${key}, '061385', '61385', true, 'OPEN', ${vendor}, ${feed}::jsonb)
      `);
      await db.execute(sql`
        INSERT INTO vrm_rental_identity_resolutions (case_key, state, resolved_employee_id)
        VALUES (${key}, 'resolved', '990001')
      `);
    }

    const facts = await fetchEligibilityFacts({ workflowType: WORKFLOW_CUTOVER, sourceId: surveyId });
    assert.equal(facts.openCaseCount, 1, "the HERTZ case must not count — vendor filter is ENTERPRISE%");
    assert.equal(facts.caseKey, "ZZCUT-ENT");
    assert.equal(facts.caseFacts?.ecars, "E1234567");
    assert.equal(facts.caseFacts?.rentingBranch, "DFW123");
    assert.equal(facts.tpmsTruck, "61385");
    assert.equal(facts.roster?.districtNo, "8330");
    assert.equal(facts.contactPhone, "2145550100");
    assert.equal(facts.contactState, "TX");
    assert.equal(facts.truckContradiction, null, "survey truck agrees with TPMS — no contradiction");
    const gate = evaluateEligibility(facts);
    assert.equal(gate.ok, true, `fully-seeded tech must pass: ${JSON.stringify((gate as any).failures ?? gate)}`);
  });
});

// ---------------------------------------------------------------------------

describe("cancel is TRUE (repair spec §4)", () => {
  const FLAG = "VRM_CONTRACT_BLOCK_ENABLED";

  test("dry_run cancel is immediately terminal", async () => {
    const id = await insertIntent({ ldap: `${LDAP_PREFIX}CXA`, status: "confirmed" });
    const out = await cancelIntent(id, "db-test", "fixture teardown");
    assert.equal(out.status, "cancelled", "no external effects possible in dry_run — terminal at once");
  });

  test("live possibly-booked cancel parks at cancel_pending_readback, holds the live lock, writes NO tracking row", async () => {
    const ldap = `${LDAP_PREFIX}CXB`;
    const id = await insertIntent({ execution_mode: "live", ldap, status: "awaiting_verification" });
    await db.execute(sql`UPDATE vrm_rental_workflow_intents SET reservation_state = 'booked_unverified' WHERE id = ${id}`);

    const out = await cancelIntent(id, "db-test", "tech declined");
    assert.equal(out.status, "cancel_pending_readback", "a possibly-booked live intent must never terminal-cancel on hope");
    assert.match(String(out.last_error), /awaiting ETD readback proof/);

    // Live-lock retained: a second live workflow for this tech stays blocked.
    await assert.rejects(
      () => insertIntent({ execution_mode: "live", ldap, status: "created" }),
      isUniqueViolation,
      "cancel_pending_readback is NONTERMINAL — the per-ldap live lock must hold",
    );
    // D5: no phantom tracking row — the mirror is UPDATE-only and completion never ran.
    const n = ((await db.execute(sql`
      SELECT count(*)::int AS n FROM vrm_rental_cutover WHERE upper(ldap) = ${ldap}
    `)).rows as any[])[0].n;
    assert.equal(n, 0, "cancel must never fabricate a vrm_rental_cutover row");
  });

  test("authoritative-none readback completes the cancel; a found reservation demands human evidence", async () => {
    const prev = process.env[FLAG];
    try {
      const ldapNone = `${LDAP_PREFIX}CXC`;
      const idNone = await insertIntent({ execution_mode: "live", ldap: ldapNone, status: "awaiting_verification" });
      await db.execute(sql`UPDATE vrm_rental_workflow_intents SET reservation_state = 'booked_unverified' WHERE id = ${idNone}`);
      await cancelIntent(idNone, "db-test", "tech declined");

      const ldapFound = `${LDAP_PREFIX}CXD`;
      const idFound = await insertIntent({ execution_mode: "live", ldap: ldapFound, status: "awaiting_verification" });
      await db.execute(sql`UPDATE vrm_rental_workflow_intents SET reservation_state = 'booked_unverified' WHERE id = ${idFound}`);
      await cancelIntent(idFound, "db-test", "tech declined");

      // Claiming live rows requires transient arming (test-scoped). No
      // external effect is possible here: claims and readback postbacks are
      // DB-only — nothing dials ETD.
      process.env[FLAG] = "true";
      const items = await claimBookingWork({ runnerId: "cancel-runner", limit: 50 });
      const mineNone = items.find((i) => i.intentId === idNone);
      const mineFound = items.find((i) => i.intentId === idFound);
      assert.ok(mineNone && mineFound, "cancel lane must serve cancel_pending_readback intents");
      assert.equal(mineNone!.kind, "cancel");
      assert.equal(mineNone!.requiresReconcile, true, "cancel claims are readback-first by definition");

      const rbNone = await recordBookingPostback({
        intentId: idNone, runnerId: "cancel-runner", fencingToken: mineNone!.fencingToken,
        phase: "readback",
        payload: { matches: [], search: { status: "ok", criteria: [`SHSNX-${idNone}`] } },
      });
      assert.equal(rbNone.status, "cancelled", "authoritative none = proof ETD holds nothing → terminal cancel");
      // The settle must be LOUD, never a bare "found nothing": it records what
      // was searched, and names the residual a hand-booked reservation leaves
      // (no SHSNX reference → invisible to this search) plus the manual path.
      const settled = ((await db.execute(sql`
        SELECT last_error, reservation_evidence FROM vrm_rental_workflow_intents WHERE id = ${idNone}
      `)).rows as any[])[0];
      assert.match(String(settled.last_error), /SHSNX-/, "the settle names the criteria searched");
      assert.match(String(settled.last_error), /booked by hand/i, "the hand-booking caveat is explicit");
      assert.match(String(settled.last_error), /cancelled in the ETD portal directly/i, "the manual path is named, not implied");
      assert.ok(settled.reservation_evidence?.cancelReadback?.search, "the search summary is ledgered on the intent");

      const rbFound = await recordBookingPostback({
        intentId: idFound, runnerId: "cancel-runner", fencingToken: mineFound!.fencingToken,
        phase: "readback",
        payload: {
          matches: [{ confirmation: "C-LIVE-1", reference: `SHS ${ldapFound} SHSNX-${idFound}` }],
          search: { status: "ok", criteria: [`SHSNX-${idFound}`] },
        },
      });
      assert.equal(rbFound.status, "manual_review", "anything found blocks the cancel — a human must cancel in ETD");
      const row = ((await db.execute(sql`
        SELECT last_error FROM vrm_rental_workflow_intents WHERE id = ${idFound}
      `)).rows as any[])[0];
      assert.match(String(row.last_error), /cancel it in ETD manually/);

      // Staff records the manual ETD cancellation → terminal with evidence.
      const done = await recordCancellationEvidence(idFound, "db-test", { etdCancellationRef: "ETD-CXL-778" });
      assert.equal(done.status, "cancelled");
      assert.equal((done.reservation_evidence as any)?.cancellation?.etdCancellationRef, "ETD-CXL-778");
      assert.equal((done.reservation_evidence as any)?.cancellation?.recordedBy, "db-test");
    } finally {
      if (prev === undefined) delete process.env[FLAG];
      else process.env[FLAG] = prev;
    }
  });

  test("a hand-booked reservation: advisory sighting parks the cancel, attaching its confirmation makes it findable", async () => {
    // The residual gap this pins: a reservation booked BY HAND in the ETD
    // portal carries no SHSNX reference and no confirmation on file, so the
    // readback CANNOT identify it (matches stays []). The runner still SAW it
    // as an unidentified confirmation-bearing journey (possibleUnlinked) —
    // and on that sighting the cancel must refuse to settle terminal.
    const prev = process.env[FLAG];
    try {
      const ldap = `${LDAP_PREFIX}CXH`;
      const id = await insertIntent({ execution_mode: "live", ldap, status: "awaiting_verification" });
      await db.execute(sql`UPDATE vrm_rental_workflow_intents SET reservation_state = 'booked_unverified' WHERE id = ${id}`);
      await cancelIntent(id, "db-test", "tech declined");

      process.env[FLAG] = "true";
      let items = await claimBookingWork({ runnerId: "cancel-runner", intentId: id });
      let mine = items.find((i) => i.intentId === id)!;
      assert.ok(mine, "cancel lane serves the intent");
      assert.equal(mine.reservationEvidence.confirmation, null, "nothing on file yet");

      const rb = await recordBookingPostback({
        intentId: id, runnerId: "cancel-runner", fencingToken: mine.fencingToken,
        phase: "readback",
        payload: {
          matches: [], // NOT identified — advisory rows are never matches
          search: {
            status: "ok", criteria: [`SHSNX-${id}`, ldap], rowsReturned: 3, identified: 0,
            possibleUnlinked: [{ confirmation: "HAND77", branchCode: "9912", date: "2026-08-24", sipp: "ICAR" }],
          },
        },
      });
      assert.equal(rb.status, "manual_review", "an unlinked confirmation in view must block the terminal settle");
      const parked = ((await db.execute(sql`
        SELECT last_error FROM vrm_rental_workflow_intents WHERE id = ${id}
      `)).rows as any[])[0];
      assert.match(String(parked.last_error), /cancel NOT settled/i);
      assert.match(String(parked.last_error), /HAND77/, "the sighted confirmation is named for the human");
      assert.match(String(parked.last_error), /attach its confirmation/i, "the attach path is named, not implied");

      // Staff checks ETD, finds the hand booking, attaches its confirmation.
      const attached = await attachReservationConfirmation(id, "db-test", { confirmation: "hand77", note: "found in ETD portal" });
      assert.equal(attached.reservation_evidence?.confirmation, "HAND77", "normalized upper-case");
      assert.equal(attached.reservation_evidence?.confirmationAttachment?.attachedBy, "db-test");
      // A DIFFERENT confirmation is a conflict, never an overwrite.
      await assert.rejects(
        () => attachReservationConfirmation(id, "db-test", { confirmation: "OTHER99" }),
        (e: any) => String(e?.code ?? "") === "conflict" && e?.httpStatus === 409,
        "two confirmations = possible double booking; must 409",
      );

      // Re-cancel: reservation_state is still booked_unverified → readback lane again.
      const again = await cancelIntent(id, "db-test", "cancel the hand booking");
      assert.equal(again.status, "cancel_pending_readback");
      items = await claimBookingWork({ runnerId: "cancel-runner", intentId: id });
      mine = items.find((i) => i.intentId === id)!;
      assert.equal(mine.reservationEvidence.confirmation, "HAND77",
        "the claim serves the attached confirmation — without this the runner could never search on it");

      // The runner searches on HAND77 and now POSITIVELY identifies the row.
      const rb2 = await recordBookingPostback({
        intentId: id, runnerId: "cancel-runner", fencingToken: mine.fencingToken,
        phase: "readback",
        payload: {
          matches: [{ confirmation: "HAND77", reference: "walk-in", branchCode: "9912", date: "2026-08-24", sipp: "ICAR" }],
          expected: { confirmation: "HAND77" },
          search: { status: "ok", criteria: ["HAND77"], rowsReturned: 1, identified: 1, possibleUnlinked: [] },
        },
      });
      assert.equal(rb2.status, "manual_review", "found = a human cancels it in ETD, then records evidence");
      const done = await recordCancellationEvidence(id, "db-test", { etdCancellationRef: "ETD-CXL-880" });
      assert.equal(done.status, "cancelled");
    } finally {
      if (prev === undefined) delete process.env[FLAG];
      else process.env[FLAG] = prev;
    }
  });

  test("attach-confirmation is state- and format-guarded", async () => {
    const id = await insertIntent({ ldap: `${LDAP_PREFIX}CXI`, status: "created" });
    await assert.rejects(
      () => attachReservationConfirmation(id, "db-test", { confirmation: "ABC123" }),
      (e: any) => String(e?.code ?? "") === "bad_state" && e?.httpStatus === 409,
      "nothing external exists before booking — attach must 409",
    );
    await db.execute(sql`UPDATE vrm_rental_workflow_intents SET status = 'manual_review' WHERE id = ${id}`);
    await assert.rejects(
      () => attachReservationConfirmation(id, "db-test", { confirmation: "x" }),
      (e: any) => String(e?.code ?? "") === "bad_payload",
      "a one-character 'confirmation' is a typo, not evidence",
    );
    await assert.rejects(
      () => attachReservationConfirmation(id, "db-test", { confirmation: "has spaces!" }),
      (e: any) => String(e?.code ?? "") === "bad_payload",
    );
    const ok = await attachReservationConfirmation(id, "db-test", { confirmation: "ABC123" });
    assert.equal(ok.reservation_evidence?.confirmation, "ABC123");
    // Idempotent re-attach of the SAME confirmation is fine (case-insensitive).
    const re = await attachReservationConfirmation(id, "db-test", { confirmation: "abc123" });
    assert.equal(re.reservation_evidence?.confirmation, "ABC123");
  });

  test("cancellation evidence is state- and payload-guarded", async () => {
    const id = await insertIntent({ ldap: `${LDAP_PREFIX}CXE`, status: "confirmed" });
    await assert.rejects(
      () => recordCancellationEvidence(id, "db-test", { note: "nope" }),
      (e: any) => String(e?.code ?? "") === "bad_state" && e?.httpStatus === 409,
      "evidence outside cancel_pending_readback/manual_review must 409",
    );
    await db.execute(sql`UPDATE vrm_rental_workflow_intents SET status = 'cancel_pending_readback' WHERE id = ${id}`);
    await assert.rejects(
      () => recordCancellationEvidence(id, "db-test", {}),
      (e: any) => String(e?.code ?? "") === "bad_payload",
      "empty evidence must 400 — a ref or note is the whole point",
    );
  });
});

// ---------------------------------------------------------------------------

describe("terminal completion (repair spec §5)", () => {
  test("non-live completion is a CAS flip only — no tracking row, no double fire", async () => {
    const ldap = `${LDAP_PREFIX}FINA`;
    const id = await insertIntent({ ldap, status: "reservation_verified" });
    assert.equal(await finalizeCompletion(id, "reservation_verified"), true, "observed status matches → flip");
    const row = ((await db.execute(sql`
      SELECT status FROM vrm_rental_workflow_intents WHERE id = ${id}
    `)).rows as any[])[0];
    assert.equal(row.status, "completed");
    const n = ((await db.execute(sql`
      SELECT count(*)::int AS n FROM vrm_rental_cutover WHERE upper(ldap) = ${ldap}
    `)).rows as any[])[0].n;
    assert.equal(n, 0, "dry_run completion must never write tracking evidence");
    assert.equal(await finalizeCompletion(id, "reservation_verified"), false, "CAS: a second finalize must lose");
  });

  test("live cutover completion lands the tracking row transactionally with the flip", async () => {
    const ldap = `${LDAP_PREFIX}FINB`;
    const id = await insertIntent({
      execution_mode: "live", ldap, status: "reservation_verified",
      preview: JSON.stringify({
        reservation: {
          branchCode: "DFW123", branchName: "Dallas Central", branchAddress: "1 Main St, Dallas TX",
          sipp: "FCAR", pickupDate: "2026-08-17", returnDate: "2026-09-16",
          quote: { journeyId: "J-778899" },
        },
      }),
    });
    await db.execute(sql`
      UPDATE vrm_rental_workflow_intents
      SET tech_name = 'ZZ Fin Tech', truck_number = '61385',
          reservation_state = 'verified', block_state = 'verified',
          msg1_state = 'sent', msg2_state = 'released',
          reservation_evidence = '{"confirmation":"1568742936"}'::jsonb,
          block_evidence = '{"projectId":"P-1","projectName":"SHS BLOCK"}'::jsonb,
          event_date = '2026-08-17', block_submitted_at = now()
      WHERE id = ${id}
    `);
    assert.equal(await finalizeCompletion(id, "reservation_verified"), true);
    const intent = ((await db.execute(sql`
      SELECT status FROM vrm_rental_workflow_intents WHERE id = ${id}
    `)).rows as any[])[0];
    assert.equal(intent.status, "completed");
    const t = ((await db.execute(sql`
      SELECT * FROM vrm_rental_cutover WHERE upper(ldap) = ${ldap}
    `)).rows as any[])[0];
    assert.ok(t, "live cutover completion must land the tracking row in the same transaction");
    assert.equal(t.reservation_status, "booked");
    assert.equal(t.route_block_status, "filed");
    assert.equal(t.route_block_live, true);
    assert.equal(t.etd_reference, "1568742936");
    assert.equal(t.etd_reservation_id, "J-778899", "journey id falls back to the preview quote");
    assert.equal(t.vehicle_class, "FCAR");
    assert.equal(Number(t.intent_id), id);
    assert.equal(t.workflow_status, "completed");
  });
});

// ---------------------------------------------------------------------------

describe("msg2 morning release gates (repair spec §7)", () => {
  const localISO = (offsetDays: number, tz = "America/New_York") =>
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
      .format(new Date(Date.now() + offsetDays * 86_400_000));

  async function msg2Fixture(ldap: string, over: Record<string, unknown> = {}): Promise<number> {
    const id = await insertIntent({ ldap, status: "reservation_verified", ...over });
    await db.execute(sql`
      UPDATE vrm_rental_workflow_intents
      SET reservation_state = 'verified', block_state = 'verified', msg1_state = 'sent', msg2_state = 'held'
      WHERE id = ${id}
    `);
    return id;
  }

  async function stageGuard(id: number) {
    await db.execute(sql`
      INSERT INTO vrm_workflow_send_guards (intent_id, workflow_type, message_moment, execution_mode, status, body)
      VALUES (${id}, ${WORKFLOW_CUTOVER}, 'msg2_morning', 'dry_run', 'held', 'db-test msg2 body')
    `);
  }

  const guardStatus = async (id: number) =>
    String(((await db.execute(sql`
      SELECT status FROM vrm_workflow_send_guards WHERE intent_id = ${id} AND message_moment = 'msg2_morning' LIMIT 1
    `)).rows as any[])[0]?.status ?? "");

  test("no staged guard → blocked, msg2 stays held", async () => {
    const id = await msg2Fixture(`${LDAP_PREFIX}M2A`);
    await db.execute(sql`UPDATE vrm_rental_workflow_intents SET event_date = ${localISO(0)} WHERE id = ${id}`);
    assert.equal(await releaseMsg2IfDue(id), "blocked");
    const row = ((await db.execute(sql`
      SELECT msg2_state, last_error FROM vrm_rental_workflow_intents WHERE id = ${id}
    `)).rows as any[])[0];
    assert.equal(row.msg2_state, "held");
    assert.match(String(row.last_error), /never staged/);
  });

  test("event tomorrow → skipped_not_event_day (nothing resolves)", async () => {
    const id = await msg2Fixture(`${LDAP_PREFIX}M2B`);
    await stageGuard(id);
    await db.execute(sql`UPDATE vrm_rental_workflow_intents SET event_date = ${localISO(1)} WHERE id = ${id}`);
    assert.equal(await releaseMsg2IfDue(id), "skipped_not_event_day");
    assert.equal(await guardStatus(id), "held", "not-yet is a wait, not a resolution");
  });

  test("event already passed → skipped_stale_event; guard stamped; msg2 released WITHOUT sending", async () => {
    const id = await msg2Fixture(`${LDAP_PREFIX}M2C`);
    await stageGuard(id);
    await db.execute(sql`UPDATE vrm_rental_workflow_intents SET event_date = ${localISO(-1)} WHERE id = ${id}`);
    assert.equal(await releaseMsg2IfDue(id), "skipped_stale_event");
    assert.equal(await guardStatus(id), "skipped_stale_event");
    const row = ((await db.execute(sql`
      SELECT msg2_state, last_error FROM vrm_rental_workflow_intents WHERE id = ${id}
    `)).rows as any[])[0];
    assert.equal(row.msg2_state, "released", "released-as-skipped: completion may proceed, no stale text goes out");
    assert.match(String(row.last_error), /already passed/);
  });

  test("event today (dry_run, non-exception state) → released", async () => {
    const id = await msg2Fixture(`${LDAP_PREFIX}M2D`);
    await stageGuard(id);
    await db.execute(sql`UPDATE vrm_rental_workflow_intents SET event_date = ${localISO(0)} WHERE id = ${id}`);
    assert.equal(await releaseMsg2IfDue(id), "released");
    assert.equal(await guardStatus(id), "released");
  });

  test("quiet-exception state (TX): blocked without a persisted policy; skip_msg2 policy skips", async () => {
    const prior = ((await db.execute(sql`
      SELECT value, updated_by FROM app_settings WHERE key = ${QUIET_FALLBACK_SETTING_KEY}
    `)).rows as any[])[0] ?? null;
    try {
      const ldap = `${LDAP_PREFIX}M2Q`;
      const { rows: sv } = await db.execute(sql`
        INSERT INTO vrm_rental_tech_survey (ldap, tech_name, has_rental, van_status)
        VALUES (${ldap}, 'ZZ Quiet TX', true, 'in_shop')
        RETURNING id
      `);
      const surveyId = String((sv as any[])[0].id);
      await db.execute(sql`
        INSERT INTO fs_comms_contacts (ldap, phone, primary_state) VALUES (${ldap}, '2145550101', 'TX')
      `);
      const id = await msg2Fixture(ldap, { source_id: surveyId });
      await stageGuard(id);
      // Event day in the RECIPIENT's timezone (TX → America/Chicago).
      await db.execute(sql`UPDATE vrm_rental_workflow_intents SET event_date = ${localISO(0, "America/Chicago")} WHERE id = ${id}`);

      await db.execute(sql`DELETE FROM app_settings WHERE key = ${QUIET_FALLBACK_SETTING_KEY}`);
      assert.equal(await getQuietStateFallback(), null);
      assert.equal(await releaseMsg2IfDue(id), "blocked", "exception state without a persisted operator choice must hold");
      let row = ((await db.execute(sql`
        SELECT msg2_state, last_error FROM vrm_rental_workflow_intents WHERE id = ${id}
      `)).rows as any[])[0];
      assert.equal(row.msg2_state, "held");
      assert.match(String(row.last_error), /no fallback policy/);

      await setQuietStateFallback("skip_msg2", "db-test");
      assert.equal(await releaseMsg2IfDue(id), "skipped_policy");
      assert.equal(await guardStatus(id), "skipped_policy");
      row = ((await db.execute(sql`
        SELECT msg2_state, last_error FROM vrm_rental_workflow_intents WHERE id = ${id}
      `)).rows as any[])[0];
      assert.equal(row.msg2_state, "released");
      assert.match(String(row.last_error), /skip_msg2/);
    } finally {
      await db.execute(sql`DELETE FROM app_settings WHERE key = ${QUIET_FALLBACK_SETTING_KEY}`);
      if (prior) {
        await db.execute(sql`
          INSERT INTO app_settings (key, value, updated_by, updated_at)
          VALUES (${QUIET_FALLBACK_SETTING_KEY}, ${JSON.stringify(prior.value)}::jsonb, ${prior.updated_by ?? null}, now())
        `);
      }
    }
  });
});
