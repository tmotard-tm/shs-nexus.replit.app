---
name: Prod sync schedule reality (autoscale)
description: How to audit whether scheduled syncs actually run in production, and what the July 2026 audit found
---

The entire `server/sync-scheduler.ts` schedule (nightly 5AM sync, 15-min TPMS/AMS watermark polls, 30-min separation poll, 4-hr stale sweep, etc.) is in-process `setInterval` — on the autoscale deployment it only fires while an instance happens to be awake. The designed schedule is fiction in prod; only platform Scheduled Deployments and cold-start catch-ups actually run.

**Why:** July 2026 audit evidence: `external_watermark_state` was completely EMPTY in prod (the 15-min AMS/TPMS watermark polls had never persisted a single run); `fs_all_vehicles_mirror` was 6 days old (daily job); `all_techs` nightly last completed at 15:39 UTC (a cold-start catch-up, not 5AM); `separation_poll` (30-min) had 15-hour gaps; `comms_contacts` ran 2× in 14 days.

**How to apply:**
- Never assume a sync-scheduler job runs on cadence in prod. Ground truth = `sync_logs` (`GROUP BY sync_type,status`, `max(COALESCE(completed_at,started_at))`) and per-table `max(updated_at/synced_at)`.
- `updated_at` age ≠ staleness for change-only upsert syncs (holman_vehicles_cache old rows are just unchanged); it IS staleness for mirrors whose feed is dead (ams_vehicles_cache assignments).
- Any job that must run dependably needs a standalone `server/run-*.ts` script + platform Scheduled Deployment (rental-sync pattern), not an in-process timer.
- `fs_samsara_locations` (DB fallback for live Samsara cache) can be months old — it's a last-resort fallback, don't treat as current.
