/**
 * Holman-queue DCA Make-Unavailable fence — DB-backed suite (DEV database).
 *
 * Task: under the direct-billing process EVERY Holman-queue denial is a
 * billing redirect (the tech keeps working), so those decision rows must
 * never file a DCA "Make Unavailable" event — while legacy VRM rental-queue
 * profitability denials keep filing exactly as before.
 *
 * What this proves, against the real Postgres schema and the REAL exported
 * functions (no SQL copies):
 *  1. enqueueDcaMakeUnavailableForDecision refuses decision_source =
 *     'holman_queue' rows in every re-enqueueable state (not_filed, NULL,
 *     failed, skipped) — status never becomes 'pending'.
 *  2. requestDcaEventRetry (the operator Retry button's backing call)
 *     refuses Holman rows, including a 'failed' 409-style row, and refuses
 *     'not_filed' rows generally.
 *  3. Startup-ordering window: a pre-backfill Holman row (decision_source
 *     still NULL, machine-written notes fingerprint) is fenced from enqueue,
 *     retry, AND the worker's claim predicate — the fence must not depend on
 *     the detached boot backfill having completed.
 *  4. healHolmanDcaRows (boot backfill) stamps legacy Holman rows via the
 *     notes fingerprint and flips retryable DCA states to 'not_filed', while
 *     preserving 'sent' history and dca_event_error.
 *  5. Legacy VRM rows (decision_source NULL, no fingerprint) still enqueue
 *     and retry — including NULL-notes rows (the fence must COALESCE notes
 *     or SQL NULL fences them out).
 *
 * HERMETIC BY CONSTRUCTION: the live dev app's dispatcher polls this same
 * database with real DCA credentials, so this suite must never make a
 * claimable 'pending' row visible to it. Every statement here (fixture
 * inserts, the exported functions' own SQL, reads) runs on ONE dedicated
 * connection inside a single transaction that is ALWAYS rolled back —
 * db.execute is routed to that connection for the duration of the suite.
 * Uncommitted rows are invisible to every other connection, so the
 * dispatcher can never claim them regardless of timing; nothing is ever
 * committed and no external system can be reached.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { PoolClient } from "pg";

import { db, pool } from "../server/db";
import {
  enqueueDcaMakeUnavailableForDecision,
  requestDcaEventRetry,
  healHolmanDcaRows,
  holmanRedirectFenceSql,
  ensureDecisionSourceColumn,
  retryDcaEventForOperator,
} from "../server/vrm/dca-event-dispatcher";

const LDAP_PREFIX = "ZZDCA814";

// ── transaction harness ─────────────────────────────────────────────────────

const dialect = new PgDialect();
let client: PoolClient;
let origExecute: any;

before(async () => {
  // Committed residue cleanup from any earlier crashed run, BEFORE the
  // transaction starts (a DELETE inside the rollback would be undone).
  await db.execute(sql`DELETE FROM vrm_rental_decisions WHERE tech_ldap LIKE ${LDAP_PREFIX + "%"}`);

  client = await pool.connect();
  origExecute = (db as any).execute;
  (db as any).execute = async (q: any) => {
    const compiled = typeof q === "string" ? { sql: q, params: [] } : dialect.sqlToQuery(q);
    return client.query(compiled.sql, compiled.params as any[]);
  };
  await client.query("BEGIN");
});

after(async () => {
  try {
    await client?.query("ROLLBACK");
  } finally {
    (db as any).execute = origExecute;
    client?.release();
    await pool.end();
  }
});

// ── fixtures ────────────────────────────────────────────────────────────────

async function insertDecision(opts: {
  ldap: string;
  decision?: string;
  source?: string | null;
  dcaStatus?: string | null;
  dcaError?: string | null;
  dcaProjectId?: string | null;
  dcaSentAt?: boolean;
  attempts?: number;
  notes?: string | null;
}): Promise<string> {
  const r: any = await db.execute(sql`
    INSERT INTO vrm_rental_decisions
      (tech_ldap, tech_name, recommendation, decision, decided_by_name, notes,
       decision_source, dca_event_status, dca_event_error, dca_event_project_id,
       dca_event_sent_at, dca_event_attempts)
    VALUES
      (${opts.ldap}, 'Fence Fixture', 'Deny', ${opts.decision ?? "denied"}, 'fence-test',
       ${opts.notes ?? null}, ${opts.source ?? null}, ${opts.dcaStatus ?? null},
       ${opts.dcaError ?? null}, ${opts.dcaProjectId ?? null},
       ${opts.dcaSentAt ? sql`NOW()` : sql`NULL`}, ${opts.attempts ?? 0})
    RETURNING id
  `);
  const rows: any[] = Array.isArray(r) ? r : (r?.rows ?? []);
  return String(rows[0].id);
}

async function readDca(id: string): Promise<{ status: string | null; source: string | null; error: string | null; projectId: string | null; attempts: number }> {
  const r: any = await db.execute(sql`
    SELECT dca_event_status AS status, decision_source AS source,
           dca_event_error AS error, dca_event_project_id AS project_id,
           dca_event_attempts AS attempts
      FROM vrm_rental_decisions WHERE id = ${id}
  `);
  const rows: any[] = Array.isArray(r) ? r : (r?.rows ?? []);
  const row = rows[0];
  return {
    status: row.status ?? null,
    source: row.source ?? null,
    error: row.error ?? null,
    projectId: row.project_id ?? null,
    attempts: Number(row.attempts ?? 0),
  };
}

// ── tests ───────────────────────────────────────────────────────────────────

describe("Holman-queue DCA Make-Unavailable fence", () => {
  test("enqueue refuses Holman rows in every re-enqueueable state", async () => {
    for (const dcaStatus of ["not_filed", null, "failed", "skipped"]) {
      const id = await insertDecision({
        ldap: `${LDAP_PREFIX}E${dcaStatus ?? "NULL"}`.slice(0, 50).replace(/[^A-Z0-9]/gi, "").slice(0, 20),
        source: "holman_queue",
        dcaStatus,
      });
      await enqueueDcaMakeUnavailableForDecision(id);
      const after1 = await readDca(id);
      assert.notEqual(after1.status, "pending", `holman row with status=${dcaStatus} must not become pending`);
      assert.equal(after1.status, dcaStatus, `holman row with status=${dcaStatus} must be untouched`);
    }
  });

  test("operator Retry refuses Holman rows — including a 'failed' 409-style row", async () => {
    const id = await insertDecision({
      ldap: `${LDAP_PREFIX}R1`,
      source: "holman_queue",
      dcaStatus: "failed",
      dcaError: "HTTP 409: request already exists",
      attempts: 5,
    });
    const ok = await requestDcaEventRetry(id);
    assert.equal(ok, false, "retry of a Holman failed row must be refused");
    const after1 = await readDca(id);
    assert.equal(after1.status, "failed", "status untouched by refused retry");
    assert.equal(after1.attempts, 5, "attempts untouched by refused retry");
  });

  test("operator Retry refuses 'not_filed' regardless of source", async () => {
    const id = await insertDecision({ ldap: `${LDAP_PREFIX}R2`, source: null, dcaStatus: "not_filed" });
    const ok = await requestDcaEventRetry(id);
    assert.equal(ok, false);
    assert.equal((await readDca(id)).status, "not_filed");
  });

  test("startup-ordering window: a pre-backfill Holman row (NULL source, fingerprint notes) is fenced everywhere", async () => {
    // The dispatcher starts immediately at boot while initVrmSchema (and its
    // healHolmanDcaRows backfill) runs in a detached, non-awaited chain. A
    // Holman row written before the decision_source column existed is still
    // NULL-source during that window — the fence's notes-fingerprint leg must
    // exclude it WITHOUT the backfill having run.
    const fingerprintNotes =
      "Holman PO 999010 denied from rental queue — new-process redirect (direct billing: booked)";

    // (a) enqueue refuses it.
    const failed = await insertDecision({
      ldap: `${LDAP_PREFIX}P1`,
      source: null,
      dcaStatus: "failed",
      notes: fingerprintNotes,
    });
    await enqueueDcaMakeUnavailableForDecision(failed);
    assert.equal((await readDca(failed)).status, "failed", "pre-backfill Holman row must not enqueue");

    // (b) operator retry refuses it.
    assert.equal(await requestDcaEventRetry(failed), false, "pre-backfill Holman row must not retry");
    assert.equal((await readDca(failed)).status, "failed");

    // (c) the worker's claim predicate excludes it even while 'pending' —
    // tested via the SAME exported fragment claimPending composes into its
    // query. (The 'pending' rows exist only inside this rolled-back
    // transaction, so the live dispatcher can never see them.)
    const pendingHolman = await insertDecision({
      ldap: `${LDAP_PREFIX}P2`,
      source: null,
      dcaStatus: "pending",
      notes: fingerprintNotes,
    });
    // Control: a legacy VRM pending row (no fingerprint) must pass the fence.
    const pendingLegacy = await insertDecision({
      ldap: `${LDAP_PREFIX}P3`,
      source: null,
      dcaStatus: "pending",
      notes: "manual profitability deny",
    });
    const r: any = await db.execute(sql`
      SELECT id FROM vrm_rental_decisions
       WHERE dca_event_status = 'pending'
         AND ${holmanRedirectFenceSql()}
         AND id IN (${pendingHolman}, ${pendingLegacy})
    `);
    const claimable = (Array.isArray(r) ? r : (r?.rows ?? [])).map((row: any) => String(row.id));
    assert.equal(claimable.includes(pendingHolman), false, "pre-backfill pending Holman row must be claim-ineligible");
    assert.equal(claimable.includes(pendingLegacy), true, "legacy pending row stays claimable");
  });

  test("boot heal: notes fingerprint stamps source and flips retryable states to not_filed", async () => {
    // Legacy Holman deny (pre-column): NULL source, notes fingerprint, failed DCA state.
    const legacyFailed = await insertDecision({
      ldap: `${LDAP_PREFIX}H1`,
      source: null,
      dcaStatus: "failed",
      dcaError: "HTTP 409: request already exists",
      notes: "Holman PO 999001 denied from rental queue — new-process redirect (direct billing: none)",
    });
    // Legacy Holman deny already SENT with a project id — history must survive.
    const legacySent = await insertDecision({
      ldap: `${LDAP_PREFIX}H2`,
      source: null,
      dcaStatus: "sent",
      dcaProjectId: "proj-zz-814",
      dcaSentAt: true,
      notes: "Holman PO 999002 denied from rental queue",
    });
    // Holman row somehow left 'pending' (should be impossible, heal is defense in depth).
    const holmanPending = await insertDecision({
      ldap: `${LDAP_PREFIX}H3`,
      source: "holman_queue",
      dcaStatus: "pending",
    });
    // Legacy VRM deny with a failed DCA state — must NOT be touched.
    const vrmFailed = await insertDecision({
      ldap: `${LDAP_PREFIX}H4`,
      source: null,
      dcaStatus: "failed",
      notes: "manual profitability deny",
    });

    await healHolmanDcaRows();

    const a = await readDca(legacyFailed);
    assert.equal(a.source, "holman_queue", "notes fingerprint stamps decision_source");
    assert.equal(a.status, "not_filed", "failed → not_filed");
    assert.equal(a.error, "HTTP 409: request already exists", "dca_event_error preserved");

    const b = await readDca(legacySent);
    assert.equal(b.source, "holman_queue");
    assert.equal(b.status, "sent", "'sent' history untouched");
    assert.equal(b.projectId, "proj-zz-814", "project id preserved");

    const c = await readDca(holmanPending);
    assert.equal(c.status, "not_filed", "stray pending Holman row healed");

    const d = await readDca(vrmFailed);
    assert.equal(d.source, null, "legacy VRM row not stamped");
    assert.equal(d.status, "failed", "legacy VRM row untouched");
  });

  test("legacy VRM rows still enqueue and retry exactly as before", async () => {
    // NULL notes on purpose: the fence must COALESCE notes, or the
    // fingerprint leg's SQL NULL silently fences out legacy denials.
    const fresh = await insertDecision({ ldap: `${LDAP_PREFIX}L1`, source: null, dcaStatus: null, notes: null });
    await enqueueDcaMakeUnavailableForDecision(fresh);
    assert.equal((await readDca(fresh)).status, "pending", "legacy deny (NULL notes) enqueues");
    await db.execute(sql`UPDATE vrm_rental_decisions SET dca_event_status = 'failed', dca_event_attempts = 5 WHERE id = ${fresh}`);

    const ok = await requestDcaEventRetry(fresh);
    assert.equal(ok, true, "legacy failed row retries");
    const after1 = await readDca(fresh);
    assert.equal(after1.status, "pending");
    assert.equal(after1.attempts, 0, "retry resets attempts");

    const approved = await insertDecision({ ldap: `${LDAP_PREFIX}L2`, decision: "approved", source: null, dcaStatus: null });
    await enqueueDcaMakeUnavailableForDecision(approved);
    assert.equal((await readDca(approved)).status, null, "approved rows never enqueue");
  });

  // LAST on purpose: the DROP COLUMN below holds an AccessExclusiveLock on
  // vrm_rental_decisions until this suite's transaction rolls back — keeping
  // it as the final subtest minimizes how long concurrent readers wait.
  test("pre-migration boot: an old-schema DB self-heals before any decision is lost", async () => {
    // Simulate the first boot after a deploy against a database the detached
    // background initVrmSchema() has not migrated yet. Transactional DDL: the
    // rollback in after() restores the real column and its data.
    await db.execute(sql`ALTER TABLE vrm_rental_decisions DROP COLUMN decision_source`);

    // A Holman deny calls ensureDecisionSourceColumn() before its insert —
    // the column must come back without waiting for the background init...
    await ensureDecisionSourceColumn();
    const cols: any = await db.execute(sql`
      SELECT 1 FROM information_schema.columns
       WHERE table_name = 'vrm_rental_decisions' AND column_name = 'decision_source'
    `);
    assert.equal(((Array.isArray(cols) ? cols : cols?.rows ?? []) as any[]).length, 1, "ensure re-adds the column");

    // ...so the decision row lands WITH its discriminator + not_filed intact:
    // nothing about the deny pipeline is lost on an old-schema boot.
    const id = await insertDecision({
      ldap: `${LDAP_PREFIX}M1`,
      source: "holman_queue",
      dcaStatus: "not_filed",
      notes: "Holman PO 999020 denied from rental queue — new-process redirect (direct billing: none)",
    });
    const row = await readDca(id);
    assert.equal(row.source, "holman_queue");
    assert.equal(row.status, "not_filed");

    // And the fence surfaces heal the schema themselves before their SQL
    // references the column (enqueue shown here; retry and the worker tick
    // share the same guard). Fixtures are inserted BEFORE the drop — the
    // insert helper itself references the column.
    const legacy = await insertDecision({ ldap: `${LDAP_PREFIX}M2`, dcaStatus: null, notes: null });
    const holman = await insertDecision({
      ldap: `${LDAP_PREFIX}M3`,
      dcaStatus: "failed",
      notes: "Holman PO 999021 denied from rental queue — new-process redirect (direct billing: none)",
    });
    await db.execute(sql`ALTER TABLE vrm_rental_decisions DROP COLUMN decision_source`);
    await enqueueDcaMakeUnavailableForDecision(legacy);
    assert.equal((await readDca(legacy)).status, "pending", "legacy enqueue works across the pre-migration window");
    // The drop wiped the re-added column to NULL for every row — the Holman
    // fingerprint row must STILL be fenced purely by the transitional notes
    // leg, exactly the pre-migration boot condition.
    await enqueueDcaMakeUnavailableForDecision(holman);
    assert.equal((await readDca(holman)).status, "failed", "Holman fingerprint row stays fenced across the window");
  });

  // Route-level ordering regression (reviewer scenario): the retry endpoint's
  // decision read selects the full drizzle schema INCLUDING decision_source,
  // so if the flow ran the read before the self-heal, an old-schema boot
  // would 500 every retry. retryDcaEventForOperator IS the route handler's
  // flow; the injected reader reproduces drizzle's explicit-column select via
  // the transaction client, so it throws exactly like production would if the
  // heal hadn't run first (which would abort this suite's transaction — a
  // loud, unmissable failure).
  test("retry route flow self-heals an old-schema DB before the decision read", async () => {
    const holman = await insertDecision({
      ldap: `${LDAP_PREFIX}R1`,
      dcaStatus: "failed",
      notes: "Holman PO 999022 denied from rental queue — new-process redirect (direct billing: none)",
    });
    const legacy = await insertDecision({ ldap: `${LDAP_PREFIX}R2`, dcaStatus: "failed", notes: null });
    await db.execute(sql`ALTER TABLE vrm_rental_decisions DROP COLUMN decision_source`);

    // Same shape as getRentalDecision: an explicit column list containing
    // decision_source — fails with missing-column SQL unless the flow healed
    // the schema first.
    const readDecision = async (id: string) => {
      const r: any = await db.execute(sql`
        SELECT id, decision, notes, decision_source AS "decisionSource"
          FROM vrm_rental_decisions WHERE id = ${id} LIMIT 1
      `);
      const rows: any[] = Array.isArray(r) ? r : (r?.rows ?? []);
      return rows[0] ?? null;
    };

    // Post-heal the fingerprint row's decision_source is NULL again — the
    // transitional notes leg must still produce the Holman 409, not a send.
    const r1 = await retryDcaEventForOperator(holman, readDecision);
    assert.equal(r1.http, 409, "Holman redirect row → 409 across the pre-migration window");
    assert.match(String(r1.body.error), /intentionally not filed/);
    assert.equal((await readDca(holman)).status, "failed", "Holman row untouched");

    // And legacy retry is NOT stalled during that same window.
    const r2 = await retryDcaEventForOperator(legacy, readDecision);
    assert.equal(r2.http, 200, "legacy retry works across the pre-migration window");
    assert.equal((await readDca(legacy)).status, "pending", "legacy row re-queued");
  });
});
