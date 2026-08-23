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
