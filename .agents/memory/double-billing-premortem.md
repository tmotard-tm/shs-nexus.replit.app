---
name: Double-billing detection premortem
description: Open failure modes of the cutover double-billed detector (direct-billing stamp + old-book comparison) found 2026-08-22, ranked; unfixed unless noted.
---

# Double-billing detection premortem (2026-08-22, architect-verified)

Detector = direct-billing stamp on vrm_rental_cutover + comparison vs the anchored ECARS book, surfaced on Cutover Tracking. Ranked risks, all verified in code:

1. **[FIXED 2026-08-22] Silence reads as clean (worst).** Stamp and comparison now carry REQUIRED 'ok'|'failed' statuses (default 'failed', flipped only on success) + destructive failure toasts; the conflict toast is gated on comparison having run. Rule stands for any future step added to this chain.
2. **[PARTIALLY FIXED 2026-08-22] Coverage gaps.** Blind report rows (REVIEW/unresolved/racf-less → stats.switchoverBlindRows) and sighted techs with no cutover row (switchoverUnmatchedLdaps, zero-rowcount stamps) now counted + toasted. STILL OPEN: cutover rows outside the payload population (reservation_status='booked' filter) remain invisible to the comparison.
3. **Stamped + 'unanchored' book = UNKNOWN but the facet calls it "switched — old book clear".** Unknown ≠ clean; needs a 4th "comparison unknown" bucket.
4. **Write-once stamp has no correction path.** One erroneous Enterprise row → permanent red row if the Holman ticket stays open; cry-wolf erosion. Fix = audited void/override, never mutating the sighting history.
5. **Stale ECARS book.** Conflicts ride present_in_latest from the last enterprise upload; the page has a staleness banner but the import-time conflict toast carries no freshness qualifier, and prod schedulers historically under-fire (see prod-sync-schedule-reality).
6. **[FIXED 2026-08-22] Prod schema drift = page-breaking.** The 3 direct_billing_* columns are now in the vrm_rental_cutover schema-health REQUIRED list; a skipped boot ALTER (see partial-boot-migrations) is caught pre-flight instead of 500ing the cutover endpoint.
7. **racf-vs-ldap alias mismatch** between sighting key (roster tech_racfid preferred) and cutover row ldap (intent/runner origin) would be a silent stamp miss; normalization matches but no zero-rowcount audit exists.

**How to apply:** any hardening work on this detector starts from #1/#2 (silent false negatives beat cosmetic fixes); never present a failed/stale/unknown comparison as clean; treat "stamped 0 rows" as a signal, not a no-op.
