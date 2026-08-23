---
name: Public-form screenshot / SOP recipe
description: How to capture training-doc screenshots of the tech-facing rental forms and staff boards safely
---

Recipe for SOP/training-doc screenshots of the public rental-request form and SSO-gated staff boards.

**Rules that matter:**
- NEVER click submit on the public form in dev — COMMS_SEND_LIVE is on and identity-verify side effects are the only safe interaction (verify/lookup is read-only). Fill everything, screenshot, close.
- Pick walkthrough LDAPs by the REAL open-rental join (`vrm_rental_operations_cases` → `vrm_rental_identity_resolutions` → `all_techs` on employee_id), excluding anyone with rows in `vrm_rental_request` (avoids 409/429 on verify). Matching on enterprise_id_feed alone gives false candidates.
- Mask PII in the DOM before capture (page.evaluate): rewrite identity `<dl>` values by their `<dt>` label (Name/LDAP/Mobile) + regex-replace phone-shaped text nodes globally. Truck/district are fine to show.
- Radix selects on these forms often have CardTitle headings, not `<label>`s — target comboboxes by their CURRENT placeholder text (`/^Select$/`, `/^Select one$/`, `/^ST$/`) and answer in render order so placeholders stay unambiguous.
- Playwright script must live under the workspace root (node can't resolve `playwright-core` from /tmp). Chromium = stock nix build (see holman-headless-chromium-prod).
- Staff pages: mint a temp `sessions` row (real users.id or "User not found"), pass `Cookie: sessionId=…`, delete after — same as sso-gated-verification.
- Deliverable: self-contained HTML (data-URI images) → chromium `--headless=new --print-to-pdf --no-pdf-header-footer` → presentAsset. Verify pages with pdftoppm before presenting.

**Why:** first attempt burned two runs on module resolution + label-based select targeting; the safety rules (no submit, candidate join, PII mask) are invisible in the code.
