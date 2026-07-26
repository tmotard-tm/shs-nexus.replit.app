# AGENTS.md — Nexus

Guidance for any coding agent (Claude Code, Codex, Cursor, Gemini CLI, Replit Agent, etc.) working in this repository.

## Read first, in this order

1. **`replit.md`** — the actively maintained operational doc. Authoritative; its "Gotchas" and sync sections supersede everything else.
2. **`CLAUDE.md`** — deeper technical companion (boot sequence, schema lifecycle, integration landmines). Treat as stale where it disagrees with `replit.md`.
3. When either doc disagrees with the code, the code wins — verify doc claims by grep before acting on them.

## Skills (portable agent skills)

Project-specific skills live in **`.agents/skills/<name>/SKILL.md`** (standard Agent Skills format: YAML frontmatter with `name` + `description`, then instructions). `.claude/skills` is a symlink to the same directory, so Claude Code discovers them automatically. Other agents: read the skill whose `description` matches your task before writing code.

| Skill | Read it before... |
|---|---|
| `nexus-schema-changes` | touching any `shared/*schema*.ts`, migrations, or drizzle-kit |
| `nexus-scheduled-jobs` | adding/debugging any recurring or background job |
| `nexus-destructive-syncs` | touching any sync that prunes, archives, or overwrites data |
| `nexus-external-systems` | calling Holman, TPMS, AMS, WMS, AIMS/Snowflake, or Neon |
| `nexus-verification` | claiming work is done, or fighting the dev server/typecheck |

## Lessons archive

`.agents/memory/MEMORY.md` is an index of hard-won per-topic lessons (one file per topic in `.agents/memory/`). Skim the index when your task touches a listed area.

## Quick facts

- Stack: Express + React 18 + Vite + Drizzle/Postgres (Neon) monorepo; runs on a Replit **autoscale** deployment.
- `npm run dev` (port 5000) · `npm run check` (typecheck; there is no `typecheck` script) · `npm run build`.
- **No test suite**; ~224 pre-existing tsc errors are baseline — your changes must add zero new ones.
- **Deploys run no migrations** — schema reaches prod only via idempotent raw-SQL boot DDL (see `nexus-schema-changes`).
- External systems (Holman/TPMS/AMS/...) are single shared **production** instances, even from dev.
- Never edit `package.json`, `drizzle.config.ts`, `vite.config.ts`, or `server/vite.ts`.
