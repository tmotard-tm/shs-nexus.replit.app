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

Two concrete traps the deep-compare has caught, both invisible to a reading of either side:

- `str(True)` is `"True"`, `String(true)` is `"true"`. Any evidence string built by
  stringifying a boolean diverges between runners. Spell booleans explicitly on the Python
  side.
- The runner's HTTP dependency is not installed in the Replit workspace, so importing its
  client to test a PURE helper fails at `import requests`. Stub the module into
  `sys.modules` before the import rather than skipping the parity check.

# The savedr refusal is an HTTP 200

Enterprise refuses a reservation commit with **HTTP 200** and a body carrying
`success: false` (also seen misspelled `succecss`). The body is the reservation VIEW MODEL,
not an error envelope: reasons live in `errors` / `warnings` / `hasErrors` /
`errorMessage` / `notificationMessage` and in per-field `validationMessage` entries nested
beside a `fieldName`, plus a model-state style dict. A reader that only knows `messages`
and `errorMessage` extracts nothing and logs `rejected: ` with an empty tail.

**Why:** that empty tail cost a technician his rental — the reason was received and dropped,
and the readback then overwrote the evidence with a reassuring "reconciled clean".

**How to apply:** the raw body echoes the driver's name, phone, email and address, so it is
in-memory only — persist the masked reasons plus a redacted `path:type` shape, never the
body. When a refusal carries no message text at all, report which keys came back; a
diagnosis has to survive on the ledger alone. Any state change that follows a refusal must
keep the refusal as the operator-visible last word.

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
