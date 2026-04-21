#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// G7 — Direction guard for scripts/refreshDevFromProd.js
// Asserts: SOURCE host contains a 'prod' marker AND DEST host does NOT.
// If either assertion fails, refuses to proceed and exits 2.
//
// Used as a pre-flight: invoke BEFORE refreshDevFromProd.js, e.g.
//     node scripts/guardrails/g7-refresh-direction-guard.js \
//       --source "$PROD_DATABASE_URL" --dest "$DEV_DATABASE_URL" \
//       && node scripts/refreshDevFromProd.js
//
// Markers (case-insensitive substring): "prod", "production", "main-branch".
// Override with G7_PROD_MARKERS="comma,separated,list" if your prod host
// uses a different naming convention.
// ─────────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function arg(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : process.env[name.replace(/^--/, "").toUpperCase()];
}
const source = arg("--source") || process.env.SOURCE_DATABASE_URL || process.env.PROD_DATABASE_URL;
const dest = arg("--dest") || process.env.DEST_DATABASE_URL || process.env.DEV_DATABASE_URL;
const dryRun = process.env.G7_DRY_RUN === "1";

const markers = (process.env.G7_PROD_MARKERS || "prod,production,main-branch")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
}
function hasProdMarker(host) {
  return markers.some((m) => host.includes(m));
}

if (!source || !dest) {
  console.error("[G7] Missing --source and/or --dest URL.");
  if (dryRun) { console.log("[G7] DRY-RUN — refusing to run without explicit source/dest is the correct behaviour."); process.exit(0); }
  process.exit(2);
}

const srcHost = hostOf(source);
const dstHost = hostOf(dest);
console.error(`[G7] source host: ${srcHost}`);
console.error(`[G7] dest   host: ${dstHost}`);
console.error(`[G7] prod markers: ${markers.join(", ")}`);

let fail = 0;
if (!hasProdMarker(srcHost)) {
  console.error(`[G7] FAIL — SOURCE host "${srcHost}" does not contain a prod marker.`);
  fail++;
}
if (hasProdMarker(dstHost)) {
  console.error(`[G7] FAIL — DEST host "${dstHost}" contains a prod marker. Refusing to overwrite prod with dev.`);
  fail++;
}
if (srcHost === dstHost) {
  console.error(`[G7] FAIL — source and dest hosts are identical.`);
  fail++;
}
if (fail > 0) {
  console.error(`[G7] BLOCKED — ${fail} assertion(s) failed.`);
  process.exit(2);
}
console.error("[G7] OK — direction safe (prod → non-prod).");
process.exit(0);
