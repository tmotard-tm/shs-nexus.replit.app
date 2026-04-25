import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Truck as TruckIcon, MapPin, Wrench, UserCog, Package, History, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * UniversalVehiclePanel — single slideout that supersedes the nine
 * legacy vehicle-detail drawers across Core Nexus / Fleet Scope / VRM.
 *
 * Skeleton (Phase 2A.1). Data wiring lands in 2A.2–2A.4 once the tiered
 * adapters (3A.5) and field_provenance (3A.1) are available.
 *
 * Each tab body is intentionally a placeholder — it documents the
 * domain and the legacy slideout(s) it absorbs, so the migration in
 * 2A.2+ is a focused per-domain merge rather than a big-bang rewrite.
 */

export interface UniversalVehiclePanelProps {
  vehicleId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional: caller's "from" page used for back-link breadcrumbs. */
  fromPage?: string;
}

type TabKey = "overview" | "telematics" | "service" | "assignments" | "inventory" | "history";

const TAB_DEFS: Array<{
  key: TabKey;
  label: string;
  icon: typeof TruckIcon;
  /** Data domains and the systems that source them. Reference for migration in 2A.2+. */
  sources: string;
}> = [
  { key: "overview",    label: "Overview",    icon: TruckIcon, sources: "WMS (identity, status) + TPMS (assignment SoT)" },
  { key: "telematics",  label: "Telematics",  icon: MapPin,    sources: "Samsara (Snowflake-first; webhook recency hint)" },
  { key: "service",     label: "Service",     icon: Wrench,    sources: "Holman + AMS (webhook + outbox)" },
  { key: "assignments", label: "Assignments", icon: UserCog,   sources: "TPMS (SoT) + WMS (live)" },
  { key: "inventory",   label: "Inventory",   icon: Package,   sources: "WMS receive/return tasks + counts" },
  { key: "history",     label: "History",     icon: History,   sources: "integration_events (cross-vendor change log)" },
];

export function UniversalVehiclePanel({ vehicleId, open, onOpenChange, fromPage }: UniversalVehiclePanelProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl flex flex-col p-0"
        data-testid="universal-vehicle-panel"
      >
        <SheetHeader className="px-6 pt-6 pb-3 border-b space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <SheetTitle className="text-lg flex items-center gap-2">
                <TruckIcon className="w-5 h-5 text-muted-foreground" />
                {vehicleId ? `Vehicle ${vehicleId}` : <Skeleton className="h-6 w-32" />}
              </SheetTitle>
              <SheetDescription className="text-xs">
                Unified view across WMS, Samsara, TPMS, Holman, AMS, PMF.
                {fromPage ? ` · from ${fromPage}` : ""}
              </SheetDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              data-testid="button-vehicle-refresh"
              disabled
              title="Forced refresh — wired in 3B.3"
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              Refresh
            </Button>
          </div>
        </SheetHeader>

        <Tabs defaultValue="overview" className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="mx-6 mt-3 grid grid-cols-6 h-9">
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

          <ScrollArea className="flex-1">
            <div className="px-6 py-4">
              {TAB_DEFS.map(({ key, label, sources }) => (
                <TabsContent key={key} value={key} className="m-0 space-y-3">
                  <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                    <div className="font-medium text-foreground mb-1">{label}</div>
                    <div className="text-xs">Sources: {sources}</div>
                    <div className="text-xs mt-3 italic">
                      Skeleton — content lands in Phase 2A.2+
                    </div>
                  </div>
                </TabsContent>
              ))}
            </div>
          </ScrollArea>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
