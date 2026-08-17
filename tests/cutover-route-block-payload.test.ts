/**
 * The cutover route-block payload contract.
 *
 * This drives `buildCutoverBlockArgs` — the SAME function the live
 * `/forms/rental-survey/file-route-blocks` lane calls — and then pushes its
 * output through the real payload builder. Asserting the builder alone would
 * be worthless here: the builder was always capable of sending 08:00 and
 * a ZIP5, and the lane still sent "Anytime" and a ZIP+4. The rule has to be
 * tested where the lane decides it.
 *
 * Two rules, both measured against PRD_SERVICEPOWER.BATCH_TBLS.SCH_ACTIVITIES_PROD
 * on 2026-08-17 after the first 151 blocks were filed:
 *
 *   1. Every technician's block starts at 8:00 AM, EXACT. Filed with "Anytime",
 *      only 11 of the 136 blocks that landed came back at 08:00:00 — the rest
 *      scattered from 06:23 to 15:55, against a text promising 8:00 AM.
 *   2. LocationValue carries the FULL ZIP of the branch the reservation was
 *      booked at, including the +4 when the stored address has one (Tyler,
 *      2026-08-17). Not a street number, and never empty — no ZIP, no filing.
 *      Plenty of branch addresses carry no +4, so five digits is still valid
 *      when that is all the address holds.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildStandardActivityPayload,
  ROUTE_BLOCK_START_TIME,
  ROUTE_BLOCK_START_TIME_REQUEST,
  type StandardActivityArgs,
} from "../server/vrm/dca-task-client";
import {
  branchZip,
  buildCutoverBlockArgs,
  type CutoverBlockInput,
} from "../server/vrm/forms/cutover-block-args";

/** A candidate row as the lane's SQL hands it over. */
function candidate(over: Partial<CutoverBlockInput> = {}): CutoverBlockInput {
  return {
    ldap: "JDOE",
    unit: "MWR31",
    truckNumber: "061385",
    branchName: "El Paso Dyer & Tetons",
    branchAddress: "EL PASO DYER & TETONS, 8555 DYER STREET,EL PASO,79904-2805",
    date: "2026-08-18",
    live: true,
    ...over,
  };
}

/** The args the lane would hand the sender, or throw if it refused. */
function argsFor(input: CutoverBlockInput): StandardActivityArgs {
  const d = buildCutoverBlockArgs(input);
  assert.equal(d.ok, true, `expected the lane to build args, got refusal: ${(d as any).reason}`);
  return (d as { ok: true; args: StandardActivityArgs }).args;
}

/** The row that actually goes on the wire. */
function wire(input: CutoverBlockInput): Record<string, any> {
  return (buildStandardActivityPayload(argsFor(input)).body as any).exportData[0];
}

describe("branchZip", () => {
  test("keeps the +4 when the branch address carries one", () => {
    assert.equal(
      branchZip("EL PASO DYER & TETONS, 8555 DYER STREET,EL PASO,79904-2805"),
      "79904-2805",
    );
  });

  test("takes a plain trailing ZIP5", () => {
    assert.equal(branchZip("KAHULUI HANA HWY., 40 HANA HWY,KAHULUI,96732"), "96732");
  });

  test("is not fooled by a five-digit street number", () => {
    assert.equal(branchZip("11130 FUQUA ST, HOUSTON, 77034"), "77034");
  });

  test("returns empty when the address carries no ZIP", () => {
    assert.equal(branchZip("SOME BRANCH, MAIN STREET, HOUSTON"), "");
    assert.equal(branchZip(""), "");
    assert.equal(branchZip(null), "");
    assert.equal(branchZip(undefined), "");
  });
});

describe("the lane's decision — 8:00 AM for every tech", () => {
  test("pins 08:00 by sending it in BOTH fields, as the reference requires", () => {
    // Standard_Activities_API_Reference_Guide: "To pin an exact time, send a HH:MM
    // value here and match it in StartTime." "Exact" was invented here and is not a
    // value the API defines.
    const a = argsFor(candidate());
    assert.equal(a.startTime, "08:00");
    assert.equal(a.startTimeRequest, "08:00");
  });

  test('the lane never sends "Anytime"', () => {
    // The regression itself. "Anytime" lets the optimizer relocate a slot whose
    // time was already texted to the technician.
    for (const c of [candidate(), candidate({ live: false }), candidate({ date: "2026-09-01" })]) {
      assert.notEqual(buildCutoverBlockArgs(c).ok && argsFor(c).startTimeRequest, "Anytime");
    }
  });

  test("08:00 survives onto the wire in both fields", () => {
    const r = wire(candidate());
    assert.equal(r.StartTime, "08:00");
    assert.equal(r.StartTimeRequest, "08:00");
  });

  test("every candidate gets the same 8:00, whatever their branch or truck", () => {
    const varied: CutoverBlockInput[] = [
      candidate({ ldap: "ACHAVI0", truckNumber: "023132" }),
      candidate({ ldap: "SREKIS", branchAddress: "KAHULUI HANA HWY., 40 HANA HWY,KAHULUI,96732" }),
      candidate({ ldap: "DPLANT", branchAddress: "BIRMINGHAM CITY CENTRE, 2325 5TH AVE N,BIRMINGHAM,35203-3407" }),
      candidate({ ldap: "FYANEZ0", branchAddress: "11130 FUQUA ST, HOUSTON, 77034" }),
    ];
    for (const c of varied) {
      const r = wire(c);
      assert.equal(r.StartTime, "08:00", `${c.ldap} start time`);
      assert.equal(r.StartTimeRequest, "08:00", `${c.ldap} start request`);
    }
  });

  test("the client's own defaults agree with the lane", () => {
    assert.equal(ROUTE_BLOCK_START_TIME, "08:00");
    assert.equal(ROUTE_BLOCK_START_TIME_REQUEST, "08:00");
  });

  test("the day is pinned on all three date fields", () => {
    const r = wire(candidate());
    assert.equal(r.Date, "2026-08-18");
    assert.equal(r.RequestedStartDate, "2026-08-18");
    assert.equal(r.RequestedCompletionDate, "2026-08-18");
    assert.equal(r.endDateFixed, true);
  });
});

describe("the lane's decision — reserved branch ZIP in LocationValue", () => {
  test("LocationValue is the branch ZIP with its +4, and LocationType is Supplied", () => {
    const r = wire(candidate());
    assert.equal(r.LocationType, "Supplied");
    assert.equal(r.LocationValue, "79904-2805");
  });

  test("the +4 survives all the way to the wire, untrimmed", () => {
    const r = wire(candidate());
    assert.match(r.LocationValue, /^\d{5}(-\d{4})?$/);
    assert.ok(r.LocationValue.includes("-"), "this fixture's address has a +4");
  });

  test("real branch addresses each yield their own LocationValue", () => {
    const cases: Array<[string, string]> = [
      ["EL PASO DYER & TETONS, 8555 DYER STREET,EL PASO,79904-2805", "79904-2805"],
      ["FORT WORTH SOUTH FWY., 4851 SOUTH FRWY,FORT WORTH,76115-4003", "76115-4003"],
      ["FRONT ROYAL, 1500 N SHENANDOAH AVE,FRONT ROYAL,22630-3640", "22630-3640"],
      ["KAHULUI HANA HWY., 40 HANA HWY,KAHULUI,96732", "96732"],
      ["11130 FUQUA ST, HOUSTON, 77034", "77034"],
    ];
    for (const [branchAddress, want] of cases) {
      const r = wire(candidate({ branchAddress }));
      assert.equal(r.LocationValue, want, branchAddress);
      assert.equal(r.LocationType, "Supplied", branchAddress);
    }
  });

  test("no ZIP on the branch address REFUSES the filing", () => {
    for (const branchAddress of ["SOME BRANCH, MAIN STREET, HOUSTON", "", null, undefined]) {
      const d = buildCutoverBlockArgs(candidate({ branchAddress }));
      assert.equal(d.ok, false, `address ${JSON.stringify(branchAddress)} must not file`);
      assert.match((d as any).reason, /no ZIP on the booked branch address/);
    }
  });

  test("a refusal is what stops LocationType 'None' reaching the API", () => {
    // Prove the degradation the refusal exists to prevent is real: hand the
    // builder a null zip directly and it files a destination-less block.
    const naive = buildStandardActivityPayload({
      ...argsFor(candidate()),
      locationZip: null,
    });
    const r = (naive.body as any).exportData[0];
    assert.equal(r.LocationType, "None");
    assert.equal(r.LocationValue, "");
  });

  test("no district also refuses, and says why", () => {
    const d = buildCutoverBlockArgs(candidate({ unit: "  " }));
    assert.equal(d.ok, false);
    assert.match((d as any).reason, /Unit is required/);
  });
});

describe("the rest of the contract", () => {
  test("30 minutes, the tech's RACF, and the district as Unit", () => {
    const r = wire(candidate());
    assert.equal(r.Duration, 30);
    assert.equal(r.TechnicianId, "JDOE");
    assert.equal(r.Unit, "MWR31");
  });

  test("ActivityType 46 is the value that lands as 'Vehicle - Change'", () => {
    // Verified 2026-08-17 against PRD_SERVICEPOWER.BATCH_TBLS.SCH_ACTIVITIES_PROD:
    // the filed blocks all came back with
    // ACTIVITY_TYPE_DESCRIPTION = 'Vehicle - Change'. No longer a guess.
    assert.equal(wire(candidate()).ActivityType, "46");
  });

  test("the branch is named in the row notes for the DCA", () => {
    const a = argsFor(candidate());
    assert.match(String(a.rowNotes), /El Paso Dyer & Tetons/);
    assert.match(String(a.rowNotes), /79904-2805/);
  });

  test("a live block carries no TEST prefix; a dark one does", () => {
    assert.equal(
      buildStandardActivityPayload(argsFor(candidate({ live: true }))).projectName,
      // Keyed on the LDAP, not the truck number (Tyler, 2026-08-17): the name only
      // has to be unique, and "the truck number" is ambiguous on a cutover.
      "Enterprise Contract Change - JDOE - 081826",
    );
    assert.match(
      buildStandardActivityPayload(argsFor(candidate({ live: false }))).projectName,
      /^TEST /,
    );
  });
});
