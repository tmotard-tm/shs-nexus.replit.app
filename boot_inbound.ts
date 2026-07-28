import { initInboundSchema } from "./server/vrm/inbound/schema";
import { runInboundSync } from "./server/vrm/inbound/sync";
import { db } from "./server/db";
import { sql } from "drizzle-orm";

(async () => {
  console.log("== initInboundSchema ==");
  await initInboundSchema();
  const t = await db.execute(sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_name LIKE 'vrm_inbound%' ORDER BY 1`);
  console.log("tables:", (t.rows as any[]).map(r => r.table_name));

  console.log("\n== runInboundSync(full) ==");
  const r = await runInboundSync({ trigger: "manual:setup", full: true });
  console.log(JSON.stringify(r));

  const s = await db.execute(sql`
    SELECT COUNT(*)::int AS rows,
           COUNT(*) FILTER (WHERE call_type <> 'JUNK')::int AS real_calls,
           COUNT(*) FILTER (WHERE matched_truck IS NOT NULL)::int AS linked,
           COUNT(*) FILTER (WHERE vehicle_year IS NOT NULL)::int AS with_year,
           COUNT(*) FILTER (WHERE next_steps IS NOT NULL)::int AS with_next_steps
    FROM vrm_inbound_calls`);
  console.log("\nrow counts:", JSON.stringify((s.rows as any[])[0]));
  const bt = await db.execute(sql`SELECT call_type, COUNT(*)::int n FROM vrm_inbound_calls GROUP BY 1 ORDER BY 2 DESC`);
  console.log("by type:", JSON.stringify(bt.rows));
  process.exit(0);
})().catch(e => { console.error("FAILED:", e?.message || e); process.exit(1); });
