---
name: Roster rehire effective-date reconciliation
description: How to reconcile active, terminated, and future-dated roster events for reused employee identities
---

# Roster rehire effective-date reconciliation

**Rule:** Reconcile active and terminated roster rows by employee ID, not only
enterprise ID. The latest applicable effective date wins; active wins only an
exact-date or all-null tie. A future termination is not current yet, but its
employee ID must count as seen so the stale-roster sweep cannot hide the employee
before that date.

**Why:** A rehired technician can keep the same employee ID while receiving a
new enterprise ID. The old enterprise ID remains in the term roster, so
enterprise-ID-only suppression lets both rows through; a last-write-wins
employee-ID dedupe can then replace the active identity with the old terminated
identity. Separately, excluding a future termination from current results without
protecting its employee ID lets a brief active-feed omission trigger an early
`dropped_from_source_at`.

**How to apply:** Rank active `LAST_HIRE_DT` and terminated
`COALESCE(EFFDT, LAST_DATE_WORKED)` events per trimmed employee ID, excluding
future terms from current status. Use the same deterministic rule downstream,
and refresh current-roster seen metadata for future-term employee IDs before any
stale sweep.