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
| 2A.3 | Inventory + Assignments + Telematics tabs wired (WMS + TPMS + Samsara); slideout absorptions #3, #6, #7 internalized in UVP | DONE |
| 2A.3.note1 | **RESOLVED at adapter layer.** `server/wms-engine-service.ts` calls every endpoint by explicit `path + method` via `apiFetch(path, { method })`. No generated `operationId` is used anywhere; redaction is therefore moot. `inventory-schedule` GET is not yet exposed (no UI demand in 2A.3); deferred until first caller surfaces. | RESOLVED |
| 2A.3.note2 | **RESOLVED at adapter layer.** `server/wms-engine-service.ts` already encodes the spelling split: `useCase=` on `/trucks/:id/receive-tasks` (line 401) and `/trucks/:id/return-tasks` (line 418); `useCaseId=` on `/trucks`, `/trucks/:id`, `/trucks/assignments`, `/trucks/assignments/:techId`. Single canonical caller value (`WMS_ENGINE_USE_CASE_ID="Nexus"`) is mapped to whichever spelling each endpoint expects. **Live cross-spelling acceptance verification is pending first non-mock dev call**; flag preserved here so the first WMS hit on Inventory or Assignments tab confirms it. | RESOLVED |
| 2A.3.note3 | **Matrix items #4 (`work-module-dialog.tsx`) and #5 (`pick-up-request-dialog.tsx`) misclassified as vehicle slideouts.** Re-reading both: `work-module-dialog` is a queue-task workflow surface (start/save/complete task, template checklists, refund decision, NTAO/Assets/Fleet/Tools/Inventory queue routing) used by 6 queue pages — vehicle context is incidental. `pick-up-request-dialog` is an agent-assignment picker used by all 5 queue pages — no vehicle context at all. Both belong to a future "Queue Task UX consolidation" workstream, not vehicle panel consolidation. **Excluded from 2A.3.** | NOTE |
| 2A.3.note4 | **Deletion of dialogs #3, #6, #7 deferred.** UVP now internalizes assignment history (Assignments tab), on-truck inventory (Inventory tab), and full Samsara telematics (Telematics tab) — any vehicle accessed via UVP gets these features inline. Legacy files remain alive for non-UVP callers (`fleet-management.tsx`, `update-vehicle.tsx`, `vehicle-assignments.tsx`, `active-vehicles.tsx`, `queue-item-data-template.tsx`) until those surfaces migrate to UVP in 2A.4 and beyond. AC-2 (no dual-living UIs) is satisfied **for the UVP path**; legacy callers will be migrated together with their host pages. | NOTE |
| 2A.4.note1 | **Matrix item #8 deferred to new phase 2A.5.** The fleet-management drawer (`client/src/pages/fleet-management.tsx` lines 2400–2900+) is not just a vehicle viewer — it is the page's primary AMS ops/write console: `Resync Assignments` mutation, `openModal("assign" / "unassign" / "poHistory" / "opsReview")` triggers, AMS comments / repair-disposition / repair-updates / user-updates writes, fleet-ops logs, and a 30+ field AMS read surface (Ownership / Description / Condition / Location). UVP's current Service tab is read-only and covers only a subset. Naive replacement would regress all five operational workflows. **Decision (Kirk):** scope a new **2A.5 — UVP Operations tab** that adds: (a) AMS comments + repair-disposition + repair-updates + user-updates write surface, (b) full AMS field display block, (c) Resync Assignments mutation in the panel header, (d) trigger entry points for assign/unassign/PO history/Ops Review modals (modals themselves stay outside UVP). Once 2A.5 lands, fleet-management.tsx migrates and #6/#7 lose this caller. | NOTE |
| 2B.1.design | **Detailed plan for `fs_trucks` → VIEW + sidecar.** See section "Phase 2B.1 — Design" below. Status: PROPOSED — pending Kirk go-ahead on three open decisions (orphan-row policy, VIEW writability strategy, execution sequencing). | PROPOSED |
| 2A.4.note2 | **Matrix item #9 reclassified as additive, not absorption.** `client/src/pages/fleet-alignment.tsx` has no per-vehicle drawer — the page is a bulk-fix tabular workflow (RunProgressDialog + ConfirmUnassign Dialog only, both non-vehicle). The original matrix description was incorrect. **Decision (Kirk):** treat #9 as additive — implement a row-level drilldown that opens UVP focused on the Assignments tab. Truck number badge in each mismatch row is now a clickable button → `<UniversalVehiclePanel vehicleNumber={record.truckNumber} defaultTab="assignments" fromPage="alignment" />`. UVP gained two new props (`vehicleNumber`, `defaultTab`) and the Fleet-Scope router gained `GET /api/fs/trucks/by-number/:truckNumber` to support callers that only know a vehicle number. | NOTE |
| 2A.4 | Inline page drawers absorbed: #9 additive UVP drilldown DONE; #8 deferred to 2A.5 | DONE |
| 2A.5 | UVP **Operations tab** — AMS write surface + ops triggers (unblocks #8) | PENDING |
| 2B.1 | `fs_trucks` → VIEW + sidecar (design locked, see 2B.1.design) | PENDING |
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
| 3 | `client/src/components/fleet/assignment-history-dialog.tsx` | Assignments | 2A.3 (DONE — internalized) | Vehicle-mode history list now rendered inline in Assignments tab. Legacy Dialog file kept until last non-UVP caller (`fleet-management.tsx`) migrates in 2A.4. |
| 4 | ~~`client/src/components/work-module-dialog.tsx`~~ | — | **RECLASSIFIED — see 2A.3.note3** | Queue-task workflow surface, not a vehicle slideout. Excluded from 2A. Future "Queue Task UX consolidation" workstream. |
| 5 | ~~`client/src/components/pick-up-request-dialog.tsx`~~ | — | **RECLASSIFIED — see 2A.3.note3** | Agent-assignment picker, not a vehicle slideout. Excluded from 2A. Future "Queue Task UX consolidation" workstream. |
| 6 | `client/src/components/view-inventory-button.tsx` | Inventory | 2A.3 (DONE — internalized) | On-truck inventory (Snowflake snapshot, search/filter/category) now rendered inline in Inventory tab. Legacy button file kept until last non-UVP callers migrate (5 callers across fleet-management, vehicle-assignments, active-vehicles, queue-item-data-template, update-vehicle). |
| 7 | `client/src/components/telematics-button.tsx` | Telematics | 2A.3 (DONE — internalized) | Full Samsara surface (vehicle info, GPS, odometer, DTCs w/ criticality, fuel/idle 7d, stream log) now rendered inline in Telematics tab. Legacy button file kept until `fleet-management.tsx` migrates in 2A.4. |
| 8 | Inline vehicle drawer in `client/src/pages/fleet-management.tsx` | Overview · Telematics · Service · **Operations** | **2A.5 (blocked on UVP Operations tab)** | Fleet Management vehicle row click opens UVP; inline drawer code removed. Blocked because the current drawer is the page's primary AMS ops/write console (resync, assign/unassign, PO history, ops review, AMS comments, repair-disposition, repair-updates, user-updates, ~30 AMS fields) — see 2A.4.note1. |
| 9 | ~~Inline vehicle drawer / dialog~~ **Add UVP drilldown from mismatch row** in `client/src/pages/fleet-alignment.tsx` | Assignments (default tab) | 2A.4 (DONE — additive) | Page has no drawer to absorb (mismatch table + bulk-fix dialogs only). Truck-number badge is now a click-target that opens UVP focused on Assignments so the analyst lands directly on TPMS-vs-WMS context. See 2A.4.note2. |

**Cross-cutting acceptance criteria for 2A:**
- `client/src/pages/fleet-scope/TruckDetail.tsx` (full-page) and `client/src/pages/update-vehicle.tsx` (edit page) remain as full pages — out of scope for this slideout collapse.
- All migrated entry points must pass `vehicleId` and an optional `fromPage` to the panel; no entry point may pass arbitrary pre-fetched truck objects (panel is the data owner).
- **No dual-living UI for migrated entry points.** When a host page is migrated to `UniversalVehiclePanel`, any legacy slideout/dialog it used must be removed in the same PR. Internalized features (e.g., assignment history, on-truck inventory, telematics) may keep their legacy file alive ONLY for as long as a non-migrated page still imports it; the file is deleted with the migration of its last remaining caller (see 2A.3.note4 for the current deferred set).

### Phase 2B.1 — Design: `fs_trucks` → VIEW + sidecar

**Intent (locked plan, line 8):** "Make Nexus the single SoR." Today `vehicles` (Core Nexus) and `fs_trucks` (Fleet Scope) are two parallel vehicle tables joined by `vehicleNumber=truckNumber`. This violates the SoR invariant. 2B.1 collapses them so identity lives in `vehicles` and operational state lives in a sidecar; the `fs_trucks` table itself becomes a VIEW so legacy SELECT callers continue working.

#### Discovery summary
- **`vehicles`** (shared/schema.ts:308) — 33 cols, identity-focused: `id`, `vin`, `vehicleNumber`, year/make/model, location, license, dates, `holman/tpms/snowflakeVehicleRef`. SoR for vehicle identity.
- **`fs_trucks`** (shared/fleet-scope-schema.ts:433, exported as `trucks`) — 89 cols, operational-state-focused: registration workflow, repair workflow, rental workflow, call logs, owner/notes/comments. ~83 of these have NO equivalent in `vehicles`.
- **Overlap (6 cols):** `truckNumber↔vehicleNumber`, `vin`, `licensePlate`, `holmanVehicleRef`, `status` (semantically different — see decision 1 below), `createdAt/updatedAt↔lastUpdatedAt`.
- **FK dependents on `fs_trucks.id`:** `fs_actions.truck_id`, `fs_tracking_records.truck_id`, `fs_truck_status_events.truck_id` (all CASCADE).
- **Direct `trucks` symbol writes (4 sites):** `fleet-scope-storage.ts` (insert/update/delete inside `IStorage` impls — this is the abstraction layer), `holman-vehicle-sync-service.ts:662` (one-off direct update outside the interface — **must be migrated to use storage interface**).
- **Storage interface methods (already the right abstraction):** `getAllTrucks`, `getTruck(id)`, `getTruckByNumber`, `createTruck`, `updateTruck`, `deleteTruck`, `bulkSyncTrucks`, `consolidateTrucks`. Plus `getTruckByNumber` was added in 2A.4 for the new `/api/fs/trucks/by-number/:n` route.

#### Target schema

**New sidecar table `fs_truck_state`** (in `shared/fleet-scope-schema.ts`):
- `id` (PK, UUID) — **preserves the existing `fs_trucks.id` value** during migration, so `fs_actions.truck_id` / `fs_tracking_records.truck_id` / `fs_truck_status_events.truck_id` continue to FK without rewrite.
- `vehicleId` (FK → `vehicles.id`, NOT NULL, ON DELETE CASCADE) — the canonical join key going forward.
- All ~83 fs_trucks-only operational columns (mainStatus/subStatus, ownership, registration/tags workflow, repair/sales workflow, rental workflow, call logs, etc.).
- `status` stays in sidecar (it's a Fleet-Scope-derived combined status, not the same semantic as `vehicles.status`). See decision 1.
- **Drops:** `truckNumber`, `vin`, `licensePlate`, `holmanVehicleRef` — projected from `vehicles` via the VIEW. Writes to these fields go through `vehicles` (storage interface routes them).

**VIEW `fs_trucks`** (replaces the table; same name = transparent to SELECT callers):
```sql
CREATE OR REPLACE VIEW fs_trucks AS
SELECT
  fts.id                  AS id,
  v.vehicle_number        AS truck_number,
  v.vin                   AS vin,
  v.license_plate         AS license_plate,
  v.holman_vehicle_ref    AS holman_vehicle_ref,
  fts.*                   -- (sans the ones above)
FROM fs_truck_state fts
LEFT JOIN vehicles v ON v.id = fts.vehicle_id;
```
- LEFT JOIN keeps orphan sidecar rows visible (defensive); decision 2 governs whether orphans can exist post-migration.

#### Migration sequence (proposed)

Each sub-step ships independently and the system stays green between them.

| Sub | Step | Risk |
|---|---|---|
| 2B.1.a | Add `fs_truck_state` sidecar table to schema (additive, no drops). Add `vehicleId` column to existing `fs_trucks` (nullable). Push schema (`db:push`). | Low — additive only. |
| 2B.1.b | Backfill: for each `fs_trucks` row, find/create matching `vehicles` row (by `truckNumber=vehicleNumber`), set `fs_trucks.vehicleId`. Verify all rows linked. | Medium — may surface dirty data; need to handle orphans per decision 2. |
| 2B.1.c | Copy fs_trucks-only columns from `fs_trucks` → `fs_truck_state` (mirror; `id` preserved). Verify row counts match. | Low — pure copy. |
| 2B.1.d | Migrate all writers to storage interface. Rewrite `holman-vehicle-sync-service.ts:662` to use `fleetScopeStorage.updateTruck`. Rewrite `fleetScopeStorage.{create,update,delete,bulkSync,consolidate}Truck` to: writes split between `vehicles` (identity fields) and `fs_truck_state` (operational fields). | Medium — touches the abstraction. |
| 2B.1.e | Drop the 4 columns (`truckNumber`, `vin`, `licensePlate`, `holmanVehicleRef`) from `fs_trucks`. Drop sidecar columns from `fs_trucks` (now-redundant with `fs_truck_state`). At this point `fs_trucks` is just `id + vehicleId`. | Medium — irreversible. |
| 2B.1.f | Drop `fs_trucks` table; create `fs_trucks` VIEW joining `fs_truck_state` ⨯ `vehicles`. FK columns (`fs_actions.truck_id` etc.) re-target `fs_truck_state.id`. | High — schema swap. Single transaction. |
| 2B.1.g | Code review (architect) + smoke test FS Dashboard / TruckDetail / EditTruck / Holman sync. Mark 2B.1 DONE. | — |

#### Open decisions (need Kirk go-ahead before 2B.1.b)

**Decision 1 — `status` field semantics.** `vehicles.status` is a simple lifecycle enum (`'available'` default). `fs_trucks.status` is a derived combined status (built from `mainStatus` + `subStatus` by `combinedStatus` recompute in `updateTruck`). They are NOT the same field. Recommendation: **keep both — `vehicles.status` for identity lifecycle, `fs_truck_state.status` for the FS combined status. The VIEW projects `fs_truck_state.status AS status` (preserving today's behavior for FS callers).** Alternative would be to merge them, which would force one of the two consumer surfaces to change semantics.

**Decision 2 — orphan-row policy.** Discovery suggests `fs_trucks` may contain "virtual" trucks (rentals) with no matching `vehicles` row. Two options:
  - **2A.** Backfill: during 2B.1.b, create a matching `vehicles` row for every orphan `fs_trucks` row (with whatever fields are available — `vehicleNumber`, possibly `vin`/`licensePlate`). Going forward, the SoR invariant holds: every `fs_truck_state` row HAS a `vehicles` row. (Recommended — enforces the locked-plan SoR rule.)
  - **2B.** Allow orphans: keep `fs_truck_state.vehicleId` nullable forever; LEFT JOIN in the VIEW returns NULL identity fields for orphans. (Pragmatic but violates SoR intent.)
  - **2C.** Reject orphans: refuse to migrate and demand orphans be cleaned up first. (Strictest but may stall migration if orphan count is non-trivial.)

**Decision 3 — execution sequencing.** Two viable orderings:
  - **3A.** Execute 2B.1.a–g in one continuous push (1.5–2 days), with the system in a "dual-state" between 2B.1.c and 2B.1.f where data is mirrored in both `fs_trucks` and `fs_truck_state`. Reads still work; writes go to both via storage interface during the window.
  - **3B.** Pause after 2B.1.c for live verification (~1 day) — analyst confirms `fs_truck_state` row counts and column values match `fs_trucks` exactly before the irreversible drops in 2B.1.e–f.

(Recommendation: **3B** — the irreversible drops in 2B.1.e–f deserve a live verification gate.)

#### Decisions locked (2026-04-25, Kirk)
- **D1 — status semantics:** APPROVED — keep both `vehicles.status` and `fs_truck_state.status`; VIEW projects sidecar's status as `status`.
- **D2 — orphan-row policy:** APPROVED — backfill missing `vehicles` rows in 2B.1.b. **Audit-log every backfill** with `provenance="2B.1.b orphan reconcile"` for post-review.
- **D3 — sequencing:** APPROVED — 3B (gated). Pause after 2B.1.c.

#### 2B.1.c verification gate (Kirk's required checks)
Before proceeding to 2B.1.d–f (irreversible drops), verify ALL of:
1. **Row-count parity:** `COUNT(fs_trucks)` == `COUNT(fs_truck_state JOIN vehicles)` — every fs_trucks row maps to exactly one sidecar row joined to a vehicles row.
2. **FK integrity:** every `fs_actions.truck_id`, `fs_tracking_records.truck_id`, and `fs_truck_status_events.truck_id` value still exists in `fs_truck_state.id` (since sidecar preserves the original `fs_trucks.id` UUIDs).
3. **Status projection sample diff:** ~50-row sample comparing `fs_trucks.status` vs `fs_truck_state.status` — must be byte-identical post-copy.
4. **Smoke test (2+ FS callers reading through the future VIEW shape):** at minimum `fleet-scope/Dashboard.tsx` and `fleet-scope/EditTruck.tsx`. (At 2B.1.c the VIEW doesn't exist yet, so smoke = simulating the VIEW SELECT shape directly against `fs_truck_state JOIN vehicles` and confirming row shape matches today's `SELECT * FROM fs_trucks`.)
5. **Vehicles NOT-NULL invariants intact (added 2026-04-25):** `SELECT COUNT(*) FROM vehicles WHERE vin IS NULL OR model_year IS NULL OR make_name IS NULL OR model_name IS NULL` must equal **0**. Phase 3 hydration (see "Resequencing decision" below) is required to satisfy this before 2B.1.b can resume.
6. **Bijection (added 2026-04-25, post-architect-review):** zero duplicate canonical `vehicle_number` in vehicles; zero duplicate canonical `truck_number` in fs_trucks; every fs_trucks row has exactly 1 matching vehicles row by `LPAD(_,6,'0')` join.
7. **Full-row checksum parity (added 2026-04-25, post-architect-review):** for the 88 common columns between fs_trucks and fs_truck_state, every fs_trucks row's md5 row-hash equals its fs_truck_state.id-paired row-hash. Drift count must be 0.
8. **Hydration-source freshness (added 2026-04-25, post-architect-review):** every `holman_vehicles_cache` row used for bootstrap was refreshed within the past hour at hydration time. Recorded for audit; a stale-cache hydration would require re-run after a fresh HolmanSync.

#### 2B.1.c GATE EXECUTION (2026-04-25) — ALL PASSED

| # | Check | Result |
|---|---|---|
| 1 | Row-count parity | fs_trucks=333, fs_truck_state⨯vehicles=333 ✅ |
| 2 | FK integrity (FS child tables) | fs_actions: 730/0 orphans; fs_tracking_records: 0/0; fs_truck_status_events: 75/0 ✅ |
| 3 | Status sample diff (50 rows) | 0 mismatches ✅ |
| 4 | Smoke (simulated VIEW shape) | view_cols=92 = trucks_cols=92 (identical projection) ✅ |
| 5 | vehicles NOT-NULL invariants | violations=0 ✅ |
| 6 | Bijection | 0 dupes, 333/333 unique 1:1 ✅ |
| 7 | Full-row checksum parity (88 cols) | 333 matching, 0 drift, 0 missing ✅ |
| 8 | Hydration-source freshness | all 333 cache entries <6 min old at T0 ✅ |

**Open decision for Kirk before 2B.1.d (architect-flagged HIGH):**
The doc currently calls for a ~1-day pause after 2B.1.c for live verification before the irreversible drops in 2B.1.e/f. During that pause, writers still target `fs_trucks` (the storage interface migration is 2B.1.d), so `fs_truck_state` will progressively drift from `fs_trucks`. Choose one:

- **D-α (skip pause, proceed immediately to 2B.1.d):** zero drift window. Loses live verification time but the 8-check gate above + transaction-wrapped scripts make verification high-confidence already.
- **D-β (take pause + write-freeze on fs_trucks):** zero drift, but breaks live FS Dashboard / EditTruck for analysts during the pause.
- **D-γ (take pause + re-run the copy+gate script immediately before 2B.1.d):** drift caught and re-mirrored at cutover. Simple, reversible, recommended.
- **D-δ (take pause + install temporary trigger mirroring writes from fs_trucks → fs_truck_state):** most robust but adds code that gets thrown away at 2B.1.f.

**Recommendation:** D-γ. Re-runs are cheap, gates are deterministic.

#### 2B.1.c PAUSE — Decision: D-γ (Kirk, 2026-04-25)

**T0 = 2026-04-25T22:50:06Z** (`2B.1.c PAUSE START`)

**Schedule:**
- Snapshot 1: T0+6h  = **2026-04-26T04:50:06Z**
- Snapshot 2: T0+12h = **2026-04-26T10:50:06Z**
- Snapshot 3: T0+18h = **2026-04-26T16:50:06Z**
- **Cutover:**  T0+24h = **2026-04-26T22:50:06Z** — re-run full copy + 8-gate; if all pass → proceed to 2B.1.d.

**Snapshot definition (per Kirk):** row-count delta (fs_trucks vs fs_truck_state) + 50-row random-sample checksum on canonical cols (NOT a full re-run). Logged in the table below.

**Anomaly rule:** if any snapshot shows row-count delta >5% OR unexplained sample checksum mismatch (i.e. not attributable to a normal UPDATE captured in audit log), pause and post structured question before cutover instead of auto-proceeding.

**Live writers continue targeting fs_trucks during the pause.** No write-freeze. Drift expected; gate at cutover catches it.

##### 2B.1 drift telemetry

| When (UTC) | fs_trucks count | fs_truck_state count | Δ count (%) | 50-row sample mismatches | Verdict |
|---|---|---|---|---|---|
| T0 (2026-04-25T22:50:06Z) — baseline | 333 | 333 | 0 (0.0%) | 0 | ✅ baseline |
| T0+6h  (2026-04-26T04:50:06Z) | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ |
| T0+12h (2026-04-26T10:50:06Z) | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ |
| T0+18h (2026-04-26T16:50:06Z) | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ |
| T0+24h cutover (2026-04-26T22:50:06Z) | _pending_ | _pending_ | _pending_ | full 8-gate re-run | _pending_ |

Snapshot script: `scripts/2b1-drift-snapshot.ts` (read-only, prints the row to append above).

**In-process cron (Kirk D-γ):** `server/2b1-drift-cron.ts` (loaded from `server/index.ts` `server.listen` callback) schedules the 3 snapshots at exact UTC fire times (`50 4 26 4 *`, `50 10 26 4 *`, `50 16 26 4 *`) and auto-replaces the matching `_pending_` row above. On script exit code 2 (anomaly), `haltAllJobs()` stops every remaining task and prints a structured banner; cutover at T0+24h is then blocked pending analyst review. Past-fire-time jobs are skipped on workflow restart (so the cron is restart-safe within the pause window). Call `removeDriftCron()` from the cutover script after a successful T0+24h cutover to unschedule any leftover task. **Verified scheduled 2026-04-25T23:10Z (3/3 jobs, fires in 5.67h / 11.67h / 17.67h).**

#### 2B.1.d — Writer migration plan (drafted 2026-04-25 during pause)

**Scope (every direct fs_trucks writer in the codebase):**

| # | Callsite | Today | After 2B.1.d |
|---|---|---|---|
| 1 | `fleetScopeStorage.createTruck` (fleet-scope-storage.ts:222) | INSERT into fs_trucks with truckNumber/mainStatus/subStatus | (a) lookup vehicles by canonical truck_number → if missing, INSERT vehicles row; (b) INSERT fs_truck_state with vehicle_id, status, mainStatus, subStatus, shsOwner. Returns Truck-shaped row via JOIN projection. |
| 2 | `fleetScopeStorage.updateTruck` (fleet-scope-storage.ts:240) | UPDATE fs_trucks .set(finalUpdates) | Split `finalUpdates`: identity fields (`vin`, `licensePlate`, `holmanVehicleRef`) → UPDATE vehicles WHERE id = state.vehicle_id; everything else → UPDATE fs_truck_state. Status-event side-effects unchanged. |
| 3 | `fleetScopeStorage.deleteTruck` (fleet-scope-storage.ts:305) | DELETE actions WHERE truck_id; DELETE trucks WHERE id | DELETE actions WHERE truck_id; DELETE fs_truck_state WHERE id. (vehicles row is NOT deleted — Core Nexus retains identity for cross-system audit.) |
| 4 | `fleetScopeStorage.bulkSyncTrucks` (fleet-scope-storage.ts:310) | calls createTruck/deleteTruck | unchanged externally — calls migrated createTruck/deleteTruck. |
| 5 | `fleetScopeStorage.consolidateTrucks` (fleet-scope-storage.ts:1426) | calls createTruck for new trucks; updates dateInRepair on fs_trucks | calls migrated createTruck; dateInRepair (state field) → UPDATE fs_truck_state. |
| 6 | `holman-vehicle-sync-service.ts:662` (only direct write outside storage interface) | `fsDb.update(trucks).set({holmanRegExpiry, holmanVehicleRef, lastUpdatedAt, lastUpdatedBy})` | Replace with `await fleetScopeStorage.updateTruck(fsTruck.id, { holmanRegExpiry, holmanVehicleRef, lastUpdatedBy: 'HolmanSync' })`. Migrated updateTruck handles the identity-vs-state split internally. |

**Read sites in storage interface (need to project Truck shape from JOIN):**

| # | Method | Today | After 2B.1.d |
|---|---|---|---|
| R1 | `getAllTrucks` (line 209) | `select * from fs_trucks order by createdAt desc` | `SELECT s.*, v.vehicle_number AS truck_number, v.vin, v.license_plate, v.holman_vehicle_ref FROM fs_truck_state s JOIN vehicles v ON v.id = s.vehicle_id ORDER BY s.created_at DESC` |
| R2 | `getTruck` (line 213) | `select * from fs_trucks where id` | same JOIN, WHERE s.id = $id |
| R3 | `getTruckByNumber` (line 218) | `select * from fs_trucks where truckNumber` | same JOIN, WHERE LPAD(v.vehicle_number,6,'0') = LPAD($n,6,'0') |

**Frontend impact: ZERO.** All FS frontend (Dashboard, EditTruck, TruckDetail, Registration, HolmanResearch, BatchCaller, ActionTracker, UVP, all tabs) reads through the API → storage interface. As long as the API still returns the 92-column Truck shape, no client changes needed. (Verified by gate #4: simulated VIEW shape = 92 cols = today's fs_trucks shape.)

**Order of operations within 2B.1.d (single PR):**
1. Add a private `splitTruckFields(updates)` helper in DatabaseStorage that returns `{ vehiclesUpdates, stateUpdates }` based on the 4 identity fields (truckNumber/vin/licensePlate/holmanVehicleRef).
2. Add a private `projectTruckShape(stateRow, vehiclesRow)` helper that reconstructs the Truck type from the join.
3. Rewrite read methods (R1–R3) using JOIN.
4. Rewrite write methods (1–5) using the split helper.
5. Migrate site #6 to use storage.updateTruck.
6. Run app boot + smoke test (FS Dashboard load, single truck edit via EditTruck, HolmanSync trigger, bulkSyncTrucks via existing endpoint).
7. Run a checksum re-verification (the same as gate #7) post-migration to confirm nothing drifted unexpectedly.

**Risks (medium):**
- A. `getAllTrucks().orderBy(desc(trucks.createdAt))` — `created_at` lives in fs_truck_state; ORDER BY translates cleanly. ✅
- B. `getTruckByNumber(truckNumber)` callers may pass non-canonical numbers (e.g. without leading zeros). The `LPAD(_,6,'0')` join makes the lookup canonical-safe; document this in the helper. Check if any code does exact-string `truckNumber === input` comparison after the lookup.
- C. The `.returning()` semantics differ between split inserts/updates vs. single-table; ensure projectTruckShape() called after the `vehicles` and `fs_truck_state` writes commit.
- D. `actions.truck_id` FK still points at fs_truck_state.id (preserved by gate #2). No FK rewrite needed in 2B.1.d — that comes in 2B.1.f when fs_trucks → VIEW.

**Estimated effort: ~0.5d** for 2B.1.d. 2B.1.e and 2B.1.f stay sequenced after live verification of 2B.1.d.

#### 2A.5 — UVP Operations tab (drafted 2026-04-25 during pause)

**Pause-safe?** ✅ Yes — every AMS endpoint keys off `vin`, never touches fs_trucks/fs_truck_state.

**Source to migrate from:** `client/src/pages/fleet-management.tsx` lines 2399–2890 (the inline vehicle drawer — page's primary AMS ops/write console).

**Existing UVP tabs:** Overview · Telematics · Service · Assignments · Inventory · History (6). Operations becomes the 7th. Tab grid `grid-cols-6` → `grid-cols-7` in UniversalVehiclePanel.tsx:184.

**Surfaces to port (from 2A.4.note1):**

| Surface | Source line | Endpoint | Notes |
|---|---|---|---|
| Resync Assignments | fleet-management.tsx:389 | POST `/api/fleet-vehicles/resync-assignments` | Mutation. Move trigger to UVP panel header (not tab body) per 2A.4.note1 (c). |
| Sync to Holman | fleet-management.tsx:410 | POST `/api/holman/assignments/update` | Mutation. Operations tab body. |
| Add AMS comment | fleet-management.tsx:937 | POST `/api/ams/vehicles/{vin}/comments` | Comment composer + list. |
| AMS user-update | fleet-management.tsx:953 | POST `/api/ams/vehicles/{vin}/user-updates` | Status/condition/notes write surface. |
| AMS repair disposition / updates | fleet-management.tsx:1024 | POST `/api/ams/vehicles/{vin}/repair-disposition` OR `/repair-updates` | Two-mode mutation. |
| Trigger: Assign | fleet-management.tsx:2527 | `openModal("assign")` | Modal lives outside UVP — UVP raises an event/callback. |
| Trigger: Unassign | fleet-management.tsx:2530 | `openModal("unassign")` | Disabled when no current tech assigned. |
| Trigger: PO History | fleet-management.tsx:2533 | `openModal("poHistory")` | |
| Trigger: Ops Review | (line 266 state) | `openModal("opsReview")` | Tech-near-vehicle search. |
| Trigger: AMS Edit | fleet-management.tsx:2824 | `openModal("amsEdit")` | |
| Trigger: AMS Repair | fleet-management.tsx:2842 | `openModal("amsRepair")` | |
| AMS field display block | fleet-management.tsx:~2600–2890 | read-only | Ownership / Description / Condition / Location ~30 fields. |

**Modal-trigger contract:** UVP itself will NOT host modals (modals stay page-level — both fleet-management.tsx and Vehicle Roster use them). UVP Operations tab raises a callback prop `onOpenModal: (modalKey: FleetModal, vehicle: Truck) => void`. Caller decides whether to open one. Fleet-management.tsx wires it up; pages without these modals (FS Dashboard etc.) pass undefined and the buttons hide.

**Build steps (single PR for 2A.5):**
1. Create `client/src/components/vehicle/tabs/OperationsTab.tsx`. Props: `{ truck: Truck, onOpenModal?: ModalCallback }`.
2. Add `"operations"` to TabKey union and TAB_DEFS in UniversalVehiclePanel.tsx; bump grid-cols-6 → grid-cols-7.
3. Add `onOpenModal?: ModalCallback` to UniversalVehiclePanelProps; thread through to OperationsTab.
4. Move Resync Assignments mutation into the panel header (per 2A.4.note1 (c)); requires `vehicleNumber`+`enterpriseId`.
5. Inside OperationsTab: extract the 7 mutations + 30-field AMS read block from fleet-management.tsx. Use vin as key.
6. Update fleet-management.tsx to pass `onOpenModal` when opening UVP, and remove the redundant inline drawer (#8 in matrix gets DONE). Verify no other caller of fleet-management drawer breaks.
7. Smoke test: open a vehicle from fleet-management → Operations tab → each button works → Resync from header works.

**Estimated effort: ~1.5d** (largest single 2A item — 7 mutations + 30 read fields + modal-callback contract).

##### 2A.5 progress (2026-04-25 during pause)

- **Step 1 DONE.** `client/src/components/vehicle/tabs/OperationsTab.tsx` written. Self-fetches AMS vehicle, AMS comments, ops logs, AMS lookups (truck-status, vehicle-runs, vehicle-looks, colors, branding, interior), Nexus tracking, vehicle POs, and Holman fleet-vehicle (for assignment summary). Mutations included: addComment, saveNexusData, resyncAssignments. Add Comment dialog lives inside the tab (tightly coupled to the comment list).
- **Step 2 DONE.** `UniversalVehiclePanel.tsx` TabKey union extended to `"operations"`, TAB_DEFS gains `Settings` icon, `TabsList` bumped from `grid-cols-6` to `grid-cols-7`.
- **Step 3 DONE.** `onOpenOperationsModal?: (kind, ctx) => void` prop added to `UniversalVehiclePanelProps`; threaded to OperationsTab as `onOpenModal`. UVP itself stays modal-agnostic.
- **Step 4 DESIGN-REFINEMENT.** Resync Assignments was originally specced for the panel header (2A.4.note1 (c)) but the mutation needs `enterpriseId` (= `holmanTechAssigned`), which is on the FleetVehicle shape — not on `TruckPanelData`. Moved Resync into the Operations tab body, beside the Assignment Summary cards (it fetches the FleetVehicle inside the tab via the cached `/api/holman/fleet-vehicles` query). Header stays uncluttered.
- **Step 5 DONE.** Read block (Ownership / Description / Condition / Location / Last-update line), Comments collapsible + Add dialog, Nexus form, Op Log — all ported. AMS Edit / Repair are emitted via `onOpenModal("amsEdit"|"amsRepair", ctx)` with prefill computed via lookup-matching inside the tab; the actual edit/repair modals stay outside UVP.
- **Step 6 DEFERRED (post-pause).** fleet-management.tsx still owns its inline drawer + 7 modals; migrating it to use UVP requires moving (or leaving in place) the modal renderers and replacing `selectedVehicle` (FleetVehicle shape) with `vehicleId` (fs_trucks.id) — non-trivial state plumbing that touches state shared with multiple tabs. Pause-safe choice: ship UVP+OperationsTab additively now; flip fleet-management to use UVP after T0+24h cutover.
- **Step 7 PARTIAL.** Server boots clean with cron scheduled; TypeScript clean (190 baseline → 190; introduced cron `ScheduledTask` type fix). Smoke test of OperationsTab via existing UVP entry points (e.g., truck-detail link from other pages) is pending — UVP is currently invoked without `onOpenOperationsModal` everywhere, so the new tab renders read-only by design until a caller wires the contract.

**Pause-safe checkpoint reached (2026-04-25T23:10Z, T0+0.3h).** Server compiles + boots; cron live; OperationsTab additive; no fs_trucks/fs_truck_state writes anywhere in the new code; cutover-priority preserved. Next iteration during pause will wire fleet-management.tsx (Step 6) — that work itself touches no fs_trucks writes (it's pure UI state plumbing) so it remains pause-safe; if cutover starts mid-edit at T0+24h, the in-flight changes will be reverted/parked for resume after cutover.

#### Pause-window work plan (2026-04-25 → 2026-04-26 22:50 UTC)

Ranked by effort/risk during the 24h drift window. All listed items are pause-safe (do NOT touch fs_trucks/fs_truck_state writes):

| # | Item | Pause-safe rationale | Effort | Status |
|---|---|---|---|---|
| 0 | T0 marker + drift telemetry script | read-only | done | ✅ DONE |
| 0a | 2B.1.d design doc | doc only | done | ✅ DONE |
| 0b | 2A.5 design doc | doc only | done | ✅ DONE |
| 0c | In-process drift cron (`server/2b1-drift-cron.ts`) wired in `server/index.ts` listen callback | read-only; spawns child process; appends to doc | 0.5h | ✅ DONE (verified 23:10Z, 3/3 scheduled) |
| 1 | T0+6h drift snapshot | read-only | 1 min | ⏳ scheduled (auto-fires via cron) |
| 2 | T0+12h drift snapshot | read-only | 1 min | ⏳ scheduled (auto-fires via cron) |
| 3 | T0+18h drift snapshot | read-only | 1 min | ⏳ scheduled (auto-fires via cron) |
| 4 | 2A.5 implementation (UVP Operations tab) | AMS endpoints key off vin | ~1.5d | 🟡 IN PROGRESS — Steps 1–5 DONE (see 2A.5 progress section); Step 6 (fleet-management caller migration) deferred to post-cutover |
| 5 | 2B.2 design (vrm_repair_tracker → child FK) | VRM tables, not FS | ~0.25d | candidate during pause |
| 6 | 2B.3 design (vrm_techs → VIEW) | VRM tables | ~0.25d | candidate during pause |
| 7 | 2C scripts (archive + comment scrub) | non-FS files | ~0.5d | candidate during pause |
| 8 | 3A.1–3A.4 design memos | green-field design only | ~1d | candidate during pause |
| 9 | T0+24h cutover: full copy + 8-gate re-run | scheduled cutover | ~3 min | ⏳ pending |

**Snapshot invocation:** `npx tsx scripts/2b1-drift-snapshot.ts --label "T0+6h"` (etc). Script exits 0 = OK, exits 2 = anomaly.

#### Resequencing decision (2026-04-25, Kirk) — Option C

**Trigger:** 2B.1.a verification revealed `vehicles` is empty (0 rows) while `fs_trucks` has 333 rows. The original D2 backfill plan would have inserted 256+ rows that violate `vehicles` NOT NULL constraints on `vin`, `model_year`, `make_name`, `model_name` (fs_trucks has `vin` for only 77 of 333 trucks and has no `model_year`/`make_name`/`model_name` columns at all).

**Decision:** Pause 2B.1 after 2B.1.a. Pull Phase 3B.4–3B.6 forward (Holman/AMS Snowflake hydration only — webhook/outbox/tiered-read parts stay in Phase 3 proper) to populate `vehicles` authoritatively from upstream sources. Then resume 2B.1.b with a clean SoR.

**New global sequence:** 2B.1.a (DONE) → 3B.4-bootstrap → 3B.5-bootstrap → 3B.6-bootstrap → 2B.1.b → 2B.1.c gate (incl. new check #5) → 2B.1.d–g.

**Constraints (Kirk):**
1. **Plan doc reflects new sequencing** (this section).
2. **Ghost subset triage is mandatory.** After 3B.4–3B.6 hydration completes, identify the FS-only "ghost" subset — `fs_trucks` rows with no Holman/AMS match. Do **NOT** auto-create `vehicles` rows for these. Produce a triage list with `truck_number`, `last_seen_at`, and any FS-side identifiers (vin, license_plate, holman_vehicle_ref, last_call_date, last_updated_at). The list goes into a new table `fs_2b1_ghost_triage` for analyst review and is surfaced via a small admin page. Resolution paths per ghost row: (a) analyst supplies missing identity → manual `vehicles` insert; (b) row is decommissioned/invalid → analyst marks `disposition='archive'` and the fs_trucks row is excluded from 2B.1.b backfill (and later from 2B.1.f VIEW via WHERE clause).
3. **Zero NOT-NULL violations gate.** 2B.1.b cannot start until check #5 above returns 0 *AND* every non-ghost `fs_trucks.truck_number` has a matching `vehicles.vehicle_number` row.
4. **Preserve in-flight 2B.1.a artifacts** during the pause. `fs_truck_state` table, `fs_2b1_orphan_backfill_audit` table, and `fs_trucks.vehicle_id` bridge column all stay in place untouched.

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
| 3B.4-bootstrap | **(DONE 2026-04-25)** Coverage audit. Snowflake-mirror coverage was insufficient (REPLIT_ALL_VEHICLES has no year column at all; 0/333 rows had model_year). **Local `holman_vehicles_cache` (Holman API mirror, refreshed each HolmanSync run) provides 100% coverage for all NOT NULL fields**: vin 333/333, make 333/333, model 333/333, model_year 333/333, plate 332/333. **0 ghosts**. Audit detail in `fs_2b1_coverage_audit`. | 0.25d → done |
| 3B.5 | Holman webhook + outbox + opt-in tiered reads | 1.5d |
| 3B.5-bootstrap | **(revised after 3B.4-bootstrap finding)** Single INSERT from `holman_vehicles_cache` → `vehicles` for the 333 fs_trucks-matched rows. Provenance `'3B.5-bootstrap holman_vehicles_cache'` written to `fs_2b1_orphan_backfill_audit`. AMS Snowflake & AMS API hydration (3B.6-bootstrap) **no longer needed** — Holman cache covers everything. | 0.1d |
| 3B.6 | AMS webhook + outbox + opt-in tiered reads | 1d |
| 3B.6-bootstrap | **(SKIPPED — not needed after 3B.4-bootstrap finding.)** | 0d |
| 3B.6-ghost-triage | **(SKIPPED — 0 ghosts found.)** Empty `fs_2b1_ghost_triage` table created for forward compatibility (in case future drift introduces ghosts). | 0d |
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
