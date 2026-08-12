---
name: Rental survey send audit findings
description: Structural gaps in the VRM rental-tech-survey issue/send pipeline found in the 2026-08 read-only audit
---
Durable gaps in the survey issue/send pipeline (beyond the \D regex bug, filed separately):
- **No vendor filter** on the recipient query — the open rental book includes Hertz/Avis/Pep Boys renters who get "Enterprise rental" texts.
- **Submitted tokens don't block re-issue**: NOT EXISTS excludes only live *unsubmitted* tokens, so anyone who answers (incl. "I returned it") is re-eligible on the next Issue while their case stays open in the lagging Holman feed → re-text after answering.
- **Send never re-checks the book**: send-chunk gates on sent_at IS NULL + expiry only; tokens live 14 days while the book churns ~6-7 closures/day → texting people whose rental already closed.
- **Identity key-type corruption exists**: at least one vrm_rental_identity_resolutions row stores an LDAP in resolved_employee_id → silent join drop; scan for racfid-shaped employee_ids.
- `all_techs.home_phone` is never read by the phone COALESCE chain — a recovery source for "no phone anywhere" techs.
- `tpms_tech_profiles` fans out per enterprise_id (dup profile rows) — DISTINCT ON hides it but picks a phone arbitrarily.
- **Prod schema-health is the deploy-liveness oracle**: GET /api/vrm/forms/schema-health with x-internal-cron header; ok:false with missing vrm_rental_request.source/origin_survey_id + byovMirrorRows=0 means prod boot predates current code → survey→request raising silently fails there.

**How to apply:** Re-verify each of these before any survey blast or before "fixing" downstream symptoms; the audit numbers (347 intended vs ~316 deployed) came from running intended-vs-cooked SQL variants against prod.
