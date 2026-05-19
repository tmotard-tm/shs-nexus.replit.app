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
  vrmRepairTracker,
  type VrmNotification,
} from "@shared/vrm-schema";
import { eq, desc, isNotNull, and, ne } from "drizzle-orm";
import {
  enqueueNotification,
  getQueuedNotifications,
  markNotificationSent,
  markNotificationFailed,
  markNotificationSkipped,
  getNotificationTemplates,
} from "./storage";
import { sendTwilioMessage } from "../fleet-scope-reg-messaging";
import { sendEmail } from "../email-service";

/**
 * BYOV (Bring Your Own Vehicle) program landing page.  Surfaced in the
 * deny-email body via the {{byov_link}} token; falls back to a plain mention
 * when the template is empty.  Update if the program URL changes.
 */
const BYOV_LINK = "https://shs.com/vrm/byov";

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
  const [supervisor, templateMap] = await Promise.all([
    getSupervisorContact(args.techLdap),
    loadTemplateMap(),
  ]);

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
      payload: buildPayload(ctx, "email", templateMap),
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
      payload: buildPayload(ctx, "sms", templateMap),
      status: "queued",
    });
    smsQueued = !!ins;
  }
  if (email) {
    const ins = await enqueueNotification({
      decisionId: args.decisionId,
      channel: "email",
      recipient: email,
      payload: buildPayload(ctx, "email", templateMap),
      status: "queued",
    });
    emailQueued = !!ins;
  }

  return { smsQueued, emailQueued, skipped: false };
}

// ─── Approval SMS (tech-facing) ────────────────────────────────────────────

/**
 * Fixed-copy SMS sent to the requesting tech when their rental request is
 * approved on the New Rental page. Copy is specified verbatim by Fleet
 * leadership — do not template/personalize without product sign-off.
 */
const APPROVAL_SMS_BODY =
  "Your recent Rental request has been approved, please contact ARI/Holman " +
  "to confirm the reservation. If this is an error please contact the fleet " +
  "team ASAP via SHSAI.\n\n" +
  "Remember that Rentals issued by Fleet are for work use only and off the " +
  "clock rental usage is not permitted. Any violation to this policy may " +
  "result in disciplinary action. Stay Safe and thank you for all you do!";

/**
 * Lookup the tech's mobile phone from the Repair Tracker mirror. The Repair
 * Tracker is the same source the New Rental evaluator uses, so the number
 * matches what the agent saw on screen at decision time. Returns null when
 * we have no usable number on file.
 */
async function getTechPhone(techLdap: string): Promise<string | null> {
  const upper = techLdap.toUpperCase();
  // Case-insensitive match: vrm_repair_tracker.tech_ldap casing is not
  // guaranteed (mirror is populated from multiple upstream sources).
  const [row] = await db
    .select({ techPhone: vrmRepairTracker.techPhone })
    .from(vrmRepairTracker)
    .where(
      and(
        sql`UPPER(${vrmRepairTracker.techLdap}) = ${upper}`,
        isNotNull(vrmRepairTracker.techPhone),
        ne(vrmRepairTracker.techPhone, ""),
      ),
    )
    .orderBy(desc(vrmRepairTracker.id))
    .limit(1);
  const v = (row?.techPhone ?? "").trim();
  return v || null;
}

/**
 * Called from the /profitability/log route after an Approved decision is
 * recorded. Enqueues a single SMS to the requesting technician (idempotent
 * via UNIQUE(decision_id, channel)). If no phone is on file, records a
 * single 'skipped' audit row so we can see the miss.
 *
 * `techPhoneOverride` lets the caller pass the number it already had in
 * front of the agent (e.g. from the evaluator row) so the SMS goes to
 * exactly the number the approver saw, even if the Repair Tracker mirror
 * has since changed.
 */
export async function enqueueApprovalSmsForTech(args: {
  decisionId: string;
  techLdap: string;
  techPhoneOverride?: string | null;
  techName?: string | null;
}): Promise<{ smsQueued: boolean; skipped: boolean }> {
  // The override is ONLY honored if it normalizes to the same digits as
  // the trusted Repair Tracker lookup for this LDAP. This blocks a
  // tampered request body from redirecting the approval SMS to an
  // arbitrary number while still letting the UI pin "the number the
  // approver saw" in the common case where the mirror hasn't drifted.
  const trusted = (await getTechPhone(args.techLdap)) ?? "";
  const overrideRaw = (args.techPhoneOverride ?? "").trim();
  const digits = (s: string) => s.replace(/\D+/g, "").replace(/^1/, "");
  const overrideMatches =
    overrideRaw.length > 0 &&
    trusted.length > 0 &&
    digits(overrideRaw) === digits(trusted);
  const phone = overrideMatches ? overrideRaw : trusted;

  // Resolve the body: use the Settings-configured template if present,
  // otherwise fall back to the Fleet-approved built-in copy. Tokens are
  // rendered with the tech's data; unknown tokens are left literal (the
  // save-time validator already rejected unknown tokens).
  const tmpl = await loadTemplateMap();
  const approvalTemplate = tmpl.sms_template_approve.trim();
  const vars: Record<string, string> = {
    tech_first_name: firstName(args.techName ?? null) || args.techLdap,
    tech_full_name: args.techName ?? args.techLdap,
    tech_ldap: args.techLdap,
    decision_date: todayLocalDate(),
  };
  const body = approvalTemplate
    ? renderTemplate(approvalTemplate, vars)
    : APPROVAL_SMS_BODY;

  // Tag the payload so dispatchOne knows to send via the dedicated VRM
  // one-way Twilio sender (when configured) instead of the shared
  // registration-line sender. This keeps tech replies off the reg inbox.
  const payload = { subject: null, body, isHtml: false, senderKey: "vrm_approval_oneway" as const };

  if (!phone) {
    await enqueueNotification({
      decisionId: args.decisionId,
      channel: "sms",
      recipient: "(missing)",
      payload,
      status: "skipped",
      error: "tech has no phone number on file",
    });
    return { smsQueued: false, skipped: true };
  }

  const ins = await enqueueNotification({
    decisionId: args.decisionId,
    channel: "sms",
    recipient: phone,
    payload,
    status: "queued",
  });
  return { smsQueued: !!ins, skipped: false };
}

// ─── Templates ─────────────────────────────────────────────────────────────

type TemplateKey =
  | "sms_template_deny"
  | "email_subject_template_deny"
  | "email_body_template_deny"
  | "sms_template_approve";
type TemplateMap = Record<TemplateKey, string>;

/**
 * Loads the configurable templates from vrm_notification_templates.  An empty
 * body or a missing row both yield "" — callers treat that as "use hard-coded
 * fallback".  Failure is logged and falls back to all-empty so dispatch still
 * succeeds.
 */
async function loadTemplateMap(): Promise<TemplateMap> {
  const empty: TemplateMap = {
    sms_template_deny: "",
    email_subject_template_deny: "",
    email_body_template_deny: "",
    sms_template_approve: "",
  };
  try {
    const rows = await getNotificationTemplates();
    const out: TemplateMap = { ...empty };
    for (const r of rows) {
      if (r.key in out) (out as any)[r.key] = r.body ?? "";
    }
    return out;
  } catch (err: any) {
    console.warn("[VRM Notif] Template lookup failed, falling back to defaults:", err?.message ?? err);
    return empty;
  }
}

/**
 * Renders a template with simple {{token}} replace.  Tokens not present in
 * `vars` are left literal so the dispatcher render can't accidentally hide
 * the issue (the routes layer already rejected unknown tokens at save time).
 */
function renderTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : `{{${name}}}`,
  );
}

/** Returns the first whitespace-separated token of a name, falling back to ""/raw. */
function firstName(full: string | null): string {
  const s = (full ?? "").trim();
  if (!s) return "";
  return s.split(/\s+/)[0];
}

function todayLocalDate(): string {
  return new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function buildVars(ctx: DenyContext, channel: "sms" | "email"): Record<string, string> {
  const techFull = ctx.techName ?? ctx.techLdap;
  const supFull = ctx.supervisor.supervisorName ?? "Supervisor";
  const vars: Record<string, string> = {
    supervisor_first_name: firstName(ctx.supervisor.supervisorName) || "Supervisor",
    supervisor_full_name: supFull,
    tech_first_name: firstName(ctx.techName) || ctx.techLdap,
    tech_full_name: techFull,
    tech_ldap: ctx.techLdap,
    decision_date: todayLocalDate(),
  };
  if (channel === "email") {
    vars.factors_html = buildFactorsHtml(ctx);
    vars.byov_link = BYOV_LINK;
  }
  return vars;
}

function buildFactorsHtml(ctx: DenyContext): string {
  const items: string[] = [];
  if (ctx.dailyNetWithRental != null) {
    items.push(`<li>Projected daily net with rental: ${escapeHtml(fmtMoney(ctx.dailyNetWithRental))}</li>`);
  }
  if (ctx.scorecardScore != null) {
    const s = Number(ctx.scorecardScore);
    if (Number.isFinite(s)) items.push(`<li>Scorecard score: ${s.toFixed(2)}</li>`);
  }
  if (ctx.tenureMonths != null) {
    items.push(`<li>Tenure: ${ctx.tenureMonths} months</li>`);
  }
  if (items.length === 0) items.push(`<li>(factor data not available)</li>`);
  return `<ul>${items.join("")}</ul>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

// ─── Body templates ────────────────────────────────────────────────────────

function fmtMoney(v: string | number | null): string {
  if (v == null) return "n/a";
  const n = Number(v);
  if (!Number.isFinite(n)) return "n/a";
  return `$${n.toFixed(2)}`;
}

function buildPayload(ctx: DenyContext, channel: "sms" | "email", templates: TemplateMap) {
  const techLabel = ctx.techName ? `${ctx.techName} (${ctx.techLdap})` : ctx.techLdap;
  const supName = ctx.supervisor.supervisorName ?? "Supervisor";
  const vars = buildVars(ctx, channel);

  if (channel === "sms") {
    const tmpl = templates.sms_template_deny.trim();
    const body = tmpl
      ? renderTemplate(tmpl, vars)
      : // Hard-coded fallback (preserved from the pre-template release).
        `Sears Home Services VRM: A rental vehicle request for ${techLabel} ` +
        `was denied. Please review with the tech. Detail follows by email.`;
    return { subject: null as string | null, body, isHtml: false };
  }

  // Email — subject + body.  When the user supplies a template that contains
  // {{factors_html}} (HTML) the dispatcher sends it as HTML; otherwise plain
  // text.  The hard-coded fallback is plain text (preserved as-is).
  const subjectTmpl = templates.email_subject_template_deny.trim();
  const bodyTmpl = templates.email_body_template_deny.trim();

  if (subjectTmpl || bodyTmpl) {
    const subject = subjectTmpl
      ? renderTemplate(subjectTmpl, vars)
      : `VRM: Rental request denied for ${techLabel}`;
    const body = bodyTmpl ? renderTemplate(bodyTmpl, vars) : buildDefaultEmailBody(ctx, supName, techLabel);
    const isHtml = bodyTmpl.includes("{{factors_html}}") || /<\w+[^>]*>/.test(body);
    return { subject, body, isHtml };
  }

  // Both templates empty → original hard-coded plain-text email.
  return {
    subject: `VRM: Rental request denied for ${techLabel}`,
    body: buildDefaultEmailBody(ctx, supName, techLabel),
    isHtml: false,
  };
}

function buildDefaultEmailBody(ctx: DenyContext, supName: string, techLabel: string): string {
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

  return (
    `Hello ${supName},\n\n` +
    `A rental vehicle request for ${techLabel} was denied based on the following profitability factors:\n\n` +
    `${factorsBlock}\n\n` +
    `BYOV (Bring Your Own Vehicle) is available as an alternative — please discuss the option with ${techLabel}.\n\n` +
    `If you believe this decision should be revisited, contact the VRM team.\n\n` +
    `— Sears Home Services Vehicle Rental Management`
  );
}

// ─── Worker ────────────────────────────────────────────────────────────────

async function dispatchOne(n: VrmNotification): Promise<void> {
  const payload = (n.payload ?? {}) as {
    subject: string | null;
    body: string;
    isHtml?: boolean;
    senderKey?: "vrm_approval_oneway";
  };

  try {
    if (n.channel === "sms") {
      if (!n.recipient || n.recipient === "(missing)") {
        await markNotificationSkipped(n.id, "no recipient");
        return;
      }
      // VRM approval SMS uses a dedicated one-way Twilio sender (when
      // configured) so technician replies don't land in the shared
      // registration inbox. Falls back to the registration sender if the
      // VRM_APPROVAL_TWILIO_* env vars are not set.
      const senderOverride =
        payload.senderKey === "vrm_approval_oneway"
          ? {
              accountSid: process.env.VRM_APPROVAL_TWILIO_ACCOUNT_SID,
              authToken: process.env.VRM_APPROVAL_TWILIO_AUTH_TOKEN,
              from: process.env.VRM_APPROVAL_TWILIO_FROM,
            }
          : undefined;
      await sendTwilioMessage(n.recipient, payload.body, undefined, senderOverride);
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
        ...(payload.isHtml ? { html: payload.body } : { text: payload.body }),
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
