---
name: Viewport-fit UI guards
description: How to write a headless-browser check that actually catches "component falls below the fold" regressions
---

# Viewport-fit guards need two viewports and a pane-fill assertion

The comms inbox has a headless validation check (`comms-inbox-viewport`,
scripts/check-comms-inbox-viewport.ts) guarding its fits-on-13"-laptop layout.
Two non-obvious lessons from building it:

**A hardcoded height can be pixel-identical at the one size you test.**
Reintroducing the old `h-[calc(100dvh-220px)] min-h-[420px]` bug produced a
byte-for-byte identical layout at 1280x720 (the calc constant happened to match
header+tabs+padding at that width) — every assertion passed. Only a second,
smaller viewport (1024x576) exposed it via the min-height floor. Never trust a
single viewport to prove "no hardcoded viewport math".

**`overflow-hidden` containers make page-scroll checks blind.** When the pane
overflows inside an `overflow-hidden` page container, `document.scrollHeight`
stays equal to the viewport — content is clipped invisible, not scrolled. The
check that catches this class of break is asserting the pane's bounding-box
bottom lands inside a narrow window near the viewport bottom (fills, never
past), via a stable `data-testid="inbox-pane"` hook.

**How to apply:** any future "X must stay on screen" guard should (1) run at
two viewport sizes, (2) assert the flex-filled container's bottom edge window,
not just absence of page scroll, and (3) sabotage-test both failure modes
(hardcoded height AND removed height wrapper) before trusting it green.

# Lessons from generalizing the guard to other screens

**Bind the shell, not the page.** An `h-screen` shell with a scrollable main
gives every page "no document scroll" for free while document-style pages keep
their UX. Never clamp a page root whose header stack is tall — a viewport-bound
flex chain crushes the content list to a useless keyhole.

**Flex shrink silently neutralizes a hardcoded-height sabotage.** A fixed
height on a flex child with default shrink just shrinks back to available
space and the guard stays green; pin it with `shrink-0` or the sabotage proves
nothing.

**Horizontal overflow is a first-class failure mode.** A wide inner table
propagates min-content width through any flex inset lacking `min-w-0`, pushing
the whole document sideways so toolbar buttons sit past the right edge at
every size. Guards need a doc-scrollWidth assertion plus
primary-action-in-viewport (which checks x too).

**tsx + page.evaluate:** esbuild's keepNames injects `__name` into function
args, so nested functions inside `page.evaluate(() => ...)` throw
`ReferenceError: __name is not defined` in the browser — pass the evaluate
body as a plain string instead.


# Lessons from extending guards to dialogs/drawers/overlays

**Radix popovers self-heal child-level assertions.** Collision handling
repositions the popover so an "input-in-viewport" check passes even when the
content is sabotaged 600px taller — assert the
`div[data-radix-popper-content-wrapper]` box instead; that CAN overflow a
short screen and actually trips.

**Duplicate JSX className silently drops a sabotage.** Adding
`className="mt-[600px]"` to an element that already has a later `className`
prop does nothing (later attribute wins, no error) — merge into the existing
class list or the sabotage run proves nothing.

**Inline-styled custom overlays can't use scoped-CSS density hooks.** Inline
styles beat class overrides without `!important`; the clean fix is
restructuring the component itself into pinned header/footer + a
`flex:1 1 auto; minHeight:0; overflowY:auto` body wrapper (visually identical
whenever content fits, pins the action button when it doesn't — all sizes).
Verify pinning positively too: temporary tall filler INSIDE the body wrapper
must still pass the button-in-viewport check.
# CSS-only pin when the action button lives INSIDE the scroll body

When a footer cannot be re-parented into a pinned flex sibling (inline-styled
JSX, compact-only requirement), `position: sticky; bottom: 0` on the footer —
kept the LAST child of the scroll body — pins it CSS-only (give it a
background + z-index; negative side margins mirroring the body padding make
it span the full panel width). Two guard traps that follow from sticky:
- The overflow-stress spacer must be inserted BEFORE the sticky footer
  (`insertBefore(spacer, footer)`, never `appendChild`) — content appended
  after it moves the footer's natural position up and sticky no longer holds
  it at scroll-bottom, so the guard tests the wrong contract.
- The sabotage-sensitive assertion is button-in-viewport at `scrollTop = 0`
  with the spacer in place (natural position far below the fold); the
  scrolled-to-bottom variant passes with or without the CSS.
For a compact-only pin, also assert the footer's computed `position` flips
sticky/static across the media threshold — that is the "desktop unchanged"
proof. A sticky-TOP header (VRM case-detail panel) is the mirror image: the
sabotage-sensitive assertion is action-in-viewport after scrolling the
container to the BOTTOM.

# Lessons from pinning dialog footers (Fleet Comms dialogs)

**A pinned-footer CSS contract only protects direct siblings of the scroll
body.** The `.fc-dialog > :not(.fc-dialog-body)` pin cannot reach an action
button nested INSIDE the scrollable body — the Templates dialog's Create
button sat in the body's grid and silently escaped the contract while Compose/
Bulk (real `DialogFooter` siblings) were fine. When adding a dialog to the
pinned layout, verify the primary action is a sibling of the body, not a
descendant.

**Kill vacuous passes with an overflow stress.** A "primary action stays on
screen" assertion passes trivially whenever the live content happens to be
short (empty roster, few templates). Fix: `page.evaluate` injects a tall
(2000px, `flexShrink:0`) spacer into the scroll body, assert the BODY became
the scroll container (`scrollHeight > clientHeight` and `scrollTop > 0` after
scrolling to bottom — false means the pinned layout CSS is gone), then
re-assert the primary action's bounding box in-viewport, then remove the
spacer. This makes the guard independent of fixture data height at every
viewport.

# False reds: cold caches and guard concurrency

Two ways a viewport guard fails with NO layout regression:
1. Cold start — the first run after a dev-server restart can exceed the
   selector budget while a heavy board builds its caches; the same command
   passes warm.
2. Concurrency — validation runs launch every registered guard at once; many
   Chromium instances starve the single vite dev server (page.goto timeouts,
   CDP assert-crashes). runViewportGuard therefore serializes browser runs
   through /tmp/viewport-guard-slot-* (2 concurrent max; PID-liveness reaping,
   ownership-token release). New guards inherit this by using runViewportGuard;
   bypassing the shared runner reintroduces the pile-up.
Before debugging a red guard as a layout bug, check for a just-restarted
server and rerun it alone on a warm one.
