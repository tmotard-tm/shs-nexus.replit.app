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
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
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

// ── Cross-process concurrency limiter ────────────────────────────────────────
//
// Validation runs launch every registered guard AT ONCE. Many guards each
// spawning Chromium against the single vite dev server starve it: page.goto
// (domcontentloaded) blows its 45s budget and playwright's CDP session can
// assert-crash outright — false reds on unchanged layouts. Two slots keep
// total wall time close to the concurrent run while eliminating the pile-up.
//
// Ownership model: a slot is an atomically mkdir'd directory containing an
// owner.json with the holder's PID and a per-acquisition token. A slot is
// reaped ONLY when its owner process is provably dead (kill(pid, 0) →
// ESRCH) — never on age, so a legitimately slow holder is never evicted.
// A dir with no owner.json is either a holder mid-write (grace window) or
// wreckage from a crash between mkdir and writeFile (reaped after the
// grace). Release verifies the token so a guard can never free a slot it
// no longer owns.

const SLOT_COUNT = 2;
const SLOT_WAIT_TIMEOUT_MS = 12 * 60_000;
const SLOT_POLL_MS = 2_000;
const OWNERLESS_GRACE_MS = 30_000; // mkdir → owner.json write is immediate

type GuardSlot = { dir: string; token: string };

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    // ESRCH = no such process. EPERM would mean alive-but-not-ours; all
    // guards run as the same user, but treat any non-ESRCH as alive to be
    // safe (never reap a possibly-live holder).
    return e?.code !== "ESRCH";
  }
}

function tryReapSlot(dir: string): void {
  const ownerPath = `${dir}/owner.json`;
  let ownerRaw: string | undefined;
  try {
    ownerRaw = readFileSync(ownerPath, "utf8");
  } catch {
    // No owner file. Fresh holders write it immediately after mkdir, so an
    // ownerless dir older than the grace window is crash wreckage.
    try {
      if (Date.now() - statSync(dir).mtimeMs > OWNERLESS_GRACE_MS) rmSync(dir, { recursive: true, force: true });
    } catch {
      /* raced another reaper / already gone */
    }
    return;
  }
  try {
    const owner = JSON.parse(ownerRaw) as { pid?: number };
    if (typeof owner.pid === "number" && !isPidAlive(owner.pid)) {
      console.log(`Reaping viewport-guard slot ${dir} held by dead pid ${owner.pid}.`);
      rmSync(dir, { recursive: true, force: true });
    }
  } catch {
    /* unreadable owner file or raced removal — leave it; retry next poll */
  }
}

async function acquireGuardSlot(): Promise<GuardSlot> {
  const deadline = Date.now() + SLOT_WAIT_TIMEOUT_MS;
  let waitingLogged = false;
  for (;;) {
    for (let i = 0; i < SLOT_COUNT; i++) {
      const dir = `/tmp/viewport-guard-slot-${i}`;
      try {
        mkdirSync(dir); // atomic: fails if another guard holds the slot
      } catch {
        tryReapSlot(dir); // occupied — free it only if the holder is dead
        continue;
      }
      const token = randomBytes(16).toString("hex");
      try {
        writeFileSync(`${dir}/owner.json`, JSON.stringify({ pid: process.pid, token }));
      } catch (e) {
        // Could not stamp ownership — give the slot back rather than hold
        // an ownerless dir that another guard would eventually reap.
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {}
        throw e;
      }
      return { dir, token };
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out after ${SLOT_WAIT_TIMEOUT_MS / 60_000} minutes waiting for a viewport-guard concurrency slot ` +
          `(/tmp/viewport-guard-slot-*). If no other guard is actually running, delete the stale slot directories.`,
      );
    }
    if (!waitingLogged) {
      console.log(`Waiting for a viewport-guard concurrency slot (${SLOT_COUNT} max concurrent browser runs)...`);
      waitingLogged = true;
    }
    await new Promise((r) => setTimeout(r, SLOT_POLL_MS));
  }
}

function releaseGuardSlot(slot: GuardSlot): void {
  try {
    const owner = JSON.parse(readFileSync(`${slot.dir}/owner.json`, "utf8")) as { token?: string };
    if (owner.token !== slot.token) {
      // Should be impossible (liveness-only reaping), but never free a slot
      // someone else now owns.
      console.error(`WARNING: viewport-guard slot ${slot.dir} is no longer ours — not releasing.`);
      return;
    }
    rmSync(slot.dir, { recursive: true, force: true });
  } catch {
    /* already gone / unreadable — nothing safe to do; dead-PID reap covers a leak */
  }
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

  // Take a concurrency slot BEFORE minting the session — waiting for a slot
  // must not burn the throwaway session's 10-minute TTL. Nothing sits between
  // acquisition and the try, so the finally always releases what we hold.
  const slot = await acquireGuardSlot();

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
    // Browser/context teardown must finish BEFORE the slot frees — otherwise
    // a waiting guard's Chromium overlaps ours and the cap is >SLOT_COUNT.
    if (browser) await browser.close().catch(() => {});
    releaseGuardSlot(slot);
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
