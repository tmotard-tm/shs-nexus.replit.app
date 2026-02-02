# Enhancements & Bug Fixes Log

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
