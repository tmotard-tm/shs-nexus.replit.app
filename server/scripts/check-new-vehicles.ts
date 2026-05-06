import { holmanApiService } from "../holman-api-service";
async function main() {
  const token = await (holmanApiService as any).authenticate();
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const base = "https://api.holman.solutions/CustomerDataAPI";
  const targets = new Set(["088996","088124","088059"]);
  const found = new Map<string,any>();
  for (let p = 1; p <= 15; p++) {
    const r = await fetch(`${base}/vehicles/basic-query?lesseeCodes=2B56&pageSize=1000&pageNumber=${p}`, { headers });
    const d: any = await r.json();
    for (const v of (d.items || [])) {
      const num = (v.holmanVehicleNumber || "").replace(/\D/g,'').padStart(6,'0');
      if (targets.has(num)) found.set(num, v);
    }
    if (found.size === targets.size) break;
    if (p >= (d.pageInfo?.totalPages ?? 1)) break;
  }
  // Also check out-of-service for 088059
  if (!found.has("088059")) {
    for (let p = 1; p <= 2; p++) {
      const r = await fetch(`${base}/vehicles/basic-query?lesseeCodes=2B56&statusCodes=2&pageSize=1000&pageNumber=${p}`, { headers });
      const d: any = await r.json();
      for (const v of (d.items || [])) {
        const num = (v.holmanVehicleNumber || "").replace(/\D/g,'').padStart(6,'0');
        if (targets.has(num)) found.set(num, v);
      }
      if (p >= (d.pageInfo?.totalPages ?? 1)) break;
    }
  }
  for (const t of targets) {
    if (found.has(t)) {
      const v = found.get(t);
      console.log(`✓ ${t} FOUND: statusCode=${v.statusCode} vendor=${v.vendor} orderType=${v.orderType} assetType=${v.assetType}`);
    } else {
      console.log(`✗ ${t} NOT FOUND`);
    }
  }
}
main().catch(e => { console.error(e.message); process.exit(1); });
