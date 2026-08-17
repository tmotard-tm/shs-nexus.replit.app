---
name: ETD journey search is not an answer
description: ETD's Last30Days journey list returns every QUOTE ever taken, so a search result set must be filtered by positive identification, never returned wholesale
---
Rule: a row from ETD's journey search may only count as a given intent's reservation on POSITIVE IDENTIFICATION — the intent's unique SHS reference carried in ETD's single reference field, or a confirmation number already known to belong to that intent. When nothing identifies, the answer is "no reservation of ours exists", never "here is everything the search returned".

**Why:** ETD's `Last30Days` journey list contains every quote the engine has ever taken, not just reservations. A "filter, else return all rows" fallback therefore reported 65 unrelated journeys as one intent's duplicates; the orchestrator (correctly) refuses to book when more than one reservation identifies as the intent's, so a first-ever booking was parked in MANUAL REVIEW before an attempt was even opened.

**How to apply:**
- The LDAP is NOT an identifier. One technician owns many journeys, so an LDAP-carrying reference says "this tech", never "this intent". It is fine as a *search criterion* (ETD's server-side filter) but must never widen what a row MEANS.
- Keep the search criteria and the identity rule as two separate steps: criteria may widen across passes, identification never does.
- Persist `rowsReturned` alongside `identified` as attempt evidence. "0 identified of 65 rows" (noisy search, none ours) and "0 of 0" (ETD answered empty) are different diagnoses, and a bare match count tells neither.
- Residual risk this rule accepts: a reservation booked BY HAND in ETD carries no SHS reference, so reconcile/cancel readbacks cannot identify it and will settle as "none". Anything relying on finding human-booked reservations needs a different witness.
- Both the in-server executor and the Python runner share one queue and one attempt ledger, so the identification rule AND the evidence wording must match exactly — a drift silently breaks cross-runner dedupe on a real reservation.
