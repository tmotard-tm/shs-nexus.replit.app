---
name: Holman assign 202 is not confirmation
description: Why a Holman vehicle-assignment submit can "succeed" (202) yet never apply, and how to tell a Holman-side driver problem from a Nexus bug.
---

# Holman assignment: 202 Accepted ≠ applied

Holman's `submitVehicleArray` returns `202` with body like
`"[1] record submitted. [0] records rejected due to errors. [1] record successfully captured for processing."`
(errorCount 0, echoing back the validated payload) **even when Holman later silently fails to apply the change.**
The 202 means "queued/validated for async processing," NOT "the vehicle now has this driver."

The only ground truth is the **post-sync fleet data**: `holman_vehicles_cache.holman_tech_assigned` /
`holman_assigned_status_cd` *after* the next real Holman fleet sync (`last_holman_sync_at` must be newer than the
submission time). This is exactly what the `HolmanVerify` polling loop checks; if it expires (default 5 polls / ~20 min)
with the cache tech still `UNKNOWN`/empty, Holman dropped the assignment.

**Why:** Nexus writes an *optimistic* mirror (`holman_tech_assigned=<tech>`, status `A`) into the cache immediately
after submit, with `last_local_update_at` newer than `last_holman_sync_at`. That optimistic row makes the UI look
assigned for a window even though Holman never confirmed. Don't trust a cache row whose `last_local_update_at` is
newer than its `last_holman_sync_at` — that's the optimistic write, not Holman truth.

## Diagnosing "I changed district but still can't assign the tech"
1. District change and the assign are **separate** operations. Confirm the district piece actually landed
   (cache `district` = padded target, TPMS confirmed). It usually has — the real failure is the assign.
2. Pull `holman_submissions` (PRODUCTION db; the user acts on the deployed app, so dev db is stale) for that
   `holman_vehicle_number`, newest first. Look at `action`, `enterprise_id`, `status`, `error_message`,
   `last_observed_tech`.
3. **Signature of a Holman-side driver problem:** the *same driver* fails repeatedly across many days
   (`status=failed`, `error_message` "Verification expired… last observed in Holman: UNKNOWN") while a
   *different driver* assigned to the *same vehicle* `completed`. That isolates the issue to that driver's Holman
   record, not Nexus code. Nexus submitted a well-formed payload that Holman accepted (202, 0 errors).
4. Leading external cause: the driver is still the active assigned driver on **another** Holman vehicle, and Holman
   won't duplicate/move them. Nexus can't see it if that vehicle is outside the cached divisions (`01`/`RF`).
   Resolution is on the Holman side (clear the driver's existing assignment / fix the driver record), not a code change.

**How to apply:** When a user reports an assignment that "won't take," verify against post-sync cache + the
`holman_submissions` history before touching code. If a 202 with errorCount 0 is followed by `UNKNOWN` in the next
sync, the bug is in Holman's processing, not the submit path — don't "fix" the (correct) assignment code.
