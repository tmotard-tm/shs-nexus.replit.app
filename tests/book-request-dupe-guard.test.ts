/**
 * Task 854 retirement fence for the former desktop rental-request booker.
 *
 * Rental requests are now booked only by the Nexus Approve canonical
 * in-server executor. Keep the script path as a safe compatibility shim, but
 * never allow it to regain ETD/Nexus booking imports or an executable path.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";

const RUNNER_DIR = path.join(process.cwd(), "etd-runner");
const SCRIPT = "scripts/book_request.py";

function source(): string {
  return execFileSync("cat", [SCRIPT], {
    cwd: RUNNER_DIR,
    encoding: "utf8",
  });
}

test("book_request compatibility path is a retired, non-booking shim", () => {
  const text = source();
  assert.match(text, /Nexus Approve canonical in-server executor/i);
  assert.match(text, /RETIRED_MESSAGE/);
  assert.doesNotMatch(text, /\bfrom\s+etd\s+import\b/);
  assert.doesNotMatch(text, /\bimport\s+book_cutover\b/);
  assert.doesNotMatch(text, /\burlopen\s*\(/);
  assert.doesNotMatch(text, /\bEtdClient\b/);
});

test("book_request refuses execution clearly and without booking", () => {
  const result = spawnSync("python3", [SCRIPT, "--confirm"], {
    cwd: RUNNER_DIR,
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /retired/i);
  assert.match(result.stderr, /Nexus Approve canonical in-server executor/i);
  assert.match(result.stderr, /Token tooling.*cutover tooling remain available/i);
});