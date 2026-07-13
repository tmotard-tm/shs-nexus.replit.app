import { eq, inArray, isNotNull, or } from "drizzle-orm";

import { toDisplayNumber } from "../vehicle-number-utils";
import type { ApiWarning } from "./types";

export const RENTAL_OPEN_TABLE = "PARTS_SUPPLYCHAIN.FLEET.HOLMAN_OPEN_RENTAL_REPORT";
export const RENTAL_TICKET_TABLE = "PARTS_SUPPLYCHAIN.FLEET.ENTERPRISE_OPEN_RENTAL_TICKET_REPORT";
const RENTAL_OPS_CACHE_TTL_MS = 30 * 60 * 1000;
// Snowflake source reads are capped at this row count. A returned count equal
// to the cap means the source was likely truncated, so a PARTIAL_DATA warning
// is surfaced rather than silently returning an incomplete slice.
export const RENTAL_SOURCE_ROW_LIMIT = 5000;

type RentalRow = Record<string, any>;

interface SnowflakeClient {
  connect(): Promise<unknown>;
  executeQuery(query: string): Promise<any[]>;
}

export interface OpenRentalsInput {
  fileDate?: string;
  includeOos: boolean;
  view: "business_logic" | "raw";
}

export interface OpenRentalsReadModel {
  data: Array<Record<string, unknown>>;
  total: number;
  enterpriseCount?: number;
  holmanNonEnterpriseCount?: number;
  totalHolmanPOLines?: number;
  totalPOLines?: number;
  oosFilteredCount?: number;
  view: "business_logic" | "raw";
  sourceUpdatedAt: string | null;
  warnings: ApiWarning[];
}

export class OpenRentalsSourceUnavailableError extends Error {
  readonly reason: "not_configured" | "unavailable";
  readonly sourceCause: unknown;

  constructor(
    sourceCause: unknown,
    reason: "not_configured" | "unavailable" = "unavailable",
  ) {
    super("Rental operations source is unavailable");
    this.name = "OpenRentalsSourceUnavailableError";
    this.reason = reason;
    this.sourceCause = sourceCause;
  }
}

export interface OpenRentalsReadModelDependencies {
  isSnowflakeConfigured(): boolean | Promise<boolean>;
  getSnowflakeService(): Promise<SnowflakeClient>;
  getOosVehicleSet(): Promise<Set<string>>;
  enrichEnterpriseIds(client: SnowflakeClient, rows: RentalRow[]): Promise<void>;
  enrichWithTruckStatus(rows: RentalRow[]): Promise<void>;
  sourceUpdatedAt(): string | null | Promise<string | null>;
  now(): number;
}

type CachedReadModel = {
  data: any;
  cachedAt: number;
};

const rentalOpsCache = new Map<string, CachedReadModel>();

export function getRentalOpsCache(
  key: string,
  now: number = Date.now(),
): CachedReadModel | null {
  const entry = rentalOpsCache.get(key);
  if (!entry) return null;
  if (now - entry.cachedAt > RENTAL_OPS_CACHE_TTL_MS) {
    rentalOpsCache.delete(key);
    return null;
  }
  return entry;
}

export function setRentalOpsCache(
  key: string,
  data: any,
  cachedAt: number = Date.now(),
): void {
  rentalOpsCache.set(key, { data, cachedAt });
}

export function clearRentalOpsCache(): void {
  rentalOpsCache.clear();
}

export function ticketDateFilter(fileDate?: string): string {
  if (fileDate && /^\d{4}-\d{2}-\d{2}$/.test(fileDate)) {
    return `FILE_DATE = '${fileDate}'`;
  }
  return `FILE_DATE = (SELECT MAX(FILE_DATE) FROM ${RENTAL_TICKET_TABLE})`;
}

export function openDateFilter(fileDate?: string): string {
  if (fileDate && /^\d{4}-\d{2}-\d{2}$/.test(fileDate)) {
    return `FILE_DATE = '${fileDate}'`;
  }
  return `FILE_DATE = (SELECT MAX(FILE_DATE) FROM ${RENTAL_OPEN_TABLE})`;
}

export function parseRentalDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = String(value).trim();
  if (!normalized || normalized === "null") return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(normalized)) return normalized.slice(0, 10);
  const monthDayYear = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (monthDayYear) {
    return `${monthDayYear[3]}-${monthDayYear[1].padStart(2, "0")}-${monthDayYear[2].padStart(2, "0")}`;
  }
  if (/^\d{7}$/.test(normalized)) {
    return `${normalized.slice(3)}-${normalized[0].padStart(2, "0")}-${normalized.slice(1, 3)}`;
  }
  if (/^\d{8}$/.test(normalized)) {
    return `${normalized.slice(4)}-${normalized.slice(0, 2)}-${normalized.slice(2, 4)}`;
  }
  return normalized.slice(0, 10);
}

export function calcDaysOpen(startDate: string | null, now: number = Date.now()): number {
  if (!startDate) return 0;
  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) return 0;
  return Math.floor((now - start.getTime()) / 86_400_000);
}

export function mapDivision(division: string | null | undefined): string {
  return (division || "").trim();
}

export function parseClaimNumber(claimNumber: string): { holmanPo: string } {
  const clean = (claimNumber || "").trim();
  const hyphenIndex = clean.lastIndexOf("-");
  if (hyphenIndex < 0) return { holmanPo: clean.replace(/\s+/g, "") };
  return { holmanPo: clean.slice(0, hyphenIndex).replace(/\s+/g, "") };
}

export function entOriginalStart(row: RentalRow): string | null {
  return parseRentalDate(row.ORIGINAL_START_DATE) || parseRentalDate(row.RENTAL_START_DATE);
}

export function rentalNameParse(fullName: string): { first: string; last: string } {
  if (!fullName) return { first: "", last: "" };
  const normalized = fullName.trim().toUpperCase();
  const suffixes = new Set(["JR", "SR", "II", "III", "IV", "V", "JR.", "SR."]);
  const commaIndex = normalized.indexOf(",");
  if (commaIndex > 0) {
    const last = normalized.slice(0, commaIndex).trim();
    const firstTokens = normalized.slice(commaIndex + 1).trim().split(/\s+/).filter(Boolean);
    while (firstTokens.length > 1 && suffixes.has(firstTokens[firstTokens.length - 1])) firstTokens.pop();
    return { first: firstTokens[0] || "", last };
  }
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (!tokens.length) return { first: "", last: "" };
  if (tokens.length === 1) return { first: "", last: tokens[0] };
  let endIndex = tokens.length - 1;
  while (endIndex > 0 && suffixes.has(tokens[endIndex])) endIndex--;
  return { first: tokens[0], last: tokens[endIndex] };
}

export async function rentalEnrichEnterpriseIds(
  _client: SnowflakeClient,
  rows: RentalRow[],
): Promise<void> {
  const toEnrich = rows.filter((row) => row.source === "enterprise" && !row.enterpriseId);
  if (!toEnrich.length) return;
  try {
    const { ensureSnapshotLoaded, getSnapshot } = await import("../fleet-scope-tpms-snapshot");
    await ensureSnapshotLoaded();
    const snapshot = getSnapshot();

    const lastNameMap = new Map<string, Array<{ enterpriseId: string; firstName: string }>>();
    const seenIdByLast = new Map<string, Set<string>>();
    const addCandidate = (
      enterpriseId: string | null | undefined,
      last: string,
      first: string,
    ) => {
      const id = (enterpriseId || "").trim();
      if (!id || !last) return;
      let seen = seenIdByLast.get(last);
      if (!seen) {
        seen = new Set<string>();
        seenIdByLast.set(last, seen);
      }
      const key = id.toUpperCase();
      if (seen.has(key)) return;
      seen.add(key);
      if (!lastNameMap.has(last)) lastNameMap.set(last, []);
      lastNameMap.get(last)!.push({ enterpriseId: id, firstName: first });
    };

    for (const entry of snapshot.values()) {
      if (!entry.fullName) continue;
      const { first, last } = rentalNameParse(String(entry.fullName));
      if (last) addCandidate(entry.enterpriseId, last, first);
    }

    try {
      const [{ db }, { tpmsTechProfiles }] = await Promise.all([
        import("../db"),
        import("@shared/schema"),
      ]);
      const profileRows = await db
        .select({
          enterpriseId: tpmsTechProfiles.enterpriseId,
          firstName: tpmsTechProfiles.firstName,
          lastName: tpmsTechProfiles.lastName,
        })
        .from(tpmsTechProfiles)
        .where(isNotNull(tpmsTechProfiles.enterpriseId));
      for (const profile of profileRows) {
        if (!profile.enterpriseId || !profile.lastName) continue;
        const last = rentalNameParse(String(profile.lastName)).last;
        const first = profile.firstName
          ? rentalNameParse(`${profile.firstName} ${profile.lastName}`).first
          : "";
        if (last) addCandidate(profile.enterpriseId, last, first);
      }
    } catch (error: any) {
      console.warn("[RentalOps] tpms_tech_profiles enrichment fallback skipped:", error.message);
    }

    for (const row of toEnrich) {
      const { first, last } = rentalNameParse(row.renterName || "");
      if (!last) {
        row.enterpriseIdSource = "not_found";
        continue;
      }
      const candidates = lastNameMap.get(last) || [];
      if (candidates.length === 0) {
        row.enterpriseIdSource = "not_found";
      } else if (candidates.length === 1) {
        row.enterpriseId = candidates[0].enterpriseId;
        row.enterpriseIdSource = "name_last_unique";
      } else if (first) {
        const exact = candidates.filter((candidate) => candidate.firstName === first);
        if (exact.length === 1) {
          row.enterpriseId = exact[0].enterpriseId;
          row.enterpriseIdSource = "name_full_unique";
        } else {
          row.enterpriseIdSource = "name_ambiguous";
        }
      } else {
        row.enterpriseIdSource = "name_ambiguous";
      }
    }
  } catch (error: any) {
    console.warn("[RentalOps] TPMS name enrichment skipped:", error.message);
  }
}

export async function getOosVehicleSet(): Promise<Set<string>> {
  try {
    const [{ db }, { holmanVehiclesCache }] = await Promise.all([
      import("../db"),
      import("@shared/schema"),
    ]);
    const rows = await db
      .select({ num: holmanVehiclesCache.holmanVehicleNumber })
      .from(holmanVehiclesCache)
      .where(
        or(
          eq(holmanVehiclesCache.statusCode, 2),
          isNotNull(holmanVehiclesCache.outOfServiceDate),
        ),
      );
    return new Set(rows.map((row) => toDisplayNumber(row.num)));
  } catch {
    return new Set();
  }
}

export async function enrichWithTruckStatus(rows: RentalRow[]): Promise<void> {
  const [{ fsDb }, { trucks }] = await Promise.all([
    import("../fleet-scope-db"),
    import("@shared/fleet-scope-schema"),
  ]);
  const vehicleNumbers = Array.from(new Set(
    rows.map((row) => String(row.vehicleNumberPadded || "").trim()).filter(Boolean),
  ));
  const statusByVehicle = new Map<string, { mainStatus: string | null; subStatus: string | null }>();
  if (vehicleNumbers.length > 0) {
    const truckRows = await fsDb
      .select({
        truckNumber: trucks.truckNumber,
        mainStatus: trucks.mainStatus,
        subStatus: trucks.subStatus,
      })
      .from(trucks)
      .where(inArray(trucks.truckNumber, vehicleNumbers));
    for (const truck of truckRows) {
      statusByVehicle.set(truck.truckNumber, {
        mainStatus: truck.mainStatus ?? null,
        subStatus: truck.subStatus ?? null,
      });
    }
  }
  for (const row of rows) {
    const status = statusByVehicle.get(String(row.vehicleNumberPadded || "").trim());
    row.mainStatus = status ? status.mainStatus : null;
    row.subStatus = status ? status.subStatus : null;
  }
}

export function createOpenRentalsReadModelBuilder(
  dependencies: OpenRentalsReadModelDependencies,
): (input: OpenRentalsInput) => Promise<OpenRentalsReadModel> {
  return async (input) => {
    if (!(await dependencies.isSnowflakeConfigured())) {
      throw new OpenRentalsSourceUnavailableError(
        new Error("Snowflake not configured"),
        "not_configured",
      );
    }

    let client: SnowflakeClient;
    try {
      client = await dependencies.getSnowflakeService();
      await client.connect();
    } catch (error) {
      throw new OpenRentalsSourceUnavailableError(error);
    }

    const showRaw = input.view === "raw";
    const cacheKey = `open:${input.fileDate || "latest"}:${showRaw}:${input.includeOos}`;
    const cached = getRentalOpsCache(cacheKey, dependencies.now());
    if (cached) {
      console.log(`[RentalOps] Cache hit: ${cacheKey}`);
      return { ...cached.data, _cachedAt: cached.cachedAt } as OpenRentalsReadModel;
    }

    const executeSourceQuery = async (query: string): Promise<any[]> => {
      try {
        return await client.executeQuery(query);
      } catch (error) {
        throw new OpenRentalsSourceUnavailableError(error);
      }
    };
    const normalizeVehicle = (value: string) => value ? toDisplayNumber(value) : "";
    const now = dependencies.now();

    let model: OpenRentalsReadModel;
    if (showRaw) {
      const rows = await executeSourceQuery(
        `SELECT * FROM ${RENTAL_OPEN_TABLE} WHERE ${openDateFilter(input.fileDate)} LIMIT ${RENTAL_SOURCE_ROW_LIMIT}`,
      );
      const ticketRows = await client
        .executeQuery(
          `SELECT DISTINCT LPAD(VEHICLE_NUMBER, 5, '0') as VN FROM ${RENTAL_TICKET_TABLE} WHERE ${ticketDateFilter(input.fileDate)}`,
        )
        .catch(() => []);
      const enterpriseVehicles = new Set<string>(
        ticketRows.map((row) => String(row.VN || "").trim()),
      );
      const byVehicle = new Map<string, RentalRow[]>();
      for (const row of rows) {
        const vehicleNumber = normalizeVehicle(row.VEHICLE_NUMBER || "");
        if (!vehicleNumber) continue;
        if (!byVehicle.has(vehicleNumber)) byVehicle.set(vehicleNumber, []);
        byVehicle.get(vehicleNumber)!.push(row);
      }
      const data = rows
        .filter((row) => row.VEHICLE_NUMBER)
        .map((row) => {
          const vehicleNumber = normalizeVehicle(row.VEHICLE_NUMBER || "");
          const group = byVehicle.get(vehicleNumber) || [];
          const startDate = parseRentalDate(row.PO_DATE || row.RENTAL_START_DATE);
          return {
            vehicleNumber: row.VEHICLE_NUMBER,
            vehicleNumberPadded: vehicleNumber,
            division: mapDivision(row.DIVISION),
            renterName: `${row.FIRST_NAME || ""} ${row.LAST_NAME || ""}`.trim(),
            enterpriseId: row.ENTERPRISE_ID || null,
            district: row.DISTRICT || null,
            poNumber: (row.PO_NUMBER || "").replace(/^'/, "").trim(),
            poDate: parseRentalDate(row.PO_DATE),
            rentalStartDate: startDate,
            rentalVendor: row.RENTAL_VENDOR || null,
            daysOpen: calcDaysOpen(startDate, now),
            poCount: group.length,
            hasEnterpriseTicket: enterpriseVehicles.has(vehicleNumber),
            source: "holman_raw",
          };
        });
      await dependencies.enrichWithTruckStatus(data);
      const warnings: ApiWarning[] = [];
      if (rows.length === RENTAL_SOURCE_ROW_LIMIT) {
        warnings.push({
          code: "PARTIAL_DATA",
          message: `Holman open rental rows were truncated at ${RENTAL_SOURCE_ROW_LIMIT}; results may be incomplete`,
        });
      }
      model = {
        data,
        total: data.length,
        totalPOLines: rows.length,
        view: "raw",
        sourceUpdatedAt: await dependencies.sourceUpdatedAt(),
        warnings,
      };
    } else {
      let ticketRows: RentalRow[];
      let holmanRows: RentalRow[];
      try {
        [ticketRows, holmanRows] = await Promise.all([
          client.executeQuery(
            `SELECT * FROM ${RENTAL_TICKET_TABLE} WHERE ${ticketDateFilter(input.fileDate)} AND TICKET_STATUS='OPEN' LIMIT ${RENTAL_SOURCE_ROW_LIMIT}`,
          ),
          client.executeQuery(
            `SELECT * FROM ${RENTAL_OPEN_TABLE} WHERE ${openDateFilter(input.fileDate)} LIMIT ${RENTAL_SOURCE_ROW_LIMIT}`,
          ),
        ]);
      } catch (error) {
        throw new OpenRentalsSourceUnavailableError(error);
      }

      const allEnterpriseVehicles = new Set<string>();
      for (const row of ticketRows) {
        const vehicleNumber = normalizeVehicle(row.VEHICLE_NUMBER || "");
        if (vehicleNumber) allEnterpriseVehicles.add(vehicleNumber);
      }

      const enterpriseByVehicle = new Map<string, RentalRow>();
      for (const row of ticketRows) {
        const vehicleNumber = normalizeVehicle(row.VEHICLE_NUMBER || "");
        if (!vehicleNumber) continue;
        const existing = enterpriseByVehicle.get(vehicleNumber);
        const rowDate = new Date(row.RENTAL_START_DATE || "2000-01-01").getTime();
        const existingDate = existing
          ? new Date(existing.RENTAL_START_DATE || "2000-01-01").getTime()
          : 0;
        if (!existing || rowDate > existingDate) enterpriseByVehicle.set(vehicleNumber, row);
      }

      const enterpriseSegment = Array.from(enterpriseByVehicle.entries()).map(([vehicleNumber, row]) => {
        const originalStartDate = entOriginalStart(row);
        const currentTicketStart = parseRentalDate(row.RENTAL_START_DATE);
        const { holmanPo } = parseClaimNumber(row.CLAIM_NUMBER || "");
        return {
          vehicleNumber: row.VEHICLE_NUMBER,
          vehicleNumberPadded: vehicleNumber,
          division: null,
          renterName: (row.RENTER_NAME || "").trim(),
          enterpriseId: null,
          district: null,
          ticketNumber: row.ECARS_2_0_TKT_NBR || null,
          poNumber: holmanPo || null,
          claimNumber: (row.CLAIM_NUMBER || "").trim(),
          poDate: originalStartDate,
          rentalStartDate: currentTicketStart,
          originalStartDate,
          isRewrite: !!(row.ORIGINAL_START_DATE && parseRentalDate(row.ORIGINAL_START_DATE)),
          rentalVendor: "Enterprise Rent-A-Car",
          ticketStatus: row.TICKET_STATUS,
          daysOpen: calcDaysOpen(originalStartDate, now),
          daysAuthorized: row.DAYS_AUTHORIZED ? Number.parseInt(String(row.DAYS_AUTHORIZED)) : null,
          initialDaysAuthorized: row.INITIAL_DAYS_AUTHORIZED
            ? Number.parseInt(String(row.INITIAL_DAYS_AUTHORIZED))
            : null,
          numberOfExtensions: row.NUMBER_OF_EXTENSIONS
            ? Number.parseInt(String(row.NUMBER_OF_EXTENSIONS))
            : 0,
          daysBehind: row.DAYS_BEHIND ? Number.parseInt(String(row.DAYS_BEHIND)) : 0,
          numberOfRewrites: row.NUMBER_OF_REWRITES
            ? Number.parseInt(String(row.NUMBER_OF_REWRITES))
            : 0,
          repairsComplete: row.REPAIRS_COMPLETE || null,
          claimsOffice: row.CLAIMS_OFFICE_NAME || null,
          poCount: 1,
          hasEnterpriseTicket: true,
          source: "enterprise",
          enterpriseIdSource: null as string | null,
        };
      });

      const isEnterpriseVendor = (vendor: string | null) =>
        !vendor || /enterprise/i.test(vendor) || /toll/i.test(vendor);
      const holmanByVehicle = new Map<string, RentalRow[]>();
      for (const row of holmanRows) {
        const vehicleNumber = normalizeVehicle(row.VEHICLE_NUMBER || "");
        if (!vehicleNumber) continue;
        if (isEnterpriseVendor(row.RENTAL_VENDOR)) continue;
        if (allEnterpriseVehicles.has(vehicleNumber)) continue;
        if (!holmanByVehicle.has(vehicleNumber)) holmanByVehicle.set(vehicleNumber, []);
        holmanByVehicle.get(vehicleNumber)!.push(row);
      }

      const holmanSegment = Array.from(holmanByVehicle.entries()).map(([vehicleNumber, group]) => {
        const sorted = group.sort(
          (left, right) =>
            new Date(right.PO_DATE || "2000-01-01").getTime()
            - new Date(left.PO_DATE || "2000-01-01").getTime(),
        );
        const row = sorted[0];
        const startDate = parseRentalDate(row.PO_DATE || row.RENTAL_START_DATE);
        return {
          vehicleNumber: row.VEHICLE_NUMBER,
          vehicleNumberPadded: vehicleNumber,
          division: mapDivision(row.DIVISION),
          renterName: `${row.FIRST_NAME || ""} ${row.LAST_NAME || ""}`.trim(),
          enterpriseId: row.ENTERPRISE_ID || null,
          district: row.DISTRICT || null,
          poNumber: (row.PO_NUMBER || "").replace(/^'/, "").trim(),
          poDate: startDate,
          rentalStartDate: startDate,
          rentalVendor: row.RENTAL_VENDOR || null,
          daysOpen: calcDaysOpen(startDate, now),
          poCount: group.length,
          hasEnterpriseTicket: false,
          source: "holman_non_enterprise",
          enterpriseIdSource: (row.ENTERPRISE_ID ? "direct" : null) as string | null,
        };
      });

      let allData = [...enterpriseSegment, ...holmanSegment];
      await dependencies.enrichEnterpriseIds(client, allData);

      let oosFilteredCount = 0;
      if (!input.includeOos) {
        const oosVehicles = await dependencies.getOosVehicleSet();
        if (oosVehicles.size > 0) {
          const before = allData.length;
          allData = allData.filter(
            (row) => !oosVehicles.has(toDisplayNumber(row.vehicleNumberPadded || row.vehicleNumber || "")),
          );
          oosFilteredCount = before - allData.length;
        }
      }
      await dependencies.enrichWithTruckStatus(allData);
      const warnings: ApiWarning[] = [];
      if (
        ticketRows.length === RENTAL_SOURCE_ROW_LIMIT
        || holmanRows.length === RENTAL_SOURCE_ROW_LIMIT
      ) {
        warnings.push({
          code: "PARTIAL_DATA",
          message: `Open rental source rows were truncated at ${RENTAL_SOURCE_ROW_LIMIT}; results may be incomplete`,
        });
      }
      model = {
        data: allData,
        total: allData.length,
        enterpriseCount: enterpriseSegment.length,
        holmanNonEnterpriseCount: holmanSegment.length,
        totalHolmanPOLines: holmanRows.length,
        oosFilteredCount,
        view: "business_logic",
        sourceUpdatedAt: await dependencies.sourceUpdatedAt(),
        warnings,
      };
    }

    setRentalOpsCache(cacheKey, model, dependencies.now());
    return model;
  };
}

export function toLegacyOpenRentalsResponse(
  model: OpenRentalsReadModel & { _cachedAt?: number },
): Omit<OpenRentalsReadModel, "sourceUpdatedAt" | "warnings"> & { _cachedAt?: number } {
  const { sourceUpdatedAt: _sourceUpdatedAt, warnings: _warnings, ...legacyResult } = model;
  return legacyResult;
}

const defaultDependencies: OpenRentalsReadModelDependencies = {
  isSnowflakeConfigured: async () => {
    const { isSnowflakeConfigured } = await import("../snowflake-service");
    return isSnowflakeConfigured();
  },
  getSnowflakeService: async () => {
    const { getSnowflakeService } = await import("../snowflake-service");
    return getSnowflakeService();
  },
  getOosVehicleSet,
  enrichEnterpriseIds: rentalEnrichEnterpriseIds,
  enrichWithTruckStatus,
  sourceUpdatedAt: () => null,
  now: () => Date.now(),
};

export const buildOpenRentalsReadModel = createOpenRentalsReadModelBuilder(defaultDependencies);
