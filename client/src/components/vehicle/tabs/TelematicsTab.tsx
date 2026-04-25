import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Satellite, AlertCircle, MapPin, Gauge, Wrench,
  Fuel, Wifi, WifiOff, Clock, AlertTriangle, CheckCircle,
} from "lucide-react";
import { toCanonical } from "@shared/vehicle-number-utils";
import type { TruckPanelData } from "@/components/vehicle/_helpers";

/**
 * Telematics tab — Phase 2A.3 absorbs the full TelematicsButton dialog
 * surface (vehicle info, GPS, odometer, DTCs w/ criticality banner,
 * fuel & idle 7d, stream log). Sourced from /api/samsara/telematics.
 *
 * Phase 3B.1 will swap the read to BaseTieredVendorAdapter (Snowflake T1
 * → integration_events T2 → live API T3) with FieldProvenanceBadge.
 */

interface TelematicsData {
  vehicle: {
    VEHICLE_ID: string;
    TRUCK_NUMBER: string;
    VIN: string | null;
    MAKE: string | null;
    MODEL: string | null;
    YEAR: number | null;
    STATICASSIGNEDDRIVER_NAME: string | null;
    STATICASSIGNEDDRIVER_ID: string | null;
  } | null;
  vehicleId: string | null;
  location: {
    LAT: number;
    LNG: number;
    HEADING: number | null;
    SPEED_MPH: number | null;
    TIME: string;
    REVERSE_GEO_FULL: string | null;
    source: string;
  } | null;
  odometer: {
    OBD_MILES: number | null;
    GPS_MILES: number | null;
    OBD_TIME: string | null;
    GPS_TIME: string | null;
  } | null;
  maintenance: Array<{
    MAINT_ID: string;
    VEHICLE_ID: string;
    DTC_DESCRIPTION: string | null;
    DTC_ID: string | null;
    J1939_STATUS: string | null;
  }>;
  fuel: Array<{
    RUN_DATE_UTC: string;
    FUEL_CONSUMED_GAL: number | null;
    ENGINE_IDLETIME_MIN: number | null;
    EFFICIENCY_MPGE: number | null;
  }>;
  stream: {
    LAT: number | null;
    LNG: number | null;
    SPEED_MPH: number | null;
    HEADING: number | null;
    TIME: string | null;
    REVERSE_GEO_FULL: string | null;
  } | null;
  criticality: {
    SEVERITY_SCORE: number | null;
    SEVERITY_LABEL: string | null;
    RECOMMENDED_ACTION: string | null;
    DTC_COUNT_DISTINCT: number | null;
    LAMP_BASE: string | null;
    DTC_SHORT_CODE: string | null;
    DTC_DESCRIPTION: string | null;
    MAINT_LOAD_TS_UTC: string | null;
  } | null;
}

function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleString("en-US", {
      month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true,
    });
  } catch {
    return dateStr;
  }
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function Row({
  label,
  value,
  mono = false,
  testId,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  testId?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5" data-testid={testId}>
      <span className="text-xs text-muted-foreground shrink-0 w-36">{label}</span>
      <span className={`text-xs text-right ${mono ? "font-mono" : "font-medium"}`}>
        {value || "—"}
      </span>
    </div>
  );
}

export function TelematicsTab({ truck }: { truck: TruckPanelData }) {
  // Samsara identifies vehicles by the unpadded truck number — the canonical
  // form. Use the shared helper rather than ad-hoc regex stripping.
  const samsaraVehicleName = toCanonical(truck.truckNumber);

  const { data, isLoading, error } = useQuery<TelematicsData>({
    queryKey: ["/api/samsara/telematics", samsaraVehicleName],
    enabled: !!samsaraVehicleName,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-destructive py-8" data-testid="telematics-error">
        <AlertCircle className="h-5 w-5 shrink-0" />
        <div>
          <p className="font-medium text-sm">Failed to load telematics</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {(error as Error).message}
          </p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-md border p-4 text-sm text-muted-foreground italic" data-testid="telematics-no-data">
        No telematics data available for vehicle {samsaraVehicleName || "—"}
      </div>
    );
  }

  const activeDTCs = data.maintenance?.filter((m) => m.DTC_ID || m.DTC_DESCRIPTION) ?? [];
  const recentFuel = data.fuel?.slice(0, 7) ?? [];
  const totalFuel = recentFuel.reduce((s, f) => s + (f.FUEL_CONSUMED_GAL ?? 0), 0);
  const totalIdle = recentFuel.reduce((s, f) => s + (f.ENGINE_IDLETIME_MIN ?? 0), 0);

  return (
    <div className="space-y-5">
      {/* Vehicle Info */}
      {data.vehicle ? (
        <section>
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
            <Wifi className="w-4 h-4 text-muted-foreground" />
            Samsara Vehicle
            {data.location?.source === "live" && (
              <Badge variant="secondary" className="text-xs ml-1">Live</Badge>
            )}
          </h3>
          <div className="rounded-md border p-3 divide-y divide-border">
            <Row label="Samsara ID" value={data.vehicle.VEHICLE_ID} mono testId="telematics-samsara-id" />
            <Row label="VIN" value={data.vehicle.VIN} mono testId="telematics-vin" />
            <Row
              label="Year / Make / Model"
              value={[data.vehicle.YEAR, data.vehicle.MAKE, data.vehicle.MODEL].filter(Boolean).join(" ") || null}
              testId="telematics-ymm"
            />
            <Row label="Assigned Driver" value={data.vehicle.STATICASSIGNEDDRIVER_NAME} testId="telematics-driver" />
          </div>
        </section>
      ) : (
        <div className="flex items-center gap-2 text-amber-600 bg-amber-50 dark:bg-amber-950/20 rounded-md p-3">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="text-xs">
            Vehicle not found in Samsara. It may not be enrolled or uses a different truck number format.
          </span>
        </div>
      )}

      {/* GPS Location */}
      <section>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
          <MapPin className="w-4 h-4 text-muted-foreground" />
          GPS Location
        </h3>
        {data.location ? (
          <div className="rounded-md border p-3 divide-y divide-border">
            <Row
              label="Address"
              value={data.location.REVERSE_GEO_FULL || `${data.location.LAT?.toFixed(5)}, ${data.location.LNG?.toFixed(5)}`}
              testId="telematics-address"
            />
            <Row
              label="Coordinates"
              value={`${data.location.LAT?.toFixed(6) ?? "—"}, ${data.location.LNG?.toFixed(6) ?? "—"}`}
              mono
              testId="telematics-coords"
            />
            <Row
              label="Speed"
              value={data.location.SPEED_MPH != null ? `${data.location.SPEED_MPH.toFixed(1)} mph` : null}
              testId="telematics-speed"
            />
            <Row
              label="Heading"
              value={data.location.HEADING != null ? `${data.location.HEADING}°` : null}
              testId="telematics-heading"
            />
            <Row
              label="Last Updated"
              value={formatDateTime(data.location.TIME)}
              testId="telematics-last-updated"
            />
            <Row
              label="Source"
              value={
                <Badge variant={data.location.source === "live" ? "default" : "secondary"} className="text-xs">
                  {data.location.source}
                </Badge>
              }
              testId="telematics-source"
            />
          </div>
        ) : (
          <div className="flex items-center gap-2 text-muted-foreground bg-muted/40 rounded-md p-3">
            <WifiOff className="h-4 w-4 shrink-0" />
            <span className="text-xs">No GPS data available</span>
          </div>
        )}
      </section>

      {/* Odometer */}
      <section>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
          <Gauge className="w-4 h-4 text-muted-foreground" />
          Odometer
        </h3>
        {data.odometer ? (
          <div className="rounded-md border p-3 divide-y divide-border">
            <Row
              label="OBD Miles"
              value={data.odometer.OBD_MILES != null ? `${data.odometer.OBD_MILES.toLocaleString()} mi` : null}
              testId="telematics-obd-miles"
            />
            <Row label="OBD Timestamp" value={formatDateTime(data.odometer.OBD_TIME)} />
            <Row
              label="GPS Miles"
              value={data.odometer.GPS_MILES != null ? `${data.odometer.GPS_MILES.toLocaleString()} mi` : null}
              testId="telematics-gps-miles"
            />
            <Row label="GPS Timestamp" value={formatDateTime(data.odometer.GPS_TIME)} />
          </div>
        ) : (
          <div className="text-xs text-muted-foreground bg-muted/40 rounded-md p-3">
            No odometer data available
          </div>
        )}
      </section>

      {/* Engine / DTC Codes */}
      <section>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
          <Wrench className="w-4 h-4 text-muted-foreground" />
          Engine / Diagnostic Codes
          {activeDTCs.length > 0 && (
            <Badge variant="destructive" className="text-xs ml-1">{activeDTCs.length}</Badge>
          )}
        </h3>

        {activeDTCs.length === 0 && !data.criticality ? (
          <div className="flex items-center gap-2 text-green-600 bg-green-50 dark:bg-green-950/20 rounded-md p-3" data-testid="telematics-no-dtcs">
            <CheckCircle className="h-4 w-4 shrink-0" />
            <span className="text-xs">No active diagnostic codes</span>
          </div>
        ) : (
          <div className="space-y-2">
            {data.criticality?.SEVERITY_LABEL && data.criticality.SEVERITY_LABEL !== "CLEAR" && (() => {
              const label = data.criticality.SEVERITY_LABEL ?? "";
              const severityConfig: Record<string, { cls: string; icon: string }> = {
                STOP:      { cls: "bg-red-50 border-red-300 text-red-900 dark:bg-red-950/40 dark:border-red-700 dark:text-red-200",         icon: "🛑" },
                PROTECT:   { cls: "bg-orange-50 border-orange-300 text-orange-900 dark:bg-orange-950/40 dark:border-orange-700 dark:text-orange-200", icon: "🔶" },
                WARNING:   { cls: "bg-yellow-50 border-yellow-300 text-yellow-900 dark:bg-yellow-950/40 dark:border-yellow-700 dark:text-yellow-200", icon: "⚠️" },
                EMISSIONS: { cls: "bg-amber-50 border-amber-300 text-amber-900 dark:bg-amber-950/40 dark:border-amber-700 dark:text-amber-200",  icon: "💨" },
                DTC_ONLY:  { cls: "bg-blue-50 border-blue-300 text-blue-900 dark:bg-blue-950/40 dark:border-blue-700 dark:text-blue-200",     icon: "🔧" },
              };
              const { cls, icon } = severityConfig[label] ?? { cls: "bg-muted border-border text-foreground", icon: "⚙️" };
              return (
                <div className={`rounded-md border p-3 ${cls}`} data-testid="telematics-criticality-banner">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold">{icon} {label.replace(/_/g, " ")}</span>
                    {data.criticality?.SEVERITY_SCORE != null && (
                      <span className="text-xs font-mono font-semibold opacity-80">
                        Severity Score: {data.criticality.SEVERITY_SCORE}
                      </span>
                    )}
                  </div>
                  {data.criticality?.RECOMMENDED_ACTION && (
                    <p className="text-xs mt-1 leading-snug opacity-85">{data.criticality.RECOMMENDED_ACTION}</p>
                  )}
                  {data.criticality?.DTC_COUNT_DISTINCT != null && (
                    <p className="text-xs mt-1 opacity-70">
                      {data.criticality.DTC_COUNT_DISTINCT} distinct fault code
                      {data.criticality.DTC_COUNT_DISTINCT !== 1 ? "s" : ""} detected
                    </p>
                  )}
                </div>
              );
            })()}

            {activeDTCs.length > 0 && (
              <div className="space-y-1.5">
                {activeDTCs.map((m, i) => (
                  <div
                    key={m.MAINT_ID || i}
                    className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5"
                    data-testid={`telematics-dtc-${i}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="font-mono font-bold text-sm text-destructive">
                        {m.DTC_ID || "Unknown"}
                      </span>
                      {m.J1939_STATUS && (
                        <Badge variant="outline" className="text-xs shrink-0 border-destructive/40 text-destructive">
                          {m.J1939_STATUS}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-foreground mt-0.5 leading-snug">
                      {m.DTC_DESCRIPTION || "No description available"}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Fuel & Idle (last 7 days) */}
      <section>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
          <Fuel className="w-4 h-4 text-muted-foreground" />
          Fuel &amp; Idle (last 7 days)
        </h3>
        {recentFuel.length === 0 ? (
          <div className="text-xs text-muted-foreground bg-muted/40 rounded-md p-3">
            No fuel data available
          </div>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-muted/40 rounded-md p-3" data-testid="telematics-total-fuel">
                <p className="text-xs text-muted-foreground">Total Fuel Used</p>
                <p className="text-base font-semibold">{totalFuel.toFixed(2)} gal</p>
              </div>
              <div className="bg-muted/40 rounded-md p-3" data-testid="telematics-total-idle">
                <p className="text-xs text-muted-foreground">Total Idle Time</p>
                <p className="text-base font-semibold">
                  {totalIdle >= 60 ? `${(totalIdle / 60).toFixed(1)} hr` : `${Math.round(totalIdle)} min`}
                </p>
              </div>
            </div>
            <div className="rounded-md border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Date</th>
                    <th className="text-right px-3 py-2 font-medium">Fuel (gal)</th>
                    <th className="text-right px-3 py-2 font-medium">Idle (min)</th>
                    <th className="text-right px-3 py-2 font-medium">Efficiency</th>
                  </tr>
                </thead>
                <tbody>
                  {recentFuel.map((f, i) => (
                    <tr key={i} className="border-t hover:bg-muted/30">
                      <td className="px-3 py-1.5">{formatDate(f.RUN_DATE_UTC)}</td>
                      <td className="px-3 py-1.5 text-right">{f.FUEL_CONSUMED_GAL?.toFixed(2) ?? "—"}</td>
                      <td className="px-3 py-1.5 text-right">{f.ENGINE_IDLETIME_MIN?.toFixed(0) ?? "—"}</td>
                      <td className="px-3 py-1.5 text-right">
                        {f.EFFICIENCY_MPGE != null ? `${f.EFFICIENCY_MPGE.toFixed(1)} mpge` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Stream Log */}
      {data.stream?.TIME && (
        <>
          <Separator />
          <section>
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-muted-foreground" />
              Stream Log
            </h3>
            <div className="rounded-md border p-3 divide-y divide-border">
              <Row label="Last Stream Ping" value={formatDateTime(data.stream.TIME)} testId="telematics-stream-ping" />
              <Row
                label="Speed at Ping"
                value={data.stream.SPEED_MPH != null ? `${data.stream.SPEED_MPH} mph` : null}
              />
            </div>
          </section>
        </>
      )}

      <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground italic flex items-start gap-2">
        <Satellite className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>
          Tier-aware reads (Snowflake mirror → webhook → live API) with provenance badges land in Phase 3B.1.
        </span>
      </div>
    </div>
  );
}
