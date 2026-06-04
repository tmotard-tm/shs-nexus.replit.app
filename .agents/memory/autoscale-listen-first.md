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

# Sequel trap: port-first promotes, but schema-init inside registerRoutes hangs → zombie app

Once the port-first fix lets the deploy **promote**, a second failure mode appears: the app boots, opens port 5000, passes the probe, but then **EVERY** route (`/` and `/api/*`) returns 404 "Cannot GET /". The port is open but no routes are mounted — a zombie.

**Root cause:** `registerRoutes()` still runs its schema inits inline, and `initFleetScopeSchema()` executes one giant multi-statement DDL (`INIT_SQL`) via `fsPool.connect()` → `client.query(INIT_SQL)` on the **Neon serverless WebSocket pool, which has NO statement timeout**. In prod the WS drops mid-query (the "[NeonDB] Absorbed non-fatal WebSocket connection error: Cannot set property message of #<ErrorEvent>" line) and the query promise **never settles** — so `await initFleetScopeSchema()` hangs forever, and all downstream route mounting + `serveStatic` (the catch-all `app.use("*")` registered LAST in `server/vite.ts`) never run. A plain `try/catch` does NOT save you here: a hang is not a rejection, so the catch never fires.

**The rule:** bound every awaited startup-only DB init with a client-side timeout AND mount the routes regardless of init outcome. A module-level `withTimeout(promise, ms, label)` helper in `routes.ts` wraps `initFleetScopeSchema()` / `initVrmSchema()` (20s each) and the inline `db.execute(CREATE TABLE IF NOT EXISTS ...)` startup DDL, each in `try/catch` that logs and proceeds. `withTimeout` does NOT cancel the underlying query (it just stops blocking) — fine, since the DDL is idempotent and the connection frees when it eventually settles.

**Why safe to mount-regardless:** the `fs_`/`vrm_`/`byov_` tables are all `CREATE TABLE IF NOT EXISTS` and already exist in prod, so skipping a re-init costs nothing. Worst case if a table were truly missing is a localized 5xx on those endpoints — vastly better than total app zombification that fails the whole publish.

**Distinguish the two layers of `db.execute` DDL in `routes.ts`:** only the calls at the **top level of `registerRoutes`** (the fleet-scope/vrm inits + the `byov_*` table inits right after the VRM block) block startup and need bounding. The many other `await db.execute(...)` calls scattered deeper in the file live INSIDE per-request `app.get/post(...)` handler callbacks — they run per-request, not at boot, so they don't need the timeout wrapper.

**Note:** a Postgres server-side `statement_timeout` would NOT fix this — when the WS is dead the server never responds, so only a client-side timeout (the `withTimeout` wrapper / a race against a timer) breaks the hang.
