#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# G1 — Merge Schema Gate
# Replaces  `yes "No" | drizzle-kit push --force`  in scripts/post-merge.sh.
# Runs `drizzle-kit generate` to a temp dir, classifies the diff, and:
#   - exits 0 if no diff
#   - exits 0 if diff is purely additive (ADD COLUMN, CREATE TABLE, CREATE INDEX,
#     DROP NOT NULL) — then runs `drizzle-kit push` WITHOUT --force
#   - exits 1 if diff contains DROP COLUMN, DROP TABLE, ALTER COLUMN TYPE, or
#     RENAME and the SQL line is NOT in .drizzle/allowed-destructive-ops.txt
# ─────────────────────────────────────────────────────────────────────────────
set -u

DRY_RUN="${G1_DRY_RUN:-0}"
ALLOW=".drizzle/allowed-destructive-ops.txt"
# Temp dir MUST be inside the workspace so drizzle-kit can resolve itself
# from node_modules (it can't from /tmp).
mkdir -p .drizzle/_g1
TEMP_OUT=$(mktemp -d -p .drizzle/_g1 2>/dev/null || mktemp -d .drizzle/_g1/run.XXXXXX)
TEMP_CFG="${TEMP_OUT}/drizzle.config.ts"

cleanup() { rm -rf "$TEMP_OUT" 2>/dev/null || true; }
trap cleanup EXIT

# Relocate `out:` to temp dir so we don't pollute migrations/.
sed "s|out: \"\\./migrations\"|out: \"./${TEMP_OUT}\"|" drizzle.config.ts > "$TEMP_CFG"

echo "[G1] Generating schema diff to ${TEMP_OUT}…"
if ! npx drizzle-kit generate --config "$TEMP_CFG" >/tmp/g1-gen.log 2>&1; then
  echo "[G1] drizzle-kit generate FAILED — see /tmp/g1-gen.log"
  tail -20 /tmp/g1-gen.log
  exit 1
fi

GENERATED=$(find "$TEMP_OUT" -name "*.sql" -type f 2>/dev/null | head -50)
if [ -z "$GENERATED" ]; then
  echo "[G1] No schema diff detected. Nothing to apply."
  exit 0
fi

echo "[G1] Diff produced:"
for f in $GENERATED; do echo "  - $(basename "$f")"; done

DESTRUCTIVE=$(grep -hiE "DROP COLUMN|DROP TABLE|ALTER COLUMN[^,]*TYPE|RENAME COLUMN|RENAME TO" $GENERATED 2>/dev/null | sed 's/^[[:space:]]*//;s/[[:space:]]*$//;s/;[[:space:]]*$//' || true)

if [ -n "$DESTRUCTIVE" ]; then
  echo "[G1] Destructive ops detected:"
  echo "$DESTRUCTIVE" | sed 's/^/    /'
  if [ ! -f "$ALLOW" ]; then
    echo "[G1] BLOCKED — no allow-list file at $ALLOW"
    exit 1
  fi
  BLOCKED=0
  while IFS= read -r op; do
    [ -z "$op" ] && continue
    if ! grep -Fq -- "$op" "$ALLOW" 2>/dev/null; then
      echo "[G1] BLOCKED — not in allow-list: $op"
      BLOCKED=1
    fi
  done <<< "$DESTRUCTIVE"
  if [ "$BLOCKED" = "1" ]; then
    echo "[G1] Add the exact lines above to $ALLOW (human PR required) to permit."
    exit 1
  fi
  echo "[G1] All destructive ops are allow-listed — proceeding."
fi

if [ "$DRY_RUN" = "1" ]; then
  echo "[G1] DRY-RUN — would apply via 'drizzle-kit push' (NO --force)."
  exit 0
fi

echo "[G1] Applying via drizzle-kit push (no --force, no auto-yes)…"
yes "No" | timeout 55 npx drizzle-kit push 2>&1 || {
  echo "[G1] push exited non-zero — investigate. (Common cause: declined an interactive 'rename?' prompt because we never auto-accept.)"
  exit 1
}
echo "[G1] Schema sync complete."
