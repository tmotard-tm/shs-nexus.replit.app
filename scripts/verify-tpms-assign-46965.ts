import { fleetOpsService } from "../server/fleet-operations-service";

async function main() {
  console.log("=== TPMS assign verification: MMOHAM0 -> 46965 ===");
  console.log("Starting at", new Date().toISOString());

  const result = await fleetOpsService.assignTech({
    truckNumber: "46965",
    ldapId: "MMOHAM0",
    techName: "MURTAZA MOHAMMADI",
    requestedBy: "agent:post-mortem-verify",
    notes: "Post-mortem verification of tpmsAlreadyCurrent fix (truck 46965 / MMOHAM0)",
  });

  console.log("=== Result ===");
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
