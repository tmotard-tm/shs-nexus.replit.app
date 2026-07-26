---
name: nexus-verification
description: How to run, typecheck, and verify Nexus changes. Use when starting work, before claiming a change is done, or when the dev server won't start / port 5000 is contended.
---

# Nexus Verification & Dev Workflow

## Doc authority (read in this order)

1. `replit.md` — actively maintained, authoritative; its Gotchas supersede everything else.
2. `CLAUDE.md` — deeper technical companion (boot sequence, schema lifecycle); stale where it disagrees with replit.md.
3. `.agents/memory/MEMORY.md` — index of hard-won per-topic lessons.
4. When docs disagree with code, the code wins — verify doc claims by grep before acting.

## Commands

```bash
npm run dev     # tsx server/index.ts, port 5000, Vite HMR
npm run check   # tsc typecheck — the script is `check`, NOT `typecheck`
npm run build   # snapshot -> migration gate -> vite build -> esbuild server
```

## Typecheck discipline

- The repo has a **pre-existing baseline of ~224 tsc errors**. Passing = your changes add ZERO new errors versus baseline, not zero total. Compare filtered output for the files you touched.
- `npm run check` takes minutes; run it to completion (in a long-lived process/workflow, not a backgrounded shell that dies).

## Testing reality

- There is **no automated test suite**. Verification = `npm run check` + manually exercising routes.
- Exception: a few self-contained assert tests run directly, e.g. `npx tsx server/luca-writeback/mapper.test.ts`.
- Non-production boots seed test users (`server/create-test-users.ts`): `fleet_agent`, `assets_agent`, etc., password `test123` — log in with these to hit `requireAuth`-gated routes locally.

## Dev-server pitfalls

- "Didn't open port 5000" while logs show it serving = a duplicate `npm run dev` (orphan tsx from another shell/session) holds the port. Find and kill orphans before retrying restarts.
- Heavy DB/Snowflake bootstrap must stay AFTER `server.listen()` (autoscale promotion fails if the port doesn't open fast) — don't move bootstrap earlier.
- An unbounded `await` between route registrations in `registerRoutes` 404s every later route group — keep optional init detached.

## Prod verification

- Dev and prod use separate databases; prod DB is read-only via tooling. In prod SQL output, `START TRANSACTION/ROLLBACK` means the SQL **errored** (bad column), not zero rows; header-only output = zero rows. Verify column names against the schema files first.
- External writes: remember 202 ≠ applied (see the nexus-external-systems skill).

## Deeper reading

- `CLAUDE.md` → Commands section; `.agents/memory/replit-long-commands-typecheck.md`, `dev-server-port-contention.md`, `autoscale-listen-first.md`, `prod-executesql-error-swallowing.md`
