// Resolve the ACTUAL renter for a vehicle from Holman's "View Rental Request"
// (Tyler 2026-07-11). When the awaiting-auth grid shows the driver as
// "UNKNOWN", the real renter is in the PO's Rental Request box: Maintenance
// tab -> the rental PO -> View Rental Request. That data lives on the newer
// AriAccessWeb3 / InsightsCore SPA, whose session the KPI-grid cookie login
// does NOT carry, so we drive it in a real headless browser (isolated child
// process, same pattern as holman-login-worker).
//
// Chain (ported from LIVHR server/services/holman-renter.ts, proven 2026-06):
//   1. goto MTREACT deep link for the vehicle; log in if it bounces.
//   2. read the ?key= off the redirected svc-history SPA URL.
//   3. GET InsightsCore/api/Decryption/get-info?key=... -> { token, userId, ... }.
//   4. POST InsightsCore/api/SVCHistory/get-svc-hstry-details (Bearer token).
//   5. entries with rentalRequestExists===true -> GET openRentalRequestWindow
//      -> renter lives in a #jsonDataMain hidden JSON blob (DriverName/Phone/...).
// The API-chain steps run INSIDE the authenticated page (cookies + Bearer).
import { chromium, type Browser } from "playwright-core";
// Chromium resolution lives in exactly one place; see server/chromium-path.ts.
import { requireChromiumPath } from "./chromium-path";

export interface RenterResult {
  vehicle: string;
  po: string | null;
  renterName: string | null;
  renterPhone: string | null;
  city: string | null;
  state: string | null;
  error?: string;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

const clean = (v: unknown): string | null => {
  if (typeof v !== "string") return v == null ? null : String(v);
  const t = v.trim();
  return t === "" ? null : t;
};

export function parseRenterBlob(raw: string | null | undefined): { name: string | null; phone: string | null; city: string | null; state: string | null } | null {
  if (!raw) return null;
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(decodeEntities(raw));
  } catch {
    return null;
  }
  return {
    name: clean(j.DriverName),
    phone: clean(j.Phone),
    city: clean(j.City),
    state: clean(j.State),
  };
}

/**
 * Resolve renters for one or more vehicles in a single headless session.
 * Login happens once; later vehicles reuse the page. Fault-isolated: any
 * failure yields a row with `error` set and null renter, never throws.
 */
export async function resolveRentersHeadless(vehicles: string[]): Promise<RenterResult[]> {
  const user = process.env.HOLMAN_PORTAL_USER?.trim();
  const pass = process.env.HOLMAN_PORTAL_PASS;
  const lessee = process.env.HOLMAN_LESSEE_CODE?.trim() || "2B56";
  if (!user || !pass) throw new Error("HOLMAN_PORTAL_USER / HOLMAN_PORTAL_PASS not set");

  const executablePath = requireChromiumPath("HolmanRenterResolver");
  console.error(`[HolmanRenter] resolving ${vehicles.length} vehicle(s) (credentials present)`);
  let browser: Browser | null = null;
  const results: RenterResult[] = [];
  try {
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: [
        "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
        "--disable-gpu", "--no-zygote", "--disable-software-rasterizer",
        "--disable-extensions", "--disable-background-networking",
        "--mute-audio", "--no-first-run", "--no-default-browser-check", "--disable-breakpad",
      ],
    });
    const ctx = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      viewport: { width: 1440, height: 900 },
    });
    const page = await ctx.newPage();

    const onLoginForm = async () =>
      page.evaluate(() => !!document.getElementById("txtCXLoginLogonId")).catch(() => false);

    const doLogin = async () => {
      await page.waitForSelector("#txtCXLoginLogonId", { state: "visible", timeout: 20000 });
      await page.fill("#txtCXLoginLogonId", user);
      await Promise.all([
        page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {}),
        page.click("#btnLogonId"),
      ]);
      await page.waitForSelector('input[type="password"]', { state: "visible", timeout: 20000 });
      await page.fill('input[type="password"]', pass);
      await Promise.all([
        page.waitForLoadState("domcontentloaded", { timeout: 35000 }).catch(() => {}),
        page.click('input[type="submit"], button[type="submit"], input[name="LoginButton1"]'),
      ]);
      await page.waitForTimeout(2500);
    };

    for (const vehicle of vehicles) {
      const mtUrl = `https://insights.holman.com/AriAccessWeb3/WebForms/UrlRedirector.aspx?func=MTREACT&lessee=${encodeURIComponent(lessee)}&vehicle=${encodeURIComponent(vehicle)}&language=en-US&country=USA`;
      try {
        await page.goto(mtUrl, { waitUntil: "networkidle", timeout: 40000 });
        if (await onLoginForm()) {
          await doLogin();
          await page.goto(mtUrl, { waitUntil: "networkidle", timeout: 40000 });
        }
        const key = new URL(page.url()).searchParams.get("key");
        if (!key) {
          results.push({ vehicle, po: null, renterName: null, renterPhone: null, city: null, state: null, error: `no svc-history key (url=${page.url().slice(0, 80)})` });
          continue;
        }

        const chain: any = await page.evaluate(async (k: string) => {
          const out: any = { rentals: [] };
          try {
            const gi = await fetch(`https://insights.holman.com/InsightsCore/api/Decryption/get-info?key=${encodeURIComponent(k)}`, { credentials: "include" });
            if (gi.status !== 200) { out.err = `get-info ${gi.status}`; return out; }
            const info = await gi.json();
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (info.token) headers["Authorization"] = `Bearer ${info.token}`;
            const sd = await fetch("https://insights.holman.com/InsightsCore/api/SVCHistory/get-svc-hstry-details", {
              method: "POST", headers, credentials: "include",
              body: JSON.stringify({ userId: info.userId, sessionId: info.sessionId, lesseeCode: info.lesseeCode, vehicleNo: info.vehicleNo, isFilterOn: false, selectedFilters: "", sortColumn: "", accessWebBaseURL: "https://insights.holman.com/AriAccessWeb3", hasDRFunc: true, format: true }),
            });
            if (sd.status !== 200) { out.err = `svc ${sd.status}`; return out; }
            const svc = await sd.json();
            const hist = svc.serviceHistorys || svc.serviceHistory || [];
            const rentals = hist.filter((h: any) => h.rentalRequestExists === true).slice(0, 6);
            for (const h of rentals) {
              const row: any = { po: h.poNumber, renterRaw: null };
              const u = h.openRentalRequestWindow;
              if (u) {
                try {
                  const rr = await fetch(u, { credentials: "include" });
                  const txt = await rr.text();
                  const m = txt.match(/id="jsonDataMain"[^>]*value="([^"]*)"/i) || txt.match(/value="([^"]*)"[^>]*id="jsonDataMain"/i);
                  row.renterRaw = m ? m[1] : null;
                } catch (e: any) { row.rrErr = String(e?.message ?? e); }
              }
              out.rentals.push(row);
            }
          } catch (e: any) { out.err = String(e?.message ?? e); }
          return out;
        }, key);

        if (chain.err) {
          results.push({ vehicle, po: null, renterName: null, renterPhone: null, city: null, state: null, error: chain.err });
          continue;
        }
        if (!chain.rentals?.length) {
          results.push({ vehicle, po: null, renterName: null, renterPhone: null, city: null, state: null, error: "no rental request on any service-history entry" });
          continue;
        }
        for (const row of chain.rentals) {
          const parsed = parseRenterBlob(row.renterRaw);
          results.push({
            vehicle, po: row.po ?? null,
            renterName: parsed?.name ?? null, renterPhone: parsed?.phone ?? null,
            city: parsed?.city ?? null, state: parsed?.state ?? null,
            error: parsed?.name ? undefined : (row.rrErr || "rental request not parsed"),
          });
        }
      } catch (e: any) {
        results.push({ vehicle, po: null, renterName: null, renterPhone: null, city: null, state: null, error: String(e?.message ?? e) });
      }
    }
    return results;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
