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
*assignments* must re-read live `techinfo` (per-truck/per-tech) or use the Snowflake extract.
Reserve `techsupdatedafter` for roster/profile drift only.
