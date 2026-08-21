---
name: OOS exclusion on available-truck surfaces
description: Why availability/assignability filters must use the durable Holman OOS signal (statusCode 2 OR past out-of-service date), never statusCode alone
---

**Rule:** Any surface that offers trucks as assignable or available (spare pools, assign-target validation, candidate pickers, cached "active" fleet reads) must treat a vehicle as out of service when its cached statusCode is 2 **OR** its out-of-service date has already passed. A future-dated OOS date means scheduled-not-yet-effective and stays in service.

**Why:** After an out-of-service submit, the sync writes the date but the cached statusCode stays at 1 until a much later sync flips it — observed fleet-wide on every truck in one OOS batch. A `statusCode = 1` filter alone kept them all "assignable". Holman's own lookup surfaces also null the statusCode once a vehicle leaves the active projection, so the date is the only durable signal on both cached and live reads.

**How to apply:** New availability queries over the Holman cache need the date guard, not just the status filter. The date column is text; in raw SQL gate the comparison behind an ISO-shape regex (spell character classes as `[0-9]`, never `\d`, inside drizzle sql templates) and compare the 10-char date prefix lexicographically to today's Eastern date. Fail direction differs by surface: candidate LISTS serve unfiltered (with a log) when the exclusion read fails; assign VALIDATION fails toward blocking. Match truck numbers via one shared canonicalizer on both sides — per-surface spelling (padded vs unpadded) will otherwise split the match.
