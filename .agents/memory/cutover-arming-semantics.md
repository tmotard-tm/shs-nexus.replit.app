---
name: Cutover arming semantics
description: What VRM_CONTRACT_BLOCK_ENABLED=true changes for the cutover/rental-request intent pipeline, and what go-live still depends on operators.
---

# Cutover arming semantics (go-live, Aug 2026)

**Rule:** `VRM_CONTRACT_BLOCK_ENABLED` armed ⇒ (1) `createIntent` defaults to `live` (explicit `executionMode` still wins — see `defaultExecutionMode()`), and (2) the dark-phase admin/developer-session requirement for live intent create/mutations stands down — the flag, not the role, is the authority. Runner-owned routes (claim/preview/booking-postback/schedule-check) remain cron-bearer-gated regardless; that is the anti-forgery boundary and must never ride the flag.

**Why:** Owner validated the workflow and directed "no dry runs on publish." Architect review confirmed `createIntent` has no server-side/cron callers — only the two session-gated staff routes — so armed live-default cannot create unattended external effects.

**How to apply:**
- Dev must NEVER be armed — enforced by a db test ("must never be armed in dev"). Arm via **production deployment env var only**; takes effect on republish. Unsetting + republish is the stand-down lever.
- Armed-mode regression tests live in the routes-auth + orchestrator-unit suites (they arm the flag in-process with save/restore); don't "fix" them by asserting dry_run defaults unconditionally.
- Armed ≠ autonomous. External bookings still require the operator-run pull-based runner with `--confirm` (prod autoscale has no browser); msg1/msg2 release + ART retries require the morning sweep to be scheduled (platform Scheduled Deployment or cron header — in-process timers don't fire on autoscale); msg2 in FL/CT/MD/OK/WA/TX is refused until the quiet-state fallback policy is persisted; new-request Fleet alerts silently no-op while `RENTAL_REQUEST_ALERT_PHONES` is unset.
