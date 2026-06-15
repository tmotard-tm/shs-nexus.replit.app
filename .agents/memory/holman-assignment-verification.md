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

## District changes now use the same async verification as assign (false-success FIXED)
`/api/fleet/vehicle/:truckNo/district` used to set `holman = { success: true }` on the bare 202 with no
tracking — a lie when Holman silently dropped the change. It now mirrors the assign flow: it records a
`holman_submissions` row with `action='district'` + `scheduleVerification`, returns
`holman={success:false, pending:true}` (response `success` = `tpms && wms && holman.success`, plus an
`accepted` flag = `tpms && wms && holmanPending`), and only reports success once the prefix is confirmed in
fresh fleet data. Durable constraints a future edit must NOT break:
- **The sync FREEZES `cache.district` on conflict** (the `onConflictDoUpdate` in
  `holman-vehicle-sync-service.ts` re-sets `district` to its own current value via `sql`). So
  `verifyFromFleetData` is the ONLY authoritative place that persists a Nexus-initiated district change to
  `holman_vehicles_cache.district`. **Never** re-add an optimistic district mirror in the route — the sync
  freeze overwrites it and the card stays stale. (Assign's optimistic-mirror trick does NOT work for district.)
- **Submission key = RAW un-padded `holmanVehicleNumber`** (the cache row key, e.g. `"37251"`), NOT
  `paddedVehicle` (`"037251"`). It must equal the `verifyFromFleetData` lookup-map key, which uses the same
  fallback chain as the cache writer: `holmanVehicleNumber || clientVehicleNumber || vehicleNumber`.
- **In the fleet-sync GET response, `v.prefix` is the 4-digit district prefix** (it populates
  `cache.district` at `district: v.prefix || v.district`). `v.division` is the division (`01`/`RF`) — do not
  confuse them when verifying. Compare `normalizePrefix(targetPrefix)` to `normalizePrefix(vehicle.prefix ?? vehicle.district)`.
- **`normalizePrefix` must return `''` for no-digit input** (then last-4 + `padStart(4,'0')`). If it padded
  `''` to `'0000'`, the empty-target guard would pass and a malformed payload could false-match a real `0000`.
- If `createSubmission`/`scheduleVerification` throws after the 202, return `holman={success:false, pending:false, error}`
  — never `pending:true` without a durable verifier, or the card freezes forever.

**Why this breaks the downstream assign:** if the district move to the new prefix never lands in Holman, the
vehicle is still in its OLD prefix. Assigning a tech whose district = the NEW prefix is then dropped by Holman,
while a tech in the OLD prefix assigns fine. So "changed district, now can't assign the tech" is often really
"the district change never applied in Holman" — verify the live prefix first.

## Read Holman's live ground truth (don't trust the Nexus cache)
The cache `district`/`holman_tech_assigned` is an optimistic mirror. To get Holman's real current record, query
the live API by paginating **basic-query GET** (`/vehicles/basic-query?lesseeCodes=2B56&statusCodes=1&pageSize=1000&pageNumber=N`)
and match `holmanVehicleNumber`. Read `prefix` (=district last-4), `division`, `clientData3` (region),
`assignedStatus`, `assignedStatusCode`, `clientData2` (assigned tech ent id), `firstName/lastName`, city/state.
NOTE: `/vehicles/custom-query` POST currently 400s with `"The statusCode field is required."` — the
`{lesseeCodes, additionalFilters, paging}` body is rejected; `findVehicleByNumber` only works because it falls
back to basic-query pagination. Use basic-query for live lookups.

## Case study (truck 36177 → district 7670, tech mschae2)
Live Holman showed 36177 stuck at `prefix=7084` (Chambersburg PA), Unassigned, driver UNKNOWN — the district
move to 7670 never applied despite Nexus reporting success. Ruled OUT data-validity causes by scanning live
Holman: 7670 is a valid, common prefix (143 active vehicles; 60 with the SAME `div=RF`+`region=890` as this
truck), so it's not "unknown prefix" or "prefix/region mismatch." Every submission moving THIS vehicle to 7670
is captured (202/0 errors) then silently dropped; submissions keeping 7084 apply. **Conclusion: a Holman-side
processing issue specific to this vehicle's transition to 7670 (e.g. a stuck/quarantined change record for
vehicle 36177, lessee 2B56) — only Holman support can clear it. The fixable Nexus side is the false-success
district endpoint above.**
