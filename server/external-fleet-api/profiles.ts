import { toCanonical } from "../vehicle-number-utils";
import {
  buildTpmsObservationsByEnterpriseId,
  buildTpmsObservationsByTruckNumber,
  searchTpmsLocalRecords,
  type TpmsAssignmentValue,
  type TpmsLocalRecord,
  type TpmsObservationSet,
} from "./tpms-read-model";
import type { ApiWarning, SourceObservation } from "./types";

export type ProfileMatchState = "matched" | "not_found" | "ambiguous";

export interface TechnicianProfile {
  kind: "technician";
  enterpriseId: string;
  displayName: string | null;
  observations: SourceObservation<TpmsAssignmentValue>[];
  warnings: ApiWarning[];
}

export interface TruckProfile {
  kind: "truck";
  truckNumber: string;
  observations: SourceObservation<TpmsAssignmentValue>[];
  warnings: ApiWarning[];
}

export interface ProfileSearchResult {
  matchState: ProfileMatchState;
  candidates: Array<{
    kind: "technician" | "truck";
    enterpriseId: string | null;
    truckNumber: string | null;
    displayName: string | null;
  }>;
}

export interface ProfileBuilderDependencies {
  buildByEnterpriseId(enterpriseId: string): Promise<TpmsObservationSet>;
  buildByTruckNumber(truckNumber: string): Promise<TpmsObservationSet>;
  searchRecords(query: string): Promise<TpmsLocalRecord[]>;
}

export interface ProfileBuilders {
  buildTechnicianProfile(enterpriseId: string): Promise<TechnicianProfile | null>;
  buildTruckProfile(truckNumber: string): Promise<TruckProfile | null>;
  searchProfiles(query: string): Promise<ProfileSearchResult>;
}

function oneValue(values: Array<string | null>): string | null {
  const unique = [...new Set(values.map((value) => value?.trim()).filter((value): value is string => !!value))];
  return unique.length === 1 ? unique[0] : null;
}

export function createProfileBuilders(dependencies: ProfileBuilderDependencies): ProfileBuilders {
  const buildTechnicianProfile = async (enterpriseId: string): Promise<TechnicianProfile | null> => {
    const normalized = enterpriseId.trim().toUpperCase();
    const result = await dependencies.buildByEnterpriseId(normalized);
    if (!result.observations.length) return null;
    return {
      kind: "technician",
      enterpriseId: normalized,
      displayName: oneValue(result.observations.map((item) => item.value.technicianName)),
      observations: result.observations,
      warnings: result.warnings,
    };
  };

  const buildTruckProfile = async (truckNumber: string): Promise<TruckProfile | null> => {
    const normalized = toCanonical(truckNumber);
    const result = await dependencies.buildByTruckNumber(normalized);
    if (!result.observations.length) return null;
    return {
      kind: "truck",
      truckNumber: normalized,
      observations: result.observations,
      warnings: result.warnings,
    };
  };

  const searchProfiles = async (queryInput: string): Promise<ProfileSearchResult> => {
    const query = queryInput.trim();
    const directCandidates: ProfileSearchResult["candidates"] = [];
    if (/^[A-Za-z0-9._-]{2,40}$/.test(query)) {
      const exact = await buildTechnicianProfile(query);
      if (exact) {
        directCandidates.push({
          kind: "technician",
          enterpriseId: exact.enterpriseId,
          truckNumber: oneValue(exact.observations.map((item) => toCanonical(item.value.truckNumber) || null)),
          displayName: exact.displayName,
        });
      }
    }
    if (/^\d+$/.test(query)) {
      const truckNumber = toCanonical(query);
      const truck = await buildTruckProfile(truckNumber);
      if (truck) {
        directCandidates.push({ kind: "truck", enterpriseId: null, truckNumber, displayName: null });
      }
    }
    if (directCandidates.length) {
      return {
        matchState: directCandidates.length === 1 ? "matched" : "ambiguous",
        candidates: directCandidates,
      };
    }
    const rows = await dependencies.searchRecords(query);
    const byEnterprise = new Map<string, TpmsLocalRecord[]>();
    for (const row of rows) {
      const enterpriseId = row.enterpriseId?.trim().toUpperCase();
      if (!enterpriseId) continue;
      const existing = byEnterprise.get(enterpriseId) ?? [];
      existing.push(row);
      byEnterprise.set(enterpriseId, existing);
    }
    const candidates = [...byEnterprise.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([enterpriseId, matching]) => ({
        kind: "technician" as const,
        enterpriseId,
        truckNumber: oneValue(matching.map((row) => toCanonical(row.truckNumber) || null)),
        displayName: oneValue(matching.map((row) => row.technicianName)),
      }));
    return {
      matchState: candidates.length === 0 ? "not_found" : candidates.length === 1 ? "matched" : "ambiguous",
      candidates,
    };
  };

  return { buildTechnicianProfile, buildTruckProfile, searchProfiles };
}

const productionBuilders = createProfileBuilders({
  buildByEnterpriseId: buildTpmsObservationsByEnterpriseId,
  buildByTruckNumber: buildTpmsObservationsByTruckNumber,
  searchRecords: searchTpmsLocalRecords,
});

export async function buildTechnicianProfile(enterpriseId: string): Promise<TechnicianProfile | null> {
  return productionBuilders.buildTechnicianProfile(enterpriseId);
}

export async function buildTruckProfile(truckNumber: string): Promise<TruckProfile | null> {
  return productionBuilders.buildTruckProfile(truckNumber);
}

export async function searchProfiles(query: string): Promise<ProfileSearchResult> {
  return productionBuilders.searchProfiles(query);
}
