// Executive Summary — daily rollup writer + trend reader.
//
// One row per ET day in vrm_exec_daily_metrics. Written after every successful
// rental-ops ingest (hook in ingest.ts, non-fatal) and lazily by the GET route
// when today's row is missing/stale — there are NO dependable in-process timers
// on autoscale (see replit.md).
//
// THE single "new rental" definition (all three sites must agree):
//   new = COALESCE(rental_start_date, first_seen_at ET date)
// Sites: computeWeeklyFlows feed (metrics.ts), the daily-flow SQL here, and the
// backfill's `started` attribution (backfill.ts). Never count "new" off
// first_seen_at alone.

import { pool } from "../../db";
import { getRentalOpsMaster } from "../rental-operations/read-repository";
import { classifyBucket } from "./buckets";
import {
  buildCaseFacts,
  aggregateSummary,
  stageToRightsizeCounts,
  fetchSupplementalFacts,
} from "./metrics";
import { buildInsights } from "./insights";

export function etToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export interface TrendPoint {
  date: string;
  openTotal: number;
  openByVendor: Record<string, number>;
  newCount: number;
  returnedCount: number;
  dailySpend: number;
  bucketCounts: Record<string, number> | null;
  rightsizeStages: Record<string, number> | null;
  source: string;
}

export async function fetchTodayFlowCounts(
  dateEt: string,
): Promise<{ newCount: number; returnedCount: number }> {
  const r = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE COALESCE(rental_start_date,
         (first_seen_at AT TIME ZONE 'America/New_York')::date) = $1::date)::int AS new_count,
       COUNT(*) FILTER (WHERE (dropped_from_feed_at AT TIME ZONE 'America/New_York')::date = $1::date)::int AS returned_count
     FROM vrm_rental_operations_cases`,
    [dateEt],
  );
  return {
    newCount: Number(r.rows[0]?.new_count ?? 0),
    returnedCount: Number(r.rows[0]?.returned_count ?? 0),
  };
}

export interface ExecMetricsRowInput {
  metricDate: string; // ET 'YYYY-MM-DD'
  openTotal: number;
  openByVendor: Record<string, number>;
  newCount: number;
  returnedCount: number;
  dailySpend: number;
  potentialSavings: number | null;
  avgDaysOpen: number | null;
  over30Count: number | null;
  rightsizeStages: Record<string, number> | null;
  bucketCounts: Record<string, number> | null;
  insightCounts: Record<string, number> | null;
}

// Upsert one day's row. Deliberately NEVER touches ai_brief / ai_brief_generated_at
// — the brief is written separately and must survive metric refreshes.
export async function writeExecMetricsRow(row: ExecMetricsRowInput): Promise<void> {
  await pool.query(
    `INSERT INTO vrm_exec_daily_metrics
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
       insight_counts=EXCLUDED.insight_counts, source='live', updated_at=now()`,
    [
      row.metricDate,
      row.openTotal,
      JSON.stringify(row.openByVendor ?? {}),
      row.newCount,
      row.returnedCount,
      row.dailySpend,
      row.potentialSavings,
      row.avgDaysOpen,
      row.over30Count,
      row.rightsizeStages ? JSON.stringify(row.rightsizeStages) : null,
      row.bucketCounts ? JSON.stringify(row.bucketCounts) : null,
      row.insightCounts ? JSON.stringify(row.insightCounts) : null,
    ],
  );
}

// Compute the live summary off the ops read layer (NOT any route cache) and
// upsert today's ET row.
export async function upsertTodayExecMetrics(): Promise<void> {
  const today = etToday();
  const [master, supp, flows] = await Promise.all([
    getRentalOpsMaster(),
    fetchSupplementalFacts(),
    fetchTodayFlowCounts(etToday()),
  ]);
  const facts = buildCaseFacts(master.rows, supp);
  const { counts, stages } = stageToRightsizeCounts(supp.rightsizeTechs.map((t) => t.stage));
  const agg = aggregateSummary(facts, counts, stages);
  const classified = new Map(facts.map((f) => [f.caseKey, classifyBucket(f)]));
  const insights = buildInsights(facts, classified, supp.rightsizeTechs, new Date());

  await writeExecMetricsRow({
    metricDate: today,
    openTotal: agg.headline.openTotal,
    openByVendor: agg.headline.byVendor,
    newCount: flows.newCount,
    returnedCount: flows.returnedCount,
    dailySpend: agg.headline.dailySpend,
    potentialSavings: agg.headline.potentialDailySavings,
    avgDaysOpen: agg.headline.avgDaysOpen,
    over30Count: agg.headline.over30Count,
    rightsizeStages: stages,
    bucketCounts: Object.fromEntries(agg.buckets.map((b) => [b.bucket, b.count])),
    insightCounts: Object.fromEntries(insights.map((i) => [i.id, i.count])),
  });
}

// Age (hours) of today's row, or null when it doesn't exist yet — the GET
// route's lazy safety-net check.
export async function getTodayRowAgeHours(): Promise<number | null> {
  const r = await pool.query(
    `SELECT EXTRACT(EPOCH FROM (now() - updated_at)) / 3600 AS age
       FROM vrm_exec_daily_metrics WHERE metric_date = $1::date`,
    [etToday()],
  );
  return r.rows.length ? Number(r.rows[0].age) : null;
}

// Full series — a few hundred small rows; the 30/90/180/all selector is
// client-side slicing (also sidesteps UTC-vs-ET CURRENT_DATE subtleties).
export async function getTrends(): Promise<TrendPoint[]> {
  const r = await pool.query(
    `SELECT metric_date::text AS date, open_total, open_by_vendor, new_count, returned_count,
            daily_spend, bucket_counts, rightsize_stages, source
       FROM vrm_exec_daily_metrics ORDER BY metric_date`,
  );
  return r.rows.map((x: any) => ({
    date: x.date,
    openTotal: Number(x.open_total ?? 0),
    openByVendor: x.open_by_vendor ?? {},
    newCount: Number(x.new_count ?? 0),
    returnedCount: Number(x.returned_count ?? 0),
    dailySpend: Number(x.daily_spend ?? 0),
    bucketCounts: x.bucket_counts ?? null,
    rightsizeStages: x.rightsize_stages ?? null,
    source: String(x.source ?? "live"),
  }));
}

export async function getTodayAiBrief(): Promise<{ text: string; generatedAt: string } | null> {
  const r = await pool.query(
    `SELECT ai_brief, ai_brief_generated_at FROM vrm_exec_daily_metrics
      WHERE metric_date = $1::date AND ai_brief IS NOT NULL`,
    [etToday()],
  );
  if (!r.rows.length || !r.rows[0].ai_brief) return null;
  return {
    text: String(r.rows[0].ai_brief),
    generatedAt: r.rows[0].ai_brief_generated_at
      ? new Date(r.rows[0].ai_brief_generated_at).toISOString()
      : "",
  };
}

export async function saveAiBrief(text: string): Promise<void> {
  // Row for today may not exist yet (brief can be requested before any rollup);
  // insert a minimal shell in that case — the next rollup fills the metrics.
  await pool.query(
    `INSERT INTO vrm_exec_daily_metrics (metric_date, ai_brief, ai_brief_generated_at, source)
     VALUES ($1::date, $2, now(), 'live')
     ON CONFLICT (metric_date) DO UPDATE SET ai_brief=$2, ai_brief_generated_at=now(), updated_at=now()`,
    [etToday(), text],
  );
}
