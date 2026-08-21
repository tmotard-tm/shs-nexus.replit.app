---
name: Drizzle wraps pg errors — constraint checks on e.message are dead code
description: Duplicate-key race handlers matching unique-index names must walk e.cause, not e.message
---

Drizzle's `db.execute()` throws a wrapper error whose `message` is `Failed query: <sql>` — the SQL text only. The real pg error (message `duplicate key value violates unique constraint "<name>"`, plus `.constraint` and `.code === '23505'`) lives on `e.cause`.

**Why:** Race handlers written as `String(e?.message).includes("<index_name>")` match NOTHING, so genuine duplicate-key races fall through to the generic 500 instead of the friendly 409. Proven on the box 2026-08-21: the rental-request token door's ext_pending_uniq handler had never worked; caught by tests/rental-extension-token-door.test.ts.

**How to apply:** Any catch that branches on a unique-index/constraint name must walk the cause chain (bounded depth) and check both `err.constraint` and `err.message` — shared helper `isUniqueViolationOn()` in server/vrm/forms/db-errors.ts. The wrapper also has NO `.code`, so `e?.code === "23505" || /duplicate key value/.test(e.message)` handlers over `db.execute` are equally dead — several remain (cutover-orchestrator attempt-ledger catches, fleet-scope-routes, vehicle-create-verification-service; flagged as a follow-up).

**Deterministic index-race seam for intents:** fetchEligibilityFacts' live-lock pre-check SKIPS an orphaned rental_request intent (source row gone), but the live_nonterminal_uq partial index has no carve-out — seed an orphan live intent to fire the real index past the gate (tests/cutover-live-lock-race.test.ts).

**Testing the race deterministically:** liveRequestGuard-style pre-checks often have a lookback window (30 days) the unique index does not. Seed a conflicting row older than the window: the guard passes, the real index fires at insert — the exact guard-passed/index-fired race shape without any timing dependence.
