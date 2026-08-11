/**
 * Registration / tags context for rental cases — "is a tag renewal the real
 * blocker, and whose move is it?"
 *
 * Tyler (2026-08-10): when a rental case is parked because the van needs
 * tags, the card must SAY so — with the actual blocker (Holman's renewal
 * case + pending-task note) laid out — so nobody wastes effort calling the
 * tech about a repair when the van is waiting on registration paperwork.
 * And when the tag work DOES need the tech (emissions run, documents,
 * installing mailed tags), the card must say that too, so the tech is
 * looped in instead of discovered late.
 *
 * Nexus already tracks all of this in three layers; this module is the ONE
 * assembly point (per the shop-of-record precedent: every surface shows the
 * same server-reconciled pick):
 *   1. fs_registration_tracking — the Registrations-tab workbench: renewal
 *      pipeline step, Holman case status, Holman's verbatim pending-task
 *      note, ETA, received-tags flag. Truck numbers are stored PADDED
 *      ("061309"), so matching is canonical-digits on both sides.
 *   2. fs_trucks registration fields — sticker state ("Yes"/"Expired"/
 *      workflow notes like "Contacted tech"), Have-Tags date, and the
 *      office-workflow booleans (tags in office / sent to tech / awaiting
 *      tech documents / renewal started).
 *   3. holman_vehicles_cache.reg_renewal_date — Holman's renewal date feed.
 *
 * Display-only: nothing here writes. The context is attached to queue items
 * (todays-queue) and the case detail payload; staleness is surfaced, never
 * hidden — fs_registration_tracking rows can be months old, and acting on a
 * stale "Rejected" is exactly the wasted effort this exists to prevent.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";

/** Canonical truck key: digits only, leading zeros stripped ("061309" → "61309"). */
export const canonReg = (s: unknown): string =>
  String(s ?? "").replace(/\D/g, "").replace(/^0+/, "");

/** fs_trucks registration signals (subset of the truck row). */
export interface FsRegSignals {
  registrationStickerValid?: string | null;
  registrationExpiryDate?: string | null; // "Have Tags" date (text)
  registrationLastUpdate?: string | null; // text date, best-effort parse
  tagsInOffice?: boolean | null;
  tagsSentToTech?: boolean | null;
  awaitingTechDocuments?: boolean | null;
  renewalProcessStarted?: boolean | null;
  registrationInProgress?: boolean | null;
}

/** fs_registration_tracking signals (subset of the workbench row). */
export interface TrackingSignals {
  currentStep?: string | null; // "New" | "Prerequisites" | "Sent to State" | "Rejected" | "Complete"
  renewalDate?: string | null;
  etaDate?: string | null;
  holmanCaseStatus?: string | null;
  holmanPendingTasks?: string | null;
  holmanEta?: string | null;
  holmanReceivedTags?: boolean | null;
  initialTextSent?: boolean | null;
  updatedAt?: Date | string | null;
  lastScraped?: Date | string | null;
}

/**
 * Which of two tracking rows for the same truck is fresher? Legacy duplicate
 * rows can have a null/older updated_at but a newer last_scraped, so recency
 * is the max of BOTH timestamps. Deterministic tie-break: keep `prev` unless
 * the candidate has a Holman case status and prev does not (more signal wins;
 * DB result order must never decide).
 */
export function pickNewerTracking(prev: TrackingSignals, cand: TrackingSignals): TrackingSignals {
  const recency = (t: TrackingSignals) => Math.max(
    parseWhen(t.updatedAt ?? null) ?? -1,
    parseWhen(t.lastScraped ?? null) ?? -1,
  );
  const a = recency(cand), b = recency(prev);
  if (a > b) return cand;
  if (a === b && !!cand.holmanCaseStatus && !prev.holmanCaseStatus) return cand;
  return prev;
}

export interface RegistrationTechAction {
  /** true = the tech has a required move; false = do NOT chase the tech for this. */
  required: boolean;
  /** Plain-language whose-move-it-is line for the card. */
  summary: string;
}

export interface RegistrationContext {
  /** Registration/tags work is live for this truck (drives whether UIs render the block). */
  tagsNeeded: boolean;
  /** AMS/fleet says the van is declined or sent to auction — tag status is
   *  irrelevant for the case, so tagsNeeded is forced false (Tyler 2026-08-11). */
  suppressedByDisposal: boolean;
  sticker: string | null;
  haveTagsDate: string | null;
  renewalDate: string | null; // tracking wins, Holman feed fallback
  renewalStep: string | null;
  holmanCaseStatus: string | null;
  /** Holman's verbatim pending-task note — the actual blocker text. */
  blockerNote: string | null;
  eta: string | null;
  tagsInOffice: boolean;
  tagsSentToTech: boolean;
  holmanReceivedTags: boolean | null;
  awaitingTechDocuments: boolean;
  techAction: RegistrationTechAction;
  /** Newest signal timestamp (ISO) — null when nothing is dated. */
  asOf: string | null;
  /** No dated signal, or the newest one is older than 30 days. */
  stale: boolean;
}

const STALE_AFTER_DAYS = 30;

const parseWhen = (v: Date | string | null | undefined): number | null => {
  if (v == null || v === "") return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
};

/** Blocker notes that mean the VAN itself must do something (tech or the shop holding it). */
const VAN_ACTION_RE = /emission|smog|inspection|vin\s*verif|odometer|weigh/i;

const OPEN_STEPS = new Set(["new", "prerequisites", "sent to state", "rejected"]);

export function deriveRegistrationContext(args: {
  mainStatus?: string | null;
  /** Case van is declined / sent to auction (AMS bucket declined|auction, or
   *  the fleet terminal pair). AMS is terminal authority — this suppresses
   *  the tag block entirely. */
  disposal?: boolean | null;
  fs?: FsRegSignals | null;
  tracking?: TrackingSignals | null;
  holmanRenewalDate?: string | null;
  now?: Date;
}): RegistrationContext {
  const fs = args.fs ?? {};
  const tr = args.tracking ?? {};
  const now = args.now ?? new Date();

  const sticker = fs.registrationStickerValid?.trim() || null;
  const stickerBad = !!sticker && /expired|no\s|not\s/i.test(sticker) && !/^yes$/i.test(sticker);
  const renewalStep = tr.currentStep?.trim() || null;
  const holmanCaseStatus = tr.holmanCaseStatus?.trim() || null;
  const blockerNote = tr.holmanPendingTasks?.trim() || null;
  const stepOpen = !!renewalStep && OPEN_STEPS.has(renewalStep.toLowerCase());
  const caseOpen = !!holmanCaseStatus && !/complete|closed|approved/i.test(holmanCaseStatus);
  const tagsInOffice = fs.tagsInOffice === true;
  const tagsSentToTech = fs.tagsSentToTech === true;
  const awaitingTechDocuments = fs.awaitingTechDocuments === true;

  // Live tag WORK, not a live renewal CASE: every truck cycles through a
  // renewal yearly, so a routine in-flight case ("Sent to State", "Preparing
  // Paperwork" with no pending task) must NOT badge the card — 137 of 353
  // queue cards lit up amber on the first cut. The block earns its place only
  // when something is stuck (rejected / pending-task note), non-compliant
  // (bad sticker), or mid-handoff with the tech/office (tags moving, docs
  // owed, waiting on the tech's reply) — or the case is parked on "Tags".
  const rejected = /reject/i.test(holmanCaseStatus ?? "") || /reject/i.test(renewalStep ?? "");
  const contactedTech = !!sticker && /contacted tech/i.test(sticker);
  const tagsNeeded =
    (args.mainStatus ?? "") === "Tags" ||
    stickerBad ||
    rejected ||
    !!blockerNote ||
    tagsInOffice ||
    tagsSentToTech ||
    awaitingTechDocuments ||
    contactedTech;

  // AMS is terminal authority (user directives 2026-08-07 / 2026-08-11): a van
  // that is declined or sent to auction is never getting its tags chased — the
  // tag status is irrelevant to the case no matter what the renewal data says,
  // so the block must not render at all.
  const suppressedByDisposal = args.disposal === true;

  // Whose move is it? First match wins; every branch is deliberately
  // explainable in one sentence (these lines render verbatim on cards).
  let techAction: RegistrationTechAction;
  if (awaitingTechDocuments) {
    techAction = { required: true, summary: "Tech must send the inspection/registration documents — renewal is waiting on them." };
  } else if (blockerNote && VAN_ACTION_RE.test(blockerNote)) {
    techAction = { required: true, summary: "The van itself must complete this (see Holman's note) — coordinate with whoever has the van: the shop if it's still there, otherwise the tech." };
  } else if (tagsSentToTech) {
    techAction = { required: true, summary: "Tags were mailed to the tech — confirm they arrived and are on the van." };
  } else if (sticker && /contacted tech/i.test(sticker)) {
    techAction = { required: true, summary: "Waiting on the tech's reply about the sticker — follow up with the tech." };
  } else if (tagsInOffice) {
    techAction = { required: false, summary: "Office already has the tags — they need to be mailed/handed to the tech. No tech action yet." };
  } else if (renewalStep && /sent to state/i.test(renewalStep)) {
    techAction = { required: false, summary: "Renewal is with the state — nothing for the tech to do." };
  } else if (blockerNote || stepOpen || caseOpen) {
    techAction = { required: false, summary: "Renewal is stuck on the Holman/office side — no tech action needed." };
  } else {
    techAction = { required: false, summary: "No tech step on file — work the renewal with the office/Holman." };
  }
  if (suppressedByDisposal) {
    techAction = { required: false, summary: "Van is declined / sent to auction per AMS — tag status is irrelevant for this case." };
  }

  const times = [
    parseWhen(tr.updatedAt ?? null),
    parseWhen(tr.lastScraped ?? null),
    parseWhen(fs.registrationLastUpdate ?? null),
  ].filter((t): t is number => t != null);
  const asOfMs = times.length ? Math.max(...times) : null;
  const stale = asOfMs == null || now.getTime() - asOfMs > STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;

  return {
    tagsNeeded: suppressedByDisposal ? false : tagsNeeded,
    suppressedByDisposal,
    sticker,
    haveTagsDate: fs.registrationExpiryDate?.trim() || null,
    renewalDate: tr.renewalDate?.trim() || args.holmanRenewalDate?.trim() || null,
    renewalStep,
    holmanCaseStatus,
    blockerNote,
    eta: tr.holmanEta?.trim() || tr.etaDate?.trim() || null,
    tagsInOffice,
    tagsSentToTech,
    holmanReceivedTags: tr.holmanReceivedTags ?? null,
    awaitingTechDocuments,
    techAction,
    asOf: asOfMs != null ? new Date(asOfMs).toISOString() : null,
    stale,
  };
}

/**
 * Batch-fetch contexts for a set of trucks. Pass fs signals when the caller
 * already holds the fs_trucks row (todays-queue does); trucks without them
 * get a targeted fs_trucks read. Matching is canonical-digits on every side
 * (tracking rows are padded, holman cache numbers vary).
 */
export async function fetchRegistrationContextMap(
  trucks: Array<{ truckNumber: string; mainStatus?: string | null; disposal?: boolean | null; fs?: FsRegSignals | null }>,
  now?: Date,
): Promise<Map<string, RegistrationContext>> {
  const out = new Map<string, RegistrationContext>();
  const byCanon = new Map<string, { truckNumber: string; mainStatus?: string | null; disposal?: boolean | null; fs?: FsRegSignals | null }>();
  for (const t of trucks) {
    const c = canonReg(t.truckNumber);
    if (c) byCanon.set(c, t);
  }
  const canons = [...byCanon.keys()];
  if (!canons.length) return out;

  const inList = sql.join(canons.map((c) => sql`${c}`), sql`, `);
  const canonExpr = (col: string) => sql.raw(`ltrim(regexp_replace(${col}, '[^0-9]', '', 'g'), '0')`);

  const needFs = canons.filter((c) => byCanon.get(c)!.fs == null);
  const [trackRes, holmanRes, fsRes] = await Promise.all([
    db.execute(sql`
      SELECT truck_number, current_step, renewal_date, eta_date, holman_case_status,
             holman_pending_tasks, holman_eta, holman_received_tags, initial_text_sent,
             updated_at, last_scraped
      FROM fs_registration_tracking
      WHERE ${canonExpr("truck_number")} IN (${inList})`),
    db.execute(sql`
      SELECT vehicle_number_display, holman_vehicle_number, reg_renewal_date
      FROM holman_vehicles_cache
      WHERE ${canonExpr("vehicle_number_display")} IN (${inList})
         OR ${canonExpr("holman_vehicle_number")} IN (${inList})`),
    needFs.length
      ? db.execute(sql`
          SELECT truck_number, registration_sticker_valid, registration_expiry_date,
                 registration_last_update, tags_in_office, tags_sent_to_tech,
                 awaiting_tech_documents, renewal_process_started, registration_in_progress,
                 main_status
          FROM fs_trucks
          WHERE ${canonExpr("truck_number")} IN (${sql.join(needFs.map((c) => sql`${c}`), sql`, `)})`)
      : Promise.resolve({ rows: [] as any[] }),
  ]);

  const trackBy = new Map<string, TrackingSignals>();
  for (const r of trackRes.rows as any[]) {
    // Newest row wins if legacy duplicate-format rows exist for one canonical.
    const c = canonReg(r.truck_number);
    const cand: TrackingSignals = {
      currentStep: r.current_step, renewalDate: r.renewal_date, etaDate: r.eta_date,
      holmanCaseStatus: r.holman_case_status, holmanPendingTasks: r.holman_pending_tasks,
      holmanEta: r.holman_eta, holmanReceivedTags: r.holman_received_tags,
      initialTextSent: r.initial_text_sent, updatedAt: r.updated_at, lastScraped: r.last_scraped,
    };
    const prev = trackBy.get(c);
    if (!prev || pickNewerTracking(prev, cand) === cand) trackBy.set(c, cand);
  }
  const holmanBy = new Map<string, string | null>();
  for (const r of holmanRes.rows as any[]) {
    // A row can match the queue truck via EITHER number column — map it under
    // both canonical keys so the renewal date is found regardless of which
    // side matched. Never clobber a real date with null.
    const val = r.reg_renewal_date ?? null;
    for (const key of [r.vehicle_number_display, r.holman_vehicle_number]) {
      const c = canonReg(key);
      if (!c) continue;
      if (!holmanBy.has(c) || (holmanBy.get(c) == null && val != null)) holmanBy.set(c, val);
    }
  }
  const fsBy = new Map<string, { fs: FsRegSignals; mainStatus: string | null }>();
  for (const r of (fsRes as any).rows as any[]) {
    fsBy.set(canonReg(r.truck_number), {
      mainStatus: r.main_status ?? null,
      fs: {
        registrationStickerValid: r.registration_sticker_valid,
        registrationExpiryDate: r.registration_expiry_date,
        registrationLastUpdate: r.registration_last_update,
        tagsInOffice: r.tags_in_office,
        tagsSentToTech: r.tags_sent_to_tech,
        awaitingTechDocuments: r.awaiting_tech_documents,
        renewalProcessStarted: r.renewal_process_started,
        registrationInProgress: r.registration_in_progress,
      },
    });
  }

  for (const [c, t] of byCanon) {
    const fromDb = fsBy.get(c);
    out.set(c, deriveRegistrationContext({
      mainStatus: t.mainStatus ?? fromDb?.mainStatus ?? null,
      disposal: t.disposal ?? null,
      fs: t.fs ?? fromDb?.fs ?? null,
      tracking: trackBy.get(c) ?? null,
      holmanRenewalDate: holmanBy.get(c) ?? null,
      now,
    }));
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Call-ready vehicle identity (Tyler 2026-08-11): if we ever have to call the
// DMV / Holman / a shop ourselves we need the van's license plate + VIN on
// screen for EVERY truck in the case — the rental van and the assigned truck
// alike, whichever is selected. Source: holman_vehicles_cache (the Holman
// feed) — the only table with full-fleet plate/VIN coverage. Same canonical
// digit matching + dual-number-column rules as the registration fetch above.

export interface VehicleIdentity {
  /** Canonical truck digits (non-digits stripped, leading zeros trimmed). */
  truck: string;
  plate: string | null;
  plateState: string | null;
  vin: string | null;
}

/** Null-filling merge: a real value is NEVER clobbered by a later null/blank —
 * the Holman cache can hold the same van under both number columns (legacy
 * dup formats) and only one row may carry the plate. Exported for tests. */
export function mergeIdentity(
  base: VehicleIdentity,
  cand: { plate?: string | null; plateState?: string | null; vin?: string | null },
): VehicleIdentity {
  const pick = (cur: string | null, next?: string | null) => {
    if (cur != null && cur !== "") return cur;
    const v = String(next ?? "").trim();
    return v ? v : null;
  };
  return {
    truck: base.truck,
    plate: pick(base.plate, cand.plate),
    plateState: pick(base.plateState, cand.plateState),
    vin: pick(base.vin, cand.vin),
  };
}

export async function fetchVehicleIdentityMap(
  truckNumbers: Array<string | null | undefined>,
): Promise<Map<string, VehicleIdentity>> {
  const out = new Map<string, VehicleIdentity>();
  const canons = [...new Set(truckNumbers.map((t) => canonReg(t ?? "")).filter(Boolean))];
  if (!canons.length) return out;
  const inList = sql.join(canons.map((c) => sql`${c}`), sql`, `);
  const canonExpr = (col: string) => sql.raw(`ltrim(regexp_replace(${col}, '[^0-9]', '', 'g'), '0')`);
  const res = await db.execute(sql`
    SELECT vehicle_number_display, holman_vehicle_number, license_plate, license_state, vin
    FROM holman_vehicles_cache
    WHERE ${canonExpr("vehicle_number_display")} IN (${inList})
       OR ${canonExpr("holman_vehicle_number")} IN (${inList})`);
  const want = new Set(canons);
  for (const r of (res.rows ?? []) as any[]) {
    for (const rawKey of [r.vehicle_number_display, r.holman_vehicle_number]) {
      const key = canonReg(rawKey ?? "");
      if (!key || !want.has(key)) continue;
      const prev = out.get(key) ?? { truck: key, plate: null, plateState: null, vin: null };
      out.set(key, mergeIdentity(prev, { plate: r.license_plate, plateState: r.license_state, vin: r.vin }));
    }
  }
  return out;
}
