---
name: Request booking vs cutover workflow split
description: Rental-request booking is its OWN workflow — route blocks and cutover texts are cutover-only; requests complete on a verified reservation
---
Rule: the rental-request booking workflow shares the intent safety machinery (eligibility → immutable preview → Confirm CAS → runner booking → journey readback) but is NOT a cutover. It never files an ART route block and has no cutover texts. Request intents are born with `block_state='not_applicable'`; completion = `reservation_state='verified'` alone (checked right after verification readback); display phases never include block lanes.

**Why:** User directive (2026-08-16): route blocks exist only for cutovers; a NEW rental request protects no existing route — the tech is picking up a fresh unit. This resolved the old "request ART rules pending approval" park (`skipped_pending_rules`) into a permanent policy.

**How to apply:**
- Any new intent lane/surface must branch on `workflow_type`, never assume cutover shape. Block sweeps key on block-lane predicates (`block_submitted_at`, open art_block attempts, `block_state` retry) which requests can no longer satisfy.
- Legacy block-shaped request rows are healed at boot (forms-schema ensure) and lazily by the filing gate → `not_applicable`.
- If request SMS is later approved, add msg conditions to the REQUEST arm of completion — do NOT re-add blocks or reuse cutover text templates.
- Booking postbacks are terminal-idempotent: verified-readback and completion writes are status-CAS'd so duplicate/late postbacks can never revive completed/cancelled intents.
- UI: the shared intent panel branches on workflow — requests say "Rental booking workflow"/"Start booking workflow", no Route block / Text rows, live-confirm copy mentions only the reservation.
