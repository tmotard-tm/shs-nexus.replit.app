import * as fs from "fs";
import * as path from "path";
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

const TECH = { ldap: "HFERNAN", name: "HECTOR FERNANDEZ", phone: "9736260994", dateAdded: "2026-05-07" };

function csvEscape(v: any): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  await initSnowflake();
  const svc = getSnowflakeService();
  const safe = TECH.ldap.replace(/'/g, "''");
  const punches = (await svc.executeQuery(`
    SELECT UPPER(ENT_ID) AS "ldap",
           TO_CHAR(RTE_DT, 'YYYY-MM-DD') AS "punchDate",
           TO_CHAR(PUNCH_TS, 'YYYY-MM-DD HH24:MI:SS') AS "punchTs",
           PUNCH_TYP AS "punchType",
           PUNCH_DTL AS "orderNumber"
    FROM IH_DATASCIENCE.NFDT_METRIC_TBLS.TBL_PROCESSTECHTIMETECHHUB
    WHERE UPPER(ENT_ID) = '${safe}'
      AND RTE_DT >= TO_DATE('${TECH.dateAdded}', 'YYYY-MM-DD')
      AND PUNCH_TS IS NOT NULL
    ORDER BY RTE_DT ASC, PUNCH_TS ASC
  `)) as any[];
  console.log(`${TECH.ldap} (${TECH.name}): ${punches.length} punches since ${TECH.dateAdded}`);

  const header = ["date_added","tech_name","ldap","phone","punch_date","punch_time","punch_type","order_number"];
  const rows = punches.length === 0
    ? [{ date_added: TECH.dateAdded, tech_name: TECH.name, ldap: TECH.ldap, phone: TECH.phone,
         punch_date: "", punch_time: "", punch_type: "(no punches found)", order_number: "" }]
    : punches.map((p: any) => {
        const [d, time] = String(p.punchTs ?? "").split(" ");
        return {
          date_added: TECH.dateAdded, tech_name: TECH.name, ldap: TECH.ldap, phone: TECH.phone,
          punch_date: p.punchDate ?? d ?? "",
          punch_time: time ?? "",
          punch_type: p.punchType ?? "",
          order_number: p.orderNumber ?? "",
        };
      });
  const csv = [header.join(","), ...rows.map(r => header.map(h => csvEscape((r as any)[h])).join(","))].join("\n");
  const outDir = path.resolve(process.cwd(), "exports");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "tech-punch-report-hector-fernandez.csv");
  fs.writeFileSync(outPath, csv);
  console.log(`Wrote ${rows.length} rows → ${outPath}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
