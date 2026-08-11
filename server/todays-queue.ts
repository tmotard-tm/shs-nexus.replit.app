/**
 * Today's Queue builder — the prioritized daily action list for rental/repair
 * trucks (steps 1–7 + "no action"), now person-first: every item is stamped
 * with its bucket owner (Annex A routing), classifications (P1–P4) and
 * business-day SLA clocks (docs/specs/2026-08-05-persona-bucket-queue-design.md).
 *
 * Extracted verbatim from the FleetScope GET /queue/today route so the SAME
 * builder serves two surfaces:
 *   - FleetScope  GET /api/fs/queue/today            (read-only mirror view)
 *   - VRM         GET /api/vrm/rental-operations/queue (authoritative view,
 *     enriched with case keys + the fleet-status vocabulary for editing)
 *
 * VRM is the authority for rental state; FleetScope displays it. Keep ALL
 * queue semantics here — neither route may fork the step logic.
 *
 * Data sources (read-mostly):
 *   - fs_trucks via fleetScopeStorage.getAllTrucks()
 *   - Reconciled PO layer (po_eff) via loadQueuePoContext() — replaced the
 *     dead Holman scraper feed AND the raw Snowflake MIN(PO_DATE) anchor
 *   - fs_call_logs latest repair call per truck (LUCA write-back ledger)
 *   - fs_pmf_status_events latest fleet_scope status event per truck
 *   - vrm_rental_operation_actions: manual owner assignments, dismiss-for-today,
 *     classification-observed SLA anchors, workbook states
 *
 * The ONLY write is the classification_observed anchor seeding — batched,
 * fire-and-forget, idempotent (readers take MIN(created_at) per key).
 */
import { sql } from "drizzle-orm";
import { fleetScopeStorage } from "./fleet-scope-storage";
import { fsDb } from "./fleet-scope-db";
import { db } from "./db";
import { loadQueuePoContext, loadLatestLucaDispatches, amsBucketOf, displayShopFor, cleanPhone, type QueuePoContext, type LucaDispatchInfo } from "./vrm/rental-operations/read-repository";
import { evaluateStep9Disposition, phoneDigits, nameFold, STEP9_PROBLEM_LABELS } from "./vrm/rental-operations/shop-record-flags";
import { loadWorkbookStates, WORKBOOK_CLOSED_STATUSES, type WorkbookState } from "./vrm/rental-operations/workbook";
import { resolveOwnerRouting, OWNER_ROSTER, type Region } from "./vrm/rental-operations/annex-a-routing";
import {
  CLASSIFICATIONS,
  CLASSIFICATION_BY_KEY,
  classify,
  ownerForClassification,
  shopStateFromAddress,
  todayET as etToday,
  addBusinessDays,
  businessDaysLate,
  type ClassificationDef,
  type ClassifyInput,
} from "./vrm/rental-operations/bucket-classify";
import { getSparePoolLite, type SparePoolLite } from "./spares-pool";
import { fetchRegistrationContextMap, canonReg, type RegistrationContext } from "./vrm/rental-operations/registration-context";

type Truck = Awaited<ReturnType<typeof fleetScopeStorage.getAllTrucks>>[number];

/** One classification attached to a queue item, with its SLA clock. */
export type ItemClassification = {
  key: string;
  label: string;
  priority: 1 | 2 | 3 | 4;
  owner: string;
  needsRouting: boolean;
  /** YYYY-MM-DD onset the SLA counts from (null = no clock). */
  anchorDate: string | null;
  slaDueDate: string | null;
  businessDaysLate: number;
};

export type OwnerBucket = {
  owner: string;
  open: number;
  dueToday: number;
  overdue: number;
  needsRouting: number;
};

/**
 * Triage lane — the queue's baseline vocabulary (user directive 2026-08-05):
 *  - 'ready'   → phone-confirmed pickup work (ready / scheduling / confirm returned);
 *  - 'action'  → a problem a human must fix NOW (LUCA escalations: wrong phone,
 *                shop doesn't have the truck, needs tow, research, authorization);
 *  - 'monitor' → watch-only: PO/date inference or LUCA still retrying — nothing
 *                required today. A closed PO alone is NOT evidence of readiness.
 */
export type QueueLane = 'ready' | 'action' | 'monitor';

export type QueueItem = {
  step: number;
  stepTitle: string;
  lane: QueueLane;
  /** Plain-English evidence: WHY this truck is on the queue right now. */
  whyText: string;
  truckId: string;
  truckNumber: string;
  techName: string | null;
  fleetScopeStatus: string;
  /** Effective (portal-corrected) status of the shop-of-record PO. Field name
   *  kept for UI compat — the value source moved from the dead scraper to
   *  po_eff. */
  holmanStatus: string | null;
  lucaStatus: string | null;
  lastCallDate: string | null;
  actionText: string;
  sortKey: number;
  isConflict?: boolean;
  repairPhone: string | null;
  techState: string | null;
  readyReason?: 'luca' | 'manual' | 'holman' | 'date';
  /** Manual "verified ready with the shop" mark in effect for this case. */
  readyVerified?: { by: string; at: string } | null;
  /** "Escalated to research" mark in effect for this case. */
  research?: { by: string; at: string } | null;
  /** YYYY-MM-DD tech-pickup date (VRM-owned mirror) — set on step-2 items. */
  scheduledPickupDate?: string | null;
  /** ElevenLabs conversation id for the call this row's status rests on.
   *  The call RECORD lives on LIVHR, not in Nexus: all 21 Scheduling trucks
   *  carry an id and none of them resolve in vrm_luca_activity_log or
   *  vrm_rental_operations_call_log. Carrying the id is what lets the card
   *  link out instead of asserting a call the operator cannot read. */
  lastCallConversationId?: string | null;
  // ── persona-bucket decoration (additive; stamped in one post-pass) ────────
  /** Owner/dismiss key: caseKey when the truck has a rental case, else the
   *  canonical (unpadded) truck number. Fits case_key VARCHAR(10). */
  key?: string;
  caseKey?: string | null;
  owner?: string;
  ownerBasis?: string;
  region?: Region | null;
  needsRouting?: boolean;
  classifications?: ItemClassification[];
  /** The ONE work-type bucket this item lives in (server-stamped claim rules —
   *  see workBucketForItem). Both UIs group by this field; never recompute
   *  membership client-side. */
  workBucket?: string;
  dismissedToday?: { by: string } | null;
  /** Registration/tags context — present when tag work is live for this truck,
   *  so cards lay out the real blocker + whose move it is (display-only). */
  registration?: RegistrationContext;
  contextChips?: {
    effStatus: string | null;
    openPoDate: string | null;
    shopName: string | null;
    shopPhone: string | null;
    portalAt: string | null;
    lastLucaOutcome: string | null;
    lastLucaDate: string | null;
    daysInRental: number | null;
    /** Manual shop-phone lock in effect (edit panel shows lock state). */
    shopPhoneLocked?: boolean;
    /** shopName is a manual operator override, not the PO pick. */
    shopNameOverridden?: boolean;
  };
  /** Tech contact — comms directory number first (what a queue text dials),
   *  fs_trucks TPMS mirror as fallback. */
  techPhone?: string | null;
  /** RACF id (the comms key) — present when a "text the tech" path exists. */
  techLdap?: string | null;
  /** Tech's CURRENT TPMS-assigned truck when it DIFFERS from this case truck. */
  assignedTruck?: string | null;
  /** Declined/auction case truck + tech already on a different truck — the
   *  "replacement" work is done; what's left is closing out the rental. */
  replacementAssigned?: boolean;
  /** …and that assigned truck itself has an open repair PO (LUCA tracks it). */
  assignedTruckInRepair?: boolean;
  /** Newest LUCA dispatch for this truck — the shop LUCA actually dialed. */
  lucaDialed?: LucaDispatchInfo | null;
  /** True when what LUCA dialed no longer matches the current reconciled shop
   *  pick (name or phone) — "verify shop info before trusting the call". */
  shopInfoMismatch?: boolean;
  /** AMS status of THIS case's van (vrm case enrichment; null when no case or
   *  no AMS value). Called out on every Step Board card. */
  amsStatus?: string | null;
  /** Server-computed bucket of amsStatus (auction/declined/in_repair/…);
   *  null when unknown. */
  amsBucket?: string | null;
  /** Step-2 rows: readiness behind "Scheduling" is phone-confirmed (LUCA Ready
   *  or manual verify). False = the row is a validation task, not a pickup. */
  schedulingValidated?: boolean;
  /** Unassigned-spare availability, attached to needs_replacement rows only.
   *  undefined = lookup unavailable at build time (rendered as "lookup
   *  unavailable", never as a false "0 spares" claim). */
  spareAvailability?: SpareAvailability;
};

/** Lite spare-pool availability for one needs-replacement row. */
export type SpareAvailability = {
  /** Tech's district (VRM identity layer); null when unknown. */
  district: string | null;
  /** Spares in that district; null when the district is unknown. */
  districtCount: number | null;
  totalCount: number;
  /** Up to 3 candidate truck numbers, district matches first. */
  candidates: string[];
};

/**
 * Step-2 partition for trucks in 'Scheduling': has the pickup date arrived
 * (due), is it still ahead (future), or was none set (unscheduled)? Exported
 * pure so it is unit-testable; `todayISO` is today's date in ET (ops staff
 * run on ET — the server clock is UTC).
 */
export type SchedulingBucket = 'due' | 'future' | 'unscheduled';
export function classifySchedulingDate(scheduled: string | null | undefined, todayISO: string): SchedulingBucket {
  const s = (scheduled ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return 'unscheduled';
  return s <= todayISO ? 'due' : 'future';
}

export type NoActionItem = {
  truckId: string;
  truckNumber: string;
  techName: string | null;
  fleetScopeStatus: string;
  holmanStatus: string | null;
  caseKey: string | null;
  /** Why this case carries no queue action today (declined/auction dead-ends). */
  reason?: string | null;
};

/** One work-type bucket (grouped by PRIMARY classification) for the strip. */
export type WorkTypeBucket = {
  key: string;
  label: string;
  priority: number;
  open: number;
  dismissed: number;
  /** First-class buckets the team asked for — rendered prominently. */
  featured: boolean;
  /** Confidence/purpose blurb shown on the featured buckets' banner. */
  description: string | null;
};

// The two first-class buckets (task 2026-08-10). Labels override the def
// label with the team's phrasing; descriptions state the confidence contract.
const FEATURED_WORK_BUCKETS: Record<string, { label: string; description: string }> = {
  vehicle_ready_schedule: {
    label: "Ready for pickup — shop-confirmed",
    description:
      "Readiness was confirmed by an actual shop call — a LUCA Ready call or a staff member's manual verify. " +
      "Closed-PO / date inference never qualifies. There is no reason to believe these trucks are not ready.",
  },
  needs_replacement: {
    label: "Decommissioned — needs replacement (locate a spare)",
    description:
      "The tech is sitting in a rental because their truck is decommissioned / declined / sold and no replacement " +
      "is assigned. The job here is locating a spare when one is available — assignment itself stays in the Spares flow.",
  },
};
/** Featured display order = insertion order above: Ready pile first. */
const FEATURED_ORDER = Object.keys(FEATURED_WORK_BUCKETS);

/** Classifications that mean the truck itself is leaving the fleet — a row
 *  carrying any of these is never "available for pickup", no matter what a
 *  shop call once said about the repair. */
const TERMINAL_FAMILY = new Set([
  "needs_replacement",
  "retrieval_pending",
  "replacement_assigned",
  "ams_status_conflict",
]);

/** The ONE work-type bucket an item lives in. Claim rules, in order:
 *  1. Terminal truck with no replacement (primary needs_replacement) →
 *     the locate-a-spare pile. Retrieval-primary decommission rows stay in
 *     retrieval_pending — Jennifer's pile is separate by design.
 *  2. Phone-confirmed ready-pipeline rows → the Ready pile. Membership is the
 *     board's READY lane (server-stamped lane 'ready') gated on luca/manual
 *     evidence — i.e. exactly the set operators see as "available for pickup"
 *     in production, INCLUDING rows whose top label is a scheduling/paperwork
 *     sub-state. Closed-PO/date inference (readyReason 'holman'/'date', lane
 *     monitor) never qualifies.
 *  3. Everything else → its primary classification.
 */
export function workBucketForItem(
  it: Pick<QueueItem, "lane" | "readyReason" | "classifications">,
): string {
  const keys = (it.classifications ?? []).map((c) => c.key);
  if (keys[0] === "needs_replacement") return "needs_replacement";
  const phoneConfirmed = it.readyReason === "luca" || it.readyReason === "manual";
  if (it.lane === "ready" && phoneConfirmed && !keys.some((k) => TERMINAL_FAMILY.has(k))) {
    return "vehicle_ready_schedule";
  }
  return keys[0] ?? "other";
}

export type TodaysQueue = {
  success: true;
  items: QueueItem[];
  noAction: NoActionItem[];
  buckets: OwnerBucket[];
  workTypeBuckets: WorkTypeBucket[];
  classificationDefs: readonly ClassificationDef[];
  generatedAt: string;
};

export async function buildTodaysQueue(): Promise<TodaysQueue> {
  // Canonical truck number: digits only, leading zeros stripped. ONE canon for
  // every map in this builder (po context, case keys, decommissioning) so a
  // padded/unpadded mismatch cannot silently drop a join.
  const canon = (s: unknown): string => String(s ?? '').trim().replace(/\D/g, '').replace(/^0+/, '') || '0';

  // Spare-availability decoration (needs_replacement bucket): kicked off up
  // front so its two PG reads overlap the heavy base reads, then raced against
  // a short timeout at attach time — a cold pool can never stall the build.
  const sparePoolPromise: Promise<SparePoolLite | null> = getSparePoolLite().catch(() => null);

  const tStart = Date.now();
  const baseMs: Record<string, number> = {};
  const timed = <T>(label: string, p: Promise<T>): Promise<T> =>
    p.finally(() => { baseMs[label] = Date.now() - tStart; });
  const [allTrucks, poMap, workbookStates, lucaDialedMap] = await Promise.all([
    timed('trucks', fleetScopeStorage.getAllTrucks()),
    timed('po', loadQueuePoContext().catch((e: any): Map<string, QueuePoContext> => {
      console.warn('[Queue] Could not load PO context:', e?.message || e);
      return new Map();
    })),
    timed('wb', loadWorkbookStates().catch((e: any): Map<string, WorkbookState> => {
      console.warn('[Queue] Could not load workbook states:', e?.message || e);
      return new Map();
    })),
    // loadLatestLucaDispatches never throws (returns empty map on failure)
    timed('luca', loadLatestLucaDispatches()),
  ]);
  const tBase = Date.now();

  // FleetScope-side reads (fsDb) — latest repair call, status events, ERD slip
  // counts, decommissioning lane.
  const [callLogResult, statusEventsResult, erdSlipResult, decomResult] = await Promise.all([
    fsDb.execute(sql`
      SELECT DISTINCT ON (truck_id)
        truck_id,
        call_timestamp,
        status,
        estimated_ready_date
      FROM fs_call_logs
      WHERE call_type IN ('shop', 'repair')
      ORDER BY truck_id, call_timestamp DESC
    `),
    // Most recent fleet-scope status event per truck (same CTE + ROW_NUMBER
    // pattern as /pmf/days-in-status; only events matching the CURRENT
    // mainStatus are used so stale periods are rejected).
    fsDb.execute(sql`
      WITH latest_status_events AS (
        SELECT
          asset_id,
          status,
          effective_at,
          ROW_NUMBER() OVER (PARTITION BY asset_id ORDER BY effective_at DESC) AS rn
        FROM fs_pmf_status_events
        WHERE source = 'fleet_scope'
      )
      SELECT asset_id, status, effective_at
      FROM latest_status_events
      WHERE rn = 1
    `),
    // ERD slip count per truck: each LUCA call row carries the shop's current
    // estimate; N distinct estimates = N-1 slips ("stalled repair" signal).
    fsDb.execute(sql`
      SELECT truck_id, COUNT(DISTINCT estimated_ready_date) AS erd_count
      FROM fs_call_logs
      WHERE call_type IN ('shop', 'repair') AND estimated_ready_date IS NOT NULL
      GROUP BY truck_id
    `),
    // Trucks in the decommissioning pipeline awaiting retrieval (P1).
    fsDb.execute(sql`
      SELECT truck_number FROM fs_decommissioning_vehicles WHERE lane = 'decommissioned'
    `),
  ]);
  const tFs = Date.now();

  type CallLogRow = { truck_id: string; call_timestamp: string | null; status: string | null; estimated_ready_date: string | null };
  const callLogMap: Record<string, { callTimestamp: Date | null; callStatus: string | null; estimatedReadyDate: string | null }> = {};
  for (const row of callLogResult.rows as CallLogRow[]) {
    callLogMap[row.truck_id] = {
      callTimestamp: row.call_timestamp ? new Date(row.call_timestamp) : null,
      callStatus: row.status ?? null,
      estimatedReadyDate: row.estimated_ready_date ?? null,
    };
  }

  type StatusEventRow = { asset_id: string; status: string; effective_at: string };
  const statusEventMap: Record<string, { mainStatus: string; effectiveAt: Date }> = {};
  for (const row of statusEventsResult.rows as StatusEventRow[]) {
    statusEventMap[row.asset_id] = {
      mainStatus: row.status,
      effectiveAt: new Date(row.effective_at),
    };
  }

  const etaSlipMap: Record<string, number> = {};
  for (const row of erdSlipResult.rows as Array<{ truck_id: string; erd_count: string | number }>) {
    etaSlipMap[row.truck_id] = Math.max(0, Number(row.erd_count ?? 0) - 1);
  }

  const decomSet = new Set<string>();
  for (const row of decomResult.rows as Array<{ truck_number: string }>) {
    decomSet.add(canon(row.truck_number));
  }

  // VRM-side reads (db) — rental case keys + tech district (identity layer),
  // manual owner assignments, today's dismissals, classification anchors.
  const todayET = etToday();
  const [caseResult, ownerResult, dismissResult, observedResult, contactsResult, verifyResult, researchResult] = await Promise.all([
    // Case → identity → roster: the tech's RACF id (the comms key) and their
    // CURRENT assigned truck, TPMS first (all_techs.truck_lu goes stale — same
    // precedence as read-repository's renter_own_truck). The assigned truck is
    // what splits "source a replacement" from "replacement already assigned".
    db.execute(sql`
      SELECT c.case_key, c.vehicle_number_padded, c.vehicle_number, c.ams_status,
             i.resolved_district AS tech_district,
             UPPER(TRIM(atr.tech_racfid)) AS tech_ldap,
             COALESCE(rt.tpms_truck, atr.truck_lu, atr.last_known_truck_lu) AS assigned_truck
      FROM vrm_rental_operations_cases c
      LEFT JOIN vrm_rental_identity_resolutions i ON i.case_key = c.case_key
      LEFT JOIN all_techs atr ON atr.employee_id = COALESCE(i.override_employee_id, i.resolved_employee_id)
      -- LIMIT 1 is load-bearing: a tech can appear on more than one TPMS row.
      LEFT JOIN LATERAL (
        SELECT t.truck_no AS tpms_truck
        FROM tpms_last_known_truck_tech t
        WHERE UPPER(TRIM(t.enterprise_id)) = UPPER(TRIM(atr.tech_racfid))
        ORDER BY t.last_seen_at DESC NULLS LAST
        LIMIT 1
      ) rt ON TRUE
      WHERE c.present_in_latest = true
    `),
    db.execute(sql`
      SELECT DISTINCT ON (case_key) case_key, assigned_to, payload
      FROM vrm_rental_operation_actions
      WHERE action_type = 'assign_owner'
      ORDER BY case_key, created_at DESC
    `),
    db.execute(sql`
      SELECT DISTINCT ON (case_key, payload->>'itemKey')
        case_key, payload->>'itemKey' AS item_key, payload->>'undo' AS undo, actor
      FROM vrm_rental_operation_actions
      WHERE action_type = 'queue_dismiss' AND payload->>'day' = ${todayET}
      ORDER BY case_key, payload->>'itemKey', created_at DESC
    `),
    db.execute(sql`
      SELECT case_key, payload->>'classification' AS classification,
             to_char(MIN(created_at), 'YYYY-MM-DD') AS first_seen
      FROM vrm_rental_operation_actions
      WHERE action_type = 'classification_observed'
      GROUP BY 1, 2
    `),
    // Comms directory (roster-sized): the number a queue text actually goes to.
    // Termed contacts kept — a termed tech may still hold our rental, and their
    // number is exactly the one the owner needs.
    fsDb.execute(sql`
      SELECT ldap, phone, phone_digits
      FROM fs_comms_contacts
      WHERE phone_digits IS NOT NULL OR phone IS NOT NULL
    `).catch((e: any) => {
      console.warn('[Queue] Could not load comms contacts (phones omitted):', e?.message || e);
      return { rows: [] } as any;
    }),
    // Manual "verified ready with the shop" marks (latest per key wins).
    db.execute(sql`
      SELECT DISTINCT ON (case_key) case_key, payload->>'verified' AS verified, actor, created_at
      FROM vrm_rental_operation_actions
      WHERE action_type = 'ready_verified'
      ORDER BY case_key, created_at DESC
    `),
    // "Escalated to research" marks (latest per key wins).
    db.execute(sql`
      SELECT DISTINCT ON (case_key) case_key, payload->>'active' AS active, actor, created_at
      FROM vrm_rental_operation_actions
      WHERE action_type = 'research_escalation'
      ORDER BY case_key, created_at DESC
    `),
  ]);
  const tVrm = Date.now();

  const caseKeyByCanon = new Map<string, string>();
  const districtByCase = new Map<string, string | null>();
  const ldapByCase = new Map<string, string>();
  const assignedTruckByCase = new Map<string, string>();
  const amsStatusByCase = new Map<string, string | null>();
  for (const r of ((caseResult as any).rows ?? []) as any[]) {
    const ck = String(r.case_key);
    caseKeyByCanon.set(canon(r.vehicle_number_padded ?? r.vehicle_number ?? r.case_key), ck);
    districtByCase.set(ck, r.tech_district != null ? String(r.tech_district) : null);
    if (r.tech_ldap) ldapByCase.set(ck, String(r.tech_ldap));
    if (r.assigned_truck) assignedTruckByCase.set(ck, String(r.assigned_truck));
    amsStatusByCase.set(ck, r.ams_status != null ? String(r.ams_status) : null);
  }

  const phoneByLdap = new Map<string, string>();
  for (const r of ((contactsResult as any).rows ?? []) as any[]) {
    const ldap = String(r.ldap ?? '').trim().toUpperCase();
    const phone = String(r.phone ?? '').trim() || String(r.phone_digits ?? '').trim();
    if (ldap && phone) phoneByLdap.set(ldap, phone);
  }

  const manualOwnerByKey = new Map<string, string>();
  for (const r of ((ownerResult as any).rows ?? []) as any[]) {
    const auto = String((r.payload ?? {}).auto ?? '') === 'true';
    const who = r.assigned_to != null ? String(r.assigned_to).trim() : '';
    if (!auto && who) manualOwnerByKey.set(String(r.case_key), who);
  }

  const dismissedByKey = new Map<string, { by: string }>();
  for (const r of ((dismissResult as any).rows ?? []) as any[]) {
    if (String(r.undo ?? '') === 'true') continue;
    dismissedByKey.set(String(r.item_key ?? r.case_key), { by: String(r.actor ?? 'unknown') });
  }

  const observedFirstSeen = new Map<string, string>();
  for (const r of ((observedResult as any).rows ?? []) as any[]) {
    if (r.classification) observedFirstSeen.set(`${r.case_key}|${r.classification}`, String(r.first_seen));
  }

  // Manual per-case marks, keyed like owner/dismiss (caseKey, else canonical
  // truck number). Only the latest row counts; an "off" row clears the mark.
  const verifiedByKey = new Map<string, { by: string; at: Date }>();
  for (const r of ((verifyResult as any).rows ?? []) as any[]) {
    if (String(r.verified ?? '') === 'true') {
      verifiedByKey.set(String(r.case_key), { by: String(r.actor ?? 'unknown'), at: new Date(r.created_at) });
    }
  }
  const researchByKey = new Map<string, { by: string; at: Date }>();
  for (const r of ((researchResult as any).rows ?? []) as any[]) {
    if (String(r.active ?? '') === 'true') {
      researchByKey.set(String(r.case_key), { by: String(r.actor ?? 'unknown'), at: new Date(r.created_at) });
    }
  }

  const now = Date.now();
  const TODAY_START = new Date(); TODAY_START.setHours(0, 0, 0, 0);
  // End-of-day boundary: ERDs with any time today still count as "today or past"
  const TODAY_END = new Date(); TODAY_END.setHours(23, 59, 59, 999);
  const THREE_DAYS_MS = 3 * 86400000;

  // Status-aware date constants for sorting
  const RENTAL_STATUSES = new Set(['NLWC - Return Rental', 'On Road', 'Truck Swap', 'In Transit', 'Available to be assigned']);
  const REPAIR_STATUSES = new Set(['Repairing', 'Confirming Status', 'Decision Pending', 'Declined Repair', 'Scheduling']);

  function daysSince(d: Date | string | null | undefined): number {
    if (!d) return 0;
    const dt = d instanceof Date ? d : new Date(d as string);
    if (isNaN(dt.getTime())) return 0;
    return Math.max(0, Math.floor((now - dt.getTime()) / 86400000));
  }

  // daysInStatus — priority chain for computing how long a truck has been in its
  // current mainStatus.  Sources are ordered from most authoritative to least:
  //
  // 1. Reconciled PO layer (repair trucks only) — earliest OPEN qualifying
  //    repair PO date from po_eff (portal-corrected). Replaces the old raw
  //    Snowflake HOLMAN_ETL_PO_DETAILS MIN(PO_DATE): same semantic, but a PO
  //    the portal has since closed no longer anchors the clock.
  // 2. fs_truck_status_events event log (all trucks) — populated by updateTruck() on
  //    every real mainStatus transition, using the same CTE pattern as the
  //    /pmf/days-in-status endpoint's fs_pmf_status_events query.
  //    Only used when the event's mainStatus matches the truck's current mainStatus.
  // 3. mainStatusChangedAt — denormalized timestamp, set on every real transition
  //    (same guard that writes fs_truck_status_events).
  // 4. rentalStartDate — semantic fallback for rental-phase statuses.
  // 5. datePutInRepair — semantic fallback for repair-phase statuses.
  // 6. lastUpdatedAt — final fallback (always present).
  function daysInStatus(truck: Truck): number {
    const ms = truck.mainStatus ?? '';
    // Step 1: reconciled earliest open repair PO date
    if (REPAIR_STATUSES.has(ms)) {
      const start = poMap.get(canon(truck.truckNumber))?.repairStartDate;
      if (start) return daysSince(start);
    }
    // Step 2: local status event log (mirrors fs_pmf_status_events pattern)
    const evt = statusEventMap[truck.id];
    if (evt && evt.mainStatus === truck.mainStatus) {
      return daysSince(evt.effectiveAt);
    }
    // Step 3: denormalized timestamp
    if (truck.mainStatusChangedAt) return daysSince(truck.mainStatusChangedAt);
    // Step 4–5: semantic date fallbacks
    if (RENTAL_STATUSES.has(ms)) {
      return daysSince(truck.rentalStartDate) || daysSince(truck.lastUpdatedAt);
    }
    if (REPAIR_STATUSES.has(ms)) {
      return daysSince(truck.datePutInRepair) || daysSince(truck.lastUpdatedAt);
    }
    return daysSince(truck.lastUpdatedAt);
  }

  /** Effective PO status shown in the old "Holman" column (reconciled po_eff). */
  function getHolmanStatus(truckNumber: string): string | null {
    return poMap.get(canon(truckNumber))?.effStatus ?? null;
  }

  // Authorization-pending signal. The scraper's 'In Authorization' page state is
  // gone; the reconciled analog is an effective PO on HOLD (Holman vocabulary:
  // HOLD = awaiting approval) or an explicit authorization sub-status.
  function isAuthPending(t: Truck): boolean {
    if (poMap.get(canon(t.truckNumber))?.effStatus === 'HOLD') return true;
    return (t.subStatus ?? '').toLowerCase().includes('authorization');
  }

  // Repair-closed-per-PO-evidence signal (replaces the scraper's 'Repair
  // Complete'): the truck HAS qualifying repair history but no PO is open now.
  // Deliberately narrow — only ACTIVE repair statuses. Decision Pending
  // belongs to authorization (step 4), Scheduling to step 2, Declined to step
  // 7; a stale closed PO must not drag those into "retrieve ASAP".
  function poClosedWhileInRepair(t: Truck): boolean {
    const ms = t.mainStatus ?? '';
    if (ms !== 'Repairing' && ms !== 'Confirming Status') return false;
    const p = poMap.get(canon(t.truckNumber));
    return !!p && p.openPoCount === 0 && p.openEvidenceAt != null;
  }

  // Helper: a truck's latest shop call is "unresolved" when its most recent call log is still
  // in flight (never reached a completed/failed lifecycle). While unresolved, the denormalized
  // truck.lastCallStatus reflects an OLDER call, so a stale "Ready" must not surface as current.
  // NOTE: callLogMap.callStatus is the CALL LIFECYCLE (in_progress/completed/failed), NOT the
  // analyzed "Ready/In Repair" label — that label lives only on truck.lastCallStatus.
  function latestCallUnresolved(t: Truck): boolean {
    const cs = callLogMap[t.id]?.callStatus;
    return !!cs && cs !== 'completed' && cs !== 'failed';
  }
  // Helper: the luca label to DISPLAY. Falls back to a neutral "Calling" while the latest call
  // is unresolved, so an old label cannot masquerade as the current call result.
  function lucaStatusFor(t: Truck): string | null {
    if (latestCallUnresolved(t)) return 'Calling';
    return t.lastCallStatus ?? null;
  }
  // Helper: is the truck actually READY per its latest call? A newer unresolved (in-flight) call
  // must not let a stale "Ready" on the truck record qualify it. When there is no shop-call
  // history at all, fall back to the denormalized label.
  function lucaReadyFor(t: Truck): boolean {
    return !latestCallUnresolved(t) && ((t.lastCallStatus ?? null) === 'Ready');
  }
  function lastCallDateFor(t: Truck): Date | null {
    return callLogMap[t.id]?.callTimestamp ?? t.lastCallDate ?? null;
  }
  // Owner/dismiss/verify key for a truck: caseKey when a rental case exists,
  // else canonical truck number (same convention as the queue mutation routes).
  function actionKeyFor(t: Truck): string {
    const cKey = canon(t.truckNumber);
    return caseKeyByCanon.get(cKey) ?? cKey;
  }
  // Manual "verified ready" in effect: latest mark is ON and no call landed
  // AFTER it (a newer LUCA call speaks for itself, whatever it said).
  function readyVerifiedFor(t: Truck): { by: string; at: Date } | null {
    const v = verifiedByKey.get(actionKeyFor(t));
    if (!v) return null;
    const lastCall = lastCallDateFor(t);
    return lastCall && lastCall > v.at ? null : v;
  }
  // "Escalated to research" in effect: latest mark is ON and no RESOLVED call
  // landed after it (a later No Answer / failed attempt doesn't answer the
  // question research was opened for; a real outcome does).
  const UNRESOLVED_CALL_LABELS = new Set(['No Answer', 'Call Failed', 'Failed', 'Unknown', 'Inconclusive - call dropped', 'No Shop Contact', 'Calling']);
  function researchFor(t: Truck): { by: string; at: Date } | null {
    const r = researchByKey.get(actionKeyFor(t));
    if (!r) return null;
    const lastCall = lastCallDateFor(t);
    const label = lucaStatusFor(t);
    const resolvedAfter = !!lastCall && lastCall > r.at && !!label && !UNRESOLVED_CALL_LABELS.has(label);
    return resolvedAfter ? null : r;
  }

  // AMS status of THIS case's van (vrm_rental_operations_cases.ams_status,
  // rental-board enrichment). Declined / sent-to-auction per AMS is TERMINAL:
  // that van is never scheduled for pickup — the real work is fixing the
  // status record and running the replacement/retrieval path on the tech's
  // assigned truck (user directive 2026-08-07).
  function amsStatusFor(t: Truck): string | null {
    const ck = caseKeyByCanon.get(canon(t.truckNumber));
    return ck ? amsStatusByCase.get(ck) ?? null : null;
  }
  function amsTerminalFor(t: Truck): boolean {
    const b = amsBucketOf(amsStatusFor(t));
    return b === 'declined' || b === 'auction';
  }

  const items: QueueItem[] = [];
  const assigned = new Set<string>();
  /** "Aug 5" for whyText evidence lines. */
  const fmtDay = (d: Date): string => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  // --- Registration/tags context (Tyler 2026-08-10) ---
  // One batch over every queue truck: when tag work is live, the card must lay
  // out the REAL blocker (Holman renewal case + verbatim pending-task note) and
  // whose move it is — so nobody chases the tech when the hold is office/Holman
  // paperwork, and the tech IS looped in when the tag work needs them.
  // Display-only; fs signals ride along from the already-loaded truck rows.
  let regCtxByCanon = new Map<string, RegistrationContext>();
  try {
    regCtxByCanon = await fetchRegistrationContextMap(allTrucks.map(t => ({
      truckNumber: t.truckNumber,
      mainStatus: t.mainStatus ?? null,
      fs: {
        registrationStickerValid: t.registrationStickerValid,
        registrationExpiryDate: t.registrationExpiryDate,
        registrationLastUpdate: t.registrationLastUpdate,
        tagsInOffice: t.tagsInOffice,
        tagsSentToTech: t.tagsSentToTech,
        awaitingTechDocuments: t.awaitingTechDocuments,
        renewalProcessStarted: t.renewalProcessStarted,
        registrationInProgress: t.registrationInProgress,
      },
    })));
  } catch (e: any) {
    console.error('[Queue] registration context fetch failed (cards degrade to plain):', e?.message || e);
  }

  // --- STEP 1: CONFIRM RENTAL RETURNED ---
  const STEP1_STATUSES = new Set(['NLWC - Return Rental', 'On Road', 'Truck Swap', 'In Transit', 'Available to be assigned']);
  for (const t of [...allTrucks].filter(t => STEP1_STATUSES.has(t.mainStatus || '')).sort((a, b) => daysInStatus(b) - daysInStatus(a))) {
    if (assigned.has(t.id)) continue;
    assigned.add(t.id);
    items.push({
      step: 1, stepTitle: 'CONFIRM RENTAL RETURNED',
      lane: 'ready',
      whyText: `Fleet status "${t.mainStatus}" says the truck is back with the tech, but the rental has not been confirmed returned to Enterprise.`,
      truckId: t.id, truckNumber: t.truckNumber, techName: t.techName ?? null,
      fleetScopeStatus: t.mainStatus ?? '', holmanStatus: getHolmanStatus(t.truckNumber),
      lucaStatus: lucaStatusFor(t), lastCallDate: lastCallDateFor(t)?.toISOString() ?? null,
      actionText: isAuthPending(t)
        ? '⚠️ Holman PO shows authorization pending — confirm with Rob before proceeding. Also confirm rental has been returned to Enterprise — contact tech or shop to verify'
        : 'Confirm rental has been returned to Enterprise — contact tech or shop to verify',
      sortKey: daysInStatus(t),
      repairPhone: t.repairPhone ?? null, techState: t.techState ?? null,
    });
  }

  // --- STEP 2: SCHEDULE TECH PICKUP ---
  // The old step said "check with Morgan"; scheduling is done in-house now
  // (2026-08-05). The date is set on the VRM Ops Queue row (schedule_pickup
  // action → fs_trucks.scheduled_pickup_date mirror), which can also file the
  // rental-return route block through the Standard Activities API. Partition:
  // due first (date arrived — confirm the swap happened), then unscheduled
  // (needs a date), then future (parked until the date).
  const formatDateOnly = (iso: string): string => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  const SCHED_BUCKET_ORDER: Record<SchedulingBucket, number> = { due: 0, unscheduled: 1, future: 2 };
  const schedulingTrucks = allTrucks
    .filter(t => !assigned.has(t.id) && t.mainStatus === 'Scheduling')
    .map(t => ({ t, bucket: classifySchedulingDate(t.scheduledPickupDate ?? null, todayET) }))
    .sort((a, b) => {
      if (SCHED_BUCKET_ORDER[a.bucket] !== SCHED_BUCKET_ORDER[b.bucket]) {
        return SCHED_BUCKET_ORDER[a.bucket] - SCHED_BUCKET_ORDER[b.bucket];
      }
      if (a.bucket === 'unscheduled') return daysInStatus(b.t) - daysInStatus(a.t); // longest-waiting first
      return String(a.t.scheduledPickupDate).localeCompare(String(b.t.scheduledPickupDate)); // date ascending
    });
  // VALIDATION GATE (user directive 2026-08-07): "Scheduling" is seeded from
  // Fleet Scope and is a CLAIM, not evidence. A row only presents as pickup
  // work when readiness is phone-confirmed (LUCA Ready or a manual verify);
  // otherwise it is an action-lane validation task. AMS terminal states
  // (declined / sent to auction) override everything: that van is never
  // picked up — fix the record and work the replacement/retrieval path.
  for (const { t, bucket } of schedulingTrucks) {
    assigned.add(t.id);
    const sp = t.scheduledPickupDate ?? null;
    const validated = lucaReadyFor(t) || !!readyVerifiedFor(t);
    // Fleet Scope's OWN row can contradict its pickup claim (Tyler 2026-08-07:
    // surfaced, never silently upgraded — a sub-status is not a booking).
    // NOTE (2026-08-10): the original check had a second leg on
    // fs_trucks.repair_completed; removed per user. That flag is a dead
    // FS-era field for rentals: VRM owns rental state (2026-08-04), the
    // Rental Ops mirror sync never writes it, and mirror-created rows sit at
    // the column DEFAULT false forever (measured: 345/357 rows false, incl.
    // 14/15 Scheduling — even the original "13 of 21" reading was this
    // artifact). A schema default is not evidence the repair is unfinished,
    // so it must never contradict a live shop call.
    const claimsScheduled = /awaiting tech pickup/i.test(t.subStatus ?? '');
    const scheduledWithoutDate = claimsScheduled && !sp;
    const selfConflicts: string[] = [];
    if (scheduledWithoutDate) selfConflicts.push(`the sub-status reads "${t.subStatus}" but no pickup date has ever been set`);
    const amsRaw = amsStatusFor(t);
    const amsTerminal = amsTerminalFor(t);
    const warn = isAuthPending(t)
      ? '⚠️ Holman PO shows authorization pending — confirm with Rob before proceeding. '
      : '';
    let lane: QueueLane = 'ready';
    let whyText: string;
    let actionText: string;
    if (amsTerminal) {
      lane = 'action';
      whyText = `AMS says this van is "${amsRaw}" — a declined/auction unit is never picked up, yet the fleet status still says "Scheduling".`;
      actionText = warn + "Fix the status conflict: correct the fleet status and work the replacement/retrieval path on the tech's assigned truck — do not book a pickup for this van.";
    } else if (!validated) {
      const label = lucaStatusFor(t);
      const lastD = lastCallDateFor(t);
      lane = 'action';
      whyText = label
        ? `Fleet status says "Scheduling", but the last call on file (${label}${lastD ? `, ${fmtDay(lastD)}` : ''}) does not confirm truck ${t.truckNumber} is ready.`
        : `Fleet status says "Scheduling", but there is no shop call on file confirming truck ${t.truckNumber} is ready.`;
      actionText = warn + `Validate before booking: call the shop (or check LUCA history) to confirm truck ${t.truckNumber} is ready, then mark it Verified ready — pickup scheduling unlocks once validated.`;
    } else if (selfConflicts.length) {
      // The call confirmed readiness but the fleet record disagrees with itself.
      // This is a VERIFY task, not pickup work: dispatching a tech on it is how
      // somebody drives to a shop for a van that is not finished.
      lane = 'action';
      const label2 = lucaStatusFor(t);
      const lastD2 = lastCallDateFor(t);
      whyText = `A shop call${label2 ? ` (${label2}${lastD2 ? `, ${fmtDay(lastD2)}` : ''})` : ''} says truck ${t.truckNumber} is ready, but ${selfConflicts.join(' and ')}.`;
      actionText = warn + `Resolve the contradiction before booking: confirm with the shop that the repair on truck ${t.truckNumber} is actually finished, then set the pickup date on this row. Do not dispatch the tech on the call alone.`;
    } else {
      whyText = bucket === 'due'
        ? `Pickup was scheduled for ${formatDateOnly(sp!)} and that date has arrived.`
        : bucket === 'future'
          ? `Pickup is booked for ${formatDateOnly(sp!)}.`
          : 'The truck is in "Scheduling" but no pickup date has been set yet.';
      actionText = warn + (bucket === 'due'
        ? `Pickup was scheduled for ${formatDateOnly(sp!)} — confirm the tech returned the rental and collected the truck, then update the status`
        : bucket === 'future'
          ? `Pickup scheduled for ${formatDateOnly(sp!)} — no action needed until then`
          : 'No pickup scheduled — set the date on this row in VRM Ops Queue (books the rental-return block on the tech\'s route)');
    }
    items.push({
      step: 2, stepTitle: 'SCHEDULE TECH PICKUP',
      lane,
      whyText,
      truckId: t.id, truckNumber: t.truckNumber, techName: t.techName ?? null,
      fleetScopeStatus: t.mainStatus ?? '', holmanStatus: getHolmanStatus(t.truckNumber),
      lucaStatus: lucaStatusFor(t), lastCallDate: lastCallDateFor(t)?.toISOString() ?? null,
      actionText,
      sortKey: daysInStatus(t),
      isConflict: (amsTerminal || (validated && selfConflicts.length > 0)) || undefined,
      repairPhone: t.repairPhone ?? null, techState: t.techState ?? null,
      scheduledPickupDate: sp,
      lastCallConversationId: t.lastCallConversationId ?? null,
      // A row that contradicts itself is NOT validated pickup work, whatever
      // the call said. This is what keeps it out of the 'ready' cohort counts.
      schedulingValidated: validated && !amsTerminal && selfConflicts.length === 0,
    });
  }

  // --- STEP 3: VEHICLE READY — RETRIEVE ASAP ---
  // PHONE-CONFIRMED only: a LUCA call that said Ready, or a human's manual
  // "verified ready" mark. Closed-PO / passed-ERD inference is NOT ready — it
  // goes to Step 8 (PO CLOSED — CONFIRM WITH SHOP) as a verification task.
  const RETURNED_SET = new Set(['NLWC - Return Rental', 'On Road', 'Truck Swap', 'In Transit', 'Available to be assigned']);
  const stepReadyExcluded = (t: Truck) =>
    // Tags and Declined Repair trucks belong in Steps 6 and 7 respectively —
    // exclude them here so they are not absorbed before reaching their step.
    ['Tags', 'Declined Repair'].includes(t.mainStatus ?? '') ||
    // If authorization is still pending, let it fall to Step 4.
    isAuthPending(t) ||
    // AMS-terminal (declined/auction) vans are never pickup candidates even
    // when a call said Ready — the classifier pivots them to the status-
    // conflict / replacement path instead (post-pass).
    amsTerminalFor(t);
  const step3Candidates = [...allTrucks].filter(t => {
    if (assigned.has(t.id) || stepReadyExcluded(t)) return false;
    // Ready only if the latest call actually confirms it — a newer in-flight call must not let
    // a stale "Ready" on the truck record qualify here (see lucaReadyFor / latestCallUnresolved).
    return lucaReadyFor(t) || !!readyVerifiedFor(t);
  }).sort((a, b) => daysInStatus(b) - daysInStatus(a));
  for (const t of step3Candidates) {
    if (assigned.has(t.id)) continue;
    assigned.add(t.id);
    const isConflict = t.mainStatus === 'Repairing' || t.mainStatus === 'Confirming Status' || t.mainStatus === 'Decision Pending';
    const lucaReady = lucaReadyFor(t);
    const verified = readyVerifiedFor(t);
    const readyReason: 'luca' | 'manual' = lucaReady ? 'luca' : 'manual';
    const actionText = isConflict
      ? `STATUS CONFLICT — call/verification shows truck ${t.truckNumber} ready but FleetScope not updated. Correct all systems then arrange pickup.`
      : readyReason === 'luca'
        ? `LUCA confirmed truck ${t.truckNumber} is READY — arrange same-day pickup`
        : `Truck ${t.truckNumber} verified ready by ${verified?.by ?? 'staff'} — arrange same-day pickup`;
    const lastCallD = lastCallDateFor(t);
    items.push({
      step: 3, stepTitle: 'VEHICLE READY — RETRIEVE ASAP',
      lane: 'ready',
      whyText: readyReason === 'luca'
        ? `LUCA phone-confirmed with the shop${lastCallD ? ` on ${fmtDay(lastCallD)}` : ''}: truck ${t.truckNumber} is READY for pickup.`
        : `${verified?.by ?? 'Staff'} called the shop and verified truck ${t.truckNumber} is ready${verified ? ` (${fmtDay(verified.at)})` : ''}.`,
      truckId: t.id, truckNumber: t.truckNumber, techName: t.techName ?? null,
      fleetScopeStatus: t.mainStatus ?? '', holmanStatus: getHolmanStatus(t.truckNumber),
      lucaStatus: lucaStatusFor(t), lastCallDate: lastCallDateFor(t)?.toISOString() ?? null,
      actionText,
      sortKey: daysInStatus(t),
      isConflict,
      repairPhone: t.repairPhone ?? null, techState: t.techState ?? null,
      readyReason,
      readyVerified: verified ? { by: verified.by, at: verified.at.toISOString() } : null,
    });
  }

  // --- STEP 9: VERIFY TRUCK LOCATION / SHOP RECORD (LUCA escalations) ---
  // The queue's "needs action" backbone: LUCA hit a problem it cannot solve by
  // redialing — the shop says the truck isn't there, the number on file is
  // wrong/dead, the truck needs a tow, or the outcome needs a human confirm.
  // Without this step these trucks silently fell to Step 5 / "no action"
  // (Step 5's bad-status list only covers retry-able outcomes). Built BEFORE
  // Step 8 because a location/record problem invalidates PO inference for the
  // same truck. Numbered 9 so existing client step groups keep their ids.
  // Labels + copy live in shop-record-flags.ts (evaluateStep9Disposition).
  // The disposition is EVIDENCE-AWARE: the persisted last_call_status is a
  // snapshot from dispatch time, so when the LIVE reconciled record proves the
  // blocker was since fixed ('No Shop Contact' with a dialable pick phone, or
  // a corrected shop of record after 'Shop Does Not Have Truck'/'Relocated'),
  // the item demotes to 'monitor' instead of contradicting its own card.
  const step9Candidates = [...allTrucks].filter(t => {
    if (assigned.has(t.id)) return false;
    if (['Tags', 'Declined Repair'].includes(t.mainStatus ?? '')) return false;
    const label = lucaStatusFor(t);
    if (label && STEP9_PROBLEM_LABELS.has(label)) return true;
    const wb = workbookStates.get(caseKeyByCanon.get(canon(t.truckNumber)) ?? '');
    return wb?.status === 'escalated';
  }).sort((a, b) => (lastCallDateFor(b)?.getTime() ?? 0) - (lastCallDateFor(a)?.getTime() ?? 0));
  for (const t of step9Candidates) {
    if (assigned.has(t.id)) continue;
    assigned.add(t.id);
    const label = lucaStatusFor(t);
    const lastDate = lastCallDateFor(t);
    const cKey9 = canon(t.truckNumber);
    const p9 = poMap.get(cKey9);
    // Namespaced lookup: exact case provenance first, then this truck's own
    // dispatch — never a digit-colliding stranger's (see buildLucaDispatchMap).
    const dial9 = lucaDialedMap.get(`case:${canon(actionKeyFor(t))}`) ?? lucaDialedMap.get(`truck:${cKey9}`) ?? null;
    const disp = evaluateStep9Disposition({
      label,
      pickShopName: p9?.shopName ?? null,
      pickShopPhone: p9?.shopPhone ?? null,
      // Shared junk-gate (read-repository.cleanPhone) — the SAME rule the
      // chips and both boards apply, so step 9 can never call a number
      // "missing" that the card right above it is displaying.
      fallbackPhone: cleanPhone(t.repairPhone),
      dial: dial9,
      lastCallDate: lastDate,
    });
    items.push({
      step: 9, stepTitle: 'VERIFY TRUCK LOCATION / SHOP RECORD',
      lane: disp?.lane ?? 'action',
      whyText: disp?.why
        ?? "LUCA escalated this case to a human — it can't resolve it by calling again.",
      truckId: t.id, truckNumber: t.truckNumber, techName: t.techName ?? null,
      fleetScopeStatus: t.mainStatus ?? '', holmanStatus: getHolmanStatus(t.truckNumber),
      lucaStatus: label, lastCallDate: lastDate?.toISOString() ?? null,
      actionText: disp?.act ?? 'Read the last call summary on the case, then take over the shop conversation.',
      sortKey: lastDate?.getTime() ?? 0,
      repairPhone: t.repairPhone ?? null, techState: t.techState ?? null,
    });
  }

  // --- STEP 8: PO CLOSED — CONFIRM WITH SHOP (built here so PO evidence
  // outranks the auth/unreachable steps in claiming trucks; numbered 8 so the
  // client renders it as its own group). A closed PO or passed estimated-ready
  // date means the repair LOOKS done — someone must confirm with the shop
  // (mark Verified ready) or, if the shop can't be validated, escalate to
  // research. Research-escalated cases stay here under their own banner.
  const step8Candidates = [...allTrucks].filter(t => {
    if (assigned.has(t.id) || stepReadyExcluded(t)) return false;
    const cl = callLogMap[t.id];
    const erd = cl?.estimatedReadyDate ?? t.eta ?? t.expectedCompletion ?? null;
    const dateReady = erd ? (new Date(erd) <= TODAY_END && !RETURNED_SET.has(t.mainStatus ?? '')) : false;
    return poClosedWhileInRepair(t) || dateReady || !!researchFor(t);
  }).sort((a, b) => {
    const erdA = callLogMap[a.id]?.estimatedReadyDate ?? a.eta ?? a.expectedCompletion ?? null;
    const erdB = callLogMap[b.id]?.estimatedReadyDate ?? b.eta ?? b.expectedCompletion ?? null;
    if (erdA && erdB) {
      const dateDiff = new Date(erdA).getTime() - new Date(erdB).getTime();
      return dateDiff !== 0 ? dateDiff : daysInStatus(b) - daysInStatus(a);
    }
    if (erdA) return -1; if (erdB) return 1;
    return daysInStatus(b) - daysInStatus(a);
  });
  for (const t of step8Candidates) {
    if (assigned.has(t.id)) continue;
    assigned.add(t.id);
    const cl = callLogMap[t.id];
    const erd = cl?.estimatedReadyDate ?? t.eta ?? t.expectedCompletion ?? null;
    const research = researchFor(t);
    const holmanReady = poClosedWhileInRepair(t);
    const readyReason: 'holman' | 'date' = holmanReady ? 'holman' : 'date';
    const actionText = research
      ? `Escalated to research by ${research.by} — locate truck ${t.truckNumber} and its repair status.`
      : readyReason === 'holman'
        ? `Holman PO closed but readiness is UNCONFIRMED — call the shop to confirm truck ${t.truckNumber} is ready; if so, mark Verified ready. Can't validate the shop? Escalate to research.`
        : `Estimated ready date has passed — call the shop to confirm truck ${t.truckNumber} is ready; if so, mark Verified ready.`;
    items.push({
      step: 8, stepTitle: 'PO CLOSED — CONFIRM WITH SHOP',
      // Research escalations are live human work; the rest is billing/date
      // inference — a closed PO alone is NOT proof the truck is ready.
      lane: research ? 'action' : 'monitor',
      whyText: research
        ? `${research.by} escalated this case to research on ${fmtDay(research.at)} — the shop couldn't be validated from POs and calls.`
        : readyReason === 'holman'
          ? `Holman closed the PO, but that is billing paperwork — no one has phone-confirmed truck ${t.truckNumber} is ready.`
          : `The shop's estimated ready date${erd ? ` (${fmtDay(new Date(erd))})` : ''} has passed without a confirming call on truck ${t.truckNumber}.`,
      truckId: t.id, truckNumber: t.truckNumber, techName: t.techName ?? null,
      fleetScopeStatus: t.mainStatus ?? '', holmanStatus: getHolmanStatus(t.truckNumber),
      lucaStatus: lucaStatusFor(t), lastCallDate: lastCallDateFor(t)?.toISOString() ?? null,
      actionText,
      sortKey: erd ? new Date(erd).getTime() : 0,
      repairPhone: t.repairPhone ?? null, techState: t.techState ?? null,
      readyReason,
      research: research ? { by: research.by, at: research.at.toISOString() } : null,
    });
  }

  // --- STEP 4: ESCALATE TO ROB FOR AUTHORIZATION ---
  for (const t of [...allTrucks].filter(t => {
    if (assigned.has(t.id)) return false;
    // Tags and Declined Repair belong to Steps 6 and 7 — their mainStatus overrules any authorization signal
    if (['Tags', 'Declined Repair'].includes(t.mainStatus ?? '')) return false;
    return t.mainStatus === 'Decision Pending' || isAuthPending(t);
  }).sort((a, b) => daysInStatus(b) - daysInStatus(a))) {
    if (assigned.has(t.id)) continue;
    assigned.add(t.id);
    items.push({
      step: 4, stepTitle: 'ESCALATE TO ROB FOR AUTHORIZATION',
      lane: 'action',
      whyText: 'The repair is stuck on an authorization decision — nothing moves until it is approved or declined.',
      truckId: t.id, truckNumber: t.truckNumber, techName: t.techName ?? null,
      fleetScopeStatus: t.mainStatus ?? '', holmanStatus: getHolmanStatus(t.truckNumber),
      lucaStatus: lucaStatusFor(t), lastCallDate: lastCallDateFor(t)?.toISOString() ?? null,
      actionText: 'Escalate to Rob — repair authorization decision needed. Rob to approve or deny today.',
      sortKey: daysInStatus(t),
      repairPhone: t.repairPhone ?? null, techState: t.techState ?? null,
    });
  }

  // --- STEP 5: SHOP UNREACHABLE — CALL BACK ---
  // (spec §11.6 — the old "INITIATE LUCA AI CALL" wording is retired; there is
  // no per-truck dial trigger. LUCA dials on its own cadence from VRM; the
  // human action here is a manual callback.)
  // fs_call_logs are authoritative for last call date and status
  for (const t of [...allTrucks].filter(t => {
    if (assigned.has(t.id)) return false;
    if (t.mainStatus !== 'Repairing' && t.mainStatus !== 'Confirming Status') return false;
    // Call log authoritative for determining recency and status
    const lastDate = lastCallDateFor(t);
    const lucaStatus = lucaStatusFor(t);
    const noRecentCall = !lastDate || (now - lastDate.getTime()) > THREE_DAYS_MS;
    const badStatus = ['No Answer', 'Call Failed', 'Failed', 'Unknown'].includes(lucaStatus ?? '');
    return noRecentCall || badStatus;
  }).sort((a, b) => {
    const dA = lastCallDateFor(a)?.getTime() ?? 0;
    const dB = lastCallDateFor(b)?.getTime() ?? 0;
    return dA - dB; // ascending, nulls (0) first
  })) {
    if (assigned.has(t.id)) continue;
    assigned.add(t.id);
    const lastDate = lastCallDateFor(t);
    const actionText = lastDate
      ? `Last attempted: ${lastDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}. LUCA could not reach the shop about truck ${t.truckNumber} — call back manually.`
      : `No call on record. Call the shop directly for a status on truck ${t.truckNumber}.`;
    items.push({
      step: 5, stepTitle: 'SHOP UNREACHABLE — CALL BACK',
      lane: 'monitor',
      whyText: lastDate
        ? `LUCA's last attempt on ${fmtDay(lastDate)} ended "${lucaStatusFor(t) ?? 'Unknown'}" — LUCA keeps retrying on its own cadence.`
        : 'No shop call on record yet for this repair.',
      truckId: t.id, truckNumber: t.truckNumber, techName: t.techName ?? null,
      fleetScopeStatus: t.mainStatus ?? '', holmanStatus: getHolmanStatus(t.truckNumber),
      lucaStatus: lucaStatusFor(t),
      lastCallDate: lastCallDateFor(t)?.toISOString() ?? null,
      actionText,
      sortKey: lastDate?.getTime() ?? 0,
      repairPhone: t.repairPhone ?? null, techState: t.techState ?? null,
    });
  }

  // --- STEP 6: TAGS / REGISTRATION HOLD ---
  for (const t of [...allTrucks].filter(t => !assigned.has(t.id) && t.mainStatus === 'Tags').sort((a, b) => daysInStatus(b) - daysInStatus(a))) {
    assigned.add(t.id);
    // When Nexus already knows the real blocker, the card says it — instead of
    // a generic "waiting on paperwork" that sends someone to re-discover it.
    const ctx = regCtxByCanon.get(canonReg(t.truckNumber));
    const blockerBits: string[] = [];
    if (ctx?.holmanCaseStatus || ctx?.renewalStep) blockerBits.push(`Holman renewal case: ${ctx.holmanCaseStatus ?? ctx.renewalStep}`);
    if (ctx?.blockerNote) blockerBits.push(`"${ctx.blockerNote}"`);
    const whyText = blockerBits.length
      ? `Status "Tags" — ${blockerBits.join(' — ')}`
      : 'Status "Tags" — the truck is waiting on tags/registration paperwork, not a repair.';
    const actionText = ctx
      ? (ctx.techAction.required
          ? `Tech has a required move: ${ctx.techAction.summary}`
          : `${ctx.techAction.summary} Don't chase the tech for this.`)
      : 'Tags hold — routed to district team';
    items.push({
      step: 6, stepTitle: 'CONFIRM TAGS WITH CHERYL',
      lane: 'monitor',
      whyText,
      truckId: t.id, truckNumber: t.truckNumber, techName: t.techName ?? null,
      fleetScopeStatus: t.mainStatus ?? '', holmanStatus: getHolmanStatus(t.truckNumber),
      lucaStatus: lucaStatusFor(t), lastCallDate: lastCallDateFor(t)?.toISOString() ?? null,
      actionText,
      sortKey: daysInStatus(t),
      repairPhone: t.repairPhone ?? null, techState: t.techState ?? null,
    });
  }

  // --- STEP 7: DECLINED / SOLD — REPLACEMENT ---
  // Two work states (user directive 2026-08-10, reversing the old "sourcing is
  // not this queue's job" dead-end): the tech ALREADY has a replacement →
  // close out the rental; no replacement yet → the row stays queued as
  // "needs replacement — locate a spare" (spare availability attached in the
  // decoration pass below). Only the replacement-itself-in-the-shop case still
  // dead-ends to "No action required today" (LUCA tracks that repair).
  // 'Approved for sale' is the auction-side terminal status — same treatment.
  const step7Trucks = [...allTrucks].filter(t => !assigned.has(t.id) && (t.mainStatus === 'Declined Repair' || t.mainStatus === 'Approved for sale')).sort((a, b) => daysInStatus(b) - daysInStatus(a));
  const step7AssignedTruck = step7Trucks.map(t => {
    const ck = caseKeyByCanon.get(canon(t.truckNumber));
    const a = ck ? assignedTruckByCase.get(ck) ?? null : null;
    const ac = a ? canon(a) : null;
    return ac && ac !== '0' && ac !== canon(t.truckNumber) ? a : null;
  });
  const tSteps = Date.now();
  for (let i = 0; i < step7Trucks.length; i++) {
    const t = step7Trucks[i];
    if (assigned.has(t.id)) continue;
    assigned.add(t.id);
    const already = step7AssignedTruck[i];
    const gone = t.mainStatus === 'Approved for sale' ? 'Truck was approved for sale' : 'Repair was declined';
    items.push({
      step: 7, stepTitle: 'DECLINED / SOLD — REPLACEMENT',
      // No-replacement rows default to 'monitor'; the spare-availability pass
      // upgrades them to 'action' when an unassigned spare actually exists.
      lane: already ? 'action' : 'monitor',
      whyText: already
        ? `${gone} and the tech is already driving truck ${already} — the rental is the only thing left open.`
        : `${gone} — the tech is stuck in a rental until a replacement is assigned.`,
      truckId: t.id, truckNumber: t.truckNumber, techName: t.techName ?? null,
      fleetScopeStatus: t.mainStatus ?? '', holmanStatus: getHolmanStatus(t.truckNumber),
      lucaStatus: lucaStatusFor(t), lastCallDate: lastCallDateFor(t)?.toISOString() ?? null,
      actionText: already
        ? `Tech is already assigned truck ${already} — no replacement to source. Confirm the rental went back and close out.`
        : 'No replacement assigned yet — check spare availability and start the assignment in Spares.',
      sortKey: daysInStatus(t),
      repairPhone: t.repairPhone ?? null, techState: t.techState ?? null,
    });
  }

  // ── PERSONA-BUCKET DECORATION (one post-pass over the built items) ─────────
  // Stamps owner / region / classifications / SLA clocks / dismissal on every
  // item without touching the step logic above.
  const truckById = new Map<string, Truck>(allTrucks.map(t => [t.id, t]));
  const anchorSeeds: Array<{ key: string; classification: string }> = [];
  // Declined/auction dead-ends: classify() returned [] — no queue action today.
  // These cases move to "No action required" (with a reason) instead of items.
  const droppedIds = new Set<string>();
  const noActionExtras: NoActionItem[] = [];

  for (const it of items) {
    const t = truckById.get(it.truckId);
    if (!t) continue;
    const cKey = canon(it.truckNumber);
    const caseKey = caseKeyByCanon.get(cKey) ?? null;
    const key = caseKey ?? cKey;
    const p = poMap.get(cKey);
    const wb = caseKey ? workbookStates.get(caseKey) : undefined;
    const ms = t.mainStatus ?? '';
    const cl = callLogMap[t.id];
    const erd = cl?.estimatedReadyDate ?? t.eta ?? t.expectedCompletion ?? null;
    const erdPassed = !!erd && new Date(erd) <= TODAY_END && !RETURNED_SET.has(ms);
    const schedBucket = ms === 'Scheduling' ? classifySchedulingDate(t.scheduledPickupDate ?? null, todayET) : null;
    const sp = (t.scheduledPickupDate ?? '').trim();
    const wbOpen = !!wb && !WORKBOOK_CLOSED_STATUSES.has(wb.status);
    const lastCall = lastCallDateFor(t);
    const verified = readyVerifiedFor(t);
    const research = researchFor(t);

    // Replacement gap: TPMS already has this tech on a DIFFERENT truck. The
    // assigned truck's own repair state comes off the same reconciled PO layer
    // as everything else (poMap covers every truck with PO history).
    const assignedRaw = caseKey ? assignedTruckByCase.get(caseKey) ?? null : null;
    const assignedCanon = assignedRaw ? canon(assignedRaw) : null;
    const assignedDiffers = !!assignedCanon && assignedCanon !== '0' && assignedCanon !== cKey;
    const assignedInRepair = assignedDiffers && ((poMap.get(assignedCanon!)?.openPoCount ?? 0) > 0);

    const input: ClassifyInput = {
      fleetScopeStatus: ms,
      subStatus: t.subStatus ?? null,
      lucaStatus: lucaStatusFor(t),
      lucaReady: lucaReadyFor(t),
      readyVerified: !!verified,
      researchActive: !!research,
      latestCallUnresolved: latestCallUnresolved(t),
      workbookStatus: wb?.status ?? null,
      workbookFollowUpDue: !!wb && wbOpen && !!wb.follow_up_date && wb.follow_up_date <= todayET,
      escalated: wb?.status === 'escalated',
      erdPassed,
      poClosedWhileInRepair: poClosedWhileInRepair(t),
      schedulingDue: schedBucket === 'due',
      schedulingUnscheduled: schedBucket === 'unscheduled',
      pickupDatePassed: ms === 'Scheduling' && /^\d{4}-\d{2}-\d{2}$/.test(sp) && sp < todayET,
      returnInFlight: STEP1_STATUSES.has(ms),
      etaSlips: etaSlipMap[t.id] ?? 0,
      daysInShop: REPAIR_STATUSES.has(ms) ? daysInStatus(t) : null,
      daysSinceLastAttempt: lastCall ? daysSince(lastCall) : null,
      callAttempts2d: 0, // SOP: source not yet available (per-tech outreach attempts are not tracked)
      tagsHold: ms === 'Tags',
      noQualifyingPo: false, // SOP: source not yet available (workload mismatch lives on the case board)
      decommission: decomSet.has(cKey),
      declinedOrAuction: ms === 'Declined Repair' || ms === 'Approved for sale',
      amsTerminal: amsTerminalFor(t),
      replacementAssigned: assignedDiffers,
      assignedTruckInRepair: assignedInRepair,
      readyGuardDowngraded: false, // SOP: source not yet available (no ready-guard downgrade ledger)
      shopPhoneBad: false, // SOP: source not yet available (no wrong-number reason on call logs)
    };

    const routing = resolveOwnerRouting({
      manualOwner: manualOwnerByKey.get(key) ?? null,
      techHomeState: t.techState ?? null,
      shopState: shopStateFromAddress(t.repairAddress),
      plateState: null,
    });
    const district = caseKey ? districtByCase.get(caseKey) ?? null : null;

    const classificationKeys = classify(input);
    if (classificationKeys.length === 0) {
      // The one remaining dead-end: sold/declined and the tech's replacement
      // is itself in the shop — LUCA already tracks that repair on the VRM
      // pages. (No-replacement rows now classify needs_replacement and stay
      // queued — user directive 2026-08-10.)
      droppedIds.add(it.truckId);
      noActionExtras.push({
        truckId: it.truckId,
        truckNumber: it.truckNumber,
        techName: it.techName,
        fleetScopeStatus: it.fleetScopeStatus,
        holmanStatus: it.holmanStatus,
        caseKey,
        reason: assignedDiffers && assignedInRepair
          ? `Sold/declined — tech's replacement ${assignedRaw} is in the shop (LUCA tracking)`
          : 'No queue-actionable classification today',
      });
      continue;
    }

    const classifications: ItemClassification[] = classificationKeys.map((k) => {
      const def = CLASSIFICATION_BY_KEY.get(k)!;
      const o = ownerForClassification(def, routing, district);
      // SLA anchor (spec §7): the signal's own event date when it has one,
      // else the first time this builder observed the classification.
      let anchor: string | null = null;
      if (k === 'luca_escalated') anchor = wb?.updated_at?.slice(0, 10) ?? null;
      else if (k === 'follow_up_due') anchor = wb?.follow_up_date ?? null;
      else if (k === 'vehicle_ready_schedule') {
        anchor = lucaReadyFor(t) && lastCall ? lastCall.toISOString().slice(0, 10)
          : (verified ? verified.at.toISOString().slice(0, 10) : null);
      } else if (k === 'po_closed_confirm') {
        anchor = erdPassed && erd ? String(erd).slice(0, 10) : null;
      } else if (k === 'research_truck_status') {
        anchor = research ? research.at.toISOString().slice(0, 10) : null;
      } else if (k === 'schedule_tech_pickup' || k === 'pickup_follow_up') {
        anchor = /^\d{4}-\d{2}-\d{2}$/.test(sp) ? sp : null;
      }
      if (!anchor) {
        const seen = observedFirstSeen.get(`${key}|${k}`);
        if (seen) anchor = seen;
        else {
          anchor = todayET;
          anchorSeeds.push({ key, classification: k });
        }
      }
      const slaDueDate = def.slaBusinessDays != null ? addBusinessDays(anchor, def.slaBusinessDays) : null;
      return {
        key: k,
        label: def.label,
        priority: def.priority,
        owner: o.owner,
        needsRouting: o.needsRouting,
        anchorDate: anchor,
        slaDueDate,
        businessDaysLate: slaDueDate ? businessDaysLate(slaDueDate, todayET) : 0,
      };
    });

    const top = classifications[0];
    const topDef = CLASSIFICATION_BY_KEY.get(top.key)!;
    it.key = key;
    it.caseKey = caseKey;
    it.readyVerified = verified ? { by: verified.by, at: verified.at.toISOString() } : null;
    it.research = research ? { by: research.by, at: research.at.toISOString() } : null;
    // Phone-confirmed ready evidence (shop-confirmed bucket): every confirmed-
    // ready row carries WHY it's ready plus the call reference, whatever step
    // built it (step 3 already stamps readyReason; step-1/2 rows lack it).
    if ((input.lucaReady || input.readyVerified) && it.readyReason !== 'luca' && it.readyReason !== 'manual') {
      it.readyReason = input.lucaReady ? 'luca' : 'manual';
    }
    if (it.lastCallConversationId === undefined) {
      it.lastCallConversationId = t.lastCallConversationId ?? null;
    }
    it.owner = top.owner;
    it.ownerBasis = routing.basis === 'manual' ? 'manual' : (topDef.ownerRule === 'regional' ? routing.basis : topDef.ownerRule);
    it.region = routing.region;
    it.needsRouting = top.needsRouting;
    it.classifications = classifications;
    it.workBucket = workBucketForItem(it);
    it.dismissedToday = dismissedByKey.get(key) ?? null;
    const ldap = caseKey ? ldapByCase.get(caseKey) ?? null : null;
    it.techLdap = ldap;
    it.techPhone = (ldap ? phoneByLdap.get(ldap) ?? null : null) ?? t.techPhone ?? null;
    it.assignedTruck = assignedDiffers ? assignedRaw : null;
    // AMS terminal counts the same as a declined/auction fleet status here:
    // either way the van is gone and the tech being on a different truck
    // means the replacement leg is already done.
    it.replacementAssigned = assignedDiffers && (input.declinedOrAuction || input.amsTerminal);
    it.assignedTruckInRepair = assignedInRepair;
    it.amsStatus = amsStatusFor(t);
    it.amsBucket = (() => { const b = amsBucketOf(it.amsStatus ?? null); return b === 'unknown' ? null : b; })();
    // Display-shop assembly SHARED with both boards and the drawer
    // (displayShopFor): reconciled pick first, junk-gated fs_trucks
    // repair_phone as the display-only phone fallback. One assembly point =
    // the queue card can never show a phone the boards blank, or vice versa.
    const disp = displayShopFor(p, t.repairPhone);
    it.contextChips = {
      effStatus: disp?.effStatus ?? null,
      openPoDate: disp?.shopPoDate ?? null,
      shopName: disp?.shopName ?? null,
      shopPhone: disp?.shopPhone ?? null,
      portalAt: disp?.portalAt ?? null,
      lastLucaOutcome: t.lastCallStatus ?? null,
      lastLucaDate: lastCall?.toISOString() ?? null,
      daysInRental: t.rentalStartDate ? daysSince(t.rentalStartDate) : null,
      shopPhoneLocked: p?.shopPhoneLocked === true,
      shopNameOverridden: p?.shopNameOverridden === true,
    };
    // What LUCA actually dialed vs. what we NOW believe is the shop of record.
    // A mismatch means the call outcome may describe the WRONG shop — the
    // human must verify shop info before acting on it (SOP for "shop does not
    // have truck"). Compared on phone digits and (case-folded) shop name;
    // missing values never flag.
    const dial = lucaDialedMap.get(`case:${canon(key)}`) ?? lucaDialedMap.get(`truck:${canon(t.truckNumber)}`) ?? null;
    it.lucaDialed = dial;
    if (dial) {
      const curPhone = phoneDigits(it.contextChips.shopPhone);
      const dialPhone = phoneDigits(dial.shopPhone);
      const phoneMismatch = !!curPhone && !!dialPhone && curPhone !== dialPhone;
      const curName = nameFold(it.contextChips.shopName);
      const dialName = nameFold(dial.shopName);
      const nameMismatch = !!curName && !!dialName && curName !== dialName;
      it.shopInfoMismatch = phoneMismatch || nameMismatch;
    }
  }

  // ── Spare-availability attach (needs_replacement rows only) ───────────────
  // Awaited AFTER the sync decoration pass so the pool query ran concurrently
  // with everything above; the race caps the added wait on a cold pool at 5s
  // (the queue's historic spare-lookup timeout). Skipped entirely when no row
  // needs it.
  const needsSpares = items.filter(it => !droppedIds.has(it.truckId) && (it.classifications ?? []).some(c => c.key === 'needs_replacement'));
  if (needsSpares.length > 0) {
    const SPARE_POOL_WAIT_MS = 5_000;
    const sparePool = await Promise.race([
      sparePoolPromise,
      new Promise<null>((resolve) => { const timer = setTimeout(() => resolve(null), SPARE_POOL_WAIT_MS); (timer as any).unref?.(); }),
    ]);
    // Districts differ in padding across sources (VRM identity vs Holman
    // cache) — compare digits-only, zero-stripped.
    const normDistrict = (s: string | null | undefined): string => String(s ?? '').trim().replace(/\D/g, '').replace(/^0+/, '');
    for (const it of needsSpares) {
      const district = it.caseKey ? districtByCase.get(it.caseKey) ?? null : null;
      const dNorm = normDistrict(district);
      if (sparePool) {
        const inDistrict = dNorm ? sparePool.vehicles.filter(v => normDistrict(v.district) === dNorm) : [];
        const inDistrictSet = new Set(inDistrict);
        const candidates = [...inDistrict, ...sparePool.vehicles.filter(v => !inDistrictSet.has(v))]
          .slice(0, 3)
          .map(v => v.truckNumber);
        it.spareAvailability = {
          district: (district ?? '').trim() || null,
          districtCount: dNorm ? inDistrict.length : null,
          totalCount: sparePool.vehicles.length,
          candidates,
        };
      }
      // Lane/action text only when locating a spare is the ONLY work on the
      // row — never touch rows that also carry ams_status_conflict,
      // retrieval_pending, etc. (their step/lane semantics stand).
      const only = (it.classifications ?? []).length === 1 && it.classifications![0].key === 'needs_replacement';
      if (!only) continue;
      const sa = it.spareAvailability;
      if (sa && sa.totalCount > 0) {
        it.lane = 'action';
        const where = sa.districtCount != null && sa.districtCount > 0
          ? `${sa.districtCount} unassigned spare${sa.districtCount === 1 ? '' : 's'} in district ${sa.district}`
          : `${sa.totalCount} unassigned spare${sa.totalCount === 1 ? '' : 's'} fleet-wide${sa.district ? ` (none in district ${sa.district} yet)` : ''}`;
        it.actionText = `Spare available — ${where}. Pick a candidate and start the assignment in Spares.`;
      } else {
        it.lane = 'monitor';
        it.actionText = sa
          ? 'No unassigned spares right now — monitoring; assign one as soon as a unit frees up.'
          : 'Spare lookup unavailable right now — monitoring; check the Spares page directly.';
      }
    }
  }

  // First-seen anchors for classifications with no event date of their own —
  // fire-and-forget (a lost write degrades to a clock reset on rebuild, never
  // a 500; readers take MIN(created_at) so duplicates are harmless).
  if (anchorSeeds.length > 0) {
    const day = todayET;
    const values = anchorSeeds.map(s =>
      sql`(${s.key}, 'classification_observed', ${JSON.stringify({ classification: s.classification, day })}::jsonb, 'system:queue')`);
    db.execute(sql`
      INSERT INTO vrm_rental_operation_actions (case_key, action_type, payload, actor)
      VALUES ${sql.join(values, sql`, `)}
    `).catch((e: any) => console.warn('[Queue] classification_observed seed failed:', e?.message || e));
  }

  // Drop the declined/auction dead-ends from the actionable list — they were
  // pushed by the step logic but classified to nothing (no queue work today).
  // Attach registration context to every card whose truck has live tag work —
  // step 6 obviously, but ALSO e.g. a Scheduling truck with an expired sticker,
  // so pickup isn't dispatched blind to a dead tag.
  for (const it of items) {
    const ctx = regCtxByCanon.get(canonReg(it.truckNumber));
    if (ctx?.tagsNeeded) it.registration = ctx;
  }

  const visibleItems = items.filter(it => !droppedIds.has(it.truckId));

  // Per-owner rollup (all roster owners always present, zero-filled; manual
  // off-roster owners appended as encountered).
  const bucketMap = new Map<string, OwnerBucket>();
  for (const o of OWNER_ROSTER) bucketMap.set(o, { owner: o, open: 0, dueToday: 0, overdue: 0, needsRouting: 0 });
  for (const it of visibleItems) {
    const owner = it.owner ?? '';
    if (!owner) continue;
    let b = bucketMap.get(owner);
    if (!b) { b = { owner, open: 0, dueToday: 0, overdue: 0, needsRouting: 0 }; bucketMap.set(owner, b); }
    if (!it.dismissedToday) b.open++;
    if ((it.classifications ?? []).some(c => c.slaDueDate === todayET)) b.dueToday++;
    if ((it.classifications ?? []).some(c => c.businessDaysLate > 0)) b.overdue++;
    if (it.needsRouting) b.needsRouting++;
  }

  // Work-type bucket rollup, keyed off each item's server-stamped workBucket
  // (claim rules in workBucketForItem — an item lives in exactly ONE bucket;
  // both UIs group by the same field, so counts can never drift between
  // surfaces). The two featured buckets are always present so their zero
  // states still render. Ready is pinned first among featured.
  const workMap = new Map<string, WorkTypeBucket>();
  const ensureWorkBucket = (wkey: string): WorkTypeBucket => {
    let b = workMap.get(wkey);
    if (!b) {
      const def = CLASSIFICATION_BY_KEY.get(wkey);
      const feat = FEATURED_WORK_BUCKETS[wkey];
      b = {
        key: wkey,
        label: feat?.label ?? def?.label ?? "Other / unclassified",
        priority: def?.priority ?? 4,
        open: 0,
        dismissed: 0,
        featured: !!feat,
        description: feat?.description ?? null,
      };
      workMap.set(wkey, b);
    }
    return b;
  };
  for (const wkey of Object.keys(FEATURED_WORK_BUCKETS)) ensureWorkBucket(wkey);
  for (const it of visibleItems) {
    const wkey = it.workBucket ?? it.classifications?.[0]?.key;
    if (!wkey) continue;
    const b = ensureWorkBucket(wkey);
    if (it.dismissedToday) b.dismissed++; else b.open++;
  }
  const featIdx = (k: string) => {
    const i = FEATURED_ORDER.indexOf(k);
    return i === -1 ? 99 : i;
  };
  const workTypeBuckets = Array.from(workMap.values()).sort((a, b) =>
    (Number(b.featured) - Number(a.featured)) ||
    (featIdx(a.key) - featIdx(b.key)) ||
    (a.priority - b.priority) ||
    ((b.open + b.dismissed) - (a.open + a.dismissed)) ||
    a.label.localeCompare(b.label));

  // --- NO ACTION REQUIRED ---
  // Reasoned dead-ends first (sold/declined cases with nothing to action),
  // then trucks no step claimed at all.
  const noAction: NoActionItem[] = [
    ...noActionExtras,
    ...allTrucks
      .filter(t => !assigned.has(t.id))
      .map(t => ({
        truckId: t.id,
        truckNumber: t.truckNumber,
        techName: t.techName ?? null,
        fleetScopeStatus: t.mainStatus ?? '',
        holmanStatus: getHolmanStatus(t.truckNumber),
        caseKey: caseKeyByCanon.get(canon(t.truckNumber)) ?? null,
      })),
  ];

  const tEnd = Date.now();
  console.log(
    `[Queue] built in ${tEnd - tStart}ms ` +
    `(base ${tBase - tStart} [trucks ${baseMs.trucks ?? 0} po ${baseMs.po ?? 0} wb ${baseMs.wb ?? 0}], ` +
    `fs ${tFs - tBase}, vrm ${tVrm - tFs}, ` +
    `steps ${tSteps - tVrm}, decorate ${tEnd - tSteps})`,
  );

  return {
    success: true,
    items: visibleItems,
    noAction,
    buckets: Array.from(bucketMap.values()),
    workTypeBuckets,
    classificationDefs: CLASSIFICATIONS,
    generatedAt: new Date().toISOString(),
  };
}

// ── Short-TTL result cache ───────────────────────────────────────────────────
// The queue is rebuilt from ~12 queries on every GET, and
// two routes serve the same payload (VRM Ops Queue + the FS read-only mirror).
// A 30s TTL absorbs navigation and the settling refetches after each mutation
// while staying fresh enough for ops work; the queue mutation routes bust it
// explicitly so a client's refetch right after a write always sees that write.
// Scheduler-driven data drift (LUCA write-back, rental sync) rides the TTL.
const QUEUE_CACHE_TTL_MS = 30_000;
let queueCacheEpoch = 0;
let queueCache: { at: number; value: TodaysQueue } | null = null;
let queueInflight: Promise<TodaysQueue> | null = null;

export function invalidateTodaysQueueCache(reason: string): void {
  queueCacheEpoch++;
  queueCache = null;
  // Detach any in-flight build: it started before this write and could cache
  // pre-write data. Its awaiting callers still get a (marginally stale)
  // response; the next GET rebuilds fresh.
  queueInflight = null;
  console.log(`[Queue] cache invalidated (${reason})`);
}

export async function getTodaysQueueCached(): Promise<TodaysQueue> {
  if (queueCache && Date.now() - queueCache.at < QUEUE_CACHE_TTL_MS) return queueCache.value;
  if (queueInflight) return queueInflight;
  const epoch = queueCacheEpoch;
  const promise = buildTodaysQueue()
    .then((value) => {
      if (epoch === queueCacheEpoch) queueCache = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      if (queueInflight === promise) queueInflight = null;
    });
  queueInflight = promise;
  return promise;
}
