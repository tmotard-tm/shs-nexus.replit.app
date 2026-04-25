#!/usr/bin/env npx tsx
/**
 * 3B.5-bootstrap (revised) + 2B.1.b — combined execution.
 *
 *  STEP A (3B.5-bootstrap):
 *    INSERT vehicles rows from holman_vehicles_cache for every fs_trucks
 *    truck_number that has a matching cache row. Provenance is recorded in
 *    fs_2b1_orphan_backfill_audit.
 *
 *  STEP B (2B.1.b):
 *    UPDATE fs_trucks.vehicle_id from the new vehicles rows by joining on
 *    LPAD(vehicle_number,6,'0') = LPAD(truck_number,6,'0').
 *
 *  STEP C (post-hydration verification — feeds the 2B.1.c gate):
 *    1. vehicles row count >= fs_trucks row count
 *    2. ZERO vehicles rows with NULL on any of vin/model_year/make_name/model_name
 *    3. EVERY fs_trucks row has non-null vehicle_id
 *    4. EVERY fs_trucks.vehicle_id resolves to an existing vehicles.id
 *
 * Wrapped in a transaction. Any verification failure → ROLLBACK.
 *
 * Usage:  npx tsx scripts/2b1-hydrate-and-link.ts
 */

import { Pool } from '@neondatabase/serverless';
import ws from 'ws';
import { neonConfig } from '@neondatabase/serverless';

neonConfig.webSocketConstructor = ws;

async function run() {
  console.log('='.repeat(70));
  console.log(`[2B.1 hydrate+link] ${new Date().toISOString()}`);
  console.log('='.repeat(70));

  if (!process.env.DATABASE_URL) {
    console.error('[FATAL] DATABASE_URL not set');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Pre-check: vehicles is empty (this script is the bootstrap, not idempotent re-run)
    const { rows: pre } = await client.query<{ vehicles_count: number; fs_count: number }>(
      `SELECT (SELECT COUNT(*) FROM vehicles)::int AS vehicles_count,
              (SELECT COUNT(*) FROM fs_trucks)::int AS fs_count`
    );
    console.log(`\n[Pre-check] vehicles=${pre[0].vehicles_count}, fs_trucks=${pre[0].fs_count}`);

    if (pre[0].vehicles_count > 0) {
      console.log('[Pre-check] vehicles already populated — checking already-linked count...');
      const { rows: linked } = await client.query<{ linked: number; unlinked: number }>(
        `SELECT
           COUNT(*) FILTER (WHERE vehicle_id IS NOT NULL)::int AS linked,
           COUNT(*) FILTER (WHERE vehicle_id IS NULL)::int AS unlinked
         FROM fs_trucks`
      );
      console.log(`  fs_trucks linked=${linked[0].linked}, unlinked=${linked[0].unlinked}`);
      if (linked[0].unlinked === 0) {
        console.log('[Pre-check] All fs_trucks already linked. Nothing to do.');
        await client.query('ROLLBACK');
        return;
      }
    }

    // ── STEP A: hydrate vehicles from holman_vehicles_cache ─────────────────
    console.log('\n[Step A] Hydrating vehicles from holman_vehicles_cache...');
    const { rows: insertedRows } = await client.query<{
      id: string; vehicle_number: string; vin: string; truck_number: string; fs_truck_id: string;
    }>(`
      WITH src AS (
        SELECT DISTINCT ON (LPAD(c.holman_vehicle_number, 6, '0'))
          LPAD(c.holman_vehicle_number, 6, '0') AS vehicle_number,
          c.vin,
          c.make_name,
          c.model_name,
          c.model_year,
          c.license_plate,
          c.license_state,
          c.color,
          c.region,
          c.district,
          c.branding,
          c.interior,
          c.tune_status,
          c.holman_vehicle_ref,
          t.id AS fs_truck_id,
          t.truck_number AS fs_truck_number
        FROM fs_trucks t
        JOIN holman_vehicles_cache c
          ON LPAD(c.holman_vehicle_number, 6, '0') = LPAD(t.truck_number, 6, '0')
        WHERE NOT EXISTS (
          SELECT 1 FROM vehicles v WHERE v.vin = c.vin
        )
        ORDER BY LPAD(c.holman_vehicle_number, 6, '0'), c.last_holman_sync_at DESC NULLS LAST
      ),
      ins AS (
        INSERT INTO vehicles (
          vehicle_number, vin, make_name, model_name, model_year,
          license_plate, license_state, color, region, district,
          branding, interior, tune_status, holman_vehicle_ref, status
        )
        SELECT
          src.vehicle_number, src.vin, src.make_name, src.model_name, src.model_year,
          src.license_plate, src.license_state, src.color, src.region, src.district,
          src.branding, src.interior, src.tune_status, src.holman_vehicle_ref, 'available'
        FROM src
        RETURNING id, vehicle_number, vin
      )
      SELECT i.id, i.vehicle_number, i.vin, src.fs_truck_number AS truck_number, src.fs_truck_id
      FROM ins i
      JOIN src ON src.vehicle_number = i.vehicle_number;
    `);
    console.log(`  Inserted ${insertedRows.length} vehicles rows.`);

    // Audit log every insert with provenance
    if (insertedRows.length > 0) {
      const values: any[] = [];
      const placeholders = insertedRows.map((r, i) => {
        const off = i * 5;
        values.push(r.fs_truck_id, r.truck_number, r.id, r.vin, '3B.5-bootstrap holman_vehicles_cache');
        return `($${off + 1}, $${off + 2}, $${off + 3}, $${off + 4}, $${off + 5})`;
      });
      await client.query(
        `INSERT INTO fs_2b1_orphan_backfill_audit
           (fs_truck_id, truck_number, created_vehicle_id, vin, provenance)
         VALUES ${placeholders.join(',')}`,
        values
      );
      console.log(`  Wrote ${insertedRows.length} audit entries.`);
    }

    // ── STEP B: link fs_trucks.vehicle_id ───────────────────────────────────
    console.log('\n[Step B] Linking fs_trucks.vehicle_id from vehicles...');
    const { rowCount: linkedCount } = await client.query(`
      UPDATE fs_trucks t
      SET vehicle_id = v.id
      FROM vehicles v
      WHERE LPAD(v.vehicle_number, 6, '0') = LPAD(t.truck_number, 6, '0')
        AND t.vehicle_id IS NULL
    `);
    console.log(`  Linked ${linkedCount} fs_trucks rows.`);

    // ── STEP C: verification ────────────────────────────────────────────────
    console.log('\n[Step C] Verifying invariants...');
    const { rows: vc } = await client.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM vehicles`);
    console.log(`  vehicles total: ${vc[0].count}`);

    const { rows: nullViolations } = await client.query<{ count: number }>(`
      SELECT COUNT(*)::int AS count FROM vehicles
      WHERE vin IS NULL OR model_year IS NULL OR make_name IS NULL OR model_name IS NULL
    `);
    console.log(`  vehicles with NOT-NULL violations: ${nullViolations[0].count}  (must be 0)`);

    const { rows: linkStatus } = await client.query<{ linked: number; unlinked: number }>(`
      SELECT
        COUNT(*) FILTER (WHERE vehicle_id IS NOT NULL)::int AS linked,
        COUNT(*) FILTER (WHERE vehicle_id IS NULL)::int AS unlinked
      FROM fs_trucks
    `);
    console.log(`  fs_trucks linked: ${linkStatus[0].linked}  unlinked: ${linkStatus[0].unlinked}  (unlinked must be 0)`);

    const { rows: brokenFk } = await client.query<{ count: number }>(`
      SELECT COUNT(*)::int AS count FROM fs_trucks t
      WHERE t.vehicle_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM vehicles v WHERE v.id = t.vehicle_id)
    `);
    console.log(`  broken vehicle_id refs: ${brokenFk[0].count}  (must be 0)`);

    if (nullViolations[0].count > 0 || linkStatus[0].unlinked > 0 || brokenFk[0].count > 0) {
      console.error('\n[FAIL] One or more invariants violated. ROLLBACK.');
      await client.query('ROLLBACK');
      process.exit(1);
    }

    await client.query('COMMIT');
    console.log('\n[COMMIT] All invariants satisfied. Hydration + linking complete.');
  } catch (err) {
    console.error('\n[ERROR]', err);
    await client.query('ROLLBACK').catch(() => {});
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }

  console.log(`\n[Done] ${new Date().toISOString()}`);
  process.exit(0);
}

run().catch(err => {
  console.error('\n[FATAL]', err);
  process.exit(1);
});
