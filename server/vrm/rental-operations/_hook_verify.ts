#!/usr/bin/env npx tsx
export {};
(async () => {
  const { registerVrmRoutes } = await import("../routes");
  const r: any = registerVrmRoutes();
  const routes = (r.stack || []).filter((l: any) => l.route).map((l: any) => `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`);
  const ro = routes.filter((p: string) => p.includes("rental-operations"));
  console.log("[hook] total VRM routes:", routes.length, "| rental-operations routes:", ro.length);
  for (const p of ro) console.log("   " + p);
  if (ro.length < 7) { console.error("[hook] FAIL: rental-operations routes not wired via registerVrmRoutes"); process.exit(1); }
  console.log("[hook] OK — endpoints are wired through the real registerVrmRoutes");
  process.exit(0);
})().catch((e) => { console.error("[hook] FAILED:", e?.stack || e?.message || e); process.exit(1); });
