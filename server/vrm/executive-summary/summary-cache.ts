/**
 * Per-instance Executive Summary response cache, in its own leaf module so the
 * rental-ops ingest can bust it without importing the route graph (acyclic:
 * routes.ts → here ← ingest.ts via dynamic import).
 *
 * Why busting matters: the summary is computed FROM vrm_rental_operations_*
 * tables. Any ingest that lands new rows (manual board sync, cron run,
 * scheduled deployment in the same process, exec-page auto-sync) must clear
 * this cache, or the summary keeps serving pre-sync numbers for the full TTL —
 * the exact "stale vs Rental Operations" complaint this exists to prevent.
 */
import type { ExecSummaryPayload } from "./metrics";

let cache: { at: number; payload: ExecSummaryPayload } | null = null;

export function getSummaryCache(): { at: number; payload: ExecSummaryPayload } | null {
  return cache;
}

export function setSummaryCache(payload: ExecSummaryPayload): void {
  cache = { at: Date.now(), payload };
}

export function clearSummaryCache(reason: string): void {
  if (cache) console.log(`[vrm-exec] summary cache invalidated (${reason})`);
  cache = null;
}
