---
name: Completion review races validation on the shared dev DB
description: Why strict cross-surface DB suites fail nondeterministically only during markTaskComplete validation, and how to make them immune.
---

**Rule:** Strict cross-surface alignment suites (payloads compared row-by-row against
the shared dev DB) must treat ZZ*-prefixed rows as synthetic fixtures — scrub them from
row-level comparisons and give the coherence/rebuild loop enough patience (retries with
~10s+ backoff) to outlast a concurrent fixture suite's seed→clean window.

**Why:** The completion code review runs concurrently with the validation shell
commands and it EXECUTES the task's DB-backed test suites itself. Those suites seed and
clean ZZ* fixtures on the same dev database mid-validation, so an alignment suite sees a
fixture row in one surface build and not the next ("case sets differ" by ZZANC-*,
openTotal off by the fixture count). The suite passes every time it is run alone —
the failure exists only inside validation runs.

**How to apply:** When a validation-only failure shows fixture-prefixed keys (ZZ*) in a
set diff, don't hunt for a data bug or leftover rows (the DB will be clean by the time
you look) — the churn came from the reviewer re-running fixture suites. Fix the strict
suite's tolerance, not the fixtures. ZZ* is the reserved synthetic-key prefix
(ZZANC*, ZZPROBE*); new DB fixtures should keep using it so the scrub keeps working.

For DB-backed workflow suites, put the random run namespace immediately after `ZZ`
rather than after a stable suite stem. Cleanup and every global claim/recovery sweep
must accept that exact namespace; broad application sweeps must exclude reserved `ZZ`
identities. Exact-ID operations are already isolated and may still serve fixtures.

**Why:** A unique suffix such as `ZZEXEC<run>` is still inside an older runner's
`ZZEXEC%` cleanup scope, and per-row cleanup alone does not stop a global queue or
recovery sweep from leasing or settling another run's rows.

**How to apply:** Use an alphanumeric, schema-length-safe `ZZ<random><suite>` prefix,
validate it before composing a SQL `LIKE`, scope test sweeps to it, and repeatedly run
the DB suites as separate parallel processes.

## Restart-all suite flakes (same family)

Restarting the app workflow re-fires every test workflow simultaneously.
Suites that run shared boot DDL (e.g. the cutover pair via initFormsSchema)
can deadlock each other (40P01), and live-surface comparison suites can catch
a board built in degraded mode (best-effort attachments like the reconciled
shop catch→null and SKIP their field under load). Strict alignment suites
must fold every degrade-by-design signal into their coherence-rebuild gate,
not assert against a degraded payload. A red suite right after a restart wave
or inside a validation run is suspect — rerun it alone before treating it as
a code bug.
