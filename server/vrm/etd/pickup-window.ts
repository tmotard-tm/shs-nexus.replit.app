/**
 * When can this technician actually collect a car today, and when can they not.
 *
 * This lives in its own leaf module for one reason: the answer has to be the
 * same everywhere. The schedule gate once had four homes, each lying slightly
 * differently, and this cutoff is exactly that shape of rule. The booking
 * preview decides the real pickup day from it, and the approval SMS has to
 * promise the same day, so both import from here and neither reimplements it.
 *
 * Nothing in this file touches the database, the network, or the clock except
 * through the `now` argument, so it is testable at any hour.
 */

/** Minutes of head start a technician needs before a quoted pickup. */
export const LEAD_MINUTES = 90;

/** Counters do not hand over cars before this. A 3am quote gets an empty class list. */
export const EARLIEST_MIN = 9 * 60;

/**
 * The latest slot a branch will realistically hand over a car.
 *
 * Capping at 18:00 and staying on today was the original behaviour and it
 * quoted 6pm at branches that shut at 5:30. Enterprise answers that with an
 * EMPTY class list and no warning, which surfaced as `class_unmapped` and read
 * as a vehicle problem rather than an opening-hours one. Roll the day instead.
 */
export const LAST_PICKUP_MIN = 16 * 60 + 30;

/**
 * Floor a wanted pickup time to "not before now, plus a lead", in Eastern.
 *
 * ET is the floor reference on purpose. Every US branch is at or west of
 * Eastern, so an ET-derived time is never in the past locally; the worst case
 * is booking a technician later in their own day than strictly necessary,
 * which is safe. The hour is taken % 24 because Intl with hour12:false renders
 * midnight as "24".
 *
 * Returns `nextDay: true` when the floor lands past the last realistic pickup,
 * meaning the caller must move to the following day at 09:00.
 */
export function notBeforeNowET(
  wanted: string,
  now: Date = new Date(),
  leadMinutes = LEAD_MINUTES,
): { time: string; nextDay: boolean } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hh = Number(parts.find((x) => x.type === "hour")?.value ?? "0") % 24;
  const mm = Number(parts.find((x) => x.type === "minute")?.value ?? "0");
  const m = /^(\d{1,2}):(\d{2})/.exec(String(wanted));
  const wantMin = m ? Number(m[1]) * 60 + Number(m[2]) : 9 * 60;
  let floorMin = hh * 60 + mm + leadMinutes;
  floorMin = Math.ceil(floorMin / 30) * 30;
  const use = Math.max(wantMin, floorMin, EARLIEST_MIN);
  if (use > LAST_PICKUP_MIN) return { time: "09:00:00", nextDay: true };
  const H = String(Math.floor(use / 60)).padStart(2, "0");
  const M = String(use % 60).padStart(2, "0");
  return { time: `${H}:${M}:00`, nextDay: false };
}

/** ISO date plus n days, calendar only. Mirrors the orchestrator's own helper. */
function plusDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The day and time a pickup will REALLY be quoted for.
 *
 * Only today's date needs flooring; a future date is already whatever was
 * asked for. `rolled` is the flag callers must surface — a silent roll is how
 * a technician gets told "pickup today" for a reservation that is tomorrow.
 */
export function resolvePickupWindow(args: {
  dayISO: string;
  wantedTime: string;
  todayISO: string;
  now?: Date;
}): { day: string; time: string; rolled: boolean } {
  const { dayISO, wantedTime, todayISO } = args;
  if (!dayISO || dayISO !== todayISO) {
    return { day: dayISO, time: wantedTime, rolled: false };
  }
  const floored = notBeforeNowET(wantedTime, args.now ?? new Date());
  return {
    day: floored.nextDay ? plusDays(dayISO, 1) : dayISO,
    time: floored.time,
    rolled: floored.nextDay,
  };
}
