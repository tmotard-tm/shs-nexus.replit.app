/**
 * Bulk BYOV Vehicle Creation — Holman & WMS
 *
 * Reads the BYOV status CSV and creates missing vehicles in Holman and/or WMS.
 * Run: npx tsx server/scripts/bulk-byov-create.ts
 *
 * Required env vars (same as production BYOV creation):
 *   HOLMAN_API_ENDPOINT, HOLMAN_CLIENT_ID, HOLMAN_CLIENT_SECRET
 *   WMS_ENGINE_BASE_URL, WMS_ENGINE_AUTH_ENDPOINT, WMS_ENGINE_AUTHORIZATION
 */

import * as fs from "fs";
import * as path from "path";
import { holmanApiService } from "../holman-api-service";
import { wmsEngineService } from "../wms-engine-service";
import { toHolmanRef, toCanonical } from "../vehicle-number-utils";

const CSV_PATH = path.resolve(
  process.cwd(),
  "attached_assets/BYOV_Dashboard_w_Status_2026-05-06_1778033723628.csv"
);

const DELAY_MS = 500; // throttle between API calls
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// CSV parsing helpers
// ---------------------------------------------------------------------------

/** Parse a CSV line respecting double-quoted fields (may contain commas) */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur.trim());
  return fields;
}

interface CsvRow {
  status: string;
  name: string;
  ldap: string;
  truckId: string;
  district: string;
  phone: string;
  dateEnrolled: string;
  regExpiration: string;
  vehicle: string;
  vin: string;
  licensePlate: string;
  plateState: string;
  cityState: string;
}

function readCsv(): CsvRow[] {
  const raw = fs.readFileSync(CSV_PATH);
  const text = raw.toString("latin1"); // iso-8859-1
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const header = parseCsvLine(lines[0]);

  const idx = (name: string) => {
    const i = header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
    if (i === -1) throw new Error(`Column not found: "${name}"`);
    return i;
  };

  const iStatus    = idx("Status");
  const iName      = idx("Name");
  const iLdap      = idx("LDAP");
  const iTruck     = idx("Truck ID");
  const iDistrict  = idx("District");
  const iPhone     = idx("Phone Number");
  const iEnrolled  = idx("Date Enrolled");
  const iRegExp    = idx("Registration Expiration");
  const iVehicle   = idx("Vehicle");
  const iVin       = idx("VIN");
  const iPlate     = idx("License Plate");
  const iPlateState = idx("Plate State");
  const iCityState = idx("City/State");

  return lines.slice(1).map((line) => {
    const f = parseCsvLine(line);
    return {
      status:       f[iStatus]      ?? "",
      name:         f[iName]        ?? "",
      ldap:         f[iLdap]        ?? "",
      truckId:      f[iTruck]       ?? "",
      district:     f[iDistrict]    ?? "",
      phone:        f[iPhone]       ?? "",
      dateEnrolled: f[iEnrolled]    ?? "",
      regExpiration:f[iRegExp]      ?? "",
      vehicle:      f[iVehicle]     ?? "",
      vin:          f[iVin]         ?? "",
      licensePlate: f[iPlate]       ?? "",
      plateState:   f[iPlateState]  ?? "",
      cityState:    f[iCityState]   ?? "",
    };
  });
}

// ---------------------------------------------------------------------------
// Field extraction helpers
// ---------------------------------------------------------------------------

/** Parse "2022 Nissan Kick" → { modelYear: 2022, make: "Nissan", model: "Kick" } */
function parseVehicle(vehicleStr: string): { modelYear: number | null; make: string; model: string } {
  const parts = vehicleStr.trim().split(/\s+/);
  // Expect at least "YEAR MAKE MODEL" — handle short/malformed strings gracefully
  if (parts.length === 0) return { modelYear: null, make: "", model: "" };
  const year = Number(parts[0]);
  const yearValid = !isNaN(year) && year > 1900 && year < 2100;
  if (!yearValid) {
    // No leading year — treat entire string as model, make unknown
    return { modelYear: null, make: parts[0] ?? "", model: parts.slice(1).join(" ") };
  }
  if (parts.length === 1) return { modelYear: year, make: "", model: "" };
  if (parts.length === 2) return { modelYear: year, make: parts[1], model: "" };
  return { modelYear: year, make: parts[1], model: parts.slice(2).join(" ") };
}

/** Parse "John Michael Smith" → { firstName: "John Michael", lastName: "Smith" } */
function parseName(nameStr: string): { firstName: string; lastName: string } {
  const parts = nameStr.trim().replace(/\s+/g, " ").split(" ");
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  const lastName = parts[parts.length - 1];
  const firstName = parts.slice(0, parts.length - 1).join(" ");
  return { firstName, lastName };
}

/** Parse "WILLARD, NC 28478" → { city: "WILLARD", state: "NC", zip: "28478" }
 *  Also handles "Show Low, AZ 85901" */
function parseCityState(cityStateStr: string): { city: string; state: string; zip: string } {
  const str = cityStateStr.trim();
  // Pattern: "CITY, ST ZIP" or "CITY ST ZIP"
  const match = str.match(/^(.+?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/i);
  if (match) {
    return { city: match[1].trim(), state: match[2].trim().toUpperCase(), zip: match[3].trim() };
  }
  // Fallback: try splitting on last comma
  const commaIdx = str.lastIndexOf(",");
  if (commaIdx !== -1) {
    const city = str.slice(0, commaIdx).trim();
    const rest = str.slice(commaIdx + 1).trim().split(/\s+/);
    return { city, state: rest[0] ?? "", zip: rest[1] ?? "" };
  }
  return { city: str, state: "", zip: "" };
}

/** Convert "5/31/2028" or "11/29/2024" → "2028-05-31" */
function parseDate(dateStr: string): string | null {
  if (!dateStr) return null;
  const m = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, mo, d, y] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Payload builders
// ---------------------------------------------------------------------------

interface VehiclePayload {
  vehicleNumber: string;
  vin: string;
  modelYear: number | null;
  make: string;
  model: string;
  firstName: string;
  lastName: string;
  enterpriseId: string;
  phone: string;
  district: string;
  city: string;
  state: string;
  zip: string;
  licensePlate: string;
  plateState: string;
  regRenewalDate: string | null;
  deliveryDate: string;
  onRoadDate: string;
}

function buildPayload(row: CsvRow): VehiclePayload {
  const { modelYear, make, model } = parseVehicle(row.vehicle);
  const { firstName, lastName } = parseName(row.name);
  const { city, state, zip } = parseCityState(row.cityState);
  const todayStr = new Date().toISOString().split("T")[0];
  const deliveryDate = parseDate(row.dateEnrolled) || todayStr;
  const regRenewalDate = parseDate(row.regExpiration);

  return {
    vehicleNumber: row.truckId.trim(),
    vin: row.vin.trim(),
    modelYear,
    make,
    model,
    firstName,
    lastName,
    enterpriseId: row.ldap.trim(),
    phone: row.phone.trim(),
    district: row.district.trim(),
    city,
    state,
    zip,
    licensePlate: row.licensePlate.trim() || "UNKNOWN",
    plateState: row.plateState.trim(),
    regRenewalDate,
    deliveryDate,
    onRoadDate: deliveryDate,
  };
}

// ---------------------------------------------------------------------------
// Holman creation
// ---------------------------------------------------------------------------

async function createInHolman(payload: VehiclePayload): Promise<{ success: boolean; skipped?: boolean; error?: string }> {
  const paddedVehicle = toHolmanRef(payload.vehicleNumber);
  if (!paddedVehicle) return { success: false, error: "Invalid vehicle number" };

  // Fail-closed duplicate check: distinguish "not found" from lookup errors.
  // findVehicleByNumber returns success:false for both. We inspect the error message
  // to tell them apart — anything other than an explicit "no vehicle found" message
  // is treated as a lookup failure and we abort to avoid accidental duplication.
  const existing = await holmanApiService.findVehicleByNumber(paddedVehicle);
  if (existing.success) {
    console.log(`  [Holman] ${paddedVehicle} already exists — skipping`);
    return { success: true, skipped: true };
  }
  if (existing.error) {
    const isNotFound = /no vehicle found/i.test(existing.error);
    if (!isNotFound) {
      const msg = `Holman existence check failed (fail-closed): ${existing.error}`;
      console.error(`  [Holman] ${paddedVehicle} ABORTED — ${msg}`);
      return { success: false, error: msg };
    }
    // "No vehicle found" → safe to proceed with creation
    console.log(`  [Holman] ${paddedVehicle} confirmed absent in Holman — proceeding with creation`);
  }

  const NULL_VAL = "^null^";
  const isUnknown = payload.lastName.trim().toUpperCase() === "UNKNOWN";
  const clientData1 = isUnknown ? NULL_VAL : (payload.lastName || null);
  const clientData2 = isUnknown ? NULL_VAL : (payload.enterpriseId || null);
  const clientData4 = isUnknown ? NULL_VAL : (payload.enterpriseId || null);
  const districtStr = String(payload.district).trim();
  // Strip leading zeros per task spec: "strip leading zeros for prefix"
  const prefix = toCanonical(districtStr) || districtStr || null;

  const holmanPayload = {
    lesseeCode: "2B56",
    holmanVehicleNumber: paddedVehicle,
    vendorCode: "OTH",
    vin: payload.vin || null,
    modelYear: payload.modelYear,
    makeVin: payload.make || null,
    modelVin: payload.model || null,
    assetType: "AUTO",
    firstName: payload.firstName || null,
    lastName: payload.lastName || null,
    email: "FLEET_SUPPORT@TRANSFORMCO.COM",
    clientData1,
    clientData2,
    clientData3: "890",
    clientData4,
    assignedStatusCode: "D",
    driverClass: "N",
    prefix,
    addressLine1: "UNKNOWN",
    city: payload.city || null,
    stateProvince: payload.state || null,
    zipPostalCode: payload.zip || null,
    auxData7: payload.zip || null,
    licensePlate: payload.licensePlate || null,
    licenseState: payload.plateState || null,
    licensePlateType: "STANDARD",
    regRenewalDate: payload.regRenewalDate || null,
    deliveryDate: payload.deliveryDate,
    onRoadDate: payload.onRoadDate,
    workPhone: payload.phone || null,
    isActive: true,
    spareTruck: false,
  };

  try {
    const resp = await holmanApiService.submitVehicleArray([holmanPayload]);
    console.log(`  [Holman] ${paddedVehicle} created OK:`, JSON.stringify(resp).slice(0, 200));
    return { success: true };
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  [Holman] ${paddedVehicle} FAILED:`, msg);
    return { success: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// WMS creation
// ---------------------------------------------------------------------------

async function createInWms(payload: VehiclePayload): Promise<{ success: boolean; skipped?: boolean; error?: string }> {
  const paddedVehicle = toHolmanRef(payload.vehicleNumber); // same 6-digit padding
  if (!paddedVehicle) return { success: false, error: "Invalid vehicle number" };
  const districtStr = String(payload.district).trim();
  const wmsCostCenter = districtStr ? districtStr.padStart(5, "0") : undefined;
  const wmsRegionNo = "890".padStart(7, "0");

  const wmsPayload = {
    name: paddedVehicle,
    locationId: paddedVehicle,
    externalId: paddedVehicle,
    description: `BYOV ${payload.make} ${payload.model} ${payload.modelYear ?? ""}`.trim(),
    isActive: true,
    costCenter: wmsCostCenter,
    regionNo: wmsRegionNo,
    spareTruck: false,
    useCaseId: "Nexus",
  };

  // Fail-closed duplicate check:
  //   - getTruck() resolves with data → already exists → skip
  //   - getTruck() throws with status 404 → confirmed absent → proceed
  //   - getTruck() throws with any other error → unknown state → abort (do not create)
  type LookupOutcome = "exists" | "not_found" | "lookup_error";
  let lookupOutcome: LookupOutcome;
  let lookupErrMsg = "";

  try {
    const existing = await wmsEngineService.getTruck(paddedVehicle);
    if (existing) {
      lookupOutcome = "exists";
    } else {
      // Null/undefined response — treat as not found
      lookupOutcome = "not_found";
    }
  } catch (lookupErr: any) {
    const status = lookupErr?.status ?? 0;
    const msg: string = lookupErr?.message ?? String(lookupErr);
    const is404 = status === 404 || msg.includes("404");
    if (is404) {
      lookupOutcome = "not_found";
    } else {
      lookupOutcome = "lookup_error";
      lookupErrMsg = msg;
    }
  }

  if (lookupOutcome === "exists") {
    console.log(`  [WMS] ${paddedVehicle} already exists — skipping`);
    return { success: true, skipped: true };
  }

  if (lookupOutcome === "lookup_error") {
    const errMsg = `WMS existence check failed (fail-closed): ${lookupErrMsg}`;
    console.error(`  [WMS] ${paddedVehicle} ABORTED — ${errMsg}`);
    return { success: false, error: errMsg };
  }

  // lookupOutcome === "not_found" — safe to create
  console.log(`  [WMS] ${paddedVehicle} confirmed absent in WMS — proceeding with creation`);

  try {
    const resp = await wmsEngineService.createTruck(wmsPayload);
    console.log(`  [WMS] ${paddedVehicle} created OK:`, JSON.stringify(resp).slice(0, 200));
    return { success: true };
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  [WMS] ${paddedVehicle} FAILED:`, msg);
    return { success: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface RowResult {
  vehicleNumber: string;
  name: string;
  needsHolman: boolean;
  needsWms: boolean;
  holman?: { success: boolean; skipped?: boolean; error?: string };
  wms?: { success: boolean; skipped?: boolean; error?: string };
}

async function main() {
  console.log("=== Bulk BYOV Vehicle Creation ===");
  console.log(`CSV: ${CSV_PATH}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log("");

  const rows = readCsv();
  console.log(`Total CSV rows (excluding header): ${rows.length}`);

  // Filter actionable rows
  const actionable = rows.filter((r) => {
    const s = r.status.toLowerCase();
    return s.includes("not in holman") || s.includes("not in wms") || s.includes("not in mws");
  });

  console.log(`Actionable rows (need creation in at least one system): ${actionable.length}`);
  console.log("");

  const results: RowResult[] = [];

  for (const row of actionable) {
    const s = row.status.toLowerCase();
    const needsHolman = s.includes("not in holman");
    const needsWms = s.includes("not in wms") || s.includes("not in mws");

    const payload = buildPayload(row);
    const paddedVehicle = toHolmanRef(payload.vehicleNumber);

    console.log(`\n--- ${paddedVehicle} (${row.name.trim()}) ---`);
    console.log(`  Status: "${row.status}"`);
    console.log(`  Needs Holman: ${needsHolman} | Needs WMS: ${needsWms}`);
    console.log(`  Vehicle: ${row.vehicle} | VIN: ${payload.vin}`);
    console.log(`  District: ${payload.district} | City/State: ${row.cityState}`);

    const result: RowResult = {
      vehicleNumber: paddedVehicle,
      name: row.name.trim(),
      needsHolman,
      needsWms,
    };

    if (needsHolman) {
      await sleep(DELAY_MS);
      result.holman = await createInHolman(payload);
    }

    if (needsWms) {
      await sleep(DELAY_MS);
      result.wms = await createInWms(payload);
    }

    results.push(result);
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log("\n\n=== SUMMARY ===");
  console.log(`Total attempted: ${results.length}`);

  const holmanResults = results.filter((r) => r.needsHolman);
  const wmsResults = results.filter((r) => r.needsWms);

  const holmanSuccess = holmanResults.filter((r) => r.holman?.success && !r.holman?.skipped).length;
  const holmanSkipped = holmanResults.filter((r) => r.holman?.skipped).length;
  const holmanFailed  = holmanResults.filter((r) => !r.holman?.success).length;

  const wmsSuccess = wmsResults.filter((r) => r.wms?.success && !r.wms?.skipped).length;
  const wmsSkipped = wmsResults.filter((r) => r.wms?.skipped).length;
  const wmsFailed  = wmsResults.filter((r) => !r.wms?.success).length;

  console.log(`\nHolman (${holmanResults.length} vehicles):`);
  console.log(`  Created:  ${holmanSuccess}`);
  console.log(`  Skipped (already existed): ${holmanSkipped}`);
  console.log(`  Failed:   ${holmanFailed}`);

  console.log(`\nWMS (${wmsResults.length} vehicles):`);
  console.log(`  Created:  ${wmsSuccess}`);
  console.log(`  Skipped (already existed): ${wmsSkipped}`);
  console.log(`  Failed:   ${wmsFailed}`);

  const failures = results.filter(
    (r) => (r.needsHolman && !r.holman?.success) || (r.needsWms && !r.wms?.success)
  );

  if (failures.length > 0) {
    console.log(`\nFailed vehicles:`);
    for (const f of failures) {
      if (f.needsHolman && !f.holman?.success) {
        console.log(`  Holman FAIL — ${f.vehicleNumber} (${f.name}): ${f.holman?.error}`);
      }
      if (f.needsWms && !f.wms?.success) {
        console.log(`  WMS FAIL   — ${f.vehicleNumber} (${f.name}): ${f.wms?.error}`);
      }
    }
  } else {
    console.log("\nAll vehicles processed successfully (or skipped as already present).");
  }

  console.log("\n=== DONE ===");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
