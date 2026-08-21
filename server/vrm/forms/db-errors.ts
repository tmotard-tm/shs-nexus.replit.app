/**
 * Shared DB-error classification for the VRM forms lane.
 *
 * Did this error come from one of the named unique indexes?
 *
 * Drizzle wraps the pg error: the thrown error's message is
 * "Failed query: <sql>" and the constraint name lives on e.cause
 * (message + .constraint). Checking only e.message — which the race
 * handlers originally did — matches NOTHING, so a genuine duplicate-key
 * race fell through to the generic 500. Proven on the box 2026-08-21 by
 * tests/rental-extension-token-door.test.ts. Walk the cause chain.
 */
export function isUniqueViolationOn(e: any, ...indexNames: string[]): boolean {
  for (let err = e, depth = 0; err && depth < 5; err = err.cause, depth++) {
    const msg = String(err?.message || "");
    const constraint = String(err?.constraint || "");
    if (indexNames.some((n) => constraint === n || msg.includes(n))) return true;
  }
  return false;
}
