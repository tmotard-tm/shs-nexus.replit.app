---
name: Neon HTTP one-shot driver mis-reads booleans
description: Ad-hoc neon() HTTP queries can return wrong boolean values; use the app's WebSocket pool driver for DB ground truth.
---

When inspecting Postgres data with a quick one-off script, do NOT trust a one-shot
`neon()` HTTP-driver query for boolean columns. It mis-reports raw `boolean`
columns AND boolean-expression columns (e.g. `is_active IS TRUE`) — a healthy
account read this way showed `is_active = false`. This produced a confident but
FALSE "account corrupted / deactivated" diagnosis.

**Why:** The HTTP one-shot driver serializes/coerces booleans differently than the
app's pooled driver. Casting tricks confirmed the data was actually fine:
`to_json(is_active)`, `::int`, `::text`, and aggregate counts all reported the true
value; only the raw boolean came back wrong over the HTTP path.

**How to apply:** For any ground-truth DB read used to diagnose behavior, go through
the SAME driver the app uses — the drizzle `neon-serverless` WebSocket Pool exported
from `server/db.ts` (`import { db } from "../server/db"` in a `tsx` script). Use that
for both reads and credential writes. Reserve the HTTP `neon()` path for throwaway
checks where a wrong boolean won't mislead a diagnosis.

## `neonConfig.poolQueryViaFetch = true` reintroduces this bug on the POOL driver

Setting `neonConfig.poolQueryViaFetch = true` (in `server/db.ts` / `server/fleet-scope-db.ts`)
reroutes the WebSocket `Pool`'s simple queries over Neon's HTTP endpoint — which
brings the SAME boolean misread into the app's normal driver. Proven empirically:
with the flag ON, `users.is_active` read `false` for every account whose raw value
was `true`; with it OFF, it read `true`. The whole app runs on `drizzle-orm/neon-serverless`
+ `Pool`, whose contract is WebSocket transport.

**Symptom seen:** every login (credential `routes.ts` + SAML `saml-config.ts`) hit
`if (!user.isActive)` and returned "Your account has been deactivated"; session
validation (`!user || !user.isActive`) failed every authenticated request → blank
authed UI + 401s (e.g. App Launcher `/api/external-apps`). It's a fail-CLOSED bug
(false lockout), not an auth bypass.

**Rule:** do NOT set `poolQueryViaFetch = true` here. Keep `neonConfig.webSocketConstructor = ws`
only. If a future WS-drop mitigation is wanted, handle it at the app layer
(bounded-stale cache / retry), never by switching the pool to fetch transport.
**Why:** the fetch path silently corrupts booleans app-wide AND splits
transaction/session semantics from single-query transport for zero benefit.

## App pool driver: DATE columns come back as strings
The app's pool driver (server/db.ts) returns Postgres DATE columns as 'YYYY-MM-DD' strings — NOT js Date objects.
**Why:** verified empirically 2026-08-16 (`SELECT '2026-08-17'::date` → typeof string). Cutover code relies on `String(row.event_date).slice(0,10)` for event-day math; a driver/type-parser change would silently break every date comparison.
**How to apply:** date-vs-today logic may trust the string form through this driver; re-verify before swapping drivers or adding pg-types parsers.

## TIMESTAMPTZ strings from this driver are NOT Date.parse-able
Same driver, same story for timestamps — but worse, because this one fails silently.
A `timestamptz` arrives as `2026-08-17 14:15:32.402664+00`: space separator, microsecond
precision, and an HOUR-ONLY UTC offset. `new Date(...)` on that returns **Invalid Date**
in V8 (the ECMAScript grammar wants `±HH:mm`), so anything doing `new Date(row.ts)` gets
NaN and renders "Invalid Date" or an empty timestamp rather than throwing.
**Why:** the same row reached the UI two ways — through `to_jsonb()` (already ISO, parsed
fine) and straight off the driver (raw string, NaN) — and only one of them displayed a
time. Nothing errored; the field was just blank on one surface.
**How to apply:** never hand a raw driver timestamp to `new Date()` or to the client.
Normalise server-side first: `String(v).replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00")`
then `toISOString()`. If two read paths serve the same row to one component, normalise in
the shared mapper so both spellings converge.
