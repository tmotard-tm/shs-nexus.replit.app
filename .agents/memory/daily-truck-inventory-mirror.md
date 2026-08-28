---
name: Daily truck inventory mirror
description: Durable scheduling and safety rules for the Snowflake-backed truck inventory snapshot.
---

Run the truck inventory refresh from Nexus at 07:00 `America/New_York`, with a startup catch-up when autoscale was asleep. This is an explicit exception to the usual Fleet Agents wake-up pattern. A completion before 07:00 does not satisfy that day's automatic watermark; failed runs remain due.

**Why:** The production mirror remained stale for months because an empty-only startup check could never refresh a populated table, while appending snapshots would make inventory totals span multiple extract dates.

**How to apply:** Determine due state from a completed run at or after 07:00 Eastern. Hold the dedicated advisory lock on the exact PostgreSQL session that performs the destructive transaction. Validate one strict nonempty extract date, then delete, batch-insert, and mark the run completed in that one transaction. Keep every inventory consumer scoped to the table-global latest extract date.