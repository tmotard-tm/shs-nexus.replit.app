---
name: Create Vehicle gate discipline
description: The fail-closed rules the vehicle-creation fan-out (Holman/WMS/TPMS) must keep, and the traps in reserving numbers and VINs.
---

# Create Vehicle: gates are fail-closed, evidence-based, and reservation-backed

Vehicle creation writes real records into Holman, WMS and TPMS. Every guard around it must hold these rules:

- **A check that cannot complete refuses the submission.** A duplicate probe reports "did it complete" separately
  from "did it find something." A database blip or an unreachable Holman produces a refusal with a reason, never a
  silent pass. A confirmed duplicate outranks an unverified probe when both are present.
- **The VIN gate runs regardless of which systems are targeted.** Duplicate VINs are a vehicle-identity problem,
  not a Holman problem; scoping the check to "only when Holman is targeted" reopens the dual-registration hole.
- **Concurrency is handled by the reservation row, not by reading first.** The row claims the number *and* the VIN
  through partial unique indexes, so two same-VIN creates under different numbers cannot both proceed. Conflicts
  resolve by compare-and-swap on the existing row, never by a blind update.
- **A suggested number is held, not merely recommended.** The suggestion endpoint takes the reservation immediately,
  tied to the requesting session and expiring on abandonment; otherwise two users race and the loser eats a 409
  after filling the whole form.
- **The audit row is the reconstruction record**: request id, payload as submitted, each system's answer, per-system
  timestamps. A blocked attempt is a row too — that is also what releases the reservation.

**Why:** the previous guards were advisory, cache-only, and wrapped in try/catch that logged and continued, which
is how duplicate vehicles reached Holman under two numbers.

## Traps
- **Pre-existing audit history contains legitimate duplicate VINs** (the incidents themselves). A VIN unique index
  must be scoped to rows this gate writes, or the DDL cannot be created at all.
- **TPMS swallows a duplicate create as success**, silently adopting a ghost truck. The number allocator therefore
  has to scan TPMS and the fleet mirrors, not just the Holman cache — a number live in TPMS alone reads as free.
- **The fleet mirrors live in the Fleet-Scope database, not the main app database.** A "scan every source" query has
  to cross both connections, and a partial scan must fail the request rather than allocate from incomplete data.
- **`Math.max(...array)` blows up on a large number band.** Compute the in-band maximum iteratively.
- **Skipping over an excluded band must also skip used numbers**, or the skip lands on a live vehicle.
- **This repo's tsconfig targets ES5 without downlevelIteration**: `[...new Set(x)]` adds a fresh type error. Use
  `Array.from`.

## Deliberately out of scope — do not "fix"
AMS is not part of the creation fan-out. AMS records appear downstream from a background sync roughly 24 hours
after the Holman record exists, so a missing AMS record right after a create is expected, not a failure.
