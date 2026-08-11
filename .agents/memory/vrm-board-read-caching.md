---
name: VRM board read caching
description: SWR layering for heavy VRM reads (master/by-region/queue/scrape-targets/exec-summary), transitive bust wiring, and the cold-boot statement-timeout trap.
---

# VRM board read caching (stale-while-revalidate)

**Rule:** every heavy VRM board read serves through an SWR cache — fresh TTL → cached; stale window → serve last-good IMMEDIATELY + single-flight background rebuild; past max-stale, cold, or right after an explicit invalidation → blocking rebuild. Shared helper: `server/vrm/rental-operations/board-cache.ts` (leaf module, zero app imports — safe to import from anywhere without cycles). The queue keeps its own cache in `todays-queue.ts` with the same semantics; exec-summary stale-serves only on TTL expiry.

**Why:** master board and by-region ran their full SQL builds (~6-13s) live on EVERY request; queue blocked ~9s on every cold 30s window. The PO-context cache in read-repository.ts already proved the SWR pattern; this generalizes it.

**How to apply:**
- New mutation routes need NO board-cache wiring: `invalidateTodaysQueueCache()` and `invalidateQueuePoContextCache()` BOTH transitively call `invalidateBoardCaches()`. Calling either existing bust is enough. Direction is one-way (queue-bust → board-bust, never back) — do not add the reverse edge or you create a bust loop.
- Post-mutation freshness contract: explicit bust ⇒ the NEXT read blocks for fresh data. Never soften that to stale-serve, or a user's refetch after their own edit shows pre-edit data.
- Exec-summary: the ingest hard-clear (leaf summary-cache module) is deliberate — first read after new data must block and be fresh. Only TTL expiry stale-serves. Publishes are epoch-guarded (review-caught race): `setSummaryCache(payload, epochCapturedBeforeBuild)` — a multi-second build that straddles an ingest clear must serve its caller but never re-cache pre-ingest data. Any long-build cache with an external clear needs the same guard.
- Payload shapes are pinned by tests/vrm-surface-alignment.test.ts against the UNCACHED builders — cache wrappers must stay shape-transparent.

**Trap (pre-existing, now rarer):** on a cold instance, several heavy builds racing concurrently trip the dev Postgres statement timeout (~15s) → 500 `{"error":"canceling statement due to statement timeout"}` with NO route-catch pattern you might grep for elsewhere. Each build succeeds solo (6-13s) and a retry self-heals; only the first build per key per boot is exposed. If it ever matters in prod, the considered fix is a small concurrency gate (semaphore ~2) inside board-cache refresh — weigh added third-request latency vs proxy timeouts before adding it.
