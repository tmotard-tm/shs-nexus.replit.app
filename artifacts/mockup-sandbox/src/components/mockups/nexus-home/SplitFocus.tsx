import { useState } from "react";
import {
  LayoutGrid, UserMinus, UserPlus, MapPin, Plus, Wrench,
  CalendarPlus, CalendarMinus, Car, BarChart3, TrendingUp,
  AlertTriangle, Phone, DollarSign, ListChecks, Truck,
  ParkingCircle, FileText, Receipt, Trash2, Search,
  Home, ChevronRight, Clock, CheckCircle2,
} from "lucide-react";

const todaysFocus = [
  { label: "Task Queue", count: 4, urgent: true, icon: LayoutGrid, href: "/queue-management" },
  { label: "Pending Onboarding", count: 7, urgent: false, icon: UserPlus, href: "/onboard-hire" },
  { label: "Vehicles to Assign", count: 12, urgent: false, icon: Car, href: "/fleet-management" },
  { label: "Offboarding Active", count: 2, urgent: false, icon: UserMinus, href: "/offboard-technician" },
];

const moduleGroups = [
  {
    label: "Action Center",
    items: [{ label: "Task Queue", icon: LayoutGrid, badge: "4" }],
  },
  {
    label: "Fleet Operations",
    items: [
      { label: "Fleet Management", icon: MapPin, badge: null },
      { label: "Fleet Scope", icon: Wrench, badge: null },
      { label: "Create New Vehicle", icon: Plus, badge: null },
      { label: "All Vehicles", icon: Car, badge: null },
    ],
  },
  {
    label: "People",
    items: [
      { label: "Onboarding", icon: UserPlus, badge: null },
      { label: "Offboarding", icon: UserMinus, badge: null },
      { label: "Weekly Onboarding", icon: CalendarPlus, badge: null },
      { label: "Weekly Offboarding", icon: CalendarMinus, badge: null },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { label: "Fleet Cost", icon: DollarSign, badge: null },
      { label: "Metrics Dashboard", icon: TrendingUp, badge: null },
      { label: "Discrepancy Finder", icon: AlertTriangle, badge: null },
    ],
  },
];

const recentActivity = [
  { desc: "Vehicle #2341 assigned to J. Martinez", time: "2m ago", ok: true },
  { desc: "TPMS alert: Unit #1887 pressure low", time: "31m ago", ok: false },
  { desc: "Onboarding: K. Thompson started", time: "14m ago", ok: true },
  { desc: "Offboarding completed — R. Davis", time: "1h ago", ok: true },
  { desc: "Snowflake sync — 1,204 records updated", time: "3h ago", ok: true },
];

export function SplitFocus() {
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground text-sm">
      {/* Header */}
      <header className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b border-border bg-background px-4">
        <Home className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-muted-foreground">/</span>
        <span className="font-medium">Home</span>
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          <span>Thursday, Mar 2026</span>
        </div>
      </header>

      {/* Split layout */}
      <div className="flex-1 overflow-hidden flex">
        {/* Left: Today's Focus */}
        <div className="w-72 flex-shrink-0 border-r border-border overflow-auto bg-muted/30 p-4 space-y-5">
          <div>
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Nexus: Your Business, Synced.</h2>
            <p className="text-xs text-muted-foreground">Here's what needs attention today.</p>
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Today's Focus</h3>
            {todaysFocus.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.label}
                  className="w-full flex items-center gap-3 p-2.5 rounded-lg border border-border bg-background hover:bg-accent transition-colors text-left"
                >
                  <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <span className="flex-1 text-sm">{item.label}</span>
                  <span className={`text-sm font-semibold ${item.urgent ? "text-destructive" : "text-foreground"}`}>{item.count}</span>
                </button>
              );
            })}
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Recent Activity</h3>
            <div className="space-y-1">
              {recentActivity.map((a, i) => (
                <div key={i} className="flex items-start gap-2 py-1.5">
                  <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${a.ok ? "bg-emerald-500" : "bg-amber-500"}`}></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-foreground leading-snug">{a.desc}</p>
                    <p className="text-xs text-muted-foreground">{a.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Module launcher */}
        <div className="flex-1 overflow-auto p-6 space-y-6">
          {moduleGroups.map((group) => (
            <div key={group.label}>
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">{group.label}</h2>
              <div className="grid grid-cols-2 gap-2">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isHovered = hovered === `${group.label}-${item.label}`;
                  return (
                    <button
                      key={item.label}
                      onMouseEnter={() => setHovered(`${group.label}-${item.label}`)}
                      onMouseLeave={() => setHovered(null)}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border hover:bg-accent hover:border-accent-foreground/20 text-left transition-all group"
                    >
                      <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <span className="flex-1 text-sm font-medium">{item.label}</span>
                      {item.badge && (
                        <span className="bg-primary text-primary-foreground text-xs rounded-full px-1.5 py-0.5 leading-none">{item.badge}</span>
                      )}
                      <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-opacity ${isHovered ? "opacity-100" : "opacity-0"}`} />
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {/* System status footer */}
          <div className="pt-2 border-t border-border">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">System Status</h2>
            <div className="flex flex-wrap gap-3">
              {["API Gateway", "Snowflake DB", "Authentication", "TPMS"].map((s) => (
                <div key={s} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                  {s}
                </div>
              ))}
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-400"></div>
                External APIs (9/11)
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
