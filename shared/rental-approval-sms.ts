/**
 * Approval-drawer helpers: the Friday→Monday pickup default and the
 * weekend-aware approval SMS copy.
 *
 * PURE ON PURPOSE. No db, no Snowflake, no express imports — the Saturday
 * schedule itself is fetched by the route (fetchScheduleWindow) and handed in
 * here as a tri-state, so every branch of the policy is unit-testable offline.
 *
 * THE POLICY (task 719, Tyler's ops practice): a rental processed on a Friday
 * is booked for the following Monday — the branch counter is a ghost town on
 * weekends and a Friday-afternoon car sits on the technician's driveway for
 * two unpaid days — UNLESS the technician is actually scheduled to work
 * Saturday, in which case they need the car tomorrow and the earliest date
 * stands. When the schedule cannot be trusted (stale watermark, missing
 * snapshot, Snowflake down) we default to Monday and SAY SO: the approver is
 * looking at the field and can always type a different date.
 */

export type SaturdayStatus = "working" | "not_working" | "unknown";

/** Today's calendar date in ET — the policy's clock lives where ops lives. */
export function etTodayISO(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** The ET calendar date a timestamp lands on ("" for null/garbage). */
export function etDateISO(ts: string | Date | null | undefined): string {
  if (!ts) return "";
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** 0=Sun … 5=Fri, 6=Sat for a YYYY-MM-DD calendar date. */
export function dayOfWeekISO(iso: string): number {
  // Noon UTC: immune to DST and TZ-of-the-host edges for a pure calendar date.
  return new Date(`${iso}T12:00:00Z`).getUTCDay();
}

export function isFridayISO(iso: string): boolean {
  return dayOfWeekISO(iso) === 5;
}

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type PickupSuggestion = {
  pickupDateISO: string;
  rolledToMonday: boolean;
  reason: string;
};

/**
 * The drawer's pickup default for a request whose effective start is
 * `baseISO`. Only a Friday base moves; every other day keeps the earliest
 * date. `reason` is the sentence the drawer shows beside the field — it must
 * always explain the default, including when nothing moved.
 */
export function fridayPickupSuggestion(args: {
  baseISO: string;
  saturday: SaturdayStatus;
}): PickupSuggestion {
  const { baseISO, saturday } = args;
  if (!isFridayISO(baseISO)) {
    return { pickupDateISO: baseISO, rolledToMonday: false, reason: "" };
  }
  if (saturday === "working") {
    return {
      pickupDateISO: baseISO,
      rolledToMonday: false,
      reason: "Tech IS scheduled to work Saturday — keeping the earliest pickup.",
    };
  }
  const monday = addDaysISO(baseISO, 3);
  return {
    pickupDateISO: monday,
    rolledToMonday: true,
    reason:
      saturday === "not_working"
        ? `Tech not scheduled Saturday — defaulted to Monday ${monday}.`
        : `Saturday schedule could not be verified — defaulted to Monday ${monday}. Adjust if the tech works Saturday.`,
  };
}

// ---------------------------------------------------------------------------
// Approval SMS copy
// ---------------------------------------------------------------------------

/**
 * Hard-coded fallbacks for the /decide APPROVE acknowledgement. Settings can
 * override both via vrm_notification_templates (keys below); an empty saved
 * body falls back here — same contract as the dispatcher's templates.
 *
 * ⚠ The client-side TEMPLATE_DEFAULTS in Settings.tsx repeats these strings
 * so the editor can show the default in place. Change them together.
 */
export const REQUEST_APPROVE_TEMPLATE_KEY = "sms_template_request_approve";
export const REQUEST_APPROVE_MONDAY_TEMPLATE_KEY = "sms_template_request_approve_monday";

export const REQUEST_APPROVE_SMS_DEFAULT =
  "Sears Fleet: your rental request is approved. We are booking the reservation "
  + "for pickup {{pickup_day}} {{pickup_date}} and will text you the confirmation "
  + "number and branch.";

export const REQUEST_APPROVE_SMS_MONDAY_DEFAULT =
  "Sears Fleet: your rental request is approved. Your rental is reserved for "
  + "{{pickup_day}} {{pickup_date}}. We will text you the confirmation number and "
  + "branch. Need a ride home today? Text SHSAI to get an Uber home after "
  + "12:00 PM your local time.";

/** Tokens both request-approve templates may use (save-time validated in routes.ts). */
export const REQUEST_APPROVE_SMS_TOKENS = [
  "tech_first_name",
  "tech_full_name",
  "tech_ldap",
  "pickup_date",
  "pickup_day",
] as const;

/**
 * The one bound on an approver-edited body. Twilio concatenates far beyond
 * this, but a 1000-character approval text is a letter, not an SMS.
 */
export const APPROVAL_SMS_MAX_LEN = 1000;

/**
 * Save-time cap for the two request-approve template BODIES in Settings.
 * Deliberately tighter than APPROVAL_SMS_MAX_LEN: tokens expand at render
 * time ({{tech_full_name}} → a real name, dates → "Wednesday Sep 30"), and a
 * template an admin could save but no approval could ever send would 400
 * every decide. 200 characters of headroom comfortably covers the worst
 * combined expansion of the five allowed tokens.
 */
export const REQUEST_APPROVE_TEMPLATE_MAX_LEN = APPROVAL_SMS_MAX_LEN - 200;

/**
 * Conservative per-token ceilings for worst-case render-length math. These
 * are deliberately generous (an 80-character full name, a 20-character LDAP)
 * — the point is an upper bound the save-time guard can trust, not realism.
 */
export const APPROVAL_SMS_TOKEN_MAX_LEN: Record<string, number> = {
  tech_first_name: 40,
  tech_full_name: 80,
  tech_ldap: 20,
  pickup_date: 12, // "Sep 30"
  pickup_day: 9,   // "Wednesday"
};

/**
 * The longest body this template could EVER render to: every known-token
 * occurrence counted at the larger of its literal length and its ceiling
 * (unknown tokens stay literal at render, so they count as written). A raw
 * length cap alone is not expansion-safe — 40 repetitions of
 * {{tech_full_name}} fit in 800 characters yet render to 3,200 — so the
 * save-time guard must bound THIS number, not the template's own length.
 */
export function worstCaseRenderedLen(template: string): number {
  const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  let len = 0;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) {
    len += m.index - last;
    const ceiling = APPROVAL_SMS_TOKEN_MAX_LEN[m[1]];
    len += ceiling !== undefined ? Math.max(ceiling, m[0].length) : m[0].length;
    last = m.index + m[0].length;
  }
  return len + (template.length - last);
}

/**
 * Save-time verdict for the two request-approve template bodies: within the
 * raw cap AND guaranteed to render within APPROVAL_SMS_MAX_LEN under the
 * worst-case token expansion. "" (clear back to built-in) is always fine.
 */
export function validateRequestApproveTemplate(body: string): { ok: true } | { ok: false; message: string } {
  if (body.length > REQUEST_APPROVE_TEMPLATE_MAX_LEN) {
    return { ok: false, message: `body exceeds ${REQUEST_APPROVE_TEMPLATE_MAX_LEN} character limit` };
  }
  const worst = worstCaseRenderedLen(body);
  if (worst > APPROVAL_SMS_MAX_LEN) {
    return {
      ok: false,
      message: `after token expansion this template could render to ${worst} characters; `
             + `the sent-SMS cap is ${APPROVAL_SMS_MAX_LEN}. Remove repeated tokens or shorten the text.`,
    };
  }
  return { ok: true };
}

/** {{token}} replace; unknown tokens stay literal so a typo is visible, not hidden. */
export function renderSmsTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : `{{${name}}}`,
  );
}

/** "2026-08-24" → { pickup_date: "Aug 24", pickup_day: "Monday" }. */
export function pickupDateTokens(iso: string): { pickup_date: string; pickup_day: string } {
  const d = new Date(`${iso}T12:00:00Z`);
  return {
    pickup_date: d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" }),
    pickup_day: d.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long" }),
  };
}

/**
 * The default approval SMS for one request: the Monday-roll copy (with the
 * SHSAI Uber-home line) when the pickup was defaulted to Monday, the standard
 * copy otherwise. `templates` carries the Settings overrides ("" = none).
 */
export function buildApprovalSmsDefault(args: {
  pickupISO: string;
  mondayRolled: boolean;
  techName: string | null;
  techLdap: string;
  templates: { standard: string; monday: string };
}): string {
  const base = args.mondayRolled
    ? (args.templates.monday.trim() || REQUEST_APPROVE_SMS_MONDAY_DEFAULT)
    : (args.templates.standard.trim() || REQUEST_APPROVE_SMS_DEFAULT);
  const name = (args.techName ?? "").trim();
  const vars: Record<string, string> = {
    tech_first_name: name ? name.split(/\s+/)[0] : args.techLdap,
    tech_full_name: name || args.techLdap,
    tech_ldap: args.techLdap,
    ...pickupDateTokens(args.pickupISO),
  };
  // Hard cap on EVERY rendered body — preview, decide fallback, audit row —
  // so even a template that predates the save-time expansion guard can never
  // hand the SMS sender an over-cap message. Preview and send share this
  // clamp, so what the approver sees is still exactly what goes out.
  return renderSmsTemplate(base, vars).slice(0, APPROVAL_SMS_MAX_LEN);
}

// ---------------------------------------------------------------------------
// Drawer state — pure, so "approve before the server context arrives" is a
// unit-testable scenario, not a race the UI hopes never happens.
// ---------------------------------------------------------------------------

export type InitialDrawerDefaults = {
  /** The date the pickup field opens with. */
  pickupDateISO: string;
  /** True → open the time field at 08:00; false → keep the next-hour default. */
  useMorningTime: boolean;
  rolledToMonday: boolean;
  /** Shown beside the field while the server's schedule answer is pending. */
  pendingReason: string;
  /** NEVER empty: the SMS an APPROVE would send before any server answer. */
  smsBody: string;
};

/**
 * What the drawer holds the INSTANT it opens, before (or instead of) any
 * server answer. The Saturday schedule is unknown at this point, so a Friday
 * base follows the policy's safe branch — Monday pickup and the Monday/Uber
 * copy — and only a fresh "works Saturday" answer moves it back. This is what
 * closes the cold-start hole: an approver who clicks APPROVE immediately still
 * sends the Monday default, never a blank that decays to generic copy.
 *
 * Rendered with the BUILT-IN templates (no Settings overrides — the client
 * does not have them); the server context replaces the body with the
 * override-aware render moments later unless the approver already edited.
 */
export function initialApprovalDrawerDefaults(args: {
  todayISO: string;
  /** ET date of the tech's requested pickup, "" when absent. */
  requestedPickupISO: string;
  techName: string | null;
  techLdap: string;
  /** Settings overrides when the client has them; omit → built-in copy. */
  templates?: { standard: string; monday: string };
}): InitialDrawerDefaults {
  const base = args.requestedPickupISO && args.requestedPickupISO > args.todayISO
    ? args.requestedPickupISO
    : args.todayISO;
  const sugg = fridayPickupSuggestion({ baseISO: base, saturday: "unknown" });
  return {
    pickupDateISO: sugg.pickupDateISO,
    useMorningTime: sugg.rolledToMonday || sugg.pickupDateISO !== args.todayISO,
    rolledToMonday: sugg.rolledToMonday,
    pendingReason: sugg.rolledToMonday
      ? `Checking the Saturday schedule — defaulted to Monday ${sugg.pickupDateISO}. `
        + "Switches back automatically if the tech works Saturday."
      : "",
    smsBody: buildApprovalSmsDefault({
      pickupISO: sugg.pickupDateISO,
      mondayRolled: sugg.rolledToMonday,
      techName: args.techName,
      techLdap: args.techLdap,
      templates: args.templates ?? { standard: "", monday: "" },
    }),
  };
}

/**
 * The decide route's body resolution — ONE function decides what an APPROVE
 * sends and audits, whether or not the client supplied a body.
 *
 * A non-blank override wins verbatim: a human reviewed those exact words.
 * A blank/absent override (API caller, or an approver who cleared the box)
 * renders the SAME policy default the drawer previews: standard copy for the
 * booked date, or the Monday/Uber copy exactly when the booked start is the
 * policy's rolled Monday for a Friday base. Deterministic — no schedule
 * lookup — so the decide path stays fast, and the legacy generic literal is
 * gone: blank input can never bypass the Friday→Monday copy.
 */
export function resolveApprovalDecideSms(args: {
  override: string;
  todayISO: string;
  /** ET date of the row's own pickup ("" when none). */
  requestedPickupISO: string;
  /** ET date the approval actually books from ("" falls back to the base). */
  effectivePickupISO: string;
  techName: string | null;
  techLdap: string;
  templates: { standard: string; monday: string };
}): { body: string; mondayCopy: boolean } {
  // trim() decides ONLY whether the override is blank. A non-blank human
  // edit is preserved byte-for-byte — what the approver saw in the textarea
  // is exactly what is sent and audited, whitespace and newlines included.
  if (args.override.trim()) return { body: args.override, mondayCopy: false };
  const base = args.requestedPickupISO && args.requestedPickupISO > args.todayISO
    ? args.requestedPickupISO
    : args.todayISO;
  const pickup = args.effectivePickupISO || base;
  const mondayCopy = isFridayISO(base) && pickup === addDaysISO(base, 3);
  return {
    body: buildApprovalSmsDefault({
      pickupISO: pickup,
      mondayRolled: mondayCopy,
      techName: args.techName,
      techLdap: args.techLdap,
      templates: args.templates,
    }),
    mondayCopy,
  };
}

/**
 * Gate for the APPROVE click — the what-you-see-is-what-sends contract.
 *
 * The client always submits the exact bytes in the preview textarea, so the
 * technician and the audit trail can never diverge from what the approver
 * saw. That makes template freshness the only remaining race: an UNTOUCHED
 * default may only be sent once the Settings templates that rendered it have
 * actually arrived (the fast templates fetch or the server context render) —
 * otherwise the approver would be committing copy they never chose. A human
 * EDIT is always allowed: those bytes were reviewed by definition. Blank
 * never sends. Template-fetch failure therefore blocks visibly instead of
 * silently falling back to built-in copy.
 */
/**
 * Per-drawer-open template freshness, tracked independently of any query
 * cache. React Query happily serves yesterday's templates from cache, so
 * "we have template data" is NOT "this drawer's templates are current".
 * Every drawer open takes a new sequence number; only a fetch result that
 * comes back FOR that sequence can mark the open ready (or failed). A late
 * answer to an earlier open is ignored — it describes a drawer that no
 * longer exists.
 */
export type TplFreshness = { openSeq: number; readySeq: number; errorSeq: number };
export const TPL_FRESHNESS_INIT: TplFreshness = { openSeq: 0, readySeq: -1, errorSeq: -1 };

export function tplFreshnessOnOpen(s: TplFreshness, seq: number): TplFreshness {
  return { ...s, openSeq: seq };
}

export function tplFreshnessOnResult(s: TplFreshness, forSeq: number, ok: boolean): TplFreshness {
  if (forSeq !== s.openSeq) return s; // stale answer for a drawer that's gone
  return ok ? { ...s, readySeq: forSeq } : { ...s, errorSeq: forSeq };
}

/** Ready = THIS open's fetch succeeded. Cached data never qualifies. */
export function tplTemplatesReady(s: TplFreshness): boolean {
  return s.openSeq > 0 && s.readySeq === s.openSeq;
}

/** Failed = THIS open's fetch errored and never recovered. */
export function tplTemplatesFailed(s: TplFreshness): boolean {
  return s.openSeq > 0 && s.errorSeq === s.openSeq && s.readySeq !== s.openSeq;
}

/**
 * Once-per-drawer-open latch for date reconciliation. The context's
 * Monday→Friday move (tech works Saturday) must apply exactly once per OPEN
 * — not once per request forever. The marker therefore starts null on every
 * open (the click and close handlers reset it unconditionally); the first
 * context application per open latches it, later re-fetches for the same
 * open see first=false and leave the approver's drawer alone.
 */
export function takeFirstContextApplication(
  marker: { current: number | null },
  requestNo: number,
): boolean {
  const first = marker.current !== requestNo;
  if (first) marker.current = requestNo;
  return first;
}

export function approvalSendGate(args: {
  smsBody: string;
  smsEdited: boolean;
  /** true once THIS drawer open's own template fetch succeeded (see TplFreshness). */
  templatesReady: boolean;
}): { ok: true } | { ok: false; message: string } {
  if (!args.smsBody.trim()) {
    return {
      ok: false,
      message: "The approval text is blank. Reset it to the default or write the message the technician should get.",
    };
  }
  if (!args.smsEdited && !args.templatesReady) {
    return {
      ok: false,
      message: "Still loading the saved SMS templates — try again in a moment, or edit the message to send your own wording.",
    };
  }
  return { ok: true };
}

export type ApprovalContextAnswer = {
  suggestedPickupDate: string;
  smsBody: string;
};

/**
 * What to apply when the server's approval-context answer lands. The approver
 * always wins: a hand-edited date or body is never overwritten. Returns only
 * the fields to change (undefined = leave alone).
 */
export function reconcileApprovalContext(args: {
  current: { pickupDateISO: string; dateEdited: boolean; smsEdited: boolean };
  ctx: ApprovalContextAnswer;
}): { pickupDateISO?: string; smsBody?: string } {
  const out: { pickupDateISO?: string; smsBody?: string } = {};
  if (
    !args.current.dateEdited
    && args.ctx.suggestedPickupDate
    && args.ctx.suggestedPickupDate !== args.current.pickupDateISO
  ) {
    out.pickupDateISO = args.ctx.suggestedPickupDate;
  }
  if (!args.current.smsEdited) out.smsBody = args.ctx.smsBody;
  return out;
}
