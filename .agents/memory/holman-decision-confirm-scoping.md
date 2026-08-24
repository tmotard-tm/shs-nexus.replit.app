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
