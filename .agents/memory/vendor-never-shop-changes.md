---
name: Vendor never-shop rule changes
description: Checklist when extending VRM Rental Ops vendor exclusion/classification rules (banned shop-of-record vendors)
---

# Extending the never-shop / tow vendor rules

**Rule:** adding a banned vendor class is a FOUR-layer change, not a regex edit:
1. JS regexes in the vendor-class module (`TOW_RE` for classification, `NEVER_SHOP_RE` for the display gate) AND the Postgres form (`NEVER_SHOP_SQL_RE`, `\m/\M` boundaries) — kept in lockstep; a JS↔SQL parity unit test exists, add new fixtures to it.
2. Stored history backfill: `vrm_rental_operations_po_history.vendor_type` is materialized at ingest, so a regex fix alone leaves old rows classified `repair` forever. Backfill exactly what fresh ingest would produce (flip to `tow` only where `has_parts_labor IS NOT TRUE` — Tyler's parts/labor exception keeps the rest `repair`).
3. Client drawers must consume the server `reconciledShop` pick, and treat **null as "authoritatively no shop"** — never fall back to a raw `vendorType === 'repair'` pick, because banned vendors WITH parts/labor legitimately stay `vendorType='repair'` (open-count semantics) while still being display-banned. Only `undefined` (payload predates the field) may use the legacy raw pick.
4. Scope-check the new token against real data first: `SELECT vendor_name, count(*) FROM vrm_rental_operations_po_history WHERE vendor_name ~* '\mTOKEN\M' GROUP BY 1` — instant false-positive audit.

**Why:** Premier Auto Logistics (a transport/tow outfit, PO descr literally "ROADSIDE") surfaced as truck 36385's repair shop: its name matched no tow token, 103 historical rows were materialized `repair`, and the assigned-truck drawer tab re-derived its own pick from raw poHistory, bypassing the server gate entirely.

**How to apply:** any time Tyler bans a vendor class or a vendor name slips through (`LOGISTICS` added 2026-08-10 — matched ONLY Premier Auto Logistics fleet-wide at the time). Vendor NAME is the only input to the name regexes — never PO descriptions/ATA groups.

**Known residual gap:** the holman_etl ingest path passes only `hasPartsOrLabor` to the classifier (not `allRentalRoadside`/`anyRoadside` line flags), so a roadside-only PO from a vendor with a novel un-tokenized name still classifies `repair`. Fix is to aggregate ETL line types — see follow-up task.
