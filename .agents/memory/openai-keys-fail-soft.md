---
name: OpenAI keys degrade silently
description: Both OpenAI keys are fail-soft by design — quota exhaustion never errors visibly, features just quietly stop working.
---

Both OpenAI integrations (call-transcript summarization on FS_OPENAI_API_KEY, VRM comment-resolver on OPENAI_API_KEY) are deliberately fault-isolated: a missing/invalid/out-of-quota key logs a console warning and returns a placeholder or null — no thrown error, no UI signal.

**Why:** As of July 2026 an audit found BOTH keys were set and structurally valid (`/v1/models` 200) but out of quota (`429 insufficient_quota`). Prod fs_call_logs showed the quota died between 2026-06-26 (last real GPT summary) and 2026-06-30 (100% failure onset); ~300 calls got placeholder summaries with nobody alerted. Placeholder markers to query for: 'Summary unavailable — analysis failed.', 'Summarization failed', 'OpenAI key not configured' in shop_notes.

**How to apply:** When a user reports AI summaries/extractions "not working" or showing placeholder text, check key quota FIRST with a 1-token completion test (a `/v1/models` 200 does NOT prove funding). Don't hunt through app code for a bug — the fail-soft design hides billing problems.
