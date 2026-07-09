---
name: Batch outbound-call safety pattern
description: Why batch endpoints with real-world side effects (phone calls/SMS) must never await the batch in the HTTP handler, and how re-dial dedup must work.
---

# Batch outbound-call safety (ElevenLabs Batch Caller)

**Rule:** An HTTP handler that triggers a batch of real-world side effects (outbound phone calls, SMS) must respond immediately (fire-and-forget + status polling), never await the batch.

**Why:** On autoscale, the platform proxy kills responses held open ~60–100s. The client sees an error while the server keeps dialing → the user retries → real repair shops/technicians get called twice. This was flagged CRITICAL in a pre-publish review (July 2026).

**How to apply:**
- Server: `void (async () => {...})()`, respond `{batchId, total}`; client polls a status endpoint; cancel is a server-side flag.
- The retry itself must be made safe with a DB-backed dedup guard: skip a target if a call log with same callType, status !== 'failed', within 30 min exists. The guard is the real fix — transport-level fixes alone can't prevent double-dialing.
- Timeout ambiguity: if the dial request times out (AbortController), the call MAY have been placed — write a guard-visible log (status 'unknown', not 'failed') so a retry is still blocked.
- Client poll must treat repeated 404s as terminal (in-memory job state dies with the instance), not transient — otherwise it spins forever.
- Dedupe target IDs in the request body server-side; duplicates can each pass the guard before either writes a log.
