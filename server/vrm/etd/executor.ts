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
  WORKFLOW_REQUEST,
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
import { ensureEtdUser } from "./ensure-user";
// The last-pickup cutoff lives in one leaf module and is imported by both the
// booking preview and the approval SMS. Two copies of this rule would let the
// technician be promised a day the booking does not use, which is exactly the
// bug this fixed on 2026-08-25.
import { notBeforeNowET, resolvePickupWindow } from "./pickup-window";
export { notBeforeNowET };
import {
  choose as chooseClass, chooseSameVehicle, isHvac, ESCALATION_LADDER, descClass,
  NAMED_DOWNGRADE, SEDAN_LADDER, SEDAN_CODES,
  type OfferedClass,
} from "./vehicle-class";
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
  stripTruckNumberReference,
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
  opts: { sameDay?: boolean; requestedAt?: string | null } = {},
): Promise<{ day: string | null; evidence: ScheduleEvidence }> {
  const from = etTodayISO();
  const checkedAt = new Date().toISOString();
  // A cutover books a branch visit into TOMORROW's route and files a 30-minute
  // block against it, so the earliest day is today+1 AND it has to be a day the
  // technician is scheduled. A rental request is the opposite case: the van is
  // already off the road, today is the entire point, and a ServicePower shift is
  // not a precondition for renting someone a car. Requiring one meant a
  // technician with no route in the 21-day window could never be booked at all,
  // and reported as four separate failures (no_date, quote_failed,
  // class_unmapped, branch_zip_missing) that were all the same cause.
  if (opts.sameDay) {
    // The date the technician picked on the form, floored at today. Never the
    // schedule's opinion: this lane files no route block, so there is nothing for a
    // working day to protect, and the person filling in the form is the one who knows
    // when they can collect a car.
    const asked = String(opts.requestedAt ?? "").slice(0, 10);
    const day = /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked > from ? asked : from;
    return {
      day,
      evidence: {
        source: "in-process",
        fresh: true,
        watermarkUtc: null,
        watermarkAgeHours: null,
        firstWorkingDay: day,
        minDate: from,
        checkedAt,
        note:
          `request pickup ${day}` +
          (asked && asked !== day ? ` (form asked ${asked}, floored at today)` : "") +
          "; no schedule gate",
      },
    };
  }
  const minDate = addDaysISO(from, 1);
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
  // Fleet's branch wins over everything. A person typed it on the approval to book
  // something the unattended guards refuse, so it also switches the state guard off:
  // the guard exists to catch a geocode that wandered off an address nobody checked,
  // and this address WAS checked, by a person. Second-guessing a human's explicit
  // branch is the behaviour Tyler asked to remove on 2026-08-20. Mirrors `book_one`
  // in etd-runner/scripts/book_request.py — change both or neither. VPRAK request
  // #110 (2026-08-24) is why this exists here too: a BYOV breakdown with no shop and
  // no reported branch, where the operator typed the Peoria branch on the approval
  // and this lane quoted from nothing anyway.
  const fleetBranch = String(rs.approvedBranch || "").trim();
  if (fleetBranch) {
    return { address: fleetBranch, code: "", wantState: "" };
  }
  // BSOKOLO request b17c091a (2026-08-25): street "Na", city "Na", state PA —
  // the technician's way of writing "not applicable" (truck taken off the
  // road, no shop). Joined, "Na, PA" geocoded to the Balearic Islands and the
  // US guard stopped the booking — even though his reported branch
  // ("Enterprise 300 pinewood dr Warrendale pa 15086") was fully locatable.
  // A placeholder is an answer of NO answer, and a state alone names no
  // place: with every free-text shop field scrubbed empty this is a NO-SHOP
  // request, so fall through to the reported branch like one.
  const shopStreet = scrubPlaceholder(rs.shopAddress);
  const shopCity = scrubPlaceholder(rs.shopCity);
  const shopPostal = scrubPlaceholder(rs.shopPostal);
  let address = (shopStreet || shopCity || shopPostal)
    ? joinAddress([shopStreet, shopCity, rs.shopState, shopPostal])
    : "";
  if (!address) {
    // No shop: a new hire awaiting a vehicle. Their typed branch is all we have, and it
    // is free text - LGONZ15 typed the single word "Enterprise", which geocoded to
    // Boston Logan International Airport and booked a California technician a car 3,000
    // miles away on 2026-08-19. A string with no street number, no ZIP and no state
    // names no place on earth; refuse it rather than let the geocoder pick.
    const reported = String(rs.reportedBranch || "").trim();
    const locatable = /\d/.test(reported) || /(^|[\s,])[A-Z]{2}([\s,]|$)/.test(reported.toUpperCase());
    if (!locatable) {
      throw new Error(
        `the technician's reported branch (${JSON.stringify(reported)}) names no location - ` +
        "no street number, ZIP or state - and there is no shop address to fall back on",
      );
    }
    address = reported;
  }
  // shopState first, then the technician's home state. Never empty when we know either,
  // because an empty wantState turns the wrong-geocode guard OFF entirely.
  const want = String(rs.shopState || rs.homeState || "").trim().toUpperCase();
  return { address, code: "", wantState: want.slice(0, 2) };
}

/**
 * Assemble an address a geocoder can actually read.
 *
 * Technicians type the town into the street box as well, and the city field arrives
 * with its own trailing comma, so a plain join produced
 * "8000 Stream Walk Ln, Manassas, Manassas,, VA" - a duplicated town and an empty
 * component. That geocoded to VALENCIA, SPAIN, and because the branch search is pinned
 * to countryCode=US it came back with a bare rejection and no reason text, which then
 * surfaced as four unrelated-looking failures. Trim each part, drop empties, and drop
 * any part already contained in what came before it.
 */
/**
 * A field whose ENTIRE content is a placeholder token is an answer of no
 * answer. Matched whole-field and anchored so real places survive: "Natrona
 * Heights" is not "na", "Xenia" is not "x". Mirrors `_scrub_placeholder` in
 * etd-runner/scripts/book_request.py — change both or neither.
 */
export function scrubPlaceholder(raw: unknown): string {
  const s = String(raw ?? "").trim();
  return /^(?:n\/?a|n\.a\.?|none|null|unknown|unk|tbd|x+|-+|\?+|\.+)$/i.test(s) ? "" : s;
}

export function joinAddress(parts: Array<unknown>): string {
  const out: string[] = [];
  for (const raw of parts) {
    const part = String(raw ?? "").replace(/^[\s,]+/, "").replace(/[\s,]+$/, "").trim();
    if (!part) continue;
    if (out.join(", ").toLowerCase().includes(part.toLowerCase())) continue;
    out.push(part);
  }
  return out.join(", ");
}

/**
 * Is this somewhere Enterprise US could plausibly be?
 *
 * Continental US plus Alaska and Hawaii, generously bounded. A sanity check on a
 * geocode, not a geography lesson: its only job is to catch an address that resolved
 * to another continent BEFORE we ask for branches near it.
 */
export function looksUnitedStates(lat: number, lon: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  const contiguous = lat >= 24 && lat <= 50 && lon >= -125 && lon <= -66;
  const alaska = lat >= 51 && lat <= 72 && lon >= -170 && lon <= -129;
  const hawaii = lat >= 18 && lat <= 23 && lon >= -161 && lon <= -154;
  return contiguous || alaska || hawaii;
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
  nearbyOnEmpty = false,
): Promise<QuoteResult> {
  let q = await etd.quote({ address, start, end, preferBranchCode: code || undefined, nearbyOnEmpty });
  if (wantState && wantState.length === 2) {
    let got = branchState(q);
    if (got && got !== wantState) {
      const parts = address.split(",");
      const cityState = parts.slice(-2).join(",").trim() || address;
      q = await etd.quote({ address: cityState, start, end, preferBranchCode: code || undefined, nearbyOnEmpty });
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
/**
 * Quote, and when the shop address resolves to a branch that stocks nothing, re-quote
 * from the branch the technician named on the form.
 *
 * The NEAREST branch is not always a branch we can rent from. Request #95 (SWICKLA,
 * 2026-08-24) geocoded to its repair shop in Eau Claire and took the closest counter,
 * `44N1 EAU NATIONAL` at 5.66 mi - a National-brand desk that returns an EMPTY class
 * list on this account. The next one out, `44V6 EAU CLAIRE AIRPORT`, is Enterprise-brand
 * and returns nothing either. The real branch, `4450 EAU CLAIRE`, sits 0.29 mi further
 * at 5.94 mi with 17 classes on the lot, including the exact class that was approved.
 * An empty list surfaces as `class_unmapped`, so the request sat for hours reading like
 * a vehicle-mapping bug while a car was available the whole time.
 *
 * `book_request.py` has carried this fallback since the 8/13 cutover, and that is the
 * only reason the Python booker rescued #95 when this path could not. The technician
 * answered "which Enterprise branch is nearest you" on the form; when our own geocode
 * lands somewhere that cannot rent, their answer is the better address. Mirrors
 * `book_one`'s `used_reported` block - change both or neither.
 *
 * Deliberately NOT applied to the commit path. That one re-quotes against the branch the
 * confirmed preview already priced, so moving its address would book a different branch
 * than the one an operator approved.
 *
 * The `locatable` guard is the same one `intentAddress` uses: LGONZ15 typed the single
 * word "Enterprise", which geocoded to Boston Logan and would have sent a California
 * technician 3,000 miles. A reported branch with no digit and no state names no place.
 */
export async function quoteWithReportedFallback(
  etd: EtdClient,
  item: QueueItem,
  address: string,
  code: string,
  wantState: string,
  start: string,
  end: string,
): Promise<{ q: QuoteResult; usedReported: boolean }> {
  // A request may also walk to the next-nearest branch when the chosen one prices
  // nothing (`nearbyOnEmpty` inside the client, which refuses to move a pinned
  // branch). A cutover never opts in: its quote pins the contract branch, and the
  // reservation must sit at the branch holding the Holman agreement.
  const nearby = item.workflowType === WORKFLOW_REQUEST;
  const q = await guardedQuote(etd, address, code, wantState, start, end, nearby);
  if ((q.classes || []).length) return { q, usedReported: false };

  const rs = ((item.facts || {}) as Record<string, any>).requestSeed || {};
  const reported = String(rs.reportedBranch || "").trim();
  // No seed (a cutover has none), nothing typed, or the same address we just tried.
  if (!reported || reported.toLowerCase() === address.toLowerCase()) {
    return { q, usedReported: false };
  }
  const locatable =
    /\d/.test(reported) || /(^|[\s,])[A-Z]{2}([\s,]|$)/.test(reported.toUpperCase());
  if (!locatable) return { q, usedReported: false };

  // A failed fallback must not destroy the original quote: the first result still
  // carries the branch and journey the caller reports on, and a thrown geocode guard
  // here would turn "this branch has no cars" into a hard abort.
  try {
    const q2 = await guardedQuote(etd, reported, code, wantState, start, end);
    if ((q2.classes || []).length) return { q: q2, usedReported: true };
  } catch {
    /* keep the original empty quote and let the class note report availability */
  }
  return { q, usedReported: false };
}

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
  // Fleet types a human word. ETD speaks SIPP codes and describes each class by
  // example, so "minivan" can never substring-match "CHRYSLER PACIFICA OR SIMILAR".
  // Resolve the label to a code through the SAME table that reads a technician's own
  // free-text description, THEN look at what the branch offers. Without this every
  // named class fell straight through to UNMAPPED and then to "largest available
  // substitute" - which would hand a full-size SUV to somebody whose branch had on
  // the lot the exact minivan they asked for. (Request #19, 2026-08-19.)
  //
  // Deliberately NOT applied to the plain sedan default: descClass("sedan") is FCAR,
  // and the sedan default must walk the ladder from the SMALLEST up (Tyler,
  // 2026-08-17), never jump to full-size. Only a class Fleet NAMED resolves here.
  const wantCode = want === "sedan"
    ? ""
    : (/^[a-z]{4}$/.test(want) ? want.toUpperCase() : descClass(want));
  let pick: OfferedClass | null =
    (wantCode
      ? offered.find((c) => String(c.code || "").toUpperCase() === wantCode) ?? null
      : null)
    ?? offered.find(
      (c) => normLabel(c.description).includes(want) || want === normLabel(c.code),
    ) ?? null;
  let match = pick ? "approved_label" : "UNMAPPED";
  let note = pick
    ? `approved class '${want}'${wantCode ? ` (${wantCode})` : ""} matched ${String(pick.code)}`
    : `approved class '${want}'${wantCode ? ` (${wantCode})` : ""} not offered at this branch`;

  // HVAC comes from the ROSTER, not from a checkbox the technician ticks.
  //
  // The form's hvacCarveOut is self-declared and JGATES2, an HVAC Team Lead, left it
  // blank and was approved for a sedan. The roster has always known his trade and
  // isHvac() has always existed; this lane simply never asked. A sedan is the default
  // for everyone else (Tyler's rule), but tools do not fit in a Mirage boot, so an
  // HVAC technician goes up the escalation ladder first and only falls back to a
  // sedan if the branch has nothing bigger.
  const hvacByRoster = isHvac(String((facts.roster || {}).jobTitle ?? ""));
  if (!pick && want === "sedan" && hvacByRoster) {
    const big = ESCALATION_LADDER
      .map((code) => offered.find((c) => String(c.code || "").toUpperCase() === code))
      .find(Boolean) as OfferedClass | undefined;
    if (big) {
      pick = big;
      match = "hvac_roster_escalated";
      note = `roster job title is HVAC; took ${String(big.code)} rather than a sedan`;
    }
  }
  // A NAMED class the branch does not stock (minivan, cargo van, suv). Same rule as
  // the sedan default now: never park a technician for a human when the lot has
  // vehicles. Largest-first, because someone who asked for a minivan needs the space,
  // and only then the sedan ladder.
  if (!pick && want !== "sedan") {
    // Walk DOWN from what was NAMED first. Starting at the top of the ladder
    // regardless of the request handed an "suv" a Chrysler Pacifica whenever the
    // branch had one, and the runner meanwhile refused the booking outright: the
    // same request produced two different vehicles depending on which booker ran.
    // -1 when the named class sits ABOVE the ladder (cargo van, pickup) so the walk
    // still starts at MVAR, the ceiling.
    const from = wantCode ? NAMED_DOWNGRADE.indexOf(wantCode) : -1;
    for (const code of NAMED_DOWNGRADE.slice(from + 1)) {
      const hit = offered.find((c) => String(c.code || "").toUpperCase() === code);
      if (hit) {
        pick = hit;
        match = "named_class_downgraded";
        note = `approved class '${want}'${wantCode ? ` (${wantCode})` : ""} not offered; `
             + `took ${code}, the largest substitute at or below it`;
        break;
      }
    }
    // A named SEDAN with nothing at or below it may walk UP: intent #110 named SCAR
    // at a branch whose smallest car was full-size, and the down-only rule parked it
    // at class_unmapped forever while the lot had sedans. Naming a small sedan must
    // never book WORSE than saying nothing (the plain default already walks up), so
    // the nearest LARGER sedan comes next (FCAR stays the ceiling — PCAR/LCAR remain
    // out), and only when no sedan exists at all does the escalation ladder run,
    // smallest-first, exactly as the sedan default's dead-end does. Space classes
    // (suv, minivan, cargo van, pickup) keep the down-only rule: their walk already
    // starts at MVAR, the policy ceiling, so there is no "up" left that policy allows.
    // Mirrored by _named_class_pick in etd-runner/scripts/book_request.py — change
    // both or neither (the two bookers resolved the same request in OPPOSITE
    // directions until 2026-08-19).
    if (!pick && wantCode && SEDAN_CODES.has(wantCode)) {
      const rung = SEDAN_LADDER.indexOf(wantCode);
      for (const code of SEDAN_LADDER.slice(rung + 1)) {
        const hit = offered.find((c) => String(c.code || "").toUpperCase() === code);
        if (hit) {
          pick = hit;
          match = "named_class_upgraded";
          note = `approved class '${want}' (${wantCode}) not offered and nothing smaller is either; `
               + `took ${code}, the nearest sedan above it`;
          break;
        }
      }
      if (!pick) {
        for (const code of ESCALATION_LADDER) {
          const hit = offered.find((c) => String(c.code || "").toUpperCase() === code);
          if (hit) {
            pick = hit;
            match = "named_class_escalated";
            note = `approved class '${want}' (${wantCode}) not offered and no other sedan is either; `
                 + `escalated to ${code} (smallest available above the sedan ceiling)`;
            break;
          }
        }
      }
    }
    // Still nothing: every ladder ran dry. Same lesson as the sedan-ladder dead-end
    // below — this is an AVAILABILITY fact, not a mapping bug, and the note must say
    // so or an operator goes hunting the mapping table. Name the codes the branch
    // DID offer so staff can adjust the approved class from the panel.
    if (!pick) {
      const codes = offered.map((c) => String(c.code || "?")).filter(Boolean);
      note = `${note}; no usable substitute on any ladder `
           + `(branch offered: ${codes.length ? codes.join(", ") : "NOTHING - the quote returned no classes"})`;
    }
  }
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
    } else {
      // The ladder ran and found nothing. Its verdict is the accurate one and it
      // means something quite different from the pre-ladder text: "sedan is not a
      // class here" versus "this branch has no sedan free right now". Leaving the
      // pre-ladder note in place sent an operator hunting a mapping bug when the
      // real answer was availability. Name the codes that WERE offered so the next
      // reader can see it without another query.
      const codes = offered.map((c) => String(c.code || "?")).filter(Boolean);
      note = `${lad.note} (branch offered: ${codes.length ? codes.join(", ") : "NOTHING - the quote returned no classes"})`;
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
  const requestedAt = (item.facts as any)?.requestSeed?.pickupAt ?? null;
  const { day: firstDay, evidence } = await nextWorkingDay(ldap, readSchedule, {
    sameDay: item.workflowType === WORKFLOW_REQUEST,
    requestedAt,
  });

  const quote: RunnerQuote & Record<string, unknown> = {
    scheduleEvidence: evidence as any,
    warnings: [],
    branchCode: null,
    branchName: null,
    branchAddress: null,
    branchZip: null,
    branchPinned: false,
    quotedFromReportedBranch: false,
    quotedFromNearbyBranch: false,
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
      // The form's time too. 09:00 is only the fallback; every request so far asked
      // for 08:00 and was booked at 09:00.
      const askedTime = /T(\d{2}:\d{2}:\d{2})/.exec(String(requestedAt ?? ""))?.[1]
        ?? / (\d{2}:\d{2}:\d{2})/.exec(String(requestedAt ?? ""))?.[1];
      const wanted =
        item.workflowType === WORKFLOW_REQUEST && askedTime ? askedTime : "09:00:00";
      // nextWorkingDay floors the DATE to today but nothing floored the TIME, and the
      // request form stores 08:00 for everyone. So from 08:00 local onward every
      // request asked Enterprise to quote a pickup that had ALREADY HAPPENED, and ETD
      // answers a past start with an empty class list - which surfaced as
      // `class_unmapped` and looked for all the world like a vehicle-mapping bug. Two
      // independent code paths hit it: the in-server preview and book_request.py, which
      // reported "ETD offered no classes at any duration, from the shop address or the
      // technician's reported branch". Proven 2026-08-18 with all 12 open requests
      // carrying pickup_at in the past, including two created that same morning.
      //
      // ET is the floor reference on purpose. Every US branch is at or west of Eastern,
      // so an ET-derived time is never in the past locally; the worst case is booking a
      // technician later in their own day than strictly necessary, which is safe. The
      // hour is taken % 24 because Intl with hour12:false renders midnight as "24".
      // Only today's date needs flooring; a future date is already whatever the form
      // asked for. If the floor pushes past the end of the working day, take the slot
      // AND the day it belongs to.
      const window = resolvePickupWindow({
        dayISO: firstDay,
        wantedTime: wanted,
        todayISO: etTodayISO(),
      });
      const startDay = window.day;
      const start = `${startDay}T${window.time}`;
      // A roll used to be completely silent: pickupDate simply became tomorrow
      // and nothing in the preview, the drawer or the approval text said so.
      // 31 requests moved day this way before anyone noticed. Name it.
      if (window.rolled) {
        (quote.warnings as string[]).push(
          `requested ${firstDay} ${wanted} is past the ${"16:30"} last-pickup cutoff; `
          + `quoted ${startDay} ${window.time} instead`,
        );
      }
      const end = fmtISO(addDaysDT(parseLocalDT(start), days));
      const { address, code, wantState } = intentAddress(item);
      if (!address) throw new Error("no branch/shop address seed on the intent facts");

      const { q, usedReported } = await quoteWithReportedFallback(
        etd, item, address, code, wantState, start, end,
      );
      const classes = q.classes || [];
      const chosen = classForIntent(item, classes);
      classDecision = chosen.decision;

      Object.assign(quote, {
        // The DAY and TIME actually quoted. `firstDay` is pre-roll and a hardcoded
        // 09:00 was never true; the commit re-quotes from these, so a stale value here
        // silently books a different reservation than the one that was priced.
        pickupDate: startDay,
        pickupTime: window.time,
        returnDate: end.slice(0, 10),
        returnTime: "09:00:00",
        branchCode: q.branch_code,
        branchName: q.branch_name,
        branchAddress: q.branch_address,
        branchPhone: q.branch_phone ?? null,
        branchZip: branchZip(q),
        branchPinned: !!q.branch_pinned,
        quotedFromReportedBranch: usedReported,
        quotedFromNearbyBranch: !!q.branch_fallback_from_code,
        journeyId: q.journey_id,
        reference: q.reference,
        offeredClasses: classes.map((c) => ({ code: c.code, description: c.description })),
      });
      // Name the branch that came up empty so the drawer reads "moved off X because
      // it had no cars" instead of looking like the geocoder picked somewhere odd.
      if (q.branch_fallback_from_code) {
        (quote.warnings as string[]).push(
          `nearest branch ${q.branch_fallback_from_name || "?"} (${q.branch_fallback_from_code}) ` +
          `priced no classes; quoted ${q.branch_name} (${q.branch_code}) instead`,
        );
      }
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
 *
 * The reference match is TOKEN-exact, never substring: SHSNX-42 as a substring
 * also lives inside SHSNX-420 and SHSNX-421, so a plain `includes` would report
 * a NEIGHBOURING intent's reservation as this one's — refusing a legitimate
 * first booking (pre-commit) or settling the wrong state (readback). The
 * reference field is a space-joined string ("LDAP = JSMITH1 SHSNX-42"), so the
 * unit of identity is the whole token between separators.
 */
export function identifyJourneyRows(rows: JourneyRow[], identity: JourneyIdentity): JourneyRow[] {
  const conf = String(identity.confirmation ?? "").trim().toUpperCase();
  const ref = String(identity.intentRef ?? "").trim().toUpperCase();
  if (!conf && !ref) return [];
  return rows.filter(
    (r) =>
      (!!conf && r.confirmation.trim().toUpperCase() === conf) ||
      (!!ref && referenceTokens(r.reference).includes(ref)),
  );
}

/**
 * An ADVISORY sighting, never an identifier: a journey row that carries a
 * confirmation number but did NOT positively identify as this intent's.
 *
 * Decision (task 2026-08-21, closing the manual-booking residual gap): an
 * LDAP-keyed journey hit IS worth surfacing — it is exactly the shape a
 * reservation booked by hand in the ETD portal leaves behind (no SHSNX
 * reference, no confirmation on file) — but it must NEVER become an
 * identifier again: one technician owns many journeys, and treating "the
 * search returned rows" as identification is precisely what parked 65
 * unrelated quote journeys as phantom duplicates. So these rows ride the
 * search evidence as `possibleUnlinked`, the server treats them as "a human
 * must look" (cancel lane), and identifyJourneyRows stays untouched.
 *
 * The `reference` field is deliberately DROPPED from the advisory shape: for
 * a hand booking it is free text typed at the branch and can carry a
 * technician's name; the four kept fields are codes.
 */
export type PossibleUnlinkedRow = {
  confirmation: string;
  branchCode: string;
  date: string;
  sipp: string;
};

/**
 * The reference field split into identity tokens. Anything that is not part of
 * an SHS reference (whitespace, punctuation) separates; the dash stays inside a
 * token because it is part of the reference itself (SHSNX-42, SHSRQ-7).
 * MUST stay byte-for-byte equivalent to _reference_tokens in
 * etd-runner/scripts/book_cutover.py — a drift silently breaks cross-runner dedupe.
 */
function referenceTokens(reference: string): string[] {
  return String(reference ?? "").toUpperCase().split(/[^A-Z0-9-]+/).filter(Boolean);
}

export type JourneySearch = {
  /** Rows that positively identify as this intent's reservation. */
  matches: JourneyRow[];
  /** Advisory only: unidentified rows carrying a confirmation number. */
  possibleUnlinked: PossibleUnlinkedRow[];
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
    return { matches: [], possibleUnlinked: [], rowsReturned: 0, criteria: [criteria], error: clip(errText(err)) };
  }
  const rows = extractJourneyRows(res);
  const matches = identifyJourneyRows(rows, identity);
  return {
    matches,
    possibleUnlinked: possibleUnlinkedRows(rows, matches),
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
  possibleUnlinked: PossibleUnlinkedRow[];
  error: string | null;
}): Record<string, unknown> {
  return {
    status: s.error ? "error" : "ok",
    criteria: s.criteria,
    rowsReturned: s.rowsReturned,
    identified: s.matches.length,
    // Advisory, never identification (see PossibleUnlinkedRow): the server's
    // cancel lane refuses to settle terminal while one of these is in view.
    possibleUnlinked: s.possibleUnlinked,
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
    // A confirmation on file (parsed from a commit OR attached by staff for a
    // reservation booked by hand in the ETD portal) is a positive identifier;
    // claimBookingWork now serves it on every claim so an attach is picked up
    // on the very next pass.
    const knownConf = String(item.reservationEvidence?.confirmation ?? "");
    const identity: JourneyIdentity = { confirmation: knownConf, intentRef };
    const criteria = [knownConf || intentRef];
    let search = await journeyMatches(etd, criteria[0], identity);
    let rowsReturned = search.rowsReturned;
    let possibleUnlinked = search.possibleUnlinked;
    if (!search.matches.length && !search.error) {
      criteria.push(ldap);
      search = await journeyMatches(etd, ldap, identity);
      rowsReturned += search.rowsReturned;
      possibleUnlinked = mergePossibleUnlinked(possibleUnlinked, search.possibleUnlinked);
    }
    const body = await post("readback", {
      matches: search.matches,
      expected: knownConf ? { confirmation: knownConf } : {},
      search: searchEvidence({ ...search, criteria, rowsReturned, possibleUnlinked }),
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

  // 1. The confirmed date must still be a verified working day. CUTOVER ONLY.
  //
  // This is the THIRD home of the schedule gate. Making the preview-time and
  // confirm-time ones cutover-only was not enough: a rental request got all the way
  // to the commit and died here with "2026-08-18 no longer a working day", which is
  // a true statement about ServicePower and an irrelevant one about a technician
  // standing next to a dead van. A cutover pairs its reservation with a 30-minute
  // route block, so the day has to be one the tech actually works. A request files
  // no block and books a car for today. ServicePower has no say in it.
  if (item.workflowType !== WORKFLOW_REQUEST
      && !(await isWorkingDay(ldap, pickup, readSchedule))) {
    await post("op_result", {
      outcome: "aborted_before_open",
      evidence: { reason: `${pickup} no longer a verified working day` },
    });
    return result("ABRT", "aborted_before_open", `${pickup} no longer a working day`);
  }

  // 1.5 The driver must exist in ETD BEFORE we spend a journey on this booking.
  //
  // This check used to live at step 3, after the quote. quote() calls
  // createJourney() as its very first act, so every booking for a technician
  // with no ETD seat created a draft journey assessment on the Enterprise
  // account and then aborted. Three of those on 2026-08-25 alone, and each one
  // still had to be provisioned by hand afterwards.
  //
  // ensureEtdUser provisions from LIVE TPMS, not from tpms_tech_profiles: that
  // table is an incremental sync and was missing 107 active technicians the day
  // this was written, which is exactly the new-hire population that lands here.
  // It only throws when TPMS cannot identify the person or has no usable phone,
  // and those are tasks for a human, not booking failures - so the reason text
  // says which one it is rather than repeating "no ETD user".
  let etdUsername: string;
  let user: Record<string, any>;
  try {
    const ensured = await ensureEtdUser(etd, ldap, mapping);
    etdUsername = ensured.username;
    user = ensured.record;
  } catch (err) {
    const reason = clip(errText(err), 200);
    await post("op_result", { outcome: "aborted_before_open", evidence: { reason } });
    return result("ABRT", "aborted_before_open", clip(reason, 160));
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
  let pick = (q.classes || []).find(
    (c) => String(c.code || "").toUpperCase() === sipp.toUpperCase(),
  );
  let sipp2 = sipp;
  let substitution: string | null = null;
  // The lot moves between the quote and the commit. Demanding the exact preview class
  // still be there meant a sold-out Mirage aborted the whole booking (DWHITE0,
  // 2026-08-18) even though the branch had other cars. Re-pick with the SAME rules and
  // book the substitute; only a BRANCH change is still fatal, because that is a
  // different place and the technician was told where to go.
  if (gotBranch === wantBranch && !pick) {
    const re = classForIntent(item, (q.classes || []) as CarClass[]);
    if (re.pick) {
      pick = re.pick as any;
      sipp2 = String(re.pick.code || "");
      substitution = `${sipp} sold out between quote and commit; re-picked ${sipp2} (${re.decision.detail ?? "same rules"})`;
      console.log(`[etd-exec] SUBST #${intentId} ${ldap} ${substitution}`);
    }
  }
  if (gotBranch !== wantBranch || !pick) {
    const reason =
      gotBranch !== wantBranch
        ? `branch drift ${wantBranch}->${gotBranch}`
        : `class ${sipp} no longer offered and nothing on the ladder is available here`;
    await post("op_result", { outcome: "aborted_before_open", evidence: { reason } });
    return result("ABRT", "aborted_before_open", reason);
  }

  // 3. Build the exact model with the proven payload surgery.
  // Resolved and read back at step 1.5, before the journey was created. Looking
  // it up again here would be a second round trip for an answer we already have.
  const username = etdUsername;

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
  // The account has no Truck Number field. Nothing may claim it does.
  stripTruckNumberReference(model);

  // Keyed on what we are ACTUALLY booking, so a substitution is a different
  // reservation and a repeat of the same one is caught.
  const requestHash = bookingRequestHash({ branch: gotBranch, date: pickup, ldap, sipp: sipp2 });

  // What this pass actually put on the wire. Recorded with every failure so a refusal is
  // diagnosable from the ledger alone, without re-deriving the inputs from a preview that
  // may since have been rebuilt.
  const passRequest: Record<string, unknown> = {
    journeyId: q.journey_id,
    quoteReference: q.reference,
    branchCode: gotBranch,
    branchName: clip(q.branch_name, 60),
    sipp: sipp2,
    ...(substitution ? { substitution } : {}),
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

/** Advisory rows are a hint, not a dump — enough to check ETD, never a roster. */
export const POSSIBLE_UNLINKED_CAP = 8;

/**
 * Unidentified rows carrying a confirmation number, deduped on the
 * confirmation, capped. MUST stay byte-for-byte equivalent to
 * _possible_unlinked_rows() in etd-runner/scripts/book_cutover.py — both
 * runners post into the same readback handler.
 */
export function possibleUnlinkedRows(
  rows: JourneyRow[],
  matches: JourneyRow[],
): PossibleUnlinkedRow[] {
  const identified = new Set(
    matches.map((m) => m.confirmation.trim().toUpperCase()).filter(Boolean),
  );
  const seen = new Set<string>();
  const out: PossibleUnlinkedRow[] = [];
  for (const r of rows) {
    const conf = r.confirmation.trim();
    if (!conf) continue;
    const key = conf.toUpperCase();
    if (identified.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ confirmation: conf, branchCode: r.branchCode, date: r.date, sipp: r.sipp });
    if (out.length >= POSSIBLE_UNLINKED_CAP) break;
  }
  return out;
}

/** Merge advisory lists from successive searches: first sighting wins, capped. */
export function mergePossibleUnlinked(
  ...lists: PossibleUnlinkedRow[][]
): PossibleUnlinkedRow[] {
  const seen = new Set<string>();
  const out: PossibleUnlinkedRow[] = [];
  for (const list of lists) {
    for (const r of list) {
      const key = r.confirmation.trim().toUpperCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(r);
      if (out.length >= POSSIBLE_UNLINKED_CAP) return out;
    }
  }
  return out;
}
