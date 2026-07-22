// THE Chromium resolver. One definition, on purpose.
//
// Until 7/22 there were three. This one, plus a one-liner in holman-svc-scrape.ts and
// another in holman-renter-resolver.ts, both of which returned HOLMAN_CHROMIUM_PATH with
// no existence check and no fallback. That env var points at a Replit WORKSPACE nix path
// (playwright-browsers-...-with-cjk) that replit.nix does not declare, so in a deployment
// it does not resolve and the weak copies handed the missing path to chromium.launch().
// playwright-core bundles no browser, so nothing caught it: every unattended scrape died
// and the caller still reported a clean run. Import this. Do not write a fourth.
import { chromium } from "playwright-core";
import { readdirSync, existsSync } from "fs";

export function resolveChromiumPath(): string | undefined {
  // 1. Explicit pin always wins.
  const envPath = process.env.HOLMAN_CHROMIUM_PATH?.trim();
  if (envPath && existsSync(envPath)) return envPath;

  // 2. Ask playwright-core for the browser IT expects (guaranteed CDP-revision match).
  //    On the Replit dev/deploy env this resolves; in a bare shell it may not, so we
  //    fall through to a revision-aware /nix scan below.
  try {
    const p = (chromium as any).executablePath?.();
    if (p && existsSync(p)) return p;
  } catch {
    /* not resolvable in this context */
  }

  let storeDirs: string[] = [];
  try {
    storeDirs = readdirSync("/nix/store");
  } catch {
    return undefined;
  }

  // 3. Scan /nix/store for a REAL playwright chromium build (present in the dev image).
  //    playwright-core here is 1.41.2; a nix playwright chromium (e.g. the "-with-cjk"
  //    rev-1187 dev build) drives page.evaluate correctly. Prefer cjk, then highest rev.
  const candidates: { path: string; rev: number; cjk: boolean }[] = [];
  for (const d of storeDirs) {
    if (!/playwright.*chromium|playwright-browsers/i.test(d)) continue;
    const base = `/nix/store/${d}`;
    const cjk = /cjk/i.test(d);
    let subs: string[] = [];
    try {
      subs = readdirSync(base);
    } catch {
      continue;
    }
    for (const s of subs) {
      const m = s.match(/^chromium-(\d+)$/);
      if (m) {
        const p = `${base}/${s}/chrome-linux/chrome`;
        if (existsSync(p)) candidates.push({ path: p, rev: parseInt(m[1], 10), cjk });
      }
    }
    const direct = `${base}/chrome-linux/chrome`;
    if (existsSync(direct)) candidates.push({ path: direct, rev: 0, cjk });
  }
  if (candidates.length) {
    candidates.sort((a, b) => Number(b.cjk) - Number(a.cjk) || b.rev - a.rev);
    return candidates[0].path;
  }

  // 4. A clean, non-privacy-patched chromium (replit.nix declares pkgs.chromium, which
  //    ships to prod). Prefer it over the ungoogled fallback below: ungoogled-chromium is
  //    privacy-patched and its post-login cookie/JS behavior diverged in prod and broke the
  //    in-page TabId harvest, whereas stock chromium runs page.evaluate the same as the dev
  //    playwright build (both verified against playwright-core 1.41.2). Store dir names are
  //    hash-prefixed (e.g. "<hash>-chromium-125.0.6422.141"), so match "-chromium-<digit>"
  //    unanchored and explicitly exclude ungoogled (which also contains "-chromium-<digit>");
  //    "chromium-sandbox"/"chromium-unwrapped-…" don't match ("-chromium-" not followed by a digit).
  for (const d of storeDirs) {
    if (/ungoogled/i.test(d)) continue;
    if (!/-chromium-[0-9]/.test(d)) continue;
    const p = `/nix/store/${d}/bin/chromium`;
    if (existsSync(p)) return p;
  }

  // 5. Last resort: a wrapped ungoogled-chromium binary.
  for (const d of storeDirs) {
    if (!/ungoogled-chromium-[0-9]/.test(d) || /sandbox$/.test(d)) continue;
    const p = `/nix/store/${d}/bin/chromium`;
    if (existsSync(p)) return p;
  }
  return undefined;
}

/**
 * Same resolution, but throws a diagnostic naming everything it looked for instead of
 * returning undefined. Use on unattended paths (the scrape worker), where undefined
 * reaches chromium.launch() and surfaces as an opaque playwright error rather than
 * "there is no browser in this image".
 */
export function requireChromiumPath(context: string): string {
  const p = resolveChromiumPath();
  if (p) return p;
  throw new Error(
    `${context}: no usable Chromium found. Checked HOLMAN_CHROMIUM_PATH (${process.env.HOLMAN_CHROMIUM_PATH || "unset"}), ` +
    `playwright-core's own executablePath, then /nix/store for playwright-chromium, pkgs.chromium and ungoogled-chromium. ` +
    `playwright-core ships no browser, so one must be in the image — verify replit.nix's pkgs.chromium reaches this deployment.`,
  );
}
