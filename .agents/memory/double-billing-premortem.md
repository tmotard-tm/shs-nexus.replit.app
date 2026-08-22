---
name: Double-billing detection premortem
description: Open failure modes of the cutover double-billed detector (direct-billing stamp + old-book comparison) found 2026-08-22, ranked; unfixed unless noted.
---

# Double-billing detection premortem (2026-08-22, architect-verified)

Detector = direct-billing stamp on vrm_rental_cutover + comparison vs the anchored ECARS book, surfaced on Cutover Tracking. Ranked risks, all verified in code:

1. **[FIXED 2026-08-22] Silence reads as clean (worst).** Stamp and comparison now carry REQUIRED 'ok'|'failed' statuses (default 'failed', flipped only on success) + destructive failure toasts; the conflict toast is gated on comparison having run. Rule stands for any future step added to this chain.
2. **[PARTIALLY FIXED 2026-08-22] Coverage gaps.** Blind report rows (REVIEW/unresolved/racf-less → stats.switchoverBlindRows) and sighted techs with no cutover row (switchoverUnmatchedLdaps, zero-rowcount stamps) now counted + toasted. STILL OPEN: cutover rows outside the payload population (reservation_status='booked' filter) remain invisible to the comparison.
3. **[FIXED 2026-08-22] Unknown ≠ clean.** direct_billing_effective + a 4th amber "switched — old book UNKNOWN" bucket (effective + book_state='unanchored'); payload carries billing_unknown. The effective predicate is computed ONCE in SQL (spell out last_seen IS NOT NULL or a voided row with NULL last_seen leaks SQL NULL into the JSON payload).
4. **[FIXED 2026-08-22] Write-once stamp correction path.** Audited void/unvoid: direct_billing_voided_at/by/void_reason current state + append-only direct_billing_void_history (both actions logged); a LATER report sighting (last_seen > voided_at) supersedes a void automatically. Sighting history never mutated. Consumers must key on effective, never confirmed_at.
5. **[FIXED 2026-08-22] Stale ECARS book.** Import result carries oldBookAsOf/AgeDays/Stale (unknown age = stale); conflict toast is freshness-qualified and a stale-book caution fires even on zero conflicts.
6. **[FIXED 2026-08-22] Prod schema drift = page-breaking.** The 3 direct_billing_* columns are now in the vrm_rental_cutover schema-health REQUIRED list; a skipped boot ALTER (see partial-boot-migrations) is caught pre-flight instead of 500ing the cutover endpoint.
7. **[FIXED 2026-08-22] racf-vs-ldap alias mismatch** — zero-rowcount stamps are now collected as switchoverUnmatchedLdaps and surfaced in the upload toast, so a silent stamp miss is visible per upload.

**How to apply:** any hardening work on this detector starts from #1/#2 (silent false negatives beat cosmetic fixes); never present a failed/stale/unknown comparison as clean; treat "stamped 0 rows" as a signal, not a no-op.
