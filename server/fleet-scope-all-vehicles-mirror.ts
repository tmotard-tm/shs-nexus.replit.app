/**
 * Task #487 — All Vehicles roster mirror
 * ======================================
 * The FleetScope "All Vehicles" page (`GET /api/fs/all-vehicles`) used to read
 * four Snowflake roster tables LIVE on every request:
 *   1. REPLIT_ALL_VEHICLES  — the base row set (24 columns, ORDER BY VEHICLE_NUMBER)
 *   2. Holman_VEHICLES      — odometer/plate keyed by VIN
 *   3. Holman_VEHICLES      — STATUS keyed by HOLMAN_VEHICLE_NUMBER
 *   4. UNASSIGNED_VEHICLES  — membership (raw VEHICLE_NUMBER list)
 *   5. TPMS_EXTRACT         — technician name / number / phone
 *
 * Those tables only change overnight upstream, so reading them live per request
 * added latency and a Neon-WebSocket failure surface for zero freshness benefit.
 * This module copies them into ONE local Postgres table (`fs_all_vehicles_mirror`,
 * daily overwrite) and exposes a `readAllVehiclesMirror()` that reconstructs the
 * EXACT same in-memory inputs the handler's merge/derivation already consumes —
 * the calculations are unchanged, only the source of the four roster reads moves
 * from Snowflake to the mirror. Same pattern as VRM profitability snapshot.
 *
 * Fidelity notes:
 *  - The base `data` array is reconstructed in the exact SELECT column order and
 *    is NOT deduped, so `data.length` / counts stay byte-for-byte.
 *  - Holman STATUS is folded per base row by the fully-stripped vehicle key
 *    (the handler's multi-candidate lookup collapses every candidate to that key
 *    via `.replace(/^0+/,'')`, so this is identical to the live lookup).
 *  - Odometer is folded by base VIN (upper/trim); tech by normalizeFleetId key.
 *  - UNASSIGNED rows are stored as their own record kind, preserving the raw
 *    VEHICLE_NUMBER strings the handler pushes into `overlapVehicles`.
 *  - `*_LAST_UPDATE` timestamps are stored as-is in the base_row JSONB; the
 *    location winner is chosen by `new Date(str).getTime()` which is preserved.
 */
import { fsPool } from "./fleet-scope-db";
import { executeQuery } from "./fleet-scope-snowflake";
import { isSnowflakeConfigured } from "./snowflake-service";
import {
  tryAcquireSyncLockOn,
  releaseSyncLockOn,
} from "./fleetscope-snowflake-sync-lock";

// ── SQL (identical to the live reads that used to run inside the handler) ──────
const BASE_SQL = `
        SELECT 
          VEHICLE_NUMBER,
          VIN,
          MAKE_NAME,
          MODEL_NAME,
          TRUCK_STATUS,
          TRUCK_DISTRICT,
          TPMS_ASSIGNED,
          INTERIOR,
          INVENTORY_PRODUCT_CATEGORY,
          -- GPS location data
          GPS_LATITUDE,
          GPS_LONGITUDE,
          GPS_LAST_UPDATE,
          -- AMS location data
          AMS_ZIP_LAT,
          AMS_ZIP_LON,
          AMS_CUR_ADDRESS,
          AMS_CUR_CITY,
          AMS_CUR_STATE,
          AMS_LAST_UPDATE,
          -- TPMS location data
          LAST_TPMS_ZIP_LAT,
          LAST_TPMS_ZIP_LON,
          LAST_TPMS_ADDRESS,
          LAST_TPMS_CITY,
          LAST_TPMS_STATE,
          LAST_TPMS_LAST_UPDATE
        FROM PARTS_SUPPLYCHAIN.FLEET.REPLIT_ALL_VEHICLES
        ORDER BY VEHICLE_NUMBER
      `;

const HOLMAN_ODOMETER_SQL = `
          SELECT 
            VIN,
            ODOMETER,
            ODOMETER_DATE,
            LICENSE_PLATE
          FROM PARTS_SUPPLYCHAIN.FLEET.Holman_VEHICLES
          WHERE VIN IS NOT NULL AND ODOMETER IS NOT NULL
        `;

const HOLMAN_STATUS_SQL = `
          SELECT HOLMAN_VEHICLE_NUMBER, STATUS
          FROM PARTS_SUPPLYCHAIN.FLEET.Holman_VEHICLES
          WHERE HOLMAN_VEHICLE_NUMBER IS NOT NULL
        `;

const UNASSIGNED_SQL = `
          SELECT VEHICLE_NUMBER 
          FROM PARTS_SUPPLYCHAIN.FLEET.UNASSIGNED_VEHICLES
        `;

// Mirror-owned TPMS read (separate + additive — does NOT touch the existing
// getCachedTechnicianData() cache, per Task #487 guardrail #6). Only the three
// fields the All Vehicles handler actually consumes are needed.
const TECH_SQL = `
      SELECT TRUCK_LU, FULL_NAME, TECH_NO, MOBILEPHONENUMBER
      FROM PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT
    `;

// Exact SELECT column order — used to reconstruct each base row object so the
// returned `data` array's JSON key order matches the live result.
const BASE_COLS = [
  "VEHICLE_NUMBER", "VIN", "MAKE_NAME", "MODEL_NAME", "TRUCK_STATUS",
  "TRUCK_DISTRICT", "TPMS_ASSIGNED", "INTERIOR", "INVENTORY_PRODUCT_CATEGORY",
  "GPS_LATITUDE", "GPS_LONGITUDE", "GPS_LAST_UPDATE",
  "AMS_ZIP_LAT", "AMS_ZIP_LON", "AMS_CUR_ADDRESS", "AMS_CUR_CITY", "AMS_CUR_STATE", "AMS_LAST_UPDATE",
  "LAST_TPMS_ZIP_LAT", "LAST_TPMS_ZIP_LON", "LAST_TPMS_ADDRESS", "LAST_TPMS_CITY", "LAST_TPMS_STATE", "LAST_TPMS_LAST_UPDATE",
] as const;

// Abort the swap if the fresh base result is below this fraction of the current
// mirror size (catches a transient partial Snowflake read wiping the fleet).
const MIN_BASE_FRACTION = 0.5;
const INSERT_BATCH = 1000;

// ── Types the handler consumes ────────────────────────────────────────────────
export interface HolmanOdometerData {
  odometer: number | null;
  odometerDate: string | null;
  licensePlate: string | null;
}
export interface MirrorTechData {
  fullName: string;
  techNo: string;
  mobilePhone: string;
}
export interface AllVehiclesMirrorResult {
  source: "mirror" | "live";
  data: Array<Record<string, unknown>>;
  holmanOdometerByVin: Map<string, HolmanOdometerData>;
  holmanStatusByVehicle: Map<string, string>;
  technicianMap: Map<string, MirrorTechData>;
  unassignedVehicles: Array<{ VEHICLE_NUMBER: string }>;
}
export interface ReadMirrorOptions {
  // Used only on the first-boot empty-mirror fallback to match today's live
  // behavior exactly (the handler reads tech from getCachedTechnicianData()).
  getLiveTechnicianMap: () => Map<string, MirrorTechData>;
}

// ── Helpers (mirror the handler's normalization exactly) ──────────────────────
function normalizeFleetId(id: string): string {
  const digits = id.replace(/\D/g, "");
  return digits.replace(/^0+/, "") || "0";
}

function estDayStr(d: Date): string {
  // YYYY-MM-DD in America/New_York (matches the scheduler's EST day boundary).
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function isTransientDbDrop(error: any): boolean {
  const rawMsg: string = (error && (error.message || error?.reason?.message)) || "";
  return (
    error?.name === "ErrorEvent" ||
    error?.type === "error" ||
    rawMsg.includes("Cannot set property message") ||
    rawMsg.includes("terminating connection due to administrator command") ||
    rawMsg.includes("terminated connection") ||
    rawMsg.includes("Connection lost") ||
    rawMsg.includes("connection was closed") ||
    error?.code === "ECONNRESET"
  );
}

// ── Source-map builders (shared by refresh + live fallback) ───────────────────
function buildOdometerMap(rows: any[]): Map<string, HolmanOdometerData> {
  const map = new Map<string, HolmanOdometerData>();
  for (const row of rows) {
    if (row.VIN) {
      const vin = row.VIN.toString().trim().toUpperCase();
      map.set(vin, {
        odometer: row.ODOMETER || null,
        odometerDate: row.ODOMETER_DATE || null,
        licensePlate: row.LICENSE_PLATE?.toString().trim() || null,
      });
    }
  }
  return map;
}

function buildStatusMap(rows: any[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    if (!row.HOLMAN_VEHICLE_NUMBER || !row.STATUS) continue;
    const digits = row.HOLMAN_VEHICLE_NUMBER.toString().replace(/\D/g, "");
    const stripped = digits.replace(/^0+/, "") || "0";
    map.set(stripped, row.STATUS.toString().trim());
  }
  return map;
}

function buildTechMap(rows: any[]): Map<string, MirrorTechData> {
  const map = new Map<string, MirrorTechData>();
  for (const tech of rows) {
    if (tech.TRUCK_LU) {
      const key = normalizeFleetId(tech.TRUCK_LU.toString());
      map.set(key, {
        fullName: tech.FULL_NAME || "",
        techNo: tech.TECH_NO ? String(tech.TECH_NO) : "",
        mobilePhone: tech.MOBILEPHONENUMBER ? String(tech.MOBILEPHONENUMBER) : "",
      });
    }
  }
  return map;
}

// ── Snowflake read with a single in-job retry on transient connection drops ───
async function execWithRetry<T = any>(sql: string, tag: string): Promise<T[]> {
  try {
    return await executeQuery<T>(sql);
  } catch (err: any) {
    if (isTransientDbDrop(err)) {
      console.warn(`[AllVehiclesMirror] Transient drop on ${tag}, retrying once...`);
      return await executeQuery<T>(sql);
    }
    throw err;
  }
}

// ── Postgres read with a single in-job retry on transient WS drops ────────────
// The mirror lives in Neon Postgres, so even reading last-good data goes through
// the serverless WebSocket that occasionally drops (closeCode 1006). A single
// retry rides out a momentary blip so a cold-start read of persisted data does
// not surface as a 503. `exec` is injectable for tests.
type PgExec = (text: string, params: any[]) => Promise<{ rows: any[] }>;
const defaultPgExec: PgExec = (text, params) => fsPool.query(text, params);

export async function pgQueryWithRetry(
  text: string,
  params: any[] = [],
  tag = "pg",
  exec: PgExec = defaultPgExec,
): Promise<{ rows: any[] }> {
  try {
    return await exec(text, params);
  } catch (err: any) {
    if (isTransientDbDrop(err)) {
      console.warn(`[AllVehiclesMirror] Transient drop on ${tag} read — retrying once...`);
      return await exec(text, params);
    }
    throw err;
  }
}

// ── Persisted last-good response snapshot ─────────────────────────────────────
// The All Vehicles handler assembles a heavy payload (mirror rows + many Neon
// enrichment queries). We persist the most recent fully-assembled payload to a
// singleton Postgres row so that, after a process restart (in-memory cache gone)
// a transient Neon drop on the FIRST request can still serve last-good data
// instead of a blank 503. Same spirit as the VRM profitability snapshot.
const RESPONSE_SNAPSHOT_DDL = `
  CREATE TABLE IF NOT EXISTS fs_all_vehicles_response_snapshot (
    id smallint PRIMARY KEY DEFAULT 1,
    payload jsonb NOT NULL,
    built_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fs_all_vehicles_response_snapshot_singleton CHECK (id = 1)
  )`;

let responseSnapshotTableReady = false;
async function ensureResponseSnapshotTable(exec: PgExec = defaultPgExec): Promise<void> {
  if (responseSnapshotTableReady) return;
  await pgQueryWithRetry(RESPONSE_SNAPSHOT_DDL, [], "response-snapshot-ddl", exec);
  responseSnapshotTableReady = true;
}

export async function saveAllVehiclesResponseSnapshot(payload: unknown): Promise<void> {
  try {
    await ensureResponseSnapshotTable();
    await fsPool.query(
      `INSERT INTO fs_all_vehicles_response_snapshot (id, payload, built_at)
       VALUES (1, $1::jsonb, now())
       ON CONFLICT (id) DO UPDATE
         SET payload = EXCLUDED.payload, built_at = EXCLUDED.built_at`,
      [JSON.stringify(payload)],
    );
  } catch (err: any) {
    // Persisting the snapshot is best-effort — never let it break the request.
    console.warn("[AllVehiclesMirror] Failed to persist response snapshot (non-fatal):", err?.message);
  }
}

export async function readAllVehiclesResponseSnapshot(
  exec: PgExec = defaultPgExec,
): Promise<{ payload: any; builtAt: Date } | null> {
  await ensureResponseSnapshotTable(exec);
  const res = await pgQueryWithRetry(
    `SELECT payload, built_at FROM fs_all_vehicles_response_snapshot WHERE id = 1`,
    [],
    "response-snapshot",
    exec,
  );
  const row = res.rows[0];
  if (!row || row.payload == null) return null;
  return { payload: row.payload, builtAt: new Date(row.built_at) };
}

// ── Cold-start fallback selection (pure; unit-tested) ─────────────────────────
// Decides which last-good source the All Vehicles route should serve when its
// live assembly throws a transient Neon drop. Prefers the fresher in-memory
// cache, then the persisted snapshot, each gated by its own max age. Returns
// null when nothing acceptable is available (caller returns 503).
export function selectColdStartFallback(args: {
  isTransientDbDrop: boolean;
  now: number;
  inMemory: { timestamp: number } | null;
  inMemoryMaxAgeMs: number;
  persisted: { builtAt: number } | null;
  persistedMaxAgeMs: number;
}): { source: "memory" | "persisted"; staleAgeSec: number } | null {
  if (!args.isTransientDbDrop) return null;
  if (args.inMemory) {
    const ageMs = args.now - args.inMemory.timestamp;
    if (ageMs <= args.inMemoryMaxAgeMs) {
      return { source: "memory", staleAgeSec: Math.round(ageMs / 1000) };
    }
  }
  if (args.persisted) {
    const ageMs = args.now - args.persisted.builtAt;
    if (ageMs <= args.persistedMaxAgeMs) {
      return { source: "persisted", staleAgeSec: Math.round(ageMs / 1000) };
    }
  }
  return null;
}

// ── Mirror metadata (row count + freshness) ───────────────────────────────────
export async function getMirrorMeta(): Promise<{ baseCount: number; unassignedCount: number; maxSyncedAt: Date | null }> {
  const res = await fsPool.query(
    `SELECT
       COUNT(*) FILTER (WHERE record_kind = 'base')        AS base_count,
       COUNT(*) FILTER (WHERE record_kind = 'unassigned')  AS unassigned_count,
       MAX(synced_at)                                       AS max_synced_at
     FROM fs_all_vehicles_mirror`,
  );
  const row = res.rows[0] || {};
  return {
    baseCount: Number(row.base_count ?? 0),
    unassignedCount: Number(row.unassigned_count ?? 0),
    maxSyncedAt: row.max_synced_at ? new Date(row.max_synced_at) : null,
  };
}

// ── Read path: reconstruct the handler's inputs from the mirror ───────────────
export async function readAllVehiclesMirror(opts: ReadMirrorOptions): Promise<AllVehiclesMirrorResult> {
  const baseRes = await fsPool.query(
    `SELECT base_row, holman_odometer, holman_status, tech_name, tech_no, tech_phone, vehicle_number_key
     FROM fs_all_vehicles_mirror
     WHERE record_kind = 'base'
     ORDER BY seq`,
  );

  if (baseRes.rows.length === 0) {
    // First boot / empty mirror — fall back ONCE to today's live aggregation to
    // keep the page serving, then kick a background refresh to populate it.
    console.warn("[AllVehiclesMirror] Mirror empty — serving live fallback and triggering background refresh");
    void runMirrorRefreshIfNeeded("empty-read-fallback");
    return await liveAggregation(opts);
  }

  const data: Array<Record<string, unknown>> = [];
  const holmanOdometerByVin = new Map<string, HolmanOdometerData>();
  const holmanStatusByVehicle = new Map<string, string>();
  const technicianMap = new Map<string, MirrorTechData>();

  for (const m of baseRes.rows) {
    const br = (m.base_row || {}) as Record<string, unknown>;
    // Reconstruct in exact SELECT key order so the JSON output matches live.
    const ordered: Record<string, unknown> = {};
    for (const c of BASE_COLS) ordered[c] = br[c] ?? null;
    data.push(ordered);

    const vin = (br.VIN != null ? String(br.VIN) : "").trim().toUpperCase();
    if (m.holman_odometer != null && vin) {
      holmanOdometerByVin.set(vin, m.holman_odometer as HolmanOdometerData);
    }

    const rawDigits = (br.VEHICLE_NUMBER != null ? String(br.VEHICLE_NUMBER) : "").trim().replace(/\D/g, "");
    const strippedKey = rawDigits.replace(/^0+/, "") || "0";
    if (m.holman_status != null) {
      holmanStatusByVehicle.set(strippedKey, m.holman_status as string);
    }

    if (m.tech_name != null || m.tech_no != null || m.tech_phone != null) {
      technicianMap.set(m.vehicle_number_key as string, {
        fullName: (m.tech_name as string) || "",
        techNo: (m.tech_no as string) || "",
        mobilePhone: (m.tech_phone as string) || "",
      });
    }
  }

  const unassignedRes = await fsPool.query(
    `SELECT unassigned_vehicle_number
     FROM fs_all_vehicles_mirror
     WHERE record_kind = 'unassigned'
     ORDER BY seq`,
  );
  const unassignedVehicles = unassignedRes.rows.map((r) => ({
    VEHICLE_NUMBER: (r.unassigned_vehicle_number ?? "") as string,
  }));

  return {
    source: "mirror",
    data,
    holmanOdometerByVin,
    holmanStatusByVehicle,
    technicianMap,
    unassignedVehicles,
  };
}

// ── Live aggregation (byte-for-byte today's behavior — only on empty mirror) ──
async function liveAggregation(opts: ReadMirrorOptions): Promise<AllVehiclesMirrorResult> {
  const data = await executeQuery<Record<string, unknown>>(BASE_SQL);

  let holmanOdometerByVin = new Map<string, HolmanOdometerData>();
  try {
    holmanOdometerByVin = buildOdometerMap(await executeQuery(HOLMAN_ODOMETER_SQL));
  } catch (err: any) {
    console.error("[AllVehiclesMirror] live fallback Holman odometer error:", err?.message);
  }

  let holmanStatusByVehicle = new Map<string, string>();
  try {
    holmanStatusByVehicle = buildStatusMap(await executeQuery(HOLMAN_STATUS_SQL));
  } catch (err: any) {
    console.error("[AllVehiclesMirror] live fallback Holman STATUS error:", err?.message);
  }

  let unassignedVehicles: Array<{ VEHICLE_NUMBER: string }> = [];
  try {
    unassignedVehicles = await executeQuery<{ VEHICLE_NUMBER: string }>(UNASSIGNED_SQL);
  } catch (err: any) {
    console.error("[AllVehiclesMirror] live fallback UNASSIGNED error:", err?.message);
  }

  return {
    source: "live",
    data,
    holmanOdometerByVin,
    holmanStatusByVehicle,
    technicianMap: opts.getLiveTechnicianMap(),
    unassignedVehicles,
  };
}

// ── Refresh: rebuild the mirror under a cross-instance advisory lock ───────────
export interface RefreshResult {
  ok: boolean;
  reason?: string;
  baseCount?: number;
  unassignedCount?: number;
  durationMs?: number;
}

export async function refreshAllVehiclesMirror(trigger: string): Promise<RefreshResult> {
  if (!isSnowflakeConfigured()) {
    return { ok: false, reason: "snowflake-not-configured" };
  }
  const started = Date.now();
  const client = await fsPool.connect();
  let locked = false;
  try {
    locked = await tryAcquireSyncLockOn(client);
    if (!locked) {
      console.log(`[AllVehiclesMirror] Refresh (${trigger}) skipped — advisory lock held by another refresh`);
      return { ok: false, reason: "lock-held" };
    }

    // All four roster sources are REQUIRED. If any sub-source fails we abort the
    // whole swap and keep the last-good mirror, rather than blanking a column for
    // the entire fleet (Task #487 partial-failure handling).
    const baseRows = await execWithRetry<Record<string, unknown>>(BASE_SQL, "REPLIT_ALL_VEHICLES");
    const odoRows = await execWithRetry(HOLMAN_ODOMETER_SQL, "Holman odometer");
    const statusRows = await execWithRetry(HOLMAN_STATUS_SQL, "Holman STATUS");
    const unassignedRows = await execWithRetry<{ VEHICLE_NUMBER: unknown }>(UNASSIGNED_SQL, "UNASSIGNED_VEHICLES");
    const techRows = await execWithRetry(TECH_SQL, "TPMS_EXTRACT");

    const odoByVin = buildOdometerMap(odoRows);
    const statusByStripped = buildStatusMap(statusRows);
    const techByKey = buildTechMap(techRows);

    // Row-count sanity guard — never wipe the fleet on an empty/implausible read.
    const newBaseCount = baseRows.length;
    if (newBaseCount === 0) {
      console.warn(`[AllVehiclesMirror] Refresh (${trigger}) aborted — base result empty, keeping last-good`);
      return { ok: false, reason: "empty-base" };
    }
    const current = await getMirrorMeta();
    if (current.baseCount > 0 && newBaseCount < current.baseCount * MIN_BASE_FRACTION) {
      console.warn(
        `[AllVehiclesMirror] Refresh (${trigger}) aborted — base result ${newBaseCount} < ` +
          `${Math.round(MIN_BASE_FRACTION * 100)}% of current ${current.baseCount}, keeping last-good`,
      );
      return { ok: false, reason: "suspect-shrink" };
    }

    // Fold the per-vehicle joins at write time.
    const rows: any[] = [];
    let baseSeq = 0;
    for (const br of baseRows) {
      const rawVeh = (br.VEHICLE_NUMBER != null ? String(br.VEHICLE_NUMBER) : "").trim();
      const key = normalizeFleetId(rawVeh);
      const vin = (br.VIN != null ? String(br.VIN) : "").trim().toUpperCase();
      const rawDigits = rawVeh.replace(/\D/g, "");
      const strippedKey = rawDigits.replace(/^0+/, "") || "0";

      const odo = vin ? odoByVin.get(vin) ?? null : null;
      const status = statusByStripped.get(strippedKey) ?? null;
      const tech = techByKey.get(key);

      rows.push({
        record_kind: "base",
        seq: baseSeq++,
        vehicle_number_key: key,
        base_row: br,
        holman_odometer: odo,
        holman_status: status,
        tech_name: tech ? tech.fullName : null,
        tech_no: tech ? tech.techNo : null,
        tech_phone: tech ? tech.mobilePhone : null,
        unassigned_vehicle_number: null,
      });
    }

    let unSeq = 0;
    for (const ur of unassignedRows) {
      const raw = ur.VEHICLE_NUMBER != null ? String(ur.VEHICLE_NUMBER) : "";
      rows.push({
        record_kind: "unassigned",
        seq: unSeq++,
        vehicle_number_key: normalizeFleetId(raw),
        base_row: null,
        holman_odometer: null,
        holman_status: null,
        tech_name: null,
        tech_no: null,
        tech_phone: null,
        unassigned_vehicle_number: raw,
      });
    }

    await writeMirror(client, rows);

    const durationMs = Date.now() - started;
    console.log(
      `[AllVehiclesMirror] Refresh (${trigger}) OK — ${newBaseCount} base rows, ` +
        `${unSeq} unassigned, ${durationMs}ms`,
    );
    return { ok: true, baseCount: newBaseCount, unassignedCount: unSeq, durationMs };
  } catch (err: any) {
    console.error(`[AllVehiclesMirror] Refresh (${trigger}) failed — keeping last-good:`, err?.message || err);
    return { ok: false, reason: "error" };
  } finally {
    if (locked) {
      await releaseSyncLockOn(client);
    }
    client.release();
  }
}

// TRUNCATE + bulk INSERT in one transaction (atomic swap). Uses
// jsonb_to_recordset (not unnest of parallel arrays — that path fails on the
// Neon serverless driver with "cannot cast type record to text[]").
async function writeMirror(client: any, rows: any[]): Promise<void> {
  let attempt = 0;
  // One in-job retry on a transient Neon WS drop during the write.
  while (true) {
    try {
      await client.query("BEGIN");
      await client.query("TRUNCATE fs_all_vehicles_mirror");
      for (let i = 0; i < rows.length; i += INSERT_BATCH) {
        const batch = rows.slice(i, i + INSERT_BATCH);
        await client.query(
          `INSERT INTO fs_all_vehicles_mirror
             (record_kind, seq, vehicle_number_key, base_row, holman_odometer,
              holman_status, tech_name, tech_no, tech_phone, unassigned_vehicle_number, synced_at)
           SELECT x.record_kind, x.seq, x.vehicle_number_key, x.base_row, x.holman_odometer,
                  x.holman_status, x.tech_name, x.tech_no, x.tech_phone, x.unassigned_vehicle_number, now()
           FROM jsonb_to_recordset($1::jsonb) AS x(
             record_kind text, seq int, vehicle_number_key text,
             base_row jsonb, holman_odometer jsonb, holman_status text,
             tech_name text, tech_no text, tech_phone text, unassigned_vehicle_number text
           )`,
          [JSON.stringify(batch)],
        );
      }
      await client.query("COMMIT");
      return;
    } catch (err: any) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* connection may be gone */
      }
      if (attempt === 0 && isTransientDbDrop(err)) {
        attempt++;
        console.warn("[AllVehiclesMirror] Transient drop during write, retrying once...");
        continue;
      }
      throw err;
    }
  }
}

// ── Conditional refresh used by the scheduler / startup catch-up ───────────────
export async function runMirrorRefreshIfNeeded(trigger: string): Promise<void> {
  try {
    if (!isSnowflakeConfigured()) return;
    const meta = await getMirrorMeta();
    const isEmpty = meta.baseCount === 0;
    const ranToday = !!meta.maxSyncedAt && estDayStr(meta.maxSyncedAt) === estDayStr(new Date());
    if (ranToday && !isEmpty) {
      console.log(`[AllVehiclesMirror] Refresh (${trigger}) skipped — already refreshed today (${meta.baseCount} rows)`);
      return;
    }

    const result = await refreshAllVehiclesMirror(trigger);
    if (!result.ok && result.reason === "lock-held") {
      // Another instance/refresh holds the lock — try again shortly.
      setTimeout(() => {
        runMirrorRefreshIfNeeded(`${trigger}-retry`).catch((e: any) =>
          console.error("[AllVehiclesMirror] reschedule error:", e?.message),
        );
      }, 5 * 60 * 1000);
    }
  } catch (err: any) {
    console.error(`[AllVehiclesMirror] runMirrorRefreshIfNeeded (${trigger}) error (non-fatal):`, err?.message || err);
  }
}
