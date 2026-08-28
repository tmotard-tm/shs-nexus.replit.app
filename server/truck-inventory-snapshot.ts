import type { InsertTruckInventory } from "@shared/schema";

export interface TruckInventorySnapshotWriter {
  deleteAll(): Promise<void>;
  insertBatch(items: InsertTruckInventory[]): Promise<number>;
}

export type TruckInventoryTransactionRunner = <T>(
  work: (writer: TruckInventorySnapshotWriter) => Promise<T>,
) => Promise<T>;

export function validateTruckInventorySnapshot(
  items: InsertTruckInventory[],
): string {
  if (items.length === 0) {
    throw new Error("truck inventory snapshot is empty");
  }

  const extractDates = new Set(items.map((item) => item.extractDate));
  if (extractDates.size !== 1) {
    throw new Error("truck inventory snapshot contains multiple extract dates");
  }

  const extractDate = Array.from(extractDates)[0];
  if (!extractDate) {
    throw new Error("truck inventory snapshot has no extract date");
  }
  return extractDate;
}

export async function replaceTruckInventorySnapshotAtomically(
  items: InsertTruckInventory[],
  runTransaction: TruckInventoryTransactionRunner,
  batchSize = 500,
): Promise<number> {
  validateTruckInventorySnapshot(items);
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error("truck inventory batch size must be a positive integer");
  }

  return runTransaction(async (writer) => {
    await writer.deleteAll();
    let inserted = 0;
    for (let i = 0; i < items.length; i += batchSize) {
      inserted += await writer.insertBatch(items.slice(i, i + batchSize));
    }
    if (inserted !== items.length) {
      throw new Error(
        `truck inventory snapshot insert count mismatch: expected ${items.length}, inserted ${inserted}`,
      );
    }
    return inserted;
  });
}