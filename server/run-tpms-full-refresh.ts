#!/usr/bin/env npx tsx
/**
 * TPMS Full Mismatch Refresh — 3-Step Sync
 *
 * Resolves assignment mismatches between Holman and TPMS in three prioritized steps:
 *   Step 1 — Snowflake base: pull full TPMS_EXTRACT table (no API, no rate limit)
 *   Step 2 — TPMS API delta: layer in assignments changed in the last 24 hours
 *   Step 3 — Per-truck API fallback: for trucks still mismatched after steps 1 & 2,
 *             call getTechInfo per enterprise ID (batches of 10, 5 concurrent, 200ms/2s delays)
 *
 * Resolved counts are derived from explicit mismatch-count snapshots taken before and after
 * each step, so the summary math is exact:
 *   snowflakeResolved = beforeStep1 − afterStep1
 *   deltaResolved     = afterStep1  − afterStep2
 *   apiResolved       = afterStep2  − afterStep3  (afterStep3 = stillMismatched)
 *
 * Usage: npx tsx server/run-tpms-full-refresh.ts
 */

export interface MismatchRefreshSummary {
  snowflakeResolved: number;
  deltaResolved: number;
  apiResolved: number;
  stillMismatched: number;
  errors: string[];
}

export async function runTpmsFullRefresh(): Promise<MismatchRefreshSummary> {
  const summary: MismatchRefreshSummary = {
    snowflakeResolved: 0,
    deltaResolved: 0,
    apiResolved: 0,
    stillMismatched: 0,
    errors: [],
  };

  const log = (msg: string) => console.log(msg);

  log('='.repeat(60));
  log(`[TPMS-FullRefresh] Starting at ${new Date().toISOString()}`);
  log('='.repeat(60));

  const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

  // ── Shared DB helpers ────────────────────────────────────────────────────
  const { db } = await import('./db');
  const { sql } = await import('drizzle-orm');
  const { storage } = await import('./storage');

  /**
   * Returns the current list of mismatched vehicles from the DB.
   * A mismatch is: Holman has a tech assigned, but TPMS cache is empty
   * OR TPMS cache has a different tech than Holman.
   */
  async function loadMismatches(): Promise<Array<{ truck: string; holmanId: string; tpmsId: string }>> {
    const raw = await db.execute(sql`
      WITH tpms_latest AS (
        SELECT DISTINCT ON (truck_no)
          LTRIM(truck_no, '0') AS canonical_truck,
          enterprise_id        AS tpms_id
        FROM tpms_cached_assignments
        WHERE truck_no IS NOT NULL AND truck_no != ''
        ORDER BY truck_no, last_success_at DESC
      )
      SELECT
        h.holman_vehicle_number             AS truck,
        COALESCE(h.holman_tech_assigned, '') AS holman_id,
        COALESCE(t.tpms_id, '')              AS tpms_id
      FROM holman_vehicles_cache h
      LEFT JOIN tpms_latest t ON t.canonical_truck = h.holman_vehicle_number
      WHERE h.is_active = true
        AND (h.status_code != 2 OR h.status_code IS NULL)
        AND h.out_of_service_date IS NULL
        AND h.holman_tech_assigned IS NOT NULL
        AND h.holman_tech_assigned != ''
        AND h.holman_tech_assigned != 'tbt'
        AND (
          (t.tpms_id IS NOT NULL AND t.tpms_id != '' AND LOWER(h.holman_tech_assigned) != LOWER(t.tpms_id))
          OR (t.tpms_id IS NULL OR t.tpms_id = '')
        )
      ORDER BY h.holman_vehicle_number
    `);
    const rows = (raw as any).rows ?? (raw as unknown as any[]);
    return rows.map((r: any) => ({
      truck:    String(r.truck     ?? ''),
      holmanId: String(r.holman_id ?? ''),
      tpmsId:   String(r.tpms_id   ?? ''),
    }));
  }

  // ── Baseline: count mismatches BEFORE any step ───────────────────────────
  const beforeStep1 = await loadMismatches();
  log(`\n[Baseline] Mismatches before sync: ${beforeStep1.length}`);

  // ── Step 1: Snowflake base sync ──────────────────────────────────────────
  log('\n[Step 1] Pulling full TPMS dataset from Snowflake...');
  const { getSnowflakeSyncService } = await import('./snowflake-sync-service');
  try {
    const sfResult = await getSnowflakeSyncService().syncTPMSFromSnowflake('manual');
    if (!sfResult.success) {
      const errMsg = `Snowflake sync failed: ${(sfResult.errors ?? []).join('; ')}`;
      log(`[Step 1] FAILED — ${errMsg}`);
      summary.errors.push(errMsg);
    } else {
      log(`[Step 1] Done — processed: ${sfResult.recordsProcessed}, created: ${sfResult.recordsCreated}, updated: ${sfResult.recordsUpdated}, ${sfResult.duration}ms`);
    }
  } catch (err: any) {
    const errMsg = `Snowflake sync threw: ${err.message}`;
    log(`[Step 1] ERROR — ${errMsg}`);
    summary.errors.push(errMsg);
  }

  // ── Snapshot after Step 1 ────────────────────────────────────────────────
  const afterStep1 = await loadMismatches();
  summary.snowflakeResolved = beforeStep1.length - afterStep1.length;
  log(`[Step 1 result] Mismatches remaining: ${afterStep1.length} (resolved by Snowflake: ${summary.snowflakeResolved})`);

  // ── Step 2: TPMS API delta (yesterday) ───────────────────────────────────
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const SINCE = yesterday.toISOString().replace(/\.\d+Z$/, '');
  log(`\n[Step 2] Fetching TPMS API delta (updated after ${SINCE})...`);

  const { getTPMSService } = await import('./tpms-service');
  const tpmsService = getTPMSService();

  let deltaRecords: any[] = [];
  try {
    if (!tpmsService.isConfigured()) {
      log('[Step 2] TPMS not configured — skipping delta.');
      summary.errors.push('TPMS not configured; delta step skipped');
    } else {
      const raw = await tpmsService.getTechsUpdatedAfter(SINCE);
      if (Array.isArray(raw)) {
        deltaRecords = raw;
      } else if (raw && typeof raw === 'object') {
        const list = raw.techInfoList ?? raw.data ?? raw.techs ?? raw.results ?? null;
        if (Array.isArray(list)) {
          deltaRecords = list;
        } else {
          log('[Step 2] Unexpected response shape; no delta records extracted.');
        }
      }
      log(`[Step 2] Received ${deltaRecords.length} delta record(s).`);
    }
  } catch (err: any) {
    const errMsg = `TPMS delta API failed: ${err.message}`;
    log(`[Step 2] ERROR — ${errMsg}`);
    summary.errors.push(errMsg);
  }

  if (deltaRecords.length > 0) {
    let upserted = 0, skipped = 0;
    for (const tech of deltaRecords) {
      const enterpriseId = (tech.ldapId ?? tech.enterpriseId ?? tech.enterprise_id ?? '').toString().trim().toUpperCase();
      if (!enterpriseId) { skipped++; continue; }
      const truckNo = (tech.truckNo ?? tech.truck_no ?? tech.truckNumber ?? null)?.toString().trim() || null;
      try {
        await storage.upsertTpmsCachedAssignment({
          lookupKey:   enterpriseId,
          lookupType:  'enterprise_id',
          truckNo,
          enterpriseId,
          techId:     tech.techId    ?? tech.tech_id    ?? null,
          firstName:  tech.firstName ?? tech.first_name ?? null,
          lastName:   tech.lastName  ?? tech.last_name  ?? null,
          districtNo: tech.districtNo ?? tech.district_no ?? tech.district ?? null,
          contactNo:  tech.contactNo  ?? tech.contact_no  ?? tech.phone    ?? null,
          email:      tech.email ?? null,
          rawResponse: JSON.stringify({ ...tech, source: 'tpms_api_delta' }),
          status:      'live',
          lastSuccessAt: new Date(),
          lastAttemptAt: new Date(),
          failureCount:  0,
        });
        upserted++;
      } catch (err: any) {
        log(`  [Step 2] Failed to upsert ${enterpriseId}: ${err.message}`);
        skipped++;
      }
    }
    log(`[Step 2] Upserted: ${upserted}, skipped: ${skipped}`);
  }

  // ── Snapshot after Step 2 ────────────────────────────────────────────────
  const afterStep2 = await loadMismatches();
  summary.deltaResolved = afterStep1.length - afterStep2.length;
  log(`[Step 2 result] Mismatches remaining: ${afterStep2.length} (resolved by delta: ${summary.deltaResolved})`);

  // ── Step 3: Per-truck API fallback for trucks where TPMS cache is still empty ─
  // Only trucks where Holman has a tech but TPMS cache has no record (tpmsId is empty).
  const needsApiLookup = afterStep2.filter(v => !v.tpmsId);
  log(`\n[Step 3] Per-enterprise-ID API fallback for ${needsApiLookup.length} trucks with empty TPMS cache...`);

  if (needsApiLookup.length === 0) {
    log('[Step 3] No trucks require per-ID API lookup.');
  } else if (!tpmsService.isConfigured()) {
    log('[Step 3] TPMS not configured — skipping per-ID lookup.');
    summary.errors.push('TPMS not configured; per-truck fallback skipped');
  } else {
    const BATCH_SIZE     = 10;
    const MAX_CONCURRENT = 5;
    const CHUNK_DELAY_MS = 200;
    const BATCH_DELAY_MS = 2000;

    for (let i = 0; i < needsApiLookup.length; i += BATCH_SIZE) {
      const batch = needsApiLookup.slice(i, i + BATCH_SIZE);
      const batchNum    = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(needsApiLookup.length / BATCH_SIZE);
      log(`[Step 3] Batch ${batchNum}/${totalBatches} (${batch.length} trucks)...`);

      for (let j = 0; j < batch.length; j += MAX_CONCURRENT) {
        const chunk = batch.slice(j, j + MAX_CONCURRENT);
        await Promise.all(chunk.map(async (v) => {
          const enterpriseId = v.holmanId.trim().toUpperCase();
          if (!enterpriseId) return;
          try {
            const techInfo = await tpmsService.getTechInfo(enterpriseId);
            await storage.upsertTpmsCachedAssignment({
              lookupKey:   enterpriseId,
              lookupType:  'enterprise_id',
              truckNo:     techInfo.truckNo?.trim() || null,
              enterpriseId,
              techId:      techInfo.techId    || null,
              firstName:   techInfo.firstName  || null,
              lastName:    techInfo.lastName   || null,
              districtNo:  techInfo.districtNo || null,
              contactNo:   techInfo.contactNo  || null,
              email:       techInfo.email      || null,
              rawResponse: JSON.stringify({ ...techInfo, source: 'tpms_api_fallback' }),
              status:      'live',
              lastSuccessAt: new Date(),
              lastAttemptAt: new Date(),
              failureCount:  0,
            });
          } catch (err: any) {
            const errMsg = `API fallback failed for ${enterpriseId} (truck ${v.truck}): ${err.message}`;
            log(`  [Step 3] ${errMsg}`);
            if (summary.errors.length < 200) summary.errors.push(errMsg);
          }
        }));
        if (j + MAX_CONCURRENT < batch.length) await delay(CHUNK_DELAY_MS);
      }

      if (i + BATCH_SIZE < needsApiLookup.length) await delay(BATCH_DELAY_MS);
    }
  }

  // ── Snapshot after Step 3 ────────────────────────────────────────────────
  const afterStep3 = await loadMismatches();
  summary.apiResolved    = afterStep2.length - afterStep3.length;
  summary.stillMismatched = afterStep3.length;

  log('\n' + '='.repeat(60));
  log('[TPMS-FullRefresh] SUMMARY');
  log('='.repeat(60));
  log(`  Baseline mismatches:  ${beforeStep1.length}`);
  log(`  Snowflake resolved:   ${summary.snowflakeResolved}`);
  log(`  Delta resolved:       ${summary.deltaResolved}`);
  log(`  API fallback resolved:${summary.apiResolved}`);
  log(`  Still mismatched:     ${summary.stillMismatched}`);
  log(`  (Check: ${summary.snowflakeResolved} + ${summary.deltaResolved} + ${summary.apiResolved} + ${summary.stillMismatched} = ${summary.snowflakeResolved + summary.deltaResolved + summary.apiResolved + summary.stillMismatched}, baseline = ${beforeStep1.length})`);
  if (summary.errors.length > 0) {
    log(`  Errors (${summary.errors.length}):`);
    summary.errors.slice(0, 20).forEach(e => log(`    - ${e}`));
  }
  log(`[TPMS-FullRefresh] Completed at ${new Date().toISOString()}`);

  return summary;
}

// ── Standalone entry point ───────────────────────────────────────────────────
async function main() {
  console.log('\n[Boot] Initializing Snowflake service...');
  const { initializeSnowflakeService } = await import('./snowflake-service');

  const account    = process.env.SNOWFLAKE_ACCOUNT;
  const username   = process.env.SNOWFLAKE_USER;
  let   privateKey = process.env.SNOWFLAKE_PRIVATE_KEY;

  if (!privateKey) {
    try {
      const { loadKeyFromFile } = await import('./snowflake-key-loader');
      privateKey = loadKeyFromFile() ?? undefined;
      if (privateKey) console.log('[Boot] Loaded private key from file.');
    } catch {}
  }

  if (!account || !username || !privateKey) {
    console.error('[Boot] Missing Snowflake credentials — set SNOWFLAKE_ACCOUNT, SNOWFLAKE_USER, SNOWFLAKE_PRIVATE_KEY.');
    process.exit(1);
  }

  initializeSnowflakeService({
    account,
    username,
    privateKey,
    database:  process.env.SNOWFLAKE_DATABASE,
    schema:    process.env.SNOWFLAKE_SCHEMA,
    warehouse: process.env.SNOWFLAKE_WAREHOUSE,
    role:      process.env.SNOWFLAKE_ROLE,
  });
  console.log('[Boot] Snowflake service initialized.');

  await runTpmsFullRefresh();
  process.exit(0);
}

const isMain = process.argv[1]?.endsWith('run-tpms-full-refresh.ts') ||
               process.argv[1]?.endsWith('run-tpms-full-refresh.js');
if (isMain) {
  main().catch(err => {
    console.error('[TPMS-FullRefresh] Unhandled error:', err);
    process.exit(1);
  });
}
