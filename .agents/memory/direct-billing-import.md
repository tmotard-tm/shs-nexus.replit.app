---
name: Enterprise direct-billing rental import
description: Manual xlsx upload source 'enterprise_direct' — durable rules: ExcelJS vendor-file quirk, sweep-safety, truck authority, source coexistence, override expiry.
---

# Enterprise direct-billing rental import (`enterprise_direct`)

Manual upload for Enterprise's "Rental Agreement Detail Open Ticket Report" (direct-billing rentals that NEVER appear in the Snowflake ECARS feed). Temporary until a real feed exists.

## ExcelJS silently fails on this vendor xlsx
ExcelJS opens the file and returns **zero worksheets — no error**. Any "0 rows imported" symptom on a vendor xlsx should suspect the library before the file. The importer parses raw OOXML instead (jszip, cells aligned by cell ref because they're sparse).

## Full-state upload + source-scoped sweep = layout-drift hazard
Each upload is full open-ticket state and sweeps its source's absent cases. **Why:** a vendor column rename/drop that still parses would import structurally hollow rows and sweep every real case. **How to apply:** any future full-state import must refuse the whole file on missing load-bearing headers / bulk-blank key fields, never import-and-sweep degraded data.

## Truck authority (Tyler's locked rule)
Displayed truck = the resolved tech's **live TPMS assignment only**. Never a report value, never the booking intent's truck (booking-time snapshot), never the last-known truck→tech edge (may *confirm identity*, never supply the truck). No live truck → truckless case under a `db:<RA#>` key; blank enrichment is by design.

## Source coexistence & overrides
- **Why:** case_key is the truck, and the same physical rental can sit in both the ECARS feed and the direct report during changeover — two sources would ping-pong one key.
- While a live `enterprise_direct` case holds a case_key, feed rows for that key are dropped in persist; feeds reclaim automatically when the direct case leaves the report.
- **Override-expiry trap:** the PO-based identity-override expiry would wipe every human override the moment a case flips to the PO-less direct source — and in changeover the renter is the same person. Direct source is excluded; a PO-less case is no evidence the rental turned over.

## Cutover billing-switchover stamp (write-once)
The import stamps `vrm_rental_cutover.direct_billing_confirmed_at` for every identity-**RESOLVED** report row with a roster racf — REVIEW guesses never stamp ("never render a guess as fact").
- **Write-once by design:** absence from a later report means the rental *ended*, never "un-switched" — confirmed_at is COALESCE-protected; only last_seen/evidence refresh. Any future "clear the stamp" request contradicts this semantic and needs Tyler's sign-off.
- Sightings are collected per ROW **before** the per-truck dedupe (a tech whose rows all dedupe away still counts); latest rentalDate wins as evidence.
- Deliberately OUTSIDE cutover-anchor.ts Holman-book logic: that lane anchors the OLD `source='enterprise'` ECARS tickets; this stamp confirms the NEW direct-billed rental. Keep them separate.
- Stamp runs best-effort after case persist (non-fatal on failure — next upload re-stamps idempotently).

## Old-billing comparison (double-billed = switched + still on Holman book)
Tyler's control question: "who is still billed by Holman, especially if also on the new direct report."
- **One predicate everywhere:** double-billed = `direct_billing_confirmed_at != null` AND `holman_book_state IN ('open','rolled')`. Server (`findOldBillingConflicts` + payload `double_billed`) and client (`billingKeyOf` — KPI, facet, row tint, cell warning, CSV) must share it; non-null check, never truthiness.
- Book state is NEVER re-derived: the comparison is a pure filter over `buildCutoverStatusPayload()` rows (single source of the anchored-ticket join). Import calls it AFTER the stamp via dynamic import, best-effort — a payload hiccup can't fail the upload, but a comparison warning in logs means "no result", not "clean".
- 'pended'/'unanchored'/'' never conflict — unknown ≠ double-billed. 'rolled' DOES conflict (old ticket rewritten past swap = the classic double-bill shape).
- Facet UI: an actively-selected zero-count bucket must stay rendered or the filter emptying the table has no visible off-switch.

## Destructive imports need role gates
Full-state report imports are admin/developer-gated (`requireImportOperator`, before multer) — the `/api/vrm` session check only proves login (same lesson as fs-router-auth-gap).
