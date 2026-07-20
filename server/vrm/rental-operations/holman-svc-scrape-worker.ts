// Isolated child entrypoint for the on-demand svc-history scraper. Spawned by
// scrape-service.ts so Chromium runs OUT of the Express process (same
// containment contract as holman-renter-worker). Contract:
//   argv[2] = comma-separated vehicle numbers.
//   stdout: exactly ONE JSON line {"ok":true,results:[...]} | {"ok":false,error}.
//   stderr: all human logs (never console.log here).
import { scrapeVehicleHistories } from "./holman-svc-scrape";

// Flush stdout fully BEFORE exiting. The svc-history payload can be hundreds of
// KB, and process.exit() truncates un-drained stdout — so exit only in the
// write callback (and set exitCode as a backstop).
function emit(obj: unknown, code: number) {
  process.exitCode = code;
  process.stdout.write(JSON.stringify(obj) + "\n", () => process.exit(code));
}

(async () => {
  try {
    const vehicles = (process.argv[2] || "").split(",").map((v) => v.trim()).filter(Boolean);
    if (!vehicles.length) { emit({ ok: false, error: "no vehicles passed" }, 1); return; }
    const results = await scrapeVehicleHistories(vehicles);
    emit({ ok: true, results }, 0);
  } catch (e: any) {
    emit({ ok: false, error: e?.message || String(e) }, 1);
  }
})();
