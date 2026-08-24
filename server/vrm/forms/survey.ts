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
import { getEtdToken, describeEtdToken } from "../etd/token";
import { sql } from "drizzle-orm";
import crypto from "crypto";
import { sendStandardActivity } from "../dca-task-client";
import { isRouteBlockLive } from "../rental-operations/schedule-pickup";
import { requireCronOrStaff, requireStaffSession } from "./cutover-intents-routes";
import { registerCutoverIntentRoutes } from "./cutover-intents-routes";
import { buildCutoverBlockArgs } from "./cutover-block-args";
import { anchorCutoverRow } from "./cutover-anchor";
import { runMsg1ConfirmationBackfill } from "./msg1-confirmation-backfill";

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
               tpt.tpms_truck_number,
               -- Tyler 2026-08-20: the survey page drops technicians who have left
               -- the Holman rental book. '' means off the book entirely.
               COALESCE(hb.book_state, '') AS holman_book_state
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
        -- Tyler 2026-08-20: is this technician still on the Holman rental book?
        -- Derived at read time from the feed, never a row delete: the response
        -- stays for audit and the page hides an off-book row by default.
        LEFT JOIN LATERAL (
          SELECT CASE
                   WHEN bool_or(upper(COALESCE(c2.ticket_status, '')) = 'OPEN')   THEN 'open'
                   WHEN bool_or(upper(COALESCE(c2.ticket_status, '')) = 'PENDED') THEN 'pended'
                   ELSE ''
                 END AS book_state
          FROM vrm_rental_operations_cases c2
          WHERE c2.present_in_latest
            AND upper(COALESCE(c2.rental_vendor, '')) LIKE 'ENTERPRISE%'
            AND (
              upper(COALESCE(c2.enterprise_id_feed, '')) = upper(r.ldap)
              OR NULLIF(ltrim(regexp_replace(COALESCE(c2.vehicle_number, ''), '[^0-9]', '', 'g'), '0'), '')
                 IN (
                   COALESCE(tpt.tpms_truck_number, '~'),
                   COALESCE(NULLIF(ltrim(regexp_replace(COALESCE(r.assigned_truck_number, ''), '[^0-9]', '', 'g'), '0'), ''), '~'),
                   COALESCE(NULLIF(ltrim(regexp_replace(COALESCE(r.truck_number, ''), '[^0-9]', '', 'g'), '0'), ''), '~'),
                   COALESCE(NULLIF(ltrim(regexp_replace(COALESCE(r.rental_truck_number, ''), '[^0-9]', '', 'g'), '0'), ''), '~')
                 )
            )
        ) hb ON TRUE
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

  /**
   * MANDATORY reminder to everyone who was issued a survey token and never
   * submitted it. This is the ONLY resend path: `send-chunk` filters on
   * `sent_at IS NULL`, so it is structurally incapable of reaching a
   * non-responder, and `issue` refuses anyone who already holds a token.
   *
   * Wording is deliberately different from first contact (Tyler, 2026-08-18).
   * The first message asked; this one states a requirement, and it closes the
   * loophole the first one left open: a technician who is no longer in a rental
   * assumed the form did not apply to them, when their silence is exactly what
   * keeps the agreement open and billing.
   *
   * DOES NOT SEND unless `confirm: true`. Defaults to a dry run that returns the
   * full recipient list and the exact rendered body, same contract as `issue`.
   * `scheduledFor` defaults to the next 08:00 ET; the recipient's own
   * quiet-hours floor still applies on top, so nobody west of Eastern gets it
   * before 07:00 local.
   */
  router.post("/forms/rental-survey/remind", requireCronOrStaff, async (req, res) => {
    try {
      const confirm = req.body?.confirm === true;
      const base = String(req.body?.baseUrl || "https://SHS-Nexus.replit.app").replace(/\/+$/, "");
      const limit = Math.min(Number(req.body?.limit) || 500, 500);
      // Per-LDAP phone corrections for the handful whose number of record is
      // provably wrong. Passed explicitly rather than guessed: a silent
      // re-resolve would quietly move numbers we have evidence are working.
      const overrides: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.body?.phoneOverrides ?? {})) {
        const d = String(v).replace(/\D/g, "").replace(/^1/, "");
        if (d.length === 10) overrides[String(k).toUpperCase()] = d;
      }
      const onlyLdaps: string[] = Array.isArray(req.body?.ldaps)
        ? req.body.ldaps.map((x: any) => String(x).trim().toUpperCase()).filter(Boolean)
        : [];

      let scheduledFor: Date;
      if (req.body?.scheduledFor) {
        const d = new Date(String(req.body.scheduledFor));
        if (Number.isNaN(d.getTime())) {
          return res.status(400).json({ message: "scheduledFor must be a parseable date/time" });
        }
        scheduledFor = d;
      } else {
        // Next 08:00 America/New_York. -04:00 is EDT; this route is a
        // same-week operational tool, not a date library.
        const now = new Date();
        const et = new Date(now.getTime() - 4 * 3600 * 1000);
        const y = et.getUTCFullYear(), mo = et.getUTCMonth(), da = et.getUTCDate();
        scheduledFor = new Date(Date.UTC(y, mo, da, 12, 0, 0)); // 08:00 ET
        if (scheduledFor.getTime() <= now.getTime()) {
          scheduledFor = new Date(scheduledFor.getTime() + 24 * 3600 * 1000);
        }
      }

      // Roster status is re-read HERE, not trusted from issue time. A token minted
      // on 8/12 to an active technician does not stay valid as a mandate after they
      // go on leave, and `issue` already states the rule this inherits: someone
      // terminated or on leave holding an open rental is a recovery case for a
      // human, not a survey. Observed live: SWHITAK moved to status 'L' between
      // issue and the first reminder and would have been told "I need it from you
      // today". `includeInactive: true` is the deliberate override.
      const includeInactive = req.body?.includeInactive === true;
      const { rows } = await db.execute(sql`
        SELECT t.token, t.ldap, t.phone, t.tech_name, t.truck_number, t.sent_at,
               COALESCE(a.employment_status, '?') AS employment_status
          FROM vrm_form_tokens t
          LEFT JOIN LATERAL (
            SELECT employment_status FROM all_techs
             WHERE upper(tech_racfid) = upper(t.ldap)
             ORDER BY (employment_status = 'A') DESC,
                      effective_date DESC NULLS LAST,
                      synced_at DESC NULLS LAST
             LIMIT 1
          ) a ON true
         WHERE t.form_type = 'rental_tech_survey'
           AND t.submitted_at IS NULL
           AND COALESCE(t.batch, '') <> 'TEST'
           AND upper(COALESCE(t.ldap, '')) <> 'ZZTEST'
           AND t.expires_at > now()
         ORDER BY t.ldap
         LIMIT ${limit}
      `);

      const recipients = (rows as any[])
        .filter((t) => !onlyLdaps.length || onlyLdaps.includes(String(t.ldap).toUpperCase()))
        .map((t) => {
          const raw = String(t.tech_name || "").trim().split(/\s+/)[0] || "there";
          const first = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
          const ldap = String(t.ldap || "").toUpperCase();
          const phone = overrides[ldap] ?? String(t.phone || "").replace(/\D/g, "").replace(/^1/, "");
          const url = `${base}/rental-survey/${t.token}`;
          return {
            ldap,
            name: String(t.tech_name || "").trim(),
            truck_number: t.truck_number,
            phone,
            phoneCorrected: !!overrides[ldap],
            neverSentFirstTime: t.sent_at == null,
            employmentStatus: t.employment_status,
            category: "rental_management",
            body:
              `${first}, this is Tyler with Sears Fleet. This one is a requirement, not a `
              + `request, and I need it from you today.\n\n`
              + `Our records still show you in an Enterprise rental. Every technician on that `
              + `report has to confirm their status before we can finish moving these rentals `
              + `to Sears direct billing. It takes one minute: ${url}\n\n`
              + `If you are NO LONGER in a rental, you still have to complete it. You are on `
              + `the report either way, and your answer is the only thing that lets us close `
              + `that agreement out. Until you do, it stays open and billing against Sears.\n\n`
              + `Your LDAP is your Tech Hub login ID. Reply here only if the form will not `
              + `open.`,
          };
        })
        .filter((r) => r.phone.length === 10);

      const skippedNoPhone =
        (rows as any[]).length -
        (rows as any[]).filter((t) => {
          const ldap = String(t.ldap || "").toUpperCase();
          const ph = overrides[ldap] ?? String(t.phone || "").replace(/\D/g, "").replace(/^1/, "");
          return ph.length === 10;
        }).length;

      const inactive = recipients.filter((r) => r.employmentStatus !== "A");
      const sendList = includeInactive ? recipients : recipients.filter((r) => r.employmentStatus === "A");

      if (!confirm) {
        return res.json({
          dryRun: true,
          scheduledFor: scheduledFor.toISOString(),
          eligible: (rows as any[]).length,
          willSend: sendList.length,
          skippedNoPhone,
          skippedNotActive: includeInactive ? 0 : inactive.length,
          notActive: inactive.map((r) => ({ ldap: r.ldap, name: r.name, employmentStatus: r.employmentStatus })),
          note: "Nothing was sent. Re-POST with {confirm:true} to schedule.",
          recipients: sendList,
        });
      }

      const key = process.env.COMMS_SEND_API_KEY;
      if (!key) return res.status(500).json({ message: "COMMS_SEND_API_KEY is not configured." });
      // Path and header BOTH matter, and getting either wrong fails silently. The
      // comms router is mounted under /api/fs, and the gate reads x-comms-api-key.
      // A wrong path does not 404: the SPA fallback answers 200 with HTML, so a
      // bare `.json().catch(() => ({}))` turns a total non-send into a clean-looking
      // success. That is exactly what happened on the first live run of this route
      // (2026-08-18): it reported requested:55 and queued nothing. Treat a non-JSON
      // body as failure, never as success.
      const selfPort = process.env.PORT || "5000";
      const host = process.env.COMMS_SEND_BASE_URL || `http://localhost:${selfPort}`;
      const resp = await fetch(`${host}/api/fs/comms/api/send-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-comms-api-key": key },
        body: JSON.stringify({
          category: "rental_management",
          confirm: true,
          scheduledFor: scheduledFor.toISOString(),
          // phoneLocked ONLY where a correction was actually supplied.
          //
          // send-batch resolves the destination from the LDAP and IGNORES an explicit
          // `phone` unless phoneLocked is set, so `phoneOverrides` was inert: the
          // 2026-08-18 reminder delivered PDOWDY at 317-974-0195 and TOMALI at
          // 616-211-4183, the exact numbers the override existed to replace.
          //
          // Locking ALL of them would be the wrong fix. LDAP resolution reads
          // fs_comms_contacts, which is the maintained directory and was RIGHT for the
          // other 52 - it is why JSTILL0 got a working number and answered. Lock only
          // the rows a human deliberately corrected, and let the directory serve the rest.
          messages: sendList.map((r) => ({
            ldap: r.ldap,
            phone: r.phone,
            ...(r.phoneCorrected ? { phoneLocked: true } : {}),
            body: r.body,
          })),
        }),
      });
      const ctype = resp.headers.get("content-type") || "";
      if (!ctype.includes("application/json")) {
        return res.status(502).json({
          message: `comms returned ${resp.status} ${ctype || "no content-type"} - not JSON. Route or host wrong. NOTHING was scheduled.`,
        });
      }
      const result = await resp.json();
      if (!resp.ok) {
        return res.status(502).json({ message: "comms rejected the batch; nothing scheduled", detail: result });
      }
      // Report what the queue actually accepted, not what we asked for.
      const DELIVERABLE = new Set(["sent", "queued"]);
      const rlist = (result?.results || []) as any[];
      const accepted = rlist.filter((r) => DELIVERABLE.has(String(r?.status || "").toLowerCase())).length;
      res.json({
        dryRun: false,
        scheduledFor: scheduledFor.toISOString(),
        requested: sendList.length,
        accepted,
        skippedNotActive: includeInactive ? 0 : inactive.length,
        summary: result?.summary ?? null,
        result,
      });
    } catch (error: any) {
      console.error("[survey] remind failed:", error?.message || error);
      res.status(500).json({ message: error?.message || "remind failed" });
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
            + `without it. Your LDAP is your Tech Hub login ID. Already `
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
  /**
   * Make sure a usable ETD token exists in the shared store, and say what is there.
   *
   * WHY THIS EXISTS
   * ---------------
   * Minting drives a real browser through Azure B2C, so it can only happen on a host
   * with Chromium. The Replit box has neither the browsers nor the system libraries
   * (`etd_token.py preflight` reports ETD_CHROMIUM_PATH unset), which means every
   * runner on the box depends on the SERVER having minted into `vrm_etd_token`
   * first - and the server only mints as a side effect of some other ETD call.
   *
   * When the queue is empty there is no such call, so a token cannot be obtained at
   * all: the morning sweep returns "no calls", the executor claims 0 intents, and the
   * box runner dies on an expired token with no way to refresh it. On 2026-08-19 that
   * blocked the entire cutover backlog with no legitimate way forward.
   *
   * getEtdToken() already mints on demand and reuses a live token, so this is just the
   * missing front door to it. By default it does not return the secret; describeEtdToken()
   * reports length, age and remaining life only.
   *
   * `?reveal=1` returns the bearer itself, and `?force=1` discards the cached token and
   * mints a new one.
   *
   * Withholding the secret was right while every caller was a scheduler that only needed
   * the mint to have happened. It is wrong for a person holding Postman or curl: a mint
   * you cannot read leaves a prod DB query as the only route to a usable token, so every
   * hourly expiry became a manual errand and the ETD collection could not stand alone.
   * The gate is unchanged - requireCronOrStaff, the same authority that can already spend
   * money through the booking routes - and the secret dies in about an hour.
   */
  router.post("/forms/rental-survey/cutover/etd-token/ensure", requireCronOrStaff, async (req, res) => {
    try {
      const entry = await getEtdToken({ force: String(req.query.force || "") === "1" });
      const body: Record<string, unknown> = { ok: true, token: await describeEtdToken() };
      if (String(req.query.reveal || "") === "1") {
        body.secret = entry.secret;
        body.expiresAt = new Date(entry.expiresAt * 1000).toISOString();
      }
      res.json(body);
    } catch (e: any) {
      console.error("[survey] etd-token/ensure failed:", e?.message || e);
      res.status(502).json({ ok: false, message: e?.message || "could not obtain an ETD token" });
    }
  });

  /**
   * Booked reservations that have NO route block. Read-only.
   *
   * WHY THIS EXISTS
   * ---------------
   * `file-route-blocks` writes a tracking row for every technician it is ASKED about,
   * including refusals - but only for those. The caller chooses the candidate list, and
   * on 2026-08-18 it applied a schedule filter and silently dropped the eight
   * technicians who had no working day that week. They were left holding real, live,
   * week-long Enterprise reservations (booked 08-18 09:00 through 08-25 09:00) with
   * `route_block_status = 'pending'`, no block date, NO error, and no message of any
   * kind. Nothing selects that state, so nothing would ever have looked at them again;
   * the cars simply sat at the branches, billing, with the technicians unaware.
   *
   * A silent skip is the failure mode this whole lane cannot afford, so make the state
   * queryable. This endpoint answers one question - "who has a car waiting and no
   * block?" - and it should be checked after EVERY booking batch.
   */
  router.get("/forms/rental-survey/cutover/unblocked", requireCronOrStaff, async (_req, res) => {
    try {
      const { rows } = await db.execute(sql`
        SELECT ldap, tech_name, truck_number, etd_reference,
               branch_name, branch_address, vehicle_class,
               route_block_status, route_block_error,
               -- reservation_start/_end are TEXT (ISO strings), not timestamps, so
               -- to_char() on them is a type error. Only reserved_at is a real timestamp.
               reservation_start, reservation_end,
               to_char(reserved_at, 'YYYY-MM-DD HH24:MI')       AS reserved_at,
               reservation_start::timestamp <= now()             AS window_already_open
          FROM vrm_rental_cutover
         WHERE reservation_status = 'booked'
           AND COALESCE(route_block_status, 'pending') <> 'filed'
         ORDER BY reserved_at
      `);
      const list = rows as any[];
      res.json({
        count: list.length,
        liveNow: list.filter((r) => r.window_already_open).length,
        rows: list,
      });
    } catch (e: any) {
      console.error("[survey] cutover/unblocked failed:", e?.message || e);
      res.status(500).json({ message: e?.message || "unblocked query failed" });
    }
  });

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
        SELECT DISTINCT ON (upper(cut.ldap))
               upper(cut.ldap)                                 AS ldap,
               COALESCE(cut.tech_name, s.tech_name, a.tech_name) AS tech_name,
               COALESCE(NULLIF(btrim(cut.truck_number),''),
                        NULLIF(btrim(s.assigned_truck_number),''),
                        s.truck_number)                        AS truck_number,
               cut.branch_name, cut.branch_address, cut.etd_reference,
               NULLIF(btrim(a.district_no::text),'')           AS unit
        -- 2026-08-20: this was rooted on vrm_rental_tech_survey WHERE s.has_rental,
        -- the SAME structural defect the booking runner had. A technician who was
        -- booked off the rental feed but never answered the survey could not get a
        -- route block at all: on 2026-08-20 that was 70 of 83 booked-and-unblocked
        -- technicians, each holding a real week-long reservation nobody could put
        -- on a route. The reservation is the thing that makes a block necessary, so
        -- the reservation is now the root and the survey only enriches.
        FROM vrm_rental_cutover cut
        JOIN all_techs a ON upper(a.tech_racfid) = upper(cut.ldap)
        LEFT JOIN vrm_rental_tech_survey s ON upper(s.ldap) = upper(cut.ldap)
        WHERE cut.reservation_status = 'booked'
          AND upper(COALESCE(cut.ldap,'')) <> 'ZZTEST'
          AND upper(COALESCE(cut.ldap,'')) <> 'ZZPROBE9'
          -- No van_status gate (Tyler, 2026-08-17): every rental on the Holman
          -- book runs the whole flow. van_status says whether the survey could
          -- work out what happened to the VAN; it says nothing about whether
          -- the rental should still bill through Holman. Gating on it stranded
          -- 26 of 71 booked technicians with a reservation and no block.
          AND a.employment_status = 'A'
          AND (${onlyLdaps.length === 0}
               OR upper(cut.ldap) = ANY(string_to_array(${onlyLdaps.join(",")}, ',')))
        ORDER BY upper(cut.ldap), s.created_at DESC NULLS LAST
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
            + `without it. Your LDAP is your Tech Hub login ID. Already `
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
        // Task #738: snapshot the tech's own open Enterprise ticket(s) so the
        // tracking page can anchor its book state to the SPECIFIC old rental.
        // Write-once (no force): the external runner re-posts results, and a
        // later re-post must not overwrite the booking-time evidence with a
        // book that may already have dropped the old ticket.
        if (status === "booked") await anchorCutoverRow(ldap, "booking");
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
      res.json(await buildCutoverStatusPayload());
    } catch (error: any) {
      console.error("[survey] cutover-status failed:", error?.message || error);
      res.status(500).json({ message: error?.message || "cutover-status failed" });
    }
  });

  /**
   * Premortem #4: audited correction path for an erroneous direct-billing
   * stamp. One bad Enterprise row would otherwise be a PERMANENT red
   * "double billed" line (the stamp is write-once) — cry-wolf erosion.
   *
   * void   — declares the current stamp erroneous. Sighting history
   *          (confirmed_at / last_seen_at / evidence) is NEVER mutated;
   *          the void rides its own columns with actor + reason as audit.
   *          A LATER report sighting the tech again supersedes the void
   *          automatically (last_seen_at > voided_at) — fresh vendor
   *          evidence beats a stale human assertion.
   * unvoid — reverses a mistaken void. Requires a reason too; both events
   *          are logged with the actor. Session-only, ENFORCED: the gate is
   *          requireStaffSession, which rejects the internal-cron bearer, so
   *          the audit actor can never be "unknown" — every event names the
   *          signed-in person who took it.
   */
  router.post("/forms/rental-survey/cutover/:ldap/billing-void", requireStaffSession, async (req, res) => {
    try {
      const ldap = String(req.params.ldap || "").trim().toUpperCase();
      const action = String(req.body?.action || "void");
      const reason = String(req.body?.reason || "").trim();
      if (!ldap) return res.status(400).json({ message: "ldap required" });
      if (action !== "void" && action !== "unvoid") {
        return res.status(400).json({ message: "action must be 'void' or 'unvoid'" });
      }
      if (reason.length < 5) {
        return res.status(400).json({ message: "a reason (at least 5 characters) is required — it is the audit trail" });
      }
      const actor = String((req as any).user?.username || (req as any).user?.email || "unknown").slice(0, 80);
      // Both actions append to direct_billing_void_history — an append-only
      // event log, so an unvoid clearing the current-state columns can never
      // erase who voided/restored what, when, or why.
      const historyEvent = sql`COALESCE(direct_billing_void_history, '[]'::jsonb)
            || jsonb_build_object('action', ${action}::text, 'at', now(),
                                  'by', ${actor}::text, 'reason', ${reason}::text)`;
      if (action === "void") {
        const r = await db.execute(sql`
          UPDATE vrm_rental_cutover
          SET direct_billing_voided_at   = now(),
              direct_billing_voided_by   = ${actor},
              direct_billing_void_reason = ${reason},
              direct_billing_void_history = ${historyEvent},
              updated_at                 = now()
          WHERE upper(trim(ldap)) = ${ldap}
            AND direct_billing_confirmed_at IS NOT NULL
        `);
        if (!Number((r as any).rowCount ?? 0)) {
          return res.status(404).json({ message: "no stamped cutover row for that LDAP" });
        }
        console.log(`[survey] direct-billing stamp VOIDED for ${ldap} by ${actor}: ${reason}`);
      } else {
        const r = await db.execute(sql`
          UPDATE vrm_rental_cutover
          SET direct_billing_voided_at   = NULL,
              direct_billing_voided_by   = NULL,
              direct_billing_void_reason = NULL,
              direct_billing_void_history = ${historyEvent},
              updated_at                 = now()
          WHERE upper(trim(ldap)) = ${ldap}
            AND direct_billing_voided_at IS NOT NULL
        `);
        if (!Number((r as any).rowCount ?? 0)) {
          return res.status(404).json({ message: "no voided stamp for that LDAP" });
        }
        console.log(`[survey] direct-billing stamp UNVOIDED for ${ldap} by ${actor}: ${reason}`);
      }
      res.json({ ok: true, ldap, action });
    } catch (error: any) {
      console.error("[survey] billing-void failed:", error?.message || error);
      res.status(500).json({ message: error?.message || "billing-void failed" });
    }
  });

  /**
   * Task #772: direct-billed rentals with NO booked cutover row — ~20% of the
   * direct report used to surface only in the upload toast at import time.
   * This is their permanent home, derived from the durable rental-ops book
   * (never the toast), so it survives between uploads.
   */
  router.get("/forms/rental-survey/direct-offpage", async (_req, res) => {
    try {
      res.json(await buildDirectOffPagePayload());
    } catch (error: any) {
      console.error("[survey] direct-offpage failed:", error?.message || error);
      res.status(500).json({ message: error?.message || "direct-offpage failed" });
    }
  });

  /**
   * Msg1 confirmation backfill: text every booked + block-filed tech still on
   * the Holman book who never got a confirmation-shaped text (body carrying
   * their CURRENT etd_reference, or the Msg1/Msg2 wording). Evidence-based and
   * re-runnable; sends ride the Fleet Comms lane (quiet hours, opt-outs, 24h
   * dedupe). Dry-run by DEFAULT; a live run requires BOTH dryRun:false and
   * confirm:true (quiet-hours memory: force/run-now routes must default
   * dry-run + explicit confirm), plus the armed master flag inside the runner.
   */
  router.post("/forms/rental-survey/cutover/msg1-backfill", requireCronOrStaff, async (req, res) => {
    try {
      const dryRun = req.body?.dryRun !== false;
      if (!dryRun && req.body?.confirm !== true) {
        return res.status(400).json({
          message: "live run requires { dryRun: false, confirm: true } — run the dry run first and review it",
        });
      }
      const onlyLdaps: string[] = Array.isArray(req.body?.ldaps)
        ? req.body.ldaps.map((x: any) => String(x).trim().toUpperCase()).filter(Boolean)
        : [];
      const out = await runMsg1ConfirmationBackfill({
        dryRun,
        limit: Number(req.body?.limit) || undefined,
        onlyLdaps,
        requestedBy: (req as any).session?.user?.username ?? undefined,
      });
      res.json({
        ...out,
        note: dryRun
          ? "Dry run. No texts were sent or queued; bodies included for review."
          : "LIVE. Sends went through the Fleet Comms lane (quiet-hours deferrals show as queued).",
      });
    } catch (error: any) {
      console.error("[survey] msg1-backfill failed:", error?.message || error);
      res.status(500).json({ message: error?.message || "msg1-backfill failed" });
    }
  });

  // End-to-end cutover workflow intents (task #646): intent-owned booking,
  // block filing, messaging and readbacks. Registered last — the module owns
  // everything under /forms/rental-survey/cutover/* plus the rental-request
  // parity lane.
  registerCutoverIntentRoutes(router);
}

/**
 * The cutover-status payload, exported so the book-state matrix (task #738)
 * is testable against real fixture rows without an HTTP session.
 */
export async function buildCutoverStatusPayload(opts?: {
  /**
   * Task #748 (double-billing premortem #2): the PAGE deliberately shows only
   * reservation_status='booked' rows (Tyler's scope call), but the direct-
   * billing import's old-book comparison must also see a tech who was stamped
   * "billing switched" on a row that is NOT booked (released, failed, manually
   * managed) — otherwise that tech can be double-billed invisibly. When true,
   * the WHERE widens to booked OR effectively-stamped; the book-state joins
   * are identical, so this stays the one true derivation of book state.
   */
  includeAllStamped?: boolean;
}): Promise<any> {
  // Premortem #4: THE effective-stamp predicate, defined ONCE and interpolated
  // wherever it is needed (SELECT below, and the widened WHERE) so the page
  // buckets, the payload counts and the import's conflict scan can never
  // disagree. A void is superseded when a LATER report sights the tech again
  // (evidence beats a stale human assertion; the void columns stay as audit).
  // last_seen IS NOT NULL is spelled out so a voided row with a NULL last_seen
  // yields FALSE, not SQL NULL (NULL > x = NULL would leak a non-boolean into
  // the JSON payload).
  const effectiveStampSql = sql`(c.direct_billing_confirmed_at IS NOT NULL
                 AND (c.direct_billing_voided_at IS NULL
                      OR (c.direct_billing_last_seen_at IS NOT NULL
                          AND c.direct_billing_last_seen_at > c.direct_billing_voided_at)))`;
  // Tyler 2026-08-23: the page must know direct-billed from the rental-ops
  // book ITSELF, not only via the import-time stamp — prod ran two direct
  // imports on pre-stamp code and the page read zero switched while 200+
  // enterprise_direct cases sat on the live book. A cutover tech whose
  // identity-resolved rental rides the CURRENT book as enterprise_direct is
  // direct-billed, stamp or no stamp (dbk join below). A human void still
  // wins: book evidence never overrides voided_at — the stamp's
  // later-sighting rule stays the ONLY supersede path.
  const liveBookSql = sql`(COALESCE(dbk.direct_live, 0) > 0
                 AND c.direct_billing_voided_at IS NULL)`;
  const effectiveSql = sql`(${effectiveStampSql} OR ${liveBookSql})`;
  const { rows } = await db.execute(sql`
        SELECT c.ldap, c.tech_name, c.truck_number, c.van_status,
               s.rental_branch_city, s.rental_branch_state, s.surveyed_at,
               s.shop_name, s.shop_city, s.shop_state, s.shop_phone,
               s.promised_ready_date, s.rental_company, s.rental_vehicle_desc,
               c.reservation_status,
               c.etd_reference, c.branch_name, c.branch_address, c.branch_pinned, c.vehicle_class,
               c.reserved_at, c.reservation_error,
               c.route_block_status,
               c.route_block_project_name, c.route_block_date, c.route_block_live,
               c.route_block_filed_at, c.route_block_error,
               -- Tyler 2026-08-20: stage was hardcoded 'complete', so the facet
               -- panel was one bucket and the two states that need action were
               -- invisible. Derive it, and carry the Holman book state alongside:
               -- a booked, blocked reservation whose technician is STILL on the
               -- Holman open book has not been collected and is billing twice.
               CASE
                 WHEN c.route_block_status <> 'filed'
                   OR c.route_block_live IS NOT TRUE           THEN 'no route block'
                 -- 2026-08-20 second pass: the first version painted EVERY booked
                 -- technician still on the Holman book as "not collected", which
                 -- was 140 rows, 73 of them with a pickup date that has not
                 -- arrived yet. Booking somebody today for tomorrow is not a
                 -- failure and must not read as one. Only call it not-collected
                 -- once the pickup day has actually passed.
                 WHEN hb.book_state IN ('open', 'rolled')
                  AND pd.pickup_day IS NOT NULL
                  AND pd.pickup_day
                      < to_char((now() AT TIME ZONE 'America/New_York')::date, 'YYYY-MM-DD')
                                                               THEN 'not collected'
                 WHEN hb.book_state IN ('open', 'rolled')       THEN 'scheduled'
                 ELSE 'complete'
               END AS stage,
               hb.book_state AS holman_book_state,
               hb.book_match AS holman_book_match,
               COALESCE((SELECT string_agg(t, ', ' ORDER BY t)
                         FROM jsonb_array_elements_text(COALESCE(c.book_anchor_tickets, '[]'::jsonb)) t), '')
                 AS anchor_tickets,
               c.book_anchor_at, c.book_anchor_source,
               -- Billing switchover proof (2026-08-22): stamped by the manual
               -- direct-billing import when this tech's rental shows up on the
               -- Enterprise direct-account report. Write-once — see
               -- direct-billing-import.ts stampCutoverBillingSwitchover.
               c.direct_billing_confirmed_at, c.direct_billing_last_seen_at,
               c.direct_billing_evidence->>'ra'       AS direct_billing_ra,
               c.direct_billing_evidence->>'fileDate' AS direct_billing_file_date,
               c.direct_billing_voided_at, c.direct_billing_voided_by,
               c.direct_billing_void_reason,
               -- Premortem #4: the effective predicate (defined once in
               -- TS above, interpolated here and in the WHERE) so the page
               -- buckets, the payload counts and the import's conflict scan
               -- can never disagree. Effective = report stamp in force OR the
               -- tech's identity-resolved rental rides the CURRENT rental-ops
               -- book as enterprise_direct (and no human void).
               ${effectiveSql}
                 AS direct_billing_effective,
               (COALESCE(dbk.direct_live, 0) > 0)
                 AS direct_billing_book_live,
               sup.district, sup.supervisor_name, sup.supervisor_ldap, sup.supervisor_phone
        FROM vrm_rental_cutover c
        -- Pickup day, parsed once, kept as TEXT on purpose: reservation_start
        -- is a free text column, and a regex-shaped-but-impossible date (e.g.
        -- '2026-02-31') would make ::date THROW and 500 the whole payload.
        -- ISO 'YYYY-MM-DD' strings compare correctly as text, so no cast is
        -- ever needed. The date test is written [0-9] and not the backslash-d
        -- shorthand because inside a drizzle tagged template JS cooks \d down
        -- to a bare d before drizzle ever sees it.
        LEFT JOIN LATERAL (
          SELECT CASE WHEN left(COALESCE(c.reservation_start, ''), 10) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                      THEN left(c.reservation_start, 10) END AS pickup_day
        ) pd ON TRUE
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
        -- Still on the Holman rental book? Task #738: driven by the ANCHORED
        -- old ticket(s), never by "any open ticket sharing the truck number" —
        -- that match kept a reassigned truck's NEW renter billing against the
        -- old cutover forever. (The old enterprise_id_feed arm was dead: the
        -- feed leaves it blank on every row.)
        LEFT JOIN LATERAL (
          SELECT
            -- A ticket that is still OPEN but was REWRITTEN with a rental
            -- start on/after the ETD pickup day reads as the old rental
            -- rolling onto or past the swap — possible double-billing, its
            -- own state, not a plain "still billing".
            bool_or(upper(COALESCE(c2.ticket_status, '')) = 'OPEN'
                    AND NOT (pd.pickup_day IS NOT NULL AND c2.rental_start_date IS NOT NULL
                             AND to_char(c2.rental_start_date, 'YYYY-MM-DD') >= pd.pickup_day)) AS open_plain,
            bool_or(upper(COALESCE(c2.ticket_status, '')) = 'OPEN'
                    AND pd.pickup_day IS NOT NULL AND c2.rental_start_date IS NOT NULL
                    AND to_char(c2.rental_start_date, 'YYYY-MM-DD') >= pd.pickup_day)           AS open_rolled,
            bool_or(upper(COALESCE(c2.ticket_status, '')) = 'PENDED')     AS pended
          FROM vrm_rental_operations_cases c2
          WHERE c2.present_in_latest
            -- ECARS/Holman book only: enterprise_direct rows are the NEW
            -- direct-billed replacements under the same vendor string.
            AND c2.source = 'enterprise'
            AND upper(COALESCE(c2.rental_vendor, '')) LIKE 'ENTERPRISE%'
            AND upper(btrim(COALESCE(c2.ticket_number, ''))) IN (
              SELECT upper(btrim(t))
              FROM jsonb_array_elements_text(COALESCE(c.book_anchor_tickets, '[]'::jsonb)) t)
        ) ab ON TRUE
        -- Fallback for rows with no anchor: truck match, but only when the
        -- case's resolved identity (or a human override) maps to THIS tech —
        -- a renter-name-verified truck match, labeled as such in the payload.
        LEFT JOIN LATERAL (
          SELECT
            bool_or(upper(COALESCE(c2.ticket_status, '')) = 'OPEN'
                    AND NOT (pd.pickup_day IS NOT NULL AND c2.rental_start_date IS NOT NULL
                             AND to_char(c2.rental_start_date, 'YYYY-MM-DD') >= pd.pickup_day)) AS open_plain,
            bool_or(upper(COALESCE(c2.ticket_status, '')) = 'OPEN'
                    AND pd.pickup_day IS NOT NULL AND c2.rental_start_date IS NOT NULL
                    AND to_char(c2.rental_start_date, 'YYYY-MM-DD') >= pd.pickup_day)           AS open_rolled,
            bool_or(upper(COALESCE(c2.ticket_status, '')) = 'PENDED')     AS pended,
            count(*)                                                      AS matched
          FROM vrm_rental_operations_cases c2
          JOIN vrm_rental_identity_resolutions ir ON ir.case_key = c2.case_key
          JOIN all_techs a3
            ON a3.employee_id = COALESCE(ir.override_employee_id, ir.resolved_employee_id)
           AND upper(a3.tech_racfid) = upper(c.ldap)
          WHERE jsonb_array_length(COALESCE(c.book_anchor_tickets, '[]'::jsonb)) = 0
            AND (ir.override_employee_id IS NOT NULL OR upper(COALESCE(ir.state, '')) = 'RESOLVED')
            AND c2.present_in_latest
            AND c2.source = 'enterprise'
            AND upper(COALESCE(c2.rental_vendor, '')) LIKE 'ENTERPRISE%'
            AND NULLIF(ltrim(regexp_replace(COALESCE(c2.vehicle_number, ''), '[^0-9]', '', 'g'), '0'), '')
                = NULLIF(ltrim(regexp_replace(COALESCE(c.truck_number, ''), '[^0-9]', '', 'g'), '0'), '')
        ) fb ON TRUE
        LEFT JOIN LATERAL (
          SELECT
            CASE WHEN jsonb_array_length(COALESCE(c.book_anchor_tickets, '[]'::jsonb)) > 0 THEN 'anchored'
                 WHEN COALESCE(fb.matched, 0) > 0                                          THEN 'fallback'
                 ELSE 'none' END AS book_match,
            CASE
              WHEN jsonb_array_length(COALESCE(c.book_anchor_tickets, '[]'::jsonb)) > 0 THEN
                CASE WHEN COALESCE(ab.open_plain, false)  THEN 'open'
                     WHEN COALESCE(ab.open_rolled, false) THEN 'rolled'
                     WHEN COALESCE(ab.pended, false)      THEN 'pended'
                     ELSE '' END
              WHEN COALESCE(fb.matched, 0) > 0 THEN
                CASE WHEN COALESCE(fb.open_plain, false)  THEN 'open'
                     WHEN COALESCE(fb.open_rolled, false) THEN 'rolled'
                     WHEN COALESCE(fb.pended, false)      THEN 'pended'
                     ELSE '' END
              ELSE 'unanchored'
            END AS book_state
        ) hb ON TRUE
        -- Live direct-billing book evidence (Tyler 2026-08-23): does THIS
        -- tech's identity-resolved rental sit on the current rental-ops book
        -- as an enterprise_direct case? Identity-verified only (override or
        -- RESOLVED) — REVIEW-state matches never count, mirroring the
        -- importer's own "REVIEW evidence never stamps" rule.
        LEFT JOIN LATERAL (
          SELECT count(*) AS direct_live
          FROM vrm_rental_operations_cases c2
          JOIN vrm_rental_identity_resolutions ir ON ir.case_key = c2.case_key
          -- Canonical roster row ONLY (active first, then latest sync):
          -- all_techs keeps terminated/historical rows per employee, and a
          -- bare employee_id+racfid join would let an employee's OLD or
          -- reused LDAP light up the wrong cutover row as switched. The
          -- employee's one canonical racfid must BE this row's ldap.
          JOIN LATERAL (
            SELECT a.tech_racfid
            FROM all_techs a
            WHERE a.employee_id = COALESCE(ir.override_employee_id, ir.resolved_employee_id)
            ORDER BY (a.employment_status = 'A') DESC, a.synced_at DESC NULLS LAST
            LIMIT 1
          ) a4 ON upper(a4.tech_racfid) = upper(c.ldap)
          WHERE c2.present_in_latest
            AND c2.source = 'enterprise_direct'
            AND (ir.override_employee_id IS NOT NULL OR upper(COALESCE(ir.state, '')) = 'RESOLVED')
        ) dbk ON TRUE
        -- Widened 2026-08-20: previously this required a filed, live route block,
        -- so a booked reservation with no block was absent from the page rather
        -- than shown as a problem. That is how 8 technicians ended up holding a
        -- week-long car nobody had told them about.
        -- Task #748: includeAllStamped (importer's double-billing scan only)
        -- additionally admits ANY row with an effective direct-billing stamp,
        -- whatever its reservation_status — a released/failed/manual row whose
        -- tech is confirmed on the direct account can still be double-billed.
        -- The page route calls with no options, so its scope is unchanged.
        WHERE (c.reservation_status = 'booked'
               ${opts?.includeAllStamped ? sql`OR ${effectiveSql}` : sql``})
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

      const book = await loadEnterpriseBookMeta();

      return {
        total: rows.length,
        by_stage: tally("stage"),
        by_reservation: tally("reservation_status"),
        by_route_block: tally("route_block_status"),
        by_holman_book: tally("holman_book_state"),
        // positive direct-billing-report confirmations among these rows
        // (effective = stamped and not voided; the SQL predicate above)
        billing_switched: (rows as any[]).filter((r) => r.direct_billing_effective === true).length,
        // switched to the direct account yet STILL open/rolled on the old
        // enterprise book — double-billed; the old ticket needs closing
        double_billed: (rows as any[]).filter((r) => r.direct_billing_effective === true
          && (r.holman_book_state === "open" || r.holman_book_state === "rolled")).length,
        // Premortem #3: switched but the old book state is UNANCHORED — no
        // ticket anchor and no identity-verified truck match, so the old book
        // is UNKNOWN for this row. Unknown ≠ clean; its own bucket.
        billing_unknown: (rows as any[]).filter((r) => r.direct_billing_effective === true
          && r.holman_book_state === "unanchored").length,
        book,
        rows,
      };
}

/**
 * Task #738: the book state is only as truthful as the Enterprise book
 * snapshot behind it — the sporadic sync has gapped 3–6 days. Surface the
 * snapshot's as-of date and flag it stale so "still billing" can be read as
 * "still billing as of the 19th", not as live truth. Shared by the cutover
 * scoreboard and the off-page direct-billing payload (task #772) so both
 * pages report the same truth ceiling.
 */
async function loadEnterpriseBookMeta(): Promise<{
  as_of: string | null; landed_at: unknown; age_days: number | null; stale: boolean;
}> {
  const { rows: bookMetaRows } = await db.execute(sql`
    SELECT max(left(file_date, 10)) AS as_of,
           max(finished_at) AS landed_at
    FROM vrm_rental_operations_import_runs
    WHERE status = 'completed'
      -- file_date is VARCHAR; only trust rows carrying a real date shape.
      -- NO ::date cast anywhere: a regex-shaped-but-impossible value
      -- ('2026-02-31') would make the cast THROW and 500 the endpoint.
      -- ISO text max() picks the latest day correctly on its own; the
      -- day-diff is computed in TS where a bad date degrades to null.
      AND left(COALESCE(file_date, ''), 10) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      AND run_type IN ('scheduled_sync', 'manual_enterprise_import')
  `);
  const bookMeta = (bookMetaRows as any[])[0] ?? {};
  // Age in days vs ET today. An as_of that is not a REAL calendar day
  // (unparseable, or one the Date engine would silently normalize, e.g.
  // '2026-02-31' → Mar 3) yields null, which the payload treats as
  // "stale/unknown" — never a wrong-but-confident age.
  let ageDays: number | null = null;
  if (bookMeta.as_of) {
    const asOfMs = Date.parse(`${bookMeta.as_of}T00:00:00Z`);
    const roundTrips = Number.isFinite(asOfMs)
      && new Date(asOfMs).toISOString().slice(0, 10) === String(bookMeta.as_of);
    const etToday = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const todayMs = Date.parse(`${etToday}T00:00:00Z`);
    if (roundTrips && Number.isFinite(todayMs)) {
      ageDays = Math.round((todayMs - asOfMs) / 86_400_000);
    }
  }
  return {
    as_of: bookMeta.as_of ?? null,
    landed_at: bookMeta.landed_at ?? null,
    age_days: ageDays,
    stale: ageDays == null ? true : ageDays >= 3,
  };
}

/**
 * Task #772: the permanent home for direct-billed rentals that are NOT on the
 * cutover page. ~20% of the direct-billing report (46 of 225 at last count)
 * maps to no booked cutover row — those techs previously surfaced ONLY in the
 * upload toast, which vanishes with the page. This payload is derived from
 * the durable book (vrm_rental_operations_cases source='enterprise_direct' +
 * identity resolutions), so it survives between uploads.
 *
 * Buckets:
 * - identity RESOLVED (or human override), canonical roster LDAP known —
 *   listed with the same old-Holman/Enterprise-book OPEN/PENDED test the
 *   double-billing comparison uses, so a double-bill in this population
 *   cannot hide. Matching is identity-based (the old case's resolved/override
 *   employee is THIS employee) — stronger than a truck-number guess, and the
 *   only match possible here: these rows have no cutover anchor tickets.
 * - identity unresolved (REVIEW/EXCEPTION, or resolved but racf-less) — the
 *   blind rows. No comparison is possible; the row says so ('unknown', never
 *   silently clean) and points staff at the identity-review flow.
 *
 * Scope rule: a tech whose canonical LDAP has a BOOKED cutover row is on the
 * Cutover Tracking table already (and covered by its comparison) — excluded
 * here. A NON-booked cutover row (released/failed/manual) does not put them
 * on the page, so they stay HERE, with that status carried for context.
 *
 * NOTE: no 'rolled' state in this population — 'rolled' is defined relative
 * to an ETD pickup day, and these techs have no booked reservation.
 */
export async function buildDirectOffPagePayload(): Promise<any> {
  const { rows } = await db.execute(sql`
    SELECT c.case_key,
           c.vehicle_number,
           c.renter_name_raw,
           c.ticket_number                          AS ra_number,
           c.rental_start_date::text                AS rental_start_date,
           c.days_open,
           c.renting_city, c.renting_state,
           c.veh_desc,
           c.last_seen_at,
           -- report file date this case was last seen on (per-case, from its
           -- last import run; VARCHAR — display-shaped in the client, never cast)
           CASE WHEN left(COALESCE(run.file_date, ''), 10) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                THEN left(run.file_date, 10) END    AS report_file_date,
           ir.state                                 AS identity_state,
           ir.reason                                AS identity_reason,
           (ir.override_employee_id IS NOT NULL)    AS identity_overridden,
           idr.employee_id,
           rt.ldap,
           COALESCE(rt.tech_name, ir.override_tech_name, ir.resolved_tech_name)
                                                    AS tech_name,
           rt.district,
           -- a cutover row exists but is not booked (released/failed/manual):
           -- carried for context; NULL = no cutover row at all
           co.reservation_status                    AS cutover_reservation_status,
           -- Same OPEN/PENDED test the double-billing comparison uses
           -- (survey.ts ab/fb laterals): present-in-latest source='enterprise'
           -- ENTERPRISE-vendor cases only. 'unknown' when identity is
           -- unresolved — unknown ≠ clean, its own bucket. A RESOLVED
           -- employee with NO canonical roster LDAP is ALSO 'unknown': the
           -- booked-cutover exclusion is LDAP-keyed, so without one we cannot
           -- prove the tech is off-page — never issue a verdict we can't stand
           -- behind.
           CASE WHEN idr.employee_id IS NULL
                  OR rt.ldap IS NULL                THEN 'unknown'
                WHEN COALESCE(ob.open_any, false)   THEN 'open'
                WHEN COALESCE(ob.pended, false)     THEN 'pended'
                ELSE '' END                         AS old_book_state,
           -- no tickets carried on 'unknown' rows: a ticket list next to an
           -- unverdicted row reads as a verdict
           CASE WHEN idr.employee_id IS NULL OR rt.ldap IS NULL THEN ''
                ELSE COALESCE(ob.old_tickets, '') END AS old_tickets
    FROM vrm_rental_operations_cases c
    LEFT JOIN vrm_rental_identity_resolutions ir ON ir.case_key = c.case_key
    LEFT JOIN vrm_rental_operations_import_runs run ON run.id = c.last_import_run_id
    -- Safe identity: human override always counts; a machine resolution only
    -- when RESOLVED (REVIEW guesses never drive a comparison — the importer's
    -- own "REVIEW evidence never stamps" rule).
    LEFT JOIN LATERAL (
      SELECT CASE WHEN ir.override_employee_id IS NOT NULL
                    OR upper(COALESCE(ir.state, '')) = 'RESOLVED'
                  THEN COALESCE(ir.override_employee_id, ir.resolved_employee_id)
             END AS employee_id
    ) idr ON TRUE
    -- Canonical roster row ONLY (active first, then latest sync) — the same
    -- rule as the cutover payload's dbk join: all_techs keeps terminated and
    -- historical rows per employee, and a bare join would let an OLD or
    -- reused LDAP claim the wrong cutover row.
    LEFT JOIN LATERAL (
      SELECT NULLIF(btrim(a.tech_racfid), '') AS ldap, a.tech_name,
             NULLIF(btrim(a.district_no::text), '') AS district
      FROM all_techs a
      WHERE idr.employee_id IS NOT NULL AND a.employee_id = idr.employee_id
      ORDER BY (a.employment_status = 'A') DESC, a.synced_at DESC NULLS LAST
      LIMIT 1
    ) rt ON TRUE
    LEFT JOIN LATERAL (
      SELECT vc.reservation_status
      FROM vrm_rental_cutover vc
      WHERE rt.ldap IS NOT NULL AND upper(trim(vc.ldap)) = upper(rt.ldap)
      LIMIT 1
    ) co ON TRUE
    LEFT JOIN LATERAL (
      SELECT bool_or(upper(COALESCE(c2.ticket_status, '')) = 'OPEN')   AS open_any,
             bool_or(upper(COALESCE(c2.ticket_status, '')) = 'PENDED') AS pended,
             string_agg(DISTINCT NULLIF(btrim(c2.ticket_number), ''), ', ') AS old_tickets
      FROM vrm_rental_operations_cases c2
      JOIN vrm_rental_identity_resolutions ir2 ON ir2.case_key = c2.case_key
      WHERE idr.employee_id IS NOT NULL
        AND COALESCE(ir2.override_employee_id, ir2.resolved_employee_id) = idr.employee_id
        AND (ir2.override_employee_id IS NOT NULL OR upper(COALESCE(ir2.state, '')) = 'RESOLVED')
        AND c2.present_in_latest
        AND c2.source = 'enterprise'
        AND upper(COALESCE(c2.rental_vendor, '')) LIKE 'ENTERPRISE%'
    ) ob ON TRUE
    WHERE c.present_in_latest
      AND c.source = 'enterprise_direct'
      -- booked cutover row = on the Cutover Tracking table already
      AND (co.reservation_status IS NULL OR co.reservation_status <> 'booked')
    ORDER BY (CASE WHEN idr.employee_id IS NULL OR rt.ldap IS NULL THEN 1 ELSE 0 END),
             (CASE WHEN COALESCE(ob.open_any, false) THEN 0
                   WHEN COALESCE(ob.pended, false)   THEN 1
                   ELSE 2 END),
             COALESCE(rt.tech_name, c.renter_name_raw, c.case_key)
  `);

  // Latest completed direct-billing import — the freshness ceiling of this
  // whole list (rows persist between uploads; say when the last upload was).
  const { rows: reportRows } = await db.execute(sql`
    SELECT CASE WHEN left(COALESCE(file_date, ''), 10) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                THEN left(file_date, 10) END AS file_date,
           finished_at
    FROM vrm_rental_operations_import_runs
    WHERE run_type = 'manual_direct_billing_import' AND status = 'completed'
    ORDER BY finished_at DESC NULLS LAST
    LIMIT 1
  `);
  const report = (reportRows as any[])[0] ?? {};

  // Resolved-for-this-list = safe employee identity AND a canonical roster
  // LDAP: without the LDAP the booked-cutover exclusion (LDAP-keyed) cannot
  // run, so the row is blind here even if the identity resolver is confident.
  const rs = rows as any[];
  const isUnresolved = (r: any) => r.employee_id == null || r.ldap == null;
  return {
    total: rs.length,
    resolved: rs.filter((r) => !isUnresolved(r)).length,
    unresolved: rs.filter(isUnresolved).length,
    on_old_book: rs.filter((r) => r.old_book_state === "open").length,
    pended_old_book: rs.filter((r) => r.old_book_state === "pended").length,
    report: {
      file_date: report.file_date ?? null,
      finished_at: report.finished_at ?? null,
    },
    book: await loadEnterpriseBookMeta(),
    rows: rs,
  };
}
