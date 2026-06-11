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
