/**
 * Logical-entity layer init + seed. Runs at startup and is idempotent.
 * Creates the `logical_entities` and `entity_table_members` tables (raw
 * SQL so no Drizzle prompts) and seeds the four starter entities —
 * Vehicle, Technician, CostCenter, RepairShop — wiring them to whichever
 * physical data sources currently exist (matched by `integration_data_sources.name`).
 */
import { db } from "./db";
import { sql } from "drizzle-orm";

export async function initLogicalEntitiesSchema(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS logical_entities (
      id           VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      name         TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      description  TEXT,
      kind         TEXT NOT NULL DEFAULT 'domain',
      metadata     TEXT,
      created_at   TIMESTAMP NOT NULL DEFAULT now(),
      updated_at   TIMESTAMP NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS entity_table_members (
      id             VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_id      VARCHAR NOT NULL REFERENCES logical_entities(id) ON DELETE CASCADE,
      data_source_id VARCHAR NOT NULL REFERENCES integration_data_sources(id) ON DELETE CASCADE,
      role           TEXT NOT NULL DEFAULT 'cache',
      notes          TEXT,
      created_at     TIMESTAMP NOT NULL DEFAULT now(),
      UNIQUE (entity_id, data_source_id)
    );
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_entity_table_members_entity ON entity_table_members(entity_id);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_entity_table_members_source ON entity_table_members(data_source_id);`);
}

type SeedMember = { sourceName: string; role: 'canonical' | 'cache' | 'extension' | 'snapshot'; notes?: string };
type SeedEntity = {
  name: string;
  displayName: string;
  description: string;
  kind: 'domain' | 'reference' | 'workflow';
  members: SeedMember[];
};

// Sources are matched by name. Discovery names DB tables as `db_<table>`,
// API endpoints as `api_*`, Snowflake queries by their short name, and
// file imports as `import_*`. Seeded sources (from /api/mapping/seed-sources)
// use names like `tpms_tech_info`, `holman_vehicles`, `snowflake_all_techs`.
// Any name that doesn't match an existing source is silently skipped.
const SEED_ENTITIES: SeedEntity[] = [
  {
    name: 'vehicle',
    displayName: 'Vehicle',
    description: 'Physical service truck — represented across the operational DB, fleet-scope cache, Holman, AMS, and the VRM repair-tracker join target.',
    kind: 'domain',
    members: [
      { sourceName: 'db_vehicles',              role: 'canonical', notes: 'Operational Nexus vehicles table' },
      { sourceName: 'db_fs_trucks',             role: 'cache',     notes: 'Fleet-Scope working table' },
      { sourceName: 'db_holman_vehicles_cache', role: 'cache',     notes: 'Mirror of Holman fleet records' },
      { sourceName: 'db_ams_vehicles_cache',    role: 'cache',     notes: 'Mirror of AMS records' },
      { sourceName: 'db_vrm_repair_tracker',    role: 'extension', notes: 'VRM repair-tracker join target' },
      { sourceName: 'holman_vehicles',          role: 'canonical', notes: 'Holman Fleet API (live)' },
    ],
  },
  {
    name: 'technician',
    displayName: 'Technician',
    description: 'In-home service technician — backed by users, all_techs (Snowflake), the TPMS tech profile, and VRM techs.',
    kind: 'domain',
    members: [
      { sourceName: 'db_users',              role: 'canonical', notes: 'Nexus users (auth + role)' },
      { sourceName: 'db_all_techs',          role: 'cache',     notes: 'Local mirror of Snowflake roster' },
      { sourceName: 'db_tpms_tech_profiles', role: 'cache',     notes: 'TPMS profile snapshot' },
      { sourceName: 'db_vrm_techs',          role: 'extension', notes: 'VRM tech-state extension' },
      { sourceName: 'snowflake_all_techs',   role: 'canonical', notes: 'Snowflake DRIVELINE_ALL_TECHS (source of truth)' },
      { sourceName: 'tpms_tech_info',        role: 'canonical', notes: 'TPMS /techinfo (master for truck assignment + contact)' },
    ],
  },
  {
    name: 'cost_center',
    displayName: 'CostCenter / District',
    description: 'Field-service district / cost-center grouping used across fleet and onboarding.',
    kind: 'reference',
    members: [
      { sourceName: 'db_district_cost_centers', role: 'canonical', notes: 'Curated district↔cost-center mapping' },
      { sourceName: 'db_fs_cost_centers',       role: 'cache',     notes: 'Fleet-Scope cost-center cache' },
    ],
  },
  {
    name: 'repair_shop',
    displayName: 'RepairShop / Vendor',
    description: 'External repair vendor used by the VRM repair-tracker workflow.',
    kind: 'reference',
    members: [
      { sourceName: 'db_vrm_repair_shops',  role: 'canonical', notes: 'VRM repair-shop directory' },
      { sourceName: 'db_vrm_repair_tracker', role: 'extension', notes: 'Active repair tickets reference vendors' },
    ],
  },
];

export async function seedLogicalEntities(): Promise<{ created: number; linked: number; skipped: number }> {
  let created = 0;
  let linked = 0;
  let skipped = 0;

  for (const entity of SEED_ENTITIES) {
    const existing = await db.execute(sql`
      SELECT id FROM logical_entities WHERE name = ${entity.name} LIMIT 1
    `);
    let entityId: string | undefined = (existing.rows[0] as any)?.id;
    if (!entityId) {
      const ins = await db.execute(sql`
        INSERT INTO logical_entities (name, display_name, description, kind)
        VALUES (${entity.name}, ${entity.displayName}, ${entity.description}, ${entity.kind})
        RETURNING id
      `);
      entityId = (ins.rows[0] as any)?.id;
      created++;
    }
    if (!entityId) continue;

    for (const m of entity.members) {
      const src = await db.execute(sql`
        SELECT id FROM integration_data_sources WHERE name = ${m.sourceName} LIMIT 1
      `);
      const sourceId: string | undefined = (src.rows[0] as any)?.id;
      if (!sourceId) {
        skipped++;
        continue;
      }
      const linkRes = await db.execute(sql`
        INSERT INTO entity_table_members (entity_id, data_source_id, role, notes)
        VALUES (${entityId}, ${sourceId}, ${m.role}, ${m.notes ?? null})
        ON CONFLICT (entity_id, data_source_id) DO NOTHING
        RETURNING id
      `);
      if (linkRes.rows.length > 0) linked++;
    }
  }

  return { created, linked, skipped };
}
