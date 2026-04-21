// ─────────────────────────────────────────────────────────────────────────────
// G8 dry-run harness — spawns three subprocesses to verify each branch of
// assertProdDatabaseHost(). Reports pass/fail per case.
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from "child_process";

type Case = { label: string; env: NodeJS.ProcessEnv; expectExit: number; expectStderrSubstr?: string; expectStdoutSubstr?: string };

// Canonical G8 module lives under server/guardrails/ so that server/index.ts
// can import it via a project-local relative path. Harness spawns a fresh
// tsx subprocess that imports the same canonical module — no duplicate file.
const SCRIPT = "server/guardrails/g8-env-drift-check.ts";
const CORRECT_HOST = "ep-lively-heart-adrhzx3e.c-2.us-east-1.aws.neon.tech";

const cases: Case[] = [
  {
    label: "MATCH (NODE_ENV=production, correct host)",
    env: { NODE_ENV: "production", DATABASE_URL: `postgres://u:p@${CORRECT_HOST}/db` },
    expectExit: 0,
    expectStdoutSubstr: "[G8] OK",
  },
  {
    label: "MISMATCH (NODE_ENV=production, helium host)",
    env: { NODE_ENV: "production", DATABASE_URL: "postgres://u:p@helium/db" },
    expectExit: 1,
    expectStderrSubstr: "[G8] FATAL",
  },
  {
    label: "DEV (NODE_ENV=development, any host)",
    env: { NODE_ENV: "development", DATABASE_URL: "postgres://u:p@anywhere/db" },
    expectExit: 0,
    expectStdoutSubstr: "[G8] skipped",
  },
];

let allPass = true;
for (const c of cases) {
  const res = spawnSync(
    "npx",
    ["tsx", "-e", `import('./${SCRIPT}')`],
    { env: { ...process.env, ...c.env, PATH: process.env.PATH }, encoding: "utf8" },
  );
  const stdout = (res.stdout || "").trim();
  const stderr = (res.stderr || "").trim();
  const exitOk = res.status === c.expectExit;
  const stdoutOk = !c.expectStdoutSubstr || stdout.includes(c.expectStdoutSubstr);
  const stderrOk = !c.expectStderrSubstr || stderr.includes(c.expectStderrSubstr);
  const pass = exitOk && stdoutOk && stderrOk;
  if (!pass) allPass = false;
  console.log(`[G8 dry-run] ${pass ? "PASS" : "FAIL"} — ${c.label}`);
  console.log(`             exit=${res.status} (expected ${c.expectExit})`);
  if (stdout) console.log(`             stdout: ${stdout}`);
  if (stderr) console.log(`             stderr: ${stderr}`);
}
process.exit(allPass ? 0 : 1);
