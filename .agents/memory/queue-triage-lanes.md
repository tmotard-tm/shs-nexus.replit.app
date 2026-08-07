---
name: Queue triage lanes & red-reserved policy
description: Today's Queue / Ops Queue lane semantics (ready/action/monitor), required whyText, step-9 location-problem coverage, and the "closed PO ≠ pickup evidence" de-red rule.
---

# Queue triage lanes & red-reserved policy

**Rule:** Every queue item carries a server-stamped `lane` (`ready` | `action` | `monitor`) and a required `whyText` (plain-English evidence). Lanes: ready = phone-confirmed pickup pipeline (steps 1-3); action = a human must fix something (9 location/record problems, 4 auth stuck, 7 with replacement); monitor = watch-only (8 PO/date inference, 5 LUCA retry cadence, 6 paperwork). Monitor renders collapsed by default on both queue UIs.

**Red is reserved** for real urgency only: overdue SLA, status conflicts, Totaled/Repair Declined. A closed/paid Holman PO is billing paperwork, NOT evidence the truck needs pickup — those rows are neutral monitor, never red. Contact-failure LUCA labels (No Answer, No Shop Contact, Call Failed) are amber retry states, not red.

**Why:** User directive (Aug 2026): the board was "all red", closed-PO rows implied false pickup urgency, and LUCA escalations needing human action (wrong phone, shop says truck isn't there) fell invisibly through step 5's badStatus filter into noAction. Step 9 ("Verify truck location / shop record") now claims those labels (Shop Does Not Have Truck, Relocated, No Shop Contact, Needs Tow, Unverified) plus workbook `escalated` cases.

**Step-9 evidence-aware disposition (2026-08-06):** step-9 lane/copy comes from ONE pure module (`evaluateStep9Disposition` in shop-record-flags). 'No Shop Contact' is LUCA's `shop_contact_missing` escalation (callDerived:false — it never dialed; its feed row had no usable phone), persisted on `fs_trucks.last_call_status` while the card chip is the LIVE reconciled pick — so the old copy could contradict its own card once the record improved. Demotion to monitor requires HARD evidence only: 'No Shop Contact' → the reconciled pick carries a dialable phone (the fs_trucks fallback phone is NOT LUCA-dialable and never demotes; that copy must not cite a call date — the escalation stamps none). 'Shop Does Not Have Truck'/'Relocated' → dispatch-provenance mismatch (dialed name/phone vs pick, BOTH sides present; missing values never flag; a newer PO date alone never demotes). 'Needs Tow'/'Unverified' never demote.

**How to apply:** New queue steps/rows MUST set lane + whyText (TS-required on the server QueueItem type — don't make them optional there). Don't route location-problem LUCA labels back into step 5. Both UIs (VRM OpsQueue inline-styles + FS TodaysQueue Tailwind mirror) must stay in lane-parity; lane banners expose `data-testid="lane-*"` and `aria-expanded` for testability.

## Scheduling-validation gate & AMS terminal override (added 2026-08-07)
- A truck whose shop status reads "Scheduling" must NEVER present as pickup-ready on its own: without validation (LUCA call history or a manual verify mark) it buckets as `scheduling_unvalidated`, not a pickup lane. `schedule_tech_pickup` requires `confirmedReady`.
- AMS declined/auction is TERMINAL and overrides shop-status classification entirely — such trucks bucket by the action actually needed (e.g. `ams_status_conflict`), never by pickup readiness.
- **Why:** "Scheduling" from the portal routinely means "shop answered the phone once", not "van is ready"; and a declined/auctioned van must not be dispatched to.
