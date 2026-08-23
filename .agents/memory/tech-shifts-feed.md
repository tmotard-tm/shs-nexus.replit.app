---
name: Tech shifts schedule feed
description: Source, config quirks, and cache trap for the technician shift-schedule feature (Tech Schedules pages + rental-request drawer)
---

# Tech shifts schedule feed

- Source is Mauricio Marino's external tech-shifts app (server/tech-shifts-client.ts wraps it), NOT the ServicePower snapshot behind fetchScheduleWindow(); the cutover booking gate is separate and untouched.
- The API key secret exists under the plural name TECHS_SHIFTS_API_KEY; the client accepts both spellings (plural preferred). Any operator-facing "add X to Secrets" copy must name the plural.
- **Cache trap:** fetchShiftRows caches by query key ONLY (dates/ldap/district), not by env. In tests, a successful call swallows a later expected CONFIG_MISSING rejection for the same dates — use distinct dates or clearTechShiftsCache().
- Surfaces: VRM Tech Schedules page (tech/district/paste-a-list), Fleet Scope wrapper page reusing it (session-gated API, so fine outside VRM), and the rental-request drawer (Schedule dialog + pickup-day check).
- Route order in tech-schedule-routes is load-bearing: /:ldap is a catch-all registered last.
