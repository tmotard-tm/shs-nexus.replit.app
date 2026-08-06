---
name: VRM is the rentals authority; Fleet Scope is downstream
description: User directive on data-flow direction between VRM Rental Operations and Fleet Scope rental surfaces
---

# VRM authority / Fleet Scope downstream (user directive, 2026-08-04)

**Rule:** VRM Rental Operations is the authoritative source for the rental/repair working set. Anything "really good" in Fleet Scope's rental surfaces gets ported INTO VRM, not the reverse. Rental status and call data flow one-way VRM/LUCA → fs_trucks/fs_call_logs; Fleet Scope is the LAST stop (a display mirror), never the beginning or the source.

**Why:** User set this explicitly ("Leave VRM as the authoritative source… Fleet Scope is the last of the updates. It's not the beginning or the source.") after LUCA took over repair calling and the old Fleet Scope dial paths were removed; two-way edits had caused "lines crossed" status overwrites.

**How to apply:**
- New rental features (worklists, data entry, verification) belong in VRM, reading VRM-native tables.
- Fleet Scope rental-truck status/call fields are mirror-written (VRM projection) and read-only in the FS UI: the FS truck-update route 403s user-initiated CHANGES to VRM-owned fields (unchanged values in full-form PUTs are stripped silently — don't "fix" that into a hard reject). User-facing FS create/import paths sanitize VRM-owned fields and force the canonical initial status. FS system automations may still write status; VRM reconcile ADOPTS those into history (guard: only when fs_trucks.last_updated_by is not `VRM:%`, so mirrors never echo).
- Trucks WITHOUT an open VRM rental case (e.g. disposal pipeline) currently have no status-edit surface anywhere — known gap, follow-up candidate, not a bug.
- Never add a writer that pushes FS-originated rental state upstream into VRM tables.
- Shop identity: VRM's verified/locked shop phone outranks fs_trucks.repairPhone and the scraper vendor phone; FS should display (and tel:-link) the VRM value.
- fs_call_logs stays the single call-outcome ledger (VRM reads it; no dual-write of outcomes into VRM tables).
