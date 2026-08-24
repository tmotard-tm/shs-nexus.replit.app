---
name: Compact density CSS overrides
description: How to add small-viewport "zoomed out" density to a Tailwind page without breaking its layout contract or desktop look
---

# Small-laptop compact density via a scoped plain-CSS block

First used on Fleet Communications: a plain CSS block in client/src/index.css under
`@media (max-width: 1279.98px), (max-height: 650px)`, targeting style-free hook
classes (`fc-*`) placed on the page. Rules to reuse:

- **Threshold just below the xl breakpoint (1279.98px), not 1280px** — the shared
  viewport guards' 1280×720 size then stays byte-identical to real desktop, so
  "desktop unchanged" is provable by the same screenshot.
- **Tailwind `space-y-*` beats naive overrides.** Its generated selector is
  `.space-y-2 > :not([hidden]) ~ :not([hidden])` (specificity 0,3,0); a
  `.scope .hook > * + *` override (0,2,0) silently loses. Mirror the
  `> :not([hidden]) ~ :not([hidden])` form in the override.
- **Root-element ties:** utilities like `p-4`/`gap-4` tie a single-class override
  at 0,1,0 and win/lose on stylesheet order; double the class
  (`.fleet-comms.fleet-comms`) to make the override order-independent.
- **Density only** — padding, gaps, control heights, hidden subtitles. Never set
  heights on the flex-fill pane chain; after adding density, still run the page's
  viewport guard AND both sabotage modes (hardcoded pinned height + removed
  height wrapper) per viewport-fit-guard.md.

**How to apply:** any "page too big on 13-inch laptops" request → hook classes +
scoped media block, extend that page's guard with the smaller viewport
(~1024×500 simulates 125–150% Windows scaling), sabotage-test, screenshot both
sizes.
