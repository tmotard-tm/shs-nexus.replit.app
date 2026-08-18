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
  MAINTENANCE_PROJECT_LABEL,
  MAINTENANCE_PROJECT_NOTES,
  MAINTENANCE_START_TIME,
  MAINTENANCE_TRIGGER_MILES,
  ODOMETER_MAX,
  ODOMETER_MIN,
  buildMaintenanceMessage,
  buildMaintenanceRowNotes,
  getMaintenanceActivityType,
  getMaintenanceBookingLeadDays,
  isMaintenanceBookingLive,
  isMaintenanceSmsLive,
} from "./constants";
import {
  buildEligibilityContext,
  evaluateCandidate,
  loadTechAssignments,
  resolveTechRacf,
  type EligibilityContext,
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

/* ------------------------------------------------------------------------ *
 * Settings (kill switch + daily watermark)
 * ------------------------------------------------------------------------ */

export const SETTING_PAUSED = "cycle_open_paused";
export const SETTING_LAST_SWEEP_DATE = "last_sweep_date_et";

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
  text_status: string | null;
  text_body: string | null;
  text_message_id: string | null;
  text_detail: string | null;
  text_claimed_at: Date | string | null;
  texted_at: Date | string | null;
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

async function markExcluded(cycle: CycleRow, code: string, detail: string | null): Promise<void> {
  await db.execute(sql`
    UPDATE fs_truck_maintenance_cycles
       SET status = 'excluded',
           exclusion_reason = ${code},
           exclusion_detail = ${detail},
           eligibility_checked_at = now(),
           updated_at = now()
     WHERE id = ${cycle.id} AND closed_at IS NULL
  `);
}

async function clearExclusion(cycle: CycleRow, assignment: {
  ldap: string | null; name: string | null; district: string | null;
}): Promise<void> {
  await db.execute(sql`
    UPDATE fs_truck_maintenance_cycles
       SET status = CASE WHEN status = 'excluded' THEN 'open' ELSE status END,
           exclusion_reason = NULL,
           exclusion_detail = NULL,
           ldap = ${assignment.ldap},
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

async function runTextStep(cycle: CycleRow, ldap: string, truckNumber: string): Promise<TextOutcome> {
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
       AND (text_status IS NULL OR text_status IN ('dry_run', 'failed'))
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
    await db.execute(sql`
      UPDATE fs_truck_maintenance_cycles
         SET status = 'texted',
             text_status = ${result.status},
             text_message_id = ${result.messageId ?? result.queueId ?? null},
             text_detail = ${result.reason ?? null},
             text_claimed_at = NULL,
             texted_at = now(),
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
  const { cycle, ldap, truckNumber } = args;

  // Re-checked here even though eligibility already blocked on it: days pass
  // between the text and the filing, and a technician can leave in between.
  const { racf, employmentStatus, error: racfError } = await resolveTechRacf(ldap);
  if (racfError || !racf) {
    const detail = racfError
      ? `RACF lookup failed for ${ldap} (${racfError}) — not filing`
      : `no RACF id for ${ldap} — cannot file a route block`;
    await markFailed(cycle.id, detail);
    return { action: "failed", detail };
  }
  // Explicit "A" required: an absent or unknown status is not a green light.
  if ((employmentStatus || "").trim().toUpperCase() !== "A") {
    const detail = `${ldap} employment status is ${employmentStatus || "unknown"} (not active) — not filing`;
    await markFailed(cycle.id, detail);
    return { action: "failed", detail };
  }

  const unit = (args.district || cycle.district || "").trim();
  if (!unit) {
    const detail = `no district/unit for ${ldap} — the payload requires Unit`;
    await markFailed(cycle.id, detail);
    return { action: "failed", detail };
  }

  // ---------------------------------------------------------------------- //
  // The TEST hatch: a wire check, and NOTHING it does may touch the
  // production filing claim. A TEST row is a separate upstream object (its
  // project name is TEST-prefixed), so sharing the claim would freeze the real
  // filing on the TEST's date — the smoke test would sabotage the booking it
  // exists to prove.
  // ---------------------------------------------------------------------- //
  if (args.testFiling) {
    const testDate = nextBusinessDay(new Date());
    const testPayload = {
      ...buildBookingPayloadArgs({ racf, unit, truckNumber, date: testDate }),
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

  // Record the date + a 'pending' marker BEFORE filing. The date is frozen once
  // a POST has been attempted for this cycle, because the project name embeds
  // it and a re-dated name would slip past the upstream duplicate guard.
  const claimed = await claimBooking(cycle.id, nextBusinessDay(new Date()));
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

  const payloadArgs = { ...buildBookingPayloadArgs({ racf, unit, truckNumber, date }), live };

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
  step: "excluded" | "text" | "booking" | "waiting" | "noop";
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
    return { cycleId: cycle.id, truckNumber: cycle.truck_number, step: "noop", action: "already_booked", detail: null };
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

/** The payload arguments shared by the live, dry-run and TEST paths. */
function buildBookingPayloadArgs(args: {
  racf: string;
  unit: string;
  truckNumber: string;
  date: string;
}) {
  return {
    techLdap: args.racf,
    unit: args.unit,
    truckNumber: args.truckNumber,
    date: args.date,
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
  await db.execute(sql`
    UPDATE fs_truck_maintenance_cycles
       SET status = 'texted',
           text_status = ${hit.src === "queue" ? "queued" : "sent"},
           text_message_id = COALESCE(text_message_id, ${hit.id}),
           text_detail = ${detail},
           text_claimed_at = NULL,
           texted_at = ${hit.created_at},
           booking_due_at = ${hit.created_at}::timestamp + (${leadDays}::text || ' days')::interval,
           last_error = NULL,
           updated_at = now()
     WHERE id = ${cycleId} AND closed_at IS NULL AND text_status = 'pending'
  `);
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
