/**
 * Make sure the technician exists as an ETD user before we try to book for them.
 *
 * Why this exists (2026-08-25): three technicians failed to book in one afternoon
 * with `no ETD user for <LDAP>`, and each one had to be created by hand. The check
 * itself already existed, but it sat AFTER the quote, and `quote()` creates a
 * journey assessment as its first act, so every failure also left an orphan draft
 * on the Enterprise account.
 *
 * Why the synced table is not good enough: `tpms_tech_profiles` is filled by an
 * incremental "updated after" sync, so it never backfills somebody it has not
 * already seen. Measured that day: 107 active technicians had no row in it at all,
 * which is precisely the new-hire population that fails to book. All three of the
 * failures were absent from the table and present in live TPMS. So this calls the
 * API, never the table.
 *
 * TPMS returns everything the ETD payload needs, already formatted:
 *   { ldapId, firstName, lastName, contactNo, email: "<phone>@tmomail.net" }
 *
 * ⚠ The email is not a delivery channel, it is the identifier ETD keys on, and it
 * is an SMS gateway address. A wrong number texts a stranger the rental
 * confirmation, so the phone is validated before it is ever used.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { getTpmsApiService } from "../../tpms-api-service";
import { EtdClient, ROLE_EMPLOYEE } from "./client";
import { recordUserMapping } from "./surgery";

const GATEWAY = "tmomail.net";

export interface EnsuredUser {
  /** The name to book under. May be SHS-<LDAP> after a namespace collision. */
  username: string;
  created: boolean;
  /** Where the identity came from, for the audit row. */
  source: "existing" | "existing-shs" | "tpms";
}

/**
 * Ten significant digits, or "" when this is not a usable US mobile number.
 *
 * Rejects the shapes that show up in roster data and would otherwise become a
 * live SMS-gateway address: short numbers, an area code starting 0 or 1, and
 * repeated-digit placeholders like 9999999999.
 */
export function tenDigits(raw: unknown): string {
  const d = String(raw ?? "").replace(/[^0-9]/g, "");
  const n = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (n.length !== 10) return "";
  if (n[0] === "0" || n[0] === "1") return "";
  if (n[3] === "0" || n[3] === "1") return "";
  if (/^(\d)\1{9}$/.test(n)) return "";
  return n;
}

/** Prefer the address TPMS already built; fall back to composing it. */
function addressFor(tech: any): string {
  const fromEmail = tenDigits(String(tech?.email ?? "").split("@")[0]);
  const fromPhone = tenDigits(tech?.contactNo ?? tech?.mobilePhone ?? tech?.phone);
  const phone = fromEmail || fromPhone;
  return phone ? `${phone}@${GATEWAY}` : "";
}

async function audit(note: string, added: number, failed: number): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO vrm_etd_churn_log (id, ran_at, dry_run, to_add, added, failed, note)
      VALUES (gen_random_uuid(), now(), false, 1, ${added}, ${failed}, ${note})`);
  } catch (err) {
    // An audit failure must never take a booking down with it.
    console.error("[etd-user] could not write churn-log row:", err);
  }
}

/**
 * Resolve the ETD username for this LDAP, creating the seat from live TPMS when
 * it does not exist yet. Throws only when the technician cannot be identified,
 * which is a real task for a human, not a booking failure.
 */
export async function ensureEtdUser(
  etd: EtdClient,
  ldap: string,
  mapping: Record<string, string>,
): Promise<EnsuredUser> {
  const id = String(ldap || "").trim().toUpperCase();
  if (!id) throw new Error("ensureEtdUser called with an empty LDAP");

  const mapped = mapping[id] || id;
  if (await etd.findUserByUsername(mapped)) {
    return { username: mapped, created: false, source: "existing" };
  }

  // A seat can exist under the collision name while the mapping file is behind,
  // which is exactly how 29 profiles went invisible to the roster audit. Look
  // before creating a duplicate, and write the mapping down when we find one.
  const shs = `SHS-${id}`;
  if (mapped !== shs && (await etd.findUserByUsername(shs))) {
    recordUserMapping(id, shs);
    await audit(`${id}: found existing ${shs}, mapping repaired`, 0, 0);
    return { username: shs, created: false, source: "existing-shs" };
  }

  let tech: any;
  try {
    tech = await getTpmsApiService().getTechById(id);
  } catch (err) {
    await audit(`${id}: TPMS lookup failed: ${String((err as Error)?.message ?? err).slice(0, 200)}`, 0, 1);
    throw new Error(`TPMS lookup failed for ${id}`);
  }
  const first = String(tech?.firstName ?? "").trim();
  const last = String(tech?.lastName ?? "").trim();
  const email = addressFor(tech);
  if (!first || !last) {
    await audit(`${id}: TPMS has no name for this LDAP`, 0, 1);
    throw new Error(`TPMS has no name for ${id}`);
  }
  if (!email) {
    // Deliberately its own message. "No phone" is a task somebody can act on;
    // "no ETD user" sends them hunting a booking bug that is not there.
    await audit(`${id}: no usable phone in TPMS, seat not created`, 0, 1);
    throw new Error(`no usable phone in TPMS for ${id}`);
  }

  let username = id;
  let lastErr = "";
  for (const candidate of [id, shs]) {
    try {
      await etd.createUser({ firstName: first, lastName: last, email, username: candidate, role: ROLE_EMPLOYEE });
      username = candidate;
      lastErr = "";
      break;
    } catch (err) {
      lastErr = String((err as Error)?.message ?? err);
      // Anything other than a taken username is a real failure; do not burn the
      // collision name on it.
      if (!/already in use/i.test(lastErr)) break;
    }
  }
  if (lastErr) {
    await audit(`${id}: create failed: ${lastErr.slice(0, 200)}`, 0, 1);
    throw new Error(`could not create an ETD user for ${id}: ${lastErr.slice(0, 160)}`);
  }

  // Read back by username. The create call answering 200 is not the same as the
  // seat being there, and booking against a seat that is not there is worse than
  // stopping here.
  const back = await etd.findUserByUsername(username);
  if (!back) {
    await audit(`${id}: created ${username} but it did not appear in search`, 0, 1);
    throw new Error(`${username} reported created but did not appear in ETD`);
  }
  if (username !== id) recordUserMapping(id, username);

  console.log(`[etd-user] created ${username} (${first} ${last}, ${email}) from live TPMS`);
  await audit(`${id}: created ${username} <${email}> from live TPMS`, 1, 0);
  return { username, created: true, source: "tpms" };
}
