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
import { getRentalOpsMaster } from "../rental-operations/read-repository";
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

  return {
    generatedAt: new Date().toISOString(),
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

// Per-instance cache (accepted on autoscale — see plan).
let cache: { at: number; payload: ExecSummaryPayload } | null = null;
const TTL_MS = 5 * 60_000;
const STALE_FALLBACK_MS = 30 * 60_000;

export function registerExecutiveSummaryRoutes(router: Router): void {
  router.get("/executive-summary", async (req, res) => {
    try {
      const force = req.query.refresh === "true";
      if (!force && cache && Date.now() - cache.at < TTL_MS) return res.json(cache.payload);
      const payload = await getExecutiveSummary();
      cache = { at: Date.now(), payload };
      void upsertTodayIfStale(payload).catch((e) =>
        console.error("[vrm-exec] lazy rollup failed (non-fatal):", (e as Error)?.message),
      );
      void maybeGenerateBriefOnce(payload).catch((e) =>
        console.error("[vrm-exec] auto-brief failed (non-fatal):", (e as Error)?.message),
      );
      res.json(payload);
    } catch (e) {
      // Bounded-stale fallback (known Neon-WS-drop pattern on heavy aggregators).
      if (cache && Date.now() - cache.at < STALE_FALLBACK_MS) {
        return res.json({ ...cache.payload, stale: true });
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
      const payload =
        cache && Date.now() - cache.at < TTL_MS ? cache.payload : await getExecutiveSummary();
      const text = await regenerateExecBrief(payload);
      if (text == null) {
        // Fail-soft internally, but the admin asked explicitly — surface it.
        return res.status(502).json({ error: "AI brief generation failed (check Bedrock credentials/quota)" });
      }
      cache = null; // next GET re-reads the stored brief
      res.json({ text });
    } catch (e) {
      console.error("[vrm-exec] brief regenerate failed:", e);
      res.status(500).json({ error: (e as Error)?.message ?? "brief generation failed" });
    }
  });
}
