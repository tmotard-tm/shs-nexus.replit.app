import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { storage } from "./storage";
import { EMBEDDED_TEMPLATES } from "../shared/templates-embedded";
import { TemplateLoader } from "../shared/template-loader";
import type { InsertTemplateWithId } from "../shared/schema";

const app = express();

// Trust proxy configuration for proper IP detection behind proxies/load balancers
// This ensures rate limiting and security features work correctly in production
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

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

(async () => {
  const server = await registerRoutes(app);

  // Seed templates during startup
  await seedTemplatesOnStartup();

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

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
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
  });
})();
