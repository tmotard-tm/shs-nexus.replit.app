/**
 * Fleet status ownership — VRM Rental Operations is the AUTHORITY for a rental
 * case's fleet status (the mainStatus/subStatus pair FleetScope used to edit).
 *
 * Direction of flow (Tyler, 2026-08-04): status updates originate in VRM and
 * flow one-way VRM → FleetScope. "Fleet Scope is the last of the updates, not
 * the beginning or the source." FleetScope keeps DISPLAYING status everywhere
 * (fleet page, dashboard, queue) but its edit surfaces are read-only; edits
 * happen here and are mirrored down to fs_trucks.
 *
 * Storage follows the workbook pattern exactly: append-only rows in
 * `vrm_rental_operation_actions` with action_type='fleet_status' (mark_value =
 * main status, payload.sub_status = sub status). Newest row per case wins; all
 * prior rows are history. No DDL.
 *
 * Vocabulary: the canonical MAIN_STATUSES / SUB_STATUSES from
 * shared/fleet-scope-schema.ts — one vocabulary across both apps, now owned
 * (validated + written) on the VRM side.
 *
 * Mirroring: appendFleetStatus() write-through-updates fs_trucks via
 * fleetScopeStorage.updateTruck(), which keeps the FS side effects working
 * (combined status recompute, mainStatusChangedAt stamp, fs_pmf_status_events
 * insert that feeds the queue's daysInStatus). lastUpdatedBy is stamped
 * 'VRM:<actor>' so FS audit trails show where the change came from.
 *
 * Reconciliation (seed + adopt), boot + lazy, NEVER on a timer (autoscale):
 *   - seed: open cases with no fleet_status action yet get one from the current
 *     fs_trucks value (actor 'seed:fleet-scope') so history starts complete.
 *   - adopt: FS *system automation* (fleet sync, van-picked-up, LUCA
 *     write-back) still writes fs_trucks directly. When fs_trucks disagrees
 *     with the latest VRM action and the last FS writer was NOT VRM, the FS
 *     value is adopted as a new action (actor 'system:fleet-scope') — system
 *     events are the one sanctioned FS→VRM flow. Human FS edits are locked out
 *     at the route level, so anything adopted here is automation by
 *     construction.
 *   - phone: a LOCKED VRM shop phone (vrm_holman_portal_hist.shop_phone_locked,
 *     Tyler's manual-verify flow) outranks the FS repairPhone and is mirrored
 *     onto fs_trucks for open cases. Unlocked scraped phones do NOT mirror —
 *     FS keeps its own scraper auto-populate for blanks.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { fleetScopeStorage } from "../../fleet-scope-storage";
import { MAIN_STATUSES, SUB_STATUSES } from "@shared/fleet-scope-schema";

export const FLEET_STATUS_ACTION_TYPE = "fleet_status";

export interface FleetStatusState {
  main_status: string;
  sub_status: string | null;
  actor: string | null;
  origin: string | null; // 'vrm' | 'seed' | 'adopted'
  updated_at: string | null;
}

function rowsOf(res: any): any[] {
  return (res?.rows ?? res ?? []) as any[];
}

const str = (v: unknown): string | null => {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
};

export function isMainStatus(v: unknown): v is string {
  return typeof v === "string" && (MAIN_STATUSES as readonly string[]).includes(v);
}

export function subStatusesFor(main: string): readonly string[] {
  return (SUB_STATUSES as Record<string, readonly string[]>)[main] ?? [];
}

/** Returns an error message, or null when the pair is valid. */
export function validateFleetStatus(main: unknown, sub: unknown): string | null {
  if (!isMainStatus(main)) {
    return `Invalid main status: ${JSON.stringify(main)}. Must be one of the canonical fleet statuses.`;
  }
  const subStr = str(sub);
  if (subStr !== null) {
    const allowed = subStatusesFor(main);
    if (!allowed.includes(subStr)) {
      return `Invalid sub status ${JSON.stringify(subStr)} for main status "${main}".`;
    }
  }
  return null;
}

function toState(r: any): FleetStatusState {
  const p = (r?.payload ?? {}) as Record<string, unknown>;
  return {
    main_status: String(r?.mark_value ?? ""),
    sub_status: str(p.sub_status),
    actor: str(r?.actor),
    origin: str(p.origin),
    updated_at: str(r?.created_at),
  };
}

/** Latest fleet_status per case. Pass caseKeys to scope; omit for all cases. */
export async function loadFleetStatusStates(caseKeys?: string[]): Promise<Map<string, FleetStatusState>> {
  const scoped = Array.isArray(caseKeys) && caseKeys.length > 0;
  // NOTE: one param per element (sql.join) — passing a JS array straight into
  // `= ANY(${...})` mis-serializes through the pg pool driver ("malformed
  // array literal").
  const res = scoped
    ? await db.execute(sql`
        SELECT DISTINCT ON (case_key) case_key, mark_value, payload, actor, created_at
        FROM vrm_rental_operation_actions
        WHERE action_type = ${FLEET_STATUS_ACTION_TYPE}
          AND case_key IN (${sql.join((caseKeys as string[]).map((k) => sql`${k}`), sql`, `)})
        ORDER BY case_key, created_at DESC, id DESC
      `)
    : await db.execute(sql`
        SELECT DISTINCT ON (case_key) case_key, mark_value, payload, actor, created_at
        FROM vrm_rental_operation_actions
        WHERE action_type = ${FLEET_STATUS_ACTION_TYPE}
        ORDER BY case_key, created_at DESC, id DESC
      `);
  const map = new Map<string, FleetStatusState>();
  for (const r of rowsOf(res)) map.set(String(r.case_key), toState(r));
  return map;
}

export interface AppendFleetStatusResult {
  ok: true;
  state: FleetStatusState;
  /** fs_trucks row that was mirror-updated; null when no matching truck exists. */
  mirroredTruckId: string | null;
  mirroredTruckNumber: string | null;
}

/**
 * Record a fleet-status change on a case (the authoritative write) and mirror
 * it down to fs_trucks. Throws on unknown case or invalid status pair.
 */
export async function appendFleetStatus(
  caseKey: string,
  mainStatus: string,
  subStatus: string | null,
  actor: string,
): Promise<AppendFleetStatusResult> {
  const validationError = validateFleetStatus(mainStatus, subStatus);
  if (validationError) {
    const err: any = new Error(validationError);
    err.statusCode = 400;
    throw err;
  }

  const caseRes = await db.execute(sql`
    SELECT id, case_key, vehicle_number, vehicle_number_padded
    FROM vrm_rental_operations_cases
    WHERE case_key = ${caseKey}
    LIMIT 1
  `);
  const caseRow = rowsOf(caseRes)[0];
  if (!caseRow) {
    const err: any = new Error(`Unknown case: ${caseKey}`);
    err.statusCode = 404;
    throw err;
  }

  const cleanSub = str(subStatus);
  const payload = { sub_status: cleanSub, origin: "vrm" };

  const inserted = await db.execute(sql`
    INSERT INTO vrm_rental_operation_actions (case_key, case_id, action_type, mark_value, payload, actor)
    VALUES (${caseKey}, ${caseRow.id}, ${FLEET_STATUS_ACTION_TYPE}, ${mainStatus}, ${JSON.stringify(payload)}::jsonb, ${actor})
    RETURNING id, case_key, mark_value, payload, actor, created_at
  `);
  const insertedRow = rowsOf(inserted)[0];
  const state = toState(insertedRow);

  // Mirror down to fs_trucks (write-through). Match on canonical (zero-stripped)
  // vehicle number — fs_trucks numbers are stored unpadded, case keys padded.
  const vehicleNumber = String(caseRow.vehicle_number_padded ?? caseRow.vehicle_number ?? caseKey);
  const truckRes = await db.execute(sql`
    SELECT id, truck_number FROM fs_trucks
    WHERE COALESCE(NULLIF(LTRIM(truck_number, '0'), ''), '0') = COALESCE(NULLIF(LTRIM(${vehicleNumber}, '0'), ''), '0')
    ORDER BY last_updated_at DESC NULLS LAST
    LIMIT 1
  `);
  const truckRow = rowsOf(truckRes)[0];
  let mirroredTruckId: string | null = null;
  let mirroredTruckNumber: string | null = null;
  if (truckRow) {
    // fleetScopeStorage.updateTruck keeps the FS side effects: combined status,
    // mainStatusChangedAt guard, fs_pmf_status_events (queue daysInStatus).
    // If the mirror fails, withdraw the just-appended action (compensating
    // delete) so authoritative history and fs_trucks cannot diverge silently.
    try {
      await fleetScopeStorage.updateTruck(String(truckRow.id), {
        mainStatus,
        subStatus: cleanSub,
        lastUpdatedBy: `VRM:${actor}`,
      } as any);
    } catch (mirrorErr) {
      try {
        await db.execute(sql`DELETE FROM vrm_rental_operation_actions WHERE id = ${insertedRow.id}`);
      } catch (compErr) {
        console.error(`[VRM/FleetStatus] fs_trucks mirror AND compensating delete failed for case ${caseKey} — history may lead fs_trucks until re-saved`, compErr);
      }
      throw mirrorErr;
    }
    mirroredTruckId = String(truckRow.id);
    mirroredTruckNumber = String(truckRow.truck_number);
  } else {
    console.warn(`[VRM/FleetStatus] No fs_trucks row for case ${caseKey} (vehicle ${vehicleNumber}) — action recorded, mirror skipped`);
  }

  return { ok: true, state, mirroredTruckId, mirroredTruckNumber };
}

export interface ReconcileResult {
  seeded: number;
  adopted: number;
  phonesMirrored: number;
}

/** Thrown when reconcile runs before the schemas it reads have been created. */
export class FleetStatusNotReadyError extends Error {}

const RECONCILE_REQUIRED_TABLES = [
  "public.fs_trucks",
  "public.vrm_rental_operations_cases",
  "public.vrm_rental_operation_actions",
];

/**
 * Seed + adopt + phone mirror. Idempotent; safe to run repeatedly. Called at
 * boot (after schema init) and lazily (throttled) from the VRM queue route —
 * never from a timer, because autoscale kills in-process schedulers.
 *
 * `opts.requiredTables` exists for tests to simulate the fresh-deploy boot
 * race (a required table not yet created by the concurrent schema init).
 */
export async function reconcileFleetStatuses(
  reason: string,
  opts?: { requiredTables?: string[] },
): Promise<ReconcileResult> {
  // Readiness guard: on a fresh deployment this can be reached while the
  // Fleet Scope schema init is still creating fs_trucks. Fail fast with a
  // typed error (callers treat it as retryable) instead of a confusing SQL
  // "relation does not exist" mid-transaction.
  for (const table of opts?.requiredTables ?? RECONCILE_REQUIRED_TABLES) {
    const reg = await db.execute(sql`SELECT to_regclass(${table}) AS reg`);
    const row = ((reg as any)?.rows ?? reg)?.[0];
    if (!row?.reg) {
      throw new FleetStatusNotReadyError(
        `fleet-status reconcile (${reason}) deferred — required table ${table} is not ready (schema init still running?)`,
      );
    }
  }
  // One transaction + advisory xact lock: the in-flight guard below is
  // process-local, but autoscale runs multiple instances — concurrent boot
  // reconciles would otherwise double-seed/double-adopt (both passing the
  // NOT EXISTS / IS DISTINCT FROM checks before either commits).
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('vrm-fleet-status-reconcile'))`);

    // 1) SEED: open cases with no fleet_status action yet → snapshot current
    //    fs_trucks status as the opening history row.
    const seedRes = await tx.execute(sql`
      INSERT INTO vrm_rental_operation_actions (case_key, case_id, action_type, mark_value, payload, actor)
      SELECT
        c.case_key,
        c.id,
        ${FLEET_STATUS_ACTION_TYPE},
        t.main_status,
        jsonb_build_object('sub_status', t.sub_status, 'origin', 'seed'),
        'seed:fleet-scope'
      FROM vrm_rental_operations_cases c
      JOIN LATERAL (
        SELECT ft.main_status, ft.sub_status
        FROM fs_trucks ft
        WHERE COALESCE(NULLIF(LTRIM(ft.truck_number, '0'), ''), '0') = COALESCE(NULLIF(LTRIM(c.vehicle_number_padded, '0'), ''), '0')
          AND ft.main_status IS NOT NULL
        ORDER BY ft.last_updated_at DESC NULLS LAST
        LIMIT 1
      ) t ON true
      WHERE c.present_in_latest = true
        AND NOT EXISTS (
          SELECT 1 FROM vrm_rental_operation_actions a
          WHERE a.case_key = c.case_key AND a.action_type = ${FLEET_STATUS_ACTION_TYPE}
        )
      RETURNING id
    `);
    const seeded = rowsOf(seedRes).length;

    // 2) ADOPT: fs_trucks changed by FS *system automation* since the latest VRM
    //    action → adopt the FS value as a new action. Guarded on the last FS
    //    writer NOT being VRM, so our own mirrors never echo back.
    const adoptRes = await tx.execute(sql`
      WITH latest AS (
        SELECT DISTINCT ON (case_key) case_key, mark_value, payload->>'sub_status' AS sub_status
        FROM vrm_rental_operation_actions
        WHERE action_type = ${FLEET_STATUS_ACTION_TYPE}
        ORDER BY case_key, created_at DESC, id DESC
      )
      INSERT INTO vrm_rental_operation_actions (case_key, case_id, action_type, mark_value, payload, actor)
      SELECT
        c.case_key,
        c.id,
        ${FLEET_STATUS_ACTION_TYPE},
        t.main_status,
        jsonb_build_object('sub_status', t.sub_status, 'origin', 'adopted', 'fs_last_updated_by', t.last_updated_by),
        'system:fleet-scope'
      FROM vrm_rental_operations_cases c
      JOIN latest l ON l.case_key = c.case_key
      JOIN LATERAL (
        SELECT ft.main_status, ft.sub_status, ft.last_updated_by
        FROM fs_trucks ft
        WHERE COALESCE(NULLIF(LTRIM(ft.truck_number, '0'), ''), '0') = COALESCE(NULLIF(LTRIM(c.vehicle_number_padded, '0'), ''), '0')
          AND ft.main_status IS NOT NULL
        ORDER BY ft.last_updated_at DESC NULLS LAST
        LIMIT 1
      ) t ON true
      WHERE c.present_in_latest = true
        AND COALESCE(t.last_updated_by, '') NOT LIKE 'VRM:%'
        AND (
          t.main_status IS DISTINCT FROM l.mark_value
          OR t.sub_status IS DISTINCT FROM l.sub_status
        )
      RETURNING id
    `);
    const adopted = rowsOf(adoptRes).length;

    // 3) PHONE: locked (human-verified) VRM shop phones outrank FS repairPhone.
    //    Plain UPDATE — no status side effects, and lastUpdatedBy is left alone
    //    so the adopt guard above keeps seeing the true last STATUS writer.
    const phoneRes = await tx.execute(sql`
      UPDATE fs_trucks ft
      SET repair_phone = h.shop_phone, last_updated_at = NOW()
      FROM vrm_holman_portal_hist h
      JOIN vrm_rental_operations_cases c
        ON c.case_key = h.truck_no AND c.present_in_latest = true
      WHERE h.shop_phone_locked = true
        AND NULLIF(BTRIM(h.shop_phone), '') IS NOT NULL
        AND COALESCE(NULLIF(LTRIM(ft.truck_number, '0'), ''), '0') = COALESCE(NULLIF(LTRIM(h.truck_no, '0'), ''), '0')
        AND ft.repair_phone IS DISTINCT FROM h.shop_phone
      RETURNING ft.id
    `);
    const phonesMirrored = rowsOf(phoneRes).length;
    return { seeded, adopted, phonesMirrored };
  }).then((counts) => {
    const { seeded, adopted, phonesMirrored } = counts;
    if (seeded || adopted || phonesMirrored) {
      console.log(`[VRM/FleetStatus] reconcile(${reason}): seeded=${seeded} adopted=${adopted} phonesMirrored=${phonesMirrored}`);
    }
    return counts;
  });
}

// Lazy throttle — the queue route calls this on every GET; only one reconcile
// per window actually runs. In-flight guard prevents overlapping runs.
let lastReconcileAt = 0;
let reconcileInFlight: Promise<ReconcileResult> | null = null;
const RECONCILE_MIN_INTERVAL_MS = 5 * 60 * 1000;

export async function maybeReconcileFleetStatuses(
  reason: string,
  opts?: { requiredTables?: string[] },
): Promise<ReconcileResult | null> {
  const now = Date.now();
  if (reconcileInFlight) return reconcileInFlight;
  if (now - lastReconcileAt < RECONCILE_MIN_INTERVAL_MS) return null;
  // Claim the window optimistically (concurrent callers skip while we run),
  // but give it back on failure: a reconcile that failed — e.g. fs_trucks not
  // yet created during a fresh-deploy boot race, or a transient DB drop —
  // must NOT consume the 5-minute throttle, or the first queue requests would
  // serve unseeded authority state with no retry until the window expires.
  lastReconcileAt = now;
  reconcileInFlight = reconcileFleetStatuses(reason, opts)
    .then((res) => {
      lastReconcileAt = Date.now();
      return res;
    })
    .catch((e) => {
      lastReconcileAt = 0;
      throw e;
    })
    .finally(() => {
      reconcileInFlight = null;
    });
  return reconcileInFlight;
}
