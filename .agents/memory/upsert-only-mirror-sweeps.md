---
name: Upsert-only Snowflake mirror tables need per-table ghost sweeps
description: fixing ghost rows in one mirror table doesn't fix sibling pages — each upsert-only sync needs its own dropped_from_source_at sweep
---

**Rule:** Every Snowflake-mirror table filled by an upsert-only sync accumulates ghost rows when the source view stops returning someone. A sweep added to one table (`all_techs`) does NOT cover pages reading a different mirror (`onboarding_hires` → Weekly Onboarding). When a user reports "ghosts still showing after the fix," first check WHICH table that page reads.

**Why:** The all_techs sweep shipped and worked (266 flagged in prod), yet Weekly Onboarding still showed dropped employees — its `onboarding_hires` sync was separately upsert-only, and enrich only updates rows still present in Snowflake, so stale rows kept `employment_status='A'` and sat in the default Active filter.

**How to apply:** Pattern per table: `dropped_from_source_at` column; after a fully clean sync run, flag rows with `synced_at < runStart` (guarded by max(N, %-of-fetch) against thin feeds); facing reads exclude flagged rows; the upsert clears the flag on reappearance; direct-by-id lookups still see flagged rows. Column applied to dev DB via raw SQL + schema.ts kept in sync (db:push blocked by drift); publish diffs dev schema → prod. Candidate tables to check if this recurs elsewhere: any `sync*` in snowflake-sync-service.ts that only calls a bulkUpsert.
