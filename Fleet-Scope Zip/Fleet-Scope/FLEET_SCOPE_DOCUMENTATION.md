# Fleet Scope - Complete Technical Documentation

> **Application URL**: fleet-scope.replit.app
> **Last Updated**: February 2026
> **Purpose**: Fleet management system for Sears Home Services vans undergoing repair, replacing a spreadsheet-based workflow.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Technology Stack](#2-technology-stack)
3. [Application Modules](#3-application-modules)
4. [Database Schema](#4-database-schema)
5. [External Integrations](#5-external-integrations)
6. [Background Schedulers](#6-background-schedulers)
7. [API Reference](#7-api-reference)
8. [Status System](#8-status-system)
9. [Data Flow & Business Logic](#9-data-flow--business-logic)
10. [Weekly Snapshot Systems](#10-weekly-snapshot-systems)
11. [File Structure](#11-file-structure)
12. [Environment Variables & Secrets](#12-environment-variables--secrets)
13. [Key Operational Concepts](#13-key-operational-concepts)

---

## 1. System Overview

Fleet Scope is a comprehensive fleet management web application that tracks Sears Home Services vans through their entire lifecycle: from initial research and repair, through registration/tagging, scheduling, pickup, and eventual decommissioning or return to road. The system consolidates data from multiple external sources (Snowflake data warehouse, Samsara GPS telematics, PARQ/Park My Fleet API, Holman fleet management, UPS tracking) into a unified dashboard.

### What the App Does

- **Tracks ~330 rental/repair vehicles** through a multi-stage status workflow (the "Rentals Dashboard")
- **Monitors ~2,100+ total fleet vehicles** by pulling assignment data from Snowflake (the "All Vehicles" tab)
- **Manages ~275 spare/unassigned vehicles** with editable status columns synced back to Snowflake
- **Tracks ~119 PMF (Park My Fleet) vehicles** via PARQ API integration with status flow and activity logs
- **Handles purchase orders** imported from CSV/XLSX with approval workflows
- **Monitors fleet costs** via XLSX imports with weekly/monthly/annual analytics
- **Tracks vehicle registrations** with expiry monitoring and renewal workflow steps
- **Manages decommissioning** for declined-repair vehicles with tech assignment data from Snowflake
- **Provides real-time GPS locations** via Samsara telematics with reverse geocoding
- **Captures weekly snapshots** across 4 tracking systems for historical trend analysis

### User Access

Users select a profile on first visit (stored in localStorage). The profile name is used for audit trails (action logs, update tracking). There is no authentication system — it's an internal tool with profile-based identification.

---

## 2. Technology Stack

### Frontend
| Technology | Purpose |
|---|---|
| React 18 | UI framework |
| TypeScript | Type safety |
| Vite | Build tool & dev server |
| Wouter | Client-side routing |
| TanStack React Query v5 | Server state management, caching |
| Shadcn/ui (Radix UI) | Component library ("New York" style) |
| Tailwind CSS | Utility-first styling |
| React Hook Form + Zod | Form handling and validation |
| Lucide React | Icons |
| PapaParse | CSV parsing |
| xlsx (SheetJS) | Excel import/export |
| date-fns | Date manipulation |

### Backend
| Technology | Purpose |
|---|---|
| Node.js + Express.js | REST API server (TypeScript) |
| Drizzle ORM | Database queries and schema management |
| PostgreSQL (Neon) | Primary database |
| Snowflake SDK | Data warehouse queries (key-pair auth) |
| Multer | File upload handling |
| SendGrid | Email notifications |

### Key Architectural Decisions
- Frontend and backend run on the same port (5000) via Vite middleware in dev
- No authentication layer — profile selection only (internal tool)
- Snowflake is read-heavy with selective write-back (spare vehicle status updates)
- JSONB storage pattern used for flexible imported data (POs, fleet costs)
- Optimistic UI updates with React Query cache invalidation
- Background schedulers run in-process (no separate job queue)

---

## 3. Application Modules

### 3.1 All Vehicles (Landing Page — `/`)

**File**: `client/src/pages/AllVehicles.tsx`

The main entry point. Displays a comprehensive fleet overview pulling data from Snowflake's `REPLIT_ALL_VEHICLES` view.

**Data Sources**:
- Snowflake `REPLIT_ALL_VEHICLES` — primary vehicle assignment data (~2,100+ vehicles)
- Snowflake `SPARE_VEHICLE_ASSIGNMENT_STATUS` — confirmed addresses for spare vehicles
- Snowflake `Holman_VEHICLES` — odometer data matched by VIN
- Samsara API (via Snowflake `SAMSARA_STREAM`) — GPS locations (~1,838 vehicles)
- PostgreSQL `trucks` table — repair status for cross-referencing
- PostgreSQL `purchase_orders` — declined repair POs (152 vehicles with "Decline and Submit for Sale")
- Fleet Finder API — additional location data
- BigDataCloud API — reverse geocoding GPS coordinates to street addresses

**Summary Cards**:
- **Total Fleet**: All vehicles in REPLIT_ALL_VEHICLES + declined repairs count (254)
- **Assigned**: Vehicles with ASSIGNMENT_STATUS = 'Assigned'
- **Unassigned**: Vehicles not assigned

**Key Features**:
- Searchable, filterable vehicle table with state-based multi-select filters
- Multi-source "Last Known Location" with timestamp comparison and source ranking
- GPS coordinates reverse-geocoded to full addresses (7-day cache, 200ms rate limiting)
- Clickable scorecards navigating to related modules (PMF → /pmf, Repair Shop → /dashboard)
- Map visualization with state-level vehicle aggregation
- Vehicle maintenance cost display (lifetime costs from Holman data)

**Location Source Priority** (ranked by timestamp recency):
1. Snowflake GPS (from SAMSARA_STREAM)
2. AMS current state
3. TPMS state
4. Samsara direct API
5. PMF lot location
6. Fleet Finder
7. Confirmed address (manual entry from spare vehicle details)

---

### 3.2 Rentals Dashboard (`/dashboard`)

**File**: `client/src/pages/Dashboard.tsx`

Tracks ~330 vehicles currently in the rental/repair pipeline. This is the core operational module.

**Data Source**: PostgreSQL `trucks` table (local database, manually managed)

**Key Features**:
- Table-centric view with inline editing (optimistic updates)
- Hierarchical status system: Main Status → Sub Status (see Section 8)
- Color-coded status badges (Green/Amber/Red/Orange/Gray)
- Multi-select column filters for all key fields
- Debounced search across truck number, tech name, address
- CSV bulk import/export and Excel export (includes State column)
- Rental reconciliation: import a truck list, auto-archive trucks not in list, auto-add new ones
- Pickup tracking: Saturday-Friday weekly windows with auto-snapshot
- SHS Owner assignment with date tracking
- Registration sticker status tracking
- UPS package tracking integration
- Call status logging with date tracking

**Related Sub-pages**:
- `/trucks/:id` — Truck Detail page with collapsible accordion sections (auto-expand based on status)
- `/trucks/new` — Add new truck
- `/action-tracker` — Owner-based workload view with cards
- `/executive-summary` — Visual cards showing truck counts by main status with percentages
- `/metrics` — KPI dashboard with 30-day daily trends and weekly summaries
- `/holman-research` — Research interface for Holman data

---

### 3.3 Spares Module (`/spares`)

**File**: `client/src/pages/Spares.tsx`

Manages ~275 unassigned/spare vehicles with editable status columns that sync back to Snowflake.

**Data Sources**:
- Snowflake `UNASSIGNED_VEHICLES` view — base vehicle list
- Snowflake `SPARE_VEHICLE_ASSIGNMENT_STATUS` — editable column data
- PostgreSQL `spare_vehicle_details` — local persistence for edits

**Editable Columns** (with Snowflake column mapping):
| UI Column | PostgreSQL Field | Snowflake Column | Type |
|---|---|---|---|
| Keys | keysStatus | KEYS_STATUS | Dropdown: Yes/No/Unconfirmed |
| Repaired | repairCompleted | REPAIRED_STATUS | Dropdown: Complete/In Process/Unknown if needed/Declined |
| Reg. Renewal | registrationRenewalDate | REGISTRATION_RENEWAL_DATE | Date picker |
| Contact | contactNamePhone | CONFIRMED_CONTACT | Text (60 chars max) |
| General Comments | generalComments | ONGOING_COMMENTS | Textarea (500 chars max) |
| Fleet Team Comments | johnsComments | FLEET_TEAM_FINAL_COMMENTS | Dropdown (9 predefined options) |

**Key Features**:
- Inline editing with auto-save
- All edits persist to both PostgreSQL AND Snowflake
- Zod validation on PATCH endpoint
- Bulk CSV import capability
- Manual vehicle addition
- Public API for external apps to update spare vehicle data

---

### 3.4 PMF Module (`/pmf`)

**File**: `client/src/pages/PMF.tsx`

Manages Park My Fleet vehicles via PARQ API integration.

**Data Sources**:
- PARQ API — vehicles, statuses, lots, activity logs (OAuth2 client credentials)
- PostgreSQL `pmf_rows` — persisted vehicle data
- PostgreSQL `pmf_status_events` — status change tracking
- PostgreSQL `pmf_activity_logs` — activity logs from PARQ

**PMF Statuses Tracked**:
- Available
- Locked Down Local
- Pending Arrival
- Pending Pickup
- Checked Out (excluded from map bubble counts)

**Key Features**:
- Auto-sync from PARQ API on startup and every 6 hours
- Interactive US map (`PMFMap.tsx`) showing vehicle locations by PMF lot with bubble counts (only 4 statuses: Available, Locked Down Local, Pending Arrival, Pending Pickup)
- "Days Locked Down Local" calculation (stops counting when status changes, restarts on re-entry)
- Activity log viewer per vehicle
- Status flow tracking with event history
- Check-in reports and condition reports from PARQ
- Tool audit interface (`/pmf/tool-audit/:assetId`)
- Weekly tracker component (`PMFWeeklyTracker.tsx`)
- Bulk tool audit export

---

### 3.5 Purchase Orders (`/pos`)

**File**: `client/src/pages/POs.tsx`

Imports and manages purchase order data from CSV/XLSX files.

**Data Source**: PostgreSQL `purchase_orders` table (JSONB `rawData` field)

**Key Features**:
- CSV/XLSX import with upsert by PO number
- Summary cards showing total POs, amounts, and status breakdowns
- Searchable table with all imported columns
- "Submitted in Holman" editable column (preserved during re-imports)
- "Final Approval" editable column with dropdown options (preserved during re-imports)
- When Final Approval = "Decline and Submit for Sale", auto-populates Decommissioning module
- Time-based analytics

---

### 3.6 Fleet Cost Module (`/fleet-cost`)

**File**: `client/src/pages/FleetCost.tsx`

Tracks fleet cost data via XLSX file uploads.

**Data Sources**:
- PostgreSQL `fleet_cost_records` (JSONB storage)
- PostgreSQL `fleet_cost_import_meta` — import history
- PostgreSQL `approved_cost_records` — approved POs pending billing

**Key Features**:
- XLSX upload with upsert logic
- Background job processing for large files (prevents timeouts)
- Import history tracking
- SQL-aggregated analytics: weekly, monthly, annual breakdowns by LINE_TYPE
- Approved cost analytics (separate upload track using PO DATE and AMOUNT columns)
- Chunked upload support for large files

---

### 3.7 Registration Module (`/registration`)

**File**: `client/src/pages/Registration.tsx`

Tracks vehicle registration expiry and renewal workflows. Combines data from 4 sources.

**Data Sources**:
- Snowflake `REPLIT_ALL_VEHICLES` — base vehicle/registration data
- Snowflake `SPARE_VEHICLE_ASSIGNMENT_STATUS` — spare vehicle registrations
- PostgreSQL `trucks` — rental vehicles
- Snowflake `TPMS_EXTRACT` — tech assignment verification
- PostgreSQL `registration_tracking` — per-vehicle workflow checkboxes

**Key Features**:
- **Total Tracked**: ~2,147 vehicles (filters out "088" prefix trucks)
- Risk cards: Expired, Expiring Soon (30 days), Up to Date, No Date
- Monthly expiry scorecard with clickable month filters
- **Process Flow Diagram**: Shows per-month progress through 4 workflow steps:
  1. Initial Text Sent
  2. Time Slot Confirmed
  3. Submitted to Holman
  4. Already Sent
- Implicit completion logic: if "Already Sent" or "Submitted to Holman" is checked, earlier steps count as done
- Per-vehicle editable checkboxes and comments
- Owner assignment by district mapping (Rob, Cheryl, Carol)
- State-based multi-select filtering
- Import registration dates from file
- XLSX export

**District-to-Owner Mapping**:
| Districts | Owner |
|---|---|
| 3132, 4766, 7084, 7435, 7670, 7744, 7983, 8035, 8175, 8380 | Rob |
| 3580, 6141, 7323, 8096, 8162, 8206, 8220, 8309, 8420, 8555, 8935 | Cheryl |
| 7088, 7108, 7995, 8107, 8147, 8158, 8169, 8184, 8228, 8366 | Carol |

---

### 3.8 Decommissioning Module (`/decommissioning`)

**File**: `client/src/pages/Decommissioning.tsx`

Tracks vehicles with "Decline and Submit for Sale" PO Final Approval status.

**Data Sources**:
- PostgreSQL `decommissioning_vehicles` — local persistence
- PostgreSQL `purchase_orders` — source trigger (Final Approval = "Decline and Submit for Sale")
- Snowflake `TPMS_EXTRACT` — 7 tech data columns
- Snowflake `Holman_VEHICLES` — VIN matching
- Snowflake `NTAO_FIELD_VIEW_ASSORTMENT` — parts count/space data
- OSRM API — driving distance calculations
- Zippopotam.us — ZIP code geocoding

**Auto-populated When**: PO Final Approval is set to "Decline and Submit for Sale"

**Tech Data Columns from TPMS_EXTRACT**:
1. Enterprise ID
2. Full Name
3. Mobile Phone
4. Primary ZIP
5. Manager Ent ID
6. Manager Name
7. Manager ZIP

**Key Features**:
- Daily auto-sync at 7:35 AM ET from Snowflake (preserves existing data if truck removed)
- **ZIP Code Fallback**: When truck number doesn't match in TPMS_EXTRACT, finds nearest technician by ZIP code comparison. Displayed in orange text with "(nearest)" label.
- **Assigned Column**: Yes/No based on current TPMS_EXTRACT presence (Yes in green)
- **Distance Calculations**: Tech Distance and Manager Distance using OSRM routing API with caching (only recalculates when ZIP changes). Highlighted with amber background.
- **Decom Done** checkbox for tracking completion
- Parts Count and Parts Space from Snowflake inventory data
- XLSX export
- Editable comments, phone, address fields

---

### 3.9 Supporting Pages

| Route | File | Purpose |
|---|---|---|
| `/action-tracker` | ActionTracker.tsx | Owner-based workload view with priority cards |
| `/executive-summary` | ExecutiveSummary.tsx | Visual status distribution cards with clickable filters |
| `/metrics` | MetricsDashboard.tsx | KPI tracking with manual snapshots, 30-day trends, weekly summaries |
| `/holman-research` | HolmanResearch.tsx | Research interface for Holman fleet data |
| `/profile` | ProfileSelection.tsx | User profile selection (no auth, just name) |
| `/trucks/:id` | TruckDetail.tsx | Detailed truck view with collapsible sections |
| `/trucks/new` | EditTruck.tsx | Add new truck to rentals dashboard |
| `/pmf/tool-audit/:assetId` | ToolAudit.tsx | PMF tool audit interface |

---

## 4. Database Schema

### 4.1 Core Tables

#### `trucks` — Rental/Repair Vehicles (~330 rows)
The central table for the Rentals Dashboard. Each row represents a vehicle in the repair pipeline.

| Column | Type | Description |
|---|---|---|
| id | varchar (UUID) | Primary key |
| truckNumber | text | Unique vehicle number (e.g., "047135") |
| status | text | Combined display status ("Main Status, Sub Status") |
| mainStatus | text | Main status category (one of 14 values) |
| subStatus | text | Sub-status within category |
| shsOwner | text | Assigned SHS owner name |
| dateLastMarkedAsOwned | text | When ownership was last changed |
| registrationStickerValid | text | Yes/Expired/Shop would not check/etc. |
| registrationExpiryDate | text | Date tags were received ("Have Tags" column) |
| holmanRegExpiry | text | Actual registration expiry from Holman |
| repairOrSaleDecision | text | Repair or Sale |
| vanInventoried | boolean | Vehicle inventoried for sale |
| salePrice | text | Sale price |
| datePutInRepair | text | Date vehicle entered repair |
| billPaidDate | text | Latest bill paid date |
| repairCompleted | boolean | Repair finished |
| inAms | boolean | AMS documented |
| repairAddress | text | Repair shop address |
| repairPhone | text | Repair shop phone |
| contactName | text | Local repair contact |
| techName | text | Technician name |
| techPhone | text | Technician phone |
| techLeadName | text | Manager name (from TPMS_EXTRACT) |
| techLeadPhone | text | Manager phone |
| techState | text | 2-letter state code |
| techStateSource | text | Source: "TPMS", "AMS", or "XLS" |
| pickUpSlotBooked | boolean | Pickup scheduled |
| vanPickedUp | boolean | Vehicle picked up by tech |
| snowflakeAssigned | boolean | Found in Snowflake TPMS_EXTRACT |
| comments | text | General comments |
| notes | text | Additional notes |
| gaveHolman | text | Yes/No — Holman tracking status |
| lastDateCalled | text | Last call date to shop |
| callStatus | text | Brief call note (50 chars) |
| eta | text | Estimated arrival date |
| lastUpdatedAt | timestamp | Last modification time |
| lastUpdatedBy | text | Who last modified |
| createdAt | timestamp | Creation time |
| *(plus ~15 more boolean/text fields for workflow tracking)* | | |

#### `actions` — Audit Trail
Automatic action logging for all significant data changes on trucks.

| Column | Type | Description |
|---|---|---|
| id | varchar (UUID) | Primary key |
| truckId | varchar | FK → trucks.id (cascade delete) |
| actionTime | timestamp | When the action occurred |
| actionBy | text | Who performed the action |
| actionType | text | Type of action |
| actionNote | text | Description with field-level diffs |

#### `tracking_records` — UPS/FedEx/USPS Package Tracking

| Column | Type | Description |
|---|---|---|
| id | varchar (UUID) | Primary key |
| truckId | varchar | FK → trucks.id |
| carrier | text | UPS/FedEx/USPS |
| trackingNumber | text | Package tracking number |
| lastStatus | text | Current tracking status |
| estimatedDelivery | text | ETA |
| deliveredAt | timestamp | Delivery timestamp |
| lastCheckedAt | timestamp | Last API check time |

---

### 4.2 PMF Tables

#### `pmf_imports` — Import metadata
Tracks each PMF data import with headers and row counts.

#### `pmf_rows` — PMF vehicle data (~119 rows)
| Column | Type | Description |
|---|---|---|
| id | varchar (UUID) | Primary key |
| assetId | text | Unique asset identifier (upsert key) |
| status | text | Current PMF status |
| rawRow | text | JSON stringified full row data |

#### `pmf_status_events` — Status change history
Tracks when vehicles change PMF status, enabling "Days in Status" calculations.

| Column | Type | Description |
|---|---|---|
| assetId | text | Vehicle asset ID |
| status | text | New status |
| previousStatus | text | Previous status |
| effectiveAt | timestamp | When change occurred |
| source | text | 'import', 'sync', or 'manual' |

#### `pmf_activity_logs` — PARQ API activity logs
Synced every 6 hours from PARQ API. Tracks work orders and status changes.

| Column | Type | Description |
|---|---|---|
| vehicleId | integer | PARQ vehicle ID |
| assetId | text | Links to pmf_rows |
| activityDate | timestamp | Activity date |
| action | text | Action description |
| activityType | integer | 1=Work Order, 2=Status Change |
| workOrderId | integer | Optional work order reference |

#### `pmf_activity_sync_meta` — Sync tracking
Records last sync time, vehicles synced, logs fetched, and sync status.

---

### 4.3 Purchase Orders & Cost Tables

#### `purchase_orders` — PO data
| Column | Type | Description |
|---|---|---|
| poNumber | varchar(100) | PO number (upsert key) |
| rawData | text | JSON stringified row from import |
| submittedInHolman | text | Preserved during re-imports |
| finalApproval | text | Dropdown value, triggers decommissioning |

#### `po_import_meta` — Import headers and stats

#### `fleet_cost_records` — Fleet cost data (JSONB)
| Column | Type | Description |
|---|---|---|
| recordKey | varchar(255) | Unique identifier from file |
| keyColumn | varchar(100) | Column name used as identifier |
| rawData | text | JSON stringified row data |

#### `fleet_cost_import_meta` — Import tracking

#### `approved_cost_records` — Approved PO costs (same structure as fleet_cost_records)
#### `approved_cost_import_meta` — Import tracking for approved costs

---

### 4.4 Registration & Tracking Tables

#### `registration_tracking` — Per-vehicle registration workflow
| Column | Type | Description |
|---|---|---|
| truckNumber | text | Primary key (vehicle number) |
| initialTextSent | boolean | Step 1: Initial text sent to tech |
| timeSlotConfirmed | boolean | Step 2: Time slot booked |
| timeSlotValue | text | Time slot details (MM/DD-HH format) |
| submittedToHolman | boolean | Step 3: Documents submitted |
| submittedToHolmanAt | timestamp | When submitted |
| alreadySent | boolean | Step 4: Registration already sent |
| comments | text | Notes (250 char limit) |

---

### 4.5 Spare Vehicle Tables

#### `spare_vehicle_details` — Editable fields for spare vehicles (~275 rows)
| Column | Type | Description |
|---|---|---|
| vehicleNumber | varchar(50) | Unique, links to Snowflake |
| keysStatus | varchar(50) | Present/Not Present/Unknown |
| repairCompleted | varchar(50) | Complete/In Process/Unknown if needed/Declined |
| registrationRenewalDate | timestamp | Reg renewal date |
| contactNamePhone | text | Contact info (60 chars) |
| generalComments | text | General notes (500 chars) |
| johnsComments | text | Fleet Team Comments (dropdown) |
| scheduleToPmf | varchar(10) | Yes/No |
| pmfLocationAddress | text | Target PMF location |
| enteredIntoTransportList | varchar(10) | Yes/No |
| vin | varchar(20) | Vehicle VIN |
| isManualEntry | boolean | Manually added vehicle |

---

### 4.6 Weekly Snapshot Tables

Four parallel tables capture historical trends every 6 hours:

#### `byov_weekly_snapshots` — BYOV enrollment tracking
| Column | Type | Description |
|---|---|---|
| weekNumber/weekYear | integer | ISO week identification |
| totalEnrolled | integer | Total BYOV technicians |
| assignedInFleet | integer | Found in REPLIT_ALL_VEHICLES |
| notInFleet | integer | Personal vehicles |

#### `fleet_weekly_snapshots` — Fleet assignment counts
| Column | Type | Description |
|---|---|---|
| totalFleet | integer | Total vehicles |
| assignedCount | integer | Assigned vehicles |
| unassignedCount | integer | Unassigned vehicles |
| pmfCount | integer | PMF vehicles |

#### `pmf_status_weekly_snapshots` — PMF status distribution
| Column | Type | Description |
|---|---|---|
| totalPmf | integer | Total PMF vehicles |
| pendingArrival | integer | Pending arrival count |
| lockedDownLocal | integer | Locked down locally |
| available | integer | Available for assignment |
| pendingPickup | integer | Pending pickup |
| checkedOut | integer | Checked out |

#### `repair_weekly_snapshots` — Repair tracking
| Column | Type | Description |
|---|---|---|
| totalInRepair | integer | Total in repair |
| activeRepairs | integer | Active (not completed) |
| completedThisWeek | integer | Completed this week |

#### `pickup_weekly_snapshots` — Pickup scheduling (Sat-Fri weeks)
| Column | Type | Description |
|---|---|---|
| pickupsScheduled | integer | Vehicles with pickup booked |
| weekLabel | text | Human-readable week label |

---

### 4.7 Other Tables

#### `metrics_snapshots` — Daily metrics for KPI dashboard
Tracks trucks on road, scheduled, registration sticker counts, total trucks, repairing, confirming status.

#### `truck_consolidations` — Weekly rental list reconciliation history
Records added/removed trucks with JSON arrays.

#### `archived_trucks` — Trucks removed during rental reconciliation
Preserves snapshot of truck data at archival time.

#### `rental_imports` — Rental list import history
Tracks stats per import: total in list, new added, returned, matched.

#### `rental_weekly_manual` — Manual weekly rental counts
| Column | Type | Description |
|---|---|---|
| weekYear/weekNumber | integer | Week identification (unique constraint) |
| newRentals | integer | Manually entered new rentals |
| rentalsReturned | integer | Manually entered returns |

#### `decommissioning_vehicles` — Declined repair vehicles (~163 rows)
| Column | Type | Description |
|---|---|---|
| truckNumber | varchar(20) | Unique vehicle number |
| vin | varchar(50) | From Holman_VEHICLES |
| address/zipCode/phone | text/varchar | Vehicle location |
| comments | text | Notes |
| stillNotSold | boolean | Sale status |
| enterpriseId/fullName/mobilePhone | varchar | Tech data from TPMS |
| primaryZip | varchar | Tech ZIP code |
| managerEntId/managerName/managerZip | varchar | Manager data |
| managerDistance/techDistance | integer | Driving distances (miles) |
| decomDone | boolean | Decommissioning complete |
| techMatchSource | varchar | 'truck' or 'zip_fallback' |
| isAssigned | boolean | Found in TPMS_EXTRACT |
| partsCount | integer | ON_HAND parts count |
| partsSpace | real | Truck cubic feet |

#### `samsara_locations` — Persisted GPS locations (~1,838 rows)
Retains last known Samsara GPS location per vehicle, even after vehicles stop reporting.

#### `vehicle_maintenance_costs` — Lifetime maintenance costs per vehicle
Stores both formatted string and numeric value (cents) for sorting.

---

## 5. External Integrations

### 5.1 Snowflake Data Warehouse

**Connection**: Key-pair authentication (JWT) via `snowflake-sdk`
**File**: `server/snowflake.ts`

**Schemas & Tables Used**:

| Schema.Table | Purpose | Module |
|---|---|---|
| `PARTS_SUPPLYCHAIN.SOFTEON.REPLIT_ALL_VEHICLES` | All fleet vehicles (~2,100+) | All Vehicles |
| `PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT` | Tech assignment data | Registration, Decommissioning, Rentals |
| `PARTS_SUPPLYCHAIN.SOFTEON.UNASSIGNED_VEHICLES` | Spare vehicle list | Spares |
| `PARTS_SUPPLYCHAIN.FLEET.SPARE_VEHICLE_ASSIGNMENT_STATUS` | Editable spare data (read/write) | Spares |
| `PARTS_SUPPLYCHAIN.FLEET.Holman_VEHICLES` | VIN + odometer data | All Vehicles, Decommissioning |
| `BI_ANALYTICS.APP_SAMSARA.SAMSARA_STREAM` | GPS telematics (~1,138 vehicles) | All Vehicles |
| `PARTS_SUPPLYCHAIN.SOFTEON.AMS_XLS_EXPORTS` | AMS state fallback data | Rentals |
| `PARTS_SUPPLYCHAIN.SOFTEON.NTAO_FIELD_VIEW_ASSORTMENT` | Parts inventory | Decommissioning |

**Write Operations**: Only `SPARE_VEHICLE_ASSIGNMENT_STATUS` is written to (spare vehicle edits sync back).

**Tech State Fallback Chain** (3 tiers):
1. `TPMS_EXTRACT.PRIMARY_STATE` (primary source)
2. `REPLIT_ALL_VEHICLES.AMS_CUR_STATE` (AMS fallback, shown in amber)
3. `AMS_XLS_EXPORTS.CURRENT_ADDRESS` (parsed 3rd comma value, shown in blue)

### 5.2 Samsara GPS Telematics

**File**: `server/samsara.ts`
**Auth**: API token (`SAMSARA_API_TOKEN`)
**Data**: Real-time vehicle GPS locations from Samsara API
**Cache**: 5-minute TTL, persisted to `samsara_locations` table
**Volume**: ~1,838 vehicles with GPS data (fetched in paginated batches of 512)

### 5.3 PARQ API (Park My Fleet)

**File**: `server/pmf-api.ts`
**Auth**: OAuth2 client credentials (`PMF_CLIENT_ID`, `PMF_CLIENT_SECRET`)
**Base URL**: `https://api.parq.ai/api/public/v1/`
**Endpoints Used**:
- `GET /vehicle` — List all PMF vehicles
- `GET /vehicle/statuses` — Available statuses
- `GET /lot` — PMF lot locations
- `GET /vehicle/:id/activitylog` — Per-vehicle activity logs
- `GET /vehicle/:id/checkin` — Check-in reports
- `GET /vehicle/:id/conditionreport` — Condition reports

### 5.4 BigDataCloud (Reverse Geocoding)

**File**: `server/reverse-geocode.ts`
**API**: Free reverse geocoding (no API key required)
**Cache**: 7-day TTL
**Rate Limit**: 200ms between requests (5 req/sec)
**Batch Size**: 50 coordinates per request batch
**Purpose**: Convert GPS lat/lon to street addresses for map display

### 5.5 OSRM (Routing/Distance)

**File**: `server/distance-calculator.ts`
**API**: Open Source Routing Machine (free, public)
**Purpose**: Calculate driving distances between ZIP codes for decommissioning
**Geocoding**: Uses Zippopotam.us for ZIP → lat/lon conversion
**Caching**: Only recalculates when relevant ZIP changes

### 5.6 UPS Tracking

**File**: `server/ups.ts`
**Purpose**: Track package shipments (tags, registration documents)
**Refresh**: Every 30 minutes for active tracking records
**Carriers**: UPS, FedEx, USPS

### 5.7 Fleet Finder API

**File**: `server/fleet-finder.ts`
**Purpose**: Additional vehicle location data
**Cache**: Pre-warmed on startup with retry logic (5 retries, 60s interval)
**Note**: Sometimes returns 503 (Service Unavailable)

### 5.8 SendGrid

**Purpose**: Email notifications (configured via `SENDGRID_API_KEY`)

---

## 6. Background Schedulers

All schedulers run in-process within the Express server (no separate job queue).

| Scheduler | Interval | Purpose |
|---|---|---|
| **PMF PARQ Sync** | On startup + every 6 hours | Syncs 119 vehicles from PARQ API |
| **Activity Log Sync** | After PMF sync | Fetches activity logs for all PMF vehicles with PARQ IDs |
| **Weekly Snapshot Auto-Capture** | Every 6 hours | Captures BYOV, Fleet, PMF Status, and Repair snapshots |
| **UPS Tracking Refresh** | Every 30 minutes | Refreshes all active tracking records |
| **Tech Data Sync** | Daily at 7:30 AM ET | Syncs tech name/phone/manager from Snowflake TPMS_EXTRACT |
| **Tech State Sync** | After tech data sync | Syncs tech state with 3-tier fallback (TPMS → AMS → XLS) |
| **Assigned Status Sync** | Daily at 7:30 AM ET | Checks if trucks are still in Snowflake TPMS_EXTRACT |
| **Decommissioning Tech Sync** | Daily at 7:35 AM ET | Syncs tech data for decommissioning vehicles, calculates distances |
| **Fleet Finder Pre-warm** | On startup (5 retries) | Pre-warms Fleet Finder cache |
| **Samsara Location Persist** | With All Vehicles data load | Persists GPS locations to database |

---

## 7. API Reference

### 7.1 Public APIs (External Access)

These endpoints are accessible by external applications:

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| GET | `/api/public/rentals` | None | All trucks with mainStatus/subStatus |
| GET | `/api/public/rentals/:truckNumber` | None | Single truck lookup |
| POST | `/api/public/spares/:vehicleNumber` | API Key (`X-API-Key` header) | Update spare vehicle data |
| GET | `/api/public/spares` | API Key | All spare vehicles with editable data |
| GET | `/api/public/spares/:vehicleNumber` | API Key | Single spare vehicle lookup |

**Spares API Input Normalization**:
- Accepts snake_case and lowercase (e.g., `in_repair` → `In repair`, `not_present` → `No`)
- Null values ignored (treated as "not provided")
- Vehicle number auto-padded to 6 digits
- Field aliases: `newLocation` → confirmedAddress, `comments` → generalComments, etc.

### 7.2 Internal API Groups

#### Trucks (Rentals Dashboard)
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/trucks` | List all trucks |
| GET | `/api/trucks/:id` | Get single truck |
| POST | `/api/trucks` | Create truck |
| PUT/PATCH | `/api/trucks/:id` | Update truck (with auto-status rules) |
| GET | `/api/trucks/:id/actions` | Get audit trail |
| POST | `/api/trucks/bulk-import` | Bulk CSV import |
| POST | `/api/trucks/bulk-sync` | Sync with external data |
| POST | `/api/trucks/consolidate` | Reconcile truck list |
| POST | `/api/trucks/update-reg-expiry` | Update registration expiry dates |
| POST | `/api/trucks/update-bill-paid` | Update bill paid dates |
| POST | `/api/trucks/call-import` | Import call log data |
| GET | `/api/truck-consolidations` | Consolidation history |
| POST | `/api/csv-import` | General CSV import |

#### Pickups
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/pickups-scheduled-this-week` | Current week pickup count |
| GET | `/api/pickup-weekly-snapshots` | Historical pickup data |

#### Snowflake Integration
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/snowflake/test` | Test connection |
| GET | `/api/snowflake/schema` | View schema info |
| GET | `/api/snowflake/data` | Query data |
| POST | `/api/snowflake/query` | Run custom query |
| POST | `/api/snowflake/sync-tech-data` | Manual tech data sync |
| POST | `/api/snowflake/sync-assigned-status` | Manual assigned status sync |
| POST | `/api/snowflake/sync-tech-state` | Manual tech state sync |
| GET | `/api/snowflake/unassigned-vehicles` | Get spare vehicle list |
| GET | `/api/snowflake/spare-assignment-status` | Get editable spare data |

#### Spares
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/spares` | Combined spare vehicle data |
| GET | `/api/spares/:vehicleNumber/details` | Single vehicle details |
| GET | `/api/spares/locations` | Vehicle location data |
| PATCH | `/api/spares/status` | Update editable columns (syncs to Snowflake) |
| PATCH | `/api/spares/confirmed-address` | Update confirmed address |
| POST | `/api/spares/bulk-import` | Bulk CSV import |
| POST | `/api/spares/add-manual` | Manually add vehicle |
| GET | `/api/spares/check-assigned/:truckNumber` | Check Snowflake assignment |

#### PMF
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/pmf` | All PMF data with PARQ sync |
| GET | `/api/pmf/summary` | PMF summary statistics |
| GET | `/api/pmf/status-events` | Status change history |
| GET | `/api/pmf/days-in-status` | Days in each status |
| POST | `/api/pmf/import` | Import PMF data |
| GET/POST | `/api/pmf/parq/sync` | Manual PARQ sync |
| GET | `/api/pmf/activity-logs/:assetId` | Activity logs per vehicle |
| GET | `/api/pmf/checkin/:vehicleId` | Check-in report |
| GET | `/api/pmf/conditionreport/:vehicleId` | Condition report |
| GET | `/api/pmf/tool-audit/bulk-export` | Export tool audit data |
| GET | `/api/pmf/activity-sync-meta` | Activity sync status |
| POST | `/api/pmf/sync-activity-logs` | Manual activity log sync |
| POST | `/api/pmf/status-events/backfill` | Backfill missing status events |
| GET | `/api/pmf/parq/test` | Test PARQ API connection |
| GET | `/api/pmf/parq/vehicles` | Raw PARQ vehicles |
| GET | `/api/pmf/parq/statuses` | PARQ status list |
| GET | `/api/pmf/parq/lots` | PARQ lot list |

#### All Vehicles
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/all-vehicles` | Full fleet data (aggregates 7+ sources) |

#### Weekly Snapshots
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/byov/weekly-snapshots` | BYOV enrollment history |
| POST | `/api/byov/capture-snapshot` | Manual BYOV snapshot |
| GET | `/api/fleet/weekly-snapshots` | Fleet assignment history |
| GET | `/api/pmf-status/weekly-snapshots` | PMF status history |
| GET | `/api/repair/weekly-snapshots` | Repair count history |

#### Metrics
| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/metrics/capture` | Capture manual snapshot |
| GET | `/api/metrics` | All snapshots |
| GET | `/api/metrics/weekly` | Weekly summaries |
| GET | `/api/metrics/current` | Current KPIs |

#### Purchase Orders
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/pos` | All POs |
| POST | `/api/pos/import` | Import CSV/XLSX |
| PATCH | `/api/pos/:id/final-approval` | Update final approval |
| PATCH | `/api/pos/:id/submitted-in-holman` | Update Holman submission |
| GET | `/api/pos/final-approval-options` | Get dropdown options |
| POST | `/api/pos/sync-declined-repairs` | Sync declined to decommissioning |

#### Rentals
| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/rentals/reconcile` | Reconcile rental list |
| GET | `/api/rentals/imports` | Import history |
| GET | `/api/rentals/archived` | Archived trucks |
| GET | `/api/rentals/weekly-stats` | Weekly rental statistics |
| POST | `/api/rentals/weekly-manual` | Manual weekly entry |
| GET | `/api/rentals/summary` | Summary statistics |

#### Fleet Cost
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/fleet-cost/records` | All cost records |
| POST | `/api/fleet-cost/upload` | Upload cost data |
| POST | `/api/fleet-cost/upload-file` | File upload (multer) |
| POST | `/api/fleet-cost/upload-chunk` | Chunked upload |
| GET | `/api/fleet-cost/analytics` | Cost analytics |
| GET | `/api/fleet-cost/job/:jobId` | Check background job status |

#### Registration
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/registration` | Combined registration data (4 sources) |
| PATCH | `/api/registration/tracking/:truckNumber` | Update workflow checkboxes |
| POST | `/api/registration/import` | Import registration dates |

#### Samsara & UPS
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/samsara/test` | Test Samsara connection |
| GET | `/api/samsara/locations` | Get GPS locations |
| GET | `/api/ups/test` | Test UPS connection |
| GET | `/api/ups/track/:trackingNumber` | Track single package |

#### Tracking (UPS/FedEx/USPS)
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/tracking` | All tracking records |
| GET | `/api/trucks/:id/tracking` | Tracking records for a truck |
| POST | `/api/tracking` | Add tracking number |
| POST | `/api/tracking/:id/refresh` | Refresh single record |
| POST | `/api/tracking/refresh-all` | Refresh all active |
| DELETE | `/api/tracking/:id` | Remove tracking |

#### Decommissioning
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/decommissioning` | All decommissioning vehicles |
| PATCH | `/api/decommissioning/:id` | Update vehicle fields |
| DELETE | `/api/decommissioning/:id` | Remove vehicle |
| POST | `/api/decommissioning/import` | Import decommissioning data |
| POST | `/api/decommissioning/sync-tech-data` | Sync tech data from Snowflake |
| POST | `/api/decommissioning/sync-from-pos` | Sync from declined POs |
| POST | `/api/decommissioning/calculate-distances` | Calculate driving distances |
| POST | `/api/decommissioning/sync-parts-count` | Sync parts inventory data |

#### Maintenance Costs
| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/maintenance-costs/import` | Import maintenance cost data |
| GET | `/api/maintenance-costs` | Get maintenance costs |

#### Approved Costs
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/approved-cost/count` | Count approved cost records |
| GET | `/api/approved-cost/meta` | Import metadata |
| POST | `/api/approved-cost/upload` | Upload approved cost data |
| GET | `/api/approved-cost/analytics` | Approved cost analytics |

#### External API v1
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/external/vehicles` | External vehicle data access |
| GET | `/api/v1/external/repairs` | External repair data access |

#### BYOV (Bring Your Own Vehicle)
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/byov/technicians` | BYOV technician list |

---

## 8. Status System

### 8.1 Main Status Categories (14 total)

| Main Status | Color | Description |
|---|---|---|
| Confirming Status | Gray | Initial research phase |
| Decision Pending | Amber | Awaiting estimate or decision |
| Repairing | Amber | Vehicle under repair |
| Declined Repair | Red | Repair declined, heading to sale |
| Approved for sale | Red | Sale process underway |
| Tags | Amber | Registration/tags workflow |
| Scheduling | Amber | Scheduling tech pickup |
| PMF | Orange | At Park My Fleet facility |
| In Transit | Amber | Being transported |
| On Road | Green | Delivered to technician |
| Needs truck assigned | Gray | Awaiting assignment |
| Available to be assigned | Gray | Ready for assignment |
| Relocate Van | Amber | Needs relocation |
| NLWC - Return Rental | Red | Return rental van |

### 8.2 Sub-Statuses (25+ total)

Each main status has specific sub-statuses. Key examples:

- **Confirming Status**: SHS Confirming, SHS Researching, Holman Confirming, Location Unknown, Awaiting Tech Response, Declined Repair, Estimate Pending Decision
- **Decision Pending**: Awaiting estimate from shop, Estimate received needs review, Repair approved, Repair declined
- **Repairing**: Under repair at shop, Waiting on repair completion
- **Declined Repair**: Vehicle in process of being decommissioned, Vehicle submitted for sale, Vehicle was sold
- **Tags**: Needs tag/registration, Registration renewal in progress, Tags/registration complete, Mailed to tech needs a slot booked
- **Scheduling**: To be scheduled for tech pickup, Scheduled awaiting tech pickup
- **On Road**: Delivered to technician, Other tech swiped van

**Universal sub-status**: "Ordering duplicate tags" is available for ALL main statuses (auto-set when Reg. Sticker = "Ordered duplicates").

### 8.3 Auto-Status Update Rules

The system automatically changes statuses based on certain field changes:

| Trigger | Auto-Set Status |
|---|---|
| `vanPickedUp` = true | Main: "On Road", Sub: "Delivered to technician" |
| `spareVanAssignmentInProcess` = true | Main: "Scheduling", Sub: "To be scheduled for tech pickup" |
| Final Approval = "Approved for Sale" | Main: "Approved for sale" |
| Registration Sticker = "Ordered duplicates" | Sub: "Ordering duplicate tags" |

### 8.4 Status Migration

The system includes a comprehensive migration map (`OLD_TO_NEW_STATUS_MAP`) that converts legacy CSV status strings to the new hierarchical format. Examples:
- "Research required" → Confirming Status / SHS Confirming
- "Location confirmed, approved estimate, vehicle still in shop" → Repairing / Under repair at shop
- "Tech Picked Up" → On Road / Delivered to technician

---

## 9. Data Flow & Business Logic

### 9.1 Vehicle Lifecycle in Rentals Dashboard

```
[CSV Import] → Confirming Status → Decision Pending → Repairing
                                  ↘ Declined Repair → Approved for Sale → [Decommissioning]
                                                     
Repairing → Tags → Scheduling → In Transit → On Road → [Van Picked Up - Archived]
```

### 9.2 Rental Reconciliation Flow

1. User uploads current rental list (truck numbers)
2. System compares against existing `trucks` table
3. **New trucks** (in list, not in DB): Auto-created with "Confirming Status"
4. **Returned trucks** (in DB, not in list): Archived to `archived_trucks`, removed from `trucks`
5. **Matched trucks**: No change
6. Stats recorded in `rental_imports` table

### 9.3 Decommissioning Auto-Population

1. User sets PO Final Approval = "Decline and Submit for Sale"
2. System creates/updates entry in `decommissioning_vehicles`
3. Daily scheduler (7:35 AM ET) fetches tech data from Snowflake TPMS_EXTRACT
4. For trucks not in TPMS_EXTRACT: ZIP fallback finds nearest technician
5. OSRM calculates driving distances to tech ZIP and manager ZIP

### 9.4 Spare Vehicle Data Sync (Bidirectional)

```
Snowflake UNASSIGNED_VEHICLES → [Read] → Frontend display
User edits in UI → PATCH /api/spares/status → PostgreSQL spare_vehicle_details
                                            → Snowflake SPARE_VEHICLE_ASSIGNMENT_STATUS [Write]
```

### 9.5 All Vehicles Data Aggregation

The `/api/all-vehicles` endpoint aggregates from 7+ sources in a single request:

1. Snowflake REPLIT_ALL_VEHICLES (base data)
2. PostgreSQL trucks (repair status cross-reference)
3. PostgreSQL purchase_orders (declined repair identification)
4. Samsara API via Snowflake (GPS locations)
5. Snowflake Holman_VEHICLES (odometer, VIN)
6. Snowflake SPARE_VEHICLE_ASSIGNMENT_STATUS (confirmed addresses)
7. Fleet Finder API (additional locations)
8. BigDataCloud (reverse geocoding)
9. PostgreSQL vehicle_maintenance_costs (lifetime costs)

### 9.6 Registration Data Aggregation

The `/api/registration` endpoint combines:
1. Snowflake REPLIT_ALL_VEHICLES (base vehicle + reg expiry)
2. PostgreSQL trucks (identifies vehicles in repair shops)
3. Snowflake SPARE_VEHICLE_ASSIGNMENT_STATUS (spare vehicle reg dates)
4. Snowflake TPMS_EXTRACT (tech/manager info)
5. PostgreSQL registration_tracking (workflow checkboxes)

---

## 10. Weekly Snapshot Systems

Four automated systems capture historical trends, auto-captured every 6 hours:

### 10.1 BYOV Weekly Snapshots (`byov_weekly_snapshots`)
Tracks Bring Your Own Vehicle technician enrollment:
- Total enrolled technicians
- How many are found in fleet (assigned company vehicles)
- How many use personal vehicles

### 10.2 Fleet Weekly Snapshots (`fleet_weekly_snapshots`)
Tracks overall fleet assignment distribution:
- Total fleet count
- Assigned vs unassigned vs PMF counts

### 10.3 PMF Status Weekly Snapshots (`pmf_status_weekly_snapshots`)
Tracks PMF vehicle distribution by status:
- Available, Locked Down Local, Pending Arrival, Pending Pickup, Checked Out

### 10.4 Repair Weekly Snapshots (`repair_weekly_snapshots`)
Tracks repair pipeline volume:
- Total in repair, active repairs, completed this week

### 10.5 Pickup Weekly Snapshots (`pickup_weekly_snapshots`)
Tracks scheduled pickups using Saturday-Friday weekly windows:
- Pickups scheduled per week
- Historical data persists independently of vehicle deletions

---

## 11. File Structure

```
├── client/
│   ├── src/
│   │   ├── App.tsx                    # Router with all routes
│   │   ├── pages/
│   │   │   ├── AllVehicles.tsx        # Landing page - fleet overview
│   │   │   ├── Dashboard.tsx          # Rentals dashboard (main operational module)
│   │   │   ├── TruckDetail.tsx        # Individual truck detail view
│   │   │   ├── EditTruck.tsx          # Add/edit truck form
│   │   │   ├── Spares.tsx             # Spare vehicle management
│   │   │   ├── PMF.tsx                # Park My Fleet module
│   │   │   ├── POs.tsx                # Purchase orders
│   │   │   ├── FleetCost.tsx          # Fleet cost analytics
│   │   │   ├── Registration.tsx       # Registration tracking
│   │   │   ├── Decommissioning.tsx    # Decommissioning tracking
│   │   │   ├── ActionTracker.tsx      # Owner workload view
│   │   │   ├── ExecutiveSummary.tsx   # Status distribution cards
│   │   │   ├── MetricsDashboard.tsx   # KPI dashboard
│   │   │   ├── HolmanResearch.tsx     # Holman data research
│   │   │   ├── ProfileSelection.tsx   # User profile selection
│   │   │   └── ToolAudit.tsx          # PMF tool audit
│   │   ├── components/
│   │   │   ├── PMFMap.tsx             # Interactive US map for PMF
│   │   │   ├── PMFWeeklyTracker.tsx   # PMF weekly trends
│   │   │   ├── USMapVehicles.tsx      # US map for all vehicles
│   │   │   ├── FleetVehicleTable.tsx  # Reusable vehicle table
│   │   │   ├── StatusBadge.tsx        # Color-coded status badges
│   │   │   ├── ActionTimeline.tsx     # Action history display
│   │   │   ├── FlowSummary.tsx        # Status flow visualization
│   │   │   ├── MultiSelectFilter.tsx  # Multi-select dropdown filter
│   │   │   ├── IssueIndicator.tsx     # Issue warning indicators
│   │   │   ├── StatusReminder.tsx     # Status update reminders
│   │   │   └── ThemeToggle.tsx        # Dark/light mode toggle
│   │   ├── context/
│   │   │   └── UserContext.tsx         # User profile context
│   │   ├── hooks/
│   │   │   └── use-toast.ts           # Toast notification hook
│   │   └── lib/
│   │       └── queryClient.ts         # React Query client setup
│   └── index.html
├── server/
│   ├── routes.ts                      # All API routes (~8,600+ lines)
│   ├── storage.ts                     # Database CRUD operations (Drizzle)
│   ├── db.ts                          # Database connection
│   ├── snowflake.ts                   # Snowflake connection & queries
│   ├── samsara.ts                     # Samsara GPS API client
│   ├── pmf-api.ts                     # PARQ API client (OAuth2)
│   ├── ups.ts                         # UPS/FedEx/USPS tracking
│   ├── fleet-finder.ts               # Fleet Finder API client
│   ├── reverse-geocode.ts            # BigDataCloud reverse geocoding
│   ├── distance-calculator.ts        # OSRM distance calculations
│   ├── fleet-cost-jobs.ts            # Background job processing
│   ├── app.ts                        # Express app setup
│   ├── index-dev.ts                  # Dev server entry
│   └── index-prod.ts                 # Production server entry
├── shared/
│   └── schema.ts                     # Database schema + types + validation (~1,267 lines)
├── drizzle.config.ts                 # Drizzle ORM config
├── replit.md                         # Project documentation
└── package.json                      # Dependencies
```

---

## 12. Environment Variables & Secrets

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (Neon serverless) |
| `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` | Individual PostgreSQL connection params |
| `SESSION_SECRET` | Session encryption key |
| `SAMSARA_API_TOKEN` | Samsara GPS telematics API authentication |
| `PMF_CLIENT_ID` | PARQ API OAuth2 client ID |
| `PMF_CLIENT_SECRET` | PARQ API OAuth2 client secret |
| `PUBLIC_SPARES_API_KEY` | API key for external spares API access |
| `SENDGRID_API_KEY` | SendGrid email service |

**Snowflake credentials** are configured via key-pair authentication (private key stored separately).

---

## 13. Key Operational Concepts

### 13.1 Declined Repairs

254 vehicles are tracked as "active declined repairs" stored as a constant `ACTIVE_DECLINED_REPAIRS` Set in the frontend. These appear in the Total Fleet card count on All Vehicles and are cross-referenced across modules.

### 13.2 088-Prefix Truck Filtering

Trucks with numbers starting with "088" are filtered out from the Registration module's total count and monthly expiry calculations (they represent a special category not tracked for registration).

### 13.3 Action Tracker Owner Assignment

The Action Tracker assigns owners to trucks based on priority rules tied to status. Owner workload is displayed as cards showing how many trucks each person is responsible for.

### 13.4 Optimistic UI Updates

The Dashboard uses optimistic updates: when a user changes a field, the UI updates immediately while the API call happens in the background. If the call fails, the change is reverted and an error toast is shown.

### 13.5 Data Freshness

- **Snowflake data**: Refreshed on each page load (no local caching of base data)
- **Samsara GPS**: 5-minute cache TTL, persisted to database
- **PARQ/PMF**: Synced every 6 hours automatically, on-demand via manual sync button
- **Reverse geocoding**: 7-day cache TTL
- **Weekly snapshots**: Auto-captured every 6 hours

### 13.6 CSV/XLSX Import Pattern

Most modules follow the same import pattern:
1. User uploads file via UI (drag & drop or file picker)
2. Frontend parses with PapaParse (CSV) or SheetJS (XLSX)
3. Parsed data sent to backend API
4. Backend validates and upserts (matching by key column: truck number, PO number, etc.)
5. Stats returned to UI (added, updated, unchanged)
6. For large files (fleet cost): Background job processing with polling for status

### 13.7 Multi-Source Location Ranking

For the "Last Known Location" on All Vehicles, multiple location sources are compared by timestamp. The most recent valid location wins. State codes are validated against known US states, with fallback logic ensuring ~99% of vehicles have valid state data for map visualization.

### 13.8 Distance Calculation Caching

Decommissioning module calculates driving distances between vehicle ZIP codes and tech/manager ZIP codes using OSRM. Results are cached per ZIP pair — distances only recalculate when the relevant ZIP code changes (tracked via `lastManagerZipForDistance` and `lastTechZipForDistance` columns).

---

## Appendix: Quick Reference

### Vehicle Count Approximations (as of Feb 2026)
| Dataset | Count |
|---|---|
| Total Fleet (REPLIT_ALL_VEHICLES) | ~2,100+ |
| Rentals Dashboard (PostgreSQL trucks) | ~330 |
| Spare/Unassigned Vehicles | ~275 |
| PMF Vehicles | ~119 |
| Decommissioning Vehicles | ~163 |
| Samsara GPS-tracked | ~1,838 |
| Registration Tracked | ~2,147 |
| Active Declined Repairs | 254 |
| TPMS Tech Records | ~1,578 |

### Module Navigation
| Module | URL Path | Nav Button Location |
|---|---|---|
| All Vehicles | `/` | Landing page |
| Rentals Dashboard | `/dashboard` | Top nav bar |
| Spares | `/spares` | Top nav bar |
| PMF | `/pmf` | Top nav bar |
| Repairs | (within Dashboard) | Top nav bar |
| Fleet Cost | `/fleet-cost` | Top nav bar |
| Registration | `/registration` | Top nav bar |
| Purchase Orders | `/pos` | Within Dashboard sub-nav |
| Decommissioning | `/decommissioning` | Within Dashboard sub-nav |
| Executive Summary | `/executive-summary` | Within Dashboard sub-nav |
| Metrics | `/metrics` | Within Dashboard sub-nav |
| Action Tracker | `/action-tracker` | Within Dashboard sub-nav |
