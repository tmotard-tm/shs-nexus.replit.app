/**
 * Shared stale-while-revalidate cache for the heavy VRM board reads (master
 * grid, by-region, scrape-targets). Same semantics the PO-context cache in
 * read-repository.ts proved out, generalized:
 *
 *   · fresh (age < freshMs): serve cached;
 *   · stale (freshMs ≤ age < maxStaleMs): serve cached IMMEDIATELY and refresh
 *     in the background (single-flight per key) — page opens never block on a
 *     multi-second rebuild once the instance has served one;
 *   · older than maxStaleMs, no entry, or right after invalidateBoardCaches():
 *     BLOCKING build — so a client refetch right after a mutation always sees
 *     that write (the same contract the Today's Queue cache documents).
 *
 * Invalidation is transitive from the two existing bust points, so every
 * current and future mutation path keeps working without touching each route:
 *   · invalidateTodaysQueueCache() (todays-queue.ts) — every queue/case
 *     mutation route already calls it;
 *   · invalidateQueuePoContextCache() (read-repository.ts) — every PO
 *     scrape/ingest/materialize/shop-phone path already calls it.
 *
 * LEAF MODULE ON PURPOSE: imports nothing from the app, so todays-queue.ts and
 * read-repository.ts can both call in without creating an import cycle.
 * Per-instance state is accepted on autoscale (same allowance as the queue,
 * PO-context, and exec-summary caches).
 */

type Entry = { at: number; value: unknown };

const entries = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();
let epoch = 0;

/** Drop every cached board read. Next GET per key rebuilds fresh (blocking). */
export function invalidateBoardCaches(reason: string): void {
  epoch++;
  entries.clear();
  // Detach in-flight builds: they started before this write and could cache
  // pre-write data. Their awaiting callers still get a (marginally stale)
  // response; the epoch guard keeps the result out of the cache.
  inflight.clear();
  console.log(`[BoardCache] invalidated (${reason})`);
}

function refresh<T>(key: string, build: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const myEpoch = epoch;
  const promise = build()
    .then((value) => {
      if (myEpoch === epoch) entries.set(key, { at: Date.now(), value });
      return value;
    })
    .finally(() => {
      if (inflight.get(key) === promise) inflight.delete(key);
    });
  inflight.set(key, promise);
  return promise;
}

/**
 * Read through the cache. `build` runs at most once concurrently per key; a
 * background-refresh failure keeps serving the last good value (and warns) —
 * identical to the PO-context behavior.
 */
export async function boardCacheGet<T>(
  key: string,
  freshMs: number,
  maxStaleMs: number,
  build: () => Promise<T>,
): Promise<T> {
  const entry = entries.get(key);
  const age = entry ? Date.now() - entry.at : Infinity;
  if (entry && age < freshMs) return entry.value as T;
  if (entry && age < maxStaleMs) {
    refresh(key, build).catch((e: any) =>
      console.warn(`[BoardCache] background refresh failed for ${key} (serving stale):`, e?.message || e));
    return entry.value as T;
  }
  return refresh(key, build);
}
