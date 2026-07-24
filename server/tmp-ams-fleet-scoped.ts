import { readFileSync } from "fs";
import { fsDb } from "./fleet-scope-db";
import { sql } from "drizzle-orm";

(async () => {
  const amsMap: Record<string, string | null> = JSON.parse(
    readFileSync("/tmp/ams_full_status_map.json", "utf-8"),
  );

  const rows = await fsDb.execute(sql`
    SELECT vin FROM holman_vehicles_cache
    WHERE COALESCE(NULLIF(btrim(raw_data->>'status'), ''),
        CASE status_code WHEN 1 THEN 'Active' WHEN 2 THEN 'Out of Service' WHEN 3 THEN 'Sold' END) = 'Active'
  `);
  const activeVins: string[] = (rows as any).rows
    ? (rows as any).rows.map((r: any) => r.vin)
    : (rows as any).map((r: any) => r.vin);

  console.log("ACTIVE_HOLMAN_VINS:", activeVins.length);

  const counts: Record<string, number> = {};
  let matched = 0;
  for (const vin of activeVins) {
    const status = amsMap[vin];
    const key = status || "(no AMS match)";
    counts[key] = (counts[key] || 0) + 1;
    if (status) matched++;
  }
  console.log("MATCHED_TO_AMS:", matched, "of", activeVins.length);
  console.log("FLEET_SCOPED_STATUS_COUNTS:", JSON.stringify(counts, null, 2));
  process.exit(0);
})().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
