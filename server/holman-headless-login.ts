import { chromium, type Browser } from "playwright-core";
import { readdirSync, existsSync } from "fs";

// ─────────────────────────────────────────────────────────────────────────────
// Holman PRODUCTION login is JS-gated: the password POST cannot be completed over
// raw HTTP (it 302s to SiteException.aspx?code=500 because the login page's
// JavaScript establishes session state — an ARISessionId cookie, etc. — that a
// server-side fetch cannot reproduce). The DetailsListing `ID` token is likewise
// minted by the /Analytics/ Kendo dashboard (reached via a cross-app SSO bounce).
//
// So this module drives a real headless Chromium to do BOTH JS-gated steps:
//   1. the 2-step login → full cookie jar (incl. HttpOnly ASP.NET_SessionId)
//   2. harvest the dashboard TabId (USER_TEMPLATE_ID) and the POsAwaitingAuthorization
//      ID token (the {KpiId}_{token} from /Analytics/Dashboard/_Zones/{TabId})
// holman-portal-service then runs the rest (DetailsListing grid → RepairDetails →
// approve/deny postback) over pure HTTP using the harvested cookies + token.
//
// Chromium is the nix-provided playwright browser already on the box (no download).
// ─────────────────────────────────────────────────────────────────────────────

const ORIGIN = "https://insights.holman.com";
const PORTAL_BASE = `${ORIGIN}/AriAccessWeb`;
const LOGIN_ENTRY_URL = `${PORTAL_BASE}/WebForms/Login.aspx`;
const DEFAULT_URL = `${PORTAL_BASE}/default.aspx`;
const KPI_ID_NUM = "129"; // POsAwaitingAuthorization KpiId

export interface HolmanHarvest {
  cookies: string; // "name=value; …" full jar for insights.holman.com (incl HttpOnly)
  tabId: string | null; // dashboard USER_TEMPLATE_ID (e.g. 1029879), stable per account
  idToken: string | null; // {KpiId}_{token} for the awaiting-auth KPI (e.g. 129_1a5v5azzc0n)
}

function resolveChromiumPath(): string | undefined {
  // 1. Explicit pin always wins.
  const envPath = process.env.HOLMAN_CHROMIUM_PATH?.trim();
  if (envPath && existsSync(envPath)) return envPath;

  // 2. Ask playwright-core for the browser IT expects (guaranteed CDP-revision match).
  //    On the Replit dev/deploy env this resolves; in a bare shell it may not, so we
  //    fall through to a revision-aware /nix scan below.
  try {
    const p = (chromium as any).executablePath?.();
    if (p && existsSync(p)) return p;
  } catch {
    /* not resolvable in this context */
  }

  let storeDirs: string[] = [];
  try {
    storeDirs = readdirSync("/nix/store");
  } catch {
    return undefined;
  }

  // 3. Revision-aware scan. CRITICAL: playwright-core 1.55.x speaks the CDP of chromium
  //    revision 1187 (the "-with-cjk" / "playwright-chromium-cjk" nix builds). A
  //    mismatched revision (e.g. 1080 from a plain "playwright-browsers-chromium" build)
  //    speaks a slightly different protocol and makes page.evaluate return garbage —
  //    that silently broke the dashboard-token harvest and is a nondeterministic flake
  //    depending on /nix readdir order. So PREFER the cjk build, then highest chromium-NNNN.
  const candidates: { path: string; rev: number; cjk: boolean }[] = [];
  for (const d of storeDirs) {
    if (!/playwright.*chromium|playwright-browsers/i.test(d)) continue;
    const base = `/nix/store/${d}`;
    const cjk = /cjk/i.test(d);
    let subs: string[] = [];
    try {
      subs = readdirSync(base);
    } catch {
      continue;
    }
    for (const s of subs) {
      const m = s.match(/^chromium-(\d+)$/);
      if (m) {
        const p = `${base}/${s}/chrome-linux/chrome`;
        if (existsSync(p)) candidates.push({ path: p, rev: parseInt(m[1], 10), cjk });
      }
    }
    const direct = `${base}/chrome-linux/chrome`;
    if (existsSync(direct)) candidates.push({ path: direct, rev: 0, cjk });
  }
  if (candidates.length) {
    candidates.sort((a, b) => Number(b.cjk) - Number(a.cjk) || b.rev - a.rev);
    return candidates[0].path;
  }

  // 4. Fallback: a wrapped ungoogled-chromium binary.
  for (const d of storeDirs) {
    if (!/ungoogled-chromium-[0-9]/.test(d) || /sandbox$/.test(d)) continue;
    const p = `/nix/store/${d}/bin/chromium`;
    if (existsSync(p)) return p;
  }
  return undefined;
}

/**
 * Logs into Holman Insights via headless Chromium and harvests the session cookies,
 * dashboard TabId, and the awaiting-auth KPI ID token. Throws with a clear message on
 * any failure.
 */
export async function headlessHolmanLogin(): Promise<HolmanHarvest> {
  const user = process.env.HOLMAN_PORTAL_USER?.trim();
  const pass = process.env.HOLMAN_PORTAL_PASS;
  if (!user || !pass) {
    throw new Error("HOLMAN_PORTAL_USER / HOLMAN_PORTAL_PASS not set (required for headless login)");
  }

  const executablePath = resolveChromiumPath();
  // Logs MUST go to stderr (console.error/warn): when this runs inside the isolated
  // login worker, stdout is reserved for the single JSON result line.
  console.error(`[HolmanHeadless] login start user=${user} chromium=${executablePath ?? "auto"}`);
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({
      executablePath,
      headless: true,
      // Lean flag set: fewer child processes (--no-zygote) and no background work,
      // so the browser tree stays small and predictable to tear down.
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-zygote",
        "--disable-software-rasterizer",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
        "--mute-audio",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-breakpad",
      ],
    });
    const ctx = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      viewport: { width: 1440, height: 900 },
    });
    const page = await ctx.newPage();

    // ── 2-step login ──────────────────────────────────────────────────────────
    await page.goto(LOGIN_ENTRY_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForSelector('input[name="txtCXLoginLogonId"]', { timeout: 20000 });
    await page.fill('input[name="txtCXLoginLogonId"]', user);
    await Promise.all([
      page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {}),
      page.click('input[name="btnLogonId"]'),
    ]);
    await page.waitForSelector('input[name="LoginPass"]', { timeout: 20000 });
    await page.fill('input[name="LoginPass"]', pass);
    await Promise.all([
      page
        .waitForURL((u) => !/LoginForm\.aspx|\/Login\.aspx/i.test(u.toString()), { timeout: 45000 })
        .catch(() => {}),
      page.click('input[name="LoginButton1"]'),
    ]);
    await page.waitForLoadState("domcontentloaded", { timeout: 20000 }).catch(() => {});

    const landed = page.url();
    if (/SiteException/i.test(landed)) throw new Error(`Headless login hit SiteException (${landed}) — check credentials`);
    if (/LoginForm\.aspx|\/Login\.aspx/i.test(landed)) {
      throw new Error(`Headless login still on login page (${landed}) — credentials rejected`);
    }

    // Land on the portal home so the post-auth cookies are fully set.
    try {
      await page.goto(DEFAULT_URL, { waitUntil: "domcontentloaded", timeout: 25000 });
    } catch {
      /* non-fatal */
    }

    // ── Harvest TabId + the SSO bounce URL via the in-page AJAX call ───────────
    // GetDashboardTabs returns USER_TEMPLATE_ID (TabId) and a `URL` =
    // /Analytics/Account/SSO/{TabId}?SessionKey=… that establishes the cross-app
    // /Analytics session. Navigating Dashboard/Index directly bounces to LoginForm
    // (VERIFIED 2026-06-24) because the Analytics session isn't set until the SSO runs.
    let tabId: string | null = null;
    let ssoUrl: string | null = null;
    try {
      const info = await page.evaluate(async () => {
        const r = await fetch("/AriAccessWeb/default.aspx/GetDashboardTabs", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" },
          body: JSON.stringify({ userTemplateId: "" }),
        });
        const wrapper = await r.json();
        const arr = JSON.parse(wrapper.d);
        const tab = arr.find((t: any) => /my fleet info/i.test(t.TEMPLATE_NAME)) || arr[0];
        return tab
          ? { tabId: String(Math.trunc(tab.USER_TEMPLATE_ID)), ssoUrl: tab.URL || null }
          : null;
      });
      if (info) {
        tabId = info.tabId;
        ssoUrl = info.ssoUrl;
      }
    } catch (e: any) {
      console.warn("[HolmanHeadless] GetDashboardTabs/TabId harvest failed:", e?.message);
    }

    // ── Establish the /Analytics session via SSO, then harvest the ID token ────
    let idToken: string | null = null;
    if (tabId) {
      try {
        // Follow the SSO bounce (sets the Analytics session, then lands on the dashboard).
        if (ssoUrl) {
          await page.goto(ssoUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
        } else {
          await page.goto(`${ORIGIN}/Analytics/Dashboard/Index/${tabId}`, {
            waitUntil: "domcontentloaded",
            timeout: 40000,
          });
        }
        idToken = await page.evaluate(
          async ([tid, kpi]) => {
            const r = await fetch(`/Analytics/Dashboard/_Zones/${tid}?_=${Date.now()}`, {
              credentials: "include",
              headers: { "X-Requested-With": "XMLHttpRequest" },
            });
            const html = await r.text();
            const m =
              html.match(new RegExp(`data-widget-id="(${kpi}_[a-z0-9]{6,16})"`, "i")) ||
              html.match(new RegExp(`w_\\d+_(${kpi}_[a-z0-9]{6,16})`, "i"));
            return m ? m[1] : null;
          },
          [tabId, KPI_ID_NUM] as const,
        );
      } catch (e: any) {
        console.warn("[HolmanHeadless] SSO/_Zones idToken harvest failed:", e?.message);
      }
    }

    const cookies = await ctx.cookies();
    const relevant = cookies.filter((c) => c.domain.includes("holman"));
    const cookieStr = (relevant.length ? relevant : cookies).map((c) => `${c.name}=${c.value}`).join("; ");
    if (!cookieStr || !/ASP\.NET_SessionId|ARISessionId/i.test(cookieStr)) {
      throw new Error("Headless login produced no usable session cookie");
    }
    console.error(
      `[HolmanHeadless] done tabId=${tabId ?? "?"} idToken=${idToken ? "ok" : "MISSING"} cookies=${(relevant.length ? relevant : cookies).length}`,
    );
    return { cookies: cookieStr, tabId, idToken };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
