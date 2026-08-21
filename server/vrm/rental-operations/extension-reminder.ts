/**
 * VRM Rental Operations — weekly rental-extension reminder sweep.
 *
 * Every rental request signs ack_extension_weekly ("I must request a rental
 * extension from Fleet every 7 days for as long as I keep the rental"), but
 * nothing nudged the technician when the week was up — Fleet chased them by
 * hand. This sweep finds OPEN rental cases approaching/past their authorized
 * days with no live extension request in flight, and texts the tech a link to
 * /rental-request (which defaults to the extension path for a tech holding an
 * open rental).
 *
 * Like pickup-sms, this module NEVER talks to Twilio. Every text goes through
 * the Master Fleet Communications pipeline (server/fleet-comms/outbound.ts
 * sendMessage), which owns opt-out, recipient-local quiet hours (queues, never
 * drops), threading, and — because this is a machine caller — the 24h
 * identical-send dedupe (skipRecentDuplicate), the guard that turns a crashed
 * or double-fired sweep into a no-op instead of a double text.
 *
 * Safety model, in layers:
 *   1. Arm flag: vrm_rental_ops_settings key `extension_reminders_enabled`
 *      (durable, default OFF, read fail-closed). Until Fleet flips it, every
 *      sweep is a DRY RUN that records who WOULD be texted and sends nothing.
 *      This matters because COMMS_SEND_LIVE is on even in dev.
 *   2. Cycle idempotency: one reminder per case per authorization cycle. The
 *      cycle key is days_authorized itself — a granted extension bumps it
 *      (7 → 14 → 21), opening a new cycle; until then the partial unique index
 *      on (case_key, cycle_key) WHERE status IN ('claimed','sent','queued')
 *      refuses a second live send. Dry runs, skips, and failures do NOT
 *      consume the slot (a dry run stamping the cycle would arm the gate
 *      silently dead — the odometer lesson).
 *   3. Claim-then-send: the reminder row is INSERTed as a claim BEFORE the
 *      send (ON CONFLICT DO NOTHING on the cycle index), so two concurrent
 *      sweeps cannot both text. A claim stranded by a crash goes 'stale' after
 *      45 minutes and frees the slot; if its SMS actually left, the comms-lane
 *      24h dedupe eats the retry (evidence-first recovery, backstopped).
 *   4. Live-request guard: liveRequestGuard (the SAME function the request
 *      form's verify/submit doors run — imported, not re-derived) suppresses
 *      the nag for a tech whose extension is already pending, or who cannot
 *      file one yet because a NEW request is still pending/approved.
 *
 * Identity chain (the part that bites, per pickup-sms): case →
 * vrm_rental_identity_resolutions → all_techs.employee_id → tech_racfid →
 * fs_comms_contacts.ldap. employee_id is the payroll number and is NEVER the
 * comms key. Termed / on-leave techs are SKIPPED here (recorded, visible) —
 * an autonomous sweep must not text someone the pickup lane would make a
 * human confirm for.
 *
 * Visibility: every outcome (sent / queued / dry_run / skipped / failed) is a
 * row in vrm_rental_extension_reminders, each sweep writes a
 * vrm_rental_extension_reminder_runs summary, and a live send also appends an
 * `extension_reminder` action to vrm_rental_operation_actions so the case
 * history shows the receipt next to pickup texts.
 */
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { sendMessage } from "../../fleet-comms/outbound";
import { getContactByLdap } from "../../fleet-comms/storage";
import { countSegments } from "../../fleet-comms/lib";
import { liveRequestGuard, PUBLIC_REQUEST_URL } from "../forms/rental-request";
import { initFormsSchema } from "../forms/schema";
import { isExtensionRemindersEnabled } from "./settings";

/** Filed under the rental book, same as pickup texts — one thread category. */
export const EXTENSION_REMINDER_CATEGORY = "rental_management";

/** action_type written to vrm_rental_operation_actions on a live send. */
export const EXTENSION_REMINDER_ACTION_TYPE = "extension_reminder";

/**
 * Remind when (days_authorized - days_open) <= lead. 1 = "due tomorrow or
 * already past", which gives the tech a day to file before Fleet sees red.
 */
export const DEFAULT_LEAD_DAYS = 1;

/** A claim without an outcome after this long is presumed crashed. */
const STALE_CLAIM_MINUTES = 45;

/**
 * One attempt row per case+cycle per ~day. Keeps a 5-minute dispatcher poke
 * or a re-run from spamming duplicate skip/dry_run rows, without ever letting
 * two calendar days pass unexamined.
 */
const REATTEMPT_HOURS = 20;

/** Cross-cycle backstop: never text the same case twice within this window,
 * even if days_authorized moved oddly under us mid-week. */
const MIN_DAYS_BETWEEN_TEXTS = 5;

// ── DDL (house pattern: lazy ensure, deploys run no migrations) ────────────

// Memoize SUCCESS only — a memoized failure would poison every later sweep.
let ensured: Promise<void> | null = null;
export function ensureReminderTables(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS vrm_rental_extension_reminders (
          id              VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
          case_key        VARCHAR(10) NOT NULL,
          cycle_key       INTEGER NOT NULL,      -- days_authorized at reminder time
          ldap            VARCHAR(60),
          tech_name       TEXT,
          rental_vendor   TEXT,
          days_open       INTEGER,
          days_authorized INTEGER,
          status          VARCHAR(20) NOT NULL,  -- claimed|sent|queued|dry_run|skipped|failed|stale
          reason          TEXT,
          body            TEXT,
          message_id      VARCHAR,
          queue_id        VARCHAR,
          actor           VARCHAR(120),
          dry_run         BOOLEAN NOT NULL DEFAULT false,
          created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          sent_at         TIMESTAMPTZ
        )`);
      // THE idempotency guard: one live claim/send per case per cycle. Partial
      // on purpose — dry_run/skipped/failed/stale rows must not consume the
      // cycle, or the first dry run would permanently silence the live sweep.
      await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS vrm_ext_reminder_cycle_uniq
          ON vrm_rental_extension_reminders (case_key, cycle_key)
          WHERE status IN ('claimed','sent','queued')`);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_vrm_ext_reminders_case
          ON vrm_rental_extension_reminders (case_key, created_at DESC)`);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_vrm_ext_reminders_created
          ON vrm_rental_extension_reminders (created_at DESC)`);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS vrm_rental_extension_reminder_runs (
          id          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
          started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          finished_at TIMESTAMPTZ,
          live        BOOLEAN NOT NULL,
          trigger     VARCHAR(40),
          considered  INTEGER,
          sent        INTEGER,
          queued      INTEGER,
          dry_run     INTEGER,
          skipped     INTEGER,
          failed      INTEGER,
          error       TEXT
        )`);
    })().catch((e) => {
      ensured = null;
      throw e;
    });
  }
  return ensured;
}

/**
 * Everything the sweep touches, in one ensure: the reminder ledger tables AND
 * the forms schema that liveRequestGuard queries (vrm_rental_request incl.
 * request_type). The web app runs initFormsSchema in its boot chain, but the
 * standalone Scheduled-Deployment script does NOT boot that chain — without
 * this, a fresh/drifted database fails every guard call before a single case
 * is evaluated. initFormsSchema is idempotent DDL, so re-running it here is
 * cheap insurance on both paths.
 */
let sweepEnsured: Promise<void> | null = null;
export function ensureSweepSchema(): Promise<void> {
  if (!sweepEnsured) {
    sweepEnsured = (async () => {
      await initFormsSchema();
      await ensureReminderTables();
    })().catch((e) => {
      sweepEnsured = null;
      throw e;
    });
  }
  return sweepEnsured;
}

// ── Pure pieces (unit-tested) ───────────────────────────────────────────────

export type ExtensionDue = "due" | "not_due" | "unknown";

/**
 * Is this case inside the reminder window? `unknown` (missing/zero feed
 * numbers) is deliberately its own answer: a case we cannot judge must not be
 * texted, but it also must not be counted as healthy.
 */
export function classifyExtensionDue(
  daysOpen: number | null | undefined,
  daysAuthorized: number | null | undefined,
  leadDays: number = DEFAULT_LEAD_DAYS,
): ExtensionDue {
  if (
    daysOpen == null || daysAuthorized == null ||
    !Number.isFinite(daysOpen) || !Number.isFinite(daysAuthorized) ||
    daysAuthorized <= 0 || daysOpen < 0
  ) {
    return "unknown";
  }
  return daysAuthorized - daysOpen <= leadDays ? "due" : "not_due";
}

/**
 * The reminder body. Same GSM-7 discipline as buildPickupBody: 160 chars is
 * one segment, so the vendor name and then the day counts are dropped before
 * the message is allowed to spill into a second segment. The link is the
 * point of the text and is never dropped.
 */
export function buildExtensionReminderBody(t: {
  rental_vendor?: string | null;
  days_open?: number | null;
  days_authorized?: number | null;
}): string {
  const vendorName = (t.rental_vendor || "").trim();
  const vendor = vendorName ? `${titleCaseVendor(vendorName)} ` : "";
  const counts =
    t.days_open != null && t.days_authorized != null
      ? `is at day ${t.days_open} of ${t.days_authorized} authorized`
      : "extension is due";
  const tail = `Reply here with any issues.`;

  // Degradation ladder: the vendor name goes first (it is the least useful
  // identifier — the tech knows whose rental they drive), then the day counts.
  // The link is the point of the text and is never dropped.
  const candidates = [
    `Sears Fleet: your ${vendor}rental ${counts}. Request your weekly extension: ${PUBLIC_REQUEST_URL} ${tail}`,
    `Sears Fleet: your rental ${counts}. Request your weekly extension: ${PUBLIC_REQUEST_URL} ${tail}`,
    `Sears Fleet: please request your weekly rental extension: ${PUBLIC_REQUEST_URL} ${tail}`,
  ];
  for (const body of candidates) {
    if (body.length <= 160) return body;
  }
  return candidates[candidates.length - 1];
}

/** Vendor names arrive SHOUTING from the feed (same rule as pickup-sms). */
function titleCaseVendor(v: string): string {
  const s = v.trim();
  if (!s) return s;
  return s === s.toUpperCase()
    ? s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase())
    : s;
}

// ── Candidate query ─────────────────────────────────────────────────────────

export interface DueCase {
  case_key: string;
  rental_vendor: string | null;
  days_open: number | null;
  days_authorized: number | null;
  rental_start_date: string | null;
  number_of_extensions: number | null;
  employee_id: string | null;
  ldap: string | null;
  tech_name: string | null;
}

/**
 * Open, identity-RESOLVED cases inside the reminder window. Same joins as
 * openRentalsFor/factsFor in the request form on purpose — a second
 * definition of "this tech's open rental" would let the reminder and the form
 * disagree about who holds what.
 */
export async function findDueCases(leadDays: number = DEFAULT_LEAD_DAYS): Promise<DueCase[]> {
  const { rows } = await db.execute(sql`
    SELECT c.case_key,
           c.rental_vendor,
           c.days_open,
           c.days_authorized,
           to_char(c.rental_start_date, 'YYYY-MM-DD') AS rental_start_date,
           c.number_of_extensions,
           a.employee_id,
           upper(a.tech_racfid) AS ldap,
           COALESCE(NULLIF(btrim(a.tech_name), ''),
                    NULLIF(btrim(COALESCE(a.first_name,'') || ' ' || COALESCE(a.last_name,'')), ''))
             AS tech_name
    FROM vrm_rental_operations_cases c
    JOIN vrm_rental_identity_resolutions ir ON ir.case_key = c.case_key
    JOIN all_techs a
      ON COALESCE(ir.override_employee_id, ir.resolved_employee_id) = a.employee_id
    WHERE c.present_in_latest
      AND upper(c.ticket_status) = 'OPEN'
      AND c.days_authorized IS NOT NULL AND c.days_authorized > 0
      AND c.days_open IS NOT NULL AND c.days_open >= 0
      AND (c.days_authorized - c.days_open) <= ${leadDays}
    ORDER BY (c.days_authorized - c.days_open) ASC, c.case_key
  `);
  return rows as unknown as DueCase[];
}

// ── Claim / record helpers (exported for the DB-backed tests) ──────────────

/**
 * Atomically claim the one live slot for this case+cycle. Returns the row id,
 * or null when the cycle is already claimed/sent/queued — the loser of a
 * concurrent race or a re-run sees null and walks away.
 */
export async function claimReminderSlot(c: {
  caseKey: string;
  cycleKey: number;
  ldap: string | null;
  techName?: string | null;
  rentalVendor?: string | null;
  daysOpen?: number | null;
  daysAuthorized?: number | null;
  actor?: string | null;
}): Promise<string | null> {
  await ensureReminderTables();
  const res = await db.execute<{ id: string }>(sql`
    INSERT INTO vrm_rental_extension_reminders
      (case_key, cycle_key, ldap, tech_name, rental_vendor, days_open, days_authorized,
       status, actor, dry_run)
    VALUES (${c.caseKey}, ${c.cycleKey}, ${c.ldap}, ${c.techName ?? null},
            ${c.rentalVendor ?? null}, ${c.daysOpen ?? null}, ${c.daysAuthorized ?? null},
            'claimed', ${c.actor ?? null}, false)
    ON CONFLICT (case_key, cycle_key) WHERE status IN ('claimed','sent','queued')
    DO NOTHING
    RETURNING id
  `);
  return res.rows?.[0]?.id ?? null;
}

/**
 * Free claims stranded by a crash. Evidence-first is delegated: if the
 * claimed send actually reached Twilio, the comms lane's 24h identical-send
 * dedupe refuses the retry, so releasing here can cost a duplicate row but
 * never a duplicate text.
 */
export async function releaseStaleClaims(): Promise<number> {
  await ensureReminderTables();
  const res = await db.execute(sql`
    UPDATE vrm_rental_extension_reminders
       SET status = 'stale',
           reason = 'claim expired without an outcome (sweep crash presumed); slot released'
     WHERE status = 'claimed'
       AND created_at < NOW() - make_interval(mins => ${STALE_CLAIM_MINUTES})
  `);
  return (res as any).rowCount ?? 0;
}

/** Non-consuming outcome row (dry_run / skipped / failed without a claim). */
async function recordOutcome(r: {
  caseKey: string;
  cycleKey: number;
  ldap: string | null;
  techName?: string | null;
  rentalVendor?: string | null;
  daysOpen?: number | null;
  daysAuthorized?: number | null;
  status: "dry_run" | "skipped" | "failed";
  reason: string;
  body?: string | null;
  actor?: string | null;
  dryRun: boolean;
}): Promise<void> {
  await db.execute(sql`
    INSERT INTO vrm_rental_extension_reminders
      (case_key, cycle_key, ldap, tech_name, rental_vendor, days_open, days_authorized,
       status, reason, body, actor, dry_run)
    VALUES (${r.caseKey}, ${r.cycleKey}, ${r.ldap}, ${r.techName ?? null},
            ${r.rentalVendor ?? null}, ${r.daysOpen ?? null}, ${r.daysAuthorized ?? null},
            ${r.status}, ${r.reason}, ${r.body ?? null}, ${r.actor ?? null}, ${r.dryRun})
  `);
}

/** Append the case-history receipt. Never throws — a log failure must not
 * hide a sent text (same contract as logPickupText). */
async function logReminderAction(
  c: DueCase,
  body: string,
  result: { status: string; reason?: string | null; messageId?: string; queueId?: string; segments?: number },
  actor: string | null,
): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO vrm_rental_operation_actions
        (case_key, action_type, note, actor, payload)
      VALUES (
        ${c.case_key},
        ${EXTENSION_REMINDER_ACTION_TYPE},
        ${`Extension reminder ${result.status} to ${c.tech_name || c.ldap || "tech"} (day ${c.days_open} of ${c.days_authorized})`},
        ${actor},
        ${JSON.stringify({
          ldap: c.ldap,
          tech_name: c.tech_name,
          rental_vendor: c.rental_vendor,
          days_open: c.days_open,
          days_authorized: c.days_authorized,
          status: result.status,
          reason: result.reason ?? null,
          message_id: result.messageId ?? null,
          queue_id: result.queueId ?? null,
          segments: result.segments ?? null,
          body,
        })}::jsonb
      )
    `);
  } catch (e: any) {
    console.warn("[VRM/ExtReminder] action log insert failed (non-fatal):", e?.message || e);
  }
}

// ── The sweep ───────────────────────────────────────────────────────────────

export interface SweepOutcome {
  caseKey: string;
  ldap: string | null;
  status: "sent" | "queued" | "dry_run" | "skipped" | "failed";
  reason?: string;
}

export interface SweepSummary {
  live: boolean;
  armed: boolean;
  considered: number;
  sent: number;
  queued: number;
  dryRun: number;
  skipped: number;
  failed: number;
  outcomes: SweepOutcome[];
}

export async function runExtensionReminderSweep(opts?: {
  /** Force a preview even when armed. Never forces LIVE — only the durable
   * settings toggle can arm real sends. */
  dryRun?: boolean;
  leadDays?: number;
  actor?: string | null;
  trigger?: string;
}): Promise<SweepSummary> {
  const leadDays = opts?.leadDays ?? DEFAULT_LEAD_DAYS;
  const actor = opts?.actor ?? "extension-reminder-sweep";
  await ensureSweepSchema();

  const armed = await isExtensionRemindersEnabled();
  const live = armed && opts?.dryRun !== true;

  const released = await releaseStaleClaims();
  if (released > 0) {
    console.warn(`[VRM/ExtReminder] released ${released} stale claim(s) from a crashed sweep`);
  }

  const summary: SweepSummary = {
    live, armed, considered: 0, sent: 0, queued: 0, dryRun: 0, skipped: 0, failed: 0, outcomes: [],
  };
  const runRes = await db.execute<{ id: string }>(sql`
    INSERT INTO vrm_rental_extension_reminder_runs (live, trigger)
    VALUES (${live}, ${opts?.trigger ?? "manual"})
    RETURNING id
  `);
  const runId = runRes.rows?.[0]?.id ?? null;

  let runError: string | null = null;
  try {
    const candidates = await findDueCases(leadDays);
    // One text per technician per run: a tech holding two due rentals gets one
    // nudge — the form pins their current rental, and two near-identical texts
    // in the same minute reads like a system fault, not a reminder.
    const textedLdaps = new Set<string>();

    for (const c of candidates) {
      summary.considered++;
      const cycleKey = c.days_authorized ?? 0;

      const skip = async (reason: string, record = true) => {
        summary.skipped++;
        summary.outcomes.push({ caseKey: c.case_key, ldap: c.ldap, status: "skipped", reason });
        if (record) {
          await recordOutcome({
            caseKey: c.case_key, cycleKey, ldap: c.ldap, techName: c.tech_name,
            rentalVendor: c.rental_vendor, daysOpen: c.days_open, daysAuthorized: c.days_authorized,
            status: "skipped", reason, actor, dryRun: !live,
          });
        }
      };

      try {
        // Throttle: one recorded attempt per case+cycle per ~day, so the
        // 5-minute dispatcher poke cannot pile up duplicate skip/dry_run rows.
        // Silent (record=false) because the earlier row IS the record.
        const recent = await db.execute(sql`
          SELECT 1 FROM vrm_rental_extension_reminders
          WHERE case_key = ${c.case_key} AND cycle_key = ${cycleKey}
            AND status <> 'stale'
            AND created_at > NOW() - make_interval(hours => ${REATTEMPT_HOURS})
          LIMIT 1
        `);
        if (recent.rows.length) {
          summary.skipped++;
          summary.outcomes.push({ caseKey: c.case_key, ldap: c.ldap, status: "skipped", reason: "attempted_recently" });
          continue;
        }

        if (!c.ldap) { await skip("no_racfid: roster has no RACF id for this tech — cannot text"); continue; }
        if (textedLdaps.has(c.ldap)) { await skip("same_tech_already_reminded_this_run"); continue; }

        // Cross-cycle backstop: never re-text a case inside the window even if
        // days_authorized shifted under us.
        const recentText = await db.execute(sql`
          SELECT 1 FROM vrm_rental_extension_reminders
          WHERE case_key = ${c.case_key} AND status IN ('sent','queued')
            AND created_at > NOW() - make_interval(days => ${MIN_DAYS_BETWEEN_TEXTS})
          LIMIT 1
        `);
        if (recentText.rows.length) { await skip("texted_within_min_gap"); continue; }

        // The form's own guard: a pending extension, or a pending/approved NEW
        // (nothing to extend yet), means the nag is wrong. Booked NEW does not
        // block — that IS the rental they need more time on.
        const guard = await liveRequestGuard(c.ldap);
        if (guard.blockExtension) {
          await skip(`live_request: #${guard.blockExtension.requestNo} (${guard.blockExtension.status})`);
          continue;
        }

        const contact = await getContactByLdap(c.ldap);
        if (!contact) { await skip("no_contact: not in fs_comms_contacts"); continue; }
        if (contact.active === false) { await skip("inactive_roster: tech is termed — needs a human, not a bot text"); continue; }
        if (contact.emplStatus && !["", "A"].includes(contact.emplStatus)) {
          await skip(`on_leave: status ${contact.emplStatus}`); continue;
        }
        if (!contact.phone?.trim()) { await skip("no_phone: no number on file"); continue; }

        const body = buildExtensionReminderBody(c);

        if (!live) {
          // Real dry run through the pipeline's own gates — with the SAME
          // options the armed run will pass (incl. the machine 24h dedupe),
          // so "would send" here means exactly what it will mean armed.
          const dry = await sendMessage({
            ldap: c.ldap, category: EXTENSION_REMINDER_CATEGORY, body, dryRun: true,
            skipRecentDuplicate: true,
          });
          const reason = dry.status === "skipped"
            ? `would NOT send: ${dry.reason || "pipeline refused"}`
            : dry.status === "queued"
              ? "would queue (recipient quiet hours)"
              : "would send now";
          summary.dryRun++;
          summary.outcomes.push({ caseKey: c.case_key, ldap: c.ldap, status: "dry_run", reason });
          textedLdaps.add(c.ldap);
          await recordOutcome({
            caseKey: c.case_key, cycleKey, ldap: c.ldap, techName: c.tech_name,
            rentalVendor: c.rental_vendor, daysOpen: c.days_open, daysAuthorized: c.days_authorized,
            status: "dry_run", reason, body, actor, dryRun: true,
          });
          continue;
        }

        // LIVE: claim the cycle slot first, send second.
        const claimId = await claimReminderSlot({
          caseKey: c.case_key, cycleKey, ldap: c.ldap, techName: c.tech_name,
          rentalVendor: c.rental_vendor, daysOpen: c.days_open, daysAuthorized: c.days_authorized,
          actor,
        });
        if (!claimId) {
          summary.skipped++;
          summary.outcomes.push({ caseKey: c.case_key, ldap: c.ldap, status: "skipped", reason: "already_reminded_this_cycle" });
          continue;
        }

        try {
          const result = await sendMessage({
            ldap: c.ldap,
            category: EXTENSION_REMINDER_CATEGORY,
            body,
            sentBy: actor,
            senderName: actor,
            // Machine caller: identical retry within 24h must be a no-op.
            skipRecentDuplicate: true,
          });
          const finalStatus = result.status === "sent" ? "sent"
            : result.status === "queued" ? "queued"
            : "skipped"; // pipeline refusal (opt-out etc.) — frees the slot
          await db.execute(sql`
            UPDATE vrm_rental_extension_reminders
               SET status = ${finalStatus},
                   reason = ${result.reason ?? null},
                   body = ${body},
                   message_id = ${result.messageId ?? null},
                   queue_id = ${result.queueId ?? null},
                   sent_at = ${finalStatus === "sent" || finalStatus === "queued" ? sql`NOW()` : sql`NULL`}
             WHERE id = ${claimId}
          `);
          if (finalStatus === "sent" || finalStatus === "queued") {
            textedLdaps.add(c.ldap);
            summary[finalStatus === "sent" ? "sent" : "queued"]++;
            summary.outcomes.push({ caseKey: c.case_key, ldap: c.ldap, status: finalStatus });
            await logReminderAction(c, body, { ...result, segments: result.segments ?? countSegments(body) }, actor);
          } else {
            summary.skipped++;
            summary.outcomes.push({
              caseKey: c.case_key, ldap: c.ldap, status: "skipped",
              reason: `pipeline refused: ${result.reason || "unknown"}`,
            });
          }
        } catch (sendErr: any) {
          // Failure must NOT consume the cycle — flip the claim to failed
          // (outside the partial index) so the next sweep retries; the comms
          // 24h dedupe protects the ambiguous did-it-actually-send case.
          await db.execute(sql`
            UPDATE vrm_rental_extension_reminders
               SET status = 'failed', reason = ${String(sendErr?.message || sendErr).slice(0, 500)}
             WHERE id = ${claimId}
          `);
          summary.failed++;
          summary.outcomes.push({
            caseKey: c.case_key, ldap: c.ldap, status: "failed",
            reason: String(sendErr?.message || sendErr),
          });
        }
      } catch (caseErr: any) {
        // One bad case must not kill the sweep for everyone behind it.
        summary.failed++;
        summary.outcomes.push({
          caseKey: c.case_key, ldap: c.ldap, status: "failed",
          reason: String(caseErr?.message || caseErr),
        });
        console.error(`[VRM/ExtReminder] case ${c.case_key} failed:`, caseErr?.message || caseErr);
      }
    }
  } catch (e: any) {
    runError = String(e?.message || e);
    throw e;
  } finally {
    if (runId) {
      await db.execute(sql`
        UPDATE vrm_rental_extension_reminder_runs
           SET finished_at = NOW(),
               considered = ${summary.considered},
               sent = ${summary.sent},
               queued = ${summary.queued},
               dry_run = ${summary.dryRun},
               skipped = ${summary.skipped},
               failed = ${summary.failed},
               error = ${runError}
         WHERE id = ${runId}
      `).catch((e) => console.warn("[VRM/ExtReminder] run summary update failed:", e?.message || e));
    }
  }

  console.log(
    `[VRM/ExtReminder] sweep done (${live ? "LIVE" : "dry-run"}): ` +
    `considered ${summary.considered}, sent ${summary.sent}, queued ${summary.queued}, ` +
    `dry-run ${summary.dryRun}, skipped ${summary.skipped}, failed ${summary.failed}`,
  );
  return summary;
}

// ── Read side (the "who was reminded" view) ────────────────────────────────

export async function listExtensionReminders(limit = 200): Promise<any[]> {
  await ensureReminderTables();
  const { rows } = await db.execute(sql`
    SELECT r.id, r.case_key, r.cycle_key, r.ldap, r.tech_name, r.rental_vendor,
           r.days_open, r.days_authorized, r.status, r.reason, r.body, r.dry_run,
           r.actor,
           to_char(r.created_at, 'YYYY-MM-DD"T"HH24:MI:SSZ') AS created_at,
           to_char(r.sent_at, 'YYYY-MM-DD"T"HH24:MI:SSZ')    AS sent_at
    FROM vrm_rental_extension_reminders r
    ORDER BY r.created_at DESC
    LIMIT ${Math.min(Math.max(limit, 1), 1000)}
  `);
  return rows as any[];
}

export async function listExtensionReminderRuns(limit = 30): Promise<any[]> {
  await ensureReminderTables();
  const { rows } = await db.execute(sql`
    SELECT id, live, trigger, considered, sent, queued, dry_run, skipped, failed, error,
           to_char(started_at, 'YYYY-MM-DD"T"HH24:MI:SSZ')  AS started_at,
           to_char(finished_at, 'YYYY-MM-DD"T"HH24:MI:SSZ') AS finished_at
    FROM vrm_rental_extension_reminder_runs
    ORDER BY started_at DESC
    LIMIT ${Math.min(Math.max(limit, 1), 200)}
  `);
  return rows as any[];
}
