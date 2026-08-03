---
name: Holman PO queue reopen guard
description: Decided rental POs RETURN to Holman's awaiting grid (weekly extensions reuse the PO number, same $0.00); reopen predicate + grid sighting stamp keep them visible
---

# Decided Holman rental POs can come BACK

- Weekly rental extensions re-authorize on the SAME PO number, usually at the same $0.00 requested amount. Holman re-lists the PO on the awaiting-authorization grid; sometimes the only visible change is the Submitted date — sometimes nothing at all.
- The queue upsert freezes decided rows (approved/denied/resolved_holman) with a row-level WHERE. While "amount changed" was the only reopen trigger, a re-listed same-amount PO was invisible FOREVER — on 2026-08-03 the operator found two of them inside the portal himself.
- Fix shape (rental-PO storage upsert): reopen a decided row when the PO is still being scraped AND (amount changed OR submitted_date differs OR the decision is older than a clearance grace of 120 min). Reopen = status pending, approved_in_holman false, error cleared, audit stamps (reopened_at/count/from_status/reason); decided_* preserved for provenance. Walk reports a reopenedCount measured by re-reading statuses AFTER the upsert (the rule lives in SQL — don't duplicate it in TS).
- `grid_last_seen_at` is stamped for EVERY scraped PO in one batched UPDATE after the per-row loop — including frozen decided rows the upsert WHERE skips. Without it, "is Holman still listing a PO we decided?" is unanswerable from the DB.
- Grace calibration: API-postback approvals linger ~30–85 min; manual portal approvals clear <6 min. Grace must exceed worst API lag — hence 120 min.
- False reopens self-heal: the row returns pending; when Holman finally clears it, the absent-from-scrape sweep retires it as resolved_holman.
- Residual accepted: submitted_date compares raw text, so a Holman date-format change would mislabel a reopen as 'resubmitted'. Harmless — reopens only fire for POs genuinely on the awaiting grid.

**Why:** Frozen-decided semantics protect against approvals bouncing back as pending during clearance lag — but freezing with "no change" as the only signal turns every re-listed PO into a permanently hidden one. Same-day consequence: operators approve blind in the portal and the app's queue silently under-reports.

**How to apply:** Any "Holman shows N awaiting, page shows fewer": for decided rows compare grid_last_seen_at vs decided_at/last_synced_at — a fresh sighting on an old decision means the reopen path should have fired; reopen_reason/reopen_count are the telemetry. Never widen the freeze without a grace-window escape hatch.
