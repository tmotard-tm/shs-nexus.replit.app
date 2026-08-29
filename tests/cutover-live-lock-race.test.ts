/**
 * createIntent must reclaim a deleted request's harmless live-lock owner
 * before inserting the replacement intent, without weakening the one-live-
 * workflow safety rule.
 *
 * Reclaim is deliberately evidence-gated:
 *   - the source request must truly be gone;
 *   - reservation_state must prove no booking exists;
 *   - every attempt must prove no external effect can be in flight.
 *
 * Open or unknown attempts fail closed for manual review, and a legitimate
 * live intent whose source request still exists keeps the lock.
 *
 * VRM_CONTRACT_BLOCK_ENABLED is armed IN-PROCESS only (node --test runs each
 * file in its own child process): the live lock only exists for
 * execution_mode='live', and live intents cannot be created while disarmed.
 * createIntent's insert is the only external effect at creation time — no
 * ETD, no ART, no Twilio runs until preview/booking.
 *
 * Every process gets its own ZZ<run>L namespace and deletes only that namespace.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { sql } from "drizzle-orm";

import { db, pool } from "../server/db";
import { initFormsSchema } from "../server/vrm/forms/schema";
import {
  WORKFLOW_REQUEST,
  createIntent,
  OrchestratorError,
} from "../server/vrm/forms/cutover-orchestrator";
import * as cutoverOrchestrator from "../server/vrm/forms/cutover-orchestrator";

const RUN_ID = crypto.randomBytes(4).toString("hex").toUpperCase();
const LDAP_PREFIX = `ZZ${RUN_ID}L`;
const EMPLOYEE_PREFIX = crypto.randomBytes(4).toString("hex").toUpperCase();
const FLAG = "VRM_CONTRACT_BLOCK_ENABLED";

let savedFlag: string | undefined;

async function cleanupFixtures() {
  await db.execute(sql`
    DELETE FROM vrm_rental_workflow_intents
    WHERE upper(ldap) LIKE ${LDAP_PREFIX + "%"}
       OR source_id IN (SELECT request_no::text FROM vrm_rental_request WHERE upper(ldap) LIKE ${LDAP_PREFIX + "%"})
  `);
  await db.execute(sql`DELETE FROM vrm_rental_request WHERE upper(ldap) LIKE ${LDAP_PREFIX + "%"}`);
  await db.execute(sql`DELETE FROM vrm_form_tokens WHERE upper(ldap) LIKE ${LDAP_PREFIX + "%"}`);
  await db.execute(sql`DELETE FROM all_techs WHERE upper(tech_racfid) LIKE ${LDAP_PREFIX + "%"}`);
}

/** A fully ELIGIBLE approved request: active roster row with a district, and
 *  the request's own mobile_phone as the contact fallback. Everything the
 *  request-lane eligibility gate checks, so createIntent reaches the INSERT. */
async function seedEligibleRequest(ldap: string, employeeId: string): Promise<number> {
  await db.execute(sql`
    INSERT INTO all_techs (employee_id, tech_racfid, tech_name, employment_status, district_no, job_title)
    VALUES (${employeeId}, ${ldap}, 'Zz Live Lock Fixture', 'A', '9931', 'Service Technician')
    ON CONFLICT (employee_id) DO NOTHING
  `);
  const { rows } = await db.execute(sql`
    INSERT INTO vrm_rental_request (ldap, tech_name, request_type, status, home_state, mobile_phone)
    VALUES (${ldap}, 'Zz Live Lock Fixture', 'new', 'approved', 'PA', '555-000-1234')
    RETURNING request_no
  `);
  return Number((rows as any[])[0].request_no);
}

async function requestIdFor(no: number): Promise<string> {
  const { rows } = await db.execute(sql`
    SELECT id FROM vrm_rental_request WHERE request_no = ${no}
  `);
  return String((rows as any[])[0].id);
}

/** A LIVE nonterminal intent whose rental_request source does not exist. */
async function seedOrphanLiveIntent(
  ldap: string,
  over: { reservationState?: string; reservationEvidence?: Record<string, unknown> | null } = {},
): Promise<number> {
  const { rows } = await db.execute(sql`
    INSERT INTO vrm_rental_workflow_intents
      (workflow_type, source_id, source_revision, execution_mode, ldap, status,
       reservation_state, reservation_evidence)
    VALUES
      (${WORKFLOW_REQUEST}, ${crypto.randomUUID()}, 0, 'live', ${ldap}, 'created',
       ${over.reservationState ?? "pending"},
       ${over.reservationEvidence ? JSON.stringify(over.reservationEvidence) : null}::jsonb)
    RETURNING id
  `);
  return Number((rows as any[])[0].id);
}

async function seedBookingAttempt(intentId: number, outcome: string | null): Promise<void> {
  await db.execute(sql`
    INSERT INTO vrm_workflow_attempts
      (intent_id, phase, attempt_no, fencing_token, outcome, finished_at)
    VALUES
      (${intentId}, 'etd_booking', 1, 0, ${outcome},
       ${outcome == null ? null : sql`now()`})
  `);
}

async function intentCountFor(ldap: string): Promise<number> {
  const { rows } = await db.execute(sql`
    SELECT count(*)::int AS n FROM vrm_rental_workflow_intents WHERE upper(ldap) = ${ldap.toUpperCase()}
  `);
  return Number((rows as any[])[0].n);
}

async function readIntent(id: number): Promise<any> {
  const { rows } = await db.execute(sql`
    SELECT id, status, reservation_state, last_error
    FROM vrm_rental_workflow_intents
    WHERE id = ${id}
  `);
  return (rows as any[])[0];
}

async function sourceIdForIntent(id: number): Promise<string> {
  const { rows } = await db.execute(sql`
    SELECT source_id
    FROM vrm_rental_workflow_intents
    WHERE id = ${id}
  `);
  return String((rows as any[])[0].source_id);
}

before(async () => {
  await initFormsSchema(); // IF NOT EXISTS everywhere
  await cleanupFixtures();
  // Arm live mode for THIS test process only: the live nonterminal lock is
  // execution_mode='live'-scoped, and disarmed createIntent refuses live.
  savedFlag = process.env[FLAG];
  process.env[FLAG] = "1";
});

after(async () => {
  if (savedFlag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = savedFlag;
  await cleanupFixtures().catch(() => {});
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS vrm_rental_request_token_uniq
      ON vrm_rental_request (token_id) WHERE token_id IS NOT NULL
  `).catch(() => {});
  await pool.end().catch(() => {});
  const { fsPool } = await import("../server/fleet-scope-db");
  await fsPool.end().catch(() => {});
});

// ---------------------------------------------------------------------------

describe("deleted-request live-lock recovery in createIntent", () => {
  test("explicit recovery audits each named intent, retires only proven-clean orphans, and leaves ambiguity locked", async () => {
    const recoverDeletedRequestLiveLocks = (cutoverOrchestrator as any).recoverDeletedRequestLiveLocks;
    assert.equal(
      typeof recoverDeletedRequestLiveLocks,
      "function",
      "the explicit, audited orphan-recovery API must exist",
    );

    const cleanId = await seedOrphanLiveIntent(`${LDAP_PREFIX}A1`);
    const ambiguousId = await seedOrphanLiveIntent(`${LDAP_PREFIX}A2`);
    const unlistedId = await seedOrphanLiveIntent(`${LDAP_PREFIX}A3`);
    await seedBookingAttempt(ambiguousId, "timeout");

    const sourceLdap = `${LDAP_PREFIX}A4`;
    const sourceNo = await seedEligibleRequest(sourceLdap, `${EMPLOYEE_PREFIX}E1`);
    const sourceIntent = await createIntent({
      workflowType: WORKFLOW_REQUEST,
      sourceId: String(sourceNo),
      executionMode: "live",
      createdBy: "zzllk-test",
    });
    const sourceIntentId = Number(sourceIntent.intent.id);

    const audit = await recoverDeletedRequestLiveLocks({
      intentIds: [cleanId, ambiguousId, sourceIntentId],
      recoveredBy: "zzllk-test",
      reason: "explicit orphan recovery regression",
    });

    assert.deepEqual(audit.map((row) => row.intentId), [cleanId, ambiguousId, sourceIntentId]);

    const clean = audit[0];
    assert.equal(clean.decision, "retired");
    assert.equal(clean.reason, "source request is absent and all booking evidence is proven clean");
    assert.equal(clean.before?.status, "created");
    assert.equal(clean.before?.reservationState, "pending");
    assert.equal(clean.before?.lastError, null);
    assert.deepEqual(clean.before?.attempts, []);
    assert.equal(clean.after?.status, "abandoned");
    assert.equal(
      clean.after?.lastError,
      "explicit recovery by zzllk-test: source request "
        + `${clean.sourceId} no longer exists; explicit orphan recovery regression`,
    );

    const ambiguous = audit[1];
    assert.equal(ambiguous.decision, "manual_review");
    assert.match(ambiguous.reason, /unknown outcome timeout/i);
    assert.equal(ambiguous.before?.status, "created");
    assert.equal(ambiguous.after?.status, "created");
    assert.equal(ambiguous.after?.attempts[0]?.outcome, "timeout");

    const sourcePresent = audit[2];
    assert.equal(sourcePresent.decision, "source_present");
    assert.match(sourcePresent.reason, /still exists/i);
    assert.equal(sourcePresent.before?.status, "created");
    assert.equal(sourcePresent.after?.status, "created");

    assert.equal((await readIntent(unlistedId)).status, "created", "unnamed rows must never be bulk-retired");
  });

  test("a source recreation cannot land between the absence read and retirement", async () => {
    const ldap = `${LDAP_PREFIX}A5`;
    const intentId = await seedOrphanLiveIntent(ldap);
    const sourceId = await sourceIdForIntent(intentId);
    let hookRan = false;
    let rivalSettled = false;
    let rivalInsert: Promise<unknown> | null = null;

    const audit = await (cutoverOrchestrator as any).recoverDeletedRequestLiveLocks({
      intentIds: [intentId],
      recoveredBy: "zzllk-race-test",
      reason: "source recreation serialization regression",
    }, {
      afterSourceAbsenceRead: async () => {
        hookRan = true;
        rivalInsert = db.execute(sql`
          INSERT INTO vrm_rental_request
            (id, ldap, tech_name, request_type, status, home_state, mobile_phone)
          VALUES
            (${sourceId}, ${ldap}, 'Zz Live Lock Fixture', 'new', 'approved', 'PA', '555-000-1234')
        `).finally(() => {
          rivalSettled = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 75));
        assert.equal(
          rivalSettled,
          false,
          "request-table serialization must hold a concurrent source insert until retirement commits",
        );
      },
    });

    assert.equal(hookRan, true, "the race seam must run after the negative source read");
    assert.equal(audit[0]?.decision, "retired");
    await rivalInsert;
    assert.equal((await readIntent(intentId)).status, "abandoned");
    const { rows: recreated } = await db.execute(sql`
      SELECT id FROM vrm_rental_request WHERE id = ${sourceId}
    `);
    assert.equal((recreated as any[]).length, 1, "the rival insert proceeds only after recovery releases its lock");
  });

  test("control: the fixture passes the full eligibility gate and creates a LIVE intent", async () => {
    const ldap = `${LDAP_PREFIX}C1`;
    const no = await seedEligibleRequest(ldap, `${EMPLOYEE_PREFIX}E2`);

    const { intent, created } = await createIntent({
      workflowType: WORKFLOW_REQUEST,
      sourceId: String(no),
      executionMode: "live",
      createdBy: "zzllk-test",
    });
    assert.equal(created, true, "an identical fixture with no conflict must create cleanly");
    assert.equal(String(intent.execution_mode), "live");
    assert.equal(String(intent.status), "created");
  });

  test("an orphan with pending reservation state and no attempts is abandoned before the replacement intent is created", async () => {
    const ldap = `${LDAP_PREFIX}R1`;
    const no = await seedEligibleRequest(ldap, `${EMPLOYEE_PREFIX}E3`);
    const orphanId = await seedOrphanLiveIntent(ldap);
    assert.equal(await intentCountFor(ldap), 1);

    const { intent, created } = await createIntent({
      workflowType: WORKFLOW_REQUEST,
      sourceId: String(no),
      executionMode: "live",
      createdBy: "zzllk-test",
    });

    assert.equal(created, true);
    assert.notEqual(Number(intent.id), orphanId);
    const orphan = await readIntent(orphanId);
    assert.equal(orphan.status, "abandoned", "the missing source's harmless intent must release the live lock");
    assert.match(String(orphan.last_error), /source request.*no longer exists/i);
    assert.equal(await intentCountFor(ldap), 2, "history is retained: one abandoned orphan plus the replacement");
  });

  test("an orphan with an open or unknown booking attempt fails closed for manual review", async () => {
    for (const [suffix, outcome] of [["O", null], ["U", "timeout"]] as const) {
      const ldap = `${LDAP_PREFIX}R2${suffix}`;
      const no = await seedEligibleRequest(ldap, `${EMPLOYEE_PREFIX}${suffix}`);
      const orphanId = await seedOrphanLiveIntent(ldap);
      await seedBookingAttempt(orphanId, outcome);

      await assert.rejects(
        () =>
          createIntent({
            workflowType: WORKFLOW_REQUEST,
            sourceId: String(no),
            executionMode: "live",
            createdBy: "zzllk-test",
          }),
        (e: any) => {
          assert.ok(e instanceof OrchestratorError);
          assert.equal(e.code, "orphan_manual_review");
          assert.equal(e.httpStatus, 409);
          assert.match(String(e.message), /manual review/i);
          assert.equal(Number(e.extra?.intentId), orphanId);
          return true;
        },
      );

      assert.equal((await readIntent(orphanId)).status, "created", "ambiguous evidence must keep the lock");
      assert.equal(await intentCountFor(ldap), 1, "no replacement intent may be inserted over ambiguity");
    }
  });

  test("a legitimate active prior request is never mistaken for an orphan", async () => {
    const ldap = `${LDAP_PREFIX}R3`;
    const priorNo = await seedEligibleRequest(ldap, `${EMPLOYEE_PREFIX}E4`);
    const prior = await createIntent({
      workflowType: WORKFLOW_REQUEST,
      sourceId: String(priorNo),
      executionMode: "live",
      createdBy: "zzllk-test",
    });
    // Free the request-table open-door slot without deleting the source. The
    // workflow is still legitimately live and must keep its own stronger lock.
    await db.execute(sql`
      UPDATE vrm_rental_request SET status = 'returned' WHERE request_no = ${priorNo}
    `);
    const nextNo = await seedEligibleRequest(ldap, `${EMPLOYEE_PREFIX}E5`);

    await assert.rejects(
      () =>
        createIntent({
          workflowType: WORKFLOW_REQUEST,
          sourceId: String(nextNo),
          executionMode: "live",
          createdBy: "zzllk-test",
        }),
      (e: any) => {
        assert.equal(e?.code, "eligibility_failed");
        assert.ok(
          Array.isArray(e?.extra?.failures)
            && e.extra.failures.some((f: any) => f?.code === "intent_conflict"),
          `expected the legitimate live-intent gate, got ${JSON.stringify(e?.extra)}`,
        );
        return true;
      },
    );

    assert.equal((await readIntent(Number(prior.intent.id))).status, "created");
    assert.equal(await intentCountFor(ldap), 1);
  });

  test("UUID-backed request intents block while their source exists and reclaim only after it is deleted", async () => {
    const ldap = `${LDAP_PREFIX}R4`;
    const priorNo = await seedEligibleRequest(ldap, `${EMPLOYEE_PREFIX}E6`);
    const priorId = await requestIdFor(priorNo);
    const prior = await createIntent({
      workflowType: WORKFLOW_REQUEST,
      sourceId: priorId,
      executionMode: "live",
      createdBy: "zzllk-test",
    });
    await db.execute(sql`
      UPDATE vrm_rental_request SET status = 'returned' WHERE request_no = ${priorNo}
    `);
    const nextNo = await seedEligibleRequest(ldap, `${EMPLOYEE_PREFIX}E7`);

    await assert.rejects(
      () =>
        createIntent({
          workflowType: WORKFLOW_REQUEST,
          sourceId: String(nextNo),
          executionMode: "live",
          createdBy: "zzllk-test",
        }),
      (e: any) => {
        assert.equal(e?.code, "eligibility_failed");
        assert.ok(e?.extra?.failures?.some((f: any) => f?.code === "intent_conflict"));
        return true;
      },
    );
    assert.equal((await readIntent(Number(prior.intent.id))).status, "created");

    await db.execute(sql`DELETE FROM vrm_rental_request WHERE request_no = ${priorNo}`);
    const replacement = await createIntent({
      workflowType: WORKFLOW_REQUEST,
      sourceId: String(nextNo),
      executionMode: "live",
      createdBy: "zzllk-test",
    });

    assert.equal(replacement.created, true);
    assert.equal((await readIntent(Number(prior.intent.id))).status, "abandoned");
  });

  test("concurrent startup checks preserve duplicate sources for the explicit migration", async () => {
    const ldap = `${LDAP_PREFIX}S1`;
    const token = `zzllk-startup-${crypto.randomUUID()}`;
    const { rows: tokenRows } = await db.execute(sql`
      INSERT INTO vrm_form_tokens (token, form_type, ldap, tech_name, expires_at)
      VALUES (${token}, 'rental_request', ${ldap}, 'Zz Live Lock Fixture', now() + interval '1 day')
      RETURNING id
    `);
    const tokenId = String((tokenRows as any[])[0].id);

    // Recreate the pre-index legacy shape. Application startup must only report
    // it; the explicit migration owns repair and concurrent index creation.
    await db.execute(sql`DROP INDEX IF EXISTS vrm_rental_request_token_uniq`);
    const { rows: olderRows } = await db.execute(sql`
      INSERT INTO vrm_rental_request
        (token_id, ldap, tech_name, request_type, status, home_state, created_at)
      VALUES
        (${tokenId}::uuid, ${ldap}, 'Zz Live Lock Fixture', 'new', 'approved', 'PA',
         now() - interval '2 minutes')
      RETURNING request_no
    `);
    const olderNo = Number((olderRows as any[])[0].request_no);
    const { rows: newerRows } = await db.execute(sql`
      INSERT INTO vrm_rental_request
        (token_id, ldap, tech_name, request_type, status, home_state, created_at)
      VALUES
        (${tokenId}::uuid, ${ldap}, 'Zz Live Lock Fixture', 'new', 'approved', 'PA',
         now() - interval '1 minute')
      RETURNING request_no
    `);
    const newerNo = Number((newerRows as any[])[0].request_no);

    const { rows: intentRows } = await db.execute(sql`
      INSERT INTO vrm_rental_workflow_intents
        (workflow_type, source_id, source_revision, execution_mode, ldap, status, reservation_state)
      VALUES
        (${WORKFLOW_REQUEST}, ${String(olderNo)}, 0, 'live', ${ldap}, 'created', 'pending')
      RETURNING id
    `);
    const intentId = Number((intentRows as any[])[0].id);
    await seedBookingAttempt(intentId, "timeout");

    // Two instances may initialize the same database together during a deploy.
    await Promise.all([initFormsSchema(), initFormsSchema()]);

    const { rows: requestRows } = await db.execute(sql`
      SELECT request_no
      FROM vrm_rental_request
      WHERE token_id = ${tokenId}::uuid
      ORDER BY request_no
    `);
    assert.deepEqual(
      (requestRows as any[]).map((row) => Number(row.request_no)),
      [olderNo, newerNo],
      "startup must preserve both rows so deploy-time migration can audit the duplicate",
    );
    assert.notEqual(olderNo, newerNo);

    const intent = await readIntent(intentId);
    assert.equal(intent.status, "created", "ambiguous evidence must keep the live intent for manual review");
    const { rows: sourceRows } = await db.execute(sql`
      SELECT 1
      FROM vrm_rental_request
      WHERE request_no::text = (
        SELECT source_id FROM vrm_rental_workflow_intents WHERE id = ${intentId}
      )
    `);
    assert.equal((sourceRows as any[]).length, 1, "the ambiguous live intent must retain its source");

    const { rows: indexRows } = await db.execute(sql`
      SELECT 1 FROM pg_indexes
      WHERE schemaname = current_schema()
        AND indexname = 'vrm_rental_request_token_uniq'
    `);
    assert.equal((indexRows as any[]).length, 0, "startup must not build a potentially blocking index");
  });
});
