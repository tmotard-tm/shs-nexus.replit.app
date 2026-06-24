import { fetch } from "undici";

const PORTAL_BASE = "https://insights.holman.com/AriAccessWeb";
const KPI_URL = `${PORTAL_BASE}/WebForms/KPIs/DetailsListing.aspx?KpiName=POsAwaitingAuthorization`;
const LOGIN_URL = `${PORTAL_BASE}/WebForms/Login.aspx`;

let _sessionCookies: string = "";
let _sessionExpiry: Date | null = null;

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
}

export interface ApprovalResult {
  success: boolean;
  confirmed: boolean;
  dryRun?: boolean;
  error?: string;
}

// ─── Cookie jar ───────────────────────────────────────────────────────────────

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
  const patterns = [
    new RegExp(`id="${name}"[^>]*value="([^"]*)"`, "i"),
    new RegExp(`name="${name}"[^>]*value="([^"]*)"`, "i"),
    new RegExp(`value="([^"]*)"[^>]*name="${name}"`, "i"),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return m[1];
  }
  return "";
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function parseAmount(s: string): number {
  return parseFloat(s.replace(/[$,\s]/g, "")) || 0;
}

function extractKeys(html: string): string[] {
  const keys: string[] = [];
  const re = /RepairDetails\.aspx\?key=([a-zA-Z0-9]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) keys.push(m[1]);
  return keys;
}

function parseGridRows(html: string): string[][] {
  const rows: string[][] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trM: RegExpExecArray | null;
  while ((trM = trRe.exec(html)) !== null) {
    const row = trM[1];
    if (/<th[\s>]/i.test(row)) continue;
    const cells: string[] = [];
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let tdM: RegExpExecArray | null;
    while ((tdM = tdRe.exec(row)) !== null) cells.push(stripTags(tdM[1]));
    if (cells.length >= 6) rows.push(cells);
  }
  return rows;
}

// ─── Session management ───────────────────────────────────────────────────────

async function ensureSession(): Promise<void> {
  const user = process.env.HOLMAN_PORTAL_USER ?? "";
  const pass = process.env.HOLMAN_PORTAL_PASS ?? "";
  if (!user || !pass) throw new Error("HOLMAN_PORTAL_USER / HOLMAN_PORTAL_PASS env vars not set");
  if (_sessionExpiry && _sessionExpiry > new Date()) return;

  console.log("[HolmanPortal] Logging in…");
  const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

  const loginGet = await fetch(LOGIN_URL, { headers: { "User-Agent": ua } });
  _sessionCookies = mergeCookies("", loginGet);
  const loginHtml = await (loginGet as any).text();

  const vs  = extractHidden(loginHtml, "__VIEWSTATE");
  const vsg = extractHidden(loginHtml, "__VIEWSTATEGENERATOR");
  const ev  = extractHidden(loginHtml, "__EVENTVALIDATION");

  const body = new URLSearchParams({
    __VIEWSTATE: vs, __VIEWSTATEGENERATOR: vsg, __EVENTVALIDATION: ev,
    "ctl00$MainContent$txtUserName": user,
    "ctl00$MainContent$txtPassword": pass,
    "ctl00$MainContent$btnLogin": "Login",
  });

  const loginPost = await fetch(LOGIN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cookie": _sessionCookies, "User-Agent": ua, "Referer": LOGIN_URL,
    },
    body: body.toString(),
    redirect: "follow",
  });
  _sessionCookies = mergeCookies(_sessionCookies, loginPost);

  const hasSession = /ASP\.NET_SessionId|ASPSESSIONId|\.ASPXAUTH/i.test(_sessionCookies);
  if (!hasSession) {
    _sessionCookies = "";
    throw new Error("[HolmanPortal] Login failed — no session cookie. Check HOLMAN_PORTAL_USER/PASS.");
  }
  _sessionExpiry = new Date(Date.now() + 25 * 60 * 1000);
  console.log("[HolmanPortal] Session established");
}

// ─── Scrape awaiting-auth queue ───────────────────────────────────────────────

export async function scrapeAwaitingAuth(): Promise<ScrapeResult> {
  const scrapedAt = new Date();
  try {
    await ensureSession();
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

    const resp = await fetch(KPI_URL, {
      headers: { "Cookie": _sessionCookies, "User-Agent": ua, "Referer": `${PORTAL_BASE}/WebForms/Home.aspx` },
    });
    _sessionCookies = mergeCookies(_sessionCookies, resp);

    if (!resp.ok) {
      if (resp.status === 302 || resp.status === 401) { _sessionExpiry = null; }
      throw new Error(`[HolmanPortal] KPI page HTTP ${resp.status} — session may have expired`);
    }

    const html = await (resp as any).text();
    const keys = extractKeys(html);
    const gridRows = parseGridRows(html);

    // Column order for POsAwaitingAuthorization:
    // 0=Vehicle, 1=Driver, 2=Vendor, 3=AddlReqAmt, 4=ApprovedAmt,
    // 5=PODate, 6=Repair#, 7=PO#, 8=Submitted, 9=ApprovalProcess, 10=Division, 11=DriverEmail
    const pos: HolmanPortalPO[] = [];
    let keyIdx = 0;

    for (const cells of gridRows) {
      const vehicleNumber    = cells[0] ?? "";
      const driverName       = cells[1] ?? "";
      const vendorName       = cells[2] ?? "";
      const additionalAmt    = parseAmount(cells[3] ?? "0");
      const approvedAmt      = parseAmount(cells[4] ?? "0");
      const poDate           = cells[5] ?? "";
      const repairNumber     = cells[6] ?? "";
      const poNumber         = cells[7] ?? "";
      const submittedDate    = cells[8] ?? "";
      const approvalProcess  = cells[9] ?? "";
      const division         = cells[10] ?? "";

      const key = keys[keyIdx] ?? "";
      keyIdx++;

      if (!poNumber) continue;

      // Filter: Enterprise Rent-A-Car rows only (vendor name or division RF)
      const isRental =
        /enterprise|rent.?a.?car|erac/i.test(vendorName) ||
        /^RF$/i.test(division.trim());
      if (!isRental) continue;

      pos.push({
        key, poNumber, repairNumber, vehicleNumber, driverName,
        vendorName, division, additionalRequestedAmt: additionalAmt,
        approvedAmount: approvedAmt, poDate, submittedDate, approvalProcess,
      });
    }

    console.log(`[HolmanPortal] ${gridRows.length} grid rows → ${pos.length} rental POs`);
    return { rows: pos, scrapedAt };
  } catch (err: any) {
    console.error("[HolmanPortal] scrapeAwaitingAuth:", err.message);
    return { rows: [], scrapedAt, error: err.message };
  }
}

// ─── Approve a PO via WebForms postback ──────────────────────────────────────

export async function approvePoInHolman(
  key: string,
  poNumber: string,
  amount: number,
  dryRun = true,
): Promise<ApprovalResult> {
  if (process.env.HOLMAN_DECISION_DISABLED === "true") {
    return { success: false, confirmed: false, error: "HOLMAN_DECISION_DISABLED kill switch is active" };
  }
  if (dryRun) {
    console.log(`[HolmanPortal] DRY RUN approve — key=${key} po=${poNumber} amt=${amount}`);
    return { success: true, confirmed: false, dryRun: true };
  }

  try {
    await ensureSession();
    const ua  = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
    const detailUrl = `${PORTAL_BASE}/WebForms/Details/RepairDetails.aspx?key=${key}`;

    // 1. GET detail page for fresh VIEWSTATE + lineId
    const getResp = await fetch(detailUrl, {
      headers: { "Cookie": _sessionCookies, "User-Agent": ua, "Referer": KPI_URL },
    });
    _sessionCookies = mergeCookies(_sessionCookies, getResp);
    const detailHtml = await (getResp as any).text();

    const vs  = extractHidden(detailHtml, "__VIEWSTATE");
    const vsg = extractHidden(detailHtml, "__VIEWSTATEGENERATOR");
    const ev  = extractHidden(detailHtml, "__EVENTVALIDATION");
    const cs  = extractHidden(detailHtml, "__ClientState");

    // Extract lineId from the approval radio buttons
    let lineId = "";
    const radioMatch = detailHtml.match(/value="(\d+)\^[^"]+\^[^"]+\^2_Approve"/i);
    if (radioMatch) lineId = radioMatch[1];
    if (!lineId) {
      const hdnMatch = detailHtml.match(/id="ctl00\$ctl00\$cp\$content\$hdnRadio"[^>]*value="(\d+)\^/i);
      if (hdnMatch) lineId = hdnMatch[1];
    }
    if (!lineId) return { success: false, confirmed: false, error: "Cannot extract lineId from RepairDetails page — cannot submit approval" };

    // 2. POST approval
    const postBody = new URLSearchParams({
      __VIEWSTATE: vs, __VIEWSTATEGENERATOR: vsg,
      __EVENTVALIDATION: ev, __ClientState: cs,
      "ctl00$ctl00$cp$content$hdnRadio": `${lineId}^${poNumber}^${amount}^2_Approve`,
      SubmitBtnLineItem: "Submit Repair Decision",
    });

    await fetch(detailUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Cookie": _sessionCookies, "User-Agent": ua, "Referer": detailUrl,
      },
      body: postBody.toString(),
    });

    // 3. Re-read to confirm (202 alone is NOT confirmed — lesson from district change feature)
    const confirmResp = await fetch(detailUrl, {
      headers: { "Cookie": _sessionCookies, "User-Agent": ua },
    });
    _sessionCookies = mergeCookies(_sessionCookies, confirmResp);
    const confirmHtml = await (confirmResp as any).text();

    const confirmed = /status[^>]*approved|approval.*approved|authorized/i.test(confirmHtml);
    return {
      success: true,
      confirmed,
      error: confirmed ? undefined : "Submission accepted but approval not confirmed on re-read — verify in Holman portal",
    };
  } catch (err: any) {
    console.error("[HolmanPortal] approvePoInHolman:", err.message);
    return { success: false, confirmed: false, error: err.message };
  }
}
