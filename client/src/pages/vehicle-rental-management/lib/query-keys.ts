// Shared react-query keys for the three case boards. Every mutation that
// changes case state — marks, ready verification, research, owner, dismissals,
// texts, scheduling, fleet status, shop/identity edits — must refetch ALL
// THREE, or the boards drift apart until a manual reload (Tyler 2026-08-11:
// "every action in the Ops queue, Rental Operations, and Cases by Region must
// sync up together"). The server busts its own 30s queue cache per route, so a
// client refetch here always reads fresh rows.
export const LIST_QUERY_KEYS: string[][] = [
  ["/api/vrm/rental-operations/master"],
  ["/api/vrm/rental-operations/by-region"],
  ["/api/vrm/rental-operations/queue"],
];

/** The shared case pop-up's own detail query for one case. */
export function caseDetailKey(caseKey: string): string[] {
  return [`/api/vrm/rental-operations/master/${caseKey}`];
}
