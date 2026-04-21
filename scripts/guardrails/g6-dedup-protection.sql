-- ─────────────────────────────────────────────────────────────────────────────
-- G6 — Persistent dedup protection for vrm_repair_tracker
-- Adds protected_from_dedup column + a BEFORE-UPDATE trigger that flips it to
-- TRUE on any manual edit to the case-management fields. The dedup DELETE in
-- importDeniedToRepairTracker() (server/vrm/storage.ts) MUST add
-- "AND protected_from_dedup = false" to its WHERE clause so protected rows are
-- never wiped by the scheduler's dedup pass.
--
-- Idempotent: safe to re-run on every boot.
-- This file is invoked from server/vrm/init-schema.ts.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE vrm_repair_tracker
  ADD COLUMN IF NOT EXISTS protected_from_dedup BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS vrm_repair_tracker_protected_idx
  ON vrm_repair_tracker(protected_from_dedup)
  WHERE protected_from_dedup = TRUE;

CREATE OR REPLACE FUNCTION vrm_rt_set_protected_from_dedup() RETURNS TRIGGER AS $$
BEGIN
  IF (
       NEW.notes                     IS DISTINCT FROM OLD.notes
    OR NEW.tech_status               IS DISTINCT FROM OLD.tech_status
    OR NEW.tech_contacted            IS DISTINCT FROM OLD.tech_contacted
    OR NEW.tech_contacted_date       IS DISTINCT FROM OLD.tech_contacted_date
    OR NEW.tech_contact_outcome      IS DISTINCT FROM OLD.tech_contact_outcome
    OR NEW.byov_enrolled             IS DISTINCT FROM OLD.byov_enrolled
    OR NEW.byov_status               IS DISTINCT FROM OLD.byov_status
    OR NEW.byov_decision_date        IS DISTINCT FROM OLD.byov_decision_date
    OR NEW.rental_returned           IS DISTINCT FROM OLD.rental_returned
    OR NEW.rental_return_date        IS DISTINCT FROM OLD.rental_return_date
    OR NEW.route_cleared             IS DISTINCT FROM OLD.route_cleared
    OR NEW.route_cleared_date        IS DISTINCT FROM OLD.route_cleared_date
    OR NEW.shop_last_contacted_date  IS DISTINCT FROM OLD.shop_last_contacted_date
    OR NEW.shop_eta_on_road          IS DISTINCT FROM OLD.shop_eta_on_road
    OR NEW.main_status               IS DISTINCT FROM OLD.main_status
    OR NEW.dismissed                 IS DISTINCT FROM OLD.dismissed
    OR NEW.closed_at                 IS DISTINCT FROM OLD.closed_at
  ) THEN
    NEW.protected_from_dedup := TRUE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS vrm_rt_protect_on_edit ON vrm_repair_tracker;
CREATE TRIGGER vrm_rt_protect_on_edit
  BEFORE UPDATE ON vrm_repair_tracker
  FOR EACH ROW
  EXECUTE FUNCTION vrm_rt_set_protected_from_dedup();
