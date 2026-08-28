import type { InsertTruckInventory } from "@shared/schema";

export interface TruckInventorySnapshotWriter {
  deleteAll(): Promise<void>;
  insertBatch(items: InsertTruckInventory[]): Promise<number>;
}

export interface TruckInventorySnapshotCompletion {
  syncLogId: string;
  completedAt: Date;
}

export interface TruckInventorySnapshotCompletionWriter
  extends TruckInventorySnapshotWriter {
  completeSyncLog(
    completion: TruckInventorySnapshotCompletion,
    recordsProcessed: number,
  ): Promise<boolean>;
}

export type TruckInventoryTransactionRunner = <T>(
  work: (writer: TruckInventorySnapshotWriter) => Promise<T>,
) => Promise<T>;

export type TruckInventoryCompletionTransactionRunner = <T>(
  work: (writer: TruckInventorySnapshotCompletionWriter) => Promise<T>,
) => Promise<T>;

export function normalizeTruckInventoryExtractDate(value: unknown): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error("truck inventory snapshot has an invalid extract date");
    }
    return value.toISOString().slice(0, 10);
  }

  if (typeof value !== "string") {
    throw new Error("truck inventory snapshot has an invalid extract date");
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error("truck inventory snapshot has an invalid extract date");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    throw new Error("truck inventory snapshot has an invalid extract date");
  }

  return value;
}

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
  normalizeTruckInventoryExtractDate(extractDate);
  return extractDate;
}

async function writeTruckInventorySnapshot(
  items: InsertTruckInventory[],
  writer: TruckInventorySnapshotWriter,
  batchSize: number,
): Promise<number> {
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

  return runTransaction((writer) =>
    writeTruckInventorySnapshot(items, writer, batchSize),
  );
}

export async function replaceTruckInventorySnapshotAndCompleteAtomically(
  items: InsertTruckInventory[],
  completion: TruckInventorySnapshotCompletion,
  runTransaction: TruckInventoryCompletionTransactionRunner,
  batchSize = 500,
): Promise<number> {
  validateTruckInventorySnapshot(items);
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error("truck inventory batch size must be a positive integer");
  }

  return runTransaction(async (writer) => {
    const inserted = await writeTruckInventorySnapshot(items, writer, batchSize);
    const completed = await writer.completeSyncLog(completion, inserted);
    if (!completed) {
      throw new Error(
        `truck inventory sync log ${completion.syncLogId} was not running at commit`,
      );
    }
    return inserted;
  });
}