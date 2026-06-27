---
name: AMS truck-status-map client resilience
description: Why the AMS status pill/labels vanish until refresh, and the rule for any client consuming /api/ams/truck-status-map.
---

The AMS cache endpoints — `/api/ams/truck-status-map` and its siblings
`/api/ams/declined-repair-count`, `/api/ams/active-scorecard-counts` — go through
`getAmsTruckStatusOrServe503()` and **return a transient 503 by design** while the
server's AMS status cache is cold/rebuilding (build exceeds its time budget) or
after an upstream AMS/Snowflake blip. This is a "still warming, retry shortly"
signal (with `Retry-After`), not a real failure.

Rule: any client query reading these endpoints MUST be resilient — retry the 5xx
(incl. the warming 503) and network failures with backoff, and ideally slow-poll
until data arrives. **Do NOT use `retry:false`** on them.

**Why:** every fleet card's AMS status pill reads from a *single shared*
`useQuery(['/api/ams/truck-status-map'])`. With `retry:false` (and the global
QueryClient default also being `retry:false`, `refetchOnWindowFocus:false`,
`staleTime:Infinity`), one stray 503 left `data` undefined → every pill blanked at
once with no auto-recovery → user had to manually refresh the page. It looked
intermittent because it only happened when the page loaded during the cache-warming
window.

**How to apply:** the default fetcher (`getQueryFn` in `client/src/lib/queryClient.ts`)
throws `Error("<status>: <text>")`, so `parseInt(error.message,10)` recovers the
HTTP status (NaN for network errors). Retry when `NaN || status>=500`, never on
4xx (auth/permission). In TanStack Query v5 the `refetchInterval` callback receives
the `query` object — use `(query)=>query.state.data ? false : 30000` to poll only
until data lands. The fleet-card pill query already does this.

**Latent same bug:** `client/src/components/fleet-scope/FleetVehicleTable.tsx` still
reads `['/api/ams/truck-status-map']` with `retry:false` — same gap on the Fleet
Scope table view; fix it the same way if that surface reports vanishing AMS status.
