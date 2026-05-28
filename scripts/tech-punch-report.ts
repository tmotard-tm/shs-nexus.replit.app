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

// From production vrm_repair_tracker query
const TECHS = [
  { ldap: "RDEGRAN", name: "RHYEN DE GRANGE", phone: "2087602432", dateAdded: "2026-04-27" },
  { ldap: "TMATTHE", name: "TRENT MATTHEWS",  phone: "2522185938", dateAdded: "2026-05-01" },
  { ldap: "JFRYE1",  name: "JOHNNY FRYE",     phone: "3033565897", dateAdded: "2026-05-01" },
  { ldap: "RLARA",   name: "RICARDO LARA",    phone: "6787088702", dateAdded: "2026-05-07" },
];

function csvEscape(v: any): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  await initSnowflake();
  const svc = getSnowflakeService();

  const rows: any[] = [];
  let totalPunches = 0;

  for (const t of TECHS) {
    const safe = t.ldap.replace(/'/g, "''");
    const q = `
      SELECT UPPER(ENT_ID) AS "ldap",
             TO_CHAR(RTE_DT, 'YYYY-MM-DD') AS "punchDate",
             TO_CHAR(PUNCH_TS, 'YYYY-MM-DD HH24:MI:SS') AS "punchTs",
             PUNCH_TYP AS "punchType",
             PUNCH_DTL AS "orderNumber"
      FROM IH_DATASCIENCE.NFDT_METRIC_TBLS.TBL_PROCESSTECHTIMETECHHUB
      WHERE UPPER(ENT_ID) = '${safe}'
        AND RTE_DT >= TO_DATE('${t.dateAdded}', 'YYYY-MM-DD')
        AND PUNCH_TS IS NOT NULL
      ORDER BY RTE_DT ASC, PUNCH_TS ASC
    `;
    const punches = (await svc.executeQuery(q)) as any[];
    console.log(`${t.ldap} (${t.name}): ${punches.length} punches since ${t.dateAdded}`);
    totalPunches += punches.length;

    if (punches.length === 0) {
      rows.push({
        date_added: t.dateAdded, tech_name: t.name, ldap: t.ldap, phone: t.phone,
        punch_date: "", punch_time: "", punch_type: "(no punches found)", order_number: "",
      });
    } else {
      for (const p of punches) {
        const [d, time] = String(p.punchTs ?? "").split(" ");
        rows.push({
          date_added: t.dateAdded,
          tech_name:  t.name,
          ldap:       t.ldap,
          phone:      t.phone,
          punch_date: p.punchDate ?? d ?? "",
          punch_time: time ?? "",
          punch_type: p.punchType ?? "",
          order_number: p.orderNumber ?? "",
        });
      }
    }
  }

  const header = ["date_added","tech_name","ldap","phone","punch_date","punch_time","punch_type","order_number"];
  const csv = [
    header.join(","),
    ...rows.map(r => header.map(h => csvEscape((r as any)[h])).join(",")),
  ].join("\n");

  const outDir = path.resolve(process.cwd(), "exports");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "tech-punch-report.csv");
  fs.writeFileSync(outPath, csv);
  console.log(`\nWrote ${rows.length} rows (${totalPunches} actual punches) → ${outPath}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
