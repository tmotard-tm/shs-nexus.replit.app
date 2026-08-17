---
name: Rental cutover prod→dev data pull
description: How survey/cutover data moves from prod into dev — additive upsert only, intents family is dev-only, generated columns must be excluded from any copier.
---

# Rental survey/cutover prod→dev pull

Prod holds the REAL process data in exactly four tables: `vrm_form_tokens`, `vrm_rental_tech_survey`, `vrm_rental_request` (0 rows so far), `vrm_rental_cutover`. The intents machinery tables (`vrm_rental_workflow_intents`, `vrm_workflow_attempts`, `vrm_workflow_send_guards`) exist ONLY in dev — that module has never booted in prod, so there is nothing to pull for them and they must never be clobbered by a refresh.

**Rule:** pull prod → dev for this family with `scripts/pull-rental-cutover-prod-to-dev.ts` — additive upserts only (tokens/survey/request on id, cutover on unique `ldap` with dev id + dev-only workflow columns frozen), prod session forced READ ONLY, one dev transaction, timestamped backups in the `backup_cutover_pull` schema first. Rerun = refresh (prod wins per-row; dev-native rows always kept).

**Why:** dev and prod row sets had ZERO id overlap (dev rows are working fixtures for the request workflow; prod rows are live techs). A TRUNCATE-style refresh would delete dev fixtures and NULL the dev-only cutover workflow columns — the user constraint was "no data loss", so nothing is ever deleted.

**How to apply:**
- Any copier into these tables must EXCLUDE dev columns with `is_generated='ALWAYS'` or identity (e.g. `vrm_rental_tech_survey.corrected_shop`) — explicit inserts fail with "cannot insert a non-DEFAULT value into column". The generic `scripts/refreshDevFromProd.js` does NOT do this and would also TRUNCATE the family — do not point it at these tables without hardening.
- Copied prod tokens include a few unsent (`sent_at IS NULL`) rows that PROD owns — never run the dev survey send-chunk/issue routes against real batches after a pull (no auto-sender exists in dev; the risk is manual).
- After a pull, prod-sourced `vrm_rental_cutover` rows have NULL `intent_id`/`workflow_*` — that is correct (intents are created dev-side by the machinery, not copied).
