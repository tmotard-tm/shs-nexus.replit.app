import { scrapeAwaitingAuth, denyPoInHolman } from "./server/holman-portal-service";
(async () => {
  const r = await scrapeAwaitingAuth();
  console.log("rentals:", r.rows.map(x=>`${x.driverName}/${x.poNumber}`).join(" | ") || "(none)");
  for (const row of r.rows) {
    const res = await denyPoInHolman(row.key, row.poNumber, true); // DRY RUN deny
    console.log(`### DENY ${row.vehicleNumber} ${row.driverName} PO${row.poNumber}:`, JSON.stringify({ success: res.success, blocked: res.blocked||false, blockingPos: res.blockingPos, dryRun: res.dryRun||false }));
    if (res.error) console.log("    error:", res.error);
  }
  process.exit(0);
})().catch(e => { console.error("THREW:", e?.message || e); process.exit(1); });
