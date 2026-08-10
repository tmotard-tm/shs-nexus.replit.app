/**
 * Bucket-queue classification vocabulary + business-day SLA math (spec §6/§7,
 * docs/specs/2026-08-05-persona-bucket-queue-design.md).
 *
 * PURE module — no DB, no clock reads beyond todayET(); todays-queue.ts feeds
 * it signals it already loads and unit tests exercise every row of the table.
 *
 * Priorities are SOP §7; SLA clocks are business days (ET) from classification
 * onset (§7 anchor rule — the caller supplies the anchor day).
 */
import { teamForDistrict, UNROUTED_OWNER, type RoutingResult } from "./annex-a-routing";

export type Priority = 1 | 2 | 3 | 4;

export interface ClassificationDef {
  key: string;
  label: string;
  priority: Priority;
  /** Business days allowed from onset; null = no clock. */
  slaBusinessDays: number | null;
  ownerRule: "regional" | "rob" | "jennifer" | "district_team";
  /**
   * What the human owner should DO with an item in this bucket. LUCA handles
   * everything up to scheduling/contacting the tech, so every hint describes
   * the human hand-off point — shown verbatim on queue cards.
   */
  actionHint: string;
}

export const CLASSIFICATIONS: readonly ClassificationDef[] = [
  // Declined/auction terminal work splits three ways: the tech already has a
  // replacement (close out the rental); no replacement yet (locate a spare —
  // first-class queue work per user directive 2026-08-10, reversing the old
  // "sourcing is not this queue's job" dead-end); or the replacement itself is
  // in the shop — that one is LUCA's to track on the VRM pages and still
  // dead-ends out of the queue (see classify()).
  { key: "replacement_assigned", label: "Replacement assigned — close out rental", priority: 2, slaBusinessDays: 3, ownerRule: "regional",
    actionHint: "The tech is already assigned a different truck — nothing to source. Confirm the rental went back and close the case." },
  // No SLA clock on purpose: the work is availability-driven (a spare may not
  // exist for weeks) and red/overdue is reserved for real urgency — an
  // un-actionable countdown would nag without a next step (see spec appendix).
  { key: "needs_replacement", label: "Decommissioned — needs replacement (locate a spare)", priority: 1, slaBusinessDays: null, ownerRule: "regional",
    actionHint: "The truck is gone (decommissioned / declined / sold) and the tech is sitting in a rental. Locate an unassigned spare — district first — and start the assignment in the Spares flow; assignment itself stays there." },
  { key: "retrieval_pending", label: "Retrieval pending (decommission / sold)", priority: 1, slaBusinessDays: 5, ownerRule: "jennifer",
    actionHint: "Decommissioned / sold — arrange retrieval of the unit and close the rental." },
  // AMS is an equal terminal authority: when AMS says the van was declined /
  // sent to auction but the fleet status has NOT caught up, the record
  // conflict itself is the work — fix the status, then the case follows the
  // replacement/retrieval path above. Never pickup scheduling.
  { key: "ams_status_conflict", label: "AMS declined/auction — fix status conflict", priority: 2, slaBusinessDays: 1, ownerRule: "regional",
    actionHint: "AMS says this van was declined / sent to auction, but the fleet status hasn't caught up. Correct the fleet status — the case follows the replacement/retrieval path, never pickup scheduling." },
  { key: "luca_escalated", label: "LUCA escalated", priority: 2, slaBusinessDays: 2, ownerRule: "regional",
    actionHint: "LUCA escalated this case — read the last call summary, then take over the shop conversation." },
  { key: "unverified_confirm", label: "Unverified — confirm by phone", priority: 2, slaBusinessDays: 2, ownerRule: "regional",
    actionHint: "LUCA could not verify the status — call the shop yourself to confirm before acting." },
  { key: "ready_guard_review", label: "Ready-guard review", priority: 2, slaBusinessDays: 1, ownerRule: "regional",
    actionHint: "A ready signal was downgraded by the guard — review why before scheduling a pickup." },
  { key: "vehicle_ready_schedule", label: "Vehicle ready — schedule pickup", priority: 2, slaBusinessDays: 2, ownerRule: "regional",
    actionHint: "Readiness is phone-confirmed (LUCA call or manual verification) — schedule the tech pickup (Schedule button) and contact the tech." },
  { key: "po_closed_confirm", label: "PO closed — confirm with shop", priority: 2, slaBusinessDays: 2, ownerRule: "regional",
    actionHint: "Holman PO evidence says the repair closed, but no one has confirmed with the shop. Call the shop; if the truck is ready, mark it Verified ready. If the shop can't be validated, escalate to research." },
  { key: "research_truck_status", label: "Escalated to research — locate truck status", priority: 2, slaBusinessDays: 3, ownerRule: "regional",
    actionHint: "Shop could not be validated from POs and calls on file — research where the truck is and its repair status." },
  { key: "schedule_tech_pickup", label: "Schedule tech pickup", priority: 2, slaBusinessDays: 2, ownerRule: "regional",
    actionHint: "Set (or chase) the tech's pickup date — use the Schedule button to book the route block." },
  // "Scheduling" seeded from Fleet Scope is a CLAIM, not evidence (user
  // directive 2026-08-07): without a phone-confirmed ready the row is a
  // validation task, and schedule_tech_pickup stays locked until it clears.
  { key: "scheduling_unvalidated", label: "Scheduling — validate with shop first", priority: 2, slaBusinessDays: 2, ownerRule: "regional",
    actionHint: "Status says Scheduling, but no phone-confirmed call backs it up. Call the shop to confirm the truck is ready; if it is, mark it Verified ready — pickup scheduling unlocks once validated." },
  { key: "confirm_rental_returned", label: "Confirm rental returned", priority: 2, slaBusinessDays: null, ownerRule: "regional",
    actionHint: "Confirm the rental was actually returned, then close the case out." },
  { key: "pickup_follow_up", label: "Pickup follow-up", priority: 2, slaBusinessDays: null, ownerRule: "regional",
    actionHint: "The pickup date has passed — confirm the tech picked the truck up and returned the rental." },
  { key: "authorization_needed", label: "Authorization needed", priority: 2, slaBusinessDays: 1, ownerRule: "rob",
    actionHint: "Repair is stuck in authorization — push the approval through with Holman." },
  { key: "stalled_repair", label: "Stalled repair", priority: 2, slaBusinessDays: 3, ownerRule: "rob",
    actionHint: "Repair is stalled — call the shop for a firm ETA or escalate to the DM." },
  { key: "shop_record_fix", label: "Shop record fix", priority: 2, slaBusinessDays: null, ownerRule: "rob",
    actionHint: "The shop record is wrong — fix the shop name/phone so calls reach the right place." },
  { key: "truck_mismatch_no_po", label: "Truck mismatch — no qualifying PO", priority: 2, slaBusinessDays: 2, ownerRule: "regional",
    actionHint: "No qualifying repair PO on this truck — verify which truck is really in the shop." },
  { key: "needs_tow", label: "Needs tow", priority: 2, slaBusinessDays: 2, ownerRule: "regional",
    actionHint: "LUCA reports the truck needs a tow — arrange transport to the shop." },
  { key: "shop_missing_truck", label: "Shop does not have truck / relocated", priority: 2, slaBusinessDays: 3, ownerRule: "regional",
    actionHint: "Shop says it does not have the truck — verify the shop info: compare the number LUCA dialed with the current PO shop, and correct the record." },
  { key: "tech_unreachable", label: "Technician unreachable", priority: 2, slaBusinessDays: 3, ownerRule: "regional",
    actionHint: "Tech is unreachable — try an alternate contact or route through the DM." },
  { key: "tags_registration_hold", label: "Tags / registration hold", priority: 2, slaBusinessDays: 7, ownerRule: "district_team",
    actionHint: "Tags / registration hold — chase the district team for the paperwork." },
  { key: "aged_open_case", label: "Aged open case", priority: 3, slaBusinessDays: null, ownerRule: "regional",
    actionHint: "Old case with no active signal — review the history and set a concrete next step." },
  { key: "follow_up_due", label: "Follow-up due", priority: 3, slaBusinessDays: null, ownerRule: "regional",
    actionHint: "Workbook follow-up is due — do the follow-up and log the outcome." },
  { key: "shop_unreachable_callback", label: "Shop unreachable — call back", priority: 4, slaBusinessDays: 5, ownerRule: "regional",
    actionHint: "The shop has not answered — LUCA keeps retrying; call back manually if it stays quiet." },
] as const;

export const CLASSIFICATION_BY_KEY: ReadonlyMap<string, ClassificationDef> = new Map(
  CLASSIFICATIONS.map((c) => [c.key, c]),
);

// ---- business days (ET) ----------------------------------------------------

/** Today's date (YYYY-MM-DD) in ET — ops staff run on ET, server clock is UTC. */
export function todayET(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

const DAY = 86_400_000;

function isBusinessDay(d: Date): boolean {
  const wd = d.getUTCDay();
  return wd !== 0 && wd !== 6;
}

/** isoDay + n business days (weekends skipped; holidays deliberately not modeled). */
export function addBusinessDays(isoDay: string, n: number): string {
  let d = new Date(`${isoDay}T00:00:00Z`);
  let left = n;
  while (left > 0) {
    d = new Date(d.getTime() + DAY);
    if (isBusinessDay(d)) left--;
  }
  return d.toISOString().slice(0, 10);
}

/** Whole business days todayIsoDay is past dueIsoDay (0 when not yet due). */
export function businessDaysLate(dueIsoDay: string, todayIsoDay: string): number {
  if (todayIsoDay <= dueIsoDay) return 0;
  let d = new Date(`${dueIsoDay}T00:00:00Z`);
  let late = 0;
  const end = new Date(`${todayIsoDay}T00:00:00Z`);
  while (d < end) {
    d = new Date(d.getTime() + DAY);
    if (isBusinessDay(d)) late++;
  }
  return late;
}

/**
 * Trailing "…, TX 75201" → "TX". Shop-state fallback for Annex A routing when
 * the tech's home state is unknown (SHOP_PICK_CTE has no state column and must
 * not be extended — the fs_trucks repair address carries the same shop).
 */
export function shopStateFromAddress(addr: string | null | undefined): string | null {
  const m = /,\s*([A-Za-z]{2})\s+\d{5}(?:-\d{4})?\s*$/.exec(String(addr ?? "").trim());
  return m ? m[1].toUpperCase() : null;
}

// ---- classify ----------------------------------------------------------------

export interface ClassifyInput {
  fleetScopeStatus: string;
  subStatus: string | null;
  /** Display label from fs_trucks.lastCallStatus (LUCA vocabulary). */
  lucaStatus: string | null;
  lucaReady: boolean;
  /** A human manually verified with the shop that the truck is ready (per-case action, newer than any call). */
  readyVerified: boolean;
  /** Case escalated to research: shop can't be validated from POs + calls on file. */
  researchActive: boolean;
  latestCallUnresolved: boolean;
  /** Newest workbook state (API vocabulary), null when no workbook row. */
  workbookStatus: string | null;
  workbookFollowUpDue: boolean;
  escalated: boolean;
  erdPassed: boolean;
  poClosedWhileInRepair: boolean;
  schedulingDue: boolean;
  schedulingUnscheduled: boolean;
  pickupDatePassed: boolean;
  returnInFlight: boolean;
  etaSlips: number;
  daysInShop: number | null;
  daysSinceLastAttempt: number | null;
  callAttempts2d: number;
  tagsHold: boolean;
  noQualifyingPo: boolean;
  decommission: boolean;
  declinedOrAuction: boolean;
  /** AMS says the rental's van was declined for repair / sent to auction —
   *  terminal for the van regardless of what the fleet status claims. */
  amsTerminal: boolean;
  /** TPMS shows the tech currently assigned a DIFFERENT truck than this case's. */
  replacementAssigned: boolean;
  /** …and that assigned truck itself carries an open qualifying repair PO. */
  assignedTruckInRepair: boolean;
  readyGuardDowngraded: boolean;
  shopPhoneBad: boolean;
}

/**
 * All classifications that apply, deduped, highest priority first. Empty
 * signals degrade to aged_open_case (P3) — every open truck belongs to
 * exactly one bucket owner — EXCEPT one dead-end that returns [] on purpose:
 * a declined/auction case whose replacement truck is itself in the shop
 * (LUCA already tracks that repair); the builder routes it to "No action
 * required today" instead of the actionable queue.
 */
export function classify(x: ClassifyInput): string[] {
  const out: string[] = [];
  // Declined/auction is a TERMINAL branch: the truck is gone (sold/declined),
  // so every other signal on it (stalled repair, ready, tags…) is noise.
  // Three work states remain: tech already on a healthy replacement → close
  // out the rental; no replacement yet → locate a spare (needs_replacement,
  // user directive 2026-08-10 — reversing the old "nothing to do until one is
  // assigned" dead-end); replacement itself in the shop → LUCA already tracks
  // that repair on the VRM pages, so it stays a [] dead-end (Jennifer's
  // decommission retrieval still fires — that flow is hers regardless).
  if (x.declinedOrAuction || x.amsTerminal) {
    // AMS disagreeing with the fleet status is itself the actionable finding —
    // surface the conflict instead of letting the case dead-end invisibly.
    if (x.amsTerminal && !x.declinedOrAuction) out.push("ams_status_conflict");
    if (x.replacementAssigned && !x.assignedTruckInRepair) out.push("replacement_assigned");
    if (x.decommission) out.push("retrieval_pending");
    // Pushed AFTER retrieval_pending on purpose: both are P1 and the sort is
    // stable, so decommission retrieval (Jennifer's flow) stays primary.
    if (!x.replacementAssigned) out.push("needs_replacement");
    return out.sort((a, b) => CLASSIFICATION_BY_KEY.get(a)!.priority - CLASSIFICATION_BY_KEY.get(b)!.priority);
  }
  if (x.decommission) {
    out.push("retrieval_pending");
    // Decommission pipeline without a replacement: locating a spare is queue
    // work even before the fleet status flips terminal (after retrieval_pending
    // so the stable sort keeps Jennifer's retrieval primary — both P1).
    if (!x.replacementAssigned) out.push("needs_replacement");
  }
  if (x.escalated) out.push("luca_escalated");
  if (x.lucaStatus === "Unverified - confirm by phone") out.push("unverified_confirm");
  if (x.readyGuardDowngraded) out.push("ready_guard_review");
  // "Ready" is a phone-confirmed state only (LUCA call or a human's manual
  // verification). Closed-PO evidence and passed estimated-ready dates are
  // inferences — they demand a confirmation call, not a pickup dispatch.
  const confirmedReady = x.lucaReady || x.readyVerified;
  if (confirmedReady) out.push("vehicle_ready_schedule");
  if (x.researchActive && !confirmedReady) out.push("research_truck_status");
  // "Scheduling" seeded from Fleet Scope is a CLAIM, not evidence: without a
  // phone-confirmed ready (LUCA call or manual verification) the row is a
  // validation task and pickup scheduling stays locked (directive 2026-08-07).
  // Research absorbs the chase the same way it absorbs po_closed_confirm.
  const schedulingUnvalidated = x.fleetScopeStatus === "Scheduling" && !confirmedReady && !x.researchActive;
  if (schedulingUnvalidated) out.push("scheduling_unvalidated");
  if ((x.poClosedWhileInRepair || x.erdPassed) && !confirmedReady && !x.researchActive && !schedulingUnvalidated) out.push("po_closed_confirm");
  if ((x.schedulingDue || x.schedulingUnscheduled) && confirmedReady) out.push("schedule_tech_pickup");
  if (x.returnInFlight) out.push("confirm_rental_returned");
  if (x.pickupDatePassed) out.push("pickup_follow_up");
  if ((x.subStatus ?? "").toLowerCase().includes("authorization") || x.lucaStatus === "In Authorization" || x.fleetScopeStatus === "Decision Pending") out.push("authorization_needed");
  if (x.etaSlips >= 2 || (x.daysInShop ?? 0) > 60) out.push("stalled_repair");
  if (x.shopPhoneBad) out.push("shop_record_fix");
  if (x.noQualifyingPo) out.push("truck_mismatch_no_po");
  if (x.lucaStatus === "Needs Tow") out.push("needs_tow");
  if (x.lucaStatus === "Shop Does Not Have Truck" || x.lucaStatus === "Relocated") out.push("shop_missing_truck");
  if (x.callAttempts2d >= 3) out.push("tech_unreachable");
  if (x.tagsHold) out.push("tags_registration_hold");
  if (x.workbookFollowUpDue) out.push("follow_up_due");
  if (x.latestCallUnresolved && !confirmedReady && !x.researchActive) out.push("shop_unreachable_callback");
  if (out.length === 0) out.push("aged_open_case");
  const seen = new Set<string>();
  return out
    .filter((k) => !seen.has(k) && seen.add(k))
    .sort((a, b) => CLASSIFICATION_BY_KEY.get(a)!.priority - CLASSIFICATION_BY_KEY.get(b)!.priority);
}

/**
 * Owner for one classification of one item. A manual assignment beats every
 * rule (spec §8 — a human moved it on purpose); otherwise jennifer/rob/team
 * rules override the regional routing, and a team rule with an unknown
 * district degrades to Rob + needs-routing rather than guessing.
 */
export function ownerForClassification(
  def: ClassificationDef,
  routing: RoutingResult,
  district: string | null,
): { owner: string; needsRouting: boolean } {
  if (routing.basis === "manual") return { owner: routing.owner, needsRouting: false };
  switch (def.ownerRule) {
    case "jennifer":
      return { owner: "Jennifer Dyer", needsRouting: false };
    case "rob":
      return { owner: "Rob Anderson", needsRouting: false };
    case "district_team": {
      const t = teamForDistrict(district);
      return t ? { owner: t, needsRouting: false } : { owner: UNROUTED_OWNER, needsRouting: true };
    }
    default:
      return { owner: routing.owner, needsRouting: routing.needsRouting };
  }
}
