// Pure month-bucketing logic for the Registration tab's
// "Assigned Truck Registrations Expiring by Month" card.
//
// History: a hardcoded "Jan 2026 (Expired)" special case (added when Jan 2026
// was the current month) overrode the real January 2026 count with a count of
// ALL pre-2026 expirations, while those same trucks were also counted in their
// own month buckets — double-counting old months and hiding genuine Jan 2026
// expirations. Every truck now counts exactly once, in its natural month.

export interface RegistrationTruckLike {
  truckNumber: string;
  assignmentStatus: string;
  regExpDate?: string | null;
}

export interface MonthlyExpiryBucket {
  key: string; // YYYY-MM
  count: number;
  date: Date; // first of the month
  label: string; // e.g. "Jan 2026"
  isPast: boolean;
  isCurrent: boolean;
}

/** BYOV trucks are excluded by their raw '088' prefix (check BEFORE any padding). */
export function isCountableAssignedTruck(t: RegistrationTruckLike): boolean {
  return (
    t.assignmentStatus === 'Assigned' &&
    !!t.regExpDate &&
    !t.truckNumber.startsWith('088')
  );
}

export function monthKeyFor(expDate: Date): string {
  return `${expDate.getFullYear()}-${String(expDate.getMonth() + 1).padStart(2, '0')}`;
}

export function monthLabelFor(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

/**
 * Buckets assigned trucks by the month their registration actually expires.
 * - Each truck counts exactly once, in its natural expiration month.
 * - All past months with data are kept (rendered as Overdue by the card).
 * - Future months are limited to 12 months ahead of `today`'s month.
 */
export function buildMonthlyExpiryCounts(
  trucks: RegistrationTruckLike[],
  today: Date = new Date(),
): MonthlyExpiryBucket[] {
  const counts: Record<string, number> = {};

  for (const truck of trucks) {
    if (!isCountableAssignedTruck(truck)) continue;
    const expDate = new Date(truck.regExpDate as string);
    if (isNaN(expDate.getTime())) continue;
    const key = monthKeyFor(expDate);
    counts[key] = (counts[key] || 0) + 1;
  }

  const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const twelveMonthsAhead = new Date(today.getFullYear(), today.getMonth() + 12, 1);

  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => {
      const [year, month] = key.split('-').map(Number);
      const date = new Date(year, month - 1, 1);
      return {
        key,
        count,
        date,
        label: monthLabelFor(date),
        isPast: date < currentMonthStart,
        isCurrent:
          date.getFullYear() === today.getFullYear() &&
          date.getMonth() === today.getMonth(),
      };
    })
    .filter(m => m.date <= twelveMonthsAhead) // limit future only; keep all past months
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}
