---
name: Holman GetDashboardTabs 401 is intermittent portal-side
description: How to triage the prod "Could not determine TabId" / harvest 401 without prod console logs.
---

# Holman harvest 401 — intermittent portal-side, not creds/binary

On 2026-08-19 the prod PO-cron login 401'd at the GetDashboardTabs harvest
(cookies present, idToken MISSING) at ~02:50 and again at 03:51 UTC, yet a walk
at 03:20 succeeded and the 04:12 walk succeeded cleanly (tabId + 9 rows).

**Ruled out by direct test:** the same HOLMAN_PORTAL_USER/PASS AND the exact
prod binary (stock nix chromium-125, pinned via HOLMAN_CHROMIUM_PATH override)
complete login + tabId + idToken from the workspace. So a prod harvest 401 with
valid-looking cookies = Holman portal-side transient (session not authorized
server-side right after login), NOT expired creds, NOT a flow change, NOT the
ungoogled-chromium class of bug.

**How to triage without prod console logs** (fetchDeploymentLogs can return
empty for ALL windows even while the app serves traffic — don't treat that as
"app dead"):
- `holman_po_sync_meta` (prod, id=1) records last walk start/end, last_ok,
  rows, error — the failure/success oracle.
- `holman_rental_po_queue` max(last_synced_at) / hourly buckets show when walks
  actually touched rows (under-reports no-change walks).
- Force a live test: POST /api/vrm/holman-po-queue/cron-refresh with
  x-internal-cron: NEXUS_CRON_SECRET (gate skips if a walk — even a FAILED one —
  completed <20 min ago; wait it out).
- Reproduce the login locally: `npx tsx server/holman-login-worker.ts`
  (optionally HOLMAN_CHROMIUM_PATH=<prod stock chromium>) — discriminates
  creds/flow/binary from prod-environment causes in one run.

**Note:** the freshness gate counts failed walks, so a transient failure costs a
full 20-min window before retry; TabId is account-stable (1759787), so
HOLMAN_KPI_TABID could serve as a fallback pin if 401s ever persist.
