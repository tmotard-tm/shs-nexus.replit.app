# RESUME — Pre-Offline Handoff

> **Created:** 2026-04-26T00:50Z (Kirk losing internet)
> **Active phase:** Nexus end-to-end review — pause window between 2A.5 close and 2B.1.d–f writer migration.
> **Pre-offline checkpoint commit:** `58a384c9fa1fcf8686e01ef1ac85fd649497a3af`
> **Anchor file (machine-readable):** `docs/cutover-anchor.json`
> **Locked plan doc:** `docs/end-to-end-review.md`

---

## ⏰ Time anchors

| Marker          | UTC ISO                       | Notes                                                          |
|-----------------|-------------------------------|----------------------------------------------------------------|
| **T0 anchor**   | `2026-04-25T22:50:06.000Z`    | Captured at boot of 2B.1 drift cron; immutable.                |
| **Cutover**     | `2026-04-26T22:50:06.000Z`    | T0 + 24h. Manual trigger. Pause window ends here.              |
| **Now (handoff)** | `2026-04-26T00:50Z` (approx) | T0 + ~2h.                                                      |

## 📸 Drift snapshot schedule

In-process cron (`server/2b1-drift-cron.ts`) wired in `server/index.ts` listen callback. **Current cron PID: 173067** (tsx parent of server/index.ts). Critical: this is in-process node-cron — **dies if Replit workspace sleeps**. On resume, read `docs/cutover-anchor.json` and re-arm any missed snapshots.

| # | Anchor   | Scheduled at (UTC ISO)         | Cron expr           | Status     |
|---|----------|--------------------------------|---------------------|------------|
| 1 | T0 + 6h  | `2026-04-26T04:50:06.000Z`     | `50 4 26 4 *`       | scheduled  |
| 2 | T0 + 12h | `2026-04-26T10:50:06.000Z`     | `50 10 26 4 *`      | scheduled  |
| 3 | T0 + 18h | `2026-04-26T16:50:06.000Z`     | `50 16 26 4 *`      | scheduled  |

Snapshot definition: read-only POS/inventory/AMS drift counts vs T0 baseline; appended to `docs/end-to-end-review.md` drift telemetry block. **Anomaly threshold: 5% drift** (delta count vs T0 baseline) → if exceeded, surface in resume report and DO NOT auto-cutover.

## ⚠️ Workspace-sleep recovery procedure

If Replit workspace sleeps and `Start application` workflow restarts after the boot timestamp recorded in `docs/cutover-anchor.json`:

1. Read `docs/cutover-anchor.json` for the snapshot schedule.
2. For each snapshot whose scheduled time has passed and whose status is still `"scheduled"`, manually invoke the drift script (`server/2b1-drift-cron.ts` exports `runDriftSnapshot(label)` — call it with the missed labels in order).
3. Update each entry's `status` in `docs/cutover-anchor.json` to `"completed"` (or `"missed-then-recovered"` if reconstructed after the fact).
4. If 2+ snapshots are missed and the gap to cutover is < 6h, halt: do not cutover without at least one fresh snapshot inside the cutover window.

---

## ✅ Completed phases

| Phase | What landed | Status |
|---|---|---|
| **2A.1** | UVP scaffolding (`UniversalVehiclePanel.tsx`) + Overview tab | DONE |
| **2A.2** | Service tab + Assignments tab | DONE |
| **2A.3** | Inventory tab + Telematics tab (absorbed legacy ViewInventoryButton + TelematicsButton dialog surfaces) | DONE |
| **2A.4** | Inline drawer absorption matrix; #9 additive UVP drilldown DONE; #8 deferred → 2A.5 | DONE |
| **2A.5** | UVP Operations tab (AMS write surface + ops triggers); Steps 1–5 + **Step 6 (fleet-management.tsx drawer migration)** | DONE |
| **2A.5 Option A (caller-cleanup pass)** | Migrated 5 call sites off legacy `<ViewInventoryButton>` (vehicle-assignments / update-vehicle / active-vehicles / queue-item-data-template) + folded D (fleet-management row-card `<ViewInventoryButton>` + `<TelematicsButton>` quick-jumps). Architect rounds 1+2 PASS (1 High ghost-row regression fixed, 1 Medium scroll fix applied). | DONE |
| **2B.1.a** | New `fs_pos_v2` table family + Drizzle schema | DONE |
| **2B.1.b** | Reader migration (read paths use `fs_pos_v2` with fallback to legacy) | DONE |
| **2B.1.c** | Cutover dry-run telemetry + drift cron infrastructure | DONE |
| **3B.4-bootstrap** | BaseTieredVendorAdapter scaffolding | DONE |
| **3B.5-bootstrap (revised)** | Tiered vendor adapter routing skeleton | DONE |
| **fs_2b1_ghost_triage** | Ghost-row triage report (rental/decommissioned subset) | DONE |

## ⏸️ Phases SKIPPED (intentionally)

| Phase | Reason |
|---|---|
| **3B.6 bootstrap** | Skipped — bundled into 3B.6 main delivery post-cutover. |

## 🚧 Pending phases (in dependency order)

### Cutover-blocked (must wait for T0+24h)
- **2B.1.d** — POS writer migration to `fs_pos_v2` (design DONE; impl BLOCKED until cutover. Pause-safe constraint forbids fs_trucks/fs_truck_state writes; writer migration is the primary thing the constraint blocks.)
- **2B.1.e** — Legacy POS table read-path drop
- **2B.1.f** — Legacy POS table physical drop

### Pause-safe (could start before cutover if more time were available)
- **2B.2** — Inventory snapshot table family migration (design memo DEFERRED — paper-plan only after empirical 2B.1 lands)
- **2B.3** — AMS write-mirror table family migration (design memo DEFERRED — same rationale)
- **2C** — Cross-table integrity scrub + orphan reconciliation
- **3A.1** — UVP cross-tab state preservation (paper plan only — wait until 2B.1 lands so plan is empirical)
- **3A.2** — UVP keyboard nav + a11y pass (same)
- **3A.3** — UVP audit-trail surface (same)
- **3A.4** — UVP saved-views (same)
- **3B.1** — TelematicsTab → BaseTieredVendorAdapter (Snowflake T1 → integration_events T2 → live API T3 with FieldProvenanceBadge)
- **3B.2** — InventoryTab → tiered adapter
- **3B.3** — ServiceTab → tiered adapter
- **3B.5** (main) — Tiered vendor routing, full delivery
- **3B.6** (main) — FieldProvenanceBadge UI rollout
- **3B.7** — Tier promotion job (T3 → T2 backfill)

### Security backlog (post-cutover triage)
- **SEC-1** — SQL injection risk via interpolated `vehicleNumber` in raw SQL on `GET /api/holman/pos/:vehicleNumber`. Fix: parameterize with bind params. Location: `server/routes.ts:16185-16213`. Severity: High. Status: OPEN — triage post-cutover.

---

## 🔒 Locked decisions (Kirk, immutable until end of review)

1. **TPMS SoR.** TPMS data system-of-record stays in `fs_trucks` / `fs_truck_state` family — NOT split into a separate TPMS table. (Decided after Phase 1 SoR audit: cardinality 1:1 with truck and read patterns are always co-keyed with truck identity.)
2. **SendGrid one account.** All outbound email goes through a SINGLE SendGrid account/API key. Per-vendor sub-accounts rejected: simpler key rotation, single deliverability reputation to monitor, easier audit trail. (Decided after vendor-isolation discussion in 3A planning.)
3. **Persist review.** UVP review state (audit trail of who viewed/edited a vehicle and when) PERSISTS across sessions in a dedicated `fs_uvp_review_log` table — not a session-scoped in-memory cache. (Decided to support compliance review windows that may exceed user session length.)
4. **Kickoff.** Cutover kickoff is MANUAL at T0+24h (`2026-04-26T22:50:06.000Z`); no auto-cutover even if all drift snapshots are clean. Operator-in-the-loop confirmation required. (Decided to preserve human-in-loop sign-off on the irreversible writer-migration step.)
5. **NetSuite via WMS, NOT Snowflake.** NetSuite costs/inventory data sourced through the WMS engine three-layer adapter (`server/wms-engine-service.ts`) — NOT directly from Snowflake. (Decided after 2A.3 architect review: WMS already normalizes the `useCase` vs `useCaseId` spelling split and provides the canonical adapter surface; Snowflake direct read would duplicate that normalization and create a second source of truth.)

---

## 🛡️ Pause-safe constraint (active until cutover)

**Rule:** No new code path may write to `fs_trucks` or `fs_truck_state` between T0 and cutover (`2026-04-26T22:50:06.000Z`).

**Rationale:** The cutover at T0+24h flips the writer migration to the new `fs_pos_v2` table family. Concurrent writes to the legacy tables during the drift window would invalidate the drift baseline and risk write-loss across the cutover boundary. All Phase 2A.5 work (UVP build-out + caller cleanup) was deliberately scoped to read paths only + UI-state plumbing.

**Verified compliant work during pause:**
- 2A.5 Steps 1–6 (UVP Operations tab + fleet-management drawer migration) — UI state plumbing only.
- 2A.5 Option A caller-cleanup (5 files migrated off legacy buttons) — client-side caller rewiring + 2 read-only inline UVP sections (OnTruckInventory + TelematicsTab).
- Drift cron + telemetry — read-only.

**Forbidden during pause (do NOT do these on resume until after cutover):**
- 2B.1.d writer migration (the cutover IS this).
- Any legacy POS table write that is not part of the cutover script.
- Any `fs_trucks` / `fs_truck_state` write outside the existing reader paths.

---

## 📦 Resume sequence (when Kirk reconnects)

1. **Read this file + `docs/cutover-anchor.json`.**
2. **Inspect drift snapshots:** check `status` for the 3 entries; run workspace-sleep recovery procedure above if any are still `"scheduled"` past their scheduled time.
3. **If now < cutover** (`2026-04-26T22:50:06.000Z`): pause window still active. Pick up next pause-safe work item from the pending list (2B.2 design memo, 2C scrub, or 3A paper plans now that 2B.1 is empirical).
4. **If now >= cutover:** cutover gate is open. Confirm with Kirk before triggering the manual writer migration (decision #4 — manual kickoff). After cutover lands, unblock 2B.1.e/f and the rest of the pending phases.

---

## 📋 In-flight (idle, awaiting Kirk)

Nothing in flight at handoff time. Last action: 2A.5 Option A architect round 2 PASS + Medium scroll fix applied + plan doc updated. Ready for next pause-safe item or cutover.
