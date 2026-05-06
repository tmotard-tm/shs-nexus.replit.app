/**
 * Bulk BYOV Vehicle Assignment — Holman & WMS
 *
 * Reads the BYOV status CSV and assigns each vehicle to its technician
 * (identified by the LDAP column) in both Holman and WMS.
 *
 * Run: npx tsx server/scripts/bulk-byov-assign.ts [--force]
 *
 * Flags:
 *   --force   When a technician is already assigned to a different truck in WMS,
 *             delete the old assignment first (fail-closed) and then create the
 *             new one. Without this flag the existing assignment is updated via PUT.
 *
 * Required env vars (same as production BYOV assignment):
 *   HOLMAN_API_ENDPOINT, HOLMAN_CLIENT_ID, HOLMAN_CLIENT_SECRET
 *   WMS_ENGINE_BASE_URL, WMS_ENGINE_AUTH_ENDPOINT, WMS_ENGINE_AUTHORIZATION
 */

import * as fs from "fs";
import * as path from "path";
import { holmanApiService } from "../holman-api-service";
import { wmsEngineService } from "../wms-engine-service";
import { toHolmanRef } from "../vehicle-number-utils";

const CSV_PATH = path.resolve(
  process.cwd(),
  "attached_assets/BYOV_Dashboard_w_Status_2026-05-06_1778033723628.csv"
);

const DELAY_MS = 500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// CSV parsing (shared with bulk-byov-create.ts)
// ---------------------------------------------------------------------------

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
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
      status:        f[iStatus]      ?? "",
      name:          f[iName]        ?? "",
      ldap:          f[iLdap]        ?? "",
      truckId:       f[iTruck]       ?? "",
      district:      f[iDistrict]    ?? "",
      phone:         f[iPhone]       ?? "",
      dateEnrolled:  f[iEnrolled]    ?? "",
      regExpiration: f[iRegExp]      ?? "",
      vehicle:       f[iVehicle]     ?? "",
      vin:           f[iVin]         ?? "",
      licensePlate:  f[iPlate]       ?? "",
      plateState:    f[iPlateState]  ?? "",
      cityState:     f[iCityState]   ?? "",
    };
  });
}

// ---------------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------------

function parseName(nameStr: string): { firstName: string; lastName: string } {
  const parts = nameStr.trim().replace(/\s+/g, " ").split(" ");
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  const lastName = parts[parts.length - 1];
  const firstName = parts.slice(0, parts.length - 1).join(" ");
  return { firstName, lastName };
}

function parseCityState(cityStateStr: string): { city: string; state: string; zip: string } {
  const str = cityStateStr.trim();
  const match = str.match(/^(.+?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/i);
  if (match) {
    return { city: match[1].trim(), state: match[2].trim().toUpperCase(), zip: match[3].trim() };
  }
  const commaIdx = str.lastIndexOf(",");
  if (commaIdx !== -1) {
    const city = str.slice(0, commaIdx).trim();
    const rest = str.slice(commaIdx + 1).trim().split(/\s+/);
    return { city, state: rest[0] ?? "", zip: rest[1] ?? "" };
  }
  return { city: str, state: "", zip: "" };
}

function normalizeString(val: any): string | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  if (s === "" || s.toLowerCase() === "null") return null;
  return s;
}

// ---------------------------------------------------------------------------
// Holman assignment
// ---------------------------------------------------------------------------

async function assignInHolman(
  vehicleNumber: string,
  row: CsvRow
): Promise<{ success: boolean; skipped?: boolean; error?: string }> {
  const paddedVehicle = toHolmanRef(vehicleNumber);
  if (!paddedVehicle) return { success: false, error: "Invalid vehicle number" };

  const ldap = row.ldap.trim();
  if (!ldap) return { success: false, error: "No LDAP/enterprise ID in CSV row" };

  const { firstName, lastName } = parseName(row.name);
  const { city, state, zip } = parseCityState(row.cityState);
  const districtStr = String(row.district).trim();
  // Use last 4 chars of district as prefix (same logic as holman-assignment-update-service.ts)
  const districtPrefix = districtStr ? districtStr.slice(-4) : null;

  const NULL_VAL = "^null^";
  const cityUpper = city ? city.toUpperCase() : null;

  // BYOV vehicles always use assignedStatusCode 'D' (same as holman-assignment-update-service.ts isBYOV check)
  const payload = {
    lesseeCode: "2B56",
    holmanVehicleNumber: paddedVehicle,
    email: "FLEET_SUPPORT@TRANSFORMCO.COM",
    firstName: normalizeString(firstName),
    lastName: normalizeString(lastName),
    clientData1: lastName ? lastName.substring(0, 12) : null,
    clientData2: ldap,
    clientData3: "890",
    clientData4: ldap,
    clientData5: NULL_VAL,
    clientData6: NULL_VAL,
    clientData7: NULL_VAL,
    auxData1: NULL_VAL,
    auxData2: NULL_VAL,
    auxData3: NULL_VAL,
    auxData4: NULL_VAL,
    auxData5: NULL_VAL,
    auxData6: cityUpper,
    auxData7: normalizeString(zip),
    auxData8: NULL_VAL,
    auxData9: NULL_VAL,
    auxData10: NULL_VAL,
    auxData11: NULL_VAL,
    auxData12: NULL_VAL,
    auxData13: NULL_VAL,
    auxData14: NULL_VAL,
    assignedStatusCode: "D",
    prefix: districtPrefix,
    addressLine1: "UNKNOWN",
    addressLine2: null,
    addressLine3: null,
    city: cityUpper,
    stateProvince: normalizeString(state)?.toUpperCase() || null,
    zipPostalCode: normalizeString(zip),
    homePhone: null,
    workPhone: normalizeString(row.phone),
    workPhoneExtension: null,
    cellPhone: null,
  };

  try {
    const resp = await holmanApiService.submitVehicleArray([payload]);
    console.log(`  [Holman] ${paddedVehicle} → ${ldap} assigned OK:`, JSON.stringify(resp).slice(0, 200));
    return { success: true };
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  [Holman] ${paddedVehicle} → ${ldap} FAILED:`, msg);
    return { success: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// WMS assignment
// ---------------------------------------------------------------------------

async function assignInWms(
  vehicleNumber: string,
  ldap: string,
  force: boolean
): Promise<{ success: boolean; skipped?: boolean; swapped?: boolean; previousTruck?: string; error?: string }> {
  const paddedVehicle = toHolmanRef(vehicleNumber);
  if (!paddedVehicle) return { success: false, error: "Invalid vehicle number" };
  if (!ldap) return { success: false, error: "No LDAP/enterprise ID" };

  // Check if this tech already has an assignment.
  // If assigned to same truck → skip. If different truck → force-swap or update. If none → create.
  let existingTruck: string | null = null;
  try {
    const existing = await wmsEngineService.getAssignment(ldap);
    if (existing && (existing.name || existing.id)) {
      existingTruck = existing.name || existing.id || "";
      if (existingTruck === paddedVehicle) {
        console.log(`  [WMS] ${paddedVehicle} already assigned to ${ldap} — skipping`);
        return { success: true, skipped: true };
      }
      // Tech exists but points to a different truck
      if (force) {
        console.log(
          `  [WMS] CONFLICT: ${ldap} is assigned to "${existingTruck}" — force-swapping to "${paddedVehicle}"`
        );
      } else {
        console.log(
          `  [WMS] ${ldap} currently assigned to "${existingTruck}" — updating to "${paddedVehicle}"`
        );
      }
    }
  } catch (lookupErr: any) {
    const status = lookupErr?.status ?? 0;
    const msg: string = lookupErr?.message ?? String(lookupErr);
    const is404 = status === 404 || msg.includes("404");
    if (!is404) {
      // Unknown error — fail closed
      const errMsg = `WMS assignment lookup failed (fail-closed): ${msg}`;
      console.error(`  [WMS] ${paddedVehicle} → ${ldap} ABORTED — ${errMsg}`);
      return { success: false, error: errMsg };
    }
    // 404 means no existing assignment → safe to create
  }

  try {
    let resp: any;
    if (existingTruck !== null) {
      if (force) {
        // --force: delete old assignment first (fail-closed), then create fresh
        try {
          await wmsEngineService.deleteAssignment(ldap);
          console.log(`  [WMS] Deleted old assignment for ${ldap} (was: "${existingTruck}")`);
        } catch (delErr: any) {
          const delMsg = delErr instanceof Error ? delErr.message : String(delErr);
          const errMsg = `deleteAssignment failed (fail-closed): ${delMsg}`;
          console.error(`  [WMS] ${paddedVehicle} → ${ldap} ABORTED — ${errMsg}`);
          return { success: false, error: errMsg };
        }
        resp = await wmsEngineService.createAssignment({ techId: ldap, truckId: paddedVehicle });
        console.log(
          `  [WMS] SWAP ${existingTruck} → ${paddedVehicle} for ${ldap} created OK:`,
          JSON.stringify(resp).slice(0, 200)
        );
        return { success: true, swapped: true, previousTruck: existingTruck };
      } else {
        // Default: update via PUT
        resp = await wmsEngineService.updateAssignment(ldap, { techId: ldap, truckId: paddedVehicle });
        console.log(`  [WMS] ${paddedVehicle} → ${ldap} updated OK:`, JSON.stringify(resp).slice(0, 200));
      }
    } else {
      resp = await wmsEngineService.createAssignment({ techId: ldap, truckId: paddedVehicle });
      console.log(`  [WMS] ${paddedVehicle} → ${ldap} created OK:`, JSON.stringify(resp).slice(0, 200));
    }
    return { success: true };
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  [WMS] ${paddedVehicle} → ${ldap} FAILED:`, msg);
    return { success: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface RowResult {
  vehicleNumber: string;
  name: string;
  ldap: string;
  holman: { success: boolean; skipped?: boolean; error?: string };
  wms:    { success: boolean; skipped?: boolean; swapped?: boolean; previousTruck?: string; error?: string };
}

async function main() {
  const force = process.argv.includes("--force");

  console.log("=== Bulk BYOV Vehicle Assignment ===");
  console.log(`CSV: ${CSV_PATH}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  if (force) {
    console.log("Mode: --force (conflicting WMS assignments will be deleted then re-created)");
  }
  console.log("");

  const rows = readCsv();
  console.log(`Total CSV rows (excluding header): ${rows.length}`);

  // Assign all rows that have a valid LDAP and truck ID
  const assignable = rows.filter((r) => r.ldap.trim() && r.truckId.trim());
  const skippedNoData = rows.length - assignable.length;

  console.log(`Assignable rows (have LDAP + Truck ID): ${assignable.length}`);
  if (skippedNoData > 0) {
    console.log(`Skipped (missing LDAP or Truck ID): ${skippedNoData}`);
  }
  console.log("");

  const results: RowResult[] = [];

  for (const row of assignable) {
    const paddedVehicle = toHolmanRef(row.truckId.trim());
    const ldap = row.ldap.trim();

    console.log(`\n--- ${paddedVehicle} (${row.name.trim()}) [${ldap}] ---`);
    console.log(`  Status: "${row.status}"`);
    console.log(`  District: ${row.district} | City/State: ${row.cityState}`);

    await sleep(DELAY_MS);
    const holmanResult = await assignInHolman(row.truckId.trim(), row);

    await sleep(DELAY_MS);
    const wmsResult = await assignInWms(row.truckId.trim(), ldap, force);

    results.push({
      vehicleNumber: paddedVehicle,
      name: row.name.trim(),
      ldap,
      holman: holmanResult,
      wms: wmsResult,
    });
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log("\n\n=== SUMMARY ===");
  console.log(`Total attempted: ${results.length}`);

  const holmanSuccess = results.filter((r) => r.holman.success && !r.holman.skipped).length;
  const holmanSkipped = results.filter((r) => r.holman.skipped).length;
  const holmanFailed  = results.filter((r) => !r.holman.success).length;

  const wmsSuccess = results.filter((r) => r.wms.success && !r.wms.skipped && !r.wms.swapped).length;
  const wmsSkipped = results.filter((r) => r.wms.skipped).length;
  const wmsSwapped = results.filter((r) => r.wms.swapped).length;
  const wmsFailed  = results.filter((r) => !r.wms.success).length;

  console.log(`\nHolman assignments (${results.length} vehicles):`);
  console.log(`  Assigned: ${holmanSuccess}`);
  console.log(`  Skipped (already assigned or conflict): ${holmanSkipped}`);
  console.log(`  Failed:   ${holmanFailed}`);

  console.log(`\nWMS assignments (${results.length} vehicles):`);
  console.log(`  Assigned: ${wmsSuccess}`);
  console.log(`  Skipped (already assigned to same truck): ${wmsSkipped}`);
  if (force) {
    console.log(`  Force-swapped (deleted old, created new): ${wmsSwapped}`);
  }
  console.log(`  Failed:   ${wmsFailed}`);

  if (wmsSwapped > 0) {
    console.log(`\nForce-swapped trucks:`);
    for (const r of results.filter((r) => r.wms.swapped)) {
      console.log(`  ${r.name} [${r.ldap}]: ${r.wms.previousTruck ?? "?"} → ${r.vehicleNumber}`);
    }
  }

  const failures = results.filter((r) => !r.holman.success || !r.wms.success);

  if (failures.length > 0) {
    console.log(`\nFailed assignments:`);
    for (const f of failures) {
      if (!f.holman.success) {
        console.log(`  Holman FAIL — ${f.vehicleNumber} (${f.name}) [${f.ldap}]: ${f.holman.error}`);
      }
      if (!f.wms.success) {
        console.log(`  WMS FAIL   — ${f.vehicleNumber} (${f.name}) [${f.ldap}]: ${f.wms.error}`);
      }
    }
  } else {
    console.log("\nAll vehicles assigned successfully (or skipped as already present).");
  }

  console.log("\n=== DONE ===");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
