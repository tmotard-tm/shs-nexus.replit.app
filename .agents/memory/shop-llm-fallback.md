---
name: Shop-from-comments LLM fallback
description: When the Bedrock shop extractor may run/override, its gates, cache, and provenance
---
- Policy: the LLM is a FALLBACK, not a second opinion. The automatic (scrape-path) trigger fires only when the deterministic header pick is empty, OR the newest payment-instrument PO ("Single Use CC" etc.) is strictly newer than the PO the pick came from — the card paid a shop the headers no longer name. Operator lock/sticky guards still win afterwards.
- The manual force route applies over the header pick but must still respect `shop_phone_locked` (SQL CASE inside the UPDATE) and derive its `applied`/`phoneApplied` response flags from `UPDATE ... RETURNING`, never from the pre-read (lock can land mid-request).
- Verdicts cache by sha256 evidence hash: deterministic outcomes (ok/no_shop/rejected) pin the hash = zero tokens on unchanged evidence; transient errors store hash NULL so the next sweep retries.
- Forced human calls are hourly-cap-EXEMPT and must NOT be pushed into the in-process cap array — pruning only happens inside the cap check, so recording them both eats the sweep quota and grows the array unbounded.
- LLM output passes the same gates a scraped header would: never-shop vendor rejection (tow/glass/TRAC/rental/payment/parts), name must classify as a repair vendor, usable 10-digit phone from the evidence, confidence ≥ 0.7. Provenance layer: `shop_src`/`shop_phone_source` = `llm_comments`.

**Why:** paid Single-Use-CC POs hide the real repair shop in free-text comments; the user wants those surfaced without ever letting the model clobber good deterministic or operator-entered data.
