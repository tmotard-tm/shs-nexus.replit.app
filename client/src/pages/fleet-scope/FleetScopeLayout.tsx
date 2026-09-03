import { Switch, Route } from "wouter";
import { Link } from "wouter";
import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/fleet-scope/app-sidebar";
import { UserProvider } from "@/context/FleetScopeUserContext";
import { Separator } from "@/components/ui/separator";
import { Home, ChevronLeft } from "lucide-react";
import { Sidebar as GlobalNavMenu } from "@/components/layout/sidebar";

import AllVehicles from "./AllVehicles";
import ExecutiveSummary from "./ExecutiveSummary";
import MetricsDashboard from "./MetricsDashboard";
import HolmanResearch from "./HolmanResearch";
import PMF from "./PMF";
import POs from "./POs";
import Spares from "./Spares";
import FleetCost from "./FleetCost";
import Registration from "./Registration";
import Decommissioning from "./Decommissioning";
import ProcurementHistory from "./ProcurementHistory";
import ToolAudit from "./ToolAudit";
import TechSchedules from "./TechSchedules";
import { VehicleSearch, DiscrepancyFinder } from "./PlaceholderPages";
import NotFound from "@/pages/not-found";

export default function FleetScopeLayout() {
  return (
    <UserProvider>
      <SidebarProvider>
        {/* h-screen (not min-h-screen) binds the height chain so `main` is the
            scroll container and pages can build viewport-fit flex layouts;
            guarded by scripts/check-*-viewport.ts (see viewport-fit-guard). */}
        <div className="fleet-scope-layout h-screen flex w-full">
          <AppSidebar />
          {/* min-w-0 lets the inset shrink below content min-width (the fleet
              table is 2000px wide) so wide tables scroll inside their own
              overflow-x containers instead of pushing the whole document
              wider than a 13" laptop screen. */}
          <SidebarInset className="min-w-0">
            <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-4">
              <GlobalNavMenu inline />
              <Separator orientation="vertical" className="h-4" />
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="h-4" />
              <button
                onClick={() => { if (window.history.length > 1) { window.history.back(); } else { window.location.href = '/'; } }}
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Back
              </button>
              <Separator orientation="vertical" className="h-4" />
              <Link href="/" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
                <Home className="h-3.5 w-3.5" />
                <span>Nexus</span>
              </Link>
              <span className="text-muted-foreground text-sm">/</span>
              <span className="text-sm font-medium text-foreground">Fleet Scope</span>
            </header>
            <main className="flex-1 min-h-0 overflow-auto" data-testid="fleet-scope-main">
              <Switch>
                <Route path="/fleet-scope" component={AllVehicles} />
                <Route path="/fleet-scope/executive-summary" component={ExecutiveSummary} />
                <Route path="/fleet-scope/metrics" component={MetricsDashboard} />
                <Route path="/fleet-scope/holman-research" component={HolmanResearch} />
                <Route path="/fleet-scope/pmf" component={PMF} />
                <Route path="/fleet-scope/pmf/tool-audit/:assetId" component={ToolAudit} />
                <Route path="/fleet-scope/pos" component={POs} />
                <Route path="/fleet-scope/spares" component={Spares} />
                <Route path="/fleet-scope/fleet-cost" component={FleetCost} />
                <Route path="/fleet-scope/registration" component={Registration} />
                <Route path="/fleet-scope/decommissioning/procurement-history" component={ProcurementHistory} />
                <Route path="/fleet-scope/decommissioning" component={Decommissioning} />
                <Route path="/fleet-scope/vehicle-search" component={VehicleSearch} />
                <Route path="/fleet-scope/tech-schedules" component={TechSchedules} />
                <Route path="/fleet-scope/discrepancies" component={DiscrepancyFinder} />
                <Route component={NotFound} />
              </Switch>
            </main>
          </SidebarInset>
        </div>
      </SidebarProvider>
    </UserProvider>
  );
}
