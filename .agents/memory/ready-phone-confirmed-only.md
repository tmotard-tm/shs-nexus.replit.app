---
name: Ready = phone-confirmed only
description: Ops Queue "vehicle ready" policy — closed-PO/passed-ERD evidence is a confirm signal, never a ready verdict.
---

# Ready is phone-confirmed only

**Rule:** A truck reaches "VEHICLE READY — RETRIEVE ASAP" (step 3 / `vehicle_ready_schedule`) only on phone confirmation: a LUCA Ready call OR a human's manual "verified ready" mark. Closed-PO / passed-ERD inference alone routes to a separate "PO CLOSED — CONFIRM WITH SHOP" step (`po_closed_confirm`); if the shop can't be validated, staff escalate to `research_truck_status`.

**Why:** Of ~173 items the old inference called "ready", only ~9 were LUCA phone-confirmed; the rest were closed-PO guesses that sent techs to shops that didn't have a ready truck. User approved the split explicitly.

**How to apply:**
- Verification state is append-only latest-wins rows in `vrm_rental_operation_actions` (`ready_verified` / `research_escalation` action types), keyed by case_key/truck — shared by Ops Queue, Rental Operations, and Cases by Region (one DB state, three surfaces).
- Supersede: a verify mark is void once ANY newer call lands; a research mark is void only once a RESOLVED call lands (No Answer/Failed/Inconclusive/No Shop Contact don't clear it).
- Verified-ready beats research; research suppresses `po_closed_confirm` and `shop_unreachable_callback`.
- Any new "is it ready?" consumer must gate on phone confirmation (luca||verified), never on PO/ERD state alone.
- A LUCA Ready call now ALSO flips fleet status (Repairing/Confirming Status/Decision Pending → Scheduling + "To be scheduled for tech pickup") via the guarded append — see vrm-automated-status-writes.md. There is no "Ready" main status in the vocab; step-3 status-conflict rows were the symptom of skipping this write.
