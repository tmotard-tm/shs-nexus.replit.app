---
name: fs_call_logs.status vocabulary collision (resolved)
description: fs_call_logs.status is lifecycle-only (completed/failed); a boot self-heal enforces it and LUCA is the sole caller after the old batch engine was removed (Aug 2026).
---

Two vocabularies used to share `fs_call_logs.status`: Nexus's own ElevenLabs caller wrote a lifecycle (`in_progress`→`completed`/`failed`) while LUCA write-back stored analyzed display labels ("Ready", "No Answer", …) in the SAME column. Queue code treated any status ∉ {completed, failed} as an in-flight call (phantom "Calling" forever), and `getPendingFollowUps()`'s `status='completed'` filter made LUCA rows invisible to supersede logic.

**End-state (resolved Aug 2026):**
- The mapper writes lifecycle statuses only (unit-tested: "never a display label"); display labels live in `outcome`→UI mapping and `fs_trucks.lastCallStatus`.
- An idempotent boot self-heal in the Fleet Scope schema init rewrites any legacy label rows (`batch_id='LUCA'`, label in status) to `status='completed'` with outcome remapped (Ready/Recovered→VEHICLE_READY; No Answer/Inconclusive→CALL_NO_CONTACT; else VEHICLE_NOT_READY) and closes stranded `in_progress`/`unknown` rows as `failed`. Deploys run no migrations, so prod heals on publish.
- Fleet Scope no longer dials at all: the batch-call engine, ElevenLabs webhook/backfill, and per-truck call buttons are gone. LUCA (dispatched from VRM Rental Operations) is the only caller; the Batch Caller page became read-only Call History.
- Follow-up board = latest `completed` row per truck+type, `VEHICLE_READY` excluded, scoped to active `fs_trucks` — healed-to-`failed` rows never appear; healed label rows now correctly participate in supersede.

**Why:** the write/read contract was never reconciled; the collision pinned trucks to phantom "Calling" and kept stale follow-ups alive after LUCA resolved them.

**How to apply:**
- Never write display labels into `fs_call_logs.status`; new writers must use the lifecycle vocab.
- When extending `rental_call_outcome` values, update BOTH mapper outcome maps AND the Today's Queue `LUCA_STATUS_COLORS` map (unknown labels fall back to a muted pill, not broken styling).
- Queue ready-step nuance: a LUCA-ready truck whose `fs_trucks.mainStatus` is still Repairing/Confirming Status/Decision Pending gets `isConflict=true` by design — the green "LUCA confirmed READY" note only renders when NOT conflicted; the row still reaches the "VEHICLE READY — RETRIEVE ASAP" step with a STATUS CONFLICT action text. Don't mistake this for a heal failure.
