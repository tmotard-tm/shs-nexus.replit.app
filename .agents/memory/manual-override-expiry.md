---
name: Manual-override pins are episode-scoped
description: Pattern for auto-expiring manual locks/pins over scraped or synced data (VRM shop-phone lock is the reference implementation)
---

Manual overrides that pin a field against automated refreshes (e.g. the VRM shop-phone lock) must be scoped to the episode that prompted them, not to the record forever.

**Why:** Tyler's directive (Aug 2026): when a rental falls off the board and later returns, a months-old locked contact must not survive into the new episode — the scraper has to own the field again.

**How to apply:**
- Don't invent a new "last seen" column — reuse the board's own lifecycle clocks (`vrm_rental_operations_cases.present_in_latest`, `dropped_from_feed_at`, `last_seen_at NOT NULL`). A lock lives while ANY present case references the truck (as case_key OR identity-resolved assigned truck — no declined/auction filter, unlike UNIVERSE_CTE).
- Dual-clock grace (~7d): BOTH the board clock and the manual `edited_at` must exceed the grace. Board clock alone insta-kills fresh locks on already-dropped cases; edit clock alone lets never-boarded locks live forever. Grace absorbs known ETL feed flicker.
- The reset must reproduce what a scrape would write: share the scraper's pick helper (`pickShopFromEvents`) over STORED hist — never fork the pick logic, never fake `scraped_at`.
- Snapshot-then-update sweeps race with operators: re-check the disqualifying predicate (edit-clock age + still-locked) INSIDE the UPDATE, and gate audit rows/logs/counters on `rowCount > 0` — otherwise a mid-run re-lock is clobbered and audit claims an expiry that never applied.
- Keep `edited_by/edited_at` after expiry (audit of last manual edit); flip only `source` so UI provenance stops claiming manual.
- Unlocked manual values need no expiry — the next differing scrape replaces them anyway.
