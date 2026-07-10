---
name: Holman headless-login chromium in prod
description: Why the Holman PO-queue "Could not determine TabId" prod bug happened and how the chromium resolver + replit.nix must be shaped to fix it.
---

# Holman headless-login chromium in prod

The VRM "Holman PO queue → Refresh" login runs in an isolated child process
(`holman-login-worker.ts`) launching a **nix** Chromium via `playwright-core`,
then does two in-page `fetch`+JSON harvests (GetDashboardTabs → TabId, plus an
awaiting-auth idToken). In prod it failed with "Could not determine TabId".

## Root cause (a wrong theory was disproven first)
- The prod **deploy closure contains ONLY the nix deps declared in `replit.nix`**
  (plus their transitive deps). Dev-store browsers (the cjk playwright build, etc.)
  do NOT ship to prod. When `replit.nix` declared only `ungoogled-chromium`,
  `resolveChromiumPath()` fell to the ungoogled fallback in prod.
- **`ungoogled-chromium` is privacy-patched**; its post-login cookie/JS behavior
  makes the in-page harvest `fetch` come back as a non-JSON login page, so
  `r.json()`/`JSON.parse` throws → tabId=null.
- **Disproven theory:** "a bad chromium rev corrupts `page.evaluate`." Launched
  cjk-1187, playwright-1091, ungoogled-125, AND stock `pkgs.chromium`-125 through
  `playwright-core` — ALL run `page.evaluate`/JSON round-trips fine. The engine is
  **playwright-core 1.41.2** (not 1.55). The failure is session/cookie divergence
  on ungoogled, not an evaluate bug.

## The fix shape
- Ship a **clean, non-privacy-patched** Chromium to prod: `replit.nix` declares
  `pkgs.chromium` (stock chromium-125), and `resolveChromiumPath()` prefers it
  over the ungoogled fallback.
- **Tooling constraints that dictated `pkgs.chromium`:** the ideal
  `pkgs.playwright-driver.browsers` (the real playwright chromium) is a **dotted
  sub-attr** that `installSystemDependencies` rejects ("not present in rippkgs
  index" — the index only knows top-level attrs), AND **direct edits to
  `replit.nix` are blocked by tooling**. So the only sanctioned path is installing
  an *indexed top-level* package; `pkgs.chromium` is one and is a clean Chromium.
  (`pkgs.playwright-driver` and `pkgs.playwright` closures do NOT contain the
  browsers dir, so they don't help.)
- **`/nix/store` entries are hash-prefixed** (e.g. `<hash>-chromium-125.…`), so a
  resolver scanning them must use **UNANCHORED** regexes. Match stock chromium with
  `/-chromium-[0-9]/` and **explicitly exclude `/ungoogled/`** (ungoogled dirs also
  contain `-chromium-<digit>`). `chromium-unwrapped-…`/`chromium-sandbox` fail the
  `-<digit>` test and also have no `/bin/chromium`, so `existsSync(.../bin/chromium)`
  is the final safety filter.

## Session-poisoning guard (paired fix)
A tabId-less login must NOT be persisted at full TTL — otherwise every Refresh
fast-fails until the cache expires. Persist a full-TTL disk session only WITH a
tabId; a tabId-less result gets a short in-memory hold only. `loadCachedSession()`
also rejects any on-disk file with a null tabId (defends against files written by
older builds).

**Why:** turns a 20-minute hard lockout into a per-few-minutes retry, and the
never-throw harvest now returns a diagnostic envelope (status/contentType/snippet)
so the next prod failure is self-diagnosing.

**How to apply:** dev is unaffected because resolver step 1 (the
`HOLMAN_CHROMIUM_PATH` pin to the cjk build) wins before the stock-chromium step.
Prod correctness can ONLY be confirmed after republish — verify the prod log shows
`chromium=/nix/store/…-chromium-125.…/bin/chromium` and `done tabId=<id>`.
