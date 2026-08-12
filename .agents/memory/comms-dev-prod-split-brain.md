---
name: Comms dev/prod split-brain
description: "Inbox previews but empty threads" = thread/message table generation mismatch from an interrupted dev-from-prod refresh; how to diagnose and heal.
---

**Symptom:** comms inbox shows thread previews, but opening threads says "No messages yet" (and category tabs show nothing). Not a filter bug — check data first.

**Diagnosis:** count messages whose `thread_id` exists in `fs_comms_threads` ("msgs_linked"). If msgs_linked ≪ total, one of the two tables was bulk-replaced. Compare a broken thread's ldap against prod: if prod's thread id for that tech equals the dev messages' orphan thread_id, dev messages are a prod copy while dev threads stayed native (or vice versa).

**Why it happened:** the whole-DB dev-from-prod refresh copies per table (TRUNCATE+INSERT); alphabetically `fs_comms_messages` copies before `fs_comms_threads`, so an interrupted run strands every message. (The script has since gained a single dev-side transaction — verify it still has one before blaming something else.)

**Heal:** `scripts/heal-comms-dev-from-prod.ts` — snapshots the whole fs_comms_* family from prod in ONE dev transaction, repairs serial sequences (TRUNCATE-with-explicit-ids bypasses them), and neutralizes copied send-queue rows still pending/claimed.

**How to apply:**
- NEVER copy prod `fs_comms_send_queue` pending/claimed rows into dev without cancelling them — dev's dispatcher would re-send texts prod already owns (double-SMS to real techs).
- After any table copy with explicit serial ids, `setval` the sequence to max(id) or later app inserts collide.
- The comms integration test suite runs the legacy migrate; against a prod-copied messages table its inserts dedupe-conflict and it leaves a few EMPTY threads behind — benign test byproduct, not corruption.

**Stranded rows also break JOIN/EXISTS features in dev (Aug 2026):** after an
interrupted dev-from-prod refresh, ALL historical user-sent outbound rows can
point at thread ids absent from fs_comms_threads — so any EXISTS-per-thread
feature (e.g. the participant filter) legitimately returns 0 in dev while being
correct. Verify such features with (1) a synthetic probe row attached to a real
active thread via the live API + minted session, then delete it, and (2) the same
JOIN as read-only SQL against PROD_DATABASE_URL for real-data counts.
