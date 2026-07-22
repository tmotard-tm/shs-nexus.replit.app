#!/usr/bin/env npx tsx
/**
 * Standalone VRM Rental Operations ingest — the durable recurring trigger.
 *
 * Own process (server/index.ts boot does not run here), so it bootstraps
 * Snowflake explicitly (mirrors server/run-rental-sync.ts). Wire to a Replit
 * Scheduled Deployment: `npx tsx server/run-vrm-rental-ops-sync.ts`.
 *
 * Writes ONLY vrm_rental_operations_* tables. Reads Snowflake + all_techs.
 *
 * Two layers, in this order and never the other way round (Tyler 7/21: "have the
 * snowflake data and then scrape and only bring in from the scraper what's
 * different"): runRentalOpsIngest lands the Snowflake BASE layer, then the delta
 * sweep scrapes only the trucks that base layer cannot be trusted on. Targeting
 * reads freshly-landed PO rows to decide what disagrees, so the sweep MUST run
 * after landPo, not beside it.
 *
 * Env knobs (no code change needed to turn this down or off):
 *   VRM_SKIP_HOLMAN_SCRAPE=1   Snowflake land only, no Chromium at all.
 *   VRM_SCRAPE_MAX_TRUCKS=n    override the per-run truck cap.
 *   VRM_SCRAPE_BUDGET_MIN=n    override the wall-clock budget, in minutes.
 */
export {};

// ── Delta sweep bounds ──────────────────────────────────────────────────────
// The scrape spawns a headless Chromium session per truck at ~20s each, so the
// 99 targets live on prod today are ~33 minutes and a full findScrapeTargets
// page (MAX_TARGETS_PER_RUN=150) is ~50. A Scheduled Deployment that overruns
// its window gets killed mid-flight, which is strictly worse than leaving work
// behind: targets are priority-ordered (shop_mismatch_open first, cosmetic
// never_scraped last) and re-arm on the next run, so what we skip is the tail
// nobody was going to dial, and it comes back 12 hours later re-ranked.
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
 * The Holman delta sweep. Runs AFTER the Snowflake land and never throws — the
 * land is the valuable half of this job and a Chromium failure must not cost it
 * or the process exit code. Everything here degrades to a logged warning.
 */
async function runDeltaSweep(): Promise<void> {
  const skip = process.env.VRM_SKIP_HOLMAN_SCRAPE;
  if (skip === "1" || skip?.toLowerCase() === "true") {
    console.log("[VRM RentalOps] Delta sweep SKIPPED (VRM_SKIP_HOLMAN_SCRAPE set).");
    return;
  }
  const swept = Date.now();
  const cap = envInt("VRM_SCRAPE_MAX_TRUCKS", SCRAPE_MAX_TRUCKS);
  const budgetMs = envInt("VRM_SCRAPE_BUDGET_MIN", SCRAPE_BUDGET_MIN) * 60_000;
  try {
    const { findScrapeTargets, scrapeAndStore } = await import("./vrm/rental-operations/scrape-service");
    // Selection is findScrapeTargets' job, not ours — do NOT reimplement it, and
    // do NOT pass onlyMissing/force to scrapeAndStore below: most delta targets
    // already have a portal row and that filter would drop every one of them.
    const { targets, totalFound, byReason } = await findScrapeTargets({ limit: cap });
    const trucks = targets.map((t) => t.truck);
    if (!trucks.length) {
      console.log(`[VRM RentalOps] Delta sweep: 0 targets — base layer agrees everywhere.`);
      return;
    }
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
  } catch (e: any) {
    // Deliberately swallowed. The Snowflake land already committed; failing the
    // process here would make a scraper outage look like an ingest outage.
    console.error(`[VRM RentalOps] Delta sweep FAILED (Snowflake land is unaffected): ${e?.stack || e?.message || e}`);
  }
}

async function boot(): Promise<void> {
  const { initializeSnowflakeService, isSnowflakeConfigured } = await import("./snowflake-service");
  const account = process.env.SNOWFLAKE_ACCOUNT;
  const username = process.env.SNOWFLAKE_USER;
  let privateKey = process.env.SNOWFLAKE_PRIVATE_KEY;
  if (!privateKey) {
    try {
      const { loadKeyFromFile } = await import("./snowflake-key-loader");
      privateKey = loadKeyFromFile() ?? undefined;
      if (privateKey) console.log("[VRM RentalOps] Loaded Snowflake private key from file.");
    } catch {}
  }
  if (!account || !username || !privateKey) {
    throw new Error(`Missing Snowflake credentials: ${[
      !account ? "SNOWFLAKE_ACCOUNT" : null,
      !username ? "SNOWFLAKE_USER" : null,
      !privateKey ? "SNOWFLAKE_PRIVATE_KEY" : null,
    ].filter(Boolean).join(", ")}`);
  }
  initializeSnowflakeService({
    account, username, privateKey,
    database: process.env.SNOWFLAKE_DATABASE, schema: process.env.SNOWFLAKE_SCHEMA,
    warehouse: process.env.SNOWFLAKE_WAREHOUSE, role: process.env.SNOWFLAKE_ROLE,
  });
  if (!isSnowflakeConfigured()) throw new Error("Snowflake still not configured after init");
}

async function run(): Promise<void> {
  const start = Date.now();
  console.log("=".repeat(60));
  console.log(`[VRM RentalOps] Ingest starting ${new Date().toISOString()}`);
  await boot();
  const { runRentalOpsIngest } = await import("./vrm/rental-operations/ingest");
  const r = await runRentalOpsIngest({ runType: "scheduled_sync", amsMode: "full", landPo: true });
  if (r.skipped) {
    console.log(`[VRM RentalOps] SKIPPED (${r.skipReason}) — no sweep.`);
    process.exit(0);
  }
  console.log("[VRM RentalOps] Complete:");
  console.log(`  file date:        ${r.fileDate}`);
  console.log(`  enterprise:       ${r.enterpriseCount}`);
  console.log(`  holman non-ent:   ${r.holmanCount}`);
  console.log(`  of which PENDED:  ${r.pendedCount}`);
  console.log(`  total cases:      ${r.totalCases}`);
  console.log(`  identity RESOLVED ${r.resolved} / REVIEW ${r.review} / EXCEPTION ${r.exception}`);
  console.log(`  dropped off feed: ${r.dropped}`);
  console.log(`  PO history land:  ${r.poLanded ?? "-"} POs, ${r.openRepairTrucks ?? "-"} trucks w/ open repair`);
  console.log(`  AMS status:       ${r.amsWithStatus ?? "-"} cases matched`);
  // Correction layer last: targeting compares the portal against the PO rows the
  // land above just wrote, so running it earlier would target yesterday's truth.
  await runDeltaSweep();
  console.log(`[VRM RentalOps] Done in ${((Date.now() - start) / 1000).toFixed(2)}s`);
  process.exit(0);
}

run().catch((e) => {
  console.error("[VRM RentalOps] FAILED:", e?.stack || e?.message || e);
  process.exit(1);
});
