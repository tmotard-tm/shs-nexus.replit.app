---
name: Reconciliation auto-apply gate
description: Why the Reconciliation Admin "Automate" toggle must default OFF and fail safe to OFF, and the invariants around nightly auto-apply.
---

# Reconciliation auto-apply automation gate

The developer-only Reconciliation Admin page exposes an "Automate" toggle backed by
`app_settings` key `reconciliation.autoApply`. When ON, the deployed app auto-drains
(Apply → Verify) after each nightly materialize, removing the human gate.

**Rule:** the toggle must default OFF and read OFF whenever the stored value is
absent or not a strict boolean `true`. Auto-apply must only fire in the nightly,
non-startup, **non-halted** materialize success branch.

**Why:** "Apply" performs real, hard-to-reverse external writes to Holman / WMS / AMS.
A default-ON or fail-open toggle would let a fresh deploy, a missing `app_settings`
row, or a transient DB read silently start mutating external systems with no operator
in the loop. The whole point of the gate is that automation is opt-in per environment.

**How to apply:**
- `getBooleanSetting(key, false)` is the chokepoint — it returns the fallback unless
  the stored value is `typeof === "boolean"`. Do not "simplify" it to truthiness.
- `app_settings` self-heals via an idempotent `CREATE TABLE IF NOT EXISTS` in the
  background startup block (same pattern as the byov_* tables). Absence of the table
  must degrade to OFF (caught/logged), never crash the scheduler or flip behavior.
- Never wire auto-apply into the materialize halt path (G0/G1/G2 gates) or the
  startup path. Keep it isolated in its own try/catch so a failure never breaks the
  nightly scheduler.
- Keep all read/toggle endpoints and the page developer-gated (server 403 +
  client gate) — defense in depth, since the toggle ultimately drives real writes.
- The drain helper (`drainReconciliationRun`) loops the in-process executor kick
  with hard caps (iterations/processed/sleep) and stops on no-progress/throttle —
  do not replace it with an unbounded loop or HTTP self-calls.

## Manual "Create a run now" trigger

Runs are created ONLY by `materialize()`, which steady-state fires only in the
7:30 AM ET nightly (skipped on startup). So a freshly-deployed/empty environment
shows an empty runs table — the page/endpoints are fine, there is just nothing to
Apply yet. The developer-only `POST /api/admin/reconciliation/materialize` lets a
developer create a run on demand (button on the Reconciliation Admin page).

**Rule:** a manual trigger uses `kind: 'nightly'` (RunKind has no `manual`) and is
distinguished only by `requestedBy: 'manual:<username>'`. It must call the SAME
`materialize()` with the SAME gates — never expose G2-bypass / scope / liveConfirm
options to the request body.

**Why:** the goal is "run the identical full nightly scan now," and materialize is
read+propose only (real writes still gated behind per-run Apply/kick). Letting the
body override gates would turn a convenience trigger into a way to bypass the
circuit breakers.

**How to apply:**
- Safe to run concurrently with the nightly or a double-click: the button is
  disabled while pending, and item-level `activeIdempUq` + `activeTargetUq` with
  `onConflictDoNothing()` stop double-targeting the same {system,truck,field}.
  A concurrent loser may report `proposedWriteTotal` > actually-inserted — expected,
  not a bug. No advisory lock is taken (matches the nightly path); do not add one
  just for this.
- Keep it synchronous over HTTP like the existing kick/verify endpoints. Only
  caveat is UX: a very long materialize can outlive a proxy/client timeout while
  the server still finishes — tell users to Refresh the runs table before retrying
  (no external writes happen during materialize, so a retry is harmless).
