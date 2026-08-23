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
import { classifyPoVendor, isNeverShopVendor, type PoClassLine } from "./vendor-class";
import { maybeExtractShopFromComments } from "./shop-comment-extract";
// THE reconciliation, imported — never re-typed here. See the note above
// findScrapeTargets for what the previous hand-copy cost.
import { poEffectiveCte, SHOP_PICK_CTE, cleanPhone, OWN_TRUCK_LATERALS } from "./read-repository";

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

// Vendor names are compared case- and punctuation-insensitively: the portal
// renders "BIG-O TIRES #7042" where the ETL lands "BIG O TIRES 7042", and a
// scrape triggered by that would be pure waste.
const NORM_VENDOR = (col: any) => sql`upper(regexp_replace(${col}, '[^A-Za-z0-9]', '', 'g'))`;

// Which trucks the scraper is even allowed to consider: every present rental
// truck, PLUS the assigned trucks (renter_own_truck) of Declined/Auction cases,
// because LUCA dials THOSE shops so their phone matters too. ~400 trucks.
//
// One definition shared by findScrapeTargets and findScrapeGaps. They ask
// different questions of it (is this truck suspect / has this truck ever been
// looked at) and the two must not drift apart on WHICH trucks are in scope, or
// the never-scraped backfill would quietly stop covering trucks the delta sweep
// still targets.
const UNIVERSE_CTE = sql`
  universe AS (
    SELECT c.case_key AS truck
    FROM vrm_rental_operations_cases c
    WHERE c.present_in_latest = true
    UNION
    SELECT ownp.own_pad AS truck
    FROM vrm_rental_operations_cases c
    JOIN vrm_rental_identity_resolutions i ON i.case_key = c.case_key
    JOIN all_techs atr ON atr.employee_id = COALESCE(i.override_employee_id, i.resolved_employee_id)
    ${OWN_TRUCK_LATERALS}
    WHERE c.present_in_latest = true
      AND (c.ams_status ILIKE '%declin%' OR c.ams_status ILIKE '%auction%')
      AND ownp.own_pad IS NOT NULL
  )
`;

const KEEP_PO = ["type","poNumber","eventId","status","vendorName","vendorType","vendorTypeDescription","poAmount","repairDate","poMsgDate","meter","billPaidDate","createdBy","invoiceNo","vendorAddress","vendorPhone","estimatedReadyDate","workCompletedDate","vehicleDowntimeStartDate","vehicleDowntimeEndDate","notes","poNotes","lineItems","isDeclinedPo","rentalRequestExists","openRentalRequestWindow"];
const KEEP_MSG = ["type","poMsgDate","notes","poNumber"];
function trimEvent(e: any) {
  const keep = e.type === "MSG" ? KEEP_MSG : KEEP_PO;
  const o: any = {};
  for (const k of keep) if (e[k] !== undefined && e[k] !== null && e[k] !== "") o[k] = e[k];
  return o;
}
// Shop selection uses the SAME classifier as the ETL land (Tyler's PO rule):
// tow/roadside vendors are skipped UNLESS parts and/or labor are on the PO —
// PLUS the 2026-08-05 hard rule: a towing/recovery/roadside/glass NAME may
// never be picked as the shop at all, parts/labor or not (isNeverShopVendor,
// same test the shop_pick/shop_strict CTEs apply on the ETL side).
// The portal's lineItems carry `typeDesc` (PARTS | LABOR | RENTAL | ROADSIDE | …).
export const isRealShopPo = (p: any) =>
  !isNeverShopVendor(p?.vendorName)
  && classifyPoVendor({ vendorName: p?.vendorName ?? null, lines: (p?.lineItems as PoClassLine[]) ?? null }).vendorType === "repair";
const isRealShop = isRealShopPo;
function parseDate(s: any): number { const m = String(s ?? "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? new Date(+m[3], +m[1] - 1, +m[2]).getTime() : 0; }

import type { RentalRequestResult } from "./holman-svc-scrape";

/**
 * Read the "View Rental Request" page(s) for a truck, in the isolated worker.
 *
 * Same containment contract as spawnScrape: Chromium never runs in the Express
 * process. Payload goes over argv base64-encoded because the URLs carry an
 * encrypted `key` query param with characters a bare shell arg mangles.
 */
export function spawnRentalRequests(items: { vehicle: string; url: string }[]): Promise<RentalRequestResult[]> {
  return new Promise((resolve) => {
    const cwd = process.cwd();
    const tsxBin = path.join(cwd, "node_modules/.bin/tsx");
    const workerTs = "server/vrm/rental-operations/holman-svc-scrape-worker.ts";
    const workerJs = "dist/vrm/rental-operations/holman-svc-scrape-worker.js";
    const payload = Buffer.from(JSON.stringify(items), "utf8").toString("base64");
    const fail = (msg: string) => items.map((i) => ({ ...i, renterName: null, fields: {}, text: null, screenshot: null, error: msg }));
    let cmd: string, args: string[];
    if (existsSync(path.join(cwd, workerJs))) { cmd = process.execPath; args = [workerJs, "--rental-requests", payload]; }
    else if (existsSync(tsxBin)) { cmd = tsxBin; args = [workerTs, "--rental-requests", payload]; }
    else { return resolve(fail("scrape worker unavailable: run `npm run build:workers`")); }
    let child: ReturnType<typeof spawn>;
    try { child = spawn(cmd, args, { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"], env: process.env }); }
    catch (e: any) { return resolve(fail(`spawn failed: ${e?.message}`)); }
    let out = "", settled = false;
    const done = (r: RentalRequestResult[]) => { if (!settled) { settled = true; clearTimeout(t); resolve(r); } };
    const t = setTimeout(() => { try { process.kill(-(child.pid as number), "SIGKILL"); } catch {} done(fail("rental request worker timeout")); }, WORKER_TIMEOUT_MS);
    child.stdout!.on("data", (d) => { out += d.toString(); });
    child.stderr!.on("data", (d) => process.stderr.write(d));
    child.on("error", (e) => done(fail(`worker error: ${e.message}`)));
    child.on("close", () => {
      const line = out.trim().split("\n").filter(Boolean).pop() || "";
      try { const j = JSON.parse(line); done(j.ok ? j.results : fail(j.error || "worker failed")); }
      catch { done(fail("unparseable worker output")); }
    });
  });
}

/**
 * The rental-request deep links Holman already handed us on the last scrape.
 * They live per-PO inside the stored portal blob as openRentalRequestWindow and
 * are only present where rentalRequestExists is true. Newest PO first, because
 * the current rental is the one being asked about.
 */
export async function rentalRequestLinksFor(caseKey: string): Promise<{ poNumber: string | null; url: string; poDate: string | null }[]> {
  const truck = toDisplayNumber(caseKey);
  const res = await db.execute(sql`SELECT hist FROM vrm_holman_portal_hist WHERE truck_no = ${truck} LIMIT 1`);
  const hist = (res.rows?.[0] as any)?.hist;
  if (!hist) return [];
  const arr: any[] = Array.isArray(hist) ? hist : (Array.isArray(hist?.events) ? hist.events : []);
  const out: { poNumber: string | null; url: string; poDate: string | null }[] = [];
  const walk = (o: any) => {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) { o.forEach(walk); return; }
    const url = o.openRentalRequestWindow;
    if (typeof url === "string" && /RentalRequest\.aspx/i.test(url) && o.rentalRequestExists) {
      out.push({ poNumber: o.poNumber ?? null, url, poDate: o.repairDate ?? o.poMsgDate ?? null });
    }
    Object.values(o).forEach(walk);
  };
  walk(arr);
  const seen = new Set<string>();
  return out.filter((r) => (seen.has(r.url) ? false : (seen.add(r.url), true)))
            .sort((a, b) => String(b.poDate || "").localeCompare(String(a.poDate || "")));
}

function spawnScrape(vehicles: string[]): Promise<SvcHistoryResult[]> {
  return new Promise((resolve) => {
    const cwd = process.cwd();
    const tsxBin = path.join(cwd, "node_modules/.bin/tsx");
    const workerTs = "server/vrm/rental-operations/holman-svc-scrape-worker.ts";
    const workerJs = "dist/vrm/rental-operations/holman-svc-scrape-worker.js";
    let cmd: string, args: string[];
    if (existsSync(path.join(cwd, workerJs))) { cmd = process.execPath; args = [workerJs, vehicles.join(",")]; }
    else if (existsSync(tsxBin)) { cmd = tsxBin; args = [workerTs, vehicles.join(",")]; }
    else {
      // DEPLOYMENT MISCONFIGURATION, not an empty portal. `npm run build:workers`
      // did not run, so there is no compiled worker, and tsx is a devDependency a
      // production install prunes — there is nothing left to spawn. Before 7/22
      // this fell through to bare "npx", which fails in prod and returned the same
      // shape as "we looked and found nothing". Every truck came back
      // error:"worker failed", the report said 0 stored, and the UI called it a
      // clean run. Prod never scraped once and nothing ever said so. Name it.
      const msg = `scrape worker unavailable: neither ${workerJs} (run \`npm run build:workers\`) nor ${tsxBin} exists`;
      console.error(`[SvcScrape] CONFIG ERROR — ${msg}`);
      return resolve(vehicles.map((v) => ({ vehicle: v, hist: null, error: msg })));
    }
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

/** THE shop pick over a (trimmed) event list. upsertTruck runs it on fresh
 * portal payloads; the lock-expiry reset (expireStaleShopPhoneLocks) runs it on
 * the STORED hist so an expired lock reverts to exactly what a scrape of that
 * same history would have written — one pick, two callers, zero drift. */
function pickShopFromEvents(events: any[]): {
  poCount: number; msgCount: number;
  shopName: string | null; shopPhone: string | null; shopAddress: string | null; shopSrc: string | null;
} {
  // MOST RECENT first (Tyler: "pulls the most recent repair shop PO"), with a
  // deterministic poNumber tiebreak so equal repair dates never order randomly.
  const pos = events.filter((e) => e.type === "PO" && e.poNumber && e.poNumber !== "0")
    .sort((a, b) => (parseDate(b.repairDate) - parseDate(a.repairDate))
      || String(b.poNumber ?? "").localeCompare(String(a.poNumber ?? ""), undefined, { numeric: true }));
  const msgCount = events.filter((e) => e.type === "MSG").length;
  const shopPos = pos.filter(isRealShop);
  // Tyler 2026-08-05: "We go by the date the last shop was at, even if there's
  // a previous PO that still says approved." The old open-PO-first preference
  // is retired — most recent eligible shop PO wins, full stop (same ordering
  // the shop_pick/shop_strict CTEs use on the ETL side).
  const pick = shopPos[0] || null;
  const pickOpen = !!pick && String(pick.status || "").toUpperCase() === "APPROVED";
  return {
    poCount: pos.length,
    msgCount,
    shopName: (pick?.vendorName ?? null) as string | null,
    shopPhone: (pick?.vendorPhone ?? null) as string | null,
    shopAddress: (pick?.vendorAddress ?? null) as string | null,
    shopSrc: (pickOpen ? "open PO" : (pick ? "last PO" : null)) as string | null,
  };
}

/** A phone is USABLE when it cleans to a real 10-digit number — repeated-digit
 * fillers (5555555555, 2222222222…) don't count. Same rule as the /shop-phone
 * route's validation and the LUCA feed's cleanPhone. The sticky-phone guard in
 * upsertTruck keys on this. */
export function isUsablePhone(v: unknown): boolean {
  if (v == null) return false;
  let d = String(v).replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length === 10 && !/^(\d)\1{9}$/.test(d);
}

/** What a single truck's write actually did. `unchanged` means we looked and the
 * portal said exactly what we already had stored. */
type UpsertOutcome = { changed: boolean; empty: boolean };

// Exported for tests: the manual-phone lock guard below is the one behavior
// that MUST survive refactors, and it is only exercisable through this path.
export async function upsertTruck(caseKey: string, rawHist: any[], scrapedAt: string): Promise<UpsertOutcome> {
  const events = (rawHist || []).map(trimEvent);
  const histJson = JSON.stringify(events);
  const next = pickShopFromEvents(events);

  // LLM COMMENT FALLBACK (Tyler 8/6): when the headers cannot name a callable
  // shop — nothing eligible, or the newest PO is a payment instrument (Single
  // Use CC) that superseded the last shop PO — ask Bedrock to read the PO
  // notes / message trail for where the van actually is. Evidence-hash cached
  // and rate-capped inside; never throws; a null keeps the deterministic
  // answer. Runs BEFORE the lock/sticky guards below so an operator lock
  // still beats the model.
  let phoneFromLlm = false;
  const llmShop = await maybeExtractShopFromComments(caseKey, events, { shopName: next.shopName });
  if (llmShop) {
    next.shopName = llmShop.shopName;
    next.shopPhone = llmShop.shopPhone;
    next.shopAddress = llmShop.shopAddress;
    next.shopSrc = "llm_comments";
    phoneFromLlm = true;
  }

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
           po_count, msg_count, shop_name, shop_phone, shop_address, shop_src,
           shop_phone_locked, shop_phone_source
    FROM vrm_holman_portal_hist WHERE truck_no = ${caseKey}`);
  const prev = (cur.rows as any[])[0];
  // MANUAL PHONE LOCK (Tyler 8/3): an operator-entered phone with the lock set
  // is preserved verbatim through every scrape — the portal's own number still
  // lands inside hist (KEEP_PO keeps vendorPhone per PO), so nothing is lost,
  // but the picked shop_phone column belongs to the human until they unlock it
  // — or until the lock EXPIRES: expireStaleShopPhoneLocks (below) clears locks
  // whose case has been off the board for a week, so a future rental for the
  // same truck starts fresh instead of inheriting a months-old number.
  // Overriding `next` BEFORE the compare keeps the no-op branch honest: a
  // locked phone can never make an otherwise-identical revisit look "changed".
  const phoneLocked = prev?.shop_phone_locked === true;
  if (phoneLocked) next.shopPhone = (prev.shop_phone ?? null) as string | null;
  // STICKY VALID PHONE (Tyler 8/5): once a USABLE number is stored — scraped or
  // manually entered — a later scrape may only replace it with ANOTHER usable
  // number, never wipe it with nothing or repeated-digit filler. This is what
  // keeps numbers accurate without re-running the scraper daily: a good number
  // stays until better information (a new valid portal number, a manual edit,
  // or the episode-end lock expiry) replaces it. Keeping prev's value also
  // keeps prev's provenance via the source-follows-value rule below.
  else if (isUsablePhone(prev?.shop_phone) && !isUsablePhone(next.shopPhone)) {
    next.shopPhone = (prev!.shop_phone ?? null) as string | null;
  }
  // Provenance follows the value: 'manual' survives while locked (or while an
  // unlocked manual number happens to still match); the moment an UNLOCKED
  // value is genuinely replaced by portal content it becomes 'scrape'.
  const nextPhoneSource: string | null = phoneLocked
    ? (prev?.shop_phone_source ?? "manual")
    : (prev && (prev.shop_phone ?? null) === next.shopPhone
        ? (prev.shop_phone_source ?? null)
        : (phoneFromLlm ? "llm_comments" : "scrape"));
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
  // shop_phone_locked / edited_by / edited_at are deliberately NOT in this SET:
  // the lock and its audit trail belong to the operator and outlive scrapes.
  await db.execute(sql`
    INSERT INTO vrm_holman_portal_hist (truck_no, hist, source, scraped_at, po_count, msg_count, shop_name, shop_phone, shop_address, shop_src, shop_phone_source)
    VALUES (${caseKey}, ${histJson}::jsonb, 'on_demand_scrape', ${scrapedAt}, ${next.poCount}, ${next.msgCount},
            ${next.shopName}, ${next.shopPhone}, ${next.shopAddress}, ${next.shopSrc}, ${nextPhoneSource})
    ON CONFLICT (truck_no) DO UPDATE SET
      hist=EXCLUDED.hist, source=EXCLUDED.source, scraped_at=EXCLUDED.scraped_at, po_count=EXCLUDED.po_count,
      msg_count=EXCLUDED.msg_count, shop_name=EXCLUDED.shop_name, shop_phone=EXCLUDED.shop_phone,
      shop_address=EXCLUDED.shop_address, shop_src=EXCLUDED.shop_src, shop_phone_source=EXCLUDED.shop_phone_source,
      imported_at=NOW()
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
 * THE RECONCILIATION IS IMPORTED, NOT COPIED (7/21, integration gate). This
 * function used to re-type portal_po / po_eff / shop_pick because
 * read-repository.ts did not export them. It now does, so we call
 * poEffectiveCte({scopeJoin}) and SHOP_PICK_CTE instead. That is not tidiness —
 * the copy drifted twice inside a week and each drift was a real defect on this
 * path only: it had no PORTAL_STATUS_ALLOWED filter (so DIRECT and any other
 * unknown portal token could override an ETL status here while the board
 * refused it), and no jsonb_typeof(h.hist)='array' guard (so a single malformed
 * hist row would 500 the sweep and the scrape-targets endpoint while the board
 * stayed up). Both are now inherited and cannot be dropped by editing this file.
 * If targeting needs a variant of the reconciliation, add a PARAMETER to
 * poEffectiveCte — do not fork it back out.
 *
 * The scopeJoin narrows po_eff to this ~400-truck universe out of 13k PO rows.
 * It may narrow the TRUCK set and nothing else; a status or vendor filter there
 * would redefine eff_status and put us straight back into two definitions.
 *
 * One deliberate divergence, which is why po_agg below is LOCAL and NOT
 * read-repository's exported PO_AGG_CTE: newest_open_evidence uses
 * GREATEST(po_date, upload_timestamp) — the ETL clock ONLY — where
 * PO_AGG_CTE's evidence columns also fold in po_eff.portal_observed_at.
 * Folding it in here would be circular: observed_at IS scraped_at, so every
 * portal-matched open PO would report evidence exactly as new as our last look
 * and trigger 2 would arm on every run forever. Trigger 2 asks "did the BASE
 * layer learn something after we looked", so it may only read base-layer clocks.
 * read-repository's PO_AGG_CTE docblock carries the same warning from its side.
 */
export async function findScrapeTargets(opts: { limit?: number } = {}): Promise<ScrapeTargetSet> {
  const limit = opts.limit ?? MAX_TARGETS_PER_RUN;
  const res = await db.execute(sql`
    WITH ${UNIVERSE_CTE},
    -- ── THE reconciliation, imported from read-repository.ts ─────────────────
    -- Emits portal_po + po_eff, scoped to universe so this scans ~400 trucks
    -- of the 13k PO rows instead of the fleet the read model already pays for.
    -- The allow-list and the jsonb array guard ride along inside the fragment.
    ${poEffectiveCte({ scopeJoin: sql`JOIN universe u ON u.truck = p.vehicle_number_padded` })},
    -- LOCAL on purpose, do not swap in read-repository's PO_AGG_CTE: the
    -- evidence clock here must exclude the portal observation. See docblock.
    po_agg AS (
      SELECT q.vehicle_number_padded AS truck,
             count(*) FILTER (WHERE q.is_qualifying_repair AND q.eff_status = 'APPROVED') AS open_po_count,
             -- ETL clocks only — see the divergence note in the docblock.
             max(GREATEST(q.po_date::timestamptz, q.upload_timestamp))
               FILTER (WHERE q.is_qualifying_repair AND q.eff_status = 'APPROVED') AS newest_open_evidence
      FROM po_eff q
      GROUP BY 1
    ),
    -- Imported too. Targeting only reads vendor_name off it, but the ORDERING is
    -- the reconciliation's (APPROVED-first, then date) and that is what decides
    -- which shop counts as "the current one" for the mismatch trigger — so it
    -- has to be the same pick the board and LUCA make, not a look-alike.
    ${SHOP_PICK_CTE},
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

/**
 * Trucks in the universe we have NEVER looked at — no portal row, or a row with
 * no scraped_at. The original meaning of "gap", restored.
 *
 * NOT a wrapper over findScrapeTargets, and that is the whole point (integration
 * gate, 7/21). The delta rewrite made this a thin `.targets.map(t => t.truck)`,
 * which silently changed what the one caller gets. Repo-root vrm-scrape.ts does
 * `findScrapeGaps()` then `scrapeAndStore(gaps, { force: false })`, and force:false
 * means onlyMissing — scrapeAndStore drops every truck that already has a row. So
 * the wrapper handed it 113 trucks (measured on prod), 96 of which it immediately
 * discarded, and because findScrapeTargets is capped at MAX_TARGETS_PER_RUN=150
 * and ordered by priority with never_scraped LAST at priority 5, a big enough
 * mismatch backlog would truncate the never-scraped tier away ENTIRELY and the
 * backfill script would scrape nothing at all while reporting a healthy count.
 * Silent, and it fails in exactly the situation you built the script for.
 *
 * So this asks the question the caller actually has: which trucks have no
 * snapshot. No priority ordering to truncate, no MAX_TARGETS_PER_RUN — the set is
 * bounded by the universe (~400) and shrinks to zero as the backfill lands.
 * `limit` is honoured if a caller passes one, but there is no default cap.
 *
 * NULL scraped_at counts as never-scraped here for the same reason it does in
 * findScrapeTargets: every downstream freshness test is anchored on that column,
 * so such a row is not a snapshot. scrapeAndStore's onlyMissing filter keys off
 * ROW EXISTENCE, not scraped_at, so it will still skip that narrow case — the
 * truck is caught by findScrapeTargets' never_scraped trigger instead.
 */
export async function findScrapeGaps(opts: { limit?: number } = {}): Promise<string[]> {
  const res = await db.execute(sql`
    WITH ${UNIVERSE_CTE}
    SELECT u.truck
    FROM universe u
    LEFT JOIN vrm_holman_portal_hist p ON p.truck_no = u.truck
    WHERE p.truck_no IS NULL OR p.scraped_at IS NULL
    ORDER BY u.truck
    ${opts.limit ? sql`LIMIT ${opts.limit}` : sql.empty()}
  `);
  return (res.rows as any[]).map((r) => String(r.truck));
}

/**
 * Operator-entered shop phone (Tyler 8/3): write the number the human gave us
 * into the SAME column every consumer reads (board grid, drawer, CSV exports,
 * LUCA feed + dispatch), with `locked` deciding whether future scrapes may
 * replace it. Lives in this file because this file owns vrm_holman_portal_hist
 * write semantics — upsertTruck above is the ONLY other writer, and its lock
 * handling and this function must stay in sync.
 *
 * If the truck has never been scraped, the row is created with hist=[] and
 * scraped_at NULL — deliberately: NULL scraped_at keeps the truck in
 * findScrapeTargets' never_scraped tier, so the sweep still fills in its PO
 * history later (without touching a locked phone).
 *
 * `phone` must arrive already validated (10 bare digits or null to clear);
 * the route owns user-input validation, this owns the write.
 *
 * Locks are episode-scoped, not eternal: expireStaleShopPhoneLocks (below)
 * auto-clears a lock once its case has been off the board for a week.
 */
export async function setShopPhone(opts: {
  truck: string;
  phone: string | null;
  locked: boolean;
  actor: string;
}): Promise<{ truck: string; phone: string | null; locked: boolean; previousPhone: string | null; previousLocked: boolean; created: boolean }> {
  const truckNo = toDisplayNumber(opts.truck);
  if (!truckNo) throw new Error(`invalid truck number: ${JSON.stringify(opts.truck)}`);
  const prevRes = await db.execute(sql`
    SELECT shop_phone, shop_phone_locked FROM vrm_holman_portal_hist WHERE truck_no = ${truckNo}`);
  const prev = (prevRes.rows as any[])[0] ?? null;
  await db.execute(sql`
    INSERT INTO vrm_holman_portal_hist
      (truck_no, hist, source, scraped_at, po_count, msg_count,
       shop_phone, shop_phone_locked, shop_phone_source, shop_phone_edited_by, shop_phone_edited_at)
    VALUES (${truckNo}, '[]'::jsonb, 'manual', NULL, 0, 0,
            ${opts.phone}, ${opts.locked}, 'manual', ${opts.actor}, NOW())
    ON CONFLICT (truck_no) DO UPDATE SET
      shop_phone = ${opts.phone}, shop_phone_locked = ${opts.locked},
      shop_phone_source = 'manual', shop_phone_edited_by = ${opts.actor}, shop_phone_edited_at = NOW()
  `);
  return {
    truck: truckNo, phone: opts.phone, locked: opts.locked,
    previousPhone: prev?.shop_phone ?? null,
    previousLocked: prev?.shop_phone_locked === true,
    created: !prev,
  };
}

/**
 * Manual shop-NAME override (queue popout panel, 2026-08-05). Unlike the phone
 * — where scrapes and the operator write the SAME column and `locked` referees
 * — the reconciled shop name is derived per-read from PO history (shop_pick),
 * so the manual name lives in its own column and wins by PRESENCE: readers
 * COALESCE(shop_name_override, <pick>). Scrapes never touch it, so there is no
 * separate locked flag; it expires on the same episode-scoped clock as phone
 * locks (expireStaleShopPhoneLocks below).
 *
 * `name` must arrive already validated (trimmed, non-empty, length-capped) or
 * null to clear; the route owns user-input validation, this owns the write.
 */
export async function setShopName(opts: {
  truck: string;
  name: string | null;
  actor: string;
}): Promise<{ truck: string; name: string | null; previousName: string | null; created: boolean }> {
  const truckNo = toDisplayNumber(opts.truck);
  if (!truckNo) throw new Error(`invalid truck number: ${JSON.stringify(opts.truck)}`);
  const prevRes = await db.execute(sql`
    SELECT shop_name_override FROM vrm_holman_portal_hist WHERE truck_no = ${truckNo}`);
  const prev = (prevRes.rows as any[])[0] ?? null;
  await db.execute(sql`
    INSERT INTO vrm_holman_portal_hist
      (truck_no, hist, source, scraped_at, po_count, msg_count,
       shop_name_override, shop_name_override_by, shop_name_override_at)
    VALUES (${truckNo}, '[]'::jsonb, 'manual', NULL, 0, 0,
            ${opts.name}, ${opts.actor}, NOW())
    ON CONFLICT (truck_no) DO UPDATE SET
      shop_name_override = ${opts.name},
      shop_name_override_by = ${opts.actor}, shop_name_override_at = NOW()
  `);
  return {
    truck: truckNo, name: opts.name,
    previousName: prev?.shop_name_override ?? null,
    created: !prev,
  };
}

/**
 * Atomic LUCA shop-contact writer (POST /luca/shop-contact). The route's
 * decision table runs on a snapshot read, so an operator could save a locked
 * manual number in the gap between that read and the write — and the central
 * guarantee is "LUCA never overwrites a human". This function closes the race:
 * it takes the portal-hist row lock (FOR UPDATE) and RE-CHECKS the guard
 * predicates under that lock before writing, all in one transaction (name
 * override + phone land together or not at all).
 *
 * Accepted LUCA contacts are ALWAYS stored locked (code-review 2026-08-12):
 * an unlocked luca-source number is invisible to the feed's precedence chain
 * (it only surfaces via the portal vendor-name match, which an override name
 * defeats) — persisting a contact the feed won't return breaks the sync
 * contract. Locks stay episode-scoped via expireStaleShopPhoneLocks.
 */
export async function applyLucaShopContact(opts: {
  truck: string;
  /** Already cleaned 10-digit phone (route runs cleanPhone before calling). */
  phone: string;
  /** Set ONLY for the no-pick case: stores the name override alongside. */
  shopName?: string | null;
  actor: string;
}): Promise<
  | { applied: true; previousPhone: string | null; previousLocked: boolean; previousName: string | null }
  | { applied: false; reason: "manual_lock" | "name_override_conflict"; currentPhone: string | null; currentName: string | null }
> {
  const truckNo = toDisplayNumber(opts.truck);
  if (!truckNo) throw new Error(`invalid truck number: ${JSON.stringify(opts.truck)}`);
  return await db.transaction(async (tx) => {
    // Materialize the row so FOR UPDATE has something to lock (first contact
    // for a never-scraped truck).
    await tx.execute(sql`
      INSERT INTO vrm_holman_portal_hist (truck_no, hist, source, scraped_at, po_count, msg_count)
      VALUES (${truckNo}, '[]'::jsonb, 'manual', NULL, 0, 0)
      ON CONFLICT (truck_no) DO NOTHING`);
    const cur = await tx.execute(sql`
      SELECT shop_phone, shop_phone_locked, shop_phone_source, shop_name_override
      FROM vrm_holman_portal_hist WHERE truck_no = ${truckNo} FOR UPDATE`);
    const c = (cur.rows as any[])[0] ?? {};
    const storedPhone = cleanPhone(c.shop_phone);
    // Re-check under the row lock: a human's locked number (any non-luca
    // source, incl. legacy null stamps) never falls to LUCA — unless LUCA is
    // re-sending the very same digits (idempotent retries stay 200).
    if (c.shop_phone_locked === true && c.shop_phone_source !== "luca" && storedPhone !== opts.phone) {
      return { applied: false as const, reason: "manual_lock" as const, currentPhone: storedPhone, currentName: c.shop_name_override ?? null };
    }
    if (opts.shopName != null) {
      // No-pick path: if an operator's name override appeared in the gap, the
      // shop of record changed under us — abort so the route re-resolves
      // instead of silently renaming the operator's shop.
      const existingOverride = c.shop_name_override ? String(c.shop_name_override).trim() : null;
      if (existingOverride && existingOverride.toUpperCase() !== opts.shopName.toUpperCase()) {
        return { applied: false as const, reason: "name_override_conflict" as const, currentPhone: storedPhone, currentName: existingOverride };
      }
      await tx.execute(sql`
        UPDATE vrm_holman_portal_hist
        SET shop_name_override = ${opts.shopName}, shop_name_override_by = ${opts.actor}, shop_name_override_at = NOW()
        WHERE truck_no = ${truckNo}`);
    }
    await tx.execute(sql`
      UPDATE vrm_holman_portal_hist
      SET shop_phone = ${opts.phone}, shop_phone_locked = true, shop_phone_source = 'luca',
          shop_phone_edited_by = ${opts.actor}, shop_phone_edited_at = NOW()
      WHERE truck_no = ${truckNo}`);
    return {
      applied: true as const,
      previousPhone: storedPhone,
      previousLocked: c.shop_phone_locked === true,
      previousName: c.shop_name_override ?? null,
    };
  });
}

// ── Lock expiry ─────────────────────────────────────────────────────────────
// A manual lock is scoped to the rental EPISODE that prompted it, not to the
// truck forever (Tyler 8/3): "once the rental falls off the list, if it is
// later added back on, the locked contact information would need to be reset
// and have the ability to be pulled back in via the scraper."
//
// The board's own lifecycle clocks decide when that episode is over:
// vrm_rental_operations_cases.present_in_latest is board membership, and
// ingest stamps dropped_from_feed_at the run a case leaves the feed. A locked
// truck stays locked while ANY present case references it — as the rental
// itself (case_key) or as the renter's identity-resolved assigned truck (the
// assigned tab and the redirect pencil can lock those too). Once nothing on
// the board references it, a grace window starts; only after the window does
// the lock clear. The grace exists because the feed flickers — the ETL loader
// has known gaps, and a case that vanishes for a day mid-rental must not cost
// an operator their lock.
const SHOP_PHONE_LOCK_GRACE_DAYS = 7;

export async function expireStaleShopPhoneLocks(): Promise<{ locked: number; expired: number; nameOverrides: number; nameExpired: number }> {
  const res = await db.execute(sql`
    WITH case_refs AS (
      -- Every truck a case references, with that case's board state + clock:
      -- the rental truck itself…
      SELECT c.case_key AS truck, c.present_in_latest,
             GREATEST(COALESCE(c.dropped_from_feed_at, 'epoch'::timestamptz),
                      COALESCE(c.last_seen_at,         'epoch'::timestamptz)) AS board_clock
      FROM vrm_rental_operations_cases c
      UNION ALL
      -- …and the renter's assigned truck. Same identity resolution as
      -- UNIVERSE_CTE's assigned arm, but with NO declined/auction filter: the
      -- assigned-truck tab can set a lock on ANY case, so every case must
      -- keep its assigned truck's lock alive while it is on the board.
      SELECT ownp.own_pad AS truck, c.present_in_latest,
             GREATEST(COALESCE(c.dropped_from_feed_at, 'epoch'::timestamptz),
                      COALESCE(c.last_seen_at,         'epoch'::timestamptz)) AS board_clock
      FROM vrm_rental_operations_cases c
      JOIN vrm_rental_identity_resolutions i ON i.case_key = c.case_key
      JOIN all_techs atr ON atr.employee_id = COALESCE(i.override_employee_id, i.resolved_employee_id)
      ${OWN_TRUCK_LATERALS}
      WHERE ownp.own_pad IS NOT NULL
    ),
    ref_agg AS (
      SELECT truck, bool_or(present_in_latest) AS on_board, max(board_clock) AS last_on_board
      FROM case_refs GROUP BY 1
    )
    SELECT h.truck_no, h.hist, h.shop_phone, h.shop_phone_edited_at, h.shop_phone_locked,
           h.shop_name_override, h.shop_name_override_at,
           COALESCE(r.on_board, false) AS on_board, r.last_on_board
    FROM vrm_holman_portal_hist h
    LEFT JOIN ref_agg r ON r.truck = h.truck_no
    WHERE h.shop_phone_locked = true OR h.shop_name_override IS NOT NULL
  `);
  const rows = res.rows as any[];
  const graceMs = SHOP_PHONE_LOCK_GRACE_DAYS * 86_400_000;
  const now = Date.now();
  const old = (ts: any) => ts == null || now - new Date(ts).getTime() > graceMs;
  // Both clocks must be past the grace: the board clock (case left a week ago)
  // AND the edit clock — so a lock placed five minutes ago never insta-expires
  // just because its case dropped last month, and a lock on a truck the board
  // has never referenced still ages out by edit date instead of living forever.
  const lockedRows = rows.filter((r) => r.shop_phone_locked === true);
  const expired = lockedRows.filter((r) => r.on_board !== true && old(r.last_on_board) && old(r.shop_phone_edited_at));

  let applied = 0;
  for (const r of expired) {
    let pick: ReturnType<typeof pickShopFromEvents>;
    try {
      const raw = Array.isArray(r.hist) ? r.hist : JSON.parse(String(r.hist ?? "[]"));
      pick = pickShopFromEvents(Array.isArray(raw) ? raw : []);
    } catch {
      // Malformed hist: still expire — fail toward scraper ownership. The next
      // visit rewrites hist and the pick along with it.
      pick = pickShopFromEvents([]);
    }
    // Race guard, ATOMIC at write time: the snapshot above may be stale by the
    // time this row is written. `shop_phone_locked = true` catches a concurrent
    // unlock; re-checking the edit clock IN the UPDATE catches a concurrent
    // re-edit/re-lock — setShopPhone always stamps edited_at = NOW(), which
    // fails the age predicate, so an operator writing mid-sweep always wins.
    // (Board clocks need no re-check: a case flipping mid-run only shifts an
    // expiry that is already 7+ days past its episode by one sweep.)
    // edited_by/edited_at survive as the audit trail of the LAST manual edit;
    // source stops claiming manual.
    const upd = await db.execute(sql`
      UPDATE vrm_holman_portal_hist
      SET shop_phone = ${pick.shopPhone}, shop_phone_locked = false,
          shop_phone_source = ${pick.shopPhone ? "scrape" : null}
      WHERE truck_no = ${r.truck_no} AND shop_phone_locked = true
        AND (shop_phone_edited_at IS NULL
             OR shop_phone_edited_at < NOW() - make_interval(days => ${SHOP_PHONE_LOCK_GRACE_DAYS}))`);
    if ((upd.rowCount ?? 0) === 0) {
      // Someone edited or unlocked this row between snapshot and write — their
      // state stands, and no audit row may claim an expiry that never applied.
      console.log(`[VRM RentalOps] shop-phone lock expiry SKIPPED for ${r.truck_no}: row changed mid-run (operator wins)`);
      continue;
    }
    applied++;
    try {
      await db.execute(sql`
        INSERT INTO vrm_rental_operation_actions (case_key, action_type, actor, target_truck, payload)
        VALUES (${r.truck_no}, 'shop_phone_lock_expire', 'system', ${r.truck_no},
                ${JSON.stringify({ previousPhone: r.shop_phone ?? null, restoredPhone: pick.shopPhone, lastOnBoard: r.last_on_board ?? null, graceDays: SHOP_PHONE_LOCK_GRACE_DAYS })}::jsonb)`);
    } catch (e: any) {
      console.warn(`[VRM RentalOps] lock-expiry audit insert failed for ${r.truck_no} (reset applied): ${e?.message || e}`);
    }
    console.log(`[VRM RentalOps] shop-phone lock EXPIRED for ${r.truck_no}: case off board > ${SHOP_PHONE_LOCK_GRACE_DAYS}d — manual ${r.shop_phone ?? "(none)"} → scrape ${pick.shopPhone ?? "(none)"}`);
  }

  // Shop-NAME overrides expire on the SAME episode clock. Clearing is simpler
  // than the phone path: the override column just goes back to NULL and every
  // reader falls through to the reconciled PO pick — nothing to restore.
  const nameRows = rows.filter((r) => r.shop_name_override != null);
  const nameExpired = nameRows.filter((r) => r.on_board !== true && old(r.last_on_board) && old(r.shop_name_override_at));
  let nameApplied = 0;
  for (const r of nameExpired) {
    // Same atomic race guard as the phone path: re-check the edit clock IN the
    // UPDATE so an operator re-editing mid-sweep always wins.
    const upd = await db.execute(sql`
      UPDATE vrm_holman_portal_hist
      SET shop_name_override = NULL
      WHERE truck_no = ${r.truck_no} AND shop_name_override IS NOT NULL
        AND (shop_name_override_at IS NULL
             OR shop_name_override_at < NOW() - make_interval(days => ${SHOP_PHONE_LOCK_GRACE_DAYS}))`);
    if ((upd.rowCount ?? 0) === 0) {
      console.log(`[VRM RentalOps] shop-name override expiry SKIPPED for ${r.truck_no}: row changed mid-run (operator wins)`);
      continue;
    }
    nameApplied++;
    try {
      await db.execute(sql`
        INSERT INTO vrm_rental_operation_actions (case_key, action_type, actor, target_truck, payload)
        VALUES (${r.truck_no}, 'shop_name_override_expire', 'system', ${r.truck_no},
                ${JSON.stringify({ previousName: r.shop_name_override ?? null, lastOnBoard: r.last_on_board ?? null, graceDays: SHOP_PHONE_LOCK_GRACE_DAYS })}::jsonb)`);
    } catch (e: any) {
      console.warn(`[VRM RentalOps] name-override expiry audit insert failed for ${r.truck_no} (reset applied): ${e?.message || e}`);
    }
    console.log(`[VRM RentalOps] shop-name override EXPIRED for ${r.truck_no}: case off board > ${SHOP_PHONE_LOCK_GRACE_DAYS}d — "${r.shop_name_override}" → PO pick`);
  }

  if (rows.length) {
    console.log(`[VRM RentalOps] shop lock expiry: ${lockedRows.length} phone-locked (${applied} expired), ${nameRows.length} name-overridden (${nameApplied} expired)`);
  }
  return { locked: lockedRows.length, expired: applied, nameOverrides: nameRows.length, nameExpired: nameApplied };
}
