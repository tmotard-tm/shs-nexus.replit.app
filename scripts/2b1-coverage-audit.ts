#!/usr/bin/env npx tsx
/**
 * 3B.4-bootstrap (resequenced before 2B.1.b per Kirk 2026-04-25 Option C):
 * Coverage audit. For each fs_trucks.truck_number, classify against the two
 * upstream identity sources:
 *   - AMS Snowflake (PARTS_SUPPLYCHAIN.FLEET.REPLIT_ALL_VEHICLES)
 *   - Holman Snowflake (PARTS_SUPPLYCHAIN.FLEET.HOLMAN_VEHICLES)
 * Writes results to fs_2b1_coverage_audit. Prints a summary that drives the
 * next decision (model_year hydration source, ghost triage list size).
 *
 * Usage:  npx tsx scripts/2b1-coverage-audit.ts
 */

import { Pool } from '@neondatabase/serverless';
import ws from 'ws';
import { neonConfig } from '@neondatabase/serverless';

neonConfig.webSocketConstructor = ws;

const AMS_TABLE = 'PARTS_SUPPLYCHAIN.FLEET.REPLIT_ALL_VEHICLES';
const HOLMAN_TABLE = 'PARTS_SUPPLYCHAIN.FLEET.HOLMAN_VEHICLES';

interface AmsRow {
  VEHICLE_NUMBER: string;
  VIN: string | null;
  MAKE_NAME: string | null;
  MODEL_NAME: string | null;
  LICENSE_PLATE?: string | null;
}

interface HolmanRow {
  HOLMAN_VEHICLE_NUMBER: string;
  VIN: string | null;
  LICENSE_PLATE: string | null;
}

interface ColInfo { COLUMN_NAME: string; DATA_TYPE: string; }

function pad6(n: string): string {
  return n.toString().padStart(6, '0');
}

async function bootstrapSnowflake() {
  console.log('[Boot] Initializing Snowflake service...');
  const { initializeSnowflakeService } = await import('../server/snowflake-service');

  const account = process.env.SNOWFLAKE_ACCOUNT;
  const username = process.env.SNOWFLAKE_USER;
  let privateKey = process.env.SNOWFLAKE_PRIVATE_KEY;

  if (!privateKey) {
    try {
      const { loadKeyFromFile } = await import('../server/snowflake-key-loader');
      privateKey = (loadKeyFromFile() ?? undefined) as string | undefined;
      if (privateKey) console.log('[Boot] Loaded private key from file.');
    } catch {}
  }

  if (!account || !username || !privateKey) {
    console.error('[Boot] Missing Snowflake credentials.');
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
}

async function run() {
  console.log('='.repeat(70));
  console.log(`[2B.1 coverage-audit] Starting at ${new Date().toISOString()}`);
  console.log('='.repeat(70));

  if (!process.env.DATABASE_URL) {
    console.error('[FATAL] DATABASE_URL not set');
    process.exit(1);
  }

  await bootstrapSnowflake();
  const { executeQuery } = await import('../server/fleet-scope-snowflake');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });

  // Step 1 — pull the 333 fs_trucks truck_numbers + ids
  const { rows: fsTrucks } = await pool.query<{ id: string; truck_number: string }>(
    `SELECT id, truck_number FROM fs_trucks ORDER BY truck_number`
  );
  console.log(`\n[Step 1] fs_trucks count: ${fsTrucks.length}`);
  const truckNumbers = fsTrucks.map(t => t.truck_number);
  const truckIdMap = new Map(fsTrucks.map(t => [t.truck_number, t.id]));

  // Step 2 — discover what columns REPLIT_ALL_VEHICLES actually has (look for ANY year col)
  console.log(`\n[Step 2] Inspecting ${AMS_TABLE} columns for any year-related field...`);
  const colInfo = await executeQuery<ColInfo>(`
    SELECT COLUMN_NAME, DATA_TYPE
    FROM PARTS_SUPPLYCHAIN.INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'REPLIT_ALL_VEHICLES' AND TABLE_SCHEMA = 'FLEET'
    ORDER BY ORDINAL_POSITION
  `);
  const allCols = colInfo.map(c => c.COLUMN_NAME);
  const yearCols = allCols.filter(c => /YEAR|YR/.test(c));
  const plateCols = allCols.filter(c => /PLATE|TAG/.test(c));
  console.log(`  Total columns: ${allCols.length}`);
  console.log(`  Year-related candidates: ${yearCols.length ? yearCols.join(', ') : '(NONE)'}`);
  console.log(`  Plate-related candidates: ${plateCols.length ? plateCols.join(', ') : '(NONE)'}`);

  // Step 3 — bulk pull AMS rows for our 333 truck_numbers
  // Build padded variants for matching
  const paddedSet = new Set(truckNumbers.map(pad6));
  const paddedList = Array.from(paddedSet).map(s => `'${s}'`).join(',');

  // Detect best year column (if any) and license plate column (if any)
  const yearCol = yearCols.find(c => /MODEL/.test(c)) || yearCols[0]; // prefer MODEL_YEAR
  const plateCol = plateCols.find(c => /LICENSE.*PLATE/.test(c)) || plateCols.find(c => c === 'LICENSE_PLATE');

  const amsCols = ['VEHICLE_NUMBER', 'VIN', 'MAKE_NAME', 'MODEL_NAME'];
  if (yearCol) amsCols.push(yearCol);
  if (plateCol) amsCols.push(plateCol);

  console.log(`\n[Step 3] Pulling AMS identity rows (cols: ${amsCols.join(', ')})...`);
  const amsRows = await executeQuery<AmsRow & Record<string, any>>(`
    SELECT ${amsCols.join(', ')}
    FROM ${AMS_TABLE}
    WHERE TRIM(VEHICLE_NUMBER) IN (${paddedList})
       OR LPAD(TRIM(VEHICLE_NUMBER), 6, '0') IN (${paddedList})
  `);
  console.log(`  AMS matched rows: ${amsRows.length} (of ${truckNumbers.length} requested)`);

  const amsByNum = new Map<string, AmsRow & Record<string, any>>();
  for (const r of amsRows) {
    const key = pad6(String(r.VEHICLE_NUMBER));
    if (!amsByNum.has(key)) amsByNum.set(key, r);
  }

  // Step 4 — bulk pull Holman rows for our 333 truck_numbers
  console.log(`\n[Step 4] Pulling Holman identity rows...`);
  const holmanRows = await executeQuery<HolmanRow>(`
    SELECT HOLMAN_VEHICLE_NUMBER, VIN, LICENSE_PLATE
    FROM ${HOLMAN_TABLE}
    WHERE TRIM(HOLMAN_VEHICLE_NUMBER) IN (${paddedList})
       OR LPAD(TRIM(HOLMAN_VEHICLE_NUMBER), 6, '0') IN (${paddedList})
  `);
  console.log(`  Holman matched rows: ${holmanRows.length} (of ${truckNumbers.length} requested)`);

  const holmanByNum = new Map<string, HolmanRow>();
  for (const r of holmanRows) {
    const key = pad6(String(r.HOLMAN_VEHICLE_NUMBER));
    if (!holmanByNum.has(key)) holmanByNum.set(key, r);
  }

  // Step 5 — classify each fs_trucks row and build INSERT batch
  console.log(`\n[Step 5] Classifying coverage and writing to fs_2b1_coverage_audit...`);
  const counts = { ams_only: 0, holman_only: 0, both: 0, ghost: 0 };
  const yearSourceCounts = { ams_snowflake: 0, ams_api: 0, holman: 0, none: 0 };
  const missingMakeModelYear = { make: 0, model: 0, year: 0 };

  await pool.query(`TRUNCATE TABLE fs_2b1_coverage_audit`);
  console.log('  (truncated existing audit table)');

  for (const t of fsTrucks) {
    const padded = pad6(t.truck_number);
    const ams = amsByNum.get(padded);
    const holman = holmanByNum.get(padded);

    let coverage: keyof typeof counts;
    if (ams && holman) coverage = 'both';
    else if (ams) coverage = 'ams_only';
    else if (holman) coverage = 'holman_only';
    else coverage = 'ghost';
    counts[coverage]++;

    const amsVin = ams?.VIN ? String(ams.VIN).trim() : null;
    const amsMake = ams?.MAKE_NAME ? String(ams.MAKE_NAME).trim() : null;
    const amsModel = ams?.MODEL_NAME ? String(ams.MODEL_NAME).trim() : null;
    const amsYearVal = yearCol && ams ? ams[yearCol] : null;
    const amsYear = amsYearVal != null && String(amsYearVal).trim() !== '' ? String(amsYearVal).trim() : null;
    const amsPlateVal = plateCol && ams ? ams[plateCol] : null;
    const amsPlate = amsPlateVal != null && String(amsPlateVal).trim() !== '' ? String(amsPlateVal).trim() : null;
    const holmanVin = holman?.VIN ? String(holman.VIN).trim() : null;
    const holmanPlate = holman?.LICENSE_PLATE ? String(holman.LICENSE_PLATE).trim() : null;

    let yearSource: keyof typeof yearSourceCounts;
    if (amsYear) yearSource = 'ams_snowflake';
    else yearSource = 'none'; // AMS API path NOT taken in this audit pass; future enhancement
    yearSourceCounts[yearSource]++;

    const missing: string[] = [];
    if (!amsMake) missing.push('make_name');
    if (!amsModel) missing.push('model_name');
    if (!amsYear) missing.push('model_year');
    if (!amsVin && !holmanVin) missing.push('vin');
    if (missing.includes('make_name')) missingMakeModelYear.make++;
    if (missing.includes('model_name')) missingMakeModelYear.model++;
    if (missing.includes('model_year')) missingMakeModelYear.year++;

    await pool.query(
      `INSERT INTO fs_2b1_coverage_audit
        (truck_number, fs_truck_id, coverage, ams_vin, ams_make_name, ams_model_name,
         ams_model_year, ams_license_plate, holman_vin, holman_license_plate,
         holman_vehicle_number, model_year_source, missing_required_fields)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        t.truck_number, t.id, coverage,
        amsVin, amsMake, amsModel, amsYear, amsPlate,
        holmanVin, holmanPlate,
        holman?.HOLMAN_VEHICLE_NUMBER ? String(holman.HOLMAN_VEHICLE_NUMBER).trim() : null,
        yearSource,
        missing.length ? missing.join(',') : null,
      ]
    );
  }

  // Step 6 — summary
  console.log('\n' + '='.repeat(70));
  console.log('[Summary]');
  console.log('='.repeat(70));
  console.log(`  Total fs_trucks audited: ${fsTrucks.length}`);
  console.log(`  Coverage:`);
  console.log(`    both (AMS+Holman): ${counts.both}`);
  console.log(`    ams_only:          ${counts.ams_only}`);
  console.log(`    holman_only:       ${counts.holman_only}`);
  console.log(`    ghost (NEITHER):   ${counts.ghost}   ← go into fs_2b1_ghost_triage`);
  console.log(`  model_year availability:`);
  console.log(`    from AMS Snowflake: ${yearSourceCounts.ams_snowflake}`);
  console.log(`    from AMS API:       ${yearSourceCounts.ams_api}  (not attempted in this pass)`);
  console.log(`    NONE (need fallback strategy): ${yearSourceCounts.none}`);
  console.log(`  Missing-field counts (across all fs_trucks):`);
  console.log(`    make_name:  ${missingMakeModelYear.make}`);
  console.log(`    model_name: ${missingMakeModelYear.model}`);
  console.log(`    model_year: ${missingMakeModelYear.year}`);

  const eligibleNonGhost = counts.both + counts.ams_only + counts.holman_only;
  const fullyCovered = fsTrucks.length - counts.ghost - missingMakeModelYear.year;
  console.log(`\n  → 2B.1.b backfill eligible (non-ghost):     ${eligibleNonGhost}`);
  console.log(`  → 2B.1.b backfill ready (all NOT NULLs OK):  ${fullyCovered}`);
  console.log(`  → ghosts requiring triage:                   ${counts.ghost}`);
  console.log(`  → covered but missing model_year:            ${missingMakeModelYear.year - counts.ghost}`);

  await pool.end();
  console.log(`\n[Done] ${new Date().toISOString()}`);
  process.exit(0);
}

run().catch(err => {
  console.error('\n[FATAL]', err);
  process.exit(1);
});
