// Executive Summary — pure bucket classifier.
//
// Every open rental case lands in EXACTLY ONE of 8 "why is this still open"
// buckets, evaluated in strict precedence order (person facts first, then
// truck facts, then repair state). Person-status buckets only apply when the
// renter identity is RESOLVED — an unresolved renter's status string is noise.
//
// Pure functions only — no DB, no clock reads (today is a parameter).

export type ExecBucket =
  | "terminated"
  | "loa"
  | "new_hire"
  | "declined_decom"
  | "in_repair"
  | "repair_done_reg_dead"
  | "repair_done_no_blocker"
  | "no_repair_activity";

export const BUCKET_ORDER: ExecBucket[] = [
  "terminated",
  "loa",
  "new_hire",
  "declined_decom",
  "in_repair",
  "repair_done_reg_dead",
  "repair_done_no_blocker",
  "no_repair_activity",
];

export const BUCKET_LABELS: Record<ExecBucket, string> = {
  terminated: "Terminated renter",
  loa: "Renter on leave",
  new_hire: "New hire (≤60 days)",
  declined_decom: "Declined / decommissioning",
  in_repair: "Repair in progress",
  repair_done_reg_dead: "Repair done — registration dead",
  repair_done_no_blocker: "Repair done — no blocker",
  no_repair_activity: "No repair activity",
};

export function normalizeVendor(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
  if (!s) return "Unknown";
  if (/hertz/i.test(s)) return "Hertz";
  if (/avis/i.test(s)) return "Avis";
  if (/enterprise/i.test(s)) return "Enterprise";
  return s.replace(/\s+/g, " ");
}

// employee_status arrives as full words ('Terminated'/'On Leave'/'Active'/'Pending')
// but matchers ALSO tolerate raw single-letter codes (T / L / P / S) defensively.
export function isTerminatedStatus(s: string | null | undefined): boolean {
  const t = String(s ?? "").trim();
  return !!t && (/^t$/i.test(t) || /term/i.test(t));
}

export function isLoaStatus(s: string | null | undefined): boolean {
  const t = String(s ?? "").trim();
  return !!t && (/^[lps]$/i.test(t) || /leave|loa/i.test(t));
}

export interface TruckRegFacts {
  regInProgress: boolean;
  regRenewalInProcess: boolean;
  stickerValid: string | null; // free text: 'Expired', 'Yes', 'Contacted tech'…
  regExpiry: string | null; // 'M/D/YYYY'
  holmanRegExpiry: string | null; // 'M/D/YYYY'
}

export function parseUsDate(s: string | null | undefined): Date | null {
  const m = String(s ?? "")
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[3], +m[1] - 1, +m[2]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function isRegBlocked(t: TruckRegFacts | null | undefined, today: Date): boolean {
  if (!t) return false;
  if (t.regInProgress || t.regRenewalInProcess) return true;
  if (/expired/i.test(String(t.stickerValid ?? ""))) return true;
  const exp = parseUsDate(t.regExpiry) ?? parseUsDate(t.holmanRegExpiry);
  return !!exp && exp.getTime() < today.getTime();
}

export interface CaseFacts {
  caseKey: string;
  vehicleNumber: string;
  vendor: string; // already normalized
  dailyCost: number | null;
  daysOpen: number | null;
  daysBehind: number | null; // days_open - days_authorized when both present
  extensions: number | null;
  identityResolved: boolean; // identity_state === 'RESOLVED'
  employeeId: string | null;
  employeeStatus: string | null;
  techName: string | null;
  techDistrict: string | null;
  classBucket: string; // MasterRow.class_bucket
  isNewHire: boolean;
  truckTerminal: boolean;
  hasOpenRepairPo: boolean; // MasterRow.has_open_repair === true (reconciled)
  repairComplete: boolean; // /^y/i on repairs_complete
  regBlocked: boolean;
}

export function classifyBucket(f: CaseFacts): { bucket: ExecBucket; unknownRenter: boolean } {
  const unknownRenter = !f.identityResolved;
  if (f.identityResolved) {
    if (isTerminatedStatus(f.employeeStatus)) return { bucket: "terminated", unknownRenter };
    if (isLoaStatus(f.employeeStatus)) return { bucket: "loa", unknownRenter };
    if (f.isNewHire) return { bucket: "new_hire", unknownRenter };
  }
  if (f.truckTerminal) return { bucket: "declined_decom", unknownRenter };
  if (f.hasOpenRepairPo) return { bucket: "in_repair", unknownRenter };
  if (f.repairComplete) {
    return { bucket: f.regBlocked ? "repair_done_reg_dead" : "repair_done_no_blocker", unknownRenter };
  }
  return { bucket: "no_repair_activity", unknownRenter };
}
