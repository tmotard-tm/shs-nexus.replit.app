import test from "node:test";
import assert from "node:assert/strict";
import {
  inventoryEasternClock,
  isDailyTruckInventoryRefreshDue,
} from "../server/truck-inventory-refresh";
import {
  replaceTruckInventorySnapshotAtomically,
  type TruckInventorySnapshotWriter,
} from "../server/truck-inventory-snapshot";
import type { InsertTruckInventory } from "@shared/schema";

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