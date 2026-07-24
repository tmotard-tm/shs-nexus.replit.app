---
name: techsupdatedafter is blind to truck assignments
description: Why the TPMS techsupdatedafter feed cannot self-heal truck assignment/unassignment data, and what to use instead.
---

# TPMS `techsupdatedafter` does NOT reflect truck assignment/unassignment

**Finding (verified empirically against live TPMS + prod fleet_operation_log, June 2026):**
The TPMS `GET /techsupdatedafter/{ts}` feed tracks **tech master/profile record edits only**
(contact, address, district, manager, email, replenishment). It does **not** include a tech
just because their truck assignment changed.

**Proof:** In one prod day there were 3 successful unassigns (gshelto/61144, mgutie1/61705,
kpowel2/23988) and ~18 successful assigns. A `techsupdatedafter` call covering that whole
window returned 18 records — and the ONLY overlap with the day's assign/unassign operations
was one tech (dalvar4), who appeared for an unrelated profile change and showed `truckNo: null`
even though he'd just been assigned a truck. The feed does carry a `truckNo` field, but it's
only a **current-state snapshot** attached to records that changed for some *other* reason.

**Why:** Truck assignment writes go through a separate inventory subsystem — the failure
messages name `UPDATE_TRUCK_OWNER` / `saveInventoryHistory of AIMDAOImpl`. That path does not
bump the "tech updated" timestamp the feed keys on.

**Implication for cache/self-healing design:**
- `techsupdatedafter` can self-heal **profile/contact fields**, NOT truck assignments.
- The authoritative *current* truck-owner state is the **live `GET /techinfo/{id}`** read
  (works by enterprise id; also accepts truck numbers). Verified: after the day's churn,
  live techinfo showed gshelto→null, mgutie1→null (correctly unassigned) and kpowel2→023988
  (correctly re-assigned later that day).
- For a **bulk** current-assignment source use Snowflake `TPMS_EXTRACT.TRUCK_LU` (complete but
  ~daily stale) or a live techinfo sweep. Do NOT seed/reconcile assignments from
  `techsupdatedafter` — it will miss them.

**How to apply:** Any "self-healing backstop" or "right-size the cache" plan for truck
*assignments* must re-read live `techinfo` (per-truck/per-tech) or use a Snowflake extract.
Reserve `techsupdatedafter` for roster/profile drift only.

## Preferred assignment backstop source: `AIMS_TRUCK_INFO`

`PARTS_SUPPLYCHAIN.SOFTEON.AIMS_TRUCK_INFO` is the vehicle-keyed (one row per truck) TPMS
inventory extract — the right shape for assignment reconciliation. Columns used: `TRUCKNO`,
`OWNERLDAPID` (the assigned tech; **null/empty = unassigned**, so it represents vacancy
explicitly — the thing `techsupdatedafter` and the tech-keyed `TPMS_EXTRACT.TRUCK_LU` can't),
`DISTRICT`, `FILE_DATE`, `LOAD_DATE`. Query latest with `FILE_DATE = (SELECT max(FILE_DATE) …)`.

Verified June 2026: ~16.7k truck rows, ~1.65k assigned. Daily **batch extract at ~12:01 AM ET**
(`FILE_DATE` = that day's midnight), **loaded to Snowflake ~6:15 AM ET** (`LOAD_DATE`, eastern).

**Staleness / exemption rule (mandatory):** the snapshot reflects state as of the **extract
time (~12:01 AM ET), NOT the LOAD_DATE**. Any Nexus assign/unassign after 12:01 AM is stale in
it. Proven: trucks 61144/61705 still showed their old owners (gshelto/mgutie1) in the snapshot
even though both were unassigned later that day — applying the snapshot blindly would revert
them. So before applying, **exempt any vehicle with a `fleet_operation_log` op since the
snapshot's extract time**, and derive that cutoff from the actual `max(FILE_DATE)` (so a stale
weekend/holiday batch auto-widens the exemption window).

**Lag caveat:** observed one truck (23988) where a pre-midnight assignment was NOT in the next
12:01 AM snapshot → AIMS batch can lag. So a snapshot-driven correction outside the exemption
window can still be wrong; **confirm each candidate drift with a live `GET /techinfo` read
before writing**. Safest design: AIMS = cheap bulk drift *detector*, live `techinfo` =
authoritative *confirmer*.

## Mismatch board now self-heals BOTH stale legs (July 2026)

The Fleet Management mismatch board's TPMS leg reads `tpms_tech_profiles`, and NO refresh
step can un-assign a tech there: the Snowflake extract keeps listing the last truck forever,
the delta feed is blind (above), and the per-ID refresh step is skipped by default and only
fills EMPTY cache slots. Verified July 2026: after a full refresh, all remaining "stuck"
mismatches were mirror ghosts — live techinfo showed the termed techs unassigned and the
movers on new trucks.

Fix shipped: the mismatch compute fire-and-forgets live-techinfo re-verify sweeps for BOTH
legs (AMS + TPMS patterns are parallel modules). Rules baked in: a truck is only CLEARED on
an explicit live answer (success-with-no-truck or "No Data Found"); transient errors never
clear; writes are CAS'd on the flagged truck so any concurrent writer wins; a winning
move-write also clears other rows claiming the live truck (one owner per truck).
**How to apply:** if stuck mismatches reappear, check the re-verify sweep logs before
suspecting live TPMS — and note `truck_no` values can carry trailing spaces + leading zeros,
so always TRIM before LTRIM-zeros canonical compare.
