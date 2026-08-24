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
 * Lookup the tech's mobile phone for outbound VRM decision SMS.
 *
 * Source-of-truth order (TPMS first — matches replit.md gotcha that
 * Snowflake TPMS_EXTRACT is the canonical source for tech phone, and
 * matches the Full Log auto-populate path in upsertFullLogFromDecision
 * which reads tpms_tech_profiles directly):
 *
 *   1. tpms_tech_profiles.mobile_phone   ← primary (in-DB mirror of TPMS_EXTRACT,
 *                                          refreshed by the nightly Tech Data
 *                                          Scheduler)
 *   2. vrm_repair_tracker.tech_phone     ← fallback for the rare case where
 *                                          TPMS hasn't been refreshed yet but
 *                                          the tech already has a tracker row
 *                                          from a prior denial
 *
 * The previous implementation only checked vrm_repair_tracker, which is a
 * denial-only mirror — so first-time approved techs (no prior denial → no
 * tracker row) had no phone resolved and approval SMS was silently skipped
 * with "(missing)" even though TPMS had the number on file. Returns null
 * only when both sources are empty.
 */
async function getTechPhone(techLdap: string): Promise<string | null> {
  const upper = techLdap.toUpperCase();

  // 1) TPMS profiles — the canonical source. Same query the Full Log
  //    auto-populate uses (server/vrm/storage.ts upsertFullLogFromDecision).
  try {
    const tpmsRes = await db.execute(sql`
      SELECT mobile_phone
      FROM tpms_tech_profiles
      WHERE UPPER(enterprise_id) = ${upper}
        AND mobile_phone IS NOT NULL
        AND mobile_phone <> ''
      LIMIT 1
    `);
    const tpmsPhone = (((tpmsRes as any).rows ?? [])[0]?.mobile_phone ?? "").trim();
    if (tpmsPhone) return tpmsPhone;
  } catch (e: any) {
    console.warn(
      `[VRM SMS] getTechPhone TPMS lookup failed for ${upper}: ${e?.message ?? e} — falling back to repair tracker`,
    );
  }

  // 2) Fallback: vrm_repair_tracker (denial-only mirror). Case-insensitive
  //    match because tech_ldap casing isn't guaranteed across upstream sources.
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

// ─── Denial SMS (tech-facing) ──────────────────────────────────────────────

/**
 * Fixed-copy SMS sent to the requesting tech when their rental request is
 * DENIED. Copy is specified verbatim by Fleet leadership — do not template
 * or personalize beyond the leading "Good Morning {{first_name}}" without
 * product sign-off. Pushes the BYOV temporary-enrollment landing page so
 * the tech has an immediate path back to running their route.
 */
const DENIAL_BYOV_LINK = "https://byov-enrollment.replit.app";
export const DENIAL_SMS_BODY_TEMPLATE =
  "Good Morning {{tech_first_name}}, This is the Fleet team. Unfortunately the " +
  "rental you requested this morning is unable to be approved due to the " +
  "company's current guidelines. While your vehicle is in the shop you have " +
  "a couple of options.\n\n" +
  "Enroll in BYOV to drive your own vehicle to run your route and continue " +
  "working while ALSO getting paid for every mile driven - you pay for your " +
  "gas and get a weekly Tax Free reimbursement.\n\n" +
  "The only other option in the meantime is you would have your route " +
  "cleared and be without the ability to run a route until your van is " +
  "fixed. To enroll your vehicle temporarily simply go to:\n" +
  "{{byov_link}}\n\n" +
  "review the program, enroll using the temporary option in the Enroll " +
  "section at the upper right side. Note a $100 bonus is available after " +
  "the first week on BYOV Temporary.";

/**
 * Called from the /profitability/log route after a Denied decision is
 * recorded. Enqueues a single SMS to the requesting technician on the
 * dedicated `sms_tech_deny` channel so it can coexist with the supervisor
 * "sms" row for the same decision_id (UNIQUE(decision_id, channel)).
 *
 * Like the approval flow, `techPhoneOverride` lets the caller pin the
 * number the agent saw, validated against the Repair Tracker mirror.
 * If no phone is on file, records a single 'skipped' audit row.
 */
export async function enqueueDenialSmsForTech(args: {
  decisionId: string;
  techLdap: string;
  techPhoneOverride?: string | null;
  techName?: string | null;
}): Promise<{ smsQueued: boolean; skipped: boolean }> {
  const trusted = (await getTechPhone(args.techLdap)) ?? "";
  const overrideRaw = (args.techPhoneOverride ?? "").trim();
  const digits = (s: string) => s.replace(/\D+/g, "").replace(/^1/, "");
  const overrideMatches =
    overrideRaw.length > 0 &&
    trusted.length > 0 &&
    digits(overrideRaw) === digits(trusted);
  const phone = overrideMatches ? overrideRaw : trusted;
  // Fix #4 — Override-Overridden Visibility. When a non-empty override was
  // passed but failed digit-match against the trusted lookup, the dispatcher
  // silently substituted the trusted number. Log loudly and persist the audit
  // metadata so the UI can render a "Number corrected" badge.
  const overrideOverridden = overrideRaw.length > 0 && !overrideMatches;
  if (overrideOverridden) {
    console.warn(
      `[VRM SMS] enqueueDenialSmsForTech — override rejected for tech=${args.techLdap}: ui=${digits(overrideRaw) || "(empty)"}, trusted=${digits(trusted) || "(empty)"}. Falling back to trusted.`,
    );
  }

  // Resolve template body: custom from vrm_notification_templates if the
  // operator has saved one on the Settings page, otherwise the hard-coded
  // Fleet-approved default. Tokens supported: tech_first_name,
  // tech_full_name, tech_ldap, decision_date, byov_link.
  const templates = await loadTemplateMap();
  const customTmpl = templates.sms_template_deny_tech.trim();
  const tmpl = customTmpl || DENIAL_SMS_BODY_TEMPLATE;
  const first = firstName(args.techName ?? null) || args.techLdap;
  const vars: Record<string, string> = {
    tech_first_name: first,
    tech_full_name: args.techName ?? args.techLdap,
    tech_ldap: args.techLdap,
    decision_date: todayLocalDate(),
    byov_link: DENIAL_BYOV_LINK,
  };
  const body = renderTemplate(tmpl, vars);

  // Same one-way Twilio sender as approval SMS so tech replies don't land
  // in the shared registration inbox.
  const payload = { subject: null, body, isHtml: false, senderKey: "vrm_approval_oneway" as const };

  if (!phone) {
    await enqueueNotification({
      decisionId: args.decisionId,
      channel: "sms_tech_deny",
      recipient: "(missing)",
      payload,
      status: "skipped",
      error: "tech has no phone number on file",
      uiDisplayedPhone: overrideRaw || null,
      trustedPhone: trusted || null,
      overrideOverridden,
    });
    return { smsQueued: false, skipped: true };
  }

  const ins = await enqueueNotification({
    decisionId: args.decisionId,
    channel: "sms_tech_deny",
    recipient: phone,
    payload,
    status: "queued",
    uiDisplayedPhone: overrideOverridden ? overrideRaw : null,
    trustedPhone: overrideOverridden ? trusted : null,
    overrideOverridden,
  });
  return { smsQueued: !!ins, skipped: false };
}

// ─── New-process redirect denial (Holman-originated requests) ──────────────

/**
 * Public rental-request form — the destination every Holman-originated
 * request gets redirected to. Same base-URL convention as the rest of the
 * forms module (rental-request.ts).
 */
const RENTAL_REQUEST_LINK =
  (process.env.PUBLIC_BASE_URL || "https://SHS-Nexus.replit.app").replace(/\/+$/, "") + "/rental-request";

/**
 * Policy (Fleet leadership, 2026-08-23): rentals are no longer approved
 * through Holman — new requests AND extensions arriving on the Holman
 * awaiting grid are denied and the tech is redirected to the new
 * rental-request process. Two variants:
 *
 *  - redirect  — tech was never moved to direct billing: point them at the
 *                rental-request form.
 *  - switched  — tech is ALREADY booked on the new direct-billing process
 *                and called Holman anyway ("didn't follow the process"):
 *                same redirect plus the Enterprise-branch billing option.
 *
 * Both are Settings-overridable (sms_template_deny_holman_redirect /
 * sms_template_deny_holman_switched) like every other VRM template.
 */
export const HOLMAN_REDIRECT_SMS_BODY_TEMPLATE =
  "Good Morning {{tech_first_name}}, this is the Fleet team. Rental requests " +
  "and extensions through Holman are no longer approved — rentals are now " +
  "handled through our new process, so this request was denied.\n\n" +
  "To get or keep a rental while your van is in the shop, submit a rental " +
  "request here:\n{{rental_request_link}}\n\n" +
  "Calling Holman or the rental branch will not get a rental approved or extended.";

export const HOLMAN_SWITCHED_SMS_BODY_TEMPLATE =
  "Good Morning {{tech_first_name}}, this is the Fleet team. Your rental was " +
  "already switched to our new direct-billing process (reservation " +
  "{{etd_reference}}). Requesting a rental or extension through Holman is not " +
  "the correct process, and that request has been denied.\n\n" +
  "If you still need a rental, submit a rental request here:\n" +
  "{{rental_request_link}}\n\n" +
  "Or stop by your Enterprise branch and have them confirm your rental is on " +
  "the new direct billing.\n\n" +
  "Going forward, calling Holman will not get a rental approved or extended.";

/**
 * Tech-facing denial SMS for a Holman-queue deny under the new-process
 * policy. Same channel ('sms_tech_deny', idempotent per decision), same
 * one-way sender and phone-trust rules as enqueueDenialSmsForTech — only the
 * copy differs, branched on the tech's direct-billing standing.
 */
export async function enqueueHolmanRedirectDenialSmsForTech(args: {
  decisionId: string;
  techLdap: string;
  techName?: string | null;
  standing: "booked" | "none";
  etdReference?: string | null;
}): Promise<{ smsQueued: boolean; skipped: boolean }> {
  const phone = (await getTechPhone(args.techLdap)) ?? "";

  const templates = await loadTemplateMap();
  const custom = args.standing === "booked"
    ? templates.sms_template_deny_holman_switched.trim()
    : templates.sms_template_deny_holman_redirect.trim();
  const tmpl = custom || (args.standing === "booked"
    ? HOLMAN_SWITCHED_SMS_BODY_TEMPLATE
    : HOLMAN_REDIRECT_SMS_BODY_TEMPLATE);
  const vars: Record<string, string> = {
    tech_first_name: firstName(args.techName ?? null) || args.techLdap,
    tech_full_name: args.techName ?? args.techLdap,
    tech_ldap: args.techLdap,
    decision_date: todayLocalDate(),
    rental_request_link: RENTAL_REQUEST_LINK,
    // Blank reference renders as "reservation on file" rather than a hole.
    etd_reference: (args.etdReference ?? "").trim() || "on file",
  };
  const body = renderTemplate(tmpl, vars);
  const payload = { subject: null, body, isHtml: false, senderKey: "vrm_approval_oneway" as const };

  if (!phone) {
    await enqueueNotification({
      decisionId: args.decisionId,
      channel: "sms_tech_deny",
      recipient: "(missing)",
      payload,
      status: "skipped",
      error: "tech has no phone number on file",
    });
    return { smsQueued: false, skipped: true };
  }

  const ins = await enqueueNotification({
    decisionId: args.decisionId,
    channel: "sms_tech_deny",
    recipient: phone,
    payload,
    status: "queued",
  });
  return { smsQueued: !!ins, skipped: false };
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
  // Fix #4 — Override-Overridden Visibility (see enqueueDenialSmsForTech).
  const overrideOverridden = overrideRaw.length > 0 && !overrideMatches;
  if (overrideOverridden) {
    console.warn(
      `[VRM SMS] enqueueApprovalSmsForTech — override rejected for tech=${args.techLdap}: ui=${digits(overrideRaw) || "(empty)"}, trusted=${digits(trusted) || "(empty)"}. Falling back to trusted.`,
    );
  }

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
      uiDisplayedPhone: overrideRaw || null,
      trustedPhone: trusted || null,
      overrideOverridden,
    });
    return { smsQueued: false, skipped: true };
  }

  const ins = await enqueueNotification({
    decisionId: args.decisionId,
    channel: "sms",
    recipient: phone,
    payload,
    status: "queued",
    uiDisplayedPhone: overrideOverridden ? overrideRaw : null,
    trustedPhone: overrideOverridden ? trusted : null,
    overrideOverridden,
  });
  return { smsQueued: !!ins, skipped: false };
}

// ─── Templates ─────────────────────────────────────────────────────────────

type TemplateKey =
  | "sms_template_deny"
  | "email_subject_template_deny"
  | "email_body_template_deny"
  | "sms_template_approve"
  | "sms_template_deny_tech"
  | "sms_template_deny_holman_redirect"
  | "sms_template_deny_holman_switched";
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
    sms_template_deny_tech: "",
    sms_template_deny_holman_redirect: "",
    sms_template_deny_holman_switched: "",
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
    if (n.channel === "sms" || n.channel === "sms_tech_deny") {
      if (!n.recipient || n.recipient === "(missing)") {
        await markNotificationSkipped(n.id, "no recipient");
        return;
      }
      // VRM approval SMS uses a dedicated one-way Twilio sender (when
      // configured) so technician replies don't land in the shared
      // registration inbox. Setting VRM_APPROVAL_TWILIO_FROM alone is
      // enough when the number lives in the same Twilio account as the
      // registration line — we reuse the FS_TWILIO_* sid/token in that
      // case. If the number is in a different Twilio account, also set
      // VRM_APPROVAL_TWILIO_ACCOUNT_SID and VRM_APPROVAL_TWILIO_AUTH_TOKEN.
      const senderOverride =
        payload.senderKey === "vrm_approval_oneway" && process.env.VRM_APPROVAL_TWILIO_FROM
          ? {
              accountSid:
                process.env.VRM_APPROVAL_TWILIO_ACCOUNT_SID ?? process.env.FS_TWILIO_ACCOUNT_SID,
              authToken:
                process.env.VRM_APPROVAL_TWILIO_AUTH_TOKEN ?? process.env.FS_TWILIO_AUTH_TOKEN,
              from: process.env.VRM_APPROVAL_TWILIO_FROM,
            }
          : undefined;
      // Build a per-message status callback URL so Twilio POSTs the
      // delivery lifecycle (queued/sent/delivered/undelivered/failed)
      // back to /api/vrm/webhooks/twilio-status. If no public base URL
      // is configured, omit the callback and degrade gracefully — the
      // SMS still goes out, we just don't get terminal-state updates.
      const publicBase = (process.env.VRM_PUBLIC_BASE_URL || process.env.SAML_BASE_URL || "").replace(/\/+$/, "");
      const statusCallback = publicBase ? `${publicBase}/api/vrm/webhooks/twilio-status` : undefined;
      const twilioSid = await sendTwilioMessage(n.recipient, payload.body, undefined, senderOverride, statusCallback);
      await markNotificationSent(n.id, { twilioSid });
      console.log(`[VRM Notif] SMS sent to ${n.recipient} (decision ${n.decisionId}, sid ${twilioSid})`);
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
// Wall-clock time the in-flight guard was taken, used by the watchdog to
// force-clear a tick that has run impossibly long (a self-heal so a future
// stall doesn't require a server restart).
let inFlightSince = 0;
// Set when a dispatch is requested while a tick is already running. The
// active tick re-checks this after draining so a row enqueued mid-tick (after
// the queue snapshot was taken) is still picked up immediately, instead of
// waiting for the next 30s poll.
let rerunRequested = false;

// A single dispatchOne should never run longer than this. dispatchOne already
// wraps its Twilio send in a timeout, but this is a belt-and-suspenders bound
// so a hang anywhere else in dispatchOne (e.g. a stuck DB write) can't wedge
// the drain loop either.
const PER_MESSAGE_TIMEOUT_MS = 30_000;
// If the in-flight guard has been held longer than this, assume the tick is
// wedged and force-clear it so the next trigger can proceed. Must be safely
// larger than one full batch of per-message timeouts in practice.
const TICK_WATCHDOG_MS = 90_000;

/**
 * Reject if `promise` doesn't settle within `ms`. Used to bound a single
 * dispatchOne so one slow/stuck message can't freeze the whole drain loop.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

async function dispatchTick(): Promise<void> {
  if (dispatcherInFlight) {
    // Watchdog: a tick that has been "in flight" for far too long is assumed
    // wedged. Force-clear the guard so this run (and future ones) can proceed
    // — the system self-heals without a restart.
    if (inFlightSince && Date.now() - inFlightSince > TICK_WATCHDOG_MS) {
      console.warn(
        `[VRM Notif] Watchdog force-clearing stuck in-flight guard (held ${Date.now() - inFlightSince}ms)`,
      );
      dispatcherInFlight = false;
    } else {
      // A tick is genuinely running. Ask it to re-drain once it finishes so a
      // row enqueued after its snapshot isn't stranded until the next poll.
      rerunRequested = true;
      console.log("[VRM Notif] Tick skipped (already running); requested rerun");
      return;
    }
  }

  dispatcherInFlight = true;
  inFlightSince = Date.now();
  try {
    do {
      rerunRequested = false;
      const queued = await getQueuedNotifications(50);
      for (const n of queued) {
        try {
          await withTimeout(dispatchOne(n), PER_MESSAGE_TIMEOUT_MS, `dispatchOne(id=${n.id})`);
        } catch (perMsgErr: any) {
          // A bounded failure of a single message must not abort the batch —
          // mark it failed (best-effort) and keep draining the rest so one
          // poison/slow row can't block the queue.
          console.error(
            `[VRM Notif] Per-message timeout/error (id=${n.id}, decision ${n.decisionId}):`,
            perMsgErr?.message ?? perMsgErr,
          );
          try {
            await markNotificationFailed(n.id, perMsgErr?.message ?? String(perMsgErr));
          } catch (markErr: any) {
            console.error(
              `[VRM Notif] Failed to mark notification ${n.id} as failed:`,
              markErr?.message ?? markErr,
            );
          }
        }
      }
    } while (rerunRequested);
  } catch (err: any) {
    console.error("[VRM Notif] Dispatcher tick error:", err?.message ?? err);
  } finally {
    dispatcherInFlight = false;
    inFlightSince = 0;
  }
}

/**
 * Fire-and-forget immediate drain, called right after a decision enqueues its
 * notification rows so SMS goes out within a second or two instead of waiting
 * for the next 30s poll. Shares dispatchTick (and therefore the same send +
 * idempotency code) with the background worker, so the two can never
 * double-send a row: dispatchTick's in-flight guard serializes them, and the
 * UNIQUE(decision_id, channel) index plus queued→sent transitions prevent a
 * row already sent from being picked up again.
 *
 * Never throws into the caller — a failed immediate send leaves the row
 * `queued` for the backstop worker to retry.
 */
export function triggerImmediateDispatch(reason: string): void {
  console.log(`[VRM Notif] Immediate dispatch requested (${reason})`);
  dispatchTick().catch((err: any) =>
    console.error("[VRM Notif] Immediate dispatch error:", err?.message ?? err),
  );
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
