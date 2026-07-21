/**
 * One-time Rightsize tracker baseline seed. Loads the hand-verified 7/17 EOD
 * verdicts (285 techs) with enrichment (name/position/phone/TL/district) and
 * vehicle economics into vrm_rightsize_techs, then runs one sync to catch up
 * on everything received since 7/17 4 PM ET.
 *
 * Usage (on the box):  npx tsx server/run-vrm-rightsize-seed.ts /tmp/rightsize-seed.json
 * Idempotent: existing rows keep their stage unless still on baseline source.
 */
import fs from "fs";

async function main() {
  const path = process.argv[2] || "/tmp/rightsize-seed.json";
  const raw = JSON.parse(fs.readFileSync(path, "utf8"));
  const techs: any[] = raw.techs;
  if (!Array.isArray(techs) || !techs.length) throw new Error("seed file has no techs[]");

  const { db } = await import("./db");
  const { sql } = await import("drizzle-orm");
  const { initRightsizeSchema } = await import("./vrm/rightsize/schema");

  await db.execute(sql`SELECT 1`); // cold-pool warm-up (first-write drop gotcha)
  await initRightsizeSchema();

  let inserted = 0, updated = 0, kept = 0;
  for (const t of techs) {
    const cur = await db.execute(sql`SELECT stage_source FROM vrm_rightsize_techs WHERE ldap = ${t.ldap}`);
    if (!cur.rows.length) {
      await db.execute(sql`
        INSERT INTO vrm_rightsize_techs
          (ldap, tech_name, position, phone_digits, district, tl_name, tl_phone, round, stage, stage_source,
           decisive_at, decisive_text, vehicle, car_class, class_bucket, daily_rate, updated_at)
        VALUES (${t.ldap}, ${t.tech_name ?? null}, ${t.position ?? null}, ${t.phone_digits ?? null}, ${t.district ?? null},
                ${t.tl_name ?? null}, ${t.tl_phone ?? null}, ${t.round ?? 1}, ${t.stage}, 'baseline_0717',
                ${t.decisive_at ?? null}, ${t.decisive_text ?? null}, ${t.vehicle ?? null}, ${t.car_class ?? null},
                ${t.class_bucket ?? null}, ${t.daily_rate ?? null}, NOW())
      `);
      inserted += 1;
    } else if ((cur.rows[0] as any).stage_source === "baseline_0717") {
      await db.execute(sql`
        UPDATE vrm_rightsize_techs
        SET tech_name = ${t.tech_name ?? null}, position = ${t.position ?? null}, phone_digits = ${t.phone_digits ?? null},
            district = ${t.district ?? null}, tl_name = ${t.tl_name ?? null}, tl_phone = ${t.tl_phone ?? null},
            stage = ${t.stage}, vehicle = ${t.vehicle ?? null}, car_class = ${t.car_class ?? null},
            class_bucket = ${t.class_bucket ?? null}, daily_rate = ${t.daily_rate ?? null}, updated_at = NOW()
        WHERE ldap = ${t.ldap}
      `);
      updated += 1;
    } else {
      kept += 1; // manual/auto progress wins over a re-seed
    }
  }
  console.log(`[Rightsize seed] inserted=${inserted} updated=${updated} kept=${kept} of ${techs.length}`);

  const { runRightsizeSync } = await import("./vrm/rightsize/sync");
  const res = await runRightsizeSync({ trigger: "seed" });
  console.log("[Rightsize seed] catch-up sync:", JSON.stringify({ ...res, kpis: undefined }));
  console.log("[Rightsize seed] KPIs:", JSON.stringify(res.kpis));
  process.exit(0);
}

main().catch((e) => { console.error("[Rightsize seed] FAILED:", e?.message || e); process.exit(1); });
