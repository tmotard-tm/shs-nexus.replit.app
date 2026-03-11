# Fleet Scope - Complete Application Guide

**Application URL:** fleet-scope.replit.app  
**Purpose:** Fleet Scope tracks Sears Home Services vans throughout their repair lifecycle, replacing a spreadsheet-based system. It manages ~330 rental/repair vehicles and ~2,100+ total fleet vehicles, providing real-time status tracking, repair coordination, and operational insights.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Profile Selection](#profile-selection)
3. [All Vehicles (Home Page)](#all-vehicles-home-page)
4. [Rentals Dashboard](#rentals-dashboard)
5. [Action Tracker](#action-tracker)
6. [Executive Summary](#executive-summary)
7. [Metrics Dashboard](#metrics-dashboard)
8. [Park My Fleet (PMF)](#park-my-fleet-pmf)
9. [Purchase Orders (POs)](#purchase-orders-pos)
10. [Spares](#spares)
11. [Fleet Cost](#fleet-cost)
12. [Registration](#registration)
13. [Decommissioning](#decommissioning)
14. [Holman Research](#holman-research)
15. [Status System & Workflow](#status-system--workflow)
16. [Owner Assignment Logic](#owner-assignment-logic)
17. [Data Sources & Integrations](#data-sources--integrations)
18. [Public API](#public-api)
19. [Automated Processes](#automated-processes)

---

## Getting Started

When you first open Fleet Scope, you'll be taken to the **Profile Selection** page. Choose your name from the list to identify yourself for audit trail purposes. Your selection is remembered in your browser, so you only need to do this once per device.

Once logged in, the left sidebar provides navigation to all modules. The sidebar can be collapsed using the toggle button at the top.

---

## Profile Selection

**Path:** `/profile`

This is the entry point to the application. Select your user profile from the available list. Your profile name is used to:
- Track who made changes to vehicle data
- Log actions in the audit trail
- Identify who performed data imports and exports
- Associate weekly consolidation records with a user

---

## All Vehicles (Home Page)

**Path:** `/`  
**Data Source:** Snowflake `REPLIT_ALL_VEHICLES` table (~2,100+ vehicles)

This is the main landing page after login. It provides a bird's-eye view of the entire fleet.

### What You'll See

**Fleet Overview Cards:**
- **Total Fleet** — Count of all active vehicles (excludes declined/auction vehicles)
- **On Road** — Vehicles currently assigned to technicians and in service
- **Repair Shop** — Vehicles at repair shops (Pep Boys, Firestone, etc.)
- **PMF Vehicles** — Vehicles at Park My Fleet storage lots (clickable, navigates to PMF tab)
- **Repair Shop Vehicles** — Vehicles in repair shops (clickable, navigates to Rentals Dashboard)

**Charts & Trends:**
- **Rental Vehicles Outstanding** — Line chart showing rental count over time
- **BYOV Enrollment History** — Tracks Bring Your Own Vehicle enrollment numbers
- **Pickup Schedule** — Upcoming van pickups by date

**Weekly Trends (Collapsible):**
- Fleet snapshot trends (vehicle counts by category over weeks)
- PMF status weekly snapshots (vehicles by PMF status over time)
- Repair weekly snapshots (repair shop vehicle counts over time)

**US Map:** Interactive map showing vehicle distribution across states, color-coded by density.

**Fleet Vehicle Table:** Scrollable table with all ~2,100+ vehicles showing:
- Vehicle Number, VIN, Make/Model
- General Status (On Road, PMF, Repair Shop, etc.)
- Sub Status (more specific categorization)
- Last Known Location (from multiple sources: GPS, AMS, TPMS, Samsara, PMF, Fleet Finder, or Confirmed address)
- Location source and timestamp
- Odometer reading (from Holman)

### How Location Data Works

The system pulls location from multiple sources and picks the most recent one:
1. **Samsara GPS** — Real-time telematics from the Samsara system via Snowflake
2. **AMS** — Asset Management System current address
3. **TPMS** — Technician Parts Management System last known address
4. **PMF** — Park My Fleet lot location
5. **Fleet Finder** — Manual fleet finder entries
6. **Confirmed** — Manually verified addresses from the Spares tab

The location with the most recent timestamp wins.

### Filtering

Click on any scorecard to filter the table. For example, clicking "PMF Vehicles" navigates to the PMF tab, and clicking "Repair Shop Vehicles" navigates to the Rentals Dashboard.

---

## Rentals Dashboard

**Path:** `/dashboard`  
**Data Source:** PostgreSQL `trucks` table (~330 rental/repair vehicles)

This is the primary workspace for the team managing rental and repair vehicles. It tracks each vehicle from the moment it enters the repair process until it's back on the road.

### Summary Cards
- **Total Rentals** — Number of vehicles currently tracked
- **Average Duration** — Average days vehicles have been in the repair pipeline
- **Top 5 States** — States with the most vehicles in the system

### Key Features

**Search & Filter:**
- Search by truck number
- Filter by Main Status (dropdown)
- Filter by Sub Status (dropdown, changes based on selected Main Status)
- Filter by Issues (missing data indicators)
- Multi-select column filters for: State, Assigned To, Assigned (Snowflake), Registration Sticker, UPS Status, Completed, AMS, Rental Returned, Van Picked Up, Spare Van

**Table Columns (scrollable):**
- Truck Number
- SHS Owner (who is responsible for this vehicle)
- Status (combined Main + Sub status, color-coded badge)
- State (tech's state from Snowflake)
- Date Put in Repair
- Registration Sticker Valid (Yes/Expired/Shop would not check)
- Reg. Expiry (registration expiration date)
- Repair Address, Phone, Contact Name
- Tech Name, Tech Phone (from Snowflake TPMS_EXTRACT)
- Various tracking checkboxes (AMS Documented, Confirmed Tags, Pick Up Slot Booked, etc.)
- UPS Tracking (auto-fetches tracking status)
- Bill Paid (date)
- Comments

**Inline Editing:**
Most fields can be edited directly in the table by clicking on them. Changes are saved automatically and logged in the action history.

**Data Import Options:**
1. **Import CSV** — Upload a CSV file with truck data (truckNumber, status, datePutInRepair, repairAddress, etc.)
2. **Import Call Status** — Upload CSV/XLSX with call status updates
3. **Bulk Sync** — Paste truck numbers to synchronize the list (trucks not on the list are removed, missing ones are added)
4. **Weekly Truck Consolidation** — Compare current truck list with a new list to track additions, removals, and unchanged vehicles

**Sync Operations:**
- **Sync Tech Data** — Pulls tech names and phone numbers from Snowflake TPMS_EXTRACT
- **Refresh UPS** — Updates UPS tracking statuses for packages with tracking numbers

**Export:**
- Export to CSV
- Export to Excel (XLSX)

### Intended Workflow

1. A vehicle enters the repair pipeline and gets added (via Import or Bulk Sync)
2. It starts as **"Confirming Status / SHS Confirming"** — the team needs to locate the vehicle and confirm its situation
3. The team researches the vehicle, calls repair shops, contacts techs
4. Status progresses through: Confirming Status → Decision Pending → Repairing → Tags → Scheduling → On Road
5. Along the way, various checkboxes are checked as milestones are completed
6. When the van is picked up, marked "Van Picked Up" and eventually "On Road", it's considered done

---

## Action Tracker

**Path:** `/action-tracker`

This page shows a workload view organized by team member. Each person has a card showing how many vehicles they're responsible for, based on automatic owner assignment rules.

### How It Works

Vehicles are automatically assigned to team members based on their current status:

| Status | Assigned To | Role |
|--------|-------------|------|
| Confirming Status, Decision Pending (most), Repairing, In Transit | Oscar S | Research & Repair Coordination |
| Tags | John C | Tag & Registration |
| Scheduling | Mandy R | Pickup Coordination |
| Decision Pending + "Estimate received, needs review" | Rob A | PO & Decision Review |
| Declined Repair (not sold), PMF | Bob B | Fleet Disposition |
| Approved for sale + "Clearing Softeon Inventory" or "VTF completed" | Jenn D. | Inventory Management |
| Approved for sale + "Fleet Admin review" or "Procurement transfer" | Bob B | Fleet Disposition |
| Approved for sale + "Leadership to approve Docusign" | Samantha W | Leadership Approval |
| On Road, Vehicle was sold, or Van Picked Up | Final Actioned | Complete |

### What You'll See

Each team member gets a card showing:
- Their name and role
- Number of vehicles assigned
- List of those vehicles with current status
- Color-coded by urgency

Click on a person's card to see the detailed list of their assigned vehicles.

---

## Executive Summary

**Path:** `/executive-summary`

A high-level overview designed for leadership review.

### What It Shows

- **Total Vehicles in System** — Large number showing the rental/repair fleet size
- **Status Breakdown Cards** — One card per Main Status showing:
  - Count of vehicles in that status
  - Percentage of total
  - Color-coded icon
  - Clickable — navigates to the All Vehicles page filtered by that status
- **Status Breakdown List** — Same data in a sorted list format (highest count first)
- **Consolidation History** — Table showing weekly truck list changes:
  - Week identifier
  - Date of consolidation
  - Who performed it
  - Trucks Added / Removed / Unchanged

---

## Metrics Dashboard

**Path:** `/metrics`

Tracks Key Performance Indicators (KPIs) over time.

### Features

- **Manual Snapshot Capture** — Click to save a point-in-time snapshot of current metrics
- **30-Day Daily Trends** — Chart showing daily metric values
- **Weekly Summaries** — Aggregated weekly view of metrics

This page helps track whether the fleet operation is improving over time (e.g., are vehicles spending less time in repair?).

---

## Park My Fleet (PMF)

**Path:** `/pmf`  
**Data Source:** PARQ API (Park My Fleet vendor) + PostgreSQL `pmf_rows` table

PMF manages vehicles that are stored at Park My Fleet lots across the country when they're not assigned to technicians.

### Key Components

**Processing Pipeline:**
A visual flow at the top showing how vehicles move through PMF statuses:
- **Available** → Vehicle is at a PMF lot and ready to be assigned
- **Locked Down Local** → Vehicle is locked down at a local PMF lot (being processed)
- **Locked Down Off Lot** → Vehicle is locked down but not at the lot yet
- **Pending Arrival** → Vehicle is in transit to a PMF lot
- **Approved to Pick Up** → Vehicle has been approved for pickup by a tech
- **Deployed** → Vehicle has been deployed (labeled "Deployed" in the UI, maps to "Unavailable" in the API)
- **Reserved** → Vehicle is reserved for a specific purpose

Click any pipeline step to filter the table to vehicles in that status.

**Summary Cards:**
- Total PMF Vehicles
- Count by each status
- Status distribution

**US Map:**
Interactive map showing PMF vehicle locations by state. Filter by status using the dropdown (Available, Locked Down Local, Pending Arrival, Approved to Pick Up).

**Weekly Status Flow Tracker:**
Shows how vehicles move between statuses week over week.

**Vehicle Table:**
- Asset ID (vehicle number)
- Status (current PMF status)
- Days In Process — How many days the vehicle has been in "Locked Down Local" status
  - Green: 0-14 days
  - Amber: 15-30 days
  - Red: 30+ days
  - Stops counting when the vehicle leaves "Locked Down Local" and freezes at that number
  - Restarts if the vehicle re-enters "Locked Down Local"
- Location, City, State, ZIP
- Activity History (expandable — shows all activities logged for the vehicle)

**Data Management:**
- **Upload CSV** — Import PMF data from CSV files
- **Sync PARQ API** — Pull latest data from the Park My Fleet vendor API
- **Activity Log Sync** — Pull activity logs from PARQ API for each vehicle

**Tool Audit:**
Click on an Asset ID to view the Tool Audit page (`/pmf/tool-audit/:assetId`), which shows detailed tool inventory and audit information for that vehicle.

### Intended PMF Workflow

1. A spare/unassigned vehicle is identified
2. It's added to the PMF system (via CSV upload or PARQ API sync)
3. It enters as "Available" or "Locked Down Local"
4. The vehicle goes through processing (registration checks, repairs, etc.)
5. It moves through statuses: Locked Down → Available → Approved to Pick Up → Deployed
6. When deployed to a technician, it leaves the PMF system

---

## Purchase Orders (POs)

**Path:** `/pos`  
**Data Source:** PostgreSQL `po_imports` table (JSONB storage)

Manages repair purchase orders — the financial side of vehicle repairs.

### Summary Cards
- **Total POs** — Total number of purchase orders imported
- **Pending Approvals** — POs awaiting a decision
- **Approved Repairs** — POs that have been approved
- **Declined / Submit for Sale** — POs where repair was declined and vehicle is being decommissioned
- **Last Import** — When data was last imported

### Key Features

**Import:**
- Upload CSV or XLSX files with PO data
- System asks you to select which column is the PO identifier
- Uses upsert logic — re-importing updates existing records while preserving Final Approval values

**Table:**
- Searchable across all columns
- Filterable by: Rob's Decision, Difference, Final Approval, Submitted in Holman, Vehicle Number
- Columns are ordered with decision-related columns first for easy review
- **Final Approval** — Editable dropdown with options like:
  - Approve Repair
  - Decline and Submit for Sale
  - Needs more information
  - etc.
- **Submitted in Holman** — Checkbox to track if the PO has been submitted in the Holman system

**Analytics Sections (Collapsible):**
- **In Process - Following Up** — Breakdown of POs by approval status
- **Imports by Time Period** — Shows import history over time

**Sync to Dashboard:**
When a PO's Final Approval is set to "Decline and Submit for Sale", the vehicle is automatically flagged in the Decommissioning module.

**Export:**
- Export to Excel (XLSX)

### Intended PO Workflow

1. PO data is exported from the finance/procurement system as CSV/XLSX
2. Uploaded to Fleet Scope
3. Team reviews each PO, comparing GPT recommendations vs. Rob's decision
4. Final Approval is set for each PO
5. Approved repairs continue in the repair pipeline
6. Declined repairs trigger decommissioning workflow

---

## Spares

**Path:** `/spares`  
**Data Source:** Snowflake `UNASSIGNED_VEHICLES` + PostgreSQL `spare_vehicle_details`

Manages vehicles that are not currently assigned to any technician — "spare" vehicles.

### Two Table Views

**1. Other Locations (Non-Repair Shop)**
Spare vehicles at various locations (tech homes, PMF lots, parking lots, etc.)

**2. Repair Shop Locations**
Spare vehicles currently at repair shops

### Editable Columns

Each vehicle row has these editable fields that save to both PostgreSQL and Snowflake:

| Column | Type | Description |
|--------|------|-------------|
| **Keys** | Dropdown: Yes / No / Unconfirmed | Whether the vehicle keys are present |
| **Repaired** | Dropdown: Complete / In Process / Unknown if needed / Declined | Repair status |
| **Reg. Renewal** | Date picker | Registration renewal date |
| **Contact** | Text (60 chars max) | Contact name and phone number |
| **General Comments** | Text area (500 chars max) | General notes about the vehicle |
| **Fleet Team Comments** | Dropdown with 9 predefined options + custom | Fleet team's decision/notes |
| **Confirmed Address** | Text (500 chars max) | Manually confirmed vehicle address |

All edits are saved to both:
- PostgreSQL (`spare_vehicle_details` table) for the app
- Snowflake (`SPARE_VEHICLE_ASSIGNMENT_STATUS`) for cross-system visibility

### Additional Features

- **Search** — Filter by vehicle number or any text
- **Declined Badge** — Vehicles with declined repairs show a red "Declined" badge
- **Add Manual Vehicle** — Manually add a vehicle that isn't in the Snowflake source
- **Auto-Cleanup** — Manually-added trucks are automatically removed if they become assigned in TPMS_EXTRACT (daily check)

### Intended Spares Workflow

1. Snowflake provides the list of unassigned vehicles
2. Team investigates each vehicle — calls repair shops, contacts techs
3. Updates the editable columns with findings (location confirmed, keys present, repair status, etc.)
4. Decides whether to send to PMF, assign to a tech, or decommission
5. Fleet Team Comments captures the final decision

---

## Fleet Cost

**Path:** `/fleet-cost`  
**Data Source:** PostgreSQL `fleet_cost_records` (JSONB) + `approved_cost_records`

Tracks the financial costs of fleet operations through XLSX uploads.

### Two Data Types

**1. Paid POs (Division 01 & RF)**
- Actual paid purchase orders
- Upload via XLSX file
- Large files processed in background (progress polling)
- Broken down by LINE_TYPE

**2. Approved POs - Pending Billing**
- POs that are approved but not yet paid
- Upload via XLSX file
- Broken down by Rental vs. Other Fleet Costs

### Analytics Views

Switch between Paid and Approved using the dropdown.

**Three time-based views for each:**
- **Annual** — Year-over-year cost totals by category
- **Monthly** — Month-by-month breakdown within a year
- **Weekly** — Week-by-week granular view within months

### Import History
Shows when data was last imported and by whom.

### Intended Workflow

1. Finance team exports cost data from their system as XLSX
2. Upload to Fleet Cost module
3. Review analytics to understand spending patterns
4. Compare Paid vs. Approved to track the billing pipeline
5. Identify cost trends by line type, month, and week

---

## Registration

**Path:** `/registration`  
**Data Source:** PostgreSQL `trucks` table + Snowflake tech data + PMF data

Manages vehicle registration renewals — tracking which trucks need new registration stickers and coordinating the mailing process.

### What It Shows

**Summary Section:**
- Monthly breakdown of expiring registrations
- Visual timeline showing which months have the most expirations
- Progress indicators: if "Already Sent" or "Submitted to Holman" is checked, earlier steps are considered done

**Table Columns:**
- Truck Number (with "Declined" badge if applicable)
- Year/Make/Model
- VIN
- State
- Reg. Expiry Date
- Days to Expiry (sortable, color-coded by urgency)
- Initial Text Sent (checkbox)
- Time Slot (confirmed appointment)
- Submitted to Holman (checkbox)
- Already Sent (checkbox)
- **PMF Filter** — Shows "Yes" (green badge) if the vehicle is in PMF with "Locked Down Local" status AND has "Registration Stickers Needed" activity
- LDAP, Tech Name, Tech Phone, Tech Address
- Tech Lead, Tech Lead Phone
- Comments

**Export:**
- Export to XLSX (includes PMF Filter column)

### Intended Workflow

1. View upcoming registration expirations sorted by urgency
2. Contact the technician to arrange registration renewal
3. Mark "Initial Text Sent" when first contact is made
4. Confirm a time slot
5. Submit to Holman for processing
6. Mark "Already Sent" when stickers are mailed
7. Use PMF Filter to identify vehicles that need stickers at PMF locations

---

## Decommissioning

**Path:** `/decommissioning`  
**Data Source:** PostgreSQL `decommissioning_vehicles` + Snowflake TPMS_EXTRACT

Tracks vehicles that are being removed from the fleet — those with "Decline and Submit for Sale" as their PO Final Approval.

### How Vehicles Get Here

Vehicles are **auto-populated** when a PO's Final Approval is set to "Decline and Submit for Sale" in the POs module.

### Table Columns

**Vehicle Info:**
- Truck Number, VIN, Address, ZIP Code, Phone
- Comments (editable)
- Still Not Sold (checkbox)
- Decom Done (checkbox — marks completion)

**Tech Data (from Snowflake TPMS_EXTRACT):**
- Enterprise ID
- Full Name
- Mobile Phone
- Primary ZIP
- Manager Ent ID
- Manager Name
- Manager ZIP

**Distance Columns (amber background):**
- **Tech Distance** — Driving distance from vehicle ZIP to Tech ZIP (Primary ZIP)
- **Manager Distance** — Driving distance from vehicle ZIP to Manager ZIP
- Both use OSRM routing API for accurate driving distances
- Cached — only recalculated when ZIP codes change
- Filterable: checkbox to show only distances < 160 miles

**Assigned Column:**
- Shows Yes/No based on whether the truck number is currently in TPMS_EXTRACT
- "Yes" appears in green
- Filterable dropdown (All/Yes/No)

### ZIP Code Fallback

When a vehicle's truck number doesn't match any record in TPMS_EXTRACT:
- The system finds the nearest technician by comparing the vehicle's ZIP code to all Primary ZIPs
- Populates manager info from that nearest tech's record
- These records display in **orange text** with "(nearest mgr)" label to distinguish from direct matches

### Sync & Export

- **Sync Tech Data** — Pull latest data from Snowflake TPMS_EXTRACT
- **Daily Auto-Sync** — Runs automatically at 7:35 AM ET; preserves existing data if a truck is removed from Snowflake
- **Export XLSX** — Download the full table as an Excel file

### Intended Workflow

1. PO is declined → vehicle automatically appears in Decommissioning
2. Sync tech data to get the assigned technician's info
3. Contact the tech or their manager to arrange vehicle pickup
4. Use distance columns to determine logistics
5. Track progress with comments and checkboxes
6. Mark "Decom Done" when the vehicle has been successfully decommissioned

---

## Holman Research

**Path:** `/holman-research`

A research tool for looking up vehicle information in the Holman system. Used when the team needs to investigate a vehicle's repair history, maintenance records, or current status in Holman's database.

---

## Status System & Workflow

Fleet Scope uses a hierarchical status system with **Main Status** and **Sub Status**.

### Main Statuses (in workflow order)

| Main Status | Description | Color |
|-------------|-------------|-------|
| **Confirming Status** | Vehicle is being researched/located | Amber |
| **Decision Pending** | Waiting for a repair decision | Purple |
| **Repairing** | Vehicle is actively being repaired | Blue |
| **Declined Repair** | Repair was declined, vehicle may be sold | Red |
| **Approved for sale** | Vehicle approved for decommissioning | Red |
| **Tags** | Waiting for registration tags | Blue |
| **Scheduling** | Pickup is being scheduled | Teal |
| **PMF** | Vehicle is at Park My Fleet | Cyan |
| **In Transit** | Vehicle is being transported | Blue |
| **On Road** | Vehicle is back in service (complete) | Green |
| **Needs truck assigned** | Tech needs a vehicle | Orange |
| **Available to be assigned** | Vehicle ready for assignment | Green |
| **Relocate Van** | Vehicle needs to be moved | Amber |
| **NLWC - Return Rental** | No longer working, return the rental | Gray |

### Sub Statuses

Each Main Status has specific Sub Statuses. For example:

**Confirming Status:**
- SHS Confirming
- SHS Researching
- Holman Confirming
- Location Unknown
- Awaiting Tech Response
- Declined Repair
- Estimate Pending Decision
- Ordering duplicate tags

**Decision Pending:**
- Awaiting estimate from shop
- Estimate received, needs review
- Repair approved
- Repair declined
- Ordering duplicate tags

**Repairing:**
- Under repair at shop
- Waiting on repair completion
- Ordering duplicate tags

**Approved for sale:**
- Clearing Softeon Inventory
- Vehicle Termination Form completed
- Termination Form Approved
- Fleet Administrator review
- Procurement to transfer form to leadership
- Leadership to approve Docusign
- Declined Docusign

*(And so on for each Main Status)*

### Automatic Status Rules

Certain actions trigger automatic status changes:
- Setting **"Van Picked Up"** to true → Automatically changes status
- Setting **"Spare Van Assignment In Process"** → Updates status accordingly
- Setting Final Approval to **"Approved for Sale"** → Triggers decommissioning flow

### Status Color Coding

Status badges throughout the app use consistent colors:
- **Green** — Good / Complete (On Road, Available)
- **Amber/Yellow** — In Progress / Needs Attention
- **Red** — Critical / Declined
- **Blue** — Active Work (Repairing, Tags)
- **Gray** — Inactive / Closed

---

## Owner Assignment Logic

The Action Tracker automatically assigns vehicles to team members. Here's the complete priority order:

1. **Final Actioned** — Vehicle is "On Road", "Vehicle was sold", or "Van Picked Up" = true
2. **Rob A** — "Decision Pending" + "Estimate received, needs review"
3. **Bob B** — "Declined Repair" (not sold) or "PMF" status
4. **Jenn D.** — "Approved for sale" + "Clearing Softeon Inventory" or "Vehicle Termination Form completed"
5. **Bob B** — "Approved for sale" + "Fleet Administrator review" or "Procurement to transfer form to leadership"
6. **Samantha W** — "Approved for sale" + "Leadership to approve Docusign"
7. **Oscar S** — "Approved for sale" + any other sub-status
8. **John C** — "Tags" main status
9. **Mandy R** — "Scheduling" main status
10. **Oscar S** — Everything else (Confirming Status, Decision Pending general, Repairing, In Transit, etc.)

---

## Data Sources & Integrations

### Snowflake (Primary Data Warehouse)

| Table | Schema | Purpose |
|-------|--------|---------|
| REPLIT_ALL_VEHICLES | PARTS_SUPPLYCHAIN.FLEET | All ~2,100+ fleet vehicles with status, location, GPS |
| TPMS_EXTRACT | PARTS_SUPPLYCHAIN.SOFTEON | Technician-to-vehicle assignments, tech contact info |
| TPMS_EXTRACT_LAST_ASSIGNED | PARTS_SUPPLYCHAIN.SOFTEON | Last known tech assignment (for unassigned vehicles) |
| UNASSIGNED_VEHICLES | PARTS_SUPPLYCHAIN.FLEET | Spare vehicles not assigned to any tech |
| SPARE_VEHICLE_ASSIGNMENT_STATUS | PARTS_SUPPLYCHAIN.FLEET | Editable spare vehicle data (synced both ways) |
| Holman_VEHICLES | PARTS_SUPPLYCHAIN.FLEET | Odometer data matched by VIN |
| SAMSARA_STREAM | BI_ANALYTICS.APP_SAMSARA | Real-time GPS telematics (1,138 vehicles) |
| ORA_TECH_HIRE_ROSTER_VW | PARTS_SUPPLYCHAIN.SOFTEON | Tech specialty and employment data |
| ORA_TECH_ACTIVE_ROSTER_FWE_VW_VIEW | PARTS_SUPPLYCHAIN.SOFTEON | Fallback tech roster data |
| AMS_XLS_EXPORTS | PARTS_SUPPLYCHAIN.FLEET | AMS export data for state fallback |

### External APIs

| Service | Purpose |
|---------|---------|
| **PARQ API** | Park My Fleet vehicle management, activity logs, status tracking |
| **Samsara** | Vehicle GPS telematics (via Snowflake, 5-min cache) |
| **BigDataCloud** | Reverse geocoding (GPS coords → addresses, 7-day cache) |
| **OSRM** | Driving distance calculations for Decommissioning |
| **Zippopotam.us** | ZIP code to GPS coordinates for distance calculations |
| **UPS** | Package tracking for registration sticker shipments |
| **SendGrid** | Email notifications |

### PostgreSQL (Application Database)

Stores all application-managed data:
- `trucks` — Rental/repair vehicle records
- `actions` — Audit trail for all changes
- `pmf_rows` — PMF vehicle data
- `pmf_status_events` — PMF status change tracking
- `pmf_activity_logs` — PMF activity history from PARQ API
- `po_imports` — Purchase order data (JSONB)
- `spare_vehicle_details` — Spare vehicle editable data
- `fleet_cost_records` — Fleet cost data (JSONB)
- `decommissioning_vehicles` — Vehicles being decommissioned
- Various weekly snapshot tables for trend tracking

---

## Public API

Fleet Scope exposes public API endpoints for external applications.

### Rentals API (No Authentication Required)

| Endpoint | Description |
|----------|-------------|
| `GET /api/public/rentals` | All trucks with mainStatus/subStatus |
| `GET /api/public/rentals/:truckNumber` | Single truck lookup |

### Spares API (Requires API Key)

All Spares API endpoints require an `X-API-Key` header with the `PUBLIC_SPARES_API_KEY` value.

| Endpoint | Description |
|----------|-------------|
| `GET /api/public/spares` | All spare vehicles with editable data |
| `GET /api/public/spares/:vehicleNumber` | Single spare vehicle lookup |
| `POST /api/public/spares/:vehicleNumber` | Update spare vehicle data |

**POST fields accepted:**
- `keys` — Present/Not Present/Unknown (normalized to Yes/No/Unconfirmed)
- `repaired` — Complete/In Process/Unknown if needed/Declined
- `contact` — Contact info (max 60 chars)
- `confirmedAddress` — Confirmed address (max 500 chars)
- `generalComments` — General comments (max 500 chars)
- `fleetTeamComments` — Fleet team comments (max 150 chars)

**Field name aliases:** `newLocation` → confirmedAddress, `newLocationContact` → contact, `comments` → generalComments, `postOffboardedStatus` → fleetTeamComments

**Input normalization:** Accepts snake_case and lowercase (e.g., `in_repair` → `In repair`). Vehicle numbers are auto-padded to 6 digits.

---

## Automated Processes

### Scheduled Jobs

| Job | Frequency | Description |
|-----|-----------|-------------|
| **PARQ API Sync** | Periodic | Syncs PMF vehicle data from PARQ API |
| **Activity Log Sync** | Every 6 hours | Pulls activity logs from PARQ API for all PMF vehicles |
| **Weekly Snapshots** | Every 6 hours | Captures BYOV, Fleet, PMF Status, and Repair snapshots |
| **Decom Tech Data Sync** | Daily at 7:35 AM ET | Syncs tech data from Snowflake for decommissioning vehicles |
| **Spares Cleanup** | Daily | Removes manually-added spare trucks that are now assigned in TPMS_EXTRACT |

### Audit Trail

Every significant data change is logged in the `actions` table with:
- What changed (field-level diffing)
- Who made the change
- When it happened
- The old and new values

This provides a complete history of every vehicle's journey through the system.

---

## Tips & Best Practices

1. **Always use Bulk Sync** to update the rental truck list weekly — it preserves existing data while adding/removing trucks
2. **Check the Action Tracker** daily to see your assigned vehicles and priorities
3. **Use the Executive Summary** for leadership reporting — it shows the current state at a glance
4. **Export to Excel** for offline analysis or sharing with stakeholders
5. **Sync Tech Data** before reviewing the Rentals Dashboard to ensure contact information is current
6. **Use PMF Filter** in Registration to quickly identify vehicles needing stickers at PMF locations
7. **Check the Decommissioning tab** after setting PO Final Approvals to "Decline and Submit for Sale"
8. **Review Fleet Cost analytics** monthly to track spending trends
9. **Comments are important** — they provide context that the system can't capture automatically
10. **The status system is your friend** — keeping statuses current ensures accurate reporting and proper owner assignment
