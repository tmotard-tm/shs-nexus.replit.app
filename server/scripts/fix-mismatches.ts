/**
 * Batch mismatch resolution script.
 * Processes all fleet vehicles where Holman assignment != TPMS assignment.
 * For each: checks live TPMS API → assigns or unassigns to bring systems in sync.
 * Run: npx tsx server/scripts/fix-mismatches.ts
 */
import { db } from "../db";
import { sql } from "drizzle-orm";
import { getTPMSService } from "../tpms-service";
import { fleetOpsService } from "../fleet-operations-service";
import { toCanonical, toTpmsRef } from "../vehicle-number-utils";

const REQUESTED_BY = "SYSFIX";
const DELAY_MS = 300;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface VehicleWork {
  truck: string;
  holmanId: string;
  holmanName: string;
  tpmsId: string;
  tpmsName: string;
  action: "assign" | "unassign" | "skip";
  districtNo: string;
}

interface Result {
  truck: string;
  action: string;
  techId: string;
  tpmsStatus: string;
  holmanStatus: string;
  amsStatus: string;
  overallSuccess: boolean;
  partialSuccess: boolean;
  durationMs: number;
  error?: string;
  notes?: string;
}

async function getDistrictForTech(racfId: string): Promise<string> {
  try {
    const result = await db.execute(sql`
      SELECT district_no FROM all_techs
      WHERE LOWER(tech_racfid) = ${racfId.toLowerCase()}
      LIMIT 1
    `);
    const rows = (result as any).rows ?? result as any[];
    return rows[0]?.district_no ?? "0";
  } catch {
    return "0";
  }
}

async function main() {
  console.log("=".repeat(70));
  console.log("FLEET ASSIGNMENT MISMATCH RESOLUTION");
  console.log("=".repeat(70));
  console.log(`Started: ${new Date().toISOString()}\n`);

  const tpmsService = getTPMSService();
  if (!tpmsService.isConfigured()) {
    console.error("TPMS service not configured. Aborting.");
    process.exit(1);
  }

  // ── Step 1: Get all mismatched vehicles from DB ────────────────────────────
  console.log("Step 1: Loading mismatched vehicles from DB...");

  const rawVehicles = await db.execute(sql`
    WITH tpms_latest AS (
      SELECT DISTINCT ON (truck_no)
        LTRIM(truck_no, '0') AS canonical_truck,
        enterprise_id AS tpms_id,
        TRIM(first_name || ' ' || last_name) AS tpms_name,
        status AS tpms_status
      FROM tpms_cached_assignments
      WHERE truck_no IS NOT NULL AND truck_no != ''
      ORDER BY truck_no, last_success_at DESC
    )
    SELECT
      h.holman_vehicle_number AS truck,
      COALESCE(h.holman_tech_assigned,'') AS holman_id,
      COALESCE(h.holman_tech_name,'') AS holman_name,
      COALESCE(t.tpms_id,'') AS tpms_id,
      COALESCE(t.tpms_name,'') AS tpms_name,
      COALESCE(t.tpms_status,'not_cached') AS tpms_status
    FROM holman_vehicles_cache h
    LEFT JOIN tpms_latest t ON t.canonical_truck = h.holman_vehicle_number
    WHERE h.is_active = true
      AND (h.status_code != 2 OR h.status_code IS NULL)
      AND h.out_of_service_date IS NULL
      AND h.holman_tech_assigned IS NOT NULL
      AND h.holman_tech_assigned != ''
      AND h.holman_tech_assigned != 'tbt'
      AND (
        (t.tpms_id IS NOT NULL AND t.tpms_id != '' AND LOWER(h.holman_tech_assigned) != LOWER(t.tpms_id))
        OR (t.tpms_id IS NULL OR t.tpms_id = '')
      )
    ORDER BY h.holman_vehicle_number
  `);

  const dbVehicles = ((rawVehicles as any).rows ?? rawVehicles as any[]).map((r: any) => ({
    truck: String(r.truck ?? ""),
    holmanId: String(r.holman_id ?? ""),
    holmanName: String(r.holman_name ?? ""),
    tpmsId: String(r.tpms_id ?? ""),
    tpmsName: String(r.tpms_name ?? ""),
    tpmsStatus: String(r.tpms_status ?? "not_cached"),
  }));

  console.log(`  Found ${dbVehicles.length} mismatched vehicles in DB\n`);

  // ── Step 2: Batch TPMS live lookup for not-cached trucks ──────────────────
  const notCached = dbVehicles.filter(v => !v.tpmsId);
  const hasCachedTpms = dbVehicles.filter(v => !!v.tpmsId);

  console.log(`Step 2: Batch TPMS live lookup for ${notCached.length} not-cached trucks...`);
  console.log(`  (${hasCachedTpms.length} already have TPMS cache data)\n`);

  const truckVariations: string[] = [];
  for (const v of notCached) {
    const canonical = toCanonical(v.truck);
    const padded = canonical ? toTpmsRef(canonical) : null;
    if (canonical) truckVariations.push(canonical);
    if (padded && padded !== canonical) truckVariations.push(padded);
  }

  const tpmsLiveMap = await tpmsService.batchLookupByTruckNumbers(truckVariations);
  console.log(`  TPMS live lookup returned ${tpmsLiveMap.size} cache entries\n`);

  // ── Step 3: Build work queue ───────────────────────────────────────────────
  console.log("Step 3: Building work queue...");
  const workQueue: VehicleWork[] = [];

  // Vehicles with cached TPMS showing a different tech → ASSIGN the TPMS tech
  for (const v of hasCachedTpms) {
    const districtNo = await getDistrictForTech(v.tpmsId);
    workQueue.push({
      truck: v.truck,
      holmanId: v.holmanId,
      holmanName: v.holmanName,
      tpmsId: v.tpmsId,
      tpmsName: v.tpmsName,
      action: "assign",
      districtNo,
    });
  }

  // Vehicles not in TPMS cache → resolve via live lookup
  for (const v of notCached) {
    const canonical = toCanonical(v.truck);
    const padded = canonical ? toTpmsRef(canonical) : null;

    let liveEntry: any = null;
    if (padded) liveEntry = tpmsLiveMap.get(padded);
    if (!liveEntry && canonical) liveEntry = tpmsLiveMap.get(canonical);

    if (liveEntry?.techInfo?.ldapId) {
      const liveId = String(liveEntry.techInfo.ldapId);
      if (liveId.toLowerCase() === v.holmanId.toLowerCase()) {
        workQueue.push({ truck: v.truck, holmanId: v.holmanId, holmanName: v.holmanName, tpmsId: liveId, tpmsName: "", action: "skip", districtNo: "" });
      } else {
        const districtNo = await getDistrictForTech(liveId);
        const techName = liveEntry.techInfo.firstName
          ? `${liveEntry.techInfo.firstName} ${liveEntry.techInfo.lastName || ""}`.trim()
          : liveId;
        workQueue.push({ truck: v.truck, holmanId: v.holmanId, holmanName: v.holmanName, tpmsId: liveId, tpmsName: techName, action: "assign", districtNo });
      }
    } else {
      // TPMS has no record for this truck → UNASSIGN from Holman
      workQueue.push({ truck: v.truck, holmanId: v.holmanId, holmanName: v.holmanName, tpmsId: "", tpmsName: "", action: "unassign", districtNo: "" });
    }
  }

  const assigns = workQueue.filter(w => w.action === "assign");
  const unassigns = workQueue.filter(w => w.action === "unassign");
  const skips = workQueue.filter(w => w.action === "skip");
  console.log(`  ASSIGN:   ${assigns.length} vehicles (TPMS has a tech)`);
  console.log(`  UNASSIGN: ${unassigns.length} vehicles (TPMS has no tech)`);
  console.log(`  SKIP:     ${skips.length} vehicles (already in sync, no-op)\n`);

  // ── Step 4: Execute ────────────────────────────────────────────────────────
  console.log("Step 4: Executing operations...\n");
  console.log("-".repeat(70));

  const results: Result[] = [];
  let successCount = 0;
  let partialCount = 0;
  let failCount = 0;
  let skipCount = skips.length;

  const toProcess = workQueue.filter(w => w.action !== "skip");

  for (let i = 0; i < toProcess.length; i++) {
    const item = toProcess[i];
    const startMs = Date.now();
    const idx = `[${String(i + 1).padStart(3)}/${toProcess.length}]`;

    try {
      if (item.action === "assign") {
        process.stdout.write(`${idx} ASSIGN  Truck ${item.truck} → ${item.tpmsId} (${item.tpmsName}) [was: ${item.holmanId}] ... `);

        const opResult = await fleetOpsService.assignTech({
          truckNumber: item.truck,
          ldapId: item.tpmsId,
          districtNo: item.districtNo || "0",
          techName: item.tpmsName || item.tpmsId,
          requestedBy: REQUESTED_BY,
          notes: `Mismatch fix: Holman had ${item.holmanId}, TPMS has ${item.tpmsId}`,
        });

        const duration = Date.now() - startMs;
        const t = opResult.tpms.status;
        const h = opResult.holman.status;
        const a = opResult.ams.status;
        const flag = opResult.overallSuccess ? "✓" : opResult.partialSuccess ? "⚠" : "✗";

        console.log(`${flag} ${duration}ms TPMS:${t} Holman:${h} AMS:${a}`);
        if (!opResult.overallSuccess && !opResult.partialSuccess) {
          console.log(`  ✗ FAILED: TPMS=${opResult.tpms.message || ""} Holman=${opResult.holman.message || ""}`);
        }

        if (opResult.overallSuccess) successCount++;
        else if (opResult.partialSuccess) partialCount++;
        else failCount++;

        results.push({ truck: item.truck, action: "assign", techId: item.tpmsId, tpmsStatus: t, holmanStatus: h, amsStatus: a, overallSuccess: opResult.overallSuccess, partialSuccess: opResult.partialSuccess, durationMs: duration });

      } else {
        process.stdout.write(`${idx} UNASSIGN Truck ${item.truck} ← ${item.holmanId} (${item.holmanName}) ... `);

        const opResult = await fleetOpsService.unassignTech({
          truckNumber: item.truck,
          ldapId: item.holmanId,
          requestedBy: REQUESTED_BY,
          notes: `Mismatch fix: Holman had ${item.holmanId}, TPMS has no assignment`,
        });

        const duration = Date.now() - startMs;
        const t = opResult.tpms.status;
        const h = opResult.holman.status;
        const a = opResult.ams.status;
        const flag = opResult.overallSuccess ? "✓" : opResult.partialSuccess ? "⚠" : "✗";

        console.log(`${flag} ${duration}ms TPMS:${t} Holman:${h} AMS:${a}`);
        if (!opResult.overallSuccess && !opResult.partialSuccess) {
          console.log(`  ✗ FAILED: TPMS=${opResult.tpms.message || ""} Holman=${opResult.holman.message || ""}`);
        }

        if (opResult.overallSuccess) successCount++;
        else if (opResult.partialSuccess) partialCount++;
        else failCount++;

        results.push({ truck: item.truck, action: "unassign", techId: item.holmanId, tpmsStatus: t, holmanStatus: h, amsStatus: a, overallSuccess: opResult.overallSuccess, partialSuccess: opResult.partialSuccess, durationMs: duration });
      }
    } catch (err: any) {
      const duration = Date.now() - startMs;
      console.log(`✗ ERROR ${duration}ms: ${err.message}`);
      failCount++;
      results.push({ truck: item.truck, action: item.action, techId: item.tpmsId || item.holmanId, tpmsStatus: "error", holmanStatus: "error", amsStatus: "error", overallSuccess: false, partialSuccess: false, durationMs: duration, error: err.message });
    }

    if (i < toProcess.length - 1) await sleep(DELAY_MS);
  }

  // ── Step 5: Summary ────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(70));
  console.log("SUMMARY");
  console.log("=".repeat(70));
  console.log(`Completed: ${new Date().toISOString()}`);
  console.log(`Total vehicles:  ${workQueue.length}`);
  console.log(`  Skipped:       ${skipCount} (already in sync)`);
  console.log(`  Processed:     ${toProcess.length}`);
  console.log(`    ✓ Success:   ${successCount}`);
  console.log(`    ⚠ Partial:   ${partialCount}`);
  console.log(`    ✗ Failed:    ${failCount}`);

  if (results.length > 0) {
    const durations = results.map(r => r.durationMs);
    const avg = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
    const min = Math.min(...durations);
    const max = Math.max(...durations);
    console.log(`\nOperation timing (per vehicle):`);
    console.log(`  Average: ${avg}ms`);
    console.log(`  Min:     ${min}ms`);
    console.log(`  Max:     ${max}ms`);

    // Card refresh impact: Holman returns 202 (pending) so user sees stale data for 5-min staleTime
    const holmanPending = results.filter(r => r.holmanStatus === "pending").length;
    const holmanSuccess = results.filter(r => r.holmanStatus === "success").length;
    if (holmanPending > 0) {
      console.log(`\nCard refresh notes:`);
      console.log(`  ${holmanPending} vehicles returned Holman status=pending (202 Accepted)`);
      console.log(`  These cards update optimistically via setQueryData immediately.`);
      console.log(`  Holman processes async — true sync visible after next fleet sync cycle.`);
    }
  }

  const tpmsSkipped = results.filter(r => r.tpmsStatus === "skipped");
  const tpmsFailed = results.filter(r => r.tpmsStatus === "failed" || r.tpmsStatus === "error");
  const holmanFailed = results.filter(r => r.holmanStatus === "failed" || r.holmanStatus === "error");
  const amsFailed = results.filter(r => r.amsStatus === "failed" || r.amsStatus === "error");

  console.log(`\nSystem breakdown:`);
  console.log(`  TPMS   — failed: ${tpmsFailed.length}, skipped (not in TPMS): ${tpmsSkipped.length}`);
  console.log(`  Holman — failed: ${holmanFailed.length}`);
  console.log(`  AMS    — failed: ${amsFailed.length}`);

  if (tpmsFailed.length > 0) {
    console.log(`\nTPMS failures:`);
    tpmsFailed.slice(0, 20).forEach(r => console.log(`  Truck ${r.truck} [${r.action} ${r.techId}]${r.error ? " ERR:"+r.error : ""}`));
  }
  if (holmanFailed.length > 0) {
    console.log(`\nHolman failures:`);
    holmanFailed.slice(0, 20).forEach(r => console.log(`  Truck ${r.truck} [${r.action} ${r.techId}]`));
  }

  const allFailed = results.filter(r => !r.overallSuccess && !r.partialSuccess);
  if (allFailed.length > 0) {
    console.log(`\nFully failed (${allFailed.length}):`);
    allFailed.forEach(r => console.log(`  Truck ${r.truck} [${r.action}] tech=${r.techId}: TPMS=${r.tpmsStatus} Holman=${r.holmanStatus} AMS=${r.amsStatus}${r.error ? " ERR:"+r.error : ""}`));
  }

  console.log("\nDone.");
  process.exit(0);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
