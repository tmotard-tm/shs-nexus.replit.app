/**
 * Unit tests for vehicle_nexus_data truck-number normalization (pure, no DB).
 *
 * Covers the Assets Queue nexus-data fix: 5-digit Weekly Offboarding numbers
 * (61101/61456) and 6-digit TPMS/Holman numbers (061101/061456) must resolve
 * to the same row, and the Assets Queue batch mapping must preserve all
 * recovery fields (tools/parts location, parts recovery, phone recovery).
 *
 * No test framework in this repo — self-contained node:assert script:
 *
 *   npx tsx server/vehicle-nexus-normalization.test.ts
 *
 * Exits 0 when all cases pass, 1 otherwise.
 */
import assert from "node:assert/strict";
import { vehicleNumberVariants } from "../shared/vehicle-number-utils";
import {
  expandVehicleNumberVariants,
  pickLatestPerVehicle,
  resolveNexusVehicleNumber,
} from "./vehicle-nexus-normalization";
import {
  buildNexusBatchMap,
  collectItemTruckCandidates,
  getNexusMatchStatus,
  lookupNexusData,
  lookupNexusDataForItem,
  showToolsPartsRecovery,
  type NexusRecoveryFields,
  type TruckCandidateSource,
} from "../client/src/components/assets-queue/nexus-data-utils";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL - ${name}`);
    console.error(`    ${(err as Error).message}`);
  }
}

console.log("vehicleNumberVariants");

test("saved 61101 is findable when 061101 is requested", () => {
  const variants = vehicleNumberVariants("061101");
  assert.ok(variants.includes("61101"), `expected 61101 in ${JSON.stringify(variants)}`);
});

test("saved 061456 is findable when 61456 is requested", () => {
  const variants = vehicleNumberVariants("61456");
  assert.ok(variants.includes("061456"), `expected 061456 in ${JSON.stringify(variants)}`);
});

test("variants include raw, canonical, display, and tpms forms", () => {
  const variants = vehicleNumberVariants("0061456");
  assert.ok(variants.includes("0061456"), "raw");
  assert.ok(variants.includes("61456"), "canonical/display");
  assert.ok(variants.includes("061456"), "tpms 6-digit");
});

test("non-numeric values get no padded variants (BYOV stays BYOV)", () => {
  assert.deepEqual(vehicleNumberVariants("BYOV"), ["BYOV"]);
  assert.deepEqual(vehicleNumberVariants("N/A"), ["N/A"]);
});

test("empty/null inputs yield no variants", () => {
  assert.deepEqual(vehicleNumberVariants(null), []);
  assert.deepEqual(vehicleNumberVariants(undefined), []);
  assert.deepEqual(vehicleNumberVariants("  "), []);
});

console.log("expandVehicleNumberVariants");

test("expands and de-duplicates across requested numbers", () => {
  const out = expandVehicleNumberVariants(["61456", "061456", "61101"]);
  assert.ok(out.includes("61456"));
  assert.ok(out.includes("061456"));
  assert.ok(out.includes("61101"));
  assert.ok(out.includes("061101"));
  assert.equal(new Set(out).size, out.length, "no duplicates");
});

console.log("pickLatestPerVehicle");

test("collapses 61456 + 061456 duplicates to the most recently updated row", () => {
  const older = { id: "a", vehicleNumber: "061456", updatedAt: "2026-01-01T00:00:00Z", toolsPartsLocation: "in_the_truck" };
  const newer = { id: "b", vehicleNumber: "61456", updatedAt: "2026-06-01T00:00:00Z", toolsPartsLocation: "techs_home" };
  const result = pickLatestPerVehicle([older, newer]);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "b");
});

test("keeps distinct vehicles as separate rows", () => {
  const rows = [
    { id: "a", vehicleNumber: "61456", updatedAt: "2026-01-01T00:00:00Z" },
    { id: "b", vehicleNumber: "61101", updatedAt: "2026-01-01T00:00:00Z" },
  ];
  assert.equal(pickLatestPerVehicle(rows).length, 2);
});

console.log("resolveNexusVehicleNumber");

test("insert path stores the 5-digit display format", () => {
  assert.equal(resolveNexusVehicleNumber("061456", undefined, []), "61456");
});

test("update normalizes stored vehicle_number to display format", () => {
  const target = { id: "a", vehicleNumber: "061456" };
  assert.equal(resolveNexusVehicleNumber("061456", target, [target]), "61456");
});

test("update keeps existing number when another duplicate row already holds the display form", () => {
  const target = { id: "a", vehicleNumber: "061456" };
  const dupe = { id: "b", vehicleNumber: "61456" };
  assert.equal(resolveNexusVehicleNumber("061456", target, [target, dupe]), "061456");
});

console.log("buildNexusBatchMap / lookupNexusData (Assets Queue mapping)");

const batchResponse: Array<{ vehicleNumber: string } & Partial<NexusRecoveryFields>> = [
  {
    vehicleNumber: "61456",
    postOffboardedStatus: "In repair",
    toolsPartsLocation: "techs_home",
    partsRecoveryInitiated: "yes",
    phoneRecoveryInitiated: "no",
  },
];

test("mapping preserves all four recovery fields", () => {
  const map = buildNexusBatchMap(batchResponse);
  const entry = map["61456"];
  assert.ok(entry, "entry exists under canonical key");
  assert.equal(entry.postOffboardedStatus, "In repair");
  assert.equal(entry.toolsPartsLocation, "techs_home");
  assert.equal(entry.partsRecoveryInitiated, "yes");
  assert.equal(entry.phoneRecoveryInitiated, "no");
});

test("row saved as 61456 is found via 6-digit hrTruckNumber 061456", () => {
  const map = buildNexusBatchMap(batchResponse);
  const entry = lookupNexusData(map, "061456");
  assert.ok(entry);
  assert.equal(entry!.toolsPartsLocation, "techs_home");
});

test("row saved as 061101 is found via 5-digit lookup 61101", () => {
  const map = buildNexusBatchMap([{ vehicleNumber: "061101", postOffboardedStatus: "Not found" }]);
  const entry = lookupNexusData(map, "61101");
  assert.ok(entry);
  assert.equal(entry!.postOffboardedStatus, "Not found");
  assert.equal(entry!.toolsPartsLocation, null, "missing fields default to null, not undefined");
});

test("lookup ignores empty / N/A truck numbers", () => {
  const map = buildNexusBatchMap(batchResponse);
  assert.equal(lookupNexusData(map, null), undefined);
  assert.equal(lookupNexusData(map, "N/A"), undefined);
});

console.log("collectItemTruckCandidates / lookupNexusDataForItem (Assets Queue widened sources)");

test("collects candidates from all sources in priority order, including rosterContact.lastKnownTruckLu", () => {
  const item: TruckCandidateSource = {
    techData: { hrTruckNumber: "11111" },
    data: JSON.stringify({
      hrSeparation: { truckNumber: "22222" },
      vehicle: { truckNo: "33333", vehicleNumber: "44444" },
      rosterContact: { lastKnownTruckLu: "66666" },
    }),
    metadata: JSON.stringify({ tpmsTruckNo: "55555" }),
  };
  assert.deepEqual(
    collectItemTruckCandidates(item),
    ["11111", "22222", "33333", "44444", "55555", "66666"],
  );
});

test("MHUYNH2 case: garbage/missing hrTruckNumber falls back to rosterContact.lastKnownTruckLu (truck 21866)", () => {
  const map = buildNexusBatchMap([
    { vehicleNumber: "21866", postOffboardedStatus: "declined_repair", toolsPartsLocation: "techs_home", partsRecoveryInitiated: "yes", phoneRecoveryInitiated: "no" },
  ]);
  const item: TruckCandidateSource = {
    techData: { hrTruckNumber: "Truck was returned" },
    data: JSON.stringify({ rosterContact: { lastKnownTruckLu: "21866" } }),
  };
  assert.deepEqual(collectItemTruckCandidates(item), ["Truck was returned", "21866"]);
  const entry = lookupNexusDataForItem(map, item);
  assert.ok(entry, "expected MHUYNH2 to resolve via rosterContact.lastKnownTruckLu");
  assert.equal(entry!.postOffboardedStatus, "declined_repair");
});

test("candidates dedupe by canonical truck number", () => {
  const item: TruckCandidateSource = {
    techData: { hrTruckNumber: "61771" },
    data: JSON.stringify({ vehicle: { truckNo: "061771", vehicleNumber: "61771" } }),
    metadata: JSON.stringify({ tpmsTruckNo: "0061771" }),
  };
  assert.deepEqual(collectItemTruckCandidates(item), ["61771"]);
});

test("skips missing sources, empty strings, and N/A", () => {
  const item: TruckCandidateSource = {
    techData: { hrTruckNumber: "N/A" },
    data: JSON.stringify({ hrSeparation: { truckNumber: "" }, vehicle: { truckNo: null, vehicleNumber: "46163" } }),
    metadata: null,
  };
  assert.deepEqual(collectItemTruckCandidates(item), ["46163"]);
});

test("handles unparseable data/metadata JSON without throwing", () => {
  const item: TruckCandidateSource = {
    techData: { hrTruckNumber: "61101" },
    data: "not json",
    metadata: "also not json",
  };
  assert.deepEqual(collectItemTruckCandidates(item), ["61101"]);
});

test("lookupNexusDataForItem finds a row saved as 46163 when the item carries 046163 (CHEW case)", () => {
  const map = buildNexusBatchMap([
    { vehicleNumber: "46163", postOffboardedStatus: "reserved_for_new_hire", toolsPartsLocation: "in_the_truck", partsRecoveryInitiated: "yes", phoneRecoveryInitiated: "yes" },
  ]);
  const item: TruckCandidateSource = { metadata: JSON.stringify({ tpmsTruckNo: "046163" }) };
  const entry = lookupNexusDataForItem(map, item);
  assert.ok(entry, "expected a match for 046163 -> 46163");
  assert.equal(entry!.postOffboardedStatus, "reserved_for_new_hire");
});

test("lookupNexusDataForItem finds a row saved as 61771 when the item carries 061771 (FRANCO case)", () => {
  const map = buildNexusBatchMap([
    { vehicleNumber: "61771", postOffboardedStatus: "assigned_to_tech", phoneRecoveryInitiated: "yes" },
  ]);
  const item: TruckCandidateSource = { metadata: JSON.stringify({ tpmsTruckNo: "061771" }) };
  const entry = lookupNexusDataForItem(map, item);
  assert.ok(entry, "expected a match for 061771 -> 61771");
  assert.equal(entry!.postOffboardedStatus, "assigned_to_tech");
  assert.equal(entry!.phoneRecoveryInitiated, "yes");
});

test("lookupNexusDataForItem falls back through sources until one resolves", () => {
  const map = buildNexusBatchMap([{ vehicleNumber: "61456", postOffboardedStatus: "In repair" }]);
  const item: TruckCandidateSource = {
    techData: { hrTruckNumber: "N/A" },
    data: JSON.stringify({ vehicle: { truckNo: "99999" } }),
    metadata: JSON.stringify({ tpmsTruckNo: "61456" }),
  };
  const entry = lookupNexusDataForItem(map, item);
  assert.ok(entry, "expected fallback to metadata.tpmsTruckNo to resolve");
  assert.equal(entry!.postOffboardedStatus, "In repair");
});

test("lookupNexusDataForItem returns undefined when no candidate matches", () => {
  const map = buildNexusBatchMap([{ vehicleNumber: "61456", postOffboardedStatus: "In repair" }]);
  const item: TruckCandidateSource = { techData: { hrTruckNumber: "99999" } };
  assert.equal(lookupNexusDataForItem(map, item), undefined);
});

console.log("getNexusMatchStatus (no-recovery-data-found indicator)");

test("returns matched when a candidate resolves", () => {
  const map = buildNexusBatchMap([{ vehicleNumber: "61456", postOffboardedStatus: "In repair" }]);
  const item: TruckCandidateSource = { techData: { hrTruckNumber: "61456" } };
  assert.equal(getNexusMatchStatus(map, item), "matched");
});

test("returns no-candidate when the item has no resolvable truck number at all", () => {
  const map = buildNexusBatchMap([{ vehicleNumber: "61456", postOffboardedStatus: "In repair" }]);
  const item: TruckCandidateSource = { techData: { hrTruckNumber: "N/A" } };
  assert.equal(getNexusMatchStatus(map, item), "no-candidate");
});

test("returns no-match-found when a resolvable truck number has zero matching nexus rows", () => {
  const map = buildNexusBatchMap([{ vehicleNumber: "61456", postOffboardedStatus: "In repair" }]);
  const item: TruckCandidateSource = { techData: { hrTruckNumber: "99999" } };
  assert.equal(getNexusMatchStatus(map, item), "no-match-found");
});

test("no-match-found still fires when only the rosterContact fallback produced the candidate", () => {
  const map = buildNexusBatchMap([{ vehicleNumber: "61456", postOffboardedStatus: "In repair" }]);
  const item: TruckCandidateSource = {
    techData: { hrTruckNumber: "garbage text" },
    data: JSON.stringify({ rosterContact: { lastKnownTruckLu: "88888" } }),
  };
  assert.equal(getNexusMatchStatus(map, item), "no-match-found");
});

console.log("showToolsPartsRecovery business rule");

const noAction: NexusRecoveryFields = {
  postOffboardedStatus: null,
  toolsPartsLocation: "in_the_truck",
  partsRecoveryInitiated: null,
  phoneRecoveryInitiated: null,
};

test("company vehicle with tools in truck implies no Claudia task", () => {
  assert.equal(showToolsPartsRecovery("company", noAction), false);
  assert.equal(showToolsPartsRecovery("company", undefined), false);
});

test("company vehicle surfaces tools work when fields indicate action", () => {
  assert.equal(showToolsPartsRecovery("company", { ...noAction, toolsPartsLocation: "techs_home" }), true);
  assert.equal(showToolsPartsRecovery("company", { ...noAction, partsRecoveryInitiated: "yes" }), true);
});

test("BYOV and rental always surface tools/parts recovery", () => {
  assert.equal(showToolsPartsRecovery("byov", undefined), true);
  assert.equal(showToolsPartsRecovery("rental", noAction), true);
});

console.log("");
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
