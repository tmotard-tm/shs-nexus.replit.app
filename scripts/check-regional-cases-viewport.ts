/**
 * Screen-fit guard for the VRM Cases by Region board
 * (/vehicle-rental-management/cases-by-region) on 13" laptops (Task #826).
 *
 * Layout contract (RouteReadyLayout binds the height chain with h-screen +
 * min-h-0/overflow-auto on <main data-testid="vrm-main">):
 *   1. the document NEVER scrolls — vertically or horizontally — at any
 *      viewport; the board scrolls inside the shell main
 *   2. the shell main's bottom edge lands exactly at the viewport bottom
 *   3. the region toolbar and the table's header row stay inside the viewport
 *      on load
 *   4. the compact density block (rc-* hooks in client/src/index.css) applies
 *      below 1280×720 and provably does NOT apply at 1280×720
 *
 * Run: npx tsx scripts/check-regional-cases-viewport.ts
 * Registered as the `regional-cases-viewport` validation command (also a
 * workflow of the same name).
 * See scripts/lib/viewport-guard.ts and .agents/memory/viewport-fit-guard.md
 * for why multiple viewports are mandatory.
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
import { assertVrmCompactDensity } from "./lib/vrm-compact-probe";

const PAGE_PATH = "/vehicle-rental-management/cases-by-region";
const VIEWPORTS = [...SMALL_LAPTOP_VIEWPORTS, { width: 1024, height: 500 }];
const MAIN_FILL_SLACK_PX = 4;

runViewportGuard({
  screenName: "VRM Cases by Region",
  failureHint:
    "The Cases by Region board no longer fits a small-laptop viewport. Likely causes: RouteReadyLayout lost " +
    "its h-screen root or the min-h-0/overflow-auto on <main> (the document scrolls again), a hardcoded height " +
    "was added to the shell or page (client/src/pages/vehicle-rental-management/pages/RegionalCases.tsx), or " +
    "the toolbar wrapped/grew until the table header fell below the fold. " +
    "If only the compact-density checks fail, the Task #826 block in client/src/index.css was removed or its " +
    "rc-* hook classes were stripped from the page.",
  viewports: VIEWPORTS,
  runAtViewport: async (page, viewport, rec) => {
    const label = viewportLabel(viewport);
    console.log(`\n[VRM Cases by Region @ ${label}]`);
    await page.goto(`${BASE_URL}${PAGE_PATH}`, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    // The grid renders once /api/vrm/rental-operations/by-region resolves.
    await page.waitForSelector('[data-testid="regional-cases-table"]', { timeout: SELECTOR_TIMEOUT_MS });
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
    await assertElementInViewport(rec, page, '[data-testid="rc-toolbar"]', viewport, `toolbar-in-viewport@${label}`);
    await assertElementInViewport(rec, page, '.rc-table-wrap thead th', viewport, `grid-header-in-viewport@${label}`);
    await assertVrmCompactDensity(rec, page, viewport, {
      selector: ".rc-table-wrap thead th",
      compactPadTop: "5px",
      desktopPadTop: "9px",
    });
  },
}).catch((err) => {
  console.error(`\nFATAL: ${err?.message || err}`);
  process.exitCode = 1;
});
