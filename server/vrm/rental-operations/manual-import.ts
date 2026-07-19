/**
 * VRM Rental Operations V2 — manual Enterprise-report import.
 *
 * Snowflake lags the emailed "Open Ticket Detail Report Fleet - MasterARI" xlsx
 * by ~1-2 days, so the operator can upload the fresh report to OVERRIDE the
 * scheduled sync. The xlsx headers mirror the Snowflake ENTERPRISE_OPEN_RENTAL_
 * TICKET_REPORT columns, so we map each header to the same UPPER_SNAKE key and
 * reuse buildCases (enterprise segment) + persistRentalCases (enterprise-scoped
 * sweep so Holman cases are untouched) + the manual_enterprise_import clock.
 *
 * Writes ONLY vrm_rental_operations_* tables (via persistRentalCases + PO/AMS).
 */
import { buildCases, persistRentalCases, type IngestResult } from "./ingest";

// normalized-header (lowercased, alphanumeric only) -> Snowflake column key
const HEADER_MAP: Record<string, string> = {
  ecars20tktnbr: "ECARS_2_0_TKT_NBR",
  rentername: "RENTER_NAME",
  claimsofficename: "CLAIMS_OFFICE_NAME",
  claimnumber: "CLAIM_NUMBER",
  rentalstartdate: "RENTAL_START_DATE",
  rentingcity: "RENTING_CITY_NAME",
  rentingcityname: "RENTING_CITY_NAME",
  rentingstate: "RENTING_STATE",
  carclassauthorizeddescription: "CAR_CLASS_AUTHORIZED_DESCRIPTION",
  daysauthorized: "DAYS_AUTHORIZED",
  initialdaysauthorized: "INITIAL_DAYS_AUTHORIZED",
  rateauthorized: "RATE_AUTHORIZED",
  numberofextensions: "NUMBER_OF_EXTENSIONS",
  rentaldays: "RENTAL_DAYS",
  ticketstatus: "TICKET_STATUS",
  vehiclenumber: "VEHICLE_NUMBER",
  daysbehind: "DAYS_BEHIND",
  rentedvehyear: "RENTED_VEH_YEAR",
  rentedvehmake: "RENTED_VEH_MAKE",
  rentedvehmodel: "RENTED_VEH_MODEL",
  numberofrewrites: "NUMBER_OF_REWRITES",
  originalstartdate: "ORIGINAL_START_DATE",
  repairscomplete: "REPAIRS_COMPLETE",
};

function normHeader(h: unknown): string {
  return String(h ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Find the header row (the one with the most cells matching a known header). */
function findHeaderRow(aoa: any[][]): number {
  let bestIdx = 0, best = 0;
  for (let i = 0; i < Math.min(20, aoa.length); i++) {
    const matches = (aoa[i] || []).filter((c) => HEADER_MAP[normHeader(c)]).length;
    if (matches > best) { best = matches; bestIdx = i; }
  }
  return best >= 5 ? bestIdx : -1;
}

/** Parse a MasterARI sheet-of-arrays into Snowflake-shaped enterprise rows. */
export function parseEnterpriseReportAoa(aoa: any[][]): { rows: Record<string, any>[]; headerRow: number; matchedCols: number } {
  const hdrIdx = findHeaderRow(aoa);
  if (hdrIdx < 0) return { rows: [], headerRow: -1, matchedCols: 0 };
  const headers = aoa[hdrIdx];
  const colToKey: Array<string | null> = headers.map((h) => HEADER_MAP[normHeader(h)] || null);
  const matchedCols = colToKey.filter(Boolean).length;
  const rows: Record<string, any>[] = [];
  for (let i = hdrIdx + 1; i < aoa.length; i++) {
    const row = aoa[i];
    if (!row || row.every((c) => String(c ?? "").trim() === "")) continue;
    const obj: Record<string, any> = {};
    for (let c = 0; c < colToKey.length; c++) {
      const key = colToKey[c];
      if (key) obj[key] = row[c];
    }
    // require at least a vehicle number to be a real data row
    if (String(obj.VEHICLE_NUMBER ?? "").trim()) rows.push(obj);
  }
  return { rows, headerRow: hdrIdx, matchedCols };
}

export interface ManualImportResult extends IngestResult {
  matchedCols: number;
  headerRow: number;
  parsedRows: number;
}

/**
 * Import from either a parsed sheet-of-arrays (from XLSX.sheet_to_json header:1)
 * or pre-shaped Snowflake-key rows. Lands via the shared persist path with an
 * enterprise-scoped sweep, then best-effort PO + cached AMS enrichment.
 */
export async function importEnterpriseReport(input: {
  aoa?: any[][];
  entRows?: Record<string, any>[];
  fileDate?: string | null;
  sourceLabel?: string;
}): Promise<ManualImportResult> {
  const now = Date.now();
  let entRows = input.entRows ?? [];
  let matchedCols = entRows.length ? Object.keys(entRows[0]).length : 0;
  let headerRow = -1;
  if (input.aoa) {
    const parsed = parseEnterpriseReportAoa(input.aoa);
    entRows = parsed.rows; matchedCols = parsed.matchedCols; headerRow = parsed.headerRow;
  }
  if (!entRows.length) {
    throw new Error("no enterprise rows parsed from the report (check it is the Open Ticket Detail Report - MasterARI xlsx)");
  }

  const { cases } = buildCases(entRows, [], now);
  const p = await persistRentalCases({
    runType: "manual_enterprise_import",
    sourceLabel: input.sourceLabel ?? "manual_enterprise_xlsx",
    fileDate: input.fileDate ?? null,
    cases,
    sweepSources: ["enterprise"], // only enterprise — Holman cases preserved
    healthKey: "manual_enterprise_import",
    fingerprint: `manual;rows:${entRows.length};cols:${matchedCols};file:${input.fileDate ?? "n/a"}`,
  });

  // best-effort enrichment (cached AMS so the request stays fast)
  const caseKeys = cases.map((c) => c.case_key);
  let poLanded: number | undefined, openRepairTrucks: number | undefined, amsWithStatus: number | undefined;
  try {
    const { landPoHistory } = await import("./po-history");
    const po = await landPoHistory(caseKeys);
    poLanded = po.posLanded; openRepairTrucks = po.openRepairTrucks;
  } catch (e: any) {
    console.warn("[VRM/RentalOps] manual import PO land failed (non-fatal):", e?.message || e);
  }
  try {
    const { enrichCasesWithAms } = await import("./ams-enrich");
    const ams = await enrichCasesWithAms({ cachedOnly: true });
    amsWithStatus = ams.withStatus;
  } catch (e: any) {
    console.warn("[VRM/RentalOps] manual import AMS enrich failed (non-fatal):", e?.message || e);
  }

  return {
    runId: p.runId, fileDate: input.fileDate ?? null,
    enterpriseCount: p.enterpriseCount, holmanCount: p.holmanCount, pendedCount: p.pendedCount,
    totalCases: p.totalCases, resolved: p.resolved, review: p.review, exception: p.exception,
    dropped: p.dropped, poLanded, openRepairTrucks, amsWithStatus,
    matchedCols, headerRow, parsedRows: entRows.length,
  };
}
