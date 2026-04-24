// Verify TBL_PROCESSTECHTIMETECHHUB_1WK has the screenshot cadence + recent data.
import { getSnowflakeService, initializeSnowflakeService } from "../server/snowflake-service";

async function main() {
  const account = process.env.SNOWFLAKE_ACCOUNT;
  const username = process.env.SNOWFLAKE_USER;
  let privateKey = process.env.SNOWFLAKE_PRIVATE_KEY;
  if (!privateKey) {
    try { const { loadKeyFromFile } = await import("../server/snowflake-key-loader"); privateKey = (loadKeyFromFile() ?? undefined) as string | undefined; } catch {}
  }
  if (!account || !username || !privateKey) { console.error("missing creds"); process.exit(1); }
  initializeSnowflakeService({
    account, username, privateKey,
    database: process.env.SNOWFLAKE_DATABASE, schema: process.env.SNOWFLAKE_SCHEMA,
    warehouse: process.env.SNOWFLAKE_WAREHOUSE, role: process.env.SNOWFLAKE_ROLE,
  });
  const svc = getSnowflakeService();

  const fq = "IH_DATASCIENCE.NFDT_METRIC_TBLS.TBL_PROCESSTECHTIMETECHHUB_1WK";

  // Date range + total
  const range = await svc.executeQuery(`
    SELECT MIN(RTE_DT) AS "min", MAX(RTE_DT) AS "max", COUNT(*) AS "total"
    FROM ${fq}
  `);
  console.log("range:", JSON.stringify(range[0]));

  // Distinct PUNCH_TYP
  const types = await svc.executeQuery(`
    SELECT PUNCH_TYP AS "t", COUNT(*) AS "n"
    FROM ${fq}
    GROUP BY PUNCH_TYP
    ORDER BY COUNT(*) DESC
    LIMIT 25
  `);
  console.log("\ndistinct PUNCH_TYP:");
  (types as any[]).forEach((r) => console.log("  ", r.t, "→", r.n));

  // TBOTTOM's last 7 days
  const events = await svc.executeQuery(`
    SELECT RTE_DT, PUNCH_TS, PUNCH_TYP, PUNCH_DTL, ROW_NUM, TIME_ZONE
    FROM ${fq}
    WHERE UPPER(ENT_ID) = 'TBOTTOM'
      AND RTE_DT >= DATEADD('day', -7, CURRENT_DATE)
    ORDER BY RTE_DT DESC, PUNCH_TS DESC
    LIMIT 30
  `);
  console.log(`\nTBOTTOM last-7d events (${events.length}):`);
  (events as any[]).forEach((r) => console.log(" ", r.RTE_DT?.toISOString?.()?.slice(0,10) ?? r.RTE_DT, r.PUNCH_TS, "|", r.PUNCH_TYP, "|", r.PUNCH_DTL ?? "—", "| rn", r.ROW_NUM));

  process.exit(0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
