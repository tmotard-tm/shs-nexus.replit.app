---
name: Comms API duplicate-send guard
description: 24h identical-message dedupe on machine API send surfaces after the Aug 2026 retry-storm duplicate-blast incident
---

# Comms API duplicate-send guard

**Rule:** All machine API send surfaces (`/comms/api/send`, `/send-batch`, `/bulk`) drop any message whose exact (last-10-digits phone, body, category) was already sent or is pending/claimed in the last 24h. `{"allowDuplicate": true}` in the request body is the intentional-resend escape hatch. UI/human sends are deliberately NOT deduped.

**Why:** External caller (svc:comms-api rental reminders) retried `/send-batch` ~6x when the awaited per-recipient loop exceeded its HTTP timeout during quiet-hours enqueue — 6 identical queue rows per tech, techs got 4–5 copies at 8 AM. The queue drain's CAS claim was innocent; duplication was duplicate *enqueues*.

**How to apply:**
- Checks are sargable equality on `phone_digits` (both queue rows and outbound messages always store normalized digits on insert) backed by boot-DDL indexes `idx_fs_comms_send_queue_dedupe` / `idx_fs_comms_messages_dedupe`. Never rewrite them as regexp-over-coalesce — per-recipient seq scans made the handler slow enough to *cause* the timeout-retry loop.
- Bulk audiences must use the set-based `findRecentDuplicateDigits()` (one query per table via a VALUES join with per-element binds — array binds are mangled by the pg pool driver), not per-recipient `isRecentDuplicateSend()` loops.
- Failed/undelivered prior sends intentionally do NOT count as duplicates (a failed send must stay retryable).
- Residual risk (accepted): truly concurrent identical requests can both pass the read-before-write check; the durable fix is an idempotency key/ledger at the enqueue write boundary (proposed as a follow-up task).
