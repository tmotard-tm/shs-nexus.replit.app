/**
 * VRM Rental Operations — tiny durable settings store.
 *
 * Exists for exactly one reason right now: Tyler's auto-text toggle (2026-07-29,
 * "create the ability to turn the automatic sending on with the click of a
 * button, once we validate the findings"). A behavior switch a human flips in
 * the UI has to survive restarts and deploys, so env vars are the wrong tool -
 * they need a redeploy to change, which is the opposite of "click of a button".
 *
 * Key/value with jsonb values so the next toggle costs zero DDL. The table is
 * ensured lazily on first use with CREATE TABLE IF NOT EXISTS - the house
 * pattern, since deploys run NO migrations on this app and the drizzle ledger
 * is vestigial (0 rows against 171 tables).
 */
import { db } from "../../db";
import { sql } from "drizzle-orm";

/** The auto-text switch. OFF until Tyler validates the pickup-text findings. */
export const SETTING_AUTO_TEXT_ON_READY = "auto_text_on_ready";

export interface SettingRow {
  value: any;
  updated_by: string | null;
  updated_at: string | null;
}

// Memoize SUCCESS only. A failed ensure that stayed memoized would poison every
// later read for the process lifetime (the exact trap the inbound module hit
// with its column probe).
let ensured: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (!ensured) {
    ensured = db
      .execute(sql`
        CREATE TABLE IF NOT EXISTS vrm_rental_ops_settings (
          key        VARCHAR(60) PRIMARY KEY,
          value      JSONB NOT NULL,
          updated_by VARCHAR(120),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`)
      .then(() => undefined)
      .catch((e) => {
        ensured = null;
        throw e;
      });
  }
  return ensured;
}

export async function getSetting(key: string): Promise<SettingRow | null> {
  await ensureTable();
  const res = await db.execute<{ value: any; updated_by: string | null; updated_at: string }>(sql`
    SELECT value, updated_by, to_char(updated_at,'YYYY-MM-DD"T"HH24:MI:SSZ') AS updated_at
    FROM vrm_rental_ops_settings WHERE key = ${key} LIMIT 1`);
  const r = (res.rows ?? [])[0];
  return r ? { value: r.value, updated_by: r.updated_by, updated_at: r.updated_at } : null;
}

export async function setSetting(key: string, value: unknown, actor: string): Promise<void> {
  await ensureTable();
  await db.execute(sql`
    INSERT INTO vrm_rental_ops_settings (key, value, updated_by, updated_at)
    VALUES (${key}, ${JSON.stringify(value)}::jsonb, ${actor}, NOW())
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`);
}

/** The one gate the notify hook reads. Absent row = OFF, always. */
export async function isAutoTextOnReadyEnabled(): Promise<boolean> {
  try {
    const s = await getSetting(SETTING_AUTO_TEXT_ON_READY);
    return s?.value?.enabled === true;
  } catch (e: any) {
    // A settings read failure must fail CLOSED: no auto-text on a broken read.
    console.warn("[VRM/Settings] auto-text read failed (treating as OFF):", e?.message || e);
    return false;
  }
}
