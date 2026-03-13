# Fleet Scope — Visual Design Specification

**Purpose:** Complete visual/aesthetic reference for replicating Fleet Scope's look and feel in another application.
**Last Updated:** March 11, 2026

---

## 1. Typography

### Font Families
| Usage | Font | Weight(s) | Fallback | Google Fonts URL |
|---|---|---|---|---|
| Body / UI text | **Inter** | 400 (Regular), 500 (Medium), 600 (Semibold), 700 (Bold) | system-ui, sans-serif | `fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700` |
| Monospace / code | **Roboto Mono** | 400, 500 | monospace | `fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;500` |

### Font Sizes (Tailwind scale, rem-based, 1rem = 16px)
| Token | Size | Usage |
|---|---|---|
| `text-xs` | 0.75rem (12px) | Badge text, small labels, metadata |
| `text-sm` | 0.875rem (14px) | Table cells, form inputs, buttons, most body text |
| `text-base` | 1rem (16px) | Mobile input text |
| `text-lg` | 1.125rem (18px) | Dialog titles |
| `text-2xl` | 1.5rem (24px) | Card titles |
| `text-3xl` | 1.875rem (30px) | Page headings |

### Font Weights
| Weight | Value | Usage |
|---|---|---|
| Regular | 400 | Body text, table cells |
| Medium | 500 | Table headers, tab triggers, button text |
| Semibold | 600 | Badge text, card titles, section labels |
| Bold | 700 | Page headings, emphasis |

### Letter Spacing
| Token | Value | Usage |
|---|---|---|
| `tracking-normal` | 0em | Default |
| `tracking-labels` | 0.05em | Sidebar group labels |

---

## 2. Color System

All colors use HSL format. CSS custom properties are defined in `:root` (light) and `.dark` (dark mode).

### 2A. Core Surface & Text Colors

| Token | Light Mode HSL | Light Hex | Dark Mode HSL | Dark Hex | Usage |
|---|---|---|---|---|---|
| `--background` | 0 0% 100% | `#FFFFFF` | 0 0% 0% | `#000000` | Page background |
| `--foreground` | 0 0% 0% | `#000000` | 200 6.67% 91.18% | `#E5E7E8` | Default text |
| `--card` | 0 0% 96.47% | `#F6F6F6` | 228 9.80% 10% | `#171921` | Card backgrounds |
| `--card-foreground` | 0 0% 0% | `#000000` | 0 0% 85.10% | `#D9D9D9` | Card text |
| `--card-border` | 0 0% 92% | `#EBEBEB` | 228 9.80% 12% | `#1C1E28` | Card borders |
| `--muted` | 0 0% 96.08% | `#F5F5F5` | 0 0% 9.41% | `#181818` | Muted backgrounds |
| `--muted-foreground` | 0 0% 52.94% | `#878787` | 210 3.39% 46.27% | `#727476` | Secondary text |
| `--border` | 0 0% 96.47% | `#F6F6F6` | 210 5.26% 14.90% | `#242628` | General borders |
| `--popover` | 0 0% 100% | `#FFFFFF` | 0 0% 0% | `#000000` | Dropdown/popover bg |
| `--popover-foreground` | 0 0% 0% | `#000000` | 200 6.67% 91.18% | `#E5E7E8` | Dropdown text |
| `--popover-border` | 0 0% 94% | `#F0F0F0` | 0 0% 3% | `#080808` | Dropdown borders |
| `--input` | 0 0% 0% | `#000000` | 207.69 27.66% 18.43% | `#222F3E` | Input borders |

### 2B. Brand / Action Colors

| Token | Light Mode HSL | Light Hex | Dark Mode HSL | Dark Hex | Usage |
|---|---|---|---|---|---|
| `--primary` | 203.89 88.28% 53.14% | `#1E9BF0` | 203.77 87.60% 52.55% | `#1D99ED` | Primary buttons, links, active states |
| `--primary-foreground` | 0 0% 100% | `#FFFFFF` | 0 0% 100% | `#FFFFFF` | Text on primary |
| `--secondary` | 0 0% 0% | `#000000` | 195 15.38% 94.90% | `#EEF1F2` | Secondary buttons |
| `--secondary-foreground` | 0 0% 100% | `#FFFFFF` | 210 25% 7.84% | `#0F1318` | Text on secondary |
| `--accent` | 254.21 100% 92.55% | `#DDD0FF` | 205.71 70% 7.84% | `#061626` | Accent backgrounds |
| `--accent-foreground` | 0 0% 0% | `#000000` | 203.77 87.60% 52.55% | `#1D99ED` | Accent text |
| `--destructive` | 2.04 74.62% 61.37% | `#E14B4B` | 356.30 90.56% 54.31% | `#EB1D35` | Destructive/delete buttons |
| `--destructive-foreground` | 0 0% 100% | `#FFFFFF` | 0 0% 100% | `#FFFFFF` | Text on destructive |
| `--ring` | 0 0% 0% | `#000000` | 202.82 89.12% 53.14% | `#1E9CF1` | Focus ring |

### 2C. Sidebar Colors

| Token | Light Mode HSL | Light Hex | Dark Mode HSL | Dark Hex | Usage |
|---|---|---|---|---|---|
| `--sidebar` | 180 6.67% 97.06% | `#F5F7F7` | 228 9.80% 10% | `#171921` | Sidebar background |
| `--sidebar-foreground` | 210 25% 7.84% | `#0F1318` | 0 0% 85.10% | `#D9D9D9` | Sidebar text |
| `--sidebar-border` | 205 25% 90.59% | `#DDE8F0` | 205.71 15.79% 26.08% | `#384350` | Sidebar borders |
| `--sidebar-primary` | 203.89 88.28% 53.14% | `#1E9BF0` | 202.82 89.12% 53.14% | `#1E9CF1` | Active sidebar item |
| `--sidebar-primary-foreground` | 0 0% 100% | `#FFFFFF` | 0 0% 100% | `#FFFFFF` | Active item text |
| `--sidebar-accent` | 211.58 51.35% 92.75% | `#D8E7F5` | 205.71 70% 7.84% | `#061626` | Sidebar hover/selected bg |
| `--sidebar-accent-foreground` | 203.89 88.28% 53.14% | `#1E9BF0` | 203.77 87.60% 52.55% | `#1D99ED` | Sidebar hover/selected text |

### 2D. Status Badge Colors (Used in Dashboard, Fleet Table, etc.)

| Token | HSL | Hex | Text Color | Text Hex | Usage |
|---|---|---|---|---|---|
| `--status-amber` | 38 92% 50% | `#F5A623` | `--status-amber-fg` (0 0% 0%) | `#000000` | In-progress, needs attention |
| `--status-green` | 142 71% 45% | `#22C55E` | `--status-green-fg` (0 0% 100%) | `#FFFFFF` | Complete, on track |
| `--status-red` | 0 84% 60% | `#EF4444` | `--status-red-fg` (0 0% 100%) | `#FFFFFF` | Blocked, action needed |
| `--status-blue` | 221 83% 53% | `#2563EB` | `--status-blue-fg` (0 0% 100%) | `#FFFFFF` | Informational |
| `--status-indigo` | 239 84% 67% | `#6366F1` | `--status-indigo-fg` (0 0% 100%) | `#FFFFFF` | Special |
| `--status-orange` | 25 95% 53% | `#F97316` | `--status-orange-fg` (0 0% 0%) | `#000000` | Warning |
| `--status-gray` | 0 0% 62% (light) / 0 0% 45% (dark) | `#9E9E9E` / `#737373` | `--status-gray-fg` (0 0% 100%) | `#FFFFFF` | Inactive/archived |

### 2E. Chart Colors

| Token | HSL | Hex | Usage |
|---|---|---|---|
| `--chart-1` | 203.89 88.28% 53.14% | `#1E9BF0` | Primary chart series |
| `--chart-2` | 159.78 100% 36.08% | `#00B87A` | Secondary chart series |
| `--chart-3` | 42.03 92.83% 56.27% | `#F0B429` | Tertiary chart series |
| `--chart-4` | 147.14 78.50% 41.96% | `#17A34A` | Fourth chart series |
| `--chart-5` | 341.49 75.20% 50.98% | `#D6336C` | Fifth chart series |

---

## 3. Main Status Badge Assignments

Each main status maps to a color group for its badge pill in Dashboard tables:

| Main Status | Badge BG | Badge Text | Color Group |
|---|---|---|---|
| Confirming Status | `#F5A623` | `#000000` | Amber |
| Decision Pending | `#EF4444` | `#FFFFFF` | Red |
| Repairing | `#F5A623` | `#000000` | Amber |
| Declined Repair | `#EF4444` | `#FFFFFF` | Red |
| Approved for sale | `#F5A623` | `#000000` | Amber |
| Tags | `#F5A623` | `#000000` | Amber |
| Scheduling | `#22C55E` | `#FFFFFF` | Green |
| PMF | `#F5A623` | `#000000` | Amber |
| In Transit | `#22C55E` | `#FFFFFF` | Green |
| On Road | `#22C55E` | `#FFFFFF` | Green |
| Needs truck assigned | `#F5A623` | `#000000` | Amber |
| Available to be assigned | `#22C55E` | `#FFFFFF` | Green |
| Relocate Van | `#F5A623` | `#000000` | Amber |
| NLWC - Return Rental | `#EF4444` | `#FFFFFF` | Red |
| Truck Swap | `#CFFAFE` (light) / `cyan-900/30` (dark) | `#155E75` (light) / `cyan-300` (dark) | Cyan |

### Sub Status Overrides
When a sub status is present, it can override the main status color:

| Sub Status | Overrides To |
|---|---|
| Location Unknown | Red |
| Estimate received, needs review | Red |
| Repair declined | Red |
| Vehicle was sold | Gray/muted |
| Delivered to technician | Green |
| Tags/registration complete | Green |
| Ready for redeployment | Green |
| Vehicle submitted for sale | Red |
| Declined Repair | Red |
| Estimate Pending Decision | Red |
| Scheduled, awaiting tech pickup | Green |
| Under repair at shop | Amber |
| Waiting on repair completion | Amber |

### Badge Shape
- **Shape:** Fully rounded pill (`rounded-full`)
- **Padding:** `px-3 py-1`
- **Font:** 14px (text-sm), font-medium (500 weight)
- **Border:** None (`border-0`)
- **White-space:** nowrap

---

## 4. Executive Summary Card Colors

Each main status gets a unique card color in the Executive Summary page:

| Main Status | Icon Color | Card BG (Light) | Card BG (Dark) | Card Border (Light) | Card Border (Dark) |
|---|---|---|---|---|---|
| Confirming Status | `text-amber-600` | `bg-amber-50` | `bg-amber-900/20` | `border-amber-200` | `border-amber-800` |
| Decision Pending | `text-purple-600` | `bg-purple-50` | `bg-purple-900/20` | `border-purple-200` | `border-purple-800` |
| Repairing | `text-blue-600` | `bg-blue-50` | `bg-blue-900/20` | `border-blue-200` | `border-blue-800` |
| Declined Repair | `text-red-600` | `bg-red-50` | `bg-red-900/20` | `border-red-200` | `border-red-800` |
| Approved for sale | `text-emerald-600` | `bg-emerald-50` | `bg-emerald-900/20` | `border-emerald-200` | `border-emerald-800` |
| Tags | `text-orange-600` | `bg-orange-50` | `bg-orange-900/20` | `border-orange-200` | `border-orange-800` |
| Scheduling | `text-teal-600` | `bg-teal-50` | `bg-teal-900/20` | `border-teal-200` | `border-teal-800` |
| PMF | `text-indigo-600` | `bg-indigo-50` | `bg-indigo-900/20` | `border-indigo-200` | `border-indigo-800` |
| In Transit | `text-cyan-600` | `bg-cyan-50` | `bg-cyan-900/20` | `border-cyan-200` | `border-cyan-800` |
| On Road | `text-green-600` | `bg-green-50` | `bg-green-900/20` | `border-green-200` | `border-green-800` |
| Needs truck assigned | `text-slate-600` | `bg-slate-50` | `bg-slate-900/20` | `border-slate-200` | `border-slate-800` |
| Available to be assigned | `text-lime-600` | `bg-lime-50` | `bg-lime-900/20` | `border-lime-200` | `border-lime-800` |
| Relocate Van | `text-pink-600` | `bg-pink-50` | `bg-pink-900/20` | `border-pink-200` | `border-pink-800` |
| NLWC - Return Rental | `text-rose-600` | `bg-rose-50` | `bg-rose-900/20` | `border-rose-200` | `border-rose-800` |
| Truck Swap | `text-cyan-600` | `bg-cyan-50` | `bg-cyan-900/20` | `border-cyan-200` | `border-cyan-800` |

### Tailwind Color Hex Reference (for the above)
| Tailwind Token | Light Hex | Dark Hex (approx) |
|---|---|---|
| amber-50 / amber-600 / amber-200 / amber-800 | `#FFFBEB` / `#D97706` / `#FDE68A` / `#92400E` | |
| purple-50 / purple-600 / purple-200 / purple-800 | `#FAF5FF` / `#9333EA` / `#E9D5FF` / `#6B21A8` | |
| blue-50 / blue-600 / blue-200 / blue-800 | `#EFF6FF` / `#2563EB` / `#BFDBFE` / `#1E40AF` | |
| red-50 / red-600 / red-200 / red-800 | `#FEF2F2` / `#DC2626` / `#FECACA` / `#991B1B` | |
| emerald-50 / emerald-600 / emerald-200 / emerald-800 | `#ECFDF5` / `#059669` / `#A7F3D0` / `#065F46` | |
| orange-50 / orange-600 / orange-200 / orange-800 | `#FFF7ED` / `#EA580C` / `#FED7AA` / `#9A3412` | |
| teal-50 / teal-600 / teal-200 / teal-800 | `#F0FDFA` / `#0D9488` / `#99F6E4` / `#115E59` | |
| indigo-50 / indigo-600 / indigo-200 / indigo-800 | `#EEF2FF` / `#4F46E5` / `#C7D2FE` / `#3730A3` | |
| cyan-50 / cyan-600 / cyan-200 / cyan-800 | `#ECFEFF` / `#0891B2` / `#A5F3FC` / `#155E75` | |
| green-50 / green-600 / green-200 / green-800 | `#F0FFF4` / `#16A34A` / `#BBF7D0` / `#166534` | |
| slate-50 / slate-600 / slate-200 / slate-800 | `#F8FAFC` / `#475569` / `#E2E8F0` / `#1E293B` | |
| lime-50 / lime-600 / lime-200 / lime-800 | `#F7FEE7` / `#65A30D` / `#D9F99D` / `#3F6212` | |
| pink-50 / pink-600 / pink-200 / pink-800 | `#FDF2F8` / `#DB2777` / `#FBCFE8` / `#9D174D` | |
| rose-50 / rose-600 / rose-200 / rose-800 | `#FFF1F2` / `#E11D48` / `#FECDD3` / `#9F1239` | |

---

## 5. Component Styles

### 5A. Buttons

| Variant | Background | Text | Border | Hover/Active |
|---|---|---|---|---|
| `default` | `--primary` (`#1E9BF0`) | `--primary-foreground` (`#FFFFFF`) | 1px solid `--primary-border` | Auto-elevate overlay |
| `secondary` | `--secondary` (`#000000` light / `#EEF1F2` dark) | `--secondary-foreground` | 1px solid `--secondary-border` | Auto-elevate overlay |
| `destructive` | `--destructive` (`#E14B4B`) | `#FFFFFF` | 1px solid `--destructive-border` | Auto-elevate overlay |
| `outline` | Transparent (inherits parent bg) | Inherits text color | 1px solid `rgba(0,0,0,0.10)` light / `rgba(255,255,255,0.10)` dark | Auto-elevate overlay |
| `ghost` | Transparent | Inherits text color | 1px solid transparent | Auto-elevate overlay |

**Button Sizes:**
| Size | Height | Padding | Font Size |
|---|---|---|---|
| `default` | min-height 36px (min-h-9) | px-4 py-2 (16px / 8px) | 14px (text-sm) |
| `sm` | min-height 32px (min-h-8) | px-3 (12px) | 12px (text-xs) |
| `lg` | min-height 40px (min-h-10) | px-8 (32px) | 14px (text-sm) |
| `icon` | 36x36px (h-9 w-9) | none | n/a |

**Button Shape:** `rounded-md` (6px border-radius)

### 5B. Badges

| Variant | Background | Text | Border |
|---|---|---|---|
| `default` | `--primary` | `--primary-foreground` | None |
| `secondary` | `--secondary` | `--secondary-foreground` | None |
| `destructive` | `--destructive` | `--destructive-foreground` | None |
| `outline` | Transparent | Inherits | 1px `rgba(0,0,0,0.05)` light / `rgba(255,255,255,0.05)` dark |

**Badge Shape:** `rounded-md` (6px border-radius)
**Badge Padding:** px-2.5 py-0.5 (10px / 2px)
**Badge Font:** 12px (text-xs), font-semibold (600)
**Badge Behavior:** Single-line only (nowrap)

### 5C. Cards

- **Background:** `--card` (`#F6F6F6` light / `#171921` dark)
- **Text:** `--card-foreground`
- **Border:** 1px solid `--card-border` (`#EBEBEB` light / `#1C1E28` dark)
- **Border Radius:** `rounded-xl` (12px in dark, 0 in light based on `--radius`)
- **Shadow:** `shadow-sm`
- **Header Padding:** 24px all sides (p-6)
- **Content Padding:** 24px horizontal, 0 top (p-6 pt-0)

### 5D. Tables

- **Header Row:** 48px height (h-12), px-4, `text-muted-foreground`, font-medium
- **Body Rows:** border-bottom, hover: `bg-muted/50` overlay
- **Selected Row:** `bg-muted`
- **Cell Padding:** px-4
- **Font Size:** 14px (text-sm)
- **Last Row:** No bottom border

### 5E. Tabs

- **Tab Bar Background:** `bg-muted` (`#F5F5F5` light / `#181818` dark)
- **Tab Bar Height:** 40px (h-10)
- **Tab Bar Shape:** `rounded-md` (6px)
- **Tab Bar Padding:** p-1 (4px)
- **Inactive Tab Text:** `text-muted-foreground` (`#878787`)
- **Active Tab Background:** `bg-background` (`#FFFFFF` light / `#000000` dark)
- **Active Tab Text:** `text-foreground` (`#000000` light / `#E5E7E8` dark)
- **Active Tab Shadow:** `shadow-sm`
- **Tab Padding:** px-3 py-1.5 (12px / 6px)
- **Tab Shape:** `rounded-sm` (3px)
- **Tab Font:** 14px, font-medium (500)

### 5F. Inputs

- **Height:** 36px (h-9)
- **Background:** `--background`
- **Border:** 1px solid `--input`
- **Border Radius:** `rounded-md` (6px)
- **Padding:** px-3 py-2 (12px / 8px)
- **Font Size:** 14px desktop, 16px mobile
- **Placeholder:** `text-muted-foreground`
- **Focus Ring:** 2px `--ring` with 2px offset

### 5G. Select/Dropdowns

- **Trigger Height:** 36px (h-9)
- **Trigger Background:** `--background`
- **Trigger Border:** 1px solid `--input`
- **Trigger Shape:** `rounded-md` (6px)
- **Chevron Icon:** 16x16px, 50% opacity
- **Dropdown Background:** `--popover`
- **Dropdown Border:** `--popover-border`

### 5H. Dialogs/Modals

- **Overlay:** `bg-black/80` (black at 80% opacity)
- **Content Background:** `--background`
- **Content Border:** 1px solid `--border`
- **Content Shadow:** `shadow-lg`
- **Content Width:** max 512px (`max-w-lg`)
- **Content Padding:** 24px (p-6)
- **Content Shape:** `rounded-lg` on desktop (9px)
- **Title Font:** 18px (text-lg), font-semibold
- **Description Text:** 14px, `text-muted-foreground`

### 5I. Tooltips

- **Background:** `--popover`
- **Text:** `--popover-foreground`
- **Border:** 1px solid `--border`
- **Shadow:** `shadow-md`
- **Padding:** px-3 py-1.5 (12px / 6px)
- **Font Size:** 14px (text-sm)
- **Shape:** `rounded-md` (6px)
- **Animation:** fade-in + zoom-in-95

---

## 6. Sidebar

- **Width:** 20rem (320px) expanded, 4rem (64px) collapsed (icon mode)
- **Background:** `--sidebar` (`#F5F7F7` light / `#171921` dark)
- **Text:** `--sidebar-foreground`
- **Border Right:** 1px solid `--sidebar-border`
- **Header:** Bottom border `--sidebar-border`, px-3 py-3
- **Group Labels:** Uppercase-style section titles
- **Menu Items:** Full-width buttons
- **Active Item:** `--sidebar-accent` background, `--sidebar-accent-foreground` text
- **Footer:** Top border `--sidebar-border`, contains profile and dark mode toggle

---

## 7. Layout & Spacing

### Base Spacing Unit
`--spacing: 0.25rem` (4px). All spacing is multiples of 4px.

| Token | Value | Common Usage |
|---|---|---|
| `gap-1` / `p-1` | 4px | Tab bar inner padding |
| `gap-2` / `p-2` | 8px | Between icons and text, header padding |
| `gap-3` / `p-3` | 12px | Sidebar padding, small card padding |
| `gap-4` / `p-4` | 16px | Table cell padding, button padding |
| `gap-6` / `p-6` | 24px | Card padding, dialog padding |

### Border Radius Scale
| Token | Light Mode | Dark Mode | Usage |
|---|---|---|---|
| `rounded-sm` | 3px | 3px | Tab triggers |
| `rounded-md` | 6px | 6px | Buttons, badges, inputs |
| `rounded-lg` | 9px | 9px | Dialogs |
| `rounded-xl` | 12px | 12px | Cards |
| `rounded-full` | 9999px | 9999px | Status badge pills |

**Note:** Light mode `--radius` is `0rem`, dark mode is `1.3rem`. The component-level border-radius values shown above are the effective values used in practice.

---

## 8. Interaction & Hover System

Fleet Scope uses a custom elevation system instead of explicit hover colors:

| State | Light Mode Overlay | Dark Mode Overlay |
|---|---|---|
| Hover (elevate-1) | `rgba(0,0,0, 0.03)` | `rgba(255,255,255, 0.04)` |
| Active/Press (elevate-2) | `rgba(0,0,0, 0.08)` | `rgba(255,255,255, 0.09)` |
| Button outline border | `rgba(0,0,0, 0.10)` | `rgba(255,255,255, 0.10)` |
| Badge outline border | `rgba(0,0,0, 0.05)` | `rgba(255,255,255, 0.05)` |

This means buttons, badges, cards, and interactive elements don't change to a different color on hover. Instead, a semi-transparent overlay is applied on top of whatever background color they have.

---

## 9. Shadow System

All shadows use the primary color hue at 0% opacity (effectively invisible shadows in current config):

| Token | Value |
|---|---|
| `shadow-sm` | `0px 2px 0px 0px hsl(203 89% 53% / 0)` |
| `shadow-md` | Above + `0px 2px 4px -1px hsl(203 89% 53% / 0)` |
| `shadow-lg` | Above + `0px 4px 6px -1px hsl(203 89% 53% / 0)` |

The app uses a flat, borderless design with minimal shadows. Visual hierarchy comes from background color contrast and borders rather than drop shadows.

---

## 10. Scrollbar Styling

Custom scrollbar (top synchronized scroll in Dashboard):

| Element | Light Values |
|---|---|
| Track background | `#FFFFFF` |
| Track border | 1px solid `#DDDDDD`, 4px radius |
| Thumb background | `#999999` |
| Thumb border | 1px solid `#888888`, 4px radius |
| Thumb hover | `#777777` |
| Scrollbar height | 16px |
| Arrow buttons | `#FFFFFF` bg, `#DDDDDD` border, `#888888` arrow stroke |

---

## 11. Icon Library

- **Primary icons:** Lucide React (e.g., Search, Wrench, TruckIcon, Calendar, Tag, Navigation, CheckCircle, XCircle, DollarSign, Warehouse, BarChart3)
- **Icon size in buttons:** 16x16px (`size-4`)
- **Icon behavior:** `pointer-events-none`, `shrink-0`
- **Company logos (if needed):** `react-icons/si`

---

## 12. Dark Mode Summary

The app supports full dark mode toggled via a class (`dark`) on the root element.

**Key differences from light mode:**
- Background inverts from white to black
- Cards go from light gray (#F6F6F6) to dark blue-gray (#171921)
- Text goes from black to light gray (#E5E7E8)
- Borders become darker/more subtle
- Sidebar goes from near-white to dark card color
- Status badge colors stay the same in both modes
- Primary blue stays nearly identical
- Elevation overlays switch from dark-on-light to light-on-dark
- Border radius increases in dark mode (--radius: 0rem light vs 1.3rem dark)
