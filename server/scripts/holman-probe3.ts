/**
 * Probe 3: Test if `assetAction` field triggers new vehicle creation in Holman.
 * Also probe if any other creation endpoints exist.
 * Run: npx tsx server/scripts/holman-probe3.ts
 */
import { holmanApiService } from "../holman-api-service";

async function submit(label: string, payload: object) {
  console.log(`\n--- ${label} ---`);
  try {
    const resp = await holmanApiService.submitVehicleArray([payload as any]);
    const msg = (resp as any)?.message || "";
    const errors = (resp as any)?.errors?.[0]?.errorMessages || [];
    const token = (resp as any)?.userReferenceToken;
    console.log(`Result: ${msg}`);
    if (errors.length) console.log(`Errors: ${errors.join("; ")}`);
    if (token) console.log(`userReferenceToken: ${token}`);
  } catch (e: any) {
    console.log(`HTTP Error: ${e.message.slice(0, 300)}`);
  }
}

async function main() {
  const token = await (holmanApiService as any).authenticate();
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const apiBase = "https://api.holman.solutions/CustomerDataAPI";

  const BASE_PAYLOAD = {
    lesseeCode:          "2B56",
    vendorCode:          "OTH",
    division:            "01",
    holmanVehicleNumber: "088996",
    assetType:           "TRUCK LD",
    vin:                 "1FTPX14V69KB99996",
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
  };

  // Test assetAction values
  await submit("assetAction=ADD",    { ...BASE_PAYLOAD, assetAction: "ADD" });
  await submit("assetAction=CREATE", { ...BASE_PAYLOAD, assetAction: "CREATE" });
  await submit("assetAction=NEW",    { ...BASE_PAYLOAD, assetAction: "NEW" });
  await submit("assetAction=INSERT", { ...BASE_PAYLOAD, assetAction: "INSERT" });

  // Explore alternative endpoints
  const endpoints = [
    "/vehicles/add",
    "/vehicles/create",
    "/vehicles/enroll",
    "/vehicles/byov/submit",
    "/vehicles/new",
    "/fleet/vehicles/submit",
  ];

  console.log("\n=== Probing alternative creation endpoints ===");
  for (const ep of endpoints) {
    try {
      const r = await fetch(`${apiBase}${ep}`, {
        method: "POST",
        headers: { ...headers },
        body: JSON.stringify([{ ...BASE_PAYLOAD }]),
      });
      const body = await r.text();
      console.log(`${ep}: ${r.status} ${r.statusText} | ${body.slice(0, 150)}`);
    } catch (e: any) {
      console.log(`${ep}: EXCEPTION ${e.message.slice(0, 100)}`);
    }
  }

  // Also check GET /vehicles/submit spec (might return schema info)
  console.log("\n=== GET /vehicles/submit (schema discovery) ===");
  try {
    const r = await fetch(`${apiBase}/vehicles/submit`, { headers });
    console.log(`GET /vehicles/submit: ${r.status} | ${(await r.text()).slice(0, 200)}`);
  } catch (e: any) {
    console.log("ERROR:", e.message.slice(0, 100));
  }
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
