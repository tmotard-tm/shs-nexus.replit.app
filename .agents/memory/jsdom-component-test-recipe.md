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
