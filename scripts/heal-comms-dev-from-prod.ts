/**
 * heal-comms-dev-from-prod.ts — restore a consistent fs_comms_* family in DEV
 * by snapshotting it from PROD.
 *
 * WHY THIS EXISTS (Aug 2026): a partial dev-from-prod refresh (interrupted
 * before its per-table loop finished) left the dev DB with PROD's
 * fs_comms_messages (prod thread ids) but DEV-native fs_comms_threads — so
 * every message row was orphaned (msgs_linked = 0). Symptom in the UI: the
 * inbox shows thread previews, but opening any thread says "No messages yet".
 *
 * WHAT IT DOES
 *   - Copies the whole comms family from prod → dev in ONE dev transaction
 *     (all-or-nothing; an interrupt can never half-copy again):
 *       fs_comms_threads, fs_comms_messages, fs_comms_thread_audit,
 *       fs_comms_contacts, fs_comms_optouts, fs_comms_phone_history,
 *       fs_comms_send_batches, fs_comms_send_queue, fs_comms_templates
 *   - Copies only columns present in BOTH schemas (drift-tolerant).
 *   - Repairs serial/identity sequences after explicit-id inserts.
 *   - SAFETY: neutralizes copied send-queue rows still 'pending'/'claimed'
 *     (sets them 'cancelled') so DEV can never re-send texts that PROD owns.
 *   - PROD session is forced READ ONLY; refuses to run if the dev URL points
 *     at the prod host+database.
 *
 * Run:  npx tsx scripts/heal-comms-dev-from-prod.ts
 * Idempotent: re-running just takes a fresh prod snapshot.
 */
import pg from "pg";

const { Client } = pg;
const CHUNK = 500;

const TABLES = [
  "fs_comms_threads",
  "fs_comms_messages",
  "fs_comms_thread_audit",
  "fs_comms_contacts",
  "fs_comms_optouts",
  "fs_comms_phone_history",
  "fs_comms_send_batches",
  "fs_comms_send_queue",
  "fs_comms_templates",
];

function hostDb(url: string): string {
  const u = new URL(url);
  return `${u.hostname}/${u.pathname.replace(/^\//, "")}`;
}

async function main() {
  const devUrl = process.env.DATABASE_URL; // the DB the app actually serves from
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

  const cols = async (c: InstanceType<typeof Client>, t: string) =>
    (
      await c.query(
        `SELECT column_name, column_default FROM information_schema.columns
         WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
        [t],
      )
    ).rows;

  try {
    await dev.query("BEGIN");

    for (const t of TABLES) {
      const pCols = await cols(prod, t);
      const dCols = await cols(dev, t);
      if (!pCols.length || !dCols.length) {
        console.log(`==> ${t}: missing on ${!pCols.length ? "prod" : "dev"} — skipped`);
        continue;
      }
      const devSet = new Set(dCols.map((r: any) => r.column_name));
      const common = pCols.map((r: any) => r.column_name).filter((c: string) => devSet.has(c));
      const colList = common.map((c: string) => `"${c.replace(/"/g, '""')}"`).join(", ");

      const data = await prod.query(`SELECT ${colList} FROM "${t}"`);
      await dev.query(`TRUNCATE TABLE "${t}"`);

      for (let i = 0; i < data.rows.length; i += CHUNK) {
        const chunk = data.rows.slice(i, i + CHUNK);
        const params: any[] = [];
        const tuples = chunk
          .map((row: any, ri: number) => {
            const ph = common.map((_, ci) => `$${ri * common.length + ci + 1}`);
            common.forEach((c) => params.push(row[c]));
            return `(${ph.join(",")})`;
          })
          .join(",");
        await dev.query(`INSERT INTO "${t}" (${colList}) VALUES ${tuples}`, params);
      }

      // Repair serial/identity sequences bypassed by explicit-id inserts.
      for (const r of dCols) {
        if (typeof r.column_default === "string" && r.column_default.startsWith("nextval(")) {
          await dev.query(
            `SELECT setval(pg_get_serial_sequence('${t}', '${r.column_name}'),
                    COALESCE((SELECT max("${r.column_name}") FROM "${t}"), 0) + 1, false)`,
          );
        }
      }
      console.log(`==> ${t}: copied ${data.rows.length} row(s)`);
    }

    // DEV MUST NEVER SEND PROD'S QUEUE: prod still owns its pending sends.
    const neut = await dev.query(
      `UPDATE fs_comms_send_queue
       SET status='cancelled',
           error_message='[heal-comms] prod-owned pending row neutralized in dev to prevent duplicate sends'
       WHERE status IN ('pending','claimed')`,
    );
    console.log(`==> send-queue: neutralized ${neut.rowCount ?? 0} pending/claimed row(s) in dev`);

    await dev.query("COMMIT");
    console.log("\n✅ COMMITTED — dev comms family is now a consistent prod snapshot.");
  } catch (e) {
    await dev.query("ROLLBACK").catch(() => {});
    throw e;
  }

  // ── Post-heal verification ────────────────────────────────────────────────
  const v = await dev.query(
    `SELECT (SELECT count(*) FROM fs_comms_threads) AS threads,
            (SELECT count(*) FROM fs_comms_messages) AS msgs,
            (SELECT count(*) FROM fs_comms_messages m
              WHERE EXISTS (SELECT 1 FROM fs_comms_threads t WHERE t.id = m.thread_id)) AS msgs_linked,
            (SELECT count(*) FROM fs_comms_threads t
              WHERE t.last_message_preview IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM fs_comms_messages m WHERE m.thread_id = t.id)) AS ghost_threads`,
  );
  console.log("Verification:", JSON.stringify(v.rows[0]));
  const a = await dev.query(
    `SELECT t.id, t.ldap, count(m.id) AS msgs
     FROM fs_comms_threads t LEFT JOIN fs_comms_messages m ON m.thread_id = t.id
     WHERE upper(coalesce(t.ldap,'')) = 'AUSHAKO' GROUP BY t.id, t.ldap`,
  );
  console.log("AUSHAKO:", JSON.stringify(a.rows));

  await prod.end();
  await dev.end();
}

main().catch((e) => {
  console.error("HEAL FAILED:", e?.message || e);
  process.exit(1);
});
