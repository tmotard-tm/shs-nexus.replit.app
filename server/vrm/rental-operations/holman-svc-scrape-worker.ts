// Isolated child entrypoint for the on-demand svc-history scraper. Spawned by
// scrape-service.ts so Chromium runs OUT of the Express process (same
// containment contract as holman-renter-worker). Contract:
//   argv[2] = comma-separated vehicle numbers.
//   stdout: exactly ONE JSON line {"ok":true,results:[...]} | {"ok":false,error}.
//   stderr: all human logs (never console.log here).
import { scrapeVehicleHistories, scrapeRentalRequests } from "./holman-svc-scrape";

// Flush stdout fully BEFORE exiting. The svc-history payload can be hundreds of
// KB, and process.exit() truncates un-drained stdout — so exit only in the
// write callback (and set exitCode as a backstop).
function emit(obj: unknown, code: number) {
  process.exitCode = code;
  process.stdout.write(JSON.stringify(obj) + "\n", () => process.exit(code));
}

(async () => {
  try {
    // MODE 2 (added 2026-08-06): read "View Rental Request" pages instead of
    // svc-history. Kept in THIS worker rather than a second entrypoint because
    // build:workers hardcodes its bundle list and verifies each file exists; a
    // new worker that nobody added there fails in prod as "worker unavailable"
    // while dev works fine off tsx. One bundle, one build entry, one check.
    // "--rental-requests" can never collide with a vehicle number.
    if (process.argv[2] === "--rental-requests") {
      const payload = JSON.parse(Buffer.from(process.argv[3] || "", "base64").toString("utf8"));
      if (!Array.isArray(payload) || !payload.length) { emit({ ok: false, error: "no rental request items passed" }, 1); return; }
      const rr = await scrapeRentalRequests(payload);
      emit({ ok: true, results: rr }, 0);
      return;
    }
    const vehicles = (process.argv[2] || "").split(",").map((v) => v.trim()).filter(Boolean);
    if (!vehicles.length) { emit({ ok: false, error: "no vehicles passed" }, 1); return; }
    const results = await scrapeVehicleHistories(vehicles);
    emit({ ok: true, results }, 0);
  } catch (e: any) {
    emit({ ok: false, error: e?.message || String(e) }, 1);
  }
})();
