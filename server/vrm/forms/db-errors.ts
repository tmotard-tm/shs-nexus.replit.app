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

/**
 * Is this ANY Postgres unique violation (23505), regardless of which index?
 *
 * Same cause-chain discipline as isUniqueViolationOn: a drizzle-wrapped error
 * has NO .code and a "Failed query: <sql>" message, so checking e.code /
 * e.message directly on the thrown error matches nothing. A raw pg error
 * still matches at depth 0, so this is safe for both drivers.
 */
export function isUniqueViolation(e: any): boolean {
  for (let err = e, depth = 0; err && depth < 5; err = err.cause, depth++) {
    if (String(err?.code || "") === "23505") return true;
    if (/duplicate key value violates unique constraint/i.test(String(err?.message || ""))) return true;
  }
  return false;
}

/**
 * A concise, human-safe summary of a (possibly drizzle-wrapped) DB error.
 *
 * Drizzle's wrapper message is "Failed query: <the entire SQL>" — surfacing
 * that to a client dumps kilobytes of SQL into an error banner (seen live on
 * the Cutover Tracking page, 2026-08-25) while saying nothing about the actual
 * cause, which lives on e.cause. Walk the chain, prefer the DEEPEST non-empty
 * message (the raw pg error), and never return the SQL dump:
 *   · a Neon websocket drop has an EMPTY root message — that maps to the
 *     generic "connection dropped" line, not the wrapper text;
 *   · a pg error code, when present anywhere in the chain, is appended so
 *     logs stay grep-able by class (57014 timeout, 23505 dup, ...).
 */
export function rootDbErrorMessage(e: any, maxLen = 300): string {
  let best = "";
  let code = "";
  for (let err = e, depth = 0; err && depth < 5; err = err.cause, depth++) {
    const msg = String(err?.message ?? "").trim();
    if (msg) best = msg;
    if (err?.code) code = String(err.code);
  }
  if (!best || /^Failed query/i.test(best)) {
    best = "database query failed (connection dropped or no underlying cause reported)";
  }
  const firstLine = best.split("\n")[0].trim();
  const clipped = firstLine.length > maxLen ? `${firstLine.slice(0, maxLen)}…` : firstLine;
  return code ? `${clipped} [${code}]` : clipped;
}
