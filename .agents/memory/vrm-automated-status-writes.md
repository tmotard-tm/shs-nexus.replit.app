---
name: Automated VRM status writes are guarded
description: Any automated fleet-status writer must use the compare-at-write guarded append; humans always win; absence semantics are asymmetric by design.
---

# Automated VRM fleet-status writes go through the guarded append

**Rule:** Automation that decides a truck's fleet status from a snapshot (LUCA writeback ready-routing, heal/backfill routes, any future scheduler) must write through the guarded append (`appendFleetStatusIfMainIn` beside `appendFleetStatus` in the VRM fleet-status module): compare-at-write re-read of BOTH the newest VRM history action and the mirrored `fs_trucks.main_status`, a replaceable-mains allowlist, and a per-case in-process queue that serializes concurrent guarded writers. Plain `appendFleetStatus` is for humans, who always win. Never write status via direct `fs_trucks` updates.

**Why:** Review caught that snapshot-based automation can clobber an operator decision made in the window between classification and write, and that two concurrent automated writers (double-fired heal, heal overlapping the worker) can double-append from the same stale read. A queued guarded writer re-reads AFTER the prior one committed, so it refuses instead of duplicating.

**Absence semantics are asymmetric — do not "simplify" to both-non-null:**
- VRM history is append-only; `null` there can only mean "never seeded", never a cleared decision → passes. Requiring non-null would leave never-seeded conflict rows red forever.
- `fs_trucks` is the side the snapshot classified on (non-null replaceable at snapshot by construction) → a missing row or null status at write time is evidence of change → refuses. The pure predicate (`evaluateGuardedAppend`) makes every null/missing combination unit-testable offline.

**How to apply:**
- LUCA "Ready" flips status to Scheduling / "To be scheduled for tech pickup", and ONLY from the three conflict mains (Repairing, Confirming Status, Decision Pending) — the same write a human makes; truck then lands in step 2 (set pickup date).
- Refusal is safe and intended: the red conflict row is the divergence signal. Never add a direct fs_trucks fallback for a refused automated write.
- Accepted residual: a human plain-append racing the guard's re-read→append window is not serialized (cross-caller/cross-instance serialization out of scope); worker cross-process overlap is prevented by the LUCA advisory lock, heal by an in-flight flag (409).
