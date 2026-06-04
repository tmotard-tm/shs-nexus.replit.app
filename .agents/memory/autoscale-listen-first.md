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

**The rule:** in `server/index.ts`, register routes + static, then call `server.listen()` as early as possible. Do **not** `await` heavy DB/Snowflake/seed work before `listen()`. Defer all of it (permission patch, template seeding, Snowflake init, schedulers) into a background `runStartupBootstrap()` fired from the `listen()` callback.

**Why:** the failing deploy awaited `patchStoredRolePermissions()` → `seedTemplatesOnStartup()` (which upserts *every* embedded template) → `initializeSnowflake()` before `listen()`. In prod a transient Neon serverless WebSocket hiccup (the "Absorbed non-fatal WebSocket connection error" lines) stalled those awaited DB writes past the probe window, so the port never opened. The same code passed locally and on earlier deploys because the DB happened to respond fast enough — it's timing-dependent, so "it worked before" is not a guarantee.

**How to apply / safe because:** route handlers read their data from storage per-request, and the deferred steps are all idempotent and individually try/catch-wrapped, so a brief window where templates fall back to embedded data or Snowflake-backed routes return a transient error is acceptable vs. failing the entire publish. Always fire the background bootstrap with a trailing `.catch()` so the fire-and-forget promise can't become an unhandled rejection.

**How to diagnose this class of failure:** `getDeploymentBuild({buildId})` shows the build phase succeeding up to "Creating Autoscale service"; the real cause is in runtime logs via `fetchDeploymentLogs()` around the build's `timeUpdated`, where you'll see the app booting but never logging "serving on port 5000" before the port-never-opened line.
