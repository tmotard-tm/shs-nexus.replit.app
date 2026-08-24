/**
 * Screen-fit guard for the VRM Inbound Calls page
 * (/vehicle-rental-management/inbound-calls) on 13" laptops (Task #833).
 *
 * Layout contract (RouteReadyLayout binds the height chain with h-screen +
 * min-h-0/overflow-auto on <main data-testid="vrm-main">):
 *   1. the document NEVER scrolls — vertically or horizontally — at any
 *      viewport; overflow scrolls inside the shell main / the table wrap
 *   2. the shell main's bottom edge lands exactly at the viewport bottom
 *   3. the KPI cards, filter row, and the table's header row stay inside the
 *      viewport on load; at compact sizes the table wrap's own scroller cap
 *      keeps the whole page above the fold (no main scroll needed)
 *   4. the compact density block (ic-* hooks in client/src/index.css) applies
 *      below 1280×720 and provably does NOT apply at 1280×720
 *
 * Row clicks only open the read-only DetailModal (GET endpoints); the guard
 * NEVER clicks Sync / status / disposition buttons — those write, and dev
 * comms sends are LIVE.
 *
 * Run: npx tsx scripts/check-inbound-calls-viewport.ts
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

const PAGE_PATH = "/vehicle-rental-management/inbound-calls";
const VIEWPORTS = [...SMALL_LAPTOP_VIEWPORTS, { width: 1024, height: 500 }];
const MAIN_FILL_SLACK_PX = 4;

runViewportGuard({
  screenName: "VRM Inbound Calls",
  failureHint:
    "The Inbound Calls page no longer fits a small-laptop viewport. Likely causes: RouteReadyLayout lost " +
    "its h-screen root or the min-h-0/overflow-auto on <main> (the document scrolls again), a hardcoded height " +
    "was added to the shell or page (client/src/pages/vehicle-rental-management/pages/InboundCalls.tsx), or " +
    "the ic-table-wrap compact scroller cap in client/src/index.css no longer matches the chrome above it. " +
    "If only the compact-density checks fail, the Task #833 block in client/src/index.css was removed or its " +
    "ic-* hook classes were stripped from the page.",
  viewports: VIEWPORTS,
  runAtViewport: async (page, viewport, rec) => {
    const label = viewportLabel(viewport);
    console.log(`\n[VRM Inbound Calls @ ${label}]`);
    await page.goto(`${BASE_URL}${PAGE_PATH}`, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    // Page renders after /api/vrm/inbound/calls resolves (isLoading gate).
    await page.waitForSelector(".ic-table-wrap table", { timeout: SELECTOR_TIMEOUT_MS });
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
    await assertElementInViewport(rec, page, ".ic-cards", viewport, `kpi-cards-in-viewport@${label}`);
    await assertElementInViewport(rec, page, ".ic-table-wrap thead th", viewport, `grid-header-in-viewport@${label}`);
    if (isCompactViewport(viewport)) {
      // At compact, the ic-table-wrap cap (100vh - 200px) must land the whole
      // table pane inside the window — the page needs no main scroll at all.
      await assertElementInViewport(rec, page, ".ic-table-wrap", viewport, `table-pane-in-viewport@${label}`);
    }
    await assertVrmCompactDensity(rec, page, viewport, {
      selector: ".ic-card",
      compactPadTop: "6px",
      desktopPadTop: "14px",
    });

    // Read-only detail modal (row click → GET only) must fit too.
    const rows = await page.locator(".ic-table-wrap tbody tr").count();
    if (rows > 0) {
      await page.locator(".ic-table-wrap tbody tr").first().click();
      const modal = page.locator(".ic-modal");
      await modal.waitFor({ state: "visible", timeout: SELECTOR_TIMEOUT_MS });
      await assertElementInViewport(rec, page, ".ic-modal", viewport, `detail-modal-in-viewport@${label}`);
      await page.keyboard.press("Escape").catch(() => {});
      await page.mouse.click(5, Math.round(viewport.height / 2)); // overlay click closes
    } else {
      console.log("  SKIP  detail-modal — no call rows in this environment");
    }
  },
}).catch((err) => {
  console.error(`\nFATAL: ${err?.message || err}`);
  process.exitCode = 1;
});
