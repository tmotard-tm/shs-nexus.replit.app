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
