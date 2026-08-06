/**
 * Pep Boys store directory — DDL, boot seed, and the shop-phone lookup lateral.
 *
 * WHY (Tyler, 2026-08-05): the current-shop phone shown on the queues/feeds
 * came from portal scrapes, which carry placeholder junk (222-222-2222 on 17
 * trucks) and phones belonging to a DIFFERENT vendor than the shop displayed.
 * Pep Boys is the primary repair vendor, and the operator supplied the full
 * store list ("Copy of Pep Boys Store locations 06.02.2026") as the source of
 * truth: "Once we know what location it's at, we can make sure we have the
 * right phone number for the PepBoys."
 *
 * The seed follows the boot-DDL/self-heal pattern (deploys run no migrations):
 * CREATE IF NOT EXISTS + a value-guarded upsert, so a republish heals prod and
 * an unchanged sheet is a no-op.
 */
import { db } from "../../db";
import { sql, type SQL } from "drizzle-orm";
import { PEPBOYS_LOCATIONS } from "./pepboys-locations.data";

export async function initPepBoysDirectory(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_pepboys_locations (
      store_number          VARCHAR(10) PRIMARY KEY,
      store_name            TEXT,
      address               TEXT,
      city                  TEXT,
      state                 VARCHAR(2),
      zip                   VARCHAR(10),
      phone                 VARCHAR(20),
      service_manager_email TEXT,
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  // Value-guarded upsert in chunks: identical rows produce zero writes, so the
  // boot cost of an unchanged directory is a handful of no-op statements.
  const CHUNK = 200;
  for (let i = 0; i < PEPBOYS_LOCATIONS.length; i += CHUNK) {
    const rows = PEPBOYS_LOCATIONS.slice(i, i + CHUNK).map(
      (l) => sql`(${l.store}, ${l.name}, ${l.address}, ${l.city}, ${l.state}, ${l.zip}, ${l.phone}, ${l.email})`,
    );
    await db.execute(sql`
      INSERT INTO vrm_pepboys_locations
        (store_number, store_name, address, city, state, zip, phone, service_manager_email)
      VALUES ${sql.join(rows, sql`, `)}
      ON CONFLICT (store_number) DO UPDATE SET
        store_name = EXCLUDED.store_name, address = EXCLUDED.address,
        city = EXCLUDED.city, state = EXCLUDED.state, zip = EXCLUDED.zip,
        phone = EXCLUDED.phone, service_manager_email = EXCLUDED.service_manager_email,
        updated_at = now()
      WHERE (vrm_pepboys_locations.store_name, vrm_pepboys_locations.address,
             vrm_pepboys_locations.city, vrm_pepboys_locations.state,
             vrm_pepboys_locations.zip, vrm_pepboys_locations.phone,
             vrm_pepboys_locations.service_manager_email)
        IS DISTINCT FROM
            (EXCLUDED.store_name, EXCLUDED.address, EXCLUDED.city, EXCLUDED.state,
             EXCLUDED.zip, EXCLUDED.phone, EXCLUDED.service_manager_email)
    `);
  }
}

/**
 * LEFT JOIN LATERAL resolving the directory phone for a shop-of-record row
 * (`shopAlias` must expose vendor_name / vendor_zip / vendor_city /
 * vendor_state — i.e. a shop_pick/shop_strict alias). Emits columns
 * `pb_phone` and `pb_matched_by` ('store' | 'zip' | 'city').
 *
 * Match precedence: the store number embedded in the vendor name ("PEP BOYS
 * # 1649") is exact; the PO's zip is next; city+state last (may be ambiguous
 * in cities with several stores — callers should prefer a same-vendor scraped
 * phone over a city-level directory match, see the precedence chains).
 */
export function pepBoysPhoneLateral(shopAlias: string, lateralAlias = "pbdir"): SQL {
  const s = sql.raw(shopAlias);
  const a = sql.raw(lateralAlias);
  return sql`
    LEFT JOIN LATERAL (
      SELECT pb.phone AS pb_phone,
             CASE
               WHEN NULLIF(ltrim(regexp_replace(${s}.vendor_name, '[^0-9]', '', 'g'), '0'), '')
                    = ltrim(pb.store_number, '0') THEN 'store'
               WHEN NULLIF(left(regexp_replace(COALESCE(${s}.vendor_zip, ''), '[^0-9]', '', 'g'), 5), '')
                    = pb.zip THEN 'zip'
               ELSE 'city'
             END AS pb_matched_by
      FROM vrm_pepboys_locations pb
      WHERE ${s}.vendor_name ~* 'PEP *BOYS'
        AND COALESCE(pb.phone, '') <> ''
        AND (
          NULLIF(ltrim(regexp_replace(${s}.vendor_name, '[^0-9]', '', 'g'), '0'), '')
            = ltrim(pb.store_number, '0')
          OR NULLIF(left(regexp_replace(COALESCE(${s}.vendor_zip, ''), '[^0-9]', '', 'g'), 5), '')
            = pb.zip
          OR (upper(COALESCE(${s}.vendor_city, '')) = upper(pb.city)
              AND upper(COALESCE(${s}.vendor_state, '')) = upper(pb.state))
        )
      ORDER BY
        (NULLIF(ltrim(regexp_replace(${s}.vendor_name, '[^0-9]', '', 'g'), '0'), '')
           = ltrim(pb.store_number, '0')) DESC NULLS LAST,
        (NULLIF(left(regexp_replace(COALESCE(${s}.vendor_zip, ''), '[^0-9]', '', 'g'), 5), '')
           = pb.zip) DESC NULLS LAST,
        pb.store_number
      LIMIT 1
    ) ${a} ON true`;
}
