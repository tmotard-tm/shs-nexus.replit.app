# Fleet Scope - Migrate V2 Design Changes into V1

## Context

We have two versions of Fleet Scope:

- **V1 (production)** - the live app, currently owned by Luca and Tim. This is the codebase we are working in.
- **V2 (development fork)** - a separate Replit project where design/navigation work was done. We are NOT merging the V2 codebase. We are identifying the specific changes made in V2 and replicating them here in V1 manually.

The goal is to bring three specific improvements from V2 into V1 without touching any existing data logic, API connections, Snowflake queries, or backend functionality. All existing features must continue working exactly as they do today.

---

## What to Migrate

### 1. Sidebar Navigation (replacing the top nav bar)

Replace the current top navigation bar with a persistent, collapsible left sidebar. Keep all existing pages and routes exactly as they are - only the navigation chrome is changing.

**Sidebar structure:**

Action Center
- Today's Queue (/queue - placeholder page only, see Section 3)

Fleet Operations
- All Vehicles (/)
- Vehicle Search (/vehicle-search - placeholder page only, see Section 3)
- Spares (/spares)
- Park My Fleet (/pmf)
- Registration (/registration)

Repair Pipeline
- Rentals Dashboard (/dashboard)
- Purchase Orders (/pos)
- Decommissioning (/decommissioning)

Intelligence
- Discrepancy Finder (/discrepancies - placeholder page only, see Section 3)
- Fleet Cost (/fleet-cost)
- Executive Summary (/executive-summary)
- Metrics Dashboard (/metrics)

Tools
- Holman Research (/holman-research)
- Action Tracker (/action-tracker)

**Sidebar design requirements:**
- Collapsible via toggle button at top (expanded: ~240px, collapsed: ~60px icons only)
- Active/current page highlighted
- Group labels styled differently from page links (smaller, uppercase, muted color)
- Lucide React icons for each item
- Profile selector moves to the bottom of the sidebar
- Mobile: sidebar becomes a left drawer
- Remove the old top nav bar entirely
- Use Tailwind + Shadcn/ui, match the existing dark theme

---

### 2. Visual Consistency Pass

Do a polish pass across all existing pages. Do not change any functionality. Only update visual styling.

Specific changes:
1. Consistent card styling across all modules - same border-radius, shadow, and padding
2. Consistent table styling - same header colors, row hover states, and font sizes
3. Consistent status badge colors everywhere - use the same green/amber/red/blue/gray palette across all modules
4. Page titles should follow a consistent pattern: icon + title + subtitle
5. Consistent section spacing (use Tailwind space-y-6)
6. Loading states: skeleton loaders instead of blank screens
7. Error states: clear message with retry button instead of silent failures
8. Empty states: helpful message instead of blank tables

Keep the existing dark theme throughout.

---

### 3. Placeholder Pages

For the three new routes added in the sidebar, create simple placeholder pages. These are stubs only - no data, no logic, just a holding page.

Each placeholder should display:
- The page title and a relevant icon
- A short one-line description of what this page will do
- A "Coming Soon" badge or similar indicator
- Same styling as the rest of the app

Pages to create:

Route: /queue | Title: Today's Queue | Description: Your daily action items across the fleet
Route: /vehicle-search | Title: Vehicle Search | Description: Find available vehicles by ZIP code and specialty
Route: /discrepancies | Title: Discrepancy Finder | Description: Identify and resolve status conflicts across systems

---

## What NOT to Change

- Any Snowflake queries or data pipeline logic
- Any API routes or backend endpoints
- Any existing page functionality (filters, exports, imports, data tables)
- The profile selection system
- Any Samsara, Holman, Park My Fleet, or UPS integrations
- Authentication or access control logic

---

## Verification Checklist

Before finishing, confirm:

- [ ] All existing pages load with real data
- [ ] No regressions in any existing module
- [ ] Sidebar reaches every existing page
- [ ] Sidebar collapses and expands correctly
- [ ] Active page is highlighted in the sidebar
- [ ] Profile selection still works from the sidebar
- [ ] All three placeholder pages render at their routes
- [ ] Visual styling is consistent across all modules
- [ ] Loading, error, and empty states are handled gracefully
- [ ] Mobile/responsive behavior works for the sidebar drawer
