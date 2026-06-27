---
name: AMS user-updates write contract (per-field types)
description: AMS POST /vehicles/:vin/user-updates uses MIXED per-field types (name vs int vs bool); the Edit AMS Fields dialog must convert + diff per field.
---

The AMS write endpoint `POST /api/v1/vehicles/:vin/user-updates` (FastAPI/Pydantic)
takes **different types per field** — confirmed from its OpenAPI spec
(`GET {AMS_API_BASE_URL}/openapi.json` → `components.schemas.UserFieldsUpdateRequest`,
a read-only call; the AMS base/key are in env):

- **NAME (string label)**: `color` (Blue/White/Unknown), `branding`
  (Sears/AE Factory Service/Unmarked), `interior` (Lawn & Garden/…).
- **Integer lookup ID**: `truckStatus`, `vehicleRuns`, `vehicleLooks`.
- **Boolean**: `theftVerified` (NOT "Y"/"N").
- Free-form: `address`/`keyAddress` (string, maxLen 50), `zip`/`keyZip` (string),
  `storageCost` (number ≥ 0), `updateUser` (string, **maxLen 10** — slice it).

Mismatch traps that bit us, in order:
1. The lookups GET (`/api/v1/lookups/<type>`) returns rows `{UniqueID,<LabelField>}`
   and the vehicle GET returns these fields as the numeric `UniqueID`. A `<Select>`
   binds to `UniqueID`, so sending the id for `color` → `Invalid color '...'`.
2. Over-correcting by sending the *label* for `truckStatus` →
   `int_parsing, unable to parse string as an integer, input: "Tech On LOA"`.
   So color and truckStatus need OPPOSITE conversions. Don't assume uniformity —
   the OpenAPI schema is the authority; fetch it rather than guessing.

**Why:** the Edit AMS Fields dialog (`client/src/pages/fleet-management.tsx`)
stored every lookup field as its `UniqueID` and re-sent *all* pre-filled fields on
save, so a truck-status-only edit replayed a stale color id and 500'd before the
real change was validated.

**How to apply:** when writing AMS user-updates from the UI: snapshot field values
on dialog open, send only changed fields, convert `color/branding/interior`
id→label, send `truckStatus/vehicleRuns/vehicleLooks` as `Number(id)`, send
`theftVerified` as a real boolean, and cap `updateUser` at 10 chars. The clear/null
contract is untested — omit a field rather than sending a sentinel to clear it.
The assign flow uses different endpoints (`tech-update`, `repair-updates`) and
gives no evidence about this contract. Cannot empirically test writes (single
shared prod AMS, no sandbox) — reason from the OpenAPI schema + error messages.
