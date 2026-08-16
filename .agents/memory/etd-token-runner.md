---
name: ETD token runner ops
description: Verified-working facts and operational traps for the ETD (etd.ehi.com) headless token mint and shared vrm_etd_token store.
---

# ETD token runner ops

- **Verified 2026-08-16:** `ETD_USER`/`ETD_PASS` Replit Secrets drive the headless Azure B2C login end-to-end on the workspace box — stock nix Chromium (via `ETD_CHROMIUM_PATH` shared env var), real-keystroke input past Jscrambler, mint ~28s, authenticated ETD call succeeded. "Does the login even work" is settled; future failures are drift (chromium nix hash, B2C flow, expired password), not design.

- **A resolved DSN makes the store mandatory, fail-fast BEFORE login.** `dsn_from_env` now falls back to `PROD_DATABASE_URL` (always present on this box), so the store is effectively always on; a missing `vrm_etd_token` table raises before any mint. To smoke-test credentials/login only, unset every DSN key for the process (`env -u ETD_TOKEN_DSN -u NEXUS_PROD_DB_URL -u NEXUS_DATABASE_URL -u PROD_DATABASE_URL`) → file-cache-only mode.
  **Why:** first arming attempt burned nothing but confused: mint refused while prod lacked the table (pre-publish), and it looked like a credential failure.
  **How to apply:** when `ensure`/`verify` stack-trace on `_require_table`, the fix is publish-the-app (boot DDL creates the table), never runner-side DDL.

- **Prod `vrm_etd_token` is created ONLY by app boot (publish).** The runner's own DDL is gated `ETD_TOKEN_ALLOW_DDL=1` and documented dev-only — respect it; don't create the prod table out-of-band.

- **Some etd-runner helpers live ONLY on Tyler's desktop, not in the repo:** `tech_schedule.py` (ServicePower working-day lookup behind `book_cutover --schedule-gated`) and `reconcile_roster.py` (regenerates `reference/etd_user_mapping.json` for SHS- username collisions). If a script references them on the box, ask Tyler for the files — they cannot be reconstructed here. The captured reservation template `reference/savedr_request.json` IS committed and cannot be reconstructed either; never regenerate it, only re-capture from a real browser booking.
