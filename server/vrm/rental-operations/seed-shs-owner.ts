/**
 * One-time bucket-queue owner seed — carries the historical fs_trucks.shs_owner
 * column into the append-only vrm_rental_operation_actions ledger as manual
 * `assign_owner` rows, so the persona-bucket queue starts with the owners ops
 * already assigned instead of pure Annex A routing.
 *
 * Guarded by the app_settings key `bucket_queue_shs_owner_seeded`: runs once,
 * ever, per database (dev and prod each seed on their own first boot after
 * deploy). Append-only + skip-if-any-assign_owner-exists, so re-running can
 * never clobber a human's later assignment.
 *
 * Mapping is deliberately EXPLICIT (raw column value → bucket roster name) and
 * conservative: unknown/departed people (John C, Mandy R, Samantha W, blanks)
 * are skipped — their trucks fall to Annex A routing, which is the desired
 * behavior for unowned work. Do NOT reuse normalizeOwnerName here: it defaults
 * blanks to "Oscar S", which would pin every unowned truck to Oscar's bucket.
 */
import { db } from "../../db";
import { fsDb } from "../../fleet-scope-db";
import { sql } from "drizzle-orm";
import { getSetting, setSetting } from "../../app-settings";
import { OWNER_ROSTER } from "./annex-a-routing";

const SEED_FLAG = "bucket_queue_shs_owner_seeded";
const SEED_ACTOR = "seed:shs_owner";

/** Raw shs_owner text → bucket roster owner, or null when it must not seed. */
export function mapRawShsOwner(raw: string | null | undefined): string | null {
  const l = String(raw ?? "").trim().replace(/\s+/g, " ").toLowerCase().replace(/\.+$/, "");
  if (!l) return null;
  if (l.startsWith("olga")) return "Olga Fernandez";
  if (l === "rob a" || l.startsWith("rob a ") || l.startsWith("rob and")) return "Rob Anderson";
  if (l.startsWith("jenn")) return "Jennifer Dyer";
  if (l.includes("sandeep")) return "Sandeep Kalyani";
  if (l.startsWith("cheryl") || l.startsWith("monica")) return "Cheryl & Monica";
  if (l === "rob d" || l.startsWith("rob d ") || l.startsWith("robert d") || l.startsWith("andrea")) return "Rob D & Andrea";
  if (l.startsWith("carol") || l.startsWith("tasha")) return "Carol & Tasha";
  if (l.includes("oscar")) return "Oscar Santana";
  return null; // departed (John C, Mandy R), non-roster (Samantha W), or unrecognized
}

export async function seedShsOwnerAssignments(): Promise<void> {
  const done = await getSetting<boolean>(SEED_FLAG);
  if (done === true) return;

  const canon = (s: unknown): string =>
    String(s ?? "").trim().replace(/\D/g, "").replace(/^0+/, "") || "0";

  const [trucksRes, caseRes, existingRes] = await Promise.all([
    fsDb.execute(sql`
      SELECT truck_number, shs_owner FROM fs_trucks
      WHERE shs_owner IS NOT NULL AND btrim(shs_owner) <> ''
    `),
    db.execute(sql`
      SELECT case_key, vehicle_number_padded, vehicle_number
      FROM vrm_rental_operations_cases
      WHERE present_in_latest = true
    `),
    db.execute(sql`
      SELECT DISTINCT case_key FROM vrm_rental_operation_actions
      WHERE action_type = 'assign_owner'
    `),
  ]);

  const caseByCanon = new Map<string, string>();
  for (const r of (((caseRes as any).rows ?? []) as any[])) {
    caseByCanon.set(canon(r.vehicle_number_padded ?? r.vehicle_number ?? r.case_key), String(r.case_key));
  }
  const alreadyAssigned = new Set<string>();
  for (const r of (((existingRes as any).rows ?? []) as any[])) {
    alreadyAssigned.add(String(r.case_key));
  }

  let assignedCount = 0;
  let skipped = 0;
  let unmappable = 0;
  const values: ReturnType<typeof sql>[] = [];
  const seenKeys = new Set<string>();

  for (const r of (((trucksRes as any).rows ?? []) as any[])) {
    const raw = String(r.shs_owner ?? "").trim();
    const owner = mapRawShsOwner(raw);
    if (!owner) { unmappable++; continue; }
    if (!(OWNER_ROSTER as readonly string[]).includes(owner)) { unmappable++; continue; }
    // Seed onto the SAME key the queue builder uses: caseKey when the truck
    // has a live rental case, else the canonical truck number.
    const cKey = canon(r.truck_number);
    const key = caseByCanon.get(cKey) ?? cKey;
    if (key.length > 10) { skipped++; continue; }
    if (alreadyAssigned.has(key) || seenKeys.has(key)) { skipped++; continue; }
    seenKeys.add(key);
    values.push(sql`(${key}, 'assign_owner', ${owner}, ${JSON.stringify({ seededFrom: raw })}::jsonb, ${SEED_ACTOR})`);
    assignedCount++;
  }

  if (values.length > 0) {
    await db.execute(sql`
      INSERT INTO vrm_rental_operation_actions (case_key, action_type, assigned_to, payload, actor)
      VALUES ${sql.join(values, sql`, `)}
    `);
  }
  await setSetting(SEED_FLAG, true, SEED_ACTOR);
  console.log(`[bucket-queue] shs_owner seed: ${assignedCount} assigned, ${skipped} skipped, ${unmappable} unmappable`);
}
