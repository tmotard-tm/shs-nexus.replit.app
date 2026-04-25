# Nexus End-to-End Review

> **Status:** Locked 2026-04-25. Canonical reference for the Nexus / Fleet Scope / VRM consolidation effort.
> Supersedes ad-hoc planning notes. Update via PR; do not edit silently.

## Scope

Make Nexus the single system of record across Core Nexus, Fleet Scope, and VRM, eliminating drift and fragmentation. All three live in **one Postgres** (not separate databases). Consolidate nine vehicle slideouts into a single `UniversalVehiclePanel`. Design real-time, bi-directional sync against twelve external systems: Holman, AMS, TPMS, Samsara, NetSuite (via WMS), PMF, Snowflake, Segno, Twilio, SendGrid, BYOV, UPS.

## Decisions Locked

1. **TPMS = system of record for tech-to-truck assignments.** Nexus mirrors and reconciles; TPMS wins on conflict resolution.
2. **SendGrid = single account.** `FS_SENDGRID_API_KEY` joins the stale-secrets cleanup list.
3. **Persist this review to `docs/end-to-end-review.md`** (this file).
4. **Kickoff phase:** `1.cleanup.a` (FS_* secret strip) runs in parallel with `2A.1` (UniversalVehiclePanel skeleton).
5. **NetSuite vehicle data flows through WMS engine only.** No direct NetSuite calls from Nexus. **No Snowflake-first for vehicle entities.** The Samsara Snowflake-first read pattern stays as designed (telematics only).

## Read-Tier Policy by System

| System | Pattern | Notes |
|---|---|---|
| WMS engine (vehicles, assignments) | live + bulk reconcile + client-diff | NO Snowflake for vehicles. `useCaseId` required (currently `"Nexus"`). No server-side `modifiedSince` — log future ask. |
| Samsara (telematics, GPS) | Snowflake-first (T1/T2/T3 + stale fallback) | 15-min mirror; webhook = cache-invalidation; live API only on cache-miss / freshness violation / explicit refresh. |
| PMF | Live-only | No Snowflake mirror. Tight rate-limit accounting; short-TTL in-process cache. |
| TPMS | SoT for assignments | Authoritative on conflict. |
| Holman | Webhook + outbox; opt-in tiered reads on metadata fields | Service status not in Snowflake. |
| AMS | Webhook + outbox; opt-in tiered reads on `AIMS_TECH_INFO` fields | |
| NetSuite | Via WMS adapter only | No direct path. |

## WMS Adapter — Three-Layer Pattern (Vehicles & Assignments)

Replaces Snowflake-first for vehicle entities (Snowflake is bypassed entirely for WMS-sourced data).

### Layer 1 — Bulk reconcile

- `GET /wms-engine/v1/trucks` every **12 hours** (true-up).
- Tighten cadence ONLY on observed drift in production. Do not over-engineer.
- Hydrates Nexus's local `vehicles` table.
- Reconciler diffs vs local state; surfaces:
  - vehicles in WMS not in Nexus,
  - vehicles in Nexus missing from WMS,
  - field-level mismatches.
- Emits change events to the outbox when diff detects drift.
- **Scheduled background job only.** Never on a user-facing read path.
- Coalesce concurrent triggers; circuit breaker on WMS outage during the scheduled window.

### Layer 2 — Client-side change detection

- Stash the previous bulk snapshot keyed by `truckId`.
- Hash each truck record. On the next bulk pull, emit change events only for trucks whose hash changed.
- Gives the effect of a delta-pull without WMS supporting it server-side.

### Layer 3 — Per-truck live GET

- `GET /wms-engine/v1/trucks/{truckId}` fired when a user opens `UniversalVehiclePanel`.
- **Stale-while-revalidate:** serve immediately from local hydrated cache, fire async revalidate, update if drifted.
- Short-TTL in-process cache (30–120s) absorbs intra-session burst reads.
- Forced-refresh follows the canonical rule below (bypasses cache & freshness-gate; respects per-vendor token bucket).

### Rate limits

- Token bucket sized against **WMS engine** quotas (NOT NetSuite directly).
- Reads and writes have separate budgets; **~30% reserved-write quota** holds.

## Samsara Adapter — Snowflake-First (Reference for Tiered Pattern)

### Tiered reads

- **T1 — Snowflake.** Latest row keyed by VIN/asset-id. Serve if `now − last_updated_ts ≤ field.threshold`. Tag `source=snowflake-stream`, `source_tier=1`.
- **T2 — `integration_events`.** If a webhook event is newer than the Snowflake row, prefer it. Tag `source=samsara-webhook`, `source_tier=2`.
- **T3 — Live vendor API.** Counts against per-vendor RPS budget. Tag `source=samsara-api`, `source_tier=3`.
- **Graceful degrade:** if T3 is rejected by token bucket or the breaker is open, return T1's stale value with `stale=true, ageSec, reason`. UI renders staleness badge from `field_provenance`. If T1 is also missing, return `null, source='none'`.

### T3 trigger conditions (exhaustive)

- (a) cache miss — no Snowflake row for the entity
- (b) freshness violation — `now − last_updated_ts > field.threshold` AND no fresher T2 event
- (c) explicit user "refresh now"

### Webhook semantics

- **Cache-invalidation + recency hint, NOT primary data path.**
- On receipt, compare `webhook.changed_at` vs Snowflake row's `last_updated_ts`.
  - If newer → INSERT into `integration_events` (full payload retained).
  - If not → discard, increment `vendor_webhook_redundant_total{vendor}`.
- **Webhook does NOT trigger T3.** The 15-min mirror catches up; T2 serves the gap.

### Write path

- `vehicleService → outbox → adapter`. Snowflake-first governs reads only.
- After successful write: optimistic event into `integration_events`, `source=nexus-write`, `ttl_sec = field.threshold`.
- **Conflict policy:** if a vendor webhook arrives with newer `changed_at` during the TTL window, **vendor wins** (vendor is SoT for telemetry).
- Optimistic event auto-yields once a Snowflake row supersedes it.

## Per-Field Freshness Thresholds

| Field | Default | T1 viable on 15-min mirror? |
|---|---|---|
| `gps_latlng` | 5 min | ❌ — webhook + live-API path |
| `speed_heading` | 5 min | ❌ |
| `last_known_address` | 30 min | ✅ — alert on mirror lag >20 min |
| `odometer` | 1 hour | ✅✅ |
| `fuel_level` / `battery` | 1 hour | ✅✅ |
| `driver_assignment` / `vehicle_group` | 4 hours | ✅✅✅ |
| `vin` / `year` / `make` / `model` / `plate` | 24 hours | ✅✅✅ — effectively static |
| **WMS vehicle fields** | **12 hours** (matches L1 cadence) | n/a — bulk-cache tier |

### Override mechanism

```sql
CREATE TABLE freshness_overrides (
  vendor          TEXT NOT NULL,
  field           TEXT NOT NULL,
  threshold_sec   INTEGER NOT NULL,
  updated_by      TEXT NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes           TEXT,
  PRIMARY KEY (vendor, field)
);
```

- Resolution order: DB row → env var → hardcoded default.
- 30s in-process cache + `LISTEN/NOTIFY` for instant invalidation.
- Floor 60s, ceiling 7d, `updated_by` non-null.

## Field Provenance Schema

```sql
CREATE TABLE field_provenance (
  entity_type             TEXT NOT NULL,
  entity_id               TEXT NOT NULL,
  field                   TEXT NOT NULL,
  source                  TEXT NOT NULL,        -- snowflake-stream | samsara-webhook | samsara-api | wms-bulk | wms-live | nexus-write | ...
  source_system           TEXT NOT NULL,        -- wms | samsara | pmf | tpms | holman | ams
  source_tier             SMALLINT NOT NULL,    -- 1 mirror/bulk-cache · 2 event · 3 live
  read_tier               TEXT NOT NULL,        -- live | bulk-cache | snowflake
  freshness_threshold_sec INTEGER NOT NULL,
  conflict_policy         TEXT NOT NULL,        -- vendor-wins | nexus-wins | manual
  last_synced_at          TIMESTAMPTZ NOT NULL, -- source's timestamp, never now()
  PRIMARY KEY (entity_type, entity_id, field)
);
```

## Adapter Interfaces

```ts
interface TieredReadResult<T> {
  data: T | null;
  source: string;
  source_tier: 1 | 2 | 3;
  stale: boolean;
  ageSec: number;
  reason?: 'rate-limit' | 'breaker-open' | 'no-data';
}

interface BaseTieredVendorAdapter<TQuery, TResult> {
  vendor: string;
  freshness: FreshnessRegistry;
  readSnowflake?(q: TQuery): Promise<TimedRow<TResult> | null>;
  findFresherEvent?(q: TQuery, since: Date): Promise<TimedRow<TResult> | null>;
  readLive(q: TQuery, opts?: { forced?: boolean }): Promise<TimedRow<TResult>>;
  recordProvenance(field: string, source: string, ts: Date): Promise<void>;
}

interface BaseWmsAdapter<TQuery, TResult> {
  bulkReconcile(): Promise<ReconcileReport>;            // L1 (scheduled job only)
  diffAgainstLastSnapshot(rows: TResult[]): ChangeEvent[];  // L2
  readLive(id: string, opts?: { forced?: boolean }): Promise<TimedRow<TResult>>; // L3
}
```

## Forced Refresh — canonical rule

`POST /api/vendor-data/refresh` with `{vendor, entityType, entityId, fields[]}`.

**Bypasses:**
- in-process LRU / short-TTL cache
- freshness-gate (treats the field as if cache-miss for the purposes of tier selection)

**Does NOT bypass:**
- per-vendor token bucket (a forced refresh is still a real T3 call and counts against the vendor budget)
- circuit breaker (if the breaker is open, returns the latest stale value with `stale=true, reason='breaker-open'`)

**Additional throttle:** per-user sub-bucket of 1 / 30s, applied *before* the per-vendor bucket. Rejection returns `429` with `Retry-After`; no vendor call is made.

Audit row per request: `actorUserId, vendor, entityId, fieldsRequested, granted/denied, resultSource`.

## Migration Plan

### Phase 1 — Discovery & cleanup (~1d)

| # | Task |
|---|---|
| 1.cleanup.a | **Strip stale FS_* secrets** (kickoff): `FS_DATABASE_URL`, `FS_PGHOST`, `FS_PGPORT`, `FS_PGUSER`, `FS_PGPASSWORD`, `FS_PGDATABASE`, `FS_SENDGRID_API_KEY` |
| 1.cleanup.b | Rename FS-only secrets (TWILIO / OPENAI / ELEVENLABS / UPS / PUBLIC_SPARES / FLEET_FINDER) |
| 1.cleanup.c | Consolidate confirmed-same-account vendor secrets (SAMSARA, PMF, BYOV, SNOWFLAKE, SENDGRID) |
| 1.audit     | Inventory `useCaseId` values used against WMS — **complete: single value `"Nexus"` via `WMS_ENGINE_USE_CASE_ID`** |

### Phase 2 — Consolidation (~8–10d)

| # | Task | Status |
|---|---|---|
| 2A.1 | UniversalVehiclePanel skeleton (kickoff) | DONE |
| 2A.2 | Anchor migration: TruckDetailPanel → 6-tab UVP; FS Dashboard, TodaysQueue, VRM ActiveRentals, Assets drilldown wired; old panel deleted | DONE |
| 2A.3 | Inventory + Assignments tabs (WMS + TPMS) + remaining slideout absorptions (#3–#7) | PENDING |
| 2A.4 | Inline page drawers absorbed (#8–#9) | PENDING |
| 2B.1 | `fs_trucks` → VIEW + sidecar | PENDING |
| 2B.2 | `vrm_repair_tracker` → child FK | PENDING |
| 2B.3 | `vrm_techs` → VIEW; drop Levenshtein matcher | PENDING |
| 2C   | Archive migration scripts; scrub `server/fleet-scope-db.ts` comments | PENDING |

**2A.2 anchor — verification notes (post code review):**
- AC-1 (panel owns data, callers pass IDs only): PASS at all 4 entry points.
- AC-2 (no dual-living UI): PASS — `TruckDetailPanel.tsx` deleted in same change.
- AC-3 (data-testid preservation): legacy `panel-truck-detail` restored on the new SheetContent root after architect flagged it.
- Telematics field duplication (Samsara Location / Last Samsara Signal) removed from Service tab — telematics data lives only in Telematics tab now.
- AssetsTaskDetailView surface itself is preserved (it is a task-management UI, not a vehicle slideout); the matrix item only added a vehicle-detail drilldown button.
- Tier-aware adapters, FieldProvenanceBadge surfacing, header refresh button, and unified vehicle id remain deferred per locked plan (3A.5 / 3B.1 / 3B.3 / 2B).

#### 2A Slideout Migration Matrix

Working enumeration of legacy surfaces to absorb. Confirm + finalize during 2A.2 discovery; some are inline drawers within pages and may split or merge.

| # | Legacy surface | Target tab(s) | Migration order | Acceptance criteria |
|---|---|---|---|---|
| 1 | `client/src/components/fleet-scope/TruckDetailPanel.tsx` (945-line reference) | Overview · Service · Telematics · Inventory | 2A.2 (anchor) | Feature parity for repair info, shop call, suggested replacements, AMS update, Samsara location; unchanged data-testid surface for fleet-scope flows |
| 2 | `client/src/components/assets-queue/AssetsTaskDetailView.tsx` | Overview · Assignments · History | 2A.2 | Asset queue task drilldown opens UniversalVehiclePanel with task context preserved |
| 3 | `client/src/components/fleet/assignment-history-dialog.tsx` | Assignments · History | 2A.3 | Assignment history list rendered inline in History tab; legacy Dialog deleted |
| 4 | `client/src/components/work-module-dialog.tsx` | Service · Inventory | 2A.3 | Work-module per-vehicle drilldown migrates to Service tab section |
| 5 | `client/src/components/pick-up-request-dialog.tsx` | Service (action) | 2A.3 | Pick-up request initiated from Service tab action button; modal-in-modal pattern OK |
| 6 | `client/src/components/view-inventory-button.tsx` (dialog) | Inventory | 2A.3 | Inventory button now opens the panel's Inventory tab directly when invoked from a vehicle row |
| 7 | `client/src/components/telematics-button.tsx` (dialog) | Telematics | 2A.3 | Telematics button opens the panel's Telematics tab; existing route entry point preserved |
| 8 | Inline vehicle drawer in `client/src/pages/fleet-management.tsx` | Overview · Telematics · Service | 2A.4 | Fleet Management vehicle row click opens UniversalVehiclePanel; inline drawer code removed |
| 9 | Inline vehicle drawer / dialog in `client/src/pages/fleet-alignment.tsx` | Overview · Assignments | 2A.4 | Alignment-mismatch row click opens UniversalVehiclePanel with mismatch context surfaced in Assignments tab |

**Cross-cutting acceptance criteria for 2A:**
- `client/src/pages/fleet-scope/TruckDetail.tsx` (full-page) and `client/src/pages/update-vehicle.tsx` (edit page) remain as full pages — out of scope for this slideout collapse.
- All migrated entry points must pass `vehicleId` and an optional `fromPage` to the panel; no entry point may pass arbitrary pre-fetched truck objects (panel is the data owner).
- All replaced surfaces must be deleted in the same PR that migrates the entry point — no dual-living UIs.

### Phase 3 — Sync architecture (~14.5d)

#### 3A — Foundation (~5d)

| # | Task | Effort |
|---|---|---|
| 3A.1 | `integration_events` + outbox + `field_provenance` (with `source_tier`, `last_synced_at`, `read_tier`, `conflict_policy`) | 1d |
| 3A.2 | rate-limit registry + token bucket + circuit breaker + reserved-write quota | 1d |
| 3A.3 | SKIP-LOCKED drainers (inbox + outbox), bucket-gated | 1.5d |
| 3A.4 | `freshness-registry` + `freshness_overrides` + LRU + Snowflake pool / short timeout / fail-open | 1.5d |

#### 3A.5 — Adapter abstractions (~2d)

- `BaseTieredVendorAdapter` (Snowflake-first) — Samsara reference
- `BaseWmsAdapter` (live + bulk + client-diff) — WMS reference
- Per-system per-field tier config wired into `field_provenance`

#### 3B — Per-system rollouts (~7.5d)

| # | Task | Effort |
|---|---|---|
| 3B.1 | Samsara webhook shadow → cutover (cache-invalidation semantics) | 1.5d |
| 3B.2 | Samsara outbound writes + optimistic-event TTL + vendor-wins conflict | 1d |
| 3B.3 | Forced-refresh endpoint + audit + per-user sub-bucket | 0.5d |
| 3B.4 | Holman / AMS Snowflake-coverage audit + per-field config | 1d |
| 3B.5 | Holman webhook + outbox + opt-in tiered reads | 1.5d |
| 3B.6 | AMS webhook + outbox + opt-in tiered reads | 1d |
| 3B.7 | WMS adapter (3-layer) for vehicles/assignments + PMF live-only adapter | 1d |

### Totals

- **Phase 3:** ~14.5d
- **Project total:** 23.5–25.5d

## Stale Secrets — Cleanup List (1.cleanup.a)

Strip from environment:

- `FS_DATABASE_URL`
- `FS_PGHOST`
- `FS_PGPORT`
- `FS_PGUSER`
- `FS_PGPASSWORD`
- `FS_PGDATABASE`
- `FS_SENDGRID_API_KEY`

Existing comment-only references in `server/fleet-scope-db.ts` (lines 13, 15) to be scrubbed in 2C.

## Open Follow-Ups (Non-Blocking)

- **WMS team ask:** add `modifiedSince` filter to `GET /wms-engine/v1/trucks`. Single biggest future efficiency win for Layer 1. Non-blocking — current 12h cadence + client-diff is sufficient.
- **Drift dashboard** once `field_provenance.source_tier` is populated (% reads served from T1 / T2 / T3 per vendor).
- **NetSuite / PMF Snowflake mirror status:** N/A for plan. PMF confirmed live-only; NetSuite bypassed entirely via WMS.

## References

- WMS Swagger: `https://hspsc-api-gateway-dev.stage.nextgen.shs.com/v1/api/wms-engine/v3/api-docs`
- Existing WMS adapter: `server/wms-engine-service.ts`
- Existing slideout to consolidate: `client/src/components/fleet-scope/TruckDetailPanel.tsx`
