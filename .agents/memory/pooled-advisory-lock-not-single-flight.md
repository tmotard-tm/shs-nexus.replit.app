---
name: Pooled advisory locks don't single-flight
description: pg_try_advisory_lock via a connection pool is not mutual exclusion and leaks on unlock
---
`pg_try_advisory_lock`/`pg_advisory_unlock` issued through a node-postgres **pool** (each query on an arbitrary connection) does NOT provide single-flight:
- unlock may run on a different connection → silently fails → lock leaks until the holding connection recycles (spurious 409 lockouts);
- advisory locks are **re-entrant per session** — while request #1 awaits an external HTTP call, its lock-holding connection sits idle in the pool; a concurrent request #2 that draws the same connection "acquires" the lock and both proceed (double-send risk).

**Why:** Found in the rental-survey send-chunk route during the pre-send audit; the send's double-text safety rested entirely on this broken lock plus post-hoc sent_at stamping.

**How to apply:** For real single-flight, check out ONE dedicated client for lock+work+unlock, or use a DB uniqueness constraint / status CAS on the rows themselves. Also: batch "issue"/mint endpoints need a partial unique index per (subject, type, live) — NOT EXISTS alone races.
