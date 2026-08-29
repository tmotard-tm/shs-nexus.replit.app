/**
 * Rental requests no longer have any legacy booking doors. Extension requests
 * are approved only through their manual Enterprise-extension workflow — the
 * technician already holds a car, so booking another would put a SECOND car on
 * them. The cutover orchestrator remains a defence-in-depth refusal for any
 * non-route caller.
 *
 * This suite pins those boundaries against the real dev database + real route
 * handlers (in-process express app — no dev server needed, same pattern as
 * cutover-routes-auth.test.ts), plus the type-aware liveRequestGuard
 * semantics that make extensions filable in the first place:
 *   - a BOOKED new request does not block an extension (it IS the rental
 *     being extended)
 *   - a pending extension blocks a second one
 *   - an approved extension is settled (never books) and must not block
 *     next week's extension.
 *
 * Every fixture uses ZZEXT* ldaps, has NO phone anywhere, and is deleted in
 * before()/after(). NO external system is touched.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { sql } from "drizzle-orm";

import { db, pool } from "../server/db";
import { initFormsSchema } from "../server/vrm/forms/schema";
import { raCandidatesFromCheck } from "../client/src/pages/vehicle-rental-management/lib/ext-ra-candidates";
import {
  registerRentalRequestAdminRoutes,
  liveRequestGuard,
  autoBookApprovedRequestInner,
} from "../server/vrm/forms/rental-request";
import { getDirectBillingStandingForLdap } from "../server/vrm/holman-rental-po-storage";
import {
  WORKFLOW_REQUEST,
  createIntent,
  OrchestratorError,
} from "../server/vrm/forms/cutover-orchestrator";

const LDAP_PREFIX = "ZZEXT";

let server: any;
let baseUrl = "";
const B = "/api/vrm/forms/rental-request";
const smsCalls: any[] = [];

async function cleanupFixtures() {
  await db.execute(sql`
    DELETE FROM vrm_rental_workflow_intents
    WHERE source_id IN (SELECT request_no::text FROM vrm_rental_request WHERE upper(ldap) LIKE ${LDAP_PREFIX + "%"})
       OR upper(ldap) LIKE ${LDAP_PREFIX + "%"}
  `);
  await db.execute(sql`DELETE FROM vrm_rental_request WHERE upper(ldap) LIKE ${LDAP_PREFIX + "%"}`);
}

async function insertRequest(over: Partial<Record<string, unknown>> = {}): Promise<number> {
  const v = {
    ldap: `${LDAP_PREFIX}A`,
    tech_name: "Zz Extension Doors Fixture",
    request_type: "new",
    status: "approved",
    mobile_phone: null,
    // Deliberately present: the queue also requires a pickup/appointment, and
    // an extension row missing one would pass the door test for the WRONG
    // reason (the date predicate, not the type predicate).
    appointment_at: sql`now() + interval '1 day'`,
    ...over,
  } as Record<string, any>;
  const { rows } = await db.execute(sql`
    INSERT INTO vrm_rental_request
      (ldap, tech_name, request_type, status, appointment_at, home_state, mobile_phone)
    VALUES
      (${v.ldap}, ${v.tech_name}, ${v.request_type}, ${v.status}, ${v.appointment_at}, 'PA',
       ${v.mobile_phone})
    RETURNING request_no
  `);
  return Number((rows as any[])[0].request_no);
}

async function readRow(no: number): Promise<any> {
  const { rows } = await db.execute(sql`
    SELECT status, etd_booked_at, etd_reference, etd_error, claimed_at, claimed_by
    FROM vrm_rental_request WHERE request_no = ${no}
  `);
  return (rows as any[])[0];
}

async function requestIdFor(no: number): Promise<string> {
  const { rows } = await db.execute(sql`
    SELECT id::text AS id FROM vrm_rental_request WHERE request_no = ${no}
  `);
  return String((rows as any[])[0]?.id ?? "");
}

async function seedLegacyLiveIntentForRequest(
  no: number,
  ldap: string,
  outcome?: string | null,
  sourceId = String(no),
): Promise<number> {
  const { rows } = await db.execute(sql`
    INSERT INTO vrm_rental_workflow_intents
      (workflow_type, source_id, source_revision, execution_mode, ldap, status,
       reservation_state, block_state)
    VALUES
      (${WORKFLOW_REQUEST}, ${sourceId}, 0, 'live', ${ldap}, 'created',
       'pending', 'not_applicable')
    RETURNING id
  `);
  const id = Number((rows as any[])[0].id);
  if (outcome !== undefined) {
    await db.execute(sql`
      INSERT INTO vrm_workflow_attempts
        (intent_id, phase, attempt_no, fencing_token, outcome, finished_at)
      VALUES
        (${id}, 'etd_booking', 1, 0, ${outcome},
         ${outcome == null ? null : sql`now()`})
    `);
  }
  return id;
}

async function readIntentStatus(id: number): Promise<string> {
  const { rows } = await db.execute(sql`
    SELECT status FROM vrm_rental_workflow_intents WHERE id = ${id}
  `);
  return String((rows as any[])[0]?.status ?? "");
}

async function postDecision(no: number, body: Record<string, unknown>): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${B}/${no}/decide`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

async function waitFor(check: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(message);
}

async function waitForRow(
  no: number,
  check: (row: any) => boolean,
  message: string,
): Promise<any> {
  const deadline = Date.now() + 5_000;
  let latest: any = null;
  while (Date.now() < deadline) {
    latest = await readRow(no);
    if (check(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`${message}; latest=${JSON.stringify(latest)}`);
}

async function decideExtensionWithLiveEmailOff(
  no: number,
  body: Record<string, unknown>,
): Promise<{ status: number; json: any }> {
  const priorLive = process.env.RENTAL_EXTENSION_EMAIL_LIVE;
  process.env.RENTAL_EXTENSION_EMAIL_LIVE = "false";
  let status = -1;
  let senderSettled = false;
  try {
    const res = await fetch(`${baseUrl}${B}/${no}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    status = res.status;
    const json = await res.json() as any;

    if (status === 200) {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const { rows } = await db.execute(sql`
          SELECT ext_email_state
          FROM vrm_rental_request
          WHERE request_no = ${no}
        `);
        if ((rows as any[])[0]?.ext_email_state === "dry_run") {
          senderSettled = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(senderSettled, true, "the disabled extension-email sender must settle before restoring its flag");
    }
    return { status, json };
  } finally {
    // If a 200 sender did not settle, keep live email disabled for the rest of
    // this test process rather than racing a late external send.
    if (status !== 200 || senderSettled) {
      if (priorLive === undefined) delete process.env.RENTAL_EXTENSION_EMAIL_LIVE;
      else process.env.RENTAL_EXTENSION_EMAIL_LIVE = priorLive;
    }
  }
}

before(async () => {
  await initFormsSchema(); // IF NOT EXISTS everywhere
  await cleanupFixtures();

  const app = express();
  app.use(express.json());
  app.post("/api/fs/comms/api/send-batch", (req, res) => {
    smsCalls.push(req.body);
    res.json({
      results: (req.body?.messages ?? []).map(() => ({ status: "sent" })),
    });
  });
  const router = express.Router();
  registerRentalRequestAdminRoutes(router);
  app.use("/api/vrm", router);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
  process.env.COMMS_SEND_API_KEY = "test-only";
  process.env.COMMS_SEND_BASE_URL = baseUrl;
  process.env.RENTAL_EXTENSION_EMAIL_LIVE = "false";
});

after(async () => {
  server?.close();
  await cleanupFixtures().catch(() => {});
  await pool.end().catch(() => {});
  const { fsPool } = await import("../server/fleet-scope-db");
  await fsPool.end().catch(() => {});
});

// ---------------------------------------------------------------------------

describe("legacy rental-request booking routes are absent", () => {
  test("booking queue, manual book, and runner writeback all fall through to 404", async () => {
    // Use a real row for the parameterized routes: a missing row can also
    // produce a handler-owned 404 and would not prove the route is absent.
    const no = await insertRequest({
      ldap: `${LDAP_PREFIX}D1`,
      request_type: "extension",
      status: "approved",
    });
    const probes = [
      fetch(`${baseUrl}${B}/booking-queue`),
      fetch(`${baseUrl}${B}/${no}/book`, { method: "POST" }),
      fetch(`${baseUrl}${B}/${no}/booked`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "must never land" }),
      }),
    ];
    const responses = await Promise.all(probes);
    assert.deepEqual(
      responses.map((res) => res.status),
      [404, 404, 404],
      "all three legacy booking doors must be unregistered, not guarded handlers",
    );
  });
});

describe("release-booking identity compatibility", () => {
  test("releasing a UUID-keyed reservation cancels its intent and frees the live lock", async () => {
    const ldap = `${LDAP_PREFIX}RC`;
    const no = await insertRequest({
      ldap,
      request_type: "new",
      status: "booked",
    });
    const requestId = await requestIdFor(no);
    await db.execute(sql`
      UPDATE vrm_rental_request
         SET etd_reference = 'ZZ-UUID-CANCEL-1',
             etd_booked_at = now()
       WHERE request_no = ${no}
    `);
    const intentId = await seedLegacyLiveIntentForRequest(no, ldap, undefined, requestId);
    await db.execute(sql`
      UPDATE vrm_rental_workflow_intents
         SET status = 'booking_unknown', reservation_state = 'unknown'
       WHERE id = ${intentId}
    `);

    const released = await fetch(`${baseUrl}${B}/${no}/release-booking`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cancelledReference: "ZZ-UUID-CANCEL-1",
        reason: "confirmed cancelled in Enterprise",
      }),
    });
    const body = await released.json() as any;
    assert.equal(released.status, 200, JSON.stringify(body));
    assert.equal((await readRow(no)).status, "pending");
    assert.equal(await readIntentStatus(intentId), "cancelled");

    const replacement = await db.execute(sql`
      INSERT INTO vrm_rental_workflow_intents
        (workflow_type, source_id, source_revision, execution_mode, ldap, status,
         reservation_state, block_state)
      VALUES
        (${WORKFLOW_REQUEST}, ${String(no)}, 0, 'live', ${ldap}, 'created',
         'pending', 'not_applicable')
      RETURNING id
    `);
    assert.equal(
      (replacement.rows as any[]).length,
      1,
      "cancellation must release the per-LDAP live-intent lock for a later approval",
    );
  });
});

// ---------------------------------------------------------------------------

describe("cutover-orchestrator createIntent safeguard", () => {
  test("an extension source throws extension_not_bookable BEFORE the eligibility gate; no intent row is left behind", async () => {
    const extNo = await insertRequest({ ldap: `${LDAP_PREFIX}I1`, request_type: "extension" });

    await assert.rejects(
      () => createIntent({ workflowType: WORKFLOW_REQUEST, sourceId: String(extNo), executionMode: "dry_run" }),
      (e: any) => {
        // The fixture is deliberately INELIGIBLE (no roster, no truck): getting
        // extension_not_bookable rather than eligibility_failed proves the
        // extension refusal fires first, from ANY caller, regardless of facts.
        assert.equal(e?.code, "extension_not_bookable",
          `expected extension_not_bookable, got ${e?.code}: ${e?.message}`);
        return true;
      },
    );

    const { rows } = await db.execute(sql`
      SELECT 1 FROM vrm_rental_workflow_intents
      WHERE workflow_type = ${WORKFLOW_REQUEST} AND source_id = ${String(extNo)}
    `);
    assert.equal((rows as any[]).length, 0, "no intent row may exist for the extension source");
  });
});

// ---------------------------------------------------------------------------

describe("type-aware liveRequestGuard semantics", () => {
  test("a BOOKED new request does not block an extension (it IS the rental being extended) but blocks a second new", async () => {
    const ldap = `${LDAP_PREFIX}G1`;
    await insertRequest({ ldap, request_type: "new", status: "booked" });

    const guard = await liveRequestGuard(ldap);
    assert.equal(guard.blockExtension, null, "booked new must NOT block the extension asking for more time on it");
    assert.ok(guard.blockNew, "booked new must still block a second new request");
  });

  test("a pending extension blocks a second extension AND a new request", async () => {
    const ldap = `${LDAP_PREFIX}G2`;
    const pendingNo = await insertRequest({ ldap, request_type: "extension", status: "pending" });

    const guard = await liveRequestGuard(ldap);
    assert.ok(guard.blockExtension, "a pending extension must block a second one");
    assert.equal(Number(guard.blockExtension!.requestNo), pendingNo);
    assert.ok(guard.blockNew, "a pending extension must block a new request too (one car conversation at a time)");
  });

  test("an APPROVED extension is settled — it never books, so it must not block next week's extension", async () => {
    const ldap = `${LDAP_PREFIX}G3`;
    await insertRequest({ ldap, request_type: "extension", status: "approved" });

    const guard = await liveRequestGuard(ldap);
    assert.equal(guard.blockExtension, null,
      "approved extension is handled manually by Fleet and must not block the next weekly extension");
  });

  test("a new request still pending/approved blocks an extension (nothing to extend yet)", async () => {
    const ldap = `${LDAP_PREFIX}G4`;
    const newNo = await insertRequest({ ldap, request_type: "new", status: "pending" });

    const guard = await liveRequestGuard(ldap);
    assert.ok(guard.blockExtension, "an in-flight new request means there is no rental to extend yet");
    assert.equal(Number(guard.blockExtension!.requestNo), newNo);
  });
});

describe("extension approval comment policy", () => {
  test("APPROVE may overrule REVIEW with a blank comment when the RA is present", async () => {
    const no = await insertRequest({
      ldap: `${LDAP_PREFIX}N1`,
      request_type: "extension",
      status: "pending",
    });
    await db.execute(sql`
      UPDATE vrm_rental_request
      SET auto_decision = 'REVIEW'
      WHERE request_no = ${no}
    `);

    const { status, json } = await decideExtensionWithLiveEmailOff(no, {
      decision: "APPROVE",
      note: "   ",
      reservationNumber: "ZZ-RA-1001",
      extensionDays: 7,
    });
    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.ok, true);

    const { rows } = await db.execute(sql`
      SELECT status, decision_note, ext_reservation_number
      FROM vrm_rental_request
      WHERE request_no = ${no}
    `);
    const row = (rows as any[])[0];
    assert.equal(row.status, "approved");
    assert.equal(row.decision_note, null, "a blank optional comment stays null in the audit row");
    assert.equal(row.ext_reservation_number, "ZZ-RA-1001");
  });

  test("a supplied extension approval comment remains in the audit row", async () => {
    const no = await insertRequest({
      ldap: `${LDAP_PREFIX}N2`,
      request_type: "extension",
      status: "pending",
    });
    await db.execute(sql`
      UPDATE vrm_rental_request
      SET auto_decision = 'REVIEW'
      WHERE request_no = ${no}
    `);

    const { status, json } = await decideExtensionWithLiveEmailOff(no, {
      decision: "APPROVE",
      note: "Confirmed with Enterprise",
      reservationNumber: "ZZ-RA-1002",
      extensionDays: 7,
    });
    assert.equal(status, 200, JSON.stringify(json));

    const { rows } = await db.execute(sql`
      SELECT decision_note
      FROM vrm_rental_request
      WHERE request_no = ${no}
    `);
    assert.equal((rows as any[])[0]?.decision_note, "Confirmed with Enterprise");
  });

  test("extension APPROVE still requires an Enterprise reservation / RA number", async () => {
    const no = await insertRequest({
      ldap: `${LDAP_PREFIX}N3`,
      request_type: "extension",
      status: "pending",
    });
    await db.execute(sql`
      UPDATE vrm_rental_request
      SET auto_decision = 'REVIEW'
      WHERE request_no = ${no}
    `);

    const res = await fetch(`${baseUrl}${B}/${no}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "APPROVE", note: "   " }),
    });
    const json = await res.json() as any;
    assert.equal(res.status, 400, JSON.stringify(json));
    assert.match(String(json.message), /reservation|RA number/i);
    assert.equal((await readRow(no)).status, "pending");
  });
});

describe("APPROVE replay idempotency", () => {
  test("Approve resumes a UUID-keyed clean-failure intent and the list shows its evidence", async () => {
    const ldap = `${LDAP_PREFIX}RU`;
    const no = await insertRequest({
      ldap,
      request_type: "new",
      status: "pending",
    });
    const requestId = await requestIdFor(no);
    const intentId = await seedLegacyLiveIntentForRequest(no, ldap, undefined, requestId);
    await db.execute(sql`
      UPDATE vrm_rental_workflow_intents
         SET status = 'preview_required',
             last_error = 'clean prior preview failure'
       WHERE id = ${intentId}
    `);
    await db.execute(sql`
      UPDATE vrm_rental_request
         SET etd_error = 'clean prior preview failure'
       WHERE request_no = ${no}
    `);

    const beforeList = await fetch(`${baseUrl}${B}/list`).then((r) => r.json()) as any;
    const beforeRow = beforeList.requests.find((row: any) => Number(row.request_no) === no);
    assert.equal(
      beforeRow?.intent_error,
      "clean prior preview failure",
      "the drawer/list must join historical UUID-keyed request intents",
    );

    const priorFlag = process.env.VRM_CONTRACT_BLOCK_ENABLED;
    process.env.VRM_CONTRACT_BLOCK_ENABLED = "1";
    try {
      const approve = await postDecision(no, { decision: "APPROVE", note: "" });
      assert.equal(approve.status, 200, JSON.stringify(approve.json));
      await waitForRow(
        no,
        (row) =>
          row.status === "pending"
          && !/intent_conflict|live nonterminal intent/i.test(String(row.etd_error ?? "")),
        "UUID-keyed clean failure was not resumed and returned to review",
      );
    } finally {
      if (priorFlag === undefined) delete process.env.VRM_CONTRACT_BLOCK_ENABLED;
      else process.env.VRM_CONTRACT_BLOCK_ENABLED = priorFlag;
    }

    const intents = (await db.execute(sql`
      SELECT id, source_id, status
        FROM vrm_rental_workflow_intents
       WHERE workflow_type = ${WORKFLOW_REQUEST}
         AND upper(ldap) = upper(${ldap})
       ORDER BY id
    `)).rows as any[];
    assert.equal(intents.length, 1, "Approve must not create a request-number duplicate");
    assert.equal(Number(intents[0].id), intentId, "the historical UUID intent must be the one resumed");
    assert.equal(String(intents[0].source_id), requestId);
    assert.equal(String(intents[0].status), "preview_required");
  });

  test("a failed intent lookup preserves the approved fence", async () => {
    const no = await insertRequest({
      ldap: `${LDAP_PREFIX}R8`,
      request_type: "new",
      status: "approved",
    });

    await autoBookApprovedRequestInner(no, {
      findLiveIntent: async () => {
        throw new Error("transient intent lookup failure");
      },
    });

    const row = await readRow(no);
    assert.equal(row.status, "approved", "an unavailable fence lookup must fail closed");
    assert.match(String(row.etd_error ?? ""), /intent lookup failure/i);

    const priorFlag = process.env.VRM_CONTRACT_BLOCK_ENABLED;
    process.env.VRM_CONTRACT_BLOCK_ENABLED = "false";
    try {
      const retry = await postDecision(no, { decision: "APPROVE", note: "" });
      assert.equal(retry.status, 200, JSON.stringify(retry.json));
      assert.equal(retry.json.idempotent, true, "the decision audit remains idempotent");
      await waitForRow(
        no,
        (next) => next.status === "pending" && /live intents are disabled/i.test(String(next.etd_error ?? "")),
        "the next explicit Approve did not safely re-drive the pre-intent failure",
      );
    } finally {
      if (priorFlag === undefined) delete process.env.VRM_CONTRACT_BLOCK_ENABLED;
      else process.env.VRM_CONTRACT_BLOCK_ENABLED = priorFlag;
    }
  });

  test("failure recovery serializes behind a competing ambiguous intent transaction", async () => {
    const ldap = `${LDAP_PREFIX}R9`;
    const no = await insertRequest({
      ldap,
      request_type: "new",
      status: "approved",
    });

    const competitor = await pool.connect();
    let recovery: Promise<void> | null = null;
    let recoverySettled = false;
    try {
      await competitor.query("BEGIN");
      await competitor.query(
        "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
        ["vrm-request-booking", String(no)],
      );
      await competitor.query(
        `INSERT INTO vrm_rental_workflow_intents
           (workflow_type, source_id, source_revision, execution_mode, ldap, status,
            reservation_state, block_state)
         VALUES ($1, $2, 0, 'live', $3, 'booking_unknown', 'unknown', 'not_applicable')`,
        [WORKFLOW_REQUEST, String(no), ldap],
      );

      recovery = autoBookApprovedRequestInner(no, {
        findLiveIntent: async () => null,
        createBookingIntent: async () => {
          throw new OrchestratorError(
            "eligibility_failed",
            "competing runner changed the booking facts",
            422,
          );
        },
      }).finally(() => {
        recoverySettled = true;
      });

      await new Promise((resolve) => setTimeout(resolve, 75));
      assert.equal(
        recoverySettled,
        false,
        "failure recovery must wait for the competing creator's transaction",
      );
      await competitor.query("COMMIT");
      await recovery;
    } finally {
      await competitor.query("ROLLBACK").catch(() => {});
      competitor.release();
      await recovery?.catch(() => {});
    }

    const row = await readRow(no);
    assert.equal(row.status, "approved", "a competing ambiguous intent must keep the source fenced");
    assert.match(String(row.etd_error ?? ""), /competing runner/i);
  });

  test("a pre-intent auto-book failure returns to review so Approve can safely try again", async () => {
    const no = await insertRequest({
      ldap: `${LDAP_PREFIX}R0`,
      request_type: "new",
      status: "pending",
    });
    const priorFlag = process.env.VRM_CONTRACT_BLOCK_ENABLED;
    process.env.VRM_CONTRACT_BLOCK_ENABLED = "false";
    try {
      const first = await postDecision(no, { decision: "APPROVE", note: "" });
      assert.equal(first.status, 200, JSON.stringify(first.json));
      assert.notEqual(first.json.idempotent, true);
      await waitForRow(
        no,
        (row) => row.status === "pending" && /live intents are disabled/i.test(String(row.etd_error ?? "")),
        "the first pre-intent refusal did not return the request to review",
      );

      const second = await postDecision(no, { decision: "APPROVE", note: "" });
      assert.equal(second.status, 200, JSON.stringify(second.json));
      assert.notEqual(second.json.idempotent, true, "review-to-approved must be a fresh approval edge");
      await waitForRow(
        no,
        (row) => row.status === "pending" && /live intents are disabled/i.test(String(row.etd_error ?? "")),
        "the second Approve did not run and safely return to review again",
      );

      const intents = ((await db.execute(sql`
        SELECT count(*)::int AS n
          FROM vrm_rental_workflow_intents
         WHERE workflow_type = ${WORKFLOW_REQUEST}
           AND source_id = ${String(no)}
      `)).rows as any[])[0];
      assert.equal(intents.n, 0, "a failure before intent creation must leave no booking door or duplicate risk");
    } finally {
      if (priorFlag === undefined) delete process.env.VRM_CONTRACT_BLOCK_ENABLED;
      else process.env.VRM_CONTRACT_BLOCK_ENABLED = priorFlag;
    }
  });

  test("sequential extension APPROVE replay preserves the first audit and sends one SMS", async () => {
    const no = await insertRequest({
      ldap: `${LDAP_PREFIX}R1`,
      request_type: "extension",
      status: "pending",
      mobile_phone: "5555550131",
    });
    const beforeSms = smsCalls.length;
    const first = await postDecision(no, {
      decision: "APPROVE",
      note: "first approval",
      reservationNumber: "ZZ-RA-REPLAY-1",
      extensionDays: 7,
    });
    assert.equal(first.status, 200, JSON.stringify(first.json));
    await waitFor(() => smsCalls.length === beforeSms + 1, "first approval SMS was not accepted");
    const firstRow = ((await db.execute(sql`
      SELECT decided_by, decided_at, decision_note, approval_sms_body,
             ext_reservation_number, ext_days
        FROM vrm_rental_request
       WHERE request_no = ${no}
    `)).rows as any[])[0];

    const replay = await postDecision(no, {
      decision: "APPROVE",
      note: "must not replace first audit",
      reservationNumber: "ZZ-RA-REPLAY-CHANGED",
      extensionDays: 14,
    });
    assert.equal(replay.status, 200, JSON.stringify(replay.json));
    assert.equal(replay.json.idempotent, true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(smsCalls.length, beforeSms + 1, "replayed approval must not send a second SMS");

    const afterRow = ((await db.execute(sql`
      SELECT decided_by, decided_at, decision_note, approval_sms_body,
             ext_reservation_number, ext_days
        FROM vrm_rental_request
       WHERE request_no = ${no}
    `)).rows as any[])[0];
    assert.deepEqual(afterRow, firstRow, "replayed approval must preserve the original decision audit and facts");
  });

  test("concurrent extension APPROVE calls produce one transition and one SMS", async () => {
    const no = await insertRequest({
      ldap: `${LDAP_PREFIX}R2`,
      request_type: "extension",
      status: "pending",
      mobile_phone: "5555550132",
    });
    const beforeSms = smsCalls.length;
    const body = {
      decision: "APPROVE",
      note: "concurrent approval",
      reservationNumber: "ZZ-RA-REPLAY-2",
      extensionDays: 7,
    };
    const replies = await Promise.all([postDecision(no, body), postDecision(no, body)]);
    assert.deepEqual(replies.map((r) => r.status), [200, 200]);
    assert.equal(replies.filter((r) => r.json.idempotent === true).length, 1);
    await waitFor(() => smsCalls.length === beforeSms + 1, "concurrent approval SMS did not settle");
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(smsCalls.length, beforeSms + 1, "concurrent approval must send exactly one SMS");
  });

  test("APPROVE replay cannot move or execute an ambiguous new-request intent", async () => {
    const ldap = `${LDAP_PREFIX}R3`;
    const no = await insertRequest({
      ldap,
      request_type: "new",
      status: "approved",
      mobile_phone: "5555550133",
    });
    await db.execute(sql`
      UPDATE vrm_rental_request
         SET decided_by = 'first-approver',
             decided_at = now() - interval '5 minutes',
             decision_note = 'first audit'
       WHERE request_no = ${no}
    `);
    const intentId = await seedLegacyLiveIntentForRequest(no, ldap);
    await db.execute(sql`
      UPDATE vrm_rental_workflow_intents
         SET status = 'booking_unknown', reservation_state = 'unknown'
       WHERE id = ${intentId}
    `);
    const beforeSms = smsCalls.length;

    const replay = await postDecision(no, {
      decision: "APPROVE",
      note: "must not run",
      pickupAt: new Date(Date.now() + 86_400_000).toISOString().slice(0, 16),
    });
    assert.equal(replay.status, 200, JSON.stringify(replay.json));
    assert.equal(replay.json.idempotent, true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(smsCalls.length, beforeSms, "ambiguous replay must not send approval SMS");
    assert.equal(await readIntentStatus(intentId), "booking_unknown");
    const attempts = ((await db.execute(sql`
      SELECT count(*)::int AS n
        FROM vrm_workflow_attempts
       WHERE intent_id = ${intentId}
    `)).rows as any[])[0];
    assert.equal(attempts.n, 0, "ambiguous replay must not start a booking attempt");
    const row = ((await db.execute(sql`
      SELECT decided_by, decision_note FROM vrm_rental_request WHERE request_no = ${no}
    `)).rows as any[])[0];
    assert.equal(row.decided_by, "first-approver");
    assert.equal(row.decision_note, "first audit");
  });
});

describe("routine decision notes are optional despite engine disagreement", () => {
  for (const [decision, autoDecision, expectedStatus, suffix] of [
    ["DENY", "APPROVE", "denied", "N4"],
    ["DEFER", "DENY", "deferred", "N5"],
  ] as const) {
    test(`${decision} accepts a blank note when the engine said ${autoDecision}`, async () => {
      const no = await insertRequest({
        ldap: `${LDAP_PREFIX}${suffix}`,
        request_type: "new",
        status: "pending",
      });
      await db.execute(sql`
        UPDATE vrm_rental_request
        SET auto_decision = ${autoDecision}
        WHERE request_no = ${no}
      `);

      const res = await fetch(`${baseUrl}${B}/${no}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note: "   " }),
      });
      const json = await res.json() as any;
      assert.equal(res.status, 200, JSON.stringify(json));

      const { rows } = await db.execute(sql`
        SELECT status, decision_note
        FROM vrm_rental_request
        WHERE request_no = ${no}
      `);
      assert.equal((rows as any[])[0]?.status, expectedStatus);
      assert.equal((rows as any[])[0]?.decision_note, null);
    });
  }
});

/**
 * VOID — the administrative eraser for an extension that entered the queue
 * incorrectly (e.g. filed by a Holman-book-only tech who needs the cutover
 * first). Pins the four facts that make it safe:
 *   1. it is extension-only and note-mandatory (server-enforced, not just UI);
 *   2. it closes the row SILENTLY — no SMS, no Enterprise email state;
 *   3. a voided row blocks nothing — the tech can file again;
 *   4. a voided row never displaces a BOOKED request in the shared
 *      new-system standing predicate (which picks the LATEST non-denied row —
 *      without the exclusion a fresh void would flip 'booked' to 'none').
 */
describe("VOID decision on extension requests", () => {
  test("VOID closes an extension silently: status voided, note stamped, nothing sent", async () => {
    const no = await insertRequest({ ldap: `${LDAP_PREFIX}V1`, request_type: "extension", status: "pending" });
    const res = await fetch(`${baseUrl}${B}/${no}/decide`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "VOID", note: "Holman-billed only — needs the cutover first" }),
    });
    assert.equal(res.status, 200);
    const { rows } = await db.execute(sql`
      SELECT status, decision_note, decided_at, ext_email_state, approval_sms_body
      FROM vrm_rental_request WHERE request_no = ${no}
    `);
    const row = (rows as any[])[0];
    assert.equal(row.status, "voided");
    assert.equal(row.decision_note, "Holman-billed only — needs the cutover first");
    assert.ok(row.decided_at, "the decision must be stamped for the audit trail");
    assert.equal(row.ext_email_state, null, "voiding must never touch the Enterprise email");
    assert.equal(row.approval_sms_body ?? null, null, "voiding must never write an SMS body");
  });

  test("VOID abandons a harmless legacy nonterminal intent instead of stranding its lock", async () => {
    const ldap = `${LDAP_PREFIX}V8`;
    const no = await insertRequest({ ldap, request_type: "extension", status: "pending" });
    const intentId = await seedLegacyLiveIntentForRequest(no, ldap);

    const res = await fetch(`${baseUrl}${B}/${no}/decide`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "VOID", note: "legacy duplicate" }),
    });
    assert.equal(res.status, 200);
    assert.equal((await readRow(no)).status, "voided");
    assert.equal(await readIntentStatus(intentId), "abandoned");
  });

  test("VOID fails closed when a legacy intent has an open booking attempt", async () => {
    const ldap = `${LDAP_PREFIX}V9`;
    const no = await insertRequest({ ldap, request_type: "extension", status: "pending" });
    const intentId = await seedLegacyLiveIntentForRequest(no, ldap, null);

    const res = await fetch(`${baseUrl}${B}/${no}/decide`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "VOID", note: "legacy duplicate" }),
    });
    const json = await res.json() as any;
    assert.equal(res.status, 409, JSON.stringify(json));
    assert.match(String(json.message), /manual review/i);
    assert.equal((await readRow(no)).status, "pending", "ambiguous evidence must keep the source row visible");
    assert.equal(await readIntentStatus(intentId), "created", "ambiguous evidence keeps the live lock");
  });

  test("VOID refuses a NEW request — deny/send-back are the real doors there", async () => {
    const no = await insertRequest({ ldap: `${LDAP_PREFIX}V2`, request_type: "new", status: "pending" });
    const res = await fetch(`${baseUrl}${B}/${no}/decide`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "VOID", note: "wrong door" }),
    });
    assert.equal(res.status, 400);
    const row = await readRow(no);
    assert.equal(row.status, "pending", "a refused VOID must leave the row untouched");
  });

  test("VOID refuses a blank note — a silently vanished request needs a recorded why", async () => {
    const no = await insertRequest({ ldap: `${LDAP_PREFIX}V3`, request_type: "extension", status: "pending" });
    const res = await fetch(`${baseUrl}${B}/${no}/decide`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "VOID", note: "   " }),
    });
    assert.equal(res.status, 400);
    assert.equal((await readRow(no)).status, "pending");
  });

  test("a voided extension blocks NOTHING — the tech can file again immediately", async () => {
    const ldap = `${LDAP_PREFIX}V4`;
    await insertRequest({ ldap, request_type: "extension", status: "voided" });
    const guard = await liveRequestGuard(ldap);
    assert.equal(guard.blockExtension, null, "voided must not block the corrected re-file");
    assert.equal(guard.blockNew, null, "voided must not block a new request either");
  });

  test("VOID refuses an already-APPROVED extension — the Enterprise email may be in flight", async () => {
    const no = await insertRequest({ ldap: `${LDAP_PREFIX}V6`, request_type: "extension", status: "approved" });
    const res = await fetch(`${baseUrl}${B}/${no}/decide`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "VOID", note: "changed my mind" }),
    });
    assert.equal(res.status, 409);
    const { rows } = await db.execute(sql`
      SELECT status, ext_email_state FROM vrm_rental_request WHERE request_no = ${no}
    `);
    assert.equal((rows as any[])[0].status, "approved",
      "the refusal must leave the approved row exactly as it was");
  });

  test("voided rows disappear from the /stats KPIs (frozen auto_decision must not count forever)", async () => {
    const read = async () => {
      const r = await fetch(`${baseUrl}${B}/stats`);
      assert.equal(r.status, 200);
      return r.json();
    };
    const beforeStats = await read();
    await insertRequest({ ldap: `${LDAP_PREFIX}V7`, request_type: "extension", status: "voided" });
    const afterStats = await read();
    assert.equal(Number(afterStats.total), Number(beforeStats.total),
      "a voided row must not move the total");
    assert.equal(Number(afterStats.needs_review ?? 0), Number(beforeStats.needs_review ?? 0),
      "a voided row must not sit in 'needs review' forever");
  });

  test("a voided extension never displaces a BOOKED request in the standing predicate", async () => {
    const ldap = `${LDAP_PREFIX}V5`;
    const bookedNo = await insertRequest({ ldap, request_type: "new", status: "booked" });
    await db.execute(sql`
      UPDATE vrm_rental_request
      SET etd_reference = 'ZZVOIDREF1', created_at = now() - interval '1 hour'
      WHERE request_no = ${bookedNo}
    `);
    // The wrongly-filed extension arrives LATER — without the voided
    // exclusion it becomes the "latest non-denied" row and flips the
    // standing to none, hiding a real reservation from the Holman queue
    // badge and the denial SMS branch.
    await insertRequest({ ldap, request_type: "extension", status: "voided" });
    const standing = await getDirectBillingStandingForLdap(ldap);
    assert.equal(standing.standing, "booked");
    assert.equal(standing.etdReference, "ZZVOIDREF1");
  });
});

/**
 * RA prefill for extension approvals (pure — the drawer's candidate list).
 *
 * The approve gate stays untouched (blank still blocks); these pin WHAT the
 * drawer offers: the direct-billing book's RA first, our booked reservation
 * second, nothing from non-booked standings, and no duplicates.
 */
describe("extension RA prefill candidates (raCandidatesFromCheck)", () => {
  test("direct-billing RA comes first, booked reservation second, with provenance", () => {
    const cands = raCandidatesFromCheck({
      standing: "booked",
      etdReference: "1J2K3L",
      directCases: [{ source: "enterprise_direct", ticketNumber: "884422", vehicleNumber: "021093", rentalStartDate: "2026-08-12" }],
    });
    assert.equal(cands.length, 2);
    assert.deepEqual(cands.map((c) => [c.number, c.source]), [["884422", "direct"], ["1J2K3L", "booked"]]);
    assert.match(cands[0].label, /direct-billing/i);
    assert.match(cands[0].label, /021093/);
    assert.match(cands[0].label, /2026-08-12/);
  });

  test("a non-booked standing NEVER offers its etd reference (failed/released cutover rows)", () => {
    for (const standing of ["none", "unavailable", "", undefined]) {
      const cands = raCandidatesFromCheck({ standing: standing as any, etdReference: "STALE1" });
      assert.equal(cands.length, 0, `standing=${String(standing)} must offer nothing`);
    }
  });

  test("blank/whitespace ticket numbers are skipped; duplicates collapse case-insensitively", () => {
    const cands = raCandidatesFromCheck({
      standing: "booked",
      etdReference: "ra100",
      directCases: [
        { ticketNumber: "  " },
        { ticketNumber: null },
        { ticketNumber: "RA100", vehicleNumber: "88123" },
        { ticketNumber: "RA100" },
      ],
    });
    // The direct-book sighting wins the slot; the identical booked reference dedupes away.
    assert.equal(cands.length, 1);
    assert.equal(cands[0].number, "RA100");
    assert.equal(cands[0].source, "direct");
  });

  test("no check at all (row without a billing check) offers nothing", () => {
    assert.deepEqual(raCandidatesFromCheck(null), []);
    assert.deepEqual(raCandidatesFromCheck(undefined), []);
    assert.deepEqual(raCandidatesFromCheck({}), []);
  });

  test("two open direct cases (rare, but real after a truck swap) both surface, newest data intact", () => {
    const cands = raCandidatesFromCheck({
      directCases: [
        { ticketNumber: "111222", vehicleNumber: "021093" },
        { ticketNumber: "333444", rentalStartDate: "2026-07-01" },
      ],
    });
    assert.deepEqual(cands.map((c) => c.number), ["111222", "333444"]);
    assert.equal(cands.every((c) => c.source === "direct"), true);
  });
});
