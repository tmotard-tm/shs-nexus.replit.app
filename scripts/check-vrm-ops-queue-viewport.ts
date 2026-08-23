/**
 * Screen-fit guard for the VRM Ops Queue
 * (/vehicle-rental-management/ops-queue) on 13" laptops (Task #769).
 *
 * Layout contract (RouteReadyLayout binds the height chain with h-screen +
 * min-h-0/overflow-auto on <main data-testid="vrm-main">):
 *   1. the document NEVER scrolls — vertically or horizontally — at either
 *      viewport; the board scrolls inside the shell main
 *   2. the shell main's bottom edge lands exactly at the viewport bottom
 *   3. the primary action (Refresh, data-testid=button-refresh-queue) stays
 *      fully inside the viewport on load
 *   4. the work-bucket strip is fully visible above the fold at both sizes —
 *      if the header stack ever grows (wrapping toolbars, extra banners), the
 *      strip is pushed down and this trips first
 *
 * Run: npx tsx scripts/check-vrm-ops-queue-viewport.ts
 * Registered as the `vrm-ops-queue-viewport` validation command.
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

const PAGE_PATH = "/vehicle-rental-management/ops-queue";
const MAIN_FILL_SLACK_PX = 4;

runViewportGuard({
  screenName: "VRM Ops Queue",
  failureHint:
    "The VRM Ops Queue no longer fits a small-laptop viewport. Likely causes: RouteReadyLayout lost its " +
    "h-screen root or the min-h-0/overflow-auto on <main> (the document scrolls again), a hardcoded height " +
    "was added to the shell or page (client/src/pages/vehicle-rental-management/pages/OpsQueue.tsx), or the " +
    "header/view-toggle stack grew until the work-bucket strip fell below the fold.",
  runAtViewport: async (page, viewport, rec) => {
    const label = viewportLabel(viewport);
    console.log(`\n[VRM Ops Queue @ ${label}]`);
    await page.goto(`${BASE_URL}${PAGE_PATH}`, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    // The strip renders once /api/vrm/rental-operations/queue resolves.
    await page.waitForSelector('[data-testid="workbucket-strip"]', { timeout: SELECTOR_TIMEOUT_MS });
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
    await assertElementInViewport(rec, page, '[data-testid="button-refresh-queue"]', viewport, `refresh-in-viewport@${label}`);
    // The whole strip (persona/work-bucket pills) fits above the fold today at
    // both sizes; a growing header stack pushes it down and breaks this first.
    await assertElementInViewport(rec, page, '[data-testid="workbucket-strip"]', viewport, `strip-in-viewport@${label}`);
  },
}).catch((err) => {
  console.error(`\nFATAL: ${err?.message || err}`);
  process.exitCode = 1;
});
