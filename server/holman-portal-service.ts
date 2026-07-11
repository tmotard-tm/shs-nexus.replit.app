import { fetch } from "undici";
import type { HolmanHarvest } from "./holman-headless-login";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";

// ─── Constants ────────────────────────────────────────────────────────────────
// Production Holman uses /AriAccessWeb/ (NOT /AriAccessWeb4/, which is the Decom env).
// All login + postback mechanics are identical; only the path prefix differs.
const ORIGIN = "https://insights.holman.com";
const PORTAL_BASE = `${ORIGIN}/AriAccessWeb`;
const ANALYTICS_BASE = `${ORIGIN}/Analytics`;

// Login is handled by the headless browser (holman-headless-login); the HTTP service
// only needs default.aspx (for GetDashboardTabs) downstream.
const DEFAULT_URL = `${PORTAL_BASE}/default.aspx`;

// DetailsListing host page for the awaiting-auth KPI. Built dynamically with the
// session-issued ID/TabId/LinkDate at scrape time (see buildListingUrl).
const DETAILS_LISTING_PATH = `${PORTAL_BASE}/WebForms/KPIs/DetailsListing.aspx`;

// RepairDetails decision page (production /AriAccessWeb/WebForms/Details/).
const REPAIR_DETAILS_PATH = `${PORTAL_BASE}/WebForms/Details/RepairDetails.aspx`;

// KPI constants confirmed byte-exact from 2insights.holman.com.har.
const KPI_NAME = "POsAwaitingAuthorization";
const KPI_TITLE = "Repairs Awaiting Authorization as informational only";
const KPI_ID_NUM = "129"; // numeric KpiId prefix of the ID token (129_<token>)

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

let _sessionCookies: string = "";
let _sessionExpiry: Date | null = null;
// Token + TabId harvested by the headless login (the JS-gated dashboard values).
let _harvestedId: string | null = null;
let _harvestedTabId: string | null = null;

// ── Session stability controls ────────────────────────────────────────────────
const SESSION_TTL_MS = 20 * 60 * 1000;
// A login that returns cookies but NO TabId is a partial/poisoned session: every
// Refresh then fast-fails at "Could not determine TabId". We hold such a session only
// briefly (and never persist it to disk) so the next Refresh re-attempts a fresh login
// instead of being stuck for the full SESSION_TTL_MS.
const TABIDLESS_SESSION_TTL_MS = 3 * 60 * 1000;
const SESSION_CACHE_FILE = "/tmp/holman-session.json";
const LOGIN_TIMEOUT_MS = 120_000; // hard ceiling for the isolated login worker
// Concurrency guard: only ONE headless login runs at a time. Concurrent callers
// (e.g. a double-clicked Refresh) await the same in-flight login instead of each
// launching a Chromium — the old in-process model could fork several at once.
let _loginInFlight: Promise<HolmanHarvest> | null = null;

export interface HolmanPortalPO {
  key: string;
  poNumber: string;
  repairNumber: string;
  vehicleNumber: string;
  driverName: string;
  vendorName: string;
  division: string;
  additionalRequestedAmt: number;
  approvedAmount: number;
  poDate: string;
  submittedDate: string;
  approvalProcess: string;
}

export interface ScrapeResult {
  rows: HolmanPortalPO[];
  scrapedAt: Date;
  error?: string;
  /** False when the pager walk aborted early (partial rows) — callers must
   *  NOT treat absence from a partial set as "resolved on Holman". */
  walkComplete?: boolean;
}

export interface ApprovalResult {
  success: boolean;
  confirmed: boolean;
  dryRun?: boolean;
  blocked?: boolean; // RepairDetails page shares other awaiting PO(s) → can't auto-approve the rental alone
  blockingPos?: string[]; // the other PO number(s) on the page (e.g. the repair PO)
  error?: string;
}

// ─── Cookie jar ───────────────────────────────────────────────────────────────
// undici exposes Set-Cookie via headers.getSetCookie(). We persist every cookie
// across all hops (GET LoginForm → POST username → POST password 302 → SSO → AJAX).
// The auth/session cookie names (ASP.NET_SessionId, .ASPXAUTH, app cookie) were
// stripped from every HAR export, so names are treated as opaque — whatever the
// server sets is replayed.

function mergeCookies(existing: string, response: any): string {
  const map = new Map<string, string>();
  for (const pair of existing.split("; ").filter(Boolean)) {
    const eq = pair.indexOf("=");
    if (eq > 0) map.set(pair.slice(0, eq).trim(), pair.slice(eq + 1));
  }
  const setCookie: string[] = response.headers?.getSetCookie?.() ?? [];
  for (const hdr of setCookie) {
    const [nameVal] = hdr.split(";");
    const eq = nameVal.indexOf("=");
    if (eq > 0) map.set(nameVal.slice(0, eq).trim(), nameVal.slice(eq + 1).trim());
  }
  return Array.from(map.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
}

// ─── HTML helpers ─────────────────────────────────────────────────────────────

function extractHidden(html: string, name: string): string {
  // ASP.NET hidden inputs. Names contain $ and special chars, so escape for regex.
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`id="${esc}"[^>]*value="([^"]*)"`, "i"),
    new RegExp(`name="${esc}"[^>]*value="([^"]*)"`, "i"),
    new RegExp(`value="([^"]*)"[^>]*name="${esc}"`, "i"),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return decodeEntities(m[1]);
  }
  return "";
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&#32;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ");
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function parseAmount(s: string): number {
  const m = s.match(/\$?([\d,]+\.\d{2})/);
  if (m) return parseFloat(m[1].replace(/,/g, "")) || 0;
  const n = parseFloat(s.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function nowUtcLinkDate(): string {
  // LinkDate format: "YYYY-MM-DD HH:MM:SSZ" (cosmetic per-render timestamp; not load-bearing).
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}Z`;
}

// ─── Grid parsing ─────────────────────────────────────────────────────────────
// Isolate the data grid (#KPIDetailsGrid_mailableGrid) and parse its <tbody> rows.
// Confirmed byte-for-byte against 2insights.holman.com.har: 15 columns, bare <tr>
// (no class/id), each data row has exactly 15 <td>, col 0 = Details <a> whose href
// is GenVehicleFrame.aspx?isDrilldown=True&key=<144-hex>. The same hex key is what
// RepairDetails.aspx?key= consumes in the decision phase.
//
// Column index map (0-based, HAR-confirmed):
//   0  Details link (144-hex key)
//   1  Client (lessee, e.g. 2B56)
//   2  Vehicle (truck #)
//   3  District
//   4  Driver ("LAST, FIRST")
//   5  Vendor
//   6  Addl. Requested Amt.
//   7  Approved Amount
//   8  PO Date (MM/DD/YYYY hh:mm:ss AM/PM)
//   9  Repair #
//   10 PO #
//   11 Submitted (MM/DD/YYYY)
//   12 Approval Process (Original | Resubmit)
//   13 Driver Email Address
//   14 Division (01 | RF — NOT a rental signal)

interface GridRow {
  cells: string[];
  key: string | null;
}

function isolateGrid(html: string): string {
  const idPos = html.indexOf('id="KPIDetailsGrid_mailableGrid"');
  if (idPos < 0) return html; // fall back to whole doc; row guard still filters
  const tableStart = html.lastIndexOf("<table", idPos);
  const tableEnd = html.indexOf("</table>", idPos);
  if (tableStart < 0 || tableEnd < 0) return html;
  return html.slice(tableStart, tableEnd + 8);
}

function parseGridRows(html: string): GridRow[] {
  const grid = isolateGrid(html);
  const out: GridRow[] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trM: RegExpExecArray | null;
  while ((trM = trRe.exec(grid)) !== null) {
    const rowHtml = trM[1];
    if (/<th[\s>]/i.test(rowHtml)) continue; // header row
    const cells: string[] = [];
    let keyFromRow: string | null = null;
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let tdM: RegExpExecArray | null;
    while ((tdM = tdRe.exec(rowHtml)) !== null) {
      const raw = tdM[1];
      if (keyFromRow === null) {
        // The key lives in the first cell's anchor href. Extract per-row (not via a
        // global list) so header/footer/paging anchors can't desync key↔row pairing.
        const hrefM = raw.match(/href="([^"]+)"/i);
        if (hrefM) {
          const href = decodeEntities(hrefM[1]);
          const kM = href.match(/[?&]key=([0-9A-Fa-f]+)/);
          if (kM) keyFromRow = kM[1];
        }
      }
      cells.push(stripTags(raw));
    }
    if (cells.length === 15) out.push({ cells, key: keyFromRow });
  }
  return out;
}

// ─── ID-token acquisition (the hard part) ─────────────────────────────────────
// The DetailsListing GET requires ID=<KpiId>_<token>, TabId, LinkDate. TabId is the
// account's stable USER_TEMPLATE_ID. The ID token is SERVER-ISSUED, minted by the
// /Analytics/ dashboard render (it appears in _Zones/{TabId} as the assembled
// DetailsListing href and as DOM id w_{TabId}_{ID}). It is NOT returned by any portal
// JSON AJAX (GetMenuItemURL/{"d":""}, GetAlerts URL=null). It cannot be fabricated.
//
// HTTP acquisition path (all overridable via env if a headless harvester is used):
//   1. GetDashboardTabs → USER_TEMPLATE_ID (TabId) + SSO bounce URL (SessionKey).
//   2. Follow SSO bounce → /Analytics session.
//   3. GET /Analytics/Dashboard/_Zones/{TabId} → scrape the POsAwaitingAuthorization
//      DetailsListing href, which carries ID=129_<token>.
// If any step fails to yield an ID, fall back to env HOLMAN_KPI_ID / HOLMAN_KPI_TABID
// (a headless browser can harvest a fresh pair and write them to env/secret).

interface ListingContext {
  id: string;
  tabId: string;
  source: string;
}

async function getDashboardTabId(): Promise<{ tabId: string; ssoUrl: string | null }> {
  const resp = await fetch(`${DEFAULT_URL}/GetDashboardTabs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Cookie: _sessionCookies,
      "User-Agent": UA,
      Referer: DEFAULT_URL,
      Origin: ORIGIN,
    },
    body: JSON.stringify({ userTemplateId: "" }),
  });
  _sessionCookies = mergeCookies(_sessionCookies, resp);
  const text = await (resp as any).text();
  // ASMX wraps the payload as {"d":"<escaped-json-string>"} — the inner JSON has its
  // quotes backslash-escaped (\"USER_TEMPLATE_ID\":1029879.0) and "&" as &.
  // Unwrap the `d` envelope first so the inner JSON is clean before regexing
  // (VERIFIED LIVE 2026-06-24: a raw regex on the escaped text never matches).
  let inner = text;
  try {
    const wrapper = JSON.parse(text);
    if (wrapper && typeof wrapper.d === "string") inner = wrapper.d;
  } catch {
    /* not wrapped / already plain — fall back to the raw text */
  }
  let tabId = "";
  let ssoUrl: string | null = null;
  const utm = inner.match(/"USER_TEMPLATE_ID"\s*:\s*([0-9]+)/);
  if (utm) tabId = utm[1];
  const sso = inner.match(/"URL"\s*:\s*"([^"]*\/Analytics\/Account\/SSO\/[^"]+)"/);
  if (sso) {
    ssoUrl = sso[1]
      .replace(/\\u0026/gi, "&")
      .replace(/\\u002f/gi, "/")
      .replace(/\\\//g, "/");
  }
  return { tabId, ssoUrl };
}

async function acquireListingContext(force = false): Promise<ListingContext> {
  // Env override wins — lets a headless-harvested fresh ID/TabId be injected without
  // a code change, and guarantees the listing GET can be built even if the HTTP-only
  // _Zones scrape comes up empty in production.
  const envId = process.env.HOLMAN_KPI_ID?.trim();
  const envTab = process.env.HOLMAN_KPI_TABID?.trim();
  if (envId && envTab) {
    return { id: envId, tabId: envTab, source: "env" };
  }

  // Preferred: the values the headless login already harvested from the JS-gated
  // /Analytics dashboard (login + _Zones happen together in the browser). This avoids
  // re-doing the cross-app SSO over raw HTTP, which is brittle.
  // Non-forced calls reuse the login-harvested token (cheap). A Refresh passes force=true
  // so we ALWAYS re-render the dashboard below and pick up POs queued since login.
  if (!force && _harvestedId && _harvestedTabId) {
    return { id: _harvestedId, tabId: _harvestedTabId, source: "headless" };
  }

  // 1. TabId: prefer the cached/harvested tab (stable across renders); only hit
  //    GetDashboardTabs (the brittle SSO bounce) when we don't already have one.
  let tabId = _harvestedTabId ?? envTab ?? "";
  let ssoUrl: string | null = null;
  if (!tabId) {
    try {
      const tabs = await getDashboardTabId();
      if (tabs.tabId) tabId = tabs.tabId;
      ssoUrl = tabs.ssoUrl;
    } catch (e: any) {
      console.warn("[HolmanPortal] GetDashboardTabs failed:", e?.message);
    }
  }
  if (!tabId) throw new Error("[HolmanPortal] Could not determine TabId (set HOLMAN_KPI_TABID)");

  // 2. Establish /Analytics session via SSO bounce (best-effort; cookies carried).
  if (ssoUrl) {
    try {
      const sso = await fetch(ssoUrl, {
        headers: { Cookie: _sessionCookies, "User-Agent": UA, Referer: DEFAULT_URL },
        redirect: "follow",
      });
      _sessionCookies = mergeCookies(_sessionCookies, sso);
    } catch (e: any) {
      console.warn("[HolmanPortal] SSO bounce failed:", e?.message);
    }
  }

  // 3. Scrape the ID token out of the dashboard render. Try _Zones first (it carries
  //    the fully-assembled DetailsListing href), then Index as a fallback.
  const candidates = [
    `${ANALYTICS_BASE}/Dashboard/_Zones/${tabId}`,
    `${ANALYTICS_BASE}/Dashboard/Index/${tabId}`,
  ];
  for (const url of candidates) {
    try {
      const r = await fetch(url, {
        headers: { Cookie: _sessionCookies, "User-Agent": UA, Referer: `${ANALYTICS_BASE}/Dashboard/Index/${tabId}` },
        redirect: "follow",
      });
      _sessionCookies = mergeCookies(_sessionCookies, r);
      if (!r.ok) continue;
      const body = await (r as any).text();
      const id = extractKpiIdToken(body);
      if (id) return { id, tabId, source: url };
    } catch (e: any) {
      console.warn(`[HolmanPortal] dashboard fetch failed (${url}):`, e?.message);
    }
  }

  // Fallback: if the re-render produced no token, use the login-harvested one rather
  // than failing the refresh outright (stale, but better than an empty queue).
  if (_harvestedId) {
    console.warn("[HolmanPortal] dashboard re-render yielded no token; using harvested id fallback.");
    return { id: _harvestedId, tabId, source: "headless-fallback" };
  }

  throw new Error(
    "[HolmanPortal] Could not scrape the POsAwaitingAuthorization ID token from the " +
      "Analytics dashboard render. The token is server-issued and may only appear after " +
      "client-side Kendo widget init (headless-browser harvest required). Set HOLMAN_KPI_ID " +
      "(and HOLMAN_KPI_TABID) to a freshly harvested token to proceed via HTTP.",
  );
}

function extractKpiIdToken(html: string): string | null {
  // VERIFIED LIVE (2026-06-24) against GET /Analytics/Dashboard/_Zones/{TabId}:
  // the POsAwaitingAuthorization widget renders as
  //   <li class="widget ... posawaitingauthorization ..." id="w_1029879_129_1a5v5azzc0n"
  //       data-full-name="Insights.Areas.Dashboard.Models.POsAwaitingAuthorization"
  //       data-widget-id="129_1a5v5azzc0n" data-user-template-id="1029879">
  // So the token is in `data-widget-id` and embedded in the `w_{TabId}_{ID}` element id.
  // Preferred: data-widget-id on the POsAwaitingAuthorization widget.
  const dwid = html.match(new RegExp(`data-widget-id="(${KPI_ID_NUM}_[a-z0-9]{6,16})"`, "i"));
  if (dwid) return dwid[1];
  // DOM id w_{TabId}_{ID} (verified present).
  const wid = html.match(new RegExp(`w_\\d+_(${KPI_ID_NUM}_[a-z0-9]{6,16})`, "i"));
  if (wid) return wid[1];
  // Fallbacks: an assembled DetailsListing href, or the Kendo _KpiData_Read data URL.
  const direct = html.match(
    new RegExp(`DetailsListing\\.aspx\\?[^"'<>]*?ID=(${KPI_ID_NUM}_[a-z0-9]{6,16})`, "i"),
  );
  if (direct) return direct[1];
  const kdr = html.match(new RegExp(`_KpiData(?:_Read)?/(${KPI_ID_NUM}_[a-z0-9]{6,16})`, "i"));
  if (kdr) return kdr[1];
  return null;
}

function buildListingUrl(ctx: ListingContext): string {
  const qs = new URLSearchParams({
    ID: ctx.id,
    KpiName: KPI_NAME,
    TabId: ctx.tabId,
    AssociatedSavedSearch: "NOFILTER",
    ListPageSubTitle: "",
    Title: KPI_TITLE,
    IsAlert: "Y",
    LinkDate: nowUtcLinkDate(),
  });
  return `${DETAILS_LISTING_PATH}?${qs.toString()}`;
}

// ─── Session management ───────────────────────────────────────────────────────
// Two-step ASP.NET WebForms login, field-exact per Decom HAR (mechanics identical
// to production; only the path prefix differs):
//   A) GET LoginForm.aspx → scrape __VIEWSTATE/__VIEWSTATEGENERATOR/__EVENTVALIDATION + HdnMacName.
//   B) POST username step: txtCXLoginLogonId + btnLogonId=Continue (NO LoginPass).
//   C) POST password step: LoginPass + LoginButton1="Log in" (NO username, NO LoginName,
//      NO checkCookie). Returns 302 → /AriAccessWeb/default.aspx on success.
// HiddenBrowerID = one random 32-hex (no dashes), reused across both POSTs.
// UTCoffset = "-04:00" (±HH:MM form, url-encoded by URLSearchParams).
// __VIEWSTATE/__EVENTVALIDATION differ per step → must re-scrape from each response.

// Reuse a recent harvested session persisted to disk so a server restart (or a
// process that just lost its in-memory session) does not have to relaunch Chromium.
function loadCachedSession(): boolean {
  try {
    if (!existsSync(SESSION_CACHE_FILE)) return false;
    const c = JSON.parse(readFileSync(SESSION_CACHE_FILE, "utf8"));
    if (!c?.cookies || !c?.expiresAt || Date.parse(c.expiresAt) <= Date.now()) return false;
    // Never reuse a persisted session that lacks a tabId. We only ever write a
    // full-TTL disk session WITH a tabId now, but an OLD build could have left a
    // tabId-less file on disk; honoring it would fast-fail every Refresh until it
    // expired. A tabId-less hold is in-memory + short-TTL only (see ensureSession).
    if (!c?.tabId) return false;
    _sessionCookies = c.cookies;
    _harvestedId = c.idToken ?? null;
    _harvestedTabId = c.tabId ?? null;
    _sessionExpiry = new Date(c.expiresAt);
    console.log(`[HolmanPortal] Reusing cached session (disk) until ${c.expiresAt}.`);
    return true;
  } catch (e: any) {
    console.warn("[HolmanPortal] session cache read failed:", e?.message);
    return false;
  }
}

function saveCachedSession(): void {
  try {
    writeFileSync(
      SESSION_CACHE_FILE,
      JSON.stringify({
        cookies: _sessionCookies,
        idToken: _harvestedId,
        tabId: _harvestedTabId,
        expiresAt: _sessionExpiry?.toISOString() ?? null,
      }),
    );
  } catch (e: any) {
    console.warn("[HolmanPortal] session cache write failed:", e?.message);
  }
}

// Run the headless Chromium login in an ISOLATED child process. This is the core
// stability fix: a Chromium crash, OOM, hang, or CPU spike stays contained in the
// child and can never take down the Express server. The child is its own process
// group; on timeout we SIGKILL the whole group so neither the worker nor any
// Chromium descendant can leak (the in-process model leaked a full browser tree on
// every interrupted run). stdout carries exactly one JSON result line; all human
// logs come back over stderr and are mirrored into the server log.
function spawnHeadlessLogin(): Promise<HolmanHarvest> {
  return new Promise<HolmanHarvest>((resolve, reject) => {
    // Dev runs via tsx (.ts source); a production build emits dist/holman-login-worker.js.
    const distWorker = "dist/holman-login-worker.js";
    const useDist = existsSync(distWorker);
    const cmd = useDist ? process.execPath : "node_modules/.bin/tsx";
    const argv = useDist ? [distWorker] : ["server/holman-login-worker.ts"];

    let child;
    try {
      child = spawn(cmd, argv, {
        cwd: process.cwd(),
        detached: true, // own process group → group-kill on timeout reaps Chromium too
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });
    } catch (e: any) {
      reject(new Error(`Failed to spawn headless login worker: ${e?.message}`));
      return;
    }

    let out = "";
    let errTail = "";
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      console.error(`[HolmanPortal] login worker timed out after ${LOGIN_TIMEOUT_MS}ms — killing process group`);
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        /* already gone */
      }
      finish(() => reject(new Error("Headless login timed out")));
    }, LOGIN_TIMEOUT_MS);

    child.stdout?.on("data", (d) => {
      out += d.toString();
    });
    child.stderr?.on("data", (d) => {
      const s = d.toString();
      errTail = (errTail + s).slice(-800);
      process.stderr.write(s); // surface [HolmanHeadless] logs in the server log
    });
    child.on("error", (e) => finish(() => reject(new Error(`Headless login worker error: ${e.message}`))));
    child.on("close", (code) => {
      finish(() => {
        const line = out.trim().split("\n").filter(Boolean).pop() ?? "";
        let parsed: any = null;
        try {
          parsed = line ? JSON.parse(line) : null;
        } catch {
          /* non-JSON stdout */
        }
        if (parsed?.ok) {
          resolve({ cookies: parsed.cookies, tabId: parsed.tabId ?? null, idToken: parsed.idToken ?? null });
        } else {
          reject(
            new Error(
              parsed?.error ||
                `Headless login worker exited ${code} without a result${errTail ? `: ${errTail.slice(-300)}` : ""}`,
            ),
          );
        }
      });
    });
  });
}

// Fully invalidate the current session: memory AND the disk cache. Setting only
// _sessionExpiry=null is NOT enough — ensureSession() step 3 would reload the same
// dead cookies from SESSION_CACHE_FILE (its TTL is wall-clock, not validity-checked)
// and every retry would bounce again until the file aged out (the "login loop").
function invalidateSession(): void {
  _sessionExpiry = null;
  _sessionCookies = "";
  try {
    if (existsSync(SESSION_CACHE_FILE)) unlinkSync(SESSION_CACHE_FILE);
  } catch {
    /* non-fatal — worst case the stale file ages out on its own TTL */
  }
}

async function ensureSession(): Promise<void> {
  // 1. In-memory session still valid.
  if (_sessionExpiry && _sessionExpiry > new Date() && _sessionCookies) return;

  // 2. Manual cookie injection (no Chromium at all) — the most stable path.
  // VERIFIED 2026-06-24: Holman's PRODUCTION login cannot be completed over raw HTTP
  // (the password POST 302s to SiteException 500 because the login page's JavaScript
  // establishes session state — an ARISessionId cookie — a server-side fetch can't
  // reproduce). A real browser logs in fine, so HOLMAN_SESSION_COOKIE lets a manual or
  // external capture be injected; everything downstream is pure HTTP.
  const injected = process.env.HOLMAN_SESSION_COOKIE?.trim();
  if (injected) {
    _sessionCookies = injected;
    _sessionExpiry = new Date(Date.now() + SESSION_TTL_MS);
    console.log("[HolmanPortal] Using injected HOLMAN_SESSION_COOKIE (manual login).");
    return;
  }

  // 3. Disk-cached session from a recent login (survives restarts within the TTL).
  if (loadCachedSession()) return;

  // 4. A login is already running → await it rather than launching a second Chromium.
  if (_loginInFlight) {
    console.log("[HolmanPortal] Reusing in-flight headless login.");
    await _loginInFlight;
    return;
  }

  const user = process.env.HOLMAN_PORTAL_USER ?? "";
  const pass = process.env.HOLMAN_PORTAL_PASS ?? "";
  if (!user || !pass) {
    throw new Error("HOLMAN_PORTAL_USER / HOLMAN_PORTAL_PASS env vars not set (or set HOLMAN_SESSION_COOKIE)");
  }

  // 5. Fresh login in an isolated worker process.
  console.log("[HolmanPortal] Logging in via isolated headless worker…");
  _loginInFlight = spawnHeadlessLogin();
  try {
    const harvest = await _loginInFlight;
    _sessionCookies = harvest.cookies;
    _harvestedId = harvest.idToken;
    _harvestedTabId = harvest.tabId;
    if (harvest.tabId) {
      // Good login: full TTL + persist to disk so a restart within the TTL reuses it.
      _sessionExpiry = new Date(Date.now() + SESSION_TTL_MS);
      saveCachedSession();
    } else {
      // Cookies but no TabId → do NOT persist and hold only briefly, so the next Refresh
      // re-logins instead of fast-failing for the full TTL. _loginInFlight already blocks
      // a concurrent re-login and /tmp is per-instance on autoscale, so no re-login storm.
      _sessionExpiry = new Date(Date.now() + TABIDLESS_SESSION_TTL_MS);
      console.warn(
        "[HolmanPortal] Login harvested NO TabId — holding cookies briefly (not persisted); next Refresh will re-login.",
      );
    }
    console.log(
      `[HolmanPortal] Session established (isolated worker). tabId=${_harvestedTabId ?? "?"} idToken=${_harvestedId ? "harvested" : "MISSING"}`,
    );
  } finally {
    _loginInFlight = null;
  }
}

// ─── Scrape awaiting-auth queue ───────────────────────────────────────────────

export async function scrapeAwaitingAuth(force = false): Promise<ScrapeResult> {
  const scrapedAt = new Date();
  try {
    await ensureSession();

    // Acquire the session-issued ID/TabId, then build the DetailsListing URL.
    const ctx = await acquireListingContext(force);
    const listingUrl = buildListingUrl(ctx);
    console.log(`[HolmanPortal] listing ctx id=${ctx.id} tabId=${ctx.tabId} (src=${ctx.source})`);

    const resp = await fetch(listingUrl, {
      headers: {
        Cookie: _sessionCookies,
        "User-Agent": UA,
        Referer: `${ANALYTICS_BASE}/Dashboard/Index/${ctx.tabId}`,
      },
      redirect: "follow",
    });
    _sessionCookies = mergeCookies(_sessionCookies, resp);

    const respUrl: string = (resp as any).url ?? "";
    if (/LoginForm\.aspx/i.test(respUrl)) {
      invalidateSession();
      throw new Error("[HolmanPortal] Listing GET bounced to LoginForm — session expired");
    }
    if (!resp.ok) {
      if (resp.status === 302 || resp.status === 401 || resp.status === 500) invalidateSession();
      throw new Error(`[HolmanPortal] DetailsListing HTTP ${resp.status}`);
    }

    const html = await (resp as any).text();

    // Walk ALL grid pages. The grid serves 20 rows per page with a WebForms
    // pager (KPIDetailsGrid$NextPageBtn postback); rental POs on page 2+ were
    // previously invisible to the queue ("missing rentals", found 2026-07-09).
    // NextPageBtn renders with class "aspNetDisabled" (and no postback href)
    // on the last page — that is the stop signal.
    const allGridRows = [...parseGridRows(html)];
    let pageHtml = html;
    let pagesFetched = 1;
    let walkComplete = true;
    const MAX_PAGES = 10;
    while (pagesFetched < MAX_PAGES) {
      const nextBtn = pageHtml.match(/<a[^>]*id="KPIDetailsGrid_NextPageBtn"[^>]*>/i)?.[0] ?? "";
      if (!nextBtn || /aspNetDisabled/i.test(nextBtn) || !/DoPostBack/i.test(nextBtn)) break;
      const body = new URLSearchParams({
        __EVENTTARGET: "KPIDetailsGrid$NextPageBtn",
        __EVENTARGUMENT: "",
        __VIEWSTATE: extractHidden(pageHtml, "__VIEWSTATE"),
        __VIEWSTATEGENERATOR: extractHidden(pageHtml, "__VIEWSTATEGENERATOR"),
        __EVENTVALIDATION: extractHidden(pageHtml, "__EVENTVALIDATION"),
        "KPIDetailsGrid$mailableGridSortColumn": extractHidden(pageHtml, "KPIDetailsGrid$mailableGridSortColumn"),
        "KPIDetailsGrid$mailableGridColumns": extractHidden(pageHtml, "KPIDetailsGrid$mailableGridColumns"),
        "KPIDetailsGrid$mailableGridColumnOrder": extractHidden(pageHtml, "KPIDetailsGrid$mailableGridColumnOrder"),
        "KPIDetailsGrid$showRecycleBin": extractHidden(pageHtml, "KPIDetailsGrid$showRecycleBin") || "True",
        "KPIDetailsGrid$GotoPageTxt": "",
      });
      const pResp = await fetch(listingUrl, {
        method: "POST",
        headers: {
          Cookie: _sessionCookies,
          "User-Agent": UA,
          Referer: listingUrl,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
        redirect: "follow",
      });
      _sessionCookies = mergeCookies(_sessionCookies, pResp);
      if (!pResp.ok || /LoginForm\.aspx/i.test((pResp as any).url ?? "")) {
        console.warn(`[HolmanPortal] pager POST for page ${pagesFetched + 1} failed (HTTP ${pResp.status}) — continuing with ${pagesFetched} page(s) (walk INCOMPLETE)`);
        walkComplete = false;
        break;
      }
      pageHtml = await pResp.text();
      const rows = parseGridRows(pageHtml);
      if (rows.length === 0) break;
      allGridRows.push(...rows);
      pagesFetched++;
    }
    if (pagesFetched >= MAX_PAGES) {
      console.warn(`[HolmanPortal] stopped at the ${MAX_PAGES}-page cap — grid may hold even more rows (walk INCOMPLETE)`);
      walkComplete = false;
    }

    // Dedupe by row key: a row can shift between pages while we walk them.
    const seenRowKeys = new Set<string>();
    const gridRows = allGridRows.filter((r) => {
      const k = r.key || r.cells.join("|");
      if (seenRowKeys.has(k)) return false;
      seenRowKeys.add(k);
      return true;
    });

    const pos: HolmanPortalPO[] = [];
    for (const { cells, key } of gridRows) {
      const vehicleNumber = cells[2] ?? "";
      const driverName = cells[4] ?? "";
      const vendorName = cells[5] ?? "";
      const additionalAmt = parseAmount(cells[6] ?? "0");
      const approvedAmt = parseAmount(cells[7] ?? "0");
      const poDate = cells[8] ?? "";
      const repairNumber = cells[9] ?? "";
      const poNumber = cells[10] ?? "";
      const submittedDate = cells[11] ?? "";
      const approvalProcess = cells[12] ?? "";
      const division = cells[14] ?? "";

      if (!poNumber) continue;

      // Rental detection = vendor-name regex ONLY. Division is NOT a rental signal
      // (an ENTERPRISE row in this capture has Division=01, and RF rows are non-rentals).
      const isRental = /enterprise|rent.?a.?car/i.test(vendorName);
      if (!isRental) continue;

      pos.push({
        key: key ?? "",
        poNumber,
        repairNumber,
        vehicleNumber,
        driverName,
        vendorName,
        division,
        additionalRequestedAmt: additionalAmt,
        approvedAmount: approvedAmt,
        poDate,
        submittedDate,
        approvalProcess,
      });
    }

    console.log(`[HolmanPortal] ${gridRows.length} grid rows across ${pagesFetched} page(s) → ${pos.length} rental POs`);
    return { rows: pos, scrapedAt, walkComplete };
  } catch (err: any) {
    console.error("[HolmanPortal] scrapeAwaitingAuth:", err.message);
    return { rows: [], scrapedAt, error: err.message, walkComplete: false };
  }
}


const RENTER_TIMEOUT_MS = 180_000;

// ─── Renter resolver spawn wrapper (Tyler 2026-07-11) ───────────────────────
// Runs holman-renter-worker in an isolated child process (same containment as
// spawnHeadlessLogin) and returns a poNumber -> renter-name map. Used to fill
// the real renter when the awaiting-auth grid shows the driver as "UNKNOWN".
export interface ResolvedRenter { poNumber: string; renterName: string | null; renterPhone: string | null; }

export async function resolveRentersForVehicles(vehicles: string[]): Promise<ResolvedRenter[]> {
  const uniq = Array.from(new Set(vehicles.map((v) => String(v || "").trim()).filter(Boolean)));
  if (uniq.length === 0) return [];
  return new Promise<ResolvedRenter[]>((resolve) => {
    const distWorker = "dist/holman-renter-worker.js";
    const useDist = existsSync(distWorker);
    const cmd = useDist ? process.execPath : "node_modules/.bin/tsx";
    const argv = (useDist ? [distWorker] : ["server/holman-renter-worker.ts"]).concat([uniq.join(",")]);
    let child;
    try {
      child = spawn(cmd, argv, { cwd: process.cwd(), detached: true, stdio: ["ignore", "pipe", "pipe"], env: process.env });
    } catch (e: any) {
      console.warn("[HolmanRenter] spawn failed (non-fatal):", e?.message);
      return resolve([]);
    }
    let out = "";
    let settled = false;
    const finish = (r: ResolvedRenter[]) => { if (settled) return; settled = true; clearTimeout(timer); resolve(r); };
    const timer = setTimeout(() => {
      try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch { /* gone */ }
      console.warn("[HolmanRenter] renter worker timed out — continuing without renter fill");
      finish([]);
    }, RENTER_TIMEOUT_MS);
    child.stdout?.on("data", (d) => { out += d.toString(); });
    child.stderr?.on("data", (d) => process.stderr.write(d.toString()));
    child.on("error", (e) => { console.warn("[HolmanRenter] worker error:", e.message); finish([]); });
    child.on("close", () => {
      finish((() => {
        const line = out.trim().split("\n").filter(Boolean).pop() ?? "";
        try {
          const parsed = line ? JSON.parse(line) : null;
          if (!parsed?.ok || !Array.isArray(parsed.results)) return [];
          return parsed.results
            .filter((r: any) => r.po && r.renterName)
            .map((r: any) => ({ poNumber: String(r.po), renterName: r.renterName, renterPhone: r.renterPhone ?? null }));
        } catch { return []; }
      })());
    });
  });
}

// ─── Rental Request renter resolver (Tyler 2026-07-11) ──────────────────────
// When the awaiting-auth grid shows driver "UNKNOWN", the REAL renter name
// lives in the PO's Rental Request view (Maintenance tab → PO → View Rental
// Request). This fetches the repair-details page IN-SESSION (the cookies that
// make RepairDetails.aspx work accrue across scrape responses and only exist
// inside this module) and drills into the rental-request content.
// Stage 1 exports a raw fetch so the parser can be built against real pages.

export async function fetchRepairDetailsHtml(
  key: string,
): Promise<{ ok: boolean; html: string; error?: string }> {
  try {
    await ensureSession();
    const url = `${REPAIR_DETAILS_PATH}?key=${key}&isDrilldown=True&IsShowAll=True&rowid=1`;
    const resp = await fetch(url, {
      headers: {
        Cookie: _sessionCookies,
        "User-Agent": UA,
        Referer: `${PORTAL_BASE}/WebForms/KPIs/DetailsListing.aspx`,
      },
      redirect: "follow",
    });
    _sessionCookies = mergeCookies(_sessionCookies, resp);
    const respUrl: string = (resp as any).url ?? "";
    if (/LoginForm\.aspx/i.test(respUrl)) {
      invalidateSession();
      return { ok: false, html: "", error: "bounced to LoginForm" };
    }
    if (!resp.ok) return { ok: false, html: "", error: `HTTP ${resp.status}` };
    return { ok: true, html: await (resp as any).text() };
  } catch (e: any) {
    return { ok: false, html: "", error: e?.message ?? String(e) };
  }
}

export async function fetchPortalPathHtml(
  path: string,
  referer?: string,
): Promise<{ ok: boolean; html: string; status: number; finalUrl?: string; error?: string }> {
  try {
    await ensureSession();
    const url = path.startsWith("http") ? path : `${PORTAL_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
    const resp = await fetch(url, {
      headers: {
        Cookie: _sessionCookies,
        "User-Agent": UA,
        Referer: referer ?? `${PORTAL_BASE}/WebForms/Details/RepairDetails.aspx`,
      },
      redirect: "follow",
    });
    _sessionCookies = mergeCookies(_sessionCookies, resp);
    const finalUrl: string = (resp as any).url ?? url;
    if (/LoginForm\.aspx/i.test(finalUrl)) {
      invalidateSession();
      return { ok: false, html: "", status: resp.status, finalUrl, error: "bounced to LoginForm — session expired" };
    }
    if (!resp.ok) return { ok: false, html: "", status: resp.status, finalUrl, error: `HTTP ${resp.status}` };
    return { ok: true, html: await (resp as any).text(), status: resp.status, finalUrl };
  } catch (e: any) {
    return { ok: false, html: "", status: 0, error: e?.message ?? String(e) };
  }
}

// ─── Approve / Deny a PO via WebForms postback ────────────────────────────────
// Decision page = RepairDetails.aspx?key=<hex>&isDrilldown=True&IsShowAll=True&rowid=1.
// The GET renders radios with value "<lineId>^<poNumber>^<amount>^<seq>_Approve|Decline".
// Already-applied lines render checked+disabled and MUST be skipped — we select by the
// radio's FIELD NAME (group), match the target PO number, and avoid disabled radios.
// The submit posts: the selected radio (name=value), hdnRadio="|"+value,
// SubmitBtnLineItem="Submit Repair Decision", hdnTotalamount="$<sum of selected line amounts>",
// plus VIEWSTATE/EVENTVALIDATION/tabStrip ClientState scraped from the GET, and the
// lessee/vehicle/country subheading controls. 200 alone is NOT confirmation — re-read.

interface DecisionLine {
  fieldName: string; // exact radio group name (ctl00$ctl00$...$ctlNN$ctlNN)
  lineId: string;
  poNumber: string;
  amount: string; // line amount, no $
  seq: string;
  value: string; // full radio value sans decision suffix: lineId^po^amt^seq
  disabled: boolean;
  checked: boolean; // a COMMITTED line disables BOTH radios but checks only the chosen one
}

function parseDecisionLines(html: string, decision: "Approve" | "Decline"): DecisionLine[] {
  const lines: DecisionLine[] = [];
  // Match each radio input, capturing its name and value. Order of attributes varies,
  // so capture name and value independently from the same <input ...> tag.
  const inputRe = /<input\b([^>]*\btype="radio"[^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = inputRe.exec(html)) !== null) {
    const tag = m[1];
    const nameM = tag.match(/\bname="([^"]+)"/i);
    const valM = tag.match(/\bvalue="([^"]+)"/i);
    if (!nameM || !valM) continue;
    const value = decodeEntities(valM[1]);
    const vm = value.match(/^(\d+)\^(\d+)\^(\d+(?:\.\d+)?)\^(\d+)_(Approve|Decline)$/);
    if (!vm) continue;
    if (vm[5] !== decision) continue; // keep only the chosen decision's radio
    const disabled = /\bdisabled\b/i.test(tag);
    const checked = /\bchecked\b/i.test(tag);
    lines.push({
      fieldName: decodeEntities(nameM[1]),
      lineId: vm[1],
      poNumber: vm[2],
      amount: vm[3],
      seq: vm[4],
      value: `${vm[1]}^${vm[2]}^${vm[3]}^${vm[4]}`,
      disabled,
      checked,
    });
  }
  return lines;
}

// Collect the ~23 empty Telerik *_ClientState fields + grid plumbing fields verbatim
// from the GET so the postback round-trips them (server expects them present/blank).
function collectClientStateFields(html: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const seen = new Set<string>();
  const re = /<input\b[^>]*\bname="([^"]*ClientState)"[^>]*\bvalue="([^"]*)"[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const name = decodeEntities(m[1]);
    if (seen.has(name)) continue;
    seen.add(name);
    out.push([name, decodeEntities(m[2])]);
  }
  // Some ClientState inputs put value before name; catch those too.
  const re2 = /<input\b[^>]*\bvalue="([^"]*)"[^>]*\bname="([^"]*ClientState)"[^>]*>/gi;
  while ((m = re2.exec(html)) !== null) {
    const name = decodeEntities(m[2]);
    if (seen.has(name)) continue;
    seen.add(name);
    out.push([name, decodeEntities(m[1])]);
  }
  return out;
}

function fmtMoney(n: number): string {
  return `$${n.toFixed(2)}`;
}

async function submitDecision(
  key: string,
  poNumber: string,
  decision: "Approve" | "Decline",
  dryRun: boolean,
): Promise<ApprovalResult> {
  if (process.env.HOLMAN_DECISION_DISABLED === "true") {
    return { success: false, confirmed: false, error: "HOLMAN_DECISION_DISABLED kill switch is active" };
  }

  await ensureSession();
  const detailUrl = `${REPAIR_DETAILS_PATH}?key=${key}&isDrilldown=True&IsShowAll=True&rowid=1`;

  // 1. GET the decision form for fresh VIEWSTATE/EVENTVALIDATION/tabStrip + radios.
  const getResp = await fetch(detailUrl, {
    headers: {
      Cookie: _sessionCookies,
      "User-Agent": UA,
      Referer: `${PORTAL_BASE}/WebForms/KPIs/DetailsListing.aspx`,
    },
    redirect: "follow",
  });
  _sessionCookies = mergeCookies(_sessionCookies, getResp);
  const getUrl: string = (getResp as any).url ?? "";
  if (/LoginForm\.aspx/i.test(getUrl)) {
    invalidateSession(); // memory + disk — leaving the disk cache would re-bounce every retry
    return { success: false, confirmed: false, error: "RepairDetails GET bounced to LoginForm — session expired" };
  }
  const detailHtml = await (getResp as any).text();

  // BLOCK DETECTION (verified live 2026-06-24): a RepairDetails page can host MULTIPLE
  // POs. e.g. truck 36570's rental PO 119412922 shares its page with repair PO 119330167,
  // which still has actionable lines. Holman won't let the rental be authorized in
  // isolation when other POs on the same page await a decision. We must NOT silently
  // approve (or claim success) in that case — flag it loudly so it's handled manually.
  const allLines = parseDecisionLines(detailHtml, decision);
  const candidates = allLines.filter((l) => l.poNumber === String(poNumber) && !l.disabled);
  const otherActionablePos = Array.from(
    new Set(allLines.filter((l) => l.poNumber !== String(poNumber) && !l.disabled).map((l) => l.poNumber)),
  );

  if (candidates.length === 0) {
    return {
      success: false,
      confirmed: false,
      error: `No actionable ${decision} radio found for PO ${poNumber} (lines may already be applied/locked)`,
    };
  }

  if (otherActionablePos.length > 0) {
    return {
      success: false,
      confirmed: false,
      blocked: true,
      blockingPos: otherActionablePos,
      error:
        `Cannot auto-${decision.toLowerCase()} rental PO ${poNumber}: its Holman repair page also has ` +
        `awaiting PO(s) ${otherActionablePos.join(", ")} (e.g. a repair PO). Holman requires those decided ` +
        `on the same page, so the rental can't be approved in isolation online — handle this one manually in Holman.`,
    };
  }

  // Build the postback. hdnRadio aggregates the selected radios, each prefixed by "|".
  const vs = extractHidden(detailHtml, "__VIEWSTATE");
  const vsg = extractHidden(detailHtml, "__VIEWSTATEGENERATOR");
  const ev = extractHidden(detailHtml, "__EVENTVALIDATION");
  const tabStrip = extractHidden(detailHtml, "ctl00_ctl00_PageTabs_tabStrip_ClientState");
  const lessee = extractHidden(detailHtml, "ctl00$ctl00$subheading$subheading$lesseeCodeControl");
  const vehicle = extractHidden(detailHtml, "ctl00$ctl00$subheading$subheading$vehicleNoControl");
  const country = extractHidden(detailHtml, "ctl00$ctl00$subheading$subheading$countryControl") || "USA";

  const body = new URLSearchParams();
  body.append("__EVENTTARGET", "");
  body.append("__EVENTARGUMENT", "");
  body.append("__VIEWSTATE", vs);
  body.append("__VIEWSTATEGENERATOR", vsg);
  body.append("__EVENTVALIDATION", ev);
  if (tabStrip) body.append("ctl00_ctl00_PageTabs_tabStrip_ClientState", tabStrip);
  body.append("ctl00$ctl00$subheading$subheading$lesseeCodeControl", lessee);
  body.append("ctl00$ctl00$subheading$subheading$vehicleNoControl", vehicle);
  body.append("ctl00$ctl00$subheading$subheading$countryControl", country);

  // Round-trip every empty Telerik *_ClientState input verbatim.
  for (const [name, value] of collectClientStateFields(detailHtml)) {
    body.append(name, value);
  }

  // Selected radio(s): post each as fieldName=value, accumulate hdnRadio and total.
  let total = 0;
  const hdnParts: string[] = [];
  for (const line of candidates) {
    const radioValue = `${line.value}_${decision}`;
    body.append(line.fieldName, radioValue);
    hdnParts.push(`|${radioValue}`);
    total += parseFloat(line.amount) || 0;
  }
  body.append("ctl00$ctl00$cp$content$RepairNotesTxt", "");
  body.append("ctl00$ctl00$cp$content$SubmitBtnLineItem", "Submit Repair Decision");
  body.append("ctl00$ctl00$cp$content$hdnRadio", hdnParts.join(""));
  body.append("ctl00$ctl00$cp$content$hdnTotalamount", fmtMoney(total));

  if (dryRun) {
    console.log(
      `[HolmanPortal] DRY RUN ${decision} — key=${key.slice(0, 16)}… po=${poNumber} ` +
        `hdnRadio=${hdnParts.join("")} total=${fmtMoney(total)} fields=${Array.from(body.keys()).length}`,
    );
    return { success: true, confirmed: false, dryRun: true };
  }

  // 2. POST the decision to the SAME URL (self-postback). Capture the response —
  //    a successful WebForms postback re-renders the page, so its body is usually
  //    the FIRST (and most atomic) confirmation evidence.
  const postResp = await fetch(detailUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: _sessionCookies,
      "User-Agent": UA,
      Referer: detailUrl,
      Origin: ORIGIN,
    },
    body: body.toString(),
    redirect: "follow",
  });
  _sessionCookies = mergeCookies(_sessionCookies, postResp);
  const postUrl: string = (postResp as any).url ?? "";
  const postHtml = await (postResp as any).text();

  // 3. Confirm the line is locked. 200 is NOT confirmation. A committed line renders
  //    its chosen radio as checked AND disabled.
  //
  //    CRITICAL (learned live 2026-07-10, PO 119673335): a confirm read can be
  //    INDETERMINATE — the session dies mid-flight (another instance/login kicked it)
  //    and the read bounces to LoginForm or yields a page with NO decision lines.
  //    That is NOT evidence the decision failed to apply: that PO's approve HAD
  //    applied in Holman while the single instant re-read missed it and the row was
  //    falsely marked approve_failed. So: only a VALID page (our PO's lines visible)
  //    with the line still ENABLED counts as "not applied"; an unreadable page forces
  //    a fresh login and a retry.
  type ConfirmState = { kind: "confirmed" | "actionable" | "indeterminate"; detail: string };
  const readState = (html: string, finalUrl: string): ConfirmState => {
    if (/LoginForm\.aspx/i.test(finalUrl)) {
      return { kind: "indeterminate", detail: "read bounced to LoginForm" };
    }
    const mine = parseDecisionLines(html, decision).filter((l) => l.poNumber === String(poNumber));
    if (mine.length === 0) {
      return { kind: "indeterminate", detail: "page had no decision lines for this PO" };
    }
    if (mine.some((l) => !l.disabled)) {
      return { kind: "actionable", detail: "line still actionable (decision not applied)" };
    }
    // Locked. A committed line disables BOTH radios but checks only the chosen one —
    // require OUR decision's radio to be the checked one, so a mid-race opposite
    // decision (someone declining while we approve) can never read as confirmed.
    return mine.every((l) => l.checked)
      ? { kind: "confirmed", detail: "line locked with our decision checked" }
      : { kind: "actionable", detail: "line locked but NOT with our decision — opposite decision appears applied; verify in Holman" };
  };

  let state = readState(postHtml, postUrl);

  // Re-read up to 3 times: indeterminate → force a fresh login first; actionable →
  // brief backoff in case Holman lags the lock. Stop as soon as the lock is seen.
  for (let attempt = 1; attempt <= 3 && state.kind !== "confirmed"; attempt++) {
    if (state.kind === "indeterminate") {
      console.warn(`[HolmanPortal] ${decision} confirm attempt ${attempt} indeterminate (${state.detail}) — re-login + re-read`);
      invalidateSession(); // memory + disk, so ensureSession truly re-logins
      try {
        await ensureSession();
      } catch (e: any) {
        console.warn(`[HolmanPortal] confirm re-login failed: ${e?.message}`);
        break; // can't read at all — report indeterminate honestly below
      }
    } else {
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
    const confirmResp = await fetch(detailUrl, {
      headers: { Cookie: _sessionCookies, "User-Agent": UA, Referer: detailUrl },
      redirect: "follow",
    });
    _sessionCookies = mergeCookies(_sessionCookies, confirmResp);
    const confirmHtml = await (confirmResp as any).text();
    state = readState(confirmHtml, (confirmResp as any).url ?? "");
  }

  const confirmed = state.kind === "confirmed";
  return {
    success: true,
    confirmed,
    error: confirmed
      ? undefined
      : state.kind === "actionable"
        ? `Decision POST returned but not confirmed: ${state.detail} — verify in Holman portal`
        : `Decision POST returned but confirmation was unreadable after retries (${state.detail}) — the decision may HAVE applied; check Holman before retrying`,
  };
}

export async function approvePoInHolman(
  key: string,
  poNumber: string,
  _amount: number, // kept for signature compatibility; amount is derived from the line radio
  dryRun = true,
): Promise<ApprovalResult> {
  try {
    return await submitDecision(key, poNumber, "Approve", dryRun);
  } catch (err: any) {
    console.error("[HolmanPortal] approvePoInHolman:", err.message);
    return { success: false, confirmed: false, error: err.message };
  }
}

// Deny IS implementable — the decline code is the human word "_Decline" (HAR-proven:
// radios render both ^seq_Approve and ^seq_Decline for each actionable line). This
// posts a real Holman decline. Callers that only want Nexus-side recording should NOT
// call this; the route's /deny currently records locally only (intentional).
export async function denyPoInHolman(
  key: string,
  poNumber: string,
  dryRun = true,
): Promise<ApprovalResult> {
  try {
    return await submitDecision(key, poNumber, "Decline", dryRun);
  } catch (err: any) {
    console.error("[HolmanPortal] denyPoInHolman:", err.message);
    return { success: false, confirmed: false, error: err.message };
  }
}

// ─── Read repair-page comment/notes text (for the "unknown driver" resolver) ──────
// READ-ONLY GET of the same RepairDetails page the approve/deny flow already uses,
// returned as plain text so the comment section (where Holman reps record who they
// actually spoke with) can be handed to the LLM extractor. Fault-isolated: never
// throws into the caller; returns { ok:false, error } on any failure.
export async function fetchRepairDetailsText(
  key: string,
): Promise<{ ok: boolean; text: string; error?: string }> {
  if (process.env.HOLMAN_DECISION_DISABLED === "true") {
    return { ok: false, text: "", error: "HOLMAN_DECISION_DISABLED" };
  }
  try {
    await ensureSession();
    const url = `${REPAIR_DETAILS_PATH}?key=${key}&isDrilldown=True&IsShowAll=True&rowid=1`;
    const resp = await fetch(url, {
      headers: {
        Cookie: _sessionCookies,
        "User-Agent": UA,
        Referer: `${PORTAL_BASE}/WebForms/KPIs/DetailsListing.aspx`,
      },
      redirect: "follow",
    });
    _sessionCookies = mergeCookies(_sessionCookies, resp);
    const respUrl: string = (resp as any).url ?? "";
    if (/LoginForm\.aspx/i.test(respUrl)) {
      invalidateSession();
      return { ok: false, text: "", error: "RepairDetails bounced to LoginForm — session expired" };
    }
    if (!resp.ok) {
      if (resp.status === 302 || resp.status === 401 || resp.status === 500) invalidateSession();
      return { ok: false, text: "", error: `RepairDetails HTTP ${resp.status}` };
    }
    const html = await (resp as any).text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
    return { ok: true, text };
  } catch (e: any) {
    console.error("[HolmanPortal] fetchRepairDetailsText:", e?.message ?? e);
    return { ok: false, text: "", error: e?.message ?? String(e) };
  }
}
