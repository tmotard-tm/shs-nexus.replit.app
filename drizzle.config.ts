import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  out: "./migrations",
  schema: ["./shared/schema.ts", "./shared/vrm-schema.ts"],
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  // Tables this project builds itself, at boot, with CREATE TABLE IF NOT EXISTS
  // (server/vrm/**/schema.ts, init-schema.ts, and friends). Drizzle has never
  // declared them and has never managed them: production's
  // drizzle.__drizzle_migrations table has ZERO rows and always has.
  //
  // Left visible, every one of them reads to a schema differ as an orphan to
  // DROP. Measured 2026-09-02: 49 such tables in prod, 44 in dev. That is what
  // put a delete-everything migration in front of a publish. The trigger was
  // vrm_holman_portal_hist_changes appearing in prod between the clean publish
  // on 08-31 21:51 and 09-02, created by boot DDL the first time that code ran.
  //
  // Excluding them tells every tool these are not drizzle's to manage, which
  // was already true. Same mechanism as the pre-existing "!fs_*" line.
  // ⛔ If you add a new CREATE TABLE IF NOT EXISTS outside vrm_*, add it here.
  tablesFilter: [
    "!fs_*",
    "!vrm_*",
    "!ams_sweep_snapshot",
    "!byov_drift_checks",
    "!holman_po_sync_meta",
    "!holman_rental_po_queue",
    "!tpms_profile_heal_log",
  ],
});
