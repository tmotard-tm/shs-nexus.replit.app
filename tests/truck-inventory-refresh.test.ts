import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  inventoryEasternClock,
  isDailyTruckInventoryRefreshDue,
  runDailyTruckInventoryRefreshTick,
} from "../server/truck-inventory-refresh";
import {
  replaceTruckInventorySnapshotAtomically,
  replaceTruckInventorySnapshotAndCompleteAtomically,
  validateTruckInventorySnapshot,
  type TruckInventorySnapshotWriter,
  type TruckInventorySnapshotCompletionWriter,
} from "../server/truck-inventory-snapshot";
import type { InsertTruckInventory } from "@shared/schema";
import {
  AdvisoryLockUnavailableError,
  runUnderAdvisoryLock,
  TRUCK_INVENTORY_SYNC_LOCK,
} from "../server/fleetscope-snowflake-sync-lock";
import { fsPool } from "../server/fleet-scope-db";

after(async () => {
  await fsPool.end();
});

test("is not due before 7 AM Eastern", () => {
  assert.equal(
    isDailyTruckInventoryRefreshDue(
      new Date("2026-08-28T10:59:59Z"),
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

test("a same-day completion before 7 AM does not suppress the required 7 AM run", () => {
  assert.equal(
    isDailyTruckInventoryRefreshDue(
      new Date("2026-08-28T11:00:00Z"),
      new Date("2026-08-28T10:30:00Z"),
    ),
    true,
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

test("Eastern clock emits a stable YYYY-MM-DD day and 24-hour clock", () => {
  assert.deepEqual(
    inventoryEasternClock(new Date("2026-08-28T11:00:00Z")),
    { day: "2026-08-28", hour: 7 },
  );
});

function inventoryRow(
  extractDate: string,
  truck: string,
  sku: string,
  qty = 1,
): InsertTruckInventory {
  return {
    extractDate,
    district: "0008332",
    truck,
    sku,
    qty,
  };
}

function transactionHarness(
  initial: InsertTruckInventory[],
  failSku?: string,
): {
  rows: () => InsertTruckInventory[];
  run: <T>(work: (writer: TruckInventorySnapshotWriter) => Promise<T>) => Promise<T>;
} {
  let committed = [...initial];
  return {
    rows: () => committed,
    run: async <T>(work: (writer: TruckInventorySnapshotWriter) => Promise<T>) => {
      let draft = [...committed];
      const writer: TruckInventorySnapshotWriter = {
        deleteAll: async () => {
          draft = [];
        },
        insertBatch: async (items) => {
          if (failSku && items.some((item) => item.sku === failSku)) {
            throw new Error("forced insert failure");
          }
          draft.push(...items);
          return items.length;
        },
      };
      try {
        const result = await work(writer);
        committed = draft;
        return result;
      } catch (error) {
        throw error;
      }
    },
  };
}

test("atomic replacement rejects an empty snapshot without deleting the current one", async () => {
  const old = [inventoryRow("2025-12-30", "088129", "OLD")];
  const harness = transactionHarness(old);

  await assert.rejects(
    replaceTruckInventorySnapshotAtomically([], harness.run),
    /snapshot is empty/,
  );
  assert.deepEqual(harness.rows(), old);
});

test("atomic replacement rejects mixed extract dates without deleting the current one", async () => {
  const old = [inventoryRow("2025-12-30", "088129", "OLD")];
  const harness = transactionHarness(old);

  await assert.rejects(
    replaceTruckInventorySnapshotAtomically(
      [
        inventoryRow("2026-08-28", "088129", "NEW1"),
        inventoryRow("2026-08-27", "088129", "NEW2"),
      ],
      harness.run,
    ),
    /multiple extract dates/,
  );
  assert.deepEqual(harness.rows(), old);
});

test("atomic replacement commits one complete current snapshot in bounded batches", async () => {
  const harness = transactionHarness([
    inventoryRow("2025-12-30", "088129", "OLD"),
  ]);
  const next = [
    inventoryRow("2026-08-28", "088129", "NEW1", 20),
    inventoryRow("2026-08-28", "088129", "NEW2", 8),
  ];

  const inserted = await replaceTruckInventorySnapshotAtomically(
    next,
    harness.run,
    1,
  );

  assert.equal(inserted, 2);
  assert.deepEqual(harness.rows(), next);
});

test("atomic replacement rolls back to the prior snapshot when any batch fails", async () => {
  const old = [inventoryRow("2025-12-30", "088129", "OLD")];
  const harness = transactionHarness(old, "FAIL");

  await assert.rejects(
    replaceTruckInventorySnapshotAtomically(
      [
        inventoryRow("2026-08-28", "088129", "NEW"),
        inventoryRow("2026-08-28", "088129", "FAIL"),
      ],
      harness.run,
      1,
    ),
    /forced insert failure/,
  );
  assert.deepEqual(harness.rows(), old);
});

test("snapshot validation rejects impossible and noncanonical extract dates", () => {
  assert.throws(
    () => validateTruckInventorySnapshot([
      inventoryRow("2026-02-30", "088129", "BAD"),
    ]),
    /invalid extract date/,
  );
  assert.throws(
    () => validateTruckInventorySnapshot([
      inventoryRow("08\\/28\\/2026", "088129", "BAD"),
    ]),
    /invalid extract date/,
  );
});

test("snapshot rows and the completed watermark commit or roll back together", async () => {
  const old = [inventoryRow("2025-12-30", "088129", "OLD")];
  let committedRows = [...old];
  let committedLogStatus = "running";

  const run = async <T>(
    work: (writer: TruckInventorySnapshotCompletionWriter) => Promise<T>,
  ): Promise<T> => {
    let draftRows = [...committedRows];
    let draftLogStatus = committedLogStatus;
    const writer: TruckInventorySnapshotCompletionWriter = {
      deleteAll: async () => {
        draftRows = [];
      },
      insertBatch: async (items) => {
        draftRows.push(...items);
        return items.length;
      },
      completeSyncLog: async () => {
        draftLogStatus = "completed";
        throw new Error("forced watermark write failure");
      },
    };
    const result = await work(writer);
    committedRows = draftRows;
    committedLogStatus = draftLogStatus;
    return result;
  };

  await assert.rejects(
    replaceTruckInventorySnapshotAndCompleteAtomically(
      [inventoryRow("2026-08-28", "088129", "NEW")],
      { syncLogId: "sync-1", completedAt: new Date("2026-08-28T11:10:00Z") },
      run,
    ),
    /forced watermark write failure/,
  );
  assert.deepEqual(committedRows, old);
  assert.equal(committedLogStatus, "running");
});

test("a successful due tick runs once with the supplied scheduler trigger", async () => {
  const calls: string[] = [];
  const result = await runDailyTruckInventoryRefreshTick(
    "scheduler",
    new Date("2026-08-28T11:00:00Z"),
    {
      getLastCompletedAt: async () => new Date("2026-08-27T12:00:00Z"),
      sync: async (trigger) => {
        calls.push(trigger);
        return { success: true, recordsProcessed: 20, errors: [] };
      },
    },
  );

  assert.equal(result.ran, true);
  assert.equal(result.result?.success, true);
  assert.deepEqual(calls, ["scheduler"]);
});

test("a failed due tick remains eligible for a later retry that day", async () => {
  let calls = 0;
  const deps = {
    getLastCompletedAt: async () => new Date("2026-08-27T12:00:00Z"),
    sync: async () => {
      calls += 1;
      return { success: false, recordsProcessed: 0, errors: ["warehouse unavailable"] };
    },
  };
  const now = new Date("2026-08-28T15:00:00Z");

  const first = await runDailyTruckInventoryRefreshTick("startup_catchup", now, deps);
  const second = await runDailyTruckInventoryRefreshTick("scheduler", now, deps);

  assert.equal(first.ran, true);
  assert.equal(second.ran, true);
  assert.equal(calls, 2);
});

test("a same-day completion skips without calling the sync", async () => {
  let calls = 0;
  const result = await runDailyTruckInventoryRefreshTick(
    "scheduler",
    new Date("2026-08-28T20:00:00Z"),
    {
      getLastCompletedAt: async () => new Date("2026-08-28T11:15:00Z"),
      sync: async () => {
        calls += 1;
        return { success: true, recordsProcessed: 1, errors: [] };
      },
    },
  );

  assert.equal(result.ran, false);
  assert.equal(result.skippedReason, "already_completed_today");
  assert.equal(calls, 0);
});

test("a tick before 7 AM skips without consulting the durable watermark", async () => {
  let watermarkReads = 0;
  const result = await runDailyTruckInventoryRefreshTick(
    "startup_catchup",
    new Date("2026-08-28T10:59:59Z"),
    {
      getLastCompletedAt: async () => {
        watermarkReads += 1;
        return null;
      },
      sync: async () => ({ success: true, recordsProcessed: 1, errors: [] }),
    },
  );

  assert.equal(result.ran, false);
  assert.equal(result.skippedReason, "before_refresh_hour");
  assert.equal(watermarkReads, 0);
});

test("the dedicated advisory lock prevents concurrent inventory replacements", async () => {
  let releaseFirst!: () => void;
  const releaseGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let firstEntered!: () => void;
  const enteredGate = new Promise<void>((resolve) => {
    firstEntered = resolve;
  });

  const first = runUnderAdvisoryLock(
    TRUCK_INVENTORY_SYNC_LOCK,
    "inventory-test-holder",
    async () => {
      firstEntered();
      await releaseGate;
    },
    { waitMs: 0 },
  );

  await enteredGate;
  await assert.rejects(
    runUnderAdvisoryLock(
      TRUCK_INVENTORY_SYNC_LOCK,
      "inventory-test-contender",
      async () => {
        assert.fail("contending refresh must not enter the locked section");
      },
      { waitMs: 0 },
    ),
    AdvisoryLockUnavailableError,
  );

  releaseFirst();
  await first;
});

test("Nexus owns a production-capable inventory timer and no longer uses empty-only startup sync", async () => {
  const schedulerSource = await readFile(
    new URL("../server/sync-scheduler.ts", import.meta.url),
    "utf8",
  );
  const indexSource = await readFile(
    new URL("../server/index.ts", import.meta.url),
    "utf8",
  );

  assert.match(schedulerSource, /runDailyTruckInventoryRefreshTick/);
  assert.match(schedulerSource, /startup_catchup/);
  assert.match(schedulerSource, /TRUCK_INVENTORY_CHECK_INTERVAL_MS/);
  assert.doesNotMatch(indexSource, /getLatestTruckInventoryExtractDate/);
  assert.doesNotMatch(indexSource, /Auto-sync truck inventory on startup if empty/);
  assert.doesNotMatch(schedulerSource, /FLEET_AGENTS/i);
});

test("the destructive transaction uses the advisory-lock session and every inventory reader is latest-only", async () => {
  const syncSource = await readFile(
    new URL("../server/snowflake-sync-service.ts", import.meta.url),
    "utf8",
  );
  const storageSource = await readFile(
    new URL("../server/storage.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    syncSource,
    /replaceTruckInventorySnapshot\(\s*inventoryData,\s*\{ syncLogId, completedAt: new Date\(\) \},\s*lockClient,\s*\)/,
  );
  assert.match(storageSource, /drizzle\(transactionClient\)/);

  for (const method of [
    "getTruckInventory",
    "getTruckInventoryByEnterpriseId",
    "getTruckInventoryByDistrict",
  ]) {
    const start = storageSource.lastIndexOf(`async ${method}(`);
    const end = storageSource.indexOf("\n  async ", start + 1);
    assert.notEqual(start, -1, `${method} must exist`);
    assert.match(
      storageSource.slice(start, end),
      /MAX\(extract_date\) FROM truck_inventory/,
      `${method} must restrict rows to the global latest extract date`,
    );
  }
});