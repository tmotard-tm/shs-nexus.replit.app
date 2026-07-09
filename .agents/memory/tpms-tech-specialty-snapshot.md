---
name: TPMS tech-specialty tier-3 snapshot staleness
description: Why the tech-specialty endpoints can show a "ghost" current assignee for trucks with nobody assigned
---

The `/api/fs/tech-specialty` (single + batch) lookups use a 3-tier fallback: local tech-profile cache → cached assignments → Snowflake `TPMS_EXTRACT_LAST_ASSIGNED`.

**The trap:** `TPMS_EXTRACT_LAST_ASSIGNED` holds the last tech EVER seen on a truck and keeps that row indefinitely — it does not clear when the tech moves off or the truck goes unassigned/decommissioned. When tiers 1–2 are empty (which is exactly the case for a truck nobody is assigned to), tier 3 returns that stale name and the UI (fleet-scope TruckDetail "Enterprise ID" box) presents it as the current assignee with no staleness label. Confirmed in prod: a truck with a live-TPMS "No Data Found" (assigned to nobody) displayed the previous tech, who had moved to a different truck a day earlier.

**Why:** empty local caches are the SIGNAL that a truck is unassigned, but the tier order treats them as a miss and falls through to a table that never forgets.

**How to apply:** to disprove a snapshot answer, call live `GET /techinfo/{truckNumber}` — it accepts truck numbers (the code comment saying it doesn't is wrong; see tpms-techinfo-truck-lookup.md). HTTP 400 "No Data Found" is a definitive "nobody assigned". Any fix should live-verify before serving tier-3, or at minimum label `dataSource:'snapshot'` results as "last known assignee (may be stale)".

Related confirmed fact: `snowflake-service.ts` `executeQuery` DOES honor parameter binds (`options.binds`); a comment near the tech-specialty batch route claiming binds are ignored is wrong.
