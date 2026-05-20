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
