---
name: Holman PO refresh liveness & grid lag
description: Why "refresh does nothing" on the awaiting-auth queue is usually feedback, not the scraper — Holman grid clears approvals async, token is session-stable
---

# Holman awaiting-auth refresh: what's live and what lags

- The HTTP-only walk (cached 20-min session, ~2s, no Chromium) fetches **live** grid data on every DetailsListing GET. The KPI widget id token (`129_…`) is **session-stable**: identical ctx id across forced `_Zones` re-renders is NORMAL, not a sign that force=false or that data is frozen.
- **Holman clears approved POs from its own awaiting-auth grid asynchronously** — observed lag ranges from a few minutes to >13 min. A walk right after approvals re-scrapes the just-approved POs; the queue upsert correctly skips locally-decided rows (WHERE status IN pending/blocked/… gate), so nothing visibly changes. This is by design — it prevents approvals from bouncing back as pending.
- Consequence: an operator pressing Refresh right after approving sees zero change and reads it as "refresh broken." Check the walk meta (`holman_po_sync_meta` single row: last_walk_started/completed/ok/rows) and per-row `last_synced_at` bumps before suspecting the scraper.
- Approval postbacks DO land: grid shrank by exactly the approved POs between walks (6 rentals → 3 within minutes of 5 approvals). `holman_approve_confirmed_at` ~30ms after attempted_at is just local timestamping, not evidence of a no-op.

**Why:** Full investigation 2026-08-03 (4 refresh presses in 6 min, all walks ok, "nothing happened") traced to Holman-side clearance lag + a client feedback bug — NOT scraper staleness.

**How to apply:** For any "queue not refreshing" complaint: (1) prod `holman_po_sync_meta` proves walks ran; (2) diff row `last_synced_at`/`scraped_at` stamps against decision times to see what the grid held; (3) then audit the CLIENT feedback path — known trap: refresh mutation's `setQueryData` writing `{rows}` only clobbers top-level `lastSyncedAt`/`syncStatus` off the query cache (header regresses to "Not yet synced", failure banner can't render) with no refetch until refocus.
