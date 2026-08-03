---
name: Bedrock token staleness in prod
description: Prod 403 "Authentication failed" from Bedrock while dev works = stale deployment secret snapshot; republish is the fix.
---

# Bedrock prod 403 vs working dev

The Rightsize classifier and FleetScope summarizer both auth to AWS Bedrock with the shared `AWS_BEARER_TOKEN_BEDROCK` secret (plain `Authorization: Bearer` over Converse, no SDK).

**Rule:** If prod logs show `bedrock ... failed: 403 Authentication failed` while a dev-side `invokeBedrock` smoke test succeeds, the workspace secret is fine — the production deployment is running a **stale snapshot** of the secret taken at its last publish. Replit deployments do NOT pick up secret changes automatically; the user must republish (Publish button) to push the rotated token to prod.

**Why:** Observed 2026-08-03: token rotated ~7/31; every prod Bedrock call 403'd from 7/31 onward while dev worked. `vrm_rightsize_events.verdict_source` showed last `bedrock` row at the rotation boundary — that column is the fastest ground truth for "is the LLM path alive in prod" (failures degrade silently to `regex` rows with reason "...bedrock returned no confident verdict").

**How to apply:**
- Verify dev token: `npx tsx -e` one-liner calling `invokeBedrock` from `server/vrm/rightsize/llm.ts`.
- Verify prod health: prod read-only query `SELECT verdict_source, max(created_at) FROM vrm_rightsize_events GROUP BY 1`.
- Fix: republish. There is no per-environment override to edit; secret lives in the shared secret store, snapshot refreshes only on publish.
- Note: rightsize Bedrock failures never surface as errors to users — regex fallback carries everything silently.
