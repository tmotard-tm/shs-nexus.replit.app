/**
 * Rental Request — eligibility engine and routes.
 *
 * Spec: Fleet/ETD/REQUEST_FORM.md. This is the front door that replaces the
 * technician's call to Holman.
 *
 * THE DEFAULT ANSWER IS NO. A rental is what remains when nothing else resolves
 * the problem. Rules are evaluated cheapest-disqualifier-first so most requests
 * end on question one, and the denials are the number worth reporting: nobody
 * can say today what Holman talked people out of, because Holman never told us.
 *
 * The rules key on FACTS, never on the technician's assessment. Within two weeks
 * of launch every van will be undrivable and every repair three days long, so
 * the inputs that decide are the roster, the existing rental book, and the
 * shop's own ETA. The technician's account is captured and audited, not trusted.
 * Same lesson as vehicle class: a technician saying "I'm in a sedan" was never
 * evidence; only the model table decided.
 */
import type { Express, Router } from "express";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import crypto from "crypto";
import { regionForState, REGION_OWNER } from "../rental-operations/region";

// Bumped 2026-08-14: weekly extension acknowledgement added. Never reuse a
// version across a wording change — the stored version is what proves which
// text a technician actually agreed to.
export const POLICY_VERSION = "2026-08-14.a";

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
  shop_estimate: "how many days the shop said it needs",
  shop_appointment: "a confirmed shop appointment date and drop-off time",
  shop_details: "the shop name, address and phone number",
  symptom_detail: "a clear description of what the vehicle is doing",
  what_was_tried: "what has already been tried to get it running",
  repair_order: "the shop's repair order or work order number",
  contact: "a phone number we can reach you on",
  nearest_branch: "the closest Enterprise Rent-A-Car branch to the shop (Google it if unsure)",
  other: "more information",
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
  ldap: string;
  isByov: boolean;
  employmentStatus: string | null;
  openRentalCount: number;
  problemCategory: string;
  /** null = the BYOV mirror is missing or stale, so we genuinely do not know. */
  isByovKnown?: boolean;
  isDrivable: boolean | null;
  isSafeToDrive: boolean | null;
  hasAppointment: boolean | null;
  shopEstimatedDays: number | null;
  hvacCarveOut?: boolean;
}

/**
 * The eight rules, in the spec's order. Returns the FIRST disqualifier, so the
 * reason a technician sees is the cheapest true one rather than a list.
 */
export function evaluate(f: RequestFacts): Eligibility {
  // 1 — maintenance is never a rental.
  if (MAINTENANCE.has(f.problemCategory)) {
    return {
      decision: "DENY",
      rule: 1,
      reason: "scheduled maintenance",
      script:
        "Rentals are not provided for oil changes, tires, preventive maintenance " +
        "or inspections. Schedule this as a wait through routing.",
    };
  }

  // 2 — if it drives and it is safe, drive it.
  if (f.isDrivable === true && f.isSafeToDrive === true) {
    return {
      decision: "DENY",
      rule: 2,
      reason: "vehicle is drivable and safe",
      script:
        "Your van is drivable and safe, so drive it to the shop or keep running " +
        "your route until the parts arrive.",
    };
  }

  // 6 — roster check runs before anything that costs money to verify.
  //     Deliberately out of numeric order: it is cheap and absolute.
  if ((f.employmentStatus ?? "").toUpperCase() !== "A") {
    return {
      decision: "REVIEW",
      rule: 6,
      reason: `technician is not ACTIVE on the roster (status ${f.employmentStatus ?? "unknown"})`,
      script: "We need to confirm your roster status before we can set up a rental. Fleet will contact you.",
    };
  }

  // 7 — never stack rentals on one technician.
  if (f.openRentalCount > 0) {
    return {
      decision: "REVIEW",
      rule: 7,
      reason: `technician already holds ${f.openRentalCount} open rental(s)`,
      script:
        "Our records show you already have an open rental. Fleet will contact you " +
        "rather than issuing a second one.",
    };
  }

  // 5 — BYOV runs BEFORE the shop questions, and that ordering is load-bearing.
  //
  // A BYOV technician has no company van going to a shop, so the form never
  // asks them for an appointment. Evaluating rule 3 first therefore returned
  // "book the appointment first, then come back and finish this request" to a
  // form that will never show that question — an instruction they cannot
  // follow, on a link a DEFER deliberately leaves live. Every BYOV technician
  // looped there forever. The shop questions cannot gate someone the shop
  // questions were never asked of.
  //
  // Spare-unit availability (the other half of rule 5) is still not automatable
  // here: the spares feed is not wired into this path and guessing "no spare"
  // would quietly approve rentals the pool could have covered.
  if (f.isByovKnown === false) {
    // Never assume "not BYOV". Nexus's own byov_enrollments table was four
    // months stale and would have said exactly that for 113+ enrolled
    // technicians.
    return {
      decision: "REVIEW",
      rule: 5,
      reason: "BYOV status unknown — mirror missing or stale; refusing to assume",
      script: "We need to check your vehicle programme before approving this. Fleet will contact you.",
    };
  }
  if (f.isByov) {
    return {
      decision: "REVIEW",
      rule: 5,
      reason: "BYOV technician — no company vehicle, policy not defined",
      script:
        "You are enrolled in BYOV, so this needs a person to look at it. Fleet " +
        "will contact you.",
    };
  }

  // 3 — the rental starts when the truck goes in, not when the problem appears.
  if (f.hasAppointment !== true) {
    return {
      decision: "DEFER",
      rule: 3,
      reason: "no confirmed shop appointment",
      script:
        "A rental starts when your van actually goes into the shop. Book the " +
        "appointment first, then come back and finish this request.",
    };
  }

  // 4 — a same-day job is a wait, not a rental.
  //
  // Absent is NOT the same as zero. Denying a missing estimate with "the shop
  // expects this back the same day" puts words in the shop's mouth and refuses
  // a technician on a fact nobody established.
  if (f.shopEstimatedDays == null) {
    return {
      decision: "DEFER",
      rule: 4,
      reason: "no shop estimate supplied; cannot set a return date",
      script:
        "We need the shop's estimate of how many days it will take. Ask them, " +
        "then finish this request.",
    };
  }
  const days = Number(f.shopEstimatedDays);
  if (!Number.isFinite(days) || days <= 0) {
    return {
      decision: "DENY",
      rule: 4,
      reason: "shop ETA is same-day or wait-on-it",
      script: "The shop expects this back the same day, so plan to wait on it.",
    };
  }

  // 8 — what remains.
  return {
    decision: "APPROVE",
    rule: 8,
    reason: "no disqualifier; spare availability still to be confirmed by Fleet",
    vehicleClass: f.hvacCarveOut ? "cargo_van" : "sedan",
  };
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
async function factsFor(ldap: string) {
  const { rows } = await db.execute(sql`
    SELECT a.employment_status,
           a.district_no,
           a.home_state,
           upper(a.tech_racfid) AS ldap,
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
             WHERE v.ldap = upper(a.tech_racfid)
               AND upper(coalesce(v.status,'')) = 'ENROLLED') AS byov_count,
           (SELECT max(synced_at) FROM vrm_byov_status)        AS byov_synced_at,
           (SELECT count(*) FROM vrm_byov_status v2
             WHERE v2.ldap = upper(a.tech_racfid))              AS byov_row_present,
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
      WHERE upper(tpp.enterprise_id) = upper(a.tech_racfid)
      ORDER BY (NULLIF(regexp_replace(COALESCE(tpp.mobile_phone,''), '[^0-9]', '', 'g'), '') IS NULL),
               NULLIF(regexp_replace(COALESCE(tpp.mobile_phone,''), '[^0-9]', '', 'g'), '')
      LIMIT 1
    ) tp ON true
    WHERE upper(a.tech_racfid) = upper(${ldap})
    LIMIT 1
  `);
  return (rows as any[])[0] ?? null;
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
  regionOwner?: string | null;
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
    + (r.shopName ? `Shop: ${r.shopName}${r.appointmentAt ? ` on ${String(r.appointmentAt).slice(0, 10)}` : ""}\n` : "")
    + (r.regionOwner ? `Region: ${r.regionOwner}\n` : "")
    + `Queue: ${(process.env.PUBLIC_BASE_URL || "https://SHS-Nexus.replit.app").replace(/\/+$/, "")}`
    + `/vehicle-rental-management/rental-requests`;
  await sendSms(to.map((phone) => ({ phone, body })), `alert #${r.requestNo}`);
}

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
async function screenAndRecord(ctx: SubmitContext): Promise<{ code: number; json: any }> {
  const { ldap, body: b, tokenRow } = ctx;
  const s = (v: any, max = 300) => String(v ?? "").trim().slice(0, max) || null;
  const bool = (v: any) => (v === true || v === "yes" ? true : v === false || v === "no" ? false : null);
  const num = (v: any) => (v === "" || v == null || Number.isNaN(Number(v)) ? null : Number(v));

  const category = s(b.problemCategory, 40) ?? "";
  if (!PROBLEM_CATEGORIES.has(category)) {
    return { code: 400, json: { success: false, message: "Please choose what is wrong with the vehicle." } };
  }

  // Refresh before reading, not after failing. Rule 5 is about to make a
  // decision out of this mirror.
  await ensureByovFresh();

  const facts = await factsFor(ldap);
  const isByov = Number(facts?.byov_count ?? 0) > 0;
  // A mirror older than a day cannot be trusted to say someone is NOT byov.
  const syncedAt = facts?.byov_synced_at ? new Date(facts.byov_synced_at).getTime() : 0;
  const mirrorFresh = syncedAt > 0 && Date.now() - syncedAt < 36 * 3600 * 1000;
  // A fresh mirror that simply has no row for this person does NOT mean
  // "not BYOV". The roster endpoint joins to the active roster, so a new
  // hire can be enrolled and still absent. Global freshness alone would
  // re-create exactly the false negative the stale table caused.
  const byovFresh = mirrorFresh && Number(facts?.byov_row_present ?? 0) > 0;

  const verdict = evaluate({
    ldap,
    isByov,
    isByovKnown: byovFresh,
    employmentStatus: facts?.employment_status ?? null,
    openRentalCount: Number(facts?.open_rentals ?? 0),
    problemCategory: category,
    isDrivable: bool(b.isDrivable),
    isSafeToDrive: bool(b.isSafeToDrive),
    hasAppointment: bool(b.hasAppointment),
    shopEstimatedDays: num(b.shopEstimatedDays),
    hvacCarveOut: b.hvacCarveOut === true,
  });

  // Maintenance ends the form immediately, so the acknowledgements are not
  // required on a path the technician never reached. Neither is the shop
  // appointment acknowledgement on a path that never asked for a shop: a
  // BYOV technician was previously made to attest to an appointment the form
  // deliberately hid from them, which is a false attestation in an audit
  // trail whose entire purpose is being true.
  const acksRequired = true;
  const appointmentAsked = bool(b.hasAppointment) === true;
  // No van, no van attestations. Requiring "my vehicle cannot be driven
  // safely" from someone whose category is "no work van assigned to me yet"
  // is demanding a false statement as the price of entry.
  const noVehicle = category === "new_hire_awaiting_vehicle" || b.noVehicle === true;
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
  if (acksRequired) {
    const required = Object.entries(acks)
      .filter(([k]) => appointmentAsked || k !== "ack_has_appointment")
      .filter(([k]) => !noVehicle || k !== "ack_cannot_drive_safely");
    if (!required.every(([, v]) => v)) {
      return { code: 400, json: { success: false, message: "Please tick every acknowledgement before submitting." } };
    }
  }

  // ONE PATH: every request lands pending and waits for a person.
  //
  // Tyler, 2026-08-13: "Simple for now. Request form, manual approval, approval
  // creates the reservation." So the eight rules no longer decide anything. The
  // engine still runs and its verdict is still recorded on the row, because when
  // the rules are reworked the useful input is what the engine WOULD have said
  // against what Tyler actually decided. It is data, not a gate. `status` is a
  // constant here on purpose: there is no expression that can route a request
  // anywhere except to a human.
  const status = "pending";

  const homeState = ctx.identity.homeState ?? (facts?.home_state ?? null);
  const shopState = s(b.shopState, 2);
  const regionOwner = regionOwnerFor(homeState, shopState);

  // One row per technician per attempt. A technician who was deferred and has
  // now come back supersedes their own earlier deferral rather than adding a
  // duplicate. Keyed on the token where there is one, and on the LDAP on the
  // open door, where there is not.
  if (tokenRow) {
    await db.execute(sql`
      DELETE FROM vrm_rental_request WHERE token_id = ${tokenRow.id} AND status = 'deferred'
    `);
  } else {
    await db.execute(sql`
      DELETE FROM vrm_rental_request
      WHERE ldap = ${ldap} AND token_id IS NULL AND status IN ('deferred','returned')
    `);
  }

  const { rows: ins } = await db.execute(sql`
    INSERT INTO vrm_rental_request (
      token_id, ldap, tech_name, truck_number, district, home_state, mobile_phone,
      identity_corrected, identity_correction, is_byov,
      problem_category, symptom, is_drivable, is_safe_to_drive, occurred_at,
      jobs_affected, what_was_tried,
      shop_name, shop_address, shop_city, shop_state, shop_postal, shop_phone,
      tech_reported_branch,
      has_appointment, appointment_at, shop_estimated_days,
      policy_version, policy_acknowledged_at, policy_ip,
      ack_not_maintenance, ack_cannot_drive_safely, ack_has_appointment,
      ack_return_one_day, ack_accurate,
      ack_working_hours_only, ack_return_before_time_off, ack_extension_weekly, ack_discipline,
      approved_vehicle_class, reason_code, region_owner,
      status, auto_decision, auto_reason, auto_rule, source
    ) VALUES (
      ${tokenRow?.id ?? null}, ${ldap}, ${ctx.identity.techName},
      ${s(b.truckNumber, 30) || ctx.identity.truckNumber},
      ${s(b.district, 20) || ctx.identity.district},
      ${s(b.homeState, 2) || homeState},
      ${s(b.mobilePhone, 30) || ctx.identity.mobilePhone},
      ${b.identityCorrected === true}, ${s(b.identityCorrection, 400)}, ${isByov},
      ${category}, ${s(b.symptom, 1000)}, ${bool(b.isDrivable)}, ${bool(b.isSafeToDrive)},
      ${s(b.occurredAt, 40)}::timestamptz, ${num(b.jobsAffected)}, ${s(b.whatWasTried, 1000)},
      ${s(b.shopName, 200)}, ${s(b.shopAddress, 300)}, ${s(b.shopCity, 80)},
      ${shopState}, ${s(b.shopPostal, 12)}, ${s(b.shopPhone, 30)},
      ${s(b.nearestBranch, 200)},
      ${bool(b.hasAppointment)}, ${s(b.appointmentAt, 40)}::timestamptz, ${num(b.shopEstimatedDays)},
      ${POLICY_VERSION}, ${acksRequired ? sql`now()` : null}, ${ctx.ip || null},
      ${acks.ack_not_maintenance}, ${acks.ack_cannot_drive_safely}, ${acks.ack_has_appointment},
      ${acks.ack_return_one_day}, ${acks.ack_accurate},
      ${acks.ack_working_hours_only}, ${acks.ack_return_before_time_off}, ${acks.ack_extension_weekly}, ${acks.ack_discipline},
      ${verdict.vehicleClass ?? null}, ${verdict.reason}, ${regionOwner},
      ${status}, ${verdict.decision}, ${verdict.reason}, ${verdict.rule}, ${ctx.source}
    )
    RETURNING request_no
  `);
  const requestNo = (ins as any[])[0]?.request_no ?? null;

  // A DEFER tells the technician to go book an appointment and come back.
  // Consuming the token here would make that instruction impossible to
  // follow, so the link stays live and the next submit supersedes this row.
  if (tokenRow && verdict.decision !== "DEFER") {
    await db.execute(sql`UPDATE vrm_form_tokens SET submitted_at = now() WHERE id = ${tokenRow.id}`);
  }

  // Fire and forget. A comms outage must never fail a submission.
  void alertFleet({
    requestNo, ldap, techName: ctx.identity.techName, truck: ctx.identity.truckNumber,
    decision: verdict.decision, rule: verdict.rule, reason: verdict.reason, category,
    homeState, shopName: s(b.shopName, 200), appointmentAt: s(b.appointmentAt, 40),
    regionOwner,
  });

  // Never hand back the engine's verdict. It decided nothing, and showing a
  // technician "approved" before a person has looked would be a promise in
  // Fleet's name that nothing keeps — the exact failure the survey escalation
  // was reverted for on 2026-08-13.
  return {
    code: 200,
    json: {
      success: true,
      requestNo,
      decision: "PENDING",
      message: "Fleet has your request and will review it. "
             + "You will get a text as soon as it is decided.",
    },
  };
}

export function registerRentalRequestPublicRoutes(app: Express): void {
  // -------------------------------------------------------------------------
  // The open front door. Registered BEFORE the tokenised routes so that
  // "/open/..." can never be captured as a :token value.
  // -------------------------------------------------------------------------

  app.get("/api/public/rental-request/open/start", async (_req, res) => {
    res.json({ valid: true, open: true, policyVersion: POLICY_VERSION });
  });

  /**
   * Prove who you are against the roster.
   *
   * This is the check the tokenised path ran too; the token was never what
   * established identity, it only decided who had been handed a link. LDAP has
   * to exist and be ACTIVE-adjacent (roster status is judged by rule 6, not
   * here) and the truck has to match something we hold for that person.
   */
  app.post("/api/public/rental-request/open/verify", async (req, res) => {
    try {
      const ldap = String(req.body?.ldap || "").trim().toUpperCase();
      const truck = String(req.body?.truckNumber || "").trim();
      // A new hire has no truck number, and the category that exists for them
      // was unreachable while the door demanded one. Identity stays
      // two-factor: the truck is swapped for the mobile number we hold.
      const noTruck = req.body?.noTruck === true;
      const claimedPhone = String(req.body?.phone || "").replace(/[^0-9]/g, "").replace(/^1(?=\d{10}$)/, "");
      if (!ldap || (!noTruck && !truck) || (noTruck && claimedPhone.length !== 10)) {
        return res.status(400).json({
          verified: false,
          message: noTruck
            ? "Please enter your LDAP and your 10-digit mobile number."
            : "Please enter both your LDAP and your truck number.",
        });
      }

      const f = await factsFor(ldap);
      if (!f) {
        return res.status(403).json({
          verified: false,
          message: "We could not find that LDAP on the technician roster. Check the spelling, "
                 + "or contact Fleet if you have just started.",
        });
      }

      if (noTruck) {
        const onFile = [f.tpms_phone, f.cell_phone, f.main_phone]
          .map((c: any) => String(c || "").replace(/[^0-9]/g, "").replace(/^1(?=\d{10}$)/, ""))
          .filter((c: string) => c.length === 10);
        if (!onFile.length) {
          return res.status(403).json({
            verified: false,
            message: "We have no phone number on file for you, so we cannot verify you this "
                   + "way. Contact Fleet and we will set you up directly.",
          });
        }
        if (!onFile.includes(claimedPhone)) {
          return res.status(403).json({
            verified: false,
            message: "That mobile number does not match what we have on file for you. "
                   + "Contact Fleet if your number has changed.",
          });
        }
      } else {
        const candidates = ((f.truck_candidates as any[]) || [])
          .filter(Boolean).map((t: any) => normTruck(String(t)));
        // If we hold no truck at all for someone, accept what they typed rather
        // than locking them out of the front door over our own missing data. The
        // value is recorded and the mismatch is visible to Fleet either way.
        if (candidates.length && !candidates.includes(normTruck(truck))) {
          return res.status(403).json({
            verified: false,
            message: "That truck number does not match our records for you. Enter the number on "
                   + "your current van, or contact Fleet if it has just changed.",
          });
        }
      }

      // A technician who already has one in flight must not open a second.
      const { rows: live } = await db.execute(sql`
        SELECT request_no, status FROM vrm_rental_request
        WHERE ldap = ${ldap} AND status IN ('pending','approved','booked')
          AND created_at > now() - interval '30 days'
        ORDER BY created_at DESC LIMIT 1
      `);
      const open = (live as any[])[0];
      if (open) {
        return res.status(409).json({
          verified: false,
          message: `You already have rental request #${open.request_no} with us (${open.status}). `
                 + "Fleet is working it. Contact Fleet rather than starting a second one.",
        });
      }

      const { rows: recent } = await db.execute(sql`
        SELECT count(*)::int AS n FROM vrm_rental_request
        WHERE ldap = ${ldap}
          AND status <> 'returned'
          AND (created_at AT TIME ZONE 'America/New_York')::date
            = (now()      AT TIME ZONE 'America/New_York')::date
      `);
      if (Number((recent as any[])[0]?.n ?? 0) >= SELF_SERVE_DAILY_CAP) {
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
               is_drivable, is_safe_to_drive, jobs_affected, what_was_tried,
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

      res.json({
        verified: true,
        policyVersion: POLICY_VERSION,
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
          truckNumber: String(f.truck_number || truck || ""),
          district: f.district_no ?? "",
          homeState: f.home_state ?? "",
          mobilePhone: phoneFor(f) ?? "",
          isByov: Number(f.byov_count ?? 0) > 0,
        },
      });
    } catch (e: any) {
      console.error("[rental-request] open verify failed:", e?.message || e);
      res.status(500).json({ verified: false, message: "Something went wrong. Please try again." });
    }
  });

  app.post("/api/public/rental-request/open/submit", async (req, res) => {
    try {
      const ldap = String(req.body?.ldap || "").trim().toUpperCase();
      if (!ldap) return res.status(400).json({ success: false, message: "Missing LDAP." });

      const f = await factsFor(ldap);
      if (!f) return res.status(403).json({ success: false, message: "We could not find that LDAP on the roster." });

      // Re-check the in-flight guard at submit time, not just at verify time.
      // Two tabs, or a double-tap on a slow phone, would otherwise each pass
      // the earlier check and produce two records and two ETD reservations.
      // The partial unique index on (ldap) WHERE token_id IS NULL is the
      // backstop underneath this; this is here to give a readable answer.
      const { rows: live } = await db.execute(sql`
        SELECT request_no, status FROM vrm_rental_request
        WHERE ldap = ${ldap} AND status IN ('pending','approved','booked')
          AND created_at > now() - interval '30 days'
        ORDER BY created_at DESC LIMIT 1
      `);
      const open = (live as any[])[0];
      if (open) {
        return res.status(409).json({
          success: false,
          requestNo: open.request_no,
          message: `You already have rental request #${open.request_no} with us (${open.status}).`,
        });
      }

      const { rows: today } = await db.execute(sql`
        SELECT count(*)::int AS n FROM vrm_rental_request
        WHERE ldap = ${ldap}
          AND status <> 'returned'
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

      const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
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
        body: req.body || {},
        ip,
      });
      res.status(out.code).json(out.json);
    } catch (e: any) {
      // The unique index firing here means a genuine race, not a bug.
      if (String(e?.message || "").includes("vrm_rental_request_open_live_uniq")) {
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
      if (!ldap || !truck) return res.status(400).json({ verified: false, message: "Please enter both your LDAP and your truck number." });
      if (row.ldap && ldap !== String(row.ldap).trim().toUpperCase()) {
        return res.status(403).json({ verified: false, message: "That LDAP does not match this link." });
      }
      const onFile = String(row.truck_number || "").trim();
      if (onFile && normTruck(onFile) !== normTruck(truck)) {
        return res.status(403).json({ verified: false, message: "That truck number does not match our records for you." });
      }

      // Section A is CONFIRMED, not typed. Send back what we already hold.
      const f = await factsFor(ldap);
      res.json({
        verified: true,
        policyVersion: POLICY_VERSION,
        identity: {
          ldap,
          techName: row.tech_name || "",
          truckNumber: onFile || truck,
          district: f?.district_no ?? "",
          homeState: f?.home_state ?? "",
          mobilePhone: row.phone || "",
          isByov: Number(f?.byov_count ?? 0) > 0,
        },
      });
    } catch (e: any) {
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
      const facts0 = await factsFor(ldap);
      const ip0 = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
      const out = await screenAndRecord({
        tokenRow: row,
        ldap,
        source: "form",
        identity: {
          techName: row.tech_name || facts0?.tech_name || null,
          truckNumber: row.truck_number || (facts0?.truck_number ? String(facts0.truck_number) : null),
          district: facts0?.district_no ?? null,
          homeState: facts0?.home_state ?? null,
          mobilePhone: row.phone || phoneFor(facts0),
        },
        body: b,
        ip: ip0,
      });
      return res.status(out.code).json(out.json);
    } catch (e: any) {
      console.error("[rental-request] submit failed:", e?.message || e);
      res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
    }
  });
}


// ---------------------------------------------------------------------------
// Admin surface
// ---------------------------------------------------------------------------
export function registerRentalRequestAdminRoutes(router: Router): void {
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
         "missing_fields", "returned_at", "return_count", "tech_reported_branch",
         "ack_working_hours_only", "ack_return_before_time_off", "ack_extension_weekly", "ack_discipline",
         "policy_complete"]],
      ["vrm_byov_status", ["ldap", "status", "synced_at"]],
      ["vrm_etd_churn_log", ["ran_at", "dry_run", "added", "removed"]],
      // Cutover tracking. Without this the survey pool, the ETD reservation and
      // the route block have no shared record and the scoreboard reads empty
      // rather than broken.
      ["vrm_rental_cutover",
        ["ldap", "reservation_status", "etd_reference", "reserved_at",
         "route_block_status", "route_block_project_id", "route_block_filed_at"]],
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
      const requiredIndexes = ["vrm_rental_request_token_uniq", "vrm_rental_request_open_live_uniq"];
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

  router.get("/forms/rental-request/missing-reasons", async (_req, res) => {
    res.json({ reasons: MISSING_REASONS });
  });

  router.get("/forms/rental-request/list", async (_req, res) => {
    try {
      const { rows } = await db.execute(sql`
        SELECT r.*, t.sent_at, t.opened_at
        FROM vrm_rental_request r
        LEFT JOIN vrm_form_tokens t ON t.id = r.token_id
        ORDER BY r.created_at DESC
      `);
      res.json({ requests: rows });
    } catch (e: any) {
      res.status(500).json({ message: e?.message || "Failed to load requests." });
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
      `);
      res.json(rows[0] || {});
    } catch (e: any) {
      res.status(500).json({ message: e?.message || "Failed to load stats." });
    }
  });

  /**
   * Approved requests waiting on a reservation.
   *
   * Everything the ETD booking chain needs, resolved server-side so the runner
   * does not re-derive business rules:
   *   pickup   - the SHOP, not the technician's home. They drop the van and
   *              collect the rental nearby.
   *   start    - the appointment. A rental starts when the van goes in.
   *   end      - appointment + the SHOP's estimate + a one day buffer. Never
   *              open-ended; an open-ended rental is one nobody closes.
   *
   * Reachable with a session OR the internal-cron header, so the Python runner
   * can pull it without a browser login.
   */
  router.get("/forms/rental-request/booking-queue", async (req, res) => {
    try {
      // Lease what we hand out. A second runner starting while the first is
      // mid-flight would otherwise pull the same rows and create a second real
      // reservation for the same technician. Claims older than 30 minutes are
      // reclaimable so a crashed runner does not park work forever.
      const runner = String((req as any).query?.runner || "runner").slice(0, 60);
      await db.execute(sql`
        UPDATE vrm_rental_request
        SET claimed_at = now(), claimed_by = ${runner}
        WHERE status = 'approved' AND etd_booked_at IS NULL
          AND appointment_at IS NOT NULL
          AND (claimed_at IS NULL OR claimed_at < now() - interval '30 minutes')
      `);
      const { rows } = await db.execute(sql`
        SELECT r.request_no, r.ldap, r.tech_name, r.truck_number, r.mobile_phone,
               r.shop_name, r.shop_address, r.shop_city, r.shop_state, r.shop_postal,
               r.tech_reported_branch,
               r.appointment_at,
               r.shop_estimated_days,
               COALESCE(r.approved_vehicle_class, 'sedan')          AS vehicle_class,
               to_char(r.appointment_at, 'YYYY-MM-DD"T"HH24:MI:SS')  AS start_dt,
               to_char(r.appointment_at + ((COALESCE(r.shop_estimated_days,1) + 1) * interval '1 day'),
                       'YYYY-MM-DD"T"HH24:MI:SS')                    AS end_dt,
               r.ldap || '-' || COALESCE(r.truck_number,'NA')        AS reference,
               -- Class is decided from the roster, never asked. Tyler's cutover
               -- ruling 2026-08-13: not HVAC gets a sedan, HVAC keeps a vehicle
               -- sized like the one they have because the equipment does not fit
               -- in a trunk. Sent as the raw title so the runner owns the mapping.
               a.job_title                                           AS job_title
        FROM vrm_rental_request r
        LEFT JOIN all_techs a ON upper(a.tech_racfid) = upper(r.ldap)
        WHERE r.status = 'approved'
          AND r.etd_booked_at IS NULL
          AND r.appointment_at IS NOT NULL
          AND r.claimed_by = ${runner}
        ORDER BY r.appointment_at
      `);
      res.json({ queue: rows, count: (rows as any[]).length });
    } catch (e: any) {
      console.error("[rental-request] booking-queue failed:", e?.message || e);
      res.status(500).json({ message: e?.message || "Failed to load booking queue." });
    }
  });

  /**
   * Record the outcome of a booking attempt. Success stamps the reservation and
   * moves the request to `booked`; failure stores the error and LEAVES the row
   * approved so the next run retries it rather than losing it silently.
   */
  router.post("/forms/rental-request/:requestNo/booked", async (req, res) => {
    try {
      const no = Number(req.params.requestNo);
      if (!Number.isFinite(no)) return res.status(400).json({ message: "bad request number" });
      const ref = String(req.body?.etdReference || "").trim();
      const resId = String(req.body?.etdReservationId || "").trim();
      const error = String(req.body?.error || "").trim();
      // The branch is what the technician actually has to walk into, and
      // nearest_branch_name existed as a column that nothing ever wrote. The
      // runner knows it from the quote; take it while it is in hand.
      const branch = String(req.body?.branchName || "").trim().slice(0, 200);

      if (error) {
        // Never stamp an error onto a row that already booked. A late failure
        // report from a retry would otherwise mark a live reservation as broken.
        await db.execute(sql`
          UPDATE vrm_rental_request
          SET etd_error = ${error.slice(0, 500)}, claimed_at = NULL, updated_at = now()
          WHERE request_no = ${no} AND etd_booked_at IS NULL
        `);
        return res.json({ ok: true, recorded: "error" });
      }
      if (!ref && !resId) {
        return res.status(400).json({ message: "supply etdReference/etdReservationId, or error" });
      }
      // Conditional transition, not a blind overwrite. A replayed writeback
      // must not re-stamp a row that already booked, and must not resurrect one
      // a human has since denied.
      const { rows } = await db.execute(sql`
        UPDATE vrm_rental_request
        SET etd_reference = ${ref || null}, etd_reservation_id = ${resId || null},
            nearest_branch_name = COALESCE(${branch || null}, nearest_branch_name),
            etd_booked_at = now(), etd_error = NULL,
            status = 'booked', claimed_at = NULL, updated_at = now()
        WHERE request_no = ${no} AND status = 'approved' AND etd_booked_at IS NULL
        RETURNING request_no, status, appointment_at, shop_name
      `);
      if (!(rows as any[]).length) {
        const { rows: cur } = await db.execute(sql`
          SELECT status, etd_reference, etd_booked_at FROM vrm_rental_request WHERE request_no = ${no}
        `);
        const c = (cur as any[])[0];
        if (!c) return res.status(404).json({ message: "request not found" });
        return res.status(409).json({
          message: `not writable: status is '${c.status}'` +
                   (c.etd_booked_at ? ` and it already booked as ${c.etd_reference}` : ""),
          status: c.status, etdReference: c.etd_reference,
        });
      }
      const booked = (rows as any[])[0];

      // The confirmation number is the whole point. Storing it and never
      // telling the technician leaves them exactly where Holman left them:
      // waiting for a phone call. This is the promise the submit screen makes.
      void notifyTech(
        no,
        `Sears Fleet: your rental is booked. Confirmation ${ref || resId}.`
        + (branch ? `\nPick up at Enterprise ${branch}.` : "")
        + (booked?.appointment_at
            ? `\nFrom ${new Date(booked.appointment_at).toLocaleDateString("en-US")}`
              + (booked.shop_name ? `, when your van goes into ${booked.shop_name}.` : ".")
            : "")
        + `\nReturn it within 1 working day of your van being ready. `
        + `If your van is still in the shop after 7 days, request an extension from Fleet.`,
        "booked-notice",
      );
      res.json({ ok: true, ...booked });
    } catch (e: any) {
      console.error("[rental-request] booked failed:", e?.message || e);
      res.status(500).json({ message: e?.message || "Failed to record booking." });
    }
  });

  /** Human decision. May overrule the engine, and must say why when it does. */
  router.post("/forms/rental-request/:requestNo/decide", async (req, res) => {
    try {
      const decision = String(req.body?.decision || "").toUpperCase();
      if (!["APPROVE", "DENY", "DEFER", "RETURN"].includes(decision)) {
        return res.status(400).json({ message: "decision must be APPROVE, DENY, DEFER or RETURN" });
      }
      const note = String(req.body?.note || "").trim();

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
        SELECT auto_decision FROM vrm_rental_request WHERE request_no = ${Number(req.params.requestNo)}
      `);
      const cur = (rows as any[])[0];
      if (!cur) return res.status(404).json({ message: "request not found" });
      if (cur.auto_decision && cur.auto_decision !== decision && !note) {
        return res.status(400).json({
          message: `Overruling the engine (${cur.auto_decision} -> ${decision}) requires a note.`,
        });
      }

      // Never overwrite a booked row. Denying one would leave a live ETD
      // reservation attached to a request the record says was refused, and
      // nothing downstream would ever go cancel it.
      const nextStatus =
        decision === "APPROVE" ? "approved"
        : decision === "DENY" ? "denied"
        : decision === "RETURN" ? "returned"
        : "deferred";
      const { rows: upd } = await db.execute(sql`
        UPDATE vrm_rental_request
        SET status = ${nextStatus},
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
        WHERE request_no = ${Number(req.params.requestNo)} AND status <> 'booked'
        RETURNING request_no
      `);
      if (!(upd as any[]).length) {
        return res.status(409).json({
          message: "This request is already BOOKED. Cancel the reservation in ETD first; "
                 + "changing the decision here would leave a live rental on a denied request.",
        });
      }

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
          ? "Sears Fleet: your rental request is approved. We are booking the reservation now "
            + "and will text you the confirmation number and branch."
          : decision === "DENY"
          ? `Sears Fleet: your rental request was not approved.${note ? ` ${note}` : ""}`
            + " Reply to this message if your situation has changed."
          : `Sears Fleet: we are holding your rental request until you have a confirmed shop `
            + `appointment.${note ? ` ${note}` : ""} Start a new request once the shop gives you a date: `
            + PUBLIC_REQUEST_URL;
      void notifyTech(no, text, `decision-${decision.toLowerCase()}`);

      res.json({ ok: true, decision });
    } catch (e: any) {
      res.status(500).json({ message: e?.message || "decide failed" });
    }
  });
}
