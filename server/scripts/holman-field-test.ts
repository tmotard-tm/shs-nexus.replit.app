import { holmanApiService } from "../holman-api-service";

async function testPayload(label: string, payload: any) {
  console.log(`\n--- ${label} ---`);
  try {
    const resp = await holmanApiService.submitVehicleArray([payload]);
    // Print full response to see all field names
    console.log("SUCCESS full:", JSON.stringify(resp));
    return true;
  } catch (err: any) {
    const msg = err.message;
    const match = msg.match(/`(\w+)` is invalid/);
    console.log("FAILED:", match ? `Field '${match[1]}' is invalid` : msg.slice(0, 300));
    return false;
  }
}

async function main() {
  const base = {
    lesseeCode: "2B56",
    holmanVehicleNumber: "088997",
    vendorCode: "OTH",
    vin: "TEST_VIN_PROBE2",
  };

  // Test Batch A without spareTruck
  await testPayload("Batch A (no spareTruck)", {
    ...base,
    modelYear: "2018",
    assetType: "AUTO",
    assignedStatusCode: "D",
    driverClass: "N",
    prefix: "8169",
  });

  // Test Batch E without regRenewalDate - just licensePlate, deliveryDate, onRoadDate
  await testPayload("Batch E2 (no regRenewalDate)", {
    ...base,
    licensePlate: "AXWV18",
    deliveryDate: "2025-10-22",
    onRoadDate: "2025-10-22",
  });

  // Test possible replacements for regRenewalDate
  await testPayload("regExpiration?", {
    ...base,
    registrationExpirationDate: "2027-02-28",
  });
  
  await testPayload("licenseExpDate?", {
    ...base,
    licenseExpDate: "2027-02-28",
  });
  
  await testPayload("registrationRenewalDate?", {
    ...base,
    registrationRenewalDate: "2027-02-28",
  });
}

main().catch(console.error);
