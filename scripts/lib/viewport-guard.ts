/**
 * Shared plumbing for headless "fits on a 13-inch laptop" screen guards.
 *
 * Extracted from scripts/check-comms-inbox-viewport.ts (Task #767/#768) so the
 * other dense screens (Today's Queue, VRM Ops Queue, All Vehicles, ...) can
 * reuse the exact same session-mint / Chromium-launch / viewport-loop skeleton
 * instead of copy-pasting it per page.
 *
 * What lives here:
 *   - the two required viewports (1280x720 AND 1024x576 — a hardcoded height
 *     can be pixel-identical at one size; see
 *     .agents/memory/viewport-fit-guard.md)
 *   - throwaway-session mint/revoke against the `sessions` table (the server
 *     reads DATABASE_URL — NOT DEV_DATABASE_URL; see
 *     .agents/memory/sso-gated-verification.md)
 *   - dev-server reachability fail-fast, Chromium resolution, browser +
 *     per-viewport context/cookie/page setup, revoke-in-finally
 *   - a per-run CheckRecorder plus the shared assertion helpers (no page
 *     scroll, element inside viewport, pane bottom lands in the fill window)
 *
 * What stays in each per-page script: the route, the readiness selector, and
 * the page-specific assertion set.
 */
import { chromium } from "playwright-core";
import type { Browser, Page } from "playwright-core";
import { randomBytes } from "crypto";
import { Pool } from "pg";
import { resolveChromiumPath } from "../../server/chromium-path";

export const BASE_URL = (process.env.BASE_URL || "http://localhost:5000").replace(/\/+$/, "");
export const NAV_TIMEOUT_MS = 45_000;
export const SELECTOR_TIMEOUT_MS = 30_000;

/**
 * Both sizes are mandatory for every guard. The second, smaller viewport is
 * what exposes reintroduced hardcoded height math — a fixed calc() can
 * coincidentally match the flex height at one size, but its min-height floor
 * overflows the smaller one.
 */
export const SMALL_LAPTOP_VIEWPORTS: ReadonlyArray<Viewport> = [
  { width: 1280, height: 720 },
  { width: 1024, height: 576 },
];

export type Viewport = { width: number; height: number };
export type Failure = { check: string; detail: string };

export class CheckRecorder {
  readonly failures: Failure[] = [];
  assert(ok: boolean, check: string, detail: string): void {
    if (ok) {
      console.log(`  PASS  ${check} — ${detail}`);
    } else {
      console.error(`  FAIL  ${check} — ${detail}`);
      this.failures.push({ check, detail });
    }
  }
}

export function viewportLabel(v: Viewport): string {
  return `${v.width}x${v.height}`;
}

// ── Shared assertion helpers ─────────────────────────────────────────────────

/**
 * Assert the document itself does not scroll vertically (app-like screens) —
 * document scrollHeight must not exceed the viewport height.
 * NOTE: blind inside overflow-hidden containers; pair it with
 * assertPaneBottomWindow (see .agents/memory/viewport-fit-guard.md).
 */
export async function assertNoPageScroll(rec: CheckRecorder, page: Page, check: string): Promise<void> {
  const m = await page.evaluate(() => {
    const se = document.scrollingElement || document.documentElement;
    return { scrollHeight: se.scrollHeight, innerHeight: window.innerHeight };
  });
  rec.assert(
    m.scrollHeight <= m.innerHeight + 1,
    check,
    `document scrollHeight ${m.scrollHeight}px vs viewport ${m.innerHeight}px`,
  );
}

/**
 * Assert the document does not scroll horizontally — dense tables/toolbars
 * must not push the layout wider than a 13" screen.
 */
export async function assertNoHorizontalScroll(rec: CheckRecorder, page: Page, check: string): Promise<void> {
  const m = await page.evaluate(() => {
    const se = document.scrollingElement || document.documentElement;
    return { scrollWidth: se.scrollWidth, innerWidth: window.innerWidth };
  });
  rec.assert(
    m.scrollWidth <= m.innerWidth + 1,
    check,
    `document scrollWidth ${m.scrollWidth}px vs viewport ${m.innerWidth}px`,
  );
}

/**
 * Assert an element's bounding box is fully inside the viewport (e.g. the
 * primary action button must not fall below the fold on load).
 */
export async function assertElementInViewport(
  rec: CheckRecorder,
  page: Page,
  selector: string,
  viewport: Viewport,
  check: string,
): Promise<void> {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) {
    rec.assert(false, check, `${selector} has no bounding box (not rendered/visible)`);
    return;
  }
  const inside =
    box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height;
  rec.assert(
    inside,
    check,
    `${selector} box x=${Math.round(box.x)} y=${Math.round(box.y)} w=${Math.round(box.width)} h=${Math.round(box.height)} within ${viewport.width}x${viewport.height}`,
  );
}

/**
 * Assert a flex-filled pane's bottom edge lands near (never past) the viewport
 * bottom. This is the check that catches overflow clipped invisible by an
 * overflow-hidden ancestor, where the page-scroll check stays green.
 */
export async function assertPaneBottomWindow(
  rec: CheckRecorder,
  page: Page,
  selector: string,
  viewport: Viewport,
  check: string,
  slackPx: number,
): Promise<void> {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) {
    rec.assert(false, check, `${selector} has no bounding box (not rendered/visible)`);
    return;
  }
  const paneBottom = Math.round(box.y + box.height);
  const fills = paneBottom <= viewport.height && paneBottom >= viewport.height - slackPx;
  rec.assert(
    fills,
    check,
    `pane bottom ${paneBottom}px vs viewport ${viewport.height}px (allowed window: ${viewport.height - slackPx}-${viewport.height}px)`,
  );
}

// ── Runner ───────────────────────────────────────────────────────────────────

export type ViewportGuardOptions = {
  /** Human label used in log output, e.g. "Today's Queue". */
  screenName: string;
  /**
   * Runs the page-specific assertion set once per viewport. The page is a
   * fresh authenticated context; navigation is up to the callback (so a
   * script can visit sub-states, open drawers, etc.).
   */
  runAtViewport: (page: Page, viewport: Viewport, rec: CheckRecorder) => Promise<void>;
  /** Printed when any check fails — point at the likely broken layout pieces. */
  failureHint: string;
  viewports?: ReadonlyArray<Viewport>;
};

/**
 * Full guard lifecycle: fail fast when the dev server is down, resolve
 * Chromium, mint a throwaway privileged session, run the per-page callback at
 * every viewport, print the verdict, and ALWAYS revoke the session.
 * Sets process.exitCode = 1 on any failed check.
 */
export async function runViewportGuard(opts: ViewportGuardOptions): Promise<void> {
  const viewports = opts.viewports ?? SMALL_LAPTOP_VIEWPORTS;
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
  const rec = new CheckRecorder();
  let browser: Browser | undefined;
  let sessionMinted = false;

  try {
    // ── 1. Mint a short-lived throwaway session for a privileged user ───────
    // Gated modules key on role/permissions; a `developer` passes every layer
    // (comms dark-rollout included), an `admin` passes most — prefer developer.
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

    // ── 2. Run the page's assertion set at each viewport ────────────────────
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const url = new URL(BASE_URL);
    for (const viewport of viewports) {
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
        await opts.runAtViewport(page, viewport, rec);
      } finally {
        await context.close().catch(() => {});
      }
    }

    // ── 3. Verdict ───────────────────────────────────────────────────────────
    if (rec.failures.length > 0) {
      console.error(`\n${rec.failures.length} check(s) FAILED:`);
      for (const f of rec.failures) console.error(`  - ${f.check}: ${f.detail}`);
      console.error(`\n${opts.failureHint}`);
      process.exitCode = 1;
    } else {
      console.log(
        `\nAll viewport checks passed — ${opts.screenName} fits on 13" laptop screens (` +
          viewports.map(viewportLabel).join(" and ") +
          ").",
      );
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

/**
 * Guard against having been bounced to the login card instead of the page.
 */
export async function failIfOnLoginPage(page: Page): Promise<void> {
  const loginVisible = await page.locator('input[type="password"]').first().isVisible().catch(() => false);
  if (loginVisible) {
    throw new Error(
      "Landed on the login page — the minted session was not accepted (check DATABASE_URL vs the DB the server reads).",
    );
  }
}
