// G8 — env drift check. MUST be the first import in this file. The module
// auto-fires assertProdDatabaseHost() on load, so by importing it before any
// DB-touching module (./storage, ./routes, etc.) we guarantee the prod-host
// assertion runs before any database connection can be opened.
import { assertProdDatabaseHost } from "./guardrails/g8-env-drift-check";
import express, { type Request, Response, NextFunction } from "express";
import compression from "compression";
import { createServer } from "http";
import path from "path";
import fs from "fs";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { storage } from "./storage";
import { createTestUsers } from "./create-test-users";
import { EMBEDDED_TEMPLATES } from "../shared/templates-embedded";
import { TemplateLoader } from "../shared/template-loader";
import type { InsertTemplateWithId } from "../shared/schema";

// The @neondatabase/serverless driver has a bug in v0.10.x where it throws an uncaught
// TypeError ("Cannot set property message of #<ErrorEvent> which has only a getter")
// when a WebSocket connection to the DB drops. This crashes the entire Node.js process.
// Until a fixed version is available, intercept this specific error and keep the server alive.
//
// NeonDB serverless also forcibly closes connections when its compute scales/suspends,
// reporting "terminating connection due to administrator command". This is normal NeonDB
// housekeeping behaviour — the pool reconnects automatically on the next request.
process.on('uncaughtException', (err: Error) => {
  if (err instanceof TypeError && err.message.includes('Cannot set property message')) {
    console.error('[NeonDB] Absorbed non-fatal WebSocket connection error:', err.message);
    return;
  }
  if (err.message?.includes('terminating connection due to administrator command')) {
    console.error('[NeonDB] Absorbed connection termination (compute scaling/idle timeout) — pool will reconnect automatically');
    return;
  }
  // The Replit auth-persistence integration (javascript_auth_all_persistance) is installed
  // but not used — this app manages sessions via PostgreSQL (server/storage.ts). Any SQLite
  // initialisation errors from the Replit platform layer are non-fatal and absorbed here.
  if (err.message?.includes('SQLite') || err.message?.includes('sqlite')) {
    console.warn('[Auth] Absorbed non-fatal SQLite persistence error (Replit platform layer, not app code):', err.message);
    return;
  }
  console.error('[FATAL] Uncaught exception — exiting:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  console.error('[WARN] Unhandled promise rejection:', reason);
});

const app = express();

// Trust proxy configuration for proper IP detection behind proxies/load balancers
// This ensures rate limiting and security features work correctly in production
app.set('trust proxy', 1);

// Gzip JSON/text responses — heavy list endpoints (e.g. the ~500KB Today's
// Queue payload) shrink ~10x. No SSE in this server, so the default filter is
// safe; WebSocket upgrades bypass Express middleware entirely.
app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: false, limit: '50mb' }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

/**
 * Seed database with embedded templates on startup
 */
async function seedTemplatesOnStartup() {
  try {
    log("🌱 Checking template database seeding...");
    
    // Check how many templates exist in database
    const existingTemplates = await storage.getTemplatesByDepartment("FLEET"); // Check one department
    const allExistingTemplates: string[] = [];
    
    // Get all existing template IDs from all departments
    for (const dept of ["FLEET", "INVENTORY", "ASSETS", "NTAO"]) {
      const deptTemplates = await storage.getTemplatesByDepartment(dept);
      allExistingTemplates.push(...deptTemplates.map(t => t.id));
    }

    const embeddedTemplateCount = Object.keys(EMBEDDED_TEMPLATES).length;
    log(`Found ${allExistingTemplates.length} existing templates in database, ${embeddedTemplateCount} embedded templates available`);

    // Only seed if database is empty or has significantly fewer templates
    if (allExistingTemplates.length === 0 || allExistingTemplates.length < embeddedTemplateCount * 0.8) {
      log("🔄 Seeding database with embedded templates...");
      let seededCount = 0;
      let updatedCount = 0;
      
      for (const [templateId, template] of Object.entries(EMBEDDED_TEMPLATES)) {
        try {
          // Convert to InsertTemplateWithId format for seeding
          const insertTemplate: InsertTemplateWithId = {
            id: template.id,
            department: template.department,
            workflowType: template.workflowType,
            version: template.version,
            name: template.name,
            content: template.content, // template.content is already a JSON string
            isActive: template.isActive
          };

          // Upsert template (insert or update if exists)
          const result = await storage.upsertTemplate(insertTemplate);
          
          if (allExistingTemplates.includes(templateId)) {
            updatedCount++;
          } else {
            seededCount++;
          }
        } catch (error) {
          console.error(`Failed to seed template ${templateId}:`, error);
        }
      }

      log(`✅ Template seeding completed: ${seededCount} new templates seeded, ${updatedCount} existing templates updated`);
    } else {
      log("✅ Database already contains sufficient templates, skipping seeding");
    }

    // Initialize TemplateLoader with storage
    const templateLoader = TemplateLoader.getInstance();
    templateLoader.setStorage(storage);
    log("✅ TemplateLoader initialized with database storage");

  } catch (error) {
    console.error("❌ Template seeding failed:", error);
    // Don't throw - allow server to start even if seeding fails
    log("⚠️ Server starting without template seeding. Templates will fallback to embedded data.");
    
    // Still initialize TemplateLoader with storage for fallback
    try {
      const templateLoader = TemplateLoader.getInstance();
      templateLoader.setStorage(storage);
    } catch (loaderError) {
      console.error("Failed to initialize TemplateLoader:", loaderError);
    }
  }
}

/**
 * Initialize Snowflake service with environment variables
 * NOTE: In production, we ONLY use environment variables.
 * The file-based key loading is ONLY for development.
 */
async function initializeSnowflake() {
  const isProduction = process.env.NODE_ENV === 'production';
  
  try {
    const { initializeSnowflakeService } = await import("./snowflake-service");
    
    const account = process.env.SNOWFLAKE_ACCOUNT;
    const username = process.env.SNOWFLAKE_USER;
    let privateKey = process.env.SNOWFLAKE_PRIVATE_KEY;
    
    // Log configuration status (without exposing sensitive values)
    log(`🔍 Snowflake config check: account=${account ? 'set' : 'missing'}, user=${username ? 'set' : 'missing'}, key=${privateKey ? `set (${privateKey.length} chars)` : 'missing'}, env=${isProduction ? 'production' : 'development'}`);
    
    // In development ONLY, try to read from file (file takes precedence)
    // We dynamically import a separate module to avoid bundler issues
    if (!isProduction) {
      try {
        const { loadKeyFromFile } = await import("./snowflake-key-loader");
        const fileKey = loadKeyFromFile();
        if (fileKey) {
          privateKey = fileKey;
          log("📄 Using Snowflake private key from file");
        } else {
          log("📝 Key file not found, using environment variable");
        }
      } catch (fileError: any) {
        log(`📝 File-based key loading skipped: ${fileError.message}`);
      }
    } else {
      log("🚀 Production mode: Using environment variable for private key");
      // Log first few chars of key to verify it's loaded (safe - just shows format)
      if (privateKey) {
        log(`📋 Key format check: starts with "${privateKey.substring(0, 30)}..."`);
      }
    }
    
    if (!account || !username || !privateKey) {
      const missing = [];
      if (!account) missing.push('SNOWFLAKE_ACCOUNT');
      if (!username) missing.push('SNOWFLAKE_USER');
      if (!privateKey) missing.push('SNOWFLAKE_PRIVATE_KEY');
      log(`⚠️ Snowflake credentials not configured. Missing: ${missing.join(', ')}. Integration will be unavailable.`);
      return;
    }
    
    log("🔧 Attempting to initialize Snowflake service...");
    initializeSnowflakeService({
      account,
      username,
      privateKey,
      database: process.env.SNOWFLAKE_DATABASE,
      schema: process.env.SNOWFLAKE_SCHEMA,
      warehouse: process.env.SNOWFLAKE_WAREHOUSE,
      role: process.env.SNOWFLAKE_ROLE,
    });
    
    log("✅ Snowflake service initialized successfully");
  } catch (error: any) {
    console.error("[SNOWFLAKE_INIT_FAILED] ❌ Failed to initialize Snowflake service:", error.message);
    console.error("[SNOWFLAKE_INIT_FAILED] Full error:", error);
    log(`⚠️ Snowflake initialization failed: ${error.message}`);
    log("⚠️ Snowflake integration will be unavailable. Use POST /api/snowflake/reinitialize to retry without a full redeploy.");
  }
}

/**
 * On every server start, bring every stored role record up to date with the
 * current default permission schema.
 *
 * Scope: ALL roles — built-in (developer, admin, agent) AND any custom roles
 * created by admins.  Custom roles use DEFAULT_AGENT_PERMISSIONS as their
 * baseline (see getServerDefaultPermissions), so any permission key that was
 * added to the agent defaults after the custom role was saved (e.g.
 * `byovBulkUpload`) will be backfilled here with the agent default value
 * (false).  Admins can then enable the permission for specific custom roles
 * via the Role Permissions page.
 */
async function patchStoredRolePermissions() {
  try {
    const { deepMergePermissions, getServerDefaultPermissions } = await import('./permission-utils');

    const builtInRoles = new Set(['developer', 'admin', 'agent']);
    const allRecords = await storage.getAllRolePermissions();
    let patchedBuiltIn = 0;
    let patchedCustom = 0;
    for (const record of allRecords) {
      const defaults = getServerDefaultPermissions(record.role);
      const merged = deepMergePermissions(defaults, record.permissions);
      if (JSON.stringify(merged) !== JSON.stringify(record.permissions)) {
        await storage.upsertRolePermission(record.role, merged);
        const isBuiltIn = builtInRoles.has(record.role);
        const roleType = isBuiltIn ? 'built-in' : 'custom';
        log(`✅ Patched stored permissions for ${roleType} role '${record.role}' with missing keys`);
        if (isBuiltIn) { patchedBuiltIn++; } else { patchedCustom++; }
      }
    }
    if (patchedBuiltIn > 0 || patchedCustom > 0) {
      log(`✅ Permission patch summary: ${patchedBuiltIn} built-in role(s), ${patchedCustom} custom role(s) updated`);
    }
  } catch (error) {
    console.error("⚠️ Failed to patch stored role permissions:", error);
  }
}

/**
 * Heavy startup bootstrap — runs AFTER the HTTP port is open so the autoscale
 * health-check probe (GET / must return 200 within ~60s) can never be blocked
 * by slow/flaky database or Snowflake work. A deploy once failed with
 * "the required port was never opened, expected port 5000" because all of this
 * was awaited BEFORE server.listen(): a transient Neon WebSocket hiccup stalled
 * seedTemplatesOnStartup() past the probe window and the promote was rejected.
 *
 * Everything here is idempotent and individually wrapped in try/catch, and route
 * handlers read their data from storage per-request, so running it a moment after
 * the server starts listening is safe.
 */
async function runStartupBootstrap() {
  // ONE-TIME DATA PATCH — 088279 VIN duplicate fix
  // 088279 (VIN 1G1ZD5ST1RF136317) registered in TPMS and WMS but NOT in Holman.
  // 088277 is the canonical vehicle. This patch marks the 088279 audit row as
  // 'vin_duplicate' and corrects the holman_success flag (was mistakenly true).
  // Guard: only runs if blocked_source IS NULL — permanently a no-op after first run.
  try {
    const { db } = await import("./db");
    const { byovCreationAudit } = await import("@shared/schema");
    const { eq, and, isNull } = await import("drizzle-orm");
    const rows = await db
      .select({ id: byovCreationAudit.id })
      .from(byovCreationAudit)
      .where(
        and(
          eq(byovCreationAudit.vehicleNumber, "088279"),
          isNull(byovCreationAudit.blockedSource),
        ),
      )
      .limit(1);
    if (rows.length > 0) {
      await db
        .update(byovCreationAudit)
        .set({
          blockedSource: "vin_duplicate",
          holmanSuccess: false,
          holmanError:
            "VIN duplicate of 088277 — Marked by admin. Remove it from: TPMS, WMS. Note: vehicle did NOT register in Holman despite holman_success=true on original submission.",
        })
        .where(eq(byovCreationAudit.id, rows[0].id));
      log("✅ [Patch] 088279 audit row marked as vin_duplicate (TPMS+WMS only, not Holman)");
    }
  } catch (patchErr: any) {
    console.error("⚠️ [Patch] 088279 vin_duplicate fix failed:", patchErr.message);
  }

  // Patch stored role permissions — fill in any keys added since the record was created
  await patchStoredRolePermissions();

  // Seed templates during startup
  await seedTemplatesOnStartup();

  // Ensure test users exist (dev/staging only — no-ops in production)
  if (process.env.NODE_ENV !== 'production') {
    try {
      await createTestUsers();
    } catch (err: any) {
      console.error("⚠️ Test user seeding failed:", err.message);
    }
  }

  // Seed communication hub default templates (creates missing ones)
  try {
    const { seedDefaultTemplates } = await import("./communication-service");
    const seeded = await seedDefaultTemplates();
    if (seeded > 0) {
      log(`✅ Communication Hub: seeded ${seeded} missing templates`);
    }
  } catch (error) {
    console.error("⚠️ Communication Hub template seeding failed:", error);
  }

  // Initialize Snowflake service
  await initializeSnowflake();

  // Start the sync scheduler for daily 5am EST syncs
  try {
    const { startSyncScheduler } = await import("./sync-scheduler");
    startSyncScheduler();
    log("✅ Sync scheduler started (daily at 5am EST)");
  } catch (error) {
    console.error("❌ Failed to start sync scheduler:", error);
  }

  // Master Fleet Communications Module (Task #524) — ensure the fs_comms_*
  // tables exist and start the in-process send-queue drainer. Runs post-listen
  // (autoscale listen-first) so a transient DB hiccup can't stall boot. The
  // durable cadence is a Scheduled Deployment (server/run-comms-queue.ts /
  // run-comms-sync.ts); this in-process drainer is a best-effort warm path.
  try {
    const { initCommsSchema } = await import("./fleet-comms/schema-init");
    await initCommsSchema();
    const { startInProcessQueueDrain } = await import("./fleet-comms/outbound");
    startInProcessQueueDrain();
    log("✅ Fleet Communications: schema ensured + in-process queue drainer started");
  } catch (error: any) {
    console.error("⚠️ Fleet Communications startup init failed:", error?.message || error);
  }

  // Truck Maintenance SMS + 4-hour booking workflow (Task #664) — ensure the
  // fs_truck_maintenance_* tables exist and start the best-effort in-process
  // secondary sweep. Post-listen for the same autoscale reason as the block
  // above. The durable cadence is the cron route
  // (POST /api/fs/truck-maintenance/cron/sweep, server/run-truck-maintenance.ts);
  // in-process timers alone do not reliably fire on autoscale.
  try {
    const { initTruckMaintenanceSchema } = await import("./truck-maintenance/schema-init");
    await initTruckMaintenanceSchema();
    const { startInProcessMaintenanceSweep } = await import("./truck-maintenance/engine");
    startInProcessMaintenanceSweep();
    log("✅ Truck Maintenance: schema ensured + in-process secondary sweep started");
  } catch (error: any) {
    console.error("⚠️ Truck Maintenance startup init failed:", error?.message || error);
  }

  // LUCA → FleetScope write-back (Phase 3 of the LUCA plan) — polls LIVHR's
  // escalation outbox and lands LUCA's shop-call outcomes on fs_trucks so
  // humans follow up on the same record LUCA acted on. Gated by
  // LUCA_WRITEBACK_APPLY (default OFF = log-only). The durable cadence is a
  // Scheduled Deployment (server/run-luca-writeback.ts); this in-process
  // poller is a best-effort warm path.
  try {
    const { startInProcessLucaWriteback } = await import("./luca-writeback/worker");
    const armed = startInProcessLucaWriteback();
    log(
      armed
        ? "✅ LUCA write-back: in-process poller armed (secondary; Scheduled Deployment is primary)"
        : "ℹ️ LUCA write-back: not configured — in-process poller idle",
    );
  } catch (error: any) {
    console.error("⚠️ LUCA write-back startup init failed:", error?.message || error);
  }

  // Start the BYOV assignment drift scheduler (nightly at 2am EST by default)
  try {
    const { startByovDriftScheduler } = await import("./byov-verification-service");
    startByovDriftScheduler();
    const checkHour = process.env.BYOV_DRIFT_CHECK_HOUR ?? "2";
    log(`✅ BYOV drift scheduler started (nightly at ${checkHour}:00 EST)`);
  } catch (error) {
    console.error("❌ Failed to start BYOV drift scheduler:", error);
  }

  // Background Holman submission verifier — polls every 90s for pending assign/unassign operations
  // and re-fetches the vehicle from Holman to confirm the change was actually applied
  try {
    const HOLMAN_VERIFY_INTERVAL_MS = 90_000;
    setInterval(async () => {
      try {
        const { holmanSubmissionService } = await import("./holman-submission-service");
        await holmanSubmissionService.pollPendingSubmissions();
      } catch (err: any) {
        console.error("[HolmanVerify] Background poll error:", err.message);
      }
    }, HOLMAN_VERIFY_INTERVAL_MS);
    log("✅ Holman submission verifier started (every 90s)");
  } catch (error) {
    console.error("❌ Failed to start Holman verifier:", error);
  }

  // Auto-sync truck inventory on startup if empty
  try {
    const { getSnowflakeService } = await import("./snowflake-service");
    const snowflakeService = getSnowflakeService();
    
    if (snowflakeService) {
      // Check if truck_inventory table has data by checking latest extract date
      const latestExtract = await storage.getLatestTruckInventoryExtractDate();
      log(`📦 Truck inventory check: latest extract = ${latestExtract || 'none'}`);
      
      if (!latestExtract) {
        log("📦 Truck inventory empty - starting auto-sync from Snowflake...");
        const { SnowflakeSyncService } = await import("./snowflake-sync-service");
        const syncService = new SnowflakeSyncService();
        
        // Run sync in background (don't block server startup)
        syncService.syncTruckInventory().then(result => {
          if (result.success) {
            log(`✅ Truck inventory auto-sync complete: ${result.recordsProcessed} items synced`);
          } else {
            log(`⚠️ Truck inventory auto-sync failed: ${result.errors?.join(', ')}`);
          }
        }).catch(err => {
          console.error("❌ Truck inventory auto-sync error:", err);
        });
      } else {
        log("✅ Truck inventory already populated, skipping auto-sync");
      }
    }
  } catch (error) {
    console.error("⚠️ Truck inventory auto-sync check failed:", error);
  }

  // Auto-sync all-techs on startup to ensure contact info and TPMS data is current
  try {
    const { isSnowflakeConfigured } = await import("./snowflake-service");
    
    if (isSnowflakeConfigured()) {
      log("👥 Running all-techs sync with contact info and TPMS joins...");
      const { getSnowflakeSyncService } = await import("./snowflake-sync-service");
      const syncService = getSnowflakeSyncService();
      
      // Run sync in background (don't block server startup)
      syncService.syncAllTechs('startup').then(result => {
        if (result.success) {
          log(`✅ All-techs startup sync complete: ${result.recordsProcessed} records processed`);
        } else {
          log(`⚠️ All-techs startup sync had errors: ${result.errors?.join(', ')}`);
        }
      }).catch(err => {
        console.error("❌ All-techs startup sync error:", err.message);
      });
    }
  } catch (error) {
    console.error("⚠️ All-techs startup sync check failed:", error);
  }

  // Task #386: sweep stuck inbound MMS rows (status='media_failed') and re-fetch
  // their media from Twilio so dispatchers don't have to click "Retry download"
  // on every row. Runs ~30s after startup and every 15min thereafter, rate-limited
  // to 1 message/sec.
  try {
    const { startMmsSweepScheduler } = await import("./fleet-scope-media-sweep");
    startMmsSweepScheduler();
    log("✅ MMS media-failed sweep scheduler started (startup + every 15min, 1/sec)");
  } catch (error) {
    console.error("❌ Failed to start MMS media-failed sweep scheduler:", error);
  }

  // Backfill model years from VIN for any cached Holman rows that are sitting
  // with a blank/0 year but a decodable VIN (e.g. 088264 → 2026). Idempotent and
  // only touches rows that need correcting.
  try {
    const { holmanVehicleSyncService } = await import("./holman-vehicle-sync-service");
    holmanVehicleSyncService.backfillModelYearsFromVin().then(r => {
      if (r.updated > 0) {
        log(`✅ Model-year VIN backfill: corrected ${r.updated}/${r.scanned} cache rows`);
      }
    }).catch(err => {
      console.error("❌ Model-year VIN backfill error:", err?.message || err);
    });
  } catch (error) {
    console.error("⚠️ Model-year VIN backfill failed to start:", error);
  }

  // Task #221: prime the in-process TPMS snapshot in the background so the
  // first decommissioning batch SMS / rental-enrichment / manager-phone caller
  // doesn't pay the full Snowflake scan latency. Non-blocking: failures are
  // logged but never prevent server start.
  try {
    const { isSnowflakeConfigured } = await import("./snowflake-service");
    if (isSnowflakeConfigured()) {
      const { refreshSnapshot } = await import("./fleet-scope-tpms-snapshot");
      refreshSnapshot('startup').then(r => {
        if (r.ok) {
          log(`✅ TPMS snapshot primed: ${r.count} LDAPs in ${r.durationMs}ms`);
        } else {
          log(`⚠️ TPMS snapshot startup refresh did not load any data`);
        }
      }).catch(err => {
        console.error("❌ TPMS snapshot startup refresh error:", err?.message || err);
      });
    }
  } catch (error) {
    console.error("⚠️ TPMS snapshot startup priming failed:", error);
  }

  // VRM profitability schema-drift canary — runs ONE cheap INFORMATION_SCHEMA
  // pass at startup to verify every column the profitability queries depend on
  // against the live Snowflake views. Surfaces upstream column renames/drops
  // hours before the 01:00 UTC profitability sync, naming ALL drifted columns at
  // once in a loud, greppable log line. Non-blocking: fired without await so it
  // can never delay server start.
  try {
    const { isSnowflakeConfigured } = await import("./snowflake-service");
    if (isSnowflakeConfigured()) {
      const { checkProfitabilitySchema } = await import("./vrm/snowflake-queries");
      checkProfitabilitySchema()
        .then((res) => {
          if (res.errors.length > 0) {
            console.warn(
              `⚠️ [VRM SchemaCanary] Could not verify ${res.errors.length} profitability view(s): ` +
                res.errors.map((e) => `${e.label}: ${e.error}`).join("; "),
            );
          }
          if (res.ok) {
            log(`✅ [VRM SchemaCanary] Profitability schema intact — verified ${res.checkedViews} view(s).`);
          } else {
            console.error(`❌ [VRM SchemaCanary] ${res.summary}`);
          }
        })
        .catch((err) => {
          console.error("⚠️ [VRM SchemaCanary] Schema drift canary failed to run:", err?.message ?? err);
        });
    }
  } catch (error) {
    console.error("⚠️ [VRM SchemaCanary] Schema drift canary failed to start:", error);
  }
}

(async () => {
  // Open the TCP port FIRST — before registerRoutes() runs, before any DB schema
  // init, before Snowflake. The autoscale promote probe only needs port 5000 to
  // be open; deploys were failing with "the required port was never opened,
  // expected port 5000" because registerRoutes() awaits ~27 idempotent DB schema
  // inits (initFleetScopeSchema/initVrmSchema + CREATE TABLE IF NOT EXISTS …) and
  // a transient Neon WebSocket hiccup at boot stalled those past the probe window.
  // We create the http server here, start listening immediately, then register
  // routes onto it (initFsWebSocket attaches to this same server).
  const server = createServer(app);
  const port = parseInt(process.env.PORT || '5000', 10);

  // AWAIT the 'listening' event before registering routes. Awaiting here yields
  // to the event loop so libuv actually binds the TCP socket and fires the
  // callback BEFORE registerRoutes() runs. (Without the await, the immediately
  // following `await registerRoutes()` saturates the loop with DB-init work and
  // the real port bind is postponed until startup finishes — which is exactly
  // the "port never opened" deploy failure we are fixing.)
  await new Promise<void>((resolve) => {
    server.listen({
      port,
      host: "0.0.0.0",
      reusePort: true,
    }, () => {
      log(`serving on port ${port}`);
      resolve();
    });
  });

  // The port is now open, but `/` has NO handler yet: the SPA catch-all is only
  // mounted after `await registerRoutes()` + setupVite()/serveStatic() finish
  // below. A navigation that lands in that window would otherwise get Express's
  // bare "Cannot GET /". In production the early express.static mount further
  // down already serves index.html for `/` immediately, but in development the
  // SPA is served exclusively by Vite's catch-all (mounted only after the slow
  // registerRoutes returns). So, in development only, hold HTML navigations with
  // a tiny auto-refreshing page until the real catch-all is live, then turn into
  // a transparent passthrough (single flag check) once routes are ready.
  let routesReady = false;
  if (app.get("env") === "development") {
    app.use((req, res, next) => {
      if (routesReady) return next();
      const accept = req.headers.accept || "";
      const isHtmlNav =
        req.method === "GET" &&
        !req.path.startsWith("/api") &&
        !req.path.startsWith("/@") &&        // vite client (/@vite, /@react-refresh, /@fs)
        !req.path.startsWith("/src") &&      // vite source modules
        !req.path.startsWith("/node_modules") &&
        accept.includes("text/html");
      if (!isHtmlNav) return next();
      res
        .status(503)
        .type("html")
        .send(
          `<!doctype html><html><head><meta charset="utf-8">` +
            `<meta http-equiv="refresh" content="2"><title>Starting…</title>` +
            `<style>body{font-family:system-ui,sans-serif;margin:0;height:100vh;display:flex;` +
            `align-items:center;justify-content:center;background:#0b0b0c;color:#e5e5e5}</style>` +
            `</head><body><div>Starting the app… this page refreshes automatically.</div></body></html>`,
        );
    });
  }

  // Register routes on the already-listening server. The heavy DB schema init
  // inside here now runs with the port already open, so it can never block the
  // health-check probe. Because the port is already open, a failure in this
  // phase would otherwise leave a "healthy port, unhealthy app" instance that
  // autoscale could promote — so fail-fast (exit 1) if route/static wiring
  // throws, letting the previous good build keep serving.
  // Serve the built frontend EARLY (production only), BEFORE the slow route
  // registration. registerRoutes() mounts many API routers and serveStatic()'s
  // SPA catch-all is only added AFTER it returns; if that takes too long the
  // autoscale health-check on `/` fails and the instance is recycled in a crash
  // loop ("Cannot GET /"). express.static serves index.html for `/` and the
  // hashed assets immediately, and calls next() for unmatched paths (e.g.
  // /api/*), so it does NOT shadow the API routes registered afterward. The SPA
  // catch-all for deep links still goes last via serveStatic(app) below.
  if (app.get("env") !== "development") {
    try {
      const earlyDist = path.resolve(import.meta.dirname, "public");
      if (fs.existsSync(earlyDist)) {
        app.use(express.static(earlyDist));
        log("early static frontend mounted (pre-route-registration)");
      }
    } catch (e) {
      console.warn("[Startup] Early static mount skipped:", e instanceof Error ? e.message : e);
    }
  }

  try {
    await registerRoutes(app, server);

    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      console.error(`[Express] Error handler: ${status} — ${message}`, err.stack || '');
      res.status(status).json({ message });
    });

    // importantly only setup vite in development and after
    // setting up all the other routes so the catch-all route
    // doesn't interfere with the other routes
    if (app.get("env") === "development") {
      await setupVite(app, server);
    } else {
      serveStatic(app);
    }
    // SPA catch-all is now mounted — turn the dev "starting…" holding page (above)
    // into a transparent passthrough so `/` is served by Vite from here on.
    routesReady = true;
    log("route registration + static wiring complete — `/` and all routes are live");
  } catch (err) {
    console.error("[Startup] FATAL: route/static wiring failed after port open — exiting:", err);
    process.exit(1);
  }

  // Kick off heavy startup bootstrap (permission patch, template seeding,
  // Snowflake init, schedulers) AFTER routes are ready and the port is open so
  // the autoscale health-check probe is never blocked by slow DB/Snowflake work.
  runStartupBootstrap().catch((e: unknown) => {
    console.error("[Startup] Background bootstrap error (non-fatal):", e instanceof Error ? e.message : e);
  });

  // Guardrail G4 — fire post-deploy integrity check non-blocking.
  // Compares current row counts against the latest G2 snapshot in object
  // storage. Fails open (no-baseline / network errors) so it can never
  // block server startup. Output is prefixed `[G4]`.
  if (process.env.NODE_ENV === "production") {
    import("./guardrails/g4-post-deploy-integrity")
      .then((m) => m.runIntegrityCheck?.().catch((e: unknown) => {
        console.warn("[G4] Integrity check threw (non-fatal):", e instanceof Error ? e.message : e);
      }))
      .catch((e: unknown) => {
        console.warn("[G4] Integrity module failed to load (non-fatal):", e instanceof Error ? e.message : e);
      });
  }
})();
