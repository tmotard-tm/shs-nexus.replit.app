// Confirm TIME_PUNCH_DAY_DETAIL is the real source: pull TBOTTOM's last-7d events.
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

  const fq = "IH_DATASCIENCE.HS_FIELD_PERFORMANCE.TIME_PUNCH_DAY_DETAIL";

  // Distinct PUNCH_TYP values in last 7d
  console.log("distinct PUNCH_TYP in last 7d:");
  const types = await svc.executeQuery(`
    SELECT PUNCH_TYP AS "t", COUNT(*) AS "n"
    FROM ${fq}
    WHERE PUNCH_DT >= DATEADD('day', -7, CURRENT_DATE)
    GROUP BY PUNCH_TYP
    ORDER BY COUNT(*) DESC
  `);
  (types as any[]).forEach((r) => console.log("  ", r.t, "→", r.n));

  // UNION with safe TRY_TO_TIME — emits "START X" and "END X" as separate events
  console.log("\nTBOTTOM last-7d punches (UNION'd):");
  const rows = await svc.executeQuery(`
    WITH unioned AS (
      SELECT EMP_ENT_ID AS ent, PUNCH_DT AS dt, 'START ' || PUNCH_TYP AS ptyp, START_TIME AS pts
      FROM ${fq}
      WHERE UPPER(EMP_ENT_ID) = 'TBOTTOM'
        AND PUNCH_DT >= DATEADD('day', -7, CURRENT_DATE)
        AND START_TIME IS NOT NULL
      UNION ALL
      SELECT EMP_ENT_ID AS ent, PUNCH_DT AS dt, 'END ' || PUNCH_TYP AS ptyp, END_TIME AS pts
      FROM ${fq}
      WHERE UPPER(EMP_ENT_ID) = 'TBOTTOM'
        AND PUNCH_DT >= DATEADD('day', -7, CURRENT_DATE)
        AND END_TIME IS NOT NULL
    )
    SELECT * FROM unioned
    ORDER BY dt DESC, pts DESC
    LIMIT 30
  `);
  (rows as any[]).forEach((r) => console.log("  ", r.DT, r.PTS, "|", r.PTYP));
  process.exit(0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
