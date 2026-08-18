---
name: Holman applies writes in nightly batch windows
description: Holman /vehicles/submit records are applied in ~00:xx and ~05:xx UTC batches, not in real time — so short verification timeouts mark good submissions as failed.
---

# Holman applies queued writes in nightly batch windows

**Rule:** A 202 from `/vehicles/submit` means *validated and queued*. Holman applies queued records in **two nightly batch windows, ~00:xx and ~05:xx UTC** (~8pm and ~1am ET). A record submitted outside a window waits for the next one — up to ~19 hours. Never treat "not applied yet" as "failed" until at least one full window has passed.

**Why:** Measured across the full live fleet (12,529 vehicles, 11,198 with a `lastChangeDate`), the hour-of-day distribution of `lastChangeDate` is:

- 00:xx UTC — 8,009 changes (71.5%)
- 05:xx UTC — 2,486 changes (22.2%)
- every other hour — ~0.1–0.6% each (portal edits by humans)

That is ~94% of all changes in two hours of the day. The 00:xx cluster is genuine, not a date-only rendering artifact: zero of those rows have an exact `00:00:00` timestamp.

This was learned the hard way. Ten out-of-service submissions returned 202/`errorCount: 0` and were reported to the user as done; ~6.5 hours later nothing had changed, and the fleet's active/OOS totals were untouched. Two independent defects were in play — a missing `assetAction` (see holman-inbound-vehicle-schema.md) *and* the batch-window delay — so fixing only one would still have looked like a failure.

**How to apply:**

- `lastChangeDate` + `lastChangeRecordId` on the read record are the **ground truth for "did my write land"**. If `lastChangeDate` has not advanced past your submit time, Holman has not touched the record — regardless of what the submit response said. This is the cheapest possible liveness probe and it needs no writes.
- To prove a write path works at all without corrupting data, re-send a payload whose every field already equals the record's current value (a semantic no-op) and watch `lastChangeDate`. If it does not move, the problem is the payload or the queue, not the specific field you care about.
- Verification timeouts must be **action-aware**. A 20-minute expiry is fine for assign/unassign but will fail every lifecycle submission hours before Holman looks at it. Lifecycle writes need a window covering a full cycle (both nightly windows) plus margin.
- Tell operators to expect an overnight wait, or they will reasonably conclude the feature is broken when the count does not move.
