---
name: Assign target validation (FM/Onboarding parity)
description: Server-side pre-assign truck validation shared by both assign routes; fail-open rules
---

Both assign routes (Fleet Management + Weekly Onboarding) must call the shared `validateAssignTarget` (fleet-operations-service) BEFORE any external dispatch: numeric ≤6-digit format, existence (Holman cache → live Holman fallback), L/B/W/T status, operation lock.

**Why:** FM's protections used to be UI-only (real vehicle card + disabled button), so Onboarding's free-typed field let "byov" reach TPMS/Holman and diverge them (2026-07-24).

**How to apply:**
- Any new assign entry point must call the validator server-side — never rely on UI structure.
- Fail-open ONLY on live-Holman lookup ERROR (outage must not block legit assigns; the format check still blocks garbage). A live `found:false` is a hard block.
- The `/api/fleet-ops/vehicle-status/:truckNumber` pre-check now also does the live fallback, so a client 404 means "verified not a fleet vehicle" and may hard-block; 503 = transient, don't block client-side.
