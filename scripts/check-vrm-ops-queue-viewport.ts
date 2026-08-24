/**
 * Screen-fit guard for the VRM Ops Queue
 * (/vehicle-rental-management/ops-queue) on 13" laptops (Task #769).
 *
 * Layout contract (RouteReadyLayout binds the height chain with h-screen +
 * min-h-0/overflow-auto on <main data-testid="vrm-main">):
 *   1. the document NEVER scrolls — vertically or horizontally — at any
 *      viewport; the board scrolls inside the shell main
 *   2. the shell main's bottom edge lands exactly at the viewport bottom
 *   3. the primary action (Refresh, data-testid=button-refresh-queue) stays
 *      fully inside the viewport on load
 *   4. the work-bucket strip is fully visible above the fold at every size —
 *      if the header stack ever grows (wrapping toolbars, extra banners), the
 *      strip is pushed down and this trips first
 *
 * Task #825 adds the page's three overlays at EVERY size:
 *   - tech-text modal (per-row Text action): pinned title/footer flex column,
 *     only the middle scrolls — the send button must stay on screen
 *     (tech-text-modal.tsx). The check NEVER clicks send (dev comms sends
 *     LIVE SMS — .agents/memory/dev-comms-live-sms.md); it only measures.
 *   - shop-info slide-out (pencil next to the shop chip): pinned
 *     header/footer, scrolling middle — "Save shop info" must stay on screen
 *     (shop-info-panel.tsx). Its content is taller than a 500px viewport, so
 *     this is the check with real teeth at the short size.
 *   - case-detail drawer (clicking a case row): 90vh-capped modal with a
 *     sticky header — the whole modal box must fit inside the viewport.
 *
 * Run: npx tsx scripts/check-vrm-ops-queue-viewport.ts
 * Registered as the `vrm-ops-queue-viewport` validation command.
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

const PAGE_PATH = "/vehicle-rental-management/ops-queue";
// The two shared mandatory sizes plus the scaled-small-laptop reality
// (Task #823, pattern from #820): 13" Windows machines at 125-150% display
// scaling end up around a 1024x500 effective viewport — the size the compact
// density media block in client/src/index.css targets (oq-* hooks).
const VIEWPORTS = [...SMALL_LAPTOP_VIEWPORTS, { width: 1024, height: 500 }];
const MAIN_FILL_SLACK_PX = 4;

runViewportGuard({
  screenName: "VRM Ops Queue",
  failureHint:
    "The VRM Ops Queue no longer fits a small-laptop viewport. Likely causes: RouteReadyLayout lost its " +
    "h-screen root or the min-h-0/overflow-auto on <main> (the document scrolls again), a hardcoded height " +
    "was added to the shell or page (client/src/pages/vehicle-rental-management/pages/OpsQueue.tsx), or the " +
    "header/view-toggle stack grew until the work-bucket strip fell below the fold. " +
    "If only 1024x500 fails, the compact density block in client/src/index.css (Task #823) may have been " +
    "removed or its oq-* hook classes stripped from the page. " +
    "If an overlay-* check fails: the tech-text modal or shop-info panel lost its pinned header/footer flex " +
    "column (overflow:hidden content + flex:1/min-height:0/overflow-y:auto body wrapper in " +
    "tech-text-modal.tsx / shop-info-panel.tsx) and its action button scrolls off short screens again, or " +
    "the case drawer (case-detail-panel.tsx) lost its 90vh cap.",
  viewports: VIEWPORTS,
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
    // every size; a growing header stack pushes it down and breaks this first.
    await assertElementInViewport(rec, page, '[data-testid="workbucket-strip"]', viewport, `strip-in-viewport@${label}`);

    // ── Overlays (Task #825) ─────────────────────────────────────────────────
    // 1. Tech-text modal — measure only; NEVER click send (live SMS in dev).
    console.log(`[tech-text modal @ ${label}]`);
    const textBtn = page.locator('[data-testid^="button-text-tech-"]').first();
    try {
      await textBtn.waitFor({ state: "visible", timeout: SELECTOR_TIMEOUT_MS });
    } catch {
      throw new Error(
        "No per-row Text action found — the overlay checks need at least one queue item with a tech-text " +
          "action. If the dev VRM queue is genuinely empty, re-run once data exists.",
      );
    }
    await textBtn.click();
    const textModal = page.locator('[data-testid="tech-text-modal"]');
    await textModal.waitFor({ state: "visible", timeout: SELECTOR_TIMEOUT_MS });
    // The send button renders once the GET preview resolves (zero side effects).
    await page.locator('[data-testid="tech-text-send"]').waitFor({ state: "visible", timeout: SELECTOR_TIMEOUT_MS });
    await page.waitForTimeout(500);
    await assertElementInViewport(rec, page, '[data-testid="tech-text-modal"]', viewport, `overlay-tech-text-in-viewport@${label}`);
    await assertElementInViewport(rec, page, '[data-testid="tech-text-send"]', viewport, `overlay-tech-text-send-in-viewport@${label}`);
    await assertNoPageScroll(rec, page, `no-page-scroll:tech-text@${label}`);
    // No ESC handler on this modal — close by clicking the backdrop (content
    // is centered at width 560, so x=8 is always backdrop).
    await page.mouse.click(8, Math.round(viewport.height / 2));
    await textModal.waitFor({ state: "hidden", timeout: SELECTOR_TIMEOUT_MS });

    // 2. Shop-info slide-out.
    console.log(`[shop-info panel @ ${label}]`);
    const editShop = page.locator('[data-testid^="button-edit-shop-"]').first();
    try {
      await editShop.waitFor({ state: "visible", timeout: SELECTOR_TIMEOUT_MS });
    } catch {
      throw new Error(
        "No shop-edit pencil found — the overlay checks need at least one queue item with a shop chip. " +
          "If the dev VRM queue has no such rows, re-run once data exists.",
      );
    }
    await editShop.click();
    const shopPanel = page.locator('[data-testid="shop-info-panel"]');
    await shopPanel.waitFor({ state: "visible", timeout: SELECTOR_TIMEOUT_MS });
    await page.waitForTimeout(300);
    await assertElementInViewport(rec, page, '[data-testid="shop-info-panel"]', viewport, `overlay-shop-info-in-viewport@${label}`);
    await assertElementInViewport(rec, page, '[data-testid="button-save-shop-info"]', viewport, `overlay-shop-info-save-in-viewport@${label}`);
    await assertNoPageScroll(rec, page, `no-page-scroll:shop-info@${label}`);
    await page.keyboard.press("Escape");
    await shopPanel.waitFor({ state: "hidden", timeout: SELECTOR_TIMEOUT_MS });

    // 3. Case-detail drawer — open the first case-bearing row (marked by its
    // "Open the case file" affordance title).
    console.log(`[case drawer @ ${label}]`);
    const caseRow = page.locator('div[title^="Open the case file"]').first();
    try {
      await caseRow.waitFor({ state: "visible", timeout: SELECTOR_TIMEOUT_MS });
    } catch {
      throw new Error(
        "No case-bearing row found — the case-drawer check needs at least one queue item with a case key. " +
          "If the dev VRM queue has no such rows, re-run once data exists.",
      );
    }
    await caseRow.click();
    const caseDrawer = page.locator('[data-testid="case-detail-panel"]');
    await caseDrawer.waitFor({ state: "visible", timeout: SELECTOR_TIMEOUT_MS });
    // Let the case payload render so the drawer is measured at its tallest.
    await page.waitForTimeout(1200);
    await assertElementInViewport(rec, page, '[data-testid="case-detail-panel"]', viewport, `overlay-case-drawer-in-viewport@${label}`);
    await assertNoPageScroll(rec, page, `no-page-scroll:case-drawer@${label}`);
    await page.keyboard.press("Escape");
    await caseDrawer.waitFor({ state: "hidden", timeout: SELECTOR_TIMEOUT_MS });
  },
}).catch((err) => {
  console.error(`\nFATAL: ${err?.message || err}`);
  process.exitCode = 1;
});
