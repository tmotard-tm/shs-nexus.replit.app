/**
 * Regression guard for Task #767/#768: the Fleet Communications inbox must fit
 * small 13" laptop viewports with the composer on-screen.
 *
 * What broke before: the inbox pane used viewport math (100dvh minus a
 * hardcoded 220px, with a 420px floor) and the header toolbar wrapped to 2-3
 * rows, so on small screens the send button fell below the fold and the page
 * scrolled. Task #767 fixed it with a flex chain:
 *   /fleet-communications route -> MainContent h-[100dvh]
 *   page container: h-full min-h-0 flex flex-col overflow-hidden
 *   inbox pane:     flex-1 min-h-0
 * plus a "..." toolbar overflow menu below the 2xl breakpoint and a
 * single-row horizontally scrolling category tab strip.
 *
 * This script loads /fleet-communications headless at 1280x720 AND 1024x576
 * (see scripts/lib/viewport-guard.ts for why both sizes are mandatory), plus
 * a third 1024x500 viewport (Task #820: a 13" Windows laptop at 125-150%
 * display scaling leaves ~1024x500 after browser chrome and the taskbar —
 * the size the compact density media query in client/src/index.css targets),
 * opens a real thread at each size, and asserts:
 *   1. no page-level scroll (document scrollHeight <= viewport height)
 *   2. the inbox pane's bottom edge lands near the viewport bottom (the
 *      flex-1 fill), never past it
 *   3. the composer send button's bounding box is fully inside the viewport
 *   4. the category tab strip stays a single row
 *   5. the "..." overflow menu button is visible while the full (>=2xl)
 *      toolbar buttons are hidden
 *
 * Task #822 extends the same run to the three dialogs (New, Bulk, Templates):
 * at each viewport it opens each dialog and asserts the page still doesn't
 * scroll; at the compact sizes (matching the index.css media query: <1280px
 * wide or <=650px tall) it additionally asserts the dialog's primary action
 * button (Send / Preview / Create) is fully inside the viewport — the
 * fc-dialog rules pin the dialog header+footer and confine scrolling to the
 * body, so the action button must never leave the screen. At 1280x720 the
 * dialogs keep their stock whole-dialog scroll (desktop unchanged), so the
 * button-visible assertion is compact-only by design.
 *
 * Session mint/revoke, Chromium launch, and the viewport loop live in
 * scripts/lib/viewport-guard.ts (shared with the other screen-fit guards).
 *
 * Run: npx tsx scripts/check-comms-inbox-viewport.ts
 * Registered as the `comms-inbox-viewport` validation command.
 */
import {
  BASE_URL,
  NAV_TIMEOUT_MS,
  SELECTOR_TIMEOUT_MS,
  SMALL_LAPTOP_VIEWPORTS,
  runViewportGuard,
  failIfOnLoginPage,
  assertNoPageScroll,
  assertPaneBottomWindow,
  assertElementInViewport,
  viewportLabel,
} from "./lib/viewport-guard";

const PAGE_PATH = "/fleet-communications";
// The two shared mandatory sizes plus the scaled-small-laptop reality
// (Task #820): 13" Windows machines at 125-150% scaling end up around
// 1024x500 effective viewport. The compact density treatment must hold the
// exact same pane-fill + composer-visible invariants there.
const VIEWPORTS = [...SMALL_LAPTOP_VIEWPORTS, { width: 1024, height: 500 }];
// The pane should absorb all remaining height. Its bottom edge sits above the
// page container's bottom padding (p-4 md:p-6 => up to 24px); 48px of slack
// tolerates that padding plus rounding without letting a shrunken pane pass.
const PANE_FILL_SLACK_PX = 48;

runViewportGuard({
  screenName: "Fleet Communications inbox",
  failureHint:
    "The Fleet Communications inbox no longer fits a small-laptop viewport. " +
    "Likely causes: the /fleet-communications route lost its h-[100dvh] MainContent wrapper (client/src/App.tsx), " +
    "the inbox pane lost flex-1/min-h-0 or regained hardcoded viewport math (client/src/pages/fleet-communications.tsx), " +
    "the toolbar overflow menu / 2xl breakpoint split was removed, or the category tabs wrap again. " +
    "If only 1024x500 fails, the compact density block in client/src/index.css (Task #820) may have been " +
    "removed or its fc-* hook classes stripped from the page. " +
    "If a dialog-* check fails, the fc-dialog/fc-dialog-body hook classes on the New/Bulk/Templates " +
    "DialogContent (Task #822) or their compact media rules in client/src/index.css were likely removed.",
  viewports: VIEWPORTS,
  runAtViewport: async (page, viewport, rec) => {
    const label = viewportLabel(viewport);
    await page.goto(`${BASE_URL}${PAGE_PATH}`, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });

    // The category tab strip renders once /api/fs/comms/config resolves — its
    // presence proves we are past auth AND past the comms access gate.
    await page.waitForSelector('[data-testid="tab-all"]', { timeout: SELECTOR_TIMEOUT_MS });
    await failIfOnLoginPage(page);

    // ── List state: toolbar + tab-row + no page scroll ───────────────────────
    console.log(`\n[list state @ ${label}]`);

    const overflowVisible = await page.locator('[data-testid="button-toolbar-overflow"]').isVisible();
    rec.assert(overflowVisible, `overflow-menu-visible@${label}`, `"..." toolbar overflow button visible below 2xl: ${overflowVisible}`);

    // The full (>=2xl) toolbar buttons must be hidden at these widths.
    // `button-bulk-send` and `button-sync-contacts` render for every
    // privileged user (no config dependency), so they are reliable probes.
    for (const tid of ["button-bulk-send", "button-sync-contacts"]) {
      const el = page.locator(`[data-testid="${tid}"]`);
      const exists = (await el.count()) > 0;
      const visible = exists ? await el.isVisible() : false;
      rec.assert(!visible, `full-toolbar-hidden:${tid}@${label}`, exists ? `rendered but hidden: ${!visible}` : "not rendered (hidden container)");
    }

    const tabRow = await page.evaluate(() => {
      const all = document.querySelector('[data-testid="tab-all"]') as HTMLElement | null;
      if (!all) return null;
      const strip = all.parentElement as HTMLElement;
      const buttons = Array.from(strip.querySelectorAll("button")) as HTMLElement[];
      const tops = buttons.map((b) => Math.round(b.getBoundingClientRect().top));
      return {
        stripHeight: Math.round(strip.getBoundingClientRect().height),
        buttonHeight: Math.round(all.getBoundingClientRect().height),
        buttonCount: buttons.length,
        distinctTops: Array.from(new Set(tops)),
        scrollable: strip.scrollWidth > strip.clientWidth,
      };
    });
    if (!tabRow) {
      rec.assert(false, `tab-row-single-row@${label}`, "category tab strip not found");
    } else {
      // Single row == every tab button sits at the same y AND the strip is no
      // taller than one button plus its padding. If tabs ever wrap again, both
      // measures blow up.
      const singleRow =
        tabRow.distinctTops.length === 1 &&
        tabRow.stripHeight <= tabRow.buttonHeight + 16;
      rec.assert(
        singleRow,
        `tab-row-single-row@${label}`,
        `${tabRow.buttonCount} tabs, strip ${tabRow.stripHeight}px vs button ${tabRow.buttonHeight}px, ` +
          `${tabRow.distinctTops.length} distinct row top(s), h-scrollable=${tabRow.scrollable}`,
      );
    }

    await assertNoPageScroll(rec, page, `no-page-scroll:list@${label}`);

    // The inbox pane must absorb the remaining height: bottom edge near (and
    // never past) the viewport bottom. A reintroduced hardcoded height either
    // overflows (bottom past the viewport) or strands empty space (bottom far
    // above it) at one of the two checked sizes.
    await assertPaneBottomWindow(
      rec,
      page,
      '[data-testid="inbox-pane"]',
      viewport,
      `pane-fills-viewport@${label}`,
      PANE_FILL_SLACK_PX,
    );

    // ── Open a real thread and check the composer ────────────────────────────
    console.log(`[thread state @ ${label}]`);
    const firstThread = page.locator('[data-testid^="thread-"]').first();
    try {
      await firstThread.waitFor({ state: "visible", timeout: SELECTOR_TIMEOUT_MS });
    } catch {
      throw new Error(
        "No conversation appeared in the thread list — the check needs at least one non-archived row in " +
          "fs_comms_threads to open a thread and measure the composer. If the dev comms tables were emptied, " +
          "re-run the comms cutover/heal scripts first.",
      );
    }
    await firstThread.click();

    const sendBtn = page.locator('[data-testid="button-send"]');
    await sendBtn.waitFor({ state: "visible", timeout: SELECTOR_TIMEOUT_MS });
    // Let messages render + auto-scroll settle before measuring.
    await page.waitForTimeout(1000);

    await assertElementInViewport(rec, page, '[data-testid="button-send"]', viewport, `send-button-in-viewport@${label}`);
    await assertNoPageScroll(rec, page, `no-page-scroll:thread@${label}`);

    // ── Dialogs (Task #822): New / Bulk / Templates ──────────────────────────
    // The compact fc-dialog rules apply below 1280px wide or at <=650px tall
    // (same condition as the index.css media query). Only there do we demand
    // the primary action button on screen — at desktop sizes the dialogs keep
    // their stock whole-dialog scroll and the button may sit below the fold of
    // a long recipient list (existing, intentional behavior).
    const compact = viewport.width < 1280 || viewport.height <= 650;
    console.log(`[dialog state @ ${label}${compact ? ", compact" : ""}]`);

    const dialogs: Array<{
      name: string;
      open: () => Promise<void>;
      /** Selector that proves the dialog is open AND is its primary action. */
      primary: string;
      /** Optional wait for async dialog content to finish expanding. */
      settle?: () => Promise<void>;
    }> = [
      {
        name: "compose",
        open: async () => {
          await page.locator('[data-testid="button-compose"]').click();
        },
        primary: '[data-testid="button-compose-send"]',
        settle: async () => {
          // The recipient picker fetches the full roster; wait for rows so the
          // dialog is measured at its tallest (a missing roster in dev is
          // tolerated — the dialog is then shorter, which can only pass).
          await page
            .waitForSelector('[data-testid^="picker-contact-"]', { timeout: 15_000 })
            .catch(() => {});
        },
      },
      {
        name: "bulk",
        open: async () => {
          // Below 2xl the Bulk button lives in the "..." overflow menu — the
          // same path a real small-laptop user takes.
          await page.locator('[data-testid="button-toolbar-overflow"]').click();
          await page.locator('[data-testid="menu-bulk-send"]').click();
        },
        primary: '[data-testid="button-bulk-preview"]',
      },
      {
        name: "templates",
        open: async () => {
          await page.locator('[data-testid="button-toolbar-overflow"]').click();
          await page.locator('[data-testid="menu-manage-templates"]').click();
        },
        primary: '[data-testid="button-save-template"]',
      },
    ];

    for (const d of dialogs) {
      await d.open();
      const primaryEl = page.locator(d.primary);
      await primaryEl.waitFor({ state: "visible", timeout: SELECTOR_TIMEOUT_MS });
      if (d.settle) await d.settle();
      // Let queries/animations finish before measuring.
      await page.waitForTimeout(500);

      if (compact) {
        await assertElementInViewport(rec, page, d.primary, viewport, `dialog-${d.name}-primary-in-viewport@${label}`);
      }
      await assertNoPageScroll(rec, page, `no-page-scroll:dialog-${d.name}@${label}`);

      await page.keyboard.press("Escape");
      await primaryEl.waitFor({ state: "hidden", timeout: SELECTOR_TIMEOUT_MS });
    }
  },
}).catch((err) => {
  console.error(`\nFATAL: ${err?.message || err}`);
  process.exitCode = 1;
});
