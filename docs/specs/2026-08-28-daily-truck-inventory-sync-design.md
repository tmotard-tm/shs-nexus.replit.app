# Daily Truck Inventory Sync Design

## Goal

Refresh the production truck-inventory mirror once per day at 7:00 AM Eastern without adding inventory work to Fleet Agents.

The existing Nexus autoscale process will own the schedule. If no instance is running at 7:00 AM, the next application startup after 7:00 AM Eastern will perform the missed daily refresh.

## Current problem

- The inventory dialog reads the local PostgreSQL `truck_inventory` mirror rather than Snowflake live.
- Production has not refreshed that mirror since December 30, 2025.
- Startup refresh currently runs only when the table is completely empty, so any stale nonempty mirror is treated as current.
- The existing import inserts rows without replacing prior snapshots. Repeating it daily would cause the inventory endpoint to combine multiple extract dates and overstate quantities and cost.

## Scheduling behavior

- Use `America/New_York` calendar time so the 7:00 AM window follows EST and EDT automatically.
- The existing in-process scheduler checks whether the daily inventory refresh is due.
- A refresh is due when:
  1. The current Eastern hour is 7 or later.
  2. There is no successfully completed `truck_inventory` sync for the current Eastern calendar day.
- Run the same due check shortly after application startup. This is the startup catch-up path for an autoscale instance that was asleep at 7:00 AM.
- A completed daily run suppresses all further automatic attempts that Eastern day.
- A failed run remains eligible for a later retry that day.

This is intentionally best-effort under autoscale: the refresh runs at 7:00 AM when an instance is alive, otherwise when the application next wakes after 7:00 AM.

## Concurrency and ownership

- A database-backed cross-process lock protects the refresh so overlapping autoscale instances cannot run it twice.
- The lock covers the Snowflake read and PostgreSQL replacement.
- A caller that cannot acquire the lock exits as a non-error skip; it does not start another import.
- Manual and automatic refreshes use the same locked implementation.

## Snowflake read

Use the existing Snowflake inventory query and its current business filters:

- Only the global maximum `PISR_SKU_DETAIL.EXTRACT_DATE`.
- Exclude bins `SHCRE`, `CRE`, and `SGCRE`.
- Exclude rows where truck equals district.
- Preserve the category joins and current cost calculations.

Before changing PostgreSQL, validate that Snowflake returned a nonempty result containing one extract date. An empty or internally inconsistent result fails closed and preserves the previous mirror.

## Atomic mirror replacement

Treat truck inventory as a current snapshot, not an append-only history.

1. Fetch and map the complete latest Snowflake result before replacing PostgreSQL data.
2. Open one PostgreSQL transaction.
3. Delete the prior `truck_inventory` mirror.
4. Insert the complete new snapshot in bounded batches within that same transaction.
5. Commit only after every batch succeeds.

PostgreSQL readers continue seeing the old committed snapshot while replacement is in progress. If any insert fails, the transaction rolls back and the old snapshot remains available.

The inventory summary endpoint therefore continues reading one complete current snapshot and cannot add quantities from different dates together.

## Run records and errors

- Every attempted refresh writes a `sync_logs` record with `sync_type = 'truck_inventory'`.
- Automatic runs identify the trigger as `scheduler` or `startup_catchup`; manual runs remain identifiable as manual.
- Successful logs include the number of inserted rows and completion time.
- Failure logs include the root error and do not advance the daily success watermark.
- Skips caused by an already-held lock are visible in logs but do not count as successful refreshes.

## Verification

Automated tests will cover:

- Eastern-time due logic before 7:00 AM, at 7:00 AM, after 7:00 AM, and across EDT/EST dates.
- A successful run suppressing another automatic run on the same Eastern day.
- A failure remaining retryable that day.
- Startup catch-up selecting a stale nonempty mirror.
- Concurrent callers allowing only one refresh.
- Atomic replacement preserving the old snapshot when an insert fails.
- A successful replacement exposing only the latest extract date.
- Truck `088129` totals being calculated from one snapshot rather than accumulated dates.

After implementation, run the focused tests, production build, and restart the application workflow. Production will begin using the behavior only after the next publish.