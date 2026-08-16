---
name: External-op authorization fencing
description: Authorizing irreversible external side-effects (bookings, filings) under claim/lease concurrency — atomic gates, one-open indexes, reconcile-first recovery, kill-switch placement, bearer-only evidence routes.
---

# External-op authorization fencing

## Rule 1 — authorize in the SAME statement that records the op
Read-then-insert is a TOCTOU hole: the lease can lapse between them, and `attempt_no = MAX+1` gives rivals DISTINCT numbers, so a `(id, phase, attempt_no)` unique key does not stop a double external commit.
**How to apply:** claim predicate (holder + fencing token + unexpired lease) as a CTE `UPDATE ... RETURNING` that also renews the lease; the evidence INSERT gated `WHERE EXISTS (gate)` — one statement. Zero rows → re-read only to produce a precise 409.

## Rule 2 — same-holder double-fire needs a DB-level "one open op" invariant
The atomic gate fences rivals, not the same holder firing twice (HTTP retry, dup process). `NOT EXISTS (open attempt)` inside the statement is NOT reliable under READ COMMITTED (after a lock wait, subplans can evaluate against the pre-commit snapshot).
**How to apply:** partial unique index `(parent_id, phase) WHERE outcome IS NULL`; map its 23505 to the same "reconcile first" 409. Ship the index with a pre-clean UPDATE (keep the newest open row) so it builds on dirty data.

## Rule 3 — every "committed but unverified" shape needs a driven recovery lane
A worker can die (a) between the external ack and its verification readback, or (b) between opening the attempt-ledger row and writing its outcome. Neither state may strand.
**How to apply:** (a) the claim query gets a reconcile-first lane keyed on status+state — readback before any rebook; "no open attempt" ≠ "no external state" (outcome writers close rows even for `unknown`). (b) an OPEN attempt fences new filings until a readback resolves it: adopt (found upstream), clear-and-refile (provably absent from a post-open snapshot), or manual review (fresh snapshot shows near-miss rows — never refile over a possibly-mangled landing); ambiguous evidence keeps the attempt open and the lane fenced. Finalize ORDER everywhere: parent-state write FIRST, attempt-close LAST (guarded `AND outcome IS NULL`) — a crash then re-presents as parent-advanced + open attempt, which the lane re-resolves idempotently; the reverse order un-fences filing beside a stale claimable parent (the double-file window). Also sweep the inverse crash shape: claim state (`filing`) + NO open attempt + aged = provably nothing POSTed → re-park retryable.

## Rule 4 — kill switches gate the FILING boundary, not just entry points
Gating claim/confirm/verify entry is not enough: work verified while armed files LATER (sweep retries, postbacks). If the sender POSTs whenever config exists, a `live` flag that only shapes the payload is NOT a gate — a mid-flight disarm still sends.
**How to apply:** re-check the switch immediately before the attempt INSERT + POST; park frozen lanes retryable (`retry` + next_retry_at) so disarm = pause, re-arm = resume, zero attempts inflated. Read-only reconcile (Rule 3b) runs BEFORE the switch check — ledger truth outranks arming. Retry sweeps must never pre-NULL their eligibility timestamp (a crash strands the row); push it forward lease-style instead.

## Rule 6 — recovery writers are concurrent too: serialize per item, write monotonic
Overlapping reconcilers (cron sweep + admin trigger + a filer's inline pre-check) read snapshots that advance mid-flight, reach DIVERGENT verdicts, and interleave parent writes — a stale "no trace" can re-arm retry over a rival's just-adopted landing → refile → double external commit.
**How to apply:** lease-CAS claim on the open ATTEMPT row itself (`reconcile_claimed_at` NULL-or-aged → now, `RETURNING`; zero rows = judged elsewhere, exit with zero writes; release on ambiguous exits) — not a parent state like `reconciling` (clobbers the state being judged) and not pooled pg advisory locks (don't single-flight). Belt-and-braces: every recovery parent write is a guarded UPDATE allowing only states a filing can still own — the dangerous downgrade (no-trace → retry) lands only on pending/retry/filing, NEVER over accepted/conflict/manual; zero rows = stale evidence → leave attempt open, re-judge next pass.

## Rule 5 — evidence-postback routes are bearer-only; fencing tokens are NOT identity
An allowlist that grants a cron bearer a bypass and otherwise falls through to session auth silently authorizes every logged-in user on the runner surface: they can claim the queue, learn tokens, and post fabricated op_open/booked/readback evidence the orchestrator trusts.
**How to apply:** the ROUTER enforces the bearer itself (timing-safe compare, no session fallback) on claim/postback/schedule routes; staff-triggerable sweeps get cron-OR-privileged-role. Prove with route tests: session → 403 with the gate's own code; bearer → the handler's missing-param 400. The older rental-request booking/record-booking lanes still carry the fallthrough hole.
