---
name: HOLMAN_ETL_PO_DETAILS loader gap & consumer bugs
description: Snowflake Holman PO table — status domain, ongoing load leak, and why the Nexus repair-start lookup never matches
---

# PARTS_SUPPLYCHAIN.FLEET.HOLMAN_ETL_PO_DETAILS

- **Grain**: line-item (multiple rows per PO). Holman portal exports are PO-grain — joins/backfills must account for the grain difference.
- **PO_STATUS domain**: PAID, VOID, APPROVED, HOLD, BILL HOLD, SUSPENDED, null. There is NO 'Open'/'Pending'/'In Progress'. "Open" = APPROVED (PO_PAID_DATE_TRUNCATED and VENDOR_INVOICE_NUMBER null); PAID fills both.
- **Ongoing load leak**: old loader SVC_SCA_AUTO stopped 2026-02-26; HOLMAN_DAILY_REFRESH covers only a rolling "Prior 5 Days" window. POs whose activity falls in a gap are missed permanently (verified Feb–Jul 2026 spread of missing open POs vs Holman live). Durable fix = periodic full open-PO reconciliation load; manual backfills are stopgaps and must carry provenance (LOADED_BY/FILENAME) + NOT EXISTS guards (the ETL uploads daily ~13:00, can race any diff).
- **FIRST_SEEN_DATE**: current loader leaves it NULL (only retired SVC_SCA_AUTO set it).
- **Vehicle number**: table stores Holman's raw form — mostly unpadded 5-char but some rows retain leading zeros. Don't normalize on write; Nexus normalizes on read.
- **Nexus repair-start lookup is dead code (two stacked bugs)** in the /queue daysInStatus path (fleet-scope-routes.ts ~5076 + ~5222): (1) queries PO_STATUS IN ('Open','Pending','In Progress') → always 0 rows; (2) even if fixed, lookup pads truck number to 6 digits while map keys are stored raw/unpadded → never matches. Fix both together: filter APPROVED (+HOLD if desired) and match on a canonical (ltrim-zeros) key on both sides.

**Why:** a Holman-live vs Snowflake diff (2026-07-20) found 80/669 open maint POs missing and traced the loader history via FILENAME/LOADED_BY/UPLOAD_TIMESTAMP.
**How to apply:** any feature reading "open POs" from this table must filter APPROVED, join on canonical vehicle numbers, and never assume the table is complete — check sync/loader recency first.
