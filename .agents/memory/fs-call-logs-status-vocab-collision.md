---
name: fs_call_logs.status vocabulary collision
description: LUCA writeback stores analyzed display labels in fs_call_logs.status while Nexus consumers treat that column as a call lifecycle (in_progress/completed/failed).
---

Two vocabularies share one column, and each half of the LUCA feature assumes the other one:

- **Nexus's own caller** writes `fs_call_logs.status` as a lifecycle: `in_progress` → `completed`/`failed`.
- **LUCA write-back** (`mapCallOutcome`) writes the analyzed display label ("Ready", "No Answer", "Recovered", "Needs Tow", "Inconclusive - call dropped", …) into the SAME column, with `outcome` from a 3-valued map that defaults to `VEHICLE_NOT_READY`.

**Consequences (verified live in prod 2026-08-02):**
- `/queue/today`'s `latestCallUnresolved()` treats any status ∉ {completed, failed} as an in-flight call → every truck whose latest shop/repair row is a LUCA row (189 trucks) is permanently "unresolved": queue shows "Calling" forever and `lucaReadyFor()` can never fire (LUCA READY trucks never reach the "retrieve ASAP" step via the luca path).
- `getPendingFollowUps()` picks the "latest" call per truck with `WHERE status='completed'` → LUCA rows are invisible, so older Nexus follow-ups stay due after LUCA already resolved the truck (137 live stale follow-ups), and `outcome IS DISTINCT FROM 'VEHICLE_READY'` keeps RECOVERED trucks (logged as VEHICLE_NOT_READY) on the follow-up board.

**Why:** the mapper's comment claims the latest `call_type='repair'` row is "the authoritative LUCA status source" while the queue code's comment asserts the column is lifecycle-only — the contract was never reconciled.

**How to apply:** any fix or new consumer of `fs_call_logs` must decide per-row which vocabulary `status` holds (e.g. `batch_id='LUCA'` marks label rows), or the write path must move labels out of the lifecycle column. When extending `rental_call_outcome` values, update BOTH `OUTCOME_TO_STATUS` and `OUTCOME_TO_LOG_OUTCOME` — the latter's default (`VEHICLE_NOT_READY`) silently mislabels terminal outcomes like RECOVERED.
