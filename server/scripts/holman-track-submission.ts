/**
 * Track a Holman submission via userReferenceToken and also check submission status endpoint.
 * Run: REFERENCE_TOKEN=<token> npx tsx server/scripts/holman-track-submission.ts
 */
import { holmanApiService } from "../holman-api-service";

async function main() {
  const token = await (holmanApiService as any).authenticate();
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const base = "https://api.holman.solutions/CustomerDataAPI";

  // Try various submission-tracking endpoints
  const refToken = process.env.REFERENCE_TOKEN || "";
  const endpoints = [
    `/vehicles/submissions/${refToken}`,
    `/vehicles/submission/${refToken}`,
    `/submissions/${refToken}`,
    `/vehicles/status/${refToken}`,
    `/vehicles/submit/status?userReferenceToken=${refToken}`,
    `/vehicles/submit/${refToken}`,
  ];

  if (refToken) {
    console.log(`=== Tracking reference token: ${refToken} ===`);
    for (const ep of endpoints) {
      try {
        const r = await fetch(`${base}${ep}`, { headers });
        const body = await r.text();
        console.log(`${ep}: ${r.status} | ${body.slice(0, 200)}`);
      } catch (e: any) {
        console.log(`${ep}: ERROR ${e.message.slice(0, 80)}`);
      }
    }
  }

  // Check if the 088996 probe vehicle (assetAction=ADD, ~20min ago) or 088124 appears now
  console.log("\n=== Searching for test vehicles across ALL pages ===");
  const targets = new Set(["088996","088124","088997"]);
  const found = new Map<string,any>();
  // No status filter = all statuses 
  for (let p = 1; p <= 15 && found.size < targets.size; p++) {
    const r = await fetch(`${base}/vehicles/basic-query?lesseeCodes=2B56&pageSize=1000&pageNumber=${p}`, { headers });
    const d: any = await r.json();
    for (const v of (d.items || [])) {
      const num = (v.holmanVehicleNumber || "").replace(/\D/g,'').padStart(6,'0');
      if (targets.has(num)) found.set(num, v);
    }
    if (p >= (d.pageInfo?.totalPages ?? 1)) break;
  }
  const total = (await (await fetch(`${base}/vehicles/basic-query?lesseeCodes=2B56&pageSize=1&pageNumber=1`, { headers })).json() as any).totalCount;
  console.log(`Total vehicles now: ${total}`);
  for (const t of targets) {
    if (found.has(t)) {
      const v = found.get(t);
      console.log(`✓ ${t} FOUND: statusCode=${v.statusCode} | orderType=${v.orderType}`);
    } else {
      console.log(`✗ ${t} NOT FOUND`);
    }
  }
}
main().catch(e => { console.error(e.message); process.exit(1); });
