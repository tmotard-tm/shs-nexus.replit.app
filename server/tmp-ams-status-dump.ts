import { getAmsTruckStatusMap } from "./ams-truck-status-cache";
import { writeFileSync } from "fs";

(async () => {
  const map = await getAmsTruckStatusMap();
  const entries = Object.entries(map);
  console.log("TOTAL_VINS:", entries.length);
  const counts: Record<string, number> = {};
  for (const [, status] of entries) {
    const key = status || "(null)";
    counts[key] = (counts[key] || 0) + 1;
  }
  console.log("STATUS_COUNTS:", JSON.stringify(counts, null, 2));
  writeFileSync("/tmp/ams_full_status_map.json", JSON.stringify(map));
  console.log("DONE - wrote /tmp/ams_full_status_map.json");
  process.exit(0);
})().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
