---
name: ETD journey search is not an answer
description: ETD's Last30Days journey list returns every QUOTE ever taken, so a search result set must be filtered by positive identification, never returned wholesale
---
Rule: a row from ETD's journey search may only count as a given intent's reservation on POSITIVE IDENTIFICATION — the intent's unique SHS reference carried in ETD's single reference field, or a confirmation number already known to belong to that intent. When nothing identifies, the answer is "no reservation of ours exists", never "here is everything the search returned".

**Why:** ETD's `Last30Days` journey list contains every quote the engine has ever taken, not just reservations. A "filter, else return all rows" fallback therefore reported 65 unrelated journeys as one intent's duplicates; the orchestrator (correctly) refuses to book when more than one reservation identifies as the intent's, so a first-ever booking was parked in MANUAL REVIEW before an attempt was even opened.

**How to apply:**
- Reference identification is TOKEN-exact, never substring: the reference field is a space-joined string, and SHSNX-42 as a substring also lives inside SHSNX-420/421 (same for SHSRQ-*), so `includes`/`in` reports a NEIGHBOURING intent's reservation as this one's. Tokenize on non-[A-Z0-9-] and compare whole tokens — the rule now lives in THREE lockstep places (executor referenceTokens, book_cutover _reference_tokens, book_request via import).
- Every booking lane must embed its own unique SHS reference into the FIRST bookingReferences entry (ETD surfaces only refs[0] to the search): intents = SHSNX-{id}, legacy requests = SHSRQ-{no}. A lane that skips the embed makes its bookings unidentifiable — no later duplicate search can protect it.
- A pre-commit duplicate search alone cannot close a LIVE race (two processes both search before either commits); the queue lease deliberately lets a runner re-take its own name (dry-run→confirm workflow), so same-name concurrency needs a separate exclusion (legacy runner: per-machine OS file lock).
- The LDAP is NOT an identifier. One technician owns many journeys, so an LDAP-carrying reference says "this tech", never "this intent". It is fine as a *search criterion* (ETD's server-side filter) but must never widen what a row MEANS.
- Keep the search criteria and the identity rule as two separate steps: criteria may widen across passes, identification never does.
- Persist `rowsReturned` alongside `identified` as attempt evidence. "0 identified of 65 rows" (noisy search, none ours) and "0 of 0" (ETD answered empty) are different diagnoses, and a bare match count tells neither.
- Residual risk this rule accepts: a reservation booked BY HAND in ETD carries no SHS reference, so reconcile/cancel readbacks cannot identify it and will settle as "none". Anything relying on finding human-booked reservations needs a different witness.
- Both the in-server executor and the Python runner share one queue and one attempt ledger, so the identification rule AND the evidence wording must match exactly — a drift silently breaks cross-runner dedupe on a real reservation.
