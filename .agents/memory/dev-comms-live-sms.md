---
name: Dev comms send LIVE SMS
description: COMMS_SEND_LIVE is on in dev — decision routes text real technicians during testing
---

# Dev environment sends REAL SMS

**The rule:** `COMMS_SEND_LIVE` is set live in the dev workspace, and the
rental-request send path posts to the local send-batch API with `confirm:true`.
Any dev test that drives a DECISION route (approve/deny on a rental request,
or anything calling `notifyTech`) texts the real technician's real mobile.

**Why:** approving a test rental request in dev has already sent a live
"approved" SMS to a real technician's phone. Submits are safe (the pending
path doesn't text the tech; Fleet alert phones are unset in dev) — decisions
are not.

**How to apply:** before exercising decide/notify paths in dev, either check
the outbound `fs_comms_messages` behavior first, use a fixture whose contact
phone is not a real tech, or verify the SQL/state effects directly instead of
calling the route. A row appearing in `fs_comms_messages` means it WAS accepted
live — refusals persist nothing.

## Prod queue drain trap (2026-08-24)
Any notification row enqueued into the PROD DB (e.g. by a workspace repair script) is drained by the LIVE prod dispatcher within ~30s under PROD's deployed code semantics — new gating columns (like a not_before hold) that only exist in the unpublished build are ignored, so a "held" row sends immediately. Before enqueueing into prod: check what code prod actually runs, and check the real wall clock (`date -u`) before reasoning about quiet hours.
