// Isolated entrypoint for the Holman headless login.
//
// holman-portal-service.ensureSession() spawns this as a CHILD process so that the
// real Chromium browser runs OUT of the Express server. A Chromium crash, OOM, hang,
// or CPU spike is therefore contained here and can never destabilize the dev server
// (which is exactly what the old in-process launch did: it white-screened the dev
// space and leaked whole browser trees).
//
// Contract:
//   - stdout: exactly ONE JSON line — {"ok":true,cookies,tabId,idToken} on success,
//             or {"ok":false,error} on failure. The parent parses the last stdout line.
//   - stderr: all human-readable logs (console.error/warn). Never console.log here,
//             or it would corrupt the stdout result contract.
import { headlessHolmanLogin } from "./holman-headless-login";

(async () => {
  try {
    const harvest = await headlessHolmanLogin();
    process.stdout.write(JSON.stringify({ ok: true, ...harvest }) + "\n");
    process.exit(0);
  } catch (e: any) {
    process.stdout.write(JSON.stringify({ ok: false, error: e?.message || String(e) }) + "\n");
    process.exit(1);
  }
})();
