/**
 * Tech Shifts client — the live technician schedule feed.
 *
 * Source: Mauricio Marino's Tech Shift Calendar app.
 *   GET {TECH_SHIFTS_BASE_URL}/api/shifts/export
 *       ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 *       [&enterpriseId=LDAP] [&district=NNNN] [&shift=SHIFT_NAME]
 *   Header: X-API-Key: {TECHS_SHIFTS_API_KEY} (legacy name TECH_SHIFTS_API_KEY also accepted)
 *
 * WHY THIS EXISTS ALONGSIDE fetchScheduleWindow()
 * -----------------------------------------------
 * `cutover-orchestrator.fetchScheduleWindow()` reads ServicePower's
 * PRD_SERVICEPOWER.BATCH_TBLS.SCH_ACTIVITIES_PROD, which is a DAILY SNAPSHOT.
 * It carries a 26h watermark, it goes stale, and a day off is represented by
 * the ABSENCE of a row — indistinguishable from a data gap. That gate stays
 * exactly where it is; this client does not touch it.
 *
 * This feed is pattern-generated, so it answers dates months out, it states a
 * day off explicitly, and it reads back the `Vehicle - *` activities Fleet
 * itself files through the routing app. It is a read surface for humans, not a
 * booking gate.
 *
 * FOUR TRAPS, ALL MEASURED LIVE 2026-08-23, ALL SILENT
 * ----------------------------------------------------
 *  1. `enterpriseId` is CASE-SENSITIVE. `?enterpriseId=abrantl` answers
 *     HTTP 200 / success:true / totalRecords:0 — byte-identical to a genuinely
 *     unknown LDAP. Every LDAP is uppercased before it leaves this module.
 *  2. `hours` is polymorphic: `number | "OFF"`. 4,526 of 11,677 rows in one
 *     measured week were the STRING "OFF". `if (row.hours)` reads every off
 *     day as a working day; `Number(row.hours)` is NaN.
 *  3. Both date params are REQUIRED — omitting either is HTTP 400, not a
 *     default window — and `end < start` is HTTP 200 with `success:false`.
 *  4. An unfiltered week is ~11,700 rows / ~3.6 MB. Always filter unless the
 *     whole fleet is genuinely wanted.
 */

import { z } from "zod";

const DEFAULT_BASE_URL = "https://tech-shifts--marinomauricio.replit.app";
const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Trap 2 lives here. The feed really does mix a float, an int and the literal
 * string "OFF" in one field, so the schema has to accept the union and every
 * consumer has to narrow with `typeof`.
 */
const rawRowSchema = z.object({
  district: z.string().nullable().optional(),
  iru: z.string().nullable().optional(),
  teamName: z.string().nullable().optional(),
  techName: z.string().nullable().optional(),
  enterpriseId: z.string().nullable().optional(),
  shiftStartDate: z.string().nullable().optional(),
  patternWeek: z.number().nullable().optional(),
  date: z.string(),
  shiftName: z.string().nullable().optional(),
  shiftStartTime: z.string().nullable().optional(),
  shiftEndTime: z.string().nullable().optional(),
  hours: z.union([z.number(), z.string()]),
  activityType: z.string().nullable().optional(),
  activityHours: z.number().nullable().optional(),
  activityStartTime: z.string().nullable().optional(),
  activityEndTime: z.string().nullable().optional(),
});

const exportResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  meta: z
    .object({
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      totalRecords: z.number().optional(),
      filteredByEnterpriseId: z.string().nullable().optional(),
      filteredByDistrict: z.string().nullable().optional(),
      filteredByShift: z.string().nullable().optional(),
    })
    .optional(),
  data: z.array(rawRowSchema).optional(),
});

export type RawShiftRow = z.infer<typeof rawRowSchema>;

export type TechShiftsErrorCode =
  | "CONFIG_MISSING"
  | "BAD_REQUEST"
  | "AUTHENTICATION_FAILED"
  | "RATE_LIMITED"
  | "UPSTREAM_UNAVAILABLE"
  | "TIMEOUT"
  | "MALFORMED_RESPONSE";

export class TechShiftsError extends Error {
  constructor(
    public readonly code: TechShiftsErrorCode,
    message: string,
    public readonly upstreamStatus?: number,
  ) {
    super(message);
    this.name = "TechShiftsError";
  }
}

/**
 * Four states, not two. A day can be scheduled and then eaten by an activity,
 * which is neither "working" nor "off" and must not be collapsed into either.
 */
export type DayState =
  /** Scheduled, available, no activity. */
  | "working"
  /** Scheduled and available, but an activity occupies part of the day. */
  | "partial"
  /** Scheduled, but an activity consumed the whole day (`hours === 0`). */
  | "activity"
  /** Not scheduled. The feed sends the literal string "OFF". */
  | "off";

export interface TechDay {
  date: string;
  state: DayState;
  /** null when the feed said "OFF". Never coerce that string to a number. */
  hours: number | null;
  shiftName: string | null;
  shiftStartTime: string | null;
  shiftEndTime: string | null;
  activityType: string | null;
  activityHours: number | null;
  activityStartTime: string | null;
  activityEndTime: string | null;
  /** True for the `Vehicle - *` family, which Fleet files through the routing app. */
  isFleetActivity: boolean;
  /** The single predicate callers should use. True for `working` and `partial`. */
  isWorking: boolean;
}

export interface TechSchedule {
  ldap: string;
  techName: string | null;
  district: string | null;
  iru: string | null;
  teamName: string | null;
  shiftName: string | null;
  patternWeek: number | null;
  startDate: string;
  endDate: string;
  days: TechDay[];
  workingDays: number;
  offDays: number;
  /** Distinct `activityType` values in the window, first-seen order. */
  activities: string[];
  /** False when the feed returned no rows for this LDAP. */
  found: boolean;
}

/**
 * The activities Fleet itself files. Reading one of these back is how a filed
 * route block can finally be verified against the schedule the technician sees.
 */
export const FLEET_ACTIVITY_TYPES = [
  "Vehicle - Change",
  "Vehicle - Decommission",
  "Vehicle - Pickup",
  "Vehicle - Dropoff",
] as const;

const FLEET_ACTIVITY_SET = new Set<string>(FLEET_ACTIVITY_TYPES);

export interface TechShiftsClientOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * The secret was created in Replit as TECHS_SHIFTS_API_KEY (plural "TECHS"),
 * while this client was written against TECH_SHIFTS_API_KEY. Accept both so
 * neither renaming the secret nor this code can silently unconfigure the feed.
 */
function readApiKey(env: NodeJS.ProcessEnv): string | undefined {
  return env.TECHS_SHIFTS_API_KEY?.trim() || env.TECH_SHIFTS_API_KEY?.trim() || undefined;
}

function getConfig(env: NodeJS.ProcessEnv): { baseUrl: string; apiKey: string } {
  const apiKey = readApiKey(env);
  if (!apiKey) {
    throw new TechShiftsError(
      "CONFIG_MISSING",
      "TECHS_SHIFTS_API_KEY is not set in Replit Secrets; the tech-shifts feed answers 401 without it",
    );
  }
  const raw = env.TECH_SHIFTS_BASE_URL?.trim() || DEFAULT_BASE_URL;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("invalid protocol");
  } catch {
    throw new TechShiftsError("CONFIG_MISSING", `TECH_SHIFTS_BASE_URL is not a valid URL: ${raw}`);
  }
  return { baseUrl: raw.replace(/\/+$/, ""), apiKey };
}

export function isTechShiftsConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!readApiKey(env);
}

function mapUpstreamFailure(status: number, body: string): TechShiftsError {
  const tail = body ? `: ${body.slice(0, 300)}` : "";
  if (status === 400) return new TechShiftsError("BAD_REQUEST", `tech-shifts rejected the query${tail}`, status);
  if (status === 401 || status === 403)
    return new TechShiftsError("AUTHENTICATION_FAILED", `tech-shifts rejected the API key${tail}`, status);
  if (status === 429) return new TechShiftsError("RATE_LIMITED", `tech-shifts rate-limited Nexus${tail}`, status);
  return new TechShiftsError("UPSTREAM_UNAVAILABLE", `tech-shifts returned HTTP ${status}${tail}`, status);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function assertIsoDate(value: string, label: string): void {
  if (!ISO_DATE.test(value)) {
    throw new TechShiftsError("BAD_REQUEST", `${label} must be YYYY-MM-DD, got ${JSON.stringify(value)}`);
  }
}

/**
 * Trap 1. Uppercase and trim before the LDAP leaves this module. Nexus stores
 * LDAPs in mixed case in several tables — every existing join wraps them in
 * `UPPER(...)` for exactly this reason — and the feed answers a lowercase LDAP
 * with an empty success, which reads as "this technician has no schedule".
 */
export function normalizeShiftLdap(value: string | null | undefined): string {
  return String(value ?? "").trim().toUpperCase();
}

/**
 * Trap 2. The ONLY correct working-day predicate.
 *   "OFF" -> not scheduled · 0 -> scheduled but consumed · > 0 -> available
 * The `typeof` guard comes first because `Number("OFF")` is NaN and
 * `if (hours)` is true for the string.
 */
export function isWorkingRow(row: Pick<RawShiftRow, "hours">): boolean {
  return typeof row.hours === "number" && row.hours > 0;
}

export function classifyRow(row: RawShiftRow): DayState {
  if (typeof row.hours !== "number") return "off";
  if (row.hours > 0) return row.activityType ? "partial" : "working";
  return row.activityType ? "activity" : "off";
}

export interface ShiftsQuery {
  startDate: string;
  endDate: string;
  enterpriseId?: string;
  district?: string;
  shift?: string;
}

/**
 * In-memory TTL cache. The feed is pattern-generated and moves slowly, and a
 * Nexus page re-queries the same window on every focus. Deliberately NOT a
 * Postgres mirror: a per-technician window is ~1 KB, so there is nothing worth
 * persisting, and this deployment is autoscale (see the `setInterval` warning
 * in rental-request.ts) so process-local state must stay disposable.
 */
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; rows: RawShiftRow[] }>();

export function clearTechShiftsCache(): void {
  cache.clear();
}

function cacheKey(q: ShiftsQuery): string {
  return [q.startDate, q.endDate, q.enterpriseId ?? "", q.district ?? "", q.shift ?? ""].join("|");
}

/** Raw feed call: validate, normalize, cache, fail loudly. */
export async function fetchShiftRows(
  query: ShiftsQuery,
  options: TechShiftsClientOptions = {},
): Promise<RawShiftRow[]> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  assertIsoDate(query.startDate, "startDate");
  assertIsoDate(query.endDate, "endDate");
  if (query.startDate > query.endDate) {
    throw new TechShiftsError(
      "BAD_REQUEST",
      `startDate ${query.startDate} is after endDate ${query.endDate}`,
    );
  }

  const normalized: ShiftsQuery = {
    startDate: query.startDate,
    endDate: query.endDate,
    enterpriseId: query.enterpriseId ? normalizeShiftLdap(query.enterpriseId) : undefined,
    district: query.district?.trim() || undefined,
    shift: query.shift?.trim() || undefined,
  };

  const key = cacheKey(normalized);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.rows;

  const config = getConfig(env);
  const url = new URL("/api/shifts/export", config.baseUrl);
  url.searchParams.set("startDate", normalized.startDate);
  url.searchParams.set("endDate", normalized.endDate);
  if (normalized.enterpriseId) url.searchParams.set("enterpriseId", normalized.enterpriseId);
  if (normalized.district) url.searchParams.set("district", normalized.district);
  if (normalized.shift) url.searchParams.set("shift", normalized.shift);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(url.toString(), {
      method: "GET",
      headers: { "X-API-Key": config.apiKey, Accept: "application/json" },
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new TechShiftsError("TIMEOUT", `tech-shifts did not answer within ${timeoutMs}ms`);
    }
    throw new TechShiftsError("UPSTREAM_UNAVAILABLE", `tech-shifts unreachable: ${err?.message ?? err}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw mapUpstreamFailure(response.status, await response.text().catch(() => ""));
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new TechShiftsError("MALFORMED_RESPONSE", "tech-shifts did not return JSON");
  }

  const parsed = exportResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new TechShiftsError(
      "MALFORMED_RESPONSE",
      `tech-shifts response did not match the expected shape: ${parsed.error.issues[0]?.message ?? "unknown"}`,
    );
  }
  // Trap 3: a bad range comes back HTTP 200 with success:false.
  if (!parsed.data.success) {
    throw new TechShiftsError("BAD_REQUEST", parsed.data.message || "tech-shifts returned success:false");
  }

  const rows = parsed.data.data ?? [];
  cache.set(key, { at: Date.now(), rows });
  return rows;
}

function toDay(row: RawShiftRow): TechDay {
  const state = classifyRow(row);
  return {
    date: row.date,
    state,
    hours: typeof row.hours === "number" ? row.hours : null,
    shiftName: row.shiftName || null,
    shiftStartTime: row.shiftStartTime || null,
    shiftEndTime: row.shiftEndTime || null,
    activityType: row.activityType || null,
    activityHours: row.activityHours ?? null,
    activityStartTime: row.activityStartTime || null,
    activityEndTime: row.activityEndTime || null,
    isFleetActivity: !!row.activityType && FLEET_ACTIVITY_SET.has(row.activityType),
    isWorking: state === "working" || state === "partial",
  };
}

/** Fold raw rows into one schedule per technician, sorted by display name. */
export function buildSchedules(rows: RawShiftRow[], startDate: string, endDate: string): TechSchedule[] {
  const byLdap = new Map<string, RawShiftRow[]>();
  for (const row of rows) {
    const ldap = normalizeShiftLdap(row.enterpriseId);
    if (!ldap) continue;
    const list = byLdap.get(ldap);
    if (list) list.push(row);
    else byLdap.set(ldap, [row]);
  }

  const out: TechSchedule[] = [];
  for (const [ldap, techRows] of Array.from(byLdap.entries())) {
    techRows.sort((a, b) => a.date.localeCompare(b.date));
    const days = techRows.map(toDay);
    const activities: string[] = [];
    for (const d of days) {
      if (d.activityType && !activities.includes(d.activityType)) activities.push(d.activityType);
    }
    // The feed sends exactly one row per (tech, date) — measured 11,677 rows
    // over 11,677 distinct pairs — so the first row carries the tech's identity.
    const head = techRows[0];
    out.push({
      ldap,
      techName: head.techName || null,
      district: head.district || null,
      iru: head.iru || null,
      teamName: head.teamName || null,
      shiftName: head.shiftName || null,
      patternWeek: head.patternWeek ?? null,
      startDate,
      endDate,
      days,
      workingDays: days.filter((d) => d.isWorking).length,
      offDays: days.filter((d) => d.state === "off").length,
      activities,
      found: true,
    });
  }

  out.sort((a, b) => (a.techName || a.ldap).localeCompare(b.techName || b.ldap));
  return out;
}

function emptySchedule(ldap: string, startDate: string, endDate: string): TechSchedule {
  return {
    ldap,
    techName: null,
    district: null,
    iru: null,
    teamName: null,
    shiftName: null,
    patternWeek: null,
    startDate,
    endDate,
    days: [],
    workingDays: 0,
    offDays: 0,
    activities: [],
    found: false,
  };
}

/** One technician over a window. `found:false` when the feed has no rows. */
export async function getTechSchedule(
  ldap: string,
  startDate: string,
  endDate: string,
  options: TechShiftsClientOptions = {},
): Promise<TechSchedule> {
  const normalized = normalizeShiftLdap(ldap);
  if (!normalized) throw new TechShiftsError("BAD_REQUEST", "ldap is required");
  const rows = await fetchShiftRows({ startDate, endDate, enterpriseId: normalized }, options);
  return buildSchedules(rows, startDate, endDate)[0] ?? emptySchedule(normalized, startDate, endDate);
}

/**
 * Several technicians at once, one filtered call each with a concurrency cap.
 * A per-technician week is ~1 KB against ~3.6 MB for one unfiltered pull, so
 * fanning out beats filtering client-side for any realistic batch.
 * A technician whose call fails yields `found:false` rather than failing the
 * whole batch — one bad LDAP must not blank a table of twenty.
 */
export async function getTechSchedules(
  ldaps: string[],
  startDate: string,
  endDate: string,
  options: TechShiftsClientOptions & { concurrency?: number } = {},
): Promise<TechSchedule[]> {
  const unique = Array.from(new Set(ldaps.map(normalizeShiftLdap).filter(Boolean)));
  if (!unique.length) return [];
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 6, unique.length));

  const out: TechSchedule[] = [];
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < unique.length) {
      const ldap = unique[cursor++];
      try {
        out.push(await getTechSchedule(ldap, startDate, endDate, options));
      } catch (err: any) {
        // CONFIG_MISSING and AUTHENTICATION_FAILED are not per-technician
        // problems; re-throw so the caller sees a real failure instead of a
        // table that quietly says nobody has a schedule.
        if (err instanceof TechShiftsError && (err.code === "CONFIG_MISSING" || err.code === "AUTHENTICATION_FAILED")) {
          throw err;
        }
        out.push(emptySchedule(ldap, startDate, endDate));
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  out.sort((a, b) => (a.techName || a.ldap).localeCompare(b.techName || b.ldap));
  return out;
}

/** A whole district in one call — no fan-out. */
export async function getDistrictSchedules(
  district: string,
  startDate: string,
  endDate: string,
  options: TechShiftsClientOptions = {},
): Promise<TechSchedule[]> {
  const rows = await fetchShiftRows({ startDate, endDate, district }, options);
  return buildSchedules(rows, startDate, endDate);
}

/**
 * The rental-lane question: can this technician collect a vehicle on this date?
 * Returns the day itself plus the next working day, so a caller can offer an
 * alternative instead of only refusing.
 */
export interface WorkingDayVerdict {
  ldap: string;
  date: string;
  /** null when the feed has no row for that technician on that date. */
  day: TechDay | null;
  isWorking: boolean;
  /** First working day on or after `date` inside the lookahead window. */
  nextWorkingDay: string | null;
  /** False when the feed knows nothing about this technician at all. */
  known: boolean;
}

export async function checkWorkingDay(
  ldap: string,
  date: string,
  lookaheadDays = 14,
  options: TechShiftsClientOptions = {},
): Promise<WorkingDayVerdict> {
  assertIsoDate(date, "date");
  const schedule = await getTechSchedule(ldap, date, addDaysISO(date, Math.max(0, lookaheadDays)), options);
  const day = schedule.days.find((d) => d.date === date) ?? null;
  return {
    ldap: normalizeShiftLdap(ldap),
    date,
    day,
    isWorking: !!day?.isWorking,
    nextWorkingDay: schedule.days.find((d) => d.isWorking)?.date ?? null,
    known: schedule.found,
  };
}

/** Date-only arithmetic in UTC, so a server timezone can never shift the day. */
export function addDaysISO(isoDate: string, days: number): string {
  assertIsoDate(isoDate, "date");
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Monday-anchored week start, UTC. */
export function startOfWeekISO(isoDate: string): string {
  assertIsoDate(isoDate, "date");
  const dow = new Date(`${isoDate}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDaysISO(isoDate, dow === 0 ? -6 : 1 - dow);
}
