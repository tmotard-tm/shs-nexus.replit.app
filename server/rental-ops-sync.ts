/**
 * Rental Ops → Fleet Scope Nightly Auto-Sync
 *
 * Queries the same Snowflake tables used by the Rental Operations tab,
 * applies the same deduplication logic (Enterprise first, Holman non-Enterprise
 * second), and calls consolidateTrucks to keep the Fleet Scope Rentals Dashboard
 * in sync automatically.
 *
 * Rules:
 *  - New vehicles on open rental → added to Fleet Scope
 *  - Vehicles no longer on open rental → archived and removed
 *  - "Date in repair" is only filled when blank — existing values are never overwritten
 */

import { fleetScopeStorage } from "./fleet-scope-storage";
import { toDisplayNumber } from "./vehicle-number-utils";

const RENTAL_OPEN_TABLE = "PARTS_SUPPLYCHAIN.FLEET.HOLMAN_OPEN_RENTAL_REPORT";
const RENTAL_TICKET_TABLE = "PARTS_SUPPLYCHAIN.FLEET.ENTERPRISE_OPEN_RENTAL_TICKET_REPORT";

function parseRentalDate(d: string | null | undefined): string | null {
  if (!d) return null;
  const s = String(d).trim();
  if (!s || s === "null") return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  if (/^\d{7}$/.test(s)) return `${s.slice(3)}-${s[0].padStart(2, "0")}-${s.slice(1, 3)}`;
  if (/^\d{8}$/.test(s)) return `${s.slice(4)}-${s.slice(0, 2)}-${s.slice(2, 4)}`;
  return s.slice(0, 10);
}

function entOriginalStart(r: any): string | null {
  return parseRentalDate(r.ORIGINAL_START_DATE) || parseRentalDate(r.RENTAL_START_DATE);
}

const isEntVendor = (v: string | null) => !v || /enterprise/i.test(v) || /toll/i.test(v);

const normVeh = (v: string) => {
  if (!v) return "";
  return toDisplayNumber(v);
};

export interface RentalSyncResult {
  added: string[];
  removed: string[];
  unchanged: number;
  updated: number;
  consolidationId: string;
  vehiclesInRentalOps: number;
  skippedOos: number;
}

export async function syncRentalOpsToFleetScope(): Promise<RentalSyncResult> {
  const { getSnowflakeService, isSnowflakeConfigured } = await import("./snowflake-service");

  if (!isSnowflakeConfigured()) {
    throw new Error("[RentalOpsSync] Snowflake is not configured — sync aborted");
  }

  const sf = getSnowflakeService();
  await sf.connect();

  const fileFilter = (table: string) =>
    `FILE_DATE = (SELECT MAX(FILE_DATE) FROM ${table})`;

  const [ticketRows, holmanRows] = await Promise.all([
    sf.executeQuery(
      `SELECT * FROM ${RENTAL_TICKET_TABLE} WHERE ${fileFilter(RENTAL_TICKET_TABLE)} AND TICKET_STATUS='OPEN' LIMIT 5000`
    ) as Promise<any[]>,
    sf.executeQuery(
      `SELECT * FROM ${RENTAL_OPEN_TABLE} WHERE ${fileFilter(RENTAL_OPEN_TABLE)} LIMIT 5000`
    ) as Promise<any[]>,
  ]);

  // Build set of all vehicle numbers in Enterprise ticket table
  const allEntVns = new Set<string>();
  for (const r of ticketRows) {
    const vn = normVeh(r.VEHICLE_NUMBER || "");
    if (vn) allEntVns.add(vn);
  }

  // SEGMENT 1: Enterprise open tickets, deduplicated by vehicle (latest RENTAL_START_DATE)
  const entByVehicle = new Map<string, any>();
  for (const r of ticketRows) {
    const vn = normVeh(r.VEHICLE_NUMBER || "");
    if (!vn) continue;
    const existing = entByVehicle.get(vn);
    const rDate = new Date(r.RENTAL_START_DATE || "2000-01-01").getTime();
    const eDate = existing ? new Date(existing.RENTAL_START_DATE || "2000-01-01").getTime() : 0;
    if (!existing || rDate > eDate) entByVehicle.set(vn, r);
  }

  const enterpriseEntries = Array.from(entByVehicle.entries()).map(([vn, r]) => ({
    truckNumber: vn,
    // Use same date as daysOpen counter: COALESCE(ORIGINAL_START_DATE, RENTAL_START_DATE)
    dateInRepair: entOriginalStart(r) ?? undefined,
  }));

  // SEGMENT 2: Holman non-Enterprise vehicles not in Enterprise ticket table
  const holmanByVehicle = new Map<string, any[]>();
  for (const r of holmanRows) {
    const vn = normVeh(r.VEHICLE_NUMBER || "");
    if (!vn) continue;
    if (isEntVendor(r.RENTAL_VENDOR)) continue;
    if (allEntVns.has(vn)) continue;
    if (!holmanByVehicle.has(vn)) holmanByVehicle.set(vn, []);
    holmanByVehicle.get(vn)!.push(r);
  }

  const holmanEntries = Array.from(holmanByVehicle.entries()).map(([vn, group]) => {
    const sorted = group.sort(
      (a: any, b: any) =>
        new Date(b.PO_DATE || "2000-01-01").getTime() -
        new Date(a.PO_DATE || "2000-01-01").getTime()
    );
    const r = sorted[0];
    // Use same date as daysOpen counter: PO_DATE falling back to RENTAL_START_DATE
    const startDate = parseRentalDate(r.PO_DATE || r.RENTAL_START_DATE);
    return {
      truckNumber: vn,
      dateInRepair: startDate ?? undefined,
    };
  });

  const allEntries = [...enterpriseEntries, ...holmanEntries];

  console.log(
    `[RentalOpsSync] Found ${allEntries.length} open rental vehicles ` +
    `(${enterpriseEntries.length} Enterprise, ${holmanEntries.length} Holman non-Enterprise)`
  );

  // Run consolidation — preserve any existing datePutInRepair values
  const result = await fleetScopeStorage.consolidateTrucks(
    allEntries,
    "Rental Ops Auto-Sync",
    true
  );

  console.log(
    `[RentalOpsSync] Complete — Added: ${result.added.length}, Removed: ${result.removed.length}, ` +
    `Updated (date filled): ${result.updated}, Unchanged: ${result.unchanged}`
  );

  return {
    ...result,
    vehiclesInRentalOps: allEntries.length,
    skippedOos: 0,
  };
}
