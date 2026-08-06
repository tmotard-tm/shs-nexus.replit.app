import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMonthlyExpiryCounts,
  isCountableAssignedTruck,
  monthKeyFor,
} from '../client/src/pages/fleet-scope/registration-month-buckets';

// Fixed "today" so the 12-months-ahead cutoff and past/current flags are deterministic.
const TODAY = new Date(2026, 7, 6); // Aug 6, 2026

const truck = (truckNumber: string, regExpDate: string | null, assignmentStatus = 'Assigned') => ({
  truckNumber,
  assignmentStatus,
  regExpDate,
});

test('each truck counts exactly once, in its natural month (no Jan 2026 special case)', () => {
  const trucks = [
    truck('10001', '2025-11-15'), // pre-2026 expired
    truck('10002', '2025-12-01'), // pre-2026 expired
    truck('10003', '2026-01-20'), // genuinely expires Jan 2026
    truck('10004', '2026-08-10'), // current month
    truck('10005', '2026-09-05'), // future
  ];
  const buckets = buildMonthlyExpiryCounts(trucks, TODAY);

  const byKey = Object.fromEntries(buckets.map(b => [b.key, b]));
  assert.equal(byKey['2025-11'].count, 1);
  assert.equal(byKey['2025-12'].count, 1);
  assert.equal(byKey['2026-01'].count, 1); // NOT inflated with pre-2026 trucks
  assert.equal(byKey['2026-08'].count, 1);
  assert.equal(byKey['2026-09'].count, 1);

  // Totals add up to trucks with an expiry — no double counting.
  const total = buckets.reduce((s, b) => s + b.count, 0);
  assert.equal(total, trucks.length);

  // No "(Expired)" relabeling anywhere.
  assert.ok(buckets.every(b => !b.label.includes('Expired')));
  assert.equal(byKey['2026-01'].label, 'Jan 2026');
});

test('past months are flagged isPast (Overdue pill), current month isCurrent', () => {
  const buckets = buildMonthlyExpiryCounts(
    [truck('1', '2025-11-15'), truck('2', '2026-01-20'), truck('3', '2026-08-10'), truck('4', '2026-09-05')],
    TODAY,
  );
  const byKey = Object.fromEntries(buckets.map(b => [b.key, b]));
  assert.equal(byKey['2025-11'].isPast, true);
  assert.equal(byKey['2026-01'].isPast, true);
  assert.equal(byKey['2026-08'].isPast, false);
  assert.equal(byKey['2026-08'].isCurrent, true);
  assert.equal(byKey['2026-09'].isPast, false);
  assert.equal(byKey['2026-09'].isCurrent, false);
});

test('future months cut off at 12 months ahead; all past months kept; sorted ascending', () => {
  const buckets = buildMonthlyExpiryCounts(
    [
      truck('1', '2024-03-01'), // far past — kept
      truck('2', '2027-08-01'), // exactly 12 months ahead — kept
      truck('3', '2027-09-15'), // beyond cutoff — dropped
    ],
    TODAY,
  );
  assert.deepEqual(buckets.map(b => b.key), ['2024-03', '2027-08']);
  const times = buckets.map(b => b.date.getTime());
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
});

test('exclusions: unassigned, BYOV 088 prefix (raw, pre-padding), missing/invalid dates', () => {
  const buckets = buildMonthlyExpiryCounts(
    [
      truck('20001', '2026-09-01', 'Unassigned'),
      truck('08812', '2026-09-01'), // BYOV
      truck('20002', null),
      truck('20003', 'not-a-date'),
      truck('88144', '2026-09-01'), // 5-digit BYOV-style but no leading 088 raw — counted (matches existing card behavior)
    ],
    TODAY,
  );
  assert.deepEqual(buckets.map(b => [b.key, b.count]), [['2026-09', 1]]);
  assert.equal(isCountableAssignedTruck(truck('08812', '2026-09-01')), false);
});

test('monthKeyFor pads months', () => {
  assert.equal(monthKeyFor(new Date(2026, 0, 20)), '2026-01');
  assert.equal(monthKeyFor(new Date(2026, 11, 2)), '2026-12');
});
