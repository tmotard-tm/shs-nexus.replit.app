import { Switch, Route } from "wouter";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/fleet-scope/app-sidebar";
import { UserProvider } from "@/context/FleetScopeUserContext";

import AllVehicles from "./AllVehicles";
import Dashboard from "./Dashboard";
import ActionTracker from "./ActionTracker";
import ExecutiveSummary from "./ExecutiveSummary";
import MetricsDashboard from "./MetricsDashboard";
import HolmanResearch from "./HolmanResearch";
import PMF from "./PMF";
import POs from "./POs";
import Spares from "./Spares";
import FleetCost from "./FleetCost";
import Registration from "./Registration";
import Decommissioning from "./Decommissioning";
import ToolAudit from "./ToolAudit";
import BatchCaller from "./BatchCaller";
import RawPOs from "./RawPOs";
import TruckDetail from "./TruckDetail";
import EditTruck from "./EditTruck";
import { TodaysQueue, VehicleSearch, DiscrepancyFinder } from "./PlaceholderPages";
import NotFound from "@/pages/not-found";

export default function FleetScopeLayout() {
  return (
    <UserProvider>
      <SidebarProvider>
        <div className="min-h-screen flex w-full">
          <AppSidebar />
          <main className="flex-1 overflow-auto">
            <Switch>
              <Route path="/fleet-scope" component={AllVehicles} />
              <Route path="/fleet-scope/dashboard" component={Dashboard} />
              <Route path="/fleet-scope/action-tracker" component={ActionTracker} />
              <Route path="/fleet-scope/executive-summary" component={ExecutiveSummary} />
              <Route path="/fleet-scope/metrics" component={MetricsDashboard} />
              <Route path="/fleet-scope/holman-research" component={HolmanResearch} />
              <Route path="/fleet-scope/pmf" component={PMF} />
              <Route path="/fleet-scope/pmf/tool-audit/:assetId" component={ToolAudit} />
              <Route path="/fleet-scope/pos" component={POs} />
              <Route path="/fleet-scope/spares" component={Spares} />
              <Route path="/fleet-scope/fleet-cost" component={FleetCost} />
              <Route path="/fleet-scope/registration" component={Registration} />
              <Route path="/fleet-scope/decommissioning" component={Decommissioning} />
              <Route path="/fleet-scope/batch-caller" component={BatchCaller} />
              <Route path="/fleet-scope/queue" component={TodaysQueue} />
              <Route path="/fleet-scope/vehicle-search" component={VehicleSearch} />
              <Route path="/fleet-scope/discrepancies" component={DiscrepancyFinder} />
              <Route path="/fleet-scope/raw-pos/:truckNumber" component={RawPOs} />
              <Route path="/fleet-scope/trucks/new" component={EditTruck} />
              <Route path="/fleet-scope/trucks/:id" component={TruckDetail} />
              <Route component={NotFound} />
            </Switch>
          </main>
        </div>
      </SidebarProvider>
    </UserProvider>
  );
}
