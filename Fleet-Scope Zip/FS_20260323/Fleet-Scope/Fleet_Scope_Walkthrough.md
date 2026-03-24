# Fleet Scope - Application Walkthrough

**Version:** February 2026
**URL:** fleet-scope.replit.app

---

## Table of Contents

1. [Getting Started](#1-getting-started)
2. [All Vehicles (Home Page)](#2-all-vehicles-home-page)
3. [Rentals Dashboard](#3-rentals-dashboard)
4. [Vehicle Detail Page](#4-vehicle-detail-page)
5. [Executive Summary](#5-executive-summary)
6. [Action Tracker](#6-action-tracker)
7. [Metrics Dashboard](#7-metrics-dashboard)
8. [Park My Fleet (PMF)](#8-park-my-fleet-pmf)
9. [Purchase Orders (POs)](#9-purchase-orders-pos)
10. [Spares](#10-spares)
11. [Fleet Cost](#11-fleet-cost)
12. [Registration](#12-registration)
13. [Holman Research](#13-holman-research)
14. [Decommissioning](#14-decommissioning)
15. [Data Import & Export](#15-data-import--export)
16. [Tips & Shortcuts](#16-tips--shortcuts)

---

## 1. Getting Started

When you first open Fleet Scope, you'll be asked to select your profile. This tells the system who you are so it can track actions and assign work appropriately.

**How to use:**
- Select your name from the list of team members
- Once selected, you'll be taken to the All Vehicles home page
- Your name appears in the sidebar and is used for action logging

**[Screenshot: Profile selection screen]**

The left sidebar is your main navigation. It lists all modules. Click any item to switch between views. You can collapse the sidebar using the toggle button at the top to get more screen space.

**[Screenshot: Sidebar navigation with all module links visible]**

---

## 2. All Vehicles (Home Page)

**Path:** `/` (Home)

This is the main landing page showing your entire fleet — over 2,100 vehicles. It pulls data from multiple sources (Snowflake, Samsara GPS, AMS, TPMS, Fleet Finder) and combines it into one view.

**[Screenshot: All Vehicles page showing the full table with scorecards at top]**

### Scorecards
At the top, you'll see summary cards showing key counts:
- **Total Vehicles** — the full fleet count
- **PMF Vehicles** — click this card to jump directly to the PMF module
- **Repair Shop Vehicles** — click this card to jump to the Rentals Dashboard
- Other summary statistics

**[Screenshot: Close-up of the scorecard row at the top of All Vehicles]**

### Vehicle Table
The table shows one row per vehicle with columns including:
- **Vehicle Number** and **VIN**
- **General Status** and **Sub Status** (computed from multiple data sources)
- **Last Known Location** — pulled from the most recent source (Samsara GPS, AMS, TPMS, Fleet Finder, or Confirmed address), with the source and timestamp shown
- **Odometer** — from Holman integration, matched by VIN
- **State** — the vehicle's state, pulled from technician data with a three-tier fallback (TPMS, AMS, XLS)

### Searching & Filtering
- Use the search bar to find vehicles by number
- Column filters are available for status, location source, and more
- The state column has colored indicators: "(AMS)" appears in amber, "(XLS)" in blue

**[Screenshot: All Vehicles table with a search active and some filtered results]**

---

## 3. Rentals Dashboard

**Path:** `/dashboard`

This is the core module for tracking rental/repair vehicles. It shows all trucks currently in the repair pipeline — roughly 330 vehicles.

**[Screenshot: Full Rentals Dashboard showing the table with all columns visible]**

### Top Controls
- **Outstanding Rentals count** — shows the total number of trucks in the system
- **Search bar** — search by truck number
- **Main Status filter** — dropdown to filter by the main status category
- **Sub-Status filter** — appears when a main status is selected
- **Issue filter** — filter for trucks with data issues
- **Import CSV / Export buttons** — bulk data operations

**[Screenshot: Close-up of the top control bar with search, status filters, and import/export buttons]**

### Table Columns
Each row represents one truck. Key columns (left to right):
- **ID** — row number
- **Truck #** — the vehicle number, with the tech's state shown underneath (with a colored dot indicating region)
- **Tech Name** — the technician assigned to this vehicle
- **Status** — clickable badge showing Main Status (color-coded: Green, Amber, Red, Orange, Gray). Click to change the status inline.
- **Assigned To** — the team member responsible. Click the badge to change assignment.
- **Assigned** — Yes/No indicator for whether the truck appears in Snowflake TPMS
- **Date In Repair** — when the truck entered the repair process (sortable)
- Additional columns: Reg. Sticker, Completed, In AMS, Reg. Expiry, UPS Status, Pick Up Slot, Gave Holman, Spare Van, Reg. Test Slot, Call Status, Days in Process, Bill Paid, Comments

**[Screenshot: Close-up of several table rows showing status badges, owner badges, and inline editing]**

### Column Filters
Under many column headers, you'll find multi-select filter dropdowns. These let you narrow the view to specific values:

- **Truck # column** has three filters:
  - Text filter for truck number
  - **State** — multi-select by state abbreviation
  - **Region** — multi-select by region with colored labels:
    - Blue dot = East Coast & Southeast
    - Amber dot = Central & Midwest
    - Green dot = West Coast & Deep South

**[Screenshot: Close-up of the Truck # column header showing the State and Region filter dropdowns side by side]**

**[Screenshot: Region filter dropdown opened, showing the three color-coded options]**

### Inline Editing
Most fields can be edited directly in the table:
- Click a **status badge** to change the main status from a dropdown
- Click an **owner badge** to reassign the truck to a different team member
- Click text fields (dates, comments, etc.) to edit them inline
- Changes save automatically and are logged in the action history

**[Screenshot: A row being edited inline — showing an open status dropdown or an active text input]**

### Sorting
- Click the **Date In Repair** column header to sort (click once for oldest first, again for newest first, third click to clear)
- **Reg. Expiry** and **Bill Paid** columns are also sortable
- Multiple sorts can be active at the same time

### Region Dots
Each truck's state abbreviation (shown under the truck number) has a small colored dot next to it:
- Blue dot = East Coast & Southeast states (VA, FL, NY, GA, MD, NC, PA, MA, CT, DE, RI, NJ, WV, ME, SC)
- Amber dot = Central & Midwest states (TX, IL, OH, KY, IN, MI, MO, TN, WI, IA, KS, OK, ND, NE, MN)
- Green dot = West Coast & Deep South states (CA, AL, AR, CO, MS, WA, AZ, ID, LA, OR, UT, HI)

Hover over the dot to see the full region name.

**[Screenshot: Close-up of a few truck rows showing the colored region dots next to state abbreviations]**

---

## 4. Vehicle Detail Page

**Path:** `/trucks/:id`

Click any truck number in the Rentals Dashboard to open its detail page.

**[Screenshot: Vehicle Detail page showing the two-column layout]**

### Layout
The page is split into two columns:
- **Left column** — All vehicle data organized in collapsible accordion sections
- **Right column** — Complete action history (audit trail) showing every change made to this truck

### Accordion Sections
The sections auto-expand based on the truck's current status to guide your workflow. Sections include vehicle info, repair details, registration, spare van info, and more.

**[Screenshot: Detail page with one or two accordion sections expanded]**

### Action History
The right column shows a timeline of every change made to this truck:
- Who made the change
- When it happened
- What fields were changed (with before/after values)
- This creates a complete audit trail for each vehicle

**[Screenshot: Action history column showing several logged changes with field diffs]**

---

## 5. Executive Summary

**Path:** `/executive-summary`

A high-level overview of fleet status, designed for quick reporting.

**[Screenshot: Executive Summary page showing status cards with counts and percentages]**

### Status Cards
Visual cards display truck counts grouped by main status:
- Each card shows the count and percentage of total
- Cards are color-coded to match the status badge colors
- **Click any card** to filter the Rentals Dashboard to just that status

### How to Use
This page is ideal for quick check-ins and reporting. Glance at the cards to see how many trucks are in each stage of the repair process, then click a card to drill down into the details.

---

## 6. Action Tracker

**Path:** `/action-tracker`

Shows workload distribution across team members, helping managers see who is responsible for what.

**[Screenshot: Action Tracker page showing owner-based cards with truck counts]**

### Owner Cards
Each team member gets a card showing:
- Their name
- How many trucks are assigned to them
- The trucks grouped by status

### Automatic Assignment
The system automatically assigns owners based on truck status and priority rules. When a truck's status changes, ownership may shift to the appropriate team member.

**[Screenshot: Close-up of one owner card showing assigned trucks grouped by status]**

---

## 7. Metrics Dashboard

**Path:** `/metrics`

Tracks key performance indicators (KPIs) over time.

**[Screenshot: Metrics Dashboard showing trend charts and summary numbers]**

### Features
- **KPI Cards** — current values for key metrics
- **30-Day Trends** — daily trend charts showing how metrics change over time
- **Weekly Summaries** — aggregated weekly data
- **Manual Snapshots** — click to capture a point-in-time snapshot of current metrics
- **Automated Snapshots** — the system automatically captures snapshots every 6 hours

**[Screenshot: Close-up of a trend chart showing 30-day daily data points]**

---

## 8. Park My Fleet (PMF)

**Path:** `/pmf`

Manages vehicles in the Park My Fleet program, integrated with the PARQ API.

**[Screenshot: PMF page showing the searchable table with status columns]**

### Features
- **Searchable Table** — find PMF vehicles quickly
- **CSV Upload** — bulk import PMF vehicle data
- **Status Flow Tracking** — tracks each vehicle through PMF status stages
- **Days Locked Down Local** — automatically calculates how many days a vehicle has been in "Locked Down Local" status (stops counting when status changes, restarts if it re-enters that status)
- **Activity Logs** — pulled from PARQ API showing vehicle activity history

### Status Events
The system tracks status changes for each PMF vehicle, creating a timeline of when the vehicle entered and exited each status.

**[Screenshot: A PMF vehicle row expanded to show status events or activity logs]**

---

## 9. Purchase Orders (POs)

**Path:** `/pos`

Tracks purchase orders related to fleet vehicles.

**[Screenshot: POs page showing summary cards and the searchable table]**

### Features
- **CSV/XLSX Import** — upload PO data with automatic upsert (updates existing records, adds new ones)
- **Summary Cards** — quick counts of POs by status or type
- **Searchable Table** — find specific POs
- **Time-Based Analytics** — track PO trends over time
- **Final Approval** — when a PO's Final Approval is set to "Decline and Submit for Sale," the vehicle automatically appears in the Decommissioning module

**[Screenshot: Close-up of PO summary cards and a few table rows]**

---

## 10. Spares

**Path:** `/spares`

Manages spare (unassigned) vehicles. Data comes from Snowflake and can be edited inline, with changes syncing back to both the local database and Snowflake.

**[Screenshot: Spares page showing the table with editable columns]**

### Editable Columns
Each spare vehicle has 6 editable status columns:
- **Keys** — dropdown: Yes / No / Unconfirmed
- **Repaired** — dropdown: Complete / In Process / Unknown if needed / Declined
- **Reg. Renewal Date** — date picker
- **Contact** — text field for name/phone (max 60 characters)
- **General Comments** — text area (max 500 characters)
- **Fleet Team Comments** — dropdown with 9 predefined options

All edits save automatically and sync to both PostgreSQL and Snowflake in real time.

**[Screenshot: Close-up of the Spares table showing the editable columns with dropdowns and text fields]**

### Last Edited
Each record shows when it was last edited, so you can see how fresh the data is.

**[Screenshot: A spare vehicle row showing the "Last Edited" timestamp]**

---

## 11. Fleet Cost

**Path:** `/fleet-cost`

Tracks fleet costs through uploaded spreadsheet data.

**[Screenshot: Fleet Cost page showing analytics charts and import history]**

### Features
- **XLSX Upload** — upload cost data files; large files are processed in the background
- **Import History** — see all past imports with timestamps
- **Analytics** — aggregated cost breakdowns:
  - Weekly totals
  - Monthly totals
  - Annual totals
  - Grouped by LINE_TYPE
- **Upsert Support** — re-uploading data updates existing records rather than creating duplicates

**[Screenshot: Fleet Cost analytics charts showing weekly/monthly cost breakdowns]**

---

## 12. Registration

**Path:** `/registration`

Manages vehicle registration data and tracking.

**[Screenshot: Registration page showing the registration table]**

### Features
- Registration tracking for fleet vehicles
- Status tracking for registration renewals
- Integrated with the main vehicle data

**[Screenshot: Close-up of registration table rows with status indicators]**

---

## 13. Holman Research

**Path:** `/holman-research`

Research tool for looking up vehicle data from the Holman integration.

**[Screenshot: Holman Research page]**

### Features
- Look up vehicle information by VIN or vehicle number
- View odometer readings and dates from Holman's system
- Cross-reference with fleet data

**[Screenshot: Holman Research results showing vehicle details and odometer data]**

---

## 14. Decommissioning

**Path:** `/decommissioning`

Tracks vehicles that have been approved for sale/decommissioning.

**[Screenshot: Decommissioning page showing the table with tech data columns]**

### How Vehicles Get Here
A vehicle automatically appears in Decommissioning when its Purchase Order's Final Approval is set to "Decline and Submit for Sale."

### Tech Data Columns
The system pulls 7 columns of technician data from Snowflake:
- Enterprise ID, Full Name, Mobile Phone, Primary ZIP
- Manager Enterprise ID, Manager Name, Manager ZIP

### Special Features
- **ZIP Code Fallback** — if a vehicle's truck number isn't found in the tech data, the system finds the nearest technician by ZIP code. These records show in orange text with "(nearest)" to distinguish them.
- **Assigned Column** — shows Yes (green) / No based on whether the truck number exists in the tech data. Filterable by All/Yes/No.
- **Distance Columns** (amber background):
  - **Tech Distance** — driving distance between the vehicle's ZIP and the tech's ZIP
  - **Manager Distance** — driving distance between the vehicle's ZIP and the manager's ZIP
- **Decom Done** — checkbox to mark when decommissioning is complete
- **Export XLSX** — download the full table as an Excel file

**[Screenshot: Decommissioning table showing tech data, distance columns with amber background, and the Assigned column]**

**[Screenshot: A ZIP fallback row showing orange text with "(nearest)" label]**

---

## 15. Data Import & Export

Fleet Scope supports bulk data operations across multiple modules.

### CSV Import (Rentals Dashboard)
1. Click the **Import CSV** button on the Dashboard
2. Select your CSV file
3. The system matches columns and imports the data
4. Existing trucks are updated; new ones are added

**[Screenshot: CSV import dialog or button on the Dashboard]**

### CSV/XLSX Import (POs, PMF, Fleet Cost)
Each module has its own upload button:
- **POs** — accepts CSV and XLSX files with automatic upsert
- **PMF** — CSV upload for PMF vehicle data
- **Fleet Cost** — XLSX upload with background processing for large files

### Export Options
- **CSV Export** — download Dashboard data as CSV
- **Excel Export** — download as formatted XLSX
- **Decommissioning Export** — dedicated XLSX export button

**[Screenshot: Export buttons visible on the Dashboard toolbar]**

---

## 16. Tips & Shortcuts

### General Tips
- **Filters persist** — your active filters and sort orders are saved in your browser. When you come back, they'll still be active.
- **Click scorecards** — on All Vehicles and Executive Summary, click the summary cards to jump directly to filtered views.
- **Inline editing** — almost everything in the tables can be edited by clicking on it. Changes save automatically.
- **Color coding** — status badges use consistent colors across the app:
  - Green = positive/complete
  - Amber = in progress/warning
  - Red = urgent/attention needed
  - Orange = special handling
  - Gray = inactive/pending

### Region Quick Reference
- **Blue** = East Coast & Southeast (VA, FL, NY, GA, MD, NC, PA, MA, CT, DE, RI, NJ, WV, ME, SC)
- **Amber** = Central & Midwest (TX, IL, OH, KY, IN, MI, MO, TN, WI, IA, KS, OK, ND, NE, MN)
- **Green** = West Coast & Deep South (CA, AL, AR, CO, MS, WA, AZ, ID, LA, OR, UT, HI)

### Keyboard Shortcuts
- Press **Enter** to save an inline edit
- Press **Escape** or click away to cancel an edit
- Use **Tab** to move between editable fields

### Data Freshness
- Snowflake data syncs automatically
- Samsara GPS data refreshes every 5 minutes
- UPS tracking refreshes every 30 minutes
- Weekly snapshots are captured every 6 hours
- Decommissioning tech data syncs daily at 7:35 AM ET

---

*This document was generated on February 19, 2026. For the latest features, visit fleet-scope.replit.app.*
