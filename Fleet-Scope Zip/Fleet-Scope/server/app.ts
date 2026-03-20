import { type Server } from "node:http";

import express, {
  type Express,
  type Request,
  Response,
  NextFunction,
} from "express";

import { registerRoutes } from "./routes";
import { initWebSocket, startScheduledMessageProcessor } from "./reg-messaging";

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export const app = express();

// =============================================================================
// PHASE 1 — MAINTENANCE MODE (deploy this BEFORE running the migration script)
// This prevents any new writes to the original Fleet-Scope database during the
// final migration window. Deploy to fleet-scope.replit.app, confirm the 503 is
// serving, then run scripts/migrate-fleet-scope-data.ts in Nexus.
//
// PHASE 2 — REDIRECT (deploy this AFTER migration is verified — replaces Phase 1)
// Use 302 (temporary) for the first 24–48 hours so browser caches do NOT lock
// in the redirect during the validation window.
// After confirming Nexus data is flowing correctly, manually change 302 → 301
// to make the redirect permanent (signals browsers and search engines to update).
// =============================================================================

const NEXUS_URL = "https://SHS-Nexus.replit.app";

// PHASE 2 — REDIRECT middleware (replaces the Phase 1 maintenance middleware below).
// NOTE: Deploy this to fleet-scope.replit.app AFTER the migration is verified.
app.use((req: Request, res: Response, next: NextFunction) => {
  const acceptHeader = req.headers.accept || "";
  const wantsHtml = acceptHeader.includes("text/html");

  if (wantsHtml) {
    // Browser request — serve a "We've moved" page with a 5-second auto-redirect
    res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="5;url=${NEXUS_URL}">
  <title>Fleet Scope Has Moved</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: #f8fafc;
      color: #1e293b;
    }
    .container {
      text-align: center;
      max-width: 480px;
      padding: 2rem;
    }
    h1 { font-size: 1.75rem; margin-bottom: 0.5rem; }
    p { color: #64748b; margin-bottom: 1.5rem; }
    a {
      display: inline-block;
      background: #2563eb;
      color: white;
      text-decoration: none;
      padding: 0.75rem 1.5rem;
      border-radius: 0.5rem;
      font-weight: 600;
    }
    a:hover { background: #1d4ed8; }
    .countdown { margin-top: 1rem; font-size: 0.875rem; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Fleet Scope Has Moved to Nexus</h1>
    <p>You'll be redirected automatically in 5 seconds.</p>
    <a href="${NEXUS_URL}">Go now &rarr;</a>
    <p class="countdown">Redirecting to ${NEXUS_URL}</p>
  </div>
</body>
</html>`);
  } else {
    // API / non-browser request — use 302 (temporary redirect) so caches don't lock in.
    // IMPORTANT: Change this to 301 after confirming Nexus data is correct (24–48h window).
    res.redirect(302, NEXUS_URL);
  }
});

// =============================================================================
// PHASE 1 — MAINTENANCE MODE (kept here for reference; removed in Phase 2 deploy)
// Deploy Phase 1 middleware BEFORE running the migration. Replace with Phase 2
// redirect middleware (above) AFTER migration is verified.
//
// Phase 1 code (uncomment and deploy before migration):
//
//   app.use((req: Request, res: Response) => {
//     const acceptHeader = req.headers.accept || "";
//     const wantsHtml = acceptHeader.includes("text/html");
//     if (req.path.startsWith("/api") && !wantsHtml) {
//       return res.status(503).json({ message: "Migration in Progress — Fleet Scope is temporarily unavailable" });
//     }
//     res.status(503).send(`<!DOCTYPE html>
// <html lang="en"><head><meta charset="UTF-8"><title>Migration in Progress</title></head>
// <body style="font-family:sans-serif;text-align:center;padding:4rem">
//   <h1>Migration in Progress</h1>
//   <p>Fleet Scope is being migrated to Nexus. Please check back shortly.</p>
// </body></html>`);
//   });
// =============================================================================

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown
  }
}
app.use(express.json({
  limit: '50mb',
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
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

export default async function runApp(
  setup: (app: Express, server: Server) => Promise<void>,
) {
  const server = await registerRoutes(app);

  initWebSocket(server);
  startScheduledMessageProcessor();

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly run the final setup after setting up all the other routes so
  // the catch-all route doesn't interfere with the other routes
  await setup(app, server);

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
}
