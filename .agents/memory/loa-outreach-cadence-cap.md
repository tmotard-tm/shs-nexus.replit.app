---
name: LOA outreach 2-day cadence cap
description: Business rule + guard columns for the LOA/Paid Leave SMS outreach cadence
---
Business rule (per Luca, Aug 2026): keep texting BOTH phone numbers per tech, but text on at most **2 distinct ET days** per cycle; a reply OR form submission OR the 2-day cap stops daily sends permanently. Staff re-enable is the only escape hatch — it resets `fs_loa_outreach.send_day_count` to 0.

**Why:** techs with two phones were getting 4 texts/day indefinitely (daily 10 AM + 6h resend, forever until form submission).

**How to apply:**
- Exclusion helpers in the outreach engine: form, reply (`reenabledAt >= repliedAt` overrides), and `send_day_count >= LOA_MAX_SEND_DAYS`.
- The counter increments only when `last_cycle_date IS DISTINCT FROM today` (same-day force runs don't consume a cap day). Day-2's 6h resend still fires by design.
- The schema-init backfill for `send_day_count` is guarded by a column-existence `DO $$` block — it must run ONLY when the column is first added, or restarts would re-cap staff-re-enabled techs (counter reset to 0 but `last_cycle_date` stays set).
