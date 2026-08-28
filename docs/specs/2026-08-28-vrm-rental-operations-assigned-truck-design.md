# VRM Rental Operations Assigned-Truck Design

## Goal

Pair each technician name on the VRM Rental Operations board with that technician's current TPMS-assigned truck. Never present a rental unit, reservation number, rental-agreement number, or synthetic case key as the technician's assigned truck.

## Current Problem

The board's first truck column renders the case key. Normal rental cases use the rental vehicle number as that key, while unresolved direct-billing cases use a synthetic `db:<RA>` key. The technician's TPMS-derived assignment exists separately, so the current label and prominence make a rental or reservation identifier look like the technician's assigned truck.

## Approved Behavior

1. The primary truck value beside a technician name is the existing shared TPMS-first `assigned_truck` result.
2. A missing TPMS assignment displays **Unassigned / No TPMS match**. There is no fallback to the rental unit, reservation number, RA number, or case key.
3. The physical rental vehicle remains visible as a separate **Rental Unit** value.
4. Reservation and RA identifiers remain visible only in their existing reservation/reference context.
5. Internal `case_key` values remain unchanged and continue to drive row identity, deep links, actions, and audit history.

## Data Flow

The server continues to resolve the technician identity and derive `assigned_truck` through the shared TPMS-first assignment lookup. The master-board response continues to carry both the case identity/rental-unit fields and the assigned-truck field.

The client changes presentation only:

- technician name + `assigned_truck` form the primary identity shown to operators;
- `vehicle_number` or its normalized rental-unit equivalent is labeled **Rental Unit**;
- `case_key` remains an internal action/deep-link key and is not labeled as the assigned truck;
- an absent `assigned_truck` renders the approved explicit missing state.

No database migration, assignment write, TPMS write, or case-key rewrite is required.

## Error and Edge Cases

- Unresolved technician identity: show **Unassigned / No TPMS match**.
- TPMS returns no current assignment: show **Unassigned / No TPMS match**.
- Direct-billing case with only `db:<RA>` identity: retain the case internally, but never show that key as an assigned truck.
- Assigned truck equals rental unit: show the same number in both accurately labeled contexts.
- Historical roster fallback remains part of the approved shared TPMS-first server lookup; the client must not invent an additional fallback.

## Verification

Add regression coverage proving:

1. A row with a case/rental number and a different TPMS assignment presents the TPMS number as **Assigned Truck** and the case vehicle as **Rental Unit**.
2. A truckless `db:<RA>` case with a TPMS assignment never presents the RA-derived key as a truck.
3. A row without a TPMS assignment shows **Unassigned / No TPMS match** and does not fall back to another identifier.
4. Case-key-based actions and deep links remain wired to `case_key`.

Run the focused VRM surface-alignment tests, the Rental Operations viewport guard, the project typecheck against its established baseline, and the production build.