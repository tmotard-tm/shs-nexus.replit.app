// G8 — env drift check. MUST be the first import in this file. The module
// auto-fires assertProdDatabaseHost() on load, so by importing it before any
// DB-touching module (./storage, ./routes, etc.) we guarantee the prod-host
// assertion runs before any database connection can be opened.
import { assertProdDatabaseHost } from "./guardrails/g8-env-drift-check";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { elevenLabsWebhookHandler } from "./fleet-scope-routes";
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

// ElevenLabs webhook routes must be registered BEFORE global express.json() so that
// express.raw() can capture the original bytes for HMAC-SHA256 verification.
// Without this, the global JSON parser consumes the request body stream first
// and the HMAC computed over req.body won't match the signed payload bytes.
// FS_ELEVENLABS_WEBHOOK_SECRET (Replit Secret) enables signature verification.
if (!process.env.FS_ELEVENLABS_WEBHOOK_SECRET) {
  console.warn("[ElevenLabs] WARNING: FS_ELEVENLABS_WEBHOOK_SECRET not set — signature verification DISABLED");
}
// Canonical URL (what ElevenLabs should call):
app.post("/api/elevenlabs/webhook", express.raw({ type: "application/json" }), elevenLabsWebhookHandler);
// Backwards-compat alias for tooling that already uses the /api/fs prefix:
app.post("/api/fs/elevenlabs/webhook", express.raw({ type: "application/json" }), elevenLabsWebhookHandler);

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
    console.error("❌ Failed to initialize Snowflake service:", error);
    log(`⚠️ Snowflake initialization failed: ${error.message}`);
    log("⚠️ Snowflake integration will be unavailable");
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

(async () => {
  // Patch stored role permissions — fill in any keys added since the record was created
  // Must run before routes are registered so the fix is live immediately
  await patchStoredRolePermissions();

  const server = await registerRoutes(app);

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

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
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
  });
})();
