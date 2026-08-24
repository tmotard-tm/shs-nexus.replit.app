/**
 * Shared open-overlay probe for the shared VRM case-file slide-over
 * (client/src/pages/vehicle-rental-management/components/case-detail-panel.tsx)
 * used by the Rental Operations and Cases by Region board guards (Task #832).
 *
 * The panel is its own scroll container (maxHeight 90vh, overflow-y auto)
 * with an inline position:sticky header carrying the primary actions
 * (Refresh from Holman / Close) — that contract holds at ALL sizes, so these
 * assertions run at every viewport, not only compact ones.
 *
 * A short case file passes a plain "close button in viewport" check
 * vacuously (see .agents/memory/viewport-fit-guard.md), so the probe also
 * injects a tall spacer into the panel, proves the PANEL became the scroll
 * container (not the page), scrolls it to the bottom, and re-asserts the
 * close action is still fully on screen — the sticky-header contract under a
 * genuinely overflowing case file.
 */
import type { Page } from "playwright-core";
import type { CheckRecorder, Viewport } from "./viewport-guard";
import { assertElementInViewport, assertNoPageScroll, viewportLabel } from "./viewport-guard";

export const CASE_PANEL = '[data-testid="case-detail-panel"]';
export const CASE_PANEL_CLOSE = '[data-testid="button-case-panel-close"]';

/** Call with the case-detail panel ALREADY open (and ideally settled). */
export async function assertCaseDetailOverlay(
  rec: CheckRecorder,
  page: Page,
  viewport: Viewport,
): Promise<void> {
  const label = viewportLabel(viewport);

  // The whole panel must fit inside the viewport (90vh cap + centered
  // overlay) and the primary action must be on screen as-opened.
  await assertElementInViewport(rec, page, CASE_PANEL, viewport, `case-panel-in-viewport@${label}`);
  await assertElementInViewport(rec, page, CASE_PANEL_CLOSE, viewport, `case-panel-close-in-viewport@${label}`);
  await assertNoPageScroll(rec, page, `no-page-scroll:case-panel@${label}`);

  // Overflow stress — never let a short case file pass vacuously.
  const stress = await page.evaluate((sel) => {
    const panel = document.querySelector(sel) as HTMLElement | null;
    if (!panel) return null;
    const spacer = document.createElement("div");
    spacer.id = "__vg-case-panel-spacer";
    spacer.style.height = "2400px";
    spacer.style.flexShrink = "0";
    panel.appendChild(spacer);
    const panelScrolls = panel.scrollHeight > panel.clientHeight + 4;
    panel.scrollTop = panel.scrollHeight;
    const se = document.scrollingElement || document.documentElement;
    return {
      panelScrolls,
      scrollTop: Math.round(panel.scrollTop),
      docScrolls: se.scrollHeight > window.innerHeight + 1,
    };
  }, CASE_PANEL);
  if (!stress) {
    rec.assert(false, `case-panel-scrolls@${label}`, "case-detail-panel not found while open");
  } else {
    rec.assert(
      stress.panelScrolls && stress.scrollTop > 0 && !stress.docScrolls,
      `case-panel-scrolls@${label}`,
      `with a 2400px spacer the panel scrolls=${stress.panelScrolls}, scrollTop=${stress.scrollTop}px, ` +
        `page-scrolls=${stress.docScrolls} (the panel, not the page, must absorb overflow)`,
    );
  }
  // Scrolled to the very bottom, the sticky header must still hold the
  // primary action on screen — THE assertion that trips when the inline
  // position:sticky is removed from the panel header.
  await assertElementInViewport(rec, page, CASE_PANEL_CLOSE, viewport, `case-panel-close-pinned-overflow@${label}`);
  await page.evaluate(() => document.getElementById("__vg-case-panel-spacer")?.remove());
}
