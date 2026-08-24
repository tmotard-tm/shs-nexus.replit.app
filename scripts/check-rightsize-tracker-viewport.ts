/**
 * Screen-fit guard for the VRM Rental Right-Size Tracker
 * (/vehicle-rental-management/rightsize-tracker) on 13" laptops (Task #833).
 *
 * Layout contract (RouteReadyLayout binds the height chain with h-screen +
 * min-h-0/overflow-auto on <main data-testid="vrm-main">):
 *   1. the document NEVER scrolls — vertically or horizontally — at any
 *      viewport; the page scrolls inside the shell main (this page is a long
 *      scroll page BY DESIGN: exec layer on top, outreach roster below)
 *   2. the shell main's bottom edge lands exactly at the viewport bottom
 *   3. the page header stays inside the viewport on load
 *   4. the compact density block (rt-* hooks in client/src/index.css) applies
 *      below 1280×720 and provably does NOT apply at 1280×720
 *
 * Run: npx tsx scripts/check-rightsize-tracker-viewport.ts
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

const PAGE_PATH = "/vehicle-rental-management/rightsize-tracker";
const VIEWPORTS = [...SMALL_LAPTOP_VIEWPORTS, { width: 1024, height: 500 }];
const MAIN_FILL_SLACK_PX = 4;

runViewportGuard({
  screenName: "VRM Rightsize Tracker",
  failureHint:
    "The Rightsize Tracker no longer fits a small-laptop viewport. Likely causes: RouteReadyLayout lost " +
    "its h-screen root or the min-h-0/overflow-auto on <main> (the document scrolls again), or a hardcoded " +
    "height was added to the shell or page (client/src/pages/vehicle-rental-management/pages/RightsizeTracker.tsx). " +
    "If only the compact-density checks fail, the Task #833 block in client/src/index.css was removed or its " +
    "rt-* hook classes were stripped from the page. NEVER click Sync/stage buttons here — they write.",
  viewports: VIEWPORTS,
  runAtViewport: async (page, viewport, rec) => {
    const label = viewportLabel(viewport);
    console.log(`\n[VRM Rightsize Tracker @ ${label}]`);
    await page.goto(`${BASE_URL}${PAGE_PATH}`, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    // The roster table renders unconditionally (even at "0 of 0 techs" in dev);
    // the exec-layer KPI cards depend on the slow compliance endpoint, so the
    // guard must never key on them.
    await page.waitForSelector(".rt-table-wrap table", { timeout: SELECTOR_TIMEOUT_MS });
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
    await assertElementInViewport(rec, page, ".rt-header h1", viewport, `header-in-viewport@${label}`);
    await assertVrmCompactDensity(rec, page, viewport, {
      // Roster header cells always render, data or not (thBase inline 7px pad).
      selector: ".rt-table-wrap thead th",
      compactPadTop: "4px",
      desktopPadTop: "7px",
    });
  },
}).catch((err) => {
  console.error(`\nFATAL: ${err?.message || err}`);
  process.exitCode = 1;
});
