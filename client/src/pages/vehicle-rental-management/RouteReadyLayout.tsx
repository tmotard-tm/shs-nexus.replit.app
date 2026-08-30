import { Switch, Route, Redirect, useLocation } from "wouter";
import { RouteReadySidebar } from "./components/route-ready-sidebar";
import { RouteReadyTopbar } from "./components/route-ready-topbar";
import { WipPlaceholder } from "./components/wip-placeholder";
import { colors, fonts, navItems } from "./lib/constants";
import { useVrmAccess } from "./lib/use-vrm-access";
import ExecutiveSummary from "./pages/ExecutiveSummary";
import NewRentals from "./pages/NewRentals";
import NewRentalFullLog from "./pages/NewRentalFullLog";
import RentalOperations from "./pages/RentalOperations";
import OpsQueue from "./pages/OpsQueue";
import RegionalCases from "./pages/RegionalCases";
import InboundCalls from "./pages/InboundCalls";
import LucaActivity from "./pages/LucaActivity";
import RentalSurvey from "./pages/RentalSurvey";
import CutoverTracking from "./pages/CutoverTracking";
import RentalRequests from "./pages/RentalRequests";
import TechSchedules from "./pages/TechSchedules";
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

/**
 * Tombstone for a retired VRM tab. Says what went away, why, and where the work
 * lives now. A retired page that 404s silently just generates the question
 * "where did my tracker go" in someone else's inbox.
 */
function RetiredPane({ title, body, to, toLabel }: { title: string; body: string; to: string; toLabel: string }) {
  const [, setLocation] = useLocation();
  return (
    <div style={{ padding: "48px 32px", maxWidth: 640 }}>
      <div style={{ fontFamily: fonts.syne, fontSize: 20, fontWeight: 700, color: colors.ink, marginBottom: 10 }}>{title}</div>
      <div style={{ fontFamily: fonts.dmSans, fontSize: 14, lineHeight: 1.6, color: colors.inkSoft, marginBottom: 20 }}>{body}</div>
      <button
        type="button"
        onClick={() => setLocation(to)}
        style={{ fontFamily: fonts.dmSans, fontSize: 13, fontWeight: 600, color: "#fff", background: colors.accent,
                 border: "none", borderRadius: 8, padding: "9px 18px", cursor: "pointer" }}
      >
        Go to {toLabel}
      </button>
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
    // h-screen (not min-h-screen) binds the height chain so `main` is the
    // scroll container and the shell always fits the viewport; guarded by
    // scripts/check-vrm-ops-queue-viewport.ts (see viewport-fit-guard).
    <div className="flex h-screen w-full" style={{ backgroundColor: colors.background }}>
      <RouteReadySidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <RouteReadyTopbar title={title} />
        <main className="flex-1 min-h-0 overflow-auto" data-testid="vrm-main" style={{ padding: 32 }}>
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
            <Route path="/vehicle-rental-management/rental-operations" component={RentalOperations} />
            <Route path="/vehicle-rental-management/ops-queue" component={OpsQueue} />
            <Route path="/vehicle-rental-management/cases-by-region" component={RegionalCases} />
            <Route path="/vehicle-rental-management/inbound-calls" component={InboundCalls} />
            <Route path="/vehicle-rental-management/luca-activity" component={LucaActivity} />
            <Route path="/vehicle-rental-management/rental-requests" component={RentalRequests} />
            <Route path="/vehicle-rental-management/tech-schedules" component={TechSchedules} />
            <Route path="/vehicle-rental-management/rental-survey" component={RentalSurvey} />
            <Route path="/vehicle-rental-management/cutover-tracking" component={CutoverTracking} />
            <Route path="/vehicle-rental-management/settings" component={Settings} />
            {/* RETIRED 2026-08-30 (Tyler: "kill the right-size tracker and delete
                the denial tracker"). Both routes are kept as explicit tombstones
                rather than deleted outright: people have these URLs bookmarked and
                a bare 404 does not tell them what happened or where to go next. */}
            <Route path="/vehicle-rental-management/rental-repair-tracker">
              <RetiredPane
                title="Rental Denial Tracker was retired"
                body="123 rows, none ever closed since 2026-04-02, and 80% of them more than 90 days old. Rental denials still happen (14 in August) — they are recorded in the decision log, not here."
                to="/vehicle-rental-management/rental-operations"
                toLabel="Rental Operations"
              />
            </Route>
            <Route path="/vehicle-rental-management/rightsize-tracker">
              <RetiredPane
                title="Rightsize Tracker was retired"
                body="The compliance math it showed is on Rental Operations, which already carries rental class, actual vehicle type, cost delta and the over-median flag on every row."
                to="/vehicle-rental-management/rental-operations"
                toLabel="Rental Operations"
              />
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
