#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# G3 — Migration Safety Gate
# Scans migrations/*.sql for any UNAPPLIED file containing destructive DDL.
# Block-list: DROP COLUMN, DROP TABLE, ALTER COLUMN ... TYPE, RENAME COLUMN, RENAME TO.
# Allow-list: ADD COLUMN, CREATE TABLE, DROP NOT NULL, CREATE INDEX, ADD CONSTRAINT.
#
# "Unapplied" = file's hash not in drizzle.__drizzle_migrations.
# In dry-run mode (G3_DRY_RUN=1), reports classification for ALL files without
# touching the DB (since we may not have prod creds).
# ─────────────────────────────────────────────────────────────────────────────
set -u

DRY_RUN="${G3_DRY_RUN:-0}"
DESTRUCTIVE_RE="DROP COLUMN|DROP TABLE|ALTER COLUMN[^,]*TYPE|RENAME COLUMN|RENAME TO"

if [ ! -d migrations ]; then
  echo "[G3] No migrations/ directory — nothing to gate."
  exit 0
fi

FAIL=0
APPLIED_FILES=""

if [ "$DRY_RUN" = "0" ] && [ -n "${DATABASE_URL:-}" ]; then
  APPLIED_FILES=$(npx tsx -e "
    import('@neondatabase/serverless').then(async ({ neon }) => {
      const sql = neon(process.env.DATABASE_URL);
      try {
        const r = await sql\`SELECT hash FROM drizzle.__drizzle_migrations\`;
        process.stdout.write(r.map(x => x.hash).join('\\n'));
      } catch (e) { process.stderr.write('[G3] Could not query __drizzle_migrations: ' + e.message); }
    });
  " 2>/dev/null)
fi

for f in migrations/*.sql; do
  [ -f "$f" ] || continue
  base=$(basename "$f")
  if [ -n "$APPLIED_FILES" ] && echo "$APPLIED_FILES" | grep -Fq "$base"; then
    continue  # already applied
  fi
  HITS=$(grep -hiE "$DESTRUCTIVE_RE" "$f" 2>/dev/null || true)
  if [ -n "$HITS" ]; then
    echo "[G3] BLOCKED — destructive DDL in unapplied $base:"
    echo "$HITS" | sed 's/^/    /'
    FAIL=1
  else
    echo "[G3] OK — $base (additive only)"
  fi
done

if [ "$FAIL" = "1" ]; then
  echo "[G3] Deploy aborted. Either:"
  echo "      (1) revise the destructive migration to be additive, or"
  echo "      (2) run it manually with explicit operator approval, or"
  echo "      (3) add the SQL to .drizzle/allowed-destructive-ops.txt (G1 path)."
  exit 1
fi
echo "[G3] All unapplied migrations are safe."
exit 0
