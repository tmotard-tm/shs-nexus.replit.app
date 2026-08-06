---
name: tpms_tech_profiles tech_id is NOT unique
description: Multiple enterprise IDs can share one TPMS tech_id; all profile reads/writes must key on enterprise_id
---

**Rule:** In `tpms_tech_profiles`, `enterprise_id` is the UNIQUE key; `tech_id` is shared by multiple techs (rehires/transfers, plus an all-zeros placeholder group). Any `SELECT ... WHERE tech_id ... LIMIT 1` picks an arbitrary tech, and any `UPDATE ... WHERE tech_id = X` stamps one tech's fields onto every row in the group.

**Why:** Prod corruption (Aug 2026): profile-edit routes keyed on tech_id stamped one technician's name fields onto all rows sharing the tech_id, so dozens of rows across many collision groups displayed the wrong technician.

**How to apply:**
- Profile routes use `server/tpms-profile-resolver.ts`: enterprise_id match first, tech_id only when unambiguous (ambiguous → 409 with candidate enterprise IDs). All writes key on the resolved row's enterprise_id.
- Heal/verify tool: `npx tsx server/run-tpms-name-heal.ts [--db=prod] [--apply] [--eids=..]` — scans tech_id collision groups, re-fetches live TPMS /techinfo per enterprise ID, rewrites names keyed on enterprise_id. Dry-run by default.
