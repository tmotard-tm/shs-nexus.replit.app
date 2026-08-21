/**
 * Truck Maintenance SMS + 4-hour booking workflow — the engine.
 *
 * One pipeline, run on a schedule:
 *
 *   seed      every truck the app has a plausible reconciled odometer for gets
 *             a watermark on first sight, set to its CURRENT odometer, so an
 *             existing fleet does not all fire at once on day one.
 *
 *   open      a truck whose odometer is MAINTENANCE_TRIGGER_MILES past its
 *             watermark opens a cycle. The database (partial unique index on
 *             open cycles) is what makes this idempotent — not this code.
 *
 *   process   every open cycle is re-evaluated against the eligibility gate,
 *             then texted, then (a few days later) booked. Eligibility is
 *             re-checked immediately before the send AND before the booking:
 *             a cycle can sit for days, which is long enough for a truck to
 *             go into repair or a tech to end up in a rental.
 *
 *   close     a booked cycle closes and advances the watermark, which is what
 *             stops the same 5,500 miles firing twice.
 *
 * Dark-launch semantics (both gates default OFF and are independent):
 *
 *   SMS off      -> the send path runs as a comms dry run (phone, opt-out and
 *                   quiet-hours checks all really execute) and records what
 *                   WOULD go out. texted_at stays null, so arming the flag
 *                   later still sends that cycle's first real text.
 *   booking off  -> the payload is built and stored, never POSTed — not even
 *                   TEST-prefixed. A fleet-wide sweep firing TEST projects
 *                   would litter the upstream system; use the per-cycle test
 *                   filing on the monitoring screen to smoke-test one row.
 *
 * Nothing in here throws at the caller for a per-truck failure: a failure
 * lands on its own cycle row as `failed` with the error text, and a human
 * retries it from the monitoring screen.
 */
import { sql } from "drizzle-orm";

import { db } from "../db";
import {
  buildStandardActivityPayload,
  nextBusinessDay,
  sendStandardActivity,
} from "../vrm/dca-task-client";
import { sendMessage } from "../fleet-comms/outbound";
import { toCanonical } from "../vehicle-number-utils";
import {
  MAINTENANCE_BLOCK_DURATION_MIN,
  MAINTENANCE_COMMS_CATEGORY,
  MAINTENANCE_CONFIRMATION_COMMS_CATEGORY,
  MAINTENANCE_PROJECT_LABEL,
  MAINTENANCE_PROJECT_NOTES,
  MAINTENANCE_START_TIME,
  MAINTENANCE_TRIGGER_MILES,
  MAINTENANCE_WINDOW_DAYS,
  ODOMETER_MAX,
  ODOMETER_MIN,
  buildMaintenanceConfirmationMessage,
  buildMaintenanceMessage,
  buildMaintenanceRowNotes,
  getMaintenanceActivityType,
  getMaintenanceApproachingMiles,
  getMaintenanceBookingLeadDays,
  getMaintenanceDigestRecipients,
  getMaintenanceStaleExclusionDays,
  isMaintenanceBookingLive,
  isMaintenanceSmsLive,
} from "./constants";
import {
  buildEligibilityContext,
  evaluateCandidate,
  isBlockingAmsStatus,
  loadTechAssignments,
  resolveTechRacf,
  type EligibilityContext,
  type TechAssignment,
  type TruckCandidate,
} from "./eligibility";

/* ------------------------------------------------------------------------ *
 * Pure helpers — the arithmetic the whole workflow hangs on.
 * ------------------------------------------------------------------------ */

/** A reading outside the sanity window is a data error, not mileage. */
export function isPlausibleOdometer(value: number | null | undefined): value is number {
  return (
    typeof value === "number"
    && Number.isFinite(value)
    && value >= ODOMETER_MIN
    && value <= ODOMETER_MAX
  );
}

/**
 * Should a cycle open? Only when the current reading is plausible AND at least
 * MAINTENANCE_TRIGGER_MILES past the watermark. A reading BELOW the watermark
 * (odometer rollback, a bad source, a swapped VIN) never triggers and never
 * moves the watermark.
 */
export function shouldOpenCycle(
  currentOdometer: number | null | undefined,
  watermark: number | null | undefined,
  trigger: number = MAINTENANCE_TRIGGER_MILES,
): boolean {
  if (!isPlausibleOdometer(currentOdometer)) return false;
  if (typeof watermark !== "number" || !Number.isFinite(watermark)) return false;
  return currentOdometer - watermark >= trigger;
}

/**
 * The watermark after a cycle is booked. Monotonic by construction: the
 * highest of what we had, what triggered the cycle, and the reading at
 * booking time (the closest proxy for the mileage at the actual service).
 */
export function computeWatermarkAdvance(
  existingWatermark: number,
  odometerAtTrigger: number,
  currentOdometer: number | null | undefined,
): number {
  const candidates = [existingWatermark, odometerAtTrigger];
  if (isPlausibleOdometer(currentOdometer)) candidates.push(currentOdometer);
  return Math.max(...candidates);
}

/** YYYY-MM-DD in America/New_York — ops staff and the ET hour window run on it. */
export function todayInET(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
}

/** Hour of day (0-23) in America/New_York. */
export function hourInET(now: Date = new Date()): number {
  return Number.parseInt(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hour12: false }).format(now),
    10,
  );
}

export const SWEEP_WINDOW_START_HOUR_ET = 9;
export const SWEEP_WINDOW_END_HOUR_ET = 17;

/**
 * The cron endpoint is pinged every few minutes (in-process timers do not
 * reliably fire on autoscale), so the "run once a day, during business hours"
 * decision has to live here rather than in a cron expression.
 */
export function shouldRunDailySweep(args: {
  todayET: string;
  lastRunDateET: string | null;
  hourET: number;
  force?: boolean;
}): { run: boolean; reason: string } {
  if (args.force) return { run: true, reason: "forced" };
  if (args.lastRunDateET === args.todayET) {
    return { run: false, reason: `already ran today (${args.todayET} ET)` };
  }
  if (args.hourET < SWEEP_WINDOW_START_HOUR_ET || args.hourET >= SWEEP_WINDOW_END_HOUR_ET) {
    return {
      run: false,
      reason: `outside the ${SWEEP_WINDOW_START_HOUR_ET}:00-${SWEEP_WINDOW_END_HOUR_ET}:00 ET window (now ${args.hourET}:00 ET)`,
    };
  }
  return { run: true, reason: "due" };
}

/** Booking becomes due this many days after the text actually went out. */
export function computeBookingDueAt(textedAt: Date, leadDays: number = getMaintenanceBookingLeadDays()): Date {
  const due = new Date(textedAt.getTime());
  due.setUTCDate(due.getUTCDate() + leadDays);
  return due;
}

/**
 * Compute the end of the scheduling window: trigger date + MAINTENANCE_WINDOW_DAYS.
 * All arithmetic is UTC so it cannot drift across a timezone boundary.
 */
export function computeWindowEnd(
  triggerDate: string,
  days: number = MAINTENANCE_WINDOW_DAYS,
): string {
  const d = new Date(`${triggerDate.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * True when the end of the scheduling window has already passed today.
 * A stale window is flagged for human review rather than silently re-filed
 * under dates that have passed.
 */
export function isWindowStale(
  windowEnd: string | null | undefined,
  today: string = todayInET(),
): boolean {
  if (!windowEnd) return false;
  return String(windowEnd).slice(0, 10) < today;
}

/**
 * Whole days a cycle has been blocked for its current reason. null when the
 * clock is unset (never excluded, or a pre-migration row not yet backfilled).
 */
export function computeBlockedDays(
  since: Date | string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!since) return null;
  const d = new Date(since as any);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - d.getTime()) / 86_400_000));
}
/* ------------------------------------------------------------------------ *
 * Settings (kill switch + daily watermark)
 * ------------------------------------------------------------------------ */

export const SETTING_PAUSED = "cycle_open_paused";
export const SETTING_LAST_SWEEP_DATE = "last_sweep_date_et";

export const SETTING_LAST_DIGEST_DATE = "last_stale_digest_date_et";
export async function getSetting(key: string): Promise<string | null> {
  const r: any = await db.execute(sql`
    SELECT value FROM fs_truck_maintenance_settings WHERE key = ${key} LIMIT 1
  `);
  const row = (r.rows ?? r ?? [])[0];
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string | null, actor?: string | null): Promise<void> {
  await db.execute(sql`
    INSERT INTO fs_truck_maintenance_settings (key, value, updated_at, updated_by)
    VALUES (${key}, ${value}, now(), ${actor ?? null})
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by
  `);
}

/** Kill switch. Absent = not paused; only an explicit 'true' pauses. */
export async function isCycleOpeningPaused(): Promise<boolean> {
  return (await getSetting(SETTING_PAUSED)) === "true";
}

export async function setCycleOpeningPaused(paused: boolean, actor?: string | null): Promise<void> {
  await setSetting(SETTING_PAUSED, paused ? "true" : "false", actor);
}

/* ------------------------------------------------------------------------ *
 * Candidates + watermark ledger
 * ------------------------------------------------------------------------ */

/**
 * The app's reconciled odometer: holman_vehicles_cache.odometer, the column
 * the nightly enrichment writes after reconciling Holman, Samsara, fuel-card
 * and PO readings (newest plausible reading wins). This workflow deliberately
 * does not re-derive mileage of its own — one reconciled number, one source.
 */
export async function loadOdometerCandidates(): Promise<TruckCandidate[]> {
  const r: any = await db.execute(sql`
    SELECT holman_vehicle_number, vin, odometer, odometer_date, odometer_source
      FROM holman_vehicles_cache
     WHERE odometer IS NOT NULL
       AND odometer BETWEEN ${ODOMETER_MIN} AND ${ODOMETER_MAX}
       AND COALESCE(is_active, true) = true
  `);
  const rows = (r.rows ?? r ?? []) as Array<{
    holman_vehicle_number: string;
    vin: string | null;
    odometer: number | string;
    odometer_date: string | null;
    odometer_source: string | null;
  }>;
  const out: TruckCandidate[] = [];
  for (const row of rows) {
    const display = (row.holman_vehicle_number || "").trim();
    const canonical = toCanonical(display);
    if (!canonical) continue;
    const odometer = typeof row.odometer === "string" ? Number.parseInt(row.odometer, 10) : row.odometer;
    if (!isPlausibleOdometer(odometer)) continue;
    out.push({
      truckNumber: canonical,
      displayNumber: display,
      vin: (row.vin || "").trim() || null,
      odometer,
      odometerDate: row.odometer_date,
      odometerSource: row.odometer_source,
    });
  }
  return out;
}

/* ------------------------------------------------------------------------ *
 * Missing-odometer visibility (Task #675)
 *
 * loadOdometerCandidates only surfaces trucks with a plausible reading, which
 * is correct for the trigger — a missing reading must NEVER be treated as
 * zero miles or as a reason to fire. But it also made those trucks invisible:
 * not "excluded with a reason" like an in-repair truck, simply never present.
 * This report makes the gap a number someone can watch and a list someone can
 * chase, without touching the trigger in any way.
 * ------------------------------------------------------------------------ */

export type MissingOdometerReason = "no_reading" | "below_minimum" | "above_maximum";

export const MISSING_ODOMETER_LABELS: Record<MissingOdometerReason, string> = {
  no_reading: "No odometer reading on file",
  below_minimum: `Reading below the ${ODOMETER_MIN.toLocaleString()}-mile sanity floor`,
  above_maximum: `Reading above the ${ODOMETER_MAX.toLocaleString()}-mile sanity cap`,
};

/**
 * Why a cached reading is unusable, or null when it is plausible. The exact
 * complement of isPlausibleOdometer, split by cause so a human knows whether
 * they are chasing a dead feed (no_reading) or a garbage one (out of bounds).
 */
export function classifyMissingOdometer(
  value: number | string | null | undefined,
): MissingOdometerReason | null {
  if (value === null || value === undefined || value === "") return "no_reading";
  const n = typeof value === "string" ? Number.parseInt(value, 10) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return "no_reading";
  if (n < ODOMETER_MIN) return "below_minimum";
  if (n > ODOMETER_MAX) return "above_maximum";
  return null;
}

export interface MissingOdometerTruck {
  /** The number a human recognises (as stored on the cache row). */
  truckNumber: string;
  vin: string | null;
  /** The raw cached value — data for the feed-chaser, never mileage. */
  lastReading: number | null;
  lastReadingDate: string | null;
  lastReadingSource: string | null;
  reason: MissingOdometerReason;
  ldap: string | null;
  techName: string | null;
  district: string | null;
}

export interface MissingOdometerCounts {
  /** Assigned, non-BYOV trucks with no usable reading — the number to watch. */
  assigned: number;
  byov: number;
  unassigned: number;
  total: number;
}

export interface MissingOdometerReport {
  counts: MissingOdometerCounts;
  /** The watchable gap: the assigned, non-BYOV trucks, with what is known. */
  trucks: MissingOdometerTruck[];
  reasonLabels: Record<MissingOdometerReason, string>;
  generatedAt: string;
}

export interface MissingOdometerRawRow {
  displayNumber: string;
  vin: string | null;
  lastReading: number | null;
  lastReadingDate: string | null;
  lastReadingSource: string | null;
  reason: MissingOdometerReason;
}

/**
 * Pure partition, mirroring the sweep's own scoping rules so this report and
 * the trigger can never disagree about who is out of scope:
 *  - BYOV decided on the RAW/trimmed number (padding first hides 5-digit BYOVs)
 *  - assignment via the same canonical-number TPMS lookup the sweep uses
 * Only the assigned, non-BYOV trucks are LISTED — they are the silent gap the
 * task exists for — but every bucket is counted so nothing vanishes.
 */
export function partitionMissingOdometerRows(
  rows: MissingOdometerRawRow[],
  assignments: Map<string, TechAssignment>,
): { counts: MissingOdometerCounts; trucks: MissingOdometerTruck[] } {
  const counts: MissingOdometerCounts = { assigned: 0, byov: 0, unassigned: 0, total: rows.length };
  const trucks: MissingOdometerTruck[] = [];
  for (const row of rows) {
    if (/^88/.test((row.displayNumber || "").trim())) {
      counts.byov += 1;
      continue;
    }
    const assignment = assignments.get(toCanonical(row.displayNumber)) ?? null;
    if (!assignment) {
      counts.unassigned += 1;
      continue;
    }
    counts.assigned += 1;
    trucks.push({
      truckNumber: row.displayNumber,
      vin: row.vin,
      lastReading: row.lastReading,
      lastReadingDate: row.lastReadingDate,
      lastReadingSource: row.lastReadingSource,
      reason: row.reason,
      ldap: assignment.ldap,
      techName: assignment.name,
      district: assignment.district,
    });
  }
  trucks.sort((a, b) => a.truckNumber.localeCompare(b.truckNumber, undefined, { numeric: true }));
  return { counts, trucks };
}

// The TPMS enrichment reads the whole tpms_tech_profiles mirror, so the report
// is cached briefly rather than rebuilt on every 60-second status poll. Short
// TTL: the underlying sources refresh daily, five minutes cannot pin anything.
const MISSING_ODOMETER_CACHE_TTL_MS = 5 * 60 * 1000;
let missingOdometerCache: { at: number; report: MissingOdometerReport } | null = null;

/**
 * Trucks on the reconciled vehicle cache the sweep cannot see: active rows
 * whose odometer is NULL or outside the sanity window. The inverse of
 * loadOdometerCandidates' WHERE clause — same table, same bounds, same
 * is_active scoping — so candidates + missing = the whole active cache.
 */
export async function getMissingOdometerReport(
  opts: { force?: boolean } = {},
): Promise<MissingOdometerReport> {
  if (!opts.force && missingOdometerCache
      && Date.now() - missingOdometerCache.at < MISSING_ODOMETER_CACHE_TTL_MS) {
    return missingOdometerCache.report;
  }
  const r: any = await db.execute(sql`
    SELECT holman_vehicle_number, vin, odometer, odometer_date, odometer_source
      FROM holman_vehicles_cache
     WHERE COALESCE(is_active, true) = true
       AND (odometer IS NULL OR odometer < ${ODOMETER_MIN} OR odometer > ${ODOMETER_MAX})
  `);
  const rows = (r.rows ?? r ?? []) as Array<{
    holman_vehicle_number: string;
    vin: string | null;
    odometer: number | string | null;
    odometer_date: string | null;
    odometer_source: string | null;
  }>;

  const raw: MissingOdometerRawRow[] = [];
  for (const row of rows) {
    const display = (row.holman_vehicle_number || "").trim();
    if (!display) continue; // no truck number at all — nothing a human could chase
    const reason = classifyMissingOdometer(row.odometer);
    if (!reason) continue; // defensive: SQL and JS bounds should always agree
    const parsed = typeof row.odometer === "string"
      ? Number.parseInt(row.odometer, 10)
      : row.odometer;
    raw.push({
      displayNumber: display,
      vin: (row.vin || "").trim() || null,
      lastReading: typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null,
      lastReadingDate: row.odometer_date,
      lastReadingSource: row.odometer_source,
      reason,
    });
  }

  const assignments = raw.length > 0
    ? await loadTechAssignments(raw.map((row) => row.displayNumber))
    : new Map<string, TechAssignment>();
  const { counts, trucks } = partitionMissingOdometerRows(raw, assignments);
  const report: MissingOdometerReport = {
    counts,
    trucks,
    reasonLabels: MISSING_ODOMETER_LABELS,
    generatedAt: new Date().toISOString(),
  };
  missingOdometerCache = { at: Date.now(), report };
  return report;
}

export interface WatermarkRow {
  truckNumber: string;
  lastServiceOdometer: number;
  source: string;
}

export async function loadWatermarks(): Promise<Map<string, WatermarkRow>> {
  const r: any = await db.execute(sql`
    SELECT truck_number, last_service_odometer, watermark_source
      FROM fs_truck_maintenance_watermarks
  `);
  const rows = (r.rows ?? r ?? []) as Array<{
    truck_number: string;
    last_service_odometer: number | string;
    watermark_source: string;
  }>;
  const map = new Map<string, WatermarkRow>();
  for (const row of rows) {
    map.set(row.truck_number, {
      truckNumber: row.truck_number,
      lastServiceOdometer: typeof row.last_service_odometer === "string"
        ? Number.parseInt(row.last_service_odometer, 10)
        : row.last_service_odometer,
      source: row.watermark_source,
    });
  }
  return map;
}

/**
 * Seed a watermark at the truck's CURRENT odometer. ON CONFLICT DO NOTHING:
 * an existing watermark is never re-seeded, so a restart can never reset a
 * truck's progress toward its next service.
 */
export async function seedWatermark(candidate: TruckCandidate): Promise<boolean> {
  const r: any = await db.execute(sql`
    INSERT INTO fs_truck_maintenance_watermarks
      (truck_number, vin, last_service_odometer, watermark_source, seeded_at, updated_at)
    VALUES (${candidate.truckNumber}, ${candidate.vin}, ${candidate.odometer}, 'seed', now(), now())
    ON CONFLICT (truck_number) DO NOTHING
    RETURNING truck_number
  `);
  return ((r.rows ?? r ?? []).length > 0);
}

/**
 * Bulk seed. The first sweep faces the WHOLE fleet (~10k trucks) with no
 * watermarks, and one round trip per truck would turn a bootstrap into a
 * ten-minute crawl. Chunked multi-row INSERT, same ON CONFLICT DO NOTHING
 * semantics as the single-row path.
 */
export async function seedWatermarks(candidates: TruckCandidate[]): Promise<number> {
  if (candidates.length === 0) return 0;
  const CHUNK = 500;
  let seeded = 0;
  for (let i = 0; i < candidates.length; i += CHUNK) {
    const chunk = candidates.slice(i, i + CHUNK);
    const values = chunk.map(
      (c) => sql`(${c.truckNumber}, ${c.vin}, ${c.odometer}, 'seed', now(), now())`,
    );
    const r: any = await db.execute(sql`
      INSERT INTO fs_truck_maintenance_watermarks
        (truck_number, vin, last_service_odometer, watermark_source, seeded_at, updated_at)
      VALUES ${sql.join(values, sql`, `)}
      ON CONFLICT (truck_number) DO NOTHING
      RETURNING truck_number
    `);
    seeded += (r.rows ?? r ?? []).length;
  }
  return seeded;
}

/** Advance a watermark. GREATEST() in SQL so it can never move backwards. */
export async function advanceWatermark(args: {
  truckNumber: string;
  vin: string | null;
  newValue: number;
  cycleId: number;
}): Promise<void> {
  await db.execute(sql`
    INSERT INTO fs_truck_maintenance_watermarks
      (truck_number, vin, last_service_odometer, watermark_source, last_cycle_id, seeded_at, updated_at)
    VALUES (${args.truckNumber}, ${args.vin}, ${args.newValue}, 'cycle_booked', ${args.cycleId}, now(), now())
    ON CONFLICT (truck_number) DO UPDATE SET
      last_service_odometer = GREATEST(fs_truck_maintenance_watermarks.last_service_odometer, EXCLUDED.last_service_odometer),
      watermark_source = 'cycle_booked',
      last_cycle_id = EXCLUDED.last_cycle_id,
      vin = COALESCE(EXCLUDED.vin, fs_truck_maintenance_watermarks.vin),
      updated_at = now()
  `);
}

/* ------------------------------------------------------------------------ *
 * Cycles
 * ------------------------------------------------------------------------ */

export interface CycleRow {
  id: number;
  truck_number: string;
  vin: string | null;
  ldap: string | null;
  /** Enterprise ID used as TechnicianId in the DCA booking payload. */
  enterprise_id: string | null;
  tech_name: string | null;
  district: string | null;
  status: string;
  odometer_at_trigger: number;
  watermark_at_trigger: number;
  miles_since_watermark: number;
  odometer_source: string | null;
  odometer_date: string | null;
  exclusion_reason: string | null;
  exclusion_detail: string | null;
  /**
   * The blocked-since clock (Task #674): when this cycle FIRST became
   * excluded for the CURRENT reason. Preserved while the same reason recurs
   * sweep after sweep; reset on a reason change; cleared when the exclusion
   * clears. Distinct from eligibility_checked_at, which is touched on every
   * sweep and therefore always reads "just now".
   */
  exclusion_since: Date | string | null;
  text_status: string | null;
  text_body: string | null;
  text_message_id: string | null;
  text_detail: string | null;
  text_claimed_at: Date | string | null;
  texted_at: Date | string | null;
  /**
   * The ET calendar day on which the threshold was crossed and the heads-up
   * text went out. Anchors the scheduling window:
   *   booking_window_start = trigger_date
   *   booking_window_end   = trigger_date + MAINTENANCE_WINDOW_DAYS
   */
  trigger_date: string | null;
  booking_window_start: string | null;
  booking_window_end: string | null;
  booking_due_at: Date | string | null;
  booking_date: string | null;
  booking_status: string | null;
  booking_claimed_at: Date | string | null;
  booking_attempted_at: Date | string | null;
  booking_test_status: string | null;
  booking_test_detail: string | null;
  booking_test_project_name: string | null;
  booking_test_at: Date | string | null;
  booking_project_name: string | null;
  booking_project_id: string | null;
  booking_detail: string | null;
  booked_at: Date | string | null;
  /** null = no confirmed slot yet; see schema-init for valid values. */
  confirmation_status: string | null;
  confirmed_slot_date: string | null;
  confirmed_slot_time: string | null;
  /** CAS claim stamp — set before the comms provider call, cleared after. */
  follow_up_claimed_at: Date | string | null;
  follow_up_sent_at: Date | string | null;
  follow_up_message_id: string | null;
  follow_up_detail: string | null;
  attempts: number;
  last_error: string | null;
  opened_at: Date | string;
  closed_at: Date | string | null;
}

async function fetchCycle(id: number): Promise<CycleRow | null> {
  const r: any = await db.execute(sql`SELECT * FROM fs_truck_maintenance_cycles WHERE id = ${id} LIMIT 1`);
  return ((r.rows ?? r ?? [])[0] as CycleRow) ?? null;
}

export async function listOpenCycles(): Promise<CycleRow[]> {
  const r: any = await db.execute(sql`
    SELECT * FROM fs_truck_maintenance_cycles
     WHERE closed_at IS NULL
     ORDER BY opened_at ASC
  `);
  return (r.rows ?? r ?? []) as CycleRow[];
}

/**
 * Open a cycle. Returns the new cycle id, or null when the truck already has
 * one in flight (the partial unique index rejects the second insert — that is
 * the guarantee, and it holds across replicas and restarts).
 */
export async function openCycle(args: {
  candidate: TruckCandidate;
  watermark: number;
}): Promise<number | null> {
  const { candidate, watermark } = args;
  const r: any = await db.execute(sql`
    INSERT INTO fs_truck_maintenance_cycles
      (truck_number, vin, status, odometer_at_trigger, watermark_at_trigger,
       miles_since_watermark, odometer_source, odometer_date, opened_at, updated_at)
    VALUES
      (${candidate.truckNumber}, ${candidate.vin}, 'open', ${candidate.odometer}, ${watermark},
       ${candidate.odometer - watermark}, ${candidate.odometerSource}, ${candidate.odometerDate}, now(), now())
    ON CONFLICT DO NOTHING
    RETURNING id
  `);
  const row = (r.rows ?? r ?? [])[0];
  return row?.id ?? null;
}

/** Exported for the DB test suite — the sweep and retry paths are the callers. */
export async function markExcluded(cycle: CycleRow, code: string, detail: string | null): Promise<void> {
  await db.execute(sql`
    UPDATE fs_truck_maintenance_cycles
       SET status = 'excluded',
           exclusion_reason = ${code},
           exclusion_detail = ${detail},
           -- The blocked-since clock: keeps its original value while the SAME
           -- reason recurs on every sweep, restarts when the reason changes.
           exclusion_since = CASE
             WHEN status = 'excluded' AND exclusion_reason = ${code} AND exclusion_since IS NOT NULL
             THEN exclusion_since
             ELSE now()
           END,
           eligibility_checked_at = now(),
           updated_at = now()
     WHERE id = ${cycle.id} AND closed_at IS NULL
  `);
}

/** Exported for the DB test suite — the sweep and retry paths are the callers. */
export async function clearExclusion(cycle: CycleRow, assignment: {
  ldap: string | null; name: string | null; district: string | null;
}): Promise<void> {
  // enterprise_id = ldap: the TPMS ldapId IS the Enterprise ID.
  await db.execute(sql`
    UPDATE fs_truck_maintenance_cycles
       SET status = CASE WHEN status = 'excluded' THEN 'open' ELSE status END,
           exclusion_reason = NULL,
           exclusion_detail = NULL,
           -- The comms-gate clock survives eligibility clearing: eligibility
           -- passing says the TRUCK is unblocked, but the text gate that set
           -- the clock has not been re-tested yet. The text step clears it on
           -- a real send (or restores/preserves it on another refusal); any
           -- other exclusion reason resets on the next markExcluded anyway.
           exclusion_since = CASE WHEN exclusion_reason = 'comms_gate' THEN exclusion_since ELSE NULL END,
           ldap = ${assignment.ldap},
           enterprise_id = ${assignment.ldap},
           tech_name = ${assignment.name},
           district = ${assignment.district},
           eligibility_checked_at = now(),
           updated_at = now()
     WHERE id = ${cycle.id} AND closed_at IS NULL
  `);
}

async function markFailed(cycleId: number, error: string): Promise<void> {
  await db.execute(sql`
    UPDATE fs_truck_maintenance_cycles
       SET status = 'failed',
           last_error = ${error.slice(0, 1000)},
           attempts = attempts + 1,
           updated_at = now()
     WHERE id = ${cycleId} AND closed_at IS NULL
  `);
}

/**
 * How long a 'pending' send claim may sit before it counts as orphaned. A real
 * send resolves in seconds; anything still pending after this died with its
 * process or was cut off mid-flight. Without recovery such a claim is fatal to
 * the cycle: 'pending' is rejected by the send CAS *and* by retry, so the truck
 * would never text and never book.
 */
export const TEXT_CLAIM_STALE_MS = 15 * 60 * 1000;
/* ------------------------------------------------------------------------ *
 * Step: the heads-up text
 * ------------------------------------------------------------------------ */

export interface TextOutcome {
  action: "sent" | "queued" | "dry_run" | "skipped" | "failed";
  detail: string | null;
}

/** Exported for the DB test suite — the sweep (processCycle) is the caller. */
export async function runTextStep(cycle: CycleRow, ldap: string, truckNumber: string): Promise<TextOutcome> {
  const body = buildMaintenanceMessage(ldap, truckNumber);
  const live = isMaintenanceSmsLive();

  if (!live) {
    // Dry run: every real gate (phone, opt-out, quiet hours) executes, nothing
    // is sent, and texted_at stays null so arming the flag still sends this
    // cycle's first real text.
    let detail = "SMS gate off — no message sent";
    try {
      const preview = await sendMessage({
        ldap,
        category: MAINTENANCE_COMMS_CATEGORY,
        body,
        dryRun: true,
        sentBy: null,
        senderName: "Truck Maintenance",
      });
      detail = `SMS gate off — dry-run preview: ${preview.status}${preview.reason ? ` (${preview.reason})` : ""}`;
    } catch (err: any) {
      detail = `SMS gate off — dry-run preview failed: ${err?.message || err}`;
    }
    await db.execute(sql`
      UPDATE fs_truck_maintenance_cycles
         SET text_status = 'dry_run', text_body = ${body}, text_detail = ${detail},
             status = CASE WHEN status = 'failed' THEN 'open' ELSE status END,
             updated_at = now()
       WHERE id = ${cycle.id} AND closed_at IS NULL AND texted_at IS NULL
    `);
    return { action: "dry_run", detail };
  }

  // CAS claim: only one worker may own the send for this cycle. text_claimed_at
  // stamps the claim so a claim orphaned by a crash can be recognised as stale
  // and recovered (see reconcileStalePendingText) instead of stranding the cycle.
  const claim: any = await db.execute(sql`
    UPDATE fs_truck_maintenance_cycles
       SET text_status = 'pending', text_body = ${body},
           text_claimed_at = now(), updated_at = now()
     WHERE id = ${cycle.id} AND closed_at IS NULL AND texted_at IS NULL
       AND (text_status IS NULL OR text_status IN ('dry_run', 'failed', 'skipped'))
     RETURNING id
  `);
  if ((claim.rows ?? claim ?? []).length === 0) {
    return { action: "skipped", detail: "send already claimed or already sent" };
  }

  let result: Awaited<ReturnType<typeof sendMessage>>;
  try {
    result = await sendMessage({
      ldap,
      category: MAINTENANCE_COMMS_CATEGORY,
      body,
      sentBy: null,
      senderName: "Truck Maintenance",
      // Machine-driven send: a retried sweep must not re-text the same tech.
      skipRecentDuplicate: true,
    });
  } catch (err: any) {
    // The throw may have happened AFTER Twilio accepted the message — the
    // persistence write is inside this try. Ask the comms lane what actually
    // happened before deciding this is a retry, or a delivered text turns into
    // a second one.
    const thrown = `send threw: ${err?.message || err}`;
    let evidence: TextEvidence | null = null;
    let evidenceError: string | null = null;
    try {
      evidence = await findTextEvidence(ldap, body);
    } catch (lookupErr: any) {
      evidenceError = lookupErr?.message || String(lookupErr);
    }

    if (evidence) {
      const detail = `${thrown} — but the message did reach the comms lane (${evidence.src}); adopted`;
      await adoptTextEvidence(cycle.id, evidence, detail);
      return { action: evidence.src === "queue" ? "queued" : "sent", detail };
    }
    if (evidenceError) {
      // We cannot see the lane, so we cannot rule out a delivered message.
      // Leave the claim standing: stale-claim recovery re-checks the evidence
      // once the database is answering again.
      const detail = `${thrown} — comms lane unreadable (${evidenceError}); claim left for recovery`;
      return { action: "skipped", detail };
    }

    const detail = `${thrown} — nothing reached the comms lane`;
    await db.execute(sql`
      UPDATE fs_truck_maintenance_cycles
         SET text_status = 'failed', text_detail = ${detail}, status = 'failed',
             text_claimed_at = NULL,
             last_error = ${detail.slice(0, 1000)}, attempts = attempts + 1, updated_at = now()
       WHERE id = ${cycle.id} AND closed_at IS NULL
    `);
    return { action: "failed", detail };
  }

  if (result.status === "sent" || result.status === "queued") {
    const leadDays = getMaintenanceBookingLeadDays();
    // Record the trigger date NOW — the ET day the threshold was confirmed and
    // the text went out. The booking window is anchored on this date:
    //   RequestedStartDate = trigger_date
    //   RequestedEndDate   = trigger_date + MAINTENANCE_WINDOW_DAYS
    // Storing it here (not at booking time) means retries always produce the
    // same window, and the project name embeds the same anchor date.
    const triggerDate = todayInET();
    const windowEnd = computeWindowEnd(triggerDate);
    await db.execute(sql`
      UPDATE fs_truck_maintenance_cycles
         SET status = 'texted',
             text_status = ${result.status},
             text_message_id = ${result.messageId ?? result.queueId ?? null},
             text_detail = ${result.reason ?? null},
             text_claimed_at = NULL,
             -- The text really went out: the comms-gate blocked-since clock
             -- (preserved through clearExclusion) is genuinely over.
             exclusion_since = NULL,
             texted_at = now(),
             trigger_date = ${triggerDate}::date,
             booking_window_start = ${triggerDate}::date,
             booking_window_end = ${windowEnd}::date,
             booking_due_at = now() + (${leadDays}::text || ' days')::interval,
             last_error = NULL,
             updated_at = now()
       WHERE id = ${cycle.id} AND closed_at IS NULL
    `);
    return { action: result.status, detail: result.reason ?? null };
  }

  // 'skipped' / 'blocked' are gate outcomes (opted out, no phone) — an
  // exclusion with a reason, not a failure to retry.
  const detail = result.reason ?? result.status;
  await db.execute(sql`
    UPDATE fs_truck_maintenance_cycles
       SET status = 'excluded',
           text_status = 'skipped',
           text_detail = ${detail},
           text_claimed_at = NULL,
           exclusion_reason = 'comms_gate',
           exclusion_detail = ${detail},
           -- clearExclusion deliberately preserved a prior comms-gate clock on
           -- this row (see clearExclusion), so "blocked since" survives the
           -- clear→re-block cycle of consecutive sweeps. Only a first-time
           -- refusal starts a new clock.
           exclusion_since = COALESCE(exclusion_since, now()),
           updated_at = now()
     WHERE id = ${cycle.id} AND closed_at IS NULL
  `);
  return { action: "skipped", detail };
}

/* ------------------------------------------------------------------------ *
 * Step: the 4-hour booking
 * ------------------------------------------------------------------------ */

export interface BookingOutcome {
  action:
    | "filed_live"
    | "filed_test"
    | "duplicate"
    | "dry_run"
    | "skipped"
    | "failed"
    /** Left the box, no usable answer — may exist upstream. Never re-fired. */
    | "unknown"
    /** Frozen date has passed; a human must decide. Never re-fired. */
    | "needs_review";
  detail: string | null;
  projectName?: string | null;
  projectId?: string | null;
}

/**
 * The filing date, which the project name embeds — and therefore the only
 * handle the upstream duplicate guard has on a filing we already made.
 *
 * Once a POST has actually gone out for this cycle the date is FROZEN. A retry
 * the next day that recomputed `nextBusinessDay` would build a different
 * project name, the upstream 409 would not recognise it, and the technician
 * would get a second 4-hour block that cannot be cancelled. Before any wire
 * contact there is nothing to collide with, so the fresh date is used.
 */
export function resolveBookingDate(args: {
  storedDate: string | null;
  attempted: boolean;
  fresh: string;
}): { date: string; frozen: boolean } {
  if (args.attempted && args.storedDate) {
    return { date: String(args.storedDate).slice(0, 10), frozen: true };
  }
  return { date: args.fresh, frozen: false };
}
/**
 * File (or preview) the 4-hour block.
 *
 * Ordering is deliberate and matches the rental lane's hard-won rule: the
 * chosen DATE is recorded BEFORE anything goes on the wire, so a crash
 * mid-flight leaves evidence that a filing may exist upstream — the Standard
 * Activities API has no cancel and no GET, so a lost handle is permanent.
 */
async function runBookingStep(args: {
  cycle: CycleRow;
  ldap: string;
  district: string | null;
  truckNumber: string;
  currentOdometer: number | null;
  /** true = POST with a TEST prefix regardless of the live gate (smoke test). */
  testFiling?: boolean;
}): Promise<BookingOutcome> {
  const { cycle, truckNumber } = args;

  // Enterprise ID: the TPMS ldapId stored on the cycle is the canonical
  // technician identifier and is the value sent to the DCA API as TechnicianId.
  // Fail visibly rather than falling back to RACF or truck number.
  const enterpriseId = (cycle.enterprise_id || cycle.ldap || "").trim();
  if (!enterpriseId) {
    const detail = `no Enterprise ID recorded for cycle ${cycle.id} — cannot file a route block`;
    await markFailed(cycle.id, detail);
    return { action: "failed", detail };
  }

  // Employment status is still checked: the tech must be active to receive a
  // block. The lookup key is the Enterprise ID (same as what tech_racfid holds).
  const { employmentStatus, error: racfError } = await resolveTechRacf(enterpriseId);
  if (racfError) {
    const detail = `employment status lookup failed for ${enterpriseId} (${racfError}) — not filing`;
    await markFailed(cycle.id, detail);
    return { action: "failed", detail };
  }
  // Explicit "A" required: an absent or unknown status is not a green light.
  if ((employmentStatus || "").trim().toUpperCase() !== "A") {
    const detail = `${enterpriseId} employment status is ${employmentStatus || "unknown"} (not active) — not filing`;
    await markFailed(cycle.id, detail);
    return { action: "failed", detail };
  }

  const unit = (args.district || cycle.district || "").trim();
  if (!unit) {
    const detail = `no district/unit for ${enterpriseId} — the payload requires Unit`;
    await markFailed(cycle.id, detail);
    return { action: "failed", detail };
  }

  // Scheduling window: anchored on the trigger date (the ET day the text went
  // out). The booking always uses this date as the project-name discriminator
  // so retries produce an identical name and the upstream 409 guard holds.
  const triggerDateRaw = cycle.trigger_date
    ? String(cycle.trigger_date).slice(0, 10)
    : null;
  // fall back to nextBusinessDay only when the cycle pre-dates the trigger_date
  // column (shouldn't happen after the first real sweep, but defensive).
  const windowStart = triggerDateRaw || nextBusinessDay(new Date());
  const windowEnd = triggerDateRaw ? computeWindowEnd(triggerDateRaw) : windowStart;

  // ---------------------------------------------------------------------- //
  // The TEST hatch: a wire check, and NOTHING it does may touch the
  // production filing claim. A TEST row is a separate upstream object (its
  // project name is TEST-prefixed), so sharing the claim would freeze the real
  // filing on the TEST's date — the smoke test would sabotage the booking it
  // exists to prove.
  // ---------------------------------------------------------------------- //
  if (args.testFiling) {
    const testPayload = {
      ...buildBookingPayloadArgs({
        enterpriseId, unit, truckNumber,
        date: windowStart, windowStart, windowEnd,
      }),
      live: false,
    };
    let testRes: Awaited<ReturnType<typeof sendStandardActivity>>;
    try {
      testRes = await sendStandardActivity(testPayload);
    } catch (err: any) {
      const detail = `TEST filing threw after the request was sent: ${err?.message || err}`;
      await recordTestFiling(cycle.id, { status: "unknown", detail, projectName: null });
      return { action: "unknown", detail };
    }
    const verdictTest = classifyBookingResult(testRes);
    const status =
      verdictTest === "filed_live" || verdictTest === "duplicate"
        ? "filed_test"
        : verdictTest === "unknown"
          ? "unknown"
          : "failed";
    const detail =
      status === "filed_test"
        ? `TEST filing accepted (${testRes.projectName})`
        : status === "unknown"
          ? `TEST filing returned no id (${testRes.projectName}) — upstream result unknown`
          : `TEST filing failed: ${testRes.errorMessage ?? `HTTP ${testRes.httpStatus ?? "?"}`}`;
    await recordTestFiling(cycle.id, { status, detail, projectName: testRes.projectName });
    return {
      action: status === "filed_test" ? "filed_test" : status === "unknown" ? "unknown" : "failed",
      detail,
      projectName: testRes.projectName,
      projectId: testRes.projectId,
    };
  }

  const live = isMaintenanceBookingLive();

  // Stale-window check BEFORE claiming: if the window end has passed, the
  // dates the DCA would see are in the past. Flag for human review rather
  // than silently filing a stale window.
  if (!cycle.booking_attempted_at && isWindowStale(windowEnd)) {
    const detail =
      `booking window ${windowStart}–${windowEnd} has already passed — `
      + "confirm whether the tech still needs this slot before filing a new window";
    await db.execute(sql`
      UPDATE fs_truck_maintenance_cycles
         SET booking_status = 'needs_review', booking_detail = ${detail},
             status = 'needs_review', last_error = ${detail}, updated_at = now()
       WHERE id = ${cycle.id} AND closed_at IS NULL
    `);
    return { action: "needs_review", detail };
  }

  // Record the date + a 'pending' marker BEFORE filing. The date is frozen once
  // a POST has been attempted for this cycle, because the project name embeds
  // it and a re-dated name would slip past the upstream duplicate guard.
  // For maintenance, the project-name date = window start (trigger_date).
  const claimed = await claimBooking(cycle.id, windowStart);
  if (!claimed) {
    return { action: "skipped", detail: "booking already claimed, filed, or the cycle is closed" };
  }
  const date = claimed.date;

  // A frozen date that has already passed means an earlier attempt went out and
  // the day has since rolled over. Filing it books nothing useful; re-dating it
  // risks a second uncancellable block. A human decides.
  if (claimed.frozen && date < todayInET()) {
    const detail =
      `an earlier filing attempt used ${date}, which has passed — `
      + "confirm with DCA whether that block exists before booking a new date";
    await db.execute(sql`
      UPDATE fs_truck_maintenance_cycles
         SET booking_status = 'needs_review', booking_detail = ${detail},
             status = 'needs_review', last_error = ${detail}, updated_at = now()
       WHERE id = ${cycle.id} AND closed_at IS NULL
    `);
    return { action: "needs_review", detail };
  }

  // Use the window derived from trigger_date; if there's no trigger_date (pre-
  // migration cycle), fall back to the claimed date for both endpoints.
  const effectiveWindowEnd = triggerDateRaw ? windowEnd : date;
  const payloadArgs = {
    ...buildBookingPayloadArgs({
      enterpriseId, unit, truckNumber, date,
      windowStart: date, windowEnd: effectiveWindowEnd,
    }),
    live,
  };

  if (!live) {
    // Gate off: build and store the payload, POST nothing. The cycle stays
    // open and re-files for real the first sweep after the gate is armed.
    const { projectName, body } = buildStandardActivityPayload(payloadArgs);
    const detail = "booking gate off — payload built, nothing sent";
    await db.execute(sql`
      UPDATE fs_truck_maintenance_cycles
         SET booking_status = 'dry_run',
             booking_project_name = ${projectName},
             booking_payload = ${JSON.stringify(body)}::jsonb,
             booking_detail = ${detail},
             updated_at = now()
       WHERE id = ${cycle.id} AND closed_at IS NULL
    `);
    return { action: "dry_run", detail, projectName };
  }

  // Stamped in the instant before the request leaves the box: from here on a
  // filing may exist upstream even if we never see the answer.
  await db.execute(sql`
    UPDATE fs_truck_maintenance_cycles
       SET booking_attempted_at = now(), updated_at = now()
     WHERE id = ${cycle.id} AND closed_at IS NULL
  `);

  let res: Awaited<ReturnType<typeof sendStandardActivity>>;
  try {
    res = await sendStandardActivity(payloadArgs);
  } catch (err: any) {
    // The request went out and never came back. It may have landed, and there
    // is no GET to ask — so this is a review item, NOT a retry.
    const detail =
      `route API call threw after the request was sent: ${err?.message || err}`
      + " — upstream result unknown, confirm with DCA before re-filing";
    await markBookingUnknown(cycle.id, { detail });
    return { action: "unknown", detail };
  }

  const verdict = classifyBookingResult(res);

  // 409 = already filed upstream. Treat it as booked and NEVER re-fire.
  const filed = verdict === "filed_live" || verdict === "duplicate";
  if (filed) {
    const status = res.ok ? "filed_live" : "duplicate";
    const detail = res.ok
      ? `filed as ${res.projectName}`
      : (res.errorMessage ?? "already filed upstream");
    await db.execute(sql`
      UPDATE fs_truck_maintenance_cycles
         SET status = 'booked',
             booking_status = ${status},
             booking_project_name = ${res.projectName ?? null},
             booking_project_id = ${res.projectId ?? null},
             booking_payload = ${JSON.stringify(res.payload)}::jsonb,
             booking_detail = ${detail},
             booked_at = now(),
             closed_at = now(),
             last_error = NULL,
             updated_at = now()
       WHERE id = ${cycle.id} AND closed_at IS NULL
    `);
    await advanceWatermark({
      truckNumber: cycle.truck_number,
      vin: cycle.vin,
      newValue: computeWatermarkAdvance(
        cycle.watermark_at_trigger,
        cycle.odometer_at_trigger,
        args.currentOdometer,
      ),
      cycleId: cycle.id,
    });
    return { action: status as "filed_live" | "duplicate", detail, projectName: res.projectName, projectId: res.projectId };
  }

  if (res.skipReason === "missing_config") {
    // The client refused to send, so nothing left the box — un-stamp the
    // attempt or the date would freeze on a filing that never happened.
    const detail = res.errorMessage ?? "Event Request API not configured";
    await db.execute(sql`
      UPDATE fs_truck_maintenance_cycles
         SET booking_status = 'failed', booking_detail = ${detail}, status = 'failed',
             booking_attempted_at = NULL, booking_claimed_at = NULL,
             last_error = ${detail.slice(0, 1000)}, attempts = attempts + 1, updated_at = now()
       WHERE id = ${cycle.id} AND closed_at IS NULL
    `);
    return { action: "failed", detail };
  }

  if (verdict === "unknown") {
    // Either a 2xx with no project id, or no HTTP answer at all (the client
    // catches transport errors and reports them as httpStatus: null). Both mean
    // the request left the box and may exist upstream, with no GET to ask.
    const detail =
      `${res.errorMessage ?? "route API returned 2xx with no project id"}`
      + ` (${res.projectName}) — upstream result unknown, confirm with DCA before re-filing`;
    await markBookingUnknown(cycle.id, { detail, projectName: res.projectName, payload: res.payload });
    return { action: "unknown", detail, projectName: res.projectName };
  }

  // A rejection created nothing upstream, so this stays retryable — and the
  // retry reuses the frozen date, so an identical name meets the 409 guard if
  // the rejection was actually a partial success.
  const detail = res.errorMessage ?? `route API returned HTTP ${res.httpStatus ?? "?"}`;
  await db.execute(sql`
    UPDATE fs_truck_maintenance_cycles
       SET booking_status = 'failed', booking_detail = ${detail}, status = 'failed',
           last_error = ${detail.slice(0, 1000)}, attempts = attempts + 1, updated_at = now()
     WHERE id = ${cycle.id} AND closed_at IS NULL
  `);
  return { action: "failed", detail };
}

/* ------------------------------------------------------------------------ *
 * Processing one cycle
 * ------------------------------------------------------------------------ */

export interface ProcessOutcome {
  cycleId: number;
  truckNumber: string;
  step: "excluded" | "text" | "booking" | "confirmation" | "waiting" | "noop";
  action: string;
  detail: string | null;
}

async function processCycle(
  cycle: CycleRow,
  ctx: EligibilityContext,
  candidatesByTruck: Map<string, TruckCandidate>,
  opts: { testFiling?: boolean } = {},
): Promise<ProcessOutcome> {
  const candidate: TruckCandidate = candidatesByTruck.get(cycle.truck_number) ?? {
    truckNumber: cycle.truck_number,
    displayNumber: cycle.truck_number,
    vin: cycle.vin,
    odometer: cycle.odometer_at_trigger,
    odometerDate: cycle.odometer_date,
    odometerSource: cycle.odometer_source,
  };

  const assignments = await loadTechAssignments([candidate.displayNumber]);
  const assignment = assignments.get(candidate.truckNumber) ?? null;
  const evaluated = await evaluateCandidate(candidate, assignment, ctx);

  if (!evaluated.verdict.eligible) {
    await markExcluded(cycle, evaluated.verdict.code!, evaluated.verdict.detail);
    return {
      cycleId: cycle.id,
      truckNumber: cycle.truck_number,
      step: "excluded",
      action: evaluated.verdict.code!,
      detail: evaluated.verdict.detail,
    };
  }

  await clearExclusion(cycle, {
    ldap: assignment!.ldap,
    name: assignment!.name,
    district: assignment!.district,
  });

  // A send claim orphaned by a crash blocks every later attempt (the CAS claim
  // rejects 'pending'), so resolve it before the text step rather than letting
  // the cycle sit open forever.
  if (cycle.text_status === "pending" && !cycle.texted_at) {
    const recovery = await reconcileStalePendingText(cycle);
    if (recovery.action === "in_flight") {
      return {
        cycleId: cycle.id,
        truckNumber: cycle.truck_number,
        step: "waiting",
        action: "send_in_flight",
        detail: recovery.detail,
      };
    }
    const refreshed = await fetchCycle(cycle.id);
    if (refreshed) cycle = refreshed;
  }

  // Step 1: the heads-up text (until it has really gone out).
  if (!cycle.texted_at) {
    const outcome = await runTextStep(cycle, assignment!.ldap, candidate.displayNumber);
    return {
      cycleId: cycle.id,
      truckNumber: cycle.truck_number,
      step: "text",
      action: outcome.action,
      detail: outcome.detail,
    };
  }

  // Step 2: the booking, once the lead time has been spent.
  const dueAt = cycle.booking_due_at ? new Date(cycle.booking_due_at) : null;
  const bookingTerminal = cycle.booking_status === "filed_live" || cycle.booking_status === "duplicate";
  if (bookingTerminal) {
    // A successfully booked cycle is terminal for this pipeline path. The
    // cycle is CLOSED (closed_at IS NOT NULL) the moment the booking lands, so
    // it will not appear in listOpenCycles() on future sweeps.
    //
    // The confirmation follow-up is handled by a SEPARATE sweep in
    // runMaintenancePipeline that queries listConfirmationPendingCycles() —
    // closed booked rows where a confirmed_slot_date has been recorded but
    // follow_up_sent_at is still null. Nothing to do here.
    return {
      cycleId: cycle.id,
      truckNumber: cycle.truck_number,
      step: "noop",
      action: "already_booked",
      detail: null,
    };
  }
  // An unconfirmed filing is parked, not retried: the request left the box and
  // there is no way to ask upstream what became of it.
  if (cycle.booking_status === "unknown" || cycle.booking_status === "needs_review") {
    return {
      cycleId: cycle.id,
      truckNumber: cycle.truck_number,
      step: "waiting",
      action: "booking_needs_review",
      detail: cycle.booking_detail,
    };
  }
  // A booking claim orphaned by a crash: released only when nothing reached the
  // wire, otherwise parked for review.
  if (cycle.booking_status === "pending") {
    const recovery = await reconcileStaleBookingClaim(cycle);
    if (recovery.action !== "released") {
      return {
        cycleId: cycle.id,
        truckNumber: cycle.truck_number,
        step: "waiting",
        action: recovery.action === "in_flight" ? "booking_in_flight" : "booking_needs_review",
        detail: recovery.detail,
      };
    }
    const refreshed = await fetchCycle(cycle.id);
    if (refreshed) cycle = refreshed;
  }
  if (!opts.testFiling && dueAt && dueAt.getTime() > Date.now()) {
    return {
      cycleId: cycle.id,
      truckNumber: cycle.truck_number,
      step: "waiting",
      action: "booking_not_due",
      detail: `booking due ${dueAt.toISOString()}`,
    };
  }

  const outcome = await runBookingStep({
    cycle,
    ldap: assignment!.ldap,
    district: assignment!.district,
    truckNumber: candidate.displayNumber,
    currentOdometer: candidate.odometer,
    testFiling: opts.testFiling,
  });
  return {
    cycleId: cycle.id,
    truckNumber: cycle.truck_number,
    step: "booking",
    action: outcome.action,
    detail: outcome.detail,
  };
}

/* ------------------------------------------------------------------------ *
 * The pipeline
 * ------------------------------------------------------------------------ */

export interface PipelineSummary {
  startedAt: string;
  finishedAt: string;
  paused: boolean;
  candidates: number;
  seeded: number;
  triggered: number;
  opened: number;
  confirmationFollowUpsSent: number;
  processed: number;
  texted: number;
  textDryRun: number;
  booked: number;
  bookingDryRun: number;
  excluded: number;
  failed: number;
  waiting: number;
  smsLive: boolean;
  bookingLive: boolean;
  rentalAuthorityAvailable: boolean;
  outcomes: ProcessOutcome[];
  errors: string[];
}

/**
 * Seed -> open -> process. Safe to run repeatedly: seeding is
 * ON CONFLICT DO NOTHING, opening is guarded by the one-open-cycle index, and
 * each step of a cycle claims itself with a CAS update before acting.
 */
export async function runMaintenancePipeline(opts: {
  /** Skip cycle-opening (processing still runs) — the kill switch does this too. */
  openCycles?: boolean;
  maxCycles?: number;
} = {}): Promise<PipelineSummary> {
  const startedAt = new Date().toISOString();
  const errors: string[] = [];
  const paused = await isCycleOpeningPaused();
  const allowOpen = opts.openCycles !== false && !paused;

  const candidates = await loadOdometerCandidates();
  const candidatesByTruck = new Map(candidates.map((c) => [c.truckNumber, c]));
  const watermarks = await loadWatermarks();

  let seeded = 0;
  let triggered = 0;
  let opened = 0;

  if (allowOpen) {
    // First sight: seed at the current reading and never fire in the same
    // pass, so an existing fleet does not all trigger on day one.
    const unseeded = candidates.filter((c) => !watermarks.has(c.truckNumber));
    if (unseeded.length > 0) {
      try {
        seeded = await seedWatermarks(unseeded);
      } catch (err: any) {
        errors.push(`seed ${unseeded.length} trucks: ${err?.message || err}`);
      }
    }

    for (const candidate of candidates) {
      const wm = watermarks.get(candidate.truckNumber);
      if (!wm) continue; // just seeded this pass
      if (!shouldOpenCycle(candidate.odometer, wm.lastServiceOdometer)) continue;
      triggered += 1;
      try {
        const id = await openCycle({ candidate, watermark: wm.lastServiceOdometer });
        if (id) opened += 1;
      } catch (err: any) {
        errors.push(`open ${candidate.truckNumber}: ${err?.message || err}`);
      }
    }
  }

  const ctx = await buildEligibilityContext();
  const open = await listOpenCycles();
  const slice = opts.maxCycles ? open.slice(0, opts.maxCycles) : open;

  const outcomes: ProcessOutcome[] = [];
  for (const cycle of slice) {
    // A `failed` cycle is never auto-retried: a human retries it from the
    // monitoring screen once they know why it failed.
    if (cycle.status === "failed") continue;
    try {
      outcomes.push(await processCycle(cycle, ctx, candidatesByTruck));
    } catch (err: any) {
      errors.push(`cycle ${cycle.id}: ${err?.message || err}`);
      try {
        await markFailed(cycle.id, `processing threw: ${err?.message || err}`);
      } catch { /* the error list already carries it */ }
    }
  }

  // Confirmation follow-up sweep — separate from the open-cycle loop because
  // booked cycles are closed (closed_at IS NOT NULL) and never appear in
  // listOpenCycles(). A closed booked cycle becomes processable here once an
  // operator records a confirmed_slot_date via POST /cycles/:id/confirm.
  const confirmationPending = await listConfirmationPendingCycles();
  for (const cycle of confirmationPending) {
    const ldap = cycle.enterprise_id || cycle.ldap || "";
    try {
      const confirmation = await runConfirmationFollowUp(cycle, ldap);
      outcomes.push({
        cycleId: cycle.id,
        truckNumber: cycle.truck_number,
        step: "confirmation",
        action: confirmation.action,
        detail: confirmation.detail,
      });
    } catch (err: any) {
      errors.push(`confirmation cycle ${cycle.id}: ${err?.message || err}`);
    }
  }

  const count = (pred: (o: ProcessOutcome) => boolean) => outcomes.filter(pred).length;
  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    paused,
    candidates: candidates.length,
    seeded,
    triggered,
    opened,
    processed: outcomes.length,
    texted: count((o) => o.step === "text" && (o.action === "sent" || o.action === "queued")),
    textDryRun: count((o) => o.step === "text" && o.action === "dry_run"),
    booked: count((o) => o.step === "booking" && (o.action === "filed_live" || o.action === "duplicate")),
    bookingDryRun: count((o) => o.step === "booking" && o.action === "dry_run"),
    confirmationFollowUpsSent: count(
      (o) => o.step === "confirmation" && (o.action === "sent" || o.action === "queued" || o.action === "dry_run"),
    ),
    excluded: count((o) => o.step === "excluded"),
    failed: count((o) => o.action === "failed"),
    waiting: count((o) => o.step === "waiting"),
    smsLive: isMaintenanceSmsLive(),
    bookingLive: isMaintenanceBookingLive(),
    rentalAuthorityAvailable: ctx.rentalEids !== null,
    outcomes,
    errors,
  };
}

/**
 * Manual retry for one cycle. Clears the failure marks the operator has just
 * looked at and re-runs that cycle through the same pipeline step it died on.
 *
 * A cycle whose booking already landed (filed_live / duplicate) is terminal:
 * re-firing an identical filing is the one thing this workflow must never do.
 */
export async function retryCycle(
  cycleId: number,
  opts: { testFiling?: boolean; actor?: string | null } = {},
): Promise<{ ok: boolean; outcome?: ProcessOutcome; error?: string }> {
  const cycle = await fetchCycle(cycleId);
  if (!cycle) return { ok: false, error: `cycle ${cycleId} not found` };
  if (cycle.closed_at) {
    return { ok: false, error: `cycle ${cycleId} is closed (${cycle.booking_status ?? cycle.status}) — nothing to retry` };
  }
  if (cycle.booking_status === "filed_live" || cycle.booking_status === "duplicate") {
    return { ok: false, error: `cycle ${cycleId} already has a filed block — never re-fire` };
  }
  if (cycle.booking_status === "unknown" || cycle.booking_status === "needs_review") {
    // The request left the box and the answer proves nothing. There is no GET
    // to ask and no cancel to undo, so re-filing is a coin flip on a real
    // technician's calendar. A human confirms with DCA and clears it.
    return {
      ok: false,
      error:
        `cycle ${cycleId} has an unconfirmed filing (${cycle.booking_detail ?? cycle.booking_status})`
        + " — confirm with DCA before re-filing; it will not be retried automatically",
    };
  }

  // An operator retrying a cycle stuck on an orphaned send claim gets the same
  // evidence-first recovery as the sweep; a claim still genuinely in flight is
  // refused rather than raced.
  if (cycle.text_status === "pending" && !cycle.texted_at) {
    const recovery = await reconcileStalePendingText(cycle);
    if (recovery.action === "in_flight") {
      return { ok: false, error: `cycle ${cycleId} has a send in flight — try again in a few minutes` };
    }
  }

  // Same treatment for an orphaned booking claim — and it may resolve to
  // 'unknown', which must not then be cleared for a re-fire below.
  if (cycle.booking_status === "pending") {
    const recovery = await reconcileStaleBookingClaim(cycle);
    if (recovery.action === "in_flight") {
      return { ok: false, error: `cycle ${cycleId} has a filing in flight — try again in a few minutes` };
    }
    if (recovery.action === "adopted") {
      return { ok: false, error: `cycle ${cycleId}: ${recovery.detail}` };
    }
  }

  await db.execute(sql`
    UPDATE fs_truck_maintenance_cycles
       SET status = CASE WHEN texted_at IS NULL THEN 'open' ELSE 'texted' END,
           last_error = NULL,
           text_status = CASE WHEN text_status = 'failed' THEN NULL ELSE text_status END,
           -- 'pending' is deliberately NOT cleared here: only the recovery
           -- above may release it, and only when nothing reached the wire.
           booking_status = CASE WHEN booking_status = 'failed' THEN NULL ELSE booking_status END,
           updated_at = now()
     WHERE id = ${cycleId} AND closed_at IS NULL
  `);

  const fresh = await fetchCycle(cycleId);
  if (!fresh) return { ok: false, error: `cycle ${cycleId} disappeared` };

  const ctx = await buildEligibilityContext();
  const candidates = await loadOdometerCandidates();
  const byTruck = new Map(candidates.map((c) => [c.truckNumber, c]));
  try {
    const outcome = await processCycle(fresh, ctx, byTruck, { testFiling: opts.testFiling });
    return { ok: true, outcome };
  } catch (err: any) {
    const message = `retry threw: ${err?.message || err}`;
    await markFailed(cycleId, message);
    return { ok: false, error: message };
  }
}

/* ------------------------------------------------------------------------ *
 * Long-blocked cycle digest (Task #674)
 *
 * The overdue section on the monitoring screen only helps someone who opens
 * the page. The digest is the push half: once a day (riding the daily sweep),
 * every cycle blocked past the threshold is emailed to the configured
 * recipients — with how far past its interval the truck has now drifted.
 * ------------------------------------------------------------------------ */

export interface StaleBlockedCycle {
  id: number;
  truck_number: string;
  ldap: string | null;
  enterprise_id: string | null;
  tech_name: string | null;
  exclusion_reason: string;
  exclusion_detail: string | null;
  exclusion_since: Date | string;
  blocked_days: number;
  odometer_at_trigger: number;
  /** Current reconciled reading, when the vehicle cache still has one. */
  current_odometer: number | null;
  /** current_odometer - odometer_at_trigger; null when no current reading. */
  miles_past_trigger: number | null;
}
/* ------------------------------------------------------------------------ *
 * Scheduling
 * ------------------------------------------------------------------------ */

let sweepInFlight = false;

/**
 * The once-a-day entry point behind both the cron route and the in-process
 * secondary. Idempotent by date: the first caller of the day wins and the
 * rest are told why they were skipped.
 */
export async function runDailySweep(opts: {
  force?: boolean;
  now?: Date;
  trigger: string;
} ): Promise<{ ran: boolean; reason: string; summary?: PipelineSummary }> {
  const now = opts.now ?? new Date();
  const todayET = todayInET(now);
  const lastRun = await getSetting(SETTING_LAST_SWEEP_DATE);
  const decision = shouldRunDailySweep({
    todayET,
    lastRunDateET: lastRun,
    hourET: hourInET(now),
    force: opts.force,
  });
  if (!decision.run) return { ran: false, reason: decision.reason };

  if (sweepInFlight) return { ran: false, reason: "a sweep is already running in this process" };
  sweepInFlight = true;
  try {
    // Claim the day BEFORE the work so a slow sweep cannot be started twice by
    // the every-few-minutes pinger.
    await setSetting(SETTING_LAST_SWEEP_DATE, todayET, opts.trigger);
    const summary = await runMaintenancePipeline();
    console.log(
      `[TruckMaint] sweep (${opts.trigger}): ${summary.candidates} candidates, ${summary.seeded} seeded, `
      + `${summary.opened} opened, ${summary.texted} texted, ${summary.booked} booked, `
      + `${summary.excluded} excluded, ${summary.failed} failed`,
    );
    // The long-blocked digest rides the daily sweep. A digest failure must
    // never fail the sweep — the pipeline work above is the important thing.
    try {
      const digest = await sendStaleBlockedDigestIfDue({ todayET, trigger: opts.trigger });
      console.log(
        digest.sent
          ? `[TruckMaint] stale-cycle digest sent (${digest.count} cycles): ${digest.reason}`
          : `[TruckMaint] stale-cycle digest not sent: ${digest.reason}`,
      );
    } catch (err: any) {
      console.error(`[TruckMaint] stale-cycle digest failed: ${err?.message || err}`);
    }
    return { ran: true, reason: decision.reason, summary };
  } finally {
    sweepInFlight = false;
  }
}

/**
 * The durable production cadence, without waiting on a new scheduler entry.
 *
 * The Fleet Agents reserved VM already pokes the comms send-queue drain on
 * every tick, so the sweep rides that call: runDailySweep is a two-query no-op
 * outside the ET window or once the day is claimed, and the day claim happens
 * before the work, so overlapping ticks cannot double-run it.
 *
 * A maintenance failure must never fail the host route — the send queue is the
 * important thing on that tick — so everything is swallowed into a reason
 * string the caller can log.
 */
export async function runMaintenanceSweepTick(
  trigger = "comms_cron_tick",
): Promise<{ ran: boolean; reason: string }> {
  try {
    const { initTruckMaintenanceSchema } = await import("./schema-init");
    await initTruckMaintenanceSchema();
    const result = await runDailySweep({ trigger });
    return { ran: result.ran, reason: result.reason };
  } catch (err: any) {
    const reason = `sweep tick failed: ${err?.message || err}`;
    console.error(`[TruckMaint] ${reason}`);
    return { ran: false, reason };
  }
}
const IN_PROCESS_INTERVAL_MS = 15 * 60 * 1000;
let inProcessTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Best-effort in-process secondary, exactly like the comms queue drainer: the
 * durable cadence is the external pinger hitting the cron route (in-process
 * timers do not reliably fire on autoscale), and this only helps when the
 * instance happens to be warm. runDailySweep's date claim keeps the two from
 * doing the work twice.
 */
export function startInProcessMaintenanceSweep(): void {
  if (inProcessTimer) return;
  inProcessTimer = setInterval(() => {
    runDailySweep({ trigger: "in_process" }).catch((err: any) => {
      console.error(`[TruckMaint] in-process sweep failed: ${err?.message || err}`);
    });
  }, IN_PROCESS_INTERVAL_MS);
  if (typeof inProcessTimer.unref === "function") inProcessTimer.unref();
  console.log("[TruckMaint] in-process secondary sweep started (15m; the cron route is primary)");
}

export function stopInProcessMaintenanceSweep(): void {
  if (inProcessTimer) {
    clearInterval(inProcessTimer);
    inProcessTimer = null;
  }
}

export type TextClaimState = "not_pending" | "in_flight" | "stale";

/** Pure half of the recovery, so the timing rule is testable on its own. */
export function classifyTextClaim(args: {
  textStatus: string | null;
  claimedAt: Date | string | null;
  now?: Date;
  staleMs?: number;
}): TextClaimState {
  if (args.textStatus !== "pending") return "not_pending";
  const claimed = args.claimedAt ? new Date(args.claimedAt as any) : null;
  // No timestamp = a claim written before this column existed. Treat it as
  // stale: leaving it pending forever is the failure we are fixing.
  if (!claimed || Number.isNaN(claimed.getTime())) return "stale";
  const staleMs = args.staleMs ?? TEXT_CLAIM_STALE_MS;
  return (args.now ?? new Date()).getTime() - claimed.getTime() >= staleMs ? "stale" : "in_flight";
}

export interface ClaimRecovery {
  action: "none" | "in_flight" | "adopted" | "released";
  detail: string | null;
}

interface TextEvidence {
  id: string;
  created_at: any;
  src: "message" | "queue";
}
/**
 * Resolve a send claim orphaned by a crash, without risking a second text.
 *
 * Evidence first: if the orphaned attempt actually reached the comms lane
 * (a sent message or a queued row with this tech, body and category), the
 * cycle adopts it and moves on to booking. Only when there is no such record
 * is the claim released for a fresh attempt — and even then the comms lane's
 * own 24h identical-send guard is the second net.
 */
export async function reconcileStalePendingText(
  cycle: CycleRow,
  opts: { now?: Date; staleMs?: number } = {},
): Promise<ClaimRecovery> {
  const state = classifyTextClaim({
    textStatus: cycle.text_status,
    claimedAt: cycle.text_claimed_at,
    now: opts.now,
    staleMs: opts.staleMs,
  });
  if (state === "not_pending") return { action: "none", detail: null };
  if (state === "in_flight") {
    return { action: "in_flight", detail: "a send claimed moments ago is still in flight" };
  }

  const body = cycle.text_body ?? "";
  const ldap = cycle.ldap ?? "";
  if (body && ldap) {
    const hit = await findTextEvidence(ldap, body);
    if (hit) {
      const detail = `orphaned send claim recovered — message already in the comms lane (${hit.src})`;
      await adoptTextEvidence(cycle.id, hit, detail);
      return { action: "adopted", detail };
    }
  }

  const detail = "orphaned send claim released for retry — nothing found in the comms lane";
  await db.execute(sql`
    UPDATE fs_truck_maintenance_cycles
       SET text_status = NULL,
           text_claimed_at = NULL,
           text_detail = ${detail},
           updated_at = now()
     WHERE id = ${cycle.id} AND closed_at IS NULL AND texted_at IS NULL
       AND text_status = 'pending'
  `);
  return { action: "released", detail };
}

/**
 * Resolve a booking claim orphaned by a crash.
 *
 * `booking_attempted_at` is the whole point: a claim that never reached the
 * wire is released for a clean retry, while one that did becomes a review
 * item. Guessing the other way round either strands a truck forever or files
 * a second uncancellable block.
 */
export async function reconcileStaleBookingClaim(
  cycle: CycleRow,
  opts: { now?: Date; staleMs?: number } = {},
): Promise<ClaimRecovery> {
  if (cycle.booking_status !== "pending") return { action: "none", detail: null };
  const claimedAt = cycle.booking_claimed_at ? new Date(cycle.booking_claimed_at as any) : null;
  const staleMs = opts.staleMs ?? TEXT_CLAIM_STALE_MS;
  const now = (opts.now ?? new Date()).getTime();
  if (claimedAt && !Number.isNaN(claimedAt.getTime()) && now - claimedAt.getTime() < staleMs) {
    return { action: "in_flight", detail: "a filing claimed moments ago is still in flight" };
  }

  if (cycle.booking_attempted_at) {
    const detail =
      "filing was in flight when the process stopped — upstream result unknown, confirm with DCA before re-filing";
    await db.execute(sql`
      UPDATE fs_truck_maintenance_cycles
         SET booking_status = 'unknown', booking_detail = ${detail}, status = 'needs_review',
             last_error = ${detail}, updated_at = now()
       WHERE id = ${cycle.id} AND closed_at IS NULL AND booking_status = 'pending'
    `);
    return { action: "adopted", detail };
  }

  const detail = "booking claim released — the request never reached the wire";
  await db.execute(sql`
    UPDATE fs_truck_maintenance_cycles
       SET booking_status = NULL, booking_claimed_at = NULL, booking_detail = ${detail},
           updated_at = now()
     WHERE id = ${cycle.id} AND closed_at IS NULL AND booking_status = 'pending'
       AND booking_attempted_at IS NULL
  `);
  return { action: "released", detail };
}

/**
 * The payload arguments shared by the live, dry-run and TEST paths.
 *
 * Task #676: TechnicianId is now the technician's Enterprise ID (ldapId from
 * TPMS), not their RACF id. The DCA comment in StandardActivityArgs has been
 * updated accordingly. The window is RequestedStartDate=windowStart,
 * RequestedEndDate=windowEnd, endDateFixed=false (scheduler picks the slot).
 */
function buildBookingPayloadArgs(args: {
  enterpriseId: string;
  unit: string;
  truckNumber: string;
  date: string;
  /** Scheduling window start (= trigger_date). */
  windowStart?: string | null;
  /** Scheduling window end (= trigger_date + MAINTENANCE_WINDOW_DAYS). */
  windowEnd?: string | null;
}) {
  return {
    techLdap: args.enterpriseId,     // Enterprise ID is TechnicianId
    unit: args.unit,
    truckNumber: args.truckNumber,
    date: args.date,
    requestedStartDate: args.windowStart || undefined,
    requestedEndDate: args.windowEnd || undefined,
    durationMinutes: MAINTENANCE_BLOCK_DURATION_MIN,
    startTime: MAINTENANCE_START_TIME,
    // Echo the HH:MM back as the request, the reference's own way of pinning a
    // slot. Never a movable-slot value: those are not in the spec.
    startTimeRequest: MAINTENANCE_START_TIME,
    projectLabel: MAINTENANCE_PROJECT_LABEL,
    projectNotes: MAINTENANCE_PROJECT_NOTES,
    rowNotes: buildMaintenanceRowNotes(args.truckNumber),
    activityType: getMaintenanceActivityType() ?? undefined,
  };
}

/**
 * How an upstream answer maps onto cycle state.
 *
 * The distinction that matters is "did this create something we cannot see or
 * cancel?". Retrying is only safe when we can prove the answer, so `failed`
 * (retryable) is the NARROW case and `unknown` is the default for anything
 * ambiguous.
 *
 * Retryable, because nothing can have been created:
 *  - `missing_config` — the client refused to send; no request existed.
 *  - a real HTTP status other than 409/2xx-without-id — the server answered and
 *    rejected it. A retry carries the same frozen project name, so if the
 *    rejection lied the upstream duplicate guard catches it.
 *
 * Everything else is `unknown`. The DCA client CATCHES transport errors and
 * returns them as an ordinary result with `httpStatus: null` — a connection
 * reset or timeout after the server accepted the request looks exactly like
 * this, so treating a null status as a failure would hand back a 4-hour block
 * nobody can cancel.
 */
export function classifyBookingResult(res: {
  ok: boolean;
  skipReason?: string;
  projectId?: string | null;
  httpStatus?: number | null;
}): "filed_live" | "duplicate" | "unknown" | "failed" {
  if (res.ok) return "filed_live";
  if (res.skipReason === "duplicate") return "duplicate";
  if (res.skipReason === "missing_config") return "failed";

  const status = res.httpStatus;
  // No status at all = the request left the box and never came back with an
  // answer. It may exist upstream; a human confirms it.
  if (typeof status !== "number" || !Number.isFinite(status) || status <= 0) return "unknown";
  // 2xx without an id: something was accepted and we have no handle on it.
  if (status >= 200 && status < 300 && !res.projectId) return "unknown";
  return "failed";
}

/**
 * CAS-claim the booking and settle its date in one statement. Returns null
 * when the cycle is already claimed, filed, closed, or parked for review.
 */
export async function claimBooking(
  cycleId: number,
  freshDate: string,
): Promise<{ date: string; frozen: boolean } | null> {
  const claim: any = await db.execute(sql`
    UPDATE fs_truck_maintenance_cycles
       SET booking_date = CASE
             WHEN booking_attempted_at IS NOT NULL AND booking_date IS NOT NULL THEN booking_date
             ELSE ${freshDate}::date
           END,
           booking_status = 'pending',
           booking_claimed_at = now(),
           updated_at = now()
     WHERE id = ${cycleId} AND closed_at IS NULL
       AND (booking_status IS NULL OR booking_status IN ('dry_run', 'failed', 'filed_test'))
     RETURNING to_char(booking_date, 'YYYY-MM-DD') AS booking_date,
               (booking_attempted_at IS NOT NULL) AS attempted
  `);
  const row = ((claim.rows ?? claim ?? []) as any[])[0];
  if (!row) return null;
  return { date: String(row.booking_date), frozen: !!row.attempted };
}

/**
 * Record a TEST filing — in TEST-only columns, deliberately. It leaves the
 * cycle's status and every production booking field untouched, so the real
 * booking still happens on its own fresh date afterwards.
 */
export async function recordTestFiling(
  cycleId: number,
  args: { status: string; detail: string; projectName: string | null },
): Promise<void> {
  await db.execute(sql`
    UPDATE fs_truck_maintenance_cycles
       SET booking_test_status = ${args.status},
           booking_test_detail = ${args.detail},
           booking_test_project_name = ${args.projectName},
           booking_test_at = now(),
           updated_at = now()
     WHERE id = ${cycleId} AND closed_at IS NULL
  `);
}

/**
 * Park a filing whose outcome cannot be proven.
 *
 * This is the terminal state for "the request left the box and we never got an
 * answer that says what happened" — a transport error, a 2xx with no id, a
 * crash mid-POST. The sweep will not retake it, retry refuses it, and a human
 * clears it after confirming with DCA, because the API has no GET to ask with
 * and no cancel to undo a second block.
 */
export async function markBookingUnknown(
  cycleId: number,
  args: { detail: string; projectName?: string | null; payload?: unknown },
): Promise<void> {
  await db.execute(sql`
    UPDATE fs_truck_maintenance_cycles
       SET booking_status = 'unknown',
           booking_project_name = COALESCE(${args.projectName ?? null}, booking_project_name),
           booking_payload = COALESCE(${args.payload ? JSON.stringify(args.payload) : null}::jsonb, booking_payload),
           booking_detail = ${args.detail},
           status = 'needs_review',
           last_error = ${args.detail.slice(0, 1000)},
           attempts = attempts + 1,
           updated_at = now()
     WHERE id = ${cycleId} AND closed_at IS NULL
  `);
}

/** Adopt a real send: its OWN timestamp drives the booking clock, not now(). */
async function adoptTextEvidence(cycleId: number, hit: TextEvidence, detail: string): Promise<void> {
  const leadDays = getMaintenanceBookingLeadDays();
  // Derive trigger_date from the adopted send timestamp (ET day).
  const hitDate = new Date(hit.created_at);
  const triggerDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(hitDate);
  const windowEnd = computeWindowEnd(triggerDate);
  await db.execute(sql`
    UPDATE fs_truck_maintenance_cycles
       SET status = 'texted',
           text_status = ${hit.src === "queue" ? "queued" : "sent"},
           text_message_id = COALESCE(text_message_id, ${hit.id}),
           text_detail = ${detail},
           text_claimed_at = NULL,
           exclusion_since = NULL,
           texted_at = ${hit.created_at},
           trigger_date = COALESCE(trigger_date, ${triggerDate}::date),
           booking_window_start = COALESCE(booking_window_start, ${triggerDate}::date),
           booking_window_end = COALESCE(booking_window_end, ${windowEnd}::date),
           booking_due_at = ${hit.created_at}::timestamp + (${leadDays}::text || ' days')::interval,
           last_error = NULL,
           updated_at = now()
     WHERE id = ${cycleId} AND closed_at IS NULL AND text_status = 'pending'
  `);
}

/* ------------------------------------------------------------------------ *
 * Step: the confirmation follow-up text
 * ------------------------------------------------------------------------ */

export interface ConfirmationOutcome {
  action: "sent" | "queued" | "dry_run" | "skipped" | "failed" | "noop";
  detail: string | null;
}

/**
 * Send the one follow-up text the technician receives once the DCA has
 * confirmed a concrete date and time for their Truck Maintenance slot.
 *
 * Safety contract (mirrors the heads-up SMS path):
 *  - IDEMPOTENT: a single CAS-claim (follow_up_claimed_at) prevents two
 *    concurrent sweeps from both sending the message. The claim is set before
 *    the comms provider is called and cleared once the result is persisted.
 *  - TRANSPORT-SAFE: if the provider call throws after Twilio accepted the
 *    message, the function looks for evidence in the comms lane and adopts it
 *    rather than blindly marking the send as failed (which would let a retry
 *    re-send).
 *  - DRY-RUN RETRYABLE: when the live gate is off the function records a
 *    preview note but leaves confirmation_status as 'confirmed' so the next
 *    sweep (once the gate is armed) can send the real text.
 */
async function runConfirmationFollowUp(
  cycle: CycleRow,
  ldap: string,
): Promise<ConfirmationOutcome> {
  // Already sent — strictly once per cycle.
  if (cycle.follow_up_sent_at || cycle.confirmation_status === "follow_up_sent") {
    return { action: "noop", detail: "confirmation follow-up already sent" };
  }

  const slotDate = (cycle.confirmed_slot_date || "").trim();
  const slotTime = (cycle.confirmed_slot_time || "").trim();
  if (!slotDate) {
    return { action: "noop", detail: "no confirmed slot recorded — awaiting DCA readback" };
  }

  const enterpriseId = cycle.enterprise_id || ldap;
  const dateTime = slotTime ? `${slotDate} at ${slotTime}` : slotDate;
  const body = buildMaintenanceConfirmationMessage(dateTime);
  const live = isMaintenanceSmsLive();

  if (!live) {
    // Gate is off: record a dry-run note but LEAVE confirmation_status as
    // 'confirmed' so the next sweep (once the live gate is armed) actually
    // sends the text. Writing 'follow_up_sent' here would suppress the real
    // send permanently — the tech would never receive the required message.
    let detail = "SMS gate off — confirmation follow-up dry run only";
    try {
      const preview = await sendMessage({
        ldap: enterpriseId,
        category: MAINTENANCE_CONFIRMATION_COMMS_CATEGORY,
        body,
        dryRun: true,
        sentBy: null,
        senderName: "Truck Maintenance",
      });
      detail = `SMS gate off — follow-up dry-run: ${preview.status}${preview.reason ? ` (${preview.reason})` : ""}`;
    } catch { /* dry-run failure is recorded but never blocks */ }
    await db.execute(sql`
      UPDATE fs_truck_maintenance_cycles
         SET follow_up_detail = ${detail}, updated_at = now()
       WHERE id = ${cycle.id}
    `);
    return { action: "dry_run", detail };
  }

  // ---------------------------------------------------------------------- //
  // CAS claim — stamps follow_up_claimed_at before calling the comms
  // provider. A stale claim (> TEXT_CLAIM_STALE_MS old) may be replaced by
  // a fresh one; an active claim from another worker causes a skip.
  // ---------------------------------------------------------------------- //
  const claimResult: any = await db.execute(sql`
    UPDATE fs_truck_maintenance_cycles
       SET follow_up_claimed_at = now(), updated_at = now()
     WHERE id = ${cycle.id}
       AND follow_up_sent_at IS NULL
       AND confirmation_status NOT IN ('follow_up_sent', 'follow_up_skipped')
       AND (follow_up_claimed_at IS NULL
            OR follow_up_claimed_at < now() - (${TEXT_CLAIM_STALE_MS / 1000}::text || ' seconds')::interval)
     RETURNING id
  `);
  if (((claimResult.rows ?? claimResult ?? []) as any[]).length === 0) {
    return { action: "noop", detail: "follow-up send already claimed by another worker" };
  }

  let result: Awaited<ReturnType<typeof sendMessage>>;
  try {
    result = await sendMessage({
      ldap: enterpriseId,
      category: MAINTENANCE_CONFIRMATION_COMMS_CATEGORY,
      body,
      sentBy: null,
      senderName: "Truck Maintenance",
      // The comms lane's 24h dedup is a second layer of protection but NOT the
      // primary guard — the CAS claim is. skipRecentDuplicate is intentionally
      // omitted here so that a stale-claim re-run after a transport error can
      // still send (evidence adoption below guards against true re-sends).
    });
  } catch (err: any) {
    // The throw may have happened AFTER the comms provider accepted the
    // message. Check the comms lane before deciding this is a retryable
    // failure — if the message landed, adopt it rather than allowing a retry.
    const thrown = `follow-up send threw: ${err?.message || err}`;
    let evidence: TextEvidence | null = null;
    let evidenceError: string | null = null;
    try {
      evidence = await findConfirmationEvidence(enterpriseId, body);
    } catch (lookupErr: any) {
      evidenceError = lookupErr?.message || String(lookupErr);
    }

    if (evidence) {
      const detail = `${thrown} — but the message reached the comms lane (${evidence.src}); adopted`;
      await db.execute(sql`
        UPDATE fs_truck_maintenance_cycles
           SET confirmation_status = 'follow_up_sent',
               follow_up_sent_at = ${evidence.created_at},
               follow_up_message_id = COALESCE(follow_up_message_id, ${evidence.id}),
               follow_up_claimed_at = NULL,
               follow_up_detail = ${detail},
               updated_at = now()
         WHERE id = ${cycle.id}
      `);
      return { action: evidence.src === "queue" ? "queued" : "sent", detail };
    }

    if (evidenceError) {
      // Cannot rule out a delivered message — leave the claim for stale-claim
      // recovery rather than marking the cycle as retryable.
      const detail = `${thrown} — comms lane unreadable (${evidenceError}); claim left for recovery`;
      return { action: "skipped", detail };
    }

    // Nothing reached the lane — safe to mark retryable and clear the claim.
    const detail = `${thrown} — nothing reached the comms lane`;
    await db.execute(sql`
      UPDATE fs_truck_maintenance_cycles
         SET confirmation_status = 'follow_up_failed',
             follow_up_claimed_at = NULL,
             follow_up_detail = ${detail},
             updated_at = now()
       WHERE id = ${cycle.id}
    `);
    return { action: "failed", detail };
  }

  if (result.status === "sent" || result.status === "queued") {
    await db.execute(sql`
      UPDATE fs_truck_maintenance_cycles
         SET confirmation_status = 'follow_up_sent',
             follow_up_sent_at = now(),
             follow_up_message_id = ${result.messageId ?? result.queueId ?? null},
             follow_up_claimed_at = NULL,
             follow_up_detail = ${result.reason ?? null},
             updated_at = now()
       WHERE id = ${cycle.id}
    `);
    return { action: result.status, detail: result.reason ?? null };
  }

  // Gate outcome: opted out, no phone, quiet hours, etc.
  const detail = result.reason ?? result.status;
  await db.execute(sql`
    UPDATE fs_truck_maintenance_cycles
       SET confirmation_status = 'follow_up_skipped',
           follow_up_claimed_at = NULL,
           follow_up_detail = ${detail},
           updated_at = now()
     WHERE id = ${cycle.id}
  `);
  return { action: "skipped", detail };
}

/**
 * Look for evidence that the confirmation text actually reached the comms
 * lane — used to adopt the message rather than re-sending after a transport
 * failure. Mirrors findTextEvidence but scoped to the confirmation category.
 */
async function findConfirmationEvidence(ldap: string, body: string): Promise<TextEvidence | null> {
  const evidence: any = await db.execute(sql`
    SELECT id::text AS id, created_at, 'message' AS src
      FROM fs_comms_messages
     WHERE direction = 'outbound'
       AND category = ${MAINTENANCE_CONFIRMATION_COMMS_CATEGORY}
       AND lower(ldap) = lower(${ldap})
       AND body = ${body}
       AND created_at >= now() - interval '3 days'
     UNION ALL
    SELECT id::text AS id, created_at, 'queue' AS src
      FROM fs_comms_send_queue
     WHERE category = ${MAINTENANCE_CONFIRMATION_COMMS_CATEGORY}
       AND lower(ldap) = lower(${ldap})
       AND body = ${body}
       AND status IN ('pending', 'claimed', 'sent')
       AND created_at >= now() - interval '3 days'
     ORDER BY created_at ASC
     LIMIT 1
  `);
  return ((evidence as any).rows ?? [])[0] ?? null;
}

/* ------------------------------------------------------------------------ *
 * Confirmation-pending sweep
 * ------------------------------------------------------------------------ */

/**
 * Booked cycles that have a confirmed slot recorded but have not yet received
 * the follow-up text. These are CLOSED rows (closed_at IS NOT NULL), so they
 * are invisible to listOpenCycles() and must be swept separately.
 *
 * A cycle belongs here when:
 *  - It was filed with the DCA (booking_status filed_live or duplicate).
 *  - An operator (or readback) set a concrete confirmed_slot_date.
 *  - The follow-up text has not been sent or skipped yet.
 */
export async function listConfirmationPendingCycles(): Promise<CycleRow[]> {
  // Exclude rows that have an active (non-stale) CAS claim so concurrent
  // sweeps do not both select and send the same cycle. A claim is stale if
  // it is older than TEXT_CLAIM_STALE_MS (15 min); stale rows are included
  // here so that recovery can release them.
  const staleCutoff = new Date(Date.now() - TEXT_CLAIM_STALE_MS).toISOString();
  const r: any = await db.execute(sql`
    SELECT id, truck_number, vin, ldap, enterprise_id, tech_name, district,
           status, odometer_at_trigger, watermark_at_trigger, miles_since_watermark,
           odometer_source, odometer_date, exclusion_reason, exclusion_detail,
           text_status, text_body, text_message_id, text_detail,
           text_claimed_at, texted_at,
           to_char(trigger_date,       'YYYY-MM-DD') AS trigger_date,
           to_char(booking_window_start,'YYYY-MM-DD') AS booking_window_start,
           to_char(booking_window_end,  'YYYY-MM-DD') AS booking_window_end,
           booking_due_at, booking_date, booking_status, booking_claimed_at,
           booking_attempted_at, booking_test_status, booking_test_detail,
           booking_test_project_name, booking_test_at,
           booking_project_name, booking_project_id, booking_detail, booked_at,
           confirmation_status,
           to_char(confirmed_slot_date::date, 'YYYY-MM-DD') AS confirmed_slot_date,
           confirmed_slot_time,
           follow_up_claimed_at, follow_up_sent_at, follow_up_message_id, follow_up_detail,
           attempts, last_error, opened_at, closed_at
      FROM fs_truck_maintenance_cycles
     WHERE booking_status IN ('filed_live', 'duplicate')
       AND confirmed_slot_date IS NOT NULL
       AND follow_up_sent_at IS NULL
       AND confirmation_status NOT IN ('follow_up_sent', 'follow_up_skipped')
       -- exclude rows with an active (non-stale) claim
       AND (follow_up_claimed_at IS NULL OR follow_up_claimed_at < ${staleCutoff}::timestamptz)
     ORDER BY booked_at ASC
     LIMIT 200
  `);
  return (r.rows ?? r ?? []) as CycleRow[];
}

/* ------------------------------------------------------------------------ *
 * Record a confirmed slot (operator input or readback)
 * ------------------------------------------------------------------------ */

/**
 * Record the DCA-confirmed date and time on a booked cycle, unlocking the
 * follow-up text step. Safe to call repeatedly (COALESCE keeps the first
 * non-null value unless `force` is set).
 */
export async function recordConfirmedSlot(
  cycleId: number,
  args: { slotDate: string; slotTime?: string | null; actor?: string | null; force?: boolean },
): Promise<{ ok: boolean; error?: string }> {
  const slotDate = (args.slotDate || "").trim();
  if (!slotDate) return { ok: false, error: "slotDate is required" };

  const r: any = await db.execute(sql`
    UPDATE fs_truck_maintenance_cycles
       SET confirmed_slot_date = ${slotDate},
           confirmed_slot_time = ${args.slotTime ?? null},
           confirmation_status = CASE
             WHEN confirmation_status IN ('follow_up_sent', 'follow_up_skipped') AND NOT ${args.force ?? false}
             THEN confirmation_status
             ELSE 'confirmed'
           END,
           updated_at = now()
     WHERE id = ${cycleId}
       AND (booking_status = 'filed_live' OR booking_status = 'duplicate')
     RETURNING id
  `);
  if (((r.rows ?? r ?? []) as any[]).length === 0) {
    return { ok: false, error: `cycle ${cycleId} not found or not in a booked state` };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------------ *
 * Approaching-threshold view
 * ------------------------------------------------------------------------ */

export interface ApproachingTruck {
  truckNumber: string;
  vin: string | null;
  odometer: number;
  watermark: number;
  milesSinceWatermark: number;
  milesRemaining: number;
  odometerDate: string | null;
  odometerSource: string | null;
  ldap: string | null;
  techName: string | null;
  district: string | null;
}

/**
 * Read-only list of trucks that are within `approachingMiles` of firing the
 * 5,500-mile trigger but have not yet opened a cycle. Purely informational —
 * no texts, no bookings, no state changes.
 *
 * The same reconciled odometer + watermark data the sweep reads, so the
 * numbers here are exactly what the engine will see on its next run.
 */
export async function getApproachingThresholdTrucks(
  approachingMiles: number = getMaintenanceApproachingMiles(),
): Promise<ApproachingTruck[]> {
  const lowerBound = MAINTENANCE_TRIGGER_MILES - Math.abs(approachingMiles);
  const r: any = await db.execute(sql`
    SELECT hvc.holman_vehicle_number AS truck_number,
           hvc.vin,
           hvc.odometer,
           hvc.odometer_date,
           hvc.odometer_source,
           wmk.last_service_odometer AS watermark,
           (hvc.odometer - wmk.last_service_odometer)::int AS miles_since_watermark,
           (${MAINTENANCE_TRIGGER_MILES} - (hvc.odometer - wmk.last_service_odometer))::int AS miles_remaining
      FROM holman_vehicles_cache hvc
      JOIN fs_truck_maintenance_watermarks wmk
        ON wmk.truck_number = ltrim(hvc.holman_vehicle_number, '0')
     WHERE hvc.odometer IS NOT NULL
       AND COALESCE(hvc.is_active, true) = true
       AND (hvc.odometer - wmk.last_service_odometer) >= ${lowerBound}
       AND (hvc.odometer - wmk.last_service_odometer) < ${MAINTENANCE_TRIGGER_MILES}
       AND NOT EXISTS (
         SELECT 1 FROM fs_truck_maintenance_cycles cyc
          WHERE cyc.truck_number = ltrim(hvc.holman_vehicle_number, '0')
            AND cyc.closed_at IS NULL
       )
     ORDER BY (hvc.odometer - wmk.last_service_odometer) DESC
     LIMIT 500
  `);
  const rows = (r.rows ?? r ?? []) as Array<{
    truck_number: string;
    vin: string | null;
    odometer: number | string;
    odometer_date: string | null;
    odometer_source: string | null;
    watermark: number | string;
    miles_since_watermark: number | string;
    miles_remaining: number | string;
  }>;

  // Enrich with live TPMS assignments for the "assigned tech" column.
  const displayNumbers = rows.map((row) => row.truck_number);
  const assignments = displayNumbers.length > 0
    ? await loadTechAssignments(displayNumbers)
    : new Map<string, TechAssignment>();

  return rows.map((row) => {
    const canonical = toCanonical(row.truck_number);
    const assignment = assignments.get(canonical) ?? null;
    return {
      truckNumber: row.truck_number,
      vin: row.vin,
      odometer: typeof row.odometer === "string" ? Number.parseInt(row.odometer, 10) : row.odometer,
      watermark: typeof row.watermark === "string" ? Number.parseInt(row.watermark, 10) : row.watermark,
      milesSinceWatermark: typeof row.miles_since_watermark === "string"
        ? Number.parseInt(row.miles_since_watermark, 10)
        : row.miles_since_watermark,
      milesRemaining: typeof row.miles_remaining === "string"
        ? Number.parseInt(row.miles_remaining, 10)
        : row.miles_remaining,
      odometerDate: row.odometer_date,
      odometerSource: row.odometer_source,
      ldap: assignment?.ldap ?? null,
      techName: assignment?.name ?? null,
      district: assignment?.district ?? null,
    };
  });
}

/* ------------------------------------------------------------------------ *
 * Fleet roster — the read-only "whole fleet at a glance" view (Task #680).
 * ------------------------------------------------------------------------ */

export interface RosterTruck {
  truckNumber: string;
  vin: string | null;
  odometer: number;
  odometerDate: string | null;
  odometerSource: string | null;
  amsStatus: string | null;
  ldap: string | null;
  techName: string | null;
  district: string | null;
}

export interface FleetRoster {
  trucks: RosterTruck[];
  excluded: { byov: number; amsBlocked: number; amsUnknown: number };
  /** Newest write time on the reconciled-odometer source rows. */
  odometerRefreshedAt: string | null;
  /** Newest sync time on the TPMS assignment mirror rows. */
  techRefreshedAt: string | null;
  generatedAt: string;
}

export class AmsMapWarmingError extends Error {
  constructor() {
    super("AMS truck-status data is still loading — the roster will appear once the repair/auction exclusions can be applied (usually a few minutes)");
    this.name = "AmsMapWarmingError";
  }
}

/**
 * Decide how a roster request should treat the AMS truck-status cache.
 * Pure so it can be unit-tested; getFleetRoster owns the actual state.
 *
 *  - "serve"      — cache is usable, build the roster from it
 *  - "warming"    — a build is in flight, answer 503 {warming:true}
 *  - "start_warm" — no cache and nothing in flight: kick a build, then warming
 *  - "failed"     — the last build FAILED recently and no build is running;
 *                   this is a real error, not an endless warming state
 */
export function decideRosterAmsAction(s: {
  cacheReady: boolean;
  buildInFlight: boolean;
  lastFailureAt: number | null;
  now: number;
  failureCooldownMs: number;
}): "serve" | "warming" | "start_warm" | "failed" {
  if (s.cacheReady) return "serve";
  if (s.buildInFlight) return "warming";
  if (s.lastFailureAt != null && s.now - s.lastFailureAt < s.failureCooldownMs) return "failed";
  return "start_warm";
}

export interface RosterAmsFacts {
  /** VIN (upper-cased) → resolved status label, from the bulk cache. */
  statusByVin: Record<string, string | null>;
  /** VIN → VehicleInRepair where the bulk rows carried the flag. Absent = unknown. */
  inRepairByVin: Record<string, boolean>;
}

/**
 * Pure roster row construction — the exclusion rules, mirroring the
 * eligibility gate's truck-level checks and its fail-closed posture:
 *   - BYOV, decided on the RAW number (padding first hides 5-digit BYOVs)
 *   - AMS status In Repair / Declined Repair / Sent To Auction
 *   - AMS VehicleInRepair === true wherever the bulk build captured the flag
 *   - FAIL CLOSED on unreadable AMS facts: no VIN, VIN absent from the bulk
 *     map, or an unresolvable status — excluded and counted as amsUnknown,
 *     never silently listed (the gate blocks these trucks the same way).
 */
export function buildRosterRows(
  candidates: Array<{
    truckNumber: string;
    displayNumber: string;
    vin: string | null;
    odometer: number;
    odometerDate: string | null;
    odometerSource: string | null;
  }>,
  assignments: Map<string, { ldap: string | null; name: string | null; district: string | null }>,
  ams: RosterAmsFacts,
): { trucks: RosterTruck[]; excluded: FleetRoster["excluded"] } {
  const excluded = { byov: 0, amsBlocked: 0, amsUnknown: 0 };
  const trucks: RosterTruck[] = [];
  for (const c of candidates) {
    // Same rule as evaluateCandidate: prefix check on the raw/display number.
    if (/^88/.test((c.displayNumber || c.truckNumber).trim())) {
      excluded.byov++;
      continue;
    }
    const vin = c.vin ? c.vin.trim().toUpperCase() : null;
    if (!vin || !(vin in ams.statusByVin)) {
      excluded.amsUnknown++;
      continue;
    }
    const amsStatus = ams.statusByVin[vin] ?? null;
    if (amsStatus == null || amsStatus.trim() === "" || amsStatus.trim().toLowerCase() === "unknown") {
      excluded.amsUnknown++;
      continue;
    }
    if (isBlockingAmsStatus(amsStatus) || ams.inRepairByVin[vin] === true) {
      excluded.amsBlocked++;
      continue;
    }
    const assignment = assignments.get(c.truckNumber) ?? null;
    trucks.push({
      truckNumber: c.displayNumber || c.truckNumber,
      vin: c.vin,
      odometer: c.odometer,
      odometerDate: c.odometerDate,
      odometerSource: c.odometerSource,
      amsStatus,
      ldap: assignment?.ldap ?? null,
      techName: assignment?.name ?? null,
      district: assignment?.district ?? null,
    });
  }
  return { trucks, excluded };
}

// Roster-side view of the AMS warm lifecycle. warmAmsTruckStatusCache logs
// and swallows its own failures, so the roster tracks the outcome itself:
// after a failed build (and until the cooldown lapses or a new build starts)
// requests get a REAL error instead of an eternal {warming:true}.
const ROSTER_AMS_FAILURE_COOLDOWN_MS = 2 * 60_000;
let rosterAmsWarmInFlight = false;
let rosterAmsLastFailure: { at: number; message: string } | null = null;

/**
 * The roster reuses the sweep's exact reads — loadOdometerCandidates() for
 * the reconciled odometer and loadTechAssignments() for the TPMS technician —
 * so a truck shown here always agrees with what the sweep would compute.
 * Exclusion rules live in buildRosterRows above.
 *
 * The AMS map's cold build takes minutes (AMS pagination + the Snowflake
 * supplement), so the roster never awaits it inline: it serves from the
 * warmed cache, answers AmsMapWarmingError (→503) while a build runs, and
 * surfaces a real error when the last build failed.
 */
export async function getFleetRoster(): Promise<FleetRoster> {
  const {
    getAmsTruckStatusMapCachedOnly,
    getAmsInRepairMapCachedOnly,
    isAmsTruckStatusCacheStale,
    warmAmsTruckStatusCache,
  } = await import("../ams-truck-status-cache");

  const startWarm = () => {
    rosterAmsWarmInFlight = true;
    // warmAmsTruckStatusCache never rejects (it logs internally), so probe the
    // cache afterwards to learn whether the build actually produced data.
    warmAmsTruckStatusCache()
      .then(() => {
        const map = getAmsTruckStatusMapCachedOnly();
        if (!map || Object.keys(map).length === 0) {
          rosterAmsLastFailure = { at: Date.now(), message: "AMS truck-status build completed without data" };
        } else {
          rosterAmsLastFailure = null;
        }
      })
      .catch((err: any) => {
        rosterAmsLastFailure = { at: Date.now(), message: err?.message || String(err) };
      })
      .finally(() => {
        rosterAmsWarmInFlight = false;
      });
  };

  const amsMap = getAmsTruckStatusMapCachedOnly();
  const cacheReady = !!amsMap && Object.keys(amsMap).length > 0;
  const action = decideRosterAmsAction({
    cacheReady,
    buildInFlight: rosterAmsWarmInFlight,
    lastFailureAt: rosterAmsLastFailure?.at ?? null,
    now: Date.now(),
    failureCooldownMs: ROSTER_AMS_FAILURE_COOLDOWN_MS,
  });
  if (action === "start_warm") {
    startWarm();
    throw new AmsMapWarmingError();
  }
  if (action === "warming") throw new AmsMapWarmingError();
  if (action === "failed") {
    throw new Error(
      `AMS truck-status data could not be loaded (${rosterAmsLastFailure?.message || "build failed"}) — the roster cannot apply the repair/auction exclusions`,
    );
  }
  if (isAmsTruckStatusCacheStale() && !rosterAmsWarmInFlight) {
    // Serve the last-good map now; refresh behind the scenes for the next read.
    startWarm();
  }

  const candidates = await loadOdometerCandidates();
  const assignments = await loadTechAssignments(candidates.map((c) => c.truckNumber));
  const { trucks, excluded } = buildRosterRows(candidates, assignments, {
    statusByVin: amsMap!,
    inRepairByVin: getAmsInRepairMapCachedOnly() ?? {},
  });

  const fresh: any = await db.execute(sql`
    SELECT
      (SELECT max(updated_at) FROM holman_vehicles_cache WHERE odometer IS NOT NULL) AS odo,
      (SELECT max(updated_at) FROM tpms_tech_profiles) AS tech
  `);
  const row = (fresh.rows ?? fresh ?? [])[0] ?? {};

  return {
    trucks,
    excluded,
    odometerRefreshedAt: row.odo ? new Date(row.odo).toISOString() : null,
    techRefreshedAt: row.tech ? new Date(row.tech).toISOString() : null,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Did this exact message actually reach the comms lane?
 *
 * The one question that decides whether a text may be sent again. Used both by
 * stale-claim recovery and by the send step's own error path, so a delivered
 * message can never be re-sent because the bookkeeping write failed after it.
 */
async function findTextEvidence(ldap: string, body: string): Promise<TextEvidence | null> {
  const evidence: any = await db.execute(sql`
    SELECT id::text AS id, created_at, 'message' AS src
      FROM fs_comms_messages
     WHERE direction = 'outbound'
       AND category = ${MAINTENANCE_COMMS_CATEGORY}
       AND lower(ldap) = lower(${ldap})
       AND body = ${body}
       AND created_at >= now() - interval '3 days'
    UNION ALL
    SELECT id::text AS id, created_at, 'queue' AS src
      FROM fs_comms_send_queue
     WHERE category = ${MAINTENANCE_COMMS_CATEGORY}
       AND lower(ldap) = lower(${ldap})
       AND body = ${body}
       AND status IN ('pending', 'claimed', 'sent')
       AND created_at >= now() - interval '3 days'
     ORDER BY created_at ASC
     LIMIT 1
  `);
  return ((evidence as any).rows ?? [])[0] ?? null;
}

/**
 * Send the digest at most once per ET day, and only when there is something
 * to say. Recipients come from TRUCK_MAINTENANCE_DIGEST_EMAILS; unset =
 * disabled, stated in the returned reason rather than silently skipped.
 * The day is claimed only AFTER a successful send: a failed send retries on
 * the next forced sweep rather than losing the day.
 */
export async function sendStaleBlockedDigestIfDue(opts: {
  todayET: string;
  trigger: string;
}): Promise<{ sent: boolean; reason: string; count: number }> {
  const recipients = getMaintenanceDigestRecipients();
  if (recipients.length === 0) {
    return { sent: false, reason: "TRUCK_MAINTENANCE_DIGEST_EMAILS not configured — digest disabled", count: 0 };
  }
  const last = await getSetting(SETTING_LAST_DIGEST_DATE);
  if (last === opts.todayET) {
    return { sent: false, reason: `digest already sent today (${opts.todayET} ET)`, count: 0 };
  }
  const thresholdDays = getMaintenanceStaleExclusionDays();
  const rows = await listStaleBlockedCycles(thresholdDays);
  const digest = buildStaleBlockedDigest(rows, thresholdDays);
  if (!digest) {
    return { sent: false, reason: `no cycles blocked more than ${thresholdDays} days`, count: 0 };
  }
  const { sendEmail } = await import("../email-service");
  const result = await sendEmail({
    to: recipients[0],
    ...(recipients.length > 1 ? { cc: recipients.slice(1) } : {}),
    from: "",
    subject: digest.subject,
    text: digest.text,
  });
  if (!result.success) {
    return { sent: false, reason: `digest email failed: ${result.error ?? "unknown error"}`, count: rows.length };
  }
  await setSetting(SETTING_LAST_DIGEST_DATE, opts.todayET, opts.trigger);
  return { sent: true, reason: `digest sent to ${recipients.length} recipient(s)`, count: rows.length };
}

/** Pure formatter, so the digest content is unit-testable without a mailbox. */
export function buildStaleBlockedDigest(
  rows: StaleBlockedCycle[],
  thresholdDays: number,
): { subject: string; text: string } | null {
  if (rows.length === 0) return null;
  const subject =
    `Truck Maintenance: ${rows.length} cycle${rows.length === 1 ? "" : "s"} `
    + `blocked more than ${thresholdDays} days`;
  const lines = rows.map((r) => {
    const who = r.tech_name || r.ldap || "no technician";
    const drift = r.miles_past_trigger != null && r.miles_past_trigger > 0
      ? `now ${r.current_odometer?.toLocaleString()} mi — ${r.miles_past_trigger.toLocaleString()} mi past the trigger reading`
      : r.current_odometer != null
        ? `current reading ${r.current_odometer.toLocaleString()} mi`
        : "no current odometer reading";
    return (
      `- Truck ${r.truck_number} (${who}): blocked ${r.blocked_days} days — `
      + `${r.exclusion_reason}${r.exclusion_detail ? ` (${r.exclusion_detail})` : ""}; `
      + `triggered at ${r.odometer_at_trigger.toLocaleString()} mi, ${drift}`
    );
  });
  const text =
    `These maintenance cycles have been blocked by the same reason for more than `
    + `${thresholdDays} days. They will not proceed until the block clears — each one `
    + `needs a human to chase the shop, the assignment, or the data:\n\n`
    + lines.join("\n")
    + `\n\nSee the Truck Maintenance monitoring screen for the full detail.`;
  return { subject, text };
}

/**
 * Every open cycle blocked by the same reason for >= thresholdDays, oldest
 * first, enriched with the truck's CURRENT reconciled odometer so a human can
 * see how far past its interval the truck has drifted while stuck.
 *
 * The lateral join canonicalizes the Holman number in SQL the same way
 * toCanonical does (strip leading zeros) — cycles store canonical numbers,
 * the vehicle cache stores display numbers, and legacy rows exist in both
 * formats, so the highest plausible reading wins.
 */
export async function listStaleBlockedCycles(
  thresholdDays: number = getMaintenanceStaleExclusionDays(),
): Promise<StaleBlockedCycle[]> {
  const r: any = await db.execute(sql`
    SELECT c.id, c.truck_number, c.ldap, c.enterprise_id, c.tech_name,
           c.exclusion_reason, c.exclusion_detail, c.exclusion_since,
           FLOOR(EXTRACT(EPOCH FROM (now() - c.exclusion_since)) / 86400)::int AS blocked_days,
           c.odometer_at_trigger,
           cur.odometer AS current_odometer,
           (cur.odometer - c.odometer_at_trigger) AS miles_past_trigger
      FROM fs_truck_maintenance_cycles c
      LEFT JOIN LATERAL (
        SELECT h.odometer
          FROM holman_vehicles_cache h
         WHERE COALESCE(NULLIF(regexp_replace(TRIM(h.holman_vehicle_number), '^0+', ''), ''), '0') = c.truck_number
           AND h.odometer IS NOT NULL
           AND h.odometer BETWEEN ${ODOMETER_MIN} AND ${ODOMETER_MAX}
           AND COALESCE(h.is_active, true) = true
         ORDER BY h.odometer DESC
         LIMIT 1
      ) cur ON true
     WHERE c.closed_at IS NULL
       AND c.status = 'excluded'
       AND c.exclusion_since IS NOT NULL
       AND c.exclusion_since <= now() - (${thresholdDays}::text || ' days')::interval
     ORDER BY c.exclusion_since ASC
  `);
  return ((r.rows ?? r ?? []) as any[]).map((row) => ({
    ...row,
    odometer_at_trigger: Number(row.odometer_at_trigger),
    current_odometer: row.current_odometer == null ? null : Number(row.current_odometer),
    miles_past_trigger: row.miles_past_trigger == null ? null : Number(row.miles_past_trigger),
    blocked_days: Number(row.blocked_days),
  }));
}

/**
 * True when a cycle has been blocked by the same reason for at least the
 * configured threshold — the "overdue / needs a human" flag (Task #674).
 */
export function isExclusionStale(
  since: Date | string | null | undefined,
  thresholdDays: number = getMaintenanceStaleExclusionDays(),
  now: Date = new Date(),
): boolean {
  const days = computeBlockedDays(since, now);
  return days !== null && days >= thresholdDays;
}
