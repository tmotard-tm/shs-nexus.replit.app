---
name: VRM page parity audit map
description: Which VRM surfaces derive from the master board vs hold independent copies; where drift can re-enter.
---

Module-wide parity audit (dev data, Aug 2026) found the VRM pages aligned wherever they compose the master-board derivations. The drift risks are the surfaces that hold their OWN copies.

**Aligned by construction (verified on real rows, 0 mismatches):**
- LUCA rental list, cutover-status payload, ops queue (case-linked items), case panels — assigned truck/shop/status all match `getRentalOpsMaster`.
- Executive Summary drill-downs come from `getRentalOpsMaster()` rows via `buildCaseFacts` — same universe, no separate projection.
- Queue items without a `caseKey` are fleet-side lanes (trucks/fs sources), NOT missing cases — don't count them as parity failures.

**Independent copies (drift can re-enter here):**
- Repair Tracker (`vrm_repair_tracker`) stores its own truck/tech/shop/status/ETA; edits PATCH the tracker only. It is a tracker, not a view of the board — any "why do these disagree" report starts here.
- New Rentals Holman PO queue is a Holman/DB projection (own tech match, own rates from settings with hardcoded client fallbacks 78/10), not the board's PO derivation.
- Legacy `/rental-operations` page (client/src/pages/rental-operations.tsx) reads `/api/rental-ops/*` — the Fleet Scope DOWNSTREAM MIRROR universe, not VRM. Only reachable by direct URL + `/rental-dashboard` redirect. Retirement/redirect needs Tyler's call.

**Rule reaffirmed:** every manual identity/assign entry point must validate its target server-side against the tech-search sources (TPMS profiles first, active roster fallback) and derive display names server-side — the PO tech-match route once accepted any string as LDAP-and-name.

**Why:** Tyler's directive: one unified module, each page a different view of the same information. New pages should compose master-board/read-repository derivations, never re-source facts.
**How to apply:** before adding a field to any VRM page, check whether the master board already derives it; if a page needs its own table, treat divergence from the board as a displayed state ("tracker says X, board says Y"), not silent truth.
