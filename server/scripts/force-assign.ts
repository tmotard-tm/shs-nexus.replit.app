/**
 * One-off script: directly assign truck 46863 to KMICKEL in TPMS, Holman, and AMS.
 * Run with:  npx tsx server/scripts/force-assign.ts
 */
import { getTPMSService } from "../tpms-service";
import { toTpmsRef, normalizeEnterpriseId } from "../vehicle-number-utils";

const LDAP_ID  = "KMICKEL";
const TRUCK_NO = "46863";

async function main() {
  console.log(`\n=== Force-assigning truck ${TRUCK_NO} to ${LDAP_ID} ===\n`);

  // ─── TPMS ────────────────────────────────────────────────────────────────
  try {
    const tpms = getTPMSService();

    console.log(`[TPMS] Fetching tech info for ${LDAP_ID}...`);
    const techInfo = await tpms.getTechInfo(LDAP_ID);
    console.log(`[TPMS] districtNo=${techInfo.districtNo}  currentTruck=${techInfo.truckNo}`);

    const tpmsTruckNo = toTpmsRef(TRUCK_NO); // "046863"
    const districtNo  = (techInfo.districtNo || "").trim();

    console.log(`[TPMS] Calling updateTechInfo: ldapId=${LDAP_ID}, truckNo=${tpmsTruckNo}, districtNo=${districtNo}`);
    const result = await tpms.updateTechInfo({
      ldapId: LDAP_ID,
      truckNo: tpmsTruckNo,
      districtNo,
      updatedBy: "TMOTARD",
    });
    console.log("[TPMS] Response:", JSON.stringify(result));
    console.log("[TPMS] ✓ Success\n");
  } catch (err: any) {
    console.error("[TPMS] ✗ Failed:", err.message, "\n");
  }

  // ─── Holman ──────────────────────────────────────────────────────────────
  try {
    const { holmanAssignmentUpdateService } = await import("../holman-assignment-update-service");
    const enterpriseId = normalizeEnterpriseId(LDAP_ID); // lowercase
    console.log(`[Holman] Submitting assign: truck=${TRUCK_NO}, tech=${enterpriseId}`);
    const result = await holmanAssignmentUpdateService.updateVehicleAssignment(TRUCK_NO, enterpriseId);
    console.log("[Holman] Response:", JSON.stringify(result));
    console.log(result.success ? "[Holman] ✓ Queued (pending Holman confirmation)\n" : "[Holman] ✗ Failed\n");
  } catch (err: any) {
    console.error("[Holman] ✗ Error:", err.message, "\n");
  }

  // ─── AMS ─────────────────────────────────────────────────────────────────
  try {
    const { AmsApiService } = await import("../ams-api-service");
    const ams = new AmsApiService();
    if (!ams.isConfigured()) {
      console.log("[AMS] Skipped — AMS not configured\n");
    } else {
      // Look up VIN by truck number
      const vehicles = await ams.searchVehicles({ vehicleNumber: TRUCK_NO, limit: 1, offset: 0 });
      const vehicle  = Array.isArray(vehicles) ? vehicles[0] : (vehicles?.data?.[0] ?? vehicles);
      const vin      = vehicle?.VIN ?? vehicle?.vin;
      if (!vin) {
        console.log("[AMS] Skipped — VIN not found for truck", TRUCK_NO, "\n");
      } else {
        console.log(`[AMS] Found VIN ${vin}, assigning tech ${LDAP_ID}...`);
        await ams.updateTechAssignment(vin, { techEnterpriseId: LDAP_ID, updateUser: "nexus" });
        console.log("[AMS] ✓ Success\n");
      }
    }
  } catch (err: any) {
    const msg = (err.message || "").toLowerCase();
    if (msg.includes("not found in tech database") || (msg.includes("tech") && msg.includes("not found"))) {
      console.log("[AMS] Skipped — KMICKEL not registered in AMS tech database\n");
    } else {
      console.error("[AMS] ✗ Error:", err.message, "\n");
    }
  }

  console.log("=== Done ===");
}

main().catch(console.error);
