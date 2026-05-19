/**
 * Manually trigger the nightly TPMS_EXTRACT → vrm_repair_tracker contact
 * refresh. Loads the TPMS snapshot from Snowflake, then overwrites stale
 * tech_phone / tech_name values on every repair-tracker row.
 */
import { refreshTpmsExtractSnapshot } from "../server/tpms-extract-snapshot";
import { refreshRepairTrackerTechContactsFromTpms } from "../server/vrm/storage";

async function main() {
  console.log("Refreshing TPMS_EXTRACT snapshot from Snowflake…");
  const snap = await refreshTpmsExtractSnapshot();
  console.log(
    `Snapshot: ok=${snap.ok}, rows=${snap.rowCount}, managers=${snap.managerCount}, ${snap.durationMs}ms`,
  );
  if (!snap.ok) {
    console.error("Snapshot refresh failed — aborting:", snap.error);
    process.exit(1);
  }
  const r = await refreshRepairTrackerTechContactsFromTpms();
  console.log(
    `Repair-tracker contact refresh: phoneUpdated=${r.phoneUpdated}, nameUpdated=${r.nameUpdated}, snapshotRows=${r.snapshotRows}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err?.message ?? err);
  process.exit(1);
});
