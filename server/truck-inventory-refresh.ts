export const TRUCK_INVENTORY_TIME_ZONE = "America/New_York";
export const TRUCK_INVENTORY_REFRESH_HOUR = 7;

const easternClockFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TRUCK_INVENTORY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

export function inventoryEasternClock(now: Date): { day: string; hour: number } {
  const values: Record<string, string> = {};
  for (const part of easternClockFormatter.formatToParts(now)) {
    if (part.type !== "literal") values[part.type] = part.value;
  }

  return {
    day: `${values.year}-${values.month}-${values.day}`,
    hour: Number(values.hour),
  };
}

export function isDailyTruckInventoryRefreshDue(
  now: Date,
  lastCompletedAt: Date | null,
): boolean {
  const current = inventoryEasternClock(now);
  if (current.hour < TRUCK_INVENTORY_REFRESH_HOUR) return false;
  if (!lastCompletedAt) return true;
  const lastCompleted = inventoryEasternClock(lastCompletedAt);
  return (
    lastCompleted.day !== current.day
    || lastCompleted.hour < TRUCK_INVENTORY_REFRESH_HOUR
  );
}

export type TruckInventoryRefreshTrigger = "scheduler" | "startup_catchup";

export interface TruckInventorySyncResult {
  success: boolean;
  recordsProcessed: number;
  errors: string[];
  skippedReason?: string;
}

export interface DailyTruckInventoryRefreshDependencies {
  getLastCompletedAt(): Promise<Date | null>;
  sync(trigger: TruckInventoryRefreshTrigger): Promise<TruckInventorySyncResult>;
}

export interface DailyTruckInventoryRefreshTickResult {
  ran: boolean;
  skippedReason?: "before_refresh_hour" | "already_completed_today";
  result?: TruckInventorySyncResult;
}

export async function getLastCompletedTruckInventorySync(): Promise<Date | null> {
  const { storage } = await import("./storage");
  const log = await storage.getLatestCompletedSyncLog("truck_inventory");
  return log?.completedAt ?? null;
}

const defaultDependencies: DailyTruckInventoryRefreshDependencies = {
  getLastCompletedAt: getLastCompletedTruckInventorySync,
  sync: async (trigger) => {
    const { getSnowflakeSyncService } = await import("./snowflake-sync-service");
    return getSnowflakeSyncService().syncTruckInventory(trigger);
  },
};

export async function runDailyTruckInventoryRefreshTick(
  trigger: TruckInventoryRefreshTrigger,
  now = new Date(),
  dependencies: DailyTruckInventoryRefreshDependencies = defaultDependencies,
): Promise<DailyTruckInventoryRefreshTickResult> {
  const current = inventoryEasternClock(now);
  if (current.hour < TRUCK_INVENTORY_REFRESH_HOUR) {
    return { ran: false, skippedReason: "before_refresh_hour" };
  }

  const lastCompletedAt = await dependencies.getLastCompletedAt();
  if (!isDailyTruckInventoryRefreshDue(now, lastCompletedAt)) {
    return { ran: false, skippedReason: "already_completed_today" };
  }

  return {
    ran: true,
    result: await dependencies.sync(trigger),
  };
}