---
name: Holman PO refresh liveness & grid lag
description: Why "refresh does nothing" on the awaiting-auth queue is feedback + Holman clearance lag, not scraper staleness — token is TEMPLATE-stable, listing is live per-request
---

# Holman awaiting-auth refresh: what's live and what lags

- The KPI widget id token (`129_…`) is **TEMPLATE-stable, not per-render or per-session**: five separate fresh logins in one morning all harvested the identical token while the grid data changed every walk (6→7→7→8→3 rentals). Token identity proves NOTHING about data freshness — never read "same ctx id" as "stale snapshot."
- The DetailsListing GET is **live per-request** (same token, different data across walks), including on a warm cached session. The HTTP-only ~2s walk IS a genuine on-demand refresh; no fresh-login-per-press is needed.
- **Clearance lag depends on the approval path (measured 2026-08-03): our API/WebForms-postback approvals linger on Holman's awaiting-auth grid ~30–85 min; manual in-portal approvals vanish in <6 min.** A walk right after API approvals re-scrapes them; the queue upsert skips locally-decided rows inside the reopen grace window, so nothing visibly changes. By design: prevents approvals bouncing back as pending. A decided PO still listed WELL past the grace is NOT lag — it's a re-authorization or an unapplied decision (see holman-po-reopen-guard.md).
- The 30-min ARGUS cron effectively fresh-logins every tick anyway (session TTL 20 min < 30-min cadence).
- Approval postbacks DO land (grid shrank by exactly the approved POs between walks). `holman_approve_confirmed_at` ~30ms after attempted_at is local timestamping, not a no-op signal.

**Why:** Full investigation 2026-08-03 ("refresh button does nothing"): four presses in 6 min — every walk ran fine and found nothing new; the breakage was operator feedback, never the scraper. General trap: a react-query `setQueryData` that writes a PARTIAL response shape silently wipes sibling top-level fields (staleness header, failure banner) the UI renders from.

**How to apply:** For any "queue not refreshing" complaint: (1) prod `holman_po_sync_meta` proves walks ran; (2) diff row `last_synced_at`/`scraped_at` stamps against decision times to see what the grid held; (3) expect API-approved POs to linger in Holman's grid up to ~1.5h (manual portal approvals clear in minutes) — tell the operator, don't "fix" the scraper.
