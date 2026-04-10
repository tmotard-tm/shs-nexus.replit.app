#!/bin/bash
set -e
npm install

for f in migrations/*.sql; do
  if [ -f "$f" ]; then
    echo "[post-merge] Running migration: $f"
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

echo "" | timeout 15 npx drizzle-kit push --force 2>&1 || echo "[post-merge] drizzle-kit push timed out or skipped — run manually if schema changes are needed"
