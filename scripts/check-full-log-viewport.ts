/**
 * Screen-fit guard for the VRM New Rental – Full Log page
 * (/vehicle-rental-management/new-rental-full-log) on 13" laptops (Task #833).
 *
 * Layout contract (RouteReadyLayout binds the height chain with h-screen +
 * min-h-0/overflow-auto on <main data-testid="vrm-main">):
 *   1. the document NEVER scrolls — vertically or horizontally — at any
 *      viewport; the paginated table scrolls inside the shell main (15 rows a
 *      page — the page is main-scrolled BY DESIGN, density just shortens it)
 *   2. the shell main's bottom edge lands exactly at the viewport bottom
 *   3. the header action row and the table's header row stay inside the
 *      viewport on load
 *   4. the compact density block (fl-* hooks in client/src/index.css) applies
 *      below 1280×720 and provably does NOT apply at 1280×720
 *
 * The guard never clicks rows or Approve/Deny/Delete controls — those write.
 *
 * Run: npx tsx scripts/check-full-log-viewport.ts
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

const PAGE_PATH = "/vehicle-rental-management/new-rental-full-log";
const VIEWPORTS = [...SMALL_LAPTOP_VIEWPORTS, { width: 1024, height: 500 }];
const MAIN_FILL_SLACK_PX = 4;

runViewportGuard({
  screenName: "VRM New Rental Full Log",
  failureHint:
    "The New Rental Full Log no longer fits a small-laptop viewport. Likely causes: RouteReadyLayout lost " +
    "its h-screen root or the min-h-0/overflow-auto on <main> (the document scrolls again), or a hardcoded " +
    "height was added to the shell or page (client/src/pages/vehicle-rental-management/pages/NewRentalFullLog.tsx). " +
    "If only the compact-density checks fail, the Task #833 block in client/src/index.css was removed or its " +
    "fl-* hook classes were stripped from the page.",
  viewports: VIEWPORTS,
  runAtViewport: async (page, viewport, rec) => {
    const label = viewportLabel(viewport);
    console.log(`\n[VRM New Rental Full Log @ ${label}]`);
    await page.goto(`${BASE_URL}${PAGE_PATH}`, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    // The table renders once /api/vrm/new-rental-log/enriched resolves; the
    // empty state is a bare div, so key on the wrap (always rendered), then
    // prefer the table when rows exist.
    await page.waitForSelector(".fl-table-wrap", { timeout: SELECTOR_TIMEOUT_MS });
    await page.waitForSelector(".fl-table-wrap table", { timeout: SELECTOR_TIMEOUT_MS }).catch(() => {});
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
    await assertElementInViewport(rec, page, ".fl-header", viewport, `header-in-viewport@${label}`);
    await assertElementInViewport(rec, page, ".fl-table-wrap thead th", viewport, `grid-header-in-viewport@${label}`);
    await assertVrmCompactDensity(rec, page, viewport, {
      selector: ".fl-table-wrap thead th",
      compactPadTop: "5px",
      desktopPadTop: "10px",
    });
  },
}).catch((err) => {
  console.error(`\nFATAL: ${err?.message || err}`);
  process.exitCode = 1;
});
