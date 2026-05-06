import { db } from '../db/index.js';
import { sql } from 'drizzle-orm';

async function main() {
  const rows = await db.execute(sql`
    SELECT truck_number, full_name, enterprise_id, status, created_at
    FROM byov_enrollments
    WHERE truck_number LIKE '088%' OR truck_number LIKE '88%'
    ORDER BY truck_number
    LIMIT 30
  `);
  console.log('byov_enrollments (088xxx):', JSON.stringify(rows.rows, null, 2));
  
  const total = await db.execute(sql`SELECT COUNT(*) as c FROM byov_enrollments`);
  console.log('Total byov_enrollments:', total.rows[0]);

  const driftRows = await db.execute(sql`
    SELECT run_at, total_checked, holman_fail_count, wms_fail_count
    FROM byov_drift_checks
    ORDER BY run_at DESC
    LIMIT 3
  `).catch(() => ({ rows: [] as any[] }));
  console.log('Recent drift check runs:', JSON.stringify((driftRows as any).rows, null, 2));
}
main().catch(e => console.error('DB ERROR:', e.message));
