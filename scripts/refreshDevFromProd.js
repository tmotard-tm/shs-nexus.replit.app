// scripts/refreshDevFromProd.js
import pg from "pg";
const { Client } = pg;

const CHUNK_SIZE = 500; // rows per batch insert – tweak if needed

// Properly escape a SQL identifier by doubling any embedded double-quotes
function escapeIdentifier(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

// Tables to exclude from sync (if any)
const EXCLUDED_TABLES = [
  // Add table names here if you want to exclude them from sync
  // e.g., 'sensitive_data', 'temp_table'
];

// Dynamically discover all tables from the database
async function discoverTables(prodClient, devClient) {
  console.log("Discovering tables from both databases...");
  
  const getTableSet = async (client) => {
    const res = await client.query(`
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_type = 'BASE TABLE'
        AND (table_schema = 'public' OR table_schema = 'drizzle')
      ORDER BY table_schema, table_name
    `);
    return new Set(res.rows.map(r => `${r.table_schema}.${r.table_name}`));
  };

  const prodTables = await getTableSet(prodClient);
  const devTables = await getTableSet(devClient);

  const onlyInProd = [...prodTables].filter(t => !devTables.has(t));
  const onlyInDev = [...devTables].filter(t => !prodTables.has(t));

  if (onlyInProd.length > 0) {
    console.log(`\nTables in prod but NOT in dev (will be skipped):`);
    onlyInProd.forEach(t => console.log(`  - ${t}`));
  }
  if (onlyInDev.length > 0) {
    console.log(`\nTables in dev but NOT in prod (will be left untouched):`);
    onlyInDev.forEach(t => console.log(`  - ${t}`));
  }

  // Only sync tables present in BOTH databases
  const commonKeys = [...prodTables].filter(t => devTables.has(t));
  const allTables = commonKeys.map(key => {
    const [schema, name] = key.split('.');
    return { schema, name };
  });
  
  // Filter out excluded tables
  const tables = allTables.filter(t => 
    !EXCLUDED_TABLES.includes(t.name) && 
    !EXCLUDED_TABLES.includes(`${t.schema}.${t.name}`)
  );
  
  console.log(`\nFound ${tables.length} tables to sync (present in both databases):`);
  tables.forEach(t => console.log(`  - ${t.schema}.${t.name}`));
  
  // Sort tables by foreign key dependencies (parents first)
  return await sortTablesByDependencies(prodClient, tables);
}

// Sort tables so parent tables (referenced by FKs) come before child tables
async function sortTablesByDependencies(client, tables) {
  // Get all foreign key relationships
  const fkRes = await client.query(`
    SELECT 
      tc.table_schema,
      tc.table_name,
      ccu.table_schema AS referenced_schema,
      ccu.table_name AS referenced_table
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu 
      ON tc.constraint_name = ccu.constraint_name
      AND tc.table_schema = ccu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND (tc.table_schema = 'public' OR tc.table_schema = 'drizzle')
  `);
  
  // Build dependency graph: child -> [parents]
  const dependencies = {};
  tables.forEach(t => {
    const key = `${t.schema}.${t.name}`;
    dependencies[key] = [];
  });
  
  fkRes.rows.forEach(fk => {
    const child = `${fk.table_schema}.${fk.table_name}`;
    const parent = `${fk.referenced_schema}.${fk.referenced_table}`;
    if (dependencies[child] && dependencies[parent] !== undefined) {
      if (!dependencies[child].includes(parent)) {
        dependencies[child].push(parent);
      }
    }
  });
  
  // Topological sort (Kahn's algorithm)
  const sorted = [];
  const visited = new Set();
  
  function visit(tableKey) {
    if (visited.has(tableKey)) return;
    visited.add(tableKey);
    
    // Visit all parents first
    const parents = dependencies[tableKey] || [];
    parents.forEach(parent => visit(parent));
    
    sorted.push(tableKey);
  }
  
  // Visit all tables
  Object.keys(dependencies).forEach(key => visit(key));
  
  // Convert back to table objects
  const sortedTables = sorted.map(key => {
    const [schema, name] = key.split('.');
    return { schema, name };
  });
  
  console.log("\nTables sorted by dependencies (parents first):");
  sortedTables.forEach((t, i) => console.log(`  ${i + 1}. ${t.schema}.${t.name}`));
  
  return sortedTables;
}

async function copyTable(prod, dev, { schema, name }) {
  const fullName = `${escapeIdentifier(schema)}.${escapeIdentifier(name)}`;
  console.log(`\n==> Copying ${fullName}`);

  // Get ordered column list with data types from prod
  const colsRes = await prod.query(
    `
    SELECT column_name, data_type, udt_name
    FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = $2
    ORDER BY ordinal_position
  `,
    [schema, name]
  );

  // Get column list from dev to handle schema drift
  const devColsRes = await dev.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = $2
  `,
    [schema, name]
  );
  const devColSet = new Set(devColsRes.rows.map((r) => r.column_name));

  const allProdColumns = colsRes.rows.map((r) => r.column_name);
  const colTypes = {};
  colsRes.rows.forEach((r) => {
    colTypes[r.column_name] = r.data_type === 'USER-DEFINED' ? r.udt_name : r.data_type;
  });

  // Only use columns present in BOTH prod and dev
  const skippedColumns = allProdColumns.filter((c) => !devColSet.has(c));
  if (skippedColumns.length > 0) {
    console.log(`  Skipping prod-only columns: ${skippedColumns.join(', ')}`);
  }
  const columns = allProdColumns.filter((c) => devColSet.has(c));

  if (columns.length === 0) {
    console.log("  (no common columns, skipping)");
    return;
  }

  const colList = columns.map((c) => escapeIdentifier(c)).join(", ");

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

  // Serialize a value for insertion, handling JSON/JSONB and arrays correctly
  function serializeValue(val, colName) {
    if (val === null || val === undefined) return null;
    const colType = colTypes[colName] || '';
    const isJson = colType === 'json' || colType === 'jsonb';
    const isArray = colType.startsWith('_') || Array.isArray(val);
    if (isJson) {
      // Always re-serialize: pg returns parsed JS values (string/object/array/number)
      // but insertion with ::json/::jsonb needs a valid JSON string.
      return JSON.stringify(val);
    }
    if (isArray && Array.isArray(val)) {
      return val;
    }
    return val;
  }

  // Insert data into dev in chunks
  for (let start = 0; start < rows.length; start += CHUNK_SIZE) {
    const chunk = rows.slice(start, start + CHUNK_SIZE);
    const values = [];
    const valuePlaceholders = chunk
      .map((row, rowIndex) => {
        const placeholders = columns.map((_, colIndex) => {
          const paramIndex = rowIndex * columns.length + colIndex + 1;
          const colType = colTypes[columns[colIndex]] || '';
          const isJson = colType === 'json' || colType === 'jsonb';
          return isJson ? `$${paramIndex}::${colType}` : `$${paramIndex}`;
        });

        // Push serialized values in the same order as columns for this row
        columns.forEach((col) => values.push(serializeValue(row[col], col)));

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
    // Dynamically discover all tables present in both prod and dev
    const tables = await discoverTables(prod, dev);
    
    if (tables.length === 0) {
      console.log("No tables found to sync.");
      return;
    }
    
    // Wrap the whole dev side in a transaction
    await dev.query("BEGIN");

    for (const table of tables) {
      await copyTable(prod, dev, table);
    }

    await dev.query("COMMIT");
    console.log("\n✅ Dev database successfully refreshed from prod.");
    console.log(`   Synced ${tables.length} tables.`);
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
