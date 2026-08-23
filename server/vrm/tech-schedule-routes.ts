/**
 * Technician schedule read routes.
 *
 * Mounted on the session-gated VRM router, so the full prefix is
 * `/api/vrm/tech-schedule/...`.
 *
 * WHY A NEW SURFACE
 * -----------------
 * Before this, the only way to read a technician's schedule from Nexus was
 * `GET /api/vrm/forms/rental-survey/cutover/schedule-check`, which is
 * `requireInternalCron` — a bearer-token route built for the Python runner.
 * No session-gated schedule endpoint existed, so no page could show one.
 *
 * These routes read Mauricio Marino's tech-shifts feed (see
 * `server/tech-shifts-client.ts`), NOT the ServicePower snapshot behind
 * `fetchScheduleWindow()`. The cutover booking gate is untouched.
 *
 * ROUTE ORDER IS LOAD-BEARING. `/:ldap` is a catch-all and must be registered
 * LAST, or `/health`, `/search`, `/batch` and `/district/...` all resolve to it
 * and get looked up as technicians named "health", "search" and so on.
 */

import type { Router } from "express";
import { sql } from "drizzle-orm";

import { db } from "../db";
import {
  addDaysISO,
  getDistrictSchedules,
  getTechSchedule,
  getTechSchedules,
  isTechShiftsConfigured,
  normalizeShiftLdap,
  startOfWeekISO,
  TechShiftsError,
} from "../tech-shifts-client";

/** Longest window a single request may ask for. */
const MAX_WINDOW_DAYS = 120;
/** Most technicians one batch call will fan out to. */
const MAX_BATCH_LDAPS = 60;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Today in Eastern, matching `etTodayISO()` used elsewhere in the VRM lane. */
function etTodayISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Resolve the window. Defaults to the Monday-anchored current week plus the
 * following one, which is the span a rental decision actually spans.
 */
function resolveWindow(query: Record<string, unknown>): { start: string; end: string } | { error: string } {
  const rawStart = String(query.start ?? "").trim();
  const rawEnd = String(query.end ?? "").trim();

  const start = ISO_DATE.test(rawStart) ? rawStart : startOfWeekISO(etTodayISO());
  if (rawStart && !ISO_DATE.test(rawStart)) return { error: "start must be YYYY-MM-DD" };
  if (rawEnd && !ISO_DATE.test(rawEnd)) return { error: "end must be YYYY-MM-DD" };

  const end = ISO_DATE.test(rawEnd) ? rawEnd : addDaysISO(start, 13);
  if (end < start) return { error: "end must be on or after start" };

  // Guard the unfiltered-pull footgun: a wide district window is megabytes.
  const spanDays = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
  if (spanDays > MAX_WINDOW_DAYS) return { error: `window may not exceed ${MAX_WINDOW_DAYS} days` };

  return { start, end };
}

/**
 * Map a client error onto an HTTP status. A missing secret is a 503 with a
 * `configured:false` flag rather than a 500, so the UI can say "not wired up
 * yet" instead of "something broke".
 */
function sendClientError(res: any, err: unknown): void {
  if (err instanceof TechShiftsError) {
    const status =
      err.code === "CONFIG_MISSING" ? 503
      : err.code === "BAD_REQUEST" ? 400
      : err.code === "AUTHENTICATION_FAILED" ? 502
      : err.code === "RATE_LIMITED" ? 429
      : err.code === "TIMEOUT" ? 504
      : 502;
    res.status(status).json({
      message: err.message,
      code: err.code,
      configured: err.code !== "CONFIG_MISSING",
    });
    return;
  }
  const message = (err as any)?.message || "tech schedule lookup failed";
  console.error("[tech-schedule]", message);
  res.status(500).json({ message, code: "UNKNOWN" });
}

export function registerTechScheduleRoutes(router: Router): void {
  // ---------------------------------------------------------------- health
  // Answers "is the feed wired up and answering?" without making the caller
  // guess from a failed data request.
  router.get("/tech-schedule/health", async (_req, res) => {
    const configured = isTechShiftsConfigured();
    if (!configured) {
      return res.json({
        configured: false,
        reachable: false,
        message: "TECH_SHIFTS_API_KEY is not set in Replit Secrets",
      });
    }
    const today = etTodayISO();
    const startedAt = Date.now();
    try {
      const probe = await getDistrictSchedules("__healthcheck__", today, today);
      res.json({
        configured: true,
        reachable: true,
        latencyMs: Date.now() - startedAt,
        // A nonsense district legitimately returns zero rows; reaching this
        // line at all is the signal, not the count.
        probeRows: probe.length,
      });
    } catch (err) {
      res.json({
        configured: true,
        reachable: false,
        latencyMs: Date.now() - startedAt,
        message: err instanceof Error ? err.message : String(err),
        code: err instanceof TechShiftsError ? err.code : "UNKNOWN",
      });
    }
  });

  // ---------------------------------------------------------------- search
  // The name -> LDAP picker. The shifts feed has no search endpoint and a
  // whole-fleet pull is ~3.6 MB, so the roster answers this and the LDAP it
  // returns is what gets sent upstream.
  router.get("/tech-schedule/search", async (req, res) => {
    try {
      const q = String(req.query.q ?? "").trim();
      const limit = Math.max(1, Math.min(Number(req.query.limit ?? 20) || 20, 100));
      if (q.length < 2) return res.json({ results: [], message: "type at least 2 characters" });

      // Strip the LIKE wildcards rather than escaping them. Nobody searches a
      // technician by "%", and dropping them means no ESCAPE clause to get
      // wrong through two layers of quoting.
      const like = `%${q.replace(/[%_\\]/g, "")}%`;
      const { rows } = await db.execute(sql`
        SELECT tech_racfid AS ldap,
               tech_name,
               first_name,
               last_name,
               job_title,
               district_no,
               employment_status
        FROM all_techs
        WHERE employment_status IS DISTINCT FROM 'T'
          AND (
            tech_racfid ILIKE ${like}
            OR tech_name ILIKE ${like}
            OR (COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')) ILIKE ${like}
          )
        ORDER BY
          -- an exact LDAP match is what the operator pasted; float it
          CASE WHEN UPPER(tech_racfid) = ${q.toUpperCase()} THEN 0 ELSE 1 END,
          last_name NULLS LAST, first_name NULLS LAST
        LIMIT ${limit}
      `);

      res.json({
        results: (rows as any[]).map((r) => ({
          ldap: normalizeShiftLdap(r.ldap),
          name:
            r.first_name && r.last_name
              ? `${r.first_name} ${r.last_name}`
              : String(r.tech_name ?? "").replace(/^([^,]+),\s*(.+)$/, "$2 $1"),
          jobTitle: r.job_title ?? null,
          district: r.district_no ?? null,
          employmentStatus: r.employment_status ?? null,
        })),
      });
    } catch (err) {
      sendClientError(res, err);
    }
  });

  // ----------------------------------------------------------------- batch
  // Several technicians in one call, for a table of rental requests.
  router.get("/tech-schedule/batch", async (req, res) => {
    try {
      const raw = String(req.query.ldaps ?? "");
      const ldaps = Array.from(
        new Set(raw.split(",").map(normalizeShiftLdap).filter(Boolean)),
      );
      if (!ldaps.length) return res.status(400).json({ message: "ldaps is required (comma-separated)" });
      if (ldaps.length > MAX_BATCH_LDAPS) {
        return res.status(400).json({ message: `at most ${MAX_BATCH_LDAPS} ldaps per call, got ${ldaps.length}` });
      }
      const win = resolveWindow(req.query as Record<string, unknown>);
      if ("error" in win) return res.status(400).json({ message: win.error });

      const schedules = await getTechSchedules(ldaps, win.start, win.end);
      res.json({ start: win.start, end: win.end, requested: ldaps.length, schedules });
    } catch (err) {
      sendClientError(res, err);
    }
  });

  // -------------------------------------------------------------- district
  router.get("/tech-schedule/district/:district", async (req, res) => {
    try {
      const district = String(req.params.district ?? "").trim();
      if (!district) return res.status(400).json({ message: "district is required" });
      const win = resolveWindow(req.query as Record<string, unknown>);
      if ("error" in win) return res.status(400).json({ message: win.error });

      const schedules = await getDistrictSchedules(district, win.start, win.end);
      res.json({ start: win.start, end: win.end, district, count: schedules.length, schedules });
    } catch (err) {
      sendClientError(res, err);
    }
  });

  // ------------------------------------------------------- single (LAST!)
  // Registered last on purpose: `:ldap` would otherwise swallow every literal
  // path above it.
  router.get("/tech-schedule/:ldap", async (req, res) => {
    try {
      const ldap = normalizeShiftLdap(req.params.ldap);
      if (!ldap) return res.status(400).json({ message: "ldap is required" });
      const win = resolveWindow(req.query as Record<string, unknown>);
      if ("error" in win) return res.status(400).json({ message: win.error });

      const schedule = await getTechSchedule(ldap, win.start, win.end);

      // Attach the roster identity so the UI can show a real name even when the
      // feed has no rows for this technician — "GGILLIS has no schedule" is a
      // far more useful answer than an empty panel.
      let roster: { name: string | null; jobTitle: string | null; district: string | null } | null = null;
      try {
        const { rows } = await db.execute(sql`
          SELECT first_name, last_name, tech_name, job_title, district_no
          FROM all_techs
          WHERE UPPER(tech_racfid) = ${ldap}
          ORDER BY employment_status = 'A' DESC, updated_at DESC
          LIMIT 1
        `);
        const r = (rows as any[])[0];
        if (r) {
          roster = {
            name:
              r.first_name && r.last_name
                ? `${r.first_name} ${r.last_name}`
                : String(r.tech_name ?? "").replace(/^([^,]+),\s*(.+)$/, "$2 $1") || null,
            jobTitle: r.job_title ?? null,
            district: r.district_no ?? null,
          };
        }
      } catch {
        // The roster is a nicety. A schedule without a display name still ships.
      }

      res.json({ ...schedule, roster });
    } catch (err) {
      sendClientError(res, err);
    }
  });
}
