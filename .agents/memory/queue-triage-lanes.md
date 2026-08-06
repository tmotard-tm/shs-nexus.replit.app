---
name: Queue triage lanes & red-reserved policy
description: Today's Queue / Ops Queue lane semantics (ready/action/monitor), required whyText, step-9 location-problem coverage, and the "closed PO ≠ pickup evidence" de-red rule.
---

# Queue triage lanes & red-reserved policy

**Rule:** Every queue item carries a server-stamped `lane` (`ready` | `action` | `monitor`) and a required `whyText` (plain-English evidence). Lanes: ready = phone-confirmed pickup pipeline (steps 1-3); action = a human must fix something (9 location/record problems, 4 auth stuck, 7 with replacement); monitor = watch-only (8 PO/date inference, 5 LUCA retry cadence, 6 paperwork). Monitor renders collapsed by default on both queue UIs.

**Red is reserved** for real urgency only: overdue SLA, status conflicts, Totaled/Repair Declined. A closed/paid Holman PO is billing paperwork, NOT evidence the truck needs pickup — those rows are neutral monitor, never red. Contact-failure LUCA labels (No Answer, No Shop Contact, Call Failed) are amber retry states, not red.

**Why:** User directive (Aug 2026): the board was "all red", closed-PO rows implied false pickup urgency, and LUCA escalations needing human action (wrong phone, shop says truck isn't there) fell invisibly through step 5's badStatus filter into noAction. Step 9 ("Verify truck location / shop record") now claims those labels (Shop Does Not Have Truck, Relocated, No Shop Contact, Needs Tow, Unverified) plus workbook `escalated` cases.

**How to apply:** New queue steps/rows MUST set lane + whyText (TS-required on the server QueueItem type — don't make them optional there). Don't route location-problem LUCA labels back into step 5. Both UIs (VRM OpsQueue inline-styles + FS TodaysQueue Tailwind mirror) must stay in lane-parity; lane banners expose `data-testid="lane-*"` and `aria-expanded` for testability.
