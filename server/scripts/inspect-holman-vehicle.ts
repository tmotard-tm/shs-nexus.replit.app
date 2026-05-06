/**
 * Inspect raw field structure of existing Holman vehicles to compare against our submissions.
 * Run: npx tsx server/scripts/inspect-holman-vehicle.ts
 */
import { holmanApiService } from "../holman-api-service";

async function main() {
  const token = await (holmanApiService as any).authenticate();

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const base    = "https://api.holman.solutions/CustomerDataAPI";

  // 1. Fetch the first few active fleet vehicles — see what fields Holman stores
  console.log("=== Sample ACTIVE fleet vehicles ===");
  const r1 = await fetch(`${base}/vehicles/basic-query?lesseeCodes=2B56&statusCodes=1&pageSize=3&pageNumber=1`, { headers });
  const d1: any = await r1.json();
  for (const v of (d1.items || []).slice(0, 2)) {
    console.log(JSON.stringify(v, null, 2));
    console.log("---");
  }

  // 2. Fetch out-of-service and find 088059 (the pre-existing BYOV)
  console.log("\n=== Searching for pre-existing BYOV 088059 ===");
  let byov: any = null;
  for (let p = 1; p <= 5 && !byov; p++) {
    const r = await fetch(`${base}/vehicles/basic-query?lesseeCodes=2B56&statusCodes=2&pageSize=1000&pageNumber=${p}`, { headers });
    const d: any = await r.json();
    byov = (d.items || []).find((v: any) =>
      (v.holmanVehicleNumber || "").replace(/\D/g, "").padStart(6, "0") === "088059" ||
      (v.clientVehicleNumber || "").replace(/\D/g, "").padStart(6, "0") === "088059"
    );
    if ((d.items || []).length === 0 || p >= (d.pageInfo?.totalPages ?? 1)) break;
  }
  if (byov) {
    console.log("Found 088059:", JSON.stringify(byov, null, 2));
  } else {
    console.log("088059 not found in out-of-service. Checking active status...");
    for (let p = 1; p <= 3 && !byov; p++) {
      const r = await fetch(`${base}/vehicles/basic-query?lesseeCodes=2B56&statusCodes=1&pageSize=1000&pageNumber=${p}`, { headers });
      const d: any = await r.json();
      byov = (d.items || []).find((v: any) =>
        (v.holmanVehicleNumber || "").replace(/\D/g, "").padStart(6, "0") === "088059" ||
        (v.clientVehicleNumber || "").replace(/\D/g, "").padStart(6, "0") === "088059"
      );
      if ((d.items || []).length === 0 || p >= (d.pageInfo?.totalPages ?? 1)) break;
    }
    if (byov) console.log("Found 088059 (active):", JSON.stringify(byov, null, 2));
    else console.log("088059 not found in any query");
  }

  // 3. Look at total counts
  const rAll = await fetch(`${base}/vehicles/basic-query?lesseeCodes=2B56&pageSize=1&pageNumber=1`, { headers });
  const dAll: any = await rAll.json();
  console.log(`\nTotal vehicles in Holman (no status filter): totalCount=${dAll.totalCount}, totalPages=${dAll.pageInfo?.totalPages}`);
  const rActive = await fetch(`${base}/vehicles/basic-query?lesseeCodes=2B56&statusCodes=1&pageSize=1&pageNumber=1`, { headers });
  const dActive: any = await rActive.json();
  console.log(`Active vehicles: totalCount=${dActive.totalCount}`);
  const rOOS = await fetch(`${base}/vehicles/basic-query?lesseeCodes=2B56&statusCodes=2&pageSize=1&pageNumber=1`, { headers });
  const dOOS: any = await rOOS.json();
  console.log(`Out-of-service vehicles: totalCount=${dOOS.totalCount}`);
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
