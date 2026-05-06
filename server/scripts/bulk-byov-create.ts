/**
 * Bulk BYOV Vehicle Creation — Holman & WMS
 *
 * Reads the BYOV status CSV and creates missing vehicles in Holman and/or WMS.
 * Run: npx tsx server/scripts/bulk-byov-create.ts
 *
 * Required env vars (same as production BYOV creation):
 *   HOLMAN_API_ENDPOINT, HOLMAN_CLIENT_ID, HOLMAN_CLIENT_SECRET
 *   WMS_ENGINE_BASE_URL, WMS_ENGINE_AUTH_ENDPOINT, WMS_ENGINE_AUTHORIZATION
 *   SNOWFLAKE_ACCOUNT, SNOWFLAKE_USER, SNOWFLAKE_PRIVATE_KEY (for TPMS addresses)
 */

import * as fs from "fs";
import * as path from "path";
import { holmanApiService } from "../holman-api-service";
import { wmsEngineService } from "../wms-engine-service";
import { toHolmanRef, toCanonical } from "../vehicle-number-utils";
import { initializeSnowflakeService, getSnowflakeService } from "../snowflake-service";

const CSV_PATH = path.resolve(
  process.cwd(),
  "attached_assets/BYOV_Dashboard_w_Status_2026-05-06_1778042639908.csv"
);

const DELAY_MS = 200;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Snowflake init (mirrors server/index.ts pattern)
// ---------------------------------------------------------------------------

async function initSnowflake(): Promise<boolean> {
  try {
    const account    = process.env.SNOWFLAKE_ACCOUNT;
    const username   = process.env.SNOWFLAKE_USER;
    let   privateKey = process.env.SNOWFLAKE_PRIVATE_KEY;

    if (!privateKey) {
      try {
        const { loadKeyFromFile } = await import("../snowflake-key-loader");
        const fileKey = loadKeyFromFile();
        if (fileKey) privateKey = fileKey;
      } catch { /* no key file in production */ }
    }

    if (!account || !username || !privateKey) {
      console.warn("[Snowflake] Credentials missing — address lookup will be skipped.");
      return false;
    }

    initializeSnowflakeService({
      account, username, privateKey,
      database:  process.env.SNOWFLAKE_DATABASE,
      schema:    process.env.SNOWFLAKE_SCHEMA,
      warehouse: process.env.SNOWFLAKE_WAREHOUSE,
      role:      process.env.SNOWFLAKE_ROLE,
    });
    console.log("[Snowflake] Service initialized.");
    return true;
  } catch (e: any) {
    console.warn("[Snowflake] Init failed:", e.message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// TPMS address lookup — fetches PRIMARYADDR1/2/CITY/STATE/ZIP from Snowflake
// ---------------------------------------------------------------------------

interface TpmsAddress {
  addr1:  string | null;
  addr2:  string | null;
  city:   string | null;
  state:  string | null;
  zip:    string | null;
}

async function fetchTpmsAddresses(
  ldaps: string[]
): Promise<Map<string, TpmsAddress>> {
  const map = new Map<string, TpmsAddress>();
  if (ldaps.length === 0) return map;

  try {
    const sf = getSnowflakeService();
    const placeholders = ldaps.map((_, i) => `?`).join(", ");
    const upperLdaps   = ldaps.map((l) => l.trim().toUpperCase());

    const rows = await sf.executeQuery(
      `SELECT ENTERPRISE_ID, PRIMARYADDR1, PRIMARYADDR2, PRIMARYCITY, PRIMARYSTATE, PRIMARYZIP
       FROM PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT
       WHERE UPPER(ENTERPRISE_ID) IN (${placeholders})`,
      upperLdaps
    ) as Array<{
      ENTERPRISE_ID: string;
      PRIMARYADDR1:  string | null;
      PRIMARYADDR2:  string | null;
      PRIMARYCITY:   string | null;
      PRIMARYSTATE:  string | null;
      PRIMARYZIP:    string | null;
    }>;

    for (const row of rows) {
      const key = (row.ENTERPRISE_ID ?? "").trim().toLowerCase();
      map.set(key, {
        addr1: row.PRIMARYADDR1?.trim() || null,
        addr2: row.PRIMARYADDR2?.trim() || null,
        city:  row.PRIMARYCITY?.trim()  || null,
        state: row.PRIMARYSTATE?.trim() || null,
        zip:   row.PRIMARYZIP?.trim()   || null,
      });
    }
    console.log(`[TPMS] Addresses fetched for ${map.size} / ${ldaps.length} techs.`);
  } catch (e: any) {
    console.warn("[TPMS] Address lookup failed:", e.message);
  }
  return map;
}

// ---------------------------------------------------------------------------
// CSV parsing helpers
// ---------------------------------------------------------------------------

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      fields.push(cur.trim()); cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur.trim());
  return fields;
}

interface CsvRow {
  status:        string;
  name:          string;
  ldap:          string;
  truckId:       string;
  district:      string;
  phone:         string;
  dateEnrolled:  string;
  regExpiration: string;
  vehicle:       string;
  vin:           string;
  licensePlate:  string;
  plateState:    string;
  cityState:     string;
}

function readCsv(): CsvRow[] {
  const raw  = fs.readFileSync(CSV_PATH);
  const text = raw.toString("latin1");
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const header = parseCsvLine(lines[0]);

  const idx = (name: string) => {
    const i = header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
    if (i === -1) throw new Error(`Column not found: "${name}"`);
    return i;
  };

  const iStatus     = idx("Status");
  const iName       = idx("Name");
  const iLdap       = idx("LDAP");
  const iTruck      = idx("Truck ID");
  const iDistrict   = idx("District");
  const iPhone      = idx("Phone Number");
  const iEnrolled   = idx("Date Enrolled");
  const iRegExp     = idx("Registration Expiration");
  const iVehicle    = idx("Vehicle");
  const iVin        = idx("VIN");
  const iPlate      = idx("License Plate");
  const iPlateState = idx("Plate State");
  const iCityState  = idx("City/State");

  return lines.slice(1).map((line) => {
    const f = parseCsvLine(line);
    return {
      status:        f[iStatus]     ?? "",
      name:          f[iName]       ?? "",
      ldap:          f[iLdap]       ?? "",
      truckId:       f[iTruck]      ?? "",
      district:      f[iDistrict]   ?? "",
      phone:         f[iPhone]      ?? "",
      dateEnrolled:  f[iEnrolled]   ?? "",
      regExpiration: f[iRegExp]     ?? "",
      vehicle:       f[iVehicle]    ?? "",
      vin:           f[iVin]        ?? "",
      licensePlate:  f[iPlate]      ?? "",
      plateState:    f[iPlateState] ?? "",
      cityState:     f[iCityState]  ?? "",
    };
  });
}

// ---------------------------------------------------------------------------
// Field extraction helpers
// ---------------------------------------------------------------------------

function parseVehicle(vehicleStr: string): { modelYear: number | null; make: string; model: string } {
  const parts = vehicleStr.trim().split(/\s+/);
  if (parts.length === 0) return { modelYear: null, make: "", model: "" };
  const year = Number(parts[0]);
  const yearValid = !isNaN(year) && year > 1900 && year < 2100;
  if (!yearValid) return { modelYear: null, make: parts[0] ?? "", model: parts.slice(1).join(" ") };
  if (parts.length === 1) return { modelYear: year, make: "", model: "" };
  if (parts.length === 2) return { modelYear: year, make: parts[1], model: "" };
  return { modelYear: year, make: parts[1], model: parts.slice(2).join(" ") };
}

function parseName(nameStr: string): { firstName: string; lastName: string } {
  const parts = nameStr.trim().replace(/\s+/g, " ").split(" ");
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

function parseCityState(cityStateStr: string): { city: string; state: string; zip: string } {
  const str = cityStateStr.trim();
  const match = str.match(/^(.+?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/i);
  if (match) return { city: match[1].trim(), state: match[2].trim().toUpperCase(), zip: match[3].trim() };
  const commaIdx = str.lastIndexOf(",");
  if (commaIdx !== -1) {
    const rest = str.slice(commaIdx + 1).trim().split(/\s+/);
    return { city: str.slice(0, commaIdx).trim(), state: rest[0] ?? "", zip: rest[1] ?? "" };
  }
  return { city: str, state: "", zip: "" };
}

function parseDate(dateStr: string): string | null {
  if (!dateStr) return null;
  const m = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

function toHolmanDate(isoDate: string | null): string | null {
  if (!isoDate) return null;
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return `${m[2]}/${m[3]}/${m[1]}`;
}

/**
 * Map vehicle make + model to Holman's required assetType.
 * Valid values: CAR | SUV | TRUCK LD | TRUCK MD | TRUCK HD | VAN
 */
function getAssetType(make: string, model: string, vehicleStr: string): string {
  const all = `${make} ${model} ${vehicleStr}`.toLowerCase();

  // TRUCK HD — check before MD/LD
  if (/f-?450|f-?550|f-?650|silverado\s*3500\s*hd|sierra\s*3500\s*hd/.test(all)) return "TRUCK HD";

  // TRUCK MD
  if (/f-?250|f-?350|ram\s*2500|ram\s*3500|silverado\s*2500|silverado\s*3500|sierra\s*2500|sierra\s*3500/.test(all)) return "TRUCK MD";

  // TRUCK LD
  if (/\bf-?150\b|ranger|tacoma|tundra|ridgeline|colorado|frontier|canyon|maverick|silverado|sierra|ram\s*1500|pickup/.test(all)) return "TRUCK LD";

  // VAN
  if (/\btransit\b|sienna|odyssey|caravan|town\s*&?\s*country|promaster|savana|\bexpress\b|\bnv\b|minivan/.test(all)) return "VAN";

  // SUV
  if (/explorer|rav.?4|outlander|4runner|equinox|trax|captiva|tucson|highlander|liberty|patriot|tahoe|pilot|cr.?v|\bescape\b|terrain|santa.?fe|pathfinder|rogue|passport|commander|grand.?cherokee|wrangler|trailblazer|blazer|compass|renegade|armada|xterra|murano|kicks|sportage|sorento|cx.?5|cx.?7|cx.?9|tiguan|atlas|q3|q5|q7|\brx\b|\bgx\b|sequoia|land.?cruiser|4.?runner|expedition|flex|edge/.test(all)) return "SUV";

  return "CAR";
}

// ---------------------------------------------------------------------------
// Payload builders
// ---------------------------------------------------------------------------

interface VehiclePayload {
  vehicleNumber:  string;
  vin:            string;
  modelYear:      number | null;
  make:           string;
  model:          string;
  assetType:      string;
  firstName:      string;
  lastName:       string;
  enterpriseId:   string;
  phone:          string;
  district:       string;
  addressLine1:   string | null;
  addressLine2:   string | null;
  city:           string | null;
  state:          string | null;
  zip:            string | null;
  licensePlate:   string;
  plateState:     string;
  regRenewalDate: string | null;
  deliveryDate:   string;
  onRoadDate:     string;
}

function buildPayload(row: CsvRow, tpmsAddr?: TpmsAddress): VehiclePayload {
  const { modelYear, make, model } = parseVehicle(row.vehicle);
  const { firstName, lastName }    = parseName(row.name);
  const csvAddr                    = parseCityState(row.cityState);
  const todayStr = new Date().toISOString().split("T")[0];
  const deliveryDate    = parseDate(row.dateEnrolled) || todayStr;
  const regRenewalDate  = parseDate(row.regExpiration);

  // Prefer TPMS address; fall back to CSV city/state
  const addressLine1 = tpmsAddr?.addr1 ?? null;
  const addressLine2 = tpmsAddr?.addr2 ?? null;
  const city  = tpmsAddr?.city  ?? csvAddr.city  ?? null;
  const state = tpmsAddr?.state ?? csvAddr.state ?? null;
  const zip   = tpmsAddr?.zip   ?? csvAddr.zip   ?? null;

  return {
    vehicleNumber: row.truckId.trim(),
    vin:           row.vin.trim(),
    modelYear,
    make,
    model,
    assetType:     getAssetType(make, model, row.vehicle),
    firstName,
    lastName,
    enterpriseId:  row.ldap.trim(),
    phone:         row.phone.trim(),
    district:      row.district.trim(),
    addressLine1,
    addressLine2,
    city,
    state,
    zip,
    licensePlate:  row.licensePlate.trim(),
    plateState:    row.plateState.trim(),
    regRenewalDate,
    deliveryDate,
    onRoadDate:    deliveryDate,
  };
}

// ---------------------------------------------------------------------------
// Holman creation
// ---------------------------------------------------------------------------

async function createInHolman(payload: VehiclePayload): Promise<{ success: boolean; skipped?: boolean; error?: string }> {
  const paddedVehicle = toHolmanRef(payload.vehicleNumber);
  if (!paddedVehicle) return { success: false, error: "Invalid vehicle number" };

  // Fast existence check
  const existing = await holmanApiService.getVehicleAssignedStatus(paddedVehicle);
  if (existing.found) {
    console.log(`  [Holman] ${paddedVehicle} already exists — skipping`);
    return { success: true, skipped: true };
  }
  console.log(`  [Holman] ${paddedVehicle} not found in Holman — proceeding with creation`);

  const NULL_VAL    = "^null^";
  const isUnknown   = payload.lastName.trim().toUpperCase() === "UNKNOWN";
  // clientData1 max 12 chars
  const clientData1 = isUnknown ? NULL_VAL : (payload.lastName ? payload.lastName.slice(0, 12) : null);
  const clientData2 = isUnknown ? NULL_VAL : (payload.enterpriseId || null);
  const clientData4 = isUnknown ? NULL_VAL : (payload.enterpriseId || null);
  const districtStr = String(payload.district).trim();
  const prefix      = toCanonical(districtStr) || districtStr || null;

  // License plate triple — Holman requires ALL THREE or none.
  // Only include when plate number, plate state, AND renewal date are all present
  // and the renewal date is in the future.
  const licenseFields = (() => {
    const renewalHolman = toHolmanDate(payload.regRenewalDate);
    const plate = payload.licensePlate?.trim() || "";
    const state = payload.plateState?.trim()   || "";
    if (plate && state && renewalHolman) {
      const [mo, day, yr] = renewalHolman.split("/").map(Number);
      if (new Date(yr, mo - 1, day) > new Date()) {
        return {
          licensePlate:     plate,
          tagStateProvince: state,
          plateType:        "PAS",
          renewalDate:      renewalHolman,
        };
      }
    }
    return {};
  })();

  // Sanitize address strings — strip # and collapse extra spaces
  const sanitizeAddr = (s: string | null) =>
    s ? s.replace(/#/g, "").replace(/\s{2,}/g, " ").trim() || null : null;

  // Address block — Holman requires addressLine1 + city + stateProvince + zipPostalCode
  // all together. If addressLine1 is missing, omit all address fields.
  const addressFields = payload.addressLine1
    ? {
        addressLine1:  sanitizeAddr(payload.addressLine1),
        addressLine2:  sanitizeAddr(payload.addressLine2) || null,
        addressLine3:  null,
        city:          payload.city   || null,
        stateProvince: payload.state  || null,
        zipPostalCode: payload.zip    || null,
        auxData7:      payload.zip    || null,
      }
    : {
        addressLine1:  null,
        addressLine2:  null,
        addressLine3:  null,
        city:          null,
        stateProvince: null,
        zipPostalCode: null,
        auxData7:      null,
      };

  const holmanPayload = {
    lesseeCode:          "2B56",
    holmanVehicleNumber: paddedVehicle,
    vendorCode:          "OTH",
    // "ADD" tells Holman to CREATE a new vehicle record (vs "UPDATE" for existing).
    // Omitting this field defaults to UPDATE behavior, causing silent no-ops for new vehicles.
    assetAction:         "ADD",
    division:            "01",
    // VIN max 17 chars — strip any extra text
    vin:                 payload.vin ? payload.vin.slice(0, 17) : null,
    modelYear:           payload.modelYear != null ? String(payload.modelYear) : null,
    assetType:           payload.assetType,
    firstName:           payload.firstName   || null,
    lastName:            payload.lastName    || null,
    email:               "FLEET_SUPPORT@TRANSFORMCO.COM",
    clientData1,
    clientData2,
    clientData3:         "890",
    clientData4,
    assignedStatusCode:  "D",
    driverClass:         "N",
    prefix,
    ...addressFields,
    ...licenseFields,
    deliveryDate:        toHolmanDate(payload.deliveryDate),
    onRoadDate:          toHolmanDate(payload.onRoadDate),
    workPhone:           payload.phone        || null,
    makeClient:          payload.make         || null,
    modelClient:         payload.model        || null,
  };

  try {
    const resp = await holmanApiService.submitVehicleArray([holmanPayload]);
    if (resp?.errorCount > 0 && resp?.validatedRecordCount === 0) {
      const errorMsgs = resp.errors?.[0]?.errorMessages?.join("; ") || "Unknown business error";
      if (/already.?exists|duplicate/i.test(errorMsgs)) {
        console.log(`  [Holman] ${paddedVehicle} already exists (business error) — skipping`);
        return { success: true, skipped: true };
      }
      console.error(`  [Holman] ${paddedVehicle} rejected by Holman:`, errorMsgs);
      return { success: false, error: errorMsgs };
    }
    console.log(`  [Holman] ${paddedVehicle} created OK:`, JSON.stringify(resp).slice(0, 200));
    return { success: true };
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/already.?exists|duplicate/i.test(msg)) {
      console.log(`  [Holman] ${paddedVehicle} already exists — skipping`);
      return { success: true, skipped: true };
    }
    console.error(`  [Holman] ${paddedVehicle} FAILED:`, msg);
    return { success: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// WMS creation
// ---------------------------------------------------------------------------

async function createInWms(payload: VehiclePayload): Promise<{ success: boolean; skipped?: boolean; error?: string }> {
  const paddedVehicle = toHolmanRef(payload.vehicleNumber);
  if (!paddedVehicle) return { success: false, error: "Invalid vehicle number" };
  const districtStr = String(payload.district).trim();
  const wmsCostCenter = districtStr ? districtStr.padStart(5, "0") : undefined;
  const wmsRegionNo   = "890".padStart(7, "0");

  const wmsPayload = {
    name:        paddedVehicle,
    locationId:  paddedVehicle,
    externalId:  paddedVehicle,
    description: `BYOV ${payload.make} ${payload.model} ${payload.modelYear ?? ""}`.trim(),
    isActive:    true,
    costCenter:  wmsCostCenter,
    regionNo:    wmsRegionNo,
    spareTruck:  false,
    useCaseId:   "Nexus",
  };

  type LookupOutcome = "exists" | "not_found" | "lookup_error";
  let lookupOutcome: LookupOutcome;
  let lookupErrMsg = "";

  try {
    const existing = await wmsEngineService.getTruck(paddedVehicle);
    lookupOutcome = existing ? "exists" : "not_found";
  } catch (lookupErr: any) {
    const status = lookupErr?.status ?? 0;
    const msg: string = lookupErr?.message ?? String(lookupErr);
    if (status === 404 || msg.includes("404")) {
      lookupOutcome = "not_found";
    } else {
      lookupOutcome = "lookup_error";
      lookupErrMsg  = msg;
    }
  }

  if (lookupOutcome === "exists") {
    console.log(`  [WMS] ${paddedVehicle} already exists — skipping`);
    return { success: true, skipped: true };
  }
  if (lookupOutcome === "lookup_error") {
    console.error(`  [WMS] ${paddedVehicle} ABORTED — WMS check failed: ${lookupErrMsg}`);
    return { success: false, error: `WMS existence check failed: ${lookupErrMsg}` };
  }

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
  name:          string;
  needsHolman:   boolean;
  needsWms:      boolean;
  holman?: { success: boolean; skipped?: boolean; error?: string };
  wms?:    { success: boolean; skipped?: boolean; error?: string };
}

async function main() {
  console.log("=== Bulk BYOV Vehicle Creation ===");
  console.log(`CSV: ${CSV_PATH}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log("");

  // Init Snowflake for TPMS address lookups
  const snowflakeReady = await initSnowflake();

  const rows = readCsv();
  console.log(`Total CSV rows (excluding header): ${rows.length}`);

  const actionable = rows.filter((r) => {
    const s = r.status.toLowerCase();
    return s.includes("not in holman") || s.includes("not in wms") || s.includes("not in mws");
  });
  console.log(`Actionable rows (need creation in at least one system): ${actionable.length}`);
  console.log("");

  // Pre-fetch TPMS addresses for all techs that need Holman creation
  let tpmsAddresses = new Map<string, TpmsAddress>();
  if (snowflakeReady) {
    const holmanRows = actionable.filter((r) => r.status.toLowerCase().includes("not in holman"));
    const ldaps = Array.from(new Set(holmanRows.map((r) => r.ldap.trim()).filter(Boolean)));
    console.log(`[TPMS] Looking up addresses for ${ldaps.length} techs...`);
    tpmsAddresses = await fetchTpmsAddresses(ldaps);
  }

  // Optional targeted retry: RETRY_VEHICLES=088125,088126,... npx tsx ...
  const retryFilter = process.env.RETRY_VEHICLES
    ? new Set(process.env.RETRY_VEHICLES.split(",").map(v => v.trim().padStart(6, "0")))
    : null;
  if (retryFilter) {
    console.log(`[RETRY] Filtering to ${retryFilter.size} specific vehicles: ${[...retryFilter].join(", ")}`);
  }

  const results: RowResult[] = [];

  for (const row of actionable) {
    const s          = row.status.toLowerCase();
    const needsHolman = s.includes("not in holman");
    const needsWms    = s.includes("not in wms") || s.includes("not in mws");

    // Skip if retry filter is active and this vehicle isn't in the list
    if (retryFilter) {
      const padded = toHolmanRef(row.truckId.trim());
      if (!padded || !retryFilter.has(padded)) continue;
    }

    const ldapKey = row.ldap.trim().toLowerCase();
    const tpmsAddr = tpmsAddresses.get(ldapKey);
    const payload  = buildPayload(row, tpmsAddr);
    const paddedVehicle = toHolmanRef(payload.vehicleNumber);

    console.log(`\n--- ${paddedVehicle} (${row.name.trim()}) ---`);
    console.log(`  Status: "${row.status}"`);
    console.log(`  Needs Holman: ${needsHolman} | Needs WMS: ${needsWms}`);
    console.log(`  Vehicle: ${row.vehicle} | VIN: ${payload.vin} | AssetType: ${payload.assetType}`);
    console.log(`  District: ${payload.district} | Address: ${payload.addressLine1 ?? "(no TPMS addr)"}, ${payload.city}, ${payload.state}`);

    const result: RowResult = { vehicleNumber: paddedVehicle, name: row.name.trim(), needsHolman, needsWms };

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
  const wmsResults    = results.filter((r) => r.needsWms);

  const holmanSuccess = holmanResults.filter((r) =>  r.holman?.success && !r.holman?.skipped).length;
  const holmanSkipped = holmanResults.filter((r) =>  r.holman?.skipped).length;
  const holmanFailed  = holmanResults.filter((r) => !r.holman?.success).length;

  const wmsSuccess = wmsResults.filter((r) =>  r.wms?.success && !r.wms?.skipped).length;
  const wmsSkipped = wmsResults.filter((r) =>  r.wms?.skipped).length;
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
      if (f.needsHolman && !f.holman?.success) console.log(`  Holman FAIL — ${f.vehicleNumber} (${f.name}): ${f.holman?.error}`);
      if (f.needsWms    && !f.wms?.success)    console.log(`  WMS FAIL   — ${f.vehicleNumber} (${f.name}): ${f.wms?.error}`);
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
