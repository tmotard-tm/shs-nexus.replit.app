/**
 * Truck Maintenance workflow — HTTP surface.
 *
 * Registered inside the /api/fs router, so every route here inherits that
 * router's session auth. That inherited gate only proves SOMEONE is logged in,
 * which is not enough here: these routes text technicians, book their day and
 * pause the workflow. So every human route additionally requires a privileged
 * role (the sidebar link being developer-only is a UI affordance, not
 * authorization), and the cron route re-checks the shared secret itself rather
 * than trusting the router's x-internal-cron bypass.
 *
 * Read routes are for the monitoring screen. Write routes are exactly three:
 * retry one cycle, flip the kill switch, run the sweep. The TEST-filing escape
 * hatch on retry is narrower still — developers only, because it POSTs a real
 * activity upstream to prove the wire.
 */
import type { Router } from "express";
import { sql } from "drizzle-orm";

import { db } from "../db";
import {
  MAINTENANCE_BLOCK_DURATION_MIN,
  MAINTENANCE_TRIGGER_MILES,
  MAINTENANCE_WINDOW_DAYS,
  getMaintenanceActivityType,
  getMaintenanceApproachingMiles,
  getMaintenanceBookingLeadDays,
  isMaintenanceActivityTypeConfirmed,
  isMaintenanceBookingLive,
  isMaintenanceSmsLive,
} from "./constants";
import { EXCLUSION_LABELS } from "./eligibility";
import {
  SETTING_LAST_SWEEP_DATE,
  getSetting,
  getApproachingThresholdTrucks,
  getFleetRoster,
  getMissingOdometerReport,
  isCycleOpeningPaused,
  type MissingOdometerCounts,
  recordConfirmedSlot,
  retryCycle,
  runDailySweep,
  runMaintenancePipeline,
  setCycleOpeningPaused,
  todayInET,
} from "./engine";
import { initTruckMaintenanceSchema } from "./schema-init";

function isInternalCron(req: any): boolean {
  const t = req.headers?.["x-internal-cron"];
  const s = process.env.SESSION_SECRET;
  const cron = process.env.NEXUS_CRON_SECRET;
  return !!(t && ((s && t === s) || (cron && t === cron)));
}

function actorOf(req: any): string | null {
  return req?.user?.username || req?.user?.id || null;
}

/**
 * Fleet staff who operate this workflow. Same two roles the comms module
 * treats as privileged; every other authenticated role (e.g. `agent`) is a
 * regular app user who must not be able to start a fleet-wide sweep.
 */
export function isPrivilegedActor(user: any): boolean {
  const role = String(user?.role || "").toLowerCase();
  return role === "developer" || role === "admin";
}

/** The TEST-filing hatch files a real upstream activity — developers only. */
export function isDeveloperActor(user: any): boolean {
  return String(user?.role || "").toLowerCase() === "developer";
}

/**
 * Authorization for the human routes. Deliberately does NOT honour the
 * x-internal-cron bypass: the scheduler gets exactly one route (cron/sweep),
 * and the secret must not also confer retry / pause / run-now powers.
 */
function requireStaff(req: any, res: any, next: any) {
  if (isPrivilegedActor(req.user)) return next();
  return res.status(403).json({ message: "Forbidden" });
}

export function registerTruckMaintenanceRoutes(app: Router): void {
  /**
   * Workflow health: both gates, the kill switch, when the sweep last ran and
   * a state rollup. This is what the monitoring screen leads with, because
   * "why has nothing gone out?" is almost always answered by a gate.
   */
  app.get("/truck-maintenance/status", requireStaff, async (_req, res) => {
    try {
      await initTruckMaintenanceSchema();
      const [paused, lastSweep, counts, watermarks] = await Promise.all([
        isCycleOpeningPaused(),
        getSetting(SETTING_LAST_SWEEP_DATE),
        db.execute(sql`
          SELECT status, COUNT(*)::int AS n
            FROM fs_truck_maintenance_cycles
           WHERE closed_at IS NULL
           GROUP BY status
        `),
        db.execute(sql`SELECT COUNT(*)::int AS n FROM fs_truck_maintenance_watermarks`),
      ]);
      const byStatus: Record<string, number> = {};
      for (const row of ((counts as any).rows ?? [])) byStatus[row.status] = row.n;
      const bookedTotal: any = await db.execute(sql`
        SELECT COUNT(*)::int AS n FROM fs_truck_maintenance_cycles WHERE status = 'booked'
      `);

      // Trucks the sweep cannot see (no usable odometer). Isolated so a
      // failure here degrades ONE number on the card — visibly, with the
      // error text — instead of taking down the whole gates view.
      let missingOdometer: MissingOdometerCounts | null = null;
      let missingOdometerError: string | null = null;
      try {
        missingOdometer = (await getMissingOdometerReport()).counts;
      } catch (err: any) {
        missingOdometerError = err?.message || String(err);
      }

      res.json({
        triggerMiles: MAINTENANCE_TRIGGER_MILES,
        blockDurationMinutes: MAINTENANCE_BLOCK_DURATION_MIN,
        bookingLeadDays: getMaintenanceBookingLeadDays(),
        smsLive: isMaintenanceSmsLive(),
        bookingLive: isMaintenanceBookingLive(),
        activityTypeConfirmed: isMaintenanceActivityTypeConfirmed(),
        activityType: getMaintenanceActivityType(),
        paused,
        lastSweepDateET: lastSweep,
        todayET: todayInET(),
        watermarks: ((watermarks as any).rows ?? [])[0]?.n ?? 0,
        openByStatus: byStatus,
        openTotal: Object.values(byStatus).reduce((a, b) => a + b, 0),
        bookedTotal: ((bookedTotal as any).rows ?? [])[0]?.n ?? 0,
        exclusionLabels: EXCLUSION_LABELS,
        missingOdometer,
        missingOdometerError,
      });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "status failed" });
    }
  });

  /** Cycle list for the monitoring table. */
  app.get("/truck-maintenance/cycles", requireStaff, async (req, res) => {
    try {
      await initTruckMaintenanceSchema();
      const status = String((req.query.status as string) || "").trim();
      const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit ?? "200"), 10) || 200, 1), 1000);
      const openOnly = String(req.query.openOnly ?? "") === "true";

      const rows: any = await db.execute(sql`
        SELECT id, truck_number, vin, ldap, enterprise_id, tech_name, district, status,
               odometer_at_trigger, watermark_at_trigger, miles_since_watermark,
               odometer_source, odometer_date, exclusion_reason, exclusion_detail,
               eligibility_checked_at, text_status, text_body, text_detail,
               text_claimed_at, texted_at,
               to_char(trigger_date, 'YYYY-MM-DD') AS trigger_date,
               to_char(booking_window_start, 'YYYY-MM-DD') AS booking_window_start,
               to_char(booking_window_end, 'YYYY-MM-DD') AS booking_window_end,
               booking_due_at, booking_date, booking_status, booking_project_name,
               booking_project_id, booking_detail, booking_claimed_at, booking_attempted_at,
               booking_test_status, booking_test_detail, booking_test_project_name, booking_test_at,
               booked_at, confirmation_status,
               to_char(confirmed_slot_date::date, 'YYYY-MM-DD') AS confirmed_slot_date,
               confirmed_slot_time,
               follow_up_claimed_at, follow_up_sent_at, follow_up_message_id, follow_up_detail,
               attempts, last_error,
               opened_at, closed_at, updated_at
          FROM fs_truck_maintenance_cycles
         WHERE (${status} = '' OR status = ${status})
           AND (${openOnly} = false OR closed_at IS NULL)
         ORDER BY (closed_at IS NULL) DESC, opened_at DESC
         LIMIT ${limit}
      `);
      res.json({ cycles: (rows.rows ?? []) });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "cycle list failed" });
    }
  });

  /**
   * Approaching-threshold view — read-only.
   *
   * Returns trucks within N miles of the 5,500-mile trigger that have no open
   * cycle yet, enriched with the currently-assigned technician from TPMS.
   * N defaults to 500 (TRUCK_MAINTENANCE_APPROACHING_MILES env).
   */
  app.get("/truck-maintenance/approaching", requireStaff, async (req: any, res) => {
    try {
      const overrideMiles = req.query.miles !== undefined
        ? Number.parseInt(String(req.query.miles), 10)
        : undefined;
      const approachingMiles = Number.isFinite(overrideMiles!) ? overrideMiles! : getMaintenanceApproachingMiles();
      const trucks = await getApproachingThresholdTrucks(approachingMiles);
      res.json({
        approachingMiles,
        triggerMiles: MAINTENANCE_TRIGGER_MILES,
        trucks,
      });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "approaching query failed" });
    }
  });

  /**
   * Missing-odometer report — read-only (Task #675).
   *
   * The trucks the sweep cannot see: active cache rows whose reconciled
   * odometer is NULL or outside the 1,000–600,000-mile sanity window. Listed
   * with what IS known (last reading, its date, its source) so a human can
   * chase the feed. Purely informational — a missing reading is never zero
   * miles and never opens a cycle.
   */
  app.get("/truck-maintenance/missing-odometer", requireStaff, async (_req, res) => {
    try {
      const report = await getMissingOdometerReport();
      res.json(report);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "missing-odometer report failed" });
    }
  });

  /**
   * Fleet roster — read-only (Task #680).
   *
   * Every eligible truck (BYOV and AMS In Repair / Declined Repair / Sent To
   * Auction excluded) with its reconciled odometer and TPMS technician, from
   * the SAME reads the sweep performs. The underlying sources refresh on
   * their existing daily cadences; this route always reads current rows and
   * reports how fresh each source is. There is deliberately no write path.
   */
  app.get("/truck-maintenance/roster", requireStaff, async (_req, res) => {
    try {
      const roster = await getFleetRoster();
      res.json(roster);
    } catch (err: any) {
      // Only the identified "AMS map still warming" condition is a retryable
      // 503 the client polls through. Everything else (DB down, TPMS read
      // failure, a code bug) is a real error and must surface as one —
      // otherwise a permanent failure looks like an endless loading state.
      if (err?.name === "AmsMapWarmingError") {
        return res.status(503).json({ warming: true, message: err?.message });
      }
      res.status(500).json({ warming: false, message: err?.message || "roster failed" });
    }
  });

  /**
   * Record the DCA-confirmed slot on a booked cycle, unlocking the
   * confirmation follow-up text. The next pipeline sweep picks up any cycle
   * with `confirmation_status = 'confirmed'` and sends the SMS.
   *
   * Body: { slotDate: "YYYY-MM-DD", slotTime?: "HH:MM", force?: boolean }
   */
  app.post("/truck-maintenance/cycles/:id/confirm", requireStaff, async (req: any, res) => {
    try {
      const id = Number.parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id)) return res.status(400).json({ message: "bad cycle id" });
      const slotDate = String(req.body?.slotDate ?? "").trim();
      const slotTime = req.body?.slotTime ? String(req.body.slotTime).trim() : null;
      if (!slotDate) return res.status(400).json({ message: "slotDate is required (YYYY-MM-DD)" });
      const result = await recordConfirmedSlot(id, {
        slotDate,
        slotTime,
        actor: actorOf(req),
        force: req.body?.force === true,
      });
      if (!result.ok) return res.status(409).json({ message: result.error });
      res.json({ success: true, cycleId: id, slotDate, slotTime });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "confirm slot failed" });
    }
  });

  /**
   * Manual retry for one failed cycle.
   *
   * `testFiling: true` is the deliberate escape hatch: it POSTs ONE
   * TEST-prefixed activity so an operator can prove the wire before the live
   * gate is armed. It never closes the cycle and never advances the watermark,
   * so the real filing still happens later.
   */
  app.post("/truck-maintenance/cycles/:id/retry", requireStaff, async (req: any, res) => {
    try {
      const id = Number.parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id)) return res.status(400).json({ message: "bad cycle id" });
      const testFiling = req.body?.testFiling === true;
      if (testFiling && !isDeveloperActor(req.user)) {
        return res.status(403).json({ message: "TEST filing is restricted to developers" });
      }
      const result = await retryCycle(id, { testFiling, actor: actorOf(req) });
      if (!result.ok) return res.status(409).json({ message: result.error });
      res.json({ success: true, outcome: result.outcome });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "retry failed" });
    }
  });

  /** Kill switch: pause/resume cycle OPENING. In-flight cycles keep running. */
  app.post("/truck-maintenance/pause", requireStaff, async (req: any, res) => {
    try {
      await initTruckMaintenanceSchema();
      const paused = req.body?.paused === true;
      await setCycleOpeningPaused(paused, actorOf(req));
      res.json({ success: true, paused });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "pause toggle failed" });
    }
  });

  /**
   * Operator-run sweep (the monitoring screen's "Run now"). Always forced —
   * a human clicked it — but still subject to both live gates.
   */
  app.post("/truck-maintenance/run", requireStaff, async (req: any, res) => {
    try {
      await initTruckMaintenanceSchema();
      const summary = await runMaintenancePipeline({
        maxCycles: Number.parseInt(String(req.body?.maxCycles ?? ""), 10) || undefined,
      });
      res.json({ success: true, summary });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "sweep failed" });
    }
  });

  /**
   * The production cadence. Pinged every few minutes by the external
   * scheduler; runDailySweep decides whether today's run is actually due.
   */
  app.post("/truck-maintenance/cron/sweep", async (req: any, res) => {
    if (!isInternalCron(req)) return res.status(403).json({ message: "Forbidden" });
    try {
      await initTruckMaintenanceSchema();
      const force = req.body?.force === true || String(req.query.force ?? "") === "true";
      const result = await runDailySweep({ force, trigger: "cron" });
      res.json({ success: true, ...result });
    } catch (err: any) {
      console.error(`[TruckMaint] cron sweep failed: ${err?.message || err}`);
      res.status(500).json({ success: false, message: err?.message || "cron sweep failed" });
    }
  });
}
