---
name: CAS-claimed steps need crash recovery
description: Why a "pending" claim over an external side effect must be timestamped and recovered from evidence
---

# A CAS claim without a stale-claim path is a permanent stall

The usual "only one worker, only once" pattern claims a row, does the external
side effect, then records the outcome. If the process dies in between, the row
is stuck: the claim predicate rejects an already-claimed row, and retry paths
typically only clear failures.

**Why:** the claim exists so nothing else may touch the row, which makes a
crash-orphaned claim indistinguishable from a healthy in-flight one *unless it
is timestamped*. Age is the only thing separating "happening right now" from
"the owner is gone".

Three consequences worth remembering:

- **Recovery is evidence-first.** Look for proof the side effect landed and
  adopt it, including its real timestamp, since downstream clocks are usually
  derived from it. Release the claim only when there is proof nothing happened.
- **Ambiguity is a terminal state, not a retry.** When the side effect is
  uncancellable, an answer that proves nothing — no answer at all, an
  acknowledgement with no handle, a crash after the request went out — parks for
  a human to confirm. Retryability must be based on evidence, not on a
  transport-level "retryable" flag.
- **Freeze any idempotency key you compute yourself.** If the upstream duplicate
  guard matches on something we generate, recomputing it on a retry produces a
  key the guard cannot match and the protection quietly evaporates. Stamp an
  "attempted" marker immediately before the request: it freezes the key and
  distinguishes "claimed but never sent" from "sent, no answer".

**How to apply:** treat a claim older than a generous multiple of the real
operation's duration as orphaned, and an untimestamped claim as stale. Keep the
upstream duplicate guard as the second net, and cover the crash states by
fabricating them directly in the database — no integration test reproduces a
mid-flight crash.
