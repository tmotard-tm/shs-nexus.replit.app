---
name: TPMS district mirror staleness
description: tpms_tech_profiles.district_no goes stale for district-only transfers; district decisions must live-check TPMS and heal the mirror
---

# TPMS district mirror staleness (district-only transfers)

**Rule:** Never make a district decision (guard block, dialog auto-fill) from `tpms_tech_profiles.district_no` alone. On the decision path, check LIVE TPMS `getTechInfo` first and heal the mirror row when it differs (`fetchLiveTechDistrictAndHealMirror` in fleet-operations-service).

**Why:** The mirror's truck-driven refresh only re-queries techs whose Holman↔TPMS TRUCK assignment mismatches. A tech who transfers districts but keeps his truck never triggers a refresh, so his mirror district stays stale indefinitely (HABASI 2026-07-24: mirror said 0008184 since 7/6, live TPMS said 0008366 — valid assignment was 409-blocked). The Snowflake `all_techs` roster refreshes daily and had the right district, but the mirror-based auto-fill OVERRODE it.

**How to apply:**
- The Tyler district guard (both copies: inline in `/api/fleet-ops/assign` and `districtGuardForAssign`) live-rechecks the TECH district only on the about-to-block path — mirroring the existing "only the about-to-block path pays this lookup" pattern used for the Holman vehicle-prefix recheck. Any live failure falls back to blocking; the guard is never weakened.
- Dialog auto-fill uses `GET /api/tpms/techs/live-district/:enterpriseId` (live-first, heals, mirror fallback) — NOT the mirror-only `/api/tpms/techs?enterpriseId=`.
- The heal is a difference-gated raw UPDATE, so prod rows self-heal organically the first time anyone looks a tech up (prod DB is read-only via tools — this is the deployment path for stale-row fixes).
- Sibling caution: any OTHER consumer that treats the mirror's district as authoritative has the same latent bug.
