---
name: dry_run holds the recon active-target lock
description: Why materialized dry_run reconciliation items silently block real canary/nightly/backfill writes on the same target.
---

# dry_run items reserve the active-target lock against real runs

`reconciliation_items` has a partial unique index `activeTargetUq` on `(system, truck, field)`
WHERE `status IN ('queued','applying','external_applied_cache_pending','retry_scheduled','awaiting_batch')`.

A `dry_run`-kind materialization inserts items with `status='queued'`, which is in that active
set. So a materialized dry_run **holds the cross-run `{system,truck,field}` lock** and a real
(canary / nightly / backfill) run that proposes a correction on the same target gets
**silently dropped** by `ON CONFLICT DO NOTHING`. The executor and verifier both *refuse*
dry_run items (they are report-only), so nothing ever clears the lock — it is held indefinitely.

**Symptom seen:** real canary inserts on specific trucks never appeared; a stale dry_run run
held the lock on those exact `{system,truck,field}` targets. Deleting the dry_run items released
the lock and the real items inserted.

**Why:** a dry_run is a *report*, not a pending write; it must not reserve the target lock.

**How to apply / fix (architect-endorsed):** give dry_run items a distinct **non-active**
status (e.g. `report_only`) so they fall outside the `activeTargetUq` predicate. A Postgres
partial index cannot predicate on a joined `reconciliation_runs.kind`, so either use a
non-active status or denormalize `runKind` onto `reconciliation_items` and exclude it from the
index. Downside (dry_runs no longer reserve targets) is desirable. Immediate risk is mitigated
because the auto-running dev-harness dry_run workflows were removed, but the footgun persists
for any manual dry_run materialized alongside real runs.
