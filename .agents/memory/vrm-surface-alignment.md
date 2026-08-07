---
name: VRM cross-surface alignment (display shop, phones, case model)
description: How the four VRM surfaces stay aligned on shared fields and what must not regress
---

The four case surfaces (Rental Ops master board, Cases by Region, Ops Queue chips, case drawer) show the SAME reconciled shop via ONE server assembly: reconciled PO pick first, fs_trucks repair phone as display-only fallback (flagged `shopPhoneIsFallback`).

Rules that must hold:
- Board routes go through the shared attach helper; poCtx=null keeps `reconciledShop` ABSENT on rows — stamping null instead reads as "authoritatively no pick" and blanks every board phone.
- The fs fallback fills the PHONE slot only: never a shop name, and never any `call_*`/`callable`/LUCA dial semantics.
- Fallback map folds fs_trucks dup-padding rows by canonical key; if one canon key has TWO different valid phones, the fallback is dropped for that key — row order must never decide whose phone a board shows (architect finding, fixed with a conflict-omit fold).
- ONE phone gate (`cleanPhone`: strips to digits, accepts 10-digit and 11-digit-leading-1, rejects repeated-digit junk) for chips, boards, drawer display, and step-9 dialability. The old second cleaner rejected +1 numbers and made surfaces disagree.
- Both board pages import ONE shared client case-model module (MasterRow + workload/new-hire/urgent derivations) instead of verbatim copies; Rental Ops extends it with its workbook fields only.
- SQL shop-name override must mirror the TS rule: `COALESCE(NULLIF(TRIM(override)),'')…` — whitespace-only overrides otherwise mask the vendor name only on some surfaces.

An alignment test suite + console workflow pins all of it (field-for-field board parity, queue chips === board pick, AMS bucket rule parity, exec headline re-derivation). Test gotchas: now()-derived age fields (e.g. PO-evidence age in hours) need a small clock tolerance between builds; if the master/region case SETS diverge mid-run an ingest raced the build — rebuild once, don't loosen assertions.

**Why:** surfaces drifted for real — queue-only phone fallback, two disagreeing phone cleaners, SQL vs TS override rules — and each drift surfaced as "the queue says X but the board says Y" bug reports.

**How to apply:** any new case surface or shared field: serve it through the shared builders/attach, add it to the shared client model, extend the alignment test. Never hand-roll a per-surface shop/phone pick.

OPEN policy questions flagged to Tyler (2026-08-07), intentionally NOT silently unified:
- Exec Summary counts PENDED cases in openTotal/dailySpend; boards exclude PENDED by default.
- "New hire" = ≤60 days in exec vs ≤270 days on boards — same label, different windows.
