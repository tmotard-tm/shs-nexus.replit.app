export interface RosterEventRow {
  EMPL_ID: string;
  ENTERPRISE_ID?: string;
  EMPLOYMENT_STATUS?: string;
  EFFDT?: string;
}

function isoDate(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  return trimmed.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
}

function isTerminated(row: RosterEventRow): boolean {
  return row.EMPLOYMENT_STATUS?.trim().toUpperCase() === "T";
}

function stableFingerprint(row: RosterEventRow): string {
  return JSON.stringify(
    Object.entries(row)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function compareRosterEvents(
  left: RosterEventRow,
  right: RosterEventRow,
): number {
  const leftDate = isoDate(left.EFFDT);
  const rightDate = isoDate(right.EFFDT);

  if (leftDate !== rightDate) {
    if (leftDate === null) return -1;
    if (rightDate === null) return 1;
    return leftDate.localeCompare(rightDate);
  }

  const leftActivePriority = isTerminated(left) ? 0 : 1;
  const rightActivePriority = isTerminated(right) ? 0 : 1;
  if (leftActivePriority !== rightActivePriority) {
    return leftActivePriority - rightActivePriority;
  }

  return stableFingerprint(left).localeCompare(stableFingerprint(right));
}

export function reconcileRosterRows<T extends RosterEventRow>(
  rows: readonly T[],
  asOfDate: Date = new Date(),
): T[] {
  const asOf = asOfDate.toISOString().slice(0, 10);
  const winners = new Map<string, T>();

  for (const row of rows) {
    const employeeId = String(row.EMPL_ID ?? "").trim();
    if (!employeeId) continue;

    const effectiveDate = isoDate(row.EFFDT);
    if (isTerminated(row) && effectiveDate !== null && effectiveDate > asOf) {
      continue;
    }

    const current = winners.get(employeeId);
    if (!current || compareRosterEvents(row, current) > 0) {
      winners.set(employeeId, row);
    }
  }

  return Array.from(winners.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, row]) => row);
}

export function futureTermEmployeeIds<T extends RosterEventRow>(
  rows: readonly T[],
  asOfDate: Date = new Date(),
): string[] {
  const asOf = asOfDate.toISOString().slice(0, 10);
  const employeeIds = new Set<string>();

  for (const row of rows) {
    const employeeId = String(row.EMPL_ID ?? "").trim();
    const effectiveDate = isoDate(row.EFFDT);
    if (
      employeeId
      && isTerminated(row)
      && effectiveDate !== null
      && effectiveDate > asOf
    ) {
      employeeIds.add(employeeId);
    }
  }

  return Array.from(employeeIds).sort();
}