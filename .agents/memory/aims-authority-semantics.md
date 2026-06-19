---
name: AIMS truck-assignment authority semantics
description: Which AIMS_TRUCK_INFO column is the live tech↔truck assignment authority, and how TPMS signals "not assigned" — for the fleet reconciler.
---

# AIMS authority = OWNERLDAPID (NOT LDAPID)

`PARTS_SUPPLYCHAIN.SOFTEON.AIMS_TRUCK_INFO` is a historical/append table (one row per truck per daily extract). Scope to the live fleet with `FILE_DATE = (SELECT MAX(FILE_DATE))` THEN `DELIND = 0` (~2,756 active rows). Columns of interest: `TRUCKNO, TECHNO, LDAPID, OWNERLDAPID, DISTRICT, DELIND, FILE_DATE`.

**The assignment-authority Enterprise ID is `OWNERLDAPID`.** Verified live: `/techinfo` looked up by truck# returned a holder that matched `OWNERLDAPID` on 8/8 sampled trucks (and `TECHNO` matched the live `techId`, e.g. TECHNO=24463 → techId=0024463).

- `LDAPID` is a DIFFERENT field and **disagrees with `OWNERLDAPID` on ~1,649 of ~1,651 assigned trucks (~60% of the active fleet)**. It is NOT a fallback and NOT a "contested" signal. The earlier design assumption ("owner = OWNERLDAPID → fall back to LDAPID; both present & disagree → contested") was empirically WRONG — using it flagged ~60% of the fleet as contested.
- Of 2,756 active trucks: ~1,651 have `OWNERLDAPID` populated (assigned), ~1,105 have it null (vacant). `LDAPID`-vs-`OWNERLDAPID` were equal on only 2.

**Owner resolution rule:** owner = normalize(`OWNERLDAPID`); if empty → vacant. Ignore `LDAPID` for ownership.

**Contested** now arises ONLY from a live-confirmation disagreement, never from an AIMS-internal column mismatch:
- live `/techinfo` by truck# returns a holder ≠ AIMS `OWNERLDAPID` → contested (live says someone else holds it).
- AIMS claims an owner but live `/techinfo` by truck# is not-found (vacant live) → contested.

**Why:** TPMS `/techinfo` is the live authority; AIMS alone can never override it, but an active conflict must HOLD (skip + flag), not guess.

**How to apply:** confirm ownership by **truck#** lookup (`getTechInfo(toTpmsRef(truck))`), NOT by the owner's LDAP. A termed/LOA owner's own `/techinfo/{ldap}` 404s ("No Data Found") even when the truck is validly assigned, so an owner-ldap lookup would falsely flag valid assignments as contested. The truck# lookup also yields the live `districtNo` for the cost-center chain in one call.

# TPMS "not assigned" signal = HTTP 400 "No Data Found"

TPMS returns an unassigned truck / invalid LDAP as **HTTP 400** with message `"No Data Found for ldap/truckNo X"` (techInfoList:[]). It is NOT a 404 and NOT "no tech info entries". The reconciler's not-found classifier must match `no data found` (lowercased) or vacancy confirmation wrongly returns "indeterminate" and ghost-clears never fire.
