---
name: Right Size Tracker rate policy (8/3 reversal)
description: Rate is never compliance; rate-only replies flag for follow-up, not DONE; KPI semantics changed at cutover
---
Tyler's 2026-08-03 ruling REVERSED his 7/30 one: an authorized rate at/below the sedan ceiling is NOT right-sized — the vehicle itself must change. Compliant = sedan nameplate on the rental report, OR tech-confirmed swap via SMS (DONE/RETURNED remain propose-only, the truth boundary).

**Why:** the initiative is about getting people into smaller vehicles; a matched/discounted rate leaves the tech in the same oversized unit. Treating rate as compliance silently retired rentals from the chase list (~30 flipped back at cutover, ~$1.5k/mo over-sedan spend).

**How to apply:**
- Rate-talk replies (regex rate rule or LLM `RATE_ONLY`) must propose `NEW_REPLY`/review, never DONE. Swap language outranks rate talk ("swapped it out, rate is the same" = DONE).
- Compliance math = model OR sms only. KPI continuity: `byRateOnly` pinned 0 but key+snapshot column survive; `"both"` = model+SMS since 8/3 (was rate+model) — the trend has a real discontinuity at cutover, don't read it as regression.
- Classification context: rental-report Make/Model rides into the LLM prompt but may lag a completed swap by days — it must never contradict the tech's own words.
- Proof-of-life: any inbound from a NON_RESPONDER that yields no verdict proposes NEW_REPLY/review, guarded (`proposed_stage IS NULL OR = 'NEW_REPLY'`) so it never downgrades a stronger pending proposal — review-queue writes over shared slots need that guard pattern generally.
- Historical residue: techs confirmed DONE off rate talk before 8/3 still count compliant through the SMS test until audited.
