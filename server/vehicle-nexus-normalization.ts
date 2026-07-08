// Pure helpers for vehicle_nexus_data truck-number normalization.
// Weekly Offboarding historically stored 5-digit display numbers (61101)
// while queue item data carries 6-digit TPMS/Holman values (061101), so
// lookups must match across all plausible formats and reads must collapse
// legacy duplicate rows down to one row per canonical vehicle.
import { toCanonical, toDisplayNumber, vehicleNumberVariants } from "./vehicle-number-utils";

// Expand a list of requested vehicle numbers into the flat, de-duplicated set
// of stored formats to query against (raw / canonical / 5-digit / 6-digit).
export function expandVehicleNumberVariants(vehicleNumbers: Array<string | number | null | undefined>): string[] {
  const all = new Set<string>();
  for (const vn of vehicleNumbers) {
    for (const v of vehicleNumberVariants(vn)) all.add(v);
  }
  return Array.from(all);
}

interface HasVehicleNumberAndUpdatedAt {
  vehicleNumber: string;
  updatedAt: Date | string;
}

// Collapse rows to one per canonical vehicle number, preferring the most
// recently updated when legacy duplicates (61456 + 061456) both exist.
export function pickLatestPerVehicle<T extends HasVehicleNumberAndUpdatedAt>(rows: T[]): T[] {
  const byCanonical = new Map<string, T>();
  for (const row of rows) {
    const key = toCanonical(row.vehicleNumber);
    const existing = byCanonical.get(key);
    if (!existing || new Date(row.updatedAt).getTime() >= new Date(existing.updatedAt).getTime()) {
      byCanonical.set(key, row);
    }
  }
  return Array.from(byCanonical.values());
}

// Decide what vehicle_number to store on an upsert. Prefer the 5-digit
// display format, but when updating an existing row, never rewrite its
// vehicle_number to a value another matched (legacy duplicate) row already
// holds — vehicle_number is UNIQUE and that would blow up the update.
export function resolveNexusVehicleNumber(
  requested: string,
  target: { id: string; vehicleNumber: string } | undefined,
  matchedRows: Array<{ id: string; vehicleNumber: string }>,
): string {
  const display = toDisplayNumber(requested) || String(requested).trim();
  if (!target) return display;
  const displayTakenByOther = matchedRows.some(
    (m) => m.id !== target.id && m.vehicleNumber === display,
  );
  return displayTakenByOther ? target.vehicleNumber : display;
}
