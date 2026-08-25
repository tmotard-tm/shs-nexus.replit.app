# Roster Effective-Date Reconciliation

## Problem

The all-tech roster can receive more than one event for the same employee ID
when a rehired employee receives a new enterprise ID. The current sync combines
active and terminated rows, then keeps the last row returned for each employee
ID. Query order can therefore replace a newer active identity with an older
terminated identity.

Production example:

- Employee ID `21024626642`
- Active event: `JBAILE2`, effective `2026-08-16`
- Terminated event: `JBAILE0`, effective `2025-12-27`

## Reconciliation Rule

Build one event stream keyed by trimmed employee ID:

- Active event date: `LAST_HIRE_DT`
- Terminated event date: `COALESCE(EFFDT, LAST_DATE_WORKED)`
- Ignore a future-dated termination until its effective date arrives.
- Select the event with the latest effective date.
- If two events have the same effective date, active wins.
- If all effective dates are missing, active wins as the safe current-roster
  fallback.

Enterprise ID is an attribute of the winning employee event. It is not the
identity used to reconcile active and terminated records.

## Data Flow

1. Read active and terminated HR roster events from Snowflake.
2. Exclude terminated events whose effective date is after Snowflake's current
   date.
3. Combine the events with a source/status priority.
4. Rank events by employee ID:
   - Effective date descending, nulls last
   - Active priority before terminated on an exact tie
5. Return only rank 1 to the existing contact, TPMS, and corrected DRIVELINE
   district joins.
6. Keep deterministic application-side deduplication as a defensive backstop
   for accidental one-to-many enrichment joins; it must use the same
   effective-date and active-tie rules rather than query order.
7. Upsert the winning record by employee ID. A reappearing/current employee
   clears `dropped_from_source_at` through the existing upsert behavior.

## Scope

This changes only `syncAllTechs()` roster reconciliation. It does not modify
termination history, offboarding history, assignment history, or the source
Snowflake views.

## Verification

- Unit regression: newer active event beats an older terminated event for the
  same employee ID.
- Unit regression: an already-effective newer termination beats an older
  active event.
- Unit regression: a future termination does not replace the current active
  event.
- Unit regression: active wins an exact effective-date tie.
- Run the real development all-tech sync.
- Confirm employee ID `21024626642` is stored as `JBAILE2`, status active, and
  appears in `/api/all-techs`.
- Confirm the active roster count remains within the existing sync/sweep safety
  thresholds.
