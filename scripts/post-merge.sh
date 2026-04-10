#!/bin/bash
set -e
npm install
echo "" | timeout 15 npx drizzle-kit push --force 2>&1 || echo "[post-merge] drizzle-kit push timed out or skipped — run manually if schema changes are needed"
