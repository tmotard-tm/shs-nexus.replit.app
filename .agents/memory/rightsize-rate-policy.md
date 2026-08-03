---
name: Right Size Tracker rate policy
description: Rate and vehicle are two independent compliance paths; rate-secured replies propose DONE; misread-reversal lesson
---
Right-sized = rate OR vehicle OR SMS (Tyler, clarified 2026-08-03 after a one-day misread):
- **Rate path:** tech secured the sedan rate (≤ ceiling) even while keeping the larger rental — compliant; the company pays sedan money.
- **Vehicle path:** sedan nameplate on the report at a higher rate — compliant by vehicle (`Rate Authorized` is the reservation basis, not invoiced).
- **SMS path:** tech confirmed the swap; DONE/RETURNED remain propose-only (truth boundary), RETURNED never credits.

**Why:** an 8/3 note ("rate is not a valid factor alone") was briefly implemented as rate-never-counts; Tyler corrected the same day: "some techs were able to secure the Sedan rate while keeping their larger rental" — those ARE right-sized. ~30 rentals flip on this rule, so exactness matters.

**How to apply:** rate-talk replies (regex rule or LLM `RATE_ONLY` label) propose DONE for review with a rate-specific reason so the reviewer verifies the rate on the report; swap language outranks rate talk; `"both"` = rate+model. Kept from the 8/3 directive: rental-report Make/Model rides into the LLM prompt (may lag a swap, never overrides the tech's words), and NON_RESPONDER proof-of-life (unclassifiable inbound → NEW_REPLY/review, guarded so it never downgrades a stronger pending proposal). LESSON: when a directive appears to reverse a documented, dated ruling in code, restate the rule back to the user before rewiring compliance math.
