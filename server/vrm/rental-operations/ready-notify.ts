/**
 * What happens the moment a case flips to Ready for Pickup (Tyler 2026-07-29):
 *
 *   1. EMAIL the region's recovery owner - West=Sandeep, Central=Oscar,
 *      East=Olga - resolved with the SAME district-vote logic Cases by Region
 *      renders, so the page and the mailbox can never disagree about whose
 *      queue the case is in. Nexus has no email transport, so the actual send
 *      happens on LIVHR (POST /api/luca/notify-region-ready), which already
 *      owns SendGrid and the owners' addresses via its escalation.* keys.
 *
 *   2. Optionally AUTO-TEXT the technician through the pickup-text lane -
 *      gated on the vrm_rental_ops_settings toggle, which ships OFF and stays
 *      OFF until Tyler validates the findings and clicks it on. When it does
 *      run it sends with confirmed:false, so a termed or on-leave tech is
 *      BLOCKED rather than texted - an autonomous send never gets the human
 *      override a person clicking through the modal gets.
 *
 * Called from the write-back worker's applied branch only, i.e. only on a
 * LUCA-driven flip. A human setting the status by hand in the workbook is
 * already the notification - they are looking at the case.
 *
 * Never throws. The worker awaits this (a scheduled-deployment run may exit
 * right after the poll, so fire-and-forget would silently lose the email), but
 * every failure is contained here and reported in the returned struct.
 */
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { getRentalOpsMaster, type MasterRow } from "./read-repository";
import {
  assignDistrictRegions,
  resolveCaseRegion,
  REGION_LABEL,
  REGION_OWNER,
  type Region,
} from "./region";
import { isAutoTextOnReadyEnabled } from "./settings";
import { sendPickupText } from "./pickup-sms";

const LIVHR_BASE_URL = (process.env.LUCA_BASE_URL || process.env.LIVHR_BASE_URL || "https://fleetagents.replit.app").replace(/\/+$/, "");
const AGENT_TOKEN = process.env.AGENT_RUN_SECRET || process.env.LUCA_AGENT_TOKEN || "";
const NOTIFY_PATH = "/api/luca/notify-region-ready";

/**
 * How long an earlier pickup text suppresses the automatic one. A fresh ready
 * signal (new shop call, new outbox task) re-triggers the flip, and without
 * this window each one would text the same technician again.
 */
const AUTO_TEXT_DEDUP_DAYS = 7;

export interface ReadyNotifyResult {
  caseKey: string;
  region: Region | null;
  regionLabel: string;
  owner: string;
  email: { attempted: boolean; sent: boolean; reason: string | null };
  autoText: { enabled: boolean; attempted: boolean; status: string | null; reason: string | null };
}

/**
 * Verbatim copy of region-routes' loadTechHomeStates (it is module-private
 * there). The trim + UPPER matter: regionForState only accepts clean 2-letter
 * codes, and the map key must match String(employee_id).trim() exactly or the
 * vote silently loses its primary signal.
 */
async function loadTechHomeStates(): Promise<Map<string, string>> {
  const res: any = await db.execute(sql`
    SELECT employee_id, home_state
    FROM all_techs
    WHERE employee_id IS NOT NULL
      AND home_state IS NOT NULL
      AND btrim(home_state) <> ''`);
  const rows = (res?.rows ?? res ?? []) as Array<{ employee_id: string; home_state: string }>;
  const m = new Map<string, string>();
  for (const r of rows) m.set(String(r.employee_id).trim(), String(r.home_state).trim().toUpperCase());
  return m;
}

/** True when this case already got a pickup text (sent or queued) recently. */
async function recentlyTexted(caseKey: string): Promise<boolean> {
  const res = await db.execute(sql`
    SELECT 1 FROM vrm_rental_operation_actions
    WHERE case_key = ${caseKey}
      AND action_type = 'pickup_text'
      AND payload->>'status' IN ('sent', 'queued')
      AND created_at > NOW() - make_interval(days => ${AUTO_TEXT_DEDUP_DAYS})
    LIMIT 1`);
  return (res.rows ?? []).length > 0;
}

async function postNotify(payload: Record<string, unknown>): Promise<{ sent: boolean; reason: string | null }> {
  if (/^(true|1|yes)$/i.test((process.env.VRM_READY_NOTIFY_DISABLED ?? "").trim())) {
    return { sent: false, reason: "VRM_READY_NOTIFY_DISABLED" };
  }
  if (!AGENT_TOKEN) {
    return { sent: false, reason: "AGENT_RUN_SECRET not set - cannot authenticate to LIVHR" };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(`${LIVHR_BASE_URL}${NOTIFY_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Agent-Token": AGENT_TOKEN },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const body: any = await res.json().catch(() => null);
    if (res.status === 404) {
      return { sent: false, reason: "LIVHR /api/luca/notify-region-ready not deployed yet" };
    }
    if (!res.ok) return { sent: false, reason: body?.reason || `LIVHR returned ${res.status}` };
    return { sent: body?.sent === true, reason: body?.sent === true ? null : (body?.reason ?? (body?.dryRun ? "LIVHR in dry-run" : "not sent")) };
  } catch (e: any) {
    return { sent: false, reason: e?.name === "AbortError" ? "LIVHR notify timed out (15s)" : (e?.message || "notify request failed") };
  } finally {
    clearTimeout(timer);
  }
}

export async function notifyReadyFlip(input: {
  caseKey: string;
  detail?: string | null;
  externalId?: string | number | null;
  /** Compute region + gates but touch nothing external. For tests. */
  dryRun?: boolean;
}): Promise<ReadyNotifyResult> {
  const out: ReadyNotifyResult = {
    caseKey: input.caseKey,
    region: null,
    regionLabel: "UNASSIGNED",
    owner: "all regional owners",
    email: { attempted: false, sent: false, reason: null },
    autoText: { enabled: false, attempted: false, status: null, reason: null },
  };

  let row: MasterRow | undefined;
  try {
    // Page-canonical region: same master rows, same home-state attach, same
    // district vote as GET /by-region. The vote needs the WHOLE board (a
    // district's region is decided by all its cases together), which is why
    // this is not a single-row lookup.
    const [model, homeStates] = await Promise.all([getRentalOpsMaster({}), loadTechHomeStates()]);
    const withState = model.rows.map((r) => ({
      ...r,
      tech_home_state: homeStates.get(String((r as any).employee_id ?? "").trim()) ?? null,
    }));
    const districts = assignDistrictRegions(withState);
    const mine = withState.find((r) => r.case_key === input.caseKey);
    if (!mine) {
      out.email.reason = `case ${input.caseKey} not on the board`;
      return out;
    }
    row = mine;
    const resolved = resolveCaseRegion(mine, districts);
    out.region = resolved.region;
    out.regionLabel = resolved.region ? REGION_LABEL[resolved.region] : "UNASSIGNED";
    out.owner = resolved.region ? REGION_OWNER[resolved.region] : "all regional owners";
  } catch (e: any) {
    out.email.reason = `region resolution failed: ${e?.message || e}`;
    return out;
  }

  // Same redirect rule as the pickup text: on declined/auction the truck the
  // tech collects is their ASSIGNED truck at ITS shop.
  const redirect = !!(row.redirect_to_assigned && row.call_target_truck);
  const collectTruck = redirect ? String(row.call_target_truck) : row.case_key;
  const shopName = redirect ? row.call_shop_name : row.shop_name;

  // ── 1. the email ──────────────────────────────────────────────────────────
  out.email.attempted = true;
  if (input.dryRun) {
    out.email.reason = "dry-run";
  } else {
    const r = await postNotify({
      region: out.region,
      truck: collectTruck,
      case_key: row.case_key,
      tech_name: row.tech_name,
      shop_name: shopName,
      days_open: row.days_open,
      daily_cost: row.daily_cost,
      vehicle_desc: row.veh_desc,
      detail: input.detail ?? null,
      source: input.externalId != null ? `LUCA task ${input.externalId}` : "vrm_ready_flip",
    });
    out.email.sent = r.sent;
    out.email.reason = r.reason;
  }

  // ── 2. the auto-text, only if Tyler has switched it on ────────────────────
  try {
    out.autoText.enabled = await isAutoTextOnReadyEnabled();
    if (!out.autoText.enabled) {
      out.autoText.reason = "toggle off";
      return out;
    }
    if (await recentlyTexted(input.caseKey)) {
      out.autoText.reason = `already texted within ${AUTO_TEXT_DEDUP_DAYS} days`;
      return out;
    }
    if (input.dryRun) {
      out.autoText.reason = "dry-run (would send)";
      return out;
    }
    out.autoText.attempted = true;
    const sent = await sendPickupText({
      caseKey: input.caseKey,
      actor: "LUCA-auto",
      // No confirmed override: a termed or on-leave tech BLOCKS. Autonomy does
      // not get the human-judgment bypass the modal's operator gets.
      confirmed: false,
    });
    out.autoText.status = sent.status;
    out.autoText.reason = sent.ok ? null : sent.message;
  } catch (e: any) {
    out.autoText.reason = `auto-text failed: ${e?.message || e}`;
  }
  return out;
}
