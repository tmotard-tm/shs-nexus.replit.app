import { fleetOpsService } from "../server/fleet-operations-service";

async function main() {
  console.log("=== Step 1: Unassign CLUGO from 046965 ===");
  console.log("Starting at", new Date().toISOString());

  const unassignResult = await fleetOpsService.unassignTech({
    truckNumber: "046965",
    ldapId: "CLUGO",
    requestedBy: "agent:post-mortem-verify",
    notes: "Clear stale TPMS owner so MMOHAM0 can be assigned (post-mortem 46965)",
  });
  console.log("Unassign result:");
  console.log(JSON.stringify(unassignResult, null, 2));

  if ("locked" in unassignResult && unassignResult.locked) {
    console.error("Vehicle is locked — aborting.");
    process.exit(1);
  }

  console.log("\n=== Step 2: Assign MMOHAM0 -> 46965 ===");
  const assignResult = await fleetOpsService.assignTech({
    truckNumber: "46965",
    ldapId: "MMOHAM0",
    techName: "MURTAZA MOHAMMADI",
    requestedBy: "agent:post-mortem-verify",
    notes: "Post-mortem verification of tpmsAlreadyCurrent fix (truck 46965 / MMOHAM0)",
  });
  console.log("Assign result:");
  console.log(JSON.stringify(assignResult, null, 2));

  process.exit(0);
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
