import { getTPMSService } from "../server/tpms-service";
const tpms = getTPMSService();

async function main() {
  console.log("=== TPMS diagnostic for MMOHAM0 / truck 046965 ===\n");

  console.log("--- Live tech info: MMOHAM0 ---");
  const tech = await tpms.getTechInfo("MMOHAM0");
  console.log(JSON.stringify(tech, null, 2));

  console.log("\n--- Truck lookup: 046965 (cached only) ---");
  const truck = await tpms.lookupByTruckNumber("046965");
  console.log(JSON.stringify(truck, null, 2));

  console.log("\n--- Truck lookup: 46965 (cached only) ---");
  const truck2 = await tpms.lookupByTruckNumber("46965");
  console.log(JSON.stringify(truck2, null, 2));

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
