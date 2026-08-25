/**
 * Msg1 adoption lane — DB-backed suite (DEV database), task #793.
 *
 * The 8/20 wave proved a booking can acquire a live route block OUTSIDE the
 * intents workflow and silently never text the technician. This suite proves
 * the adoption lane closes that hole and — just as important — that it can
 * never re-text the pre-epoch manual-blast backlog task #792 owns:
 *
 *  1. msg1AdoptionSourceId is deterministic and uuid-shaped (the intents
 *     unique index + fetchEligibilityFacts' ::uuid cast both depend on it).
 *  2. A booked+filed+live row with no evidence gets an ADOPTED intent
 *     (born reservation_verified — never runner-claimable), a durable
 *     msg1_evening send guard, and completes msg1-only. Dev is dark, so the
 *     guard records simulated_* and no real SMS can move.
 *  3. The lane is idempotent — a second run adopts nothing.
 *  4. Prior outbound comms evidence (msg1 phrase OR the row's confirmation
 *     number) excludes the row entirely.
 *  5. The pre-epoch backlog (reserved AND filed before 2026-08-24) is
 *     structurally invisible to the lane.
 *  6. A booked row with no confirmation number is skipped loudly
 *     (skippedNoConfirmation) — it cannot render a truthful msg1.
 *  7. An existing nonterminal intent owns the send: the lane re-drives
 *     releaseMessagesIfEligible instead of double-adopting.
 *  8. buildCutoverStatusPayload derives confirm_text_status / confirm_text_gap
 *     from LIVE guards + comms evidence only — a dry-run simulated guard is
 *     NOT proof a technician was told (dev rows stay flagged by design).
 *
 * Fixtures use ZQM1* ldaps (NOT ZZ*: the lane excludes ZZ% as synthetic) and
 * are deleted in before()/after(). Dev must be dark — the suite refuses to
 * run if the contract-block flag is armed. NO external system is touched.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";

import { db, pool } from "../server/db";
import { initFormsSchema } from "../server/vrm/forms/schema";
import {
  WORKFLOW_CUTOVER,
  CUTOVER_MSG1_ADOPTION_EPOCH,
  MSG1_BODY_EVIDENCE_PHRASE,
  ensureCutoverConfirmationGuards,
  isContractBlockLive,
  msg1AdoptionSourceId,
} from "../server/vrm/forms/cutover-orchestrator";
import { buildCutoverStatusPayload } from "../server/vrm/forms/survey";
import {
  serveCutoverStatusPayload,
  invalidateCutoverStatusCache,
  __resetCutoverStatusLastGoodForTests,
} from "../server/vrm/forms/cutover-status-cache";
import { rootDbErrorMessage } from "../server/vrm/forms/db-errors";

const PREFIX = "ZQM1";
const LDAPS = {
  adopt: "ZQM1A",
  phraseEvidence: "ZQM1B",
  confEvidence: "ZQM1C",
  preEpoch: "ZQM1D",
  noConf: "ZQM1E",
  workflowOwned: "ZQM1F",
  liveSent: "ZQM1G",
  liveBlocked: "ZQM1H",
  livePending: "ZQM1I",
  liveNoGuard: "ZQM1J",
} as const;

async function cleanup() {
  // Guards cascade off intents.
  await db.execute(sql`DELETE FROM vrm_rental_workflow_intents WHERE upper(ldap) LIKE ${PREFIX + "%"}`);
  await db.execute(sql`DELETE FROM vrm_rental_cutover WHERE upper(ldap) LIKE ${PREFIX + "%"}`);
  await db.execute(sql`DELETE FROM fs_comms_messages WHERE upper(COALESCE(ldap, '')) LIKE ${PREFIX + "%"}`);
}

/** Booked + filed + live tracking row, reserved now (inside the epoch). */
async function insertCutoverRow(ldap: string, opts?: {
  etdReference?: string | null;
  reservedAt?: string;       // ISO; default now
  filedAt?: string;          // ISO; default now
}) {
  const conf = opts?.etdReference === undefined ? `ZQREF-${ldap}` : opts.etdReference;
  await db.execute(sql`
    INSERT INTO vrm_rental_cutover
      (ldap, tech_name, truck_number, reservation_status, etd_reference,
       branch_code_booked, branch_name, branch_address, vehicle_class,
       reservation_start, reservation_end, reserved_at,
       route_block_status, route_block_live, route_block_date, route_block_filed_at)
    VALUES
      (${ldap}, ${"Test " + ldap}, '990001', 'booked', ${conf},
       'E10001', 'Enterprise Test Branch', '1 Test Way, Testville, OH', 'CWMR',
       '2026-08-25', '2026-09-01',
       ${opts?.reservedAt ?? new Date().toISOString()}::timestamptz,
       'filed', TRUE, '2026-08-25',
       ${opts?.filedAt ?? new Date().toISOString()}::timestamptz)
  `);
}

async function insertOutboundMessage(ldap: string, body: string) {
  await db.execute(sql`
    INSERT INTO fs_comms_messages (thread_id, ldap, direction, body, status)
    VALUES (${"zqm1-thread-" + ldap}, ${ldap}, 'outbound', ${body}, 'sent')
  `);
}

async function loadIntentByLdap(ldap: string): Promise<any | null> {
  const { rows } = await db.execute(sql`
    SELECT * FROM vrm_rental_workflow_intents
    WHERE upper(ldap) = ${ldap} AND workflow_type = ${WORKFLOW_CUTOVER}
    ORDER BY id DESC LIMIT 1
  `);
  return (rows as any[])[0] ?? null;
}

async function loadGuard(intentId: number): Promise<any | null> {
  const { rows } = await db.execute(sql`
    SELECT * FROM vrm_workflow_send_guards
    WHERE intent_id = ${intentId} AND message_moment = 'msg1_evening'
  `);
  return (rows as any[])[0] ?? null;
}

describe("cutover msg1 adoption lane (task #793)", () => {
  before(async () => {
    await initFormsSchema();
    // Safety rail: this suite exercises the release path. Dev must be dark
    // (dry_run default) or a bug here could text real technicians.
    assert.equal(isContractBlockLive(), false,
      "REFUSING to run: contract-block flag is ARMED in this environment");
    await cleanup();
  });

  after(async () => {
    await cleanup();
    await pool.end();
  });

  test("msg1AdoptionSourceId is deterministic, case/space-insensitive, uuid-shaped", () => {
    const a = msg1AdoptionSourceId("zqm1a", "1234567890");
    const b = msg1AdoptionSourceId(" ZQM1A ", "1234567890");
    assert.equal(a, b);
    assert.notEqual(a, msg1AdoptionSourceId("ZQM1A", "1234567891"));
    assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test("adopts a booked+filed row with no evidence: guard + msg1-only completion", async () => {
    await insertCutoverRow(LDAPS.adopt);
    const summary = await ensureCutoverConfirmationGuards({ ldaps: [LDAPS.adopt] });
    assert.equal(summary.mode, "dry_run", "dev must run the lane dark");
    assert.equal(summary.scanned, 1);
    assert.equal(summary.adopted, 1);
    assert.equal(summary.failures.length, 0);

    const intent = await loadIntentByLdap(LDAPS.adopt);
    assert.ok(intent, "adopted intent must exist");
    assert.equal(intent.created_by, "msg1-adoption");
    assert.equal(intent.execution_mode, "dry_run");
    assert.equal(intent.source_id,
      msg1AdoptionSourceId(LDAPS.adopt, `ZQREF-${LDAPS.adopt}`),
      "source id must be the deterministic adoption uuid (race dedupe key)");
    assert.equal(intent.reservation_state, "verified");
    assert.equal(intent.block_state, "verified");
    assert.equal(intent.msg1_state, "released", "dark release must move msg1 off pending");
    assert.equal(intent.msg2_state, "skipped_adopted", "adoption is msg1-only");
    assert.equal(intent.status, "completed",
      "msg1-only adoption must complete — never hold the per-LDAP live lock forever");

    const guard = await loadGuard(Number(intent.id));
    assert.ok(guard, "durable msg1_evening send guard must exist");
    assert.equal(guard.execution_mode, "dry_run");
    assert.match(String(guard.status), /^simulated_/,
      "dark guard records the dry-run gate outcome, never a real send");
    assert.ok(String(guard.body ?? "").includes(`ZQREF-${LDAPS.adopt}`),
      "guard body must carry the confirmation number");
  });

  test("second run is idempotent — the adopted row is now covered", async () => {
    const summary = await ensureCutoverConfirmationGuards({ ldaps: [LDAPS.adopt] });
    assert.equal(summary.scanned, 0);
    assert.equal(summary.adopted, 0);
  });

  test("outbound message with the msg1 phrase is evidence — row never scanned", async () => {
    await insertCutoverRow(LDAPS.phraseEvidence);
    await insertOutboundMessage(LDAPS.phraseEvidence,
      `SHS Fleet: we have ${MSG1_BODY_EVIDENCE_PHRASE} of your route tomorrow.`);
    const summary = await ensureCutoverConfirmationGuards({ ldaps: [LDAPS.phraseEvidence] });
    assert.equal(summary.scanned, 0);
    assert.equal(await loadIntentByLdap(LDAPS.phraseEvidence), null);
  });

  test("outbound message carrying the confirmation number is evidence too", async () => {
    await insertCutoverRow(LDAPS.confEvidence);
    await insertOutboundMessage(LDAPS.confEvidence,
      `Your Enterprise reservation ZQREF-${LDAPS.confEvidence} is confirmed.`);
    const summary = await ensureCutoverConfirmationGuards({ ldaps: [LDAPS.confEvidence] });
    assert.equal(summary.scanned, 0);
    assert.equal(await loadIntentByLdap(LDAPS.confEvidence), null);
  });

  test("pre-epoch backlog is structurally invisible (task #792 owns it)", async () => {
    assert.ok(new Date(CUTOVER_MSG1_ADOPTION_EPOCH).getTime() > new Date("2026-08-20").getTime(),
      "epoch must postdate the 8/18 blast and the 8/20 wave");
    await insertCutoverRow(LDAPS.preEpoch, {
      reservedAt: "2026-08-19T15:00:00Z",
      filedAt: "2026-08-20T15:00:00Z",
    });
    const summary = await ensureCutoverConfirmationGuards({ ldaps: [LDAPS.preEpoch] });
    assert.equal(summary.scanned, 0, "pre-epoch row must never be auto-texted");
    assert.equal(await loadIntentByLdap(LDAPS.preEpoch), null);
  });

  test("booked row with no confirmation number is skipped loudly, not texted", async () => {
    await insertCutoverRow(LDAPS.noConf, { etdReference: null });
    const summary = await ensureCutoverConfirmationGuards({ ldaps: [LDAPS.noConf] });
    assert.equal(summary.scanned, 1);
    assert.equal(summary.skippedNoConfirmation, 1);
    assert.equal(summary.adopted, 0);
    assert.equal(await loadIntentByLdap(LDAPS.noConf), null);
  });

  test("existing nonterminal intent owns the send — re-driven, never double-adopted", async () => {
    await insertCutoverRow(LDAPS.workflowOwned);
    await db.execute(sql`
      INSERT INTO vrm_rental_workflow_intents
        (workflow_type, source_id, source_revision, execution_mode, ldap,
         status, reservation_state, block_state, msg1_state, msg2_state,
         event_date, reservation_evidence, created_by)
      VALUES
        (${WORKFLOW_CUTOVER}, gen_random_uuid()::text, 0, 'dry_run', ${LDAPS.workflowOwned},
         'reservation_verified', 'verified', 'verified', 'pending', 'skipped_adopted',
         '2026-08-25', ${'{"confirmation":"ZQREF-EXISTING"}'}::jsonb, 'zqm1-fixture')
    `);
    const summary = await ensureCutoverConfirmationGuards({ ldaps: [LDAPS.workflowOwned] });
    assert.equal(summary.scanned, 1);
    assert.equal(summary.adopted, 0, "must not insert a second intent");
    assert.equal(summary.redriven, 1, "release must be re-driven on the existing intent");
    const { rows } = await db.execute(sql`
      SELECT count(*)::int AS n FROM vrm_rental_workflow_intents
      WHERE upper(ldap) = ${LDAPS.workflowOwned}`);
    assert.equal((rows as any[])[0].n, 1);
    const intent = await loadIntentByLdap(LDAPS.workflowOwned);
    assert.equal(intent.msg1_state, "released");
    assert.equal(intent.created_by, "zqm1-fixture", "the WORKFLOW'S intent moved, not a new one");
  });

  test("tracking payload: live guard / comms evidence / gaps derive correctly", async () => {
    // LIVE sent: completed intent + live guard status 'sent'.
    await insertCutoverRow(LDAPS.liveSent);
    const sentIns = await db.execute(sql`
      INSERT INTO vrm_rental_workflow_intents
        (workflow_type, source_id, source_revision, execution_mode, ldap,
         status, reservation_state, block_state, msg1_state, msg2_state, created_by)
      VALUES (${WORKFLOW_CUTOVER}, gen_random_uuid()::text, 0, 'live', ${LDAPS.liveSent},
              'completed', 'verified', 'verified', 'sent', 'skipped_adopted', 'zqm1-fixture')
      RETURNING id`);
    const sentId = Number((sentIns.rows as any[])[0].id);
    await db.execute(sql`
      INSERT INTO vrm_workflow_send_guards
        (intent_id, workflow_type, message_moment, execution_mode, status, body)
      VALUES (${sentId}, ${WORKFLOW_CUTOVER}, 'msg1_evening', 'live', 'sent', 'zqm1 body')`);

    // LIVE blocked: manual_review intent + live guard status 'blocked'.
    await insertCutoverRow(LDAPS.liveBlocked);
    const blkIns = await db.execute(sql`
      INSERT INTO vrm_rental_workflow_intents
        (workflow_type, source_id, source_revision, execution_mode, ldap,
         status, reservation_state, block_state, msg1_state, msg2_state, created_by)
      VALUES (${WORKFLOW_CUTOVER}, gen_random_uuid()::text, 0, 'live', ${LDAPS.liveBlocked},
              'manual_review', 'verified', 'verified', 'blocked', 'skipped_adopted', 'zqm1-fixture')
      RETURNING id`);
    const blkId = Number((blkIns.rows as any[])[0].id);
    await db.execute(sql`
      INSERT INTO vrm_workflow_send_guards
        (intent_id, workflow_type, message_moment, execution_mode, status, body)
      VALUES (${blkId}, ${WORKFLOW_CUTOVER}, 'msg1_evening', 'live', 'blocked', 'zqm1 body')`);

    // LIVE pending: workflow owns the send but has not released yet.
    await insertCutoverRow(LDAPS.livePending);
    await db.execute(sql`
      INSERT INTO vrm_rental_workflow_intents
        (workflow_type, source_id, source_revision, execution_mode, ldap,
         status, reservation_state, block_state, msg1_state, msg2_state, created_by)
      VALUES (${WORKFLOW_CUTOVER}, gen_random_uuid()::text, 0, 'live', ${LDAPS.livePending},
              'reservation_verified', 'verified', 'verified', 'pending', 'pending', 'zqm1-fixture')`);

    // Review regression: a live intent claiming msg1_state='sent' with NO
    // guard row must NOT read as evidence — a migrated/manually touched
    // intent state is a claim, not a send record.
    await insertCutoverRow(LDAPS.liveNoGuard);
    await db.execute(sql`
      INSERT INTO vrm_rental_workflow_intents
        (workflow_type, source_id, source_revision, execution_mode, ldap,
         status, reservation_state, block_state, msg1_state, msg2_state, created_by)
      VALUES (${WORKFLOW_CUTOVER}, gen_random_uuid()::text, 0, 'live', ${LDAPS.liveNoGuard},
              'completed', 'verified', 'verified', 'sent', 'skipped_adopted', 'zqm1-fixture')`);

    const payload = await buildCutoverStatusPayload();
    const byLdap: Record<string, any> = {};
    for (const r of payload.rows as any[]) {
      if (String(r.ldap).toUpperCase().startsWith(PREFIX)) byLdap[String(r.ldap).toUpperCase()] = r;
    }

    // Live guard sent → evidence, no gap.
    assert.equal(byLdap[LDAPS.liveSent]?.confirm_text_status, "sent");
    assert.equal(byLdap[LDAPS.liveSent]?.confirm_text_gap, false);
    assert.ok(byLdap[LDAPS.liveSent]?.confirm_text_at, "sent evidence carries a timestamp");

    // Live guard blocked → LOUD gap (told nobody, failed loudly).
    assert.equal(byLdap[LDAPS.liveBlocked]?.confirm_text_status, "blocked");
    assert.equal(byLdap[LDAPS.liveBlocked]?.confirm_text_gap, true);

    // Live intent not yet released → pending, not a gap (workflow owns it).
    assert.equal(byLdap[LDAPS.livePending]?.confirm_text_status, "pending");
    assert.equal(byLdap[LDAPS.livePending]?.confirm_text_gap, false);

    // msg1_state='sent' with NO guard → never a false green: shows pending
    // (an intent exists) but cannot claim 'sent' without a send record.
    assert.equal(byLdap[LDAPS.liveNoGuard]?.confirm_text_status, "pending");
    assert.equal(byLdap[LDAPS.liveNoGuard]?.confirm_text_gap, false);

    // Outbound comms message → sent, no gap (the 8/18-blast / #792 shape).
    assert.equal(byLdap[LDAPS.phraseEvidence]?.confirm_text_status, "sent");
    assert.equal(byLdap[LDAPS.phraseEvidence]?.confirm_text_gap, false);

    // Dry-run adoption is NOT proof a technician was told: the dev-dark
    // adopted row stays a gap on the page. Only LIVE guards count.
    assert.equal(byLdap[LDAPS.adopt]?.confirm_text_status, "none");
    assert.equal(byLdap[LDAPS.adopt]?.confirm_text_gap, true);

    // No-confirmation row: skipped by the lane, still flagged here.
    assert.equal(byLdap[LDAPS.noConf]?.confirm_text_gap, true);

    // The payload counter counts exactly the flagged rows.
    const fixtureGaps = Object.values(byLdap).filter((r) => r.confirm_text_gap === true).length;
    assert.ok(payload.confirm_gaps >= fixtureGaps, "confirm_gaps must include every flagged fixture");
    assert.equal(
      payload.confirm_gaps,
      (payload.rows as any[]).filter((r) => r.confirm_text_gap === true).length,
      "counter and per-row flag must agree",
    );
  });

  // ── 10. record-booking enforces its OWN auth gate ────────────────────────
  // This door now triggers a real outbound confirmation SMS, so it must
  // refuse unauthenticated callers at the ROUTE level (like /remind and
  // /file-route-blocks), not only via the mount-level allowlist in routes.ts.
  // The router is mounted here with NO session middleware, which is exactly
  // the misconfiguration the route-level gate exists to survive.
  test("record-booking: unauthenticated 403, runner bearer passes (no side effects)", async () => {
    const express = (await import("express")).default;
    const { registerRentalSurveyAdminRoutes } = await import("../server/vrm/forms/survey");

    const app = express();
    app.use(express.json());
    const router = express.Router();
    registerRentalSurveyAdminRoutes(router);
    app.use("/api/vrm", router);

    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", () => r()));
    const port = (server.address() as any).port;
    const url = `http://127.0.0.1:${port}/api/vrm/forms/rental-survey/record-booking`;
    try {
      // Unauthenticated: the route's own gate must refuse BEFORE the handler
      // runs — a booked payload here must create no row and no send guard.
      const anon = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ results: [{ ldap: `${PREFIX}ANON`, etd_reference: "K999999999" }] }),
      });
      assert.equal(anon.status, 403, "unauthenticated record-booking must be refused");
      assert.equal((await anon.json())?.code, "cron_or_staff_only");
      const { rows: leaked } = await db.execute(sql`
        SELECT 1 FROM vrm_rental_cutover WHERE ldap = ${`${PREFIX}ANON`}`);
      assert.equal(leaked.length, 0, "refused request must write nothing");

      // The runner's internal-cron bearer passes the gate. Empty results[]
      // draws the handler's own 400, proving we reached it side-effect-free.
      const bearer = process.env.SESSION_SECRET || process.env.NEXUS_CRON_SECRET;
      assert.ok(bearer, "SESSION_SECRET/NEXUS_CRON_SECRET must exist in this environment");
      const runner = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-internal-cron": String(bearer) },
        body: JSON.stringify({ results: [] }),
      });
      assert.equal(runner.status, 400, "authorized runner must pass the gate (handler's own 400)");
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

/**
 * 2026-08-25 incident: prod cold boot + startup sync made the ~9s cutover
 * scoreboard query fail transiently, and the page rendered drizzle's
 * "Failed query: <18KB of SQL>" wrapper as the error banner. Two contracts:
 *
 *   · rootDbErrorMessage NEVER surfaces the SQL dump — it walks e.cause for
 *     the real pg error (drizzle-wrapping lesson) and stays short;
 *   · serveCutoverStatusPayload retries the build once, then serves the
 *     bounded last-good payload (marked stale), and only 500s — concisely —
 *     when there is nothing else to serve.
 */
describe("cutover-status serving shell (transient-failure resilience)", () => {
  const wrapped = (rootMsg: string, code?: string) => {
    const root: any = new Error(rootMsg);
    if (code) root.code = code;
    const wrapper: any = new Error(`Failed query: SELECT c.ldap, ${"x".repeat(18_000)}`);
    wrapper.cause = root;
    return wrapper;
  };

  test("rootDbErrorMessage: the pg root cause wins; the SQL dump never leaks", () => {
    const msg = rootDbErrorMessage(wrapped("canceling statement due to statement timeout", "57014"));
    assert.equal(msg, "canceling statement due to statement timeout [57014]");
    assert.ok(msg.length < 400, "summary must stay banner-sized");
    assert.ok(!/SELECT c\.ldap/.test(msg), "SQL text must never surface");
  });

  test("rootDbErrorMessage: a Neon drop (empty root message) maps to the generic line, not the dump", () => {
    const msg = rootDbErrorMessage(wrapped(""));
    assert.ok(/connection dropped|no underlying cause/.test(msg), msg);
    assert.ok(!/Failed query/.test(msg));
    // And a bare unwrapped error still reads through.
    assert.equal(rootDbErrorMessage(new Error("boom")), "boom");
  });

  test("serve: success records last-good and returns 200 with the payload untouched", async () => {
    __resetCutoverStatusLastGoodForTests();
    const payload = { total: 3, rows: [{ ldap: "ZQSRV1" }] };
    const served = await serveCutoverStatusPayload(async () => payload, { retryDelayMs: 0 });
    assert.equal(served.status, 200);
    assert.deepEqual(served.body, payload);
    assert.equal(served.body.stale, undefined, "a fresh build must not be marked stale");
  });

  test("serve: first failure retries once — a boot blip never reaches the page", async () => {
    __resetCutoverStatusLastGoodForTests();
    let calls = 0;
    const served = await serveCutoverStatusPayload(async () => {
      calls++;
      if (calls === 1) throw wrapped("terminating connection due to administrator command", "57P01");
      return { total: 1, rows: [] };
    }, { retryDelayMs: 0 });
    assert.equal(calls, 2, "the build must be attempted exactly twice");
    assert.equal(served.status, 200);
    assert.equal(served.body.total, 1);
  });

  test("serve: both attempts fail → last-good within the bound is served, marked stale", async () => {
    __resetCutoverStatusLastGoodForTests();
    let t = 1_000_000;
    const now = () => t;
    const good = { total: 7, rows: [{ ldap: "ZQSRV2" }] };
    await serveCutoverStatusPayload(async () => good, { retryDelayMs: 0, now });
    t += 5 * 60_000; // 5 min later — inside the 15-min bound
    const served = await serveCutoverStatusPayload(async () => {
      throw wrapped("canceling statement due to statement timeout", "57014");
    }, { retryDelayMs: 0, now });
    assert.equal(served.status, 200);
    assert.equal(served.body.total, 7, "last-good payload must ride through");
    assert.equal(served.body.stale, true);
    assert.equal(served.body.staleAsOf, new Date(1_000_000).toISOString());
    assert.deepEqual(good, { total: 7, rows: [{ ldap: "ZQSRV2" }] }, "cached value must not be mutated");
  });

  test("serve: expired last-good never serves — 500 with the ROOT cause, never the SQL", async () => {
    __resetCutoverStatusLastGoodForTests();
    let t = 2_000_000;
    const now = () => t;
    await serveCutoverStatusPayload(async () => ({ total: 2, rows: [] }), { retryDelayMs: 0, now });
    t += 16 * 60_000; // past the 15-min bound — stale data must NOT masquerade as live
    const served = await serveCutoverStatusPayload(async () => {
      throw wrapped("canceling statement due to statement timeout", "57014");
    }, { retryDelayMs: 0, now });
    assert.equal(served.status, 500);
    assert.ok(/statement timeout/.test(served.body.message), served.body.message);
    assert.ok(served.body.message.length < 400, "error body must stay banner-sized");
    assert.ok(!/SELECT c\.ldap/.test(served.body.message), "SQL text must never surface");
  });

  test("serve: cold instance (no last-good) with persistent failure → concise 500", async () => {
    __resetCutoverStatusLastGoodForTests();
    const served = await serveCutoverStatusPayload(async () => {
      throw wrapped("", undefined); // Neon-drop shape: empty root message
    }, { retryDelayMs: 0 });
    assert.equal(served.status, 500);
    assert.ok(/connection dropped|no underlying cause/.test(served.body.message), served.body.message);
    assert.ok(!/Failed query/.test(served.body.message));
  });

  test("serve: concurrent callers coalesce onto ONE build/retry sequence (review finding)", async () => {
    __resetCutoverStatusLastGoodForTests();
    // A 9-second query on a degraded DB must not multiply: N requests + the
    // client's 5xx retry ride the same in-flight build, never 2N queries.
    let builds = 0;
    let release!: (v: any) => void;
    const gate = new Promise((r) => { release = r; });
    const build = async () => { builds++; await gate; return { total: 42, rows: [] }; };
    const a = serveCutoverStatusPayload(build, { retryDelayMs: 0 });
    const b = serveCutoverStatusPayload(build, { retryDelayMs: 0 });
    const c = serveCutoverStatusPayload(build, { retryDelayMs: 0 });
    release({});
    const [ra, rb, rc] = await Promise.all([a, b, c]);
    assert.equal(builds, 1, "three concurrent requests must run the build exactly once");
    assert.equal(ra.status, 200);
    assert.deepEqual(ra.body, rb.body);
    assert.deepEqual(rb.body, rc.body);
    // The flight is detached after settling: a later call builds fresh.
    const later = await serveCutoverStatusPayload(async () => ({ total: 43, rows: [] }), { retryDelayMs: 0 });
    assert.equal(later.body.total, 43);
  });

  test("serve: a mutation's invalidate beats the last-good fallback — pre-write data never masks the write (review finding)", async () => {
    __resetCutoverStatusLastGoodForTests();
    let t = 3_000_000;
    const now = () => t;
    // A page load caches the PRE-mutation payload...
    await serveCutoverStatusPayload(async () => ({ total: 5, rows: [] }), { retryDelayMs: 0, now });
    // ...then billing-void / book-override / the direct import succeeds:
    invalidateCutoverStatusCache("test mutation");
    t += 1_000; // well inside the 15-min bound — ONLY the invalidate protects here
    const served = await serveCutoverStatusPayload(async () => {
      throw wrapped("canceling statement due to statement timeout", "57014");
    }, { retryDelayMs: 0, now });
    assert.equal(served.status, 500, "stale pre-mutation data must NOT serve after an invalidate");
    assert.ok(!served.body.stale, "no stale payload after an invalidate");
  });
});
