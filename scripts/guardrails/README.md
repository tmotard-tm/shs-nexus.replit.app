# Guardrails

Scripts that protect production data on merge and deploy. Each guardrail is one file with a single responsibility.

| ID | File | Trigger | Action |
|---|---|---|---|
| G1 | `g1-merge-schema-gate.sh` | post-merge (replaces `drizzle-kit push --force` block in `scripts/post-merge.sh`) | Generates schema diff to a temp dir; blocks merge if diff contains DROP/RENAME/ALTER TYPE not in `.drizzle/allowed-destructive-ops.txt`. |
| G2 | `g2-pre-deploy-snapshot.ts` | pre-build during deploy | Captures row counts + indexes + constraints to `guardrails/snapshots/` in Object Storage. Retains last 10. Fire-and-forget. |
| G3 | `g3-migration-safety-gate.sh` | pre-deploy | Scans unapplied `migrations/*.sql` for destructive DDL; fails deploy if found. |
| G4 | `g4-post-deploy-integrity.ts` | post-deploy | Compares current row counts to latest G2 snapshot; per-table tolerance (`vrm_repair_tracker` ±20%, others ±2%, hard-fail at <50%). Writes `.local/alerts/`, optional SendGrid email. Never auto-rolls-back. |
| G5 | `g5-rollback-artifact.ts` + `g5-rollback.sh` | post-deploy success / break-glass | Records bundle hash + snapshot key + migration list in `deploys/history.json`; rollback shell reads the file and prints recovery steps. |
| G6 | `g6-dedup-protection.sql` | run on app boot via `server/vrm/init-schema.ts` | Adds `protected_from_dedup` column + BEFORE-UPDATE trigger that flips it on any manual edit. Dedup DELETE in `server/vrm/storage.ts` adds `AND protected_from_dedup = false`. |
| G7 | `g7-refresh-direction-guard.js` | pre-flight before `refreshDevFromProd.js` | Refuses to run unless source host contains a prod marker and dest host does not. |
| G8 | `g8-env-drift-check.ts` | app boot (first import in `server/index.ts`) | Asserts `DATABASE_URL.host` exactly matches `EXPECTED_PROD_HOST` when `NODE_ENV=production`; calls `process.exit(1)` on mismatch. No-op in non-production. Auto-fires on module load so it runs before any DB-touching import. |

## Dry-run env vars
- `G1_DRY_RUN=1` — generates diff and classifies, but does not call `drizzle-kit push`.
- `G2_DRY_RUN=1` — writes snapshot under `guardrails/dryrun/` instead of `guardrails/snapshots/`.
- `G3_DRY_RUN=1` — scans all migrations (skips `__drizzle_migrations` query) and reports classification only.
- `G4_DRY_RUN=1` — prints diff vs. latest snapshot but skips alert writing/email.
- `G5_DRY_RUN=1` — prints the would-be history entry without touching `deploys/history.json`.
- `G7_DRY_RUN=1` — exits 0 on missing args (no destructive consequence).
- G8 has no dry-run env var; instead use `tsx scripts/guardrails/g8-dry-run.ts` which spawns three subprocesses (match / mismatch / dev) and reports pass/fail per case.

## Wiring (proposed, not yet applied)
- `scripts/post-merge.sh`: replace the `drizzle-kit push --force` line with `bash scripts/guardrails/g1-merge-schema-gate.sh`.
- `package.json` deploy build: prepend `tsx scripts/guardrails/g2-pre-deploy-snapshot.ts &&` to the `build` script (or a dedicated `predeploy` script).
- `package.json`: add `"rollback": "bash scripts/guardrails/g5-rollback.sh"`.
- `server/vrm/init-schema.ts`: append a step to execute the SQL in `g6-dedup-protection.sql`.
- `server/vrm/storage.ts`: add `AND protected_from_dedup = false` to the dedup DELETE in `importDeniedToRepairTracker`.
- `.replit` and `package.json` diffs are listed at the bottom of the dry-run report — they are NOT yet committed.
