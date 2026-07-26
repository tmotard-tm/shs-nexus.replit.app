// Executive Summary — fail-soft Bedrock narrative brief.
//
// A missing/broken Bedrock config must NEVER surface as an error: the brief
// stays null and the UI hides the section. Dedupe is per-instance by design
// (accepted cross-instance race — worst case one duplicate Bedrock call, last
// write wins; consistent with the per-instance route cache allowance).

import { pool } from "../../db";
import { etToday, saveAiBrief } from "./rollup";
import type { ExecSummaryPayload } from "./metrics";

export async function generateExecBrief(payload: ExecSummaryPayload): Promise<string | null> {
  try {
    const { invokeBedrock } = await import("../rightsize/llm");
    const system =
      "You write a short executive brief (2-3 plain-language paragraphs, no markdown headers) " +
      "for a fleet rental dashboard. Use ONLY the JSON metrics given. Lead with the biggest " +
      "dollar lever, name concrete counts, end with the top recommended action.";
    const compact = {
      headline: payload.headline,
      buckets: payload.buckets.map((b) => ({ bucket: b.bucket, count: b.count, dailySpend: b.dailySpend })),
      insights: payload.insights.map((i) => ({ id: i.id, count: i.count, dailyImpact: i.dailyImpact })),
    };
    const r = await invokeBedrock(system, JSON.stringify(compact), {
      maxTokens: 700,
      label: "exec-brief",
    });
    return r.text || null;
  } catch (e) {
    console.error("[vrm-exec] brief generation failed (fail-soft):", (e as Error)?.message);
    return null;
  }
}

// Once-per-day auto-generation, self-deduping within this instance: the
// in-flight flag stops parallel page loads, and the DB re-check stops a
// second generation after a cache expiry.
let briefInFlight = false;

export async function maybeGenerateBriefOnce(payload: ExecSummaryPayload): Promise<void> {
  if (payload.aiBrief || briefInFlight) return;
  briefInFlight = true;
  try {
    const r = await pool.query(
      `SELECT ai_brief FROM vrm_exec_daily_metrics WHERE metric_date = $1::date`,
      [etToday()],
    );
    if (r.rows.length && r.rows[0].ai_brief) return;
    const text = await generateExecBrief(payload);
    if (text) await saveAiBrief(text);
  } finally {
    briefInFlight = false;
  }
}

// Synchronous regenerate for the admin POST route.
export async function regenerateExecBrief(payload: ExecSummaryPayload): Promise<string | null> {
  const text = await generateExecBrief(payload);
  if (text) await saveAiBrief(text);
  return text;
}
