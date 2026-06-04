---
name: Autoscale deploy — open the port before heavy bootstrap
description: Why server startup must call listen() before any awaited DB/Snowflake/seed work, or the autoscale promote fails.
---

# Autoscale promote needs port 5000 open within ~60s

A deploy build can fully **succeed** (vite + esbuild + guardrails all pass, image pushed) and still fail at the **promote** phase with:

```
a port configuration was specified but the required port was never opened, expected port 5000
```

This is NOT a build problem. Autoscale sends a startup probe to `GET /` and requires a 200 within ~60s. If the app hasn't opened its listen port by then, the promote is rejected and the previous build keeps serving.

**The rule:** in `server/index.ts`, `createServer(app)` and then **`await` the `listen()` "listening" callback BEFORE doing any heavy bootstrap — including `await registerRoutes()`**. Pass that already-listening server into `registerRoutes(app, server)` so it reuses it (`existingServer ?? createServer(app)`) and still attaches the WS. Defer remaining seed/Snowflake/scheduler work into a background `runStartupBootstrap().catch(...)` fired after routes are wired.

**Two non-obvious traps that make a naive "listen first" fix silently NOT work:**

1. **The blocking work lives INSIDE `registerRoutes`, upstream of `listen`.** `registerRoutes()` in `server/routes.ts` runs ~27 awaited DB schema inits (`initFleetScopeSchema`, `initVrmSchema`, many `CREATE TABLE IF NOT EXISTS` via `db.execute`) before it ever reaches `createServer`/`listen`. So a fix that only defers the *post-registerRoutes* bootstrap does nothing — the port still can't open until all that DB work finishes. You must create+listen the server in `index.ts` and hand it to `registerRoutes`.

2. **Calling `server.listen(cb)` without awaiting it does NOT open the port early.** If you do `server.listen(..., () => log("serving"))` and then immediately `await registerRoutes()`, the route-registration work saturates the event loop and the real TCP bind / `listening` callback is postponed until the very end of startup (you'll see "serving on port 5000" logged LAST, not first). Wrap listen in `await new Promise<void>(resolve => server.listen({...}, () => { log(...); resolve(); }))` so the bind completes and the callback fires *before* `registerRoutes` runs. Verify by confirming the dev log prints "serving on port 5000" ABOVE "=== STARTING ROUTE REGISTRATION ===".

**Why:** the failing deploy awaited `patchStoredRolePermissions()` → `seedTemplatesOnStartup()` (which upserts *every* embedded template) → `initializeSnowflake()` before `listen()`. In prod a transient Neon serverless WebSocket hiccup (the "Absorbed non-fatal WebSocket connection error" lines) stalled those awaited DB writes past the probe window, so the port never opened. The same code passed locally and on earlier deploys because the DB happened to respond fast enough — it's timing-dependent, so "it worked before" is not a guarantee.

**How to apply / safe because:** route handlers read their data from storage per-request, and the deferred steps are all idempotent and individually try/catch-wrapped, so a brief window where templates fall back to embedded data or Snowflake-backed routes return a transient error is acceptable vs. failing the entire publish. Always fire the background bootstrap with a trailing `.catch()` so the fire-and-forget promise can't become an unhandled rejection.

**How to diagnose this class of failure:** `getDeploymentBuild({buildId})` shows the build phase succeeding up to "Creating Autoscale service"; the real cause is in runtime logs via `fetchDeploymentLogs()` around the build's `timeUpdated`, where you'll see the app booting but never logging "serving on port 5000" before the port-never-opened line.
