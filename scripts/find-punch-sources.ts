import { initializeSnowflakeService, getSnowflakeService } from "../server/snowflake-service";

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
  await initSnowflake();
  const svc = getSnowflakeService();

  const tables = (await svc.executeQuery(`
    SELECT TABLE_SCHEMA AS "schema", TABLE_NAME AS "table", TABLE_TYPE AS "type"
    FROM IH_DATASCIENCE.INFORMATION_SCHEMA.TABLES
    WHERE UPPER(TABLE_NAME) LIKE '%PUNCH%'
       OR UPPER(TABLE_NAME) LIKE '%TECHTIME%'
       OR UPPER(TABLE_NAME) LIKE '%TECHHUB%'
       OR UPPER(TABLE_NAME) LIKE '%TIMECARD%'
       OR UPPER(TABLE_NAME) LIKE '%CLOCK%'
    ORDER BY TABLE_SCHEMA, TABLE_NAME
  `)) as any[];
  console.log(`=== ${tables.length} CANDIDATE PUNCH TABLES ===`);
  for (const t of tables) console.log(`${t.schema}.${t.table}  (${t.type})`);

  console.log("\n=== DATE RANGE PER TABLE ===");
  for (const t of tables) {
    const full = `IH_DATASCIENCE.${t.schema}.${t.table}`;
    for (const col of ["RTE_DT", "PUNCH_DATE", "PUNCH_TS", "PUNCHDATE", "ROUTE_DATE"]) {
      try {
        const r = (await svc.executeQuery(
          `SELECT MIN(${col}) AS "minD", MAX(${col}) AS "maxD", COUNT(*) AS "cnt" FROM ${full}`
        )) as any[];
        if (r[0]?.cnt) {
          console.log(`${full}.${col}: ${r[0].minD} → ${r[0].maxD}  (rows=${r[0].cnt})`);
          break;
        }
      } catch { /* try next col */ }
    }
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
