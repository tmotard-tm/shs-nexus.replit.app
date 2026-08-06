/**
 * Manual pickup scheduling — VRM Rental Operations owns the tech-pickup date
 * for a rental case. This replaces the queue's old "CHECK WITH MORGAN TO
 * SCHEDULE" step (user directive 2026-08-05): scheduling is done in-house now,
 * and staff must be able to set the date even when LUCA or the technician
 * never produced one.
 *
 * Two halves, one action:
 *
 *   1. RECORD the scheduled date — append-only `vrm_rental_operation_actions`
 *      row (action_type='schedule_pickup', mark_value=YYYY-MM-DD or 'cleared')
 *      plus a write-through mirror to fs_trucks.scheduled_pickup_date. The
 *      mirror is a plain UPDATE (like the reconcile phone mirror): no status
 *      side effects, and lastUpdatedBy is left alone so the fleet-status adopt
 *      guard keeps seeing the true last STATUS writer. If the mirror fails the
 *      just-appended action is compensating-deleted, same as appendFleetStatus,
 *      so history and fs_trucks cannot diverge silently.
 *
 *   2. Optionally FILE the rental-return route block through the Standard
 *      Activities API (dca-task-client.sendStandardActivity) — the time block
 *      Morgan used to book by hand: the tech returns the Enterprise rental and
 *      collects the repaired van in one 2-hour block. Live sends are gated on
 *      LUCA_ROUTE_BLOCK_ENABLED (the flag name the client itself documents);
 *      until it is set, projects file with a TEST prefix the receiving system
 *      does not process — same dark-launch the client was designed for.
 *
 * Ordering matters: the action row + mirror land FIRST, the API fires second,
 * and the outcome is attached to the row's payload afterwards. A filing
 * failure never loses the date; a mirror failure never leaves an orphaned
 * upstream block.
 *
 * Identity chain for the filing (same as pickup-sms, and it is the part that
 * bites): MasterRow.employee_id -> all_techs.tech_racfid (RACF — the payroll
 * employee_id is NEVER the route key). Unit = the identity resolver's
 * district. On the declined/auction redirect cohort the tech collects their
 * ASSIGNED truck at ITS shop, so the block names that truck — same redirect
 * rule as ready-notify and the pickup text.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { getRentalOpsMaster, type MasterRow } from "./read-repository";
import { sendStandardActivity } from "../dca-task-client";

export const SCHEDULE_PICKUP_ACTION_TYPE = "schedule_pickup";

/** Live-send gate. Unset/false => TEST-prefixed projects (not processed). */
export function isRouteBlockLive(): boolean {
  return /^(true|1|yes|on)$/i.test((process.env.LUCA_ROUTE_BLOCK_ENABLED ?? "").trim());
}

/** Today's date in America/New_York as YYYY-MM-DD (ops staff run on ET). */
export function todayInET(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

/**
 * Returns an error message, or null when the date is a valid YYYY-MM-DD that
 * is today-or-later in ET. String comparison is exact for ISO dates.
 */
export function validateScheduleDate(date: string, todayISO: string = todayInET()): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return `Date must be YYYY-MM-DD, got ${JSON.stringify(date)}`;
  }
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return `Not a real calendar date: ${date}`;
  }
  if (date < todayISO) {
    return `Scheduled date ${date} is in the past (today is ${todayISO} ET)`;
  }
  return null;
}

export interface RouteBlockOutcome {
  requested: boolean;
  /** filed_live | filed_test | duplicate | skipped | failed */
  status: "filed_live" | "filed_test" | "duplicate" | "skipped" | "failed";
  mode: "live" | "test";
  projectName: string | null;
  projectId: string | null;
  httpStatus: number | null;
  /** Present on duplicate/skipped/failed — human-readable, shown in the UI. */
  reason: string | null;
  /** Identity used (audit): RACF + unit + the truck the tech collects. */
  techRacf: string | null;
  unit: string | null;
  collectTruck: string | null;
  shopName: string | null;
}

function skipped(reason: string): RouteBlockOutcome {
  return {
    requested: true, status: "skipped", mode: isRouteBlockLive() ? "live" : "test",
    projectName: null, projectId: null, httpStatus: null, reason,
    techRacf: null, unit: null, collectTruck: null, shopName: null,
  };
}

/**
 * Resolve identity + file the Standard Activity. Never throws — every failure
 * is an outcome the action payload records and the UI shows.
 */
async function fileRouteBlockFor(caseKey: string, date: string): Promise<RouteBlockOutcome> {
  let row: MasterRow | undefined;
  try {
    const model = await getRentalOpsMaster({});
    row = model.rows.find((r) => r.case_key === caseKey);
  } catch (e: any) {
    return skipped(`could not load the rental board to resolve the tech: ${e?.message || e}`);
  }
  if (!row) return skipped(`case ${caseKey} is not on the rental board — cannot resolve tech/route`);
  if (!row.employee_id) return skipped("no technician resolved on this rental — resolve the identity first");

  let racf = "";
  let rosterStatus = "";
  try {
    const r = await db.execute<{ tech_racfid: string | null; employment_status: string | null }>(sql`
      SELECT tech_racfid, employment_status
        FROM all_techs
       WHERE employee_id = ${row.employee_id}
       LIMIT 1
    `);
    racf = ((r as any).rows?.[0]?.tech_racfid || "").trim();
    rosterStatus = ((r as any).rows?.[0]?.employment_status || "").trim().toUpperCase();
  } catch (e: any) {
    return skipped(`roster lookup failed: ${e?.message || e}`);
  }
  if (!racf) return skipped(`no RACF id on the roster for employee ${row.employee_id} — the route API is keyed on RACF`);
  if (rosterStatus && rosterStatus !== "A") {
    return skipped(`tech is not active on the roster (status ${rosterStatus}) — a route block cannot be scheduled for them`);
  }
  const unit = (row.tech_district ?? "").toString().trim();
  if (!unit) return skipped("no district resolved for the tech — Unit is required by the route API");

  // Redirect rule (same as ready-notify / pickup text): on declined/auction
  // the truck the tech collects is their ASSIGNED truck at ITS shop.
  const redirect = !!(row.redirect_to_assigned && row.call_target_truck);
  const collectTruck = redirect ? String(row.call_target_truck) : caseKey;
  const shopName = (redirect ? row.call_shop_name : row.shop_name) ?? null;

  const live = isRouteBlockLive();
  let res: Awaited<ReturnType<typeof sendStandardActivity>>;
  try {
    res = await sendStandardActivity({
      techLdap: racf.toUpperCase(),
      unit,
      truckNumber: collectTruck,
      shopName,
      date,
      live,
    });
  } catch (e: any) {
    // The client catches common transport failures itself, but this module's
    // contract is stronger: filing NEVER throws past this point — the date is
    // already recorded and the caller needs an outcome, not a 500.
    return {
      requested: true, status: "failed", mode: live ? "live" : "test",
      projectName: null, projectId: null, httpStatus: null,
      reason: `route API call threw: ${e?.message || e}`,
      techRacf: racf.toUpperCase(), unit, collectTruck, shopName,
    };
  }

  const base = {
    requested: true as const,
    mode: (live ? "live" : "test") as "live" | "test",
    projectName: res.projectName ?? null,
    projectId: res.projectId,
    httpStatus: res.httpStatus,
    techRacf: racf.toUpperCase(),
    unit,
    collectTruck,
    shopName,
  };
  if (res.ok) return { ...base, status: live ? "filed_live" : "filed_test", reason: null };
  if (res.skipReason === "duplicate") {
    return { ...base, status: "duplicate", reason: res.errorMessage ?? "block already filed upstream for this date" };
  }
  if (res.skipReason === "missing_config") {
    return { ...base, status: "skipped", reason: res.errorMessage ?? "route API not configured" };
  }
  return { ...base, status: "failed", reason: res.errorMessage ?? `route API returned HTTP ${res.httpStatus ?? "?"}` };
}

export interface AppendSchedulePickupResult {
  ok: true;
  caseKey: string;
  /** null = cleared */
  scheduledDate: string | null;
  mirroredTruckId: string | null;
  mirroredTruckNumber: string | null;
  routeBlock: RouteBlockOutcome | null;
  /** Set when an EARLIER date already had a block filed — it cannot be canceled from here. */
  priorFiledBlockWarning: string | null;
}

/**
 * Record (or clear) the tech-pickup date on a case and optionally file the
 * rental-return route block. Throws (with statusCode) on unknown case or
 * invalid date; filing failures do NOT throw — they come back in the result.
 */
export async function appendSchedulePickup(args: {
  caseKey: string;
  date: string | null;
  fileRouteBlock: boolean;
  actor: string;
}): Promise<AppendSchedulePickupResult> {
  const { caseKey, date, fileRouteBlock, actor } = args;

  if (date !== null) {
    const dateError = validateScheduleDate(date);
    if (dateError) {
      const err: any = new Error(dateError);
      err.statusCode = 400;
      throw err;
    }
  }

  const caseRes = await db.execute(sql`
    SELECT id, case_key, vehicle_number, vehicle_number_padded
    FROM vrm_rental_operations_cases
    WHERE case_key = ${caseKey}
    LIMIT 1
  `);
  const caseRow = ((caseRes as any).rows ?? caseRes ?? [])[0];
  if (!caseRow) {
    const err: any = new Error(`Unknown case: ${caseKey}`);
    err.statusCode = 404;
    throw err;
  }

  // Warn when ANY earlier action filed (or may have filed) a block for a
  // different date — the Standard Activities API has no cancel/delete, so old
  // blocks stand until a DCA removes them by hand. Scan the case's whole
  // schedule history, NOT just the latest row: a clear or a no-filing save in
  // between must not hide a live block. 'pending' rows (outcome never
  // recorded, e.g. crash mid-flight) warn conservatively.
  let priorFiledBlockWarning: string | null = null;
  try {
    const prior = await db.execute(sql`
      SELECT DISTINCT
        payload->>'scheduled_date' AS d,
        payload->'route_block'->>'status' AS s
      FROM vrm_rental_operation_actions
      WHERE case_key = ${caseKey} AND action_type = ${SCHEDULE_PICKUP_ACTION_TYPE}
        AND payload->'route_block'->>'status' IN ('filed_live', 'duplicate', 'pending')
        AND payload->>'scheduled_date' IS NOT NULL
    `);
    const hits = (((prior as any).rows ?? []) as Array<{ d: string | null; s: string | null }>)
      .filter((r) => r.d && r.d !== date);
    if (hits.length > 0) {
      const certain = Array.from(new Set(hits.filter((r) => r.s !== "pending").map((r) => r.d))).sort();
      const maybe = Array.from(new Set(hits.filter((r) => r.s === "pending").map((r) => r.d)))
        .filter((d) => !certain.includes(d)).sort();
      const parts: string[] = [];
      if (certain.length > 0) parts.push(`a route block was already filed for ${certain.join(", ")}`);
      if (maybe.length > 0) parts.push(`a filing for ${maybe.join(", ")} was started but its outcome was never recorded (it may exist upstream)`);
      priorFiledBlockWarning =
        `${parts.join("; ")}. Blocks cannot be canceled from here — ` +
        `ask the DCA to remove any the tech should not keep.`;
    }
  } catch { /* advisory only */ }

  // 1) The authoritative history row. When a filing will follow, stamp a
  //    durable route_block:{status:'pending'} marker NOW — if the outcome
  //    merge below ever fails, the row still says "something may have been
  //    filed" and future reschedules warn instead of silently double-filing.
  const willFile = date !== null && fileRouteBlock;
  const payload: Record<string, unknown> = {
    scheduled_date: date,
    origin: "vrm",
    route_block_requested: willFile,
    ...(willFile ? { route_block: { status: "pending" } } : {}),
  };
  const inserted = await db.execute(sql`
    INSERT INTO vrm_rental_operation_actions (case_key, case_id, action_type, mark_value, payload, actor)
    VALUES (${caseKey}, ${caseRow.id}, ${SCHEDULE_PICKUP_ACTION_TYPE}, ${date ?? "cleared"}, ${JSON.stringify(payload)}::jsonb, ${actor})
    RETURNING id
  `);
  const actionId = ((inserted as any).rows ?? [])[0]?.id;

  // 2) Mirror to fs_trucks (canonical zero-stripped number match, like
  //    appendFleetStatus). Plain UPDATE: no status side effects, lastUpdatedBy
  //    untouched so the adopt guard keeps seeing the true last STATUS writer.
  const vehicleNumber = String(caseRow.vehicle_number_padded ?? caseRow.vehicle_number ?? caseKey);
  let mirroredTruckId: string | null = null;
  let mirroredTruckNumber: string | null = null;
  try {
    const mirrorRes = await db.execute(sql`
      UPDATE fs_trucks
      SET scheduled_pickup_date = ${date}, last_updated_at = NOW()
      WHERE id = (
        SELECT id FROM fs_trucks
        WHERE COALESCE(NULLIF(LTRIM(truck_number, '0'), ''), '0') = COALESCE(NULLIF(LTRIM(${vehicleNumber}, '0'), ''), '0')
        ORDER BY last_updated_at DESC NULLS LAST
        LIMIT 1
      )
      RETURNING id, truck_number
    `);
    const truckRow = ((mirrorRes as any).rows ?? [])[0];
    if (truckRow) {
      mirroredTruckId = String(truckRow.id);
      mirroredTruckNumber = String(truckRow.truck_number);
    } else {
      console.warn(`[VRM/SchedulePickup] No fs_trucks row for case ${caseKey} (vehicle ${vehicleNumber}) — action recorded, mirror skipped`);
    }
  } catch (mirrorErr) {
    try {
      await db.execute(sql`DELETE FROM vrm_rental_operation_actions WHERE id = ${actionId}`);
    } catch (compErr) {
      console.error(`[VRM/SchedulePickup] fs_trucks mirror AND compensating delete failed for case ${caseKey} — history may lead fs_trucks until re-saved`, compErr);
    }
    throw mirrorErr;
  }

  // 3) File the route block (after the date is durably recorded), then
  //    replace the 'pending' marker with the real outcome. If the merge
  //    fails, the marker stays 'pending' — audibly incomplete, and the
  //    prior-filed scan above treats it as possibly-filed forever after.
  let routeBlock: RouteBlockOutcome | null = null;
  if (willFile) {
    routeBlock = await fileRouteBlockFor(caseKey, date!);
    try {
      await db.execute(sql`
        UPDATE vrm_rental_operation_actions
        SET payload = payload || ${JSON.stringify({ route_block: routeBlock })}::jsonb
        WHERE id = ${actionId}
      `);
    } catch (e: any) {
      console.error(
        `[VRM/SchedulePickup] could not attach route-block outcome to action ${actionId} — ` +
        `row keeps route_block.status='pending' (conservative reschedule warnings will fire):`,
        e?.message || e,
      );
    }
  }

  return {
    ok: true,
    caseKey,
    scheduledDate: date,
    mirroredTruckId,
    mirroredTruckNumber,
    routeBlock,
    priorFiledBlockWarning,
  };
}
