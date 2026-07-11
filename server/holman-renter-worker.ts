// Isolated entrypoint for the Holman renter resolver (View Rental Request).
// Spawned as a CHILD process by holman-portal-service so the real Chromium
// browser runs OUT of the Express server (same containment contract as
// holman-login-worker: a crash/hang/OOM here cannot destabilize the app).
//
// Contract:
//   argv[2] = comma-separated vehicle numbers.
//   stdout: exactly ONE JSON line — {"ok":true,results:[...]} or {"ok":false,error}.
//   stderr: all human-readable logs. Never console.log here.
import { resolveRentersHeadless } from "./holman-renter-resolver";

(async () => {
  try {
    const vehicles = (process.argv[2] || "").split(",").map((v) => v.trim()).filter(Boolean);
    if (vehicles.length === 0) {
      process.stdout.write(JSON.stringify({ ok: false, error: "no vehicles passed" }) + "\n");
      process.exit(1);
      return;
    }
    const results = await resolveRentersHeadless(vehicles);
    process.stdout.write(JSON.stringify({ ok: true, results }) + "\n");
    process.exit(0);
  } catch (e: any) {
    process.stdout.write(JSON.stringify({ ok: false, error: e?.message || String(e) }) + "\n");
    process.exit(1);
  }
})();
