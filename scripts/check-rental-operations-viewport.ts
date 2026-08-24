/**
 * Screen-fit guard for the VRM Rental Operations master board
 * (/vehicle-rental-management/rental-operations) on 13" laptops (Task #826).
 *
 * Layout contract (RouteReadyLayout binds the height chain with h-screen +
 * min-h-0/overflow-auto on <main data-testid="vrm-main">):
 *   1. the document NEVER scrolls — vertically or horizontally — at any
 *      viewport; the board scrolls inside the shell main
 *   2. the shell main's bottom edge lands exactly at the viewport bottom
 *   3. the toolbar (Sync now) and the table's header row stay inside the
 *      viewport on load — a growing header/KPI/chip/filter stack pushes the
 *      grid below the fold and trips this first
 *   4. the compact density block (ro-* hooks in client/src/index.css) applies
 *      below 1280×720 and provably does NOT apply at 1280×720
 *
 * Run: npx tsx scripts/check-rental-operations-viewport.ts
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

const PAGE_PATH = "/vehicle-rental-management/rental-operations";
// The two shared mandatory sizes plus the scaled-small-laptop reality:
// 13" Windows machines at 125-150% display scaling land around a 1024x500
// effective viewport — the size the compact density media block targets.
const VIEWPORTS = [...SMALL_LAPTOP_VIEWPORTS, { width: 1024, height: 500 }];
const MAIN_FILL_SLACK_PX = 4;

runViewportGuard({
  screenName: "VRM Rental Operations",
  failureHint:
    "The Rental Operations board no longer fits a small-laptop viewport. Likely causes: RouteReadyLayout lost " +
    "its h-screen root or the min-h-0/overflow-auto on <main> (the document scrolls again), a hardcoded height " +
    "was added to the shell or page (client/src/pages/vehicle-rental-management/pages/RentalOperations.tsx), or " +
    "the header/KPI/chip/filter stack grew until the table header fell below the fold. " +
    "If only the compact-density checks fail, the Task #826 block in client/src/index.css was removed or its " +
    "ro-* hook classes were stripped from the page.",
  viewports: VIEWPORTS,
  runAtViewport: async (page, viewport, rec) => {
    const label = viewportLabel(viewport);
    console.log(`\n[VRM Rental Operations @ ${label}]`);
    await page.goto(`${BASE_URL}${PAGE_PATH}`, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    // The grid renders once /api/vrm/rental-operations/master resolves.
    await page.waitForSelector('[data-testid="rental-ops-table"]', { timeout: SELECTOR_TIMEOUT_MS });
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
    await assertElementInViewport(rec, page, '[data-testid="button-sync-now"]', viewport, `sync-in-viewport@${label}`);
    // The table's first header cell must be above the fold at load — the
    // canary for header-stack growth eating the work area.
    await assertElementInViewport(rec, page, '.ro-table-wrap thead th', viewport, `grid-header-in-viewport@${label}`);
    await assertVrmCompactDensity(rec, page, viewport, {
      selector: ".ro-table-wrap thead th",
      compactPadTop: "5px",
      desktopPadTop: "9px",
    });
  },
}).catch((err) => {
  console.error(`\nFATAL: ${err?.message || err}`);
  process.exitCode = 1;
});
