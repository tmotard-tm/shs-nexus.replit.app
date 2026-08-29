/**
 * Rental Request — eligibility engine and routes.
 *
 * Spec: Fleet/ETD/REQUEST_FORM.md. This is the front door that replaces the
 * technician's call to Holman.
 *
 * THE GATE IS MAINTENANCE (Tyler, 2026-08-16). The engine's only hard "no" is
 * scheduled maintenance: a van with a booked service visit is scheduled and
 * waited on, never rented around. Everything else is cleared to a person who
 * decides with the technician's profitability factors in view. The roster,
 * the rental book, BYOV state and the shop's ETA are still captured on the
 * row — as context for that decision, not as gates. The denials remain the
 * number worth reporting: nobody can say today what Holman talked people out
 * of, because Holman never told us.
 */
import type { Express, Router } from "express";
import { db } from "../../db";
import { isUniqueViolationOn } from "./db-errors";
import { sql } from "drizzle-orm";
import crypto from "crypto";
import { regionForState, REGION_OWNER } from "../rental-operations/region";
import {
  requestBookingInFlight,
  invalidateRequestPreviews,
  createIntent,
  OrchestratorError,
  retireRequestIntentsBeforeSourceRemoval,
  requestPreview,
  confirmIntent,
  verifyRequestOnCommitEvidence,
  WORKFLOW_REQUEST,
  // The Saturday-schedule truth for the Friday→Monday pickup default. The
  // underlying function, NOT the cron-bearer /schedule-check route: this is
  // read from a session lane by the approval drawer.
  fetchScheduleWindow,
  etTodayISO,
  scheduleDaySnapshotAgeHours,
  WATERMARK_MAX_AGE_HOURS,
} from "./cutover-orchestrator";
import {
  type SaturdayStatus,
  isFridayISO,
  addDaysISO,
  fridayPickupSuggestion,
  buildApprovalSmsDefault,
  resolveApprovalDecideSms,
  APPROVAL_SMS_MAX_LEN,
  REQUEST_APPROVE_TEMPLATE_KEY,
  REQUEST_APPROVE_MONDAY_TEMPLATE_KEY,
} from "../../../shared/rental-approval-sms";
// The booking preview refuses a pickup past the branch cutoff and moves the
// reservation to the next morning. The approval text has to promise the SAME
// day or the technician is told "today" for a car that is not there until
// tomorrow - measured on 31 requests before 2026-08-25.
import { resolvePickupWindow } from "../etd/pickup-window";
import { getNotificationTemplates } from "../storage";
// Extension emails to Enterprise ride the shared SendGrid service (verified
// sender = SENDGRID_EMAIL), not the comms SMS lane.
import { sendEmail } from "../../email-service";
import { runBookingExecutor } from "../etd/executor";
// One list of bookable classes, shared by the picker route and the validator so
// they cannot drift apart.
import { REQUEST_CLASS_OPTIONS, ENTERPRISE_CLASS_MENU, resolveRequestClass } from "../etd/vehicle-class";
// Samsara evidence check for breakdown/accident claims. Advisory only, runs
// fire-and-forget after the row is written — a telematics outage must never
// touch the technician-facing submit.
import { captureRequestSamsaraEvidence } from "./samsara-evidence";
// Which BOOK the extended rental rides on (direct-billed vs Holman/ECARS).
// Shares the Holman-queue standing predicate so the two surfaces can never
// disagree; never throws (a failed lookup reads 'unknown' + checkFailed).
import {
  getExtensionBillingStanding,
  type ExtensionBillingCheck,
} from "./extension-billing";

// .b, 2026-08-14: the first five acknowledgements are now attested by ONE
// checkbox listing them as bullets; the four terms of use stay individual.
// The statements did not change, but how assent is given did, and the stored
// version is what proves which mechanics a technician went through.
// .c: the confirmed-appointment statement removed from the set (Tyler).
export const POLICY_VERSION = "2026-08-14.c";

/**
 * The permanent front door. No token, no login.
 *
 * A tokenised link cannot serve this form. The survey is Fleet-initiated, so
 * minting a token per technician up front is natural there. A rental request is
 * technician-initiated at the worst possible moment, standing next to a dead
 * van, and that technician has no link and no way to get one without making
 * Fleet answer a phone — which is exactly the intake labour going direct to
 * Enterprise was supposed to remove.
 *
 * Identity is proven by LDAP + truck against the roster instead. That is the
 * same check the tokenised path already ran after opening the link; the token
 * was never the thing establishing who someone was.
 */
export const PUBLIC_REQUEST_URL =
  (process.env.PUBLIC_BASE_URL || "https://SHS-Nexus.replit.app").replace(/\/+$/, "")
  + "/rental-request";

/**
 * Categories that are maintenance by definition. Rule 1 kills these outright.
 *
 * `recall` was removed 2026-08-13 (Tyler). A recall can hold a van for days,
 * which is not a wait-at-the-shop, so it is no longer excluded by definition
 * and no longer appears in the acknowledgement, the category label, or the
 * denial script. Removing it from the script alone would have left a recall
 * still denied here, with a message that no longer explained why.
 */
const MAINTENANCE = new Set([
  "scheduled_maintenance",
  "oil_change",
  "tires",
  "pm",
  "inspection",
]);

const PROBLEM_CATEGORIES = new Set([
  "breakdown",
  "accident",
  "awaiting_parts",
  "new_hire_awaiting_vehicle",
  "decom_replacement",
  "scheduled_maintenance",
]);

/**
 * What Fleet can send a request back for.
 *
 * A closed list, not free text, because "incomplete" has to be countable. If
 * three quarters of send-backs are the shop's estimate, that is a question the
 * FORM should be asking better, and you only learn it if the reason is a value
 * rather than a sentence.
 */
export const MISSING_REASONS: Record<string, string> = {
  shop_appointment: "a confirmed shop appointment date and drop-off time",
  shop_details: "the shop name, address and phone number",
  symptom_detail: "a clear description of what the vehicle is doing",
  what_was_tried: "what has already been tried to get it running",
  repair_order: "the shop's repair order or work order number",
  contact: "a phone number we can reach you on",
  nearest_branch: "the Enterprise location for the reservation, no airports (Google it if unsure)",
  other: "more information",
};

/**
 * The CANONICAL acknowledgement wording, keyed by the stored column name.
 *
 * These are the server's copy of the bullets the form renders, and they exist
 * so the acknowledgement snapshot written onto every request is built HERE,
 * from text the client cannot alter. A request's ack_snapshot must prove what
 * a technician agreed to at the moment of signing; a snapshot assembled from
 * whatever the browser posted would prove nothing. The wording has already
 * been revised once (see POLICY_VERSION history above) — when it changes
 * again, change it here AND in the client in the same commit, and bump
 * POLICY_VERSION so the stored version says which wording was live.
 *
 * ack_has_appointment is LEGACY: removed from the set in 2026-08-14.c but
 * kept here so pre-snapshot rows can be rendered from their stored booleans.
 */
export const ACK_TEXTS: Record<string, string> = {
  ack_not_maintenance:
    "This is not scheduled maintenance. I understand rentals are not provided for oil changes, tires, preventive maintenance or inspections.",
  ack_cannot_drive_safely:
    "My vehicle cannot be driven safely to complete my route.",
  ack_return_one_day:
    "I will return the rental within 1 working day of my vehicle being ready, and I understand failing to do so is a cost to the business.",
  ack_accurate:
    "The information above is accurate and may be verified against shop records.",
  ack_working_hours_only:
    "I understand the rental is only for use while working. Off the clock use is not allowed, and I will not drive it outside of my working hours.",
  ack_return_before_time_off:
    "I understand I must turn the rental in before any time off of more than 3 days, including vacation or a leave of absence.",
  ack_extension_weekly:
    "I understand I must request a rental extension from Fleet every 7 days for as long as I keep the rental.",
  ack_discipline:
    "I understand any violation of these terms can result in disciplinary action, up to and including termination.",
  ack_has_appointment:
    "I have a confirmed shop appointment for the date entered above.",
};
export type Decision = "APPROVE" | "DENY" | "DEFER" | "REVIEW";

export interface Eligibility {
  decision: Decision;
  rule: number;
  reason: string;
  /** Shown to the technician when the answer is no. Plain, not jargon. */
  script?: string;
  vehicleClass?: string;
}

export interface RequestFacts {
  problemCategory: string;
  hvacCarveOut?: boolean;
}

/**
 * The exact maintenance denial wording. Exported and served to the review UI
 * (see /missing-reasons) so the note Fleet pre-fills and the script the
 * engine records are one string that cannot drift apart.
 */
export const MAINTENANCE_DENY_SCRIPT =
  "Rentals are not provided for oil changes, tires, preventive maintenance " +
  "or inspections. Schedule this as a wait through routing.";

/**
 * The maintenance gate. Simplified from the original eight rules (Tyler,
 * 2026-08-16): maintenance is the only disqualifier the engine still calls,
 * because it is the only one that is true by definition rather than by
 * circumstance. Everything else — roster state, open rentals, BYOV, shop
 * timing — is context Fleet weighs against the profitability factors, and
 * the engine pre-judging those was answering a question nobody asked it.
 *
 * Rule numbers are kept sparse ON PURPOSE: 1 = maintenance, 8 = cleared.
 * Historical rows were decided under the eight-rule engine, and the review
 * UI labels rules 2-7 with their old meanings. Reusing 2 for "cleared" would
 * relabel every old "drivable and safe" denial as something it never was.
 */
export function evaluate(f: RequestFacts): Eligibility {
  // 1 — maintenance is never a rental. The van is scheduled and waited on.
  if (MAINTENANCE.has(f.problemCategory)) {
    return {
      decision: "DENY",
      rule: 1,
      reason: "scheduled maintenance",
      script: MAINTENANCE_DENY_SCRIPT,
    };
  }

  // 8 — everything else goes to a person, profitability factors in view.
  return {
    decision: "APPROVE",
    rule: 8,
    reason: "no maintenance disqualifier — decide on profitability",
    vehicleClass: f.hvacCarveOut ? "cargo van" : "sedan",
  };
}

// ---------------------------------------------------------------------------
// Form-funnel event log.
//
// Three steps sit between "a technician heard about the form" and "Fleet has a
// request to review": open the form (start), pass the roster check (verify_ok),
// and submit. Only the last step creates a vrm_rental_request row, so the
// earlier two are invisible to the admin page without this log.
//
// Every write is fire-and-forget. A DB hiccup must never strand a technician
// standing next to a dead van. Failures are logged loudly and swallowed.
// ---------------------------------------------------------------------------

/**
 * Fire-and-forget: record one step in the rental-request form funnel.
 *
 * event:   'start'       – form page loaded; no LDAP yet.
 *          'verify_ok'   – roster check passed.
 *          'verify_fail' – roster check rejected; outcome says why.
 *          'submit'      – form submitted (vrm_rental_request row also written).
 *
 * outcome (verify_fail only):
 *   'not_on_roster' | 'open_request' | 'daily_cap'
 */
function logEvent(
  event: "start" | "verify_ok" | "verify_fail" | "submit",
  opts: { ldap?: string; outcome?: string; ip?: string } = {},
): void {
  db.execute(sql`
    INSERT INTO vrm_rental_request_events (event, ldap, outcome, ip)
    VALUES (${event}, ${opts.ldap ?? null}, ${opts.outcome ?? null}, ${opts.ip ?? null})
  `).catch((e: any) =>
    console.error("[rental-request-events] log failed:", e?.message || e),
  );
}

// ---------------------------------------------------------------------------

function normTruck(v: string): string {
  const d = String(v || "").replace(/\D/g, "").replace(/^0+/, "");
  return d || String(v || "").trim().toUpperCase();
}

export function newRequestToken(): string {
  return crypto.randomBytes(16).toString("hex");
}

async function loadToken(token: string) {
  const { rows } = await db.execute(sql`
    SELECT id, token, ldap, truck_number, tech_name, phone, prefill, submitted_at, expires_at
    FROM vrm_form_tokens
    WHERE token = ${token} AND form_type = 'rental_request'
    LIMIT 1
  `);
  const row = (rows as any[])[0];
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return row;
}

/**
 * Everything the engine needs that the technician cannot be trusted to supply,
 * plus the identity fields the open front door has to resolve for itself.
 *
 * The tokenised path got name / truck / phone from the token row, which Fleet
 * had already populated. Nothing pre-populates a self-serve request, so those
 * columns are read from the roster here and CONFIRMED by the technician rather
 * than typed by them. Same rule as before: never ask for something we hold.
 *
 * ⚠ The phone character class is `[^0-9]` deliberately and must stay that way.
 * The regex shorthand for a non-digit, written inside a drizzle tagged
 * template, is cooked by JavaScript down to the bare letter D before drizzle
 * sees the string, which strips Ds out of phone numbers and leaves every dash
 * in place. Proven on the box 2026-08-12; do not reintroduce the shorthand.
 */
const ACTIVE_ROSTER_MISSING_MESSAGE =
  "We could not find that LDAP on the active technician roster. Check the spelling, "
  + "or contact Fleet if you have just started.";
const ACTIVE_ROSTER_AMBIGUOUS_MESSAGE =
  "More than one active technician record matches that LDAP. Contact Fleet so we can correct the roster before you continue.";

class AmbiguousActiveRentalIdentityError extends Error {
  constructor() {
    super("multiple active current roster rows matched the rental LDAP");
    this.name = "AmbiguousActiveRentalIdentityError";
  }
}

function handleAmbiguousActiveRentalIdentity(
  res: any,
  error: unknown,
  outcomeKey: "verified" | "success",
): boolean {
  if (!(error instanceof AmbiguousActiveRentalIdentityError)) return false;
  res.status(409).json({
    [outcomeKey]: false,
    message: ACTIVE_ROSTER_AMBIGUOUS_MESSAGE,
  });
  return true;
}

async function factsFor(ldap: string) {
  const { rows } = await db.execute(sql`
    SELECT a.employment_status,
           count(*) OVER ()                                  AS active_match_count,
           a.district_no,
           a.home_state,
           upper(btrim(a.tech_racfid)) AS ldap,
           COALESCE(NULLIF(btrim(a.tech_name), ''),
                    NULLIF(btrim(COALESCE(a.first_name,'') || ' ' || COALESCE(a.last_name,'')), ''))
                                                        AS tech_name,
           a.first_name,
           -- Truck on file, best source first, and ALL of them kept for the
           -- match. A technician mid-swap legitimately answers with the truck
           -- TPMS has not caught up to yet, or with the one they just handed
           -- back; refusing either would lock a real person out of the front
           -- door over a feed lag.
           COALESCE(NULLIF(btrim(tp.truck_no), ''),
                    NULLIF(btrim(a.truck_lu), ''),
                    NULLIF(btrim(a.last_known_truck_lu), ''))  AS truck_number,
           ARRAY[NULLIF(btrim(tp.truck_no), ''),
                 NULLIF(btrim(a.truck_lu), ''),
                 NULLIF(btrim(a.last_known_truck_lu), '')]     AS truck_candidates,
           NULLIF(regexp_replace(COALESCE(tp.mobile_phone,''), '[^0-9]', '', 'g'), '') AS tpms_phone,
           NULLIF(regexp_replace(COALESCE(a.cell_phone,''),    '[^0-9]', '', 'g'), '') AS cell_phone,
           NULLIF(regexp_replace(COALESCE(a.main_phone,''),    '[^0-9]', '', 'g'), '') AS main_phone,
           (SELECT count(*) FROM vrm_byov_status v
              WHERE upper(btrim(v.ldap)) = upper(btrim(a.tech_racfid))
               AND upper(coalesce(v.status,'')) = 'ENROLLED') AS byov_count,
           (SELECT max(synced_at) FROM vrm_byov_status)        AS byov_synced_at,
           (SELECT count(*) FROM vrm_byov_status v2
              WHERE upper(btrim(v2.ldap)) = upper(btrim(a.tech_racfid))) AS byov_row_present,
           (SELECT count(*) FROM vrm_rental_operations_cases c
              JOIN vrm_rental_identity_resolutions ir ON ir.case_key = c.case_key
             WHERE c.present_in_latest AND upper(c.ticket_status) = 'OPEN'
               AND COALESCE(ir.override_employee_id, ir.resolved_employee_id) = a.employee_id) AS open_rentals
    FROM all_techs a
    -- 88 enterprise_ids carry MORE THAN ONE tpms profile row, 79 of them with
    -- conflicting mobile numbers. A plain join lets both through and the
    -- planner decides which one you get, so the number we text is not stable.
    -- Pick one here, preferring the row that actually carries a mobile.
    LEFT JOIN LATERAL (
      SELECT tpp.truck_no, tpp.mobile_phone
      FROM tpms_tech_profiles tpp
      WHERE upper(btrim(tpp.enterprise_id)) = upper(btrim(a.tech_racfid))
      ORDER BY (NULLIF(regexp_replace(COALESCE(tpp.mobile_phone,''), '[^0-9]', '', 'g'), '') IS NULL),
               NULLIF(regexp_replace(COALESCE(tpp.mobile_phone,''), '[^0-9]', '', 'g'), '')
      LIMIT 1
    ) tp ON true
    WHERE upper(btrim(a.tech_racfid)) = upper(btrim(${ldap}))
      AND upper(btrim(COALESCE(a.employment_status, ''))) = 'A'
      AND a.dropped_from_source_at IS NULL
    ORDER BY a.effective_date DESC NULLS LAST,
             a.synced_at DESC NULLS LAST,
             a.employee_id
    LIMIT 1
  `);
  const row = (rows as any[])[0] ?? null;
  if (Number(row?.active_match_count ?? 0) > 1) {
    throw new AmbiguousActiveRentalIdentityError();
  }
  return row;
}

/** First ten-digit number we hold for this technician, or null. */
function phoneFor(f: any): string | null {
  for (const c of [f?.tpms_phone, f?.cell_phone, f?.main_phone]) {
    const d = String(c || "").replace(/[^0-9]/g, "").replace(/^1(?=\d{10}$)/, "");
    if (d.length === 10) return d;
  }
  return null;
}

/**
 * The technician's open rental cases, in detail.
 *
 * factsFor() already COUNTS them (open_rentals); this returns the rows, so the
 * extension path can show the technician which rental the system believes they
 * hold and pin that snapshot onto the request for the reviewer. Same join as
 * the count on purpose — two different definitions of "open rental" would let
 * the default and the display disagree.
 */
async function openRentalsFor(ldap: string): Promise<any[]> {
  const { rows } = await db.execute(sql`
    SELECT c.case_key,
           -- Which BOOK the case rides on: 'enterprise' = the ECARS/Holman
           -- book, 'enterprise_direct' = the direct-billing book. Both share
           -- the vendor string 'Enterprise Rent-A-Car', so the snapshot must
           -- carry the source or the reviewer cannot tell the books apart.
           c.source,
           c.vehicle_number,
           c.veh_desc,
           c.rental_class,
           c.rental_vendor,
           c.po_number,
           to_char(c.rental_start_date, 'YYYY-MM-DD') AS rental_start_date,
           c.days_open,
           c.days_authorized,
           c.number_of_extensions,
           c.renting_city,
           c.renting_state
    FROM vrm_rental_operations_cases c
    JOIN vrm_rental_identity_resolutions ir ON ir.case_key = c.case_key
    JOIN all_techs a
      ON COALESCE(ir.override_employee_id, ir.resolved_employee_id) = a.employee_id
    WHERE upper(a.tech_racfid) = upper(${ldap})
      AND c.present_in_latest
      AND upper(c.ticket_status) = 'OPEN'
    ORDER BY c.rental_start_date DESC NULLS LAST
    LIMIT 3
  `);
  return rows as any[];
}
/**
 * Who owns this request regionally. Derived, never asked, never sent by the
 * client — the previous version read `regionOwner` off the request body, which
 * the form has never populated, so every row shipped with region_owner NULL.
 *
 * Annex A of SOP v4 resolves by the technician's own HOME STATE. The district
 * vote is gone: three districts legitimately span two regions and keeping them
 * whole misrouted ~15% of escalations. Shop state is the fallback for the case
 * where we hold no home state at all.
 */
function regionOwnerFor(homeState: string | null, shopState: string | null): string | null {
  const region = regionForState(homeState) ?? regionForState(shopState);
  return region ? REGION_OWNER[region] : null;
}


/**
 * Refresh the BYOV mirror from byovdashboard.
 *
 * Uses the no-auth /api/external/tech-truck-roster endpoint deliberately: adding
 * a byovdashboard connection string to Nexus secrets would take effect on
 * PRODUCTION immediately, because nexus-dev and prod share one Secrets store.
 */
export async function syncByovStatus(): Promise<{ synced: number; enrolled: number }> {
  const url = process.env.BYOV_ROSTER_URL
    || "https://byovdashboard.replit.app/api/external/tech-truck-roster";
  const resp = await fetch(url);
  const ctype = resp.headers.get("content-type") || "";
  if (!resp.ok || !ctype.includes("application/json")) {
    throw new Error(`byov roster returned ${resp.status} ${ctype || "no content-type"}`);
  }
  const payload: any = await resp.json();
  const rows: any[] = Array.isArray(payload)
    ? payload
    : (payload.data || payload.rows || payload.technicians || payload.roster || []);
  if (!rows.length) throw new Error("byov roster returned no rows");

  // ONE statement, not one per technician.
  //
  // This used to loop 1,600+ sequential round trips, which took long enough
  // that nobody ever ran it, which is why the mirror sat 37 hours stale and
  // every single rental request failed closed to REVIEW at rule 5. A sync that
  // is too slow to run is a sync that does not exist, and the eligibility
  // engine is only as good as the freshness of what it reads.
  const payloadRows = rows
    .map((r) => ({
      ldap: String(r.enterprise_id || "").trim().toUpperCase(),
      status: r.byov_enrollment_status ? String(r.byov_enrollment_status) : null,
      is_new_hire: r.byov_is_new_hire === true || r.byov_is_new_hire === "True",
      pilot_tier: r.byov_pilot_tier ?? null,
      started_on: r.byov_started_date ?? null,
    }))
    .filter((r) => r.ldap);
  if (!payloadRows.length) throw new Error("byov roster returned no usable ldaps");

  const enrolled = payloadRows.filter((r) => (r.status || "").toUpperCase() === "ENROLLED").length;

  await db.execute(sql`
    INSERT INTO vrm_byov_status (ldap, status, is_new_hire, pilot_tier, started_on, synced_at)
    SELECT x.ldap, x.status, x.is_new_hire, x.pilot_tier,
           NULLIF(x.started_on, '')::date, now()
    FROM jsonb_to_recordset(${JSON.stringify(payloadRows)}::jsonb)
         AS x(ldap text, status text, is_new_hire boolean, pilot_tier text, started_on text)
    ON CONFLICT (ldap) DO UPDATE SET
      status = EXCLUDED.status, is_new_hire = EXCLUDED.is_new_hire,
      pilot_tier = EXCLUDED.pilot_tier, started_on = EXCLUDED.started_on,
      synced_at = now()
  `);

  console.log(`[byov-mirror] synced ${payloadRows.length} rows, ${enrolled} enrolled`);
  return { synced: payloadRows.length, enrolled };
}


/**
 * Keep the BYOV mirror fresh enough for rule 5 to mean something.
 *
 * Rule 5 fails CLOSED: an unknown or stale BYOV status sends the request to a
 * human rather than risking an auto-approved rental for a technician who has
 * no company van. That is the right default and it must not change. But the
 * freshness window is 36 hours and nothing was refreshing the mirror, so the
 * gate went from a safety net to a blanket: measured on the box, the mirror was
 * 37 hours old and EVERY request would have routed to REVIEW. Fleet would have
 * hand-decided all of them, which is the opposite of the promise the process
 * makes.
 *
 * So the mirror refreshes itself on use. Single-flight, because a burst of
 * requests must not become a burst of roster fetches, and time-boxed, because
 * a slow byovdashboard must never hold up a technician standing next to a dead
 * van. If the refresh fails or times out, nothing is lost: the caller falls
 * through to the same fail-closed REVIEW it would have given anyway.
 *
 * In-process schedulers are deliberately not used. This codebase already
 * documents that setInterval does not run dependably on the deployment because
 * instances scale, and sync-scheduler.ts disables its daily interval in
 * production outright. Refresh-on-use has no such dependency.
 */
const BYOV_REFRESH_AFTER_MS = 12 * 3600 * 1000;
const BYOV_REFRESH_TIMEOUT_MS = 8000;
let byovRefreshInFlight: Promise<unknown> | null = null;

export async function ensureByovFresh(): Promise<void> {
  try {
    const { rows } = await db.execute(sql`
      SELECT max(synced_at) AS synced_at, count(*)::int AS n FROM vrm_byov_status
    `);
    const row = (rows as any[])[0];
    const age = row?.synced_at ? Date.now() - new Date(row.synced_at).getTime() : Infinity;
    if (Number(row?.n ?? 0) > 0 && age < BYOV_REFRESH_AFTER_MS) return;

    if (!byovRefreshInFlight) {
      console.log(`[byov-mirror] stale (${Math.round(age / 3600000)}h), refreshing`);
      byovRefreshInFlight = syncByovStatus()
        .catch((e) => console.error("[byov-mirror] refresh failed:", e?.message || e))
        .finally(() => { byovRefreshInFlight = null; });
    }
    // Wait, but not forever. A technician does not wait on our cache.
    await Promise.race([
      byovRefreshInFlight,
      new Promise((r) => setTimeout(r, BYOV_REFRESH_TIMEOUT_MS)),
    ]);
  } catch (e: any) {
    console.error("[byov-mirror] freshness check failed:", e?.message || e);
  }
}

// ---------------------------------------------------------------------------
// Telling people things.
//
// Everything below is best-effort and MUST NOT be able to fail a request. A
// comms outage that rejected submissions would strand the technician the form
// exists to help. Failures are logged loudly and swallowed.
//
// The real URL is /api/fs/comms/api/send-batch: routes.ts declares
// "/comms/api/send-batch" on a Router mounted under /api/fs. Calling it at the
// root returns the SPA HTML shell with HTTP 200, which reads exactly like "not
// deployed" — hence the content-type assertion.
// ---------------------------------------------------------------------------

type Sms = { ldap?: string; phone: string; body: string };

async function sendSms(messages: Sms[], why: string): Promise<number> {
  const key = process.env.COMMS_SEND_API_KEY;
  if (!key) {
    console.warn(`[rental-request] ${why}: COMMS_SEND_API_KEY not set, nothing sent`);
    return 0;
  }
  const clean = messages
    .map((m) => ({
      ...m,
      phone: String(m.phone || "").replace(/[^0-9]/g, "").replace(/^1(?=\d{10}$)/, ""),
      category: "rental_management",
    }))
    .filter((m) => m.phone.length === 10);
  if (!clean.length) {
    console.warn(`[rental-request] ${why}: no reachable phone, nothing sent`);
    return 0;
  }
  try {
    const host = process.env.COMMS_SEND_BASE_URL || `http://localhost:${process.env.PORT || "5000"}`;
    const resp = await fetch(`${host}/api/fs/comms/api/send-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-comms-api-key": key },
      body: JSON.stringify({ category: "rental_management", messages: clean, confirm: true }),
    });
    const ctype = resp.headers.get("content-type") || "";
    if (!ctype.includes("application/json")) {
      console.error(`[rental-request] ${why}: comms returned ${resp.status} ${ctype || "no content-type"}`);
      return 0;
    }
    const out: any = await resp.json();
    // "sent" is the API's word, and every outbound row is written 'sent' with
    // zero delivery callbacks recorded. Count what it claims; never treat it as
    // proof the technician's handset rang.
    const results: any[] = out?.results || out?.commsResult?.results || [];
    const good = results.filter((r) => ["sent", "queued"].includes(String(r?.status || "").toLowerCase()));
    console.log(`[rental-request] ${why}: comms accepted ${good.length}/${clean.length}`);
    return good.length;
  } catch (e: any) {
    console.error(`[rental-request] ${why}: comms threw:`, e?.message || e);
    return 0;
  }
}

/**
 * Push a landed request at Fleet.
 *
 * Deliberately only for the outcomes a person has to act on. A DENY or a DEFER
 * is a self-service answer the technician already read on screen, and paging
 * Fleet for every oil-change denial would train everyone to ignore the alert —
 * which costs you the APPROVE and REVIEW ones that actually matter.
 *
 * Recipients come from RENTAL_REQUEST_ALERT_PHONES (comma-separated, 10-digit).
 * Unset means alerting is off and says so in the log, rather than guessing at
 * somebody's mobile number.
 */
async function alertFleet(r: {
  requestNo: number | null; ldap: string; techName?: string | null; truck?: string | null;
  decision: Decision; rule: number; reason: string; category: string;
  homeState?: string | null; shopName?: string | null; appointmentAt?: string | null;
  regionOwner?: string | null; nearestBranch?: string | null;
}): Promise<void> {
  // Every request needs a person now, so every request pushes. The old filter
  // existed to keep the alert worth reading when the engine resolved most
  // requests by itself; it resolves nothing now.

  const to = String(process.env.RENTAL_REQUEST_ALERT_PHONES || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (!to.length) {
    console.warn("[rental-request] alertFleet: RENTAL_REQUEST_ALERT_PHONES not set, "
      + `request #${r.requestNo} (${r.decision}) landed with no push`);
    return;
  }
  const head = "NEEDS YOU";
  const body =
    `Fleet rental request #${r.requestNo} ${head}\n`
    + `${r.techName || r.ldap} (${r.ldap})${r.truck ? ` truck ${r.truck}` : ""}`
    + `${r.homeState ? ` ${r.homeState}` : ""}\n`
    + `${r.category.replace(/_/g, " ")}\n`
    // The engine's opinion rides along as a hint. It decided nothing.
    + `(engine would have said ${r.decision}, rule ${r.rule}: ${r.reason})\n`
    + (r.nearestBranch ? `Branch: ${r.nearestBranch}\n` : "")
    + (r.shopName ? `Shop: ${r.shopName}${r.appointmentAt ? ` on ${String(r.appointmentAt).slice(0, 10)}` : ""}\n` : "")
    + (r.regionOwner ? `Region: ${r.regionOwner}\n` : "")
    + `Queue: ${(process.env.PUBLIC_BASE_URL || "https://SHS-Nexus.replit.app").replace(/\/+$/, "")}`
    + `/vehicle-rental-management/rental-requests`;
  await sendSms(to.map((phone) => ({ phone, body })), `alert #${r.requestNo}`);
}

const EXTENSION_SUPPORT_EMAIL =
  process.env.RENTAL_EXTENSION_EMAIL_TO || "NorthCentralAccountSupport@em.com";
// Fleet asked that these two are ALWAYS copied on the extension email — so the
// env override ADDS recipients, it never removes the defaults (the drawer tells
// staff these two are always CC'd, and that has to stay true). Entries must
// look like an email address so a malformed env value can't become a bad
// SendGrid header.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EXTENSION_SUPPORT_CC: string[] = Array.from(new Set([
  "howard.anderson@transformco.com",
  "tyler.morgan@transformco.com",
  ...(process.env.RENTAL_EXTENSION_EMAIL_CC || "")
    .split(",").map((s) => s.trim()).filter((s) => EMAIL_SHAPE.test(s)),
]));
/**
 * Tell the technician what happened.
 *
 * The submit screen already tells them "Fleet will send the reservation details
 * shortly." Nothing sent anything, which made that a promise in Fleet's name
 * that no code kept. This is what keeps it.
 */
async function notifyTech(requestNo: number, body: string, why: string): Promise<void> {
  try {
    const { rows } = await db.execute(sql`
      SELECT ldap, mobile_phone FROM vrm_rental_request WHERE request_no = ${requestNo}
    `);
    const row = (rows as any[])[0];
    if (!row) return;
    let phone = String(row.mobile_phone || "").replace(/[^0-9]/g, "");
    if (phone.length !== 10) {
      const f = await factsFor(String(row.ldap));
      phone = phoneFor(f) || "";
    }
    if (!phone) {
      console.warn(`[rental-request] ${why}: no phone for ${row.ldap} on #${requestNo}`);
      return;
    }
    await sendSms([{ ldap: row.ldap, phone, body }], `${why} #${requestNo}`);
  } catch (e: any) {
    console.error(`[rental-request] ${why} failed:`, e?.message || e);
  }
}

/**
 * Is this technician actually working the given Saturday?
 *
 * Tri-state on purpose: the Friday→Monday default treats "we cannot tell"
 * differently from "no" only in the sentence shown to the approver — both
 * default to Monday, but the approver must know WHICH fact produced the
 * default. Freshness gates mirror the cutover lane's recheckScheduleDay:
 * table watermark fresh AND the per-tech per-day snapshot fresh, because a
 * tech missing from last night's load would otherwise pass on the table's
 * freshness alone.
 */
async function saturdayScheduleFor(
  ldap: string,
  saturdayISO: string,
): Promise<{ status: SaturdayStatus; detail: string }> {
  try {
    const win = await fetchScheduleWindow(ldap, saturdayISO, 1);
    if (!win.fresh) {
      return {
        status: "unknown",
        detail: `schedule watermark ${win.watermarkUtc ?? "missing"} is `
          + `${win.watermarkAgeHours?.toFixed(1) ?? "?"}h old (limit ${WATERMARK_MAX_AGE_HOURS}h)`,
      };
    }
    const day = win.days.find((d) => d.date === saturdayISO);
    // No row = ServicePower has no shift for that day. That is the normal
    // shape of a scheduled day off, not a data gap — gaps show up as a stale
    // watermark, which the branch above already caught.
    if (!day) return { status: "not_working", detail: "no Saturday shift on the schedule" };
    const age = scheduleDaySnapshotAgeHours(day);
    if (age === null || age > WATERMARK_MAX_AGE_HOURS) {
      return {
        status: "unknown",
        detail: `snapshot carrying Saturday is ${age === null ? "unparseable" : `${age.toFixed(1)}h old`}`,
      };
    }
    if (day.working) return { status: "working", detail: "scheduled to work Saturday" };
    return {
      status: "not_working",
      detail: day.absences.length
        ? `Saturday absence: ${day.absences.join(", ")}`
        : "no available hours Saturday",
    };
  } catch (e: any) {
    return { status: "unknown", detail: `schedule lookup failed: ${e?.message || e}` };
  }
}

/**
 * The Settings overrides for the two request-approval SMS templates.
 * "" means "no override, use the built-in default" — same contract as the
 * notification dispatcher's templates. A lookup failure THROWS.
 */
async function loadRequestApprovalTemplates(): Promise<{ standard: string; monday: string }> {
  // Deliberately loud: a settings-read failure must surface as an HTTP error
  // on every caller, never decay to a silent built-in send. An admin who
  // saved custom copy has to be able to trust that "success" meant THEIR
  // words went out; "" here means only "no override saved", never "the read
  // failed".
  const rows = await getNotificationTemplates();
  const get = (k: string) => rows.find((r) => r.key === k)?.body ?? "";
  return {
    standard: get(REQUEST_APPROVE_TEMPLATE_KEY),
    monday: get(REQUEST_APPROVE_MONDAY_TEMPLATE_KEY),
  };
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------
/**
 * One request per technician per day (Tyler, 2026-08-13).
 *
 * Counted on the EASTERN calendar day, not a rolling 24 hours. "Per day" means
 * a day to the person filing it; a rolling window would tell a technician who
 * filed at 4pm yesterday that they had already filed today, which is not a
 * sentence anyone can act on. Eastern because that is the day Fleet works.
 *
 * ⚠ A request Fleet SENT BACK does not count. Those are the ones the technician
 * was explicitly told to come back and finish, and counting them would mean the
 * send-back path could never be completed on the day it was issued: Fleet asks
 * for the shop's estimate, the technician gets it an hour later, and the cap
 * refuses them. Two requirements that cancel each other out. So the count
 * excludes `returned` rows, and finishing a returned request is a continuation
 * rather than a new request.
 */
const SELF_SERVE_DAILY_CAP = 1;


interface SubmitContext {
  /** The token row, or null on the open front door. */
  tokenRow: any | null;
  ldap: string;
  source: "form" | "self_serve";
  identity: {
    techName: string | null;
    truckNumber: string | null;
    district: string | null;
    homeState: string | null;
    mobilePhone: string | null;
  };
  body: any;
  ip: string;
}

/**
 * Screen a request, write the record, and tell everyone who needs to know.
 *
 * Shared by both front doors on purpose. The channel is cosmetic: a self-serve
 * submission and a Fleet-issued link produce one record with one schema, one
 * eligibility verdict and one audit trail. The only thing `source` changes is
 * how it is reported.
 */
/**
 * The longest rental Fleet will book in one go.
 *
 * Not a vendor limit: ETD quotes 90 days without complaint. This is the weekly
 * extension cadence the technician acknowledges on the form, and it is the only
 * point at which anyone re-checks whether the van is still in the shop.
 */
const MAX_RENTAL_DAYS = 7;

async function screenAndRecord(ctx: SubmitContext): Promise<{ code: number; json: any }> {
  const { ldap, body: b, tokenRow } = ctx;
  const s = (v: any, max = 300) => String(v ?? "").trim().slice(0, max) || null;
  const bool = (v: any) => (v === true || v === "yes" ? true : v === false || v === "no" ? false : null);
  const num = (v: any) => (v === "" || v == null || Number.isNaN(Number(v)) ? null : Number(v));
  const dateStr = (v: any) => {
    const d = String(v ?? "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
  };

  // NEW vs EXTENSION. An extension is more time on the rental the technician
  // already holds — not a different vehicle — so the intake questions differ:
  // no problem category, no shop intake, no age gate (they are already renting;
  // Enterprise vetted their age when the car went out). What it DOES demand is
  // a van status update — proof they are keeping up with the repair — and a
  // fresh signature on the FULL acknowledgement set, every single time.
  const requestType = String(b.requestType ?? "new") === "extension" ? "extension" : "new";
  const isExtension = requestType === "extension";
  const nearestBranch = s(b.nearestBranch, 200);
  if (!isExtension && !nearestBranch) {
    return {
      code: 400,
      json: {
        success: false,
        message: "Please enter the Enterprise pickup location where your rental should be reserved.",
      },
    };
  }

  const category = isExtension ? null : (s(b.problemCategory, 40) ?? "");
  if (!isExtension && !PROBLEM_CATEGORIES.has(category as string)) {
    return { code: 400, json: { success: false, message: "Please choose what is wrong with the vehicle." } };
  }

  // The van status update. Required in full: the extension path doubles as the
  // repair check-in, and an extension request that cannot say what the shop
  // said is exactly the silence Fleet needs surfaced, not stored as blanks.
  const extRepairStatus = s(b.extRepairStatus, 1000);
  const extLastShopContact = dateStr(b.extLastShopContact);
  const extShopSaid = s(b.extShopSaid, 1000);
  const extExpectedCompletion = dateStr(b.extExpectedCompletion); // optional — shops do not always commit
  const extTimeNeeded = s(b.extTimeNeeded, 200);
  if (isExtension) {
    if (!extRepairStatus) {
      return { code: 400, json: { success: false, message: "Please describe the current status of your van's repair." } };
    }
    if (!extLastShopContact) {
      return { code: 400, json: { success: false, message: "Please tell us when you last spoke with the shop." } };
    }
    if (!extShopSaid) {
      return { code: 400, json: { success: false, message: "Please tell us what the shop said when you last spoke." } };
    }
    if (!extTimeNeeded) {
      return { code: 400, json: { success: false, message: "Please tell us roughly how much longer you need the rental." } };
    }
  }

  // AGE GATE. Enterprise does not rent to a driver under 21, so an under-21
  // request can never become a reservation however it is approved. Refusing it
  // at intake is the difference between the technician being told immediately
  // who CAN help and the request sitting in the queue until it fails at booking
  // time with a vendor error nobody can act on.
  //
  // Enforced here as well as on the form because this endpoint is public: the
  // form's stop screen is a courtesy, this is the rule.
  //
  // Not asked on an extension: the driver is already in the rental, so the
  // vendor has already rented to them.
  const over21 = isExtension ? null : bool(b.isOver21);
  if (!isExtension && over21 === null) {
    return {
      code: 400,
      json: { success: false, message: "Please tell us whether you are 21 or older." },
    };
  }

  // The engine no longer reads the BYOV mirror, but the ROW still records
  // is_byov: the reviewer sees the pill and weighs it. Refresh before reading
  // so what they see is today's enrollment, not a four-month-old table.
  await ensureByovFresh();

  const facts = await factsFor(ldap);
  if (!facts) {
    return {
      code: 403,
      json: { success: false, message: ACTIVE_ROSTER_MISSING_MESSAGE },
    };
  }
  const isByov = Number(facts?.byov_count ?? 0) > 0;

  // The engine screens NEW requests only. An extension has no problem category
  // to judge and no maintenance gate to fail — it is always a manual Fleet
  // review, recorded as REVIEW with no rule number.
  const verdict: Eligibility = isExtension
    ? { decision: "REVIEW", rule: null as any, reason: "extension of current rental — manual Fleet review" }
    : evaluate({
        problemCategory: category as string,
        hvacCarveOut: b.hvacCarveOut === true,
      });

  // What the system believes vs what the technician chose. The rental-ops feed
  // can lag, so a contradiction is a FLAG for the reviewer, never a wall: the
  // technician saw the warning, wrote a line about why, and proceeded.
  const detectedOpenRentals = Number(facts?.open_rentals ?? 0);
  const typeMismatch = isExtension ? detectedOpenRentals === 0 : detectedOpenRentals > 0;
  const typeMismatchExplanation = typeMismatch ? s(b.typeMismatchExplanation, 500) : null;
  // The form makes this same demand, but this endpoint is public: a direct
  // request must not slip a contradictory choice through without the line the
  // reviewer is promised.
  if (typeMismatch && !typeMismatchExplanation) {
    return {
      code: 400,
      json: {
        success: false,
        message: isExtension
          ? "Our records show no current rental for you. Add a short explanation so Fleet understands why you are asking for an extension."
          : "Our records show you currently have a rental. Add a short explanation so Fleet understands why you are asking for a new one.",
      },
    };
  }
  let currentRental: any = null;
  if (isExtension || detectedOpenRentals > 0) {
    try {
      const cases = await openRentalsFor(ldap);
      currentRental = cases[0] ?? null;
    } catch (e: any) {
      console.error("[rental-request] open-rental detail lookup failed:", e?.message || e);
    }
  }

  // Which BOOK that rental rides on — pinned here as AUDIT evidence only. The
  // reviewer surfaces re-compute the verdict live (a direct-billing import
  // landing between submit and review must self-heal the answer), so nothing
  // downstream trusts this snapshot. Never throws; a failed lookup pins
  // 'unknown' with checkFailed set for the record. Extensions only — new
  // requests carry NULLs in these columns by design.
  let extBilling: ExtensionBillingCheck | null = null;
  if (isExtension) {
    extBilling = await getExtensionBillingStanding(ldap);
  }

  // Acknowledgements are required, but never as false attestations: the shop
  // appointment acknowledgement is skipped on a path that never asked for a
  // shop, the van attestations are skipped for someone with no van, and a
  // MAINTENANCE submission skips "this is not scheduled maintenance" and
  // "cannot be driven safely" — it is maintenance, the van is fine, and the
  // whole point of letting it submit is that Fleet sees it and denies it with
  // the standard response instead of the form silently eating it.
  const acksRequired = true;
  const appointmentAsked = bool(b.hasAppointment) === true;
  const noVehicle = !isExtension && (category === "new_hire_awaiting_vehicle" || b.noVehicle === true);
  const isMaintenance = !isExtension && MAINTENANCE.has(category as string);
  const acks = {
    ack_not_maintenance: b.ackNotMaintenance === true,
    ack_cannot_drive_safely: b.ackCannotDriveSafely === true,
    ack_has_appointment: b.ackHasAppointment === true,
    ack_return_one_day: b.ackReturnOneDay === true,
    ack_accurate: b.ackAccurate === true,
    ack_working_hours_only: b.ackWorkingHoursOnly === true,
    ack_return_before_time_off: b.ackReturnBeforeTimeOff === true,
    ack_extension_weekly: b.ackExtensionWeekly === true,
    ack_discipline: b.ackDiscipline === true,
  };
  // An EXTENSION re-signs the FULL set every time — the consolidated core
  // agreement and all four individual terms. No skips: the van is in the shop
  // (not maintenance, not drivable) and the weekly-extension cadence is the
  // entire reason this request exists.
  const required = Object.entries(acks)
    .filter(([k]) => isExtension
      ? k !== "ack_has_appointment"
      : true)
    .filter(([k]) => isExtension || appointmentAsked || k !== "ack_has_appointment")
    .filter(([k]) => !noVehicle || k !== "ack_cannot_drive_safely")
    .filter(([k]) => !isMaintenance || (k !== "ack_not_maintenance" && k !== "ack_cannot_drive_safely"));
  if (acksRequired) {
    if (!required.every(([, v]) => v)) {
      return { code: 400, json: { success: false, message: "Please tick every acknowledgement before submitting." } };
    }
  }

  // The durable signature record, for BOTH request types: exact bullet texts
  // as worded right now, signer, timestamp. Built from the REQUIRED set so the
  // snapshot never claims assent to a bullet the form did not show.
  const ackSnapshot = buildAckSnapshot({
    signerName: ctx.identity.techName,
    signerLdap: ldap,
    requestType,
    ackKeys: required.map(([k]) => k),
  });

  // ONE PATH: every request lands pending and waits for a person.
  //
  // Tyler, 2026-08-13: "Simple for now. Request form, manual approval, approval
  // creates the reservation." So the eight rules no longer decide anything. The
  // engine still runs and its verdict is still recorded on the row, because when
  // the rules are reworked the useful input is what the engine WOULD have said
  // against what Tyler actually decided. It is data, not a gate. `status` is a
  // constant here on purpose: there is no expression that can route a request
  // anywhere except to a human.
  //
  // The one exception is the age gate: an under-21 request lands terminal at
  // 'denied' instead of pending. It is not a judgement call a human could
  // reverse, because Enterprise will not rent to them at any price, and leaving
  // it pending would put an unbookable row in front of a reviewer every day.
  const status = over21 === false ? "denied" : "pending";

  const homeState = ctx.identity.homeState ?? (facts?.home_state ?? null);
  const shopState = s(b.shopState, 2);
  const regionOwner = regionOwnerFor(homeState, shopState);

  // One row per technician per attempt. A technician who was deferred and has
  // now come back supersedes their own earlier deferral rather than adding a
  // duplicate. Keyed on the token where there is one, and on the LDAP on the
  // open door, where there is not.
  // Structured identity corrections (Tyler, 2026-08-14): the technician edits
  // their own truck and mobile instead of describing them in prose. Flagged,
  // recorded as before -> after, and the corrected values become the request's
  // values of record, so decision texts reach the number they just fixed.
  const rosterTruck = ctx.identity.truckNumber || null;
  const rosterPhone = ctx.identity.mobilePhone || null;
  const corrTruck = s(b.correctedTruck, 30);
  const corrDigits = String(b.correctedPhone || "").replace(/[^0-9]/g, "").replace(/^1(?=\d{10}$)/, "");
  const corrPhone = corrDigits.length === 10 ? corrDigits : null;
  const corrected = b.identityCorrected === true;
  const truckFinal = (corrected && corrTruck) ? corrTruck : (s(b.truckNumber, 30) || rosterTruck);
  const phoneFinal = (corrected && corrPhone) ? corrPhone : (s(b.mobilePhone, 30) || rosterPhone);
  const corrParts: string[] = [];
  if (corrected) {
    if (corrTruck && corrTruck !== String(rosterTruck || "")) corrParts.push(`truck: ${rosterTruck || "none"} -> ${corrTruck}`);
    if (corrPhone && corrPhone !== String(rosterPhone || "").replace(/[^0-9]/g, "")) corrParts.push(`mobile: ${rosterPhone || "none"} -> ${corrPhone}`);
    const note = s(b.identityCorrection, 300);
    if (note) corrParts.push(note);
  }

  let requestNo: number | null = null;
  try {
    requestNo = await db.transaction(async (tx) => {
      const { rows: superseded } = tokenRow
        ? await tx.execute(sql`
            SELECT request_no, id
            FROM vrm_rental_request
            WHERE token_id = ${tokenRow.id} AND status = 'deferred'
            FOR UPDATE
          `)
        : await tx.execute(sql`
            SELECT request_no, id
            FROM vrm_rental_request
            WHERE ldap = ${ldap} AND token_id IS NULL AND status IN ('deferred','returned')
              AND COALESCE(request_type, 'new') = ${requestType}
            FOR UPDATE
          `);

      for (const old of superseded as any[]) {
        await retireRequestIntentsBeforeSourceRemoval({
          requestNo: Number(old.request_no),
          requestId: String(old.id),
          retiredBy: `rental-request submitter ${ldap}`,
          reason: "superseded by a new submission",
        }, tx);
        await tx.execute(sql`
          DELETE FROM vrm_rental_request
          WHERE request_no = ${Number(old.request_no)}
        `);
      }

      const { rows: ins } = await tx.execute(sql`
        INSERT INTO vrm_rental_request (
          token_id, ldap, tech_name, truck_number, district, home_state, mobile_phone,
          identity_corrected, identity_correction, is_byov,
          problem_category, symptom, is_drivable, is_safe_to_drive, is_towed, accident_ok, occurred_at,
          jobs_affected, what_was_tried,
          shop_name, shop_address, shop_city, shop_state, shop_postal, shop_phone,
          tech_reported_branch,
          has_appointment, appointment_at, shop_estimated_days,
          policy_version, policy_acknowledged_at, policy_ip,
          ack_not_maintenance, ack_cannot_drive_safely, ack_has_appointment,
          ack_return_one_day, ack_accurate,
          ack_working_hours_only, ack_return_before_time_off, ack_extension_weekly, ack_discipline,
          approved_vehicle_class, reason_code, region_owner,
          is_over_21,
          request_type, ext_repair_status, ext_last_shop_contact_at, ext_shop_said,
          ext_expected_completion, ext_time_needed,
          detected_open_rentals, type_mismatch, type_mismatch_explanation,
          current_rental, ack_snapshot,
          ext_billing_verdict, ext_billing_evidence, ext_billing_checked_at,
          status, auto_decision, auto_reason, auto_rule, source
        ) VALUES (
          ${tokenRow?.id ?? null}, ${ldap}, ${ctx.identity.techName},
          ${truckFinal},
          ${ctx.identity.district ?? facts.district_no ?? null},
          ${homeState},
          ${phoneFinal},
          ${corrected}, ${corrParts.length ? corrParts.join("; ").slice(0, 400) : null}, ${isByov},
          ${category}, ${s(b.symptom, 1000)}, ${bool(b.isDrivable)}, ${bool(b.isSafeToDrive)}, ${bool(b.isTowed)}, ${bool(b.areYouOkay)},
          ${s(b.occurredAt, 40)}::timestamptz, ${num(b.jobsAffected)}, ${s(b.whatWasTried, 1000)},
          ${s(b.shopName, 200)}, ${s(b.shopAddress, 300)}, ${s(b.shopCity, 80)},
          ${shopState}, ${s(b.shopPostal, 12)}, ${s(b.shopPhone, 30)},
          ${nearestBranch},
          ${bool(b.hasAppointment)}, ${s(b.appointmentAt, 40)}::timestamptz, ${num(b.shopEstimatedDays)},
          ${POLICY_VERSION}, ${acksRequired ? sql`now()` : null}, ${ctx.ip || null},
          ${acks.ack_not_maintenance}, ${acks.ack_cannot_drive_safely}, ${acks.ack_has_appointment},
          ${acks.ack_return_one_day}, ${acks.ack_accurate},
          ${acks.ack_working_hours_only}, ${acks.ack_return_before_time_off}, ${acks.ack_extension_weekly}, ${acks.ack_discipline},
          ${verdict.vehicleClass ?? null}, ${verdict.reason}, ${regionOwner},
          ${over21},
          ${requestType}, ${extRepairStatus}, ${extLastShopContact}::date, ${extShopSaid},
          ${extExpectedCompletion}::date, ${extTimeNeeded},
          ${detectedOpenRentals}, ${typeMismatch}, ${typeMismatchExplanation},
          ${currentRental ? JSON.stringify(currentRental) : null}::jsonb,
          ${JSON.stringify(ackSnapshot)}::jsonb,
          ${extBilling?.verdict ?? null},
          ${extBilling ? JSON.stringify(extBilling) : null}::jsonb,
          ${extBilling?.checkedAt ?? null}::timestamptz,
          ${status}, ${verdict.decision}, ${verdict.reason}, ${verdict.rule}, ${ctx.source}
        )
        RETURNING request_no
      `);
      return (ins as any[])[0]?.request_no ?? null;
    });
  } catch (e: any) {
    if (e instanceof OrchestratorError && e.code === "orphan_manual_review") {
      return {
        code: e.httpStatus,
        json: {
          success: false,
          code: e.code,
          message: e.message,
          intentId: e.extra?.intentId ?? null,
        },
      };
    }
    throw e;
  }

  // A DEFER tells the technician to go book an appointment and come back.
  // Consuming the token here would make that instruction impossible to
  // follow, so the link stays live and the next submit supersedes this row.
  if (tokenRow && verdict.decision !== "DEFER") {
    await db.execute(sql`UPDATE vrm_form_tokens SET submitted_at = now() WHERE id = ${tokenRow.id}`);
  }

  // Samsara evidence check for breakdown/accident claims (Task #759). Fire and
  // forget after the row exists: a Samsara/Snowflake outage must never fail a
  // submission — the row simply stays unchecked until a reviewer re-runs it.
  // Extensions and other categories are untouched by design; the under-21 rows
  // are already terminal-denied but still get evidence for the record read.
  if (!isExtension && requestNo != null && (category === "breakdown" || category === "accident")) {
    void captureRequestSamsaraEvidence({
      requestNo: Number(requestNo),
      truckNumber: truckFinal,
      category,
      occurredAt: s(b.occurredAt, 40),
      isByov: isByov === true,
    });
  }

  // Fire and forget. A comms outage must never fail a submission.
  void alertFleet({
    requestNo, ldap, techName: ctx.identity.techName, truck: ctx.identity.truckNumber,
    decision: verdict.decision, rule: verdict.rule, reason: verdict.reason,
    category: isExtension ? "rental_extension" : (category as string),
    homeState, shopName: s(b.shopName, 200), appointmentAt: s(b.appointmentAt, 40),
    regionOwner, nearestBranch: isExtension ? null : nearestBranch,
  });

  // Never hand back the engine's verdict. It decided nothing, and showing a
  // technician "approved" before a person has looked would be a promise in
  // Fleet's name that nothing keeps — the exact failure the survey escalation
  // was reverted for on 2026-08-13.
  // Named the only route that actually works for them. Telling an under-21
  // technician "denied" and nothing else leaves them stranded with a dead van;
  // Holman can place them through Avis or Hertz, which Enterprise cannot do.
  if (over21 === false) {
    return {
      code: 200,
      json: {
        success: true,
        requestNo,
        decision: "DENIED_UNDER_21",
        message: "Enterprise does not rent to drivers under 21, so Fleet cannot book this "
               + "reservation. Contact Holman (ARI) instead. They are the only ones who can "
               + "put you in a rental, through Avis or Hertz. Your request has been recorded "
               + "and closed, and Fleet has been notified.",
      },
    };
  }

  return {
    code: 200,
    json: {
      success: true,
      requestNo,
      decision: "PENDING",
      message: isExtension
        ? "Fleet has your extension request and will review it. "
        + "You will get a text as soon as it is decided. "
        + "Keep the rental until you hear from us."
        : "Fleet has your request and will review it. "
        + "You will get a text as soon as it is decided.",
    },
  };
}

export function registerRentalRequestPublicRoutes(app: Express): void {
  // -------------------------------------------------------------------------
  // The open front door. Registered BEFORE the tokenised routes so that
  // "/open/..." can never be captured as a :token value.
  // -------------------------------------------------------------------------

  app.get("/api/public/rental-request/open/start", async (req, res) => {
    const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
    logEvent("start", { ip });
    res.json({ valid: true, open: true, policyVersion: POLICY_VERSION });
  });

  /**
   * Prove who you are against the roster.
   *
   * This is the check the tokenised path ran too; the token was never what
   * established identity, it only decided who had been handed a link. LDAP has
   * to resolve to exactly one current active roster row. Historical or dropped
   * rows are never identity fallbacks.
   */
  app.post("/api/public/rental-request/open/verify", async (req, res) => {
    try {
      const ldap = String(req.body?.ldap || "").trim().toUpperCase();
      const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
      if (!ldap) {
        return res.status(400).json({ verified: false, message: "Please enter your LDAP." });
      }

      const f = await factsFor(ldap);
      if (!f) {
        logEvent("verify_fail", { ldap, outcome: "not_on_roster", ip });
        return res.status(403).json({
          verified: false,
          message: ACTIVE_ROSTER_MISSING_MESSAGE,
        });
      }

      // Retire any request whose rental is already back, so the constraint
      // underneath the door agrees with the guard above it.
      await closeSettledRequests(ldap);
      // Type-aware in-flight guard. A hard 409 only when NEITHER door is open:
      // a technician whose new request is BOOKED is exactly the person who
      // files an extension, so the booked row must not turn them away here.
      const guard = await liveRequestGuard(ldap);
      if (guard.blockNew && guard.blockExtension) {
        const open = guard.blockNew;
        logEvent("verify_fail", { ldap, outcome: "open_request", ip });
        return res.status(409).json({
          verified: false,
          message: `You already have rental request #${open.requestNo} with us (${open.status}). `
                 + "Fleet is working it. Contact Fleet rather than starting a second one.",
        });
      }

      const { rows: recent } = await db.execute(sql`
        SELECT count(*)::int AS n FROM vrm_rental_request
        WHERE ldap = ${ldap}
          AND status NOT IN ('returned', 'voided')
          AND (created_at AT TIME ZONE 'America/New_York')::date
            = (now()      AT TIME ZONE 'America/New_York')::date
      `);
      if (Number((recent as any[])[0]?.n ?? 0) >= SELF_SERVE_DAILY_CAP) {
        logEvent("verify_fail", { ldap, outcome: "daily_cap", ip });
        return res.status(429).json({
          verified: false,
          message: "You have already filed a rental request today and Fleet is working it. "
                 + "Contact Fleet directly if something has changed.",
        });
      }

      // Anything they already told us, so a send-back is "add the missing bit",
      // not "start again". Covers both a Fleet send-back and a rule-3/4 defer.
      const { rows: prior } = await db.execute(sql`
        SELECT request_no, status, missing_fields, decision_note, problem_category, symptom,
               is_drivable, is_safe_to_drive, is_towed, accident_ok, jobs_affected, what_was_tried,
               shop_name, shop_address, shop_city, shop_state, shop_phone,
               tech_reported_branch,
               has_appointment, shop_estimated_days,
               to_char(appointment_at, 'YYYY-MM-DD') AS appointment_date,
               to_char(appointment_at, 'HH24:MI')    AS appointment_time
        FROM vrm_rental_request
        WHERE ldap = ${ldap} AND status IN ('returned','deferred')
        ORDER BY created_at DESC LIMIT 1
      `);
      const p = (prior as any[])[0] || null;

      // What the system believes about their current rental, so the form can
      // default the New-vs-Extension choice and show the detected unit. A
      // lookup failure degrades to "no detection", never to a blocked door.
      let openRentalCases: any[] = [];
      const detectedOpenRentals = Number(f.open_rentals ?? 0);
      if (detectedOpenRentals > 0) {
        openRentalCases = await openRentalsFor(ldap).catch(() => []);
      }

      res.json({
        verified: true,
        policyVersion: POLICY_VERSION,
        openRentals: detectedOpenRentals,
        currentRental: openRentalCases[0] ?? null,
        // Which request types this technician may file RIGHT NOW, and what is
        // in the way when one is closed. The form disables the blocked option
        // and explains, instead of letting a submit bounce off a 409.
        allowed: {
          new: !guard.blockNew,
          extension: !guard.blockExtension,
        },
        blocking: {
          new: guard.blockNew,
          extension: guard.blockExtension,
        },
        resume: p && {
          requestNo: p.request_no,
          status: p.status,
          missing: (p.missing_fields || []) as string[],
          missingText: ((p.missing_fields || []) as string[])
            .map((m) => MISSING_REASONS[m]).filter(Boolean),
          note: p.decision_note || null,
          answers: {
            problemCategory: p.problem_category || "",
            symptom: p.symptom || "",
            isDrivable: p.is_drivable === true ? "yes" : p.is_drivable === false ? "no" : "",
            isSafeToDrive: p.is_safe_to_drive === true ? "yes" : p.is_safe_to_drive === false ? "no" : "",
            isTowed: p.is_towed === true ? "yes" : p.is_towed === false ? "no" : "",
            areYouOkay: p.accident_ok === true ? "yes" : p.accident_ok === false ? "no" : "",
            jobsAffected: p.jobs_affected == null ? "" : String(p.jobs_affected),
            whatWasTried: p.what_was_tried || "",
            shopName: p.shop_name || "",
            shopAddress: p.shop_address || "",
            shopCity: p.shop_city || "",
            shopState: p.shop_state || "",
            shopPhone: p.shop_phone || "",
            nearestBranch: p.tech_reported_branch || "",
            hasAppointment: p.has_appointment === true ? "yes" : p.has_appointment === false ? "no" : "",
            appointmentDate: p.appointment_date || "",
            appointmentTime: p.appointment_time || "08:00",
            shopEstimatedDays: p.shop_estimated_days == null ? "" : String(p.shop_estimated_days),
          },
        },
        identity: {
          ldap,
          techName: f.tech_name || "",
          truckNumber: String(f.truck_number || ""),
          district: f.district_no ?? "",
          homeState: f.home_state ?? "",
          // Full number by Tyler's ruling 2026-08-14. Tradeoff accepted
          // knowingly: any valid LDAP entered here returns that
          // technician's mobile. Every request is still human-reviewed.
          mobilePhone: phoneFor(f) ?? "",
          isByov: Number(f.byov_count ?? 0) > 0,
        },
      });
      logEvent("verify_ok", { ldap, ip });
    } catch (e: any) {
      if (handleAmbiguousActiveRentalIdentity(res, e, "verified")) return;
      console.error("[rental-request] open verify failed:", e?.message || e);
      res.status(500).json({ verified: false, message: "Something went wrong. Please try again." });
    }
  });

  app.post("/api/public/rental-request/open/submit", async (req, res) => {
    try {
      const ldap = String(req.body?.ldap || "").trim().toUpperCase();
      const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
      if (!ldap) return res.status(400).json({ success: false, message: "Missing LDAP." });

      const f = await factsFor(ldap);
      if (!f) return res.status(403).json({ success: false, message: ACTIVE_ROSTER_MISSING_MESSAGE });

      // Re-check the in-flight guard at submit time, not just at verify time.
      // Two tabs, or a double-tap on a slow phone, would otherwise each pass
      // the earlier check and produce two records and two ETD reservations.
      // The partial unique indexes on (ldap) WHERE token_id IS NULL are the
      // backstop underneath this; this is here to give a readable answer.
      // Enforced PER TYPE: a booked new request blocks another new request,
      // not the extension asking for more time on it.
      const submitType = String(req.body?.requestType ?? "new") === "extension" ? "extension" : "new";
      // Same retire-before-decide as verify: two tabs, or a form left open
      // across the return, must not reach the INSERT with a stale booked row
      // still holding vrm_rental_request_open_live_uniq.
      await closeSettledRequests(ldap);
      const guard = await liveRequestGuard(ldap);
      const blocked = submitType === "extension" ? guard.blockExtension : guard.blockNew;
      if (blocked) {
        return res.status(409).json({
          success: false,
          requestNo: blocked.requestNo,
          message: submitType === "extension"
            ? `You already have rental request #${blocked.requestNo} with us (${blocked.status}). `
            + "Fleet is working it. Contact Fleet rather than filing another one."
            : `You already have rental request #${blocked.requestNo} with us (${blocked.status}).`,
        });
      }

      const { rows: today } = await db.execute(sql`
        SELECT count(*)::int AS n FROM vrm_rental_request
        WHERE ldap = ${ldap}
          AND status NOT IN ('returned', 'voided')
          AND (created_at AT TIME ZONE 'America/New_York')::date
            = (now()      AT TIME ZONE 'America/New_York')::date
      `);
      if (Number((today as any[])[0]?.n ?? 0) >= SELF_SERVE_DAILY_CAP) {
        return res.status(429).json({
          success: false,
          message: "You have already filed a rental request today and Fleet is working it. "
                 + "Contact Fleet directly if something has changed.",
        });
      }

      // The phone comes from OUR records, never the request body: the client
      // only ever saw the masked form of it.
      const body = { ...(req.body || {}) };
      delete body.mobilePhone;
      const out = await screenAndRecord({
        tokenRow: null,
        ldap,
        source: "self_serve",
        identity: {
          techName: f.tech_name || null,
          truckNumber: f.truck_number ? String(f.truck_number) : null,
          district: f.district_no ?? null,
          homeState: f.home_state ?? null,
          mobilePhone: phoneFor(f),
        },
        body,
        ip,
      });
      if (out.code === 200) {
        logEvent("submit", { ldap, ip, outcome: submitType });
      }
      res.status(out.code).json(out.json);
    } catch (e: any) {
      if (handleAmbiguousActiveRentalIdentity(res, e, "success")) return;
      // Either unique index firing here means a genuine race, not a bug.
      if (isUniqueViolationOn(e,
        "vrm_rental_request_open_live_uniq",
        "vrm_rental_request_open_live_xtype_uniq",
        "vrm_rental_request_ext_pending_uniq")) {
        return res.status(409).json({
          success: false,
          message: "You already have a rental request with us. Fleet is working it.",
        });
      }
      console.error("[rental-request] open submit failed:", e?.message || e);
      res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
    }
  });

  // -------------------------------------------------------------------------
  // Tokenised routes. Still live: Fleet or a supervisor can issue a personal
  // link for planned work, and the two paths write the same record.
  // -------------------------------------------------------------------------

  app.get("/api/public/rental-request/:token", async (req, res) => {
    try {
      const row = await loadToken(req.params.token);
      if (!row) return res.status(404).json({ valid: false, message: "This link is invalid or has expired." });
      await db.execute(sql`UPDATE vrm_form_tokens SET opened_at = COALESCE(opened_at, now()) WHERE id = ${row.id}`);
      res.json({
        valid: true,
        completed: !!row.submitted_at,
        techName: row.tech_name || "",
        policyVersion: POLICY_VERSION,
      });
    } catch (e: any) {
      console.error("[rental-request] load failed:", e?.message || e);
      res.status(500).json({ valid: false, message: "Something went wrong. Please try again." });
    }
  });

  app.post("/api/public/rental-request/:token/verify", async (req, res) => {
    try {
      const row = await loadToken(req.params.token);
      if (!row) return res.status(404).json({ verified: false, message: "This link is invalid or has expired." });
      if (row.submitted_at) return res.status(409).json({ verified: false, completed: true, message: "This request has already been submitted." });

      const ldap = String(req.body?.ldap || "").trim().toUpperCase();
      const truck = String(req.body?.truckNumber || "").trim();
      // LDAP plus the link itself. The token is a possession factor, so this
      // stays two-factor without demanding a truck number the open door no
      // longer asks for either. A truck is only checked when one is sent.
      if (!ldap) return res.status(400).json({ verified: false, message: "Please enter your LDAP." });
      if (row.ldap && ldap !== String(row.ldap).trim().toUpperCase()) {
        return res.status(403).json({ verified: false, message: "That LDAP does not match this link." });
      }
      const onFile = String(row.truck_number || "").trim();
      if (truck && onFile && normTruck(onFile) !== normTruck(truck)) {
        return res.status(403).json({ verified: false, message: "That truck number does not match our records for you." });
      }

      // Section A is CONFIRMED, not typed. Send back what we already hold.
      const f = await factsFor(ldap);
      if (!f) {
        return res.status(403).json({
          verified: false,
          message: ACTIVE_ROSTER_MISSING_MESSAGE,
        });
      }

      // Same detection the open door returns, so the tokenized form can
      // default New vs Extension and show the current rental too.
      const detectedOpenRentals = Number(f?.open_rentals ?? 0);
      const openRentalCases = detectedOpenRentals > 0
        ? await openRentalsFor(ldap).catch(() => [])
        : [];

      // The token door deliberately skips the live guard for NEW requests —
      // Fleet issued this link on purpose, and overriding the dedupe is part
      // of why the token path exists. Extensions get no such override: there
      // is never a reason for a second pending extension, whoever sent the
      // link, and a live new in pending/approved still means there is nothing
      // to extend yet.
      const guard = await liveRequestGuard(ldap);

      res.json({
        verified: true,
        policyVersion: POLICY_VERSION,
        openRentals: detectedOpenRentals,
        currentRental: openRentalCases[0] ?? null,
        allowed: { new: true, extension: !guard.blockExtension },
        blocking: { new: null, extension: guard.blockExtension },
        identity: {
          ldap,
          techName: f.tech_name || row.tech_name || "",
          truckNumber: String(f.truck_number || onFile || truck),
          district: f.district_no ?? "",
          homeState: f.home_state ?? "",
          mobilePhone: phoneFor(f) || row.phone || "",
          isByov: Number(f.byov_count ?? 0) > 0,
        },
      });
    } catch (e: any) {
      if (handleAmbiguousActiveRentalIdentity(res, e, "verified")) return;
      console.error("[rental-request] verify failed:", e?.message || e);
      res.status(500).json({ verified: false, message: "Something went wrong. Please try again." });
    }
  });

  app.post("/api/public/rental-request/:token/submit", async (req, res) => {
    try {
      const row = await loadToken(req.params.token);
      if (!row) return res.status(404).json({ success: false, message: "This link is invalid or has expired." });
      if (row.submitted_at) return res.status(409).json({ success: false, completed: true, message: "This request has already been submitted." });

      const b = req.body || {};
      const ldap = String(b.ldap || "").trim().toUpperCase();
      if (!ldap || (row.ldap && ldap !== String(row.ldap).trim().toUpperCase())) {
        return res.status(403).json({ success: false, message: "That LDAP does not match this link." });
      }
      // Resolve current active identity before reading request state for this
      // LDAP. An inactive or ambiguous token holder must not learn the number
      // or status of another request associated with the reused identifier.
      const facts0 = await factsFor(ldap);
      if (!facts0) {
        return res.status(403).json({
          success: false,
          message: ACTIVE_ROSTER_MISSING_MESSAGE,
        });
      }
      // Type-aware guard on the token door too, for extensions only. A Fleet
      // link may deliberately duplicate a NEW request, but a second pending
      // extension is never legitimate, and an extension makes no sense while
      // a new request is still pending/approved (nothing to extend yet). The
      // vrm_rental_request_ext_pending_uniq index backstops the race below.
      if (String(req.body?.requestType ?? "new") === "extension") {
        const guard = await liveRequestGuard(ldap);
        if (guard.blockExtension) {
          return res.status(409).json({
            success: false,
            requestNo: guard.blockExtension.requestNo,
            message: `You already have rental request #${guard.blockExtension.requestNo} with us `
                   + `(${guard.blockExtension.status}). Fleet is working it. Contact Fleet rather than filing another one.`,
          });
        }
      }

      const ip0 = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
      const out = await screenAndRecord({
        tokenRow: row,
        ldap,
        source: "form",
        identity: {
          techName: facts0.tech_name || row.tech_name || null,
          truckNumber: facts0.truck_number
            ? String(facts0.truck_number)
            : row.truck_number || null,
          district: facts0.district_no ?? null,
          homeState: facts0.home_state ?? null,
          mobilePhone: phoneFor(facts0) || row.phone || null,
        },
        body: b,
        ip: ip0,
      });
      return res.status(out.code).json(out.json);
    } catch (e: any) {
      if (handleAmbiguousActiveRentalIdentity(res, e, "success")) return;
      // The extension dedupe index firing here is a genuine race (two tabs,
      // two links), not a bug — answer it like the guard above would have.
      if (isUniqueViolationOn(e, "vrm_rental_request_ext_pending_uniq")) {
        return res.status(409).json({
          success: false,
          message: "You already have an extension request with us. Fleet is working it.",
        });
      }
      console.error("[rental-request] submit failed:", e?.message || e);
      res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
    }
  });
}


// ---------------------------------------------------------------------------
// Admin surface
// ---------------------------------------------------------------------------
export function registerRentalRequestAdminRoutes(router: Router): void {
  /**
   * The retrievable acknowledgement record: who signed, when, and the exact
   * bullet texts they attested to. Requests since the snapshot landed carry it
   * verbatim (ack_snapshot, written server-side at submit); older rows are
   * rendered from their stored booleans against TODAY's wording, flagged as
   * such — the wording has been revised before, so pretending a legacy render
   * is the signed text would be inventing evidence.
   */
  router.get("/forms/rental-request/:requestNo/acknowledgements", async (req, res) => {
    try {
      const no = Number(req.params.requestNo);
      if (!Number.isFinite(no)) return res.status(400).json({ message: "bad request number" });
      const { rows } = await db.execute(sql`
        SELECT request_no, ldap, tech_name,
               COALESCE(request_type, 'new') AS request_type,
               policy_version, policy_acknowledged_at, created_at,
               ack_snapshot,
               ack_not_maintenance, ack_cannot_drive_safely, ack_has_appointment,
               ack_return_one_day, ack_accurate,
               ack_working_hours_only, ack_return_before_time_off,
               ack_extension_weekly, ack_discipline
        FROM vrm_rental_request WHERE request_no = ${no}
      `);
      const r = (rows as any[])[0];
      if (!r) return res.status(404).json({ message: "request not found" });

      if (r.ack_snapshot) {
        return res.json({
          requestNo: r.request_no,
          requestType: r.request_type,
          source: "snapshot",
          snapshot: r.ack_snapshot,
        });
      }

      // Legacy render: booleans only, today's wording, honest caveat.
      const bullets = Object.keys(ACK_TEXTS)
        .filter((k) => r[k] === true)
        .map((k) => ({ key: k, text: ACK_TEXTS[k] }));
      return res.json({
        requestNo: r.request_no,
        requestType: r.request_type,
        source: "legacy_render",
        caveat: "This request predates stored acknowledgement snapshots. Bullets are the "
              + "statements marked as attested on the record, rendered with the CURRENT "
              + `wording — the signed wording was policy version ${r.policy_version || "unknown"}.`,
        snapshot: {
          policyVersion: r.policy_version || null,
          signerName: r.tech_name || null,
          signerLdap: r.ldap,
          requestType: r.request_type,
          signedAt: r.policy_acknowledged_at || r.created_at,
          bullets,
        },
      });
    } catch (e: any) {
      console.error("[rental-request] acknowledgements failed:", e?.message || e);
      res.status(500).json({ message: e?.message || "failed to load acknowledgements" });
    }
  });

  /**
   * Re-run the Samsara evidence check live during review (Task #759).
   * Evidence changes between submit and review — a fault can clear, a device
   * can come back online — so the reviewer can refresh the snapshot on
   * demand. Synchronous: the button waits for the real outcome. Advisory
   * only; it never touches status or decisions.
   */
  router.post("/forms/rental-request/:requestNo/samsara-check", async (req, res) => {
    try {
      const requestNo = Number(req.params.requestNo);
      if (!Number.isFinite(requestNo)) return res.status(400).json({ message: "bad request number" });
      const { rows } = await db.execute(sql`
        SELECT request_no, truck_number, problem_category, occurred_at, is_byov,
               COALESCE(request_type, 'new') AS request_type
        FROM vrm_rental_request WHERE request_no = ${requestNo}
      `);
      const row = (rows as any[])[0];
      if (!row) return res.status(404).json({ message: "request not found" });
      if (row.request_type === "extension") {
        return res.status(400).json({ message: "Samsara check applies to new requests only, not extensions" });
      }
      const category = String(row.problem_category ?? "");
      if (category !== "breakdown" && category !== "accident") {
        return res.status(400).json({ message: "Samsara check applies to breakdown/accident requests only" });
      }
      const snap = await captureRequestSamsaraEvidence({
        requestNo,
        truckNumber: row.truck_number ?? null,
        category,
        occurredAt: row.occurred_at ? new Date(row.occurred_at).toISOString() : null,
        isByov: row.is_byov === true,
      });
      if (!snap) return res.status(502).json({ message: "Samsara check failed to run — try again" });
      res.json({ verdict: snap.verdict, checkedAt: snap.checkedAt, evidence: snap });
    } catch (e: any) {
      res.status(500).json({ message: e?.message || "samsara check failed" });
    }
  });

  /** Refresh the BYOV mirror on demand. Also safe to call from a scheduler. */
  router.post("/forms/rental-request/sync-byov", async (_req, res) => {
    try {
      res.json(await syncByovStatus());
    } catch (e: any) {
      res.status(502).json({ message: e?.message || "byov sync failed" });
    }
  });

  /**
   * Did the boot migration actually land?
   *
   * initFormsSchema() runs last inside initVrmSchema(), and that chain is
   * attached with a non-fatal .catch(). An earlier failure means these objects
   * silently do not exist and every submit 500s. Check this after every publish
   * and BEFORE sending anything to a technician.
   *
   * Deliberately reachable with the internal-cron header as well as a session,
   * so it can be checked from a script without a browser login.
   */
  router.get("/forms/schema-health", async (_req, res) => {
    const REQUIRED: Array<[string, string[]]> = [
      ["vrm_form_tokens", ["token", "form_type", "sent_at", "opened_at", "submitted_at"]],
      ["vrm_rental_tech_survey",
        ["rental_branch_city", "rental_branch_state", "no_rental_reason",
         "techhub_still_using", "truck_mismatch"]],
      ["vrm_rental_request",
        ["request_no", "auto_decision", "auto_rule", "status", "is_byov",
         "appointment_at", "shop_estimated_days", "etd_booked_at", "policy_complete",
         // The concurrency guards. Omitted from the first version of this list,
         // which then reported ok:true while claimed_at did not exist — the one
         // failure mode a pre-flight check must never have.
         "claimed_at", "claimed_by", "source", "origin_survey_id",
         // Send-back. A health check that passes while the thing it guards is
         // missing is worse than no health check; that lesson cost a publish.
         "missing_fields", "returned_at", "return_count", "tech_reported_branch", "is_towed", "pickup_at", "return_at", "approved_branch", "accident_ok", "approval_sms_body",
         "ack_working_hours_only", "ack_return_before_time_off", "ack_extension_weekly", "ack_discipline",
         "policy_complete",
         // Extension option + acknowledgement snapshot. Same lesson as above:
         // a health check that omits what it guards is worse than none.
         "request_type", "ext_repair_status", "ext_last_shop_contact_at",
         "ext_shop_said", "ext_expected_completion", "ext_time_needed",
         "detected_open_rentals", "type_mismatch", "type_mismatch_explanation",
         "current_rental", "ack_snapshot",
         // Extension→Enterprise email record. Same lesson again: the decide
         // route UPDATEs these, so a skipped boot ALTER 500s every extension
         // approval in prod while dev stays green.
         "ext_reservation_number", "ext_days", "ext_email_state",
         "ext_email_to", "ext_email_sent_at", "ext_email_error",
         // Samsara evidence check (Task #759). The list SELECTs r.* and the
         // capture/re-check UPDATE these; a skipped boot ALTER would 500 the
         // re-check route in prod while dev stays green.
         "samsara_verdict", "samsara_evidence", "samsara_checked_at"]],
      ["vrm_byov_status", ["ldap", "status", "synced_at"]],
      ["vrm_etd_churn_log", ["ran_at", "dry_run", "added", "removed"]],
      // Cutover tracking. Without this the survey pool, the ETD reservation and
      // the route block have no shared record and the scoreboard reads empty
      // rather than broken.
      ["vrm_rental_cutover",
        ["ldap", "reservation_status", "etd_reference", "reserved_at",
         "route_block_status", "route_block_project_id", "route_block_filed_at",
         // Direct-billing switchover stamp. The cutover status SELECT
         // hard-references these; if a boot ALTER is skipped the whole page
         // 500s in prod — same lesson as above: a health check that omits
         // what it guards is worse than none.
         "direct_billing_confirmed_at", "direct_billing_last_seen_at",
         "direct_billing_evidence",
         "direct_billing_voided_at", "direct_billing_voided_by",
         "direct_billing_void_reason", "direct_billing_void_history"]],
    ];
    try {
      const problems: string[] = [];
      for (const [table, cols] of REQUIRED) {
        const { rows } = await db.execute(sql`
          SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = ${table}
        `);
        const have = new Set((rows as any[]).map((r) => r.column_name));
        if (!have.size) {
          problems.push(`TABLE MISSING: ${table}`);
          continue;
        }
        for (const c of cols) {
          if (!have.has(c)) problems.push(`${table}.${c} missing`);
        }
      }

      // Indexes are part of correctness here, not tuning: without the unique
      // index a concurrent double-submit becomes two ETD bookings.
      const requiredIndexes = [
        "vrm_rental_request_token_uniq",
        "vrm_rental_request_open_live_uniq",
        "vrm_rental_request_ext_pending_uniq",
        "vrm_rental_request_open_live_xtype_uniq",
      ];
      for (const idx of requiredIndexes) {
        const { rows } = await db.execute(sql`
          SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = ${idx}
        `);
        if (!(rows as any[]).length) problems.push(`INDEX MISSING: ${idx}`);
      }

      // A mirror that exists but is empty is not usable: every request would
      // route to REVIEW. Worth surfacing here rather than as a surprise.
      let byovRows = 0;
      try {
        const { rows } = await db.execute(sql`SELECT count(*)::int AS n FROM vrm_byov_status`);
        byovRows = Number((rows as any[])[0]?.n ?? 0);
      } catch { /* covered by the table-missing check above */ }

      const warnings: string[] = [];
      if (!problems.length && byovRows === 0) {
        warnings.push("vrm_byov_status is EMPTY — run POST /forms/rental-request/sync-byov "
          + "or every rental request routes to REVIEW");
      }

      res.status(problems.length ? 503 : 200).json({
        ok: problems.length === 0,
        problems,
        warnings,
        byovMirrorRows: byovRows,
        note: problems.length
          ? "Boot migration did NOT fully land. Do not send anything. Restart the deployment and re-check."
          : "Schema is in place.",
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, problems: [String(e?.message || e)] });
    }
  });

  /** Record a churn-sync run. Posted by scripts/churn_sync.py. */
  router.post("/forms/etd-churn/record", async (req2, res) => {
    try {
      const b = req2.body || {};
      const n = (v: any) => (v == null || Number.isNaN(Number(v)) ? null : Number(v));
      const { rows } = await db.execute(sql`
        INSERT INTO vrm_etd_churn_log
          (dry_run, roster_count, etd_count, to_add, to_remove, added, removed, failed, note)
        VALUES (${b.dryRun !== false}, ${n(b.rosterCount)}, ${n(b.etdCount)},
                ${n(b.toAdd)}, ${n(b.toRemove)}, ${n(b.added)}, ${n(b.removed)},
                ${n(b.failed)}, ${String(b.note ?? "").slice(0, 400) || null})
        RETURNING id, ran_at
      `);
      res.json({ ok: true, ...(rows as any[])[0] });
    } catch (e: any) {
      console.error("[etd-churn] record failed:", e?.message || e);
      res.status(500).json({ message: e?.message || "record failed" });
    }
  });

  /**
   * Recent runs, newest first, plus how long since the last REAL one. A sync
   * that quietly stopped three days ago is the failure mode worth surfacing,
   * and a dry run does not count as having run.
   */
  router.get("/forms/etd-churn/log", async (_req, res) => {
    try {
      const { rows } = await db.execute(sql`
        SELECT *, round(EXTRACT(EPOCH FROM (now() - ran_at)) / 3600.0) AS hours_ago
        FROM vrm_etd_churn_log ORDER BY ran_at DESC LIMIT 30
      `);
      const live = (rows as any[]).filter((r) => r.dry_run === false);
      res.json({
        runs: rows,
        lastRealRunHoursAgo: live.length ? Number(live[0].hours_ago) : null,
        stale: !live.length || Number(live[0].hours_ago) > 36,
      });
    } catch (e: any) {
      res.status(500).json({ message: e?.message || "log failed" });
    }
  });

  /**
   * The classes Fleet may approve, served so the picker and the validator cannot
   * disagree. The client used to hold its own hardcoded list. `options` is the
   * legacy five-label policy list (older clients, and the label→code mapping for
   * previously stored values); `menu` is the fixed Enterprise-class dropdown the
   * drawer now renders — every value resolves through the same validator.
   */
  router.get("/forms/rental-request/class-options", async (_req, res) => {
    res.json({ options: REQUEST_CLASS_OPTIONS, menu: ENTERPRISE_CLASS_MENU });
  });

  /**
   * The two Settings-tunable approval templates, served bare and FAST (one
   * settings read, no Snowflake). The drawer fetches these the moment it
   * opens so its INSTANT default — the one an approver can send before the
   * slow schedule lookup answers — already carries the admin's saved copy,
   * not just the built-ins. "" means "use the built-in", same contract as
   * everywhere else.
   */
  router.get("/forms/rental-request/approval-sms-templates", async (_req, res) => {
    try {
      // no-store: every drawer open must see the admin's CURRENT saved copy;
      // any intermediary caching would defeat the per-open freshness gate.
      res.set("Cache-Control", "no-store");
      res.json({ templates: await loadRequestApprovalTemplates() });
    } catch (e: any) {
      res.status(500).json({ message: e?.message || "templates unavailable" });
    }
  });

  /**
   * Everything the approval drawer needs BEFORE the approve click: the
   * Friday→Monday pickup default (with the Saturday-schedule fact behind it)
   * and the exact SMS the decide path will send, rendered with this request's
   * real values so the approver edits the real thing, never a paraphrase.
   *
   * ?pickupDate=YYYY-MM-DD re-renders the copy for a date the approver has
   * already changed in the drawer — the Monday wording (with the SHSAI
   * Uber-home line) only survives while the field still holds the rolled
   * Monday; any other date gets the standard copy for that date.
   */
  router.get("/forms/rental-request/:requestNo/approval-context", async (req, res) => {
    try {
      const no = Number(req.params.requestNo);
      if (!Number.isInteger(no)) return res.status(400).json({ message: "bad request number" });
      const { rows } = await db.execute(sql`
        SELECT ldap, tech_name, status,
               to_char(pickup_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS requested_date
        FROM vrm_rental_request WHERE request_no = ${no}
      `);
      const row = (rows as any[])[0];
      if (!row) return res.status(404).json({ message: "request not found" });

      // The date this approval would start from if nobody touched anything:
      // the technician's own FUTURE pickup, else today (the drawer's default).
      // A requested date already in the past cannot be booked, so it does not
      // get to decide which weekday the policy sees.
      const today = etTodayISO();
      const requested = String(row.requested_date ?? "");
      const base = requested && requested > today ? requested : today;

      const friday = isFridayISO(base);
      let saturday: { status: SaturdayStatus; detail: string } = { status: "unknown", detail: "" };
      let suggestion = { pickupDateISO: base, rolledToMonday: false, reason: "" };
      if (friday) {
        saturday = await saturdayScheduleFor(String(row.ldap ?? ""), addDaysISO(base, 1));
        suggestion = fridayPickupSuggestion({ baseISO: base, saturday: saturday.status });
      }

      // Render the default SMS for the date the drawer currently shows —
      // through the SAME resolver the decide route uses for a blank body, so
      // the previewed default and the sent/audited fallback are byte-identical
      // by construction, whichever arrives first. (This also makes the
      // Monday/Uber copy a pure function of base + chosen date, not of the
      // schedule: booking the rolled Monday reads the Monday copy even when
      // the tech works Saturday, because the car still sits until Monday.)
      const qd = String(req.query.pickupDate ?? "").trim();
      const pickupISO = /^\d{4}-\d{2}-\d{2}$/.test(qd) ? qd : suggestion.pickupDateISO;
      const resolved = resolveApprovalDecideSms({
        override: "",
        todayISO: today,
        requestedPickupISO: requested,
        effectivePickupISO: pickupISO,
        techName: row.tech_name ?? null,
        techLdap: String(row.ldap ?? ""),
        templates: await loadRequestApprovalTemplates(),
      });
      const smsBody = resolved.body;
      const mondayCopy = resolved.mondayCopy;

      res.json({
        friday,
        saturday,
        suggestedPickupDate: suggestion.pickupDateISO,
        rolledToMonday: suggestion.rolledToMonday,
        reason: suggestion.reason,
        pickupDate: pickupISO,
        smsBody,
        smsIsMondayCopy: mondayCopy,
        maxSmsLen: APPROVAL_SMS_MAX_LEN,
      });
    } catch (e: any) {
      console.error("[rental-request] approval-context failed:", e?.message || e);
      res.status(500).json({ message: e?.message || "approval context failed" });
    }
  });

  router.get("/forms/rental-request/missing-reasons", async (_req, res) => {
    // The deny script rides along for the same reason the reasons do: the
    // review UI pre-fills it, the technician receives it, and served-not-
    // duplicated is what keeps those two sentences the same sentence.
    res.json({ reasons: MISSING_REASONS, maintenanceDenyScript: MAINTENANCE_DENY_SCRIPT });
  });

  router.get("/forms/rental-request/list", async (_req, res) => {
    try {
      const { rows } = await db.execute(sql`
        SELECT r.*, t.sent_at, t.opened_at,
               -- The Holman-workflow evaluation: latest profitability snapshot
               -- for this technician rides on the request so the decision is
               -- made with the number in view, never from memory.
               pf.daily_revenue        AS prof_daily_revenue,
               pf.daily_costs          AS prof_daily_costs,
               pf.daily_net_before_rental AS prof_net_before,
               pf.daily_net_with_rental   AS prof_net_with,
               pf.recommendation       AS prof_recommendation,
               pf.scorecard_score      AS prof_scorecard,
               pf.scorecard_exempt     AS prof_scorecard_exempt,
               pf.daily_ppt_profit     AS prof_ppt,
               pf.tenure_months        AS prof_tenure_months,
               pf.new_hire_exempt      AS prof_new_hire_exempt,
               pf.synced_at            AS prof_synced_at,
               -- What was ACTUALLY booked, and whether the technician was actually
               -- told. The row itself only knows the REQUESTED pickup and a branch
               -- name; the branch address, the real pickup datetime, the class
               -- Enterprise gave, and the message state all live on the workflow
               -- intent. Without them the page showed "BOOKED" beside a pickup time
               -- Enterprise never agreed to, and asserted the technician had been
               -- texted whether or not anything had been sent.
               wi.resv                 AS booked_facts,
               wi.msg1_state           AS msg1_state,
               wi.intent_error         AS intent_error
        FROM vrm_rental_request r
        LEFT JOIN vrm_form_tokens t ON t.id = r.token_id
        LEFT JOIN LATERAL (
          SELECT i.preview -> 'reservation' AS resv,
                 i.msg1_state,
                 i.last_error AS intent_error
            FROM vrm_rental_workflow_intents i
           WHERE i.workflow_type = 'rental_request'
             AND (i.source_id = r.request_no::text OR i.source_id = r.id::text)
           ORDER BY i.id DESC LIMIT 1
        ) wi ON true
        LEFT JOIN LATERAL (
          SELECT * FROM vrm_profitability_snapshot p
          WHERE upper(p.tech_ldap) = upper(r.ldap)
          ORDER BY p.synced_at DESC LIMIT 1
        ) pf ON true
        ORDER BY r.created_at DESC
      `);
      // Billing standing for extensions still awaiting a decision is computed
      // LIVE here, never read from the submit-time pin: a direct-billing
      // import landing after submit must self-heal the badge, and historical
      // pending extensions (submitted before the check existed) get it the
      // same way. The stored ext_billing_* columns stay on the row as audit
      // evidence. getExtensionBillingStanding never throws — a lookup failure
      // rides along as verdict 'unknown' with checkFailed set, so a standing
      // outage cannot take the whole list down.
      const reqRows = rows as any[];
      const liveRows = reqRows.filter((r) =>
        String(r.request_type ?? "new") === "extension"
        && ["pending", "deferred", "returned"].includes(String(r.status)));
      if (liveRows.length) {
        const uniq = Array.from(new Set(liveRows.map((r) => String(r.ldap ?? "").trim().toUpperCase())));
        const checks = new Map(await Promise.all(uniq.map(async (l) =>
          [l, await getExtensionBillingStanding(l)] as const)));
        for (const r of liveRows) {
          r.ext_billing_live = checks.get(String(r.ldap ?? "").trim().toUpperCase()) ?? null;
        }
      }
      res.json({ requests: reqRows });
    } catch (e: any) {
      res.status(500).json({ message: e?.message || "Failed to load requests." });
    }
  });

  /**
   * Form-open funnel: how many people opened, passed identity, and submitted.
   * Also surfaces failed-verify reason buckets so Fleet can spot a stuck tech.
   */
  router.get("/forms/rental-request/funnel", async (_req, res) => {
    try {
      const { rows } = await db.execute(sql`
        SELECT
          count(*) FILTER (WHERE event = 'start')                         AS starts,
          count(*) FILTER (WHERE event = 'verify_ok')                     AS verifies,
          count(*) FILTER (WHERE event = 'submit')                        AS submits,
          count(*) FILTER (WHERE event = 'verify_fail')                   AS verify_fails,
          count(*) FILTER (WHERE event = 'verify_fail'
                              AND outcome = 'not_on_roster')              AS fail_not_on_roster,
          count(*) FILTER (WHERE event = 'verify_fail'
                              AND outcome = 'open_request')               AS fail_open_request,
          count(*) FILTER (WHERE event = 'verify_fail'
                              AND outcome = 'daily_cap')                  AS fail_daily_cap,
          to_char(max(occurred_at) FILTER (WHERE event = 'start')
                    AT TIME ZONE 'America/New_York',
                  'MM/DD HH12:MI AM')                                     AS last_start_et,
          to_char(max(occurred_at) FILTER (WHERE event = 'verify_ok')
                    AT TIME ZONE 'America/New_York',
                  'MM/DD HH12:MI AM')                                     AS last_verify_et,
          to_char(max(occurred_at) FILTER (WHERE event = 'submit')
                    AT TIME ZONE 'America/New_York',
                  'MM/DD HH12:MI AM')                                     AS last_submit_et
        FROM vrm_rental_request_events
      `);
      res.json(rows[0] || {});
    } catch (e: any) {
      res.status(500).json({ message: e?.message || "Failed to load funnel." });
    }
  });

  /** Denials are the number worth reporting, so they lead. */
  router.get("/forms/rental-request/stats", async (_req, res) => {
    try {
      const { rows } = await db.execute(sql`
        SELECT
          count(*)                                                        AS total,
          count(*) FILTER (WHERE auto_decision = 'DENY')                  AS auto_denied,
          count(*) FILTER (WHERE auto_decision = 'DEFER')                 AS deferred,
          count(*) FILTER (WHERE auto_decision = 'REVIEW')                AS needs_review,
          count(*) FILTER (WHERE auto_decision = 'APPROVE')               AS auto_approved,
          count(*) FILTER (WHERE status = 'booked')                       AS booked,
          count(*) FILTER (WHERE auto_rule = 1)                           AS denied_maintenance,
          count(*) FILTER (WHERE auto_rule = 2)                           AS denied_drivable,
          count(*) FILTER (WHERE auto_rule = 4)                           AS denied_same_day,
          round(100.0 * count(*) FILTER (WHERE auto_decision <> 'APPROVE')
                / NULLIF(count(*), 0), 0)                                 AS pct_resolved_without_rental
        FROM vrm_rental_request
        -- Voided rows were filed into the wrong queue and administratively
        -- erased — counting them (their auto_decision is frozen at submit)
        -- would inflate "needs review" and the resolved-without-rental rate
        -- forever. They stay visible in the list; they just are not KPIs.
        WHERE status <> 'voided'
      `);
      res.json(rows[0] || {});
    } catch (e: any) {
      res.status(500).json({ message: e?.message || "Failed to load stats." });
    }
  });

  /**
   * Fleet adjusts the class the booking will reserve. The engine writes sedan
   * (cargo van for the HVAC carve-out) at submit; this is the when-necessary
   * override — a branch with no sedans, parts that must ride along.
   *
   * Only while nothing external can exist: past Confirm a reservation may be
   * in flight, and changing the class here would book something nobody
   * previewed. A merely-built preview is knocked back to preview_required so
   * the next preview re-quotes under the new class, and Confirm's version CAS
   * refuses the stale one.
   */
  router.post("/forms/rental-request/:requestNo/vehicle-class", async (req, res) => {
    try {
      const no = Number(req.params.requestNo);
      if (!Number.isInteger(no)) return res.status(400).json({ message: "bad request number" });
      // Normalised to what the bookers match against ETD's offered classes:
      // lowercase words, no underscores ("cargo van", never "cargo_van" —
      // the underscore form can never substring-match a description).
      const cls = String(req.body?.vehicleClass ?? "")
        .trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").slice(0, 40);
      if (!cls) return res.status(400).json({ message: "vehicleClass is required" });
      // Refuse a class this system cannot book, HERE, while a human is looking at the
      // screen. Until 2026-08-19 this accepted any 40 characters and stored them
      // verbatim; the first anyone heard about an unbookable value was a failed
      // booking hours later, with the technician already waiting.
      if (resolveRequestClass(cls) === null) {
        return res.status(400).json({
          message: `'${cls}' is not a class we can book. Valid values: `
                 + REQUEST_CLASS_OPTIONS.map((o) => o.label).join(", ") + ".",
          options: REQUEST_CLASS_OPTIONS,
        });
      }
      const actor = (req as any).user?.username || (req as any).user?.email || "unknown";

      const inFlight = await requestBookingInFlight(String(no));
      if (inFlight) {
        return res.status(409).json({
          message: `The booking workflow is already ${inFlight.status}. Cancel it first — `
                 + "a reservation may exist under the current class.",
        });
      }

      // old.prev rides back so the late-confirm revert below restores the
      // exact value, not a guess.
      const { rows } = await db.execute(sql`
        UPDATE vrm_rental_request r
        SET approved_vehicle_class = ${cls}, updated_at = now()
        FROM (SELECT request_no, approved_vehicle_class AS prev
              FROM vrm_rental_request WHERE request_no = ${no}) old
        WHERE r.request_no = old.request_no
          AND r.status IN ('pending','approved')
          AND r.etd_booked_at IS NULL
        RETURNING old.prev
      `);
      if (!(rows as any[]).length) {
        const { rows: cur } = await db.execute(sql`
          SELECT status FROM vrm_rental_request WHERE request_no = ${no}
        `);
        if (!(cur as any[]).length) return res.status(404).json({ message: "request not found" });
        return res.status(409).json({
          message: `Class is fixed once the request is ${(cur as any[])[0].status}. `
                 + "It must be pending or approved, and not booked.",
        });
      }
      const prev = (rows as any[])[0].prev ?? null;

      // Any built preview now shows a class this request no longer wants.
      const previewsInvalidated = await invalidateRequestPreviews(
        String(no), `vehicle class set to '${cls}' by ${actor}`);

      // Close the race this whole dance exists for: Confirm CAS'd
      // preview_ready -> confirmed between our first check and the
      // invalidation, so the booking would proceed on the OLD class. The
      // adjustment must not stand. CAS on the value we wrote, so a later
      // legitimate edit is never clobbered by this revert.
      const late = await requestBookingInFlight(String(no));
      if (late) {
        await db.execute(sql`
          UPDATE vrm_rental_request SET approved_vehicle_class = ${prev}, updated_at = now()
          WHERE request_no = ${no} AND approved_vehicle_class = ${cls}
        `);
        return res.status(409).json({
          message: `The booking confirmed while you were editing — class change reverted. `
                 + `Cancel the ${late.status} workflow first if the class is wrong.`,
        });
      }

      res.json({ ok: true, vehicleClass: cls, previewsInvalidated });
    } catch (e: any) {
      res.status(500).json({ message: e?.message || "class update failed" });
    }
  });

  /** Human decision. May overrule the engine, and must say why when it does. */
  /**
   * The ETD reservation for this request was cancelled. Let the request move again.
   *
   * WHY THIS EXISTS
   * ---------------
   * /decide refuses any row whose status is 'booked' (`AND status <> 'booked'`), on the
   * correct reasoning that flipping a booked request to DENY would leave a live rental
   * against a denied request. But there was no way to tell the system the rental is no
   * longer live, so once a booking was wrong the request was frozen forever and the
   * message told staff to do something the app then would not let them act on.
   *
   * Rob hit this on 2026-08-19 with LGONZ15: a California technician booked at Boston
   * Logan. He cancelled 2130366343 in ETD and still could not send the request back.
   *
   * Releasing requires naming the confirmation being released, so this cannot be used to
   * clear the wrong row by accident, and the row goes back to 'pending' - NOT 'approved',
   * which the booking queue would immediately pick up and book all over again.
   */
  router.post("/forms/rental-request/:requestNo/release-booking", async (req, res) => {
    try {
      const no = Number(req.params.requestNo);
      if (!Number.isInteger(no)) return res.status(400).json({ message: "bad request number" });
      const claimed = String(req.body?.cancelledReference ?? "").trim();
      const reason = String(req.body?.reason ?? "").trim().slice(0, 300);
      if (!claimed) {
        return res.status(400).json({
          message: "cancelledReference is required - name the confirmation number you "
                 + "cancelled in ETD, so this cannot release the wrong booking.",
        });
      }
      if (!reason) return res.status(400).json({ message: "reason is required" });
      const actor = (req as any).user?.username || (req as any).user?.email || "unknown";

      const { rows: cur } = await db.execute(sql`
        SELECT status, etd_reference, etd_booked_at FROM vrm_rental_request
         WHERE request_no = ${no}
      `);
      const row = (cur as any[])[0];
      if (!row) return res.status(404).json({ message: "request not found" });
      if (!row.etd_booked_at) {
        return res.status(409).json({ message: "this request holds no booking to release" });
      }
      if (String(row.etd_reference ?? "").trim() !== claimed) {
        return res.status(409).json({
          message: `this request holds confirmation ${row.etd_reference}, not ${claimed}. `
                 + "Check which reservation you cancelled.",
        });
      }

      const note = `reservation ${claimed} cancelled in ETD and released by ${actor}: ${reason}`;
      const upd = await db.transaction(async (tx) => {
        const { rows } = await tx.execute(sql`
          UPDATE vrm_rental_request
             SET status = 'pending',
                 etd_reference = NULL, etd_reservation_id = NULL, etd_booked_at = NULL,
                 etd_error = ${note},
                 claimed_at = NULL, claimed_by = NULL,
                 updated_at = now()
           WHERE request_no = ${no} AND etd_reference = ${claimed}
          RETURNING request_no, id::text AS request_id, status
        `);
        const released = (rows as any[])[0];
        if (!released) return [];

        // Terminate the workflow intent in the same transaction. Leaving it live would
        // preserve the per-LDAP lock and let a runner adopt or book a second car.
        await tx.execute(sql`
          UPDATE vrm_rental_workflow_intents
             SET status = 'cancelled', reservation_state = 'cancelled',
                 last_error = ${note}, claimed_by = NULL, lease_expires_at = NULL,
                 updated_at = now()
           WHERE workflow_type = ${WORKFLOW_REQUEST}
             AND (source_id = ${String(no)} OR source_id = ${String(released.request_id)})
             AND status NOT IN ('cancelled', 'abandoned')
        `);
        return rows as any[];
      });
      if (!upd.length) return res.status(409).json({ message: "nothing released" });

      res.json({ ok: true, requestNo: no, status: "pending", released: claimed, note });
    } catch (e: any) {
      console.error("[rental-request] release-booking failed:", e?.message || e);
      res.status(500).json({ message: e?.message || "release failed" });
    }
  });

  router.post("/forms/rental-request/:requestNo/decide", async (req, res) => {
    try {
      const decision = String(req.body?.decision || "").toUpperCase();
      if (!["APPROVE", "DENY", "DEFER", "RETURN", "VOID"].includes(decision)) {
        return res.status(400).json({ message: "decision must be APPROVE, DENY, DEFER, RETURN or VOID" });
      }
      const note = String(req.body?.note || "").trim();
      // Fleet's pickup override. Only meaningful on APPROVE: the reservation
      // starts on this date instead of the technician's own.
      const pickupAt = decision === "APPROVE"
        ? String(req.body?.pickupAt || "").trim().slice(0, 40) || null : null;
      // Shape-check before this string reaches a ::timestamptz cast below —
      // a malformed value would otherwise surface as a 500 from Postgres.
      if (pickupAt && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(pickupAt)) {
        return res.status(400).json({ message: "pickupAt must be YYYY-MM-DDTHH:MM" });
      }
      // Fleet's return date. Same override shape as the pickup, and it is what
      // decides the number of days Enterprise bills for.
      // Fleet's branch. Overrides the shop address AND the technician's own
      // answer, and switches off the state guard, because a human typed it on
      // purpose.
      const approvedBranch = decision === "APPROVE"
        ? String(req.body?.approvedBranch || "").trim().slice(0, 300) || null : null;
      const returnAt = decision === "APPROVE"
        ? String(req.body?.returnAt || "").trim().slice(0, 40) || null : null;
      if (returnAt && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(returnAt)) {
        return res.status(400).json({ message: "returnAt must be YYYY-MM-DDTHH:MM" });
      }
      // The approver-reviewed (possibly edited) acknowledgement SMS. The drawer
      // always sends the body it previewed — default or edited — so what the
      // approver SAW is what the technician receives. Absent or blank (API
      // callers that never previewed anything, or a cleared textarea) resolves
      // to the SAME shared policy default the drawer previews — standard or
      // Monday/Uber copy — never a separate generic literal that would bypass
      // the Friday→Monday policy.
      // APPROVE-only: deny/defer/return keep their fixed scripts.
      // Kept RAW: the resolver trims only to decide blankness, so a human
      // edit reaches the send and the audit byte-identical to the preview.
      const approvalSms = decision === "APPROVE" && typeof req.body?.approvalSms === "string"
        ? req.body.approvalSms : "";
      if (approvalSms.length > APPROVAL_SMS_MAX_LEN) {
        return res.status(400).json({
          message: `approvalSms is ${approvalSms.length} characters; the cap is ${APPROVAL_SMS_MAX_LEN}.`,
        });
      }

      // EXTENSION approvals: Enterprise's Account Support extends by email and
      // their required key is the reservation / RA number — which we do not
      // reliably hold, so the approver supplies it. Days default to the weekly
      // cadence (7) and stay editable.
      const extReservation = String(req.body?.reservationNumber || "").trim().slice(0, 60);
      const extDaysRaw = Number(req.body?.extensionDays);
      const extDays = Number.isFinite(extDaysRaw)
        ? Math.max(1, Math.min(30, Math.round(extDaysRaw))) : 7;

      // RETURN is "you have not given us enough to book this", which is a
      // different fact from "no". It must name what is missing, because a
      // send-back that just says incomplete sends the technician back to a
      // form they already believe they filled in.
      const missing: string[] = Array.isArray(req.body?.missing)
        ? req.body.missing.map((m: any) => String(m)).filter((m: string) => m in MISSING_REASONS)
        : [];
      if (decision === "RETURN" && !missing.length) {
        return res.status(400).json({
          message: "Say what is missing. Pick at least one of: " + Object.keys(MISSING_REASONS).join(", "),
        });
      }
      const actor = (req as any).user?.username || (req as any).user?.email || "unknown";

      const { rows } = await db.execute(sql`
        SELECT auto_decision,
               COALESCE(request_type, 'new') AS request_type,
               -- Whether this approval carries a DIFFERENT pickup time than the row
               -- holds. Compared in SQL so both sides normalize through timestamptz;
               -- string-comparing "2026-08-18T16:00" against a serialized DB value
               -- would report a change on every approve.
               (${pickupAt}::timestamptz IS DISTINCT FROM pickup_at) AS pickup_changes,
               -- The start this approval will actually book from, resolved the same
               -- way the booking queue resolves it, so the day count validated here
               -- is the day count Enterprise gets.
               to_char(COALESCE(${pickupAt}::timestamptz, pickup_at, appointment_at),
                       'YYYY-MM-DD"T"HH24:MI:SS') AS effective_pickup,
               -- ET calendar days for the SMS fallback render: the tech's own
               -- requested day (the Friday-policy base) and the day this
               -- approval actually books from.
               ldap, tech_name,
               to_char(pickup_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS requested_day_et,
               to_char(COALESCE(${pickupAt}::timestamptz, pickup_at, appointment_at)
                       AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS effective_pickup_day_et
        FROM vrm_rental_request WHERE request_no = ${Number(req.params.requestNo)}
      `);
      const cur = (rows as any[])[0];

      // Approving an EXTENSION books nothing: Fleet extends the existing
      // rental with Enterprise manually. Pickup/return/branch are new-booking
      // concepts, so they are ignored rather than validated here.
      const isExtensionRow = String(cur?.request_type ?? "new") === "extension";

      // VOID is the administrative eraser for an extension that should never
      // have entered this queue (filed by a Holman-book-only tech who needs
      // the cutover first, duplicate, wrong tech). It is NOT a denial: the
      // technician keeps whatever rental they hold and hears NOTHING — no
      // SMS, no Enterprise email — because the request itself was the
      // mistake, not their situation. Extension-only: a wrong NEW request
      // already has DENY (a real "no") and RETURN (send back) with the
      // booking chain built around them. The note is mandatory — a silently
      // vanished request with no recorded reason is a mystery a week later.
      if (decision === "VOID" && !isExtensionRow) {
        return res.status(400).json({
          message: "VOID is for extension requests only. Deny or send back a new request instead.",
        });
      }
      if (decision === "VOID" && !note) {
        return res.status(400).json({
          message: "Say why this extension is being voided (e.g. Holman-billed only — needs the cutover first).",
        });
      }

      // Blocked exactly when the reservation number is missing: the approval
      // AUTO-SENDS the Enterprise email, and an email without their key is a
      // dead letter. Enforced server-side so API callers can't approve past it.
      if (decision === "APPROVE" && isExtensionRow && !extReservation) {
        return res.status(400).json({
          message: "Enter the Enterprise reservation / RA number first — approving an "
                 + "extension emails Enterprise automatically and they file by that number.",
        });
      }

      // A return date before the pickup silently produces a negative rental that
      // ETD answers with an empty class list and no explanation.
      if (returnAt && !isExtensionRow) {
        const startIso = String(cur?.effective_pickup || "");
        if (!startIso) {
          return res.status(400).json({
            message: "Set a pickup date before a return date. There is no start to count from.",
          });
        }
        if (returnAt <= startIso) {
          return res.status(400).json({
            message: `Return date must be after the pickup (${startIso.replace("T", " ")}).`,
          });
        }
        const days = Math.round(
          (Date.parse(returnAt) - Date.parse(startIso)) / 86400000);
        // Fleet policy, not a vendor limit. ETD quotes 90 days perfectly happily
        // (measured 2026-08-20: 27 classes at every duration from 1 to 90 at the
        // same branch), so nothing stops a long booking except us. Tyler,
        // 2026-08-20: "we're not gonna be setting it up for more than seven days."
        // Longer stays happen by EXTENDING weekly, which is the cadence the
        // technician signs in the acknowledgements and the thing Fleet can stop.
        // A long booking is a car nobody is reviewing.
        if (days > MAX_RENTAL_DAYS) {
          return res.status(400).json({
            message: `That is a ${days}-day rental and the cap is ${MAX_RENTAL_DAYS}. `
                   + "Book up to a week, then extend if the shop still has the van.",
          });
        }
      }
      if (!cur) return res.status(404).json({ message: "request not found" });
      // Routine decisions are a human judgment, not an engine-override
      // exception. APPROVE, DENY and DEFER notes are therefore optional even
      // when the recommendation differs; RETURN and VOID retain their
      // evidence safeguards above.

      // EXTENSION approve gate: is the rental being extended actually
      // DIRECT-BILLED? Computed FRESH here — the submit-time pin is audit
      // evidence and is never trusted for the gate — through the same shared
      // standing predicate as the Holman queue's badge/denial SMS. A
      // holman_only approval without an explicit staff acknowledgement is
      // refused (server-enforced, so API callers cannot route around the
      // checkbox). A FAILED lookup degrades OPEN with a logged warning:
      // feed lag or a standing outage must never strand a real extension.
      const billingAck = req.body?.holmanOnlyAcknowledged === true;
      let extBillingDecide: ExtensionBillingCheck | null = null;
      if (decision === "APPROVE" && isExtensionRow) {
        extBillingDecide = await getExtensionBillingStanding(String(cur.ldap ?? ""));
        if (extBillingDecide.checkFailed) {
          console.warn(`[rental-request] decide #${req.params.requestNo}: billing-standing check `
            + `failed (${extBillingDecide.error || "unknown error"}) — approval proceeds unblocked`);
        } else if (extBillingDecide.verdict === "holman_only" && !billingAck) {
          return res.status(409).json({
            message: "This rental is on the Holman (ECARS) book only — it was never switched to "
                   + "direct billing, so Enterprise bills Holman for it, not us. Tick the "
                   + "acknowledgement to approve anyway, or run the cutover first.",
            billingVerdict: "holman_only",
            requiresBillingAcknowledgement: true,
          });
        }
      }

      if (decision === "VOID") {
        const no = Number(req.params.requestNo);
        try {
          await db.transaction(async (tx) => {
            const { rows: lockedRows } = await tx.execute(sql`
              SELECT id, request_no, COALESCE(request_type, 'new') AS request_type, status
              FROM vrm_rental_request
              WHERE request_no = ${no}
              FOR UPDATE
            `);
            const locked = (lockedRows as any[])[0];
            if (!locked) {
              throw new OrchestratorError("request_not_found", "request not found", 404);
            }
            if (String(locked.request_type) !== "extension") {
              throw new OrchestratorError(
                "void_new_request",
                "VOID is for extension requests only. Deny or send back a new request instead.",
                400,
              );
            }
            if (["approved", "booked"].includes(String(locked.status))) {
              throw new OrchestratorError(
                "void_too_late",
                "Too late to void — this extension is already approved and the Enterprise email may already be on its way. "
                  + "Deny it instead, or sort it out with Enterprise directly.",
                409,
              );
            }

            await retireRequestIntentsBeforeSourceRemoval({
              requestNo: no,
              requestId: String(locked.id),
              retiredBy: actor,
              reason: `request voided: ${note}`,
            }, tx);

            const { rows: voided } = await tx.execute(sql`
              UPDATE vrm_rental_request
              SET status = 'voided',
                  decided_by = ${actor},
                  decided_at = now(),
                  decision_note = ${note},
                  updated_at = now()
              WHERE request_no = ${no}
                AND status NOT IN ('approved','booked')
              RETURNING request_no
            `);
            if (!(voided as any[]).length) {
              throw new OrchestratorError(
                "void_conflict",
                "The request changed while it was being voided. Reload it for manual review.",
                409,
              );
            }
          });
        } catch (e: any) {
          if (e instanceof OrchestratorError) {
            return res.status(e.httpStatus).json({
              message: e.message,
              code: e.code,
              intentId: e.extra?.intentId ?? null,
            });
          }
          throw e;
        }
        return res.json({ ok: true, decision });
      }

      // Never overwrite a booked row. Denying one would leave a live ETD
      // reservation attached to a request the record says was refused, and
      // nothing downstream would ever go cancel it.
      const nextStatus =
        decision === "APPROVE" ? "approved"
        : decision === "DENY" ? "denied"
        : decision === "RETURN" ? "returned"
        : decision === "VOID" ? "voided"
        : "deferred";
      // Resolved BEFORE the UPDATE so the row records the exact words sent —
      // the approver's edit when one arrived, the SHARED policy default
      // (Settings-aware, Monday/Uber copy when the booked start is the rolled
      // Monday) otherwise. One resolver, so a blank body can never route
      // around the Friday→Monday policy through a side-door literal.
      // An EXTENSION approval books nothing, so the Friday→Monday resolver
      // (a new-booking concept) never runs for it; the fixed extension copy
      // is what gets sent and audited.
      // The pickup day the technician will be TOLD. A same-day approval taken
      // after the branch cutoff is booked for the next morning by the preview,
      // so promising today here would be a lie the confirmation text then has
      // to contradict.
      const smsPickupDayEt = (() => {
        const day = String(cur.effective_pickup_day_et ?? "");
        const time = /T(\d{2}:\d{2}:\d{2})/.exec(String(cur.effective_pickup ?? ""))?.[1]
          ?? "09:00:00";
        return resolvePickupWindow({ dayISO: day, wantedTime: time, todayISO: etTodayISO() }).day;
      })();
      const approveText = decision !== "APPROVE"
        ? ""
        : isExtensionRow
          ? "Sears Fleet: your rental extension is approved. We are arranging the extra "
            + "time with Enterprise — keep the rental, no action needed unless we text you."
          : resolveApprovalDecideSms({
              override: approvalSms,
              todayISO: etTodayISO(),
              requestedPickupISO: String(cur.requested_day_et ?? ""),
              // The day the BOOKING will really use, not the day the row asked
              // for. Same cutoff the preview applies, imported from the one
              // module that owns it.
              effectivePickupISO: smsPickupDayEt,
              techName: cur.tech_name ?? null,
              techLdap: String(cur.ldap ?? ""),
              // Blankness here must match the resolver's own test (trim), or a
              // whitespace-only body would skip loading the Settings templates
              // while the resolver still falls back to the default copy.
              templates: approvalSms.trim() ? { standard: "", monday: "" } : await loadRequestApprovalTemplates(),
            }).body;
      const { rows: upd } = await db.execute(sql`
        UPDATE vrm_rental_request
        SET status = ${nextStatus},
            -- An extension carries NO booking coordinates. Cleared outright,
            -- not COALESCEd: a stale pickup/branch left on the row from any
            -- earlier write would read like a booking to everything downstream.
            pickup_at = ${isExtensionRow ? sql`NULL` : sql`COALESCE(${pickupAt}::timestamptz, pickup_at)`},
            return_at = ${isExtensionRow ? sql`NULL` : sql`COALESCE(${returnAt}::timestamptz, return_at)`},
            approved_branch = ${isExtensionRow ? sql`NULL` : sql`COALESCE(${approvedBranch}, approved_branch)`},
            approval_sms_body = ${decision === "APPROVE" ? sql`${approveText}` : sql`approval_sms_body`},
            -- The Enterprise email's facts, captured with the approval that
            -- triggers it. Only an extension APPROVE writes them.
            ext_reservation_number = ${decision === "APPROVE" && isExtensionRow
              ? sql`${extReservation}` : sql`ext_reservation_number`},
            ext_days = ${decision === "APPROVE" && isExtensionRow
              ? sql`${extDays}` : sql`ext_days`},
            -- The approve-time gate's own fresh verdict, plus whether staff
            -- explicitly acknowledged a Holman-book-only approval. Audit
            -- trail beside the untouched submit-time pin.
            ext_billing_decide_verdict = ${extBillingDecide
              ? sql`${extBillingDecide.verdict}` : sql`ext_billing_decide_verdict`},
            ext_billing_ack = ${extBillingDecide
              ? sql`${billingAck && extBillingDecide.verdict === "holman_only"}` : sql`ext_billing_ack`},
            decided_by = ${actor}, decided_at = now(), decision_note = ${note || null},
            missing_fields = ${decision === "RETURN"
              // string_to_array, not a bound JS array. Interpolating an array into
              // a drizzle sql`` template binds it as a record and Postgres answers
              // "cannot cast type record to text[]". Same family of trap as the
              // ANY() one. The values are keys already filtered against
              // MISSING_REASONS, so they are a known-safe shape with no commas.
              ? sql`string_to_array(${missing.join(",")}, ',')`
              : sql`missing_fields`},
            returned_at    = ${decision === "RETURN" ? sql`now()` : sql`returned_at`},
            return_count   = ${decision === "RETURN" ? sql`return_count + 1` : sql`return_count`},
            updated_at = now()
        -- Self-join capture of the PRE-update status, locked FOR UPDATE so two
        -- concurrent decides serialize: side effects below (the extension
        -- email) must fire on the TRANSITION into approved, not on every
        -- replayed APPROVE — cur.status from the earlier SELECT is a stale
        -- read and cannot make that call race-free.
        FROM (SELECT request_no AS prev_rn, status AS prev_status
              FROM vrm_rental_request
              WHERE request_no = ${Number(req.params.requestNo)}
              FOR UPDATE) old
        WHERE vrm_rental_request.request_no = old.prev_rn
          AND vrm_rental_request.status <> 'booked'
          -- APPROVE is an edge, not a level. Replaying it must not rewrite the
          -- first approval audit or repeat SMS/email/booking side effects.
          ${decision === "APPROVE" ? sql`AND vrm_rental_request.status <> 'approved'` : sql``}
          -- VOID is refused once the row is APPROVED, and the refusal lives
          -- INSIDE the same locked UPDATE that decides everything else: the
          -- approve path schedules the Enterprise email after its own commit,
          -- and sendExtensionEmail's status re-check leaves a read-then-send
          -- window a post-approve void could slip through. Racing decides
          -- serialize on the FOR UPDATE row lock, so whichever lands first
          -- wins and the loser gets a clean refusal, never a half-state.
          ${decision === "VOID" ? sql`AND vrm_rental_request.status <> 'approved'` : sql``}
        RETURNING vrm_rental_request.request_no, old.prev_status
      `);
      if (!(upd as any[]).length) {
        if (decision === "APPROVE") {
          const { rows: current } = await db.execute(sql`
            SELECT status, request_type, etd_booked_at
              FROM vrm_rental_request
             WHERE request_no = ${Number(req.params.requestNo)}
          `);
          const currentRow = (current as any[])[0];
          if (String(currentRow?.status ?? "") === "approved") {
            // The decision/audit/SMS remain idempotent, but a deliberate second
            // Approve is also the sole recovery door for an approved request
            // whose pre-intent lookup failed closed. The helper re-reads the
            // durable intent and attempt fences before it can reach ETD; an
            // ambiguous or already-booked intent therefore remains readback-only.
            const recoveryStarted =
              String(currentRow?.request_type ?? "new") !== "extension"
              && !currentRow?.etd_booked_at;
            if (recoveryStarted) {
              void autoBookApprovedRequest(Number(req.params.requestNo));
            }
            return res.json({ ok: true, decision, idempotent: true, recoveryStarted });
          }
        }
        if (decision === "VOID") {
          return res.status(409).json({
            message: "Too late to void — this extension is already approved and the Enterprise "
                   + "email may already be on its way. Deny it instead, or sort it out with "
                   + "Enterprise directly.",
          });
        }
        return res.status(409).json({
          message: "This request is already BOOKED. Cancel the reservation in ETD first; "
                 + "changing the decision here would leave a live rental on a denied request.",
        });
      }
      const prevStatus = String((upd as any[])[0]?.prev_status ?? "");
      const transitionedToApproved = decision === "APPROVE" && prevStatus !== "approved";

      // Close the loop. A decision that only lands in a table is invisible to
      // the one person waiting on it, and silence is what drives the call to
      // Fleet that this whole process exists to remove.
      const no = Number(req.params.requestNo);
      const missingText = missing.map((m) => MISSING_REASONS[m]).join(", ");
      const text =
        decision === "RETURN"
          ? `Sears Fleet: we cannot approve rental request #${no} yet because we still need `
            + `${missingText}.${note ? ` ${note}` : ""}\nFinish it here: ${PUBLIC_REQUEST_URL}`
            + `\nYour earlier answers are saved, you only need to add what is missing.`
        : decision === "APPROVE"
          // Resolved above: the approver's reviewed words for a new request,
          // the fixed Enterprise-handled copy for an extension.
          ? approveText
          : decision === "DENY"
          ? `Sears Fleet: your rental ${isExtensionRow ? "extension " : ""}request was not approved.${note ? ` ${note}` : ""}`
            + " Reply to this message if your situation has changed."
          : `Sears Fleet: we are holding your rental request until you have a confirmed shop `
            + `appointment.${note ? ` ${note}` : ""} Start a new request once the shop gives you a date: `
            + PUBLIC_REQUEST_URL;
      // A VOID tells the technician NOTHING by design — the request was the
      // mistake (wrong queue, duplicate), not their situation, and "your
      // request was voided" reads like a denial to the person holding the
      // car. Fleet reaches out manually when there is something to say.
      if (decision !== "VOID" && (decision !== "APPROVE" || transitionedToApproved)) {
        void notifyTech(no, text, `decision-${decision.toLowerCase()}`);
      }

      // A preview quoted before this decision carries the OLD pickup time, and the
      // booking chain commits from the stored preview, never re-deriving from the
      // request row — so without this knock-back a re-approve with a new time would
      // book the old one. Same discipline as the vehicle-class route. Only
      // preview_pending/preview_ready are knocked back; an intent already at
      // confirmed/booking is past the point where a retime can be honored, and
      // yanking it there risks orphaning a real ETD reservation.
      if (transitionedToApproved && pickupAt && cur.pickup_changes && !isExtensionRow) {
        await invalidateRequestPreviews(
          String(no), `pickup time set to ${pickupAt} by ${actor}`);
      }

      // APPROVE books it. The acknowledgement above promises a confirmation number
      // and a branch; this is what actually produces them.
      //
      // NEVER for an extension: the technician already holds the car, and this
      // chain would reserve a second one. Fleet extends with Enterprise
      // manually after approval — the row is settled the moment it flips.
      if (transitionedToApproved && !isExtensionRow) void autoBookApprovedRequest(no);

      // An extension APPROVE emails Enterprise instead. Fire-and-forget like
      // the booking chain: the outcome is recorded on the row and the drawer
      // watches it land through the list poll. Only on the TRANSITION into
      // approved — a replayed APPROVE on an already-approved row must not
      // email Enterprise a duplicate extension request; the dedicated resend
      // route is the deliberate re-send path. The auto flag additionally
      // refuses to repeat a send that already succeeded (e.g. deny→re-approve
      // after the email landed).
      if (transitionedToApproved && isExtensionRow) {
        void sendExtensionEmail(no, actor, { auto: true });
      }

      res.json({ ok: true, decision });
    } catch (e: any) {
      res.status(500).json({ message: e?.message || "decide failed" });
    }
  });

  /**
   * (Re)send the Enterprise extension email for an approved extension —
   * the drawer's quick action when a send failed or the reservation number
   * needed correcting. Optional body fields update the row's reservation
   * number / days before the send, so a typo is fixed and re-sent in one
   * step. Synchronous on purpose: the click waits for the real outcome.
   */
  router.post("/forms/rental-request/:requestNo/extension-email", async (req, res) => {
    try {
      const no = Number(req.params.requestNo);
      const actor = (req as any).user?.username || (req as any).user?.email || "unknown";
      const resNo = String(req.body?.reservationNumber || "").trim().slice(0, 60);
      const daysRaw = Number(req.body?.days);
      const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(30, Math.round(daysRaw))) : null;
      const { rows } = await db.execute(sql`
        UPDATE vrm_rental_request
        SET ext_reservation_number = COALESCE(NULLIF(${resNo}, ''), ext_reservation_number),
            ext_days = COALESCE(${days}::integer, ext_days, 7),
            updated_at = now()
        WHERE request_no = ${no} AND COALESCE(request_type, 'new') = 'extension'
          AND status = 'approved'
        RETURNING ext_reservation_number
      `);
      const row = (rows as any[])[0];
      if (!row) {
        return res.status(409).json({
          message: "Only an APPROVED extension can email Enterprise — approve it first.",
        });
      }
      if (!String(row.ext_reservation_number || "").trim()) {
        return res.status(400).json({
          message: "Enter the Enterprise reservation / RA number first — they file by that number.",
        });
      }
      const out = await sendExtensionEmail(no, actor);
      if (out.state === "sent") return res.json({ ok: true, state: out.state, message: out.message });
      if (out.state === "dry_run") return res.json({ ok: true, state: out.state, message: out.message });
      return res.status(502).json({ message: out.message, state: out.state });
    } catch (e: any) {
      res.status(500).json({ message: e?.message || "extension email failed" });
    }
  });
}

/**
 * APPROVE means booked and notified. Nothing else is asked of a staffer.
 *
 * Runs the whole chain the panel used to make a person click through one button at a
 * time: create the intent, take the preview, confirm it, and hand it to the booking
 * executor, which commits in ETD and releases the technician's text. Deliberately
 * fire-and-forget: the commit costs 20-30s of ETD round trips and the decision button
 * must not hang on it. Every failure is written to the request row so the card can say
 * WHY rather than sitting on 'approved' looking finished.
 */
/**
 * Hand back a claim this inline lane is no longer working.
 *
 * Scoped hard on purpose. Only a claim owned by `nexus-autobook`, and only from a
 * status that has not reached ETD, is released. A box-runner claim or an intent that
 * already holds a reservation is left alone: releasing either is how one approval
 * becomes two cars.
 */
async function releaseInlineAutobookClaim(intentId: number): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE vrm_rental_workflow_intents
         SET claimed_by = NULL, lease_expires_at = NULL, updated_at = now()
       WHERE id = ${intentId}
         AND claimed_by = 'nexus-autobook'
         AND status IN ('created', 'preview_pending', 'preview_ready')
         AND reservation_state NOT IN ('booked_unverified', 'verified', 'unknown')
    `);
  } catch (e: any) {
    // Never let cleanup mask the real outcome of the booking attempt.
    console.error("[rental-request] releasing inline claim failed:", e?.message || e);
  }
}

/**
 * One inline booking chain per request per process. Approve is the sole caller,
 * but transport/click replays can still overlap while the 20-30s quote chain is
 * active. The later caller joins the outcome of the first by not starting.
 */
const autoBookInFlight = new Set<number>();

async function autoBookApprovedRequest(requestNo: number): Promise<void> {
  if (autoBookInFlight.has(requestNo)) {
    console.log(`[rental-request] auto-book #${requestNo} already in flight; not starting a second chain`);
    return;
  }
  autoBookInFlight.add(requestNo);
  try {
    await autoBookApprovedRequestInner(requestNo);
  } finally {
    autoBookInFlight.delete(requestNo);
  }
}

type AutoBookApprovedRequestDeps = {
  findLiveIntent?: typeof liveIntentForRequest;
  createBookingIntent?: typeof createIntent;
};

export async function autoBookApprovedRequestInner(
  requestNo: number,
  deps: AutoBookApprovedRequestDeps = {},
): Promise<void> {
  const findLiveIntent = deps.findLiveIntent ?? liveIntentForRequest;
  const createBookingIntent = deps.createBookingIntent ?? createIntent;
  let inlineIntentId: number | null = null;
  const fail = async (stage: string, detail: string, reopenForReview = false) => {
    const writeFailure = async (executor: any) => executor.execute(sql`
      WITH booking_fence AS (
        SELECT EXISTS (
          SELECT 1
            FROM vrm_rental_workflow_intents i
           WHERE i.workflow_type = ${WORKFLOW_REQUEST}
             AND (i.source_id = ${String(requestNo)}
                  OR i.source_id = (SELECT id::text FROM vrm_rental_request WHERE request_no = ${requestNo}))
             AND (
               i.status NOT IN ('completed', 'cancelled', 'abandoned')
               OR i.reservation_state IN ('unknown', 'booked_unverified', 'verified')
               OR EXISTS (
                 SELECT 1
                   FROM vrm_workflow_attempts a
                  WHERE a.intent_id = i.id
                    AND a.phase = 'etd_booking'
               )
             )
        ) AS present
      )
      UPDATE vrm_rental_request
         SET etd_error = ${`${stage}: ${detail}`.slice(0, 500)},
             -- A failure before createIntent returns is provably before any ETD
             -- operation: there is no intent and therefore no attempt ledger row.
             -- Reopen in the SAME write as the error so staff can safely press
             -- Approve again. Once an intent exists, preserve its fence instead.
             status = CASE
               WHEN ${reopenForReview}::boolean
                AND NOT (SELECT present FROM booking_fence)
                AND status = 'approved'
               THEN 'pending'
               ELSE status
             END,
             claimed_at = CASE
               WHEN ${reopenForReview}::boolean
                AND NOT (SELECT present FROM booking_fence)
                AND status = 'approved'
               THEN NULL
               ELSE claimed_at
             END,
             claimed_by = CASE
               WHEN ${reopenForReview}::boolean
                AND NOT (SELECT present FROM booking_fence)
                AND status = 'approved'
               THEN NULL
               ELSE claimed_by
             END,
             updated_at = now()
       WHERE request_no = ${requestNo}
         AND etd_booked_at IS NULL
         AND status = 'approved'
    `);
    await db.transaction(async (tx) => {
      // Shared with live request-intent creation. The lock must be acquired
      // before reading the intent/attempt fence so the check cannot race a
      // creator that has not committed its row yet.
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(
          hashtext('vrm-request-booking'),
          hashtext(${String(requestNo)})
        )
      `);
      await writeFailure(tx);
    });
  };
  try {
    // Adopt before creating. createIntent refuses a second live intent for the same
    // LDAP (intent_conflict), which is right - two live intents mean two cars - but
    // it also made Approve a ONE-SHOT: a request whose first pass died left an intent
    // behind that the button could then never touch again, so the row sat approved
    // and carless with nothing able to move it. Resume the intent that is there.
    const existing = await findLiveIntent(requestNo);
    if (existing) {
      inlineIntentId = Number(existing.id);
      // Anything that already reached ETD is never re-driven. A second pass over a
      // booked intent is how one click becomes two reservations.
      if (existing.reservation_state === "booked_unverified" || existing.reservation_state === "verified") {
        // It already has a car. The only work left is recognising that, which for
        // this lane means verifying on the commit response.
        if (!(await verifyRequestOnCommitEvidence(existing.id))) {
          await fail("booking", `intent #${existing.id} already holds a reservation (${existing.reservation_state}); no second booking attempted`);
        }
        return;
      }
      if (!RESUMABLE_INTENT_STATUSES.has(String(existing.status))) {
        await fail("auto-book", `intent #${existing.id} is at ${existing.status}; resolve it in the workflow panel before re-approving`);
        return;
      }
    }

    // This attempt is now ACCEPTED (any existing intent is resumable, or a new one
    // will be created). Clear the previous failure so the card reads "booking in
    // progress" during the retry instead of still shouting the old reason — and so
    // the page's fast outcome polling re-arms. A failure below re-writes it.
    await db.execute(sql`
      UPDATE vrm_rental_request SET etd_error = NULL, updated_at = now()
       WHERE request_no = ${requestNo} AND etd_booked_at IS NULL AND etd_error IS NOT NULL
    `);

    let cur =
      existing ??
      (
        await createBookingIntent({
          workflowType: WORKFLOW_REQUEST,
          sourceId: String(requestNo),
          executionMode: "live",
          createdBy: "auto-approve",
        })
      ).intent;

    // requestPreview only QUEUES a preview: it writes preview_pending and returns
    // the intent. BUILDING it (quote, eligibility, assembly) is the executor's
    // preview lane. The old chain called requestPreview and then tested the result
    // for preview_ready, so it always failed on the state it had itself just
    // written, returned before confirming anything, and left every approved request
    // parked at "Quoting..." forever - clean intent, no claim, no error, nothing to
    // read. Each stage below drives its lane and then re-reads what it produced.
    inlineIntentId = Number(cur.id);
    if (cur.status === "created" || cur.status === "preview_required") {
      await requestPreview(cur.id);
      cur = (await readIntentRow(cur.id)) ?? cur;
    }
    if (cur.status === "preview_pending") {
      await runBookingExecutor({ runnerId: "nexus-autobook", intentId: cur.id, limit: 1 });
      cur = (await readIntentRow(cur.id)) ?? cur;
    }
    if (cur.status === "preview_ready") {
      await confirmIntent({
        intentId: cur.id,
        previewVersion: Number(cur.preview_version),
        confirmedBy: "auto-approve",
      });
      cur = (await readIntentRow(cur.id)) ?? cur;
    }
    if (cur.status !== "confirmed") {
      await fail("preview", String(cur.last_error ?? cur.status));
      return;
    }

    const run = await runBookingExecutor({
      runnerId: "nexus-autobook",
      intentId: cur.id,
      limit: 1,
    });
    const r = run.results?.[0];
    if (r && r.action !== "BOOK") {
      await fail("booking", `${r.status}${r.detail ? `: ${r.detail}` : ""}`);
    }
  } catch (err: any) {
    // OrchestratorError carries the gate verdict in `extra.failures`. Recording only
    // err.message left the card reading "eligibility gate failed" with no way to learn
    // WHICH gate, which is the only question a staffer actually has.
    const codes = Array.isArray(err?.extra?.failures)
      ? err.extra.failures
          .map((f: any) => (f?.detail ? `${f.code}: ${f.detail}` : String(f?.code ?? "?")))
          .join("; ")
      : "";
    await fail(
      "auto-book",
      codes ? `${err?.message ?? "failed"} (${codes})` : String(err?.message ?? err),
      inlineIntentId == null
        && err instanceof OrchestratorError
        && ["live_disarmed", "eligibility_failed", "source_missing"].includes(err.code),
    );
  } finally {
    // The inline lane is done either way. Holding a 30 minute lease past the end of
    // this function is what parked six requests on 2026-08-20 with a built preview,
    // no error, and nothing able to move them.
    if (inlineIntentId != null) await releaseInlineAutobookClaim(inlineIntentId);
  }
}

/**
 * The stages autoBookApprovedRequest is allowed to pick an existing intent up from.
 * Everything outside this set has either reached ETD or been parked for a human, and
 * a re-approve must not touch it.
 */
const RESUMABLE_INTENT_STATUSES: ReadonlySet<string> = new Set([
  "created",
  "preview_pending",
  "preview_ready",
  "preview_required",
  "confirmed",
]);

/**
 * The live, unfinished intent already bound to this request, if there is one.
 * Newest first: a cancelled predecessor is terminal and correctly invisible here.
 */
async function liveIntentForRequest(requestNo: number): Promise<any | null> {
  const { rows } = await db.execute(sql`
    SELECT * FROM vrm_rental_workflow_intents
    WHERE workflow_type = ${WORKFLOW_REQUEST}
      AND (
        source_id = ${String(requestNo)}
        OR source_id = (
          SELECT id::text FROM vrm_rental_request WHERE request_no = ${requestNo}
        )
      )
      AND execution_mode = 'live'
      AND status NOT IN ('completed', 'cancelled', 'abandoned')
    ORDER BY id DESC
    LIMIT 1
  `);
  return (rows as any[])[0] ?? null;
}

/**
 * The intent row as it stands NOW. autoBookApprovedRequest hands the intent to the
 * executor and then has to read back what the executor wrote; the in-memory copy it
 * started with is a snapshot from before the quote ran.
 */
function strTrim(v: unknown): string {
  return String(v ?? "").trim();
}

async function readIntentRow(intentId: number): Promise<any | null> {
  const { rows } = await db.execute(sql`
    SELECT * FROM vrm_rental_workflow_intents WHERE id = ${intentId} LIMIT 1
  `);
  return (rows as any[])[0] ?? null;
}


/**
 * The durable acknowledgement record written onto EVERY request, new or
 * extension: who signed (name + LDAP), when, and the exact bullet texts as
 * worded at that moment. Built server-side from ACK_TEXTS — the client never
 * supplies wording — and only from the bullets that were actually shown and
 * attested, so the record never claims assent to a statement nobody saw.
 */
function buildAckSnapshot(opts: {
  signerName: string | null;
  signerLdap: string;
  requestType: string;
  ackKeys: string[];
}): any {
  return {
    policyVersion: POLICY_VERSION,
    signerName: opts.signerName,
    signerLdap: opts.signerLdap,
    requestType: opts.requestType,
    signedAt: new Date().toISOString(),
    bullets: opts.ackKeys
      .filter((k) => ACK_TEXTS[k])
      .map((k) => ({ key: k, text: ACK_TEXTS[k] })),
  };
}

/**
 * The type-aware in-flight guard, shared by verify and submit on the open door.
 *
 * The old rule — any live row blocks any new request — broke the moment
 * extensions existed: the BOOKED new request IS the rental the technician now
 * wants more time on, so it must never block the extension asking for it.
 *
 * Semantics (Fleet's rule, 2026-08):
 *   - NEW is blocked by any live row: a live new (pending/approved/booked) or
 *     a pending extension. You cannot ask for a second vehicle.
 *   - EXTENSION is blocked by a pending extension (no duplicates) and by a
 *     live new still in pending/approved — there is nothing to extend yet.
 *     A booked new does NOT block it.
 *   - An APPROVED extension is settled: Fleet extends with Enterprise
 *     manually and the row never books, so it must not block next week's
 *     extension request. Extensions only count as live while 'pending'.
 *
 * SETTLED BOOKED ROWS (2026-08-26). `booked` used to be the end of the request
 * lifecycle: nothing ever moved a row off it when the vehicle went back, so a
 * technician who returned a rental stayed locked out of the front door until
 * the 30-day window above aged their row out. Measured the day this was added,
 * 113 of 143 new requests sat at `booked` and 18 technicians with ZERO open
 * rentals could not file. The visible symptom was a form reading "Our records
 * do not show a current rental for you" directly above a DISABLED New option,
 * because that sentence reads the rental book while the button read this table.
 *
 * A booked row is SETTLED, and blocks nothing, only on POSITIVE evidence of
 * return: no open rental case AND one of the technician's cases dropped out of
 * the Enterprise book AFTER this request was created. Absence alone is never
 * enough. The Open RA report is a morning snapshot that lags a booking by up to
 * a day, so "not on the book" by itself would hand a second vehicle to someone
 * who collected one an hour ago. A technician with no case at all keeps
 * blocking and needs a human Close on the Fleet review screen.
 */
export async function liveRequestGuard(ldap: string): Promise<{
  liveNew: any | null;
  liveExt: any | null;
  blockNew: { requestNo: number; status: string } | null;
  blockExtension: { requestNo: number; status: string } | null;
  settled: Array<{ requestNo: number; status: string; droppedAt: string | null }>;
}> {
  const { rows } = await db.execute(sql`
    WITH book AS (
      SELECT
        count(*) FILTER (
          WHERE c.present_in_latest AND upper(c.ticket_status) = 'OPEN'
        )::int                      AS open_n,
        max(c.dropped_from_feed_at) AS last_drop
      FROM all_techs a
      JOIN vrm_rental_identity_resolutions ir
        ON COALESCE(ir.override_employee_id, ir.resolved_employee_id) = a.employee_id
      JOIN vrm_rental_operations_cases c
        ON c.case_key = ir.case_key
      WHERE upper(btrim(a.tech_racfid)) = upper(btrim(${ldap}))
        AND upper(btrim(COALESCE(a.employment_status, ''))) = 'A'
        AND a.dropped_from_source_at IS NULL
    )
    SELECT r.request_no,
           r.status,
           COALESCE(r.request_type, 'new') AS request_type,
           -- ::int everywhere, never a raw boolean. The pool driver mis-reads
           -- booleans if poolQueryViaFetch is ever switched on, and these
           -- values decide whether a technician may file at all. See
           -- .agents/memory/neon-http-driver-boolean-pitfall.md.
           COALESCE(b.open_n, 0)::int AS open_n,
           (CASE WHEN b.last_drop IS NOT NULL AND b.last_drop > r.created_at
                 THEN 1 ELSE 0 END)::int AS dropped_after_create,
           to_char(b.last_drop AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS dropped_at
    FROM vrm_rental_request r
    CROSS JOIN book b
    WHERE r.ldap = ${ldap} AND r.status IN ('pending','approved','booked')
      AND r.created_at > now() - interval '30 days'
    ORDER BY r.created_at DESC
  `);
  const all = rows as any[];
  // book-level, identical on every row (CROSS JOIN of a bare aggregate)
  const openRentals = all.length ? Number(all[0].open_n ?? 0) : 0;

  // A booked NEW row is SETTLED once the vehicle is demonstrably back: no open
  // rental case, AND a case dropped off the Enterprise book AFTER this request
  // was created. A settled row is a finished rental, not an in-flight request,
  // so it blocks nothing.
  const isSettled = (r: any) =>
    r.status === "booked" &&
    r.request_type !== "extension" &&
    openRentals === 0 &&
    Number(r.dropped_after_create ?? 0) === 1;

  const liveNew = all.find((r) => r.request_type !== "extension" && !isSettled(r)) ?? null;
  const liveExt = all.find((r) => r.request_type === "extension" && r.status === "pending") ?? null;
  const asRef = (r: any) => (r ? { requestNo: r.request_no, status: r.status } : null);
  const newInProgress = all.find(
    (r) => r.request_type !== "extension" && (r.status === "pending" || r.status === "approved"),
  ) ?? null;

  const settledRows = all.filter(isSettled);

  // A pending extension bars a NEW request as a rule — Fleet's "one car
  // conversation at a time" (tests/rental-extension-booking-doors.test.ts G2).
  // The ONE exception is a settled booked row sitting beside it, which is
  // positive proof the rental that extension was about is already back.
  // Without the exception the settled-row fix above is dead on arrival: a
  // technician shut out of the New option files the extension the form still
  // offers, and that extension becomes the new lock the moment the booking
  // settles. Real case 2026-08-26 — #53 settled and #155, filed in its place
  // the same morning, took over. A technician with no settled row keeps
  // blocking exactly as before.
  const extBlocksNew = settledRows.length > 0 ? null : liveExt;

  return {
    liveNew,
    liveExt,
    blockNew: asRef(liveNew ?? extBlocksNew),
    blockExtension: asRef(liveExt ?? newInProgress),
    settled: settledRows.map((r) => ({
      requestNo: r.request_no,
      status: r.status,
      droppedAt: r.dropped_at ?? null,
    })),
  };
}

/**
 * Retire the request rows whose rental is demonstrably back.
 *
 * The read-side guard stops a settled row BLOCKING, but the row itself still
 * sits at `booked`, and `vrm_rental_request_open_live_uniq` — UNIQUE (ldap)
 * WHERE token_id IS NULL AND request_type='new' AND status IN
 * ('pending','approved','booked') — is a database constraint that does not
 * care what the guard decided. Without this step the technician sails past
 * the door and the INSERT dies on a duplicate key instead. There is no manual
 * escape either: /decide refuses any row already at 'booked', so no amount of
 * clicking in the Fleet UI frees the index.
 *
 * `closed` is deliberately a NEW status, not the existing `returned`, which on
 * this table already means "Fleet sent it back to the technician for more
 * detail". Reusing it would make those two states indistinguishable in every
 * report. `closed` is outside the index predicate, so retiring the row frees
 * the LDAP for the next request.
 *
 * Called on the open door before the guard, so a technician who returns a
 * vehicle and walks straight back to the form is cleared in that same request
 * rather than waiting for a sweep. The evidence is re-tested inside the UPDATE
 * itself, so two tabs racing cannot close a row whose rental is still out.
 * Never throws: a failure here degrades to the old blocked-door behaviour.
 */
export async function closeSettledRequests(ldap: string): Promise<number[]> {
  try {
    const { rows } = await db.execute(sql`
      WITH book AS (
        SELECT
          count(*) FILTER (
            WHERE c.present_in_latest AND upper(c.ticket_status) = 'OPEN'
          )::int                      AS open_n,
          max(c.dropped_from_feed_at) AS last_drop
        FROM all_techs a
        JOIN vrm_rental_identity_resolutions ir
          ON COALESCE(ir.override_employee_id, ir.resolved_employee_id) = a.employee_id
        JOIN vrm_rental_operations_cases c
          ON c.case_key = ir.case_key
        WHERE upper(btrim(a.tech_racfid)) = upper(btrim(${ldap}))
          AND upper(btrim(COALESCE(a.employment_status, ''))) = 'A'
          AND a.dropped_from_source_at IS NULL
      )
      UPDATE vrm_rental_request r
         SET status = 'closed',
             decision_note = COALESCE(NULLIF(btrim(r.decision_note), '') || ' | ', '')
               || 'auto-closed: vehicle back, off the Enterprise book '
               || to_char(b.last_drop AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
             updated_at = now()
        FROM book b
       WHERE r.ldap = ${ldap}
         AND r.status = 'booked'
         AND COALESCE(r.request_type, 'new') <> 'extension'
         AND COALESCE(b.open_n, 0) = 0
         AND b.last_drop IS NOT NULL
         AND b.last_drop > r.created_at
      RETURNING r.request_no
    `);
    const closed = (rows as any[]).map((r) => Number(r.request_no));
    if (closed.length) {
      console.log(`[rental-request] auto-closed returned rental request(s) for ${ldap}: #${closed.join(", #")}`);
    }
    return closed;
  } catch (e: any) {
    console.error(`[rental-request] closeSettledRequests(${ldap}) failed:`, e?.message || e);
    return [];
  }
}

/**
 * Compose and send the extension email for an approved extension request,
 * recording the outcome on the row. Returns what it recorded so the resend
 * route can answer synchronously. Never throws.
 */
async function sendExtensionEmail(
  requestNo: number, actor: string, opts?: { auto?: boolean },
): Promise<{
  state: "sent" | "failed" | "dry_run" | "skipped"; message: string;
}> {
  const record = async (state: string, error: string | null) => {
    await db.execute(sql`
      UPDATE vrm_rental_request
      SET ext_email_state = ${state},
          ext_email_to = ${EXTENSION_SUPPORT_EMAIL},
          ext_email_error = ${error},
          ext_email_sent_at = ${state === "sent" ? sql`now()` : sql`ext_email_sent_at`},
          updated_at = now()
      WHERE request_no = ${requestNo}
    `);
  };
  try {
    const { rows } = await db.execute(sql`
      SELECT tech_name, ldap, request_type, status,
             ext_reservation_number, COALESCE(ext_days, 7) AS ext_days,
             ext_email_state, current_rental
      FROM vrm_rental_request WHERE request_no = ${requestNo}
    `);
    const r = (rows as any[])[0];
    if (!r || String(r.request_type) !== "extension" || r.status !== "approved") {
      return { state: "skipped", message: "not an approved extension" };
    }
    // The automatic (decision-triggered) path never repeats a send that
    // already landed — Enterprise filing the same extension twice is the
    // exact duplicate this guards. A human clicking the resend button is
    // deliberate and stays allowed.
    if (opts?.auto && String(r.ext_email_state || "") === "sent") {
      return { state: "skipped", message: "extension email already sent — use Resend to send again" };
    }
    // Header-injection guard: resNo and renter reach the email SUBJECT
    // header and are staff/DB input — a CR/LF inside would append headers.
    const clean = (s: string) => s.replace(/[\r\n]+/g, " ").trim();
    const resNo = clean(String(r.ext_reservation_number || ""));
    if (!resNo) {
      // The decide route refuses an extension approve without a reservation
      // number, so this only fires for legacy rows approved pre-email.
      await record("failed", "no reservation / RA number on the request");
      return { state: "failed", message: "no reservation / RA number on the request" };
    }
    const days = Math.max(1, Math.min(30, Number(r.ext_days) || 7));
    const renter = clean(String(r.tech_name || r.ldap || ""));
    const vendor = clean(String(r.current_rental?.rental_vendor || ""));
    const subject = `Rental extension request — Res/RA #${resNo} — ${renter}`;
    // Per their contact tips: renter's name + reservation/RA number, no other
    // personal information.
    const text =
      `Hello,\n\n`
      + `Please extend the following open rental on the Sears Home Services account:\n\n`
      + `  Renter name:          ${renter}\n`
      + `  Reservation / RA #:   ${resNo}\n`
      + `  Additional days:      ${days}\n`
      + (vendor ? `  Rental company:       ${vendor}\n` : "")
      // Never "reply to this email" — the from-address is a send-only
      // notifications box and a reply there is a dead letter. Questions go
      // to the two people always CC'd above (Tyler Morgan / Rob Anderson —
      // Rob's corporate address is under Howard).
      + `\nApproved by Sears Fleet (${actor}). For any questions, please email Tyler Morgan `
      + `(tyler.morgan@transformco.com) or Rob Anderson (howard.anderson@transformco.com).\n\n`
      + `Thank you,\nSears Fleet Management`;

    if (!extensionEmailLive()) {
      console.log(`[rental-request] extension email #${requestNo}: DRY RUN (live sends off) — would email ${EXTENSION_SUPPORT_EMAIL} (cc ${EXTENSION_SUPPORT_CC.join(", ")}): ${subject}`);
      await record("dry_run", null);
      return {
        state: "dry_run",
        message: "Email prepared but NOT sent — live email sends are off in this environment.",
      };
    }
    const out = await sendEmail({
      to: EXTENSION_SUPPORT_EMAIL,
      cc: EXTENSION_SUPPORT_CC,
      from: process.env.SENDGRID_EMAIL || "",
      subject, text,
    });
    if (out.success) {
      console.log(`[rental-request] extension email #${requestNo}: sent to ${EXTENSION_SUPPORT_EMAIL} (cc ${EXTENSION_SUPPORT_CC.join(", ")}, res ${resNo}, ${days} days)`);
      await record("sent", null);
      return { state: "sent", message: `Emailed ${EXTENSION_SUPPORT_EMAIL}.` };
    }
    const err = out.error || "send failed";
    console.error(`[rental-request] extension email #${requestNo}: FAILED: ${err}`);
    await record("failed", err.slice(0, 500));
    return { state: "failed", message: err };
  } catch (e: any) {
    const err = String(e?.message || e).slice(0, 500);
    console.error(`[rental-request] extension email #${requestNo}: threw:`, err);
    try { await record("failed", err); } catch { /* recorded best-effort */ }
    return { state: "failed", message: err };
  }
}

const extensionEmailLive = (): boolean =>
  process.env.RENTAL_EXTENSION_EMAIL_LIVE === "true" ||
  (!!process.env.REPLIT_DEPLOYMENT && process.env.RENTAL_EXTENSION_EMAIL_LIVE !== "false");
