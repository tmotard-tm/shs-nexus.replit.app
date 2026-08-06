---
name: Stale vite dev page kills React dispatch
description: React onClick exists on the fiber but never fires, no errors — stale dev page from the optimize window, not app code
---
Symptom: an element's `__reactProps` onClick is a function, title/cursor/testid all render, `EL.click()` and real clicks bubble to `document`, yet React never runs the handler — no console error, no state change, no network. Calling the props onClick directly (`EL[reactPropsKey].onClick({stopPropagation(){},preventDefault(){}})`) works and updates live state.

**Why:** dev-only vite artifact. A page loaded during/straddling the dependency re-optimization window right after a new module with new imports was added can end up with event delegation split across module copies — the root listener no longer recognizes the element's fiber tag, so it silently dispatches to nothing. Fresh loads after the module graph settles behave correctly; production builds are unaffected.

**How to apply:** when a React handler "doesn't fire" in the Replit dev preview right after adding new files/imports, hard-reload the page (or restart the e2e tester with a fresh context) BEFORE debugging app code. Fast discrimination: (1) direct props-onClick call — if it works, handler+state are fine; (2) document-level native click listener — if bubbling reaches document, nothing is swallowing the event. Both positive = stale-page artifact; reload and retest instead of hunting phantom stopPropagation bugs.
