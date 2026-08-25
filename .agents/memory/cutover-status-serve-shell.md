---
name: Cutover scoreboard serve shell
description: Transient-failure serving contract for the cutover-status payload — single-flight, last-good fallback, and the invalidation rule every new mutation writer must follow.
---

The Cutover Tracking scoreboard's GET is served through a single-flight shell
(leaf module `cutover-status-cache.ts`): one build/retry sequence per instance
no matter how many concurrent requests, retry-once after a pause, then a
bounded (15 min) last-good payload marked `{ stale, staleAsOf }`, and only
then a concise 500.

**Why:** 2026-08-25 prod incident — a cold boot + startup sync made the ~9s
status query fail transiently, and the page showed drizzle's
"Failed query: <18KB SQL>" wrapper as the error banner. The schema/data were
fine. Without single-flight, N open boards + the client's global 5xx retry
would multiply the heavy query exactly when the DB is degraded.

**How to apply:**
- Any NEW mutation that changes what the scoreboard shows (stamps, voids,
  overrides, anchors, book state) must call `invalidateCutoverStatusCache()`
  or the last-good fallback can mask that write for up to 15 min. Current
  callers: billing-void, book-override, direct-billing import stamp pass.
- Surfacing a DB error to any VRM page: use `rootDbErrorMessage()`
  (db-errors.ts) — walks e.cause, appends the pg code, never returns the SQL
  dump; an empty Neon-drop root message maps to a generic line.
- Diagnostic recipe that cracked this: patch `db.execute` in a dev tsx script
  to capture the dialect-compiled SQL of a payload builder, then replay it on
  prod inside `BEGIN READ ONLY` — the raw pg error (or a clean success)
  settles "schema drift vs transient" in one step.
- The direct-billing import's `buildCutoverStatusPayload({includeAllStamped})`
  call bypasses the shell ON PURPOSE — its conflict scan must never read
  cached/stale data.
