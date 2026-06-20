import { AmsApiService } from "./ams-api-service";
import { db } from "./db";
import { amsVehiclesCache } from "@shared/schema";
import { isNotNull } from "drizzle-orm";
import { resolveTruckStatusLabel } from "./ams-truck-status-labels";
import { runUnderSnowflakeSyncLock } from "./fleetscope-snowflake-sync-lock";

const amsApiService = new AmsApiService();

let cache: { data: Record<string, string | null>; builtAt: number } | null = null;
let oosCache: { data: Record<string, string | null>; builtAt: number } | null = null;
const TTL_MS = 30 * 60 * 1000;

async function build(): Promise<Record<string, string | null>> {
  console.log("[AMS TruckStatusMap] Building VIN→TruckStatus map...");

  const lookupItems: any[] = await amsApiService
    .getLookup("truck-status")
    .catch(() => []);
  const lookupMap = new Map<string, string>();
  const skipKeys = new Set(["UniqueID", "uniqueID", "Id", "id"]);
  for (const item of lookupItems) {
    const id = String(item.UniqueID ?? item.id ?? "");
    let label: string | undefined;
    for (const [key, val] of Object.entries(item)) {
      if (skipKeys.has(key)) continue;
      if (typeof val === "string" && val.trim()) {
        label = val.trim();
        break;
      }
    }
    if (id) lookupMap.set(id, label ?? id);
  }
  console.log(
    `[AMS TruckStatusMap] Truck-status lookup: ${lookupMap.size} entries`,
  );

  const result: Record<string, string | null> = {};
  const oosByVin: Record<string, string | null> = {};
  const pageSize = 500;
  let offset = 0;
  let totalFetched = 0;
  let amsWorked = false;

  while (true) {
    let raw: any;
    try {
      // 30s per-page timeout so a stalled AMS request can't block the
      // overall build (and the Snowflake supplement that follows).
      raw = await Promise.race([
        amsApiService.searchVehicles({ limit: pageSize, offset }),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`AMS page timeout (offset ${offset})`)),
            30_000,
          ),
        ),
      ]);
    } catch (err: any) {
      console.warn(
        `[AMS TruckStatusMap] AMS search error at offset ${offset}: ${err.message}`,
      );
      break;
    }

    let rows: any[];
    if (Array.isArray(raw)) {
      rows = raw;
    } else if (raw && typeof raw === "object") {
      rows = Array.isArray(raw.data)
        ? raw.data
        : Array.isArray(raw.vehicles)
          ? raw.vehicles
          : Array.isArray(raw.results)
            ? raw.results
            : Array.isArray(raw.items)
              ? raw.items
              : [];
    } else {
      rows = [];
    }

    if (rows.length === 0) break;
    amsWorked = true;

    for (const v of rows) {
      const vin = (v.VIN || v.vin || "").trim().toUpperCase();
      if (!vin) continue;
      const raw_status = v.TruckStatus ?? v.truckStatus ?? v.truck_status;
      result[vin] = resolveTruckStatusLabel(raw_status, lookupMap);
      // AMS API returns this field as "OutofSvcDate" (verified against
      // a live response). Other casings are kept as defensive fallbacks.
      const oosRaw =
        v.OutofSvcDate ??
        v.OutOfSvcDate ??
        v.outofSvcDate ??
        v.OutOfServiceDate ??
        v.outOfServiceDate ??
        v.OutOfService ??
        v.outOfService ??
        null;
      oosByVin[vin] = oosRaw == null ? null : String(oosRaw).trim();
    }

    totalFetched += rows.length;
    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  if (amsWorked) {
    console.log(
      `[AMS TruckStatusMap] Built map from AMS API: ${Object.keys(result).length} vehicles (${totalFetched} rows fetched)`,
    );
    // Supplement with ams_vehicles_cache DB for any VINs the AMS bulk search missed
    try {
      const dbRows = await db
        .select({ vin: amsVehiclesCache.vin, label: amsVehiclesCache.amsTruckStatusLabel })
        .from(amsVehiclesCache)
        .where(isNotNull(amsVehiclesCache.amsTruckStatusLabel));
      let dbAdded = 0;
      for (const row of dbRows) {
        const vin = (row.vin || "").trim().toUpperCase();
        if (vin && !result[vin] && row.label) { result[vin] = row.label; dbAdded++; }
      }
      if (dbAdded > 0) console.log(`[AMS TruckStatusMap] DB supplement: added ${dbAdded} VINs from ams_vehicles_cache`);
    } catch (dbErr: any) {
      console.warn("[AMS TruckStatusMap] DB supplement failed (continuing):", dbErr?.message);
    }
  } else {
    console.log(
      "[AMS TruckStatusMap] AMS API returned 0 vehicles — relying on Snowflake REPLIT_ALL_VEHICLES",
    );
  }

  // Always supplement from Snowflake REPLIT_ALL_VEHICLES. The AMS list and
  // per-VIN endpoints currently return TruckStatus: null for every row, so
  // without this step no statuses (Declined Repair, Sent To Auction, etc.)
  // would surface. Snowflake's TRUCK_STATUS is the source of truth here.
  try {
    const { getSnowflakeService } = await import("./snowflake-service");
    const snowflakeService = getSnowflakeService();
    const sql = `
        SELECT VIN, TRUCK_STATUS, OUT_OF_SERVICE_DATE
        FROM PARTS_SUPPLYCHAIN.FLEET.REPLIT_ALL_VEHICLES
        WHERE VIN IS NOT NULL
          AND TRUCK_STATUS IS NOT NULL
          AND TRUCK_STATUS != ''
      `;
    // Serialize this REPLIT_ALL_VEHICLES read against the All Vehicles mirror
    // refresh (which also reads REPLIT_ALL_VEHICLES) via the shared advisory
    // lock. Only the Snowflake read is wrapped — the AMS API pagination above
    // is a different system and stays outside the lock. If the lock can't be
    // acquired the helper throws and the catch below just skips the supplement
    // (the AMS-sourced statuses are still served).
    const sfRows = (await runUnderSnowflakeSyncLock(
      "ams-truck-status-supplement",
      () => snowflakeService.executeQuery(sql),
    )) as Array<{
      VIN: string;
      TRUCK_STATUS: string;
      OUT_OF_SERVICE_DATE: string | null;
    }>;
    let sfFilled = 0;
    let sfAddedVins = 0;
    for (const row of sfRows) {
      if (!row.VIN) continue;
      const vin = row.VIN.trim().toUpperCase();
      const rawStatus = (row.TRUCK_STATUS || "").trim();
      if (!rawStatus) continue;
      const label = resolveTruckStatusLabel(rawStatus, lookupMap);
      const existing = result[vin];
      if (existing == null) {
        if (!(vin in result)) sfAddedVins++;
        result[vin] = label || null;
        sfFilled++;
      }
      if (oosByVin[vin] == null) {
        oosByVin[vin] =
          row.OUT_OF_SERVICE_DATE == null
            ? null
            : String(row.OUT_OF_SERVICE_DATE).trim();
      }
    }
    console.log(
      `[AMS TruckStatusMap] Snowflake supplement: filled ${sfFilled} statuses (${sfAddedVins} new VINs) from ${sfRows.length} rows`,
    );
  } catch (sfErr: any) {
    console.warn(
      "[AMS TruckStatusMap] Snowflake supplement failed (continuing):",
      sfErr?.message,
    );
  }

  oosCache = { data: oosByVin, builtAt: Date.now() };
  return result;
}

// In-flight promise dedupe: when the cache is cold (or stale) and N concurrent
// callers arrive, only ONE build() runs — the rest await the same promise.
// Without this, the startup warmer + the first request from /api/ams/truck-status-map
// + the first request from /api/fs/all-vehicles would each kick off an independent
// ~2-minute full AMS pagination, blowing past Replit's ~60s edge-proxy timeout
// and surfacing as 502s on the All Vehicles page.
let buildPromise: Promise<Record<string, string | null>> | null = null;

function dedupedBuild(): Promise<Record<string, string | null>> {
  if (buildPromise) return buildPromise;
  buildPromise = build()
    .then((data) => {
      cache = { data, builtAt: Date.now() };
      return data;
    })
    .finally(() => {
      buildPromise = null;
    });
  return buildPromise;
}

export async function getAmsTruckStatusMap(): Promise<
  Record<string, string | null>
> {
  const now = Date.now();
  if (!cache || now - cache.builtAt > TTL_MS) {
    return dedupedBuild();
  }
  const ageMin = Math.round((now - cache.builtAt) / 60000);
  console.log(
    `[AMS TruckStatusMap] Serving cached map (${Object.keys(cache.data).length} vehicles, age ${ageMin}m)`,
  );
  return cache.data;
}

// VIN → OutOfServiceDate string (raw value from AMS / Snowflake fallback).
// "Unk/NA" or empty/null means the vehicle is currently in service.
// A real date string (any non-empty value other than "Unk/NA") means the
// vehicle has an out-of-service date set.
export async function getAmsOutOfServiceMap(): Promise<
  Record<string, string | null>
> {
  // Reuse the build pipeline — the truck-status build also populates oosCache
  await getAmsTruckStatusMap();
  return oosCache?.data ?? {};
}

export function getAmsTruckStatusMapCachedOnly():
  | Record<string, string | null>
  | null {
  return cache?.data ?? null;
}

// Per-VIN fallback cache for VINs that don't appear in the bulk map.
// The bulk AMS search occasionally returns 500 and we fall back to a
// Snowflake mirror that doesn't include older trucks (e.g. old declines).
// For those VINs we hit /api/v1/vehicles/{vin} individually and cache here.
const perVinCache = new Map<
  string,
  { status: string | null; oos: string | null; builtAt: number }
>();
const PER_VIN_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const PER_VIN_NEGATIVE_TTL_MS = 6 * 60 * 60 * 1000; // 6h for "not in AMS"

let lookupMapCache: { data: Map<string, string>; builtAt: number } | null = null;

async function getTruckStatusLookup(): Promise<Map<string, string>> {
  const now = Date.now();
  if (lookupMapCache && now - lookupMapCache.builtAt < TTL_MS) {
    return lookupMapCache.data;
  }
  const lookupItems: any[] = await amsApiService
    .getLookup("truck-status")
    .catch(() => []);
  const map = new Map<string, string>();
  const skipKeys = new Set(["UniqueID", "uniqueID", "Id", "id"]);
  for (const item of lookupItems) {
    const id = String(item.UniqueID ?? item.id ?? "");
    let label: string | undefined;
    for (const [key, val] of Object.entries(item)) {
      if (skipKeys.has(key)) continue;
      if (typeof val === "string" && val.trim()) {
        label = val.trim();
        break;
      }
    }
    if (id) map.set(id, label ?? id);
  }
  lookupMapCache = { data: map, builtAt: now };
  return map;
}

// Lookup AMS truck status for a list of VINs that are missing from the bulk
// map. Performs per-VIN /vehicles/{vin} requests with caching, in small
// concurrent batches to avoid hammering AMS. Returns a VIN→status map (only
// includes VINs that resolved or are negatively cached).
export async function getAmsStatusForMissingVins(
  vins: string[],
): Promise<Record<string, string | null>> {
  const result: Record<string, string | null> = {};
  if (vins.length === 0) return result;

  const lookupMap = await getTruckStatusLookup();
  const now = Date.now();
  const toFetch: string[] = [];

  for (const rawVin of vins) {
    const vin = (rawVin || "").trim().toUpperCase();
    if (!vin) continue;
    const cached = perVinCache.get(vin);
    if (cached) {
      const age = now - cached.builtAt;
      const ttl =
        cached.status === null ? PER_VIN_NEGATIVE_TTL_MS : PER_VIN_TTL_MS;
      if (age < ttl) {
        result[vin] = cached.status;
        continue;
      }
    }
    toFetch.push(vin);
  }

  if (toFetch.length === 0) return result;

  console.log(
    `[AMS PerVin] Fetching ${toFetch.length} VINs individually (bulk map missed)`,
  );

  const CONCURRENCY = 6;
  let fetched = 0;
  let found = 0;
  for (let i = 0; i < toFetch.length; i += CONCURRENCY) {
    const slice = toFetch.slice(i, i + CONCURRENCY);
    await Promise.all(
      slice.map(async (vin) => {
        try {
          const v: any = await amsApiService.getVehicleByVin(vin);
          const rawStatus = v?.TruckStatus ?? v?.truckStatus ?? v?.truck_status;
          const status: string | null = resolveTruckStatusLabel(
            rawStatus,
            lookupMap,
          );
          const oosRaw =
            v?.OutofSvcDate ??
            v?.OutOfSvcDate ??
            v?.outofSvcDate ??
            v?.OutOfServiceDate ??
            v?.outOfServiceDate ??
            null;
          const oos = oosRaw == null ? null : String(oosRaw).trim();
          perVinCache.set(vin, { status, oos, builtAt: Date.now() });
          if (oosCache) oosCache.data[vin] = oos;
          result[vin] = status;
          fetched++;
          if (status !== null) found++;
        } catch (err: any) {
          // 404 or other error: cache as null (not in AMS) with shorter TTL.
          perVinCache.set(vin, {
            status: null,
            oos: null,
            builtAt: Date.now(),
          });
          result[vin] = null;
          fetched++;
        }
      }),
    );
  }

  console.log(
    `[AMS PerVin] Done: ${fetched} requested, ${found} returned a status`,
  );
  return result;
}

export function isAmsTruckStatusCacheStale(): boolean {
  if (!cache) return true;
  return Date.now() - cache.builtAt > TTL_MS;
}

export function warmAmsTruckStatusCache(): Promise<void> {
  // Route through dedupedBuild so any concurrent request that arrives before
  // the warmer finishes shares the same in-flight pagination.
  return dedupedBuild()
    .then((data) => {
      console.log(
        `[AMS TruckStatusMap] Cache warmed at startup (${Object.keys(data).length} vehicles)`,
      );
    })
    .catch((err) => {
      console.warn(
        "[AMS TruckStatusMap] Startup warm-up failed (will retry on first request):",
        err.message,
      );
    });
}
