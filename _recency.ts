#!/usr/bin/env npx tsx
/** READ-ONLY. Are the uncovered Holman ent-vendor rentals current or stale? */
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

  const fileDate = (await sfq(`SELECT MAX(FILE_DATE) AS D FROM ${RENTAL_OPEN_TABLE}`))[0].D;
  const asOf = new Date(fileDate).getTime();
  console.log("Holman file date:", String(fileDate).slice(0, 15));

  const ent = await sfq(`SELECT VEHICLE_NUMBER FROM ${RENTAL_TICKET_TABLE} WHERE ${ticketDateFilter()} AND TICKET_STATUS IN ('OPEN','PENDED') LIMIT 5000`);
  const entVeh = new Set(ent.map((r) => normV(r.VEHICLE_NUMBER || "")));

  const hol = await sfq(`SELECT VEHICLE_NUMBER, ENTERPRISE_ID, PO_DATE, NO_OF_DAYS, DAILY_RATE FROM ${RENTAL_OPEN_TABLE} WHERE ${openDateFilter()} AND UPPER(RENTAL_VENDOR) LIKE '%ENTERPRISE RENT%' LIMIT 5000`);
  // latest PO line per vehicle
  const latest = new Map<string, any>();
  for (const r of hol) {
    const v = normV(r.VEHICLE_NUMBER || ""); if (!v) continue;
    const d = new Date(r.PO_DATE || "2000-01-01").getTime();
    const ex = latest.get(v);
    if (!ex || d > new Date(ex.PO_DATE || "2000-01-01").getTime()) latest.set(v, r);
  }
  const uncovered = Array.from(latest.entries()).filter(([v]) => !entVeh.has(v));
  console.log(`ent-vendor vehicles: ${latest.size}; uncovered by ENT ticket: ${uncovered.length}`);

  const buckets: Record<string, { n: number; techs: Set<string> }> = {};
  const add = (k: string, eid: string) => { (buckets[k] ||= { n: 0, techs: new Set() }); buckets[k].n++; if (eid) buckets[k].techs.add(eid); };
  for (const [, r] of uncovered) {
    const po = new Date(r.PO_DATE || "2000-01-01").getTime();
    const ageDays = Math.floor((asOf - po) / 86400000);
    const days = Number(r.NO_OF_DAYS || 0);
    const coveredThrough = ageDays - days; // >0 means PO period already elapsed
    const k = coveredThrough <= 0 ? "A. still within PO period"
      : coveredThrough <= 7 ? "B. lapsed <=7d"
      : coveredThrough <= 30 ? "C. lapsed 8-30d"
      : coveredThrough <= 90 ? "D. lapsed 31-90d" : "E. lapsed >90d";
    add(k, U(r.ENTERPRISE_ID));
  }
  console.log("\nuncovered Holman ent-vendor rentals, by PO recency:");
  for (const k of Object.keys(buckets).sort()) console.log(`  ${k.padEnd(28)} vehicles=${buckets[k].n}  techs=${buckets[k].techs.size}`);

  // where do the 10 recovered swappers fall?
  const watch = ["TLABORD","SHARRI0","BGREEN2","PDILEY","TDEZOET","TFRASER","SFARREL","RGADSON","CEARLS","RGRAY2"];
  console.log("\nthe confirmed-swap techs:");
  for (const [v, r] of uncovered) {
    const e = U(r.ENTERPRISE_ID);
    if (!watch.includes(e)) continue;
    const ageDays = Math.floor((asOf - new Date(r.PO_DATE || "2000-01-01").getTime()) / 86400000);
    console.log(`  ${e} veh=${v} lastPO=${String(r.PO_DATE||"").slice(0,10)} (${ageDays}d ago) days=${r.NO_OF_DAYS} rate=${r.DAILY_RATE}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
