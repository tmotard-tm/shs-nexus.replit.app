# Tool Recovery Feature Specification

> Authoritative reference for building semi-automated tool recovery into the Nexus Assets Management system.

---

## Section 1 — Current Architecture Summary

**Stack:** React + TypeScript frontend (Vite, Tailwind, Shadcn UI, Wouter routing, TanStack Query), Express + TypeScript backend, PostgreSQL via Drizzle ORM (Neon), Passport.js auth (SAML SSO).

**Core schema (`shared/schema.ts`):**

- `queue_items` table (line 226) — central task table for all departments (NTAO, Assets Management, Inventory Control, Fleet Management). Contains the 6 task booleans at lines 259-264: `taskToolsReturn`, `taskIphoneReturn`, `taskDisconnectedLine`, `taskDisconnectedMPayment`, `taskCloseSegnoOrders`, `taskCreateShippingLabel`. Also has `data` (JSON text), `metadata` (JSON text), `notes`, `workflowId`, `workflowStep`, `dependsOn`, `autoTrigger`, `assignedTo`, `status`, `department`, `carrier`, `toolAuditNotificationSent`/`toolAuditNotificationSentAt`, and phone recovery fields (lines 270-286).
- `termed_techs` table (line 415) — Snowflake-synced terminated technicians with `lastDayWorked` (line 421), `offboardingTaskCreated`, `offboardingTaskId`.
- `all_techs` table (line 448) — unified employee roster with `lastDayWorked` (line 463), contact info (home address, phone numbers at lines 465-472), `offboardingTaskCreated`/`offboardingTaskId`.
- `communication_templates` table (line 1769) — stores email/SMS templates with `mode` (simulated/whitelisted/live), `subject`, `htmlContent`, `textContent`, `variables`.
- `communication_whitelist` table (line 1795) — controls which recipients can receive messages in non-live mode.
- `communication_logs` table (line 1816) — audit trail for all sent/simulated/blocked messages.

**Storage layer (`server/storage.ts`):**

- Interface `IStorage` (lines 112-438) defines all CRUD contracts.
- `DatabaseStorage` implementation starts at line 3499.
- Key methods: `createAssetsQueueItem`, `updateAssetsQueueItem`, `completeAssetsQueueItem` (line 1821 and 4448), `updateAssetsQueueProgress` (line 2065 and 4621 — updates the 6 task booleans + carrier + fleetRoutingDecision), `completeUnifiedQueueItem` (line 2681 and 5031 — routes to department-specific completion), `getTermedTechsNeedingOffboarding`, `checkOffboardingTaskDuplicates`, `markEmployeeOffboardingCreated`.

**Routes (`server/routes.ts`):**

- Assets queue CRUD: `GET/POST /api/assets-queue`, `GET /api/assets-queue/:id`, `PATCH /api/assets-queue/:id/assign`, `PATCH /api/assets-queue/:id/complete`, `PATCH /api/assets-queue/:id/save-progress`, `PATCH /api/assets-queue/:id/notes`
- Tool audit notification: `POST /api/assets-queue/:id/send-tool-audit` (line 2450) — uses `notification-service.ts` `sendToolAuditNotification`
- Unified offboarding: `GET /api/unified-offboarding/techs`, `GET /api/unified-offboarding/tech/:workflowId`, `PATCH /api/unified-offboarding/task/:taskId`, `POST /api/unified-offboarding/task/:taskId/contact-log`
- Auth middleware: `requireAuth` function (line 408) guards all non-public routes.

**Offboarding task creation (`server/create-offboarding-tasks-service.ts`):**

- `createOffboardingQueueTasks()` (line 84) — creates Day 0 tasks across 5 departments (NTAO step 1, Assets step 2, Fleet step 3, Inventory step 4, Phone step 5) linked by `workflowId` and `workflowStep`.
- Each task is titled "Day 0: ..." and includes department-specific instructions.

**Frontend components:**

- `client/src/pages/assets-queue.tsx` — Assets queue page
- `client/src/components/assets-queue/AssetsRecoveryQueue.tsx` — main queue component with inline task checklist, filters (Company/BYOV/Rental), progress tracking
- `client/src/components/assets-queue/AssetsTaskDetailView.tsx` — detail panel with 6-task checklist, Segno "View in Segno" button (currently disabled with "Coming Soon" badge), carrier selection, contact info
- `client/src/components/assets-queue/tech-data-utils.tsx` — utility for parsing/enriching tech data
- `client/src/pages/weekly-offboarding.tsx` — term roster management
- `client/src/pages/offboarding-queue.tsx` — cross-department offboarding dashboard
- `client/src/pages/queue-management.tsx` — high-level queue overview

**Services:**

- `server/notification-service.ts` — `sendToolAuditNotification()` sends email via communication templates
- `server/communication-service.ts` — general messaging infrastructure
- `server/email-service.ts` — SendGrid integration
- `server/snowflake-sync-service.ts` — data sync from Snowflake warehouse
- `server/sync-scheduler.ts` — background sync scheduling
- `server/create-offboarding-tasks-service.ts` — Day 0 task fan-out

---

## Section 2 — Build Goal

**Deliverable A: Automated Messaging / Outreach with Public Return Landing Page**

- Extend the existing `communication_templates` and `communication_logs` infrastructure to support automated, lane-aware outreach sequences (email and/or SMS).
- Each detection lane (PRE, WARM, LATE, COLD) drives a different message cadence and tone.
- Outreach is triggered automatically based on lane transitions or manually by an agent.
- A public (no-auth) return landing page at `/offboarding/return` allows terminated technicians to self-service: confirm return intent, upload photos of tools/equipment, provide shipping details. This page requires NO login — it is accessed via a tokenized link sent in outreach messages.
- The landing page writes data back to the relevant `queue_items` record (via a public API endpoint protected by token, not session auth).

**Deliverable B: Semi-Automated Assets Management Queue with Automation Badges and Detection Lane Logic**

- Enhance the existing Assets Management queue (NOT a new queue) with visual detection lane indicators (PRE/WARM/LATE/COLD badges) on each queue item.
- Add automation badges showing which actions were performed automatically (e.g., "Auto-emailed", "Label sent", "Segno checked") vs. manually.
- Detection lane logic runs on the server and updates lane classification on each queue item as time passes.
- Lane-specific automation rules: e.g., PRE lane auto-sends first outreach; WARM lane escalates cadence; LATE lane flags for supervisor review; COLD lane triggers write-off advisory.

---

## Section 3 — Detection Lane Model

Lanes are calculated from: `daysSinceLastDay = today - lastDayWorked` (sourced from `termed_techs.lastDayWorked` or `all_techs.lastDayWorked`). If `lastDayWorked` is null, fall back to `queue_items.createdAt`.

| Lane | Range | Meaning |
|------|-------|---------|
| PRE  | daysSinceLastDay < 0 | Before last day — proactive outreach window |
| WARM | 0 ≤ daysSinceLastDay ≤ 7 | First week after departure — highest recovery probability |
| LATE | 8 ≤ daysSinceLastDay ≤ 30 | Second through fourth week — declining recovery probability |
| COLD | daysSinceLastDay > 30 | Over 30 days — low probability, write-off advisory territory |

Lane is a computed field, not stored. It is derived at query time or via a periodic background job that tags `queue_items.metadata` with the current lane for UI display. A JSONB field on `queue_items` (e.g., `automationDetail`) stores structured automation history (messages sent, auto-actions taken, lane transitions) without altering the 6 existing task booleans.

---

## Section 4 — Core Rules

1. **Use the existing Assets Management queue** — all tool recovery work lives in `queue_items` with `department = 'Assets Management'`. No new queue tables.
2. **Preserve Day 0 completion and Phase 2 trigger** — the existing `createOffboardingQueueTasks()` fan-out (creating linked Day 0 tasks across NTAO/Assets/Fleet/Inventory/Phone with `workflowStep` 1-5) must not be altered. Tool recovery automation layers on top of, not replaces, the Day 0 flow.
3. **Don't invent external endpoints** — any integration not already wired (e.g., Segno API, carrier APIs) must be mocked with a clear interface. Existing integrations: SendGrid (email), Snowflake (sync), Holman (fleet), TPMS/Samsara (telematics).
4. **Return landing page is PUBLIC** — `/offboarding/return` and its API counterpart must NOT use `requireAuth`. Access is controlled by a unique, expiring token embedded in outreach links. Validate token server-side; reject expired or consumed tokens.
5. **Vendor-check advisory on Segno task** — the "Close Segno Orders" task (`taskCloseSegnoOrders`) in `AssetsTaskDetailView.tsx` currently shows a disabled "View in Segno" button with a "Coming Soon" badge. The tool recovery feature must add a persistent advisory banner/note on this task reminding the agent to verify vendor orders before marking complete. This is UI-only — no Segno API integration.
6. **Keep 6 existing task booleans as completion contract** — `taskToolsReturn`, `taskIphoneReturn`, `taskDisconnectedLine`, `taskDisconnectedMPayment`, `taskCloseSegnoOrders`, `taskCreateShippingLabel` remain the source of truth for task completion. A new JSONB column (e.g., `automation_detail`) on `queue_items` stores automation metadata (lane history, outreach log references, auto-action timestamps) without interfering with the boolean checklist. The `updateAssetsQueueProgress` storage method signature does not change.

---

## Section 5 — Protected Files

These files own shared completion logic, auth, or creation flows. Changes here affect multiple features and must be carefully scoped:

- `shared/schema.ts` — single source of truth for all database types and table definitions
- `server/storage.ts` — `IStorage` interface (lines 112-438) and `DatabaseStorage` implementation; owns `completeAssetsQueueItem`, `updateAssetsQueueProgress`, `completeUnifiedQueueItem`
- `server/routes.ts` — API surface and `requireAuth` middleware (line 408); all assets-queue endpoints
- `server/create-offboarding-tasks-service.ts` — Day 0 task creation fan-out; `createOffboardingQueueTasks()` must not be broken
- `server/index.ts` — server bootstrap, sync scheduler initialization, middleware chain
- `client/src/App.tsx` — route registration; adding `/offboarding/return` here (public route, outside auth wrapper)

---

## Section 6 — Serialized Zones (must not be edited in parallel)

These files are high-contention and must be edited by one task at a time to avoid merge conflicts and logical inconsistencies:

- `shared/schema.ts` — adding `automationDetail` JSONB column to `queue_items`; any schema change
- `server/storage.ts` — extending `IStorage` interface and `DatabaseStorage` with new methods
- `server/routes.ts` — adding new API endpoints
- `server/create-offboarding-tasks-service.ts` — if modifying task creation data shape
- `server/sync-scheduler.ts` — if adding new scheduled jobs (e.g., lane recalculation cron)
- `server/snowflake-sync-service.ts` — if modifying sync data flow

---

## Section 7 — Parallel-Safe Zones (safe for concurrent UI work)

These files are isolated enough that multiple developers/tasks can work on them simultaneously without conflict:

- `client/src/components/assets-queue/AssetsRecoveryQueue.tsx` — queue list UI (lane badges, automation indicators)
- `client/src/components/assets-queue/AssetsTaskDetailView.tsx` — detail panel UI (vendor-check advisory, automation detail panel)
- `client/src/components/assets-queue/tech-data-utils.tsx` — tech data enrichment utilities
- `client/src/pages/assets-queue.tsx` — page-level layout for assets queue
- New files for the return landing page (e.g., `client/src/pages/offboarding-return.tsx`) — entirely new, no conflict risk
- New service files (e.g., `server/lane-detection-service.ts`, `server/tool-recovery-automation-service.ts`) — new modules, no conflict
- `server/notification-service.ts` — adding new notification types alongside existing `sendToolAuditNotification`
- `server/communication-service.ts` — extending messaging capabilities
- `server/email-service.ts` — adding new email templates/methods
