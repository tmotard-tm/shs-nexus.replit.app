---
name: nexus-schema-changes
description: How to add or change database tables/columns in Nexus safely. Use whenever touching shared/schema.ts, shared/vrm-schema.ts, shared/fleet-scope-schema.ts, the migrations/ folder, or before ever considering `npm run db:push` / drizzle-kit.
---

# Nexus Schema Changes

## The rule that outranks everything

**Deploys run NO migrations.** The Replit deploy is `npm run build` + `npm run start`; nothing applies `migrations/` at deploy time. Schema reaches production ONLY through idempotent raw-SQL boot DDL that runs when the app starts. A new `pgTable` or column added only to a `shared/*.ts` schema file will typecheck, work in dev, and silently never exist in prod.

## Which regime a table belongs to

| Tables | Type truth | DDL that actually creates them |
|---|---|---|
| `fs_*` (~39 tables) | `shared/fleet-scope-schema.ts` | `INIT_SQL` in `server/fleet-scope-schema-init.ts` (column adds go in the `DO $$` block at the bottom) |
| `vrm_*` (25 tables) | `shared/vrm-schema.ts` | `server/vrm/init-schema.ts` (enums via `ALTER TYPE ADD VALUE`; one-time migrations flag-gated) |
| `holman_rental_po_queue` | none (raw SQL only) | `server/vrm/init-schema.ts`; queries hand-written in `server/vrm/holman-rental-po-storage.ts` |
| `logical_entities`, `entity_table_members` | `shared/schema.ts` | `server/logical-entities-init.ts` (keep its lock/statement timeouts) |
| everything else in `shared/schema.ts` | `shared/schema.ts` | drizzle-managed; apply to dev via raw SQL (see below), prod picks it up per the project's publish process |

## Workflow for a change

1. Update the matching `shared/*.ts` schema file (types stay the source of type truth).
2. Add matching idempotent raw-SQL DDL in the correct init file (`IF NOT EXISTS` / guarded `DO $$` blocks).
3. Apply to dev with raw SQL (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...`) — do NOT rely on db:push.
4. Verify prod behavior is "self-heals on first boot after publish" — no manual prod migration step should be required.

## Hard prohibitions

- **Never `npm run db:push` against `fs_*`/`vrm_*` tables or prod.** They are managed outside drizzle-kit; push will try to "fix" them.
- **`db:push` hangs on interactive drift** (a TTY-only `external_apps_name_unique` prompt) and `--force` risks truncation. Use raw SQL on dev instead, keeping schema.ts in sync.
- Never edit `drizzle.config.ts`.
- Startup DDL that adds an FK referencing a discovery-written table can hang on autoscale boot — use skip-if-exists plus DB-side `lock_timeout`/`statement_timeout`, not JS timeouts.

## Deeper reading

- `CLAUDE.md` → "Schema lifecycle" section
- `replit.md` → Gotchas ("Drizzle Kit vs. Raw SQL Migrations", "db:push blocked by interactive drift")
- `.agents/memory/dbpush-interactive-drift.md`, `.agents/memory/startup-route-registration.md`
