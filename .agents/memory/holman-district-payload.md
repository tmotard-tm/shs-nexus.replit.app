---
name: Holman district/prefix payload traps
description: Why district (prefix-only) Holman submits get rejected, and why a stored holman_submissions.payload is NOT what was actually sent.
---

# Holman district / prefix-only update payload

Holman `/vehicles/submit` returns **HTTP 202 even on rejection** — you must inspect
`errors[]` / `errorCount`, never trust the 2xx status alone. `validatedRecordCount: 0`
+ `errorCount: 1` = the record was rejected and nothing changed.

## assignedStatusCode is string(1)
A district change is **prefix-only**. The payload must OMIT `assignedStatusCode`.
Holman's `assignedStatusCode` is a 1-char code (e.g. `A`, `U`). Sending a descriptive
value like `"Unassigned"` (10 chars) rejects the WHOLE record:
`InboundVehicle: The `+"`assignedStatusCode`"+` field cannot be longer than 1 characters.`
Holman treats omitted fields as no-change (partial upsert), so leaving it out preserves
the vehicle's assignment status untouched.

**Why:** a pre-fix district path spread an `assignedStatusCode: "Unassigned"` into the
submit payload and every district change silently failed (202 + errorCount 1). The fix
is to build a minimal district payload: `lesseeCode, holmanVehicleNumber, division,
prefix (last-4 of padded district), clientData3` — and nothing else.

## Stored payload ≠ sent payload (replay trap)
`holman_submissions.payload` is stored as `{ ...holmanPayload, targetPrefix, targetDistrict }`.
`targetPrefix` / `targetDistrict` are **tracking-only fields for async verification**
(read back in holman-submission-service via `payload.targetPrefix ?? payload.prefix`) —
they are NOT part of what gets POSTed to Holman.

**How to apply:** when replaying a stored payload against Holman, STRIP
`targetPrefix`/`targetDistrict` first. If you leave them in, Holman rejects with a
*different, misleading* error: `HTTP 400 REQUEST_OBJECT_VALIDATION_FAILURE — The JSON
property `+"`targetPrefix`"+` is invalid for the request object `+"`InboundVehicle`"+`.`
The real (production) error only appears once those tracking fields are removed.

## Replay mechanics
A faithful, zero-mutation replay = self-contained script: client_credentials POST to
`https://api.holman.solutions/sso/sts/connect/token`, then POST the (stripped) payload
array to `${HOLMAN_API_ENDPOINT}/vehicles/submit` with Bearer token. A payload that
fails Holman field validation is deterministically rejected → safe to replay against
prod (no data change). Dev env's `HOLMAN_API_ENDPOINT` points at PROD Holman.
