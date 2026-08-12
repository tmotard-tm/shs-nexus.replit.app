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
function checkIdentity(row: SurveyTokenRow, body: any) {
  const ldap = String(body?.ldap || "").trim().toUpperCase();
  const truck = String(body?.truckNumber || "").trim();
  if (!ldap || !truck) {
    return { ok: false as const, code: 400, message: "Please enter both your LDAP and your truck number." };
  }
  if (row.ldap && ldap !== String(row.ldap).trim().toUpperCase()) {
    return { ok: false as const, code: 403, message: "That LDAP does not match this link. Check your entry and try again." };
  }
  const onFile = String(row.truck_number || "").trim();
  if (onFile && normTruck(onFile) !== normTruck(truck)) {
    return { ok: false as const, code: 403, message: "That truck number does not match our records for you." };
  }
  return { ok: true as const, ldap, truck: onFile || truck };
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
        if (!s(b.rentalBranchCity)) missing.push("the rental branch city");
        if (!s(b.rentalBranchState, 2)) missing.push("the rental branch state");
        if (!s(b.assignedTruckNumber, 30)) missing.push("your assigned truck number");
        vanStatus = s(b.vanStatus, 40);
        if (!vanStatus || !VAN_STATUS.has(vanStatus)) missing.push("what is happening with your van");
        if (vanStatus === "in_shop") {
          if (!s(b.shopName)) missing.push("the repair shop name");
          if (!s(b.shopCity)) missing.push("the repair shop city");
        }
      } else {
        noRentalReason = s(b.noRentalReason, 40);
        if (!noRentalReason || !NO_RENTAL_REASONS.has(noRentalReason)) missing.push("what happened to the rental");
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

      await db.execute(sql`
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
      `);

      await db.execute(sql`
        UPDATE vrm_form_tokens SET submitted_at = now() WHERE id = ${row.id}
      `);

      res.json({ success: true, escalated: vanStatus === "unknown_escalate" });
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
        SELECT r.*, t.sent_at, t.opened_at, t.batch, t.phone
        FROM vrm_rental_tech_survey r
        LEFT JOIN vrm_form_tokens t ON t.id = r.token_id
        ORDER BY r.created_at DESC
      `);
      res.json({ responses: rows });
    } catch (error: any) {
      console.error("[survey] responses failed:", error?.message || error);
      res.status(500).json({ message: "Failed to load responses." });
    }
  });

  /** Send/response funnel plus the counts that drive the reservation queue. */
  router.get("/forms/rental-survey/stats", async (_req, res) => {
    try {
      const { rows } = await db.execute(sql`
        SELECT
          (SELECT count(*) FROM vrm_form_tokens WHERE form_type='rental_tech_survey')                        AS issued,
          (SELECT count(*) FROM vrm_form_tokens WHERE form_type='rental_tech_survey' AND sent_at IS NOT NULL)     AS sent,
          (SELECT count(*) FROM vrm_form_tokens WHERE form_type='rental_tech_survey' AND opened_at IS NOT NULL)   AS opened,
          (SELECT count(*) FROM vrm_form_tokens WHERE form_type='rental_tech_survey' AND submitted_at IS NOT NULL) AS submitted,
          (SELECT count(*) FROM vrm_rental_tech_survey WHERE has_rental)                                     AS still_in_rental,
          (SELECT count(*) FROM vrm_rental_tech_survey WHERE has_rental IS FALSE)                            AS no_longer_in_rental,
          (SELECT count(*) FROM vrm_rental_tech_survey WHERE truck_mismatch)                                 AS truck_mismatch,
          (SELECT count(*) FROM vrm_rental_tech_survey WHERE van_status='unknown_escalate')                  AS escalations,
          (SELECT count(*) FROM vrm_rental_tech_survey WHERE truck_decommissioned)                           AS decommissioned,
          (SELECT count(*) FROM vrm_rental_tech_survey WHERE techhub_still_using IS FALSE)                   AS no_truck_number
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
               COALESCE(
                 NULLIF(regexp_replace(COALESCE(t.mobile_phone,''), '\D', '', 'g'), ''),
                 NULLIF(regexp_replace(COALESCE(split_part(t.email,'@',1),''), '\D', '', 'g'), ''),
                 NULLIF(regexp_replace(COALESCE(a.cell_phone,''), '\D', '', 'g'), ''),
                 NULLIF(regexp_replace(COALESCE(a.main_phone,''), '\D', '', 'g'), '')
               )                                        AS phone
        FROM vrm_rental_operations_cases c
        JOIN vrm_rental_identity_resolutions ir ON ir.case_key = c.case_key
        JOIN all_techs a
          ON a.employee_id = COALESCE(ir.override_employee_id, ir.resolved_employee_id)
        LEFT JOIN tpms_tech_profiles t ON upper(t.enterprise_id) = upper(a.tech_racfid)
        WHERE c.present_in_latest
          AND upper(c.ticket_status) = 'OPEN'
          AND a.employment_status = 'A'
          AND a.tech_racfid IS NOT NULL
          AND (ir.override_employee_id IS NOT NULL
               OR (ir.confidence = 'high' AND upper(ir.state) = 'RESOLVED'))
          AND NOT EXISTS (
            SELECT 1 FROM vrm_form_tokens ft
            WHERE ft.form_type = 'rental_tech_survey'
              AND upper(ft.ldap) = upper(a.tech_racfid)
              AND ft.submitted_at IS NULL
              AND ft.expires_at > now()
          )
        ORDER BY upper(a.tech_racfid), c.days_open DESC NULLS LAST
        LIMIT ${limit}
      `);

      const eligible = (rows as any[]).filter((r) => {
        const d = String(r.phone || "");
        return d.length === 10 || (d.length === 11 && d.startsWith("1"));
      });
      const noPhone = (rows as any[]).length - eligible.length;

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
            `${first}, Sears Fleet here. Quick form to confirm your rental and where your ` +
            `van is: ${url} Takes under a minute. If you are out of the rental, tell us ` +
            `there and you are done.`,
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
  router.post("/forms/rental-survey/send-chunk", async (req, res) => {
    try {
      const confirm = req.body?.confirm === true;
      const tokens: string[] = Array.isArray(req.body?.tokens) ? req.body.tokens.slice(0, 20) : [];
      if (!tokens.length) return res.status(400).json({ message: "No tokens supplied." });

      const key = process.env.COMMS_SEND_API_KEY;
      if (!key) return res.status(500).json({ message: "COMMS_SEND_API_KEY is not configured." });

      const { rows } = await db.execute(sql`
        SELECT token, ldap, phone, tech_name
        FROM vrm_form_tokens
        WHERE form_type = 'rental_tech_survey'
          AND token = ANY(${tokens})
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
            `${first}, Sears Fleet here. Quick form to confirm your rental and where your ` +
            `van is: ${base}/rental-survey/${t.token} Takes under a minute. If you are out ` +
            `of the rental, tell us there and you are done.`,
        };
      });

      // category matters: replies inherit the THREAD's category, so anything
      // other than rental_management lands where this tracker cannot see it.
      const payload: Record<string, unknown> = { category: "rental_management", messages };
      if (confirm) payload.confirm = true; else payload.dryRun = true;

      const host = process.env.COMMS_SEND_BASE_URL || "http://localhost:5000";
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
          WHERE token = ANY(${actuallySent.map((t) => t.token)})
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
}
