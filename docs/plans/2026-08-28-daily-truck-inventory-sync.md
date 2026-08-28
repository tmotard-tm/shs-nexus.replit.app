# Daily Truck Inventory Sync Implementation Plan

> **For agents:** Use the `executing-plans` skill to work through this task by task. Steps use `- [ ]` checkboxes for tracking.

**Goal:** Refresh the current truck-inventory mirror once per Eastern day at or after 7:00 AM, with autoscale startup catch-up and no Fleet Agents dependency.

**Architecture:** Extract Eastern-time due logic and the daily runner into a focused scheduler module. Keep the existing Snowflake projection, but protect refreshes with a dedicated cross-process advisory lock and replace the PostgreSQL mirror in one transaction so readers see either the old complete snapshot or the new complete snapshot. A dedicated inventory-only one-minute timer runs in both environments because the general Snowflake interval is intentionally disabled in production.

**Tech Stack:** TypeScript, Node.js `node:test` through `tsx`, Express, Drizzle ORM, node-postgres, PostgreSQL advisory locks, Snowflake SDK.

**Verification:** `npx tsx --test tests/truck-inventory-refresh.test.ts` must report zero failures; `npm run build` must exit 0; `npm run check` may retain the documented ~224-error repository baseline but must add zero errors in touched files.

## Global Constraints

- Do not add any inventory process or scheduler call to Fleet Agents.
- Interpret “Eastern” with `America/New_York`, including DST.
- Automatic refreshes run at most once per Eastern calendar day; failed runs remain retryable that day.
- A nonempty but stale mirror must not suppress startup catch-up.
- Never expose a partially replaced snapshot.
- Never combine multiple extract dates in the inventory summary.
- Preserve the existing Snowflake business filters and category/cost projection.
- Empty or mixed-date Snowflake results fail closed and retain the last complete mirror.
- Manual and automatic refreshes use the same locked replacement path.

---

### Task 1: Eastern-Time Daily Due Decision

**Files:**
- Create: `server/truck-inventory-refresh.ts`
- Create: `tests/truck-inventory-refresh.test.ts`

**Interfaces:**
- Produces: `inventoryEasternClock(now: Date): { day: string; hour: number }`
- Produces: `isDailyTruckInventoryRefreshDue(now: Date, lastCompletedAt: Date | null): boolean`
- The due function returns `false` before 07:00 Eastern, `true` at/after 07:00 when no completion exists for the current Eastern day, and `false` after a same-day completion.

- [ ] **Step 1: Write failing pure tests for Eastern scheduling**

Add tests covering:

```ts
test("is not due before 7 AM Eastern", () => {
  assert.equal(
    isDailyTruckInventoryRefreshDue(
      new Date("2026-08-28T10:59:59Z"), // 06:59:59 EDT
      null,
    ),
    false,
  );
});

test("is due at 7 AM Eastern during daylight time", () => {
  assert.equal(
    isDailyTruckInventoryRefreshDue(new Date("2026-08-28T11:00:00Z"), null),
    true,
  );
});

test("is due at 7 AM Eastern during standard time", () => {
  assert.equal(
    isDailyTruckInventoryRefreshDue(new Date("2026-12-15T12:00:00Z"), null),
    true,
  );
});

test("a same-Eastern-day completion suppresses a second run", () => {
  assert.equal(
    isDailyTruckInventoryRefreshDue(
      new Date("2026-08-28T20:00:00Z"),
      new Date("2026-08-28T11:15:00Z"),
    ),
    false,
  );
});

test("a prior-Eastern-day completion allows startup catch-up", () => {
  assert.equal(
    isDailyTruckInventoryRefreshDue(
      new Date("2026-08-28T20:00:00Z"),
      new Date("2026-08-27T23:30:00Z"),
    ),
    true,
  );
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npx tsx --test tests/truck-inventory-refresh.test.ts`

Expected: FAIL because `server/truck-inventory-refresh.ts` or its exports do not exist.

- [ ] **Step 3: Implement the pure Eastern-time functions**

Use `Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now)` and construct `YYYY-MM-DD` from named parts. Do not use a fixed UTC offset.

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run: `npx tsx --test tests/truck-inventory-refresh.test.ts`

Expected: all Task 1 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/truck-inventory-refresh.ts tests/truck-inventory-refresh.test.ts
git commit -m "test: define daily inventory refresh timing"
```

---

### Task 2: Atomic Current-Snapshot Storage

**Files:**
- Modify: `server/storage.ts`
- Modify: `tests/truck-inventory-refresh.test.ts`

**Interfaces:**
- Produces: `replaceTruckInventorySnapshot(items: InsertTruckInventory[]): Promise<number>` on `IStorage` and `DatabaseStorage`.
- `replaceTruckInventorySnapshot` rejects empty input and input containing more than one `extractDate`.
- Replacement deletes and inserts inside one Drizzle transaction, using bounded insert batches, and returns the inserted row count.
- `getTruckInventory(truck)` returns rows only from the mirror’s global maximum `extract_date`.

- [ ] **Step 1: Add failing storage tests**

Use an injected transaction harness so the test never deletes the shared
development inventory table. Test:

1. Two historical extract dates for one truck produce only rows from the global latest date through `getTruckInventory`.
2. Replacing with a new complete snapshot removes prior dates.
3. Empty replacement is rejected without deleting existing rows.
4. Mixed-date replacement is rejected without deleting existing rows.
5. A forced insert failure rolls the transaction back and preserves the previous snapshot.

The harness must model commit/rollback over an in-memory snapshot and prove that
the replacement callback performs delete + bounded inserts atomically. Do not
run a destructive whole-table replacement against the shared development DB.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npx tsx --test tests/truck-inventory-refresh.test.ts`

Expected: FAIL because `replaceTruckInventorySnapshot` is absent and `getTruckInventory` returns multiple dates.

- [ ] **Step 3: Implement atomic replacement**

Add the interface method and implement:

```ts
async replaceTruckInventorySnapshot(items: InsertTruckInventory[]): Promise<number> {
  if (items.length === 0) throw new Error("truck inventory snapshot is empty");
  const dates = new Set(items.map((item) => item.extractDate));
  if (dates.size !== 1) throw new Error("truck inventory snapshot contains multiple extract dates");

  return db.transaction(async (tx) => {
    await tx.delete(truckInventory);
    let inserted = 0;
    for (let i = 0; i < items.length; i += 500) {
      const rows = await tx.insert(truckInventory)
        .values(items.slice(i, i + 500))
        .returning({ id: truckInventory.id });
      inserted += rows.length;
    }
    return inserted;
  });
}
```

Update the in-memory storage implementation with equivalent validation/replacement semantics. Update `getTruckInventory` to include the table-wide maximum `extract_date` predicate.

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run: `npx tsx --test tests/truck-inventory-refresh.test.ts`

Expected: all Task 1 and Task 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/storage.ts tests/truck-inventory-refresh.test.ts
git commit -m "fix: replace truck inventory atomically"
```

---

### Task 3: Locked Snowflake Refresh and Durable Daily Watermark

**Files:**
- Modify: `server/snowflake-sync-service.ts`
- Modify: `server/fleetscope-snowflake-sync-lock.ts`
- Modify: `server/truck-inventory-refresh.ts`
- Modify: `tests/truck-inventory-refresh.test.ts`

**Interfaces:**
- Produces: `TRUCK_INVENTORY_SYNC_LOCK = "truck-inventory-refresh"` in the lock module.
- Produces: `getLastCompletedTruckInventorySync(): Promise<Date | null>`.
- Produces: `runDailyTruckInventoryRefreshTick(trigger: "scheduler" | "startup_catchup", now?: Date): Promise<{ ran: boolean; skippedReason?: string; result?: SyncResult }>`
- `SnowflakeSyncService.syncTruckInventory(triggeredBy)` acquires the dedicated inventory lock, takes the shared Snowflake-read lock around the warehouse query, validates one nonempty extract date, then calls `replaceTruckInventorySnapshot`.
- A successful `sync_logs` row is the durable daily watermark; failures and lock skips do not suppress retry.

- [ ] **Step 1: Add failing orchestration tests**

Inject test dependencies into the daily tick and assert:

```ts
test("a successful due tick runs once and records the trigger", async () => {
  // last completion is yesterday; sync returns success
  // assert ran=true and one sync call with "scheduler"
});

test("a failed due tick remains retryable", async () => {
  // first sync returns success=false; last-completed remains yesterday
  // assert a second tick calls sync again
});

test("a same-day completion skips without calling Snowflake", async () => {
  // assert ran=false, skippedReason="already_completed_today"
});

test("concurrent refresh callers do not both replace the mirror", async () => {
  // hold the named lock in one caller and assert the other reports lock_unavailable
});
```

Add a mapping-validation test proving empty and mixed-date Snowflake results never call replacement.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npx tsx --test tests/truck-inventory-refresh.test.ts`

Expected: FAIL because the daily runner and locked replacement orchestration are missing.

- [ ] **Step 3: Refactor the inventory sync**

Change `syncTruckInventory` from batch-by-batch `bulkUpsertTruckInventory` to:

1. Create the existing running `sync_logs` row.
2. Enter `runUnderAdvisoryLock(TRUCK_INVENTORY_SYNC_LOCK, ...)`.
3. Enter `runUnderSnowflakeSyncLock("truck-inventory-refresh:snowflake-read", ...)` only for `executeQuery`.
4. Map every warehouse row.
5. Validate nonempty and one `extractDate`.
6. Call `assertAdvisoryLockHeld` immediately before replacement.
7. Call `storage.replaceTruckInventorySnapshot`.
8. Mark the log completed only after replacement commits.
9. Mark failures as failed and rethrow or return `success:false` consistently.

Do not retain the existing `onConflictDoNothing` append behavior in the active refresh path.

- [ ] **Step 4: Implement the durable due runner**

Query the most recent completed `sync_logs` row for `sync_type='truck_inventory'`. Call `isDailyTruckInventoryRefreshDue`; when due, invoke `syncTruckInventory(trigger)`. Treat lock-unavailable as a visible skip and every failed result as still due on the next scheduler tick.

- [ ] **Step 5: Run the focused test and confirm GREEN**

Run: `npx tsx --test tests/truck-inventory-refresh.test.ts`

Expected: all scheduling, storage, validation, watermark, and concurrency tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/snowflake-sync-service.ts server/fleetscope-snowflake-sync-lock.ts server/truck-inventory-refresh.ts tests/truck-inventory-refresh.test.ts
git commit -m "feat: lock and watermark daily inventory refresh"
```

---

### Task 4: Wire the Existing Nexus Scheduler and Remove the Empty-Only Startup Path

**Files:**
- Modify: `server/sync-scheduler.ts`
- Modify: `server/index.ts`
- Modify: `tests/truck-inventory-refresh.test.ts`
- Modify: `replit.md`

**Interfaces:**
- `startSyncScheduler()` starts a dedicated inventory-only one-minute timer in both development and production.
- The first inventory check five seconds after startup supplies `startup_catchup`; later interval checks use `scheduler`.
- The legacy “sync only if table empty” startup block is removed.

- [ ] **Step 1: Add a failing wiring regression test**

Read the scheduler and startup source as text and assert:

- `sync-scheduler.ts` imports and calls `runDailyTruckInventoryRefreshTick` from a dedicated timer that is outside the development-only general scheduler branch.
- `index.ts` no longer conditions truck-inventory refresh on `!latestExtract`.
- No Fleet Agents URL or scheduler call is added.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npx tsx --test tests/truck-inventory-refresh.test.ts`

Expected: FAIL because the scheduler is not wired and the empty-only startup block remains.

- [ ] **Step 3: Wire the daily tick**

Start one dedicated inventory interval for both environments. Pass `startup_catchup` to a five-second startup timer and `scheduler` to later one-minute interval ticks. Invoke the inventory tick independently of the older fixed-offset 5:00 AM roster branch, and catch/log errors so one failed inventory refresh does not prevent unrelated scheduler checks.

- [ ] **Step 4: Remove the obsolete startup block**

Delete the `server/index.ts` block that checks `getLatestTruckInventoryExtractDate()` and calls `syncTruckInventory()` only when no rows exist.

- [ ] **Step 5: Document the implemented operational contract**

Update `replit.md` with:

- 7:00 AM `America/New_York` schedule.
- Autoscale startup catch-up behavior.
- `sync_logs` watermark.
- Atomic current-snapshot replacement.
- Explicit statement that Fleet Agents is not involved.

- [ ] **Step 6: Run focused tests**

Run: `npx tsx --test tests/truck-inventory-refresh.test.ts`

Expected: zero failures.

- [ ] **Step 7: Run repository verification**

Run:

```bash
npm run build
npm run check > /tmp/truck-inventory-tsc.log 2>&1; true
grep -E "server/(truck-inventory-refresh|snowflake-sync-service|storage|sync-scheduler|index)\\.ts|tests/truck-inventory-refresh\\.test\\.ts" /tmp/truck-inventory-tsc.log
```

Expected:

- Build exits 0.
- The filtered typecheck output is empty.
- Total typecheck errors do not exceed the documented baseline by any new touched-file errors.

- [ ] **Step 8: Restart and inspect**

Restart the `Start application` workflow, refresh logs, and confirm:

- The server opens port 5000.
- Route registration completes.
- The first inventory scheduler tick either reports “not due,” “already completed today,” or begins one locked catch-up; it must not silently skip because the mirror is merely nonempty.

- [ ] **Step 9: Commit**

```bash
git add server/sync-scheduler.ts server/index.ts tests/truck-inventory-refresh.test.ts replit.md
git commit -m "feat: schedule daily truck inventory refresh"
```

---

### Task 5: Final Review

**Files:**
- Review all files changed by Tasks 1–4.

**Interfaces:**
- No new interfaces; this task verifies the complete design contract.

- [ ] **Step 1: Re-run the full focused verification**

Run:

```bash
npx tsx --test tests/truck-inventory-refresh.test.ts
npm run build
```

Expected: zero test failures and build exit 0.

- [ ] **Step 2: Review against the approved design**

Confirm line by line:

- Eastern time is DST-aware.
- Startup catch-up is based on `sync_logs`, not table emptiness.
- Failures remain retryable.
- Locking is cross-process and uses a dedicated client.
- Snowflake reads join the shared heavy-read lock.
- Replacement is atomic and fail-closed.
- Inventory reads cannot accumulate dates.
- No Fleet Agents code or dependency was introduced.

- [ ] **Step 3: Request architecture review**

Provide the approved design, this plan, and the final diff to a code-review agent. Address any correctness finding before completion.

- [ ] **Step 4: Final commit**

```bash
git add docs/specs/2026-08-28-daily-truck-inventory-sync-design.md docs/plans/2026-08-28-daily-truck-inventory-sync.md
git commit -m "docs: record daily inventory refresh design"
```