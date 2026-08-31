import { toCanonical, toDisplayNumber } from "../vehicle-number-utils";
import type { ApiWarning } from "./types";

// ── Van delivery read model ──────────────────────────────────────────────────
// Answers one question for new-hire onboarding: on what date did this
// technician actually receive their van?
//
// Nobody records that date anywhere by hand, so it is DERIVED by joining two
// systems that are already maintained for other reasons:
//
//   1. Nexus `onboarding_hires` — the hire (service date = day 1) and the truck
//      number the Fleet team assigned to them, with the timestamp of that
//      assignment.
//   2. PAL Transport (paltransport.replit.app) — one record per transport job.
//      Premier's dispatcher sets `status = completed` and writes a `delivered`
//      date on the record when the van is dropped off.
//
// The join key is the truck number. The anchor that keeps an OLD transport for
// the same truck (its previous technician) from being attributed to this hire
// is the assignment timestamp: only a transport delivered on/after the truck
// was assigned to this person can be that person's delivery.
//
// ⚠ Coverage is partial BY CONSTRUCTION and every row says so in `status`:
//   - Vans moved by a Holman tow (Pep Boys and similar short hauls) never get a
//     PAL record at all. Holman reports a PO and a setup date, no completion.
//   - A van already at the branch is handed over with no transport of any kind.
//   Those rows come back `no_transport_record`, never a guessed date.

export type VanDeliveryStatus =
  /** A completed PAL transport delivered this truck on/after it was assigned. */
  | "delivered"
  /** A PAL transport for this truck is open (created on/after the assignment). */
  | "in_transit"
  /** Truck assigned, but no PAL transport covers it: tow, or a local handover. */
  | "no_transport_record"
  /** No truck number on the hire record yet. */
  | "awaiting_truck_assignment"
  /** Technician is on BYOV; no company van applies. */
  | "byov_no_van";

export interface VanDeliveryRow {
  enterpriseId: string | null;
  employeeName: string | null;
  /** Hire date (Snowflake Service_DT). Day 0 of the time-to-route clock. */
  hireDate: string | null;
  district: string | null;
  workState: string | null;
  byovIntent: string | null;
  employmentStatus: string | null;
  truckNumber: string | null;
  truckAssignedAt: string | null;
  /** Non-null when this hire has left the new-hire roster view. */
  droppedFromSourceAt: string | null;
  /** Days from hire date to truck assignment. Null when either is missing. */
  daysHireToTruckAssigned: number | null;
  status: VanDeliveryStatus;
  /** ISO date the van was delivered. Null unless status is `delivered`. */
  vanDeliveredOn: string | null;
  /** Days from hire date to van delivery. This is the time-to-van number. */
  daysHireToVanDelivered: number | null;
  deliverySource: "pal_transport" | null;
  transportRecordId: number | null;
  transportSubmittedOn: string | null;
  transportEta: string | null;
  warnings: ApiWarning[];
}

export interface VanDeliverySummary {
  /** Hires considered after the requested filters. */
  hireCount: number;
  byStatus: Record<VanDeliveryStatus, number>;
  /** Distribution of daysHireToVanDelivered over `delivered` rows only. */
  daysToVan: {
    measured: number;
    mean: number | null;
    median: number | null;
    p25: number | null;
    p75: number | null;
    min: number | null;
    max: number | null;
    withinSevenDays: number;
    withinFourteenDays: number;
    overThirtyDays: number;
  };
}

export interface VanDeliveryReadModel {
  filters: { hiredFrom: string | null; hiredTo: string | null };
  summary: VanDeliverySummary;
  rows: VanDeliveryRow[];
}

export interface VanDeliveryInput {
  /** Inclusive lower bound on hire date, ISO yyyy-mm-dd. */
  hiredFrom?: string;
  /** Inclusive upper bound on hire date, ISO yyyy-mm-dd. */
  hiredTo?: string;
  /** Include hires whose service date is still in the future. Default false. */
  includeFutureHires?: boolean;
}

export interface OnboardingHireSource {
  enterpriseId: string | null;
  employeeName: string | null;
  serviceDate: string | null;
  district: string | null;
  workState: string | null;
  byovIntent: string | null;
  employmentStatus: string | null;
  assignedTruckNo: string | null;
  assignedAt: string | null;
  /** Set when the hire left the Snowflake new-hire roster view. */
  droppedFromSourceAt?: string | null;
}

export interface PalTransportSource {
  id: number | null;
  truck: string | null;
  status: string | null;
  /** Free text the dispatcher types, e.g. "8/28". No year. */
  delivered: string | null;
  /** ISO date the request was created. Used to resolve `delivered`'s year. */
  submitted: string | null;
  eta: string | null;
}

export interface VanDeliverySources {
  readOnboardingHires: () => Promise<{
    data: OnboardingHireSource[];
    sourceUpdatedAt: string | null;
  }>;
  readPalTransports: () => Promise<{
    data: PalTransportSource[];
    sourceUpdatedAt: string | null;
  }>;
}

export class VanDeliverySourceUnavailableError extends Error {}

/**
 * A transport delivered slightly before the assignment was keyed into Nexus is
 * still this hire's delivery — the Fleet team stamps the row when they get to
 * it, not at the moment they pick the truck. Three days absorbs that lag
 * without reaching back far enough to catch the truck's previous technician.
 */
const ASSIGNMENT_ANCHOR_GRACE_DAYS = 3;

/**
 * Postgres hands back naive timestamps as "2026-07-27 12:03:52.697" — no zone.
 * Date.parse reads those as SERVER-LOCAL, which silently shifts every date by
 * the host's offset. Everything in this model is UTC, so naive text is stamped
 * UTC explicitly rather than left to whatever TZ the box happens to run in.
 */
function normalizeTimestampText(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text}T00:00:00Z`;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(text)) {
    return `${text.replace(" ", "T")}Z`;
  }
  return text;
}

function isoTimestamp(value: unknown): string | null {
  const text = normalizeTimestampText(value);
  if (text === null) return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function isoDate(value: unknown): string | null {
  const iso = isoTimestamp(value);
  return iso === null ? null : iso.slice(0, 10);
}

function dayNumber(iso: string): number {
  return Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
}

function daysBetween(fromIso: string | null, toIso: string | null): number | null {
  if (!fromIso || !toIso) return null;
  return dayNumber(toIso) - dayNumber(fromIso);
}

function shiftDays(iso: string, days: number): string {
  return new Date((dayNumber(iso) + days) * 86_400_000).toISOString().slice(0, 10);
}

/**
 * PAL's `delivered` field is whatever the dispatcher typed: "8/28", "5/1",
 * occasionally "8/28/26". There is no year on the common form, so it is taken
 * from the request's own `submitted` date, rolling forward one year when the
 * delivered month sits far enough behind the submitted month to be a
 * year-boundary crossing (submitted in December, delivered in January).
 *
 * Returns null rather than a guess when the text is not a date at all — a row
 * with no parseable delivery date reports `no_transport_record`, never a
 * fabricated one.
 */
export function parseDeliveredDate(
  delivered: string | null | undefined,
  submitted: string | null | undefined,
): string | null {
  const text = String(delivered ?? "").trim();
  if (!text) return null;

  const match = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/.exec(text);
  if (!match) return null;

  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  let year: number;
  if (match[3]) {
    const raw = Number(match[3]);
    year = raw < 100 ? raw + 2000 : raw;
  } else {
    const submittedIso = isoDate(submitted);
    if (!submittedIso) return null;
    const submittedYear = Number(submittedIso.slice(0, 4));
    const submittedMonth = Number(submittedIso.slice(5, 7));
    year = month < submittedMonth - 6 ? submittedYear + 1 : submittedYear;
  }

  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  // Rejects 2/30 and friends: Date.parse normalises them to a different day.
  return isoDate(iso) === iso ? iso : null;
}

/**
 * Canonical join key for a truck number, or "" when the value is not one.
 *
 * The digits-only guard matters: `assigned_truck_no` sometimes holds "BYOV" or
 * "N/A", and toDisplayNumber would pad those into "0BYOV" — a fake truck number
 * that could collide with nothing but would be printed to Sharon as real.
 */
function truckKey(value: string | null | undefined): string {
  const canonical = toCanonical(String(value ?? ""));
  return /^\d+$/.test(canonical) ? canonical : "";
}

function percentile(sorted: number[], fraction: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return sorted[index];
}

function summarise(rows: VanDeliveryRow[]): VanDeliverySummary {
  const byStatus: Record<VanDeliveryStatus, number> = {
    delivered: 0,
    in_transit: 0,
    no_transport_record: 0,
    awaiting_truck_assignment: 0,
    byov_no_van: 0,
  };
  for (const row of rows) byStatus[row.status] += 1;

  const days = rows
    .map((row) => row.daysHireToVanDelivered)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);

  return {
    hireCount: rows.length,
    byStatus,
    daysToVan: {
      measured: days.length,
      mean: days.length ? Number((days.reduce((a, b) => a + b, 0) / days.length).toFixed(1)) : null,
      median: percentile(days, 0.5),
      p25: percentile(days, 0.25),
      p75: percentile(days, 0.75),
      min: days.length ? days[0] : null,
      max: days.length ? days[days.length - 1] : null,
      withinSevenDays: days.filter((value) => value <= 7).length,
      withinFourteenDays: days.filter((value) => value <= 14).length,
      overThirtyDays: days.filter((value) => value > 30).length,
    },
  };
}

export function createVanDeliveryBuilder(sources: VanDeliverySources) {
  return async function buildVanDeliveryModel(
    input: VanDeliveryInput = {},
  ): Promise<{ model: VanDeliveryReadModel; sourceUpdatedAt: string | null; warnings: ApiWarning[] }> {
    const [hires, transports] = await Promise.all([
      sources.readOnboardingHires(),
      sources.readPalTransports().catch((error) => {
        throw new VanDeliverySourceUnavailableError(
          `PAL Transport is unavailable: ${error instanceof Error ? error.message : String(error)}`,
        );
      }),
    ]);

    const modelWarnings: ApiWarning[] = [];
    if (transports.data.length === 0) {
      modelWarnings.push({
        code: "SOURCE_UNAVAILABLE",
        message: "PAL Transport returned no records; no delivery date can be derived.",
      });
    }

    // Group transports by truck so each hire is a single lookup.
    const byTruck = new Map<string, PalTransportSource[]>();
    for (const transport of transports.data) {
      const key = truckKey(transport.truck);
      if (!key) continue;
      const bucket = byTruck.get(key);
      if (bucket) bucket.push(transport);
      else byTruck.set(key, [transport]);
    }

    const today = new Date().toISOString().slice(0, 10);
    const hiredFrom = isoDate(input.hiredFrom);
    const hiredTo = isoDate(input.hiredTo);

    // A truck number carried by more than one hire in the requested window
    // cannot be split apart by truck number alone; both rows get flagged.
    const hiresPerTruck = new Map<string, number>();
    const considered = hires.data.filter((hire) => {
      const hireDate = isoDate(hire.serviceDate);
      if (!hireDate) return false;
      if (hiredFrom && hireDate < hiredFrom) return false;
      if (hiredTo && hireDate > hiredTo) return false;
      if (!input.includeFutureHires && hireDate > today) return false;
      return true;
    });
    for (const hire of considered) {
      const key = truckKey(hire.assignedTruckNo);
      if (key) hiresPerTruck.set(key, (hiresPerTruck.get(key) ?? 0) + 1);
    }

    const rows: VanDeliveryRow[] = considered.map((hire) => {
      const warnings: ApiWarning[] = [];
      const hireDate = isoDate(hire.serviceDate);
      const assignedAt = isoDate(hire.assignedAt);
      const key = truckKey(hire.assignedTruckNo);
      const byovIntent = hire.byovIntent ?? null;

      const base = {
        enterpriseId: hire.enterpriseId ?? null,
        employeeName: hire.employeeName ?? null,
        hireDate,
        district: hire.district ?? null,
        workState: hire.workState ?? null,
        byovIntent,
        employmentStatus: hire.employmentStatus ?? null,
        truckNumber: key ? String(toDisplayNumber(key)) : (hire.assignedTruckNo ?? null),
        truckAssignedAt: assignedAt,
        droppedFromSourceAt: isoTimestamp(hire.droppedFromSourceAt),
        daysHireToTruckAssigned: daysBetween(hireDate, assignedAt),
        deliverySource: null,
        transportRecordId: null,
        transportSubmittedOn: null,
        transportEta: null,
        vanDeliveredOn: null,
        daysHireToVanDelivered: null,
      };

      if (!key) {
        if (hire.assignedTruckNo) {
          warnings.push({
            code: "PARTIAL_DATA",
            message: `Truck number "${hire.assignedTruckNo}" is not a usable vehicle number; no transport could be matched.`,
          });
          return { ...base, status: "no_transport_record" as const, warnings };
        }
        return {
          ...base,
          status: (byovIntent ? "byov_no_van" : "awaiting_truck_assignment") as VanDeliveryStatus,
          warnings,
        };
      }

      if (byovIntent) {
        warnings.push({
          code: "PARTIAL_DATA",
          message: `Hire is flagged BYOV ("${byovIntent}") but also carries truck ${base.truckNumber}; confirm which is correct before quoting this row.`,
        });
      }
      if ((hiresPerTruck.get(key) ?? 0) > 1) {
        warnings.push({
          code: "AMBIGUOUS_MATCH",
          message: `Truck ${base.truckNumber} is assigned to more than one hire in this window; the delivery date may belong to the other technician.`,
        });
      }

      const candidates = byTruck.get(key) ?? [];
      // Anchor: only a transport at/after the assignment can be this delivery.
      const anchor = shiftDays(assignedAt ?? hireDate ?? today, -ASSIGNMENT_ANCHOR_GRACE_DAYS);

      const delivered = candidates
        .filter((transport) => String(transport.status ?? "").toLowerCase() === "completed")
        .map((transport) => ({
          transport,
          on: parseDeliveredDate(transport.delivered, transport.submitted),
        }))
        .filter((entry): entry is { transport: PalTransportSource; on: string } =>
          entry.on !== null && entry.on >= anchor)
        // Earliest qualifying delivery is the one that put the tech in the van;
        // a later transport for the same truck is a subsequent move.
        .sort((a, b) => a.on.localeCompare(b.on));

      if (delivered.length > 0) {
        const best = delivered[0];
        if (delivered.length > 1) {
          warnings.push({
            code: "AMBIGUOUS_MATCH",
            message: `${delivered.length} completed transports for truck ${base.truckNumber} fall after this assignment; the earliest (${best.on}) is reported.`,
          });
        }
        return {
          ...base,
          status: "delivered" as const,
          vanDeliveredOn: best.on,
          daysHireToVanDelivered: daysBetween(hireDate, best.on),
          deliverySource: "pal_transport" as const,
          transportRecordId: best.transport.id ?? null,
          transportSubmittedOn: isoDate(best.transport.submitted),
          transportEta: best.transport.eta ?? null,
          warnings,
        };
      }

      // Nothing delivered. An open transport submitted on/after the assignment
      // means the van is on its way; anything else means no PAL job covers it.
      const open = candidates
        .filter((transport) => {
          const status = String(transport.status ?? "").toLowerCase();
          if (status === "completed" || status === "cancelled") return false;
          const submitted = isoDate(transport.submitted);
          return submitted !== null && submitted >= anchor;
        })
        .sort((a, b) => String(a.submitted ?? "").localeCompare(String(b.submitted ?? "")));

      if (open.length > 0) {
        const transport = open[0];
        return {
          ...base,
          status: "in_transit" as const,
          transportRecordId: transport.id ?? null,
          transportSubmittedOn: isoDate(transport.submitted),
          transportEta: transport.eta ?? null,
          warnings,
        };
      }

      warnings.push({
        code: "PARTIAL_DATA",
        message: candidates.length === 0
          ? `No PAL transport exists for truck ${base.truckNumber}. It was towed through Holman or handed over locally; the delivery date is not recorded anywhere.`
          : `PAL has ${candidates.length} transport(s) for truck ${base.truckNumber} but none completed after this assignment.`,
      });
      return { ...base, status: "no_transport_record" as const, warnings };
    });

    rows.sort((a, b) =>
      String(b.hireDate ?? "").localeCompare(String(a.hireDate ?? "")) ||
      String(a.employeeName ?? "").localeCompare(String(b.employeeName ?? "")));

    const sourceUpdatedAt = [hires.sourceUpdatedAt, transports.sourceUpdatedAt]
      .filter((value): value is string => !!value && Number.isFinite(Date.parse(value)))
      .sort()[0] ?? null;

    return {
      model: {
        filters: { hiredFrom, hiredTo },
        summary: summarise(rows),
        rows,
      },
      sourceUpdatedAt,
      warnings: modelWarnings,
    };
  };
}

// ── CSV rendering ────────────────────────────────────────────────────────────
// Sharon's team consumes this from Excel / Power Query, which cannot send a
// bearer header through a plain web query but can through a data connection.
// The CSV is the same rows, flattened, so the two formats never disagree.

const CSV_COLUMNS: Array<[string, (row: VanDeliveryRow) => string | number | null]> = [
  ["enterprise_id", (row) => row.enterpriseId],
  ["employee_name", (row) => row.employeeName],
  ["hire_date", (row) => row.hireDate],
  ["district", (row) => row.district],
  ["work_state", (row) => row.workState],
  ["byov_intent", (row) => row.byovIntent],
  ["employment_status", (row) => row.employmentStatus],
  ["truck_number", (row) => row.truckNumber],
  ["truck_assigned_at", (row) => row.truckAssignedAt],
  ["dropped_from_roster_at", (row) => row.droppedFromSourceAt],
  ["days_hire_to_truck_assigned", (row) => row.daysHireToTruckAssigned],
  ["status", (row) => row.status],
  ["van_delivered_on", (row) => row.vanDeliveredOn],
  ["days_hire_to_van_delivered", (row) => row.daysHireToVanDelivered],
  ["delivery_source", (row) => row.deliverySource],
  ["transport_record_id", (row) => row.transportRecordId],
  ["transport_submitted_on", (row) => row.transportSubmittedOn],
  ["notes", (row) => row.warnings.map((warning) => warning.message).join(" | ")],
];

function csvCell(value: string | number | null): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function renderVanDeliveryCsv(rows: VanDeliveryRow[]): string {
  const lines = [CSV_COLUMNS.map(([header]) => header).join(",")];
  for (const row of rows) {
    lines.push(CSV_COLUMNS.map(([, read]) => csvCell(read(row))).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

// ── Production sources ───────────────────────────────────────────────────────

const PAL_RECORDS_URL =
  process.env.PAL_TRANSPORT_BASE_URL?.replace(/\/+$/, "") ?? "https://paltransport.replit.app";
const PAL_CACHE_TTL_MS = 10 * 60 * 1000;
const PAL_FETCH_TIMEOUT_MS = 20_000;

let palCache: { fetchedAt: number; data: PalTransportSource[]; sourceUpdatedAt: string | null } | null = null;

/** Exported for tests; clears the in-process PAL cache. */
export function resetPalTransportCache(): void {
  palCache = null;
}

async function readPalTransportsLive(): Promise<{ data: PalTransportSource[]; sourceUpdatedAt: string | null }> {
  if (palCache && Date.now() - palCache.fetchedAt < PAL_CACHE_TTL_MS) {
    return { data: palCache.data, sourceUpdatedAt: palCache.sourceUpdatedAt };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAL_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${PAL_RECORDS_URL}/api/records`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = (await response.json()) as { records?: unknown[]; version?: number };
    const data: PalTransportSource[] = (payload.records ?? []).map((raw) => {
      const record = raw as Record<string, unknown>;
      return {
        id: typeof record.id === "number" ? record.id : Number(record.id) || null,
        truck: record.truck == null ? null : String(record.truck),
        status: record.status == null ? null : String(record.status),
        delivered: record.delivered == null ? null : String(record.delivered),
        submitted: record.submitted == null ? null : String(record.submitted),
        eta: record.eta == null ? null : String(record.eta),
      };
    });
    const sourceUpdatedAt = typeof payload.version === "number" && payload.version > 0
      ? new Date(payload.version).toISOString()
      : new Date().toISOString();
    palCache = { fetchedAt: Date.now(), data, sourceUpdatedAt };
    return { data, sourceUpdatedAt };
  } catch (error) {
    // A stale cache beats a 503: the delivery dates in it are still true.
    if (palCache) return { data: palCache.data, sourceUpdatedAt: palCache.sourceUpdatedAt };
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function readOnboardingHiresLive(): Promise<{ data: OnboardingHireSource[]; sourceUpdatedAt: string | null }> {
  const [{ sql }, { db }] = await Promise.all([import("drizzle-orm"), import("../db")]);
  // No dropped_from_source_at filter ON PURPOSE. A hire that fell off the
  // Snowflake roster view is still a person who was hired and (eventually) got
  // a van; several of them fell off while still waiting on a truck. Excluding
  // them would make time-to-van look better than it is. The column is returned
  // instead, so a consumer can tell the two apart.
  const result: any = await db.execute(sql`
    SELECT enterprise_id, employee_name, service_date, district, work_state,
           byov_intent, employment_status, assigned_truck_no, assigned_at,
           dropped_from_source_at, synced_at
    FROM onboarding_hires
    ORDER BY service_date DESC
  `);
  const rows: any[] = Array.isArray(result) ? result : (result?.rows ?? []);
  return {
    data: rows.map((row) => ({
      enterpriseId: row.enterprise_id ?? null,
      employeeName: row.employee_name ?? null,
      serviceDate: isoDate(row.service_date),
      district: row.district ?? null,
      workState: row.work_state ?? null,
      byovIntent: row.byov_intent ?? null,
      employmentStatus: row.employment_status ?? null,
      assignedTruckNo: row.assigned_truck_no ?? null,
      assignedAt: isoTimestamp(row.assigned_at),
      droppedFromSourceAt: isoTimestamp(row.dropped_from_source_at),
    })),
    sourceUpdatedAt: rows
      .map((row) => isoTimestamp(row.synced_at))
      .filter((value): value is string => !!value)
      .sort()
      .reverse()[0] ?? null,
  };
}

export const vanDeliveryProductionSources: VanDeliverySources = {
  readOnboardingHires: readOnboardingHiresLive,
  readPalTransports: readPalTransportsLive,
};

export const buildVanDeliveryModel = createVanDeliveryBuilder(vanDeliveryProductionSources);
