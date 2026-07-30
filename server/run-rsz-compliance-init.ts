import { initRightsizeComplianceSchema } from "./vrm/rightsize/compliance";
import { db } from "./db";
import { sql } from "drizzle-orm";

(async () => {
  const host = (process.env.DATABASE_URL || "").match(/@([^/:]+)/)?.[1] ?? "?";
  console.log("[init] DATABASE_URL host:", host);
  const who = await db.execute(sql`SELECT current_database() AS db`);
  console.log("[init] database:", (who as any).rows?.[0]?.db);

  await initRightsizeComplianceSchema();
  console.log("[init] schema created");

  const t = await db.execute(sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_name IN ('vrm_rightsize_sedan_models','vrm_rightsize_compliance_snapshots') ORDER BY 1
  `);
  console.log("[init] tables:", JSON.stringify((t as any).rows));
  const m = await db.execute(sql`SELECT count(*) AS n FROM vrm_rightsize_sedan_models WHERE active`);
  console.log("[init] active sedan nameplates:", (m as any).rows?.[0]?.n);
  process.exit(0);
})().catch((e) => { console.error("[init] FAILED:", e?.message || e); process.exit(1); });
