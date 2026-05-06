/**
 * Probe how Holman /vehicles/submit handles brand-new BYOV vehicles.
 * Tests multiple strategies and logs the FULL 202 response each time.
 * Run: npx tsx server/scripts/holman-creation-probe.ts
 */
import { holmanApiService } from "../holman-api-service";

const BASE = {
  lesseeCode:   "2B56",
  vendorCode:   "OTH",
  division:     "01",
  assetType:    "TRUCK LD",
  vin:          "1FTPX14V69KB00001",   // fake test VIN
  modelYear:    "2018",
  firstName:    "TEST",
  lastName:     "PROBE",
  email:        "FLEET_SUPPORT@TRANSFORMCO.COM",
  driverClass:  "N",
  assignedStatusCode: "D",
  clientData3:  "890",
  deliveryDate: "2024-11-13",
  onRoadDate:   "2024-11-13",
  makeClient:   "FORD",
  modelClient:  "F-150",
};

async function probe(label: string, payload: object) {
  console.log(`\n--- ${label} ---`);
  console.log("Payload:", JSON.stringify(payload));
  try {
    const resp = await holmanApiService.submitVehicleArray([payload as any]);
    console.log("FULL response:", JSON.stringify(resp, null, 2));
  } catch (e: any) {
    console.log("ERROR:", e.message.slice(0, 500));
  }
}

async function main() {
  // Strategy 1: holmanVehicleNumber only (our current approach)
  await probe("Strategy 1: holmanVehicleNumber=088997 (existing range?)", {
    ...BASE,
    holmanVehicleNumber: "088997",
  });

  // Strategy 2: clientVehicleNumber only (let Holman auto-assign holmanVehicleNumber)
  await probe("Strategy 2: clientVehicleNumber=088997 (no holmanVehicleNumber)", {
    ...BASE,
    clientVehicleNumber: "088997",
  });

  // Strategy 3: both holmanVehicleNumber and clientVehicleNumber
  await probe("Strategy 3: both holmanVehicleNumber + clientVehicleNumber", {
    ...BASE,
    holmanVehicleNumber: "088997",
    clientVehicleNumber: "088997",
  });

  // Strategy 4: minimal payload (just lessee + vendorCode + vin)
  await probe("Strategy 4: minimal (lessee+vendor+vin only)", {
    lesseeCode:  "2B56",
    vendorCode:  "OTH",
    vin:         "1FTPX14V69KB00001",
  });

  // Strategy 5: existing known vehicle (088059) — should update/acknowledge existence
  await probe("Strategy 5: existing BYOV 088059 — should succeed", {
    ...BASE,
    holmanVehicleNumber: "088059",
    vin: "1FTPX14V69KB98946",  // real VIN of 088059
  });
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
