# etd-runner

The ETD reservation booker, running on the Nexus box instead of Tyler's desktop.

Nexus already owns the request, the decision and the queue
(`server/vrm/forms/rental-request.ts`, endpoints `booking-queue` and
`:requestNo/booked`). This owns only the ETD call.

## Setup, once per container rebuild

    cd /home/runner/workspace/etd-runner
    python3 -m venv .venv
    PIP_USER=0 .venv/bin/pip install -r requirements.txt

`PIP_USER=0` is required: Replit sets `PIP_USER=1` globally and that is invalid
inside a virtualenv. Do not use `pip install --user` either; nix Python refuses
it under PEP 668.

There is no `playwright install`. Chromium is already in the nix store; point
`ETD_CHROMIUM_PATH` at it.

## Run

    .venv/bin/python scripts/etd_token.py preflight   # no network, checks readiness
    .venv/bin/python scripts/etd_token.py ensure      # mint if needed, store in vrm_etd_token
    .venv/bin/python scripts/etd_token.py status      # time left, never prints the secret
    .venv/bin/python scripts/etd_token.py verify      # a real authenticated ETD call

    .venv/bin/python scripts/book_request.py           # DRY RUN, books nothing
    .venv/bin/python scripts/book_request.py --confirm # creates REAL reservations

Start with `preflight`. It makes no network calls and mints nothing, so it is
safe to run before any credential exists.

## Environment (Replit Secrets)

    ETD_USER, ETD_PASS     ETD portal login
    ETD_TOKEN_DSN          read-WRITE Nexus Postgres. NOT DATABASE_URL, which on
                           this box is a local helium throwaway with none of our
                           data. A read-only credential cannot write the token row.
                           Optional on the Nexus box: falls back to
                           PROD_DATABASE_URL, which is already a Secret there.
    ETD_CHROMIUM_PATH      the nix-store chromium. It is a nix hash and changes
                           when Replit updates the package; re-resolve with
                           `which chromium` if minting starts failing.
    NEXUS_CRON_SECRET      to call the booking-queue endpoints
    ETD_RUNNER             optional label, lands in vrm_etd_token.minted_by

## Why there is no forever loop

This deployment is `deploymentTarget = "autoscale"` and scales to zero between
requests, so a `--watch` loop cannot survive here. That is why the token lives in
`vrm_etd_token` rather than in a process: any wake-up reuses a live token instead
of paying ~21 s of Azure B2C. Minting is single-flighted with `pg_advisory_lock`,
so two runners waking together never both drive a login.

## Do not

**Never add `book_approved.py`.** It is deliberately absent. It predates the
2026-08-13 cutover and books in the wrong driver's name, at the wrong branch, in
a Mirage, with no confirmation number stored.

`reference/savedr_request.json` is the captured reservation model every booking
deep-copies. It cannot be regenerated except by re-running `canary_capture.py`
against a real live booking. It still contains the original capture's driver
identity in eleven places; `set_driver()` overwrites all of them on every
booking.
