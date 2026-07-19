/**
 * VRM Rental Operations V2 — ingest (clean-room copy of the open-rentals
 * read-model query + dedup, with VRM differences):
 *   - INCLUDES PENDED (its own state) — the FleetScope read-model is OPEN-only.
 *   - SKIPS enrichEnterpriseIds (TPMS name-match) — VRM does its own identity
 *     resolution against the roster (identity-resolver.ts).
 *   - SKIPS enrichWithTruckStatus (fs_trucks join) — VRM never reads FleetScope.
 *   - Carries the vehicle economics fields (year/make/model, authorized class,
 *     authorized rate, renting city/state) so the grid can classify
 *     sedan-vs-van and flag class/rate mismatches from the LIVE feed.
 *
 * Writes ONLY vrm_rental_operations_* tables. Reads Snowflake + all_techs +
 * onboarding_hires. Nothing here touches fs_trucks or FleetScope.
 *
 * The small date/claim parsers are COPIED (not imported) from the read-model to
 * keep VRM independent of the FleetScope module (Tyler: "copy that function and
 * build another path"). persistRentalCases is the shared land path used by both
 * the scheduled Snowflake sync and the manual Enterprise-report import.
 */
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { getSnowflakeService, isSnowflakeConfigured } from "../../snowflake-service";
import { toDisplayNumber } from "../../vehicle-number-utils";
import {
  buildRosterIndex, resolveIdentity,
  type RosterRow, type OnboardingRow, type IdentityResolution,
} from "./identity-resolver";
import { landPoHistory } from "./po-history";
import { enrichCasesWithAms } from "./ams-enrich";

const ENT_TABLE = "PARTS_SUPPLYCHAIN.FLEET.ENTERPRISE_OPEN_RENTAL_TICKET_REPORT";
const HOL_TABLE = "PARTS_SUPPLYCHAIN.FLEET.HOLMAN_OPEN_RENTAL_REPORT";
const ROW_LIMIT = 5000;

// ── copied pure parsers (kept in-module for clean-room independence) ─────────
function parseRentalDate(value: unknown): string | null {
  if (!value) return null;
  const s = String(value).trim();
  if (!s || s === "null") return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  return s.slice(0, 10);
}
function calcDaysOpen(startDate: string | null, now: number): number {
  if (!startDate) return 0;
  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) return 0;
  return Math.floor((now - start.getTime()) / 86_400_000);
}
function entOriginalStart(row: Record<string, any>): string | null {
  return parseRentalDate(row.ORIGINAL_START_DATE) || parseRentalDate(row.RENTAL_START_DATE);
}
function parseClaimNumber(claimNumber: string): string {
  const clean = (claimNumber || "").trim();
  const i = clean.lastIndexOf("-");
  return i < 0 ? clean.replace(/\s+/g, "") : clean.slice(0, i).replace(/\s+/g, "");
}
function mapDivision(division: unknown): string {
  return (String(division ?? "")).trim();
}
function intOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number.parseInt(String(v), 10);
  return Number.isNaN(n) ? null : n;
}
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number.parseFloat(String(v));
  return Number.isNaN(n) ? null : n;
}
function emptyToNull(v: unknown): string | null {
  const s = v === null || v === undefined ? "" : String(v);
  return s.trim() ? s.trim() : null;
}

export interface RentalCase {
  case_key: string;
  vehicle_number: string;
  vehicle_number_padded: string;
  source: "enterprise" | "holman_non_enterprise";
  rental_vendor: string | null;
  renter_name_raw: string;
  ticket_number: string | null;
  po_number: string | null;
  claim_number: string | null;
  ticket_status: string | null;
  is_rewrite: boolean;
  rental_start_date: string | null;
  original_start_date: string | null;
  po_date: string | null;
  days_open: number;
  days_authorized: number | null;
  initial_days_authorized: number | null;
  number_of_extensions: number | null;
  days_behind: number | null;
  number_of_rewrites: number | null;
  repairs_complete: string | null;
  claims_office: string | null;
  district: string | null;
  division: string | null;
  enterprise_id_feed: string | null;
  veh_desc: string | null;
  rental_class: string | null;
  rate_authorized: number | null;
  renting_city: string | null;
  renting_state: string | null;
  feed: Record<string, any>;
}

export interface IngestOptions {
  runType?: "scheduled_sync";
  fileDate?: string; // YYYY-MM-DD to pin a specific feed date (else MAX)
  amsMode?: "full" | "cached" | "skip"; // full = build AMS map (~2min); cached = request-path fast; skip
  landPo?: boolean; // default true
}

export interface IngestResult {
  runId: string;
  fileDate: string | null;
  enterpriseCount: number;
  holmanCount: number;
  pendedCount: number;
  totalCases: number;
  resolved: number;
  review: number;
  exception: number;
  dropped: number;
  poLanded?: number;
  openRepairTrucks?: number;
  amsWithStatus?: number;
  skipped?: boolean;
  skipReason?: string;
}

function dateFilter(table: string, fileDate?: string): string {
  if (fileDate && /^\d{4}-\d{2}-\d{2}$/.test(fileDate)) return `FILE_DATE = '${fileDate}'`;
  return `FILE_DATE = (SELECT MAX(FILE_DATE) FROM ${table})`;
}

/** Copy of the read-model's business_logic dedup, PENDED-inclusive, no fs_trucks/TPMS enrichment. */
export function buildCases(ticketRows: Record<string, any>[], holmanRows: Record<string, any>[], now: number): {
  cases: RentalCase[]; enterpriseCount: number; holmanCount: number; pendedCount: number;
} {
  const norm = (v: unknown) => (v ? toDisplayNumber(String(v)) : "");

  // enterprise: keep latest RENTAL_START_DATE per vehicle
  const allEntVehicles = new Set<string>();
  const entByVehicle = new Map<string, Record<string, any>>();
  for (const row of ticketRows) {
    const vn = norm(row.VEHICLE_NUMBER);
    if (!vn) continue;
    allEntVehicles.add(vn);
    const existing = entByVehicle.get(vn);
    const rowDate = new Date(row.RENTAL_START_DATE || "2000-01-01").getTime();
    const exDate = existing ? new Date(existing.RENTAL_START_DATE || "2000-01-01").getTime() : 0;
    if (!existing || rowDate > exDate) entByVehicle.set(vn, row);
  }

  let pendedCount = 0;
  const enterpriseSegment: RentalCase[] = Array.from(entByVehicle.entries()).map(([vn, row]) => {
    const originalStart = entOriginalStart(row);
    const currentStart = parseRentalDate(row.RENTAL_START_DATE);
    const holmanPo = parseClaimNumber(row.CLAIM_NUMBER || "");
    const status = emptyToNull(row.TICKET_STATUS);
    if (status === "PENDED") pendedCount++;
    const year = emptyToNull(row.RENTED_VEH_YEAR);
    const make = emptyToNull(row.RENTED_VEH_MAKE);
    const model = emptyToNull(row.RENTED_VEH_MODEL);
    const vehDesc = [year, make, model].filter(Boolean).join(" ") || null;
    return {
      case_key: vn,
      vehicle_number: String(row.VEHICLE_NUMBER ?? ""),
      vehicle_number_padded: vn,
      source: "enterprise",
      rental_vendor: "Enterprise Rent-A-Car",
      renter_name_raw: String(row.RENTER_NAME ?? "").trim(),
      ticket_number: emptyToNull(row.ECARS_2_0_TKT_NBR),
      po_number: holmanPo || null,
      claim_number: emptyToNull(row.CLAIM_NUMBER),
      ticket_status: status,
      is_rewrite: !!(row.ORIGINAL_START_DATE && parseRentalDate(row.ORIGINAL_START_DATE)),
      rental_start_date: currentStart,
      original_start_date: originalStart,
      po_date: originalStart,
      days_open: calcDaysOpen(originalStart, now),
      days_authorized: intOrNull(row.DAYS_AUTHORIZED),
      initial_days_authorized: intOrNull(row.INITIAL_DAYS_AUTHORIZED),
      number_of_extensions: intOrNull(row.NUMBER_OF_EXTENSIONS) ?? 0,
      days_behind: intOrNull(row.DAYS_BEHIND) ?? 0,
      number_of_rewrites: intOrNull(row.NUMBER_OF_REWRITES) ?? 0,
      repairs_complete: emptyToNull(row.REPAIRS_COMPLETE),
      claims_office: emptyToNull(row.CLAIMS_OFFICE_NAME),
      district: null,
      division: null,
      enterprise_id_feed: null,
      veh_desc: vehDesc,
      rental_class: emptyToNull(row.CAR_CLASS_AUTHORIZED_DESCRIPTION),
      rate_authorized: numOrNull(row.RATE_AUTHORIZED),
      renting_city: emptyToNull(row.RENTING_CITY_NAME),
      renting_state: emptyToNull(row.RENTING_STATE),
      feed: row,
    };
  });

  // holman non-enterprise: skip enterprise-vendor + vehicles already in ent set
  const isEntVendor = (vendor: unknown) => {
    const v = vendor ? String(vendor) : "";
    return !v || /enterprise/i.test(v) || /toll/i.test(v);
  };
  const holByVehicle = new Map<string, Record<string, any>[]>();
  for (const row of holmanRows) {
    const vn = norm(row.VEHICLE_NUMBER);
    if (!vn) continue;
    if (isEntVendor(row.RENTAL_VENDOR)) continue;
    if (allEntVehicles.has(vn)) continue;
    if (!holByVehicle.has(vn)) holByVehicle.set(vn, []);
    holByVehicle.get(vn)!.push(row);
  }
  const holmanSegment: RentalCase[] = Array.from(holByVehicle.entries()).map(([vn, group]) => {
    const sorted = group.sort((a, b) =>
      new Date(b.PO_DATE || "2000-01-01").getTime() - new Date(a.PO_DATE || "2000-01-01").getTime());
    const row = sorted[0];
    const startDate = parseRentalDate(row.PO_DATE || row.RENTAL_START_DATE);
    return {
      case_key: vn,
      vehicle_number: String(row.VEHICLE_NUMBER ?? ""),
      vehicle_number_padded: vn,
      source: "holman_non_enterprise",
      rental_vendor: emptyToNull(row.RENTAL_VENDOR),
      renter_name_raw: `${row.FIRST_NAME || ""} ${row.LAST_NAME || ""}`.trim(),
      ticket_number: null,
      po_number: emptyToNull(String(row.PO_NUMBER ?? "").replace(/^'/, "")),
      claim_number: null,
      ticket_status: "OPEN",
      is_rewrite: false,
      rental_start_date: startDate,
      original_start_date: null,
      po_date: startDate,
      days_open: calcDaysOpen(startDate, now),
      days_authorized: intOrNull(row.NO_OF_DAYS),
      initial_days_authorized: null,
      number_of_extensions: null,
      days_behind: null,
      number_of_rewrites: null,
      repairs_complete: null,
      claims_office: null,
      district: emptyToNull(row.DISTRICT),
      division: mapDivision(row.DIVISION) || null,
      enterprise_id_feed: emptyToNull(row.ENTERPRISE_ID),
      veh_desc: null,
      rental_class: null,
      rate_authorized: numOrNull(row.DAILY_RATE),
      renting_city: emptyToNull(row.CITY),
      renting_state: emptyToNull(row.STATE),
      feed: row,
    };
  });

  return {
    cases: [...enterpriseSegment, ...holmanSegment],
    enterpriseCount: enterpriseSegment.length,
    holmanCount: holmanSegment.length,
    pendedCount,
  };
}

export async function loadRoster(): Promise<RosterRow[]> {
  const res = await db.execute(sql`
    SELECT employee_id, tech_name, employment_status,
           to_char(effective_date,'YYYY-MM-DD') AS effective_date,
           to_char(last_day_worked,'YYYY-MM-DD') AS last_day_worked,
           district_no
    FROM all_techs
  `);
  return res.rows as unknown as RosterRow[];
}
export async function loadOnboarding(): Promise<OnboardingRow[]> {
  const res = await db.execute(sql`
    SELECT employee_name, enterprise_id, to_char(service_date,'YYYY-MM-DD') AS service_date
    FROM onboarding_hires
  `);
  return res.rows as unknown as OnboardingRow[];
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ── shared land path (scheduled sync + manual import both use this) ──────────
export interface PersistOptions {
  runType: string;              // scheduled_sync | manual_enterprise_import
  sourceLabel: string;          // provenance label on the run row
  fileDate: string | null;
  cases: RentalCase[];
  sweepSources: string[];       // the case sources this run FULLY covers (scoped sweep)
  healthKey: string;            // source_health clock key (scheduled_sync | manual_enterprise_import)
  fingerprint?: string;
  roster?: RosterRow[];
  onboarding?: OnboardingRow[];
}
export interface PersistResult {
  runId: string;
  resolved: number;
  review: number;
  exception: number;
  dropped: number;
  totalCases: number;
  enterpriseCount: number;
  holmanCount: number;
  pendedCount: number;
}

export async function persistRentalCases(o: PersistOptions): Promise<PersistResult> {
  // pool warm-up (cold-process first-write race — see runner note)
  await db.execute(sql`SELECT 1`);

  const runRes = await db.execute(sql`
    INSERT INTO vrm_rental_operations_import_runs (run_type, source_label, status, file_date)
    VALUES (${o.runType}, ${o.sourceLabel}, 'running', ${o.fileDate})
    RETURNING id
  `);
  const runId = (runRes.rows[0] as any).id as string;

  // guard: never sweep on an empty set (a bad parse must not wipe cases)
  if (!o.cases.length) {
    await db.execute(sql`
      UPDATE vrm_rental_operations_import_runs
      SET status='failed', error='no cases — refused to sweep', finished_at=NOW() WHERE id=${runId}
    `);
    await upsertSourceHealth(runId, o.healthKey, "failed", o.fileDate, 0, "no cases");
    return { runId, resolved: 0, review: 0, exception: 0, dropped: 0, totalCases: 0, enterpriseCount: 0, holmanCount: 0, pendedCount: 0 };
  }

  const cases = o.cases;
  const roster = o.roster ?? await loadRoster();
  const onboarding = o.onboarding ?? await loadOnboarding();
  const rosterIndex = buildRosterIndex(roster);
  const resolutions = new Map<string, IdentityResolution>();
  let resolved = 0, review = 0, exception = 0;
  for (const c of cases) {
    const r = resolveIdentity({ renter: c.renter_name_raw, rentalStart: c.rental_start_date, rosterIndex, onboarding });
    resolutions.set(c.case_key, r);
    if (r.state === "RESOLVED") resolved++;
    else if (r.state === "REVIEW") review++;
    else exception++;
  }

  await db.transaction(async (tx) => {
    // raw_rentals: immutable append, chunked
    for (const part of chunk(cases, 100)) {
      const values = part.map((c) => sql`(${runId}, ${c.source}, ${c.vehicle_number}, ${c.vehicle_number_padded}, ${c.renter_name_raw}, ${JSON.stringify(c.feed)}::jsonb)`);
      await tx.execute(sql`
        INSERT INTO vrm_rental_operations_raw_rentals
          (import_run_id, source, vehicle_number, vehicle_number_padded, renter_name, feed_json)
        VALUES ${sql.join(values, sql`, `)}
      `);
    }

    // cases upsert + identity upsert
    for (const c of cases) {
      const caseRes = await tx.execute(sql`
        INSERT INTO vrm_rental_operations_cases (
          case_key, vehicle_number, vehicle_number_padded, source, rental_vendor, renter_name_raw,
          ticket_number, po_number, claim_number, ticket_status, is_rewrite,
          rental_start_date, original_start_date, po_date, days_open, days_authorized,
          initial_days_authorized, number_of_extensions, days_behind, number_of_rewrites,
          repairs_complete, claims_office, district, division, enterprise_id_feed,
          veh_desc, rental_class, rate_authorized, renting_city, renting_state,
          last_import_run_id, present_in_latest, last_seen_at, feed_json
        ) VALUES (
          ${c.case_key}, ${c.vehicle_number}, ${c.vehicle_number_padded}, ${c.source}, ${c.rental_vendor}, ${c.renter_name_raw},
          ${c.ticket_number}, ${c.po_number}, ${c.claim_number}, ${c.ticket_status}, ${c.is_rewrite},
          ${c.rental_start_date}, ${c.original_start_date}, ${c.po_date}, ${c.days_open}, ${c.days_authorized},
          ${c.initial_days_authorized}, ${c.number_of_extensions}, ${c.days_behind}, ${c.number_of_rewrites},
          ${c.repairs_complete}, ${c.claims_office}, ${c.district}, ${c.division}, ${c.enterprise_id_feed},
          ${c.veh_desc}, ${c.rental_class}, ${c.rate_authorized}, ${c.renting_city}, ${c.renting_state},
          ${runId}, true, NOW(), ${JSON.stringify(c.feed)}::jsonb
        )
        ON CONFLICT (case_key) DO UPDATE SET
          vehicle_number=EXCLUDED.vehicle_number, vehicle_number_padded=EXCLUDED.vehicle_number_padded,
          source=EXCLUDED.source, rental_vendor=EXCLUDED.rental_vendor, renter_name_raw=EXCLUDED.renter_name_raw,
          ticket_number=EXCLUDED.ticket_number, po_number=EXCLUDED.po_number, claim_number=EXCLUDED.claim_number,
          ticket_status=EXCLUDED.ticket_status, is_rewrite=EXCLUDED.is_rewrite,
          rental_start_date=EXCLUDED.rental_start_date, original_start_date=EXCLUDED.original_start_date,
          po_date=EXCLUDED.po_date, days_open=EXCLUDED.days_open, days_authorized=EXCLUDED.days_authorized,
          initial_days_authorized=EXCLUDED.initial_days_authorized, number_of_extensions=EXCLUDED.number_of_extensions,
          days_behind=EXCLUDED.days_behind, number_of_rewrites=EXCLUDED.number_of_rewrites,
          repairs_complete=EXCLUDED.repairs_complete, claims_office=EXCLUDED.claims_office,
          district=EXCLUDED.district, division=EXCLUDED.division, enterprise_id_feed=EXCLUDED.enterprise_id_feed,
          veh_desc=EXCLUDED.veh_desc, rental_class=EXCLUDED.rental_class, rate_authorized=EXCLUDED.rate_authorized,
          renting_city=EXCLUDED.renting_city, renting_state=EXCLUDED.renting_state,
          last_import_run_id=EXCLUDED.last_import_run_id, present_in_latest=true,
          last_seen_at=NOW(), dropped_from_feed_at=NULL, updated_at=NOW()
        RETURNING id
      `);
      const caseId = (caseRes.rows[0] as any).id as string;
      const r = resolutions.get(c.case_key)!;
      await tx.execute(sql`
        INSERT INTO vrm_rental_identity_resolutions (
          case_key, case_id, renter_name_raw, state, method, confidence,
          resolved_employee_id, resolved_status, resolved_status_date, resolved_tech_name, resolved_district,
          reason, candidates, resolved_at, updated_at
        ) VALUES (
          ${c.case_key}, ${caseId}, ${c.renter_name_raw}, ${r.state}, ${r.method ?? null}, ${r.confidence ?? null},
          ${r.employee_id ?? null}, ${r.status ?? null}, ${emptyToNull(r.status_date)}, ${r.tech_name ?? null}, ${r.district_no ?? null},
          ${r.reason ?? null}, ${JSON.stringify(r.candidates ?? null)}::jsonb, NOW(), NOW()
        )
        ON CONFLICT (case_key) DO UPDATE SET
          case_id=EXCLUDED.case_id, renter_name_raw=EXCLUDED.renter_name_raw, state=EXCLUDED.state,
          method=EXCLUDED.method, confidence=EXCLUDED.confidence,
          resolved_employee_id=EXCLUDED.resolved_employee_id, resolved_status=EXCLUDED.resolved_status,
          resolved_status_date=EXCLUDED.resolved_status_date, resolved_tech_name=EXCLUDED.resolved_tech_name,
          resolved_district=EXCLUDED.resolved_district, reason=EXCLUDED.reason, candidates=EXCLUDED.candidates,
          resolved_at=NOW(), updated_at=NOW()
      `);
    }
  });

  // sweep only the sources this run fully covers: anything of those sources not
  // touched this run has dropped off the feed (returned/closed). A manual
  // enterprise import only covers 'enterprise', so Holman cases are preserved.
  let dropped = 0;
  if (o.sweepSources.length) {
    const sourceList = sql.join(o.sweepSources.map((s) => sql`${s}`), sql`, `);
    const dropRes = await db.execute(sql`
      UPDATE vrm_rental_operations_cases
      SET present_in_latest=false, dropped_from_feed_at=NOW(), updated_at=NOW()
      WHERE present_in_latest=true AND source IN (${sourceList}) AND last_import_run_id IS DISTINCT FROM ${runId}
    `);
    dropped = dropRes.rowCount ?? 0;
  }

  const enterpriseCount = cases.filter((c) => c.source === "enterprise").length;
  const holmanCount = cases.filter((c) => c.source === "holman_non_enterprise").length;
  const pendedCount = cases.filter((c) => c.ticket_status === "PENDED").length;
  const totalCases = cases.length;
  await db.execute(sql`
    UPDATE vrm_rental_operations_import_runs SET
      status='completed', file_date=${o.fileDate},
      enterprise_count=${enterpriseCount}, holman_count=${holmanCount}, pended_count=${pendedCount},
      total_cases=${totalCases}, resolved_count=${resolved}, review_count=${review}, exception_count=${exception},
      source_fingerprint=${o.fingerprint ?? null}, finished_at=NOW()
    WHERE id=${runId}
  `);
  await upsertSourceHealth(runId, o.healthKey, "completed", o.fileDate, totalCases, null);

  return { runId, resolved, review, exception, dropped, totalCases, enterpriseCount, holmanCount, pendedCount };
}

export async function runRentalOpsIngest(opts: IngestOptions = {}): Promise<IngestResult> {
  const runType = opts.runType ?? "scheduled_sync";
  const now = Date.now();

  if (!isSnowflakeConfigured()) throw new Error("Snowflake not configured");
  const svc = getSnowflakeService();
  await svc.connect();

  // Warm up the Postgres pool BEFORE any write. The scheduled deployment runs
  // as a cold process (fresh pg Pool); issuing the first write on a
  // brand-new-connection can race the pool's on-connect setup and silently drop
  // that first statement. A trivial round-trip forces the connection fully up
  // first, so every subsequent write lands. (Observed once on a cold first run.)
  await db.execute(sql`SELECT 1`);

  // resolve the effective file date for provenance
  const entMaxRes = await svc.executeQuery(
    `SELECT TO_CHAR(MAX(FILE_DATE),'YYYY-MM-DD') AS D FROM ${ENT_TABLE}`);
  const fileDate: string | null = opts.fileDate || entMaxRes[0]?.D || null;

  const [ticketRows, holmanRows] = await Promise.all([
    svc.executeQuery(
      `SELECT * FROM ${ENT_TABLE} WHERE ${dateFilter(ENT_TABLE, opts.fileDate)} AND TICKET_STATUS IN ('OPEN','PENDED') LIMIT ${ROW_LIMIT}`),
    svc.executeQuery(
      `SELECT * FROM ${HOL_TABLE} WHERE ${dateFilter(HOL_TABLE, opts.fileDate)} LIMIT ${ROW_LIMIT}`),
  ]);

  // anti-wipe guard: a transient double-empty pull must NOT sweep every case.
  if (ticketRows.length === 0 && holmanRows.length === 0) {
    const runRes = await db.execute(sql`
      INSERT INTO vrm_rental_operations_import_runs (run_type, source_label, status, file_date, error, finished_at)
      VALUES (${runType}, 'snowflake', 'failed', ${fileDate}, 'both Snowflake sources empty — refused to sweep', NOW())
      RETURNING id
    `);
    const runId = (runRes.rows[0] as any).id as string;
    await upsertSourceHealth(runId, "scheduled_sync", "failed", fileDate, 0, "both Snowflake sources empty");
    return { runId, fileDate, enterpriseCount: 0, holmanCount: 0, pendedCount: 0, totalCases: 0,
      resolved: 0, review: 0, exception: 0, dropped: 0, skipped: true, skipReason: "both sources empty" };
  }

  const { cases } = buildCases(ticketRows, holmanRows, now);
  const p = await persistRentalCases({
    runType, sourceLabel: "snowflake", fileDate, cases,
    sweepSources: ["enterprise", "holman_non_enterprise"], healthKey: "scheduled_sync",
    fingerprint: `ent:${ticketRows.length};hol:${holmanRows.length};file:${fileDate}`,
  });
  const runId = p.runId;
  await upsertSourceHealth(runId, "snowflake_enterprise", "completed", fileDate, ticketRows.length, null);
  await upsertSourceHealth(runId, "snowflake_holman", "completed", fileDate, holmanRows.length, null);

  // ── best-effort enrichment (never fails the core sync) ───────────────────
  const caseKeys = cases.map((c) => c.case_key);
  let poLanded: number | undefined, openRepairTrucks: number | undefined, amsWithStatus: number | undefined;
  if (opts.landPo !== false) {
    try {
      const po = await landPoHistory(caseKeys);
      poLanded = po.posLanded; openRepairTrucks = po.openRepairTrucks;
      await upsertSourceHealth(runId, "holman_etl_po", "completed", fileDate, po.posLanded, null);
    } catch (e: any) {
      console.warn("[VRM/RentalOps] PO history land failed (non-fatal):", e?.message || e);
      await upsertSourceHealth(runId, "holman_etl_po", "failed", fileDate, 0, e?.message || "po land failed");
    }
  }
  const amsMode = opts.amsMode ?? "full";
  if (amsMode !== "skip") {
    try {
      const ams = await enrichCasesWithAms({ cachedOnly: amsMode === "cached" });
      amsWithStatus = ams.withStatus;
      await upsertSourceHealth(runId, "ams_status", "completed", fileDate, ams.withStatus, null);
    } catch (e: any) {
      console.warn("[VRM/RentalOps] AMS enrichment failed (non-fatal):", e?.message || e);
      await upsertSourceHealth(runId, "ams_status", "failed", fileDate, 0, e?.message || "ams enrich failed");
    }
  }

  return {
    runId, fileDate,
    enterpriseCount: p.enterpriseCount, holmanCount: p.holmanCount, pendedCount: p.pendedCount,
    totalCases: p.totalCases, resolved: p.resolved, review: p.review, exception: p.exception,
    dropped: p.dropped, poLanded, openRepairTrucks, amsWithStatus,
  };
}

export async function upsertSourceHealth(
  runId: string, sourceKey: string, status: string,
  fileDate: string | null, rowCount: number, failure: string | null,
): Promise<void> {
  const success = status === "completed";
  await db.execute(sql`
    INSERT INTO vrm_rental_source_health
      (source_key, last_run_id, last_status, last_success_at, last_attempt_at, last_file_date, last_row_count, last_failure_reason, updated_at)
    VALUES (${sourceKey}, ${runId}, ${status}, ${success ? sql`NOW()` : sql`NULL`}, NOW(), ${fileDate}, ${rowCount}, ${failure}, NOW())
    ON CONFLICT (source_key) DO UPDATE SET
      last_run_id=EXCLUDED.last_run_id, last_status=EXCLUDED.last_status,
      last_success_at=COALESCE(EXCLUDED.last_success_at, vrm_rental_source_health.last_success_at),
      last_attempt_at=NOW(), last_file_date=EXCLUDED.last_file_date, last_row_count=EXCLUDED.last_row_count,
      last_failure_reason=EXCLUDED.last_failure_reason, updated_at=NOW()
  `);
}
