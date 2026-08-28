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
  return inventoryEasternClock(lastCompletedAt).day !== current.day;
}