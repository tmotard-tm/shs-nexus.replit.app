#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// G4 CLI shim — re-exports & invokes the canonical module under
// server/guardrails/. Kept here so `npm run deploy:integrity` continues to
// resolve the same path operators have been documented to use, and so
// guardrails-as-a-suite can be discovered under scripts/guardrails/.
// ─────────────────────────────────────────────────────────────────────────────
import { runIntegrityCheck } from "../../server/guardrails/g4-post-deploy-integrity";

runIntegrityCheck().catch((e) => {
  console.warn("[G4] Integrity check errored (continuing, never blocks):", (e as Error).message);
  process.exit(0);
});
