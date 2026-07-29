---
name: Samsara /devices health endpoint
description: Quirks of Samsara GET /devices?includeHealth=true for device-health rollups
---

- `GET /devices?includeHealth=true` rejects `limit=512` with HTTP 400; use `limit=100` and paginate via `after` cursor.
- Endpoint is org-level — no `parentTagIds` filter needed (or supported the same way as other endpoints).
- Each vehicle typically has TWO devices (VG-prefixed gateway + CM-prefixed camera); `asset.name` is the truck number — roll up worst-of status per canonical vehicle number (needsReplacement > needsAttention > dataPending > healthy).

**Why:** first integration attempt used limit=512 (works on other Samsara endpoints) and failed; per-device rows must be aggregated or vehicle counts double. The 2026-07 device-health feature built on this was later removed at the user's request — no code remains, only this API knowledge.
**How to apply:** any future Samsara device/health feature should paginate limit=100 + `after` cursor and aggregate worst-of status per canonical truck number.
