---
name: All Vehicles roster mirror (fs_all_vehicles_mirror)
description: Why GET /api/fs/all-vehicles serves four Snowflake roster sources from a local PG mirror, and the byte-for-byte constraint that forced a raw transport-cache shape over a normalized one.
---

# All Vehicles roster mirror

`GET /api/fs/all-vehicles` serves its four Snowflake roster sources
(REPLIT_ALL_VEHICLES base, Holman odometer+STATUS, UNASSIGNED_VEHICLES,
TPMS_EXTRACT tech) from `fs_all_vehicles_mirror` (daily overwrite) instead of
live per-request Snowflake reads. Same idea as the VRM profitability snapshot.

**Why:** the heavy aggregator route held a Neon serverless WS connection open
across many live external reads; long requests dropped the WS (close 1006) and
surfaced a 503 banner. Moving the slow roster reads off the request path is the
fix. Note the failure was Neon/Postgres WS, NOT Snowflake concurrency — a shared
Snowflake reader lock would not address it.

**Durable constraint — the mirror is a raw transport cache, not a normalized
model.** The route returns the base result set essentially raw, and downstream
logic depends on exact parity. A "one row per normalized vehicle + is_unassigned
boolean" table CANNOT reproduce the response byte-for-byte, because:
- base rows are returned un-deduped and order-sensitive — duplicate VEHICLE_NUMBER
  rows and `data.length` must survive (collision parity);
- UNASSIGNED is consumed twice (a raw list whose raw VEHICLE_NUMBER strings feed
  overlapVehicles, plus a normalized Set), so raw strings + row multiplicity must
  be preserved, not collapsed to a per-vehicle flag.
**How to apply:** when byte-for-byte response parity conflicts with a "clean"
normalized mirror schema, parity wins — store rows raw/ordered and reconstruct.

**Other guardrails:** the mirror does its OWN TPMS_EXTRACT read for tech (don't
substitute the live technician cache as the mirror source). Refresh is
all-or-nothing (advisory-locked, all sources required, abort+keep-last-good on
any failure / empty / large shrink, atomic truncate+insert). Empty mirror falls
back to identical live queries. SPARE status, the Holman managed-set cache, BYOV
TRUCK_LU, and Samsara/FleetFinder/PMF/POs/maintenance stay live in the handler.

**Cold-start last-good — the mirror READ is itself a Neon read.** Moving roster
reads to the mirror shrinks the WS-drop surface but does NOT remove it: the route
still reads the mirror (and many enrichment queries) over Neon, so a transient
drop on the FIRST request after a restart (in-memory cache empty) would 503.
Two-tier fallback closes this: (1) in-memory stale cache (<=15m), then (2) a
persisted singleton response snapshot `fs_all_vehicles_response_snapshot`
(JSONB of the fully-assembled payload, written best-effort on every success,
served <=24h) — it survives restart. Reads of persisted last-good go through a
one-shot retry (`pgQueryWithRetry`) so a single WS blip is ridden out, not
surfaced. **How to apply:** any "serve last-good on transient drop" path whose
last-good store is itself in Neon must persist the assembled payload AND retry
the recovery read — in-memory cache alone is useless on a cold restart.
