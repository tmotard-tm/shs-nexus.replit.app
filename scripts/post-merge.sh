#!/bin/bash
set -e
npm install
echo "No" | npm run db:push -- --force
