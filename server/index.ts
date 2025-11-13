import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { storage } from "./storage";
import { EMBEDDED_TEMPLATES } from "../shared/templates-embedded";
import { TemplateLoader } from "../shared/template-loader";
import type { InsertTemplate } from "../shared/schema";

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
          // Convert to InsertTemplate format
          const insertTemplate: InsertTemplate = {
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
 */
async function initializeSnowflake() {
  try {
    const { initializeSnowflakeService } = await import("./snowflake-service");
    
    const account = process.env.SNOWFLAKE_ACCOUNT;
    const username = process.env.SNOWFLAKE_USER;
    const privateKey = process.env.SNOWFLAKE_PRIVATE_KEY;
    
    if (!account || !username || !privateKey) {
      log("⚠️ Snowflake credentials not configured. Snowflake integration will be unavailable.");
      return;
    }
    
    initializeSnowflakeService({
      account,
      username,
      privateKey,
      database: process.env.SNOWFLAKE_DATABASE,
      schema: process.env.SNOWFLAKE_SCHEMA,
      warehouse: process.env.SNOWFLAKE_WAREHOUSE,
      role: process.env.SNOWFLAKE_ROLE,
    });
    
    log("✅ Snowflake service initialized");
  } catch (error) {
    console.error("❌ Failed to initialize Snowflake service:", error);
    log("⚠️ Snowflake integration will be unavailable");
  }
}

(async () => {
  const server = await registerRoutes(app);

  // Seed templates during startup
  await seedTemplatesOnStartup();

  // Initialize Snowflake service
  await initializeSnowflake();

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
