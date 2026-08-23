/**
 * Samsara evidence check — pure verdict reducer + truck canonicalization.
 *
 * The reducer is the entire decision surface for the advisory badge; every
 * verdict path is exercised here without touching Samsara or Snowflake.
 * The BYOV edge cases guard the standing lesson: the `88` prefix must be
 * checked on the RAW number BEFORE any zero-stripping or padding, or a
 * 5-digit BYOV truck (88144) silently reads as a company van.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  reduceVerdict,
  isByovTruckNumber,
  canonicalTruck,
  OFFLINE_AFTER_HOURS,
  type SamsaraEvidenceSnapshot,
} from "../server/vrm/forms/samsara-evidence";

type Snap = Omit<SamsaraEvidenceSnapshot, "verdict" | "verdictReason">;

const okSources = () => ({
  vehicle: { status: "ok" as const },
  faultCodes: { status: "ok" as const },
  maintenance: { status: "ok" as const },
  safety: { status: "ok" as const },
  location: { status: "ok" as const },
  odometer: { status: "ok" as const },
});

const base = (over: Partial<Snap> = {}): Snap => ({
  version: 1,
  category: "breakdown",
  truckNumber: "023132",
  canonicalTruck: "23132",
  byov: false,
  occurredAt: "2026-08-20T12:00:00.000Z",
  checkedAt: "2026-08-23T12:00:00.000Z",
  vehicle: { samsaraVehicleId: "281474", samsaraName: "23132", vin: null },
  sources: okSources(),
  faultCodes: [],
  maintenanceDtcs: [],
  safetyEvents: [],
  location: null,
  odometer: null,
  lastSignalAt: "2026-08-23T11:00:00.000Z",
  lastSignalAgeHours: 1,
  ...over,
});

describe("truck number helpers", () => {
  test("BYOV 88 prefix is checked on the raw number, 5-digit included", () => {
    assert.equal(isByovTruckNumber("88144"), true);   // the 5-digit trap
    assert.equal(isByovTruckNumber("881440"), true);
    assert.equal(isByovTruckNumber(" 88144 "), true);
    assert.equal(isByovTruckNumber("088144"), false); // padded — NOT BYOV by prefix
    assert.equal(isByovTruckNumber("23132"), false);
    assert.equal(isByovTruckNumber(""), false);
    assert.equal(isByovTruckNumber(null), false);
  });

  test("canonicalTruck strips non-digits and leading zeros", () => {
    assert.equal(canonicalTruck("023132"), "23132");
    assert.equal(canonicalTruck(" TRK-023132 "), "23132");
    assert.equal(canonicalTruck("88144"), "88144");
    assert.equal(canonicalTruck("0000"), "");
    assert.equal(canonicalTruck(null), "");
  });
});

describe("verdict reducer — not applicable & unavailable", () => {
  test("BYOV wins before anything else", () => {
    const { verdict } = reduceVerdict(base({ byov: true, vehicle: null }));
    assert.equal(verdict, "not_applicable");
  });

  test("no truck number → not_applicable", () => {
    const { verdict } = reduceVerdict(base({ truckNumber: null, canonicalTruck: null, vehicle: null }));
    assert.equal(verdict, "not_applicable");
  });

  test("vehicle lookup FAILED → check_unavailable (distinct from unknown truck)", () => {
    const s = base({ vehicle: null });
    s.sources.vehicle = { status: "error", error: "snowflake down" };
    const { verdict, reason } = reduceVerdict(s);
    assert.equal(verdict, "check_unavailable");
    assert.match(reason, /snowflake down/);
  });

  test("vehicle lookup OK but no match → not_applicable (no device)", () => {
    const { verdict, reason } = reduceVerdict(base({ vehicle: null }));
    assert.equal(verdict, "not_applicable");
    assert.match(reason, /No Samsara device/i);
  });

  test("breakdown: BOTH primary sources failed → check_unavailable", () => {
    const s = base();
    s.sources.faultCodes = { status: "error", error: "429" };
    s.sources.maintenance = { status: "error", error: "timeout" };
    const { verdict } = reduceVerdict(s);
    assert.equal(verdict, "check_unavailable");
  });

  test("accident: safety history failed → check_unavailable", () => {
    const s = base({ category: "accident" });
    s.sources.safety = { status: "error", error: "query failed" };
    const { verdict } = reduceVerdict(s);
    assert.equal(verdict, "check_unavailable");
  });
});

describe("verdict reducer — corroboration", () => {
  test("breakdown: active fault codes corroborate", () => {
    const { verdict, reason } = reduceVerdict(base({
      faultCodes: [{ faultCode: "P0301", description: "Cylinder 1 misfire", source: "obdii", status: "checkEngineLight" }],
    }));
    assert.equal(verdict, "corroborated");
    assert.match(reason, /1 active fault code/);
    assert.match(reason, /check-engine/);
  });

  test("breakdown: maintenance DTC history corroborates when live faults are clean", () => {
    const { verdict, reason } = reduceVerdict(base({
      maintenanceDtcs: [{ code: "P0011", description: "Camshaft timing over-advanced", checkEngine: true, lastSeen: "2026-08-23T09:31:24.000Z" }],
    }));
    assert.equal(verdict, "corroborated");
    assert.match(reason, /maintenance feed/);
    assert.match(reason, /check-engine/);
  });

  test("breakdown: fault codes corroborate even if the OTHER source errored", () => {
    const s = base({
      faultCodes: [{ faultCode: "P0420", description: null, source: "obdii", status: null }],
    });
    s.sources.maintenance = { status: "error", error: "timeout" };
    assert.equal(reduceVerdict(s).verdict, "corroborated");
  });

  test("accident: harsh/crash event NEAR the reported time corroborates", () => {
    const { verdict, reason } = reduceVerdict(base({
      category: "accident",
      safetyEvents: [
        { timeUtc: "2026-08-20T13:05:00.000Z", label: "Harsh Brake", gForce: 0.61, nearIncident: true },
      ],
    }));
    assert.equal(verdict, "corroborated");
    assert.match(reason, /near the reported time/);
  });

  test("accident: a far-away event does NOT corroborate", () => {
    const { verdict } = reduceVerdict(base({
      category: "accident",
      safetyEvents: [
        { timeUtc: "2026-08-10T13:05:00.000Z", label: "Crash", gForce: 2.4, nearIncident: false },
      ],
    }));
    assert.equal(verdict, "no_supporting_data");
  });

  test("accident: a NEAR but non-harsh label (e.g. Speeding) does not corroborate", () => {
    const { verdict } = reduceVerdict(base({
      category: "accident",
      safetyEvents: [
        { timeUtc: "2026-08-20T13:05:00.000Z", label: "Speeding", gForce: null, nearIncident: true },
      ],
    }));
    assert.equal(verdict, "no_supporting_data");
  });
});

describe("verdict reducer — offline vs genuinely clean", () => {
  test("reporting device + no evidence → no_supporting_data", () => {
    const { verdict, reason } = reduceVerdict(base());
    assert.equal(verdict, "no_supporting_data");
    assert.match(reason, /no active fault codes/i);
  });

  test("no signal at all → device_offline, never 'clean'", () => {
    const { verdict } = reduceVerdict(base({ lastSignalAt: null, lastSignalAgeHours: null }));
    assert.equal(verdict, "device_offline");
  });

  test("stale signal beyond the offline threshold → device_offline", () => {
    const { verdict, reason } = reduceVerdict(base({ lastSignalAgeHours: OFFLINE_AFTER_HOURS + 10 }));
    assert.equal(verdict, "device_offline");
    assert.match(reason, /proves nothing/);
  });

  test("signal just inside the threshold stays no_supporting_data", () => {
    const { verdict } = reduceVerdict(base({ lastSignalAgeHours: OFFLINE_AFTER_HOURS - 1 }));
    assert.equal(verdict, "no_supporting_data");
  });
});
