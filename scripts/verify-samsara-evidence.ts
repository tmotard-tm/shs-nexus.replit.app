/**
 * Dev verification for the Samsara evidence collector (Task #759).
 *
 * Exercises each verdict path against REAL trucks:
 *   1. a truck with maintenance DTCs (expect corroborated)
 *   2. a clean, reporting truck (expect no_supporting_data — or corroborated
 *      if it happens to have live faults today)
 *   3. a BYOV 88-prefix number (expect not_applicable, zero lookups)
 *   4. an unknown truck (expect not_applicable — no device registered)
 *   5. accident category on a real truck (expect no_supporting_data or
 *      corroborated depending on recent safety events)
 *
 * Run the "unreachable" path separately with the env vars unset:
 *   env -u SAMSARA_API_TOKEN -u SNOWFLAKE_ACCOUNT npx tsx scripts/verify-samsara-evidence.ts 23132
 */
import { collectSamsaraEvidence } from "../server/vrm/forms/samsara-evidence";
import { getSamsaraService } from "../server/samsara-service";

const brief = (snap: any) => ({
  verdict: snap.verdict,
  reason: snap.verdictReason,
  vehicle: snap.vehicle?.samsaraName ?? null,
  sources: Object.fromEntries(Object.entries(snap.sources).map(([k, v]: any) => [k, v.status])),
  faults: snap.faultCodes.length,
  dtcs: snap.maintenanceDtcs.length,
  safety: snap.safetyEvents.length,
  lastSignalAgeHours: snap.lastSignalAgeHours == null ? null : Math.round(snap.lastSignalAgeHours * 10) / 10,
  gps: snap.location ? `${snap.location.address ?? "no addr"} @ ${snap.location.time}` : null,
});

async function main() {
  const arg = process.argv[2];
  if (arg) {
    // Single-truck mode (used for the unreachable-env run).
    const snap = await collectSamsaraEvidence({ truckNumber: arg, category: "breakdown", occurredAt: null });
    console.log(JSON.stringify(brief(snap), null, 2));
    return;
  }

  const samsara = getSamsaraService();
  const { getSnowflakeService } = await import("../server/snowflake-service");
  const sf = getSnowflakeService();

  // Find a truck with RECENT DTC history: maintenance keys by MAINT_ID
  // (= Samsara vehicle id), joined to the newest vehicle snapshot.
  const dtcTrucks = await sf.executeQuery(`
    SELECT DISTINCT v.TRUCK_NUMBER
    FROM bi_analytics.app_samsara.SAMSARA_MAINTENANCE m
    JOIN (SELECT VEHICLE_ID, TRUCK_NUMBER FROM bi_analytics.app_samsara.SAMSARA_VEHICLES
          QUALIFY ROW_NUMBER() OVER (PARTITION BY VEHICLE_ID ORDER BY LOAD_TS_UTC DESC) = 1) v
      ON v.VEHICLE_ID = m.MAINT_ID
    WHERE m.DTC_DESCRIPTION IS NOT NULL
      AND m.LOAD_TS_UTC >= DATEADD(day, -7, CURRENT_TIMESTAMP())
      AND v.TRUCK_NUMBER IS NOT NULL
    LIMIT 3
  `);
  const withDtc = dtcTrucks[0]?.TRUCK_NUMBER ?? null;
  console.log("== 1. truck with recent maintenance DTCs:", withDtc ?? "(none found)");
  if (withDtc) {
    const snap = await collectSamsaraEvidence({
      truckNumber: String(withDtc), category: "breakdown", occurredAt: null,
    });
    console.log(JSON.stringify(brief(snap), null, 2));
  }

  // A clean truck: known-good from the earlier probe (adjust if it decays).
  const vehicles = await samsara.getVehicles();
  const dirtySet = new Set(dtcTrucks.map((r: any) => String(r.TRUCK_NUMBER)));
  const clean = vehicles.find((v: any) => v.TRUCK_NUMBER && !dirtySet.has(String(v.TRUCK_NUMBER)));
  console.log("\n== 2. clean truck:", clean?.TRUCK_NUMBER ?? "(none)");
  if (clean) {
    const snap = await collectSamsaraEvidence({
      truckNumber: String(clean.TRUCK_NUMBER), category: "breakdown", occurredAt: null,
    });
    console.log(JSON.stringify(brief(snap), null, 2));
  }

  // BYOV — 5-digit 88 prefix, the historical trap.
  console.log("\n== 3. BYOV 88144:");
  console.log(JSON.stringify(brief(await collectSamsaraEvidence({
    truckNumber: "88144", category: "breakdown", occurredAt: null,
  })), null, 2));

  // Unknown truck.
  console.log("\n== 4. unknown truck 999999:");
  console.log(JSON.stringify(brief(await collectSamsaraEvidence({
    truckNumber: "999999", category: "breakdown", occurredAt: null,
  })), null, 2));

  // Accident category on the clean truck, reported occurred_at = now.
  if (clean) {
    console.log("\n== 5. accident category on", clean.TRUCK_NUMBER, ":");
    console.log(JSON.stringify(brief(await collectSamsaraEvidence({
      truckNumber: String(clean.TRUCK_NUMBER), category: "accident", occurredAt: new Date().toISOString(),
    })), null, 2));
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("VERIFY FAILED:", e); process.exit(1); });
