---
name: LOA Recovery duplicate prevention
description: Why LOA Recovery cases doubled across all three queues and the layered guard that prevents recurrence.
---

# LOA Recovery duplicate cases — root cause and the durable guard

The LOA Recovery sync runs on **app startup** and again on the **7:30 AM Tech Data
Scheduler**, and both triggers fire close together on every boot. Its idempotency
step is a non-atomic check-then-create ("is this tech already open?" → create 3
lanes). On a clean state two overlapping runs both saw an empty table and both
created the full FLEET/Assets/Inventory lane set, producing exactly 2 open copies
per (workflow_id, department).

**The durable fix is database-level, not in-process:**
- A **partial unique index** `loa_recovery_open_workflow_dept_uniq` on
  `(workflow_id, department)` WHERE `workflow_type='loa_recovery' AND status IN
  ('pending','in_progress')`. This is the real guarantee — it survives the
  startup-vs-scheduler race and even cross-process overlap.
- The creation path inserts with **ON CONFLICT DO NOTHING** so a racing loser is
  silently skipped (not thrown). `.returning()` is empty on conflict, so the
  created-count stays accurate.
- An in-process coalescing guard (a `runInFlight` promise) is only a cheap first
  line of defense; do not rely on it alone.

**Why:** an in-memory flag alone can't cover overlap; the unique index is what
actually holds. **How to apply:** any "duplicate queue cases" symptom from a
sync that does check-then-create needs a DB-level uniqueness guard + graceful
ON CONFLICT, not just a mutex.

## Index creation ordering trap
The unique index can't be created while duplicates exist. `ensureLoaRecoverySchema()`
must **dedupe first, then create the index** (both idempotent, run every sync).

## Fleet lane column vs data.lane mismatch (preserve it)
A Fleet LOA item stores `department = 'Fleet Management'` in the column (the
`storage.createFleetQueueItem` helper forced this) but `data.lane = 'FLEET'` /
`metadata.lane = 'FLEET'`. Assets/Inventory match in both places. When inserting
LOA items directly (bypassing the storage helpers to add ON CONFLICT), keep this
exact split — set the column to `'Fleet Management'` but keep the embedded lane
label `'FLEET'`, or downstream consumers that key on either value break.

## Dedup keep-priority
When collapsing duplicate open items, keep the most-progressed row so work is
preserved: `in_progress` > assigned (`assigned_to` not null) > started
(`started_at` not null) > responded > earliest `created_at` > id. Delete the rest.
