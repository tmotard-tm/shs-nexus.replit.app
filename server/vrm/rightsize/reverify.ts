/**
 * Re-verify every tech the tracker currently calls a NON_RESPONDER.
 *
 * Why this exists: on 7/20 the tracker reported 12 techs as never having
 * replied. At least three had replied - two of them BEFORE the 2026-07-17 20:00
 * watermark (so the rolling sync never looked) and one from a number that was
 * not in fs_comms_contacts (so the old matcher threw the message away). Nobody
 * gets called silent again until we have searched ALL inbound, ALL categories,
 * ALL of that tech's known numbers, with NO watermark bound.
 *
 * Truth boundary is untouched: a hit only ever PROPOSES a stage
 * (proposed_stage + needs_review + an event). DONE and RETURNED still move only
 * when a human confirms them.
 *
 * The comms source is separable from the tracker connection so the dev tracker
 * can be corrected against a READ-ONLY read of the live comms database:
 *   RIGHTSIZE_COMMS_DATABASE_URL=postgres://... npx tsx server/run-vrm-rightsize-reverify.ts
 */
import { Pool } from "pg";
import { db, pool as appPool } from "../../db";
import { sql } from "drizzle-orm";
import { classifyReply, isTapback } from "./classifier";
import { normalizePhone, normalizeLdap } from "./phone";

export interface ReverifyOptions {
  /** Read-only comms connection. Defaults to the application database. */
  commsDatabaseUrl?: string | null;
  /** Which tracker stages to re-check. Default: the accusatory one. */
  stages?: string[];
  /** Report only; write nothing. */
  dryRun?: boolean;
}

export interface ReverifyHit {
  messageId: string;
  at: string;
  phone: string | null;
  category: string | null;
  body: string;
  via: string;
}

export interface ReverifyTechResult {
  ldap: string;
  techName: string | null;
  stage: string;
  knownNumbers: string[];
  hits: ReverifyHit[];
  replied: boolean;
  proposedStage: string | null;
  reason: string | null;
}

export interface ReverifyReport {
  scannedStages: string[];
  commsSource: "app" | "external";
  dryRun: boolean;
  techs: ReverifyTechResult[];
  repliedCount: number;
  silentCount: number;
  flagged: number;
}

interface Queryable {
  query(text: string, params?: any[]): Promise<{ rows: any[] }>;
}

const MAX_EVIDENCE = 25;

/**
 * iMessage tapbacks arrive as inbound SMS that quote OUR outbound text
 * ("Liked "Thank you for the photos..."") . They are proof of life but they are
 * not the tech's own words, so they must not be the message we classify - the
 * quoted outbound copy would otherwise decide the verdict.
 *
 * Detection now lives in classifier.ts (isTapback) so the 30-minute sync and
 * this pass share ONE definition. Used here for evidence selection only.
 */

/** Numbers a tech owns, from the comms source (contacts + HR roster). */
async function loadKnownNumbers(comms: Queryable, ldaps: string[]): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>();
  const add = (ldap: unknown, phone: unknown) => {
    const l = normalizeLdap(ldap);
    const p = normalizePhone(phone);
    if (!l || !p) return;
    if (!map.has(l)) map.set(l, new Set());
    map.get(l)!.add(p);
  };
  const contacts = await comms.query(
    `SELECT UPPER(TRIM(ldap)) AS ldap, phone_digits, phone FROM fs_comms_contacts WHERE UPPER(TRIM(ldap)) = ANY($1)`,
    [ldaps],
  );
  for (const r of contacts.rows) { add(r.ldap, r.phone_digits); add(r.ldap, r.phone); }
  const roster = await comms.query(
    `SELECT UPPER(TRIM(tech_racfid)) AS ldap, main_phone, cell_phone, home_phone
     FROM all_techs WHERE UPPER(TRIM(tech_racfid)) = ANY($1)`,
    [ldaps],
  );
  for (const r of roster.rows) { add(r.ldap, r.main_phone); add(r.ldap, r.cell_phone); add(r.ldap, r.home_phone); }
  return map;
}

export async function reverifyNonResponders(opts: ReverifyOptions = {}): Promise<ReverifyReport> {
  const stages = opts.stages?.length ? opts.stages.map((s) => s.toUpperCase()) : ["NON_RESPONDER"];
  const dryRun = opts.dryRun === true;
  const external = opts.commsDatabaseUrl ? new Pool({ connectionString: opts.commsDatabaseUrl, max: 3 }) : null;
  const comms: Queryable = external ?? (appPool as unknown as Queryable);

  try {
    const stageList = sql.join(stages.map((s) => sql`${s}`), sql`, `);
    const trackedRes = await db.execute(sql`
      SELECT ldap, tech_name, stage, phone_digits FROM vrm_rightsize_techs
      WHERE stage IN (${stageList})
      ORDER BY ldap
    `);
    const tracked = trackedRes.rows as any[];
    const ldaps = tracked.map((t) => normalizeLdap(t.ldap));
    const known = ldaps.length ? await loadKnownNumbers(comms, ldaps) : new Map<string, Set<string>>();

    const results: ReverifyTechResult[] = [];
    let flagged = 0;

    for (const t of tracked) {
      const ldap = normalizeLdap(t.ldap);
      const numbers = known.get(ldap) ?? new Set<string>();
      const campaign = normalizePhone(t.phone_digits);
      if (campaign) numbers.add(campaign);
      const numberList = Array.from(numbers);

      // NO watermark, ALL categories, ANY number the tech owns.
      const hitRes = await comms.query(
        `SELECT id, ldap, phone_digits, phone, category, body,
                to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at_utc
         FROM fs_comms_messages
         WHERE direction = 'inbound'
           AND (UPPER(TRIM(COALESCE(ldap,''))) = $1
                OR RIGHT(regexp_replace(COALESCE(phone_digits, phone, ''), '\\D', '', 'g'), 10) = ANY($2::text[]))
         ORDER BY created_at DESC
         LIMIT ${MAX_EVIDENCE}`,
        [ldap, numberList],
      );

      // back to chronological order: newest last
      const hits: ReverifyHit[] = hitRes.rows.reverse().map((m: any) => ({
        messageId: String(m.id),
        at: m.at_utc,
        phone: normalizePhone(m.phone_digits) ?? normalizePhone(m.phone),
        category: m.category ?? null,
        body: String(m.body ?? ""),
        via: normalizeLdap(m.ldap) === ldap ? "message_ldap" : "owned_number",
      }));

      if (!hits.length) {
        results.push({ ldap, techName: t.tech_name ?? null, stage: t.stage, knownNumbers: numberList, hits: [], replied: false, proposedStage: null, reason: null });
        continue;
      }

      // Classify on the newest message that is actually the tech's own words;
      // empty-bodied MMS and tapbacks still count as proof of life.
      const newestFirst = [...hits].reverse();
      const decisive =
        newestFirst.find((h) => h.body.trim().length > 0 && !isTapback(h.body)) ??
        newestFirst.find((h) => h.body.trim().length > 0) ??
        hits[hits.length - 1];
      const verdict = classifyReply({ body: decisive.body, currentStage: t.stage });
      const proposal = verdict.proposal ?? "NEW_REPLY";
      const reason = verdict.proposal
        ? `re-verify: ${verdict.reason}`
        : "re-verify: reply found but the conservative classifier had no confident verdict; human read owed";
      const evidence = `${reason} [msg ${decisive.messageId} @ ${decisive.at} from ${decisive.phone ?? "unknown"} cat=${decisive.category ?? "?"} via ${decisive.via}] "${decisive.body.replace(/\s+/g, " ").slice(0, 240)}"`;

      results.push({
        ldap, techName: t.tech_name ?? null, stage: t.stage, knownNumbers: numberList,
        hits, replied: true, proposedStage: proposal, reason: evidence,
      });

      if (dryRun) continue;

      // PROPOSE ONLY. stage is never written here - DONE/RETURNED stay human-only.
      await db.execute(sql`
        UPDATE vrm_rightsize_techs
        SET proposed_stage = ${proposal}, needs_review = TRUE, review_reason = ${evidence.slice(0, 2000)},
            last_inbound_at = GREATEST(COALESCE(last_inbound_at, 'epoch'::timestamptz), ${hits[hits.length - 1].at}::timestamptz),
            last_inbound_text = ${decisive.body.slice(0, 500)},
            decisive_at = ${decisive.at}::timestamptz, decisive_text = ${decisive.body.slice(0, 500)},
            updated_at = NOW()
        WHERE ldap = ${ldap}
      `);
      await db.execute(sql`
        INSERT INTO vrm_rightsize_events (ldap, message_id, message_at, message_text, old_stage, new_stage, action, reason, actor)
        VALUES (${ldap}, ${decisive.messageId}, ${decisive.at}::timestamptz, ${decisive.body.slice(0, 1000)},
                ${t.stage}, ${proposal}, 'propose_review', ${evidence.slice(0, 2000)}, 'svc:rightsize-reverify')
        ON CONFLICT DO NOTHING
      `);
      flagged += 1;
    }

    const repliedCount = results.filter((r) => r.replied).length;
    return {
      scannedStages: stages,
      commsSource: external ? "external" : "app",
      dryRun,
      techs: results,
      repliedCount,
      silentCount: results.length - repliedCount,
      flagged,
    };
  } finally {
    if (external) await external.end().catch(() => {});
  }
}
