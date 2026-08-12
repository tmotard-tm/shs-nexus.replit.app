---
name: Rental request / ETD pre-mortem debts
description: Open, user-visible-risk gaps found in the Aug 2026 end-to-end pre-mortem of the tech survey → rental request → ETD booking pipeline; none fixed yet.
---

# Rental request / ETD pipeline — open debt register (found Aug 12 2026, analysis-only session)

All confirmed by direct code reading + architect review; **none fixed yet**. Check current code before assuming any still holds.

## Booking hand-off integrity (highest)
- ETD booking-queue GET has **no claim/lease** → two concurrent runners double-book.
- `POST /booked` success has **no state predicate or idempotency** (blind `status='booked'` overwrite; replays clobber; late `etd_error` stamps onto booked rows).
- Human `/decide` has **no current-state predicate** → APPROVE/DENY can overwrite a `booked` row, leaving a live ETD reservation on a denied request.
- Fix shape agreed: `claimed_at/by` lease + conditional transitions (`WHERE status='approved' AND etd_booked_at IS NULL`), `/decide WHERE status <> 'booked'`.

## Token/form atomicity (both forms)
- Survey AND rental-request submits are check-then-insert with **no UNIQUE(token_id)** and token consume in a separate statement → concurrent submits create duplicate rows; on rental-request this feeds ETD **duplicate bookings from one token** (architect: worse than the survey case). Fix: one tx + partial unique on active rows per token.
- `/issue` dedupe is NOT-EXISTS (rerun-safe, not concurrency-safe); phone filter applied after LIMIT under-fills batches.
- Public token routes (survey, rental-request, LOA return) have **no rate limiting**; verify endpoints are a token/LDAP oracle. Tokens themselves are strong (randomBytes(16) hex).

## Auth scope
- ETD runner auths via the **all-of-/api/fs cron bearer** (`x-internal-cron`, SESSION_SECRET legacy value accepted, plain `===`). Agreed fix: scoped runner credential valid only for booking-queue/booked/churn-record; then retire legacy bearer. (SESSION_SECRET here is a cron bearer name, not the session-signing key.)

## Send path & funnel
- `/send-chunk` concurrent calls double-send SMS (no claim on `sent_at`).
- Hard-coded fallback base URL `https://SHS-Nexus.replit.app` in issue/send-chunk (+ one spares route) — silent link breakage on domain change.
- `delivered` never populated (no Twilio status callback) — funnel "sent" = handed to Twilio.
- **Product seam (pending Tyler):** survey = rental *reconciliation* tool; rental-request = *front door*. Survey "needs rental" responses do NOT auto-create requests — deliberate ambiguity, needs explicit decision, don't presume auto-conversion.
- External ETD runner (`scripts/churn_sync.py`) is **not in the repo** — unversioned dependency.

## Live-data debts (prod, confirmed by query)
- `ams_declined_repair_check` has **never run in prod**; `separation_enrichment` dead in prod ~6 months; `tpms_snowflake` prod completes with 0 records (dev processed 1582); `truck_inventory` stale 7+ months both envs.
- LUCA writeback items for trucks absent from fs_trucks (e.g. 24118, 36198) retry every 15 min forever — no park/dead-letter state.
- Offboarding: ~890 employees × exactly 5 open duplicate queue items (historical dup event); sync skips 3270/run, nothing prunes; no unique index to prevent recurrence.
