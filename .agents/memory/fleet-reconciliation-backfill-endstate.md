---
name: Fleet reconciliation backfill end-state
description: How to read the status mix after a full tier-3 reconciliation drain — which residual states are correct-by-design vs. real problems, and how the drain self-heals.
---

# Reading a full reconciliation backfill after it drains

After draining all `queued` actionable items, a healthy run is NOT "100% verified." Expect a mix, and do not treat non-`verified` as failure:

- **verified** — confirmed applied downstream (TPMS live re-check / WMS / Holman post-sync). The goal state.
- **verification_pending** — write submitted, awaiting confirmation. Holman is 202≠applied: it only verifies after a **fresh fleet sync** advances the cache past the submission time. WMS cost-center also needs propagation. This bucket **shrinks across successive verifier passes** as syncs land; the daily backstop scheduler owns finishing it. Normal, not stuck.
- **external_applied_cache_pending** — external write succeeded but the cache/fence tx didn't; the bulk verify/repair loop reads live downstream truth and confirms or flags after grace. Self-healing.
- **held** — `authority contested at W1` (e.g. `aims-owner-but-live-vacant`: AIMS claims an owner but live downstream is vacant). The guardrail **correctly refuses to guess** — needs human review, not a retry.
- **skipped** — legit no-ops: `Tech not registered in AMS` (can't assign a non-existent AMS tech); `expected cost center changed at W1 (X→Y)` (optimistic-concurrency/CAS refused to overwrite a value that drifted between materialize and execute).
- **awaiting_batch** — AMS items deferred to the overnight batch; a manual drain must NOT touch them.
- **flagged** — non-actionable proposals (and cross-run duplicates dropped by the `activeTargetUq` guard); no write attempted.

**Why:** the whole point of tier-3 is fail-safe correction. `held`/`skipped` are the safety system doing its job; `verification_pending` is async settlement, not error. Panicking and re-queuing them re-introduces the double-apply / overwrite-drift risks the guardrails exist to prevent.

# Drain mechanics that surprised me

- A small **`applying` residual** right after a run is expected if the process exits mid-final-kick. Rows self-heal once the **10-min lease (`LEASE_MS`) expires**: `reapStuckApplying` routes before-image rows → `external_applied_cache_pending` (write may have landed → verifier decides); `leaseBatch` re-leases no-before-image rows (write never happened → safe to re-run). `countActionable` does NOT count unexpired `applying`, so a drain loop can exit leaving them — they're picked up on the next kick after expiry. The daily scheduler does this automatically.
- **A finished console workflow can AUTO-RESTART** (re-run its command) on its own. Convenient here (it re-drained the now-expired stragglers), but don't assume a one-shot workflow runs exactly once.
- **How to apply:** to force-settle stragglers now instead of waiting for the scheduler, wait for all leases to expire (query `lease_until < now()`), then run one more executor kick + verifier sweep. Verify completion via the DB status breakdown (resilient across restarts), not the log marker.
