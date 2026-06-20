---
name: FleetScope shared Snowflake sync lock
description: One Postgres advisory lock serializes ALL heavy Snowflake roster reads (mirror, TPMS snapshot, AMS supplement); any new such reader must join it.
---
All heavy reads of the shared Snowflake roster tables (REPLIT_ALL_VEHICLES, Holman_VEHICLES, UNASSIGNED_VEHICLES, TPMS_EXTRACT) go through ONE session-level Postgres advisory lock, key name `fleetscope-mirror-sync` (defined in `server/fleetscope-snowflake-sync-lock.ts`). Current participants: All Vehicles mirror refresh, TPMS in-process snapshot refresh, AMS truck-status cache's Snowflake supplement.

**Why:** Two heavy concurrent reads of the SAME source table are what trips the Neon-WebSocket drop (closeCode 1006 / empty-message 500). Serializing them removes that surface. The lock name is deliberately the mirror's ORIGINAL name so the key is unchanged across a rolling deploy.

**How to apply:**
- New code that does a heavy Snowflake read of any of those tables MUST acquire this lock too, or the protection has a hole.
- Wrap ONLY the Snowflake-read section, never unrelated slow work — e.g. AMS API pagination stays OUTSIDE the lock; only the REPLIT_ALL_VEHICLES supplement query is inside. Otherwise one job holds the lock for minutes and starves the others.
- Lock is session-level (`pg_try_advisory_lock`) + released in a `finally`, NOT wrapped in a transaction — the work runs against Snowflake for many seconds and must not hold an open PG transaction.
- Policy is per-caller: the mirror uses try-once + skip/reschedule (its own client, reused for the write txn); TPMS snapshot & AMS supplement use `runUnderSnowflakeSyncLock` (poll-acquire up to 120s on a dedicated client, then throw `SnowflakeSyncLockUnavailableError` → the caller's existing catch keeps last-good / skips the supplement). Never nest the lock (would self-deadlock).
