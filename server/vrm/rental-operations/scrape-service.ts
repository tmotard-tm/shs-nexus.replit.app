// VRM on-demand Holman scrape orchestration. Spawns holman-svc-scrape-worker
// (isolated Chromium child), normalizes the raw svc-history into the same event
// shape as the imported snapshot, and upserts vrm_holman_portal_hist.
//
// DELTA LAYER (Tyler 7/21: "I would expect to have the snowflake data and then
// scrape and only bring in from the scraper what's different. We don't have to
// reinvent the wheel."). Snowflake/HOLMAN_ETL_PO_DETAILS is the BASE layer and
// sweeps every rental; the portal scrape is the CORRECTION layer and costs a
// headless Chromium session per truck. So this module never sweeps the fleet:
//   - findScrapeTargets() picks only trucks where the base layer is missing or
//     provably suspect (see the trigger block on that function), and
//   - upsertTruck() rewrites the row only when the portal content actually
//     differs; an identical re-observation touches scraped_at and nothing else.
// The old behaviour — anti-join on "no portal row at all" — could never revisit
// a truck, so on 7/21 prod carried 332 shop phones from a single 7/16 seed run
// and 74 of them pointed at a shop the current PO had already superseded.
//
// COLUMN SEMANTICS, changed 7/21 and depended on elsewhere — read before editing:
//   scraped_at  = WHEN WE LAST LOOKED. Bumped on every visit, including a no-op.
//                 (Before this rewrite a row was written once and never revisited,
//                 so "last looked" and "content date" were the same thing and the
//                 distinction never surfaced.) read-repository.ts reads it two
//                 ways — as portal observation age in getPoDataFreshness(), and as
//                 PORTAL_PO_OBS.observed_at, which decides whether a portal status
//                 outranks the ETL's upload_timestamp. Both still want "when we
//                 observed", so both stay correct under the new meaning.
//   imported_at = WHEN THE CONTENT LAST CHANGED. Only touched on a real diff.
//                 This is the only surviving "something moved" signal, which is
//                 why the no-op detection in upsertTruck has to actually work.
import { spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { toCanonical, toDisplayNumber } from "../../vehicle-number-utils";
import type { SvcHistoryResult } from "./holman-svc-scrape";
import { classifyPoVendor, type PoClassLine } from "./vendor-class";

const BATCH = 8;                 // vehicles per worker invocation (Chromium is sequential)
const WORKER_TIMEOUT_MS = 300_000;

// ── Targeting constants ─────────────────────────────────────────────────────
// How long a portal snapshot stays trustworthy for an operationally-relevant
// truck. The number is not arbitrary: portal truth decays as Holman flips POs
// APPROVED -> PAID/VOID, and the ETL learns that late (94% of po_history rows
// carry an upload_timestamp over 30 days old), so the portal is our ONLY early
// warning that a "still open" repair actually closed. 14 days keeps every
// open-repair truck inside a fortnight of ground truth while amortising to
// ~12 browser sessions a day across the ~170 open-repair trucks on prod.
// Shorter (7d) doubles the Chromium bill for no observed benefit; longer (30d)
// is past the point where the ETL would have caught up on its own anyway.
const STALE_HORIZON_DAYS = 14;

// A portal-vs-ETL shop disagreement is not always OUR staleness — it is just as
// often the ETL lagging, and re-scraping will NOT make it go away. Without a
// cooldown those trucks would re-arm on every single run forever (74 of them on
// prod). upsertTruck bumps scraped_at even on a no-op precisely so this cooldown
// can work, which caps a permanently-disagreeing truck at ~2 sessions a week.
const MISMATCH_RECHECK_DAYS = 3;

// Hard ceiling on one sweep. At ~20s of Chromium per truck, 150 is ~50 minutes
// of background work — it fits between the nightly ETL land and the morning LUCA
// call run, and past that the tail is stale before anyone dials it. Targets are
// priority-ordered, so a truncated run drops the cosmetic tail, never the urgent
// head. The route reports found vs started so the operator sees the remainder.
const MAX_TARGETS_PER_RUN = 150;

// Tyler's PO rule. Tow/roadside vendors do not count as a repair unless parts
// and/or labor are on the PO.
//
// Alias-parameterised on purpose. The first cut of this file spelled it once as
// a constant bound to alias `h.` and then RE-INLINED the same predicate verbatim
// against alias `s.` in the shop lateral, which is the copy that drifts first
// (you edit the constant, the inline copy silently keeps the old rule). One
// definition, pass the alias.
//
// It is still hand-synced with read-repository.ts (po_eff.is_qualifying_repair)
// because that module does not export its CTEs. If you change the rule, change
// it in BOTH files — see the eff_status note on findScrapeTargets.
const QUALIFYING_REPAIR_PO = (alias: string) =>
  sql`(${sql.raw(alias)}.vendor_type = 'repair' OR (${sql.raw(alias)}.vendor_type = 'tow' AND ${sql.raw(alias)}.has_parts_labor IS TRUE))`;

// Vendor names are compared case- and punctuation-insensitively: the portal
// renders "BIG-O TIRES #7042" where the ETL lands "BIG O TIRES 7042", and a
// scrape triggered by that would be pure waste.
const NORM_VENDOR = (col: any) => sql`upper(regexp_replace(${col}, '[^A-Za-z0-9]', '', 'g'))`;

const KEEP_PO = ["type","poNumber","eventId","status","vendorName","vendorType","vendorTypeDescription","poAmount","repairDate","poMsgDate","meter","billPaidDate","createdBy","invoiceNo","vendorAddress","vendorPhone","estimatedReadyDate","workCompletedDate","vehicleDowntimeStartDate","vehicleDowntimeEndDate","notes","poNotes","lineItems","isDeclinedPo","rentalRequestExists","openRentalRequestWindow"];
const KEEP_MSG = ["type","poMsgDate","notes","poNumber"];
function trimEvent(e: any) {
  const keep = e.type === "MSG" ? KEEP_MSG : KEEP_PO;
  const o: any = {};
  for (const k of keep) if (e[k] !== undefined && e[k] !== null && e[k] !== "") o[k] = e[k];
  return o;
}
// Shop selection uses the SAME classifier as the ETL land (Tyler's PO rule):
// tow/roadside vendors are skipped UNLESS parts and/or labor are on the PO.
// The portal's lineItems carry `typeDesc` (PARTS | LABOR | RENTAL | ROADSIDE | …).
const isRealShop = (p: any) =>
  classifyPoVendor({ vendorName: p?.vendorName ?? null, lines: (p?.lineItems as PoClassLine[]) ?? null }).vendorType === "repair";
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

/** What a single truck's write actually did. `unchanged` means we looked and the
 * portal said exactly what we already had stored. */
type UpsertOutcome = { changed: boolean; empty: boolean };

async function upsertTruck(caseKey: string, rawHist: any[], scrapedAt: string): Promise<UpsertOutcome> {
  const events = (rawHist || []).map(trimEvent);
  // MOST RECENT first (Tyler: "pulls the most recent repair shop PO"), with a
  // deterministic poNumber tiebreak so equal repair dates never order randomly.
  const pos = events.filter((e) => e.type === "PO" && e.poNumber && e.poNumber !== "0")
    .sort((a, b) => (parseDate(b.repairDate) - parseDate(a.repairDate))
      || String(b.poNumber ?? "").localeCompare(String(a.poNumber ?? ""), undefined, { numeric: true }));
  const msgCount = events.filter((e) => e.type === "MSG").length;
  const shopPos = pos.filter(isRealShop);
  const openShop = shopPos.find((p) => String(p.status || "").toUpperCase() === "APPROVED");
  const pick = openShop || shopPos[0] || null;

  const histJson = JSON.stringify(events);
  const next = {
    poCount: pos.length,
    msgCount,
    shopName: (pick?.vendorName ?? null) as string | null,
    shopPhone: (pick?.vendorPhone ?? null) as string | null,
    shopAddress: (pick?.vendorAddress ?? null) as string | null,
    shopSrc: (openShop ? "open PO" : (pick ? "last PO" : null)) as string | null,
  };

  // DELTA WRITE. "Only bring in from the scraper what's different" applies to the
  // table too, not just to which trucks we visit.
  //
  // The scraped_at / imported_at split is the load-bearing bit, and it is easy to
  // get backwards. scraped_at answers "when did we last LOOK at the portal" and
  // is bumped on every visit including a no-op; imported_at answers "when did this
  // content last CHANGE" and is only touched on a real diff. Skipping the
  // scraped_at bump on a no-op would feel tidier but is a trap: findScrapeTargets
  // keys its staleness and mismatch-cooldown triggers off scraped_at, so a truck
  // that never changes would stay permanently overdue and get re-scraped on every
  // run forever — the exact churn this rewrite exists to remove.
  //
  // The payload compare happens IN POSTGRES (`hist = $1::jsonb`), not in JS, and
  // that is not a style preference. hist is a jsonb column, and jsonb normalizes
  // object key order on storage (by key length, then bytewise). So the round-trip
  // NEVER reproduces the insertion order trimEvent emits: truck 21090 goes in as
  // ["type","poMsgDate","notes","poNumber"] and comes back as
  // ["type","notes","poNumber","poMsgDate"]. The first cut of this compared
  // JSON.stringify(prev.hist) === histJson and measured 0 of 60 non-empty rows
  // matching on prod — i.e. the no-op branch was unreachable for every truck that
  // had any history, `unchanged` read 0 forever, and imported_at moved on every
  // visit exactly as it did before the delta write existed. jsonb equality is
  // key-order independent by definition, so let the database do it.
  // NULL hist yields NULL, not true, so a null-payload row correctly falls
  // through to the full write.
  const cur = await db.execute(sql`
    SELECT (hist = ${histJson}::jsonb) AS hist_same,
           po_count, msg_count, shop_name, shop_phone, shop_address, shop_src
    FROM vrm_holman_portal_hist WHERE truck_no = ${caseKey}`);
  const prev = (cur.rows as any[])[0];
  if (prev) {
    // A false "changed" only costs one UPDATE we would otherwise have written
    // anyway, so err toward writing.
    const same = prev.hist_same === true
      && Number(prev.po_count ?? -1) === next.poCount
      && Number(prev.msg_count ?? -1) === next.msgCount
      && (prev.shop_name ?? null) === next.shopName
      && (prev.shop_phone ?? null) === next.shopPhone
      && (prev.shop_address ?? null) === next.shopAddress
      && (prev.shop_src ?? null) === next.shopSrc;
    if (same) {
      await db.execute(sql`UPDATE vrm_holman_portal_hist SET scraped_at = ${scrapedAt} WHERE truck_no = ${caseKey}`);
      return { changed: false, empty: events.length === 0 };
    }
  }
  await db.execute(sql`
    INSERT INTO vrm_holman_portal_hist (truck_no, hist, source, scraped_at, po_count, msg_count, shop_name, shop_phone, shop_address, shop_src)
    VALUES (${caseKey}, ${histJson}::jsonb, 'on_demand_scrape', ${scrapedAt}, ${next.poCount}, ${next.msgCount},
            ${next.shopName}, ${next.shopPhone}, ${next.shopAddress}, ${next.shopSrc})
    ON CONFLICT (truck_no) DO UPDATE SET
      hist=EXCLUDED.hist, source=EXCLUDED.source, scraped_at=EXCLUDED.scraped_at, po_count=EXCLUDED.po_count,
      msg_count=EXCLUDED.msg_count, shop_name=EXCLUDED.shop_name, shop_phone=EXCLUDED.shop_phone,
      shop_address=EXCLUDED.shop_address, shop_src=EXCLUDED.shop_src, imported_at=NOW()
  `);
  return { changed: true, empty: events.length === 0 };
}

export interface ScrapeReport {
  requested: number;
  targeted: number;
  skipped: number;
  /** portal content actually differed and was rewritten */
  stored: number;
  /** we looked, nothing differed — only scraped_at was bumped */
  unchanged: number;
  /** portal returned no history at all, and that is new information */
  empty: number;
  errors: number;
  scrapedAt: string;
}

/**
 * Scrape + store portal history for the given case_keys (5-padded truck nums).
 *
 * BEHAVIOUR FLIP (7/21): this used to default to "skip any truck we already
 * have a row for", which made sense when the only caller was a phone backfill.
 * It is now actively wrong — findScrapeTargets deliberately returns trucks that
 * DO have rows (that is the whole point of a delta layer), and the old default
 * would have silently skipped every one of them. Selection is the caller's job;
 * this function scrapes what it is handed. Pass onlyMissing:true for the legacy
 * never-seen-before backfill.
 */
export async function scrapeAndStore(
  caseKeys: string[],
  opts: {
    onlyMissing?: boolean;
    /** @deprecated legacy spelling of `!onlyMissing`, honoured for vrm-scrape.ts only. */
    force?: boolean;
  } = {},
): Promise<ScrapeReport> {
  // BACK-COMPAT for the repo-root script vrm-scrape.ts, which calls
  // scrapeAndStore(gaps, { force: false }). tsconfig.json includes only
  // client/src, shared and server, so tsc will NEVER warn that `force` stopped
  // meaning anything — the rename would have silently flipped that script from
  // "backfill trucks with no row" to "sweep all ~131 delta targets", ~45 minutes
  // of Chromium nobody asked for. force:false was the old spelling of today's
  // onlyMissing:true; honour it rather than drop it on the floor. Delete this
  // shim once vrm-scrape.ts is updated to say what it means.
  const onlyMissing = opts.onlyMissing ?? (opts.force === false);
  const scrapedAt = new Date().toISOString().slice(0, 10);
  const uniq = Array.from(new Set(caseKeys.map((k) => toDisplayNumber(k)).filter(Boolean)));
  let targets = uniq;
  if (onlyMissing && uniq.length) {
    const have = await db.execute(sql`SELECT truck_no FROM vrm_holman_portal_hist WHERE truck_no IN (${sql.join(uniq.map((v) => sql`${v}`), sql`, `)})`);
    const haveSet = new Set((have.rows as any[]).map((r) => r.truck_no));
    targets = uniq.filter((k) => !haveSet.has(k));
  }
  const skipped = uniq.length - targets.length;
  let stored = 0, unchanged = 0, empty = 0, errors = 0;
  for (let i = 0; i < targets.length; i += BATCH) {
    const batchKeys = targets.slice(i, i + BATCH);
    // Holman MTREACT wants the canonical (unpadded) truck number
    const results = await spawnScrape(batchKeys.map((k) => toCanonical(k)));
    for (const r of results) {
      const caseKey = toDisplayNumber(r.vehicle);
      if (r.error) { errors++; continue; }
      const out = await upsertTruck(caseKey, r.hist || [], scrapedAt);  // store even if empty (we tried)
      if (!out.changed) unchanged++;
      else if (out.empty) empty++;
      else stored++;
    }
  }
  return { requested: caseKeys.length, targeted: targets.length, skipped, stored, unchanged, empty, errors, scrapedAt };
}

/** Why a truck earned a browser session. Ordered by operational urgency. */
export type ScrapeReason =
  | "shop_mismatch_open"   // LUCA is dialling a shop the current PO superseded, on a live repair
  | "never_scraped_open"   // blind on an active repair
  | "po_newer_than_scrape" // the base layer learned something after we last looked
  | "shop_mismatch"        // superseded shop, but no open repair right now
  | "never_scraped"        // no portal row, no open repair
  | "stale_open";          // portal snapshot aged past the horizon on a relevant truck

export interface ScrapeTarget {
  truck: string;
  reason: ScrapeReason;
  priority: number;         // 1 = most urgent; matches the ScrapeReason order above
  openPoCount: number;
  scrapedAt: string | null; // null = never scraped
}

export interface ScrapeTargetSet {
  targets: ScrapeTarget[];
  /** how many qualified BEFORE the MAX_TARGETS_PER_RUN cut — so a caller can say
   * "we are working 150 of 220" instead of quietly under-reporting the backlog */
  totalFound: number;
  truncated: boolean;
  /** ALSO pre-LIMIT, so it sums to totalFound and never to targets.length. It is
   * computed in SQL over the whole qualifying set rather than tallied in JS from
   * the returned page: targets are priority-ordered, so a truncated run cuts the
   * lowest-priority reasons away ENTIRELY and a JS tally would report those tiers
   * as zero instead of as backlog. */
  byReason: Record<string, number>;
  /** what this run will actually work — targets.length, named so the route does
   * not have to explain the difference twice. */
  served: number;
}

/**
 * The delta-targeting query: which trucks are worth a Chromium session right now.
 *
 * Universe is unchanged from the old findScrapeGaps — every present rental truck,
 * PLUS the assigned trucks (renter_own_truck) of Declined/Auction cases, because
 * LUCA dials THOSE shops so their phone matters too.
 *
 * A truck is selected when ANY of these hold. Deliberately NOT "every truck": a
 * truck with no open repair and no disagreement tells us nothing a browser session
 * would improve, and the whole fleet is ~400 sessions we are not going to spend.
 *   1. no portal row at all                      — the old behaviour, kept
 *   2. an open qualifying repair PO whose po_date OR Holman upload_timestamp is
 *      newer than our last look. upload_timestamp is Holman's own clock, not our
 *      re-land clock (verified 7/21: zero po_history rows have it within 2h of
 *      ingested_at, and PO 119501663 on truck 21675 kept po_date 6/30 while its
 *      upload moved to 7/21) — so it moving means Holman genuinely touched that
 *      PO. It is the stronger of the two signals by an order of magnitude:
 *      po_date alone flags 5 trucks on prod, upload_timestamp flags 44.
 *   3. portal shop_name disagrees with the vendor on the current most-recent
 *      qualifying repair PO — LUCA is dialling a superseded shop. Rate-limited by
 *      MISMATCH_RECHECK_DAYS, see that constant.
 *   4. portal older than STALE_HORIZON_DAYS *and* the truck actually has an open
 *      repair. Cosmetic staleness on a quiet truck does not earn a session.
 *
 * OPEN-REPAIR TEST = THE RECONCILED STATUS, NOT THE RAW ETL ONE. This block
 * rebuilds read-repository.ts's po_eff (portal status wins when its observation
 * is newer than the PO's upload_timestamp) instead of reading po_status directly.
 * That matters, it is not tidiness: raw po_status is precisely the quantity the
 * 7/21 audit found wrong for 43 of 178 trucks, and it drives priority 1, priority
 * 2 and the whole stale_open trigger. Targeting on it would have spent browser
 * sessions re-confirming closures the portal snapshot on disk already proved, and
 * would have ranked "urgent" by a number the board no longer shows. Gating on the
 * reconciled count means "operationally relevant" here means the same thing the
 * board and the LUCA callable pool mean; callable is a strict subset (it also
 * needs a phone and a non-PENDED ticket), so this covers the callable pool
 * without reimplementing the callable predicate.
 *
 * Measured on prod 7/21: 170 trucks in this universe have a raw-ETL open repair,
 * 128 have a reconciled one, and the 43-truck difference is precisely the audited
 * cohort whose portal snapshot on disk already says PAID or VOID. Targeting on
 * the raw count put 32 of those in priority 1; it is now 7. Total targets fell
 * 131 -> 113, and none of the 18 dropped trucks lost a signal we did not already
 * hold the answer to.
 *
 * HAND-SYNC WARNING: portal_po / po_eff / shop_pick below are copies of
 * PORTAL_PO_OBS, PO_EFFECTIVE_CTE and SHOP_PICK_CTE in read-repository.ts, which
 * does not export them. If you change the reconciliation rule there, change it
 * here. The durable fix is for read-repository to export those CTEs — that is a
 * change in a file this module does not own.
 *
 * One deliberate divergence: newest_open_evidence uses GREATEST(po_date,
 * upload_timestamp) — the ETL clock ONLY — where read-repository's evidence_at
 * also folds in the portal observed_at. Folding it in here would be circular:
 * observed_at IS scraped_at, so every portal-matched open PO would report
 * evidence exactly as new as our last look and trigger 2 would arm on every run
 * forever. Trigger 2 asks "did the BASE layer learn something after we looked",
 * so it may only read base-layer clocks.
 */
export async function findScrapeTargets(opts: { limit?: number } = {}): Promise<ScrapeTargetSet> {
  const limit = opts.limit ?? MAX_TARGETS_PER_RUN;
  const res = await db.execute(sql`
    WITH universe AS (
      SELECT c.case_key AS truck
      FROM vrm_rental_operations_cases c
      WHERE c.present_in_latest = true
      UNION
      SELECT own.own_pad AS truck
      FROM vrm_rental_operations_cases c
      JOIN vrm_rental_identity_resolutions i ON i.case_key = c.case_key
      JOIN all_techs atr ON atr.employee_id = COALESCE(i.override_employee_id, i.resolved_employee_id)
      JOIN LATERAL (SELECT NULLIF(lpad(ltrim(regexp_replace(COALESCE(atr.truck_lu, atr.last_known_truck_lu), '[^0-9]', '', 'g'), '0'), 5, '0'), '00000') AS own_pad) own ON true
      WHERE c.present_in_latest = true
        AND (c.ams_status ILIKE '%declin%' OR c.ams_status ILIKE '%auction%')
        AND own.own_pad IS NOT NULL
    ),
    -- ── reconciled PO layer (mirror of read-repository.ts, see docblock) ──────
    portal_po AS (
      SELECT DISTINCT ON (h.truck_no, e->>'poNumber')
             h.truck_no,
             e->>'poNumber'                          AS po_number,
             upper(nullif(btrim(e->>'status'), ''))  AS portal_status,
             h.scraped_at::timestamptz               AS observed_at
      FROM vrm_holman_portal_hist h
      CROSS JOIN LATERAL jsonb_array_elements(h.hist) e
      WHERE e->>'type' = 'PO'
        AND nullif(btrim(e->>'poNumber'), '') IS NOT NULL
        AND e->>'poNumber' <> '0'
        AND nullif(btrim(e->>'status'), '') IS NOT NULL
      ORDER BY h.truck_no, e->>'poNumber', h.scraped_at DESC
    ),
    -- Joined to universe rather than scanned whole: this is ~400 trucks out of
    -- 13k PO rows, and the read model pays for the fleet-wide version already.
    po_eff AS (
      SELECT p.vehicle_number_padded AS truck, p.po_number, p.po_date,
             p.upload_timestamp, p.vendor_name,
             ${QUALIFYING_REPAIR_PO("p")} AS is_qualifying_repair,
             COALESCE(
               CASE WHEN pp.observed_at > p.upload_timestamp THEN pp.portal_status END,
               p.po_status
             ) AS eff_status
      FROM vrm_rental_operations_po_history p
      JOIN universe u ON u.truck = p.vehicle_number_padded
      LEFT JOIN portal_po pp
        ON pp.truck_no = p.vehicle_number_padded AND pp.po_number = p.po_number
    ),
    po_agg AS (
      SELECT q.truck,
             count(*) FILTER (WHERE q.is_qualifying_repair AND q.eff_status = 'APPROVED') AS open_po_count,
             -- ETL clocks only — see the divergence note in the docblock.
             max(GREATEST(q.po_date::timestamptz, q.upload_timestamp))
               FILTER (WHERE q.is_qualifying_repair AND q.eff_status = 'APPROVED') AS newest_open_evidence
      FROM po_eff q
      GROUP BY 1
    ),
    shop_pick AS (
      SELECT DISTINCT ON (q.truck) q.truck, q.vendor_name
      FROM po_eff q
      WHERE q.is_qualifying_repair
      ORDER BY q.truck, (q.eff_status = 'APPROVED') DESC, q.po_date DESC NULLS LAST, q.po_number DESC
    ),
    base AS (
      -- A portal row with a NULL scraped_at counts as never_scraped, not as a
      -- scraped truck: every other trigger below is anchored on scraped_at, so
      -- three-valued logic would otherwise make such a truck permanently
      -- untargetable — the one failure mode this rewrite must not reintroduce.
      SELECT u.truck,
             (p.truck_no IS NULL OR p.scraped_at IS NULL) AS never_scraped,
             p.scraped_at,
             p.shop_name AS portal_shop,
             COALESCE(a.open_po_count, 0) AS open_po_count,
             a.newest_open_evidence,
             s.vendor_name AS etl_shop
      FROM universe u
      LEFT JOIN vrm_holman_portal_hist p ON p.truck_no = u.truck
      LEFT JOIN po_agg a   ON a.truck = u.truck
      LEFT JOIN shop_pick s ON s.truck = u.truck
    ),
    flagged AS (
      SELECT b.*,
        -- The "+ 1" is load-bearing and it is a deliberate trade, not a fudge.
        -- scraped_at is a DATE, so we do not know WHAT HOUR of that day we
        -- looked; ::timestamptz lands it on midnight. Comparing against midnight
        -- would re-arm a truck on evidence that Holman uploaded EARLIER THE SAME
        -- DAY we scraped — evidence we already have — and since scraped_at never
        -- moves past today, that truck would re-arm on every single run forever.
        -- That is the same permanent-churn failure MISMATCH_RECHECK_DAYS exists
        -- to stop. So the boundary is "dated the day AFTER our scrape or later".
        -- The cost, stated plainly: evidence landing later on the scrape day is
        -- skipped PERMANENTLY, not deferred. Backstopped only by stale_open at
        -- STALE_HORIZON_DAYS. The real fix is a scrape TIMESTAMP column instead
        -- of a date; that is a schema change this module does not own.
        --
        -- >= NOT >. This one bit was wrong in the first cut and it cost two
        -- trucks. po_date is a DATE, so it casts to midnight — exactly the
        -- boundary value — and a strict greater-than therefore threw away a whole extra
        -- day of evidence on top of the intended one. Measured on prod 7/21,
        -- po_date-only: 5 trucks with the shipped >=, 3 with the old >, 5 with
        -- no offset at all. So >= restores the audited 5 while still refusing
        -- same-scrape-day evidence, which is the behaviour we actually wanted.
        -- (The combined predicate is 44 either way — upload_timestamp is a real
        -- timestamp and never sits on the boundary.)
        (NOT b.never_scraped
          AND b.newest_open_evidence IS NOT NULL
          AND b.newest_open_evidence >= (b.scraped_at + 1)::timestamptz) AS po_newer,
        (NOT b.never_scraped
          AND b.portal_shop IS NOT NULL AND b.etl_shop IS NOT NULL
          AND ${NORM_VENDOR(sql`b.portal_shop`)} <> ${NORM_VENDOR(sql`b.etl_shop`)}
          AND b.scraped_at <= (CURRENT_DATE - ${MISMATCH_RECHECK_DAYS}::int)) AS shop_mismatch,
        (NOT b.never_scraped
          AND b.scraped_at < (CURRENT_DATE - ${STALE_HORIZON_DAYS}::int)
          AND b.open_po_count > 0) AS stale_open
      FROM base b
    ),
    -- MATERIALIZED so the two roll-up subqueries below scan the qualifying set
    -- once between them instead of re-planning flagged three times.
    scored AS MATERIALIZED (
      SELECT f.truck, f.open_po_count, f.scraped_at, f.newest_open_evidence,
        CASE
          WHEN f.shop_mismatch AND f.open_po_count > 0 THEN 1
          WHEN f.never_scraped AND f.open_po_count > 0 THEN 2
          WHEN f.po_newer                              THEN 3
          WHEN f.shop_mismatch                         THEN 4
          WHEN f.never_scraped                         THEN 5
          ELSE 6
        END AS priority,
        CASE
          WHEN f.shop_mismatch AND f.open_po_count > 0 THEN 'shop_mismatch_open'
          WHEN f.never_scraped AND f.open_po_count > 0 THEN 'never_scraped_open'
          WHEN f.po_newer                              THEN 'po_newer_than_scrape'
          WHEN f.shop_mismatch                         THEN 'shop_mismatch'
          WHEN f.never_scraped                         THEN 'never_scraped'
          ELSE 'stale_open'
        END AS reason
      FROM flagged f
      WHERE f.never_scraped OR f.po_newer OR f.shop_mismatch OR f.stale_open
    )
    SELECT s.truck, s.open_po_count, to_char(s.scraped_at, 'YYYY-MM-DD') AS scraped_at,
      s.priority, s.reason,
      -- Both roll-ups are uncorrelated scalar subqueries over scored, so
      -- Postgres runs them once as InitPlans, BEFORE the LIMIT. That is the whole
      -- point: the per-reason tally must describe the backlog, not the page. A JS
      -- tally over the returned rows would report 0 for any reason tier the LIMIT
      -- cut away entirely — and because ORDER BY is priority-first, the tiers it
      -- cuts are always whole ones.
      (SELECT count(*) FROM scored) AS total_found,
      (SELECT jsonb_object_agg(t.reason, t.n)
         FROM (SELECT reason, count(*) AS n FROM scored GROUP BY reason) t) AS reason_totals
    FROM scored s
    -- Priority first because the sweep is slow and routinely cut short; within a
    -- tier, freshest PO evidence first (a repair that moved yesterday beats one
    -- that moved in March). never_scraped rows have no evidence and sort last.
    ORDER BY s.priority, s.newest_open_evidence DESC NULLS LAST, s.truck
    LIMIT ${limit}
  `);
  const rows = res.rows as any[];
  const targets: ScrapeTarget[] = rows.map((r) => ({
    truck: String(r.truck),
    reason: r.reason as ScrapeReason,
    priority: Number(r.priority),
    openPoCount: Number(r.open_po_count || 0),
    scrapedAt: r.scraped_at ?? null,
  }));
  const totalFound = rows.length ? Number(rows[0].total_found) : 0;
  const rawTotals = (rows.length ? rows[0].reason_totals : null) ?? {};
  const byReason = Object.fromEntries(
    Object.entries(rawTotals as Record<string, any>).map(([k, v]) => [k, Number(v)]),
  );
  return { targets, totalFound, truncated: totalFound > targets.length, byReason, served: targets.length };
}

/** Truck numbers only, for callers that just want the list. Thin wrapper over
 * findScrapeTargets — the name predates the delta rewrite and now means "trucks
 * whose portal snapshot is missing OR suspect", not "trucks with no row". */
export async function findScrapeGaps(opts: { limit?: number } = {}): Promise<string[]> {
  return (await findScrapeTargets(opts)).targets.map((t) => t.truck);
}
