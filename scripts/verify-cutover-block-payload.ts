/**
 * Read-only: what did the filed cutover route blocks ACTUALLY land as in
 * ServicePower? Compares each filed block against the scheduler snapshot on
 * the three fields the readback checks: activity token, 08:00:00 start, ZIP5.
 *
 * Usage: npx tsx scripts/verify-cutover-block-payload.ts
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

/** ZIP5 out of a scheduler POSTCODE value (may be ZIP+4). */
function zip5(v: any): string {
  const m = String(v ?? "").match(/(\d{5})/);
  return m ? m[1] : "";
}

/**
 * ZIP out of a branch ADDRESS. Must use the same trailing-anchored regex the
 * filing code uses — a leading street number is not a ZIP.
 */
function addressZip5(v: any): string {
  const m = String(v ?? "").trim().match(/(\d{5})(?:-\d{4})?\s*$/);
  return m ? m[1] : "";
}

async function main() {
  const pool = new Pool({ connectionString: process.env.PROD_DATABASE_URL });
  const { rows: filed } = await pool.query(
    `SELECT upper(ldap) AS ldap, route_block_date::text AS d, branch_address, branch_name
       FROM vrm_rental_cutover
      WHERE route_block_status = 'filed' AND route_block_date IS NOT NULL
      ORDER BY d, ldap`,
  );
  await pool.end();

  await initSnowflake();
  const sf = getSnowflakeService();

  const byDate = new Map<string, typeof filed>();
  for (const r of filed) {
    if (!byDate.has(r.d)) byDate.set(r.d, [] as any);
    (byDate.get(r.d) as any[]).push(r);
  }

  const startTally = new Map<string, number>();
  let vcRows = 0, zipOk = 0, zipBad = 0, noVc = 0;
  const badExamples: string[] = [];

  for (const [date, list] of Array.from(byDate.entries())) {
    const inList = list.map((r: any) => `'${r.ldap.replace(/'/g, "''")}'`).join(",");
    const rows = await sf.executeQuery(
      `SELECT UPPER(TRIM(EMPLOYEE_REF)) AS LDAP,
              COALESCE(ACTIVITY_TYPE_DESCRIPTION,'(null)') AS ACT,
              TO_CHAR(EXPECTED_START_TIME) AS ST,
              COALESCE(POSTCODE,'') AS PC
         FROM ${SCHEDULE_TABLE}
        WHERE UPPER(TRIM(EMPLOYEE_REF)) IN (${inList})
          AND EXPECTED_START_DATE = TO_DATE('${date}')
          AND LOWER(TRIM(COALESCE(ACTIVITY_TYPE_DESCRIPTION,''))) = 'vehicle - change'
        QUALIFY CREATED_TS_DW = MAX(CREATED_TS_DW)
                  OVER (PARTITION BY UPPER(TRIM(EMPLOYEE_REF)), EXPECTED_START_DATE)`,
    );
    const byLdap = new Map<string, any>();
    for (const r of rows ?? []) byLdap.set(String(r.LDAP), r);

    for (const f of list as any[]) {
      const hit = byLdap.get(f.ldap);
      if (!hit) { noVc++; continue; }
      vcRows++;
      const st = String(hit.ST ?? "").trim();
      startTally.set(st, (startTally.get(st) ?? 0) + 1);
      const want = addressZip5(f.branch_address);
      const got = zip5(hit.PC);
      if (want && got && want === got) zipOk++;
      else {
        zipBad++;
        if (badExamples.length < 8) {
          badExamples.push(`${f.ldap} ${date}: booked branch zip ${want || "?"} -> block zip ${got || "(none)"} @ ${st}`);
        }
      }
    }
  }

  console.log(`\nfiled blocks on record: ${filed.length}`);
  console.log(`matched a "Vehicle - Change" row: ${vcRows}`);
  console.log(`no "Vehicle - Change" row on that tech-day: ${noVc}`);

  console.log(`\nEXPECTED_START_TIME on the landed blocks (readback demands 08:00:00):`);
  for (const [st, n] of Array.from(startTally.entries()).sort((a, b) => b[1] - a[1])) {
    const flag = st === "08:00:00" ? "  <-- as requested" : "";
    console.log(`  ${n.toString().padStart(4)}  ${st || "(empty)"}${flag}`);
  }

  console.log(`\nZIP: matches booked branch ${zipOk}, differs/missing ${zipBad}`);
  for (const b of badExamples) console.log(`  ${b}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
