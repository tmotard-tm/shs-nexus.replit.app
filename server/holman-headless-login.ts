import { chromium, type Browser } from "playwright-core";
// Chromium resolution lives in exactly one place; see server/chromium-path.ts.
import { resolveChromiumPath } from "./chromium-path";
import { existsSync } from "fs";

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
  console.error(`[HolmanHeadless] login start (credentials present) chromium=${executablePath ?? "auto"}`);
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
    // The in-page AJAX NEVER throws — it returns a diagnostic envelope so a prod failure
    // (e.g. an HTML login page instead of the expected JSON) is logged, not silent. Retry
    // once (re-landing on the portal home) to tolerate a not-yet-warm session.
    for (let attempt = 1; attempt <= 2 && !tabId; attempt++) {
      const res = await page.evaluate(async () => {
        try {
          const r = await fetch("/AriAccessWeb/default.aspx/GetDashboardTabs", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" },
            body: JSON.stringify({ userTemplateId: "" }),
          });
          const contentType = r.headers.get("content-type") || "";
          const body = await r.text();
          let tabId: string | null = null;
          let ssoUrl: string | null = null;
          try {
            const wrapper = JSON.parse(body);
            const arr = JSON.parse(wrapper.d);
            const tab = arr.find((t: any) => /my fleet info/i.test(t.TEMPLATE_NAME)) || arr[0];
            if (tab) {
              tabId = String(Math.trunc(tab.USER_TEMPLATE_ID));
              ssoUrl = tab.URL || null;
            }
          } catch {
            /* body was not the expected JSON envelope (e.g. a login page) */
          }
          return { status: r.status, contentType, snippet: body.slice(0, 200), tabId, ssoUrl };
        } catch (e: any) {
          return { status: 0, contentType: "", snippet: `fetch threw: ${e?.message || e}`, tabId: null, ssoUrl: null };
        }
      });
      if (res.tabId) {
        tabId = res.tabId;
        ssoUrl = res.ssoUrl;
      } else {
        console.warn(
          `[HolmanHeadless] GetDashboardTabs harvest attempt ${attempt} yielded no TabId ` +
            `(status=${res.status} type=${res.contentType} body="${res.snippet.replace(/\s+/g, " ").trim()}")`,
        );
        if (attempt < 2) {
          try {
            await page.goto(DEFAULT_URL, { waitUntil: "domcontentloaded", timeout: 25000 });
            await page.waitForTimeout(1500);
          } catch {
            /* non-fatal */
          }
        }
      }
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
        const zres = await page.evaluate(
          async ([tid, kpi]) => {
            try {
              const r = await fetch(`/Analytics/Dashboard/_Zones/${tid}?_=${Date.now()}`, {
                credentials: "include",
                headers: { "X-Requested-With": "XMLHttpRequest" },
              });
              const html = await r.text();
              const m =
                html.match(new RegExp(`data-widget-id="(${kpi}_[a-z0-9]{6,16})"`, "i")) ||
                html.match(new RegExp(`w_\\d+_(${kpi}_[a-z0-9]{6,16})`, "i"));
              return { status: r.status, len: html.length, idToken: m ? m[1] : null, err: "" };
            } catch (e: any) {
              return { status: 0, len: 0, idToken: null, err: String(e?.message || e) };
            }
          },
          [tabId, KPI_ID_NUM] as const,
        );
        idToken = zres.idToken;
        if (!idToken) {
          console.warn(
            `[HolmanHeadless] _Zones idToken harvest yielded none ` +
              `(status=${zres.status} len=${zres.len}${zres.err ? ` err=${zres.err}` : ""})`,
          );
        }
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
