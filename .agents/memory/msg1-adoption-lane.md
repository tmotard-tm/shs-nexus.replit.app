---
name: Cutover msg1 adoption lane
description: Rules for retrofitting a guaranteed confirmation send onto bookings made outside the intents workflow, and the evidence semantics the tracking page must use.
---

# Adoption-lane rules (retrofitting sends onto external bookings)

When a booking + live route block is created outside the workflow that owns
the sends, retrofit the send by ADOPTING an intent — never by replaying the
creation flow (external bookings usually have no source row).

- **Born non-claimable**: adopted intents start with reservation/block already
  verified — the booking exists; a runner must never claim or re-book it.
- **First-message-only**: later message states are marked skipped, and the
  intent completes as soon as the message is sent/queued/released, or it holds
  the per-tech live-workflow lock forever and blocks future real workflows.
- **Deterministic uuid-shaped source id** derived from the row's identity:
  the intents unique index then dedupes concurrent doors via ON CONFLICT DO
  NOTHING (and the id must still parse as a uuid wherever it is cast).
- **Epoch cutoff on booking/filing timestamps**: any backlog that was texted
  manually must be structurally invisible to the lane or it double-texts.
  Comms-row evidence (message-body phrase OR the row's confirmation number,
  keyed by tech) is the second fence — and the page's evidence predicate must
  stay byte-agreeing with the lane's dedupe predicate.
- Rows missing the confirmation number are skipped LOUDLY (counted + flagged),
  never texted — the message would be instructions nobody can use.

**Why:** a booking wave made outside the workflow once got route blocks with
no confirmation text, and nothing surfaced it until a manual audit.

# Evidence semantics on the tracking surface

- "Told" = a LIVE-mode send guard (sent/queued) OR an outbound comms row.
  NEVER the intent's mutable message-state field — a migrated or manually
  touched intent can claim 'sent' with no send behind it. Deliberate
  exceptions: the explicit staff "already notified" assertion state, and the
  blocked state (loud failure). Dry-run simulated guards are never proof.
- Compute the gap predicate once server-side so KPI, facets, and row flags
  cannot disagree.

# Doors that trigger sends need their own route gate

A machine-writeback endpoint that gains the power to trigger an outbound SMS
must re-enforce cron-bearer-or-session at the ROUTE level like its
SMS-capable siblings, not rely on the mount-level allowlist alone.

# Tracking-row writes are the safety substrate

The row every safety net re-queries (ensure lane, page flag, sweep backstop)
must never fail silently after a LIVE external write: retry it, and on final
failure return per-row failures in the response — a swallowed write recreates
the exact silent "blocked but never told" state.
