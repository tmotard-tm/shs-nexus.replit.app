---
name: BYOV prefix check pad order
description: Order of operations bug when normalizing truck numbers alongside a prefix-based classification rule (BYOV = starts with '88').
---

`detectByov()` (server/byov-utils.ts) checks `truckNumber.startsWith('88')` on the RAW truck number string, no padding involved.

When building equivalent logic elsewhere (e.g. a Snowflake view unioning truck numbers from multiple source tables that need zero-padding to 6 digits for joins), do NOT pad before checking the '88' prefix. A 5-digit BYOV truck like `88144` becomes `088144` after zero-padding, which no longer matches `LIKE '88%'`, silently reclassifying real BYOV trucks as `company`.

**Why:** confirmed empirically — comparing a candidate Snowflake classification view against the app's live classification for a random sample of technicians caught exactly this: 9/10 matched, the 1 mismatch was a BYOV truck misclassified as company due to pad-then-check ordering.

**How to apply:** when writing truck-number classification/normalization SQL (or any code) that both (a) needs a zero-padded canonical form for joins/dedup and (b) has a prefix-based rule, carry the original un-padded/trimmed value through for the prefix check, and only use the padded form for joins.

**Related domain rule (user-confirmed 2026-07-26):** BYOV trucks (88/088 prefix) have NO shop/repair information anywhere — BYOV repairs are not tracked. Rental-ops UIs must show an explicit "BYOV — repairs not tracked" state instead of "no shop"/"not scraped" warnings, and BYOV rows must never enter the LUCA shop-call queue (nothing to call). Applies to any future rental-ops rebuild/graduation.
