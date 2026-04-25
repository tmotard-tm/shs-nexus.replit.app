#!/usr/bin/env npx tsx
/**
 * 2B.1.c — Copy fs_trucks → fs_truck_state (mirror, id preserved) +
 *          run all 5 verification gate checks.
 *
 * After this script succeeds and Kirk approves the gate report,
 * proceed to 2B.1.d (writer migration) → 2B.1.e (drop identity cols)
 * → 2B.1.f (drop fs_trucks table, create VIEW) → 2B.1.g (review + smoke).
 *
 * Wrapped in a transaction. COMMIT only if every gate check passes.
 *
 * Usage:  npx tsx scripts/2b1c-copy-and-gate.ts
 */

import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

// 88 columns common to both tables. id and vehicle_id INCLUDED.
const COMMON_COLS = [
  'id','status','main_status','sub_status','shs_owner','date_last_marked_as_owned',
  'registration_sticker_valid','registration_expiry_date','registration_last_update',
  'registration_in_progress','holman_reg_expiry','repair_or_sale_decision','van_inventoried',
  'sale_price','date_put_for_sale','date_sold','date_put_in_repair','bill_paid_date',
  'repair_completed','in_ams','repair_address','repair_phone','contact_name',
  'confirmed_set_of_expired_tags','confirmed_declined_repair','tags_in_office',
  'tags_sent_to_tech','renewal_process_started','awaiting_tech_documents',
  'documents_sent_to_holman','holman_processing_complete','inspection_location',
  'van_brought_for_inspection','inspection_complete','snowflake_assigned','tech_name',
  'tech_phone','tech_lead_name','tech_lead_phone','tech_state','tech_state_source',
  'pick_up_slot_booked','time_blocked_to_pick_up_van','reg_test_slot_booked',
  'reg_test_slot_details','rental_returned','van_picked_up','comments','notes',
  'virtual_comments','gave_holman','gave_holman_updated_at','last_date_called',
  'call_status','eta','rental_start_date','expected_return_date','rental_status',
  'rental_reason','associated_vehicle_id','rental_notes','process_owner',
  'current_renewal_step','repair_priority','expected_completion','estimated_cost',
  'actual_cost','ready_for_pickup','date_returned_to_service','new_truck_assigned',
  'registration_renewal_in_process','spare_van_assignment_in_process',
  'spare_van_in_process_to_ship','last_call_date','last_call_summary','last_call_status',
  'last_call_conversation_id','last_tech_call_date','last_tech_call_summary',
  'last_tech_call_status','last_tech_call_conversation_id','enterprise_id',
  'last_updated_at','last_updated_by','created_at','offboarding_flagged',
  'main_status_changed_at','vehicle_id'
];

interface GateResult { name: string; passed: boolean; detail: string; }

async function run() {
  console.log('='.repeat(70));
  console.log(`[2B.1.c copy + gate] ${new Date().toISOString()}`);
  console.log('='.repeat(70));

  if (!process.env.DATABASE_URL) {
    console.error('[FATAL] DATABASE_URL not set');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  const client = await pool.connect();
  const results: GateResult[] = [];

  try {
    await client.query('BEGIN');

    // Pre-checks
    const { rows: pre } = await client.query<{ trucks: number; state: number }>(
      `SELECT (SELECT COUNT(*) FROM fs_trucks)::int AS trucks,
              (SELECT COUNT(*) FROM fs_truck_state)::int AS state`
    );
    console.log(`\n[Pre-check] fs_trucks=${pre[0].trucks}, fs_truck_state=${pre[0].state}`);

    // ── COPY ───────────────────────────────────────────────────────────────
    if (pre[0].state === 0) {
      console.log('\n[Copy] fs_trucks → fs_truck_state (88 columns, id preserved)...');
      const cols = COMMON_COLS.join(', ');
      const insertSql = `
        INSERT INTO fs_truck_state (${cols})
        SELECT ${cols} FROM fs_trucks
      `;
      const { rowCount } = await client.query(insertSql);
      console.log(`  Copied ${rowCount} rows.`);
    } else {
      console.log('\n[Copy] fs_truck_state already populated — skipping copy.');
    }

    // ── GATE CHECK 1: Row-count parity ─────────────────────────────────────
    console.log('\n[Gate 1] Row-count parity: COUNT(fs_trucks) == COUNT(fs_truck_state JOIN vehicles)...');
    const { rows: g1 } = await client.query<{ trucks: number; joined: number }>(`
      SELECT
        (SELECT COUNT(*) FROM fs_trucks)::int AS trucks,
        (SELECT COUNT(*) FROM fs_truck_state s JOIN vehicles v ON v.id = s.vehicle_id)::int AS joined
    `);
    const g1Pass = g1[0].trucks === g1[0].joined;
    results.push({
      name: '1. Row-count parity',
      passed: g1Pass,
      detail: `fs_trucks=${g1[0].trucks}, fs_truck_state⨯vehicles=${g1[0].joined}`,
    });
    console.log(`  ${g1Pass ? 'PASS' : 'FAIL'} — fs_trucks=${g1[0].trucks}, joined=${g1[0].joined}`);

    // ── GATE CHECK 2: FK integrity (FS child tables → fs_truck_state.id) ───
    console.log('\n[Gate 2] FK integrity: every fs_actions/fs_tracking_records/fs_truck_status_events.truck_id resolves to fs_truck_state.id...');
    const childTables = ['fs_actions', 'fs_tracking_records', 'fs_truck_status_events'];
    let g2Pass = true;
    const g2Detail: string[] = [];
    for (const tbl of childTables) {
      // Verify the table exists
      const { rows: ex } = await client.query<{ exists: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name=$1) AS exists`,
        [tbl]
      );
      if (!ex[0].exists) {
        g2Detail.push(`${tbl}=N/A (table not present)`);
        continue;
      }
      const { rows: r } = await client.query<{ total: number; orphans: number }>(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (
            WHERE truck_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM fs_truck_state s WHERE s.id = ${tbl}.truck_id)
          )::int AS orphans
        FROM ${tbl}
      `);
      const ok = r[0].orphans === 0;
      g2Pass = g2Pass && ok;
      g2Detail.push(`${tbl}: ${r[0].total} rows, ${r[0].orphans} orphans`);
      console.log(`  ${ok ? 'PASS' : 'FAIL'} ${tbl}: ${r[0].total} rows, ${r[0].orphans} orphans`);
    }
    results.push({ name: '2. FK integrity (FS child tables)', passed: g2Pass, detail: g2Detail.join('; ') });

    // ── GATE CHECK 3: Status projection sample diff (50 rows) ──────────────
    console.log('\n[Gate 3] Status projection sample diff (50 rows): fs_trucks.status vs fs_truck_state.status...');
    const { rows: g3 } = await client.query<{ id: string; ts: string | null; ss: string | null }>(`
      SELECT t.id, t.status AS ts, s.status AS ss
      FROM fs_trucks t
      JOIN fs_truck_state s ON s.id = t.id
      ORDER BY t.id
      LIMIT 50
    `);
    const mismatches = g3.filter(r => r.ts !== r.ss);
    const g3Pass = mismatches.length === 0 && g3.length >= Math.min(50, pre[0].trucks);
    results.push({
      name: '3. Status projection sample diff',
      passed: g3Pass,
      detail: `${g3.length} rows sampled, ${mismatches.length} mismatches`,
    });
    console.log(`  ${g3Pass ? 'PASS' : 'FAIL'} — ${g3.length} sampled, ${mismatches.length} mismatches`);
    if (mismatches.length > 0) console.log('  First mismatches:', mismatches.slice(0, 5));

    // ── GATE CHECK 4: Smoke (simulated VIEW shape) ─────────────────────────
    console.log('\n[Gate 4] Smoke test: simulated VIEW shape via fs_truck_state JOIN vehicles...');
    // The future VIEW will look like: SELECT s.*, v.vehicle_number AS truck_number,
    //   v.vin, v.license_plate, v.holman_vehicle_ref FROM fs_truck_state s JOIN vehicles v ON v.id = s.vehicle_id.
    // Verify the projection produces the same column SET as today's SELECT * FROM fs_trucks.
    const { rows: viewSample } = await client.query<any>(`
      SELECT
        s.*,
        v.vehicle_number AS truck_number,
        v.vin,
        v.license_plate,
        v.holman_vehicle_ref
      FROM fs_truck_state s
      JOIN vehicles v ON v.id = s.vehicle_id
      LIMIT 3
    `);
    const { rows: trucksSample } = await client.query<any>(`SELECT * FROM fs_trucks ORDER BY id LIMIT 3`);
    const viewKeys = new Set(viewSample.length ? Object.keys(viewSample[0]) : []);
    const trucksKeys = new Set(trucksSample.length ? Object.keys(trucksSample[0]) : []);
    const missingInView = [...trucksKeys].filter(k => !viewKeys.has(k));
    const extraInView = [...viewKeys].filter(k => !trucksKeys.has(k));
    const g4Pass = missingInView.length === 0;
    results.push({
      name: '4. Smoke (simulated VIEW shape)',
      passed: g4Pass,
      detail: `view_cols=${viewKeys.size}, trucks_cols=${trucksKeys.size}, missing_in_view=[${missingInView.join(',')}], extra_in_view=[${extraInView.join(',')}]`,
    });
    console.log(`  ${g4Pass ? 'PASS' : 'FAIL'} — view cols=${viewKeys.size}, trucks cols=${trucksKeys.size}`);
    if (missingInView.length) console.log('    Missing in view:', missingInView);
    if (extraInView.length) console.log('    Extra in view (informational):', extraInView);

    // ── GATE CHECK 5: vehicles NOT-NULL invariants ─────────────────────────
    console.log('\n[Gate 5] vehicles NOT-NULL invariants...');
    const { rows: g5 } = await client.query<{ violations: number }>(`
      SELECT COUNT(*)::int AS violations FROM vehicles
      WHERE vin IS NULL OR model_year IS NULL OR make_name IS NULL OR model_name IS NULL
    `);
    const g5Pass = g5[0].violations === 0;
    results.push({
      name: '5. vehicles NOT-NULL invariants',
      passed: g5Pass,
      detail: `violations=${g5[0].violations} (must be 0)`,
    });
    console.log(`  ${g5Pass ? 'PASS' : 'FAIL'} — violations=${g5[0].violations}`);

    // ── REPORT ─────────────────────────────────────────────────────────────
    console.log('\n' + '='.repeat(70));
    console.log('[2B.1.c GATE REPORT]');
    console.log('='.repeat(70));
    for (const r of results) {
      console.log(`  ${r.passed ? '✅ PASS' : '❌ FAIL'}  ${r.name}`);
      console.log(`           ${r.detail}`);
    }
    const allPassed = results.every(r => r.passed);
    console.log('='.repeat(70));
    console.log(`  OVERALL: ${allPassed ? '✅ ALL GATES PASS — ready for Kirk review' : '❌ ONE OR MORE GATES FAILED — ROLLBACK'}`);
    console.log('='.repeat(70));

    if (!allPassed) {
      console.error('\n[ROLLBACK] Gate failure — fs_truck_state copy reverted.');
      await client.query('ROLLBACK');
      process.exit(1);
    }

    await client.query('COMMIT');
    console.log('\n[COMMIT] fs_truck_state copy persisted. PAUSE here for Kirk go-ahead before 2B.1.d.');
  } catch (err) {
    console.error('\n[ERROR]', err);
    await client.query('ROLLBACK').catch(() => {});
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }

  process.exit(0);
}

run().catch(err => {
  console.error('\n[FATAL]', err);
  process.exit(1);
});
