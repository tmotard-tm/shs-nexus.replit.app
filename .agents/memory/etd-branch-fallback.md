---
name: ETD branch addressing & nearby fallback
description: Request-lane booking address ladder (approved_branch wins, guard off), nearbyOnEmpty branch walk semantics, and the TS/Python mirror traps that caused/almost caused prod strands.
---

## Address ladder (REQUEST lane, `intentAddress` in server/vrm/etd/executor.ts)
1. **Fleet's `approvedBranch`** (seeded from `vrm_rental_request.approved_branch` via requestSeed) — wins over the shop address AND the tech-reported branch, **with the wrong-state guard OFF** and no locatable check. A human typed and checked it; second-guessing an explicit human branch is the behaviour Tyler asked removed (2026-08-20). Mirrors `book_one` in etd-runner/scripts/book_request.py.
2. Shop address (joined parts).
3. Locatable-guarded tech-reported branch.

**Why it exists:** the decision endpoint persisted `approved_branch` and *documented* it as an override, the Python rescue script honored it, but the in-server TS executor never read it — a documented override that one consumer silently ignores is dead code that reads like a working feature. When adding an override, grep EVERY consumer of the decision facts.

## nearbyOnEmpty branch walk (`quote()` in both clients)
- Opt-in only; request lane only (`workflowType === WORKFLOW_REQUEST`). **Never fires when `preferBranchCode` is set** — a cutover's pinned contract branch must not move, and the commit lane independently pins `wantBranch = resv.branchCode` from the confirmed preview and aborts on drift, so a preview-time fallback can never book an unapproved branch.
- Walk is nearest-first over `closestBranches`; caps: 5 candidates, `calculatedDistance` ≤ 40 (feed docs say km). Crossing the cap **breaks** (list is sorted), unknown distance = stop.
- Adopted branch reported via `branch_fallback_from_code/name/tried`; executor persists `quotedFromNearbyBranch` + a warning naming the moved-off branch into the preview reservation.
- Real-world shape: National-brand desks and airport satellites return EMPTY class lists on this account while a real branch sits 0.3mi further (SWICKLA #95, Dolah #87).

## Mirror traps (TS ↔ Python, "change both or neither")
- `Number(null)` is **0** in JS → an absent distance ranked "closer" than every real branch; guard with an explicit null/""-check before `Number()`.
- `float('nan')` **parses** in Python and `nan > cap` is False → NaN sails past the cap; require `math.isfinite`.
- The wrong-state retry inside `_guarded_quote`/`guardedQuote` re-quotes — every new quote option must be forwarded on the RETRY call too, or the mirrors drift exactly where nobody tests.
- Architect review caught both Python drifts; there is no automated TS↔Python parity suite for the ETD clients.

## Test recipe
- Client-walk tests use a REAL EtdClient with instance-level monkey-patched transport methods (resolvePlace/createJourney/wizard/closestBranches/carClasses) — fakeEtd stubs quote() wholesale so it can't exercise the iteration. Python equivalent: `object.__new__(EtdClient)` + lambda attrs.
- tests/etd-executor-unit.test.ts has a WALL-CLOCK FLAKE: the same-day request test asserts pickupDate == today, but after ~19:00 ET the notBeforeNowET floor legitimately rolls to tomorrow — evening runs fail it on clean code.
