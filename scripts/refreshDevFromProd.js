// scripts/refreshDevFromProd.js
import pg from "pg";
const { Client } = pg;

// Order matters where foreign keys exist.
// Parents first: integration_data_sources, mapping_sets, data_source_fields,
// then mapping_nodes + field_mappings. Others can be anywhere.
const TABLES = [
  // FK parents / core mapping tables
  { schema: "public", name: "integration_data_sources" },
  { schema: "public", name: "mapping_sets" },
  { schema: "public", name: "data_source_fields" },
  { schema: "public", name: "mapping_nodes" },
  { schema: "public", name: "field_mappings" },

  // Other tables (no FKs in your schema)
  { schema: "public", name: "activity_logs" },
  { schema: "public", name: "all_techs" },
  { schema: "public", name: "api_configurations" },
  { schema: "public", name: "queue_items" },
  { schema: "public", name: "requests" },
  { schema: "public", name: "role_permissions" },
  { schema: "public", name: "sessions" },
  { schema: "public", name: "storage_spots" },
  { schema: "public", name: "sync_logs" },
  { schema: "public", name: "tech_vehicle_assignment_history" },
  { schema: "public", name: "tech_vehicle_assignments" },
  { schema: "public", name: "templates" },
  { schema: "public", name: "termed_techs" },
  { schema: "public", name: "users" },
  { schema: "public", name: "vehicles" },

  // Drizzle migrations table (separate schema)
  { schema: "drizzle", name: "__drizzle_migrations" },
];

const CHUNK_SIZE = 500; // rows per batch insert – tweak if needed

async function copyTable(prod, dev, { schema, name }) {
  const fullName = `"${schema}"."${name}"`;
  console.log(`\n==> Copying ${fullName}`);

  // Get ordered column list from prod
  const colsRes = await prod.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = $2
    ORDER BY ordinal_position
  `,
    [schema, name]
  );

  const columns = colsRes.rows.map((r) => r.column_name);
  if (columns.length === 0) {
    console.log("  (no columns, skipping)");
    return;
  }

  const colList = columns.map((c) => `"${c}"`).join(", ");

  // Read all data from prod
  const dataRes = await prod.query(`SELECT ${colList} FROM ${fullName}`);
  const rows = dataRes.rows;
  console.log(`  Found ${rows.length} row(s) in prod`);

  // Clear dev table (plus dependent tables if any)
  await dev.query(`TRUNCATE TABLE ${fullName} RESTART IDENTITY CASCADE`);

  if (rows.length === 0) {
    console.log("  Nothing to insert");
    return;
  }

  // Insert data into dev in chunks
  for (let start = 0; start < rows.length; start += CHUNK_SIZE) {
    const chunk = rows.slice(start, start + CHUNK_SIZE);
    const values = [];
    const valuePlaceholders = chunk
      .map((row, rowIndex) => {
        const placeholders = columns.map((_, colIndex) => {
          const paramIndex = rowIndex * columns.length + colIndex + 1;
          return `$${paramIndex}`;
        });

        // Push values in the same order as columns for this row
        columns.forEach((col) => values.push(row[col]));

        return `(${placeholders.join(", ")})`;
      })
      .join(", ");

    const sql = `INSERT INTO ${fullName} (${colList}) VALUES ${valuePlaceholders}`;
    await dev.query(sql, values);

    console.log(
      `  Inserted ${Math.min(start + chunk.length, rows.length)}/${rows.length}`
    );
  }
}

async function main() {
  const prodUrl = process.env.PROD_DATABASE_URL;
  const devUrl = process.env.DEV_DATABASE_URL;

  if (!prodUrl || !devUrl) {
    throw new Error(
      "Missing PROD_DATABASE_URL or DEV_DATABASE_URL env vars in Replit Secrets."
    );
  }

  const prod = new Client({ connectionString: prodUrl });
  const dev = new Client({ connectionString: devUrl });

  console.log("Connecting to prod and dev...");
  await prod.connect();
  await dev.connect();

  try {
    // Wrap the whole dev side in a transaction
    await dev.query("BEGIN");

    for (const table of TABLES) {
      await copyTable(prod, dev, table);
    }

    await dev.query("COMMIT");
    console.log("\n✅ Dev database successfully refreshed from prod.");
  } catch (err) {
    console.error("\n❌ Error during refresh, rolling back dev changes:");
    console.error(err);
    try {
      await dev.query("ROLLBACK");
    } catch (rollbackErr) {
      console.error("Error during ROLLBACK:", rollbackErr);
    }
  } finally {
    await prod.end();
    await dev.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
