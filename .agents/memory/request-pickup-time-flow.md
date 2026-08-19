---
name: Approved pickup time → ETD booking flow
description: How the rental-request approve-time pickup date/time reaches (or fails to reach) the Enterprise reservation, and the retry/display contract.
---

## The rule
Any edit to a request-row field that feeds the ETD quote (vehicle class, pickup date/time) must knock waiting previews back via `invalidateRequestPreviews` at write time. The booking chain COMMITS from the stored `intent.preview.reservation` — it never re-derives from the request row — so a preview quoted before the edit silently books the old value.

**Why:** claim-time facts are fresh (`claimBookingWork` re-runs `fetchEligibilityFacts` per claim), so a NEW preview always quotes current row values. The stale path is exclusively an intent already sitting at `preview_pending`/`preview_ready` when staff re-approve with a changed time. Vehicle-class edits already did this; pickup-time edits were the gap.

**How to apply:** decide route compares in SQL (`${new}::timestamptz IS DISTINCT FROM pickup_at` — string compare false-positives on every approve), invalidates only on real change, before the fire-and-forget auto-book. `confirmed`/`booking` intents are deliberately NOT knocked back: past the retime point, yanking risks orphaning a real reservation.

## Related contracts
- Failed previews land at `preview_required` (resumable by re-approve). `preview_failed`/`eligibility_failed` are error CODES, not statuses — an architect review asserted otherwise; grep before believing status-vocabulary claims.
- `etd_error` must be cleared when a retry attempt is ACCEPTED (guarded `etd_booked_at IS NULL`), or the drawer keeps shouting the old failure through the new attempt and fast outcome-polling never re-arms.
- The RentalRequests drawer holds a click-time snapshot; it needs an explicit sync-from-fresh-list effect or the booking outcome never appears in an open drawer.
- Client sends `YYYY-MM-DDTHH:MM` (no seconds, no offset); server must shape-check before the `::timestamptz` cast or malformed input 500s. Executor time-regexes accept both `T`- and space-separated serializations, so the DB round-trip is safe either way.
