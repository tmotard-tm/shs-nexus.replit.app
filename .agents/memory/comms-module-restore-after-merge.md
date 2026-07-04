---
name: Comms module data restore after merge
description: Why comms threads vanish after merging the Master Fleet Communications side-task, and the exact restore order.
---

# Comms inbox empty after merging the Fleet Comms side-task

Merging a data-backed side-task brings **code, not its isolated-DB rows**. The
`fs_comms_*` tables live in each environment's own DATABASE_URL DB; a code merge
does not create/populate them on main's (or prod's) DB. Startup `initCommsSchema()`
only runs if the app actually boots past `server.listen()` — if the "Start
application" workflow is stopped/failed, the tables may not exist at all, and the
`/api/fs/comms/threads` route fails soft (returns empty, logs "(no data)").

**Restore = run the documented cutover scripts against the target DB, in this order:**
1. `npx tsx server/run-comms-sync.ts` — self-bootstraps Snowflake, creates schema,
   populates `fs_comms_contacts` from the roster.
2. `npx tsx server/run-comms-migrate.ts` — one-off, idempotent, copy-only backfill
   of `fs_reg_messages` + `fs_decomm_messages` into `fs_comms_threads`/`_messages`.

**Why order matters:** contacts MUST be populated before migrate, or every legacy
message resolves to a phone-keyed **unmatched** thread instead of matching to the
tech's LDAP thread. After a correct run, most threads are `kind='tech'` with a
resolved contact name; a few remain `kind='unmatched'` (no roster match by phone) —
that is expected, not a failure.

**How to apply:** run this per environment separately (dev and prod each have their
own DB). Verify by minting a temp session and hitting
`GET /api/fs/comms/threads?limit=300` — expect the thread count to match
`fs_reg_messages + fs_decomm_messages` row totals collapsed into per-tech threads.

## Port 5000 EADDRINUSE on restart
An orphaned `tsx server/index.ts` process (untracked by the workflow, e.g. lingering
from a merge/session) can hold port 5000, so `restart_workflow` fails with
`EADDRINUSE` and the stale instance keeps serving old data. Fix: find it
(`ps aux | grep 'tsx server/index.ts'`), `kill -9` the parent+child PIDs, then
restart the workflow.
