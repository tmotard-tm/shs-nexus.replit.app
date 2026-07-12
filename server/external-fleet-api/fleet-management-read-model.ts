import { toCanonical, toDisplayNumber } from "../vehicle-number-utils";
import type { ApiWarning } from "./types";

export interface FleetManagementListingRow {
  truckNumber: string | null;
  vehicleNumber: string | null;
  vin: string | null;
  technician: { enterpriseId: string | null; displayName: string | null };
  displayedStatuses: Record<string, string | boolean | number | null>;
  sourceIndicators: Record<string, "present" | "missing" | "stale" | "unknown">;
  sourceUpdatedAt: string | null;
  warnings: ApiWarning[];
}

export interface PagedFleetManagementListing {
  page: number;
  pageSize: number;
  totalCount: number;
  rows: FleetManagementListingRow[];
}

export interface FleetManagementListingInput {
  page: number;
  pageSize: number;
  sort: "truckNumber" | "vehicleNumber" | "technician" | "status";
  direction: "asc" | "desc";
  query?: string;
}

export interface SourceSnapshot<T> {
  data: T;
  sourceUpdatedAt: string | null;
  stale?: boolean;
}

export interface FleetManagementSourceVehicle {
  vehicleNumber?: string | null;
  vin?: string | null;
  holmanTechAssigned?: string | null;
  holmanTechName?: string | null;
  tpmsAssignedTechId?: string | null;
  tpmsAssignedTechName?: string | null;
  statusCode?: number | null;
  outOfServiceDate?: string | null;
  [key: string]: unknown;
}

export interface FleetOpsSourceRow {
  truckNumber: string;
  holmanTechId?: string | null;
  tpmsTechId?: string | null;
  amsTechId?: string | null;
  rootCause?: string | null;
}

interface TruckFlag { truckNumber: string; value: boolean }
interface PoFlag { truckNumber: string; hasOpenRental: boolean; openRentalCount: number; hasOpenMaintenance: boolean; openMaintenanceCount: number }
interface DtcStatus { truckNumber: string; severityScore: number | null; severityLabel: string | null }
interface AmsStatus { vin: string; truckStatus: string | null }
interface TechnicianStatus { enterpriseId: string; employmentStatus: string | null }

interface CachedVehicleReadResult {
  success: boolean;
  vehicles: FleetManagementSourceVehicle[];
  syncStatus: { lastSyncAt: string | null; isStale: boolean };
  pagination?: { totalPages?: number };
}

export type FleetManagementCachedVehicleServiceLoader = () => Promise<{
  readCachedVehicles(options: { page?: number; pageSize?: number; statusCode?: number }): Promise<CachedVehicleReadResult>;
}>;

interface DatabaseInfrastructure {
  sql(strings: TemplateStringsArray, ...values: unknown[]): unknown;
  db: { execute(query: unknown): Promise<unknown> };
}

interface OpenRentalsProductionModel {
  data: Array<Record<string, unknown>>;
  sourceUpdatedAt: string | null;
}

interface FleetManagementProductionLoaders {
  loadCachedVehicleService: FleetManagementCachedVehicleServiceLoader;
  loadDatabaseInfrastructure(): Promise<DatabaseInfrastructure>;
  loadOpenRentalsReadModel(): Promise<{
    buildOpenRentalsReadModel(input: { includeOos: false; view: "business_logic" }): Promise<OpenRentalsProductionModel>;
  }>;
}

export interface FleetManagementListingDependencies {
  readPrimaryVehicles(): Promise<SourceSnapshot<FleetManagementSourceVehicle[]>>;
  readFleetOps(): Promise<SourceSnapshot<FleetOpsSourceRow[]>>;
  readTpmsSync(): Promise<SourceSnapshot<Record<string, unknown> | null>>;
  readRentalOps(): Promise<SourceSnapshot<string[]>>;
  readAmsStatuses(): Promise<SourceSnapshot<AmsStatus[]>>;
  readPoFlags(): Promise<SourceSnapshot<PoFlag[]>>;
  readRepairShopFlags(): Promise<SourceSnapshot<TruckFlag[]>>;
  readOffboardingFlags(): Promise<SourceSnapshot<TruckFlag[]>>;
  readDtcStatuses(): Promise<SourceSnapshot<DtcStatus[]>>;
  readTechnicianStatuses(): Promise<SourceSnapshot<TechnicianStatus[]>>;
}

export class FleetManagementPrimarySourceUnavailableError extends Error {
  constructor(_cause?: unknown) {
    super("The fleet management primary vehicle source is unavailable");
    this.name = "FleetManagementPrimarySourceUnavailableError";
  }
}

function rowsOf<T>(result: unknown): T[] {
  if (result && typeof result === "object" && "rows" in result && Array.isArray((result as { rows: unknown }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  return Array.isArray(result) ? result as T[] : [];
}

function iso(value: unknown): string | null {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

async function readAllCachedVehicles(loadService: FleetManagementCachedVehicleServiceLoader): Promise<SourceSnapshot<FleetManagementSourceVehicle[]>> {
  const holmanVehicleSyncService = await loadService();
  const first = await holmanVehicleSyncService.readCachedVehicles({ page: 1, pageSize: 500, statusCode: 0 });
  if (!first.success) throw new FleetManagementPrimarySourceUnavailableError();
  const vehicles = [...first.vehicles];
  const totalPages = first.pagination?.totalPages ?? 1;
  for (let page = 2; page <= totalPages; page++) {
    const next = await holmanVehicleSyncService.readCachedVehicles({ page, pageSize: 500, statusCode: 0 });
    if (!next.success) throw new FleetManagementPrimarySourceUnavailableError();
    vehicles.push(...next.vehicles);
  }
  if (vehicles.length === 0) throw new FleetManagementPrimarySourceUnavailableError();
  return { data: vehicles, sourceUpdatedAt: first.syncStatus.lastSyncAt ?? null, stale: first.syncStatus.isStale };
}

async function readFleetOps(loadDatabase: () => Promise<DatabaseInfrastructure>): Promise<SourceSnapshot<FleetOpsSourceRow[]>> {
  const [{ sql, db }, { analyzeAlignment }] = await Promise.all([
    loadDatabase(), import("../alignment-analysis-service"),
  ]);
  const result = await db.execute(sql`
    WITH tpms_latest AS (
      SELECT DISTINCT ON (LTRIM(truck_no, '0'))
        LTRIM(truck_no, '0') AS canonical_truck,
        enterprise_id AS tpms_id,
        TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) AS tpms_name,
        district_no
      FROM tpms_tech_profiles
      WHERE truck_no IS NOT NULL AND truck_no != '' AND LTRIM(truck_no, '0') != ''
      ORDER BY LTRIM(truck_no, '0'), updated_at DESC
    )
    SELECT h.holman_vehicle_number AS truck_number,
      h.holman_tech_assigned AS holman_tech_id, h.holman_tech_name,
      COALESCE(t.tpms_id, '') AS tpms_tech_id, COALESCE(t.tpms_name, '') AS tpms_tech_name,
      a.ams_assigned_ldap AS ams_tech_id, h.vin, h.holman_assigned_status_cd AS holman_status_cd,
      h.byov_vin_missing, t.district_no
    FROM holman_vehicles_cache h
    LEFT JOIN tpms_latest t ON t.canonical_truck = LTRIM(h.holman_vehicle_number, '0')
    LEFT JOIN ams_vehicles_cache a ON a.vin = h.vin
    WHERE h.is_active = true AND (h.status_code != 2 OR h.status_code IS NULL) AND h.out_of_service_date IS NULL
      AND (
        COALESCE(LOWER(TRIM(h.holman_tech_assigned)), '') != COALESCE(LOWER(TRIM(t.tpms_id)), '')
        OR (COALESCE(LOWER(TRIM(a.ams_assigned_ldap)), '') NOT IN ('', 'unknown')
          AND COALESCE(LOWER(TRIM(a.ams_assigned_ldap)), '') != COALESCE(LOWER(TRIM(t.tpms_id)), ''))
      )
    ORDER BY h.holman_vehicle_number
  `);
  const raw = rowsOf<Record<string, any>>(result);
  const data = await Promise.all(raw.map(async (row) => ({
    truckNumber: row.truck_number,
    holmanTechId: row.holman_tech_id || null,
    tpmsTechId: row.tpms_tech_id || null,
    amsTechId: row.ams_tech_id || null,
    rootCause: (await analyzeAlignment(
      row.truck_number, row.holman_tech_id || null, row.holman_tech_name || null,
      row.tpms_tech_id || null, row.tpms_tech_name || null, row.ams_tech_id || null,
      row.vin || null, row.holman_status_cd || null, !!row.byov_vin_missing, row.district_no || null,
    )).rootCause,
  })));
  return { data, sourceUpdatedAt: null };
}

const loadHolmanVehicleSyncService: FleetManagementCachedVehicleServiceLoader = async () =>
  (await import("../holman-vehicle-sync-service")).holmanVehicleSyncService;

const defaultProductionLoaders: FleetManagementProductionLoaders = {
  loadCachedVehicleService: loadHolmanVehicleSyncService,
  loadDatabaseInfrastructure: async () => {
    const [{ sql }, { db }] = await Promise.all([import("drizzle-orm"), import("../db")]);
    return { sql, db } as DatabaseInfrastructure;
  },
  loadOpenRentalsReadModel: async () => import("./rental-ops-read-model"),
};

export function createFleetManagementProductionDependencies(
  overrides: Partial<FleetManagementProductionLoaders> | FleetManagementCachedVehicleServiceLoader = {},
): FleetManagementListingDependencies {
  const supplied = typeof overrides === "function" ? { loadCachedVehicleService: overrides } : overrides;
  const loaders = { ...defaultProductionLoaders, ...supplied };
  return {
  readPrimaryVehicles: () => readAllCachedVehicles(loaders.loadCachedVehicleService),
  readFleetOps: () => readFleetOps(loaders.loadDatabaseInfrastructure),
  readTpmsSync: async () => {
    const { storage } = await import("../storage");
    const data = await storage.getTpmsSyncState();
    return { data: data as unknown as Record<string, unknown> | null, sourceUpdatedAt: iso(data?.lastSyncAt) };
  },
  readRentalOps: async () => {
    const { buildOpenRentalsReadModel } = await loaders.loadOpenRentalsReadModel();
    const model = await buildOpenRentalsReadModel({ includeOos: false, view: "business_logic" });
    const data = Array.from(new Set(model.data.map((row) =>
      toDisplayNumber(String(row.vehicleNumberPadded ?? row.vehicleNumber ?? "")),
    ).filter(Boolean)));
    return { data, sourceUpdatedAt: model.sourceUpdatedAt };
  },
  readAmsStatuses: async () => {
    const { sql, db } = await loaders.loadDatabaseInfrastructure();
    const result = await db.execute(sql`SELECT vin, ams_truck_status_label, last_ams_sync_at FROM ams_vehicles_cache`);
    const rows = rowsOf<any>(result);
    return {
      data: rows.map((row) => ({ vin: row.vin, truckStatus: row.ams_truck_status_label ?? null })),
      sourceUpdatedAt: rows.map((row) => iso(row.last_ams_sync_at)).filter(Boolean).sort()[0] ?? null,
    };
  },
  readPoFlags: async () => {
    const { sql, db } = await loaders.loadDatabaseInfrastructure();
    const result = await db.execute(sql`
      SELECT vehicle_number,
        COUNT(*) FILTER (WHERE LOWER(COALESCE(po_type, '')) = 'rental' OR UPPER(COALESCE(description, '')) LIKE '%RENTAL%')::int AS rental_count,
        COUNT(*) FILTER (WHERE LOWER(COALESCE(po_type, '')) = 'maintenance' OR (LOWER(COALESCE(po_type, '')) != 'rental' AND UPPER(COALESCE(description, '')) NOT LIKE '%RENTAL%'))::int AS maintenance_count,
        MIN(last_synced_at) AS source_updated_at
      FROM holman_po_cache WHERE UPPER(COALESCE(po_status, '')) IN ('APPROVED', 'HOLD', 'BILL HOLD', 'OPEN')
      GROUP BY vehicle_number
    `);
    const rows = rowsOf<any>(result);
    return {
      data: rows.map((row) => ({ truckNumber: row.vehicle_number, hasOpenRental: Number(row.rental_count) > 0, openRentalCount: Number(row.rental_count), hasOpenMaintenance: Number(row.maintenance_count) > 0, openMaintenanceCount: Number(row.maintenance_count) })),
      sourceUpdatedAt: rows.map((row) => iso(row.source_updated_at)).filter(Boolean).sort()[0] ?? null,
    };
  },
  readRepairShopFlags: async () => {
    const { sql, db } = await loaders.loadDatabaseInfrastructure();
    const result = await db.execute(sql`SELECT truck_number, repair_address, last_updated_at FROM fs_trucks`);
    const rows = rowsOf<any>(result);
    return { data: rows.map((row) => ({ truckNumber: row.truck_number, value: !!String(row.repair_address ?? "").trim() })), sourceUpdatedAt: rows.map((row) => iso(row.last_updated_at)).filter(Boolean).sort()[0] ?? null };
  },
  readOffboardingFlags: async () => {
    const { sql, db } = await loaders.loadDatabaseInfrastructure();
    const result = await db.execute(sql`SELECT truck_number, offboarding_flagged, last_updated_at FROM fs_trucks`);
    const rows = rowsOf<any>(result);
    return { data: rows.map((row) => ({ truckNumber: row.truck_number, value: !!row.offboarding_flagged })), sourceUpdatedAt: rows.map((row) => iso(row.last_updated_at)).filter(Boolean).sort()[0] ?? null };
  },
  readDtcStatuses: async () => {
    const { getSnowflakeService, isSnowflakeConfigured } = await import("../snowflake-service");
    if (!isSnowflakeConfigured()) throw new Error("source unavailable");
    const rows = await getSnowflakeService().executeQuery(`SELECT TRUCK_NUMBER, SEVERITY_SCORE, SEVERITY_LABEL FROM PARTS_SUPPLYCHAIN.FLEET.SAMSARA_CRITICALITY_SCORE WHERE DTC_COUNT_DISTINCT > 0 AND (SEVERITY_LABEL IS NULL OR SEVERITY_LABEL != 'CLEAR')`);
    return { data: rows.map((row: any) => ({ truckNumber: String(row.TRUCK_NUMBER), severityScore: row.SEVERITY_SCORE == null ? null : Number(row.SEVERITY_SCORE), severityLabel: row.SEVERITY_LABEL ?? null })), sourceUpdatedAt: null };
  },
  readTechnicianStatuses: async () => {
    const { sql, db } = await loaders.loadDatabaseInfrastructure();
    const result = await db.execute(sql`SELECT tech_racfid, employment_status, synced_at FROM all_techs`);
    const rows = rowsOf<any>(result);
    return { data: rows.map((row) => ({ enterpriseId: row.tech_racfid, employmentStatus: row.employment_status ?? null })), sourceUpdatedAt: rows.map((row) => iso(row.synced_at)).filter(Boolean).sort()[0] ?? null };
  },
  };
}

export const fleetManagementProductionDependencies = createFleetManagementProductionDependencies();

function indicator(snapshot: SourceSnapshot<unknown> | null): "present" | "missing" | "stale" | "unknown" {
  if (!snapshot) return "missing";
  if (snapshot.stale) return "stale";
  return snapshot.sourceUpdatedAt ? "present" : "unknown";
}

function canonical(value: string | null | undefined): string {
  return toCanonical(value).toLowerCase();
}

function oldest(values: Array<string | null | undefined>): string | null {
  return values.filter((value): value is string => !!value && Number.isFinite(Date.parse(value))).sort()[0] ?? null;
}

function indexByTruck<T extends { truckNumber: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((row) => [canonical(row.truckNumber), row]));
}

function optionalWarning(sourceName: string): ApiWarning {
  return { code: "SOURCE_UNAVAILABLE", message: `${sourceName} display data is unavailable` };
}

export function createFleetManagementListingBuilder(dependencies: FleetManagementListingDependencies) {
  return async (input: FleetManagementListingInput): Promise<PagedFleetManagementListing> => {
    let primary: SourceSnapshot<FleetManagementSourceVehicle[]>;
    try {
      primary = await dependencies.readPrimaryVehicles();
      if (!primary.data.length) throw new Error("empty source");
    } catch (error) {
      throw error instanceof FleetManagementPrimarySourceUnavailableError
        ? error
        : new FleetManagementPrimarySourceUnavailableError(error);
    }

    const optionalEntries = await Promise.allSettled([
      dependencies.readFleetOps(), dependencies.readTpmsSync(), dependencies.readRentalOps(),
      dependencies.readAmsStatuses(), dependencies.readPoFlags(), dependencies.readRepairShopFlags(),
      dependencies.readOffboardingFlags(), dependencies.readDtcStatuses(), dependencies.readTechnicianStatuses(),
    ]);
    const snapshots = optionalEntries.map((entry) => entry.status === "fulfilled" ? entry.value : null);
    const [fleetOps, tpmsSync, rentalOps, ams, po, repair, offboarding, dtc, techs] = snapshots as [
      SourceSnapshot<FleetOpsSourceRow[]> | null, SourceSnapshot<Record<string, unknown> | null> | null,
      SourceSnapshot<string[]> | null, SourceSnapshot<AmsStatus[]> | null, SourceSnapshot<PoFlag[]> | null,
      SourceSnapshot<TruckFlag[]> | null, SourceSnapshot<TruckFlag[]> | null, SourceSnapshot<DtcStatus[]> | null,
      SourceSnapshot<TechnicianStatus[]> | null,
    ];
    const sourceNames = ["FleetOps", "TPMS", "Rental Ops", "AMS", "PO", "repair shop", "offboarding", "Samsara", "technician roster"];
    const baseWarnings = snapshots.flatMap((snapshot, index) => snapshot ? [] : [optionalWarning(sourceNames[index])]);

    const fleetOpsMap = indexByTruck(fleetOps?.data ?? []);
    const rentalSet = new Set((rentalOps?.data ?? []).map(canonical));
    const amsMap = new Map((ams?.data ?? []).map((row) => [row.vin.trim().toUpperCase(), row]));
    const poMap = indexByTruck(po?.data ?? []);
    const repairMap = indexByTruck(repair?.data ?? []);
    const offboardingMap = indexByTruck(offboarding?.data ?? []);
    const dtcMap = indexByTruck(dtc?.data ?? []);
    const techMap = new Map((techs?.data ?? []).map((row) => [row.enterpriseId.trim().toLowerCase(), row.employmentStatus]));
    const uniqueVehicles = new Map<string, FleetManagementSourceVehicle>();
    for (const vehicle of primary.data) {
      const key = canonical(vehicle.vehicleNumber);
      if (key && !uniqueVehicles.has(key)) uniqueVehicles.set(key, vehicle);
    }

    let rows = [...uniqueVehicles.values()].map((vehicle): FleetManagementListingRow => {
      const key = canonical(vehicle.vehicleNumber);
      const fleet = fleetOpsMap.get(key);
      const poFlag = poMap.get(key);
      const dtcStatus = dtcMap.get(key);
      const holmanId = String(vehicle.holmanTechAssigned ?? "").trim() || null;
      const tpmsId = String(vehicle.tpmsAssignedTechId ?? "").trim() || null;
      const technicianId = tpmsId || holmanId;
      const technicianName = String(vehicle.tpmsAssignedTechName ?? "").trim() || String(vehicle.holmanTechName ?? "").trim() || null;
      const conflicting = !!holmanId && !!tpmsId && holmanId.toLowerCase() !== tpmsId.toLowerCase();
      const assignmentStatus = fleet?.rootCause === "status_blocked" ? "blocked"
        : fleet?.rootCause === "pending" ? "pending"
        : fleet?.rootCause === "byov_vin_missing" ? "byov"
        : fleet || conflicting || (!!holmanId !== !!tpmsId) ? "mismatch"
        : holmanId && tpmsId ? "synced" : "unassigned";
      const displayedStatuses: Record<string, string | boolean | number | null> = {
        holmanVehicleStatus: vehicle.outOfServiceDate || vehicle.statusCode === 2 ? "out_of_service" : "active",
        holmanAssignmentEnterpriseId: holmanId,
        tpmsAssignmentEnterpriseId: tpmsId,
        assignmentStatus,
      };
      if (fleetOps) Object.assign(displayedStatuses, {
        fleetOpsHolmanEnterpriseId: fleet?.holmanTechId ?? null,
        fleetOpsTpmsEnterpriseId: fleet?.tpmsTechId ?? null,
        fleetOpsAmsEnterpriseId: fleet?.amsTechId ?? null,
        fleetOpsRootCause: fleet?.rootCause ?? null,
      });
      if (tpmsSync) displayedStatuses.tpmsSyncStatus = String(tpmsSync.data?.status ?? "unknown");
      if (rentalOps) displayedStatuses.rentalOpsOpen = rentalSet.has(key);
      if (ams) displayedStatuses.amsTruckStatus = amsMap.get(String(vehicle.vin ?? "").toUpperCase())?.truckStatus ?? null;
      if (po) Object.assign(displayedStatuses, {
        hasOpenRentalPo: poFlag?.hasOpenRental ?? false, openRentalPoCount: poFlag?.openRentalCount ?? 0,
        hasOpenMaintenancePo: poFlag?.hasOpenMaintenance ?? false, openMaintenancePoCount: poFlag?.openMaintenanceCount ?? 0,
      });
      if (repair) displayedStatuses.inRepairShop = repairMap.get(key)?.value ?? false;
      if (offboarding) displayedStatuses.offboardingFlagged = offboardingMap.get(key)?.value ?? false;
      if (dtc) Object.assign(displayedStatuses, {
        samsaraCheckEngine: !!dtcStatus, samsaraDtcSeverityScore: dtcStatus?.severityScore ?? null,
        samsaraDtcSeverityLabel: dtcStatus?.severityLabel ?? null,
      });
      if (techs) displayedStatuses.technicianEmploymentStatus = technicianId ? techMap.get(technicianId.toLowerCase()) ?? null : null;
      const warnings = [...baseWarnings];
      if (conflicting || (fleet && new Set([fleet.holmanTechId, fleet.tpmsTechId, fleet.amsTechId].filter(Boolean).map((value) => String(value).toLowerCase())).size > 1)) {
        warnings.push({ code: "AMBIGUOUS_MATCH", message: "Assignment sources disagree for this vehicle" });
      }
      const usedSnapshots = [primary, ...snapshots].filter((snapshot): snapshot is SourceSnapshot<unknown> => !!snapshot);
      return {
        truckNumber: toDisplayNumber(vehicle.vehicleNumber) || null,
        vehicleNumber: toDisplayNumber(vehicle.vehicleNumber) || null,
        vin: String(vehicle.vin ?? "").trim() || null,
        technician: { enterpriseId: technicianId, displayName: technicianName },
        displayedStatuses,
        sourceIndicators: {
          holman: indicator(primary), fleetOps: indicator(fleetOps), tpms: indicator(tpmsSync),
          rentalOps: indicator(rentalOps), ams: indicator(ams), po: indicator(po), repairShop: indicator(repair),
          offboarding: indicator(offboarding), samsara: indicator(dtc), technicianRoster: indicator(techs),
        },
        sourceUpdatedAt: oldest(usedSnapshots.map((snapshot) => snapshot.sourceUpdatedAt)),
        warnings,
      };
    });

    const query = input.query?.trim().toLowerCase();
    if (query) {
      rows = rows.filter((row) => [
        row.truckNumber, row.vehicleNumber, row.vin, row.technician.enterpriseId, row.technician.displayName,
        ...Object.entries(row.displayedStatuses).flatMap(([key, value]) => value === true ? [key, value] : [value]),
      ].some((value) => value != null && String(value).toLowerCase().includes(query)));
    }
    const tie = (a: FleetManagementListingRow, b: FleetManagementListingRow) => canonical(a.truckNumber).localeCompare(canonical(b.truckNumber), undefined, { numeric: true }) || String(a.vin ?? "").localeCompare(String(b.vin ?? ""));
    const sortValue = (row: FleetManagementListingRow) => input.sort === "technician"
      ? row.technician.displayName ?? row.technician.enterpriseId ?? ""
      : input.sort === "status" ? String(row.displayedStatuses.assignmentStatus ?? "")
      : input.sort === "vehicleNumber" ? row.vehicleNumber ?? "" : row.truckNumber ?? "";
    rows.sort((a, b) => {
      const compared = sortValue(a).localeCompare(sortValue(b), undefined, { numeric: true, sensitivity: "base" });
      return compared ? compared * (input.direction === "asc" ? 1 : -1) : tie(a, b);
    });
    const totalCount = rows.length;
    const start = (input.page - 1) * input.pageSize;
    return { page: input.page, pageSize: input.pageSize, totalCount, rows: rows.slice(start, start + input.pageSize) };
  };
}

export const buildFleetManagementListing = createFleetManagementListingBuilder(fleetManagementProductionDependencies);
