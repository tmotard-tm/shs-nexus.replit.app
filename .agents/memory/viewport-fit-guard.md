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
