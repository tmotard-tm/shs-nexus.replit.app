# Enhancements & Bug Fixes Log

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
| List endpoint missing blocking status | Medium | Sprint 3 will add `currentBlockingStatus` to list endpoint |
| No automated tests for BYOV logic | Low | Consider adding unit tests for byov-utils.ts |

---

## Previous Sessions

*(Add older entries here as sessions accumulate)*
