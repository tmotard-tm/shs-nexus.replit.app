import { Switch, Route, useLocation } from "wouter";
import { RouteReadySidebar } from "./components/route-ready-sidebar";
import { RouteReadyTopbar } from "./components/route-ready-topbar";
import { WipPlaceholder } from "./components/wip-placeholder";
import { colors, navItems } from "./lib/constants";
import Dashboard from "./pages/Dashboard";
import TechPopulation from "./pages/TechPopulation";
import Outreach from "./pages/Outreach";
import Escalations from "./pages/Escalations";
import DCAReview from "./pages/DCAReview";
import ExceptionCases from "./pages/ExceptionCases";
import Reports from "./pages/Reports";

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
            <Route path="/vehicle-rental-management/tech-population" component={TechPopulation} />
            <Route path="/vehicle-rental-management/outreach" component={Outreach} />
            <Route path="/vehicle-rental-management/escalations" component={Escalations} />
            <Route path="/vehicle-rental-management/dca-review" component={DCAReview} />
            <Route path="/vehicle-rental-management/exception-cases" component={ExceptionCases} />
            <Route path="/vehicle-rental-management/reports" component={Reports} />
            <Route path="/vehicle-rental-management/skill-builder">
              <WipPlaceholder moduleName="Skill Builder" />
            </Route>
            <Route>
              <WipPlaceholder moduleName="Page Not Found" />
            </Route>
          </Switch>
        </main>
      </div>
    </div>
  );
}
