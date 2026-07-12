import { toCanonical } from "../vehicle-number-utils";
import type { ApiWarning, Freshness, SourceLayer, SourceObservation } from "./types";

// TPMS profiles are synchronized several times daily, the legacy cache is a
// fallback, and the extract is loaded nightly. These windows intentionally
// differ so a local record never looks current merely because it was read now.
export const LIVE_FRESHNESS_WINDOW_SECONDS = 6 * 60 * 60;
export const CACHED_FRESHNESS_WINDOW_SECONDS = 24 * 60 * 60;
export const EXTRACT_FRESHNESS_WINDOW_SECONDS = 30 * 60 * 60;

export interface TpmsAssignmentValue {
  enterpriseId: string | null;
  technicianName: string | null;
  truckNumber: string | null;
  district: string | null;
  mobileNumber: string | null;
  jobTitle: string | null;
  planningArea: string | null;
  managerName: string | null;
  managerEnterpriseId: string | null;
}

export interface TpmsObservationSet {
  observations: SourceObservation<TpmsAssignmentValue>[];
  warnings: ApiWarning[];
}

export type TpmsLookup = {
  kind: "enterpriseId" | "truckNumber" | "query";
  value: string;
};

export interface TpmsLocalRecord extends TpmsAssignmentValue {
  sourceLayer: Exclude<SourceLayer, "unknown">;
  observedAt: string | null;
  sourceUpdatedAt: string | null;
}

export interface TpmsReadModelDependencies {
  readLive(lookup: TpmsLookup): Promise<TpmsLocalRecord[]>;
  readCached(lookup: TpmsLookup): Promise<TpmsLocalRecord[]>;
  readExtract(lookup: TpmsLookup): Promise<TpmsLocalRecord[]>;
  now(): number;
}

interface DatabaseInfrastructure {
  sql: any;
  db: { execute(query: unknown): Promise<unknown> };
}

function rowsOf(result: unknown): any[] {
  if (result && typeof result === "object" && "rows" in result && Array.isArray((result as any).rows)) {
    return (result as any).rows;
  }
  return Array.isArray(result) ? result : [];
}

function iso(value: unknown): string | null {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function text(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function fullName(firstName: unknown, lastName: unknown): string | null {
  return text([text(firstName), text(lastName)].filter(Boolean).join(" "));
}

function normalizedLookup(lookup: TpmsLookup): TpmsLookup {
  if (lookup.kind === "enterpriseId") {
    return { ...lookup, value: lookup.value.trim().toUpperCase() };
  }
  if (lookup.kind === "truckNumber") {
    return { ...lookup, value: toCanonical(lookup.value) };
  }
  return { ...lookup, value: lookup.value.trim() };
}

async function loadDatabaseInfrastructure(): Promise<DatabaseInfrastructure> {
  const [{ sql }, { db }] = await Promise.all([import("drizzle-orm"), import("../db")]);
  return { sql, db };
}

function databaseCondition(sql: any, lookup: TpmsLookup, table: "live" | "cached") {
  if (lookup.kind === "enterpriseId") {
    return table === "live"
      ? sql`UPPER(TRIM(enterprise_id)) = ${lookup.value}`
      : sql`UPPER(TRIM(COALESCE(enterprise_id, CASE WHEN lookup_type = 'enterprise_id' THEN lookup_key END))) = ${lookup.value}`;
  }
  if (lookup.kind === "truckNumber") {
    return table === "live"
      ? sql`LTRIM(TRIM(truck_no), '0') = ${lookup.value}`
      : sql`LTRIM(TRIM(COALESCE(truck_no, CASE WHEN lookup_type = 'truck_number' THEN lookup_key END)), '0') = ${lookup.value}`;
  }
  const upper = lookup.value.toUpperCase();
  const pattern = `%${lookup.value}%`;
  const truck = /^\d+$/.test(lookup.value) ? toCanonical(lookup.value) : "__NO_TRUCK_MATCH__";
  return table === "live"
    ? sql`(UPPER(TRIM(enterprise_id)) = ${upper} OR TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) ILIKE ${pattern} OR LTRIM(TRIM(COALESCE(truck_no, '')), '0') = ${truck})`
    : sql`(UPPER(TRIM(COALESCE(enterprise_id, CASE WHEN lookup_type = 'enterprise_id' THEN lookup_key END))) = ${upper} OR TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) ILIKE ${pattern} OR LTRIM(TRIM(COALESCE(truck_no, CASE WHEN lookup_type = 'truck_number' THEN lookup_key END, '')), '0') = ${truck})`;
}

async function readLive(lookupInput: TpmsLookup): Promise<TpmsLocalRecord[]> {
  const lookup = normalizedLookup(lookupInput);
  const { sql, db } = await loadDatabaseInfrastructure();
  const result = await db.execute(sql`
    SELECT enterprise_id, first_name, last_name, truck_no, district_no,
      mobile_phone, tech_manager_name, tech_manager_ldap_id,
      last_tpms_updated_at, synced_at, updated_at
    FROM tpms_tech_profiles
    WHERE ${databaseCondition(sql, lookup, "live")}
  `);
  return rowsOf(result).map((row): TpmsLocalRecord => ({
    sourceLayer: "live",
    enterpriseId: text(row.enterprise_id)?.toUpperCase() ?? null,
    technicianName: fullName(row.first_name, row.last_name),
    truckNumber: text(row.truck_no),
    district: text(row.district_no),
    mobileNumber: text(row.mobile_phone),
    jobTitle: null,
    planningArea: null,
    managerName: text(row.tech_manager_name),
    managerEnterpriseId: text(row.tech_manager_ldap_id)?.toUpperCase() ?? null,
    observedAt: iso(row.last_tpms_updated_at ?? row.synced_at),
    sourceUpdatedAt: iso(row.updated_at ?? row.synced_at),
  }));
}

async function readCached(lookupInput: TpmsLookup): Promise<TpmsLocalRecord[]> {
  const lookup = normalizedLookup(lookupInput);
  const { sql, db } = await loadDatabaseInfrastructure();
  const result = await db.execute(sql`
    SELECT lookup_key, lookup_type, enterprise_id, first_name, last_name,
      truck_no, district_no, contact_no, last_success_at, updated_at
    FROM tpms_cached_assignments
    WHERE ${databaseCondition(sql, lookup, "cached")}
  `);
  return rowsOf(result).map((row): TpmsLocalRecord => ({
    sourceLayer: "cached",
    enterpriseId: text(row.enterprise_id ?? (row.lookup_type === "enterprise_id" ? row.lookup_key : null))?.toUpperCase() ?? null,
    technicianName: fullName(row.first_name, row.last_name),
    truckNumber: text(row.truck_no ?? (row.lookup_type === "truck_number" ? row.lookup_key : null)),
    district: text(row.district_no),
    mobileNumber: text(row.contact_no),
    jobTitle: null,
    planningArea: null,
    managerName: null,
    managerEnterpriseId: null,
    observedAt: iso(row.last_success_at),
    sourceUpdatedAt: iso(row.updated_at),
  }));
}

function extractMatches(row: TpmsLocalRecord, lookup: TpmsLookup): boolean {
  if (lookup.kind === "enterpriseId") return row.enterpriseId === lookup.value;
  if (lookup.kind === "truckNumber") return toCanonical(row.truckNumber) === lookup.value;
  const query = lookup.value.toLowerCase();
  return row.enterpriseId?.toLowerCase() === query
    || row.technicianName?.toLowerCase().includes(query) === true
    || (/^\d+$/.test(lookup.value) && toCanonical(row.truckNumber) === toCanonical(lookup.value));
}

async function readExtract(lookupInput: TpmsLookup): Promise<TpmsLocalRecord[]> {
  const lookup = normalizedLookup(lookupInput);
  const snapshot = await import("../tpms-extract-snapshot");
  const info = snapshot.getTpmsSnapshotInfo();
  if (!info.lastRefreshedAt) throw new Error("extract snapshot unavailable");
  const timestamp = info.lastRefreshedAt.toISOString();
  const rows: TpmsLocalRecord[] = [];
  for (const [enterpriseId, contact] of snapshot.getTpmsSnapshot()) {
    const row: TpmsLocalRecord = {
      sourceLayer: "extract",
      enterpriseId: text(enterpriseId)?.toUpperCase() ?? null,
      technicianName: text(contact.fullName),
      truckNumber: text(contact.truckLu),
      district: null,
      mobileNumber: text(contact.mobilePhone),
      jobTitle: null,
      planningArea: null,
      managerName: null,
      managerEnterpriseId: text(contact.managerEntId)?.toUpperCase() ?? null,
      observedAt: timestamp,
      sourceUpdatedAt: timestamp,
    };
    if (extractMatches(row, lookup)) rows.push(row);
  }
  return rows;
}

export const tpmsProductionDependencies: TpmsReadModelDependencies = {
  readLive,
  readCached,
  readExtract,
  now: () => Date.now(),
};

function freshness(sourceLayer: TpmsLocalRecord["sourceLayer"], timestamp: string | null, now: number): Freshness {
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) {
    return { state: "unknown", observedAt: null, ageSeconds: null };
  }
  const ageSeconds = Math.max(0, Math.floor((now - Date.parse(timestamp)) / 1000));
  const threshold = sourceLayer === "live"
    ? LIVE_FRESHNESS_WINDOW_SECONDS
    : sourceLayer === "cached"
      ? CACHED_FRESHNESS_WINDOW_SECONDS
      : EXTRACT_FRESHNESS_WINDOW_SECONDS;
  return {
    state: ageSeconds <= threshold ? "fresh" : "stale",
    observedAt: timestamp,
    ageSeconds,
  };
}

function valueOf(row: TpmsLocalRecord): TpmsAssignmentValue {
  return {
    enterpriseId: text(row.enterpriseId)?.toUpperCase() ?? null,
    technicianName: text(row.technicianName),
    truckNumber: text(row.truckNumber),
    district: text(row.district),
    mobileNumber: text(row.mobileNumber),
    jobTitle: text(row.jobTitle),
    planningArea: text(row.planningArea),
    managerName: text(row.managerName),
    managerEnterpriseId: text(row.managerEnterpriseId)?.toUpperCase() ?? null,
  };
}

function observationOf(row: TpmsLocalRecord, now: number): SourceObservation<TpmsAssignmentValue> {
  const value = valueOf(row);
  const canonicalTruck = toCanonical(value.truckNumber);
  const normalizedValue = value.truckNumber && canonicalTruck && canonicalTruck !== value.truckNumber
    ? { ...value, truckNumber: canonicalTruck }
    : undefined;
  return {
    sourceLayer: row.sourceLayer,
    observedAt: iso(row.observedAt),
    sourceUpdatedAt: iso(row.sourceUpdatedAt),
    value,
    ...(normalizedValue ? { normalizedValue } : {}),
    freshness: freshness(row.sourceLayer, iso(row.observedAt) ?? iso(row.sourceUpdatedAt), now),
  };
}

function uniqueWarnings(warnings: ApiWarning[]): ApiWarning[] {
  return [...new Map(warnings.map((warning) => [`${warning.code}:${warning.message}`, warning])).values()];
}

async function buildObservations(lookup: TpmsLookup, dependencies: TpmsReadModelDependencies): Promise<TpmsObservationSet> {
  const readers = [
    ["live", dependencies.readLive],
    ["cached", dependencies.readCached],
    ["extract", dependencies.readExtract],
  ] as const;
  const settled = await Promise.allSettled(readers.map(([, read]) => read(normalizedLookup(lookup))));
  const warnings: ApiWarning[] = [];
  const rows: TpmsLocalRecord[] = [];
  settled.forEach((result, index) => {
    const source = readers[index][0];
    if (result.status === "fulfilled") rows.push(...result.value);
    else warnings.push({ code: "SOURCE_UNAVAILABLE", message: `${source} TPMS profile data is unavailable` });
  });
  const observations = rows.map((row) => observationOf(row, dependencies.now()));
  for (const observation of observations) {
    if (observation.freshness.state === "stale") {
      warnings.push({ code: "SOURCE_STALE", message: `${observation.sourceLayer} TPMS profile data is stale` });
    }
  }
  const enterprises = new Set(observations.map((item) => item.value.enterpriseId?.toUpperCase()).filter(Boolean));
  const trucks = new Set(observations.map((item) => toCanonical(item.value.truckNumber)).filter(Boolean));
  if (enterprises.size > 1 || trucks.size > 1) {
    warnings.push({ code: "PARTIAL_DATA", message: "TPMS source layers report conflicting assignments" });
  }
  return { observations, warnings: uniqueWarnings(warnings) };
}

export function createTpmsObservationBuilders(dependencies: TpmsReadModelDependencies) {
  return {
    buildByEnterpriseId: (enterpriseId: string) => buildObservations(
      { kind: "enterpriseId", value: enterpriseId }, dependencies,
    ),
    buildByTruckNumber: (truckNumber: string) => buildObservations(
      { kind: "truckNumber", value: truckNumber }, dependencies,
    ),
  };
}

const productionBuilders = createTpmsObservationBuilders(tpmsProductionDependencies);

export async function buildTpmsObservationsByEnterpriseId(enterpriseId: string): Promise<TpmsObservationSet> {
  return productionBuilders.buildByEnterpriseId(enterpriseId);
}

export async function buildTpmsObservationsByTruckNumber(truckNumber: string): Promise<TpmsObservationSet> {
  return productionBuilders.buildByTruckNumber(truckNumber);
}

export async function searchTpmsLocalRecords(query: string): Promise<TpmsLocalRecord[]> {
  const lookup: TpmsLookup = { kind: "query", value: query };
  const settled = await Promise.allSettled([
    tpmsProductionDependencies.readLive(lookup),
    tpmsProductionDependencies.readCached(lookup),
    tpmsProductionDependencies.readExtract(lookup),
  ]);
  return settled.flatMap((result) => result.status === "fulfilled"
    ? result.value.map((row) => ({ ...valueOf(row), sourceLayer: row.sourceLayer, observedAt: iso(row.observedAt), sourceUpdatedAt: iso(row.sourceUpdatedAt) }))
    : []);
}
