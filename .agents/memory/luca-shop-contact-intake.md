---
name: LUCA shop-contact intake loop
description: The one inbound LUCA write (resolved shop phones) — guard semantics, why accepted contacts are always locked, and the feed provenance keys.
---

# LUCA shop-contact intake (POST /api/vrm/rental-operations/luca/shop-contact)

The ONLY write LUCA may push into VRM. Rides the same agent-token guard
(`requireAuthOrLucaFeedKey`) as the two LUCA GET feeds; allowlisted per-path in
the /api/vrm middleware in server/routes.ts.

**Rules (all deliberate):**
- Decision table is a pure function (`shop-contact-intake.ts`), unit-tested.
  It reuses the shared `cleanPhone` gate and the exported `vendorKey` — write
  side must apply the SAME wrong-vendor rejection the read side does.
- Wrong vendor name vs the reconciled pick → 409 echoing the pick (LUCA
  re-resolves); never a silent overwrite.
- A human's locked number is never overwritten (legacy null source counts as
  human); LUCA may correct its OWN `source='luca'` value. Same-digits re-push
  is an idempotent 200 even when locked.
- No shop of record (BYOV / no repair PO) → name override + phone stored
  together in one transaction.

**Why accepted LUCA contacts are ALWAYS stored locked:** an unlocked
`source='luca'` phone is invisible to the feed's precedence chain (it only
surfaces via the portal vendor-name match, which the override name defeats) —
persisting a contact the feed won't return breaks the sync contract. Locks
stay episode-scoped via `expireStaleShopPhoneLocks`, so nothing pins forever.

**Why the write is transactional with an in-lock re-check
(`applyLucaShopContact`):** the route's decision runs on a snapshot read; an
operator saving a locked manual number in the gap must win. FOR UPDATE on the
portal-hist row + re-assert the guard predicates under the lock, name+phone in
the same transaction. (Same in-write re-check principle as the manual-override
sweeps.)

**Feed provenance:** luca-rental-list carries additive `SHOP_PHONE_SOURCE`
('manual'|'luca'|'pepboys_directory'|'po_scrape'|'portal_scrape') and
`SHOP_PHONE_LOCKED` so LUCA can rank verified numbers above scrapes.

**Ledger:** every intake outcome (ok/skipped/refused) writes an inbound
`shop_contact_update` row to `vrm_luca_activity_log`; audit rows go to
`vrm_rental_operation_actions` with actor `luca:<external_id>`.

**Ops note (2026-08-12 audit of LUCA's 24 no-phone rentals):** most were
genuine VRM gaps (never-scraped trucks, wrong-vendor rejections working as
designed, BYOV no-PO); one was LUCA-side staleness (VRM had the number, LUCA's
copy lagged). Pep Boys directory backstop misses on adjacent-zip/city-typo
(e.g. store zip 46037 vs shop addr 46038, "FISHER" vs "FISHERS") and on stores
absent from the 803-row directory — data gaps, not code bugs.
