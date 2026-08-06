---
name: Standard Activities route-block dark launch
description: How rental-return route blocks are filed (schedule-pickup), the TEST-prefix semantics, and the no-cancel/no-refire rules.
---

# Standard Activities route-block (rental-return) — dark-launch semantics

The VRM Ops Queue "SCHEDULE TECH PICKUP" step records a tech-pickup date
(append-only `schedule_pickup` action → `fs_trucks.scheduled_pickup_date`
mirror) and optionally files a rental-return time block on the tech's route
via the Standard Activities API client (`sendStandardActivity`).

**Rules that bite:**
- **TEST prefix ≠ no POST.** `live:false` still fires the HTTP POST; the
  project name is prefixed `TEST ` and the receiving system ignores it. The
  live gate is env `LUCA_ROUTE_BLOCK_ENABLED` (`^(true|1|yes|on)$/i`), unset
  by default — deliberate dark launch because the client's ActivityType "46"
  is evidence-based, unconfirmed by the API owner.
- **409 = duplicate, never re-fire.** An identical POST re-sent leaves a tech
  double-blocked with no reversal handle. Treat duplicate as success-ish
  ("already filed"), surface it, move on.
- **No cancel/delete API.** Re-scheduling to a new date files a NEW project;
  the old block stands until a DCA removes it by hand. Supersede detection
  must scan the case's WHOLE filing history (`filed_live`/`duplicate`/
  `pending` for any other date) — checking only the latest action lets a
  clear in between hide a live block. Always surface the warning.
- **Record-then-file ordering.** The date row + fs_trucks mirror land first;
  the API result is merged into the action payload afterwards. Filing
  failures never lose the date; mirror failures compensate-delete the action
  row BEFORE any filing, so no orphaned upstream block is possible.
- **Identity chain:** MasterRow.employee_id → `all_techs.tech_racfid` (RACF
  is the route key, never payroll id); unit = resolved district;
  `employment_status != 'A'` or missing pieces ⇒ skip filing with a loud
  reason but still record the date. Redirect rule (declined/auction +
  distinct assigned truck): block names the ASSIGNED truck at ITS shop.

**Why:** the block API is one-way and human-cleanup-only; losing a date or
double-filing is worse than not filing, so the date record is primary and
every filing outcome is explicit.

**How to apply:** any new caller of `sendStandardActivity` must (1) gate live
on the env flag, (2) persist the outcome somewhere auditable, (3) never
auto-retry a 409, (4) warn when superseding a filed block.
