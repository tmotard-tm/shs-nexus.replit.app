import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Satellite, Loader2, AlertCircle, MapPin, Gauge, Wrench,
  Fuel, Wifi, WifiOff, Clock, Navigation, AlertTriangle, CheckCircle
} from "lucide-react";

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
}

interface TelematicsButtonProps {
  vehicleNumber: string;
  vin?: string | null;
  variant?: "default" | "outline" | "ghost" | "secondary" | "destructive" | "link";
  size?: "default" | "sm" | "lg" | "icon";
  className?: string;
}

function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleString("en-US", {
      month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true
    });
  } catch {
    return dateStr;
  }
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return dateStr;
  }
}

function InfoRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="text-xs text-muted-foreground shrink-0 w-36">{label}</span>
      <span className={`text-xs text-right ${mono ? "font-mono" : "font-medium"}`}>{value || "—"}</span>
    </div>
  );
}

export function TelematicsButton({
  vehicleNumber,
  variant = "outline",
  size = "sm",
  className = "",
}: TelematicsButtonProps) {
  const [open, setOpen] = useState(false);

  const { data, isLoading, error, refetch } = useQuery<TelematicsData>({
    queryKey: ["/api/samsara/telematics", vehicleNumber],
    queryFn: async () => {
      const res = await fetch(`/api/samsara/telematics/${encodeURIComponent(vehicleNumber)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load telematics data");
      return res.json();
    },
    enabled: open && !!vehicleNumber,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const activeDTCs = data?.maintenance?.filter(m => m.DTC_ID || m.DTC_DESCRIPTION) ?? [];
  const recentFuel = data?.fuel?.slice(0, 7) ?? [];
  const totalFuel = recentFuel.reduce((s, f) => s + (f.FUEL_CONSUMED_GAL ?? 0), 0);
  const totalIdle = recentFuel.reduce((s, f) => s + (f.ENGINE_IDLETIME_MIN ?? 0), 0);

  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={className}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        data-testid={`btn-telematics-${vehicleNumber}`}
      >
        <Satellite className="h-4 w-4 mr-1.5" />
        Telematics
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Satellite className="h-5 w-5" />
              Telematics — Vehicle #{vehicleNumber}
            </DialogTitle>
            <DialogDescription>
              Current Samsara data from Snowflake
              {data?.location?.source === "live" && (
                <Badge variant="secondary" className="ml-2 text-xs">Live</Badge>
              )}
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="flex-1 pr-1">
            {isLoading && (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin" />
                <span className="text-sm">Loading telematics data…</span>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 text-destructive py-8">
                <AlertCircle className="h-5 w-5 shrink-0" />
                <div>
                  <p className="font-medium text-sm">Failed to load telematics</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{(error as Error).message}</p>
                </div>
                <Button size="sm" variant="outline" className="ml-auto" onClick={() => refetch()}>Retry</Button>
              </div>
            )}

            {data && !isLoading && (
              <div className="space-y-4 py-1">

                {/* Vehicle Info */}
                {data.vehicle && (
                  <section>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1.5">
                      <Wifi className="h-3.5 w-3.5" /> Vehicle Info
                    </h3>
                    <div className="bg-muted/40 rounded-lg px-3 divide-y divide-border">
                      <InfoRow label="Samsara ID" value={data.vehicle.VEHICLE_ID} mono />
                      <InfoRow label="VIN" value={data.vehicle.VIN} mono />
                      <InfoRow label="Year / Make / Model" value={[data.vehicle.YEAR, data.vehicle.MAKE, data.vehicle.MODEL].filter(Boolean).join(" ") || null} />
                      <InfoRow label="Assigned Driver" value={data.vehicle.STATICASSIGNEDDRIVER_NAME} />
                    </div>
                  </section>
                )}

                {!data.vehicle && (
                  <div className="flex items-center gap-2 text-amber-600 bg-amber-50 dark:bg-amber-950/20 rounded-lg p-3">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span className="text-xs">Vehicle not found in Samsara. It may not be enrolled or uses a different truck number format.</span>
                  </div>
                )}

                <Separator />

                {/* GPS Location */}
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5" /> GPS Location
                  </h3>
                  {data.location ? (
                    <div className="bg-muted/40 rounded-lg px-3 divide-y divide-border">
                      <InfoRow label="Address" value={data.location.REVERSE_GEO_FULL || `${data.location.LAT?.toFixed(5)}, ${data.location.LNG?.toFixed(5)}`} />
                      <InfoRow label="Coordinates" value={`${data.location.LAT?.toFixed(6) ?? "—"}, ${data.location.LNG?.toFixed(6) ?? "—"}`} mono />
                      <InfoRow label="Speed" value={data.location.SPEED_MPH != null ? `${data.location.SPEED_MPH.toFixed(1)} mph` : null} />
                      <InfoRow label="Heading" value={data.location.HEADING != null ? `${data.location.HEADING}°` : null} />
                      <InfoRow label="Last Updated" value={formatDateTime(data.location.TIME)} />
                      <InfoRow label="Source" value={
                        <Badge variant={data.location.source === "live" ? "default" : "secondary"} className="text-xs">
                          {data.location.source}
                        </Badge>
                      } />
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-muted-foreground bg-muted/40 rounded-lg p-3">
                      <WifiOff className="h-4 w-4 shrink-0" />
                      <span className="text-xs">No GPS data available</span>
                    </div>
                  )}
                </section>

                <Separator />

                {/* Odometer */}
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1.5">
                    <Gauge className="h-3.5 w-3.5" /> Odometer
                  </h3>
                  {data.odometer ? (
                    <div className="bg-muted/40 rounded-lg px-3 divide-y divide-border">
                      <InfoRow label="OBD Miles" value={data.odometer.OBD_MILES != null ? data.odometer.OBD_MILES.toLocaleString() + " mi" : null} />
                      <InfoRow label="OBD Timestamp" value={formatDateTime(data.odometer.OBD_TIME)} />
                      <InfoRow label="GPS Miles" value={data.odometer.GPS_MILES != null ? data.odometer.GPS_MILES.toLocaleString() + " mi" : null} />
                      <InfoRow label="GPS Timestamp" value={formatDateTime(data.odometer.GPS_TIME)} />
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-muted-foreground bg-muted/40 rounded-lg p-3">
                      <span className="text-xs">No odometer data available</span>
                    </div>
                  )}
                </section>

                <Separator />

                {/* Engine / DTC Codes */}
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1.5">
                    <Wrench className="h-3.5 w-3.5" /> Engine / Diagnostic Codes
                    {activeDTCs.length > 0 && (
                      <Badge variant="destructive" className="text-xs ml-1">{activeDTCs.length}</Badge>
                    )}
                  </h3>
                  {activeDTCs.length === 0 ? (
                    <div className="flex items-center gap-2 text-green-600 bg-green-50 dark:bg-green-950/20 rounded-lg p-3">
                      <CheckCircle className="h-4 w-4 shrink-0" />
                      <span className="text-xs">No active diagnostic codes</span>
                    </div>
                  ) : (
                    <div className="rounded-lg border overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-muted">
                          <tr>
                            <th className="text-left px-3 py-2 font-medium">DTC Code</th>
                            <th className="text-left px-3 py-2 font-medium">Description</th>
                            <th className="text-left px-3 py-2 font-medium">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeDTCs.map((m, i) => (
                            <tr key={m.MAINT_ID || i} className="border-t hover:bg-muted/30">
                              <td className="px-3 py-2 font-mono text-destructive">{m.DTC_ID || "—"}</td>
                              <td className="px-3 py-2">{m.DTC_DESCRIPTION || "—"}</td>
                              <td className="px-3 py-2 text-muted-foreground">{m.J1939_STATUS || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                <Separator />

                {/* Fuel & Idle (last 7 days) */}
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1.5">
                    <Fuel className="h-3.5 w-3.5" /> Fuel & Idle (last 7 days)
                  </h3>
                  {recentFuel.length === 0 ? (
                    <div className="flex items-center gap-2 text-muted-foreground bg-muted/40 rounded-lg p-3">
                      <span className="text-xs">No fuel data available</span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-muted/40 rounded-lg p-3">
                          <p className="text-xs text-muted-foreground">Total Fuel Used</p>
                          <p className="text-base font-semibold">{totalFuel.toFixed(2)} gal</p>
                        </div>
                        <div className="bg-muted/40 rounded-lg p-3">
                          <p className="text-xs text-muted-foreground">Total Idle Time</p>
                          <p className="text-base font-semibold">{totalIdle >= 60 ? `${(totalIdle / 60).toFixed(1)} hr` : `${Math.round(totalIdle)} min`}</p>
                        </div>
                      </div>
                      <div className="rounded-lg border overflow-hidden">
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
                                <td className="px-3 py-1.5 text-right">{f.EFFICIENCY_MPGE != null ? `${f.EFFICIENCY_MPGE.toFixed(1)} mpge` : "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </section>

                {/* Last Known Stream Timestamp */}
                {data.stream?.TIME && (
                  <>
                    <Separator />
                    <section>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5" /> Stream Log
                      </h3>
                      <div className="bg-muted/40 rounded-lg px-3 divide-y divide-border">
                        <InfoRow label="Last Stream Ping" value={formatDateTime(data.stream.TIME)} />
                        <InfoRow label="Speed at Ping" value={data.stream.SPEED_MPH != null ? `${data.stream.SPEED_MPH} mph` : null} />
                      </div>
                    </section>
                  </>
                )}

              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
