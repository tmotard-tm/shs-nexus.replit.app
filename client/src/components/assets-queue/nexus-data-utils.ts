// Pure helpers for mapping /api/vehicle-nexus-data/batch responses to queue
// rows. Keyed by canonical truck number so 5-digit Weekly Offboarding values
// (61456) and 6-digit TPMS/Holman values (061456) resolve to the same entry.
import { toCanonical } from "@shared/vehicle-number-utils";

export interface NexusRecoveryFields {
  postOffboardedStatus: string | null;
  toolsPartsLocation: string | null;
  partsRecoveryInitiated: string | null;
  phoneRecoveryInitiated: string | null;
}

export type NexusBatchMap = Record<string, NexusRecoveryFields>;

export function buildNexusBatchMap(
  items: Array<{ vehicleNumber: string } & Partial<NexusRecoveryFields>>,
): NexusBatchMap {
  const map: NexusBatchMap = {};
  for (const item of items) {
    const key = toCanonical(item.vehicleNumber);
    if (!key) continue;
    map[key] = {
      postOffboardedStatus: item.postOffboardedStatus ?? null,
      toolsPartsLocation: item.toolsPartsLocation ?? null,
      partsRecoveryInitiated: item.partsRecoveryInitiated ?? null,
      phoneRecoveryInitiated: item.phoneRecoveryInitiated ?? null,
    };
  }
  return map;
}

export function lookupNexusData(
  map: NexusBatchMap,
  truckNumber: string | null | undefined,
): NexusRecoveryFields | undefined {
  if (!truckNumber || truckNumber === "N/A") return undefined;
  return map[toCanonical(truckNumber)];
}

// Minimal structural view of a queue item — enough to mine truck numbers
// from every place the producers stash them.
export interface TruckCandidateSource {
  data?: string | null;
  metadata?: string | null;
  techData?: { hrTruckNumber?: string | null } | null;
}

function safeParse(json: string | null | undefined): any {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// All plausible truck numbers for a queue item, in priority order:
//   1. techData.hrTruckNumber   (already-resolved HR/roster value)
//   2. data.hrSeparation.truckNumber
//   3. data.vehicle.truckNo
//   4. data.vehicle.vehicleNumber
//   5. metadata.tpmsTruckNo     (written by the automated Snowflake sync)
// De-duplicated by canonical form so "61456" and "061456" count once.
// Rows with a missing or dirty hrTruckNumber still join to vehicle_nexus_data
// through the fallbacks.
export function collectItemTruckCandidates(item: TruckCandidateSource): string[] {
  const parsed = safeParse(item.data);
  const meta = safeParse(item.metadata);
  const raw: Array<unknown> = [
    item.techData?.hrTruckNumber,
    parsed?.hrSeparation?.truckNumber,
    parsed?.vehicle?.truckNo,
    parsed?.vehicle?.vehicleNumber,
    meta?.tpmsTruckNo,
  ];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (typeof r !== "string" && typeof r !== "number") continue;
    const s = String(r).trim();
    if (!s || s === "N/A") continue;
    const key = toCanonical(s);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

// First candidate that resolves to a vehicle_nexus_data row wins.
export function lookupNexusDataForItem(
  map: NexusBatchMap,
  item: TruckCandidateSource,
): NexusRecoveryFields | undefined {
  for (const candidate of collectItemTruckCandidates(item)) {
    const hit = lookupNexusData(map, candidate);
    if (hit) return hit;
  }
  return undefined;
}

// Business rule: on a standard company vehicle the tools stay with the truck,
// so no Claudia tools/parts task is implied unless the fields indicate action
// (tools at tech's home, or parts recovery explicitly initiated). BYOV/rental
// rows always surface the tools/parts recovery work.
export function showToolsPartsRecovery(
  vehicleType: "company" | "byov" | "rental",
  nexus: NexusRecoveryFields | undefined,
): boolean {
  if (vehicleType === "byov" || vehicleType === "rental") return true;
  if (!nexus) return false;
  return nexus.toolsPartsLocation === "techs_home" || nexus.partsRecoveryInitiated === "yes";
}

export function formatToolsPartsLocation(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value === "in_the_truck") return "Tools: Truck";
  if (value === "techs_home") return "Tools: Home";
  return `Tools: ${value}`;
}
