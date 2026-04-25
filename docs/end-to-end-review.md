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
