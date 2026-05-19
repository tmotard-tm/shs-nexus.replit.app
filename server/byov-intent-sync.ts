/**
 * BYOV Intent cross-check for Weekly Onboarding Truck Assignments.
 *
 * Takes the current onboarding-hires roster, pulls every RACFID we have,
 * asks the BYOV Dashboard for each tech's enrollment intent in one bulk
 * call, and writes the result back onto the onboarding row.
 *
 * - Matches by RACFID only (no name fallback). Missing RACFID → intent stays null.
 * - On API failure: logs, leaves previously-stored intents untouched, returns
 *   { success: false } so callers can surface staleness. The rest of the
 *   onboarding sync continues regardless.
 */

import { storage } from './storage';
import { lookupByovIntents, isByovDashboardConfigured } from './byov-dashboard-client';

export interface ByovIntentSyncResult {
  success: boolean;
  configured: boolean;
  upstreamOk: boolean;
  hiresChecked: number;
  hiresSkippedDueToFailure: number;
  intentsFound: number;
  recordsUpdated: number;
  errors: string[];
}

export async function syncByovIntentForOnboarding(): Promise<ByovIntentSyncResult> {
  const result: ByovIntentSyncResult = {
    success: false,
    configured: isByovDashboardConfigured(),
    upstreamOk: false,
    hiresChecked: 0,
    hiresSkippedDueToFailure: 0,
    intentsFound: 0,
    recordsUpdated: 0,
    errors: [],
  };

  if (!result.configured) {
    result.errors.push('BYOV Dashboard is not configured (missing BYOV_DASHBOARD_URL or FS_BYOV_API_KEY)');
    return result;
  }

  try {
    const hires = await storage.getOnboardingHires();
    const hiresWithRacfid = hires.filter(h => h.enterpriseId && h.enterpriseId.trim() !== '');
    result.hiresChecked = hiresWithRacfid.length;

    if (hiresWithRacfid.length === 0) {
      result.success = true;
      result.upstreamOk = true;
      return result;
    }

    const racfids = hiresWithRacfid.map(h => h.enterpriseId!.trim().toUpperCase());
    const outcome = await lookupByovIntents(racfids);
    result.upstreamOk = outcome.ok;
    result.intentsFound = outcome.results.size;
    if (outcome.error) result.errors.push(outcome.error);

    // RACFIDs whose batch failed — we cannot tell anything about their intent,
    // so do NOT overwrite the previously stored value (and do NOT bump checkedAt).
    const failedSet = new Set(outcome.failedRacfids);

    const now = new Date();
    for (const hire of hiresWithRacfid) {
      const key = hire.enterpriseId!.trim().toUpperCase();

      if (failedSet.has(key)) {
        result.hiresSkippedDueToFailure++;
        continue;
      }

      const match = outcome.results.get(key) || null;
      const nextIntent = match?.intent ?? null;
      const nextEnrollmentId = match?.enrollmentId ?? null;

      const intentChanged = (hire.byovIntent ?? null) !== nextIntent
        || (hire.byovEnrollmentId ?? null) !== nextEnrollmentId;

      try {
        await storage.updateOnboardingHire(hire.id, {
          byovIntent: nextIntent,
          byovEnrollmentId: nextEnrollmentId,
          byovIntentCheckedAt: now,
        });
        if (intentChanged) result.recordsUpdated++;
      } catch (err: any) {
        result.errors.push(`Failed to update hire ${hire.id} (${hire.employeeName}): ${err?.message || err}`);
      }
    }

    // Overall success means the upstream call succeeded for every batch and
    // we were able to authoritatively refresh every row.
    result.success = outcome.ok && result.hiresSkippedDueToFailure === 0;
    console.log(
      `[BYOVIntentSync] upstreamOk=${result.upstreamOk}, checked=${result.hiresChecked}, ` +
      `found=${result.intentsFound}, updated=${result.recordsUpdated}, ` +
      `skipped(failure)=${result.hiresSkippedDueToFailure}`
    );
    return result;
  } catch (err: any) {
    result.errors.push(`Sync failed: ${err?.message || err}`);
    console.error('[BYOVIntentSync] Failed:', err);
    return result;
  }
}
