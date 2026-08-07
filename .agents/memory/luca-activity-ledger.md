---
name: LUCA activity ledger semantics
description: Why vrm_luca_activity_log is quiet in steady state; first-sighting noise policy
---
- The ledger records state CHANGES, not every poll: duplicate call-outcome deliveries and unknown-truck skips write a row only on FIRST sighting (gated on the prior recorded outcome); steady-state echoes fold into the writeback run-heartbeat counters instead. An almost-empty ledger next to healthy heartbeats = WORKING instrumentation, not missing instrumentation.
- No backfill: outcomes already marked in the writeback dedup table before the ledger existed never produce first-sighting rows.
- Health semantics on the viewer page: lastRun = writeback heartbeat (its detail carries duplicates/unknownTruck/applied counts), plus lastDispatchAt / lastInboundAt; config chips are presence booleans only, never secret values.

**How to apply:** when judging LUCA sync health, read the heartbeat counts — do not expect one ledger row per outcome, and do not "fix" the quiet ledger.
