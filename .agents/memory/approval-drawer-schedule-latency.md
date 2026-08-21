---
name: Schedule facts in UI lanes are advisory and slow
description: Snowflake-backed schedule lookups can take ~a minute cold; UI defaults must be safe without them
---

# Schedule facts consumed by interactive UI

Snowflake-backed schedule reads (built for cron/runner lanes) can take on the
order of a minute on a cold boot when called from a session-lane route; warm
calls are sub-second.

**Why:** heavy reads serialize behind the shared sync lock and cold pools; a
runner never notices, a human staring at a drawer does — and any flow where
clicking through before the answer arrives bypasses the policy the lookup
feeds is a defect, not a corner case.

**How to apply:** treat schedule facts as advisory refinements, never
prerequisites. The UI must open ALREADY holding the safe policy default
(computed client-side from pure shared code), reconcile when the answer lands,
and never block or blank a human action while waiting. Make the
race-with-the-answer state pure and unit-test "user acts before the lookup
returns" explicitly.
