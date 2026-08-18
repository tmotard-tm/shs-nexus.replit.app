/**
 * Truck Maintenance workflow — the eligibility gate.
 *
 * Split in two on purpose:
 *
 *   classifyEligibility(facts)  — PURE. Given the facts, decides eligible /
 *     not and returns a stable reason code. Unit-tested exhaustively, because
 *     this is the function that decides whether a real technician gets a real
 *     text and a real 4-hour hole in their route.
 *
 *   gatherEligibilityFacts(...) — the IO half: AMS, TPMS, the rental
 *     authority, and the comms contact directory.
 *
 * FAIL CLOSED. Every "unknown" is a block, never an implied FALSE:
 *   - AMS record unreadable, or readable with no usable status label
 *                                        -> ams_unreadable
 *   - rental authority unavailable       -> rental_state_unknown
 * A truck that is quietly in the shop must not be texted "bring it in", and a
 * technician already in a rental must not be told to service the van that is
 * being repaired for them.
 *
 * The same evaluation runs at cycle-open AND immediately before the send AND
 * immediately before the booking — a cycle can sit for days between those
 * points, which is exactly long enough for a truck to go into repair.
 */
import { sql } from "drizzle-orm";

import { db } from "../db";
import { AmsApiService } from "../ams-api-service";
import { resolveTruckStatusLabel } from "../ams-truck-status-labels";
import { getContactByLdap, isOptedOut } from "../fleet-comms/storage";
import { computeOpenRentalEidSet } from "../external-fleet-api/rental-ops-read-model";
import { getTPMSService } from "../tpms-service";
import { toCanonical } from "../vehicle-number-utils";

/** AMS statuses that block maintenance outright (matched case-insensitively). */
export const BLOCKING_AMS_STATUS_LABELS = [
  "In Repair",
  "Declined Repair",
  "Sent To Auction",
] as const;

export type ExclusionCode =
  | "byov"
  | "no_tech_assigned"
  | "ams_status_blocked"
  | "ams_in_repair"
  | "ams_unreadable"
  | "tech_in_rental"
  | "rental_state_unknown"
  | "no_contact"
  | "no_phone"
  | "opted_out"
  | "no_racf";

export const EXCLUSION_LABELS: Record<ExclusionCode, string> = {
  byov: "BYOV truck",
  no_tech_assigned: "No technician assigned in TPMS",
  ams_status_blocked: "AMS truck status blocks maintenance",
  ams_in_repair: "AMS says the vehicle is in repair",
  ams_unreadable: "AMS status could not be read (blocked until it can)",
  tech_in_rental: "Technician is currently in a rental",
  rental_state_unknown: "Rental authority unavailable (blocked until it can be read)",
  no_contact: "No communications contact for the technician",
  no_phone: "No reachable phone on file",
  opted_out: "Technician opted out of SMS",
  no_racf: "No active RACF id for the technician (cannot file a route block)",
};

export interface EligibilityFacts {
  truckNumber: string;
  vin: string | null;
  /** TPMS assignment. null = truck is not assigned to anyone. */
  techLdap: string | null;
  techName: string | null;
  district: string | null;
  /** Prefix check on the RAW truck number — never on a zero-padded one. */
  isByov: boolean;
  /**
   * Resolved AMS truck-status label, or null when AMS has no status for the
   * VIN. `undefined` means the read FAILED — that is unknown, not absent.
   */
  amsStatusLabel: string | null | undefined;
  /** AMS per-vehicle in-repair flag. null/undefined = unknown = blocked. */
  amsInRepair: boolean | null | undefined;
  /** null/undefined = the rental authority could not be read = blocked. */
  techInRental: boolean | null | undefined;
  /** Last 10 digits from the comms contact directory. */
  phoneDigits: string | null;
  contactExists: boolean;
  optedOut: boolean;
  /**
   * The RACF id the booking is filed under. `undefined` means the lookup was
   * not performed or failed; both are unknown, and unknown blocks — texting a
   * technician we then cannot book for is a promise we can't keep.
   */
  techRacf?: string | null | undefined;
  /** HR employment status. Anything other than an explicit "A" blocks. */
  employmentStatus?: string | null | undefined;
  /** Populated when the RACF lookup itself errored, for the visible reason. */
  racfError?: string | null;
}

export interface EligibilityVerdict {
  eligible: boolean;
  code: ExclusionCode | null;
  detail: string | null;
}

const ELIGIBLE: EligibilityVerdict = { eligible: true, code: null, detail: null };

function blocked(code: ExclusionCode, detail?: string | null): EligibilityVerdict {
  return { eligible: false, code, detail: detail ?? null };
}

/** True when a resolved AMS label is one of the blocking statuses. */
export function isBlockingAmsStatus(label: string | null | undefined): boolean {
  if (!label) return false;
  const needle = label.trim().toLowerCase();
  return BLOCKING_AMS_STATUS_LABELS.some((s) => s.toLowerCase() === needle);
}

/**
 * The decision. Order is chosen so the reason a human reads is the most
 * actionable one: what the truck IS, then what it is doing, then who it
 * belongs to, then whether we can reach them.
 */
export function classifyEligibility(facts: EligibilityFacts): EligibilityVerdict {
  if (facts.isByov) return blocked("byov", `Truck ${facts.truckNumber} is BYOV`);

  // AMS status/in-repair are read together from one vehicle record, so an
  // unreadable answer blocks both checks at once.
  if (facts.amsStatusLabel === undefined || facts.amsInRepair === undefined || facts.amsInRepair === null) {
    return blocked("ams_unreadable", "AMS vehicle record could not be read — treated as blocked");
  }
  // A record can come back readable but unclassifiable: no status field at all,
  // or a status code AMS has no name for (the resolver hands those back as
  // "Unknown"). Either way we cannot prove the truck is NOT in repair, declined
  // or headed to auction, and "not one of the three" is the whole basis for
  // texting a technician. So it blocks rather than passing on an empty label.
  const amsLabel = (facts.amsStatusLabel ?? "").trim();
  if (!amsLabel || amsLabel.toLowerCase() === "unknown") {
    return blocked(
      "ams_unreadable",
      amsLabel
        ? "AMS returned a truck status code with no known label — treated as blocked"
        : "AMS vehicle record carries no truck status — treated as blocked",
    );
  }
  if (facts.amsInRepair === true) {
    return blocked("ams_in_repair", "AMS VehicleInRepair is true");
  }
  if (isBlockingAmsStatus(facts.amsStatusLabel)) {
    return blocked("ams_status_blocked", `AMS status: ${facts.amsStatusLabel}`);
  }

  if (!facts.techLdap) {
    return blocked("no_tech_assigned", `Truck ${facts.truckNumber} has no TPMS assignment`);
  }

  if (facts.techInRental === undefined || facts.techInRental === null) {
    return blocked("rental_state_unknown", "Open-rental authority unavailable — treated as blocked");
  }
  if (facts.techInRental === true) {
    return blocked("tech_in_rental", `${facts.techLdap} is currently in a rental`);
  }

  // Filing identity, checked BEFORE the text: the whole point of the text is
  // that a block is coming, so a technician we cannot file for must not get one.
  if (facts.techRacf === undefined) {
    return blocked(
      "no_racf",
      facts.racfError
        ? `RACF lookup failed for ${facts.techLdap}: ${facts.racfError}`
        : `RACF/employment status for ${facts.techLdap} was not resolved — treated as blocked`,
    );
  }
  if (!facts.techRacf) {
    return blocked("no_racf", `No RACF id on file for ${facts.techLdap}`);
  }
  if ((facts.employmentStatus || "").trim().toUpperCase() !== "A") {
    return blocked(
      "no_racf",
      `${facts.techLdap} employment status is ${facts.employmentStatus || "unknown"} (not active)`,
    );
  }

  if (!facts.contactExists) {
    return blocked("no_contact", `No fs_comms_contacts row for ${facts.techLdap}`);
  }
  if (!facts.phoneDigits || facts.phoneDigits.length < 10) {
    return blocked("no_phone", `No reachable phone for ${facts.techLdap}`);
  }
  if (facts.optedOut) {
    return blocked("opted_out", `${facts.techLdap} opted out of SMS`);
  }

  return ELIGIBLE;
}

/* ------------------------------------------------------------------------ *
 * The IO half.
 * ------------------------------------------------------------------------ */

/**
 * Shared per-sweep context. The rental set is one Snowflake round trip for the
 * whole sweep; AMS is read per candidate (the candidate set is small — only
 * trucks that just crossed the trigger — and the per-vehicle record is the
 * only place VehicleInRepair is exposed).
 */
export interface EligibilityContext {
  /** Upper-cased Enterprise IDs currently in an open rental; null = unreadable. */
  rentalEids: Set<string> | null;
  rentalError: string | null;
  ams: AmsApiService;
}

/**
 * Build the per-sweep context.
 *
 * Rental membership comes from computeOpenRentalEidSet — the SAME shared
 * computation behind the Rental badge staff see on the fleet surfaces, keyed
 * by Enterprise ID (LDAP), not from any manually maintained FS field. Managed
 * scope is the badge's own scope, so the workflow can never disagree with the
 * badge a human is looking at.
 */
export async function buildEligibilityContext(): Promise<EligibilityContext> {
  let rentalEids: Set<string> | null = null;
  let rentalError: string | null = null;
  try {
    const eids = await computeOpenRentalEidSet(true);
    rentalEids = new Set(eids.map((e) => e.trim().toUpperCase()).filter(Boolean));
  } catch (err: any) {
    rentalError = err?.message || String(err);
    console.warn(`[TruckMaint] open-rental authority unavailable — every candidate blocks: ${rentalError}`);
  }
  return { rentalEids, rentalError, ams: new AmsApiService() };
}

export interface AmsVehicleFacts {
  statusLabel: string | null | undefined;
  inRepair: boolean | null | undefined;
  error: string | null;
}

/** AMS booleans arrive as true/false, "Y"/"N", 1/0 depending on the field. */
function truthy(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    return s === "y" || s === "yes" || s === "true" || s === "1" || s === "t";
  }
  return false;
}

function falsy(value: unknown): boolean {
  if (value === false || value === 0) return true;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    return s === "n" || s === "no" || s === "false" || s === "0" || s === "f";
  }
  return false;
}

/**
 * Read the AMS vehicle record for one VIN.
 *
 * CONFIRMED read source (probed against production AMS, 2026-08-17):
 * GET /api/v1/vehicles/{vin} returns `VehicleInRepair` (boolean) alongside
 * `TruckStatus` / `TruckStatusName`. Our AMS client previously only ever WROTE
 * inRepair (repair-updates); this is the read side of the same field.
 *
 * Both facts come from ONE record so they cannot disagree about which vehicle
 * they describe — but they can legitimately disagree with each other (a truck
 * flagged in repair whose status label was never changed), which is precisely
 * why the flag is an independent hard block.
 *
 * Any failure returns undefined/undefined: unknown, which the classifier
 * treats as blocked.
 */
export async function readAmsVehicleFacts(
  ams: AmsApiService,
  vin: string | null,
): Promise<AmsVehicleFacts> {
  if (!vin || !vin.trim()) {
    return { statusLabel: undefined, inRepair: undefined, error: "no VIN on the vehicle record" };
  }
  try {
    const v: any = await ams.getVehicleByVin(vin.trim());
    if (!v || typeof v !== "object") {
      return { statusLabel: undefined, inRepair: undefined, error: "AMS returned no vehicle record" };
    }
    const rawInRepair = v.VehicleInRepair ?? v.InRepair ?? v.inRepair ?? v.IsInRepair;
    let inRepair: boolean | null | undefined;
    if (truthy(rawInRepair)) inRepair = true;
    else if (falsy(rawInRepair)) inRepair = false;
    else inRepair = undefined; // field absent/unparseable => unknown => blocked

    const statusLabel = resolveTruckStatusLabel(v.TruckStatus ?? v.TruckStatusName ?? null);
    return { statusLabel, inRepair, error: null };
  } catch (err: any) {
    return {
      statusLabel: undefined,
      inRepair: undefined,
      error: `AMS read failed: ${err?.message || String(err)}`,
    };
  }
}

export interface TruckCandidate {
  /** Canonical (leading zeros stripped) truck number. */
  truckNumber: string;
  /** As stored on the vehicle cache row — the number a human recognises. */
  displayNumber: string;
  vin: string | null;
  odometer: number;
  odometerDate: string | null;
  odometerSource: string | null;
}

export interface TechAssignment {
  ldap: string;
  name: string | null;
  district: string | null;
}

/**
 * TPMS truck -> tech assignment for a batch of trucks.
 *
 * Uses the same tpms_tech_profiles-backed lookup the Fleet Management tab's
 * vehicle rows are enriched with, so the workflow and the fleet list always
 * name the same technician for a truck.
 */
export async function loadTechAssignments(
  truckNumbers: string[],
): Promise<Map<string, TechAssignment>> {
  const out = new Map<string, TechAssignment>();
  if (truckNumbers.length === 0) return out;
  const looked = await getTPMSService().batchLookupByTruckNumbers(truckNumbers);
  for (const [truckNo, hit] of Array.from(looked.entries())) {
    const info = hit?.techInfo;
    if (!info?.ldapId) continue;
    const name = [info.firstName, info.lastName].filter(Boolean).join(" ").trim() || null;
    out.set(toCanonical(truckNo), {
      ldap: info.ldapId.trim().toUpperCase(),
      name,
      district: (info.districtNo || "").trim() || null,
    });
  }
  return out;
}

/**
 * RACF id for the route filing. Same identity chain the rental lane uses:
 * enterprise id -> all_techs.tech_racfid, and only for an ACTIVE tech. Never
 * the payroll employee id.
 */
export async function resolveTechRacf(
  ldap: string,
): Promise<{ racf: string | null; employmentStatus: string | null; error: string | null }> {
  try {
    const r = await db.execute<{ tech_racfid: string | null; employment_status: string | null }>(sql`
      SELECT tech_racfid, employment_status
        FROM all_techs
       WHERE UPPER(TRIM(tech_racfid)) = UPPER(TRIM(${ldap}))
       LIMIT 1
    `);
    const row = ((r as any).rows ?? [])[0];
    const racf = (row?.tech_racfid || "").trim();
    return {
      racf: racf ? racf.toUpperCase() : null,
      employmentStatus: (row?.employment_status || "").trim() || null,
      error: null,
    };
  } catch (err: any) {
    // A failed lookup is UNKNOWN, not "no RACF": the caller must be able to
    // tell them apart, because unknown has to block the same way but reads
    // differently to the human deciding what to fix.
    const error = err?.message || String(err);
    console.warn(`[TruckMaint] RACF lookup failed for ${ldap}: ${error}`);
    return { racf: null, employmentStatus: null, error };
  }
}

export interface EvaluatedCandidate {
  facts: EligibilityFacts;
  verdict: EligibilityVerdict;
  assignment: TechAssignment | null;
}

/**
 * Gather every fact for one candidate and classify it.
 *
 * `assignment` is passed in because the sweep resolves TPMS for the whole
 * batch in one query; everything else is per-candidate.
 */
export async function evaluateCandidate(
  candidate: TruckCandidate,
  assignment: TechAssignment | null,
  ctx: EligibilityContext,
): Promise<EvaluatedCandidate> {
  // BYOV is decided on the RAW/trimmed number: zero-padding first turns
  // 88144 into 088144 and hides a BYOV truck.
  const isByov = /^88/.test((candidate.displayNumber || candidate.truckNumber).trim());

  const amsFacts = await readAmsVehicleFacts(ctx.ams, candidate.vin);

  let techInRental: boolean | null | undefined;
  if (!ctx.rentalEids) techInRental = undefined;
  else if (!assignment) techInRental = false; // no tech => the rental check is moot
  else techInRental = ctx.rentalEids.has(assignment.ldap.toUpperCase());

  // Filing identity is resolved here, not at booking time: the text promises a
  // block, so a technician we cannot file for is excluded BEFORE the send. One
  // indexed row from all_techs, and only for an assigned truck.
  let techRacf: string | null | undefined;
  let employmentStatus: string | null | undefined;
  let racfError: string | null = null;
  if (assignment) {
    const resolved = await resolveTechRacf(assignment.ldap);
    if (resolved.error) {
      techRacf = undefined;
      employmentStatus = undefined;
      racfError = resolved.error;
    } else {
      techRacf = resolved.racf;
      employmentStatus = resolved.employmentStatus;
    }
  }

  let contactExists = false;
  let phoneDigits: string | null = null;
  let optedOut = false;
  if (assignment) {
    try {
      const contact = await getContactByLdap(assignment.ldap);
      if (contact) {
        contactExists = true;
        phoneDigits = (contact.phoneDigits || "").trim() || null;
        if (phoneDigits) optedOut = await isOptedOut(phoneDigits);
      }
    } catch (err: any) {
      console.warn(`[TruckMaint] contact lookup failed for ${assignment.ldap}: ${err?.message || err}`);
    }
  }

  const facts: EligibilityFacts = {
    truckNumber: candidate.displayNumber || candidate.truckNumber,
    vin: candidate.vin,
    techLdap: assignment?.ldap ?? null,
    techName: assignment?.name ?? null,
    district: assignment?.district ?? null,
    isByov,
    amsStatusLabel: amsFacts.statusLabel,
    amsInRepair: amsFacts.inRepair,
    techInRental,
    phoneDigits,
    contactExists,
    optedOut,
    techRacf,
    employmentStatus,
    racfError,
  };

  const verdict = classifyEligibility(facts);
  // Surface the underlying AMS/rental error text rather than a generic reason.
  if (!verdict.eligible && verdict.code === "ams_unreadable" && amsFacts.error) {
    verdict.detail = amsFacts.error;
  }
  if (!verdict.eligible && verdict.code === "rental_state_unknown" && ctx.rentalError) {
    verdict.detail = ctx.rentalError;
  }
  return { facts, verdict, assignment };
}
