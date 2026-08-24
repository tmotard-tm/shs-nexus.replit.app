/**
 * Screen-fit guard for the VRM LUCA Activity page
 * (/vehicle-rental-management/luca-activity) on 13" laptops (Task #833).
 *
 * Layout contract (RouteReadyLayout binds the height chain with h-screen +
 * min-h-0/overflow-auto on <main data-testid="vrm-main">):
 *   1. the document NEVER scrolls — vertically or horizontally — at any
 *      viewport; overflow scrolls inside the shell main / the table wrap
 *   2. the shell main's bottom edge lands exactly at the viewport bottom
 *   3. the health cards and the table's header row stay inside the viewport on
 *      load; at compact sizes the la-table-wrap scroller cap keeps the whole
 *      page above the fold
 *   4. the compact density block (la-* hooks in client/src/index.css) applies
 *      below 1280×720 and provably does NOT apply at 1280×720
 *
 * Run: npx tsx scripts/check-luca-activity-viewport.ts
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
import { assertVrmCompactDensity, isCompactViewport } from "./lib/vrm-compact-probe";

const PAGE_PATH = "/vehicle-rental-management/luca-activity";
const VIEWPORTS = [...SMALL_LAPTOP_VIEWPORTS, { width: 1024, height: 500 }];
const MAIN_FILL_SLACK_PX = 4;

runViewportGuard({
  screenName: "VRM LUCA Activity",
  failureHint:
    "The LUCA Activity page no longer fits a small-laptop viewport. Likely causes: RouteReadyLayout lost " +
    "its h-screen root or the min-h-0/overflow-auto on <main> (the document scrolls again), a hardcoded height " +
    "was added to the shell or page (client/src/pages/vehicle-rental-management/pages/LucaActivity.tsx), or " +
    "the la-table-wrap compact scroller cap in client/src/index.css no longer matches the chrome above it. " +
    "If only the compact-density checks fail, the Task #833 block in client/src/index.css was removed or its " +
    "la-* hook classes were stripped from the page.",
  viewports: VIEWPORTS,
  runAtViewport: async (page, viewport, rec) => {
    const label = viewportLabel(viewport);
    console.log(`\n[VRM LUCA Activity @ ${label}]`);
    await page.goto(`${BASE_URL}${PAGE_PATH}`, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    await page.waitForSelector(".la-table-wrap table", { timeout: SELECTOR_TIMEOUT_MS });
    await failIfOnLoginPage(page);
    await page.waitForTimeout(1000);

    await assertNoPageScroll(rec, page, `no-page-scroll@${label}`);
    await assertNoHorizontalScroll(rec, page, `no-horizontal-scroll@${label}`);
    await assertPaneBottomWindow(
      rec,
      page,
      '[data-testid="vrm-main"]',
      viewport,
      `main-pane-fills-viewport@${label}`,
      MAIN_FILL_SLACK_PX,
    );
    await assertElementInViewport(rec, page, ".la-cards", viewport, `health-cards-in-viewport@${label}`);
    await assertElementInViewport(rec, page, ".la-table-wrap thead th", viewport, `grid-header-in-viewport@${label}`);
    if (isCompactViewport(viewport)) {
      // At compact, the la-table-wrap cap (100vh - 250px) must land the whole
      // table pane inside the window — the page needs no main scroll at all.
      await assertElementInViewport(rec, page, ".la-table-wrap", viewport, `table-pane-in-viewport@${label}`);
    }
    await assertVrmCompactDensity(rec, page, viewport, {
      selector: ".la-card",
      compactPadTop: "6px",
      desktopPadTop: "14px",
    });
  },
}).catch((err) => {
  console.error(`\nFATAL: ${err?.message || err}`);
  process.exitCode = 1;
});
