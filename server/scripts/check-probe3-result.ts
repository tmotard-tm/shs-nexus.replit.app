import { holmanApiService } from "../holman-api-service";
async function main() {
  const token = await (holmanApiService as any).authenticate();
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const base = "https://api.holman.solutions/CustomerDataAPI";
  // Check if probe3 vehicle 088996 appeared (submitted ~2 min ago with assetAction=ADD)
  for (let p = 1; p <= 4; p++) {
    const r = await fetch(`${base}/vehicles/basic-query?lesseeCodes=2B56&pageSize=1000&pageNumber=${p}`, { headers });
    const d: any = await r.json();
    const hit = (d.items || []).find((v: any) =>
      (v.holmanVehicleNumber || "").replace(/\D/g,'').padStart(6,'0') === "088996" ||
      (v.vin || "") === "1FTPX14V69KB99996"
    );
    if (hit) { console.log("FOUND 088996:", JSON.stringify(hit, null, 2)); return; }
    if (p >= (d.pageInfo?.totalPages ?? 1)) break;
  }
  console.log("088996 not yet found in Holman (processing may take a few minutes)");
}
main().catch(e => console.error(e.message));
