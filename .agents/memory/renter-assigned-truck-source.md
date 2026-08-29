---
name: Renter assigned-truck single source
description: Every "what truck is this renter actually assigned to" read must use the shared TPMS-first SQL fragment, never the Snowflake roster fields alone.
---

**Rule:** any surface answering "the renter's own assigned truck" composes the ONE exported TPMS-first fragment (`OWN_TRUCK_LATERALS` in the rental-operations read repository: `tpms_last_known_truck_tech` newest-by-RACF first, roster `truck_lu`/`last_known_truck_lu` fallback, 5-pad normalize). Never write a fresh `COALESCE(atr.truck_lu, atr.last_known_truck_lu)` copy.

**Why:** the roster fields are historical Snowflake data and go stale. The board query was fixed 2026-07-31, but five roster-only copies survived elsewhere; on 2026-08-23 the LUCA rental-list feed shipped stale ASSIGNED_TRUCK on 42 of 384 rentals (26 of 225 direct-billed), which Tyler saw as "billing items on LUCA don't match real truck numbers". Worse, the PO-landing and scrape-target universes used the same stale expression, so when LUCA redirects a declined/auction call to the tech's own truck, that (TPMS) truck had no landed POs or scrape history. Tyler's locked rule: anything transferring to LUCA carries the tech's real TPMS-assigned truck.

**How to apply:** new queries needing the renter's truck must `LEFT JOIN all_techs atr` (keyed on the identity resolution's effective employee_id) then interpolate the fragment and read `ownp.own_pad` (or `rt.tpms_truck` for the strict TPMS-only value). Truckless `db:RA#` cases are correct-by-design — live TPMS genuinely has no truck for those techs. Note: a tech can appear on multiple TPMS rows, so the fragment's `ORDER BY last_seen_at DESC LIMIT 1` is load-bearing.

**Case identity boundary:** a synthetic `db:RA#` case key is valid only as case identity for detail lookups, actions, and audit history. Never label it as a truck or pass it to a vehicle-keyed scrape, PO, identity, or shop-phone operation; those require a real `vehicle_number` or assigned truck.

**Related open seam (not fixed):** the rental-request form's `correctedTruck` is unvalidated and the cutover orchestrator lets a request-entered truck beat TPMS in ETD special notes — tech-entered trucks are supposed to be impossible.
