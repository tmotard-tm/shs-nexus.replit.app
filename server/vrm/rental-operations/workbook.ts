/**
 * The workbook layer: per-case working state for the regional recovery team.
 *
 * Tyler, 2026-07-28: the regional page has to be somewhere the team WORKS, not a
 * second viewer. They mark a status, record what the technician said, log the
 * issue they hit, and set the next action.
 *
 * Storage reuses the existing `vrm_rental_operation_actions` table rather than
 * adding a parallel one. That table is append-only and explicitly survives
 * re-import, which is exactly the property working notes need — a nightly
 * Enterprise ingest must never wipe what a lead typed. It had 2 rows total when
 * this was written (one case, 2026-07-19), so there is nothing to collide with.
 *
 * One new `action_type` of 'recovery_status'. The four free-text fields live in
 * the table's existing `payload` jsonb column, so no DDL at all.
 *
 * "Current state" is the newest row per case; every prior row stays as history.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";

export const WORKBOOK_ACTION_TYPE = "recovery_status";

/**
 * The nine-state recovery workflow (Tyler's pick, 2026-07-28). Ordered as the
 * work actually flows, which is also the order the UI renders them.
 *
 * The three `awaiting_*` states exist so a lead can tell at a glance who a case
 * is BLOCKED ON. A single "in progress" cannot answer that, and answering it is
 * the whole reason to look at the board.
 */
export const WORKBOOK_STATUSES = [
  "new",
  "working",
  "tech_contacted",
  "awaiting_tech",
  "awaiting_shop",
  "blocked",
  "return_scheduled",
  "returned_closed",
  "escalated",
] as const;

export type WorkbookStatus = (typeof WORKBOOK_STATUSES)[number];

export const WORKBOOK_STATUS_LABEL: Record<WorkbookStatus, string> = {
  new: "New",
  working: "Working",
  tech_contacted: "Tech contacted",
  awaiting_tech: "Awaiting tech",
  awaiting_shop: "Awaiting shop",
  blocked: "Blocked",
  return_scheduled: "Return scheduled",
  returned_closed: "Returned / closed",
  escalated: "Escalated",
};

/** Statuses that mean nobody needs to look at this again. Drives the "open work" count. */
export const WORKBOOK_CLOSED_STATUSES: ReadonlySet<string> = new Set(["returned_closed"]);

export function isWorkbookStatus(v: unknown): v is WorkbookStatus {
  return typeof v === "string" && (WORKBOOK_STATUSES as readonly string[]).includes(v);
}

export interface WorkbookState {
  status: WorkbookStatus;
  tech_said: string | null;
  issue: string | null;
  next_action: string | null;
  follow_up_date: string | null; // YYYY-MM-DD
  assigned_to: string | null;
  actor: string | null;
  updated_at: string | null;
}

export interface WorkbookHistoryEntry extends WorkbookState {
  id: string;
}

const DEFAULT_STATE: WorkbookState = {
  status: "new",
  tech_said: null,
  issue: null,
  next_action: null,
  follow_up_date: null,
  assigned_to: null,
  actor: null,
  updated_at: null,
};

function rowsOf(res: any): any[] {
  return (res?.rows ?? res ?? []) as any[];
}

function toState(r: any): WorkbookState {
  const p = (r?.payload ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => {
    const s = v == null ? "" : String(v).trim();
    return s === "" ? null : s;
  };
  return {
    status: isWorkbookStatus(r?.mark_value) ? r.mark_value : "new",
    tech_said: str(p.tech_said),
    issue: str(p.issue),
    next_action: str(p.next_action),
    follow_up_date: str(p.follow_up_date),
    assigned_to: str(r?.assigned_to),
    actor: str(r?.actor),
    updated_at: str(r?.updated_at),
  };
}

/** Newest workbook row per case, for the whole board in one query. */
export async function loadWorkbookStates(): Promise<Map<string, WorkbookState>> {
  const res = await db.execute(sql`
    SELECT DISTINCT ON (case_key)
      case_key, mark_value, assigned_to, payload, actor,
      to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SSZ') AS updated_at
    FROM vrm_rental_operation_actions
    WHERE action_type = ${WORKBOOK_ACTION_TYPE}
    ORDER BY case_key, created_at DESC`);
  const m = new Map<string, WorkbookState>();
  for (const r of rowsOf(res)) m.set(String(r.case_key), toState(r));
  return m;
}

export async function loadWorkbookState(caseKey: string): Promise<WorkbookState> {
  const res = await db.execute(sql`
    SELECT case_key, mark_value, assigned_to, payload, actor,
           to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SSZ') AS updated_at
    FROM vrm_rental_operation_actions
    WHERE action_type = ${WORKBOOK_ACTION_TYPE} AND case_key = ${caseKey}
    ORDER BY created_at DESC
    LIMIT 1`);
  const r = rowsOf(res)[0];
  return r ? toState(r) : { ...DEFAULT_STATE };
}

export async function loadWorkbookHistory(caseKey: string, limit = 50): Promise<WorkbookHistoryEntry[]> {
  const res = await db.execute(sql`
    SELECT id, case_key, mark_value, assigned_to, payload, actor,
           to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SSZ') AS updated_at
    FROM vrm_rental_operation_actions
    WHERE action_type = ${WORKBOOK_ACTION_TYPE} AND case_key = ${caseKey}
    ORDER BY created_at DESC
    LIMIT ${limit}`);
  return rowsOf(res).map((r) => ({ id: String(r.id), ...toState(r) }));
}

export interface WorkbookPatch {
  status?: unknown;
  tech_said?: unknown;
  issue?: unknown;
  next_action?: unknown;
  follow_up_date?: unknown;
  assigned_to?: unknown;
}

const FOLLOW_UP_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TEXT = 4000;

/**
 * Appends one new workbook row.
 *
 * Fields absent from the patch are CARRIED FORWARD from the current state, so
 * editing only the status cannot silently blank a note somebody else wrote.
 * Sending an explicit empty string is how you clear a field on purpose — the
 * distinction between "not mentioned" and "cleared" is the difference between a
 * partial save and data loss.
 */
export async function appendWorkbookEntry(
  caseKey: string,
  patch: WorkbookPatch,
  actor: string,
): Promise<{ ok: true; state: WorkbookState } | { ok: false; error: string }> {
  const current = await loadWorkbookState(caseKey);

  if (patch.status !== undefined && !isWorkbookStatus(patch.status)) {
    return { ok: false, error: `status must be one of: ${WORKBOOK_STATUSES.join(", ")}` };
  }
  const status: WorkbookStatus = patch.status !== undefined ? (patch.status as WorkbookStatus) : current.status;

  const text = (key: keyof WorkbookPatch, cur: string | null): string | null | { err: string } => {
    if (patch[key] === undefined) return cur;
    const s = String(patch[key] ?? "").trim();
    if (s.length > MAX_TEXT) return { err: `${String(key)} too long (${MAX_TEXT} char max)` };
    return s === "" ? null : s;
  };

  const fields: Record<string, string | null> = {};
  for (const [key, cur] of [
    ["tech_said", current.tech_said],
    ["issue", current.issue],
    ["next_action", current.next_action],
    ["assigned_to", current.assigned_to],
  ] as Array<[keyof WorkbookPatch, string | null]>) {
    const v = text(key, cur);
    if (v && typeof v === "object") return { ok: false, error: v.err };
    fields[key as string] = v as string | null;
  }

  let followUp: string | null = current.follow_up_date;
  if (patch.follow_up_date !== undefined) {
    const s = String(patch.follow_up_date ?? "").trim();
    if (s === "") followUp = null;
    else if (!FOLLOW_UP_RE.test(s)) return { ok: false, error: "follow_up_date must be YYYY-MM-DD" };
    else followUp = s;
  }

  const payload = {
    tech_said: fields.tech_said,
    issue: fields.issue,
    next_action: fields.next_action,
    follow_up_date: followUp,
  };

  // case_id is best-effort: the action row is keyed by case_key, which is what
  // every read here joins on. A missing case row must not block a note.
  const caseRow = await db.execute(
    sql`SELECT id FROM vrm_rental_operations_cases WHERE case_key = ${caseKey} LIMIT 1`,
  );
  const caseId = (rowsOf(caseRow)[0] as any)?.id ?? null;

  await db.execute(sql`
    INSERT INTO vrm_rental_operation_actions
      (case_key, case_id, action_type, mark_value, note, assigned_to, payload, actor)
    VALUES (
      ${caseKey}, ${caseId}, ${WORKBOOK_ACTION_TYPE}, ${status},
      ${fields.next_action ?? null}, ${fields.assigned_to ?? null},
      ${JSON.stringify(payload)}::jsonb, ${actor}
    )`);

  return { ok: true, state: await loadWorkbookState(caseKey) };
}
