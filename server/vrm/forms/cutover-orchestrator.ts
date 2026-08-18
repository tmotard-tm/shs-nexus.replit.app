/**
 * Cutover workflow orchestrator — every external effect of the Rental Survey
 * cutover buttons (and the rental-request sibling lane) is owned here by an
 * immutable INTENT row (vrm_rental_workflow_intents), persisted BEFORE it is
 * attempted, and verified by named readbacks.
 *
 * Plan of record: .local/tasks/cutover-workflow-survey-buttons.md (3rd pass,
 * approved 2026-08-16). Binding rules implemented here:
 *
 *   - Intent identity controls every action. After creation, ALL mutations
 *     address :intentId. No :ldap mutation routes.
 *   - 8-condition server-side eligibility gate re-run at Queue, at Confirm,
 *     and immediately before booking. The client can never override.
 *   - ServicePower schedule gate is REQUIRED (working day + <=26h watermark).
 *     Never default an unchecked tech to tomorrow.
 *   - Preview is persisted and immutable (version/hash/expiry). Confirm is a
 *     CAS on the exact submitted preview_version.
 *   - ETD ops are persisted before the call. Timeout/ambiguous => booking_unknown
 *     (NONTERMINAL, holds the live lock, never auto-retried).
 *   - ART block: flag VRM_CONTRACT_BLOCK_ENABLED (NOT LUCA_ROUTE_BLOCK_ENABLED).
 *     409 => block_conflict_pending_readback; readback only from a snapshot
 *     loaded AFTER block_submitted_at.
 *   - Msg1 releases only on reservation_verified + real-2xx block_accepted.
 *     Msg2 is HELD (undrainable queue status) until block_verified.
 *   - Quiet hours: existing getNextAllowedSendTime, never force-bypassed.
 *   - DARK BUILD: execution_mode defaults to dry_run; live intents require the
 *     (unarmed) flag; TEST/dry intents never advance live state.
 *
 * Pure classification/rendering functions are exported for unit tests.
 */

import crypto from "crypto";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import {
  sendStandardActivity,
  buildStandardActivityPayload,
  type StandardActivityArgs,
} from "../dca-task-client";
import { sendMessage } from "../../fleet-comms/outbound";
import { getNextAllowedSendTime, localHourToUtc, stateTimeZone } from "../../fleet-scope-reg-messaging";
import {
  initializeSnowflakeService,
  getSnowflakeService,
  isSnowflakeConfigured,
} from "../../snowflake-service";

// ---------------------------------------------------------------------------
// Constants & flag
// ---------------------------------------------------------------------------

export const WORKFLOW_CUTOVER = "cutover_survey";
export const WORKFLOW_REQUEST = "rental_request";

export const EXECUTION_MODES = new Set(["dry_run", "test", "live"]);
export const TERMINAL_STATUSES = new Set(["completed", "cancelled", "abandoned"]);

/** Statuses a booking-queue claim may pick up for the BOOK lane. */
const BOOKABLE_STATUSES = new Set(["confirmed", "booking"]);

export const COMMS_CATEGORY = "rental_management";

/**
 * Dedicated arming flag for THIS workflow's live ART filings. Deliberately not
 * LUCA_ROUTE_BLOCK_ENABLED — that flag stays owned by the LUCA scheduling lane
 * (plan §ART). Default (unset/anything but a truthy literal) = NOT live.
 */
export function isContractBlockLive(): boolean {
  const raw = String(process.env.VRM_CONTRACT_BLOCK_ENABLED ?? "").trim().toLowerCase();
  return /^(1|true|yes|on)$/.test(raw);
}

/**
 * The execution mode used when a caller does not specify one: LIVE once the
 * workflow is armed (owner-validated, production), dry_run while dark. An
 * explicit executionMode from the caller always wins over this default.
 */
export function defaultExecutionMode(): "live" | "dry_run" {
  return isContractBlockLive() ? "live" : "dry_run";
}

/**
 * 14-item absence list — the approved schedule policy (repair spec §8). ONLY
 * these ACTIVITY_TYPE_DESCRIPTION values mean the tech is NOT working that
 * day. Working-day signals observed in the live enumeration — huddles, part
 * pickups, D2C/B2B routing, trainings, Vehicle-* blocks, Standby, Weather,
 * Swap Day, VRS Flex Day, Demand-Driven Adjustment, Accident/Drug Test
 * Impact — must NEVER appear here: a tech under any of those is still at
 * work and reachable for a cutover. Compared case-insensitively on
 * collapsed whitespace. This set is the SINGLE source of truth — the Python
 * runner has no list of its own (it calls the server's /schedule-check).
 */
export const ABSENCE_ACTIVITIES: ReadonlySet<string> = new Set(
  [
    "Vacation",
    "Personal Holiday",
    "Unpaid Time Off",
    "Sickness",
    "WD Sick Time",
    "Intermittent LOA",
    "No Call No show",
    "Day Off In Lieu Of Holiday",
    "Policy Time Off",
    "Holiday",
    "Jury Duty",
    "Bereavement",
    "Leave of Absence",
    "Suspension",
  ].map((s) => normalizeActivity(s)),
);

const SCHEDULE_TABLE = "PRD_SERVICEPOWER.BATCH_TBLS.SCH_ACTIVITIES_PROD";
export const WATERMARK_MAX_AGE_HOURS = 26;

/** Verified block-readback tokens (plan §ART): exact normalized matches. */
export const BLOCK_ACTIVITY_TOKEN = "vehicle - change";
export const BLOCK_START_TIME_TOKEN = "08:00:00";

/**
 * Quiet-hours EXCEPTION states for preview display flags (verified at HEAD in
 * fleet-scope-reg-messaging: FL/CT/MD/OK/WA block until 08:00 local, TX until
 * 09:00 / Sun 12:00; general states allow 07:00). Actual send times ALWAYS
 * come from getNextAllowedSendTime at send/release time — this map is only the
 * preview annotation Tyler asked for.
 */
export const QUIET_EXCEPTION_STATES: Record<string, string> = {
  FL: "08:00",
  CT: "08:00",
  MD: "08:00",
  OK: "08:00",
  WA: "08:00",
  TX: "09:00 (Sun 12:00)",
};

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

export function normalizeActivity(v: unknown): string {
  return String(v ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function zip5(v: unknown): string {
  const m = String(v ?? "").match(/\d{5}/);
  return m ? m[0] : "";
}

export function digitsOnly(v: unknown): string {
  return String(v ?? "").replace(/[^0-9]/g, "");
}

/** Truck numbers compared on digits with leading zeros stripped. */
export function normTruck(v: unknown): string {
  const digits = digitsOnly(v).replace(/^0+/, "");
  return digits || String(v ?? "").trim().toUpperCase();
}

/** Survey truck values that are SILENCE, not contradiction (plan gate #5). */
export function isTruckSilence(v: unknown): boolean {
  const raw = String(v ?? "").trim().toLowerCase();
  if (!raw || raw === "n/a" || raw === "na" || raw === "none" || raw === "unknown") return true;
  const digits = digitsOnly(raw);
  if (digits && /^0+$/.test(digits)) return true;
  return false;
}

/** Stable stringify (sorted keys) so the preview hash is deterministic. */
export function stableStringify(value: unknown): string {
  const seen = new WeakSet();
  const norm = (v: any): any => {
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v)) return "[circular]";
    seen.add(v);
    if (Array.isArray(v)) return v.map(norm);
    const out: Record<string, any> = {};
    for (const k of Object.keys(v).sort()) out[k] = norm(v[k]);
    return out;
  };
  return JSON.stringify(norm(value));
}

export function previewHash(preview: unknown): string {
  return crypto.createHash("sha256").update(stableStringify(preview)).digest("hex");
}

/** Calendar date (YYYY-MM-DD) in ET — schedule/event dates are ET calendar days. */
export function etTodayISO(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`); // noon UTC avoids DST edge underflow
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Schedule gate (pure classification over fetched rows)
// ---------------------------------------------------------------------------

export type ScheduleDayRow = {
  day: string; // YYYY-MM-DD
  maxAvail: number | null;
  activities: string[]; // raw descriptions (already deduped per day)
  snapshotTs: string; // CREATED_TS_DW of the newest load carrying this day
};

export type ScheduleDay = {
  date: string;
  hasShift: boolean;
  absences: string[];
  working: boolean;
  snapshotTs: string;
};

export function classifyScheduleDays(rows: ScheduleDayRow[]): ScheduleDay[] {
  return rows
    .map((r) => {
      const absences = r.activities.filter((a) => ABSENCE_ACTIVITIES.has(normalizeActivity(a)));
      const hasShift = typeof r.maxAvail === "number" && r.maxAvail > 0;
      return {
        date: r.day,
        hasShift,
        absences,
        working: hasShift && absences.length === 0,
        snapshotTs: r.snapshotTs,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** First working day ON OR AFTER minDateISO; null when none in the window. */
export function firstWorkingDay(days: ScheduleDay[], minDateISO: string): string | null {
  for (const d of days) {
    if (d.date >= minDateISO && d.working) return d.date;
  }
  return null;
}

export function watermarkAgeHours(watermarkUtc: string | Date | null, now: Date = new Date()): number | null {
  if (!watermarkUtc) return null;
  const ts = new Date(watermarkUtc).getTime();
  if (!Number.isFinite(ts)) return null;
  return (now.getTime() - ts) / 3_600_000;
}

/**
 * Age (hours) of the snapshot that actually carries ONE schedule day for ONE
 * technician (repair spec §8): the freshness gate must judge the per-tech
 * per-day snapshot, not only the table-global watermark — a tech missing
 * from last night's load would otherwise pass on the table's freshness.
 * Accepts CREATED_TS_DW strings with or without a trailing Z (UTC either
 * way); returns null when unparseable — callers treat null as STALE.
 */
export function scheduleDaySnapshotAgeHours(
  day: { snapshotTs: string } | null | undefined,
  now: Date = new Date(),
): number | null {
  const raw = String(day?.snapshotTs ?? "").trim();
  if (!raw) return null;
  const iso = raw.replace(" ", "T") + (raw.endsWith("Z") ? "" : "Z");
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return null;
  return (now.getTime() - ts) / 3_600_000;
}

// ---------------------------------------------------------------------------
// Readback classifiers (pure)
// ---------------------------------------------------------------------------

export type JourneyMatch = {
  confirmation?: string | null;
  reference?: string | null; // renter/reference field carrying the LDAP
  branchCode?: string | null;
  date?: string | null; // pickup date YYYY-MM-DD
  sipp?: string | null;
};

export type JourneyExpected = {
  confirmation: string;
  ldap: string;
  /** Unique intent reference (SHSNX-{id}); when set, the reservation's reference field must carry it. */
  intentRef?: string | null;
  branchCode?: string | null;
  date?: string | null;
  sipp?: string | null;
};

/**
 * STRICT identity verification (repair spec §3): every field — confirmation,
 * LDAP-carrying reference, branch, date, class — must be PRESENT on both the
 * expected side and the reservation side AND match. A missing value on either
 * side is a named mismatch, never a silent pass: a sparse ETD row (or a
 * sparse expected object) must not be able to "verify" a reservation.
 *
 * `matches` is the runner's POSITIVELY IDENTIFIED set — rows carrying this
 * intent's SHS reference or a confirmation known to be its own — never "every
 * row the search returned". That is what keeps `multiple` meaningful: it means
 * two reservations both claim to be this intent's, which a human must resolve.
 * An empty set is `none` ("nothing identifiable was found"), and whether that
 * none is authoritative is decided by the caller from the search meta.
 */
export function classifyJourneyReadback(
  expected: JourneyExpected,
  matches: JourneyMatch[],
): { verdict: "verified" | "none" | "multiple" | "mismatch"; reason: string } {
  if (!Array.isArray(matches) || matches.length === 0) {
    return { verdict: "none", reason: "journey search identified no reservation belonging to this intent" };
  }
  if (matches.length > 1) {
    return {
      verdict: "multiple",
      reason: `${matches.length} reservations identify as this intent's; exactly one required`,
    };
  }
  const m = matches[0];
  const diffs: string[] = [];
  const norm = (v: unknown) => String(v ?? "").trim().toUpperCase();

  const requireBoth = (name: string, exp: unknown, got: unknown) => {
    const e = norm(exp);
    const g = norm(got);
    if (!e) diffs.push(`${name}: no expected value on the intent side`);
    else if (!g) diffs.push(`${name}: reservation carries no value (expected ${String(exp).trim()})`);
    else if (e !== g) diffs.push(`${name} ${String(got).trim()} != ${String(exp).trim()}`);
  };

  requireBoth("confirmation", expected.confirmation, m.confirmation);

  // Reference is containment, not equality — ETD folds LDAP and the intent
  // reference into one free-text field. Both must be present and found.
  const ref = norm(m.reference);
  if (!norm(expected.ldap)) {
    diffs.push("ldap: no expected value on the intent side");
  } else if (!ref) {
    diffs.push(`reference: reservation carries no reference (expected LDAP ${expected.ldap})`);
  } else if (!ref.includes(norm(expected.ldap))) {
    diffs.push(`reference '${m.reference}' does not carry LDAP ${expected.ldap}`);
  }
  const intentRef = norm(expected.intentRef);
  if (intentRef) {
    if (!ref) diffs.push(`reference: reservation carries no reference (expected intent ref ${expected.intentRef})`);
    else if (!ref.includes(intentRef)) diffs.push(`reference '${m.reference}' does not carry intent ref ${expected.intentRef}`);
  }

  requireBoth("branch", expected.branchCode, m.branchCode);

  const expDate = String(expected.date ?? "").slice(0, 10);
  const gotDate = String(m.date ?? "").slice(0, 10);
  if (!expDate) diffs.push("date: no expected value on the intent side");
  else if (!gotDate) diffs.push(`date: reservation carries no pickup date (expected ${expDate})`);
  else if (expDate !== gotDate) diffs.push(`date ${gotDate} != ${expDate}`);

  requireBoth("class", expected.sipp, m.sipp);

  if (diffs.length) return { verdict: "mismatch", reason: diffs.join("; ") };
  return { verdict: "verified", reason: "exactly one reservation matched all expected fields (strict presence + match)" };
}

export type BlockReadbackRow = {
  activity: string | null;
  startTime: string | null; // HH:MM:SS
  postcode: string | null;
  snapshotTs: string; // CREATED_TS_DW
};

/**
 * Plan §ART readback: only a snapshot loaded AFTER block_submitted_at can
 * verify or fail a block; an older snapshot is verification_pending, never
 * failed. Exact normalized matches on activity token, 08:00:00 and ZIP5.
 */
export function classifyBlockReadback(params: {
  rows: BlockReadbackRow[];
  blockSubmittedAt: string | Date;
  expectedZip5: string;
  globalWatermark: string | Date | null;
}): { verdict: "block_verified" | "verification_pending" | "manual_repair"; reason: string } {
  const submitted = new Date(params.blockSubmittedAt).getTime();
  const wm = params.globalWatermark ? new Date(params.globalWatermark).getTime() : null;

  const fresh = (ts: string) => new Date(ts).getTime() > submitted;

  const candidates = params.rows.filter(
    (r) =>
      normalizeActivity(r.activity) === BLOCK_ACTIVITY_TOKEN &&
      String(r.startTime ?? "").trim() === BLOCK_START_TIME_TOKEN &&
      zip5(r.postcode) === params.expectedZip5,
  );

  if (candidates.some((r) => fresh(r.snapshotTs))) {
    return { verdict: "block_verified", reason: "matching Vehicle - Change 08:00:00 block present in a post-submission snapshot" };
  }
  if (candidates.length > 0) {
    // Matched, but only in a snapshot loaded before we filed — cannot verify from it.
    return { verdict: "verification_pending", reason: "match exists only in a pre-submission snapshot; awaiting next load" };
  }

  const anyFreshRows = params.rows.some((r) => fresh(r.snapshotTs));
  const watermarkFresh = wm !== null && wm > submitted;
  if (!anyFreshRows && !watermarkFresh) {
    return { verdict: "verification_pending", reason: "no snapshot loaded after block submission yet" };
  }

  // A fresh snapshot exists (rows for the day, or the load ran) and the block
  // is absent/mismatched in it.
  const near = params.rows
    .filter((r) => fresh(r.snapshotTs))
    .map((r) => `${r.activity ?? "-"}@${r.startTime ?? "-"}/${zip5(r.postcode) || "-"}`)
    .slice(0, 6);
  return {
    verdict: "manual_repair",
    reason: `fresh snapshot has no matching block (saw: ${near.join(", ") || "no rows for the day"})`,
  };
}

// ---------------------------------------------------------------------------
// Rendering (pure) — exact skeletons from the approved plan
// ---------------------------------------------------------------------------

export function renderSpecialNotes(f: {
  tpmsTruck: string;
  ecars: string;
  claim?: string | null;
  rentalStartDate?: string | null;
  year?: string | null;
  make?: string | null;
  model?: string | null;
  sipp: string;
  ldap: string;
}): string {
  const claimClause = f.claim && String(f.claim).trim() ? ` (Holman/ARI claim ${String(f.claim).trim()})` : "";
  const opened = f.rentalStartDate ? `, opened ${f.rentalStartDate},` : ",";
  const vehicle = [f.year, f.make, f.model].filter(Boolean).join(" ") || "vehicle";
  return (
    `SHS TRUCK ${f.tpmsTruck}. SHS FLEET - DIRECT BILLING CHANGEOVER. ` +
    `This reservation REPLACES the rental this technician is already in. ` +
    `CLOSE Enterprise ticket ${f.ecars}${claimClause}${opened} and re-sign the technician ` +
    `under TransformCo direct billing. NO VEHICLE CHANGE: the technician keeps the ${vehicle} ` +
    `they are already driving. Reserved ${f.sipp} to match. Technician LDAP ${f.ldap}. ` +
    `Questions: SHS Fleet.`
  );
}

/**
 * Request-lane special notes (Tyler, 2026-08-16): the truck number rides in
 * the reservation's special notes, and the LDAP rides in the additional
 * billing field (set_driver fills the template's isBillingRef "LDAP"
 * additional-information field; this note is the branch-visible copy). A NEW
 * rental, so none of the cutover's CHANGEOVER language: there is no prior
 * Enterprise ticket to close and no vehicle to keep.
 */
export function renderRequestSpecialNotes(f: { truck: string | null; ldap: string }): string {
  return (
    `SHS TRUCK ${String(f.truck ?? "").trim() || "n/a"}. SHS FLEET - DIRECT BILLING. ` +
    `New rental approved by SHS Fleet for a technician whose assigned vehicle is off the road. ` +
    `Technician LDAP ${f.ldap}. Bill direct to TransformCo. Questions: SHS Fleet.`
  );
}

/**
 * Request-lane msg1. A NEW rental, so none of the cutover's language: there is no
 * prior agreement to close, no vehicle to keep, and no route block to attend. The
 * technician is waiting on a car, so this is the whole message: number, where,
 * when, what to bring, and that they must not pay.
 */
/**
 * ETD returns an address as one comma-jammed uppercase run with a ZIP+4 and no state:
 * "635 S BAY RD,DOVER,19901-4601". A technician has to read this on a phone and get to
 * it, so it is spaced, title-cased and trimmed to a 5-digit ZIP. Nothing is invented -
 * if ETD did not give us a state, none is added.
 */
export function formatBranchAddress(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  // `length <= 2` would have preserved RD/ST/DR/LN as shouty abbreviations. Only a
  // single character (the N/S/E/W directionals) is kept verbatim; a two-letter segment
  // standing alone is a state code and stays uppercase.
  const titled = (w: string) =>
    /\d/.test(w) || w.length === 1 ? w : w[0] + w.slice(1).toLowerCase();
  return s
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (/^\d{5}(-\d{4})?$/.test(part)) return part.slice(0, 5);
      if (/^[A-Za-z]{2}$/.test(part)) return part.toUpperCase();
      return part.split(/\s+/).map(titled).join(" ");
    })
    .join(", ");
}

/** 2026-08-18 -> "Tue 8/18". The day name matters when someone is stranded. */
function usDayDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!m) return usDate(iso);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  return `${day} ${usDate(iso)}`;
}

export function renderRequestMsg1(f: {
  conf: string;
  branchName: string;
  branchAddress: string;
  branchPhone?: string | null;
  pickupDate?: string | null;
  pickupTime?: string | null;
  returnDate?: string | null;
}): string {
  const when = f.pickupDate
    ? `${usDayDate(f.pickupDate)}${f.pickupTime ? ` from ${usTime(f.pickupTime)}` : ""}`
    : "today";
  const addr = formatBranchAddress(f.branchAddress);
  const back = f.returnDate
    ? ` Return by ${usDayDate(f.returnDate)} - reply here if you need it longer, do not extend it yourself.`
    : "";
  const branchLine = f.branchPhone ? ` Branch: ${f.branchPhone}.` : "";
  return (
    `SHS Fleet: your rental is booked. Confirmation ${f.conf}. ` +
    `Pick up ${when} at Enterprise ${f.branchName}, ${addr}.${branchLine} ` +
    `Bring your driver's license, give them the confirmation number, and sign nothing that asks you to pay. ` +
    `It is billed direct to Sears - decline all insurance and upgrades. ` +
    `ALREADY IN A RENTAL you got through Holman? Do not start a second one. Take that vehicle to this same ` +
    `branch and have them swap it onto this new reservation number.` +
    `${back} If the branch cannot find the reservation or turns you away, reply here before you leave.`
  );
}

/** 2026-08-18 -> 8/18. The technician does not read ISO. */
function usDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  return m ? `${Number(m[2])}/${Number(m[3])}` : String(iso);
}

/** 09:00:00 -> 9:00 AM. */
function usTime(t: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t));
  if (!m) return String(t);
  const h = Number(m[1]);
  const ap = h < 12 ? "AM" : "PM";
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${ap}`;
}

/** Draft bodies (plan §Messages). EXACT rendered text appears in Preview; live arming requires Tyler's approval. */
/**
 * The cutover instruction text, approved by Tyler 2026-08-17 and first sent to AELSER
 * that evening. Three things the previous version got wrong and this fixes:
 *
 *   - the confirmation number was the literal string "(assigned at booking)"
 *   - the branch was named but never addressed, so nobody could navigate to it
 *   - it never said what happens at the counter, which is the technician's actual
 *     question: do I lose my vehicle, do I pay, how long does this take
 *
 * `firstName` and `dayLabel` are passed in rather than derived here so the sender owns
 * the technician's own name and their own block date.
 */
export function renderMsg1(f: {
  conf: string;
  branchName: string;
  branchAddress: string;
  firstName?: string;
  dayLabel?: string;
}): string {
  const who = f.firstName ? `Hi ${f.firstName}, this is` : "This is";
  const when = f.dayLabel ?? "Tomorrow";
  return (
    `${who} Sears Fleet. ${when}, we have blocked the first 30 minutes of your route, ` +
    `8:00 AM, for you to stop at Enterprise ${f.branchName}, ${f.branchAddress}. ` +
    `Confirmation ${f.conf}.\n\n` +
    `You keep the vehicle you are driving. This is a billing change only. The branch will ` +
    `close your current Holman agreement and re-sign the same vehicle under Sears direct ` +
    `billing. Bring your driver's license. There is nothing for you to pay and nothing to ` +
    `hand back. It usually takes about 15 minutes.\n\n` +
    `If you have any issue and need immediate help, reach out to an agent in Sasha. Reply ` +
    `back here with an update once it is completed. This inbox is monitored throughout the ` +
    `day but not constantly.`
  );
}

export function renderMsg2(f: { conf: string; branchName: string; branchAddress: string }): string {
  return (
    `SHS Fleet reminder: today's 8:00 AM block — Enterprise ${f.branchName}, ${f.branchAddress}, ` +
    `confirmation ${f.conf}. You keep your current vehicle; billing-only change (old agreement closed ` +
    `and re-signed under Sears direct billing). Reply here with questions.`
  );
}

// ---------------------------------------------------------------------------
// Display phase + completion (pure)
// ---------------------------------------------------------------------------

export function deriveDisplayPhase(row: {
  status: string;
  workflow_type?: string | null;
  reservation_state?: string | null;
  block_state?: string | null;
  msg1_state?: string | null;
  msg2_state?: string | null;
}): string {
  const s = row.status;
  if (TERMINAL_STATUSES.has(s)) return s;
  if (s === "manual_review" || s === "preview_required" || s === "booking_unknown" || s === "block_conflict_pending_readback" || s === "cancel_pending_readback") {
    return s;
  }
  // Rental-request BOOKING workflow: route blocks and tech texts are
  // cutover-only (Tyler 2026-08-16). Booking is the whole lifecycle — never
  // surface a block phase for a request.
  if (row.workflow_type === WORKFLOW_REQUEST) {
    return row.reservation_state === "verified" ? "wrapping_up" : s;
  }
  if (row.block_state === "manual_repair") return "block_manual_repair";
  if (row.reservation_state === "verified") {
    if (row.block_state === "verified") return row.msg2_state === "released" || row.msg2_state === "sent" ? "wrapping_up" : "awaiting_msg2_release";
    if (row.block_state === "accepted" || row.block_state === "verification_pending") return "awaiting_block_verification";
    return "filing_block";
  }
  return s;
}

export function completionSatisfied(row: {
  workflow_type?: string | null;
  reservation_state?: string | null;
  block_state?: string | null;
  msg1_state?: string | null;
  msg2_state?: string | null;
}): boolean {
  // The request workflow completes on its verified reservation alone: route
  // blocks are cutover-only (Tyler 2026-08-16) and request SMS is a separate
  // unapproved feature — if Tyler later approves request texts, their msg
  // conditions join HERE.
  if (row.workflow_type === WORKFLOW_REQUEST) {
    return row.reservation_state === "verified";
  }
  return (
    row.reservation_state === "verified" &&
    row.block_state === "verified" &&
    (row.msg1_state === "sent" || row.msg1_state === "queued" || row.msg1_state === "released") &&
    (row.msg2_state === "released" || row.msg2_state === "sent")
  );
}

// ---------------------------------------------------------------------------
// Eligibility gate — facts fetch (impure) + evaluation (pure)
// ---------------------------------------------------------------------------

export type EligibilityFacts = {
  workflowType: string;
  sourceId: string;
  ldap: string;
  techName: string | null;
  // survey / request source
  sourceRow: any | null;
  newerResponseExists: boolean;
  surveyEligible: boolean; // has_rental + van_status rules (cutover)
  // consumption
  otherNonterminalIntentId: number | null;
  cutoverAlreadyBooked: boolean;
  // roster
  // jobTitle is the roster's trade and the ONLY trustworthy HVAC signal; the
  // request form's hvacCarveOut checkbox is self-declared and JGATES2 left it blank.
  roster: { employmentStatus: string | null; dropped: boolean; districtNo: string | null; employeeId: string | null; techName: string | null; jobTitle: string | null } | null;
  // tpms
  tpmsTruck: string | null;
  truckContradiction: string | null; // description when survey contradicts TPMS
  // enterprise case (cutover only)
  openCaseCount: number;
  caseKey: string | null;
  caseFacts: {
    vehicleNumber: string | null;
    rentingBranch: string | null;
    rentingCity: string | null;
    rentingState: string | null;
    ecars: string | null;
    claim: string | null;
    year: string | null;
    make: string | null;
    model: string | null;
    rentalStartDate: string | null;
    vendor: string | null;
  } | null;
  // contact
  contactPhone: string | null;
  contactState: string | null;
  requestFallbackPhone: string | null; // request path only
};

export type EligibilityFailure = { code: string; detail: string };

export function evaluateEligibility(f: EligibilityFacts): { ok: boolean; failures: EligibilityFailure[] } {
  const failures: EligibilityFailure[] = [];
  const isCutover = f.workflowType === WORKFLOW_CUTOVER;

  if (!f.sourceRow) failures.push({ code: "source_missing", detail: "bound source record no longer exists" });

  // 1. response still current
  if (isCutover && f.newerResponseExists) {
    failures.push({ code: "response_superseded", detail: "a newer survey response exists for this technician" });
  }
  // 2. still open / unconsumed
  if (f.otherNonterminalIntentId) {
    failures.push({ code: "intent_conflict", detail: `another nonterminal intent #${f.otherNonterminalIntentId} exists for this LDAP` });
  }
  if (isCutover && f.cutoverAlreadyBooked) {
    failures.push({ code: "already_booked", detail: "cutover tracking row already carries reservation evidence" });
  }
  // 3. survey conditions still hold
  if (isCutover && !f.surveyEligible) {
    failures.push({ code: "survey_conditions", detail: "survey no longer cutover-eligible (has_rental / van_status)" });
  }
  // Request path: the request must still be approved and unconsumed.
  if (!isCutover && f.sourceRow) {
    if (String(f.sourceRow.status ?? "") !== "approved") {
      failures.push({ code: "request_not_approved", detail: `request status is ${f.sourceRow.status ?? "?"}` });
    }
    if (f.sourceRow.etd_booked_at != null) {
      failures.push({ code: "request_already_booked", detail: "request already carries etd_booked_at" });
    }
  }
  if (String(f.ldap ?? "").trim().toUpperCase() === "ZZTEST") {
    failures.push({ code: "test_ldap", detail: "ZZTEST is never bookable" });
  }
  // 4. roster
  if (!f.roster) {
    failures.push({ code: "roster_missing", detail: "no all_techs roster row" });
  } else {
    if (f.roster.employmentStatus !== "A") failures.push({ code: "roster_inactive", detail: `employment_status=${f.roster.employmentStatus ?? "?"}` });
    if (f.roster.dropped) failures.push({ code: "roster_dropped", detail: "dropped_from_source_at is set" });
    if (!f.roster.districtNo) failures.push({ code: "district_missing", detail: "no district_no on roster" });
  }
  // 5. TPMS truck. A CUTOVER requirement and ONLY a cutover requirement: that lane
  // rewrites an existing rental billed against a specific truck, so the truck has to
  // be known and has to agree. A rental request is the opposite case. Its commonest
  // reason is literally "new hire, no vehicle", where there is no assigned truck to
  // find and TPMS is correctly silent. Gating requests on it refused every new hire
  // before an intent could even be created, so the card showed an approved request
  // with no workflow attached and nothing anywhere said why. The truck is still
  // carried when we have one (the request's own truck_number wins, TPMS is the
  // fallback) and the special notes read "SHS TRUCK n/a" when we do not.
  if (isCutover) {
    if (!f.tpmsTruck) {
      failures.push({ code: "tpms_truck_missing", detail: "no tpms_tech_profiles.truck_no" });
    } else if (f.truckContradiction) {
      failures.push({ code: "tpms_truck_contradiction", detail: f.truckContradiction });
    }
  }
  // 6. exactly one open Enterprise case (cutover)
  if (isCutover) {
    if (f.openCaseCount !== 1) {
      failures.push({ code: "case_cardinality", detail: `${f.openCaseCount} open Enterprise cases resolve to this tech; exactly 1 required` });
    } else {
      if (!f.caseFacts?.ecars) failures.push({ code: "ecars_missing", detail: "ECARS_2_0_TKT_NBR absent (no renter-name fallback in this workflow)" });
      if (!f.caseFacts?.rentingBranch) failures.push({ code: "renting_branch_missing", detail: "RENTING_BRANCH absent; branch pin impossible" });
    }
  }
  // 8. contact phone (7 — class/branch/schedule — is enforced at preview time)
  if (isCutover) {
    if (!f.contactPhone) failures.push({ code: "contact_phone_missing", detail: "no fs_comms_contacts phone; cutover has no fallback" });
  } else if (!f.contactPhone && !f.requestFallbackPhone) {
    failures.push({ code: "contact_phone_missing", detail: "no fs_comms_contacts phone and no request mobile_phone fallback" });
  }

  return { ok: failures.length === 0, failures };
}

/**
 * Drift comparator (repair spec §4): compare the approved preview's INPUTS
 * against freshly recomputed facts. Returns human-readable drift lines;
 * empty = no drift. Pure — unit-tested directly. Field-level date/branch/
 * ZIP/class integrity is enforced separately: the runner re-quotes at booking
 * and aborts on branch/class/date divergence, and the schedule re-check
 * covers the event day.
 */
export function comparePreviewToFacts(preview: any, facts: EligibilityFacts): string[] {
  const drifts: string[] = [];
  const norm = (v: unknown) => String(v ?? "").trim().toUpperCase();
  const check = (name: string, prevVal: unknown, factVal: unknown) => {
    if (norm(prevVal) !== norm(factVal)) {
      drifts.push(`${name}: preview '${String(prevVal ?? "")}' vs current '${String(factVal ?? "")}'`);
    }
  };
  check("tpmsTruck", preview?.tpmsTruck, facts.tpmsTruck);
  check("district", preview?.artBlock?.unit, facts.roster?.districtNo);
  if (preview?.workflowType === WORKFLOW_CUTOVER) {
    check("caseKey", preview?.enterpriseCase?.caseKey, facts.caseKey);
    check("ecars", preview?.enterpriseCase?.ecars, facts.caseFacts?.ecars);
    check("claim", preview?.enterpriseCase?.claim, facts.caseFacts?.claim);
    check("rentingBranch", preview?.reservation?.branchCode, facts.caseFacts?.rentingBranch);
    check("vehicleMake", preview?.reservation?.vehicle?.make, facts.caseFacts?.make);
    check("vehicleModel", preview?.reservation?.vehicle?.model, facts.caseFacts?.model);
  }
  return drifts;
}

export async function fetchEligibilityFacts(params: {
  workflowType: string;
  sourceId: string;
  excludeIntentId?: number | null;
}): Promise<EligibilityFacts> {
  const isCutover = params.workflowType === WORKFLOW_CUTOVER;

  // --- source row -----------------------------------------------------------
  let sourceRow: any | null = null;
  if (isCutover) {
    const { rows } = await db.execute(sql`
      SELECT * FROM vrm_rental_tech_survey WHERE id = ${params.sourceId}::uuid LIMIT 1
    `);
    sourceRow = (rows as any[])[0] ?? null;
  } else {
    // The request lane is keyed by request_no — that is what the UI carries
    // and what the by-source endpoint documents. A UUID id is accepted too so
    // fixtures and direct-id callers keep working.
    const key = String(params.sourceId).trim();
    const { rows } = /^\d+$/.test(key)
      ? await db.execute(sql`
          SELECT * FROM vrm_rental_request WHERE request_no = ${Number(key)} LIMIT 1
        `)
      : await db.execute(sql`
          SELECT * FROM vrm_rental_request WHERE id = ${key}::uuid LIMIT 1
        `);
    sourceRow = (rows as any[])[0] ?? null;
  }

  const ldap = String(sourceRow?.ldap ?? "").trim().toUpperCase();

  // --- newer response check (cutover) ---------------------------------------
  let newerResponseExists = false;
  if (isCutover && sourceRow) {
    const { rows } = await db.execute(sql`
      SELECT 1 FROM vrm_rental_tech_survey
      WHERE upper(ldap) = ${ldap} AND created_at > ${sourceRow.created_at} LIMIT 1
    `);
    newerResponseExists = (rows as any[]).length > 0;
  }

  const surveyEligible =
    !isCutover ||
    (sourceRow?.has_rental === true &&
      ["in_shop", "decommissioned", "totaled"].includes(String(sourceRow?.van_status ?? "").toLowerCase()));

  // --- other nonterminal intents for this LDAP -------------------------------
  let otherNonterminalIntentId: number | null = null;
  if (ldap) {
    const { rows } = await db.execute(sql`
      SELECT id FROM vrm_rental_workflow_intents
      WHERE upper(ldap) = ${ldap}
        AND execution_mode = 'live'
        AND status NOT IN ('completed','cancelled','abandoned')
        AND (${params.excludeIntentId ?? null}::integer IS NULL OR id <> ${params.excludeIntentId ?? null}::integer)
      LIMIT 1
    `);
    otherNonterminalIntentId = (rows as any[])[0]?.id ?? null;
  }

  // --- cutover tracking row consumed? ----------------------------------------
  let cutoverAlreadyBooked = false;
  if (isCutover && ldap) {
    // Real columns only (repair spec §1): the tracking row carries reservation
    // evidence when its status says booked OR either ETD evidence field is a
    // non-blank value. (reservation_confirmation was a phantom column — every
    // eligibility fetch died on 42703 before any gate could run.)
    const { rows } = await db.execute(sql`
      SELECT 1 FROM vrm_rental_cutover
      WHERE upper(ldap) = ${ldap}
        AND (reservation_status = 'booked'
             OR nullif(trim(etd_reference), '') IS NOT NULL
             OR nullif(trim(etd_reservation_id), '') IS NOT NULL)
      LIMIT 1
    `);
    cutoverAlreadyBooked = (rows as any[]).length > 0;
  }

  // --- roster (candidate-SQL ordering: prefer active, newest effective/sync) --
  let roster: EligibilityFacts["roster"] = null;
  if (ldap) {
    const { rows } = await db.execute(sql`
      SELECT employment_status, dropped_from_source_at, district_no, employee_id, tech_name, job_title
      FROM all_techs
      WHERE upper(tech_racfid) = ${ldap}
      ORDER BY (employment_status = 'A') DESC,
               effective_date DESC NULLS LAST,
               synced_at DESC NULLS LAST
      LIMIT 1
    `);
    const r = (rows as any[])[0];
    if (r) {
      roster = {
        employmentStatus: r.employment_status ?? null,
        dropped: r.dropped_from_source_at != null,
        districtNo: r.district_no != null && String(r.district_no).trim() !== "" ? String(r.district_no).trim() : null,
        employeeId: r.employee_id ?? null,
        techName: r.tech_name ?? null,
        // The roster knows the trade. The request lane used to read HVAC off a
        // checkbox the TECHNICIAN ticks, so an HVAC Team Lead who left it blank was
        // approved for a sedan (JGATES2, 2026-08-18). isHvac(jobTitle) already
        // exists and the cutover lane already trusts it.
        jobTitle: r.job_title ?? null,
      };
    }
  }

  // --- TPMS truck -------------------------------------------------------------
  let tpmsTruck: string | null = null;
  if (ldap) {
    const { rows } = await db.execute(sql`
      SELECT truck_no FROM tpms_tech_profiles
      WHERE upper(enterprise_id) = ${ldap}
      ORDER BY synced_at DESC NULLS LAST
      LIMIT 1
    `);
    const t = (rows as any[])[0]?.truck_no;
    tpmsTruck = t != null && String(t).trim() !== "" ? String(t).trim() : null;
  }

  let truckContradiction: string | null = null;
  if (isCutover && tpmsTruck && sourceRow) {
    const surveyTruck = sourceRow.assigned_truck_number;
    if (!isTruckSilence(surveyTruck) && normTruck(surveyTruck) !== normTruck(tpmsTruck)) {
      truckContradiction = `survey says truck ${surveyTruck}, TPMS says ${tpmsTruck}`;
    }
  }

  // --- exactly one open Enterprise case (cutover) ------------------------------
  let openCaseCount = 0;
  let caseKey: string | null = null;
  let caseFacts: EligibilityFacts["caseFacts"] = null;
  if (isCutover && roster?.employeeId) {
    const empDigits = digitsOnly(roster.employeeId);
    const { rows } = await db.execute(sql`
      SELECT c.case_key, c.vehicle_number, c.feed_json, c.rental_vendor
      FROM vrm_rental_operations_cases c
      JOIN vrm_rental_identity_resolutions ir ON ir.case_key = c.case_key
      WHERE c.present_in_latest = true
        AND upper(coalesce(c.ticket_status, '')) = 'OPEN'
        AND upper(coalesce(c.rental_vendor, '')) LIKE 'ENTERPRISE%'
        AND regexp_replace(coalesce(nullif(trim(ir.override_employee_id), ''), nullif(trim(ir.resolved_employee_id), ''), ''), '[^0-9]', '', 'g') = ${empDigits}
      ORDER BY c.case_key
    `);
    const list = rows as any[];
    openCaseCount = list.length;
    if (list.length === 1) {
      const c = list[0];
      caseKey = c.case_key;
      const fj = typeof c.feed_json === "string" ? safeJson(c.feed_json) : (c.feed_json ?? {});
      caseFacts = {
        vehicleNumber: strOrNull(c.vehicle_number),
        rentingBranch: strOrNull(fj?.RENTING_BRANCH),
        rentingCity: strOrNull(fj?.RENTING_CITY_NAME),
        rentingState: strOrNull(fj?.RENTING_STATE),
        ecars: strOrNull(fj?.ECARS_2_0_TKT_NBR),
        claim: strOrNull(fj?.CLAIM_NUMBER),
        year: strOrNull(fj?.RENTED_VEH_YEAR),
        make: strOrNull(fj?.RENTED_VEH_MAKE),
        model: strOrNull(fj?.RENTED_VEH_MODEL),
        rentalStartDate: strOrNull(fj?.RENTAL_START_DATE),
        vendor: strOrNull(c.rental_vendor),
      };
    }
  }

  // --- contact phone ------------------------------------------------------------
  let contactPhone: string | null = null;
  let contactState: string | null = null;
  if (ldap) {
    const { rows } = await db.execute(sql`
      SELECT phone, primary_state FROM fs_comms_contacts WHERE upper(ldap) = ${ldap} LIMIT 1
    `);
    const c = (rows as any[])[0];
    contactPhone = c?.phone && String(c.phone).trim() ? String(c.phone).trim() : null;
    contactState = c?.primary_state ?? null;
  }

  const requestFallbackPhone =
    !isCutover && sourceRow?.mobile_phone && String(sourceRow.mobile_phone).trim()
      ? String(sourceRow.mobile_phone).trim()
      : null;

  return {
    workflowType: params.workflowType,
    sourceId: params.sourceId,
    ldap,
    techName: sourceRow?.tech_name ?? roster?.techName ?? null,
    sourceRow,
    newerResponseExists,
    surveyEligible,
    otherNonterminalIntentId,
    cutoverAlreadyBooked,
    roster,
    tpmsTruck,
    truckContradiction,
    openCaseCount,
    caseKey,
    caseFacts,
    contactPhone,
    contactState,
    requestFallbackPhone,
  };
}

function safeJson(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

function strOrNull(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

function clipText(v: unknown, n: number): string {
  return String(v ?? "").slice(0, n);
}

/** Attempt outcomes that mean "the external call answered, and it answered no". */
const REFUSAL_OUTCOMES = new Set(["exception", "failed_clean", "unparsed", "timeout", "ambiguous"]);

/**
 * The reason the last booking attempt gave, straight from the shared attempt ledger.
 *
 * Read from the ledger rather than from `last_error` on purpose: the ledger is what both
 * runners write, it survives whatever later writers do to the intent row, and it is the
 * record an operator is pointed at. Returns null when the last attempt did not fail (or
 * recorded nothing), so a caller can keep its own wording.
 */
async function latestBookingFailureReason(intentId: number): Promise<string | null> {
  const { rows } = await db.execute(sql`
    SELECT outcome, evidence
    FROM vrm_workflow_attempts
    WHERE intent_id = ${intentId} AND phase = 'etd_booking' AND outcome IS NOT NULL
    ORDER BY attempt_no DESC
    LIMIT 1
  `);
  const row = (rows as any[])[0];
  if (!row) return null;
  const outcome = String(row.outcome ?? "");
  if (!REFUSAL_OUTCOMES.has(outcome)) return null;
  const evidence = row.evidence ?? {};
  const reason = strOrNull(evidence?.error) ?? strOrNull(evidence?.reason);
  return reason ? clipText(reason, 400) : null;
}

// ---------------------------------------------------------------------------
// Snowflake schedule access (bounded per-LDAP reads)
// ---------------------------------------------------------------------------
//
// MIRROR-LOCK EXEMPTION: the fleet-wide Snowflake advisory lock
// ('fleetscope-mirror-sync') serializes HEAVY roster-mirror sweeps. These
// queries are bounded per-LDAP point reads (one tech, <=~30 day window,
// pruned by EMPLOYEE_REF + EXPECTED_START_DATE) — joining the lock would
// serialize an interactive gate behind multi-minute mirror rebuilds for no
// safety gain. Approved by the plan of record.

async function ensureSnowflake(): Promise<void> {
  if (isSnowflakeConfigured()) return;
  const account = process.env.SNOWFLAKE_ACCOUNT;
  const username = process.env.SNOWFLAKE_USER;
  let privateKey = process.env.SNOWFLAKE_PRIVATE_KEY;
  if (!privateKey) {
    try {
      const { loadKeyFromFile } = await import("../../snowflake-key-loader");
      const fileKey = loadKeyFromFile();
      if (fileKey) privateKey = fileKey;
    } catch {
      /* no key file */
    }
  }
  if (!account || !username || !privateKey) {
    throw new Error("Snowflake is not configured (SNOWFLAKE_ACCOUNT/USER/PRIVATE_KEY)");
  }
  initializeSnowflakeService({
    account,
    username,
    privateKey,
    database: process.env.SNOWFLAKE_DATABASE,
    schema: process.env.SNOWFLAKE_SCHEMA,
    warehouse: process.env.SNOWFLAKE_WAREHOUSE,
    role: process.env.SNOWFLAKE_ROLE,
  });
}

export type ScheduleWindow = {
  ldap: string;
  watermarkUtc: string | null;
  watermarkAgeHours: number | null;
  fresh: boolean;
  days: ScheduleDay[];
};

/**
 * Working-day window for one LDAP. Snapshot filter is plan-exact: retain ALL
 * rows of the newest load per employee-day (QUALIFY on CREATED_TS_DW max over
 * the employee-day partition), then aggregate per day.
 */
export async function fetchScheduleWindow(ldap: string, fromISO: string, horizonDays: number): Promise<ScheduleWindow> {
  await ensureSnowflake();
  const sf = getSnowflakeService();
  const upper = ldap.trim().toUpperCase();

  const wmRows = await sf.executeQuery(`SELECT MAX(CREATED_TS_DW) AS TS FROM ${SCHEDULE_TABLE}`);
  const watermarkUtc: string | null = wmRows?.[0]?.TS ? new Date(wmRows[0].TS + "Z").toISOString() : null;
  const age = watermarkAgeHours(watermarkUtc);
  const fresh = age !== null && age <= WATERMARK_MAX_AGE_HOURS;

  const rows = await sf.executeQuery(
    `SELECT DAY,
            MAX(AVAIL) AS MAX_AVAIL,
            LISTAGG(DISTINCT ACT, '|') AS ACTS,
            TO_CHAR(MAX(SNAP), 'YYYY-MM-DD HH24:MI:SS.FF3') AS SNAP_TS
     FROM (
       SELECT TO_CHAR(EXPECTED_START_DATE, 'YYYY-MM-DD') AS DAY,
              AVAILABLE_TIME AS AVAIL,
              COALESCE(ACTIVITY_TYPE_DESCRIPTION, '') AS ACT,
              CREATED_TS_DW AS SNAP
       FROM ${SCHEDULE_TABLE}
       WHERE UPPER(TRIM(EMPLOYEE_REF)) = ?
         AND EXPECTED_START_DATE BETWEEN TO_DATE(?) AND DATEADD(day, ?, TO_DATE(?))
       QUALIFY CREATED_TS_DW = MAX(CREATED_TS_DW)
                 OVER (PARTITION BY UPPER(TRIM(EMPLOYEE_REF)), EXPECTED_START_DATE)
     )
     GROUP BY DAY
     ORDER BY DAY`,
    [upper, fromISO, horizonDays, fromISO],
  );

  const dayRows: ScheduleDayRow[] = (rows ?? []).map((r: any) => ({
    day: String(r.DAY),
    maxAvail: r.MAX_AVAIL == null ? null : Number(r.MAX_AVAIL),
    activities: String(r.ACTS ?? "")
      .split("|")
      .map((s: string) => s.trim())
      .filter(Boolean),
    snapshotTs: String(r.SNAP_TS ?? ""),
  }));

  return { ldap: upper, watermarkUtc, watermarkAgeHours: age, fresh, days: classifyScheduleDays(dayRows) };
}

/**
 * Re-verify ONE event day for one tech (repair spec §4/§8): global watermark
 * fresh, day working, AND the per-tech/per-day snapshot itself fresh. Used at
 * Confirm and immediately before booking; any failure is drift.
 */
async function recheckScheduleDay(ldap: string, eventISO: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const win = await fetchScheduleWindow(ldap, eventISO, 1);
    if (!win.fresh) {
      return {
        ok: false,
        detail: `schedule watermark ${win.watermarkUtc ?? "missing"} is ${win.watermarkAgeHours?.toFixed(1) ?? "?"}h old (limit ${WATERMARK_MAX_AGE_HOURS}h)`,
      };
    }
    const day = win.days.find((d) => d.date === eventISO);
    if (!day?.working) {
      return {
        ok: false,
        detail: `${eventISO} is no longer a verified working day${day?.absences?.length ? ` (${day.absences.join(", ")})` : ""}`,
      };
    }
    const age = scheduleDaySnapshotAgeHours(day);
    if (age === null || age > WATERMARK_MAX_AGE_HOURS) {
      return {
        ok: false,
        detail: `snapshot carrying ${eventISO} is ${age === null ? "unparseable" : `${age.toFixed(1)}h old`} (limit ${WATERMARK_MAX_AGE_HOURS}h)`,
      };
    }
    return { ok: true, detail: "working day re-verified" };
  } catch (e: any) {
    return { ok: false, detail: `schedule re-check failed: ${e?.message ?? e}` };
  }
}

/** Rows for the block readback: the event day only, newest employee-day load. */
export async function fetchBlockReadbackRows(ldap: string, dateISO: string): Promise<{ rows: BlockReadbackRow[]; watermarkUtc: string | null }> {
  await ensureSnowflake();
  const sf = getSnowflakeService();
  const upper = ldap.trim().toUpperCase();

  const wmRows = await sf.executeQuery(`SELECT MAX(CREATED_TS_DW) AS TS FROM ${SCHEDULE_TABLE}`);
  const watermarkUtc: string | null = wmRows?.[0]?.TS ? new Date(wmRows[0].TS + "Z").toISOString() : null;

  const rows = await sf.executeQuery(
    `SELECT ACTIVITY_TYPE_DESCRIPTION AS ACT,
            EXPECTED_START_TIME AS ST,
            POSTCODE AS PC,
            TO_CHAR(CREATED_TS_DW, 'YYYY-MM-DD HH24:MI:SS.FF3') AS SNAP_TS
     FROM ${SCHEDULE_TABLE}
     WHERE UPPER(TRIM(EMPLOYEE_REF)) = ?
       AND EXPECTED_START_DATE = TO_DATE(?)
     QUALIFY CREATED_TS_DW = MAX(CREATED_TS_DW)
               OVER (PARTITION BY UPPER(TRIM(EMPLOYEE_REF)), EXPECTED_START_DATE)`,
    [upper, dateISO],
  );

  return {
    watermarkUtc,
    rows: (rows ?? []).map((r: any) => ({
      activity: r.ACT ?? null,
      startTime: r.ST == null ? null : String(r.ST).trim(),
      postcode: r.PC == null ? null : String(r.PC),
      snapshotTs: String(r.SNAP_TS ?? "") + "Z",
    })),
  };
}

// ---------------------------------------------------------------------------
// Intent lifecycle
// ---------------------------------------------------------------------------

export class OrchestratorError extends Error {
  code: string;
  httpStatus: number;
  extra?: Record<string, unknown>;
  constructor(code: string, message: string, httpStatus = 400, extra?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
    this.extra = extra;
  }
}

async function loadIntent(intentId: number): Promise<any> {
  const { rows } = await db.execute(sql`
    SELECT * FROM vrm_rental_workflow_intents WHERE id = ${intentId} LIMIT 1
  `);
  const row = (rows as any[])[0];
  if (!row) throw new OrchestratorError("intent_not_found", `intent ${intentId} not found`, 404);
  return row;
}

async function touchIntent(
  intentId: number,
  patch: Record<string, unknown>,
  guard?: { statusIn?: string[]; claimedBy?: string; fencingToken?: number },
): Promise<number> {
  // Narrow, whitelisted dynamic update — build SET clauses explicitly.
  const sets: any[] = [];
  const push = (fragment: any) => sets.push(fragment);
  for (const [k, v] of Object.entries(patch)) {
    switch (k) {
      case "status": push(sql`status = ${v}`); break;
      case "reservation_state": push(sql`reservation_state = ${v}`); break;
      case "block_state": push(sql`block_state = ${v}`); break;
      case "msg1_state": push(sql`msg1_state = ${v}`); break;
      case "msg2_state": push(sql`msg2_state = ${v}`); break;
      case "eligibility": push(sql`eligibility = ${JSON.stringify(v)}::jsonb`); break;
      case "preview": push(sql`preview = ${JSON.stringify(v)}::jsonb`); break;
      case "preview_version": push(sql`preview_version = ${v}`); break;
      case "preview_hash": push(sql`preview_hash = ${v}`); break;
      case "preview_built_at": push(sql`preview_built_at = ${v}`); break;
      case "preview_expires_at": push(sql`preview_expires_at = ${v}`); break;
      case "reservation_evidence": push(sql`reservation_evidence = ${JSON.stringify(v)}::jsonb`); break;
      case "block_evidence": push(sql`block_evidence = ${JSON.stringify(v)}::jsonb`); break;
      case "block_submitted_at": push(sql`block_submitted_at = ${v}`); break;
      case "claimed_by": push(sql`claimed_by = ${v}`); break;
      case "lease_expires_at": push(sql`lease_expires_at = ${v}`); break;
      case "heartbeat_at": push(sql`heartbeat_at = ${v}`); break;
      case "next_retry_at": push(sql`next_retry_at = ${v}`); break;
      case "hard_deadline_at": push(sql`hard_deadline_at = ${v}`); break;
      case "last_error": push(sql`last_error = ${v}`); break;
      case "event_date": push(sql`event_date = ${v}`); break;
      case "enterprise_case_id": push(sql`enterprise_case_id = ${v}`); break;
      case "truck_number": push(sql`truck_number = ${v}`); break;
      default:
        throw new Error(`touchIntent: unknown column ${k}`);
    }
  }
  push(sql`updated_at = now()`);
  const setSql = sets.reduce((acc, cur, i) => (i === 0 ? cur : sql`${acc}, ${cur}`));
  // Optional CAS guard: re-assert the caller's WHOLE predicate in the write
  // itself (status + claim + fence), because a check at function entry says
  // nothing about the row by the time a slow builder finally writes.
  let where = sql`id = ${intentId}`;
  if (guard?.statusIn?.length) {
    const inList = guard.statusIn
      .map((s) => sql`${s}`)
      .reduce((acc, cur, i) => (i === 0 ? cur : sql`${acc}, ${cur}`));
    where = sql`${where} AND status IN (${inList})`;
  }
  if (guard?.claimedBy !== undefined) where = sql`${where} AND claimed_by = ${guard.claimedBy}`;
  if (guard?.fencingToken !== undefined) where = sql`${where} AND fencing_token = ${guard.fencingToken}`;
  const res = await db.execute(sql`UPDATE vrm_rental_workflow_intents SET ${setSql} WHERE ${where}`);
  return (res as any).rowCount ?? 0;
}

/**
 * Mirror the owning intent's workflow-summary columns onto an EXISTING
 * vrm_rental_cutover row (display-only). LIVE intents only — TEST/dry-run
 * intents never advance live state (plan). UPDATE-ONLY (repair spec §5):
 * intent creation must never materialize a tracking row — the old INSERT
 * here made a cutover look "tracked" the moment an intent was created, long
 * before any reservation existed. The business row is written exactly once,
 * by completeCutoverTracking, when the workflow actually completes.
 */
async function mirrorCutoverSummary(intentId: number): Promise<void> {
  const intent = await loadIntent(intentId);
  if (intent.workflow_type !== WORKFLOW_CUTOVER) return;
  if (intent.execution_mode !== "live") return;
  const substates = {
    reservation: intent.reservation_state,
    block: intent.block_state,
    msg1: intent.msg1_state,
    msg2: intent.msg2_state,
  };
  await db.execute(sql`
    UPDATE vrm_rental_cutover SET
      intent_id = ${intentId},
      workflow_status = ${intent.status},
      workflow_substates = ${JSON.stringify(substates)}::jsonb,
      workflow_mode = ${intent.execution_mode},
      workflow_updated_at = now()
    WHERE upper(ldap) = ${String(intent.ldap).toUpperCase()}
  `);
}

// ---------------------------------------------------------------------------
// Quiet-hours exception-state fallback (repair spec §7): FL/CT/MD/OK/WA/TX
// msg2 mornings need a PERSISTED operator choice — never a silent default.
// ---------------------------------------------------------------------------

export const QUIET_FALLBACK_SETTING_KEY = "vrm_cutover_quiet_state_msg2_fallback";
export type QuietStateFallback = { mode: "send_at_window_open" | "skip_msg2"; setBy?: string | null; setAt?: string | null };

export async function getQuietStateFallback(): Promise<QuietStateFallback | null> {
  const { rows } = await db.execute(sql`
    SELECT value FROM app_settings WHERE key = ${QUIET_FALLBACK_SETTING_KEY} LIMIT 1
  `);
  const v = (rows as any[])[0]?.value;
  const mode = String(v?.mode ?? "");
  if (mode !== "send_at_window_open" && mode !== "skip_msg2") return null;
  return { mode: mode as QuietStateFallback["mode"], setBy: v?.setBy ?? null, setAt: v?.setAt ?? null };
}

export async function setQuietStateFallback(mode: string, setBy: string): Promise<QuietStateFallback> {
  if (mode !== "send_at_window_open" && mode !== "skip_msg2") {
    throw new OrchestratorError("bad_payload", "mode must be send_at_window_open or skip_msg2", 400);
  }
  const value = { mode, setBy, setAt: new Date().toISOString() };
  await db.execute(sql`
    INSERT INTO app_settings (key, value, updated_by, updated_at)
    VALUES (${QUIET_FALLBACK_SETTING_KEY}, ${JSON.stringify(value)}::jsonb, ${setBy}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()
  `);
  return value as QuietStateFallback;
}

/**
 * Terminal completion (repair spec §5): flip the intent to completed and —
 * for a LIVE CUTOVER — land the legacy tracking evidence in
 * vrm_rental_cutover in the SAME transaction, so the survey page's Complete
 * state can never exist without a completed workflow (or vice versa). CAS on
 * the observed status: a racing cancel wins. Returns true when this call
 * performed the flip.
 */
export async function finalizeCompletion(intentId: number, observedStatus: string): Promise<boolean> {
  const intent = await loadIntent(intentId);
  const liveCutover = intent.workflow_type === WORKFLOW_CUTOVER && intent.execution_mode === "live";
  if (!liveCutover) {
    const { rows } = await db.execute(sql`
      UPDATE vrm_rental_workflow_intents SET status = 'completed', updated_at = now()
      WHERE id = ${intentId} AND status = ${observedStatus}
      RETURNING id
    `);
    return (rows as any[]).length > 0;
  }

  const preview = intent.preview ?? {};
  const resv = preview.reservation ?? {};
  const blockEv = intent.block_evidence ?? {};
  const conf = strOrNull(intent.reservation_evidence?.confirmation);
  const journeyId =
    strOrNull(intent.reservation_evidence?.raw?.journeyId) ?? strOrNull(resv.quote?.journeyId);
  const reservedAtISO =
    strOrNull(intent.reservation_evidence?.verifiedAt) ??
    strOrNull(intent.reservation_evidence?.bookedAt) ??
    new Date().toISOString();
  const substates = {
    reservation: intent.reservation_state,
    block: intent.block_state,
    msg1: intent.msg1_state,
    msg2: intent.msg2_state,
  };
  return await db.transaction(async (tx) => {
    const { rows: flipped } = await tx.execute(sql`
      UPDATE vrm_rental_workflow_intents SET status = 'completed', updated_at = now()
      WHERE id = ${intentId} AND status = ${observedStatus}
      RETURNING id
    `);
    if (!(flipped as any[]).length) return false;
    await tx.execute(sql`
      INSERT INTO vrm_rental_cutover
        (ldap, tech_name, truck_number, reservation_status, etd_reference, etd_reservation_id,
         branch_code_booked, branch_name, branch_address, vehicle_class,
         reservation_start, reservation_end, reserved_at, reservation_error,
         route_block_status, route_block_project_id, route_block_project_name,
         route_block_date, route_block_live, route_block_filed_at, route_block_error,
         intent_id, workflow_status, workflow_substates, workflow_mode, workflow_updated_at)
      VALUES
        (${String(intent.ldap).toUpperCase()}, ${intent.tech_name ?? null}, ${intent.truck_number ?? null},
         'booked', ${conf}, ${journeyId},
         ${resv.branchCode ?? null}, ${resv.branchName ?? null}, ${resv.branchAddress ?? null}, ${resv.sipp ?? null},
         ${resv.pickupDate ?? null}, ${resv.returnDate ?? null}, ${reservedAtISO}::timestamptz, NULL,
         'filed', ${strOrNull(blockEv.projectId)}, ${strOrNull(blockEv.projectName)},
         ${intent.event_date ?? null}, true, ${intent.block_submitted_at ?? null}, NULL,
         ${intentId}, 'completed', ${JSON.stringify(substates)}::jsonb, ${intent.execution_mode}, now())
      ON CONFLICT (ldap) DO UPDATE SET
        tech_name = COALESCE(EXCLUDED.tech_name, vrm_rental_cutover.tech_name),
        truck_number = COALESCE(EXCLUDED.truck_number, vrm_rental_cutover.truck_number),
        reservation_status = EXCLUDED.reservation_status,
        etd_reference = EXCLUDED.etd_reference,
        etd_reservation_id = EXCLUDED.etd_reservation_id,
        branch_code_booked = EXCLUDED.branch_code_booked,
        branch_name = EXCLUDED.branch_name,
        branch_address = EXCLUDED.branch_address,
        vehicle_class = EXCLUDED.vehicle_class,
        reservation_start = EXCLUDED.reservation_start,
        reservation_end = EXCLUDED.reservation_end,
        reserved_at = EXCLUDED.reserved_at,
        reservation_error = NULL,
        route_block_status = EXCLUDED.route_block_status,
        route_block_project_id = EXCLUDED.route_block_project_id,
        route_block_project_name = EXCLUDED.route_block_project_name,
        route_block_date = EXCLUDED.route_block_date,
        route_block_live = EXCLUDED.route_block_live,
        route_block_filed_at = EXCLUDED.route_block_filed_at,
        route_block_error = NULL,
        intent_id = EXCLUDED.intent_id,
        workflow_status = EXCLUDED.workflow_status,
        workflow_substates = EXCLUDED.workflow_substates,
        workflow_mode = EXCLUDED.workflow_mode,
        workflow_updated_at = now()
    `);
    return true;
  });
}

export async function createIntent(params: {
  workflowType: string;
  sourceId: string;
  executionMode?: string;
  createdBy?: string | null;
}): Promise<{ intent: any; created: boolean; failures?: EligibilityFailure[] }> {
  // Mode default follows the arming flag: armed (validated workflow — prod)
  // means LIVE is the normal mode for staff; disarmed (dark/dev) keeps the
  // dry_run default and live intents cannot exist at all. An explicit
  // executionMode from the caller always wins in both states.
  const mode = params.executionMode ?? defaultExecutionMode();
  if (!EXECUTION_MODES.has(mode)) {
    throw new OrchestratorError("bad_mode", `execution_mode must be one of dry_run|test|live`, 400);
  }
  if (mode === "live" && !isContractBlockLive()) {
    // Disarmed: live intents cannot exist until the flag is armed.
    throw new OrchestratorError("live_disarmed", "VRM_CONTRACT_BLOCK_ENABLED is not armed; live intents are disabled", 403);
  }
  if (params.workflowType !== WORKFLOW_CUTOVER && params.workflowType !== WORKFLOW_REQUEST) {
    throw new OrchestratorError("bad_workflow", "unknown workflow_type", 400);
  }

  const facts = await fetchEligibilityFacts({ workflowType: params.workflowType, sourceId: params.sourceId });
  if (!facts.sourceRow) throw new OrchestratorError("source_missing", "source record not found", 404);
  const gate = evaluateEligibility(facts);
  if (!gate.ok) {
    throw new OrchestratorError("eligibility_failed", "eligibility gate failed", 422, { failures: gate.failures });
  }

  // Revision: reuse an existing nonterminal intent for this identity, or bump
  // past the highest terminal revision.
  const { rows: existing } = await db.execute(sql`
    SELECT * FROM vrm_rental_workflow_intents
    WHERE workflow_type = ${params.workflowType}
      AND source_id = ${params.sourceId}
      AND execution_mode = ${mode}
    ORDER BY source_revision DESC
    LIMIT 1
  `);
  const prior = (existing as any[])[0];
  if (prior && !TERMINAL_STATUSES.has(prior.status)) {
    return { intent: prior, created: false };
  }
  const revision = prior ? Number(prior.source_revision) + 1 : 0;

  try {
    const { rows } = await db.execute(sql`
      INSERT INTO vrm_rental_workflow_intents
        (workflow_type, source_id, source_revision, execution_mode, ldap, tech_name,
         truck_number, enterprise_case_id, status, eligibility, created_by, block_state)
      VALUES
        (${params.workflowType}, ${params.sourceId}, ${revision}, ${mode}, ${facts.ldap},
         ${facts.techName}, ${facts.tpmsTruck}, ${facts.caseKey},
         'created', ${JSON.stringify({ facts: publicFacts(facts), checkedAt: new Date().toISOString(), failures: [] })}::jsonb,
         ${params.createdBy ?? null},
         ${params.workflowType === WORKFLOW_REQUEST ? "not_applicable" : "pending"})
      ON CONFLICT (workflow_type, source_id, source_revision, execution_mode) DO NOTHING
      RETURNING *
    `);
    const inserted = (rows as any[])[0];
    if (!inserted) {
      // Raced another creator — return whatever won.
      const again = await db.execute(sql`
        SELECT * FROM vrm_rental_workflow_intents
        WHERE workflow_type = ${params.workflowType} AND source_id = ${params.sourceId}
          AND source_revision = ${revision} AND execution_mode = ${mode}
        LIMIT 1
      `);
      return { intent: (again.rows as any[])[0], created: false };
    }
    // No tracking mirror here (repair spec §5): vrm_rental_cutover rows are
    // written at COMPLETION, never at intent creation.
    return { intent: inserted, created: true };
  } catch (e: any) {
    if (String(e?.message ?? "").includes("vrm_workflow_intents_live_nonterminal_uq")) {
      throw new OrchestratorError("live_lock_held", "another live nonterminal intent already exists for this LDAP", 409);
    }
    throw e;
  }
}

/** Trim the facts snapshot persisted on the intent (no giant source rows). */
function publicFacts(f: EligibilityFacts): Record<string, unknown> {
  return {
    ldap: f.ldap,
    techName: f.techName,
    roster: f.roster,
    tpmsTruck: f.tpmsTruck,
    openCaseCount: f.openCaseCount,
    caseKey: f.caseKey,
    caseFacts: f.caseFacts,
    contactPhoneOnFile: !!f.contactPhone,
    contactState: f.contactState,
    newerResponseExists: f.newerResponseExists,
    surveyEligible: f.surveyEligible,
    // Address seeds the runner quotes from (never secrets, never phones).
    surveyBranch:
      f.workflowType === WORKFLOW_CUTOVER && f.sourceRow
        ? {
            name: strOrNull(f.sourceRow.rental_branch_name),
            city: strOrNull(f.sourceRow.rental_branch_city),
            state: strOrNull(f.sourceRow.rental_branch_state),
          }
        : null,
    surveyVehicleDesc:
      f.workflowType === WORKFLOW_CUTOVER && f.sourceRow ? strOrNull(f.sourceRow.rental_vehicle_desc) : null,
    requestSeed:
      f.workflowType === WORKFLOW_REQUEST && f.sourceRow
        ? {
            shopAddress: strOrNull(f.sourceRow.shop_address),
            shopCity: strOrNull(f.sourceRow.shop_city),
            shopState: strOrNull(f.sourceRow.shop_state),
            shopPostal: strOrNull(f.sourceRow.shop_postal),
            reportedBranch: strOrNull(f.sourceRow.tech_reported_branch),
            approvedVehicleClass: strOrNull(f.sourceRow.approved_vehicle_class),
            truckNumber: strOrNull(f.sourceRow.truck_number),
            pickupAt: f.sourceRow.pickup_at ?? null,
            appointmentAt: f.sourceRow.appointment_at ?? null,
          }
        : null,
  };
}

export async function requestPreview(intentId: number): Promise<any> {
  const intent = await loadIntent(intentId);
  if (TERMINAL_STATUSES.has(intent.status)) {
    throw new OrchestratorError("terminal", "intent is terminal", 409);
  }
  if (!["created", "preview_ready", "preview_required", "preview_pending"].includes(intent.status)) {
    throw new OrchestratorError("bad_state", `cannot request preview from status ${intent.status}`, 409);
  }
  // Clearing last_error alone was not enough: the PREVIOUS run's coded failures
  // stay on `eligibility` and the panel renders that list whatever the status,
  // so a re-queued preview showed "Quoting…" next to the red failures of the run
  // before it. The facts snapshot is kept (it is the eligibility evidence a
  // staffer reads); only the verdict is reset, and the next postback rewrites it.
  const prior = (intent.eligibility ?? null) as Record<string, unknown> | null;
  await touchIntent(intentId, {
    status: "preview_pending",
    next_retry_at: null,
    last_error: null,
    ...(prior ? { eligibility: { ...prior, failures: [], checkedAt: new Date().toISOString() } } : {}),
  });
  return loadIntent(intentId);
}

// ---------------------------------------------------------------------------
// Booking-queue claims (lease + fencing)
// ---------------------------------------------------------------------------

const LEASE_MINUTES = 30;

export type QueueItem = {
  intentId: number;
  kind: "preview" | "book" | "cancel";
  fencingToken: number;
  workflowType: string;
  executionMode: string;
  ldap: string;
  requiresReconcile: boolean;
  facts: Record<string, unknown>;
  preview: any | null;
};

/**
 * Atomically claim work for the Python runner. CAS per intent: free/expired
 * lease only, fencing token incremented on every (re)claim, RETURNING the
 * claimed rows. booking_unknown is NEVER claimable here — reconciliation for
 * it is staff-initiated (/retry).
 */
export async function claimBookingWork(params: {
  runnerId: string;
  limit?: number;
  workflowType?: string;
  /**
   * Narrow the claim to ONE intent. Used by the in-server executor when a staff
   * click should serve exactly the intent that was just created or confirmed,
   * instead of draining whatever else the queue happens to hold. Purely a
   * filter: every lane, lease, arming and fencing rule below still applies.
   */
  intentId?: number;
}): Promise<QueueItem[]> {
  const limit = Math.max(1, Math.min(params.limit ?? 5, 20));
  // The budget is TOTAL, not per lane. Spending it per lane let one call claim 4x the
  // limit, and a runner that processes serially can then hold leases on work it will
  // not reach for half an hour — the later intents are safe (op_open re-checks the
  // fencing token) but frozen until the lease expires.
  let remaining = limit;
  const items: QueueItem[] = [];
  const typeFilter = params.workflowType ? sql`AND workflow_type = ${params.workflowType}` : sql``;
  const idFilter = params.intentId ? sql`AND id = ${params.intentId}` : sql``;
  // Master kill switch: while the flag is disarmed, live intents are invisible
  // to the runner. Re-arming resumes them exactly where they stood.
  const liveArmed = isContractBlockLive();

  // Lane order: recover booked-but-unverified intents FIRST (an external
  // reservation already exists — its readback beats any new work), then
  // previews, then bookings. The 'verify' lane exists because a runner dying
  // between op_result(booked) and its readback would otherwise strand a real
  // reservation at awaiting_verification forever.
  // The 'cancel' lane serves cancel_pending_readback intents (repair spec §4):
  // the runner runs a readback-ONLY pass so the server can prove whether an
  // active reservation exists before the terminal cancel write.
  // …and one slot is RESERVED for the book lane. Lane order is a priority order, so a
  // standing preview backlog would otherwise spend the whole budget every pass and no
  // confirmed intent would ever be booked.
  const bookReserve = limit >= 2 ? 1 : 0;

  for (const lane of ["verify", "cancel", "preview", "book"] as const) {
    if (remaining <= 0) break;
    const laneLimit = lane === "book" ? remaining : remaining - bookReserve;
    if (laneLimit <= 0) continue;
    const statusPredicate =
      lane === "verify"
        ? sql`status = 'awaiting_verification' AND reservation_state = 'booked_unverified'`
        : lane === "cancel"
          ? sql`status = 'cancel_pending_readback'`
          : lane === "preview"
            ? sql`status = 'preview_pending'`
            : sql`status IN ('confirmed', 'booking')`;
    const { rows } = await db.execute(sql`
      UPDATE vrm_rental_workflow_intents
      SET claimed_by = ${params.runnerId},
          lease_expires_at = now() + make_interval(mins => ${LEASE_MINUTES}),
          heartbeat_at = now(),
          fencing_token = fencing_token + 1,
          status = CASE WHEN status = 'confirmed' THEN 'booking' ELSE status END,
          updated_at = now()
      WHERE id IN (
        SELECT id FROM vrm_rental_workflow_intents
        WHERE ${statusPredicate}
          ${typeFilter}
          ${idFilter}
          AND (execution_mode <> 'live' OR ${liveArmed}::boolean)
          AND (claimed_by IS NULL OR lease_expires_at IS NULL OR lease_expires_at < now())
          AND (next_retry_at IS NULL OR next_retry_at <= now())
        ORDER BY id
        LIMIT ${remaining}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `);
    remaining -= (rows as any[]).length;

    for (const r of rows as any[]) {
      const facts = await fetchEligibilityFacts({
        workflowType: r.workflow_type,
        sourceId: r.source_id,
        excludeIntentId: r.id,
      });
      const { rows: openAttempts } = await db.execute(sql`
        SELECT 1 FROM vrm_workflow_attempts
        WHERE intent_id = ${r.id} AND phase = 'etd_booking' AND outcome IS NULL
        LIMIT 1
      `);
      const kind = lane === "preview" ? "preview" : lane === "cancel" ? "cancel" : "book";
      items.push({
        intentId: r.id,
        kind,
        fencingToken: r.fencing_token,
        workflowType: r.workflow_type,
        executionMode: r.execution_mode,
        ldap: r.ldap,
        // Readback-first whenever external state MAY exist: an open attempt, a
        // reclaimed booked-unverified intent, or a reconcile-directed retry of
        // an ambiguous outcome. The last matters because op_result closes the
        // attempt row even for 'unknown' — without this flag the runner would
        // book AGAIN over a possibly-existing reservation. Cancel claims are
        // ALWAYS readback-only.
        requiresReconcile:
          kind === "cancel" ||
          (kind === "book" &&
            ((openAttempts as any[]).length > 0 ||
              lane === "verify" ||
              ["unknown", "booked_unverified"].includes(String(r.reservation_state ?? "")))),
        facts: publicFacts(facts),
        preview: r.preview ?? null,
      });
    }
  }
  return items;
}

async function verifyClaim(
  intentId: number,
  runnerId: string,
  fencingToken: number,
  opts?: { requireActiveLease?: boolean },
): Promise<any> {
  const intent = await loadIntent(intentId);
  if (intent.claimed_by !== runnerId) {
    throw new OrchestratorError("not_claim_holder", `intent claimed by ${intent.claimed_by ?? "nobody"}`, 409);
  }
  if (Number(intent.fencing_token) !== Number(fencingToken)) {
    throw new OrchestratorError("stale_fencing_token", `token ${fencingToken} is stale (current ${intent.fencing_token})`, 409);
  }
  if (opts?.requireActiveLease && (!intent.lease_expires_at || new Date(intent.lease_expires_at) <= new Date())) {
    throw new OrchestratorError("lease_expired", "claim lease expired; re-claim before opening an external operation", 409);
  }
  return intent;
}

/**
 * Authorize + open a booking attempt ATOMICALLY. verifyClaim() is only a fast
 * pre-check: between its read and a plain INSERT the lease can lapse and a
 * rival can reclaim (fencing token moves on) — and because attempt_no is
 * MAX+1, two interleaved opens would get DISTINCT numbers and both proceed to
 * the external call. Two layers close that:
 *   1. The CTE gate makes the active-claim predicate (runner + token +
 *      unexpired lease) part of the same statement that creates the attempt
 *      row, and renews the lease so the automation has a full window for the
 *      external call. This fences RIVAL holders. No gate pass → no row → 409.
 *   2. vrm_workflow_attempts_one_open_uq (partial unique on (intent, phase)
 *      WHERE outcome IS NULL) fences the SAME holder firing twice: the
 *      open-attempt pre-check below is snapshot-racy by itself (a NOT EXISTS
 *      inside the gate would be too, under READ COMMITTED), so the index is
 *      the authoritative invariant — the loser's insert 23505s and maps to
 *      unfinished_attempt below.
 * Exported for tests.
 */
export async function openBookingAttempt(
  intentId: number,
  runnerId: string,
  fencingToken: number,
  payload?: { requestHash?: unknown; request?: unknown },
): Promise<{ attemptNo: number }> {
  const { rows: open } = await db.execute(sql`
    SELECT attempt_no FROM vrm_workflow_attempts
    WHERE intent_id = ${intentId} AND phase = 'etd_booking' AND outcome IS NULL
    LIMIT 1
  `);
  if ((open as any[]).length) {
    throw new OrchestratorError("unfinished_attempt", "an unfinished booking attempt exists; reconcile via readback first", 409);
  }
  // IDEMPOTENCY. The checks above stop two attempts running AT ONCE; nothing stopped a
  // REPEAT after one already succeeded, and request_hash was written here and never
  // read. Two sequential passes on the same intent therefore both committed and made
  // DWHITE0 two reservations 26 seconds apart. ETD's own pre-commit duplicate search
  // cannot cover this: /api/myjourney/search returns only past-dated journeys, so a
  // future pickup is invisible to it. The guard has to live in our ledger.
  const thisHash = strOrNull(payload?.requestHash);
  if (thisHash) {
    const { rows: done } = await db.execute(sql`
      SELECT attempt_no FROM vrm_workflow_attempts
       WHERE intent_id = ${intentId} AND phase = 'etd_booking'
         AND request_hash = ${thisHash} AND outcome = 'booked'
       LIMIT 1
    `);
    if ((done as any[]).length) {
      throw new OrchestratorError(
        "already_booked",
        `this exact reservation (same branch, date, technician and class) already booked on attempt ${(done as any[])[0].attempt_no}; refusing to book it twice`,
        409,
      );
    }
  }
  let inserted: any[];
  try {
    const { rows } = await db.execute(sql`
      WITH gate AS (
        UPDATE vrm_rental_workflow_intents
        SET lease_expires_at = now() + make_interval(mins => ${LEASE_MINUTES}),
            heartbeat_at = now(),
            updated_at = now()
        WHERE id = ${intentId} AND claimed_by = ${runnerId}
          AND fencing_token = ${fencingToken}
          AND lease_expires_at IS NOT NULL AND lease_expires_at > now()
        RETURNING id
      )
      INSERT INTO vrm_workflow_attempts (intent_id, phase, attempt_no, fencing_token, request_hash, request)
      SELECT ${intentId}, 'etd_booking',
             COALESCE((SELECT MAX(attempt_no) FROM vrm_workflow_attempts
                       WHERE intent_id = ${intentId} AND phase = 'etd_booking'), 0) + 1,
             ${fencingToken},
             ${strOrNull(payload?.requestHash)},
             ${JSON.stringify(payload?.request ?? {})}::jsonb
      WHERE EXISTS (SELECT 1 FROM gate)
      RETURNING attempt_no
    `);
    inserted = rows as any[];
  } catch (e: any) {
    if (e?.code === "23505" || /duplicate key value/i.test(String(e?.message ?? ""))) {
      // A concurrent op_open won — either the attempt_no key (rival) or the
      // one-open partial index (same holder double-fire). Same discipline as
      // an unfinished attempt: reconcile via readback before booking again.
      throw new OrchestratorError("unfinished_attempt", "a concurrent booking attempt was just opened; reconcile via readback first", 409);
    }
    throw e;
  }
  if (!inserted.length) {
    // Gate lost between the pre-check and the insert — re-derive the precise
    // reason (claim stolen / stale token / expired lease) for the caller.
    await verifyClaim(intentId, runnerId, fencingToken, { requireActiveLease: true });
    throw new OrchestratorError("claim_lost", "claim changed while authorizing the operation; re-claim and retry", 409);
  }
  return { attemptNo: Number(inserted[0].attempt_no) };
}

// ---------------------------------------------------------------------------
// Preview persistence (runner posts quote + class decision)
// ---------------------------------------------------------------------------

export type RunnerQuote = {
  journeyId?: string | null;
  reference?: string | null;
  branchCode: string | null;
  branchName: string | null;
  branchAddress: string | null;
  /** Branch counter phone, already normalised to 000-000-0000, or null. */
  branchPhone?: string | null;
  branchZip: string | null;
  branchPinned: boolean;
  pickupDate: string; // YYYY-MM-DD (runner's schedule-gated choice)
  pickupTime?: string | null;
  returnDate?: string | null;
  returnTime?: string | null;
  /**
   * What the branch actually offered. Both runners send `{code, description}`
   * objects; the bare-string form is kept for previews persisted before that.
   * Stored verbatim as evidence — nothing reads the elements.
   */
  offeredClasses?: Array<string | { code: string | null; description: string | null }>;
  warnings?: string[];
  scheduleEvidence?: { watermarkUtc?: string | null; checkedAt?: string | null } | null;
};

export type RunnerClassDecision = {
  chosenSipp: string | null;
  mapped: boolean;
  mode: string; // 'same_vehicle' | 'approved_class'
  detail?: string | null;
};

export async function persistPreviewFromRunner(params: {
  intentId: number;
  runnerId: string;
  fencingToken: number;
  quote: RunnerQuote;
  classDecision: RunnerClassDecision;
}, deps?: {
  /** Test seam: runs just before the terminal write, where the TOCTOU lives. */
  beforeFinalWrite?: () => Promise<void>;
}): Promise<{ status: string; failures?: EligibilityFailure[]; preview?: any; previewVersion?: number }> {
  const intent = await verifyClaim(params.intentId, params.runnerId, params.fencingToken);
  if (intent.status !== "preview_pending") {
    throw new OrchestratorError("bad_state", `preview postback in status ${intent.status}`, 409);
  }
  const isCutover = intent.workflow_type === WORKFLOW_CUTOVER;

  const releaseClaim = { claimed_by: null as any, lease_expires_at: null as any };
  // The entry check above is only a fast reject. Minutes of gate re-runs and
  // schedule fetches sit between it and the write, and a vehicle-class edit
  // (invalidateRequestPreviews), a cancel, or a rival reclaim can move the
  // intent in that window. Every terminal write below re-asserts the whole
  // claim predicate, so a stale runner postback is DISCARDED instead of
  // resurrecting an old-input preview as fresh preview_ready.
  const postbackGuard = {
    statusIn: ["preview_pending"],
    claimedBy: params.runnerId,
    fencingToken: params.fencingToken,
  };
  const staleDiscard = () =>
    new OrchestratorError(
      "stale_postback",
      "intent left preview_pending while the preview was building (input edit, cancel, or rival reclaim) — stale preview discarded",
      409,
    );

  // 1. Full eligibility gate re-run (Queue-time evaluation).
  const facts = await fetchEligibilityFacts({
    workflowType: intent.workflow_type,
    sourceId: intent.source_id,
    excludeIntentId: intent.id,
  });
  const gate = evaluateEligibility(facts);
  const failures: EligibilityFailure[] = [...gate.failures];

  // 2. Branch pin + class mapping (gate #7 parts the runner owns).
  //
  // The pin is a CUTOVER requirement and only a cutover requirement. A swap has
  // a contract branch — the case's RENTING_BRANCH — that the replacement
  // reservation must return to, so the runner passes it as a preferred code and
  // the quote reports whether the pin took; the drift check just below then
  // cross-checks the pinned code against the case. A rental request has no
  // contract branch: the correct answer for a NEW rental is the branch nearest
  // the shop address, so the request lane deliberately pins nothing and the
  // quote therefore ALWAYS reports branchPinned:false. Applying the pin check
  // to both lanes made every request preview fail with branch_not_pinned, so no
  // request could ever reach Awaiting Confirm and none could ever be booked.
  if (isCutover) {
    if (!params.quote.branchPinned) {
      failures.push({ code: "branch_not_pinned", detail: "ETD quote could not pin the case's renting branch" });
    }
    if (facts.caseFacts?.rentingBranch && params.quote.branchCode &&
        params.quote.branchCode.trim().toUpperCase() !== facts.caseFacts.rentingBranch.trim().toUpperCase()) {
      failures.push({ code: "branch_pin_drift", detail: `pinned ${params.quote.branchCode} != case RENTING_BRANCH ${facts.caseFacts.rentingBranch}` });
    }
  }
  // A preview with no branch at all did not come from a completed quote. The pin
  // check used to catch that case incidentally on both lanes; now that it is
  // cutover-only, an unquoted request must still be refused by a code that names
  // the real cause instead of leaving a staffer to infer it from no_date.
  if (!strOrNull(params.quote.branchCode)) {
    const warning = strOrNull((params.quote.warnings ?? [])[0]);
    failures.push({
      code: "quote_failed",
      detail: warning
        ? `ETD quote did not complete: ${warning}`
        : "ETD quote returned no branch — no quote was taken for this preview",
    });
  }
  if (!params.classDecision.mapped || !params.classDecision.chosenSipp) {
    failures.push({ code: "class_unmapped", detail: params.classDecision.detail ?? "vehicle class could not be mapped (no sedan fallback in this workflow)" });
  }
  if (!zip5(params.quote.branchZip)) {
    failures.push({ code: "branch_zip_missing", detail: "quoted branch has no usable ZIP for the block location" });
  }

  // 3. Schedule gate — authoritative server-side re-check of the runner's date.
  // The window is fetched even when the runner sent NO date, so a "no date"
  // preview failure still tells the staffer WHY (stale watermark vs genuinely
  // no working day in the horizon) instead of a bare no_date.
  // CUTOVER ONLY. A cutover pairs the reservation with a 30-minute route block, so
  // the day must be one the technician actually works and the snapshot must be fresh.
  // A same-day request books today and files no block: ServicePower has no say in
  // whether a stranded technician gets a car. Leaving the gate on this lane turned a
  // single cause into four codes (no_date, quote_failed, class_unmapped,
  // branch_zip_missing) and made anyone with no route in the window unbookable.
  // When it is off, both `schedule` and `scheduleFailure` stay null and neither
  // failure branch below can fire.
  const scheduleGated = intent.workflow_type !== WORKFLOW_REQUEST;
  let schedule: ScheduleWindow | null = null;
  let scheduleFailure: { code: string; detail: string } | null = null;
  if (scheduleGated) try {
    schedule = await fetchScheduleWindow(intent.ldap, etTodayISO(), 21);
    if (!schedule.fresh) {
      scheduleFailure = {
        code: "schedule_stale",
        detail: `schedule watermark ${schedule.watermarkUtc ?? "missing"} is ${schedule.watermarkAgeHours?.toFixed(1) ?? "?"}h old (limit ${WATERMARK_MAX_AGE_HOURS}h)`,
      };
    }
  } catch (e: any) {
    scheduleFailure = { code: "schedule_unavailable", detail: `schedule check failed: ${e?.message ?? e}` };
  }
  const requestedDate = String(params.quote.pickupDate ?? "").slice(0, 10);
  if (!requestedDate) {
    const suggestion = schedule?.fresh ? firstWorkingDay(schedule.days, addDaysISO(etTodayISO(), 1)) : null;
    failures.push({
      code: "no_date",
      detail: scheduleFailure
        ? "runner supplied no pickup date"
        : `runner supplied no pickup date; ${suggestion ? `next working day would be ${suggestion}` : "no working day in the 21-day window"}`,
    });
    if (scheduleFailure) failures.push(scheduleFailure);
  } else if (scheduleFailure) {
    failures.push(scheduleFailure);
  } else if (schedule) {
    const day = schedule.days.find((d) => d.date === requestedDate);
    if (!day?.working) {
      const suggestion = firstWorkingDay(schedule.days, addDaysISO(etTodayISO(), 1));
      failures.push({
        code: "not_working_day",
        detail: `${requestedDate} is not a verified working day${day?.absences?.length ? ` (${day.absences.join(", ")})` : ""}; next working day: ${suggestion ?? "none in window"}`,
      });
    } else {
      // Per-tech/per-day freshness (repair spec §8): the snapshot that
      // actually carries THIS tech's selected day must be fresh — the
      // table-global watermark says nothing about a tech missing from the
      // latest load.
      const dayAge = scheduleDaySnapshotAgeHours(day);
      if (dayAge === null || dayAge > WATERMARK_MAX_AGE_HOURS) {
        failures.push({
          code: "schedule_day_stale",
          detail: `snapshot carrying ${requestedDate} for this technician is ${dayAge === null ? "unparseable" : `${dayAge.toFixed(1)}h old`} (limit ${WATERMARK_MAX_AGE_HOURS}h; the table-global watermark alone is not sufficient)`,
        });
      }
    }
  }

  if (failures.length) {
    if (deps?.beforeFinalWrite) await deps.beforeFinalWrite();
    // On failure the preview object is NOT rewritten, so `preview` keeps whatever the
    // last SUCCESSFUL run built. That made a failed run undiagnosable and actively
    // misleading: the stored preview showed ECAR offered and mapped while the live
    // failure said the class was unmapped, because the two came from different runs
    // an hour apart. Record what THIS run's quote actually saw, beside the failure.
    const stamped = await touchIntent(intent.id, {
      status: "preview_required",
      eligibility: {
        facts: publicFacts(facts),
        failures,
        checkedAt: new Date().toISOString(),
        attempted: {
          branchCode: params.quote.branchCode ?? null,
          branchName: params.quote.branchName ?? null,
          pickupDate: strOrNull(params.quote.pickupDate),
          returnDate: strOrNull(params.quote.returnDate),
          offeredClasses: params.quote.offeredClasses ?? [],
          classDecision: params.classDecision,
          warnings: params.quote.warnings ?? [],
        },
      },
      last_error: failures.map((f) => f.code).join(","),
      ...releaseClaim,
    }, postbackGuard);
    if (!stamped) throw staleDiscard();
    await mirrorCutoverSummary(intent.id);
    return { status: "preview_required", failures };
  }

  // 4. Assemble the immutable preview (the ENTIRE actual reservation).
  const sipp = params.classDecision.chosenSipp!;
  const conf = "(assigned at booking)";
  // Unique intent reference (repair spec §3): rides in the ETD references AND
  // the special notes so any later journey search can find THIS intent's
  // reservation unambiguously (pre-commit duplicate search + readbacks).
  const intentReference = `SHSNX-${intent.id}`;
  const specialNotes = isCutover
    ? renderSpecialNotes({
        tpmsTruck: facts.tpmsTruck!,
        ecars: facts.caseFacts!.ecars!,
        claim: facts.caseFacts!.claim,
        rentalStartDate: facts.caseFacts!.rentalStartDate,
        year: facts.caseFacts!.year,
        make: facts.caseFacts!.make,
        model: facts.caseFacts!.model,
        sipp,
        ldap: intent.ldap,
      }) + ` SHS Ref ${intentReference}.`
    : renderRequestSpecialNotes({
        // The request's truck of record (the technician may have corrected it
        // on the form) beats the roster's answer.
        truck: strOrNull(facts.sourceRow?.truck_number) ?? facts.tpmsTruck,
        ldap: intent.ldap,
      });
  const bookingReferences = isCutover
    ? [intent.ldap, intentReference, `CLOSE Enterprise Ticket = ${facts.caseFacts!.ecars}`, `Holman ARI Claim = ${facts.caseFacts!.claim ?? "n/a"}`]
    : [intent.ldap];

  const state = String(facts.contactState ?? "").toUpperCase();
  const quietException = QUIET_EXCEPTION_STATES[state] ?? null;
  const branchName = params.quote.branchName ?? params.quote.branchCode ?? "branch";
  const branchAddress = params.quote.branchAddress ?? "";
  const msg1Body = isCutover
    ? renderMsg1({ conf, branchName, branchAddress })
    : renderRequestMsg1({
        conf,
        branchName,
        branchAddress,
        branchPhone: params.quote.branchPhone ?? null,
        pickupDate: requestedDate,
        pickupTime: params.quote.pickupTime ?? null,
        returnDate: params.quote.returnDate ?? null,
      });
  const msg2Body = renderMsg2({ conf, branchName, branchAddress });
  const recipientPhone = facts.contactPhone ?? facts.requestFallbackPhone;

  const preview = {
    workflowType: intent.workflow_type,
    executionMode: intent.execution_mode,
    ldap: intent.ldap,
    techName: facts.techName,
    tpmsTruck: facts.tpmsTruck,
    reservation: {
      intentReference,
      pickupDate: requestedDate,
      pickupTime: params.quote.pickupTime ?? null,
      returnDate: params.quote.returnDate ?? null,
      returnTime: params.quote.returnTime ?? null,
      branchCode: params.quote.branchCode,
      branchName: params.quote.branchName,
      branchAddress: params.quote.branchAddress,
      branchPhone: params.quote.branchPhone ?? null,
      branchZip: params.quote.branchZip,
      branchZip5: zip5(params.quote.branchZip),
      branchPinned: params.quote.branchPinned,
      // What the technician said was nearest, carried beside what the quote
      // actually resolved. A cutover has no such answer to compare (it returns
      // to the contract branch, cross-checked against the case above); on a
      // request the two are independent and a disagreement is worth catching
      // BEFORE Confirm, not after a reservation exists at the wrong branch.
      reportedBranch: isCutover ? null : strOrNull(facts.sourceRow?.tech_reported_branch),
      sipp,
      classDecision: params.classDecision,
      offeredClasses: params.quote.offeredClasses ?? [],
      vehicle: isCutover
        ? { year: facts.caseFacts!.year, make: facts.caseFacts!.make, model: facts.caseFacts!.model, noVehicleChange: true }
        : null,
      bookingReferences,
      specialNotes,
      quote: {
        journeyId: params.quote.journeyId ?? null,
        reference: params.quote.reference ?? null,
        warnings: params.quote.warnings ?? [],
      },
    },
    enterpriseCase: isCutover
      ? { caseKey: facts.caseKey, ecars: facts.caseFacts!.ecars, claim: facts.caseFacts!.claim, rentalStartDate: facts.caseFacts!.rentalStartDate, vendor: facts.caseFacts!.vendor }
      : null,
    artBlock: {
      date: requestedDate,
      startTime: "08:00",
      startTimeRequest: "Exact",
      durationMinutesRequested: 30,
      unit: facts.roster!.districtNo,
      locationZip5: zip5(params.quote.branchZip),
      activityReadbackToken: "Vehicle - Change",
      flag: "VRM_CONTRACT_BLOCK_ENABLED",
      live: intent.execution_mode === "live" && isContractBlockLive(),
    },
    messages: {
      recipientPhoneOnFile: !!recipientPhone,
      recipientState: state || null,
      recipientTimeZone: stateTimeZone(state),
      quietHoursException: quietException,
      msg1: {
        moment: "evening_before_event",
        body: msg1Body,
        releaseRule: "reservation_verified AND real-2xx block_accepted",
        scheduledSend: `${addDaysISO(requestedDate, -1)} ~19:00 ${stateTimeZone(state)} (recipient-local evening before the event; quiet-hours floor still applies)`,
      },
      msg2: {
        moment: "morning_of_event",
        body: msg2Body,
        releaseRule: "HELD until block_verified; the morning sweep releases it ON the event date at the earliest compliant local time",
        scheduledSend: `${requestedDate} at send-window open${state ? ` for ${state}` : ""}${quietException ? ` — EXCEPTION STATE (${quietException} local): requires the persisted operator fallback choice` : ""}`,
        quietFallbackRequired: !!quietException,
      },
    },
    schedule: {
      // Null on a request: the lane is not schedule-gated, so nothing was fetched.
      // `requestedDateWorking` is null rather than true for the same reason — no
      // check ran, and recording a pass that never happened would be a lie in the
      // evidence a staffer reads.
      watermarkUtc: schedule?.watermarkUtc ?? null,
      watermarkAgeHours: schedule?.watermarkAgeHours ?? null,
      scheduleGated,
      requestedDateWorking: scheduleGated ? true : null,
      runnerEvidence: params.quote.scheduleEvidence ?? null,
    },
    builtAt: new Date().toISOString(),
  };

  const version = Number(intent.preview_version) + 1;
  const hash = previewHash(preview);
  const expires = new Date(Date.now() + 20 * 3600 * 1000); // bounded by next schedule load + slack

  if (deps?.beforeFinalWrite) await deps.beforeFinalWrite();
  const stamped = await touchIntent(intent.id, {
    status: "preview_ready",
    preview,
    preview_version: version,
    preview_hash: hash,
    preview_built_at: new Date(),
    preview_expires_at: expires,
    event_date: requestedDate,
    eligibility: { facts: publicFacts(facts), failures: [], checkedAt: new Date().toISOString() },
    last_error: null,
    ...releaseClaim,
  }, postbackGuard);
  if (!stamped) throw staleDiscard();
  await mirrorCutoverSummary(intent.id);
  return { status: "preview_ready", preview, previewVersion: version };
}

// ---------------------------------------------------------------------------
// Confirm (CAS on preview_version, full gate re-run)
// ---------------------------------------------------------------------------

export async function confirmIntent(params: {
  intentId: number;
  previewVersion: number;
  confirmedBy: string;
}): Promise<{ status: string; failures?: EligibilityFailure[] }> {
  const intent = await loadIntent(params.intentId);
  if (intent.status !== "preview_ready") {
    throw new OrchestratorError("bad_state", `confirm in status ${intent.status}`, 409);
  }
  // Master kill switch: a live intent created while armed cannot advance once
  // the flag is disarmed. Creation-time checking alone is not enough.
  if (intent.execution_mode === "live" && !isContractBlockLive()) {
    throw new OrchestratorError("live_disarmed", "VRM_CONTRACT_BLOCK_ENABLED is not armed; live confirms are blocked", 409);
  }

  // Full gate re-run at Confirm — drift = preview_required, no CAS attempt.
  const facts = await fetchEligibilityFacts({
    workflowType: intent.workflow_type,
    sourceId: intent.source_id,
    excludeIntentId: intent.id,
  });
  const gate = evaluateEligibility(facts);
  if (!gate.ok) {
    await touchIntent(intent.id, {
      status: "preview_required",
      eligibility: { facts: publicFacts(facts), failures: gate.failures, checkedAt: new Date().toISOString() },
      last_error: "eligibility drift at confirm",
    });
    await mirrorCutoverSummary(intent.id);
    return { status: "preview_required", failures: gate.failures };
  }

  // Input drift (repair spec §4): recompute the preview's inputs and
  // re-verify the event day. ANY change = preview_required, no CAS attempt.
  const drifts = comparePreviewToFacts(intent.preview, facts);
  const confirmEventISO = intent.event_date
    ? String(intent.event_date).slice(0, 10)
    : String(intent.preview?.reservation?.pickupDate ?? "").slice(0, 10);
  // CUTOVER ONLY, for the same reason the preview-time schedule gate is cutover only.
  // A cutover pairs its reservation with a 30-minute route block, so the day has to be
  // one the technician actually works and the snapshot has to be fresh. A rental
  // request books a car for someone standing next to a dead van today and files no
  // block: ServicePower has no say in it.
  //
  // This is the SECOND home of that gate. Making the preview-time one cutover-only was
  // not enough - every request still built a clean preview and then died here with
  // "input drift at confirm: schedule: watermark ... is 27.7h old", which reads like a
  // data problem and is really a lane problem. Observed live 2026-08-18 on all six
  // pending requests, blocked by a ServicePower snapshot 1.7h past its limit.
  const scheduleGatedAtConfirm = intent.workflow_type !== WORKFLOW_REQUEST;
  const sched = !scheduleGatedAtConfirm
    ? { ok: true, detail: "" }
    : confirmEventISO
      ? await recheckScheduleDay(intent.ldap, confirmEventISO)
      : { ok: false, detail: "intent has no event date to re-verify" };
  if (!sched.ok) drifts.push(`schedule: ${sched.detail}`);
  if (drifts.length) {
    await touchIntent(intent.id, {
      status: "preview_required",
      last_error: `input drift at confirm: ${drifts.slice(0, 6).join("; ")}`,
    });
    await mirrorCutoverSummary(intent.id);
    return { status: "preview_required", failures: drifts.map((d) => ({ code: "input_drift", detail: d })) };
  }

  const { rows } = await db.execute(sql`
    UPDATE vrm_rental_workflow_intents
    SET status = 'confirmed',
        confirmed_at = now(),
        confirmed_by = ${params.confirmedBy},
        confirmed_preview_version = ${params.previewVersion},
        updated_at = now()
    WHERE id = ${params.intentId}
      AND status = 'preview_ready'
      AND preview_version = ${params.previewVersion}
      AND preview_expires_at > now()
    RETURNING id
  `);
  if ((rows as any[]).length === 0) {
    const now = await loadIntent(params.intentId);
    const reason =
      Number(now.preview_version) !== Number(params.previewVersion)
        ? "preview_version mismatch (preview changed since you loaded it)"
        : now.preview_expires_at && new Date(now.preview_expires_at) <= new Date()
          ? "preview expired"
          : `status ${now.status}`;
    await touchIntent(params.intentId, { status: "preview_required", last_error: `confirm rejected: ${reason}` });
    await mirrorCutoverSummary(params.intentId);
    return { status: "preview_required", failures: [{ code: "confirm_cas_failed", detail: reason }] };
  }
  await mirrorCutoverSummary(params.intentId);
  return { status: "confirmed" };
}

// ---------------------------------------------------------------------------
// Request-lane input edits. approved_vehicle_class lives on the REQUEST row,
// outside any intent, so the request routes call these two before and after
// changing it — an edit must never slide under a booking already past
// Confirm, and a built preview must never survive an input it no longer
// reflects. (Confirm's gate re-run checks eligibility, not input equality,
// so without the explicit knock-back a stale preview_ready would still
// confirm and book the old class.)
// ---------------------------------------------------------------------------

/**
 * Statuses where something external may already exist or is authorized to:
 * a confirmed preview, an open ETD attempt, an unverified or verified
 * reservation, or an attempt parked for a human. Pre-confirm statuses are
 * deliberately absent (previews rebuild); so are the terminal three (nothing
 * a terminal intent did can be un-decided by an input edit).
 */
export async function requestBookingInFlight(
  sourceId: string,
): Promise<{ id: number; status: string } | null> {
  const { rows } = await db.execute(sql`
    SELECT id, status FROM vrm_rental_workflow_intents
    WHERE workflow_type = ${WORKFLOW_REQUEST} AND source_id = ${sourceId}
      AND status IN ('confirmed', 'booking', 'awaiting_verification', 'booking_unknown',
                     'block_conflict_pending_readback', 'manual_review', 'reservation_verified')
    ORDER BY id DESC LIMIT 1
  `);
  const r = (rows as any[])[0];
  return r ? { id: Number(r.id), status: String(r.status) } : null;
}

/** Knock built-but-unconfirmed previews back so they re-quote under the new inputs. */
export async function invalidateRequestPreviews(sourceId: string, reason: string): Promise<number> {
  const { rows } = await db.execute(sql`
    UPDATE vrm_rental_workflow_intents
    SET status = 'preview_required', last_error = ${reason}, updated_at = now()
    WHERE workflow_type = ${WORKFLOW_REQUEST} AND source_id = ${sourceId}
      AND status IN ('preview_pending', 'preview_ready')
    RETURNING id
  `);
  for (const r of rows as any[]) await mirrorCutoverSummary(Number(r.id));
  return (rows as any[]).length;
}

// ---------------------------------------------------------------------------
// Booking postbacks (op_open / op_result / readback)
// ---------------------------------------------------------------------------

export async function recordBookingPostback(params: {
  intentId: number;
  runnerId: string;
  fencingToken: number;
  phase: "op_open" | "op_result" | "readback";
  payload: any;
}): Promise<any> {
  const intent = await verifyClaim(params.intentId, params.runnerId, params.fencingToken, {
    // op_open authorizes a NEW external call — the lease must still be live.
    // op_result/readback record evidence of an already-opened attempt, so they
    // stay accepted late (the fencing token still rejects superseded claimants).
    requireActiveLease: params.phase === "op_open",
  });

  // Terminal intents ACK idempotently and mutate NOTHING: late or duplicate
  // postbacks (runner retries, proxy replays) must never revive a
  // completed/cancelled/abandoned intent. op_open keeps its hard 409 — it
  // authorizes a NEW external call and must never look like a success.
  if (TERMINAL_STATUSES.has(intent.status)) {
    if (params.phase === "op_open") {
      throw new OrchestratorError("bad_state", `op_open in status ${intent.status}`, 409);
    }
    return { accepted: true, status: intent.status, idempotent: true };
  }

  if (params.phase === "op_open") {
    if (intent.status !== "booking") {
      throw new OrchestratorError("bad_state", `op_open in status ${intent.status}`, 409);
    }
    if (intent.execution_mode === "live" && !isContractBlockLive()) {
      throw new OrchestratorError("live_disarmed", "VRM_CONTRACT_BLOCK_ENABLED is not armed; live external operations are blocked", 409);
    }
    // Immediately-before-booking gate re-run (plan): any drift = preview_required.
    const facts = await fetchEligibilityFacts({
      workflowType: intent.workflow_type,
      sourceId: intent.source_id,
      excludeIntentId: intent.id,
    });
    const gate = evaluateEligibility(facts);
    if (!gate.ok) {
      await touchIntent(intent.id, {
        status: "preview_required",
        eligibility: { facts: publicFacts(facts), failures: gate.failures, checkedAt: new Date().toISOString() },
        last_error: "eligibility drift immediately before booking",
        claimed_by: null,
        lease_expires_at: null,
      });
      await mirrorCutoverSummary(intent.id);
      return { accepted: false, status: "preview_required", failures: gate.failures };
    }
    // Input drift (repair spec §4) — same comparator as Confirm, immediately
    // before the external call is authorized.
    const drifts = comparePreviewToFacts(intent.preview, facts);
    const openEventISO = intent.event_date ? String(intent.event_date).slice(0, 10) : "";
    const sched = openEventISO
      ? await recheckScheduleDay(intent.ldap, openEventISO)
      : { ok: false, detail: "intent has no event date to re-verify" };
    if (!sched.ok) drifts.push(`schedule: ${sched.detail}`);
    if (drifts.length) {
      await touchIntent(intent.id, {
        status: "preview_required",
        last_error: `input drift immediately before booking: ${drifts.slice(0, 6).join("; ")}`,
        claimed_by: null,
        lease_expires_at: null,
      });
      await mirrorCutoverSummary(intent.id);
      return { accepted: false, status: "preview_required", failures: drifts.map((d) => ({ code: "input_drift", detail: d })) };
    }
    const { attemptNo } = await openBookingAttempt(intent.id, params.runnerId, params.fencingToken, params.payload);
    return { accepted: true, attemptNo };
  }

  if (params.phase === "op_result") {
    const outcome = String(params.payload?.outcome ?? "");

    // Runner aborted BEFORE op_open side effects (fresh quote no longer matches
    // the confirmed preview: branch/class/date drift). Nothing external
    // happened and no attempt row exists — back to preview so a human re-reviews.
    if (outcome === "aborted_before_open") {
      await touchIntent(intent.id, {
        status: "preview_required",
        last_error: `runner abort: ${strOrNull(params.payload?.evidence?.reason) ?? "fresh quote diverged from confirmed preview"}`,
        claimed_by: null,
        lease_expires_at: null,
      });
      await mirrorCutoverSummary(intent.id);
      return { accepted: true, status: "preview_required" };
    }

    const attemptNo = Number(params.payload?.attemptNo);
    if (!attemptNo) throw new OrchestratorError("bad_payload", "attemptNo required", 400);
    await db.execute(sql`
      UPDATE vrm_workflow_attempts
      SET outcome = ${outcome}, finished_at = now(), evidence = ${JSON.stringify(params.payload?.evidence ?? {})}::jsonb
      WHERE intent_id = ${intent.id} AND phase = 'etd_booking' AND attempt_no = ${attemptNo} AND outcome IS NULL
    `);

    if (outcome === "dry_run_validated") {
      // Dark modes only: the runner ran every non-mutating gate (quote,
      // validateLocAddInfo, validate) and STOPPED before the commit. There is
      // no reservation, so the intent parks at awaiting_verification with a
      // dark reservation_state — readbacks skip it, completion never fires.
      // Block filing still proceeds: dry_run records would_file; test files a
      // real TEST-prefixed block.
      if (intent.execution_mode === "live") {
        throw new OrchestratorError("bad_payload", "dry_run_validated is not a live outcome", 400);
      }
      await touchIntent(intent.id, {
        reservation_state: "dry_run_validated",
        status: "awaiting_verification",
        reservation_evidence: {
          dryRunValidated: true,
          gates: params.payload?.evidence?.gates ?? null,
          attemptNo,
          at: new Date().toISOString(),
        },
        last_error: null,
        claimed_by: null,
        lease_expires_at: null,
      });
      await mirrorCutoverSummary(intent.id);
      await fileContractBlock(intent.id);
      await releaseMessagesIfEligible(intent.id);
      return { accepted: true, status: (await loadIntent(intent.id)).status };
    }

    if (outcome === "booked") {
      const confirmation = strOrNull(params.payload?.evidence?.confirmation);
      // A cutover still waits for an independent journey readback before anyone
      // is texted. A request cannot: ETD's /api/myjourney/search ignores both
      // SearchCriteria and Period (every value returns the same rows, a nonsense
      // criteria included) and returns only past-dated journeys, so a future
      // pickup is never in it. Gating on it parked every booked request at
      // manual_review forever. The savedr response carrying a confirmation
      // number is the proof, and it is recorded as that rather than passed off
      // as a readback.
      const verifiedOnCommit = intent.workflow_type === WORKFLOW_REQUEST && !!confirmation;
      await touchIntent(intent.id, {
        reservation_state: verifiedOnCommit ? "verified" : "booked_unverified",
        status: verifiedOnCommit ? "reservation_verified" : "awaiting_verification",
        reservation_evidence: {
          confirmation,
          verifiedBy: verifiedOnCommit ? "commit_response" : null,
          bookedAt: new Date().toISOString(),
          attemptNo,
          raw: params.payload?.evidence ?? null,
        },
        last_error: null,
        ...(verifiedOnCommit ? { claimed_by: null, lease_expires_at: null } : {}),
      });
      if (verifiedOnCommit) {
        // Close the request row so the queue and the card both read 'booked'
        // instead of an approved row that silently already has a car.
        await db.execute(sql`
          UPDATE vrm_rental_request
             SET status = 'booked',
                 etd_reference = ${confirmation},
                 etd_reservation_id = ${strOrNull(params.payload?.evidence?.quoteReference)},
                 etd_booked_at = now(),
                 etd_error = NULL,
                 updated_at = now()
           WHERE request_no = ${Number(intent.source_id)}
        `);
        await mirrorCutoverSummary(intent.id);
        await releaseMessagesIfEligible(intent.id);
        // The request lane ends HERE. completionSatisfied already says so - a request
        // completes on its verified reservation alone, with no block and no second
        // text - but only the journey-readback path ever called finalizeCompletion,
        // and a request never takes that path. So a booked request parked at
        // reservation_verified forever, which deriveDisplayPhase renders as
        // "Wrapping up": permanently amber-to-green limbo on a job that was finished
        // the moment Enterprise returned a confirmation number.
        const settledReq = await loadIntent(intent.id);
        if (!TERMINAL_STATUSES.has(settledReq.status) && completionSatisfied(settledReq)) {
          if (await finalizeCompletion(intent.id, settledReq.status)) {
            await mirrorCutoverSummary(intent.id);
          }
        }
      }
    } else if (outcome === "failed_clean") {
      // Proven no reservation was created (validation-gate failure before the
      // confirm call). No auto-retry for bookings — a human decides.
      await touchIntent(intent.id, {
        status: "manual_review",
        reservation_state: "failed",
        last_error: `booking failed clean: ${strOrNull(params.payload?.evidence?.error) ?? "unknown"}`,
        claimed_by: null,
        lease_expires_at: null,
      });
    } else {
      // timeout / ambiguous / unparsed — we may or may not have booked.
      await touchIntent(intent.id, {
        status: "booking_unknown",
        reservation_state: "unknown",
        last_error: `booking outcome ${outcome}: ${strOrNull(params.payload?.evidence?.error) ?? "ambiguous"}`,
        claimed_by: null,
        lease_expires_at: null,
      });
    }
    await mirrorCutoverSummary(intent.id);
    return { accepted: true, status: (await loadIntent(intent.id)).status };
  }

  // phase === 'readback'
  const matches: JourneyMatch[] = Array.isArray(params.payload?.matches) ? params.payload.matches : [];
  // Search meta (repair spec §3): "nothing found" is only meaningful when the
  // runner says the search itself SUCCEEDED and its criteria actually cover
  // this intent's identifiers. A search error posted as an empty match list
  // must never masquerade as an authoritative none.
  const searchMeta = params.payload?.search ?? null;
  const searchOk = String(searchMeta?.status ?? "") === "ok";
  const intentRef = `SHSNX-${intent.id}`;
  const confExpected =
    strOrNull(params.payload?.expected?.confirmation) ?? strOrNull(intent.reservation_evidence?.confirmation) ?? "";
  const normUp = (v: unknown) => String(v ?? "").trim().toUpperCase();
  const criteriaList: string[] = Array.isArray(searchMeta?.criteria)
    ? (searchMeta.criteria as any[]).map((c) => String(c))
    : searchMeta?.criteria != null
      ? [String(searchMeta.criteria)]
      : [];
  const criteriaAuthoritative =
    searchOk &&
    criteriaList.some((c) => {
      const n = normUp(c);
      return (
        n.includes(normUp(intentRef)) ||
        (confExpected !== "" && n === normUp(confExpected)) ||
        (intent.ldap && n.includes(normUp(intent.ldap)))
      );
    });

  // What the search ACTUALLY saw, recorded verbatim. `rowsReturned` is every
  // journey ETD handed back for the criteria; `matches.length` is how many of
  // them positively identified as this intent's reservation. A bare match count
  // cannot tell a later reader whether a "none" meant an empty answer or dozens
  // of unrelated quote journeys, and that distinction is exactly what a phantom
  // duplicate looks like in the ledger.
  const rowsReturnedRaw = Number(searchMeta?.rowsReturned);
  const searchSummary = {
    status: searchOk ? "ok" : String(searchMeta?.status ?? "missing"),
    criteria: criteriaList,
    rowsReturned: Number.isFinite(rowsReturnedRaw) ? rowsReturnedRaw : null,
    identified: matches.length,
    authoritative: criteriaAuthoritative,
    error: strOrNull(searchMeta?.error),
  };
  const searchNote =
    `search: ${searchSummary.identified} identified of ${searchSummary.rowsReturned ?? "?"} row(s)` +
    ` on [${criteriaList.join(", ") || "no criteria"}]`;

  const expected: JourneyExpected = {
    confirmation: confExpected,
    ldap: intent.ldap,
    intentRef: intent.workflow_type === WORKFLOW_CUTOVER ? intentRef : null,
    branchCode: intent.preview?.reservation?.branchCode ?? null,
    date: intent.event_date ? String(intent.event_date).slice(0, 10) : null,
    sipp: intent.preview?.reservation?.sipp ?? null,
  };
  const verdict = classifyJourneyReadback(expected, matches);

  // A none that is NOT authoritative changes NOTHING: any open attempt stays
  // open (booking stays fenced), the status keeps, and the reason is loud.
  // This is the rebook safety valve — booking_unknown must never become
  // bookable off a failed or mis-keyed search.
  if (verdict.verdict === "none" && !criteriaAuthoritative) {
    await touchIntent(intent.id, {
      last_error: searchOk
        ? `readback inconclusive: search criteria did not cover this intent's reference identifiers (${searchNote})`
        : `readback inconclusive: journey search did not succeed (${strOrNull(searchMeta?.error) ?? "no search status posted"}; ${searchNote})`,
    });
    return {
      accepted: true,
      status: intent.status,
      readback: { verdict: "inconclusive", reason: "journey search was not authoritative; state unchanged" },
    };
  }

  // Close any dangling attempt with what the readback proved.
  const { rows: open } = await db.execute(sql`
    SELECT attempt_no FROM vrm_workflow_attempts
    WHERE intent_id = ${intent.id} AND phase = 'etd_booking' AND outcome IS NULL
    ORDER BY attempt_no DESC LIMIT 1
  `);
  const openAttempt = (open as any[])[0]?.attempt_no ?? null;
  if (openAttempt != null) {
    await db.execute(sql`
      UPDATE vrm_workflow_attempts
      SET outcome = ${verdict.verdict === "verified" ? "booked_via_readback" : verdict.verdict === "none" ? "no_reservation_found" : "readback_" + verdict.verdict},
          finished_at = now(),
          evidence = ${JSON.stringify({ readback: verdict, matches, search: searchSummary })}::jsonb
      WHERE intent_id = ${intent.id} AND phase = 'etd_booking' AND attempt_no = ${openAttempt}
    `);
  }

  // Cancel lane (repair spec §4): a cancel_pending_readback intent is waiting
  // for PROOF before its terminal write. Authoritative-none → cancelled.
  // Anything found → manual_review: a human cancels in ETD, then records
  // cancellation evidence via recordCancellationEvidence.
  if (intent.status === "cancel_pending_readback") {
    if (verdict.verdict === "none") {
      const { rows: c } = await db.execute(sql`
        UPDATE vrm_rental_workflow_intents
        SET status = 'cancelled',
            last_error = 'cancel confirmed: authoritative readback found no active reservation',
            claimed_by = NULL, lease_expires_at = NULL, updated_at = now()
        WHERE id = ${intent.id} AND status = 'cancel_pending_readback'
        RETURNING id
      `);
      await mirrorCutoverSummary(intent.id);
      return {
        accepted: true,
        status: (c as any[]).length ? "cancelled" : (await loadIntent(intent.id)).status,
        readback: verdict,
      };
    }
    await touchIntent(intent.id, {
      status: "manual_review",
      last_error: `cancel blocked: readback ${verdict.verdict} — an active reservation may exist; cancel it in ETD manually, then record cancellation evidence (${verdict.reason}; ${searchNote})`,
      claimed_by: null,
      lease_expires_at: null,
    }, { statusIn: ["cancel_pending_readback"] });
    await mirrorCutoverSummary(intent.id);
    return { accepted: true, status: (await loadIntent(intent.id)).status, readback: verdict };
  }

  if (verdict.verdict === "verified") {
    // CAS: advance only from the statuses a journey readback may legitimately
    // move (normal verify, reconcile-directed retry, parked unknown). A rival
    // writer — cancel, duplicate readback, sweep — makes this lose, and a
    // loser must ACK idempotently without rewriting anything.
    const verifiedEvidence = JSON.stringify({
      ...(intent.reservation_evidence ?? {}),
      confirmation: expected.confirmation || strOrNull(matches[0]?.confirmation),
      verifiedAt: new Date().toISOString(),
      readback: verdict,
      match: matches[0] ?? null,
    });
    const { rows: advanced } = await db.execute(sql`
      UPDATE vrm_rental_workflow_intents
      SET reservation_state = 'verified', status = 'reservation_verified',
          reservation_evidence = ${verifiedEvidence}::jsonb, last_error = NULL, updated_at = now()
      WHERE id = ${intent.id}
        AND status IN ('awaiting_verification', 'booking', 'booking_unknown')
      RETURNING id
    `);
    if (!(advanced as any[]).length) {
      const cur = await loadIntent(intent.id);
      return { accepted: true, status: cur.status, readback: verdict, idempotent: true };
    }
    await mirrorCutoverSummary(intent.id);
    // Reservation verified → file the block, then evaluate message releases.
    await fileContractBlock(intent.id);
    await releaseMessagesIfEligible(intent.id);
    // The REQUEST workflow ends here — a verified reservation is completion
    // (no block, no texts). For cutover this check no-ops: its completion
    // still demands block_verified + both texts, which take until morning.
    // Guarded on the observed status so a concurrent cancel can never be
    // overwritten back to completed.
    const settled = await loadIntent(intent.id);
    if (!TERMINAL_STATUSES.has(settled.status) && completionSatisfied(settled)) {
      // Terminal completion is transactional with the tracking write (§5).
      if (await finalizeCompletion(intent.id, settled.status)) {
        await mirrorCutoverSummary(intent.id);
      }
    }
    return { accepted: true, status: (await loadIntent(intent.id)).status, readback: verdict };
  }

  // Clean-none applies to a parked unknown AND to a reconcile-directed retry
  // (status already back at 'booking' with reservation_state 'unknown').
  const reconcilableNone =
    intent.status === "booking_unknown" ||
    (intent.status === "booking" && intent.reservation_state === "unknown");
  if (verdict.verdict === "none" && reconcilableNone) {
    // Clean reconcile: nothing was booked. Safe to make bookable again — retry
    // still requires the normal claim + op_open discipline (never automatic).
    //
    // But "reconciled clean" is not the WHOLE truth and must not be the last word.
    // The usual road here is a refused commit: Enterprise said no, the readback
    // (correctly) found nothing, and a bare "reconciled clean" then overwrites the only
    // explanation the operator has with a reassurance. Keep the refusal in front — the
    // state change is the same either way.
    const refusal = await latestBookingFailureReason(intent.id);
    await touchIntent(intent.id, {
      status: "confirmed",
      reservation_state: "pending",
      last_error: refusal
        ? clipText(
            `no reservation created — Enterprise refused: ${refusal}` +
              ` (readback confirmed none exists; bookable again)`,
            600,
          )
        : "readback found no reservation; reconciled clean",
      claimed_by: null,
      lease_expires_at: null,
    });
    await mirrorCutoverSummary(intent.id);
    return { accepted: true, status: "confirmed", readback: verdict };
  }

  // A REQUEST that already holds a confirmation must never park here. The journey
  // search cannot see a future-dated reservation at all, so its verdict says nothing
  // about whether the car exists. Verify on the commit response, which is this lane's
  // rule everywhere else.
  if (intent.workflow_type === WORKFLOW_REQUEST && (await verifyRequestOnCommitEvidence(intent.id))) {
    return { accepted: true, status: (await loadIntent(intent.id)).status, readback: verdict };
  }

  await touchIntent(intent.id, {
    status: "manual_review",
    last_error: `journey readback ${verdict.verdict}: ${verdict.reason} (${searchNote})`,
    claimed_by: null,
    lease_expires_at: null,
  });
  await mirrorCutoverSummary(intent.id);
  return { accepted: true, status: "manual_review", readback: verdict };
}

// ---------------------------------------------------------------------------
// ART block filing
// ---------------------------------------------------------------------------

export type BlockReconcileDeps = {
  /** Injectable readback source (tests); defaults to the live ART snapshot. */
  fetchRows?: typeof fetchBlockReadbackRows;
};

export type BlockReconcileOutcome = "none" | "recovered" | "cleared" | "ambiguous" | "manual";

/**
 * Crash recovery for ART filing. An OPEN art_block attempt (outcome IS NULL)
 * means a previous fileContractBlock died between the ledger INSERT and the
 * outcome UPDATE — the POST may or may not have reached ART. Readback decides:
 *  - "none"      — no open attempt; the caller may file fresh.
 *  - "recovered" — a matching block exists in a post-open snapshot: adopt it
 *                  (attempt closed accepted_reconciled, block_state=accepted,
 *                  block_submitted_at=attempt open time) — the sweep verifies
 *                  and releases via its normal lane next run.
 *  - "cleared"   — a fresh snapshot has NO block-token row for the day: the
 *                  POST provably never landed. Attempt closed
 *                  abandoned_no_trace; block_state=retry (refiles next sweep).
 *  - "manual"    — a fresh snapshot has block-like rows that don't match the
 *                  spec (a mangled filing may own them): human decides.
 *  - "ambiguous" — no post-open snapshot yet, or the readback errored: the
 *                  attempt STAYS OPEN, so filing remains fenced; retried on
 *                  the next sweep.
 */
export async function reconcileOpenBlockAttempt(
  intentId: number,
  deps?: BlockReconcileDeps,
): Promise<BlockReconcileOutcome> {
  const fetchRows = deps?.fetchRows ?? fetchBlockReadbackRows;
  const intent = await loadIntent(intentId);
  const { rows: open } = await db.execute(sql`
    SELECT attempt_no, started_at FROM vrm_workflow_attempts
    WHERE intent_id = ${intentId} AND phase = 'art_block' AND outcome IS NULL
    ORDER BY attempt_no DESC LIMIT 1
  `);
  const att = (open as any[])[0];
  if (!att) return "none";

  // Grace: a very fresh open attempt is almost certainly an in-flight filing,
  // not a strand — judging it here would race the owner's finalize (e.g. a
  // snapshot load landing mid-POST could mis-clear it). Leave it fenced.
  if (Date.now() - new Date(att.started_at).getTime() < 10 * 60 * 1000) {
    return "ambiguous";
  }

  // Reconcile claim: exactly ONE reconciler may judge this strand at a time.
  // Overlapping sweeps (cron + admin trigger + a postback-driven filing's
  // pre-check) can otherwise read snapshots that advance mid-flight, reach
  // DIVERGENT verdicts, and interleave parent writes (A adopts a landed
  // block, B no-trace-clears → refile → double-file). Lease-style: a crashed
  // claimant self-heals after 10 minutes.
  const { rows: rClaim } = await db.execute(sql`
    UPDATE vrm_workflow_attempts
    SET reconcile_claimed_at = now()
    WHERE intent_id = ${intentId} AND phase = 'art_block' AND attempt_no = ${att.attempt_no}
      AND outcome IS NULL
      AND (reconcile_claimed_at IS NULL OR reconcile_claimed_at < now() - interval '10 minutes')
    RETURNING attempt_no
  `);
  if ((rClaim as any[]).length === 0) return "ambiguous";

  const releaseReconcileClaim = async () => {
    await db.execute(sql`
      UPDATE vrm_workflow_attempts SET reconcile_claimed_at = NULL
      WHERE intent_id = ${intentId} AND phase = 'art_block' AND attempt_no = ${att.attempt_no} AND outcome IS NULL
    `);
  };

  const closeAttempt = async (outcome: string, evidence: Record<string, unknown>) => {
    await db.execute(sql`
      UPDATE vrm_workflow_attempts
      SET outcome = ${outcome}, finished_at = now(), evidence = ${JSON.stringify(evidence)}::jsonb
      WHERE intent_id = ${intentId} AND phase = 'art_block' AND attempt_no = ${att.attempt_no} AND outcome IS NULL
    `);
  };

  // Finalize ORDER everywhere below: parent state FIRST, attempt-close LAST.
  // A crash between the two re-presents as parent-advanced + open attempt,
  // which this same lane re-resolves idempotently on the next pass. The
  // reverse order (closed attempt + stale parent) would un-fence filing
  // while the parent still looks claimable — the double-file window.
  // Parent writes below are MONOTONIC: each is a guarded UPDATE that only
  // lands on states a filing can still own (in-write predicate re-check).
  // Zero rows = the parent advanced under us — our verdict is stale
  // evidence; release the claim, leave the attempt open, re-judge later.
  const dateISO = intent.event_date ? String(intent.event_date).slice(0, 10) : null;
  if (!dateISO) {
    const { rows: w } = await db.execute(sql`
      UPDATE vrm_rental_workflow_intents
      SET block_state = 'failed', status = 'manual_review', updated_at = now(),
          last_error = 'open ART attempt found but intent has no event_date to read back against'
      WHERE id = ${intentId}
        AND block_state IN ('pending','retry','filing','manual_repair','failed')
      RETURNING id
    `);
    if ((w as any[]).length === 0) {
      await releaseReconcileClaim();
      return "ambiguous";
    }
    await closeAttempt("reconcile_manual_review", { reason: "no event_date; cannot read back", at: new Date().toISOString() });
    await mirrorCutoverSummary(intentId);
    return "manual";
  }

  const openedAtMs = new Date(att.started_at).getTime();
  const expectedZip = intent.preview?.artBlock?.locationZip5 ?? zip5(intent.preview?.reservation?.branchZip);
  let rbRows: BlockReadbackRow[];
  let watermarkUtc: string | null;
  try {
    ({ rows: rbRows, watermarkUtc } = await fetchRows(intent.ldap, dateISO));
  } catch (e: any) {
    // Transient readback failure: attempt stays open (filing stays fenced).
    await touchIntent(intentId, { last_error: `ART reconcile readback failed: ${e?.message ?? e}` });
    await releaseReconcileClaim();
    return "ambiguous";
  }
  const verdict = classifyBlockReadback({
    rows: rbRows,
    blockSubmittedAt: att.started_at, // the POST (if any) happened after the ledger INSERT
    expectedZip5: expectedZip || "",
    globalWatermark: watermarkUtc,
  });

  if (verdict.verdict === "block_verified") {
    const acceptedEvidence = JSON.stringify({
      ...(intent.block_evidence ?? {}),
      reconciled: true,
      readback: verdict,
      at: new Date().toISOString(),
    });
    // 'accepted' allowed for the idempotent re-assert of a half-finalized
    // adoption (crash between parent write and attempt close).
    const { rows: w } = await db.execute(sql`
      UPDATE vrm_rental_workflow_intents
      SET block_state = 'accepted',
          block_submitted_at = ${new Date(att.started_at).toISOString()}::timestamptz,
          block_evidence = ${acceptedEvidence}::jsonb,
          last_error = NULL, updated_at = now()
      WHERE id = ${intentId}
        AND block_state IN ('pending','retry','filing','accepted')
      RETURNING id
    `);
    if ((w as any[]).length === 0) {
      await releaseReconcileClaim();
      return "ambiguous";
    }
    await closeAttempt("accepted_reconciled", { readback: verdict, at: new Date().toISOString() });
    await mirrorCutoverSummary(intentId);
    return "recovered";
  }
  if (verdict.verdict === "verification_pending") {
    // No snapshot loaded after the attempt opened — cannot prove either way.
    await touchIntent(intentId, { last_error: `ART reconcile pending: ${verdict.reason}` });
    await releaseReconcileClaim();
    return "ambiguous";
  }
  // A fresh snapshot exists. If it carries ANY block-token row for the day,
  // the interrupted POST may have landed with mangled fields — never refile
  // over it; a human decides. If it has no block-ish row at all, the POST
  // provably never landed: clear the ledger and refile on the next sweep.
  const freshBlockish = rbRows.filter(
    (r) => new Date(r.snapshotTs).getTime() > openedAtMs && normalizeActivity(r.activity) === BLOCK_ACTIVITY_TOKEN,
  );
  if (freshBlockish.length) {
    const { rows: w } = await db.execute(sql`
      UPDATE vrm_rental_workflow_intents
      SET block_state = 'manual_repair', status = 'manual_review', updated_at = now(),
          last_error = ${`ART reconcile: fresh snapshot has block-like rows that don't match the spec — human review (${verdict.reason})`}
      WHERE id = ${intentId}
        AND block_state IN ('pending','retry','filing','manual_repair','failed')
      RETURNING id
    `);
    if ((w as any[]).length === 0) {
      await releaseReconcileClaim();
      return "ambiguous";
    }
    await closeAttempt("reconcile_manual_review", { readback: verdict, near: freshBlockish, at: new Date().toISOString() });
    await mirrorCutoverSummary(intentId);
    return "manual";
  }
  // No-trace → retry is the most dangerous downgrade: it re-arms filing. It
  // may ONLY land on states that still own an unresolved filing — never over
  // accepted/verified/conflict/manual (another writer's resolved decision).
  const { rows: w } = await db.execute(sql`
    UPDATE vrm_rental_workflow_intents
    SET block_state = 'retry', next_retry_at = now(), updated_at = now(),
        last_error = 'ART attempt interrupted; readback shows no trace — refiling on next sweep'
    WHERE id = ${intentId}
      AND block_state IN ('pending','retry','filing')
    RETURNING id
  `);
  if ((w as any[]).length === 0) {
    await releaseReconcileClaim();
    return "ambiguous";
  }
  await closeAttempt("abandoned_no_trace", { readback: verdict, at: new Date().toISOString() });
  await mirrorCutoverSummary(intentId);
  return "cleared";
}

/** Sweep lane: reconcile every stranded open art_block attempt (crash recovery). */
export async function reconcileOpenBlockAttempts(deps?: BlockReconcileDeps): Promise<number> {
  const { rows } = await db.execute(sql`
    SELECT DISTINCT i.id FROM vrm_rental_workflow_intents i
    JOIN vrm_workflow_attempts a
      ON a.intent_id = i.id AND a.phase = 'art_block' AND a.outcome IS NULL
    WHERE i.status NOT IN ('completed','cancelled','abandoned')
    ORDER BY i.id
    LIMIT 20
  `);
  let n = 0;
  for (const r of rows as any[]) {
    try {
      if ((await reconcileOpenBlockAttempt(r.id, deps)) !== "none") n++;
    } catch (e: any) {
      console.error(`[cutover] block reconcile failed for intent ${r.id}:`, e?.message ?? e);
    }
  }

  // Pre-INSERT crash shape: a filing claim with NO open attempt means the CAS
  // was won but the ledger INSERT never ran — provably nothing was POSTed
  // (the POST strictly follows the INSERT). Re-park after a grace window;
  // the retry sweep (which runs after this lane) picks it straight up.
  const { rows: staleClaims } = await db.execute(sql`
    UPDATE vrm_rental_workflow_intents i
    SET block_state = 'retry', next_retry_at = now(), updated_at = now(),
        last_error = 'filing claim interrupted before any attempt was recorded; re-parked'
    WHERE i.block_state = 'filing'
      AND i.updated_at < now() - interval '10 minutes'
      AND i.status NOT IN ('completed','cancelled','abandoned')
      AND NOT EXISTS (
        SELECT 1 FROM vrm_workflow_attempts a
        WHERE a.intent_id = i.id AND a.phase = 'art_block' AND a.outcome IS NULL
      )
    RETURNING i.id
  `);
  n += (staleClaims as any[]).length;
  return n;
}

export async function fileContractBlock(intentId: number, deps?: BlockReconcileDeps): Promise<void> {
  const intent = await loadIntent(intentId);
  // Live path requires a VERIFIED reservation. Dark modes have no reservation
  // to verify — the runner's dry_run_validated outcome is their trigger, so
  // the block lane (would_file / TEST filing) still gets exercised end-to-end.
  const darkValidated = intent.execution_mode !== "live" && intent.reservation_state === "dry_run_validated";
  if (intent.reservation_state !== "verified" && !darkValidated) return;
  if (!["pending", "retry"].includes(intent.block_state)) return;

  // Route blocks are CUTOVER-ONLY (Tyler 2026-08-16): a new-rental request
  // protects no existing route — its workflow ends at a verified booking.
  // New request intents are created with block_state='not_applicable' and
  // never reach here; this branch just normalizes any legacy block-shaped
  // request row. No filing, no attempt, ever.
  if (intent.workflow_type === WORKFLOW_REQUEST) {
    await touchIntent(intentId, {
      block_state: "not_applicable",
      block_evidence: {
        notApplicable: true,
        reason: "route blocks are cutover-only; the request workflow never files one",
        at: new Date().toISOString(),
      },
    });
    await mirrorCutoverSummary(intentId);
    return;
  }

  const preview = intent.preview ?? {};
  const art = preview.artBlock ?? {};
  const dateISO = intent.event_date ? String(intent.event_date).slice(0, 10) : art.date;
  const unit = art.unit ?? null;
  const locZip = art.locationZip5 ?? null;
  if (!dateISO || !unit || !locZip) {
    await touchIntent(intentId, {
      block_state: "failed",
      status: "manual_review",
      last_error: "block spec incomplete (date/unit/zip missing from preview)",
    });
    await mirrorCutoverSummary(intentId);
    return;
  }

  const live = intent.execution_mode === "live" && isContractBlockLive();
  const conf = strOrNull(intent.reservation_evidence?.confirmation) ?? "n/a";
  const ecars = preview.enterpriseCase?.ecars ?? "n/a";
  const claim = preview.enterpriseCase?.claim ?? null;
  const args: StandardActivityArgs = {
    techLdap: intent.ldap,
    unit: String(unit),
    truckNumber: String(intent.truck_number ?? preview.tpmsTruck ?? ""),
    date: dateISO,
    locationZip: locZip,
    durationMinutes: 30,
    startTime: "08:00",
    startTimeRequest: "Exact",
    projectLabel: "Vehicle Change",
    projectNotes: `Cutover intent #${intent.id}: Enterprise billing changeover; reservation ${conf}.`,
    rowNotes: `SHS TRUCK ${intent.truck_number ?? "?"}. Enterprise ${preview.reservation?.branchName ?? ""} ${preview.reservation?.branchAddress ?? ""}. Reservation ${conf}. ECARS ${ecars}${claim ? `, ARI claim ${claim}` : ""}. Billing changeover — tech keeps current vehicle. Intent #${intent.id}.`,
    submittedBy: "cutover-workflow",
    live,
  };
  const { projectName, body } = buildStandardActivityPayload(args);

  // dry_run mode: record what WOULD be filed; no external call at all.
  if (intent.execution_mode === "dry_run") {
    await touchIntent(intentId, {
      block_state: "dry_run_would_file",
      block_evidence: { wouldFile: true, projectName, payload: body, at: new Date().toISOString() },
    });
    await mirrorCutoverSummary(intentId);
    return;
  }

  // Crash recovery FIRST: an open attempt means an unresolved external op.
  // That question outranks even the kill switch — reconcile is read-only and
  // must keep the ledger honest regardless of arming; an ambiguous strand
  // leaves state untouched (fenced), never re-parked.
  if ((await reconcileOpenBlockAttempt(intentId, deps)) !== "none") return;

  // LIVE kill switch at the FILING boundary. sendStandardActivity POSTs
  // whenever its config exists — `live` only shapes the payload name — so a
  // live intent disarmed between reservation verification and filing must
  // return here, BEFORE any attempt row or external request. 'retry' +
  // next_retry_at keeps the lane sweep-retryable: while disarmed each sweep
  // re-parks it here; once re-armed the next sweep files for real.
  if (intent.execution_mode === "live" && !isContractBlockLive()) {
    await touchIntent(intentId, {
      block_state: "retry",
      next_retry_at: new Date(Date.now() + 30 * 60 * 1000),
      last_error: "VRM_CONTRACT_BLOCK_ENABLED disarmed; block filing frozen until re-armed",
    });
    await mirrorCutoverSummary(intentId);
    return;
  }

  // Filing claim CAS: pending/retry → 'filing' atomically. A stale or
  // concurrent caller — one whose gates above ran against an intent another
  // filing has since resolved — gets zero rows here and must NOT file.
  // Recovery if this claim later crashes: with an open attempt the reconcile
  // lane resolves it; with no attempt the sweep re-parks it (nothing can have
  // been POSTed before the attempt INSERT below).
  const { rows: filingClaim } = await db.execute(sql`
    UPDATE vrm_rental_workflow_intents
    SET block_state = 'filing', updated_at = now()
    WHERE id = ${intentId} AND block_state IN ('pending', 'retry')
    RETURNING id
  `);
  if ((filingClaim as any[]).length === 0) return;

  // Persist intent-to-file BEFORE the call (attempt ledger).
  let attemptNo: number;
  try {
    const { rows: att } = await db.execute(sql`
      INSERT INTO vrm_workflow_attempts (intent_id, phase, attempt_no, fencing_token, request_hash, request)
      SELECT ${intentId}, 'art_block', COALESCE(MAX(attempt_no), 0) + 1, ${intent.fencing_token},
             ${previewHash(body)}, ${JSON.stringify({ projectName, body })}::jsonb
      FROM vrm_workflow_attempts WHERE intent_id = ${intentId} AND phase = 'art_block'
      RETURNING attempt_no
    `);
    attemptNo = (att as any[])[0]?.attempt_no;
  } catch (e: any) {
    if (e?.code === "23505" || /duplicate key value/i.test(String(e?.message ?? ""))) {
      // one-open index refused a duplicate open. Should be unreachable behind
      // the CAS — surrender the claim so the sweep lanes drive recovery
      // rather than stranding 'filing'.
      await db.execute(sql`
        UPDATE vrm_rental_workflow_intents
        SET block_state = 'retry', next_retry_at = now() + interval '30 minutes', updated_at = now()
        WHERE id = ${intentId} AND block_state = 'filing'
      `);
      console.error(`[cutover] intent ${intentId}: concurrent art_block attempt already open; claim surrendered`);
      return;
    }
    throw e;
  }

  const result = await sendStandardActivity(args);

  // Finalize ORDER: parent state FIRST (branches below), attempt-close LAST.
  // A crash between them leaves an advanced parent + an OPEN attempt — safe:
  // filing stays fenced by the one-open index and the reconcile lane
  // converges it. The reverse order (closed attempt + stale parent) is the
  // double-file window: nothing fences, and the parent still looks claimable.
  if (result.ok) {
    await touchIntent(intentId, {
      block_state: "accepted",
      block_submitted_at: new Date(),
      block_evidence: {
        projectId: result.projectId,
        projectName: result.projectName,
        httpStatus: result.httpStatus,
        payload: result.payload,
        live,
        acceptedAt: new Date().toISOString(),
      },
      last_error: null,
    });
  } else if (result.skipReason === "duplicate") {
    // 409: the key already exists — an existing (possibly malformed) block may
    // own it. NEVER re-fire; readback decides. Msg1 does NOT release.
    await touchIntent(intentId, {
      block_state: "conflict_pending_readback",
      block_submitted_at: new Date(),
      status: "block_conflict_pending_readback",
      block_evidence: {
        conflict: true,
        projectName: result.projectName,
        httpStatus: result.httpStatus,
        payload: result.payload,
        at: new Date().toISOString(),
      },
      last_error: "ART 409 duplicate; awaiting snapshot readback",
    });
  } else if (result.retryable) {
    const { rows: cnt } = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM vrm_workflow_attempts WHERE intent_id = ${intentId} AND phase = 'art_block'
    `);
    const n = (cnt as any[])[0]?.n ?? 1;
    if (n >= 3) {
      await touchIntent(intentId, {
        block_state: "failed",
        status: "manual_review",
        last_error: `ART filing failed ${n}x: ${result.errorMessage ?? "unknown"}`,
      });
    } else {
      await touchIntent(intentId, {
        block_state: "retry",
        next_retry_at: new Date(Date.now() + 10 * 60 * 1000),
        last_error: `ART transient failure (attempt ${n}): ${result.errorMessage ?? "unknown"}`,
      });
    }
  } else {
    await touchIntent(intentId, {
      block_state: "failed",
      status: "manual_review",
      last_error: `ART filing failed (non-retryable): ${result.errorMessage ?? result.skipReason ?? "unknown"}`,
    });
  }
  await db.execute(sql`
    UPDATE vrm_workflow_attempts
    SET outcome = ${result.ok ? "accepted" : result.skipReason ?? "failed"},
        finished_at = now(),
        evidence = ${JSON.stringify({ httpStatus: result.httpStatus, projectId: result.projectId, projectName: result.projectName, error: result.errorMessage })}::jsonb
    WHERE intent_id = ${intentId} AND phase = 'art_block' AND attempt_no = ${attemptNo} AND outcome IS NULL
  `);
  await mirrorCutoverSummary(intentId);
}

/** Retry lane for transient block failures (cron sweep calls this). */
export async function retryPendingBlocks(): Promise<number> {
  const { rows } = await db.execute(sql`
    SELECT id FROM vrm_rental_workflow_intents
    WHERE block_state = 'retry' AND next_retry_at <= now()
      AND status NOT IN ('completed','cancelled','abandoned')
    ORDER BY id LIMIT 10
  `);
  let n = 0;
  for (const r of rows as any[]) {
    // Lease-style push BEFORE filing: if the process dies mid-call the row is
    // eligible again in 6h on its own (an open attempt is reconciled first);
    // every success path rewrites block_state, making the push inert. Never
    // NULL next_retry_at pre-flight — a crash would strand the row forever.
    await db.execute(sql`
      UPDATE vrm_rental_workflow_intents SET next_retry_at = now() + interval '6 hours' WHERE id = ${r.id}
    `);
    await fileContractBlock(r.id);
    n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Messages (guarded, sequenced)
// ---------------------------------------------------------------------------

async function upsertSendGuard(params: {
  intentId: number;
  workflowType: string;
  moment: "msg1_evening" | "msg2_morning";
  executionMode: string;
  body: string;
  phoneDigits: string | null;
  scheduledFor: Date | null;
  status: string;
}): Promise<{ created: boolean; guard: any }> {
  const { rows } = await db.execute(sql`
    INSERT INTO vrm_workflow_send_guards
      (intent_id, workflow_type, message_moment, execution_mode, status, body, phone_digits, scheduled_for)
    VALUES (${params.intentId}, ${params.workflowType}, ${params.moment}, ${params.executionMode},
            ${params.status}, ${params.body}, ${params.phoneDigits}, ${params.scheduledFor})
    ON CONFLICT (intent_id, workflow_type, message_moment, execution_mode) DO NOTHING
    RETURNING *
  `);
  const inserted = (rows as any[])[0];
  if (inserted) return { created: true, guard: inserted };
  const { rows: existing } = await db.execute(sql`
    SELECT * FROM vrm_workflow_send_guards
    WHERE intent_id = ${params.intentId} AND workflow_type = ${params.workflowType}
      AND message_moment = ${params.moment} AND execution_mode = ${params.executionMode}
    LIMIT 1
  `);
  return { created: false, guard: (existing as any[])[0] };
}

/**
 * Dispatch ticket for a send guard: CAS created→dispatching so exactly one
 * concurrent releaser dispatches (the second UPDATE re-evaluates its predicate
 * after the row lock clears and matches nothing). A guard stuck in
 * 'dispatching' for 15+ minutes — crash between dispatch and the outcome
 * write — is reclaimable; that retry leans on the comms 24h duplicate gate,
 * whose skip result is recorded as sent. Exported for tests.
 */
export async function claimSendGuardDispatch(
  intentId: number,
  moment: string,
  executionMode: string,
): Promise<boolean> {
  const { rows } = await db.execute(sql`
    UPDATE vrm_workflow_send_guards
    SET status = 'dispatching', updated_at = now()
    WHERE intent_id = ${intentId} AND message_moment = ${moment} AND execution_mode = ${executionMode}
      AND (status = 'created' OR (status = 'dispatching' AND updated_at < now() - interval '15 minutes'))
    RETURNING id
  `);
  return (rows as any[]).length > 0;
}

/**
 * Message 1 releases ONLY on reservation_verified + real-2xx block_accepted.
 * Message 2 is created HELD at the same moment (durable intent) and stays
 * undrainable until the morning sweep confirms block_verified.
 */
export async function releaseMessagesIfEligible(intentId: number): Promise<void> {
  const intent = await loadIntent(intentId);
  if (TERMINAL_STATUSES.has(intent.status)) return;
  const isRequest = intent.workflow_type === WORKFLOW_REQUEST;
  const darkValidated = intent.execution_mode !== "live" && intent.reservation_state === "dry_run_validated";
  if (intent.reservation_state !== "verified" && !darkValidated) return;
  // A request files no route block, so block_state is born 'not_applicable' and
  // the cutover's block gate can never be satisfied. Applying it to this lane is
  // what left two technicians holding real reservations and no message.
  if (!isRequest) {
    const blockOk =
      intent.block_state === "accepted" ||
      intent.block_state === "verified" ||
      (intent.execution_mode === "dry_run" && intent.block_state === "dry_run_would_file");
    if (!blockOk) return;
  }

  const preview = intent.preview ?? {};
  const conf = strOrNull(intent.reservation_evidence?.confirmation) ?? "(pending)";
  const branchName = preview.reservation?.branchName ?? preview.reservation?.branchCode ?? "branch";
  const branchAddress = preview.reservation?.branchAddress ?? "";
  const resv = (preview.reservation ?? {}) as Record<string, unknown>;
  const msg1Body = isRequest
    ? renderRequestMsg1({
        conf,
        branchName,
        branchAddress,
        branchPhone: strOrNull(resv.branchPhone),
        pickupDate: strOrNull(resv.pickupDate),
        pickupTime: strOrNull(resv.pickupTime),
        returnDate: strOrNull(resv.returnDate),
      })
    : renderMsg1({ conf, branchName, branchAddress });
  const msg2Body = renderMsg2({ conf, branchName, branchAddress });

  const facts = await fetchEligibilityFacts({
    workflowType: intent.workflow_type,
    sourceId: intent.source_id,
    excludeIntentId: intent.id,
  });
  const phone = facts.contactPhone ?? facts.requestFallbackPhone;
  const phoneDigits = phone ? digitsOnly(phone).slice(-10) : null;
  const isLive = intent.execution_mode === "live";
  // Master kill switch: disarming the flag freezes every live send path.
  // States stay pending and release when the flag is re-armed.
  if (isLive && !isContractBlockLive()) return;

  // ---- Message 1 (evening instructions) ------------------------------------
  // Repair spec §7: msg1 is SCHEDULED for the evening BEFORE the event in the
  // recipient's local time (19:00 local; the queue's quiet-hours floor still
  // applies on top), never blasted at verification time. If that evening is
  // already past (late verification), send at the next compliant moment.
  const msg1EventISO = intent.event_date ? String(intent.event_date).slice(0, 10) : etTodayISO();
  const msg1EveISO = addDaysISO(msg1EventISO, -1);
  const msg1Tz = stateTimeZone(String(facts.contactState ?? ""));
  const [evY, evM, evD] = msg1EveISO.split("-").map((n) => parseInt(n, 10));
  // A cutover's msg1 is instructions for tomorrow's route block, so it goes out
  // the evening before. A request is a technician standing without a van right
  // now: it goes the moment the reservation is real.
  let msg1ScheduledFor = isRequest
    ? new Date()
    : localHourToUtc(msg1Tz, evY, evM, evD, 19);
  if (msg1ScheduledFor.getTime() <= Date.now()) msg1ScheduledFor = new Date();
  if (intent.msg1_state === "pending") {
    const g1 = await upsertSendGuard({
      intentId,
      workflowType: intent.workflow_type,
      moment: "msg1_evening",
      executionMode: intent.execution_mode,
      body: msg1Body,
      phoneDigits,
      scheduledFor: msg1ScheduledFor,
      status: "created",
    });
    // Dispatch ticket: exactly one concurrent releaser wins the CAS; a crash
    // between dispatch and the outcome write leaves 'dispatching', reclaimed
    // after 15 minutes with the 24h duplicate gate making the retry safe.
    const g1Status = g1.created ? "created" : String(g1.guard?.status ?? "");
    if (
      (g1Status === "created" || g1Status === "dispatching") &&
      (await claimSendGuardDispatch(intentId, "msg1_evening", intent.execution_mode))
    ) {
      if (!isLive) {
        // Dark modes: durable guard only; sendMessage dry-run records the gate outcome.
        const dry = await sendMessage({
          ldap: intent.ldap,
          phone: intent.workflow_type === WORKFLOW_REQUEST ? phone : undefined,
          category: COMMS_CATEGORY,
          body: msg1Body,
          sentBy: "cutover-workflow",
          senderName: "SHS Fleet",
          dryRun: true,
          skipRecentDuplicate: true,
        });
        await db.execute(sql`
          UPDATE vrm_workflow_send_guards SET status = ${"simulated_" + dry.status}, updated_at = now()
          WHERE intent_id = ${intentId} AND message_moment = 'msg1_evening' AND execution_mode = ${intent.execution_mode}
        `);
        await touchIntent(intentId, { msg1_state: "released" });
      } else {
        const res = await sendMessage({
          ldap: intent.ldap,
          phone: intent.workflow_type === WORKFLOW_REQUEST ? phone : undefined,
          category: COMMS_CATEGORY,
          body: msg1Body,
          sentBy: "cutover-workflow",
          senderName: "SHS Fleet",
          skipRecentDuplicate: true,
          scheduledFor: msg1ScheduledFor,
        });
        // A duplicate-skip means the identical body already reached this phone
        // within 24h (e.g. crash-retry after a successful dispatch): that IS
        // sent, never a manual_review conflict.
        const dupSkip = res.status === "skipped" && /duplicate/i.test(res.reason ?? "");
        await db.execute(sql`
          UPDATE vrm_workflow_send_guards
          SET status = ${dupSkip ? "sent_duplicate" : res.status}, queue_id = ${res.queueId ?? null}, message_id = ${res.messageId ?? null}, updated_at = now()
          WHERE intent_id = ${intentId} AND message_moment = 'msg1_evening' AND execution_mode = ${intent.execution_mode}
        `);
        if (res.status === "sent" || res.status === "queued" || dupSkip) {
          await touchIntent(intentId, { msg1_state: dupSkip ? "sent" : res.status });
        } else {
          await touchIntent(intentId, {
            msg1_state: "blocked",
            status: "manual_review",
            last_error: `msg1 ${res.status}: ${res.reason ?? ""}`,
          });
        }
      }
    }
  }

  // ---- Message 2 (morning reminder) — durable HELD intent --------------------
  // CUTOVER ONLY. renderMsg2 says "today's 8:00 AM block" and "you keep your current
  // vehicle; billing-only change" - both false for a request, where there is no block
  // and the technician has no vehicle to keep. releaseMsg2IfDue gates on
  // block_state = 'verified', which a request (born 'not_applicable') never reaches,
  // so it never sent; it did park a wrong-lane HELD row in fs_comms_send_queue.
  // completionSatisfied already states the rule: a request completes on its verified
  // reservation alone. Build nothing.
  const i2 = await loadIntent(intentId);
  if (!isRequest && i2.msg2_state === "pending" && (i2.msg1_state === "sent" || i2.msg1_state === "queued" || i2.msg1_state === "released")) {
    // Target: morning of the event date; the sweep re-computes the compliant
    // time at release. Placeholder scheduled_for = event date 06:45 ET.
    const eventISO = i2.event_date ? String(i2.event_date).slice(0, 10) : etTodayISO();
    const placeholder = new Date(`${eventISO}T06:45:00-04:00`);
    const g2 = await upsertSendGuard({
      intentId,
      workflowType: i2.workflow_type,
      moment: "msg2_morning",
      executionMode: i2.execution_mode,
      body: msg2Body,
      phoneDigits,
      scheduledFor: placeholder,
      status: "held",
    });
    const g2Status = g2.created ? "held" : String(g2.guard?.status ?? "");
    if (isLive && phone) {
      // Enqueue ticket: CAS held→enqueueing (queue_id still NULL) so exactly
      // one caller creates the held queue row. A crash mid-enqueue leaves
      // 'enqueueing'; after 15 minutes the recovery pass ADOPTS the orphan
      // held row if the crashed attempt got that far, else enqueues fresh.
      if (g2Status === "held" || g2Status === "enqueueing") {
        const { rows: ticket } = await db.execute(sql`
          UPDATE vrm_workflow_send_guards
          SET status = 'enqueueing', updated_at = now()
          WHERE intent_id = ${intentId} AND message_moment = 'msg2_morning' AND execution_mode = ${i2.execution_mode}
            AND queue_id IS NULL
            AND (status = 'held' OR (status = 'enqueueing' AND updated_at < now() - interval '15 minutes'))
          RETURNING id
        `);
        if ((ticket as any[]).length) {
          const { rows: orphans } = await db.execute(sql`
            SELECT id FROM fs_comms_send_queue
            WHERE status = 'held' AND phone_digits = ${phoneDigits} AND body = ${msg2Body}
            ORDER BY id DESC LIMIT 1
          `);
          let queueId: any = (orphans as any[])[0]?.id ?? null;
          if (!queueId) {
            const held = await sendMessage({
              ldap: i2.ldap,
              phone: i2.workflow_type === WORKFLOW_REQUEST ? phone : undefined,
              category: COMMS_CATEGORY,
              body: msg2Body,
              sentBy: "cutover-workflow",
              senderName: "SHS Fleet",
              skipRecentDuplicate: true,
              hold: true,
              scheduledFor: placeholder,
            });
            queueId = held.queueId ?? null;
          }
          await db.execute(sql`
            UPDATE vrm_workflow_send_guards
            SET status = 'held', queue_id = ${queueId}, updated_at = now()
            WHERE intent_id = ${intentId} AND message_moment = 'msg2_morning' AND execution_mode = ${i2.execution_mode}
          `);
        }
      }
      await touchIntent(intentId, { msg2_state: "held" });
    } else if (g2.created || g2Status === "held") {
      await touchIntent(intentId, { msg2_state: "held" });
    }
  }
  await mirrorCutoverSummary(intentId);
}

/**
 * Msg2 (morning-of pickup text) guarded release — repair spec §7. Extracted
 * from the sweep so every gate lives in ONE place and is unit-testable:
 *   - only a held msg2 on a verified block, kill-switch honored for live;
 *   - event-day gate in the RECIPIENT'S timezone: before = stay held,
 *     after = never send (cancel the held row, mark skipped_stale_event);
 *   - quiet-exception states (FL/CT/MD/OK/WA/TX) require the PERSISTED
 *     operator fallback policy — absent policy blocks loudly, never guesses;
 *   - live release requires the guard's queue row to actually flip held →
 *     pending (or already be pending/sent/delivered) — a miss blocks with the
 *     row's real status instead of pretending the text is on its way.
 */
export async function releaseMsg2IfDue(
  intentId: number,
): Promise<"released" | "skipped_not_event_day" | "skipped_stale_event" | "skipped_policy" | "blocked" | "noop"> {
  const intent = await loadIntent(intentId);
  if (TERMINAL_STATUSES.has(intent.status)) return "noop";
  if (intent.msg2_state !== "held") return "noop";
  if (intent.block_state !== "verified") return "noop";
  if (intent.execution_mode === "live" && !isContractBlockLive()) return "blocked";

  const { rows: guards } = await db.execute(sql`
    SELECT * FROM vrm_workflow_send_guards
    WHERE intent_id = ${intentId} AND message_moment = 'msg2_morning' AND execution_mode = ${intent.execution_mode}
    LIMIT 1
  `);
  const guard = (guards as any[])[0];
  if (!guard) {
    await touchIntent(intentId, {
      last_error: "msg2 release blocked: no send guard row exists (msg2 was never staged)",
    });
    return "blocked";
  }

  const eventISO = intent.event_date ? String(intent.event_date).slice(0, 10) : null;
  if (!eventISO) {
    await touchIntent(intentId, { last_error: "msg2 release blocked: intent has no event_date" });
    return "blocked";
  }

  const facts = await fetchEligibilityFacts({
    workflowType: intent.workflow_type,
    sourceId: intent.source_id,
    excludeIntentId: intent.id,
  });
  const state = String(facts.contactState ?? "").trim().toUpperCase();
  const tz = stateTimeZone(state);
  const localTodayISO = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  if (localTodayISO < eventISO) return "skipped_not_event_day";
  if (localTodayISO > eventISO) {
    // The morning already passed — a pickup text now would be nonsense.
    if (guard.queue_id) {
      await db.execute(sql`
        UPDATE fs_comms_send_queue SET status = 'cancelled', updated_at = now()
        WHERE id = ${guard.queue_id} AND status = 'held'
      `);
    }
    await db.execute(sql`
      UPDATE vrm_workflow_send_guards SET status = 'skipped_stale_event', updated_at = now()
      WHERE id = ${guard.id}
    `);
    await touchIntent(intentId, {
      msg2_state: "released",
      last_error: `msg2 skipped: event day ${eventISO} already passed in ${tz} (local today ${localTodayISO})`,
    });
    await mirrorCutoverSummary(intentId);
    return "skipped_stale_event";
  }

  const compliant = getNextAllowedSendTime(state) ?? new Date();
  if (QUIET_EXCEPTION_STATES[state]) {
    const fb = await getQuietStateFallback();
    if (!fb) {
      await touchIntent(intentId, {
        last_error: `msg2 held: ${state} is a quiet-hours exception state and no fallback policy is set (POST settings/quiet-state-fallback: send_at_window_open | skip_msg2)`,
      });
      return "blocked";
    }
    if (fb.mode === "skip_msg2") {
      if (guard.queue_id) {
        await db.execute(sql`
          UPDATE fs_comms_send_queue SET status = 'cancelled', updated_at = now()
          WHERE id = ${guard.queue_id} AND status = 'held'
        `);
      }
      await db.execute(sql`
        UPDATE vrm_workflow_send_guards SET status = 'skipped_policy', updated_at = now()
        WHERE id = ${guard.id}
      `);
      await touchIntent(intentId, {
        msg2_state: "released",
        last_error: `msg2 skipped by policy: ${state} quiet-hours fallback is skip_msg2 (set by ${fb.setBy ?? "?"})`,
      });
      await mirrorCutoverSummary(intentId);
      return "skipped_policy";
    }
    // send_at_window_open → proceed; `compliant` already IS the window open.
  }

  if (intent.execution_mode === "live") {
    if (!guard.queue_id) {
      await touchIntent(intentId, {
        last_error: "msg2 release blocked: guard has no queue row to flip (live send was never staged)",
      });
      return "blocked";
    }
    const { rows: flipped } = await db.execute(sql`
      UPDATE fs_comms_send_queue
      SET status = 'pending', scheduled_for = ${compliant}, updated_at = now()
      WHERE id = ${guard.queue_id} AND status = 'held'
      RETURNING id
    `);
    if (!(flipped as any[]).length) {
      const { rows: qrows } = await db.execute(sql`
        SELECT status FROM fs_comms_send_queue WHERE id = ${guard.queue_id} LIMIT 1
      `);
      const qStatus = String((qrows as any[])[0]?.status ?? "missing");
      if (!["pending", "sent", "delivered"].includes(qStatus)) {
        await touchIntent(intentId, {
          last_error: `msg2 release blocked: queue row ${guard.queue_id} is '${qStatus}' (expected held→pending)`,
        });
        return "blocked";
      }
    }
  }

  await db.execute(sql`
    UPDATE vrm_workflow_send_guards SET status = 'released', scheduled_for = ${compliant}, updated_at = now()
    WHERE id = ${guard.id}
  `);
  await touchIntent(intentId, { msg2_state: "released" });
  await mirrorCutoverSummary(intentId);
  return "released";
}

// ---------------------------------------------------------------------------
// Morning sweep — block readback, msg2 release, completion
// ---------------------------------------------------------------------------

export async function morningSweep(): Promise<{
  checked: number;
  verified: number;
  pending: number;
  repairs: number;
  released: number;
  completed: number;
  blockRetries: number;
  blockReconciles: number;
}> {
  const summary = { checked: 0, verified: 0, pending: 0, repairs: 0, released: 0, completed: 0, blockRetries: 0, blockReconciles: 0 };

  // Crash recovery FIRST: resolve stranded open art_block attempts so the
  // retry lane below never files over an ambiguous ledger.
  summary.blockReconciles = await reconcileOpenBlockAttempts();
  summary.blockRetries = await retryPendingBlocks();

  const { rows } = await db.execute(sql`
    SELECT id FROM vrm_rental_workflow_intents
    WHERE status NOT IN ('completed','cancelled','abandoned')
      AND block_state IN ('accepted','conflict_pending_readback','verification_pending')
      AND block_submitted_at IS NOT NULL
      AND event_date IS NOT NULL
    ORDER BY id
  `);

  for (const r of rows as any[]) {
    const intent = await loadIntent(r.id);
    summary.checked++;
    const dateISO = String(intent.event_date).slice(0, 10);
    const expectedZip = intent.preview?.artBlock?.locationZip5 ?? zip5(intent.preview?.reservation?.branchZip);
    let verdict: ReturnType<typeof classifyBlockReadback>;
    try {
      const { rows: rbRows, watermarkUtc } = await fetchBlockReadbackRows(intent.ldap, dateISO);
      verdict = classifyBlockReadback({
        rows: rbRows,
        blockSubmittedAt: intent.block_submitted_at,
        expectedZip5: expectedZip ?? "",
        globalWatermark: watermarkUtc,
      });
    } catch (e: any) {
      console.error(`[cutover] block readback failed for intent ${intent.id}:`, e?.message ?? e);
      continue;
    }

    if (verdict.verdict === "block_verified") {
      summary.verified++;
      const wasConflict = intent.status === "block_conflict_pending_readback";
      await touchIntent(intent.id, {
        block_state: "verified",
        ...(wasConflict ? { status: "reservation_verified" } : {}),
        block_evidence: { ...(intent.block_evidence ?? {}), readback: verdict, verifiedAt: new Date().toISOString() },
        last_error: null,
      });
      // A conflict that verifies releases msg1 now (block proven present+correct).
      await releaseMessagesIfEligible(intent.id);

      // Release msg2 via the guarded lane (event-day recipient-local gate,
      // queue-flip verification, quiet-exception policy) — releaseMsg2IfDue.
      const rel = await releaseMsg2IfDue(intent.id);
      if (rel === "released") summary.released++;

      const final = await loadIntent(intent.id);
      if (!TERMINAL_STATUSES.has(final.status) && completionSatisfied(final)) {
        // Terminal completion is transactional with the tracking write (§5);
        // CAS on the observed status — a cancel racing this sweep wins.
        if (await finalizeCompletion(intent.id, final.status)) summary.completed++;
      }
      await mirrorCutoverSummary(intent.id);
    } else if (verdict.verdict === "verification_pending") {
      summary.pending++;
      if (intent.block_state !== "verification_pending" && intent.block_state !== "conflict_pending_readback") {
        await touchIntent(intent.id, { block_state: "verification_pending" });
        await mirrorCutoverSummary(intent.id);
      }
    } else {
      summary.repairs++;
      console.error(
        `[cutover] BLOCK MANUAL REPAIR intent=${intent.id} ldap=${intent.ldap} date=${dateISO}: ${verdict.reason}`,
      );
      await touchIntent(intent.id, {
        block_state: "manual_repair",
        status: "manual_review",
        last_error: `block readback: ${verdict.reason}`,
      });
      await mirrorCutoverSummary(intent.id);
    }
  }

  // Second lane: blocks verified on an EARLIER sweep whose msg2 is still held
  // (event-day gate or exception-state policy kept it back). The first lane's
  // SELECT no longer sees them (block_state = 'verified'), so revisit here —
  // releaseMsg2IfDue is idempotent for rows the first lane already touched.
  const { rows: heldRows } = await db.execute(sql`
    SELECT id FROM vrm_rental_workflow_intents
    WHERE status NOT IN ('completed','cancelled','abandoned')
      AND block_state = 'verified' AND msg2_state = 'held'
    ORDER BY id
  `);
  for (const r of heldRows as any[]) {
    try {
      const rel = await releaseMsg2IfDue(r.id);
      if (rel === "released") summary.released++;
      const final = await loadIntent(r.id);
      if (!TERMINAL_STATUSES.has(final.status) && completionSatisfied(final)) {
        if (await finalizeCompletion(r.id, final.status)) summary.completed++;
      }
      await mirrorCutoverSummary(r.id);
    } catch (e: any) {
      console.error(`[cutover] msg2 release lane failed for intent ${r.id}:`, e?.message ?? e);
    }
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Staff actions: retry / cancel
// ---------------------------------------------------------------------------

/**
 * Request-lane verification on the commit response.
 *
 * ETD's /api/myjourney/search ignores both SearchCriteria and Period and returns only
 * past-dated journeys, so a future pickup is NEVER in the result set and
 * identifyJourneyRows can never match it. A cutover can afford to wait for that
 * readback; a request cannot, because the technician has no van today. For this lane
 * the savedr response carrying a confirmation number IS the proof, and it is recorded
 * as exactly that ("commit_response") rather than passed off as a readback.
 *
 * `alreadyNotifiedBy` closes out a technician who was ALREADY told out of band. ETD
 * emails every confirmation to the technician's <phone>@tmomail.net as well as to us,
 * and T-Mobile delivers that as a text, so a tech can easily know before we send
 * anything. Without this the only choices were a duplicate text or a request row left
 * reading 'approved' with no reference. It suppresses msg1 by moving msg1_state off
 * 'pending' (the only value releaseMessagesIfEligible acts on) and records who said so.
 *
 * Idempotent and CAS-guarded. Returns true only when it actually promoted the intent.
 */
export async function verifyRequestOnCommitEvidence(
  intentId: number,
  opts?: { alreadyNotifiedBy?: string },
): Promise<boolean> {
  const intent = await loadIntent(intentId);
  if (intent.workflow_type !== WORKFLOW_REQUEST) return false;
  if (intent.reservation_state !== "booked_unverified") return false;
  const confirmation = strOrNull(intent.reservation_evidence?.confirmation);
  if (!confirmation) return false;
  const quoteRef = strOrNull(intent.reservation_evidence?.raw?.quoteReference);
  const notifiedBy = strOrNull(opts?.alreadyNotifiedBy);

  const evidence = JSON.stringify({
    ...(intent.reservation_evidence ?? {}),
    confirmation,
    verifiedBy: "commit_response",
    verifiedAt: new Date().toISOString(),
    ...(notifiedBy
      ? { alreadyNotified: { by: notifiedBy, at: new Date().toISOString() } }
      : {}),
  });
  const { rows: advanced } = await db.execute(sql`
    UPDATE vrm_rental_workflow_intents
    SET reservation_state = 'verified',
        status = 'reservation_verified',
        reservation_evidence = ${evidence}::jsonb,
        msg1_state = ${notifiedBy ? sql`'skipped_already_notified'` : sql`msg1_state`},
        last_error = NULL,
        claimed_by = NULL,
        lease_expires_at = NULL,
        updated_at = now()
    WHERE id = ${intentId}
      AND workflow_type = ${WORKFLOW_REQUEST}
      AND reservation_state = 'booked_unverified'
      AND status NOT IN ('completed', 'cancelled', 'abandoned')
    RETURNING id
  `);
  if (!(advanced as any[]).length) return false;

  // Close the request row too, so the queue and the card both read 'booked' instead
  // of an approved row that silently already has a car.
  await db.execute(sql`
    UPDATE vrm_rental_request
       SET status = 'booked',
           etd_reference = ${confirmation},
           etd_reservation_id = COALESCE(etd_reservation_id, ${quoteRef}),
           etd_booked_at = COALESCE(etd_booked_at, now()),
           etd_error = NULL,
           updated_at = now()
     WHERE request_no = ${Number(intent.source_id)}
  `);
  await mirrorCutoverSummary(intentId);
  await releaseMessagesIfEligible(intentId);
  return true;
}

/**
 * Adopt a reservation the RUNNER created onto the intent it belongs to.
 *
 * `book_request.py` books outside the intent state machine and writes only
 * `vrm_rental_request`. The intent it was created from never learns the reservation
 * exists, so it sits wherever the last preview left it. On 2026-08-18 that meant
 * ELEVEN requests carrying live confirmation numbers whose panel read "Needs
 * re-preview", which is worse than useless: it is a booked technician displayed as a
 * broken one.
 *
 * Idempotent. Safe to call for a request that is already reconciled, and safe to call
 * repeatedly. `alreadyNotified` suppresses msg1 for the case where the technician was
 * told out of band, exactly as verifyRequestOnCommitEvidence does.
 */
export async function adoptRunnerBooking(
  requestNo: number,
  confirmation: string,
  quoteRef?: string | null,
  opts?: { alreadyNotified?: string },
): Promise<boolean> {
  const conf = strOrNull(confirmation);
  if (!conf) return false;
  const { rows } = await db.execute(sql`
    SELECT * FROM vrm_rental_workflow_intents
     WHERE workflow_type = ${WORKFLOW_REQUEST}
       AND source_id = ${String(requestNo)}
       AND status NOT IN ('cancelled', 'abandoned')
     ORDER BY id DESC
     LIMIT 1
  `);
  const intent = (rows as any[])[0];
  if (!intent) return false;
  if (intent.reservation_state === "verified") return false;

  const notifiedBy = strOrNull(opts?.alreadyNotified);
  const evidence = JSON.stringify({
    ...(intent.reservation_evidence ?? {}),
    confirmation: conf,
    verifiedBy: "runner_commit",
    verifiedAt: new Date().toISOString(),
    ...(quoteRef ? { raw: { quoteReference: quoteRef } } : {}),
    ...(notifiedBy ? { alreadyNotified: { by: notifiedBy, at: new Date().toISOString() } } : {}),
  });
  const { rows: advanced } = await db.execute(sql`
    UPDATE vrm_rental_workflow_intents
       SET reservation_state = 'verified',
           status = 'reservation_verified',
           reservation_evidence = ${evidence}::jsonb,
           msg1_state = ${notifiedBy ? sql`'skipped_already_notified'` : sql`msg1_state`},
           last_error = NULL,
           claimed_by = NULL,
           lease_expires_at = NULL,
           updated_at = now()
     WHERE id = ${intent.id}
       AND reservation_state <> 'verified'
       AND status NOT IN ('cancelled', 'abandoned', 'completed')
     RETURNING id
  `);
  if (!(advanced as any[]).length) return false;
  await mirrorCutoverSummary(intent.id);

  // Did this technician ALREADY get a confirmation text?
  //
  // The runner sends its own SMS the moment it books, entirely outside the intent's
  // message state. So msg1_state sat at 'pending' for thirteen technicians who had
  // already been texted, and the panel could not show that a single one of them had
  // been told. Worse, releasing msg1 here would text every one of them a second time.
  // Look for the real message before deciding.
  const { rows: prior } = await db.execute(sql`
    SELECT m.phone_digits,
           to_char(m.created_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS at
      FROM fs_comms_messages m
     WHERE m.direction = 'outbound'
       AND m.body ILIKE '%rental is booked%'
       AND m.created_at > now() - interval '3 days'
       AND regexp_replace(coalesce(m.phone_digits, ''), '[^0-9]', '', 'g') IN (
             regexp_replace(coalesce((SELECT phone FROM fs_comms_contacts
                                       WHERE upper(ldap) = upper(${intent.ldap}) LIMIT 1), ''), '[^0-9]', '', 'g'),
             regexp_replace(coalesce((SELECT mobile_phone FROM vrm_rental_request
                                       WHERE request_no = ${requestNo}), ''), '[^0-9]', '', 'g'))
     ORDER BY m.created_at DESC
     LIMIT 1
  `);
  const already = (prior as any[])[0];
  if (already) {
    await touchIntent(intent.id, {
      msg1_state: "sent",
      reservation_evidence: {
        ...(JSON.parse(evidence) as Record<string, unknown>),
        msg1: { at: already.at, phone: already.phone_digits, by: "runner_sms" },
      },
    });
  } else {
    await releaseMessagesIfEligible(intent.id);
  }
  const settled = await loadIntent(intent.id);
  if (!TERMINAL_STATUSES.has(settled.status) && completionSatisfied(settled)) {
    if (await finalizeCompletion(intent.id, settled.status)) await mirrorCutoverSummary(intent.id);
  }
  return true;
}

export async function retryIntent(
  intentId: number,
  requestedBy: string,
  opts?: { alreadyNotified?: boolean },
): Promise<any> {
  const intent = await loadIntent(intentId);
  if (TERMINAL_STATUSES.has(intent.status)) throw new OrchestratorError("terminal", "intent is terminal", 409);
  // Staff assertion that this technician already has the confirmation from somewhere
  // else. Only meaningful on the request lane, where the commit response is the proof.
  const notifiedOpt = opts?.alreadyNotified ? { alreadyNotifiedBy: requestedBy } : undefined;

  switch (intent.status) {
    case "preview_required":
    case "manual_review": {
      if (intent.reservation_state === "verified") {
        // Reservation stands; retry the downstream step.
        if (["failed", "manual_repair", "retry"].includes(intent.block_state)) {
          await touchIntent(intentId, { status: "reservation_verified", block_state: "retry", next_retry_at: null, last_error: `retry by ${requestedBy}` });
          await fileContractBlock(intentId);
          await releaseMessagesIfEligible(intentId);
        } else {
          await touchIntent(intentId, { status: "reservation_verified", last_error: `retry by ${requestedBy}` });
          await releaseMessagesIfEligible(intentId);
        }
      } else if (intent.reservation_state === "unknown" || intent.reservation_state === "booked_unverified") {
        // A REQUEST already holding a confirmation is proven. Ordering another journey
        // readback for it only reproduces the same dead "none" and drops it straight
        // back into manual review, which is how three technicians ended up holding real
        // reservations behind a red MANUAL REVIEW badge. Verify on the commit response.
        if (await verifyRequestOnCommitEvidence(intentId, notifiedOpt)) break;
        // Must reconcile via readback — make it claimable, op_open stays blocked
        // by the unfinished-attempt guard until a readback resolves it.
        await touchIntent(intentId, { status: "booking", claimed_by: null, lease_expires_at: null, next_retry_at: null, last_error: `reconcile requested by ${requestedBy}` });
      } else {
        await touchIntent(intentId, { status: "preview_pending", claimed_by: null, lease_expires_at: null, next_retry_at: null, last_error: `retry by ${requestedBy}` });
      }
      break;
    }
    case "booking_unknown": {
      // Staff-initiated reconcile ONLY (never automatic): claimable for readback.
      await touchIntent(intentId, { status: "booking", claimed_by: null, lease_expires_at: null, next_retry_at: null, last_error: `reconcile requested by ${requestedBy}` });
      break;
    }
    case "awaiting_verification": {
      if (intent.reservation_state !== "booked_unverified") {
        throw new OrchestratorError("bad_state", "dark-parked validation intents have no reservation to verify", 409);
      }
      // Same rule as manual_review above: a request's proof is its commit response,
      // not a journey search that structurally cannot see a future pickup.
      if (await verifyRequestOnCommitEvidence(intentId, notifiedOpt)) break;
      // Booked but never verified (runner died before its readback): surrender
      // the claim so the recovery lane readbacks it on the next poll.
      await touchIntent(intentId, { claimed_by: null, lease_expires_at: null, next_retry_at: null, last_error: `readback reconcile requested by ${requestedBy}` });
      break;
    }
    case "block_conflict_pending_readback": {
      // Nothing to do but wait for the sweep; surface that clearly.
      throw new OrchestratorError("await_readback", "conflict is pending snapshot readback; the morning sweep resolves it", 409);
    }
    default:
      throw new OrchestratorError("bad_state", `nothing to retry from status ${intent.status}`, 409);
  }
  await mirrorCutoverSummary(intentId);
  return loadIntent(intentId);
}

export async function cancelIntent(intentId: number, cancelledBy: string, reason: string): Promise<any> {
  const intent = await loadIntent(intentId);
  if (TERMINAL_STATUSES.has(intent.status)) return intent;

  // Repair spec §4: "cancelled" must be TRUE. A live intent that may have
  // external effects — reservation evidence, an ambiguous outcome, or any
  // etd_booking attempt not proven clean — parks NONTERMINAL at
  // cancel_pending_readback (live-lock retained) until a readback proves ETD
  // holds nothing, or a human records cancellation evidence.
  let externalPossible = false;
  if (intent.execution_mode === "live") {
    if (["booked_unverified", "verified", "unknown"].includes(String(intent.reservation_state ?? ""))) {
      externalPossible = true;
    } else {
      const { rows: att } = await db.execute(sql`
        SELECT 1 FROM vrm_workflow_attempts
        WHERE intent_id = ${intentId} AND phase = 'etd_booking'
          AND (outcome IS NULL OR outcome NOT IN ('failed_clean','no_reservation_found','aborted_before_open','dry_run_validated'))
        LIMIT 1
      `);
      externalPossible = (att as any[]).length > 0;
    }
  }

  if (!externalPossible) {
    await touchIntent(intentId, {
      status: "cancelled",
      last_error: `cancelled by ${cancelledBy}: ${reason}`,
      claimed_by: null,
      lease_expires_at: null,
    });
    await mirrorCutoverSummary(intentId);
    return loadIntent(intentId);
  }

  await touchIntent(intentId, {
    status: "cancel_pending_readback",
    last_error: `cancel requested by ${cancelledBy}: ${reason} — awaiting ETD readback proof before terminal cancel`,
    claimed_by: null,
    lease_expires_at: null,
    next_retry_at: null,
  });
  await mirrorCutoverSummary(intentId);
  return loadIntent(intentId);
}

/**
 * Staff records PROOF of a manual ETD cancellation (repair spec §4): flips a
 * cancel_pending_readback (or manual_review) intent to terminal cancelled,
 * storing the evidence in reservation_evidence.cancellation.
 */
export async function recordCancellationEvidence(
  intentId: number,
  recordedBy: string,
  evidence: { etdCancellationRef?: string | null; note?: string | null },
): Promise<any> {
  const intent = await loadIntent(intentId);
  if (!["cancel_pending_readback", "manual_review"].includes(intent.status)) {
    throw new OrchestratorError(
      "bad_state",
      `cancellation evidence only applies from cancel_pending_readback or manual_review (status ${intent.status})`,
      409,
    );
  }
  const ref = strOrNull(evidence.etdCancellationRef);
  const note = strOrNull(evidence.note);
  if (!ref && !note) {
    throw new OrchestratorError("bad_payload", "evidence requires etdCancellationRef or note", 400);
  }
  const cancellation = { etdCancellationRef: ref, note, recordedBy, at: new Date().toISOString() };
  const { rows } = await db.execute(sql`
    UPDATE vrm_rental_workflow_intents
    SET status = 'cancelled',
        reservation_evidence = coalesce(reservation_evidence, '{}'::jsonb) || ${JSON.stringify({ cancellation })}::jsonb,
        last_error = ${`cancelled with recorded ETD evidence by ${recordedBy}`},
        claimed_by = NULL, lease_expires_at = NULL, updated_at = now()
    WHERE id = ${intentId} AND status = ${intent.status}
    RETURNING id
  `);
  if (!(rows as any[]).length) {
    throw new OrchestratorError("conflict", "intent moved while recording evidence; reload and retry", 409);
  }
  await mirrorCutoverSummary(intentId);
  return loadIntent(intentId);
}

// ---------------------------------------------------------------------------
// Reads for the UI
// ---------------------------------------------------------------------------

export async function getIntentDetail(intentId: number): Promise<any> {
  const intent = await loadIntent(intentId);
  const { rows: attempts } = await db.execute(sql`
    SELECT * FROM vrm_workflow_attempts WHERE intent_id = ${intentId} ORDER BY phase, attempt_no
  `);
  const { rows: guards } = await db.execute(sql`
    SELECT * FROM vrm_workflow_send_guards WHERE intent_id = ${intentId} ORDER BY message_moment
  `);
  const booking = (attempts as any[])
    .filter((a) => a.phase === "etd_booking")
    .sort((a, b) => Number(b.attempt_no ?? 0) - Number(a.attempt_no ?? 0));
  return {
    ...intent,
    displayPhase: deriveDisplayPhase(intent),
    attempts,
    guards,
    latestAttempt: latestAttemptOf(booking[0] ?? null),
  };
}

export async function listIntents(filters: { status?: string; workflowType?: string; ldap?: string; limit?: number }): Promise<any[]> {
  const limit = Math.max(1, Math.min(filters.limit ?? 100, 500));
  const conds: any[] = [sql`1 = 1`];
  if (filters.status) conds.push(sql`status = ${filters.status}`);
  if (filters.workflowType) conds.push(sql`workflow_type = ${filters.workflowType}`);
  if (filters.ldap) conds.push(sql`upper(ldap) = ${filters.ldap.toUpperCase()}`);
  const where = conds.reduce((acc, cur, i) => (i === 0 ? cur : sql`${acc} AND ${cur}`));
  const { rows } = await db.execute(sql`
    SELECT * FROM vrm_rental_workflow_intents WHERE ${where} ORDER BY updated_at DESC LIMIT ${limit}
  `);
  return (rows as any[]).map((r) => ({ ...r, displayPhase: deriveDisplayPhase(r) }));
}

/**
 * The last booking attempt, flattened for a card.
 *
 * `last_error` alone cannot tell an operator whether the engine has even run, when, or
 * what came back — and a later writer can overwrite it. The attempt row can't be
 * overwritten, so the card gets both.
 */
export type LatestAttemptSummary = {
  attemptNo: number | null;
  outcome: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  httpStatus: number | null;
};

/**
 * The two callers reach the same row by different routes — the by-source list through
 * `to_jsonb()` (already ISO) and the detail read straight off the driver (a
 * space-separated Postgres timestamp) — so normalise here. Only V8 parses the latter;
 * the card must not depend on that.
 */
function isoOrNull(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  // The pool hands timestamps back as "2026-08-17 14:15:32.402664+00": a space
  // separator, microsecond precision and an HOUR-ONLY offset, none of which Date.parse
  // is obliged to accept (this one parses to NaN). Normalise before parsing.
  const d = new Date(String(v).replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
}

function latestAttemptOf(raw: any): LatestAttemptSummary | null {
  if (!raw) return null;
  const evidence = raw.evidence ?? {};
  return {
    attemptNo: raw.attempt_no ?? null,
    outcome: strOrNull(raw.outcome),
    startedAt: isoOrNull(raw.started_at),
    finishedAt: isoOrNull(raw.finished_at),
    error: strOrNull(evidence?.error) ?? strOrNull(evidence?.reason),
    httpStatus: Number.isFinite(Number(evidence?.httpStatus)) ? Number(evidence.httpStatus) : null,
  };
}

/** Survey-page helper: intent status per survey response id. */
export async function intentsBySourceIds(workflowType: string, sourceIds: string[]): Promise<Record<string, any>> {
  if (!sourceIds.length) return {};
  const joined = sourceIds.map((s) => String(s)).join(",");
  const { rows } = await db.execute(sql`
    SELECT DISTINCT ON (i.source_id) i.*, to_jsonb(a) AS latest_attempt
    FROM vrm_rental_workflow_intents i
    LEFT JOIN LATERAL (
      SELECT attempt_no, outcome, started_at, finished_at, evidence
      FROM vrm_workflow_attempts
      WHERE intent_id = i.id AND phase = 'etd_booking'
      ORDER BY attempt_no DESC
      LIMIT 1
    ) a ON true
    WHERE i.workflow_type = ${workflowType}
      AND i.source_id = ANY(string_to_array(${joined}, ','))
    ORDER BY i.source_id, i.source_revision DESC, i.id DESC
  `);
  const out: Record<string, any> = {};
  for (const r of rows as any[]) {
    const { latest_attempt, ...intent } = r;
    out[r.source_id] = {
      ...intent,
      displayPhase: deriveDisplayPhase(intent),
      latestAttempt: latestAttemptOf(latest_attempt),
    };
  }
  return out;
}
