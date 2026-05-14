import { AmsApiService } from "../server/ams-api-service";

async function main() {
  const ams = new AmsApiService();
  if (!ams.hasCredentials()) {
    console.error("AMS credentials not configured");
    process.exit(1);
  }

  const limit = 500;
  let offset = 0;
  const activeByVin = new Map<string, string>(); // vin -> vehicleNumber (last seen)
  const vinOccurrences = new Map<string, number>(); // vin -> times seen across pages
  let totalSeen = 0;
  let pages = 0;
  let lastPage = false;

  while (!lastPage) {
    const resp: any = await ams.searchVehicles({ limit, offset });
    let rows: any[];
    if (Array.isArray(resp)) {
      rows = resp;
    } else if (resp && typeof resp === "object") {
      rows = Array.isArray(resp.data) ? resp.data
        : Array.isArray(resp.vehicles) ? resp.vehicles
        : Array.isArray(resp.results) ? resp.results
        : Array.isArray(resp.items) ? resp.items
        : [];
      if (rows.length === 0 && offset === 0) {
        console.warn(`[debug] response keys: ${Object.keys(resp).join(", ")}`);
      }
    } else {
      rows = [];
    }
    pages++;
    totalSeen += rows.length;
    for (const v of rows) {
      const vin = String(v.VIN || v.Vin || v.vin || "").trim().toUpperCase();
      if (!vin) continue;
      const saleDate = v.SaleDate;
      const oosDate = v.OutofSvcDate;
      const sold = saleDate != null && String(saleDate).trim() !== "";
      const oos = oosDate != null && String(oosDate).trim() !== "";
      const finalDispNum = Number(v.FinalDisposition ?? 0);
      const finalDisp = Number.isFinite(finalDispNum) && finalDispNum !== 0;
      if (sold || oos || finalDisp) continue;
      const vn = String(v.VehicleNumber ?? "").trim();
      activeByVin.set(vin, vn);
      vinOccurrences.set(vin, (vinOccurrences.get(vin) || 0) + 1);
    }
    if (rows.length < limit) lastPage = true;
    else offset += limit;
    if (offset > 50000) break;
  }

  // Group by vehicleNumber
  const byVehicleNumber = new Map<string, string[]>(); // vn -> vins[]
  for (const [vin, vn] of activeByVin.entries()) {
    if (!vn) continue;
    if (!byVehicleNumber.has(vn)) byVehicleNumber.set(vn, []);
    byVehicleNumber.get(vn)!.push(vin);
  }

  const dupes = [...byVehicleNumber.entries()].filter(([_, vins]) => vins.length > 1);
  const blanks = [...activeByVin.entries()].filter(([, vn]) => !vn).length;
  const vinDupes = [...vinOccurrences.entries()].filter(([, n]) => n > 1);

  console.log("--- VIN duplicate check ---");
  console.log(`Distinct active VINs  : ${vinOccurrences.size}`);
  console.log(`VINs seen >1 time     : ${vinDupes.length}`);
  if (vinDupes.length) {
    vinDupes
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .forEach(([vin, n]) => console.log(`  ${vin}  seen ${n}x  (vehicleNumber=${activeByVin.get(vin) || ""})`));
  }
  console.log("");

  console.log("=== AMS Active VehicleNumber Duplicate Report ===");
  console.log(`Pages fetched         : ${pages}`);
  console.log(`Total rows seen       : ${totalSeen}`);
  console.log(`Active VINs           : ${activeByVin.size}`);
  console.log(`Active w/ blank VN    : ${blanks}`);
  console.log(`Unique VehicleNumbers : ${byVehicleNumber.size}`);
  console.log(`Duplicate VN groups   : ${dupes.length}`);
  console.log(`Total dup VINs        : ${dupes.reduce((a, [, vins]) => a + vins.length, 0)}`);
  console.log("");
  if (dupes.length === 0) {
    console.log("No duplicate truck numbers among active AMS vehicles.");
    return;
  }
  console.log("VehicleNumber  |  count  |  VINs");
  console.log("---------------+---------+----------------------------------------");
  dupes
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .forEach(([vn, vins]) => {
      console.log(`${vn.padEnd(14)} | ${String(vins.length).padStart(5)}   | ${vins.join(", ")}`);
    });
}

main().catch(err => { console.error(err); process.exit(1); });
