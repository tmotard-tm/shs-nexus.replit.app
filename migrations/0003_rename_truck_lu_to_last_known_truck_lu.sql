-- Rename truck_lu to last_known_truck_lu in all_techs table and add last_known_truck_file_date
-- These fields are informational-only (from TPMS_EXTRACT_LAST_ASSIGNED snapshot) and may be stale.
-- They are not current truck assignments. Renamed to make the historical-only semantics explicit.

ALTER TABLE all_techs
  RENAME COLUMN truck_lu TO last_known_truck_lu;

ALTER TABLE all_techs
  ADD COLUMN IF NOT EXISTS last_known_truck_file_date date;
