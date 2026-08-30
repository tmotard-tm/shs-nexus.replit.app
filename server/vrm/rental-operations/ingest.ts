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
  buildRosterIndex, resolveIdentity, type TruckTech,
  type RosterRow, type OnboardingRow, type IdentityResolution,
} from "./identity-resolver";
import { landPoHistory } from "./po-history";
import { enrichCasesWithAms } from "./ams-enrich";
// The reconciliation SQL, IMPORTED rather than re-typed. measureDataAge below
// used to carry its own copy of Tyler's PO rule and that copy went stale the
// moment the portal delta layer landed (D4, integration gate 7/21) — the same
// failure scrape-service hit with the same fragments. The clean-room note in the
// header above is about the FleetScope read-model, a different module; inside
// rental-operations there is exactly ONE definition of the reconciliation and it
// lives in read-repository.
//
// ingest → read-repository is the safe direction of this edge: read-repository
// imports only db + drizzle + ./workload. The REVERSE edge is the forbidden one
// (this file drags in Snowflake and the whole land pipeline, and the board must
// not), which is why read-repository re-declares SourceHealthVerdict instead of
// importing SourceHealthStatus from here. Do not "tidy" that into an import.
import { PO_EFFECTIVE_CTE } from "./read-repository";

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
  source: "enterprise" | "holman_non_enterprise" | "enterprise_direct";
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
           district_no, home_state
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
  /**
   * File date to JUDGE source health by, when it differs from the file date this
   * run loaded — see the healthFileDate argument on upsertSourceHealth. The
   * scheduled sync passes the feed's live max so a manual backfill cannot stamp
   * a historical verdict over the daily one. A manual Enterprise import leaves
   * it unset, which is correct: the freshness of that clock IS the freshness of
   * the file the operator handed us.
   */
  healthFileDate?: string | null;
  fingerprint?: string;
  roster?: RosterRow[];
  onboarding?: OnboardingRow[];
  /**
   * case_key -> a resolution the caller already established from STRONGER
   * evidence than a renter name (the direct-billing import links rows via
   * reservation confirmations / prior-ticket identity before persisting).
   * When present for a case it replaces the name-based resolveIdentity call;
   * human override columns are untouched either way.
   */
  presetResolutions?: Map<string, IdentityResolution>;
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

/**
 * truck number -> the technician it belongs to.
 *
 * Two independent sources. TPMS is the live assignment feed; all_techs carries
 * the roster's own truck_lu / last_known_truck_lu. When both name the same
 * person the link is as strong as an employee_id, which is why the resolver
 * treats source==="both" as high confidence. When they disagree the entry is
 * marked `conflict` and the resolver refuses to pick.
 *
 * all_techs holds BOTH a terminated and an active row for some racfids, so the
 * DISTINCT ON orders active-first — a plain join silently returns whichever the
 * planner reached last.
 */
export async function loadTruckTechMap(): Promise<Map<string, TruckTech>> {
  const norm = (v: unknown) => {
    const d = String(v ?? "").replace(/[^0-9]/g, "").replace(/^0+/, "");
    return d.length ? d : null;
  };
  const out = new Map<string, TruckTech>();

  // LEFT JOIN, not JOIN. An inner join silently DROPPED every technician TPMS
  // knows but `all_techs` does not — 16 live people on 2026-07-31, including the
  // rehires holding rentals on trucks 46523, 21689 and 46911. Those rows are
  // exactly the ones the truck path exists to rescue, so losing them here made
  // the whole feature a no-op for the hardest cases.
  const tpms = await db.execute(sql`
    SELECT DISTINCT ON (ltrim(regexp_replace(t.truck_no,'[^0-9]','','g'),'0'))
           ltrim(regexp_replace(t.truck_no,'[^0-9]','','g'),'0') AS truck,
           UPPER(TRIM(t.enterprise_id)) AS enterprise_id,
           TRIM(CONCAT_WS(' ', t.first_name, t.last_name)) AS tpms_name,
           t.district_no AS tpms_district,
           t.last_seen_at::text AS last_seen_at,
           a.employee_id, a.tech_name, a.employment_status,
           a.effective_date::text AS effective_date, a.last_day_worked::text AS last_day_worked,
           a.district_no
    FROM tpms_last_known_truck_tech t
    LEFT JOIN all_techs a ON UPPER(TRIM(a.tech_racfid)) = UPPER(TRIM(t.enterprise_id))
    WHERE t.truck_no IS NOT NULL
    ORDER BY 1, (a.employment_status = 'A') DESC, a.effective_date DESC NULLS LAST, a.employee_id
  `);
  for (const r of (tpms.rows ?? []) as any[]) {
    const k = norm(r.truck);
    if (!k) continue;
    if (r.employee_id) {
      out.set(k, {
        employee_id: String(r.employee_id), tech_name: String(r.tech_name ?? ""),
        employment_status: r.employment_status ?? null,
        effective_date: r.effective_date ?? null, last_day_worked: r.last_day_worked ?? null,
        district_no: r.district_no ?? null, source: "tpms", rosterKnown: true,
        enterpriseId: r.enterprise_id ?? null, lastSeenAt: r.last_seen_at ?? null,
      });
    } else if (r.enterprise_id && String(r.tpms_name ?? "").trim()) {
      // Known to TPMS, absent from the roster. Carried WITHOUT an employee_id.
      out.set(k, {
        employee_id: "", tech_name: String(r.tpms_name),
        employment_status: null, effective_date: null, last_day_worked: null,
        district_no: r.tpms_district ?? null, source: "tpms", rosterKnown: false,
        enterpriseId: r.enterprise_id, lastSeenAt: r.last_seen_at ?? null,
      });
    }
  }

  const roster = await db.execute(sql`
    SELECT DISTINCT ON (ltrim(regexp_replace(COALESCE(truck_lu, last_known_truck_lu),'[^0-9]','','g'),'0'))
           ltrim(regexp_replace(COALESCE(truck_lu, last_known_truck_lu),'[^0-9]','','g'),'0') AS truck,
           employee_id, tech_name, employment_status,
           effective_date::text AS effective_date, last_day_worked::text AS last_day_worked, district_no
    FROM all_techs
    WHERE COALESCE(truck_lu, last_known_truck_lu) IS NOT NULL
    ORDER BY 1, (employment_status = 'A') DESC, effective_date DESC NULLS LAST, employee_id
  `);
  for (const r of (roster.rows ?? []) as any[]) {
    const k = norm(r.truck);
    if (!k || !r.employee_id) continue;
    const prior = out.get(k);
    if (!prior) {
      out.set(k, {
        employee_id: String(r.employee_id), tech_name: String(r.tech_name ?? ""),
        employment_status: r.employment_status ?? null,
        effective_date: r.effective_date ?? null, last_day_worked: r.last_day_worked ?? null,
        district_no: r.district_no ?? null, source: "roster",
      });
    } else if (prior.rosterKnown === false) {
      // TPMS says a roster-unknown tech holds this truck TODAY; all_techs.truck_lu
      // is a stale historical field and lost to it (truck 46911 pointed at a
      // terminated Ronald Owens while TPMS had Mark Adams Jr on it that morning).
      continue;
    } else if (prior.employee_id === String(r.employee_id)) {
      prior.source = "both";
    } else {
      prior.conflict = true;
    }
  }
  return out;
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

  // ── direct-billing takeover ────────────────────────────────────────────────
  // While a truck's case slot is OWNED by a live 'enterprise_direct' case
  // (manual direct-billing upload), the Snowflake feeds still carry the OLD
  // open Enterprise ticket for that same truck until the branch closes it
  // (the direct report itself instructs "CLOSE ENTERPRISE TICKET …"). Letting
  // those rows through would flip the case's source/renter back on every sync,
  // and the next direct sweep would then drop the case entirely (ping-pong).
  // The direct report is the fresher truth (Tyler 2026-08-21), so feed rows
  // aimed at a live direct case are excluded from this run; once the direct
  // case drops (rental returned / absent from the next upload) the feeds
  // reclaim the slot naturally because the ownership check is present-only.
  let incoming = o.cases;
  if (incoming.some((c) => c.source !== "enterprise_direct")) {
    const live = await db.execute(sql`
      SELECT case_key FROM vrm_rental_operations_cases
      WHERE source = 'enterprise_direct' AND present_in_latest = true
    `);
    const owned = new Set((live.rows as any[]).map((r) => String(r.case_key)));
    if (owned.size) {
      const before = incoming.length;
      incoming = incoming.filter((c) => c.source === "enterprise_direct" || !owned.has(c.case_key));
      if (incoming.length !== before) {
        console.log(`[VRM/RentalOps] ${before - incoming.length} feed case(s) excluded — truck owned by a live direct-billing case`);
      }
    }
  }

  // guard: never sweep on an empty set (a bad parse must not wipe cases)
  if (!incoming.length) {
    await db.execute(sql`
      UPDATE vrm_rental_operations_import_runs
      SET status='failed', error='no cases — refused to sweep', finished_at=NOW() WHERE id=${runId}
    `);
    await upsertSourceHealth(runId, o.healthKey, "failed", o.fileDate, 0, "no cases", o.healthFileDate);
    return { runId, resolved: 0, review: 0, exception: 0, dropped: 0, totalCases: 0, enterpriseCount: 0, holmanCount: 0, pendedCount: 0 };
  }

  const cases = incoming;
  const roster = o.roster ?? await loadRoster();
  const onboarding = o.onboarding ?? await loadOnboarding();
  const rosterIndex = buildRosterIndex(roster);
  // Truck -> technician. Loaded once per run, not per case.
  const truckTechs = await loadTruckTechMap();
  const resolutions = new Map<string, IdentityResolution>();
  let resolved = 0, review = 0, exception = 0;
  for (const c of cases) {
    const truckKey = String(c.vehicle_number ?? "").replace(/[^0-9]/g, "").replace(/^0+/, "");
    // A caller-supplied resolution (stronger-than-name evidence) wins over the
    // name-based resolver; everything downstream treats both identically.
    const r = o.presetResolutions?.get(c.case_key) ?? resolveIdentity({
      renter: c.renter_name_raw, rentalStart: c.rental_start_date, rosterIndex, onboarding,
      truckTech: truckKey ? (truckTechs.get(truckKey) ?? null) : null,
      pickupState: c.renting_state,
    });
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
          last_seen_at=NOW(), dropped_from_feed_at=NULL, updated_at=NOW(),
          -- feed_json is MERGED, never replaced (Tyler 2026-08-30).
          --
          -- It used to be absent from this list entirely, so it was written once at
          -- INSERT and then frozen forever while every scalar column beside it kept
          -- moving. That is not cosmetic: book_cutover.py derives the reserved
          -- vehicle class from feed_json, and on 2026-08-17 eleven technicians in one
          -- wave were in a DIFFERENT vehicle than the pinned snapshot claimed
          -- (JPAIGE Rogue -> F-150, KEDOH Outlander -> Pacifica), so the booker
          -- reserved the wrong car. The workaround was --feed-override built by hand
          -- from raw_rentals. This is that workaround made unnecessary.
          --
          -- ⛔ MERGE, NOT OVERWRITE, AND THE DIFFERENCE MATTERS. Sources carry
          -- DIFFERENT KEY SHAPES: the Snowflake ECARS feed supplies RENTING_BRANCH /
          -- RENTING_CITY_NAME / ECARS_2_0_TKT_NBR / RATE_AUTHORIZED, while the
          -- manual Enterprise direct-billing report supplies AVG_RATE_PER_DAY /
          -- ACTUAL_CHARGE_DAYS and no branch at all. A case that starts on ECARS and
          -- is later taken over by the direct import keeps its original source's
          -- keys: measured on prod 2026-08-30, 218 of 314 enterprise_direct cases
          -- still held RENTING_BRANCH. A plain feed_json=EXCLUDED.feed_json would
          -- have blanked the branch on all 218 and broken book_cutover.py and
          -- build_reservation_queue.py, which read exactly that field.
          --
          -- `||` is a shallow right-wins merge, so each import refreshes the keys it
          -- actually supplies and leaves every other source's keys standing. COALESCE
          -- guards the nullable column, because NULL || x is NULL in jsonb.
          --
          -- Known limit, accepted on purpose: a key that DISAPPEARS upstream is not
          -- cleared, it keeps its last known value. Losing another source's live keys
          -- is the worse failure. The per-run snapshots in
          -- vrm_rental_operations_raw_rentals remain the untouched audit trail of
          -- exactly what each file said.
          feed_json=COALESCE(vrm_rental_operations_cases.feed_json, '{}'::jsonb) || EXCLUDED.feed_json
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

    // ── expire human identity overrides whose rental has been turned in ────
    // case_key is the VEHICLE number, so an override approved on this truck
    // would otherwise leak onto the NEXT rental once this one is turned in and
    // a new PO opens against the same unit. The override carries the po_number
    // it was approved against; a different PO means the approval no longer
    // describes the rental on screen. Runs AFTER the case upsert above, so
    // c.po_number is already current and there is no window in which a stale
    // override can be read.
    await tx.execute(sql`
      UPDATE vrm_rental_identity_resolutions i
      SET override_employee_id=NULL, override_status=NULL, override_tech_name=NULL,
          override_by=NULL, override_at=NULL, override_po_number=NULL, updated_at=NOW()
      FROM vrm_rental_operations_cases c
      WHERE c.case_key = i.case_key
        AND i.override_employee_id IS NOT NULL
        AND i.override_po_number IS NOT NULL
        AND i.override_po_number IS DISTINCT FROM c.po_number
        -- Direct-billing cases carry NO po_number by design (no Holman rental
        -- PO exists), so the PO comparison above would expire EVERY override on
        -- a truck the moment its case flips to the direct report — and in the
        -- changeover scenario the renter is the SAME person continuing the same
        -- physical rental, so the human call is still valid. A PO-less case
        -- provides no evidence the rental turned over; keep the override.
        AND c.source <> 'enterprise_direct'
    `);
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
  await upsertSourceHealth(runId, o.healthKey, "completed", o.fileDate, totalCases, null, o.healthFileDate);

  // Executive Summary daily rollup — dynamic import avoids a module cycle;
  // failure must NEVER fail the ingest itself.
  try {
    const { upsertTodayExecMetrics } = await import("../executive-summary/rollup");
    await upsertTodayExecMetrics();
  } catch (e) {
    console.error("[vrm-exec] daily rollup after ingest failed (non-fatal):", (e as Error)?.message);
  }

  // New rows landed — the exec summary must not keep serving pre-sync numbers
  // for its full TTL. Dynamic import (cycle-safe), never fails the ingest.
  try {
    const { clearSummaryCache } = await import("../executive-summary/summary-cache");
    clearSummaryCache("rental-ops ingest landed");
  } catch (e) {
    console.error("[vrm-exec] summary cache clear after ingest failed (non-fatal):", (e as Error)?.message);
  }

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

  // Resolve the effective file date for provenance, PER FEED. The two Snowflake
  // tables publish independently and each pull filters on its OWN
  // MAX(FILE_DATE) (see dateFilter), so there is no such thing as one file date
  // for the run. Reading Enterprise's max and stamping it on both was a live
  // false-green: if the Holman open-rental feed froze while Enterprise kept
  // publishing, snowflake_holman would report Enterprise's fresh date, classify
  // GREEN, and vouch for a feed that had not moved in a week — the exact failure
  // mode the data-age rewrite exists to kill, reintroduced inside the new
  // signal. `fileDate` stays Enterprise-derived because it is the run-level
  // provenance value written to import_runs and used by persistRentalCases.
  const [entMaxRes, holMaxRes] = await Promise.all([
    svc.executeQuery(`SELECT TO_CHAR(MAX(FILE_DATE),'YYYY-MM-DD') AS D FROM ${ENT_TABLE}`),
    svc.executeQuery(`SELECT TO_CHAR(MAX(FILE_DATE),'YYYY-MM-DD') AS D FROM ${HOL_TABLE}`),
  ]);
  const entFeedDate: string | null = entMaxRes[0]?.D || null;
  const holFeedDate: string | null = holMaxRes[0]?.D || null;
  const fileDate: string | null = opts.fileDate || entFeedDate;
  // what the Holman pull actually loaded: an explicit backfill date if given,
  // otherwise that feed's own max.
  const holFileDate: string | null = opts.fileDate || holFeedDate;

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
    await upsertSourceHealth(runId, "scheduled_sync", "failed", fileDate, 0, "both Snowflake sources empty", entFeedDate);
    return { runId, fileDate, enterpriseCount: 0, holmanCount: 0, pendedCount: 0, totalCases: 0,
      resolved: 0, review: 0, exception: 0, dropped: 0, skipped: true, skipReason: "both sources empty" };
  }

  const { cases } = buildCases(ticketRows, holmanRows, now);
  const p = await persistRentalCases({
    runType, sourceLabel: "snowflake", fileDate, cases,
    sweepSources: ["enterprise", "holman_non_enterprise"], healthKey: "scheduled_sync",
    healthFileDate: entFeedDate,
    fingerprint: `ent:${ticketRows.length};hol:${holmanRows.length};file:${fileDate}`,
  });
  const runId = p.runId;
  // Each feed is judged against ITS OWN current publish date (entFeedDate /
  // holFeedDate), not against whatever this run happened to load — a manual
  // backfill replaying June must not stamp a two-month-old verdict over the
  // live daily health row.
  await upsertSourceHealth(runId, "snowflake_enterprise", "completed", fileDate, ticketRows.length, null, entFeedDate);
  await upsertSourceHealth(runId, "snowflake_holman", "completed", holFileDate, holmanRows.length, null, holFeedDate);

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

// ════════════════════════════════════════════════════════════════════════════
// HONEST SOURCE HEALTH — measure the age of the DATA, not the time of the land
// ════════════════════════════════════════════════════════════════════════════
/**
 * Tyler 7/21: vrm_rental_source_health reported all 5 sources GREEN against a
 * 30h threshold while 94% of the PO rows sitting behind those sources carried
 * an upload_timestamp over 30 days old. The old clock only ever measured
 * last_success_at — the moment WE finished writing — which is a statement about
 * our cron, not about whether the data is true. A source that faithfully
 * re-lands the same fossil every night looks perfectly healthy right up until
 * LUCA dials a shop off a PO that has been PAID for four months. That false
 * all-clear is the thing being killed here.
 *
 * Every source now carries BOTH clocks:
 *   last_success_at / last_attempt_at   — WHEN WE RAN. Meaning deliberately
 *     unchanged: read-repository.getSourceHealth() derives `stale` and
 *     `age_hours` from last_success_at, and the RentalOperations header prints
 *     lastSyncAt / lastImportAt off it. Redefining that column would have
 *     silently rewritten what those two readers display, so it was left alone
 *     and the new measurement added beside it.
 *   data_age_p50_hours / data_age_p90_hours — HOW OLD THE DATA IS.
 *
 * WHY A PERCENTILE AND NOT A MAX. Measured on PROD 7/21 (every figure in this
 * block is prod; DEV numbers differ and are never quoted here): the 163 PO rows
 * that actually set the open-repair flag have a MIN age of 14.6h, because one
 * row landed this morning. MAX(upload_timestamp) — i.e. "newest row we have" —
 * therefore reads 14.6h and certifies the source GREEN. The MEDIAN of that same
 * population is 206.6h (8.6 days) and the p90 is 2280.2h (95 days). One fresh
 * row must never be allowed to vouch for 13,000 fossils, so the gate is p50
 * (what the typical flag-setting row actually looks like) with p90 riding along
 * as the tail indicator, able to trip the status on its own.
 *
 * WHICH FRESHNESS THIS IS, AND WHICH IT IS NOT. Ruling 7/21, closing the
 * integration gate's "two notions of freshness": there are exactly two, they
 * answer different questions, and neither is allowed to answer the other's.
 *   read-repository.getPoDataFreshness() — HOW OLD IS THE DATA RIGHT NOW.
 *     Re-measured on every board read so it cannot rot, spans BOTH layers, and
 *     produces openFlagEvidence*, which no per-source row can: that number is a
 *     property of the ETL×portal join, not of any one source.
 *   what THIS file persists — WHAT THE RUN SAW WHEN IT LANDED. Per source, and
 *     it carries the two facts a read-time measurement can never reconstruct:
 *     whether the run itself failed, and whether it landed into an EMPTY
 *     population (the most dangerous state here, since an empty open_repair set
 *     reads as good news on the grid).
 * They are not independent — getSourceHealth() is where they meet, and it will
 * not let a frozen verdict render green once either clock says nobody has
 * looked recently. If you are about to compute a THIRD age anywhere in this
 * module, don't; call one of those two. The population this file ages is
 * likewise not a third definition of open_repair: it is imported from
 * read-repository (see measureDataAge).
 */

/** green = trust it · yellow = corroborate before acting · red = do not trust */
export type SourceHealthStatus = "green" | "yellow" | "red";

export interface DataAgeThresholds { warnHours: number; failHours: number }
export interface DataAgeMeasurement {
  metric: string;              // human label of exactly what population was aged
  p50Hours: number | null;
  p90Hours: number | null;
  /**
   * Size of the aged population, and it is load-bearing, not decoration:
   * rows === 0 is its own alarm (see classifySourceHealth) because a source that
   * lands cleanly and leaves NOTHING behind the flag is broken, not merely
   * unmeasurable. NULL means "this metric is a scalar, not a population" — the
   * feed sources age a single FILE_DATE, so writing 0 there would trip the
   * empty-population alarm on a perfectly healthy feed and would read to a
   * consumer as "nothing was measured". Only ever set a number here when the
   * number is a real COUNT.
   */
  rows: number | null;
}

/**
 * Feed sources — the Enterprise and Holman open-rental reports, plus the
 * scheduled_sync run that lands both. These publish one FILE_DATE per day, so
 * their data age is the age of that file date measured from midnight UTC (the
 * earliest moment a row stamped with that date could have been true; measuring
 * from end-of-day would flatter a feed that is already a day behind).
 *   WARN 36h — the daily publish slipped a full cycle. days_open, ticket_status
 *              and the whole rental picture are a day stale.
 *   FAIL 72h — two lands missed. The grid is quoting last week's rentals and
 *              every days_open on the page is wrong by the same amount.
 *
 * 36h rather than the legacy 30h, and note WHERE the reading is taken: this is
 * classified at WRITE time, inside the ingest, not when a dashboard renders. So
 * the number being judged is always "how old was the newest published file at
 * the moment we pulled it". On PROD 7/21 that is 19.1h for all three feed keys
 * (land 19:04 UTC against FILE_DATE 2026-07-21). Holman does not publish a given
 * day's file until midday UTC, so a sync that runs early — 08:00 UTC — correctly
 * pulls the PREVIOUS day's file and reads ~32h with nothing whatsoever wrong.
 * 30h would fire on that perfectly normal early run. 36h clears it, while a
 * genuinely missed publish lands at ~43h and trips.
 */
const FEED_DATA_AGE_WARN_HOURS = 36;
const FEED_DATA_AGE_FAIL_HOURS = 72;

/**
 * The Holman PO ETL. This is the source behind open_repair — after the portal
 * correction, a qualifying repair PO whose po_eff.eff_status is still APPROVED
 * (read-repository.PO_EFFECTIVE_CTE) — and therefore decides which shops LUCA
 * dials, so it gets the strictest reading.
 *   WARN 72h  — Holman re-uploads daily; three days without a refresh on the
 *               typical flag-driving PO means APPROVED is a guess, not a fact.
 *   FAIL 336h — 14 days, which is inside the normal repair cycle. A PO that has
 *               not been touched for longer than the repair itself typically
 *               takes has almost certainly changed state underneath us; that is
 *               precisely the 43-of-178 cohort the 7/21 audit found sitting on
 *               POs the portal already showed PAID or VOID.
 *
 * NOT 720h. The audit's "provably suspect" line was 30 days and 94% of all PO
 * rows are past it, so 720 is the obvious-looking number. It was rejected
 * because it lands inside the flag-driving subset's own spread rather than
 * outside it: that subset runs from 14.6h to 3489.4h with a p90 of 2280.2h, so
 * 720 sits in the middle of the tail where a handful of Holman re-uploads walk
 * the reading back and forth across the line. A threshold a normal day's data
 * straddles produces a signal that flips red/yellow/red and gets ignored inside
 * a week, which is how the original all-clear became furniture.
 *
 * WHAT THE RECONCILIATION DID TO THIS READING — re-measured on PROD 7/21 when
 * measureDataAge was corrected off the raw ETL predicate (D4). Against the raw
 * predicate: 234 rows, p50 758.6h, verdict RED on the median. Against the
 * reconciled population: 163 rows across the 136 open_repair trucks, p50 206.6h.
 * A 73% drop, because the 72 rows the portal closed had a median age of 3489.4h
 * (145 days) — the delta layer is retiring precisely the fossils, which is what
 * it exists to do. The verdict moves RED → YELLOW and the reason moves to the
 * tail: p90 2280.2h is still past 336h, so a tenth of what LUCA acts on is
 * running on 95-day-old evidence, and the median is still past WARN.
 *
 * 336 was NOT re-tuned to preserve the red. It now sits 1.6x above the median
 * with ~130h of headroom, i.e. roughly five missed Holman uploads before the
 * median alone trips it, while WARN 72h fires today. Tyler 7/21: 336h is a
 * judgement call, not a measured constant, and the right answer once the scrape
 * is filling gaps is probably lower, not higher. That is now measurable —
 * revisit it against the reconciled p50 above, not against the 30-day audit line
 * (which described all 13,252 rows, a population this metric no longer ages).
 */
const PO_DATA_AGE_WARN_HOURS = 72;
const PO_DATA_AGE_FAIL_HOURS = 336;

/**
 * AMS truck status, enriched onto cases from the AMS cache each sync. AMS moves
 * a truck to auction/declined over days, not hours, so a two-day-old read is
 * still actionable and a week-old read is not.
 */
const AMS_DATA_AGE_WARN_HOURS = 48;
const AMS_DATA_AGE_FAIL_HOURS = 168;

export function dataAgeThresholds(sourceKey: string): DataAgeThresholds {
  if (sourceKey === "holman_etl_po") return { warnHours: PO_DATA_AGE_WARN_HOURS, failHours: PO_DATA_AGE_FAIL_HOURS };
  if (sourceKey === "ams_status") return { warnHours: AMS_DATA_AGE_WARN_HOURS, failHours: AMS_DATA_AGE_FAIL_HOURS };
  return { warnHours: FEED_DATA_AGE_WARN_HOURS, failHours: FEED_DATA_AGE_FAIL_HOURS };
}

/**
 * Ages the population that actually MATTERS for each source, not whatever rows
 * happen to be in the table.
 *
 * For holman_etl_po that population is the RECONCILED open-repair set: ETL rows
 * whose po_eff.eff_status is still APPROVED on a qualifying repair PO, straight
 * off read-repository's exported CTE. It used to be a hand-copy of the RAW ETL
 * predicate (po_status='APPROVED' AND repair/tow-with-parts-labor) still
 * labelled "the rows that set open_repair" — true before the delta layer landed,
 * false the moment it did (D4, integration gate 7/21). On prod that label was
 * covering 72 rows across 42 trucks the board had already dismissed as
 * closed_by_portal, and their median age of 3489.4h was what drove the verdict.
 * A metric whose name lies about what it counts is worse than no metric.
 *
 * Aging all 13,252 PO rows would be honest but useless (dominated by a years-old
 * PAID backfill, RED forever regardless of whether the live flags are
 * trustworthy). Aging the 163 rows behind the 136 open_repair trucks answers the
 * only question worth asking: is the thing LUCA acts on still true?
 *
 * WHY upload_timestamp AND NOT po_eff.evidence_at. evidence_at is
 * GREATEST(Holman's upload stamp, the allow-listed portal observation), so a
 * scrape from this morning would report the underlying ETL row as fresh — and
 * this metric belongs to the ETL source. The scrape is the correction layer with
 * its own freshness; folding it in here would let the delta layer mask base
 * rot, the same masking the on_demand_scrape exclusion prevents. The
 * reconciliation decides WHICH rows count; the clock stays Holman's own.
 *
 * The join back to vrm_rental_operations_po_history recovers `source`, which
 * po_eff does not project — on_demand_scrape rows must stay out for the reason
 * above. It is 1:1: (vehicle_number_padded, po_number) is unique with no NULLs
 * in either column across all 13,252 prod / 14,974 dev rows (verified 7/21). If
 * po_eff ever projects p.source, delete the join rather than the filter.
 *
 * THROWS on query failure. That is deliberate: the caller distinguishes "the
 * measurement blew up" (previous reading preserved, YELLOW) from "the population
 * is empty" (rows: 0, its own RED), and returning a null-shaped object on error
 * would collapse those two into one.
 */
async function measureDataAge(sourceKey: string, fileDate: string | null): Promise<DataAgeMeasurement> {
  if (sourceKey === "holman_etl_po") {
    const res = await db.execute(sql`
      WITH ${PO_EFFECTIVE_CTE}
      SELECT COUNT(q.upload_timestamp)::int AS rows,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (NOW() - q.upload_timestamp))/3600.0) AS p50,
        percentile_cont(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (NOW() - q.upload_timestamp))/3600.0) AS p90
      FROM po_eff q
      JOIN vrm_rental_operations_po_history s
        ON s.vehicle_number_padded = q.vehicle_number_padded AND s.po_number = q.po_number
      WHERE s.source = 'holman_etl'
        AND q.is_qualifying_repair AND q.eff_status = 'APPROVED'
    `);
    const r = res.rows[0] as any;
    return {
      metric: "upload_timestamp age of the ETL rows still setting open_repair after portal reconciliation (eff_status APPROVED on a qualifying repair PO)",
      p50Hours: r?.p50 == null ? null : Number(r.p50),
      p90Hours: r?.p90 == null ? null : Number(r.p90),
      rows: Number(r?.rows ?? 0),
    };
  }

  if (sourceKey === "ams_status") {
    const res = await db.execute(sql`
      SELECT COUNT(ams_status_at)::int AS rows,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (NOW() - ams_status_at))/3600.0) AS p50,
        percentile_cont(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (NOW() - ams_status_at))/3600.0) AS p90
      FROM vrm_rental_operations_cases
      WHERE present_in_latest = true AND ams_status_at IS NOT NULL
    `);
    const r = res.rows[0] as any;
    return {
      metric: "ams_status_at age across cases present in the latest feed",
      p50Hours: r?.p50 == null ? null : Number(r.p50),
      p90Hours: r?.p90 == null ? null : Number(r.p90),
      rows: Number(r?.rows ?? 0),
    };
  }

  // feed sources: one FILE_DATE for the whole pull, so p50 and p90 are the same
  // scalar. Reported in both columns anyway so a consumer can read every source
  // the same way instead of special-casing. rows stays NULL throughout this
  // branch — there is no population here, and 0 would mean something else.
  if (!fileDate || !/^\d{4}-\d{2}-\d{2}$/.test(fileDate)) {
    return { metric: "file_date age (no usable file date on this run)", p50Hours: null, p90Hours: null, rows: null };
  }
  const res = await db.execute(sql`
    SELECT EXTRACT(EPOCH FROM (NOW() - (${fileDate}::text || 'T00:00:00Z')::timestamptz))/3600.0 AS age
  `);
  const age = (res.rows[0] as any)?.age;
  const hours = age == null ? null : Number(age);
  return { metric: `feed FILE_DATE ${fileDate} age from midnight UTC`, p50Hours: hours, p90Hours: hours, rows: null };
}

/**
 * The whole point of the rewrite: a source is not healthy just because the job
 * exited 0. Run failure is still RED, but a clean run on rotten data is no
 * longer GREEN.
 *
 * Three non-green states that are easy to conflate and must not be:
 *   RED  "last run failed"      — the job itself broke.
 *   RED  "population is empty"  — the job succeeded and left NOTHING behind the
 *        flag. For holman_etl_po that means not one qualifying repair PO
 *        survives the portal reconciliation as APPROVED fleet-wide, i.e. the
 *        read model now says every truck is out of the shop. Against a 136-truck
 *        open-repair cohort that is a wiped land or a portal layer gone haywire,
 *        never a real Tuesday, and it is the single most dangerous state here
 *        because an empty open_repair set looks like GOOD news on the grid. It
 *        gets its own alarm rather than hiding inside "could not measure", which
 *        is why DataAgeMeasurement.rows distinguishes 0 from NULL. Note the
 *        reconciliation gave this alarm a SECOND trigger: pre-delta only a
 *        broken ETL land could empty it; now a bad scrape that marks everything
 *        PAID would too. Both are worth waking up for; the reason string cannot
 *        tell them apart, so check vrm_holman_portal_hist before blaming the ETL.
 *   YELLOW "could not be measured" — the measurement query threw, or there is no
 *        usable file date. "We could not tell" must never read as an all-clear;
 *        that silence is precisely what produced the original false GREEN.
 *
 * CONTRACT NOTE FOR ANY CONSUMER OF health_status — this is a verdict FROZEN at
 * ingest time, and it can rot exactly like the data it describes. If the sync
 * stops running altogether, the last row it wrote stays GREEN forever and you
 * have rebuilt the false all-clear one layer up. health_status is only safe
 * rendered ALONGSIDE the run clock (last_success_at / the `stale` flag
 * read-repository derives from it): the run clock catches "nobody has looked",
 * health_status catches "we looked and it was rotten". Neither one alone is a
 * health signal. read-repository.getPoDataFreshness() sidesteps this entirely by
 * re-measuring the landed tables at read time; prefer it where you can.
 */
export function classifySourceHealth(
  runSucceeded: boolean, m: DataAgeMeasurement | null, t: DataAgeThresholds,
): { status: SourceHealthStatus; reason: string | null } {
  if (!runSucceeded) return { status: "red", reason: "last run failed" };
  if (!m) return { status: "yellow", reason: "data age could not be measured — measurement query failed" };
  if (m.rows === 0) {
    return { status: "red", reason: `population is empty — 0 rows in ${m.metric}; the run succeeded and left nothing behind the flag, treat as a failed land` };
  }
  if (m.p50Hours == null) return { status: "yellow", reason: "data age could not be measured" };
  const p50 = Math.round(m.p50Hours);
  const p90 = m.p90Hours == null ? null : Math.round(m.p90Hours);

  // EVERY triggered condition goes into the reason, not just the first one to
  // match. The verdicts are unchanged (red iff the median is past fail, yellow
  // iff either the tail is past fail or the median is past warn) — what changes
  // is that a source tripping two rules now says so. Post-D4 the reconciled PO
  // population trips both (prod 7/21: p90 2280h vs fail 336h, p50 207h vs warn
  // 72h) and the old early-return named only the tail, which reads as "the
  // median is fine". It is not, and a reason that implies it is is the same
  // species of false all-clear this rewrite exists to remove.
  const reasons: string[] = [];
  if (m.p50Hours >= t.failHours) {
    reasons.push(`median data age ${p50}h exceeds ${t.failHours}h — data is not evidence`);
  } else if (m.p50Hours >= t.warnHours) {
    reasons.push(`median data age ${p50}h exceeds ${t.warnHours}h`);
  }
  if (p90 !== null && m.p90Hours! >= t.failHours) {
    reasons.push(`tail data age p90 ${p90}h exceeds ${t.failHours}h — a stale minority is driving flags`);
  }
  if (!reasons.length) return { status: "green", reason: null };
  return { status: m.p50Hours >= t.failHours ? "red" : "yellow", reason: reasons.join("; ") };
}

/**
 * BOOT DDL, same contract as schema.ts: Nexus deploys run NO migrations, so a
 * column that is not created by an idempotent CREATE/ALTER ... IF NOT EXISTS
 * simply does not exist in production. Kept next to the code that writes these
 * columns so the two cannot drift.
 *
 * Nothing calls this at boot today — initRentalOperationsSchema() in schema.ts
 * does not know about it, and that file is owned elsewhere. So the ONLY thing
 * creating these columns is the memoized call inside upsertSourceHealth, which
 * means the very first health write on a fresh database runs the ALTERs itself.
 * That is why the write path degrades to upsertSourceHealthLegacy on DDL
 * failure instead of trusting the columns to be there: if this is ever wired
 * into schema.ts the degrade becomes dead weight, but until then it is the only
 * thing standing between a missing column and a failed nightly sync.
 */
export async function ensureSourceHealthDataAgeColumns(): Promise<void> {
  await db.execute(sql`ALTER TABLE vrm_rental_source_health ADD COLUMN IF NOT EXISTS data_age_metric TEXT;`);
  await db.execute(sql`ALTER TABLE vrm_rental_source_health ADD COLUMN IF NOT EXISTS data_age_p50_hours NUMERIC(12,2);`);
  await db.execute(sql`ALTER TABLE vrm_rental_source_health ADD COLUMN IF NOT EXISTS data_age_p90_hours NUMERIC(12,2);`);
  await db.execute(sql`ALTER TABLE vrm_rental_source_health ADD COLUMN IF NOT EXISTS data_age_rows INTEGER;`);
  await db.execute(sql`ALTER TABLE vrm_rental_source_health ADD COLUMN IF NOT EXISTS data_age_measured_at TIMESTAMPTZ;`);
  await db.execute(sql`ALTER TABLE vrm_rental_source_health ADD COLUMN IF NOT EXISTS data_age_warn_hours INTEGER;`);
  await db.execute(sql`ALTER TABLE vrm_rental_source_health ADD COLUMN IF NOT EXISTS data_age_fail_hours INTEGER;`);
  // health_status is stored rather than left to each reader to recompute: the
  // thresholds are per-source and live here, and a dashboard that re-derives
  // "healthy" from whatever column it happens to have is how the false
  // all-clear happened the first time.
  await db.execute(sql`ALTER TABLE vrm_rental_source_health ADD COLUMN IF NOT EXISTS health_status VARCHAR(10);`);
  await db.execute(sql`ALTER TABLE vrm_rental_source_health ADD COLUMN IF NOT EXISTS health_reason TEXT;`);
}
let dataAgeColumnsReady: Promise<void> | null = null;
function ensureDataAgeColumnsOnce(): Promise<void> {
  // only the SUCCESSFUL attempt is memoized — a failure here (table not created
  // yet on a cold box) must be retried on the next write, not cached forever.
  if (!dataAgeColumnsReady) {
    dataAgeColumnsReady = ensureSourceHealthDataAgeColumns().catch((e) => {
      dataAgeColumnsReady = null;
      throw e;
    });
  }
  return dataAgeColumnsReady;
}

/**
 * The pre-data-age write. Kept as a real fallback rather than dead code: the
 * nine data-age columns are created by boot DDL, and Nexus deploys run NO
 * migrations, so on a box where that ALTER has not landed yet (cold start, table
 * created moments earlier, role without DDL rights) the 18-column INSERT below
 * throws "column does not exist". upsertSourceHealth is called from
 * persistRentalCases AFTER every case has been written, and from
 * runRentalOpsIngest at three more points, none of them guarded — so letting
 * that throw escape would turn a fully successful sync into a failed one over a
 * health-reporting detail. Degrade to the legacy write instead and shout in the
 * log; the run clock still lands, only the honest signal is missing.
 */
async function upsertSourceHealthLegacy(
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

export async function upsertSourceHealth(
  runId: string, sourceKey: string, status: string,
  fileDate: string | null, rowCount: number, failure: string | null,
  /**
   * The file date this SOURCE currently sits at, when that differs from the file
   * date this RUN loaded. Only the feed sources need it and only on a manual
   * backfill: `runRentalOpsIngest({ fileDate: '2026-06-01' })` replays an old
   * file, and without this the replay's 50-day-old file date would be classified
   * and stamped over the live daily verdict in the single per-source_key row,
   * leaving the dashboard reporting RED about a file nobody is serving from.
   * last_file_date still records what the run actually loaded — that column's
   * meaning is unchanged and read-repository surfaces it. Defaults to fileDate,
   * which is correct for every non-backfill caller.
   */
  healthFileDate?: string | null,
): Promise<void> {
  const success = status === "completed";

  // Data-age measurement is best-effort and must never fail an ingest: the run
  // already landed real rows by the time we get here. A measurement that throws
  // leaves the PREVIOUS reading in place (COALESCE below), leaves
  // data_age_measured_at at its previous value, and classifies YELLOW.
  const thresholds = dataAgeThresholds(sourceKey);
  let columnsReady = true;
  let measured: DataAgeMeasurement | null = null;
  try {
    await ensureDataAgeColumnsOnce();
  } catch (e: any) {
    columnsReady = false;
    console.error(`[VRM/RentalOps] source-health data-age columns unavailable for ${sourceKey} — writing legacy row without the honest signal:`, e?.message || e);
  }
  if (columnsReady) {
    try {
      measured = await measureDataAge(sourceKey, healthFileDate === undefined ? fileDate : healthFileDate);
    } catch (e: any) {
      console.warn(`[VRM/RentalOps] data-age measurement failed for ${sourceKey} (non-fatal):`, e?.message || e);
    }
  }
  if (!columnsReady) {
    await upsertSourceHealthLegacy(runId, sourceKey, status, fileDate, rowCount, failure);
    return;
  }
  const health = classifySourceHealth(success, measured, thresholds);

  // Stamp data_age_measured_at ONLY when a p50 actually came back. `measured`
  // being non-null is not enough: the empty-population and no-usable-file-date
  // cases return a real object with a null p50, and the COALESCE below then
  // holds the PREVIOUS run's percentiles — pairing last night's numbers with a
  // timestamp that says "measured just now" is a lie of exactly the kind this
  // whole rewrite exists to remove.
  const haveReading = measured != null && measured.p50Hours != null;

  try {
    await db.execute(sql`
      INSERT INTO vrm_rental_source_health
        (source_key, last_run_id, last_status, last_success_at, last_attempt_at, last_file_date, last_row_count, last_failure_reason,
         data_age_metric, data_age_p50_hours, data_age_p90_hours, data_age_rows, data_age_measured_at,
         data_age_warn_hours, data_age_fail_hours, health_status, health_reason, updated_at)
      VALUES (${sourceKey}, ${runId}, ${status}, ${success ? sql`NOW()` : sql`NULL`}, NOW(), ${fileDate}, ${rowCount}, ${failure},
         ${measured?.metric ?? null}, ${measured?.p50Hours ?? null}, ${measured?.p90Hours ?? null}, ${measured?.rows ?? null},
         ${haveReading ? sql`NOW()` : sql`NULL`}, ${thresholds.warnHours}, ${thresholds.failHours},
         ${health.status}, ${health.reason}, NOW())
      ON CONFLICT (source_key) DO UPDATE SET
        last_run_id=EXCLUDED.last_run_id, last_status=EXCLUDED.last_status,
        last_success_at=COALESCE(EXCLUDED.last_success_at, vrm_rental_source_health.last_success_at),
        last_attempt_at=NOW(), last_file_date=EXCLUDED.last_file_date, last_row_count=EXCLUDED.last_row_count,
        last_failure_reason=EXCLUDED.last_failure_reason,
        -- keep the last known data age when this run could not measure one; the
        -- health_status still degrades to yellow so an unmeasured source is never
        -- mistaken for a fresh one. data_age_measured_at rides with the numbers:
        -- it is only advanced when EXCLUDED actually carries a new reading, so
        -- the pair (measured_at, p50) is always internally consistent.
        data_age_metric=COALESCE(EXCLUDED.data_age_metric, vrm_rental_source_health.data_age_metric),
        data_age_p50_hours=COALESCE(EXCLUDED.data_age_p50_hours, vrm_rental_source_health.data_age_p50_hours),
        data_age_p90_hours=COALESCE(EXCLUDED.data_age_p90_hours, vrm_rental_source_health.data_age_p90_hours),
        data_age_rows=COALESCE(EXCLUDED.data_age_rows, vrm_rental_source_health.data_age_rows),
        data_age_measured_at=COALESCE(EXCLUDED.data_age_measured_at, vrm_rental_source_health.data_age_measured_at),
        data_age_warn_hours=EXCLUDED.data_age_warn_hours, data_age_fail_hours=EXCLUDED.data_age_fail_hours,
        health_status=EXCLUDED.health_status, health_reason=EXCLUDED.health_reason, updated_at=NOW()
    `);
  } catch (e: any) {
    // Belt and braces for the case the memoized DDL "succeeded" but the columns
    // still are not there (another process dropped them, a replica lagging).
    console.error(`[VRM/RentalOps] source-health data-age write failed for ${sourceKey} — falling back to legacy row:`, e?.message || e);
    dataAgeColumnsReady = null;   // retry the DDL on the next write
    await upsertSourceHealthLegacy(runId, sourceKey, status, fileDate, rowCount, failure);
  }
}
