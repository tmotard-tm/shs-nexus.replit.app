#!/usr/bin/env npx tsx
/** READ-ONLY. Does HOLMAN_OPEN_RENTAL_REPORT carry closed PO lines? */
import { RENTAL_OPEN_TABLE, RENTAL_TICKET_TABLE, openDateFilter, ticketDateFilter } from "./server/external-fleet-api/rental-ops-read-model";
const normV = (v: string) => (v || "").trim().replace(/^0+/, "");
const U = (s: any) => String(s || "").trim().toUpperCase();

async function main() {
  const { initializeSnowflakeService, isSnowflakeConfigured, getSnowflakeService } = await import("./server/snowflake-service");
  let pk = process.env.SNOWFLAKE_PRIVATE_KEY;
  if (!pk) { try { const { loadKeyFromFile } = await import("./server/snowflake-key-loader"); pk = loadKeyFromFile() ?? undefined; } catch {} }
  initializeSnowflakeService({ account: process.env.SNOWFLAKE_ACCOUNT!, username: process.env.SNOWFLAKE_USER!, privateKey: pk!, database: process.env.SNOWFLAKE_DATABASE, schema: process.env.SNOWFLAKE_SCHEMA, warehouse: process.env.SNOWFLAKE_WAREHOUSE, role: process.env.SNOWFLAKE_ROLE } as any);
  if (!isSnowflakeConfigured()) throw new Error("SF not configured");
  const sf = getSnowflakeService(); await sf.connect();
  const sfq = (q: string) => sf.executeQuery(q) as Promise<any[]>;

  console.log("=== STATUS_DESCRIPTION distribution (all vendors) ===");
  for (const r of await sfq(`SELECT STATUS_DESCRIPTION, COUNT(*) AS N, COUNT(DISTINCT ENTERPRISE_ID) AS TECHS FROM ${RENTAL_OPEN_TABLE} WHERE ${openDateFilter()} GROUP BY STATUS_DESCRIPTION ORDER BY N DESC`))
    console.log(`  ${String(r.STATUS_DESCRIPTION || "(null)").padEnd(28)} rows=${r.N}  distinctTechs=${r.TECHS}`);

  console.log("\n=== Enterprise-vendor rows only, by status ===");
  for (const r of await sfq(`SELECT STATUS_DESCRIPTION, COUNT(*) AS N, COUNT(DISTINCT ENTERPRISE_ID) AS TECHS, MIN(PO_DATE) AS OLDEST, MAX(PO_DATE) AS NEWEST FROM ${RENTAL_OPEN_TABLE} WHERE ${openDateFilter()} AND UPPER(RENTAL_VENDOR) LIKE '%ENTERPRISE RENT%' GROUP BY STATUS_DESCRIPTION ORDER BY N DESC`))
    console.log(`  ${String(r.STATUS_DESCRIPTION || "(null)").padEnd(28)} rows=${r.N} techs=${r.TECHS} po ${String(r.OLDEST||"").slice(0,10)} -> ${String(r.NEWEST||"").slice(0,10)}`);

  // For techs NOT covered by an ENT open/pended ticket, what statuses do they have?
  const ent = await sfq(`SELECT VEHICLE_NUMBER FROM ${RENTAL_TICKET_TABLE} WHERE ${ticketDateFilter()} AND TICKET_STATUS IN ('OPEN','PENDED') LIMIT 5000`);
  const entVeh = new Set(ent.map((r) => normV(r.VEHICLE_NUMBER || "")));
  const hol = await sfq(`SELECT VEHICLE_NUMBER, ENTERPRISE_ID, STATUS_DESCRIPTION, PO_DATE, DAILY_RATE, NO_OF_DAYS FROM ${RENTAL_OPEN_TABLE} WHERE ${openDateFilter()} AND UPPER(RENTAL_VENDOR) LIKE '%ENTERPRISE RENT%' LIMIT 5000`);
  const uncovered = hol.filter((r) => !entVeh.has(normV(r.VEHICLE_NUMBER || "")));
  const byStatus: any = {}; const techsByStatus: Record<string, Set<string>> = {};
  for (const r of uncovered) {
    const s = U(r.STATUS_DESCRIPTION) || "(null)";
    byStatus[s] = (byStatus[s] || 0) + 1;
    (techsByStatus[s] ||= new Set()).add(U(r.ENTERPRISE_ID));
  }
  console.log("\n=== Enterprise-vendor rows NOT covered by an ENT ticket, by status ===");
  for (const [s, n] of Object.entries(byStatus).sort((a: any, b: any) => b[1] - a[1]))
    console.log(`  ${s.padEnd(28)} rows=${n}  distinctTechs=${techsByStatus[s].size}`);

  console.log("\n=== sample uncovered rows (newest PO first) ===");
  for (const r of uncovered.sort((a, b) => String(b.PO_DATE || "").localeCompare(String(a.PO_DATE || ""))).slice(0, 15))
    console.log(`  veh=${r.VEHICLE_NUMBER} eid=${r.ENTERPRISE_ID} status=${r.STATUS_DESCRIPTION} po=${String(r.PO_DATE||"").slice(0,10)} rate=${r.DAILY_RATE} days=${r.NO_OF_DAYS}`);
  process.exit(0);
}
main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
