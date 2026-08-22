---
name: Double-billing detection premortem
description: Open failure modes of the cutover double-billed detector (direct-billing stamp + old-book comparison) found 2026-08-22, ranked; unfixed unless noted.
---

# Double-billing detection premortem (2026-08-22, architect-verified)

Detector = direct-billing stamp on vrm_rental_cutover + comparison vs the anchored ECARS book, surfaced on Cutover Tracking. Ranked risks, all verified in code:

1. **Silence reads as clean (worst).** Stamp AND comparison are best-effort try/catch; on failure the import result just omits the fields and the upload toast says "imported" with no conflict warning. A Neon hiccup = operator believes no double-billing. *Fix: explicit comparison `available|failed` status in the result + warning toast + persisted import diagnostic.*
2. **Coverage gaps are unmeasured.** Three silent exclusion classes never reach the page: REVIEW/racf-less report rows (never stamp), resolved techs with NO cutover row (UPDATE matches nothing; switchoverTechs−switchoverStamped is computed but surfaced nowhere), and cutover rows outside the payload population (reservation_status='booked' filter). Double-billing is invisible exactly where identity/booking data is worst. *Fix: per-upload coverage counts ("N report rows not comparable") as a first-class result.*
3. **Stamped + 'unanchored' book = UNKNOWN but the facet calls it "switched — old book clear".** Unknown ≠ clean; needs a 4th "comparison unknown" bucket.
4. **Write-once stamp has no correction path.** One erroneous Enterprise row → permanent red row if the Holman ticket stays open; cry-wolf erosion. Fix = audited void/override, never mutating the sighting history.
5. **Stale ECARS book.** Conflicts ride present_in_latest from the last enterprise upload; the page has a staleness banner but the import-time conflict toast carries no freshness qualifier, and prod schedulers historically under-fire (see prod-sync-schedule-reality).
6. **Prod schema drift = page-breaking.** The payload SELECT hard-references the 3 new columns; a skipped boot ALTER (see partial-boot-migrations) 500s the whole cutover endpoint. The columns are ALSO missing from the schema-health check — add them.
7. **racf-vs-ldap alias mismatch** between sighting key (roster tech_racfid preferred) and cutover row ldap (intent/runner origin) would be a silent stamp miss; normalization matches but no zero-rowcount audit exists.

**How to apply:** any hardening work on this detector starts from #1/#2 (silent false negatives beat cosmetic fixes); never present a failed/stale/unknown comparison as clean; treat "stamped 0 rows" as a signal, not a no-op.
