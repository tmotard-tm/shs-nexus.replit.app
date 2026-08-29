# Rental Booking Premortem Hardening Implementation Plan

> **For agents:** Use the `executing-plans` skill to work through this task by task. Steps use `- [ ]` checkboxes for tracking.

**Goal:** Prevent duplicate or stale external rental bookings and make recovery, legacy identity, startup schema checks, and retired-runner behavior safe before publish.

**Architecture:** Keep the TypeScript executor as the only request-booking engine. Reuse the existing request-scoped advisory lock, attempt ledger, fencing token, and reconciliation states; uncertain external outcomes go to durable review and are never replayed as fresh bookings.

**Tech Stack:** TypeScript, Express, Drizzle/PostgreSQL, Node test runner through `tsx`, Python runner smoke test.

**Verification:** Focused suites must pass; `npm run check` may report the established 224 pre-existing errors but must add zero errors in touched files; `npm run build` and `git diff --check` must pass.

## Global Constraints

- No production database writes, migration application, ETD booking, text, or publish.
- Keep armed-state live access available to signed-in VRM staff; dark-state live access remains admin/developer only.
- A post-open exception is an unknown external outcome, never proof that no booking occurred.
- UUID and numeric aliases for one request must resolve under the same request lock.
- Every production change follows a failing regression test.

---

### Task 1: Fence ambiguous external outcomes

**Files:**
- Modify: `tests/etd-executor-unit.test.ts`
- Modify: `tests/cutover-intents-db.test.ts`
- Modify: `server/vrm/etd/executor.ts`
- Modify: `server/vrm/forms/cutover-orchestrator.ts`

**Interfaces:**
- Consumes: existing `op_open`, `op_result`, attempt number, runner ID, and fencing token contract.
- Produces: a durable unknown/manual-review result that normal booking claims cannot replay.

- [x] Add an executor regression where `op_open` succeeds, the external commit may have landed, and parsing/readback throws; expect exactly one unknown `op_result`.
- [x] Run `npx tsx --test tests/etd-executor-unit.test.ts` and confirm the unknown postback assertion fails.
- [x] Add a DB regression proving an expired ambiguous attempt is excluded from fresh booking work and remains reconciliation-only.
- [x] Run `npx tsx --test --test-force-exit tests/cutover-intents-db.test.ts`; current claim behavior was already reconciliation-only, so this audit item was closed with coverage rather than a production change.
- [x] Track whether external execution opened, post one fenced unknown result from the exception path, and ensure claim selection cannot return unknown attempts as fresh booking work.
- [x] Run both suites plus `npx tsx --test tests/cutover-attempt-ledger-race.test.ts` and confirm they pass.
- [ ] Commit the executor/recovery change. (Not committed: user constraint.)

### Task 2: Read request facts under the booking lock

**Files:**
- Modify: `tests/cutover-intents-db.test.ts`
- Modify: `server/vrm/forms/cutover-orchestrator.ts`

**Interfaces:**
- Consumes: request-scoped advisory lock and source-row `FOR UPDATE`.
- Produces: an intent built only from the locked source version.

- [ ] Add an interleaving regression that mutates branch/date/class/LDAP after an early read but before intent creation; expect current locked facts or a conflict with no intent.
- [ ] Run the DB suite and confirm stale facts are persisted.
- [ ] Move eligibility/input retrieval after the advisory lock and source-row lock, preserving extension, type, status, and booked checks in the same transaction.
- [ ] Run `npx tsx --test --test-force-exit tests/cutover-intents-db.test.ts` and `npx tsx --test tests/rental-request-booking-status.test.ts`.
- [ ] Commit the locked-facts change.

### Task 3: Serialize late failure handling

**Files:**
- Modify: `tests/book-request-dupe-guard.test.ts`
- Modify: `tests/cutover-live-lock-race.test.ts`
- Modify: `server/vrm/forms/rental-request.ts`

**Interfaces:**
- Consumes: the same canonical request key and advisory transaction lock as intent creation.
- Produces: compare-at-write failure/reopen behavior that cannot overwrite a newer attempt or booked state.

- [ ] Add a race regression interleaving failure persistence with intent creation; expect the newer intent/booked state to win.
- [ ] Run the focused race test and confirm the late failure overwrites current state.
- [ ] Put the fence read and failure update in the request lock transaction; require approved, unbooked, expected-state predicates at write time.
- [ ] Cover both review-reopen and normal-failure branches.
- [ ] Run `npx tsx --test tests/book-request-dupe-guard.test.ts` and `npx tsx --test tests/cutover-live-lock-race.test.ts`.
- [ ] Commit the failure-CAS change.

### Task 4: Prove armed and dark authorization semantics

**Files:**
- Modify: `tests/cutover-routes-auth.test.ts`
- Modify only if tests expose drift: `server/vrm/forms/cutover-intents-routes.ts`

**Interfaces:**
- Consumes: `isContractBlockLive()` and `isAdminSession()`.
- Produces: dark live=admin/developer; armed live=signed-in VRM staff; cron/service paths unchanged.

- [ ] Add route tests for non-admin dark rejection, admin dark acceptance, non-admin armed acceptance, and anonymous rejection.
- [ ] Run `npx tsx --test tests/cutover-routes-auth.test.ts`; if current behavior passes, close the audit finding without production edits.
- [ ] If a case fails, minimally align the route with the approved policy and rerun the suite.
- [ ] Commit the policy regression coverage.

### Task 5: Fence historical adoption and canonicalize source aliases

**Files:**
- Modify: `tests/cutover-intents-db.test.ts`
- Modify: `tests/cutover-msg1-adoption.test.ts`
- Modify: `tests/cutover-live-lock-race.test.ts`
- Modify: `server/vrm/forms/cutover-orchestrator.ts`

**Interfaces:**
- Consumes: request UUID/request number aliases, source lock, intent lock, attempt/fencing evidence.
- Produces: one logical request intent and idempotent evidence adoption only onto an eligible matching intent.

- [ ] Add regressions for wrong-request confirmation, disallowed intent state, duplicate callback, and concurrent callback.
- [ ] Add regressions seeding a legacy UUID intent then approving by request number, and the reverse; expect reuse rather than a second row.
- [ ] Run the DB/adoption suites and confirm the unsafe or duplicate cases fail.
- [ ] Resolve the source row first, derive one canonical request identity under lock, and search both legacy aliases before insert.
- [ ] Lock source and intent during adoption; restrict eligible states and match supplied attempt/fencing/evidence when present.
- [ ] Make exact duplicate adoption a successful no-op without duplicate notification.
- [ ] Run all three focused suites and confirm they pass.
- [ ] Commit adoption/source-identity hardening.

### Task 6: Remove startup index-building side effects

**Files:**
- Inspect/modify: `server/vrm/forms/cutover-orchestrator.ts`
- Add: `migrations/20260828_cutover_attempt_token_unique.sql`
- Add or modify: a focused static/migration safety test under `tests/`

**Interfaces:**
- Consumes: existing migration directory and guardrail scripts.
- Produces: startup-only bounded index health check; explicit rerunnable migration artifact using non-transactional concurrent index creation.

- [ ] Add a static regression asserting startup initialization contains no broad duplicate delete and no `CREATE UNIQUE INDEX`.
- [ ] Run it and confirm current startup DDL fails the assertion.
- [ ] Move data diagnostics and index creation into an explicit migration artifact that refuses ambiguous protected duplicates and uses `CREATE UNIQUE INDEX CONCURRENTLY`.
- [ ] Replace startup mutation with a bounded existence/validity check and actionable logging.
- [ ] Run the static test, migration guardrail `bash scripts/guardrails/g3-migration-safety-gate.sh`, and focused orchestrator tests without applying the migration.
- [ ] Commit schema-startup safety.

### Task 7: Keep the legacy request runner fail-closed

**Files:**
- Modify if stale: `etd-runner/README.md`
- Modify: a focused source/smoke test under `tests/`

**Interfaces:**
- Consumes: retired `etd-runner/scripts/book_request.py`.
- Produces: verifiable nonzero exit with no network call and documentation pointing to the TypeScript executor.

- [ ] Add a smoke assertion for nonzero exit and canonical executor guidance, plus a source scan proving no scheduler invokes the retired script.
- [ ] Run it; update documentation only if the test exposes stale guidance.
- [ ] Rerun booking suites and commit the runner retirement guard.

### Task 8: Booking verification and review

- [ ] Run all focused booking, extension, auth, attempt-ledger, and adoption suites.
- [ ] Run `npm run check`, record the baseline comparison, and confirm no touched-file errors.
- [ ] Run `npm run build` and restore build-generated deployment history if changed.
- [ ] Run `git diff --check`.
- [ ] Obtain independent code review and repair all Critical and Important findings.

## Execution record

- RED — `npx tsx --test tests/etd-executor-unit.test.ts` (2026-08-29): failed as expected. New post-open response parsing regression received executor action `ERR` instead of `HOLD`; no durable unknown postback was written.
- GREEN — `npx tsx --test tests/etd-executor-unit.test.ts` (2026-08-29): passed, 82 tests; the parsing failure now records one `unknown` attempt and leaves the intent in `booking_unknown`.
- COVERAGE CLOSURE — `npx tsx --test --test-force-exit tests/cutover-intents-db.test.ts` (2026-08-29): passed, 58 tests. Existing `claimBookingWork` already marks an expired `reservation_state='unknown'` claim `requiresReconcile=true`, preventing a fresh commit. Added regression coverage; no production change required.
- GREEN — `npx tsx --test tests/etd-executor-unit.test.ts tests/cutover-attempt-ledger-race.test.ts && npx tsx --test --test-force-exit tests/cutover-intents-db.test.ts` (2026-08-29): passed. Executor, attempt-ledger race, and DB suites completed with zero failures.
