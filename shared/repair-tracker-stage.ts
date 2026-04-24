/**
 * Repair Tracker Stage + Section derivation.
 *
 * Single shared function used by both backend (filtering / section assignment)
 * and frontend (rendering the Stage pill + section bucketing).
 *
 * Per the task plan, rules operate on the (main_status, sub_status) pair plus
 * the other source fields. `tech_status` of "Route Canceled" or NULL is
 * treated as "not On Road" for Stage purposes but preserved as its own visible
 * pill in the Van Status column (handled in the renderer, not here).
 *
 * Top-down, first match wins.
 */

export const STAGES = [
  "Complete",
  "BYOV Permanent",       // tech is permanently BYOV — tech-side complete, van separately reassignable
  "Ready for Pickup",
  "In Repair",
  "BYOV Decision",
  "Awaiting Rental Return",
  "Awaiting Route Clear",
  "Needs Tech Call",
] as const;
export type Stage = (typeof STAGES)[number];

export const SECTIONS = ["Action Needed", "In Progress", "Completed"] as const;
export type Section = (typeof SECTIONS)[number];

export interface StageInput {
  mainStatus: string | null | undefined;
  subStatus: string | null | undefined;
  techStatus: string | null | undefined;
  techContacted: boolean | null | undefined;
  rentalReturned: string | null | undefined; // "Yes" | "No" | "N/A" | null
  routeCleared: boolean | null | undefined;
  byovOffered: boolean | null | undefined;
  byovStatus: string | null | undefined;
  closedAt: Date | string | null | undefined;
}

const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

/** Treat "On Road" as the only true "tech is on the road" value. */
function techIsOnRoad(techStatus: string | null | undefined): boolean {
  return norm(techStatus) === "on road";
}

const REPAIR_SUB_STATUSES = new Set([
  "under repair at shop",
  "delivered to technician",
  "in shop",
]);

export function deriveStage(input: StageInput): Stage {
  const main = norm(input.mainStatus);
  const sub = norm(input.subStatus);
  const onRoad = techIsOnRoad(input.techStatus);
  const rentalYes = norm(input.rentalReturned) === "yes";
  const rentalNA = norm(input.rentalReturned) === "n/a";
  const byov = norm(input.byovStatus);

  // 1. Closed cases are Complete regardless of status.
  if (input.closedAt) return "Complete";

  // 2. Permanent BYOV — tech is permanently off this van. Tech-side is done;
  //    whatever happens to the van next (repair + reassignment) is tracked on
  //    the van's row, not via waiting on this tech. Lands in Completed so the
  //    team stops chasing tech-side steps. Note: we still need rental returned
  //    to be resolved (Yes / N/A) — if the tech has an outstanding rental we
  //    must get it back before this counts as complete.
  if (byov === "permanent" && (rentalYes || rentalNA)) return "BYOV Permanent";

  // 3. Rule-based Completed assertion: main On Road AND tech On Road.
  if (main === "on road" && onRoad) return "Complete";

  // 4. Vehicle ready but tech hasn't picked up.
  if (main === "on road") return "Ready for Pickup";

  // 5. Active repair (operates on either main OR sub).
  if (main === "repairing" || REPAIR_SUB_STATUSES.has(sub)) return "In Repair";

  // 6. BYOV offered, awaiting tech decision.
  if (input.byovOffered && !input.byovStatus) return "BYOV Decision";

  // 7. Tech hasn't been contacted yet.
  if (!input.techContacted) return "Needs Tech Call";

  // 8. Rental return outstanding.
  if (!rentalYes && !rentalNA) return "Awaiting Rental Return";

  // 9. Rental returned but routing not yet cleared.
  if (rentalYes && !input.routeCleared) return "Awaiting Route Clear";

  // 10. Fallback.
  return "Needs Tech Call";
}

export function sectionForStage(stage: Stage): Section {
  switch (stage) {
    case "Complete":
    case "BYOV Permanent":
      return "Completed";
    case "Ready for Pickup":
    case "In Repair":
      return "In Progress";
    case "Needs Tech Call":
    case "BYOV Decision":
    case "Awaiting Rental Return":
    case "Awaiting Route Clear":
      return "Action Needed";
  }
}

export function deriveSection(input: StageInput): Section {
  return sectionForStage(deriveStage(input));
}

// ─── Auto-flag tints ──────────────────────────────────────────────────────────
// Render-time tints applied to each row in the Repair Tracker table.
// Multiple tints can apply to the same row (each is independent).
// `red` and `yellow` set the row background; `blue` sets a left border accent.

export const STALE_SHOP_CONTACT_DAYS = 5;
export const STUCK_RENTAL_RETURN_DAYS = 7;
export const ARCHIVE_AFTER_DAYS = 14;
export const COMPLETE_AUTO_MOVE_HOURS = 24;

export interface FlagInput extends StageInput {
  deniedAt: Date | string | null | undefined;
  shopLastContactedDate: Date | string | null | undefined;
}

export interface RowFlags {
  red: { active: boolean; tooltip?: string };
  yellow: { active: boolean; tooltip?: string };
  blue: { active: boolean; tooltip?: string };
}

function asDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

export function deriveFlags(input: FlagInput, now: Date = new Date()): RowFlags {
  const stage = deriveStage(input);
  const section = sectionForStage(stage);

  // Closed/Completed rows do not flag.
  if (section === "Completed") {
    return {
      red: { active: false },
      yellow: { active: false },
      blue: { active: false },
    };
  }

  const denied = asDate(input.deniedAt);
  const rentalState = (input.rentalReturned ?? "").trim().toLowerCase();
  const rentalOutstanding = rentalState !== "yes" && rentalState !== "n/a";

  // RED — stuck on rental return: rental not returned AND denied N+ days ago.
  let red: RowFlags["red"] = { active: false };
  if (rentalOutstanding && denied) {
    const days = daysBetween(now, denied);
    if (days >= STUCK_RENTAL_RETURN_DAYS) {
      red = {
        active: true,
        tooltip: `Stuck on rental return — denied ${days} days ago`,
      };
    }
  }

  // YELLOW — stale shop contact: no contact in N+ days (or never contacted, on a case
  // that's been open at least N days).
  let yellow: RowFlags["yellow"] = { active: false };
  const lastShop = asDate(input.shopLastContactedDate);
  if (lastShop) {
    const days = daysBetween(now, lastShop);
    if (days >= STALE_SHOP_CONTACT_DAYS) {
      yellow = {
        active: true,
        tooltip: `Stale shop contact — last contacted ${days} days ago`,
      };
    }
  } else if (denied) {
    const days = daysBetween(now, denied);
    if (days >= STALE_SHOP_CONTACT_DAYS) {
      yellow = {
        active: true,
        tooltip: `Stale shop contact — never contacted, case open ${days} days`,
      };
    }
  }

  // BLUE (left border) — notify routing: rental back but route not cleared.
  let blue: RowFlags["blue"] = { active: false };
  if (rentalState === "yes" && !input.routeCleared) {
    blue = {
      active: true,
      tooltip: "Notify routing — rental returned but route not yet cleared",
    };
  }

  return { red, yellow, blue };
}

/** True when a Completed-section row should hide behind the "Show Archived" toggle. */
export function isArchived(
  closedAt: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  const d = asDate(closedAt);
  if (!d) return false;
  return daysBetween(now, d) >= ARCHIVE_AFTER_DAYS;
}
