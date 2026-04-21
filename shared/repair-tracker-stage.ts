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

  // 1. Closed cases are Complete regardless of status.
  if (input.closedAt) return "Complete";

  // 2. Rule-based Completed assertion: main On Road AND tech On Road.
  if (main === "on road" && onRoad) return "Complete";

  // 3. Vehicle ready but tech hasn't picked up.
  if (main === "on road") return "Ready for Pickup";

  // 4. Active repair (operates on either main OR sub).
  if (main === "repairing" || REPAIR_SUB_STATUSES.has(sub)) return "In Repair";

  // 5. BYOV offered, awaiting tech decision.
  if (input.byovOffered && !input.byovStatus) return "BYOV Decision";

  // 6. Tech hasn't been contacted yet.
  if (!input.techContacted) return "Needs Tech Call";

  // 7. Rental return outstanding.
  if (!rentalYes && !rentalNA) return "Awaiting Rental Return";

  // 8. Rental returned but routing not yet cleared.
  if (rentalYes && !input.routeCleared) return "Awaiting Route Clear";

  // 9. Fallback.
  return "Needs Tech Call";
}

export function sectionForStage(stage: Stage): Section {
  switch (stage) {
    case "Complete":
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
