/**
 * Screen-fit guard for the Fleet Scope "All Vehicles" page (/fleet-scope) on
 * 13" laptops (Task #769).
 *
 * This page found the original bug this guard now pins down: the fleet table
 * is 2000px wide, and without min-w-0 on the SidebarInset its min-content
 * width pushed the whole document 256px wider than the screen — the
 * Refresh/Export buttons sat past the right edge on every laptop.
 *
 * Layout contract (FleetScopeLayout h-screen shell, min-w-0 inset,
 * min-h-0/overflow-auto <main data-testid="fleet-scope-main">):
 *   1. the document NEVER scrolls — vertically or horizontally — at any
 *      viewport; the dashboard scrolls inside the shell main and the wide
 *      table scrolls inside its own overflow-x container
 *   2. the shell main's bottom edge lands exactly at the viewport bottom
 *   3. the primary actions (Refresh + Export CSV) and the page title stay
 *      fully inside the viewport on load
 *   4. the fleet table card actually rendered (data loaded, not a skeleton)
 *
 * Task #825 dialog audit: All Vehicles has NO dialogs, drawers, or sheets —
 * AllVehicles.tsx renders only USMapVehicles + FleetVehicleTable, and the only
 * overlays reachable are the small filter Popovers on the table header. So
 * the overlay check here opens the vehicle-number filter popover (the tallest
 * one) at EVERY size and asserts it stays fully inside the viewport with no
 * page scroll. If a real dialog/drawer is ever added to this page, extend
 * this guard to open it (see check-vrm-ops-queue-viewport.ts for the pattern).
 *
 * Run: npx tsx scripts/check-all-vehicles-viewport.ts
 * Registered as the `all-vehicles-viewport` validation command.
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

const PAGE_PATH = "/fleet-scope";
// The two shared mandatory sizes plus the scaled-small-laptop reality
// (Task #823, pattern from #820): 13" Windows machines at 125-150% display
// scaling end up around a 1024x500 effective viewport — the size the compact
// density media block in client/src/index.css targets (av-* hooks).
const VIEWPORTS = [...SMALL_LAPTOP_VIEWPORTS, { width: 1024, height: 500 }];
const MAIN_FILL_SLACK_PX = 4;
// /api/fs/all-vehicles serves from the daily PG mirror; give a cold first
// load a little extra room beyond the default selector timeout.
const TABLE_TIMEOUT_MS = 60_000;

runViewportGuard({
  screenName: "All Vehicles",
  failureHint:
    "All Vehicles no longer fits a small-laptop viewport. Likely causes: FleetScopeLayout lost its h-screen " +
    "root, the min-h-0/overflow-auto on the shell main, or the min-w-0 on SidebarInset (the 2000px fleet " +
    "table then pushes the document wider than the screen and the toolbar buttons fall off the right edge), " +
    "or a hardcoded height was added to the shell or page (client/src/pages/fleet-scope/AllVehicles.tsx). " +
    "If only 1024x500 fails, the compact density block in client/src/index.css (Task #823) may have been " +
    "removed or its av-* hook classes stripped from the page. " +
    "If the popover-* check fails, the vehicle-number filter popover (FleetVehicleTable.tsx) grew past the " +
    "viewport or gained an offset that pushes it off short screens.",
  viewports: VIEWPORTS,
  runAtViewport: async (page, viewport, rec) => {
    const label = viewportLabel(viewport);
    console.log(`\n[All Vehicles @ ${label}]`);
    await page.goto(`${BASE_URL}${PAGE_PATH}`, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    // The title renders immediately; the table card only once
    // /api/fs/all-vehicles resolves — waiting on it proves the data loaded.
    await page.waitForSelector('[data-testid="text-page-title"]', { timeout: SELECTOR_TIMEOUT_MS });
    await failIfOnLoginPage(page);
    await page.waitForSelector('[data-testid="card-fleet-table"]', { timeout: TABLE_TIMEOUT_MS });
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
    await assertElementInViewport(rec, page, '[data-testid="button-refresh"]', viewport, `refresh-in-viewport@${label}`);
    await assertElementInViewport(rec, page, '[data-testid="button-export-csv"]', viewport, `export-in-viewport@${label}`);
    await assertElementInViewport(rec, page, '[data-testid="text-page-title"]', viewport, `page-title-in-viewport@${label}`);

    // ── Overlay audit (Task #825): this page has no dialogs/drawers; its
    // tallest overlay is the vehicle-number filter popover. It must open
    // fully inside the viewport (Radix flips/shifts it into view) without
    // introducing page scroll — at every size, including 1024x500.
    console.log(`[vehicle-number filter popover @ ${label}]`);
    const filterBtn = page.locator('[data-testid="button-filter-vehicle-number"]');
    await filterBtn.waitFor({ state: "visible", timeout: SELECTOR_TIMEOUT_MS });
    await filterBtn.click();
    const searchInput = page.locator('[data-testid="input-vehicle-number-search"]');
    await searchInput.waitFor({ state: "visible", timeout: SELECTOR_TIMEOUT_MS });
    await page.waitForTimeout(300);
    await assertElementInViewport(rec, page, '[data-testid="input-vehicle-number-search"]', viewport, `popover-filter-input-in-viewport@${label}`);
    // Radix repositions the popover to keep it on screen, so the input check
    // alone is hard to trip; the WHOLE popover box must also fit — if its
    // content ever grows taller than a short screen, Radix can only overflow.
    await assertElementInViewport(rec, page, "div[data-radix-popper-content-wrapper]", viewport, `popover-box-in-viewport@${label}`);
    await assertNoPageScroll(rec, page, `no-page-scroll:popover@${label}`);
    await page.keyboard.press("Escape");
    await searchInput.waitFor({ state: "hidden", timeout: SELECTOR_TIMEOUT_MS });
  },
}).catch((err) => {
  console.error(`\nFATAL: ${err?.message || err}`);
  process.exitCode = 1;
});
