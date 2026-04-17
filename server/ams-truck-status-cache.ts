import { AmsApiService } from "./ams-api-service";

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
      raw = await amsApiService.searchVehicles({ limit: pageSize, offset });
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
      if (raw_status == null) {
        result[vin] = null;
      } else {
        const label = lookupMap.get(String(raw_status));
        result[vin] = label ?? String(raw_status);
      }
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
    oosCache = { data: oosByVin, builtAt: Date.now() };
    return result;
  }

  console.log(
    "[AMS TruckStatusMap] AMS API returned 0 vehicles — falling back to Snowflake REPLIT_ALL_VEHICLES",
  );
  const { getSnowflakeService } = await import("./snowflake-service");
  const snowflakeService = getSnowflakeService();
  const sql = `
      SELECT VIN, TRUCK_STATUS, OUT_OF_SERVICE_DATE
      FROM PARTS_SUPPLYCHAIN.FLEET.REPLIT_ALL_VEHICLES
      WHERE VIN IS NOT NULL
        AND TRUCK_STATUS IS NOT NULL
        AND TRUCK_STATUS != ''
    `;
  const sfRows = (await snowflakeService.executeQuery(sql)) as Array<{
    VIN: string;
    TRUCK_STATUS: string;
    OUT_OF_SERVICE_DATE: string | null;
  }>;
  for (const row of sfRows) {
    if (!row.VIN) continue;
    const vin = row.VIN.trim().toUpperCase();
    const rawStatus = (row.TRUCK_STATUS || "").trim();
    const label = lookupMap.get(rawStatus) ?? rawStatus;
    result[vin] = label || null;
    oosByVin[vin] =
      row.OUT_OF_SERVICE_DATE == null
        ? null
        : String(row.OUT_OF_SERVICE_DATE).trim();
  }
  console.log(
    `[AMS TruckStatusMap] Snowflake fallback: ${Object.keys(result).length} vehicles from ${sfRows.length} rows`,
  );
  oosCache = { data: oosByVin, builtAt: Date.now() };
  return result;
}

export async function getAmsTruckStatusMap(): Promise<
  Record<string, string | null>
> {
  const now = Date.now();
  if (!cache || now - cache.builtAt > TTL_MS) {
    cache = { data: await build(), builtAt: now };
  } else {
    const ageMin = Math.round((now - cache.builtAt) / 60000);
    console.log(
      `[AMS TruckStatusMap] Serving cached map (${Object.keys(cache.data).length} vehicles, age ${ageMin}m)`,
    );
  }
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

export function isAmsTruckStatusCacheStale(): boolean {
  if (!cache) return true;
  return Date.now() - cache.builtAt > TTL_MS;
}

export function warmAmsTruckStatusCache(): Promise<void> {
  return build()
    .then((data) => {
      cache = { data, builtAt: Date.now() };
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
