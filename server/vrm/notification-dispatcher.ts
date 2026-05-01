/**
 * VRM notification dispatcher (spec item 4 + 7).
 *
 * On a Deny decision we notify the tech's supervisor about the rental refusal:
 *   - SMS  via Twilio (FS_TWILIO_*)  — brief copy, no factor breakdown
 *   - Email via SendGrid             — full factor breakdown + BYOV invitation
 *
 * Dispatch is decoupled from the decision write path:
 *   1. enqueueNotificationsForDeny(...) inserts queued rows into vrm_notifications
 *      (idempotent via UNIQUE(decision_id, channel) — safe on retry).
 *   2. A worker (startNotificationDispatcher) drains queued rows every 30s.
 *
 * If a supervisor has neither phone nor email, a single 'skipped' row is
 * recorded so audit history reflects the missed notification.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import {
  vrmProfitabilitySnapshot,
  vrmRentalDecisions,
  type VrmNotification,
} from "@shared/vrm-schema";
import { eq } from "drizzle-orm";
import {
  enqueueNotification,
  getQueuedNotifications,
  markNotificationSent,
  markNotificationFailed,
  markNotificationSkipped,
} from "./storage";
import { sendTwilioMessage } from "../fleet-scope-reg-messaging";
import { sendEmail } from "../email-service";

interface SupervisorContact {
  supervisorLdap: string | null;
  supervisorName: string | null;
  supervisorPhone: string | null;
  supervisorEmail: string | null;
}

interface DenyContext {
  decisionId: string;
  techLdap: string;
  techName: string | null;
  dailyNetWithRental: string | number | null;
  scorecardScore: string | number | null;
  tenureMonths: number | null;
  supervisor: SupervisorContact;
}

// ─── Snapshot lookup helpers ───────────────────────────────────────────────

/**
 * Pull supervisor contact info for the tech from the daily snapshot.
 * The snapshot's supervisorEmail already reflects override > TPMS at
 * write time (handled in profitability-sync), so we just read it as-is.
 */
async function getSupervisorContact(techLdap: string): Promise<SupervisorContact> {
  const upper = techLdap.toUpperCase();
  const [row] = await db
    .select({
      supervisorLdap: vrmProfitabilitySnapshot.supervisorLdap,
      supervisorName: vrmProfitabilitySnapshot.supervisorName,
      supervisorPhone: vrmProfitabilitySnapshot.supervisorPhone,
      supervisorEmail: vrmProfitabilitySnapshot.supervisorEmail,
    })
    .from(vrmProfitabilitySnapshot)
    .where(eq(vrmProfitabilitySnapshot.techLdap, upper))
    .limit(1);

  return {
    supervisorLdap: row?.supervisorLdap ?? null,
    supervisorName: row?.supervisorName ?? null,
    supervisorPhone: row?.supervisorPhone ?? null,
    supervisorEmail: row?.supervisorEmail ?? null,
  };
}

// ─── Public enqueue API ────────────────────────────────────────────────────

/**
 * Called from the /profitability/log route after a Deny decision is recorded.
 * Inserts the queued SMS + email rows (or a single 'skipped' row when neither
 * channel is available).  Safe to call repeatedly — UNIQUE(decision_id, channel)
 * keeps it idempotent.
 */
export async function enqueueNotificationsForDeny(args: {
  decisionId: string;
  techLdap: string;
  techName: string | null;
  dailyNetWithRental: string | number | null;
  scorecardScore: string | number | null;
  tenureMonths: number | null;
}): Promise<{ smsQueued: boolean; emailQueued: boolean; skipped: boolean }> {
  const supervisor = await getSupervisorContact(args.techLdap);

  const ctx: DenyContext = {
    decisionId: args.decisionId,
    techLdap: args.techLdap,
    techName: args.techName,
    dailyNetWithRental: args.dailyNetWithRental,
    scorecardScore: args.scorecardScore,
    tenureMonths: args.tenureMonths,
    supervisor,
  };

  const phone = (supervisor.supervisorPhone ?? "").trim();
  const email = (supervisor.supervisorEmail ?? "").trim();

  if (!phone && !email) {
    // Single 'skipped' row carrying explanation; channel set to email by
    // convention (UNIQUE allows one row per channel).
    await enqueueNotification({
      decisionId: args.decisionId,
      channel: "email",
      recipient: "(missing)",
      payload: buildPayload(ctx, "email"),
      status: "skipped",
      error: "supervisor has no phone and no email on file",
    });
    return { smsQueued: false, emailQueued: false, skipped: true };
  }

  let smsQueued = false;
  let emailQueued = false;

  if (phone) {
    const ins = await enqueueNotification({
      decisionId: args.decisionId,
      channel: "sms",
      recipient: phone,
      payload: buildPayload(ctx, "sms"),
      status: "queued",
    });
    smsQueued = !!ins;
  }
  if (email) {
    const ins = await enqueueNotification({
      decisionId: args.decisionId,
      channel: "email",
      recipient: email,
      payload: buildPayload(ctx, "email"),
      status: "queued",
    });
    emailQueued = !!ins;
  }

  return { smsQueued, emailQueued, skipped: false };
}

// ─── Body templates ────────────────────────────────────────────────────────

function fmtMoney(v: string | number | null): string {
  if (v == null) return "n/a";
  const n = Number(v);
  if (!Number.isFinite(n)) return "n/a";
  return `$${n.toFixed(2)}`;
}

function buildPayload(ctx: DenyContext, channel: "sms" | "email") {
  const techLabel = ctx.techName ? `${ctx.techName} (${ctx.techLdap})` : ctx.techLdap;
  const supName = ctx.supervisor.supervisorName ?? "Supervisor";

  if (channel === "sms") {
    // Brief, no factor breakdown.
    return {
      subject: null,
      body:
        `Sears Home Services VRM: A rental vehicle request for ${techLabel} ` +
        `was denied. Please review with the tech. Detail follows by email.`,
    };
  }

  // Email — factor breakdown + BYOV invitation.
  const factors: string[] = [];
  if (ctx.dailyNetWithRental != null) {
    factors.push(`• Projected daily net with rental: ${fmtMoney(ctx.dailyNetWithRental)}`);
  }
  if (ctx.scorecardScore != null) {
    const s = Number(ctx.scorecardScore);
    if (Number.isFinite(s)) factors.push(`• Scorecard score: ${s.toFixed(2)}`);
  }
  if (ctx.tenureMonths != null) {
    factors.push(`• Tenure: ${ctx.tenureMonths} months`);
  }
  const factorsBlock = factors.length > 0 ? factors.join("\n") : "• (factor data not available)";

  const subject = `VRM: Rental request denied for ${techLabel}`;
  const body =
    `Hello ${supName},\n\n` +
    `A rental vehicle request for ${techLabel} was denied based on the following profitability factors:\n\n` +
    `${factorsBlock}\n\n` +
    `BYOV (Bring Your Own Vehicle) is available as an alternative — please discuss the option with ${techLabel}.\n\n` +
    `If you believe this decision should be revisited, contact the VRM team.\n\n` +
    `— Sears Home Services Vehicle Rental Management`;

  return { subject, body };
}

// ─── Worker ────────────────────────────────────────────────────────────────

async function dispatchOne(n: VrmNotification): Promise<void> {
  const payload = (n.payload ?? {}) as { subject: string | null; body: string };

  try {
    if (n.channel === "sms") {
      if (!n.recipient || n.recipient === "(missing)") {
        await markNotificationSkipped(n.id, "no recipient");
        return;
      }
      await sendTwilioMessage(n.recipient, payload.body);
      await markNotificationSent(n.id);
      console.log(`[VRM Notif] SMS sent to ${n.recipient} (decision ${n.decisionId})`);
    } else if (n.channel === "email") {
      if (!n.recipient || n.recipient === "(missing)") {
        await markNotificationSkipped(n.id, "no recipient");
        return;
      }
      const result = await sendEmail({
        to: n.recipient,
        from: process.env.SENDGRID_FROM_EMAIL ?? "notifications@shs.com",
        subject: payload.subject ?? "VRM notification",
        text: payload.body,
      });
      if (result.success) {
        await markNotificationSent(n.id);
        console.log(`[VRM Notif] Email sent to ${n.recipient} (decision ${n.decisionId})`);
      } else {
        await markNotificationFailed(n.id, result.error ?? "unknown email error");
        console.warn(`[VRM Notif] Email failed for decision ${n.decisionId}: ${result.error}`);
      }
    } else {
      await markNotificationSkipped(n.id, `unsupported channel: ${n.channel}`);
    }
  } catch (err: any) {
    await markNotificationFailed(n.id, err?.message ?? String(err));
    console.error(`[VRM Notif] Dispatch error (id=${n.id}):`, err?.message ?? err);
  }
}

let dispatcherStarted = false;
let dispatcherInFlight = false;

async function dispatchTick(): Promise<void> {
  if (dispatcherInFlight) return;
  dispatcherInFlight = true;
  try {
    const queued = await getQueuedNotifications(50);
    for (const n of queued) {
      await dispatchOne(n);
    }
  } catch (err: any) {
    console.error("[VRM Notif] Dispatcher tick error:", err?.message ?? err);
  } finally {
    dispatcherInFlight = false;
  }
}

/**
 * Start the 30-second drain loop.  Idempotent — calling twice does nothing.
 */
export function startNotificationDispatcher(): void {
  if (dispatcherStarted) return;
  dispatcherStarted = true;
  // First tick after a short delay so server boot isn't blocked.
  setTimeout(dispatchTick, 5_000);
  setInterval(dispatchTick, 30_000);
  console.log("[VRM Notif] Notification dispatcher started (30s interval)");
}
