/**
 * LOA Recovery Sync Service (Task #427)
 *
 * Pulls the active continuous-leave roster from the external Reports API,
 * cross-checks it against Snowflake `DRIVELINE_ALL_TECHS` (employment_status
 * L/P), filters to leaves >= 30 days, persists a snapshot row per qualifying
 * tech, and drives the LOA Recovery queue lane.
 *
 * For each *new* qualifying tech (no open LOA Recovery workflow yet), creates
 * three `queue_items` — FLEET (vehicle), Assets Management (tools), Inventory
 * Control (parts) — sharing one `workflowId` per (enterprise_id, leave start).
 *
 * For each tech who *previously* triggered LOA Recovery but no longer appears
 * (or whose days dropped below 30), any of their still-open LOA Recovery
 * items are cancelled with `metadata.cancelled_reason = 'tech_returned_from_loa'`.
 *
 * Runs on app startup (after TPMS snapshot bootstrap) and again on the
 * existing 7:30 AM ET Tech Data Scheduler immediately after
 * `refreshTpmsExtractSnapshot()` — see wiring in `server/fleet-scope-routes.ts`.
 */
import { db } from "./db";
import { queueItems, allTechs, loaRecoverySnapshot, loaLeaves } from "@shared/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getTpmsContact } from "./tpms-extract-snapshot";
import { storage } from "./storage";
import { handleLoaExtension } from "./loa-notifications";

const LEAVES_ENDPOINT =
  "https://employee-search-db-leslieellis.replit.app/api/reports/active-continuous-leaves";

const WORKFLOW_TYPE = "loa_recovery";
const SYSTEM_REQUESTER_ID = "system:loa_recovery";
const MIN_DAYS = 30;
const FETCH_TIMEOUT_MS = 30_000;

/**
 * Ensure the `loa_recovery_snapshot` table (and its two indexes) exist.
 *
 * This table is defined in `shared/schema.ts` but is part of the main Drizzle
 * schema, which is normally applied via `drizzle-kit push`. Because
 * `drizzle-kit push` can conflict with the externally-managed `fs_*` tables
 * (see replit.md gotcha), we create this single table idempotently with raw
 * SQL at the start of every sync run — mirroring the `initFleetScopeSchema()`
 * / `initVrmSchema()` startup pattern. Without this, the sync crashes with
 * `relation "loa_recovery_snapshot" does not exist` before any queue items are
 * created, so LOA Recovery cases never appear in any queue.
 */
async function ensureLoaRecoverySchema(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "loa_recovery_snapshot" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "enterprise_id" varchar(20) NOT NULL,
      "employee_number" varchar(20),
      "sf_status" varchar(5),
      "start_date" date,
      "end_date" date,
      "days" integer NOT NULL,
      "source" varchar(16) NOT NULL,
      "synced_at" timestamp DEFAULT now() NOT NULL
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "loa_recovery_snapshot_enterprise_id_idx"
      ON "loa_recovery_snapshot" ("enterprise_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "loa_recovery_snapshot_synced_at_idx"
      ON "loa_recovery_snapshot" ("synced_at");
  `);

  // Remove any pre-existing duplicate open LOA Recovery items BEFORE creating
  // the unique index (the index creation would otherwise fail while dups exist),
  // then install a partial unique index that guarantees at most one open
  // (pending/in_progress) LOA item per (workflow_id, department). This is the
  // database-level guard that prevents the startup-vs-scheduler race from ever
  // double-writing again — the creation path uses ON CONFLICT DO NOTHING.
  await dedupeOpenLoaItems();
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "loa_recovery_open_workflow_dept_uniq"
      ON "queue_items" ("workflow_id", "department")
      WHERE "workflow_type" = 'loa_recovery'
        AND "status" IN ('pending', 'in_progress')
        AND "workflow_id" IS NOT NULL;
  `);

  // Task #437: persistent per-leave tracking + editable team distribution list.
  // Created idempotently here (like loa_recovery_snapshot) to avoid drizzle-kit
  // push conflicts with the externally-managed fs_* tables.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "loa_leaves" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "workflow_id" varchar NOT NULL UNIQUE,
      "enterprise_id" varchar(20) NOT NULL,
      "employee_number" varchar(20),
      "tech_name" text,
      "first_name" text,
      "phone" varchar(32),
      "van_number" varchar(32),
      "district" varchar(16),
      "is_rental" boolean NOT NULL DEFAULT false,
      "start_date" date,
      "expected_return_date" date,
      "duration_days" integer NOT NULL DEFAULT 0,
      "sf_status" varchar(5),
      "team_notice_sent_at" timestamp,
      "team_notice_msg_id" text,
      "return_notice_sent_at" timestamp,
      "return_notice_msg_id" text,
      "tech_sms_sent_at" timestamp,
      "tech_sms_msg_id" text,
      "extension_triggered" boolean NOT NULL DEFAULT false,
      "extension_triggered_at" timestamp,
      "extension_notice_sent_at" timestamp,
      "extension_notice_msg_id" text,
      "recovery_paused" boolean NOT NULL DEFAULT false,
      "recovery_paused_at" timestamp,
      "closed" boolean NOT NULL DEFAULT false,
      "closed_at" timestamp,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL,
      "last_synced_at" timestamp DEFAULT now() NOT NULL
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "loa_leaves_enterprise_id_idx"
      ON "loa_leaves" ("enterprise_id");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "loa_leaves_start_date_idx"
      ON "loa_leaves" ("start_date");
  `);
  // Raw-SQL migration for the district column (CREATE TABLE IF NOT EXISTS above
  // does not add columns to a pre-existing table). fs_*-style raw SQL is used
  // here to avoid drizzle-kit push conflicts — see replit.md gotcha.
  await db.execute(sql`
    ALTER TABLE "loa_leaves" ADD COLUMN IF NOT EXISTS "district" varchar(16);
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "loa_team_recipients" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "team" varchar(20) NOT NULL UNIQUE,
      "emails" text[] NOT NULL DEFAULT ARRAY[]::text[],
      "updated_at" timestamp DEFAULT now() NOT NULL,
      "updated_by" varchar
    );
  `);
  // Seed the three team rows (empty email lists) so the settings page always
  // has all three to edit. ON CONFLICT keeps existing rows untouched.
  await db.execute(sql`
    INSERT INTO "loa_team_recipients" ("team", "emails")
    VALUES ('fleet', ARRAY[]::text[]),
           ('assets', ARRAY[]::text[]),
           ('inventory', ARRAY[]::text[])
    ON CONFLICT ("team") DO NOTHING;
  `);
}

/** Best-effort first name from a TPMS full name ("LAST, FIRST" or "First Last"). */
function firstNameOf(fullName: string): string {
  const s = fullName.trim();
  if (!s) return s;
  if (s.includes(",")) {
    const after = s.split(",")[1]?.trim() || "";
    return (after.split(/\s+/)[0] || s).trim();
  }
  return s.split(/\s+/)[0] || s;
}

/**
 * Task #437: upsert one `loa_leaves` row per active continuous leave (ALL
 * leaves, not just 30+), so short leaves still get start-time notifications and
 * every notification has a durable send-state. Never clobbers send-state /
 * paused / extension flags. Detects the sub-30 -> 30+ extension crossing and
 * returns the workflowIds that newly crossed so the caller can fire the
 * extension actions after the recovery queue items exist. Also closes any
 * previously-open leave row that is no longer in the active roster.
 */
async function syncLoaLeaves(
  deduped: ParsedLeave[],
  sfMap: Map<string, string | null>,
): Promise<{ extensionWorkflowIds: string[] }> {
  const extensionWorkflowIds: string[] = [];
  const currentWorkflowIds = deduped.map((r) =>
    workflowIdFor(r.enterpriseId, r.startDate),
  );

  const existingRows = currentWorkflowIds.length
    ? await db
        .select({
          workflowId: loaLeaves.workflowId,
          durationDays: loaLeaves.durationDays,
          extensionTriggered: loaLeaves.extensionTriggered,
        })
        .from(loaLeaves)
        .where(inArray(loaLeaves.workflowId, currentWorkflowIds))
    : [];
  const existingByWf = new Map(existingRows.map((r) => [r.workflowId, r]));

  // Carry send-state forward when a leave's start date shifts. The workflowId is
  // `loa-{enterpriseId}-{startDate}`, so a corrected start date yields a brand
  // new workflowId whose row has empty send-state — the daily sweep would then
  // re-notify even though the same leave was already announced. We treat any
  // still-OPEN row for the same enterpriseId (different workflowId) as the same
  // leave episode and copy its send-state onto the new row. A genuinely new
  // leave taken after a return finds only a CLOSED prior row, so it is not
  // matched here and notifies normally. The old open row is closed at the end of
  // this sync by the roster-reconciliation step below.
  const entIds = Array.from(new Set(deduped.map((r) => r.enterpriseId)));
  const priorOpenRows = entIds.length
    ? await db
        .select({
          workflowId: loaLeaves.workflowId,
          enterpriseId: loaLeaves.enterpriseId,
          startDate: loaLeaves.startDate,
          durationDays: loaLeaves.durationDays,
          teamNoticeSentAt: loaLeaves.teamNoticeSentAt,
          teamNoticeMsgId: loaLeaves.teamNoticeMsgId,
          returnNoticeSentAt: loaLeaves.returnNoticeSentAt,
          returnNoticeMsgId: loaLeaves.returnNoticeMsgId,
          techSmsSentAt: loaLeaves.techSmsSentAt,
          techSmsMsgId: loaLeaves.techSmsMsgId,
          extensionTriggered: loaLeaves.extensionTriggered,
          extensionTriggeredAt: loaLeaves.extensionTriggeredAt,
          extensionNoticeSentAt: loaLeaves.extensionNoticeSentAt,
          extensionNoticeMsgId: loaLeaves.extensionNoticeMsgId,
          recoveryPaused: loaLeaves.recoveryPaused,
          recoveryPausedAt: loaLeaves.recoveryPausedAt,
        })
        .from(loaLeaves)
        .where(
          and(inArray(loaLeaves.enterpriseId, entIds), eq(loaLeaves.closed, false)),
        )
    : [];
  const priorOpenByEnt = new Map<string, (typeof priorOpenRows)[number]>();
  for (const row of priorOpenRows) {
    const cur = priorOpenByEnt.get(row.enterpriseId);
    if (!cur || (row.startDate || "") > (cur.startDate || "")) {
      priorOpenByEnt.set(row.enterpriseId, row);
    }
  }

  for (const r of deduped) {
    const wfId = workflowIdFor(r.enterpriseId, r.startDate);
    const tpms = getTpmsContact(r.enterpriseId);
    const nameCand = tpms?.fullName || null;
    const firstCand = nameCand ? firstNameOf(nameCand) : null;
    const phoneCand = tpms?.mobilePhone || null;
    const vanCand = tpms?.truckLu || null;
    const sfStatus = sfMap.get(r.enterpriseId) ?? null;

    const prev = existingByWf.get(wfId);
    if (
      prev &&
      (prev.durationDays ?? 0) < MIN_DAYS &&
      r.days >= MIN_DAYS &&
      !prev.extensionTriggered
    ) {
      extensionWorkflowIds.push(wfId);
    }

    // Only carry forward for a brand-new workflowId (no existing row) whose
    // enterpriseId has a still-open prior row under a different workflowId — i.e.
    // a start-date shift of the same leave episode.
    const carry =
      !existingByWf.has(wfId) ? priorOpenByEnt.get(r.enterpriseId) : undefined;
    const carryFwd = carry && carry.workflowId !== wfId ? carry : undefined;

    // A start-date shift produces a new workflowId, so the same-workflowId
    // crossing check above (using `prev`) never fires for it. If the carried
    // episode was sub-30 and the corrected dates now cross to 30+, surface the
    // extension once here so the 30+ notice/checklist still goes out.
    if (
      carryFwd &&
      (carryFwd.durationDays ?? 0) < MIN_DAYS &&
      r.days >= MIN_DAYS &&
      !carryFwd.extensionTriggered
    ) {
      extensionWorkflowIds.push(wfId);
    }

    await db
      .insert(loaLeaves)
      .values({
        workflowId: wfId,
        enterpriseId: r.enterpriseId,
        employeeNumber: r.employeeNumber,
        techName: nameCand || r.enterpriseId,
        firstName: firstCand,
        phone: phoneCand,
        vanNumber: vanCand,
        isRental: false,
        startDate: r.startDate,
        expectedReturnDate: r.endDate,
        durationDays: r.days,
        sfStatus,
        ...(carryFwd
          ? {
              teamNoticeSentAt: carryFwd.teamNoticeSentAt,
              teamNoticeMsgId: carryFwd.teamNoticeMsgId,
              returnNoticeSentAt: carryFwd.returnNoticeSentAt,
              returnNoticeMsgId: carryFwd.returnNoticeMsgId,
              techSmsSentAt: carryFwd.techSmsSentAt,
              techSmsMsgId: carryFwd.techSmsMsgId,
              extensionTriggered: carryFwd.extensionTriggered,
              extensionTriggeredAt: carryFwd.extensionTriggeredAt,
              extensionNoticeSentAt: carryFwd.extensionNoticeSentAt,
              extensionNoticeMsgId: carryFwd.extensionNoticeMsgId,
              recoveryPaused: carryFwd.recoveryPaused,
              recoveryPausedAt: carryFwd.recoveryPausedAt,
            }
          : {}),
      })
      .onConflictDoUpdate({
        target: loaLeaves.workflowId,
        set: {
          enterpriseId: r.enterpriseId,
          employeeNumber: r.employeeNumber,
          // Keep the existing values when the snapshot lookup is empty (the
          // TPMS mirror is a backstop, not source of truth — see replit.md).
          techName: sql`COALESCE(${nameCand}, ${loaLeaves.techName})`,
          firstName: sql`COALESCE(${firstCand}, ${loaLeaves.firstName})`,
          phone: sql`COALESCE(${phoneCand}, ${loaLeaves.phone})`,
          vanNumber: sql`COALESCE(${vanCand}, ${loaLeaves.vanNumber})`,
          startDate: r.startDate,
          expectedReturnDate: r.endDate,
          durationDays: r.days,
          sfStatus,
          // Reopen — the tech is back on the active roster.
          closed: false,
          closedAt: null,
          updatedAt: new Date(),
          lastSyncedAt: new Date(),
        },
      });
  }

  // Close any open leave row no longer present in the active roster.
  const currentSet = new Set(currentWorkflowIds);
  const openRows = await db
    .select({ workflowId: loaLeaves.workflowId })
    .from(loaLeaves)
    .where(eq(loaLeaves.closed, false));
  const toClose = openRows
    .map((r) => r.workflowId)
    .filter((w) => !currentSet.has(w));
  if (toClose.length > 0) {
    const now = new Date();
    await db
      .update(loaLeaves)
      .set({ closed: true, closedAt: now, updatedAt: now })
      .where(inArray(loaLeaves.workflowId, toClose));
  }

  await enrichLoaLeavesVanDistrict();
  await refreshLoaQueueItemVanDistrict();

  return { extensionWorkflowIds };
}

/**
 * Backfill blank `van_number` / `district` on `loa_leaves` rows from persistent
 * last-known sources. The live TPMS_EXTRACT mirror (getTpmsContact) blanks a
 * technician's truck and district as soon as they go on LOA, so the leave row
 * captured at sync time is often empty. This fills from durable tables instead.
 *
 *   van:      tpms_tech_profiles.truck_no  ->  all_techs.truck_lu  ->  all_techs.last_known_truck_lu
 *   district: tpms_tech_profiles.district_no -> all_techs.district_no
 *
 * Fill-blank-only: the WHERE clause never touches a row that already has a value
 * (COALESCE-style), so a known van/district is never clobbered with a blank.
 * Idempotent — safe to run on every sync.
 */
async function enrichLoaLeavesVanDistrict(): Promise<void> {
  await db.execute(sql`
    UPDATE "loa_leaves" l
    SET "van_number" = v.van, "updated_at" = now()
    FROM (
      SELECT ids.eid,
        COALESCE(
          NULLIF((SELECT t.truck_no FROM "tpms_tech_profiles" t
                  WHERE upper(t.enterprise_id) = ids.eid
                    AND coalesce(t.truck_no, '') <> '' LIMIT 1), ''),
          NULLIF((SELECT a.truck_lu FROM "all_techs" a
                  WHERE upper(a.tech_racfid) = ids.eid
                    AND coalesce(a.truck_lu, '') <> '' LIMIT 1), ''),
          NULLIF((SELECT a.last_known_truck_lu FROM "all_techs" a
                  WHERE upper(a.tech_racfid) = ids.eid
                    AND coalesce(a.last_known_truck_lu, '') <> '' LIMIT 1), '')
        ) AS van
      FROM (SELECT DISTINCT upper("enterprise_id") AS eid FROM "loa_leaves") ids
    ) v
    WHERE upper(l."enterprise_id") = v.eid
      AND (l."van_number" IS NULL OR l."van_number" = '')
      AND v.van IS NOT NULL AND v.van <> '';
  `);
  await db.execute(sql`
    UPDATE "loa_leaves" l
    SET "district" = d.district, "updated_at" = now()
    FROM (
      SELECT ids.eid,
        COALESCE(
          NULLIF((SELECT t.district_no FROM "tpms_tech_profiles" t
                  WHERE upper(t.enterprise_id) = ids.eid
                    AND coalesce(t.district_no, '') <> '' LIMIT 1), ''),
          NULLIF((SELECT a.district_no FROM "all_techs" a
                  WHERE upper(a.tech_racfid) = ids.eid
                    AND coalesce(a.district_no, '') <> '' LIMIT 1), '')
        ) AS district
      FROM (SELECT DISTINCT upper("enterprise_id") AS eid FROM "loa_leaves") ids
    ) d
    WHERE upper(l."enterprise_id") = d.eid
      AND (l."district" IS NULL OR l."district" = '')
      AND d.district IS NOT NULL AND d.district <> '';
  `);
}

/**
 * Refresh embedded LOA queue-item JSON from the canonical `loa_leaves` row.
 *
 * The Assets/Fleet/Inventory LOA detail views render truck data from
 * queue_items.data.tech.lastKnownTruck. Existing queue items were created before
 * durable van/district enrichment ran, so their embedded JSON can stay blank
 * even after loa_leaves is correct. Fill blank fields only.
 */
async function refreshLoaQueueItemVanDistrict(): Promise<number> {
  const result = await db.execute(sql`
    UPDATE "queue_items" q
    SET
      "data" = (
        WITH base AS (
          SELECT COALESCE(q."data"::jsonb, '{}'::jsonb) AS data_json
        ),
        with_truck AS (
          SELECT CASE
            WHEN COALESCE(base.data_json->'tech'->>'lastKnownTruck', '') = ''
             AND COALESCE(l."van_number", '') <> ''
            THEN jsonb_set(
              base.data_json,
              '{tech,lastKnownTruck}',
              to_jsonb(l."van_number"::text),
              true
            )
            ELSE base.data_json
          END AS data_json
          FROM base
        ),
        with_district AS (
          SELECT CASE
            WHEN COALESCE(with_truck.data_json->>'district', '') = ''
             AND COALESCE(l."district", '') <> ''
            THEN jsonb_set(
              with_truck.data_json,
              '{district}',
              to_jsonb(l."district"::text),
              true
            )
            ELSE with_truck.data_json
          END AS data_json
          FROM with_truck
        )
        SELECT CASE
          WHEN COALESCE(with_district.data_json->'tech'->>'district', '') = ''
           AND COALESCE(l."district", '') <> ''
          THEN jsonb_set(
            with_district.data_json,
            '{tech,district}',
            to_jsonb(l."district"::text),
            true
          )
          ELSE with_district.data_json
        END::text
        FROM with_district
      ),
      "updated_at" = now()
    FROM "loa_leaves" l
    WHERE q."workflow_type" = ${WORKFLOW_TYPE}
      AND q."workflow_id" = l."workflow_id"
      AND (
        (COALESCE(q."data"::jsonb->'tech'->>'lastKnownTruck', '') = ''
          AND COALESCE(l."van_number", '') <> '')
        OR (COALESCE(q."data"::jsonb->>'district', '') = ''
          AND COALESCE(l."district", '') <> '')
        OR (COALESCE(q."data"::jsonb->'tech'->>'district', '') = ''
          AND COALESCE(l."district", '') <> '')
      )
    RETURNING q."id";
  `);
  const count = Array.isArray(result)
    ? result.length
    : ((result as any)?.rowCount ?? (result as any)?.rows?.length ?? 0);
  if (count > 0) {
    console.log(`[LoaRecovery] Refreshed van/district on ${count} LOA queue item(s).`);
  }
  return count;
}

/**
 * One-time (and idempotent) cleanup of duplicate open LOA Recovery items.
 *
 * For each (workflow_id, department) that has more than one open
 * (pending/in_progress) `loa_recovery` item, keep a single canonical row and
 * delete the redundant extras. The canonical row is the one that has progressed
 * furthest so any work already done is preserved: in_progress beats pending,
 * an assigned/started/responded row beats an untouched one, and ties fall back
 * to the earliest-created row (then id for stability). No-op when there are no
 * duplicates, so it is safe to run on every sync.
 */
async function dedupeOpenLoaItems(): Promise<number> {
  const deleted = await db.execute(sql`
    DELETE FROM "queue_items" q
    USING (
      SELECT id, ROW_NUMBER() OVER (
        PARTITION BY workflow_id, department
        ORDER BY
          (status = 'in_progress') DESC,
          (assigned_to IS NOT NULL) DESC,
          (started_at IS NOT NULL) DESC,
          (first_response_at IS NOT NULL) DESC,
          created_at ASC,
          id ASC
      ) AS rn
      FROM "queue_items"
      WHERE workflow_type = ${WORKFLOW_TYPE}
        AND status IN ('pending', 'in_progress')
        AND workflow_id IS NOT NULL
    ) ranked
    WHERE q.id = ranked.id AND ranked.rn > 1
    RETURNING q.id;
  `);
  const count = Array.isArray(deleted)
    ? deleted.length
    : ((deleted as any)?.rowCount ?? (deleted as any)?.rows?.length ?? 0);
  if (count > 0) {
    console.log(`[LoaRecovery] Deduped ${count} redundant open LOA queue item(s).`);
  }
  return count;
}

type ApiLeaveRow = {
  enterprise_id?: string | null;
  employee_number?: string | number | null;
  start_date?: string | null;
  end_date?: string | null;
  days?: number | string | null;
  leave_type?: string | null;
};

type ParsedLeave = {
  enterpriseId: string;
  employeeNumber: string | null;
  startDate: string | null; // YYYY-MM-DD
  endDate: string | null;   // YYYY-MM-DD
  days: number;
};

export type LoaRecoveryRunResult = {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  apiRowCount: number;
  continuousCount: number;
  dedupedCount: number;
  qualifyingCount: number;
  snowflakeMismatchCount: number;
  snowflakeMismatches: Array<{ enterpriseId: string; reason: string }>;
  queueItemsCreated: number;
  queueItemsCancelled: number;
  workflowsCreated: number;
  workflowsCancelled: number;
  error?: string;
};

let lastRunResult: LoaRecoveryRunResult | null = null;

export function getLastLoaRecoveryRunResult(): LoaRecoveryRunResult | null {
  return lastRunResult;
}

const norm = (v: unknown): string => String(v ?? "").trim().toUpperCase();

function workflowIdFor(enterpriseId: string, startDate: string | null): string {
  return `loa-${enterpriseId}-${startDate || "unknown"}`;
}

async function fetchLeavesFromApi(): Promise<ApiLeaveRow[]> {
  const apiKey = process.env.REPORTS_API_KEY;
  if (!apiKey) {
    throw new Error("REPORTS_API_KEY not configured");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(LEAVES_ENDPOINT, {
      method: "GET",
      headers: { "X-API-Key": apiKey, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`Reports API ${resp.status}: ${body.slice(0, 300)}`);
    }
    const payload = await resp.json();
    // Tolerate either {data: [...]} or a bare array.
    const rows: ApiLeaveRow[] = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.leaves)
      ? payload.leaves
      : [];
    return rows;
  } finally {
    clearTimeout(timeout);
  }
}

function parseDateStr(v: unknown): string | null {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  // Accept YYYY-MM-DD or ISO timestamp — keep just the date portion.
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function parseRow(row: ApiLeaveRow): ParsedLeave | null {
  const ent = norm(row.enterprise_id);
  if (!ent) return null;
  const daysNum =
    typeof row.days === "number" ? row.days : Number(row.days ?? NaN);
  if (!Number.isFinite(daysNum)) return null;
  return {
    enterpriseId: ent,
    employeeNumber:
      row.employee_number != null ? String(row.employee_number).trim() : null,
    startDate: parseDateStr(row.start_date),
    endDate: parseDateStr(row.end_date),
    days: Math.trunc(daysNum),
  };
}

/**
 * Dedupe by enterprise_id: keep largest `days`; break ties with latest
 * `end_date`.
 */
function dedupe(rows: ParsedLeave[]): ParsedLeave[] {
  const best = new Map<string, ParsedLeave>();
  for (const r of rows) {
    const prev = best.get(r.enterpriseId);
    if (!prev) {
      best.set(r.enterpriseId, r);
      continue;
    }
    if (r.days > prev.days) {
      best.set(r.enterpriseId, r);
    } else if (r.days === prev.days) {
      const a = r.endDate || "";
      const b = prev.endDate || "";
      if (a > b) best.set(r.enterpriseId, r);
    }
  }
  return Array.from(best.values());
}

// In-process serialization guard. The startup and 7:30 AM scheduler triggers
// both fire inside the same Node process, so if a run is already in flight when
// another is triggered we coalesce onto the existing run rather than racing it.
// This is a cheap first line of defense; the partial unique index + ON CONFLICT
// DO NOTHING in the creation path is the durable guarantee that holds even if a
// future overlap escapes this guard (e.g. across processes).
let runInFlight: Promise<LoaRecoveryRunResult> | null = null;

export function runLoaRecoverySync(
  triggeredBy: "scheduler" | "startup" | "manual" = "manual",
): Promise<LoaRecoveryRunResult> {
  if (runInFlight) {
    console.log(
      `[LoaRecovery] trigger=${triggeredBy} coalesced onto in-flight run.`,
    );
    return runInFlight;
  }
  runInFlight = runLoaRecoverySyncInner(triggeredBy).finally(() => {
    runInFlight = null;
  });
  return runInFlight;
}

async function runLoaRecoverySyncInner(
  triggeredBy: "scheduler" | "startup" | "manual" = "manual",
): Promise<LoaRecoveryRunResult> {
  const startedAt = new Date();
  const result: LoaRecoveryRunResult = {
    ok: false,
    startedAt: startedAt.toISOString(),
    finishedAt: startedAt.toISOString(),
    apiRowCount: 0,
    continuousCount: 0,
    dedupedCount: 0,
    qualifyingCount: 0,
    snowflakeMismatchCount: 0,
    snowflakeMismatches: [],
    queueItemsCreated: 0,
    queueItemsCancelled: 0,
    workflowsCreated: 0,
    workflowsCancelled: 0,
  };

  let syncLogId: string | null = null;
  try {
    // Make sure the snapshot table exists before any reads/writes touch it.
    await ensureLoaRecoverySchema();

    const log = await storage.createSyncLog({
      syncType: "loa_recovery",
      status: "running",
      triggeredBy,
    });
    syncLogId = log.id;
  } catch (e: any) {
    console.warn("[LoaRecovery] createSyncLog failed (continuing):", e?.message || e);
  }

  try {
    // 1. Fetch API
    const apiRows = await fetchLeavesFromApi();
    result.apiRowCount = apiRows.length;

    // 2. Filter to leave_type=Continuous, then parse
    const continuousRows = apiRows.filter(
      (r) => String(r.leave_type ?? "").trim().toLowerCase() === "continuous",
    );
    result.continuousCount = continuousRows.length;
    const parsed = continuousRows
      .map(parseRow)
      .filter((x): x is ParsedLeave => x !== null);

    // 3. Dedupe by enterprise_id
    const deduped = dedupe(parsed);
    result.dedupedCount = deduped.length;

    // 4. Cross-check against DRIVELINE_ALL_TECHS (employment_status L/P).
    //    `all_techs` mirrors that view via the existing Snowflake sync.
    const entIds = deduped.map((r) => r.enterpriseId);
    const sfMap = new Map<string, string | null>();
    if (entIds.length > 0) {
      const rows = await db
        .select({
          ent: allTechs.techRacfid,
          status: allTechs.employmentStatus,
        })
        .from(allTechs)
        .where(inArray(allTechs.techRacfid, entIds));
      for (const r of rows) {
        sfMap.set(norm(r.ent), r.status || null);
      }
    }

    // 5. Filter to days >= 30; record SF mismatches but do NOT exclude from
    //    inclusion (API is source of truth per spec).
    const qualifying: Array<ParsedLeave & { sfStatus: string | null }> = [];
    for (const row of deduped) {
      const sfStatus = sfMap.get(row.enterpriseId) ?? null;
      const inSf = sfMap.has(row.enterpriseId);
      const onLeavePerSf =
        sfStatus === "L" || sfStatus === "P";
      if (!inSf) {
        result.snowflakeMismatches.push({
          enterpriseId: row.enterpriseId,
          reason: "not_in_driveline_all_techs",
        });
      } else if (!onLeavePerSf) {
        result.snowflakeMismatches.push({
          enterpriseId: row.enterpriseId,
          reason: `sf_status_${sfStatus || "null"}`,
        });
      }
      if (row.days >= MIN_DAYS) {
        qualifying.push({ ...row, sfStatus });
      }
    }
    result.snowflakeMismatchCount = result.snowflakeMismatches.length;
    result.qualifyingCount = qualifying.length;

    // 6. Persist snapshot rows (one per qualifying tech per sync run).
    if (qualifying.length > 0) {
      await db.insert(loaRecoverySnapshot).values(
        qualifying.map((q) => ({
          enterpriseId: q.enterpriseId,
          employeeNumber: q.employeeNumber,
          sfStatus: q.sfStatus,
          startDate: q.startDate,
          endDate: q.endDate,
          days: q.days,
          source: "api" as const,
        })),
      );
    }

    // 6b. Task #437: upsert per-leave tracking rows for ALL continuous leaves
    //     (not just 30+) and detect sub-30 -> 30+ extension crossings.
    let extensionWorkflowIds: string[] = [];
    try {
      const leaveResult = await syncLoaLeaves(deduped, sfMap);
      extensionWorkflowIds = leaveResult.extensionWorkflowIds;
    } catch (e: any) {
      console.warn("[LoaRecovery] syncLoaLeaves failed (continuing):", e?.message || e);
    }

    // 7. Idempotency: find existing open LOA Recovery workflowIds.
    const openExisting = await db
      .select({
        workflowId: queueItems.workflowId,
        enterpriseId: sql<string>`(${queueItems.data}::jsonb->>'enterpriseId')`,
      })
      .from(queueItems)
      .where(
        and(
          eq(queueItems.workflowType, WORKFLOW_TYPE),
          inArray(queueItems.status, ["pending", "in_progress"]),
        ),
      );
    const openWorkflowIds = new Set<string>();
    const openByEnterprise = new Map<string, Set<string>>();
    for (const r of openExisting) {
      if (r.workflowId) openWorkflowIds.add(r.workflowId);
      const ent = norm(r.enterpriseId);
      if (ent) {
        if (!openByEnterprise.has(ent)) openByEnterprise.set(ent, new Set());
        if (r.workflowId) openByEnterprise.get(ent)!.add(r.workflowId);
      }
    }

    // 8. Create the 3 queue items for each qualifying tech whose workflowId
    //    doesn't already have open items.
    const qualifyingEnterpriseIds = new Set<string>(
      qualifying.map((q) => q.enterpriseId),
    );
    for (const q of qualifying) {
      const wfId = workflowIdFor(q.enterpriseId, q.startDate);
      if (openWorkflowIds.has(wfId)) continue; // already open
      const created = await createLoaRecoveryWorkflow(q, wfId);
      result.queueItemsCreated += created;
      if (created > 0) result.workflowsCreated += 1;
    }
    await refreshLoaQueueItemVanDistrict();

    // 9. Auto-cancel: for any open workflow whose enterprise_id is NOT in the
    //    current qualifying set, cancel all of its open items.
    const workflowsToCancel = new Set<string>();
    openByEnterprise.forEach((wfIds, ent) => {
      if (!qualifyingEnterpriseIds.has(ent)) {
        wfIds.forEach((wfId) => workflowsToCancel.add(wfId));
      }
    });
    if (workflowsToCancel.size > 0) {
      const cancelled = await cancelOpenLoaWorkflows(
        Array.from(workflowsToCancel),
      );
      result.queueItemsCancelled = cancelled;
      result.workflowsCancelled = workflowsToCancel.size;
    }

    // 10. Task #437: fire extension re-trigger for leaves that just crossed
    //     sub-30 -> 30+. Runs after queue items exist so the recovery note can
    //     be appended onto them. Each is guarded by extension_triggered.
    for (const wfId of extensionWorkflowIds) {
      try {
        const [leave] = await db
          .select()
          .from(loaLeaves)
          .where(eq(loaLeaves.workflowId, wfId))
          .limit(1);
        if (leave) await handleLoaExtension(leave);
      } catch (e: any) {
        console.warn(
          `[LoaRecovery] extension re-trigger failed for ${wfId}:`,
          e?.message || e,
        );
      }
    }

    result.ok = true;
  } catch (err: any) {
    result.error = err?.message || String(err);
    console.error("[LoaRecovery] Sync failed:", result.error);
  } finally {
    const finishedAt = new Date();
    result.finishedAt = finishedAt.toISOString();
    lastRunResult = result;
    if (syncLogId) {
      try {
        await storage.updateSyncLog(syncLogId, {
          status: result.ok ? "completed" : "failed",
          completedAt: finishedAt,
          recordsProcessed: result.qualifyingCount,
          queueItemsCreated: result.queueItemsCreated,
          errorMessage: result.error || null,
        });
      } catch (e: any) {
        console.warn("[LoaRecovery] updateSyncLog failed:", e?.message || e);
      }
    }
    console.log(
      `[LoaRecovery] trigger=${triggeredBy} ok=${result.ok} ` +
        `api=${result.apiRowCount} continuous=${result.continuousCount} ` +
        `deduped=${result.dedupedCount} qualifying=${result.qualifyingCount} ` +
        `sfMismatch=${result.snowflakeMismatchCount} ` +
        `created=${result.queueItemsCreated} (workflows=${result.workflowsCreated}) ` +
        `cancelled=${result.queueItemsCancelled} (workflows=${result.workflowsCancelled})` +
        (result.error ? ` error=${result.error}` : ""),
    );
  }

  return result;
}

async function createLoaRecoveryWorkflow(
  q: ParsedLeave & { sfStatus: string | null },
  workflowId: string,
): Promise<number> {
  const tpms = getTpmsContact(q.enterpriseId);
  // `realName` is a genuine snapshot hit (full name) or null when the snapshot
  // doesn't yet know this tech. `techName` falls back to the enterprise ID as a
  // display placeholder. The on-conflict refresh below only fires when
  // `realName` is non-null so a stored real name is never downgraded back to the
  // login-ID placeholder (mirrors the COALESCE pattern used for loa_leaves).
  const realName = tpms?.fullName || null;
  const techName = realName || q.enterpriseId;
  const phone = tpms?.mobilePhone || null;
  const primaryZip = tpms?.primaryZip || null;
  let canonicalVan: string | null = null;
  let canonicalDistrict: string | null = null;
  try {
    const [leave] = await db
      .select({
        vanNumber: loaLeaves.vanNumber,
        district: loaLeaves.district,
      })
      .from(loaLeaves)
      .where(eq(loaLeaves.workflowId, workflowId))
      .limit(1);
    canonicalVan = leave?.vanNumber || null;
    canonicalDistrict = leave?.district || null;
  } catch {
    canonicalVan = null;
    canonicalDistrict = null;
  }
  const lastKnownTruck = tpms?.truckLu || canonicalVan;

  // Best-effort address from all_techs (TPMS extract only has zip).
  let address: {
    homeAddr1: string | null;
    homeAddr2: string | null;
    homeCity: string | null;
    homeState: string | null;
    homePostal: string | null;
  } | null = null;
  try {
    const rows = await db
      .select({
        homeAddr1: allTechs.homeAddr1,
        homeAddr2: allTechs.homeAddr2,
        homeCity: allTechs.homeCity,
        homeState: allTechs.homeState,
        homePostal: allTechs.homePostal,
      })
      .from(allTechs)
      .where(eq(allTechs.techRacfid, q.enterpriseId))
      .limit(1);
    address = rows[0] || null;
  } catch {
    address = null;
  }

  const sharedData = {
    enterpriseId: q.enterpriseId,
    employeeNumber: q.employeeNumber,
    techName,
    district: canonicalDistrict,
    leave: {
      startDate: q.startDate,
      endDate: q.endDate,
      days: q.days,
      sfStatus: q.sfStatus,
    },
    tech: {
      lastKnownTruck,
      district: canonicalDistrict,
      phone,
      primaryZip,
      address,
    },
  };

  const baseMetadata = {
    workflowType: WORKFLOW_TYPE,
    enterpriseId: q.enterpriseId,
    leaveStartDate: q.startDate,
    leaveEndDate: q.endDate,
    leaveDays: q.days,
  };

  // `dbDepartment` is the value written to the queue_items.department column
  // (must match what the storage create* helpers historically forced, so the
  // partial unique index and the per-queue UI keep working). `laneLabel` is the
  // value embedded in data.lane / metadata.lane, preserved exactly as it was
  // (the Fleet lane historically stored "FLEET" in data.lane while its column
  // read "Fleet Management").
  const lanes: Array<{
    title: string;
    description: string;
    dbDepartment: "Fleet Management" | "Assets Management" | "Inventory Control";
    laneLabel: "FLEET" | "Assets Management" | "Inventory Control";
    step: number;
  }> = [
    {
      title: `LOA Recovery — Vehicle (${techName})`,
      description: `Recover assigned vehicle from ${techName} (${q.enterpriseId}). On continuous leave ${q.days} days (started ${q.startDate || "unknown"}).`,
      dbDepartment: "Fleet Management",
      laneLabel: "FLEET",
      step: 1,
    },
    {
      title: `LOA Recovery — Tools (${techName})`,
      description: `Recover company tools from ${techName} (${q.enterpriseId}). On continuous leave ${q.days} days (started ${q.startDate || "unknown"}).`,
      dbDepartment: "Assets Management",
      laneLabel: "Assets Management",
      step: 2,
    },
    {
      title: `LOA Recovery — Parts (${techName})`,
      description: `Recover parts inventory from ${techName} (${q.enterpriseId}). On continuous leave ${q.days} days (started ${q.startDate || "unknown"}).`,
      dbDepartment: "Inventory Control",
      laneLabel: "Inventory Control",
      step: 3,
    },
  ];

  let created = 0;
  for (const lane of lanes) {
    try {
      // Insert with an upsert against the partial unique index
      // (loa_recovery_open_workflow_dept_uniq on open loa_recovery rows). If two
      // sync runs race against a clean state, only one row wins per
      // (workflow_id, department) instead of throwing. On conflict against an
      // existing open row we *refresh the technician name* (title/description and
      // data.techName) so a row first written with the login-ID placeholder
      // (snapshot was cold) gets upgraded to the real full name on a later run.
      //
      // The `setWhere` guard fires the refresh ONLY when the snapshot returned a
      // genuine full name (`realName` non-null). When the snapshot still has no
      // name, the conflict is a no-op (DO NOTHING) and the stored value is left
      // untouched, so a real name is never downgraded to the placeholder.
      //
      // `(xmax = 0)` is true only for a brand-new INSERT and false for an
      // ON CONFLICT update, so `created` keeps counting only genuinely new rows
      // (refreshes don't inflate the count). A skipped no-op conflict returns no
      // row at all.
      const inserted = await db
        .insert(queueItems)
        .values({
          workflowType: WORKFLOW_TYPE,
          title: lane.title,
          description: lane.description,
          status: "pending",
          priority: "medium",
          requesterId: SYSTEM_REQUESTER_ID,
          department: lane.dbDepartment,
          workflowId,
          workflowStep: lane.step,
          data: JSON.stringify({ ...sharedData, lane: lane.laneLabel }),
          metadata: JSON.stringify({ ...baseMetadata, lane: lane.laneLabel }),
        })
        .onConflictDoUpdate({
          target: [queueItems.workflowId, queueItems.department],
          targetWhere: sql`"workflow_type" = 'loa_recovery' AND "status" IN ('pending', 'in_progress') AND "workflow_id" IS NOT NULL`,
          set: {
            title: lane.title,
            description: lane.description,
            data: sql`jsonb_set(${queueItems.data}::jsonb, '{techName}', to_jsonb(${techName}::text))::text`,
          },
          setWhere: sql`${realName}::text IS NOT NULL`,
        })
        .returning({
          id: queueItems.id,
          inserted: sql<boolean>`(xmax = 0)`,
        });
      if (inserted.length > 0 && inserted[0].inserted) created += 1;
    } catch (e: any) {
      console.error(
        `[LoaRecovery] Failed to create ${lane.dbDepartment} item for ${q.enterpriseId}:`,
        e?.message || e,
      );
    }
  }
  return created;
}

async function cancelOpenLoaWorkflows(workflowIds: string[]): Promise<number> {
  if (workflowIds.length === 0) return 0;
  const now = new Date();
  // Append the cancel reason into metadata JSON via jsonb_set so we don't
  // clobber existing keys. metadata is stored as text but the value is JSON,
  // so cast through jsonb.
  const result = await db
    .update(queueItems)
    .set({
      status: "cancelled",
      completedAt: now,
      updatedAt: now,
      metadata: sql`COALESCE(
        jsonb_set(
          COALESCE(${queueItems.metadata}::jsonb, '{}'::jsonb),
          '{cancelled_reason}',
          '"tech_returned_from_loa"'::jsonb,
          true
        ),
        '{"cancelled_reason":"tech_returned_from_loa"}'::jsonb
      )::text`,
    })
    .where(
      and(
        eq(queueItems.workflowType, WORKFLOW_TYPE),
        inArray(queueItems.workflowId, workflowIds),
        inArray(queueItems.status, ["pending", "in_progress"]),
      ),
    )
    .returning({ id: queueItems.id });
  return result.length;
}

/**
 * Latest snapshot (one row per qualifying tech from the most recent successful
 * run, identified by the max syncedAt).
 */
export async function getLatestLoaRecoverySnapshot() {
  const latest = await db
    .select({ syncedAt: sql<Date>`MAX(${loaRecoverySnapshot.syncedAt})` })
    .from(loaRecoverySnapshot);
  const ts = latest[0]?.syncedAt;
  if (!ts) return { syncedAt: null, rows: [] };
  const rows = await db
    .select()
    .from(loaRecoverySnapshot)
    .where(eq(loaRecoverySnapshot.syncedAt, ts));
  return { syncedAt: ts, rows };
}
