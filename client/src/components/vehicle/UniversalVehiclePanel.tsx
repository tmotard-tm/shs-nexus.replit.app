import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Truck as TruckIcon, MapPin, Wrench, UserCog, Package, History,
  ExternalLink, FileText, Building2,
} from "lucide-react";
import { StatusBadge } from "@/components/fleet-scope/StatusBadge";
import { determineOwner, ownerColors, type TruckPanelData } from "./_helpers";
import { OverviewTab } from "./tabs/OverviewTab";
import { TelematicsTab } from "./tabs/TelematicsTab";
import { ServiceTab } from "./tabs/ServiceTab";
import { AssignmentsTab } from "./tabs/AssignmentsTab";
import { InventoryTab } from "./tabs/InventoryTab";
import { HistoryTab } from "./tabs/HistoryTab";

/**
 * UniversalVehiclePanel — single slideout that supersedes the nine
 * legacy vehicle-detail drawers across Core Nexus / Fleet Scope / VRM.
 *
 * Phase 2A.2: anchor migration of TruckDetailPanel content.
 *   - Data source: /api/fs/trucks/:id (FS Repair Tracker)
 *   - Identity: vehicleId is treated as fs_trucks.id for now.
 *   - Generalization beyond fs_trucks is a 2B concern.
 *
 * The Overview / Service / Telematics / History tabs absorb the previous
 * TruckDetailPanel sections. Assignments and Inventory tabs are
 * intentional placeholders wired in Phase 2A.3 against TPMS + WMS.
 */

export interface UniversalVehiclePanelProps {
  vehicleId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Caller invoked when the user clicks "Update AMS". Optional — header button hides when omitted. */
  onUpdateAms?: (truckNumber: string, vin?: string) => void;
  /** True when the AMS panel is open elsewhere; suppresses outside-click + escape close. */
  amsOpen?: boolean;
  /** "from" page used for back-link breadcrumbs on the full-detail page. */
  fromPage?: string;
}

interface VehicleInfo {
  vehicleNumber: string;
  vin: string;
  licensePlate: string | null;
}

type TabKey = "overview" | "telematics" | "service" | "assignments" | "inventory" | "history";

const TAB_DEFS: Array<{ key: TabKey; label: string; icon: typeof TruckIcon }> = [
  { key: "overview",    label: "Overview",    icon: TruckIcon },
  { key: "telematics",  label: "Telematics",  icon: MapPin },
  { key: "service",     label: "Service",     icon: Wrench },
  { key: "assignments", label: "Assignments", icon: UserCog },
  { key: "inventory",   label: "Inventory",   icon: Package },
  { key: "history",     label: "History",     icon: History },
];

export function UniversalVehiclePanel({
  vehicleId,
  open,
  onOpenChange,
  onUpdateAms,
  amsOpen,
  fromPage = "dashboard",
}: UniversalVehiclePanelProps) {
  const { data: truck, isLoading: truckLoading } = useQuery<TruckPanelData>({
    queryKey: ["/api/fs/trucks", vehicleId],
    enabled: !!vehicleId && open,
  });

  const { data: allVehiclesData } = useQuery<{ vehicles: VehicleInfo[] }>({
    queryKey: ["/api/fs/all-vehicles"],
    enabled: !!vehicleId && open,
  });

  const vehicleInfo = (() => {
    if (!truck || !allVehiclesData?.vehicles) return null;
    const truckNum = (truck.truckNumber || "").toString().padStart(6, "0");
    return allVehiclesData.vehicles.find((v) => v.vehicleNumber === truckNum) || null;
  })();

  const owner = truck ? determineOwner(truck) : "Oscar S";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="p-0 flex flex-col w-[700px] sm:max-w-[700px]"
        data-testid="panel-truck-detail"
        overlayClassName={amsOpen ? "pointer-events-none" : undefined}
        onInteractOutside={(e) => { if (amsOpen) e.preventDefault(); }}
        onEscapeKeyDown={(e) => { if (amsOpen) e.preventDefault(); }}
      >
        {truckLoading ? (
          <div className="p-6 space-y-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : !truck ? (
          <div className="p-6 text-center text-muted-foreground" data-testid="panel-truck-not-found">
            Truck not found
          </div>
        ) : (
          <>
            <SheetHeader className="px-6 pt-6 pb-4 border-b shrink-0">
              <div className="flex items-center justify-between gap-2 pr-6">
                <div className="flex items-center gap-2">
                  <SheetTitle className="flex items-center gap-2" data-testid="panel-truck-title">
                    Truck <span className="font-mono">{truck.truckNumber}</span>
                  </SheetTitle>
                  {truck.truckNumber && (
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="button-raw-pos"
                      onClick={() => {
                        const num = (truck.truckNumber || "").toString().replace(/^0+/, "");
                        window.open(`/fleet-scope/raw-pos/${num}`, "_blank", "noopener,noreferrer");
                      }}
                    >
                      <FileText className="w-3.5 h-3.5 mr-1.5" />
                      Raw POs
                    </Button>
                  )}
                  {onUpdateAms && truck.truckNumber && (
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="button-update-ams"
                      className="border-blue-200 text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950/30"
                      onClick={() => onUpdateAms(truck.truckNumber!.toString(), vehicleInfo?.vin)}
                    >
                      <Building2 className="w-3.5 h-3.5 mr-1.5" />
                      Update AMS
                    </Button>
                  )}
                </div>
                <Link href={`/fleet-scope/trucks/${truck.id}?from=${fromPage}`}>
                  <Button variant="outline" size="sm" data-testid="button-open-full-detail">
                    <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                    Full Details
                  </Button>
                </Link>
              </div>
              <SheetDescription className="flex items-center gap-2 flex-wrap">
                <StatusBadge
                  status={truck.mainStatus || "Confirming Status"}
                  mainStatus={truck.mainStatus}
                  subStatus={truck.subStatus}
                />
                <Badge variant="secondary" className={`text-xs ${ownerColors[owner]}`}>
                  {owner}
                </Badge>
              </SheetDescription>
            </SheetHeader>

            <Tabs defaultValue="overview" className="flex-1 flex flex-col overflow-hidden">
              <TabsList className="mx-6 mt-3 grid grid-cols-6 h-9 shrink-0">
                {TAB_DEFS.map(({ key, label, icon: Icon }) => (
                  <TabsTrigger
                    key={key}
                    value={key}
                    className="text-xs gap-1"
                    data-testid={`tab-${key}`}
                  >
                    <Icon className="w-3 h-3" />
                    <span className="hidden sm:inline">{label}</span>
                  </TabsTrigger>
                ))}
              </TabsList>

              <ScrollArea className="flex-1 overflow-auto">
                <div className="px-6 py-4">
                  <TabsContent value="overview" className="m-0">
                    <OverviewTab truck={truck} />
                  </TabsContent>
                  <TabsContent value="telematics" className="m-0">
                    <TelematicsTab truck={truck} />
                  </TabsContent>
                  <TabsContent value="service" className="m-0">
                    <ServiceTab truck={truck} />
                  </TabsContent>
                  <TabsContent value="assignments" className="m-0">
                    <AssignmentsTab truck={truck} />
                  </TabsContent>
                  <TabsContent value="inventory" className="m-0">
                    <InventoryTab truck={truck} />
                  </TabsContent>
                  <TabsContent value="history" className="m-0">
                    <HistoryTab truck={truck} />
                  </TabsContent>
                </div>
              </ScrollArea>
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
