/**
 * VRM Rental Operations — THE Holman delta-sweep runner, shared.
 *
 * Two triggers run the delta layer and they MUST share this one implementation
 * (bounds, chunking, target selection, error posture):
 *   1. server/run-vrm-rental-ops-sync.ts   (standalone script, Scheduled-
 *      Deployment shape — kept for a future dedicated scheduler Repl)
 *   2. POST /api/vrm/rental-operations/cron/run  (Fleet-Dispatcher internal-cron
 *      trigger — the durable production path, since this Repl's single
 *      deployment slot is taken by the autoscale web app)
 * Do NOT fork the sweep bounds or target selection back into either caller;
 * that fork is exactly what this module exists to prevent.
 *
 * After the sweep, the portal-only PO materializer runs (portal-po-materialize):
 * the sweep refreshes vrm_holman_portal_hist and the materializer turns any
 * portal-only open POs it revealed into po_history rows the read model can see.
 */

// ── Delta sweep bounds ──────────────────────────────────────────────────────
// The scrape spawns a headless Chromium session per truck at ~20s each, so the
// 99 targets live on prod today are ~33 minutes and a full findScrapeTargets
// page (MAX_TARGETS_PER_RUN=150) is ~50. A run that overruns its window gets
// killed mid-flight, which is strictly worse than leaving work behind: targets
// are priority-ordered (shop_mismatch_open first, cosmetic never_scraped last)
// and re-arm on the next run, so what we skip is the tail nobody was going to
// dial, and it comes back 12 hours later re-ranked.
//
// Both bounds exist because either alone can be beaten. The cap cannot know a
// truck hung on a slow portal page (the worker's own timeout is 300s, so three
// bad trucks eat 15 minutes); the clock cannot stop us queueing 150 sessions we
// had no business starting. At twice daily the cap works 80 trucks/day, which
// clears today's backlog in ~1.5 days and is far above the steady-state arrival
// rate once it has.
const SCRAPE_MAX_TRUCKS = 40;          // ~13 min of Chromium at 20s/truck
const SCRAPE_BUDGET_MIN = 20;          // deliberately > 13 min: the clock is the
                                       // backstop for slow trucks, not the cap

// Chunk size for the budget check. Matches BATCH in scrape-service.ts (vehicles
// per worker invocation), so we re-check the clock exactly as often as the
// scraper already comes up for air. Overshoot is bounded by one chunk.
const SCRAPE_CHUNK = 8;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    console.warn(`[VRM RentalOps] ignoring ${name}="${raw}" (want a positive number), using ${fallback}`);
    return fallback;
  }
  // max(1) not floor alone: VRM_SCRAPE_BUDGET_MIN=0.5 would floor to 0 and turn
  // the sweep off silently, which is what VRM_SKIP_HOLMAN_SCRAPE is for.
  return Math.max(1, Math.floor(n));
}

/**
 * Replit Scheduled Deployments (and the web app's own image) are not guaranteed
 * to carry the compiled Chromium workers `npm run build:workers` produces at
 * publish time. Build them if they are missing.
 *
 * Idempotent and ~15ms when the bundle exists. Shells out to the npm script
 * rather than duplicating the esbuild invocations, so there stays exactly one
 * definition of how the workers are built. Never throws: scrape-service falls
 * back to tsx when there is no bundle.
 */
export async function ensureWorkersBuilt(): Promise<void> {
  const { existsSync } = await import("node:fs");
  const { spawn } = await import("child_process");
  const bundle = "dist/vrm/rental-operations/holman-svc-scrape-worker.js";
  if (existsSync(bundle)) return;
  console.log("[VRM RentalOps] Chromium worker bundle missing — building…");
  await new Promise<void>((resolve) => {
    const child = spawn("npm", ["run", "build:workers"], { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    child.stderr?.on("data", (d) => { err += String(d); });
    child.on("error", (e) => { console.warn(`[VRM RentalOps] worker build could not start: ${e.message} — falling back to tsx`); resolve(); });
    child.on("close", (code) => {
      if (code === 0 && existsSync(bundle)) console.log("[VRM RentalOps] Chromium workers built.");
      else console.warn(`[VRM RentalOps] worker build exited ${code} — falling back to tsx. ${err.trim().slice(0, 300)}`);
      resolve();
    });
  });
}

/**
 * The Holman delta sweep + portal-PO materialization. Runs AFTER the Snowflake
 * land and never throws — the land is the valuable half of the job and a
 * Chromium failure must not cost it or the caller's exit code. Everything here
 * degrades to a logged warning.
 *
 * Env knobs (no code change needed to turn this down or off):
 *   VRM_SKIP_HOLMAN_SCRAPE=1   Snowflake land only, no Chromium at all
 *                              (the materializer still runs — it is DB-only).
 *   VRM_SCRAPE_MAX_TRUCKS=n    override the per-run truck cap.
 *   VRM_SCRAPE_BUDGET_MIN=n    override the wall-clock budget, in minutes.
 */
export async function runDeltaSweep(): Promise<void> {
  // Manual shop-phone locks are episode-scoped (Tyler 8/3): once a case has
  // been off the board for a week, the lock clears and the phone reverts to
  // the scrape pick, so a future rental on the same truck starts fresh. Runs
  // BEFORE target selection so a truck unlocked this run can be re-scraped in
  // the same run. DB-only — runs even when Chromium is skipped — and its
  // failure must never block the sweep.
  try {
    const { expireStaleShopPhoneLocks } = await import("./scrape-service");
    await expireStaleShopPhoneLocks();
  } catch (e: any) {
    console.warn(`[VRM RentalOps] shop-phone lock expiry failed (sweep continues): ${e?.message || e}`);
  }
  const skip = process.env.VRM_SKIP_HOLMAN_SCRAPE;
  const skipScrape = skip === "1" || skip?.toLowerCase() === "true";
  if (skipScrape) {
    console.log("[VRM RentalOps] Delta sweep SKIPPED (VRM_SKIP_HOLMAN_SCRAPE set).");
  } else {
    await ensureWorkersBuilt();
    const swept = Date.now();
    const cap = envInt("VRM_SCRAPE_MAX_TRUCKS", SCRAPE_MAX_TRUCKS);
    const budgetMs = envInt("VRM_SCRAPE_BUDGET_MIN", SCRAPE_BUDGET_MIN) * 60_000;
    try {
      const { findScrapeTargets, scrapeAndStore } = await import("./scrape-service");
      // Selection is findScrapeTargets' job, not ours — do NOT reimplement it, and
      // do NOT pass onlyMissing/force to scrapeAndStore below: most delta targets
      // already have a portal row and that filter would drop every one of them.
      const { targets, totalFound, byReason } = await findScrapeTargets({ limit: cap });
      const trucks = targets.map((t) => t.truck);
      if (!trucks.length) {
        console.log(`[VRM RentalOps] Delta sweep: 0 targets — base layer agrees everywhere.`);
      } else {
        let attempted = 0, stored = 0, unchanged = 0, empty = 0, errors = 0, chunkFailures = 0;
        let ranOut = false;
        for (let i = 0; i < trucks.length; i += SCRAPE_CHUNK) {
          if (Date.now() - swept >= budgetMs) { ranOut = true; break; }
          const chunk = trucks.slice(i, i + SCRAPE_CHUNK);
          try {
            const rep = await scrapeAndStore(chunk);
            attempted += rep.targeted;
            stored += rep.stored; unchanged += rep.unchanged; empty += rep.empty; errors += rep.errors;
          } catch (e: any) {
            // One bad chunk (worker crash, Chromium missing) should not abandon the
            // rest — the next chunk is a fresh child process.
            chunkFailures++;
            errors += chunk.length;
            console.warn(`[VRM RentalOps] scrape chunk ${i / SCRAPE_CHUNK + 1} failed: ${e?.message || e}`);
          }
        }
        const secs = ((Date.now() - swept) / 1000).toFixed(1);
        const reasons = Object.entries(byReason).map(([k, v]) => `${k}=${v}`).join(" ") || "-";
        console.log(
          `[VRM RentalOps] Delta sweep: found ${totalFound} (cap ${cap}) / attempted ${attempted} / ` +
          `stored ${stored} / unchanged ${unchanged} / empty ${empty} / errors ${errors} in ${secs}s` +
          (ranOut ? ` — STOPPED on the ${budgetMs / 60_000}m budget, remainder re-arms next run` : "") +
          (chunkFailures ? ` — ${chunkFailures} chunk(s) threw` : ""),
        );
        console.log(`  targets by reason: ${reasons}`);
        if (totalFound > attempted) {
          console.log(`  ${totalFound - attempted} target(s) left for the next run (priority-ordered, urgent ones went first)`);
        }
      }
    } catch (e: any) {
      // Deliberately swallowed. The Snowflake land already committed; failing the
      // caller here would make a scraper outage look like an ingest outage.
      console.error(`[VRM RentalOps] Delta sweep FAILED (Snowflake land is unaffected): ${e?.stack || e?.message || e}`);
    }
  }

  // Portal-only PO materialization ALWAYS follows (even when the scrape was
  // skipped or found 0 targets): it works off whatever vrm_holman_portal_hist
  // holds, and the ETL land that preceded us may have superseded portal rows
  // that now need pruning. DB-only, cheap, never throws.
  try {
    const { materializePortalOnlyPos } = await import("./portal-po-materialize");
    await materializePortalOnlyPos();
  } catch (e: any) {
    console.error(`[VRM RentalOps] Portal PO materialize FAILED: ${e?.message || e}`);
  }
}
