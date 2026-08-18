/**
 * Truck Maintenance SMS + 4-hour booking workflow — tunables, gates, and
 * messages. Task #676 additions: Enterprise-ID-based booking, 8-day request
 * window, approaching-threshold view, and confirmation follow-up text.
 *
 * Routine preventive maintenance is driven by the odometer: when a truck's
 * reconciled odometer runs MAINTENANCE_TRIGGER_MILES past the mileage at its
 * last maintenance cycle, the assigned technician gets a heads-up text and,
 * a few days later, a 4-hour "Truck Maintenance" block is filed on their
 * route through the Event Request (Standard Activities) API.
 *
 * Everything a human might retune lives HERE — one file, one place to look.
 */

/**
 * THE trigger. Notification AND scheduling both hang off this single number,
 * so retuning it moves them together (a text at 5,500 with a booking sweep
 * that still used 6,000 would text every truck twice).
 *
 * Set below the 6,000-mile service interval on purpose: the tech is texted at
 * +5,500, the block is filed a few days later, and the truck is actually
 * serviced at or around 6,000 miles once that lead time is spent.
 */
export const MAINTENANCE_TRIGGER_MILES = 5_500;

/**
 * Odometer sanity bounds — the SAME window the nightly odometer enrichment
 * applies when it reconciles Holman / Samsara / fuel-card readings
 * (server/snowflake-sync-service.ts). A reading outside this range is a data
 * error, not mileage: it must never open a cycle and must never become a
 * watermark.
 */
export const ODOMETER_MIN = 1_000;
export const ODOMETER_MAX = 600_000;

/** 4 hours, per the message the technician is sent. */
export const MAINTENANCE_BLOCK_DURATION_MIN = 240;

/**
 * How wide the scheduling window is. RequestedStartDate = trigger date,
 * RequestedEndDate = trigger date + this many days. The DCA scheduler picks
 * a concrete slot within the window; no single day is locked in by the
 * filing.
 */
export const MAINTENANCE_WINDOW_DAYS = 8;

/**
 * "A few days after the text." The booking is filed this many days after the
 * heads-up SMS actually went out (never after a dry-run preview).
 */
export function getMaintenanceBookingLeadDays(): number {
  const raw = Number.parseInt((process.env.TRUCK_MAINTENANCE_BOOKING_LEAD_DAYS ?? "").trim(), 10);
  if (Number.isFinite(raw) && raw >= 0 && raw <= 30) return raw;
  return 3;
}

/**
 * How many miles below the 5,500-mile trigger the approaching-threshold
 * early-warning view shows. A truck whose odometer-minus-watermark is
 * >= (MAINTENANCE_TRIGGER_MILES - N) but < MAINTENANCE_TRIGGER_MILES is
 * "approaching". Default 500 miles; range clamped 50–2,000.
 */
export function getMaintenanceApproachingMiles(): number {
  const raw = Number.parseInt((process.env.TRUCK_MAINTENANCE_APPROACHING_MILES ?? "").trim(), 10);
  if (Number.isFinite(raw) && raw >= 50 && raw <= 2_000) return raw;
  return 500;
}

/** Project-name prefix, and therefore the upstream 409 duplicate key. */
export const MAINTENANCE_PROJECT_LABEL = "Truck Maintenance";

/**
 * Per-message label in the Fleet Communications inbox for the confirmation
 * follow-up text. Separate from the heads-up category so opt-out and history
 * queries can distinguish the two message types.
 */
export const MAINTENANCE_CONFIRMATION_COMMS_CATEGORY = "truck_maintenance_confirmation";

/** Per-message label in the Fleet Communications inbox. */
export const MAINTENANCE_COMMS_CATEGORY = "truck_maintenance";

/**
 * Where the 4 hours land. Sent as BOTH StartTime and StartTimeRequest, which
 * is the documented way to pin a slot: the reference accepts "Start of Day",
 * "All Day", or an HH:MM echoed in StartTime. The movable-slot values earlier
 * builds used were invented locally, and "Start of Day" was rejected live for
 * technicians whose day start the receiving system could not resolve.
 *
 * Pinning costs this workflow nothing — the technician's text promises a
 * 4-hour block, never a time of day.
 */
export const MAINTENANCE_START_TIME = "08:00";

/** Project-level note on the filing. */
export const MAINTENANCE_PROJECT_NOTES =
  "Fleet routine maintenance. 4-hour block so the technician can take the truck "
  + "to their nearest Pep Boys (or equivalent) shop for its scheduled service.";

/**
 * ActivityType for a routine-maintenance block.
 *
 * UNCONFIRMED by the API owner — a maintenance block is not a rental return,
 * so it is NOT safe to inherit the rental-return activity type. The value must
 * come from the DCA side and be set explicitly in the environment; until it
 * is, isMaintenanceBookingLive() stays false and nothing is ever POSTed live.
 */
export function getMaintenanceActivityType(): string | null {
  const raw = (process.env.TRUCK_MAINTENANCE_ACTIVITY_TYPE ?? "").trim();
  return raw || null;
}

/** True only when the DCA-confirmed ActivityType has been configured. */
export function isMaintenanceActivityTypeConfirmed(): boolean {
  return getMaintenanceActivityType() !== null;
}

function flagOn(value: string | undefined): boolean {
  return /^(true|1|yes|on)$/i.test((value ?? "").trim());
}

/**
 * Live-SMS gate. OFF by default: with it off the send path still runs every
 * real check (phone, opt-out, quiet hours) as a dry run and records what
 * WOULD have gone out, but no technician is texted and the cycle does not
 * advance to `texted` — so arming the flag later still sends the first real
 * text for that cycle.
 *
 * Independent of the booking gate on purpose (one can be armed without the
 * other), and independent of COMMS_SEND_LIVE, which gates the comms module's
 * own API surface rather than this workflow.
 */
export function isMaintenanceSmsLive(): boolean {
  return flagOn(process.env.TRUCK_MAINTENANCE_SMS_LIVE);
}

/**
 * Live-booking gate. OFF by default, and additionally refuses to arm until
 * the ActivityType has been confirmed and configured — filing a real block
 * with a guessed activity type is exactly the "TEST 201s proved nothing"
 * failure the rental-return lane already paid for.
 *
 * With it off, the payload is BUILT and stored for inspection but never
 * POSTed (not even TEST-prefixed): an automated fleet-wide sweep would
 * otherwise litter the upstream system with hundreds of TEST projects. Use
 * the per-cycle test-filing escape hatch to smoke-test one row on the wire.
 */
export function isMaintenanceBookingLive(): boolean {
  return flagOn(process.env.TRUCK_MAINTENANCE_BOOKING_LIVE) && isMaintenanceActivityTypeConfirmed();
}

/**
 * The heads-up text. Wording is fixed by the task spec — do not paraphrase.
 */
export function buildMaintenanceMessage(enterpriseId: string, truckNumber: string): string {
  return (
    `Hi ${enterpriseId}, Your truck ${truckNumber} is due for a routine maintenance service. `
    + `We will be booking a 4 hour 'Truck Maintenance' slot for you in the coming days. `
    + `We ask you bring it in to your nearest Pep Boys repair shop or equivalent shop in order `
    + `to get its maintenance service done.`
  );
}

/**
 * Confirmation follow-up text sent once the booked slot is confirmed with a
 * concrete date and time. Wording is verbatim from the task spec (Luca,
 * 2026-08-18) — do not paraphrase.
 *
 * @param dateTime  Human-readable representation of the confirmed slot, e.g.
 *                  "Monday, September 1 at 08:00 AM". The caller formats it.
 */
export function buildMaintenanceConfirmationMessage(dateTime: string): string {
  return (
    `Your Truck Maintenance slot is scheduled for ${dateTime} — `
    + `You are required to bring you Sears van to the nearest PepBoys or equivalent shop `
    + `for an oil change and general maintenance service. `
    + `You can also call Holman at 1-800-CAR-CARE  to be directed to the nearest Pepboys `
    + `or equivalent repair shop. `
  );
}

/** Row-level Notes the technician and the dispatcher read on the block. */
export function buildMaintenanceRowNotes(truckNumber: string): string {
  return `Routine maintenance service for truck ${truckNumber} — Pep Boys or equivalent shop (tech's choice).`;
}
