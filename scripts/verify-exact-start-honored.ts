/**
 * Read-only: is StartTimeRequest "Exact" actually honored to the minute?
 *
 * The 151 cutover blocks were all filed with "Anytime". Every OTHER
 * "Vehicle - Change" row in the same window comes from a lane that uses the
 * client's "Exact" default (LUCA rental pickups) or from a human. Comparing the
 * two populations' start times says whether "Exact" holds 08:00.
 *
 * Usage: npx tsx scripts/verify-exact-start-honored.ts
 */
import { initializeSnowflakeService, getSnowflakeService } from "../server/snowflake-service";
import { Pool } from "pg";

const SCHEDULE_TABLE = "PRD_SERVICEPOWER.BATCH_TBLS.SCH_ACTIVITIES_PROD";

async function initSnowflake() {
  const account = process.env.SNOWFLAKE_ACCOUNT;
  const username = process.env.SNOWFLAKE_USER;
  let privateKey = process.env.SNOWFLAKE_PRIVATE_KEY;
  if (!privateKey) {
    const { loadKeyFromFile } = await import("../server/snowflake-key-loader");
    const fileKey = loadKeyFromFile();
    if (fileKey) privateKey = fileKey;
  }
  if (!account || !username || !privateKey) throw new Error("missing snowflake creds");
  initializeSnowflakeService({
    account, username, privateKey,
    database: process.env.SNOWFLAKE_DATABASE,
    schema: process.env.SNOWFLAKE_SCHEMA,
    warehouse: process.env.SNOWFLAKE_WAREHOUSE,
    role: process.env.SNOWFLAKE_ROLE,
  });
}

async function main() {
  const pool = new Pool({ connectionString: process.env.PROD_DATABASE_URL });
  const { rows: filed } = await pool.query(
    `SELECT DISTINCT upper(ldap) || '|' || route_block_date::text AS k
       FROM vrm_rental_cutover
      WHERE route_block_status = 'filed' AND route_block_date IS NOT NULL`,
  );
  await pool.end();
  const ours = new Set(filed.map((r: any) => r.k));

  await initSnowflake();
  const sf = getSnowflakeService();

  const rows = await sf.executeQuery(
    `SELECT UPPER(TRIM(EMPLOYEE_REF)) AS LDAP,
            TO_CHAR(EXPECTED_START_DATE,'YYYY-MM-DD') AS D,
            TO_CHAR(EXPECTED_START_TIME) AS ST
       FROM ${SCHEDULE_TABLE}
      WHERE LOWER(TRIM(COALESCE(ACTIVITY_TYPE_DESCRIPTION,''))) = 'vehicle - change'
        AND EXPECTED_START_DATE BETWEEN TO_DATE('2026-08-11') AND TO_DATE('2026-08-18')
      QUALIFY CREATED_TS_DW = MAX(CREATED_TS_DW)
                OVER (PARTITION BY UPPER(TRIM(EMPLOYEE_REF)), EXPECTED_START_DATE)`,
  );

  let oursAt8 = 0, oursTotal = 0, othersAt8 = 0, othersTotal = 0;
  const otherTimes = new Map<string, number>();
  for (const r of rows ?? []) {
    const k = `${r.LDAP}|${r.D}`;
    const at8 = String(r.ST ?? "").trim() === "08:00:00";
    if (ours.has(k)) { oursTotal++; if (at8) oursAt8++; }
    else {
      othersTotal++;
      if (at8) othersAt8++;
      const st = String(r.ST ?? "").trim() || "(empty)";
      otherTimes.set(st, (otherTimes.get(st) ?? 0) + 1);
    }
  }

  const pct = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(0) : "0");
  console.log(`\nFiled by us with "Anytime": ${oursAt8}/${oursTotal} at 08:00:00 (${pct(oursAt8, oursTotal)}%)`);
  console.log(`Every other Vehicle - Change: ${othersAt8}/${othersTotal} at 08:00:00 (${pct(othersAt8, othersTotal)}%)`);
  console.log(`\nStart times on the non-cutover population:`);
  for (const [st, n] of Array.from(otherTimes.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${String(n).padStart(4)}  ${st}${st === "08:00:00" ? "  <-- exact" : ""}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
