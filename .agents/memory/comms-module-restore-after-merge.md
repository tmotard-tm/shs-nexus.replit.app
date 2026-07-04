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

**Restore = run the cutover scripts against the target DB. Correct order is
sync → migrate → sync (the sync must run BOTH before AND after migrate):**
1. `npx tsx server/run-comms-sync.ts` — self-bootstraps Snowflake, creates schema,
   populates `fs_comms_contacts` from the roster. (Its enrich/merge/auto-archive
   tail no-ops here because no threads exist yet.)
2. `npx tsx server/run-comms-migrate.ts` — one-off, idempotent, copy-only backfill
   of `fs_reg_messages` + `fs_decomm_messages` into `fs_comms_threads`/`_messages`.
   Phone-matches to the contacts from step 1 → `kind='tech'` threads; the rest land
   as phone-keyed `kind='unmatched'`.
3. `npx tsx server/run-comms-sync.ts` AGAIN — now that threads exist, its tail runs
   `enrichThreadContacts()` (stamps original tech name/LDAP from legacy tech_id /
   contact_name, promotes current-roster techs to `kind='tech'`),
   `mergeResolvedUnmatchedThreads()`, and `bulkArchiveUnmatched()`.

**Why the final sync is the important half:** enrich + merge + **auto-archive of
unmatched** run at the TAIL of the contacts sync, and they need the migrated THREADS
to already exist. Skipping the second sync (or running sync only before migrate)
leaves raw phone-keyed unmatched threads sitting in the ACTIVE inbox with no
name/LDAP. After the correct sequence: current-roster techs → active `kind='tech'`
threads keyed by LDAP; every other legacy thread → keyed to its ORIGINAL tech
(name/LDAP stamped where the legacy row had it) and **auto-archived** (moved to the
Archived tab, recoverable) because it doesn't match a current tech. Decomm rows only
carry a contact_name literal (no LDAP), so their archived threads are name-keyed —
that is correct, not a failure. Active unmatched count should end at 0.

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
