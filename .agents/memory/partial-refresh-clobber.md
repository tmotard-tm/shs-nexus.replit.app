---
name: Partial refresh must never clobber last-good cache
description: Cache-rebuild failure semantics — a partial/failed sweep result must not replace complete data for the full TTL; retry briefly instead.
---

# Partial refresh must never clobber last-good cache

**Rule:** When a periodic rebuild (sweep/sync) of a cached dataset produces an INCOMPLETE or failed result, never install it over existing complete data for the full cache TTL. Prefer, in order: (1) keep the existing complete in-memory entry, (2) rehydrate the persisted last-good snapshot, (3) only then serve the partial — and in all failure cases schedule a SHORT retry (minutes) via a `nextRebuildAt`-style field instead of waiting out the normal TTL.

**Why:** The prod "Fleet Scope All vehicles shows dashes" outage (July 2026) was exactly this: a boot-time AMS sweep hit page timeouts, produced a partial result (`activeSweepComplete=false`), and clobbered a valid complete cache for the full 30-min TTL. The UI gates display on sweep-completeness, so every failed sweep meant up to 30 min of dashes + 15s client polling, even though a complete 12h-valid snapshot sat in the DB the whole time.

**How to apply:** Any in-memory TTL cache fed by a fallible multi-page/remote sweep needs: (a) completeness flag checked BEFORE install, (b) persisted snapshots written only for complete results, (c) a separate short retry deadline for failure pacing (distinct from the success TTL), (d) freshness helper consulted at every hot-path check so both TTL and retry deadline are honored consistently. On autoscale this also isolates instances: a shared snapshot that only ever holds complete sweeps means one instance's failed sweep can't poison another.

**Related trap (same outage):** a route that "proxies" its own localhost endpoint with a bare unauthenticated fetch is dead code in prod — the session-gated target always 401s. Serve from the in-process cache/persisted snapshot directly instead of self-fetching.
