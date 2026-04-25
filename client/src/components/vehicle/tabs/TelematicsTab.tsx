import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { MapPin, Navigation, Clock, Gauge } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { InfoRow, type TruckPanelData } from "@/components/vehicle/_helpers";

/**
 * Telematics tab — currently sources Samsara fields directly from
 * /api/samsara/vehicle/:n. In Phase 3B.1 this becomes the
 * Snowflake-first tiered read (T1 mirror / T2 webhook / T3 live)
 * via the BaseTieredVendorAdapter, with FieldProvenanceBadge surfaced.
 */
export function TelematicsTab({ truck }: { truck: TruckPanelData }) {
  const samsaraVehicleName = (truck.truckNumber || "").toString().replace(/^0+/, "");
  const { data: samsaraData, isLoading } = useQuery<any>({
    queryKey: ["/api/samsara/vehicle", samsaraVehicleName],
    enabled: !!samsaraVehicleName,
    staleTime: 2 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const hasAny = samsaraData?.REVERSE_GEO_FULL || samsaraData?.TIME;

  return (
    <div className="space-y-5">
      <section>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
          <Navigation className="w-4 h-4 text-muted-foreground" />
          Samsara Telematics
        </h3>
        <div className="rounded-md border p-3">
          {!hasAny ? (
            <p className="text-sm text-muted-foreground italic" data-testid="telematics-no-data">
              No telematics data available for vehicle {samsaraVehicleName || "—"}
            </p>
          ) : (
            <div className="space-y-0.5">
              {samsaraData?.REVERSE_GEO_FULL && (
                <InfoRow
                  label="Last Known Location"
                  value={samsaraData.REVERSE_GEO_FULL}
                  icon={<MapPin className="w-3.5 h-3.5" />}
                  testId="telematics-location"
                />
              )}
              {samsaraData?.TIME && (
                <InfoRow
                  label="Last Signal"
                  value={format(new Date(samsaraData.TIME), "MMM d, yyyy h:mm a")}
                  icon={<Clock className="w-3.5 h-3.5" />}
                  testId="telematics-signal-time"
                />
              )}
              {samsaraData?.SPEED != null && (
                <InfoRow
                  label="Speed"
                  value={`${samsaraData.SPEED} mph`}
                  icon={<Gauge className="w-3.5 h-3.5" />}
                  testId="telematics-speed"
                />
              )}
            </div>
          )}
        </div>
      </section>

      <div className="rounded-md border border-dashed p-4 text-xs text-muted-foreground italic">
        Tier-aware reads (Snowflake mirror → webhook → live API) with provenance badges land in Phase 3B.1.
      </div>
    </div>
  );
}
