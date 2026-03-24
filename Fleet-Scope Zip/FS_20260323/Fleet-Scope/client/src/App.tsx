import { Switch, Route, Redirect, useParams, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UserProvider, useUser } from "@/context/UserContext";
import { ThemeProvider, ThemeToggle } from "@/components/ThemeToggle";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import Dashboard from "@/pages/Dashboard";
import ActionTracker from "@/pages/ActionTracker";
import ExecutiveSummary from "@/pages/ExecutiveSummary";
import MetricsDashboard from "@/pages/MetricsDashboard";
import HolmanResearch from "@/pages/HolmanResearch";
import PMF from "@/pages/PMF";
import POs from "@/pages/POs";
import Spares from "@/pages/Spares";
import AllVehicles from "@/pages/AllVehicles";
import FleetCost from "@/pages/FleetCost";
import Registration from "@/pages/Registration";
import Decommissioning from "@/pages/Decommissioning";
import ToolAudit from "@/pages/ToolAudit";
import BatchCaller from "@/pages/BatchCaller";
import RawPOs from "@/pages/RawPOs";
import TruckDetail from "@/pages/TruckDetail";
import EditTruck from "@/pages/EditTruck";
import ProfileSelection from "@/pages/ProfileSelection";
import { TodaysQueue, VehicleSearch, DiscrepancyFinder } from "@/pages/PlaceholderPages";
import NotFound from "@/pages/not-found";

function EditRedirect() {
  const { id } = useParams();
  return <Redirect to={`/trucks/${id}`} />;
}

function ProtectedRoute({ component: Component }: { component: () => JSX.Element }) {
  const { isProfileSet } = useUser();

  if (!isProfileSet) {
    return <Redirect to="/profile" />;
  }

  return <Component />;
}

function Router() {
  return (
    <Switch>
      <Route path="/profile" component={ProfileSelection} />
      <Route path="/">
        {() => <ProtectedRoute component={AllVehicles} />}
      </Route>
      <Route path="/dashboard">
        {() => <ProtectedRoute component={Dashboard} />}
      </Route>
      <Route path="/action-tracker">
        {() => <ProtectedRoute component={ActionTracker} />}
      </Route>
      <Route path="/executive-summary">
        {() => <ProtectedRoute component={ExecutiveSummary} />}
      </Route>
      <Route path="/metrics">
        {() => <ProtectedRoute component={MetricsDashboard} />}
      </Route>
      <Route path="/holman-research">
        {() => <ProtectedRoute component={HolmanResearch} />}
      </Route>
      <Route path="/pmf">
        {() => <ProtectedRoute component={PMF} />}
      </Route>
      <Route path="/pmf/tool-audit/:assetId">
        {() => <ProtectedRoute component={ToolAudit} />}
      </Route>
      <Route path="/pos">
        {() => <ProtectedRoute component={POs} />}
      </Route>
      <Route path="/spares">
        {() => <ProtectedRoute component={Spares} />}
      </Route>
      <Route path="/fleet-cost">
        {() => <ProtectedRoute component={FleetCost} />}
      </Route>
      <Route path="/registration">
        {() => <ProtectedRoute component={Registration} />}
      </Route>
      <Route path="/decommissioning">
        {() => <ProtectedRoute component={Decommissioning} />}
      </Route>
      <Route path="/batch-caller">
        {() => <ProtectedRoute component={BatchCaller} />}
      </Route>
      <Route path="/queue">
        {() => <ProtectedRoute component={TodaysQueue} />}
      </Route>
      <Route path="/vehicle-search">
        {() => <ProtectedRoute component={VehicleSearch} />}
      </Route>
      <Route path="/discrepancies">
        {() => <ProtectedRoute component={DiscrepancyFinder} />}
      </Route>
      <Route path="/raw-pos/:truckNumber">
        {() => <ProtectedRoute component={RawPOs} />}
      </Route>
      <Route path="/trucks/new">
        {() => <ProtectedRoute component={EditTruck} />}
      </Route>
      <Route path="/trucks/:id">
        {() => <ProtectedRoute component={TruckDetail} />}
      </Route>
      <Route path="/trucks/:id/edit" component={EditRedirect} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AppLayout() {
  const { isProfileSet } = useUser();
  const [location] = useLocation();

  const isProfilePage = location === "/profile";

  if (!isProfileSet || isProfilePage) {
    return <Router />;
  }

  const style = {
    "--sidebar-width": "15rem",
    "--sidebar-width-icon": "3.5rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex items-center gap-2 px-3 py-2 border-b bg-background shrink-0 sticky top-0 z-50" data-testid="app-header">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <div className="flex-1" />
            <ThemeToggle />
          </header>
          <main className="flex-1 overflow-auto">
            <Router />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <UserProvider>
            <Toaster />
            <AppLayout />
          </UserProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
