#!/bin/bash
set -e
npm install
timeout 15 npx drizzle-kit push --force || echo "[post-merge] drizzle-kit push timed out or skipped — run manually if schema changes are needed"
