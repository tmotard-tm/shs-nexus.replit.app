// scripts/createMissingTablesInDev.js
// Creates tables that exist in prod but not in dev, then copies their data.
import pg from "pg";
const { Client } = pg;

const CHUNK_SIZE = 500;

function escapeIdentifier(id) {
  return `"${id.replace(/"/g, '""')}"`;
}

function escapeLiteral(val) {
  if (val === null || val === undefined) return "NULL";
  return `'${String(val).replace(/'/g, "''")}'`;
}

async function getMissingTables(prod, dev) {
  const query = `
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `;
  const [prodRes, devRes] = await Promise.all([prod.query(query), dev.query(query)]);
  const prodSet = new Set(prodRes.rows.map((r) => r.table_name));
  const devSet = new Set(devRes.rows.map((r) => r.table_name));
  return [...prodSet].filter((t) => !devSet.has(t));
}

// Get enum types that need to be created in dev
async function getEnumTypes(prod) {
  const res = await prod.query(`
    SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
    GROUP BY t.typname
  `);
  return res.rows; // [{typname, labels}]
}

async function getExistingEnums(dev) {
  const res = await dev.query(`
    SELECT t.typname
    FROM pg_type t
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typtype = 'e' AND n.nspname = 'public'
  `);
  return new Set(res.rows.map((r) => r.typname));
}

// Build a CREATE TABLE statement for a given table using pg_catalog
async function buildCreateTableSql(prod, tableName) {
  // Get columns
  const colsRes = await prod.query(
    `
    SELECT
      a.attname AS column_name,
      pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
      a.attnotnull AS not_null,
      pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS column_default,
      a.attndims AS array_dims
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE n.nspname = 'public'
      AND c.relname = $1
      AND a.attnum > 0
      AND NOT a.attisdropped
    ORDER BY a.attnum
  `,
    [tableName]
  );

  if (colsRes.rows.length === 0) return null;

  // Get primary key columns
  const pkRes = await prod.query(
    `
    SELECT a.attname
    FROM pg_constraint c
    JOIN pg_class cl ON cl.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE n.nspname = 'public' AND cl.relname = $1 AND c.contype = 'p'
    ORDER BY array_position(c.conkey, a.attnum)
  `,
    [tableName]
  );
  const pkCols = pkRes.rows.map((r) => r.attname);

  // Get unique constraints (non-PK)
  const uniqRes = await prod.query(
    `
    SELECT c.conname, array_agg(a.attname ORDER BY array_position(c.conkey, a.attnum)) AS cols
    FROM pg_constraint c
    JOIN pg_class cl ON cl.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE n.nspname = 'public' AND cl.relname = $1 AND c.contype = 'u'
    GROUP BY c.conname
  `,
    [tableName]
  );

  // Get foreign key constraints
  const fkRes = await prod.query(
    `
    SELECT
      c.conname,
      array_agg(a.attname ORDER BY array_position(c.conkey, a.attnum)) AS cols,
      rn.nspname AS ref_schema,
      rcl.relname AS ref_table,
      array_agg(ra.attname ORDER BY array_position(c.confkey, ra.attnum)) AS ref_cols,
      c.confupdtype,
      c.confdeltype
    FROM pg_constraint c
    JOIN pg_class cl ON cl.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    JOIN pg_class rcl ON rcl.oid = c.confrelid
    JOIN pg_namespace rn ON rn.oid = rcl.relnamespace
    JOIN pg_attribute ra ON ra.attrelid = c.confrelid AND ra.attnum = ANY(c.confkey)
    WHERE n.nspname = 'public' AND cl.relname = $1 AND c.contype = 'f'
    GROUP BY c.conname, rn.nspname, rcl.relname, c.confupdtype, c.confdeltype
  `,
    [tableName]
  );

  const actionMap = { a: "NO ACTION", r: "RESTRICT", c: "CASCADE", n: "SET NULL", d: "SET DEFAULT" };

  // Build column definitions
  const colDefs = colsRes.rows.map((col) => {
    let def = `  ${escapeIdentifier(col.column_name)} ${col.data_type}`;
    if (col.column_default !== null) {
      // Replace sequence names from prod to use generic names
      let dflt = col.column_default;
      def += ` DEFAULT ${dflt}`;
    }
    if (col.not_null) def += " NOT NULL";
    return def;
  });

  // Add primary key
  if (pkCols.length > 0) {
    colDefs.push(`  PRIMARY KEY (${pkCols.map(escapeIdentifier).join(", ")})`);
  }

  function toArray(val) {
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') return val.replace(/^\{|\}$/g, '').split(',').map(s => s.trim()).filter(Boolean);
    return [];
  }

  // Add unique constraints
  uniqRes.rows.forEach((u) => {
    const cols = toArray(u.cols);
    colDefs.push(
      `  CONSTRAINT ${escapeIdentifier(u.conname)} UNIQUE (${cols.map(escapeIdentifier).join(", ")})`
    );
  });

  // Add foreign keys
  fkRes.rows.forEach((fk) => {
    const onUpdate = actionMap[fk.confupdtype] || "NO ACTION";
    const onDelete = actionMap[fk.confdeltype] || "NO ACTION";
    const cols = toArray(fk.cols);
    const refCols = toArray(fk.ref_cols);
    colDefs.push(
      `  CONSTRAINT ${escapeIdentifier(fk.conname)} FOREIGN KEY (${cols.map(escapeIdentifier).join(", ")}) ` +
        `REFERENCES ${escapeIdentifier(fk.ref_schema)}.${escapeIdentifier(fk.ref_table)} (${refCols.map(escapeIdentifier).join(", ")}) ` +
        `ON UPDATE ${onUpdate} ON DELETE ${onDelete}`
    );
  });

  return `CREATE TABLE IF NOT EXISTS "public".${escapeIdentifier(tableName)} (\n${colDefs.join(",\n")}\n)`;
}

// Get sequences referenced by a table
async function getSequencesForTable(prod, tableName) {
  const res = await prod.query(
    `
    SELECT
      seq.relname AS seq_name,
      pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS default_expr,
      a.attname AS col_name
    FROM pg_class seq
    JOIN pg_namespace n ON n.oid = seq.relnamespace
    JOIN pg_depend dep ON dep.objid = seq.oid
    JOIN pg_class tbl ON tbl.oid = dep.refobjid
    JOIN pg_attribute a ON a.attrelid = tbl.oid AND a.attnum = dep.refobjsubid
    LEFT JOIN pg_attrdef d ON d.adrelid = tbl.oid AND d.adnum = a.attnum
    WHERE n.nspname = 'public'
      AND tbl.relname = $1
      AND seq.relkind = 'S'
  `,
    [tableName]
  );
  return res.rows;
}

// Get sequence properties (start, min, max, increment, etc.)
async function getSequenceProperties(prod, seqName) {
  const res = await prod.query(
    `SELECT start_value, minimum_value, maximum_value, increment, cycle_option
     FROM information_schema.sequences
     WHERE sequence_schema = 'public' AND sequence_name = $1`,
    [seqName]
  );
  return res.rows[0] || null;
}

async function getExistingSequences(dev) {
  const res = await dev.query(
    `SELECT relname FROM pg_class WHERE relkind = 'S' AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')`
  );
  return new Set(res.rows.map((r) => r.relname));
}

// Get indexes for a table (non-PK, non-unique-constraint)
async function getIndexesForTable(prod, tableName) {
  const res = await prod.query(
    `
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = $1
      AND indexname NOT IN (
        SELECT conname FROM pg_constraint
        WHERE conrelid = (SELECT oid FROM pg_class WHERE relname = $1 AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public'))
          AND contype IN ('p', 'u')
      )
  `,
    [tableName]
  );
  return res.rows;
}

function serializeValue(val, dataType) {
  if (val === null || val === undefined) return null;
  const t = (dataType || "").toLowerCase();
  const isJson = t.includes("json");
  if (isJson) {
    // Always re-serialize: pg returns parsed JS values (string/object/array/number)
    // but insertion with ::json/::jsonb cast needs a valid JSON string.
    return JSON.stringify(val);
  }
  return val;
}

async function copyTableData(prod, dev, tableName) {
  const fullName = `"public".${escapeIdentifier(tableName)}`;

  // Get common columns between prod and dev
  const getColsQuery = `
    SELECT column_name, data_type, udt_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
    ORDER BY ordinal_position
  `;
  const [prodColsRes, devColsRes] = await Promise.all([
    prod.query(getColsQuery, [tableName]),
    dev.query(getColsQuery, [tableName]),
  ]);

  const devColSet = new Set(devColsRes.rows.map((r) => r.column_name));
  const colTypes = {};
  prodColsRes.rows.forEach((r) => {
    colTypes[r.column_name] = r.data_type === "USER-DEFINED" ? r.udt_name : r.data_type;
  });

  const skipped = prodColsRes.rows.filter((r) => !devColSet.has(r.column_name));
  if (skipped.length > 0) {
    console.log(`  Skipping prod-only columns: ${skipped.map((r) => r.column_name).join(", ")}`);
  }
  const columns = prodColsRes.rows.filter((r) => devColSet.has(r.column_name)).map((r) => r.column_name);
  if (columns.length === 0) {
    console.log("  No common columns, skipping data copy.");
    return;
  }

  const colList = columns.map((c) => escapeIdentifier(c)).join(", ");
  const dataRes = await prod.query(`SELECT ${colList} FROM ${fullName}`);
  const rows = dataRes.rows;
  console.log(`  Found ${rows.length} row(s) in prod`);
  if (rows.length === 0) return;

  for (let start = 0; start < rows.length; start += CHUNK_SIZE) {
    const chunk = rows.slice(start, start + CHUNK_SIZE);
    const values = [];
    const placeholders = chunk
      .map((row, ri) => {
        const rowPlaceholders = columns.map((col, ci) => {
          const idx = ri * columns.length + ci + 1;
          const dt = colTypes[col] || "";
          const isJson = dt === "json" || dt === "jsonb";
          return isJson ? `$${idx}::${dt}` : `$${idx}`;
        });
        columns.forEach((col) => values.push(serializeValue(row[col], colTypes[col])));
        return `(${rowPlaceholders.join(", ")})`;
      })
      .join(", ");

    await dev.query(`INSERT INTO ${fullName} (${colList}) VALUES ${placeholders}`, values);
    console.log(`  Inserted ${Math.min(start + chunk.length, rows.length)}/${rows.length}`);
  }
}

async function sortByDependencies(prod, tables) {
  const tableSet = new Set(tables);
  const fkRes = await prod.query(`
    SELECT tc.table_name, ccu.table_name AS referenced_table
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
  `);

  const deps = {};
  tables.forEach((t) => (deps[t] = []));
  fkRes.rows.forEach(({ table_name, referenced_table }) => {
    if (deps[table_name] && tableSet.has(referenced_table) && table_name !== referenced_table) {
      if (!deps[table_name].includes(referenced_table)) deps[table_name].push(referenced_table);
    }
  });

  const sorted = [];
  const visited = new Set();
  function visit(t) {
    if (visited.has(t)) return;
    visited.add(t);
    (deps[t] || []).forEach(visit);
    sorted.push(t);
  }
  tables.forEach(visit);
  return sorted;
}

async function main() {
  const prodUrl = process.env.PROD_DATABASE_URL;
  const devUrl = process.env.DEV_DATABASE_URL;
  if (!prodUrl || !devUrl) throw new Error("Missing PROD_DATABASE_URL or DEV_DATABASE_URL");

  const prod = new Client({ connectionString: prodUrl });
  const dev = new Client({ connectionString: devUrl });
  await prod.connect();
  await dev.connect();

  try {
    const missing = await getMissingTables(prod, dev);
    if (missing.length === 0) {
      console.log("No missing tables — dev is fully in sync with prod schema.");
      return;
    }
    console.log(`Found ${missing.length} tables to create in dev:`);
    missing.forEach((t) => console.log(`  - ${t}`));

    // 1. Ensure all required enum types exist in dev
    const [prodEnums, devEnumSet] = await Promise.all([getEnumTypes(prod), getExistingEnums(dev)]);
    for (const e of prodEnums) {
      if (!devEnumSet.has(e.typname)) {
        const labelArr = Array.isArray(e.labels) ? e.labels : String(e.labels).replace(/^\{|\}$/g, '').split(',');
        const labels = labelArr.map(escapeLiteral).join(", ");
        const sql = `CREATE TYPE "public".${escapeIdentifier(e.typname)} AS ENUM (${labels})`;
        console.log(`\nCreating enum: ${e.typname}`);
        await dev.query(sql);
      }
    }

    // 2. Sort missing tables by FK dependencies
    const sortedMissing = await sortByDependencies(prod, missing);
    console.log("\nCreation order:", sortedMissing.join(", "));

    // 3. Create sequences + tables
    const existingDevSeqs = await getExistingSequences(dev);

    for (const tableName of sortedMissing) {
      console.log(`\n=== Creating table: ${tableName}`);

      // Create sequences first
      const seqs = await getSequencesForTable(prod, tableName);
      for (const seq of seqs) {
        if (!existingDevSeqs.has(seq.seq_name)) {
          const props = await getSequenceProperties(prod, seq.seq_name);
          if (props) {
            const cycle = props.cycle_option === "YES" ? "CYCLE" : "NO CYCLE";
            const seqSql = `CREATE SEQUENCE IF NOT EXISTS "public".${escapeIdentifier(seq.seq_name)}
              START ${props.start_value}
              MINVALUE ${props.minimum_value}
              MAXVALUE ${props.maximum_value}
              INCREMENT ${props.increment}
              ${cycle}`;
            console.log(`  Creating sequence: ${seq.seq_name}`);
            await dev.query(seqSql);
            existingDevSeqs.add(seq.seq_name);
          }
        }
      }

      // Create the table
      const createSql = await buildCreateTableSql(prod, tableName);
      if (!createSql) {
        console.log("  (empty table definition, skipping)");
        continue;
      }
      console.log(`  SQL:\n${createSql}`);
      await dev.query(createSql);

      // Create indexes
      const indexes = await getIndexesForTable(prod, tableName);
      for (const idx of indexes) {
        const idxSql = idx.indexdef
          .replace(/^CREATE INDEX /, "CREATE INDEX IF NOT EXISTS ")
          .replace(/^CREATE UNIQUE INDEX /, "CREATE UNIQUE INDEX IF NOT EXISTS ");
        console.log(`  Creating index: ${idx.indexname}`);
        try {
          await dev.query(idxSql);
        } catch (e) {
          console.warn(`  Warning: index creation failed (${e.message}), continuing...`);
        }
      }
    }

    // 4. Copy data for all newly created tables
    console.log("\n\n=== Copying data for newly created tables ===");
    for (const tableName of sortedMissing) {
      console.log(`\n==> Copying data: ${tableName}`);
      try {
        await copyTableData(prod, dev, tableName);
      } catch (e) {
        console.error(`  Error copying ${tableName}: ${e.message}`);
      }
    }

    console.log("\n✅ All missing tables created and populated in dev.");
  } finally {
    await prod.end();
    await dev.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
