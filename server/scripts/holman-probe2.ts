/**
 * Probe 2: check if Strategy 4 test vehicle appeared, and test clientVehicleNumber 
 * with correct MM/dd/yyyy dates to understand if Holman auto-assigns vehicle numbers.
 * Run: npx tsx server/scripts/holman-probe2.ts
 */
import { holmanApiService } from "../holman-api-service";

async function main() {
  const token = await (holmanApiService as any).authenticate();
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const base = "https://api.holman.solutions/CustomerDataAPI";

  // 1. Did Strategy 4 test VIN show up anywhere in Holman after ~10 minutes?
  console.log("=== Searching for probe test VIN 1FTPX14V69KB00001 ===");
  for (let p = 1; p <= 13; p++) {
    const r = await fetch(`${base}/vehicles/basic-query?lesseeCodes=2B56&pageSize=1000&pageNumber=${p}`, { headers });
    const d: any = await r.json();
    const hit = (d.items || []).find((v: any) => v.vin === "1FTPX14V69KB00001");
    if (hit) {
      console.log(`FOUND on page ${p}:`, JSON.stringify(hit, null, 2));
      break;
    }
    if (p >= (d.pageInfo?.totalPages ?? 1)) { console.log("Not found in any page."); break; }
  }

  // 2. Strategy 2b: clientVehicleNumber + correct MM/dd/yyyy date format (no holmanVehicleNumber)
  console.log("\n=== Strategy 2b: clientVehicleNumber only + correct date format ===");
  const resp2b = await holmanApiService.submitVehicleArray([{
    lesseeCode:          "2B56",
    vendorCode:          "OTH",
    division:            "01",
    clientVehicleNumber: "T88998",
    assetType:           "TRUCK LD",
    vin:                 "1FTPX14V69KB99998",
    modelYear:           "2018",
    firstName:           "TEST",
    lastName:            "PROBE2",
    email:               "FLEET_SUPPORT@TRANSFORMCO.COM",
    driverClass:         "N",
    assignedStatusCode:  "D",
    clientData3:         "890",
    deliveryDate:        "11/13/2024",
    onRoadDate:          "11/13/2024",
    makeClient:          "FORD",
    modelClient:         "F-150",
  } as any]);
  console.log("Full response:", JSON.stringify(resp2b, null, 2));

  // 3. Strategy 3b: holmanVehicleNumber + clientVehicleNumber + correct date format
  console.log("\n=== Strategy 3b: holmanVehicleNumber + correct date format ===");
  const resp3b = await holmanApiService.submitVehicleArray([{
    lesseeCode:          "2B56",
    vendorCode:          "OTH",
    division:            "01",
    holmanVehicleNumber: "088997",
    assetType:           "TRUCK LD",
    vin:                 "1FTPX14V69KB99997",
    modelYear:           "2018",
    firstName:           "TEST",
    lastName:            "PROBE3",
    email:               "FLEET_SUPPORT@TRANSFORMCO.COM",
    driverClass:         "N",
    assignedStatusCode:  "D",
    clientData3:         "890",
    deliveryDate:        "11/13/2024",
    onRoadDate:          "11/13/2024",
    makeClient:          "FORD",
    modelClient:         "F-150",
  } as any]);
  console.log("Full response:", JSON.stringify(resp3b, null, 2));

  // 4. Existing vehicle 088059 with correct date format — should update successfully
  console.log("\n=== Strategy 5b: existing BYOV 088059 with correct date format ===");
  const resp5b = await holmanApiService.submitVehicleArray([{
    lesseeCode:          "2B56",
    vendorCode:          "OTH",
    division:            "01",
    holmanVehicleNumber: "088059",
    vin:                 "1FTPX14V69KB98946",
    deliveryDate:        "11/13/2024",
    onRoadDate:          "11/13/2024",
  } as any]);
  console.log("Full response:", JSON.stringify(resp5b, null, 2));
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
