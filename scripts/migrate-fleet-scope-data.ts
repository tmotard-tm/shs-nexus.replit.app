import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

interface TableConfig {
  name: string;
  primaryKey: string;
  serialPk?: boolean;
}

const TABLES_IN_ORDER: TableConfig[] = [
  { name: "trucks", primaryKey: "id" },
  { name: "actions", primaryKey: "id" },
  { name: "archived_trucks", primaryKey: "id" },
  { name: "truck_consolidations", primaryKey: "id" },

  { name: "tracking_records", primaryKey: "id" },
  { name: "registration_tracking", primaryKey: "truck_number" },
  { name: "reg_messages", primaryKey: "id" },
  { name: "reg_scheduled_messages", primaryKey: "id" },

  { name: "pmf_imports", primaryKey: "id" },
  { name: "pmf_rows", primaryKey: "id" },
  { name: "pmf_status_events", primaryKey: "id" },
  { name: "pmf_activity_logs", primaryKey: "id" },
  { name: "pmf_activity_sync_meta", primaryKey: "id" },

  { name: "purchase_orders", primaryKey: "id" },
  { name: "po_import_meta", primaryKey: "id" },
  { name: "fleet_cost_records", primaryKey: "id" },
  { name: "fleet_cost_import_meta", primaryKey: "id" },
  { name: "approved_cost_records", primaryKey: "id" },
  { name: "approved_cost_import_meta", primaryKey: "id" },
  { name: "vehicle_maintenance_costs", primaryKey: "vehicle_number" },

  { name: "spare_vehicle_details", primaryKey: "id" },
  { name: "decommissioning_vehicles", primaryKey: "id", serialPk: true },

  { name: "metrics_snapshots", primaryKey: "id" },
  { name: "byov_weekly_snapshots", primaryKey: "id" },
  { name: "pickup_weekly_snapshots", primaryKey: "id" },
  { name: "fleet_weekly_snapshots", primaryKey: "id" },
  { name: "pmf_status_weekly_snapshots", primaryKey: "id" },
  { name: "repair_weekly_snapshots", primaryKey: "id" },
  { name: "rental_weekly_manual", primaryKey: "id", serialPk: true },

  { name: "samsara_locations", primaryKey: "vehicle_number" },

  { name: "call_logs", primaryKey: "id", serialPk: true },
  { name: "rental_imports", primaryKey: "id" },
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
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`,
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

async function getCreateTableDDL(srcPool: Pool, tableName: string): Promise<string | null> {
  const colRes = await srcPool.query(
    `SELECT column_name, data_type, udt_name, character_maximum_length,
            is_nullable, column_default
     FROM information_schema.columns
     WHERE table_name = $1 AND table_schema = 'public'
     ORDER BY ordinal_position`,
    [tableName]
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
    [tableName]
  );
  if (pkRes.rows.length > 0) {
    const pkCols = pkRes.rows.map((r: Record<string, unknown>) => `"${r.attname}"`).join(", ");
    colDefs.push(`PRIMARY KEY (${pkCols})`);
  }

  return `CREATE TABLE IF NOT EXISTS "${tableName}" (\n  ${colDefs.join(",\n  ")}\n)`;
}

async function createUniqueIndexes(srcPool: Pool, dstPool: Pool, tableName: string): Promise<void> {
  const idxRes = await srcPool.query(
    `SELECT indexdef FROM pg_indexes
     WHERE tablename = $1 AND schemaname = 'public'
     AND indexdef LIKE '%UNIQUE%'
     AND indexname NOT LIKE '%_pkey'`,
    [tableName]
  );
  for (const row of idxRes.rows as Record<string, unknown>[]) {
    const indexDef = row.indexdef as string;
    const ifNotExists = indexDef.replace("CREATE UNIQUE INDEX", "CREATE UNIQUE INDEX IF NOT EXISTS");
    try {
      await dstPool.query(ifNotExists);
    } catch {
      // index may already exist
    }
  }
}

async function ensureTablesExist(srcPool: Pool, dstPool: Pool): Promise<void> {
  console.log("Ensuring destination tables exist...\n");
  for (const table of TABLES_IN_ORDER) {
    const exists = await tableExists(dstPool, table.name);
    if (exists) {
      process.stdout.write(`  ${table.name.padEnd(35)} exists\n`);
      continue;
    }
    const ddl = await getCreateTableDDL(srcPool, table.name);
    if (!ddl) {
      process.stdout.write(`  ${table.name.padEnd(35)} ⚠ not found in source\n`);
      continue;
    }
    await dstPool.query(ddl);
    await createUniqueIndexes(srcPool, dstPool, table.name);
    process.stdout.write(`  ${table.name.padEnd(35)} ✓ created\n`);
  }
  console.log("");
}

async function migrateTable(
  srcPool: Pool,
  dstPool: Pool,
  table: TableConfig
): Promise<{ read: number; written: number; error?: string }> {
  const srcColumns = await getTableColumns(srcPool, table.name);
  if (srcColumns.length === 0) {
    return { read: 0, written: 0, error: "Table not found in source" };
  }

  const dstColumns = await getTableColumns(dstPool, table.name);
  if (dstColumns.length === 0) {
    return { read: 0, written: 0, error: "Table not found in destination" };
  }

  const commonColumns = srcColumns.filter((c) => dstColumns.includes(c));
  if (commonColumns.length === 0) {
    return { read: 0, written: 0, error: "No common columns" };
  }

  const missingSrcCols = srcColumns.filter((c) => !dstColumns.includes(c));
  const missingDstCols = dstColumns.filter((c) => !srcColumns.includes(c));
  if (missingSrcCols.length > 0) {
    console.warn(`\n    ⚠ WARNING: Source columns not in destination: ${missingSrcCols.join(", ")}`);
  }
  if (missingDstCols.length > 0) {
    console.warn(`\n    ⚠ WARNING: Destination columns not in source: ${missingDstCols.join(", ")}`);
  }

  const quotedCols = commonColumns.map((c) => `"${c}"`);
  const srcRes = await srcPool.query(`SELECT ${quotedCols.join(", ")} FROM "${table.name}"`);
  const rows = srcRes.rows;

  if (rows.length === 0) {
    return { read: 0, written: 0 };
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
      query = `INSERT INTO "${table.name}" (${quotedCols.join(", ")}) VALUES ${placeholders.join(", ")} ON CONFLICT ("${table.primaryKey}") DO UPDATE SET ${updateCols}`;
    } else {
      query = `INSERT INTO "${table.name}" (${quotedCols.join(", ")}) VALUES ${placeholders.join(", ")} ON CONFLICT ("${table.primaryKey}") DO NOTHING`;
    }

    await dstPool.query(query, values);
    totalWritten += batch.length;
  }

  if (table.serialPk) {
    try {
      await dstPool.query(
        `SELECT setval(pg_get_serial_sequence('"${table.name}"', '${table.primaryKey}'), COALESCE((SELECT MAX("${table.primaryKey}") FROM "${table.name}"), 1))`
      );
    } catch {
      // sequence may not exist for non-serial columns
    }
  }

  return { read: rows.length, written: totalWritten };
}

async function main() {
  console.log("=== Fleet-Scope Data Migration ===\n");

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

    console.log(`Migrating ${TABLES_IN_ORDER.length} tables...\n`);

    const results: Array<{ table: string; read: number; written: number; error?: string }> = [];

    for (const table of TABLES_IN_ORDER) {
      process.stdout.write(`  ${table.name.padEnd(35)} `);
      try {
        const result = await migrateTable(srcPool, dstPool, table);
        if (result.error) {
          console.log(`⚠  ${result.error}`);
          hasErrors = true;
        } else if (result.read === 0) {
          console.log(`—  empty (0 rows)`);
        } else {
          console.log(`✓  ${result.read} rows read, ${result.written} rows written`);
        }
        results.push({ table: table.name, ...result });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`✗  ERROR: ${msg}`);
        results.push({ table: table.name, read: 0, written: 0, error: msg });
        hasErrors = true;
      }
    }

    console.log("\n=== Migration Summary ===\n");
    const totalRead = results.reduce((sum, r) => sum + r.read, 0);
    const totalWritten = results.reduce((sum, r) => sum + r.written, 0);
    const errorCount = results.filter((r) => r.error).length;
    const emptyCount = results.filter((r) => !r.error && r.read === 0).length;
    const successCount = results.filter((r) => !r.error && r.read > 0).length;

    console.log(`  Tables processed: ${TABLES_IN_ORDER.length}`);
    console.log(`  Successful:       ${successCount}`);
    console.log(`  Empty (0 rows):   ${emptyCount}`);
    console.log(`  Errors:           ${errorCount}`);
    console.log(`  Total rows read:  ${totalRead}`);
    console.log(`  Total rows written: ${totalWritten}`);

    if (errorCount > 0) {
      console.log("\n  Tables with errors:");
      for (const r of results.filter((r) => r.error)) {
        console.log(`    - ${r.table}: ${r.error}`);
      }
    }

    console.log("\n=== Migration Complete ===");
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
