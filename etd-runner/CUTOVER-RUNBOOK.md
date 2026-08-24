# Cutover workflow runbook (ops)

How the CUTOVER booking pipeline actually runs in production. Everything is
**pull-based** — nothing books, texts, or files unless something below is
running AND the kill switch is armed.

Normal operation is section 0: staff click in the VRM panel and the server
books. Sections 1–2 are the fallback and the daily sweep.

## 0. The in-server booking engine (normal path)

The panel's own engine. Creating an intent or confirming a preview runs a
booking pass **inside the server process** — same claim/lease/fencing rules,
same attempt ledger, same postbacks as the Python runner, just called
directly instead of over HTTP. Runner id in the ledger: `nexus-inline`.

What a staffer does — and it is the whole procedure:

1. **Create the intent** in the VRM panel. A preview pass runs immediately;
   the quoted branch, class and pickup date appear on the card.
2. **Review the preview.** Anything the gate refuses is listed on the card
   (stale schedule, unmapped class, unpinned branch, roster/approval gaps).
3. **Confirm.** A booking pass runs immediately. Dark intents stop at
   `dry_run_validated`; live intents commit and the confirmation number
   comes back on the card.

If a pass is interrupted (tab closed, deploy, timeout), press **Run booking
engine** on the card. It is safe to press repeatedly: the pre-commit
duplicate search plus the shared attempt ledger mean a second pass adopts the
first one's reservation instead of making another. The morning sweep also
runs an engine pass before it sweeps, so stalled intents self-heal daily.

Live bookings additionally require `VRM_CONTRACT_BLOCK_ENABLED=true` on the
server (prod only — dev is deliberately unarmed). While it is unset the
server will not even hand a live intent to the engine.

Ad-hoc trigger (cron bearer or any authenticated staff session):

```bash
curl -X POST "$APP_URL/api/vrm/forms/rental-survey/cutover/intents/executor/run" \
     -H "x-internal-cron: $NEXUS_CRON_SECRET" \
     -H 'content-type: application/json' \
     -d '{"limit": 5}'          # optional: {"intentId": 123} for one intent
```

The engine needs no browser: it talks to ETD's HTTP API with the shared token
from `vrm_etd_token`, so it runs fine on autoscale. If the token row is empty
or stale, minting still needs a browser host — see section 1's note and
`etd-runner/scripts/etd_token.py`.

## 1. The booking runner (ETD browser automation) — fallback

Claims `preview` / `book` / `cancel` work from the server queue, drives ETD
headlessly, and posts evidence back (`op_open` → `booked`/`op_result` →
`readback`). The server owns ALL state; the runner is stateless and safe to
kill/restart at any time (fencing tokens + leases + pre-commit duplicate
search make retries safe).

Still supported and still correct — reach for it when the in-server engine is
unavailable (app down, deploy in progress) or when you want to drain a large
queue from a workstation. The two share one queue and one attempt ledger, so
they can run at the same time without double-booking; `FOR UPDATE SKIP
LOCKED` hands each intent to exactly one of them.

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
reconciliation, completion — plus the **Msg1 confirmation sweep**: a dry-run
pass of `runMsg1ConfirmationBackfill` that counts booked + block-filed techs
still on the Holman book with no confirmation-shaped text. When a gap exists
it runs the backfill LIVE if `VRM_CONTRACT_BLOCK_ENABLED` is armed (sends ride
the Fleet Comms lane: quiet hours, opt-outs, 24h dedupe), otherwise it emails
the addresses in `VRM_MSG1_ALERT_EMAILS` (comma-separated; unset = loud log
alert). Alerts are throttled to one per ~20h via the
`msg1_sweep_last_alert_at` app setting; the live pass is never throttled — it
is idempotent by evidence. One pass and exit:

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
