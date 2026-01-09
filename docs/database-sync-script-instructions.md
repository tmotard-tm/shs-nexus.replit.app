# Agent Instructions: Production-to-Development Database Sync Script

## Objective

Review and compare the production and development database structures, then create a script to safely copy production data to development, following the established pattern in `scripts/refreshDevFromProd.js`.

---

## Prerequisites

### Environment Variables Required
- `PROD_DATABASE_URL` - PostgreSQL connection string to production database
- `DEV_DATABASE_URL` - PostgreSQL connection string to development database

### Dependencies
- Node.js with `pg` package installed
- Both databases must be accessible from the execution environment

### Safety Checks Before Starting
- Confirm you have read-only access to production
- Ensure development database can be safely truncated
- Consider creating a backup of development data if needed

---

## Phase 1: Schema Comparison

**Task:** Query and document both database schemas, then identify differences.

### Queries to Run on Both Databases

```sql
-- Get all tables in both databases
SELECT table_schema, table_name 
FROM information_schema.tables 
WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
ORDER BY table_schema, table_name;

-- Get columns for each table
SELECT table_schema, table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
ORDER BY table_schema, table_name, ordinal_position;

-- Get foreign key relationships (critical for ordering)
SELECT
    tc.table_schema, tc.table_name, kcu.column_name,
    ccu.table_schema AS foreign_table_schema,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY';
```

### Deliverable
A markdown document listing:
- All tables in production vs development
- Schema drift (missing tables, columns, type mismatches)
- Foreign key dependencies (determines copy order)

---

## Phase 2: Determine Table Copy Order

**Critical:** Tables must be copied in dependency order to avoid foreign key constraint violations.

### Rules
1. Parent tables (referenced by foreign keys) must be copied BEFORE child tables
2. Tables with no foreign keys can be copied in any order
3. Use `TRUNCATE ... CASCADE` when clearing to handle existing constraints

---

## Phase 3: Script Implementation

**Reference Pattern:** Follow `scripts/refreshDevFromProd.js` structure exactly.

### Required Script Features

#### 1. Configuration Section
```javascript
const TABLES = [
  // List tables in dependency order (parents first)
  { schema: "public", name: "parent_table" },
  { schema: "public", name: "child_table" },
  // ... all tables
];

const CHUNK_SIZE = 500; // Batch size for inserts
```

#### 2. Connection Management
```javascript
const { Client } = require("pg");

const prod = new Client({ connectionString: process.env.PROD_DATABASE_URL });
const dev = new Client({ connectionString: process.env.DEV_DATABASE_URL });

await prod.connect();
await dev.connect();
```

#### 3. Core Copy Function Requirements
- Query column names from `information_schema.columns` (parameterized)
- Use quoted identifiers: `"schema"."table"` and `"column"`
- Truncate target table with `RESTART IDENTITY CASCADE`
- Insert in chunks with parameterized values (`$1`, `$2`, etc.)
- Log progress for each table

#### 4. Transaction Wrapping
```javascript
try {
  await dev.query("BEGIN");
  
  for (const table of TABLES) {
    await copyTable(prod, dev, table);
  }
  
  await dev.query("COMMIT");
  console.log("Dev database successfully refreshed from prod.");
} catch (err) {
  console.error("Error during refresh, rolling back:", err);
  await dev.query("ROLLBACK");
} finally {
  await prod.end();
  await dev.end();
}
```

#### 5. Copy Table Function Template
```javascript
async function copyTable(prod, dev, { schema, name }) {
  const fullName = `"${schema}"."${name}"`;
  console.log(`Copying ${fullName}`);

  // Get ordered column list from prod (parameterized query)
  const colsRes = await prod.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2
     ORDER BY ordinal_position`,
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

  // Clear dev table
  await dev.query(`TRUNCATE TABLE ${fullName} RESTART IDENTITY CASCADE`);

  if (rows.length === 0) {
    console.log("  Nothing to insert");
    return;
  }

  // Insert data into dev in chunks
  const CHUNK_SIZE = 500;
  for (let start = 0; start < rows.length; start += CHUNK_SIZE) {
    const chunk = rows.slice(start, start + CHUNK_SIZE);
    const values = [];
    const valuePlaceholders = chunk
      .map((row, rowIndex) => {
        const placeholders = columns.map((_, colIndex) => {
          const paramIndex = rowIndex * columns.length + colIndex + 1;
          return `$${paramIndex}`;
        });
        columns.forEach((col) => values.push(row[col]));
        return `(${placeholders.join(", ")})`;
      })
      .join(", ");

    const sql = `INSERT INTO ${fullName} (${colList}) VALUES ${valuePlaceholders}`;
    await dev.query(sql, values);

    console.log(`  Inserted ${Math.min(start + chunk.length, rows.length)}/${rows.length}`);
  }
}
```

---

## Phase 4: Security Requirements

**MUST follow these rules:**

### 1. Parameterized Values
All data values in INSERT statements must use parameterized queries (`$1, $2, ...`)

### 2. Identifier Quoting
Table names, schema names, and column names must be double-quoted to prevent injection and handle special characters

### 3. No User Input
Script only uses hardcoded table list and database metadata - never external input

### 4. Credentials
Never hardcode connection strings; always use environment variables

### 5. Important Note on Identifiers
Table/column names cannot be parameterized in PostgreSQL - string interpolation with proper quoting is acceptable for identifiers from trusted sources (hardcoded list or `information_schema`)

---

## Phase 5: Testing & Validation

### Acceptance Criteria

- [ ] Script connects to both databases using environment variables
- [ ] All tables listed in correct dependency order
- [ ] Truncation uses `CASCADE` to handle constraints
- [ ] Inserts use parameterized values with chunked batching
- [ ] Transaction wraps all dev writes with rollback on error
- [ ] Row counts logged match source data
- [ ] Script handles empty tables gracefully
- [ ] Clean exit with connection closure

### Test Procedure
1. Run against development database only
2. Verify row counts match between prod and dev for each table
3. Confirm foreign key relationships are intact
4. Check that script is idempotent (can run multiple times safely)

---

## Running the Script

```bash
# Set environment variables
export PROD_DATABASE_URL="postgresql://user:pass@prod-host:5432/dbname"
export DEV_DATABASE_URL="postgresql://user:pass@dev-host:5432/dbname"

# Run the script
node scripts/refreshDevFromProd.js
```

---

## Troubleshooting

### Foreign Key Violations
If you get foreign key constraint errors, reorder the `TABLES` array so parent tables come before child tables.

### Memory Issues with Large Tables
Reduce `CHUNK_SIZE` if you encounter memory issues with very large tables.

### Connection Timeouts
For very large datasets, consider adding connection timeout settings to the Client configuration.

---

## Reference Implementation

See `scripts/refreshDevFromProd.js` in this repository for a complete working example.
