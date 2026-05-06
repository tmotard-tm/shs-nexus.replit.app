/**
 * Probe 4: Submit with assetAction=ADD but NO holmanVehicleNumber — let Holman auto-assign.
 * If a vehicle appears with an auto-assigned number, the 088xxx range is the problem.
 * Also poll for vehicle count change to measure Holman processing latency.
 * Run: npx tsx server/scripts/holman-probe4.ts
 */
import { holmanApiService } from "../holman-api-service";

async function getTotalCount(token: string): Promise<number> {
  const r = await fetch(
    "https://api.holman.solutions/CustomerDataAPI/vehicles/basic-query?lesseeCodes=2B56&pageSize=1&pageNumber=1",
    { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
  );
  const d: any = await r.json();
  return d.totalCount ?? 0;
}

async function main() {
  const token = await (holmanApiService as any).authenticate();

  const countBefore = await getTotalCount(token);
  console.log(`Vehicle count BEFORE: ${countBefore}`);

  // Submit with unique VIN, assetAction=ADD, NO holmanVehicleNumber
  console.log("\n=== Submitting with assetAction=ADD, no holmanVehicleNumber ===");
  const resp = await holmanApiService.submitVehicleArray([{
    lesseeCode:   "2B56",
    vendorCode:   "OTH",
    division:     "01",
    assetAction:  "ADD",
    assetType:    "TRUCK LD",
    vin:          "TEST0BYOV0NOID0001",
    modelYear:    "2018",
    firstName:    "AUTO",
    lastName:     "ASSIGN",
    email:        "FLEET_SUPPORT@TRANSFORMCO.COM",
    driverClass:  "N",
    assignedStatusCode: "D",
    clientData3:  "890",
    deliveryDate: "11/13/2024",
    onRoadDate:   "11/13/2024",
    makeClient:   "FORD",
    modelClient:  "F-150",
  } as any]);
  console.log("Response:", JSON.stringify(resp, null, 2));

  // Also submit with holmanVehicleNumber=088996 + assetAction=ADD (was submitted 30min ago, retry)
  console.log("\n=== Re-submitting 088996 with assetAction=ADD ===");
  const resp2 = await holmanApiService.submitVehicleArray([{
    lesseeCode:          "2B56",
    vendorCode:          "OTH",
    division:            "01",
    assetAction:         "ADD",
    holmanVehicleNumber: "088996",
    assetType:           "TRUCK LD",
    vin:                 "1FTPX14V69KB99996",
    modelYear:           "2018",
    firstName:           "TEST",
    lastName:            "PROBE4",
    email:               "FLEET_SUPPORT@TRANSFORMCO.COM",
    driverClass:         "N",
    assignedStatusCode:  "D",
    clientData3:         "890",
    deliveryDate:        "11/13/2024",
    onRoadDate:          "11/13/2024",
    makeClient:          "FORD",
    modelClient:         "F-150",
  } as any]);
  console.log("Response:", JSON.stringify({ message: resp2?.message, errorCount: resp2?.errorCount }, null, 2));

  // Poll vehicle count for 5 minutes
  console.log("\n=== Polling for vehicle count change (5 min) ===");
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 30000));
    const count = await getTotalCount(token);
    const diff = count - countBefore;
    console.log(`[${new Date().toISOString()}] Vehicle count: ${count} (${diff >= 0 ? '+' : ''}${diff})`);
    if (count > countBefore) {
      console.log(">>> COUNT INCREASED! Holman processed the submission. Searching for new vehicles...");
      // Find the new vehicle
      const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
      const r = await fetch(
        "https://api.holman.solutions/CustomerDataAPI/vehicles/basic-query?lesseeCodes=2B56&pageSize=1000&pageNumber=1",
        { headers }
      );
      const d: any = await r.json();
      for (const v of (d.items || [])) {
        const vin = v.vin || "";
        if (vin.includes("TEST0BYOV") || (v.holmanVehicleNumber || "").includes("88996")) {
          console.log("Found new vehicle:", JSON.stringify(v, null, 2));
        }
      }
      break;
    }
  }
  console.log("=== Polling complete ===");
}
main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
