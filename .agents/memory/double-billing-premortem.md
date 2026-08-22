---
name: Double-billing detection premortem
description: Durable failure modes of the cutover double-billed detector (direct-billing stamp + old-book comparison); rules for any hardening work.
---

# Double-billing detection premortem (2026-08-22, architect-verified)

Detector = direct-billing stamp on vrm_rental_cutover + comparison vs the anchored ECARS book, surfaced on Cutover Tracking.

**Standing rules (why: silent false negatives are this detector's worst failure class):**
- Every step in the stamp/comparison chain must carry a REQUIRED 'ok'|'failed' status defaulting to 'failed' (flipped only on success), with destructive failure toasts; success-signal-by-silence is forbidden for any future step added to the chain.
- Never present a failed, stale, or unknown comparison as clean — unknown ≠ clean. A stamped row whose book is 'unanchored' is UNKNOWN, not "old book clear"; it needs its own bucket.
- Treat "stamped 0 rows" as a signal to audit, not a no-op.
- Consumers key on the effective predicate (computed ONCE in SQL), never confirmed_at; sighting history is never mutated — corrections are audited void/unvoid rows, and a LATER report sighting supersedes a void automatically.

**State as of 2026-08-22 (all verified in code):**
1. FIXED — silence-reads-as-clean: stamp + comparison carry required statuses with failure toasts; conflict toast gated on the comparison having run.
2. PARTIALLY FIXED — coverage gaps: blind report rows (REVIEW/unresolved/racf-less) and sighted techs with no cutover row are counted + toasted. STILL OPEN: cutover rows outside the payload population (reservation_status='booked' filter) remain invisible to the comparison.
3. FIXED — unknown ≠ clean: direct_billing_effective + amber "switched — old book UNKNOWN" bucket; payload carries billing_unknown (spell out last_seen IS NOT NULL or a voided row leaks SQL NULL into the JSON).
4. FIXED — write-once stamp correction: audited void/unvoid (current-state columns + append-only void history).
5. FIXED — stale ECARS book: import result carries oldBookAsOf/AgeDays/Stale (unknown age = stale); conflict toast freshness-qualified; stale-book caution fires even on zero conflicts.
6. FIXED — prod schema drift: direct_billing_* columns are in the vrm_rental_cutover schema-health REQUIRED list (see partial-boot-migrations).
7. FIXED — racf-vs-ldap alias mismatch: zero-rowcount stamps surface as switchoverUnmatchedLdaps in the upload toast.

**How to apply:** hardening starts from the remaining coverage gap (#2) and the silence rules above — silent false negatives beat cosmetic fixes.
