---
name: ETD dual-runner parity and its test ceiling
description: Two booking runners (in-server TS engine + Python fallback) share one queue, ledger and token — what must stay byte-identical, and why synthetic fixtures can never reach an authorized booking.
---

# Two runners, one queue

Bookings can be driven either by the in-server engine (staff click → pass runs inside the
app process) or by the Python runner (polls the same HTTP queue). Both may run at once.
Nothing prevents double-booking except things that must match EXACTLY on both sides:

- the booking **request hash** (Python builds it from `json.dumps(sort_keys=True)`, so the
  TS side must reproduce that key order and separators, not merely "a hash of the same fields"),
- the **advisory lock key** used to serialize token minting,
- the **evidence vocabulary** written to the shared attempt ledger — including small spellings
  like Python's `None` in a note, because whichever runner served the intent, the human reads
  one string.

**Why:** the dedupe story is "the second runner recognises the first one's attempt row". A
drifted hash or lock key breaks that silently — both sides work perfectly in isolation and
only collide in production, on a real reservation in a technician's name.

**How to apply:** any change to those values needs a parity test that reads the Python source
or runs it, never a restatement of what the Python is believed to do. Fixture-generating a
Python run and deep-comparing is the pattern that has caught real drift.

# The synthetic-fixture ceiling

The orchestrator (not the runner) re-verifies the technician's schedule against Snowflake
immediately before authorizing the external call, and again inside the preview postback.
A synthetic LDAP has no schedule rows, so:

- a persisted preview always carries `not_working_day` and can never reach `preview_ready`,
- a booking can never be authorized, so `dry_run_validated` / `failed_clean` / committed
  paths are unreachable in tests.

**Why:** that re-check is the authority and is deliberately not injectable — making it
injectable to satisfy a test would weaken the exact guard it exists to be.

**How to apply:** assert the runner-owned outcomes (branch pinned, class mapped, ZIP present,
date chosen, "never commits without authorization") and let the environment's own refusal
stand. Do not seed Snowflake and do not fake the authorization. Also note the persisted
`preview` column stays NULL while the gate fails — assertions that read it pass vacuously.
