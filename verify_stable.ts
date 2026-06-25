import { scrapeAwaitingAuth } from "./server/holman-portal-service";
(async () => {
  const t0 = Date.now();
  const r = await scrapeAwaitingAuth();
  console.log(`[TEST] scrape rows=${r.rows.length} err=${r.error || "none"} in ${((Date.now()-t0)/1000).toFixed(1)}s`);
  process.exit(0);
})().catch((e) => { console.error("[TEST] THREW", e?.stack || e?.message || e); process.exit(1); });
