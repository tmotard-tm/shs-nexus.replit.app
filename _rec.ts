import { Pool } from "pg";
import { executeQuery } from "./server/fleet-scope-snowflake";
(async () => {
  const pool = new Pool({ connectionString: process.env.PROD_DATABASE_URL, ssl: { rejectUnauthorized: true } });
  const q = async (s: string) => (await pool.query(s)).rows;
  const cols = await q(`SELECT column_name FROM information_schema.columns WHERE table_name='reconciliation_runs' ORDER BY ordinal_position`);
  console.log("reconciliation_runs cols:", cols.map((c:any)=>c.column_name).join(", "));
  const runs = await q(`SELECT * FROM reconciliation_runs ORDER BY created_at DESC LIMIT 6`).catch(async()=> await q(`SELECT * FROM reconciliation_runs ORDER BY id DESC LIMIT 6`));
  console.log("\n=== recent reconciliation runs ===");
  for (const r of runs as any[]) console.log(JSON.stringify(r));
  // AIMS freshness (the engine authority)
  try {
    const aims:any = await executeQuery(`SELECT TO_CHAR(MAX(FILE_DATE),'YYYY-MM-DD') mfd, COUNT(*) c FROM PARTS_SUPPLYCHAIN.SOFTEON.AIMS_TRUCK_INFO WHERE FILE_DATE=(SELECT MAX(FILE_DATE) FROM PARTS_SUPPLYCHAIN.SOFTEON.AIMS_TRUCK_INFO)`);
    const row = aims?.rows?.[0] || aims?.[0] || aims;
    console.log("\nAIMS max FILE_DATE:", JSON.stringify(row));
  } catch(e:any){ console.log("\nAIMS read ERR:", e?.message||e); }
  await pool.end(); process.exit(0);
})().catch(e => { console.error("ERR", e?.message || e); process.exit(1); });
