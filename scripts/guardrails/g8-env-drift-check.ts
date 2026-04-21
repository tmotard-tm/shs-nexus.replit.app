// ─────────────────────────────────────────────────────────────────────────────
// G8 — Environment Drift Check
// When NODE_ENV=production, asserts that DATABASE_URL.host exactly matches
// the expected production host. Refuses to start the server on mismatch.
// Closes the "prod accidentally points at dev DB" failure mode.
// ─────────────────────────────────────────────────────────────────────────────

const EXPECTED_PROD_HOST = "ep-lively-heart-adrhzx3e.c-2.us-east-1.aws.neon.tech";

export function assertProdDatabaseHost(): void {
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv !== "production") {
    console.log(`[G8] skipped (NODE_ENV=${nodeEnv ?? "<unset>"}).`);
    return;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[G8] FATAL — NODE_ENV=production but DATABASE_URL is unset. Refusing to start.");
    process.exit(1);
  }
  let actualHost: string;
  try {
    actualHost = new URL(url).host;
  } catch {
    console.error("[G8] FATAL — DATABASE_URL is not a valid URL. Refusing to start.");
    process.exit(1);
  }
  if (actualHost !== EXPECTED_PROD_HOST) {
    console.error(
      `[G8] FATAL — prod DATABASE_URL host mismatch. Expected ${EXPECTED_PROD_HOST}, got ${actualHost}. Refusing to start.`,
    );
    process.exit(1);
  }
  console.log("[G8] OK — prod DB host verified.");
}

// Auto-fire on module load so the assertion runs before any subsequent
// DB-touching import in server/index.ts can resolve. ES modules hoist all
// imports, so a side-effect import is the only way to gate execution
// before `./storage` (and its DB pool) initializes.
assertProdDatabaseHost();
