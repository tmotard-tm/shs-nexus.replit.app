import { AmsApiService } from "./ams-api-service";
import { db } from "./db";
import { amsVehiclesCache } from "@shared/schema";
import { isNotNull } from "drizzle-orm";
import { resolveTruckStatusLabel } from "./ams-truck-status-labels";
import { runUnderSnowflakeSyncLock } from "./fleetscope-snowflake-sync-lock";

const amsApiService = new AmsApiService();

let cache: { data: Record<string, string | null>; builtAt: number } | null = null;
let oosCache: { data: Record<string, string | null>; builtAt: number } | null = null;
// VIN → VehicleInRepair, captured from the bulk AMS rows WHEN the field is
// present and parseable. AMS only guarantees this flag on the per-VIN
// endpoint, so absence from this map means "not bulk-visible", not false.
let inRepairCache: { data: Record<string, boolean>; builtAt: number } | null = null;
// AMS fleet population captured from the same bulk page walk: every vehicle
// row AMS returned, keyed by its digits-only vehicle number. `complete` is
// true only when the pagination finished naturally (no page error broke the
// walk) — a partial walk NEVER overwrites a previous complete population.
let populationCache: {
  data: { truckNumber: string; vin: string | null }[];
  complete: boolean;
  builtAt: number;
} | null = null;
const TTL_MS = 30 * 60 * 1000;

/**
 * Pure: pull the vehicle rows out of one AMS bulk page response.
 * `malformed=true` means the payload was unrecognized (error-shaped object,
 * null/undefined, or a primitive) — the page walk must be treated as
 * TRUNCATED, never as a natural end of pagination. A recognized envelope
 * with an empty array is a natural end (`malformed=false`).
 */
export function extractAmsPageRows(raw: unknown): { rows: any[]; malformed: boolean } {
  if (Array.isArray(raw)) return { rows: raw, malformed: false };
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const arr = [o.data, o.vehicles, o.results, o.items].find(Array.isArray) as any[] | undefined;
    if (arr) return { rows: arr, malformed: false };
    return { rows: [], malformed: true };
  }
  return { rows: [], malformed: true };
}

/**
 * Pure: derive a fleet-population entry from one AMS vehicle row, or null
 * when the row is not part of the current fleet. Rows with a SaleDate are
 * sold/disposed history (AMS keeps them alongside the live fleet) and are
 * excluded; unsold "Sent To Auction" / "Declined Repair" trucks stay in
 * (status is irrelevant here). VIN-less rows still count — a row without a
 * VIN is still a vehicle that exists in AMS.
 */
export function amsPopulationEntryFromRow(v: any): { truckNumber: string; vin: string | null } | null {
  if (!v || typeof v !== "object") return null;
  const saleDate = v.SaleDate ?? v.saleDate ?? null;
  if (saleDate) return null;
  const truckNumber = String(v.VehicleNumber ?? v.vehicleNumber ?? "").replace(/\D/g, "");
  if (!truckNumber) return null;
  const vin = String(v.VIN ?? v.vin ?? "").trim().toUpperCase() || null;
  return { truckNumber, vin };
}

/**
 * Pure: overwrite policy for the population cache. A complete walk always
 * replaces; an incomplete (truncated) walk only lands when there is no
 * previous population at all — a partial fleet must never clobber a
 * last-good complete one.
 */
export function shouldReplacePopulation(
  prev: { complete: boolean } | null,
  nextComplete: boolean,
): boolean {
  return nextComplete || !prev;
}

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
  const inRepairByVin: Record<string, boolean> = {};
  // Digits-only vehicle number → VIN (first sighting wins, but a row WITH a
  // VIN replaces an earlier VIN-less sighting of the same number).
  const popByNumber = new Map<string, string | null>();
  let pageWalkFailed = false;
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
      pageWalkFailed = true;
      break;
    }

    const { rows, malformed } = extractAmsPageRows(raw);
    if (malformed) {
      // Unrecognized payload (error-shaped object, null/undefined, primitive)
      // is a FAILED walk, never a natural end of pagination — otherwise a
      // truncated collection would masquerade as the complete fleet.
      console.warn(
        `[AMS TruckStatusMap] Unrecognized AMS page payload at offset ${offset} — treating walk as truncated`,
      );
      pageWalkFailed = true;
    }

    if (rows.length === 0) break;
    amsWorked = true;

    for (const v of rows) {
      const vin = (v.VIN || v.vin || "").trim().toUpperCase();
      // Population capture happens BEFORE the VIN gate (see helper docs:
      // SaleDate rows are sold history and excluded; VIN-less rows count).
      const popEntry = amsPopulationEntryFromRow(v);
      if (popEntry) {
        const existing = popByNumber.get(popEntry.truckNumber);
        if (existing == null) popByNumber.set(popEntry.truckNumber, popEntry.vin);
      }
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
      // Tri-state parse of the in-repair flag: only a value we can positively
      // read as true/false lands in the map; anything else stays absent
      // (= unknown), because the per-VIN endpoint is the only guaranteed
      // carrier of this field.
      const irRaw = v.VehicleInRepair ?? v.InRepair ?? v.inRepair ?? v.IsInRepair;
      if (irRaw === true || irRaw === 1) inRepairByVin[vin] = true;
      else if (irRaw === false || irRaw === 0) inRepairByVin[vin] = false;
      else if (typeof irRaw === "string") {
        const s = irRaw.trim().toLowerCase();
        if (["y", "yes", "true", "1", "t"].includes(s)) inRepairByVin[vin] = true;
        else if (["n", "no", "false", "0", "f"].includes(s)) inRepairByVin[vin] = false;
      }
    }

    totalFetched += rows.length;
    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  if (amsWorked && popByNumber.size > 0) {
    const complete = !pageWalkFailed;
    const popRows = Array.from(popByNumber, ([truckNumber, vin]) => ({ truckNumber, vin }));
    if (shouldReplacePopulation(populationCache, complete)) {
      populationCache = { data: popRows, complete, builtAt: Date.now() };
      console.log(
        `[AMS TruckStatusMap] AMS population captured: ${popRows.length} vehicles (complete=${complete})`,
      );
    } else {
      // Partial page walk: keep the last-good (complete) population rather
      // than clobbering it with a truncated fleet list.
      console.warn(
        `[AMS TruckStatusMap] Partial AMS page walk (${popRows.length} rows) — keeping last-good population (${populationCache.data.length} trucks)`,
      );
    }
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
  inRepairCache = { data: inRepairByVin, builtAt: Date.now() };
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

// Throttle for population-driven rebuilds: when the fleet population is
// missing/incomplete but the status cache is still inside its 30-min TTL,
// retry a full build at most this often (deduped while in flight).
const POPULATION_RETRY_MS = 3 * 60 * 1000;
let lastPopulationRetryAt = 0;

export async function getAmsTruckStatusMap(): Promise<
  Record<string, string | null>
> {
  const now = Date.now();
  if (!cache || now - cache.builtAt > TTL_MS) {
    return dedupedBuild();
  }
  // The status cache is fresh, but the fleet population (built by the same
  // walk) is missing or truncated — without this branch the Registrations tab
  // would stay "warming" for the rest of the 30-min TTL.
  if (
    (!populationCache || !populationCache.complete) &&
    now - lastPopulationRetryAt > POPULATION_RETRY_MS
  ) {
    lastPopulationRetryAt = now;
    console.log(
      "[AMS TruckStatusMap] Population missing/incomplete inside status TTL — retrying full build",
    );
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

/**
 * AMS fleet population from the last successful bulk page walk, cached-only.
 * `trucks` carries digits-only vehicle numbers plus the row VIN when AMS
 * returned one. `complete` is false when the walk was truncated by a page
 * error AND no complete walk has ever succeeded — callers should surface a
 * "still building" state rather than trusting a truncated list as the fleet.
 * null = no walk has produced any population yet (cache cold).
 */
export function getAmsPopulationCachedOnly(): {
  trucks: { truckNumber: string; vin: string | null }[];
  complete: boolean;
  builtAt: number;
} | null {
  return populationCache
    ? {
        trucks: populationCache.data,
        complete: populationCache.complete,
        builtAt: populationCache.builtAt,
      }
    : null;
}

export function getAmsTruckStatusMapCachedOnly():
  | Record<string, string | null>
  | null {
  return cache?.data ?? null;
}

/**
 * VIN → VehicleInRepair from the last bulk build, cached-only. A VIN missing
 * from this map is UNKNOWN (the bulk AMS rows do not reliably carry the
 * flag), never an implied false — callers decide their own failure posture.
 */
export function getAmsInRepairMapCachedOnly(): Record<string, boolean> | null {
  return inRepairCache?.data ?? null;
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

// After a write to a vehicle's AMS fields (e.g. truck status), refresh just
// that one VIN's entry in the in-memory bulk map so the fleet-card status pill
// (served from /api/ams/truck-status-map, a 30-min cache) reflects the change
// within seconds instead of waiting for the next full rebuild. Does a fresh
// per-VIN AMS read (bypassing the per-VIN TTL cache) and patches the bulk map,
// the per-VIN cache, and the OOS map. Returns the new status, or undefined if
// the read failed (non-fatal — the caller's write already succeeded). If the
// bulk map has never been built, this is a no-op for the bulk map (the next
// getAmsTruckStatusMap() will build fresh and include the current value).
export async function refreshAmsTruckStatusForVin(
  rawVin: string,
): Promise<string | null | undefined> {
  const vin = (rawVin || "").trim().toUpperCase();
  if (!vin) return undefined;
  try {
    const lookupMap = await getTruckStatusLookup();
    const v: any = await amsApiService.getVehicleByVin(vin);
    const rawStatus = v?.TruckStatus ?? v?.truckStatus ?? v?.truck_status;
    const status: string | null = resolveTruckStatusLabel(rawStatus, lookupMap);
    const oosRaw =
      v?.OutofSvcDate ??
      v?.OutOfSvcDate ??
      v?.outofSvcDate ??
      v?.OutOfServiceDate ??
      v?.outOfServiceDate ??
      null;
    const oos = oosRaw == null ? null : String(oosRaw).trim();
    perVinCache.set(vin, { status, oos, builtAt: Date.now() });
    if (cache) cache.data[vin] = status;
    if (oosCache) oosCache.data[vin] = oos;
    console.log(
      `[AMS TruckStatusMap] Patched VIN ${vin} -> ${status ?? "null"} after AMS user-update`,
    );
    return status;
  } catch (err: any) {
    console.warn(
      `[AMS TruckStatusMap] Could not refresh VIN ${vin} after user-update: ${err?.message || err}`,
    );
    return undefined;
  }
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
