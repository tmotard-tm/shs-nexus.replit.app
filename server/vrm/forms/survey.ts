/**
 * Rental technician survey — tokenised, public, no login.
 *
 * Mirrors the LOA form machinery (`/api/public/loa-form/:token`) rather than
 * inventing a second pattern: token in the URL, LDAP + truck number typed by the
 * technician as the identity check, then the questionnaire.
 *
 * Identity is deliberately typed rather than inferred. The token proves the link
 * reached the right handset; the LDAP proves who is holding it. Both are stored,
 * so a response can be trusted well enough to book a rental reservation against.
 *
 * Routes registered here mount on `app` directly, OUTSIDE the /api/vrm session
 * gate, because technicians have no Nexus session. The admin read side mounts on
 * the VRM router and is session-gated normally.
 */
import type { Express, Router } from "express";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import crypto from "crypto";
import { sendStandardActivity } from "../dca-task-client";
import { isRouteBlockLive } from "../rental-operations/schedule-pickup";
import { requireCronOrStaff } from "./cutover-intents-routes";
import { registerCutoverIntentRoutes } from "./cutover-intents-routes";
import { buildCutoverBlockArgs } from "./cutover-block-args";

/** Truck numbers arrive with stray zeros, spaces and dashes. Compare on digits. */
function normTruck(v: string): string {
  const digits = String(v || "").replace(/\D/g, "").replace(/^0+/, "");
  return digits || String(v || "").trim().toUpperCase();
}


const RENTAL_COMPANIES = new Set(["Enterprise", "Avis", "Hertz"]);

// Every state the van can be in. There is deliberately no "not sure" value: a
// technician is responsible for the whereabouts of their van, and an honest
// "I don't know" is an escalation, not a survey answer.
const VAN_STATUS = new Set([
  "in_shop",
  "decommissioned",
  "totaled",
  "with_me",
  "unknown_escalate",
]);

const NO_RENTAL_REASONS = new Set([
  "returned_it",
  "never_had_one",
  "back_in_my_van",
]);

export type SurveyTokenRow = {
  id: string;
  token: string;
  ldap: string | null;
  truck_number: string | null;
  tech_name: string | null;
  prefill: Record<string, any>;
  submitted_at: string | null;
  expires_at: string;
};

export function newToken(): string {
  return crypto.randomBytes(16).toString("hex");
}

async function loadToken(token: string): Promise<SurveyTokenRow | null> {
  const { rows } = await db.execute(sql`
    SELECT id, token, ldap, truck_number, tech_name, prefill, submitted_at, expires_at
    FROM vrm_form_tokens
    WHERE token = ${token} AND form_type = 'rental_tech_survey'
    LIMIT 1
  `);
  const row = (rows as any[])[0];
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return row as SurveyTokenRow;
}

/** Shared identity check for both verify and submit, so they cannot drift apart. */
/** Next Mon-Fri after today, as YYYY-MM-DD. Blocks land tomorrow, not today. */
function nextBusinessDayISO(from: Date = new Date()): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  do {
    d.setUTCDate(d.getUTCDate() + 1);
  } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

function checkIdentity(row: SurveyTokenRow, body: any) {
  // LDAP only. The truck number used to be part of this gate, compared against
  // the truck on the rental case. That truck comes out of the Holman feed and is
  // very often NOT the truck the technician is driving today -- which is one of
  // the things this survey exists to find out. Gating on it locked out exactly
  // the people whose data is wrong. The form still asks for both truck numbers
  // inside, where a mismatch is an answer instead of a locked door.
  const ldap = String(body?.ldap || "").trim().toUpperCase();
  if (!ldap) {
    return { ok: false as const, code: 400, message: "Please enter your LDAP." };
  }
  if (row.ldap && ldap !== String(row.ldap).trim().toUpperCase()) {
    return { ok: false as const, code: 403, message: "That LDAP does not match this link. Check your entry and try again." };
  }
  return { ok: true as const, ldap, truck: String(row.truck_number || "").trim() };
}

// ---------------------------------------------------------------------------
// Public (unauthenticated) surface
// ---------------------------------------------------------------------------
export function registerRentalSurveyPublicRoutes(app: Express): void {
  app.get("/api/public/rental-survey/:token", async (req, res) => {
    try {
      const row = await loadToken(req.params.token);
      if (!row) {
        return res.status(404).json({ valid: false, message: "This link is invalid or has expired." });
      }
      await db.execute(sql`
        UPDATE vrm_form_tokens SET opened_at = COALESCE(opened_at, now()) WHERE id = ${row.id}
      `);
      res.json({
        valid: true,
        completed: !!row.submitted_at,
        techName: row.tech_name || "",
        hasTruckOnFile: !!String(row.truck_number || "").trim(),
      });
    } catch (error: any) {
      console.error("[survey] load failed:", error?.message || error);
      res.status(500).json({ valid: false, message: "Something went wrong. Please try again." });
    }
  });

  app.post("/api/public/rental-survey/:token/verify", async (req, res) => {
    try {
      const row = await loadToken(req.params.token);
      if (!row) return res.status(404).json({ verified: false, message: "This link is invalid or has expired." });
      if (row.submitted_at) {
        return res.status(409).json({ verified: false, completed: true, message: "You have already completed this. Thank you." });
      }
      const id = checkIdentity(row, req.body);
      if (!id.ok) return res.status(id.code).json({ verified: false, message: id.message });

      const prefill = row.prefill || {};
      res.json({
        verified: true,
        techName: row.tech_name || "",
        truckNumber: id.truck,
        prefill: {
          rentalTruckNumber: prefill.rental_truck_number || row.truck_number || "",
          assignedTruckNumber: prefill.assigned_truck_number || "",
          shopName: prefill.shop_name || "",
          shopPhone: prefill.shop_phone || "",
          rentalCompany: prefill.rental_company || "",
        },
      });
    } catch (error: any) {
      console.error("[survey] verify failed:", error?.message || error);
      res.status(500).json({ verified: false, message: "Something went wrong. Please try again." });
    }
  });

  app.post("/api/public/rental-survey/:token/submit", async (req, res) => {
    try {
      const row = await loadToken(req.params.token);
      if (!row) return res.status(404).json({ success: false, message: "This link is invalid or has expired." });
      if (row.submitted_at) {
        return res.status(409).json({ success: false, completed: true, message: "You have already completed this. Thank you." });
      }
      const id = checkIdentity(row, req.body);
      if (!id.ok) return res.status(id.code).json({ success: false, message: id.message });

      const b = req.body || {};
      const s = (v: any, max = 200) => String(v ?? "").trim().slice(0, max) || null;
      const hasRental = b.hasRental === true || b.hasRental === "yes";

      const missing: string[] = [];
      if (b.hasRental !== true && b.hasRental !== false && b.hasRental !== "yes" && b.hasRental !== "no") {
        missing.push("whether you are in a rental");
      }

      let vanStatus: string | null = null;
      let rentalCompany: string | null = null;
      let noRentalReason: string | null = null;

      // "I don't know where my van is" is an escape hatch, and an escape hatch
      // that demands the form it bypasses is not one. A technician who cannot
      // account for their van has not filled in the branch city or the truck
      // number they are assigned, so an escalation is accepted as a complete
      // answer on its own and whatever they DID manage to enter is kept.
      const escalating = s(b.vanStatus, 40) === "unknown_escalate";

      if (hasRental && escalating) {
        vanStatus = "unknown_escalate";
        rentalCompany = s(b.rentalCompany, 40);
        if (rentalCompany && !RENTAL_COMPANIES.has(rentalCompany)) rentalCompany = null;
      } else if (hasRental) {
        rentalCompany = s(b.rentalCompany, 40);
        if (!rentalCompany || !RENTAL_COMPANIES.has(rentalCompany)) missing.push("the rental company");
        // Branch city/state and the assigned truck number are recorded but NOT
        // required, and the client stopped asking for them too -- the two must
        // agree or the form accepts an answer the server then rejects with a
        // 400 the fields are no longer marked for. We already hold the branch
        // from the rental feed, and a technician whose van was totalled may
        // have no current truck number to give.
        vanStatus = s(b.vanStatus, 40);
        if (!vanStatus || !VAN_STATUS.has(vanStatus)) missing.push("what is happening with your van");
        if (vanStatus === "in_shop") {
          if (!s(b.shopName)) missing.push("the repair shop name");
          if (!s(b.shopCity)) missing.push("the repair shop city");
        }
      } else {
        noRentalReason = s(b.noRentalReason, 40);
        if (!noRentalReason || !NO_RENTAL_REASONS.has(noRentalReason)) missing.push("what happened to the rental");
        // Also ask where the van is on this path. Without it we cannot tell a
        // technician whose van is fixed from one who is stranded with nothing,
        // and the second group is exactly who needs a rental raised for them.
        const vs = s(b.vanStatus, 40);
        if (vs && VAN_STATUS.has(vs)) vanStatus = vs;
      }

      if (missing.length) {
        return res.status(400).json({ success: false, message: `Please answer: ${missing.join(", ")}.` });
      }

      const promised = s(b.promisedReadyDate, 10);
      const promisedDate = promised && /^\d{4}-\d{2}-\d{2}$/.test(promised) ? promised : null;
      const decommissioned = vanStatus === "decommissioned";
      // Only meaningful on the decommissioned branch with no reassignment: TRUE
      // means parts and inventory are still transacting against a dead truck
      // number, FALSE means the tech has no working truck number at all.
      const techhubStillUsing =
        decommissioned && !s(b.assignedTruckNumber, 30)
          ? (b.techhubStillUsing === true || b.techhubStillUsing === "yes")
          : null;

      const prefill = row.prefill || {};

      const { rows: surveyIns } = await db.execute(sql`
        INSERT INTO vrm_rental_tech_survey (
          token_id, ldap, truck_number, tech_name,
          shop_name_on_file, shop_phone_on_file,
          has_rental, shop_name, shop_city, shop_state, shop_phone,
          van_status, promised_ready_date, still_in_rental, rental_company, blocker,
          rental_truck_number, assigned_truck_number,
          rental_truck_on_file, assigned_truck_on_file,
          rental_vehicle_desc, truck_decommissioned, decomm_detail,
          techhub_still_using,
          rental_branch_name, rental_branch_city, rental_branch_state, rental_branch_phone,
          no_rental_reason, response_channel
        ) VALUES (
          ${row.id}, ${id.ldap}, ${id.truck}, ${row.tech_name || null},
          ${prefill.shop_name || null}, ${prefill.shop_phone || null},
          ${hasRental}, ${s(b.shopName)}, ${s(b.shopCity, 80)}, ${s(b.shopState, 2)}, ${s(b.shopPhone, 30)},
          ${vanStatus}, ${promisedDate}, ${hasRental}, ${rentalCompany}, ${s(b.blocker, 600)},
          ${s(b.rentalTruckNumber, 30)}, ${s(b.assignedTruckNumber, 30)},
          ${prefill.rental_truck_number || null}, ${prefill.assigned_truck_number || null},
          ${s(b.rentalVehicleDesc, 120)}, ${decommissioned}, ${s(b.decommDetail, 300)},
          ${techhubStillUsing},
          ${s(b.rentalBranchName, 160)}, ${s(b.rentalBranchCity, 80)}, ${s(b.rentalBranchState, 2)}, ${s(b.rentalBranchPhone, 30)},
          ${noRentalReason}, 'form'
        )
        RETURNING id
      `);
      const surveyId = (surveyIns as any[])[0]?.id ?? null;

      await db.execute(sql`
        UPDATE vrm_form_tokens SET submitted_at = now() WHERE id = ${row.id}
      `);

      // The survey reconciles EXISTING rentals. It does not open new ones.
      // A previous version auto-raised a rental request from a no-rental
      // answer and told the technician on screen that Fleet would follow up.
      // Removed 2026-08-13: it was never in the spec, and it committed Fleet
      // to a request nobody had approved. The front door for a new rental is
      // the rental request form.
      res.json({
        success: true,
        escalated: vanStatus === "unknown_escalate",
      });
    } catch (error: any) {
      console.error("[survey] submit failed:", error?.message || error);
      res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
    }
  });
}

// ---------------------------------------------------------------------------
// Admin (session-gated) surface — mounted on the VRM router
// ---------------------------------------------------------------------------
export function registerRentalSurveyAdminRoutes(router: Router): void {
  /** Per-response rows, newest first, joined to send/open state. */
  router.get("/forms/rental-survey/responses", async (_req, res) => {
    try {
      const { rows } = await db.execute(sql`
        SELECT r.*, t.sent_at, t.opened_at, t.batch, t.phone,
               -- Tyler 2026-08-13: rows STAY here; each carries an identifier
               -- for where the technician stands in the cutover instead.
               CASE
                 WHEN c.reservation_status = 'booked'
                  AND c.route_block_status = 'filed'
                  AND c.route_block_live IS TRUE           THEN 'complete'
                 WHEN c.reservation_status = 'booked'      THEN 'reserved'
                 WHEN c.reservation_status = 'failed'      THEN 'failed'
                 ELSE ''
               END AS cutover_status,
               c.etd_reference AS cutover_reference,
               sup.district, sup.supervisor_name, sup.supervisor_ldap, sup.supervisor_phone,
               -- What AMS says about their van, next to what they claimed.
               a.truck_status_name AS ams_status,
               a.in_repair         AS ams_in_repair,
               a.repair_status     AS ams_repair_status,
               a.sale_date         AS ams_sale_date,
               a.cur_loc_city      AS ams_loc_city,
               a.cur_loc_state     AS ams_loc_state,
               a.ams_synced_at,
               -- TPMS-verified current assignment (Tyler 2026-08-16): the page
               -- shows THIS as the assigned truck regardless of what the tech
               -- typed; their entered number stays as the rental-under number.
               tpt.tpms_truck_number
        FROM vrm_rental_tech_survey r
        LEFT JOIN vrm_form_tokens t ON t.id = r.token_id
        LEFT JOIN vrm_rental_cutover c ON c.ldap = upper(r.ldap)
        LEFT JOIN LATERAL (
          SELECT NULLIF(btrim(a2.district_no::text),'') AS district,
                 ma.tech_name  AS supervisor_name,
                 upper(tp2.tech_manager_ldap_id) AS supervisor_ldap,
                 COALESCE(mgp.mobile_phone, ma.cell_phone, ma.main_phone) AS supervisor_phone
          FROM (SELECT 1) one
          LEFT JOIN LATERAL (SELECT a.district_no FROM all_techs a
                             WHERE upper(a.tech_racfid) = upper(r.ldap)
                             ORDER BY (a.employment_status='A') DESC LIMIT 1) a2 ON TRUE
          LEFT JOIN LATERAL (SELECT t.tech_manager_ldap_id FROM tpms_tech_profiles t
                             WHERE upper(t.enterprise_id) = upper(r.ldap)
                             ORDER BY t.synced_at DESC NULLS LAST LIMIT 1) tp2 ON TRUE
          LEFT JOIN LATERAL (SELECT a.tech_name, a.cell_phone, a.main_phone FROM all_techs a
                             WHERE upper(a.tech_racfid) = upper(COALESCE(tp2.tech_manager_ldap_id,''))
                             ORDER BY (a.employment_status='A') DESC LIMIT 1) ma ON TRUE
          LEFT JOIN LATERAL (SELECT t.mobile_phone FROM tpms_tech_profiles t
                             WHERE upper(t.enterprise_id) = upper(COALESCE(tp2.tech_manager_ldap_id,''))
                             LIMIT 1) mgp ON TRUE
        ) sup ON TRUE
        -- Current TPMS assignment, keyed on enterprise_id (tech_id is NOT
        -- unique). truck_no arrives zero-padded; normalize to bare digits.
        LEFT JOIN LATERAL (
          SELECT NULLIF(ltrim(regexp_replace(COALESCE(t.truck_no, ''), '[^0-9]', '', 'g'), '0'), '')
                   AS tpms_truck_number
          FROM tpms_tech_profiles t
          WHERE upper(t.enterprise_id) = upper(r.ldap)
            AND NULLIF(ltrim(regexp_replace(COALESCE(t.truck_no, ''), '[^0-9]', '', 'g'), '0'), '') IS NOT NULL
          ORDER BY t.synced_at DESC NULLS LAST LIMIT 1
        ) tpt ON TRUE
        -- AMS status keyed on the TPMS-verified truck (Tyler 2026-08-16); the
        -- tech-entered / on-file number is only consulted when TPMS has no
        -- assignment at all.
        LEFT JOIN vrm_ams_status a
          ON a.truck_norm = COALESCE(
               tpt.tpms_truck_number,
               -- Normalize EACH candidate before falling through: entered
               -- placeholder text ("unknown") must yield NULL here, not
               -- suppress a perfectly good on-file truck number.
               NULLIF(ltrim(regexp_replace(COALESCE(r.assigned_truck_number, ''), '[^0-9]', '', 'g'), '0'), ''),
               NULLIF(ltrim(regexp_replace(COALESCE(r.truck_number, ''), '[^0-9]', '', 'g'), '0'), ''))
        ORDER BY r.created_at DESC
      `);
      res.json({ responses: rows });
    } catch (error: any) {
      console.error("[survey] responses failed:", error?.message || error);
      res.status(500).json({ message: "Failed to load responses." });
    }
  });

  /**
   * Mint ONE throwaway token pointed at an arbitrary phone, so the real message
   * and the real form can be walked end to end before a live send. It goes out
   * through the same send-chunk route as everything else on purpose: a test
   * that uses its own code path tests nothing.
   *
   * Marked batch='TEST' and ldap='ZZTEST', and excluded from /pending and
   * /stats, so it cannot be swept into a real send or inflate the funnel.
   */
  router.post("/forms/rental-survey/test", async (req, res) => {
    try {
      const phone = String(req.body?.phone || "").replace(/[^0-9]/g, "").replace(/^1/, "");
      if (phone.length !== 10) {
        return res.status(400).json({ message: "Give me a 10-digit phone." });
      }
      const truck = String(req.body?.truckNumber || "99999").trim();
      const token = newToken();
      const baseUrl = String(req.body?.baseUrl || "https://SHS-Nexus.replit.app").replace(/\/+$/, "");
      await db.execute(sql`
        INSERT INTO vrm_form_tokens
          (token, form_type, ldap, truck_number, tech_name, phone, prefill, batch, expires_at)
        VALUES (
          ${token}, 'rental_tech_survey', 'ZZTEST', ${truck},
          ${"TEST - do not action"}, ${phone},
          ${JSON.stringify({
            rental_truck_number: truck,
            rental_company: "Enterprise Rent-A-Car",
            branch_city: "TEST",
            branch_state: "NC",
          })}::jsonb,
          'TEST', now() + interval '2 days'
        )
      `);
      res.json({ token, url: `${baseUrl}/rental-survey/${token}`, phone,
                 next: "POST /api/vrm/forms/rental-survey/send-chunk {tokens:[token],confirm:true}" });
    } catch (error: any) {
      console.error("[survey] test token failed:", error?.message || error);
      res.status(500).json({ message: error?.message || "test token failed" });
    }
  });

  /** Send/response funnel plus the counts that drive the reservation queue. */
  router.get("/forms/rental-survey/stats", async (_req, res) => {
    try {
      const { rows } = await db.execute(sql`
        SELECT
          (SELECT count(*) FROM vrm_form_tokens WHERE form_type='rental_tech_survey' AND COALESCE(batch,'') <> 'TEST')                        AS issued,
          (SELECT count(*) FROM vrm_form_tokens WHERE form_type='rental_tech_survey' AND COALESCE(batch,'') <> 'TEST' AND sent_at IS NOT NULL)     AS sent,
          (SELECT count(*) FROM vrm_form_tokens WHERE form_type='rental_tech_survey' AND COALESCE(batch,'') <> 'TEST' AND opened_at IS NOT NULL)   AS opened,
          (SELECT count(*) FROM vrm_form_tokens WHERE form_type='rental_tech_survey' AND COALESCE(batch,'') <> 'TEST' AND submitted_at IS NOT NULL) AS submitted,
          (SELECT count(*) FROM vrm_rental_tech_survey WHERE upper(COALESCE(ldap,'')) <> 'ZZTEST' AND has_rental)                                     AS still_in_rental,
          (SELECT count(*) FROM vrm_rental_tech_survey WHERE upper(COALESCE(ldap,'')) <> 'ZZTEST' AND has_rental IS FALSE)                            AS no_longer_in_rental,
          (SELECT count(*) FROM vrm_rental_tech_survey WHERE upper(COALESCE(ldap,'')) <> 'ZZTEST' AND truck_mismatch)                                 AS truck_mismatch,
          (SELECT count(*) FROM vrm_rental_tech_survey WHERE upper(COALESCE(ldap,'')) <> 'ZZTEST' AND van_status='unknown_escalate')                  AS escalations,
          (SELECT count(*) FROM vrm_rental_tech_survey WHERE upper(COALESCE(ldap,'')) <> 'ZZTEST' AND truck_decommissioned)                           AS decommissioned,
          (SELECT count(*) FROM vrm_rental_tech_survey WHERE upper(COALESCE(ldap,'')) <> 'ZZTEST' AND techhub_still_using IS FALSE)                   AS no_truck_number
      `);
      res.json(rows[0] || {});
    } catch (error: any) {
      console.error("[survey] stats failed:", error?.message || error);
      res.status(500).json({ message: "Failed to load stats." });
    }
  });

  /**
   * Issue one survey token per eligible renter. Returns the recipient list with
   * a ready-to-send message body. DOES NOT SEND. `dryRun` defaults to true, so
   * the default call resolves and previews without writing a single token.
   *
   * Eligibility is deliberately strict:
   *   - the rental case is OPEN and in the latest feed
   *   - identity is confidence=high AND state=RESOLVED, or a human override
   *     exists. Anything in REVIEW is a guess, and texting a guess sends a
   *     stranger a link that verifies against someone else's LDAP.
   *   - the technician is employment_status='A'. Someone terminated or on leave
   *     with an open rental is a recovery case for a human, not a survey.
   *   - a phone number exists.
   * Anyone who already holds an unexpired, unsubmitted token is skipped, so
   * re-running never double-texts.
   */
  router.post("/forms/rental-survey/issue", async (req, res) => {
    try {
      const dryRun = req.body?.dryRun !== false;
      const baseUrl = String(req.body?.baseUrl || "https://SHS-Nexus.replit.app").replace(/\/+$/, "");
      const limit = Math.min(Number(req.body?.limit) || 1000, 1000);
      const batch = String(req.body?.batch || "").trim() || null;

      const { rows } = await db.execute(sql`
        SELECT DISTINCT ON (upper(a.tech_racfid))
               upper(a.tech_racfid)                     AS ldap,
               a.first_name, a.last_name,
               c.vehicle_number                         AS truck_number,
               c.feed_json->>'RENTING_CITY_NAME'        AS branch_city,
               c.feed_json->>'RENTING_STATE'            AS branch_state,
               c.rental_vendor,
               p.phone                                  AS phone
        FROM vrm_rental_operations_cases c
        JOIN vrm_rental_identity_resolutions ir ON ir.case_key = c.case_key
        JOIN all_techs a
          -- Some resolution rows carry an LDAP where the employee_id belongs
          -- ('ASIMANO'), which matched nothing and silently dropped a real,
          -- reachable technician. Accept either key. Employee ids are numeric
          -- and racfids are alphabetic, so only one side can ever match.
          ON (a.employee_id = COALESCE(ir.override_employee_id, ir.resolved_employee_id)
           OR upper(a.tech_racfid) = upper(COALESCE(ir.override_employee_id, ir.resolved_employee_id)))
        -- 88 enterprise_ids have MORE THAN ONE tpms profile row, 79 of them with
        -- conflicting mobile numbers. A plain LEFT JOIN let both through and the
        -- outer DISTINCT ON kept whichever the planner emitted first, so the
        -- number we texted was not stable. Pick one row here, preferring the one
        -- that actually carries a mobile.
        LEFT JOIN LATERAL (
          SELECT tp.*
          FROM tpms_tech_profiles tp
          WHERE upper(tp.enterprise_id) = upper(a.tech_racfid)
          ORDER BY (NULLIF(regexp_replace(COALESCE(tp.mobile_phone,''), '[^0-9]', '', 'g'), '') IS NULL),
                   NULLIF(regexp_replace(COALESCE(tp.mobile_phone,''), '[^0-9]', '', 'g'), '')
          LIMIT 1
        ) t ON true
        -- Normalise the phone ONCE, here, and read home_phone as a last resort.
        --
        -- The character class is [^0-9] deliberately and must stay that way.
        -- The regex shorthand for a non-digit, written inside a drizzle tagged
        -- template, is cooked by JavaScript down to the bare letter D before
        -- drizzle ever sees the string. The previous expression therefore
        -- stripped the letter D out of phone numbers and left every slash and
        -- dash in place. Numbers stored like 432/978-0182 failed the length
        -- check and 39 technicians with working phones were reported to the
        -- operator as having no phone at all. Proven on the box 2026-08-12.
        -- Do not reintroduce the shorthand here.
        CROSS JOIN LATERAL (
          SELECT COALESCE(
            NULLIF(regexp_replace(COALESCE(t.mobile_phone,''),            '[^0-9]', '', 'g'), ''),
            NULLIF(regexp_replace(COALESCE(split_part(t.email,'@',1),''), '[^0-9]', '', 'g'), ''),
            NULLIF(regexp_replace(COALESCE(a.cell_phone,''),              '[^0-9]', '', 'g'), ''),
            NULLIF(regexp_replace(COALESCE(a.main_phone,''),              '[^0-9]', '', 'g'), ''),
            NULLIF(regexp_replace(COALESCE(a.home_phone,''),              '[^0-9]', '', 'g'), '')
          ) AS phone
        ) p
        WHERE c.present_in_latest
          AND upper(c.ticket_status) = 'OPEN'
          AND a.employment_status = 'A'
          AND a.tech_racfid IS NOT NULL
          -- medium+RESOLVED is included deliberately. Those are spelling and
          -- name-order variants (Vicente/Vince, Terence/Terrance, Frank Eaddy
          -- III), every one hand-verified 2026-08-12 against home state vs
          -- pickup state. REVIEW is still excluded: that is a genuine
          -- same-name ambiguity and texting it sends a stranger a link.
          -- Worst case on a wrong medium match is a text the recipient cannot
          -- action, because the form still verifies LDAP and truck.
          AND (ir.override_employee_id IS NOT NULL
               OR (ir.confidence IN ('high','medium') AND upper(ir.state) = 'RESOLVED'))
          -- Phone validity is enforced HERE, in SQL, ahead of the LIMIT.
          -- Doing it in JS afterwards under-fills every batch by however many
          -- of the first N rows happen to be unreachable.
          AND p.phone IS NOT NULL
          AND (length(p.phone) = 10
               OR (length(p.phone) = 11 AND left(p.phone, 1) = '1'))
          -- ANY prior token suppresses, not just a live unsubmitted one.
          -- This clause used to read "submitted_at IS NULL AND expires_at >
          -- now()", which meant a technician who had ALREADY COMPLETED the
          -- survey passed straight through it. Measured on prod 2026-08-13, a
          -- second run of this route would have issued 246 tokens of which
          -- 241 were people who answered on 8/12. The docstring above always
          -- claimed "re-running never double-texts"; now it is true.
          -- A genuine resend is a deliberate act, not a side effect of
          -- re-running issue, and a second text converts at 0% anyway.
          AND NOT EXISTS (
            SELECT 1 FROM vrm_form_tokens ft
            WHERE ft.form_type = 'rental_tech_survey'
              AND upper(ft.ldap) = upper(a.tech_racfid)
          )
        ORDER BY upper(a.tech_racfid), c.days_open DESC NULLS LAST, c.vehicle_number
        LIMIT ${limit}
      `);

      /**
       * Off-roster fallback (2026-08-13).
       *
       * A rehire on a NEW enterprise id is absent from all_techs until the roster
       * feed catches up, so the join above drops them and they are never texted.
       * Luther Erby Cooper sat on an open Enterprise rental this way: TPMS has
       * carried him as LERBYCO since 2026-03-20, while all_techs holds only his
       * 2022 termination under LCOOPER. Neither an identity override nor a
       * confidence change rescues that - the join has nothing to land on.
       *
       * Deliberately narrow. Fires ONLY where the resolver itself concluded
       * "truck (tpms, not on roster)" AND all_techs has no row for the TPMS id at
       * all. Anyone the roster DOES carry keeps their existing verdict, so a
       * terminated, pending or on-leave technician stays excluded exactly as
       * before. Measured against prod 2026-08-13: 3 cases, 0 overlap with the 341
       * already texted.
       *
       * Truck numbers are compared with ltrim because TPMS pads to six ('037275')
       * and the rental feed to five ('37275'). Joining them raw matches nothing
       * and fails silently.
       *
       * The character class is [^0-9] for the same reason spelled out above. Do
       * not write the regex shorthand here.
       */
      const { rows: offRoster } = await db.execute(sql`
        SELECT DISTINCT ON (upper(tp.enterprise_id))
               upper(tp.enterprise_id)                  AS ldap,
               tp.first_name, tp.last_name,
               c.vehicle_number                         AS truck_number,
               -- The enterprise feed does not always carry the RENTING_* keys
               -- (Luther Erby Cooper's row has none), and the parsed columns
               -- always do. Prefill the branch from whichever exists.
               COALESCE(NULLIF(c.feed_json->>'RENTING_CITY_NAME', ''), c.renting_city)  AS branch_city,
               COALESCE(NULLIF(c.feed_json->>'RENTING_STATE', ''), c.renting_state)     AS branch_state,
               c.rental_vendor,
               NULLIF(regexp_replace(COALESCE(tp.mobile_phone,''), '[^0-9]', '', 'g'), '') AS phone
        FROM vrm_rental_operations_cases c
        JOIN vrm_rental_identity_resolutions ir ON ir.case_key = c.case_key
        JOIN tpms_tech_profiles tp
          ON ltrim(tp.truck_no, '0') = ltrim(c.vehicle_number_padded, '0')
        WHERE c.present_in_latest
          AND upper(c.ticket_status) = 'OPEN'
          AND ir.method = 'truck (tpms, not on roster)'
          AND NOT EXISTS (
            SELECT 1 FROM all_techs a2
            WHERE upper(a2.tech_racfid) = upper(tp.enterprise_id)
          )
          -- Same rule as above, and this branch is where the hole was found:
          -- Donta Sims (DSIMS2) was texted and completed the survey on 8/12,
          -- yet came back as a recipient here because his token was submitted
          -- rather than pending. Match on the truck too, because a broken
          -- ldap linkage is the exact failure this branch exists to survive.
          AND NOT EXISTS (
            SELECT 1 FROM vrm_form_tokens ft
            WHERE ft.form_type = 'rental_tech_survey'
              AND (upper(ft.ldap) = upper(tp.enterprise_id)
                OR ltrim(ft.truck_number, '0') = ltrim(c.vehicle_number_padded, '0'))
          )
        ORDER BY upper(tp.enterprise_id), c.days_open DESC NULLS LAST
      `);

      const allRows = [...(rows as any[]), ...(offRoster as any[])];

      const eligible = allRows.filter((r) => {
        const d = String(r.phone || "");
        return d.length === 10 || (d.length === 11 && d.startsWith("1"));
      });
      const noPhone = allRows.length - eligible.length;

      const out: any[] = [];
      for (const r of eligible) {
        const token = dryRun ? "(dry-run)" : newToken();
        // The roster stores names in mixed case (ANGELO, Addison, aDLER), so a raw
        // first name would shout at roughly a third of 345 recipients.
        const raw = String(r.first_name || "").trim().split(/\s+/)[0] || "there";
        const first = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
        const url = `${baseUrl}/rental-survey/${token}`;
        const phone = String(r.phone).replace(/^1/, "");
        out.push({
          ldap: r.ldap,
          name: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim(),
          phone,
          truck_number: r.truck_number,
          branch: [r.branch_city, r.branch_state].filter(Boolean).join(", "),
          token,
          url,
          body:
            `Hi ${first}, this is Tyler with Sears Fleet. Thank you for everything you `
            + `do out there. We are moving every technician rental to direct billing. `
            + `Sears will pay Enterprise directly instead of going through a third `
            + `party, so you will no longer have to call ARI to get a rental. This is `
            + `not a vehicle swap. You keep the vehicle you are driving and it costs `
            + `you nothing.\n\n`
            + `It is VERY important that you complete this form TODAY. It only takes `
            + `one minute: ${url}`
            + ` We are creating the new reservations today and we cannot make yours `
            + `without it. Your LDAP is your Tech Hub login, under Settings. Already `
            + `out of a rental? Tell us there and you are done. Please reply only if `
            + `the form will not work.\n\n`
            + `On behalf of Rob Gerlach, thank you for being the hero of the home.`,
        });

        if (!dryRun) {
          await db.execute(sql`
            INSERT INTO vrm_form_tokens
              (token, form_type, ldap, truck_number, tech_name, phone, prefill, batch, expires_at)
            VALUES (
              ${token}, 'rental_tech_survey', ${r.ldap}, ${r.truck_number},
              ${`${r.first_name ?? ""} ${r.last_name ?? ""}`.trim()}, ${phone},
              ${JSON.stringify({
                rental_truck_number: r.truck_number,
                rental_company: r.rental_vendor,
                branch_city: r.branch_city,
                branch_state: r.branch_state,
              })}::jsonb,
              ${batch}, now() + interval '14 days'
            )
          `);
        }
      }

      res.json({
        dryRun,
        issued: out.length,
        skippedNoPhone: noPhone,
        note: dryRun
          ? "DRY RUN. No tokens written. Re-post with dryRun:false to issue."
          : "Tokens issued. Nothing has been sent.",
        recipients: out,
      });
    } catch (error: any) {
      console.error("[survey] issue failed:", error?.message || error);
      res.status(500).json({ message: error?.message || "Failed to issue tokens." });
    }
  });

  /**
   * Send ONE chunk of survey texts. Caller loops.
   *
   * Chunked at 20 by hard-won experience: the comms endpoint sends
   * sequentially and the deployment kills the request at 30s. A 192-message
   * batch previously returned HTTP 500 after delivering 64 real messages, so
   * it half-sent. Twenty completes in roughly ten seconds.
   *
   * Requires `confirm: true`. COMMS_SEND_LIVE is already true in this
   * environment, so this flag is the only thing between a click and real text
   * messages going to real technicians.
   */
  /**
   * Every live token that has not been texted yet, regardless of which session
   * minted it. Issue only ever returns the tokens IT created, so a console that
   * sends what Issue handed back skips everyone tokened in an earlier session.
   * On 2026-08-12 that would have been 310 of 349 technicians, reported as
   * "Done. 39 of 39 sent."
   */
  /**
   * File a 30-minute route block per confirmed rental holder so they can sign
   * the replacement Enterprise agreement.
   *
   * Safe to re-run. projectName is deterministic (label + truck + date), so a
   * second pass for the same day produces the same name, the route API answers
   * 409, and sendStandardActivity reports it as skipped/not-retryable rather
   * than filing a second block on someone's route.
   *
   * TWO switches must both be on before anything real is filed: this route's
   * `dryRun` must be false AND LUCA_ROUTE_BLOCK_ENABLED must be set. With
   * either off the project name carries a TEST prefix and the receiving system
   * does not process it.
   */
  router.post("/forms/rental-survey/file-route-blocks", requireCronOrStaff, async (req, res) => {
    try {
      const dryRun = req.body?.dryRun !== false;
      const limit = Math.min(Number(req.body?.limit) || 500, 500);
      // Optional: file for these technicians only. Without it the endpoint
      // takes the whole candidate pool, which made a single-technician
      // end-to-end proof impossible through the API.
      const onlyLdaps: string[] = Array.isArray(req.body?.ldaps)
        ? req.body.ldaps.map((x: any) => String(x).trim().toUpperCase()).filter(Boolean)
        : [];
      const date = String(req.body?.date || "").trim() || nextBusinessDayISO();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ message: "date must be YYYY-MM-DD" });
      }
      const live = !dryRun && isRouteBlockLive();

      const { rows } = await db.execute(sql`
        SELECT DISTINCT ON (upper(s.ldap))
               upper(s.ldap)                                   AS ldap,
               s.tech_name,
               COALESCE(NULLIF(btrim(cut.truck_number),''),
                        NULLIF(btrim(s.assigned_truck_number),''),
                        s.truck_number)                        AS truck_number,
               cut.branch_name, cut.branch_address, cut.etd_reference,
               NULLIF(btrim(a.district_no::text),'')           AS unit
        FROM vrm_rental_tech_survey s
        JOIN all_techs a ON upper(a.tech_racfid) = upper(s.ldap)
        -- Reservation first, block second. A block sending a technician to a
        -- branch with no reservation waiting is a wasted trip, so only booked
        -- technicians are candidates, and the branch on the note is the branch
        -- we booked, not the one the survey guessed.
        JOIN vrm_rental_cutover cut
          ON cut.ldap = upper(s.ldap) AND cut.reservation_status = 'booked'
        WHERE s.has_rental
          AND upper(COALESCE(s.ldap,'')) <> 'ZZTEST'
          -- No van_status gate (Tyler, 2026-08-17): every rental on the Holman
          -- book runs the whole flow. van_status says whether the survey could
          -- work out what happened to the VAN; it says nothing about whether
          -- the rental should still bill through Holman. Gating on it stranded
          -- 26 of 71 booked technicians with a reservation and no block.
          AND a.employment_status = 'A'
          AND (${onlyLdaps.length === 0}
               OR upper(s.ldap) = ANY(string_to_array(${onlyLdaps.join(",")}, ',')))
        ORDER BY upper(s.ldap), s.created_at DESC
        LIMIT ${limit}
      `);

      // ONE writer for the tracking row, so a REFUSED block is exactly as
      // visible as a filed one. A refusal that leaves no row lets the
      // technician's previous route-block state stand as though it were still
      // current, which is how a skipped tech becomes an invisible one.
      const trackOutcome = async (r: any, truck: string, o: {
        status: string;
        projectId?: string | null;
        projectName?: string | null;
        filedNow: boolean;
        error?: string | null;
      }) => {
        try {
          await db.execute(sql`
            INSERT INTO vrm_rental_cutover
              (ldap, tech_name, truck_number, route_block_status,
               route_block_project_id, route_block_project_name, route_block_date,
               route_block_live, route_block_filed_at, route_block_error, updated_at)
            VALUES (${r.ldap}, ${r.tech_name ?? null}, ${truck}, ${o.status},
                    ${o.projectId ?? null}, ${o.projectName ?? null}, ${date}::date,
                    ${live}, ${o.filedNow ? sql`now()` : sql`NULL`},
                    ${o.error ?? null}, now())
            ON CONFLICT (ldap) DO UPDATE SET
              tech_name                = COALESCE(EXCLUDED.tech_name, vrm_rental_cutover.tech_name),
              truck_number             = COALESCE(EXCLUDED.truck_number, vrm_rental_cutover.truck_number),
              route_block_status       = EXCLUDED.route_block_status,
              route_block_project_id   = EXCLUDED.route_block_project_id,
              route_block_project_name = EXCLUDED.route_block_project_name,
              route_block_date         = EXCLUDED.route_block_date,
              route_block_live         = EXCLUDED.route_block_live,
              route_block_filed_at     = EXCLUDED.route_block_filed_at,
              route_block_error        = EXCLUDED.route_block_error,
              updated_at               = now()
          `);
        } catch (trackErr: any) {
          // Never let bookkeeping fail a block that was actually filed.
          console.error("[survey] cutover tracking failed for", r.ldap, trackErr?.message);
        }
      };

      const results: any[] = [];
      let filed = 0, skipped = 0, failed = 0;
      for (const r of rows as any[]) {
        const truck = String(r.truck_number || "").trim() || "n/a";
        const unit = String(r.unit || "").trim();

        // ONE decision builds this lane's payload: 08:00 Exact, and the
        // reserved branch's ZIP5 in LocationValue or no filing at all. It lives
        // in cutover-block-args.ts so the tests drive the same code this route
        // does — a rule enforced only inline here is a rule that regresses
        // silently, which is exactly what happened to the 2026-08-14 batch.
        const decision = buildCutoverBlockArgs({
          ldap: r.ldap,
          unit,
          truckNumber: truck,
          branchName: r.branch_name,
          branchAddress: r.branch_address,
          date,
          live,
        });
        if (!decision.ok) {
          failed++;
          await trackOutcome(r, truck, { status: "failed", filedNow: false, error: decision.reason });
          results.push({
            ldap: r.ldap, tech_name: r.tech_name, truck_number: truck, unit,
            ok: false, skipReason: null, projectName: null, projectId: null,
            httpStatus: null, error: decision.reason, reason: decision.reason,
          });
          continue;
        }

        const out = await sendStandardActivity(decision.args);
        if (out.ok) filed++;
        else if (out.skipReason) skipped++;
        else failed++;

        // Tracking. A filed block that leaves no trace outside this response
        // body cannot be reconciled tomorrow, so record it against the
        // technician before moving on.
        const blkStatus = out.ok ? (live ? "filed" : "test")
                        : out.skipReason ? "skipped" : "failed";
        await trackOutcome(r, truck, {
          status: blkStatus,
          projectId: out.projectId ?? null,
          projectName: out.projectName ?? null,
          filedNow: out.ok,
          error: out.errorMessage ?? out.skipReason ?? null,
        });
        results.push({
          ldap: r.ldap, tech_name: r.tech_name, truck_number: truck, unit,
          ok: out.ok, skipReason: out.skipReason ?? null,
          projectName: out.projectName, projectId: out.projectId,
          httpStatus: out.httpStatus, error: out.errorMessage,
        });
      }

      res.json({
        date, dryRun, live,
        note: live
          ? "LIVE. Blocks were filed on real routes."
          : (dryRun
             ? "Dry run. Project names carry a TEST prefix and are not processed."
             : "LUCA_ROUTE_BLOCK_ENABLED is off, so this went out as TEST and will not be processed."),
        candidates: rows.length, filed, skipped, failed,
        results,
      });
    } catch (error: any) {
      console.error("[survey] file-route-blocks failed:", error?.message || error);
      res.status(500).json({ message: error?.message || "file-route-blocks failed" });
    }
  });

  /**
   * Who completed the survey and has NOT yet had the follow-up.
   *
   * "Already had it" is read from the comms log rather than a new column, so
   * this is idempotent with no schema change: the marker phrase only ever
   * appears in the follow-up body.
   */
  router.post("/forms/rental-survey/followup-pending", async (_req, res) => {
    try {
      const { rows } = await db.execute(sql`
        SELECT t.ldap, t.tech_name, t.phone
        FROM vrm_form_tokens t
        WHERE t.form_type = 'rental_tech_survey'
          AND COALESCE(t.batch,'') <> 'TEST'
          AND t.submitted_at IS NOT NULL
          AND NULLIF(btrim(COALESCE(t.phone,'')),'') IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM fs_comms_messages m
            WHERE upper(m.ldap) = upper(t.ldap)
              AND m.body ILIKE '%Thank you for completing the survey%'
          )
        ORDER BY t.ldap
      `);
      res.json({ count: rows.length, recipients: rows });
    } catch (error: any) {
      console.error("[survey] followup-pending failed:", error?.message || error);
      res.status(500).json({ message: error?.message || "followup-pending failed" });
    }
  });

  /**
   * Send the follow-up to at most 20 LDAPs. Requires `confirm: true`.
   *
   * Same single-flight, same DELIVERABLE-status rule as the survey send: a
   * message is only counted as sent when comms reports sent or queued, never
   * from the HTTP status alone.
   */
  router.post("/forms/rental-survey/followup-chunk", async (req, res) => {
    try {
      const confirm = req.body?.confirm === true;
      const ldaps: string[] = Array.isArray(req.body?.ldaps)
        ? req.body.ldaps.map((x: any) => String(x).trim().toUpperCase()).filter(Boolean).slice(0, 20)
        : [];
      if (!ldaps.length) return res.status(400).json({ message: "ldaps[] is required" });

      const key = process.env.COMMS_SEND_API_KEY;
      if (!key) return res.status(500).json({ message: "COMMS_SEND_API_KEY is not configured." });

      const { rows } = await db.execute(sql`
        SELECT DISTINCT ON (upper(t.ldap)) upper(t.ldap) AS ldap, t.tech_name, t.phone
        FROM vrm_form_tokens t
        WHERE t.form_type = 'rental_tech_survey'
          AND COALESCE(t.batch,'') <> 'TEST'
          AND t.submitted_at IS NOT NULL
          AND upper(t.ldap) = ANY(string_to_array(${ldaps.join(",")}, ','))
          AND NULLIF(btrim(COALESCE(t.phone,'')),'') IS NOT NULL
        ORDER BY upper(t.ldap), t.submitted_at DESC
      `);
      const targets = rows as any[];
      if (!targets.length) return res.json({ sent: 0, note: "nothing eligible in this chunk" });

      const messages = targets.map((t) => {
        const raw = String(t.tech_name || "").trim().split(/\s+/)[0] || "there";
        const first = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
        return {
          ldap: t.ldap,
          phone: String(t.phone || "").replace(/[^0-9]/g, "").replace(/^1/, ""),
          category: "rental_management",
          body:
            `Hi ${first}, Tyler with Sears Fleet. Thank you for completing the survey, `
            + `that is exactly what we needed.\n\n`
            + `Here is what happens next. We are creating a new reservation for you and `
            + `blocking time on your route so you can stop by Enterprise and sign a new `
            + `contract at our final rate. You will hear from us with those details `
            + `before you need to do anything.\n\n`
            + `Very soon a new process goes out to the field and you will no longer have `
            + `to contact ARI. Thank you again for helping us get this done.`,
        };
      });

      if (!confirm) {
        return res.json({ dryRun: true, would_send: messages.length, messages });
      }

      const selfPort = process.env.PORT || "5000";
      const host = process.env.COMMS_SEND_BASE_URL || `http://localhost:${selfPort}`;
      const resp = await fetch(`${host}/api/fs/comms/api/send-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-comms-api-key": key },
        body: JSON.stringify({ category: "rental_management", messages, confirm: true }),
      });
      const ctype = resp.headers.get("content-type") || "";
      if (!ctype.includes("application/json")) {
        return res.status(502).json({
          message: `comms returned ${resp.status} ${ctype || "no content-type"} — not JSON.`,
        });
      }
      const out = await resp.json();
      if (!resp.ok) return res.status(502).json({ message: "comms rejected the batch", detail: out });

      const DELIVERABLE = new Set(["sent", "queued"]);
      const results = (out?.results || out?.commsResult?.results || []) as any[];
      const good = results.filter((r) => DELIVERABLE.has(String(r?.status || "").toLowerCase()));
      res.json({ sent: good.length, attempted: messages.length, commsResult: out });
    } catch (error: any) {
      console.error("[survey] followup-chunk failed:", error?.message || error);
      res.status(500).json({ message: error?.message || "followup-chunk failed" });
    }
  });

  /**
   * Repair sent_at from the comms log.
   *
   * A rejected batch can still have delivered part of itself, and the stamp
   * only runs after the whole batch returns, so those recipients keep
   * sent_at NULL forever: under-counted on the dashboard and re-texted by the
   * next send. This reconciles from proof of delivery.
   *
   * Matches on the TOKEN appearing in the message body, not on the LDAP, so a
   * technician who holds two tokens cannot have the wrong one stamped. Only
   * ever sets a NULL stamp; never clears one.
   */
  router.post("/forms/rental-survey/reconcile-sent", async (req, res) => {
    try {
      const confirm = req.body?.confirm === true;

      const { rows: candidates } = await db.execute(sql`
        SELECT tk.id, tk.ldap, tk.tech_name,
               min(m.created_at)                AS first_message_at,
               bool_or(tk.submitted_at IS NOT NULL) AS answered
        FROM vrm_form_tokens tk
        JOIN fs_comms_messages m
          ON m.created_at > now() - interval '30 days'
         AND position(tk.token in m.body) > 0
        WHERE tk.form_type = 'rental_tech_survey'
          AND tk.sent_at IS NULL
        GROUP BY tk.id, tk.ldap, tk.tech_name
        ORDER BY tk.ldap
      `);

      if (!confirm) {
        return res.json({
          dryRun: true,
          would_stamp: candidates.length,
          note: "Nothing written. Re-post with confirm:true to apply.",
          candidates,
        });
      }

      const { rows: updated } = await db.execute(sql`
        UPDATE vrm_form_tokens t
        SET sent_at = sub.first_message_at
        FROM (
          SELECT tk.id, min(m.created_at) AS first_message_at
          FROM vrm_form_tokens tk
          JOIN fs_comms_messages m
            ON m.created_at > now() - interval '30 days'
           AND position(tk.token in m.body) > 0
          WHERE tk.form_type = 'rental_tech_survey'
            AND tk.sent_at IS NULL
          GROUP BY tk.id
        ) sub
        WHERE t.id = sub.id
          AND t.sent_at IS NULL
        RETURNING t.ldap, t.sent_at
      `);

      res.json({ stamped: updated.length, rows: updated });
    } catch (error: any) {
      console.error("[survey] reconcile-sent failed:", error?.message || error);
      res.status(500).json({ message: error?.message || "reconcile-sent failed" });
    }
  });

  router.post("/forms/rental-survey/pending", async (_req, res) => {
    try {
      const { rows } = await db.execute(sql`
        SELECT token, ldap, tech_name, phone, truck_number
        FROM vrm_form_tokens
        WHERE form_type = 'rental_tech_survey'
          AND sent_at IS NULL
          AND submitted_at IS NULL
          AND expires_at > now()
          AND COALESCE(batch, '') <> 'TEST'
        ORDER BY ldap
      `);
      res.json({ count: rows.length, tokens: rows });
    } catch (error: any) {
      console.error("[survey] pending failed:", error?.message || error);
      res.status(500).json({ message: error?.message || "pending failed" });
    }
  });

  router.post("/forms/rental-survey/send-chunk", async (req, res) => {
    try {
      const confirm = req.body?.confirm === true;
      const tokens: string[] = Array.isArray(req.body?.tokens) ? req.body.tokens.slice(0, 20) : [];
      if (!tokens.length) return res.status(400).json({ message: "No tokens supplied." });

      const key = process.env.COMMS_SEND_API_KEY;
      if (!key) return res.status(500).json({ message: "COMMS_SEND_API_KEY is not configured." });

      // Single-flight. Two overlapping send-chunk calls would both see the same
      // tokens as unsent and text the same technicians twice. The advisory lock
      // is session-scoped and released in the finally below.
      const LOCK = 918273645;
      const { rows: lk } = await db.execute(sql`SELECT pg_try_advisory_lock(${LOCK}) AS got`);
      if (!(lk as any[])[0]?.got) {
        return res.status(409).json({ message: "A send is already running. Wait for it to finish." });
      }
      try {

      // Tokens go in as ONE comma-joined string and are split in SQL. Passing
      // the JS array straight to ANY() makes Postgres answer "malformed array
      // literal", which is why send-chunk had never once executed. Hex-only
      // filter first, so the join stays unambiguous and nothing else rides in.
      const tokenList = (tokens as any[])
        .map((x) => String(x).trim())
        .filter((x) => /^[0-9a-fA-F]{16,64}$/.test(x));
      if (!tokenList.length) {
        return res.json({ sent: 0, skipped: (tokens as any[]).length, note: "no well-formed tokens in this chunk" });
      }
      const { rows } = await db.execute(sql`
        SELECT token, ldap, phone, tech_name
        FROM vrm_form_tokens
        WHERE form_type = 'rental_tech_survey'
          AND token = ANY(string_to_array(${tokenList.join(",")}, ','))
          AND sent_at IS NULL
          AND submitted_at IS NULL
          AND expires_at > now()
      `);
      const targets = rows as any[];
      if (!targets.length) return res.json({ sent: 0, skipped: tokens.length, note: "nothing eligible in this chunk" });

      const base = String(req.body?.baseUrl || "https://SHS-Nexus.replit.app").replace(/\/+$/, "");
      const messages = targets.map((t) => {
        const raw = String(t.tech_name || "").trim().split(/\s+/)[0] || "there";
        const first = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
        return {
          ldap: t.ldap,
          phone: String(t.phone || "").replace(/\D/g, "").replace(/^1/, ""),
          category: "rental_management",
          body:
            `Hi ${first}, this is Tyler with Sears Fleet. Thank you for everything you `
            + `do out there. We are moving every technician rental to direct billing. `
            + `Sears will pay Enterprise directly instead of going through a third `
            + `party, so you will no longer have to call ARI to get a rental. This is `
            + `not a vehicle swap. You keep the vehicle you are driving and it costs `
            + `you nothing.\n\n`
            + `It is VERY important that you complete this form TODAY. It only takes `
            + `one minute: ${base}/rental-survey/${t.token}`
            + ` We are creating the new reservations today and we cannot make yours `
            + `without it. Your LDAP is your Tech Hub login, under Settings. Already `
            + `out of a rental? Tell us there and you are done. Please reply only if `
            + `the form will not work.\n\n`
            + `On behalf of Rob Gerlach, thank you for being the hero of the home.`,
        };
      });

      // category matters: replies inherit the THREAD's category, so anything
      // other than rental_management lands where this tracker cannot see it.
      const payload: Record<string, unknown> = { category: "rental_management", messages };
      if (confirm) payload.confirm = true; else payload.dryRun = true;

      // Loopback to OUR OWN port, not a literal 5000. server/index.ts binds
      // process.env.PORT and the deployment sets it, so a hardcoded 5000 would
      // quietly connect to nothing in prod: every send would fail with
      // ECONNREFUSED AFTER the tokens had already been minted, leaving the
      // batch half-issued and nothing sent.
      const selfPort = process.env.PORT || "5000";
      const host = process.env.COMMS_SEND_BASE_URL || `http://localhost:${selfPort}`;
      const resp = await fetch(`${host}/api/fs/comms/api/send-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-comms-api-key": key },
        body: JSON.stringify(payload),
      });
      const ctype = resp.headers.get("content-type") || "";
      if (!ctype.includes("application/json")) {
        // The SPA fallback answers 200 with HTML, which reads exactly like a
        // missing route. Treat a non-JSON body as a failure, never a success.
        return res.status(502).json({
          message: `comms returned ${resp.status} ${ctype || "no content-type"} — not JSON. Route or host wrong.`,
        });
      }
      const out = await resp.json();
      if (!resp.ok) return res.status(502).json({ message: "comms rejected the batch", detail: out });

      // Trust the per-message results, not the HTTP status. comms answers 200
      // while individually skipping opt-outs and unusable numbers, so stamping
      // the whole chunk would mark people as texted who never were — and the
      // eligibility query filters on sent_at IS NULL, so they would never be
      // retried either.
      //
      // 'queued' counts as sent: TCPA quiet hours hold it (West Coast and
      // Hawaii before 8am local) but it does go out. Anything else does not.
      const results: any[] = Array.isArray(out?.results) ? out.results : [];
      const DELIVERABLE = new Set(["sent", "queued"]);
      const byLdap = new Map<string, string>();
      for (const r of results) {
        byLdap.set(String(r?.ldap || "").toUpperCase(), String(r?.status || "").toLowerCase());
      }
      // No results array at all means we cannot tell who went out. Stamping
      // nothing is the recoverable failure; stamping everything is not.
      const actuallySent = results.length
        ? targets.filter((t) => DELIVERABLE.has(byLdap.get(String(t.ldap).toUpperCase()) ?? ""))
        : [];
      const notSent = targets.filter((t) => !actuallySent.includes(t));

      if (confirm && actuallySent.length) {
        await db.execute(sql`
          UPDATE vrm_form_tokens SET sent_at = now()
          WHERE token = ANY(string_to_array(${actuallySent.map((t: any) => String(t.token)).join(",")}, ','))
        `);
      }

      res.json({
        dryRun: !confirm,
        attempted: messages.length,
        sent: confirm ? actuallySent.length : 0,
        notSent: confirm ? notSent.length : messages.length,
        // Named so a caller can see WHY someone did not go out rather than
        // just that the count came up short.
        notSentDetail: confirm
          ? notSent.map((t) => ({ ldap: t.ldap, status: byLdap.get(String(t.ldap).toUpperCase()) ?? "no result returned" }))
          : undefined,
        commsResult: out,
      });
      } finally {
        await db.execute(sql`SELECT pg_advisory_unlock(${LOCK})`);
      }
    } catch (error: any) {
      console.error("[survey] send-chunk failed:", error?.message || error);
      res.status(500).json({ message: error?.message || "send-chunk failed" });
    }
  });

  /**
   * The reservation-ready view: everyone still in a rental who gave us a branch.
   * This is the list that feeds ETD booking, which is why branch city/state are
   * required fields on the form rather than nice-to-haves.
   */
  router.get("/forms/rental-survey/reservation-queue", async (_req, res) => {
    try {
      const { rows } = await db.execute(sql`
        SELECT ldap, tech_name,
               COALESCE(assigned_truck_number, truck_number) AS truck_number,
               rental_company, rental_vehicle_desc,
               rental_branch_name, rental_branch_city, rental_branch_state, rental_branch_phone,
               truck_mismatch, van_status, promised_ready_date, created_at
        FROM vrm_rental_tech_survey
        WHERE has_rental
          AND rental_branch_city IS NOT NULL
        ORDER BY rental_branch_state, rental_branch_city, tech_name
      `);
      res.json({ queue: rows });
    } catch (error: any) {
      console.error("[survey] reservation queue failed:", error?.message || error);
      res.status(500).json({ message: "Failed to load reservation queue." });
    }
  });

  /**
   * Record what the ETD booker did. Called by scripts/book_cutover.py once per
   * technician so the reservation exists somewhere other than a local file.
   *
   * Upsert on LDAP: re-running the booker corrects the row rather than
   * duplicating it, and a later route block lands on the same row.
   */
  /**
   * AMS mirror push. A local runner reads LIVHR raw_ams (the ruled source;
   * Nexus cannot reach that database) and posts rows here. Batch upsert on
   * the normalized truck number; safe to re-run any time.
   */
  router.post("/forms/rental-survey/ams-status", async (req, res) => {
    try {
      const items = Array.isArray(req.body?.rows) ? req.body.rows : [];
      if (!items.length) return res.status(400).json({ message: "rows[] required" });
      let upserted = 0;
      for (const it of items) {
        const norm = String(it?.truck_number ?? "").replace(/\D/g, "").replace(/^0+/, "");
        if (!norm) continue;
        await db.execute(sql`
          INSERT INTO vrm_ams_status
            (truck_norm, truck_number, truck_status_name, in_repair, repair_status,
             svc_reason, disposition, tech_ldap, tech_name, outof_svc_date,
             sale_date, cur_loc_city, cur_loc_state, ams_synced_at, pushed_at)
          VALUES (${norm}, ${String(it?.truck_number ?? "")},
                  ${it?.truck_status_name ?? null}, ${it?.in_repair ?? null},
                  ${it?.repair_status ?? null}, ${it?.svc_reason ?? null},
                  ${it?.disposition ?? null}, ${it?.tech_ldap ?? null},
                  ${it?.tech_name ?? null}, ${it?.outof_svc_date ?? null},
                  ${it?.sale_date ?? null}, ${it?.cur_loc_city ?? null},
                  ${it?.cur_loc_state ?? null}, ${it?.ams_synced_at ?? null}, now())
          ON CONFLICT (truck_norm) DO UPDATE SET
            truck_number      = EXCLUDED.truck_number,
            truck_status_name = EXCLUDED.truck_status_name,
            in_repair         = EXCLUDED.in_repair,
            repair_status     = EXCLUDED.repair_status,
            svc_reason        = EXCLUDED.svc_reason,
            disposition       = EXCLUDED.disposition,
            tech_ldap         = EXCLUDED.tech_ldap,
            tech_name         = EXCLUDED.tech_name,
            outof_svc_date    = EXCLUDED.outof_svc_date,
            sale_date         = EXCLUDED.sale_date,
            cur_loc_city      = EXCLUDED.cur_loc_city,
            cur_loc_state     = EXCLUDED.cur_loc_state,
            ams_synced_at     = EXCLUDED.ams_synced_at,
            pushed_at         = now()
        `);
        upserted++;
      }
      res.json({ upserted });
    } catch (error: any) {
      console.error("[survey] ams-status failed:", error?.message || error);
      res.status(500).json({ message: error?.message || "ams-status failed" });
    }
  });

  router.post("/forms/rental-survey/record-booking", async (req, res) => {
    try {
      const items = Array.isArray(req.body?.results) ? req.body.results : [];
      if (!items.length) return res.status(400).json({ message: "results[] required" });

      let recorded = 0;
      for (const it of items) {
        const ldap = String(it?.ldap || "").trim().toUpperCase();
        if (!ldap) continue;
        const status = it?.error ? "failed" : (it?.etd_reference ? "booked" : "validated");

        // A runner outside the box (ETD credentials live on Tyler's machine)
        // can also file route blocks; without this the page reports
        // "reserved, no route block" about blocks that exist.
        if (it?.route_block_status) {
          await db.execute(sql`
            INSERT INTO vrm_rental_cutover (ldap, route_block_status,
              route_block_project_id, route_block_project_name, route_block_date,
              route_block_live, route_block_filed_at, route_block_error, updated_at)
            VALUES (${ldap}, ${String(it.route_block_status)},
              ${it?.route_block_project_id ?? null}, ${it?.route_block_project_name ?? null},
              ${it?.route_block_date ?? null},
              ${it?.route_block_live ?? null},
              ${String(it.route_block_status) === "filed" ? sql`now()` : sql`NULL`},
              ${it?.route_block_error ?? null}, now())
            ON CONFLICT (ldap) DO UPDATE SET
              route_block_status       = EXCLUDED.route_block_status,
              route_block_project_id   = EXCLUDED.route_block_project_id,
              route_block_project_name = EXCLUDED.route_block_project_name,
              route_block_date         = EXCLUDED.route_block_date,
              route_block_live         = EXCLUDED.route_block_live,
              route_block_filed_at     = COALESCE(vrm_rental_cutover.route_block_filed_at, EXCLUDED.route_block_filed_at),
              route_block_error        = EXCLUDED.route_block_error,
              updated_at               = now()
          `);
          recorded++;
          if (!it?.etd_reference && !it?.error) continue;
        }
        await db.execute(sql`
          INSERT INTO vrm_rental_cutover
            (ldap, tech_name, truck_number, van_status, reservation_status,
             etd_reference, etd_reservation_id, branch_code_wanted, branch_code_booked,
             branch_pinned, branch_name, branch_address, vehicle_class,
             reservation_start, reservation_end, reserved_at, reservation_error, updated_at)
          VALUES (${ldap}, ${it?.tech_name ?? null}, ${it?.truck_number ?? null},
                  ${it?.van_status ?? null}, ${status},
                  ${it?.etd_reference ?? null}, ${it?.etd_reservation_id ?? null},
                  ${it?.branch_code_wanted ?? null}, ${it?.branch_code_booked ?? null},
                  ${it?.branch_pinned ?? null}, ${it?.branch_name ?? null},
                  ${it?.branch_address ?? null}, ${it?.vehicle_class ?? null},
                  ${it?.start ?? null}, ${it?.end ?? null},
                  ${status === "booked" ? sql`now()` : sql`NULL`},
                  ${it?.error ?? null}, now())
          ON CONFLICT (ldap) DO UPDATE SET
            tech_name          = COALESCE(EXCLUDED.tech_name, vrm_rental_cutover.tech_name),
            truck_number       = COALESCE(EXCLUDED.truck_number, vrm_rental_cutover.truck_number),
            van_status         = COALESCE(EXCLUDED.van_status, vrm_rental_cutover.van_status),
            reservation_status = EXCLUDED.reservation_status,
            etd_reference      = COALESCE(EXCLUDED.etd_reference, vrm_rental_cutover.etd_reference),
            etd_reservation_id = COALESCE(EXCLUDED.etd_reservation_id, vrm_rental_cutover.etd_reservation_id),
            branch_code_wanted = EXCLUDED.branch_code_wanted,
            branch_code_booked = EXCLUDED.branch_code_booked,
            branch_pinned      = EXCLUDED.branch_pinned,
            branch_name        = EXCLUDED.branch_name,
            branch_address     = EXCLUDED.branch_address,
            vehicle_class      = EXCLUDED.vehicle_class,
            reservation_start  = EXCLUDED.reservation_start,
            reservation_end    = EXCLUDED.reservation_end,
            reserved_at        = COALESCE(vrm_rental_cutover.reserved_at, EXCLUDED.reserved_at),
            reservation_error  = EXCLUDED.reservation_error,
            updated_at         = now()
        `);
        recorded++;
      }
      res.json({ recorded });
    } catch (error: any) {
      console.error("[survey] record-booking failed:", error?.message || error);
      res.status(500).json({ message: error?.message || "record-booking failed" });
    }
  });

  /**
   * The cutover scoreboard: COMPLETE records only.
   *
   * A row appears here only after BOTH steps have really happened — the ETD
   * reservation is booked AND the route block is filed live. Per Tyler
   * (2026-08-13): the tracking must be blank until then; it must NOT seed a
   * line for every surveyed technician. A previous version drove this from
   * the survey table (LEFT JOIN to tracking) so every surveyed tech appeared
   * as "surveyed only" — that pool view was never the intent of this page.
   * "Who is surveyed but not yet reserved" is the reservation queue's job.
   */
  router.get("/forms/rental-survey/cutover-status", async (_req, res) => {
    try {
      const { rows } = await db.execute(sql`
        SELECT c.ldap, c.tech_name, c.truck_number, c.van_status,
               s.rental_branch_city, s.rental_branch_state, s.surveyed_at,
               s.shop_name, s.shop_city, s.shop_state, s.shop_phone,
               s.promised_ready_date, s.rental_company, s.rental_vehicle_desc,
               c.reservation_status,
               c.etd_reference, c.branch_name, c.branch_pinned, c.vehicle_class,
               c.reserved_at, c.reservation_error,
               c.route_block_status,
               c.route_block_project_name, c.route_block_date, c.route_block_live,
               c.route_block_filed_at, c.route_block_error,
               'complete' AS stage,
               sup.district, sup.supervisor_name, sup.supervisor_ldap, sup.supervisor_phone
        FROM vrm_rental_cutover c
        LEFT JOIN LATERAL (
          SELECT NULLIF(btrim(a2.district_no::text),'') AS district,
                 ma.tech_name  AS supervisor_name,
                 upper(tp2.tech_manager_ldap_id) AS supervisor_ldap,
                 COALESCE(mgp.mobile_phone, ma.cell_phone, ma.main_phone) AS supervisor_phone
          FROM (SELECT 1) one
          LEFT JOIN LATERAL (SELECT a.district_no FROM all_techs a
                             WHERE upper(a.tech_racfid) = upper(c.ldap)
                             ORDER BY (a.employment_status='A') DESC LIMIT 1) a2 ON TRUE
          LEFT JOIN LATERAL (SELECT t.tech_manager_ldap_id FROM tpms_tech_profiles t
                             WHERE upper(t.enterprise_id) = upper(c.ldap)
                             ORDER BY t.synced_at DESC NULLS LAST LIMIT 1) tp2 ON TRUE
          LEFT JOIN LATERAL (SELECT a.tech_name, a.cell_phone, a.main_phone FROM all_techs a
                             WHERE upper(a.tech_racfid) = upper(COALESCE(tp2.tech_manager_ldap_id,''))
                             ORDER BY (a.employment_status='A') DESC LIMIT 1) ma ON TRUE
          LEFT JOIN LATERAL (SELECT t.mobile_phone FROM tpms_tech_profiles t
                             WHERE upper(t.enterprise_id) = upper(COALESCE(tp2.tech_manager_ldap_id,''))
                             LIMIT 1) mgp ON TRUE
        ) sup ON TRUE
        LEFT JOIN LATERAL (
          SELECT s.rental_branch_city, s.rental_branch_state, s.created_at AS surveyed_at,
                 s.shop_name, s.shop_city, s.shop_state, s.shop_phone,
                 s.promised_ready_date, s.rental_company, s.rental_vehicle_desc
          FROM vrm_rental_tech_survey s
          WHERE upper(s.ldap) = upper(c.ldap)
          ORDER BY s.created_at DESC
          LIMIT 1
        ) s ON true
        WHERE c.reservation_status = 'booked'
          AND c.route_block_status = 'filed'
          AND c.route_block_live IS TRUE
        ORDER BY c.ldap
      `);

      const tally = (key: string) => {
        const out: Record<string, number> = {};
        for (const r of rows as any[]) {
          const k = String((r as any)[key] ?? "pending");
          out[k] = (out[k] || 0) + 1;
        }
        return out;
      };

      res.json({
        total: rows.length,
        by_stage: tally("stage"),
        by_reservation: tally("reservation_status"),
        by_route_block: tally("route_block_status"),
        rows,
      });
    } catch (error: any) {
      console.error("[survey] cutover-status failed:", error?.message || error);
      res.status(500).json({ message: error?.message || "cutover-status failed" });
    }
  });

  // End-to-end cutover workflow intents (task #646): intent-owned booking,
  // block filing, messaging and readbacks. Registered last — the module owns
  // everything under /forms/rental-survey/cutover/* plus the rental-request
  // parity lane.
  registerCutoverIntentRoutes(router);
}
