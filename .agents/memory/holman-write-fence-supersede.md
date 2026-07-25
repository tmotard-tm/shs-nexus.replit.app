---
name: Holman write-fence supersede
description: Reconciliation write-fences can outlive their correction; lift only on live-confirmed newer ops, never on cache-based confirms (circular)
---

# Holman write-fence supersede

**Rule:** A reconciliation write-fence (holman/assignment) must be released when a NEWER operation is confirmed against the live system — otherwise it pins the stale cached value (bulk sync preserves fenced trucks on every pull) for its full 7-day TTL, and the truck sits on the mismatch dashboard even though all live systems agree.

**Why:** 7/24 incident (truck 23893): backstop unassign stamped a fence (expected=NULL); a human re-assign was confirmed 10h later; live Holman showed the new tech but every forced refresh kept the cached blank because the fence only lifted on live==expected or TTL.

**How to apply:**
- Two-part fix pattern: (1) a supersede sweep (`server/holman-fence-supersede.ts`, fire-and-forget from the mismatch GET + manual POST reverify route, dry-run default) that lifts fences superseded by a newer completed submission ONLY after a positive live-Holman match; (2) a prevention hook in the submission verifier that releases a fence at confirmation time.
- **Critical trap (architect-caught):** never release a fence from a CACHE-based confirmation. The fence pins the cache to its own expected value, so the cache "confirming" the submission can be the fence's own value reflected back — lifting on it clobbers the correction during exactly the Holman apply-latency window fences exist for. Only live-API-confirmed points may release.
- Always guard supersession order: only a submission created strictly AFTER the fence may release it (an older in-flight submission confirming late must not expire a newer fence).
- Fence semantics: verifyFence = live matched expectation (sets verified_at); expireFence = force-lift (expires_at=now). If confirmed value == fence expected → verifyFence; differs → expireFence + mirror confirmed value into cache with the sync's normalization (lowercased enterprise id).
- Live Holman `assignedStatusCode` can be undefined even when assigned — detect unassigned via code==='U' OR blank clientData2, never code alone.
