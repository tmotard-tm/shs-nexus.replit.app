import { findScrapeGaps, scrapeAndStore } from "./server/vrm/rental-operations/scrape-service";
(async () => {
  const gaps = await findScrapeGaps();
  console.log(new Date().toISOString(), "scrape-missing starting for", gaps.length, "trucks");
  const r = await scrapeAndStore(gaps, { force: false });
  console.log(new Date().toISOString(), "scrape-missing DONE:", JSON.stringify(r));
  process.exit(0);
})().catch(e => { console.error("SCRAPE ERR:", e?.message || e); process.exit(1); });
