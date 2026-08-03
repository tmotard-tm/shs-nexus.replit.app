---
name: Holman PO refresh liveness & grid lag
description: Why "refresh does nothing" on the awaiting-auth queue is feedback + Holman clearance lag, not scraper staleness — token is TEMPLATE-stable, listing is live per-request
---

# Holman awaiting-auth refresh: what's live and what lags

- The KPI widget id token (`129_…`) is **TEMPLATE-stable, not per-render or per-session**: five separate fresh logins in one morning all harvested the identical token while the grid data changed every walk (6→7→7→8→3 rentals). Token identity proves NOTHING about data freshness — never read "same ctx id" as "stale snapshot."
- The DetailsListing GET is **live per-request** (same token, different data across walks), including on a warm cached session. The HTTP-only ~2s walk IS a genuine on-demand refresh; no fresh-login-per-press is needed.
- **Holman clears approved POs from its own awaiting-auth grid asynchronously with highly variable lag — sub-minute to ~80+ minutes observed.** A walk right after approvals re-scrapes just-approved POs; the queue upsert correctly skips locally-decided rows, so nothing visibly changes. By design: prevents approvals bouncing back as pending.
- The 30-min ARGUS cron effectively fresh-logins every tick anyway (session TTL 20 min < 30-min cadence).
- Approval postbacks DO land (grid shrank by exactly the approved POs between walks). `holman_approve_confirmed_at` ~30ms after attempted_at is local timestamping, not a no-op signal.

**Why:** Full investigation 2026-08-03 ("refresh button does nothing"): four presses in 6 min — every walk ran fine and found nothing new; the breakage was operator feedback, never the scraper. General trap: a react-query `setQueryData` that writes a PARTIAL response shape silently wipes sibling top-level fields (staleness header, failure banner) the UI renders from.

**How to apply:** For any "queue not refreshing" complaint: (1) prod `holman_po_sync_meta` proves walks ran; (2) diff row `last_synced_at`/`scraped_at` stamps against decision times to see what the grid held; (3) expect just-approved POs to linger in Holman's grid for up to an hour-plus — tell the operator, don't "fix" the scraper.
