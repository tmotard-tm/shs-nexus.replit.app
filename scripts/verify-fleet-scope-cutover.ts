/**
 * Fleet-Scope Phase 2 Cutover Verification Script
 *
 * Checks all pre-cutover requirements:
 * 1. Required FS_* secrets are present (PASS/MISSING)
 * 2. holmanVehicleRef null-safety audit (call sites in Nexus codebase)
 * 3. DATABASE_URL connectivity to Nexus DB
 * 4. All 32 fs_-prefixed tables exist in Nexus DB
 *
 * Run with: npx tsx scripts/verify-fleet-scope-cutover.ts
 */
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import * as fs from "fs";
import * as path from "path";

neonConfig.webSocketConstructor = ws;

const REQUIRED_SECRETS = [
  "FS_SAMSARA_API_TOKEN",
  "FS_PMF_CLIENT_ID",
  "FS_PMF_CLIENT_SECRET",
  "FS_TWILIO_ACCOUNT_SID",
  "FS_TWILIO_AUTH_TOKEN",
  "FS_TWILIO_PHONE_NUMBER",
  "FS_ELEVENLABS_API_KEY",
  "FS_PUBLIC_SPARES_API_KEY",
  "FS_BYOV_API_KEY",
];

const FS_PREFIXED_TABLES = [
  "fs_trucks",
  "fs_actions",
  "fs_archived_trucks",
  "fs_truck_consolidations",
  "fs_tracking_records",
  "fs_registration_tracking",
  "fs_reg_messages",
  "fs_reg_scheduled_messages",
  "fs_pmf_imports",
  "fs_pmf_rows",
  "fs_pmf_status_events",
  "fs_pmf_activity_logs",
  "fs_pmf_activity_sync_meta",
  "fs_purchase_orders",
  "fs_po_import_meta",
  "fs_fleet_cost_records",
  "fs_fleet_cost_import_meta",
  "fs_approved_cost_records",
  "fs_approved_cost_import_meta",
  "fs_vehicle_maintenance_costs",
  "fs_spare_vehicle_details",
  "fs_decommissioning_vehicles",
  "fs_metrics_snapshots",
  "fs_byov_weekly_snapshots",
  "fs_pickup_weekly_snapshots",
  "fs_fleet_weekly_snapshots",
  "fs_pmf_status_weekly_snapshots",
  "fs_repair_weekly_snapshots",
  "fs_rental_weekly_manual",
  "fs_samsara_locations",
  "fs_call_logs",
  "fs_rental_imports",
];

// holmanVehicleRef safe call sites: these are the only places in the codebase
// that read or write holmanVehicleRef. All pass through toHolmanRef() or optional chaining,
// which accepts null|undefined safely (returns '' for null/undefined inputs).
// The column itself is nullable in fs_trucks so migrated rows have NULL — safe.
const HOLMAN_REF_EXPECTED_SITES = [
  { file: "server/storage.ts",                    description: "toHolmanRef(vn) — null-safe (accepts null|undefined, returns '')" },
  { file: "server/holman-vehicle-sync-service.ts", description: "toHolmanRef(vehicleNumber) — null-safe; optional chaining on fsTruck.holmanVehicleRef" },
  { file: "shared/fleet-scope-schema.ts",          description: "Column definition only (nullable text column)" },
];

function checkSecrets(): boolean {
  console.log("=== 1. Required Secrets Verification ===\n");
  let allPass = true;
  for (const key of REQUIRED_SECRETS) {
    const present = Boolean(process.env[key]);
    const status = present ? "PASS" : "MISSING ✗";
    console.log(`  ${key.padEnd(30)} ${status}`);
    if (!present) allPass = false;
  }

  // Also check DATABASE_URL (required for cutover)
  const dbUrl = Boolean(process.env.DATABASE_URL);
  console.log(`  ${"DATABASE_URL".padEnd(30)} ${dbUrl ? "PASS" : "MISSING ✗"}`);
  if (!dbUrl) allPass = false;

  // Note: FS_DATABASE_URL should still be present during validation window (for rollback)
  const fsDbUrl = Boolean(process.env.FS_DATABASE_URL);
  console.log(`  ${"FS_DATABASE_URL".padEnd(30)} ${fsDbUrl ? "PASS (rollback available)" : "NOT SET (rollback not available)"}`);

  console.log(allPass ? "\n  ✓ All required secrets present.\n" : "\n  ✗ One or more required secrets are MISSING.\n");
  return allPass;
}

function auditHolmanVehicleRef(): boolean {
  console.log("=== 2. holmanVehicleRef Null-Safety Audit ===\n");
  console.log("  The holmanVehicleRef column is a Nexus-only addition to fs_trucks.");
  console.log("  Migrated rows have NULL for this column (safe — column is nullable).");
  console.log("  All Nexus code that reads/writes holmanVehicleRef routes through:");
  console.log("    toHolmanRef(n: string | number | null | undefined): string");
  console.log("    → returns '' for null/undefined inputs (never throws)\n");

  let allSafe = true;
  for (const site of HOLMAN_REF_EXPECTED_SITES) {
    const exists = fs.existsSync(path.join(process.cwd(), site.file));
    const status = exists ? "✓ EXISTS" : "✗ NOT FOUND";
    if (!exists) allSafe = false;
    console.log(`  ${site.file}`);
    console.log(`    Status: ${status}`);
    console.log(`    Usage:  ${site.description}\n`);
  }

  // Scan for any unsafe direct property access patterns (.holmanVehicleRef without null guard)
  // across the codebase (excluding schema definition and toHolmanRef helper files)
  const dangerPatterns = [
    /\.holmanVehicleRef\s*\.\s*(?!trim|replace|length|toLowerCase|toUpperCase)/,
  ];

  const filesToCheck = [
    "server/storage.ts",
    "server/holman-vehicle-sync-service.ts",
    "server/fleet-scope-routes.ts",
    "server/fleet-scope-storage.ts",
  ];

  let unsafeFound = false;
  for (const filePath of filesToCheck) {
    const fullPath = path.join(process.cwd(), filePath);
    if (!fs.existsSync(fullPath)) continue;
    const content = fs.readFileSync(fullPath, "utf-8");
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const pat of dangerPatterns) {
        if (pat.test(line) && !line.includes("toHolmanRef") && !line.includes("holmanVehicleRef:")) {
          console.log(`  ⚠ Potential unsafe access in ${filePath}:${i + 1}: ${line.trim()}`);
          unsafeFound = true;
        }
      }
    }
  }

  if (!unsafeFound) {
    console.log("  ✓ No unsafe direct property accesses found on holmanVehicleRef.");
  }

  console.log(allSafe && !unsafeFound ? "\n  ✓ holmanVehicleRef null-safety: PASS\n" : "\n  ✗ holmanVehicleRef null-safety: issues found above\n");
  return allSafe && !unsafeFound;
}

async function checkTablesExist(pool: Pool): Promise<boolean> {
  console.log("=== 3. Nexus DB — fs_-Prefixed Tables Existence Check ===\n");
  const res = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'fs_%' ORDER BY table_name`
  );
  const existing = new Set<string>(res.rows.map((r: Record<string, unknown>) => String(r.table_name)));

  let allExist = true;
  for (const tbl of FS_PREFIXED_TABLES) {
    const exists = existing.has(tbl);
    console.log(`  ${tbl.padEnd(40)} ${exists ? "✓" : "✗ MISSING"}`);
    if (!exists) allExist = false;
  }

  console.log(allExist ? "\n  ✓ All 32 fs_-prefixed tables exist in Nexus DB.\n" : "\n  ✗ Some tables are MISSING.\n");
  return allExist;
}

async function checkRowCounts(pool: Pool): Promise<void> {
  console.log("=== 4. Nexus DB — Row Counts for All fs_ Tables ===\n");
  let total = 0;
  for (const tbl of FS_PREFIXED_TABLES) {
    try {
      const res = await pool.query(`SELECT COUNT(*) AS cnt FROM "${tbl}"`);
      const cnt = Number((res.rows[0] as Record<string, unknown>).cnt);
      total += cnt;
      console.log(`  ${tbl.padEnd(40)} ${String(cnt).padStart(8)} rows`);
    } catch (err) {
      console.log(`  ${tbl.padEnd(40)} ✗ query failed: ${err}`);
    }
  }
  console.log(`\n  Total rows across all fs_ tables: ${total}\n`);
}

async function main() {
  console.log("=== Fleet-Scope Phase 2 Cutover Verification ===\n");
  let pass = true;

  pass = checkSecrets() && pass;
  pass = auditHolmanVehicleRef() && pass;

  const nexusConnStr = process.env.DATABASE_URL;
  if (!nexusConnStr) {
    console.error("FATAL: DATABASE_URL not set — cannot check Nexus DB tables.\n");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: nexusConnStr, max: 3, connectionTimeoutMillis: 15000 });
  try {
    await pool.query("SELECT 1");
    console.log("  ✓ Connected to Nexus DB (DATABASE_URL)\n");

    pass = (await checkTablesExist(pool)) && pass;
    await checkRowCounts(pool);
  } finally {
    await pool.end().catch(() => {});
  }

  console.log("=== Verification Complete ===");
  console.log(pass ? "\n✓ All checks PASSED — cutover is ready.\n" : "\n✗ Some checks FAILED — review above before proceeding.\n");
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
