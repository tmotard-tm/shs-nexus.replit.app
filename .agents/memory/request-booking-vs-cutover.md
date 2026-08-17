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

## The branch pin is cutover-only

Rule: any preview gate keyed on the ETD quote's `branchPinned` must be inside the cutover arm. A cutover has a contract branch (the case's `RENTING_BRANCH`) that the replacement must return to, so the runner passes it as `preferBranchCode` and the drift check cross-checks it. A request has NO contract branch — the correct answer for a new rental is the branch nearest the shop address — so the request lane deliberately pins nothing and the quote therefore ALWAYS answers `branchPinned:false`.

**Why:** a lane-neutral pin check made every rental-request preview fail with `branch_not_pinned`, so no request could ever reach Awaiting Confirm and none could ever be booked. It looked lane-neutral sitting directly above a drift check that WAS correctly gated.

**How to apply:** "no branch was pinned" is not the same fact as "no quote happened". Keep a separate gate on the branch CODE being empty (`quote_failed`) so an unquoted/failed-quote preview is still refused by a code that names the real cause instead of relying on the pin check to catch it incidentally.
