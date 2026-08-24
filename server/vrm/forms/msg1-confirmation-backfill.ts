/**
 * Msg1 confirmation backfill — Task: text the booked techs who never got
 * their reservation confirmation.
 *
 * Prod audit 2026-08-24: of the booked + block-filed cutover rows still on
 * the Holman book, 71 technicians never received the confirmation text with
 * their reservation number. The one-time Msg1 blast ran 2026-08-18 and
 * nothing covered bookings made after it (the 2026-08-20 wave is 65 of the
 * 71). Those techs had 30 minutes of their route blocked with no idea why —
 * which is exactly why they are still on the Holman book, double-billing.
 *
 * Design rules, all learned the hard way elsewhere in this module:
 *   - Population comes from buildCutoverStatusPayload — the ONE derivation of
 *     book state — never a private re-implementation of its joins.
 *   - "Already texted" is EVIDENCE-based (an outbound fs_comms_messages row
 *     carrying the row's CURRENT etd_reference, or the Msg1/Msg2 wording tied
 *     to this tech), never a stamp column. That makes re-runs safe by
 *     construction: this run's sends contain the etd_reference, so the next
 *     run sees them as evidence.
 *   - Sends go through the Fleet Comms lane (sendMessage, category
 *     rental_management): quiet hours, opt-outs and the 24h duplicate gate
 *     all apply. Never raw Twilio.
 *   - A route-block date already in the past gets ADJUSTED wording (catch-up:
 *     "as soon as you can", never "Tomorrow ... 8:00 AM") and the row is
 *     flagged for re-filing review in the report.
 *   - A message missing its reservation number or branch address is WITHHELD,
 *     not padded with fallbacks — a text nobody can act on reads as
 *     instructions and sends someone to ", ." (2026-08-19 lesson).
 */
import { db } from "../../db";
import { sql } from "drizzle-orm";
import {
  COMMS_CATEGORY,
  renderMsg1,
  formatBranchAddress,
  isContractBlockLive,
  etTodayISO,
  addDaysISO,
} from "./cutover-orchestrator";
import { buildCutoverStatusPayload } from "./survey";
import { sendMessage } from "../../fleet-comms/outbound";

// ---------------------------------------------------------------------------
// Pure planning
// ---------------------------------------------------------------------------

/** The payload-row fields this backfill reads (subset of the cutover-status row). */
export type BackfillRow = {
  ldap: string;
  tech_name?: string | null;
  reservation_status?: string | null;
  etd_reference?: string | null;
  branch_name?: string | null;
  branch_address?: string | null;
  route_block_status?: string | null;
  route_block_live?: boolean | null;
  route_block_date?: string | null; // 'YYYY-MM-DD' (pg pool returns DATE as string)
  holman_book_state?: string | null;
};

export type BackfillDecision = {
  ldap: string;
  action: "send" | "skip" | "withhold";
  reason: string;
  /** rendered body when action === 'send' */
  body?: string;
  /** past/absent block date — the block itself likely needs re-filing */
  needsRefileReview?: boolean;
  dayLabel?: string | null;
};

/** "SMITH, JOHN A" -> "John"; "John Smith" -> "John". Empty when unknown. */
export function firstNameOf(techName: unknown): string {
  const s = String(techName ?? "").trim();
  if (!s) return "";
  const source = s.includes(",") ? s.split(",")[1] ?? "" : s;
  const first = source.trim().split(/\s+/)[0] ?? "";
  if (!first || !/^[A-Za-z'.-]+$/.test(first)) return "";
  return first[0].toUpperCase() + first.slice(1).toLowerCase();
}

/** 2026-08-26 -> "Tue 8/26" (UTC-anchored; input is a calendar date). */
function usDayDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!m) return String(iso);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  return `${day} ${Number(m[2])}/${Number(m[3])}`;
}

/**
 * Day label for renderMsg1 relative to the ET calendar day, or null when the
 * block date is already past (or absent) and the "we have blocked tomorrow"
 * frame would be a lie.
 */
export function dayLabelFor(blockDateISO: string | null | undefined, todayISO: string): string | null {
  const iso = String(blockDateISO ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  if (iso < todayISO) return null;
  if (iso === todayISO) return "Today";
  if (iso === addDaysISO(todayISO, 1)) return "Tomorrow";
  return `On ${usDayDate(iso)}`;
}

/**
 * Catch-up wording for a block date already past: same facts (confirmation,
 * branch, address, the reassurances), but "stop by as soon as you can" —
 * never a claim about a route block that already came and went.
 */
export function renderMsg1Catchup(f: {
  conf: string;
  branchName: string;
  branchAddress: string;
  firstName?: string;
  blockDateISO?: string | null;
}): string {
  const who = f.firstName ? `Hi ${f.firstName}, this is` : "This is";
  const blocked = f.blockDateISO
    ? `Time was blocked on your route on ${usDayDate(f.blockDateISO)} for this stop, but our records show it has not happened yet. `
    : "";
  return (
    `${who} Sears Fleet. We have a rental reservation for you to switch your rental to ` +
    `Sears direct billing. Confirmation ${f.conf}. ${blocked}` +
    `Please stop at Enterprise ${f.branchName}, ${f.branchAddress} as soon as you are able.\n\n` +
    `You keep the vehicle you are driving. This is a billing change only. The branch will ` +
    `close your current Holman agreement and re-sign the same vehicle under Sears direct ` +
    `billing. Bring your driver's license. There is nothing for you to pay and nothing to ` +
    `hand back. It usually takes about 15 minutes.\n\n` +
    `If you have any issue and need immediate help, reach out to an agent in Sasha. Reply ` +
    `back here with an update once it is completed. This inbox is monitored throughout the ` +
    `day but not constantly.`
  );
}

/** Book states that mean "still on the Holman book" — the audit's population. */
const ON_BOOK_STATES = new Set(["open", "rolled", "pended"]);

/**
 * Classify one payload row. Pure; `confirmedLdaps` is the evidence set
 * (uppercased LDAPs with a prior confirmation-shaped outbound text).
 */
export function classifyBackfillRow(
  row: BackfillRow,
  confirmedLdaps: Set<string>,
  todayISO: string,
): BackfillDecision {
  const ldap = String(row.ldap ?? "").trim().toUpperCase();
  if (String(row.reservation_status ?? "") !== "booked") {
    return { ldap, action: "skip", reason: "not_booked" };
  }
  if (String(row.route_block_status ?? "") !== "filed" || row.route_block_live !== true) {
    return { ldap, action: "skip", reason: "no_live_route_block" };
  }
  const book = String(row.holman_book_state ?? "");
  if (!ON_BOOK_STATES.has(book)) {
    // '' = off the book (collected — nothing to chase); 'unanchored' = the old
    // book is UNKNOWN for this row. Unknown ≠ clean, but a confirmation text
    // is not the fix for an unanchored row either; report it distinctly.
    return { ldap, action: "skip", reason: book === "unanchored" ? "book_unanchored" : "off_book" };
  }
  if (confirmedLdaps.has(ldap)) {
    return { ldap, action: "skip", reason: "already_confirmed" };
  }
  const conf = String(row.etd_reference ?? "").trim();
  if (!conf) {
    return { ldap, action: "withhold", reason: "missing_reservation_number" };
  }
  const branchName = String(row.branch_name ?? "").trim();
  const branchAddress = formatBranchAddress(row.branch_address);
  if (!branchName || !branchAddress) {
    return { ldap, action: "withhold", reason: "missing_branch_facts" };
  }
  const firstName = firstNameOf(row.tech_name);
  const dayLabel = dayLabelFor(row.route_block_date, todayISO);
  if (dayLabel === null) {
    const blockISO = String(row.route_block_date ?? "").slice(0, 10) || null;
    return {
      ldap,
      action: "send",
      reason: blockISO ? "block_date_past" : "block_date_missing",
      needsRefileReview: true,
      dayLabel: null,
      body: renderMsg1Catchup({ conf, branchName, branchAddress, firstName, blockDateISO: blockISO }),
    };
  }
  return {
    ldap,
    action: "send",
    reason: "needs_confirmation",
    dayLabel,
    body: renderMsg1({ conf, branchName, branchAddress, firstName: firstName || undefined, dayLabel }),
  };
}

export function planMsg1Backfill(
  rows: BackfillRow[],
  confirmedLdaps: Set<string>,
  todayISO: string,
): BackfillDecision[] {
  return rows.map((r) => classifyBackfillRow(r, confirmedLdaps, todayISO));
}

// ---------------------------------------------------------------------------
// Evidence fetch (impure)
// ---------------------------------------------------------------------------

/** Msg1/Msg2 wording markers — must track renderMsg1/renderMsg2 verbatim. */
const WORDING_MARKERS = ["blocked the first 30 minutes", "8:00 am block"];

export type EvidenceMessage = {
  ldap?: string | null;
  phoneDigits?: string | null;
  body: string;
};

/**
 * Pure evidence matcher. A tech is "already confirmed" when an outbound
 * message either:
 *   - carries the row's CURRENT etd_reference in its body (any recipient —
 *     the reference identifies the reservation), or
 *   - carries the Msg1/Msg2 wording AND is tied to THIS tech via the
 *     message's own ldap or the contact's phone digits.
 * A rebooked reservation deliberately fails the first arm (the old text
 * carries the old reference); wording evidence still counts via the second.
 * That matches the audit exactly: its 71 are the rows failing BOTH arms.
 */
export function matchConfirmationEvidence(
  rows: Array<{ ldap: string; etd_reference?: string | null }>,
  messages: EvidenceMessage[],
  contactDigitsByLdap: Map<string, string>,
): Set<string> {
  const out = new Set<string>();
  const prepared = messages.map((m) => ({
    ldap: String(m.ldap ?? "").trim().toUpperCase(),
    digits: String(m.phoneDigits ?? "").replace(/[^0-9]/g, "").slice(-10),
    upperBody: String(m.body ?? "").toUpperCase(),
    lowerBody: String(m.body ?? "").toLowerCase(),
  }));
  for (const r of rows) {
    const ldap = String(r.ldap ?? "").trim().toUpperCase();
    if (!ldap || out.has(ldap)) continue;
    const ref = String(r.etd_reference ?? "").trim().toUpperCase();
    const contactDigits = contactDigitsByLdap.get(ldap) ?? "";
    for (const m of prepared) {
      if (ref && m.upperBody.includes(ref)) {
        out.add(ldap);
        break;
      }
      if (
        WORDING_MARKERS.some((w) => m.lowerBody.includes(w)) &&
        (m.ldap === ldap || (contactDigits.length === 10 && m.digits === contactDigits))
      ) {
        out.add(ldap);
        break;
      }
    }
  }
  return out;
}

/**
 * Evidence fetch. The first version ran a correlated EXISTS with position()
 * over every (cutover row × outbound message) pair and hit the prod
 * statement timeout. Instead: ONE prefiltered scan of outbound messages
 * since 2026-08-01 (the cutover program's first text was 2026-08-17, so no
 * confirmation-shaped message can predate August), matched in JS.
 *
 * The prefilter keeps every message that could satisfy either evidence arm:
 * the Msg1/Msg2 wording markers, plus 'conf' / 'reservation' for the
 * reference arm (every templated send says "Confirmation {ref}", and a
 * manual staff text carrying a reservation number says "conf"/"reservation"
 * in practice). Broad on purpose — it is a prefilter, not the match.
 */
export async function fetchConfirmationEvidence(
  rows: Array<{ ldap: string; etd_reference?: string | null }>,
): Promise<Set<string>> {
  const ldaps = Array.from(
    new Set(rows.map((r) => String(r.ldap ?? "").trim().toUpperCase()).filter(Boolean)),
  );
  if (!ldaps.length) return new Set();

  const { rows: msgs } = await db.execute(sql`
    SELECT upper(COALESCE(m.ldap, '')) AS ldap,
           COALESCE(m.phone_digits, '') AS phone_digits,
           m.body
      FROM fs_comms_messages m
     WHERE m.direction = 'outbound'
       AND m.created_at >= timestamp '2026-08-01'
       AND (m.body ILIKE '%blocked the first 30 minutes%'
            OR m.body ILIKE '%8:00 AM block%'
            OR m.body ILIKE '%conf%'
            OR m.body ILIKE '%reservation%')
  `);

  // Contact phone per ldap for the wording arm (per-element binds — raw
  // JS-array = ANY() binds break on the pg pool driver).
  const contactDigits = new Map<string, string>();
  const inList = sql.join(ldaps.map((l) => sql`${l}`), sql`, `);
  const { rows: contacts } = await db.execute(sql`
    SELECT upper(ldap) AS ldap,
           right(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), 10) AS digits
      FROM fs_comms_contacts
     WHERE upper(ldap) IN (${inList})
  `);
  for (const c of contacts as any[]) {
    if (String(c.digits ?? "").length === 10) contactDigits.set(String(c.ldap), String(c.digits));
  }

  return matchConfirmationEvidence(
    rows,
    (msgs as any[]).map((m) => ({ ldap: m.ldap, phoneDigits: m.phone_digits, body: m.body })),
    contactDigits,
  );
}

// ---------------------------------------------------------------------------
// Runner (impure)
// ---------------------------------------------------------------------------

export type BackfillRunResult = {
  dryRun: boolean;
  todayISO: string;
  population: number;
  candidates: number;
  sent: number;
  queued: number;
  skippedByLane: number;
  withheld: number;
  skipped: Record<string, number>;
  needsRefileReview: string[];
  results: Array<{
    ldap: string;
    action: string;
    reason: string;
    needsRefileReview?: boolean;
    dayLabel?: string | null;
    laneStatus?: string;
    laneReason?: string;
    body?: string;
  }>;
};

export async function runMsg1ConfirmationBackfill(opts: {
  dryRun: boolean;
  limit?: number;
  onlyLdaps?: string[];
  requestedBy?: string;
}): Promise<BackfillRunResult> {
  const dryRun = opts.dryRun !== false;
  // Same master kill switch as every other live cutover send path: disarmed
  // flag = no live texts, full stop.
  if (!dryRun && !isContractBlockLive()) {
    throw new Error("VRM_CONTRACT_BLOCK_ENABLED is not armed; live sends are disabled");
  }
  const limit = Math.min(Math.max(Number(opts.limit) || 200, 1), 500);
  const only = new Set(
    (opts.onlyLdaps ?? []).map((l) => String(l ?? "").trim().toUpperCase()).filter(Boolean),
  );

  const payload = await buildCutoverStatusPayload();
  let rows = (payload.rows as BackfillRow[]) ?? [];
  if (only.size) rows = rows.filter((r) => only.has(String(r.ldap ?? "").trim().toUpperCase()));

  const todayISO = etTodayISO();
  const evidence = await fetchConfirmationEvidence(rows);
  const plan = planMsg1Backfill(rows, evidence, todayISO);

  const result: BackfillRunResult = {
    dryRun,
    todayISO,
    population: rows.length,
    candidates: plan.filter((d) => d.action === "send").length,
    sent: 0,
    queued: 0,
    skippedByLane: 0,
    withheld: 0,
    skipped: {},
    needsRefileReview: [],
    results: [],
  };

  let dispatched = 0;
  for (const d of plan) {
    if (d.action === "skip") {
      result.skipped[d.reason] = (result.skipped[d.reason] || 0) + 1;
      // keep the report readable: only per-row lines for actionable outcomes
      continue;
    }
    if (d.needsRefileReview) result.needsRefileReview.push(d.ldap);
    if (d.action === "withhold") {
      result.withheld++;
      result.results.push({ ldap: d.ldap, action: d.action, reason: d.reason });
      continue;
    }
    if (dispatched >= limit) {
      result.results.push({ ldap: d.ldap, action: "deferred", reason: "over_limit" });
      continue;
    }
    dispatched++;
    // The Fleet Comms lane owns phone resolution, opt-out, quiet hours and the
    // 24h duplicate gate. Branch on ALL statuses (send-status contract):
    // refusals persist nothing and must be visible in the report.
    const lane = await sendMessage({
      ldap: d.ldap,
      category: COMMS_CATEGORY,
      body: d.body!,
      sentBy: opts.requestedBy ? `msg1-backfill:${opts.requestedBy}` : "msg1-backfill",
      senderName: "SHS Fleet",
      skipRecentDuplicate: true,
      dryRun,
    });
    if (lane.status === "sent") result.sent++;
    else if (lane.status === "queued") result.queued++;
    else result.skippedByLane++;
    result.results.push({
      ldap: d.ldap,
      action: d.action,
      reason: d.reason,
      needsRefileReview: d.needsRefileReview,
      dayLabel: d.dayLabel,
      laneStatus: lane.status,
      laneReason: lane.reason,
      ...(dryRun ? { body: d.body } : {}),
    });
  }
  return result;
}
