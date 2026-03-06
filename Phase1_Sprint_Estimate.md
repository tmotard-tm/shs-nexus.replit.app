# Phase 1 Sprint Estimate — Offboarding Schema Improvements

**Prepared for:** PM, Technician Offboarding Process Redesign  
**Date:** March 6, 2026  
**Context:** Based on Architecture Discovery Response (March 5) — Phase 1 changes on the existing `queue_items` schema.

---

## Data Source Answers

### Change 3: TLT Data Source Questions

**Is `jobTitle` reliably populated in the Snowflake term roster view?**

Yes, for records sourced from Snowflake. The field is `TECH_SPECIALTY` in `ORA_TECH_TERM_ROSTER_VW_VIEW`, mapped to `jobTitle` in the sync service.

- Snowflake-synced records: **115/115 (100%)** have `jobTitle` populated
- Backfill-created records (from the startup backfill script): **0/15** have `jobTitle` (the backfill script did not extract it from the source data)
- Separation-only records: **0/2** (the `SEPARATION_FLEET_DETAILS` view does not include a job title field)

So the data is reliable for the primary sync path. The 17 records currently missing job titles are from secondary paths (backfill, separation-only) and would need to be enriched either from the term roster view or manually.

**What are the exact job title strings for TLT techs?**

From the current active dataset, there are exactly **two "lead" titles** present:

| Job Title | Count (active techs) | Example Techs |
|-----------|---------------------|---------------|
| `Team Lead Technician` | 4 techs (20 tasks) | AMATO, MATTHEW J; REYES, CARLOS; STOUT, RALPH; WILLIAMS, ANDREW P |
| `HVAC Lead Installer` | 1 tech (5 tasks) | HOLMES, ALLAHJUUAN S |

The full universe of job titles in the system (15 distinct values):
```
HVAC Lead Installer
HVAC Service Tech, Trainee
HVAC Svc Tech I, Break/Fix
HVAC Svc Tech II, Break/Fix
Service Tech 1 Trainee, PP
Service Tech 1, IH
Service Tech 2 Trainee, PP
Service Technician 1, In Home
Service Technician 1, In-Home
Service Technician 1, Trainee
Service Technician 2, In-Home
Service Technician 2, Trainee
Service Technician 3, In-Home
Service Technician HV, In-Home
Team Lead Technician
```

**Edge cases and considerations:**

1. **"HVAC Lead Installer"** — This is a lead role but may have different equipment (HVAC-specific tooling, possibly no iPad). The PM should confirm whether this title should be flagged as TLT.
2. **Temporary TLTs** — There is no "acting" or "temporary" designation visible in the data. If a tech is temporarily promoted to TLT, it would depend on whether HR updates their `TECH_SPECIALTY` in the source system.
3. **Regional title variations** — There are two variants of the same role: `"Service Technician 1, In Home"` vs `"Service Technician 1, In-Home"` (hyphen difference). The TLT titles appear consistent, but the detection logic should use case-insensitive matching with `LIKE '%lead%'` rather than exact string matching to be safe.
4. **Separation-sourced techs** — Techs that come from `SEPARATION_FLEET_DETAILS` (not the term roster) will **not** have `jobTitle`. These would be `is_tlt = false` by default, which could be incorrect. This affects ~2 of 132 active techs currently.

**Recommendation:** The data source is reliable enough to proceed. Use case-insensitive matching: `jobTitle.toLowerCase().includes('lead')`. This catches both `"Team Lead Technician"` and `"HVAC Lead Installer"`. Confirm with the PM whether `"HVAC Lead Installer"` should be included.

---

### Change 5: Phone Data Source Question

**Is there a field indicating whether a tech has a company-issued phone?**

**No.** There is no company phone assignment field in any of the Snowflake views.

What exists:

| Field | Source | What It Contains |
|-------|--------|-----------------|
| `SNSTV_CELL_PHONE` | `ORA_TECH_LAST_KNOWN_CONTACT_VW_VIEW` | Tech's personal cell phone number |
| `SNSTV_MAIN_PHONE` | Same | Tech's main phone (could be personal or company) |
| `SNSTV_HOME_PHONE` | Same | Tech's home phone number |
| `CONTACT_NUMBER` | `SEPARATION_FLEET_DETAILS` | Contact phone from separation record |
| `MOBILEPHONENUMBER` | `TPMS_EXTRACT` | Mobile number from TPMS (likely personal) |

These are all **personal contact numbers from HR records**, not company phone assignment data. There is no device management system (MDM) field, carrier account assignment, or "has company phone" flag in the Snowflake data available to us.

**Current state of phone data on Phone Recovery tasks:**
- 110 of 126 active Phone Recovery tasks have a `phone_number` set (from `SNSTV_CELL_PHONE` or `SNSTV_MAIN_PHONE`)
- 16 have no phone number — but this means the contact info is missing, not necessarily that the tech has no company phone

**This change is BLOCKED** pending a data source. Options to unblock:

1. **Ask the carrier team** (Verizon/T-Mobile) if there's a device assignment report that can be ingested into Snowflake or queried via API
2. **Use TPMS or another system** — if company phones are tracked in TPMS device assignments, that data could be joined during sync
3. **Default to "all techs get phones"** (current behavior) and let Monica write off non-phone techs manually — this is the status quo and may be acceptable if the volume is low
4. **Use the `carrier` field on Assets tasks** — Claudia sometimes sets the carrier (Verizon/T-Mobile) on the Assets Management task. If `carrier` is set, it confirms a company phone exists. But this is set manually after task creation, so it can't drive sync-time decisions

---

## Sprint Estimate

| Change | Effort (hours) | Dependencies | Can Be Independent? | Risk Level |
|--------|---------------|-------------|---------------------|------------|
| 1. `workflow_id` index | 0.5 | None | Yes | Low |
| 2. Promote `enterprise_id` / `tech_name` | 3–4 | None | Yes | Low |
| 3. Add `is_tlt` column | 2–3 | PM confirmation on HVAC Lead Installer inclusion; backfill records missing jobTitle | Yes | Low-Medium |
| 4. Propagate BYOV to all rows | 2–3 | None | Yes | Low |
| 5. Conditional Phone Recovery | BLOCKED | Needs company phone data source | No — blocked | N/A |
| 6. Soft archival | 4–5 | Change 1 (index helps archive queries) | Mostly — benefits from Change 1 | Medium |
| **Total (excluding blocked)** | **12–16 hours** | | | |

---

## Estimate Details

### Change 1: `workflow_id` Index — 0.5 hours

- Add index to Drizzle schema in `shared/schema.ts`
- Run `db:push` to apply
- Verify with `EXPLAIN ANALYZE` on a grouped query
- **Risk:** Essentially zero — additive, non-breaking change
- **Independent:** Fully independent, should be done first as other changes benefit from it

### Change 2: Promote `enterprise_id` / `tech_name` — 3–4 hours

Breakdown:
- Schema change: Add 2 nullable columns to `queueItems` in `shared/schema.ts` (0.5h)
- Sync update: Set `enterprise_id` and `tech_name` on the `queueItem` object in `syncTermedTechs()` before insertion (0.5h)
- Manual form update: Set fields in `offboard-technician.tsx` submission flow (0.5h)
- Backfill script: SQL update extracting from `data` JSON for all existing rows (0.5h):
  ```sql
  UPDATE queue_items SET
    enterprise_id = COALESCE(
      data::jsonb -> 'technician' ->> 'enterpriseId',
      data::jsonb -> 'technician' ->> 'techRacfid',
      data::jsonb -> 'employee' ->> 'enterpriseId',
      data::jsonb -> 'employee' ->> 'racfId'
    ),
    tech_name = COALESCE(
      data::jsonb -> 'technician' ->> 'techName',
      data::jsonb -> 'employee' ->> 'name'
    )
  WHERE enterprise_id IS NULL;
  ```
- Frontend updates: Replace JSON parsing in queue views with direct column reads (1–2h)
- **Risk:** Low — additive columns, no breaking changes. The backfill SQL is straightforward.
- **Independent:** Fully independent

### Change 3: Add `is_tlt` Column — 2–3 hours

Breakdown:
- Schema change: Add `is_tlt` boolean column (0.25h)
- Sync update: Add TLT detection in `syncTermedTechs()` before the task creation loop, applied to all 5 tasks (0.5h):
  ```typescript
  const isTlt = (tech.jobTitle || '').toLowerCase().includes('lead');
  // Set on queueItem before creation loop
  ```
- Backfill script: Update existing rows from JSON data (0.5h)
- Handle separation-sourced records missing jobTitle — log a warning, default to `false` (0.25h)
- Frontend: Add TLT badge to queue views where relevant (1h)
- **Risk:** Low-Medium
  - The "lead" keyword match could produce false positives if new job titles appear with "lead" in a non-TLT context (unlikely given current title patterns)
  - 17 records (~13%) are missing jobTitle and will default to `is_tlt = false`. If any of these are actual TLTs, they'd be missed.
- **Dependencies:** PM needs to confirm whether `"HVAC Lead Installer"` should be flagged as TLT
- **Independent:** Fully independent

### Change 4: Propagate BYOV to All Rows — 2–3 hours

Breakdown:
- Sync update: Move `detectByov()` call before the task creation loop, apply result to all 5 `queueItem` objects (1h)
- Backfill script (1h):
  ```sql
  UPDATE queue_items AS target
  SET 
    is_byov = source.is_byov,
    vehicle_type = source.vehicle_type
  FROM queue_items AS source
  WHERE target.workflow_id = source.workflow_id
    AND source.department = 'Assets Management'
    AND source.is_byov = true
    AND target.id != source.id
    AND target.is_byov = false;
  ```
- Verification: Confirm all 5 rows per BYOV workflow have matching values (0.5h)
- **Risk:** Low — the backfill is a simple join-update. The sync change moves existing logic earlier in the function.
- **Independent:** Fully independent

### Change 5: Conditional Phone Recovery — BLOCKED

This change cannot proceed without a data source for company phone assignments. See the data source answer above for options to unblock.

### Change 6: Soft Archival — 4–5 hours

Breakdown:
- Schema: Create `archive_queue_items` table (same structure as `queue_items`) in `shared/schema.ts` (0.5h)
- Archive function: Write `archiveOldTasks()` in `storage.ts` that moves rows with `status IN ('completed', 'cancelled')` and `updated_at < NOW() - INTERVAL '90 days'` (1.5h):
  - INSERT INTO archive_queue_items SELECT ... WHERE criteria
  - DELETE FROM queue_items WHERE id IN (archived_ids)
  - Return count of archived rows
- Scheduler integration: Add to `sync-scheduler.ts` as a weekly job (0.5h)
- API endpoint: Add `/api/admin/archive/status` and `/api/admin/archive/run` for manual triggering (0.5h)
- Archive query endpoint: Add `/api/admin/archive/search` for historical lookups (0.5h)
- Testing: Verify no foreign key issues, ensure archived rows are queryable (0.5h)
- **Risk:** Medium
  - Need to verify no other tables reference `queue_items.id` as a foreign key before deleting rows
  - The `offboarding_employees` or similar tracking tables may reference `queue_item_id` — these references would break if rows are deleted. May need to use soft-delete (add `archived_at` column) instead of physical move.
  - If soft-delete is chosen, existing queries need a `WHERE archived_at IS NULL` filter, which is a broader change
- **Dependencies:** Benefits from Change 1 (workflow_id index) for the archive query
- **Independent:** Mostly — can be done independently but should come after Change 1

---

## Recommended Sprint Order

```
Week 1 (can be parallelized):
├── Change 1: workflow_id index (0.5h) ← Do first, enables everything else
├── Change 2: Promote enterprise_id / tech_name (3-4h) ← Independent
└── Change 4: Propagate BYOV to all rows (2-3h) ← Independent

Week 2:
├── Change 3: Add is_tlt column (2-3h) ← Needs PM answer on HVAC Lead Installer
└── Change 6: Soft archival (4-5h) ← Benefits from Change 1 index

Blocked:
└── Change 5: Conditional Phone Recovery ← Needs company phone data source
```

**Rationale:**
- Changes 1, 2, and 4 have zero dependencies and can all be done in parallel during week 1
- Change 3 can start once the PM confirms the HVAC Lead Installer question
- Change 6 is the largest piece and benefits from the workflow_id index (Change 1), so it should follow
- Change 5 should not be estimated until the data source is identified — attempting to build it with unreliable data would create false confidence in Monica's queue

---

## Open Questions for PM

1. **Should `"HVAC Lead Installer"` be flagged as TLT?** This is a lead role but HVAC-specific. There is currently 1 active tech with this title.
2. **For Change 6 (archival): soft-delete vs physical move?** Soft-delete (adding an `archived_at` column) is safer and avoids foreign key issues, but means all existing queries need a `WHERE archived_at IS NULL` filter. Physical move to an archive table is cleaner for active queries but risks breaking references. Which approach do you prefer?
3. **For Change 5: who owns company phone assignment data?** If we can identify the system of record (MDM, carrier portal, IT asset management), we can evaluate whether an API or Snowflake view is feasible.
