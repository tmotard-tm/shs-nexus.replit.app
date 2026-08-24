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
import { assertVrmCompactDensity, isCompactViewport } from "./lib/vrm-compact-probe";

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
    "rdt-* hook classes were stripped from the page. " +
    "If a panel-* check fails, the add/edit slide-over's pinned-footer rules (Task #832: .rdt-panel-footer " +
    "sticky pin in the same index.css media block) or its rdt-panel-* hook classes were likely removed.",
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

    // ── Open-overlay: the add/edit entry slide-over (Task #832) ─────────────
    // The Save/Add Entry footer lives INSIDE the scrolling body; the compact
    // block in index.css sticky-pins it to the bottom of the body's
    // scrollport so it never leaves a small-laptop screen. Desktop keeps the
    // stock scroll-with-content behavior — proven by the computed-position
    // probe below, not by absence of a check.
    console.log(`[entry panel @ ${label}]`);
    const compact = isCompactViewport(viewport);
    await page.locator('[data-testid="button-add-entry"]').click();
    await page.waitForSelector('[data-testid="button-panel-save"]', { timeout: SELECTOR_TIMEOUT_MS });
    await page.waitForTimeout(300);
    await assertNoPageScroll(rec, page, `no-page-scroll:panel@${label}`);

    const footerPos = await page.evaluate(() => {
      const f = document.querySelector(".rdt-panel-footer");
      return f ? getComputedStyle(f).position : null;
    });
    const wantPos = compact ? "sticky" : "static";
    rec.assert(
      footerPos === wantPos,
      `panel-footer-position@${label}`,
      `computed position ${footerPos} on .rdt-panel-footer, expected ${wantPos} ` +
        `(${compact ? "compact sticky pin" : "desktop scroll-with-content untouched"})`,
    );

    if (compact) {
      // The Add Entry form is long; the pinned footer must be on screen
      // as-opened…
      await assertElementInViewport(rec, page, '[data-testid="button-panel-save"]', viewport, `panel-save-in-viewport@${label}`);
      // …and stay there under a genuine overflow, however short the form may
      // become (a short panel passes the plain check vacuously). The spacer
      // goes BEFORE the footer so the footer stays the body's last child —
      // the position the sticky pin protects.
      const stress = await page.evaluate(() => {
        const body = document.querySelector(".rdt-panel-body") as HTMLElement | null;
        const footer = document.querySelector(".rdt-panel-footer") as HTMLElement | null;
        if (!body || !footer) return null;
        const spacer = document.createElement("div");
        spacer.id = "__vg-rdt-panel-spacer";
        spacer.style.height = "2000px";
        spacer.style.flexShrink = "0";
        body.insertBefore(spacer, footer);
        body.scrollTop = 0; // footer's natural position now sits ~2000px below the scrollport
        return { bodyScrolls: body.scrollHeight > body.clientHeight + 4 };
      });
      if (!stress) {
        rec.assert(false, `panel-body-scrolls@${label}`, ".rdt-panel-body/.rdt-panel-footer not found in the open slide-over");
      } else {
        rec.assert(
          stress.bodyScrolls,
          `panel-body-scrolls@${label}`,
          `with a 2000px spacer the body scrolls=${stress.bodyScrolls} (false means the body is no longer the panel's scroll container)`,
        );
      }
      // Scrolled to the TOP with 2000px of form below, only the sticky pin
      // keeps Save on screen — THE assertion that trips when the Task #832
      // CSS is removed or the rdt-panel-* hook classes are stripped.
      await assertElementInViewport(rec, page, '[data-testid="button-panel-save"]', viewport, `panel-save-pinned-overflow-top@${label}`);
      await page.evaluate(() => {
        const body = document.querySelector(".rdt-panel-body") as HTMLElement | null;
        if (body) body.scrollTop = body.scrollHeight;
      });
      await assertElementInViewport(rec, page, '[data-testid="button-panel-save"]', viewport, `panel-save-pinned-overflow-bottom@${label}`);
      await page.evaluate(() => document.getElementById("__vg-rdt-panel-spacer")?.remove());
    }

    await page.locator('[data-testid="button-panel-close"]').click();
    await page.locator('[data-testid="rdt-panel"]').waitFor({ state: "hidden", timeout: SELECTOR_TIMEOUT_MS });
  },
}).catch((err) => {
  console.error(`\nFATAL: ${err?.message || err}`);
  process.exitCode = 1;
});
