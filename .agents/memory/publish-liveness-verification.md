---
name: Publish liveness verification
description: How to verify a Replit publish actually took effect in prod — deploys/history.json is written at publish initiation, not promotion.
---

# Publish liveness ≠ publish recorded

**Rule:** An entry in `deploys/history.json` does NOT prove that revision is serving in production. The guardrails artifact script stamps `deployedAt: new Date()` when the publish is *initiated*; a failed build, failed promote, or crash-back leaves the entry in place while prod keeps serving the previous build.

**Why:** During the Aug 2026 rental-process pre-mortem, history.json showed HEAD deployed at 04:59, yet prod was still the previous day's build 40+ minutes later. Trusting the history entry would have inverted the top finding (architect caught it).

**How to verify liveness (fast, no credentials needed):**
1. **Live route probe:** `curl` a route that only exists in the new revision. JSON response (even 404 `{...}`) = route registered; **HTTP 200 with `text/html` (SPA fallback) = route absent from the running process** → old build or module crashed during registration.
2. **Prod schema probe:** for modules that create tables via runtime boot DDL (e.g. VRM forms `vrm_form_tokens`/`vrm_rental_request`), query prod `information_schema.tables`. Table absent = that code never booted in prod. Note: `migrationsApplied` in history.json only lists drizzle migrations (0000–0008); runtime-DDL tables never appear there.
3. Distinguish "old build serving" (other routes fine, boot markers absent from deployment logs) from "new build promoted but a route group crashed" (see startup-route-registration memory — an awaited init failure between route groups 404s everything after it).

**How to apply:** Any time "is X live in prod?" matters — before reporting deployment state, before debugging "works in dev, missing in prod", after any publish.

## The inverse trap: a stale history file ≠ no publish
`deploys/history.json` can simply STOP being written (last entry Aug 21 while two real publishes landed Aug 23) — absence of an entry proves nothing in either direction. The reliable publish timeline is `git log --oneline` looking for Replit's "Published your App" commits; everything at or before that commit is in that build. Confirm promotion with the live probes above (a boot-DDL schema marker unique to the new code is the cheapest — wake the autoscale app first, boot DDL is post-listen).

## "suspended" builds can read as a totally clean deploy in their own logs
`getDeploymentBuild()` can return top-level `status: "suspended"` even when that same build's log tail shows a fully clean build+push+promote, ending in two `"Deployment successful"` lines. Don't take a clean-looking log tail as proof the app is live — always check the build's `status`/`suspendedReason` fields themselves. `suspendedReason: "ubb"` = a usage-based-billing hold (Replit docs: resolve an outstanding balance in Settings → Billing), not a code/build/promote defect, and it recurs on every republish until the account issue is resolved — there is no code fix.

**Why:** Aug 25, 2026 outage — app went down twice in one day; `listDeploymentBuilds()` showed the two latest builds both `status: "suspended"` / `suspendedReason: "ubb"` while their logs looked like routine successful deploys. `getDeploymentInfo().hasSuccessfulBuild` correctly stayed `false` the whole time — trust that field over the log tail.

**How to apply:** Whenever `hasSuccessfulBuild` is false or prod 404s "isn't live yet," pull `listDeploymentBuilds()` + `getDeploymentBuild()` and read `status`/`suspendedReason` before assuming a code regression. A billing suspension needs the user to act in account Settings → Billing, not another code fix or blind republish.

