/**
 * Inbound call ingest. Polls the 87-SEARS-VAN answer box for new conversations,
 * classifies each ONCE, links it to a truck, and persists it.
 *
 * Replaces luca-ai-monitor's model, which live-fetched up to 500 conversations
 * from ElevenLabs on every page load, N+1'd a detail call per conversation, and
 * cached the classification in a process-local Map that died on every restart.
 * Here the API is touched only for conversations we have never seen, and the
 * result is durable.
 *
 * Volume makes this easy: the inbound line ran 58 calls in 60 days (~1/day), so
 * a full backfill is one cheap pass and a 10-minute poll is generous.
 */
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { classifyInboundCall, type TranscriptTurn } from "./classifier";
import { linkInboundCall } from "./link";

/**
 * The inbound answer box. Nexus already had this id in fleet-scope-routes.ts as
 * ELEVENLABS_TECH_AGENT_ID, which is a misleading name — it is not a
 * technician-facing agent, it is the shop-facing inbound line behind
 * 87-SEARS-VAN, and it is the same agent luca-ai-monitor called
 * ELEVENLABS_INBOUND_AGENT_ID.
 */
export const INBOUND_AGENT_ID = process.env.VRM_INBOUND_AGENT_ID?.trim() || "agent_4901khvk9569fd2tawwcx0v0hxp5";
const API = "https://api.elevenlabs.io/v1/convai";

function apiKey(): string {
  return (process.env.FS_ELEVENLABS_API_KEY || process.env.ELEVENLABS_API_KEY || "").trim();
}

async function el(path: string): Promise<any | null> {
  const key = apiKey();
  if (!key) return null;
  try {
    const res = await fetch(`${API}${path}`, { headers: { "xi-api-key": key } });
    if (!res.ok) {
      console.warn(`[VRM/Inbound] ElevenLabs ${path} -> ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (e: any) {
    console.warn(`[VRM/Inbound] ElevenLabs ${path} failed:`, e?.message || e);
    return null;
  }
}

async function getState(k: string): Promise<string | null> {
  try {
    const r = await db.execute(sql`SELECT v FROM vrm_inbound_state WHERE k = ${k}`);
    return (r.rows as any[])[0]?.v ?? null;
  } catch { return null; }
}

async function setState(k: string, v: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO vrm_inbound_state (k, v, updated_at) VALUES (${k}, ${v}, NOW())
    ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = NOW()`);
}

async function logEvent(conversationId: string, action: string, note: string | null, actor = "svc:inbound-sync", newValue: string | null = null): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO vrm_inbound_call_events (conversation_id, action, new_value, note, actor)
      VALUES (${conversationId}, ${action}, ${newValue}, ${note}, ${actor})`);
  } catch (e: any) {
    console.warn("[VRM/Inbound] event log failed:", e?.message || e);
  }
}

export interface SyncResult {
  scanned: number;
  ingested: number;
  skipped: number;
  linked: number;
  errors: number;
  trigger: string;
}

/**
 * One ingest pass.
 *
 * `full` forces a re-scan of every conversation the API will return, which is
 * what the first run and the manual "Backfill" button use. Normal runs stop
 * paging once they hit a conversation we already have, because the list endpoint
 * returns newest-first.
 */
export async function runInboundSync(opts: { trigger?: string; full?: boolean } = {}): Promise<SyncResult> {
  const trigger = opts.trigger || "manual";
  const out: SyncResult = { scanned: 0, ingested: 0, skipped: 0, linked: 0, errors: 0, trigger };
  if (!apiKey()) {
    console.warn("[VRM/Inbound] FS_ELEVENLABS_API_KEY not configured; sync skipped");
    return out;
  }

  const backfilled = (await getState("backfilled")) === "true";
  const full = opts.full || !backfilled;

  let cursor: string | null = null;
  let stop = false;
  let pages = 0;

  while (!stop && pages < 40) {
    pages++;
    const qs = new URLSearchParams({ agent_id: INBOUND_AGENT_ID, page_size: "100" });
    if (cursor) qs.set("cursor", cursor);
    const page = await el(`/conversations?${qs.toString()}`);
    if (!page) break;

    const convos: any[] = page.conversations || [];
    if (!convos.length) break;

    for (const c of convos) {
      const cid = c.conversation_id;
      if (!cid) continue;
      out.scanned++;

      const seen = await db.execute(sql`SELECT 1 FROM vrm_inbound_calls WHERE conversation_id = ${cid}`);
      if ((seen.rows as any[]).length) {
        out.skipped++;
        // Newest-first: the first already-known call means everything after it
        // is known too, so an incremental run can stop here.
        if (!full) { stop = true; break; }
        continue;
      }

      try {
        await ingestOne(cid, c, out);
      } catch (e: any) {
        out.errors++;
        console.error(`[VRM/Inbound] ingest ${cid} failed:`, e?.message || e);
      }
    }

    if (!page.has_more || !page.next_cursor) break;
    cursor = page.next_cursor;
  }

  if (full && !out.errors) await setState("backfilled", "true");
  await setState("last_sync_at", new Date().toISOString());
  await setState("last_sync_result", JSON.stringify(out));
  console.log(`[VRM/Inbound] sync(${trigger}) scanned=${out.scanned} ingested=${out.ingested} linked=${out.linked} skipped=${out.skipped} errors=${out.errors}`);
  return out;
}

async function ingestOne(cid: string, summaryRow: any, out: SyncResult): Promise<void> {
  const detail = await el(`/conversations/${cid}`);
  if (!detail) { out.errors++; return; }

  const meta = detail.metadata || {};
  const turns: TranscriptTurn[] = (detail.transcript || []).map((t: any) => ({ role: t.role, message: t.message }));
  const transcriptText = turns
    .filter((t) => (t.message || "").trim())
    .map((t) => `${t.role === "agent" ? "Luca" : "Caller"}: ${(t.message || "").trim()}`)
    .join("\n");

  const callerPhone = detail.user_id || meta.phone_call?.external_number || null;
  const startUnix = meta.start_time_unix_secs ?? summaryRow.start_time_unix_secs ?? null;
  const callAt = startUnix ? new Date(startUnix * 1000).toISOString() : null;
  const durationSecs = meta.call_duration_secs ?? summaryRow.call_duration_secs ?? null;

  const c = classifyInboundCall(turns, detail.analysis?.transcript_summary ?? null, callerPhone, durationSecs);
  const link = await linkInboundCall(c);
  if (link.matched_truck) out.linked++;

  const summary = detail.analysis?.transcript_summary ?? summaryRow.transcript_summary ?? null;
  const digits = (p: string | null) => (p ? p.replace(/\D/g, "").slice(-10) || null : null);

  await db.execute(sql`
    INSERT INTO vrm_inbound_calls (
      conversation_id, agent_id, call_at, duration_secs, message_count,
      caller_phone, caller_phone_digits,
      call_type, vehicle_status, action_recommendation, priority_level,
      authorization_amount, parts_status, classified_by, classified_at,
      shop_name, caller_name, callback_number, callback_digits,
      vehicle_make_model, vin, vin_last_8, license_plate,
      summary, transcript_text, raw_json,
      matched_truck, matched_case_key, match_method, match_confidence, matched_at,
      status
    ) VALUES (
      ${cid}, ${detail.agent_id ?? INBOUND_AGENT_ID}, ${callAt}, ${durationSecs}, ${summaryRow.message_count ?? null},
      ${callerPhone}, ${digits(callerPhone)},
      ${c.call_type}, ${c.vehicle_status}, ${c.action_recommendation}, ${c.priority_level},
      ${c.authorization_amount}, ${c.parts_status}, ${c.classified_by}, NOW(),
      ${c.shop_name}, ${c.caller_name}, ${c.callback_number}, ${digits(c.callback_number)},
      ${c.vehicle_make_model}, ${c.vin}, ${c.vin_last_8}, ${c.license_plate},
      ${summary}, ${transcriptText}, ${JSON.stringify({
        unit_number: c.unit_number,
        plate_state: c.plate_state,
        shop_city_state: c.shop_city_state,
        reason_text: c.reason_text,
        update_text: c.update_text,
        call_summary_title: summaryRow.call_summary_title ?? null,
      })}::jsonb,
      ${link.matched_truck}, ${link.matched_case_key}, ${link.match_method}, ${link.match_confidence}, NOW(),
      ${c.call_type === "JUNK" ? "DISMISSED" : "NEW"}
    )
    ON CONFLICT (conversation_id) DO NOTHING`);

  out.ingested++;
  await logEvent(cid, "ingest", `${c.call_type} · ${c.action_recommendation} · match=${link.match_method}`, "svc:inbound-sync", link.matched_truck);
}

/**
 * Re-run linkage for calls that never matched a truck. Cheap, and worth doing on
 * a schedule because holman_vehicles_cache backfills over time — a call that
 * could not be matched on Monday often can be by Wednesday.
 */
export async function relinkUnmatched(limit = 200): Promise<{ examined: number; linked: number }> {
  const r = await db.execute(sql`
    SELECT conversation_id, vin, vin_last_8, license_plate, raw_json
    FROM vrm_inbound_calls
    WHERE matched_truck IS NULL AND match_method <> 'manual' AND call_type <> 'JUNK'
    ORDER BY call_at DESC LIMIT ${limit}`);
  let linked = 0;
  const rows = r.rows as any[];
  for (const row of rows) {
    const link = await linkInboundCall({
      unit_number: row.raw_json?.unit_number ?? null,
      vin: row.vin, vin_last_8: row.vin_last_8, license_plate: row.license_plate,
    });
    if (!link.matched_truck) continue;
    await db.execute(sql`
      UPDATE vrm_inbound_calls
      SET matched_truck = ${link.matched_truck}, matched_case_key = ${link.matched_case_key},
          match_method = ${link.match_method}, match_confidence = ${link.match_confidence},
          matched_at = NOW(), updated_at = NOW()
      WHERE conversation_id = ${row.conversation_id}`);
    await logEvent(row.conversation_id, "link", `relinked via ${link.match_method}`, "svc:inbound-relink", link.matched_truck);
    linked++;
  }
  return { examined: rows.length, linked };
}

export async function inboundSyncState(): Promise<{ last_sync_at: string | null; backfilled: boolean; last_result: any }> {
  const [last, bf, res] = await Promise.all([getState("last_sync_at"), getState("backfilled"), getState("last_sync_result")]);
  let parsed: any = null;
  try { parsed = res ? JSON.parse(res) : null; } catch { parsed = null; }
  return { last_sync_at: last, backfilled: bf === "true", last_result: parsed };
}
