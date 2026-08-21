/**
 * The two attempt-ledger duplicate-key safety nets must FIRE, not rethrow.
 *
 * Both openBookingAttempt (etd_booking) and fileContractBlock (art_block)
 * insert an attempt row fenced by vrm_workflow_attempts_one_open_uq (partial
 * unique on (intent_id, phase) WHERE outcome IS NULL). Their catch blocks were
 * written to convert that 23505 into a designed recovery:
 *   - etd_booking: a 409 "unfinished_attempt" (reconcile via readback first)
 *   - art_block:   surrender the 'filing' claim back to block_state='retry'
 *
 * But drizzle wraps the pg error: the thrown error's message is
 * "Failed query: <sql>" and it has NO .code — the real 23505/.constraint live
 * only on e.cause. The original `e?.code === "23505" || /duplicate key/...`
 * checks therefore never matched and both recovery paths were dead code: the
 * race rethrew the raw wrapper (a generic 500 / a stranded 'filing' claim).
 *
 * This suite pins the fixed handlers (isUniqueViolation walks the cause
 * chain) against the REAL index, mirroring tests/cutover-live-lock-race's
 * technique: real fixtures, real DDL, and a deterministic injection into the
 * exact snapshot-race window via the beforeAttemptInsert test seam (the same
 * pattern as persistPreviewFromRunner's beforeFinalWrite).
 *
 * NO external system is touched: the etd_booking test never reaches a runner
 * call (opening the attempt IS the operation under test), and the art_block
 * test's insert is GUARANTEED to fail on the index, so fileContractBlock
 * returns before sendStandardActivity can POST. Nothing here arms
 * VRM_CONTRACT_BLOCK_ENABLED — the art_block fixture uses execution_mode
 * 'test', which passes the filing gates while dev stays dark.
 *
 * Fixtures use ZZALR* ldaps (distinct from ZZCUT / ZZLLK / ZZEXT / ZZTOKX
 * used by sibling suites sharing this dev database) and are deleted
 * before/after (attempt rows cascade with the intent).
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { sql } from "drizzle-orm";

import { db, pool } from "../server/db";
import { initFormsSchema } from "../server/vrm/forms/schema";
import {
  WORKFLOW_CUTOVER,
  fileContractBlock,
  openBookingAttempt,
  OrchestratorError,
} from "../server/vrm/forms/cutover-orchestrator";

const LDAP_PREFIX = "ZZALR";
const RUNNER = "zzalr-runner";
const TOKEN = 7;

async function cleanupFixtures() {
  // vrm_workflow_attempts rows cascade on intent delete.
  await db.execute(sql`
    DELETE FROM vrm_rental_workflow_intents WHERE upper(ldap) LIKE ${LDAP_PREFIX + "%"}
  `);
}

/** Intent holding an ACTIVE booking claim (runner + token + unexpired lease),
 *  so openBookingAttempt's CTE gate passes and execution reaches the INSERT. */
async function seedClaimedIntent(ldap: string): Promise<number> {
  const { rows } = await db.execute(sql`
    INSERT INTO vrm_rental_workflow_intents
      (workflow_type, source_id, source_revision, execution_mode, ldap, status,
       claimed_by, fencing_token, lease_expires_at, heartbeat_at)
    VALUES
      (${WORKFLOW_CUTOVER}, ${crypto.randomUUID()}, 0, 'dry_run', ${ldap}, 'confirmed',
       ${RUNNER}, ${TOKEN}, now() + interval '30 minutes', now())
    RETURNING id
  `);
  return Number((rows as any[])[0].id);
}

/** TEST-mode intent standing exactly at the ART filing boundary: complete
 *  block spec, dark-validated reservation, block pending. execution_mode
 *  'test' passes the dry_run short-circuit and the live kill switch without
 *  arming anything — the filing CAS and the ledger INSERT both run. */
async function seedFilingIntent(ldap: string): Promise<number> {
  const { rows } = await db.execute(sql`
    INSERT INTO vrm_rental_workflow_intents
      (workflow_type, source_id, source_revision, execution_mode, ldap, status,
       truck_number, event_date, reservation_state, block_state, preview)
    VALUES
      (${WORKFLOW_CUTOVER}, ${crypto.randomUUID()}, 0, 'test', ${ldap}, 'reservation_verified',
       '123456', '2026-08-17', 'dry_run_validated', 'pending',
       ${JSON.stringify({
         artBlock: { unit: "U-100", locationZip5: "60601", date: "2026-08-17" },
         reservation: { branchName: "Loop", branchAddress: "1 W Adams", branchZip: "60601" },
       })}::jsonb)
    RETURNING id
  `);
  return Number((rows as any[])[0].id);
}

/** The rival's write: an OPEN attempt inserted inside the snapshot-race
 *  window. The function under test's own INSERT must then trip
 *  vrm_workflow_attempts_one_open_uq — the real index, no mocks. */
async function insertOpenAttempt(intentId: number, phase: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO vrm_workflow_attempts (intent_id, phase, attempt_no, fencing_token, request)
    SELECT ${intentId}, ${phase}, COALESCE(MAX(attempt_no), 0) + 1, ${TOKEN}, '{}'::jsonb
    FROM vrm_workflow_attempts WHERE intent_id = ${intentId} AND phase = ${phase}
  `);
}

async function attemptRows(intentId: number, phase: string): Promise<any[]> {
  const { rows } = await db.execute(sql`
    SELECT attempt_no, outcome FROM vrm_workflow_attempts
    WHERE intent_id = ${intentId} AND phase = ${phase} ORDER BY attempt_no
  `);
  return rows as any[];
}

before(async () => {
  await initFormsSchema(); // IF NOT EXISTS everywhere — also builds the one-open index
  await cleanupFixtures();
});

after(async () => {
  await cleanupFixtures().catch(() => {});
  await pool.end().catch(() => {});
  const { fsPool } = await import("../server/fleet-scope-db");
  await fsPool.end().catch(() => {});
});

// ---------------------------------------------------------------------------

describe("etd_booking attempt-open race (openBookingAttempt)", () => {
  test("control: the claimed fixture passes the gate and opens attempt 1 cleanly", async () => {
    const id = await seedClaimedIntent(`${LDAP_PREFIX}C1`);
    const { attemptNo } = await openBookingAttempt(id, RUNNER, TOKEN, {});
    assert.equal(attemptNo, 1, "an identical fixture with no rival must open cleanly");
  });

  test("a rival open landing inside the race window surfaces as unfinished_attempt 409, not a rethrown 500", async () => {
    const id = await seedClaimedIntent(`${LDAP_PREFIX}R1`);

    await assert.rejects(
      () =>
        openBookingAttempt(id, RUNNER, TOKEN, {}, {
          // Fires AFTER the open-attempt pre-check, BEFORE the gated INSERT:
          // exactly the snapshot race the one-open index exists to close.
          beforeAttemptInsert: () => insertOpenAttempt(id, "etd_booking"),
        }),
      (e: any) => {
        // The designed race answer, not the raw drizzle wrapper. A rethrow
        // here is an Error whose message starts "Failed query:" with no code.
        assert.ok(
          e instanceof OrchestratorError,
          `expected OrchestratorError, got ${e?.constructor?.name}: ${e?.message}`,
        );
        assert.equal(e.code, "unfinished_attempt", `expected unfinished_attempt, got ${e.code}: ${e.message}`);
        assert.equal(e.httpStatus, 409, "the race must answer 409, never a generic 500");
        assert.ok(!String(e.message).startsWith("Failed query:"), "the friendly message, not the drizzle wrapper");
        return true;
      },
    );

    const atts = await attemptRows(id, "etd_booking");
    assert.equal(atts.length, 1, "only the rival's row survives — the losing insert left nothing behind");
    assert.equal(atts[0].outcome, null, "the rival's attempt stays open (readback reconciles it)");
  });
});

// ---------------------------------------------------------------------------

describe("art_block attempt-open race (fileContractBlock)", () => {
  test("a rival open landing inside the race window surrenders the 'filing' claim to retry, not a stranded rethrow", async () => {
    const id = await seedFilingIntent(`${LDAP_PREFIX}B1`);

    let stateInsideWindow: string | null = null;
    // Must RESOLVE: the old dead check rethrew the drizzle wrapper here and
    // stranded block_state='filing' until the 10-minute sweep grace.
    await fileContractBlock(id, {
      beforeAttemptInsert: async () => {
        // Built-in control: reaching this seam proves every gate upstream
        // passed and the filing CAS won (pending → filing).
        const { rows } = await db.execute(sql`
          SELECT block_state FROM vrm_rental_workflow_intents WHERE id = ${id}
        `);
        stateInsideWindow = String((rows as any[])[0].block_state);
        await insertOpenAttempt(id, "art_block");
      },
    });

    assert.equal(stateInsideWindow, "filing", "the fixture must reach the INSERT via a won filing CAS");

    const { rows } = await db.execute(sql`
      SELECT block_state, next_retry_at, status FROM vrm_rental_workflow_intents WHERE id = ${id}
    `);
    const row = (rows as any[])[0];
    assert.equal(row.block_state, "retry", "the claim must be surrendered so the sweep lanes drive recovery");
    assert.ok(
      row.next_retry_at && new Date(row.next_retry_at).getTime() > Date.now(),
      "surrender must park a future next_retry_at for the sweep",
    );

    const atts = await attemptRows(id, "art_block");
    assert.equal(
      atts.length,
      1,
      "only the rival's open row exists — the losing insert recorded nothing, which is also the proof no POST was possible",
    );
    assert.equal(atts[0].outcome, null, "the rival's strand stays open for the reconcile lane");
  });
});
