---
name: jsdom component-test recipe
description: How to render real client pages under node:test + tsx (JSX config, globals, provider harness, common traps)
---

# Rendering real React pages in node:test (no vitest/testing-library)

Working recipe proven by the Create Vehicle form-wiring suite (`tests/vehicle-create-form-wiring.test.ts`).

**How to apply:**
- Run with a dedicated tsconfig: `npx tsx --tsconfig tsconfig.dom-tests.json --test --test-force-exit tests/<file>.test.ts`. The app tsconfig has `jsx: "preserve"` (Vite handles JSX), which makes tsx compile imported `.tsx` sources classically → runtime `React is not defined`. `tsconfig.dom-tests.json` extends it with `jsx: "react-jsx"`.
- `--test-force-exit` is mandatory: shadcn toast timers (~1,000,000 ms) hold the process open.
- Build one `JSDOM` (pretendToBeVisual, app URL), assign `window`/`document`, then **generically copy every missing capitalized constructor** from `dom.window` onto `globalThis` (skip names already in Node so `URL`/`Response` stay native). Radix reaches for bare `DocumentFragment` etc.; hand-picked lists keep breaking.
- Also bind bare `dispatchEvent`/`addEventListener`/`removeEventListener` to the window — wouter patches `history.*` and fires bare-global events.
- Stub `ResizeObserver`, `scrollIntoView`, `hasPointerCapture`/`set`/`releasePointerCapture`; set `IS_REACT_ACT_ENVIRONMENT = true`; import React/react-dom/page **dynamically after** globals exist (static imports hoist above the setup).
- Stub `globalThis.fetch` with a route table returning real `Response` objects; log every request so "no request was sent" is provable at the network boundary. Throw `TypeError` to simulate an unreachable server.
- Provider harness: `QueryClientProvider` (reuse the app's `queryClient`, `clear()` between tests) → `PreviewRoleProvider` → `AuthProvider` (seed `localStorage["user"]`) → `PermissionsProvider`. Use `React.createElement` in a plain `.ts` file — avoids JSX config entirely.
- Prefill forms via the page's URL-prefill path (`history.replaceState` before render) instead of driving Radix Selects in jsdom.
- Toasts are invisible without a `<Toaster>`; mount a tiny probe component calling `useToast()` that renders titles into a testid div — it is the only positive proof a submit handler ran and refused.
- `act` comes from `react` itself (18.3+); poll-style `waitFor` sleeping inside `act` flushes everything with real timers.
- CSV/blob exports are assertable: patch `URL.createObjectURL` to capture the Blob (return "blob:test"), no-op `revokeObjectURL` + `HTMLAnchorElement.prototype.click`, then `await blob.text()`. Sort-header buttons fire via plain `btn.click()` inside `act`. Mutation-verify such suites (temporarily revert the cell/accessor, confirm red, restore).
- Native `<select>` elements (unlike Radix) CAN be driven in jsdom: call the native value setter (`Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set.call(el, v)`) then dispatch a bubbling `change` Event inside `act` — the native setter bypasses React's value tracker so the event isn't deduped. Proven by tests/rental-origin-filter.test.ts.


## Broken-on-clean-tree suites (as of 2026-08-24)
The RentalRequests drawer suites fail and then HANG (never exit; timeout kills the run) on an UNCHANGED tree: rental-approval-sms-drawer test 2 (in-flight template race / "drawer to close" timeout) and rental-drawer-booking-states tests 2-5. Before blaming an edit to that page, diff against a clean-tree baseline run (copy the edited file to /tmp, git restore, run, copy back — safer than stash when another git process may hold index.lock; a failed stash push followed by stash pop will pop someone ELSE'S parked stash).
**How to apply:** capture real exit codes with `> /tmp/out 2>&1; echo $?` — piping a test run into tail/grep makes the pipeline exit 0/grep's code and silently masks both failures and timeout kills.