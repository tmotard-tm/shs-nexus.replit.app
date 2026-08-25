import { pool } from "./db";

const CURRENT_EMPLOYEE_DISTRICT_TARGETS = [
  ["all_techs", "district_no"],
  ["tech_vehicle_assignments", "district_no"],
  ["tpms_cached_assignments", "district_no"],
  ["tpms_last_known_truck_tech", "district_no"],
  ["tpms_tech_profiles", "district_no"],
] as const;

export interface EmployeeDistrictRepairResult {
  updatedByTable: Record<string, number>;
  removedInvalidMappings: number;
  totalUpdated: number;
}

/**
 * Idempotently repairs current-state employee mirrors that predate the corrected
 * DRIVELINE_ALL_TECHS district data. Audit/history tables are intentionally not
 * rewritten.
 */
export async function repairCurrentEmployeeDistricts(): Promise<EmployeeDistrictRepairResult> {
  const client = await pool.connect();
  const updatedByTable: Record<string, number> = {};

  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("SET LOCAL statement_timeout = '15s'");

    let totalUpdated = 0;
    for (const [table, column] of CURRENT_EMPLOYEE_DISTRICT_TARGETS) {
      const result = await client.query(`
        UPDATE ${table}
        SET ${column} = CASE
          WHEN regexp_replace(trim(${column}), '^0+', '') = '3132'
            THEN CASE
              WHEN length(trim(${column})) > 4
                THEN lpad('7084', length(trim(${column})), '0')
              ELSE '7084'
            END
          WHEN regexp_replace(trim(${column}), '^0+', '') = '3580'
            THEN CASE
              WHEN length(trim(${column})) > 4
                THEN lpad('7323', length(trim(${column})), '0')
              ELSE '7323'
            END
          ELSE ${column}
        END
        WHERE regexp_replace(trim(COALESCE(${column}, '')), '^0+', '')
              IN ('3132', '3580')
      `);
      const count = result.rowCount ?? 0;
      updatedByTable[table] = count;
      totalUpdated += count;
    }

    const mappingDelete = await client.query(`
      DELETE FROM district_cost_centers
      WHERE regexp_replace(trim(COALESCE(district, '')), '^0+', '')
            IN ('3132', '3580')
    `);
    const removedInvalidMappings = mappingDelete.rowCount ?? 0;

    await client.query("COMMIT");
    return { updatedByTable, removedInvalidMappings, totalUpdated };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}