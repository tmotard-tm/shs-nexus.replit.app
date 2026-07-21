/**
 * Rightsize Tracker — van-status / workload dimension.
 *
 * WHY THIS EXISTS
 * The tracker's "No response" row read 12 techs / $5,222 and its next action
 * said "TL escalation". That was operationally wrong: most of those techs were
 * not ignoring us, they physically cannot complete a right-size swap. Two of
 * them have vans at auction, one had the repair declined, two already have a
 * spare van, one's rental had already dropped off the Holman feed. Telling a
 * Team Lead to chase a man whose van is at auction burns credibility.
 *
 * The Rental Operations page already carries Tyler's standing workload rule
 * (server/vrm/rental-operations/workload.ts, verbatim: "Cannot-work = declined
 * status" plus auction). The tracker never inherited it. This module is that
 * inheritance, expressed against the TECH'S OWN VAN rather than a rental case.
 *
 * TRUTH BOUNDARY (the RSZ-04 guard)
 * This dimension is PRESENTATION AND NEXT-ACTION CORRECTNESS ONLY. It must
 * never remove a tech from the addressable denominator, because shrinking the
 * denominator inflates secured% and that is exactly how a number goes upstairs
 * wrong. computeKpis() therefore reports cannot-work dollars as a SEPARATE
 * stated figure; securedMonthly / addressableMonthly / securedPct are computed
 * without ever consulting this module. See sync.ts computeKpis().
 */
import { sql } from "drizzle-orm";

/** The tech's own van, as the Holman open-ticket feed sees it. */
export type RightsizeVanStatus =
  | "auction"     // Sent To Auction — the van is gone for good
  | "declined"    // Declined Repair — the van is not coming back
  | "in_repair"   // In Repair — legitimately waiting on a shop
  | "spare"       // Spare — the tech already has a vehicle
  | "assigned"    // Assigned to Tech — normal
  | "reserved"    // Reserved For New Hire
  | "loa"         // Tech On LOA
  | "in_use"
  | "off_feed"    // had a case, but it dropped off the latest feed => resolved
  | "no_case"     // the tech's van is not in the rental-ops feed at all
  | "unknown";

export type RightsizeWorkload = "cannot_work" | "workable";

/**
 * Tyler's standing rule, inherited verbatim from the Rental Ops page:
 * declined / auction = CANNOT WORK.
 */
export const TYLER_CANNOT_WORK_STATUSES: readonly RightsizeVanStatus[] = ["auction", "declined"];

/**
 * The rightsize-specific set. It extends Tyler's rule with `spare` for ONE
 * reason, stated plainly so it can be reversed in one line: a tech whose own
 * van shows as a live Spare already has a vehicle, so the correct ask is
 * "return the rental", not "swap down to a sedan" — a right-size nudge to that
 * tech is the wrong ask, not an unanswered one.
 *
 * If Tyler wants the strict verbatim rule instead, change this to
 * TYLER_CANNOT_WORK_STATUSES and nothing else moves; the dollar math never
 * reads this list.
 */
export const RIGHTSIZE_CANNOT_WORK_STATUSES: readonly RightsizeVanStatus[] = [
  ...TYLER_CANNOT_WORK_STATUSES,
  "spare",
];

/**
 * Map a raw AMS status + feed presence to a van status.
 * Mirrors amsBucketOf() in rental-operations/read-repository.ts (same substring
 * rules, same order) so the two pages can never disagree about what "declined"
 * means. `presentInLatest === false` wins: a case that fell off the newest feed
 * is a resolved rental regardless of the status it wore on the way out.
 */
export function vanStatusOf(
  amsStatus: string | null | undefined,
  presentInLatest: boolean | null | undefined,
  hasCase: boolean,
): RightsizeVanStatus {
  if (!hasCase) return "no_case";
  if (presentInLatest === false) return "off_feed";
  const s = (amsStatus || "").toLowerCase();
  if (!s) return "unknown";
  if (s.includes("auction")) return "auction";
  if (s.includes("declin")) return "declined";
  if (s.includes("repair")) return "in_repair";
  if (s.includes("in use") || s.includes("in-use")) return "in_use";
  if (s.includes("spare")) return "spare";
  if (s.includes("reserved") || s.includes("new hire")) return "reserved";
  if (s.includes("loa")) return "loa";
  if (s.includes("assign")) return "assigned";
  return "unknown";
}

/** cannot_work when the van outcome makes the right-size ask itself wrong. */
export function deriveRightsizeWorkload(v: RightsizeVanStatus): RightsizeWorkload {
  return RIGHTSIZE_CANNOT_WORK_STATUSES.includes(v) ? "cannot_work" : "workable";
}

/** Human label for the UI and CSV. One place, so the page and the export agree. */
export const VAN_STATUS_LABEL: Record<RightsizeVanStatus, string> = {
  auction: "van sent to auction",
  declined: "van repair declined",
  in_repair: "van in repair",
  spare: "van is a spare",
  assigned: "van assigned to tech",
  reserved: "van reserved for new hire",
  loa: "tech on LOA",
  in_use: "van in use",
  off_feed: "rental closed (off feed)",
  no_case: "no rental case on file",
  unknown: "van status unknown",
};

/**
 * The join, reused rather than reinvented.
 *
 * Identical expression to read-repository.ts:242 — COALESCE(truck_lu,
 * last_known_truck_lu), digits only, left-trim zeros, 5-pad, '00000' => NULL —
 * so a truck resolves to the same case_key on both pages.
 *
 * The only addition is DEDUPING all_techs: three ldaps in the tracked universe
 * (JCOLEM0, JGUTIE2, JMOORE0) carry both a terminated and an active row, and a
 * plain join silently doubled those techs. Active wins, then newest effective
 * date, then employee_id as a stable tie-break.
 *
 * Requires the outer query to expose the tracked tech as alias `t` with a
 * `ldap` column.
 */
export const VAN_STATUS_JOIN = sql`
  LEFT JOIN LATERAL (
    SELECT COALESCE(a.truck_lu, a.last_known_truck_lu) AS truck_raw
    FROM all_techs a
    WHERE UPPER(TRIM(a.tech_racfid)) = t.ldap
    ORDER BY (a.employment_status = 'A') DESC, a.effective_date DESC NULLS LAST, a.employee_id
    LIMIT 1
  ) atr ON TRUE
  LEFT JOIN LATERAL (
    SELECT NULLIF(lpad(ltrim(regexp_replace(atr.truck_raw, '[^0-9]', '', 'g'), '0'), 5, '0'), '00000') AS own_pad
  ) ownp ON TRUE
  LEFT JOIN LATERAL (
    SELECT c.ams_status, c.present_in_latest
    FROM vrm_rental_operations_cases c
    WHERE c.case_key = ownp.own_pad
    ORDER BY c.present_in_latest DESC, c.last_seen_at DESC NULLS LAST
    LIMIT 1
  ) roc ON TRUE
`;

/** The columns VAN_STATUS_JOIN makes available. Select these alongside t.*. */
export const VAN_STATUS_COLUMNS = sql`
  ownp.own_pad AS own_truck,
  roc.ams_status AS van_ams_status,
  roc.present_in_latest AS van_present_in_latest,
  (roc.ams_status IS NOT NULL OR roc.present_in_latest IS NOT NULL) AS van_has_case
`;

/** Row shape produced by VAN_STATUS_COLUMNS. */
export interface VanStatusRow {
  own_truck?: string | null;
  van_ams_status?: string | null;
  van_present_in_latest?: boolean | null;
  van_has_case?: boolean | null;
}

export interface VanStatusFields {
  own_truck: string | null;
  ams_status: string | null;
  van_status: RightsizeVanStatus;
  van_status_label: string;
  workload: RightsizeWorkload;
}

/** Decorate one raw row with the derived van dimension. */
export function vanFieldsOf(r: VanStatusRow): VanStatusFields {
  const van = vanStatusOf(r.van_ams_status, r.van_present_in_latest, r.van_has_case === true);
  return {
    own_truck: r.own_truck ?? null,
    ams_status: r.van_ams_status ?? null,
    van_status: van,
    van_status_label: VAN_STATUS_LABEL[van],
    workload: deriveRightsizeWorkload(van),
  };
}
