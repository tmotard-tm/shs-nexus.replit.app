---
name: Today's Queue perf layering
description: Why the queue GET is 3-layer cached and what every new queue-mutating route must do
---

The Today's Queue payload (VRM Ops Queue + FS mirror share one builder) was 2.7–6.5s per GET warm and **minutes** cold. Three independent causes, three layers — all in the server, client staleTime alone cannot fix them:

1. **Spare-van pool blocks on the AMS truck-status map.** On a cold boot the map build paginates the whole AMS API (~11k vehicles, ~3min) and the pool awaits it → first queue GET after any restart hung for it (measured 114s). Rule: nice-to-have decorations (step-7 spare suggestions) get a short `Promise.race` timeout (5s) and are omitted for that build; the pool keeps warming in the background.
2. **`PORTAL_PO_OBS` is inherently expensive** — it explodes 500+ TOASTed portal-hist JSONB trails into ~45k rows with `jsonb_array_elements` on every execution (~2.6–6.5s; EXPLAIN shows the nested-loop explode + memoize thrash). No index helps. The queue's `loadQueuePoContext` is wrapped in a 5-min stale-while-revalidate cache: stale serves instantly and refreshes in the background, so only the very first post-boot build pays. PO source data lags hours-to-months by design, so 5 min of read staleness is noise. The master board's live query is untouched.
3. **The built queue itself is cached 30s** with in-flight dedupe + epoch-guarded invalidation, shared by both routes; `compression()` (was installed but never wired) shrinks the ~500KB JSON ~10x.

**How to apply:** any NEW route that writes queue-visible state (`vrm_rental_operation_actions`, fleet-status, workbook marks, identity overrides) MUST call `invalidateTodaysQueueCache(reason)` on success, or the client's post-mutation settle refetch reads a stale payload and the write "disappears" for up to 30s. Routes that change PO/portal data (scrape, refresh-po, materialize, sync, shop-phone) must bust BOTH that and `invalidateQueuePoContextCache(reason)`. Fleet-status display stays fresh regardless: states are attached per-request on top of the cached payload.

**Autoscale caveat:** these are per-instance in-memory caches; a mutation busts only the instance that served it. The 30s/5min TTLs bound cross-instance staleness; both self-expire, so no cold-boot pinning (cf. the mismatch-cache epoch lesson).
