---
name: Cutover Holman-book anchoring
description: Invariants for the cutover page's "On Holman book" state — source collision, booking-time anchors, text-date discipline.
---

# Cutover Holman-book anchoring — invariants

## enterprise_direct collides with the ECARS book
The rental-ops cases store mixes the ECARS/Holman-billed book with the NEW
direct-billed replacement rentals under the IDENTICAL vendor string
'Enterprise Rent-A-Car'; only the `source` value ('enterprise' vs
'enterprise_direct') separates them.
**Why:** vendor-only filtering matched the tech's own replacement rental and
mass-flagged it as the old ticket "rolling past the swap" (a `direct:%`
resolution method in the match output is the tell).
**How to apply:** every "on the Holman book" read must restrict to the ECARS
source. Direct rows never appear in the raw ECARS feed history — quick check.

## Anchors are booking-time evidence, one case row per truck
Case rows are keyed per truck and OVERWRITTEN on reassignment (ticket, renter,
and identity resolution all flip to the new renter).
**Why:** read-time matching grabs whoever holds the truck NOW; and the old
renter is only recoverable from the immutable raw-feed history, re-resolved by
name.
**How to apply:** book state rides ticket anchors snapshotted at booking.
Never force-overwrite a non-empty anchor (the old rental's identity never
changes across re-books; the ticket may have since dropped off the book, so a
re-snapshot records [] and erases evidence). Empty anchors may upgrade anytime.

## Text-date discipline
Reservation/pickup and import-run file dates are free TEXT; a
regex-shaped-but-impossible value ('2026-02-31') makes any ::date cast THROW
(500s the endpoint / aborts scripts), and JS Date silently normalizes it.
**How to apply:** compare ISO date strings lexicographically in SQL (no casts),
compute day-diffs in TS only after a round-trip validity check, degrade bad
input to null/stale — never a confident wrong answer.
