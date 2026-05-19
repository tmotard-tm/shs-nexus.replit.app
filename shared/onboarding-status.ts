/**
 * Tri-state Status derivation for the Weekly Onboarding Truck Assignments page.
 *
 * IMPORTANT — scope boundary:
 *   `byov` is *derived* from the assigned truck# prefix (`88…`) and is ONLY
 *   surfaced on the Weekly Onboarding page. Do NOT reuse this helper on the
 *   offboarding, fleet ops, or rental dashboards — the BYOV status/intent
 *   fields must not propagate there.
 *
 * Lives in `shared/` so the UI table, the column filter, and the server-side
 * Excel export all derive status from a single source of truth.
 */

export type OnboardingStatus = 'assigned' | 'pending' | 'byov';

export interface OnboardingStatusInput {
  truckAssigned: boolean;
  assignedTruckNo: string | null | undefined;
  byovIntent?: string | null;
}

/** Truck numbers starting with "88" are BYOV (Bring-Your-Own-Vehicle). */
export function isByovTruckNumber(truckNo: string | null | undefined): boolean {
  return !!truckNo && truckNo.trim().startsWith('88');
}

export function deriveOnboardingStatus(hire: OnboardingStatusInput): OnboardingStatus {
  if (hire.truckAssigned && isByovTruckNumber(hire.assignedTruckNo)) return 'byov';
  if (hire.truckAssigned) return 'assigned';
  return 'pending';
}

/** "BYOV Intent" column value, only meaningful on Pending rows. */
export type ByovIntentDisplay = 'Perm' | 'Training' | 'NA';

export function formatByovIntent(hire: OnboardingStatusInput): ByovIntentDisplay {
  if (deriveOnboardingStatus(hire) !== 'pending') return 'NA';
  if (hire.byovIntent === 'perm') return 'Perm';
  if (hire.byovIntent === 'training') return 'Training';
  return 'NA';
}
