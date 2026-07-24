import { readFileSync } from "fs";
import { fsDb } from "./fleet-scope-db";
import { sql } from "drizzle-orm";

(async () => {
  const amsMap: Record<string, string | null> = JSON.parse(
    readFileSync("/tmp/ams_full_status_map.json", "utf-8"),
  );

  const rows = await fsDb.execute(sql`
    SELECT d.truck_number, h.vin
    FROM fs_decommissioning_vehicles d
    JOIN holman_vehicles_cache h
      ON regexp_replace(btrim(h.holman_vehicle_number), '^0+', '') = regexp_replace(btrim(d.truck_number), '^0+', '')
    WHERE d.sent_to_procurement = true
      AND COALESCE(NULLIF(btrim(h.raw_data->>'status'), ''),
          CASE h.status_code WHEN 1 THEN 'Active' WHEN 2 THEN 'Out of Service' WHEN 3 THEN 'Sold' END) = 'Active'
  `);
  const list: { truck_number: string; vin: string }[] = (rows as any).rows
    ? (rows as any).rows
    : (rows as any);

  console.log("TOTAL_79_CHECK:", list.length);

  const counts: Record<string, number> = {};
  const detail: string[] = [];
  for (const r of list) {
    const status = amsMap[r.vin] || "(no AMS match)";
    counts[status] = (counts[status] || 0) + 1;
    detail.push(`${r.truck_number} -> ${status}`);
  }
  console.log("AMS_STATUS_OF_THE_79:", JSON.stringify(counts, null, 2));
  console.log("--- detail ---");
  console.log(detail.join("\n"));
  process.exit(0);
})().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
