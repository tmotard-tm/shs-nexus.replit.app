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

## Zero-lines indeterminate = second absence shape (2026-08-24, third false DENY FAILED)

A FIRST-ROUND PO renders only its own ask's radios, so a successful decline leaves ZERO decision lines — the judge honestly returns `indeterminate` ("page had no decision lines"), which previously fell through to deny_failed even though the deny applied (grid cleared it minutes later; sweep moved it to resolved_holman, deny pipeline never fired).

**Rule:** for Decline, BOTH absence shapes grid-verify — `declineNeedsGridVerify(state)` = vanished OR indeterminate. Decisive render evidence (`actionable`: line still unlocked, or locked with the opposite decision) still fails loudly, never grid-verifies. Safe because grid verification is evidence-based either way: a decline that never applied stays on the grid ⇒ pendingVerify ⇒ reopen grace hands it back to the operator.

**CAS lesson (review-found):** `markHolmanPoOutcome` must only stamp rows still in an actionable status (`WHERE status IN (...actionable)`), re-reading and returning the standing row on a lost write. Without it, a slow deny request (indeterminate read held behind a grid walk) can overwrite a concurrently finalized `denied` row back to pending-verify — and the next sweep re-finalizes and REPLAYS the deny pipeline (duplicate SMS). Routes echo the standing status, never the stamp they wanted.

**Repair playbook for a stranded false-failure row:** grid absence on a complete walk (or the sweep's own resolved_holman flip after a deny attempt) = proof the deny applied; finalize as denied and run the recordHolmanDecision pipeline pieces (addRentalDecision → tracker sync → supervisor notify → redirect SMS via standing lookup → DCA) from a dev script against prod DB. resolved_holman after a deny attempt is a false-failure signature worth checking.
