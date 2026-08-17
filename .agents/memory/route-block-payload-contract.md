---
name: Standard Activities route-block payload contract
description: The two payload rules that decide whether a filed route block is usable by the DCA, and the measured evidence behind each.
---

# Route-block payload contract

A filed block is only useful if BOTH hold:

1. **`StartTimeRequest: "Exact"`, `StartTime: "08:00"`.**
2. **`LocationValue` = the ZIP5 of the branch the reservation was booked at**, and no ZIP means *do not file*.

**Why:**

*Rule 1.* `"Anytime"` does not mean "start at the requested time"; it tells the
ServicePower optimizer the time is a preference it may move. Measured against
`PRD_SERVICEPOWER.BATCH_TBLS.SCH_ACTIVITIES_PROD`, of the blocks one lane filed
with `"Anytime"` that landed correctly typed, only **11 of 136 came back at
08:00:00** — the rest scattered from 06:23 to 15:55. The technicians had already
been texted "8:00 AM", so the whole batch was repaired by hand. This is the
regression that kept coming back: the wrong value reads as intentional, because
the block's own DCA note says a human may move the slot if the branch has a
conflict. Those are different things — a human moving it is fine, the optimizer
silently relocating a time we already promised is not.

*Rule 2.* The vendor reference types `LocationValue` as "Zip code". The
structured location is the ONLY thing the scheduler computes drive time from —
notes are invisible to it. Two ways this breaks quietly:
- passing the full **ZIP+4** off a stored branch address (`...,EL PASO,79904-2805`);
- a missing ZIP degrading to `LocationType: "None"`, which files a block with no
  destination at all rather than failing.

**Also settled:** `ActivityType "46"` is correct and no longer a guess — every
filed block came back as `ACTIVITY_TYPE_DESCRIPTION = 'Vehicle - Change'`, which
is the token the readback matches on. Code comments calling 46 "evidence-based,
unconfirmed" are stale.

**How to apply:**

- Any new caller of the Standard Activities client for a cutover/vehicle-change
  block must send `Exact` + `08:00` and a 5-digit ZIP, and must refuse to file
  without one. There is **no cancel API**, so a bad block cannot be withdrawn —
  refusing to file is always cheaper than filing and repairing.
- Parse a branch ZIP with a **trailing-anchored** regex. A leading street number
  is five digits too (`11130 FUQUA ST, HOUSTON, 77034` must yield `77034`).
- The readback matcher requires `EXPECTED_START_TIME` to equal `08:00:00`
  **exactly**. A scheduler-shifted block therefore reads as a mismatch and lands
  in manual review — safe (reconcile treats block-like mismatches as review, never
  refile) but it means any drift shows up as a wave of manual-review rows rather
  than a visible payload error.
- Verification is next-day: the snapshot reloads around 04:09 ET, so a block
  filed today cannot be confirmed until tomorrow morning. Plan proof batches
  around that, not around same-day checking.
