import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

interface TableConfig {
  srcName: string;
  dstName: string;
  primaryKey: string;
}

// Migration order: Core → Tracking → PMF → POs & Cost → Spares & Decommissioning → Metrics → GPS → AI
// srcName: unprefixed table name in the original Fleet-Scope database
// dstName: fs_-prefixed table name in Nexus's database
// Sequence resets are auto-detected via pg_get_serial_sequence() — no manual flag needed.
const TABLES_IN_ORDER: TableConfig[] = [
  // Core
  { srcName: "trucks",               dstName: "fs_trucks",               primaryKey: "id" },
  { srcName: "actions",              dstName: "fs_actions",              primaryKey: "id" },
  { srcName: "archived_trucks",      dstName: "fs_archived_trucks",      primaryKey: "id" },
  { srcName: "truck_consolidations", dstName: "fs_truck_consolidations", primaryKey: "id" },

  // Tracking
  { srcName: "tracking_records",      dstName: "fs_tracking_records",      primaryKey: "id" },
  { srcName: "registration_tracking", dstName: "fs_registration_tracking", primaryKey: "truck_number" },
  { srcName: "reg_messages",          dstName: "fs_reg_messages",          primaryKey: "id" },
  { srcName: "reg_scheduled_messages",dstName: "fs_reg_scheduled_messages",primaryKey: "id" },

  // PMF
  { srcName: "pmf_imports",            dstName: "fs_pmf_imports",            primaryKey: "id" },
  { srcName: "pmf_rows",               dstName: "fs_pmf_rows",               primaryKey: "id" },
  { srcName: "pmf_status_events",      dstName: "fs_pmf_status_events",      primaryKey: "id" },
  { srcName: "pmf_activity_logs",      dstName: "fs_pmf_activity_logs",      primaryKey: "id" },
  { srcName: "pmf_activity_sync_meta", dstName: "fs_pmf_activity_sync_meta", primaryKey: "id" },

  // POs & Cost
  { srcName: "purchase_orders",          dstName: "fs_purchase_orders",          primaryKey: "id" },
  { srcName: "po_import_meta",           dstName: "fs_po_import_meta",           primaryKey: "id" },
  { srcName: "fleet_cost_records",       dstName: "fs_fleet_cost_records",       primaryKey: "id" },
  { srcName: "fleet_cost_import_meta",   dstName: "fs_fleet_cost_import_meta",   primaryKey: "id" },
  { srcName: "approved_cost_records",    dstName: "fs_approved_cost_records",    primaryKey: "id" },
  { srcName: "approved_cost_import_meta",dstName: "fs_approved_cost_import_meta",primaryKey: "id" },
  { srcName: "vehicle_maintenance_costs",dstName: "fs_vehicle_maintenance_costs",primaryKey: "vehicle_number" },

  // Spares & Decommissioning
  { srcName: "spare_vehicle_details",   dstName: "fs_spare_vehicle_details",   primaryKey: "id" },
  { srcName: "decommissioning_vehicles",dstName: "fs_decommissioning_vehicles",primaryKey: "id" },

  // Metrics
  { srcName: "metrics_snapshots",          dstName: "fs_metrics_snapshots",          primaryKey: "id" },
  { srcName: "byov_weekly_snapshots",      dstName: "fs_byov_weekly_snapshots",      primaryKey: "id" },
  { srcName: "pickup_weekly_snapshots",    dstName: "fs_pickup_weekly_snapshots",    primaryKey: "id" },
  { srcName: "fleet_weekly_snapshots",     dstName: "fs_fleet_weekly_snapshots",     primaryKey: "id" },
  { srcName: "pmf_status_weekly_snapshots",dstName: "fs_pmf_status_weekly_snapshots",primaryKey: "id" },
  { srcName: "repair_weekly_snapshots",    dstName: "fs_repair_weekly_snapshots",    primaryKey: "id" },
  { srcName: "rental_weekly_manual",       dstName: "fs_rental_weekly_manual",       primaryKey: "id" },

  // GPS
  { srcName: "samsara_locations", dstName: "fs_samsara_locations", primaryKey: "vehicle_number" },

  // AI
  { srcName: "call_logs",      dstName: "fs_call_logs",      primaryKey: "id" },
  { srcName: "rental_imports", dstName: "fs_rental_imports", primaryKey: "id" },
];

function buildFsConnectionString(): string | null {
  if (process.env.FS_DATABASE_URL) return process.env.FS_DATABASE_URL;
  const host = process.env.FS_PGHOST;
  const user = process.env.FS_PGUSER;
  const password = process.env.FS_PGPASSWORD;
  const database = process.env.FS_PGDATABASE;
  const port = process.env.FS_PGPORT || "5432";
  if (host && user && password && database) {
    return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(database)}?sslmode=require`;
  }
  return null;
}

async function getTableColumns(pool: Pool, tableName: string): Promise<string[]> {
  const res = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public' ORDER BY ordinal_position`,
    [tableName]
  );
  return res.rows.map((r: Record<string, unknown>) => r.column_name as string);
}

async function tableExists(pool: Pool, tableName: string): Promise<boolean> {
  const res = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1 AND table_schema = 'public')`,
    [tableName]
  );
  return (res.rows[0] as Record<string, unknown>).exists === true;
}

async function getCreateTableDDL(srcPool: Pool, srcTableName: string, dstTableName: string): Promise<string | null> {
  const colRes = await srcPool.query(
    `SELECT column_name, data_type, udt_name, character_maximum_length,
            is_nullable, column_default
     FROM information_schema.columns
     WHERE table_name = $1 AND table_schema = 'public'
     ORDER BY ordinal_position`,
    [srcTableName]
  );
  if (colRes.rows.length === 0) return null;

  const colDefs: string[] = [];
  for (const row of colRes.rows as Record<string, unknown>[]) {
    const colName = row.column_name as string;
    let dataType = (row.data_type as string).toUpperCase();
    const udtName = row.udt_name as string;
    const maxLen = row.character_maximum_length as number | null;
    const colDefault = row.column_default as string | null;

    const isSerial = colDefault && /^nextval\(/.test(colDefault) && dataType === "INTEGER";

    if (isSerial) {
      dataType = "SERIAL";
    } else if (dataType === "ARRAY") {
      const baseType = udtName.replace(/^_/, "");
      dataType = `${baseType.toUpperCase()}[]`;
    } else if (dataType === "CHARACTER VARYING" && maxLen) {
      dataType = `VARCHAR(${maxLen})`;
    } else if (dataType === "CHARACTER VARYING") {
      dataType = "VARCHAR";
    } else if (dataType === "TIMESTAMP WITHOUT TIME ZONE") {
      dataType = "TIMESTAMP";
    } else if (dataType === "TIMESTAMP WITH TIME ZONE") {
      dataType = "TIMESTAMPTZ";
    } else if (dataType === "USER-DEFINED") {
      dataType = udtName.toUpperCase();
    }

    let def = `"${colName}" ${dataType}`;
    if (!isSerial && row.is_nullable === "NO") def += " NOT NULL";
    if (!isSerial && colDefault !== null && colDefault !== undefined) {
      def += ` DEFAULT ${colDefault}`;
    }
    colDefs.push(def);
  }

  const pkRes = await srcPool.query(
    `SELECT a.attname FROM pg_index i
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
     WHERE i.indrelid = $1::regclass AND i.indisprimary`,
    [srcTableName]
  );
  if (pkRes.rows.length > 0) {
    const pkCols = pkRes.rows.map((r: Record<string, unknown>) => `"${r.attname}"`).join(", ");
    colDefs.push(`PRIMARY KEY (${pkCols})`);
  }

  return `CREATE TABLE IF NOT EXISTS "${dstTableName}" (\n  ${colDefs.join(",\n  ")}\n)`;
}

async function createUniqueIndexes(srcPool: Pool, dstPool: Pool, srcTableName: string, dstTableName: string): Promise<void> {
  const idxRes = await srcPool.query(
    `SELECT indexdef, indexname FROM pg_indexes
     WHERE tablename = $1 AND schemaname = 'public'
     AND indexdef LIKE '%UNIQUE%'
     AND indexname NOT LIKE '%_pkey'`,
    [srcTableName]
  );
  for (const row of idxRes.rows as Record<string, unknown>[]) {
    const indexDef = row.indexdef as string;
    // Replace source table name with destination table name in the index definition
    const renamedDef = indexDef
      .replace(new RegExp(`\\b${srcTableName}\\b`, "g"), dstTableName)
      .replace("CREATE UNIQUE INDEX", "CREATE UNIQUE INDEX IF NOT EXISTS");
    try {
      await dstPool.query(renamedDef);
    } catch {
      // index may already exist
    }
  }
}

async function ensureTablesExist(srcPool: Pool, dstPool: Pool): Promise<void> {
  console.log("Ensuring destination tables exist (with fs_ prefix)...\n");
  for (const table of TABLES_IN_ORDER) {
    const exists = await tableExists(dstPool, table.dstName);
    if (exists) {
      process.stdout.write(`  ${table.dstName.padEnd(40)} already exists\n`);
      continue;
    }
    const ddl = await getCreateTableDDL(srcPool, table.srcName, table.dstName);
    if (!ddl) {
      process.stdout.write(`  ${table.dstName.padEnd(40)} ⚠ source table '${table.srcName}' not found in source DB\n`);
      continue;
    }
    await dstPool.query(ddl);
    await createUniqueIndexes(srcPool, dstPool, table.srcName, table.dstName);
    process.stdout.write(`  ${table.dstName.padEnd(40)} ✓ created\n`);
  }
  console.log("");
}

/**
 * Auto-detects whether the given column has a PostgreSQL sequence (SERIAL/IDENTITY/nextval default)
 * using pg_get_serial_sequence(). If a sequence exists, resets it to MAX(pk) to prevent ID collisions.
 * Returns the new sequence value if reset, or undefined if no sequence was found.
 */
async function resetSequenceIfExists(pool: Pool, tableName: string, pkColumn: string): Promise<number | undefined> {
  try {
    // pg_get_serial_sequence returns NULL when no sequence is attached (UUID columns, etc.)
    const seqNameRes = await pool.query(
      `SELECT pg_get_serial_sequence('"${tableName}"', '${pkColumn}') AS seq_name`
    );
    const seqName = (seqNameRes.rows[0] as Record<string, unknown>).seq_name;
    if (!seqName) return undefined; // No sequence — UUID or non-serial PK

    const seqRes = await pool.query(
      `SELECT setval('${seqName}', COALESCE((SELECT MAX("${pkColumn}") FROM "${tableName}"), 1)) AS next_val`
    );
    return Number((seqRes.rows[0] as Record<string, unknown>).next_val);
  } catch {
    return undefined;
  }
}

async function migrateTable(
  srcPool: Pool,
  dstPool: Pool,
  table: TableConfig
): Promise<{ read: number; written: number; sequenceReset?: number; error?: string }> {
  const srcColumns = await getTableColumns(srcPool, table.srcName);
  if (srcColumns.length === 0) {
    return { read: 0, written: 0, error: `Source table '${table.srcName}' not found` };
  }

  const dstColumns = await getTableColumns(dstPool, table.dstName);
  if (dstColumns.length === 0) {
    return { read: 0, written: 0, error: `Destination table '${table.dstName}' not found` };
  }

  // Use columns common to both src and dst (dst may have extra columns like holmanVehicleRef)
  const commonColumns = srcColumns.filter((c) => dstColumns.includes(c));
  if (commonColumns.length === 0) {
    return { read: 0, written: 0, error: "No common columns between source and destination" };
  }

  const missingSrcCols = srcColumns.filter((c) => !dstColumns.includes(c));
  const missingDstCols = dstColumns.filter((c) => !srcColumns.includes(c));
  if (missingSrcCols.length > 0) {
    console.warn(`\n    ⚠ WARNING: Source columns not in destination: ${missingSrcCols.join(", ")}`);
  }
  if (missingDstCols.length > 0) {
    // These are columns added in Nexus (like holmanVehicleRef, termRequestFileName) — not a warning
    console.log(`\n    ℹ INFO: Destination has extra columns (Nexus additions, will be NULL): ${missingDstCols.join(", ")}`);
  }

  const quotedCols = commonColumns.map((c) => `"${c}"`);
  // Read from SOURCE (unprefixed table name)
  const srcRes = await srcPool.query(`SELECT ${quotedCols.join(", ")} FROM "${table.srcName}"`);
  const rows = srcRes.rows;

  if (rows.length === 0) {
    // Still reset sequence even if no rows to ensure consistency.
    // Auto-detect via pg_get_serial_sequence — works for both SERIAL and IDENTITY columns.
    const sequenceReset = await resetSequenceIfExists(dstPool, table.dstName, table.primaryKey);
    return { read: 0, written: 0, sequenceReset };
  }

  const BATCH_SIZE = 500;
  let totalWritten = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const placeholders: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    for (const row of batch) {
      const rowPlaceholders: string[] = [];
      for (const col of commonColumns) {
        rowPlaceholders.push(`$${paramIdx++}`);
        values.push(row[col]);
      }
      placeholders.push(`(${rowPlaceholders.join(", ")})`);
    }

    const updateCols = commonColumns
      .filter((c) => c !== table.primaryKey)
      .map((c) => `"${c}" = EXCLUDED."${c}"`)
      .join(", ");

    let query: string;
    if (updateCols) {
      // Write to DESTINATION (fs_-prefixed table name)
      query = `INSERT INTO "${table.dstName}" (${quotedCols.join(", ")}) VALUES ${placeholders.join(", ")} ON CONFLICT ("${table.primaryKey}") DO UPDATE SET ${updateCols}`;
    } else {
      query = `INSERT INTO "${table.dstName}" (${quotedCols.join(", ")}) VALUES ${placeholders.join(", ")} ON CONFLICT ("${table.primaryKey}") DO NOTHING`;
    }

    await dstPool.query(query, values);
    totalWritten += batch.length;
  }

  // Reset PostgreSQL sequence to MAX(id) for ALL tables that have a sequence on their PK.
  // Auto-detection via pg_get_serial_sequence prevents silent omissions for any SERIAL/IDENTITY
  // columns (covers tables in both hasSerialId=true list and any newly added tables).
  const sequenceReset = await resetSequenceIfExists(dstPool, table.dstName, table.primaryKey);

  return { read: rows.length, written: totalWritten, sequenceReset };
}

async function main() {
  console.log("=== Fleet-Scope Data Migration ===");
  console.log("Source DB: original Fleet-Scope (FS_DATABASE_URL)");
  console.log("Dest DB:   Nexus (DATABASE_URL) — tables use fs_ prefix\n");

  const fsConnStr = buildFsConnectionString();
  if (!fsConnStr) {
    console.error("ERROR: No Fleet-Scope database credentials found.");
    console.error("Set FS_DATABASE_URL or FS_PGHOST/FS_PGPORT/FS_PGUSER/FS_PGPASSWORD/FS_PGDATABASE");
    process.exit(1);
  }

  const nexusConnStr = process.env.DATABASE_URL;
  if (!nexusConnStr) {
    console.error("ERROR: DATABASE_URL not set for Nexus database.");
    process.exit(1);
  }

  console.log("Connecting to Fleet-Scope (source) database...");
  const srcPool = new Pool({ connectionString: fsConnStr, max: 5, connectionTimeoutMillis: 15000 });
  const dstPool = new Pool({ connectionString: nexusConnStr, max: 5, connectionTimeoutMillis: 15000 });

  let hasErrors = false;

  try {
    await srcPool.query("SELECT 1");
    console.log("  ✓ Fleet-Scope database connected\n");

    console.log("Connecting to Nexus (destination) database...");
    await dstPool.query("SELECT 1");
    console.log("  ✓ Nexus database connected\n");

    await ensureTablesExist(srcPool, dstPool);

    console.log(`Migrating ${TABLES_IN_ORDER.length} tables (src: unprefixed → dst: fs_prefixed)...\n`);

    const results: Array<{ srcTable: string; dstTable: string; read: number; written: number; sequenceReset?: number; error?: string }> = [];

    for (const table of TABLES_IN_ORDER) {
      process.stdout.write(`  ${table.srcName.padEnd(30)} → ${table.dstName.padEnd(36)} `);
      try {
        const result = await migrateTable(srcPool, dstPool, table);
        if (result.error) {
          console.log(`⚠  ${result.error}`);
          hasErrors = true;
        } else if (result.read === 0) {
          console.log(`—  empty (0 rows)`);
        } else {
          let line = `✓  ${result.read} rows read, ${result.written} rows written`;
          if (result.sequenceReset !== undefined) {
            line += `, seq reset to ${result.sequenceReset}`;
          }
          console.log(line);
        }
        results.push({ srcTable: table.srcName, dstTable: table.dstName, ...result });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`✗  ERROR: ${msg}`);
        results.push({ srcTable: table.srcName, dstTable: table.dstName, read: 0, written: 0, error: msg });
        hasErrors = true;
      }
    }

    console.log("\n=== Migration Summary ===\n");
    const totalRead = results.reduce((sum, r) => sum + r.read, 0);
    const totalWritten = results.reduce((sum, r) => sum + r.written, 0);
    const errorCount = results.filter((r) => r.error).length;
    const emptyCount = results.filter((r) => !r.error && r.read === 0).length;
    const successCount = results.filter((r) => !r.error && r.read > 0).length;

    console.log(`  Tables processed:    ${TABLES_IN_ORDER.length}`);
    console.log(`  Successful:          ${successCount}`);
    console.log(`  Empty (0 rows):      ${emptyCount}`);
    console.log(`  Errors:              ${errorCount}`);
    console.log(`  Total rows read:     ${totalRead}`);
    console.log(`  Total rows written:  ${totalWritten}`);

    if (errorCount > 0) {
      console.log("\n  Tables with errors:");
      for (const r of results.filter((r) => r.error)) {
        console.log(`    - ${r.srcTable} → ${r.dstTable}: ${r.error}`);
      }
    }

    // Verify row counts match between source and destination for ALL tables (including empty ones)
    console.log("\n=== Row Count Verification (all 32 tables) ===\n");
    let allMatch = true;
    for (const r of results.filter((r) => !r.error)) {
      try {
        const srcCount = await srcPool.query(`SELECT COUNT(*) AS cnt FROM "${r.srcTable}"`);
        const dstCount = await dstPool.query(`SELECT COUNT(*) AS cnt FROM "${r.dstTable}"`);
        const srcCnt = Number((srcCount.rows[0] as Record<string, unknown>).cnt);
        const dstCnt = Number((dstCount.rows[0] as Record<string, unknown>).cnt);
        const match = srcCnt === dstCnt ? "✓ MATCH" : "✗ MISMATCH";
        if (srcCnt !== dstCnt) allMatch = false;
        const seqNote = r.sequenceReset !== undefined ? `  seq=${r.sequenceReset}` : "";
        console.log(`  ${r.srcTable.padEnd(30)} src=${String(srcCnt).padStart(6)}  dst=${String(dstCnt).padStart(6)}  ${match}${seqNote}`);
      } catch (err) {
        console.log(`  ${r.srcTable.padEnd(30)} ⚠ Count verification failed: ${err}`);
      }
    }
    // Log any tables that had errors (were not verified above)
    for (const r of results.filter((r) => r.error)) {
      console.log(`  ${r.srcTable.padEnd(30)} ✗ SKIPPED (migration error): ${r.error}`);
    }

    if (allMatch) {
      console.log("\n  ✓ All row counts match between source and destination.");
    } else {
      console.log("\n  ✗ Some row counts do not match — review errors above.");
      hasErrors = true;
    }

    console.log("\n=== Migration Complete ===");
    if (!hasErrors) {
      console.log("Next step: Update server/fleet-scope-db.ts to use DATABASE_URL (Nexus's own DB).");
    }
  } finally {
    await srcPool.end().catch(() => {});
    await dstPool.end().catch(() => {});
  }

  process.exit(hasErrors ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
