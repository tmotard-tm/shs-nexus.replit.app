---
name: Boot-DDL concurrency across restart waves
description: Concurrent process boots running the same init-schema deadlock when a batch mixes row writes with index builds in one implicit transaction.
---

Rule: a boot-DDL batch (one multi-statement db.execute) must never mix a data
write (UPDATE/DELETE → RowExclusiveLock held to txn end) with CREATE INDEX
(ShareLock) — two processes booting simultaneously each hold RowExclusive and
block on the other's ShareLock → deadlock 40P01 that cancels whole node:test
suites with red statuses that look like real regressions.

**Why:** a "Start application" restart re-fires every test workflow at once;
each suite runs the same init-schema against the shared dev DB. Hit 2026-08-24
in the vrm_workflow_attempts pre-clean-UPDATE + partial-unique-index batch.

**How to apply:** either split the write into its own db.execute (own implicit
txn, locks release before the index build) or serialize the batch with
`SELECT pg_advisory_xact_lock(hashtext('...'))` as its FIRST statement. The
xact-scoped lock is safe on the pooled driver ONLY inside a no-parameter
multi-statement batch (single implicit txn, auto-release at commit) — session
locks via the pool are the trap documented in
pooled-advisory-lock-not-single-flight.md.
