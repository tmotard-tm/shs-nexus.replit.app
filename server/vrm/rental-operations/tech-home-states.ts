/**
 * employee_id -> home_state, straight from the roster. Shared by Cases by
 * Region, the ready-for-pickup notifier, and the bucket queue builder so all
 * three attach the SAME primary routing signal.
 *
 * `all_techs.home_state` is clean 2-letter codes (verified: 13,503 non-empty
 * rows, every one length 2), so no state-name normalisation is needed — but it
 * is upper-cased anyway so a future dirty row cannot silently miss. The trim +
 * UPPER matter: regionForState only accepts clean 2-letter codes, and the map
 * key must match String(employee_id).trim() exactly or routing silently loses
 * its primary signal.
 *
 * DO NOT source a tech's state from vrm_rental_identity_resolutions.state —
 * that column is the identity-resolution STATUS, not a US state (SOP B.5).
 */
import { db } from "../../db";
import { sql } from "drizzle-orm";

export async function loadTechHomeStates(): Promise<Map<string, string>> {
  const res: any = await db.execute(sql`
    SELECT employee_id, home_state
    FROM all_techs
    WHERE employee_id IS NOT NULL
      AND home_state IS NOT NULL
      AND btrim(home_state) <> ''`);
  const rows = (res?.rows ?? res ?? []) as Array<{ employee_id: string; home_state: string }>;
  const m = new Map<string, string>();
  for (const r of rows) {
    m.set(String(r.employee_id).trim(), String(r.home_state).trim().toUpperCase());
  }
  return m;
}
