/**
 * Fleet linkage for inbound shop calls.
 *
 * A shop calls to say "the van is ready" and gives us a plate, a VIN, or a unit
 * number. That is useless on its own — the value only appears when the call
 * lands on the actual rental. This resolves whatever identifier we captured to a
 * Holman truck number, which IS vrm_rental_operations_cases.case_key, and then
 * checks whether that truck has an open rental case.
 *
 * READ-ONLY against every other module's tables. Writes only vrm_inbound_calls.
 *
 * Measured reality (58-call corpus, 2026-07-28): only ~59% of real inbound calls
 * carry ANY vehicle identifier. The rest are callers who could not produce one
 * ("I don't have it", "I do not"). So automatic matching has a hard ceiling and
 * the manual-link write path is not a nicety, it is how ~40% of calls ever get
 * attached to a truck.
 */
import { db } from "../../db";
import { sql } from "drizzle-orm";

export type MatchMethod = "unit" | "vin" | "last8" | "plate" | "phone" | "manual" | "none";
export type MatchConfidence = "high" | "medium" | "low";

export interface LinkResult {
  matched_truck: string | null;
  matched_case_key: string | null;
  match_method: MatchMethod;
  match_confidence: MatchConfidence | null;
}

/** 5-char zero-padded truck number, the shape case_key uses. */
export function padTruck(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/[^0-9]/g, "").replace(/^0+/, "");
  if (!digits) return null;
  // REJECT rather than truncate. The old `.slice(-5)` turned "616534" into
  // "16534" and returned it with method="unit", confidence="high", which
  // attaches the call to a REAL BUT WRONG TRUCK. Downstream that suppresses
  // LUCA outbound calling on an unrelated truck and shows another technician's
  // rental in the drawer. case_key is VARCHAR(10), so there was never a width
  // reason to truncate.
  if (digits.length > 5) return null;
  return digits.padStart(5, "0");
}

/**
 * holman_vehicles_cache is owned by another module and its column set has
 * drifted over time, so probe it once instead of hard-coding a plate column that
 * may not exist. A wrong column name here would throw on every ingest.
 */
let cachedCols: Set<string> | null = null;
async function vehicleCacheColumns(): Promise<Set<string>> {
  if (cachedCols) return cachedCols;
  try {
    const r = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'holman_vehicles_cache'`);
    // `?? []` guards the Neon quirk where a query can hand back null instead of
    // an empty array, which would throw on .map and poison the cache below.
    const cols = new Set(((r as any)?.rows ?? []).map((x: any) => String(x.column_name)));
    if (cols.size) cachedCols = cols;   // only memoize a SUCCESSFUL probe
    return cols;
  } catch (e: any) {
    // NEVER memoize the failure. The old code did `cachedCols = new Set()`, and
    // an empty Set is truthy, so a single transient error — most likely at the
    // boot sync 60s into startup, the most contended moment — permanently
    // disabled ALL VIN/plate matching for the life of the process, silently.
    // Every ingest would record matched_truck=NULL and relink could not repair
    // it because relink calls this same function. At ~1 call/day, re-probing is
    // free and the next call self-heals.
    console.warn("[VRM/Inbound] holman_vehicles_cache column probe failed:", e?.message || e);
    return new Set();
  }
}

function firstPresent(cols: Set<string>, candidates: string[]): string | null {
  return candidates.find((c) => cols.has(c)) ?? null;
}

/** Resolve a truck number from whatever the caller gave us. */
export async function resolveTruck(input: {
  unit_number?: string | null;
  vin?: string | null;
  vin_last_8?: string | null;
  license_plate?: string | null;
}): Promise<{ truck: string | null; method: MatchMethod; confidence: MatchConfidence | null }> {
  // 1. Unit number IS the truck number. Nothing to resolve, highest confidence.
  const unit = padTruck(input.unit_number);
  if (unit) return { truck: unit, method: "unit", confidence: "high" };

  const cols = await vehicleCacheColumns();
  if (!cols.size) return { truck: null, method: "none", confidence: null };

  const truckCol = firstPresent(cols, ["vehicle_number_display", "holman_vehicle_number", "vehicle_number"]);
  if (!truckCol) return { truck: null, method: "none", confidence: null };
  const truckExpr = sql.raw(`lpad(ltrim(regexp_replace(COALESCE(hv.${truckCol}::text,''), '[^0-9]', '', 'g'), '0'), 5, '0')`);

  // 2. Full VIN — exact, unambiguous.
  const vin = (input.vin || "").trim().toUpperCase();
  if (vin.length >= 15 && cols.has("vin")) {
    const r = await db.execute(sql`
      SELECT ${truckExpr} AS truck FROM holman_vehicles_cache hv
      WHERE upper(trim(hv.vin)) = ${vin} LIMIT 2`);
    const rows = r.rows as any[];
    if (rows.length === 1 && rows[0].truck && rows[0].truck !== "00000") {
      return { truck: String(rows[0].truck), method: "vin", confidence: "high" };
    }
  }

  // 3. Last 8 of the VIN — effectively unique in a fleet this size, but demote
  //    to medium if more than one vehicle answers to it.
  const last8 = (input.vin_last_8 || (vin.length >= 8 ? vin.slice(-8) : "")).trim().toUpperCase();
  if (last8.length === 8 && cols.has("vin")) {
    const r = await db.execute(sql`
      SELECT DISTINCT ${truckExpr} AS truck FROM holman_vehicles_cache hv
      WHERE hv.vin IS NOT NULL AND right(upper(trim(hv.vin)), 8) = ${last8} LIMIT 3`);
    const rows = (r.rows as any[]).filter((x) => x.truck && x.truck !== "00000");
    if (rows.length === 1) return { truck: String(rows[0].truck), method: "last8", confidence: "high" };
    if (rows.length > 1) return { truck: String(rows[0].truck), method: "last8", confidence: "low" };
  }

  // 4. Plate. Transcribed plates carry OCR/ASR risk, so never better than medium.
  const plateCol = firstPresent(cols, ["license_plate", "plate", "license_plate_number", "tag_number"]);
  const plate = (input.license_plate || "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
  if (plate.length >= 5 && plateCol) {
    const pExpr = sql.raw(`upper(regexp_replace(COALESCE(hv.${plateCol}::text,''), '[^A-Za-z0-9]', '', 'g'))`);
    const r = await db.execute(sql`
      SELECT DISTINCT ${truckExpr} AS truck FROM holman_vehicles_cache hv
      WHERE ${pExpr} = ${plate} LIMIT 3`);
    const rows = (r.rows as any[]).filter((x) => x.truck && x.truck !== "00000");
    if (rows.length === 1) return { truck: String(rows[0].truck), method: "plate", confidence: "medium" };
    if (rows.length > 1) return { truck: String(rows[0].truck), method: "plate", confidence: "low" };
  }

  return { truck: null, method: "none", confidence: null };
}

/**
 * Full link: identifier -> truck -> open rental case.
 *
 * matched_truck is set whenever we can name a truck. matched_case_key is set
 * ONLY when that truck actually has a rental case, so the page can tell the
 * difference between "we know the truck, there is no rental" (a shop calling
 * about a non-rental vehicle) and "we could not identify the truck at all".
 */
export async function linkInboundCall(input: {
  unit_number?: string | null;
  vin?: string | null;
  vin_last_8?: string | null;
  license_plate?: string | null;
}): Promise<LinkResult> {
  const { truck, method, confidence } = await resolveTruck(input);
  if (!truck) return { matched_truck: null, matched_case_key: null, match_method: "none", match_confidence: null };

  let matched_case_key: string | null = null;
  try {
    const r = await db.execute(sql`
      SELECT case_key FROM vrm_rental_operations_cases
      WHERE case_key = ${truck}
      ORDER BY present_in_latest DESC, last_seen_at DESC NULLS LAST
      LIMIT 1`);
    matched_case_key = (r.rows as any[])[0]?.case_key ?? null;
  } catch {
    matched_case_key = null;
  }

  return { matched_truck: truck, matched_case_key, match_method: method, match_confidence: confidence };
}
