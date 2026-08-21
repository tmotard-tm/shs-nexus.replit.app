/**
 * Task #662 — out-of-service exclusion sets from holman_vehicles_cache.
 *
 * Thin DB wrapper around the pure classifier in holman-oos-policy. Used by
 * every "available truck" surface that is NOT already reading cache rows
 * (the Snowflake spares fallback, the PMF Assign Truck candidate list) to
 * drop vehicles Holman considers out of service.
 *
 * Why statusCode alone is not enough: after an OOS submit, the cache row can
 * sit at statusCode=1 with a past outOfServiceDate until a later sync flips
 * the code (observed on all 10 BYOV OOS trucks). The durable signal is the
 * date — isOutOfServiceRecord treats statusCode 2 OR a past outOfServiceDate
 * as out of service.
 */

import { db } from "./db";
import { holmanVehiclesCache } from "@shared/schema";
import { and, eq, or, sql } from "drizzle-orm";
import { classifyOosExclusion, type OosExclusionSets } from "./holman-oos-policy";

/**
 * Canonical truck numbers + VINs of every active cache row that is out of
 * service (statusCode 2 or past outOfServiceDate). Throws on DB failure —
 * callers decide their own fail direction (candidate lists log and serve
 * unfiltered rather than go dark).
 */
export async function fetchHolmanOosExclusion(): Promise<OosExclusionSets> {
  const rows = await db
    .select({
      holmanVehicleNumber: holmanVehiclesCache.holmanVehicleNumber,
      vin: holmanVehiclesCache.vin,
      statusCode: holmanVehiclesCache.statusCode,
      outOfServiceDate: holmanVehiclesCache.outOfServiceDate,
    })
    .from(holmanVehiclesCache)
    .where(
      and(
        eq(holmanVehiclesCache.isActive, true),
        or(
          eq(holmanVehiclesCache.statusCode, 2),
          sql`COALESCE(${holmanVehiclesCache.outOfServiceDate}, '') <> ''`,
        ),
      ),
    );
  return classifyOosExclusion(rows);
}
