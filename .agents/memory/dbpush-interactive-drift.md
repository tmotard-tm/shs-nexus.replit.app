---
name: db:push blocked by interactive drift prompt
description: drizzle-kit push hangs on a TTY-only prompt from pre-existing external_apps_name_unique drift; how to apply schema changes anyway
---

`npm run db:push` currently stalls on an interactive select prompt ("add external_apps_name_unique unique constraint … truncate?") caused by pre-existing drift unrelated to whatever change you're pushing. The prompt is a TUI select — piping newlines does NOT answer it, and `--force` risks choosing the truncate path (external_apps holds the App Launcher icon rows — never truncate it).

**How to apply**: add new columns/indexes to the dev DB with raw SQL (`ALTER TABLE … ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`) while keeping `shared/schema.ts` in sync. The publish flow diffs dev schema → prod, so prod picks the change up at publish; verify roster/feature routes after publish since new columns referenced by every read will 500 if missing.

**Why:** the constraint drift predates the session; resolving it via a blind default in a non-TTY could truncate a 6-row production-seeded table.
