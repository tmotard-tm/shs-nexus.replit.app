# VRM Executive Summary Dashboard — Implementation Plan

**Spec (source of truth):** `docs/specs/2026-07-26-vrm-executive-summary-design.md`
**Date:** 2026-07-26

## Goal

A new VRM page (`/vehicle-rental-management/executive-summary`) that answers "where are we on rentals" from every angle: headline KPIs, 90-day trends, the 8-bucket "why is this rental still open" breakdown, rule-based insight cards with in-page drill-down drawers, and a fail-soft AI brief. Backed by one new rollup table (`vrm_exec_daily_metrics`), one cached endpoint (`GET /api/vrm/executive-summary`), and a one-time flag-guarded backfill.

## Architecture (locked by research — do not re-derive)

- **Fact source = the ops page's own read layer.** `getRentalOpsMaster()` (`server/vrm/rental-operations/read-repository.ts`, line ~541, signature `(opts?: { includeDropped?: boolean }) => Promise<MasterModel>`) already returns per-case `employee_status` ('Active'/'Terminated'/'On Leave'/'Pending' — full words), `identity_state` ('RESOLVED'/'REVIEW'/'EXCEPTION'), reconciled `has_open_repair`, `repairs_complete` ('Yes'/'No'/null), `days_open`, `days_authorized`, `rental_vendor`, `daily_cost`, `class_bucket`, `tech_district`, `employee_id`, `number_of_extensions`. Reusing it guarantees the exec page and the ops page never disagree. Do NOT write a parallel master query.
- **Three small supplemental queries** provide what MasterRow lacks: new-hire enterprise IDs (`onboarding_hires`), truck registration/terminal state (`fs_trucks`), decommissioning membership (`fs_decommissioning_vehicles`).
- **New module:** `server/vrm/executive-summary/` — `buckets.ts` (pure classifier), `metrics.ts` (facts assembly + aggregates), `insights.ts` (6 pure rules), `rollup.ts` (daily upsert + ingest hook), `backfill.ts` (one-time history reconstruction), `brief.ts` (Bedrock AI brief), `routes.ts`. Registered via `registerExecutiveSummaryRoutes(router)` inside `registerVrmRoutes()` in `server/vrm/routes.ts` (`requireAuth` is applied globally to the VRM router — no per-route auth needed).
- **DDL** is raw SQL added to `initVrmSchema` in `server/vrm/init-schema.ts` (NOT drizzle-kit — `db:push` is blocked/dangerous in this repo).
- **AI** reuses `invokeBedrock(systemPrompt, userPrompt, {modelId?, maxTokens?, label?}) → {text, modelId, usage}` exported from `server/vrm/rightsize/llm.ts` (throws on failure; needs `AWS_BEARER_TOKEN_BEDROCK`). Wrap in try/catch → fail-soft null.
- **DB access:** `import { db, pool } from "../../db"` from inside `server/vrm/executive-summary/`. Prefer `pool.query(...)` for plain parameterized SQL.
- **App-settings flag helpers:** `getBooleanSetting(key, fallback)` / `setSetting(key, value, updatedBy?)` from `server/app-settings.ts`.
- **Tests:** `node:test` + `node:assert/strict`, run with `npx tsx --test tests/<file>.test.ts`. Pure functions only — no DB in tests.
- **Typecheck baseline:** the repo has ~224 pre-existing `npm run check` errors. Your changes must add ZERO new ones. Run tsc via a workflow (bash background procs die when the tool call returns — see below).

### Verified data facts (dev DB, 2026-07-26 — encode these, don't re-query)

- `employee_status` values: `Active` (394), `Terminated` (8), `On Leave` (5), `Pending` (2), null (15 unresolved). Matchers must ALSO tolerate raw single-letter codes T/L/P/S defensively.
- `repairs_complete`: `'Yes'` / `'No'` / null → affirmative = `/^y/i`.
- `fs_trucks.main_status` terminal values: `'Declined Repair'` (77), `'Approved for sale'` (1).
- Decomm table: `fs_decommissioning_vehicles` (492 rows; has `truck_number`, `decom_done`). Membership alone ⇒ declined/decom bucket.
- Registration fields on `fs_trucks`: `registration_in_progress` / `registration_renewal_in_process` (bool), `registration_sticker_valid` (free text — `'Expired'`, `'Yes'`, `'Contacted tech'`…), `registration_expiry_date` + `holman_reg_expiry` (US-format strings `'8/31/2026'`).
- `onboarding_hires.enterprise_id` fill: 133 of 159 recently-started hires (~84%). A hire without an enterprise ID won't be recognized as bucket 3 — accepted limitation, note in code comment.
- `vrm_rightsize_techs.stage` values: NON_RESPONDER, QUESTION, COMMITTED, PUSHBACK_STOCK/EQUIP/PROCESS, DONE, RETURNED, PASS_EXCUSED. Secured = {DONE, RETURNED} (matches `SECURED_STAGES` in `rightsize/llm.ts`).
- `vrm_rental_operations_import_runs` has MULTIPLE completed runs per day → daily rollup keys on ET date, last write wins.
- Truck-number joins: strip leading zeros on BOTH sides (`case_key` is 5-padded; `fs_trucks.truck_number` may not be).
- ET dates everywhere: `new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" })` → `YYYY-MM-DD`.

### Out of scope (do not touch)

- Any change to the existing Rental Operations page (drill-downs are an exec-page-local drawer).
- `package.json`, `vite.config.ts`, `server/vite.ts`, `drizzle.config.ts`, drizzle-kit push.
- Prod DB writes; scheduled deployments (rollup rides the existing ingest + lazy upsert).

---

## Task 1 — Rollup table DDL + drizzle type truth

**Files:** modify `server/vrm/init-schema.ts`, modify `shared/vrm-schema.ts`.

Add to `initVrmSchema`, following the existing `CREATE TABLE IF NOT EXISTS` blocks (column names per spec):

```sql
CREATE TABLE IF NOT EXISTS vrm_exec_daily_metrics (
  metric_date DATE PRIMARY KEY,
  open_total INTEGER NOT NULL DEFAULT 0,
  open_by_vendor JSONB NOT NULL DEFAULT '{}'::jsonb,
  new_count INTEGER NOT NULL DEFAULT 0,
  returned_count INTEGER NOT NULL DEFAULT 0,
  daily_spend NUMERIC(12,2) NOT NULL DEFAULT 0,
  potential_savings NUMERIC(12,2),
  avg_days_open NUMERIC(8,2),
  over_30_count INTEGER,
  rightsize_stages JSONB,
  bucket_counts JSONB,
  insight_counts JSONB,
  ai_brief TEXT,
  ai_brief_generated_at TIMESTAMPTZ,
  source VARCHAR(16) NOT NULL DEFAULT 'live',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
```

- `rightsize_stages` = full stage→count map (NON_RESPONDER…PASS_EXCUSED), not a condensed 4-way — the condensing happens at read time so historical charts survive stage-taxonomy changes.
- `bucket_counts` / `insight_counts` / `avg_days_open` / `over_30_count` / `potential_savings` are nullable on purpose: backfilled rows can't reconstruct person-status buckets or per-case rates reliably (`source='backfill'`, nulls → chart renders a gap, never fake zeros).

Also add the matching drizzle table definition `vrmExecDailyMetrics` to `shared/vrm-schema.ts` for **type truth only** (DDL is owned by `initVrmSchema`; never drizzle-kit push — mirror how other `vrm_*` tables are declared there).

**Verify:** restart `Start application`; then confirm the table exists via a throwaway script (`scripts/tmp-check.ts` importing `../server/db` pool → `SELECT column_name FROM information_schema.columns WHERE table_name='vrm_exec_daily_metrics'`; run `npx tsx scripts/tmp-check.ts`; delete the script).

**Commit:** `vrm exec summary: add vrm_exec_daily_metrics rollup table`

---

## Task 2 — Pure bucket classifier (TDD)

**Files:** create `server/vrm/executive-summary/buckets.ts`, create `tests/vrm-exec-buckets.test.ts`.

Write the test FIRST, watch it fail (module missing), then implement.

`buckets.ts` exports:

```ts
export type ExecBucket =
  | "terminated" | "loa" | "new_hire" | "declined_decom"
  | "in_repair" | "repair_done_reg_dead" | "repair_done_no_blocker" | "no_repair_activity";

export const BUCKET_ORDER: ExecBucket[] = [
  "terminated", "loa", "new_hire", "declined_decom",
  "in_repair", "repair_done_reg_dead", "repair_done_no_blocker", "no_repair_activity",
];

export const BUCKET_LABELS: Record<ExecBucket, string> = {
  terminated: "Terminated renter",
  loa: "Renter on leave",
  new_hire: "New hire (≤60 days)",
  declined_decom: "Declined / decommissioning",
  in_repair: "Repair in progress",
  repair_done_reg_dead: "Repair done — registration dead",
  repair_done_no_blocker: "Repair done — no blocker",
  no_repair_activity: "No repair activity",
};

export function normalizeVendor(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
  if (!s) return "Unknown";
  if (/hertz/i.test(s)) return "Hertz";
  if (/avis/i.test(s)) return "Avis";
  if (/enterprise/i.test(s)) return "Enterprise";
  return s.replace(/\s+/g, " ");
}

export function isTerminatedStatus(s: string | null | undefined): boolean {
  const t = String(s ?? "").trim();
  return !!t && (/^t$/i.test(t) || /term/i.test(t));
}

export function isLoaStatus(s: string | null | undefined): boolean {
  const t = String(s ?? "").trim();
  return !!t && (/^[lps]$/i.test(t) || /leave|loa/i.test(t));
}

export interface TruckRegFacts {
  regInProgress: boolean;
  regRenewalInProcess: boolean;
  stickerValid: string | null;     // free text: 'Expired', 'Yes', 'Contacted tech'…
  regExpiry: string | null;        // 'M/D/YYYY'
  holmanRegExpiry: string | null;  // 'M/D/YYYY'
}

export function parseUsDate(s: string | null | undefined): Date | null {
  const m = String(s ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[3], +m[1] - 1, +m[2]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function isRegBlocked(t: TruckRegFacts | null | undefined, today: Date): boolean {
  if (!t) return false;
  if (t.regInProgress || t.regRenewalInProcess) return true;
  if (/expired/i.test(String(t.stickerValid ?? ""))) return true;
  const exp = parseUsDate(t.regExpiry) ?? parseUsDate(t.holmanRegExpiry);
  return !!exp && exp.getTime() < today.getTime();
}

export interface CaseFacts {
  caseKey: string;
  vehicleNumber: string;
  vendor: string;                 // already normalized
  dailyCost: number | null;
  daysOpen: number | null;
  daysBehind: number | null;      // days_open - days_authorized when both present
  extensions: number | null;
  identityResolved: boolean;      // identity_state === 'RESOLVED'
  employeeId: string | null;
  employeeStatus: string | null;
  techName: string | null;
  techDistrict: string | null;
  classBucket: string;            // MasterRow.class_bucket
  isNewHire: boolean;
  truckTerminal: boolean;
  hasOpenRepairPo: boolean;       // MasterRow.has_open_repair === true (reconciled)
  repairComplete: boolean;        // /^y/i on repairs_complete
  regBlocked: boolean;
}

export function classifyBucket(f: CaseFacts): { bucket: ExecBucket; unknownRenter: boolean } {
  const unknownRenter = !f.identityResolved;
  if (f.identityResolved) {
    if (isTerminatedStatus(f.employeeStatus)) return { bucket: "terminated", unknownRenter };
    if (isLoaStatus(f.employeeStatus)) return { bucket: "loa", unknownRenter };
    if (f.isNewHire) return { bucket: "new_hire", unknownRenter };
  }
  if (f.truckTerminal) return { bucket: "declined_decom", unknownRenter };
  if (f.hasOpenRepairPo) return { bucket: "in_repair", unknownRenter };
  if (f.repairComplete) {
    return { bucket: f.regBlocked ? "repair_done_reg_dead" : "repair_done_no_blocker", unknownRenter };
  }
  return { bucket: "no_repair_activity", unknownRenter };
}
```

**Tests** (`tests/vrm-exec-buckets.test.ts`, `import { test } from "node:test"; import assert from "node:assert/strict";`):

- Precedence ladder: a facts object hitting every rung (terminated wins over LOA/repair; LOA over new-hire; new-hire over truck state; declined over in-repair; in-repair over repair-done; reg split; catch-all).
- Unresolved renter (`identityResolved:false`) with a Terminated-looking status string still lands in a TRUCK-state bucket + `unknownRenter:true` (person facts don't apply when unresolved).
- Status matchers: `'Terminated'`, `'TERM'`, `'T'` → terminated; `'On Leave'`, `'LOA'`, `'L'`, `'P'`, `'S'` → LOA; `'Active'`, `'Pending'`, `''`, null → neither.
- `normalizeVendor`: `'ENTERPRISE RENT-A-CAR'`→`Enterprise`, `'Hertz Corp'`→`Hertz`, `'AVIS'`→`Avis`, null/`''`→`Unknown`, `'Joe's  Rentals'`→`"Joe's Rentals"`.
- `isRegBlocked`: each trigger independently; expired `holman_reg_expiry` fallback when `registration_expiry_date` null; `'10/31/2025'` < today=2026-07-26 → true; future date → false; garbage date string → false; null truck → false.
- `parseUsDate('8/31/2026')` round-trips; rejects `'2026-08-31'`.

**Verify:** `npx tsx --test tests/vrm-exec-buckets.test.ts` — all pass.

**Commit:** `vrm exec summary: pure bucket classifier + vendor/status/reg matchers (TDD)`

---

## Task 3 — Facts assembly + aggregates (`metrics.ts`, TDD for pure parts)

**Files:** create `server/vrm/executive-summary/metrics.ts`, create `tests/vrm-exec-metrics.test.ts`.

### Pure part (test first)

```ts
import type { MasterRow } from "../rental-operations/read-repository";
import { classifyBucket, normalizeVendor, isRegBlocked, CaseFacts, ExecBucket,
         BUCKET_ORDER, BUCKET_LABELS, TruckRegFacts } from "./buckets";

export const SEDAN_FLOOR = 54.99;

export const canonTruck = (s: string | null | undefined) =>
  String(s ?? "").replace(/\D/g, "").replace(/^0+/, "");

export interface TruckState extends TruckRegFacts { terminal: boolean }

export interface SupplementalFacts {
  newHireEids: Set<string>;               // upper-cased enterprise IDs, started ≤60d ago
  truckByCanon: Map<string, TruckState>;  // fs_trucks keyed by canonical number
  decommCanon: Set<string>;               // fs_decommissioning_vehicles canonical numbers
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
      daysBehind: r.days_open != null && r.days_authorized != null ? r.days_open - r.days_authorized : null,
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
```

Aggregation (also pure):

```ts
export interface ExecCaseRow {  // drill-down row shape shared with the client
  caseKey: string; vehicleNumber: string; techName: string | null; vendor: string;
  dailyCost: number | null; daysOpen: number | null; bucket: ExecBucket;
  regBlocked: boolean; unknownRenter: boolean;
}

export interface RightsizeCounts { secured: number; committed: number; outstanding: number; excused: number }

export interface ExecSummaryPayload {
  generatedAt: string;
  headline: {
    openTotal: number;
    byVendor: Record<string, number>;
    newThisWeek: number;            // rental_start_date (fallback first_seen_at) in last 7 ET days
    returnedThisWeek: number;       // dropped_from_feed_at in last 7 ET days
    newPrevWeek: number;            // days 8-14 back — client renders the vs-prior-week delta
    returnedPrevWeek: number;
    dailySpend: number;             // sum of dailyCost over open cases (nulls = 0)
    monthlyRunRate: number;         // dailySpend * 30.4
    avgDaysOpen: number | null;     // mean of non-null daysOpen
    over30Count: number;            // daysOpen > 30
    unknownRenterCount: number;
    regBlockedCount: number;
    potentialDailySavings: number;  // Σ max(0, dailyCost - SEDAN_FLOOR) where classBucket is van/minivan-like
    rightsize: RightsizeCounts;     // condensed 4-way; full stage map lives in rightsizeStages
    rightsizeStages: Record<string, number>; // raw stage → count
  };
  buckets: { bucket: ExecBucket; label: string; count: number; dailySpend: number; cases: ExecCaseRow[] }[];
  breakdowns: {
    byDistrict: { key: string; count: number; dailySpend: number }[];  // top 10 by count
    byClass: { key: string; count: number; dailySpend: number }[];
  };
  insights: InsightCard[];      // Task 4
  trends: TrendPoint[];         // Task 5 (from vrm_exec_daily_metrics)
  aiBrief: { text: string; generatedAt: string } | null;
}

export function aggregateSummary(
  facts: CaseFacts[],
  rightsize: RightsizeCounts,
): Pick<ExecSummaryPayload, "headline" | "buckets" | "breakdowns"> { /* fold over classifyBucket(f) */ }
```

Van/minivan-like class test for savings: `/van|truck|pickup|suv/i.test(classBucket)` — and add a unit test pinning it against the actual `class_bucket` strings (read the `vehicleCategory` values in `read-repository.ts` while implementing and match them exactly; adjust the regex to the real bucket names, then pin with tests).

Rightsize mapping (pure): `stageToRightsizeCounts(stages: string[])` — DONE/RETURNED→secured, COMMITTED→committed, PASS_EXCUSED→excused, everything else (NON_RESPONDER, QUESTION, PUSHBACK_*)→outstanding. Also return the raw stage→count map for `rightsizeStages`.

Weekly flows (pure, per spec — unit-test the window edges): `computeWeeklyFlows(flows: { started: string | null; dropped: string | null }[], todayEt: string)` → `{ newThisWeek, returnedThisWeek, newPrevWeek, returnedPrevWeek }` where "this week" = ET dates in `(today-7, today]` and "prev week" = `(today-14, today-7]`; `started` = `rental_start_date` with `first_seen_at` ET-date fallback. Feed it with one cheap query over ALL cases (not just open — returned cases have dropped dates):

```sql
SELECT COALESCE(rental_start_date::text, (first_seen_at AT TIME ZONE 'America/New_York')::date::text) AS started,
       (dropped_from_feed_at AT TIME ZONE 'America/New_York')::date::text AS dropped
  FROM vrm_rental_operations_cases;
```

### DB part (thin, not unit-tested)

```ts
export async function fetchSupplementalFacts(): Promise<SupplementalFacts & { rightsizeTechs: { ldap: string; stage: string; stageChangedAt: string | null }[] }>
```

Three queries via `pool.query`:

```sql
SELECT UPPER(enterprise_id) AS eid FROM onboarding_hires
 WHERE dropped_from_source_at IS NULL AND enterprise_id IS NOT NULL
   AND service_date >= CURRENT_DATE - 60 AND service_date <= CURRENT_DATE;

SELECT truck_number, main_status, registration_in_progress, registration_renewal_in_process,
       registration_sticker_valid, registration_expiry_date, holman_reg_expiry
  FROM fs_trucks;

SELECT truck_number FROM fs_decommissioning_vehicles;
```

plus `SELECT ldap, stage, stage_changed_at FROM vrm_rightsize_techs`.
`terminal` = `main_status IN ('Declined Repair','Approved for sale')`.

`getExecutiveSummary(): Promise<ExecSummaryPayload>` orchestrates: `getRentalOpsMaster()` → `buildCaseFacts` → `aggregateSummary` → insights (Task 4) → trends + brief lookup (Tasks 5/7).

**Tests** (`tests/vrm-exec-metrics.test.ts`): `buildCaseFacts` join behavior (5-padded case_key `'01234'` matches truck `'1234'`; decomm membership sets truckTerminal; missing truck → regBlocked false), aggregate math (spend sum with nulls, savings floor only on van-like classes and never negative, vendor split, bucket counts sum to openTotal), `stageToRightsizeCounts` full stage list.

**Verify:** `npx tsx --test tests/vrm-exec-metrics.test.ts` and re-run the Task 2 test file.

**Commit:** `vrm exec summary: case-facts assembly + summary aggregation (TDD)`

---

## Task 4 — Insight rules (`insights.ts`, TDD)

**Files:** create `server/vrm/executive-summary/insights.ts`, create `tests/vrm-exec-insights.test.ts`.

```ts
export interface InsightCard {
  id: string; title: string; severity: "high" | "medium" | "info";
  count: number; dailyImpact: number; description: string; caseKeys: string[];
}

export function buildInsights(
  facts: CaseFacts[],
  classified: Map<string, { bucket: ExecBucket; unknownRenter: boolean }>, // by caseKey
  rightsizeTechs: { ldap: string; stage: string; stageChangedAt: string | null }[],
  now: Date,
): InsightCard[]
```

Six rules, exactly as spec'd (cards with count 0 are omitted):

1. `long_runners` — `daysOpen > 45`; ranked by `dailyCost` desc; impact = Σ dailyCost; severity high.
2. `rightsize_uncovered` — resolved renter with employeeId, van/minivan-like classBucket, `!rightsizeLdapSet.has(employeeId)` (LDAP set upper-cased); impact = Σ max(0, dailyCost − SEDAN_FLOOR); severity medium.
3. `rightsize_stalled` — from `rightsizeTechs`: COMMITTED with `stageChangedAt` older than 14 days (null stageChangedAt counts as stalled), plus NON_RESPONDER count in the description; caseKeys empty (tech-level, not case-level); severity medium.
4. `extension_pileups` — `(extensions ?? 0) >= 3 || (daysBehind ?? 0) > 0`; severity medium.
5. `unknown_renters` — `unknownRenter` true; impact = Σ dailyCost; severity high (nobody accountable).
6. `new_hire_aging` — bucket `new_hire` && `daysOpen > 45` (new hire still on a rental past the provisioning window); severity info.

**Tests:** one focused test per rule (inclusion + exclusion boundary: 45 vs 46 days, 2 vs 3 extensions, 13 vs 15 day stall), plus zero-count omission.

**Verify:** `npx tsx --test tests/vrm-exec-insights.test.ts`.

**Commit:** `vrm exec summary: 6 rule-based insight cards (TDD)`

---

## Task 5 — Daily rollup writer + ingest hook (`rollup.ts`)

**Files:** create `server/vrm/executive-summary/rollup.ts`; modify `server/vrm/rental-operations/ingest.ts`.

```ts
export function etToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export interface TrendPoint {
  date: string; openTotal: number; openByVendor: Record<string, number>;
  newCount: number; returnedCount: number; dailySpend: number;
  bucketCounts: Record<string, number> | null;
  rightsizeStages: Record<string, number> | null; source: string;
}

export async function upsertTodayExecMetrics(): Promise<void>
```

`upsertTodayExecMetrics` computes the live summary (reuse `getRentalOpsMaster` + Task 3 pieces — NOT the route cache), plus today's flows straight off the cases table.

**One "new rental" definition everywhere (architect finding):** new = `COALESCE(rental_start_date, first_seen_at ET date)` — the spec's fallback rule. This exact definition is used in all three sites: the headline `computeWeeklyFlows` (Task 3), this rollup SQL, and the backfill's `started` attribution (Task 6). Never count "new" off `first_seen_at` alone, or the KPI and the trend bars on the same page disagree whenever the feed picks a case up late.

```sql
SELECT
  COUNT(*) FILTER (WHERE COALESCE(rental_start_date,
    (first_seen_at AT TIME ZONE 'America/New_York')::date) = $1::date)::int AS new_count,
  COUNT(*) FILTER (WHERE (dropped_from_feed_at AT TIME ZONE 'America/New_York')::date = $1::date)::int AS returned_count
FROM vrm_rental_operations_cases;
```

Upsert (never clobbers the AI brief — `ai_brief` is deliberately absent from the UPDATE set):

```sql
INSERT INTO vrm_exec_daily_metrics
  (metric_date, open_total, open_by_vendor, new_count, returned_count, daily_spend,
   potential_savings, avg_days_open, over_30_count, rightsize_stages, bucket_counts,
   insight_counts, source)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'live')
ON CONFLICT (metric_date) DO UPDATE SET
  open_total=EXCLUDED.open_total, open_by_vendor=EXCLUDED.open_by_vendor,
  new_count=EXCLUDED.new_count, returned_count=EXCLUDED.returned_count,
  daily_spend=EXCLUDED.daily_spend, potential_savings=EXCLUDED.potential_savings,
  avg_days_open=EXCLUDED.avg_days_open, over_30_count=EXCLUDED.over_30_count,
  rightsize_stages=EXCLUDED.rightsize_stages, bucket_counts=EXCLUDED.bucket_counts,
  insight_counts=EXCLUDED.insight_counts, source='live', updated_at=now();
```

(`insight_counts` = rule id → count from the built insight cards; `bucket_counts` = bucket id → count.)

`getTrends(): Promise<TrendPoint[]>` — `SELECT … FROM vrm_exec_daily_metrics ORDER BY metric_date` (no days parameter — the endpoint always serves the full series, a few hundred small rows, and the 30/90/180/all range selector is client-side slicing; this also avoids a UTC-vs-ET `CURRENT_DATE` subtlety). `TrendPoint` carries `date, openTotal, openByVendor, newCount, returnedCount, dailySpend, bucketCounts, rightsizeStages, source`.

**Ingest hook** — in `server/vrm/rental-operations/ingest.ts`, at the END of `persistRentalCases`, immediately after the existing `upsertSourceHealth(...)` call (post `status='completed'` update, ~line 463). Dynamic import avoids module cycles; failure must NEVER fail the ingest:

```ts
try {
  const { upsertTodayExecMetrics } = await import("../executive-summary/rollup");
  await upsertTodayExecMetrics();
} catch (e) {
  console.error("[vrm-exec] daily rollup after ingest failed (non-fatal):", (e as Error)?.message);
}
```

Lazy safety net: the GET route (Task 7) also upserts today's row from the payload it just computed when today's row is missing or older than 6h — so a day with no ingest still gets a data point when anyone opens the page. (Autoscale reality: no in-process timers — see replit.md.)

**Verify:** restart app; trigger `POST /api/vrm/rental-operations/sync` OR call `upsertTodayExecMetrics()` from a throwaway `scripts/tmp-rollup.ts`; confirm a `source='live'` row for today via SQL; delete the script.

**Commit:** `vrm exec summary: daily metrics rollup + post-ingest hook`

---

## Task 6 — One-time backfill (`backfill.ts`, TDD for reconstruction)

**Files:** create `server/vrm/executive-summary/backfill.ts`, create `tests/vrm-exec-backfill.test.ts`; modify the boot site that calls `initVrmSchema()` (in `server/index.ts` post-listen bootstrap — find the `initVrmSchema` call and add after it).

Pure reconstruction (test first):

```ts
export interface CaseLifecycle {
  firstSeen: string;          // ET date 'YYYY-MM-DD' of first_seen_at — drives the OPEN interval
  started: string;            // COALESCE(rental_start_date, firstSeen) — drives NEW attribution
                              // (the single "new rental" definition — see Task 5)
  dropped: string | null;     // ET date or null
  vendor: string;             // normalized
  rate: number | null;
}
export interface BackfillRow {
  date: string; openTotal: number; openByVendor: Record<string, number>;
  newCount: number; returnedCount: number; dailySpend: number;
  rightsizeStages: Record<string, number> | null;   // filled by replayRightsizeStages
}
export function reconstructDailyHistory(cases: CaseLifecycle[], startDate: string, endDate: string): BackfillRow[]
```

Day `d` semantics: open = `firstSeen <= d && (dropped == null || dropped > d)` (tracking-based — a case isn't "open" in our history before the feed saw it); new = `started === d` (the COALESCE definition; a `started` before the backfill window start attributes to no day — don't clamp it to day one, that would fake a spike); returned = `dropped === d` (string compare works on ISO dates). Honest-history caveat: cases that opened AND closed before tracking began are invisible — early rows undercount; that's fine, the spec accepts reconstructed-from-lifecycle history and the chart labels backfill rows by `source`.

Two spec-mandated refinements layered on top of the lifecycle math (both pure, both tested):

- **Import-run totals win for `open_total`.** `applyImportRunTotals(rows: BackfillRow[], runsByDate: Map<string, number>)` — for each ET date that has a completed `vrm_rental_operations_import_runs` row (multiple runs/day exist → take the LAST completed by `started_at`), override the lifecycle-derived `openTotal` with that run's `total_cases`. Lifecycle math remains the interpolation for run-less days. Query: `SELECT (started_at AT TIME ZONE 'America/New_York')::date::text AS d, total_cases, started_at FROM vrm_rental_operations_import_runs WHERE status='completed' AND total_cases IS NOT NULL`.
- **Right-size stage replay.** `replayRightsizeStages(events: { ldap: string; newStage: string; at: string }[], dates: string[])` — fold `vrm_rightsize_events` (`SELECT ldap, new_stage, (created_at AT TIME ZONE 'America/New_York')::date::text AS at … ORDER BY created_at`) into a per-date stage→count map (latest stage per ldap as of that date; techs with no event yet are absent, not faked). Fills `rightsize_stages` on backfill rows; dates before the first event stay null.

Runner:

```ts
export async function runExecBackfillOnce(): Promise<void> {
  const FLAG = "vrm_exec_metrics_backfilled";
  if (await getBooleanSetting(FLAG, false)) return;
  // lifecycles: SELECT (first_seen_at AT TIME ZONE 'America/New_York')::date::text AS first_seen,
  //   (dropped_from_feed_at AT TIME ZONE 'America/New_York')::date::text AS dropped,
  //   rental_vendor, rate_authorized FROM vrm_rental_operations_cases
  // start = min(first_seen); end = yesterday ET. If no cases: set flag, return.
  // reconstructDailyHistory → applyImportRunTotals → replayRightsizeStages
  // INSERT … source='backfill', bucket_counts/insight_counts/avg_days_open/over_30_count/potential_savings NULL
  // ON CONFLICT (metric_date) DO NOTHING  ← never overwrite a live row
  await setSetting(FLAG, true, "system");
}
```

Boot wiring (after `initVrmSchema()` in the post-listen bootstrap — must not block `server.listen`, which it can't from there, and must not throw):

```ts
runExecBackfillOnce().catch((e) => console.error("[vrm-exec] backfill failed:", (e as Error)?.message));
```

**Tests:** 3-case fixture spanning open/close/reopen-free lifecycles — assert per-day open counts across boundaries (dropped day itself counts as open? No: `dropped > d` means the drop day is NOT open — pin that), new/returned attribution, vendor splits, spend sums, single-day range, empty input → []. Plus: `applyImportRunTotals` overrides only dates with a run (spec's "backfill sanity" check is exactly this — rollup rows matching import-run totals for the same dates); `replayRightsizeStages` latest-stage-per-ldap semantics and null-before-first-event.

**Verify:** `npx tsx --test tests/vrm-exec-backfill.test.ts`; restart app; SQL-check `SELECT count(*), min(metric_date), max(metric_date) FROM vrm_exec_daily_metrics WHERE source='backfill'` and that the flag is set; restart again and confirm no duplicate work (log silence).

**Commit:** `vrm exec summary: one-time flag-guarded trend backfill (TDD)`

---

## Task 7 — Routes + AI brief (`routes.ts`, `brief.ts`)

**Files:** create `server/vrm/executive-summary/routes.ts`, `server/vrm/executive-summary/brief.ts`; modify `server/vrm/routes.ts` (import + `registerExecutiveSummaryRoutes(router);` next to `registerRentalOperationsRoutes(router)`).

`brief.ts` — fail-soft Bedrock narrative:

```ts
export async function generateExecBrief(payload: ExecSummaryPayload): Promise<string | null> {
  try {
    const { invokeBedrock } = await import("../rightsize/llm");
    const system =
      "You write a short executive brief (2-3 plain-language paragraphs, no markdown headers) " +
      "for a fleet rental dashboard. Use ONLY the JSON metrics given. Lead with the biggest " +
      "dollar lever, name concrete counts, end with the top recommended action.";
    const compact = { headline: payload.headline,
      buckets: payload.buckets.map(b => ({ bucket: b.bucket, count: b.count, dailySpend: b.dailySpend })),
      insights: payload.insights.map(i => ({ id: i.id, count: i.count, dailyImpact: i.dailyImpact })) };
    const r = await invokeBedrock(system, JSON.stringify(compact), { maxTokens: 700, label: "exec-brief" });
    return r.text || null;
  } catch (e) {
    console.error("[vrm-exec] brief generation failed (fail-soft):", (e as Error)?.message);
    return null;
  }
}
```

Persistence: `UPDATE vrm_exec_daily_metrics SET ai_brief=$1, ai_brief_generated_at=now() WHERE metric_date=$2` (today ET; row guaranteed by the lazy upsert running first).

`routes.ts`:

```ts
let cache: { at: number; payload: ExecSummaryPayload } | null = null;
const TTL_MS = 5 * 60_000;

export function registerExecutiveSummaryRoutes(router: Router): void {
  router.get("/executive-summary", async (req, res) => {
    try {
      const force = req.query.refresh === "true";
      if (!force && cache && Date.now() - cache.at < TTL_MS) return res.json(cache.payload);
      const payload = await getExecutiveSummary();     // includes trends + today's stored aiBrief
      cache = { at: Date.now(), payload };
      // lazy rollup safety net (fire-and-forget, guarded inside)
      void upsertTodayIfStale(payload).catch(() => {});
      // once-per-day auto-brief: if today's row has no brief, generate in background;
      // this request returns aiBrief:null and the next load shows it.
      void maybeGenerateBriefOnce(payload).catch(() => {});
      res.json(payload);
    } catch (e) {
      // Bounded-stale fallback (known Neon-WS-drop pattern): a transient failure on this
      // heavy aggregator serves the last good payload (≤30 min old) instead of erroring.
      if (cache && Date.now() - cache.at < 30 * 60_000) {
        return res.json({ ...cache.payload, stale: true });
      }
      console.error("[vrm-exec] summary failed:", e);
      res.status(500).json({ error: (e as Error)?.message ?? "executive summary failed" });
    }
  });

  router.post("/executive-summary/brief", async (req, res) => {
    const role = (req.user as any)?.role;
    if (!["admin", "developer"].includes(String(role ?? ""))) {
      return res.status(403).json({ error: "admin only" });
    }
    // regenerate synchronously, store, invalidate cache, return { text }
  });
}
```

`maybeGenerateBriefOnce` must be self-deduping (module-level `briefInFlight` boolean + re-check the DB row before writing) so parallel page loads can't double-invoke Bedrock. **Accepted cross-instance race (deliberate decision, do not "fix"):** the dedupe is per-instance; on autoscale, two cold instances could each generate once. Worst case = one duplicate Bedrock call, last write wins — cheaper than adding an advisory lock, and consistent with the spec's per-instance cache allowance. Same accepted-per-instance caveat applies to the 5-minute route cache and the stale fallback. If `AWS_BEARER_TOKEN_BEDROCK` is unset, `invokeBedrock` throws → caught → brief stays null → UI hides the section (never an error banner).

`getExecutiveSummary()` (metrics.ts) fills `trends` from `getTrends()` (full series; client slices ranges) and `aiBrief` from today's row.

**Per-section degradation (spec requirement):** inside `getExecutiveSummary()`, wrap each independent group — supplemental facts, rightsize, trends, weekly flows — in its own try/catch. A failed group returns its section as `null` plus an entry in a `payload.sectionErrors: Record<string, string>` map; the core master-based sections still render. Only a failure of `getRentalOpsMaster()` itself throws (→ the stale-cache fallback above).

**Verify:** restart app; auth-gated routes can't be curled without a session, so check via throwaway script `scripts/tmp-exec-check.ts` calling `getExecutiveSummary()` directly — print `headline`, per-bucket counts (expect bucket counts to sum to openTotal ≈ 387-ish, Enterprise ≈ 371, Hertz ≈ 10, Avis ≈ 6 per dev data), insights ids, trends length; delete script. Confirm no route-registration regression: existing `/api/vrm/*` pages still load (Start application logs clean — remember the startup-route-registration trap: registration itself must not await anything).

**Commit:** `vrm exec summary: cached summary endpoint + fail-soft Bedrock brief`

---

## Task 8 — Frontend page + navigation

**Files:** create `client/src/pages/vehicle-rental-management/pages/ExecutiveSummary.tsx`; modify `client/src/pages/vehicle-rental-management/RouteReadyLayout.tsx` (add `<Route path="/vehicle-rental-management/executive-summary" component={ExecutiveSummary} />`, mirroring the existing import style of sibling pages); modify `client/src/pages/vehicle-rental-management/lib/constants.ts` (add `{ label: "Executive Summary", path: "/vehicle-rental-management/executive-summary", icon: BarChart3 }` as the FIRST `navItems` entry; import `BarChart3` from `lucide-react`).

Access inherits the existing VRM gate (`sidebar.vehicleRentalManagement` via `VRMProtectedRoute`) — no new permission key.

Page structure (single file; use `colors` from `../lib/constants` for ALL colors — no hardcoded hex; recharts is already a dependency):

```tsx
const { data, isLoading, refetch, isFetching } = useQuery<ExecSummaryPayload>({
  queryKey: ["/api/vrm/executive-summary"],
  refetchInterval: 300000,
});
```

(Declare a local `ExecSummaryPayload` interface mirroring the server type — VRM pages don't share server types today; keep field names identical.)

- **Header:** title, `generatedAt` freshness line, vendor filter pills (All / Enterprise / Hertz / Avis / Other — client-side filter recomputing counts from `buckets[].cases`, which carry every case row), Refresh button (`refetch` with `?refresh=true` via `apiRequest` on a small mutation, or simply `queryClient.invalidateQueries`).
- **Row 1 — KPI cards:** open total (w/ vendor split), new/returned this week with vs-prior-week delta arrows, daily spend + monthly run-rate, potential daily savings, average days open + over-30 count, unknown-renter count, reg-blocked count, right-size funnel (secured/committed/outstanding/excused).
- **Row 2 — Trends:** client-side range selector (30 / 90 / 180 / all — slices the full `trends` series). Charts via recharts `ResponsiveContainer`: (a) `ComposedChart` — `Area` openTotal (stackable by vendor from `openByVendor`), `Line` dailySpend (right axis); (b) weekly new-vs-returned bars (aggregate daily `newCount`/`returnedCount` into ISO weeks client-side); (c) bucket mix over time (stacked area from `bucketCounts`, live rows only — null rows render gaps); (d) right-size stage mix over time (stacked area from `rightsizeStages`). Backfill points get reduced-opacity treatment via `source`.
- **Row 3 — Buckets:** 8 clickable cards in `BUCKET_ORDER` (count + daily spend + one-line label); click opens the drill-down drawer.
- **Row 4 — Breakdowns:** top-10 district bar chart + class split.
- **Row 5 — Insight cards:** severity-tinted cards (title, count, `$X/day` impact, description); click opens the drawer filtered to `caseKeys`.
- **AI brief:** rendered only when `aiBrief` is non-null (plain paragraphs); admin/developer users see a "Regenerate" button → `apiRequest("POST", "/api/vrm/executive-summary/brief")` → invalidate query.
- **Drill-down drawer:** shadcn `Sheet` listing `ExecCaseRow`s (truck #, tech, vendor, `$X/day`, days open) with badges: `REG` (red) when `regBlocked`, `UNKNOWN RENTER` (amber) when `unknownRenter`; every row links to `/vehicle-rental-management/rental-operations` (the ops page is intentionally unchanged — no URL filters exist there).
- Loading skeletons on `isLoading`; error state with retry on query error.

**Verify:** restart `Start application`; take an app-preview screenshot of `/vehicle-rental-management/executive-summary` (dev session should be logged in from the preview pane; if auth blocks the screenshot, verify via browser console logs + user check instead). Confirm nav entry renders and existing VRM pages are untouched.

**Commit:** `vrm exec summary: dashboard page, nav entry, drill-down drawer`

---

## Task 9 — Final verification & review

1. **All unit tests:** `npx tsx --test tests/vrm-exec-buckets.test.ts tests/vrm-exec-metrics.test.ts tests/vrm-exec-insights.test.ts tests/vrm-exec-backfill.test.ts` — green.
2. **Existing suites untouched:** run the three existing test workflows (`cache-alignment-unit`, `cache-alignment-integration`, `comms-lib-unit`) — still green.
3. **Typecheck:** run `npm run check` via a temp workflow writing to a logfile, poll the file (bash background procs die on tool-call return). Compare error count to the ~224 baseline — MUST be no new errors, and zero errors in any `executive-summary`/`vrm-exec` file.
4. **Boot:** restart `Start application`; logs show schema init + backfill flag respected, no route 404 regressions.
5. **End-to-end sanity:** `scripts/tmp-exec-check.ts` one last time (payload sane, bucket sums = openTotal), then delete every `scripts/tmp-*.ts`.
6. **Architect review:** `architect({ task, includeGitDiff: true, relevantFiles: [] })` (empty relevantFiles + inlined schema facts — large files truncate the verdict buffer). Fix severe findings; re-run affected tests.
7. Suggest publish (rollup/backfill/brief all activate in prod automatically on first boot + first ingest; no scheduled-deployment work needed).

**Commit:** `vrm exec summary: final verification fixes` (if any)

---

## Known accepted limitations (surface to user at handoff, not blockers)

- New-hire detection misses hires without `enterprise_id` in `onboarding_hires` (~16% of recent starts) — they fall through to truck-state buckets.
- Backfilled trend rows have no bucket/right-size splits (person-status history isn't reconstructable) and undercount days before case tracking began.
- The AI brief appears on the SECOND page load of the day (generated in the background on the first).
