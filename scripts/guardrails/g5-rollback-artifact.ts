#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// G5 — Rollback Artifact Writer
// On every successful deploy, append an entry to deploys/history.json with:
//   { deployedAt, bundleHash, snapshotKey, migrationsApplied[], gitSha }
// Keeps the last 50 entries. The companion script `g5-rollback.sh` reads this
// file to surface the prior bundle hash + snapshot ref for break-glass recovery.
//
// Run with G5_DRY_RUN=1 to print the would-write entry without touching the file.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { execSync } from "child_process";
import { dirname } from "path";
import { createHash } from "crypto";

const DRY_RUN = process.env.G5_DRY_RUN === "1";
const HISTORY_PATH = "deploys/history.json";
const KEEP = 50;

function safeExec(cmd: string): string {
  try { return execSync(cmd, { encoding: "utf8" }).trim(); } catch { return ""; }
}

function bundleHash(): string {
  const distDir = "dist/public/assets";
  if (!existsSync(distDir)) return "no-dist";
  const files = readdirSync(distDir).filter((f) => /^index-[A-Za-z0-9_-]+\.js$/.test(f)).sort();
  if (!files.length) return "no-bundle";
  return files[0].replace(/^index-|\.js$/g, "");
}

function migrationsApplied(): string[] {
  if (!existsSync("migrations")) return [];
  return readdirSync("migrations").filter((f) => f.endsWith(".sql")).sort();
}

async function latestSnapshotKey(): Promise<string | null> {
  try {
    const { Client } = await import("@replit/object-storage");
    const c = new Client();
    const list = await c.list({ prefix: "guardrails/snapshots/" });
    if (!list.ok) return null;
    const objs = (list.value ?? []).filter((o: any) => o.name.endsWith(".json")).sort((a: any, b: any) => b.name.localeCompare(a.name));
    return objs[0]?.name ?? null;
  } catch { return null; }
}

async function main() {
  const entry = {
    deployedAt: new Date().toISOString(),
    bundleHash: bundleHash(),
    gitSha: safeExec("git rev-parse --short HEAD") || "unknown",
    snapshotKey: await latestSnapshotKey(),
    migrationsApplied: migrationsApplied(),
    fingerprint: createHash("sha256")
      .update(readdirSync("dist/public/assets").join(",") + "|" + Date.now())
      .digest("hex").slice(0, 12),
  };

  if (DRY_RUN) {
    console.log("[G5] DRY-RUN — would append:");
    console.log(JSON.stringify(entry, null, 2));
    return;
  }

  let history: any[] = [];
  if (existsSync(HISTORY_PATH)) {
    try { history = JSON.parse(readFileSync(HISTORY_PATH, "utf8")); } catch { history = []; }
  }
  history.push(entry);
  if (history.length > KEEP) history = history.slice(-KEEP);
  mkdirSync(dirname(HISTORY_PATH), { recursive: true });
  writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
  console.log(`[G5] Recorded deploy ${entry.bundleHash} → ${HISTORY_PATH} (${history.length} entries kept).`);
}

main().catch((e) => {
  console.warn("[G5] Artifact write failed (non-blocking):", (e as Error).message);
  process.exit(0);
});
