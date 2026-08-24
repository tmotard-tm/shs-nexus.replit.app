/**
 * Screen-fit guard for the VRM Rental Denial Tracker
 * (/vehicle-rental-management/rental-repair-tracker) on 13" laptops
 * (Task #826).
 *
 * Layout contract (RouteReadyLayout binds the height chain with h-screen +
 * min-h-0/overflow-auto on <main data-testid="vrm-main">):
 *   1. the document NEVER scrolls — vertically or horizontally — at any
 *      viewport; the board scrolls inside the shell main
 *   2. the shell main's bottom edge lands exactly at the viewport bottom
 *   3. the primary action (Add Entry) and the first section header stay
 *      inside the viewport on load — the header/search/toggle stack is the
 *      only thing that can push the work below the fold
 *   4. the compact density block (rdt-* hooks in client/src/index.css)
 *      applies below 1280×720 and provably does NOT apply at 1280×720
 *
 * Run: npx tsx scripts/check-rental-denial-viewport.ts
 * Registered as the `rental-denial-viewport` validation command (also a
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

const PAGE_PATH = "/vehicle-rental-management/rental-repair-tracker";
const VIEWPORTS = [...SMALL_LAPTOP_VIEWPORTS, { width: 1024, height: 500 }];
const MAIN_FILL_SLACK_PX = 4;

runViewportGuard({
  screenName: "VRM Rental Denial Tracker",
  failureHint:
    "The Rental Denial Tracker no longer fits a small-laptop viewport. Likely causes: RouteReadyLayout lost " +
    "its h-screen root or the min-h-0/overflow-auto on <main> (the document scrolls again), a hardcoded height " +
    "was added to the shell or page (client/src/pages/vehicle-rental-management/pages/RentalRepairTracker.tsx), " +
    "or the header/search/toggle stack grew until the first section fell below the fold. " +
    "If only the compact-density checks fail, the Task #826 block in client/src/index.css was removed or its " +
    "rdt-* hook classes were stripped from the page.",
  viewports: VIEWPORTS,
  runAtViewport: async (page, viewport, rec) => {
    const label = viewportLabel(viewport);
    console.log(`\n[VRM Rental Denial Tracker @ ${label}]`);
    await page.goto(`${BASE_URL}${PAGE_PATH}`, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    // Sections render once /api/vrm/repair-tracker resolves.
    await page.waitForSelector(".rdt-section", { timeout: SELECTOR_TIMEOUT_MS });
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
    await assertElementInViewport(rec, page, '[data-testid="button-add-entry"]', viewport, `add-entry-in-viewport@${label}`);
    // First section header above the fold at load — the canary for
    // header/search/toggle stack growth eating the work area.
    await assertElementInViewport(rec, page, ".rdt-section-header", viewport, `section-header-in-viewport@${label}`);
    await assertVrmCompactDensity(rec, page, viewport, {
      selector: ".rdt-section-header",
      compactPadTop: "6px",
      desktopPadTop: "10px",
    });
  },
}).catch((err) => {
  console.error(`\nFATAL: ${err?.message || err}`);
  process.exitCode = 1;
});
