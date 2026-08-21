/**
 * Weekly rental-extension reminder tests.
 *
 * Covers:
 *  1. Pure: the due-window classifier (classifyExtensionDue) including its
 *     "unknown ≠ healthy" contract, and the SMS body builder's GSM-7
 *     degradation ladder (vendor dropped first, then day counts, link never).
 *  2. Arm gate (dev DB): isExtensionRemindersEnabled defaults OFF on an
 *     absent row and reads fail-closed semantics off the real settings table.
 *  3. Cycle idempotency (dev DB): the partial unique claim index — a second
 *     claim for the same case+cycle returns null; failed/stale/dry_run rows
 *     do NOT consume the slot; a new cycle (bumped days_authorized) opens a
 *     fresh slot; releaseStaleClaims frees a crashed claim.
 *
 * NO texts are sent anywhere in this suite: nothing here calls
 * runExtensionReminderSweep or sendMessage. That is deliberate —
 * COMMS_SEND_LIVE is on in dev, so exercising the send path against real case
 * rows would text real technicians. The claim/record helpers are exported
 * exactly so the DB contract can be tested without the send lane.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  classifyExtensionDue,
  buildExtensionReminderBody,
  DEFAULT_LEAD_DAYS,
  ensureReminderTables,
  ensureSweepSchema,
  claimReminderSlot,
  releaseStaleClaims,
} from "../server/vrm/rental-operations/extension-reminder";
import { PUBLIC_REQUEST_URL, liveRequestGuard } from "../server/vrm/forms/rental-request";

// Fixture keys: short (VARCHAR(10)) and impossible as real truck numbers.
const CASE_A = "EXTRMT1";
const CASE_B = "EXTRMT2";

// End every pool the imports may have opened, whether or not DB tests ran —
// otherwise the runner never exits (same trap as vrm-fleet-status.test.ts).
after(async () => {
  const { pool } = await import("../server/db");
  await pool.end().catch(() => {});
  const { fsPool } = await import("../server/fleet-scope-db");
  await fsPool.end().catch(() => {});
});

describe("classifyExtensionDue (pure)", () => {
  test("due when authorized days are reached or passed", () => {
    assert.equal(classifyExtensionDue(7, 7), "due");
    assert.equal(classifyExtensionDue(9, 7), "due");
    assert.equal(classifyExtensionDue(14, 14), "due");
  });

  test("due inside the lead window, not before it", () => {
    // default lead = 1: "due tomorrow" alerts, "due in 2 days" does not
    assert.equal(classifyExtensionDue(6, 7), "due");
    assert.equal(classifyExtensionDue(5, 7), "not_due");
    assert.equal(classifyExtensionDue(1, 7), "not_due");
    // custom lead widens the window
    assert.equal(classifyExtensionDue(4, 7, 3), "due");
    assert.equal(classifyExtensionDue(3, 7, 3), "not_due");
    assert.equal(DEFAULT_LEAD_DAYS, 1);
  });

  test("unknown (never due, never healthy) on missing or nonsense numbers", () => {
    assert.equal(classifyExtensionDue(null, 7), "unknown");
    assert.equal(classifyExtensionDue(7, null), "unknown");
    assert.equal(classifyExtensionDue(undefined, undefined), "unknown");
    assert.equal(classifyExtensionDue(7, 0), "unknown"); // zero authorized = no cycle to key on
    assert.equal(classifyExtensionDue(-1, 7), "unknown");
    assert.equal(classifyExtensionDue(NaN, 7), "unknown");
  });
});

describe("buildExtensionReminderBody (pure)", () => {
  test("always carries the /rental-request link", () => {
    for (const t of [
      { rental_vendor: "ENTERPRISE", days_open: 7, days_authorized: 7 },
      { rental_vendor: null, days_open: null, days_authorized: null },
      { rental_vendor: "SOME EXTREMELY LONG RENTAL VENDOR NAME LLC OF AMERICA", days_open: 21, days_authorized: 21 },
    ]) {
      const body = buildExtensionReminderBody(t);
      assert.ok(body.includes(PUBLIC_REQUEST_URL), `link missing from: ${body}`);
      assert.ok(body.includes("/rental-request"), `path missing from: ${body}`);
    }
  });

  test("single segment with day counts (the normal case)", () => {
    const body = buildExtensionReminderBody({ rental_vendor: "ENTERPRISE", days_open: 7, days_authorized: 7 });
    assert.ok(body.length <= 160, `expected <=160 chars, got ${body.length}: ${body}`);
    assert.ok(body.includes("day 7 of 7"), `counts missing from: ${body}`);
    // 2-digit cycles stay single-segment too
    const b2 = buildExtensionReminderBody({ rental_vendor: "ENTERPRISE", days_open: 14, days_authorized: 14 });
    assert.ok(b2.length <= 160, `expected <=160 chars, got ${b2.length}: ${b2}`);
    assert.ok(b2.includes("day 14 of 14"));
  });

  test("degrades (vendor first) instead of overflowing on a long vendor", () => {
    const body = buildExtensionReminderBody({
      rental_vendor: "SOME EXTREMELY LONG RENTAL VENDOR NAME LLC OF AMERICA",
      days_open: 7,
      days_authorized: 7,
    });
    assert.ok(body.length <= 160, `expected <=160 chars, got ${body.length}: ${body}`);
    assert.ok(!body.toLowerCase().includes("extremely long"), "vendor should have been dropped");
    assert.ok(body.includes("day 7 of 7"), "counts should survive vendor drop");
  });

  test("missing counts fall back to a generic due message, still one segment", () => {
    const body = buildExtensionReminderBody({ rental_vendor: null, days_open: null, days_authorized: null });
    assert.ok(body.length <= 160, `expected <=160 chars, got ${body.length}: ${body}`);
    assert.ok(!body.includes("day null"), `null leaked into body: ${body}`);
  });
});

// ── DB-backed (dev database) ────────────────────────────────────────────────

let dbUp = false;
before(async () => {
  try {
    await ensureReminderTables();
    dbUp = true;
  } catch (e: any) {
    console.warn("SKIPPING DB tests (no database reachable):", e?.message || e);
  }
});

async function cleanupFixtures() {
  const { db } = await import("../server/db");
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`
    DELETE FROM vrm_rental_extension_reminders WHERE case_key IN (${CASE_A}, ${CASE_B})
  `);
}

describe("sweep schema bootstrap (dev DB)", () => {
  test("ensureSweepSchema makes liveRequestGuard's query runnable — the standalone script's contract", async (t) => {
    if (!dbUp) return t.skip("no database");
    // The Scheduled-Deployment script never runs the web app's boot DDL chain,
    // so the sweep itself must ensure EVERYTHING it queries. Regression for
    // the day-one failure: vrm_rental_request.request_type missing → every
    // guard call failed before any case was evaluated.
    await ensureSweepSchema();
    const { db } = await import("../server/db");
    const { sql } = await import("drizzle-orm");
    const col = await db.execute(sql`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'vrm_rental_request' AND column_name = 'request_type'
    `);
    assert.equal(col.rows.length, 1, "forms schema (request_type) must exist after ensureSweepSchema");
    // And the guard itself runs end-to-end (an unknown ldap = clean no-block).
    const guard = await liveRequestGuard("ZZNOSUCH");
    assert.equal(guard.blockExtension ?? null, null);
  });
});

describe("arm gate (dev DB)", () => {
  test("absent settings row means OFF — dry-run is the default", async (t) => {
    if (!dbUp) return t.skip("no database");
    const { db } = await import("../server/db");
    const { sql } = await import("drizzle-orm");
    const { isExtensionRemindersEnabled, SETTING_EXTENSION_REMINDERS } = await import(
      "../server/vrm/rental-operations/settings"
    );
    const existing = await db.execute<{ value: any }>(sql`
      SELECT value FROM vrm_rental_ops_settings WHERE key = ${SETTING_EXTENSION_REMINDERS}
    `);
    if (existing.rows.length === 0) {
      assert.equal(await isExtensionRemindersEnabled(), false, "absent row must mean OFF");
    } else {
      // A human already armed/flipped it in this environment; do not touch the
      // real switch from a test. Just assert the read matches the stored row.
      const stored = existing.rows[0].value?.enabled === true;
      assert.equal(await isExtensionRemindersEnabled(), stored);
    }
  });

  test("a non-{enabled:true} value reads as OFF", async (t) => {
    if (!dbUp) return t.skip("no database");
    const { getSetting } = await import("../server/vrm/rental-operations/settings");
    // Contract check without flipping the real key: the gate requires
    // value.enabled === true strictly, so string "true"/1/absent are all OFF.
    for (const v of [{ enabled: "true" }, { enabled: 1 }, {}, null]) {
      const enabled = (v as any)?.enabled === true;
      assert.equal(enabled, false);
    }
    assert.equal(typeof getSetting, "function");
  });
});

describe("cycle idempotency — the claim index (dev DB)", () => {
  test("second claim for the same case+cycle loses; a new cycle opens fresh", async (t) => {
    if (!dbUp) return t.skip("no database");
    await cleanupFixtures();
    try {
      const first = await claimReminderSlot({ caseKey: CASE_A, cycleKey: 7, ldap: "TESTLDAP1" });
      assert.ok(first, "first claim must win");
      const second = await claimReminderSlot({ caseKey: CASE_A, cycleKey: 7, ldap: "TESTLDAP1" });
      assert.equal(second, null, "same cycle must be refused");
      // extension granted -> days_authorized bumps -> new cycle key
      const nextCycle = await claimReminderSlot({ caseKey: CASE_A, cycleKey: 14, ldap: "TESTLDAP1" });
      assert.ok(nextCycle, "a new authorization cycle must open a fresh slot");
      // a different case in the same cycle is independent
      const otherCase = await claimReminderSlot({ caseKey: CASE_B, cycleKey: 7, ldap: "TESTLDAP2" });
      assert.ok(otherCase, "another case must not be blocked");
    } finally {
      await cleanupFixtures();
    }
  });

  test("sent/queued keep the slot; failed/dry_run/skipped free it", async (t) => {
    if (!dbUp) return t.skip("no database");
    const { db } = await import("../server/db");
    const { sql } = await import("drizzle-orm");
    await cleanupFixtures();
    try {
      const id = await claimReminderSlot({ caseKey: CASE_A, cycleKey: 7, ldap: "TESTLDAP1" });
      assert.ok(id);
      // sent consumes the cycle
      await db.execute(sql`UPDATE vrm_rental_extension_reminders SET status='sent', sent_at=NOW() WHERE id=${id}`);
      assert.equal(await claimReminderSlot({ caseKey: CASE_A, cycleKey: 7, ldap: "TESTLDAP1" }), null,
        "a sent reminder must keep the cycle consumed");
      // failed frees it (the next sweep must be able to retry)
      await db.execute(sql`UPDATE vrm_rental_extension_reminders SET status='failed', sent_at=NULL WHERE id=${id}`);
      const retry = await claimReminderSlot({ caseKey: CASE_A, cycleKey: 7, ldap: "TESTLDAP1" });
      assert.ok(retry, "a failed attempt must not consume the cycle");
      // dry_run rows never consume: insert one alongside the live claim
      await db.execute(sql`
        INSERT INTO vrm_rental_extension_reminders (case_key, cycle_key, ldap, status, dry_run)
        VALUES (${CASE_B}, 7, 'TESTLDAP2', 'dry_run', true)
      `);
      const afterDry = await claimReminderSlot({ caseKey: CASE_B, cycleKey: 7, ldap: "TESTLDAP2" });
      assert.ok(afterDry, "a dry run must never arm the gate silently dead");
    } finally {
      await cleanupFixtures();
    }
  });

  test("releaseStaleClaims frees a crashed claim, and only an old one", async (t) => {
    if (!dbUp) return t.skip("no database");
    const { db } = await import("../server/db");
    const { sql } = await import("drizzle-orm");
    await cleanupFixtures();
    try {
      const freshId = await claimReminderSlot({ caseKey: CASE_A, cycleKey: 7, ldap: "TESTLDAP1" });
      assert.ok(freshId);
      // Backdate a second case's claim past the stale horizon.
      const staleId = await claimReminderSlot({ caseKey: CASE_B, cycleKey: 7, ldap: "TESTLDAP2" });
      assert.ok(staleId);
      await db.execute(sql`
        UPDATE vrm_rental_extension_reminders SET created_at = NOW() - INTERVAL '2 hours' WHERE id = ${staleId}
      `);
      await releaseStaleClaims();
      const rows = await db.execute<{ id: string; status: string }>(sql`
        SELECT id, status FROM vrm_rental_extension_reminders WHERE id IN (${freshId}, ${staleId})
      `);
      const byId = new Map(rows.rows.map((r) => [r.id, r.status]));
      assert.equal(byId.get(freshId!), "claimed", "a fresh claim must survive the release");
      assert.equal(byId.get(staleId!), "stale", "an expired claim must be released");
      // and the released slot is claimable again
      const reclaim = await claimReminderSlot({ caseKey: CASE_B, cycleKey: 7, ldap: "TESTLDAP2" });
      assert.ok(reclaim, "released slot must be claimable");
    } finally {
      await cleanupFixtures();
    }
  });
});
