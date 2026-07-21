/**
 * Rightsize PHONE-CHANGE WATCH (Tyler directive, 2026-07-21).
 *
 * The daily contacts sync (09:00 UTC, `POST /api/fs/comms/cron/sync`) already
 * refreshes every contact from the roster and writes one `fs_comms_phone_history`
 * row per genuine number change. What was missing is the reaction: when a tech
 * who is STILL outstanding on the right-size campaign turns up with a new
 * number, nobody ever re-sent them the ask, so they read as a non-responder
 * when in truth every message we sent went to a dead phone. Six confirmed dead
 * numbers on round 1 (OGARDN1, BPERKIN, GPAULSE, JMCMEIN, SPITTM4, MBORGES).
 *
 * This engine closes that loop: new number detected -> one reminder to the new
 * number -> logged as a rightsize event.
 *
 * Safety model (deliberately conservative, this thing texts real people):
 *  - OFF by default behind app_settings flag `rightsize_phone_watch_enabled`.
 *  - Only techs in vrm_rightsize_techs whose stage is still OUTSTANDING.
 *    DONE / RETURNED / PASS_EXCUSED are never texted.
 *  - ONE reminder per (ldap, new number) forever, enforced by a unique index,
 *    so a number that flaps back and forth cannot re-text anyone.
 *  - Skipped if the tech has ANY inbound from ANY of their numbers after the
 *    change (they already reached us) or any outbound to the new number.
 *  - Fires in a single ET hour window (default 12 PM ET = 9 AM PT) so the
 *    earliest US timezone is never texted before 9 AM local, and sendMessage's
 *    own quiet-hours + opt-out gates still apply underneath.
 *  - Advisory locked, idempotent per ET day, capped per run, logged to
 *    sync_logs (sync_type 'rightsize_phone_watch').
 *  - dryRun returns the exact recipients and message bodies, sending nothing.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { syncLogs } from "@shared/schema";
import { sendMessage } from "../fleet-comms/outbound";
import { getBooleanSetting } from "../app-settings";
import {
  runUnderAdvisoryLock,
  AdvisoryLockUnavailableError,
} from "../fleetscope-snowflake-sync-lock";

export const PHONE_WATCH_SYNC_TYPE = "rightsize_phone_watch";
export const PHONE_WATCH_FLAG = "rightsize_phone_watch_enabled";
export const PHONE_WATCH_LOCK = "rightsize-phone-watch";
export const PHONE_WATCH_CATEGORY = "rental_management";

/** ET hour (24h) the daily pass sends in. Noon ET = 9 AM PT, the earliest zone. */
export const PHONE_WATCH_ET_HOUR = 12;
/** How far back a phone change counts as "new" (covers a missed day or two). */
const LOOKBACK_HOURS = 48;
/** Hard cap per run. A roster glitch that rewrites hundreds of numbers must not blast. */
const MAX_SENDS_PER_RUN = 25;

/** Stages that mean the tech still owes us the right-size. */
const OUTSTANDING_STAGES = [
  "COMMITTED",
  "PUSHBACK_EQUIP",
  "PUSHBACK_STOCK",
  "PUSHBACK_PROCESS",
  "QUESTION",
  "NON_RESPONDER",
  "NEW_REPLY",
];

/**
 * The reminder. Deliberately soft: it assumes we are the ones who lost them,
 * never accuses the tech of ignoring us, and asks the same single question the
 * campaign always asks (what day). No em dashes, no signature, no threat.
 */
export function buildReminderBody(firstName?: string | null): string {
  const who = (firstName || "").trim();
  const greeting = who ? `Good day ${who}, ` : "Good day, ";
  return (
    `${greeting}this is the Sears Fleet Team. We have a new phone number on file for you, ` +
    `so it looks like our earlier messages about your Enterprise rental went to your old number ` +
    `and you may never have seen them. Nothing is wrong on your end.\n\n` +
    `We still need your rental right-sized to a full size sedan or smaller with a lockable trunk ` +
    `that keeps your tools out of sight. Any Enterprise branch can do the swap and you do not need ` +
    `a reservation.\n\n` +
    `Please reply here with the day you can make the switch, or tell us what is getting in the way ` +
    `and we will help. Thank you for all that you do.`
  );
}

const ET_DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const ET_HOUR_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "numeric",
  hour12: false,
});
export const etToday = (now: Date = new Date()): string => ET_DATE_FMT.format(now);
export const etHour = (now: Date = new Date()): number => Number(ET_HOUR_FMT.format(now)) % 24;

export interface PhoneWatchCandidate {
  ldap: string;
  techName: string | null;
  firstName: string | null;
  stage: string;
  newPhone: string | null;
  newPhoneDigits: string;
  oldPhoneDigits: string | null;
  changedAt: string;
  body: string;
}

export interface PhoneWatchResult {
  skipped?: boolean;
  reason?: string;
  candidates: number;
  sent: number;
  queued: number;
  errors: number;
  dryRun?: boolean;
  recipients?: PhoneWatchCandidate[];
}

/** Dedupe + audit table. Additive, boot-DDL like the rest of the tracker. */
export async function initPhoneWatchSchema(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_rightsize_phone_reminders (
      id            SERIAL PRIMARY KEY,
      ldap          VARCHAR(60) NOT NULL,
      phone_digits  VARCHAR(10) NOT NULL,
      old_phone_digits VARCHAR(10),
      stage_at_send VARCHAR(30),
      message_id    VARCHAR(80),
      status        VARCHAR(20),
      changed_at    TIMESTAMPTZ,
      sent_at       TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_vrm_rsz_phone_reminder ON vrm_rightsize_phone_reminders (ldap, phone_digits);`,
  );
}

/**
 * Everyone who got a new number in the lookback window, still owes the swap,
 * has not reached us since, and has never been reminded at this number.
 */
export async function resolvePhoneWatchCandidates(): Promise<PhoneWatchCandidate[]> {
  const rows = await db.execute(sql`
    WITH changes AS (
      SELECT DISTINCT ON (h.ldap)
             UPPER(h.ldap) AS ldap, h.phone, h.phone_digits, h.changed_at
      FROM fs_comms_phone_history h
      WHERE h.changed_at >= NOW() - ${sql.raw(`INTERVAL '${LOOKBACK_HOURS} hours'`)}
        AND h.phone_digits IS NOT NULL
      ORDER BY h.ldap, h.changed_at DESC
    ),
    prior AS (
      SELECT DISTINCT ON (h.ldap) UPPER(h.ldap) AS ldap, h.phone_digits AS old_digits
      FROM fs_comms_phone_history h
      JOIN changes c ON UPPER(h.ldap) = c.ldap AND h.changed_at < c.changed_at
      ORDER BY h.ldap, h.changed_at DESC
    )
    SELECT c.ldap, c.phone, c.phone_digits, p.old_digits,
           to_char(c.changed_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS changed_at,
           t.tech_name, t.stage
    FROM changes c
    JOIN vrm_rightsize_techs t ON t.ldap = c.ldap
    LEFT JOIN prior p ON p.ldap = c.ldap
    JOIN fs_comms_contacts ct ON UPPER(ct.ldap) = c.ldap AND ct.active
    WHERE t.stage IN (${sql.raw(OUTSTANDING_STAGES.map((s) => `'${s}'`).join(", "))})
      -- the number actually moved (not a first-ever number on a fresh contact)
      AND p.old_digits IS NOT NULL
      AND c.phone_digits IS DISTINCT FROM p.old_digits
      -- the contact record actually carries the new number now
      AND ct.phone_digits = c.phone_digits
      -- never remind the same person at the same number twice
      AND NOT EXISTS (
        SELECT 1 FROM vrm_rightsize_phone_reminders r
        WHERE r.ldap = c.ldap AND r.phone_digits = c.phone_digits
      )
      -- they have not reached us from ANY number since the change
      AND NOT EXISTS (
        SELECT 1 FROM fs_comms_messages m
        WHERE m.direction = 'inbound'
          AND (UPPER(m.ldap) = c.ldap OR m.phone_digits = c.phone_digits)
          AND m.created_at >= c.changed_at
      )
      -- and we have not already texted the new number by any other path
      AND NOT EXISTS (
        SELECT 1 FROM fs_comms_messages m
        WHERE m.direction = 'outbound'
          AND m.phone_digits = c.phone_digits
          AND m.created_at >= c.changed_at
      )
      -- respect opt-outs explicitly (sendMessage also gates, this keeps the
      -- dry-run preview honest about who would really receive it)
      AND NOT EXISTS (
        SELECT 1 FROM fs_comms_optouts o WHERE o.phone_digits = c.phone_digits
      )
    ORDER BY c.changed_at DESC
    LIMIT ${sql.raw(String(MAX_SENDS_PER_RUN))}
  `);

  return (rows.rows as any[]).map((r) => {
    // "LASTNAME,FIRSTNAME" or "First Last" both appear in this column.
    const name: string = r.tech_name || "";
    const firstName = name.includes(",")
      ? name.split(",")[1]?.trim().split(/\s+/)[0] || null
      : name.split(/\s+/)[0] || null;
    return {
      ldap: r.ldap,
      techName: r.tech_name ?? null,
      firstName,
      stage: r.stage,
      newPhone: r.phone ?? null,
      newPhoneDigits: r.phone_digits,
      oldPhoneDigits: r.old_digits ?? null,
      changedAt: r.changed_at,
      body: buildReminderBody(firstName),
    };
  });
}

async function alreadyRanToday(now: Date): Promise<boolean> {
  const today = etToday(now);
  const r = await db.execute(sql`
    SELECT 1 FROM sync_logs
    WHERE sync_type = ${PHONE_WATCH_SYNC_TYPE}
      AND status = 'completed'
      AND to_char(started_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') = ${today}
    LIMIT 1
  `);
  return (r.rows?.length ?? 0) > 0;
}

export async function runPhoneWatch(
  triggeredBy: string,
  opts: { dryRun?: boolean; force?: boolean } = {},
): Promise<PhoneWatchResult> {
  const dryRun = opts.dryRun === true;
  const force = opts.force === true;
  const now = new Date();
  const empty = { candidates: 0, sent: 0, queued: 0, errors: 0 };

  if (!dryRun && !force) {
    const enabled = await getBooleanSetting(PHONE_WATCH_FLAG, false);
    if (!enabled) return { skipped: true, reason: "disabled", ...empty };
    if (etHour(now) !== PHONE_WATCH_ET_HOUR)
      return { skipped: true, reason: "outside_send_window", ...empty };
  }

  try {
    return await runUnderAdvisoryLock(PHONE_WATCH_LOCK, "rightsize-phone-watch", async () => {
      if (!dryRun && !force && (await alreadyRanToday(now)))
        return { skipped: true, reason: "already_ran_today", ...empty } as PhoneWatchResult;

      await initPhoneWatchSchema();
      const candidates = await resolvePhoneWatchCandidates();

      if (dryRun)
        return { candidates: candidates.length, sent: 0, queued: 0, errors: 0, dryRun: true, recipients: candidates };

      let logId: string | null = null;
      const [logRow] = await db
        .insert(syncLogs)
        .values({ syncType: PHONE_WATCH_SYNC_TYPE, status: "running", triggeredBy })
        .returning({ id: syncLogs.id });
      logId = logRow?.id ?? null;

      const result: PhoneWatchResult = { candidates: candidates.length, sent: 0, queued: 0, errors: 0 };

      for (const c of candidates) {
        try {
          const r = await sendMessage({
            ldap: c.ldap,
            category: PHONE_WATCH_CATEGORY,
            body: c.body,
            sentBy: "svc:rightsize-phone-watch",
          });
          if (r.status === "sent") result.sent++;
          else if (r.status === "queued") result.queued++;

          // Claim the (ldap, number) pair even on a skip: a skipped send means a
          // gate said no, and retrying it tomorrow would just re-hit the gate.
          await db.execute(sql`
            INSERT INTO vrm_rightsize_phone_reminders
              (ldap, phone_digits, old_phone_digits, stage_at_send, message_id, status, changed_at)
            VALUES (${c.ldap}, ${c.newPhoneDigits}, ${c.oldPhoneDigits}, ${c.stage},
                    ${r.messageId ?? null}, ${r.status}, ${c.changedAt}::timestamptz)
            ON CONFLICT (ldap, phone_digits) DO NOTHING
          `);

          await db.execute(sql`
            INSERT INTO vrm_rightsize_events (ldap, message_id, message_at, message_text, old_stage, new_stage, action, reason, actor)
            VALUES (${c.ldap}, ${r.messageId ?? null}, NOW(), ${c.body}, ${c.stage}, ${c.stage},
                    'note',
                    ${`phone-change reminder sent to new number ${c.newPhoneDigits} (was ${c.oldPhoneDigits ?? "unknown"}); status ${r.status}`},
                    'svc:rightsize-phone-watch')
          `);
        } catch (e: any) {
          result.errors++;
          console.error(`[Rightsize/PhoneWatch] ${c.ldap} failed:`, e?.message);
        }
      }

      if (logId) {
        await db.execute(sql`
          UPDATE sync_logs
          SET status = ${result.errors && !result.sent ? "failed" : "completed"},
              completed_at = NOW(),
              records_processed = ${result.candidates},
              records_updated = ${result.sent + result.queued},
              error_message = ${result.errors ? `${result.errors} send error(s)` : null}
          WHERE id = ${logId}
        `);
      }
      console.log(
        `[Rightsize/PhoneWatch] ${result.candidates} candidate(s), ${result.sent} sent, ${result.queued} queued, ${result.errors} error(s)`,
      );
      return result;
    });
  } catch (e: any) {
    if (e instanceof AdvisoryLockUnavailableError)
      return { skipped: true, reason: "locked", ...empty };
    throw e;
  }
}
