import { getSnowflakeSyncService } from './snowflake-sync-service';
import { isSnowflakeConfigured } from './snowflake-service';
import { db } from './db';
import { queueItems, amsVehiclesCache, externalWatermarkState, fleetOperationLog, operationEvents, holmanVehiclesCache, tpmsCachedAssignments, syncLogs } from '@shared/schema';
import { eq, and, isNotNull, desc, gte, sql } from 'drizzle-orm';
import { toCanonical } from './vehicle-number-utils';
import { loadActiveFenceSet } from './fleet-reconciliation/fences';
import { getInitialToolsTaskStatus, TOOLS_OWNER } from './byov-utils';
import { storage } from './storage';
import { createOffboardingQueueTasks } from './create-offboarding-tasks-service';
import {
  runDailyTruckInventoryRefreshTick,
  type TruckInventoryRefreshTrigger,
} from './truck-inventory-refresh';

const SYNC_HOUR_EST = 5; // 5am EST
const CHECK_INTERVAL_MS = 60 * 1000; // Check every minute
const TRUCK_INVENTORY_CHECK_INTERVAL_MS = 60 * 1000;
const ENRICH_INTERVAL_HOURS = 12; // Enrich every 12 hours
const SEPARATION_POLL_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes for separation sync
const NOTIFICATION_BACKFILL_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const OP_EVENTS_RETRY_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes for operation events retry
const OFFBOARDING_TASKS_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes for offboarding gap-check
const EXTERNAL_WATERMARK_POLL_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes for TPMS/AMS external change detection
const TPMS_STALE_SWEEP_INTERVAL_MS = 4 * 60 * 60 * 1000;   // 4 hours — validates cached assignments against live TPMS
const DISTRICT_COST_CENTER_SEED_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours — auto-seed any new districts that appeared in fleet data
// Automatic district cost-center seeding is DISABLED. Cost centers change
// rarely and the auto-seed re-derived districts from dirty roster data,
// resurrecting invalid districts (e.g. 3132 / 3580) that admins had deleted.
// Seeding is now manual-only via the "Run auto-seed now" admin trigger
// (triggerDistrictCostCenterSeed → runDistrictCostCenterSeed with force:true).
// Flip this to `true` to re-enable the startup / scheduler-tick / post-daily-sync
// automatic seeds.
const DISTRICT_COST_CENTER_AUTO_SEED_ENABLED = false;

let lastSyncDate: string | null = null;
let lastEnrichTime: number | null = null; // Timestamp of last enrichment
let lastSeparationPollTime: number | null = null; // Sprint 0: Track separation polls
let lastNotificationBackfillTime: number | null = null;
let lastOpEventsRetryTime: number | null = null;
let lastOffboardingTasksTime: number | null = null;
let lastTpmsPollTime: number | null = null; // External TPMS watermark poll
let lastAmsPollTime: number | null = null; // External AMS watermark poll
let lastTpmsStaleSweepTime: number | null = null; // Stale TPMS cache validation sweep
let lastDistrictCostCenterSeedTime: number | null = null; // Last successful auto-seed of district cost center table
let lastDistrictCostCenterSeedAttemptTime: number | null = null; // Last attempt (success or failure) — used for short-term retry backoff
// Most recent unacknowledged auto-seed batch that inserted >0 new districts.
// Drives the in-app banner on the District Cost Centers page so admins know
// they should review/assign cost centers for newly added rows.
let pendingDistrictCostCenterNotification: {
  districts: string[];
  at: Date;
  source: string;
} | null = null;
let schedulerRunning = false;
let intervalId: NodeJS.Timeout | null = null;
let truckInventoryIntervalId: NodeJS.Timeout | null = null;
let truckInventoryCheckRunning = false;
let separationPollIntervalId: NodeJS.Timeout | null = null;
let notificationBackfillIntervalId: NodeJS.Timeout | null = null;

const isDevelopment = process.env.NODE_ENV !== 'production';

function getESTDate(): Date {
  const now = new Date();
  const estOffset = -5 * 60; // EST is UTC-5 (ignoring DST for simplicity)
  const estTime = new Date(now.getTime() + (now.getTimezoneOffset() + estOffset) * 60 * 1000);
  return estTime;
}

function getDateString(date: Date): string {
  return date.toISOString().split('T')[0];
}

async function checkAndRunSync(): Promise<void> {
  if (isSnowflakeConfigured()) {
    try {
      const estNow = getESTDate();
      const currentHour = estNow.getHours();
      const currentDateStr = getDateString(estNow);

      if (currentHour === SYNC_HOUR_EST && lastSyncDate !== currentDateStr) {
        console.log(`[Scheduler] Running scheduled sync at ${estNow.toISOString()} (5am EST)`);
        
        const syncService = getSnowflakeSyncService();
        
        console.log('[Scheduler] Starting termed techs sync...');
        const termedResult = await syncService.syncTermedTechs('scheduler');
        console.log(`[Scheduler] Termed techs sync complete: ${termedResult.recordsProcessed} processed, ${termedResult.queueItemsCreated} queue items created`);
        
        console.log('[Scheduler] Starting separation details enrichment...');
        const enrichResult = await syncService.enrichOffboardingWithSeparationDetails();
        console.log(`[Scheduler] Separation enrichment complete: ${enrichResult.enrichedCount} enriched, ${enrichResult.noMatchCount} no match`);

        console.log('[Scheduler] Starting all techs sync...');
        const allTechsResult = await syncService.syncAllTechs('scheduler');
        console.log(`[Scheduler] All techs sync complete: ${allTechsResult.recordsProcessed} processed`);

        // Task #221: refresh the in-process TPMS snapshot right after the
        // nightly TPMS sync so daytime callers (decomm batch SMS, rental
        // enrichment, manager-phone hydration, etc.) read the same fresh
        // dataset Snowflake just delivered. Non-fatal — failures keep the
        // previous snapshot in place.
        try {
          const { refreshSnapshot } = await import('./fleet-scope-tpms-snapshot');
          const snapResult = await refreshSnapshot('scheduler');
          console.log(
            `[Scheduler] TPMS snapshot refresh complete: ok=${snapResult.ok}, ` +
              `${snapResult.count} LDAPs in ${snapResult.durationMs}ms`,
          );
        } catch (snapErr: any) {
          console.error('[Scheduler] TPMS snapshot refresh failed (non-fatal):', snapErr?.message);
        }

        // Task #487: refresh the All Vehicles roster mirror right after the TPMS
        // snapshot so the All Vehicles page serves today's roster from local
        // Postgres instead of live Snowflake. Non-fatal — keeps last-good on error.
        try {
          const { runMirrorRefreshIfNeeded } = await import('./fleet-scope-all-vehicles-mirror');
          await runMirrorRefreshIfNeeded('scheduler');
        } catch (mirrorErr: any) {
          console.error('[Scheduler] All Vehicles mirror refresh failed (non-fatal):', mirrorErr?.message);
        }

        console.log('[Scheduler] Starting vehicle odometer enrichment...');
        try {
          const odoResult = await syncService.enrichVehicleOdometerData();
          console.log(`[Scheduler] Odometer enrichment complete: ${odoResult.vehiclesUpdated} vehicles updated`);
        } catch (odoErr: any) {
          console.error('[Scheduler] Odometer enrichment failed (non-fatal):', odoErr?.message);
        }

        // Sync open rentals from Rental Ops into Fleet Scope Rentals Dashboard
        try {
          const { syncRentalOpsToFleetScope } = await import('./rental-ops-sync');
          console.log('[Scheduler] Starting Rental Ops → Fleet Scope auto-sync...');
          const rentalSyncResult = await syncRentalOpsToFleetScope('scheduler');
          // Best-effort cross-replica invalidation. Imported lazily so any
          // import failure (file rename, etc.) is fully non-fatal — the
          // sync itself already succeeded.
          if (rentalSyncResult.added.length > 0 || rentalSyncResult.removed.length > 0 || rentalSyncResult.updated > 0) {
            try {
              const { invalidateTrucksCache } = await import('./fleet-scope-routes');
              invalidateTrucksCache();
            } catch (invErr: any) {
              console.warn('[Scheduler] invalidateTrucksCache (post-rental-sync) failed (non-fatal):', invErr?.message);
            }
          }
          console.log(`[Scheduler] Rental Ops sync complete — Added: ${rentalSyncResult.added.length}, Removed: ${rentalSyncResult.removed.length}, Date-filled: ${rentalSyncResult.updated}, Unchanged: ${rentalSyncResult.unchanged}`);
        } catch (rentalErr: any) {
          console.error('[Scheduler] Rental Ops → Fleet Scope sync failed (non-fatal):', rentalErr?.message);
        }

        // Auto-seed district cost-center table so any newly synced districts
        // appear on the management page same-day. Force the run by clearing
        // both throttle timestamps first. DISABLED — seeding is manual-only.
        if (DISTRICT_COST_CENTER_AUTO_SEED_ENABLED) {
          try {
            lastDistrictCostCenterSeedTime = null;
            lastDistrictCostCenterSeedAttemptTime = null;
            await checkAndRunDistrictCostCenterSeed();
          } catch (seedErr: any) {
            console.error('[Scheduler] District cost-center seed (post-daily-sync) failed (non-fatal):', seedErr?.message);
          }
        }

        lastSyncDate = currentDateStr;
        console.log(`[Scheduler] Scheduled sync completed successfully for ${currentDateStr}`);
      }

      await checkAndRunEnrichment();
    } catch (error) {
      console.error('[Scheduler] Error during scheduled sync:', error);
    }
  }

  await checkAndRunOpEventsRetry();
  await checkAndRunOffboardingTasks();
  await checkAndRunTpmsPoll();
  await checkAndRunAmsPoll();
  await checkAndRunTpmsStaleSweep();
  if (DISTRICT_COST_CENTER_AUTO_SEED_ENABLED) {
    await checkAndRunDistrictCostCenterSeed();
  }
}

async function checkAndRunTruckInventory(
  trigger: TruckInventoryRefreshTrigger,
): Promise<void> {
  if (truckInventoryCheckRunning) return;
  truckInventoryCheckRunning = true;
  try {
    const tick = await runDailyTruckInventoryRefreshTick(trigger);
    if (!tick.ran) {
      if (trigger === 'startup_catchup') {
        console.log(`[Scheduler] Truck inventory startup check: ${tick.skippedReason}`);
      }
      return;
    }

    if (tick.result?.success) {
      const suffix = tick.result.recordsProcessed > 0
        ? `${tick.result.recordsProcessed} rows replaced`
        : tick.result.skippedReason || 'completed';
      console.log(`[Scheduler] Truck inventory refresh ${suffix}`);
    } else {
      console.error(
        '[Scheduler] Truck inventory refresh failed (will retry):',
        tick.result?.errors?.join('; ') || 'unknown error',
      );
    }
  } catch (error: any) {
    console.error(
      '[Scheduler] Truck inventory refresh error (will retry):',
      error?.message || error,
    );
  } finally {
    truckInventoryCheckRunning = false;
  }
}

async function checkAndRunEnrichment(): Promise<void> {
  try {
    if (!isSnowflakeConfigured()) {
      return;
    }

    const now = Date.now();
    const twelveHoursMs = ENRICH_INTERVAL_HOURS * 60 * 60 * 1000;

    // Run enrichment if we haven't run it yet or if 12 hours have passed
    if (lastEnrichTime === null || (now - lastEnrichTime) >= twelveHoursMs) {
      console.log(`[Scheduler] Running enrichments (every ${ENRICH_INTERVAL_HOURS} hours)`);
      
      const syncService = getSnowflakeSyncService();
      const result = await syncService.enrichOnboardingHires();
      console.log(`[Scheduler] Onboarding enrichment complete: ${result.enrichedCount} records enriched`);

      const sepResult = await syncService.enrichOffboardingWithSeparationDetails();
      console.log(`[Scheduler] Separation enrichment complete: ${sepResult.enrichedCount} enriched, ${sepResult.noMatchCount} no match`);

      try {
        const { syncByovIntentForOnboarding } = await import('./byov-intent-sync');
        const byovResult = await syncByovIntentForOnboarding();
        console.log(`[Scheduler] BYOV intent cross-check: configured=${byovResult.configured}, checked=${byovResult.hiresChecked}, found=${byovResult.intentsFound}, updated=${byovResult.recordsUpdated}`);
      } catch (err) {
        console.error('[Scheduler] BYOV intent cross-check failed (non-fatal):', err);
      }

      lastEnrichTime = now;
    }
  } catch (error) {
    console.error('[Scheduler] Error during onboarding enrichment:', error);
  }
}

async function checkAndRunSeparationPoll(): Promise<void> {
  try {
    if (!isSnowflakeConfigured()) {
      return;
    }

    const now = Date.now();

    if (lastSeparationPollTime === null || (now - lastSeparationPollTime) >= SEPARATION_POLL_INTERVAL_MS) {
      console.log('[Scheduler] Polling for new separation records (every 30 minutes)');
      
      const syncService = getSnowflakeSyncService();
      const result = await syncService.syncNewSeparations('scheduler');
      
      lastSeparationPollTime = now;
      
      if (result.newRecordsFound > 0) {
        console.log(`[Scheduler] Separation poll complete: ${result.newRecordsFound} new records, ${result.tasksCreated} tasks created`);
      } else {
        console.log('[Scheduler] Separation poll complete: no new records');
      }
    }
  } catch (error) {
    console.error('[Scheduler] Error during separation poll:', error);
  }
}

async function checkAndRunNotificationBackfill(): Promise<void> {
  try {
    const now = Date.now();

    if (lastNotificationBackfillTime === null || (now - lastNotificationBackfillTime) >= NOTIFICATION_BACKFILL_INTERVAL_MS) {
      console.log('[Scheduler] Running notification backfill scan (every 6 hours)');

      // Task #424: refresh tool-audit snapshot before backfills so completion checks are current
      try {
        const { refreshToolAuditSnapshot } = await import('./tool-audit-snapshot');
        await refreshToolAuditSnapshot();
      } catch (err: any) {
        console.error('[Scheduler] Tool audit snapshot refresh failed:', err?.message || err);
      }

      const { runToolAuditBackfill, runOutreachBackfill } = await import('./notification-backfill');
      const result = await runToolAuditBackfill();

      lastNotificationBackfillTime = now;

      console.log(`[Scheduler] Notification backfill complete: ${result.totalChecked} checked, ${result.newlySent} sent, ${result.alreadySent} already sent, ${result.skippedNoEmail} skipped, ${result.failed} failed`);

      try {
        const outreach = await runOutreachBackfill();
        console.log(`[Scheduler] Recovery outreach backfill complete: ${outreach.totalChecked} checked, ${outreach.newlySent} sent, ${outreach.alreadySent} already sent, ${outreach.skippedAuditComplete} audit-complete, ${outreach.failed} failed`);
      } catch (err: any) {
        console.error('[Scheduler] Recovery outreach backfill error:', err?.message || err);
      }
    }
  } catch (error) {
    console.error('[Scheduler] Error during notification backfill:', error);
  }
}

async function checkAndRunOpEventsRetry(): Promise<void> {
  try {
    const now = Date.now();
    if (lastOpEventsRetryTime !== null && (now - lastOpEventsRetryTime) < OP_EVENTS_RETRY_INTERVAL_MS) {
      return;
    }
    const { retryFailedOperationEvents } = await import("./fleet-operations-service");
    const result = await retryFailedOperationEvents();
    lastOpEventsRetryTime = now;
    if (result.retried > 0) {
      console.log(`[Scheduler] OpEvents retry: ${result.retried} retried, ${result.succeeded} succeeded, ${result.failed} failed`);
    }
  } catch (error: any) {
    console.error('[Scheduler] Error during operation events retry:', error?.message);
  }
}

async function checkAndRunOffboardingTasks(): Promise<void> {
  try {
    const now = Date.now();
    if (lastOffboardingTasksTime !== null && (now - lastOffboardingTasksTime) < OFFBOARDING_TASKS_INTERVAL_MS) {
      return;
    }
    lastOffboardingTasksTime = now;
    console.log('[Scheduler] Running offboarding gap-check (every 30 minutes)');
    const result = await createOffboardingQueueTasks('scheduler');
    console.log(`[Scheduler] Offboarding gap-check complete: ${result.techsProcessed} techs, ${result.tasksCreated} tasks created, ${result.tasksSkipped} skipped`);
  } catch (error: any) {
    console.error('[Scheduler] Error during offboarding gap-check:', error?.message);
  }
}

/**
 * Auto-seed the district_cost_centers table with any districts that have appeared
 * in fleet/TPMS/AMS data since the last seed. Existing rows (including manual
 * overrides) are preserved — the underlying storage method uses
 * onConflictDoNothing so only brand-new districts get inserted with their
 * default cost centers. Runs at most once per 24 hours on success; on failure
 * the success timestamp is left untouched so the next scheduler tick (~60s)
 * can retry promptly. A separate `lastAttempt` tracker prevents tight retry
 * loops if the seed throws repeatedly.
 *
 * When `force` is true (manual admin trigger via API), throttle checks are
 * skipped but timestamps are still updated so subsequent scheduled runs honor
 * the manual run and the management UI reflects it.
 */
const DISTRICT_COST_CENTER_RETRY_AFTER_FAILURE_MS = 5 * 60 * 1000;

async function runDistrictCostCenterSeed(
  source: string,
  options: { force?: boolean } = {},
): Promise<{ ran: boolean; inserted: number; existing: number; insertedDistricts: string[] }> {
  const now = Date.now();
  if (!options.force) {
    // Throttle by last successful run (24h) — but if we've never succeeded,
    // fall back to throttling by last attempt (5 min) to avoid hammering on
    // persistent failures while still allowing reasonably quick retry.
    if (
      lastDistrictCostCenterSeedTime !== null &&
      (now - lastDistrictCostCenterSeedTime) < DISTRICT_COST_CENTER_SEED_INTERVAL_MS
    ) {
      return { ran: false, inserted: 0, existing: 0, insertedDistricts: [] };
    }
    if (
      lastDistrictCostCenterSeedAttemptTime !== null &&
      (now - lastDistrictCostCenterSeedAttemptTime) < DISTRICT_COST_CENTER_RETRY_AFTER_FAILURE_MS
    ) {
      return { ran: false, inserted: 0, existing: 0, insertedDistricts: [] };
    }
  }
  lastDistrictCostCenterSeedAttemptTime = now;
  const result = await storage.seedDefaultDistrictCostCenters(source);
  lastDistrictCostCenterSeedTime = now;
  if (result.inserted > 0 || options.force) {
    console.log(
      `[Scheduler] District cost-center seed (${source}${options.force ? ', forced' : ''}): ` +
      `${result.inserted} new districts added (${result.existing} already present)`,
    );
  }
  // Surface a notification (banner + activity log) when the auto-seed
  // actually adds new districts. Skip when a manual init/trigger ran with no
  // inserts to avoid noisy "0 new" notifications.
  if (result.inserted > 0 && result.insertedDistricts.length > 0) {
    const at = new Date(now);
    // Merge with any pending unacknowledged batch so consecutive runs in the
    // same window don't drop earlier districts. Dedupe to keep list tidy.
    const merged = new Set<string>(pendingDistrictCostCenterNotification?.districts ?? []);
    for (const d of result.insertedDistricts) merged.add(d);
    pendingDistrictCostCenterNotification = {
      districts: Array.from(merged).sort(),
      at,
      source,
    };
    const sample = result.insertedDistricts.slice(0, 10).join(', ');
    const more = result.insertedDistricts.length > 10 ? ` (+${result.insertedDistricts.length - 10} more)` : '';
    console.log(
      `[Scheduler] District cost-center auto-seed admin notification queued: ` +
      `${result.insertedDistricts.length} new district${result.insertedDistricts.length === 1 ? '' : 's'} → ${sample}${more}`,
    );
  }
  return {
    ran: true,
    inserted: result.inserted,
    existing: result.existing,
    insertedDistricts: result.insertedDistricts,
  };
}

/**
 * Returns the most recent unacknowledged auto-seed insertion batch (or null
 * when there is nothing new to surface). Consumed by the District Cost
 * Centers page to render a "newly added — please review" banner.
 */
export function getPendingDistrictCostCenterNotification(): {
  districts: string[];
  at: string;
  source: string;
} | null {
  if (!pendingDistrictCostCenterNotification) return null;
  return {
    districts: [...pendingDistrictCostCenterNotification.districts],
    at: pendingDistrictCostCenterNotification.at.toISOString(),
    source: pendingDistrictCostCenterNotification.source,
  };
}

/**
 * Clears the pending notification — called after an admin reviews/dismisses
 * the in-app banner on the District Cost Centers page.
 */
export function clearPendingDistrictCostCenterNotification(): void {
  pendingDistrictCostCenterNotification = null;
}

async function checkAndRunDistrictCostCenterSeed(): Promise<void> {
  // Defense-in-depth: even if a caller forgets to gate, never auto-seed when
  // automatic seeding is disabled. Manual seeding goes through
  // triggerDistrictCostCenterSeed (force:true) and bypasses this function.
  if (!DISTRICT_COST_CENTER_AUTO_SEED_ENABLED) {
    return;
  }
  try {
    await runDistrictCostCenterSeed('scheduler');
  } catch (error: any) {
    console.error('[Scheduler] Error during district cost-center auto-seed:', error?.message);
  }
}

// ─── Watermark helpers ────────────────────────────────────────────────────────

/**
 * Read the last-poll timestamp for a given system from the DB watermark table.
 * Returns null if no record exists yet.
 */
async function getWatermarkFromDb(systemName: string): Promise<Date | null> {
  try {
    const rows = await db.select({ lastPollAt: externalWatermarkState.lastPollAt })
      .from(externalWatermarkState)
      .where(eq(externalWatermarkState.systemName, systemName))
      .limit(1);
    return rows[0]?.lastPollAt ?? null;
  } catch {
    return null;
  }
}

/**
 * Persist a new watermark timestamp for a given system.
 */
async function saveWatermarkToDb(systemName: string, ts: Date, status: string = 'ok', errorMsg: string | null = null): Promise<void> {
  try {
    await db.insert(externalWatermarkState).values({
      systemName,
      lastPollAt: ts,
      lastPollStatus: status,
      lastErrorMessage: errorMsg,
    }).onConflictDoUpdate({
      target: externalWatermarkState.systemName,
      set: { lastPollAt: ts, lastPollStatus: status, lastErrorMessage: errorMsg, updatedAt: new Date() },
    });
  } catch (err: any) {
    console.error(`[Watermark] Failed to save watermark for ${systemName}:`, err?.message);
  }
}

/**
 * Check whether a Nexus operation_events row exists for a given truck within the last 30 minutes.
 * Used to distinguish external changes from changes Nexus itself orchestrated.
 */
async function hasPendingNexusOp(truckNumber: string): Promise<boolean> {
  try {
    const cutoff = new Date(Date.now() - 30 * 60 * 1000);
    const rows = await db.select({ id: operationEvents.id })
      .from(operationEvents)
      .where(and(
        eq(operationEvents.truckNumber, truckNumber),
        gte(operationEvents.createdAt, cutoff),
      ))
      .limit(1);
    return rows.length > 0;
  } catch {
    return false;
  }
}

// ─── TPMS Watermark Poll ──────────────────────────────────────────────────────

async function checkAndRunTpmsPoll(): Promise<void> {
  try {
    const now = Date.now();
    if (lastTpmsPollTime !== null && (now - lastTpmsPollTime) < EXTERNAL_WATERMARK_POLL_INTERVAL_MS) {
      return;
    }

    // Seed from DB if first run in this process
    let watermarkTs: Date | null = null;
    if (lastTpmsPollTime === null) {
      watermarkTs = await getWatermarkFromDb('tpms');
    } else {
      watermarkTs = new Date(lastTpmsPollTime);
    }
    lastTpmsPollTime = now;

    // Default watermark: 15 minutes ago if no prior run
    if (!watermarkTs) {
      watermarkTs = new Date(now - EXTERNAL_WATERMARK_POLL_INTERVAL_MS);
    }

    const { getTpmsApiService } = await import('./tpms-api-service');
    const tpmsApi = getTpmsApiService();

    // TPMS API requires format 'YYYY-MM-DDTHH:mm:ss' in Eastern time (no Z, no ms)
    const toEasternTimestamp = (d: Date): string => {
      const estStr = d.toLocaleString('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
      });
      // estStr: "04/09/2026, 11:01:13" → "2026-04-09T11:01:13"
      const [datePart, timePart] = estStr.split(', ');
      const [month, day, year] = datePart.split('/');
      const safeTime = timePart.replace(/^24:/, '00:'); // guard midnight edge-case
      return `${year}-${month}-${day}T${safeTime}`;
    };

    let techs: any[];
    try {
      const result = await tpmsApi.getTechsUpdatedAfter(toEasternTimestamp(watermarkTs));
      techs = result?.techInfoList ?? (Array.isArray(result) ? result : []);
    } catch (err: any) {
      console.error('[Scheduler] TPMS watermark poll failed (non-fatal):', err?.message);
      await saveWatermarkToDb('tpms', watermarkTs, 'error', err?.message);
      return;
    }

    const pollTime = new Date();
    let upserted = 0;
    let flagged = 0;

    for (const tech of techs) {
      try {
        const enterpriseId: string = (tech.ldapId || tech.enterpriseId || '').trim().toUpperCase();
        const truckNo: string = (tech.truckNo || '').trim();
        if (!enterpriseId) continue;

        // Fetch previous cache state so we can detect actual changes
        const prevCache = await db.select({
          truckNo: tpmsCachedAssignments.truckNo,
          enterpriseId: tpmsCachedAssignments.enterpriseId,
        }).from(tpmsCachedAssignments)
          .where(eq(tpmsCachedAssignments.lookupKey, enterpriseId))
          .limit(1);
        const prevTruckNo = prevCache[0]?.truckNo ?? null;

        // Upsert into tpms_cached_assignments
        await db.insert(tpmsCachedAssignments).values({
          lookupKey: enterpriseId,
          lookupType: 'enterprise_id',
          truckNo: truckNo || null,
          enterpriseId,
          techId: tech.techId || null,
          firstName: tech.firstName || null,
          lastName: tech.lastName || null,
          districtNo: tech.districtNo || null,
          contactNo: tech.contactNo || null,
          email: tech.email || null,
          rawResponse: JSON.stringify(tech),
          status: 'live',
          lastSuccessAt: pollTime,
          lastAttemptAt: pollTime,
          failureCount: 0,
        }).onConflictDoUpdate({
          target: tpmsCachedAssignments.lookupKey,
          set: {
            truckNo: truckNo || null,
            enterpriseId,
            rawResponse: JSON.stringify(tech),
            status: 'live',
            lastSuccessAt: pollTime,
            lastAttemptAt: pollTime,
            failureCount: 0,
            updatedAt: pollTime,
          },
        });

        // Also update holman_vehicles_cache.tpmsAssignedTechId for any matching truck.
        // TPMS truck numbers arrive zero-padded and sometimes space-padded (e.g. "036177 "),
        // while holman_vehicles_cache stores them unpadded ("36177"). Match on the CANONICAL
        // number (leading zeros stripped, whitespace trimmed) on BOTH sides so the formats
        // line up. We canonicalize holman_vehicle_number in SQL (always present) rather than
        // the derived tpms_vehicle_ref column, which can be stale/null on older rows.
        const canonicalTruckNo = toCanonical(truckNo);
        if (canonicalTruckNo) {
          try {
            await db.update(holmanVehiclesCache)
              .set({ tpmsAssignedTechId: enterpriseId, tpmsAssignedTechName: [tech.firstName, tech.lastName].filter(Boolean).join(' ') || null, tpmsLastSyncAt: pollTime, updatedAt: pollTime })
              .where(sql`regexp_replace(btrim(${holmanVehiclesCache.holmanVehicleNumber}), '^0+', '') = ${canonicalTruckNo}`);
          } catch { /* non-fatal */ }
        } else if (prevTruckNo) {
          // Tech was unassigned — clear the holman cache entry for the old truck
          const canonicalPrev = toCanonical(prevTruckNo);
          if (canonicalPrev) {
            try {
              await db.update(holmanVehiclesCache)
                .set({ tpmsAssignedTechId: null, tpmsAssignedTechName: null, tpmsLastSyncAt: pollTime, updatedAt: pollTime })
                .where(sql`regexp_replace(btrim(${holmanVehiclesCache.holmanVehicleNumber}), '^0+', '') = ${canonicalPrev}`);
            } catch { /* non-fatal */ }
          }
        }

        upserted++;

        // Flag external change if truck assignment changed and no Nexus op explains it
        const truckChanged = truckNo !== (prevTruckNo ?? '');
        if (truckChanged && prevCache.length > 0) {
          const lookupTruck = truckNo || prevTruckNo || '';
          const hasPending = lookupTruck ? await hasPendingNexusOp(lookupTruck) : false;
          if (!hasPending) {
            await db.insert(fleetOperationLog).values({
              operationType: 'external_change',
              truckNumber: truckNo || prevTruckNo,
              fromLdap: null,
              toLdap: enterpriseId,
              toTechName: [tech.firstName, tech.lastName].filter(Boolean).join(' ') || null,
              districtNo: tech.districtNo || null,
              tpmsStatus: 'skipped',
              holmanStatus: 'skipped',
              amsStatus: 'skipped',
              requestedBy: 'tpms_external',
              source: 'tpms_external',
              notes: `External TPMS change detected: truck was "${prevTruckNo ?? ''}", now "${truckNo}". No matching Nexus operation found within 30 min.`,
              tpmsMessage: null,
              holmanMessage: null,
              amsMessage: null,
              completedAt: pollTime,
            });
            flagged++;
          }
        }
      } catch (err: any) {
        console.error('[Scheduler] Error processing TPMS watermark tech:', err?.message);
      }
    }

    await saveWatermarkToDb('tpms', pollTime, 'ok', null);

    if (upserted > 0 || flagged > 0) {
      console.log(`[Scheduler] TPMS watermark poll complete: ${upserted} techs upserted, ${flagged} external changes flagged`);
    }
  } catch (err: any) {
    console.error('[Scheduler] TPMS watermark poll error (non-fatal):', err?.message);
  }
}

// ─── TPMS Stale Cache Sweep ──────────────────────────────────────────────────
// Validates assigned tpms_cached_assignments records older than 4 hours by
// re-querying TPMS live. Catches anything the watermark poll missed (e.g. due
// to server restarts resetting the watermark, or pre-Nexus stale imports).

async function checkAndRunTpmsStaleSweep(): Promise<void> {
  // [TPMS-CACHE-FREEZE 2026-06-17] tpms_cached_assignments retired as a board source; this sweep only
  // validated/wrote that legacy cache and would otherwise re-hit the TPMS API every 4h for rows that
  // never refresh. Disabled. Revert: delete the next 2 lines.
  const FREEZE_TPMS_CACHE_WRITES: boolean = true;
  if (FREEZE_TPMS_CACHE_WRITES) return;
  const now = Date.now();
  if (lastTpmsStaleSweepTime !== null && (now - lastTpmsStaleSweepTime) < TPMS_STALE_SWEEP_INTERVAL_MS) {
    return;
  }
  lastTpmsStaleSweepTime = now;

  try {
    const { getTPMSService } = await import('./tpms-service');
    const tpms = getTPMSService();
    if (!tpms.isConfigured()) return;

    // Find assigned cache records not refreshed in the last 4 hours (batch of 50 per sweep)
    const { sql: rawSql } = await import('drizzle-orm');
    const staleRows = await db.execute(rawSql`
      SELECT enterprise_id, truck_no
      FROM tpms_cached_assignments
      WHERE truck_no IS NOT NULL AND truck_no <> ''
        AND enterprise_id IS NOT NULL AND enterprise_id <> ''
        AND last_success_at < NOW() - INTERVAL '4 hours'
      ORDER BY last_success_at ASC
      LIMIT 50
    `);

    const rows: Array<{ enterprise_id: string; truck_no: string }> =
      (staleRows as any).rows ?? (Array.isArray(staleRows) ? staleRows : []);

    if (rows.length === 0) return;

    console.log(`[Scheduler] TPMS stale sweep: validating ${rows.length} cached assignments against live TPMS`);
    let updated = 0;
    let evicted = 0;

    for (const row of rows) {
      try {
        const live = await tpms.getTechInfo(row.enterprise_id).catch(() => null);
        const liveTruck = (live?.truckNo ?? '').trim();
        const cachedTruck = (row.truck_no ?? '').trim();

        if (!liveTruck) {
          // TPMS confirms unassigned — evict the stale record
          await db.delete(tpmsCachedAssignments)
            .where(eq(tpmsCachedAssignments.enterpriseId, row.enterprise_id));
          evicted++;
        } else if (liveTruck !== cachedTruck) {
          // Assignment changed — update the cache with the new truck
          await db.update(tpmsCachedAssignments)
            .set({
              truckNo: liveTruck,
              lastSuccessAt: new Date(),
              updatedAt: new Date(),
              status: 'live',
            })
            .where(eq(tpmsCachedAssignments.enterpriseId, row.enterprise_id));
          updated++;
        } else {
          // Still correct — just refresh the timestamp so it won't be swept again for 4h
          await db.update(tpmsCachedAssignments)
            .set({ lastSuccessAt: new Date(), updatedAt: new Date() })
            .where(eq(tpmsCachedAssignments.enterpriseId, row.enterprise_id));
        }

        // Brief pause to respect TPMS rate limits
        await new Promise(r => setTimeout(r, 200));
      } catch (err: any) {
        console.warn(`[Scheduler] TPMS stale sweep: error validating ${row.enterprise_id}:`, err?.message);
      }
    }

    if (updated > 0 || evicted > 0) {
      console.log(`[Scheduler] TPMS stale sweep complete: ${updated} updated, ${evicted} evicted (phantom mismatches cleared)`);
    } else {
      console.log(`[Scheduler] TPMS stale sweep complete: ${rows.length} records confirmed current`);
    }
  } catch (err: any) {
    console.error('[Scheduler] TPMS stale sweep error (non-fatal):', err?.message);
  }
}

// ─── AMS Watermark Poll ───────────────────────────────────────────────────────

async function checkAndRunAmsPoll(): Promise<void> {
  try {
    const now = Date.now();
    if (lastAmsPollTime !== null && (now - lastAmsPollTime) < EXTERNAL_WATERMARK_POLL_INTERVAL_MS) {
      return;
    }

    let watermarkTs: Date | null = null;
    if (lastAmsPollTime === null) {
      watermarkTs = await getWatermarkFromDb('ams');
    } else {
      watermarkTs = new Date(lastAmsPollTime);
    }
    lastAmsPollTime = now;

    if (!watermarkTs) {
      watermarkTs = new Date(now - EXTERNAL_WATERMARK_POLL_INTERVAL_MS);
    }

    const { AmsApiService } = await import('./ams-api-service');
    const ams = new AmsApiService();

    if (!ams.isConfigured()) {
      return;
    }

    let techs: any[];
    try {
      const result = await ams.searchTechs({ lastUpdateAfter: watermarkTs.toISOString() });
      techs = Array.isArray(result) ? result : (result?.data ?? result?.items ?? []);
    } catch (err: any) {
      console.error('[Scheduler] AMS watermark poll failed (non-fatal):', err?.message);
      await saveWatermarkToDb('ams', watermarkTs, 'error', err?.message);
      return;
    }

    const pollTime = new Date();
    let upserted = 0;
    let flagged = 0;
    // Write-fence (#b): preserve in-flight backstop AMS assignment corrections.
    const amsAssignFences = await loadActiveFenceSet("ams", "assignment");

    for (const tech of techs) {
      try {
        const vin: string = (tech.VIN || tech.vin || '').trim();
        if (!vin) continue;

        // Fetch previous cache entry for change detection
        const prevCache = await db.select({
          amsAssignedLdap: amsVehiclesCache.amsAssignedLdap,
          amsTruckStatusId: amsVehiclesCache.amsTruckStatusId,
        }).from(amsVehiclesCache)
          .where(eq(amsVehiclesCache.vin, vin))
          .limit(1);

        const prevTech = prevCache[0]?.amsAssignedLdap ?? null;
        const prevStatus = prevCache[0]?.amsTruckStatusId ?? null;
        const vehicleNumber = (tech.VehicleNumber || tech.vehicleNumber || '').trim();
        const amsFenced = amsAssignFences.has(toCanonical(vehicleNumber) || "");

        const newTech = (tech.Tech || tech.LdapId || '').trim() || null;
        const rawStatus = tech.Status ?? tech.status ?? null;
        const amsStatusCode = typeof rawStatus === 'number' ? rawStatus : (rawStatus ? parseInt(rawStatus, 10) : null);

        // AMS Status 4 = "Spare" → default Holman Unassigned ("U")
        // Do NOT infer Storage or BYOV — requires explicit fleet admin intent
        let holmanMappedStatus: string | null = null;
        if (amsStatusCode === 4) {
          holmanMappedStatus = 'U';
        }

        // Upsert into ams_vehicles_cache (lean schema)
        await db.insert(amsVehiclesCache).values({
          vin,
          amsAssignedLdap: newTech,
          amsTruckStatusId: isNaN(amsStatusCode as number) ? null : amsStatusCode,
          amsTruckStatusLabel: tech.StatusLabel || tech.TruckStatusLabel || null,
          rawResponse: tech,
          lastAmsSyncAt: pollTime,
        }).onConflictDoUpdate({
          target: amsVehiclesCache.vin,
          set: {
            // Write-fence (#b): preserve the backstop-written tech while a
            // correction for this truck is in flight (omit amsAssignedLdap so the
            // existing cached value is kept) until the fence is verified/expires.
            ...(amsFenced ? {} : { amsAssignedLdap: newTech }),
            amsTruckStatusId: isNaN(amsStatusCode as number) ? null : amsStatusCode,
            amsTruckStatusLabel: tech.StatusLabel || tech.TruckStatusLabel || null,
            rawResponse: tech,
            lastAmsSyncAt: pollTime,
            updatedAt: pollTime,
          },
        });

        upserted++;

        // Flag external change if tech or status changed and no Nexus op explains it
        const techChanged = newTech !== prevTech;
        const statusChanged = amsStatusCode !== prevStatus;
        // Write-fence (#b): a fenced truck's "tech change" is the backstop's own
        // in-flight correction landing in live AMS — not an external change.
        if ((techChanged || statusChanged) && prevCache.length > 0 && !amsFenced) {
          const lookupTruck = vehicleNumber || '';
          const hasPending = lookupTruck ? await hasPendingNexusOp(lookupTruck) : false;
          if (!hasPending) {
            const changeDesc: string[] = [];
            if (techChanged) changeDesc.push(`tech changed from "${prevTech ?? 'none'}" to "${newTech ?? 'none'}"`);
            if (statusChanged) changeDesc.push(`AMS status changed from ${prevStatus ?? 'null'} to ${amsStatusCode ?? 'null'}`);
            if (amsStatusCode === 4 && holmanMappedStatus) {
              changeDesc.push(`AMS Status 4 (Spare) → Holman mapped to "${holmanMappedStatus}" (Unassigned). Review if Storage or BYOV was intended.`);
            }

            await db.insert(fleetOperationLog).values({
              operationType: 'external_change',
              truckNumber: vehicleNumber || vin,
              fromLdap: prevTech,
              toLdap: newTech,
              toTechName: tech.TechName || null,
              districtNo: tech.District || null,
              tpmsStatus: 'skipped',
              holmanStatus: 'skipped',
              amsStatus: 'skipped',
              requestedBy: 'ams_external',
              source: 'ams_external',
              notes: `External AMS change detected: ${changeDesc.join('; ')}. No matching Nexus operation found within 30 min.`,
              tpmsMessage: null,
              holmanMessage: null,
              amsMessage: null,
              completedAt: pollTime,
            });
            flagged++;
          }
        }
      } catch (err: any) {
        console.error('[Scheduler] Error processing AMS watermark tech:', err?.message);
      }
    }

    await saveWatermarkToDb('ams', pollTime, 'ok', null);

    if (upserted > 0 || flagged > 0) {
      console.log(`[Scheduler] AMS watermark poll complete: ${upserted} vehicles upserted, ${flagged} external changes flagged`);
    }
  } catch (err: any) {
    console.error('[Scheduler] AMS watermark poll error (non-fatal):', err?.message);
  }
}

async function backfillAllDepartments(): Promise<void> {
  try {
    const allOffboardingItems = await db.select()
      .from(queueItems)
      .where(and(
        eq(queueItems.workflowType, 'offboarding'),
        isNotNull(queueItems.workflowId)
      ));

    const workflowMap = new Map<string, typeof allOffboardingItems>();
    for (const item of allOffboardingItems) {
      if (!item.workflowId) continue;
      const list = workflowMap.get(item.workflowId) || [];
      list.push(item);
      workflowMap.set(item.workflowId, list);
    }

    const DEPARTMENTS = ['NTAO', 'Assets Management', 'Inventory Control', 'FLEET'] as const;
    const deptNormalize = (d: string) => {
      const u = d.toUpperCase();
      if (u === 'NTAO') return 'NTAO';
      if (u === 'ASSETS MANAGEMENT' || u === 'ASSETS' || u === 'TOOLS') return 'Assets Management';
      if (u === 'INVENTORY CONTROL' || u === 'INVENTORY') return 'Inventory Control';
      return 'FLEET';
    };

    let totalCreated = 0;
    const createdByDept: Record<string, number> = { NTAO: 0, 'Assets Management': 0, 'Inventory Control': 0, FLEET: 0 };

    for (const [workflowId, items] of workflowMap) {
      const existingDepts = new Set(items.map(i => deptNormalize(i.department || '')));
      const missingDepts = DEPARTMENTS.filter(d => !existingDepts.has(d));
      if (missingDepts.length === 0) continue;

      const sourceItem = items[0];
      let parsedData: any = {};
      try {
        parsedData = typeof sourceItem.data === 'string' ? JSON.parse(sourceItem.data) : (sourceItem.data || {});
      } catch { /* empty */ }

      const techName = parsedData?.employee?.name || parsedData?.technician?.techName || 'Unknown';
      const enterpriseId = parsedData?.employee?.enterpriseId || parsedData?.employee?.racfId || parsedData?.technician?.techRacfid || '';
      const employeeId = parsedData?.employee?.employeeId || parsedData?.technician?.employeeId || '';
      const vehicleNumber = parsedData?.vehicle?.vehicleNumber || parsedData?.vehicle?.truckNo || '';

      const baseData = {
        workflowType: 'offboarding_sequence',
        phase: 'day0',
        isDay0Task: true,
        source: 'backfill',
        syncedAt: sourceItem.createdAt?.toISOString() || new Date().toISOString(),
        submitterInfo: parsedData?.submitterInfo || { id: 'system', name: 'Backfill', email: null },
        workflowId,
        vehicleType: parsedData?.vehicleType || 'cargo_van',
        employee: parsedData?.employee || {
          name: techName, racfId: enterpriseId, employeeId, lastDayWorked: parsedData?.technician?.lastDayWorked || null, enterpriseId,
        },
        vehicle: parsedData?.vehicle || {
          vehicleNumber, vehicleName: vehicleNumber, truckNo: vehicleNumber, location: '', condition: 'unknown', type: 'cargo_van',
        },
        submitter: parsedData?.submitter || { name: 'Backfill', submittedAt: new Date().toISOString() },
        technician: parsedData?.technician || undefined,
        tpmsLookup: parsedData?.tpmsLookup || { attempted: false, success: false, error: null },
      };

      for (const dept of missingDepts) {
        try {
          let taskDef: { title: string; description: string; step: string; subtask: string; workflowStep: number; instructions: string[] };

          if (dept === 'NTAO') {
            taskDef = {
              title: `Day 0: NTAO — National Truck Assortment - Stop Truck Stock Replenishment - ${techName}`,
              description: `IMMEDIATE TASK: Stop truck stock replenishment for ${techName} (${enterpriseId}). Vehicle: ${vehicleNumber || 'TBD'}. This is a Day 0 task.`,
              step: 'ntao_stop_replenishment_day0',
              subtask: 'NTAO',
              workflowStep: 1,
              instructions: [
                "Place a shipping hold to prevent future shipments",
                "Cancel any pending orders for this Employee",
                "Cancel all backorders associated with the vehicle",
                "Remove Employee from automatic replenishment system",
                "Update truck status in NTAO — National Truck Assortment system",
                "Complete Day 0 task - no follow-up tasks until all teams complete Day 0"
              ],
            };
          } else if (dept === 'Assets Management') {
            taskDef = {
              title: `Day 0: Recover Company Equipment - ${techName}`,
              description: `IMMEDIATE TASK: Begin equipment and tools recovery for terminated Employee ${techName} (${enterpriseId}). Truck ${vehicleNumber || 'TBD'}. This is a Day 0 task.`,
              step: 'tools_recover_equipment_day0',
              subtask: 'Assets',
              workflowStep: 2,
              instructions: [
                "Contact Employee immediately to arrange equipment return",
                "Recover company phone and verify it's company-issued",
                "Collect any tablets, mobile hotspots, or other devices",
                "Retrieve company credit cards (coordinate with OneCard Help Desk if needed)",
                "Check for accessories (chargers, cases, cables)",
                "Wipe all device data per security protocol",
                "Update asset management system with returned items",
                "Complete Day 0 task - mark complete once all equipment recovered"
              ],
            };
          } else if (dept === 'Inventory Control') {
            taskDef = {
              title: `Day 0: Remove from TPMS & Stop Orders - ${vehicleNumber || techName}`,
              description: `IMMEDIATE TASK: Remove terminated Employee's truck ${vehicleNumber || 'TBD'} from TPMS. Employee: ${techName} (${enterpriseId}). This is a Day 0 task.`,
              step: 'inventory_remove_tpms_day0',
              subtask: 'Inventory',
              workflowStep: 3,
              instructions: [
                "Access TPMS (Truck Parts Management System) immediately",
                "Locate vehicle assignment for terminated Employee",
                `Remove vehicle ${vehicleNumber || 'TBD'} from TPMS assignment`,
                "Update vehicle status to unassigned/pending-offboard",
                "Clear and cancel any pending parts orders for this vehicle/Employee",
                "Update inventory system to stop automatic replenishment",
                "Complete Day 0 task - detailed Inventory work will follow in Phase 2"
              ],
            };
          } else {
            taskDef = {
              title: `Day 0: Initial Vehicle Coordination - ${vehicleNumber || techName}`,
              description: `IMMEDIATE TASK: Begin initial coordination for vehicle ${vehicleNumber || 'TBD'}. Employee: ${techName} (${enterpriseId}). This is a Day 0 task.`,
              step: 'fleet_initial_coordination_day0',
              subtask: 'Fleet',
              workflowStep: 4,
              instructions: [
                "Contact Employee immediately to notify of offboarding process",
                "Arrange preliminary meeting/call to discuss vehicle handover",
                "Obtain current vehicle location and condition information",
                "Begin coordination with Employee for vehicle retrieval timing",
                "Assess any immediate vehicle security or safety concerns",
                "Document initial vehicle status and location",
                "Complete Day 0 task - detailed Fleet work will follow in Phase 2"
              ],
            };
          }

          const taskData = {
            ...baseData,
            step: taskDef.step,
            subtask: taskDef.subtask,
            workflowStep: taskDef.workflowStep,
            instructions: taskDef.instructions,
          };

          const queueItem: any = {
            workflowType: 'offboarding' as const,
            title: taskDef.title,
            description: taskDef.description,
            status: sourceItem.status || 'pending',
            priority: 'high' as const,
            requesterId: 'system',
            department: dept,
            workflowId,
            workflowStep: taskDef.workflowStep,
            data: JSON.stringify(taskData),
            metadata: JSON.stringify({
              createdVia: 'department_backfill',
              backfilledAt: new Date().toISOString(),
              sourceItemId: sourceItem.id,
            }),
          };

          if (dept === 'NTAO') {
            await storage.createNTAOQueueItem(queueItem);
          } else if (dept === 'Assets Management') {
            const byovStatus = getInitialToolsTaskStatus(vehicleNumber);
            queueItem.isByov = byovStatus.isByov;
            queueItem.blockedActions = byovStatus.blockedActions;
            queueItem.fleetRoutingDecision = byovStatus.routingPath;
            queueItem.routingReceivedAt = byovStatus.isByov ? new Date() : null;
            queueItem.assignedTo = TOOLS_OWNER.id;
            await storage.createAssetsQueueItem(queueItem);
          } else if (dept === 'Inventory Control') {
            await storage.createInventoryQueueItem(queueItem);
          } else {
            await storage.createFleetQueueItem(queueItem);
          }

          createdByDept[dept]++;
          totalCreated++;
        } catch (err) {
          console.error(`[Backfill] Error creating ${dept} item for workflow ${workflowId}:`, err);
        }
      }
    }

    if (totalCreated > 0) {
      console.log(`[Backfill] Created ${totalCreated} missing tasks: NTAO=${createdByDept.NTAO}, Assets=${createdByDept['Assets Management']}, Inventory=${createdByDept['Inventory Control']}, Fleet=${createdByDept.FLEET}`);
    } else {
      console.log('[Backfill] All workflows already have tasks in all 4 departments');
    }
  } catch (error) {
    console.error('[Backfill] Error during department backfill:', error);
  }
}

/**
 * Query the database for the most recent rental sync date (EST).
 * Returns a date string like "2026-03-27" or null if no sync has ever run.
 * Uses this as restart-safe memory so the in-memory lastSyncDate can be
 * seeded from the DB on every startup.
 */
async function getLastRentalSyncDateFromDb(): Promise<string | null> {
  try {
    // Watermark must read the table the auto-sync actually writes. The Rental
    // Ops → Fleet Scope reconciliation records to sync_logs (syncType
    // 'rental_ops_fleet_scope'), NOT fs_rental_imports — that table is the
    // separate MANUAL weekly-import path. Reading rental_imports here let a
    // manual import (or its absence) masquerade as the auto-sync watermark,
    // causing false "already ran today" skips / missed runs. Only a COMPLETED
    // run counts as "ran today".
    const [latest] = await db
      .select({ completedAt: syncLogs.completedAt })
      .from(syncLogs)
      .where(and(eq(syncLogs.syncType, 'rental_ops_fleet_scope'), eq(syncLogs.status, 'completed')))
      .orderBy(desc(syncLogs.completedAt))
      .limit(1);
    if (!latest?.completedAt) return null;
    // Convert the stored UTC timestamp to EST date string
    const estDate = new Date(latest.completedAt.getTime() - (5 * 60 * 60 * 1000));
    return getDateString(estDate);
  } catch (err: any) {
    console.error('[Scheduler] Could not read last rental sync date from DB:', err?.message);
    return null;
  }
}

/**
 * True if a rental reconcile is currently mid-flight (a 'running' sync_logs row
 * started within the last `thresholdMinutes`). Belt-and-suspenders on top of the
 * advisory lock: lets the startup catch-up yield to an in-progress Scheduled
 * Deployment run instead of opening a redundant attempt the lock would reject.
 * Bounded by a recent window so a crashed run's stale 'running' row can't block
 * catch-up forever. Fail-open (the advisory lock remains the real guard).
 */
async function hasRecentRunningRentalSync(thresholdMinutes = 20): Promise<boolean> {
  try {
    const cutoff = new Date(Date.now() - thresholdMinutes * 60 * 1000);
    const [row] = await db
      .select({ id: syncLogs.id })
      .from(syncLogs)
      .where(
        and(
          eq(syncLogs.syncType, 'rental_ops_fleet_scope'),
          eq(syncLogs.status, 'running'),
          gte(syncLogs.startedAt, cutoff),
        ),
      )
      .limit(1);
    return !!row;
  } catch (err: any) {
    console.error('[Scheduler] Could not check for running rental sync (non-fatal):', err?.message);
    return false;
  }
}

/**
 * Run a catch-up offboarding sync if one hasn't happened today (EST).
 * Mirrors the rental catch-up pattern: checks the DB sync log for
 * create_offboarding_tasks and skips if it already ran today.
 * Safe to call on every startup — multiple restarts in one day are safe.
 */
async function runCatchUpOffboardingSyncIfNeeded(): Promise<void> {
  if (!isSnowflakeConfigured()) return;
  try {
    const latestLog = await storage.getLatestSyncLog('create_offboarding_tasks');
    const todayStr = getDateString(getESTDate());
    if (latestLog?.completedAt) {
      const logDate = getDateString(new Date(latestLog.completedAt.getTime() - (5 * 60 * 60 * 1000)));
      if (logDate === todayStr) {
        console.log(`[Scheduler] Offboarding sync already ran today (${todayStr}), skipping startup catch-up`);
        return;
      }
    }
    console.log(`[Scheduler] Startup offboarding catch-up: last run was ${latestLog?.completedAt?.toISOString() ?? 'never'}, running now...`);
    const { getSnowflakeSyncService: getSvc } = await import('./snowflake-sync-service');
    await getSvc().syncTermedTechs('startup_catchup');
    const offboardingResult = await createOffboardingQueueTasks('startup_catchup');
    console.log(`[Scheduler] Startup offboarding catch-up complete — Techs processed: ${offboardingResult.techsProcessed}, Tasks created: ${offboardingResult.tasksCreated}, Skipped: ${offboardingResult.tasksSkipped}`);
  } catch (err: any) {
    console.error('[Scheduler] Startup catch-up offboarding sync failed (non-fatal):', err?.message);
  }
}

/**
 * Run a catch-up rental sync if one hasn't happened today (EST).
 * Safe to call on every startup — reads the DB so multiple restarts
 * in the same day will only trigger one sync.
 */
async function runCatchUpRentalSyncIfNeeded(): Promise<void> {
  if (!isSnowflakeConfigured()) return;
  try {
    const lastDbSyncDate = await getLastRentalSyncDateFromDb();
    const todayStr = getDateString(getESTDate());
    if (lastDbSyncDate === todayStr) {
      console.log(`[Scheduler] Rental sync already ran today (${todayStr}), skipping startup catch-up`);
      return;
    }
    // Yield to an in-progress reconcile (e.g. the Scheduled Deployment) so we
    // don't open a redundant attempt the advisory lock would only reject anyway.
    if (await hasRecentRunningRentalSync()) {
      console.log('[Scheduler] A rental reconcile is currently running — skipping startup catch-up');
      return;
    }
    console.log(`[Scheduler] Startup catch-up: last rental sync was ${lastDbSyncDate ?? 'never'}, running now...`);
    const { syncRentalOpsToFleetScope } = await import('./rental-ops-sync');
    const result = await syncRentalOpsToFleetScope('startup_catchup');
    if (result.added.length > 0 || result.removed.length > 0 || result.updated > 0) {
      try {
        const { invalidateTrucksCache } = await import('./fleet-scope-routes');
        invalidateTrucksCache();
      } catch (invErr: any) {
        console.warn('[Scheduler] invalidateTrucksCache (post-startup-catchup) failed (non-fatal):', invErr?.message);
      }
    }
    console.log(`[Scheduler] Startup catch-up complete — Added: ${result.added.length}, Removed: ${result.removed.length}, Date-filled: ${result.updated}, Unchanged: ${result.unchanged}`);
  } catch (err: any) {
    console.error('[Scheduler] Startup catch-up rental sync failed (non-fatal):', err?.message);
  }
}

export function startSyncScheduler(): void {
  if (schedulerRunning) {
    console.log('[Scheduler] Sync scheduler already running');
    return;
  }

  schedulerRunning = true;

  // Inventory is intentionally independent of the general Snowflake scheduler,
  // whose interval is disabled in production. This timer is best-effort on
  // autoscale: the first check catches up after a sleeping instance wakes, and
  // the durable sync_logs watermark plus advisory lock keep it once-per-ET-day.
  setTimeout(() => {
    checkAndRunTruckInventory('startup_catchup');
  }, 5000);
  truckInventoryIntervalId = setInterval(
    () => { checkAndRunTruckInventory('scheduler'); },
    TRUCK_INVENTORY_CHECK_INTERVAL_MS,
  );

  // Task #487: startup catch-up for the All Vehicles roster mirror (all envs).
  // Offset 45s — distinct from the rental (15s) / offboarding (25s) / cost-center
  // (35s) catch-ups and after the AMS/TPMS startup priming — so heavy Snowflake
  // reads don't overlap at boot. Conditional (skips if already refreshed today,
  // force-runs if empty) and advisory-lock guarded so only one instance rebuilds.
  setTimeout(() => {
    import('./fleet-scope-all-vehicles-mirror')
      .then(({ runMirrorRefreshIfNeeded }) => runMirrorRefreshIfNeeded('startup_catchup'))
      .catch(err =>
        console.error('[Scheduler] Startup All Vehicles mirror catch-up error:', err?.message),
      );
  }, 45000);

  if (isDevelopment) {
    console.log('[Scheduler] Starting Snowflake sync scheduler (development mode - uses setInterval)');
    
    intervalId = setInterval(checkAndRunSync, CHECK_INTERVAL_MS);
    
    backfillAllDepartments().catch(err => 
      console.error('[Backfill] Startup backfill failed:', err)
    );
    
    getLastRentalSyncDateFromDb().then(dbDate => {
      if (dbDate) {
        lastSyncDate = dbDate;
        console.log(`[Scheduler] Seeded lastSyncDate from DB: ${dbDate}`);
      }
    }).catch(() => {}).finally(() => {
      setTimeout(() => { checkAndRunSync(); }, 5000);
    });
  } else {
    console.log('[Scheduler] Production mode detected - daily sync setInterval disabled');
    setTimeout(() => {
      runCatchUpRentalSyncIfNeeded().catch(err =>
        console.error('[Scheduler] Production startup rental catch-up error:', err?.message)
      );
    }, 15000);
    setTimeout(() => {
      runCatchUpOffboardingSyncIfNeeded().catch(err =>
        console.error('[Scheduler] Production startup offboarding catch-up error:', err?.message)
      );
    }, 25000);

    if (DISTRICT_COST_CENTER_AUTO_SEED_ENABLED) {
      setTimeout(() => {
        checkAndRunDistrictCostCenterSeed().catch(err =>
          console.error('[Scheduler] Production startup district cost-center seed error:', err?.message)
        );
      }, 35000);
    }
  }

  // Separation poll and notification backfill run independently on every boot
  // (both dev and production), following the same pattern as VRM/UPS/etc.
  console.log('[Scheduler] Starting separation poll (every 30 min) and notification backfill (every 6 hr) — all environments');

  setTimeout(() => {
    checkAndRunSeparationPoll().catch(err =>
      console.error('[Scheduler] Startup separation poll error:', err)
    );
  }, 10000);

  separationPollIntervalId = setInterval(() => {
    checkAndRunSeparationPoll().catch(err =>
      console.error('[Scheduler] Separation poll error:', err)
    );
  }, SEPARATION_POLL_INTERVAL_MS);

  setTimeout(() => {
    checkAndRunNotificationBackfill().catch(err =>
      console.error('[Scheduler] Startup notification backfill error:', err)
    );
  }, 20000);

  notificationBackfillIntervalId = setInterval(() => {
    checkAndRunNotificationBackfill().catch(err =>
      console.error('[Scheduler] Notification backfill error:', err)
    );
  }, NOTIFICATION_BACKFILL_INTERVAL_MS);

  setTimeout(async () => {
    try {
      const { resolveStaleOperationEvents, autoResolveTerminalOpEvents } = await import("./fleet-operations-service");
      const stale = await resolveStaleOperationEvents();
      const terminal = await autoResolveTerminalOpEvents();
      if (stale.resolved > 0 || terminal.resolved > 0) {
        console.log(`[Scheduler] Startup op_events cleanup: ${stale.resolved} stale + ${terminal.resolved} terminal resolved`);
      }
    } catch (err: any) {
      console.error('[Scheduler] Startup op_events cleanup error:', err?.message);
    }
  }, 30000);
}

export function stopSyncScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  if (separationPollIntervalId) {
    clearInterval(separationPollIntervalId);
    separationPollIntervalId = null;
  }
  if (notificationBackfillIntervalId) {
    clearInterval(notificationBackfillIntervalId);
    notificationBackfillIntervalId = null;
  }
  schedulerRunning = false;
  console.log('[Scheduler] Sync scheduler stopped');
}

export function getSchedulerStatus(): { 
  running: boolean; 
  lastSyncDate: string | null; 
  nextSyncTime: string;
  lastSeparationPoll: string | null;
  separationPollIntervalMs: number;
  lastNotificationBackfill: string | null;
  notificationBackfillIntervalMs: number;
  lastOpEventsRetry: string | null;
  opEventsRetryIntervalMs: number;
  lastDistrictCostCenterSeed: string | null;
  districtCostCenterSeedIntervalMs: number;
  districtCostCenterAutoSeedEnabled: boolean;
} {
  const estNow = getESTDate();
  const nextSync = new Date(estNow);
  
  if (estNow.getHours() >= SYNC_HOUR_EST) {
    nextSync.setDate(nextSync.getDate() + 1);
  }
  nextSync.setHours(SYNC_HOUR_EST, 0, 0, 0);
  
  return {
    running: schedulerRunning,
    lastSyncDate,
    nextSyncTime: nextSync.toISOString(),
    lastSeparationPoll: lastSeparationPollTime ? new Date(lastSeparationPollTime).toISOString() : null,
    separationPollIntervalMs: SEPARATION_POLL_INTERVAL_MS,
    lastNotificationBackfill: lastNotificationBackfillTime ? new Date(lastNotificationBackfillTime).toISOString() : null,
    notificationBackfillIntervalMs: NOTIFICATION_BACKFILL_INTERVAL_MS,
    lastOpEventsRetry: lastOpEventsRetryTime ? new Date(lastOpEventsRetryTime).toISOString() : null,
    opEventsRetryIntervalMs: OP_EVENTS_RETRY_INTERVAL_MS,
    lastDistrictCostCenterSeed: lastDistrictCostCenterSeedTime ? new Date(lastDistrictCostCenterSeedTime).toISOString() : null,
    districtCostCenterSeedIntervalMs: DISTRICT_COST_CENTER_SEED_INTERVAL_MS,
    districtCostCenterAutoSeedEnabled: DISTRICT_COST_CENTER_AUTO_SEED_ENABLED,
  };
}

/**
 * Manual trigger for the district cost-center auto-seed. Calls the same
 * `runDistrictCostCenterSeed` helper the daily scheduler uses, but with
 * `force: true` so the 24h throttle is skipped. Updates the scheduler's
 * `lastDistrictCostCenterSeed*` timestamps so the next scheduled run honors
 * this run and the management UI reflects "just now" afterwards.
 */
export async function triggerDistrictCostCenterSeed(
  updatedBy: string,
): Promise<{ inserted: number; existing: number; insertedDistricts: string[] }> {
  const { inserted, existing, insertedDistricts } = await runDistrictCostCenterSeed(updatedBy, { force: true });
  return { inserted, existing, insertedDistricts };
}

// Sprint 0: Manual trigger for separation poll (for testing)
export async function triggerSeparationPoll(): Promise<{
  success: boolean;
  newRecordsFound: number;
  tasksCreated: number;
  tasksSkipped: number;
  errors: string[];
}> {
  if (!isSnowflakeConfigured()) {
    return { success: false, newRecordsFound: 0, tasksCreated: 0, tasksSkipped: 0, errors: ['Snowflake not configured'] };
  }
  
  console.log('[Scheduler] Manual separation poll triggered');
  const syncService = getSnowflakeSyncService();
  const result = await syncService.syncNewSeparations('manual');
  lastSeparationPollTime = Date.now();
  return result;
}
