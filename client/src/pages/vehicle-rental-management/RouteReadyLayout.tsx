import { Switch, Route, useLocation } from "wouter";
import { RouteReadySidebar } from "./components/route-ready-sidebar";
import { RouteReadyTopbar } from "./components/route-ready-topbar";
import { WipPlaceholder } from "./components/wip-placeholder";
import { colors, navItems } from "./lib/constants";
import Dashboard from "./pages/Dashboard";
import Escalations from "./pages/Escalations";
import DCAReview from "./pages/DCAReview";
import ExceptionCases from "./pages/ExceptionCases";
import NewRentals from "./pages/NewRentals";
import NewRentalFullLog from "./pages/NewRentalFullLog";
import RentalRepairTracker from "./pages/RentalRepairTracker";
import ActiveRentalsDashboard from "./pages/ActiveRentalsDashboard";

function getPageTitle(path: string): string {
  if (path === "/vehicle-rental-management" || path === "/vehicle-rental-management/") return "Dashboard";
  const item = navItems.find((n) => path.startsWith(n.path) && n.path !== "/vehicle-rental-management");
  return item?.label ?? "Dashboard";
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
            <Route path="/vehicle-rental-management" component={Dashboard} />
            <Route path="/vehicle-rental-management/new-rentals" component={NewRentals} />
            <Route path="/vehicle-rental-management/active-rentals" component={ActiveRentalsDashboard} />
            <Route path="/vehicle-rental-management/tech-population" component={WipPlaceholder} />
            <Route path="/vehicle-rental-management/escalations" component={Escalations} />
            <Route path="/vehicle-rental-management/dca-review" component={DCAReview} />
            <Route path="/vehicle-rental-management/exception-cases" component={ExceptionCases} />
            <Route path="/vehicle-rental-management/new-rental-full-log" component={NewRentalFullLog} />
            <Route path="/vehicle-rental-management/rental-repair-tracker" component={RentalRepairTracker} />
            <Route>
              <WipPlaceholder moduleName="Page Not Found" />
            </Route>
          </Switch>
        </main>
      </div>
    </div>
  );
}
