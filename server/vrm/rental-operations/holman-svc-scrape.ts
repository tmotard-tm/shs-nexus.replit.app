// On-demand Holman svc-history scraper (Phase 3). Clones the proven
// resolveRentersHeadless chain (server/holman-renter-resolver.ts) but returns
// the FULL serviceHistorys array per vehicle (POs + MSG message trail + notes +
// vendor phone/address), not just rental rows. Drives a real headless Chromium
// (single shared HOLMAN_PORTAL_USER/PASS). Meant to run in an ISOLATED CHILD
// process (holman-svc-scrape-worker.ts), never in the Express request handler.
import { chromium, type Browser } from "playwright-core";
// Chromium resolution lives in exactly one place; see server/chromium-path.ts.
import { requireChromiumPath } from "../../chromium-path";

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

  const executablePath = requireChromiumPath("HolmanSvcScrape");
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


/** One "View Rental Request" page, read behind a rental PO. */
export interface RentalRequestResult {
  vehicle: string;
  url: string;
  /** Best-effort renter parsed off the page. NULL means "could not parse", never "nobody". */
  renterName: string | null;
  /** Every label/value pair we could see, so the caller can decide without a reparse. */
  fields: Record<string, string>;
  /** Full visible text, for auditing a parse that looks wrong. */
  text: string | null;
  /** PNG data URI. Held in memory and returned to the caller; NOT persisted here. */
  screenshot: string | null;
  error?: string;
}

/**
 * Open the "View Rental Request" page that hangs off a rental PO and read the
 * renter off it.
 *
 * WHY THIS EXISTS. Every other name Nexus can reach is keyed to the TRUCK
 * (Holman assigned driver, TPMS, roster truck_lu, PO driver-of-record) and a
 * truck outlives its drivers, so all of them go stale the moment a rental
 * changes hands. This page is the only surface keyed to the RENTAL itself.
 * Verified 2026-08-06: truck 36177 shows Mike Schaeffer in the assigned-driver
 * field, in the PO notes and in the PO driver stamp, and the rental request
 * itself is Matthew Nish.
 *
 * The parse is DELIBERATELY best-effort and the screenshot is the real payload.
 * We do not control this page's markup and it is not worth pretending a regex
 * over someone else's ASP.NET form is authoritative. A null renterName with a
 * screenshot is an honest answer; a confident wrong name is not.
 */
export async function scrapeRentalRequests(
  items: { vehicle: string; url: string }[],
): Promise<RentalRequestResult[]> {
  const user = process.env.HOLMAN_PORTAL_USER?.trim();
  const pass = process.env.HOLMAN_PORTAL_PASS;
  if (!user || !pass) throw new Error("HOLMAN_PORTAL_USER / HOLMAN_PORTAL_PASS not set");

  const executablePath = requireChromiumPath("HolmanRentalRequest");
  console.error(`[HolmanRentalRequest] reading ${items.length} rental request page(s)`);
  let browser: Browser | null = null;
  const results: RentalRequestResult[] = [];
  try {
    browser = await chromium.launch({
      executablePath, headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
        "--no-zygote", "--disable-software-rasterizer", "--disable-extensions",
        "--disable-background-networking", "--mute-audio", "--no-first-run", "--no-default-browser-check", "--disable-breakpad"],
    });
    const ctx = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      viewport: { width: 1280, height: 900 },
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

    for (const { vehicle, url } of items) {
      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 40000 });
        if (await onLoginForm()) { await doLogin(); await page.goto(url, { waitUntil: "networkidle", timeout: 40000 }); }
        await page.waitForTimeout(800);

        const scraped: { fields: Record<string, string>; text: string } = await page.evaluate(() => {
          const fields: Record<string, string> = {};
          // ASP.NET detail forms render either <label>/<span> pairs or 2-cell <tr>s.
          document.querySelectorAll("tr").forEach((tr) => {
            const cells = Array.from(tr.querySelectorAll("td,th")).map((c) => (c.textContent || "").trim());
            if (cells.length === 2 && cells[0] && cells[1] && cells[0].length < 60) {
              fields[cells[0].replace(/[:*]\s*$/, "")] = cells[1];
            }
          });
          document.querySelectorAll("label").forEach((l) => {
            const key = (l.textContent || "").trim().replace(/[:*]\s*$/, "");
            if (!key || key.length > 60) return;
            const forId = l.getAttribute("for");
            const el = forId ? document.getElementById(forId) : (l.nextElementSibling as HTMLElement | null);
            const val = el ? ((el as HTMLInputElement).value || el.textContent || "").trim() : "";
            if (val) fields[key] = val;
          });
          return { fields, text: (document.body.innerText || "").slice(0, 20000) };
        });

        // Prefer an explicitly driver/renter-labelled field. Anything else is a guess.
        const NAME_LABEL = /(driver|renter|operator|employee|contact)\s*(name)?/i;
        let renterName: string | null = null;
        for (const [k, v] of Object.entries(scraped.fields)) {
          if (NAME_LABEL.test(k) && /[A-Za-z]{2,}/.test(v) && v.length < 60) { renterName = v.trim(); break; }
        }

        const shot = await page.screenshot({ fullPage: true, type: "png" }).catch(() => null);
        results.push({
          vehicle, url, renterName, fields: scraped.fields, text: scraped.text,
          screenshot: shot ? `data:image/png;base64,${shot.toString("base64")}` : null,
        });
      } catch (e: any) {
        results.push({ vehicle, url, renterName: null, fields: {}, text: null, screenshot: null,
          error: e?.message || String(e) });
      }
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  return results;
}
