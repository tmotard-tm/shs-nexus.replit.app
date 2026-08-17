/**
 * Create Vehicle — client-side preflight, number-hold and outcome model.
 *
 * The server gate (Task #636) is fail-closed and authoritative: it re-runs every
 * duplicate check inside POST /api/byov/create and refuses the submission itself.
 * This module is the wizard's mirror of that contract, so the form can tell the
 * dispatcher what the gate is going to say BEFORE the whole form is filled in:
 *
 *  - one preflight verdict per check (vehicle number, VIN) instead of two
 *    unrelated ad-hoc lookups with two unrelated warning strings;
 *  - a block is a block — the submit path refuses on any blocking verdict;
 *  - the suggested number is a real hold with an expiry, and a lapsed hold is
 *    reported as lapsed instead of silently 409-ing at submit;
 *  - a create that Holman did not confirm is "pending verification", never
 *    "success".
 *
 * Everything here is deliberately framework-free and dependency-free so the
 * decision rules can be unit-tested without React or a DOM.
 */

// ── Verdicts ─────────────────────────────────────────────────────────────────

/**
 * `warn` means "the check could not complete". The client does NOT turn that
 * into a block: the server gate is the authority and will refuse the submission
 * itself if it still cannot verify. The user is told, rather than blocked by a
 * transient client-side failure.
 */
export type CheckStatus = "idle" | "checking" | "clear" | "warn" | "block";

export interface CheckVerdict {
  status: CheckStatus;
  /** Short headline shown inline next to the field. */
  title: string;
  /** Why — always populated for `warn` and `block`. */
  detail?: string;
}

export const IDLE_VERDICT: CheckVerdict = { status: "idle", title: "Not checked yet" };
export const CHECKING_VERDICT: CheckVerdict = { status: "checking", title: "Checking…" };

export interface PreflightVerdict {
  vehicleNumber: CheckVerdict;
  vin: CheckVerdict;
  /** True when at least one check returned a blocking verdict. */
  blocked: boolean;
  /** Human-readable reasons behind every blocking verdict. */
  blockingReasons: string[];
  /** Reasons behind every non-blocking problem (checks that could not complete). */
  warnings: string[];
  /** True while any check is still running. */
  checking: boolean;
}

export interface RawCheckResponse<T> {
  ok: boolean;
  status: number;
  body: T | null;
  /** Network/parse failure message, when the request never produced a body. */
  transportError?: string;
}

export interface NumberExistsBody {
  exists?: boolean;
  canonical?: string;
  error?: string;
}

export interface VinCheckBody {
  exists?: boolean;
  valid?: boolean;
  reason?: string;
  error?: string;
  matches?: Array<{
    vehicleNumber?: string | null;
    make?: string | null;
    model?: string | null;
    modelYear?: number | string | null;
    source?: string | null;
  }>;
}

function sourceLabel(source: string | null | undefined): string {
  if (source === "in_flight_reservation") return "an in-flight Create Vehicle submission";
  if (source === "holman_cache") return "Holman";
  return source ? String(source) : "Holman";
}

/** Classify GET /api/holman/vehicles/exists/:vehicleNumber for a given number. */
export function classifyNumberCheck(
  vehicleNumber: string,
  resp: RawCheckResponse<NumberExistsBody>,
): CheckVerdict {
  const trimmed = String(vehicleNumber || "").trim();
  if (!trimmed) return IDLE_VERDICT;

  if (!resp.ok || !resp.body) {
    const why = resp.transportError || resp.body?.error || `the check failed (HTTP ${resp.status})`;
    return {
      status: "warn",
      title: "Vehicle number not verified",
      detail: `Could not check whether ${trimmed} already exists in Holman — ${why}. The server re-runs this check and will refuse the submission if it still cannot verify.`,
    };
  }

  if (resp.body.exists) {
    const canonical = resp.body.canonical ? ` (canonical ${resp.body.canonical})` : "";
    return {
      status: "block",
      title: "Vehicle number already exists",
      detail: `Vehicle ${trimmed}${canonical} is already registered in Holman. Get a fresh number or enter a different one — this submission will be refused.`,
    };
  }

  return { status: "clear", title: `Vehicle number ${trimmed} is free in Holman` };
}

/**
 * The VIN format rules the server gate enforces, mirrored locally so a
 * malformed VIN is blocked in the form rather than at submit. Kept in step with
 * `validateVin` in server/vehicle-create-gate.ts — the server remains the
 * authority; this only stops the user wasting a submission on a VIN that cannot
 * possibly pass.
 *
 * Returns null when the format is acceptable, i.e. when the duplicate check is
 * the thing that decides.
 */
export function classifyVinFormat(vin: string): CheckVerdict | null {
  const trimmed = String(vin || "").trim().toUpperCase();
  if (!trimmed) return IDLE_VERDICT;

  const block = (detail: string): CheckVerdict => ({ status: "block", title: "VIN is not valid", detail });

  if (trimmed.length !== 17) {
    return block(`VIN must be exactly 17 characters (received ${trimmed.length}).`);
  }
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(trimmed)) {
    return block("VIN contains invalid characters — a VIN is alphanumeric and never uses the letters I, O or Q.");
  }
  if (/^(.)\1{16}$/.test(trimmed)) {
    return block("VIN looks like a placeholder (all characters identical).");
  }
  if ("UZ0".includes(trimmed[9])) {
    return block(`VIN position 10 ("${trimmed[9]}") is not a valid model-year code.`);
  }
  return null;
}

/** Classify GET /api/byov/check-vin/:vin. */
export function classifyVinCheck(vin: string, resp: RawCheckResponse<VinCheckBody>): CheckVerdict {
  const trimmed = String(vin || "").trim().toUpperCase();
  if (!trimmed) return IDLE_VERDICT;

  if (!resp.ok || !resp.body) {
    const why = resp.transportError || resp.body?.error || `the check failed (HTTP ${resp.status})`;
    return {
      status: "warn",
      title: "VIN not verified",
      detail: `Could not check whether VIN ${trimmed} is already registered — ${why}. The server re-runs this check and will refuse the submission if it still cannot verify.`,
    };
  }

  if (resp.body.valid === false) {
    return {
      status: "block",
      title: "VIN is not valid",
      detail: resp.body.reason || "The VIN failed format validation and will be rejected on submit.",
    };
  }

  if (resp.body.exists) {
    const first = resp.body.matches?.[0];
    const label = [first?.modelYear, first?.make, first?.model].filter(Boolean).join(" ");
    const where = sourceLabel(first?.source);
    return {
      status: "block",
      title: "VIN is already registered",
      detail: `VIN ${trimmed} is already registered under vehicle ${first?.vehicleNumber || "(unknown number)"}${
        label ? ` (${label})` : ""
      } in ${where}. Resolve the duplicate before creating this vehicle — this submission will be refused.`,
    };
  }

  return { status: "clear", title: `VIN ${trimmed} is not registered anywhere yet` };
}

/** Fold the individual verdicts into the single verdict the submit path reads. */
export function combinePreflight(vehicleNumber: CheckVerdict, vin: CheckVerdict): PreflightVerdict {
  const all: Array<[string, CheckVerdict]> = [
    ["vehicleNumber", vehicleNumber],
    ["vin", vin],
  ];
  const blockingReasons: string[] = [];
  const warnings: string[] = [];
  let checking = false;

  for (const [, verdict] of all) {
    if (verdict.status === "checking") checking = true;
    const text = verdict.detail || verdict.title;
    if (verdict.status === "block") blockingReasons.push(text);
    if (verdict.status === "warn") warnings.push(text);
  }

  return {
    vehicleNumber,
    vin,
    blocked: blockingReasons.length > 0,
    blockingReasons,
    warnings,
    checking,
  };
}

// ── Number hold ──────────────────────────────────────────────────────────────

export interface NumberHold {
  /** The padded number that was held for this session. */
  number: string;
  holdId: number | null;
  /** ISO timestamp, or null when the endpoint did not return one. */
  expiresAt: string | null;
  /** Sources the allocator scanned before handing the number out. */
  scannedSources: string[];
}

export type HoldState =
  /** No hold has ever been taken in this session. */
  | "none"
  /** The number in the form is not the held one (typed manually). */
  | "manual"
  /** Held, comfortably in date. */
  | "held"
  /** Held, but about to expire. */
  | "expiring"
  /** The hold ran out — another user may take the number. */
  | "lapsed";

export interface HoldStatus {
  state: HoldState;
  msRemaining: number;
  /** Countdown as m:ss, empty when there is nothing to count down. */
  remainingLabel: string;
  title: string;
  detail: string;
}

/** Numbers are compared with leading zeros stripped: 88095 === 088095. */
export function canonicalNumber(value: string | null | undefined): string {
  const digits = String(value ?? "").trim();
  if (!digits) return "";
  return digits.replace(/^0+/, "") || "0";
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return "0:00";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Warn the user this far ahead of the hold running out. */
export const HOLD_EXPIRING_MS = 2 * 60 * 1000;

export function describeNumberHold(args: {
  hold: NumberHold | null;
  currentNumber: string;
  nowMs: number;
}): HoldStatus {
  const { hold, currentNumber, nowMs } = args;
  const empty = { msRemaining: 0, remainingLabel: "" };

  if (!hold) {
    return {
      state: "none",
      ...empty,
      title: "No number held",
      detail: "Use the refresh button to get — and hold — the next available number.",
    };
  }

  if (canonicalNumber(currentNumber) !== canonicalNumber(hold.number)) {
    return {
      state: "manual",
      ...empty,
      title: "This number is not held for you",
      detail: `Only ${hold.number} was reserved. A typed number is checked but not held, so another user can take it before you submit.`,
    };
  }

  const expiresMs = hold.expiresAt ? new Date(hold.expiresAt).getTime() : NaN;
  if (!Number.isFinite(expiresMs)) {
    return {
      state: "held",
      ...empty,
      title: `Vehicle ${hold.number} is held for you`,
      detail: "The reservation has no expiry time on it — submit as soon as the form is complete.",
    };
  }

  const msRemaining = expiresMs - nowMs;
  if (msRemaining <= 0) {
    return {
      state: "lapsed",
      msRemaining: 0,
      remainingLabel: "0:00",
      title: `The hold on ${hold.number} has expired`,
      detail: "Another user can now take this number. Get a fresh one before submitting — otherwise the submission may be refused.",
    };
  }

  const remainingLabel = formatRemaining(msRemaining);
  if (msRemaining <= HOLD_EXPIRING_MS) {
    return {
      state: "expiring",
      msRemaining,
      remainingLabel,
      title: `The hold on ${hold.number} expires in ${remainingLabel}`,
      detail: "Finish and submit now, or get a fresh number.",
    };
  }

  return {
    state: "held",
    msRemaining,
    remainingLabel,
    title: `Vehicle ${hold.number} is held for you — ${remainingLabel} left`,
    detail: `Reserved for this session${
      hold.scannedSources.length ? ` after scanning ${hold.scannedSources.join(", ")}` : ""
    }. No one else can take it while the hold lasts.`,
  };
}

// ── Submission outcome ───────────────────────────────────────────────────────

export interface SystemResult {
  success?: boolean;
  pending?: boolean;
  skipped?: boolean;
  rehearsal?: boolean;
  error?: string;
  detail?: string;
}

export interface CreateSummary {
  overall?: "success" | "partial" | "pending" | "failed" | "noop";
  holmanOnly?: boolean;
  wmsOnly?: boolean;
  attempted?: string[];
  succeeded?: string[];
  failed?: string[];
  pending?: string[];
}

export interface SubmitResponse {
  rehearsal?: boolean;
  requestId?: string;
  vehicleNumber?: string;
  message?: string;
  gates?: Record<string, unknown>;
  wouldSend?: Record<string, unknown>;
  holman?: SystemResult;
  wms?: SystemResult;
  tpms?: SystemResult;
  holmanOnly?: boolean;
  summary?: CreateSummary;
}

export type SystemStatus = "success" | "pending" | "failed" | "skipped" | "rehearsal";

export interface SystemRow {
  system: string;
  status: SystemStatus;
  message: string;
}

/**
 * Per-system status. `pending` is the important one: Holman answers 2xx for
 * everything, so the server only reports `success` on positive evidence and
 * flags anything else as pending verification. The UI must not launder that
 * into a green tick.
 */
export function classifySystemResult(system: string, result: SystemResult | undefined): SystemRow {
  if (!result) {
    return { system, status: "skipped", message: "Not attempted on this submission." };
  }
  if (result.rehearsal) {
    return {
      system,
      status: "rehearsal",
      message: result.detail || "Rehearsal mode — nothing was sent to this system.",
    };
  }
  if (result.pending) {
    return {
      system,
      status: "pending",
      message:
        result.detail ||
        result.error ||
        "Submitted, but acceptance was not confirmed. Verify before re-submitting — a retry could create a duplicate.",
    };
  }
  if (result.skipped) {
    return {
      system,
      status: "skipped",
      message: result.detail || "Not targeted by this submission — nothing was sent.",
    };
  }
  if (result.success) {
    return { system, status: "success", message: result.detail || "Record created and confirmed." };
  }
  return { system, status: "failed", message: result.error || result.detail || "The submission failed." };
}

/** What a standalone retry (WMS-only / Holman-only) does to the displayed state. */
export interface RetryApplication {
  /** The outcome panel's result. Unchanged when the retry was only rehearsed. */
  submitResult: SubmitResponse | null;
  /** A rehearsed retry, reported separately so it is never read as a real one. */
  retryRehearsal: { label: string; response: SubmitResponse } | null;
}

/**
 * Fold a standalone retry response into what the user sees.
 *
 * A rehearsed retry sent nothing, so it must NOT be merged into the previous
 * result: merging a rehearsal "success" over a real failure would turn a
 * still-broken submission into a green panel while nothing had been retried.
 * It is kept aside instead, with its `wouldSend` intact.
 */
export function applyRetryResponse(
  prev: SubmitResponse | null,
  response: SubmitResponse,
  label: string,
  target: "wms" | "holman",
): RetryApplication {
  if (response.rehearsal) {
    return { submitResult: prev, retryRehearsal: { label, response } };
  }
  if (!prev) {
    return { submitResult: response, retryRehearsal: null };
  }
  const merged: SubmitResponse =
    target === "wms"
      ? { ...prev, wms: response.wms, tpms: response.tpms ?? prev.tpms, holmanOnly: !response.wms?.success }
      : { ...prev, holman: response.holman };
  // The retry's own summary describes only the system it touched, so the
  // combined panel re-derives its overall state from the merged rows.
  delete merged.summary;
  return { submitResult: merged, retryRehearsal: null };
}

export type OutcomeKind = "rehearsal" | "success" | "pending" | "partial" | "failed" | "noop";

export interface OutcomeView {
  kind: OutcomeKind;
  headline: string;
  detail: string;
  rows: SystemRow[];
  /** True when at least one system landed and at least one did not. */
  mixed: boolean;
}

/**
 * Build the result-panel view model. The server `summary.overall` is trusted
 * when present (it is computed from what was actually ATTEMPTED); otherwise —
 * the single-system retry endpoints do not send one — it is derived from the
 * per-system rows.
 */
export function describeOutcome(response: SubmitResponse | null): OutcomeView | null {
  if (!response) return null;

  const rows: SystemRow[] = [
    classifySystemResult("Holman", response.holman),
    classifySystemResult("WMS", response.wms),
    classifySystemResult("TPMS", response.tpms),
  ].filter((row) => row.status !== "skipped" || response.rehearsal === true);

  if (response.rehearsal) {
    return {
      kind: "rehearsal",
      headline: "Rehearsal only — nothing was created",
      detail:
        response.message ||
        "Every gate ran and passed, but no record was sent to Holman, WMS, or TPMS and no number was reserved.",
      rows,
      mixed: false,
    };
  }

  const live = rows.filter((r) => r.status !== "skipped");
  const succeeded = live.filter((r) => r.status === "success");
  const pending = live.filter((r) => r.status === "pending");
  const failed = live.filter((r) => r.status === "failed");

  let kind: OutcomeKind;
  if (response.summary?.overall) {
    kind = response.summary.overall;
  } else if (live.length === 0) {
    kind = "noop";
  } else if (failed.length === 0 && pending.length === 0) {
    kind = "success";
  } else if (succeeded.length === 0 && pending.length === 0) {
    kind = "failed";
  } else if (failed.length === 0) {
    kind = "pending";
  } else {
    kind = "partial";
  }

  const names = (list: SystemRow[]) => list.map((r) => r.system).join(" and ");

  const headlines: Record<OutcomeKind, string> = {
    rehearsal: "Rehearsal only — nothing was created",
    success: "Vehicle created",
    pending: "Submitted — pending verification",
    partial: "Partly created — action needed",
    failed: "Nothing was created",
    noop: "No system was targeted",
  };

  const details: Record<OutcomeKind, string> = {
    rehearsal: "",
    success: `Confirmed in ${names(succeeded) || "every targeted system"}.`,
    pending: `${names(pending) || "One system"} accepted the submission but did not confirm it. Verify before re-submitting — a retry could create a duplicate.`,
    partial: `${names(succeeded.concat(pending)) || "Some systems"} went through; ${
      names(failed) || "another system"
    } did not. Use the recovery action below rather than re-submitting the whole form.`,
    failed: `${names(failed) || "Every targeted system"} rejected the submission. Nothing to clean up — fix the error and submit again.`,
    noop: "Neither Holman nor WMS was targeted, so nothing was sent.",
  };

  return {
    kind,
    headline: headlines[kind],
    detail: details[kind],
    rows,
    mixed: succeeded.length + pending.length > 0 && failed.length > 0,
  };
}

// ── Gate state ───────────────────────────────────────────────────────────────

export interface GateState {
  enabled: boolean;
  rehearsalMode: boolean;
}

export interface GateBanner {
  kind: "off" | "rehearsal" | "unreadable" | null;
  title: string;
  detail: string;
  /** True when submitting is pointless — the server will refuse it. */
  submissionsRefused: boolean;
}

export function describeGate(gate: GateState | null | undefined, failedToLoad: boolean): GateBanner {
  if (failedToLoad) {
    return {
      kind: "unreadable",
      title: "Creation status unknown",
      detail:
        "The vehicle-creation gate could not be read. Creation may be turned off — the server will say so when you submit.",
      submissionsRefused: false,
    };
  }
  if (!gate) {
    return { kind: null, title: "", detail: "", submissionsRefused: false };
  }
  if (!gate.enabled) {
    return {
      kind: "off",
      title: "Vehicle creation is turned off",
      detail:
        "Submissions are refused while the gate is closed. A developer can turn it back on from the Vehicle Creation admin page.",
      submissionsRefused: true,
    };
  }
  if (gate.rehearsalMode) {
    return {
      kind: "rehearsal",
      title: "Rehearsal mode is on",
      detail:
        "Every check runs for real, but nothing is sent to Holman, WMS, or TPMS and no number is reserved. You will see exactly what would have been sent.",
      submissionsRefused: false,
    };
  }
  return { kind: null, title: "", detail: "", submissionsRefused: false };
}

// ── Server refusals ──────────────────────────────────────────────────────────

export interface RefusalBody {
  error?: string;
  message?: string;
  code?: string;
  source?: string;
  requestId?: string;
  retryable?: boolean;
  vinConflict?: { vehicleNumber?: string | null; vin?: string | null; label?: string | null; source?: string | null };
}

export interface RefusalView {
  title: string;
  detail: string;
  /** Which preflight check the refusal belongs to, when the server told us. */
  attachTo: "vehicleNumber" | "vin" | null;
  /** True when the number hold this form was relying on is gone. */
  holdLost: boolean;
}

/**
 * Turn a non-2xx create response into something the form can both show and act
 * on. A 409 on the number means the hold is gone; a VIN conflict is pinned to
 * the VIN check so the inline verdict and the toast agree.
 */
export function describeRefusal(status: number, body: RefusalBody | null): RefusalView {
  const message = body?.error || body?.message || `The submission was refused (HTTP ${status}).`;

  if (body?.code === "vehicle_create_disabled") {
    return { title: "Vehicle creation is turned off", detail: message, attachTo: null, holdLost: false };
  }
  if (body?.code === "duplicate_check_unavailable" || body?.code === "number_check_unavailable") {
    return {
      title: "Checks could not complete",
      detail: message,
      attachTo: body.code === "duplicate_check_unavailable" ? "vin" : "vehicleNumber",
      holdLost: false,
    };
  }
  if (body?.vinConflict) {
    return { title: "Duplicate VIN", detail: message, attachTo: "vin", holdLost: false };
  }
  if (status === 409) {
    const aboutVin = /VIN\s+[A-HJ-NPR-Z0-9]{17}\s+is already being submitted/i.test(message);
    return {
      title: aboutVin ? "Duplicate VIN" : "Vehicle number unavailable",
      detail: message,
      attachTo: aboutVin ? "vin" : "vehicleNumber",
      holdLost: !aboutVin,
    };
  }
  if (status === 403) {
    return { title: "Not permitted", detail: message, attachTo: null, holdLost: false };
  }
  if (status === 400) {
    return { title: "Submission rejected", detail: message, attachTo: null, holdLost: false };
  }
  return { title: "Submission failed", detail: message, attachTo: null, holdLost: false };
}

// ── Fetch helpers ────────────────────────────────────────────────────────────

async function readJson(resp: Response): Promise<any> {
  const text = await resp.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

export interface ApiOutcome<T> {
  ok: boolean;
  status: number;
  body: T | null;
  transportError?: string;
}

export async function getJson<T>(url: string): Promise<ApiOutcome<T>> {
  try {
    const resp = await fetch(url, { credentials: "include" });
    return { ok: resp.ok, status: resp.status, body: (await readJson(resp)) as T };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: null,
      transportError: err instanceof Error ? err.message : "the request could not be sent",
    };
  }
}

export async function postJson<T>(url: string, payload: unknown): Promise<ApiOutcome<T>> {
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include",
    });
    return { ok: resp.ok, status: resp.status, body: (await readJson(resp)) as T };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: null,
      transportError: err instanceof Error ? err.message : "the request could not be sent",
    };
  }
}

export async function runNumberCheck(vehicleNumber: string): Promise<CheckVerdict> {
  const trimmed = String(vehicleNumber || "").trim();
  if (!trimmed) return IDLE_VERDICT;
  const resp = await getJson<NumberExistsBody>(`/api/holman/vehicles/exists/${encodeURIComponent(trimmed)}`);
  return classifyNumberCheck(trimmed, resp);
}

/**
 * A checker that always publishes a verdict for the CURRENT input and never for
 * a stale one.
 *
 * Two rules it exists to enforce:
 *  - every call publishes, so a verdict can never be left over from an earlier
 *    value of the field (edit a VIN to something malformed and back again and
 *    the correct verdict is republished, not the stale block);
 *  - a slow answer for an old input is dropped rather than overwriting the
 *    verdict for the input the user is actually looking at.
 */
export interface SequencedPreflight {
  run(input: string): Promise<CheckVerdict>;
  /** Drop any in-flight result, e.g. when a server refusal takes over. */
  invalidate(): void;
}

/**
 * Every published verdict is stamped with the normalized input it belongs to,
 * so a caller can tell "this verdict is about what is in the field now" from
 * "this verdict is about what used to be in the field" and refuse to submit on
 * the latter.
 */
export type PublishVerdict = (verdict: CheckVerdict, input: string) => void;

function createSequencedPreflight(args: {
  publish: PublishVerdict;
  /** Decide locally without a lookup. Return null to fall through to `lookup`. */
  local?: (input: string) => CheckVerdict | null;
  lookup: (input: string) => Promise<CheckVerdict>;
  normalize: (raw: string) => string;
}): SequencedPreflight {
  let seq = 0;
  return {
    invalidate() {
      seq++;
    },
    async run(raw: string): Promise<CheckVerdict> {
      const input = args.normalize(String(raw ?? ""));
      const mine = ++seq;
      const settle = (verdict: CheckVerdict) => {
        if (seq === mine) args.publish(verdict, input);
        return verdict;
      };

      if (!input) return settle(IDLE_VERDICT);
      const localVerdict = args.local?.(input) ?? null;
      if (localVerdict) return settle(localVerdict);

      settle(CHECKING_VERDICT);
      return settle(await args.lookup(input));
    },
  };
}

/**
 * VIN preflight. Deliberately independent of VIN decoding: decoding is a
 * convenience that may fail, while this is the gate. A decode failure must
 * never discard a duplicate verdict.
 */
export function createVinPreflight(args: {
  publish: PublishVerdict;
  lookup?: (vin: string) => Promise<CheckVerdict>;
}): SequencedPreflight {
  return createSequencedPreflight({
    publish: args.publish,
    normalize: (raw) => raw.trim().toUpperCase(),
    // A malformed VIN is settled locally — the duplicate index has nothing to
    // say about a VIN the server will reject on format alone.
    local: (vin) => classifyVinFormat(vin),
    lookup: args.lookup ?? runVinCheck,
  });
}

/** Vehicle-number preflight, sequenced on the same terms. */
export function createNumberPreflight(args: {
  publish: PublishVerdict;
  lookup?: (vehicleNumber: string) => Promise<CheckVerdict>;
}): SequencedPreflight {
  return createSequencedPreflight({
    publish: args.publish,
    normalize: (raw) => raw.trim(),
    lookup: args.lookup ?? runNumberCheck,
  });
}

export async function runVinCheck(vin: string): Promise<CheckVerdict> {
  const trimmed = String(vin || "").trim().toUpperCase();
  if (!trimmed) return IDLE_VERDICT;
  // A VIN that cannot pass the format gate is settled locally — no point asking
  // the duplicate index about a VIN the server will reject outright.
  const formatVerdict = classifyVinFormat(trimmed);
  if (formatVerdict) return formatVerdict;
  const resp = await getJson<VinCheckBody>(`/api/byov/check-vin/${encodeURIComponent(trimmed)}`);
  return classifyVinCheck(trimmed, resp);
}
