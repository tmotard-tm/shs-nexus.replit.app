---
name: Holman create submit — what counts as acceptance
description: How to read Holman's vehicle-submit response so a create is only called successful on real evidence, and why a 2xx alone poisons the local caches.
---

# Holman create submit: "submitted" is receipt, "captured" is acceptance

Holman's vehicle submit answers with a counted message, e.g.
`"[1] record submitted. [0] records rejected due to errors. [1] record successfully captured for processing."`
plus optional `validatedRecordCount` / `errorCount` / `errors[]` / `userReferenceToken`.

Reading rules, in order:
1. `errorCount > 0`, a non-empty `errors[]`, or a **non-zero rejected count in the message** → rejected. This
   holds even on a 2xx; per-record failures are reported inside the body, not by the HTTP status.
2. When a **captured** count is present it is authoritative. `captured = 0` is NEVER a success, however many
   records were "submitted" — "submitted" only means Holman received the bytes.
3. Only with no captured count may `validatedRecordCount` / a submitted count stand in as positive evidence.
4. No counts at all (empty body, a bare string, `null`) → **unconfirmed**, not success.

Unconfirmed must be reported as pending verification and must **not** mirror a vehicle row into
`holman_vehicles_cache`. This is the whole point: the number guard, the VIN guard, and the number allocator all
read that cache, so one phantom row off an unconfirmed submit corrupts every future create's inputs.

**Why:** the original create route inferred success from "the HTTP call did not throw and returned JSON," then
optimistically wrote a complete active cache row. That is the 088277/088279 dual-registration failure class.

**How to apply:** any new Holman write path classifies the response body before claiming success, and writes a
cache row only after a live read-back confirms the record. Same principle as the assign/district flows: 202 is
a queue receipt (see holman-assignment-verification.md), never proof of application.

## /vehicles/custom-query does work — with statusCode
An older note claimed custom-query POST always 400s ("The statusCode field is required"). It works when the body
carries `lesseeCodes: ['2B56']` **and** `statusCode` (0/1/2), which makes it the cheap way to probe one vehicle
without paginating basic-query. `vin` is a valid `additionalFilter` key; `VIN` and `vinNumber` 400.
Holman number formats are inconsistent, so a number probe must pass canonical/display/ref variants together.

## Not-found and lookup-failure are different answers
`findVehicleByNumber` returns null for both, which is unusable for a fail-closed gate. Probes that feed a gate
must return an explicit "did the check complete" flag, so an outage refuses the submission instead of reading
as "no duplicate found."
