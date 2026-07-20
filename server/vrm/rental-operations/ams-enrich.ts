/**
 * VRM Rental Operations V2 — AMS status enrichment.
 *
 * Resolves each open-rental case's AMS truck status by VIN, reusing the existing
 * AMS truck-status cache (server/ams-truck-status-cache.ts: getAmsTruckStatusMap
 * returns VIN → status label, e.g. "Declined Repair", "Sent To Auction"). VIN
 * comes from holman_vehicles_cache. Best-effort: AMS being slow/down must never
 * fail the sync, so callers wrap this in try/catch.
 *
 * Writes ONLY vrm_rental_operations_cases (ams_status/vin/ams_status_at). Reads
 * holman_vehicles_cache + the AMS cache.
 */
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { toDisplayNumber } from "../../vehicle-number-utils";

export interface AmsEnrichResult {
  cases: number;
  withVin: number;
  withStatus: number;
  usedCachedOnly: boolean;
  skipped?: boolean;
}

export async function enrichCasesWithAms(opts: { cachedOnly?: boolean } = {}): Promise<AmsEnrichResult> {
  await db.execute(sql`SELECT 1`);
  const caseRes = await db.execute(sql`SELECT case_key, vehicle_number_padded FROM vrm_rental_operations_cases WHERE present_in_latest = true`);
  const cases = caseRes.rows as any[];
  if (!cases.length) return { cases: 0, withVin: 0, withStatus: 0, usedCachedOnly: !!opts.cachedOnly };

  // truck (display) -> VIN from holman_vehicles_cache
  const hvRes = await db.execute(sql`
    SELECT holman_vehicle_number, vin FROM holman_vehicles_cache WHERE vin IS NOT NULL AND vin <> ''
  `);
  const vinByTruck = new Map<string, string>();
  for (const r of hvRes.rows as any[]) {
    const key = toDisplayNumber(String(r.holman_vehicle_number ?? ""));
    if (key && r.vin) vinByTruck.set(key, String(r.vin).trim().toUpperCase());
  }

  // AMS map: VIN -> status label. cached-only in the request path; full build
  // (may paginate ~2 min) only in the background sync path.
  const cacheMod = await import("../../ams-truck-status-cache");
  let amsByVin: Record<string, string | null> = {};
  let usedCachedOnly = false;
  if (opts.cachedOnly) {
    amsByVin = cacheMod.getAmsTruckStatusMapCachedOnly() ?? {};
    usedCachedOnly = true;
  } else {
    amsByVin = await cacheMod.getAmsTruckStatusMap().catch(() => ({}));
  }

  // GUARD: if the AMS map is empty (cache cold or the full build failed), do NOT
  // write — a blanket null overwrite would wipe every truck's ams_status and
  // kill the Declined/Auction flag. Preserve what's there and bail.
  if (Object.keys(amsByVin).length === 0) {
    console.warn("[VRM/RentalOps] AMS map empty (cold cache / build failed) — skipping enrichment to preserve existing ams_status");
    return { cases: cases.length, withVin: 0, withStatus: 0, usedCachedOnly, skipped: true };
  }

  const now = new Date().toISOString();
  let withVin = 0, withStatus = 0;
  await db.transaction(async (tx) => {
    for (const c of cases) {
      const key = c.vehicle_number_padded as string;
      const vin = vinByTruck.get(key) ?? null;
      if (vin) withVin++;
      const status = vin ? (amsByVin[vin] ?? null) : null;
      if (status) withStatus++;
      // never wipe a good status back to null on a per-truck miss; keep the prior value
      await tx.execute(sql`
        UPDATE vrm_rental_operations_cases
        SET vin = COALESCE(${vin}, vin),
            ams_status = COALESCE(${status}, ams_status),
            ams_status_at = ${now}, updated_at = NOW()
        WHERE case_key = ${key}
      `);
    }
  });

  return { cases: cases.length, withVin, withStatus, usedCachedOnly };
}
