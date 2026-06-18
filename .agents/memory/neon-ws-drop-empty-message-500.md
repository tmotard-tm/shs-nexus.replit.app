---
name: Neon WS drop → empty-message 500 on heavy aggregator routes
description: Why a heavy Neon-backed route returns 500 {"message":""} intermittently, and the resilience pattern to fix it.
---

# Neon serverless WebSocket drop → `500 {"message":""}`

Neon's serverless driver (`@neondatabase/serverless`, ws transport) intermittently
drops its WebSocket under load/compute-scaling (`_closeCode: 1006`). The rejected
query is an **`ErrorEvent` whose `.message` getter is empty** — so a catch block
doing `res.status(500).json({ message: error.message })` returns the useless
`500 {"message":""}` a user sees in the UI.

**Where it bites:** heavy aggregator routes that fan out across Snowflake + many
Neon enrichment queries (e.g. FleetScope `GET /api/fs/all-vehicles`, handler in
`server/fleet-scope-routes.ts`). Snowflake usually succeeds; one of the scattered
Neon enrichment queries drops mid-request. It is **intermittent** — the same route
returns 200 (~5s) seconds later. `server/index.ts` already absorbs the matching
`uncaughtException` ("Cannot set property message") to keep the process alive, but
that does NOT save the in-flight request — the route still rejects → 500.

**Why:** Neon force-closes connections on compute scale/suspend; the pool
reconnects on the next request, so retrying generally works. The empty
`ErrorEvent.message` is the trap that makes the failure invisible to clients.

**How to apply (resilience pattern for these routes):**
- These routes typically keep a short in-process success cache (e.g. 5-min TTL).
  In the catch, detect a **transient DB drop** (`error.name === 'ErrorEvent'` /
  `error.type === 'error'` / msg includes "Cannot set property message" or
  "terminating connection due to administrator command" / `code === 'ECONNRESET'`).
- On a transient drop, serve the cached payload **only if still bounded-fresh**
  (cap, e.g. 15 min) and tag it (`stale: true, staleAgeSec`). Do NOT serve stale
  for *any* error or with no age cap — that masks real bugs and serves day-old data.
- Non-transient → return the real message (or a fallback string, never empty).
  Transient-but-no-usable-cache → `503` with a "please retry" message, not `500`.
