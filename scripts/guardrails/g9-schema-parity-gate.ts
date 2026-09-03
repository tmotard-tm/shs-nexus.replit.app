// ─────────────────────────────────────────────────────────────────────────────
// G9 — Schema Parity Gate (dev vs prod)
//
// WHY THIS EXISTS (2026-09-02/03)
// Replit's Publish dialog computes its migration by diffing the DEVELOPMENT
// database against PRODUCTION. Not the drizzle schema files. Not tablesFilter.
// Proven on 2026-09-02: with tables and columns equal, the dialog still emitted
// CREATE SEQUENCE / SET DEFAULT for 37 tables whose sequences on dev were not
// OWNED BY their column, then failed on prod. Earlier the same day, with dev
// missing 111 tables after a branch reset, it proposed DROP TABLE for the
// whole rental program. Every one was a dev/prod difference a human eyeballing
// the dialog could not reliably classify.
//
// This gate compares the two databases on every axis drizzle introspects and
// FAILS THE BUILD, before the migration step can apply anything, with the exact
// list. Fix the drift on DEV (restart the dev app so boot DDL runs, or run the
// dev-refresh procedure), then publish.
//
// Posture matches G2/G3: missing URL -> warn and pass; G9_DRY_RUN=1 -> report
// and pass; G9_SELFTEST=1 -> inject a fake prod-only table and prove the fail
// path works (exit 0 if it does, 2 if not).
// ─────────────────────────────────────────────────────────────────────────────
import pg from "pg";

const PROD = process.env.PROD_DATABASE_URL || process.env.DATABASE_URL;
const DEV = process.env.DEV_DATABASE_URL;
const DRY = process.env.G9_DRY_RUN === "1";
const SELFTEST = process.env.G9_SELFTEST === "1";
const host = (u: string) => (u.match(/@([^/?]+)/)?.[1] || "?").split(".")[0];

async function open(url: string) {
  const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
  await c.connect();
  return c;
}
type Row = Record<string, any>;
const AXES: Array<{ name: string; sql: string; key: (r: Row) => string; val: (r: Row) => string }> = [
  { name: "tables", key: r => r.table_name, val: () => "", sql:
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'` },
  { name: "columns", key: r => r.table_name + "." + r.column_name,
    val: r => [r.udt_name, r.is_nullable, r.column_default || "", r.is_identity, r.is_generated].join("|"), sql:
    `SELECT table_name, column_name, udt_name, is_nullable, column_default, is_identity, is_generated
       FROM information_schema.columns WHERE table_schema='public'` },
  { name: "indexes", key: r => r.tablename + "." + r.indexname, val: r => r.indexdef, sql:
    `SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname='public'` },
  { name: "constraints", key: r => r.t + "." + r.conname, val: r => r.def, sql:
    `SELECT c.conrelid::regclass::text AS t, c.conname, pg_get_constraintdef(c.oid) AS def
       FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
      WHERE n.nspname='public' AND c.conname !~ '^[0-9]+_[0-9]+_[0-9]+_not_null$'` },
  { name: "enums", key: r => r.typname, val: r => r.labels, sql:
    `SELECT t.typname, string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS labels
       FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid JOIN pg_namespace n ON n.oid=t.typnamespace
      WHERE n.nspname='public' GROUP BY t.typname` },
  { name: "sequences", key: r => r.sequence_name, val: () => "", sql:
    `SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema='public'` },
  { name: "serial ownership", key: r => r.table_name + "." + r.column_name, val: r => r.ss || "NULL", sql:
    `SELECT c.table_name, c.column_name, pg_get_serial_sequence('public.'||quote_ident(c.table_name), c.column_name) AS ss
       FROM information_schema.columns c WHERE c.table_schema='public' AND c.column_default LIKE 'nextval(%'` },
  { name: "functions", key: r => r.proname, val: () => "", sql:
    `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'` },
  { name: "triggers", key: r => r.event_object_table + "." + r.trigger_name, val: () => "", sql:
    `SELECT event_object_table, trigger_name FROM information_schema.triggers WHERE trigger_schema='public'` },
];

async function main(): Promise<number> {
  if (!PROD || !DEV) { console.warn("[G9] PROD_DATABASE_URL/DATABASE_URL or DEV_DATABASE_URL missing - parity gate skipped (warn only)."); return 0; }
  if (host(PROD) === host(DEV)) { console.warn(`[G9] dev and prod resolve to the same host (${host(PROD)}) - nothing to compare, skipped.`); return 0; }
  console.log(`[G9] comparing DEV ${host(DEV)}  vs  PROD ${host(PROD)}${DRY ? "  (dry run)" : ""}${SELFTEST ? "  (self-test)" : ""}`);
  const [P, D] = await Promise.all([open(PROD), open(DEV)]);
  let problems = 0;
  try {
    for (const ax of AXES) {
      const [pr, dr] = await Promise.all([P.query(ax.sql), D.query(ax.sql)]);
      const pm = new Map(pr.rows.map((r: Row) => [ax.key(r), ax.val(r)]));
      const dm = new Map(dr.rows.map((r: Row) => [ax.key(r), ax.val(r)]));
      if (SELFTEST && ax.name === "tables") pm.set("__g9_selftest_prod_only_table__", "");
      const onlyP = [...pm.keys()].filter(k => !dm.has(k));
      const onlyD = [...dm.keys()].filter(k => !pm.has(k));
      const differ = [...pm.keys()].filter(k => dm.has(k) && dm.get(k) !== pm.get(k));
      const n = onlyP.length + onlyD.length + differ.length;
      problems += n;
      console.log(`[G9] ${ax.name.padEnd(17)} prod=${pm.size} dev=${dm.size}  prod-only=${onlyP.length}  dev-only=${onlyD.length}  differ=${differ.length}${n ? "   <-- DRIFT" : ""}`);
      for (const k of onlyP.slice(0, 8)) console.log(`       prod-only : ${k}   (planner would DROP this on prod)`);
      for (const k of onlyD.slice(0, 8)) console.log(`       dev-only  : ${k}   (planner would CREATE this on prod)`);
      for (const k of differ.slice(0, 8)) console.log(`       differs   : ${k}\n           prod: ${String(pm.get(k)).slice(0, 110)}\n           dev : ${String(dm.get(k)).slice(0, 110)}`);
    }
  } finally { await Promise.all([P.end(), D.end()]); }
  if (SELFTEST) {
    const ok = problems >= 1;
    console.log(ok ? "[G9] self-test: fail path OK (injected drift was detected)" : "[G9] self-test FAILED: injected drift was NOT detected");
    return ok ? 0 : 2;
  }
  if (problems === 0) { console.log("[G9] dev == prod on every axis. Publish diff will be empty."); return 0; }
  console.log(`[G9] ${problems} difference(s). The Publish dialog will turn these into DDL against PRODUCTION.`);
  console.log("[G9] Fix on DEV, never prod: restart the dev workflow (boot DDL), or run the dev-refresh procedure, then re-run.");
  if (DRY) { console.log("[G9] dry run - not failing the build."); return 0; }
  console.log("[G9] Deploy aborted.");
  return 1;
}
main().then(code => process.exit(code)).catch(e => { console.error("[G9] error:", e?.message || e); process.exit(1); });
