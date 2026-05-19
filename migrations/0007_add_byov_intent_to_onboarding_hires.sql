-- Adds BYOV Dashboard intent cross-check fields to onboarding_hires (Weekly Onboarding only).
-- byov_intent: 'perm' | 'training' | NULL (NULL = no enrollment found in BYOV Dashboard, not "declined")
-- byov_enrollment_id: opaque id from BYOV Dashboard (for traceability)
-- byov_intent_checked_at: last successful cross-check timestamp for the row
ALTER TABLE onboarding_hires
  ADD COLUMN IF NOT EXISTS byov_intent VARCHAR(20),
  ADD COLUMN IF NOT EXISTS byov_enrollment_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS byov_intent_checked_at TIMESTAMP;
