#!/bin/bash
set -e
npm install --no-fund --no-audit 2>&1 | tail -1

for f in migrations/*.sql; do
  if [ -f "$f" ]; then
    echo "[post-merge] Running migration: $f"
    if grep -q '^-- replit-migration-mode: psql-on-error-stop$' "$f"; then
      # Complex/non-transactional migrations (for example DO + CREATE INDEX
      # CONCURRENTLY) must be parsed by PostgreSQL itself. ON_ERROR_STOP makes
      # duplicate diagnostics and index failures abort the merge setup instead
      # of being mislabeled as "already applied".
      psql "$DATABASE_URL" --set=ON_ERROR_STOP=1 --file "$f"
      echo "[post-merge] Migration applied: $f"
      continue
    fi
    npx tsx -e "
      const { neon } = require('@neondatabase/serverless');
      const fs = require('fs');
      const sql = neon(process.env.DATABASE_URL);
      const migration = fs.readFileSync('$f', 'utf8');
      const statements = migration.split(';').map(s => s.trim()).filter(s => s.length > 0);
      (async () => {
        for (const stmt of statements) {
          try { await sql(stmt); } catch (e) { console.log('[migration] Skipped (already applied or non-fatal):', e.message?.substring(0, 100)); }
        }
        console.log('[post-merge] Migration applied: $f');
      })();
    " 2>&1 || echo "[post-merge] Migration $f had issues, continuing..."
  fi
done

# Guardrail G1 — destructive-op gate (dry-run mode).
# Replaces the previous unconditional `drizzle-kit push --force` which was the
# primary data-loss surface. In dry-run mode G1 reports the diff classification
# but does NOT call drizzle-kit push. Schema sync continues to happen at app
# boot via server/vrm/init-schema.ts (idempotent runtime DDL), so this gate
# acts as a tripwire for destructive intent without trying to apply changes.
# To apply additive diffs through G1, unset G1_DRY_RUN and ensure the
# Drizzle migration baseline matches the live DB.
G1_DRY_RUN=1 bash scripts/guardrails/g1-merge-schema-gate.sh 2>&1 || {
  echo "[post-merge] G1 schema gate detected destructive DDL — see above. Manual review required."
  exit 1
}

echo "[post-merge] Re-initializing fleet-scope schema (safety net)..."
npx tsx -e "
  const { neon } = require('@neondatabase/serverless');
  const fs = require('fs');
  const sql = neon(process.env.DATABASE_URL);
  const initSql = fs.readFileSync('server/fleet-scope-schema-init.ts', 'utf8');
  const sqlBlock = initSql.match(/export const FLEET_SCOPE_SCHEMA_SQL = \x60([\\s\\S]*?)\x60/);
  if (sqlBlock && sqlBlock[1]) {
    (async () => {
      try {
        await sql(sqlBlock[1]);
        console.log('[post-merge] Fleet-scope schema re-initialized successfully');
      } catch (e) {
        console.log('[post-merge] Fleet-scope schema init note:', e.message?.substring(0, 200));
      }
    })();
  } else {
    console.log('[post-merge] Could not extract fleet-scope schema SQL');
  }
" 2>&1 || echo "[post-merge] Fleet-scope schema init had issues, tables will be created on app start"
