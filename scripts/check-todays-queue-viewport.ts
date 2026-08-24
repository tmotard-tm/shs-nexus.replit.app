/**
 * Screen-fit guard for Fleet Scope "Today's Queue" (/fleet-scope/queue) on
 * 13" laptops (Task #769).
 *
 * Layout contract (FleetScopeLayout binds the height chain with h-screen +
 * min-h-0/overflow-auto on <main data-testid="fleet-scope-main">, and
 * min-w-0 on the SidebarInset so wide content cannot push the document
 * wider than the screen):
 *   1. the document NEVER scrolls — vertically or horizontally — at any
 *      viewport; all scrolling happens inside the shell main
 *   2. the shell main's bottom edge lands exactly at the viewport bottom
 *      (flex fill; a hardcoded height on the shell either overflows past it
 *      or strands a gap at one of the sizes)
 *   3. the primary action (Refresh, data-testid=button-refresh-queue) and the
 *      page title stay fully inside the viewport on load
 *   4. the work-type strip starts above the fold, and the queue pane exists
 *      (the queue list itself is taller than any laptop screen by design and
 *      scrolls inside the shell main under the sticky page header)
 *
 * Task #825 adds the truck-detail slide-out (the page's one drawer, opened by
 * clicking any queue row): at EVERY size the sheet's pinned header (with the
 * Full Details action) must stay fully inside the viewport and the page must
 * still not scroll. The sheet is a flex column (SheetHeader shrink-0 +
 * ScrollArea flex-1 in TruckDetailPanel.tsx), so only its body scrolls; a
 * hardcoded height or a removed flex chain pushes the header/sheet out of the
 * viewport at the short sizes and trips this.
 *
 * Run: npx tsx scripts/check-todays-queue-viewport.ts
 * Registered as the `todays-queue-viewport` validation command.
 * See scripts/lib/viewport-guard.ts and .agents/memory/viewport-fit-guard.md
 * for why ALL viewports are mandatory.
 */
import {
  BASE_URL,
  NAV_TIMEOUT_MS,
  SELECTOR_TIMEOUT_MS,
  SMALL_LAPTOP_VIEWPORTS,
  runViewportGuard,
  failIfOnLoginPage,
  assertNoPageScroll,
  assertNoHorizontalScroll,
  assertElementInViewport,
  assertPaneBottomWindow,
  viewportLabel,
} from "./lib/viewport-guard";

const PAGE_PATH = "/fleet-scope/queue";
// The two shared mandatory sizes plus the scaled-small-laptop reality
// (Task #823, pattern from #820): 13" Windows machines at 125-150% display
// scaling end up around a 1024x500 effective viewport — the size the compact
// density media block in client/src/index.css targets (tq-* hooks).
const VIEWPORTS = [...SMALL_LAPTOP_VIEWPORTS, { width: 1024, height: 500 }];
// The shell main is flex-1 in an h-screen column: its bottom edge must sit
// exactly on the viewport bottom (small slack for rounding only).
const MAIN_FILL_SLACK_PX = 4;

runViewportGuard({
  screenName: "Today's Queue",
  failureHint:
    "Today's Queue no longer fits a small-laptop viewport. Likely causes: FleetScopeLayout lost its " +
    "h-screen root or the min-h-0/overflow-auto on the shell main (the document scrolls again), the " +
    "SidebarInset lost min-w-0 (wide tables push the page sideways), a hardcoded height was added to " +
    "the shell or page (client/src/pages/fleet-scope/TodaysQueue.tsx), or the header toolbar grew past the fold. " +
    "If only 1024x500 fails, the compact density block in client/src/index.css (Task #823) may have been " +
    "removed or its tq-* hook classes stripped from the page. " +
    "If a drawer-* check fails, the truck-detail sheet (client/src/components/fleet-scope/TruckDetailPanel.tsx) " +
    "lost its flex column (p-0 flex flex-col SheetContent, shrink-0 header, flex-1 ScrollArea body) or gained " +
    "a hardcoded height — its header must stay pinned on screen while only the body scrolls.",
  viewports: VIEWPORTS,
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

    // ── Truck-detail drawer (Task #825) ─────────────────────────────────────
    console.log(`[truck-detail drawer @ ${label}]`);
    const row = page.locator('[data-testid^="queue-row-"], [data-testid^="bucket-row-"]').first();
    try {
      await row.waitFor({ state: "visible", timeout: SELECTOR_TIMEOUT_MS });
    } catch {
      throw new Error(
        "No queue/bucket row appeared — the drawer check needs at least one item in today's queue to open " +
          "the truck-detail sheet. If the dev queue is genuinely empty, re-run once data exists.",
      );
    }
    await row.click();

    const panel = page.locator('[data-testid="panel-truck-detail"]');
    await panel.waitFor({ state: "visible", timeout: SELECTOR_TIMEOUT_MS });
    // Header actions render only once the truck payload resolves.
    const fullDetail = page.locator('[data-testid="button-open-full-detail"]');
    await fullDetail.waitFor({ state: "visible", timeout: SELECTOR_TIMEOUT_MS });
    await page.waitForTimeout(500);

    // The whole sheet must sit inside the viewport (it is h-full; a hardcoded
    // height overflows the short sizes), its pinned-header action must be on
    // screen at every size, and the document must still not scroll.
    await assertElementInViewport(rec, page, '[data-testid="panel-truck-detail"]', viewport, `drawer-sheet-in-viewport@${label}`);
    await assertElementInViewport(rec, page, '[data-testid="button-open-full-detail"]', viewport, `drawer-header-action-in-viewport@${label}`);
    await assertNoPageScroll(rec, page, `no-page-scroll:drawer@${label}`);

    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "hidden", timeout: SELECTOR_TIMEOUT_MS });
  },
}).catch((err) => {
  console.error(`\nFATAL: ${err?.message || err}`);
  process.exitCode = 1;
});
