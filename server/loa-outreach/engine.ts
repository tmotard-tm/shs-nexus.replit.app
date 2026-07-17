/**
 * LOA Rental SMS outreach engine (Task #543).
 *
 * Daily automated SMS outreach to technicians on Leave / Paid Leave / Suspended
 * (employment status L/P/S) who either still have an open rental (the "Rental"
 * badge on the Weekly Offboarding LOA table) OR have been on leave > 30 days.
 *
 * - Sends at the 10 AM ET window (the cron route gates on ET hour; the
 *   Fleet-Dispatcher fires every 5 minutes, so DST is handled server-side here).
 * - Sends to BOTH numbers on file (TPMS mobile + SNSTV personal), deduped by
 *   digits, through the fleet-comms outbound pipeline under the "loa_rental"
 *   category, with phoneLocked so the queue drain can't re-resolve the personal
 *   number back to the TPMS number.
 * - Schedules ONE resend (+6h, still inside the 24h window and before evening
 *   quiet hours) that any inbound reply cancels (see inbound.ts hook).
 * - A completed public-form submission permanently excludes the tech from all
 *   future automated sends unless staff re-enable (reenabledAt >= formCompletedAt).
 * - Advisory-locked ("loa-rental-outreach") + per-day idempotent (lastCycleDate
 *   per tech AND a completed sync_logs row per ET day) so double triggers can't
 *   double-text. Run records: sync_logs sync_type 'loa_rental_outreach'.
 * - Gated by app_settings flag `loa_rental_outreach_enabled` (default OFF).
 */
import crypto from "crypto";
import { and, desc, eq, isNotNull, lte, sql as dsql } from "drizzle-orm";
import { db } from "../db";
import { syncLogs } from "@shared/schema";
import { fsDb } from "../fleet-scope-db";
import {
  loaOutreach,
  commsTemplates,
  type LoaOutreachRow,
} from "@shared/fleet-scope-schema";
import { normalizeDigits, renderTemplate } from "../fleet-comms/lib";
import { sendMessage } from "../fleet-comms/outbound";
import { getBooleanSetting } from "../app-settings";
import {
  runUnderAdvisoryLock,
  AdvisoryLockUnavailableError,
} from "../fleetscope-snowflake-sync-lock";
import {
  RENTAL_TICKET_TABLE,
  RENTAL_OPEN_TABLE,
  ticketDateFilter,
  openDateFilter,
  rentalEnrichEnterpriseIds,
} from "../external-fleet-api/rental-ops-read-model";

export const LOA_OUTREACH_SYNC_TYPE = "loa_rental_outreach";
export const LOA_OUTREACH_FLAG = "loa_rental_outreach_enabled";
export const LOA_OUTREACH_LOCK = "loa-rental-outreach";
export const LOA_OUTREACH_CATEGORY = "loa_rental";
/** ET hour (24h) the daily send fires in. */
export const LOA_SEND_ET_HOUR = 10;
/** Resend delay — inside the 24h window and before evening quiet hours. */
const RESEND_DELAY_MS = 6 * 60 * 60 * 1000;

export const DEFAULT_LOA_TEMPLATE_NAME = "LOA Rental Outreach (default)";
export const DEFAULT_LOA_TEMPLATE_BODY = `Hello, this is Sears Home Services.
Our records indicate that you may currently still have a company van and or a rental vehicle while on a Leave of Absence or Paid Leave.

Please click the following link and fill in the information required so we can update our records and arrange for the truck to be picked up as per our policy:

{formLink}

Thank you for your prompt response.`;

// ---------------------------------------------------------------------------
// Time helpers (America/New_York)
// ---------------------------------------------------------------------------

const ET_DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const ET_HOUR_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "numeric",
  hour12: false,
});

export function etToday(now: Date = new Date()): string {
  return ET_DATE_FMT.format(now); // yyyy-mm-dd
}

export function etHour(now: Date = new Date()): number {
  return Number(ET_HOUR_FMT.format(now)) % 24;
}

// ---------------------------------------------------------------------------
// Form link
// ---------------------------------------------------------------------------

export function publicBaseUrl(): string | null {
  return (
    process.env.COMMS_PUBLIC_BASE_URL ||
    process.env.SAML_BASE_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    null
  );
}

export function formLinkForToken(token: string): string {
  const base = (publicBaseUrl() || "").replace(/\/$/, "");
  return `${base}/loa-form/${token}`;
}

function mintToken(): string {
  return crypto.randomBytes(24).toString("hex"); // 48 chars, unguessable
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

/** Latest-updated loa_rental template; seeds the verbatim default when none exists. */
export async function getLoaTemplateBody(): Promise<string> {
  const rows = await fsDb
    .select()
    .from(commsTemplates)
    .where(eq(commsTemplates.category, LOA_OUTREACH_CATEGORY))
    .orderBy(desc(commsTemplates.updatedAt))
    .limit(1);
  if (rows.length) return rows[0].body;
  await fsDb.insert(commsTemplates).values({
    category: LOA_OUTREACH_CATEGORY,
    name: DEFAULT_LOA_TEMPLATE_NAME,
    body: DEFAULT_LOA_TEMPLATE_BODY,
    createdBy: "loa-outreach",
  });
  return DEFAULT_LOA_TEMPLATE_BODY;
}

// ---------------------------------------------------------------------------
// Recipient resolver
// ---------------------------------------------------------------------------

export interface LoaRecipient {
  ldap: string; // UPPER(TRIM(ENTERPRISE_ID))
  name: string;
  truckNumber: string; // may be ""
  /** Deduplicated 10-digit phone numbers: TPMS mobile first, then SNSTV personal. */
  phones: string[];
  hasRentalBadge: boolean;
  daysSinceLastWorked: number | null;
}

function toTenDigits(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  let d = String(v).replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length === 10 ? d : null;
}

/**
 * The open-rental Enterprise-ID membership set — same population as the Rental
 * badge on the Weekly Offboarding LOA table (default/badge scope of
 * GET /api/rental-ops/open-enterprise-ids): Enterprise open tickets enriched to
 * EIDs via the TPMS snapshot, plus Holman open-rental rows (Toll rows excluded).
 */
async function fetchOpenRentalEidSet(sf: any): Promise<Set<string>> {
  const normV = (v: string) => (v || "").trim().replace(/^0+/, "");
  const [ticketRows, holmanRows] = await Promise.all([
    sf.executeQuery(
      `SELECT VEHICLE_NUMBER, RENTER_NAME, RENTAL_START_DATE FROM ${RENTAL_TICKET_TABLE} WHERE ${ticketDateFilter()} AND TICKET_STATUS='OPEN' LIMIT 5000`,
    ) as Promise<any[]>,
    sf.executeQuery(
      `SELECT VEHICLE_NUMBER, ENTERPRISE_ID, RENTAL_VENDOR FROM ${RENTAL_OPEN_TABLE} WHERE ${openDateFilter()} LIMIT 5000`,
    ) as Promise<any[]>,
  ]);

  const entByVehicle = new Map<string, any>();
  for (const r of ticketRows) {
    const vn = normV(r.VEHICLE_NUMBER || "");
    if (!vn) continue;
    const existing = entByVehicle.get(vn);
    const rDate = new Date(r.RENTAL_START_DATE || "2000-01-01").getTime();
    const eDate = existing
      ? new Date(existing.RENTAL_START_DATE || "2000-01-01").getTime()
      : 0;
    if (!existing || rDate > eDate) entByVehicle.set(vn, r);
  }

  const enrichRows: any[] = Array.from(entByVehicle.values()).map((r) => ({
    renterName: (r.RENTER_NAME || "").trim(),
    enterpriseId: null as string | null,
    source: "enterprise",
  }));
  await rentalEnrichEnterpriseIds(sf, enrichRows);

  const entIds = new Set<string>();
  for (const row of enrichRows) {
    if (row.enterpriseId) entIds.add(String(row.enterpriseId).trim().toUpperCase());
  }
  for (const r of holmanRows) {
    if (/toll/i.test(r.RENTAL_VENDOR || "")) continue; // toll charges, not rentals
    const eid = (r.ENTERPRISE_ID || "").trim().toUpperCase();
    if (eid) entIds.add(eid);
  }
  return entIds;
}

/**
 * Qualifying recipients: L/P/S techs with (Rental badge OR Date Last Worked
 * more than 30 days ago — a missing date is NOT over-30 by that criterion),
 * that have at least one usable 10-digit phone.
 */
export async function resolveLoaRecipients(): Promise<LoaRecipient[]> {
  const { getSnowflakeService, isSnowflakeConfigured } = await import(
    "../snowflake-service"
  );
  if (!isSnowflakeConfigured()) {
    throw new Error("Snowflake not configured — cannot resolve LOA recipients");
  }
  const sf = getSnowflakeService();
  await sf.connect();

  const query = `
    SELECT
      t.FULL_NAME,
      t.ENTERPRISE_ID,
      t.DATE_LAST_WORKED,
      COALESCE(tpms.MOBILEPHONENUMBER, tpms_last.MOBILEPHONENUMBER) AS MOBILEPHONENUMBER,
      COALESCE(tpms.TRUCK_LU, tpms_last.TRUCK_LU) AS TRUCK_LU,
      c.SNSTV_MAIN_PHONE,
      c.SNSTV_HOME_PHONE,
      c.SNSTV_CELL_PHONE
    FROM PARTS_SUPPLYCHAIN.FLEET.DRIVELINE_ALL_TECHS t
    LEFT JOIN PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT tpms
      ON UPPER(TRIM(t.ENTERPRISE_ID)) = UPPER(TRIM(tpms.ENTERPRISE_ID))
    LEFT JOIN PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT_LAST_ASSIGNED tpms_last
      ON UPPER(TRIM(t.ENTERPRISE_ID)) = UPPER(TRIM(tpms_last.ENTERPRISE_ID))
    LEFT JOIN PRD_TECH_RECRUITMENT.BATCH_VIEWS.ORA_TECH_LAST_KNOWN_CONTACT_VW_VIEW c
      ON t.EMPL_ID = c.EMPLID
    WHERE t.EMPLOYMENT_STATUS IN ('L', 'P', 'S')
  `;
  const rows = (await sf.executeQuery(query)) as Array<{
    FULL_NAME: string | null;
    ENTERPRISE_ID: string | null;
    DATE_LAST_WORKED: string | null;
    MOBILEPHONENUMBER: string | number | null;
    TRUCK_LU: string | null;
    SNSTV_MAIN_PHONE: string | number | null;
    SNSTV_HOME_PHONE: string | number | null;
    SNSTV_CELL_PHONE: string | number | null;
  }>;

  const badgeEids = await fetchOpenRentalEidSet(sf);

  const now = Date.now();
  const byLdap = new Map<string, LoaRecipient>();
  for (const row of rows) {
    const ldap = (row.ENTERPRISE_ID || "").trim().toUpperCase();
    if (!ldap || byLdap.has(ldap)) continue;

    let daysSinceLastWorked: number | null = null;
    if (row.DATE_LAST_WORKED) {
      const t = new Date(row.DATE_LAST_WORKED).getTime();
      if (!Number.isNaN(t)) daysSinceLastWorked = Math.floor((now - t) / 86_400_000);
    }
    const hasRentalBadge = badgeEids.has(ldap);
    const over30 = daysSinceLastWorked !== null && daysSinceLastWorked > 30;
    if (!hasRentalBadge && !over30) continue;

    // TPMS mobile first, then SNSTV cell || main || home; dedupe by digits.
    const phones: string[] = [];
    const seen = new Set<string>();
    for (const cand of [
      row.MOBILEPHONENUMBER,
      row.SNSTV_CELL_PHONE || row.SNSTV_MAIN_PHONE || row.SNSTV_HOME_PHONE,
    ]) {
      const d = toTenDigits(cand);
      if (d && !seen.has(d)) {
        seen.add(d);
        phones.push(d);
      }
    }
    if (!phones.length) continue;

    byLdap.set(ldap, {
      ldap,
      name: (row.FULL_NAME || "").trim(),
      truckNumber: (row.TRUCK_LU || "").trim(),
      phones,
      hasRentalBadge,
      daysSinceLastWorked,
    });
  }
  return Array.from(byLdap.values());
}

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

export function isFormExcluded(row: Pick<LoaOutreachRow, "formCompletedAt" | "reenabledAt">): boolean {
  if (!row.formCompletedAt) return false;
  // Staff re-enable wins when it happened at/after the form completion.
  return !(row.reenabledAt && row.reenabledAt >= row.formCompletedAt);
}

/** Get-or-create the per-tech state row (mints the unguessable token once). */
export async function getOrCreateOutreachRow(
  ldap: string,
  techName?: string | null,
  truckNumber?: string | null,
): Promise<LoaOutreachRow> {
  const key = ldap.trim().toUpperCase();
  const existing = await fsDb
    .select()
    .from(loaOutreach)
    .where(eq(loaOutreach.ldap, key))
    .limit(1);
  if (existing.length) return existing[0];
  const [row] = await fsDb
    .insert(loaOutreach)
    .values({
      ldap: key,
      token: mintToken(),
      techName: techName || null,
      truckNumber: truckNumber || null,
    })
    .onConflictDoNothing()
    .returning();
  if (row) return row;
  const [again] = await fsDb
    .select()
    .from(loaOutreach)
    .where(eq(loaOutreach.ldap, key))
    .limit(1);
  return again;
}

/** Inbound-reply hook: record the reply and cancel any pending resend. */
export async function markLoaReplied(ldap: string): Promise<void> {
  const key = (ldap || "").trim().toUpperCase();
  if (!key) return;
  await fsDb
    .update(loaOutreach)
    .set({ repliedAt: new Date(), pendingResendAt: null, updatedAt: new Date() })
    .where(eq(loaOutreach.ldap, key));
}

/** Form-submission hook: permanently exclude + cancel pending resend. */
export async function markLoaFormCompleted(
  ldap: string,
  formTruckNumber: string,
  formData: Record<string, unknown>,
): Promise<void> {
  const key = ldap.trim().toUpperCase();
  await fsDb
    .update(loaOutreach)
    .set({
      formCompletedAt: new Date(),
      formTruckNumber,
      formData,
      pendingResendAt: null,
      updatedAt: new Date(),
    })
    .where(eq(loaOutreach.ldap, key));
}

/** Staff escape hatch: resume automated outreach after a form submission. */
export async function reenableLoaOutreach(ldap: string, by: string): Promise<boolean> {
  const key = (ldap || "").trim().toUpperCase();
  const res = await fsDb
    .update(loaOutreach)
    .set({ reenabledAt: new Date(), reenabledBy: by, updatedAt: new Date() })
    .where(eq(loaOutreach.ldap, key))
    .returning({ ldap: loaOutreach.ldap });
  return res.length > 0;
}

export async function getLoaOutreachRows(ldaps: string[]): Promise<LoaOutreachRow[]> {
  const keys = ldaps.map((l) => l.trim().toUpperCase()).filter(Boolean);
  if (!keys.length) return [];
  return fsDb
    .select()
    .from(loaOutreach)
    .where(dsql`${loaOutreach.ldap} IN (${dsql.join(keys.map((k) => dsql`${k}`), dsql`, `)})`);
}

export async function getLoaOutreachRowByToken(token: string): Promise<LoaOutreachRow | undefined> {
  const t = (token || "").trim();
  if (!t) return undefined;
  const rows = await fsDb
    .select()
    .from(loaOutreach)
    .where(eq(loaOutreach.token, t))
    .limit(1);
  return rows[0];
}

// ---------------------------------------------------------------------------
// Daily run
// ---------------------------------------------------------------------------

export interface LoaRunResult {
  skipped: boolean;
  reason?: string;
  dryRun?: boolean;
  recipients: number;
  sentTechs: number;
  sentMessages: number;
  excluded: number;
  alreadySentToday: number;
  errors: number;
  preview?: Array<{ ldap: string; name: string; phones: string[]; body: string }>;
}

async function alreadyCompletedToday(now: Date): Promise<boolean> {
  const rows = await db
    .select({ completedAt: syncLogs.completedAt })
    .from(syncLogs)
    .where(and(eq(syncLogs.syncType, LOA_OUTREACH_SYNC_TYPE), eq(syncLogs.status, "completed")))
    .orderBy(desc(syncLogs.completedAt))
    .limit(1);
  const last = rows[0]?.completedAt;
  return !!last && etToday(last) === etToday(now);
}

/**
 * One outreach cycle. Caller (cron route) is responsible for the ET-hour gate;
 * this function enforces the flag, advisory lock, and per-day idempotency.
 *
 * - force: bypass the enabled flag + per-day idempotency (manual staff runs).
 * - dryRun: resolve + render but send NOTHING and write no state (preview).
 */
export async function runLoaOutreach(
  triggeredBy: string,
  opts: { force?: boolean; dryRun?: boolean } = {},
): Promise<LoaRunResult> {
  const { force = false, dryRun = false } = opts;
  const now = new Date();

  if (!dryRun && !force) {
    const enabled = await getBooleanSetting(LOA_OUTREACH_FLAG, false);
    if (!enabled) {
      return { skipped: true, reason: "disabled", recipients: 0, sentTechs: 0, sentMessages: 0, excluded: 0, alreadySentToday: 0, errors: 0 };
    }
  }

  try {
    return await runUnderAdvisoryLock(LOA_OUTREACH_LOCK, "loa-outreach", async () => {
      if (!dryRun && !force && (await alreadyCompletedToday(now))) {
        return { skipped: true, reason: "already_ran_today", recipients: 0, sentTechs: 0, sentMessages: 0, excluded: 0, alreadySentToday: 0, errors: 0 } as LoaRunResult;
      }

      const template = await getLoaTemplateBody();
      const recipients = await resolveLoaRecipients();

      const result: LoaRunResult = {
        skipped: false,
        dryRun,
        recipients: recipients.length,
        sentTechs: 0,
        sentMessages: 0,
        excluded: 0,
        alreadySentToday: 0,
        errors: 0,
        preview: dryRun ? [] : undefined,
      };

      let logId: string | null = null;
      if (!dryRun) {
        const [logRow] = await db
          .insert(syncLogs)
          .values({ syncType: LOA_OUTREACH_SYNC_TYPE, status: "running", triggeredBy })
          .returning({ id: syncLogs.id });
        logId = logRow?.id ?? null;
      }

      try {
        const today = etToday(now);
        for (const rec of recipients) {
          try {
            const state = await getOrCreateOutreachRow(rec.ldap, rec.name, rec.truckNumber);
            if (isFormExcluded(state)) {
              result.excluded++;
              continue;
            }
            if (!force && state.lastCycleDate === today) {
              result.alreadySentToday++;
              continue;
            }

            const body = renderTemplate(template, {
              name: rec.name,
              ldap: rec.ldap,
              truck: rec.truckNumber,
              formLink: formLinkForToken(state.token),
            });

            if (dryRun) {
              result.preview!.push({ ldap: rec.ldap, name: rec.name, phones: rec.phones, body });
              result.sentTechs++;
              result.sentMessages += rec.phones.length;
              continue;
            }

            let sentAny = 0;
            for (const digits of rec.phones) {
              const sendRes = await sendMessage({
                ldap: rec.ldap,
                phone: digits,
                phoneLocked: true,
                category: LOA_OUTREACH_CATEGORY,
                body,
                sentBy: "loa-outreach",
                senderName: "LOA Rental Outreach",
              });
              if (sendRes.status === "sent" || sendRes.status === "queued") sentAny++;
            }
            if (sentAny > 0) {
              result.sentTechs++;
              result.sentMessages += sentAny;
              await fsDb
                .update(loaOutreach)
                .set({
                  techName: rec.name || state.techName,
                  // never blank out a known truck number
                  truckNumber: rec.truckNumber || state.truckNumber,
                  lastCycleDate: today,
                  lastSentAt: new Date(),
                  lastSentPhones: rec.phones.join(","),
                  lastBody: body,
                  pendingResendAt: new Date(Date.now() + RESEND_DELAY_MS),
                  resendSentAt: null,
                  updatedAt: new Date(),
                })
                .where(eq(loaOutreach.ldap, state.ldap));
            } else {
              result.errors++;
            }
          } catch (err) {
            result.errors++;
            console.error(`[LOA Outreach] send failed for ${rec.ldap}:`, err);
          }
        }

        if (logId) {
          await db
            .update(syncLogs)
            .set({
              status: "completed",
              completedAt: new Date(),
              recordsProcessed: result.sentTechs,
              recordsCreated: result.sentMessages,
              errorMessage: result.errors ? `${result.errors} tech send failures` : null,
            })
            .where(eq(syncLogs.id, logId));
        }
        return result;
      } catch (err: any) {
        if (logId) {
          await db
            .update(syncLogs)
            .set({ status: "failed", completedAt: new Date(), errorMessage: String(err?.message || err).slice(0, 500) })
            .where(eq(syncLogs.id, logId));
        }
        throw err;
      }
    }, { waitMs: 8000 });
  } catch (err) {
    if (err instanceof AdvisoryLockUnavailableError) {
      return { skipped: true, reason: "lock_contended", recipients: 0, sentTechs: 0, sentMessages: 0, excluded: 0, alreadySentToday: 0, errors: 0 };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Resend drain — called on every cron tick (cheap, no Snowflake)
// ---------------------------------------------------------------------------

export async function processLoaResends(): Promise<{ resent: number; errors: number }> {
  const enabled = await getBooleanSetting(LOA_OUTREACH_FLAG, false);
  if (!enabled) return { resent: 0, errors: 0 };

  const due = await fsDb
    .select()
    .from(loaOutreach)
    .where(and(isNotNull(loaOutreach.pendingResendAt), lte(loaOutreach.pendingResendAt, new Date())))
    .limit(200);

  let resent = 0;
  let errors = 0;
  for (const row of due) {
    try {
      if (isFormExcluded(row) || !row.lastBody || !row.lastSentPhones) {
        await fsDb
          .update(loaOutreach)
          .set({ pendingResendAt: null, updatedAt: new Date() })
          .where(eq(loaOutreach.ldap, row.ldap));
        continue;
      }
      // Atomically claim the resend so overlapping cron ticks can't double-send.
      const claimed = await fsDb
        .update(loaOutreach)
        .set({ pendingResendAt: null, resendSentAt: new Date(), updatedAt: new Date() })
        .where(and(eq(loaOutreach.ldap, row.ldap), isNotNull(loaOutreach.pendingResendAt)))
        .returning({ ldap: loaOutreach.ldap });
      if (!claimed.length) continue;

      const phones = row.lastSentPhones.split(",").map((p) => p.trim()).filter(Boolean);
      for (const digits of phones) {
        await sendMessage({
          ldap: row.ldap,
          phone: digits,
          phoneLocked: true,
          category: LOA_OUTREACH_CATEGORY,
          body: row.lastBody,
          sentBy: "loa-outreach",
          senderName: "LOA Rental Outreach",
        });
      }
      resent++;
    } catch (err) {
      errors++;
      console.error(`[LOA Outreach] resend failed for ${row.ldap}:`, err);
    }
  }
  return { resent, errors };
}

// ---------------------------------------------------------------------------
// Health / status
// ---------------------------------------------------------------------------

export async function getLoaOutreachHealth(): Promise<{
  enabled: boolean;
  lastRun: { status: string; startedAt: Date | null; completedAt: Date | null; recordsProcessed: number | null; errorMessage: string | null } | null;
}> {
  const enabled = await getBooleanSetting(LOA_OUTREACH_FLAG, false);
  const rows = await db
    .select({
      status: syncLogs.status,
      startedAt: syncLogs.startedAt,
      completedAt: syncLogs.completedAt,
      recordsProcessed: syncLogs.recordsProcessed,
      errorMessage: syncLogs.errorMessage,
    })
    .from(syncLogs)
    .where(eq(syncLogs.syncType, LOA_OUTREACH_SYNC_TYPE))
    .orderBy(desc(dsql`COALESCE(${syncLogs.completedAt}, ${syncLogs.startedAt})`))
    .limit(1);
  return { enabled, lastRun: rows[0] ?? null };
}
