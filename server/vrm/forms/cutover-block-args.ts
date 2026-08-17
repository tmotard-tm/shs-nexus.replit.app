/**
 * The route-block payload rules for an Enterprise contract cutover, as a pure
 * decision the production lane actually calls.
 *
 * This lives outside the survey router on purpose. The two rules below have
 * been re-broken several times, and a test that only exercises the payload
 * BUILDER cannot catch that — it stays green while the live lane passes
 * "Anytime" or a ZIP+4. Putting the decision here means the test and
 * `/forms/rental-survey/file-route-blocks` run the same code.
 */
import type { StandardActivityArgs } from "../dca-task-client";

/**
 * ZIP5 of the branch we reserved, taken off the stored branch address
 * ("EL PASO DYER & TETONS, 8555 DYER STREET,EL PASO,79904-2805" -> "79904").
 *
 * This is the value the route block's LocationValue must carry: it is the only
 * thing the scheduler can compute drive time from — notes are invisible to it.
 * The API reference types LocationValue as "Zip code", so ZIP+4 is trimmed.
 *
 * Anchored at the END of the address on purpose: a leading street number is
 * five digits too ("11130 FUQUA ST, HOUSTON, 77034" must yield 77034).
 *
 * Returns "" when the address carries no ZIP.
 */
export function branchZip5(address: unknown): string {
  const m = String(address ?? "").trim().match(/(\d{5})(?:-\d{4})?\s*$/);
  return m ? m[1] : "";
}

export type CutoverBlockInput = {
  ldap: string;
  unit: string;
  truckNumber: string;
  branchName?: unknown;
  branchAddress?: unknown;
  date: string;
  live: boolean;
};

export type CutoverBlockDecision =
  | { ok: true; args: StandardActivityArgs }
  | { ok: false; reason: string };

/**
 * Build the Standard Activity args for one technician's cutover block, or
 * refuse with a reason.
 *
 * Rule 1 — 8:00 AM, EXACT. "Anytime" does not mean "start then"; it tells the
 * optimizer the time is a preference it may move. Measured 2026-08-17 against
 * PRD_SERVICEPOWER.BATCH_TBLS.SCH_ACTIVITIES_PROD: of the 136 blocks this lane
 * filed with "Anytime" that landed correctly typed, only ELEVEN came back at
 * 08:00:00 — the rest scattered from 06:23 to 15:55. The technicians had
 * already been texted "8:00 AM", so the whole batch was repaired by hand.
 *
 * Rule 2 — LocationValue is the reserved branch's ZIP5, or we do not file.
 * A missing ZIP degrades the payload to LocationType "None", which puts a block
 * on the route with no destination and no drive time. There is no cancel API,
 * so refusing to file is always cheaper than filing and repairing.
 */
export function buildCutoverBlockArgs(input: CutoverBlockInput): CutoverBlockDecision {
  const unit = String(input.unit ?? "").trim();
  if (!unit) {
    return { ok: false, reason: "no district on the roster; Unit is required" };
  }

  const zip = branchZip5(input.branchAddress);
  if (!zip) {
    const shown = String(input.branchAddress ?? "").trim() || "empty";
    return {
      ok: false,
      reason: `no ZIP on the booked branch address (${shown}); `
        + `LocationValue would be empty, so the block was not filed`,
    };
  }

  return {
    ok: true,
    args: {
      techLdap: input.ldap,
      unit,
      truckNumber: input.truckNumber,
      date: input.date,
      durationMinutes: 30,
      locationZip: zip,
      startTime: "08:00",
      startTimeRequest: "Exact",
      live: input.live,
      projectLabel: "Enterprise Contract Change",
      // Tyler 2026-08-13: short and labeled. The long instructions go in the
      // technician's TEXT, not the block. No truck number here — the project
      // name already carries it.
      //
      // This note still tells the DCA a human may move the slot if Enterprise
      // has a conflict. That is a human affordance and costs nothing; what must
      // not happen is the optimizer silently relocating a time we already
      // texted to the technician. Hence "Exact" above.
      projectNotes:
        "30 minutes requested first thing in the morning. If there is a "
        + "conflict, the time can be moved during normal business hours "
        + "for Enterprise.",
      rowNotes:
        `Location: Enterprise ${String(input.branchName ?? "").trim()}, `
        + `${String(input.branchAddress ?? "").trim()}. `
        + `Enterprise billing swap from Holman contract to direct billing contract.`,
    },
  };
}
