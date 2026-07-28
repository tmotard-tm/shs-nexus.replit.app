import { Switch, Route, Redirect, useLocation } from "wouter";
import { RouteReadySidebar } from "./components/route-ready-sidebar";
import { RouteReadyTopbar } from "./components/route-ready-topbar";
import { WipPlaceholder } from "./components/wip-placeholder";
import { colors, navItems } from "./lib/constants";
import ExecutiveSummary from "./pages/ExecutiveSummary";
import NewRentals from "./pages/NewRentals";
import NewRentalFullLog from "./pages/NewRentalFullLog";
import RentalRepairTracker from "./pages/RentalRepairTracker";
import RentalOperations from "./pages/RentalOperations";
import RegionalCases from "./pages/RegionalCases";
import RightsizeTracker from "./pages/RightsizeTracker";
import Settings from "./pages/Settings";

function getPageTitle(path: string): string {
  const item = navItems.find((n) => path.startsWith(n.path) && n.path !== "/vehicle-rental-management");
  return item?.label ?? "New Rentals";
}

export default function RouteReadyLayout() {
  const [location] = useLocation();
  const title = getPageTitle(location);

  return (
    <div className="flex min-h-screen w-full" style={{ backgroundColor: colors.background }}>
      <RouteReadySidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <RouteReadyTopbar title={title} />
        <main className="flex-1 overflow-auto" style={{ padding: 32 }}>
          <Switch>
            {/* Dashboard and Active Rentals were scrapped 2026-07-11; old
                bookmarks land on New Rentals instead of a dead pane. */}
            <Route path="/vehicle-rental-management">
              <Redirect to="/vehicle-rental-management/new-rentals" replace />
            </Route>
            <Route path="/vehicle-rental-management/active-rentals">
              <Redirect to="/vehicle-rental-management/new-rentals" replace />
            </Route>
            <Route path="/vehicle-rental-management/executive-summary" component={ExecutiveSummary} />
            <Route path="/vehicle-rental-management/new-rentals" component={NewRentals} />
            <Route path="/vehicle-rental-management/new-rental-full-log" component={NewRentalFullLog} />
            <Route path="/vehicle-rental-management/rental-repair-tracker" component={RentalRepairTracker} />
            <Route path="/vehicle-rental-management/rental-operations" component={RentalOperations} />
            <Route path="/vehicle-rental-management/cases-by-region" component={RegionalCases} />
            <Route path="/vehicle-rental-management/rightsize-tracker" component={RightsizeTracker} />
            <Route path="/vehicle-rental-management/settings" component={Settings} />
            <Route>
              <WipPlaceholder moduleName="Page Not Found" />
            </Route>
          </Switch>
        </main>
      </div>
    </div>
  );
}
