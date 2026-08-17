/**
 * In-server booking executor.
 *
 * WHY THIS EXISTS
 * ---------------
 * The booking chain used to require a human to run `etd-runner/scripts/book_cutover.py`
 * on a laptop, so a staff click in the panel produced an intent that sat there until
 * somebody remembered. Tyler's directive (2026-08-17): "bookings have to happen when I
 * start the workflow we built, even if I'm doing that manually." Clicking start/confirm
 * is now the only human step.
 *
 * This is a port of the intent lane of `book_cutover.py` (`_post_preview` / `_do_book`)
 * into the server process. It calls the orchestrator's functions DIRECTLY instead of
 * looping back through the cron-bearer HTTP routes: same claim, same lease, same
 * fencing token, same attempt ledger, same postbacks. Nothing about the safety model
 * changes — only who is holding the claim.
 *
 * THE PYTHON RUNNER STILL WORKS
 * -----------------------------
 * It is the fallback, and it is safe to run alongside this: `claimBookingWork` hands an
 * intent to exactly one claimant under `FOR UPDATE SKIP LOCKED`, and the fencing token
 * plus the one-open-attempt index reject a superseded holder's postbacks. Two runners
 * cannot double-book the same intent.
 *
 * TWO DELIBERATE DIFFERENCES FROM THE PYTHON
 * ------------------------------------------
 *   1. Evidence goes to the DATABASE only. The Python runner writes every request and
 *      response to `reference/savedr_requests_sent/` and `reference/savedr_responses/`.
 *      Those files carry driver PII and a full reservation model; a server has no
 *      business writing them. Evidence payloads here are bounded, and a raw response
 *      snippet is kept only for `unparsed`, where it is the whole point.
 *   2. Schedule checks call `fetchScheduleWindow` in-process rather than GETting
 *      `/schedule-check`, which would be this same server calling itself (a pattern
 *      that 401s in prod — see the partial-refresh memory note).
 */
import { createHash } from "crypto";

import {
  WORKFLOW_CUTOVER,
  OrchestratorError,
  claimBookingWork,
  persistPreviewFromRunner,
  recordBookingPostback,
  fetchScheduleWindow,
  firstWorkingDay,
  type ScheduleWindow,
  etTodayISO,
  addDaysISO,
  isContractBlockLive,
  type QueueItem,
  type RunnerQuote,
  type RunnerClassDecision,
} from "../forms/cutover-orchestrator";

import {
  EtdClient,
  EtdError,
  rejectionReasons,
  safeErrorText,
  type CarClass,
  type EtdCallLog,
  type QuoteResult,
} from "./client";
import { choose as chooseClass, chooseSameVehicle, type OfferedClass } from "./vehicle-class";
import {
  zipState,
  parseLocalDT,
  addDaysDT,
  fmtISO,
  retarget,
  redate,
  relocate,
  setClass,
  setDriver,
  loadSavedrTemplate,
  loadUserMapping,
  templateOldIds,
  cloneTemplate,
  useAccountAdditionalInfo,
  assertAdditionalInfoComplete,
} from "./surgery";

/** Default rental length in days when the preview carries no return date. */
const DEFAULT_DAYS = 7;

/** How far ahead to look for the technician's next working day. */
const SCHEDULE_HORIZON_DAYS = 21;

/** Cap on any string that reaches an evidence payload. Evidence is a record, not a dump. */
const EVIDENCE_CHARS = 300;

export type ExecutorAction =
  | "PREV"
  | "BOOK"
  | "DARK"
  | "ABRT"
  | "HOLD"
  | "RECON"
  | "DUPE"
  | "FAIL"
  | "SKIP"
  | "ERR";

export type ExecutorResult = {
  intentId: number;
  ldap: string;
  kind: string;
  action: ExecutorAction;
  status: string;
  detail?: string;
};

export type ExecutorRun = {
  runnerId: string;
  claimed: number;
  results: ExecutorResult[];
  armed: boolean;
  timing: string;
};

/**
 * Injectable side-effect boundary, mirroring the orchestrator's BlockReconcileDeps.
 * Production uses the real ETD client and the real Snowflake-backed schedule read;
 * tests substitute both so the lane logic can be exercised without external systems.
 */
export type ExecutorDeps = {
  client?: EtdClient;
  schedule?: (ldap: string, fromISO: string, horizonDays: number) => Promise<ScheduleWindow>;
};

const clip = (v: unknown, n = EVIDENCE_CHARS): string => String(v ?? "").slice(0, n);

/** Keys whose values are safe to keep verbatim: identifiers and status codes, never people. */
const ID_KEY = /^(status|state|code|errorcode|error_code|reference|confirmation\w*|reservation\w*|journey\w*|id)$/i;
/** An id, not a person: short and made of code characters only. */
const ID_VALUE = /^[A-Za-z0-9._:/-]{1,32}$/;

/**
 * A PII-free description of an unrecognised ETD response: every leaf as `path:type`,
 * with values kept ONLY for short identifier-ish fields. Enough to fix a parser or
 * chase a reservation; never enough to leak a technician.
 */
export function redactedShape(v: unknown, depth = 0, path = ""): string {
  const parts: string[] = [];
  const walk = (node: any, d: number, p: string) => {
    if (parts.length > 40 || d > 3) return;
    if (node === null || node === undefined) return void parts.push(`${p}:null`);
    if (Array.isArray(node)) {
      parts.push(`${p}[${node.length}]`);
      if (node.length) walk(node[0], d + 1, `${p}[0]`);
      return;
    }
    if (typeof node === "object") {
      for (const k of Object.keys(node).slice(0, 20)) walk(node[k], d + 1, p ? `${p}.${k}` : k);
      return;
    }
    // Array indices are stripped so `journeys[0].id` is still recognised as an id, and
    // NUMBERS are treated exactly like strings: a phone, a ZIP or a coordinate is no less
    // identifying for arriving unquoted. Only booleans are safe on their face.
    const leaf = (p.split(".").pop() ?? p).replace(/\[\d+\]$/, "");
    const s = String(node);
    const keep = typeof node === "boolean" || (ID_KEY.test(leaf) && ID_VALUE.test(s));
    parts.push(`${p}:${keep ? s : typeof node}`);
  };
  walk(v, depth, path);
  return clip(parts.join(" "), EVIDENCE_CHARS);
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Everything an operator needs to diagnose a refused external call — and nothing a
 * technician would recognise as theirs.
 *
 * A savedr refusal echoes the whole reservation view model back (driver name, phone,
 * email, address), so the RAW body is never persisted. What IS persisted: the masked
 * reason the client extracted, the response SHAPE (the same treatment the `unparsed`
 * path already gets), the HTTP status, the ETD calls this pass made, and the journey,
 * branch, class and dates the pass actually used. "Rejected" means nothing months later
 * without knowing what was on the wire.
 *
 * Query strings are stripped from the logged paths: the autocomplete and branch lookups
 * carry the technician's address and coordinates in theirs.
 */
function failureEvidence(
  err: unknown,
  ctx: { calls: EtdCallLog[]; request: Record<string, unknown> },
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const etdErr = err instanceof EtdError ? err : null;
  return {
    error: clip(errText(err)),
    httpStatus: etdErr?.httpStatus ?? null,
    responseShape:
      etdErr && etdErr.responseBody !== undefined ? redactedShape(etdErr.responseBody) : null,
    etdCalls: ctx.calls
      .slice(-12)
      .map((c) => clip(`${c.method} ${String(c.path).split("?")[0]} -> ${c.status} (${c.ms}ms)`, 120)),
    request: ctx.request,
    at: new Date().toISOString(),
    ...extra,
  };
}

// ---------------------------------------------------------------- schedule

type ScheduleEvidence = {
  source: "in-process";
  fresh: boolean;
  watermarkUtc: string | null;
  watermarkAgeHours: number | null;
  firstWorkingDay: string | null;
  minDate: string;
  checkedAt: string;
  note?: string;
  error?: string;
};

/**
 * The technician's next working day, plus the evidence the server persists alongside
 * the preview. A STALE watermark yields null: booking is hard-stopped until the next
 * schedule load rather than guessing a date the tech may not be working.
 */
async function nextWorkingDay(
  ldap: string,
  readSchedule: NonNullable<ExecutorDeps["schedule"]>,
): Promise<{ day: string | null; evidence: ScheduleEvidence }> {
  const from = etTodayISO();
  const minDate = addDaysISO(from, 1);
  const checkedAt = new Date().toISOString();
  try {
    const win = await readSchedule(ldap, from, SCHEDULE_HORIZON_DAYS);
    const day = win.fresh ? firstWorkingDay(win.days, minDate) : null;
    return {
      day,
      evidence: {
        source: "in-process",
        fresh: win.fresh,
        watermarkUtc: win.watermarkUtc,
        watermarkAgeHours: win.watermarkAgeHours,
        firstWorkingDay: day,
        minDate,
        checkedAt,
        note: win.fresh
          ? undefined
          : "watermark stale (> limit); booking is hard-stopped until the next schedule load",
      },
    };
  } catch (err) {
    return {
      day: null,
      evidence: {
        source: "in-process",
        fresh: false,
        watermarkUtc: null,
        watermarkAgeHours: null,
        firstWorkingDay: null,
        minDate,
        checkedAt,
        error: clip(errText(err)),
      },
    };
  }
}

/** Re-verify a specific date immediately before committing. Any doubt = false. */
async function isWorkingDay(
  ldap: string,
  dateISO: string,
  readSchedule: NonNullable<ExecutorDeps["schedule"]>,
): Promise<boolean> {
  try {
    const win = await readSchedule(ldap, etTodayISO(), SCHEDULE_HORIZON_DAYS);
    if (!win.fresh) return false;
    return win.days.some((d) => d.date === dateISO && d.working);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- addressing

/** (address, preferred branch code, expected state) from the intent's facts. */
export function intentAddress(item: QueueItem): {
  address: string;
  code: string;
  wantState: string;
} {
  const facts = (item.facts || {}) as Record<string, any>;
  const cf = (facts.caseFacts || {}) as Record<string, any>;
  if (item.workflowType === WORKFLOW_CUTOVER) {
    const sb = (facts.surveyBranch || {}) as Record<string, any>;
    const city = sb.city || cf.rentingCity;
    const state = sb.state || cf.rentingState;
    const address = [sb.name, city, state].filter(Boolean).join(", ");
    return {
      address,
      // A contract SWAP must return to the branch holding the Holman agreement.
      code: String(cf.rentingBranch || "").trim(),
      wantState: String(state || "").trim().toUpperCase(),
    };
  }
  const rs = (facts.requestSeed || {}) as Record<string, any>;
  let address = [rs.shopAddress, rs.shopCity, rs.shopState].filter(Boolean).join(", ");
  if (!address) address = String(rs.reportedBranch || "").trim();
  return { address, code: "", wantState: String(rs.shopState || "").trim().toUpperCase() };
}

function branchState(q: QuoteResult): string {
  const m = /,\s*([A-Z]{2})?\s*(\d{5})(?:-\d{4})?\s*$/.exec(String(q.branch?.fullAddress || ""));
  return m ? zipState(m[2]) : "";
}

function branchZip(q: QuoteResult): string {
  const m = /(\d{5})(?:-\d{4})?\s*$/.exec(String(q.branch?.fullAddress || ""));
  return m ? m[1] : "";
}

/**
 * Quote with the wrong-state guard: ETD's geocoder occasionally wanders to a same-named
 * town in another state (the Ventura -> Niagara Falls class of failure). Retrying on
 * just the city/state usually lands it; a second miss is fatal rather than silently
 * booking a technician 2,000 miles away.
 */
async function guardedQuote(
  etd: EtdClient,
  address: string,
  code: string,
  wantState: string,
  start: string,
  end: string,
): Promise<QuoteResult> {
  let q = await etd.quote({ address, start, end, preferBranchCode: code || undefined });
  if (wantState && wantState.length === 2) {
    let got = branchState(q);
    if (got && got !== wantState) {
      const parts = address.split(",");
      const cityState = parts.slice(-2).join(",").trim() || address;
      q = await etd.quote({ address: cityState, start, end, preferBranchCode: code || undefined });
      got = branchState(q);
      if (got && got !== wantState) {
        throw new Error(
          `geocoder put the branch in ${got}, expected ${wantState} (${q.branch_name})`,
        );
      }
    }
  }
  return q;
}

// ---------------------------------------------------------------- class choice

const normLabel = (s: unknown): string =>
  String(s ?? "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/**
 * The class decision the server persists verbatim, plus the raw offered class the
 * payload surgery needs (returned separately so it never reaches the database).
 */
export function classForIntent(
  item: QueueItem,
  classes: CarClass[],
): { decision: RunnerClassDecision & Record<string, unknown>; pick: OfferedClass | null } {
  const facts = (item.facts || {}) as Record<string, any>;
  const offered = classes as unknown as OfferedClass[];

  if (item.workflowType === WORKFLOW_CUTOVER) {
    const cf = (facts.caseFacts || {}) as Record<string, any>;
    const sel = chooseSameVehicle(cf.make, cf.model, offered, facts.surveyVehicleDesc);
    return {
      decision: {
        chosenSipp: sel.code || null,
        mapped: !!sel.pick,
        mode: "same_vehicle",
        match: sel.match,
        detail: sel.note,
        changesVehicle: sel.changes_vehicle,
      },
      pick: sel.pick,
    };
  }

  // The server now normalises to lowercase words ("cargo van"), but legacy rows still
  // carry "cargo_van" — and an underscore can never substring-match an ETD description,
  // which is how the HVAC carve-out would silently go UNMAPPED. Normalise BOTH sides the
  // same way, and treat unset as the engine default: sedan (Tyler, 2026-08-16).
  const want = normLabel((facts.requestSeed || {}).approvedVehicleClass) || "sedan";
  let pick: OfferedClass | null =
    offered.find(
      (c) => normLabel(c.description).includes(want) || want === normLabel(c.code),
    ) ?? null;
  let match = pick ? "approved_label" : "UNMAPPED";
  let note = pick
    ? `approved class '${want}' matched ${String(pick.code)}`
    : `approved class '${want}' not offered at this branch`;

  if (!pick && want === "sedan") {
    // ETD class descriptions rarely contain the literal word "sedan", so the default
    // would park EVERY plain request for a human. The sedan ladder (no job title — the
    // class is already decided) picks a real offered code instead. Named classes ('suv',
    // 'cargo van') still require a literal match or a person.
    const lad = chooseClass(null, null, offered, null);
    if (lad.pick) {
      pick = lad.pick;
      match = "sedan_ladder";
      note = `sedan via ladder: ${lad.note}`;
    }
  }

  return {
    decision: {
      chosenSipp: String(pick?.code || "") || null,
      mapped: !!pick,
      mode: "approved_class",
      match,
      detail: note,
      changesVehicle: null,
    },
    pick,
  };
}

// ---------------------------------------------------------------- preview lane

async function runPreview(
  etd: EtdClient,
  item: QueueItem,
  days: number,
  runnerId: string,
  readSchedule: NonNullable<ExecutorDeps["schedule"]>,
): Promise<ExecutorResult> {
  const { intentId, ldap } = item;
  const { day: firstDay, evidence } = await nextWorkingDay(ldap, readSchedule);

  const quote: RunnerQuote & Record<string, unknown> = {
    scheduleEvidence: evidence as any,
    warnings: [],
    branchCode: null,
    branchName: null,
    branchAddress: null,
    branchZip: null,
    branchPinned: false,
    pickupDate: "",
  };
  let classDecision: RunnerClassDecision & Record<string, unknown> = {
    chosenSipp: null,
    mapped: false,
    mode: item.workflowType === WORKFLOW_CUTOVER ? "same_vehicle" : "approved_class",
    detail: "no quote taken",
  };

  if (firstDay) {
    try {
      const start = `${firstDay}T09:00:00`;
      const end = fmtISO(addDaysDT(parseLocalDT(start), days));
      const { address, code, wantState } = intentAddress(item);
      if (!address) throw new Error("no branch/shop address seed on the intent facts");

      const q = await guardedQuote(etd, address, code, wantState, start, end);
      const classes = q.classes || [];
      const chosen = classForIntent(item, classes);
      classDecision = chosen.decision;

      Object.assign(quote, {
        pickupDate: firstDay,
        pickupTime: "09:00:00",
        returnDate: end.slice(0, 10),
        returnTime: "09:00:00",
        branchCode: q.branch_code,
        branchName: q.branch_name,
        branchAddress: q.branch_address,
        branchZip: branchZip(q),
        branchPinned: !!q.branch_pinned,
        journeyId: q.journey_id,
        reference: q.reference,
        offeredClasses: classes.map((c) => ({ code: c.code, description: c.description })),
      });
    } catch (err) {
      quote.warnings = [clip(errText(err))];
    }
  }

  const body = await persistPreviewFromRunner({
    intentId,
    runnerId,
    fencingToken: item.fencingToken,
    quote,
    classDecision,
  });
  const fails = (body.failures || []).map((f: any) => f.code ?? "?").join(",");
  const detail = [
    fails ? `[${fails}]` : "",
    quote.warnings?.length ? clip(quote.warnings[0], 160) : "",
  ]
    .filter(Boolean)
    .join(" ");
  console.log(
    `[etd-exec] PREV #${intentId} ${ldap} -> ${body.status}${detail ? `  ${detail}` : ""}`,
  );
  return { intentId, ldap, kind: item.kind, action: "PREV", status: body.status, detail };
}

// ---------------------------------------------------------------- readback

export type JourneyRow = {
  confirmation: string;
  reference: string;
  branchCode: string;
  date: string;
  sipp: string;
};

/** Strip the COUNT suffix ETD appends on some reservation numbers. */
function stripCount(v: string): string {
  return v.toUpperCase().endsWith("COUNT") ? v.slice(0, -5) : v;
}

/**
 * Best-effort reservation rows from ETD's journey search.
 *
 * A search FAILURE returns an error, and callers MUST post it as `search.status:"error"`
 * so the server never mistakes a broken search for an authoritative "no reservation
 * exists". The server classifies; this only extracts.
 */
export function extractJourneyRows(res: unknown): JourneyRow[] {
  const rows: JourneyRow[] = [];
  const walk = (node: any): void => {
    if (Array.isArray(node)) {
      for (const v of node) walk(v);
      return;
    }
    if (!node || typeof node !== "object") return;
    const lk: Record<string, any> = {};
    for (const [k, v] of Object.entries(node)) lk[k.toLowerCase()] = v;
    let conf = lk.reservationnumber ?? lk.confirmationnumber;
    if (conf && typeof conf === "object") conf = (conf as any).number;
    const ref = lk.referencenumber;
    if (conf || ref) {
      rows.push({
        confirmation: stripCount(String(conf ?? "").trim()),
        reference: String(ref ?? "").trim(),
        branchCode: String(lk.branchcode ?? lk.startbranchcode ?? "").trim(),
        date: String(lk.startdatetime ?? lk.startdate ?? "").slice(0, 10),
        sipp: String(lk.carclasscode ?? lk.vehicleclasscode ?? lk.carclass ?? "").trim(),
      });
    }
    for (const v of Object.values(node)) walk(v);
  };
  walk(res);

  const seen = new Set<string>();
  const out: JourneyRow[] = [];
  for (const r of rows) {
    const key = `${r.confirmation}\u0000${r.reference}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/** What may positively identify a journey as ONE intent's reservation. */
export type JourneyIdentity = {
  /** A confirmation number already known to belong to this intent. */
  confirmation?: string | null;
  /** The intent's unique SHS reference — it rides ETD's one reference field. */
  intentRef?: string | null;
};

/**
 * Rows that POSITIVELY identify as this intent's reservation.
 *
 * Identification is the intent's unique SHS reference carried in ETD's reference
 * field, or a confirmation number already known to belong to the intent. Nothing
 * else counts — and in particular "the search returned rows" does not: ETD's
 * Last30Days journey list carries every QUOTE the engine has ever taken, not just
 * reservations, so a criteria search routinely answers with dozens of unrelated
 * journeys. This used to end in `return rows`, which reported all of them as this
 * intent's reservations and parked first-ever bookings in MANUAL REVIEW as phantom
 * duplicates.
 *
 * The LDAP is deliberately NOT an identifier: one technician can own many
 * journeys, so an LDAP-carrying reference says "this tech", never "this intent".
 * When nothing identifies, the answer is an EMPTY list — "no reservation of ours
 * is visible" — never "here is everything the search returned".
 */
export function identifyJourneyRows(rows: JourneyRow[], identity: JourneyIdentity): JourneyRow[] {
  const conf = String(identity.confirmation ?? "").trim().toUpperCase();
  const ref = String(identity.intentRef ?? "").trim().toUpperCase();
  if (!conf && !ref) return [];
  return rows.filter(
    (r) =>
      (!!conf && r.confirmation.trim().toUpperCase() === conf) ||
      (!!ref && r.reference.toUpperCase().includes(ref)),
  );
}

export type JourneySearch = {
  /** Rows that positively identify as this intent's reservation. */
  matches: JourneyRow[];
  /** Every distinct journey row the search produced, identified or not. */
  rowsReturned: number;
  /** The criteria handed to ETD, in the order they were tried. */
  criteria: string[];
  error: string | null;
};

async function journeyMatches(
  etd: EtdClient,
  criteria: string,
  identity: JourneyIdentity,
): Promise<JourneySearch> {
  let res: unknown;
  try {
    res = await etd.searchJourneys({ criteria: criteria || "", period: "Last30Days" });
  } catch (err) {
    return { matches: [], rowsReturned: 0, criteria: [criteria], error: clip(errText(err)) };
  }
  const rows = extractJourneyRows(res);
  return {
    matches: identifyJourneyRows(rows, identity),
    rowsReturned: rows.length,
    criteria: [criteria],
    error: null,
  };
}

/**
 * The `search` block posted with every readback.
 *
 * `rowsReturned` vs `identified` is what makes a later misfire diagnosable from
 * the ledger: "0 identified of 65 rows" says the search was noisy and none of it
 * was ours; "0 of 0" says ETD answered empty. A bare match count says neither.
 */
function searchEvidence(s: {
  criteria: string[];
  rowsReturned: number;
  matches: JourneyRow[];
  error: string | null;
}): Record<string, unknown> {
  return {
    status: s.error ? "error" : "ok",
    criteria: s.criteria,
    rowsReturned: s.rowsReturned,
    identified: s.matches.length,
    error: s.error,
  };
}

/**
 * `data.reservationNumber.number`, then a shape-agnostic dig.
 *
 * The `referenceNumber` fallback is deliberately ABSENT: that field is the QUOTE
 * reference, not a reservation confirmation, and recording it poisons downstream
 * readbacks (branches cannot look it up and the journey search matches nothing).
 * UNPARSED plus a readback beats confidently wrong.
 */
export function parseConfirmation(out: any): string {
  const dig = (node: any, keys: string[]): string | null => {
    if (Array.isArray(node)) {
      for (const v of node) {
        const got = dig(v, keys);
        if (got) return got;
      }
      return null;
    }
    if (!node || typeof node !== "object") return null;
    for (const [k, v] of Object.entries(node)) {
      const kl = k.toLowerCase();
      if (
        keys.some((s) => kl.includes(s)) &&
        (typeof v === "string" || typeof v === "number") &&
        String(v).trim() &&
        String(v).trim() !== "0"
      ) {
        return String(v).trim();
      }
    }
    for (const v of Object.values(node)) {
      const got = dig(v, keys);
      if (got) return got;
    }
    return null;
  };

  // A numeric 0 is ETD's "no number", and `str(0)` is truthy in JS where Python's
  // `0 or ""` is not — without this the port would record "0" as a confirmation and
  // every later readback would hunt for a reservation that does not exist.
  const rawDirect = out?.data?.reservationNumber?.number;
  const direct = rawDirect === 0 ? "" : String(rawDirect ?? "").trim();
  const confirmation =
    direct || dig(out, ["confirmation"]) || dig(out, ["reservationnumber", "reservationno"]) || "";
  return confirmation ? stripCount(confirmation) : "";
}

// ---------------------------------------------------------------- booking lane

/**
 * The attempt's request hash — the ledger's idempotency key for "this booking".
 *
 * Byte-identical to the Python runner's, because BOTH runners write into the same
 * attempt ledger: `hashlib.sha256(json.dumps({branch, date, ldap, sipp}, sort_keys=True))`
 * truncated to 32 hex. Python's default separators are ", " and ": ", and its keys come
 * out alphabetically — reproduced literally here rather than via JSON.stringify(obj),
 * whose separators differ. Pinned against the real Python output in
 * tests/etd-executor-unit.test.ts; a drift here silently breaks cross-runner dedupe.
 */
export function bookingRequestHash(p: {
  branch: string;
  date: string;
  ldap: string;
  sipp: string;
}): string {
  const canonical =
    `{"branch": ${JSON.stringify(p.branch)}, "date": ${JSON.stringify(p.date)}, ` +
    `"ldap": ${JSON.stringify(p.ldap)}, "sipp": ${JSON.stringify(p.sipp)}}`;
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

async function runBook(
  etd: EtdClient,
  item: QueueItem,
  template: Record<string, unknown>,
  mapping: Record<string, string>,
  oldJ: string | null,
  oldR: string | null,
  runnerId: string,
  readSchedule: NonNullable<ExecutorDeps["schedule"]>,
): Promise<ExecutorResult> {
  const { intentId, ldap } = item;
  const mode = item.executionMode;
  const facts = (item.facts || {}) as Record<string, any>;
  const prev = (item.preview || {}) as Record<string, any>;
  const resv = (prev.reservation || {}) as Record<string, any>;

  const post = (phase: "op_open" | "op_result" | "readback", payload: any) =>
    recordBookingPostback({
      intentId,
      runnerId,
      fencingToken: item.fencingToken,
      phase,
      payload,
    });

  const result = (action: ExecutorAction, status: string, detail?: string): ExecutorResult => {
    console.log(`[etd-exec] ${action} #${intentId} ${ldap} ${status}${detail ? ` — ${detail}` : ""}`);
    return { intentId, ldap, kind: item.kind, action, status, detail };
  };

  const intentRef = String(resv.intentReference || `SHSNX-${intentId}`);

  // The ETD client is shared across every intent in a pass, so the call log has to be
  // sliced to THIS intent's calls before it becomes evidence.
  const callsAtStart = etd.calls?.length ?? 0;
  const passCalls = (): EtdCallLog[] => (etd.calls ?? []).slice(callsAtStart);

  // An unfinished attempt exists (crash mid-booking), a reconcile was ordered, or this
  // is a cancel-lane claim: readback FIRST/ONLY. The criteria widen (intent reference or
  // known confirmation, then the LDAP) because they are only ETD's server-side filter —
  // what a row MEANS is decided by identifyJourneyRows, which never widens. The server
  // decides what a found (or not-found) journey means; the search meta tells it whether
  // a "none" is authoritative.
  if (item.requiresReconcile || item.kind === "cancel") {
    const knownConf = String((item as any).reservationEvidence?.confirmation ?? "");
    const identity: JourneyIdentity = { confirmation: knownConf, intentRef };
    const criteria = [knownConf || intentRef];
    let search = await journeyMatches(etd, criteria[0], identity);
    let rowsReturned = search.rowsReturned;
    if (!search.matches.length && !search.error) {
      criteria.push(ldap);
      search = await journeyMatches(etd, ldap, identity);
      rowsReturned += search.rowsReturned;
    }
    const body = await post("readback", {
      matches: search.matches,
      expected: knownConf ? { confirmation: knownConf } : {},
      search: searchEvidence({ ...search, criteria, rowsReturned }),
    });
    return result(
      "RECON",
      String(body?.status ?? "readback"),
      `${item.kind === "cancel" ? "cancel-" : ""}readback (${search.matches.length} identified of ${rowsReturned} row(s))`,
    );
  }

  // Defense in depth. A live intent is already unclaimable while the flag is disarmed
  // (claimBookingWork filters it out), so reaching here means the flag flipped mid-pass.
  if (mode === "live" && !isContractBlockLive()) {
    return result("SKIP", "live_disarmed", "live intent but the contract-block flag is not armed");
  }

  const pickup = String(resv.pickupDate || "");
  const sipp = String(resv.sipp || "");
  const wantBranch = String(resv.branchCode || "");
  if (!(pickup && sipp && wantBranch)) {
    await post("op_result", {
      outcome: "aborted_before_open",
      evidence: { reason: "preview lacks pickupDate/sipp/branchCode" },
    });
    return result("ABRT", "aborted_before_open", "preview incomplete");
  }

  // 1. The confirmed date must still be a verified working day.
  if (!(await isWorkingDay(ldap, pickup, readSchedule))) {
    await post("op_result", {
      outcome: "aborted_before_open",
      evidence: { reason: `${pickup} no longer a verified working day` },
    });
    return result("ABRT", "aborted_before_open", `${pickup} no longer a working day`);
  }

  // 2. Fresh journey, then exact-match against the confirmed preview.
  let q: QuoteResult;
  let start: string;
  let end: string;
  try {
    const { address, code, wantState } = intentAddress(item);
    start = `${pickup}T${String(resv.pickupTime || "09:00:00").slice(0, 8)}`;
    const retDate = String(resv.returnDate || "").slice(0, 10);
    end = retDate
      ? `${retDate}T${String(resv.returnTime || "09:00:00").slice(0, 8)}`
      : fmtISO(addDaysDT(parseLocalDT(start), DEFAULT_DAYS));
    q = await guardedQuote(etd, address, wantBranch || code, wantState, start, end);
  } catch (err) {
    await post("op_result", {
      outcome: "aborted_before_open",
      evidence: { reason: `fresh quote failed: ${clip(errText(err), 200)}` },
    });
    return result("ABRT", "aborted_before_open", `fresh quote failed: ${clip(errText(err), 120)}`);
  }

  const gotBranch = String(q.branch_code || "");
  const pick = (q.classes || []).find(
    (c) => String(c.code || "").toUpperCase() === sipp.toUpperCase(),
  );
  if (gotBranch !== wantBranch || !pick) {
    const reason =
      gotBranch !== wantBranch
        ? `branch drift ${wantBranch}->${gotBranch}`
        : `class ${sipp} no longer offered`;
    await post("op_result", { outcome: "aborted_before_open", evidence: { reason } });
    return result("ABRT", "aborted_before_open", reason);
  }

  // 3. Build the exact model with the proven payload surgery.
  const username = mapping[ldap] || ldap;
  const user = await etd.findUserByUsername(username);
  if (!user) {
    await post("op_result", {
      outcome: "aborted_before_open",
      evidence: { reason: `no ETD user for ${username}` },
    });
    return result("ABRT", "aborted_before_open", `no ETD user for ${username}`);
  }

  const truck = String(facts.tpmsTruck || prev.tpmsTruck || "");
  const model = cloneTemplate(template);
  retarget(
    model,
    q.journey_id,
    q.reference ?? "",
    oldJ,
    oldR,
    start,
    end,
    (template as any).startDateTime,
    (template as any).endDateTime,
  );
  redate(model, parseLocalDT(start), parseLocalDT(end));
  relocate(model, q.branch, q.place);
  setClass(model, pick as unknown as Record<string, unknown>);
  model.boboId = (user as any).userId;
  model.isBOBOToggleEnabled = true;
  model.isBOBOBooking = true;
  // The account's field list, read now. Never the capture's — see
  // useAccountAdditionalInfo.
  try {
    useAccountAdditionalInfo(model, await etd.accountAdditionalInfoFields());
  } catch (err) {
    await post("op_result", {
      outcome: "aborted_before_open",
      evidence: { reason: `additional-info lookup failed: ${clip(errText(err), 200)}` },
    });
    return result("ABRT", "aborted_before_open", `additional-info lookup failed: ${clip(errText(err), 120)}`);
  }
  setDriver(model, user as Record<string, unknown>, ldap, String(facts.techName || ldap), truck);
  try {
    assertAdditionalInfoComplete(model, ldap);
  } catch (err) {
    await post("op_result", {
      outcome: "aborted_before_open",
      evidence: { reason: clip(errText(err), 200) },
    });
    return result("ABRT", "aborted_before_open", clip(errText(err), 160));
  }

  // Server-rendered text is the single source; nothing is composed here.
  const note = String(resv.specialNotes || "").trim();
  if (note) {
    model.notes = note;
    model.notesViewModel = { reservationNote: note };
  }

  const refs = ((resv.bookingReferences || []) as unknown[]).map((x) => String(x));
  // ETD surfaces ONE reference value on the Open RA report (the first entry; LDAP owns
  // it). The intent reference must ride IN that same field — as a separate list entry it
  // never reaches the report or the journey search — or readbacks can never find THIS
  // intent's reservation.
  if (refs.length && intentRef && !refs[0].includes(intentRef)) {
    refs[0] = `${refs[0]} ${intentRef}`.trim();
  }
  if (refs.length) model.bookingReferences = refs;

  const requestHash = bookingRequestHash({ branch: gotBranch, date: pickup, ldap, sipp });

  // What this pass actually put on the wire. Recorded with every failure so a refusal is
  // diagnosable from the ledger alone, without re-deriving the inputs from a preview that
  // may since have been rebuilt.
  const passRequest: Record<string, unknown> = {
    journeyId: q.journey_id,
    quoteReference: q.reference,
    branchCode: gotBranch,
    branchName: clip(q.branch_name, 60),
    sipp,
    pickupDate: pickup,
    start,
    end,
    requestHash,
  };

  // 3.5 Pre-commit duplicate search: before opening an attempt, ask ETD whether THIS
  // intent already has a reservation (a crash after a commit but before op_result, a
  // double claim, ...). Only a row that POSITIVELY identifies as this intent's counts —
  // the search itself returns every journey ETD will hand over for the criteria, most of
  // them unrelated quotes. Identified -> post the readback and stop; the server settles
  // the true state. Search error -> do NOT proceed to booking on a blind spot.
  const dup = await journeyMatches(etd, intentRef, { intentRef });
  if (dup.error) {
    return result("HOLD", "search_failed", `pre-commit duplicate search failed: ${clip(dup.error, 120)}`);
  }
  if (dup.matches.length) {
    const body = await post("readback", {
      matches: dup.matches,
      expected: {},
      search: searchEvidence(dup),
    });
    return result(
      "DUPE",
      String(body?.status ?? "readback"),
      `pre-commit search identified ${dup.matches.length} existing reservation(s) for this intent (of ${dup.rowsReturned} row(s)); no new booking`,
    );
  }

  // 4. Open the attempt BEFORE any call that could create a reservation.
  let openBody: any;
  try {
    openBody = await post("op_open", {
      requestHash,
      request: { branchCode: gotBranch, sipp, pickupDate: pickup, journeyId: q.journey_id },
    });
  } catch (err) {
    const code = err instanceof OrchestratorError ? err.code : "error";
    return result("HOLD", code, clip(errText(err), 160));
  }
  if (!openBody?.accepted) {
    const fails = (openBody?.failures || []).map((f: any) => f.code ?? "?").join(",");
    return result("HOLD", String(openBody?.status ?? "not_accepted"), fails || undefined);
  }
  const attemptNo = openBody.attemptNo;

  // 5. Validation gates (non-mutating). A gate that answers success:false normally
  // raises out of the client; the inline branch is the belt to that suspenders. Both
  // record the SAME evidence a refused commit does — a validator rejection is the one
  // signal that says why the commit would have been refused, and dumping the raw gate
  // body here used to leak the whole driver-bearing model into the ledger.
  try {
    for (const gate of ["/api/dailyrental/validateLocAddInfo", "/api/dailyrental/validate"]) {
      const gr = await etd.postGate(gate, model);
      if (!(gr?.success || gr?.succecss)) {
        await post("op_result", {
          outcome: "failed_clean",
          attemptNo,
          evidence: {
            error: `${gate}: ${safeErrorText(rejectionReasons(gr))}`,
            httpStatus: 200,
            responseShape: redactedShape(gr),
            etdCalls: passCalls()
              .slice(-12)
              .map((c) => clip(`${c.method} ${String(c.path).split("?")[0]} -> ${c.status} (${c.ms}ms)`, 120)),
            request: passRequest,
            gate,
            at: new Date().toISOString(),
          },
        });
        return result("FAIL", "failed_clean", `${gate} rejected`);
      }
    }
  } catch (err) {
    await post("op_result", {
      outcome: "failed_clean",
      attemptNo,
      evidence: failureEvidence(err, { calls: passCalls(), request: passRequest }, {
        stage: "validation_gate",
      }),
    });
    return result("FAIL", "failed_clean", `validation gate: ${clip(errText(err), 120)}`);
  }

  // 6. Dark modes STOP here — everything proven except the commit.
  if (mode !== "live") {
    await post("op_result", {
      outcome: "dry_run_validated",
      attemptNo,
      evidence: {
        gates: "validateLocAddInfo+validate passed",
        branch: q.branch_name,
        sipp,
      },
    });
    return result(
      "DARK",
      "dry_run_validated",
      `${mode}: gates passed, no commit (${sipp} at ${clip(q.branch_name, 28)} ${pickup})`,
    );
  }

  // 7. LIVE commit. The request model is NOT written to disk — it carries driver PII and
  // the evidence that matters (hash, branch, sipp, date) is already in the attempt row.
  let out: any;
  try {
    out = await etd.confirmReservation(model, { live: true });
  } catch (err) {
    await post("op_result", {
      outcome: "exception",
      attemptNo,
      evidence: failureEvidence(err, { calls: passCalls(), request: passRequest }, {
        stage: "savedr_commit",
      }),
    });
    return result("HOLD", "exception", `confirm raised: ${clip(errText(err), 120)} (readback will decide)`);
  }

  const confirmation = parseConfirmation(out);
  let bookAction: ExecutorAction = "BOOK";
  let bookStatus = "booked";
  let bookDetail = "";
  if (confirmation) {
    await post("op_result", {
      outcome: "booked",
      attemptNo,
      evidence: { confirmation, quoteReference: q.reference },
    });
    bookDetail = `conf ${confirmation}  ${q.branch_name}`;
  } else {
    // An unparsed commit still has to be resolvable, but a savedr response carries the
    // renter's name, address and phone — none of which may be persisted. So the
    // evidence keeps the SHAPE (which tells a developer why the parser missed) plus
    // id-like fields only. The reservation itself is found by the readback below.
    await post("op_result", {
      outcome: "unparsed",
      attemptNo,
      evidence: {
        error: "no confirmation parsed from savedr response",
        responseShape: redactedShape(out),
      },
    });
    bookAction = "HOLD";
    bookStatus = "unparsed";
    bookDetail = "booked but confirmation UNPARSED (readback will decide)";
  }

  // 8. Journey readback — the only path to reservation_verified.
  const rbCriteria = confirmation || intentRef;
  const rb = await journeyMatches(etd, rbCriteria, { confirmation, intentRef });
  const rbBody = await post("readback", {
    matches: rb.matches,
    expected: { confirmation },
    search: searchEvidence(rb),
  });
  const readbackStatus = String(rbBody?.status ?? "readback");
  return result(
    bookAction,
    bookStatus,
    `${bookDetail} | readback (${rb.matches.length} identified of ${rb.rowsReturned} row(s)) -> ${readbackStatus}`,
  );
}

// ---------------------------------------------------------------- entry point

/**
 * Serialize passes. Two staff clicks arriving together must not both drive the ETD
 * chain: the claim already prevents double-booking one intent, but overlapping passes
 * would mint tokens and quote in parallel for no benefit and a lot of noise.
 */
let chain: Promise<unknown> = Promise.resolve();

async function executePass(opts: {
  runnerId: string;
  intentId?: number;
  workflowType?: string;
  limit: number;
  days: number;
  deps: ExecutorDeps;
}): Promise<ExecutorRun> {
  const items = await claimBookingWork({
    runnerId: opts.runnerId,
    limit: opts.limit,
    workflowType: opts.workflowType,
    intentId: opts.intentId,
  });

  const armed = isContractBlockLive();
  const results: ExecutorResult[] = [];
  const etd = opts.deps.client ?? new EtdClient();
  const readSchedule = opts.deps.schedule ?? fetchScheduleWindow;

  if (!items.length) {
    return { runnerId: opts.runnerId, claimed: 0, results, armed, timing: etd.timingSummary() };
  }

  console.log(
    `[etd-exec] ${items.length} intent(s) claimed by ${opts.runnerId} ` +
      `(${items.filter((i) => i.kind === "preview").length} preview, ` +
      `${items.filter((i) => i.kind === "book").length} book, ` +
      `${items.filter((i) => i.kind === "cancel").length} cancel); armed=${armed}`,
  );

  // The template and mapping are only needed by the booking lane, and a missing file
  // must not stop previews from running.
  let template: Record<string, unknown> | null = null;
  let mapping: Record<string, string> = {};
  let oldJ: string | null = null;
  let oldR: string | null = null;
  const needsBooking = items.some((i) => i.kind !== "preview" && !i.requiresReconcile);
  if (needsBooking) {
    try {
      template = loadSavedrTemplate();
      mapping = loadUserMapping();
      ({ oldJ, oldR } = templateOldIds(template));
    } catch (err) {
      console.error(`[etd-exec] booking assets unavailable: ${errText(err)}`);
    }
  }

  for (const item of items) {
    try {
      if (item.kind === "preview") {
        results.push(await runPreview(etd, item, opts.days, opts.runnerId, readSchedule));
      } else if (!template && !item.requiresReconcile) {
        results.push({
          intentId: item.intentId,
          ldap: item.ldap,
          kind: item.kind,
          action: "ERR",
          status: "assets_missing",
          detail: "savedr template / user mapping unavailable on this host",
        });
      } else {
        results.push(
          await runBook(etd, item, template ?? {}, mapping, oldJ, oldR, opts.runnerId, readSchedule),
        );
      }
    } catch (err) {
      const code = err instanceof OrchestratorError ? err.code : "error";
      console.error(`[etd-exec] ERR #${item.intentId} ${clip(errText(err), 200)}`);
      results.push({
        intentId: item.intentId,
        ldap: item.ldap,
        kind: item.kind,
        action: "ERR",
        status: code,
        detail: clip(errText(err), 200),
      });
    }
  }

  return {
    runnerId: opts.runnerId,
    claimed: items.length,
    results,
    armed,
    timing: etd.timingSummary(),
  };
}

/**
 * Claim and serve booking work in-process. One pass, no polling: the caller is a staff
 * click or the morning sweep, and anything left claimed is picked up by the next pass
 * once its lease expires.
 */
export function runBookingExecutor(
  opts: {
    runnerId?: string;
    intentId?: number;
    workflowType?: string;
    limit?: number;
    days?: number;
    /** Test seam only. Production always uses the real client and schedule read. */
    deps?: ExecutorDeps;
  } = {},
): Promise<ExecutorRun> {
  const params = {
    runnerId: opts.runnerId || "nexus-inline",
    intentId: opts.intentId,
    workflowType: opts.workflowType,
    limit: Math.max(1, Math.min(opts.limit ?? 5, 20)),
    days: Math.max(1, Math.min(opts.days ?? DEFAULT_DAYS, 30)),
    deps: opts.deps ?? {},
  };
  const next = chain.then(
    () => executePass(params),
    () => executePass(params),
  );
  // Keep the chain alive regardless of outcome; the caller owns the rejection.
  chain = next.catch(() => undefined);
  return next;
}
