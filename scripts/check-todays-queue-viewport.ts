/**
 * Screen-fit guard for Fleet Scope "Today's Queue" (/fleet-scope/queue) on
 * 13" laptops (Task #769).
 *
 * Layout contract (FleetScopeLayout binds the height chain with h-screen +
 * min-h-0/overflow-auto on <main data-testid="fleet-scope-main">, and
 * min-w-0 on the SidebarInset so wide content cannot push the document
 * wider than the screen):
 *   1. the document NEVER scrolls — vertically or horizontally — at either
 *      viewport; all scrolling happens inside the shell main
 *   2. the shell main's bottom edge lands exactly at the viewport bottom
 *      (flex fill; a hardcoded height on the shell either overflows past it
 *      or strands a gap at one of the two sizes)
 *   3. the primary action (Refresh, data-testid=button-refresh-queue) and the
 *      page title stay fully inside the viewport on load
 *   4. the work-type strip starts above the fold, and the queue pane exists
 *      (the queue list itself is taller than any laptop screen by design and
 *      scrolls inside the shell main under the sticky page header)
 *
 * Run: npx tsx scripts/check-todays-queue-viewport.ts
 * Registered as the `todays-queue-viewport` validation command.
 * See scripts/lib/viewport-guard.ts and .agents/memory/viewport-fit-guard.md
 * for why BOTH viewports are mandatory.
 */
import {
  BASE_URL,
  NAV_TIMEOUT_MS,
  SELECTOR_TIMEOUT_MS,
  runViewportGuard,
  failIfOnLoginPage,
  assertNoPageScroll,
  assertNoHorizontalScroll,
  assertElementInViewport,
  assertPaneBottomWindow,
  viewportLabel,
} from "./lib/viewport-guard";

const PAGE_PATH = "/fleet-scope/queue";
// The shell main is flex-1 in an h-screen column: its bottom edge must sit
// exactly on the viewport bottom (small slack for rounding only).
const MAIN_FILL_SLACK_PX = 4;

runViewportGuard({
  screenName: "Today's Queue",
  failureHint:
    "Today's Queue no longer fits a small-laptop viewport. Likely causes: FleetScopeLayout lost its " +
    "h-screen root or the min-h-0/overflow-auto on the shell main (the document scrolls again), the " +
    "SidebarInset lost min-w-0 (wide tables push the page sideways), a hardcoded height was added to " +
    "the shell or page (client/src/pages/fleet-scope/TodaysQueue.tsx), or the header toolbar grew past the fold.",
  runAtViewport: async (page, viewport, rec) => {
    const label = viewportLabel(viewport);
    console.log(`\n[Today's Queue @ ${label}]`);
    await page.goto(`${BASE_URL}${PAGE_PATH}`, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    // The work-type strip renders once /api/fs/queue/today resolves — its
    // presence proves we are past auth and the queue actually built.
    await page.waitForSelector('[data-testid="workbucket-strip"]', { timeout: SELECTOR_TIMEOUT_MS });
    await failIfOnLoginPage(page);
    // Let the header rows and banners settle before measuring.
    await page.waitForTimeout(1000);

    await assertNoPageScroll(rec, page, `no-page-scroll@${label}`);
    await assertNoHorizontalScroll(rec, page, `no-horizontal-scroll@${label}`);
    await assertPaneBottomWindow(
      rec,
      page,
      '[data-testid="fleet-scope-main"]',
      viewport,
      `main-pane-fills-viewport@${label}`,
      MAIN_FILL_SLACK_PX,
    );
    await assertElementInViewport(rec, page, '[data-testid="button-refresh-queue"]', viewport, `refresh-in-viewport@${label}`);
    await assertElementInViewport(rec, page, "h1", viewport, `page-title-in-viewport@${label}`);

    // The work-type strip is tall (wrapped pills) and scrolls with the page
    // content by design; what must hold is that it STARTS above the fold so
    // staff see it exists without scrolling.
    const strip = await page.locator('[data-testid="workbucket-strip"]').boundingBox();
    if (!strip) {
      rec.assert(false, `strip-starts-above-fold@${label}`, "workbucket-strip has no bounding box");
    } else {
      rec.assert(
        strip.y >= 0 && strip.y < viewport.height,
        `strip-starts-above-fold@${label}`,
        `strip top ${Math.round(strip.y)}px vs viewport ${viewport.height}px`,
      );
    }

    // The queue list pane must exist (list content scrolls inside the shell).
    const paneCount = await page.locator('[data-testid="queue-pane"]').count();
    rec.assert(paneCount > 0, `queue-pane-present@${label}`, `queue-pane found: ${paneCount > 0}`);
  },
}).catch((err) => {
  console.error(`\nFATAL: ${err?.message || err}`);
  process.exitCode = 1;
});
