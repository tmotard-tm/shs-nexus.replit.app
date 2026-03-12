import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Car, MapPin, Gauge, Calendar, Wrench, User, DollarSign, MessageSquare } from "lucide-react";

interface AmsVehiclePanelProps {
  vin: string;
}

export function AmsVehiclePanel({ vin }: AmsVehiclePanelProps) {
  const { data, isLoading, error } = useQuery<any>({
    queryKey: ['/api/ams/vehicles', vin, 'summary'],
    enabled: !!vin,
  });

  if (!vin) return null;

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Car className="h-4 w-4" /> AMS Vehicle Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
        </CardContent>
      </Card>
    );
  }

  const vehicle = data?.vehicle;
  const recentComments: any[] = data?.recentComments || [];
  const found = data?.found !== false;

  if (error || !found || !vehicle) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Car className="h-4 w-4" /> AMS Vehicle Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            {error ? 'Unable to load AMS data' : (data?.reason || 'No AMS data available')}
          </p>
        </CardContent>
      </Card>
    );
  }

  const rows: Array<{ icon: any; label: string; value: string | null }> = [
    { icon: Car, label: 'Vehicle', value: [vehicle.ModelYear, vehicle.MakeName, vehicle.ModelName].filter(Boolean).join(' ') || null },
    { icon: Car, label: 'VIN', value: vehicle.VIN },
    { icon: Car, label: 'Vehicle #', value: vehicle.VehicleNumber },
    { icon: User, label: 'Tech', value: vehicle.TechName || vehicle.Tech },
    { icon: MapPin, label: 'Location', value: [vehicle.CurLocAddress || vehicle.Address, vehicle.CurLocCity || vehicle.City, vehicle.CurLocState || vehicle.State, vehicle.CurLocZip || vehicle.Zip].filter(Boolean).join(', ') || null },
    { icon: Gauge, label: 'Odometer', value: vehicle.CurOdometer ? `${Number(vehicle.CurOdometer).toLocaleString()} mi` : null },
    { icon: Calendar, label: 'Delivery Date', value: vehicle.DeliveryDate },
    { icon: Calendar, label: 'Lease End', value: vehicle.LeaseEndDate },
    { icon: Wrench, label: 'Road Ready', value: vehicle.RoadReady },
    { icon: DollarSign, label: 'Book Value', value: vehicle.RemBookValue ? `$${Number(vehicle.RemBookValue).toLocaleString()}` : null },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Car className="h-4 w-4" />
          AMS Vehicle Details
          {vehicle.VehicleGrade && (
            <Badge variant="outline" className="ml-auto text-xs">
              Grade: {vehicle.VehicleGrade}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {rows.map((row, i) => row.value ? (
            <div key={i} className="flex items-start gap-1.5 text-xs">
              <row.icon className="h-3 w-3 mt-0.5 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground shrink-0">{row.label}:</span>
              <span className="font-medium truncate">{row.value}</span>
            </div>
          ) : null)}
        </div>
        {vehicle.ColorName && (
          <div className="mt-2 flex gap-2 text-xs">
            <Badge variant="secondary" className="text-xs">{vehicle.ColorName}</Badge>
            {vehicle.BrandingName && <Badge variant="secondary" className="text-xs">{vehicle.BrandingName}</Badge>}
          </div>
        )}
        {recentComments.length > 0 && (
          <>
            <Separator className="my-3" />
            <div>
              <p className="text-xs font-medium flex items-center gap-1.5 mb-2">
                <MessageSquare className="h-3 w-3" /> Recent Comments
              </p>
              <div className="space-y-1.5">
                {recentComments.map((c: any, i: number) => (
                  <div key={i} className="text-xs p-2 bg-muted/30 rounded">
                    <span className="text-muted-foreground">{c.CommentDate || c.CreatedDate || ''}</span>
                    {(c.Author || c.CreatedBy || c.User) && (
                      <span className="text-muted-foreground font-medium"> by {c.Author || c.CreatedBy || c.User}</span>
                    )}
                    {' — '}
                    <span>{c.CommentText || c.Comment || c.Notes || ''}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
