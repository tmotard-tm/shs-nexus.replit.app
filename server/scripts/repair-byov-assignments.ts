/**
 * BYOV Assignment Repair — Holman & WMS
 *
 * Runs a verification pass to identify vehicles whose Holman or WMS assignment
 * did not land correctly, then re-submits only the failed rows through the
 * bulk assignment logic, and finally runs a second verification sweep to confirm
 * that the previously-failed vehicles now pass.
 *
 * Run:
 *   npx tsx server/scripts/repair-byov-assignments.ts [--force] [--csv <path>]
 *
 * Flags:
 *   --force        When a technician is already assigned to a different truck in WMS,
 *                  delete the old assignment first and then create the new one.
 *                  Without this flag the existing assignment is updated via PUT.
 *   --csv <path>   Override the default CSV file path (relative to cwd or absolute).
 *                  Defaults to the same timestamped CSV used by bulk-byov-assign.ts.
 *
 * Required env vars (same as bulk-byov-assign.ts):
 *   HOLMAN_API_ENDPOINT, HOLMAN_CLIENT_ID, HOLMAN_CLIENT_SECRET
 *   WMS_ENGINE_BASE_URL, WMS_ENGINE_AUTH_ENDPOINT, WMS_ENGINE_AUTHORIZATION
 */

import * as fs from "fs";
import * as path from "path";
import { holmanApiService } from "../holman-api-service";
import { wmsEngineService } from "../wms-engine-service";
import { toHolmanRef, toCanonical } from "../vehicle-number-utils";

const DEFAULT_CSV = "attached_assets/BYOV_Dashboard_w_Status_2026-05-06_1778033723628.csv";

function resolveCsvPath(): string {
  const flagIdx = process.argv.indexOf("--csv");
  if (flagIdx !== -1 && process.argv[flagIdx + 1]) {
    return path.resolve(process.cwd(), process.argv[flagIdx + 1]);
  }
  return path.resolve(process.cwd(), DEFAULT_CSV);
}

const CSV_PATH = resolveCsvPath();

const DELAY_MS = 400;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// CSV parsing
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
// Field helpers (mirrors bulk-byov-assign.ts)
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
// Verification helpers (mirrors verify-byov-assignments.ts)
// ---------------------------------------------------------------------------

interface CheckResult {
  pass: boolean;
  detail: string;
}

async function checkHolman(vehicleNumber: string, expectedLdap: string): Promise<CheckResult> {
  try {
    const result = await holmanApiService.getVehicleAssignedStatus(vehicleNumber);

    if (!result.found) {
      return { pass: false, detail: `NOT FOUND in Holman — ${result.error ?? "unknown error"}` };
    }

    const statusCode   = (result.assignedStatusCode ?? "").trim().toUpperCase();
    const codeIsD      = statusCode === "D";
    const actualLdap   = (result.techAssigned ?? "").trim().toLowerCase();
    const expectedNorm = expectedLdap.trim().toLowerCase();
    const ldapMatch    = actualLdap === expectedNorm;

    if (codeIsD && ldapMatch) {
      return {
        pass: true,
        detail: `assignedStatusCode="${statusCode}", clientData2="${result.techAssigned}"`,
      };
    }

    const reasons: string[] = [];
    if (!codeIsD)   reasons.push(`assignedStatusCode="${statusCode}" (expected "D")`);
    if (!ldapMatch) reasons.push(`clientData2="${result.techAssigned}" (expected "${expectedLdap}")`);
    return { pass: false, detail: reasons.join("; ") };
  } catch (err: any) {
    return { pass: false, detail: `ERROR — ${err.message ?? String(err)}` };
  }
}

async function checkWms(paddedVehicle: string, ldap: string): Promise<CheckResult> {
  try {
    const assignment = await wmsEngineService.getAssignment(ldap);
    const assignedTruck = ((assignment.name || assignment.id || "") as string).trim();

    if (!assignedTruck) {
      return {
        pass: false,
        detail: `No truck assignment found for tech "${ldap}" (empty response)`,
      };
    }

    const match =
      toCanonical(assignedTruck) === toCanonical(paddedVehicle) ||
      assignedTruck.toLowerCase() === paddedVehicle.toLowerCase();

    if (match) {
      return { pass: true, detail: `truckId="${assignedTruck}"` };
    }

    return {
      pass: false,
      detail: `truckId="${assignedTruck}" (expected "${paddedVehicle}")`,
    };
  } catch (err: any) {
    const msg: string = err?.message ?? String(err);
    const is404 = (err?.status ?? 0) === 404 || msg.includes("404");
    if (is404) {
      return { pass: false, detail: `Tech "${ldap}" has NO assignment in WMS (404)` };
    }
    return { pass: false, detail: `ERROR — ${msg}` };
  }
}

// ---------------------------------------------------------------------------
// Assignment helpers (mirrors bulk-byov-assign.ts)
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
  const districtPrefix = districtStr ? districtStr.slice(-4) : null;

  const NULL_VAL = "^null^";
  const cityUpper = city ? city.toUpperCase() : null;

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
    console.log(`    [Holman] ${paddedVehicle} → ${ldap} assigned OK:`, JSON.stringify(resp).slice(0, 200));
    return { success: true };
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`    [Holman] ${paddedVehicle} → ${ldap} FAILED:`, msg);
    return { success: false, error: msg };
  }
}

async function assignInWms(
  vehicleNumber: string,
  ldap: string,
  force: boolean
): Promise<{ success: boolean; skipped?: boolean; swapped?: boolean; previousTruck?: string; error?: string }> {
  const paddedVehicle = toHolmanRef(vehicleNumber);
  if (!paddedVehicle) return { success: false, error: "Invalid vehicle number" };
  if (!ldap) return { success: false, error: "No LDAP/enterprise ID" };

  let existingTruck: string | null = null;
  try {
    const existing = await wmsEngineService.getAssignment(ldap);
    if (existing && (existing.name || existing.id)) {
      existingTruck = existing.name || existing.id || "";
      if (existingTruck === paddedVehicle) {
        console.log(`    [WMS] ${paddedVehicle} already assigned to ${ldap} — skipping`);
        return { success: true, skipped: true };
      }
      if (force) {
        console.log(`    [WMS] CONFLICT: ${ldap} is assigned to "${existingTruck}" — force-swapping to "${paddedVehicle}"`);
      } else {
        console.log(`    [WMS] ${ldap} currently assigned to "${existingTruck}" — updating to "${paddedVehicle}"`);
      }
    }
  } catch (lookupErr: any) {
    const status = lookupErr?.status ?? 0;
    const msg: string = lookupErr?.message ?? String(lookupErr);
    const is404 = status === 404 || msg.includes("404");
    if (!is404) {
      const errMsg = `WMS assignment lookup failed (fail-closed): ${msg}`;
      console.error(`    [WMS] ${paddedVehicle} → ${ldap} ABORTED — ${errMsg}`);
      return { success: false, error: errMsg };
    }
  }

  try {
    let resp: any;
    if (existingTruck !== null) {
      if (force) {
        try {
          await wmsEngineService.deleteAssignment(ldap);
          console.log(`    [WMS] Deleted old assignment for ${ldap} (was: "${existingTruck}")`);
        } catch (delErr: any) {
          const delMsg = delErr instanceof Error ? delErr.message : String(delErr);
          const errMsg = `deleteAssignment failed (fail-closed): ${delMsg}`;
          console.error(`    [WMS] ${paddedVehicle} → ${ldap} ABORTED — ${errMsg}`);
          return { success: false, error: errMsg };
        }
        resp = await wmsEngineService.createAssignment({ techId: ldap, truckId: paddedVehicle });
        console.log(`    [WMS] SWAP ${existingTruck} → ${paddedVehicle} for ${ldap} created OK:`, JSON.stringify(resp).slice(0, 200));
        return { success: true, swapped: true, previousTruck: existingTruck };
      } else {
        resp = await wmsEngineService.updateAssignment(ldap, { techId: ldap, truckId: paddedVehicle });
        console.log(`    [WMS] ${paddedVehicle} → ${ldap} updated OK:`, JSON.stringify(resp).slice(0, 200));
      }
    } else {
      resp = await wmsEngineService.createAssignment({ techId: ldap, truckId: paddedVehicle });
      console.log(`    [WMS] ${paddedVehicle} → ${ldap} created OK:`, JSON.stringify(resp).slice(0, 200));
    }
    return { success: true };
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`    [WMS] ${paddedVehicle} → ${ldap} FAILED:`, msg);
    return { success: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// Shared result types
// ---------------------------------------------------------------------------

interface VerifyResult {
  vehicleNumber: string;
  name: string;
  ldap: string;
  truckId: string;
  holman: CheckResult;
  wms: CheckResult;
}

// ---------------------------------------------------------------------------
// Verification sweep
// ---------------------------------------------------------------------------

async function runVerification(rows: CsvRow[], label: string): Promise<VerifyResult[]> {
  console.log(`\n--- ${label} ---`);
  const results: VerifyResult[] = [];

  for (const row of rows) {
    const ldap          = row.ldap.trim();
    const paddedVehicle = toHolmanRef(row.truckId.trim()) ?? row.truckId.trim();

    console.log(`  ${paddedVehicle}  (${row.name.trim()})  [${ldap}]`);

    await sleep(DELAY_MS);
    const holmanCheck = await checkHolman(row.truckId.trim(), ldap);
    console.log(`    Holman: ${holmanCheck.pass ? "PASS" : "FAIL"} — ${holmanCheck.detail}`);

    await sleep(DELAY_MS);
    const wmsCheck = await checkWms(paddedVehicle, ldap);
    console.log(`    WMS   : ${wmsCheck.pass ? "PASS" : "FAIL"} — ${wmsCheck.detail}`);

    results.push({
      vehicleNumber: paddedVehicle,
      name:          row.name.trim(),
      ldap,
      truckId:       row.truckId.trim(),
      holman:        holmanCheck,
      wms:           wmsCheck,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const force = process.argv.includes("--force");

  console.log("=== BYOV Assignment Repair ===");
  console.log(`CSV : ${CSV_PATH}`);
  console.log(`Time: ${new Date().toISOString()}`);
  if (force) {
    console.log("Mode: --force (conflicting WMS assignments will be deleted then re-created)");
  }
  console.log("");

  // Step 1: Read CSV and filter to verifiable rows
  const allRows = readCsv();
  const verifiable = allRows.filter((r) => r.ldap.trim() && r.truckId.trim());
  console.log(`Total CSV rows (excluding header)  : ${allRows.length}`);
  console.log(`Verifiable rows (have LDAP + Truck): ${verifiable.length}`);
  const skippedNoData = allRows.length - verifiable.length;
  if (skippedNoData > 0) {
    console.log(`Skipped (missing LDAP or Truck ID) : ${skippedNoData}`);
  }

  // ===========================================================================
  // PASS 1 — Initial verification sweep
  // ===========================================================================
  console.log("\n\n=== PASS 1: Initial Verification ===");
  const pass1Results = await runVerification(verifiable, "Checking all vehicles");

  const pass1Total      = pass1Results.length;
  const pass1HolmanPass = pass1Results.filter((r) => r.holman.pass).length;
  const pass1WmsPass    = pass1Results.filter((r) => r.wms.pass).length;
  const pass1BothPass   = pass1Results.filter((r) => r.holman.pass && r.wms.pass).length;
  const pass1Failures   = pass1Results.filter((r) => !r.holman.pass || !r.wms.pass);

  console.log(`\nPass 1 Summary:`);
  console.log(`  Total verified  : ${pass1Total}`);
  console.log(`  Holman — PASS: ${pass1HolmanPass}  FAIL: ${pass1Total - pass1HolmanPass}`);
  console.log(`  WMS    — PASS: ${pass1WmsPass}  FAIL: ${pass1Total - pass1WmsPass}`);
  console.log(`  Both   — PASS: ${pass1BothPass}  one-or-both FAIL: ${pass1Failures.length}`);

  if (pass1Failures.length === 0) {
    console.log("\nAll vehicles already verified successfully in both systems — no repair needed.");
    console.log("\n=== DONE ===");
    return;
  }

  // Show which vehicles need repair
  console.log(`\nVehicles requiring repair (${pass1Failures.length}):`);
  for (const f of pass1Failures) {
    if (!f.holman.pass) console.log(`  Holman FAIL — ${f.vehicleNumber}  (${f.name})  [${f.ldap}]: ${f.holman.detail}`);
    if (!f.wms.pass)    console.log(`  WMS    FAIL — ${f.vehicleNumber}  (${f.name})  [${f.ldap}]: ${f.wms.detail}`);
  }

  // ===========================================================================
  // PASS 2 — Re-assign only the failed vehicles
  // ===========================================================================
  console.log("\n\n=== PASS 2: Re-assigning Failed Vehicles ===");

  // Build a lookup map from truckId → full CsvRow so we can pass it to assignInHolman
  const rowByTruckId = new Map<string, CsvRow>();
  for (const row of verifiable) {
    rowByTruckId.set(row.truckId.trim().toLowerCase(), row);
  }

  interface RepairResult {
    vehicleNumber: string;
    name: string;
    ldap: string;
    holmanNeeded: boolean;
    wmsNeeded: boolean;
    holman: { success: boolean; skipped?: boolean; error?: string } | null;
    wms: { success: boolean; skipped?: boolean; swapped?: boolean; previousTruck?: string; error?: string } | null;
  }

  const repairResults: RepairResult[] = [];

  for (const failed of pass1Failures) {
    const row = rowByTruckId.get(failed.truckId.toLowerCase());
    if (!row) {
      console.log(`\n  SKIP — no CSV row found for truckId "${failed.truckId}" (should not happen)`);
      continue;
    }

    const holmanNeeded = !failed.holman.pass;
    const wmsNeeded    = !failed.wms.pass;

    console.log(`\n  --- ${failed.vehicleNumber}  (${failed.name})  [${failed.ldap}] ---`);
    console.log(`    Holman repair needed: ${holmanNeeded}`);
    console.log(`    WMS    repair needed: ${wmsNeeded}`);

    let holmanResult: RepairResult["holman"] = null;
    let wmsResult: RepairResult["wms"] = null;

    if (holmanNeeded) {
      await sleep(DELAY_MS);
      holmanResult = await assignInHolman(row.truckId.trim(), row);
    }

    if (wmsNeeded) {
      await sleep(DELAY_MS);
      wmsResult = await assignInWms(row.truckId.trim(), failed.ldap, force);
    }

    repairResults.push({
      vehicleNumber: failed.vehicleNumber,
      name:          failed.name,
      ldap:          failed.ldap,
      holmanNeeded,
      wmsNeeded,
      holman:        holmanResult,
      wms:           wmsResult,
    });
  }

  // Repair summary
  const holmanRepaired = repairResults.filter((r) => r.holmanNeeded && r.holman?.success).length;
  const holmanRepairFailed = repairResults.filter((r) => r.holmanNeeded && !r.holman?.success).length;
  const wmsRepaired    = repairResults.filter((r) => r.wmsNeeded && r.wms?.success).length;
  const wmsRepairFailed = repairResults.filter((r) => r.wmsNeeded && !r.wms?.success).length;

  console.log(`\nRepair Attempt Summary:`);
  console.log(`  Holman — repaired: ${holmanRepaired}  failed to repair: ${holmanRepairFailed}`);
  console.log(`  WMS    — repaired: ${wmsRepaired}  failed to repair: ${wmsRepairFailed}`);

  // ===========================================================================
  // PASS 3 — Re-verify the previously-failed vehicles
  // ===========================================================================
  console.log("\n\n=== PASS 3: Re-verification of Previously-Failed Vehicles ===");

  // Build the subset of rows that had failures in Pass 1
  const failedRowSubset = pass1Failures
    .map((f) => rowByTruckId.get(f.truckId.toLowerCase()))
    .filter((r): r is CsvRow => r !== undefined);

  const pass3Results = await runVerification(failedRowSubset, "Re-checking previously-failed vehicles");

  const pass3Total    = pass3Results.length;
  const pass3BothPass = pass3Results.filter((r) => r.holman.pass && r.wms.pass).length;
  const pass3Failures = pass3Results.filter((r) => !r.holman.pass || !r.wms.pass);

  // ===========================================================================
  // Final Summary
  // ===========================================================================

  console.log("\n\n=== FINAL SUMMARY ===");
  console.log(`Total vehicles in CSV                     : ${pass1Total}`);
  console.log("");
  console.log(`BEFORE repair — already passing (both)    : ${pass1BothPass}`);
  console.log(`BEFORE repair — failing (one or both)     : ${pass1Failures.length}`);
  console.log(`  └─ Holman failures                      : ${pass1Total - pass1HolmanPass}`);
  console.log(`  └─ WMS failures                         : ${pass1Total - pass1WmsPass}`);
  console.log("");
  console.log(`AFTER  repair — now passing (both)        : ${pass3BothPass}`);
  console.log(`AFTER  repair — still failing (one or both): ${pass3Failures.length}`);

  if (pass3Failures.length === 0) {
    console.log("\nAll previously-failed vehicles now verified successfully.");
  } else {
    console.log(`\n--- Still Failing After Repair (${pass3Failures.length}) ---`);
    for (const f of pass3Failures) {
      if (!f.holman.pass) {
        console.log(`  Holman FAIL — ${f.vehicleNumber}  (${f.name})  [${f.ldap}]: ${f.holman.detail}`);
      }
      if (!f.wms.pass) {
        console.log(`  WMS    FAIL — ${f.vehicleNumber}  (${f.name})  [${f.ldap}]: ${f.wms.detail}`);
      }
    }
  }

  const fixedCount = pass1Failures.length - pass3Failures.length;
  console.log(`\nNet result: ${fixedCount} of ${pass1Failures.length} previously-failed vehicles repaired.`);
  console.log("\n=== DONE ===");

  // Exit non-zero if any vehicles still fail after repair
  if (pass3Failures.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
