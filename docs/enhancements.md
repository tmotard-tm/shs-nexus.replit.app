# Enhancements & Bug Fixes Log

## 2026-02-13

### Bugs Fixed

| Issue | Description | Resolution |
|-------|-------------|------------|
| Whitelist email routing | Whitelist mode only sent to original recipient if on whitelist | Now sends TO all whitelisted addresses with `[TEST - Original recipient: ...]` subject prefix |
| Legal compliance | Communication templates contained "payroll adjustments/deductions" language | Removed payroll-related language from all user-facing templates |

### Enhancements Made

| Enhancement | Description |
|-------------|-------------|
| Vehicle Disposition | Replaced manual Routing radio buttons with read-only Disposition badge from `vehicle_nexus_data.postOffboardedStatus` |
| Disposition column | Assets Queue table column renamed from "Routing" to "Disposition" with batch-fetched vehicle data |
| Communication Hub nav | Moved from standalone sidebar item into Activity section for better organization |
| Code cleanup | Removed unused `RoutingDestination` type, `getRouting()` function, and 7 unused screenshot images |

### Technical Debt Identified

| Item | Priority | Notes |
|------|----------|-------|
| Consolidate tech-data parsing | Medium | Carried forward — Tools and Assets queues both parse enriched tech data |
| No Zod validation on communication routes | Medium | Carried forward |
| SMS not implemented | Medium | Carried forward — needs Twilio integration |

---

## 2026-02-11

### Bugs Fixed

| Issue | Description | Resolution |
|-------|-------------|------------|
| Employee matching misses | Case and whitespace differences caused missed matches during Snowflake sync | Normalized names with trim/lowercase before comparison |

### Enhancements Made

| Enhancement | Description |
|-------------|-------------|
| Assets Queue table redesign | Rebuilt from scratch as table with expandable inline rows, matching Tools Queue pattern |
| NTAO-style card header | Wrapped Assets Queue with collapsible Card header for visual consistency across all queues |
| Fleet Separation source detection | `getItemSource()` classifies items as "fleet_separation" or "manual" based on metadata |
| Include Manual filter | Defaults to off; hides test/manual items to show only real separation requests |
| Split Pick Up / Assign | "Pick Up" auto-assigns to self; "Assign" opens user selection dialog |
| Owner column filter | Dropdown filter on onboarding table owner column |

### Technical Debt Identified

| Item | Priority | Notes |
|------|----------|-------|
| Consolidate tech-data parsing | Medium | Tools and Assets queues both parse enriched tech data; consider shared utility |
| No Zod validation on communication routes | Medium | Carried forward from previous sessions |
| SMS not implemented | Medium | Carried forward - needs Twilio integration |

---

## 2026-02-06

### Bugs Fixed

| Issue | Description | Resolution |
|-------|-------------|------------|
| Duplicate Tools tasks | Two systems (sync service + GET handler) created tasks for same employees | Consolidated creation into sync service only; GET handler now read-only |
| Cross-format dedup failure | Duplicate detection only checked one data structure format | Updated to check both `employee.*` and `technician.*` paths |
| Sparse Day 0 format for Tools | Sync service created sparse "Day 0" tasks missing HR data | Changed to "Tools Queue -" format with full separation data |

### Enhancements Made

| Enhancement | Description |
|-------------|-------------|
| Single source of truth | Tools task creation now only happens in Snowflake sync service (scheduled, predictable) |
| Rich HR data in tasks | Tools tasks include employee name, ID, separation date, truck number, pickup address |
| Dev DB refresh script | Ran `scripts/refreshDevFromProd.js` to sync 32 tables from prod to dev |

### Technical Debt Identified

| Item | Priority | Notes |
|------|----------|-------|
| No Zod validation on communication routes | Medium | Add input validation for security |
| SMS not implemented | Medium | Shows as simulated - needs Twilio integration |
| Legacy Day 0 Tools tasks in DB | Low | One legacy "Day 0: Recover Equipment & Tools - ABALOS" task remains (no equivalent Tools Queue task exists) |

---

## 2026-02-05

### Bugs Fixed

| Issue | Description | Resolution |
|-------|-------------|------------|
| Circular import | email-service.ts and communication-service.ts had circular dependency | Created notification-service.ts to hold sendToolAuditNotification |

### Enhancements Made

| Enhancement | Description |
|-------------|-------------|
| Communication Hub | Centralized template management with mode control (simulated/whitelisted/live) |
| Developer-only access | All /api/communication/* routes enforce developer role at backend level |
| Template preview | Live preview with variable substitution in Communication Hub |
| Whitelist manager | Add/remove test emails and phones for safe testing |
| Send history | Filterable log of all sent/simulated messages |

### Technical Debt Identified

| Item | Priority | Notes |
|------|----------|-------|
| No Zod validation on communication routes | Medium | Add input validation for security |
| SMS not implemented | Medium | Shows as simulated - needs Twilio integration |
| No E2E tests for Communication Hub | Low | Consider Playwright tests |

---

## 2026-02-04

### Bugs Fixed

| Issue | Description | Resolution |
|-------|-------------|------------|
| Fragment metadata warning | React warning about invalid prop on Fragment | Known Replit dev tools injection issue - does not affect functionality |

### Enhancements Made

| Enhancement | Description |
|-------------|-------------|
| Tools Recovery Queue Redesign | Complete UI overhaul from card tabs to table with expandable rows |
| Urgency Matrix | Vehicle Type + Days Until Separation determines CRITICAL/HIGH/STANDARD urgency |
| Data Enrichment | Backend enriches queue items with technician district/contact from all_techs |
| Enhanced Filtering | Search, multi-select filters (status, vehicle, district), Incomplete Only toggle |
| Auto-Save System | 500ms debounced saves for task checkboxes and routing selections |
| Incomplete Task Warning | Dialog warns when completing workflow with incomplete tasks |
| Self-Assign Feature | Users can assign tasks to themselves with one click |

### Technical Debt Identified

| Item | Priority | Notes |
|------|----------|-------|
| No automated E2E tests for new queue | Medium | Consider Playwright tests for expandable row interactions |
| Fragment warning in dev | Low | Caused by Replit dev tools, not a real issue |

---

## 2026-02-02

### Bugs Fixed

| Issue | Description | Resolution |
|-------|-------------|------------|
| Phase 2 trigger blocked | `triggerNextWorkflowStep()` had early return on missing `workflowStep` | Moved Day 0 task check before workflowStep requirement |
| Routing decision not persisting | `/api/tools-queue/:id/assign` not saving `fleetRoutingDecision` | Updated endpoint to save routing and clear blockedActions |
| Phase 2 task titles show "undefined" | techName not extracted from trigger data | Added fallback chain for techName, vehicleNumber, employeeId |
| currentBlockingStatus missing in /api/queues | Tools items didn't show blocking status | Added dynamic computation matching tools-queue endpoint |

### Enhancements Made

| Enhancement | Description |
|-------------|-------------|
| Tools Queue Page | New `/tools-queue` page with 5 specialized task card variants |
| Routing-Specific Badges | PMF (blue), Pep Boys (red), Reassigned (purple), Blocked (yellow) |
| Phase 2 Trigger Chain | All 5 Day 0 tasks (NTAO, Assets, Fleet, Inventory, Tools) check before Phase 2 |
| DatabaseStorage Parity | Added all workflow automation methods to DatabaseStorage class |

### Technical Debt Identified

| Item | Priority | Notes |
|------|----------|-------|
| No automated tests for Phase 2 trigger | Medium | Consider adding integration tests |
| Legacy workflows using workflowStep | Low | Ensure regression testing for older workflows |
| BYOV unit tests still needed | Low | Add automated tests for byov-utils.ts |

---

## 2026-01-30

### Bugs Fixed

| Issue | Description | Resolution |
|-------|-------------|------------|
| Field name mismatch | Code used `assigneeId` but schema has `assignedTo` | Changed to use correct field `assignedTo` |
| Module validation | "tools" not recognized in unified queues API | Added "tools" to `validModules` array in routes.ts |

### Enhancements Made

| Enhancement | Description |
|-------------|-------------|
| Dynamic blocking status | GET `/api/tools-queue/:id` now returns `currentBlockingStatus` computed at runtime |
| BYOV detection utility | New `server/byov-utils.ts` with reusable detection and status functions |

### Technical Debt Identified

| Item | Priority | Notes |
|------|----------|-------|
| List endpoint missing blocking status | ✅ Fixed | Sprint 3 added `currentBlockingStatus` to list endpoint |
| No automated tests for BYOV logic | Low | Consider adding unit tests for byov-utils.ts |

---

## Previous Sessions

*(Add older entries here as sessions accumulate)*
