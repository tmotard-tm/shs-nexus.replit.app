/**
 * Task #638 — post-create read-back verification + phantom-row detection.
 *
 * Pure, dependency-free decision core. `server/vehicle-create-verification-service.ts`
 * performs the IO (Holman/WMS/TPMS reads, DB writes) and feeds the observations in
 * here; every "did this vehicle actually land / is this cache row a phantom" branch
 * lives in this file so it can be tested without a database or an external system.
 *
 * Design rules encoded here:
 *  - Holman's submit is a QUEUE RECEIPT, never proof the record exists. Only a live
 *    read-back resolves an attempt.
 *  - A read-back that could not complete is `indeterminate`, never "missing". We
 *    release a reserved vehicle number only on positive evidence of absence.
 *  - AMS is deliberately NOT a verified system: AMS records are written by a
 *    downstream background sync roughly 24 hours after the Holman record exists, so
 *    a newly created vehicle is EXPECTED to be absent from AMS. See
 *    `NON_VERIFIED_SYSTEMS`.
 */

// ── Systems ──────────────────────────────────────────────────────────────────

/** Systems the create fan-out writes to, and therefore the systems we read back. */
export const VERIFIED_SYSTEMS = ["holman", "wms", "tpms"] as const;
export type SystemName = (typeof VERIFIED_SYSTEMS)[number];

/**
 * Systems that must NEVER be verified or reconciled by this flow. AMS is populated
 * by a downstream background sync ~24h after the Holman record exists; treating its
 * absence as a gap would fail every fresh create, and creating an AMS record here is
 * explicitly out of scope.
 */
export const NON_VERIFIED_SYSTEMS = ["ams"] as const;

export function isVerifiedSystem(name: string): name is SystemName {
  return (VERIFIED_SYSTEMS as readonly string[]).indexOf(String(name).toLowerCase()) !== -1;
}

// ── Read-back window ─────────────────────────────────────────────────────────

/** How long we keep re-reading before giving up on an unresolved attempt. */
export const VERIFICATION_WINDOW_MS = 30 * 60 * 1000;
/** Hard cap on read-back attempts inside that window. */
export const VERIFICATION_MAX_ATTEMPTS = 5;
/**
 * How long after the create a locally cached vehicle is allowed to be invisible in
 * live Holman before it counts as a phantom. Covers Holman's async apply plus the
 * nightly sync lag.
 */
export const PHANTOM_GRACE_MS = 24 * 60 * 60 * 1000;

// ── Read-back resolution ─────────────────────────────────────────────────────

export interface ReadBackProbe {
  /** Did the create actually target this system? Untargeted systems are ignored. */
  attempted: boolean;
  /** false = the read-back itself failed (outage, auth, timeout) — NOT "absent". */
  checked: boolean;
  found: boolean;
  detail?: string;
}

export type CreateVerificationState =
  /** Still inside the read-back window — try again. */
  | "pending"
  /** Every targeted system read back as present. */
  | "confirmed"
  /** Present in some targeted systems, absent from others. */
  | "partial"
  /** Positively absent everywhere it was targeted — the create did not land. */
  | "failed"
  /** The window closed without a conclusive read — we still do not know. */
  | "unverified";

export interface VerificationResolution {
  state: CreateVerificationState;
  /** Should the caller schedule another read-back? */
  retry: boolean;
  /** Should the reserved vehicle number be released back into circulation? */
  releaseNumber: boolean;
  present: SystemName[];
  missing: SystemName[];
  indeterminate: SystemName[];
  detail: string;
}

const label = (list: string[]) => list.join(", ");

/**
 * Resolve one round of post-create read-back.
 *
 * Only systems the create targeted are considered. A system that answered "absent"
 * is `missing`; a system whose read-back failed is `indeterminate` and can never
 * produce a `failed` verdict — we do not free a vehicle number on an outage.
 */
export function resolveCreateVerification(args: {
  probes: Partial<Record<SystemName, ReadBackProbe>>;
  /** 1-based number of the read-back attempt that just completed. */
  attemptNumber: number;
  maxAttempts?: number;
  /** Time since the submission. */
  elapsedMs: number;
  windowMs?: number;
}): VerificationResolution {
  const maxAttempts = args.maxAttempts ?? VERIFICATION_MAX_ATTEMPTS;
  const windowMs = args.windowMs ?? VERIFICATION_WINDOW_MS;

  const present: SystemName[] = [];
  const missing: SystemName[] = [];
  const indeterminate: SystemName[] = [];

  for (const name of VERIFIED_SYSTEMS) {
    const probe = args.probes[name];
    if (!probe || !probe.attempted) continue;
    if (!probe.checked) indeterminate.push(name);
    else if (probe.found) present.push(name);
    else missing.push(name);
  }

  const targeted = present.length + missing.length + indeterminate.length;
  if (targeted === 0) {
    return {
      state: "unverified",
      retry: false,
      releaseNumber: false,
      present,
      missing,
      indeterminate,
      detail: "No systems were targeted by this create — there is nothing to verify.",
    };
  }

  if (missing.length === 0 && indeterminate.length === 0) {
    return {
      state: "confirmed",
      retry: false,
      releaseNumber: false,
      present,
      missing,
      indeterminate,
      detail: `Confirmed by live read-back in ${label(present)}.`,
    };
  }

  const windowOpen = args.attemptNumber < maxAttempts && args.elapsedMs < windowMs;
  if (windowOpen) {
    const waitingFor = missing.concat(indeterminate);
    return {
      state: "pending",
      retry: true,
      releaseNumber: false,
      present,
      missing,
      indeterminate,
      detail:
        `Attempt ${args.attemptNumber} of ${maxAttempts}: still waiting on ${label(waitingFor)}` +
        (present.length ? ` (confirmed in ${label(present)})` : "") +
        ". Holman applies submissions asynchronously.",
    };
  }

  // Window closed — decide on the evidence we have.
  if (missing.length === 0) {
    return {
      state: "unverified",
      retry: false,
      releaseNumber: false,
      present,
      missing,
      indeterminate,
      detail:
        `Read-back window closed without an answer from ${label(indeterminate)}` +
        (present.length ? ` (confirmed in ${label(present)})` : "") +
        ". The vehicle number stays reserved — absence was never proven.",
    };
  }

  if (present.length === 0 && indeterminate.length === 0) {
    return {
      state: "failed",
      retry: false,
      releaseNumber: true,
      present,
      missing,
      indeterminate,
      detail: `Not present in ${label(missing)} after the read-back window — the create did not land. Vehicle number released.`,
    };
  }

  return {
    state: "partial",
    retry: false,
    releaseNumber: false,
    present,
    missing,
    indeterminate,
    detail: present.length
      ? `Partially created: present in ${label(present)}, absent from ${label(missing)}` +
        (indeterminate.length ? ` (no answer from ${label(indeterminate)})` : "") +
        ". The number stays reserved; the surviving records need a human decision."
      : // Nothing was actually observed as present — never claim it was.
        `Absent from ${label(missing)}, with no answer from ${label(indeterminate)}. ` +
        "Absence was not proven everywhere, so the number stays reserved until every system answers.",
  };
}

// ── Releasing a reservation when the create finishes ─────────────────────────

/**
 * Decides, at the end of the create fan-out, whether the reserved number and VIN
 * may be released — and whether the attempt needs a read-back.
 *
 * The trap this closes: an immediate result flag of `false` does NOT mean the
 * vehicle was not created. A 5xx, a socket timeout or a proxy kill AFTER the
 * request went on the wire is indistinguishable, from here, from a clean refusal
 * — and Holman applies submissions asynchronously in any case. Releasing on that
 * evidence puts a possibly-real vehicle's number and VIN straight back into the
 * allocator, which is the phantom/duplicate failure this whole task exists to
 * prevent.
 *
 * So the discriminator is not success, it is whether a request ever REACHED a
 * system that creates vehicle records (`*_submitted_at`, stamped by the guarded
 * submit helpers at the moment of the call). If one did, the reservation is held
 * and the read-back decides. Only when nothing was ever submitted — the gate
 * refused, or every leg failed before the wire — can nothing land later, and only
 * then is an immediate release safe.
 */
export function decideFinalizeRelease(args: {
  holmanSubmittedAt?: Date | string | null;
  wmsSubmittedAt?: Date | string | null;
  holmanSuccess?: boolean | null;
  wmsSuccess?: boolean | null;
  holmanPending?: boolean | null;
}): { release: boolean; verify: boolean; reason: string } {
  const submitted = !!args.holmanSubmittedAt || !!args.wmsSubmittedAt;
  const succeeded = !!args.holmanSuccess || !!args.wmsSuccess;
  const pending = !!args.holmanPending;

  if (succeeded) {
    return {
      release: false,
      verify: true,
      reason: "A system reported the vehicle created — the reservation is held and the create is read back to confirm it.",
    };
  }
  if (pending) {
    return {
      release: false,
      verify: true,
      reason: "Holman accepted the submission but has not applied it yet — the reservation is held until read-back.",
    };
  }
  if (submitted) {
    return {
      release: false,
      verify: true,
      reason:
        "A create request reached Holman or WMS and then errored. The error may be transport-level, so the vehicle may exist. " +
        "The reservation is held until a read-back proves the vehicle is absent from every targeted system.",
    };
  }
  return {
    release: true,
    verify: false,
    reason: "Nothing was ever submitted to a system that creates vehicles, so nothing can land later — the number is safe to release.",
  };
}

// ── Reservation reclaim ──────────────────────────────────────────────────────

/**
 * A create can be released and *then* turn out to have landed: Holman's queue can
 * apply a submission after our read-back window closed, and an administrator can
 * re-verify a failed attempt afterwards. The release convention (`blocked_source =
 * 'failed'`) drops the row out of the partial unique indexes on vehicle number and
 * VIN — both are `WHERE blocked_source IS NULL` — so leaving a now-CONFIRMED row
 * released would hand a real vehicle's number and VIN back to the allocator.
 *
 * This decides whether such a row must reclaim its reservation. Only a release this
 * verification flow itself performed ('failed') is reclaimable: every other
 * `blocked_source` (a pre-submission refusal, a duplicate gate, a manual block) was
 * set by a path that never submitted the vehicle, and must not be silently undone.
 */
export function decideReservationReclaim(args: {
  state: CreateVerificationState;
  blockedSource: string | null | undefined;
}): { reclaim: boolean; reason: string } {
  if (args.state !== "confirmed") {
    return { reclaim: false, reason: "Only a confirmed create can reclaim a reservation." };
  }
  const blocked = args.blockedSource == null ? null : String(args.blockedSource).toLowerCase();
  if (blocked === null) {
    return { reclaim: false, reason: "The reservation is already active — nothing to reclaim." };
  }
  if (blocked === "failed") {
    return {
      reclaim: true,
      reason:
        "A previous read-back released this number because the create looked lost, but the vehicle now exists. " +
        "The reservation must be reclaimed or the allocator will hand the same number and VIN out again.",
    };
  }
  return {
    reclaim: false,
    reason: `Blocked as '${blocked}' by a path that never submitted the vehicle — that block is not this flow's to undo.`,
  };
}

/**
 * The dangerous residue: a create confirmed as real whose number is still released,
 * because the reclaim above could not be performed (something else has claimed the
 * number or VIN in the meantime). It must stay visible to an administrator.
 */
export function isConfirmedButReleased(
  state: string | null | undefined,
  blockedSource: string | null | undefined,
): boolean {
  return (
    String(state ?? "").toLowerCase() === "confirmed" &&
    String(blockedSource ?? "").toLowerCase() === "failed"
  );
}

// ── Phantom cache-row detection ──────────────────────────────────────────────

export interface CacheRowSnapshot {
  vehicleNumber: string;
  /** 'holman' (written by a sync) or 'manual' (written by a local write-through). */
  dataSource: string | null;
  /** Non-null once a real Holman sync has ever returned this vehicle. */
  lastHolmanSyncAt: Date | string | number | null;
  createdAt: Date | string | number | null;
  updatedAt: Date | string | number | null;
}

export interface CreateAttemptSnapshot {
  id: number;
  submittedAt: Date | string | number | null;
  holmanSuccess: boolean;
  holmanPending?: boolean | null;
  verificationState?: string | null;
}

export type PhantomVerdict =
  /** Locally cached, absent from live Holman, traceable to a create — safe to purge. */
  | "phantom"
  /** Live Holman returned the vehicle — the row is real. */
  | "live-confirmed"
  /** A real Holman sync has seen this vehicle before; its absence now is a lifecycle
   *  change (disposal/transfer) for the sync to handle, not an optimistic create. */
  | "sync-confirmed"
  /** Too soon after the create to judge — Holman may still be applying it. */
  | "too-new"
  /** No create attempt behind this row — provenance unknown, leave it alone. */
  | "not-create-linked"
  /** The live check did not complete — we cannot judge, and never guess. */
  | "unverifiable";

export interface PhantomClassification {
  verdict: PhantomVerdict;
  reason: string;
  safeToPurge: boolean;
}

function toMs(v: Date | string | number | null | undefined): number | null {
  if (v == null) return null;
  const ms = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function newest(...vals: Array<Date | string | number | null | undefined>): number | null {
  let best: number | null = null;
  for (const v of vals) {
    const ms = toMs(v);
    if (ms == null) continue;
    if (best === null || ms > best) best = ms;
  }
  return best;
}

/**
 * Decide whether a locally cached Holman vehicle is a phantom left behind by an
 * optimistic create.
 *
 * Order matters and every branch is deliberately conservative — this feeds a
 * DELETE. Note what is NOT used: the shape of the vehicle number. Real, sync-confirmed
 * Holman numbers can be alphanumeric (`24024B`, `T0003`), so provenance columns are
 * the only safe discriminator.
 */
export function classifyPhantomCandidate(args: {
  row: CacheRowSnapshot;
  live: { checked: boolean; found: boolean; error?: string };
  createAttempt: CreateAttemptSnapshot | null;
  nowMs: number;
  graceMs?: number;
}): PhantomClassification {
  const graceMs = args.graceMs ?? PHANTOM_GRACE_MS;

  if (!args.live.checked) {
    return {
      verdict: "unverifiable",
      reason: `The live Holman check did not complete (${args.live.error || "lookup failed"}) — nothing is assumed.`,
      safeToPurge: false,
    };
  }

  if (args.live.found) {
    return {
      verdict: "live-confirmed",
      reason: "Live Holman returned this vehicle — the cached row is real.",
      safeToPurge: false,
    };
  }

  if (toMs(args.row.lastHolmanSyncAt) != null) {
    return {
      verdict: "sync-confirmed",
      reason:
        "A Holman sync has returned this vehicle before, so it was never an optimistic create. " +
        "Its absence now is a lifecycle change for the sync/reconciliation to resolve.",
      safeToPurge: false,
    };
  }

  if (!args.createAttempt) {
    return {
      verdict: "not-create-linked",
      reason: "No create attempt in the audit log matches this number — provenance unknown, left untouched.",
      safeToPurge: false,
    };
  }

  const lastEvidenceMs = newest(args.createAttempt.submittedAt, args.row.updatedAt, args.row.createdAt);
  const ageMs = lastEvidenceMs == null ? Number.POSITIVE_INFINITY : args.nowMs - lastEvidenceMs;
  if (ageMs < graceMs) {
    const hours = Math.max(0, Math.round(ageMs / 3600000));
    return {
      verdict: "too-new",
      reason:
        `Created ${hours}h ago — inside the ${Math.round(graceMs / 3600000)}h grace window. ` +
        "Holman may still be applying the submission and the cache may simply be ahead of the next sync.",
      safeToPurge: false,
    };
  }

  return {
    verdict: "phantom",
    reason:
      "Cached from a create that was never confirmed: absent from live Holman, never returned by a Holman sync, " +
      "and past the grace window. The row is holding a vehicle number that does not exist.",
    safeToPurge: true,
  };
}

// ── Admin-facing rollup ──────────────────────────────────────────────────────

export interface CreateVerificationCounts {
  confirmed: number;
  pending: number;
  failed: number;
  partial: number;
  unverified: number;
}

export function emptyVerificationCounts(): CreateVerificationCounts {
  return { confirmed: 0, pending: 0, failed: 0, partial: 0, unverified: 0 };
}

/** Roll a set of audit rows up into the counts the drift-check report shows. */
export function tallyVerificationStates(
  states: Array<string | null | undefined>,
): CreateVerificationCounts {
  const counts = emptyVerificationCounts();
  for (const raw of states) {
    const s = String(raw ?? "pending").toLowerCase();
    if (s === "confirmed") counts.confirmed++;
    else if (s === "failed") counts.failed++;
    else if (s === "partial") counts.partial++;
    else if (s === "unverified") counts.unverified++;
    else counts.pending++;
  }
  return counts;
}

/** Which states an administrator must act on. */
export function needsAttention(state: string | null | undefined): boolean {
  const s = String(state ?? "pending").toLowerCase();
  return s === "pending" || s === "failed" || s === "partial" || s === "unverified";
}
