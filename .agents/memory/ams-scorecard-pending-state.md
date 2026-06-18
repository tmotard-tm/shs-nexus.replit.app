---
name: AMS scorecard zeros vs pending
description: Why the /fleet-scope All Vehicles AMS scorecard can render misleading all-zeros, and the client gating + self-heal pattern that fixes it.
---

# AMS "All Vehicles" scorecard: zeros vs pending

The `/api/ams/active-scorecard-counts` endpoint builds an in-memory AMS truck-status
map (full paginated AMS sweep + Snowflake supplement) and serves **503 "still warming"**
while the build runs past its request budget. On a cold/slow autoscale instance the
sweep takes minutes, so early requests get 503.

## The trap (all-zeros false state)
The client derives status cards from a FIXED canonical list (`AMS_STATUS_DISPLAY_ORDER`)
and defaults every bucket's count to 0, and `totalOperational` to `?? 0`. So when the
query has no data (503/error/loading), the card renders **every named bucket at 0 with
"0.0% of total" and no "Loading…"** — looks like a real "fleet is empty" answer, not a
failure. A *partial* sweep is the opposite trap: it over-counts (inflated total).

**Rule:** show real numbers ONLY when `amsReady = !!data && data.activeSweepComplete`.
Otherwise render a pending "—"/"Calculating…" state. This single gate covers BOTH
failure-zeros and partial-sweep inflation. Gate the Decline Repair / Sent to Auction
sub-lines behind `amsReady` too.

## Self-heal
The query must override the project's global `retry:false`: retry transient failures
(5xx/network, NOT 4xx — parse leading status from the `"<status>: <text>"` error
message) and use a `refetchInterval` that polls (~15s) **until `activeSweepComplete`**,
returning `false` to stop once complete. Without polling, a 503'd cold instance never
recovers until manual refresh.

## Server build resilience
The per-page AMS fetch must ABORT on timeout (AbortController → fetch `signal`), not just
`Promise.race`. Race alone leaves the timed-out fetch running; under a struggling AMS
those zombie requests pile load and make the whole sweep slower. Keep per-page retry
light (2 attempts) so the background build doesn't balloon — the client poll is what
bridges the gap, so the build doesn't need to win within one request budget.
**Why:** an aggressive 3×30s+backoff retry visibly slowed prod and increased 503s.
