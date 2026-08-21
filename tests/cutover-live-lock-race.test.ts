/**
 * createIntent must answer a live-lock duplicate-key RACE with the friendly
 * 409 (live_lock_held), never a generic 500.
 *
 * The eligibility pre-check in fetchEligibilityFacts scans live nonterminal
 * intents by upper(ldap), but deliberately SKIPS a rental_request intent
 * whose source request no longer exists (the orphan-skip clause — intent #37
 * / AROTTER). The vrm_workflow_intents_live_nonterminal_uq partial index has
 * no such carve-out: it fires on ANY live nonterminal row for the LDAP. An
 * orphaned live intent is therefore invisible to the gate but still trips
 * the index at insert time — exactly the pre-check-passed / index-fired
 * shape of two concurrent creators, deterministically and without timing.
 *
 * That thrown error is drizzle-wrapped ("Failed query: <sql>"; the
 * constraint name lives only on e.cause), so the original handler matching
 * e.message never fired and the race surfaced as an unhandled rethrow → 500.
 * This suite pins the fixed handler (isUniqueViolationOn walks the cause
 * chain) against the REAL index.
 *
 * A control LDAP with an identical fixture and no conflicting intent proves
 * the fixture passes the full eligibility gate — so the race case's 409 can
 * only come from the index handler, never from eligibility_failed.
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

/** The conflicting row: a LIVE nonterminal intent for the same LDAP whose
 *  rental_request source does not exist. The orphan-skip clause hides it from
 *  the eligibility pre-check; the partial unique index still fires. */
async function seedOrphanLiveIntent(ldap: string): Promise<number> {
  const { rows } = await db.execute(sql`
    INSERT INTO vrm_rental_workflow_intents
      (workflow_type, source_id, source_revision, execution_mode, ldap, status)
    VALUES
      (${WORKFLOW_REQUEST}, ${crypto.randomUUID()}, 0, 'live', ${ldap}, 'created')
    RETURNING id
  `);
  return Number((rows as any[])[0].id);
}

async function intentCountFor(ldap: string): Promise<number> {
  const { rows } = await db.execute(sql`
    SELECT count(*)::int AS n FROM vrm_rental_workflow_intents WHERE upper(ldap) = ${ldap.toUpperCase()}
  `);
  return Number((rows as any[])[0].n);
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

describe("live-lock duplicate-key race in createIntent", () => {
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

  test("an orphaned live intent (invisible to the gate, visible to the index) surfaces as live_lock_held 409, not a rethrown 500", async () => {
    const ldap = `${LDAP_PREFIX}R1`;
    const no = await seedEligibleRequest(ldap, "ZZ731R1");
    await seedOrphanLiveIntent(ldap);
    assert.equal(await intentCountFor(ldap), 1);

    await assert.rejects(
      () =>
        createIntent({
          workflowType: WORKFLOW_REQUEST,
          sourceId: String(no),
          executionMode: "live",
          createdBy: "zzllk-test",
        }),
      (e: any) => {
        // The race answer, not the raw drizzle wrapper. A rethrow here would
        // be an Error whose message starts "Failed query:" with no code.
        assert.ok(e instanceof OrchestratorError, `expected OrchestratorError, got ${e?.constructor?.name}: ${e?.message}`);
        assert.equal(e.code, "live_lock_held", `expected live_lock_held, got ${e.code}: ${e.message}`);
        assert.equal(e.httpStatus, 409, "the race must answer 409, never a generic 500");
        assert.ok(
          !String(e.message).startsWith("Failed query:"),
          "the friendly message, not the drizzle wrapper",
        );
        return true;
      },
    );

    assert.equal(await intentCountFor(ldap), 1, "the violating insert must not leave a second row behind");
  });

  test("case-insensitive: a lowercase orphan holds the lock for the uppercase LDAP too (index is on upper(ldap))", async () => {
    const ldap = `${LDAP_PREFIX}R2`;
    const no = await seedEligibleRequest(ldap, "ZZ731R2");
    await seedOrphanLiveIntent(ldap.toLowerCase());

    await assert.rejects(
      () =>
        createIntent({
          workflowType: WORKFLOW_REQUEST,
          sourceId: String(no),
          executionMode: "live",
          createdBy: "zzllk-test",
        }),
      (e: any) => {
        assert.equal(e?.code, "live_lock_held", `expected live_lock_held, got ${e?.code}: ${e?.message}`);
        return true;
      },
    );
    assert.equal(await intentCountFor(ldap), 1);
  });
});
