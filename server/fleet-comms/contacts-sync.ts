/**
 * Master Fleet Communications Module — daily Contacts sync (Task #524).
 *
 * Rebuilds fs_comms_contacts from the Active Roster (universe + employment
 * status) LEFT JOINed to TPMS_EXTRACT (phone / district / state / truck /
 * manager). The module keeps its OWN contact directory so the inbox never has
 * to hit Snowflake live.
 *
 * Safety (mirrors the Rental Ops sync philosophy — never wipe on bad data):
 *   - Runs under the SHARED Snowflake advisory lock (no concurrent heavy reads).
 *   - 0 rows from Snowflake → abort, record 'failed', tombstone NOTHING.
 *   - Suspiciously small pull (< max(FLOOR, baseline×RATIO)) → upsert what we
 *     got but SKIP tombstoning, so a partial pull can't mass-flag techs as
 *     terminated. Overridable with force.
 *   - Tombstoning is soft: active=false + terminationDetectedAt (reversible if
 *     the tech reappears). We never DELETE a contact (message history keeps its
 *     LDAP linkage).
 */
import { db } from "../db";
import { syncLogs } from "@shared/schema";
import { desc, eq, and } from "drizzle-orm";
import { fsDb } from "../fleet-scope-db";
import { commsContacts, commsThreads, type CommsContact } from "@shared/fleet-scope-schema";
import {
  runUnderSnowflakeSyncLock,
  AdvisoryLockUnavailableError,
} from "../fleetscope-snowflake-sync-lock";
import { getSnowflakeService, isSnowflakeConfigured } from "../snowflake-service";
import { normalizeDigits, snapshotDateSupersedesLivePin } from "./lib";
import { recordPhoneChange, mergeResolvedUnmatchedThreads, bulkArchiveUnmatched } from "./storage";
import { enrichThreadContacts } from "./enrich";

export const COMMS_CONTACTS_SYNC_TYPE = "comms_contacts";

const MIN_FLOOR = Number(process.env.COMMS_CONTACTS_MIN_FLOOR ?? 200);
const MIN_RATIO = Number(process.env.COMMS_CONTACTS_MIN_RATIO ?? 0.5);

export interface RosterRow {
  LDAP: string;
  NAME: string | null;
  EMPL_STATUS: string | null;
  MANAGER_LDAP: string | null;
  MANAGER_NAME: string | null;
  PHONE: string | number | null;
  /** FILE_DATE of the TPMS_EXTRACT row the phone came from (live-pin guard). */
  PHONE_FILE_DATE?: string | Date | null;
  DISTRICT: string | null;
  PRIMARYSTATE: string | null;
  TRUCK_LU: string | null;
}

const SYNC_SQL = `
  /* fleet-comms contacts sync */
  WITH roster AS (
    SELECT
      UPPER(TRIM(ENTERPRISE_ID))            AS LDAP,
      EMPL_NAME,
      EMPL_STATUS,
      UPPER(TRIM(SUPERVISOR_ENTERPRISE_ID)) AS SUP_LDAP,
      SUPERVISOR_NAME
    FROM IT_ANALYTICS.HR_REPORTING_TECH_NON_SENSITIVE.NS_TECH_ACTIVE_ROSTER_DAILY_VW
    WHERE EMPL_STATUS IN ('A','L','P','S')
      AND ENTERPRISE_ID IS NOT NULL AND TRIM(ENTERPRISE_ID) <> ''
  ),
  tpms AS (
    SELECT * FROM (
      SELECT
        UPPER(TRIM(ENTERPRISE_ID)) AS LDAP,
        MOBILEPHONENUMBER,
        FILE_DATE,
        FULL_NAME,
        DISTRICT,
        PRIMARYSTATE,
        TRUCK_LU,
        UPPER(TRIM(MANAGER_ENT_ID)) AS MANAGER_ENT_ID,
        MANAGER_NAME,
        ROW_NUMBER() OVER (
          PARTITION BY UPPER(TRIM(ENTERPRISE_ID))
          ORDER BY CASE WHEN MOBILEPHONENUMBER IS NOT NULL AND TRIM(MOBILEPHONENUMBER) <> '' THEN 0 ELSE 1 END,
                   FILE_DATE DESC NULLS LAST
        ) AS rn
      FROM PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT
      WHERE ENTERPRISE_ID IS NOT NULL AND TRIM(ENTERPRISE_ID) <> ''
    ) WHERE rn = 1
  )
  SELECT
    r.LDAP,
    COALESCE(r.EMPL_NAME, t.FULL_NAME)          AS NAME,
    r.EMPL_STATUS,
    COALESCE(r.SUP_LDAP, t.MANAGER_ENT_ID)      AS MANAGER_LDAP,
    COALESCE(r.SUPERVISOR_NAME, t.MANAGER_NAME) AS MANAGER_NAME,
    t.MOBILEPHONENUMBER                         AS PHONE,
    t.FILE_DATE                                 AS PHONE_FILE_DATE,
    t.DISTRICT,
    t.PRIMARYSTATE,
    t.TRUCK_LU
  FROM roster r
  LEFT JOIN tpms t ON r.LDAP = t.LDAP
`;

async function getBaselineCount(): Promise<number | null> {
  const [row] = await db
    .select({ n: syncLogs.recordsProcessed })
    .from(syncLogs)
    .where(and(eq(syncLogs.syncType, COMMS_CONTACTS_SYNC_TYPE), eq(syncLogs.status, "completed")))
    .orderBy(desc(syncLogs.completedAt))
    .limit(1);
  return row?.n ?? null;
}

export interface CommsContactsSyncResult {
  skipped?: boolean;
  skipReason?: string;
  fetched: number;
  created: number;
  updated: number;
  tombstoned: number;
  reactivated: number;
  phoneChanges: number;
  threadsNamed?: number;
  threadsUnified?: number;
}

export async function recordFailedContactsSync(
  message: string,
  triggeredBy: string,
): Promise<void> {
  await db.insert(syncLogs).values({
    syncType: COMMS_CONTACTS_SYNC_TYPE,
    status: "failed",
    completedAt: new Date(),
    errorMessage: message.slice(0, 1000),
    triggeredBy,
  });
}

export async function syncCommsContacts(
  triggeredBy = "scheduler",
  // `_rowsForTest` is a test-only seam: when provided, the Snowflake fetch is
  // bypassed and the given roster rows drive the reconcile so the anti-wipe
  // guards can be exercised deterministically. Never set it in production code.
  opts: { force?: boolean; _rowsForTest?: RosterRow[] } = {},
): Promise<CommsContactsSyncResult> {
  const useInjectedRows = Array.isArray(opts._rowsForTest);
  if (!useInjectedRows && !isSnowflakeConfigured()) {
    await recordFailedContactsSync("Snowflake not configured", triggeredBy);
    throw new Error("Snowflake not configured");
  }

  const [logRow] = await db
    .insert(syncLogs)
    .values({ syncType: COMMS_CONTACTS_SYNC_TYPE, status: "running", triggeredBy })
    .returning();

  try {
    let rows: RosterRow[];
    if (useInjectedRows) {
      rows = opts._rowsForTest as RosterRow[];
    } else {
      try {
        rows = await runUnderSnowflakeSyncLock("comms-contacts", () =>
          getSnowflakeService().executeQuery(SYNC_SQL),
        ) as RosterRow[];
      } catch (err) {
        if (err instanceof AdvisoryLockUnavailableError) {
          await db
            .update(syncLogs)
            .set({ status: "failed", completedAt: new Date(), errorMessage: "sync lock unavailable" })
            .where(eq(syncLogs.id, logRow.id));
          return {
            skipped: true,
            skipReason: "lock unavailable",
            fetched: 0,
            created: 0,
            updated: 0,
            tombstoned: 0,
            reactivated: 0,
            phoneChanges: 0,
          };
        }
        throw err;
      }
    }

    const fetched = rows.length;

    // Guard #1 (absolute): zero rows company-wide is never real → abort, wipe nothing.
    if (fetched === 0) {
      await db
        .update(syncLogs)
        .set({ status: "failed", completedAt: new Date(), errorMessage: "0 rows from roster — aborting" })
        .where(eq(syncLogs.id, logRow.id));
      throw new Error("Contacts sync fetched 0 rows — aborting to avoid mass-tombstone");
    }

    // Guard #2 (proportional): a suspiciously small pull versus the last known-good
    // baseline is treated as a bad upstream read → ABORT and leave last-good data
    // fully intact (never upsert partial data or mass-tombstone). Overridable with
    // force for a genuine large roster change.
    const baseline = await getBaselineCount();
    const floor = Math.max(MIN_FLOOR, baseline ? Math.floor(baseline * MIN_RATIO) : 0);
    if (!opts.force && fetched < floor) {
      const msg = `Low pull (${fetched} < floor ${floor}) — aborting, last-good preserved`;
      await db
        .update(syncLogs)
        .set({ status: "failed", completedAt: new Date(), recordsProcessed: fetched, errorMessage: msg })
        .where(eq(syncLogs.id, logRow.id));
      return {
        skipped: true,
        skipReason: msg,
        fetched,
        created: 0,
        updated: 0,
        tombstoned: 0,
        reactivated: 0,
        phoneChanges: 0,
      };
    }

    // Load existing contacts for diffing.
    const existing = await fsDb.select().from(commsContacts);
    const existingByLdap = new Map<string, CommsContact>();
    for (const c of existing) existingByLdap.set(c.ldap, c);

    // Live-pull pins: a number pulled LIVE from TPMS (thread-header "Pull from
    // TPMS") is newer than any snapshot until the snapshot's FILE_DATE passes
    // the pull day. For pinned contacts we null the incoming phone so the
    // existing preferNonNull merge keeps the live number — no special-case
    // write path, no bogus phone-history rows.
    let livePins = new Map<string, Date>();
    try {
      const livePinRes: any = await fsDb.execute(sql`
        SELECT ldap, MAX(changed_at) AS last_live
        FROM fs_comms_phone_history
        WHERE source = 'live_tpms'
        GROUP BY ldap
      `);
      livePins = new Map<string, Date>(
        (livePinRes.rows ?? []).map((r: any) => [String(r.ldap).toUpperCase(), new Date(r.last_live)]),
      );
    } catch (e: any) {
      // Fail OPEN (no pins) — a broken pin lookup must never wedge the daily
      // contacts sync; worst case is the pre-feature behavior for one run.
      console.warn(`[CommsContactsSync] live-pin lookup failed (proceeding unpinned): ${e?.message || e}`);
    }
    let livePinsHeld = 0;

    const now = new Date();
    const seen = new Set<string>();
    let created = 0;
    let updated = 0;
    let reactivated = 0;
    let phoneChanges = 0;

    const fileDateByLdap = new Map<string, unknown>();
    const values = rows.map((r) => {
      const ldap = (r.LDAP || "").trim().toUpperCase();
      fileDateByLdap.set(ldap, r.PHONE_FILE_DATE ?? null);
      let phone = r.PHONE != null ? String(r.PHONE).trim() : null;
      let phoneDigits = normalizeDigits(phone) || null;
      const pin = livePins.get(ldap);
      if (pin && !snapshotDateSupersedesLivePin(r.PHONE_FILE_DATE ?? null, pin)) {
        // Snapshot not yet newer than the live pull — hold the live number.
        if (phoneDigits) livePinsHeld++;
        phone = null;
        phoneDigits = null;
      }
      seen.add(ldap);
      return {
        ldap,
        name: r.NAME ? String(r.NAME).trim() : null,
        district: r.DISTRICT ? String(r.DISTRICT).trim() : null,
        emplStatus: r.EMPL_STATUS ? String(r.EMPL_STATUS).trim() : null,
        managerLdap: r.MANAGER_LDAP ? String(r.MANAGER_LDAP).trim().toUpperCase() : null,
        managerName: r.MANAGER_NAME ? String(r.MANAGER_NAME).trim() : null,
        phone,
        phoneDigits,
        primaryState: r.PRIMARYSTATE ? String(r.PRIMARYSTATE).trim().toUpperCase() : null,
        truckNumber: r.TRUCK_LU ? String(r.TRUCK_LU).trim() : null,
        active: true,
        terminationDetectedAt: null as Date | null,
        lastSeenAt: now,
        phoneLastVerifiedAt: phoneDigits ? now : null,
        updatedAt: now,
      };
    });

    // Index for the in-transaction late-pin re-check (mid-sync live pulls).
    const valuesByLdap = new Map(values.map((v) => [v.ldap, v]));
    const latePinned = new Set<string>();

    if (livePinsHeld > 0) {
      console.log(
        `[CommsContactsSync] live-TPMS pin held for ${livePinsHeld} contact(s) — snapshot FILE_DATE not yet past the live pull day`,
      );
    }

    // Detect phone changes + created/updated/reactivated counts against existing.
    for (const v of values) {
      const prev = existingByLdap.get(v.ldap);
      if (!prev) {
        created++;
        if (v.phoneDigits) phoneChanges++; // first known number
      } else {
        updated++;
        if (!prev.active) reactivated++;
        if (v.phoneDigits && v.phoneDigits !== prev.phoneDigits) phoneChanges++;
      }
    }

    // Atomic swap: upsert every contact AND tombstone the roster-departed ones in
    // ONE transaction, so the inbox never reads a half-populated contacts table
    // mid-sync. Idempotent (upsert keyed by LDAP) and resumable.
    const toTombstone = existing.filter((c) => c.active && !seen.has(c.ldap));
    let tombstoned = 0;
    await fsDb.transaction(async (tx) => {
      // Serialize with the live "Pull from TPMS" route (same advisory xact
      // lock) and re-check for pins that landed AFTER the pre-transaction pin
      // load: a pull committing mid-sync must not be clobbered by this
      // upsert's already-mapped stale snapshot value. Fail-open on re-check
      // errors (never wedge the daily sync).
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('fs_comms_live_phone_pin')::bigint)`);
      try {
        const late: any = await tx.execute(sql`
          SELECT ldap, MAX(changed_at) AS last_live
          FROM fs_comms_phone_history
          WHERE source = 'live_tpms'
          GROUP BY ldap
        `);
        for (const lr of late.rows ?? []) {
          const lateLdap = String(lr.ldap).toUpperCase();
          const pinAt = new Date(lr.last_live);
          const known = livePins.get(lateLdap);
          if (known && pinAt.getTime() <= known.getTime()) continue; // already applied in mapping
          const v = valuesByLdap.get(lateLdap);
          if (v && v.phoneDigits && !snapshotDateSupersedesLivePin(fileDateByLdap.get(lateLdap) ?? null, pinAt)) {
            v.phone = null;
            v.phoneDigits = null;
            v.phoneLastVerifiedAt = null;
            latePinned.add(lateLdap);
            livePinsHeld++;
            console.log(`[CommsContactsSync] late live-TPMS pin for ${lateLdap} — holding a mid-sync pull`);
          }
        }
      } catch (e: any) {
        console.warn(`[CommsContactsSync] late-pin re-check failed (continuing): ${e?.message || e}`);
      }
      const CHUNK = 400;
      for (let i = 0; i < values.length; i += CHUNK) {
        const chunk = values.slice(i, i + CHUNK);
        await tx
          .insert(commsContacts)
          .values(chunk)
          .onConflictDoUpdate({
            target: commsContacts.ldap,
            set: {
              name: sqlExcluded("name"),
              managerLdap: sqlExcluded("manager_ldap"),
              managerName: sqlExcluded("manager_name"),
              // Never overwrite known-good data with NULL/empty (spec: phone,
              // status, truck — plus district/state which are TPMS-sourced and
              // can go momentarily null on a partial upstream row).
              phone: preferNonNull("phone"),
              phoneDigits: preferNonNull("phone_digits"),
              emplStatus: preferNonNull("empl_status"),
              truckNumber: preferNonNull("truck_number"),
              district: preferNonNull("district"),
              primaryState: preferNonNull("primary_state"),
              active: sqlExcluded("active"),
              terminationDetectedAt: sqlExcluded("termination_detected_at"),
              lastSeenAt: sqlExcluded("last_seen_at"),
              phoneLastVerifiedAt: preferNonNullTs("phone_last_verified_at"),
              updatedAt: sqlExcluded("updated_at"),
            },
          });
      }

      // Soft-tombstone contacts that dropped off the active roster (Guard #2
      // already aborted low pulls, so a full pull is trusted here).
      for (const c of toTombstone) {
        await tx
          .update(commsContacts)
          .set({ active: false, terminationDetectedAt: c.terminationDetectedAt ?? now, updatedAt: now })
          .where(eq(commsContacts.ldap, c.ldap));
        tombstoned++;
      }
    });

    // Record phone-history rows + keep tech-thread denormalized fields current
    // for ANY genuine change (name/district/truck/phone), not only phone — the
    // inbox list/search/header read these denormalized columns, so they drift
    // stale otherwise. We mirror the SAME merge semantics the contacts upsert
    // uses above: name always overwrites (sqlExcluded), while district/truck/
    // phone keep the last known-good value when the incoming row is null
    // (preferNonNull). Post-swap, best-effort — not part of the atomic swap.
    for (const v of values) {
      if (latePinned.has(v.ldap)) continue; // the mid-sync pull already wrote history + thread denorm
      const prev = existingByLdap.get(v.ldap);
      const phoneChanged = !!v.phoneDigits && v.phoneDigits !== (prev?.phoneDigits ?? null);
      if (phoneChanged) await recordPhoneChange(v.ldap, v.phone, "sync").catch(() => {});

      const effName = v.name ?? null;
      const effDistrict = v.district ?? prev?.district ?? null;
      const effTruck = v.truckNumber ?? prev?.truckNumber ?? null;
      const effPhone = v.phoneDigits ?? prev?.phoneDigits ?? null;

      const changed =
        effName !== (prev?.name ?? null) ||
        effDistrict !== (prev?.district ?? null) ||
        effTruck !== (prev?.truckNumber ?? null) ||
        effPhone !== (prev?.phoneDigits ?? null);

      if (changed) {
        await fsDb
          .update(commsThreads)
          .set({ contactName: effName, district: effDistrict, truckNumber: effTruck, phoneDigits: effPhone })
          .where(and(eq(commsThreads.kind, "tech"), eq(commsThreads.ldap, v.ldap)))
          .catch(() => {});
      }
    }

    // Backfill identity onto legacy phone-only ("unmatched") threads so the inbox
    // shows WHO each number is (name / LDAP), resolving current + historical
    // assignment. Best-effort — never fail the sync over enrichment.
    let threadsNamed = 0;
    let threadsUnified = 0;
    try {
      const enriched = await enrichThreadContacts();
      threadsNamed = enriched.named;
      threadsUnified = enriched.unified;
    } catch (e: any) {
      console.error("[Comms Sync] thread enrichment failed:", e?.message);
    }

    // Unmatched lifecycle: first fold any unmatched thread
    // that now resolves to a tech who already has a thread INTO that tech thread
    // (old texts kept, each still labeled with the number it used), then auto-hide
    // every remaining unmatched thread. A new inbound text auto-restores its
    // thread (refreshThreadSummary), so a live reply always resurfaces; the next
    // sync re-hides it only while it stays unmatched.
    let threadsMerged = 0;
    let threadsAutoArchived = 0;
    try {
      threadsMerged = await mergeResolvedUnmatchedThreads();
      threadsAutoArchived = await bulkArchiveUnmatched(null, "auto: unmatched");
    } catch (e: any) {
      console.error("[Comms Sync] unmatched merge/auto-archive failed:", e?.message);
    }
    if (threadsMerged || threadsAutoArchived) {
      console.log(
        `[Comms Sync] unmatched: merged ${threadsMerged} into tech threads, auto-archived ${threadsAutoArchived}`,
      );
    }

    await db
      .update(syncLogs)
      .set({
        status: "completed",
        completedAt: new Date(),
        recordsProcessed: fetched,
        recordsCreated: created,
        recordsUpdated: updated,
        errorMessage: null,
      })
      .where(eq(syncLogs.id, logRow.id));

    return { fetched, created, updated, tombstoned, reactivated, phoneChanges, threadsNamed, threadsUnified };
  } catch (err: any) {
    await db
      .update(syncLogs)
      .set({ status: "failed", completedAt: new Date(), errorMessage: (err?.message ?? String(err)).slice(0, 1000) })
      .where(eq(syncLogs.id, logRow.id))
      .catch(() => {});
    throw err;
  }
}

// Helpers to reference the ON CONFLICT "excluded" row in Drizzle's raw sql.
import { sql } from "drizzle-orm";
function sqlExcluded(col: string) {
  return sql.raw(`excluded."${col}"`);
}
function preferNonNull(col: string) {
  // Keep the existing value when the incoming row's value is NULL or empty.
  // TEXT columns only — the NULLIF('') below forces the literal to the column's
  // type, which throws 22007 on a timestamp. Use preferNonNullTs for those.
  return sql.raw(`COALESCE(NULLIF(excluded."${col}", ''), "fs_comms_contacts"."${col}")`);
}
function preferNonNullTs(col: string) {
  // Timestamp-safe keep-last-good: a timestamp is never an empty string, so we
  // must NOT NULLIF against '' (that coerces '' to timestamp and throws 22007
  // "invalid input syntax for type timestamp"). COALESCE alone preserves the
  // last-good value when the incoming row's value is NULL.
  return sql.raw(`COALESCE(excluded."${col}", "fs_comms_contacts"."${col}")`);
}
