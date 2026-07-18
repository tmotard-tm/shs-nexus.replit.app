// shared/onboarding-weeks.ts
// Week grouping for the Weekly Onboarding page. Sunday-start weeks with
// date-fns getWeek parity (weekStartsOn: 0, firstWeekContainsDate: 1) so the
// labels match what the legacy page's week dropdown displayed.
import { format, getWeek } from "date-fns";

const MS_DAY = 86_400_000;

/** Parse a date-only ISO string as a LOCAL date (never UTC-shifted). */
export function parseLocalDate(value: string | Date): Date {
  if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function sundayOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - x.getDay());
  return x;
}

export function getWeekNum(d: Date): number {
  return getWeek(d, { weekStartsOn: 0, firstWeekContainsDate: 1 });
}

export function weekKey(d: Date): number {
  return sundayOf(d).getTime();
}

export function weekLabel(start: Date): string {
  const end = new Date(start.getTime() + 6 * MS_DAY);
  return `${format(start, "MMM d")} - ${format(end, "MMM d, yyyy")} (Week ${getWeekNum(start)})`;
}

export interface WeekGroup<T> {
  key: number;
  start: Date;
  end: Date;
  isCurrent: boolean;
  isFuture: boolean;
  hires: T[];
}

export function groupHiresByWeek<T extends { serviceDate: string | Date | null }>(
  hires: T[],
  today: Date,
): WeekGroup<T>[] {
  const currentKey = weekKey(today);
  const map = new Map<number, WeekGroup<T>>();
  for (const h of hires) {
    if (!h.serviceDate) continue;
    const start = sundayOf(parseLocalDate(h.serviceDate as string | Date));
    const key = start.getTime();
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        start,
        end: new Date(key + 6 * MS_DAY),
        isCurrent: key === currentKey,
        isFuture: key > currentKey,
        hires: [],
      };
      map.set(key, g);
    }
    g.hires.push(h);
  }
  return Array.from(map.values()).sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    if (a.isFuture && b.isFuture) return a.key - b.key;
    if (a.isFuture !== b.isFuture) return a.isFuture ? -1 : 1;
    return b.key - a.key;
  });
}
