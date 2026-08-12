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

export const POLICY_VERSION = "2026-08-11.a";

/** Categories that are maintenance by definition. Rule 1 kills these outright. */
const MAINTENANCE = new Set([
  "scheduled_maintenance",
  "oil_change",
  "tires",
  "pm",
  "inspection",
  "recall",
]);

const PROBLEM_CATEGORIES = new Set([
  "breakdown",
  "accident",
  "awaiting_parts",
  "new_hire_awaiting_vehicle",
  "decom_replacement",
  "scheduled_maintenance",
]);

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
        "Rentals are not provided for oil changes, tires, preventive maintenance, " +
        "inspections or recalls. Schedule this as a wait through routing.",
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

  // 5 — a spare in range beats a rental. Not automatable yet: the spares feed is
  //     not wired into this path, and guessing "no spare" would quietly approve
  //     rentals the pool could have covered. Surfaced for a human instead of
  //     silently skipped.
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

/** Everything the engine needs that the technician cannot be trusted to supply. */
async function factsFor(ldap: string) {
  const { rows } = await db.execute(sql`
    SELECT a.employment_status,
           a.district_no,
           a.home_state,
           upper(a.tech_racfid) AS ldap,
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
    WHERE upper(a.tech_racfid) = upper(${ldap})
    LIMIT 1
  `);
  return (rows as any[])[0] ?? null;
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

  let enrolled = 0;
  for (const r of rows) {
    const ldap = String(r.enterprise_id || "").trim().toUpperCase();
    if (!ldap) continue;
    const status = r.byov_enrollment_status ? String(r.byov_enrollment_status) : null;
    if ((status || "").toUpperCase() === "ENROLLED") enrolled++;
    await db.execute(sql`
      INSERT INTO vrm_byov_status (ldap, status, is_new_hire, pilot_tier, started_on, synced_at)
      VALUES (${ldap}, ${status}, ${r.byov_is_new_hire === true || r.byov_is_new_hire === "True"},
              ${r.byov_pilot_tier ?? null}, ${r.byov_started_date ?? null}, now())
      ON CONFLICT (ldap) DO UPDATE SET
        status = EXCLUDED.status, is_new_hire = EXCLUDED.is_new_hire,
        pilot_tier = EXCLUDED.pilot_tier, started_on = EXCLUDED.started_on,
        synced_at = now()
    `);
  }
  console.log(`[byov-mirror] synced ${rows.length} rows, ${enrolled} enrolled`);
  return { synced: rows.length, enrolled };
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------
export function registerRentalRequestPublicRoutes(app: Express): void {
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
      const s = (v: any, max = 300) => String(v ?? "").trim().slice(0, max) || null;
      const bool = (v: any) => (v === true || v === "yes" ? true : v === false || v === "no" ? false : null);
      const num = (v: any) => (v === "" || v == null || Number.isNaN(Number(v)) ? null : Number(v));

      const category = s(b.problemCategory, 40) ?? "";
      if (!PROBLEM_CATEGORIES.has(category)) {
        return res.status(400).json({ success: false, message: "Please choose what is wrong with the vehicle." });
      }

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
      // required on a path the technician never reached.
      const acksRequired = verdict.decision === "APPROVE" || verdict.decision === "REVIEW";
      const acks = {
        ack_not_maintenance: b.ackNotMaintenance === true,
        ack_cannot_drive_safely: b.ackCannotDriveSafely === true,
        ack_has_appointment: b.ackHasAppointment === true,
        ack_last_resort: b.ackLastResort === true,
        ack_return_one_day: b.ackReturnOneDay === true,
        ack_accurate: b.ackAccurate === true,
      };
      if (acksRequired && !Object.values(acks).every(Boolean)) {
        return res.status(400).json({ success: false, message: "Please tick every acknowledgement before submitting." });
      }

      const status =
        verdict.decision === "APPROVE" ? "approved"
        : verdict.decision === "DENY" ? "denied"
        : verdict.decision === "DEFER" ? "deferred"
        : "screened";

      const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();

      // One row per token. A technician who was deferred and has now come back
      // supersedes their own earlier deferral rather than adding a duplicate.
      await db.execute(sql`
        DELETE FROM vrm_rental_request
        WHERE token_id = ${row.id} AND status = 'deferred'
      `);

      const { rows: ins } = await db.execute(sql`
        INSERT INTO vrm_rental_request (
          token_id, ldap, tech_name, truck_number, district, home_state, mobile_phone,
          identity_corrected, identity_correction, is_byov,
          problem_category, symptom, is_drivable, is_safe_to_drive, occurred_at,
          jobs_affected, what_was_tried,
          shop_name, shop_address, shop_city, shop_state, shop_postal, shop_phone,
          has_appointment, appointment_at, shop_estimated_days,
          policy_version, policy_acknowledged_at, policy_ip,
          ack_not_maintenance, ack_cannot_drive_safely, ack_has_appointment,
          ack_last_resort, ack_return_one_day, ack_accurate,
          approved_vehicle_class, reason_code, region_owner,
          status, auto_decision, auto_reason, auto_rule
        ) VALUES (
          ${row.id}, ${ldap}, ${row.tech_name || null}, ${s(b.truckNumber, 30) || row.truck_number},
          ${s(b.district, 20)}, ${s(b.homeState, 2)}, ${s(b.mobilePhone, 30) || row.phone},
          ${b.identityCorrected === true}, ${s(b.identityCorrection, 400)}, ${isByov},
          ${category}, ${s(b.symptom, 1000)}, ${bool(b.isDrivable)}, ${bool(b.isSafeToDrive)},
          ${s(b.occurredAt, 40)}::timestamptz, ${num(b.jobsAffected)}, ${s(b.whatWasTried, 1000)},
          ${s(b.shopName, 200)}, ${s(b.shopAddress, 300)}, ${s(b.shopCity, 80)},
          ${s(b.shopState, 2)}, ${s(b.shopPostal, 12)}, ${s(b.shopPhone, 30)},
          ${bool(b.hasAppointment)}, ${s(b.appointmentAt, 40)}::timestamptz, ${num(b.shopEstimatedDays)},
          ${POLICY_VERSION}, ${acksRequired ? sql`now()` : null}, ${ip || null},
          ${acks.ack_not_maintenance}, ${acks.ack_cannot_drive_safely}, ${acks.ack_has_appointment},
          ${acks.ack_last_resort}, ${acks.ack_return_one_day}, ${acks.ack_accurate},
          ${verdict.vehicleClass ?? null}, ${verdict.reason}, ${s(b.regionOwner, 80)},
          ${status}, ${verdict.decision}, ${verdict.reason}, ${verdict.rule}
        )
        RETURNING request_no
      `);

      // A DEFER tells the technician to go book an appointment and come back.
      // Consuming the token here would make that instruction impossible to
      // follow, so the link stays live and the next submit supersedes this row.
      if (verdict.decision !== "DEFER") {
        await db.execute(sql`UPDATE vrm_form_tokens SET submitted_at = now() WHERE id = ${row.id}`);
      }

      res.json({
        success: true,
        requestNo: (ins as any[])[0]?.request_no ?? null,
        decision: verdict.decision,
        rule: verdict.rule,
        message: verdict.script ?? null,
      });
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
  router.get("/forms/rental-request/booking-queue", async (_req, res) => {
    try {
      const { rows } = await db.execute(sql`
        SELECT r.request_no, r.ldap, r.tech_name, r.truck_number, r.mobile_phone,
               r.shop_name, r.shop_address, r.shop_city, r.shop_state, r.shop_postal,
               r.appointment_at,
               r.shop_estimated_days,
               COALESCE(r.approved_vehicle_class, 'sedan')          AS vehicle_class,
               to_char(r.appointment_at, 'YYYY-MM-DD"T"HH24:MI:SS')  AS start_dt,
               to_char(r.appointment_at + ((COALESCE(r.shop_estimated_days,1) + 1) * interval '1 day'),
                       'YYYY-MM-DD"T"HH24:MI:SS')                    AS end_dt,
               r.ldap || '-' || COALESCE(r.truck_number,'NA')        AS reference
        FROM vrm_rental_request r
        WHERE r.status = 'approved'
          AND r.etd_booked_at IS NULL
          AND r.appointment_at IS NOT NULL
          AND COALESCE(r.is_byov, false) = false
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

      if (error) {
        await db.execute(sql`
          UPDATE vrm_rental_request
          SET etd_error = ${error.slice(0, 500)}, updated_at = now()
          WHERE request_no = ${no}
        `);
        return res.json({ ok: true, recorded: "error" });
      }
      if (!ref && !resId) {
        return res.status(400).json({ message: "supply etdReference/etdReservationId, or error" });
      }
      const { rows } = await db.execute(sql`
        UPDATE vrm_rental_request
        SET etd_reference = ${ref || null}, etd_reservation_id = ${resId || null},
            etd_booked_at = now(), etd_error = NULL,
            status = 'booked', updated_at = now()
        WHERE request_no = ${no}
        RETURNING request_no, status
      `);
      if (!(rows as any[]).length) return res.status(404).json({ message: "request not found" });
      res.json({ ok: true, ...(rows as any[])[0] });
    } catch (e: any) {
      console.error("[rental-request] booked failed:", e?.message || e);
      res.status(500).json({ message: e?.message || "Failed to record booking." });
    }
  });

  /** Human decision. May overrule the engine, and must say why when it does. */
  router.post("/forms/rental-request/:requestNo/decide", async (req, res) => {
    try {
      const decision = String(req.body?.decision || "").toUpperCase();
      if (!["APPROVE", "DENY", "DEFER"].includes(decision)) {
        return res.status(400).json({ message: "decision must be APPROVE, DENY or DEFER" });
      }
      const note = String(req.body?.note || "").trim();
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

      await db.execute(sql`
        UPDATE vrm_rental_request
        SET status = ${decision === "APPROVE" ? "approved" : decision === "DENY" ? "denied" : "deferred"},
            decided_by = ${actor}, decided_at = now(), decision_note = ${note || null},
            updated_at = now()
        WHERE request_no = ${Number(req.params.requestNo)}
      `);
      res.json({ ok: true, decision });
    } catch (e: any) {
      res.status(500).json({ message: e?.message || "decide failed" });
    }
  });
}
