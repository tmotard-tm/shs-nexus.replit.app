# Roster Effective-Date Reconciliation Implementation Plan

> **For agents:** Use the `executing-plans` skill to work through this task by task. Steps use `- [ ]` checkboxes for tracking.

**Goal:** Make the all-tech roster select the latest applicable employee event by employee ID so a newer rehire identity cannot be overwritten by an older termination.

**Architecture:** Rank active and terminated HR events in Snowflake before contact, TPMS, and DRIVELINE enrichment. Keep a pure TypeScript reconciliation helper as an order-independent defensive backstop for accidental one-to-many enrichment rows.

**Tech Stack:** TypeScript, Node's built-in test runner through `tsx`, Snowflake SQL, PostgreSQL/Drizzle storage.

**Verification:** `npx tsx --test tests/roster-effective-date-reconciliation.test.ts tests/roster-district-resolution.test.ts` must report zero failures. `npm run check` may retain the documented 224 pre-existing errors, but must add no errors in changed files.

## Global Constraints

- Reconcile on trimmed employee ID; enterprise ID is an attribute of the winning event.
- Active effective date is `LAST_HIRE_DT`.
- Terminated effective date is `COALESCE(EFFDT, LAST_DATE_WORKED)`.
- Ignore a future-dated termination until its effective date.
- Latest applicable effective date wins; active wins an exact-date or all-null tie.
- TPMS remains the preferred district source and corrected DRIVELINE remains the employee-ID fallback.
- Do not rewrite termination, offboarding, assignment, or operation history.
- Preserve the existing stale-roster sweep and its `max(150, 5%)` safety guard.

---

### Task 1: Order-independent application reconciliation

**Files:**
- Create: `server/roster-effective-date-reconciliation.ts`
- Create: `tests/roster-effective-date-reconciliation.test.ts`

**Interfaces:**
- Consumes rows containing `EMPL_ID`, `ENTERPRISE_ID`, `EMPLOYMENT_STATUS`, and `EFFDT`.
- Produces `reconcileRosterRows<T extends RosterEventRow>(rows: readonly T[], asOfDate?: Date): T[]`.

- [x] **Step 1: Write failing regression tests**

Cover these cases with fixed dates:

```typescript
test("newer active rehire beats an older termination for the same employee", () => {});
test("already-effective newer termination beats an older active event", () => {});
test("future termination does not replace the current active event", () => {});
test("active wins an exact effective-date tie", () => {});
test("active wins when all effective dates are missing", () => {});
test("the same rows produce the same winner regardless of input order", () => {});
```

- [x] **Step 2: Run the test and confirm RED**

Run: `npx tsx --test tests/roster-effective-date-reconciliation.test.ts`

Expected: FAIL because `server/roster-effective-date-reconciliation.ts` does not exist.

- [x] **Step 3: Implement the minimal pure helper**

Normalize the employee key with `String(row.EMPL_ID ?? "").trim()`. Compare ISO date portions without local-time conversion. Exclude only terminated rows with a known effective date later than the supplied as-of date. Rank by effective date descending, active before terminated on ties, then a stable row fingerprint so input order cannot decide the result.

- [x] **Step 4: Run the test and confirm GREEN**

Run: `npx tsx --test tests/roster-effective-date-reconciliation.test.ts`

Expected: six passing tests and zero failures.

### Task 2: Rank HR events in Snowflake before enrichment

**Files:**
- Modify: `server/snowflake-sync-service.ts`

**Interfaces:**
- Consumes `reconcileRosterRows` from Task 1.
- Produces one ranked roster event per trimmed employee ID before contact, TPMS, and DRIVELINE joins.

- [x] **Step 1: Replace enterprise-ID suppression with employee-ID event ranking**

Build `roster_events` from the active and termination views. Filter known future term dates with `TERM_DT <= CURRENT_DATE()`, then calculate:

```sql
ROW_NUMBER() OVER (
  PARTITION BY TRIM(EMPLID)
  ORDER BY EFF_DT DESC NULLS LAST, SOURCE_PRIORITY DESC, EID DESC
) AS rn
```

Use active `SOURCE_PRIORITY = 1`, terminated `SOURCE_PRIORITY = 0`, and keep only `rn = 1`. Remove the obsolete hire-view suppression CTE.

- [x] **Step 2: Replace query-order dedupe with the pure helper**

Change the current `Map.set(... keep last occurrence)` loop to:

```typescript
const rows = reconcileRosterRows(rawRows);
```

- [x] **Step 3: Run focused regression tests**

Run: `npx tsx --test tests/roster-effective-date-reconciliation.test.ts tests/roster-district-resolution.test.ts`

Expected: all tests pass with zero failures.

- [x] **Step 4: Run typecheck and compare the baseline**

Run: `npm run check > /tmp/roster-effective-date-tsc.log 2>&1; echo $?`

Expected: the repository may exit nonzero at its documented 224-error baseline, but `rg "roster-effective-date-reconciliation|snowflake-sync-service" /tmp/roster-effective-date-tsc.log` must show no new errors caused by this change.

### Task 3: Development sync and assignment-surface verification

**Files:**
- No permanent file changes expected.

**Interfaces:**
- Consumes the updated `syncAllTechs()` implementation.
- Produces fresh development `all_techs` rows and observable API evidence.

- [x] **Step 1: Restart the application workflow**

Restart `Start application`, then refresh logs and confirm the application is listening without a new startup error.

- [x] **Step 2: Run only the development all-tech sync**

Initialize the Snowflake singleton using the same bootstrap as `server/run-sync.ts`, call `getSnowflakeSyncService().syncAllTechs("manual_verification")`, and fail the command if `success` is false or `errors` is non-empty. Do not run the broader daily sync.

- [x] **Step 3: Verify the corrected employee row in development**

Query development `all_techs` by employee ID `21024626642`. Expected winner:

```text
tech_racfid = JBAILE2
employment_status != T
dropped_from_source_at = null
```

- [x] **Step 4: Verify roster count and sweep safety**

Read the completed `all_techs` sync log and compare active roster count to the immediately previous clean run. Confirm there was no stale-sweep guard error and no unexpected mass-drop.

- [x] **Step 5: Verify the assignment API**

With the development app running and an authenticated temporary test session, request `/api/all-techs`, confirm employee ID `21024626642` is returned as `JBAILE2`, then delete the temporary session.

- [x] **Step 6: Run final focused verification**

Run: `npx tsx --test tests/roster-effective-date-reconciliation.test.ts tests/roster-district-resolution.test.ts`

Expected: all tests pass with zero failures.