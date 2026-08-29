# etd-runner

ETD token and cutover tooling.

## Rental-request booking retirement

Rental requests are booked **only** by Nexus Approve's canonical in-server ETD
executor. The former desktop runner (`scripts/book_request.py`) and its legacy
booking routes are retired and must not be used. The script path remains only
as a compatibility shim: every invocation exits with a clear retirement
message and creates no reservation.

Token tooling and cutover tooling in this repository remain supported.

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
    ETD_RUNNER             optional label, lands in vrm_etd_token.minted_by

## Token lifecycle

This deployment is `deploymentTarget = "autoscale"` and scales to zero between
requests. The token lives in `vrm_etd_token` rather than in a process, so a
wake-up can reuse a live token instead of paying ~21 s of Azure B2C. Minting is
single-flighted with `pg_advisory_lock`, so two runners waking together never
both drive a login.

## Do not

**Never restore `book_approved.py` or booking logic to `book_request.py`.**
Those legacy routes are retired; Nexus Approve's in-server executor is the
sole rental-request booking authority.
