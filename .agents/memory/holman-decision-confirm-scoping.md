---
name: Holman decision confirmation scoping
description: RepairDetails confirm reads must judge only the acted-on line(s); resubmit POs render prior rounds locked with their original decision forever.
---

# Holman decision confirmation scoping

**Rule:** when confirming an Approve/Decline postback on RepairDetails.aspx, judge ONLY the line(s) that were actionable at POST time (keyed by radio value `lineId^po^amount^seq`), never every rendered line for the PO. The pure judge is `judgeConfirmState` in the portal service (unit-tested in tests/holman-decision-confirm.test.ts).

**Why:** a Resubmit PO renders one radio row per authorization round, and prior rounds stay locked with their ORIGINAL decision forever — an earlier approved round's Decline radio is locked-unchecked for life. Judging all lines made a correctly-applied deny read as "opposite decision applied" on any PO with a previously-approved round (= every rental extension), marking it deny_failed and suppressing the redirect SMS (live case 2026-08-24).

**Page-render facts (observed live):**
- Approved lines persist on the render forever as locked+checked history.
- Declined resubmit asks DROP OFF the render entirely (the declined round's row vanishes).
- There is NO completeness marker on the page: an acted-on line missing from the render is "decline likely applied" but reads identically to a partial render — so absence is NEVER `confirmed` (money + redirect SMS ride on that flag). Indeterminate → the resolved_holman grid sweep reconciles from grid truth (it includes deny_failed rows).

**How to apply:** any new confirm/verify read of portal decision state must scope to acted-on line identity and treat absence-from-render as indeterminate, not success or opposite-applied. Grid absence (walkComplete scrape) is the authoritative "decision applied" signal.

## Vanished-Decline grid verification (2026-08-24)

Absence-only "indeterminate" flipped the failure mode: since declined resubmit asks drop off the render, EVERY successful resubmit deny read as DENY FAILED and suppressed the redirect-SMS pipeline (HARRIS/DONHAM live cases). Nothing ever consulted the grid.

**Design now in place:**
- `judgeConfirmState` returns a distinct kind `vanished` when all acted-on lines are absent (still never confirms from the render alone).
- For Decline+vanished only, `submitDecision` runs an authoritative awaiting-grid walk: complete walk + PO absent ⇒ `confirmed`; still listed / partial walk / scrape error ⇒ `pendingVerify` on the result. Approve+vanished stays a failure — approved lines persist forever, so their absence is never success.
- Queue status `deny_pending_verify`: amber "verifying" (non-red, no decide buttons, not re-decidable); the next COMPLETE grid walk finalizes absent rows → `denied` via atomic UPDATE…RETURNING, and the walk caller runs the full deny pipeline (Decision Log, redirect SMS, DCA, Full Log) per returned row, fault-isolated. Atomic transition = sweep can never double-fire the SMS.
- Reopen guard: pending-verify rows keep the PRIOR round's decided_at, so the staleness anchor must be `GREATEST(decided_at, holman_approve_attempted_at)` (NULL-safe in PG) or a fresh attempt reads instantly stale and reopens on the next walk. `deny_pending_verify` is in the reopen set: PO still on grid past grace ⇒ back to the operator.

**Why:** "never confirm from render" is right, but it needs a completion path — an unverifiable success must land in a self-healing pending state that grid truth finalizes, never a terminal FAILED that a human has to notice is a lie.
