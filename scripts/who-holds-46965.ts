import { initializeSnowflakeService } from "../server/snowflake-service";
import { loadKeyFromFile } from "../server/snowflake-key-loader";
import { executeQuery } from "../server/fleet-scope-snowflake";

async function main() {
  console.log("=== Who currently holds truck 46965/046965 in TPMS_EXTRACT ===\n");

  const account = process.env.SNOWFLAKE_ACCOUNT;
  const username = process.env.SNOWFLAKE_USER;
  let privateKey = process.env.SNOWFLAKE_PRIVATE_KEY;
  try { const fk = loadKeyFromFile(); if (fk) privateKey = fk; } catch {}
  if (!account || !username || !privateKey) {
    throw new Error("Missing Snowflake creds in this shell");
  }
  initializeSnowflakeService({
    account, username, privateKey,
    database: process.env.SNOWFLAKE_DATABASE,
    schema: process.env.SNOWFLAKE_SCHEMA,
    warehouse: process.env.SNOWFLAKE_WAREHOUSE,
    role: process.env.SNOWFLAKE_ROLE,
  });

  const rows = await executeQuery<any>(`
    SELECT ENTERPRISE_ID, TRUCK_LU, FULL_NAME, MANAGER_ENT_ID
    FROM PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT
    WHERE REGEXP_REPLACE(TRUCK_LU, '^0+', '') = '46965'
  `);
  console.log("TPMS_EXTRACT (current) matches:", rows.length);
  console.log(JSON.stringify(rows, null, 2));

  const last = await executeQuery<any>(`
    SELECT ENTERPRISE_ID, TRUCK_LU, FILE_DATE
    FROM PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT_LAST_ASSIGNED
    WHERE REGEXP_REPLACE(TRUCK_LU, '^0+', '') = '46965'
    ORDER BY FILE_DATE DESC
  `);
  console.log("\nTPMS_EXTRACT_LAST_ASSIGNED (historical) matches:", last.length);
  console.log(JSON.stringify(last, null, 2));

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
