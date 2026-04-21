#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# G5 — Break-glass rollback helper.
# Replit autoscale does NOT expose a programmatic "redeploy old hash" API, so
# this script does NOT roll back automatically. Instead it surfaces:
#   - the previous bundle hash
#   - the snapshot key to restore from
#   - the migration list at that point
# …so the operator can use the Deployments panel "Redeploy" with the right
# commit/checkpoint, then manually restore data from the snapshot if needed.
# ─────────────────────────────────────────────────────────────────────────────
set -u
HISTORY_PATH="deploys/history.json"
if [ ! -f "$HISTORY_PATH" ]; then
  echo "[G5] No deploy history at $HISTORY_PATH — nothing to roll back to."
  exit 1
fi
COUNT=$(jq 'length' "$HISTORY_PATH")
if [ "$COUNT" -lt 2 ]; then
  echo "[G5] Only $COUNT deploy(s) on file. Need at least 2 to roll back."
  exit 1
fi
echo "[G5] Most recent deploys (most recent last):"
jq -r '.[-5:][] | "  \(.deployedAt)  bundle=\(.bundleHash)  git=\(.gitSha)  snap=\(.snapshotKey // "none")"' "$HISTORY_PATH"
echo ""
PREV=$(jq -c '.[-2]' "$HISTORY_PATH")
echo "[G5] Roll back to:"
echo "$PREV" | jq .
echo ""
echo "Manual steps:"
echo "  1. Open Deployments panel → Redeploy from git SHA $(echo "$PREV" | jq -r .gitSha)"
echo "  2. If data restoration is required, fetch object-storage snapshot:"
echo "     $(echo "$PREV" | jq -r '.snapshotKey // "(none recorded)"')"
echo "  3. Confirm row counts via G4 after rollback redeploy completes."
