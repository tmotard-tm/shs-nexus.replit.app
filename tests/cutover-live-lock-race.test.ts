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
 * Fixtures use ZZLLK* ldaps (distinct from the ZZEXT / ZZTOKX / ZZCUT
 * prefixes used by the sibling suites sharing this dev database) and are
 * deleted before/after.
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

const LDAP_PREFIX = "ZZLLK";
const FLAG = "VRM_CONTRACT_BLOCK_ENABLED";

let savedFlag: string | undefined;

async function cleanupFixtures() {
  await db.execute(sql`
    DELETE FROM vrm_rental_workflow_intents
    WHERE upper(ldap) LIKE ${LDAP_PREFIX + "%"}
       OR source_id IN (SELECT request_no::text FROM vrm_rental_request WHERE upper(ldap) LIKE ${LDAP_PREFIX + "%"})
  `);
  await db.execute(sql`DELETE FROM vrm_rental_request WHERE upper(ldap) LIKE ${LDAP_PREFIX + "%"}`);
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
  await pool.end().catch(() => {});
  const { fsPool } = await import("../server/fleet-scope-db");
  await fsPool.end().catch(() => {});
});

// ---------------------------------------------------------------------------

describe("deleted-request live-lock recovery in createIntent", () => {
  test("control: the fixture passes the full eligibility gate and creates a LIVE intent", async () => {
    const ldap = `${LDAP_PREFIX}C1`;
    const no = await seedEligibleRequest(ldap, "ZZ731C1");

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
    const no = await seedEligibleRequest(ldap, "ZZ731R1");
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
      const no = await seedEligibleRequest(ldap, `ZZ732${suffix}`);
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
    const priorNo = await seedEligibleRequest(ldap, "ZZ733A");
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
    const nextNo = await seedEligibleRequest(ldap, "ZZ733B");

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
    const priorNo = await seedEligibleRequest(ldap, "ZZ734A");
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
    const nextNo = await seedEligibleRequest(ldap, "ZZ734B");

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
});
