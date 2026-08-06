// Executive Summary — case-facts assembly + aggregation.
//
// Fact source = the ops page's own read layer (getRentalOpsMaster) so the exec
// page and the ops page can never disagree. Three small supplemental queries
// provide what MasterRow lacks: new-hire enterprise IDs, truck registration /
// terminal state, decommissioning membership.
//
// Pure parts (buildCaseFacts / aggregateSummary / stageToRightsizeCounts /
// computeWeeklyFlows) are unit-tested with no DB.

import { pool } from "../../db";
import type { MasterRow } from "../rental-operations/read-repository";
import {
  classifyBucket,
  normalizeVendor,
  isRegBlocked,
  type CaseFacts,
  type ExecBucket,
  type TruckRegFacts,
  BUCKET_ORDER,
  BUCKET_LABELS,
} from "./buckets";
import type { InsightCard } from "./insights";
import type { TrendPoint } from "./rollup";

export const SEDAN_FLOOR = 54.99;

// Canonical truck join: strip non-digits AND leading zeros on both sides
// (case_key is 5-padded; fs_trucks.truck_number may not be).
export const canonTruck = (s: string | null | undefined) =>
  String(s ?? "").replace(/\D/g, "").replace(/^0+/, "");

export interface TruckState extends TruckRegFacts {
  terminal: boolean;
}

export interface SupplementalFacts {
  newHireEids: Set<string>; // upper-cased enterprise IDs, started ≤60d ago
  truckByCanon: Map<string, TruckState>; // fs_trucks keyed by canonical number
  decommCanon: Set<string>; // fs_decommissioning_vehicles canonical numbers
  today: Date;
}

export function buildCaseFacts(rows: MasterRow[], supp: SupplementalFacts): CaseFacts[] {
  return rows.map((r) => {
    const canon = canonTruck(r.case_key || r.vehicle_number);
    const truck = supp.truckByCanon.get(canon) ?? null;
    const identityResolved = r.identity_state === "RESOLVED";
    const eid = (r.employee_id ?? "").trim().toUpperCase();
    return {
      caseKey: r.case_key,
      vehicleNumber: r.vehicle_number,
      vendor: normalizeVendor(r.rental_vendor),
      dailyCost: r.daily_cost,
      daysOpen: r.days_open,
      daysBehind:
        r.days_open != null && r.days_authorized != null ? r.days_open - r.days_authorized : null,
      extensions: r.number_of_extensions,
      identityResolved,
      employeeId: eid || null,
      employeeStatus: r.employee_status,
      techName: r.tech_name,
      techDistrict: r.tech_district,
      classBucket: r.class_bucket,
      isNewHire: identityResolved && !!eid && supp.newHireEids.has(eid),
      truckTerminal: !!truck?.terminal || supp.decommCanon.has(canon),
      hasOpenRepairPo: r.has_open_repair === true,
      repairComplete: /^y/i.test(String(r.repairs_complete ?? "")),
      regBlocked: isRegBlocked(truck, supp.today),
    };
  });
}

// ── Aggregation (pure) ──

export interface ExecCaseRow {
  // drill-down row shape shared with the client
  caseKey: string;
  vehicleNumber: string;
  techName: string | null;
  vendor: string;
  dailyCost: number | null;
  daysOpen: number | null;
  bucket: ExecBucket;
  regBlocked: boolean;
  unknownRenter: boolean;
}

export interface RightsizeCounts {
  secured: number;
  committed: number;
  outstanding: number;
  excused: number;
}

export interface WeeklyFlows {
  newThisWeek: number;
  returnedThisWeek: number;
  newPrevWeek: number;
  returnedPrevWeek: number;
}

export interface ExecSummaryPayload {
  generatedAt: string;
  headline: {
    openTotal: number;
    byVendor: Record<string, number>;
    newThisWeek: number; // COALESCE(rental_start_date, first_seen ET) in last 7 ET days
    returnedThisWeek: number; // dropped_from_feed_at in last 7 ET days
    newPrevWeek: number; // days 8-14 back — client renders the vs-prior-week delta
    returnedPrevWeek: number;
    dailySpend: number; // sum of dailyCost over open cases (nulls = 0)
    monthlyRunRate: number; // dailySpend * 30.4
    avgDaysOpen: number | null; // mean of non-null daysOpen
    over30Count: number; // daysOpen > 30
    unknownRenterCount: number;
    regBlockedCount: number;
    potentialDailySavings: number; // Σ max(0, dailyCost - SEDAN_FLOOR) on van-like classes
    rightsize: RightsizeCounts; // condensed 4-way; full stage map in rightsizeStages
    rightsizeStages: Record<string, number>; // raw stage → count
  };
  buckets: {
    bucket: ExecBucket;
    label: string;
    count: number;
    dailySpend: number;
    cases: ExecCaseRow[];
  }[];
  breakdowns: {
    byDistrict: { key: string; count: number; dailySpend: number }[]; // top 10 by count
    byClass: { key: string; count: number; dailySpend: number }[];
  };
  insights: InsightCard[];
  trends: TrendPoint[];
  aiBrief: { text: string; generatedAt: string } | null;
  /** finished_at of the last completed rental-ops ingest — the REAL data age.
   *  generatedAt is only when this payload was computed from those tables. */
  dataAsOf?: string | null;
  /** Snowflake file_date that ingest landed (the data's vintage day). */
  dataFileDate?: string | null;
  sectionErrors?: Record<string, string>;
  stale?: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// Van/minivan-like class test for savings. class_bucket values are exactly
// "SUV/VAN/TRUCK" | "SEDAN" | "" (vehicleCategory in read-repository.ts) —
// the regex tolerates future granularity (MINIVAN/CARGO VAN/PICKUP).
export const isVanLikeClass = (classBucket: string) =>
  /van|truck|pickup|suv/i.test(classBucket);

export function aggregateSummary(
  facts: CaseFacts[],
  rightsize: RightsizeCounts,
  rightsizeStages: Record<string, number>,
): Pick<ExecSummaryPayload, "headline" | "buckets" | "breakdowns"> {
  const byVendor: Record<string, number> = {};
  const bucketAgg = new Map<ExecBucket, { count: number; dailySpend: number; cases: ExecCaseRow[] }>(
    BUCKET_ORDER.map((b) => [b, { count: 0, dailySpend: 0, cases: [] }]),
  );
  const byDistrict = new Map<string, { count: number; dailySpend: number }>();
  const byClass = new Map<string, { count: number; dailySpend: number }>();

  let dailySpend = 0;
  let potentialDailySavings = 0;
  let unknownRenterCount = 0;
  let regBlockedCount = 0;
  let over30Count = 0;
  let daysOpenSum = 0;
  let daysOpenN = 0;

  for (const f of facts) {
    const { bucket, unknownRenter } = classifyBucket(f);
    const cost = f.dailyCost ?? 0;
    dailySpend += cost;
    byVendor[f.vendor] = (byVendor[f.vendor] ?? 0) + 1;
    if (unknownRenter) unknownRenterCount++;
    if (f.regBlocked) regBlockedCount++;
    if (f.daysOpen != null) {
      daysOpenSum += f.daysOpen;
      daysOpenN++;
      if (f.daysOpen > 30) over30Count++;
    }
    if (f.dailyCost != null && isVanLikeClass(f.classBucket)) {
      potentialDailySavings += Math.max(0, f.dailyCost - SEDAN_FLOOR);
    }

    const b = bucketAgg.get(bucket)!;
    b.count++;
    b.dailySpend += cost;
    b.cases.push({
      caseKey: f.caseKey,
      vehicleNumber: f.vehicleNumber,
      techName: f.techName,
      vendor: f.vendor,
      dailyCost: f.dailyCost,
      daysOpen: f.daysOpen,
      bucket,
      regBlocked: f.regBlocked,
      unknownRenter,
    });

    const dKey = (f.techDistrict ?? "").trim() || "Unknown";
    const d = byDistrict.get(dKey) ?? { count: 0, dailySpend: 0 };
    d.count++;
    d.dailySpend += cost;
    byDistrict.set(dKey, d);

    const cKey = f.classBucket || "Unknown";
    const c = byClass.get(cKey) ?? { count: 0, dailySpend: 0 };
    c.count++;
    c.dailySpend += cost;
    byClass.set(cKey, c);
  }

  const toSorted = (m: Map<string, { count: number; dailySpend: number }>) =>
    Array.from(m.entries())
      .map(([key, v]) => ({ key, count: v.count, dailySpend: round2(v.dailySpend) }))
      .sort((a, b) => b.count - a.count);

  return {
    headline: {
      openTotal: facts.length,
      byVendor,
      // weekly flows are merged in by the orchestrator (computeWeeklyFlows)
      newThisWeek: 0,
      returnedThisWeek: 0,
      newPrevWeek: 0,
      returnedPrevWeek: 0,
      dailySpend: round2(dailySpend),
      monthlyRunRate: round2(dailySpend * 30.4),
      avgDaysOpen: daysOpenN ? round2(daysOpenSum / daysOpenN) : null,
      over30Count,
      unknownRenterCount,
      regBlockedCount,
      potentialDailySavings: round2(potentialDailySavings),
      rightsize,
      rightsizeStages,
    },
    buckets: BUCKET_ORDER.map((bucket) => {
      const b = bucketAgg.get(bucket)!;
      return {
        bucket,
        label: BUCKET_LABELS[bucket],
        count: b.count,
        dailySpend: round2(b.dailySpend),
        cases: b.cases.sort((x, y) => (y.dailyCost ?? 0) - (x.dailyCost ?? 0)),
      };
    }),
    breakdowns: {
      byDistrict: toSorted(byDistrict).slice(0, 10),
      byClass: toSorted(byClass),
    },
  };
}

// ── Rightsize stage mapping (pure) ──
// Secured = {DONE, RETURNED} (matches SECURED_STAGES in rightsize/llm.ts).

export function stageToRightsizeCounts(stageList: string[]): {
  counts: RightsizeCounts;
  stages: Record<string, number>;
} {
  const counts: RightsizeCounts = { secured: 0, committed: 0, outstanding: 0, excused: 0 };
  const stages: Record<string, number> = {};
  for (const raw of stageList) {
    const s = String(raw ?? "").trim().toUpperCase();
    if (!s) continue;
    stages[s] = (stages[s] ?? 0) + 1;
    if (s === "DONE" || s === "RETURNED") counts.secured++;
    else if (s === "COMMITTED") counts.committed++;
    else if (s === "PASS_EXCUSED") counts.excused++;
    else counts.outstanding++;
  }
  return { counts, stages };
}

// ── Weekly flows (pure) ──
// THE single "new rental" definition: started = COALESCE(rental_start_date,
// first_seen ET date). Same definition in the rollup SQL and the backfill.
// this week = ET dates in (today-7, today]; prev week = (today-14, today-7].

export function computeWeeklyFlows(
  flows: { started: string | null; dropped: string | null }[],
  todayEt: string,
): WeeklyFlows {
  const dayMs = 86_400_000;
  const t = Date.parse(`${todayEt}T00:00:00Z`);
  const inWindow = (dateStr: string | null, fromExcl: number, toIncl: number): boolean => {
    if (!dateStr) return false;
    const d = Date.parse(`${dateStr}T00:00:00Z`);
    if (Number.isNaN(d)) return false;
    return d > fromExcl && d <= toIncl;
  };
  const wk1From = t - 7 * dayMs;
  const wk2From = t - 14 * dayMs;
  let newThisWeek = 0;
  let returnedThisWeek = 0;
  let newPrevWeek = 0;
  let returnedPrevWeek = 0;
  for (const f of flows) {
    if (inWindow(f.started, wk1From, t)) newThisWeek++;
    else if (inWindow(f.started, wk2From, wk1From)) newPrevWeek++;
    if (inWindow(f.dropped, wk1From, t)) returnedThisWeek++;
    else if (inWindow(f.dropped, wk2From, wk1From)) returnedPrevWeek++;
  }
  return { newThisWeek, returnedThisWeek, newPrevWeek, returnedPrevWeek };
}

// ── DB part (thin, not unit-tested) ──

export interface RightsizeTechRow {
  ldap: string;
  stage: string;
  stageChangedAt: string | null;
}

export async function fetchSupplementalFacts(): Promise<
  SupplementalFacts & { rightsizeTechs: RightsizeTechRow[] }
> {
  const [hires, trucks, decomm, rightsize] = await Promise.all([
    // ~84% of recently-started hires have an enterprise_id; a hire without one
    // won't be recognized as the new-hire bucket — accepted limitation.
    pool.query(`
      SELECT UPPER(enterprise_id) AS eid FROM onboarding_hires
       WHERE dropped_from_source_at IS NULL AND enterprise_id IS NOT NULL
         AND service_date >= CURRENT_DATE - 60 AND service_date <= CURRENT_DATE
    `),
    pool.query(`
      SELECT truck_number, main_status, registration_in_progress, registration_renewal_in_process,
             registration_sticker_valid, registration_expiry_date, holman_reg_expiry
        FROM fs_trucks
    `),
    pool.query(`SELECT truck_number FROM fs_decommissioning_vehicles`),
    pool.query(`SELECT ldap, stage, stage_changed_at FROM vrm_rightsize_techs`),
  ]);

  const truckByCanon = new Map<string, TruckState>();
  for (const r of trucks.rows) {
    const canon = canonTruck(r.truck_number);
    if (!canon) continue;
    truckByCanon.set(canon, {
      terminal: r.main_status === "Declined Repair" || r.main_status === "Approved for sale",
      regInProgress: r.registration_in_progress === true,
      regRenewalInProcess: r.registration_renewal_in_process === true,
      stickerValid: r.registration_sticker_valid ?? null,
      regExpiry: r.registration_expiry_date ?? null,
      holmanRegExpiry: r.holman_reg_expiry ?? null,
    });
  }

  return {
    newHireEids: new Set(hires.rows.map((r: any) => String(r.eid))),
    truckByCanon,
    decommCanon: new Set(
      decomm.rows.map((r: any) => canonTruck(r.truck_number)).filter(Boolean),
    ),
    today: new Date(),
    rightsizeTechs: rightsize.rows.map((r: any) => ({
      ldap: String(r.ldap ?? ""),
      stage: String(r.stage ?? ""),
      stageChangedAt: r.stage_changed_at ? new Date(r.stage_changed_at).toISOString() : null,
    })),
  };
}

// Weekly flows over ALL cases (returned cases carry the dropped dates).
export async function fetchWeeklyFlowRows(): Promise<
  { started: string | null; dropped: string | null }[]
> {
  const r = await pool.query(`
    SELECT COALESCE(rental_start_date::text, (first_seen_at AT TIME ZONE 'America/New_York')::date::text) AS started,
           (dropped_from_feed_at AT TIME ZONE 'America/New_York')::date::text AS dropped
      FROM vrm_rental_operations_cases
  `);
  return r.rows.map((x: any) => ({ started: x.started ?? null, dropped: x.dropped ?? null }));
}
