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
- **Pinned-height sabotage needs `flexShrink: 0` AND the flex classes stripped.**
  A bare `height: 900` on a flex-item pane is silently shrunk back to fit by the
  default `flex-shrink: 1` (overflow-auto zeroes the automatic min-size). Worse:
  on a `flex-1` pane (`flex: 1 1 0%`) even `height + flexShrink:0` is a no-op in
  the column direction — flex-basis 0% wins over `height`, the guard stays green,
  and the sabotage proves nothing (seen live on the VRM shell 2026-08-24). Real
  pin = remove `flex-1 min-h-0` from the pane while adding the height.
- **Inline-styled pages** (e.g. VRM Ops Queue) need `!important` on every
  override of an inline property — *including `display:none`* when the target
  carries an inline `display:flex` (the VRM Rental Ops clock line silently
  stayed visible without it). A shell's inline padding can be reclaimed
  page-scoped via `main[data-testid=...]:has(.page-root) { padding: Npx !important; }`.
- **Pages with their own viewport math move in lockstep.** An inline
  `maxHeight: calc(100vh - Npx)` scroller and a sticky offset tied to the
  header-row height (`top: 32` tuned to a 35px desktop `th`) both go wrong once
  the chrome above compacts; re-tune both constants inside the compact block by
  live measurement, never by arithmetic on the desktop values.
- **Mechanism probes beat screenshots for pass/fail:** a shared helper
  (scripts/lib/vrm-compact-probe.ts) asserts per viewport that (1) matchMedia
  for the compact query flips exactly at the threshold, (2) the shell main's
  computed padding is the reclaimed value under compact and the stock inline
  value otherwise, (3) one hooked element's computed padding flips between its
  compact/desktop values — catching both a deleted CSS block and stripped hook
  classes at every viewport, data-independent.
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
