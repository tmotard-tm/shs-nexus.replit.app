---
name: nexus-external-systems
description: Landmines when integrating with Nexus's external systems — Holman, TPMS, AMS, WMS, AIMS/Snowflake, Neon/Postgres, Twilio. Use before writing or debugging any code that calls these systems, matches truck numbers, or verifies whether a write "took".
---

# Nexus External Systems — Landmines

All external systems are single shared **production** instances — dev Nexus talks to real Holman/TPMS/AMS. There are no sandboxes. Treat every write path with production care.

## Holman

- **HTTP 202 (or errorCount 0) means "queued", NOT applied.** Verify via post-sync fleet data, never optimistic-mirror. District changes are verified async by the fleet sync (the sync freezes `cache.district`; `verifyFromFleetData` is the only authoritative completer).
- District submit must **omit** `assignedStatusCode` (string(1) — payload rejected otherwise). Stored `holman_submissions.payload` contains tracking-only `targetPrefix`/`targetDistrict` fields that must be stripped before any replay.
- The same driver failing repeatedly (UNKNOWN) while others succeed on the same vehicle = Holman-side record issue, not a Nexus bug.
- Holman vehicle number field in their API responses is `holmanVehicleNumber`, not `clientVehicleNumber`.
- Write fences must be released only on live-confirmed newer submissions, never on cache confirms.

## TPMS

- **Truck-number padding**: TPMS zero-pads truck numbers, Holman doesn't. Always canonicalize (ltrim zeros) on BOTH sides before matching. Check the `88` BYOV prefix on the RAW/trimmed number BEFORE padding (88144 → 088144 breaks the check).
- `GET /techinfo/{id}` accepts a TRUCK number too (returns the assigned tech), not just an Enterprise ID.
- The `techsupdatedafter` feed is **blind to truck assignments** — reconcile assignments via live `/techinfo` or Snowflake `TRUCK_LU`, never the feed.
- `TPMS_EXTRACT_LAST_ASSIGNED` = last tech EVER on a truck (never clears) → ghost assignments if used as "current". Live-verify first.
- "Not assigned" comes back as HTTP 400 "No Data Found".
- Authoritative `truckNo` writer is the live per-tech TPMS call, NOT the nightly TPMS_EXTRACT snapshot (lags ~24h).

## AIMS / Snowflake

- Assignment authority is `OWNERLDAPID` (NOT `LDAPID`, which disagrees ~60% of the time). Confirm by truck#, not owner-ldap (termed owners 404).
- `AIMS_TRUCK_INFO` is historical: filter to max `FILE_DATE` then `DELIND=0` for active rows. Fully-qualify table names (TEST_DB default is inert).
- All heavy Snowflake roster reads must join the single `fleetscope-mirror-sync` advisory lock — wrap only the read, never nest.
- `HOLMAN_ETL_PO_DETAILS`: `PO_STATUS` has no 'Open' (open = APPROVED); the loader's rolling 5-day window permanently misses POs (portal gap-fill exists for this).

## AMS

- `POST user-updates` validates enum fields by **NAME**, not UniqueID — convert id→label and send only changed fields.
- Fleet-card Current Location must come from the full-fleet `searchVehicles` cache, NOT `ams_vehicles_cache.rawResponse`.
- The truck-status-map endpoint 503s by design while the cache warms — clients must retry 5xx/network and poll, never `retry: false`.

## Neon / Postgres

- One-shot `neon()` HTTP queries mis-read booleans — use the app's pool driver (`server/db.ts`) for ground truth.
- Heavy aggregator routes can 500 `{"message":""}` on a transient WebSocket drop (closeCode 1006) — serve bounded-stale cache for transient drops only.
- `communication_logs.sent_by` is an FK to users: system sends must pass `sentBy=null` (put the actor in metadata) or the insert throws AFTER the email sent, losing the log and re-firing daily.

## Deeper reading

Per-topic detail lives in `.agents/memory/` (see `MEMORY.md` index) — e.g. `holman-assignment-verification.md`, `tpms-holman-number-matching.md`, `aims-authority-semantics.md`, `ams-user-updates-contract.md`, `neon-http-driver-boolean-pitfall.md`.
