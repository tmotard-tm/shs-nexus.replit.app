/**
 * server/tpms-profile-resolver.ts
 *
 * Resolves a TPMS profile route identifier to exactly ONE tpms_tech_profiles row.
 *
 * TPMS Tech IDs are NOT unique in tpms_tech_profiles: multiple enterprise IDs
 * can share one tech_id (rehired/transferred techs, plus a 0000000 placeholder
 * group). Keying reads with limit(1) or updates on tech_id stamped one tech's
 * profile fields onto ALL rows sharing that tech_id (the
 * prod corruption). Resolution order:
 *   1. enterprise_id match (case-insensitive) wins — clients send it where available
 *   2. tech_id match is used ONLY when it is unambiguous
 *   3. ambiguous tech_ids get a 409 listing the candidate enterprise IDs
 * All writes must key on the resolved row's enterprise_id, never tech_id.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import { tpmsTechProfiles } from "@shared/schema";

export type ResolvedProfile =
  | { ok: true; profile: typeof tpmsTechProfiles.$inferSelect }
  | { ok: false; status: number; body: any };

export async function resolveTechProfile(idParam: string): Promise<ResolvedProfile> {
  const id = String(idParam || "").trim();
  if (!id) return { ok: false, status: 400, body: { message: "Tech identifier is required" } };
  const [byEid] = await db.select().from(tpmsTechProfiles)
    .where(sql`UPPER(${tpmsTechProfiles.enterpriseId}) = ${id.toUpperCase()}`).limit(1);
  if (byEid) return { ok: true, profile: byEid };
  const byTechId = await db.select().from(tpmsTechProfiles)
    .where(eq(tpmsTechProfiles.techId, id)).limit(5);
  if (byTechId.length === 0) {
    return { ok: false, status: 404, body: { message: "Tech profile not found" } };
  }
  if (byTechId.length > 1) {
    return {
      ok: false, status: 409,
      body: {
        message: `Tech ID ${id} matches multiple technicians — retry with an enterprise ID`,
        ambiguous: true,
        enterpriseIds: byTechId.map(p => p.enterpriseId),
      },
    };
  }
  return { ok: true, profile: byTechId[0] };
}
