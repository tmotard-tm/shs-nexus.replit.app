/**
 * server/run-truck-driven-refresh.ts
 *
 * Phase 1 - Truck-driven TPMS refresh (Nexus-Reconciliation-TargetState-Spec-for-Fable.md).
 * Additive standalone script modeled on server/run-tpms-profile-heal.ts. Does NOT touch
 * the existing [Tech Data Scheduler] tech-keyed refresh.
 *
 * Reads TPMS live BY TRUCK: getTechInfo(toTpmsRef(truck)) with the 6-digit padded truck
 * number returns the tech currently on that truck (proven). A 400 / no-data response means
 * the truck is genuinely EMPTY in TPMS: record blank, never fabricate or carry a stale tech.
 *
 * Default cohort: the CURRENT board-mismatch truck set (the WHERE from buildMismatchRecords
 * in server/routes.ts, in its pre-Phase-2 form so the cohort matches the 2026-07-05 prod
 * baseline of ~178 trucks). --all switches to every active Holman truck (full Phase 1 sweep).
 *
 * Modes:
 *   npx tsx server/run-truck-driven-refresh.ts                        DRY RUN (default; TPMS reads only, zero DB writes)
 *   npx tsx server/run-truck-driven-refresh.ts --mismatch-db=prod     source the cohort list via SELECT from PROD_DATABASE_URL
 *                                                                     (read-only; --apply is refused in this mode)
 *   npx tsx server/run-truck-driven-refresh.ts --all                  cohort = all active Holman trucks (~2,170)
 *   npx tsx server/run-truck-driven-refresh.ts --limit=25             cap the number of trucks scanned
 *   npx tsx server/run-truck-driven-refresh.ts --apply                write tpms_last_known_truck_tech (upsert by truck_no)
 *                                                                     and tpms_tech_profiles (update by enterprise_id) on DEV
 *
 * Writes (--apply only, DEV DATABASE_URL only): tpms_last_known_truck_tech + tpms_tech_profiles.
 * Zero writes to TPMS / Holman / AMS / WMS ever. TPMS is READ-ONLY in this script.
 */

import { Pool } from "pg";
import { getTPMSService } from "./tpms-service";
import { toTpmsRef } from "./vehicle-number-utils";

const PROFILE_TRUCK_PAD_WIDTH = 7; // matches run-tpms-profile-heal.ts padTruck

// Cohort query: the buildMismatchRecords WHERE (pre-Phase-2 form, no AMS-'unknown'
// filter) so the verification cohort equals the current prod board (~178 trucks).
const MISMATCH_TRUCKS_SQL = `
  WITH tpms_latest AS (
    SELECT DISTINCT ON (LTRIM(truck_no, '0'))
      LTRIM(truck_no, '0') AS canonical_truck,
      enterprise_id AS tpms_id
    FROM tpms_tech_profiles
    WHERE truck_no IS NOT NULL AND truck_no != '' AND LTRIM(truck_no, '0') != ''
    ORDER BY LTRIM(truck_no, '0'), updated_at DESC
  )
  SELECT
    h.holman_vehicle_number AS truck_number,
    h.holman_tech_assigned  AS holman_tech_id,
    h.holman_tech_name      AS holman_tech_name,
    COALESCE(t.tpms_id, '') AS tpms_mirror_id,
    a.ams_assigned_ldap     AS ams_tech_id
  FROM holman_vehicles_cache h
  LEFT JOIN tpms_latest t ON t.canonical_truck = LTRIM(h.holman_vehicle_number, '0')
  LEFT JOIN ams_vehicles_cache a ON a.vin = h.vin
  WHERE h.is_active = true
    AND (h.status_code != 2 OR h.status_code IS NULL)
    AND h.out_of_service_date IS NULL
    AND (
      (
        COALESCE(LOWER(TRIM(h.holman_tech_assigned)), '') != ''
        AND COALESCE(LOWER(TRIM(t.tpms_id)), '') != ''
        AND LOWER(TRIM(h.holman_tech_assigned)) != LOWER(TRIM(t.tpms_id))
      )
      OR (
        COALESCE(TRIM(h.holman_tech_assigned), '') != ''
        AND COALESCE(TRIM(t.tpms_id), '') = ''
      )
      OR (
        COALESCE(TRIM(t.tpms_id), '') != ''
        AND COALESCE(TRIM(h.holman_tech_assigned), '') = ''
      )
      OR (
        a.ams_assigned_ldap IS NOT NULL
        AND TRIM(a.ams_assigned_ldap) != ''
        AND COALESCE(TRIM(t.tpms_id), '') != ''
        AND LOWER(TRIM(a.ams_assigned_ldap)) != LOWER(TRIM(t.tpms_id))
      )
      OR (
        a.ams_assigned_ldap IS NOT NULL
        AND TRIM(a.ams_assigned_ldap) != ''
        AND COALESCE(TRIM(t.tpms_id), '') = ''
      )
      OR (
        a.ams_assigned_ldap IS NOT NULL
        AND TRIM(a.ams_assigned_ldap) != ''
        AND COALESCE(TRIM(h.holman_tech_assigned), '') != ''
        AND COALESCE(TRIM(t.tpms_id), '') = ''
        AND LOWER(TRIM(a.ams_assigned_ldap)) != LOWER(TRIM(h.holman_tech_assigned))
      )
    )
  ORDER BY h.holman_vehicle_number`;

const ALL_ACTIVE_TRUCKS_SQL = `
  WITH tpms_latest AS (
    SELECT DISTINCT ON (LTRIM(truck_no, '0'))
      LTRIM(truck_no, '0') AS canonical_truck,
      enterprise_id AS tpms_id
    FROM tpms_tech_profiles
    WHERE truck_no IS NOT NULL AND truck_no != '' AND LTRIM(truck_no, '0') != ''
    ORDER BY LTRIM(truck_no, '0'), updated_at DESC
  )
  SELECT
    h.holman_vehicle_number AS truck_number,
    h.holman_tech_assigned  AS holman_tech_id,
    h.holman_tech_name      AS holman_tech_name,
    COALESCE(t.tpms_id, '') AS tpms_mirror_id,
    a.ams_assigned_ldap     AS ams_tech_id
  FROM holman_vehicles_cache h
  LEFT JOIN tpms_latest t ON t.canonical_truck = LTRIM(h.holman_vehicle_number, '0')
  LEFT JOIN ams_vehicles_cache a ON a.vin = h.vin
  WHERE h.is_active = true
    AND (h.status_code != 2 OR h.status_code IS NULL)
    AND h.out_of_service_date IS NULL
  ORDER BY h.holman_vehicle_number`;

// --apply SQL (DEV only). Upsert the truck-keyed live-TPMS store.
const LAST_KNOWN_UPSERT_SQL = `INSERT INTO tpms_last_known_truck_tech
  (truck_no, enterprise_id, tech_id, first_name, last_name, district_no, mobile_phone, email, last_seen_at, updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now(), now())
ON CONFLICT (truck_no) DO UPDATE SET
  enterprise_id = EXCLUDED.enterprise_id,
  tech_id       = EXCLUDED.tech_id,
  first_name    = EXCLUDED.first_name,
  last_name     = EXCLUDED.last_name,
  district_no   = EXCLUDED.district_no,
  mobile_phone  = EXCLUDED.mobile_phone,
  email         = EXCLUDED.email,
  last_seen_at  = now(),
  updated_at    = now()`;

// Empty truck: record blank (tech fields NULL). last_seen_at is a tech sighting
// timestamp, so on an existing row it is left alone; only updated_at advances.
const LAST_KNOWN_BLANK_SQL = `INSERT INTO tpms_last_known_truck_tech
  (truck_no, enterprise_id, tech_id, first_name, last_name, district_no, mobile_phone, email, last_seen_at, updated_at)
VALUES ($1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, now(), now())
ON CONFLICT (truck_no) DO UPDATE SET
  enterprise_id = NULL, tech_id = NULL, first_name = NULL, last_name = NULL,
  district_no = NULL, mobile_phone = NULL, email = NULL, updated_at = now()`;

// Update (never insert) the board read model for the returned tech.
const PROFILE_UPDATE_SQL = `UPDATE tpms_tech_profiles SET
  truck_no    = $2,
  district_no = COALESCE($3, district_no),
  first_name  = COALESCE($4, first_name),
  last_name   = COALESCE($5, last_name),
  synced_at   = now(),
  updated_at  = now()
WHERE enterprise_id = $1`;

interface CohortRow {
  truck_number: string;
  holman_tech_id: string | null;
  holman_tech_name: string | null;
  tpms_mirror_id: string;
  ams_tech_id: string | null;
}

interface LiveTech {
  ldapId: string;
  techId: string | null;
  firstName: string | null;
  lastName: string | null;
  districtNo: string | null;
  contactNo: string | null;
  email: string | null;
  truckNo: string | null;
}

type ScanOutcome = "live" | "empty" | "error";

interface ScanResult {
  truckRaw: string;
  truckRef: string; // 6-digit padded TPMS ref
  holmanLdap: string; // upper-trimmed, '' if unassigned
  holmanName: string | null;
  mirrorLdap: string; // upper-trimmed tpms_tech_profiles mirror value, '' if blank
  outcome: ScanOutcome;
  live: LiveTech | null;
  errorMessage: string | null;
}

function upperTrim(x: unknown): string {
  return String(x ?? "").trim().toUpperCase();
}
function strOrNull(x: unknown): string | null {
  if (x === null || x === undefined) return null;
  const s = String(x).trim();
  return s === "" ? null : s;
}
function canonTruck(x: unknown): string {
  return String(x ?? "").replace(/[^0-9]/g, "").replace(/^0+/, "");
}
function padProfileTruck(x: unknown): string | null {
  const c = canonTruck(x);
  return c === "" ? null : c.padStart(PROFILE_TRUCK_PAD_WIDTH, "0");
}
function fmtCount(label: string, n: number): string {
  return `  ${label.padEnd(46, " ")}${String(n).padStart(6, " ")}`;
}
function getArgValue(args: string[], prefix: string): string | null {
  const hit = args.find((a) => a.startsWith(prefix));
  if (!hit) return null;
  const v = hit.slice(prefix.length);
  return v === "" ? null : v;
}

/** True when the TPMS failure means "no tech on this truck" rather than an outage. */
function isEmptyTruckError(err: unknown): boolean {
  const statusCode = (err as any)?.statusCode;
  if (statusCode === 400 || statusCode === 404) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /no tech info entries/i.test(msg) || /TPMS error:/i.test(msg);
}

async function loadCohort(pool: Pool, useAll: boolean, limit: number | null): Promise<CohortRow[]> {
  const sqlText = useAll ? ALL_ACTIVE_TRUCKS_SQL : MISMATCH_TRUCKS_SQL;
  const res = await pool.query(sqlText);
  const rows = res.rows as CohortRow[];
  return limit !== null ? rows.slice(0, limit) : rows;
}

async function scanTrucks(cohort: CohortRow[]): Promise<ScanResult[]> {
  const tpms = getTPMSService();
  const results: ScanResult[] = [];
  let done = 0;
  for (const row of cohort) {
    const truckRaw = String(row.truck_number ?? "");
    const truckRef = toTpmsRef(truckRaw);
    const base: ScanResult = {
      truckRaw,
      truckRef,
      holmanLdap: upperTrim(row.holman_tech_id),
      holmanName: strOrNull(row.holman_tech_name),
      mirrorLdap: upperTrim(row.tpms_mirror_id),
      outcome: "error",
      live: null,
      errorMessage: null,
    };
    if (!truckRef) {
      base.errorMessage = "unparseable truck number";
      results.push(base);
      done++;
      continue;
    }
    try {
      const info = await tpms.getTechInfo(truckRef);
      const ldap = upperTrim(info.ldapId);
      if (ldap === "") {
        // Success envelope but no ldap: treat as empty, never fabricate.
        base.outcome = "empty";
      } else {
        base.outcome = "live";
        base.live = {
          ldapId: ldap,
          techId: strOrNull(info.techId),
          firstName: strOrNull(info.firstName),
          lastName: strOrNull(info.lastName),
          districtNo: strOrNull(info.districtNo),
          contactNo: strOrNull(info.contactNo),
          email: strOrNull(info.email),
          truckNo: strOrNull(info.truckNo),
        };
      }
    } catch (err) {
      if (isEmptyTruckError(err)) {
        base.outcome = "empty";
      } else {
        base.outcome = "error";
        base.errorMessage = err instanceof Error ? err.message : String(err);
      }
    }
    results.push(base);
    done++;
    if (done % 25 === 0) console.log(`[truck-refresh] scanned ${done}/${cohort.length}...`);
  }
  return results;
}

function printReport(results: ScanResult[], mode: string): void {
  const total = results.length;
  const live = results.filter((r) => r.outcome === "live");
  const empty = results.filter((r) => r.outcome === "empty");
  const errors = results.filter((r) => r.outcome === "error");

  // Phase 1 target bucket: Holman says assigned, but the TPMS mirror is blank or
  // holds a different tech. If the LIVE by-truck read agrees with Holman, the flag
  // was a stale-mirror false positive that Phase 1 eliminates.
  const flagged = results.filter(
    (r) => r.holmanLdap !== "" && (r.mirrorLdap === "" || r.mirrorLdap !== r.holmanLdap)
  );
  const resolved = flagged.filter((r) => r.outcome === "live" && r.live!.ldapId === r.holmanLdap);
  const flaggedLiveDifferent = flagged.filter(
    (r) => r.outcome === "live" && r.live!.ldapId !== r.holmanLdap
  );
  const flaggedLiveEmpty = flagged.filter((r) => r.outcome === "empty");
  const flaggedErrors = flagged.filter((r) => r.outcome === "error");

  // Sanity view: live read agrees with the mirror (mirror was already right).
  const liveMatchesMirror = results.filter(
    (r) => r.outcome === "live" && r.mirrorLdap !== "" && r.live!.ldapId === r.mirrorLdap
  );

  console.log("");
  console.log(`==== TRUCK-DRIVEN REFRESH ${mode} ====`);
  console.log(fmtCount("trucks scanned", total));
  console.log(fmtCount("live tech returned", live.length));
  console.log(fmtCount("empty in TPMS (400 / no data)", empty.length));
  console.log(fmtCount("hard errors (kept going)", errors.length));
  console.log("");
  console.log(`  Phase 1 bucket: Holman assigned, TPMS mirror blank or different`);
  console.log(fmtCount("flagged trucks in bucket", flagged.length));
  console.log(fmtCount("NOW MATCH Holman when read live by truck", resolved.length));
  console.log(fmtCount("live tech differs from Holman (real mismatch)", flaggedLiveDifferent.length));
  console.log(fmtCount("live read empty (Holman-side stale)", flaggedLiveEmpty.length));
  console.log(fmtCount("errors in bucket", flaggedErrors.length));
  console.log("");
  console.log(fmtCount("live read agrees with mirror (mirror correct)", liveMatchesMirror.length));

  if (resolved.length > 0) {
    console.log("");
    console.log(`  sample RESOLVED rows (stale-mirror false positives, first ${Math.min(10, resolved.length)} of ${resolved.length}):`);
    for (const r of resolved.slice(0, 10)) {
      const name = [r.live!.firstName, r.live!.lastName].filter(Boolean).join(" ") || "(no name)";
      console.log(
        `    truck ${r.truckRef}  live=${r.live!.ldapId} (${name})  holman=${r.holmanLdap}  mirror=${r.mirrorLdap || "(blank)"}`
      );
    }
  }
  if (errors.length > 0) {
    console.log("");
    console.log(`  error samples (first ${Math.min(5, errors.length)} of ${errors.length}):`);
    for (const r of errors.slice(0, 5)) {
      console.log(`    truck ${r.truckRef || r.truckRaw}: ${r.errorMessage}`);
    }
  }
  console.log("");
}

async function applyResults(pool: Pool, results: ScanResult[]): Promise<void> {
  const client = await pool.connect();
  let lastKnownLive = 0;
  let lastKnownBlank = 0;
  let profileUpdates = 0;
  try {
    await client.query("BEGIN");
    for (const r of results) {
      if (!r.truckRef) continue;
      if (r.outcome === "live" && r.live) {
        await client.query(LAST_KNOWN_UPSERT_SQL, [
          r.truckRef, r.live.ldapId, r.live.techId, r.live.firstName, r.live.lastName,
          r.live.districtNo, r.live.contactNo, r.live.email,
        ]);
        lastKnownLive++;
        const profTruck = padProfileTruck(r.live.truckNo ?? r.truckRef);
        const upd = await client.query(PROFILE_UPDATE_SQL, [
          r.live.ldapId, profTruck, r.live.districtNo, r.live.firstName, r.live.lastName,
        ]);
        profileUpdates += upd.rowCount ?? 0;
      } else if (r.outcome === "empty") {
        await client.query(LAST_KNOWN_BLANK_SQL, [r.truckRef]);
        lastKnownBlank++;
      }
      // hard errors write NOTHING: an outage must never blank a truck
    }
    await client.query("COMMIT");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
      console.error("[truck-refresh] APPLY ERROR: transaction rolled back, nothing was written.");
    } catch (rbErr) {
      console.error("[truck-refresh] ROLLBACK also failed:", rbErr);
    }
    throw err;
  } finally {
    client.release();
  }
  console.log(
    `[truck-refresh] APPLY COMMITTED: last_known live upserts=${lastKnownLive}, blank records=${lastKnownBlank}, profile updates=${profileUpdates}`
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const useAll = args.includes("--all");
  const limitArg = getArgValue(args, "--limit=");
  const limit = limitArg !== null ? Math.max(1, parseInt(limitArg, 10) || 0) : null;
  const mismatchDb = getArgValue(args, "--mismatch-db=") ?? "dev";

  if (mismatchDb !== "dev" && mismatchDb !== "prod") {
    throw new Error(`--mismatch-db must be "dev" or "prod", got "${mismatchDb}".`);
  }
  if (apply && mismatchDb === "prod") {
    throw new Error("--apply with --mismatch-db=prod is refused: prod is SELECT-only verification sourcing.");
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set. Refusing to guess a database.");
  if (mismatchDb === "prod" && !process.env.PROD_DATABASE_URL) {
    throw new Error("--mismatch-db=prod requires PROD_DATABASE_URL.");
  }

  // Write pool is ALWAYS the dev DATABASE_URL. The prod pool, when used, issues a
  // single SELECT to source the cohort list and nothing else.
  const devPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  const sourcePool =
    mismatchDb === "prod"
      ? new Pool({ connectionString: process.env.PROD_DATABASE_URL, max: 1 })
      : devPool;

  let exitCode = 0;
  try {
    console.log(
      `[truck-refresh] cohort=${useAll ? "ALL active Holman trucks" : "board-mismatch set"} source=${mismatchDb} mode=${apply ? "APPLY" : "DRY RUN"}${limit !== null ? ` limit=${limit}` : ""}`
    );
    const cohort = await loadCohort(sourcePool, useAll, limit);
    console.log(`[truck-refresh] cohort loaded: ${cohort.length} trucks. Scanning TPMS live by truck (sequential)...`);
    const results = await scanTrucks(cohort);
    printReport(results, apply ? "APPLY (scan)" : "DRY RUN (no writes)");
    if (apply) {
      await applyResults(devPool, results);
    } else {
      console.log("[truck-refresh] dry run complete - nothing was written. Re-run with --apply to write dev caches.");
    }
  } catch (err) {
    exitCode = 1;
    throw err;
  } finally {
    if (sourcePool !== devPool) await sourcePool.end();
    await devPool.end();
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error("[truck-refresh] FATAL:", err instanceof Error ? err.message : err);
  process.exit(1);
});
