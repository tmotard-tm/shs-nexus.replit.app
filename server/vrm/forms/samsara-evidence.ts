/**
 * Samsara evidence check for breakdown / accident rental requests.
 *
 * When a technician cites a breakdown or accident, this module pulls the
 * truck's telematics evidence (live fault codes, Snowflake DTC history,
 * harsh/crash safety events near the reported time, last GPS fix, odometer)
 * and reduces it to ONE advisory verdict stamped on the request row.
 *
 * ADVISORY ONLY, by contract:
 *   - It never blocks, denies, or approves anything. The reviewer decides.
 *   - Every failure path is fail-soft: a Samsara or Snowflake outage becomes
 *     the "check_unavailable" verdict, never an error the technician sees.
 *   - It runs fire-and-forget AFTER the request row is written, so it adds
 *     zero latency and zero failure modes to the submit.
 *
 * Truck matching is canonical (digits only, leading zeros stripped) on BOTH
 * sides — but the BYOV `88` prefix is checked on the RAW trimmed number
 * BEFORE any canonicalization, because zero-stripping/padding first breaks
 * 5-digit BYOV trucks (88144).
 */
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { getSamsaraService } from "../../samsara-service";

export type SamsaraVerdict =
  | "corroborated"        // telematics evidence supports the claim
  | "no_supporting_data"  // device is reporting, but nothing supports the claim
  | "device_offline"      // no recent signal — absence of data proves nothing
  | "not_applicable"      // BYOV / no Samsara device registered to this truck
  | "check_unavailable";  // the check itself failed (Samsara/Snowflake outage)

type SourceStatus = "ok" | "error" | "skipped";

interface SourceState {
  status: SourceStatus;
  error?: string;
}

export interface SamsaraEvidenceSnapshot {
  version: 1;
  category: "breakdown" | "accident";
  truckNumber: string | null;
  canonicalTruck: string | null;
  byov: boolean;
  occurredAt: string | null;
  checkedAt: string;
  vehicle: { samsaraVehicleId: string; samsaraName: string; vin: string | null } | null;
  sources: {
    vehicle: SourceState;
    faultCodes: SourceState;
    maintenance: SourceState;
    safety: SourceState;
    location: SourceState;
    odometer: SourceState;
  };
  faultCodes: Array<{ faultCode: string; description: string | null; source: string; status: string | null }>;
  maintenanceDtcs: Array<{ code: string | null; description: string | null; checkEngine: boolean; lastSeen: string | null }>;
  safetyEvents: Array<{ timeUtc: string; label: string | null; gForce: number | null; nearIncident: boolean }>;
  location: {
    lat: number; lng: number; address: string | null; time: string;
    speedMph: number | null; source: string;
  } | null;
  odometer: { obdMiles: number | null; gpsMiles: number | null; obdTime: string | null; gpsTime: string | null } | null;
  /** Newest signal we saw from the device across GPS + odometer feeds. */
  lastSignalAt: string | null;
  lastSignalAgeHours: number | null;
  verdict: SamsaraVerdict;
  verdictReason: string;
}

/** A device silent for longer than this is "offline", not "clean". */
export const OFFLINE_AFTER_HOURS = 24;
/** Safety events within this window of the reported time count as "near". */
export const NEAR_INCIDENT_HOURS = 72;
/** Labels that read as a crash / harsh event for accident corroboration. */
const HARSH_LABEL_RE = /crash|collision|harsh|rolled|rollover|near.?collision|forward collision|impact/i;

/** BYOV screening on the RAW trimmed number — never on a padded/stripped one. */
export function isByovTruckNumber(truckNumber: string | null | undefined): boolean {
  const digits = String(truckNumber ?? "").trim().replace(/\D/g, "");
  return digits.length >= 4 && digits.startsWith("88");
}

/** Canonical truck form shared with the Snowflake match: digits, no leading zeros. */
export function canonicalTruck(truckNumber: string | null | undefined): string {
  return String(truckNumber ?? "").replace(/\D/g, "").replace(/^0+/, "");
}

/**
 * The pure verdict reducer. Separated from the I/O so every path is unit
 * testable: the snapshot arrives with its sources already resolved and this
 * decides what the badge says.
 */
export function reduceVerdict(
  snap: Omit<SamsaraEvidenceSnapshot, "verdict" | "verdictReason">,
): { verdict: SamsaraVerdict; reason: string } {
  // BYOV / no truck first: nothing below can apply.
  if (snap.byov) {
    return { verdict: "not_applicable", reason: "BYOV — personal vehicles carry no company Samsara device." };
  }
  if (!snap.canonicalTruck) {
    return { verdict: "not_applicable", reason: "No truck number on the request, so there is no device to check." };
  }
  // Could we even find the vehicle?
  if (snap.sources.vehicle.status === "error") {
    return {
      verdict: "check_unavailable",
      reason: `Could not look up the truck in Samsara: ${snap.sources.vehicle.error || "lookup failed"}.`,
    };
  }
  if (!snap.vehicle) {
    return {
      verdict: "not_applicable",
      reason: `No Samsara device is registered to truck ${snap.truckNumber ?? snap.canonicalTruck}.`,
    };
  }

  // Primary evidence per category.
  if (snap.category === "breakdown") {
    if (snap.faultCodes.length > 0) {
      const cel = snap.faultCodes.some((f) => /check.?engine/i.test(String(f.status ?? "")));
      return {
        verdict: "corroborated",
        reason: `${snap.faultCodes.length} active fault code${snap.faultCodes.length === 1 ? "" : "s"} on the truck`
          + (cel ? " (check-engine light on)" : "") + ".",
      };
    }
    if (snap.maintenanceDtcs.length > 0) {
      const cel = snap.maintenanceDtcs.some((m) => m.checkEngine);
      return {
        verdict: "corroborated",
        reason: `${snap.maintenanceDtcs.length} diagnostic trouble code${snap.maintenanceDtcs.length === 1 ? "" : "s"}`
          + " in the recent Samsara maintenance feed for this truck"
          + (cel ? " (check-engine light seen)" : "") + ".",
      };
    }
    // Nothing found — but only "no data" if at least one primary source answered.
    const faultsFailed = snap.sources.faultCodes.status !== "ok";
    const maintFailed = snap.sources.maintenance.status !== "ok";
    if (faultsFailed && maintFailed) {
      return {
        verdict: "check_unavailable",
        reason: "Neither the live fault-code check nor the maintenance DTC history could be read.",
      };
    }
  } else {
    // accident
    const near = snap.safetyEvents.filter((e) => e.nearIncident && HARSH_LABEL_RE.test(String(e.label ?? "")));
    if (near.length > 0) {
      const strongest = near.reduce((a, b) => ((b.gForce ?? 0) > (a.gForce ?? 0) ? b : a));
      return {
        verdict: "corroborated",
        reason: `${near.length} harsh/crash event${near.length === 1 ? "" : "s"} recorded near the reported time`
          + (strongest.gForce != null ? ` (max ${strongest.gForce}g)` : "") + ".",
      };
    }
    if (snap.sources.safety.status !== "ok") {
      return {
        verdict: "check_unavailable",
        reason: `Safety-event history could not be read: ${snap.sources.safety.error || "query failed"}.`,
      };
    }
  }

  // No supporting evidence. Distinguish a silent device from a clean truck —
  // "no data from an offline device" is not "no faults".
  if (snap.lastSignalAgeHours == null) {
    return {
      verdict: "device_offline",
      reason: snap.sources.location.status === "ok"
        ? "The device has no GPS or odometer signal on record — offline or never reported."
        : "Could not read any device signal (location/odometer lookups failed), so absence of evidence proves nothing.",
    };
  }
  if (snap.lastSignalAgeHours > OFFLINE_AFTER_HOURS) {
    return {
      verdict: "device_offline",
      reason: `Last device signal was ${Math.round(snap.lastSignalAgeHours)}h ago — the device is not reporting, `
        + "so the absence of fault/safety data proves nothing.",
    };
  }

  return {
    verdict: "no_supporting_data",
    reason: snap.category === "breakdown"
      ? "Device is reporting and shows no active fault codes or DTC history."
      : "Device is reporting and shows no harsh/crash events near the reported time.",
  };
}

const iso = (v: any): string | null => {
  const t = Date.parse(String(v ?? ""));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/**
 * Gather the evidence for one truck and reduce it. NEVER throws — the worst
 * outcome is a snapshot full of errored sources and a "check_unavailable"
 * verdict.
 */
export async function collectSamsaraEvidence(opts: {
  truckNumber: string | null;
  category: "breakdown" | "accident";
  occurredAt: string | null;
  /** The request row's own BYOV flag (roster enrollment) — either signal suffices. */
  isByov?: boolean;
}): Promise<SamsaraEvidenceSnapshot> {
  const checkedAt = new Date().toISOString();
  const rawTruck = String(opts.truckNumber ?? "").trim() || null;
  const byov = opts.isByov === true || isByovTruckNumber(rawTruck);
  const canonical = canonicalTruck(rawTruck) || null;
  const occurredAt = iso(opts.occurredAt);

  const snap: Omit<SamsaraEvidenceSnapshot, "verdict" | "verdictReason"> = {
    version: 1,
    category: opts.category,
    truckNumber: rawTruck,
    canonicalTruck: canonical,
    byov,
    occurredAt,
    checkedAt,
    vehicle: null,
    sources: {
      vehicle: { status: "skipped" },
      faultCodes: { status: "skipped" },
      maintenance: { status: "skipped" },
      safety: { status: "skipped" },
      location: { status: "skipped" },
      odometer: { status: "skipped" },
    },
    faultCodes: [],
    maintenanceDtcs: [],
    safetyEvents: [],
    location: null,
    odometer: null,
    lastSignalAt: null,
    lastSignalAgeHours: null,
  };

  // BYOV / no truck: no lookups at all — the verdict is already decided.
  if (!byov && canonical) {
    const samsara = getSamsaraService();

    // Resolve the vehicle first; everything else keys on its Samsara id/name.
    let vehicle: { VEHICLE_ID: string; TRUCK_NUMBER: string; VIN: string | null } | null = null;
    try {
      vehicle = await samsara.findVehicleByTruckNumber(canonical);
      snap.sources.vehicle = { status: "ok" };
    } catch (e: any) {
      snap.sources.vehicle = { status: "error", error: String(e?.message || e).slice(0, 300) };
    }

    if (vehicle) {
      snap.vehicle = {
        samsaraVehicleId: String(vehicle.VEHICLE_ID),
        samsaraName: String(vehicle.TRUCK_NUMBER),
        vin: vehicle.VIN ?? null,
      };
      const vid = String(vehicle.VEHICLE_ID);

      // Safety-event window: ±3 days around the reported time, else the last
      // 14 days. The near-incident flag is computed per event afterwards.
      const anchorMs = occurredAt ? Date.parse(occurredAt) : Date.now();
      const winStart = new Date(anchorMs - (occurredAt ? 3 : 14) * 86400000).toISOString().slice(0, 10);
      const winEnd = new Date(anchorMs + 3 * 86400000).toISOString().slice(0, 10);

      const [faults, maint, safety, loc, odo] = await Promise.allSettled([
        samsara.isLiveApiConfigured()
          ? samsara.liveGetVehicleFaultCodes(vid)
          : Promise.reject(new Error("Samsara live API token not configured")),
        samsara.getVehicleDtcHistory(vid),
        samsara.getSafetyEvents(vid, undefined, winStart, winEnd),
        samsara.getVehicleLocation(String(vehicle.TRUCK_NUMBER)),
        samsara.getOdometerForTruck(String(vehicle.TRUCK_NUMBER), vehicle.VIN ?? null),
      ]);

      if (faults.status === "fulfilled") {
        snap.sources.faultCodes = { status: "ok" };
        snap.faultCodes = faults.value.slice(0, 25);
      } else {
        snap.sources.faultCodes = { status: "error", error: String(faults.reason?.message || faults.reason).slice(0, 300) };
      }

      if (maint.status === "fulfilled") {
        snap.sources.maintenance = { status: "ok" };
        snap.maintenanceDtcs = maint.value.slice(0, 20).map((m) => ({
          code: m.DTC_SHORT_CODE ?? (m.DTC_ID != null ? String(m.DTC_ID) : null),
          description: m.DTC_DESCRIPTION ?? m.J1939_DTCS ?? null,
          checkEngine: m.CHECK_ENGINE === true,
          lastSeen: iso(m.LOAD_TS_UTC),
        }));
      } else {
        snap.sources.maintenance = { status: "error", error: String(maint.reason?.message || maint.reason).slice(0, 300) };
      }

      if (safety.status === "fulfilled") {
        snap.sources.safety = { status: "ok" };
        const nearMs = NEAR_INCIDENT_HOURS * 3600000;
        snap.safetyEvents = safety.value.slice(0, 20).map((e) => {
          const t = Date.parse(String(e.TIME_UTC ?? ""));
          const nearIncident = occurredAt
            ? Number.isFinite(t) && Math.abs(t - Date.parse(occurredAt)) <= nearMs
            : true; // no reported time — anything in the queried window counts
          return {
            timeUtc: iso(e.TIME_UTC) ?? String(e.TIME_UTC ?? ""),
            label: e.LABEL ?? null,
            gForce: e.MAX_ACCEL_GFORCE ?? null,
            nearIncident,
          };
        });
      } else {
        snap.sources.safety = { status: "error", error: String(safety.reason?.message || safety.reason).slice(0, 300) };
      }

      if (loc.status === "fulfilled") {
        snap.sources.location = { status: "ok" };
        if (loc.value) {
          snap.location = {
            lat: loc.value.LAT,
            lng: loc.value.LNG,
            address: loc.value.REVERSE_GEO_FULL ?? null,
            time: iso(loc.value.TIME) ?? String(loc.value.TIME),
            speedMph: loc.value.SPEED_MPH ?? null,
            source: loc.value.source,
          };
        }
      } else {
        snap.sources.location = { status: "error", error: String(loc.reason?.message || loc.reason).slice(0, 300) };
      }

      if (odo.status === "fulfilled") {
        snap.sources.odometer = { status: "ok" };
        const o = odo.value;
        if (o) {
          snap.odometer = {
            obdMiles: o.OBD_MILES ?? null,
            gpsMiles: o.GPS_MILES ?? null,
            obdTime: iso(o.OBD_TIME),
            gpsTime: iso(o.GPS_TIME),
          };
        }
      } else {
        snap.sources.odometer = { status: "error", error: String(odo.reason?.message || odo.reason).slice(0, 300) };
      }

      // Last device signal = newest of GPS fix / odometer read timestamps.
      const stamps = [snap.location?.time, snap.odometer?.obdTime, snap.odometer?.gpsTime]
        .map((s) => Date.parse(String(s ?? "")))
        .filter((t) => Number.isFinite(t));
      if (stamps.length) {
        const newest = Math.max(...stamps);
        snap.lastSignalAt = new Date(newest).toISOString();
        snap.lastSignalAgeHours = Math.max(0, (Date.parse(checkedAt) - newest) / 3600000);
      }
    }
  }

  const { verdict, reason } = reduceVerdict(snap);
  return { ...snap, verdict, verdictReason: reason };
}

/**
 * Run the check for one request row and persist the result. Fire-and-forget
 * safe: catches EVERYTHING, logs loudly, never throws. Returns the snapshot
 * (for the synchronous re-check route) or null when the request does not
 * qualify or the persist itself failed.
 */
export async function captureRequestSamsaraEvidence(opts: {
  requestNo: number;
  truckNumber: string | null;
  category: string | null;
  occurredAt: string | null;
  isByov?: boolean;
}): Promise<SamsaraEvidenceSnapshot | null> {
  const category = String(opts.category ?? "");
  if (category !== "breakdown" && category !== "accident") return null;
  if (!Number.isFinite(Number(opts.requestNo))) return null;
  try {
    const snap = await collectSamsaraEvidence({
      truckNumber: opts.truckNumber,
      category,
      occurredAt: opts.occurredAt,
      isByov: opts.isByov,
    });
    await db.execute(sql`
      UPDATE vrm_rental_request
      SET samsara_verdict = ${snap.verdict},
          samsara_evidence = ${JSON.stringify(snap)}::jsonb,
          samsara_checked_at = now()
      WHERE request_no = ${Number(opts.requestNo)}
    `);
    console.log(`[samsara-evidence] request #${opts.requestNo} truck ${opts.truckNumber ?? "—"}: ${snap.verdict} — ${snap.verdictReason}`);
    return snap;
  } catch (e: any) {
    // Fail-soft by contract: the submit already succeeded; the reviewer just
    // sees an unchecked request.
    console.error(`[samsara-evidence] capture failed for request #${opts.requestNo}:`, e?.message || e);
    return null;
  }
}
