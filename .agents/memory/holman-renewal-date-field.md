---
name: Holman renewalDate field & Registrations tab date sources
description: Why registration expirations vanished fleet-wide and where the tab's dates come from
---

Holman's `/vehicles` (custom-query/basic-query) carries the registration renewal as **`renewalDate`** (ISO timestamp, e.g. `2019-06-30T00:00:00Z`). The legacy names the sync used to map — `tagExpirationDate`, `registrationExpirationDate`, `regRenewalDate` — no longer appear in responses, so `holman_vehicles_cache.reg_renewal_date` sat ~empty (1/9,923) and nobody noticed for a long time.

Rules:
- Any Holman vehicle-field mapping should be suspicious of silent all-empty columns: the API renames fields. Verify against a live sample (`queryVehiclesCustom({ lesseeCode: "2B56", pageSize: 50 })` and dump `Object.keys`), not the interface in `holman-api-service.ts`.
- Normalize `renewalDate` to `M/D/YYYY` before storing (`holmanRenewalDate()` in the sync service): every consumer (`parseUsDate`, the Registrations tab's `new Date()` bucketing) assumes US-format local dates, and a Z-midnight ISO string day-shifts in US timezones.
- The Fleet Scope Registrations tab's date precedence is: spare_vehicle_details → fs_trucks.holman_reg_expiry → holman_vehicles_cache.reg_renewal_date. The cache fallback is what gives full-fleet coverage — fs_trucks only holds a few hundred rentals-adjacent trucks while the fleet is ~2,300+ assigned.
- "Assigned" on that tab = presence in the TPMS lookup (padded 6-digit key), not any status field.

**Why:** users saw "expiring by month" counts of ~2-5/month for a 1,400-truck assigned fleet; real counts are 20-110/month.

**How to apply:** if a Holman-sourced field goes empty fleet-wide, live-probe the raw response for a renamed key before assuming the data doesn't exist; after fixing a mapping, trigger `POST /api/holman/fleet-vehicles/sync` to backfill the cache.
