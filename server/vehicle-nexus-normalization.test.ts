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
  lookupNexusData,
  showToolsPartsRecovery,
  type NexusRecoveryFields,
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
