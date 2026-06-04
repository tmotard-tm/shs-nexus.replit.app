---
name: BYOV/vehicle number reservation
description: How POST /api/byov/create atomically reserves a vehicle number to prevent concurrent reuse, and the rules that keep it race-safe and leak-free.
---

# Vehicle number reservation (Create Vehicle)

`POST /api/byov/create` reserves the chosen vehicle number BEFORE any external
fan-out (Holman/WMS/TPMS) so two concurrent creates can never both allocate the
same recommended number. The reservation lives in `byov_creation_audit`.

## Mechanism
- A **partial unique index** `byov_creation_audit_active_vehicle_uq` on
  `(vehicle_number) WHERE blocked_source IS NULL` allows at most one ACTIVE
  (non-blocked) audit row per number. Created idempotently at runtime via a
  memoized `CREATE UNIQUE INDEX IF NOT EXISTS` (same lazy-DDL pattern as the LOA
  recovery index) — NOT via drizzle-kit push.
- **Reserve**: `INSERT` an active row (`blocked_source` NULL, both success flags
  false) with `.onConflictDoNothing().returning({id})`. Row returned → we own it
  (`reservationFreshlyInserted=true`).
- **Conflict** (no row returned, an active row already exists): the discriminator
  is **VIN** (trim+uppercase). Same VIN → reuse the row id and carry forward prior
  holman/wms success (idempotent retry — bulk re-runs call create with
  `createInHolman:false` and MUST succeed). Different VIN → 409 collision.

## Why VIN is the discriminator
The bulk upload path (`byov-bulk-upload.tsx`) re-runs creates idempotently, so a
matching-VIN repeat must proceed through the existing per-system already-exists
guards; a different VIN on the same number is a genuine clash.

## Leak prevention (a stranded active row would 409-burn the number forever)
- **Exception after reserve**: reservation vars are hoisted above the `try`; the
  outer `catch` DELETEs the row only when `reservationFreshlyInserted && !prior*`
  (never a reused row that may carry a prior success).
- **Crash between reserve and finalize**: a different-VIN request treats an active
  row as **stale** when both flags are false AND `submitted_at` older than the TTL
  (15 min — far above real create latency of seconds) and reclaims it.
- **Reclaim MUST be compare-and-swap**: the reclaim UPDATE is guarded by the exact
  observed state (`id`, `blocked_source IS NULL`, both flags false, AND the same
  `submitted_at` we read) and checks `.returning()` rowcount. 0 rows → another
  request won → 409. Do NOT reclaim with a bare `WHERE id=?` — two requests would
  both "win" and both proceed to fan-out.

## Finalize
After fan-out: `final = prior || (createIn* && result.success)`. If anything
succeeded → UPDATE flags+errors; else DELETE the row to release the number.

**Why:** code review rejected the first cut twice — (1) no reservation at all, then
(2) reservation leaked on exception/crash and the reclaim wasn't CAS-safe.

**How to apply:** any new path that allocates a vehicle number must reserve through
this same active-row + partial-unique-index discipline, and any reclaim of an
existing row must be a guarded CAS update, not a blind id-based update.
