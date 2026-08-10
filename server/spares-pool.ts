// ---------------------------------------------------------------------------
// Nexus-local "unassigned vehicles" pool for the Spares module.
//
// Replaces the stale Snowflake PARTS_SUPPLYCHAIN.FLEET.UNASSIGNED_VEHICLES
// table as the membership source. The pool is derived from Nexus's own Fleet
// Management assignment status, which reflects Nexus-side assign/unassign
// operations immediately (write-through to tpms_tech_profiles), while the
// Snowflake table can lag by days.
//
// Derivation (belt-and-suspenders — BOTH conditions required):
//   unassigned = active holman_vehicles_cache row (isActive AND statusCode=1)
//                AND empty tpmsAssignedTechId
//                AND canonical truck number NOT IN the occupied set from
//                    tpms_tech_profiles.truck_no
// The cross-check against tpms_tech_profiles is REQUIRED, not optional:
// fleet-operations-service never writes tpmsAssignedTechId, and
// updateCacheTPMSAssignments never CLEARS it, so the cache column alone can
// claim a truck is assigned/unassigned when it is not. tpms_tech_profiles is
// refreshed by the 7:30 AM live per-tech TPMS sweep and by Nexus
// assign/unassign write-through, so it is the fresher "occupied" signal.
//
// BYOV trucks (raw prefix '88' — checked BEFORE zero-padding) are excluded:
// personal vehicles must never appear as spares.
//
// Safety guards: if the local data looks broken (empty cache, empty occupied
// set, empty pool, or a pool so large it implies the assignment data is
// missing), we fall back to the legacy Snowflake query rather than render a
// wrong Spares page. NEVER uses TPMS_EXTRACT_LAST_ASSIGNED (ghost assignments).
// ---------------------------------------------------------------------------

import { db } from "./db";
import { holmanVehiclesCache, tpmsTechProfiles } from "@shared/schema";
import { and, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { executeQuery } from "./fleet-scope-snowflake";
import { pgQueryWithRetry } from "./fleet-scope-all-vehicles-mirror";
import { AmsApiService, batchFetchAmsCurrentLocation } from "./ams-api-service";
import { getAmsTruckStatusMap } from "./ams-truck-status-cache";
import { getZipCoordinates } from "./fleet-scope-distance-calculator";

// Matches the row shape previously returned by UNASSIGNED_VEHICLES so the
// existing merge/scoring pipelines keep working unchanged.
export type UnassignedVehicleRow = {
  VEHICLE_NUMBER: string; // zero-padded to 6, matching legacy display format
  VIN: string;
  MAKE_NAME: string;
  MODEL_NAME: string;
  TRUCK_DISTRICT: string;
  TRUCK_STATUS: string;
  INTERIOR: string | null;
  ODOMETER: number | null;
  AMS_CUR_ADDRESS: string;
  AMS_CUR_CITY: string;
  AMS_CUR_STATE: string;
  AMS_CUR_ZIP: string;
  AMS_ZIP_LAT: number | null;
  AMS_ZIP_LON: number | null;
};

export type UnassignedPoolResult = {
  vehicles: UnassignedVehicleRow[];
  source: "nexus" | "snowflake_fallback";
  fallbackReason?: string;
  activeFleetCount: number;
  occupiedCount: number;
};

// Pool larger than this fraction of the active fleet implies broken
// assignment data (the dangerous overcount direction) → fall back.
const MAX_POOL_RATIO = 0.4;

// Mirrors ALLOWED_DIVISIONS in holman-vehicle-sync-service.ts.
const ALLOWED_DIVISIONS = ["01", "RF"];

const amsService = new AmsApiService();

export function canonicalTruckNumber(n: string | null | undefined): string {
  const s = (n ?? "").toString().trim();
  return s.replace(/^0+/, "") || (s ? "0" : "");
}

function isByovNumber(raw: string): boolean {
  // BYOV prefix check happens on the RAW/trimmed number, before any padding
  // (zero-padding first breaks 5-digit BYOV trucks: 88144 → 088144).
  return canonicalTruckNumber(raw).startsWith("88");
}

/**
 * Canonicalized set of truck numbers currently occupied per
 * tpms_tech_profiles.truck_no (non-empty values, leading zeros stripped).
 */
export async function getOccupiedTruckSet(): Promise<Set<string>> {
  const rows = await db
    .select({ truckNo: tpmsTechProfiles.truckNo })
    .from(tpmsTechProfiles)
    .where(and(isNotNull(tpmsTechProfiles.truckNo), ne(tpmsTechProfiles.truckNo, "")));
  const occupied = new Set<string>();
  for (const r of rows) {
    const canon = canonicalTruckNumber(r.truckNo);
    if (canon) occupied.add(canon);
  }
  return occupied;
}

/**
 * Local (Nexus) replacement for the TPMS_EXTRACT assignment check used by the
 * Spares "Add Truck" dialog. Looks the truck up in tpms_tech_profiles.
 */
export async function checkTruckAssignedNexus(truckNumber: string): Promise<{
  isAssigned: boolean;
  techName?: string;
  techNo?: string;
}> {
  const canon = canonicalTruckNumber(truckNumber);
  if (!canon) return { isAssigned: false };
  const rows = await db
    .select({
      firstName: tpmsTechProfiles.firstName,
      lastName: tpmsTechProfiles.lastName,
      techId: tpmsTechProfiles.techId,
    })
    .from(tpmsTechProfiles)
    .where(
      sql`COALESCE(NULLIF(LTRIM(${tpmsTechProfiles.truckNo}, '0'), ''), '0') = ${canon}`,
    )
    .limit(1);
  if (rows.length === 0) return { isAssigned: false };
  const techName =
    `${rows[0].firstName || ""} ${rows[0].lastName || ""}`.trim() || "Unknown";
  return { isAssigned: true, techName, techNo: rows[0].techId || "" };
}

type ActiveCacheRow = {
  holmanVehicleNumber: string;
  vin: string | null;
  makeName: string | null;
  modelName: string | null;
  district: string | null;
  odometer: number | null;
  tpmsAssignedTechId: string | null;
};

async function fetchActiveCacheRows(): Promise<ActiveCacheRow[]> {
  return db
    .select({
      holmanVehicleNumber: holmanVehiclesCache.holmanVehicleNumber,
      vin: holmanVehiclesCache.vin,
      makeName: holmanVehiclesCache.makeName,
      modelName: holmanVehiclesCache.modelName,
      district: holmanVehiclesCache.district,
      odometer: holmanVehiclesCache.odometer,
      tpmsAssignedTechId: holmanVehiclesCache.tpmsAssignedTechId,
    })
    .from(holmanVehiclesCache)
    .where(
      and(
        eq(holmanVehiclesCache.isActive, true),
        eq(holmanVehiclesCache.statusCode, 1),
        // Same "active fleet" definition Fleet Management uses everywhere else.
        inArray(holmanVehiclesCache.division, ALLOWED_DIVISIONS),
      ),
    );
}

// IMPORTANT: holman_vehicles_cache.interior is NOT usable for rack matching —
// the Holman feed never supplies it, so the sync defaults nearly every row to
// 'Standard'. The real vocabulary ('UTILITY WITH REF RACKS' /
// 'UTILITY WITHOUT REF RACKS' / ...) lives locally only in the daily
// fs_all_vehicles_mirror (base_row->>'INTERIOR', mirrored from
// REPLIT_ALL_VEHICLES). Keyed by canonical (zero-stripped) truck number.
async function fetchMirrorInteriorMap(): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  const res = await pgQueryWithRetry(
    `SELECT vehicle_number_key, base_row->>'INTERIOR' AS interior
     FROM fs_all_vehicles_mirror
     WHERE record_kind = 'base'`,
  );
  for (const row of res.rows) {
    const key = (row.vehicle_number_key as string | null) || "";
    if (key) map.set(key, (row.interior as string | null) ?? null);
  }
  return map;
}

/** Legacy Snowflake pool, used only when the Nexus derivation fails a guard. */
async function fetchSnowflakeFallbackPool(): Promise<UnassignedVehicleRow[]> {
  const rows = await executeQuery<{
    VEHICLE_NUMBER: string;
    VIN: string;
    MAKE_NAME: string;
    MODEL_NAME: string;
    TRUCK_DISTRICT: string;
    TRUCK_STATUS: string;
    AMS_CUR_ADDRESS: string;
    AMS_CUR_CITY: string;
    AMS_CUR_STATE: string;
    AMS_CUR_ZIP: string;
    AMS_ZIP_LAT: number | null;
    AMS_ZIP_LON: number | null;
  }>(`
    SELECT
      VEHICLE_NUMBER, VIN, MAKE_NAME, MODEL_NAME, TRUCK_DISTRICT, TRUCK_STATUS,
      AMS_CUR_ADDRESS, AMS_CUR_CITY, AMS_CUR_STATE, AMS_CUR_ZIP,
      AMS_ZIP_LAT, AMS_ZIP_LON
    FROM PARTS_SUPPLYCHAIN.FLEET.UNASSIGNED_VEHICLES
    ORDER BY VEHICLE_NUMBER
  `);

  // Best-effort enrichment: INTERIOR from the all-vehicles mirror (the only
  // local source with real rack vocabulary), ODOMETER from the Holman cache.
  let mirrorInterior = new Map<string, string | null>();
  try {
    mirrorInterior = await fetchMirrorInteriorMap();
  } catch {
    /* Non-fatal */
  }
  const odoByCanon = new Map<string, number | null>();
  try {
    const cacheRows = await fetchActiveCacheRows();
    for (const r of cacheRows) {
      odoByCanon.set(canonicalTruckNumber(r.holmanVehicleNumber), r.odometer);
    }
  } catch {
    /* Non-fatal */
  }

  return rows.map((r) => {
    const canon = canonicalTruckNumber(r.VEHICLE_NUMBER);
    return {
      VEHICLE_NUMBER: String(r.VEHICLE_NUMBER ?? "").trim(),
      VIN: r.VIN || "",
      MAKE_NAME: r.MAKE_NAME || "",
      MODEL_NAME: r.MODEL_NAME || "",
      TRUCK_DISTRICT: r.TRUCK_DISTRICT || "",
      TRUCK_STATUS: r.TRUCK_STATUS || "",
      INTERIOR: mirrorInterior.get(canon) ?? null,
      ODOMETER: odoByCanon.get(canon) ?? null,
      AMS_CUR_ADDRESS: r.AMS_CUR_ADDRESS || "",
      AMS_CUR_CITY: r.AMS_CUR_CITY || "",
      AMS_CUR_STATE: r.AMS_CUR_STATE || "",
      AMS_CUR_ZIP: r.AMS_CUR_ZIP || "",
      AMS_ZIP_LAT: r.AMS_ZIP_LAT != null ? Number(r.AMS_ZIP_LAT) : null,
      AMS_ZIP_LON: r.AMS_ZIP_LON != null ? Number(r.AMS_ZIP_LON) : null,
    };
  });
}

/**
 * The Nexus-derived unassigned-vehicle pool (with legacy Snowflake fallback
 * behind sanity guards). Enriched with AMS current location (city/state/zip
 * from the hourly full-fleet cache), AMS truck status (VIN-keyed cache), and
 * ZIP-level lat/lon for proximity scoring.
 */
export async function getNexusUnassignedVehicles(): Promise<UnassignedPoolResult> {
  let activeRows: ActiveCacheRow[] = [];
  let occupied = new Set<string>();
  let localReadError: string | null = null;

  try {
    [activeRows, occupied] = await Promise.all([
      fetchActiveCacheRows(),
      getOccupiedTruckSet(),
    ]);
  } catch (err: any) {
    localReadError = err?.message || String(err);
  }

  const fallback = async (reason: string): Promise<UnassignedPoolResult> => {
    console.warn(
      `[SparesPool] Falling back to Snowflake UNASSIGNED_VEHICLES — ${reason}`,
    );
    const vehicles = await fetchSnowflakeFallbackPool();
    console.log(
      `[SparesPool] Snowflake fallback pool: ${vehicles.length} vehicles`,
    );
    return {
      vehicles,
      source: "snowflake_fallback",
      fallbackReason: reason,
      activeFleetCount: activeRows.length,
      occupiedCount: occupied.size,
    };
  };

  if (localReadError) return fallback(`local read failed: ${localReadError}`);
  if (activeRows.length === 0) return fallback("holman_vehicles_cache has no active rows");
  if (occupied.size === 0) return fallback("tpms_tech_profiles occupied set is empty");

  const pool = activeRows.filter((r) => {
    const canon = canonicalTruckNumber(r.holmanVehicleNumber);
    if (!canon) return false;
    if (isByovNumber(r.holmanVehicleNumber)) return false;
    const cacheSaysAssigned = !!(r.tpmsAssignedTechId || "").trim();
    return !cacheSaysAssigned && !occupied.has(canon);
  });

  if (pool.length === 0) return fallback("derived pool is empty");
  if (pool.length > activeRows.length * MAX_POOL_RATIO) {
    return fallback(
      `derived pool (${pool.length}) exceeds ${Math.round(MAX_POOL_RATIO * 100)}% of active fleet (${activeRows.length}) — assignment data looks incomplete`,
    );
  }

  console.log(
    `[SparesPool] Nexus pool: ${pool.length} unassigned of ${activeRows.length} active (occupied set: ${occupied.size})`,
  );

  // --- Enrichment (all best-effort / non-fatal) ---

  // Real INTERIOR (rack) values come from the all-vehicles mirror — the
  // holman_vehicles_cache.interior column is a sync-side 'Standard' default
  // and must not be used for rack matching.
  let mirrorInterior = new Map<string, string | null>();
  try {
    mirrorInterior = await fetchMirrorInteriorMap();
    if (mirrorInterior.size === 0) {
      console.warn(
        "[SparesPool] fs_all_vehicles_mirror is empty — INTERIOR will be null for all pool rows (rack-filtered consumers may under-match)",
      );
    }
  } catch (err: any) {
    console.warn(`[SparesPool] Mirror INTERIOR lookup unavailable: ${err?.message}`);
  }

  // AMS truck status is keyed by VIN.
  let statusByVin: Record<string, string | null> = {};
  try {
    statusByVin = await getAmsTruckStatusMap();
  } catch (err: any) {
    console.warn(`[SparesPool] AMS truck-status map unavailable: ${err?.message}`);
  }

  // AMS current location (city/state/zip) from the hourly full-fleet cache;
  // keyed by the truckNumber we pass in.
  let curLocMap = new Map<string, { city: string; state: string; zip: string }>();
  try {
    curLocMap = await batchFetchAmsCurrentLocation(
      pool.map((r) => ({ truckNumber: r.holmanVehicleNumber, vin: r.vin })),
      amsService,
    );
  } catch (err: any) {
    console.warn(`[SparesPool] AMS current-location cache unavailable: ${err?.message}`);
  }

  // ZIP → lat/lon (geocoder caches per-zip after first call).
  const uniqueZips = new Set<string>();
  for (const r of pool) {
    const zip = curLocMap.get(r.holmanVehicleNumber)?.zip?.trim();
    if (zip && /^\d{5}/.test(zip)) uniqueZips.add(zip.slice(0, 5));
  }
  const zipCoords = new Map<string, { lat: number; lng: number }>();
  await Promise.all(
    Array.from(uniqueZips).map(async (zip) => {
      try {
        const coords = await getZipCoordinates(zip);
        if (coords) zipCoords.set(zip, coords);
      } catch {
        /* Non-fatal */
      }
    }),
  );

  const vehicles: UnassignedVehicleRow[] = pool
    .map((r) => {
      const canon = canonicalTruckNumber(r.holmanVehicleNumber);
      const loc = curLocMap.get(r.holmanVehicleNumber);
      const zip5 = loc?.zip?.trim().slice(0, 5) || "";
      const coords = zip5 ? zipCoords.get(zip5) : undefined;
      return {
        VEHICLE_NUMBER: canon.padStart(6, "0"),
        VIN: r.vin || "",
        MAKE_NAME: r.makeName || "",
        MODEL_NAME: r.modelName || "",
        TRUCK_DISTRICT: r.district || "",
        TRUCK_STATUS: (r.vin && statusByVin[r.vin.toUpperCase()]) || statusByVin[r.vin || ""] || "",
        INTERIOR: mirrorInterior.get(canon) ?? null,
        ODOMETER: r.odometer ?? null,
        AMS_CUR_ADDRESS: "", // full-fleet cache exposes city/state/zip only
        AMS_CUR_CITY: loc?.city || "",
        AMS_CUR_STATE: loc?.state || "",
        AMS_CUR_ZIP: loc?.zip || "",
        AMS_ZIP_LAT: coords?.lat ?? null,
        AMS_ZIP_LON: coords?.lng ?? null,
      };
    })
    .sort((a, b) => a.VEHICLE_NUMBER.localeCompare(b.VEHICLE_NUMBER));

  return {
    vehicles,
    source: "nexus",
    activeFleetCount: activeRows.length,
    occupiedCount: occupied.size,
  };
}

// ---------------------------------------------------------------------------
// Lite pool — for non-blocking decorations (Today's Queue "needs replacement")
// ---------------------------------------------------------------------------

export type SparePoolLite = {
  /** Canonical (zero-stripped) truck numbers with their Holman district. */
  vehicles: Array<{ truckNumber: string; district: string }>;
  activeFleetCount: number;
  occupiedCount: number;
};

/**
 * Cheap PG-only view of the unassigned pool for decorations that must never
 * stall (the Today's Queue build races this against a short timeout). Same
 * derivation + sanity guards as getNexusUnassignedVehicles, but NO Snowflake
 * fallback and NO AMS/mirror/zip enrichment: any guard failure returns null
 * and the caller renders "lookup unavailable" — an absent decoration, never a
 * false "0 spares" claim and never a queue-blocking wait.
 */
export async function getSparePoolLite(): Promise<SparePoolLite | null> {
  try {
    const [activeRows, occupied] = await Promise.all([
      fetchActiveCacheRows(),
      getOccupiedTruckSet(),
    ]);
    if (activeRows.length === 0 || occupied.size === 0) return null;
    const pool = activeRows.filter((r) => {
      const canon = canonicalTruckNumber(r.holmanVehicleNumber);
      if (!canon) return false;
      if (isByovNumber(r.holmanVehicleNumber)) return false;
      const cacheSaysAssigned = !!(r.tpmsAssignedTechId || "").trim();
      return !cacheSaysAssigned && !occupied.has(canon);
    });
    // Same guards as the full pool: an empty or implausibly large pool means
    // the assignment data is broken — report "unavailable", not a wrong count.
    if (pool.length === 0) return null;
    if (pool.length > activeRows.length * MAX_POOL_RATIO) return null;
    return {
      vehicles: pool
        .map((r) => ({
          truckNumber: canonicalTruckNumber(r.holmanVehicleNumber),
          district: (r.district || "").trim(),
        }))
        .sort((a, b) => a.truckNumber.localeCompare(b.truckNumber, undefined, { numeric: true })),
      activeFleetCount: activeRows.length,
      occupiedCount: occupied.size,
    };
  } catch (err: any) {
    console.warn(`[SparesPool] lite pool unavailable: ${err?.message || err}`);
    return null;
  }
}
