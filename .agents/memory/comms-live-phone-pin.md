---
name: Comms live phone pin vs snapshot
description: How a live-pulled TPMS phone number is protected from the lagging TPMS_EXTRACT snapshot in the comms contacts sync
---

**Rule:** `fs_comms_phone_history` rows with `source='live_tpms'` pin a contact's phone against the daily contacts sync. The snapshot may overwrite only when its `FILE_DATE` is STRICTLY after the ET calendar day of the pull (pure helper `snapshotDateSupersedesLivePin` in the comms lib). For pinned contacts the sync nulls the INCOMING phone/phoneDigits/phoneLastVerifiedAt so the existing preferNonNull upsert keeps the live value — no special-case write path, and the pull's verify stamp survives.

**Why:** TPMS_EXTRACT lags live TPMS ~1 day; a number fixed in TPMS today was silently reverted by that night's sync. Strictly-after (not >=) because a same-day file still predates the pull. Self-expiring: the next dated snapshot naturally supersedes.

**How to apply:**
- Any new writer of comms contact phones must either write a `live_tpms` history row (to pin) or route through the sync merge.
- Both writers serialize on advisory xact lock `fs_comms_live_phone_pin`: the pull route's transaction (contact + history + thread denorm are atomic — a pin-less phone write is unprotected) and the sync's upsert transaction, which RE-checks for late pins in-tx so a pull can't land in the read→write window and be clobbered. Keep the lock if adding phone writers.
- Pin lookups fail OPEN (proceed unpinned) — a broken lookup must never wedge the daily sync.
- Gotcha: snapshot `MOBILEPHONENUMBER` can be blank for techs whose mirror number came from live per-tech calls — "pin held 0" may just mean nothing-to-hold, not a broken guard. Verify the held path with a contact whose phone has a recent `source='sync'` history row.
