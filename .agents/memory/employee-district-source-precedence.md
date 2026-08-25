---
name: Employee district source precedence
description: Why active roster districts prefer TPMS and use an employee-ID-keyed DRIVELINE fallback
---

# Employee district source precedence

**Rule:** For active employee roster district, prefer current/last-known TPMS
when present. If TPMS has no employee row, use the corrected
DRIVELINE_ALL_TECHS district keyed by employee ID. Never join that fallback
only by enterprise ID. Canonical 3132 and 3580 (including zero-padded forms)
are cost centers, not districts.

**Why:** DRIVELINE_ALL_TECHS previously supplied finance cost centers in its
district field, but the source was corrected on 2026-08-25. TPMS has no row for
many employees, so preserving the old local value pinned the contamination
even after correction. Enterprise IDs are reused and can have multiple
conflicting DRIVELINE districts; employee IDs had no conflicting districts in
the source validation.

**How to apply:** Keep TPMS as the first choice and DRIVELINE as the
employee-ID-scoped fallback. Repair current-state roster/assignment mirrors
when this known contamination appears, but do not rewrite immutable audit or
operation history merely to make an app-wide raw-table search reach zero.