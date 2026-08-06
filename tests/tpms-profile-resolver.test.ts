/**
 * tests/tpms-profile-resolver.test.ts
 *
 * Regression test for the shared-tech_id name-stamping corruption:
 * multiple enterprise IDs can share one TPMS tech_id in tpms_tech_profiles,
 * so the resolver must
 *   - resolve an enterprise_id (any case) to exactly that row, even when its
 *     tech_id is shared (no 409 when enterprise_id is provided),
 *   - resolve an unambiguous tech_id,
 *   - 409 (ambiguous + candidate enterpriseIds) on a shared tech_id,
 *   - 404 unknown ids, 400 empty ids,
 * and enterprise_id-keyed updates must never touch the sibling row.
 *
 * Runs against the dev DATABASE_URL with self-cleaning fixture rows.
 *
 *   npx tsx --test tests/tpms-profile-resolver.test.ts
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../server/db";
import { tpmsTechProfiles } from "../shared/schema";
import { resolveTechProfile } from "../server/tpms-profile-resolver";

const SHARED_TECH_ID = "9990001";
const UNIQUE_TECH_ID = "9990002";
const EID_A = "ZZTESTA0";
const EID_B = "ZZTESTB0";
const EID_C = "ZZTESTC0";
const ALL_EIDS = [EID_A, EID_B, EID_C];

before(async () => {
  await db.delete(tpmsTechProfiles).where(inArray(tpmsTechProfiles.enterpriseId, ALL_EIDS));
  await db.insert(tpmsTechProfiles).values([
    { techId: SHARED_TECH_ID, enterpriseId: EID_A, firstName: "ALICE", lastName: "ALPHA" },
    { techId: SHARED_TECH_ID, enterpriseId: EID_B, firstName: "BOB", lastName: "BRAVO" },
    { techId: UNIQUE_TECH_ID, enterpriseId: EID_C, firstName: "CARA", lastName: "CHARLIE" },
  ]);
});

after(async () => {
  await db.delete(tpmsTechProfiles).where(inArray(tpmsTechProfiles.enterpriseId, ALL_EIDS));
  await pool.end();
});

test("enterprise_id resolves its own row even when tech_id is shared (no 409)", async () => {
  const r = await resolveTechProfile(EID_B);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.profile.enterpriseId, EID_B);
    assert.equal(r.profile.firstName, "BOB");
  }
});

test("enterprise_id resolution is case-insensitive", async () => {
  const r = await resolveTechProfile(EID_A.toLowerCase());
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.profile.enterpriseId, EID_A);
});

test("unambiguous tech_id resolves", async () => {
  const r = await resolveTechProfile(UNIQUE_TECH_ID);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.profile.enterpriseId, EID_C);
});

test("shared tech_id returns 409 with candidate enterprise IDs", async () => {
  const r = await resolveTechProfile(SHARED_TECH_ID);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.status, 409);
    assert.equal(r.body.ambiguous, true);
    const eids = [...r.body.enterpriseIds].sort();
    assert.deepEqual(eids, [EID_A, EID_B]);
  }
});

test("unknown id 404s, empty id 400s", async () => {
  const missing = await resolveTechProfile("ZZNOSUCH");
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.status, 404);
  const empty = await resolveTechProfile("   ");
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.status, 400);
});

test("enterprise_id-keyed update never touches the shared-tech_id sibling", async () => {
  // Simulate the fixed PUT route: resolve, then UPDATE keyed on enterprise_id.
  const r = await resolveTechProfile(EID_A);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  await db.update(tpmsTechProfiles)
    .set({ firstName: "ALICIA", lastName: "ALPHA-EDITED", updatedAt: new Date() })
    .where(eq(tpmsTechProfiles.enterpriseId, r.profile.enterpriseId));

  const [rowA] = await db.select().from(tpmsTechProfiles).where(eq(tpmsTechProfiles.enterpriseId, EID_A));
  const [rowB] = await db.select().from(tpmsTechProfiles).where(eq(tpmsTechProfiles.enterpriseId, EID_B));
  assert.equal(rowA.firstName, "ALICIA");
  assert.equal(rowB.firstName, "BOB"); // sibling untouched — the old tech_id-keyed UPDATE stamped it
  assert.equal(rowB.lastName, "BRAVO");
});
