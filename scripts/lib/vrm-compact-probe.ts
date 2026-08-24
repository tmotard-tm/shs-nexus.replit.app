/**
 * Shared compact-density probe for the VRM boards (Task #826).
 *
 * "Noticeably denser below 1280×720, pixel-identical at 1280×720 and larger"
 * cannot be proven by screenshot diffing on live-data boards (clocks/counts
 * drift — see .agents/memory/compact-density-css.md). Instead we assert the
 * mechanism directly at every viewport:
 *   1. window.matchMedia for the compact media condition matches exactly when
 *      the viewport is below the xl breakpoint or ≤650px tall — this is the
 *      "desktop unchanged" proof at 1280×720 (threshold is 1279.98px, so
 *      1280 wide never matches).
 *   2. the VRM shell main's computed padding is 12px under compact and the
 *      stock inline 32px otherwise — proves the :has(.page-root) reclaim rule
 *      exists AND the page root hook class is present.
 *   3. a page-supplied hooked element's computed padding-top flips between
 *      its compact and desktop values — proves the page's own hook classes
 *      were not stripped.
 */
import type { Page } from "playwright-core";
import type { CheckRecorder, Viewport } from "./viewport-guard";
import { viewportLabel } from "./viewport-guard";

export const COMPACT_MEDIA_QUERY = "(max-width: 1279.98px), (max-height: 650px)";

export function isCompactViewport(v: Viewport): boolean {
  return v.width < 1280 || v.height <= 650;
}

export async function assertVrmCompactDensity(
  rec: CheckRecorder,
  page: Page,
  viewport: Viewport,
  probe: { selector: string; compactPadTop: string; desktopPadTop: string },
): Promise<void> {
  const label = viewportLabel(viewport);
  const compact = isCompactViewport(viewport);
  const m = await page.evaluate(
    ({ query, selector }) => {
      const main = document.querySelector('main[data-testid="vrm-main"]');
      const el = document.querySelector(selector);
      return {
        mediaMatches: window.matchMedia(query).matches,
        mainPadTop: main ? getComputedStyle(main).paddingTop : null,
        probePadTop: el ? getComputedStyle(el).paddingTop : null,
      };
    },
    { query: COMPACT_MEDIA_QUERY, selector: probe.selector },
  );
  rec.assert(
    m.mediaMatches === compact,
    `compact-media-${compact ? "on" : "off"}@${label}`,
    `matchMedia("${COMPACT_MEDIA_QUERY}") = ${m.mediaMatches}, expected ${compact}`,
  );
  const wantMain = compact ? "12px" : "32px";
  rec.assert(
    m.mainPadTop === wantMain,
    `vrm-main-padding@${label}`,
    `computed padding-top ${m.mainPadTop} on vrm-main, expected ${wantMain} (${compact ? "compact reclaim rule" : "stock inline padding untouched"})`,
  );
  const wantProbe = compact ? probe.compactPadTop : probe.desktopPadTop;
  rec.assert(
    m.probePadTop === wantProbe,
    `hook-density@${label}`,
    `computed padding-top ${m.probePadTop} on ${probe.selector}, expected ${wantProbe}`,
  );
}
