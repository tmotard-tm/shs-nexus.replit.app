import { Switch, Route, Redirect, useLocation } from "wouter";
import { RouteReadySidebar } from "./components/route-ready-sidebar";
import { RouteReadyTopbar } from "./components/route-ready-topbar";
import { WipPlaceholder } from "./components/wip-placeholder";
import { colors, navItems } from "./lib/constants";
import { useVrmAccess } from "./lib/use-vrm-access";
import ExecutiveSummary from "./pages/ExecutiveSummary";
import NewRentals from "./pages/NewRentals";
import NewRentalFullLog from "./pages/NewRentalFullLog";
import RentalRepairTracker from "./pages/RentalRepairTracker";
import RentalOperations from "./pages/RentalOperations";
import OpsQueue from "./pages/OpsQueue";
import RegionalCases from "./pages/RegionalCases";
import RightsizeTracker from "./pages/RightsizeTracker";
import InboundCalls from "./pages/InboundCalls";
import LucaActivity from "./pages/LucaActivity";
import RentalSurvey from "./pages/RentalSurvey";
import Settings from "./pages/Settings";

function getPageTitle(path: string): string {
  const item = navItems.find((n) => path.startsWith(n.path) && n.path !== "/vehicle-rental-management");
  return item?.label ?? "New Rentals";
}

/** Shown instead of a restricted page when this session may not see it. */
function NotAuthorizedPane() {
  return (
    <div style={{ maxWidth: 560, margin: "48px auto", textAlign: "center", fontFamily: "inherit" }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: colors.ink, marginBottom: 6 }}>
        Not available on your account
      </div>
      <div style={{ fontSize: 13, color: colors.inkMuted, lineHeight: 1.5 }}>
        New Rentals is limited to the rental-PO approvers and Fleet leadership.
        Everything else in Vehicle Rental Management, including the New Rental Full Log,
        is available from the sidebar.
      </div>
    </div>
  );
}

export default function RouteReadyLayout() {
  const [location] = useLocation();
  const title = getPageTitle(location);
  // The server decides. Fails closed: while the answer is loading the restricted
  // routes render the notice, never the page.
  const { canSeeNewRentals, loading } = useVrmAccess();
  // Non-approvers cannot land on New Rentals, so the module's default has to move.
  const home = canSeeNewRentals
    ? "/vehicle-rental-management/new-rentals"
    : "/vehicle-rental-management/executive-summary";

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
              {loading ? <div /> : <Redirect to={home} replace />}
            </Route>
            <Route path="/vehicle-rental-management/active-rentals">
              {loading ? <div /> : <Redirect to={home} replace />}
            </Route>
            <Route path="/vehicle-rental-management/executive-summary" component={ExecutiveSummary} />
            {/* Typing the URL must not work either. The server refuses the data
                regardless (requireNewRentalsAccess); this stops the page shell
                and its failing requests from rendering at all. */}
            <Route path="/vehicle-rental-management/new-rentals">
              {canSeeNewRentals ? <NewRentals /> : <NotAuthorizedPane />}
            </Route>
            {/* Full Log is open to everyone (Tyler 2026-07-31): other people rely
                on it and nobody could say exactly who. */}
            <Route path="/vehicle-rental-management/new-rental-full-log" component={NewRentalFullLog} />
            <Route path="/vehicle-rental-management/rental-repair-tracker" component={RentalRepairTracker} />
            <Route path="/vehicle-rental-management/rental-operations" component={RentalOperations} />
            <Route path="/vehicle-rental-management/ops-queue" component={OpsQueue} />
            <Route path="/vehicle-rental-management/cases-by-region" component={RegionalCases} />
            <Route path="/vehicle-rental-management/rightsize-tracker" component={RightsizeTracker} />
            <Route path="/vehicle-rental-management/inbound-calls" component={InboundCalls} />
            <Route path="/vehicle-rental-management/luca-activity" component={LucaActivity} />
            <Route path="/vehicle-rental-management/rental-survey" component={RentalSurvey} />
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
