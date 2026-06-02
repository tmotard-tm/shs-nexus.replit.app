---
name: LOA Recovery queue-item data shape vs. Assets queue parser
description: Why LOA Recovery cases can silently vanish from the Assets Management queue UI even when the rows exist in queue_items.
---

# LOA Recovery items use a different data shape than offboarding items

LOA Recovery queue_items (workflowType `loa_recovery`, requesterId
`system:loa_recovery`) are written by the LOA sync service with a FLAT data
shape: `{ enterpriseId, techName, employeeNumber, leave:{startDate,endDate,days,
sfStatus}, tech:{lastKnownTruck,phone,primaryZip,address:{...}}, lane }`.

Offboarding items use a WRAPPED shape: `data.technician` / `data.employee`,
plus `data.source` = `snowflake_sync` / `hr_separation` / `hr_separation_sync`.

**The trap:** the Assets Management queue UI was written only for the wrapped
shape, so LOA items were silently dropped from the UI even though the rows
existed in the DB:
- `isItemFromSync()` returned false (no `data.source`), so with the default
  "Include Manual" toggle OFF, LOA items were filtered out entirely.
- `parseTechData()` only read `data.technician`/`data.employee`, returning
  `undefined` for LOA items — blanking name/ID columns and breaking
  search-by-name/ID and the district filter.

**Why:** the LOA sync was built independently and never aligned to the queue
UI's parser/filter conventions; the incompatibility stayed hidden because the
sync crashed on every run (missing `loa_recovery_snapshot` table) until that
was fixed, so no LOA items ever reached the UI to expose it.

**How to apply:** any new automated queue source must EITHER emit the
offboarding-compatible shape (`data.technician` wrapper + a recognized
`data.source`) OR be explicitly taught to both `isItemFromSync()` and
`parseTechData()` in `client/src/components/assets-queue/`. When debugging
"rows exist in queue_items but the queue UI shows none," check the client
source-filter and tech-data parser before suspecting the API/date filters.

# Two detail renderers: offboarding vs LOA must be routed by workflowType

There are two completely separate detail experiences for a queue item:
- Offboarding: the assets queue's own `AssetsTaskDetailView` (full-page) and
  `ExpandedRowDetails` (inline) render a hardcoded 6-task offboarding checklist.
- LOA Recovery: `client/src/components/loa-recovery/LoaDetailView.tsx` renders
  the per-queue LOA checklist defined in `loa-checklist-config.ts`
  (fleet/assets/inventory subsets) and infers vehicle type (Company/Rental/BYOV).

The unified `queue-management` page already routes correctly via a
`selectedWorkflowType` toggle (loa_recovery -> `LoaRecoveryTable`/`LoaDetailView`).
But the standalone Assets queue (`AssetsRecoveryQueue`, also embedded in
queue-management when the toggle is NOT loa_recovery) renders every item with the
offboarding detail view. So an LOA case that is merely made *visible* there will
still show offboarding tasks and no LOA label unless the detail render paths are
branched on `workflowType === 'loa_recovery' || requesterId === 'system:loa_recovery'`.

**Why:** making an LOA item visible (the parser/filter fix above) is necessary but
not sufficient — visibility and rendering are separate concerns with separate code.

**How to apply:** when an LOA case "appears but shows offboarding tasks," branch
the queue's detail renderers to `LoaDetailView` (pass `queue="assets"|"fleet"|
"inventory"` and the LOA-filtered items as `allItems`). `LoaDetailView` is an inline
panel with no back button — wrap it when used as a full-page takeover. Reuse the
existing `LOA_CHECKLIST` in `loa-checklist-config.ts`; do not duplicate task lists.

# "Days on LOA" displays the source leave length, not elapsed days

The LOA UI ("Days on LOA" on both `LoaDetailView` and `LoaRecoveryTable`) shows
`data.leave.days` — the authoritative leave length from the Reports API, the same
value the sync uses to qualify leaves at `MIN_DAYS = 30`. Do NOT recompute it from
the start date with `daysOnLoa()` (days-elapsed): leaves are frequently future-dated
(start in a few weeks), so elapsed-days reads 0 for a qualifying 30+ day leave and
makes a valid case look like it shouldn't be there.

**Why:** a user flagged a 32-day upcoming leave (start Aug 3 / return Sep 4) showing
"0 days." Elapsed-since-start is the wrong metric for an upcoming-but-qualifying leave.

**How to apply:** trust the server-provided `days` field for display and gating; the
30-day floor is enforced server-side in `loa-recovery-sync-service.ts`, not the client.
