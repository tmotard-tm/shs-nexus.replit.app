// Executive Summary — orchestrator + routes.
//
// Mounted under the session-gated /api/vrm router (requireAuth is global on
// that mount). Per-instance 5-minute cache + bounded-stale fallback for the
// known transient Neon-WS-drop pattern on heavy aggregators. Registration must
// not await anything (startup-route-registration trap).
//
// getExecutiveSummary() lives HERE (not metrics.ts) to keep the module graph
// acyclic: rollup.ts imports the pure pieces from metrics.ts, and this file is
// the only one that pulls metrics + rollup + insights together.

import type { Router } from "express";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { getRentalOpsMaster } from "../rental-operations/read-repository";
import { requestRentalOpsAutoSync } from "../rental-operations/routes";
import { getSummaryCache, setSummaryCache, clearSummaryCache } from "./summary-cache";
import { classifyBucket } from "./buckets";
import {
  buildCaseFacts,
  aggregateSummary,
  stageToRightsizeCounts,
  fetchSupplementalFacts,
  fetchWeeklyFlowRows,
  computeWeeklyFlows,
  type ExecSummaryPayload,
  type SupplementalFacts,
  type RightsizeTechRow,
} from "./metrics";
import { buildInsights, type InsightCard } from "./insights";
import {
  etToday,
  getTrends,
  getTodayAiBrief,
  getTodayRowAgeHours,
  writeExecMetricsRow,
  fetchTodayFlowCounts,
  type TrendPoint,
} from "./rollup";
import { maybeGenerateBriefOnce, regenerateExecBrief } from "./brief";

const EMPTY_SUPP: SupplementalFacts & { rightsizeTechs: RightsizeTechRow[] } = {
  newHireEids: new Set(),
  truckByCanon: new Map(),
  decommCanon: new Set(),
  today: new Date(),
  rightsizeTechs: [],
};

export async function getExecutiveSummary(): Promise<ExecSummaryPayload> {
  const sectionErrors: Record<string, string> = {};
  const msg = (e: unknown) => (e as Error)?.message ?? String(e);

  // Only THIS may throw — everything downstream degrades per-section.
  const master = await getRentalOpsMaster();

  let supp = EMPTY_SUPP;
  try {
    supp = await fetchSupplementalFacts();
  } catch (e) {
    sectionErrors.supplemental = msg(e);
    supp = { ...EMPTY_SUPP, today: new Date() };
  }

  const facts = buildCaseFacts(master.rows, supp);
  const { counts, stages } = stageToRightsizeCounts(supp.rightsizeTechs.map((t) => t.stage));
  const agg = aggregateSummary(facts, counts, stages);
  const classified = new Map(facts.map((f) => [f.caseKey, classifyBucket(f)]));

  let insights: InsightCard[] = [];
  try {
    insights = buildInsights(facts, classified, supp.rightsizeTechs, new Date());
  } catch (e) {
    sectionErrors.insights = msg(e);
  }

  try {
    const flowRows = await fetchWeeklyFlowRows();
    Object.assign(agg.headline, computeWeeklyFlows(flowRows, etToday()));
  } catch (e) {
    sectionErrors.weeklyFlows = msg(e);
  }

  let trends: TrendPoint[] = [];
  try {
    trends = await getTrends();
  } catch (e) {
    sectionErrors.trends = msg(e);
  }

  let aiBrief: { text: string; generatedAt: string } | null = null;
  try {
    aiBrief = await getTodayAiBrief();
  } catch (e) {
    sectionErrors.aiBrief = msg(e);
  }

  // True data age: the summary is computed FROM the ingested rental-ops tables,
  // so its freshness is the last completed ingest — NOT this compute time.
  // scheduled_sync ONLY: it is the one run type that covers BOTH sources
  // (enterprise + holman sweep). A manual_enterprise_import is partial — letting
  // it advance this clock would report "synced just now" over stale Holman rows
  // AND suppress the auto-sync that would actually fix them.
  let dataAsOf: string | null = null;
  let dataFileDate: string | null = null;
  try {
    const last = await db.execute(sql`
      SELECT finished_at, file_date FROM vrm_rental_operations_import_runs
      WHERE status = 'completed' AND run_type = 'scheduled_sync'
      ORDER BY started_at DESC LIMIT 1
    `);
    const row = last.rows[0] as { finished_at?: string | Date; file_date?: string } | undefined;
    dataAsOf = row?.finished_at ? new Date(row.finished_at).toISOString() : null;
    dataFileDate = row?.file_date ?? null;
  } catch (e) {
    sectionErrors.dataAge = msg(e);
  }

  return {
    generatedAt: new Date().toISOString(),
    dataAsOf,
    dataFileDate,
    headline: agg.headline,
    buckets: agg.buckets,
    breakdowns: agg.breakdowns,
    insights,
    trends,
    aiBrief,
    ...(Object.keys(sectionErrors).length ? { sectionErrors } : {}),
  };
}

// Lazy rollup safety net: a day with no ingest still gets a data point when
// anyone opens the page (autoscale reality: no dependable in-process timers).
// Skipped when supplemental facts failed — a degraded payload has mis-bucketed
// cases and must never overwrite a good ingest-written row.
async function upsertTodayIfStale(payload: ExecSummaryPayload): Promise<void> {
  if (payload.sectionErrors?.supplemental) return;
  const age = await getTodayRowAgeHours();
  if (age != null && age < 6) return;
  const flows = await fetchTodayFlowCounts(etToday());
  await writeExecMetricsRow({
    metricDate: etToday(),
    openTotal: payload.headline.openTotal,
    openByVendor: payload.headline.byVendor,
    newCount: flows.newCount,
    returnedCount: flows.returnedCount,
    dailySpend: payload.headline.dailySpend,
    potentialSavings: payload.headline.potentialDailySavings,
    avgDaysOpen: payload.headline.avgDaysOpen,
    over30Count: payload.headline.over30Count,
    rightsizeStages: payload.headline.rightsizeStages,
    bucketCounts: Object.fromEntries(payload.buckets.map((b) => [b.bucket, b.count])),
    insightCounts: Object.fromEntries(payload.insights.map((i) => [i.id, i.count])),
  });
}

// Per-instance cache (accepted on autoscale — lives in summary-cache.ts so
// ingest can bust it the moment new rows land).
const TTL_MS = 5 * 60_000;
const STALE_FALLBACK_MS = 30 * 60_000;

// If the underlying ingest is older than this, viewing the summary requests a
// background rental-ops sync (cooldown + in-flight guards live on the trigger).
// Lazy view-triggered, same reasoning as upsertTodayIfStale: autoscale has no
// dependable in-process timers, and dev has nothing poking the cron route.
const DATA_STALE_MS = 6 * 60 * 60_000;

function maybeRequestAutoSync(payload: ExecSummaryPayload): void {
  const asOf = payload.dataAsOf ? Date.parse(payload.dataAsOf) : NaN;
  if (Number.isFinite(asOf) && Date.now() - asOf <= DATA_STALE_MS) return;
  const r = requestRentalOpsAutoSync("exec-summary data stale");
  if (r === "started") {
    console.log("[vrm-exec] rental-ops data stale — background sync started");
  }
}

export function registerExecutiveSummaryRoutes(router: Router): void {
  router.get("/executive-summary", async (req, res) => {
    try {
      const force = req.query.refresh === "true";
      const cached = getSummaryCache();
      if (!force && cached && Date.now() - cached.at < TTL_MS) {
        // Serving from cache must still notice stale underlying data — the
        // whole complaint is a summary that never causes a sync.
        maybeRequestAutoSync(cached.payload);
        return res.json(cached.payload);
      }
      const payload = await getExecutiveSummary();
      setSummaryCache(payload);
      maybeRequestAutoSync(payload);
      void upsertTodayIfStale(payload).catch((e) =>
        console.error("[vrm-exec] lazy rollup failed (non-fatal):", (e as Error)?.message),
      );
      void maybeGenerateBriefOnce(payload).catch((e) =>
        console.error("[vrm-exec] auto-brief failed (non-fatal):", (e as Error)?.message),
      );
      res.json(payload);
    } catch (e) {
      // Bounded-stale fallback (known Neon-WS-drop pattern on heavy aggregators).
      // No auto-sync here: if reads are failing, piling an ingest on top helps nothing.
      const cached = getSummaryCache();
      if (cached && Date.now() - cached.at < STALE_FALLBACK_MS) {
        return res.json({ ...cached.payload, stale: true });
      }
      console.error("[vrm-exec] summary failed:", e);
      res.status(500).json({ error: (e as Error)?.message ?? "executive summary failed" });
    }
  });

  router.post("/executive-summary/brief", async (req, res) => {
    try {
      const role = (req.user as any)?.role;
      if (!["admin", "developer"].includes(String(role ?? ""))) {
        return res.status(403).json({ error: "admin only" });
      }
      const cached = getSummaryCache();
      const payload =
        cached && Date.now() - cached.at < TTL_MS ? cached.payload : await getExecutiveSummary();
      const text = await regenerateExecBrief(payload);
      if (text == null) {
        // Fail-soft internally, but the admin asked explicitly — surface it.
        return res.status(502).json({ error: "AI brief generation failed (check Bedrock credentials/quota)" });
      }
      clearSummaryCache("brief regenerated"); // next GET re-reads the stored brief
      res.json({ text });
    } catch (e) {
      console.error("[vrm-exec] brief regenerate failed:", e);
      res.status(500).json({ error: (e as Error)?.message ?? "brief generation failed" });
    }
  });
}
