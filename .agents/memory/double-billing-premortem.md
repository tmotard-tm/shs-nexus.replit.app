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
2. FIXED — coverage gaps: blind report rows (REVIEW/unresolved/racf-less) and sighted techs with no cutover row are counted + toasted. Non-booked stamped rows: the payload builder takes an includeAllStamped option (importer-only) widening WHERE to booked OR effectively-stamped; the page keeps its booked-only scope (deliberate Tyler decision), the toast counts the extra rows, and off-page conflicts are flagged in the toast. Off-page conflicts are still TOAST-ONLY — no persistent surface shows them between uploads.
3. FIXED — unknown ≠ clean: direct_billing_effective + amber "switched — old book UNKNOWN" bucket; payload carries billing_unknown (spell out last_seen IS NOT NULL or a voided row leaks SQL NULL into the JSON).
4. FIXED — write-once stamp correction: audited void/unvoid (current-state columns + append-only void history).
5. FIXED — stale ECARS book: import result carries oldBookAsOf/AgeDays/Stale (unknown age = stale); conflict toast freshness-qualified; stale-book caution fires even on zero conflicts.
6. FIXED — prod schema drift: direct_billing_* columns are in the vrm_rental_cutover schema-health REQUIRED list (see partial-boot-migrations).
7. FIXED — racf-vs-ldap alias mismatch: zero-rowcount stamps surface as switchoverUnmatchedLdaps in the upload toast.

**How to apply:** all ranked risks above are closed; remaining softness is the toast-only surfacing of off-page (non-booked) conflicts. Any new work on this detector follows the standing rules above — silent false negatives beat cosmetic fixes.

## Premortem v2 (2026-08-22, post-merge architect round) — OPEN ranked risks

1. **Vendor layout drift parses plausibly-wrong (Critical).** The raw-OOXML parse can return rows under a changed layout; low-but-plausible counts hide missed doubles. Mitigation = fingerprint/header checks + row-count sanity vs prior successful import; reject + persist the failure. Real project.
2. **Confirmation never expires (Critical).** Write-once stamp + no negative reconciliation: a tech who LEFT direct billing stays "on direct" forever. Mitigation = freshness/absence rule in the effective predicate (seen in a recent accepted report). Real project — changes the predicate.
3. **LDAP-fallback stamps the wrong tech (High).** Reused/ambiguous LDAP without RACF. Mitigation = fallback only on a unique active-identity match, else count blind. Small change.
4. **Wrong/truncated file accepted (High).** Mitigation = show extracted report date + row count + confirm step; reject date regression/count collapse. Small-medium.
5. **Book anchors drift off the relevant ECARS ticket (High).** Rolls/rebooks after anchoring misclassify real conflicts as rolled/unanchored. Mitigation = anchor provenance + review queue for ambiguous linkage. Real project.
6. **Import failure lives only in an ephemeral toast (High).** Mitigation = durable import-run ledger (status/counts/error) surfaced on Cutover Tracking. Real project; supersedes the toast-only softness above and pairs with the #749 off-page-conflicts home.
7. **Prod schema drift / publish DROP erases evidence (Med-High).** Schema-health covers presence, not destructive publish diffs (see publish-drops-boot-ddl-tables). Process control.
8. **Void used to suppress a valid conflict (Med-High).** Named actor + 5-char reason is thin under pressure. Mitigation = second reviewer or expiry on voids of active open/rolled conflicts. Small-medium policy/UI.
