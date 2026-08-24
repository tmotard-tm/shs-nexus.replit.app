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
- **Pinned-height sabotage needs `flexShrink: 0`.** A bare `height: 900` on a
  flex-item pane is silently shrunk back to fit by the default `flex-shrink: 1`
  (overflow-auto zeroes the automatic min-size), so the guard stays green and the
  sabotage proves nothing. Seen live on both shell mains 2026-08-24.
- **Inline-styled pages** (e.g. VRM Ops Queue) need `!important` on every
  override of an inline property; hidden elements (`display:none`) don't. A
  shell's inline padding can be reclaimed page-scoped via
  `main[data-testid=...]:has(.page-root) { padding: Npx !important; }`.
- **"Desktop unchanged" proof on live-data boards:** before/after screenshot
  compare drifts (clocks, counts, cache warm-up). Prove it with
  `matchMedia(query).matches === false` at 1280×720 plus computed-style probes
  on the hooked elements; use an identical-code double-capture to bound
  data noise if screenshots are still wanted.

**How to apply:** any "page too big on 13-inch laptops" request → hook classes +
scoped media block, extend that page's guard with the smaller viewport
(~1024×500 simulates 125–150% Windows scaling), sabotage-test, screenshot both
sizes.
## Dialogs (Radix portals) need their own hook scope

Dialogs portal to `<body>`, so `.page-scope .hook` selectors never match them —
give the DialogContent its own hook class (e.g. `fc-dialog`) inside the same
media block. Density alone can't fit a dialog whose body holds an unbounded
list (recipient picker); the winning compact-only pattern is:
- `display:flex; flex-direction:column; overflow-y:hidden` on the (doubled)
  content class, `flex:1 1 auto; min-height:0; overflow-y:auto` on a body hook,
  `flex-shrink:0` on the other children → header+footer pinned, only the body
  scrolls, primary button always on screen. Desktop keeps the stock
  grid + whole-dialog scroll (existing behavior, intentionally unchanged).
- Guard: assert primary-button-in-viewport only when the viewport matches the
  compact media condition; assert no-page-scroll at every size. Sabotage-verify
  the assertion actually fails with the CSS removed — a short dialog (Templates)
  can pass vacuously.
