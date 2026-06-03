-- Logical entity layer for the Data Lineage Canvas (Task #414).
-- Adds an abstraction over physical data sources so concepts like
-- "Vehicle" or "Technician" (each backed by multiple physical tables /
-- caches) can be visualised as a single node with the union of their
-- fields. Memberships are human-curated and survive "Refresh from code".

CREATE TABLE IF NOT EXISTS logical_entities (
  id           VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description  TEXT,
  kind         TEXT NOT NULL DEFAULT 'domain', -- domain | reference | workflow
  metadata     TEXT,
  created_at   TIMESTAMP NOT NULL DEFAULT now(),
  updated_at   TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS entity_table_members (
  id             VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id      VARCHAR NOT NULL REFERENCES logical_entities(id) ON DELETE CASCADE,
  data_source_id VARCHAR NOT NULL REFERENCES integration_data_sources(id) ON DELETE CASCADE,
  role           TEXT NOT NULL DEFAULT 'cache', -- canonical | cache | extension | snapshot
  notes          TEXT,
  created_at     TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (entity_id, data_source_id)
);

CREATE INDEX IF NOT EXISTS idx_entity_table_members_entity ON entity_table_members(entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_table_members_source ON entity_table_members(data_source_id);
