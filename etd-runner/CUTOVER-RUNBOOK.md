# Cutover workflow runbook (ops)

How the CUTOVER booking pipeline actually runs in production. Two moving
parts, both **pull-based** — nothing books, texts, or files unless one of
these is running AND the kill switch is armed.

## 1. The booking runner (ETD browser automation)

Claims `preview` / `book` / `cancel` work from the server queue, drives ETD
headlessly, and posts evidence back (`op_open` → `booked`/`op_result` →
`readback`). The server owns ALL state; the runner is stateless and safe to
kill/restart at any time (fencing tokens + leases + pre-commit duplicate
search make retries safe).

```bash
# Dark validation pass (default — never commits in ETD):
python3 etd-runner/scripts/book_cutover.py --intents --watch

# LIVE booking (requires VRM_CONTRACT_BLOCK_ENABLED=true on the server too):
python3 etd-runner/scripts/book_cutover.py --intents --watch --confirm

# Useful flags: --poll N (seconds between polls), --queue-limit N,
#               --workflow-type cutover_survey|rental_request
```

Notes:
- `--confirm` alone is NOT enough to go live: the server refuses to claim or
  confirm live intents while `VRM_CONTRACT_BLOCK_ENABLED` is unset. Both
  sides must be armed.
- The runner needs a browser-capable host. In this workspace the stock nix
  chromium works; autoscale prod does NOT ship it by default (see
  `holman-headless-chromium-prod` memory) — run the runner from the
  workspace or a dedicated box, not from the deployed app.
- Cancel-lane claims are readback-only: the runner searches ETD for the
  intent reference and posts what it found. It never books on a cancel.

## 2. The morning sweep (server-side, no browser)

Block readback verification, msg2 release on the event day, crash
reconciliation, completion. One pass and exit:

```bash
npx tsx server/run-cutover-morning-sweep.ts
```

**Schedule it as a platform Scheduled Deployment (~07:00 America/New_York
daily).** In-process timers are unreliable on autoscale (see
`prod-sync-schedule-reality`); a scheduled deployment running the command
above is the supported path. There is also an HTTP trigger for ad-hoc runs:

```bash
curl -X POST "$APP_URL/api/vrm/forms/rental-survey/cutover/morning-sweep" \
     -H "x-internal-cron: $NEXUS_CRON_SECRET"
```

## Required Secrets

| Secret | Used by | Notes |
| --- | --- | --- |
| `ETD_USER` / `ETD_PASS` | booking runner | ETD portal login |
| `NEXUS_CRON_SECRET` | runner + sweep HTTP | bearer for all runner/cron routes |
| `DATABASE_URL` | server + sweep | already present |
| `VRM_CONTRACT_BLOCK_ENABLED` | server | **ABSENT = disarmed (dark).** ARMED `true` in the production deployment env (Tyler approved go-live 2026-08-16); unset to stand down. Armed also means: LIVE is the DEFAULT mode for staff intent creates (no explicit mode needed) and the dark-phase admin-only live RBAC stands down — the flag, not the role, is the authority. Dev stays unset (dry_run default; a db test enforces it). |

## Quiet-hours exception states (msg2)

FL/CT/MD/OK/WA/TX mornings have no compliant 07:00 send window. The sweep
REFUSES to release msg2 there until an operator persists a policy:

```bash
# read current policy
GET  /api/vrm/forms/rental-survey/cutover/settings/quiet-state-fallback
# set policy (admin session required): send_at_window_open | skip_msg2
POST /api/vrm/forms/rental-survey/cutover/settings/quiet-state-fallback {"mode":"send_at_window_open"}
```

## What is deliberately NOT set up

- No workflow/console entry starts the runner or the sweep automatically —
  the workspace workflow list is at its cap and, more importantly, starting
  either is an OPERATOR decision while the build is dark.
- Nothing here arms live mode. `HOLMAN_DECISION_DRY_RUN`-style inversion does
  not exist in this lane: absent flag = off.

## Incident quick refs

- Booked in ETD but intent stuck? Re-run the runner: recovery/cancel claims
  are readback-first; the pre-commit duplicate search stops double-booking.
- msg2 never went out: check `vrm_workflow_send_guards` status +
  `fs_comms_send_queue` row state (held→pending flip happens on the event
  morning only, after block verification).
- Cancel requested on a live intent: it parks at `cancel_pending_readback`;
  either let the runner's readback prove ETD holds nothing, or cancel in ETD
  manually and record evidence via the panel button (or
  `POST .../intents/:id/cancellation-evidence`).
