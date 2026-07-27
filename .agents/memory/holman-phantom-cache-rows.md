---
name: Holman phantom cache rows
description: Failed assigns leave phantom manual rows in holman_vehicles_cache forever (sync is upsert-only); self-heal must key on manual+never-synced, NOT number format — real Holman numbers can be alphanumeric.
---

# Holman phantom cache rows & the mismatch self-heal

**Rule:** A write-through assign whose truck number is bogus (e.g. a user typing "byov" → "00byov") can fail in TPMS but still write a local `holman_vehicles_cache` row (`data_source='manual'`, `last_holman_sync_at` NULL). The nightly Holman sync is upsert-only — it never deletes rows Holman doesn't return — so the phantom pins a permanent "Holman assigned / TPMS blank" mismatch until something removes it. The mismatch builder (`buildMismatchRecords`) now self-heals these: deactivates (`is_active=false`, tech fields cleared) rows matching ALL of (a) `data_source='manual'`, (b) `last_holman_sync_at IS NULL`, (c) number fails `^[0-9]{1,6}$`, and drops them from results only if the guarded UPDATE succeeded.

**Why:** Prod incident 2026-07-24: Weekly Onboarding assign to "byov" — TPMS rejected it, Holman leg wrote the phantom, mismatch persisted through every sync. Prod DB is read-only via tooling, so the fix had to be an in-code self-heal that fires on the first mismatch refresh after publish.

**Critical fact — number format is NOT a safe discriminator:** Real, sync-confirmed Holman vehicle numbers CAN be alphanumeric (live examples: `24024B`, `44801A`, `89482A`, `D4329`, `T0003`, `A06431`). Any phantom/garbage detection must lean on `data_source='manual'` + `last_holman_sync_at IS NULL` as the load-bearing guards; the write-through upsert never resets `dataSource` on conflict, so a real synced truck can never look "manual + never-synced". Never relax those two guards in favor of a number-format check.

**How to apply:** When adding any cleanup/validation over `holman_vehicles_cache` (or reasoning about "impossible" vehicle numbers anywhere), check provenance columns first, not the number shape. A wrongly-healed same-day new alphanumeric vehicle self-recovers on the next full Holman sync (upsert resets `isActive`/`dataSource`/tech fields).
