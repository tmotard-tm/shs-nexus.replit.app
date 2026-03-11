# Fleet Scope — Complete Application Summary

**Last Updated:** March 11, 2026

Fleet Scope is a web application that tracks and manages ~2,100+ Sears Home Services vans undergoing repair. It replaced a legacy spreadsheet system, providing real-time status tracking, repair location management, detailed vehicle information, automated workflows, and an audit trail. The app integrates with 12 external systems and exposes 153 API endpoints across 19 frontend pages.

---

## 1. Pages (19 Total)

| # | Page | Route | Description |
|---|---|---|---|
| 1 | Profile Selection | `/profile` | Choose user identity — gates access to all other pages |
| 2 | Fleet Vehicle Table | `/` (home) | Full fleet overview of 2,100+ vehicles combining Snowflake, Samsara GPS, Holman odometer, and spare assignment data |
| 3 | Dashboard | `/dashboard` | Core repair tracking — inline editing, multi-select column filters, status badges, BYOV labels, bulk import/export |
| 4 | Action Tracker | `/action-tracker` | Trucks grouped by assigned owner with workload counts and task prioritization |
| 5 | Executive Summary | `/executive-summary` | Visual cards summarizing truck counts by main status and sub status |
| 6 | Metrics | `/metrics` | KPI tracking with manual snapshot capture, historical trends, and weekly comparisons |
| 7 | Holman Research | `/holman-research` | Research tool for querying Holman scraper data on individual vehicles |
| 8 | Park My Fleet (PMF) | `/pmf` | PMF vehicles synced with PARQ API — status events, activity logs, lot assignments |
| 9 | Tool Audit | `/pmf/tool-audit/:assetId` | Individual PMF vehicle tool and equipment audit with bulk export |
| 10 | Purchase Orders | `/pos` | PO imports, approval tracking, final approval workflow, priority tab for unpaid POs from Snowflake |
| 11 | Spares | `/spares` | Spare/unassigned vehicles from Snowflake — editable keys, repair status, contact, address, comments |
| 12 | Fleet Cost | `/fleet-cost` | Cost analytics via XLSX uploads — paid PO breakdowns, import history, approved cost tracking |
| 13 | Registration | `/registration` | Registration sticker/tag tracking with Twilio SMS conversations and scheduled messages |
| 14 | Decommissioning | `/decommissioning` | Vehicles approved for sale — tech/manager assignments from Snowflake, ZIP code fallback, distance calculations |
| 15 | Batch Caller | `/batch-caller` | ElevenLabs AI calling tool — batch calls to repair shops and technicians, call logs, follow-up scheduling |
| 16 | Today's Queue | `/queue` | Daily task queue for fleet operations prioritization |
| 17 | Vehicle Search | `/vehicle-search` | Cross-module vehicle lookup tool |
| 18 | Discrepancy Finder | `/discrepancies` | Finds data mismatches and inconsistencies across data sources |
| 19 | Raw POs | `/raw-pos/:truckNumber` | Detailed scraper data per vehicle — repair POs, rental POs, vendor details, AI recommendation, red flags |
| 20 | Truck Detail | `/trucks/:id` | Full vehicle detail page with collapsible accordion sections that auto-expand based on status |
| 21 | Add Truck | `/trucks/new` | Create new truck entry with validation |

---

## 2. Database Tables (32 Total)

### Core Data
| # | Table | Purpose |
|---|---|---|
| 1 | `trucks` | Core vehicle data — status, tech name, repair shop, dates, owner, rental info (~330 active rows) |
| 2 | `actions` | Audit trail — logs every significant field change with before/after diffs |
| 3 | `archived_trucks` | Historical truck records after archival |
| 4 | `truck_consolidations` | Records of truck number merges/consolidations |

### Tracking & Registration
| # | Table | Purpose |
|---|---|---|
| 5 | `tracking_records` | UPS/FedEx/USPS package tracking for registration shipments |
| 6 | `registration_tracking` | Per-vehicle registration sticker/renewal tracking |
| 7 | `reg_messages` | SMS messages for registration conversations (via Twilio) |
| 8 | `reg_scheduled_messages` | Queued/scheduled SMS messages |

### Park My Fleet (PMF)
| # | Table | Purpose |
|---|---|---|
| 9 | `pmf_imports` | PMF CSV import metadata |
| 10 | `pmf_rows` | Individual PMF vehicle records from imports |
| 11 | `pmf_status_events` | PMF vehicle status change history |
| 12 | `pmf_activity_logs` | PMF vehicle activity logs synced from PARQ API |
| 13 | `pmf_activity_sync_meta` | Tracks last PARQ activity log sync timestamp per vehicle |

### Purchase Orders & Cost
| # | Table | Purpose |
|---|---|---|
| 14 | `purchase_orders` | Imported POs with vendor, amount, approval status |
| 15 | `po_import_meta` | PO import batch metadata |
| 16 | `fleet_cost_records` | Fleet cost data from XLSX uploads |
| 17 | `fleet_cost_import_meta` | Fleet cost import batch metadata |
| 18 | `approved_cost_records` | Approved cost records (separate approval workflow) |
| 19 | `approved_cost_import_meta` | Approved cost import metadata |
| 20 | `vehicle_maintenance_costs` | Per-vehicle maintenance cost aggregations |

### Spares & Decommissioning
| # | Table | Purpose |
|---|---|---|
| 21 | `spare_vehicle_details` | Spare vehicle tracking — keys, repair status, contact, address, comments |
| 22 | `decommissioning_vehicles` | Vehicles in decommission workflow with tech/manager assignments and distance data |

### Metrics & Weekly Snapshots
| # | Table | Purpose |
|---|---|---|
| 23 | `metrics_snapshots` | Historical KPI snapshots captured daily or manually |
| 24 | `byov_weekly_snapshots` | Weekly BYOV (Bring Your Own Vehicle) enrollment snapshots |
| 25 | `pickup_weekly_snapshots` | Weekly pickup scheduling snapshots |
| 26 | `fleet_weekly_snapshots` | Weekly fleet status distribution snapshots |
| 27 | `pmf_status_weekly_snapshots` | Weekly PMF status distribution snapshots |
| 28 | `repair_weekly_snapshots` | Weekly repair pipeline snapshots |
| 29 | `rental_weekly_manual` | Manually entered weekly rental statistics |

### GPS & Location
| # | Table | Purpose |
|---|---|---|
| 30 | `samsara_locations` | Cached Samsara GPS locations for all vehicles |

### AI Calling
| # | Table | Purpose |
|---|---|---|
| 31 | `call_logs` | ElevenLabs AI call records — outcomes, transcripts, follow-ups |
| 32 | `rental_imports` | Rental reconciliation import history |

---

## 3. API Endpoints (153 Total)

### 3A. Public API — `/api/public/` (19 endpoints)

These are externally accessible endpoints. "API Key" means the `X-API-Key` header must match the `PUBLIC_SPARES_API_KEY` environment variable.

| # | Method | Endpoint | Auth | Data Source |
|---|---|---|---|---|
| 1 | GET | `/api/public` | Open | Index — lists all available public endpoints |
| 2 | GET | `/api/public/rentals` | Open | trucks table — all vehicles with status and repair info |
| 3 | GET | `/api/public/rentals/summary` | API Key | trucks table — computed summary (active, overdue, by region) |
| 4 | GET | `/api/public/rentals/:truckNumber` | Open | trucks table — single truck lookup |
| 5 | GET | `/api/public/registrations` | Open | trucks table — vehicle registration fields |
| 6 | GET | `/api/public/registrations/:truckNumber` | Open | trucks table — single truck registration |
| 7 | POST | `/api/public/spares/:vehicleNumber` | API Key | spare_vehicle_details — update spare vehicle fields |
| 8 | GET | `/api/public/spares` | API Key | spare_vehicle_details — all spare vehicles |
| 9 | GET | `/api/public/spares/:vehicleNumber` | API Key | spare_vehicle_details — single spare vehicle |
| 10 | GET | `/api/public/all-vehicles` | API Key | Snowflake + Samsara GPS + Holman odometer (~1,800 vehicles) |
| 11 | GET | `/api/public/pmf` | API Key | pmf_imports + pmf_rows tables |
| 12 | GET | `/api/public/pos` | API Key | purchase_orders table |
| 13 | GET | `/api/public/po-priority` | API Key | Snowflake Holman ETL (live query) |
| 14 | GET | `/api/public/decommissioning` | API Key | decommissioning_vehicles table |
| 15 | GET | `/api/public/fleet-cost` | API Key | fleet_cost_records (SQL aggregation) |
| 16 | GET | `/api/public/executive-summary` | API Key | trucks table — counts by main/sub status |
| 17 | GET | `/api/public/metrics` | API Key | trucks + metrics_snapshots (current + historical) |
| 18 | GET | `/api/public/action-tracker` | API Key | trucks table grouped by owner |
| 19 | GET | `/api/public/call-logs` | API Key | call_logs table |
| 20 | GET | `/api/public/follow-ups` | API Key | call_logs table (filtered to pending) |

### 3B. Internal API — Trucks & Dashboard (20 endpoints)

| # | Method | Endpoint | Purpose |
|---|---|---|---|
| 1 | GET | `/api/trucks` | List all trucks with optional filters |
| 2 | GET | `/api/trucks/:id` | Get single truck details |
| 3 | GET | `/api/trucks/:id/actions` | Get audit trail for a truck |
| 4 | GET | `/api/trucks/:id/tracking` | Get tracking records for a truck |
| 5 | GET | `/api/trucks/po-status` | PO status lookup via scraper |
| 6 | GET | `/api/trucks/scraper-status` | Batch scraper status for all trucks |
| 7 | GET | `/api/trucks/scraper-detail/:truckNumber` | Detailed scraper data for one truck |
| 8 | POST | `/api/trucks` | Create new truck |
| 9 | PUT | `/api/trucks/:id` | Update truck (full replace) |
| 10 | PATCH | `/api/trucks/:id` | Update truck (partial) |
| 11 | POST | `/api/trucks/call-import` | Import trucks from call data |
| 12 | POST | `/api/trucks/bulk-import` | Bulk CSV/Excel truck import |
| 13 | POST | `/api/trucks/bulk-sync` | Sync trucks with external data |
| 14 | POST | `/api/trucks/consolidate` | Merge/consolidate truck numbers |
| 15 | POST | `/api/trucks/update-reg-expiry` | Bulk update registration expiry dates |
| 16 | POST | `/api/trucks/update-bill-paid` | Bulk update bill paid status |
| 17 | POST | `/api/csv-import` | General CSV import |
| 18 | GET | `/api/truck-consolidations` | List truck consolidation history |
| 19 | GET | `/api/pickups-scheduled-this-week` | Pickups scheduled for current week |
| 20 | GET/PATCH | `/api/pickup-weekly-snapshots` | Weekly pickup snapshot data |

### 3C. Internal API — Batch Caller & AI Calls (8 endpoints)

| # | Method | Endpoint | Purpose |
|---|---|---|---|
| 1 | POST | `/api/trucks/:id/call-repair-shop` | ElevenLabs AI call to repair shop |
| 2 | POST | `/api/trucks/:id/call-technician` | ElevenLabs AI call to technician |
| 3 | POST | `/api/batch-call/start` | Start batch calling job |
| 4 | GET | `/api/batch-call/status/:batchId` | Check batch call progress |
| 5 | POST | `/api/batch-call/cancel/:batchId` | Cancel running batch |
| 6 | GET | `/api/call-logs` | All call logs |
| 7 | GET | `/api/call-logs/:truckId` | Call logs for specific truck |
| 8 | GET | `/api/follow-ups` | Pending follow-up calls |
| 9 | POST | `/api/elevenlabs/webhook` | ElevenLabs post-call webhook |

### 3D. Internal API — Snowflake (8 endpoints)

| # | Method | Endpoint | Purpose |
|---|---|---|---|
| 1 | GET | `/api/snowflake/test` | Test Snowflake connection |
| 2 | GET | `/api/snowflake/schema` | Get Snowflake table schemas |
| 3 | GET | `/api/snowflake/data` | Query Snowflake data |
| 4 | POST | `/api/snowflake/query` | Execute custom Snowflake query |
| 5 | POST | `/api/snowflake/sync-tech-data` | Sync technician data from TPMS_EXTRACT |
| 6 | POST | `/api/snowflake/sync-assigned-status` | Sync assigned status from Snowflake |
| 7 | POST | `/api/snowflake/sync-tech-state` | Sync tech state with AMS/XLS fallback |
| 8 | GET | `/api/snowflake/unassigned-vehicles` | Unassigned vehicles from Snowflake |
| 9 | GET | `/api/snowflake/spare-assignment-status` | Spare assignment status from Snowflake |

### 3E. Internal API — PMF / Park My Fleet (18 endpoints)

| # | Method | Endpoint | Purpose |
|---|---|---|---|
| 1 | GET | `/api/pmf` | List all PMF vehicles |
| 2 | GET | `/api/pmf/summary` | PMF summary statistics |
| 3 | POST | `/api/pmf/import` | Import PMF CSV data |
| 4 | GET | `/api/pmf/status-events` | PMF status change history |
| 5 | POST | `/api/pmf/status-events/backfill` | Backfill missing status events |
| 6 | GET | `/api/pmf/days-in-status` | Days each vehicle has been in current status |
| 7 | GET | `/api/pmf/registration-stickers-needed` | PMF vehicles needing registration stickers |
| 8 | GET | `/api/pmf/parq/test` | Test PARQ API connection |
| 9 | GET | `/api/pmf/parq/vehicles` | PARQ vehicles |
| 10 | GET | `/api/pmf/parq/statuses` | PARQ status definitions |
| 11 | GET | `/api/pmf/parq/lots` | PARQ lot locations |
| 12 | GET | `/api/pmf/parq/sync` | Preview PARQ sync changes |
| 13 | POST | `/api/pmf/parq/sync` | Execute PARQ sync |
| 14 | GET | `/api/pmf/activity-logs/:assetId` | Activity logs for specific vehicle |
| 15 | GET | `/api/pmf/checkin/:vehicleId` | Check-in data for vehicle |
| 16 | GET | `/api/pmf/conditionreport/:vehicleId` | Condition report for vehicle |
| 17 | GET | `/api/pmf/tool-audit/bulk-export` | Bulk export tool audit data |
| 18 | GET | `/api/pmf/activity-sync-meta` | Activity sync metadata |
| 19 | POST | `/api/pmf/sync-activity-logs` | Sync activity logs from PARQ |

### 3F. Internal API — Purchase Orders (7 endpoints)

| # | Method | Endpoint | Purpose |
|---|---|---|---|
| 1 | GET | `/api/pos` | List all purchase orders |
| 2 | POST | `/api/pos/import` | Import PO data from XLSX |
| 3 | PATCH | `/api/pos/:id/final-approval` | Set final approval status |
| 4 | PATCH | `/api/pos/:id/submitted-in-holman` | Mark as submitted in Holman |
| 5 | GET | `/api/pos/final-approval-options` | Available approval options |
| 6 | POST | `/api/pos/sync-declined-repairs` | Sync declined repair POs |
| 7 | GET | `/api/po-priority` | Priority/unpaid POs from Snowflake |

### 3G. Internal API — Metrics (4 endpoints)

| # | Method | Endpoint | Purpose |
|---|---|---|---|
| 1 | POST | `/api/metrics/capture` | Capture current metrics snapshot |
| 2 | GET | `/api/metrics` | Historical metrics snapshots |
| 3 | GET | `/api/metrics/weekly` | Weekly metrics trends |
| 4 | GET | `/api/metrics/current` | Current real-time metrics |

### 3H. Internal API — Spares (7 endpoints)

| # | Method | Endpoint | Purpose |
|---|---|---|---|
| 1 | GET | `/api/spares` | Spare vehicles with Snowflake data |
| 2 | GET | `/api/spares/:vehicleNumber/details` | Spare vehicle details |
| 3 | GET | `/api/spares/locations` | Spare vehicle confirmed locations |
| 4 | GET | `/api/spares/check-assigned/:truckNumber` | Check if truck is assigned |
| 5 | PATCH | `/api/spares/status` | Update spare status |
| 6 | PATCH | `/api/spares/confirmed-address` | Update confirmed address |
| 7 | POST | `/api/spares/add-manual` | Manually add spare vehicle |
| 8 | POST | `/api/spares/bulk-import` | Bulk import spare data |

### 3I. Internal API — Fleet Cost (12 endpoints)

| # | Method | Endpoint | Purpose |
|---|---|---|---|
| 1 | GET | `/api/fleet-cost/records` | Fleet cost records |
| 2 | GET | `/api/fleet-cost/meta` | Import metadata |
| 3 | POST | `/api/fleet-cost/upload-file` | Upload XLSX file |
| 4 | GET | `/api/fleet-cost/job/:jobId` | Check upload job status |
| 5 | POST | `/api/fleet-cost/upload-chunk` | Chunked upload |
| 6 | POST | `/api/fleet-cost/upload` | Standard upload |
| 7 | GET | `/api/fleet-cost/analytics` | Cost analytics/aggregations |
| 8 | POST | `/api/maintenance-costs/import` | Import maintenance costs |
| 9 | GET | `/api/maintenance-costs` | Maintenance cost data |
| 10 | GET | `/api/approved-cost/count` | Approved cost record count |
| 11 | GET | `/api/approved-cost/meta` | Approved cost metadata |
| 12 | POST | `/api/approved-cost/upload` | Upload approved costs |
| 13 | GET | `/api/approved-cost/analytics` | Approved cost analytics |

### 3J. Internal API — Registration & SMS (8 endpoints)

| # | Method | Endpoint | Purpose |
|---|---|---|---|
| 1 | GET | `/api/registration` | All registration tracking data |
| 2 | PATCH | `/api/registration/tracking/:truckNumber` | Update registration tracking |
| 3 | POST | `/api/registration/import` | Import registration data |
| 4 | GET | `/api/reg-messages/:truckNumber` | SMS messages for a truck |
| 5 | GET | `/api/reg-conversations` | All SMS conversations |
| 6 | POST | `/api/reg-messages` | Send SMS message via Twilio |
| 7 | PATCH | `/api/reg-messages/read/:truckNumber` | Mark messages as read |
| 8 | POST | `/api/webhooks/twilio-reg` | Twilio incoming SMS webhook |

### 3K. Internal API — Decommissioning (7 endpoints)

| # | Method | Endpoint | Purpose |
|---|---|---|---|
| 1 | GET | `/api/decommissioning` | All decommissioning vehicles |
| 2 | PATCH | `/api/decommissioning/:id` | Update decommissioning vehicle |
| 3 | DELETE | `/api/decommissioning/:id` | Remove from decommissioning |
| 4 | POST | `/api/decommissioning/import` | Import decommissioning data |
| 5 | POST | `/api/decommissioning/sync-tech-data` | Sync tech data from Snowflake |
| 6 | POST | `/api/decommissioning/sync-from-pos` | Sync from declined POs |
| 7 | POST | `/api/decommissioning/calculate-distances` | Calculate manager/tech distances |
| 8 | POST | `/api/decommissioning/sync-parts-count` | Sync parts count data |

### 3L. Internal API — Rentals (6 endpoints)

| # | Method | Endpoint | Purpose |
|---|---|---|---|
| 1 | POST | `/api/rentals/reconcile` | Reconcile rental data |
| 2 | GET | `/api/rentals/imports` | Rental import history |
| 3 | GET | `/api/rentals/archived` | Archived rental records |
| 4 | GET | `/api/rentals/weekly-stats` | Weekly rental statistics |
| 5 | POST | `/api/rentals/weekly-manual` | Submit manual weekly stats |
| 6 | GET | `/api/rentals/summary` | Rental summary metrics |

### 3M. Internal API — GPS, Tracking & Location (10 endpoints)

| # | Method | Endpoint | Purpose |
|---|---|---|---|
| 1 | GET | `/api/samsara/test` | Test Samsara connection |
| 2 | GET | `/api/samsara/locations` | All Samsara GPS locations |
| 3 | GET | `/api/ups/test` | Test UPS tracking API |
| 4 | GET | `/api/ups/track/:trackingNumber` | Track UPS package |
| 5 | GET | `/api/tracking` | All tracking records |
| 6 | POST | `/api/tracking` | Create tracking record |
| 7 | POST | `/api/tracking/:id/refresh` | Refresh single tracking |
| 8 | POST | `/api/tracking/refresh-all` | Refresh all active tracking |
| 9 | DELETE | `/api/tracking/:id` | Delete tracking record |

### 3N. Internal API — Fleet Vehicle Table & Snapshots (7 endpoints)

| # | Method | Endpoint | Purpose |
|---|---|---|---|
| 1 | GET | `/api/all-vehicles` | Composite fleet data from all sources |
| 2 | GET | `/api/fleet/weekly-snapshots` | Fleet weekly snapshots |
| 3 | GET | `/api/pmf-status/weekly-snapshots` | PMF status weekly snapshots |
| 4 | GET | `/api/repair/weekly-snapshots` | Repair pipeline weekly snapshots |
| 5 | GET | `/api/byov/weekly-snapshots` | BYOV enrollment weekly snapshots |
| 6 | POST | `/api/byov/capture-snapshot` | Capture BYOV snapshot |
| 7 | GET | `/api/byov-enrollment-status` | BYOV enrollment status map |
| 8 | GET | `/api/byov/technicians` | BYOV technician list |

### 3O. Internal API — Tech & External (4 endpoints)

| # | Method | Endpoint | Purpose |
|---|---|---|---|
| 1 | GET | `/api/tech-specialty` | Tech specialty/job title lookup |
| 2 | POST | `/api/tech-specialty/batch` | Batch tech specialty lookup |
| 3 | GET | `/api/v1/external/vehicles` | Legacy external vehicle endpoint |
| 4 | GET | `/api/v1/external/repairs` | Legacy external repairs endpoint |

---

## 4. External Integrations (12 Total)

| # | Integration | Purpose | Auth Method | Key Data |
|---|---|---|---|---|
| 1 | **Snowflake** | Fleet data warehouse | Private key JWT | TPMS_EXTRACT (tech data), REPLIT_ALL_VEHICLES (fleet), Holman_VEHICLES (odometer), SPARE_VEHICLE_ASSIGNMENT_STATUS, AMS data, ORA_TECH_HIRE_ROSTER_VW |
| 2 | **Samsara** | Real-time GPS telematics | API token (`SAMSARA_API_TOKEN`) | 1,800+ vehicle locations, 5-page paginated API |
| 3 | **PARQ API** | Park My Fleet management | OAuth2 client credentials (`PMF_CLIENT_ID`/`PMF_CLIENT_SECRET`) | 128 PMF vehicles, statuses, lots, activity logs, check-ins, condition reports |
| 4 | **Holman Scraper** | Repair status and PO data | Direct API call | PO details, vendor info, AI recommendations, red flags (via `web-scraper-tool-seanchen37.replit.app`) |
| 5 | **ElevenLabs** | AI phone calls to shops/techs | API key + agent IDs | Shop agent: `agent_7901kgj8m0w8ep6ar78fzthzr9jv`, Tech agent: `agent_9401kk2njc6veajaecs89wtbh840` |
| 6 | **Twilio** | SMS messaging for registrations | Account SID + Auth Token (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`) | Bidirectional SMS, TCPA compliance, webhook at `/api/webhooks/twilio-reg` |
| 7 | **SendGrid** | Email notifications | API key (`SENDGRID_API_KEY`) | PO import notifications, truck swap alerts, approval emails |
| 8 | **UPS Tracking** | Package tracking for registration mailings | API integration | Real-time package status, 30-minute auto-refresh |
| 9 | **BYOV Dashboard** | Bring Your Own Vehicle enrollment | API key (`BYOV_API_KEY`) | 128 enrolled trucks, 10-minute cache (via `byovdashboard.replit.app`) |
| 10 | **BigDataCloud** | Reverse geocoding | Free API | Converts GPS coordinates to street addresses |
| 11 | **OSRM / Zippopotam.us** | Distance calculations | Free APIs | Driving distances for decommissioning manager/tech assignments |
| 12 | **Fleet Finder API** | Vehicle location data | API call | Supplemental location data for fleet vehicles |

---

## 5. Automated Background Jobs

| Job | Schedule | Purpose |
|---|---|---|
| Snowflake Tech Data Sync | Daily at 7:30 AM ET | Syncs tech names, enterprise IDs, assignments |
| Snowflake Assigned Status Sync | Daily at 7:30 AM ET | Updates assigned/unassigned status |
| Tech State Sync | On startup + daily | Syncs tech state from TPMS, AMS, XLS sources |
| Samsara GPS Refresh | On startup | Fetches and caches 1,800+ vehicle GPS locations |
| PARQ PMF Auto-Sync | Periodic | Syncs 128 PMF vehicles from PARQ API |
| PARQ Activity Log Sync | After PMF sync | Fetches activity logs for all PMF vehicles |
| UPS Tracking Refresh | Every 30 minutes | Refreshes active package tracking records |
| Decommissioning Tech Sync | On startup + daily at 7:35 AM ET | Syncs tech data and calculates distances for decommissioning vehicles |
| Fleet Finder Pre-warm | On startup (with retries) | Pre-warms fleet finder location cache |
| Registration Message Processor | On startup | Processes scheduled SMS messages |
| TechCache | On startup + periodic | Caches 1,573 technician records for BYOV lookups |

---

## 6. Environment Variables & Secrets

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE` | Individual PostgreSQL connection params |
| `SESSION_SECRET` | Express session encryption |
| `SAMSARA_API_TOKEN` | Samsara GPS API authentication |
| `PMF_CLIENT_ID` / `PMF_CLIENT_SECRET` | PARQ API OAuth2 credentials |
| `SENDGRID_API_KEY` | SendGrid email service |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER` | Twilio SMS service |
| `ELEVENLABS_API_KEY` | ElevenLabs AI calling |
| `PUBLIC_SPARES_API_KEY` | Public API authentication key |
| `BYOV_API_KEY` | BYOV enrollment API authentication |

---

## 7. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, Wouter (routing), TanStack React Query v5 |
| UI Framework | Shadcn/ui (Radix UI + Tailwind CSS), Lucide React icons |
| Forms | React Hook Form + Zod validation |
| Backend | Node.js, Express.js (TypeScript) |
| Database | PostgreSQL with Drizzle ORM |
| Data Import/Export | PapaParse (CSV), SheetJS (Excel/XLSX) |
| Real-time | WebSockets for SMS conversations |
