---
name: Rental extension request semantics
description: Policy + guard rules for the "extension of my current rental" request type and its no-booking invariant
---

# Extension requests (vrm_rental_request.request_type='extension')

**The rule:** an extension is more time on the SAME unit, never a vehicle. It
always lands `pending` (REVIEW, no rule number), skips the category/maintenance/
age gates, requires the FULL acknowledgement set (all but `ack_has_appointment`)
re-signed every time, and `approved` is its TERMINAL state.

**Guard policy (settled with Fleet):**
- NEW is blocked by any live new (pending/approved/booked) or a pending extension.
- EXTENSION is blocked by a pending extension or a live new in pending/approved —
  but NOT by a booked new: the booked row is exactly the rental being extended.
- Open-door verify hard-409s only when BOTH doors are blocked.

**No-booking invariant — four doors, all must stay shut:** the booking-queue
lease CTE and held query, `POST .../:no/book`, `POST .../:no/booked` (runner
writeback — the easy one to forget), and orchestrator `createIntent`, all
exclude/refuse `request_type='extension'`. Any new booking entry point must add
the same predicate. `/decide` NULLs pickup/return/branch outright for extensions
(never COALESCE — a stale value reads like a booking downstream).

**Race safety is DB-enforced, not check-then-insert:** partial unique indexes
carry the invariants — one pending extension per LDAP on ALL doors
(ext_pending_uniq, token rows included), and a cross-type open-door index
(open_live_xtype_uniq: pending ext XOR pending/approved new per LDAP) so
concurrent opposite-type submissions can't both land. Token door: NEW skips
the live guard on purpose (Fleet-issued override), extensions never do.

**Mismatch is soft:** choice contradicting the rental-ops feed is a flag +
required explanation (enforced server-side too — the endpoint is public), never
a hard block, because the feed lags.

**Extension billing standing (settled semantics):** verdict = direct case →
direct_billed; else shared cutover standing 'booked' → direct_billed (a
lingering ECARS ticket after cutover is import lag, NEVER holman_only); else
open ECARS case → holman_only; else unknown — and unknown is never clean but
never gates. Only holman_only gates the APPROVE (server 409 without explicit
ack), and a standing-lookup failure degrades OPEN (approve proceeds, verdict
stamped 'unknown') — feed lag must not strand a real extension. Submit-time
pin is audit-only; the staff list re-computes live for undecided rows.

**Ack snapshots:** every submit (new AND extension) persists a server-built
`ack_snapshot` (canonical `ACK_TEXTS`, required keys only, signer + policy
version + timestamp). Legacy rows render from booleans with a
"current wording, signed under version X" caveat.

## VOID status (added 2026-08-25)
Extensions gained a fifth decision, VOID → status 'voided': administrative eraser for a request filed into the wrong queue (e.g. Holman-book-only tech needing the cutover first). Extension-only, note mandatory, sends NOTHING (no SMS, no Enterprise email), and refused atomically once the row is 'approved' (inside the locked decide UPDATE) — that refusal is what closes the race with the fire-and-forget approval email.
**Why:** 'voided' is a status-vocabulary change, and the dangerous consumer is any "latest non-denied request" predicate: the NEW_SYSTEM_LATERALS rq lateral picks the newest row, so a fresh voided extension would displace an older BOOKED row and flip the shared standing predicate booked→none.
**How to apply:** any new status added to vrm_rental_request must be swept through: the standing lateral (holman-rental-po-storage), liveRequestGuard, the two daily-cap queries, and the /stats KPIs (which aggregate frozen auto_decision over all rows — erased rows must be WHERE'd out or they inflate KPIs forever).
