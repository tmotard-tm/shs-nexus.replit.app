/**
 * Serving shell for the cutover scoreboard (2026-08-25 incident).
 *
 * Prod cold boot at 12:33 ET + the startup sync sweep made the ~9s
 * cutover-status query fail transiently at 12:36; the page then rendered
 * drizzle's "Failed query: <18KB of SQL>" wrapper as the error banner. The
 * schema and data were fine — the query ran clean minutes later. The client
 * already retries once on 5xx, so resilience lives here:
 *
 *   · SINGLE-FLIGHT: concurrent requests (multiple open boards + the client
 *     retry) coalesce onto ONE build/retry sequence — never 2N copies of a
 *     9-second query against an already-degraded DB;
 *   · retry the build ONCE after a short pause (rides out boot contention);
 *   · if the retry fails too, serve the instance's last-good payload when it
 *     is younger than 15 min, marked { stale, staleAsOf } so the page says
 *     so — bounded, per the partial-refresh rule: never stale forever;
 *   · only then 500 — with the ROOT cause summarized, never the SQL dump.
 *
 * Mutations that change what this page shows (billing-void, book-override,
 * the direct-billing import's switchover stamps) call
 * invalidateCutoverStatusCache() so the last-good fallback can never mask a
 * write that just succeeded: the epoch guard keeps a pre-invalidate build
 * from recording, and detaching the in-flight promise keeps a post-mutation
 * refetch from coalescing onto a pre-mutation read (board-cache discipline).
 *
 * LEAF MODULE ON PURPOSE (imports only db-errors, itself a leaf) so survey.ts,
 * cutover-intents-routes.ts and the rental-operations import can all call in
 * without a cycle. Per-instance state is accepted on autoscale — the same
 * allowance as the board caches.
 */
import { rootDbErrorMessage } from "./db-errors";

type Served = { status: number; body: any };

let lastGood: { at: number; value: any } | null = null;
let inflight: Promise<Served> | null = null;
let epoch = 0;

/** Drop the last-good payload and detach any in-flight build. Call after any
 *  successful mutation the scoreboard reflects. */
export function invalidateCutoverStatusCache(reason: string): void {
  epoch++;
  lastGood = null;
  inflight = null;
  console.log(`[survey] cutover-status cache invalidated (${reason})`);
}

export function __resetCutoverStatusLastGoodForTests(): void {
  invalidateCutoverStatusCache("test reset");
}

async function serveOnce(
  build: () => Promise<any>,
  o?: { retryDelayMs?: number; staleMaxMs?: number; now?: () => number },
): Promise<Served> {
  const now = o?.now ?? Date.now;
  const retryDelayMs = o?.retryDelayMs ?? 1500;
  const staleMaxMs = o?.staleMaxMs ?? 15 * 60_000;
  const myEpoch = epoch;
  const record = (value: any): Served => {
    if (myEpoch === epoch) lastGood = { at: now(), value };
    return { status: 200, body: value };
  };
  try {
    return record(await build());
  } catch (first: any) {
    console.error(
      "[survey] cutover-status build failed (retrying once):",
      rootDbErrorMessage(first),
    );
    if (retryDelayMs > 0) await new Promise((r) => setTimeout(r, retryDelayMs));
    try {
      return record(await build());
    } catch (second: any) {
      const msg = rootDbErrorMessage(second);
      console.error("[survey] cutover-status failed after retry:", msg);
      const fallback = lastGood; // re-read: an invalidate mid-flight clears it
      if (fallback && now() - fallback.at < staleMaxMs) {
        const staleAsOf = new Date(fallback.at).toISOString();
        console.warn(`[survey] cutover-status serving last-good payload from ${staleAsOf}`);
        return { status: 200, body: { ...fallback.value, stale: true, staleAsOf } };
      }
      return { status: 500, body: { message: `cutover-status failed: ${msg}` } };
    }
  }
}

export async function serveCutoverStatusPayload(
  build: () => Promise<any>,
  o?: { retryDelayMs?: number; staleMaxMs?: number; now?: () => number },
): Promise<Served> {
  if (inflight) return inflight;
  const p = serveOnce(build, o).finally(() => {
    if (inflight === p) inflight = null;
  });
  inflight = p;
  return p;
}
