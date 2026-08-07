---
name: Comms send-status contract & trade-gate policy
description: send statuses (refusals persist nothing; branch on all) + standing policy of no trade-based send blocking
---
**Standing policy (fleet director):** every rostered tech attached to fleet communications is messageable regardless of position/trade. An HVAC "gate" once made a one-time, campaign-scoped exclusion (the right-size blast leak) permanent in the shared send path; the director had it removed. Trade carve-outs live ONLY in right-size compliance reporting. A future campaign needing audience exclusions must filter its recipient LIST, never the transport.

**Send-status contract:** the single-send path returns `{status, reason?}` with HTTP 200 for sent / queued / skipped ("blocked" survives in the type union for compatibility but is never returned). Refusals persist NO message or queue rows — the DB shows nothing, by design.

**How to apply:** every send surface (UI mutation, API caller, agent) treats only sent/queued as success, surfaces `reason` destructively on anything else, and never clears the draft or closes the dialog on a refusal. Diagnostic: "operator says sent, thread empty, zero fs_comms rows" = a mis-rendered refusal status, not Twilio.
