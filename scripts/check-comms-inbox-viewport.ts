/**
 * Regression guard for Task #767/#768: the Fleet Communications inbox must fit
 * small 13" laptop viewports with the composer on-screen.
 *
 * What broke before: the inbox pane used viewport math (100dvh minus a
 * hardcoded 220px, with a 420px floor) and the header toolbar wrapped to 2-3
 * rows, so on small screens the send button fell below the fold and the page
 * scrolled. Task #767 fixed it with a flex chain:
 *   /fleet-communications route -> MainContent h-[100dvh]
 *   page container: h-full min-h-0 flex flex-col overflow-hidden
 *   inbox pane:     flex-1 min-h-0
 * plus a "..." toolbar overflow menu below the 2xl breakpoint and a
 * single-row horizontally scrolling category tab strip.
 *
 * This script loads /fleet-communications headless at 1280x720 AND 1024x576
 * (the second, smaller viewport is what exposes reintroduced hardcoded height
 * math — a fixed calc() can coincidentally match the flex height at one
 * size, but its min-height floor overflows the smaller one), opens a real
 * thread at each size, and asserts:
 *   1. no page-level scroll (document scrollHeight <= viewport height)
 *   2. the inbox pane's bottom edge lands near the viewport bottom (the
 *      flex-1 fill), never past it
 *   3. the composer send button's bounding box is fully inside the viewport
 *   4. the category tab strip stays a single row
 *   5. the "..." overflow menu button is visible while the full (>=2xl)
 *      toolbar buttons are hidden
 *
 * Auth: mints a short-lived throwaway row in the `sessions` table (the server
 * reads DATABASE_URL — NOT DEV_DATABASE_URL; see
 * .agents/memory/sso-gated-verification.md) for an existing developer/admin
 * user, hands the sessionId cookie to headless Chromium, and deletes the row
 * afterwards (finally-block, so it is revoked even when assertions fail).
 *
 * Requires the dev server ("Start application" workflow / `npm run dev`) to be
 * serving on BASE_URL (default http://localhost:5000); fails fast with a clear
 * message when it is not.
 *
 * Run: npx tsx scripts/check-comms-inbox-viewport.ts
 * Registered as the `comms-inbox-viewport` validation command.
 */
import { chromium } from "playwright-core";
import type { Browser } from "playwright-core";
import { randomBytes } from "crypto";
import { Pool } from "pg";
import { resolveChromiumPath } from "../server/chromium-path";

const BASE_URL = (process.env.BASE_URL || "http://localhost:5000").replace(/\/+$/, "");
const PAGE_PATH = "/fleet-communications";
const NAV_TIMEOUT_MS = 45_000;
const SELECTOR_TIMEOUT_MS = 30_000;
// Both sizes sit below the 2xl (1536px) breakpoint, so the overflow-menu
// expectations are identical at each.
const VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 1024, height: 576 },
];
// The pane should absorb all remaining height. Its bottom edge sits above the
// page container's bottom padding (p-4 md:p-6 => up to 24px); 48px of slack
// tolerates that padding plus rounding without letting a shrunken pane pass.
const PANE_FILL_SLACK_PX = 48;

type Failure = { check: string; detail: string };
const failures: Failure[] = [];
function assertCheck(ok: boolean, check: string, detail: string) {
  if (ok) {
    console.log(`  PASS  ${check} — ${detail}`);
  } else {
    console.error(`  FAIL  ${check} — ${detail}`);
    failures.push({ check, detail });
  }
}

async function checkAtViewport(browser: Browser, sessionId: string, viewport: { width: number; height: number }): Promise<void> {
  const label = `${viewport.width}x${viewport.height}`;
  const url = new URL(BASE_URL);
  const context = await browser.newContext({ viewport });
  try {
    await context.addCookies([
      {
        name: "sessionId",
        value: sessionId,
        domain: url.hostname,
        path: "/",
        httpOnly: true,
        secure: url.protocol === "https:",
        sameSite: "Lax",
      },
    ]);
    const page = await context.newPage();
    page.setDefaultTimeout(SELECTOR_TIMEOUT_MS);
    await page.goto(`${BASE_URL}${PAGE_PATH}`, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });

    // The category tab strip renders once /api/fs/comms/config resolves — its
    // presence proves we are past auth AND past the comms access gate.
    await page.waitForSelector('[data-testid="tab-all"]', { timeout: SELECTOR_TIMEOUT_MS });

    // Guard against having been bounced to the login card instead.
    const loginVisible = await page.locator('input[type="password"]').first().isVisible().catch(() => false);
    if (loginVisible) {
      throw new Error("Landed on the login page — the minted session was not accepted (check DATABASE_URL vs the DB the server reads).");
    }

    // ── List state: toolbar + tab-row + no page scroll ───────────────────────
    console.log(`\n[list state @ ${label}]`);

    const overflowVisible = await page.locator('[data-testid="button-toolbar-overflow"]').isVisible();
    assertCheck(overflowVisible, `overflow-menu-visible@${label}`, `"..." toolbar overflow button visible below 2xl: ${overflowVisible}`);

    // The full (>=2xl) toolbar buttons must be hidden at these widths.
    // `button-bulk-send` and `button-sync-contacts` render for every
    // privileged user (no config dependency), so they are reliable probes.
    for (const tid of ["button-bulk-send", "button-sync-contacts"]) {
      const el = page.locator(`[data-testid="${tid}"]`);
      const exists = (await el.count()) > 0;
      const visible = exists ? await el.isVisible() : false;
      assertCheck(!visible, `full-toolbar-hidden:${tid}@${label}`, exists ? `rendered but hidden: ${!visible}` : "not rendered (hidden container)");
    }

    const tabRow = await page.evaluate(() => {
      const all = document.querySelector('[data-testid="tab-all"]') as HTMLElement | null;
      if (!all) return null;
      const strip = all.parentElement as HTMLElement;
      const buttons = Array.from(strip.querySelectorAll("button")) as HTMLElement[];
      const tops = buttons.map((b) => Math.round(b.getBoundingClientRect().top));
      return {
        stripHeight: Math.round(strip.getBoundingClientRect().height),
        buttonHeight: Math.round(all.getBoundingClientRect().height),
        buttonCount: buttons.length,
        distinctTops: Array.from(new Set(tops)),
        scrollable: strip.scrollWidth > strip.clientWidth,
      };
    });
    if (!tabRow) {
      assertCheck(false, `tab-row-single-row@${label}`, "category tab strip not found");
    } else {
      // Single row == every tab button sits at the same y AND the strip is no
      // taller than one button plus its padding. If tabs ever wrap again, both
      // measures blow up.
      const singleRow =
        tabRow.distinctTops.length === 1 &&
        tabRow.stripHeight <= tabRow.buttonHeight + 16;
      assertCheck(
        singleRow,
        `tab-row-single-row@${label}`,
        `${tabRow.buttonCount} tabs, strip ${tabRow.stripHeight}px vs button ${tabRow.buttonHeight}px, ` +
          `${tabRow.distinctTops.length} distinct row top(s), h-scrollable=${tabRow.scrollable}`,
      );
    }

    const pageScrollList = await page.evaluate(() => {
      const se = document.scrollingElement || document.documentElement;
      return { scrollHeight: se.scrollHeight, innerHeight: window.innerHeight };
    });
    assertCheck(
      pageScrollList.scrollHeight <= pageScrollList.innerHeight + 1,
      `no-page-scroll:list@${label}`,
      `document scrollHeight ${pageScrollList.scrollHeight}px vs viewport ${pageScrollList.innerHeight}px`,
    );

    // The inbox pane must absorb the remaining height: bottom edge near (and
    // never past) the viewport bottom. A reintroduced hardcoded height either
    // overflows (bottom past the viewport) or strands empty space (bottom far
    // above it) at one of the two checked sizes.
    const paneBox = await page.locator('[data-testid="inbox-pane"]').boundingBox();
    if (!paneBox) {
      assertCheck(false, `pane-fills-viewport@${label}`, "inbox pane ([data-testid=inbox-pane]) not found");
    } else {
      const paneBottom = Math.round(paneBox.y + paneBox.height);
      const fills = paneBottom <= viewport.height && paneBottom >= viewport.height - PANE_FILL_SLACK_PX;
      assertCheck(
        fills,
        `pane-fills-viewport@${label}`,
        `pane bottom ${paneBottom}px vs viewport ${viewport.height}px (allowed window: ${viewport.height - PANE_FILL_SLACK_PX}-${viewport.height}px)`,
      );
    }

    // ── Open a real thread and check the composer ────────────────────────────
    console.log(`[thread state @ ${label}]`);
    const firstThread = page.locator('[data-testid^="thread-"]').first();
    try {
      await firstThread.waitFor({ state: "visible", timeout: SELECTOR_TIMEOUT_MS });
    } catch {
      throw new Error(
        "No conversation appeared in the thread list — the check needs at least one non-archived row in " +
          "fs_comms_threads to open a thread and measure the composer. If the dev comms tables were emptied, " +
          "re-run the comms cutover/heal scripts first.",
      );
    }
    await firstThread.click();

    const sendBtn = page.locator('[data-testid="button-send"]');
    await sendBtn.waitFor({ state: "visible", timeout: SELECTOR_TIMEOUT_MS });
    // Let messages render + auto-scroll settle before measuring.
    await page.waitForTimeout(1000);

    const box = await sendBtn.boundingBox();
    if (!box) {
      assertCheck(false, `send-button-in-viewport@${label}`, "send button has no bounding box");
    } else {
      const inside =
        box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= viewport.width &&
        box.y + box.height <= viewport.height;
      assertCheck(
        inside,
        `send-button-in-viewport@${label}`,
        `send button box x=${Math.round(box.x)} y=${Math.round(box.y)} w=${Math.round(box.width)} h=${Math.round(box.height)} within ${viewport.width}x${viewport.height}`,
      );
    }

    const pageScrollThread = await page.evaluate(() => {
      const se = document.scrollingElement || document.documentElement;
      return { scrollHeight: se.scrollHeight, innerHeight: window.innerHeight };
    });
    assertCheck(
      pageScrollThread.scrollHeight <= pageScrollThread.innerHeight + 1,
      `no-page-scroll:thread@${label}`,
      `document scrollHeight ${pageScrollThread.scrollHeight}px vs viewport ${pageScrollThread.innerHeight}px`,
    );
  } finally {
    await context.close().catch(() => {});
  }
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — the session must be minted in the DB the server reads.");
  }

  // ── 0. Fail fast if the dev server is not up ──────────────────────────────
  try {
    const r = await fetch(`${BASE_URL}/api/auth/me`, { signal: AbortSignal.timeout(5000) });
    // Any HTTP answer (401 included) proves the server is serving.
    console.log(`Dev server reachable at ${BASE_URL} (auth probe: HTTP ${r.status})`);
  } catch {
    throw new Error(
      `Dev server is not reachable at ${BASE_URL}. Start the "Start application" workflow (npm run dev) first, ` +
      `or point BASE_URL at a running instance.`,
    );
  }

  const executablePath = resolveChromiumPath();
  if (!executablePath) {
    throw new Error("No usable Chromium found (resolveChromiumPath returned undefined).");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const sessionId = `viewport-check-${randomBytes(24).toString("hex")}`;
  let browser: Browser | undefined;
  let sessionMinted = false;

  try {
    // ── 1. Mint a short-lived throwaway session for a privileged user ───────
    // The comms module gates on the per-user fleetCommunications permission
    // plus the dark-rollout flag; a `developer` always passes both layers, an
    // `admin` passes the flag layer — prefer developer.
    const userRes = await pool.query(
      `SELECT id, username, role FROM users
       WHERE lower(role) IN ('developer', 'admin')
       ORDER BY (lower(role) = 'developer') DESC
       LIMIT 1`,
    );
    if (userRes.rowCount === 0) {
      throw new Error("No developer/admin user found in the users table to mint a session for.");
    }
    const user = userRes.rows[0];
    await pool.query(
      `INSERT INTO sessions (id, user_id, username, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '10 minutes')`,
      [sessionId, user.id, user.username],
    );
    sessionMinted = true;
    console.log(`Minted throwaway session for ${user.username} (${user.role}), expires in 10 minutes.`);

    // ── 2. Run the full assertion set at each viewport ───────────────────────
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    for (const viewport of VIEWPORTS) {
      await checkAtViewport(browser, sessionId, viewport);
    }

    // ── 3. Verdict ───────────────────────────────────────────────────────────
    if (failures.length > 0) {
      console.error(`\n${failures.length} check(s) FAILED:`);
      for (const f of failures) console.error(`  - ${f.check}: ${f.detail}`);
      console.error(
        "\nThe Fleet Communications inbox no longer fits a small-laptop viewport. " +
          "Likely causes: the /fleet-communications route lost its h-[100dvh] MainContent wrapper (client/src/App.tsx), " +
          "the inbox pane lost flex-1/min-h-0 or regained hardcoded viewport math (client/src/pages/fleet-communications.tsx), " +
          "the toolbar overflow menu / 2xl breakpoint split was removed, or the category tabs wrap again.",
      );
      process.exitCode = 1;
    } else {
      console.log("\nAll viewport checks passed — composer fits on 13\" laptop screens (1280x720 and 1024x576).");
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (sessionMinted) {
      // Revoke the throwaway session no matter what happened above.
      await pool
        .query(`DELETE FROM sessions WHERE id = $1`, [sessionId])
        .then(() => console.log("Throwaway session revoked."))
        .catch((e) => console.error("WARNING: failed to revoke throwaway session:", e?.message || e));
    }
    await pool.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error(`\nFATAL: ${err?.message || err}`);
  process.exitCode = 1;
});
