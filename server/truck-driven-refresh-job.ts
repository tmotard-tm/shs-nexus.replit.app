/**
 * Scheduled-Deployment entry point for the truck-driven TPMS mirror refresh.
 * Point a Replit Scheduled Deployment at:  npx tsx server/truck-driven-refresh-job.ts
 * Recommended cadence: every 2-4 hours (or nightly ~6 AM ET after AIMS lands).
 */
import { refreshTruckDrivenMirror } from "./fleet-scope-truck-driven-refresh";
refreshTruckDrivenMirror("scheduled-deployment")
  .then((r) => { console.log("[truck-driven-refresh-job] done", JSON.stringify(r)); process.exit(0); })
  .catch((e) => { console.error("[truck-driven-refresh-job] failed", e?.message || e); process.exit(1); });
