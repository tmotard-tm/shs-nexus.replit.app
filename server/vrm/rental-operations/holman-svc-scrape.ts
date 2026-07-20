// On-demand Holman svc-history scraper (Phase 3). Clones the proven
// resolveRentersHeadless chain (server/holman-renter-resolver.ts) but returns
// the FULL serviceHistorys array per vehicle (POs + MSG message trail + notes +
// vendor phone/address), not just rental rows. Drives a real headless Chromium
// (single shared HOLMAN_PORTAL_USER/PASS). Meant to run in an ISOLATED CHILD
// process (holman-svc-scrape-worker.ts), never in the Express request handler.
import { chromium, type Browser } from "playwright-core";

function resolveChromiumPath(): string | undefined {
  return process.env.HOLMAN_CHROMIUM_PATH?.trim() || undefined;
}

export interface SvcHistoryResult {
  vehicle: string;
  hist: any[] | null;   // raw serviceHistorys entries
  error?: string;
}

/** Scrape full svc-history for one or more vehicles in a single headless session. */
export async function scrapeVehicleHistories(vehicles: string[]): Promise<SvcHistoryResult[]> {
  const user = process.env.HOLMAN_PORTAL_USER?.trim();
  const pass = process.env.HOLMAN_PORTAL_PASS;
  const lessee = process.env.HOLMAN_LESSEE_CODE?.trim() || "2B56";
  if (!user || !pass) throw new Error("HOLMAN_PORTAL_USER / HOLMAN_PORTAL_PASS not set");

  const executablePath = resolveChromiumPath();
  console.error(`[HolmanSvcScrape] scraping ${vehicles.length} vehicle(s) (creds present)`);
  let browser: Browser | null = null;
  const results: SvcHistoryResult[] = [];
  try {
    browser = await chromium.launch({
      executablePath, headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
        "--no-zygote", "--disable-software-rasterizer", "--disable-extensions",
        "--disable-background-networking", "--mute-audio", "--no-first-run", "--no-default-browser-check", "--disable-breakpad"],
    });
    const ctx = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      viewport: { width: 1440, height: 900 },
    });
    const page = await ctx.newPage();

    const onLoginForm = async () => page.evaluate(() => !!document.getElementById("txtCXLoginLogonId")).catch(() => false);
    const doLogin = async () => {
      await page.waitForSelector("#txtCXLoginLogonId", { state: "visible", timeout: 20000 });
      await page.fill("#txtCXLoginLogonId", user);
      await Promise.all([page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {}), page.click("#btnLogonId")]);
      await page.waitForSelector('input[type="password"]', { state: "visible", timeout: 20000 });
      await page.fill('input[type="password"]', pass);
      await Promise.all([page.waitForLoadState("domcontentloaded", { timeout: 35000 }).catch(() => {}),
        page.click('input[type="submit"], button[type="submit"], input[name="LoginButton1"]')]);
      await page.waitForTimeout(2500);
    };

    for (const vehicle of vehicles) {
      const mtUrl = `https://insights.holman.com/AriAccessWeb3/WebForms/UrlRedirector.aspx?func=MTREACT&lessee=${encodeURIComponent(lessee)}&vehicle=${encodeURIComponent(vehicle)}&language=en-US&country=USA`;
      try {
        await page.goto(mtUrl, { waitUntil: "networkidle", timeout: 40000 });
        if (await onLoginForm()) { await doLogin(); await page.goto(mtUrl, { waitUntil: "networkidle", timeout: 40000 }); }
        const key = new URL(page.url()).searchParams.get("key");
        if (!key) { results.push({ vehicle, hist: null, error: `no svc-history key (url=${page.url().slice(0, 80)})` }); continue; }

        const chain: any = await page.evaluate(async (k: string) => {
          const out: any = { hist: null, err: null };
          try {
            const gi = await fetch(`https://insights.holman.com/InsightsCore/api/Decryption/get-info?key=${encodeURIComponent(k)}`, { credentials: "include" });
            if (gi.status !== 200) { out.err = `get-info ${gi.status}`; return out; }
            const info = await gi.json();
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (info.token) headers["Authorization"] = `Bearer ${info.token}`;
            const sd = await fetch("https://insights.holman.com/InsightsCore/api/SVCHistory/get-svc-hstry-details", {
              method: "POST", headers, credentials: "include",
              body: JSON.stringify({ userId: info.userId, sessionId: info.sessionId, lesseeCode: info.lesseeCode, vehicleNo: info.vehicleNo, isFilterOn: false, getAll: true, selectedFilters: "", sortColumn: "", accessWebBaseURL: "https://insights.holman.com/AriAccessWeb3", hasDRFunc: true, format: true }),
            });
            if (sd.status !== 200) { out.err = `svc ${sd.status}`; return out; }
            const svc = await sd.json();
            out.hist = svc.serviceHistorys || svc.serviceHistory || [];
            out.debug = { vehicleNo: info.vehicleNo, svcKeys: Object.keys(svc || {}), histLen: (out.hist || []).length };
          } catch (e: any) { out.err = String(e?.message ?? e); }
          return out;
        }, key);

        if (chain.debug) console.error(`[HolmanSvcScrape] ${vehicle} debug:`, JSON.stringify(chain.debug));
        if (chain.err) { results.push({ vehicle, hist: null, error: chain.err }); continue; }
        results.push({ vehicle, hist: Array.isArray(chain.hist) ? chain.hist : [] });
      } catch (e: any) {
        results.push({ vehicle, hist: null, error: e?.message || String(e) });
      }
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  return results;
}
