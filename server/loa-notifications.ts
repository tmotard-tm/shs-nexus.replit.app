/**
 * LOA Communications & Automation (Task #437)
 *
 * Builds on the LOA Recovery sync (`loa-recovery-sync-service.ts`) which now
 * persists one `loa_leaves` row per active continuous leave (ALL leaves, not
 * just 30+). This module owns the automated notifications driven off those
 * rows:
 *   - Team LOA notice email (Fleet/Assets/Inventory) 3 working days before start
 *   - Technician LOA SMS 3 working days before start (1 msg <30d, 2 msgs 30+d)
 *   - Team return-notice email (Fleet/Assets) 3 working days before the
 *     expected return date (suppressed when the leave is closed)
 *   - The extension re-trigger (sub-30 -> 30+) team email + checklist note
 *
 * Each notification's send-state (timestamp + provider message id) lives on the
 * `loa_leaves` row, so the daily sweep is idempotent and never double-sends.
 */
import { db } from "./db";
import { loaLeaves, queueItems, type LoaLeave } from "@shared/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { storage } from "./storage";
import { sendCommunication } from "./communication-service";

const TEAM_NOTICE_TEMPLATE = "loa-team-notice";
const RETURN_NOTICE_TEMPLATE = "loa-return-notice";
const SMS_UNDER30_TEMPLATE = "loa-tech-sms-under30";
const SMS_30PLUS_1_TEMPLATE = "loa-tech-sms-30plus-1";
const SMS_30PLUS_2_TEMPLATE = "loa-tech-sms-30plus-2";

const MIN_DAYS = 30;
const SEND_LEAD_WORKING_DAYS = 3;
const SYSTEM_SENDER = "system:loa_notifications";

// ---------------------------------------------------------------------------
// Working-days math (weekends only — no holiday calendar, per spec).
// ---------------------------------------------------------------------------

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Parse a 'YYYY-MM-DD' date string as UTC midnight. */
function parseDateUtc(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function isWeekend(d: Date): boolean {
  const day = d.getUTCDay();
  return day === 0 || day === 6; // Sun or Sat
}

/**
 * Count working days (Mon–Fri) strictly after `today` up to and including
 * `target`. Returns 0 when `target` is today or in the past.
 */
export function workingDaysUntil(today: Date, target: Date): number {
  const t0 = startOfUtcDay(today);
  const t1 = startOfUtcDay(target);
  if (t1 <= t0) return 0;
  let count = 0;
  const d = new Date(t0);
  while (d < t1) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (!isWeekend(d)) count++;
  }
  return count;
}

/** True when `target` is today or in the future AND within the send window. */
function isWithinSendWindow(today: Date, target: Date | null): boolean {
  if (!target) return false;
  const t0 = startOfUtcDay(today);
  const t1 = startOfUtcDay(target);
  if (t1 < t0) return false;
  return workingDaysUntil(t0, t1) <= SEND_LEAD_WORKING_DAYS;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtVan(v: string | null | undefined): string {
  return v && v.trim() ? v.trim() : "Not on file";
}

function todayStr(): string {
  return startOfUtcDay(new Date()).toISOString().slice(0, 10);
}

async function getTeamEmails(teams: Array<"fleet" | "assets" | "inventory">): Promise<string[]> {
  const rows = await storage.getLoaTeamRecipients();
  const set = new Set<string>();
  for (const row of rows) {
    if (teams.includes(row.team as any)) {
      for (const e of row.emails || []) {
        const trimmed = (e || "").trim();
        if (trimmed) set.add(trimmed);
      }
    }
  }
  return Array.from(set);
}

function teamNoticeVariables(leave: LoaLeave, isExtension: boolean): Record<string, string> {
  const is30Plus = (leave.durationDays || 0) >= MIN_DAYS;
  return {
    tech_name: leave.techName || leave.enterpriseId,
    first_name: leave.firstName || leave.techName || leave.enterpriseId,
    enterprise_id: leave.enterpriseId,
    loa_start_date: leave.startDate || "TBD",
    loa_expected_return_date: leave.expectedReturnDate || "TBD",
    loa_duration_days: String(leave.durationDays || 0),
    van_number: fmtVan(leave.vanNumber),
    is30Plus: is30Plus ? "yes" : "",
    isExtension: isExtension ? "yes" : "",
  };
}

// ---------------------------------------------------------------------------
// Individual sends (each records its own send-state on the leave row)
// ---------------------------------------------------------------------------

/**
 * Send the team LOA notice email to Fleet/Assets/Inventory. When `isExtension`
 * is set the template renders the extension banner. Returns the provider
 * message id of the first successful send, or null when nothing was sent (e.g.
 * no recipients configured).
 */
export async function sendTeamNotice(
  leave: LoaLeave,
  opts: { isExtension?: boolean } = {},
): Promise<string | null> {
  const recipients = await getTeamEmails(["fleet", "assets", "inventory"]);
  if (recipients.length === 0) {
    console.warn(
      `[LoaNotify] No team recipients configured — skipping team notice for ${leave.enterpriseId}.`,
    );
    return null;
  }
  const variables = teamNoticeVariables(leave, !!opts.isExtension);
  let firstMsgId: string | null = null;
  let anySent = false;
  for (const recipient of recipients) {
    const res = await sendCommunication({
      templateName: TEAM_NOTICE_TEMPLATE,
      recipient,
      variables,
      sentBy: SYSTEM_SENDER,
      metadata: {
        kind: opts.isExtension ? "loa_extension_notice" : "loa_team_notice",
        workflowId: leave.workflowId,
        enterpriseId: leave.enterpriseId,
      },
    });
    if (res.status === "sent" || res.status === "simulated") {
      anySent = true;
      if (!firstMsgId && res.providerMessageId) firstMsgId = res.providerMessageId;
    }
  }
  return anySent ? firstMsgId || "sent" : null;
}

/** Send the return-notice email to Fleet/Assets. */
export async function sendReturnNotice(leave: LoaLeave): Promise<string | null> {
  const recipients = await getTeamEmails(["fleet", "assets"]);
  if (recipients.length === 0) {
    console.warn(
      `[LoaNotify] No team recipients configured — skipping return notice for ${leave.enterpriseId}.`,
    );
    return null;
  }
  const variables = {
    tech_name: leave.techName || leave.enterpriseId,
    enterprise_id: leave.enterpriseId,
    loa_expected_return_date: leave.expectedReturnDate || "TBD",
    van_number: fmtVan(leave.vanNumber),
  };
  let firstMsgId: string | null = null;
  let anySent = false;
  for (const recipient of recipients) {
    const res = await sendCommunication({
      templateName: RETURN_NOTICE_TEMPLATE,
      recipient,
      variables,
      sentBy: SYSTEM_SENDER,
      metadata: {
        kind: "loa_return_notice",
        workflowId: leave.workflowId,
        enterpriseId: leave.enterpriseId,
      },
    });
    if (res.status === "sent" || res.status === "simulated") {
      anySent = true;
      if (!firstMsgId && res.providerMessageId) firstMsgId = res.providerMessageId;
    }
  }
  return anySent ? firstMsgId || "sent" : null;
}

/**
 * Send the technician LOA SMS. Under 30 days is a single message; 30+ days is
 * sent as two parts. Returns the provider message id of the first part, or null
 * if no phone is on file / nothing sent.
 */
export async function sendTechSms(leave: LoaLeave): Promise<string | null> {
  const phone = (leave.phone || "").trim();
  if (!phone) {
    console.warn(
      `[LoaNotify] No phone on file — skipping tech SMS for ${leave.enterpriseId}.`,
    );
    return null;
  }
  const variables = {
    first_name: leave.firstName || leave.techName || leave.enterpriseId,
    loa_start_date: leave.startDate || "TBD",
  };
  const is30Plus = (leave.durationDays || 0) >= MIN_DAYS;
  const templates = is30Plus
    ? [SMS_30PLUS_1_TEMPLATE, SMS_30PLUS_2_TEMPLATE]
    : [SMS_UNDER30_TEMPLATE];

  let firstMsgId: string | null = null;
  let anySent = false;
  for (const templateName of templates) {
    const res = await sendCommunication({
      templateName,
      recipient: phone,
      variables,
      sentBy: SYSTEM_SENDER,
      metadata: {
        kind: "loa_tech_sms",
        workflowId: leave.workflowId,
        enterpriseId: leave.enterpriseId,
      },
    });
    if (res.status === "sent" || res.status === "simulated") {
      anySent = true;
      if (!firstMsgId && res.providerMessageId) firstMsgId = res.providerMessageId;
    }
  }
  return anySent ? firstMsgId || "sent" : null;
}

/** Append a timestamped note onto every queue item in a workflow. */
async function appendQueueNote(workflowId: string, note: string): Promise<void> {
  await db
    .update(queueItems)
    .set({
      notes: sql`CASE
        WHEN ${queueItems.notes} IS NULL OR ${queueItems.notes} = ''
        THEN ${note}
        ELSE ${queueItems.notes} || E'\n' || ${note}
      END`,
      updatedAt: new Date(),
    })
    .where(eq(queueItems.workflowId, workflowId));
}

// ---------------------------------------------------------------------------
// Extension re-trigger (called from the sync service)
// ---------------------------------------------------------------------------

/**
 * Handle a leave whose duration just crossed from under-30 to 30+. Sends the
 * team notice flagged as an extension, logs the recovery note on the queue
 * items, and records the extension send-state. The technician SMS is NOT
 * re-sent (guarded by `techSmsSentAt` / the caller's extension flag).
 */
export async function handleLoaExtension(leave: LoaLeave): Promise<void> {
  const msgId = await sendTeamNotice(leave, { isExtension: true });
  const now = new Date();
  await db
    .update(loaLeaves)
    .set({
      extensionTriggered: true,
      extensionTriggeredAt: now,
      extensionNoticeSentAt: msgId ? now : null,
      extensionNoticeMsgId: msgId,
      updatedAt: now,
    })
    .where(eq(loaLeaves.workflowId, leave.workflowId));

  await appendQueueNote(
    leave.workflowId,
    `LOA extended past 30 days — 30-day recovery actions initiated on ${todayStr()}.`,
  );
  console.log(
    `[LoaNotify] Extension re-trigger fired for ${leave.enterpriseId} (${leave.workflowId}).`,
  );
}

// ---------------------------------------------------------------------------
// Daily notification sweep
// ---------------------------------------------------------------------------

export type LoaSweepResult = {
  ok: boolean;
  teamNoticesSent: number;
  techSmsSent: number;
  returnNoticesSent: number;
  error?: string;
};

/**
 * Daily idempotent sweep. For each tracked leave:
 *   - 3 working days before start: send team notice + tech SMS (once each)
 *   - 3 working days before expected return: send return notice (once, unless
 *     the leave is closed)
 * Uses the per-notification send-state to guarantee exactly-once delivery even
 * as the job re-runs daily.
 */
export async function runLoaNotificationSweep(): Promise<LoaSweepResult> {
  const result: LoaSweepResult = {
    ok: false,
    teamNoticesSent: 0,
    techSmsSent: 0,
    returnNoticesSent: 0,
  };
  try {
    const today = startOfUtcDay(new Date());
    const leaves = await db.select().from(loaLeaves);

    for (const leave of leaves) {
      const start = parseDateUtc(leave.startDate);
      const startDue = isWithinSendWindow(today, start);

      // Start-time notifications.
      if (startDue) {
        if (!leave.teamNoticeSentAt) {
          const msgId = await sendTeamNotice(leave);
          if (msgId) {
            const now = new Date();
            await db
              .update(loaLeaves)
              .set({ teamNoticeSentAt: now, teamNoticeMsgId: msgId, updatedAt: now })
              .where(eq(loaLeaves.workflowId, leave.workflowId));
            result.teamNoticesSent++;
          }
        }
        if (!leave.techSmsSentAt) {
          const msgId = await sendTechSms(leave);
          if (msgId) {
            const now = new Date();
            await db
              .update(loaLeaves)
              .set({ techSmsSentAt: now, techSmsMsgId: msgId, updatedAt: now })
              .where(eq(loaLeaves.workflowId, leave.workflowId));
            result.techSmsSent++;
          }
        }
      }

      // Return notice — suppressed if the leave is closed.
      if (!leave.closed && !leave.returnNoticeSentAt) {
        const ret = parseDateUtc(leave.expectedReturnDate);
        if (isWithinSendWindow(today, ret)) {
          const msgId = await sendReturnNotice(leave);
          if (msgId) {
            const now = new Date();
            await db
              .update(loaLeaves)
              .set({ returnNoticeSentAt: now, returnNoticeMsgId: msgId, updatedAt: now })
              .where(eq(loaLeaves.workflowId, leave.workflowId));
            result.returnNoticesSent++;
          }
        }
      }
    }

    result.ok = true;
  } catch (err: any) {
    result.error = err?.message || String(err);
    console.error("[LoaNotify] Sweep failed:", result.error);
  }

  console.log(
    `[LoaNotify] sweep ok=${result.ok} team=${result.teamNoticesSent} ` +
      `sms=${result.techSmsSent} return=${result.returnNoticesSent}` +
      (result.error ? ` error=${result.error}` : ""),
  );
  return result;
}
