// Executive Summary — rule-based insight cards.
//
// Six deterministic rules over the same CaseFacts the buckets use. Cards with
// count 0 are omitted. Pure — no DB, no clock reads (now is a parameter).

import type { CaseFacts, ExecBucket } from "./buckets";
import { SEDAN_FLOOR, isVanLikeClass } from "./metrics";

export interface InsightCard {
  id: string;
  title: string;
  severity: "high" | "medium" | "info";
  count: number;
  dailyImpact: number;
  description: string;
  caseKeys: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const DAY_MS = 86_400_000;

export function buildInsights(
  facts: CaseFacts[],
  classified: Map<string, { bucket: ExecBucket; unknownRenter: boolean }>,
  rightsizeTechs: { ldap: string; stage: string; stageChangedAt: string | null }[],
  now: Date,
): InsightCard[] {
  const cards: InsightCard[] = [];
  const byCostDesc = (a: CaseFacts, b: CaseFacts) => (b.dailyCost ?? 0) - (a.dailyCost ?? 0);
  const sumCost = (list: CaseFacts[]) => round2(list.reduce((s, f) => s + (f.dailyCost ?? 0), 0));

  // 1. long_runners — open > 45 days
  const longRunners = facts.filter((f) => (f.daysOpen ?? 0) > 45).sort(byCostDesc);
  if (longRunners.length) {
    cards.push({
      id: "long_runners",
      title: "Rentals open more than 45 days",
      severity: "high",
      count: longRunners.length,
      dailyImpact: sumCost(longRunners),
      description: `${longRunners.length} rentals have been open over 45 days, costing ${fmtUsd(sumCost(longRunners))}/day combined.`,
      caseKeys: longRunners.map((f) => f.caseKey),
    });
  }

  // 2. rightsize_uncovered — van-like rental, resolved renter, not in the rightsize program
  const rsLdaps = new Set(
    rightsizeTechs.map((t) => t.ldap.trim().toUpperCase()).filter(Boolean),
  );
  const uncovered = facts
    .filter(
      (f) =>
        f.identityResolved &&
        !!f.employeeId &&
        isVanLikeClass(f.classBucket) &&
        !rsLdaps.has(f.employeeId.toUpperCase()),
    )
    .sort(byCostDesc);
  if (uncovered.length) {
    const impact = round2(
      uncovered.reduce((s, f) => s + Math.max(0, (f.dailyCost ?? 0) - SEDAN_FLOOR), 0),
    );
    cards.push({
      id: "rightsize_uncovered",
      title: "Van/SUV renters not in the rightsize program",
      severity: "medium",
      count: uncovered.length,
      dailyImpact: impact,
      description: `${uncovered.length} identified renters are in van/SUV-class rentals but not enrolled in rightsizing — ${fmtUsd(impact)}/day of potential sedan savings.`,
      caseKeys: uncovered.map((f) => f.caseKey),
    });
  }

  // 3. rightsize_stalled — COMMITTED > 14 days without movement (null date = stalled)
  const stalled = rightsizeTechs.filter((t) => {
    if (t.stage.trim().toUpperCase() !== "COMMITTED") return false;
    if (!t.stageChangedAt) return true;
    const changed = Date.parse(t.stageChangedAt);
    return Number.isNaN(changed) || now.getTime() - changed > 14 * DAY_MS;
  });
  const nonResponders = rightsizeTechs.filter(
    (t) => t.stage.trim().toUpperCase() === "NON_RESPONDER",
  ).length;
  if (stalled.length) {
    cards.push({
      id: "rightsize_stalled",
      title: "Rightsize commitments going stale",
      severity: "medium",
      count: stalled.length,
      dailyImpact: 0,
      description: `${stalled.length} techs committed to rightsizing over 14 days ago with no movement since; ${nonResponders} non-responder${nonResponders === 1 ? "" : "s"} in the program.`,
      caseKeys: [], // tech-level, not case-level
    });
  }

  // 4. extension_pileups — 3+ extensions OR past the authorized window
  const pileups = facts
    .filter((f) => (f.extensions ?? 0) >= 3 || (f.daysBehind ?? 0) > 0)
    .sort(byCostDesc);
  if (pileups.length) {
    cards.push({
      id: "extension_pileups",
      title: "Extension pile-ups / past authorization",
      severity: "medium",
      count: pileups.length,
      dailyImpact: sumCost(pileups),
      description: `${pileups.length} rentals have 3+ extensions or are past their authorized days.`,
      caseKeys: pileups.map((f) => f.caseKey),
    });
  }

  // 5. unknown_renters — nobody accountable
  const unknown = facts
    .filter((f) => classified.get(f.caseKey)?.unknownRenter)
    .sort(byCostDesc);
  if (unknown.length) {
    cards.push({
      id: "unknown_renters",
      title: "Rentals with no identified renter",
      severity: "high",
      count: unknown.length,
      dailyImpact: sumCost(unknown),
      description: `${unknown.length} open rentals have no resolved renter — ${fmtUsd(sumCost(unknown))}/day with nobody accountable.`,
      caseKeys: unknown.map((f) => f.caseKey),
    });
  }

  // 6. new_hire_aging — still on a rental well past the provisioning window
  const nhAging = facts
    .filter(
      (f) => classified.get(f.caseKey)?.bucket === "new_hire" && (f.daysOpen ?? 0) > 45,
    )
    .sort(byCostDesc);
  if (nhAging.length) {
    cards.push({
      id: "new_hire_aging",
      title: "New hires still on rentals past 45 days",
      severity: "info",
      count: nhAging.length,
      dailyImpact: sumCost(nhAging),
      description: `${nhAging.length} new hires are still in rentals more than 45 days in — worth checking their truck provisioning.`,
      caseKeys: nhAging.map((f) => f.caseKey),
    });
  }

  return cards;
}

function fmtUsd(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
