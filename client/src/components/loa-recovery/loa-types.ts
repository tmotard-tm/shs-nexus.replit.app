// LOA Recovery — shared types and helpers

export type LoaVehicleType = 'Company' | 'Rental' | 'BYOV' | 'Unknown';
export type LoaTaskState = Record<string, boolean>;
export type LoaQueueName = 'fleet' | 'assets' | 'inventory';

export interface LoaAddress {
  homeAddr1: string | null;
  homeAddr2: string | null;
  homeCity: string | null;
  homeState: string | null;
  homePostal: string | null;
}

export interface LoaTechInfo {
  lastKnownTruck: string | null;
  phone: string | null;
  primaryZip: string | null;
  address: LoaAddress;
  // Real email when one is known. The LOA sync does not populate this today, so
  // it is normally absent — the detail view shows "No email on file" rather than
  // fabricating a racfid@sears.com address.
  email?: string | null;
}

export interface LoaLeaveInfo {
  startDate: string | null;
  endDate: string | null;
  days: number;
  sfStatus: string | null;
}

export interface LoaItemData {
  enterpriseId: string;
  employeeNumber: string | null;
  techName: string;
  leave: LoaLeaveInfo;
  tech: LoaTechInfo;
  lane: string;
  loaTasks?: LoaTaskState;
  vehicleTypeOverride?: LoaVehicleType;
  // Day-30 recovery pause (Task #437). Stored in the queue-item data JSON so
  // the sync idempotency index (which keys on queue status) stays intact.
  recoveryPaused?: boolean;
  recoveryPausedAt?: string | null;
}

export interface LastDayBadge {
  text: string;
  kind: 'upcoming' | 'pre' | 'new' | 'past';
}

export interface LastDayInfo {
  date: string;
  badges: LastDayBadge[];
}

/** Parse the JSON data field of a LOA queue item safely. */
export function parseLoaData(item: { data?: string | null }): LoaItemData | null {
  try {
    if (!item.data) return null;
    return JSON.parse(item.data) as LoaItemData;
  } catch {
    return null;
  }
}

/** Infer vehicle type from item fields + data JSON. Manual override wins. */
export function inferVehicleType(item: {
  vehicleType?: string | null;
  isByov?: boolean | null;
  data?: string | null;
}): LoaVehicleType {
  const data = parseLoaData(item);

  // Manual override set by operator
  if (data?.vehicleTypeOverride) return data.vehicleTypeOverride;

  // Schema-level fields
  if (item.isByov) return 'BYOV';
  if (item.vehicleType === 'byov') return 'BYOV';
  if (item.vehicleType === 'rental') return 'Rental';
  if (item.vehicleType === 'company') return 'Company';

  // Infer from lastKnownTruck in data
  const truck = data?.tech?.lastKnownTruck;
  if (!truck || truck === '—' || truck.trim() === '') return 'Unknown';
  if (truck.toUpperCase().includes('BYOV')) return 'BYOV';
  // Any non-empty truck number → Company vehicle
  return 'Company';
}

/** How many days has the tech been on LOA (from startDate ISO string to today). */
export function daysOnLoa(startDate: string | null | undefined): number {
  if (!startDate) return 0;
  try {
    const start = new Date(startDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    start.setHours(0, 0, 0, 0);
    return Math.max(0, Math.floor((today.getTime() - start.getTime()) / 86400000));
  } catch {
    return 0;
  }
}

/**
 * Whether the Day-30 recovery pause toggle may be used for this case. Per spec
 * the toggle is only available once the leave is 30+ days AND we are within 7
 * days of Day 30 — i.e. today is on or after start + 23 calendar days. This is
 * the "return confirmed within 7 days of Day 30" window.
 */
export function canPauseRecovery(startDate: string | null | undefined, days: number): boolean {
  if (days < 30) return false;
  if (!startDate) return false;
  try {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const elapsed = Math.floor((today.getTime() - start.getTime()) / 86400000);
    return elapsed >= 23;
  } catch {
    return false;
  }
}

/** Format an ISO date string as "Mon D" (e.g. "Jun 5"). */
function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  } catch {
    return iso;
  }
}

/** Derive the Last Day display info (formatted date + PRE/New/PAST badges). */
export function getLastDayInfo(startDate: string | null | undefined): LastDayInfo {
  if (!startDate) return { date: '—', badges: [] };
  try {
    const dt = new Date(startDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    dt.setHours(0, 0, 0, 0);
    const diffDays = Math.round((dt.getTime() - today.getTime()) / 86400000);
    const formatted = fmtDate(startDate);

    if (diffDays > 0) {
      return {
        date: formatted,
        badges: [
          { text: 'Upcoming', kind: 'upcoming' },
          { text: 'PRE', kind: 'pre' },
        ],
      };
    }
    const badges: LastDayBadge[] = [];
    if (diffDays >= -8) badges.push({ text: 'New', kind: 'new' });
    badges.push({ text: 'PAST', kind: 'past' });
    return { date: formatted, badges };
  } catch {
    return { date: startDate, badges: [] };
  }
}

/** Map a LOA department string to LoaQueueName. */
export function departmentToLoaQueue(department: string | null | undefined): LoaQueueName | null {
  const d = (department || '').trim().toUpperCase();
  if (d === 'FLEET' || d === 'FLEET MANAGEMENT') return 'fleet';
  if (d === 'ASSETS MANAGEMENT') return 'assets';
  if (d === 'INVENTORY CONTROL') return 'inventory';
  return null;
}

export const LOA_QUEUE_META: Record<LoaQueueName, { label: string; short: string; color: string }> = {
  fleet:     { label: 'Fleet Management', short: 'Fleet',     color: '#F26A21' },
  assets:    { label: 'Assets Management', short: 'Assets',   color: '#22A84A' },
  inventory: { label: 'Inventory Control', short: 'Inventory', color: '#2B7FE0' },
};
