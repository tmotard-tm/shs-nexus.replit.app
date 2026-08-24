/**
 * Quiet-hours hold exclusion — DB-backed suite (DEV database).
 *
 * Guards the starvation fix flagged in architect review: quiet-hours deferral
 * parks held SMS rows with a future not_before stamp, and getQueuedNotifications
 * must EXCLUDE them from the 50-row FIFO batch. Without that exclusion, 50+
 * texts held overnight (which keep their original created_at) would occupy the
 * whole batch and starve emails and awake-timezone SMS until morning.
 *
 * What this proves, against the real Postgres schema:
 *  1. 55 held SMS rows that are OLDER than everything else in the queue do not
 *     appear in the batch, while a strictly YOUNGER eligible email and an
 *     eligible awake-timezone SMS do. (Fixture created_at values are backdated
 *     30/60 days so they deterministically sort ahead of any real dev-DB rows —
 *     the assertions cannot pass by luck of ordering.)
 *  2. A held row becomes eligible again once its not_before passes; the
 *     deferNotificationUntil stamp itself is what holds it (the row stays
 *     status='queued' throughout — no status transition).
 *  3. deferNotificationUntil never touches non-queued rows (sent / failed /
 *     skipped / delivered), so a concurrent send/skip cannot be resurrected
 *     into the queue window.
 *
 * All fixtures hang off vrm_rental_decisions rows with tech_ldap LIKE
 * 'ZZHOLD%' and are deleted in before()/after(). NO external system is
 * touched: the dispatcher itself is never invoked, no Twilio, no SendGrid.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";

import { db, pool } from "../server/db";
import { getQueuedNotifications, deferNotificationUntil } from "../server/vrm/storage";

const LDAP_PREFIX = "ZZHOLD";

async function cleanup() {
  await db.execute(sql`
    DELETE FROM vrm_notifications
    WHERE decision_id IN (SELECT id FROM vrm_rental_decisions WHERE tech_ldap LIKE ${LDAP_PREFIX + "%"})
  `);
  await db.execute(sql`DELETE FROM vrm_rental_decisions WHERE tech_ldap LIKE ${LDAP_PREFIX + "%"}`);
}

/**
 * Insert one decision + one notification and return the notification id.
 * Each notification needs its own decision because of
 * UNIQUE(decision_id, channel).
 *
 * created_at is expressed as an SQL interval offset from now() so fixtures can
 * be backdated far enough to deterministically outrank any real queued rows in
 * the FIFO ordering (created_at ASC).
 */
async function insertNotification(opts: {
  ldap: string;
  channel: "sms" | "email" | "sms_tech_deny";
  status?: string;
  /** e.g. "60 days" — how far in the past created_at should be */
  createdAgo: string;
  /** e.g. "8 hours" (future) or "-1 minutes" (past); omitted = NULL */
  notBeforeIn?: string;
}): Promise<string> {
  const { rows: dRows } = await db.execute(sql`
    INSERT INTO vrm_rental_decisions (tech_ldap, recommendation, decision, decided_by_name)
    VALUES (${opts.ldap}, 'deny', 'deny', 'task-781 fixture')
    RETURNING id
  `);
  const decisionId = (dRows as any[])[0].id as string;
  const { rows: nRows } = await db.execute(sql`
    INSERT INTO vrm_notifications (decision_id, channel, recipient, status, not_before, created_at)
    VALUES (
      ${decisionId},
      ${opts.channel}::vrm_notification_channel,
      '+15555550100',
      ${opts.status ?? "queued"}::vrm_notification_status,
      ${opts.notBeforeIn === undefined ? null : sql`now() + ${opts.notBeforeIn}::interval`},
      now() - ${opts.createdAgo}::interval
    )
    RETURNING id
  `);
  return (nRows as any[])[0].id as string;
}

async function readNotification(id: string): Promise<{ status: string; not_before: unknown }> {
  const { rows } = await db.execute(sql`
    SELECT status, not_before FROM vrm_notifications WHERE id = ${id}
  `);
  assert.equal((rows as any[]).length, 1, `notification ${id} must exist`);
  return (rows as any[])[0] as { status: string; not_before: unknown };
}

before(async () => {
  await cleanup();
});

after(async () => {
  await cleanup().catch(() => {});
  await pool.end().catch(() => {});
});

// ---------------------------------------------------------------------------

describe("held texts are excluded from the FIFO batch", () => {
  test("55 held SMS rows (oldest in queue) never crowd out a younger eligible email + awake SMS", async () => {
    // 55 held texts, all OLDER (created 60 days ago) than the eligible rows
    // (created 30 days ago). Under pure FIFO-by-created_at they would fill the
    // entire 50-row batch — the not_before exclusion is the ONLY thing keeping
    // them out, which is exactly what this test pins down.
    const heldIds: string[] = [];
    for (let i = 0; i < 55; i++) {
      heldIds.push(
        await insertNotification({
          ldap: `${LDAP_PREFIX}H${i}`,
          channel: "sms",
          createdAgo: "60 days",
          notBeforeIn: "8 hours", // future — held for quiet hours
        }),
      );
    }
    const eligibleEmailId = await insertNotification({
      ldap: `${LDAP_PREFIX}EMAIL`,
      channel: "email",
      createdAgo: "30 days",
      // not_before omitted → NULL (never deferred)
    });
    const eligibleSmsId = await insertNotification({
      ldap: `${LDAP_PREFIX}AWAKE`,
      channel: "sms",
      createdAgo: "30 days",
      notBeforeIn: "-5 minutes", // past stamp — hold already expired
    });

    // Default limit = 50, same as the production drain tick.
    const batch = await getQueuedNotifications();
    assert.ok(batch.length <= 50, "batch must respect the 50-row limit");
    const batchIds = new Set(batch.map((n) => n.id));

    assert.ok(
      batchIds.has(eligibleEmailId),
      "eligible email (no not_before) must be selected despite 55 older held texts",
    );
    assert.ok(
      batchIds.has(eligibleSmsId),
      "awake-timezone SMS (past not_before) must be selected despite 55 older held texts",
    );
    for (const id of heldIds) {
      assert.ok(!batchIds.has(id), `held SMS ${id} (future not_before) must NOT be in the batch`);
    }
  });

  test("a held row re-enters the batch once its not_before passes — stays queued throughout", async () => {
    const id = await insertNotification({
      ldap: `${LDAP_PREFIX}WAKE`,
      channel: "sms",
      createdAgo: "45 days",
    });

    // Stamp via the real deferral function (the exact code path dispatchOne
    // uses when quiet hours hold a text).
    await deferNotificationUntil(id, new Date(Date.now() + 8 * 3600 * 1000));

    let row = await readNotification(id);
    assert.equal(row.status, "queued", "deferral must NOT transition status — row stays queued");
    assert.ok(row.not_before, "deferral must stamp not_before");

    let batchIds = new Set((await getQueuedNotifications()).map((n) => n.id));
    assert.ok(!batchIds.has(id), "row must be excluded while not_before is in the future");

    // Simulate the clock passing the stamp (we can't wait 8 hours in a test).
    await db.execute(sql`
      UPDATE vrm_notifications SET not_before = now() - interval '1 second' WHERE id = ${id}
    `);

    batchIds = new Set((await getQueuedNotifications()).map((n) => n.id));
    assert.ok(batchIds.has(id), "row must become eligible once not_before has passed");

    row = await readNotification(id);
    assert.equal(row.status, "queued", "row is still queued — only the drain filter changed its fate");
  });
});

// ---------------------------------------------------------------------------

describe("deferNotificationUntil status guard", () => {
  test("never touches non-queued rows (sent / failed / skipped / delivered)", async () => {
    const terminal: Array<[string, string]> = [
      ["sent", `${LDAP_PREFIX}TSENT`],
      ["failed", `${LDAP_PREFIX}TFAIL`],
      ["skipped", `${LDAP_PREFIX}TSKIP`],
      ["delivered", `${LDAP_PREFIX}TDLVR`],
    ];
    for (const [status, ldap] of terminal) {
      const id = await insertNotification({
        ldap,
        channel: "sms",
        status,
        createdAgo: "40 days",
      });
      await deferNotificationUntil(id, new Date(Date.now() + 3600 * 1000));
      const row = await readNotification(id);
      assert.equal(row.status, status, `status '${status}' must be untouched by deferral`);
      assert.equal(
        row.not_before,
        null,
        `not_before must stay NULL on a '${status}' row — a finished send can never be resurrected into the queue window`,
      );
    }
  });

  test("stamps a queued row (positive control for the guard above)", async () => {
    const id = await insertNotification({
      ldap: `${LDAP_PREFIX}QPOS`,
      channel: "sms",
      createdAgo: "40 days",
    });
    await deferNotificationUntil(id, new Date(Date.now() + 3600 * 1000));
    const row = await readNotification(id);
    assert.equal(row.status, "queued");
    assert.ok(row.not_before, "queued row must receive the not_before stamp");
  });
});
