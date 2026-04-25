#!/usr/bin/env npx tsx
/**
 * 2B.1.c PAUSE — drift telemetry snapshot (Kirk D-γ).
 *
 * Read-only. Computes:
 *   - row-count delta (fs_trucks vs fs_truck_state)
 *   - 50-row random-sample checksum on the 88 canonical state columns
 *   - prints a markdown table row ready to paste into docs/end-to-end-review.md
 *     under "##### 2B.1 drift telemetry".
 *
 * Anomaly thresholds (Kirk):
 *   - row-count delta > 5%  → ANOMALY
 *   - any unexplained sample checksum mismatch  → ANOMALY
 *
 * Usage:  npx tsx scripts/2b1-drift-snapshot.ts [--label "T0+6h"]
 *
 * Notes:
 *   - "Unexplained" mismatches: this script flags ALL mismatches. Reconciling against
 *     fs_2b1_orphan_backfill_audit / fs_truck_status_events is the analyst's job
 *     before declaring an anomaly. Keep the audit logs handy.
 */

import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

const COMMON_COLS = [
  'status','main_status','sub_status','shs_owner','date_last_marked_as_owned',
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

const ANOMALY_PCT_THRESHOLD = 5.0;
const SAMPLE_SIZE = 50;

async function run() {
  const labelArgIdx = process.argv.indexOf('--label');
  const label = labelArgIdx >= 0 ? process.argv[labelArgIdx + 1] : 'snapshot';

  const nowIso = new Date().toISOString();

  console.log('='.repeat(70));
  console.log(`[2B.1 drift snapshot] label=${label} at=${nowIso}`);
  console.log('='.repeat(70));

  if (!process.env.DATABASE_URL) {
    console.error('[FATAL] DATABASE_URL not set');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  const client = await pool.connect();

  try {
    // 1. row counts
    const { rows: counts } = await client.query<{ trucks: number; state: number }>(
      `SELECT (SELECT COUNT(*) FROM fs_trucks)::int AS trucks,
              (SELECT COUNT(*) FROM fs_truck_state)::int AS state`
    );
    const { trucks, state } = counts[0];
    const delta = trucks - state;
    const pct = trucks > 0 ? Math.abs(delta) / trucks * 100 : 0;
    console.log(`\n[Counts] fs_trucks=${trucks}, fs_truck_state=${state}, Δ=${delta} (${pct.toFixed(2)}%)`);

    const countAnomaly = pct > ANOMALY_PCT_THRESHOLD;
    if (countAnomaly) {
      console.log(`  ⚠ ANOMALY — Δ exceeds ${ANOMALY_PCT_THRESHOLD}% threshold`);
    }

    // 2. 50-row random sample checksum on the 88 common cols
    const colList = COMMON_COLS.join(', ');
    const sampleSql = `
      WITH sample AS (
        SELECT id FROM fs_trucks
        WHERE id IN (SELECT id FROM fs_truck_state)
        ORDER BY random()
        LIMIT ${SAMPLE_SIZE}
      ),
      t AS (
        SELECT t.id, md5(ROW(${colList})::text) AS h
        FROM fs_trucks t JOIN sample s ON s.id = t.id
      ),
      ts AS (
        SELECT s.id, md5(ROW(${colList})::text) AS h
        FROM fs_truck_state s JOIN sample sa ON sa.id = s.id
      )
      SELECT
        (SELECT COUNT(*) FROM sample)::int AS sample_n,
        (SELECT COUNT(*) FROM t JOIN ts USING (id) WHERE t.h = ts.h)::int AS matches,
        (SELECT COUNT(*) FROM t JOIN ts USING (id) WHERE t.h <> ts.h)::int AS mismatches
    `;
    const { rows: ck } = await client.query<{ sample_n: number; matches: number; mismatches: number }>(sampleSql);
    const { sample_n, matches, mismatches } = ck[0];
    console.log(`\n[Checksum] sampled=${sample_n}, matches=${matches}, mismatches=${mismatches}`);

    if (mismatches > 0) {
      // List the mismatched IDs so analyst can reconcile against audit logs
      const { rows: misIds } = await client.query<{ id: string }>(`
        WITH sample AS (
          SELECT id FROM fs_trucks
          WHERE id IN (SELECT id FROM fs_truck_state)
          ORDER BY id
          LIMIT ${SAMPLE_SIZE}
        )
        SELECT t.id
        FROM fs_trucks t JOIN sample s ON s.id = t.id
        JOIN fs_truck_state st ON st.id = t.id
        WHERE md5(ROW(${colList.replace(/(\w+)/g, 't.$1')})::text)
           <> md5(ROW(${colList.replace(/(\w+)/g, 'st.$1')})::text)
        LIMIT 10
      `);
      console.log(`  First mismatched IDs (cross-check vs fs_2b1_orphan_backfill_audit + fs_truck_status_events):`);
      misIds.forEach(r => console.log(`    - ${r.id}`));
    }

    const verdict = (countAnomaly || mismatches > 0)
      ? '⚠ ANOMALY — investigate'
      : '✅ within tolerance';

    // Markdown row for paste-into-doc
    console.log('\n' + '='.repeat(70));
    console.log('[Markdown row to append to "##### 2B.1 drift telemetry" table:]');
    console.log('='.repeat(70));
    const row = `| ${label} (${nowIso}) | ${trucks} | ${state} | ${delta} (${pct.toFixed(2)}%) | ${mismatches} | ${verdict} |`;
    console.log(row);
    console.log('='.repeat(70));

    if (countAnomaly || mismatches > 0) {
      console.log('\nPER ANOMALY RULE: pause + post structured question before cutover.');
      process.exit(2);
    }
  } catch (err) {
    console.error('\n[ERROR]', err);
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
