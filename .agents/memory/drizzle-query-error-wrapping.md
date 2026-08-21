---
name: Drizzle wraps pg errors — constraint checks on e.message are dead code
description: Duplicate-key race handlers matching unique-index names must walk e.cause, not e.message
---

Drizzle's `db.execute()` throws a wrapper error whose `message` is `Failed query: <sql>` — the SQL text only. The real pg error (message `duplicate key value violates unique constraint "<name>"`, plus `.constraint` and `.code === '23505'`) lives on `e.cause`.

**Why:** Race handlers written as `String(e?.message).includes("<index_name>")` match NOTHING, so genuine duplicate-key races fall through to the generic 500 instead of the friendly 409. Proven on the box 2026-08-21: the rental-request token door's ext_pending_uniq handler had never worked; caught by tests/rental-extension-token-door.test.ts.

**How to apply:** Any catch that branches on a unique-index/constraint name must walk the cause chain (bounded depth) and check both `err.constraint` and `err.message` — see `isUniqueViolationOn()` in server/vrm/forms/rental-request.ts. Audit new code for the `e.message.includes("<constraint>")` shape; one known remaining instance sits in cutover-orchestrator's intents live-nonterminal handler (flagged as a follow-up task).

**Testing the race deterministically:** liveRequestGuard-style pre-checks often have a lookback window (30 days) the unique index does not. Seed a conflicting row older than the window: the guard passes, the real index fires at insert — the exact guard-passed/index-fired race shape without any timing dependence.
