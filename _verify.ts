#!/usr/bin/env npx tsx
/**
 * READ-ONLY verification of the flag fix. Reproduces computeOpenRentalEidSet's
 * NEW behavior (no OOS drop) but calls the REAL edited rentalEnrichEnterpriseIds
 * (which now has the truck-number fallback + snapshot byTruck index). Confirms
 * the badge grows from 316 and the recovered techs are present. Deleted after.
 */
import {
  rentalEnrichEnterpriseIds, RENTAL_TICKET_TABLE, RENTAL_OPEN_TABLE, ticketDateFilter, openDateFilter,
} from "./server/external-fleet-api/rental-ops-read-model";

const normV = (v: string) => (v || "").trim().replace(/^0+/, "");
const isEntVendor = (v: any) => { const s = String(v || "").trim(); return !s || /enterprise/i.test(s) || /toll/i.test(s); };

async function main() {
  const { initializeSnowflakeService, isSnowflakeConfigured, getSnowflakeService } = await import("./server/snowflake-service");
  let privateKey = process.env.SNOWFLAKE_PRIVATE_KEY;
  if (!privateKey) { try { const { loadKeyFromFile } = await import("./server/snowflake-key-loader"); privateKey = loadKeyFromFile() ?? undefined; } catch {} }
  initializeSnowflakeService({
    account: process.env.SNOWFLAKE_ACCOUNT!, username: process.env.SNOWFLAKE_USER!, privateKey: privateKey!,
    database: process.env.SNOWFLAKE_DATABASE, schema: process.env.SNOWFLAKE_SCHEMA,
    warehouse: process.env.SNOWFLAKE_WAREHOUSE, role: process.env.SNOWFLAKE_ROLE,
  } as any);
  if (!isSnowflakeConfigured()) throw new Error("Snowflake not configured");
  const sf = getSnowflakeService(); await sf.connect();
  const sfq = (q: string) => sf.executeQuery(q) as Promise<any[]>;

  const [ticketRows, holmanRows] = await Promise.all([
    sfq(`SELECT VEHICLE_NUMBER, RENTER_NAME, RENTAL_START_DATE FROM ${RENTAL_TICKET_TABLE} WHERE ${ticketDateFilter()} AND TICKET_STATUS='OPEN' LIMIT 5000`),
    sfq(`SELECT VEHICLE_NUMBER, ENTERPRISE_ID, RENTAL_VENDOR FROM ${RENTAL_OPEN_TABLE} WHERE ${openDateFilter()} LIMIT 5000`),
  ]);

  const entByVehicle = new Map<string, any>();
  for (const r of ticketRows) {
    const vn = normV(r.VEHICLE_NUMBER || ""); if (!vn) continue;
    const ex = entByVehicle.get(vn);
    const rD = new Date(r.RENTAL_START_DATE || "2000-01-01").getTime();
    const eD = ex ? new Date(ex.RENTAL_START_DATE || "2000-01-01").getTime() : 0;
    if (!ex || rD > eD) entByVehicle.set(vn, r);
  }
  // NEW behavior: NO OOS drop
  const enrichRows: any[] = Array.from(entByVehicle.values()).map((r) => ({
    renterName: (r.RENTER_NAME || "").trim(), vehicleNumber: r.VEHICLE_NUMBER, enterpriseId: null, source: "enterprise",
  }));
  await rentalEnrichEnterpriseIds(sf, enrichRows);

  const bySource: any = {};
  const entIds = new Set<string>();
  for (const row of enrichRows) {
    bySource[row.enterpriseIdSource || "resolved?"] = (bySource[row.enterpriseIdSource || "resolved?"] || 0) + 1;
    if (row.enterpriseId) entIds.add(String(row.enterpriseId).trim().toUpperCase());
  }
  const holEids = new Set<string>();
  for (const r of holmanRows) {
    if (isEntVendor(r.RENTAL_VENDOR)) continue;
    if (entByVehicle.has(normV(r.VEHICLE_NUMBER || ""))) continue;
    const eid = String(r.ENTERPRISE_ID || "").trim().toUpperCase(); if (eid) holEids.add(eid);
  }
  const badge = new Set<string>([...Array.from(entIds), ...Array.from(holEids)]);

  const truckRecovered = enrichRows.filter((r) => r.enterpriseIdSource === "truck_number").map((r) => r.enterpriseId);
  const check = ["TMAJOR0", "DEVANS", "JDICKE0", "RCERVAN", "EKELLY", "KGRIFF0", "JCOLEM0", "EPALME1"];
  console.log("ENT open (deduped):", entByVehicle.size);
  console.log("enrich source breakdown:", JSON.stringify(bySource));
  console.log("ENT resolved EIDs:", entIds.size, " Holman direct:", holEids.size);
  console.log("NEW badge total EIDs:", badge.size, " (was 316)");
  console.log("truck_number recoveries:", truckRecovered.length, truckRecovered.slice(0, 30).join(","));
  console.log("spot-check present in badge:", check.map((e) => `${e}=${badge.has(e)}`).join("  "));
  process.exit(0);
}
main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
