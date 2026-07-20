// VRM on-demand Holman scrape orchestration. Spawns holman-svc-scrape-worker
// (isolated Chromium child), normalizes the raw svc-history into the same event
// shape as the imported snapshot, and upserts vrm_holman_portal_hist.
//
// COMPARATIVE (Tyler): by default only scrapes trucks we do NOT already have —
// "if it already has it, the scraper doesn't need to do anything." force=true
// re-scrapes to refresh. Empty results are stored too (so a known-history-less
// truck isn't re-scraped every time).
import { spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { toCanonical, toDisplayNumber } from "../../vehicle-number-utils";
import type { SvcHistoryResult } from "./holman-svc-scrape";

const BATCH = 8;                 // vehicles per worker invocation (Chromium is sequential)
const WORKER_TIMEOUT_MS = 300_000;

const KEEP_PO = ["type","poNumber","eventId","status","vendorName","vendorType","vendorTypeDescription","poAmount","repairDate","poMsgDate","meter","billPaidDate","createdBy","invoiceNo","vendorAddress","vendorPhone","estimatedReadyDate","workCompletedDate","vehicleDowntimeStartDate","vehicleDowntimeEndDate","notes","poNotes","lineItems","isDeclinedPo","rentalRequestExists","openRentalRequestWindow"];
const KEEP_MSG = ["type","poMsgDate","notes","poNumber"];
function trimEvent(e: any) {
  const keep = e.type === "MSG" ? KEEP_MSG : KEEP_PO;
  const o: any = {};
  for (const k of keep) if (e[k] !== undefined && e[k] !== null && e[k] !== "") o[k] = e[k];
  return o;
}
const RENTAL = /ENTERPRISE|\bNATIONAL\b|RENT-?A-?CAR|\bHERTZ\b|\bAVIS\b|\bRENTAL\b|\bTOLL/i;
const TOW = /\bTRXNOW\b|\bTOW(ING)?\b|WRECKER|ROADSIDE|JUMP\s?START|LOCKOUT|WINCH/i;
const PARTS = /\bJASPER\b|HOLMAN PARTS|PARTS DISTRIBUTION|\bNAPA\b|AUTOZONE|O'?REILLY|ADVANCE AUTO|GENUINE PARTS/i;
const isRealShop = (v: string) => !!v && !RENTAL.test(v) && !TOW.test(v) && !PARTS.test(v);
function parseDate(s: any): number { const m = String(s ?? "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? new Date(+m[3], +m[1] - 1, +m[2]).getTime() : 0; }

function spawnScrape(vehicles: string[]): Promise<SvcHistoryResult[]> {
  return new Promise((resolve) => {
    const cwd = process.cwd();
    const tsxBin = path.join(cwd, "node_modules/.bin/tsx");
    const workerTs = "server/vrm/rental-operations/holman-svc-scrape-worker.ts";
    const workerJs = "dist/vrm/rental-operations/holman-svc-scrape-worker.js";
    let cmd: string, args: string[];
    if (existsSync(path.join(cwd, workerJs))) { cmd = process.execPath; args = [workerJs, vehicles.join(",")]; }
    else { cmd = existsSync(tsxBin) ? tsxBin : "npx"; args = existsSync(tsxBin) ? [workerTs, vehicles.join(",")] : ["tsx", workerTs, vehicles.join(",")]; }
    const fallback = () => vehicles.map((v) => ({ vehicle: v, hist: null, error: "worker failed" }));
    let child: ReturnType<typeof spawn>;
    try { child = spawn(cmd, args, { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"], env: process.env }); }
    catch (e: any) { console.error("[SvcScrape] spawn threw:", e?.message); return resolve(fallback()); }
    let out = "", settled = false;
    const done = (r: SvcHistoryResult[]) => { if (!settled) { settled = true; clearTimeout(t); resolve(r); } };
    const t = setTimeout(() => { try { process.kill(-(child.pid as number), "SIGKILL"); } catch {} console.error("[SvcScrape] worker timeout, killed"); done(fallback()); }, WORKER_TIMEOUT_MS);
    child.stdout!.on("data", (d) => { out += d.toString(); });
    child.stderr!.on("data", (d) => process.stderr.write(d));
    child.on("error", (e) => { console.error("[SvcScrape] worker error:", e.message); done(fallback()); });
    child.on("close", () => {
      const line = out.trim().split("\n").filter(Boolean).pop() || "";
      try { const j = JSON.parse(line); done(j.ok ? j.results : fallback()); }
      catch { console.error("[SvcScrape] unparseable worker output:", line.slice(0, 120)); done(fallback()); }
    });
  });
}

async function upsertTruck(caseKey: string, rawHist: any[], scrapedAt: string): Promise<void> {
  const events = (rawHist || []).map(trimEvent);
  const pos = events.filter((e) => e.type === "PO" && e.poNumber && e.poNumber !== "0")
    .sort((a, b) => parseDate(b.repairDate) - parseDate(a.repairDate));
  const msgCount = events.filter((e) => e.type === "MSG").length;
  const shopPos = pos.filter((p) => isRealShop(p.vendorName || ""));
  const openShop = shopPos.find((p) => String(p.status || "").toUpperCase() === "APPROVED");
  const pick = openShop || shopPos[0] || null;
  await db.execute(sql`
    INSERT INTO vrm_holman_portal_hist (truck_no, hist, source, scraped_at, po_count, msg_count, shop_name, shop_phone, shop_address, shop_src)
    VALUES (${caseKey}, ${JSON.stringify(events)}::jsonb, 'on_demand_scrape', ${scrapedAt}, ${pos.length}, ${msgCount},
            ${pick?.vendorName ?? null}, ${pick?.vendorPhone ?? null}, ${pick?.vendorAddress ?? null}, ${openShop ? "open PO" : (pick ? "last PO" : null)})
    ON CONFLICT (truck_no) DO UPDATE SET
      hist=EXCLUDED.hist, source=EXCLUDED.source, scraped_at=EXCLUDED.scraped_at, po_count=EXCLUDED.po_count,
      msg_count=EXCLUDED.msg_count, shop_name=EXCLUDED.shop_name, shop_phone=EXCLUDED.shop_phone,
      shop_address=EXCLUDED.shop_address, shop_src=EXCLUDED.shop_src, imported_at=NOW()
  `);
}

export interface ScrapeReport { requested: number; targeted: number; skipped: number; stored: number; empty: number; errors: number; scrapedAt: string; }

/** Scrape + store portal history for the given case_keys (5-padded truck nums). */
export async function scrapeAndStore(caseKeys: string[], opts: { force?: boolean } = {}): Promise<ScrapeReport> {
  const scrapedAt = new Date().toISOString().slice(0, 10);
  const uniq = Array.from(new Set(caseKeys.map((k) => toDisplayNumber(k)).filter(Boolean)));
  let targets = uniq;
  if (!opts.force && uniq.length) {
    const have = await db.execute(sql`SELECT truck_no FROM vrm_holman_portal_hist WHERE truck_no IN (${sql.join(uniq.map((v) => sql`${v}`), sql`, `)})`);
    const haveSet = new Set((have.rows as any[]).map((r) => r.truck_no));
    targets = uniq.filter((k) => !haveSet.has(k));   // comparative: only what we don't have
  }
  const skipped = uniq.length - targets.length;
  let stored = 0, empty = 0, errors = 0;
  for (let i = 0; i < targets.length; i += BATCH) {
    const batchKeys = targets.slice(i, i + BATCH);
    // Holman MTREACT wants the canonical (unpadded) truck number
    const results = await spawnScrape(batchKeys.map((k) => toCanonical(k)));
    for (const r of results) {
      const caseKey = toDisplayNumber(r.vehicle);
      if (r.error) { errors++; continue; }
      const hist = r.hist || [];
      await upsertTruck(caseKey, hist, scrapedAt);       // store even if empty (comparative: we tried)
      if (hist.length) stored++; else empty++;
    }
  }
  return { requested: caseKeys.length, targeted: targets.length, skipped, stored, empty, errors, scrapedAt };
}

/** Trucks with NO portal row yet (the scrape gaps): every present rental truck,
 * PLUS the assigned trucks (renter_own_truck) of Declined/Auction cases — LUCA
 * dials THOSE shops, so their phone must be scraped too. */
export async function findScrapeGaps(): Promise<string[]> {
  const res = await db.execute(sql`
    SELECT c.case_key AS truck FROM vrm_rental_operations_cases c
    LEFT JOIN vrm_holman_portal_hist p ON p.truck_no = c.case_key
    WHERE c.present_in_latest = true AND p.truck_no IS NULL
    UNION
    SELECT own.own_pad AS truck
    FROM vrm_rental_operations_cases c
    JOIN vrm_rental_identity_resolutions i ON i.case_key = c.case_key
    JOIN all_techs atr ON atr.employee_id = COALESCE(i.override_employee_id, i.resolved_employee_id)
    JOIN LATERAL (SELECT NULLIF(lpad(ltrim(regexp_replace(COALESCE(atr.truck_lu, atr.last_known_truck_lu), '[^0-9]', '', 'g'), '0'), 5, '0'), '00000') AS own_pad) own ON true
    LEFT JOIN vrm_holman_portal_hist p ON p.truck_no = own.own_pad
    WHERE c.present_in_latest = true
      AND (c.ams_status ILIKE '%declin%' OR c.ams_status ILIKE '%auction%')
      AND own.own_pad IS NOT NULL AND p.truck_no IS NULL
    ORDER BY truck`);
  return (res.rows as any[]).map((r) => r.truck);
}
