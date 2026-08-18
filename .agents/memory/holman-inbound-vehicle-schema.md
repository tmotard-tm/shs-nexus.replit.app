---
name: Holman InboundVehicle write schema
description: Operating rules for /vehicles/submit lifecycle writes — the only field that moves a vehicle out of service, why success looks like failure, and how to verify.
---

# Holman lifecycle writes (`/vehicles/submit`)

The complete out-of-service payload:

```
{ lesseeCode, holmanVehicleNumber, assetAction: "UPDATE", outOfServiceDate: "MM/DD/YYYY" }
```

**`outOfServiceDate` is the ONLY lever that moves a vehicle out of service.** The
write schema has no status property at all — `statusCode`, `status`,
`vehicleStatusCode`, `assetStatus`, `statusDate` all come back as unknown
properties. Holman derives lifecycle status from date fields, never the reverse.
(`statusCode` IS valid on *read* paths as a filter, e.g. `?statusCodes=2` — do not
confuse the filter param with a write field.) Disposal has its own trio:
`soldDate`/`soldAmount`/`saleOdometer`.

**Why the payload discipline matters:**

- `assetAction` must be `'ADD'` or `'UPDATE'`, and omitting it is **accepted by
  validation** — 202, `errorCount: 0`, record echoed in `validatedRecords` — but
  the queued record has no action to perform and is **silently never applied**.
  Always send `UPDATE`; never `ADD` on an existing vehicle.
- `assignedStatusCode` must be OMITTED (string(1) trap — see
  holman-district-payload.md). A lifecycle change must not disturb assignment.
- `outOfServiceDate` must be `MM/dd/yyyy`.

## Success looks like failure: latency plus a broken success test

*Latency:* a lifecycle submit is not picked up by the next nightly window.
Observed end to end: submitted 12:15Z, applied ~05:2x **two calendar days later**
(~41h, skipping intervening windows). Size the submission-expiry clock for that,
not for the ~20-minute assign/unassign case, or the sweep abandons valid
in-flight writes. Do not declare a lifecycle write dead before two full days.

*The trap that actually hides success:* once Holman applies the change, the
vehicle leaves the active-status projection and **`statusCode` comes back NULL**.
A verification written as `statusCode === 2` therefore reports "still in service"
for a truck that is genuinely out of service, the polling sweep never settles,
and the system insists a successful write failed.

**Verify on `outOfServiceDate` (populated, not in the future), never on
`statusCode` alone.** Keep `statusCode === 2` only as an additional accept. Same
rule for the cached mirror. There is no submission-tracking endpoint — every
`/vehicles/submissions/{token}` variant 404s — so verification means re-reading
the vehicle. `lastChangeDate` is the honest "did Holman touch this record" probe,
but it moves only when the batch runs: an unchanged stamp means "not yet", not
"rejected".

## Discovering the schema without guessing

Send a candidate field with a deliberately malformed *value*. An unknown field
returns `"is invalid for the request object"`; a real field returns a
value-validation message that usually names the exact accepted format or enum.
The 400/202 error body also echoes `originalRecord` with every accepted property
name — enumerating the whole schema with zero writes. Prefer this over any
remembered field list.

**Close every probing session with a full-fleet scan** by VIN **and** number
**and** driver name. The submit response cannot tell you whether a record was
created, so phantom vehicles are otherwise discovered much later by the wrong
people. (A probe round using `ADD` with fake VINs in an unused number range
created nothing — an incomplete creation payload no-ops the same way an
actionless update does — but that was only knowable *because* of the scan.)

## Operator-facing surfaces over this capability

The one-shot list script and the Fleet Management "Mark Out of Service" button
share one policy core — live lookup, VIN check, driver check, payload build.
Rules that are easy to get wrong when adding another surface:

- **A dry run must answer HTTP 200 even when its verdict is "would be refused".**
  Mapping a preview's refusal onto 409 pushes the verdict into the client's error
  path, where the specific per-truck reason becomes a generic failure toast. Only
  a REAL attempt maps a refusal onto a conflict status.
- **The BYOV prefix gate must decide on the CANONICAL number on both sides.** The
  UI canonicalized and the API checked the raw string, so the padded spelling
  ("088269", how the cache and TPMS store it) rendered a live button the API then
  400'd. Two gates over one concept always drift — share the predicate.
- **An out-of-service action never unassigns.** A truck still showing a driver is
  refused so a human resolves it; keep the button visible-but-disabled with the
  reason, since an absent button is indistinguishable from a broken one.
- **A session proves login, not authority.** These fleet routes only require
  auth, so a lifecycle write must re-check the caller against the admin-grade
  directory itself.
