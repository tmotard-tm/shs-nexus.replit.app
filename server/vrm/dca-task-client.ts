/**
 * Client for the Standard Activities Request Generator API
 * (a.k.a. "DCA Task" API). Used by the VRM module to file a Make Unavailable
 * request when a rental is denied, so the appropriate District Coordinator
 * Admin (DCA) is automatically notified and the tech is taken off route.
 *
 * Config (env, both required):
 *   EVENT_REQUEST_URL  – base URL of the API, e.g. https://your-app.replit.app
 *   DCA_TASK_API_TOKEN – Bearer token sent as `Authorization: Bearer ...`
 *
 * The receiving system routes to the correct DCA based on the tech's roster,
 * so we don't need to look up a DCA-by-district mapping locally. We just
 * persist the returned project `id` on the decision row so it can be used
 * later for a Quick Return (make_available) if the tech is approved again.
 */

const ENDPOINT_PATH = "/api/availability-request";

export type DcaReasonCode =
  | "Rental Reduction"
  | "LP Review"
  | "Termination"
  | "WCLOA";

export interface MakeUnavailableArgs {
  techLdap: string;
  impactDate: string; // YYYY-MM-DD
  reasonCode: DcaReasonCode;
  submittedBy?: string | null;
  submitterEmail?: string | null;
  projectNotes?: string | null;
}

export interface MakeUnavailableResult {
  /** True only when the API returned a 2xx with a `id` in the body. */
  ok: boolean;
  /** Reason the call was skipped without an HTTP attempt (e.g. missing_config). */
  skipReason?: "missing_config";
  /** Upstream project id (the `sourceProjectId` for a later Quick Return). */
  projectId: string | null;
  /** Upstream lifecycle status, e.g. "awaiting_dca". */
  upstreamStatus: string | null;
  /** HTTP status when an attempt was made. */
  httpStatus: number | null;
  /** Human-readable error when ok=false. */
  errorMessage: string | null;
}

interface DcaApiConfig {
  baseUrl: string;
  token: string;
}

function readConfig(): DcaApiConfig | null {
  const baseUrl = (process.env.EVENT_REQUEST_URL ?? "").trim().replace(/\/+$/, "");
  const token = (process.env.DCA_TASK_API_TOKEN ?? "").trim();
  if (!baseUrl || !token) return null;
  return { baseUrl, token };
}

/** Returns whether both env vars are configured. */
export function isDcaTaskApiConfigured(): boolean {
  return readConfig() !== null;
}

let warned = false;
/**
 * Logs a single warning if either secret is missing. Call this once at boot
 * so operators see the misconfiguration without spamming the log every send.
 */
export function warnIfDcaTaskApiMissing(): void {
  if (warned) return;
  warned = true;
  if (!isDcaTaskApiConfigured()) {
    console.warn(
      "[VRM DCA] EVENT_REQUEST_URL and/or DCA_TASK_API_TOKEN are not set — " +
      "Make Unavailable events on rental denials will be marked 'skipped' until configured.",
    );
  } else {
    console.log("[VRM DCA] Standard Activities Request Generator API configured.");
  }
}

/**
 * POST /api/availability-request with availabilityType=make_unavailable.
 *
 * Never throws — all failure modes are returned as a result object so the
 * caller can record the status on the decision row and the dispatcher can
 * decide whether to retry.
 */
export async function sendMakeUnavailable(args: MakeUnavailableArgs): Promise<MakeUnavailableResult> {
  const config = readConfig();
  if (!config) {
    return {
      ok: false,
      skipReason: "missing_config",
      projectId: null,
      upstreamStatus: null,
      httpStatus: null,
      errorMessage: "EVENT_REQUEST_URL or DCA_TASK_API_TOKEN not configured",
    };
  }

  const url = `${config.baseUrl}${ENDPOINT_PATH}`;
  const body: Record<string, unknown> = {
    techId: args.techLdap,
    availabilityType: "make_unavailable",
    reasonCode: args.reasonCode,
    impactDate: args.impactDate,
  };
  if (args.submittedBy) body.submittedBy = args.submittedBy;
  if (args.submitterEmail) body.submitterEmail = args.submitterEmail;
  if (args.projectNotes) body.projectNotes = args.projectNotes;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err: any) {
    return {
      ok: false,
      projectId: null,
      upstreamStatus: null,
      httpStatus: null,
      errorMessage: `network error: ${err?.message ?? String(err)}`,
    };
  }

  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* ignore */ }

  if (res.status >= 200 && res.status < 300) {
    const projectId = typeof parsed?.id === "string" ? parsed.id : null;
    return {
      ok: !!projectId,
      projectId,
      upstreamStatus: typeof parsed?.status === "string" ? parsed.status : null,
      httpStatus: res.status,
      errorMessage: projectId ? null : "API returned 2xx but no project id",
    };
  }

  const upstreamError =
    (parsed && (parsed.error || parsed.message)) ||
    (text ? text.slice(0, 500) : `HTTP ${res.status}`);
  return {
    ok: false,
    projectId: null,
    upstreamStatus: null,
    httpStatus: res.status,
    errorMessage: `HTTP ${res.status}: ${upstreamError}`,
  };
}

/* ------------------------------------------------------------------------ *
 * Endpoint 2: pending-exports — schedule a Standard Activity on the route.
 *
 * Same service and the same two secrets as Make Unavailable above, different
 * path. Where make_unavailable REMOVES a tech from route, this one SCHEDULES
 * time onto it: a block so the tech can return an Enterprise rental and
 * collect the van that is already repaired and sitting at a shop.
 *
 * One truck, one project, fired the moment the truck is known ready
 * (Tyler, 2026-07-28). A single row is 1 technician and 2 hours, far under
 * the 20-technician / 40-hour auto-approve ceiling, so every single-row
 * project auto-approves. Batching was never what earned auto-approval — it
 * was what kept a large wave from breaching the cap.
 *
 * Design: docs/superpowers/specs/2026-07-27-luca-rental-return-queue-design.md
 * ------------------------------------------------------------------------ */

const PENDING_EXPORTS_PATH = "/api/pending-exports";

/**
 * Activity type for a rental-return block.
 *
 * Evidence-based, NOT confirmed by the API owner. `41` appears exactly once
 * across both API guides (inside the June JSON blob); the June field table
 * documents 61, 37 and 38, and the May production doc sends "38" carrying a
 * Duration. If the owner says otherwise this constant is the only edit.
 */
export const RENTAL_RETURN_ACTIVITY_TYPE = "46";

/** Two hours, matching what Eddie described on the 2026-07-27 call. */
export const RENTAL_RETURN_DURATION_MIN = 120;

function defaultSubmittedBy(): string {
  return (process.env.EVENT_REQUEST_SUBMITTED_BY ?? "TMORGAN (tyler.morgan@transformco.com)").trim();
}
function defaultSubmitterEmail(): string {
  return (process.env.EVENT_REQUEST_SUBMITTER_EMAIL ?? "tyler.morgan@transformco.com").trim();
}

export interface StandardActivityArgs {
  /** TechnicianId. RACF string, NOT employee_id — see the identity note in the spec. */
  techLdap: string;
  /** Unit = district_no. Required by the payload. */
  unit: string;
  truckNumber: string;
  shopName?: string | null;
  /** YYYY-MM-DD, the day the block lands on. See nextBusinessDay(). */
  date: string;
  durationMinutes?: number;
  /**
   * What this block IS. Becomes the project name prefix and therefore the
   * 409 duplicate key. Defaults to "Rental Return" so existing callers are
   * unchanged.
   */
  projectLabel?: string;
  /** Project-level note. Defaults to the rental-return wording. */
  projectNotes?: string;
  /** Row-level Notes the technician and dispatcher read. */
  rowNotes?: string;
  submittedBy?: string | null;
  submitterEmail?: string | null;
  /**
   * When false, the project name is prefixed TEST. The receiving system does
   * not process TEST projects, and no SMS may ever be sent for one. This is
   * how LUCA_ROUTE_BLOCK_ENABLED=off is expressed on the wire.
   */
  live: boolean;
}

export interface StandardActivityResult {
  /** True only on a 2xx carrying a string `id`. */
  ok: boolean;
  skipReason?: "missing_config" | "duplicate";
  /**
   * False means DO NOT re-fire. A 409 in particular means the request already
   * exists; the dispatcher re-firing an identical POST is what leaves a tech
   * off route with no reversal handle.
   */
  retryable: boolean;
  projectId: string | null;
  projectName: string;
  httpStatus: number | null;
  errorMessage: string | null;
  /** Exactly what was (or would have been) POSTed, for the audit column. */
  payload: Record<string, unknown>;
}

function mmddyy(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${m}${d}${y.slice(2)}`;
}

/**
 * Next business day (Mon–Fri) after `from`, as YYYY-MM-DD.
 *
 * Detection can land at any hour. Pulling a technician off a route already in
 * progress is worse than waiting, and "tomorrow" is what Eddie described.
 * Date-only maths in UTC so it cannot drift by a day across a TZ boundary.
 */
export function nextBusinessDay(from: Date = new Date()): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  do {
    d.setUTCDate(d.getUTCDate() + 1);
  } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

/**
 * Builds the exact request body. Exported so the queue can persist and show
 * the payload while LUCA_ROUTE_BLOCK_ENABLED is off, without POSTing. What
 * you inspect with the flag off is byte-for-byte what fires when it is on.
 */
export function buildStandardActivityPayload(args: StandardActivityArgs): {
  projectName: string;
  body: Record<string, unknown>;
} {
  const duration = args.durationMinutes ?? RENTAL_RETURN_DURATION_MIN;
  const where = args.shopName ? ` at ${args.shopName}` : "";
  const label = args.projectLabel ?? "Rental Return";
  // Per-truck discriminator: many projects now fire on the same date, so
  // region/sequence naming from the batched design would collide.
  const projectName =
    `${args.live ? "" : "TEST "}${label} - ${args.truckNumber} - ${mmddyy(args.date)}`;

  const body: Record<string, unknown> = {
    submittedBy: args.submittedBy ?? defaultSubmittedBy(),
    submitterEmail: args.submitterEmail ?? defaultSubmitterEmail(),
    projectName,
    rowCount: "1", // string, per the guide
    projectNotes: args.projectNotes
      ?? "Fleet rental return. Repair complete, van awaiting pickup.",
    exportData: [
      {
        TechnicianId: args.techLdap,
        ActivityType: RENTAL_RETURN_ACTIVITY_TYPE,
        Date: args.date,
        // Must be empty when StartTimeRequest is "Start of Day". The guide's
        // prose says so even though its own example pairs them. Verify on the
        // first live submission.
        StartTime: "",
        Duration: duration,
        LocationType: "None",
        LocationValue: "",
        TravelBehavior: "None",
        Notes: args.rowNotes
          ?? `Return rental, pick up truck ${args.truckNumber}${where}`,
        CheckJobs: "FALSE",
        CheckStdActs: "FALSE",
        CheckFrozen: "TRUE",
        // `Date` alone does NOT pin the day. RequestedStartDate is the hard
        // boundary the DCA cannot schedule before; RequestedCompletionDate is
        // only a target unless endDateFixed is true. Pin all three.
        RequestedStartDate: args.date,
        RequestedCompletionDate: args.date,
        endDateFixed: true,
        RepeatOnDays: "",
        StartTimeRequest: "Start of Day",
        Unit: args.unit,
      },
    ],
  };

  return { projectName, body };
}

/**
 * POST /api/pending-exports — request a rental-return block on one tech's route.
 *
 * Never throws. Every failure mode comes back as a result object so the queue
 * can record it on the row and decide whether a retry is even allowed.
 *
 * NOTE: a 201 proves the submission was accepted and nothing more. The API
 * exposes no GET, no status endpoint and no poll, and a project named TEST
 * returns the same 201 as a real one. Downstream copy must therefore claim
 * only that a block was *requested*.
 */
export async function sendStandardActivity(
  args: StandardActivityArgs,
): Promise<StandardActivityResult> {
  const { projectName, body } = buildStandardActivityPayload(args);

  const config = readConfig();
  if (!config) {
    // Leaves the row open with a visible warning. Never silently does nothing —
    // a silent 403/missing-config is what hid every other defect on 2026-07-27.
    return {
      ok: false,
      skipReason: "missing_config",
      retryable: false,
      projectId: null,
      projectName,
      httpStatus: null,
      errorMessage: "EVENT_REQUEST_URL or DCA_TASK_API_TOKEN not configured",
      payload: body,
    };
  }

  let res: Response;
  try {
    res = await fetch(`${config.baseUrl}${PENDING_EXPORTS_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err: any) {
    return {
      ok: false,
      retryable: true,
      projectId: null,
      projectName,
      httpStatus: null,
      errorMessage: `network error: ${err?.message ?? String(err)}`,
      payload: body,
    };
  }

  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* ignore */ }

  if (res.status >= 200 && res.status < 300) {
    const projectId = typeof parsed?.id === "string" ? parsed.id : null;
    return {
      ok: !!projectId,
      retryable: false,
      projectId,
      projectName,
      httpStatus: res.status,
      // A 2xx with no id is a needs_review case, not a retry: something was
      // accepted upstream and we have no handle on it.
      errorMessage: projectId ? null : "API returned 2xx but no project id",
      payload: body,
    };
  }

  // 409 = this request already exists. Mark it and stop. Re-firing an
  // identical POST five times is the documented failure the dispatcher must
  // not repeat here.
  if (res.status === 409) {
    return {
      ok: false,
      skipReason: "duplicate",
      retryable: false,
      projectId: typeof parsed?.id === "string" ? parsed.id : null,
      projectName,
      httpStatus: 409,
      errorMessage: `duplicate: ${projectName} already exists upstream`,
      payload: body,
    };
  }

  const upstreamError =
    (parsed && (parsed.error || parsed.message)) ||
    (text ? text.slice(0, 500) : `HTTP ${res.status}`);
  return {
    ok: false,
    // Only transient classes are worth a second attempt.
    retryable: res.status === 429 || res.status >= 500,
    projectId: null,
    projectName,
    httpStatus: res.status,
    errorMessage: `HTTP ${res.status}: ${upstreamError}`,
    payload: body,
  };
}
