/**
 * Boot must only diagnose the token uniqueness guard. Repair and concurrent
 * index creation are an explicit migration because either operation can block
 * or mutate data during a restart wave.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const orchestrator = readFileSync(
  path.join(root, "server/vrm/forms/cutover-orchestrator.ts"),
  "utf8",
);
const migration = readFileSync(
  path.join(root, "migrations/20260828_cutover_attempt_token_unique.sql"),
  "utf8",
);
const postMerge = readFileSync(path.join(root, "scripts/post-merge.sh"), "utf8");

test("token uniqueness startup check is bounded and read-only", () => {
  const match = orchestrator.match(
    /export async function ensureTokenBackedRequestUniquenessForStartup[\s\S]*?\n}\n\n/,
  );
  assert.ok(match, "startup health check must remain separately inspectable");
  assert.doesNotMatch(match[0], /\bDELETE\b/i);
  assert.doesNotMatch(match[0], /\bCREATE\s+UNIQUE\s+INDEX\b/i);
  assert.match(match[0], /pg_index/i);
  assert.match(match[0], /missing or invalid/i);
});

test("token uniqueness migration diagnoses before concurrent index creation", () => {
  assert.match(migration, /HAVING count\(\*\) > 1/i);
  assert.match(migration, /RAISE EXCEPTION/i);
  assert.match(migration, /indisvalid/i);
  assert.match(migration, /DROP INDEX CONCURRENTLY/i);
  assert.match(migration, /CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS/i);
  assert.ok(
    migration.indexOf("DROP INDEX CONCURRENTLY") < migration.indexOf("CREATE UNIQUE INDEX CONCURRENTLY"),
    "an invalid remnant from a failed concurrent build must be removed before retry",
  );
});

test("the real post-merge runner executes concurrent migrations intact and fail-closed", () => {
  assert.match(migration, /replit-migration-mode:\s*psql-on-error-stop/i);
  const branch = postMerge.match(
    /if grep -q '\^-- replit-migration-mode: psql-on-error-stop\$'[\s\S]*?\n    fi/,
  );
  assert.ok(branch, "post-merge must have a dedicated parser-safe migration branch");
  assert.match(branch[0], /psql[\s\S]*ON_ERROR_STOP[\s\S]*--file/i);
  assert.doesNotMatch(
    branch[0],
    /(?:continuing|non-fatal)/i,
    "the opted-in psql path must propagate a duplicate/index failure",
  );
});