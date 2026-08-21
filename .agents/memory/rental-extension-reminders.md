---
name: Rental extension reminder sweep
description: Cycle-key semantics and arming caveats for the weekly rental-extension reminder texts.
---

# Rental extension reminder sweep

**Rule:** the reminder's idempotency cycle key is `days_authorized`, but in the
real rental-ops feed that value rarely moves after an extension is granted —
so in practice a case gets ONE text per authorization, not one per week.
Weekly re-nagging is a deliberate product decision (needs Tyler), not a bug.

**Why:** keying re-nags off wall-clock would text techs whose extension Fleet
already granted outside the system; one-per-cycle is the conservative default.

**How to apply:**
- Arming `extension_reminders_enabled` (durable setting, default OFF,
  fail-closed) fires the ENTIRE overdue backlog on the first live run — review
  the dry-run ledger first; most open cases are already past authorization.
- Dry runs / skips / failures must never consume the cycle slot (partial
  unique index over claimed/sent/queued only) — a dry run stamping the cycle
  arms the gate silently dead.
- Standalone sweep entrypoints (`run-*.ts`) bypass the web app's boot DDL
  chain: any sweep that queries another module's tables must run that module's
  own `init*Schema()` in its ensure path (see `ensureSweepSchema`), or a fresh
  database fails before evaluating a single case.
