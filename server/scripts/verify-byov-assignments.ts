/**
 * BYOV Assignment Verification — Holman & WMS
 *
 * Reads the same BYOV CSV used by the bulk assignment script and queries both
 * Holman (getVehicleAssignedStatus) and WMS (getAssignment) to confirm that
 * every vehicle's assignment actually persisted after the bulk run.
 *
 * Holman pass criteria:
 *   - Vehicle found in Holman
 *   - assignedStatus indicates "Assigned" (case-insensitive)
 *   - clientData2 matches the expected LDAP (case-insensitive)
 *
 * WMS pass criteria:
 *   - Tech assignment found (no 404)
 *   - Returned truck name/id matches the expected padded vehicle number (case-insensitive)
 *
 * Run:
 *   npx tsx server/scripts/verify-byov-assignments.ts
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

const CSV_PATH = path.resolve(
  process.cwd(),
  "attached_assets/BYOV_Dashboard_w_Status_2026-05-06_1778033723628.csv"
);

const DELAY_MS = 400;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// CSV parsing (mirrors bulk-byov-assign.ts)
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

  const iStatus = idx("Status");
  const iName   = idx("Name");
  const iLdap   = idx("LDAP");
  const iTruck  = idx("Truck ID");

  return lines.slice(1).map((line) => {
    const f = parseCsvLine(line);
    return {
      status:  f[iStatus] ?? "",
      name:    f[iName]   ?? "",
      ldap:    f[iLdap]   ?? "",
      truckId: f[iTruck]  ?? "",
    };
  });
}

// ---------------------------------------------------------------------------
// Per-system verification helpers
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

    // BYOV vehicles must have assignedStatusCode='D' (Driver/BYOV assignment code)
    const statusCode    = (result.assignedStatusCode ?? "").trim().toUpperCase();
    const codeIsD       = statusCode === "D";

    const actualLdap    = (result.techAssigned ?? "").trim().toLowerCase();
    const expectedNorm  = expectedLdap.trim().toLowerCase();
    const ldapMatch     = actualLdap === expectedNorm;

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

    // getAssignment returns NetSuiteTruckAssignmentResponse with name/id being the truck
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
// Result types
// ---------------------------------------------------------------------------

interface RowVerification {
  vehicleNumber: string;
  name: string;
  ldap: string;
  csvStatus: string;
  holman: CheckResult;
  wms: CheckResult;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== BYOV Assignment Verification ===");
  console.log(`CSV : ${CSV_PATH}`);
  console.log(`Time: ${new Date().toISOString()}`);
  console.log("");

  const rows = readCsv();
  console.log(`Total CSV rows (excluding header): ${rows.length}`);

  const verifiable = rows.filter((r) => r.ldap.trim() && r.truckId.trim());
  const skippedNoData = rows.length - verifiable.length;

  console.log(`Verifiable rows (have LDAP + Truck ID): ${verifiable.length}`);
  if (skippedNoData > 0) {
    console.log(`Skipped (missing LDAP or Truck ID): ${skippedNoData}`);
  }
  console.log("");

  const results: RowVerification[] = [];

  for (const row of verifiable) {
    const ldap          = row.ldap.trim();
    const paddedVehicle = toHolmanRef(row.truckId.trim()) ?? row.truckId.trim();

    console.log(`--- ${paddedVehicle}  (${row.name.trim()})  [${ldap}] ---`);

    await sleep(DELAY_MS);
    const holmanCheck = await checkHolman(row.truckId.trim(), ldap);
    console.log(`  Holman: ${holmanCheck.pass ? "PASS" : "FAIL"} — ${holmanCheck.detail}`);

    await sleep(DELAY_MS);
    const wmsCheck = await checkWms(paddedVehicle, ldap);
    console.log(`  WMS   : ${wmsCheck.pass ? "PASS" : "FAIL"} — ${wmsCheck.detail}`);

    results.push({
      vehicleNumber: paddedVehicle,
      name:          row.name.trim(),
      ldap,
      csvStatus:     row.status.trim(),
      holman:        holmanCheck,
      wms:           wmsCheck,
    });
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------

  const total = results.length;

  const holmanPass = results.filter((r) => r.holman.pass).length;
  const holmanFail = total - holmanPass;

  const wmsPass = results.filter((r) => r.wms.pass).length;
  const wmsFail = total - wmsPass;

  const bothPass = results.filter((r) => r.holman.pass && r.wms.pass).length;
  const eitherFail = total - bothPass;

  console.log("\n\n=== SUMMARY ===");
  console.log(`Total verified : ${total}`);
  console.log("");
  console.log(`Holman — PASS: ${holmanPass}  FAIL: ${holmanFail}`);
  console.log(`WMS    — PASS: ${wmsPass}  FAIL: ${wmsFail}`);
  console.log(`Both   — PASS: ${bothPass}  one-or-both FAIL: ${eitherFail}`);

  // Failures
  const failures = results.filter((r) => !r.holman.pass || !r.wms.pass);
  if (failures.length === 0) {
    console.log("\nAll vehicles verified successfully in both systems.");
  } else {
    console.log(`\n--- FAILURES (${failures.length}) ---`);
    for (const f of failures) {
      if (!f.holman.pass) {
        console.log(`  Holman FAIL — ${f.vehicleNumber}  (${f.name})  [${f.ldap}]: ${f.holman.detail}`);
      }
      if (!f.wms.pass) {
        console.log(`  WMS    FAIL — ${f.vehicleNumber}  (${f.name})  [${f.ldap}]: ${f.wms.detail}`);
      }
    }
  }

  console.log("\n=== DONE ===");

  // Exit non-zero if any failures so CI / shell scripts can detect problems
  if (failures.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
