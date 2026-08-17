/**
 * pull-rental-cutover-prod-to-dev.ts — additive, loss-proof pull of the VRM
 * rental survey + cutover family from PROD into DEV.
 *
 * WHY (Aug 2026): the cutover intents machinery (vrm_rental_workflow_intents /
 * vrm_workflow_attempts / vrm_workflow_send_guards) exists only in DEV — prod
 * has never booted it. PROD holds the real process data: survey token sends,
 * tech survey responses, and per-tech cutover tracking. Dev needs that real
 * data to drive the workflow, WITHOUT deleting any dev rows (dev fixtures for
 * the rental-request workflow live in the same tables).
 *
 * WHAT IT DOES
 *   1. PROD session is forced READ ONLY — this script can never write to prod —
 *      and all prod reads run in ONE repeatable-read snapshot (no torn pull).
 *      Target identity is verified positively (different current_database() +
 *      the dev-only intents table must exist on the dev side), not just by
 *      comparing URL strings.
 *   2. Snapshots the whole dev family into a timestamped set of tables in the
 *      `backup_cutover_pull` schema BEFORE any change (incl. the intents
 *      family, even though it is never modified).
 *   3. In ONE dev transaction (all-or-nothing), UPSERTS prod rows. It NEVER
 *      deletes and never touches dev-only rows:
 *        vrm_form_tokens         ON CONFLICT (id)   DO UPDATE (prod wins)
 *        vrm_rental_tech_survey  ON CONFLICT (id)   DO UPDATE (prod wins)
 *        vrm_rental_request      ON CONFLICT (id)   DO UPDATE (prod has 0 today)
 *        vrm_rental_cutover      ON CONFLICT (ldap) DO UPDATE — keeps the dev
 *                                row id and the dev-only workflow columns
 *                                (intent_id, workflow_status, …) untouched.
 *      Only columns present in BOTH schemas are copied (drift-tolerant), so
 *      dev-only columns are never stomped and prod-only columns can't error.
 *   4. Repairs serial/identity sequences if any copied table has one (the
 *      four tables are uuid-keyed today; this is defensive).
 *   5. Verifies after commit: counts, FK orphans, and that every pre-pull dev
 *      row is still present.
 *
 * NOT TOUCHED: vrm_rental_workflow_intents, vrm_workflow_attempts,
 * vrm_workflow_send_guards (dev-only), and all fs_comms_* tables.
 *
 * SEND SAFETY: copied rows cannot auto-fire anything in dev — survey
 * issue/send-chunk are admin-triggered routes, the morning sweep is a manual
 * one-shot script here, and there are no intents rows for the orchestrator to
 * act on. Unsent prod tokens (sent_at IS NULL) are copied verbatim for data
 * fidelity; do not run the dev send-chunk route against real batches.
 *
 * Run:  npx tsx scripts/pull-rental-cutover-prod-to-dev.ts
 * Idempotent: rerunning refreshes dev from the latest prod state (prod wins
 * per-row on overlap; dev-native rows are always kept).
 */
import pg from "pg";

const { Client } = pg;
const CHUNK = 200;
const BACKUP_SCHEMA = "backup_cutover_pull";

type TableSpec = {
  name: string;
  /** column (with a UNIQUE constraint) used as the upsert conflict target */
  conflictKey: string;
  /** columns never written by DO UPDATE (conflict key + stable identity) */
  frozenOnUpdate: string[];
};

/** Parent-first order (surveys/requests FK vrm_form_tokens). */
const TABLES: TableSpec[] = [
  { name: "vrm_form_tokens", conflictKey: "id", frozenOnUpdate: ["id"] },
  { name: "vrm_rental_tech_survey", conflictKey: "id", frozenOnUpdate: ["id"] },
  { name: "vrm_rental_request", conflictKey: "id", frozenOnUpdate: ["id"] },
  // Per-tech summary: identity is ldap. Keep the dev row's uuid stable and let
  // common-column logic keep dev-only workflow columns untouched.
  { name: "vrm_rental_cutover", conflictKey: "ldap", frozenOnUpdate: ["id", "ldap"] },
];

/** Backed up but never modified. */
const BACKUP_ONLY = [
  "vrm_rental_workflow_intents",
  "vrm_workflow_attempts",
  "vrm_workflow_send_guards",
];

function hostDb(url: string): string {
  const u = new URL(url);
  return `${u.hostname}/${u.pathname.replace(/^\//, "")}`;
}

const qi = (ident: string) => `"${ident.replace(/"/g, '""')}"`;

async function main() {
  const devUrl = process.env.DATABASE_URL; // the DB the dev app actually serves from
  const prodUrl = process.env.PROD_DATABASE_URL;
  if (!devUrl || !prodUrl) throw new Error("DATABASE_URL and PROD_DATABASE_URL must be set");
  if (hostDb(devUrl) === hostDb(prodUrl)) {
    throw new Error("Refusing to run: DATABASE_URL points at the PROD host/database.");
  }

  const prod = new Client({ connectionString: prodUrl });
  const dev = new Client({ connectionString: devUrl });
  await prod.connect();
  await dev.connect();
  // Hard guarantee: this script can never write to prod.
  await prod.query("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");

  // Positive target-identity checks (URL strings can lie via aliases/poolers):
  // the two live sessions must be different databases, and the dev side must
  // carry the dev-only intents table (prod has never booted that module).
  const pDb = (await prod.query("SELECT current_database() AS db")).rows[0].db;
  const dDb = (await dev.query("SELECT current_database() AS db")).rows[0].db;
  if (pDb === dDb) throw new Error(`Refusing to run: both connections reach database "${pDb}".`);
  const devMarker = (
    await dev.query("SELECT to_regclass('public.vrm_rental_workflow_intents') IS NOT NULL AS ok")
  ).rows[0].ok;
  if (!devMarker) {
    throw new Error("Refusing to run: dev-only marker table vrm_rental_workflow_intents absent on the target — is DATABASE_URL really dev?");
  }

  // One consistent prod snapshot for every read below (tokens preflight + all
  // table pulls) — prod commits mid-run can't produce a torn logical copy.
  await prod.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");

  const cols = async (c: InstanceType<typeof Client>, t: string) =>
    (
      await c.query(
        `SELECT column_name, column_default, is_generated, identity_generation
         FROM information_schema.columns
         WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
        [t],
      )
    ).rows as {
      column_name: string;
      column_default: string | null;
      is_generated: string;
      identity_generation: string | null;
    }[];

  // Pre-pull dev state (for the post-commit "nothing lost" proof) — captured
  // INSIDE the dev transaction below so counts, backups, and upserts share one
  // repeatable-read snapshot basis.
  const preCounts: Record<string, number> = {};

  const stamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);

  try {
    await dev.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    for (const t of [...TABLES.map((s) => s.name), ...BACKUP_ONLY]) {
      preCounts[t] = (await dev.query(`SELECT count(*)::int n FROM ${qi(t)}`)).rows[0].n;
    }

    // ── 1) Backup every dev table in the family, verbatim ───────────────────
    await dev.query(`CREATE SCHEMA IF NOT EXISTS ${qi(BACKUP_SCHEMA)}`);
    for (const t of [...TABLES.map((s) => s.name), ...BACKUP_ONLY]) {
      const bak = `${t}_${stamp}`;
      await dev.query(`CREATE TABLE ${qi(BACKUP_SCHEMA)}.${qi(bak)} AS TABLE ${qi(t)}`);
      const n = (await dev.query(`SELECT count(*)::int n FROM ${qi(BACKUP_SCHEMA)}.${qi(bak)}`)).rows[0].n;
      if (n !== preCounts[t]) throw new Error(`backup of ${t} incomplete (${n} != ${preCounts[t]})`);
      console.log(`==> backup ${BACKUP_SCHEMA}.${bak}: ${n} row(s)`);
    }

    // ── 2) Pre-flight: unique(token) can't collide across different ids ─────
    const prodTokens = await prod.query(`SELECT id, token FROM vrm_form_tokens`);
    if (prodTokens.rows.length) {
      const collide = await dev.query(
        `SELECT count(*)::int n FROM vrm_form_tokens d
         JOIN unnest($1::uuid[], $2::text[]) AS p(id, token) ON p.token = d.token AND p.id <> d.id`,
        [prodTokens.rows.map((r: any) => r.id), prodTokens.rows.map((r: any) => r.token)],
      );
      if (collide.rows[0].n > 0) {
        throw new Error(`token-string collision between prod and dev-native rows (${collide.rows[0].n}) — resolve manually`);
      }
    }

    // ── 3) Additive upserts, parent-first ────────────────────────────────────
    for (const spec of TABLES) {
      const t = spec.name;
      const pCols = await cols(prod, t);
      const dCols = await cols(dev, t);
      if (!pCols.length || !dCols.length) {
        console.log(`==> ${t}: missing on ${!pCols.length ? "prod" : "dev"} — skipped`);
        continue;
      }
      // Dev GENERATED/identity columns can't take explicit values — dev recomputes them.
      const devWritable = new Set(
        dCols.filter((r) => r.is_generated !== "ALWAYS" && r.identity_generation !== "ALWAYS").map((r) => r.column_name),
      );
      const common = pCols.map((r) => r.column_name).filter((c) => devWritable.has(c));
      if (!common.includes(spec.conflictKey)) throw new Error(`${t}: conflict key ${spec.conflictKey} not in common columns`);
      const colList = common.map(qi).join(", ");
      const updatable = common.filter((c) => !spec.frozenOnUpdate.includes(c));
      const onConflict = updatable.length
        ? `ON CONFLICT (${qi(spec.conflictKey)}) DO UPDATE SET ${updatable.map((c) => `${qi(c)} = EXCLUDED.${qi(c)}`).join(", ")}`
        : `ON CONFLICT (${qi(spec.conflictKey)}) DO NOTHING`;

      const data = await prod.query(`SELECT ${colList} FROM ${qi(t)}`);
      let inserted = 0;
      let updated = 0;
      for (let i = 0; i < data.rows.length; i += CHUNK) {
        const chunk = data.rows.slice(i, i + CHUNK);
        const params: unknown[] = [];
        const tuples = chunk
          .map((row: any, ri: number) => {
            const ph = common.map((_, ci) => `$${ri * common.length + ci + 1}`);
            common.forEach((c) => params.push(row[c]));
            return `(${ph.join(",")})`;
          })
          .join(",");
        // xmax=0 → freshly inserted; xmax<>0 → updated existing row
        const res = await dev.query(
          `INSERT INTO ${qi(t)} (${colList}) VALUES ${tuples} ${onConflict}
           RETURNING (xmax = 0) AS is_insert`,
          params,
        );
        for (const r of res.rows) (r.is_insert ? inserted++ : updated++);
      }

      // Repair serial/identity sequences bypassed by explicit-id inserts.
      for (const r of dCols) {
        if (typeof r.column_default === "string" && r.column_default.startsWith("nextval(")) {
          await dev.query(
            `SELECT setval(pg_get_serial_sequence('${t}', '${r.column_name}'),
                    COALESCE((SELECT max(${qi(r.column_name)}) FROM ${qi(t)}), 0) + 1, false)`,
          );
        }
      }
      console.log(`==> ${t}: prod rows ${data.rows.length} → inserted ${inserted}, updated ${updated} (dev-only rows untouched)`);
    }

    await prod.query("COMMIT"); // end the prod read-only snapshot
    await dev.query("COMMIT");
    console.log("\n✅ COMMITTED — prod survey/cutover data is now in dev (additively).");
  } catch (e) {
    await dev.query("ROLLBACK").catch(() => {});
    await prod.query("ROLLBACK").catch(() => {});
    throw e;
  }

  // ── Post-pull verification ─────────────────────────────────────────────────
  console.log("\n── verification ──");
  let failed = false;
  const check = async (label: string, sql: string, expectZero = false) => {
    const rows = (await dev.query(sql)).rows;
    const bad = expectZero && Number(rows[0]?.n) !== 0;
    if (bad) failed = true;
    console.log(`${bad ? "❌" : "  "} ${label}:`, JSON.stringify(rows));
  };

  for (const t of [...TABLES.map((s) => s.name), ...BACKUP_ONLY]) {
    const n = (await dev.query(`SELECT count(*)::int n FROM ${qi(t)}`)).rows[0].n;
    console.log(`  ${t}: ${preCounts[t]} → ${n}`);
    if (n < preCounts[t]) {
      failed = true;
      console.log(`❌ ${t} LOST ROWS`);
    }
  }
  // Every pre-pull dev row must still exist (id-preserving proof from backup).
  for (const t of ["vrm_form_tokens", "vrm_rental_tech_survey", "vrm_rental_request", "vrm_rental_cutover"]) {
    await check(
      `${t}: pre-pull rows missing`,
      `SELECT count(*)::int n FROM ${qi(BACKUP_SCHEMA)}.${qi(`${t}_${stamp}`)} b
       WHERE NOT EXISTS (SELECT 1 FROM ${qi(t)} d WHERE d.id = b.id)`,
      true,
    );
  }
  await check(
    "survey rows with orphan token_id",
    `SELECT count(*)::int n FROM vrm_rental_tech_survey s
     WHERE s.token_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM vrm_form_tokens t WHERE t.id = s.token_id)`,
    true,
  );
  await check(
    "request rows with orphan token/origin-survey",
    `SELECT count(*)::int n FROM vrm_rental_request r
     WHERE (r.token_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM vrm_form_tokens t WHERE t.id = r.token_id))
        OR (r.origin_survey_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM vrm_rental_tech_survey s WHERE s.id = r.origin_survey_id))`,
    true,
  );
  await check(
    "cutover rows with duplicate ldap (case-insensitive)",
    `SELECT count(*)::int n FROM (SELECT upper(ldap) FROM vrm_rental_cutover GROUP BY 1 HAVING count(*) > 1) x`,
    true,
  );
  await check(
    "unsent survey tokens now in dev (prod-owned; do NOT send from dev)",
    `SELECT count(*)::int n FROM vrm_form_tokens WHERE form_type = 'rental_tech_survey' AND sent_at IS NULL`,
  );

  await prod.end();
  await dev.end();
  if (failed) {
    console.error("\n❌ VERIFICATION FAILED — dev rows missing or integrity broken; restore from " + BACKUP_SCHEMA);
    process.exit(2);
  }
  console.log("\n✅ verification passed — no dev rows lost, joins intact.");
}

main().catch((e) => {
  console.error("PULL FAILED (dev transaction rolled back, nothing changed):", e?.message || e);
  process.exit(1);
});
