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
 *
 * Epoch guard: clearing bumps an epoch, and every publish must present the
 * epoch it captured BEFORE its build started. Summary builds are multi-second,
 * so an ingest can land mid-build; without the guard that build would re-cache
 * PRE-ingest numbers right after the clear. A superseded build still serves
 * its own caller — it just doesn't get cached.
 */
import type { ExecSummaryPayload } from "./metrics";

let cache: { at: number; payload: ExecSummaryPayload } | null = null;
let epoch = 0;

export function getSummaryCache(): { at: number; payload: ExecSummaryPayload } | null {
  return cache;
}

/** Capture BEFORE starting a build; pass to setSummaryCache with the result. */
export function getSummaryCacheEpoch(): number {
  return epoch;
}

export function setSummaryCache(payload: ExecSummaryPayload, atEpoch: number): void {
  if (atEpoch !== epoch) {
    console.log("[vrm-exec] summary build superseded by a cache clear — not cached");
    return;
  }
  cache = { at: Date.now(), payload };
}

export function clearSummaryCache(reason: string): void {
  epoch++; // bump even when cache is already null: a build may be in flight
  if (cache) console.log(`[vrm-exec] summary cache invalidated (${reason})`);
  cache = null;
}
