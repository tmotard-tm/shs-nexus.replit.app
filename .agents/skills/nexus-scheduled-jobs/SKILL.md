---
name: nexus-scheduled-jobs
description: How to add or debug recurring/background jobs in Nexus (syncs, crons, queues, outreach sends). Use whenever a task involves setInterval, node-cron, scheduled deployments, internal-cron routes, sync_logs, or "why didn't the sync run".
---

# Nexus Scheduled Jobs (wake-up-call pattern)

## The platform reality

Nexus runs on a Replit **autoscale** deployment: instances scale to zero, so in-process `setInterval`/`node-cron` timers do NOT fire dependably. Replit allows only ONE deployment per Repl and this Repl's slot is the web app, so a Nexus-side Scheduled Deployment **cannot** be created. Do not re-point the deployment to a Reserved VM just to run timers (Tyler directive, 2026-07-18).

**The ONLY supported recurring trigger is a wake-up call:** the always-on Fleet Agents / LIVHR Reserved VM (`fleetagents.replit.app`, scheduler in its `server/schedulers/nexus-sync.ts`) POSTs a Nexus internal-cron route on a cron cadence.

## Adding a new recurring job

1. Build the work behind an internal-cron route on Nexus:
   - Auth: header `x-internal-cron: <NEXUS_CRON_SECRET>` (see `server/fleet-scope-routes.ts` ~2830; SESSION_SECRET accepted as legacy). Grants that route only — no send/bulk powers.
   - Register the route OUTSIDE the session/comms gates (the dispatcher has no session user).
   - Make it idempotent; decide gating (ET-hour window, daily watermark) SERVER-side inside the route, so the scheduler can poke every 5–15 min.
   - Take a Postgres advisory lock if it mutates shared state.
   - Record a `sync_logs` row (`running` → `completed`/`failed`; `triggered_by='scheduled_dispatcher'`).
2. Add a one-line wake-up POST on the Fleet Agents VM scheduler at the desired cron.
3. Verify via `sync_logs` and the job's health/report route.

Existing examples: `POST /api/fs/rental-sync` (11:00 UTC), `/api/fs/roster-sync` (10:00 UTC), `/api/fs/comms/cron/drain` (every tick), `/api/fs/luca-writeback/run` (15 min), `/api/fs/ams-declined-check/run`.

## Conventions

- **Watermarks**: "already ran today" = latest **completed** `sync_logs` row of that sync type. Only `completed` advances the watermark; `skipped`/`failed` never do.
- **In-process timers may exist as best-effort warm paths only** — never as the primary trigger.
- **Auditing reality**: to know whether a job actually runs in prod, query `sync_logs` and `max(updated_at)` on the target tables — never trust the coded schedule.
- Standalone `npx tsx server/run-*.ts` scripts self-bootstrap Snowflake explicitly (`initializeSnowflakeService()` before the sync); a script that skips explicit init silently no-ops in dev.

## Deeper reading

- `replit.md` → "Scheduled dispatch (actual implementation)" and "Adding a scheduled sync job (wake-up-call pattern)"
- `.agents/memory/prod-sync-schedule-reality.md`, `.agents/memory/autoscale-listen-first.md`, `.agents/memory/quiet-hours-deferral.md`
