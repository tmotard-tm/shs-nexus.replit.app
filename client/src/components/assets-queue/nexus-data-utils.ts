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
