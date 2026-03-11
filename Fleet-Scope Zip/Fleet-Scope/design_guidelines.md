# Design Guidelines: Fleet Repair Tracking System

## Design Approach
**System-Based Approach**: Material Design principles adapted for data-heavy enterprise use
- Prioritizes information density, scannability, and efficient data entry
- Clean, professional aesthetic suitable for daily operational use
- Emphasis on clarity over decoration

## Typography
**Font Stack**: Inter (Google Fonts) for UI, Roboto Mono for truck numbers/data fields
- **Headings**: Semi-bold (600), sizes: H1 (2rem), H2 (1.5rem), H3 (1.25rem)
- **Body**: Regular (400), 0.9375rem (15px) for table text, 1rem for forms
- **Data/Numbers**: Roboto Mono Medium (500), 0.875rem - ensures alignment in tables
- **Labels**: Medium (500), 0.8125rem, uppercase with letter-spacing

## Layout System
**Spacing Units**: Tailwind scale - consistently use 2, 3, 4, 6, 8, 12, 16
- Card padding: p-6
- Table cell padding: px-4 py-3
- Form groups: mb-6
- Section spacing: my-12
- Button spacing: px-4 py-2

**Grid Structure**:
- Dashboard: Full-width container (max-w-7xl)
- Detail pages: Two-column layout (2/3 main content + 1/3 sidebar for action history)
- Forms: Single column, max-w-2xl for optimal form completion

## Component Library

### Status Badges
Color-coded system for immediate visual scanning:
- Research required: Amber background, dark text
- Location confirmed - needs tag: Blue background
- Location confirmed - waiting on repair: Indigo background
- Repair complete - tag issue: Orange background
- Repair complete - ready for pickup: Green background
- Picked up / closed: Gray background
- Truck sold: Red background
- Unknown: Neutral gray

Implementation: Rounded full badges with medium weight text, px-3 py-1

### Data Table
- Zebra striping: Subtle gray alternating rows
- Sticky header with shadow on scroll
- Hover state: Light background highlight
- Sortable columns: Arrow indicators in header
- Cell alignment: Left for text, center for checkboxes/status, right for actions
- Compact row height: Displays 15-20 rows per viewport
- Border: Bottom borders only between rows

### Filter Bar
Horizontal filter strip above table:
- Dropdown selects for status filtering
- Checkbox group for binary filters (tag issues, research required, repair completed)
- Search input with magnifying glass icon (right-aligned in filter bar)
- Clear filters button
- Compact height: py-3

### Cards (Mobile & Detail Views)
- White background, subtle shadow (shadow-sm)
- Rounded corners (rounded-lg)
- Consistent padding: p-6
- Field groups: Label above value, mb-4 spacing

### Forms
- Full-width inputs with visible borders
- Labels: Above input, bold, mb-2
- Required field indicator: Red asterisk
- Input height: py-2.5
- Validation messages: Small red text below field
- Checkbox/radio groups: Vertical stack with spacing

### Action History Timeline
Vertical timeline in sidebar/bottom section:
- Left border accent line
- Each entry: Small circle marker, timestamp, user name, action type
- Most recent at top
- Condensed spacing: py-2 per entry
- Alternate background for action notes

### Navigation
Top bar (sticky):
- Application title/logo (left)
- Breadcrumb navigation (center)
- User info/settings (right)
- Height: 16 units
- Border bottom separator

### Buttons
- Primary: Solid fill, medium weight text, px-4 py-2
- Secondary: Outlined, same padding
- Sizes: Default (py-2), Small (py-1.5 for table actions)
- Icon buttons: Square aspect ratio for table row actions

## Responsive Strategy
**Desktop (lg+)**: Full table view, two-column detail layout
**Tablet (md)**: Simplified table (hide less critical columns), single column detail
**Mobile (base)**: Card-based list view replaces table, stacked forms, action history accordion

## Key Interactions
- Table row click: Navigate to detail view
- Status badges: No interaction (display only)
- Quick edit: Inline editing for status field with dropdown
- Filter application: Instant table update, no page reload
- Search: Debounced real-time filtering (300ms delay)

## Animations
**Minimal approach**:
- Table row hover: Subtle 150ms background transition
- Filter/search: 200ms fade for results update
- Success messages: Slide-in from top (300ms)

No complex animations - focus on data clarity and performance.