import { getSnowflakeService, initializeSnowflakeService } from '../server/snowflake-service';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
import { AmsApiService } from '../server/ams-api-service';

async function main() {
  initializeSnowflakeService({
    account: process.env.SNOWFLAKE_ACCOUNT!,
    username: process.env.SNOWFLAKE_USER!,
    privateKey: process.env.SNOWFLAKE_PRIVATE_KEY!,
    database: process.env.SNOWFLAKE_DATABASE,
    schema: process.env.SNOWFLAKE_SCHEMA,
    warehouse: process.env.SNOWFLAKE_WAREHOUSE,
    role: process.env.SNOWFLAKE_ROLE,
  });
  const sf = getSnowflakeService();

  console.log('=== Diagnostic: AMS Declined Repair count discrepancy ===\n');

  const sfRows = (await sf.executeQuery(`
    SELECT
      VEHICLE_NUMBER,
      VIN,
      TRUCK_STATUS,
      TPMS_ASSIGNED
    FROM PARTS_SUPPLYCHAIN.FLEET.REPLIT_ALL_VEHICLES
    WHERE VIN IS NOT NULL
  `)) as Array<{ VEHICLE_NUMBER: string; VIN: string; TRUCK_STATUS: string | null; TPMS_ASSIGNED: string | null }>;

  console.log(`Snowflake REPLIT_ALL_VEHICLES total rows: ${sfRows.length}`);

  // Show distinct raw TRUCK_STATUS values so we can see if it's labels or numeric IDs
  const tsCounts = new Map<string, number>();
  for (const r of sfRows) {
    const k = (r.TRUCK_STATUS ?? '(null)').toString();
    tsCounts.set(k, (tsCounts.get(k) || 0) + 1);
  }
  console.log(`\nDistinct REPLIT_ALL_VEHICLES.TRUCK_STATUS values:`);
  for (const [k, v] of [...tsCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${v.toString().padStart(5)}  ${k}`);
  }

  // Pull the LABEL-RESOLVED status from ams_vehicles_cache (already maps IDs → labels)
  console.log(`\nPulling ams_vehicles_cache (already-resolved AMS labels)...`);
  const amsCacheRows = (await db.execute(sql`
    SELECT vin, ams_truck_status_label AS label
    FROM ams_vehicles_cache
    WHERE ams_truck_status_label IS NOT NULL
  `)) as any;
  const amsCacheList: Array<{ vin: string; label: string }> = amsCacheRows.rows ?? amsCacheRows;
  const labelByVin = new Map<string, string>();
  for (const r of amsCacheList) {
    if (!r.vin) continue;
    labelByVin.set(r.vin.trim().toUpperCase(), r.label);
  }
  console.log(`ams_vehicles_cache labeled rows: ${labelByVin.size}`);

  // Distinct labels (sample of "declined" ones)
  const labelCounts = new Map<string, number>();
  for (const lab of labelByVin.values()) {
    labelCounts.set(lab, (labelCounts.get(lab) || 0) + 1);
  }
  console.log(`\nAll AMS label distribution from ams_vehicles_cache (top 25):`);
  for (const [k, v] of [...labelCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    console.log(`  ${v.toString().padStart(5)}  ${k}`);
  }

  const normFleetId = (id: string | null | undefined) => {
    if (!id) return '';
    const digits = String(id).replace(/\D/g, '');
    return digits.replace(/^0+/, '') || '0';
  };

  const isDeclined = (s: string | null | undefined) =>
    !!s && s.toLowerCase().includes('declined repair');

  const isPrefixed088 = (vn: string) => {
    const raw = String(vn || '').trim();
    return raw.startsWith('088') || raw.startsWith('88');
  };

  const declinedAll = sfRows.filter((r) => isDeclined(r.TRUCK_STATUS));
  const declinedNon088 = declinedAll.filter((r) => !isPrefixed088(r.VEHICLE_NUMBER));
  const declinedOnly088 = declinedAll.filter((r) => isPrefixed088(r.VEHICLE_NUMBER));

  console.log(`\n[Snowflake AMS view] vehicles with TRUCK_STATUS containing 'declined repair':`);
  console.log(`  Total           : ${declinedAll.length}`);
  console.log(`  Prefix 088/88   : ${declinedOnly088.length}`);
  console.log(`  Excl. 088/88    : ${declinedNon088.length}`);

  const variants = new Map<string, number>();
  for (const r of declinedAll) {
    const k = (r.TRUCK_STATUS || '').trim();
    variants.set(k, (variants.get(k) || 0) + 1);
  }
  console.log(`\n  Status label variants:`);
  for (const [k, v] of [...variants.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${v.toString().padStart(5)}  ${k}`);
  }

  // Pull fs_trucks repair-shop entries
  const fsRows = (await db.execute(sql`
    SELECT truck_number, main_status, sub_status, vin
    FROM fs_trucks
  `)) as any;
  const fsList: Array<{ truck_number: string; main_status: string | null; sub_status: string | null; vin: string | null }> =
    fsRows.rows ?? fsRows;
  console.log(`\nfs_trucks total rows: ${fsList.length}`);

  const fsByTruckNum = new Map<string, { main_status: string | null; sub_status: string | null }>();
  for (const t of fsList) {
    const key = normFleetId(t.truck_number);
    if (key) fsByTruckNum.set(key, { main_status: t.main_status, sub_status: t.sub_status });
  }

  // How many AMS-declined vehicles are ALSO in fs_trucks (would have AMS Status hidden by override)
  let inFs = 0;
  let inFsWithDeclinedMain = 0;
  let inFsWithOtherMain = 0;
  const otherMainCounts = new Map<string, number>();
  for (const r of declinedAll) {
    const key = normFleetId(r.VEHICLE_NUMBER);
    const fs = fsByTruckNum.get(key);
    if (!fs) continue;
    inFs++;
    const ms = (fs.main_status || '').toLowerCase();
    if (ms.includes('declined')) inFsWithDeclinedMain++;
    else {
      inFsWithOtherMain++;
      const k = fs.main_status || '(null)';
      otherMainCounts.set(k, (otherMainCounts.get(k) || 0) + 1);
    }
  }

  console.log(`\n[Override impact] AMS-declined vehicles that ALSO sit in fs_trucks:`);
  console.log(`  Total in fs_trucks                   : ${inFs}`);
  console.log(`  ...with main_status ~ 'declined'     : ${inFsWithDeclinedMain}`);
  console.log(`  ...with a DIFFERENT main_status      : ${inFsWithOtherMain}`);
  if (otherMainCounts.size > 0) {
    console.log(`\n  Breakdown of "different main_status" overrides:`);
    for (const [k, v] of [...otherMainCounts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${v.toString().padStart(5)}  ${k}`);
    }
  }

  // Cross-check by calling AMS API directly
  console.log(`\n[Cross-check] Pulling live AMS API truck-status map directly...`);
  const ams = new AmsApiService();
  const lookupItems = await ams.getLookup('truck-status').catch((e) => {
    console.log(`  Lookup failed: ${e.message}`);
    return [] as any[];
  });
  const skipKeys = new Set(['UniqueID', 'uniqueID', 'Id', 'id']);
  const lookupMap = new Map<string, string>();
  for (const item of lookupItems as any[]) {
    const id = String(item.UniqueID ?? item.id ?? '');
    let label: string | undefined;
    for (const [k, v] of Object.entries(item)) {
      if (skipKeys.has(k)) continue;
      if (typeof v === 'string' && v.trim()) { label = v.trim(); break; }
    }
    if (id) lookupMap.set(id, label ?? id);
  }
  console.log(`  AMS truck-status lookup entries: ${lookupMap.size}`);
  const declinedIds = [...lookupMap.entries()].filter(([, lab]) => lab.toLowerCase().includes('declined repair'));
  console.log(`  AMS lookup IDs whose label contains 'declined repair':`);
  for (const [id, lab] of declinedIds) console.log(`    id=${id}  label="${lab}"`);

  const liveMap: Record<string, { vin: string; vehicleNumber: string | null; label: string | null }> = {};
  let offset = 0;
  const pageSize = 500;
  while (true) {
    let raw: any;
    try {
      raw = await ams.searchVehicles({ limit: pageSize, offset });
    } catch (e: any) {
      console.log(`  AMS searchVehicles error at offset ${offset}: ${e.message}`);
      break;
    }
    let rows: any[] = Array.isArray(raw) ? raw
      : (raw?.data ?? raw?.vehicles ?? raw?.results ?? raw?.items ?? []);
    if (!rows.length) break;
    for (const v of rows) {
      const vin = (v.VIN || v.vin || '').toString().trim().toUpperCase();
      if (!vin) continue;
      const rawStatus = v.TruckStatus ?? v.truckStatus ?? v.truck_status;
      const label = rawStatus == null ? null : (lookupMap.get(String(rawStatus)) ?? String(rawStatus));
      const vehicleNumber = (v.VehicleNumber ?? v.vehicleNumber ?? v.VehicleNo ?? v.Vehicle_Number ?? null);
      liveMap[vin] = { vin, vehicleNumber: vehicleNumber ? String(vehicleNumber) : null, label };
    }
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  const liveVins = Object.keys(liveMap);
  console.log(`  Live AMS API total vehicles: ${liveVins.length}`);
  const liveDeclined = liveVins.filter((v) => isDeclined(liveMap[v].label));
  console.log(`  Live AMS 'Declined Repair' total: ${liveDeclined.length}`);

  // Cross-reference: which of the live-AMS-declined vehicles are present in REPLIT_ALL_VEHICLES?
  const sfVinSet = new Set(sfRows.map((r) => (r.VIN || '').trim().toUpperCase()));
  const sfVehNumByVin = new Map<string, string>();
  for (const r of sfRows) sfVehNumByVin.set((r.VIN || '').trim().toUpperCase(), r.VEHICLE_NUMBER);

  const inSf = liveDeclined.filter((v) => sfVinSet.has(v));
  const notInSf = liveDeclined.filter((v) => !sfVinSet.has(v));
  console.log(`\n[Gap analysis] Of ${liveDeclined.length} AMS Declined Repair vehicles:`);
  console.log(`  In REPLIT_ALL_VEHICLES (visible in table): ${inSf.length}`);
  console.log(`  NOT in REPLIT_ALL_VEHICLES (invisible)   : ${notInSf.length}`);

  // Of the ones IN sf, how many have a fs_trucks override that would hide AMS status?
  let overridden = 0;
  let overriddenWith088 = 0;
  for (const vin of inSf) {
    const vn = sfVehNumByVin.get(vin) || '';
    const key = normFleetId(vn);
    const fs = fsByTruckNum.get(key);
    if (fs) {
      const ms = (fs.main_status || '').toLowerCase();
      if (!ms.includes('declined')) {
        overridden++;
        if (isPrefixed088(vn)) overriddenWith088++;
      }
    }
  }
  console.log(`  ...of those ${inSf.length} in-table, with fs_trucks override hiding 'Declined Repair': ${overridden} (incl. ${overriddenWith088} with 088/88 prefix)`);

  // Split the missing-from-SF group by 088/88
  const notInSfPrefix088 = notInSf.filter((v) => {
    const vn = liveMap[v].vehicleNumber || '';
    return isPrefixed088(vn);
  });
  console.log(`  Of the ${notInSf.length} missing from SF, prefix 088/88: ${notInSfPrefix088.length}`);

  // Show a few examples of each
  console.log(`\n  Sample of AMS-declined vehicles MISSING from REPLIT_ALL_VEHICLES (up to 10):`);
  for (const vin of notInSf.slice(0, 10)) {
    console.log(`    VIN=${vin}  vehicle#=${liveMap[vin].vehicleNumber}  label="${liveMap[vin].label}"`);
  }
  console.log(`\n  Sample of in-table AMS-declined vehicles that fs_trucks would override (up to 10):`);
  let shown = 0;
  for (const vin of inSf) {
    if (shown >= 10) break;
    const vn = sfVehNumByVin.get(vin) || '';
    const key = normFleetId(vn);
    const fs = fsByTruckNum.get(key);
    if (fs && !(fs.main_status || '').toLowerCase().includes('declined')) {
      console.log(`    VIN=${vin}  vehicle#=${vn}  AMS="${liveMap[vin].label}"  fs_trucks.main_status="${fs.main_status}"`);
      shown++;
    }
  }

  // Total vehicle count baseline (sanity check user's "~2060 after excluding 088/88")
  const totalNon088 = sfRows.filter((r) => !isPrefixed088(r.VEHICLE_NUMBER)).length;
  console.log(`\n[Baseline sanity check]`);
  console.log(`  REPLIT_ALL_VEHICLES total            : ${sfRows.length}`);
  console.log(`  REPLIT_ALL_VEHICLES excl. 088/88     : ${totalNon088}`);

  console.log('\n=== DONE ===');
  process.exit(0);
}

main().catch((e) => {
  console.error('Diagnostic failed:', e);
  process.exit(1);
});
