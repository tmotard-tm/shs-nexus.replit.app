#!/usr/bin/env npx tsx
/**
 * One-time TPMS sync:
 *  Step 1 – Snowflake base sync  (TPMS_EXTRACT → tpms_cached_assignments)
 *  Step 2 – TPMS API delta       (techs updated after 2026-03-10T00:00:00Z → upsert)
 */

async function run(): Promise<void> {
  console.log('='.repeat(60));
  console.log(`[TPMS-Sync] Starting at ${new Date().toISOString()}`);
  console.log('='.repeat(60));

  // ── Bootstrap: initialize Snowflake (mirrors server/index.ts) ──
  console.log('\n[Boot] Initializing Snowflake service...');
  const { initializeSnowflakeService } = await import('./snowflake-service');

  const account = process.env.SNOWFLAKE_ACCOUNT;
  const username = process.env.SNOWFLAKE_USER;
  let privateKey = process.env.SNOWFLAKE_PRIVATE_KEY;

  // In dev, fall back to key file
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
    database: process.env.SNOWFLAKE_DATABASE,
    schema: process.env.SNOWFLAKE_SCHEMA,
    warehouse: process.env.SNOWFLAKE_WAREHOUSE,
    role: process.env.SNOWFLAKE_ROLE,
  });
  console.log('[Boot] Snowflake service initialized.');

  // ── Step 1: Snowflake base sync ──────────────────────────────
  console.log('\n[Step 1] Pulling full TPMS dataset from Snowflake...');
  const { getSnowflakeSyncService } = await import('./snowflake-sync-service');
  const sfResult = await getSnowflakeSyncService().syncTPMSFromSnowflake('manual');

  if (!sfResult.success) {
    console.error('[Step 1] FAILED:', sfResult.errors);
    process.exit(1);
  }
  console.log(`[Step 1] Done — processed: ${sfResult.recordsProcessed}, created: ${sfResult.recordsCreated}, updated: ${sfResult.recordsUpdated}, ${sfResult.duration}ms`);

  // ── Step 2: TPMS API delta ───────────────────────────────────
  const SINCE = '2026-03-10T00:00:00';
  console.log(`\n[Step 2] Fetching TPMS API delta (updated after ${SINCE})...`);

  let deltaRecords: any[] = [];
  try {
    const { getTPMSService } = await import('./tpms-service');
    const raw = await getTPMSService().getTechsUpdatedAfter(SINCE);

    if (Array.isArray(raw)) {
      deltaRecords = raw;
    } else if (raw && typeof raw === 'object') {
      const list = raw.techInfoList ?? raw.data ?? raw.techs ?? raw.results ?? null;
      if (Array.isArray(list)) {
        deltaRecords = list;
      } else {
        console.log('[Step 2] Unexpected response shape:', JSON.stringify(raw).slice(0, 500));
      }
    }
    console.log(`[Step 2] Received ${deltaRecords.length} delta record(s).`);
  } catch (err: any) {
    console.error('[Step 2] TPMS API delta failed:', err.message);
    console.log('[Step 2] Snowflake data is in place. Exiting.');
    process.exit(0);
  }

  if (deltaRecords.length === 0) {
    console.log('[Step 2] No delta records to apply.');
    console.log('\n[TPMS-Sync] Complete at', new Date().toISOString());
    process.exit(0);
  }

  // ── Step 3: Upsert delta records ─────────────────────────────
  console.log(`\n[Step 3] Upserting ${deltaRecords.length} delta records...`);
  const { storage } = await import('./storage');
  let upserted = 0, skipped = 0;

  for (const tech of deltaRecords) {
    const enterpriseId = (tech.ldapId ?? tech.enterpriseId ?? tech.enterprise_id ?? '').toString().trim().toUpperCase();
    if (!enterpriseId) { skipped++; continue; }

    const truckNo = (tech.truckNo ?? tech.truck_no ?? tech.truckNumber ?? null)?.toString().trim() || null;

    try {
      await storage.upsertTpmsCachedAssignment({
        lookupKey: enterpriseId,
        lookupType: 'enterprise_id',
        truckNo,
        enterpriseId,
        techId: tech.techId ?? tech.tech_id ?? null,
        firstName: tech.firstName ?? tech.first_name ?? null,
        lastName: tech.lastName ?? tech.last_name ?? null,
        districtNo: tech.districtNo ?? tech.district_no ?? tech.district ?? null,
        contactNo: tech.contactNo ?? tech.contact_no ?? tech.phone ?? null,
        email: tech.email ?? null,
        rawResponse: JSON.stringify({ ...tech, source: 'tpms_api_delta' }),
        status: 'live',
        lastSuccessAt: new Date(),
        lastAttemptAt: new Date(),
        failureCount: 0,
      });
      upserted++;
    } catch (err: any) {
      console.error(`  Failed to upsert ${enterpriseId}:`, err.message);
      skipped++;
    }
  }

  console.log(`[Step 3] Done — upserted: ${upserted}, skipped: ${skipped}`);
  console.log('\n[TPMS-Sync] All done at', new Date().toISOString());
  process.exit(0);
}

run().catch((err) => {
  console.error('[TPMS-Sync] Unhandled error:', err);
  process.exit(1);
});
