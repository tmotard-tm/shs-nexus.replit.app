/**
 * VRM Rental Operations V2 — LUCA caller bridge.
 *
 * VRM is the source of truth for WHICH shop to call (incl. the declined/auction
 * assigned-truck redirect). LUCA (LividHarmoniousRotation, a separate app) owns
 * the actual ElevenLabs→Twilio dial via agent_3201 + all live-dial gates (TCPA,
 * 30-min double-dial, LUCA_LIVE / LUCA_OUTREACH_LIVE, clocked-in). So this module
 * does NOT dial — it hands the effective call spec to a thin authed LIVHR
 * endpoint (POST /api/luca/call-shop) with the server-side X-Agent-Token, and
 * relays the result. Token never reaches the browser.
 *
 * Cutover posture: if the LIVHR endpoint isn't deployed yet, or the token isn't
 * set, this returns a clear, non-throwing status the UI can show — nothing dials.
 */
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { getRentalOpsMaster, type MasterRow } from "./read-repository";
import { logLucaActivity } from "./luca-activity";

const LUCA_BASE_URL = (process.env.LUCA_BASE_URL || process.env.LIVHR_BASE_URL || "https://fleetagents.replit.app").replace(/\/+$/, "");
const AGENT_TOKEN = process.env.AGENT_RUN_SECRET || process.env.LUCA_AGENT_TOKEN || "";
const CALL_PATH = "/api/luca/call-shop";
const CONCURRENCY = 4;

export interface CallSpec {
  rental_truck: string;
  call_target_truck: string | null;
  redirect_to_assigned: boolean;
  shop_name: string | null;
  shop_phone: string | null;
  shop_address: string | null;
  shop_po_number: string | null;
  tech_name: string | null;
  employee_id: string | null;
  vehicle_desc: string | null;
  ams_status: string | null;
  ticket_number: string | null;
  source: "vrm_rental_operations";
}

export function buildCallSpec(r: MasterRow): CallSpec {
  return {
    rental_truck: r.case_key,
    call_target_truck: r.call_target_truck,
    redirect_to_assigned: r.redirect_to_assigned,
    shop_name: r.call_shop_name,
    shop_phone: r.call_shop_phone,
    shop_address: r.call_shop_address,
    shop_po_number: r.call_shop_po_number,
    tech_name: r.tech_name ?? r.renter_name_raw,
    employee_id: r.employee_id,
    vehicle_desc: r.veh_desc,
    ams_status: r.ams_status,
    ticket_number: r.ticket_number,
    source: "vrm_rental_operations",
  };
}

async function postToLuca(spec: CallSpec): Promise<any> {
  if (!AGENT_TOKEN) {
    return { ok: false, dialed: false, dryRun: false, notConfigured: true, message: "AGENT_RUN_SECRET not set on Nexus — cannot authenticate to LUCA" };
  }
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(`${LUCA_BASE_URL}${CALL_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Agent-Token": AGENT_TOKEN },
      body: JSON.stringify(spec),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let body: any = null;
    try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    if (!res.ok) {
      const notThere = res.status === 404;
      return { ok: false, dialed: false, status: res.status, notDeployed: notThere,
        message: notThere ? "LUCA /api/luca/call-shop not deployed yet — ship + Deploy the LIVHR change" : (body?.error || `LUCA returned ${res.status}`) };
    }
    // LIVHR returns { ok, dialed, dryRun, conversationId, message }
    return { ok: true, ...(body || {}) };
  } catch (e: any) {
    const aborted = e?.name === "AbortError";
    return { ok: false, dialed: false, message: aborted ? "LUCA call timed out (30s)" : (e?.message || "LUCA request failed") };
  } finally {
    clearTimeout(to);
  }
}

/** Record the dispatch on the vehicle record (vrm_rental_operations_call_log).
 * conversation_id may be null on failed dispatches — insert anyway (UNIQUE
 * allows multiple NULLs). Never throws: a log failure must not break the call. */
async function logDispatch(row: MasterRow, result: any, actor?: string | null): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO vrm_rental_operations_call_log
        (case_key, target_truck, conversation_id, dispatched_by, dry_run, dialed, shop_name, shop_phone, note, source)
      VALUES (${row.case_key}, ${row.call_target_truck ?? row.case_key}, ${result?.conversationId ?? null},
              ${actor ?? null}, ${result?.dryRun === true}, ${result?.dialed === true},
              ${row.call_shop_name ?? null}, ${row.call_shop_phone ?? null}, ${result?.message ?? null}, 'luca_dispatch')
      ON CONFLICT (conversation_id) DO NOTHING
    `);
  } catch (e: any) {
    console.warn("[VRM/RentalOps] call-log insert failed (non-fatal):", e?.message || e);
  }
  // Sync-health ledger (never throws). The call-log row above is the vehicle
  // record; this is the LUCA activity trail the viewer page reads.
  await logLucaActivity({
    direction: "outbound",
    eventType: "dispatch_call",
    status: result?.ok ? (result?.dryRun === true ? "dry_run" : "ok") : "failed",
    caseKey: row.case_key,
    truckNumber: row.call_target_truck ?? row.case_key,
    conversationId: result?.conversationId ?? null,
    actor: actor ?? null,
    summary:
      `${result?.ok ? (result?.dryRun ? "dry-run dispatch" : result?.dialed ? "dialed" : "dispatched") : "dispatch failed"}` +
      ` — ${row.call_shop_name ?? "unknown shop"}${row.call_shop_phone ? ` ${row.call_shop_phone}` : ""}` +
      (result?.message ? ` (${result.message})` : ""),
    detail: {
      dialed: result?.dialed === true,
      dryRun: result?.dryRun === true,
      message: result?.message ?? null,
      shopName: row.call_shop_name ?? null,
      shopPhone: row.call_shop_phone ?? null,
      redirectToAssigned: row.redirect_to_assigned === true,
      httpStatus: result?.status ?? null,
      notDeployed: result?.notDeployed === true,
      notConfigured: result?.notConfigured === true,
    },
  });
}

/** Hand ONE callable case to LUCA. */
export async function dispatchCall(caseKey: string, actor?: string | null): Promise<any> {
  const m = await getRentalOpsMaster({});
  const row = m.rows.find((r) => r.case_key === caseKey);
  if (!row) {
    await logLucaActivity({
      direction: "outbound", eventType: "dispatch_refused", status: "refused",
      caseKey, actor: actor ?? null,
      summary: `case ${caseKey} not found on the board — nothing dispatched`,
    });
    return { ok: false, message: `case ${caseKey} not found` };
  }
  if (!row.callable || !row.call_shop_phone) {
    const msg = `case ${caseKey} is not callable (no verified shop phone${row.redirect_to_assigned ? " on the assigned truck" : ""})`;
    await logLucaActivity({
      direction: "outbound", eventType: "dispatch_refused", status: "refused",
      caseKey, truckNumber: row.call_target_truck ?? caseKey, actor: actor ?? null,
      summary: msg,
    });
    return { ok: false, message: msg };
  }
  const result = await postToLuca(buildCallSpec(row));
  await logDispatch(row, result, actor);
  return { caseKey, callTarget: row.call_target_truck, redirect: row.redirect_to_assigned, shop: row.call_shop_name, ...result };
}

/** Hand a set of callable cases to LUCA (concurrency-limited, request-bound). */
export async function dispatchBatch(caseKeys: string[], actor?: string | null): Promise<any> {
  const m = await getRentalOpsMaster({});
  const wanted = new Set(caseKeys);
  const targets = m.rows.filter((r) => wanted.has(r.case_key) && r.callable && r.call_shop_phone);
  // Requested-but-filtered keys would otherwise vanish without a trace: the
  // batch result reports totals, but nothing durable says WHICH cases were
  // silently dropped. One ledger row for the whole batch (not one per key).
  const droppedKeys = caseKeys.filter((k) => !targets.some((t) => t.case_key === k));
  if (droppedKeys.length > 0) {
    await logLucaActivity({
      direction: "outbound", eventType: "dispatch_refused", status: "refused",
      actor: actor ?? null,
      summary: `batch: ${droppedKeys.length} of ${caseKeys.length} case(s) not callable — ${droppedKeys.slice(0, 8).join(", ")}${droppedKeys.length > 8 ? "…" : ""}`,
      detail: { requested: caseKeys.length, dispatched: targets.length, dropped: droppedKeys },
    });
  }
  const results: any[] = [];
  let dispatched = 0, dialed = 0, dryRun = 0, failed = 0, anyDryRun = false;
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const slice = targets.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(slice.map(async (r) => {
      const res = await postToLuca(buildCallSpec(r));
      await logDispatch(r, res, actor);
      return { caseKey: r.case_key, callTarget: r.call_target_truck, redirect: r.redirect_to_assigned, shop: r.call_shop_name, result: res };
    }));
    for (const s of settled) {
      results.push(s);
      if (s.result?.ok) { dispatched++; if (s.result.dialed) dialed++; if (s.result.dryRun) { dryRun++; anyDryRun = true; } }
      else failed++;
    }
  }
  return { total: targets.length, dispatched, dialed, dryRun: anyDryRun, dryRunCount: dryRun, failed, results };
}
